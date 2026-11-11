"""Campañas contra una base real LOCAL y descartable (noche 7), con la matriz de roles ADMIN/USER.

Proyecto Supabase local PROPIO («equitas-n7-campanas», API 57321 / base 57322 / shadow 57320), carpeta privada
~/.equitas-n7-campanas (0700) y Next en 127.0.0.1:3170 compilado desde una copia `git archive HEAD` (lo CONFIRMADO,
no el árbol de trabajo). Cada campaña empieza con el proyecto recreado desde cero (`stop --no-backup` + `start`).
Se niega a operar sobre los proyectos y carpetas de otros entornos (demo de la noche 6, aceptación, espejo).

Uso (desde la raíz del repositorio):
  back/.venv/bin/python scripts/campanas/equitas_campanas.py reportes      028: reportes CSV por HTTP (obligatoria)
  back/.venv/bin/python scripts/campanas/equitas_campanas.py e06           E06 + SMOKE-01, adaptación local declarada
  back/.venv/bin/python scripts/campanas/equitas_campanas.py decisiones    comprobaciones SQL y HTTP de decisiones
  back/.venv/bin/python scripts/campanas/equitas_campanas.py revision      022: campaña de revisión por HTTP
  back/.venv/bin/python scripts/campanas/equitas_campanas.py importacion   back/tests_real contra la base real
  back/.venv/bin/python scripts/campanas/equitas_campanas.py todas         todas, en ese orden
  back/.venv/bin/python scripts/campanas/equitas_campanas.py detener       detiene Next y el proyecto propio

Las contraseñas y claves quedan en la carpeta privada; la evidencia guardada está saneada.
"""
from __future__ import annotations

import argparse
import base64
import contextlib
import hashlib
import hmac
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROJECT_ID = 'equitas-n7-campanas'
API_PORT, DB_PORT, SHADOW_PORT = 57321, 57322, 57320
APP_PORT, IMPORT_PORT = 3170, 8770
API_URL = f'http://127.0.0.1:{API_PORT}'
APP_URL = f'http://127.0.0.1:{APP_PORT}'
HOME = Path.home() / '.equitas-n7-campanas'
DB_CONTAINER = f'supabase_db_{PROJECT_ID}'
# Otros entornos: nunca se arrancan, detienen, leen ni modifican desde acá.
FORBIDDEN_IDS = ('equitas-tp-testing', 'equitas-n7-local', 'equitas-n7-espejo')
FORBIDDEN_HOMES = ('.equitas-demo', '.equitas-n7', '.equitas-n7-espejo')
REMOTE_MARKERS = ('supabase.co', 'supabase.com', 'folyslqzqvnpolexcxjo', 'iylwghgvtydpmwidojdo')
CLI = ('npx', '--yes', 'supabase@2.108.0')
NPM_BIN = str(Path.home() / '.t3/tools/equitas-npm-11.21.1/bin')
PYTHON = ROOT / 'back/.venv/bin/python'
SYSTEM_PYTHON = '/opt/homebrew/bin/python3.12'
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
SECRET_RE = re.compile(r'eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_(?:secret|publishable)_[\w-]+')


class CampaignError(RuntimeError):
    pass


# ------------------------------------------------------------------ guardas

def guard() -> None:
    """Identificadores y carpetas propios; nada remoto en el entorno del proceso."""
    if PROJECT_ID in FORBIDDEN_IDS or HOME.name in FORBIDDEN_HOMES:
        raise CampaignError('Identificador o carpeta prohibidos.')
    if any(marker in value for marker in REMOTE_MARKERS for value in os.environ.values()):
        raise CampaignError('Una variable de entorno nombra un proyecto remoto; no se opera.')


def guard_container(name: str) -> str:
    if not name.endswith(PROJECT_ID) or any(name.endswith(other) for other in FORBIDDEN_IDS):
        raise CampaignError(f'Contenedor ajeno: {name}')
    return name


def guard_env(values: dict[str, str]) -> dict[str, str]:
    if values.get('API_URL') != API_URL:
        raise CampaignError('supabase status no apunta al proyecto propio.')
    if any(marker in value for marker in REMOTE_MARKERS for value in values.values()):
        raise CampaignError('La configuración local nombra un proyecto remoto.')
    return values


# ------------------------------------------------------------------ utilidades

def utc() -> str:
    return datetime.now(UTC).isoformat()


def git(*args: str) -> str:
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def write_private(path: Path, text: str | bytes) -> Path:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'wb') as handle:
        handle.write(text.encode() if isinstance(text, str) else text)
    os.chmod(path, 0o600)
    return path


