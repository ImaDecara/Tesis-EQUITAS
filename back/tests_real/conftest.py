"""ALIGN-052. Pruebas contra el stack local real: Auth, PostgREST, RLS y uvicorn de verdad.

Fuera de `testpaths`: `python -m pytest` aislado no las recoge. Se corren con
`python -m pytest tests_real -q` desde `back/`, con el turno de la base tomado y recién
después de `db reset --local`. Solo aceptan loopback. Dejan filas: al terminar corresponde
otro `db reset`. Claves y contraseñas se quedan en memoria: no se imprimen ni se guardan.
"""

import json
import os
import shutil
import socket
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

import httpx
import pytest

# Noche 7: por defecto, el stack de siempre; scripts/campanas/equitas_campanas.py declara su proyecto local propio con
# EQUITAS_LOCAL_DIR (carpeta privada con supabase-local.env y el turno) y EQUITAS_LOCAL_PROJECT (nombre de los contenedores).
LOCAL_DIR = Path(os.environ.get("EQUITAS_LOCAL_DIR", "/tmp/equitas-local-db"))
ENV_FILE = LOCAL_DIR / "supabase-local.env"
LOCK = LOCAL_DIR / "lock"
PROJECT_ID = os.environ.get("EQUITAS_LOCAL_PROJECT", "equitas-tp-testing")
if not PROJECT_ID.replace("-", "").isalnum():
    raise RuntimeError("EQUITAS_LOCAL_PROJECT invalido")
DB_CONTAINER = f"supabase_db_{PROJECT_ID}"
AUTH_CONTAINER = f"supabase_auth_{PROJECT_ID}"
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
ROOT = Path(__file__).resolve().parents[2]
BACK = ROOT / "back"
# Permite repetir el recorrido sobre otro árbol, como el combinado con otra rama.
FRONT = Path(os.environ.get("EQUITAS_E2E_FRONT", ROOT / "front"))
TESTING = ROOT / "database" / "testing"
GENERAL_KEYS = ("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY", "SERVICE_ROLE_KEY", "SECRET_KEY")


def load_local_env() -> dict[str, str]:
    values = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        name, separator, value = line.strip().partition("=")
        if separator:
            values[name] = value.strip('"')
    url = urlsplit(values.get("API_URL", ""))
    if url.scheme != "http" or url.hostname not in LOOPBACK_HOSTS or url.username or url.password:
        pytest.exit("DETENERSE: API_URL no es el stack local", returncode=2)
    if any("supabase.co" in value for value in (*values.values(), *os.environ.values())):
        pytest.exit("DETENERSE: un valor de configuracion nombra un proyecto remoto", returncode=2)
    if not LOCK.is_dir():
        pytest.exit("DETENERSE: sin turno de la base (falta el lock)", returncode=2)
    return values


def psql(sql: str | None = None, *, script: Path | None = None) -> str:
    """Como postgres, dentro del contenedor local. Nada de la salida se muestra."""
    data = script.read_bytes() if script else sql.encode()
    done = subprocess.run(
        ["docker", "exec", "-i", DB_CONTAINER, "psql", "-X", "-U", "postgres", "-d", "postgres",
         "-v", "ON_ERROR_STOP=1", "-q", "-At", "-F", "|"],
        input=data, capture_output=True, check=False,
    )
    if done.returncode:
        # Sin stdout: puede tener contraseñas.
        pytest.fail(f"psql fallo: {done.stderr.decode(errors='replace')[:400]}")
    return done.stdout.decode()


def parse_accounts(output: str, prefix: str = "") -> dict[str, tuple[str, str]]:
    accounts = {}
    for line in output.splitlines():
        label, email, password = line.split("|")
        accounts[f"{prefix}{label}"] = (email, password)
    return accounts


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def wait_for_port(port: int, process: subprocess.Popen, seconds: float = 60) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if process.poll() is not None:
            pytest.fail(f"El proceso termino antes de abrir el puerto: {process.returncode}")
        with socket.socket() as probe:
            probe.settimeout(0.5)
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                return
        time.sleep(0.2)
    pytest.fail("El proceso no abrio el puerto a tiempo")


@dataclass
class ApiServer:
    url: str
    environment: dict[str, str] = field(repr=False)
    log_path: Path
    store_root: Path

    def logs(self) -> str:
        return self.log_path.read_text(encoding="utf-8", errors="replace")


@pytest.fixture(scope="session")
def env() -> dict[str, str]:
    return load_local_env()


@pytest.fixture(scope="session")
def accounts(env) -> dict[str, tuple[str, str]]:
    health = httpx.get(f"{env['API_URL']}/auth/v1/health", timeout=10, trust_env=False)
    assert health.status_code == 200, "Auth local no responde"
    assert psql("select count(*) from auth.users where email like 'tp-a018-%'").strip() == "0", (
        "Se requiere db reset --local antes de estas pruebas"
    )
    found = parse_accounts(psql(script=TESTING / "case-review-auth-fixtures.sql"))
    psql(script=TESTING / "case-review-fixtures.sql")
    found.update(parse_accounts(psql(script=Path(__file__).parent / "fixtures.sql")))
    return found


@pytest.fixture(scope="session")
def signing_key() -> dict[str, str]:
    """La clave privada del Auth local: permite probar que un token rechazado por vencido o por
    emisor se rechaza por eso, con una firma por lo demás válida."""
    done = subprocess.run(
        ["docker", "exec", AUTH_CONTAINER, "printenv", "GOTRUE_JWT_KEYS"],
        capture_output=True, check=True,
    )
    keys = json.loads(done.stdout)
    return next(key for key in keys if key.get("d") and key.get("alg") == "ES256")


