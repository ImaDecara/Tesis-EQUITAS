"""Genera database/espejo/paquete-minimo.sql a partir de las definiciones VIGENTES de una base local que ya
tiene todas las migraciones del repositorio (el entorno de la noche 7, `equitas-n7-local`).

Por qué un generador: las tablas y funciones del módulo de decisiones se fueron corrigiendo en varias
migraciones. Copiarlas a mano arriesga llevar un cuerpo viejo; leerlas del catálogo de una base recién
migrada da exactamente lo que el repositorio prueba. El resultado es un archivo de texto que se revisa y
se versiona; este script solo deja constancia de cómo se obtuvo y permite regenerarlo.

Uso (solo lectura sobre la base local; no toca ninguna base remota):
  back/.venv/bin/python scripts/espejo/generar_paquete.py            escribe el archivo
  back/.venv/bin/python scripts/espejo/generar_paquete.py --check    falla si el archivo versionado difiere
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE_CONTAINER = 'supabase_db_equitas-n7-local'
TARGET = ROOT / 'database/espejo/paquete-minimo.sql'

# Orden de creación: cada tabla después de las que referencia.
TABLES = ('import_batch', 'case_review', 'case_review_approval', 'access_audit')
FUNCTIONS = (
    'equitas_append_only', 'equitas_role_allows', 'equitas_member_role', 'equitas_current_cutoff',
    'equitas_verify_cutoff', 'record_case_review', 'record_case_review_approval',
    'read_case_review_reason_text', 'record_access_audit',
)
# Lo que el paquete deja afuera a propósito (maquinaria de importación).
EXCLUDED_ROLES = ('equitas_import_definer', 'equitas_import_server')
EXCLUDED_TRIGGERS = ('import_atomic_event_guard',)

PURPOSE = {
    'import_batch': (
        'A qué cartera fechada corresponde cada decisión. Cada fila es un evento de un lote (fecha de corte, huellas, conteos).',
        'Tabla nueva, vacía. No modifica tablas existentes. Solo se agrega: no admite UPDATE, DELETE ni TRUNCATE.',
        'select count(*) from public.import_batch;  -- 0 hasta registrar la cartera heredada (cartera-heredada.sql)'),
    'case_review': (
        'Decisión registrada por una persona sobre un caso, atada a la cartera y a la versión de reglas con que se tomó.',
        'Tabla nueva, vacía. Referencia debtor(tenant, id) y "user"(id): por eso el paquete agrega la restricción única de debtor.',
        'select count(*) from public.case_review;  -- 0 al instalar'),
    'case_review_approval': (
        'Aprobación u objeción, por otra persona, de una propuesta de intensidad 3 o 4.',
        'Tabla nueva, vacía. Referencia case_review.',
        'select count(*) from public.case_review_approval;  -- 0 al instalar'),
    'access_audit': (
        'Registro de aperturas de caso y descargas de reportes. Sin él la aplicación no entrega fichas ni reportes.',
        'Tabla nueva, vacía, sin claves foráneas a propósito (el rastro sobrevive a la baja de un objeto). Crece con el uso.',
        'select count(*) from public.access_audit;  -- 0 al instalar'),
    'equitas_append_only': (
        'Disparador que rechaza UPDATE, DELETE y TRUNCATE en las cuatro tablas del módulo.',
        'Solo se asocia a las tablas nuevas.',
        "delete from public.case_review;  -- debe fallar con APPEND_ONLY (probarlo en una transacción con rollback)"),
    'equitas_role_allows': (
        'Tabla de permisos de la base: qué rol puede registrar, aprobar, leer el motivo libre y leer el registro de accesos.',
        'Función pura, sin acceso a tablas. Único lugar de esta capa donde se nombra un rol.',
        "select public.equitas_role_allows('ADMIN','DECISION_RECORD'), public.equitas_role_allows('USER','DECISION_RECORD');  -- t, f"),
    'equitas_member_role': (
        'Rol de la membresía ACTIVA de una persona en un municipio activo. La usan todas las funciones que escriben.',
        'Lee tenant_user, "user", tenant y role. No escribe.',
        'Solo ejecutable por el definidor: se comprueba a través de record_case_review.'),
    'equitas_current_cutoff': (
        'Lote vigente del municipio (el último publicado). De él sale la fecha de la cartera.',
        'Lee import_batch. No escribe.',
        'Solo ejecutable por el definidor: se comprueba registrando la cartera heredada y una decisión.'),
    'equitas_verify_cutoff': (
        'Comprueba, dentro de la transacción que escribe, que la decisión se registra sobre el lote vigente.',
        'Lee import_batch con bloqueo consultivo por municipio. No escribe.',
        'Una decisión con otra fecha de cartera debe fallar con CUTOFF_CHANGED.'),
    'record_case_review': (
        'Única vía para registrar una decisión. Verifica membresía activa, rol, municipio del caso, cartera vigente y cadena.',
        'Inserta en case_review. La llama el servidor de la aplicación con la credencial equitas_review_server.',
        'Flujo completo desde la aplicación: registrar una decisión con una cuenta ADMIN.'),
    'record_case_review_approval': (
        'Única vía para aprobar u objetar. Rechaza a quien propuso (en cualquier versión de la cadena): APPROVER_IS_PROPONENT.',
        'Inserta en case_review_approval.',
        'Desde la aplicación: quien propuso no puede aprobar; otra cuenta ADMIN sí.'),
    'read_case_review_reason_text': (
        'Lectura del motivo libre de una decisión, solo para el rol que lo permite.',
        'Lee case_review.reason_text, que los roles de cliente no pueden seleccionar.',
        'Con USER debe fallar con ROLE_NOT_ALLOWED.'),
    'record_access_audit': (
        'Única vía para escribir el registro de accesos. El rol lo toma la base de la membresía; quien llama no lo elige.',
        'Inserta en access_audit.',
        'Abrir un caso desde la aplicación deja una fila CASE_OPEN.'),
}


def query(sql: str) -> str:
    result = subprocess.run(['docker', 'exec', '-i', SOURCE_CONTAINER, 'psql', '-X', '-q', '-At', '-U', 'postgres',
                             '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], input=f'begin transaction read only;\n{sql}\nrollback;\n',
                            text=True, capture_output=True, timeout=120, check=False)
    if result.returncode != 0:
        raise SystemExit(f'No se pudo leer la base local de origen ({SOURCE_CONTAINER}): arrancá el entorno de la noche 7.\n{result.stderr[-400:]}')
    return result.stdout.rstrip('\n')


def dump_tables() -> list[str]:
    command = ['docker', 'exec', SOURCE_CONTAINER, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only', '--no-owner']
    for table in TABLES:
        command += ['-t', f'public.{table}']
    text = subprocess.run(command, text=True, capture_output=True, timeout=120, check=True).stdout
    statements, current = [], []
    for line in text.splitlines():
        if line.startswith('--') or (not line.strip() and not current):
            continue
        current.append(line)
        if line.rstrip().endswith(';'):
            statements.append('\n'.join(current).strip())
            current = []
    return [s for s in statements if not re.match(r'(SET |SELECT pg_catalog\.set_config|\\)', s)]


def owner_table(statement: str) -> str | None:
    for table in TABLES:
        if re.search(rf'\bpublic\.{table}(_id_seq)?\b', statement.split('\n', 1)[0] + ' ' + statement[:400]):
            first = re.search(r'public\.([a-z_]+?)(?:_id_seq)?\b', statement)
            return first.group(1) if first and first.group(1) in TABLES else table
    return None


def comment(name: str) -> str:
    purpose, impact, check = PURPOSE[name]
    return f'-- {name}\n--   Finalidad:  {purpose}\n--   Impacto:    {impact}\n--   Comprobar:  {check}\n'


def table_section(table: str, statements: list[str]) -> str:
    mine = [s for s in statements if owner_table(s) == table]
    out = [comment(table)]
    create = next(s for s in mine if s.startswith(f'CREATE TABLE public.{table} '))
    create = create.replace(f'CREATE TABLE public.{table} (', f'create table if not exists public.{table} (', 1)
    identity = any(re.match(rf'ALTER TABLE public\.{table} ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY', s) for s in mine)
    if identity:
        create = create.replace('    id bigint NOT NULL,', '    id bigint generated always as identity,', 1)
    out.append(create + '\n')
    for s in mine:
        if s.startswith('COMMENT ON'):
            out.append(s + '\n')
    for s in mine:
        match = re.match(rf'ALTER TABLE ONLY public\.{table}\s+ADD CONSTRAINT (\w+) (.+);$', s, re.DOTALL)
        if match and not match.group(2).startswith('FOREIGN KEY'):
            out.append(f"select pg_temp.paquete_restriccion('{table}', '{match.group(1)}', $c${match.group(2)}$c$);\n")
    for s in mine:
        if re.match(r'CREATE (UNIQUE )?INDEX', s):
            out.append(re.sub(r'^CREATE (UNIQUE )?INDEX ', lambda m: f'create {m.group(1) or ""}index if not exists ', s) + '\n')
    return ''.join(out)


def foreign_keys(table: str, statements: list[str]) -> str:
    out = []
    for s in statements:
        match = re.match(rf'ALTER TABLE ONLY public\.{table}\s+ADD CONSTRAINT (\w+) (FOREIGN KEY .+);$', s, re.DOTALL)
        if match:
            out.append(f"select pg_temp.paquete_restriccion('{table}', '{match.group(1)}', $c${match.group(2)}$c$);\n")
    return ''.join(out)


def triggers_and_grants(table: str, statements: list[str]) -> str:
    out = [f'alter table public.{table} enable row level security;\n',
           f'revoke all on table public.{table} from public, anon, authenticated, service_role;\n']
    columns: dict[str, list[str]] = {}
    for s in statements:
        if owner_table(s) != table:
            continue
        if s.startswith('CREATE TRIGGER'):
            if any(name in s for name in EXCLUDED_TRIGGERS):
                continue
            out.append(s.replace('CREATE TRIGGER', 'create or replace trigger', 1) + '\n')
        elif s.startswith('GRANT') and not any(role in s for role in EXCLUDED_ROLES):
            column = re.match(rf'GRANT SELECT\((\w+)\) ON TABLE public\.{table} TO (\w+);$', s)
            if column:
                columns.setdefault(column.group(2), []).append(column.group(1))
            else:
                out.append(s + '\n')
    # Permisos por columna, agrupados: una línea por conjunto de columnas en lugar de una por columna y rol.
    grouped: dict[tuple[str, ...], list[str]] = {}
    for role, names in columns.items():
        grouped.setdefault(tuple(names), []).append(role)
    for names, roles in grouped.items():
        out.append(f'grant select ({", ".join(names)})\n  on table public.{table} to {", ".join(roles)};\n')
    return ''.join(out)


def function_section(name: str) -> str:
    rows = query(f"""select p.oid::regprocedure::text || E'\\x1f' || pg_get_userbyid(p.proowner) || E'\\x1f' ||
      coalesce((select string_agg(a.rolname, ',' order by a.rolname) from aclexplode(p.proacl) x join pg_roles a on a.oid = x.grantee
                where x.privilege_type = 'EXECUTE' and a.rolname <> pg_get_userbyid(p.proowner)), '') || E'\\x1f' || pg_get_functiondef(p.oid)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '{name}';""")
    signature, owner, grantees, definition = rows.split('\x1f', 3)
    if rows.count('\x1f') != 3:
        raise SystemExit(f'Se esperaba una sola versión de public.{name}.')
    out = [comment(name), definition.rstrip() + ';\n']
    if owner != 'postgres':
        out.append(f'alter function public.{signature} owner to {owner};\n')
    out.append(f'revoke all on function public.{signature} from public, anon, authenticated, service_role;\n')
    kept = [role for role in grantees.split(',') if role and role not in EXCLUDED_ROLES and role != 'postgres']
    if kept:
        out.append(f'grant execute on function public.{signature} to {", ".join(kept)};\n')
    return ''.join(out)


HEADER = '''-- EQUITAS — paquete mínimo de base para registrar decisiones y obtener reportes (noche 7, encargo 10.3).
--
-- GENERADO por scripts/espejo/generar_paquete.py a partir de las definiciones vigentes del repositorio.
-- Se aplicó y se probó SOLO en el espejo local (scripts/espejo/equitas_espejo.py). No se aplicó en ninguna
-- base remota y este archivo no autoriza a hacerlo: es una propuesta para que la decida quien custodia la base.
--
-- QUÉ AGREGA
--   · Cuatro tablas nuevas: import_batch, case_review, case_review_approval, access_audit.
--   · Nueve funciones y un tipo (case_review_checklist).
--   · Dos roles de Postgres sin inicio de sesión: equitas_write_definer (dueño de las funciones) y
--     equitas_review_server (la credencial con que el servidor de la aplicación llama a esas funciones).
--   · UN SOLO cambio sobre una tabla existente: la restricción única debtor(tenant, id).
--
-- QUÉ NO HACE
--   · No instala la maquinaria de carga de archivos (publicación, staging, disparadores sobre la cartera).
--   · No crea usuarios, membresías ni roles del catálogo. No cambia las políticas de lectura existentes
--     (eso es politicas-lectura.sql, aparte y no aditivo).
--   · No registra la cartera ya cargada: eso es cartera-heredada.sql, que requiere una fecha declarada por
--     una persona responsable.
--
-- CÓMO SE USA
--   1. paquete-minimo-verificar.sql   (solo lectura: estado ANTES)
--   2. este archivo                   (una transacción; se puede repetir sin cambios)
--   3. paquete-minimo-verificar.sql   (solo lectura: estado DESPUÉS)
--   Reversa completa: paquete-minimo-revertir.sql.
--
-- La restricción única sobre debtor toma un bloqueo exclusivo breve sobre esa tabla mientras construye su
-- índice. Con el volumen observado (miles de objetos) es del orden de milisegundos; conviene aplicarlo fuera
-- del horario de uso. Falla sin cambios si ya existen dos objetos con el mismo (tenant, id), lo que no puede
-- ocurrir porque id es clave primaria.

begin;

-- Solo sobre una base que tiene la cartera y la identidad de la aplicación.
do $$ begin
  if to_regclass('public.debtor') is null or to_regclass('public.tenant_user') is null or to_regclass('public."user"') is null
     or to_regclass('public.tenant') is null or to_regclass('public.role') is null then
    raise exception 'PAQUETE_BASE_INESPERADA: faltan tablas de la aplicación; no se aplica nada';
  end if;
end $$;

-- Ayuda temporal (desaparece al cerrar la sesión): agrega una restricción solo si no existe.
create function pg_temp.paquete_restriccion(p_table text, p_name text, p_definition text) returns void
language plpgsql as $f$
begin
  if not exists (select 1 from pg_constraint where conrelid = format('public.%I', p_table)::regclass and conname = p_name) then
    execute format('alter table public.%I add constraint %I %s', p_table, p_name, p_definition);
  end if;
end $f$;

-- ---------------------------------------------------------------------------------------------- roles
-- equitas_write_definer
--   Finalidad:  Dueño de las funciones que escriben. Tiene BYPASSRLS porque el paquete no agrega políticas a las
--               tablas existentes; solo alcanza lo que se le otorga más abajo (columnas puntuales de identidad).
--   Impacto:    Rol nuevo, sin inicio de sesión. Nadie puede asumirlo salvo postgres.
--   Comprobar:  select rolcanlogin, rolbypassrls from pg_roles where rolname = 'equitas_write_definer';  -- f, t
-- equitas_review_server
--   Finalidad:  Rol con que el servidor de la aplicación llama a las funciones (un JWT firmado con role = este nombre).
--   Impacto:    Rol nuevo, sin inicio de sesión ni BYPASSRLS, sin permisos sobre tablas. authenticator puede asumirlo:
--               es lo que permite a la Data API ejecutar con este rol cuando recibe ese JWT.
--   Comprobar:  select has_table_privilege('equitas_review_server', 'public.case_review', 'select');  -- f
do $$
declare r text;
begin
  foreach r in array array['equitas_write_definer', 'equitas_review_server'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I', r);
    end if;
  end loop;
end $$;
alter role equitas_write_definer nologin noinherit nocreatedb nocreaterole bypassrls;
alter role equitas_review_server nologin noinherit nocreatedb nocreaterole nobypassrls;
grant equitas_review_server to authenticator;
grant equitas_write_definer to postgres;
-- Solo mientras dura esta transacción: hace falta para que el definidor quede como dueño de sus funciones.
-- Se retira antes del commit (más abajo); el definidor no puede crear nada después.
grant create on schema public to equitas_write_definer;

-- Lo único que el definidor lee de las tablas existentes: columnas de identidad, sin datos personales.
grant select (id, tenant) on public.debtor to equitas_write_definer;
grant select (id, name) on public.role to equitas_write_definer;
grant select (id, status) on public.tenant to equitas_write_definer;
grant select (tenant, "user", role, status) on public.tenant_user to equitas_write_definer;
grant select (id, status) on public."user" to equitas_write_definer;

-- ---------------------------------------------------------------------------------------------- único cambio sobre una tabla existente
-- debtor_tenant_id_key
--   Finalidad:  Permite que case_review referencie (tenant, debtor): una decisión no puede apuntar a un caso de otro municipio.
--   Impacto:    Agrega un índice único sobre debtor(tenant, id). No cambia filas ni columnas. Bloqueo exclusivo breve.
--   Comprobar:  select conname from pg_constraint where conrelid = 'public.debtor'::regclass and conname = 'debtor_tenant_id_key';
select pg_temp.paquete_restriccion('debtor', 'debtor_tenant_id_key', 'UNIQUE (tenant, id)');

-- ---------------------------------------------------------------------------------------------- tipo
-- case_review_checklist
--   Finalidad:  Forma de la lista de control de una decisión: solo casillas y códigos, sin texto sobre el hogar.
--   Impacto:    Tipo nuevo. Lo usan case_review y case_review_approval.
--   Comprobar:  select '{"canal_valido": true}'::public.case_review_checklist;
do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'case_review_checklist') then
    create domain public.case_review_checklist as jsonb constraint case_review_checklist_shape __DOMAIN_CHECK__;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------- tablas
'''

POLICIES = '''
-- ---------------------------------------------------------------------------------------------- políticas de lectura de las tablas nuevas
-- Lectura por la Data API: solo quien tiene una membresía ACTIVA en ese municipio, con usuario y municipio activos.
-- DIFERENCIA DECLARADA con el esquema local del repositorio: allí estas tres políticas delegan en la política de
-- la tabla tenant. En una base cuyas políticas de lectura siguen abiertas (USING true), delegar dejaría las
-- decisiones legibles por cualquier usuario autenticado; por eso acá la membresía se comprueba de forma explícita.
-- Con las políticas de membresía instaladas (politicas-lectura.sql) las dos formas dan el mismo resultado.
do $$
declare t text;
begin
  foreach t in array array['import_batch', 'case_review', 'case_review_approval'] loop
    execute format('drop policy if exists %I on public.%I', 'member_read_' || t, t);
    execute format($p$create policy %I on public.%I for select to authenticated using (exists (
      select 1 from public.tenant_user tu join public."user" u on u.id = tu."user" join public.tenant m on m.id = tu.tenant
      where tu.tenant = %I.tenant and tu.status and u.status = 'ACTIVE' and m.status = 'ACTIVE'
        and u.auth_user = (select auth.uid())))$p$, 'member_read_' || t, t, t);
  end loop;
end $$;
-- El registro de accesos lo lee solo el rol que public.equitas_role_allows habilita (AUDIT_READ).
drop policy if exists admin_read_access_audit on public.access_audit;
__AUDIT_POLICY__
'''

FOOTER = '''
revoke create on schema public from equitas_write_definer;

-- ---------------------------------------------------------------------------------------------- comprobación de cierre
-- Si algo no quedó como se espera, la transacción entera se deshace.
do $$
declare missing text;
begin
  select string_agg(name, ', ') into missing from unnest(array[__TABLE_LIST__]) name where to_regclass('public.' || name) is null;
  if missing is not null then raise exception 'PAQUETE_INCOMPLETO: faltan tablas: %', missing; end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any (array[__FUNCTION_LIST__])) <> __FUNCTION_COUNT__ then
    raise exception 'PAQUETE_INCOMPLETO: se esperaba una sola versión de cada función';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = any (array[__FUNCTION_LIST__])
               and (p.proconfig is null or not p.proconfig @> array['search_path=""'])) then
    raise exception 'PAQUETE_INSEGURO: una función quedó sin search_path vacío';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace, unnest(array['anon', 'service_role']) role
             where n.nspname = 'public' and p.proname = any (array[__FUNCTION_LIST__]) and has_function_privilege(role, p.oid, 'execute')) then
    raise exception 'PAQUETE_INSEGURO: anon o service_role pueden ejecutar una función del módulo';
  end if;
  if has_schema_privilege('equitas_write_definer', 'public', 'create') then
    raise exception 'PAQUETE_INSEGURO: el definidor conservó el permiso de crear objetos';
  end if;
  if has_column_privilege('authenticated', 'public.case_review', 'reason_text', 'select') then
    raise exception 'PAQUETE_INSEGURO: el motivo libre quedó legible por la Data API';
  end if;
end $$;

commit;

-- La Data API guarda en memoria la lista de tablas y funciones: sin este aviso seguiría respondiendo
-- «la tabla no existe» durante un rato y la aplicación se comportaría como si el módulo no estuviera.
notify pgrst, 'reload schema';
'''


def build() -> str:
    statements = dump_tables()
    domain = query("select pg_get_constraintdef(c.oid) from pg_type t join pg_constraint c on c.contypid = t.oid where t.typname = 'case_review_checklist';")
    parts = [HEADER.replace('__DOMAIN_CHECK__', domain)]
    for table in TABLES:
        parts.append(table_section(table, statements) + '\n')
    parts.append('-- Claves foráneas (después de crear las cuatro tablas).\n')
    for table in TABLES:
        parts.append(foreign_keys(table, statements))
    parts.append('\n-- ---------------------------------------------------------------------------------------------- funciones\n')
    for name in FUNCTIONS:
        parts.append(function_section(name) + '\n')
    parts.append('-- ---------------------------------------------------------------------------------------------- disparadores de solo agregado y permisos\n')
    for table in TABLES:
        parts.append(triggers_and_grants(table, statements) + '\n')
    audit_policy = next(s for s in statements if s.startswith('CREATE POLICY admin_read_access_audit'))
    parts.append(POLICIES.replace('__AUDIT_POLICY__', audit_policy.replace('CREATE POLICY', 'create policy', 1)))
    quoted = lambda names: ', '.join(f"'{name}'" for name in names)
    parts.append(FOOTER.replace('__TABLE_LIST__', quoted(TABLES)).replace('__FUNCTION_LIST__', quoted(FUNCTIONS))
                 .replace('__FUNCTION_COUNT__', str(len(FUNCTIONS))))
    return ''.join(parts)


def main() -> int:
    text = build()
    if '--check' in sys.argv[1:]:
        if not TARGET.exists() or TARGET.read_text(encoding='utf-8') != text:
            print(f'{TARGET.relative_to(ROOT)} no coincide con las definiciones vigentes: regenerarlo y revisarlo.', file=sys.stderr)
            return 1
        print('paquete-minimo.sql coincide con las definiciones vigentes.')
        return 0
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(text, encoding='utf-8')
    print(f'Escrito {TARGET.relative_to(ROOT)} ({len(text.splitlines())} líneas).')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
