"""Espejo local de la base ORIGINAL de EQUITAS (noche 7, encargo 10.1). Solo para ensayar compatibilidad.

Es un proyecto Supabase LOCAL propio (otro identificador, otros puertos y otra carpeta privada). Reproduce lo
comprobado de la base original y, donde no hay nada más reciente, la foto del catálogo de octubre
(database/schema-observado-2026-10-21.json). NO es idéntico a producción: la lista de lo comprobado, lo tomado
de la foto y lo desconocido está en docs/entrega/noche-7/anexos/espejo-comprobado-foto-desconocido.md.

Datos: sintéticos, cargados por SQL. Sirven para probar consultas, permisos y rendimiento. NO verifican el
recorrido de archivos (eso se acepta solo en el entorno de scripts/local/equitas_local.py).

Comandos (desde la raíz del repositorio, con el Python del backend):
  back/.venv/bin/python scripts/espejo/equitas_espejo.py start                 crea o arranca el espejo
  back/.venv/bin/python scripts/espejo/equitas_espejo.py stop                  lo detiene (conserva los datos)
  back/.venv/bin/python scripts/espejo/equitas_espejo.py status                estado, solo lectura
  back/.venv/bin/python scripts/espejo/equitas_espejo.py verificar-esquema     compara columnas y restricciones con la foto
  back/.venv/bin/python scripts/espejo/equitas_espejo.py cargar chico|escala   reemplaza la cartera sintética del municipio 1
  back/.venv/bin/python scripts/espejo/equitas_espejo.py probar-lectura        qué lee cada cuenta por la Data API (solo conteos)
  back/.venv/bin/python scripts/espejo/equitas_espejo.py sql ARCHIVO [--solo-lectura] [--ajuste equitas.nombre=valor]
                                                                               corre un archivo de database/espejo/
  back/.venv/bin/python scripts/espejo/equitas_espejo.py recrear --confirmar equitas-n7-espejo
                                                                               borra el espejo (es descartable)

Nunca toca la demo de la noche 6 ni el entorno de aceptación de la noche 7: se niega a operar sobre sus
identificadores y carpetas. Nada de esto se aplica a una base remota.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import secrets
import shutil
import signal
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SQL_DIR = ROOT / 'database/espejo'
SNAPSHOT = ROOT / 'database/schema-observado-2026-10-21.json'
BASE_MIGRATION = ROOT / 'supabase/migrations/20261021220156_equitas_testing_schema.sql'
SMALL_CASES = ROOT / 'contracts/portfolio-small-cases.v1.json'
CLI = ('npx', '--yes', 'supabase@2.108.0')
PROJECT_ID = 'equitas-n7-espejo'
DB_CONTAINER = f'supabase_db_{PROJECT_ID}'
API_PORT, DB_PORT, SHADOW_PORT, APP_PORT = 56321, 56322, 56320, 3200
FORBIDDEN_PROJECT_IDS = ('equitas-tp-testing', 'equitas-n7-local', 'equitas-n7-campanas')
FORBIDDEN_HOMES = ('.equitas-demo', '.equitas-n7', '.equitas-n7-campanas')
REMOTE_MARKERS = ('supabase.co', 'folyslqzqvnpolexcxjo', 'iylwghgvtydpmwidojdo')
TENANT_A, TENANT_B = 'Municipio sintético A (espejo)', 'Municipio sintético B (espejo)'

# Cuentas sintéticas del espejo: (clave, correo, nombre, rol, municipio, membresía activa).
ACCOUNTS = (
    ('admin', 'espejo-admin@example.test', 'Admin (espejo, sintética)', 'ADMIN', 1, True),
    ('user', 'espejo-user@example.test', 'Usuario (espejo, sintética)', 'USER', 1, True),
    ('user-otro-municipio', 'espejo-user-otro@example.test', 'Usuario del municipio B (espejo)', 'USER', 2, True),
    ('sin-membresia', 'espejo-sin-membresia@example.test', 'Sin membresía (espejo)', None, None, None),
    ('membresia-inactiva', 'espejo-inactiva@example.test', 'Membresía inactiva (espejo)', 'USER', 1, False),
)


class MirrorError(RuntimeError):
    pass


def say(message: str = '') -> None:
    print(message, flush=True)


def home_dir() -> Path:
    home = Path(os.environ.get('EQUITAS_ESPEJO_HOME') or Path.home() / '.equitas-n7-espejo').expanduser().absolute()
    resolved = home.resolve()
    if home.is_symlink() or resolved == ROOT.resolve() or ROOT.resolve() in resolved.parents:
        raise MirrorError('La carpeta privada del espejo no puede ser un enlace ni estar dentro del repositorio.')
    if any(part in FORBIDDEN_HOMES for part in resolved.parts):
        raise MirrorError('DETENERSE: esa carpeta pertenece a otro entorno que se conserva. Usá otra.')
    for path in (home, home / 'logs', home / 'proyecto'):
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(path, 0o700)
    return home


def guard() -> None:
    if PROJECT_ID in FORBIDDEN_PROJECT_IDS:
        raise MirrorError('DETENERSE: identificador de otro entorno.')
    if any(marker in value.casefold() for value in os.environ.values() for marker in REMOTE_MARKERS):
        raise MirrorError('DETENERSE: una variable de entorno nombra un proyecto Supabase remoto (no se muestra cuál).')


def write_private(path: Path, text: str) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, stat.S_IRUSR | stat.S_IWUSR)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
        handle.write(text)
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)


def run(command, *, stdin: str | None = None, timeout: int = 180, env: dict | None = None) -> subprocess.CompletedProcess:
    """Sin shell. Si vence el tiempo mata el grupo entero (la CLI deja hijos)."""
    process = subprocess.Popen(list(command), cwd=ROOT, env=env, text=True, start_new_session=True,
                               stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        out, err = process.communicate(stdin, timeout=timeout)
    except subprocess.TimeoutExpired:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGKILL)
        process.communicate()
        raise MirrorError(f'Tiempo máximo agotado ({timeout} s): {command[0]}') from None
    return subprocess.CompletedProcess(command, process.returncode, out, err)


def cli(home: Path, *args: str, timeout: int = 1800) -> subprocess.CompletedProcess:
    env = dict(os.environ, DO_NOT_TRACK='1', SUPABASE_TELEMETRY_DISABLED='1')
    result = run([*CLI, '--workdir', str(home / 'proyecto'), *args], timeout=timeout, env=env)
    log = home / 'logs' / f'{time.strftime("%Y%m%dT%H%M%S")}-supabase-{args[0]}.log'
    # La salida de la CLI incluye claves locales: va a un archivo privado, nunca a la terminal.
    write_private(log, (result.stdout or '') + (result.stderr or ''))
    if result.returncode != 0:
        raise MirrorError(f'supabase {args[0]} falló (exit {result.returncode}); salida en {log}.')
    return result


def running() -> bool:
    result = run(['docker', 'inspect', '-f', '{{.State.Running}}', DB_CONTAINER], timeout=60)
    return result.returncode == 0 and result.stdout.strip() == 'true'


def require_running() -> None:
    if not running():
        raise MirrorError('El espejo está detenido. Arrancalo: scripts/espejo/equitas_espejo.py start')


def psql(text: str, *, read_only: bool = False, timeout: int = 900, tuples: bool = True) -> str:
    """psql del contenedor del ESPEJO, por stdin. Como postgres, igual que el editor SQL de un proyecto alojado."""
    command = ['docker', 'exec', '-i', DB_CONTAINER, 'psql', '-X', '-q', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
    if tuples:
        command += ['-At', '-F', '|']
    body = f'begin transaction read only;\n{text}\nrollback;\n' if read_only else text
    result = run(command, stdin=body, timeout=timeout)
    if result.returncode != 0:
        lines = [line for line in result.stderr.splitlines() if re.search(r'ERROR|DETAIL|HINT', line)]
        raise MirrorError('Falló el SQL en el espejo:\n  ' + '\n  '.join(lines[-6:] or ['sin diagnóstico']))
    return result.stdout.rstrip('\n')


def literal(value) -> str:
    if value is None:
        return 'null'
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, (int, float)):
        return str(value)
    if '\x00' in value:
        raise MirrorError('Valor SQL inválido.')
    return "'" + value.replace("'", "''") + "'"


# ------------------------------------------------------------------ proyecto

CONFIG_TOML = f'''# Generado por scripts/espejo/equitas_espejo.py. ESPEJO local de la base original: descartable, datos sintéticos.
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
    """El espejo solo recibe el esquema base: ninguna de las migraciones posteriores del repositorio."""
    migrations = home / 'proyecto' / 'supabase' / 'migrations'
    migrations.mkdir(mode=0o700, parents=True, exist_ok=True)
    (home / 'proyecto' / 'supabase' / 'config.toml').write_text(CONFIG_TOML, encoding='utf-8')
    for stale in migrations.glob('*.sql'):
        if stale.name != BASE_MIGRATION.name:
            stale.unlink()
    shutil.copyfile(BASE_MIGRATION, migrations / BASE_MIGRATION.name)


def local_env(home: Path) -> dict[str, str]:
    result = cli(home, 'status', '-o', 'env', timeout=300)
    values = dict(re.findall(r'^([A-Z_]+)="?([^"\n]*)"?$', result.stdout, re.MULTILINE))
    if not values.get('API_URL', '').startswith(f'http://127.0.0.1:{API_PORT}'):
        raise MirrorError('El espejo no respondió en su puerto local.')
    write_private(home / 'supabase-espejo.env', ''.join(f'{key}="{value}"\n' for key, value in sorted(values.items())))
    # Lo que una aplicación local necesita para apuntar al espejo (valores locales; igual quedan en un archivo privado).
    write_private(home / 'app.env', f'NEXT_PUBLIC_SUPABASE_URL="{values["API_URL"]}"\n'
                  f'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="{values.get("PUBLISHABLE_KEY") or values.get("ANON_KEY", "")}"\n')
    return values


def wait_ready(env: dict[str, str], timeout: int = 300) -> None:
    key = env.get('PUBLISHABLE_KEY') or env['ANON_KEY']
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        ok = 0
        for path in ('/auth/v1/health', '/rest/v1/role?select=id&limit=1'):
            request = urllib.request.Request(env['API_URL'] + path, headers={'apikey': key})
            try:
                with urllib.request.urlopen(request, timeout=10) as response:
                    ok += response.status == 200
            except (urllib.error.URLError, OSError):
                pass
        if ok == 2:
            return
        time.sleep(2)
    raise MirrorError('Auth o la Data API del espejo no respondieron a tiempo.')


# ------------------------------------------------------------------ lo que la foto dice y la migración base no trae

def snapshot_adjustments() -> str:
    """Privilegios de la foto de octubre: `authenticated` podía insertar, modificar y borrar en las 23 tablas."""
    snapshot = json.loads(SNAPSHOT.read_text(encoding='utf-8'))
    parts = ['begin;']
    for row in snapshot['privileges']:
        table = '"' + row['table_name'] + '"'
        for flag, privilege in (('authenticated_insert', 'insert'), ('authenticated_update', 'update'), ('authenticated_delete', 'delete')):
            if row.get(flag):
                parts.append(f'grant {privilege} on public.{table} to authenticated;')
    parts.append('commit;')
    return '\n'.join(parts)


def accounts_sql(passwords: dict[str, str]) -> str:
    """Los id de la base original no tienen identidad comprobada: acá se asignan de forma explícita."""
    parts = ['begin;']
    for index, (key, email, name, role, tenant, active) in enumerate(ACCOUNTS, start=1):
        mail = literal(email)
        if key in passwords:
            parts.append(f"""insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', {mail},
  extensions.crypt({literal(passwords[key])}, extensions.gen_salt('bf', 10)), now(), '{{"provider":"email","providers":["email"]}}'::jsonb,
  '{{}}'::jsonb, now(), now(), '', '', '', ''
