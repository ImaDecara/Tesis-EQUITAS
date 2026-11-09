"""Demo local persistente de EQUITAS V1 (noche 6). Solo el stack Supabase local y datos sintéticos.

Comandos (desde la raíz del repositorio, con el Python del backend):
  back/.venv/bin/python scripts/demo/equitas_demo.py init      inicialización sintética explícita e idempotente
  back/.venv/bin/python scripts/demo/equitas_demo.py start     arranque normal: nunca resetea, borra ni siembra
  back/.venv/bin/python scripts/demo/equitas_demo.py stop      detiene la app de la demo (--stack: también Supabase)
  back/.venv/bin/python scripts/demo/equitas_demo.py status    estado, solo lectura
  back/.venv/bin/python scripts/demo/equitas_demo.py renew     credencial de servidor nueva y reinicio de la app
  back/.venv/bin/python scripts/demo/equitas_demo.py recrear --confirmar RECREAR-DEMO
                                                               borra y recrea, solo si la base contiene únicamente
                                                               recursos propios de la demo

Todo lo privado (claves locales, contraseñas, JWT, logs) vive en EQUITAS_DEMO_HOME (por defecto
~/.equitas-demo, modo 0700, archivos 0600), fuera del repositorio. Nada secreto se imprime.
Guía: docs/entrega/noche-6/README.md.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.util
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
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
FRONT = ROOT / 'front'
BACK = ROOT / 'back'
CLI = ('npx', '--yes', 'supabase@2.108.0')
PROJECT_ID = 'equitas-tp-testing'
DB_CONTAINER = f'supabase_db_{PROJECT_ID}'
LOOPBACK = ('127.0.0.1', 'localhost')
REMOTE_MARKERS = ('supabase.co', 'folyslqzqvnpolexcxjo', 'iylwghgvtydpmwidojdo')
FIXTURE = ROOT / 'database/demo/cartera-demo-v1'
MANIFEST = FIXTURE / 'manifiesto-demo.json'
MAPPING = ROOT / 'contracts/source-mapping.sintetico-v1.json'
CONTRACT = ROOT / 'contracts/source-contract.v1.json'
IDENTIFIER_PREFIX = 'DEMO6-'
TENANT_A = 'Municipio sintetico ETL'  # tenant 1 que exige el ETL (database/testing/etl-compat-catalogs.sql)
TENANT_B = 'Municipio sintetico B (demo N6)'
IMPORT_ACTOR_EMAIL = 'importador-etl@example.invalid'
SHARED_LOCK = Path('/tmp/equitas-local-db/lock')  # turno de base que usan las campañas del plan
RECREATE_PHRASE = 'RECREAR-DEMO'
DEFAULT_PORT = 3000
DEFAULT_JWT_HOURS = 24
MAX_JWT_HOURS = 72
RENEW_MARGIN = timedelta(hours=2)
CRON_JOBS = ('equitas-import-staging-ttl', 'equitas-import-preview-ttl')  # de las migraciones del repositorio
KNOWN_DATABASES = ('_supabase', 'postgres', 'storage_vectors', 'template0', 'template1')
# Tablas internas que un stack recién creado con la CLI 2.108.0 y estas migraciones ya trae con filas
# (contadas en una base prístina el 2026-11-09). Otro conteo significa que alguien las tocó: no se borra.
PRISTINE_BOOKKEEPING = {
    '_realtime.extensions': 1, '_realtime.schema_migrations': 31, '_realtime.tenants': 1, 'auth.schema_migrations': 76,
    'realtime.schema_migrations': 75, 'storage.migrations': 61, 'supabase_functions.migrations': 2,
}
SECRET_PATTERNS = (
    re.compile(r'eyJ[\w-]+\.[\w-]+\.[\w-]+'),
    re.compile(r'sb_(?:secret|publishable)_[\w-]+'),
    re.compile(r'\b[0-9a-fA-F]{32,}\b'),
)
SECRET_ASSIGNMENT = re.compile(r'(?i)((?:secret|key|password|token)[^:=\n]{0,40}[:=][ \t]*)\S+')

# Cuentas propias de la demo: (clave, correo, rol, municipio). Ninguna existe fuera de la base local.
ACCOUNTS = (
    ('consulta', 'demo-consulta@example.test', 'consulta', TENANT_A),
    ('operador', 'demo-operador@example.test', 'operador', TENANT_A),
    ('supervisor', 'demo-supervisor@example.test', 'supervisor', TENANT_A),
    ('importador', 'demo-importador@example.test', 'importador', TENANT_A),
    ('ajeno', 'demo-ajeno@example.test', 'consulta', TENANT_B),
    ('sin-membresia', 'demo-sin-membresia@example.test', None, None),
)
ROLE_DESCRIPTIONS = {
    'consulta': 'Lectura de cartera y decisiones (demo local)',
    'operador': 'Registra decisiones (demo local)',
    'supervisor': 'Aprueba decisiones y lee auditoría (demo local)',
    'importador': 'Carga de lotes; sin lectura de cartera (demo local)',
}


class DemoError(RuntimeError):
    """Mensaje fijo para la persona; nunca incluye valores privados."""


def utc_now() -> datetime:
    return datetime.now(UTC)


def say(message: str) -> None:
    print(message, flush=True)


# ------------------------------------------------------------------ carpeta privada

def demo_home() -> Path:
    home = Path(os.environ.get('EQUITAS_DEMO_HOME') or Path.home() / '.equitas-demo').expanduser().absolute()
    if home.is_symlink():
        raise DemoError('EQUITAS_DEMO_HOME no puede ser un enlace simbólico.')
    if home.resolve() == ROOT.resolve() or ROOT.resolve() in home.resolve().parents:
        raise DemoError('La carpeta privada no puede estar dentro del repositorio.')
    home.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(home, 0o700)
    if home.stat().st_uid != os.getuid():
        raise DemoError('La carpeta privada de la demo pertenece a otro usuario.')
    for sub in ('run', 'logs', 'validacion'):
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


# ------------------------------------------------------------------ guardias de destino

def guard_environment(environ: dict[str, str] | None = None) -> None:
    values = os.environ if environ is None else environ
    if any(marker in value.casefold() for value in values.values() for marker in REMOTE_MARKERS):
        raise DemoError('DETENERSE: una variable de entorno nombra un proyecto Supabase remoto (no se muestra cuál ni su valor).')
    if (ROOT / 'supabase/.temp/project-ref').exists():
        raise DemoError('DETENERSE: el repositorio está vinculado a un proyecto remoto (supabase/.temp/project-ref).')
    config = (ROOT / 'supabase/config.toml').read_text(encoding='utf-8')
    if f'project_id = "{PROJECT_ID}"' not in config:
        raise DemoError('supabase/config.toml no corresponde al stack local esperado.')


def check_api_url(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme != 'http' or parts.hostname not in LOOPBACK or parts.username or parts.password or parts.path not in ('', '/'):
        raise DemoError('DETENERSE: la API de Supabase no es el stack local (127.0.0.1).')
    return url.rstrip('/')


def parse_env(text: str) -> dict[str, str]:
    values = {}
    for line in text.splitlines():
        name, separator, value = line.strip().partition('=')
        if separator and name:
            values[name] = value.strip().strip('"')
    return values


# ------------------------------------------------------------------ procesos

def run(command: list[str] | tuple[str, ...], *, cwd: Path = ROOT, env: dict[str, str] | None = None,
        timeout: int = 120, log: Path | None = None, stdin: str | None = None) -> subprocess.CompletedProcess:
    """Ejecuta sin shell. Con log, la salida va solo a ese archivo privado. Mata el grupo si vence."""
    process = subprocess.Popen(command, cwd=cwd, env=env, text=True, start_new_session=True,
                               stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        out, err = process.communicate(stdin, timeout=timeout)
    except subprocess.TimeoutExpired:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGKILL)
        process.communicate()
        raise DemoError(f'Tiempo máximo agotado ({timeout} s): {command[0]} {command[1] if len(command) > 1 else ""}'.strip())
    if log:
        # Ningún log conserva salida cruda: la CLI de Supabase imprime claves al arrancar.
        write_private(log, redact_text((out or '') + (err or ''), known_secrets()))
        return subprocess.CompletedProcess(command, process.returncode, '', '')
    return subprocess.CompletedProcess(command, process.returncode, out or '', err or '')


def known_secrets() -> tuple[str, ...]:
    """Valores privados ya conocidos (claves locales y contraseñas demo) para tacharlos de cualquier log."""
    values: list[str] = []
    with contextlib.suppress(Exception):
        home = Path(os.environ.get('EQUITAS_DEMO_HOME') or Path.home() / '.equitas-demo').expanduser()
        if (home / 'supabase-local.env').exists():
            values += [value for key, value in parse_env((home / 'supabase-local.env').read_text()).items()
                       if not value.startswith(('http://', 'postgresql://postgres:postgres@'))]
        if (home / 'cuentas.json').exists():
            values += [entry.get('password') or '' for entry in json.loads((home / 'cuentas.json').read_text()).values()]
    return tuple(value for value in values if value)


def redact_text(text: str, extra: tuple[str, ...] | list[str] = ()) -> str:
    for value in sorted({value for value in extra if value and len(value) >= 6}, key=len, reverse=True):
        text = text.replace(value, '[privado]')
    for pattern in SECRET_PATTERNS:
        text = pattern.sub('[privado]', text)
    return SECRET_ASSIGNMENT.sub(r'\1[privado]', text)


def cli_env() -> dict[str, str]:
    env = dict(os.environ)
    env.update(DO_NOT_TRACK='1', SUPABASE_TELEMETRY_DISABLED='1')
    return env


def docker_ready() -> bool:
    return shutil.which('docker') is not None and run(['docker', 'info'], timeout=60).returncode == 0


def stack_running() -> bool:
    result = run(['docker', 'inspect', '-f', '{{.State.Running}}', DB_CONTAINER], timeout=60)
    return result.returncode == 0 and result.stdout.strip() == 'true'


def ensure_stack(home: Path) -> None:
    if not docker_ready():
        raise DemoError('Docker no responde. Abrí Docker Desktop (o el servicio de Docker) y repetí el comando.')
    if stack_running():
        return
    with db_turn('arranque-stack'):  # no se arranca ni se detiene el stack durante una campaña ajena
        if stack_running():
            return
        say('Supabase local detenido: se inicia con la CLI fijada (conserva los datos; no resetea).')
        log = private_log(home, 'supabase-start')
        result = run([*CLI, 'start'], env=cli_env(), timeout=1800, log=log)
    if result.returncode != 0:
        raise DemoError(f'supabase start falló (exit {result.returncode}); salida saneada en {log}.')


def supabase_env(home: Path) -> dict[str, str]:
    """Claves locales deterministas de `supabase status -o env`; se guardan 0600 y no se imprimen."""
    result = run([*CLI, 'status', '-o', 'env'], env=cli_env(), timeout=300)
    if result.returncode != 0:
        raise DemoError('supabase status falló: el stack local no está listo.')
    values = parse_env(result.stdout)
    check_api_url(values.get('API_URL', ''))
    for name in ('PUBLISHABLE_KEY', 'ANON_KEY', 'SERVICE_ROLE_KEY', 'JWT_SECRET'):
        if not values.get(name):
            raise DemoError(f'La salida de supabase status no trae {name}.')
    guard_environment(values)
    write_private(home / 'supabase-local.env', ''.join(f'{key}="{value}"\n' for key, value in sorted(values.items())))
    return values


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


def wait_ready(env: dict[str, str], timeout: int = 300) -> None:
    api = check_api_url(env['API_URL'])
    headers = {'apikey': env['PUBLISHABLE_KEY']}
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if (http_status(f'{api}/auth/v1/health', headers) == 200
                and http_status(f'{api}/rest/v1/role?select=id&limit=1', headers) == 200):
            return
        time.sleep(2)
    raise DemoError('Auth o la Data API local no respondieron 200 a tiempo (ver docker ps).')


# ------------------------------------------------------------------ base local

def sql_literal(value: str) -> str:
    if '\x00' in value:
        raise DemoError('Valor SQL inválido.')
    return "'" + value.replace("'", "''") + "'"


PSQL_LEVEL = re.compile(r'^(?:psql:[^:]*:\d+: )?((?:ERROR|DETAIL|HINT):.*)$')


def sanitize_psql_error(stderr: str, secrets_in_sql: tuple[str, ...] = ()) -> str:
    """Solo niveles ERROR/DETAIL/HINT, sin líneas LINE/QUERY/CONTEXT (citan el SQL) ni literales."""
    kept = [match.group(1) for line in stderr.splitlines() if (match := PSQL_LEVEL.match(line))]
    text = '\n'.join(re.sub(r"'(?:[^']|'')*'", "'…'", line) for line in kept)
    return redact_text(text, (*secrets_in_sql, *known_secrets())) or 'psql terminó con error (sin diagnóstico conservable)'


def psql(text: str, *, home: Path | None = None, read_only: bool = False, timeout: int = 180,
         secrets_in_sql: tuple[str, ...] = ()) -> str:
    """psql del contenedor por stdin (nunca argv). Un error solo deja un diagnóstico saneado."""
    body = f'begin transaction read only;\n{text}\nrollback;\n' if read_only else text
    result = run(['docker', 'exec', '-i', DB_CONTAINER, 'psql', '-X', '-q', '-At', '-F', '|',
                  '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], stdin=body, timeout=timeout)
    if result.returncode != 0:
        if home is not None:
            log = private_log(home, 'psql-error')
            write_private(log, sanitize_psql_error(result.stderr, secrets_in_sql))
            raise DemoError(f'Falló una consulta local; diagnóstico saneado en {log}.')
        raise DemoError('Falló una consulta local (detalle omitido por privacidad).')
    return result.stdout.strip()


def psql_json(query: str, **kwargs):
    raw = psql(f'select coalesce(({query}), \'null\')::text;', **kwargs)
    return json.loads(raw.splitlines()[-1]) if raw else None


def demo_identifiers() -> tuple[str, ...]:
    return tuple(case['identificador'] for case in manifest()['casos'])


def in_list(values) -> str:
    return '(' + ', '.join(sql_literal(value) for value in values) + ')'


def inventory_sql() -> str:
    ids = in_list(demo_identifiers())
    demo = f"tenant = 1 and identifier in {ids}"
    return f"""
