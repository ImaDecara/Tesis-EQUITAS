"""Entorno local completo de EQUITAS (noche 7): Supabase local propio, servicio de importación y aplicación.

Comandos (desde la raíz del repositorio, con el Python del backend):
  back/.venv/bin/python scripts/local/equitas_local.py start    arranca todo; crea lo que falte y nunca borra
  back/.venv/bin/python scripts/local/equitas_local.py stop     detiene la app, el servicio de importación y Supabase
  back/.venv/bin/python scripts/local/equitas_local.py status   estado, solo lectura
  back/.venv/bin/python scripts/local/equitas_local.py vaciar --confirmar equitas-n7-local
                                                                borra SOLO la base de este entorno, para repetir la prueba

QUIÉN AUTENTICA: el servicio de autenticación del Supabase LOCAL de este entorno, con cuentas sintéticas.
QUÉ BASE RECIBE LOS ARCHIVOS: navegador -> aplicación en 127.0.0.1 -> servicio de importación local -> base LOCAL.
Producción no interviene: el cargador rechaza cualquier destino que no sea local (back/ETL/config.py).

Es un proyecto Supabase local PROPIO (otro identificador, otros puertos y otra carpeta privada que la demo de
la noche 6). Este script se niega a operar sobre el proyecto o la carpeta de esa demo. El único comando que borra
es «vaciar», que exige escribir el identificador de este entorno y solo alcanza a su propia base sintética.

Todo lo privado (claves locales, contraseñas, credenciales de servidor, logs) vive en EQUITAS_LOCAL_HOME
(por defecto ~/.equitas-n7, modo 0700, archivos 0600), fuera del repositorio. Nada secreto se imprime.
Guía: docs/entrega/noche-7/PRUEBA-MANUAL.md.
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
import secrets
import shutil
import signal
import socket
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
FRONT = ROOT / 'front'
BACK = ROOT / 'back'
CLI = ('npx', '--yes', 'supabase@2.108.0')
PROJECT_ID = 'equitas-n7-local'
DB_CONTAINER = f'supabase_db_{PROJECT_ID}'
API_PORT, DB_PORT, SHADOW_PORT = 55321, 55322, 55320
APP_PORT, IMPORT_PORT = 3100, 8765
# La demo de la noche 6 se conserva: este script no opera sobre su proyecto ni sobre su carpeta privada.
FORBIDDEN_PROJECT_IDS = ('equitas-tp-testing',)
FORBIDDEN_HOMES = ('.equitas-demo',)
LOOPBACK = ('127.0.0.1', 'localhost')
REMOTE_MARKERS = ('supabase.co', 'folyslqzqvnpolexcxjo', 'iylwghgvtydpmwidojdo')
SEED = ROOT / 'database/local/n7-seed.sql'
TENANT_A, TENANT_B = 'Municipio sintético A', 'Municipio sintético B'
UNRECOGNIZED_ROLE = 'ROL_DE_PRUEBA_NO_RECONOCIDO'
DEFAULT_JWT_HOURS = 72
MAX_JWT_HOURS = 72
RENEW_MARGIN = timedelta(hours=6)
SECRET_PATTERNS = (
    re.compile(r'eyJ[\w-]+\.[\w-]+\.[\w-]+'),
    re.compile(r'sb_(?:secret|publishable)_[\w-]+'),
    re.compile(r'\b[0-9a-fA-F]{32,}\b'),
)
SECRET_ASSIGNMENT = re.compile(r'(?i)((?:secret|key|password|token)[^:=\n]{0,40}[:=][ \t]*)\S+')

# Cuentas de prueba (son cuentas, no roles): (clave, correo, nombre visible, rol, municipio, membresía activa).
ACCOUNTS = (
    ('admin-a', 'n7-admin-a@example.test', 'Admin A (cuenta sintética)', 'ADMIN', TENANT_A, True),
    ('admin-b', 'n7-admin-b@example.test', 'Admin B (cuenta sintética)', 'ADMIN', TENANT_A, True),
    ('user', 'n7-user@example.test', 'Usuario (cuenta sintética)', 'USER', TENANT_A, True),
    ('user-otro-municipio', 'n7-user-otro-municipio@example.test', 'Usuario del municipio B (sintética)', 'USER', TENANT_B, True),
    ('sin-membresia', 'n7-sin-membresia@example.test', 'Cuenta sin membresía (sintética)', None, None, None),
    ('membresia-inactiva', 'n7-membresia-inactiva@example.test', 'Cuenta con membresía inactiva (sintética)', 'USER', TENANT_A, False),
    ('rol-no-reconocido', 'n7-rol-no-reconocido@example.test', 'Cuenta con rol no reconocido (sintética)', UNRECOGNIZED_ROLE, TENANT_A, True),
)
EXPECTED = {
    'admin-a': 'entra; lee todo y además carga CSV, registra y aprueba decisiones y ve los reportes de supervisión y accesos',
    'admin-b': 'igual que admin-a; es la otra persona que aprueba las propuestas de admin-a',
    'user': 'entra y lee lo mismo que admin-a; no carga, no registra decisiones y no ve supervisión ni accesos',
    'user-otro-municipio': 'entra a su municipio (B, sin cartera); no ve la cartera del municipio A',
    'sin-membresia': 'no entra: mensaje con el próximo paso',
    'membresia-inactiva': 'no entra: mensaje con el próximo paso',
    'rol-no-reconocido': 'no entra: mensaje con el próximo paso',
}


class LocalError(RuntimeError):
    """Mensaje fijo para la persona; nunca incluye valores privados."""


def utc_now() -> datetime:
    return datetime.now(UTC)


def say(message: str = '') -> None:
    print(message, flush=True)


# ------------------------------------------------------------------ carpeta privada y guardias

def local_home() -> Path:
    home = Path(os.environ.get('EQUITAS_LOCAL_HOME') or Path.home() / '.equitas-n7').expanduser().absolute()
    if home.is_symlink():
        raise LocalError('EQUITAS_LOCAL_HOME no puede ser un enlace simbólico.')
    resolved = home.resolve()
    if resolved == ROOT.resolve() or ROOT.resolve() in resolved.parents:
        raise LocalError('La carpeta privada no puede estar dentro del repositorio.')
    if any(part in FORBIDDEN_HOMES for part in resolved.parts):
        raise LocalError('DETENERSE: esa carpeta es la de la demo de la noche 6, que se conserva. Usá otra.')
    home.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(home, 0o700)
    if home.stat().st_uid != os.getuid():
        raise LocalError('La carpeta privada del entorno pertenece a otro usuario.')
    for sub in ('run', 'logs', 'importaciones', 'proyecto'):
        (home / sub).mkdir(mode=0o700, exist_ok=True)
        os.chmod(home / sub, 0o700)
    return home


def write_private(path: Path, text: str) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, stat.S_IRUSR | stat.S_IWUSR)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
        handle.write(text)
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)


def private_log(home: Path, name: str) -> Path:
    path = home / 'logs' / f'{utc_now().strftime("%Y%m%dT%H%M%SZ")}-{name}.log'
    write_private(path, '')
    return path


def guard_environment(environ: dict[str, str] | None = None) -> None:
    values = os.environ if environ is None else environ
    if any(marker in value.casefold() for value in values.values() for marker in REMOTE_MARKERS):
        raise LocalError('DETENERSE: una variable de entorno nombra un proyecto Supabase remoto (no se muestra cuál ni su valor).')
    if PROJECT_ID in FORBIDDEN_PROJECT_IDS:
        raise LocalError('DETENERSE: el identificador del proyecto es el de la demo de la noche 6.')


def check_api_url(url: str) -> str:
    parts = urlsplit(url)
    if (parts.scheme != 'http' or parts.hostname not in LOOPBACK or parts.username or parts.password
            or parts.path not in ('', '/') or parts.port != API_PORT):
        raise LocalError('DETENERSE: la API de Supabase no es la de este entorno local.')
    return url.rstrip('/')


def parse_env(text: str) -> dict[str, str]:
    values = {}
    for line in text.splitlines():
        name, separator, value = line.strip().partition('=')
        if separator and name:
            values[name] = value.strip().strip('"')
    return values


# ------------------------------------------------------------------ procesos

def known_secrets(home: Path | None) -> tuple[str, ...]:
    values: list[str] = []
    with contextlib.suppress(Exception):
        if home and (home / 'supabase-local.env').exists():
            values += [value for key, value in parse_env((home / 'supabase-local.env').read_text()).items()
                       if not value.startswith(('http://', 'postgresql://postgres:postgres@'))]
        if home and (home / 'cuentas.json').exists():
            values += [entry.get('password') or '' for entry in json.loads((home / 'cuentas.json').read_text()).values()]
    return tuple(value for value in values if value)


def redact_text(text: str, extra: tuple[str, ...] | list[str] = ()) -> str:
    for value in sorted({value for value in extra if value and len(value) >= 6}, key=len, reverse=True):
        text = text.replace(value, '[privado]')
    for pattern in SECRET_PATTERNS:
        text = pattern.sub('[privado]', text)
    return SECRET_ASSIGNMENT.sub(r'\1[privado]', text)


def run(command: list[str] | tuple[str, ...], *, cwd: Path = ROOT, env: dict[str, str] | None = None,
        timeout: int = 120, log: Path | None = None, stdin: str | None = None,
        home: Path | None = None) -> subprocess.CompletedProcess:
    """Ejecuta sin shell. Con log, la salida va saneada a ese archivo privado. Mata el grupo si vence."""
    process = subprocess.Popen(command, cwd=cwd, env=env, text=True, start_new_session=True,
                               stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        out, err = process.communicate(stdin, timeout=timeout)
    except subprocess.TimeoutExpired:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGKILL)
        process.communicate()
        raise LocalError(f'Tiempo máximo agotado ({timeout} s): {command[0]} {command[1] if len(command) > 1 else ""}'.strip())
    if log:
        write_private(log, redact_text((out or '') + (err or ''), known_secrets(home)))
        return subprocess.CompletedProcess(command, process.returncode, '', '')
    return subprocess.CompletedProcess(command, process.returncode, out or '', err or '')


def cli_env() -> dict[str, str]:
    env = dict(os.environ)
    env.update(DO_NOT_TRACK='1', SUPABASE_TELEMETRY_DISABLED='1')
    return env


def cli(home: Path, *args: str) -> list[str]:
    return [*CLI, '--workdir', str(home / 'proyecto'), *args]


def docker_ready() -> bool:
    return shutil.which('docker') is not None and run(['docker', 'info'], timeout=60).returncode == 0


def stack_running() -> bool:
    result = run(['docker', 'inspect', '-f', '{{.State.Running}}', DB_CONTAINER], timeout=60)
    return result.returncode == 0 and result.stdout.strip() == 'true'


def http_status(url: str, headers: dict[str, str] | None = None, timeout: float = 10) -> int | None:
    request = urllib.request.Request(url, headers=headers or {})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(request, timeout=timeout) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code
    except (urllib.error.URLError, OSError):
        return None


def port_busy(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(1)
        return probe.connect_ex(('127.0.0.1', port)) == 0


# ------------------------------------------------------------------ proyecto Supabase local propio

CONFIG_TOML = f'''# Generado por scripts/local/equitas_local.py. Proyecto LOCAL propio de la noche 7; no es el de la demo de la noche 6.
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
site_url = "http://127.0.0.1:{APP_PORT}"
enable_signup = false

# Servicios que la aplicación no usa: apagados para no competir por puertos ni memoria con otros proyectos locales.
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


def prepare_project(home: Path) -> None:
    """Carpeta de trabajo de la CLI: configuración propia y una copia de las migraciones del repositorio."""
    project = home / 'proyecto' / 'supabase'
    migrations = project / 'migrations'
    migrations.mkdir(mode=0o700, parents=True, exist_ok=True)
    (project / 'config.toml').write_text(CONFIG_TOML, encoding='utf-8')
    wanted = {path.name: path for path in (ROOT / 'supabase/migrations').glob('*.sql')}
    for stale in migrations.glob('*.sql'):
        if stale.name not in wanted:
            stale.unlink()
    for name, source in wanted.items():
        target = migrations / name
        if not target.exists() or target.read_bytes() != source.read_bytes():
            shutil.copyfile(source, target)


def repo_migrations() -> list[str]:
    return sorted(path.name.split('_', 1)[0] for path in (ROOT / 'supabase/migrations').glob('*.sql'))


def ensure_stack(home: Path) -> None:
    if not docker_ready():
        raise LocalError('Docker no responde. Abrí Docker Desktop (o el servicio de Docker) y repetí el comando.')
    if stack_running():
        return
    say('Supabase local de este entorno: se inicia (la primera vez crea la base y aplica las migraciones).')
    log = private_log(home, 'supabase-start')
    result = run(cli(home, 'start'), env=cli_env(), timeout=1800, log=log, home=home)
    if result.returncode != 0:
        raise LocalError(f'supabase start falló (exit {result.returncode}); salida saneada en {log}.')


def supabase_env(home: Path) -> dict[str, str]:
    result = run(cli(home, 'status', '-o', 'env'), env=cli_env(), timeout=300)
    if result.returncode != 0:
        raise LocalError('supabase status falló: el proyecto local no está listo.')
    values = parse_env(result.stdout)
    check_api_url(values.get('API_URL', ''))
    for name in ('PUBLISHABLE_KEY', 'ANON_KEY', 'JWT_SECRET'):
        if not values.get(name):
            raise LocalError(f'La salida de supabase status no trae {name}.')
    guard_environment(values)
    write_private(home / 'supabase-local.env', ''.join(f'{key}="{value}"\n' for key, value in sorted(values.items())))
    return values


def wait_ready(env: dict[str, str], timeout: int = 300) -> None:
    api = check_api_url(env['API_URL'])
    headers = {'apikey': env['PUBLISHABLE_KEY']}
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if (http_status(f'{api}/auth/v1/health', headers) == 200
                and http_status(f'{api}/rest/v1/role?select=id&limit=1', headers) == 200):
            return
        time.sleep(2)
    raise LocalError('Auth o la Data API local no respondieron 200 a tiempo (ver docker ps).')


# ------------------------------------------------------------------ base local

def sql_literal(value: str) -> str:
    if '\x00' in value:
        raise LocalError('Valor SQL inválido.')
    return "'" + value.replace("'", "''") + "'"


PSQL_LEVEL = re.compile(r'^(?:psql:[^:]*:\d+: )?((?:ERROR|DETAIL|HINT):.*)$')


def sanitize_psql_error(stderr: str, secrets_in_sql: tuple[str, ...], home: Path) -> str:
    kept = [match.group(1) for line in stderr.splitlines() if (match := PSQL_LEVEL.match(line))]
    text = '\n'.join(re.sub(r"'(?:[^']|'')*'", "'…'", line) for line in kept)
    return redact_text(text, (*secrets_in_sql, *known_secrets(home))) or 'psql terminó con error (sin diagnóstico conservable)'


def psql(text: str, *, home: Path, read_only: bool = False, timeout: int = 180,
         secrets_in_sql: tuple[str, ...] = ()) -> str:
    """psql del contenedor de ESTE proyecto, por stdin (nunca argv). Un error solo deja un diagnóstico saneado."""
    body = f'begin transaction read only;\n{text}\nrollback;\n' if read_only else text
    result = run(['docker', 'exec', '-i', DB_CONTAINER, 'psql', '-X', '-q', '-At', '-F', '|',
                  '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], stdin=body, timeout=timeout)
    if result.returncode != 0:
        log = private_log(home, 'psql-error')
        write_private(log, sanitize_psql_error(result.stderr, secrets_in_sql, home))
        raise LocalError(f'Falló una consulta local; diagnóstico saneado en {log}.')
    return result.stdout.strip()


def psql_json(query: str, *, home: Path):
    raw = psql(f"select coalesce(({query}), 'null')::text;", home=home, read_only=True)
    return json.loads(raw.splitlines()[-1]) if raw else None


INVENTORY = """
select json_build_object(
  'migrations', (select coalesce(json_agg(version order by version), '[]') from supabase_migrations.schema_migrations),
  'tenants', (select coalesce(json_agg(json_build_object('id', id, 'name', name) order by id), '[]') from public.tenant),
  'roles', (select coalesce(json_agg(json_build_object('id', id, 'name', name) order by id), '[]') from public.role),
  'auth_emails', (select coalesce(json_agg(email order by email), '[]') from auth.users),
  'memberships', (select coalesce(json_agg(json_build_object('email', u.email, 'tenant', t.name, 'role', r.name, 'active', tu.status)
                   order by u.email), '[]')
                  from public.tenant_user tu join public."user" u on u.id = tu."user"
                  join public.tenant t on t.id = tu.tenant join public.role r on r.id = tu.role),
  'debtors_by_tenant', (select coalesce(json_object_agg(name, n), '{}') from
                        (select t.name, count(d.id) n from public.tenant t left join public.debtor d on d.tenant = t.id group by t.name) x),
  'debts', (select count(*) from public.debt),
  -- Fecha del ultimo lote PUBLICADO vigente (solo informativo: la autoridad es equitas_current_cutoff, que postgres no ejecuta).
  'cutoffs', (select coalesce(json_object_agg(t.name, (select b.as_of from public.import_batch b
                where b.tenant = t.id and b.status = 'PUBLICADO'
                  and not exists(select 1 from public.import_batch s where s.tenant = b.tenant and s.supersedes = b.id)
                order by b.id desc limit 1)), '{}')
              from public.tenant t),
  'batches', (select count(*) from public.import_batch),
  'reviews', (select count(*) from public.case_review),
  'approvals', (select count(*) from public.case_review_approval),
  'audit', (select count(*) from public.access_audit)
)"""


def inventory(home: Path) -> dict:
    return psql_json(INVENTORY, home=home)


def applied_migrations(home: Path) -> list[str]:
    return psql_json("select coalesce(json_agg(version order by version), '[]') from supabase_migrations.schema_migrations", home=home)


def ensure_migrations(home: Path) -> None:
    expected, applied = repo_migrations(), applied_migrations(home)
    if applied == expected:
        return
    if set(applied) - set(expected):
        raise LocalError('La base local tiene migraciones que este repositorio no conoce; no se modifica.')
    say('Hay migraciones nuevas en el repositorio: se aplican sin resetear la base.')
    log = private_log(home, 'supabase-migration-up')
    result = run(cli(home, 'migration', 'up', '--local'), env=cli_env(), timeout=900, log=log, home=home)
    if result.returncode != 0 or applied_migrations(home) != expected:
        raise LocalError(f'No se pudieron aplicar las migraciones nuevas; salida saneada en {log}.')


# ------------------------------------------------------------------ credenciales y cuentas

def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()


def mint_jwt(env: dict[str, str], role: str, hours: float) -> tuple[str, datetime]:
    """Credencial de servidor local (HS256 con el secreto del proyecto local). Nunca se imprime."""
    now = int(time.time())
    claims = {'role': role, 'iss': 'equitas-local', 'iat': now, 'exp': now + int(hours * 3600)}
    header = b64url(json.dumps({'alg': 'HS256', 'typ': 'JWT'}, separators=(',', ':')).encode())
    payload = b64url(json.dumps(claims, separators=(',', ':')).encode())
    signature = hmac.new(env['JWT_SECRET'].encode(), f'{header}.{payload}'.encode(), hashlib.sha256).digest()
    return f'{header}.{payload}.{b64url(signature)}', datetime.fromtimestamp(claims['exp'], UTC)


def load_credentials(home: Path) -> dict:
    path = home / 'cuentas.json'
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}


def save_credentials(home: Path, credentials: dict) -> None:
    write_private(home / 'cuentas.json', json.dumps(credentials, ensure_ascii=False, indent=2) + '\n')
    lines = ['EQUITAS — entorno local de pruebas (noche 7). Cuentas sintéticas: solo existen en la base local. No compartir.',
             f'Aplicación: http://127.0.0.1:{APP_PORT}/login', '']
    for key, email, _name, role, tenant, active in ACCOUNTS:
        password = credentials.get(key, {}).get('password') or 'desconocida: ejecutar start --rotar-claves'
        scope = 'sin membresía' if role is None else f'{role} en {tenant}{"" if active else " (membresía INACTIVA)"}'
        lines += [f'{key}', f'  correo:     {email}', f'  contraseña: {password}', f'  cuenta:     {scope}',
                  f'  esperado:   {EXPECTED[key]}', '']
    write_private(home / 'cuentas.txt', '\n'.join(lines))


def new_password() -> str:
    return secrets.token_hex(12) + 'Aa1!'


def accounts_sql(passwords: dict[str, str], rotate: set[str]) -> str:
    """Crea o completa las cuentas sintéticas. Nunca cambia un rol ni un estado existentes: si difieren, falla sin cambios."""
    parts = ['begin;']
    for key, email, name, role, tenant, active in ACCOUNTS:
        mail = sql_literal(email)
        if key in passwords:
            secret = sql_literal(passwords[key])
            parts.append(f"""insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', {mail},
  extensions.crypt({secret}, extensions.gen_salt('bf', 10)), now(), '{{"provider":"email","providers":["email"]}}'::jsonb,
  '{{}}'::jsonb, now(), now(), '', '', '', ''