where not exists (select 1 from auth.users where email = {mail});
insert into auth.identities(provider_id, user_id, identity_data, provider, created_at, updated_at)
select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
  'email', now(), now() from auth.users u
where u.email = {mail} and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');""")
        parts.append(f"""insert into public."user"(id, auth_user, full_name, email)
select {100 + index}, u.id, {literal(name)}, {mail} from auth.users u where u.email = {mail} on conflict (email) do nothing;""")
        if role is not None:
            parts.append(f"""insert into public.tenant_user(id, tenant, "user", role, status)
select {100 + index}, {tenant}, {100 + index}, r.id, {literal(active)} from public.role r where r.name = {literal(role)}
on conflict (tenant, "user") do nothing;""")
    parts.append('commit;')
    return '\n'.join(parts)


def ensure_accounts(home: Path) -> None:
    path = home / 'cuentas.json'
    stored = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    existing = set(psql('select email from auth.users;', read_only=True).split())
    passwords = {key: secrets.token_hex(12) + 'Aa1!' for key, email, *_ in ACCOUNTS if email not in existing}
    psql(accounts_sql(passwords))
    for key, email, name, role, tenant, active in ACCOUNTS:
        entry = stored.get(key, {})
        entry.update(email=email, nombre=name, rol=role, municipio=tenant, membresia_activa=active)
        if key in passwords:
            entry['password'] = passwords[key]
        stored[key] = entry
    write_private(path, json.dumps(stored, ensure_ascii=False, indent=2) + '\n')