select json_build_object(
  'migrations', (select coalesce(json_agg(version order by version), '[]') from supabase_migrations.schema_migrations),
  'tenants', (select coalesce(json_agg(json_build_object('id', id, 'name', name) order by id), '[]') from public.tenant),
  'auth_emails', (select coalesce(json_agg(email order by email), '[]') from auth.users),
  'app_users', (select coalesce(json_agg(json_build_object('email', email, 'auth', auth_user is not null) order by email), '[]') from public."user"),
  'memberships', (select coalesce(json_agg(json_build_object('email', u.email, 'tenant', t.name, 'role', r.name, 'active', tu.status)
                   order by u.email), '[]')
                  from public.tenant_user tu join public."user" u on u.id = tu."user"
                  join public.tenant t on t.id = tu.tenant join public.role r on r.id = tu.role),
  'debtors_by_tenant', (select coalesce(json_object_agg(tenant, n), '{{}}') from (select tenant, count(*) n from public.debtor group by tenant) x),
  'foreign_debtors_tenant1', (select count(*) from public.debtor where tenant = 1 and not coalesce(identifier in {ids}, false)),
  'demo_debtors', (select count(*) from public.debtor where {demo}),
  'demo_debts', (select count(*) from public.debt d where d.debtor in (select id from public.debtor where {demo})),
  'demo_amount', (select coalesce(sum(d.current_amount), 0)::text from public.debt d where d.debtor in (select id from public.debtor where {demo})),
  'batches', (select coalesce(json_agg(json_build_object('id', id, 'tenant', tenant, 'status', status, 'as_of', as_of,
                'cabecera', file_hashes->>'cabecera', 'detalle', file_hashes->>'detalle',
                'atomica', counts->'publicacion_atomica') order by id), '[]') from public.import_batch),
  'reviews', (select count(*) from public.case_review),
  'approvals', (select count(*) from public.case_review_approval),
  'audit', (select count(*) from public.access_audit)
)"""


def inventory(home: Path | None = None) -> dict:
    return psql_json(inventory_sql(), home=home, read_only=True)


def manifest() -> dict:
    return json.loads(MANIFEST.read_text(encoding='utf-8'))


def fixture_hashes() -> dict[str, str]:
    data = manifest()
    hashes = {}
    for name, spec in data['archivos'].items():
        actual = hashlib.sha256((FIXTURE / name).read_bytes()).hexdigest()
        if actual != spec['sha256']:
            raise DemoError(f'{name} no coincide con su manifiesto: la cartera demo fue modificada.')
        hashes[name.removesuffix('.tsv')] = actual
    if hashlib.sha256(MAPPING.read_bytes()).hexdigest() != data['perfil_mapeo']['sha256']:
        raise DemoError('El perfil de mapeo no coincide con el manifiesto de la demo.')
    return hashes


def classify(inv: dict, hashes: dict[str, str]) -> dict[str, list[str]]:
    """Recursos que no son de la demo. Se informan y se conservan; nunca se borran."""
    own_emails = {email for _, email, _, _ in ACCOUNTS}
    own_tenants = {TENANT_A, TENANT_B}
    foreign = {
        'municipios': [f"{t['id']}:{t['name']}" for t in inv['tenants'] if t['name'] not in own_tenants],
        'cuentas_auth': [email for email in inv['auth_emails'] if email not in own_emails],
        'usuarios_app': [u['email'] for u in inv['app_users'] if u['email'] not in own_emails | {IMPORT_ACTOR_EMAIL}],
        'lotes': [str(b['id']) for b in inv['batches']
                  if b['tenant'] != 1 or b['cabecera'] != hashes['cabecera'] or b['detalle'] != hashes['detalle']],
    }
    expected = expected_memberships()
    foreign['membresias'] = [f"{m['email']}:{m['tenant']}:{m['role']}" for m in inv['memberships']
                             if (m['email'], m['tenant'], m['role']) not in expected or not m['active']]
    if inv['foreign_debtors_tenant1']:
        foreign['objetos_tenant_1'] = [f"{inv['foreign_debtors_tenant1']} objetos fuera de los identificadores del manifiesto"]
    other = {str(k): v for k, v in inv['debtors_by_tenant'].items() if str(k) != '1'}
    if other:
        foreign['objetos_otros_municipios'] = [f'{k}:{v}' for k, v in sorted(other.items())]
    return {key: value for key, value in foreign.items() if value}


def expected_memberships() -> set[tuple[str, str, str]]:
    own = {(email, tenant, role) for _, email, role, tenant in ACCOUNTS if role}
    return own | {(IMPORT_ACTOR_EMAIL, TENANT_A, 'importador_sistema')}


def catalog_seeds() -> dict[str, tuple[str, list[tuple[int, str]]]]:
    """(columna clave, [(id, clave)]) de cada catálogo que siembra etl-compat-catalogs.sql."""
    text = (ROOT / 'database/testing/etl-compat-catalogs.sql').read_text(encoding='utf-8')
    seeds = {}
    for table, key, payload in re.findall(r"etl_seed\('(\w+)', '(\w+)', '\w+', '(\[.*?\])'\)", text, flags=re.DOTALL):
        seeds[table] = (key, [(int(item['id']), item['key']) for item in json.loads(payload)])
    if len(seeds) != 7:
        raise DemoError('No se pudieron leer los catálogos del ETL para el inventario.')
    return seeds


def ownership_rules(hashes: dict[str, str]) -> dict[str, str]:
    """Condición SQL que cumple una fila PROPIA de la demo, por tabla. Lo demás no se puede borrar."""
    ids = in_list(demo_identifiers())
    debtors = f"select id from public.debtor where tenant = 1 and identifier in {ids}"
    persons = f"select person from public.debtor_person where debtor in ({debtors})"
    own_emails = in_list(email for _, email, _, _ in ACCOUNTS)
    users = f'select id from public."user" where email in {in_list([*(email for _, email, _, _ in ACCOUNTS), IMPORT_ACTOR_EMAIL])}'
    auth_users = f"select id from auth.users where email in {own_emails}"
    triples = in_list(f'{email}|{tenant}|{role}' for email, tenant, role in sorted(expected_memberships()))
    batches = (f"select id from public.import_batch where tenant = 1 and file_hashes->>'cabecera' = {sql_literal(hashes['cabecera'])}"
               f" and file_hashes->>'detalle' = {sql_literal(hashes['detalle'])}")
    reviews = f"select id from public.case_review where tenant = 1 and debtor in ({debtors})"
    cities = f"select city from public.address where person in ({persons})"
    rules = {
        'public.tenant': f"(id = 1 and name = {sql_literal(TENANT_A)}) or (id <> 1 and name = {sql_literal(TENANT_B)})",
        'public.role': f"name in {in_list([*ROLE_DESCRIPTIONS, 'importador_sistema'])}",
        'public.user': f"id in ({users})",
        'public.tenant_user': ('status and (select u.email || \'|\' || t.name || \'|\' || r.name from public."user" u, public.tenant t, public.role r'
                               f' where u.id = tenant_user."user" and t.id = tenant_user.tenant and r.id = tenant_user.role) in {triples}'),
        'public.debtor': f"tenant = 1 and identifier in {ids}",
        'public.debt': f"debtor in ({debtors})",
        'public.debtor_person': f"debtor in ({debtors})",
        'public.person': f"id in ({persons})",
        'public.debtor_contact': f"person in ({persons})",
        'public.address': f"person in ({persons})",
        'public.city': f"id in ({cities})",
        'public.province': f"id in (select province from public.city where id in ({cities}))",
        'public.debtor_profile': f"debtor in ({debtors})",
        'public.debtor_profile_detail': f"debtor_profile in (select id from public.debtor_profile where debtor in ({debtors}))",
        'public.import_batch': f"id in ({batches})",
        'public.import_publication': f"batch_id in ({batches})",
        'public.case_review': f"id in ({reviews}) and reviewer in ({users})",
        'public.case_review_approval': f"case_review in ({reviews}) and approver in ({users})",
        'public.access_audit': f"tenant in (select id from public.tenant where name in {in_list([TENANT_A, TENANT_B])}) and actor in ({users})",
        'equitas_import_private.object_version': f"(tenant, object_type, external_id) in (select tenant, type, external_id from public.debtor where tenant = 1 and identifier in {ids})",
        'equitas_import_private.person_version': f"external_id in (select external_id from public.person where id in ({persons}))",
        'auth.users': f"email in {own_emails}",
        'auth.identities': f"user_id in ({auth_users})",
        'auth.sessions': f"user_id in ({auth_users})",
        'auth.refresh_tokens': f"user_id in (select id::text from auth.users where email in {own_emails})",
        'auth.mfa_amr_claims': f"session_id in (select id from auth.sessions where user_id in ({auth_users}))",
        'auth.audit_log_entries': f"payload->>'actor_id' in (select id::text from auth.users where email in {own_emails})",
        'cron.job': f"jobname in {in_list(CRON_JOBS)}",
        'cron.job_run_details': f"jobid in (select jobid from cron.job where jobname in {in_list(CRON_JOBS)})",
        'supabase_migrations.schema_migrations': f"version in {in_list(repo_migrations())}",
    }
    for table, (key, pairs) in catalog_seeds().items():
        rules[f'public.{table}'] = '(id, ' + key + ') in (' + ', '.join(f'({number}, {sql_literal(value)})' for number, value in pairs) + ')'
    return rules


# Tablas cuyo tamaño fija el manifiesto: 0 (sin demo) o exactamente lo esperado.
def manifest_counts() -> dict[str, int]:
    expected = manifest()['resultados_esperados']
    return {'public.debtor': expected['objetos'], 'public.debt': expected['obligaciones'], 'public.person': expected['personas'],
            'public.debtor_person': expected['relaciones_objeto_persona'], 'public.debtor_profile': expected['objetos']}


def exhaustive_inventory(home: Path, hashes: dict[str, str]) -> dict:
    """Cuenta cada tabla de cada esquema (lo que borraría db reset) y cuántas filas no son demostrablemente propias."""
    listing = psql("select table_schema || '.' || table_name from information_schema.tables where table_type = 'BASE TABLE' "
                   "and table_schema not in ('pg_catalog', 'information_schema') and table_schema not like 'pg\\_toast%' order by 1;",
                   home=home, read_only=True).splitlines()
    rules = ownership_rules(hashes)
    parts = []
    for name in listing:
        schema, table = name.split('.', 1)
        quoted = f'"{schema}"."{table}"'
        if name in rules:
            foreign = f'(select count(*) from {quoted} where not coalesce(({rules[name]}), false))'
        elif name in PRISTINE_BOOKKEEPING:
            foreign = f'(select case when count(*) = {PRISTINE_BOOKKEEPING[name]} then 0 else count(*) end from {quoted})'
        else:
            foreign = f'(select count(*) from {quoted})'
        parts.append(f"json_build_object('t', {sql_literal(name)}, 'rows', (select count(*) from {quoted}), 'foreign', {foreign})")
    query = ("select json_build_object('tables', json_build_array(" + ', '.join(parts) + "), "
             "'databases', (select json_agg(datname order by datname) from pg_database), "
             "'largeobjects', (select count(*) from pg_largeobject_metadata))")
    report = psql_json(query, home=home, read_only=True, timeout=300)
    report['reglas'] = sorted(rules)
    return report


def recreate_blockers(report: dict) -> list[str]:
    """Todo lo que impide borrar: una sola fila sin pertenencia demostrada alcanza para no hacer nada."""
    blockers = [f"{item['t']}: {item['foreign']} de {item['rows']} filas sin pertenencia demostrable"
                for item in report['tables'] if item['foreign']]
    counts = {item['t']: item['rows'] for item in report['tables']}
    for table, expected in manifest_counts().items():
        if counts.get(table, 0) not in (0, expected):
            blockers.append(f'{table}: {counts.get(table)} filas; la demo tiene 0 o {expected}')
    if sorted(report['databases']) != sorted(KNOWN_DATABASES):
        blockers.append('el clúster tiene bases de datos que el stack no crea')
    if report['largeobjects']:
        blockers.append(f"{report['largeobjects']} objetos grandes (large objects)")
    return blockers


def repo_migrations() -> list[str]:
    return sorted(path.name.split('_', 1)[0] for path in (ROOT / 'supabase/migrations').glob('*.sql'))


def check_migrations(inv: dict) -> None:
    expected = repo_migrations()
    applied = inv['migrations']
    if applied == expected:
        return
    if set(applied) - set(expected):
        raise DemoError('La base local tiene migraciones que este repositorio no conoce; no se modifica.')
    raise DemoError('Faltan migraciones locales. Aplicalas sin resetear con: '
                    'npx --yes supabase@2.108.0 migration up --local (y repetí init).')


# ------------------------------------------------------------------ turno compartido de la base

_TURN: dict[str, str | None] = {'nonce': None}


@contextlib.contextmanager
def db_turn(purpose: str):
    """El mismo turno que usan las campañas (mkdir atómico). Reentrante en este proceso; solo libera el propio."""
    if _TURN['nonce'] is not None:
        yield
        return
    SHARED_LOCK.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        SHARED_LOCK.mkdir(mode=0o700)
    except FileExistsError:
        raise DemoError(f'La base local está en uso por otra campaña ({SHARED_LOCK} existe). Esperá a que termine.') from None
    nonce = secrets.token_hex(8)
    owner = SHARED_LOCK / 'owner.json'
    write_private(owner, json.dumps({'tool': 'equitas-demo', 'purpose': purpose, 'pid': os.getpid(), 'nonce': nonce,
                                     'inode': SHARED_LOCK.stat().st_ino, 'at_utc': utc_now().isoformat()}))
    _TURN['nonce'] = nonce
    try:
        yield
    finally:
        _TURN['nonce'] = None
        with contextlib.suppress(FileNotFoundError, json.JSONDecodeError):
            if json.loads(owner.read_text()).get('nonce') == nonce:
                owner.unlink()
                SHARED_LOCK.rmdir()


# ------------------------------------------------------------------ credenciales

def jwt_tools():
    spec = importlib.util.spec_from_file_location('case_review_local', ROOT / 'database/testing/case_review_local.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def mint_jwt(env: dict[str, str], role: str, hours: float) -> tuple[str, datetime]:
    tools = jwt_tools()
    claims = tools.server_claims(role, hours)
    return tools.sign_jwt(env['JWT_SECRET'], claims), datetime.fromtimestamp(claims['exp'], UTC)


def load_credentials(home: Path) -> dict:
    path = home / 'cuentas.json'
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}


def save_credentials(home: Path, credentials: dict, base_url: str) -> None:
    write_private(home / 'cuentas.json', json.dumps(credentials, ensure_ascii=False, indent=2) + '\n')
    lines = ['EQUITAS demo local V1 (noche 6). Cuentas sintéticas solo para la base local. No compartir.',
             f'App: {base_url}/login', '']
    for key, email, role, tenant in ACCOUNTS:
        entry = credentials.get(key, {})
        password = entry.get('password') or 'desconocida: ejecutar init --rotar-claves'
        scope = f'{role} en {tenant}' if role else 'sin membresía (debe ser rechazada)'
        lines.append(f'{key:14} {email:36} {password:28} {scope}')
    write_private(home / 'cuentas.txt', '\n'.join(lines) + '\n')


def accounts_sql(passwords: dict[str, str], rotate: set[str]) -> str:
    """Crea o completa cuentas propias. Nunca cambia un rol existente: si difiere, falla sin cambios."""
    parts = ['begin;']
    values = ', '.join(f'({sql_literal(name)}, {sql_literal(text)})' for name, text in ROLE_DESCRIPTIONS.items())
    parts.append(f"""insert into public.role(id, name, description)
