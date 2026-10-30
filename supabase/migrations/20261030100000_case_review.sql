-- ALIGN-018. SOLO base local aislada (docs/tesis/entorno-aislado.md); nunca en el original ni en testing.

-- Revision humana, aprobacion de supervisor y lote: append-only, lectura por membresia activa, escritura solo por funciones de servidor.

-- Sin filas. No crea, modifica ni elimina politicas, RLS ni grants de tabla de las 23 tablas existentes.

-- Sobre tablas existentes solo agrega: una unica en debtor(tenant, id) y SELECT de columnas puntuales para el rol definidor.

-- Roles y credencial: SUPABASE_TESTING_CALIDAD.md (ALIGN-018). El rol de servidor nunca va al cliente ni a NEXT_PUBLIC_*.

-- Reversion: db reset --version 20261030090000 (solo local). Inversa: SUPABASE_TESTING_CALIDAD.md.

do $$ begin if to_regclass('public.debt') is null or not exists(select 1 from pg_policies where schemaname='public' and policyname='member_read_debt') or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='tenant' and column_name='id' and is_identity='YES') then raise exception 'Requiere 20261021220156, 20261021221030 y 20261030090000'; end if; end $$;

-- 1. Roles. Ninguno inicia sesion: los dos de servidor se usan con un JWT server-only via authenticator.

-- El definidor es dueno de las funciones. BYPASSRLS porque no se agregan politicas a tablas existentes; solo alcanza lo que se le otorga abajo.

do $$
declare r text;
begin
  foreach r in array array['equitas_write_definer', 'equitas_review_server', 'equitas_import_server'] loop
    if not exists(select 1 from pg_roles where rolname = r) then
      execute format('create role %I', r);
    end if;
  end loop;
end $$;

alter role equitas_write_definer nologin noinherit nocreatedb nocreaterole bypassrls;

alter role equitas_review_server nologin noinherit nocreatedb nocreaterole nobypassrls;

alter role equitas_import_server nologin noinherit nocreatedb nocreaterole nobypassrls;

grant equitas_review_server, equitas_import_server to authenticator;

-- 2. Integridad tenant -> objeto -> revision -> aprobacion por FK compuestas.

alter table public."debtor" add constraint "debtor_tenant_id_key" unique (tenant, id);

-- Lista de control de ALIGN-003: solo casillas y codigos. Una clave o un valor fuera de lista se rechaza: no admite texto sobre el hogar.

create domain public.case_review_checklist as jsonb
  constraint case_review_checklist_shape check (
    jsonb_typeof(value) = 'object'
    and value - array['situacion_hogar', 'estado_juridico_verificado', 'canal_valido', 'alternativa_asistida_ofrecida'] = '{}'::jsonb
    and coalesce(value -> 'situacion_hogar', '"NO_DISPONIBLE"'::jsonb) in ('"CONSULTADA"'::jsonb, '"NO_DISPONIBLE"'::jsonb)
    and coalesce(jsonb_typeof(value -> 'estado_juridico_verificado'), 'boolean') = 'boolean'
    and coalesce(jsonb_typeof(value -> 'canal_valido'), 'boolean') = 'boolean'
    and coalesce(jsonb_typeof(value -> 'alternativa_asistida_ofrecida'), 'boolean') = 'boolean'
  );

-- 3. Revision humana. El sistema sugiere hasta 2; 3 y 4 solo los propone una persona (ALIGN-003).