@pytest.fixture(scope="session")
def import_jwt(env) -> str:
    done = subprocess.run(
        [sys.executable, "-I", str(TESTING / "case_review_local.py"), "mint-jwt",
         "--role", "equitas_import_server", "--hours", "6"],
        capture_output=True, check=True,
    )
    assert done.returncode == 0
    return (LOCAL_DIR / "equitas_import_server.jwt").read_text(encoding="utf-8").strip()


@pytest.fixture(scope="session")
def api_server(env, accounts, import_jwt, tmp_path_factory):
    """uvicorn real, con un entorno armado desde cero: sin ninguna clave general."""
    work = tmp_path_factory.mktemp("api")
    os.chmod(work, 0o700)
    log_path = work / "uvicorn.log"
    port = free_port()
    environment = {
        "PATH": os.environ["PATH"],
        "HOME": str(work),
        "EQUITAS_TARGET_ENV": "local",
        "SUPABASE_URL": env["API_URL"],
        "SUPABASE_PUBLISHABLE_KEY": env["PUBLISHABLE_KEY"],
        "EQUITAS_IMPORT_SERVER_JWT": import_jwt,
        "EQUITAS_IMPORT_TMP_DIR": str(work / "almacen"),
    }
    assert not set(GENERAL_KEYS) & set(environment)
    with log_path.open("wb") as log:
        process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "api.main:app", "--host", "127.0.0.1",
             "--port", str(port), "--log-level", "debug", "--access-log"],
            cwd=BACK, env=environment, stdout=log, stderr=subprocess.STDOUT,
        )
    try:
        wait_for_port(port, process)
        yield ApiServer(f"http://127.0.0.1:{port}", environment, log_path, work / "almacen")
    finally:
        process.terminate()
        process.wait(timeout=20)


@pytest.fixture
def http(api_server):
    with httpx.Client(base_url=api_server.url, trust_env=False, timeout=120) as client:
        yield client


@pytest.fixture(scope="session")
def login(env, accounts):
    def _login(label: str) -> str:
        email, password = accounts[label]
        response = httpx.post(
            f"{env['API_URL']}/auth/v1/token",
            params={"grant_type": "password"},
            headers={"apikey": env["PUBLISHABLE_KEY"]},
            json={"email": email, "password": password},
            timeout=20,
            trust_env=False,
        )
        assert response.status_code == 200, f"login {label}: {response.status_code}"
        return response.json()["access_token"]

    return _login


@dataclass
class NextServer:
    url: str
    host: str
    internal_url: str
    log_path: Path

    def logs(self) -> str:
        return self.log_path.read_text(encoding="utf-8", errors="replace")

    def static_files(self) -> list[Path]:
        return [path for path in (FRONT / ".next" / "static").rglob("*") if path.is_file()]


@pytest.fixture(scope="session")
def next_server(env, api_server, tmp_path_factory):
    """`next build` y `next start` reales, en el proceso propio y en un puerto alto."""
    npm = shutil.which("npm", path=os.environ["PATH"])
    assert npm, "Falta npm"
    environment = {
        "PATH": os.environ["PATH"],
        "HOME": os.environ.get("HOME", ""),
        "NEXT_TELEMETRY_DISABLED": "1",
        "NEXT_PUBLIC_SUPABASE_URL": env["API_URL"],
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": env["PUBLISHABLE_KEY"],
        "EQUITAS_IMPORT_API_URL": api_server.url,
    }
    # Con `node_modules` enlazado desde otro directorio, Turbopack rechaza el enlace.
    # Noche 7: con una copia cuyo node_modules es una clonacion (no un enlace), Turbopack compila: EQUITAS_E2E_WEBPACK=0
    # usa el compilador por defecto, el mismo de la aplicacion entregada.
    bundler = ["--", "--webpack"] if os.environ.get("EQUITAS_E2E_FRONT") and os.environ.get("EQUITAS_E2E_WEBPACK", "1") != "0" else []
    subprocess.run([npm, "run", "build", *bundler], cwd=FRONT, env=environment, check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600)
    port = free_port()
    log_path = tmp_path_factory.mktemp("next") / "next.log"
    with log_path.open("wb") as log:
        process = subprocess.Popen(
            [npm, "run", "start", "--", "--port", str(port), "--hostname", "127.0.0.1"],
            cwd=FRONT, env=environment, stdout=log, stderr=subprocess.STDOUT,
        )
    try:
        wait_for_port(port, process)
        yield NextServer(f"http://127.0.0.1:{port}", f"127.0.0.1:{port}", api_server.url, log_path)
    finally:
        process.terminate()
        process.wait(timeout=20)


@pytest.fixture(scope="session")
def session_cookie(env, accounts):
    """Encabezado Cookie real, generado por @supabase/ssr en un proceso de Node."""

    def _cookie(label: str) -> str:
        email, password = accounts[label]
        done = subprocess.run(
            ["node", "tests/local-imports/session-cookies.mjs"],
            cwd=FRONT,
            env={
                "PATH": os.environ["PATH"],
                "LOCAL_SUPABASE_URL": env["API_URL"],
                "LOCAL_PUBLISHABLE_KEY": env["PUBLISHABLE_KEY"],
                "LOCAL_EMAIL": email,
                "LOCAL_PASSWORD": password,
            },
            capture_output=True,
            check=False,
        )
        assert done.returncode == 0, f"cookie {label}: {done.returncode}"
        return done.stdout.decode()

    return _cookie