select coalesce((select max(id) from public.role), 0) + row_number() over (order by r.name), r.name, r.description
from (values {values}) r(name, description) where not exists (select 1 from public.role x where x.name = r.name);""")
    parts.append(f"""insert into public.tenant(name) select {sql_literal(TENANT_B)}
where not exists (select 1 from public.tenant where name = {sql_literal(TENANT_B)});""")
    for key, email, role, tenant in ACCOUNTS:
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
        label = sql_literal(f'Cuenta demo N6 ({key})')
        parts.append(f"""insert into public."user"(auth_user, full_name, email) select u.id, {label}, {mail}
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
        parts.append(f"""insert into public.tenant_user(tenant, "user", role)
select t.id, pu.id, r.id from public.tenant t, public."user" pu, public.role r
where t.name = {sql_literal(tenant)} and pu.email = {mail} and r.name = {sql_literal(role)}
on conflict (tenant, "user") do nothing;
do $$ begin
  if not exists (select 1 from public.tenant_user tu join public."user" pu on pu.id = tu."user"
                 join public.tenant t on t.id = tu.tenant join public.role r on r.id = tu.role
                 where pu.email = {mail} and t.name = {sql_literal(tenant)} and r.name = {sql_literal(role)} and tu.status) then
    raise exception 'MEMBRESIA_INESPERADA';
  end if;
end $$;""")
    parts.append('commit;')
    return '\n'.join(parts)