def port_busy(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(1)
        return probe.connect_ex(('127.0.0.1', port)) == 0


def http(url: str, headers: dict[str, str] | None = None, timeout: float = 5) -> tuple[int | None, bytes]:
    try:
        with OPENER.open(urllib.request.Request(url, headers=headers or {}), timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()
    except (urllib.error.URLError, OSError):
        return None, b''


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()


def mint_jwt(secret: str, role: str, hours: float = 6) -> str:
    now = int(time.time())
    claims = {'role': role, 'iss': 'equitas-local', 'iat': now, 'exp': now + int(hours * 3600)}
    header = b64url(json.dumps({'alg': 'HS256', 'typ': 'JWT'}, separators=(',', ':')).encode())
    payload = b64url(json.dumps(claims, separators=(',', ':')).encode())
    signature = hmac.new(secret.encode(), f'{header}.{payload}'.encode(), hashlib.sha256).digest()
    return f'{header}.{payload}.{b64url(signature)}'


def tool_env() -> dict[str, str]:
    """Variables con las que las herramientas de campaña (fixtures, run-http, conftest...) apuntan a ESTE proyecto."""
    return {'EQUITAS_LOCAL_DIR': str(HOME), 'EQUITAS_LOCAL_PROJECT': PROJECT_ID, 'EQUITAS_LOCAL_API_URL': API_URL}


def base_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    env = {key: value for key, value in os.environ.items() if not key.startswith(('GIT_', 'SUPABASE_', 'NEXT_PUBLIC_', 'EQUITAS_'))}
    env.update(PATH=f'{NPM_BIN}:' + os.environ.get('PATH', ''), DO_NOT_TRACK='1', SUPABASE_TELEMETRY_DISABLED='1',
               NEXT_TELEMETRY_DISABLED='1', PYTHONDONTWRITEBYTECODE='1', **tool_env())
    env.update(extra or {})
    return env


# ------------------------------------------------------------------ ejecución con evidencia saneada

class Run:
    def __init__(self, campaign: str):
        guard()
        HOME.mkdir(mode=0o700, exist_ok=True)
        os.chmod(HOME, 0o700)
        self.campaign = campaign
        self.sha = git('rev-parse', 'HEAD')
        stamp = datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')
        self.dir = HOME / 'evidencia' / f'{stamp}-{campaign}'
        self.dir.mkdir(mode=0o700, parents=True)
        self.raw = self.dir / 'privado'
        self.raw.mkdir(mode=0o700)
        self.results: dict = {'campaign': campaign, 'sha': self.sha, 'started_at_utc': utc(),
                              'tools_diff_sha256': self.tools_hash(), 'steps': []}
        self.secrets: list[str] = []

    @staticmethod
    def tools_hash() -> str:
        """Huella del estado de las herramientas de campaña en el árbol de trabajo (son de este encargo, aún sin confirmar)."""
        paths = ['scripts/campanas', 'database/testing', 'back/tests_real', 'front/tests/local-reports', 'front/tests/local-review',
                 'front/tests/external-review']
        diff = subprocess.check_output(['git', 'diff', 'HEAD', '--', *paths], cwd=ROOT)
        untracked = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', '--', *paths], cwd=ROOT)
        return hashlib.sha256(diff + untracked).hexdigest()

    def redact(self, text: str) -> str:
        for value in sorted(set(self.secrets), key=len, reverse=True):
            if len(value) >= 8:
                text = text.replace(value, '[privado]')
        text = re.sub(r'("(?:access_token|refresh_token|password)"\s*:\s*")[^"]+(")', r'\1[privado]\2', text)
        return SECRET_RE.sub('[clave]', text)

    def step(self, name: str, argv: list[str], *, cwd: Path = ROOT, env: dict[str, str] | None = None, timeout: int = 900,
             stdin: bytes | None = None) -> int:
        started = utc()
        process = subprocess.Popen(argv, cwd=cwd, env=base_env(env), stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            out, _ = process.communicate(stdin, timeout=timeout)
            code: int | str = process.returncode
        except subprocess.TimeoutExpired:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            out, _ = process.communicate()
            code = 'timeout'
        text = self.redact(out.decode(errors='replace'))
        write_private(self.dir / f'{name}.log', text)
        self.results['steps'].append({'name': name, 'command': [self.redact(a) for a in argv], 'cwd': str(cwd), 'exit': code,
                                      'started_at_utc': started, 'ended_at_utc': utc()})
        tail = '\n'.join(text.strip().splitlines()[-3:])
        print(f'[{self.campaign}] {name}: exit {code}' + (f'\n    {tail}' if tail and code != 0 else ''), flush=True)
        return code if isinstance(code, int) else 124

    def psql(self, name: str, sql: bytes | str, *, capture: bool = True, user: str = 'postgres') -> str:
        container = guard_container(DB_CONTAINER)
        argv = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-At', '-F', '|']
        result = subprocess.run(argv, input=sql.encode() if isinstance(sql, str) else sql, capture_output=True, timeout=600)
        write_private(self.raw / f'{name}.out', result.stdout + result.stderr)
        self.results['steps'].append({'name': name, 'command': argv, 'exit': result.returncode, 'at_utc': utc(), 'output': 'privada'})
        if result.returncode != 0:
            print(f'[{self.campaign}] {name}: psql exit {result.returncode}\n    {self.redact(result.stderr.decode(errors="replace"))[-1500:]}',
                  flush=True)
            raise CampaignError(f'{name}: psql falló')
        print(f'[{self.campaign}] {name}: ok', flush=True)
        return result.stdout.decode()

    def psql_file(self, name: str, relative: str, **kwargs) -> str:
        return self.psql(name, (ROOT / relative).read_bytes(), **kwargs)

    def save(self) -> Path:
        self.results['ended_at_utc'] = utc()
        path = self.dir / 'results.json'
        write_private(path, json.dumps(self.results, indent=2, ensure_ascii=False) + '\n')
        return path


# ------------------------------------------------------------------ proyecto Supabase propio

CONFIG_TOML = f'''# Generado por scripts/campanas/equitas_campanas.py. Proyecto LOCAL DESCARTABLE de las campañas de la noche 7.
project_id = "{PROJECT_ID}"

[api]
enabled = true
port = {API_PORT}
schemas = ["public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = {DB_PORT}
shadow_port = {SHADOW_PORT}
major_version = 17

[db.seed]
enabled = false

[auth]
enabled = true
site_url = "{APP_URL}"
enable_signup = false

[studio]
enabled = false

[inbucket]
enabled = false

[analytics]
enabled = false

[realtime]
enabled = false

[storage]
enabled = false

[edge_runtime]
enabled = false
'''


def workdir() -> Path:
    return HOME / 'proyecto'


def cli(*args: str) -> list[str]:
    return [*CLI, '--workdir', str(workdir()), *args]


def prepare_project(copy: Path) -> None:
    """Configuración propia y las migraciones del commit (de la copia git archive, no del árbol de trabajo)."""
    project = workdir() / 'supabase'
    migrations = project / 'migrations'
    if migrations.exists():
        shutil.rmtree(migrations)
    migrations.mkdir(mode=0o700, parents=True)
    write_private(project / 'config.toml', CONFIG_TOML)
    for source in sorted((copy / 'supabase/migrations').glob('*.sql')):
        shutil.copyfile(source, migrations / source.name)
    text = (project / 'config.toml').read_text()
    if f'project_id = "{PROJECT_ID}"' not in text or any(other in text for other in FORBIDDEN_IDS):
        raise CampaignError('config.toml propio inconsistente.')


def stack_running() -> bool:
    result = subprocess.run(['docker', 'inspect', '-f', '{{.State.Running}}', guard_container(DB_CONTAINER)], capture_output=True, text=True)
    return result.returncode == 0 and result.stdout.strip() == 'true'


def project_stop(run: Run | None) -> int:
    if not (workdir() / 'supabase/config.toml').exists():
        return 0
    argv = cli('stop', '--no-backup')
    if run:
        return run.step('supabase-stop', argv, timeout=600)
    return subprocess.run(argv, env=base_env(), capture_output=True, timeout=600).returncode


def project_fresh(run: Run, copy: Path) -> dict[str, str]:
    """Recrea el proyecto propio desde cero: sin volumen anterior, con todas las migraciones del commit."""
    prepare_project(copy)
    if project_stop(run) != 0:
        raise CampaignError('supabase stop falló')
    for port in (API_PORT, DB_PORT):
        if port_busy(port):
            raise CampaignError(f'El puerto {port} sigue ocupado por otro proceso.')
    if run.step('supabase-start', cli('start'), timeout=1800) != 0:
        raise CampaignError('supabase start falló')
    env = project_env()
    run.secrets += [env['JWT_SECRET'], env['PUBLISHABLE_KEY'], env.get('ANON_KEY', ''), env.get('SERVICE_ROLE_KEY', ''),
                    env.get('SECRET_KEY', '')]
    wait_ready(env)
    applied = run.psql('migraciones', 'select version from supabase_migrations.schema_migrations order by version;').split()
    expected = sorted(p.name.split('_', 1)[0] for p in (copy / 'supabase/migrations').glob('*.sql'))
    if applied != expected:
        raise CampaignError('Las migraciones aplicadas no coinciden con las del commit.')
    run.results['migrations'] = applied
    return env


def project_env() -> dict[str, str]:
    result = subprocess.run(cli('status', '-o', 'env'), env=base_env(), capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        raise CampaignError('supabase status falló')
    values = {}
    for line in result.stdout.splitlines():
        key, sep, value = line.partition('=')
        if sep and re.fullmatch(r'[A-Z_]+', key):
            values[key] = value.strip().strip('"')
    guard_env(values)
    write_private(HOME / 'supabase-local.env', ''.join(f'{k}="{v}"\n' for k, v in sorted(values.items())))
    return values


def wait_ready(env: dict[str, str], timeout: int = 300) -> None:
    headers = {'apikey': env['PUBLISHABLE_KEY']}
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if (http(f'{API_URL}/auth/v1/health', headers)[0] == 200
                and http(f'{API_URL}/rest/v1/role?select=id&limit=1', headers)[0] == 200):
            return
        time.sleep(2)
    raise CampaignError('Auth o la Data API del proyecto propio no respondieron 200.')


# ------------------------------------------------------------------ copia compilada y Next propio

def archive_copy(variant: str) -> Path:
    """Copia de lo confirmado (git archive HEAD) con node_modules clonado (APFS); Turbopack no sigue enlaces fuera de la raíz."""
    sha = git('rev-parse', 'HEAD')
    copy = HOME / 'copias' / f'{sha[:12]}-{variant}'
    if (copy / '.listo').exists():
        return copy
    if copy.exists():
        shutil.rmtree(copy)
    copy.mkdir(mode=0o700, parents=True)
    archive = subprocess.run(['git', 'archive', 'HEAD', 'front', 'contracts', 'quality/supabase-testing.json', 'supabase/migrations'],
                             cwd=ROOT, capture_output=True, check=True).stdout
    subprocess.run(['tar', '-x', '-C', str(copy)], input=archive, check=True)
    subprocess.run(['cp', '-Rc', str(ROOT / 'front/node_modules'), str(copy / 'front/node_modules')], check=True)
    if variant == 'sonda':
        # ALIGN-020: la sonda de la campaña 022 se compila SOLO en esta copia; nunca entra en front/app del repositorio.
        shutil.copytree(ROOT / 'front/tests/local-review/probe', copy / 'front/app/align020-probe')
    (copy / '.listo').write_text(sha)
    return copy


def build(run: Run, copy: Path, env: dict[str, str]) -> None:
    public = hashlib.sha256(f"{env['API_URL']}\n{env['PUBLISHABLE_KEY']}".encode()).hexdigest()
    stamp_path = copy / 'front/.next/equitas-campanas-build.json'
    stamp = {'sha': run.sha, 'publico_sha256': public}
    if stamp_path.exists() and json.loads(stamp_path.read_text()) == stamp and (copy / 'front/.next/BUILD_ID').exists():
        run.results.setdefault('builds', []).append({'copy': copy.name, 'reused': True})
        return
    build_env = {'NEXT_PUBLIC_SUPABASE_URL': API_URL, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY': env['PUBLISHABLE_KEY'],
                 'QUALITY_SOURCE_SHA': run.sha}
    if run.step(f'next-build-{copy.name}', ['node', 'node_modules/next/dist/bin/next', 'build'], cwd=copy / 'front', env=build_env,
                timeout=2400) != 0:
        raise CampaignError('next build falló')
    stamp_path.write_text(json.dumps(stamp) + '\n')
    run.results.setdefault('builds', []).append({'copy': copy.name, 'reused': False})


class Next:
    def __init__(self, run: Run, copy: Path, env: dict[str, str], extra: dict[str, str] | None = None):
        if port_busy(APP_PORT):
            raise CampaignError(f'El puerto {APP_PORT} está ocupado.')
        self.review_jwt = mint_jwt(env['JWT_SECRET'], 'equitas_review_server')
        run.secrets.append(self.review_jwt)
        server_env = base_env({'NODE_ENV': 'production', 'NEXT_PUBLIC_SUPABASE_URL': API_URL,
                               'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY': env['PUBLISHABLE_KEY'],
                               'EQUITAS_REVIEW_SERVER_JWT': self.review_jwt, 'QUALITY_SOURCE_SHA': run.sha,
                               'EQUITAS_IMPORT_API_URL': f'http://127.0.0.1:{IMPORT_PORT}', **(extra or {})})
        self.log = (run.raw / f'next-{copy.name}.log').open('w')
        self.process = subprocess.Popen(['node', 'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', str(APP_PORT)],
                                        cwd=copy / 'front', env=server_env, stdout=self.log, stderr=subprocess.STDOUT,
                                        stdin=subprocess.DEVNULL, start_new_session=True)
        write_private(HOME / 'next.pid', str(self.process.pid))
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise CampaignError('next start terminó')
            status, body = http(f'{APP_URL}/api/build-info')
            if status == 200:
                info = json.loads(body)
                if info['sourceSha'] != run.sha or info['supabaseProjectRef'] is not None or info['environment'] != 'local':
                    self.stop()
                    raise CampaignError('build-info inesperado')
                run.results['build_info'] = info
                return
            time.sleep(1)
        self.stop()
        raise CampaignError('next start no respondió')

    def stop(self) -> None:
        if self.process.poll() is None:
            os.killpg(self.process.pid, signal.SIGTERM)
            try:
                self.process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                os.killpg(self.process.pid, signal.SIGKILL)
                self.process.wait()
        self.log.close()
        with contextlib.suppress(FileNotFoundError):
            (HOME / 'next.pid').unlink()


def stop_orphan_next() -> bool:
    """Un Next propio que quedó de una corrida interrumpida: solo si su pid está en el archivo propio y su cwd es una copia propia."""
    pid_file = HOME / 'next.pid'
    if not pid_file.exists():
        return False
    pid = int(pid_file.read_text())
    cwd = subprocess.run(['lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'], capture_output=True, text=True).stdout
    if str(HOME / 'copias') in cwd:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(pid, signal.SIGTERM)
    pid_file.unlink()
    return True


# ------------------------------------------------------------------ fixtures compartidas

def load_accounts(run: Run, include_e06: bool = True) -> list[str]:
    """Cuentas E06 (tal cual) y de ALIGN-018 (migradas a ADMIN/USER). Devuelve líneas `etiqueta|correo|contraseña`."""
    lines: list[str] = []
    if include_e06:
        out = run.psql('auth-e06', (ROOT / 'database/testing/create-auth-fixtures.sql').read_bytes())
        lines += [f'tp-e06-{p[0]}|{p[2]}|{p[3]}' for line in out.splitlines() if len(p := line.split('|')) == 4]
        run.psql_file('data-e06', 'database/testing/fixtures.sql')
    out = run.psql_file('auth-review', 'database/testing/case-review-auth-fixtures.sql')
    lines += [line for line in out.splitlines() if line.count('|') == 2]
    run.psql_file('data-review', 'database/testing/case-review-fixtures.sql')
    run.secrets += [part for line in lines for part in line.split('|')[1:]]
    return lines


# ------------------------------------------------------------------ campañas

def campaign_reportes(run: Run) -> int:
    copy = archive_copy('normal')
    env = project_fresh(run, copy)
    build(run, copy, env)
    lines = load_accounts(run)
    run.psql_file('fixture-028', 'front/tests/local-reports/fixture.sql')
    expected = run.psql_file('expected-028', 'front/tests/local-reports/expected.sql')
    psv = write_private(run.raw / 'credentials-028.psv', '\n'.join(lines) + '\n')
    expected_path = write_private(run.raw / 'expected-028.json', expected)
    server = Next(run, copy, env)
    try:
        http_dir = run.raw / 'http-028'
        code = run.step('028-http', ['node', str(ROOT / 'front/tests/local-reports/run-http.mjs'), str(psv), APP_URL, str(http_dir)],
                        cwd=copy / 'front', timeout=900)
        if code == 0:
            code = run.step('028-verify', [SYSTEM_PYTHON, '-I', str(ROOT / 'front/tests/local-reports/verify_reports.py'), str(http_dir),
                                           str(expected_path)], timeout=600)
    finally:
        server.stop()
    run.results['outcome'] = code
    return code


# Esperados de case-review-verify.sql (tabla de SUPABASE_TESTING_CALIDAD.md, ALIGN-018/020; solo metadatos y conteos).
VERIFY_EXPECTED = {
    'tablas_nuevas': '3', 'tablas_nuevas_con_rls': '3', 'tablas_nuevas_sin_rls': '0', 'politicas_nuevas': '3',
    'politicas_nuevas_using_true': '0', 'politicas_nuevas_no_select': '0', 'politicas_nuevas_anon_o_public': '0',
    'politicas_nuevas_sin_tenant': '0', 'privilegios_escritura_clientes': '0', 'secuencias_nuevas_privilegios_clientes': '0',
    'reason_text_legible_por_clientes': '0', 'columnas_case_review_legibles_authenticated': '19', 'funciones_security_definer': '4',
    'funciones_sin_search_path_vacio': '0', 'funciones_definer_dueno_definidor': '4', 'funciones_cubiertas_por_la_verificacion': '8',
    'firmas_de_escritura_de_revision': '2', 'corte_parametro_obligatorio': '2', 'funciones_ejecutables_public': '0',
    'funciones_ejecutables_anon_authenticated_service': '0', 'funciones_servidor_revision': '3', 'funciones_servidor_importacion': '1',
    'grants_columna_definidor_en_existentes': '12', 'grants_columna_clientes_en_existentes': '0',
    'privilegios_definidor_distintos_de_insert': '0', 'definidor_miembros_con_set_o_inherit': '0',
    'roles_nuevos_miembros_con_set_o_inherit': 'equitas_import_server>authenticator,equitas_review_server>authenticator',
    'roles_nuevos_miembros_con_admin_option': 'equitas_import_server>postgres,equitas_review_server>postgres,equitas_write_definer>postgres',
    'restricciones_supersedes_anterior': '3', 'filas_con_cadena_invalida': '0',
    'restricciones_reason_text': 'case_review_reason_text_length,case_review_reason_text_not_blank,case_review_reason_text_requires_code',
    'roles_servidor_con_login_o_bypass': '0', 'rol_definidor_con_login_o_super': '0', 'definidor_create_en_public': '0',
    'filas_nuevas_total': '0',
}


def campaign_decisiones(run: Run) -> int:
    """case-review-checks.sql (transacción con ROLLBACK), case-review-verify.sql (metadatos) y case_review_local.py http-check."""
    copy = archive_copy('normal')
    project_fresh(run, copy)
    lines = load_accounts(run, include_e06=False)
    write_private(HOME / 'case-review-credentials.psv', '\n'.join(lines) + '\n')
    outcome = {}
    try:
        checks = run.psql_file('case-review-checks', 'database/testing/case-review-checks.sql', user='supabase_admin')
        rows = [line.split('|') for line in checks.splitlines() if line.count('|') == 3 and not line.startswith('TOTAL|')]
        failed = [r for r in rows if r[3] != 'OK']
        outcome['checks_sql'] = {'casos': len(rows), 'fallas': len(failed),
                                 'casos_n7': sum(r[0].startswith('N7:') for r in rows)}
        print(f'[decisiones] case-review-checks: casos={len(rows)} fallas={len(failed)}', flush=True)
    except CampaignError:
        failed_lines = [line for line in (run.raw / 'case-review-checks.out').read_text(errors='replace').splitlines() if 'FALLA' in line]
        outcome['checks_sql'] = {'error': True, 'fallas': failed_lines}
        print('[decisiones] case-review-checks FALLAS:\n    ' + '\n    '.join(failed_lines), flush=True)
    verify = dict(line.split('|', 1) for line in run.psql_file('case-review-verify', 'database/testing/case-review-verify.sql').splitlines()
                  if '|' in line)
    broken = {key: verify.get(key) for key, value in VERIFY_EXPECTED.items() if verify.get(key) != value}
    outcome['verify_sql'] = {'filas': len(verify), 'esperados_comparados': len(VERIFY_EXPECTED), 'distintos': broken,
                             'valores': {k: v for k, v in verify.items() if not k.endswith('_md5')}}
    print(f'[decisiones] case-review-verify: {len(verify)} filas; {len(VERIFY_EXPECTED)} esperados; distintos: {broken}', flush=True)
    code = run.step('case-review-http-check', [str(PYTHON), 'database/testing/case_review_local.py', 'http-check'], timeout=600)
    log = (run.dir / 'case-review-http-check.log').read_text()
    total = re.search(r'^TOTAL\|(\d+)\|FALLAS\|(\d+)$', log, flags=re.MULTILINE)
    outcome['http_check'] = {'exit': code, 'casos': int(total.group(1)) if total else None, 'fallas': int(total.group(2)) if total else None,
                             'detalle_fallas': [line for line in log.splitlines() if line.endswith('|FALLA')]}
    unit = run.step('test-review-integration', [str(PYTHON), '-m', 'unittest', 'database/testing/test_review_integration.py'], timeout=600)
    unit_log = (run.dir / 'test-review-integration.log').read_text()
    ran = re.search(r'Ran (\d+) tests?', unit_log)
    outcome['unittest_runner'] = {'exit': unit, 'pruebas': int(ran.group(1)) if ran else None}
    run.results['outcome'] = outcome
    ok = (outcome['checks_sql'].get('fallas') == 0 and not outcome['checks_sql'].get('error') and not broken and code == 0 and unit == 0)
    return 0 if ok else 1


def git_show(path: str) -> bytes:
    return subprocess.check_output(['git', 'show', f'HEAD:{path}'], cwd=ROOT)


def campaign_e06(run: Run) -> int:
    """E06 + SMOKE-01: ADAPTACIÓN LOCAL DECLARADA (encargo 10.7). No reemplaza la campaña remota.

    Mismos casos de quality/supabase_integration.py (front/tests/external) y el recorrido SMOKE-01, en una carpeta temporal cuya
    copia de quality/supabase-testing.json solo cambia `url` y `project_ref` hacia este proyecto. Los originales no se tocan.
    """
    copy = archive_copy('normal')
    env = project_fresh(run, copy)
    build(run, copy, env)
    out = run.psql('auth-e06', (ROOT / 'database/testing/create-auth-fixtures.sql').read_bytes())
    run.psql_file('data-e06', 'database/testing/fixtures.sql')
    accounts = {p[0]: {'email': p[2], 'password': p[3]} for line in out.splitlines() if len(p := line.split('|')) == 4}
    run.secrets += [a['password'] for a in accounts.values()]
    e06 = {'url': API_URL, 'publishableKey': env['PUBLISHABLE_KEY'], 'accounts': accounts}
    e06_path = write_private(run.raw / 'e06-config.json', json.dumps(e06))
    harness = run.raw / 'e06-harness'
    for folder in ('front/tests/external', 'front/tests/smoke', 'quality'):
        (harness / folder).mkdir(parents=True)
    provenance = {}
    # Las pruebas E06 y la política, tal cual están confirmadas (HEAD). SMOKE-01 desde el árbol de trabajo: sus textos se
    # actualizaron en este encargo a las pantallas actuales (mismas cinco comprobaciones).
    for name in ('front/tests/external/supabase.integration.test.ts', 'front/tests/external/setup.ts', 'quality/preview-policy.json'):
        data = git_show(name)
        (harness / name).write_bytes(data)
        provenance[name] = {'origen': 'HEAD', 'sha256': hashlib.sha256(data).hexdigest()}
    smoke = (ROOT / 'front/tests/smoke/deployed-smoke.mjs').read_bytes()
    (harness / 'front/tests/smoke/deployed-smoke.mjs').write_bytes(smoke)
    provenance['front/tests/smoke/deployed-smoke.mjs'] = {'origen': 'árbol de trabajo (textos actualizados)',
                                                          'sha256': hashlib.sha256(smoke).hexdigest(),
                                                          'igual_a_HEAD': smoke == git_show('front/tests/smoke/deployed-smoke.mjs')}
    policy = json.loads(git_show('quality/supabase-testing.json'))
    policy.update(url=API_URL, project_ref=None)
    (harness / 'quality/supabase-testing.json').write_text(json.dumps(policy))
    (harness / 'front/node_modules').symlink_to(copy / 'front/node_modules', target_is_directory=True)
    config = {'resolve': {'alias': {'@': str(copy / 'front')}}, 'test': {'environment': 'node', 'include': ['tests/external/**/*.test.ts'],
              'setupFiles': ['tests/external/setup.ts'], 'fileParallelism': False, 'testTimeout': 30000, 'hookTimeout': 30000,
              'reporters': ['default', 'junit'], 'outputFile': {'junit': str(run.dir / 'e06-junit.xml')}}}
    (harness / 'front/vitest.e06.config.mjs').write_text("import {defineConfig} from 'vitest/config'; export default defineConfig("
                                                         + json.dumps(config) + ');\n')
    run.results['e06_provenance'] = {'adaptacion_local_declarada': True, 'archivos': provenance,
                                     'cambios_temporales_de_politica': {'url': API_URL, 'project_ref': None},
                                     'fuentes_del_repositorio_sin_modificar': ['quality/supabase_integration.py', 'quality/supabase-testing.json',
                                                                              'database/testing/fixtures.sql']}
    server = Next(run, copy, env)
    try:
        e06_code = run.step('e06-vitest', ['node', 'node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.e06.config.mjs'],
                            cwd=harness / 'front', env={'SUPABASE_TEST_CONFIG': json.dumps(e06)}, timeout=900)
        smoke_dir = run.dir / 'smoke01'
        smoke_code = run.step('smoke01', ['node', 'tests/smoke/deployed-smoke.mjs', '--local', '--url', APP_URL + '/', '--sha', run.sha,
                                          '--output', str(smoke_dir), '--config-file', str(e06_path)], cwd=harness / 'front', timeout=900)
        # Variante DECLARADA, solo diagnóstica: las fixtures E06 no traen ningún lote PUBLICADO y la aplicación muestra el
        # municipio «sin cartera cargada» aunque tenga objetos y deudas. Con un lote publicado sintético se comprueba el resto
        # del recorrido. No reemplaza el resultado de arriba.
        run.psql('e06-lote-publicado-variante', """insert into public.import_batch(tenant, source, file_hashes, as_of, rules_version,
          status, created_by, created_by_role, idempotency_key) values (910001, 'FIXTURE', jsonb_build_object('cartera', repeat('e', 64)),
          '2026-01-31', '1.1.0', 'PUBLICADO', 910001, 'tp_operator', gen_random_uuid());""")
        variant_dir = run.dir / 'smoke01-variante-con-lote'
        variant_code = run.step('smoke01-variante-con-lote', ['node', 'tests/smoke/deployed-smoke.mjs', '--local', '--url', APP_URL + '/', '--sha',
                                                             run.sha, '--output', str(variant_dir), '--config-file', str(e06_path)],
                                cwd=harness / 'front', timeout=900)
    finally:
        server.stop()
    junit = (run.dir / 'e06-junit.xml').read_text() if (run.dir / 'e06-junit.xml').exists() else ''
    counts = re.search(r'<testsuites[^>]*tests="(\d+)"[^>]*failures="(\d+)"[^>]*errors="(\d+)"', junit)
    skipped = len(re.findall(r'<skipped', junit))
    smoke_report = json.loads((smoke_dir / 'smoke.json').read_text()) if (smoke_dir / 'smoke.json').exists() else {}
    run.results['outcome'] = {'e06': {'exit': e06_code, 'pruebas': int(counts.group(1)) if counts else None,
                                      'fallas': int(counts.group(2)) + int(counts.group(3)) if counts else None, 'omitidas': skipped},
                              'smoke01': {'exit': smoke_code, 'aprobado': smoke_report.get('passed'),
                                          'comprobaciones': [c['id'] for c in smoke_report.get('checks', [])],
                                          'errores': [run.redact(e) for e in smoke_report.get('errors', [])],
                                          'errores_consola': len(smoke_report.get('console_errors', [])) + len(smoke_report.get('page_errors', []))}}
    variant = json.loads((variant_dir / 'smoke.json').read_text()) if (variant_dir / 'smoke.json').exists() else {}
    run.results['outcome']['smoke01_variante_con_lote'] = {
        'exit': variant_code, 'aprobado': variant.get('passed'), 'comprobaciones': [c['id'] for c in variant.get('checks', [])],
        'errores': [run.redact(e) for e in variant.get('errors', [])], 'declarada': 'diagnóstico; no reemplaza SMOKE-01'}
    return 0 if e06_code == 0 and smoke_code == 0 and skipped == 0 else 1


REVIEW_OVERLAY = ('front/tests/local-review', 'front/tests/external-review', 'database/testing/review_integration.py')


def campaign_revision(run: Run) -> int:
    """022: campaña de revisión por HTTP (runner database/testing/review_integration.py) contra la copia con la sonda ALIGN-020.

    La copia es lo confirmado (git archive HEAD) más, DECLARADO, los archivos de campaña de este encargo aún sin confirmar
    (REVIEW_OVERLAY). El runner exige SHA y árbol limpio: en la copia, un `git` mínimo responde el SHA real y un estado vacío.
    """
    copy = archive_copy('sonda')
    env = project_fresh(run, copy)
    build(run, copy, env)
    overlay = {}
    for relative in REVIEW_OVERLAY:
        source, target = ROOT / relative, copy / relative
        if source.is_dir():
            shutil.rmtree(target, ignore_errors=True)
            shutil.copytree(source, target, ignore=shutil.ignore_patterns('__pycache__'))
            files = sorted(f for f in target.rglob('*') if f.is_file())
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            files = [target]
        for f in files:
            name = str(f.relative_to(copy))
            committed = subprocess.run(['git', 'show', f'HEAD:{name}'], cwd=ROOT, capture_output=True).stdout
            overlay[name] = {'sha256': hashlib.sha256(f.read_bytes()).hexdigest(), 'igual_a_HEAD': f.read_bytes() == committed}
    run.results['revision_overlay'] = {'declarado': 'archivos de campaña del árbol de trabajo superpuestos a git archive HEAD',
                                       'archivos': overlay}
    lines = load_accounts(run, include_e06=False)
    run.psql_file('fixture-local-review', 'front/tests/local-review/fixture.sql')
    lines += [line for line in run.psql_file('fixture-external-review', 'front/tests/external-review/fixture.sql').splitlines()
              if line.count('|') == 2]
    run.secrets += [part for line in lines for part in line.split('|')[1:]]
    psv = write_private(run.raw / 'credentials-022.psv', '\n'.join(lines) + '\n')
    for role in ('equitas_review_server', 'equitas_import_server'):
        token = mint_jwt(env['JWT_SECRET'], role)
        run.secrets.append(token)
        write_private(HOME / f'{role}.jwt', token)
    config_path = HOME / 'review-config.json'
    config_path.unlink(missing_ok=True)
    if run.step('022-prepare-config', ['node', 'tests/local-review/prepare-config.mjs', str(psv), str(config_path)], cwd=copy / 'front') != 0:
        raise CampaignError('prepare-config falló')
    shim = HOME / 'git-shim'
    shim.mkdir(mode=0o700, exist_ok=True)
    write_private(shim / 'git', f"""#!/bin/sh
# Solo para la copia de la campaña 022: el SHA real de lo confirmado; la copia no tiene cambios propios.
if [ "$1" = "rev-parse" ] && [ "$2" = "HEAD" ]; then echo {run.sha}; exit 0; fi
if [ "$1" = "status" ]; then exit 0; fi
echo "git (campañas): comando no previsto" >&2; exit 2
""")
    os.chmod(shim / 'git', 0o700)
    run.results['revision_git_shim'] = {'rev-parse HEAD': run.sha, 'status --porcelain': '(vacío: copia = HEAD + superposición declarada)'}
    shim_path = {'PATH': f'{shim}:{NPM_BIN}:' + os.environ.get('PATH', '')}
    server = Next(run, copy, env)
    output = run.dir / 'campaign022'
    try:
        command = [str(PYTHON), 'database/testing/review_integration.py']
        code = run.step('022-run', command + ['run', '--output', str(output), '--config-file', str(config_path), '--http-base', APP_URL],
                        cwd=copy, env=shim_path, timeout=1800)
        validate = run.step('022-validate', command + ['validate', '--report', str(output / 'review.json'), '--sha', run.sha],
                            cwd=copy, env=shim_path, timeout=300)
    finally:
        server.stop()
    report = json.loads((output / 'review.json').read_text()) if (output / 'review.json').exists() else {}
    cases = report.get('cases', [])
    run.results['outcome'] = {'run_exit': code, 'validate_exit': validate, 'tests': report.get('tests'),
                              'fallidos': [c['name'][:160] for c in cases if c.get('status') != 'passed'],
                              'rechazos_del_runner': report.get('rejections') or report.get('errors')}
    return 0 if code == 0 and validate == 0 else 1


# Tandas de back/tests_real: cada una sobre el proyecto recreado (sus semillas son excluyentes entre sí).
IMPORT_GROUPS = {
    'carga': ['tests_real/test_import_load_real.py'],
    'api': ['tests_real/test_imports_api.py'],
    'next': ['tests_real/test_next_route.py'],
    'etl-publicacion': ['tests_real/test_etl_v1_load.py', 'tests_real/test_import_publish.py'],
    'stage-reintento': ['tests_real/test_import_stage_retry.py'],
    'prevalidacion': ['tests_real/test_prevalidate.py'],
    'tope-de-bloqueo': ['tests_real/test_import_lock_budget.py'],
    'escala': ['tests_real/test_import_publish_scale.py', 'tests_real/test_prevalidate_scale.py'],
}
DEFAULT_IMPORT_GROUPS = ('carga', 'api', 'next', 'etl-publicacion', 'stage-reintento', 'prevalidacion', 'tope-de-bloqueo')
SELECTED_IMPORT_GROUPS: list[str] = list(DEFAULT_IMPORT_GROUPS)


def campaign_importacion(run: Run) -> int:
    """back/tests_real contra la base real del proyecto propio. El código de producto de back/ es el confirmado (se verifica
    que back/api, back/services y back/ETL no tengan cambios); las pruebas son las de este encargo. La ruta de Next
    (test_next_route) compila y sirve una copia propia (EQUITAS_E2E_FRONT), nunca front/.next."""
    product_changes = git('status', '--porcelain', '--', 'back/api', 'back/services', 'back/ETL', 'front/public/ejemplos', 'contracts')
    if product_changes:
        raise CampaignError('Hay cambios sin confirmar en el código de producto de back/: no se corre sobre lo no confirmado.')
    copy = archive_copy('normal')
    e2e_front = archive_copy('importacion') / 'front'
    outcome = {}
    for group in SELECTED_IMPORT_GROUPS:
        project_fresh(run, copy)
        lock = HOME / 'lock'
        lock.mkdir(mode=0o700, exist_ok=True)
        junit = run.dir / f'tests-real-{group}.xml'
        try:
            code = run.step(f'tests-real-{group}', [str(PYTHON), '-m', 'pytest', *IMPORT_GROUPS[group], '-q', '-p', 'no:cacheprovider',
                                                     '--junitxml', str(junit)],
                            cwd=ROOT / 'back', env={'EQUITAS_E2E_FRONT': str(e2e_front), 'EQUITAS_E2E_WEBPACK': '0', 'PYTEST_ADDOPTS': '--tb=short'}, timeout=3600)
        finally:
            shutil.rmtree(lock, ignore_errors=True)
        xml = junit.read_text() if junit.exists() else ''
        found = re.search(r'<testsuite [^>]*errors="(\d+)" failures="(\d+)" skipped="(\d+)" tests="(\d+)"', xml)
        failed_names = re.findall(r'<testcase classname="([^"]+)" name="([^"]+)"[^>]*>\s*<(?:failure|error)', xml)
        outcome[group] = {'exit': code, 'pruebas': int(found.group(4)) if found else None,
                          'fallas': int(found.group(1)) + int(found.group(2)) if found else None,
                          'omitidas': int(found.group(3)) if found else None,
                          'fallidas': [f'{c}::{n}' for c, n in failed_names]}
        print(f'[importacion] {group}: {outcome[group]}', flush=True)
    run.results['outcome'] = outcome
    return 0 if all(v['exit'] == 0 for v in outcome.values()) else 1


CONTROL_SHA = 'f0fb8f8'  # entrega V1 de la noche 6 (antes de ADMIN/USER y de las reglas 1.1.0); 4c65dc1 no importa su ETL


def campaign_control_etl(run: Run) -> int:
    """Control negativo para atribuir las fallas de tests_real/test_etl_v1_load.py: la misma tanda sobre CONTROL_SHA (código,
    migraciones y pruebas de ese commit), con el conftest.py parametrizado de este encargo superpuesto (DECLARADO: el de ese
    commit solo apunta al stack de la noche 6). Proyecto propio recreado; no toca el árbol de trabajo."""
    sha = git('rev-parse', CONTROL_SHA)
    copy = HOME / 'copias' / f'{sha[:12]}-control'
    if not (copy / '.listo').exists():
        shutil.rmtree(copy, ignore_errors=True)
        copy.mkdir(mode=0o700, parents=True)
        archive = subprocess.run(['git', 'archive', sha, 'back', 'supabase/migrations', 'database', 'contracts', 'quality', 'front/public'],
                                 cwd=ROOT, capture_output=True, check=True).stdout
        subprocess.run(['tar', '-x', '-C', str(copy)], input=archive, check=True)
        (copy / '.listo').write_text(sha)
    shutil.copyfile(ROOT / 'back/tests_real/conftest.py', copy / 'back/tests_real/conftest.py')
    run.results['control'] = {'sha': sha, 'superpuesto': {'back/tests_real/conftest.py': hashlib.sha256(
        (ROOT / 'back/tests_real/conftest.py').read_bytes()).hexdigest()}}
    project_fresh(run, copy)
    lock = HOME / 'lock'
    lock.mkdir(mode=0o700, exist_ok=True)
    junit = run.dir / 'control-etl.xml'
    try:
        code = run.step('control-etl', [str(PYTHON), '-m', 'pytest', 'tests_real/test_etl_v1_load.py', '-q', '-p', 'no:cacheprovider',
                                        '--junitxml', str(junit)], cwd=copy / 'back', env={'PYTEST_ADDOPTS': '--tb=short'}, timeout=3600)
    finally:
        shutil.rmtree(lock, ignore_errors=True)
    xml = junit.read_text() if junit.exists() else ''
    found = re.search(r'<testsuite [^>]*errors="(\d+)" failures="(\d+)" skipped="(\d+)" tests="(\d+)"', xml)
    run.results['outcome'] = {'exit': code, 'pruebas': int(found.group(4)) if found else None,
                              'fallas': int(found.group(1)) + int(found.group(2)) if found else None,
                              'fallidas': [n for _, n in re.findall(r'<testcase classname="([^"]+)" name="([^"]+)"[^>]*>\s*<(?:failure|error)', xml)]}
    print(f"[control-etl] {run.results['outcome']}", flush=True)
    return code


CAMPAIGNS = {'reportes': campaign_reportes, 'e06': campaign_e06, 'decisiones': campaign_decisiones, 'revision': campaign_revision,
             'importacion': campaign_importacion}
EXTRA = {'control-etl': campaign_control_etl}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('comando', choices=[*CAMPAIGNS, *EXTRA, 'todas', 'detener'])
    parser.add_argument('--conservar', action='store_true', help='no detiene el proyecto propio al terminar (depuración)')
    parser.add_argument('--tandas', help=f'importacion: tandas separadas por coma ({", ".join(IMPORT_GROUPS)}); por defecto '
                        f'{",".join(DEFAULT_IMPORT_GROUPS)}')
    args = parser.parse_args(argv)
    if args.tandas:
        chosen = [name.strip() for name in args.tandas.split(',') if name.strip()]
        if not chosen or set(chosen) - set(IMPORT_GROUPS):
            parser.error('tanda desconocida')
        SELECTED_IMPORT_GROUPS[:] = chosen
    guard()
    os.umask(0o077)
    if args.comando == 'detener':
        stop_orphan_next()
        return project_stop(None)
    names = list(CAMPAIGNS) if args.comando == 'todas' else [args.comando]
    summary = {}
    try:
        for name in names:
            run = Run(name)
            try:
                summary[name] = {**CAMPAIGNS, **EXTRA}[name](run)
            except CampaignError as error:
                run.results['error'] = str(error)
                summary[name] = f'error: {error}'
                print(f'[{name}] ERROR {error}', flush=True)
            finally:
                print(f'[{name}] evidencia: {run.save()}', flush=True)
    finally:
        stop_orphan_next()
        if not args.conservar:
            project_stop(None)
    print(json.dumps(summary, ensure_ascii=False))
    return 0 if all(value == 0 for value in summary.values()) else 1


if __name__ == '__main__':
    sys.exit(main())
