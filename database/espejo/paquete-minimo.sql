-- EQUITAS — paquete mínimo de base para registrar decisiones y obtener reportes (noche 7, encargo 10.3).
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
  -- Las funciones del módulo confían en la membresía (tenant_user, "user", role, tenant) para saber quién es ADMIN.
  -- Si una persona pudiera escribir esas tablas con su sesión, podría darse el rol y aprobar su propia propuesta
  -- con otra cuenta. Se exige que tengan RLS activo y ninguna política de escritura para roles de cliente.
  if exists (select 1 from pg_class c where c.oid = any (array['public.tenant_user', 'public."user"', 'public.role', 'public.tenant']::regclass[])
               and not c.relrowsecurity)
     or exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename in ('tenant_user', 'user', 'role', 'tenant')
               and p.cmd <> 'SELECT' and p.roles && array['public', 'anon', 'authenticated']::name[]) then
    raise exception 'PAQUETE_BASE_INSEGURA: las tablas de membresía admiten escritura con la sesión de una persona; no se aplica nada';
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
--               Si la crea este paquete queda marcada con un comentario: la reversa la quita solo si lleva esa marca.
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.debtor'::regclass and conname = 'debtor_tenant_id_key') then
    alter table public.debtor add constraint debtor_tenant_id_key unique (tenant, id);
    comment on constraint debtor_tenant_id_key on public.debtor is 'equitas:paquete-minimo';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------- tipo
-- case_review_checklist
--   Finalidad:  Forma de la lista de control de una decisión: solo casillas y códigos, sin texto sobre el hogar.
--   Impacto:    Tipo nuevo. Lo usan case_review y case_review_approval.
--   Comprobar:  select '{"canal_valido": true}'::public.case_review_checklist;
do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'case_review_checklist') then
    create domain public.case_review_checklist as jsonb constraint case_review_checklist_shape CHECK (((jsonb_typeof(VALUE) = 'object'::text) AND ((VALUE - ARRAY['situacion_hogar'::text, 'estado_juridico_verificado'::text, 'canal_valido'::text, 'alternativa_asistida_ofrecida'::text]) = '{}'::jsonb) AND (COALESCE((VALUE -> 'situacion_hogar'::text), '"NO_DISPONIBLE"'::jsonb) = ANY (ARRAY['"CONSULTADA"'::jsonb, '"NO_DISPONIBLE"'::jsonb])) AND (COALESCE(jsonb_typeof((VALUE -> 'estado_juridico_verificado'::text)), 'boolean'::text) = 'boolean'::text) AND (COALESCE(jsonb_typeof((VALUE -> 'canal_valido'::text)), 'boolean'::text) = 'boolean'::text) AND (COALESCE(jsonb_typeof((VALUE -> 'alternativa_asistida_ofrecida'::text)), 'boolean'::text) = 'boolean'::text)));
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------- tablas
-- import_batch
--   Finalidad:  A qué cartera fechada corresponde cada decisión. Cada fila es un evento de un lote (fecha de corte, huellas, conteos).
--   Impacto:    Tabla nueva, vacía. No modifica tablas existentes. Solo se agrega: no admite UPDATE, DELETE ni TRUNCATE.
--   Comprobar:  select count(*) from public.import_batch;  -- 0 hasta registrar la cartera heredada (cartera-heredada.sql)
create table if not exists public.import_batch (
    id bigint generated always as identity,
    tenant bigint NOT NULL,
    source text NOT NULL,
    file_hashes jsonb NOT NULL,
    as_of date NOT NULL,
    source_updated_at date,
    rules_version text NOT NULL,
    counts jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text NOT NULL,
    created_by bigint NOT NULL,
    created_by_role text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    supersedes bigint,
    idempotency_key uuid NOT NULL,
    CONSTRAINT import_batch_counts_format CHECK (((jsonb_typeof(counts) = 'object'::text) AND (octet_length((counts)::text) <= 16384) AND (NOT jsonb_path_exists(counts, 'strict $.**?(@.type() != "object" && ((@.type() != "number" || @ < 0) || @ != @.floor()))'::jsonpath)) AND (NOT jsonb_path_exists(counts, 'strict $.**?(@.type() == "object").keyvalue()?(!(@."key" like_regex "^[a-z][a-z0-9_]{0,63}$"))'::jsonpath)))),
    CONSTRAINT import_batch_file_hashes_format CHECK (((jsonb_typeof(file_hashes) = 'object'::text) AND (file_hashes <> '{}'::jsonb) AND (octet_length((file_hashes)::text) <= 16384) AND (NOT jsonb_path_exists(file_hashes, '$.keyvalue()?((!(@."key" like_regex "^[a-z][a-z0-9_]{0,63}$") || @."value".type() != "string") || !(@."value" like_regex "^[0-9a-f]{64}$"))'::jsonpath)))),
    CONSTRAINT import_batch_rules_version_format CHECK ((rules_version ~ '^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}$'::text)),
    CONSTRAINT import_batch_source_format CHECK ((source ~ '^[A-Z][A-Z0-9_]{0,63}$'::text)),
    CONSTRAINT import_batch_status_valid CHECK ((status = ANY (ARRAY['RECIBIDO'::text, 'VALIDADO'::text, 'CONFIRMADO'::text, 'PUBLICADO'::text, 'FALLIDO'::text, 'DESCARTADO'::text, 'REQUIERE_NUEVO_PREVIEW'::text]))),
    CONSTRAINT import_batch_supersedes_anterior CHECK (((supersedes IS NULL) OR (supersedes < id)))
);
COMMENT ON TABLE public.import_batch IS 'ALIGN-018. Lote append-only: procedencia, hashes, corte y conteos, sin filas de cartera ni rutas de archivo.';
select pg_temp.paquete_restriccion('import_batch', 'import_batch_idempotency_key', $c$UNIQUE (tenant, idempotency_key)$c$);
select pg_temp.paquete_restriccion('import_batch', 'import_batch_pkey', $c$PRIMARY KEY (id)$c$);
select pg_temp.paquete_restriccion('import_batch', 'import_batch_supersedes_key', $c$UNIQUE (supersedes)$c$);
select pg_temp.paquete_restriccion('import_batch', 'import_batch_tenant_id_key', $c$UNIQUE (tenant, id)$c$);
create index if not exists import_batch_created_by_idx ON public.import_batch USING btree (created_by);