def new_password() -> str:
    return secrets.token_hex(12) + 'Aa1!'


# ------------------------------------------------------------------ cartera

def etl_env(env: dict[str, str], import_jwt: str, actor: str) -> dict[str, str]:
    return {'PATH': os.environ.get('PATH', ''), 'HOME': str(Path.home()), 'PYTHONDONTWRITEBYTECODE': '1',
            'EQUITAS_TARGET_ENV': 'local', 'SUPABASE_URL': check_api_url(env['API_URL']),
            'SUPABASE_SERVICE_ROLE_KEY': env['SERVICE_ROLE_KEY'], 'SUPABASE_ANON_KEY': env['ANON_KEY'],
            'EQUITAS_IMPORT_SERVER_JWT': import_jwt, 'EQUITAS_IMPORT_ACTOR_USER': actor}


def published_batches(inv: dict, hashes: dict[str, str]) -> list[dict]:
    return [b for b in inv['batches'] if b['tenant'] == 1 and b['status'] == 'PUBLICADO'
            and b['cabecera'] == hashes['cabecera'] and b['detalle'] == hashes['detalle']]


def backend_python() -> str:
    python = BACK / '.venv/bin/python'
    if not python.exists():
        raise DemoError('Falta back/.venv. Crealo según docs/entrega/noche-6/README.md (uv venv + requirements).')
    return str(python)