# ------------------------------------------------------------------ datos sintéticos

def small_cases_sql() -> str:
    """Los casos chicos de contracts/portfolio-small-cases.v1.json, con lo que el esquema de la base original admite."""
    contract = json.loads(SMALL_CASES.read_text(encoding='utf-8'))
    known = {1, 2, 3, 4, 5, 6, 7, 8}  # el catálogo de main no tiene 9 (SUSPENDED)
    rows = {name: [] for name in ('debtor', 'person', 'debtor_person', 'debtor_contact', 'debt')}
    for case in contract['casos']:
        debtor = case['objeto']['id']
        rows['debtor'].append(f"({debtor}, 1, {debtor}, 6, {literal(case['objeto']['identificador'])}, 'Caso chico sintético', true)")
        for holder in case['titulares']:
            rows['person'].append(f"({holder['id']}, {holder['id']}, 1, null, {literal('Persona sintética ' + str(holder['id']))}, 1, 1)")
            rows['debtor_person'].append(f"({holder['id']}, {debtor}, {holder['id']}, {literal(holder.get('porcentaje'))}, 'TITULAR', true)")
            for contact in holder.get('contactos', []):
                rows['debtor_contact'].append(f"({contact['id']}, {holder['id']}, 3, {literal(contact['valor'])}, true)")
        for debt in case['obligaciones']:
            status = debt.get('estado_id')
            # Suspendida (9) no existe en el catálogo de main: se carga como vencida, que es lo que main le asignaría
            # por fecha. Un estado fuera de catálogo (99) no puede guardarse: queda sin estado.
            status = 2 if status == 9 else status if status in known else None
            # El esquema original no admite importe nulo (NOT NULL DEFAULT 0): un importe faltante llega como 0.
            amount = debt.get('importe') or 0
            rows['debt'].append(f"({debt['id']}, {debt['id']}, {debtor}, {amount}, {amount}, {amount}, 1, {literal(debt.get('vencimiento'))}, {literal(status)})")
    columns = {
        'debtor': '(id, tenant, external_id, type, identifier, description, status)',
        'person': '(id, external_id, document_type, document_number, full_name, type, status)',
        'debtor_person': '(id, debtor, person, priority, role, active)',
        'debtor_contact': '(id, person, type, value, active)',
        'debt': '(id, external_id, debtor, original_amount, current_amount, updated_amount, currency, due_date, status)',
    }
    parts = [f'insert into public.{name} {columns[name]} values\n  ' + ',\n  '.join(values) + ';'
             for name, values in rows.items() if values]
    return '\n'.join(parts)


