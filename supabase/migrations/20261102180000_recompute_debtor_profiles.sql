-- ALIGN-031. SOLO base local aislada (docs/tesis/entorno-aislado.md); nunca en el original ni en testing.

-- Perfil del objeto desde lo persistido: mismas reglas que build_debtor_profile_payload (back/ETL/transform.py) y contrato de dominio §4.1 y §14.

-- Solo escribe los objetos pedidos, y solo si algun valor cambio: profile_generated_at es el momento del calculo que produjo esos valores (L04).

-- Devuelve un unico objeto JSON y no filas: la Data API corta los conjuntos en su maximo de filas sin avisar.

-- Sin filas. No toca politicas, RLS ni grants de tabla. Reversion: db reset --version 20261102120000 (solo local).

create function public.recompute_debtor_profiles(
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
begin
  if p_object_ids is null or p_as_of is null or p_contact_columns_integrated is null then
    raise exception 'INVALID_RECOMPUTE_INPUT';
  end if;

  with targets as (
    select d.id from public.debtor d where d.id = any(p_object_ids)
  ),
  debts as (
    select t.id as debtor,
      coalesce(sum(x.current_amount), 0) as total,
      count(x.id)::integer as debt_count,
      coalesce(sum(x.current_amount) filter (where s.key = 'OVERDUE'), 0) as overdue_amount,
      (count(x.id) filter (where s.key = 'OVERDUE'))::integer as overdue_count,
      -- Una fila sin estado tampoco esta observada: nunca se lee como vigente.
      (count(x.id) filter (where x.id is not null and (x.status is null or s.key = 'UNKNOWN')))::integer as not_observed,
      max(p_as_of - x.due_date) filter (where s.key = 'OVERDUE') as oldest,
      round(avg((p_as_of - x.due_date)::numeric) filter (where s.key = 'OVERDUE'))::integer as average
    from targets t
    left join public.debt x on x.debtor = t.id
    left join public.debt_status s on s.id = x.status
    group by t.id
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
      -- Contrato §4.1: estados faltantes y ninguna vencida observada no es un cero.
      case when d.not_observed > 0 and d.overdue_count = 0 then null else d.overdue_amount end,
      d.debt_count,
      case when d.not_observed > 0 and d.overdue_count = 0 then null else d.overdue_count end,
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
    'detalles_actualizados', v_details
  );
end;
$$;

revoke all on function public.recompute_debtor_profiles(bigint[], date, boolean) from public, anon, authenticated;

grant execute on function public.recompute_debtor_profiles(bigint[], date, boolean) to service_role;
