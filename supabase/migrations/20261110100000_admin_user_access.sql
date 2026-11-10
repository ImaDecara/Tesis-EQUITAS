-- Noche 7. SOLO base local aislada (docs/tesis/entorno-aislado.md); nunca en el original ni en testing.

-- Acceso segun main: el catalogo de roles es ADMIN y USER (produccion: 1 ADMIN, 2 USER). Leer la cartera no depende del rol.
-- Las funciones que main no tiene (decisiones, aprobacion, motivo libre, reporte de accesos, carga) necesitan permiso.
-- Ese permiso vive en UN lugar de esta capa: public.equitas_role_allows. Cambiar una fila de la tabla es cambiar esa funcion.

-- Sin filas: no inserta roles ni membresias (los siembra la inicializacion local). No toca las 23 tablas existentes.
-- Solo reemplaza la comparacion de rol de cinco funciones, la politica de lectura y la lista de roles de access_audit.
-- Los nombres historicos (consulta, operador, supervisor, importador) dejan de otorgar permisos; sus registros se conservan.

-- Reversion: db reset --version 20261107151854 (solo local).

do $$ begin
  if to_regprocedure('public.record_case_review(bigint, bigint, bigint, bigint, text, date, text, text, integer, jsonb, text, uuid, text, integer, text, text, jsonb, bigint)') is null
     or to_regprocedure('public.record_case_review_approval(bigint, bigint, bigint, text, uuid, bigint, text, jsonb, bigint)') is null
     or to_regprocedure('public.record_access_audit(bigint, bigint, text, text, uuid)') is null
     or to_regprocedure('equitas_import_private.authorize(bigint, bigint)') is null then
    raise exception 'Requiere las migraciones hasta 20261107151854';
  end if;
end $$;

-- Como en ALIGN-018: postgres es miembro de los definidores solo durante esta migracion.

grant equitas_write_definer to postgres;

grant equitas_import_definer to postgres;

grant create on schema public to equitas_write_definer;

-- 1. Tabla de permisos de las funciones nuevas (encargo de la noche 7, seccion 4.2). Nombres exactos.
-- importador_sistema es la identidad de maquina del cargador por terminal: solo carga y no entra por la web.

create function public.equitas_role_allows(p_role text, p_capability text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(case p_capability
    when 'DECISION_RECORD' then p_role = 'ADMIN'
    when 'DECISION_APPROVE' then p_role = 'ADMIN'
    when 'REASON_TEXT_READ' then p_role = 'ADMIN'
    when 'AUDIT_READ' then p_role = 'ADMIN'
    when 'IMPORT_WRITE' then p_role in ('ADMIN', 'importador_sistema')
    else false
  end, false)
$$;

alter function public.equitas_role_allows(text, text) owner to equitas_write_definer;

-- 2. Decision humana. Unico cambio respecto de 20261102120000: la comparacion de rol.

create or replace function public.record_case_review(
  p_reviewer_user bigint, p_tenant bigint, p_debtor bigint, p_cutoff_batch bigint, p_rules_version text, p_as_of date, p_inputs_hash text,
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
end $$;

-- 3. Aprobacion por otra persona. Unico cambio: la comparacion de rol. La comprobacion por identidad
-- (APPROVER_IS_PROPONENT, sobre toda la cadena de reemplazos) queda intacta: es lo que separa a quien propone de quien aprueba.

create or replace function public.record_case_review_approval(
  p_approver_user bigint, p_tenant bigint, p_case_review bigint, p_decision text, p_idempotency_key uuid, p_cutoff_batch bigint,
  p_reason_code text default null, p_checklist jsonb default '{}', p_supersedes bigint default null,
  out approval_id bigint, out created boolean)
language plpgsql security definer set search_path = '' as $$
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
end $$;

-- 4. Motivo libre: solo quien registra o aprueba decisiones. USER no lo ve (minimizacion, como antes consulta).

create or replace function public.read_case_review_reason_text(p_actor_user bigint, p_tenant bigint, p_case_review bigint) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := public.equitas_member_role(p_actor_user, p_tenant);
  v_text text;
begin
  if v_role is null then raise exception 'ACTOR_NOT_ACTIVE_MEMBER'; end if;
  if not public.equitas_role_allows(v_role, 'REASON_TEXT_READ') then raise exception 'ROLE_NOT_ALLOWED'; end if;
  select r.reason_text into v_text from public.case_review r where r.id = p_case_review and r.tenant = p_tenant;
  if not found then raise exception 'REVIEW_NOT_IN_TENANT'; end if;
  return v_text;
end $$;

-- 5. Registro de lotes (evento legacy). Unico cambio: la comparacion de rol.

create or replace function public.record_import_batch(
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
  if not public.equitas_role_allows(v_role, 'IMPORT_WRITE') then raise exception 'ROLE_NOT_ALLOWED'; end if;
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
  if p_supersedes is not null and not exists(select 1 from public.import_batch b where b.id = p_supersedes and b.tenant = p_tenant) then
    raise exception 'SUPERSEDES_NOT_FOUND';
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

-- 6. Publicacion atomica (ALIGN-032): la misma tabla de permisos. Corre como equitas_import_definer dentro de stage/publish/settle.

create or replace function equitas_import_private.authorize(p_actor bigint, p_tenant bigint) returns text
language plpgsql set search_path = '' as $$
declare r text := public.equitas_member_role(p_actor,p_tenant);
begin
  if r is null then raise exception 'ACTOR_NOT_ACTIVE_MEMBER'; end if;
  if not public.equitas_role_allows(r, 'IMPORT_WRITE') then raise exception 'ROLE_NOT_ALLOWED'; end if;
  return r;
end $$;

-- 7. Registro de accesos. Los roles historicos siguen siendo validos como DATO de filas ya escritas; ADMIN y USER son los vigentes.
-- La restriccion es de tabla y los triggers append-only son de fila y de truncado: este DDL no los dispara ni reescribe filas.

alter table public."access_audit" drop constraint "access_audit_actor_role_valid";

alter table public."access_audit" add constraint "access_audit_actor_role_valid"
  check (actor_role in ('ADMIN', 'USER', 'consulta', 'operador', 'supervisor', 'importador', 'importador_sistema', 'tp_operator'));

drop policy "supervisor_read_access_audit" on public."access_audit";

create policy "admin_read_access_audit" on public."access_audit" for select to authenticated using (
  exists (
    select 1
    from public.tenant_user tu
    join public."user" u on u.id = tu."user"
    join public.tenant t on t.id = tu.tenant
    join public.role r on r.id = tu.role
    where tu.tenant = access_audit.tenant and tu.status and u.status = 'ACTIVE' and t.status = 'ACTIVE'
      and u.auth_user = (select auth.uid()) and public.equitas_role_allows(r.name, 'AUDIT_READ')
  )
);

-- 8. Ejecucion de la tabla de permisos: la politica se evalua como authenticated y authorize como equitas_import_definer.
-- La funcion solo devuelve la tabla de arriba (no lee datos): no es un secreto, pero anon y service_role no la necesitan.

revoke all on function public.equitas_role_allows(text, text) from public, anon, authenticated, service_role, postgres;

grant execute on function public.equitas_role_allows(text, text) to authenticated, equitas_import_definer;

revoke create on schema public from equitas_write_definer;

revoke equitas_import_definer from postgres;

revoke equitas_write_definer from postgres;

notify pgrst, 'reload schema';
