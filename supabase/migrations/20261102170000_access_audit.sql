-- ALIGN-069. SOLO base local aislada (docs/tesis/entorno-aislado.md); nunca en el original ni en testing.

-- Auditoria de acciones de la aplicacion: append-only, lectura solo de supervisor de ese municipio, escritura solo por funcion de servidor.

-- Sin filas. No crea, modifica ni elimina politicas, RLS ni grants de las tablas existentes.

-- Limite declarado: una lectura directa por la Data API (PostgREST) no pasa por aca y no queda registrada.

-- Reversion: db reset --version 20261102120000 (solo local). Inversa: SUPABASE_TESTING_CALIDAD.md.

do $$ begin
  if to_regprocedure('public.equitas_member_role(bigint, bigint)') is null or to_regprocedure('public.equitas_append_only()') is null then
    raise exception 'Requiere 20261030100000_case_review';
  end if;
end $$;

-- Sin claves foraneas a proposito: el rastro debe sobrevivir a la baja de un objeto, una persona usuaria o un municipio.
-- La funcion verifica actor y objeto al escribir. Solo identificadores internos y codigos: `target` no admite texto libre.

create table public."access_audit" (
  "id" bigint generated always as identity primary key,
  "tenant" bigint not null,
  "actor" bigint not null,
  "actor_role" text not null,
  "action" text not null,
  "target" text not null,
  "created_at" timestamptz not null default now(),
  "idempotency_key" uuid not null,
  constraint "access_audit_idempotency_key" unique (tenant, idempotency_key),
  constraint "access_audit_actor_role_valid" check (actor_role in ('consulta', 'operador', 'supervisor', 'importador', 'importador_sistema', 'tp_operator')),
  constraint "access_audit_action_valid" check (action in ('CASE_OPEN', 'REPORT_EXPORT', 'IMPORT_CONFIRM', 'ANALYTICS_VIEW', 'CHANNEL_LINK')),
  constraint "access_audit_target_format" check (
    case when action in ('CASE_OPEN', 'IMPORT_CONFIRM', 'CHANNEL_LINK') then target ~ '^[1-9][0-9]{0,17}$'
    else target ~ '^[a-z][a-z0-9-]{0,63}$' end
  )
);

comment on table public."access_audit" is 'ALIGN-069. Quien hizo que accion de la aplicacion, sin valores personales. Retencion declarada: 24 meses; la purga no esta automatizada (SUPABASE_TESTING_CALIDAD.md). No registra lecturas directas por la Data API.';

comment on column public."access_audit"."target" is 'Identificador interno (CASE_OPEN, CHANNEL_LINK: debtor.id; IMPORT_CONFIRM: import_batch.id) o codigo (REPORT_EXPORT, ANALYTICS_VIEW). Nunca un valor personal ni texto libre.';

-- El reporte recorre por municipio e id; la purga declarada y las consultas de operacion, por fecha.

create index "access_audit_tenant_id_idx" on public."access_audit"("tenant", "id");

create index "access_audit_tenant_created_idx" on public."access_audit"("tenant", "created_at");

-- Append-only tambien para el dueno de la tabla, con la misma funcion de ALIGN-018.

create trigger "access_audit_append_only" before update or delete on public."access_audit" for each row execute function public.equitas_append_only();

create trigger "access_audit_no_truncate" before truncate on public."access_audit" for each statement execute function public.equitas_append_only();

-- Privilegios. Los default privileges locales dan de mas: se quita todo y se otorga lo justo. anon y service_role no leen.

alter table public."access_audit" enable row level security;

revoke all on public."access_audit" from public, anon, authenticated, service_role;

revoke all on sequence public."access_audit_id_seq" from public, anon, authenticated, service_role;

grant select, insert on public."access_audit" to equitas_write_definer;

grant select on public."access_audit" to authenticated;

-- Filtra por auth.uid() y no por `tenant in (select id from public.tenant)`: sigue valiendo con politicas abiertas en las tablas de identidad (ALIGN-045).

create policy "supervisor_read_access_audit" on public."access_audit" for select to authenticated using (
  exists (
    select 1
    from public.tenant_user tu
    join public."user" u on u.id = tu."user"
    join public.tenant t on t.id = tu.tenant
    join public.role r on r.id = tu.role
    where tu.tenant = access_audit.tenant and tu.status and u.status = 'ACTIVE' and t.status = 'ACTIVE'
      and u.auth_user = (select auth.uid()) and r.name = 'supervisor'
  )
);

-- Funcion comun de escritura. search_path vacio y nombres calificados. El actor lo resuelve el servidor desde la sesion (DAL): nunca viene del navegador.
-- El rol sale de la membresia, no del llamador. Misma clave y mismo contenido: devuelve la fila, sin duplicar; otro contenido: IDEMPOTENCY_KEY_CONFLICT.
-- Rechazos: mensaje estable sin valores, como en ALIGN-018.

create function public.record_access_audit(
  p_actor_user bigint, p_tenant bigint, p_action text, p_target text, p_idempotency_key uuid,
  out audit_id bigint, out created boolean)
language plpgsql security definer set search_path = '' as $$
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
end $$;

-- Dueno y ejecucion, con el mismo cierre de ALIGN-018. Web (equitas_review_server) e importacion (equitas_import_server, ALIGN-057) usan la misma funcion.

grant equitas_write_definer to postgres;

grant create on schema public to equitas_write_definer;

alter function public.record_access_audit(bigint, bigint, text, text, uuid) owner to equitas_write_definer;

revoke create on schema public from equitas_write_definer;

revoke all on function public.record_access_audit(bigint, bigint, text, text, uuid) from public, anon, authenticated, service_role, postgres;

grant execute on function public.record_access_audit(bigint, bigint, text, text, uuid) to equitas_review_server, equitas_import_server;

revoke equitas_write_definer from postgres;

notify pgrst, 'reload schema';