def publish_portfolio(home: Path, env: dict[str, str], hashes: dict[str, str]) -> dict:
    expected = manifest()
    python = backend_python()
    validation = home / 'validacion' / utc_now().strftime('%Y%m%dT%H%M%SZ')
    log = private_log(home, 'etl-validate')
    result = run([python, '-m', 'ETL.validate_source', '--folder', str(FIXTURE), '--mapping', str(MAPPING),
                  '--contract', str(CONTRACT), '--cut-off', expected['fecha_corte'], '--output', str(validation)],
                 cwd=BACK, env={'PATH': os.environ.get('PATH', ''), 'PYTHONDONTWRITEBYTECODE': '1'}, timeout=600, log=log)
    report = json.loads((validation / 'report.json').read_text(encoding='utf-8')) if (validation / 'report.json').exists() else {}
    if result.returncode != 0 or report.get('resultado_lote') != 'VALIDADO' or report.get('publicacion_permitida') is not True:
        raise DemoError(f'La validación de la cartera demo no dio VALIDADO; ver {log} y {validation}.')
    actor = psql((ROOT / 'database/testing/etl-import-actor.sql').read_text(encoding='utf-8'), home=home).splitlines()[-1]
    import_jwt, _ = mint_jwt(env, 'equitas_import_server', 1)
    log = private_log(home, 'etl-load')
    result = run([python, '-m', 'ETL.run_etl', '--folder', str(FIXTURE), '--mapping', str(MAPPING), '--execute',
                  '--cut-off', expected['fecha_corte']], cwd=BACK, env=etl_env(env, import_jwt, actor), timeout=900, log=log)
    if result.returncode != 0:
        raise DemoError(f'La carga ETL falló (exit {result.returncode}); salida en el log privado {log}.')
    return report