where not exists (select 1 from auth.users where email = {mail});""")
            if key in rotate:
                parts.append(f"""update auth.users set encrypted_password = extensions.crypt({secret}, extensions.gen_salt('bf', 10)),
  updated_at = now() where email = {mail};""")
        parts.append(f"""insert into auth.identities(provider_id, user_id, identity_data, provider, created_at, updated_at)
select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
  'email', now(), now() from auth.users u
where u.email = {mail} and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');""")
        parts.append(f"""insert into public."user"(auth_user, full_name, email) select u.id, {sql_literal(name)}, {mail}
from auth.users u where u.email = {mail} on conflict (email) do nothing;
do $$ begin
  if not exists (select 1 from public."user" pu join auth.users u on u.id = pu.auth_user where pu.email = {mail} and u.email = {mail}) then
    raise exception 'CUENTA_INCONSISTENTE';
  end if;
end $$;""")
        if role is None:
            parts.append(f"""do $$ begin
  if exists (select 1 from public.tenant_user tu join public."user" pu on pu.id = tu."user" where pu.email = {mail}) then
    raise exception 'CUENTA_SIN_MEMBRESIA_CON_MEMBRESIA';
  end if;
end $$;""")
            continue
        status = 'true' if active else 'false'
        parts.append(f"""insert into public.tenant_user(tenant, "user", role, status)
select t.id, pu.id, r.id, {status} from public.tenant t, public."user" pu, public.role r
where t.name = {sql_literal(tenant)} and pu.email = {mail} and r.name = {sql_literal(role)}
on conflict (tenant, "user") do nothing;
do $$ begin
  if not exists (select 1 from public.tenant_user tu join public."user" pu on pu.id = tu."user"
                 join public.tenant t on t.id = tu.tenant join public.role r on r.id = tu.role
                 where pu.email = {mail} and t.name = {sql_literal(tenant)} and r.name = {sql_literal(role)} and tu.status = {status}) then
    raise exception 'MEMBRESIA_INESPERADA';
  end if;
end $$;""")
    parts.append('commit;')
    return '\n'.join(parts)