CLEAR_PORTFOLIO = '''
delete from public.debtor_profile_detail;
delete from public.debtor_profile;
delete from public.debt;
delete from public.debtor_contact;
delete from public.debtor_person;
delete from public.debtor;
delete from public.person;
'''


def load_data(kind: str) -> None:
    has_module = psql("select to_regclass('public.case_review') is not null;", read_only=True) == 't'
    if has_module and psql('select exists(select 1 from public.case_review) or exists(select 1 from public.import_batch);', read_only=True) == 't':
        raise MirrorError('El espejo ya tiene lotes o decisiones registradas: recrealo antes de cambiar la cartera.')
    body = small_cases_sql() if kind == 'chico' else (SQL_DIR / 'datos-escala.sql').read_text(encoding='utf-8')
    started = time.monotonic()
    psql(f'begin;\n{CLEAR_PORTFOLIO}\n{body}\ncommit;\nanalyze;')
    counts = psql('select (select count(*) from public.debtor), (select count(*) from public.debt), (select count(*) from public.person);', read_only=True)
    say(f'Cartera «{kind}» cargada en {time.monotonic() - started:.1f} s: objetos | obligaciones | personas = {counts}')


# ------------------------------------------------------------------ comandos

def banner() -> None:
    say()
    say('ESPEJO LOCAL DE LA BASE ORIGINAL — EQUITAS noche 7 (compatibilidad ensayada localmente)')
    say(f'  Data API: http://127.0.0.1:{API_PORT}   base: 127.0.0.1:{DB_PORT}   proyecto «{PROJECT_ID}»')
    say('  Reproduce lo comprobado y la foto de octubre. NO es idéntico a producción. Datos sintéticos por SQL.')
    say('  Producción no interviene: nada de lo que se haga acá se aplica a una base remota.')