create table public."case_review" (
  "id" bigint generated always as identity primary key,
  "tenant" bigint not null,
  "debtor" bigint not null,
  "rules_version" text not null,
  "as_of" date not null,
  "inputs_hash" text not null,
  "suggested_intervention" text not null,
  "suggested_intensity" integer not null,
  "explanation" jsonb not null,
  "decision" text not null,
  "decided_intervention" text,
  "decided_intensity" integer,
  "reason_code" text,
  "reason_text" text,
  "checklist" public.case_review_checklist not null default '{}',
  "reviewer" bigint not null references public."user"(id),
  "reviewer_role" text not null,
  "created_at" timestamptz not null default now(),
  "supersedes" bigint,
  "idempotency_key" uuid not null,
  constraint "case_review_debtor_fkey" foreign key (tenant, debtor) references public."debtor"(tenant, id),
  constraint "case_review_tenant_debtor_id_key" unique (tenant, debtor, id),
  constraint "case_review_tenant_id_key" unique (tenant, id),
  constraint "case_review_supersedes_fkey" foreign key (tenant, debtor, supersedes) references public."case_review"(tenant, debtor, id),
  constraint "case_review_supersedes_key" unique (supersedes),
  constraint "case_review_idempotency_key" unique (tenant, idempotency_key),
  constraint "case_review_rules_version_format" check (rules_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  constraint "case_review_inputs_hash_format" check (inputs_hash ~ '^[0-9a-f]{64}$'),
  constraint "case_review_suggested_intervention_format" check (suggested_intervention ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  constraint "case_review_suggested_intensity_range" check (suggested_intensity between 0 and 2),
  constraint "case_review_explanation_object" check (jsonb_typeof(explanation) = 'object' and octet_length(explanation::text) <= 16384),
  constraint "case_review_decision_valid" check (decision in ('ACEPTA', 'MODIFICA', 'RECHAZA', 'POSPONE', 'DERIVA')),
  constraint "case_review_decided_intervention_format" check (decided_intervention ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  constraint "case_review_decided_intensity_range" check (decided_intensity between 0 and 4),
  constraint "case_review_decided_pair" check ((decided_intervention is null) = (decided_intensity is null)),
  constraint "case_review_decision_requires_reason" check (decision = 'ACEPTA' or reason_code is not null),
  constraint "case_review_acepta_matches_suggestion" check (decision <> 'ACEPTA' or (decided_intervention is not distinct from suggested_intervention and decided_intensity is not distinct from suggested_intensity)),
  constraint "case_review_modifica_changes_suggestion" check (decision <> 'MODIFICA' or (decided_intensity is not null and (decided_intervention, decided_intensity) is distinct from (suggested_intervention, suggested_intensity))),
  constraint "case_review_no_action_without_decided" check (decision not in ('RECHAZA', 'POSPONE') or decided_intensity is null),
  constraint "case_review_reason_code_format" check (reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  constraint "case_review_reason_text_length" check (char_length(btrim(reason_text)) between 1 and 500),
  constraint "case_review_reason_text_requires_code" check (reason_text is null or reason_code is not null),
  constraint "case_review_intense_requires_checklist" check (coalesce(decided_intensity, 0) < 3 or (checklist ? 'situacion_hogar' and checklist @> '{"estado_juridico_verificado": true, "canal_valido": true, "alternativa_asistida_ofrecida": true}'))
);

comment on table public."case_review" is 'ALIGN-018. Decision humana append-only: las correcciones son un evento nuevo con supersedes.';

comment on column public."case_review"."reason_text" is 'Motivo libre, 500 caracteres como maximo. Advertencia al ingresarlo: no incluir datos personales ni informacion del hogar. Sin SELECT para roles de cliente: excluido por defecto de evidencias y exportaciones.';

comment on column public."case_review"."checklist" is 'Lista de control de ALIGN-003: solo casillas y codigos, sin texto sobre el hogar.';

create index "case_review_reviewer_idx" on public."case_review"("reviewer");

-- 4. Aprobacion u objecion de supervisor para intensidad >= 3. Una sola cadena por revision.

create table public."case_review_approval" (
  "id" bigint generated always as identity primary key,
  "tenant" bigint not null,
  "case_review" bigint not null,
  "decision" text not null,
  "reason_code" text,
  "checklist" public.case_review_checklist not null default '{}',
  "approver" bigint not null references public."user"(id),
  "approver_role" text not null,
  "created_at" timestamptz not null default now(),
  "supersedes" bigint,
  "idempotency_key" uuid not null,
  constraint "case_review_approval_review_fkey" foreign key (tenant, case_review) references public."case_review"(tenant, id),
  constraint "case_review_approval_tenant_review_id_key" unique (tenant, case_review, id),
  constraint "case_review_approval_supersedes_fkey" foreign key (tenant, case_review, supersedes) references public."case_review_approval"(tenant, case_review, id),
  constraint "case_review_approval_supersedes_key" unique (supersedes),
  constraint "case_review_approval_idempotency_key" unique (tenant, idempotency_key),
  constraint "case_review_approval_decision_valid" check (decision in ('APRUEBA', 'OBJETA')),
  constraint "case_review_approval_reason_code_format" check (reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  constraint "case_review_approval_objection_requires_reason" check (decision <> 'OBJETA' or reason_code is not null),
  constraint "case_review_approval_requires_checklist" check (decision <> 'APRUEBA' or (checklist ? 'situacion_hogar' and checklist @> '{"estado_juridico_verificado": true, "canal_valido": true, "alternativa_asistida_ofrecida": true}'))
);

comment on table public."case_review_approval" is 'ALIGN-018. Aprobacion u objecion append-only de un supervisor distinto del proponente.';

create unique index "case_review_approval_single_head" on public."case_review_approval"("case_review") where supersedes is null;

create index "case_review_approval_approver_idx" on public."case_review_approval"("approver");

-- 5. Lote de importacion. Cada cambio de estado es un evento nuevo con supersedes. Estados de ALIGN-032.

create table public."import_batch" (
  "id" bigint generated always as identity primary key,
  "tenant" bigint not null references public."tenant"(id),
  "source" text not null,
  "file_hashes" jsonb not null,
  "as_of" date not null,
  "source_updated_at" date,
  "rules_version" text not null,
  "counts" jsonb not null default '{}',
  "status" text not null,
  "created_by" bigint not null references public."user"(id),
  "created_by_role" text not null,
  "created_at" timestamptz not null default now(),
  "supersedes" bigint,
  "idempotency_key" uuid not null,
  constraint "import_batch_tenant_id_key" unique (tenant, id),
  constraint "import_batch_supersedes_fkey" foreign key (tenant, supersedes) references public."import_batch"(tenant, id),
  constraint "import_batch_supersedes_key" unique (supersedes),
  constraint "import_batch_idempotency_key" unique (tenant, idempotency_key),
  constraint "import_batch_source_format" check (source ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  constraint "import_batch_file_hashes_format" check (jsonb_typeof(file_hashes) = 'object' and file_hashes <> '{}'::jsonb and not jsonb_path_exists(file_hashes, '$.keyvalue() ? (!(@.key like_regex "^[a-z][a-z0-9_]{0,63}$") || @.value.type() != "string" || !(@.value like_regex "^[0-9a-f]{64}$"))')),
  constraint "import_batch_rules_version_format" check (rules_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  constraint "import_batch_counts_format" check (jsonb_typeof(counts) = 'object' and not jsonb_path_exists(counts, '$.** ? (@.type() == "string" || (@.type() == "number" && @ < 0))')),
  constraint "import_batch_status_valid" check (status in ('RECIBIDO', 'VALIDADO', 'CONFIRMADO', 'PUBLICADO', 'FALLIDO', 'DESCARTADO', 'REQUIERE_NUEVO_PREVIEW'))
);

comment on table public."import_batch" is 'ALIGN-018. Lote append-only: procedencia, hashes, corte y conteos, sin filas de cartera ni rutas de archivo.';

create index "import_batch_created_by_idx" on public."import_batch"("created_by");

-- 6. Append-only tambien para el dueno de las tablas. Los roles de aplicacion ya fallan antes por falta de privilegio.

create function public.equitas_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'APPEND_ONLY';
end $$;

do $$
declare t text;
begin
  foreach t in array array['case_review', 'case_review_approval', 'import_batch'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.equitas_append_only()', t || '_append_only', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.equitas_append_only()', t || '_no_truncate', t);
  end loop;
end $$;

-- 7. Privilegios. Los default privileges locales dan TRUNCATE, REFERENCES, TRIGGER y MAINTAIN sobre tablas y UPDATE sobre secuencias.

do $$
declare
  t text;
  s text;
begin
  foreach t in array array['case_review', 'case_review_approval', 'import_batch'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    s := pg_get_serial_sequence(format('public.%I', t), 'id');
    execute format('revoke all on sequence %s from public, anon, authenticated, service_role', s);
    execute format('grant select, insert on public.%I to equitas_write_definer', t);
  end loop;
end $$;

-- reason_text queda fuera: select=* falla cerrado y el texto solo se lee con read_case_review_reason_text.

grant select ("id", "tenant", "debtor", "rules_version", "as_of", "inputs_hash", "suggested_intervention", "suggested_intensity", "explanation", "decision", "decided_intervention", "decided_intensity", "reason_code", "checklist", "reviewer", "reviewer_role", "created_at", "supersedes", "idempotency_key") on public."case_review" to anon, authenticated, service_role;

grant select on public."case_review_approval" to anon, authenticated, service_role;

grant select on public."import_batch" to anon, authenticated, service_role;

create policy "member_read_case_review" on public."case_review" for select to authenticated using (tenant in (select id from public.tenant));

create policy "member_read_case_review_approval" on public."case_review_approval" for select to authenticated using (tenant in (select id from public.tenant));

create policy "member_read_import_batch" on public."import_batch" for select to authenticated using (tenant in (select id from public.tenant));

-- Solo lo que necesitan las funciones para verificar actor y objeto.

grant select ("id", "status") on public."user" to equitas_write_definer;

grant select ("tenant", "user", "role", "status") on public."tenant_user" to equitas_write_definer;

grant select ("id", "name") on public."role" to equitas_write_definer;

grant select ("id", "status") on public."tenant" to equitas_write_definer;

grant select ("id", "tenant") on public."debtor" to equitas_write_definer;

-- 8. Funciones. search_path vacio y nombres calificados. El actor lo resuelve el servidor desde la sesion (DAL): nunca viene del navegador.

-- Rechazos: mensaje estable sin valores. PostgreSQL pondria la fila completa en el DETAIL de una violacion: por eso se reemplaza por el nombre de la restriccion.

create function public.equitas_member_role(p_user bigint, p_tenant bigint) returns text
language sql stable set search_path = '' as $$
  select r.name
  from public.tenant_user tu
  join public."user" u on u.id = tu."user"
  join public.tenant t on t.id = tu.tenant
  join public.role r on r.id = tu.role
  where tu."user" = p_user and tu.tenant = p_tenant and tu.status and u.status = 'ACTIVE' and t.status = 'ACTIVE'
$$;

create function public.record_case_review(
  p_reviewer_user bigint, p_tenant bigint, p_debtor bigint, p_rules_version text, p_as_of date, p_inputs_hash text,
  p_suggested_intervention text, p_suggested_intensity integer, p_explanation jsonb, p_decision text, p_idempotency_key uuid,
  p_decided_intervention text default null, p_decided_intensity integer default null, p_reason_code text default null,
  p_reason_text text default null, p_checklist jsonb default '{}', p_supersedes bigint default null,
  out review_id bigint, out created boolean, out pending_supervisor boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_role text := public.equitas_member_role(p_reviewer_user, p_tenant);
  v_existing public.case_review;
  v_violation text;
begin
  if v_role is null then raise exception 'ACTOR_NOT_ACTIVE_MEMBER'; end if;
  if v_role <> 'operador' then raise exception 'ROLE_NOT_ALLOWED'; end if;
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
end $$;

create function public.record_case_review_approval(
  p_approver_user bigint, p_tenant bigint, p_case_review bigint, p_decision text, p_idempotency_key uuid,
  p_reason_code text default null, p_checklist jsonb default '{}', p_supersedes bigint default null,
  out approval_id bigint, out created boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_role text := public.equitas_member_role(p_approver_user, p_tenant);
  v_review public.case_review;
  v_existing public.case_review_approval;
  v_violation text;
begin
  if v_role is null then raise exception 'ACTOR_NOT_ACTIVE_MEMBER'; end if;
  if v_role <> 'supervisor' then raise exception 'ROLE_NOT_ALLOWED'; end if;
  select * into v_review from public.case_review r where r.id = p_case_review and r.tenant = p_tenant;
  if not found then raise exception 'REVIEW_NOT_IN_TENANT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(format('case_review:%s:%s', p_tenant, v_review.debtor), 0));
  if v_review.reviewer = p_approver_user then raise exception 'APPROVER_IS_PROPONENT'; end if;
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
  begin
    insert into public.case_review_approval(tenant, case_review, decision, reason_code, checklist, approver, approver_role, supersedes, idempotency_key)
    values (p_tenant, p_case_review, p_decision, p_reason_code, p_checklist, p_approver_user, v_role, p_supersedes, p_idempotency_key)
    returning id into approval_id;
  exception when check_violation or not_null_violation or foreign_key_violation or unique_violation then
    get stacked diagnostics v_violation = constraint_name;
    raise exception 'INVALID_CASE_REVIEW_APPROVAL:%', coalesce(nullif(v_violation, ''), 'not_null');
  end;
  created := true;
end $$;

-- Lectura explicita del motivo libre para quien decide o supervisa. consulta no lo ve (minimizacion).

create function public.read_case_review_reason_text(p_actor_user bigint, p_tenant bigint, p_case_review bigint) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := public.equitas_member_role(p_actor_user, p_tenant);
  v_text text;
begin
  if v_role is null then raise exception 'ACTOR_NOT_ACTIVE_MEMBER'; end if;
  if v_role not in ('operador', 'supervisor') then raise exception 'ROLE_NOT_ALLOWED'; end if;
  select r.reason_text into v_text from public.case_review r where r.id = p_case_review and r.tenant = p_tenant;
  if not found then raise exception 'REVIEW_NOT_IN_TENANT'; end if;
  return v_text;
end $$;

-- importador "puede coincidir con supervisor" (ALIGN-003) y la membresia admite un solo rol por tenant: por eso supervisor tambien registra lotes.

create function public.record_import_batch(
  p_actor_user bigint, p_tenant bigint, p_source text, p_file_hashes jsonb, p_as_of date, p_rules_version text, p_status text, p_idempotency_key uuid,
  p_source_updated_at date default null, p_counts jsonb default '{}', p_supersedes bigint default null,
  out batch_id bigint, out created boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_role text := public.equitas_member_role(p_actor_user, p_tenant);
  v_existing public.import_batch;
  v_violation text;
begin
  if v_role is null then raise exception 'ACTOR_NOT_ACTIVE_MEMBER'; end if;
  if v_role not in ('importador', 'importador_sistema', 'supervisor') then raise exception 'ROLE_NOT_ALLOWED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(format('import_batch:%s', p_tenant), 0));
  select * into v_existing from public.import_batch b where b.tenant = p_tenant and b.idempotency_key = p_idempotency_key;
  if found then
    if (v_existing.source, v_existing.file_hashes, v_existing.as_of, v_existing.source_updated_at, v_existing.rules_version, v_existing.counts,
        v_existing.status, v_existing.created_by, v_existing.supersedes)
       is distinct from (p_source, p_file_hashes, p_as_of, p_source_updated_at, p_rules_version, p_counts, p_status, p_actor_user, p_supersedes) then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT';
    end if;
    batch_id := v_existing.id;
    created := false;
    return;
  end if;
  begin
    insert into public.import_batch(tenant, source, file_hashes, as_of, source_updated_at, rules_version, counts, status, created_by, created_by_role, supersedes, idempotency_key)
    values (p_tenant, p_source, p_file_hashes, p_as_of, p_source_updated_at, p_rules_version, p_counts, p_status, p_actor_user, v_role, p_supersedes, p_idempotency_key)
    returning id into batch_id;
  exception when check_violation or not_null_violation or foreign_key_violation or unique_violation then
    get stacked diagnostics v_violation = constraint_name;
    raise exception 'INVALID_IMPORT_BATCH:%', coalesce(nullif(v_violation, ''), 'not_null');
  end;
  created := true;
end $$;

-- 9. Dueno y ejecucion. El definidor no conserva CREATE sobre public ni postgres queda como miembro suyo.

grant equitas_write_definer to postgres;

grant create on schema public to equitas_write_definer;

alter function public.equitas_member_role(bigint, bigint) owner to equitas_write_definer;

alter function public.record_case_review(bigint, bigint, bigint, text, date, text, text, integer, jsonb, text, uuid, text, integer, text, text, jsonb, bigint) owner to equitas_write_definer;

alter function public.record_case_review_approval(bigint, bigint, bigint, text, uuid, text, jsonb, bigint) owner to equitas_write_definer;

alter function public.read_case_review_reason_text(bigint, bigint, bigint) owner to equitas_write_definer;

alter function public.record_import_batch(bigint, bigint, text, jsonb, date, text, text, uuid, date, jsonb, bigint) owner to equitas_write_definer;

revoke create on schema public from equitas_write_definer;

revoke all on function public.equitas_append_only() from public, anon, authenticated, service_role;

revoke all on function public.equitas_member_role(bigint, bigint) from public, anon, authenticated, service_role, postgres;

revoke all on function public.record_case_review(bigint, bigint, bigint, text, date, text, text, integer, jsonb, text, uuid, text, integer, text, text, jsonb, bigint) from public, anon, authenticated, service_role, postgres;

revoke all on function public.record_case_review_approval(bigint, bigint, bigint, text, uuid, text, jsonb, bigint) from public, anon, authenticated, service_role, postgres;

revoke all on function public.read_case_review_reason_text(bigint, bigint, bigint) from public, anon, authenticated, service_role, postgres;

revoke all on function public.record_import_batch(bigint, bigint, text, jsonb, date, text, text, uuid, date, jsonb, bigint) from public, anon, authenticated, service_role, postgres;

grant execute on function public.record_case_review(bigint, bigint, bigint, text, date, text, text, integer, jsonb, text, uuid, text, integer, text, text, jsonb, bigint) to equitas_review_server;

grant execute on function public.record_case_review_approval(bigint, bigint, bigint, text, uuid, text, jsonb, bigint) to equitas_review_server;

grant execute on function public.read_case_review_reason_text(bigint, bigint, bigint) to equitas_review_server;

grant execute on function public.record_import_batch(bigint, bigint, text, jsonb, date, text, text, uuid, date, jsonb, bigint) to equitas_import_server;

revoke equitas_write_definer from postgres;

notify pgrst, 'reload schema';