def ensure_seed(home: Path, rotate_all: bool) -> None:
    psql(SEED.read_text(encoding='utf-8'), home=home)
    existing = set(inventory(home)['auth_emails'])
    credentials = load_credentials(home)
    rotate = {key for key, *_ in ACCOUNTS} if rotate_all else set()
    passwords = {key: new_password() for key, email, *_ in ACCOUNTS if email not in existing or key in rotate}
    psql(accounts_sql(passwords, rotate), home=home, secrets_in_sql=tuple(passwords.values()))
    for key, email, name, role, tenant, active in ACCOUNTS:
        entry = credentials.get(key, {})
        entry.update(email=email, nombre=name, rol=role, municipio=tenant, membresia_activa=active, esperado=EXPECTED[key])
        if key in passwords:
            entry['password'] = passwords[key]
        elif not entry.get('password'):
            entry['password'] = None
        credentials[key] = entry
    save_credentials(home, credentials)


# ------------------------------------------------------------------ procesos propios (servicio de importación y app)

def git(*args: str) -> str:
    result = run(['git', *args], timeout=60)
    return result.stdout.strip() if result.returncode == 0 else ''


def process_cwd(pid: int) -> str | None:
    proc = Path(f'/proc/{pid}/cwd')
    if proc.exists():
        with contextlib.suppress(OSError):
            return os.readlink(proc)
    if shutil.which('lsof'):
        result = run(['lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'], timeout=30)
        for line in result.stdout.splitlines():
            if line.startswith('n'):
                return line[1:]
    return None