INVENTORY = '''
select 'objetos=' || (select count(*) from public.debtor) || ' obligaciones=' || (select count(*) from public.debt)
  || ' personas=' || (select count(*) from public.person);
select 'módulo de decisiones: ' || coalesce(string_agg(name || '=' || case when to_regclass('public.' || name) is null then 'no' else 'sí' end, ' '), '')
  from unnest(array['import_batch','case_review','case_review_approval','access_audit']) name;
select 'políticas de lectura: ' || count(*) filter (where qual = 'true') || ' abiertas (true), ' || count(*) filter (where qual <> 'true') || ' con condición'
  from pg_policies where schemaname = 'public' and cmd = 'SELECT';
select 'catálogo role: ' || string_agg(id || ' ' || name, ', ' order by id) from public.role;
select 'catálogo debt_status: ' || string_agg(key, ', ' order by id) from public.debt_status;
'''


def cmd_start(_args) -> int:
    home = home_dir()
    guard()
    prepare_project(home)
    if not running():
        say('Espejo: se inicia (la primera vez crea la base con el esquema base).')
        cli(home, 'start')
    env = local_env(home)
    wait_ready(env)
    psql(snapshot_adjustments())
    psql((SQL_DIR / 'catalogos.sql').read_text(encoding='utf-8'))
    ensure_accounts(home)
    banner()
    for line in psql(INVENTORY, read_only=True).splitlines():
        say('  ' + line)
    say(f'  Cuentas: {home / "cuentas.json"} · variables para una aplicación local: {home / "app.env"} (archivos privados).')
    return 0


def cmd_stop(_args) -> int:
    home = home_dir()
    guard()
    if running():
        prepare_project(home)
        cli(home, 'stop', timeout=600)
        say('Espejo detenido. Los datos quedan en su volumen de Docker.')
    else:
        say('El espejo ya estaba detenido.')
    return 0


def cmd_status(_args) -> int:
    home_dir()
    guard()
    if not running():
        say('Espejo detenido.')
        return 1
    banner()
    for line in psql(INVENTORY, read_only=True).splitlines():
        say('  ' + line)
    return 0


