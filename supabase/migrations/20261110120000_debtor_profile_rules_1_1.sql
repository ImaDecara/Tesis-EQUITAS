-- Reglas de decisión 1.1.0 en el perfil persistido. SOLO base local aislada (docs/tesis/entorno-aislado.md).

-- Decisión del usuario del 2026-11-10: una obligación PAGADA (debt_status.key = 'PAID') deja de contar como deuda

-- pendiente y como vencida. Mismas reglas que build_debtor_profile_payload (back/ETL/transform.py) y que

-- contracts/decision-rules.v1.1.json (obligaciones_pagadas y evaluabilidad):

-- - total_debt_amount sigue siendo el total registrado: todas las obligaciones, cualquiera sea su estado.

-- - overdue_debt_amount, overdue_debt_count, oldest_debt_days y average_debt_age_days son por calendario sobre las

--   NO pagadas (clave distinta de PAID o sin estado): current_amount > 0 y due_date < p_as_of. La clave OVERDUE ya no

--   decide la mora; las suspendidas y los demás estados se computan por importe y vencimiento, como en 1.0.0.

-- - La regla del nulo pasa del estado no observado a la obligación no evaluable (importe o vencimiento faltante,

--   importe negativo o vencimiento anterior a 1970-01-01) entre las no pagadas, igual que la severidad PARCIAL.

-- Reemplaza la función de 20261102180000 con la misma firma, atributos y permisos. No toca tablas, columnas,

-- políticas ni RLS. Se conserva la reclasificación ACTIVE/OVERDUE. Reversión: db reset --version 20261110100000

-- (solo local) o recrear la función de 20261102180000.