def own_process(home: Path, name: str, cwd: Path, markers: tuple[str, ...]) -> dict | None:
    """Datos del proceso propio solo si el PID sigue vivo, es el programa esperado y corre en la carpeta esperada."""
    path = home / 'run' / f'{name}.json'
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding='utf-8'))
    pid = int(data.get('pid', 0))
    if pid <= 1:
        return None
    try:
        os.kill(pid, 0)
    except (ProcessLookupError, PermissionError):
        return None
    command = run(['ps', '-o', 'command=', '-p', str(pid)], timeout=30).stdout
    current = process_cwd(pid)
    if not any(marker in command for marker in markers) or current is None or Path(current).resolve() != cwd.resolve():
        return None
    return data


def stop_process(home: Path, name: str, cwd: Path, markers: tuple[str, ...]) -> bool:
    data = own_process(home, name, cwd, markers)
    path = home / 'run' / f'{name}.json'
    if data is None:
        with contextlib.suppress(FileNotFoundError):
            path.unlink()
        return False
    pid = int(data['pid'])
    with contextlib.suppress(ProcessLookupError):
        os.killpg(pid, signal.SIGTERM)
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            break
        time.sleep(0.5)
    else:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(pid, signal.SIGKILL)
    with contextlib.suppress(FileNotFoundError):
        path.unlink()
    return True