def cmd_recreate(args) -> int:
    home = home_dir()
    guard()
    if args.confirmar != PROJECT_ID:
        raise MirrorError(f'El espejo es descartable, pero pide confirmación: recrear --confirmar {PROJECT_ID}')
    prepare_project(home)
    cli(home, 'stop', '--no-backup', timeout=600)
    say('Espejo borrado. Volver a crearlo: scripts/espejo/equitas_espejo.py start')
    return 0


def cmd_load(args) -> int:
    home_dir()
    guard()
    require_running()
    load_data(args.conjunto)
    return 0


def cmd_sql(args) -> int:
    home_dir()
    guard()
    require_running()
    path = (SQL_DIR / args.archivo).resolve()
    if path.parent != SQL_DIR.resolve() or path.suffix != '.sql' or not path.is_file():
        raise MirrorError('Solo se corren archivos .sql de database/espejo/.')
    settings = dict(item.split('=', 1) for item in args.ajuste or [])
    if any(not re.fullmatch(r'equitas\.[a-z_]{1,40}', name) or not re.fullmatch(r'[\w.\- ]{0,60}', value) for name, value in settings.items()):
        raise MirrorError('Ajuste inválido: se espera equitas.nombre=valor')
    prefix = ''.join(f"set {name} = {literal(value)};\n" for name, value in settings.items())
    started = time.monotonic()
    out = psql(prefix + path.read_text(encoding='utf-8'), read_only=args.solo_lectura, tuples=False)
    say(out)
    say(f'-- {path.name}: terminado en {time.monotonic() - started:.1f} s{" (solo lectura)" if args.solo_lectura else ""}')
    return 0


def cmd_verify_schema(_args) -> int:
    """Columna por columna y restricción por restricción contra la foto de octubre."""
    home_dir()
    guard()
    require_running()
    snapshot = json.loads(SNAPSHOT.read_text(encoding='utf-8'))
    tables = sorted({row['table_name'] for row in snapshot['columns']})
    listed = ', '.join(literal(name) for name in tables)
    live_columns = {tuple(line.split('|')) for line in psql(f"""select table_name, column_name, data_type, is_nullable, coalesce(column_default, '')
      from information_schema.columns where table_schema = 'public' and table_name in ({listed});""", read_only=True).splitlines()}
    seen_columns = {(r['table_name'], r['column_name'], r['data_type'], r['is_nullable'], r['column_default'] or '') for r in snapshot['columns']}
    live_constraints = {tuple(line.split('|', 3)) for line in psql(f"""select c.conrelid::regclass::text, c.conname, c.contype::text, pg_get_constraintdef(c.oid)
      from pg_constraint c join pg_namespace n on n.oid = c.connamespace
      where n.nspname = 'public' and c.conrelid::regclass::text in ({', '.join(literal('"user"' if t == 'user' else t) for t in tables)});""", read_only=True).splitlines()}
    norm = lambda text: re.sub(r'\bpublic\.', '', text).replace('"user"', 'user').strip()
    live_constraints = {(norm(t), name, kind, norm(definition)) for t, name, kind, definition in live_constraints}
    seen_constraints = {(r['table_name'], r['constraint_name'], r['constraint_type'], norm(r['definition'])) for r in snapshot['constraints']}
    live_policies = {tuple(line.split('|')) for line in psql("""select tablename, policyname, cmd, roles::text, coalesce(qual, '')
      from pg_policies where schemaname = 'public';""", read_only=True).splitlines()}
    seen_policies = {(r['tablename'], r['policyname'], r['cmd'], r['roles'], r['qual'] or '') for r in snapshot['policies']}
    differences = 0
    for title, seen, live in (('columnas', seen_columns, live_columns), ('restricciones', seen_constraints, live_constraints),
                              ('políticas', seen_policies, live_policies)):
        only_snapshot, only_live = sorted(seen - live), sorted(live - seen)
        differences += len(only_snapshot) + len(only_live)
        say(f'{title}: foto {len(seen)}, espejo {len(live)}, solo en la foto {len(only_snapshot)}, solo en el espejo {len(only_live)}')
        for row in only_snapshot[:40]:
            say(f'  solo en la foto:   {" | ".join(map(str, row))[:200]}')
        for row in only_live[:40]:
            say(f'  solo en el espejo: {" | ".join(map(str, row))[:200]}')
    say('Coincide con la foto de octubre.' if differences == 0 else f'{differences} diferencia(s) con la foto de octubre (arriba).')
    return 0 if differences == 0 else 1