def check_portfolio(inv: dict, hashes: dict[str, str]) -> list[str]:
    """Diferencias entre la base y el manifiesto (vacía si la cartera demo está completa)."""
    expected = manifest()['resultados_esperados']
    problems = []
    if not published_batches(inv, hashes):
        problems.append('no hay un lote PUBLICADO con los archivos de la cartera demo')
    if inv['demo_debtors'] != expected['objetos']:
        problems.append(f"objetos demo {inv['demo_debtors']} (esperados {expected['objetos']})")
    if inv['demo_debts'] != expected['obligaciones']:
        problems.append(f"obligaciones demo {inv['demo_debts']} (esperadas {expected['obligaciones']})")
    if Decimal(inv['demo_amount']) != Decimal(expected['importe_total_actualizado_ars']):
        problems.append(f"importe demo {inv['demo_amount']} (esperado {expected['importe_total_actualizado_ars']})")
    latest = [b for b in inv['batches'] if b['tenant'] == 1 and b['status'] in ('PUBLICADO', 'VALIDADO', 'FALLIDO')]
    if latest and (latest[-1]['status'] != 'PUBLICADO' or latest[-1]['atomica'] != 1):
        problems.append('el último evento del municipio no es una publicación atómica (corte no disponible)')
    return problems


# ------------------------------------------------------------------ app Next

def run_file(home: Path) -> Path:
    return home / 'run' / 'next.json'


def git(*args: str) -> str:
    result = run(['git', *args], timeout=60)
    return result.stdout.strip() if result.returncode == 0 else ''


def build_stamp(env: dict[str, str]) -> dict:
    public = f"{env['API_URL']}\n{env['PUBLISHABLE_KEY']}".encode()
    status = git('status', '--porcelain', '--', 'front', 'contracts')
    return {'sha': git('rev-parse', 'HEAD'), 'cambios_locales_sha256': hashlib.sha256(status.encode()).hexdigest(),
            'publico_sha256': hashlib.sha256(public).hexdigest()}