API_MARKERS = ('uvicorn',)
# Next renombra su proceso a «next-server (vX)»; el arranque original dice «next ... start».
NEXT_MARKERS = ('next-server', 'next/dist/bin/next')


def backend_python() -> str:
    python = BACK / '.venv/bin/python'
    if not python.exists():
        raise LocalError('Falta back/.venv. Crealo con las dependencias del backend (back/requirements.txt) antes de arrancar.')
    return str(python)


def start_import_api(home: Path, env: dict[str, str], hours: float) -> dict:
    if port_busy(IMPORT_PORT):
        raise LocalError(f'El puerto {IMPORT_PORT} (servicio de importación) ya está en uso por otro proceso.')
    import_jwt, expires = mint_jwt(env, 'equitas_import_server', hours)
    log = home / 'run' / 'importacion.log'
    if not log.exists():
        write_private(log, '')
    # EQUITAS_TARGET_ENV=local y una URL de loopback: la guardia del cargador (back/ETL/config.py) rechaza cualquier otro destino.
    server_env = {'PATH': os.environ.get('PATH', ''), 'HOME': str(Path.home()), 'PYTHONDONTWRITEBYTECODE': '1',
                  'EQUITAS_TARGET_ENV': 'local', 'SUPABASE_URL': check_api_url(env['API_URL']),
                  'SUPABASE_PUBLISHABLE_KEY': env['PUBLISHABLE_KEY'], 'EQUITAS_IMPORT_SERVER_JWT': import_jwt,
                  'EQUITAS_IMPORT_TMP_DIR': str(home / 'importaciones')}
    with open(log, 'a', encoding='utf-8') as handle:
        process = subprocess.Popen([backend_python(), '-m', 'uvicorn', 'api.main:app', '--host', '127.0.0.1',
                                    '--port', str(IMPORT_PORT)], cwd=BACK, env=server_env, stdin=subprocess.DEVNULL,
                                   stdout=handle, stderr=handle, start_new_session=True)
    data = {'pid': process.pid, 'port': IMPORT_PORT, 'url': f'http://127.0.0.1:{IMPORT_PORT}',
            'started_at_utc': utc_now().isoformat(), 'jwt_expires_at_utc': expires.isoformat()}
    write_private(home / 'run' / 'importacion.json', json.dumps(data, indent=2) + '\n')
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise LocalError(f'El servicio de importación terminó (exit {process.returncode}); ver el log privado {log}.')
        # Todas sus rutas exigen sesión: 401 sin token significa que está atendiendo.
        if http_status(f"{data['url']}/health") == 401:
            return data
        time.sleep(1)
    stop_process(home, 'importacion', BACK, API_MARKERS)
    raise LocalError(f'El servicio de importación no respondió; ver el log privado {log}.')