READ_PROBE_TABLES = ('tenant', 'user', 'tenant_user', 'role', 'debt_status', 'debtor', 'debt', 'person', 'debtor_person',
                     'debtor_contact', 'debtor_profile', 'import_batch', 'case_review', 'case_review_approval', 'access_audit')


def http_json(url: str, *, headers: dict[str, str], body: dict | None = None) -> tuple[int, dict[str, str], bytes]:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, headers={**headers, **({'Content-Type': 'application/json'} if data else {})})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers), error.read()


def cmd_read_probe(_args) -> int:
    """Qué lee cada cuenta por la Data API real, con su propia sesión. Solo conteos; nunca imprime contraseñas ni filas."""
    home = home_dir()
    guard()
    require_running()
    env = local_env(home)
    api, key = env['API_URL'], env.get('PUBLISHABLE_KEY') or env['ANON_KEY']
    accounts = json.loads((home / 'cuentas.json').read_text(encoding='utf-8'))
    sessions: list[tuple[str, str | None]] = [('anónimo', None)]
    for name, *_ in ACCOUNTS:
        status, _, raw = http_json(f'{api}/auth/v1/token?grant_type=password', headers={'apikey': key},
                                   body={'email': accounts[name]['email'], 'password': accounts[name]['password']})
        if status != 200:
            raise MirrorError(f'La cuenta {name} no pudo iniciar sesión en el espejo (HTTP {status}).')
        sessions.append((name, json.loads(raw)['access_token']))
    say('filas visibles por tabla (Data API, sesión propia); «-» = la tabla no existe; «x» = sin permiso')
    say('cuenta'.ljust(22) + ' '.join(table[:11].rjust(11) for table in READ_PROBE_TABLES))
    for name, token in sessions:
        cells = []
        for table in READ_PROBE_TABLES:
            headers = {'apikey': key, 'Prefer': 'count=exact', 'Range': '0-0', **({'Authorization': f'Bearer {token}'} if token else {})}
            status, response_headers, _ = http_json(f'{api}/rest/v1/{table}?select=id', headers=headers)
            total = response_headers.get('Content-Range', response_headers.get('content-range', '')).rpartition('/')[2]
            cells.append(total if status in (200, 206) and total.isdigit() else '-' if status == 404 else 'x' if status in (401, 403) else f'E{status}')
        say(name.ljust(22) + ' '.join(cell.rjust(11) for cell in cells))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('start', help='crea o arranca el espejo')
    commands.add_parser('stop', help='detiene el espejo (conserva los datos)')
    commands.add_parser('status', help='estado, solo lectura')
    commands.add_parser('verificar-esquema', help='compara columnas, restricciones y políticas con la foto de octubre')
    commands.add_parser('probar-lectura', help='qué lee cada cuenta por la Data API (solo conteos)')
    load = commands.add_parser('cargar', help='reemplaza la cartera sintética')
    load.add_argument('conjunto', choices=('chico', 'escala'))
    sql = commands.add_parser('sql', help='corre un archivo de database/espejo/')
    sql.add_argument('archivo')
    sql.add_argument('--solo-lectura', action='store_true')
    sql.add_argument('--ajuste', action='append', help="ajuste de sesión previo: equitas.nombre=valor (equivale a set equitas.nombre = 'valor';)")
    recreate = commands.add_parser('recrear', help='borra el espejo (descartable)')
    recreate.add_argument('--confirmar', default='')
    args = parser.parse_args(argv)
    handlers = {'start': cmd_start, 'stop': cmd_stop, 'status': cmd_status, 'verificar-esquema': cmd_verify_schema,
                'cargar': cmd_load, 'sql': cmd_sql, 'recrear': cmd_recreate, 'probar-lectura': cmd_read_probe}
    try:
        return handlers[args.command](args)
    except MirrorError as error:
        print(f'ERROR: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