-- case_review
--   Finalidad:  Decisión registrada por una persona sobre un caso, atada a la cartera y a la versión de reglas con que se tomó.
--   Impacto:    Tabla nueva, vacía. Referencia debtor(tenant, id) y "user"(id): por eso el paquete agrega la restricción única de debtor.
--   Comprobar:  select count(*) from public.case_review;  -- 0 al instalar
create table if not exists public.case_review (
    id bigint generated always as identity,
    tenant bigint NOT NULL,
    debtor bigint NOT NULL,
    rules_version text NOT NULL,
    as_of date NOT NULL,
    inputs_hash text NOT NULL,
    suggested_intervention text NOT NULL,
    suggested_intensity integer NOT NULL,
    explanation jsonb NOT NULL,
    decision text NOT NULL,
    decided_intervention text,
    decided_intensity integer,
    reason_code text,
    reason_text text,
    checklist public.case_review_checklist DEFAULT '{}'::jsonb NOT NULL,
    reviewer bigint NOT NULL,
    reviewer_role text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    supersedes bigint,
    idempotency_key uuid NOT NULL,
    CONSTRAINT case_review_acepta_matches_suggestion CHECK (((decision <> 'ACEPTA'::text) OR ((NOT (decided_intervention IS DISTINCT FROM suggested_intervention)) AND (NOT (decided_intensity IS DISTINCT FROM suggested_intensity))))),
    CONSTRAINT case_review_decided_intensity_range CHECK (((decided_intensity >= 0) AND (decided_intensity <= 4))),
    CONSTRAINT case_review_decided_intervention_format CHECK ((decided_intervention ~ '^[A-Z][A-Z0-9_]{0,63}$'::text)),
    CONSTRAINT case_review_decided_pair CHECK (((decided_intervention IS NULL) = (decided_intensity IS NULL))),
    CONSTRAINT case_review_decision_requires_reason CHECK (((decision = 'ACEPTA'::text) OR (reason_code IS NOT NULL))),
    CONSTRAINT case_review_decision_valid CHECK ((decision = ANY (ARRAY['ACEPTA'::text, 'MODIFICA'::text, 'RECHAZA'::text, 'POSPONE'::text, 'DERIVA'::text]))),
    CONSTRAINT case_review_explanation_object CHECK (((jsonb_typeof(explanation) = 'object'::text) AND (octet_length((explanation)::text) <= 16384))),
    CONSTRAINT case_review_inputs_hash_format CHECK ((inputs_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT case_review_intense_requires_checklist CHECK (((COALESCE(decided_intensity, 0) < 3) OR (((checklist)::jsonb ? 'situacion_hogar'::text) AND ((checklist)::jsonb @> '{"canal_valido": true, "estado_juridico_verificado": true, "alternativa_asistida_ofrecida": true}'::jsonb)))),
    CONSTRAINT case_review_modifica_changes_suggestion CHECK (((decision <> 'MODIFICA'::text) OR ((decided_intensity IS NOT NULL) AND ((decided_intervention IS DISTINCT FROM suggested_intervention) OR (decided_intensity IS DISTINCT FROM suggested_intensity))))),
    CONSTRAINT case_review_no_action_without_decided CHECK (((decision <> ALL (ARRAY['RECHAZA'::text, 'POSPONE'::text])) OR (decided_intensity IS NULL))),
    CONSTRAINT case_review_reason_code_format CHECK ((reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'::text)),
    CONSTRAINT case_review_reason_text_length CHECK ((char_length(reason_text) <= 500)),
    CONSTRAINT case_review_reason_text_not_blank CHECK ((reason_text ~ '[^[:space:]]'::text)),
    CONSTRAINT case_review_reason_text_requires_code CHECK (((reason_text IS NULL) OR (reason_code IS NOT NULL))),
    CONSTRAINT case_review_rules_version_format CHECK ((rules_version ~ '^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}$'::text)),
    CONSTRAINT case_review_suggested_intensity_range CHECK (((suggested_intensity >= 0) AND (suggested_intensity <= 2))),
    CONSTRAINT case_review_suggested_intervention_format CHECK ((suggested_intervention ~ '^[A-Z][A-Z0-9_]{0,63}$'::text)),
    CONSTRAINT case_review_supersedes_anterior CHECK (((supersedes IS NULL) OR (supersedes < id)))
);
COMMENT ON TABLE public.case_review IS 'ALIGN-018. Decision humana append-only: las correcciones son un evento nuevo con supersedes.';
COMMENT ON COLUMN public.case_review.reason_text IS 'Motivo libre: se guarda tal como llega, 500 caracteres como maximo contando los espacios y con algun caracter visible. Advertencia al ingresarlo: no incluir datos personales ni informacion del hogar. Sin SELECT para roles de cliente: excluido por defecto de evidencias y exportaciones.';
COMMENT ON COLUMN public.case_review.checklist IS 'Lista de control de ALIGN-003: solo casillas y codigos, sin texto sobre el hogar.';
select pg_temp.paquete_restriccion('case_review', 'case_review_idempotency_key', $c$UNIQUE (tenant, idempotency_key)$c$);
select pg_temp.paquete_restriccion('case_review', 'case_review_pkey', $c$PRIMARY KEY (id)$c$);
select pg_temp.paquete_restriccion('case_review', 'case_review_supersedes_key', $c$UNIQUE (supersedes)$c$);
select pg_temp.paquete_restriccion('case_review', 'case_review_tenant_debtor_id_key', $c$UNIQUE (tenant, debtor, id)$c$);
select pg_temp.paquete_restriccion('case_review', 'case_review_tenant_id_key', $c$UNIQUE (tenant, id)$c$);
create index if not exists case_review_reviewer_idx ON public.case_review USING btree (reviewer);

-- case_review_approval
--   Finalidad:  Aprobación u objeción, por otra persona, de una propuesta de intensidad 3 o 4.
--   Impacto:    Tabla nueva, vacía. Referencia case_review.
--   Comprobar:  select count(*) from public.case_review_approval;  -- 0 al instalar
create table if not exists public.case_review_approval (
    id bigint generated always as identity,
    tenant bigint NOT NULL,
    case_review bigint NOT NULL,
    decision text NOT NULL,
    reason_code text,
    checklist public.case_review_checklist DEFAULT '{}'::jsonb NOT NULL,
    approver bigint NOT NULL,
    approver_role text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    supersedes bigint,
    idempotency_key uuid NOT NULL,
    CONSTRAINT case_review_approval_decision_valid CHECK ((decision = ANY (ARRAY['APRUEBA'::text, 'OBJETA'::text]))),
    CONSTRAINT case_review_approval_objection_requires_reason CHECK (((decision <> 'OBJETA'::text) OR (reason_code IS NOT NULL))),
    CONSTRAINT case_review_approval_reason_code_format CHECK ((reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'::text)),
    CONSTRAINT case_review_approval_requires_checklist CHECK (((decision <> 'APRUEBA'::text) OR (((checklist)::jsonb ? 'situacion_hogar'::text) AND ((checklist)::jsonb @> '{"canal_valido": true, "estado_juridico_verificado": true, "alternativa_asistida_ofrecida": true}'::jsonb)))),
    CONSTRAINT case_review_approval_supersedes_anterior CHECK (((supersedes IS NULL) OR (supersedes < id)))
);
COMMENT ON TABLE public.case_review_approval IS 'ALIGN-018. Aprobacion u objecion append-only de un supervisor distinto del proponente.';
select pg_temp.paquete_restriccion('case_review_approval', 'case_review_approval_idempotency_key', $c$UNIQUE (tenant, idempotency_key)$c$);
select pg_temp.paquete_restriccion('case_review_approval', 'case_review_approval_pkey', $c$PRIMARY KEY (id)$c$);
select pg_temp.paquete_restriccion('case_review_approval', 'case_review_approval_supersedes_key', $c$UNIQUE (supersedes)$c$);
select pg_temp.paquete_restriccion('case_review_approval', 'case_review_approval_tenant_review_id_key', $c$UNIQUE (tenant, case_review, id)$c$);
create index if not exists case_review_approval_approver_idx ON public.case_review_approval USING btree (approver);
create UNIQUE index if not exists case_review_approval_single_head ON public.case_review_approval USING btree (case_review) WHERE (supersedes IS NULL);

-- access_audit
--   Finalidad:  Registro de aperturas de caso y descargas de reportes. Sin él la aplicación no entrega fichas ni reportes.
--   Impacto:    Tabla nueva, vacía, sin claves foráneas a propósito (el rastro sobrevive a la baja de un objeto). Crece con el uso.
--   Comprobar:  select count(*) from public.access_audit;  -- 0 al instalar
create table if not exists public.access_audit (
    id bigint generated always as identity,
    tenant bigint NOT NULL,
    actor bigint NOT NULL,
    actor_role text NOT NULL,
    action text NOT NULL,
    target text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    idempotency_key uuid NOT NULL,
    CONSTRAINT access_audit_action_valid CHECK ((action = ANY (ARRAY['CASE_OPEN'::text, 'REPORT_EXPORT'::text, 'IMPORT_CONFIRM'::text, 'ANALYTICS_VIEW'::text, 'CHANNEL_LINK'::text]))),
    CONSTRAINT access_audit_actor_role_valid CHECK ((actor_role = ANY (ARRAY['ADMIN'::text, 'USER'::text, 'consulta'::text, 'operador'::text, 'supervisor'::text, 'importador'::text, 'importador_sistema'::text, 'tp_operator'::text]))),
    CONSTRAINT access_audit_target_format CHECK (
CASE
    WHEN (action = ANY (ARRAY['CASE_OPEN'::text, 'IMPORT_CONFIRM'::text, 'CHANNEL_LINK'::text])) THEN (target ~ '^[1-9][0-9]{0,17}$'::text)
    ELSE (target ~ '^[a-z][a-z0-9-]{0,63}$'::text)
END)
);
COMMENT ON TABLE public.access_audit IS 'ALIGN-069. Quien hizo que accion de la aplicacion, sin valores personales. Retencion propuesta: 24 meses, pendiente de aprobacion humana; sin purga automatica ni autorizacion de purga (SUPABASE_TESTING_CALIDAD.md). No registra lecturas directas por la Data API.';
COMMENT ON COLUMN public.access_audit.target IS 'Identificador interno (CASE_OPEN, CHANNEL_LINK: debtor.id; IMPORT_CONFIRM: import_batch.id) o codigo (REPORT_EXPORT, ANALYTICS_VIEW). Nunca un valor personal ni texto libre.';
select pg_temp.paquete_restriccion('access_audit', 'access_audit_idempotency_key', $c$UNIQUE (tenant, idempotency_key)$c$);
select pg_temp.paquete_restriccion('access_audit', 'access_audit_pkey', $c$PRIMARY KEY (id)$c$);
create index if not exists access_audit_tenant_created_idx ON public.access_audit USING btree (tenant, created_at);
create index if not exists access_audit_tenant_id_idx ON public.access_audit USING btree (tenant, id);

-- Claves foráneas (después de crear las cuatro tablas).
select pg_temp.paquete_restriccion('import_batch', 'import_batch_created_by_fkey', $c$FOREIGN KEY (created_by) REFERENCES public."user"(id)$c$);
select pg_temp.paquete_restriccion('import_batch', 'import_batch_supersedes_fkey', $c$FOREIGN KEY (tenant, supersedes) REFERENCES public.import_batch(tenant, id)$c$);
select pg_temp.paquete_restriccion('import_batch', 'import_batch_tenant_fkey', $c$FOREIGN KEY (tenant) REFERENCES public.tenant(id)$c$);
select pg_temp.paquete_restriccion('case_review', 'case_review_debtor_fkey', $c$FOREIGN KEY (tenant, debtor) REFERENCES public.debtor(tenant, id)$c$);
select pg_temp.paquete_restriccion('case_review', 'case_review_reviewer_fkey', $c$FOREIGN KEY (reviewer) REFERENCES public."user"(id)$c$);
select pg_temp.paquete_restriccion('case_review', 'case_review_supersedes_fkey', $c$FOREIGN KEY (tenant, debtor, supersedes) REFERENCES public.case_review(tenant, debtor, id)$c$);
select pg_temp.paquete_restriccion('case_review_approval', 'case_review_approval_approver_fkey', $c$FOREIGN KEY (approver) REFERENCES public."user"(id)$c$);
select pg_temp.paquete_restriccion('case_review_approval', 'case_review_approval_review_fkey', $c$FOREIGN KEY (tenant, case_review) REFERENCES public.case_review(tenant, id)$c$);
select pg_temp.paquete_restriccion('case_review_approval', 'case_review_approval_supersedes_fkey', $c$FOREIGN KEY (tenant, case_review, supersedes) REFERENCES public.case_review_approval(tenant, case_review, id)$c$);

-- ---------------------------------------------------------------------------------------------- funciones
-- equitas_append_only
--   Finalidad:  Disparador que rechaza UPDATE, DELETE y TRUNCATE en las cuatro tablas del módulo.
--   Impacto:    Solo se asocia a las tablas nuevas.
--   Comprobar:  delete from public.case_review;  -- debe fallar con APPEND_ONLY (probarlo en una transacción con rollback)
CREATE OR REPLACE FUNCTION public.equitas_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  raise exception 'APPEND_ONLY';
end $function$;
revoke all on function public.equitas_append_only() from public, anon, authenticated, service_role;

-- equitas_role_allows
--   Finalidad:  Tabla de permisos de la base: qué rol puede registrar, aprobar, leer el motivo libre y leer el registro de accesos.
--   Impacto:    Función pura, sin acceso a tablas. Único lugar de esta capa donde se nombra un rol.
--   Comprobar:  select public.equitas_role_allows('ADMIN','DECISION_RECORD'), public.equitas_role_allows('USER','DECISION_RECORD');  -- t, f
CREATE OR REPLACE FUNCTION public.equitas_role_allows(p_role text, p_capability text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce(case p_capability
    when 'DECISION_RECORD' then p_role = 'ADMIN'
    when 'DECISION_APPROVE' then p_role = 'ADMIN'
    when 'REASON_TEXT_READ' then p_role = 'ADMIN'
    when 'AUDIT_READ' then p_role = 'ADMIN'
    when 'IMPORT_WRITE' then p_role in ('ADMIN', 'importador_sistema')
    else false
  end, false)
$function$;
alter function public.equitas_role_allows(text,text) owner to equitas_write_definer;
revoke all on function public.equitas_role_allows(text,text) from public, anon, authenticated, service_role;
grant execute on function public.equitas_role_allows(text,text) to authenticated;

-- equitas_member_role
--   Finalidad:  Rol de la membresía ACTIVA de una persona en un municipio activo. La usan todas las funciones que escriben.
--   Impacto:    Lee tenant_user, "user", tenant y role. No escribe.
--   Comprobar:  Solo ejecutable por el definidor: se comprueba a través de record_case_review.
CREATE OR REPLACE FUNCTION public.equitas_member_role(p_user bigint, p_tenant bigint)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select r.name
  from public.tenant_user tu
  join public."user" u on u.id = tu."user"
  join public.tenant t on t.id = tu.tenant
  join public.role r on r.id = tu.role
  where tu."user" = p_user and tu.tenant = p_tenant and tu.status and u.status = 'ACTIVE' and t.status = 'ACTIVE'
$function$;
alter function public.equitas_member_role(bigint,bigint) owner to equitas_write_definer;
revoke all on function public.equitas_member_role(bigint,bigint) from public, anon, authenticated, service_role;

-- equitas_current_cutoff
--   Finalidad:  Lote vigente del municipio (el último publicado). De él sale la fecha de la cartera.
--   Impacto:    Lee import_batch. No escribe.
--   Comprobar:  Solo ejecutable por el definidor: se comprueba registrando la cartera heredada y una decisión.
CREATE OR REPLACE FUNCTION public.equitas_current_cutoff(p_tenant bigint)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case when e.status='PUBLICADO' then e.id end from public.import_batch e
  where e.tenant=p_tenant
    and not exists(select 1 from public.import_batch s where s.tenant=e.tenant and s.supersedes=e.id)
    and (e.status='PUBLICADO' or (e.counts->'publicacion_atomica' is distinct from '1'::jsonb
      and (e.status in ('VALIDADO','CONFIRMADO') or (e.status='FALLIDO' and e.supersedes is not null))))
  order by e.id desc limit 1
$function$;
alter function public.equitas_current_cutoff(bigint) owner to equitas_write_definer;
revoke all on function public.equitas_current_cutoff(bigint) from public, anon, authenticated, service_role;

-- equitas_verify_cutoff
--   Finalidad:  Comprueba, dentro de la transacción que escribe, que la decisión se registra sobre el lote vigente.
--   Impacto:    Lee import_batch con bloqueo consultivo por municipio. No escribe.
--   Comprobar:  Una decisión con otra fecha de cartera debe fallar con CUTOFF_CHANGED.
CREATE OR REPLACE FUNCTION public.equitas_verify_cutoff(p_tenant bigint, p_cutoff_batch bigint, p_as_of date)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  perform pg_advisory_xact_lock_shared(hashtextextended(format('import_batch:%s', p_tenant), 0));
  if p_cutoff_batch is null
     or p_cutoff_batch is distinct from public.equitas_current_cutoff(p_tenant)
     or not exists(select 1 from public.import_batch b where b.id = p_cutoff_batch and b.tenant = p_tenant and b.as_of = p_as_of) then
    raise exception 'CUTOFF_CHANGED';
  end if;
end $function$;
alter function public.equitas_verify_cutoff(bigint,bigint,date) owner to equitas_write_definer;
revoke all on function public.equitas_verify_cutoff(bigint,bigint,date) from public, anon, authenticated, service_role;

-- record_case_review
--   Finalidad:  Única vía para registrar una decisión. Verifica membresía activa, rol, municipio del caso, cartera vigente y cadena.
--   Impacto:    Inserta en case_review. La llama el servidor de la aplicación con la credencial equitas_review_server.
--   Comprobar:  Flujo completo desde la aplicación: registrar una decisión con una cuenta ADMIN.
CREATE OR REPLACE FUNCTION public.record_case_review(p_reviewer_user bigint, p_tenant bigint, p_debtor bigint, p_cutoff_batch bigint, p_rules_version text, p_as_of date, p_inputs_hash text, p_suggested_intervention text, p_suggested_intensity integer, p_explanation jsonb, p_decision text, p_idempotency_key uuid, p_decided_intervention text DEFAULT NULL::text, p_decided_intensity integer DEFAULT NULL::integer, p_reason_code text DEFAULT NULL::text, p_reason_text text DEFAULT NULL::text, p_checklist jsonb DEFAULT '{}'::jsonb, p_supersedes bigint DEFAULT NULL::bigint, OUT review_id bigint, OUT created boolean, OUT pending_supervisor boolean)
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role text := public.equitas_member_role(p_reviewer_user, p_tenant);
  v_existing public.case_review;
  v_violation text;
begin
  if v_role is null then raise exception 'ACTOR_NOT_ACTIVE_MEMBER'; end if;
  if not public.equitas_role_allows(v_role, 'DECISION_RECORD') then raise exception 'ROLE_NOT_ALLOWED'; end if;
  if not exists(select 1 from public.debtor d where d.id = p_debtor and d.tenant = p_tenant) then
    raise exception 'OBJECT_NOT_IN_TENANT';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(format('case_review:%s:%s', p_tenant, p_debtor), 0));
  select * into v_existing from public.case_review r where r.tenant = p_tenant and r.idempotency_key = p_idempotency_key;
  if found then
    if (v_existing.debtor, v_existing.reviewer, v_existing.rules_version, v_existing.as_of, v_existing.inputs_hash,
        v_existing.suggested_intervention, v_existing.suggested_intensity, v_existing.explanation, v_existing.decision,
        v_existing.decided_intervention, v_existing.decided_intensity, v_existing.reason_code, v_existing.reason_text,
        v_existing.checklist::jsonb, v_existing.supersedes)
       is distinct from
       (p_debtor, p_reviewer_user, p_rules_version, p_as_of, p_inputs_hash, p_suggested_intervention, p_suggested_intensity,
        p_explanation, p_decision, p_decided_intervention, p_decided_intensity, p_reason_code, p_reason_text, p_checklist, p_supersedes) then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT';
    end if;
    review_id := v_existing.id;
    created := false;
    pending_supervisor := coalesce(v_existing.decided_intensity, 0) >= 3;
    return;
  end if;
  perform public.equitas_verify_cutoff(p_tenant, p_cutoff_batch, p_as_of);
  if p_supersedes is not null and not exists(select 1 from public.case_review r where r.id = p_supersedes and r.tenant = p_tenant and r.debtor = p_debtor) then
    raise exception 'SUPERSEDES_NOT_FOUND';
  end if;
  begin
    insert into public.case_review(tenant, debtor, rules_version, as_of, inputs_hash, suggested_intervention, suggested_intensity,
      explanation, decision, decided_intervention, decided_intensity, reason_code, reason_text, checklist, reviewer, reviewer_role,
      supersedes, idempotency_key)
    values (p_tenant, p_debtor, p_rules_version, p_as_of, p_inputs_hash, p_suggested_intervention, p_suggested_intensity,
      p_explanation, p_decision, p_decided_intervention, p_decided_intensity, p_reason_code, p_reason_text, p_checklist, p_reviewer_user, v_role,
      p_supersedes, p_idempotency_key)
    returning id into review_id;
  exception when check_violation or not_null_violation or foreign_key_violation or unique_violation then
    get stacked diagnostics v_violation = constraint_name;
    raise exception 'INVALID_CASE_REVIEW:%', coalesce(nullif(v_violation, ''), 'not_null');
  end;
  created := true;
  pending_supervisor := coalesce(p_decided_intensity, 0) >= 3;
end $function$;
alter function public.record_case_review(bigint,bigint,bigint,bigint,text,date,text,text,integer,jsonb,text,uuid,text,integer,text,text,jsonb,bigint) owner to equitas_write_definer;
revoke all on function public.record_case_review(bigint,bigint,bigint,bigint,text,date,text,text,integer,jsonb,text,uuid,text,integer,text,text,jsonb,bigint) from public, anon, authenticated, service_role;
grant execute on function public.record_case_review(bigint,bigint,bigint,bigint,text,date,text,text,integer,jsonb,text,uuid,text,integer,text,text,jsonb,bigint) to equitas_review_server;

-- record_case_review_approval
--   Finalidad:  Única vía para aprobar u objetar. Rechaza a quien propuso (en cualquier versión de la cadena): APPROVER_IS_PROPONENT.
--   Impacto:    Inserta en case_review_approval.
--   Comprobar:  Desde la aplicación: quien propuso no puede aprobar; otra cuenta ADMIN sí.
CREATE OR REPLACE FUNCTION public.record_case_review_approval(p_approver_user bigint, p_tenant bigint, p_case_review bigint, p_decision text, p_idempotency_key uuid, p_cutoff_batch bigint, p_reason_code text DEFAULT NULL::text, p_checklist jsonb DEFAULT '{}'::jsonb, p_supersedes bigint DEFAULT NULL::bigint, OUT approval_id bigint, OUT created boolean)
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role text := public.equitas_member_role(p_approver_user, p_tenant);
  v_review public.case_review;
  v_existing public.case_review_approval;
  v_chain_invalid boolean;
  v_is_proponent boolean;
  v_violation text;
begin
  if v_role is null then raise exception 'ACTOR_NOT_ACTIVE_MEMBER'; end if;
  if not public.equitas_role_allows(v_role, 'DECISION_APPROVE') then raise exception 'ROLE_NOT_ALLOWED'; end if;
  select * into v_review from public.case_review r where r.id = p_case_review and r.tenant = p_tenant;
  if not found then raise exception 'REVIEW_NOT_IN_TENANT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(format('case_review:%s:%s', p_tenant, v_review.debtor), 0));
  -- Distinto de quien propuso esta version o una anterior de la misma cadena. Los IDs bajan en cada paso: el recorrido termina aunque
  -- la tabla tuviera un ciclo, y todo ciclo o antecedente posterior tiene un eslabon con supersedes >= id, que se rechaza.
  with recursive chain as (
    select r.id, r.reviewer, r.supersedes from public.case_review r where r.id = p_case_review
    union all
    select r.id, r.reviewer, r.supersedes from public.case_review r join chain c on r.id = c.supersedes and r.id < c.id
  )
  select coalesce(bool_or(c.supersedes >= c.id), false), coalesce(bool_or(c.reviewer = p_approver_user), false)
  into v_chain_invalid, v_is_proponent from chain c;
  if v_chain_invalid then raise exception 'SUPERSEDES_CHAIN_INVALID'; end if;
  if v_is_proponent then raise exception 'APPROVER_IS_PROPONENT'; end if;
  if coalesce(v_review.decided_intensity, 0) < 3 then raise exception 'APPROVAL_NOT_REQUIRED'; end if;
  select * into v_existing from public.case_review_approval a where a.tenant = p_tenant and a.idempotency_key = p_idempotency_key;
  if found then
    if (v_existing.case_review, v_existing.decision, v_existing.reason_code, v_existing.checklist::jsonb, v_existing.approver, v_existing.supersedes)
       is distinct from (p_case_review, p_decision, p_reason_code, p_checklist, p_approver_user, p_supersedes) then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT';
    end if;
    approval_id := v_existing.id;
    created := false;
    return;
  end if;
  if exists(select 1 from public.case_review r where r.supersedes = p_case_review) then raise exception 'REVIEW_SUPERSEDED'; end if;
  if p_decision = 'APRUEBA' then
    perform public.equitas_verify_cutoff(p_tenant, p_cutoff_batch, v_review.as_of);
  end if;
  if p_supersedes is not null and not exists(select 1 from public.case_review_approval a where a.id = p_supersedes and a.tenant = p_tenant and a.case_review = p_case_review) then
    raise exception 'SUPERSEDES_NOT_FOUND';
  end if;
  begin
    insert into public.case_review_approval(tenant, case_review, decision, reason_code, checklist, approver, approver_role, supersedes, idempotency_key)
    values (p_tenant, p_case_review, p_decision, p_reason_code, p_checklist, p_approver_user, v_role, p_supersedes, p_idempotency_key)
    returning id into approval_id;
  exception when check_violation or not_null_violation or foreign_key_violation or unique_violation then
    get stacked diagnostics v_violation = constraint_name;
    raise exception 'INVALID_CASE_REVIEW_APPROVAL:%', coalesce(nullif(v_violation, ''), 'not_null');
  end;
  created := true;
end $function$;
alter function public.record_case_review_approval(bigint,bigint,bigint,text,uuid,bigint,text,jsonb,bigint) owner to equitas_write_definer;
revoke all on function public.record_case_review_approval(bigint,bigint,bigint,text,uuid,bigint,text,jsonb,bigint) from public, anon, authenticated, service_role;
grant execute on function public.record_case_review_approval(bigint,bigint,bigint,text,uuid,bigint,text,jsonb,bigint) to equitas_review_server;

-- read_case_review_reason_text
--   Finalidad:  Lectura del motivo libre de una decisión, solo para el rol que lo permite.
--   Impacto:    Lee case_review.reason_text, que los roles de cliente no pueden seleccionar.
--   Comprobar:  Con USER debe fallar con ROLE_NOT_ALLOWED.
CREATE OR REPLACE FUNCTION public.read_case_review_reason_text(p_actor_user bigint, p_tenant bigint, p_case_review bigint)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role text := public.equitas_member_role(p_actor_user, p_tenant);
  v_text text;
begin
  if v_role is null then raise exception 'ACTOR_NOT_ACTIVE_MEMBER'; end if;
  if not public.equitas_role_allows(v_role, 'REASON_TEXT_READ') then raise exception 'ROLE_NOT_ALLOWED'; end if;
  select r.reason_text into v_text from public.case_review r where r.id = p_case_review and r.tenant = p_tenant;
  if not found then raise exception 'REVIEW_NOT_IN_TENANT'; end if;
  return v_text;
end $function$;
alter function public.read_case_review_reason_text(bigint,bigint,bigint) owner to equitas_write_definer;
revoke all on function public.read_case_review_reason_text(bigint,bigint,bigint) from public, anon, authenticated, service_role;
grant execute on function public.read_case_review_reason_text(bigint,bigint,bigint) to equitas_review_server;

-- record_access_audit
--   Finalidad:  Única vía para escribir el registro de accesos. El rol lo toma la base de la membresía; quien llama no lo elige.
--   Impacto:    Inserta en access_audit.
--   Comprobar:  Abrir un caso desde la aplicación deja una fila CASE_OPEN.
CREATE OR REPLACE FUNCTION public.record_access_audit(p_actor_user bigint, p_tenant bigint, p_action text, p_target text, p_idempotency_key uuid, OUT audit_id bigint, OUT created boolean)
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role text := public.equitas_member_role(p_actor_user, p_tenant);
  v_existing public.access_audit;
  v_violation text;
  v_id bigint := case when p_target ~ '^[1-9][0-9]{0,17}$' then p_target::bigint end;
begin
  if v_role is null then raise exception 'ACTOR_NOT_ACTIVE_MEMBER'; end if;
  if p_action in ('CASE_OPEN', 'CHANNEL_LINK') and not exists(select 1 from public.debtor d where d.id = v_id and d.tenant = p_tenant) then
    raise exception 'OBJECT_NOT_IN_TENANT';
  end if;
  if p_action = 'IMPORT_CONFIRM' and not exists(select 1 from public.import_batch b where b.id = v_id and b.tenant = p_tenant) then
    raise exception 'OBJECT_NOT_IN_TENANT';
  end if;
  begin
    insert into public.access_audit(tenant, actor, actor_role, action, target, idempotency_key)
    values (p_tenant, p_actor_user, v_role, p_action, p_target, p_idempotency_key)
    on conflict (tenant, idempotency_key) do nothing
    returning id into audit_id;
  exception when check_violation or not_null_violation then
    get stacked diagnostics v_violation = constraint_name;
    raise exception 'INVALID_ACCESS_AUDIT:%', coalesce(nullif(v_violation, ''), 'not_null');
  end;
  if audit_id is not null then
    created := true;
    return;
  end if;
  select * into v_existing from public.access_audit a where a.tenant = p_tenant and a.idempotency_key = p_idempotency_key;
  if (v_existing.actor, v_existing.action, v_existing.target) is distinct from (p_actor_user, p_action, p_target) then
    raise exception 'IDEMPOTENCY_KEY_CONFLICT';
  end if;
  audit_id := v_existing.id;
  created := false;
end $function$;
alter function public.record_access_audit(bigint,bigint,text,text,uuid) owner to equitas_write_definer;
revoke all on function public.record_access_audit(bigint,bigint,text,text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.record_access_audit(bigint,bigint,text,text,uuid) to equitas_review_server;

-- ---------------------------------------------------------------------------------------------- disparadores de solo agregado y permisos
alter table public.import_batch enable row level security;
revoke all on table public.import_batch from public, anon, authenticated, service_role;
create or replace trigger import_batch_append_only BEFORE DELETE OR UPDATE ON public.import_batch FOR EACH ROW EXECUTE FUNCTION public.equitas_append_only();
create or replace trigger import_batch_no_truncate BEFORE TRUNCATE ON public.import_batch FOR EACH STATEMENT EXECUTE FUNCTION public.equitas_append_only();
GRANT SELECT,INSERT ON TABLE public.import_batch TO equitas_write_definer;
GRANT SELECT ON TABLE public.import_batch TO authenticated;

alter table public.case_review enable row level security;
revoke all on table public.case_review from public, anon, authenticated, service_role;
create or replace trigger case_review_append_only BEFORE DELETE OR UPDATE ON public.case_review FOR EACH ROW EXECUTE FUNCTION public.equitas_append_only();
create or replace trigger case_review_no_truncate BEFORE TRUNCATE ON public.case_review FOR EACH STATEMENT EXECUTE FUNCTION public.equitas_append_only();
GRANT SELECT,INSERT ON TABLE public.case_review TO equitas_write_definer;
grant select (id, tenant, debtor, rules_version, as_of, inputs_hash, suggested_intervention, suggested_intensity, explanation, decision, decided_intervention, decided_intensity, reason_code, checklist, reviewer, reviewer_role, created_at, supersedes, idempotency_key)
  on table public.case_review to authenticated;

alter table public.case_review_approval enable row level security;
revoke all on table public.case_review_approval from public, anon, authenticated, service_role;
create or replace trigger case_review_approval_append_only BEFORE DELETE OR UPDATE ON public.case_review_approval FOR EACH ROW EXECUTE FUNCTION public.equitas_append_only();
create or replace trigger case_review_approval_no_truncate BEFORE TRUNCATE ON public.case_review_approval FOR EACH STATEMENT EXECUTE FUNCTION public.equitas_append_only();
GRANT SELECT,INSERT ON TABLE public.case_review_approval TO equitas_write_definer;
GRANT SELECT ON TABLE public.case_review_approval TO authenticated;

alter table public.access_audit enable row level security;
revoke all on table public.access_audit from public, anon, authenticated, service_role;
create or replace trigger access_audit_append_only BEFORE DELETE OR UPDATE ON public.access_audit FOR EACH ROW EXECUTE FUNCTION public.equitas_append_only();
create or replace trigger access_audit_no_truncate BEFORE TRUNCATE ON public.access_audit FOR EACH STATEMENT EXECUTE FUNCTION public.equitas_append_only();
GRANT SELECT,INSERT ON TABLE public.access_audit TO equitas_write_definer;
GRANT SELECT ON TABLE public.access_audit TO authenticated;


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
create policy admin_read_access_audit ON public.access_audit FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (((public.tenant_user tu
     JOIN public."user" u ON ((u.id = tu."user")))
     JOIN public.tenant t ON ((t.id = tu.tenant)))
     JOIN public.role r ON ((r.id = tu.role)))
  WHERE ((tu.tenant = access_audit.tenant) AND tu.status AND (u.status = 'ACTIVE'::text) AND (t.status = 'ACTIVE'::text) AND (u.auth_user = ( SELECT auth.uid() AS uid)) AND public.equitas_role_allows(r.name, 'AUDIT_READ'::text)))));

revoke create on schema public from equitas_write_definer;

-- ---------------------------------------------------------------------------------------------- comprobación de cierre
-- Si algo no quedó como se espera, la transacción entera se deshace.
do $$
declare missing text;
begin
  select string_agg(name, ', ') into missing from unnest(array['import_batch', 'case_review', 'case_review_approval', 'access_audit']) name where to_regclass('public.' || name) is null;
  if missing is not null then raise exception 'PAQUETE_INCOMPLETO: faltan tablas: %', missing; end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any (array['equitas_append_only', 'equitas_role_allows', 'equitas_member_role', 'equitas_current_cutoff', 'equitas_verify_cutoff', 'record_case_review', 'record_case_review_approval', 'read_case_review_reason_text', 'record_access_audit'])) <> 9 then
    raise exception 'PAQUETE_INCOMPLETO: se esperaba una sola versión de cada función';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = any (array['equitas_append_only', 'equitas_role_allows', 'equitas_member_role', 'equitas_current_cutoff', 'equitas_verify_cutoff', 'record_case_review', 'record_case_review_approval', 'read_case_review_reason_text', 'record_access_audit'])
               and (p.proconfig is null or not p.proconfig @> array['search_path=""'])) then
    raise exception 'PAQUETE_INSEGURO: una función quedó sin search_path vacío';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace, unnest(array['anon', 'service_role']) role
             where n.nspname = 'public' and p.proname = any (array['equitas_append_only', 'equitas_role_allows', 'equitas_member_role', 'equitas_current_cutoff', 'equitas_verify_cutoff', 'record_case_review', 'record_case_review_approval', 'read_case_review_reason_text', 'record_access_audit']) and has_function_privilege(role, p.oid, 'execute')) then
    raise exception 'PAQUETE_INSEGURO: anon o service_role pueden ejecutar una función del módulo';
  end if;
  -- Una persona con su sesión solo puede ejecutar la tabla de permisos (la usa una política de lectura).
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = any (array['equitas_append_only', 'equitas_role_allows', 'equitas_member_role', 'equitas_current_cutoff', 'equitas_verify_cutoff', 'record_case_review', 'record_case_review_approval', 'read_case_review_reason_text', 'record_access_audit']) and p.proname <> 'equitas_role_allows'
               and has_function_privilege('authenticated', p.oid, 'execute')) then
    raise exception 'PAQUETE_INSEGURO: authenticated puede ejecutar una función del módulo';
  end if;
  if exists (select 1 from unnest(array['import_batch', 'case_review', 'case_review_approval', 'access_audit']) name, unnest(array['anon', 'service_role']) role
             where has_table_privilege(role, 'public.' || name, 'select') or has_any_column_privilege(role, 'public.' || name, 'select')) then
    raise exception 'PAQUETE_INSEGURO: anon o service_role pueden leer una tabla del módulo';
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
-- «la tabla no existe» durante un rato y la aplicación se comportaría como si el módulo no estuviera
-- (abriría casos sin dejar registro).
notify pgrst, 'reload schema';

-- ÚLTIMO PASO DE LA INSTALACIÓN, fuera de este archivo: comprobar que la Data API ya sirve el módulo.
--   GET <url del proyecto>/rest/v1/access_audit?select=id&limit=0   (con la clave pública)
-- Sin sesión tiene que responder 401 con el código 42501 (permiso denegado: la tabla ya es conocida); con la
-- sesión de una cuenta, 200. Si responde 404 con el código PGRST205, la Data API todavía no sirve el módulo:
-- repetir el `notify` de arriba y volver a probar antes de usar la aplicación.
