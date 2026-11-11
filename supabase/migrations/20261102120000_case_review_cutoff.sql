-- ALIGN-020, ciclo 1. SOLO base local aislada (docs/tesis/entorno-aislado.md); nunca en el original ni en testing.

-- La decision y la aprobacion quedan atadas al corte con que se calcularon, y eso se verifica en la misma transaccion que la insercion.

-- Coordinacion: el mismo advisory lock que toma record_import_batch por municipio. Las revisiones lo toman compartido; la importacion, exclusivo.

-- Toda importacion que pase por record_import_batch invalida una revision en curso. Una escritura de cartera que no pase por esa funcion no se detecta.

-- Sin filas. No toca politicas, RLS ni grants de tabla. Solo reemplaza dos funciones de ALIGN-018 y agrega dos auxiliares sin EXECUTE para clientes.

-- Reversion: db reset --version 20261030100000 (solo local).

do $$ begin
  if to_regprocedure('public.record_case_review(bigint, bigint, bigint, text, date, text, text, integer, jsonb, text, uuid, text, integer, text, text, jsonb, bigint)') is null
     or to_regprocedure('public.record_case_review_approval(bigint, bigint, bigint, text, uuid, text, jsonb, bigint)') is null then
    raise exception 'Requiere 20261030100000_case_review';
  end if;
end $$;

-- Como en ALIGN-018: el dueno de las funciones es el definidor, y postgres lo es solo durante esta migracion.

grant equitas_write_definer to postgres;

grant create on schema public to equitas_write_definer;

-- La firma cambia. Se borran las anteriores: una sobrecarga sin el parametro seguiria siendo un camino sin verificar.

drop function public.record_case_review(bigint, bigint, bigint, text, date, text, text, integer, jsonb, text, uuid, text, integer, text, text, jsonb, bigint);

drop function public.record_case_review_approval(bigint, bigint, bigint, text, uuid, text, jsonb, bigint);

-- Corte vigente del municipio: el evento mas nuevo que ninguno reemplaza y que afecta la cartera, si es PUBLICADO.
-- VALIDADO o CONFIRMADO pueden estar escribiendo y FALLIDO tras uno de ellos pudo dejar escrituras parciales: no hay corte.
-- RECIBIDO, DESCARTADO, REQUIERE_NUEVO_PREVIEW y un FALLIDO sin antecedente no tocaron la cartera: no cuentan.
-- Misma regla que selectCurrentCutoff (front/lib/server/case-review-snapshot.ts), que la usa para calcular antes de escribir. Esta es la autoridad.

create function public.equitas_current_cutoff(p_tenant bigint) returns bigint
language sql stable set search_path = '' as $$
  select case when e.status = 'PUBLICADO' then e.id end
  from public.import_batch e
  where e.tenant = p_tenant
    and not exists(select 1 from public.import_batch s where s.tenant = e.tenant and s.supersedes = e.id)
    and (e.status in ('PUBLICADO', 'VALIDADO', 'CONFIRMADO') or (e.status = 'FALLIDO' and e.supersedes is not null))
  order by e.id desc
  limit 1
$$;

-- Compartido: las revisiones no se frenan entre si. Conflictua con el exclusivo de record_import_batch y se retiene hasta el fin de la transaccion:
-- una vez verificado, ningun evento de lote puede confirmarse antes que esta insercion.
-- El bloqueo se toma antes de leer: cada sentencia de esta funcion ve lo que la importacion ya confirmo.

create function public.equitas_verify_cutoff(p_tenant bigint, p_cutoff_batch bigint, p_as_of date) returns void
language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock_shared(hashtextextended(format('import_batch:%s', p_tenant), 0));
  if p_cutoff_batch is null
     or p_cutoff_batch is distinct from public.equitas_current_cutoff(p_tenant)
     or not exists(select 1 from public.import_batch b where b.id = p_cutoff_batch and b.tenant = p_tenant and b.as_of = p_as_of) then
    raise exception 'CUTOFF_CHANGED';
  end if;
end $$;

-- p_cutoff_batch va sin valor por defecto: no se puede omitir. La verificacion va despues de la respuesta idempotente:
-- reenviar lo ya guardado no escribe nada, y responder con esa fila sigue siendo cierto aunque el corte haya cambiado despues.
-- Orden de bloqueos en ambas funciones: primero el objeto, despues los lotes. record_import_batch solo toma el de lotes: no hay ciclo.

create function public.record_case_review(
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

-- APRUEBA verifica el corte y que la propuesta sea de ese corte. OBJETA frena la propuesta y no confirma nada: no lo exige, y puede cerrarla aunque
-- haya una carga en curso. El parametro sigue siendo obligatorio, sin valor por defecto: una objecion declara null a proposito.

create function public.record_case_review_approval(
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
  if v_role <> 'supervisor' then raise exception 'ROLE_NOT_ALLOWED'; end if;
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

-- Dueno y ejecucion, con el mismo cierre de ALIGN-018.

alter function public.equitas_current_cutoff(bigint) owner to equitas_write_definer;

alter function public.equitas_verify_cutoff(bigint, bigint, date) owner to equitas_write_definer;

alter function public.record_case_review(bigint, bigint, bigint, bigint, text, date, text, text, integer, jsonb, text, uuid, text, integer, text, text, jsonb, bigint) owner to equitas_write_definer;

alter function public.record_case_review_approval(bigint, bigint, bigint, text, uuid, bigint, text, jsonb, bigint) owner to equitas_write_definer;

revoke create on schema public from equitas_write_definer;

revoke all on function public.equitas_current_cutoff(bigint) from public, anon, authenticated, service_role, postgres;

revoke all on function public.equitas_verify_cutoff(bigint, bigint, date) from public, anon, authenticated, service_role, postgres;

revoke all on function public.record_case_review(bigint, bigint, bigint, bigint, text, date, text, text, integer, jsonb, text, uuid, text, integer, text, text, jsonb, bigint) from public, anon, authenticated, service_role, postgres;

revoke all on function public.record_case_review_approval(bigint, bigint, bigint, text, uuid, bigint, text, jsonb, bigint) from public, anon, authenticated, service_role, postgres;

grant execute on function public.record_case_review(bigint, bigint, bigint, bigint, text, date, text, text, integer, jsonb, text, uuid, text, integer, text, text, jsonb, bigint) to equitas_review_server;

grant execute on function public.record_case_review_approval(bigint, bigint, bigint, text, uuid, bigint, text, jsonb, bigint) to equitas_review_server;

revoke equitas_write_definer from postgres;

notify pgrst, 'reload schema';
