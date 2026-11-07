-- ALIGN-054 R054-05 cycle2. Old preview classifications must be prepared again.
-- No portfolio data or032 migration changes; the existing public RPC strips object_key.
grant equitas_import_definer to postgres;
update public.import_preview set invalidated=true where not invalidated;

create or replace function equitas_import_private.preview_absent_effects(p_batch bigint,p_effects jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
begin
  -- Mixed deployments must fail closed, never attribute a contact to every holder.
  -- This private locator is [object type, object external id, person external id].
  if exists(select 1 from jsonb_array_elements(p_effects) x
    where x->>'archivo'='cabecera' and not coalesce((x->>'excluded')::boolean,false)
      and not case when jsonb_typeof(x->'object_key')='array'
        then jsonb_array_length(x->'object_key')=3 else false end) then
    raise exception 'PREVIEW_INPUT_INVALID';
  end if;
  return (
    with job as (select * from public.import_publication where batch_id=p_batch),
    relation_fields as (
      select distinct jsonb_build_array(t.key,d.external_id) object_key
      from job j, lateral jsonb_array_elements_text(j.document->'absent'->'relations') a(id)
      join public.debtor_person r on r.id=a.id::bigint
      join public.debtor d on d.id=r.debtor
      join public.debtor_type t on t.id=d.type
      where d.tenant=j.tenant
    ), contact_fields as (
      select distinct to_jsonb(p.external_id) person_key
      from job j, lateral jsonb_array_elements_text(j.document->'absent'->'contacts') a(id)
      join public.debtor_contact c on c.id=a.id::bigint
      join public.person p on p.id=c.person
      where exists(select 1 from public.debtor_person r join public.debtor d on d.id=r.debtor
        where r.person=p.id and r.active and d.tenant=j.tenant)
    )
    select coalesce(jsonb_agg(case when f.field_list<>'[]'::jsonb and x->>'archivo'='cabecera'
      and not coalesce((x->>'excluded')::boolean,false) then x || jsonb_build_object(
        'kind',case when x->>'kind'='sin_cambios' then 'actualizacion' else x->>'kind' end,
        'codes',case when x->>'kind'='sin_cambios' then '["BASE_ACTUALIZACION","BAJAS_PREVISTAS"]'::jsonb
          else (x->'codes') || '["BAJAS_PREVISTAS"]'::jsonb end,
        'changed_fields',(select jsonb_agg(distinct value order by value)
          from jsonb_array_elements_text((x->'changed_fields') || f.field_list)))
      else x end order by n),'[]'::jsonb)
    from jsonb_array_elements(p_effects) with ordinality a(x,n)
    left join relation_fields r on r.object_key=jsonb_build_array(x->'object_key'->0,x->'object_key'->1)
    left join contact_fields c on c.person_key=x->'object_key'->2
    cross join lateral(select
      (case when r.object_key is not null then '["debtor_person.active"]'::jsonb else '[]'::jsonb end) ||
      (case when c.person_key is not null then '["debtor_contact.active"]'::jsonb else '[]'::jsonb end) field_list) f
  );
end $$;

alter function equitas_import_private.preview_absent_effects(bigint,jsonb) owner to equitas_import_definer;
revoke all on function equitas_import_private.preview_absent_effects(bigint,jsonb)
  from public,anon,authenticated,service_role,equitas_review_server,equitas_import_server,postgres;
revoke equitas_import_definer from postgres;
notify pgrst,'reload schema';