def build_stamp(env: dict[str, str]) -> dict:
    public = f"{env['API_URL']}\n{env['PUBLISHABLE_KEY']}".encode()
    status = git('status', '--porcelain', '--', 'front', 'contracts')
    return {'sha': git('rev-parse', 'HEAD'), 'cambios_locales_sha256': hashlib.sha256(status.encode()).hexdigest(),
            'publico_sha256': hashlib.sha256(public).hexdigest()}


def ensure_build(home: Path, env: dict[str, str], force: bool = False) -> None:
    if not (FRONT / 'node_modules/next/dist/bin/next').exists():
        raise LocalError('Faltan las dependencias del front. Instalalas con: cd front && npm ci --ignore-scripts')
    stamp_path = FRONT / '.next/equitas-local-build.json'
    stamp = build_stamp(env)
    current = json.loads(stamp_path.read_text(encoding='utf-8')) if stamp_path.exists() else None
    dirty = bool(git('status', '--porcelain', '--', 'front', 'contracts'))
    if not force and not dirty and current == stamp and (FRONT / '.next/BUILD_ID').exists():
        return
    # Compilar reemplaza front/.next: no se hace debajo de otra aplicación que esté sirviendo desde esta carpeta.
    listing = run(['ps', '-axo', 'pid=,command='], timeout=30).stdout
    for line in listing.splitlines():
        pid, _, command = line.strip().partition(' ')
        if 'next-server' in command and pid.isdigit() and (process_cwd(int(pid)) or '') == str(FRONT.resolve()):
            raise LocalError('Hay otra aplicación Next sirviendo desde front/ (por ejemplo, la demo de la noche 6). '
                             'Detenela antes de arrancar este entorno: compilar reemplazaría su build.')
    say('Compilando la aplicación con la configuración pública de este entorno local; puede tardar unos minutos.')
    # La compilación reemplaza front/.next: la marca de la demo de la noche 6 deja de valer y se retira, para que
    # esa demo recompile con SU configuración la próxima vez que se arranque (no se toca nada más de esa demo).
    with contextlib.suppress(FileNotFoundError):
        (FRONT / '.next/equitas-demo-build.json').unlink()
    build_env = {'PATH': os.environ.get('PATH', ''), 'HOME': str(Path.home()), 'NEXT_TELEMETRY_DISABLED': '1',
                 'NEXT_PUBLIC_SUPABASE_URL': check_api_url(env['API_URL']),
                 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY': env['PUBLISHABLE_KEY'], 'QUALITY_SOURCE_SHA': stamp['sha']}
    log = private_log(home, 'next-build')
    result = run(['node', 'node_modules/next/dist/bin/next', 'build'], cwd=FRONT, env=build_env, timeout=1800, log=log, home=home)
    if result.returncode != 0:
        raise LocalError(f'La compilación de la aplicación falló (exit {result.returncode}); salida en el log privado {log}.')
    stamp_path.write_text(json.dumps(stamp, indent=2) + '\n', encoding='utf-8')


def start_app(home: Path, env: dict[str, str], hours: float) -> dict:
    if port_busy(APP_PORT):
        raise LocalError(f'El puerto {APP_PORT} (aplicación) ya está en uso por otro proceso.')
    review_jwt, expires = mint_jwt(env, 'equitas_review_server', hours)
    log = home / 'run' / 'app.log'
    if not log.exists():
        write_private(log, '')
    server_env = {'PATH': os.environ.get('PATH', ''), 'HOME': str(Path.home()), 'NODE_ENV': 'production',
                  'NEXT_TELEMETRY_DISABLED': '1', 'NEXT_PUBLIC_SUPABASE_URL': check_api_url(env['API_URL']),
                  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY': env['PUBLISHABLE_KEY'], 'EQUITAS_REVIEW_SERVER_JWT': review_jwt,
                  'EQUITAS_IMPORT_API_URL': f'http://127.0.0.1:{IMPORT_PORT}', 'QUALITY_SOURCE_SHA': git('rev-parse', 'HEAD')}
    with open(log, 'a', encoding='utf-8') as handle:
        process = subprocess.Popen(['node', 'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1',
                                    '--port', str(APP_PORT)], cwd=FRONT, env=server_env, stdin=subprocess.DEVNULL,
                                   stdout=handle, stderr=handle, start_new_session=True)
    data = {'pid': process.pid, 'port': APP_PORT, 'url': f'http://127.0.0.1:{APP_PORT}', 'started_at_utc': utc_now().isoformat(),
            'jwt_expires_at_utc': expires.isoformat(), 'sha': git('rev-parse', 'HEAD')}
    write_private(home / 'run' / 'app.json', json.dumps(data, indent=2) + '\n')
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise LocalError(f'La aplicación terminó (exit {process.returncode}); ver el log privado {log}.')
        if http_status(f"{data['url']}/login") == 200:
            return data
        time.sleep(1)
    stop_process(home, 'app', FRONT, NEXT_MARKERS)
    raise LocalError(f'La aplicación no respondió en {data["url"]}/login; ver el log privado {log}.')


def fresh(data: dict | None, sha: str | None = None) -> bool:
    if data is None:
        return False
    expires = datetime.fromisoformat(data['jwt_expires_at_utc'])
    return expires - utc_now() > RENEW_MARGIN and (sha is None or data.get('sha') == sha)


# ------------------------------------------------------------------ comandos

def banner(env: dict[str, str]) -> None:
    api = check_api_url(env['API_URL'])
    say()
    say('ENTORNO LOCAL DE PRUEBAS — EQUITAS noche 7')
    say(f'  Quién autentica:        el servicio de autenticación del Supabase LOCAL ({api}), con cuentas sintéticas.')
    say(f'  Qué recibe los archivos: navegador -> aplicación http://127.0.0.1:{APP_PORT} -> servicio de importación local')
    say(f'                          http://127.0.0.1:{IMPORT_PORT} -> base LOCAL «{PROJECT_ID}» (127.0.0.1:{DB_PORT}).')
    say('  Producción:             no interviene. Las cuentas de producción no existen acá y la carga solo escribe en esta base local.')
    say()


def summary(inv: dict) -> None:
    for tenant, count in sorted(inv['debtors_by_tenant'].items()):
        cutoff = inv['cutoffs'].get(tenant)
        state = f'{count} objetos, cartera al {cutoff}' if cutoff else ('sin cartera cargada' if not count else f'{count} objetos, sin fecha de cartera vigente')
        say(f'  {tenant}: {state}.')
    say(f"  Lotes registrados: {inv['batches']}; decisiones: {inv['reviews']}; aprobaciones: {inv['approvals']}; registros de acceso: {inv['audit']}.")


def cmd_start(args) -> int:
    home = local_home()
    guard_environment()
    prepare_project(home)
    ensure_stack(home)
    env = supabase_env(home)
    wait_ready(env)
    ensure_migrations(home)
    ensure_seed(home, args.rotar_claves)
    api_data = own_process(home, 'importacion', BACK, API_MARKERS)
    if args.reiniciar or not fresh(api_data):
        stop_process(home, 'importacion', BACK, API_MARKERS)
        api_data = start_import_api(home, env, args.horas)
    if not args.sin_app:
        sha = git('rev-parse', 'HEAD')
        app_data = own_process(home, 'app', FRONT, NEXT_MARKERS)
        dirty = bool(git('status', '--porcelain', '--', 'front', 'contracts'))
        if args.reiniciar or args.rebuild or dirty or not fresh(app_data, sha):
            stop_process(home, 'app', FRONT, NEXT_MARKERS)
            ensure_build(home, env, force=args.rebuild)
            app_data = start_app(home, env, args.horas)
    banner(env)
    summary(inventory(home))
    if not args.sin_app:
        say(f"  Aplicación lista: http://127.0.0.1:{APP_PORT}/login")
    say(f"  Credenciales de servidor vigentes hasta {api_data['jwt_expires_at_utc'][:16].replace('T', ' ')} UTC (start las renueva).")
    say(f'  Cuentas de prueba: {home / "cuentas.txt"} (archivo privado, fuera de Git).')
    say('  Detener todo: scripts/local/equitas_local.py stop (conserva los datos).')
    return 0


def cmd_stop(args) -> int:
    home = local_home()
    guard_environment()
    say('Aplicación detenida.' if stop_process(home, 'app', FRONT, NEXT_MARKERS) else 'La aplicación de este entorno no estaba en marcha.')
    say('Servicio de importación detenido.' if stop_process(home, 'importacion', BACK, API_MARKERS)
        else 'El servicio de importación de este entorno no estaba en marcha.')
    if args.solo_app:
        return 0
    if docker_ready() and stack_running():
        prepare_project(home)
        result = run(cli(home, 'stop'), env=cli_env(), timeout=600, log=private_log(home, 'supabase-stop'), home=home)
        if result.returncode != 0:
            raise LocalError('supabase stop falló; ver el log saneado en logs/.')
        say('Supabase local de este entorno detenido. Los datos quedan en su volumen de Docker.')
    else:
        say('Supabase local de este entorno ya estaba detenido.')
    return 0


def cmd_vaciar(args) -> int:
    """Borra la base de ESTE entorno (datos sintéticos) para repetir la prueba desde un municipio vacío."""
    home = local_home()
    guard_environment()
    if args.confirmar != PROJECT_ID:
        raise LocalError(f'Para borrar la base local de este entorno escribí: vaciar --confirmar {PROJECT_ID}')
    if not docker_ready():
        raise LocalError('Docker no está disponible.')
    stop_process(home, 'app', FRONT, NEXT_MARKERS)
    stop_process(home, 'importacion', BACK, API_MARKERS)
    prepare_project(home)
    result = run(cli(home, 'stop', '--no-backup'), env=cli_env(), timeout=600, log=private_log(home, 'supabase-vaciar'), home=home)
    if result.returncode != 0:
        raise LocalError('supabase stop --no-backup falló; ver el log saneado en logs/.')
    left = run(['docker', 'volume', 'ls', '-q', '--filter', f'label=com.supabase.cli.project={PROJECT_ID}'], timeout=60).stdout.split()
    if left:
        raise LocalError('Quedaron volúmenes de este entorno sin borrar. Arrancalo con start y repetí vaciar.')
    for path in (home / 'importaciones').iterdir():
        shutil.rmtree(path) if path.is_dir() and not path.is_symlink() else path.unlink()
    say(f'Base local «{PROJECT_ID}» borrada. Las cuentas sintéticas conservan sus contraseñas.')
    say('Volver a crearla vacía: scripts/local/equitas_local.py start')
    return 0


def cmd_status(args) -> int:
    home = local_home()
    guard_environment()
    if not docker_ready() or not stack_running():
        say('Supabase local de este entorno: detenido (los datos se conservan). Arrancar: scripts/local/equitas_local.py start')
        return 1
    prepare_project(home)
    env = supabase_env(home)
    banner(env)
    summary(inventory(home))
    api_data = own_process(home, 'importacion', BACK, API_MARKERS)
    app_data = own_process(home, 'app', FRONT, NEXT_MARKERS)
    say(f"  Servicio de importación: {'en marcha' if api_data else 'detenido'}.")
    say(f"  Aplicación: {'en marcha en ' + app_data['url'] + '/login' if app_data else 'detenida'}.")
    return 0 if api_data and app_data else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    start = commands.add_parser('start', help='arranca todo; crea lo que falte y nunca borra')
    start.add_argument('--horas', type=float, default=DEFAULT_JWT_HOURS, help=f'vigencia de las credenciales de servidor (máximo {MAX_JWT_HOURS})')
    start.add_argument('--reiniciar', action='store_true', help='reinicia el servicio de importación y la aplicación')
    start.add_argument('--rebuild', action='store_true', help='fuerza la compilación de la aplicación')
    start.add_argument('--rotar-claves', action='store_true', help='regenera las contraseñas de las cuentas sintéticas')
    start.add_argument('--sin-app', action='store_true', help='solo la base y el servicio de importación (desarrollo)')
    stop = commands.add_parser('stop', help='detiene la aplicación, el servicio de importación y Supabase')
    stop.add_argument('--solo-app', action='store_true', help='deja Supabase en marcha')
    commands.add_parser('status', help='estado, solo lectura')
    vaciar = commands.add_parser('vaciar', help='borra SOLO la base sintética de este entorno, para repetir la prueba')
    vaciar.add_argument('--confirmar', default='', help=f'debe ser exactamente {PROJECT_ID}')
    args = parser.parse_args(argv)
    if getattr(args, 'horas', 1) <= 0 or getattr(args, 'horas', 1) > MAX_JWT_HOURS:
        parser.error(f'--horas debe estar entre 0 y {MAX_JWT_HOURS}')
    try:
        return {'start': cmd_start, 'stop': cmd_stop, 'status': cmd_status, 'vaciar': cmd_vaciar}[args.command](args)
    except LocalError as error:
        print(f'ERROR: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