def ensure_build(home: Path, env: dict[str, str], force: bool = False) -> None:
    if not (FRONT / 'node_modules/next/dist/bin/next').exists():
        raise DemoError('Faltan las dependencias del front. Instalalas con npm 11.21.1: cd front && npm ci --ignore-scripts')
    stamp_path = FRONT / '.next/equitas-demo-build.json'
    stamp = build_stamp(env)
    current = json.loads(stamp_path.read_text(encoding='utf-8')) if stamp_path.exists() else None
    # La huella no ve contenidos: con cambios sin confirmar en front/ o contracts/ se recompila siempre.
    dirty = bool(git('status', '--porcelain', '--', 'front', 'contracts'))
    if not force and not dirty and current == stamp and (FRONT / '.next/BUILD_ID').exists():
        return
    if dirty:
        say('Hay cambios sin confirmar en front/ o contracts/: se recompila.')
    say('Compilando la app (next build) con la configuración pública local; puede tardar unos minutos.')
    build_env = {'PATH': os.environ.get('PATH', ''), 'HOME': str(Path.home()), 'NEXT_TELEMETRY_DISABLED': '1',
                 'NEXT_PUBLIC_SUPABASE_URL': check_api_url(env['API_URL']),
                 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY': env['PUBLISHABLE_KEY'], 'QUALITY_SOURCE_SHA': stamp['sha']}
    log = private_log(home, 'next-build')
    result = run(['node', 'node_modules/next/dist/bin/next', 'build'], cwd=FRONT, env=build_env, timeout=1800, log=log)
    if result.returncode != 0:
        raise DemoError(f'next build falló (exit {result.returncode}); salida en el log privado {log}.')
    stamp_path.write_text(json.dumps(stamp, indent=2) + '\n', encoding='utf-8')


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


def own_next(home: Path) -> dict | None:
    """Datos del Next propio solo si el PID sigue vivo, es `next start` y corre en este front/."""
    path = run_file(home)
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
    cwd = process_cwd(pid)
    # Next renombra su proceso a «next-server (vX)»; el arranque original dice «next ... start».
    is_next = 'next-server' in command or ('next' in command and 'start' in command)
    if not is_next or cwd is None or Path(cwd).resolve() != FRONT.resolve():
        return None
    return data


def port_busy(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(1)
        return probe.connect_ex(('127.0.0.1', port)) == 0


def start_next(home: Path, env: dict[str, str], port: int, hours: float) -> dict:
    if port_busy(port):
        raise DemoError(f'El puerto {port} ya está en uso por otro proceso; elegí otro con --puerto.')
    review_jwt, expires = mint_jwt(env, 'equitas_review_server', hours)
    log = home / 'run' / 'next.log'
    if not log.exists():
        write_private(log, '')
    server_env = {'PATH': os.environ.get('PATH', ''), 'HOME': str(Path.home()), 'NODE_ENV': 'production',
                  'NEXT_TELEMETRY_DISABLED': '1', 'NEXT_PUBLIC_SUPABASE_URL': check_api_url(env['API_URL']),
                  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY': env['PUBLISHABLE_KEY'], 'EQUITAS_REVIEW_SERVER_JWT': review_jwt,
                  'QUALITY_SOURCE_SHA': git('rev-parse', 'HEAD')}
    with open(log, 'a', encoding='utf-8') as handle:
        process = subprocess.Popen(['node', 'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1',
                                    '--port', str(port)], cwd=FRONT, env=server_env, stdin=subprocess.DEVNULL,
                                   stdout=handle, stderr=handle, start_new_session=True)
    data = {'pid': process.pid, 'port': port, 'url': f'http://127.0.0.1:{port}', 'started_at_utc': utc_now().isoformat(),
            'jwt_expires_at_utc': expires.isoformat(), 'sha': git('rev-parse', 'HEAD'), 'front': str(FRONT)}
    write_private(run_file(home), json.dumps(data, indent=2) + '\n')
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise DemoError(f'next start terminó (exit {process.returncode}); ver el log privado {log}.')
        if http_status(f"{data['url']}/login") == 200:
            return data
        time.sleep(1)
    stop_next(home)
    raise DemoError(f'La app no respondió en {data["url"]}/login; ver el log privado {log}.')


def stop_next(home: Path) -> bool:
    data = own_next(home)
    if data is None:
        with contextlib.suppress(FileNotFoundError):
            run_file(home).unlink()
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
        run_file(home).unlink()
    return True


# ------------------------------------------------------------------ comandos

def prepare(home: Path) -> dict[str, str]:
    guard_environment()
    ensure_stack(home)
    env = supabase_env(home)
    wait_ready(env)
    return env


def cmd_init(args) -> int:
    home = demo_home()
    with db_turn('init'):  # antes de tocar el stack: con una campaña en curso no se arranca ni se escribe nada
        env = prepare(home)
        hashes = fixture_hashes()
        inv = inventory(home)
        check_migrations(inv)
        foreign = classify(inv, hashes)
        if 'objetos_tenant_1' in foreign or any(b['tenant'] == 1 for b in inv['batches'] if str(b['id']) in foreign.get('lotes', [])):
            raise DemoError('El municipio 1 (el del ETL) ya tiene objetos o lotes que no son de la demo. No se tocan: '
                            'publicar la demo los mezclaría. Revisá la base o usá otra instalación local.')
        tenant_one = [t for t in inv['tenants'] if t['id'] == 1]
        if tenant_one and tenant_one[0]['name'] != TENANT_A:
            raise DemoError('El municipio 1 existe con otro nombre: no es el municipio sintético del ETL. No se modifica.')
        psql((ROOT / 'database/testing/etl-compat-catalogs.sql').read_text(encoding='utf-8'), home=home)
        credentials = load_credentials(home)
        existing = set(inv['auth_emails'])
        rotate = {key for key, *_ in ACCOUNTS} if args.rotar_claves else set()
        passwords = {}
        for key, email, role, tenant in ACCOUNTS:
            if email not in existing or key in rotate:
                passwords[key] = new_password()
        psql(accounts_sql(passwords, rotate), home=home, secrets_in_sql=tuple(passwords.values()))
        for key, email, role, tenant in ACCOUNTS:
            entry = credentials.get(key, {})
            entry.update(email=email, rol=role, municipio=tenant)
            if key in passwords:
                entry['password'] = passwords[key]
            elif email in existing and not entry.get('password'):
                entry['password'] = None
            credentials[key] = entry
        save_credentials(home, credentials, f'http://127.0.0.1:{args.puerto}')
        inv = inventory(home)
        if published_batches(inv, hashes) and not args.republicar:
            say('Cartera demo ya publicada con los mismos archivos: no se vuelve a cargar.')
        else:
            say('Validando y publicando la cartera demo con el ETL real (validate_source + run_etl --execute).')
            publish_portfolio(home, env, hashes)
            inv = inventory(home)
        problems = check_portfolio(inv, hashes)
        state = {'version': manifest()['version'], 'dataset_sha256': manifest()['dataset_sha256'], 'checked_at_utc': utc_now().isoformat(),
                 'sha': git('rev-parse', 'HEAD'), 'objetos': inv['demo_debtors'], 'obligaciones': inv['demo_debts'],
                 'importe': inv['demo_amount'], 'lotes_publicados': [b['id'] for b in published_batches(inv, hashes)],
                 'decisiones': inv['reviews'], 'aprobaciones': inv['approvals'], 'recursos_ajenos_conservados': classify(inv, hashes),
                 'problemas': problems}
        write_private(home / 'estado-init.json', json.dumps(state, ensure_ascii=False, indent=2) + '\n')
    if problems:
        raise DemoError('La cartera demo no quedó completa: ' + '; '.join(problems))
    say(f"Demo inicializada: {inv['demo_debtors']} objetos, {inv['demo_debts']} obligaciones, ARS {inv['demo_amount']}, "
        f"corte {manifest()['fecha_corte']}. Decisiones conservadas: {inv['reviews']}; aprobaciones: {inv['approvals']}.")
    if state['recursos_ajenos_conservados']:
        say('Hay recursos que no son de la demo; se conservaron sin cambios (ver estado-init.json).')
    say(f'Cuentas: {home / "cuentas.txt"} (privado). Siguiente paso: equitas_demo.py start')
    return 0


def cmd_start(args) -> int:
    home = demo_home()
    env = prepare(home)
    inv = inventory(home)
    problems = check_portfolio(inv, fixture_hashes())
    if problems:
        raise DemoError('La base no tiene la cartera demo completa (' + '; '.join(problems) + '). '
                        'start no siembra datos: ejecutá init de forma explícita.')
    running = own_next(home)
    if running and not args.reiniciar:
        expires = datetime.fromisoformat(running['jwt_expires_at_utc'])
        if expires - utc_now() > RENEW_MARGIN and running['sha'] == git('rev-parse', 'HEAD'):
            say(f"La app ya está en marcha: {running['url']}/login (credencial de servidor vigente hasta {expires:%Y-%m-%d %H:%M} UTC).")
            return 0
        say('La app estaba en marcha con una credencial por vencer o de otro commit: se reinicia.')
    stop_next(home)
    ensure_build(home, env, force=args.rebuild)
    data = start_next(home, env, args.puerto, args.horas)
    say(f"App lista: {data['url']}/login")
    say(f"Credencial de servidor nueva, vigente hasta {data['jwt_expires_at_utc'][:16].replace('T', ' ')} UTC (renew la renueva).")
    say(f"Cartera: {inv['demo_debtors']} objetos, corte {manifest()['fecha_corte']}; decisiones {inv['reviews']}, aprobaciones {inv['approvals']}.")
    say(f'Cuentas: {home / "cuentas.txt"} (privado). Detener: equitas_demo.py stop')
    return 0


def cmd_stop(args) -> int:
    home = demo_home()
    say('App de la demo detenida.' if stop_next(home) else 'No había una app de la demo en marcha (no se tocó ningún otro proceso).')
    if args.stack:
        guard_environment()
        if docker_ready() and stack_running():
            with db_turn('stop-stack'):  # nunca se detiene el stack durante una campaña o un init ajenos
                result = run([*CLI, 'stop'], env=cli_env(), timeout=600, log=private_log(home, 'supabase-stop'))
            if result.returncode != 0:
                raise DemoError('supabase stop falló; ver el log saneado en logs/.')
            say('Supabase local detenido. Los datos quedan en el volumen de Docker (no se usó --no-backup).')
        else:
            say('Supabase local ya estaba detenido.')
    return 0


def cmd_status(args) -> int:
    home = demo_home()
    guard_environment()
    if not docker_ready() or not stack_running():
        say('Supabase local: detenido (los datos se conservan en el volumen). Arrancar: equitas_demo.py start')
        return 1
    env = supabase_env(home)
    inv = inventory(home)
    hashes = fixture_hashes()
    problems = check_portfolio(inv, hashes)
    say(f"Supabase local: en marcha ({check_api_url(env['API_URL'])}); migraciones {len(inv['migrations'])}.")
    say(f"Cartera demo: {inv['demo_debtors']} objetos, {inv['demo_debts']} obligaciones, ARS {inv['demo_amount']}"
        f" -> {'completa' if not problems else 'INCOMPLETA: ' + '; '.join(problems)}.")
    say(f"Decisiones: {inv['reviews']}; aprobaciones: {inv['approvals']}; registros de auditoría: {inv['audit']}.")
    running = own_next(home)
    if running:
        say(f"App: {running['url']}/login (pid {running['pid']}); credencial de servidor hasta {running['jwt_expires_at_utc'][:16]} UTC.")
    else:
        say('App: detenida. Arrancar: equitas_demo.py start')
    foreign = classify(inv, hashes)
    if foreign:
        say('Recursos ajenos a la demo (conservados): ' + ', '.join(f'{k}={len(v)}' for k, v in foreign.items()))
    return 0 if not problems and running else 1


def cmd_renew(args) -> int:
    args.reiniciar, args.rebuild = True, False
    return cmd_start(args)


def cmd_recreate(args) -> int:
    if args.confirmar != RECREATE_PHRASE:
        raise DemoError(f'Recrear borra la base local. Repetí con --confirmar {RECREATE_PHRASE} si es lo que querés.')
    home = demo_home()
    with db_turn('recrear'):
        prepare(home)
        hashes = fixture_hashes()
        check_migrations(inventory(home))
        report = exhaustive_inventory(home, hashes)
        blockers = recreate_blockers(report)
        write_private(home / 'recrear-inventario.json', json.dumps({**report, 'bloqueos': blockers, 'at_utc': utc_now().isoformat()},
                                                                  ensure_ascii=False, indent=2) + '\n')
        if blockers:
            shown = '; '.join(blockers[:6]) + (f' y {len(blockers) - 6} más' if len(blockers) > 6 else '')
            raise DemoError(f'No se borra nada: la base tiene datos cuya pertenencia a la demo no se puede demostrar ({shown}). '
                            f'Detalle sin secretos en {home / "recrear-inventario.json"}.')
        stop_next(home)
        result = run([*CLI, 'db', 'reset', '--local'], env=cli_env(), timeout=1800, log=private_log(home, 'db-reset'))
        if result.returncode != 0:
            raise DemoError('db reset --local falló; ver el log saneado en logs/.')
        with contextlib.suppress(FileNotFoundError):
            (home / 'cuentas.json').unlink()
        env = supabase_env(home)
        wait_ready(env)
        args.rotar_claves, args.republicar = False, False
        return cmd_init(args)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    init = commands.add_parser('init', help='inicialización sintética explícita e idempotente')
    init.add_argument('--rotar-claves', action='store_true', help='regenera las contraseñas de las cuentas demo')
    init.add_argument('--republicar', action='store_true', help='vuelve a ejecutar el ETL aunque el lote ya esté publicado')
    init.add_argument('--puerto', type=int, default=DEFAULT_PORT)
    start = commands.add_parser('start', help='arranque normal sin borrar ni sembrar')
    renew = commands.add_parser('renew', help='credencial de servidor nueva y reinicio de la app')
    for sub in (start, renew):
        sub.add_argument('--puerto', type=int, default=DEFAULT_PORT)
        sub.add_argument('--horas', type=float, default=DEFAULT_JWT_HOURS, help=f'vigencia del JWT de servidor (máximo {MAX_JWT_HOURS})')
    start.add_argument('--reiniciar', action='store_true')
    start.add_argument('--rebuild', action='store_true', help='fuerza next build')
    stop = commands.add_parser('stop', help='detiene la app de la demo')
    stop.add_argument('--stack', action='store_true', help='también detiene Supabase local (conserva los datos)')
    commands.add_parser('status', help='estado, solo lectura')
    recreate = commands.add_parser('recrear', help='borra y recrea solo si todo es de la demo')
    recreate.add_argument('--confirmar', default='')
    recreate.add_argument('--puerto', type=int, default=DEFAULT_PORT)
    args = parser.parse_args(argv)
    if getattr(args, 'horas', 1) <= 0 or getattr(args, 'horas', 1) > MAX_JWT_HOURS:
        parser.error(f'--horas debe estar entre 0 y {MAX_JWT_HOURS}')
    handlers = {'init': cmd_init, 'start': cmd_start, 'stop': cmd_stop, 'status': cmd_status, 'renew': cmd_renew,
                'recrear': cmd_recreate}
    try:
        return handlers[args.command](args)
    except DemoError as error:
        print(f'ERROR: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