create or replace function public.recompute_debtor_profiles(
  p_object_ids bigint[],
  p_as_of date,
  p_contact_columns_integrated boolean default true
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_requested integer;
  v_inserted integer;
  v_updated integer;
  v_details integer;
  v_reclassified bigint;
begin
  if p_object_ids is null or p_as_of is null or p_contact_columns_integrated is null then
    raise exception 'INVALID_RECOMPUTE_INPUT';
  end if;

  -- ACTIVE y OVERDUE son las dos derivaciones de PENDIENTE, no estados de pago distintos.
  -- Una obligación conservada en un delta también envejece al corte nuevo. Resolverla antes
  -- de agregar mantiene deuda y perfil coherentes; un corte anterior puede volverla ACTIVE.
  -- No se infiere estado para UNKNOWN/nulo ni se modifican pagadas, anuladas o suspendidas.
  update public.debt x
  set status = next_status.id
  from public.debt_status previous_status, public.debt_status next_status
  where x.debtor = any(p_object_ids)
    and previous_status.id = x.status
    and previous_status.key in ('ACTIVE', 'OVERDUE')
    and x.due_date is not null
    and next_status.key = case when x.due_date < p_as_of then 'OVERDUE' else 'ACTIVE' end
    and x.status is distinct from next_status.id;

  get diagnostics v_reclassified = row_count;

  with targets as (
    select d.id from public.debtor d where d.id = any(p_object_ids)
  ),
  classified as (
    select t.id as debtor, x.id, x.status, x.current_amount, x.due_date, s.key,
      -- Pagada solo con la clave PAID; sin estado o con cualquier otra clave no lo está.
      (x.id is not null and s.key is distinct from 'PAID') as unpaid,
      (x.current_amount is not null and x.current_amount >= 0
        and x.due_date is not null and x.due_date >= date '1970-01-01') as evaluable
    from targets t
    left join public.debt x on x.debtor = t.id
    left join public.debt_status s on s.id = x.status
  ),
  debts as (
    select c.debtor,
      coalesce(sum(c.current_amount), 0) as total,
      count(c.id)::integer as debt_count,
      coalesce(sum(c.current_amount) filter (where c.unpaid and c.evaluable and c.current_amount > 0 and c.due_date < p_as_of), 0) as overdue_amount,
      (count(c.id) filter (where c.unpaid and c.evaluable and c.current_amount > 0 and c.due_date < p_as_of))::integer as overdue_count,
      (count(c.id) filter (where c.unpaid and not c.evaluable))::integer as not_evaluable,
      -- Una fila sin estado tampoco esta observada: nunca se lee como vigente.
      (count(c.id) filter (where c.id is not null and (c.status is null or c.key = 'UNKNOWN')))::integer as not_observed,
      max(p_as_of - c.due_date) filter (where c.unpaid and c.evaluable and c.current_amount > 0 and c.due_date < p_as_of) as oldest,
      round(avg((p_as_of - c.due_date)::numeric) filter (where c.unpaid and c.evaluable and c.current_amount > 0 and c.due_date < p_as_of))::integer as average
    from classified c
    group by c.debtor
  ),
  people as (
    select t.id as debtor,
      count(distinct r.person)::integer as active_people,
      -- El filtro hace falta: una fila armada con nulos del left join no es nula para count.
      (count(distinct (c.person, c.type, c.value)) filter (where c.id is not null))::integer as usable_contacts
    from targets t
    left join public.debtor_person r on r.debtor = t.id and r.active
    left join public.debtor_contact c on c.person = r.person and c.active
    group by t.id
  ),
  written as (
    insert into public.debtor_profile as p (
      debtor, total_debt_amount, overdue_debt_amount, debt_count, overdue_debt_count, debt_state_not_observed_count,
      oldest_debt_days, average_debt_age_days, active_person_count, available_contact_count,
      previous_contact_count, previous_response_count, socioeconomic_risk_level, profile_generated_at, active
    )
    select d.debtor, d.total,
      -- Contrato §4.1 y severidad PARCIAL: no pagadas no evaluables y ninguna vencida conocida no es un cero.
      case when d.not_evaluable > 0 and d.overdue_count = 0 then null else d.overdue_amount end,
      d.debt_count,
      case when d.not_evaluable > 0 and d.overdue_count = 0 then null else d.overdue_count end,
      d.not_observed, d.oldest, d.average, g.active_people,
      case when p_contact_columns_integrated then g.usable_contacts end,
      null, null, null, now(), true
    from debts d join people g using (debtor)
    on conflict (debtor) do update set
      total_debt_amount = excluded.total_debt_amount,
      overdue_debt_amount = excluded.overdue_debt_amount,
      debt_count = excluded.debt_count,
      overdue_debt_count = excluded.overdue_debt_count,
      debt_state_not_observed_count = excluded.debt_state_not_observed_count,
      oldest_debt_days = excluded.oldest_debt_days,
      average_debt_age_days = excluded.average_debt_age_days,
      active_person_count = excluded.active_person_count,
      available_contact_count = excluded.available_contact_count,
      previous_contact_count = excluded.previous_contact_count,
      previous_response_count = excluded.previous_response_count,
      socioeconomic_risk_level = excluded.socioeconomic_risk_level,
      profile_generated_at = excluded.profile_generated_at,
      active = excluded.active
    where (p.total_debt_amount, p.overdue_debt_amount, p.debt_count, p.overdue_debt_count, p.debt_state_not_observed_count,
           p.oldest_debt_days, p.average_debt_age_days, p.active_person_count, p.available_contact_count,
           p.previous_contact_count, p.previous_response_count, p.socioeconomic_risk_level, p.active)
      is distinct from
          (excluded.total_debt_amount, excluded.overdue_debt_amount, excluded.debt_count, excluded.overdue_debt_count,
           excluded.debt_state_not_observed_count, excluded.oldest_debt_days, excluded.average_debt_age_days,
           excluded.active_person_count, excluded.available_contact_count, excluded.previous_contact_count,
           excluded.previous_response_count, excluded.socioeconomic_risk_level, excluded.active)
    returning (xmax = 0) as inserted
  )
  select (select count(*) from targets),
         count(*) filter (where inserted),
         count(*) filter (where not inserted)
    into v_requested, v_inserted, v_updated
  from written;

  -- El detalle de una persona sigue a su relacion: una relacion dada de baja no queda activa en el perfil.
  update public.debtor_profile_detail det
  set active = r.active
  from public.debtor_profile p
  join public.debtor_person r on r.debtor = p.debtor
  where p.debtor = any(p_object_ids)
    and det.debtor_profile = p.id
    and det.person = r.person
    and det.active is distinct from r.active;

  get diagnostics v_details = row_count;

  return jsonb_build_object(
    'insertadas', v_inserted,
    'actualizadas', v_updated,
    'sin_cambios', v_requested - v_inserted - v_updated,
    'detalles_actualizados', v_details,
    'deudas_reclasificadas', v_reclassified
  );
end;
$$;

-- create or replace conserva dueño y permisos; se repiten para que esta migración los declare sola.
revoke all on function public.recompute_debtor_profiles(bigint[], date, boolean) from public, anon, authenticated;

grant execute on function public.recompute_debtor_profiles(bigint[], date, boolean) to service_role;

grant execute on function public.recompute_debtor_profiles(bigint[], date, boolean) to equitas_import_definer;
