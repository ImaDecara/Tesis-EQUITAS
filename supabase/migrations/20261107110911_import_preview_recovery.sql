-- ALIGN-054 review corrections.032 stays byte-identical; upgrade invalidates only
-- old previews, never portfolio rows. Statement epochs replace repeated full digests.
grant equitas_import_definer to postgres;
grant create on schema public to equitas_import_definer;
alter table public.import_publication add column payload_epoch bigint not null default 0;
alter table public.import_preview add column payload_epoch bigint;
alter table public.import_preview add column publication_payload_hash text;
update public.import_preview set invalidated=true where publication_batch is not null;

create function equitas_import_private.preview_payload_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.import_publication set payload_epoch=payload_epoch+1
    where batch_id in (select distinct batch_id from changed_rows);
  return null;
end $$;
create function equitas_import_private.preview_payload_updated() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.import_publication set payload_epoch=payload_epoch+1
    where batch_id in (select batch_id from before_rows union select batch_id from after_rows);
  return null;
end $$;
create function equitas_import_private.preview_payload_truncated() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.import_publication set payload_epoch=payload_epoch+1;
  return null;
end $$;
create trigger preview_payload_insert after insert on public.import_row_staging
referencing new table as changed_rows for each statement
execute function equitas_import_private.preview_payload_changed();
create trigger preview_payload_delete after delete on public.import_row_staging
referencing old table as changed_rows for each statement
execute function equitas_import_private.preview_payload_changed();
create trigger preview_payload_update after update on public.import_row_staging
referencing old table as before_rows new table as after_rows for each statement
execute function equitas_import_private.preview_payload_updated();
create trigger preview_payload_truncate after truncate on public.import_row_staging
for each statement execute function equitas_import_private.preview_payload_truncated();

-- Derive deactivation effects from032's own frozen absent set. No identifiers or
-- values from contacts/persons are returned; only input object keys join the effects.
create function equitas_import_private.preview_absent_effects(p_batch bigint,p_effects jsonb) returns jsonb
language sql stable set search_path='' as $$
  with job as (select * from public.import_publication where batch_id=p_batch),
  affected as (
    select jsonb_build_array(t.key,d.external_id) object_key,'debtor_person.active' field
    from job j, lateral jsonb_array_elements_text(j.document->'absent'->'relations') a(id)
    join public.debtor_person r on r.id=a.id::bigint
    join public.debtor d on d.id=r.debtor
    join public.debtor_type t on t.id=d.type
    where d.tenant=j.tenant
    union
    select jsonb_build_array(t.key,d.external_id),'debtor_contact.active'
    from job j, lateral jsonb_array_elements_text(j.document->'absent'->'contacts') a(id)
    join public.debtor_contact c on c.id=a.id::bigint
    join public.debtor_person r on r.person=c.person and r.active
    join public.debtor d on d.id=r.debtor
    join public.debtor_type t on t.id=d.type
    where d.tenant=j.tenant
  ), fields as (
    select object_key,jsonb_agg(distinct field order by field) field_list from affected group by object_key
  )
  select coalesce(jsonb_agg(case when f.object_key is not null and x->>'archivo'='cabecera'
    and not coalesce((x->>'excluded')::boolean,false) then x || jsonb_build_object(
      'kind',case when x->>'kind'='sin_cambios' then 'actualizacion' else x->>'kind' end,
      'codes',case when x->>'kind'='sin_cambios' then '["BASE_ACTUALIZACION","BAJAS_PREVISTAS"]'::jsonb
        else (x->'codes') || '["BAJAS_PREVISTAS"]'::jsonb end,
      'changed_fields',(select jsonb_agg(distinct value order by value)
        from jsonb_array_elements_text((x->'changed_fields') || f.field_list)))
    else x end order by n),'[]'::jsonb)
  from jsonb_array_elements(p_effects) with ordinality a(x,n)
  left join fields f on f.object_key=x->'object_key'
$$;

-- Metadata is a compare-and-swap reference, never a claim that old pages remain valid.
-- It remains readable after invalidation/TTL; replacement still requires this revision.
create function public.read_import_preview_reference(p_actor_user bigint,p_tenant bigint,p_root bigint,p_head bigint)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare item public.import_preview; publication_status text;
begin
  perform equitas_import_private.preview_source(p_actor_user,p_tenant,p_root,p_head);
  select * into item from public.import_preview where root_id=p_root and tenant=p_tenant;
  select status into publication_status from public.import_publication where batch_id=item.publication_batch;
  return jsonb_build_object('root_id',p_root,'event_id',p_head,'status','PREVIEW_REFERENCIA',
    'revision',item.revision,'source_head',item.source_head,'expires_at',item.expires_at,
    'publication_status',publication_status);
end $$;

create or replace function public.prepare_import_preview(p_actor_user bigint,p_tenant bigint,p_root bigint,p_head bigint,
  p_document jsonb,p_rows jsonb,p_effects jsonb,p_summary jsonb,p_token text,p_expires timestamptz,
  p_publishable boolean,p_expected_preview text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare source public.import_batch; people bigint[]; person_key bigint; old public.import_preview;
  receipt jsonb; revision_value text; expires timestamptz; mapping_value text; publication_id bigint;
  existing public.import_publication; epoch_value bigint; hash_value text; counts_value jsonb;
begin
  source := equitas_import_private.preview_source(p_actor_user,p_tenant,p_root,p_head);
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>200000
    or jsonb_typeof(p_effects) is distinct from 'array' or jsonb_array_length(p_effects)>600000
    or jsonb_typeof(p_summary) is distinct from 'object' or p_publishable is null then raise exception 'PREVIEW_INPUT_INVALID'; end if;
  select coalesce(array_agg(distinct (r->'payload'->'person'->>'external_id')::bigint),'{}') into people
    from jsonb_array_elements(p_rows) r where r->>'kind'='person';
  -- Same order as032; shared people are allowed only in a nonpublishable diagnosis.
  perform pg_advisory_xact_lock(hashtextextended('import_locations',0));
  for person_key in select distinct unnest(people) order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended(format('import_person:%s',person_key),0));
  end loop;
  perform pg_advisory_xact_lock(hashtextextended(format('import_batch:%s',p_tenant),0));
  source := equitas_import_private.preview_source(p_actor_user,p_tenant,p_root,p_head);
  if p_token is distinct from equitas_import_private.preview_token(p_tenant,people) then raise exception 'PREVIEW_INVALIDATED'; end if;
  if p_document->'identity'->'tenant' is distinct from to_jsonb(p_tenant)
    or p_document->'identity'->'parameters'->>'as_of' is distinct from source.as_of::text
    or p_document->'identity'->>'mapping_hash' is distinct from equitas_import_private.digest(p_document->'mapping')
    or p_document->'identity'->'files' is distinct from ((p_document->'file_hashes')-'mapeo'-'contrato') then
    raise exception 'PREVIEW_INPUT_INVALID';
  end if;
  -- UploadStore represents a workbook once; 030 represents its two logical tables.
  if (source.file_hashes ? 'libro' and (p_document->'identity'->'files' is distinct from jsonb_build_object(
       'cabecera',source.file_hashes->>'libro','detalle',source.file_hashes->>'libro')))
    or (not source.file_hashes ? 'libro' and p_document->'identity'->'files' is distinct from source.file_hashes) then
    raise exception 'PREVIEW_INVALIDATED';
  end if;
  expires := least(p_expires,clock_timestamp()+interval '24 hours');
  if expires is null or expires<=clock_timestamp() then raise exception 'PREVIEW_EXPIRED'; end if;
  mapping_value := p_document->'identity'->>'mapping_hash';
  select * into old from public.import_preview where root_id=p_root for update;
  if found and p_expected_preview is distinct from old.revision then raise exception 'PREVIEW_REVISION_CONFLICT'; end if;
  if not found and p_expected_preview is not null then raise exception 'PREVIEW_REVISION_CONFLICT'; end if;
  -- Withdraw a prior active binding, including a different identity from this root.
  -- Terminal and expired jobs are explicitly revalidated below using the current
  -- server-resolved revision; no client can nominate another publication or tenant.
  if old.publication_batch is not null and exists(select 1 from public.import_publication
    where batch_id=old.publication_batch and status='VALIDADO') then
    perform equitas_import_private.event(old.publication_batch,'REQUIERE_NUEVO_PREVIEW','{}');
  end if;
  if p_publishable then
    if exists(select 1 from jsonb_array_elements(p_effects) x where x->>'kind'='conflicto' and not (x->>'excluded')::boolean) then
      raise exception 'PREVIEW_INPUT_INVALID';
    end if;
    begin
      select * into existing from public.import_publication where tenant=p_tenant
        and idempotency_key=equitas_import_private.digest(p_document->'identity') for update;
      if existing.status='VALIDADO' then
        perform equitas_import_private.event(existing.batch_id,'REQUIERE_NUEVO_PREVIEW','{}');
      elsif existing.status='CONFIRMADO' then
        raise exception 'PREVIEW_SOURCE_NOT_READY';
      end if;
      receipt := public.stage_import_batch(p_actor_user,p_tenant,p_document,p_rows,existing.revision);
      if receipt->>'status'='PUBLICADO' then
        return jsonb_build_object('root_id',p_root,'revision',old.revision,
          'publication',receipt,'status','PREVIEW_YA_PUBLICADO');
      end if;
      if receipt->>'status'='FALLIDO' and receipt->>'error'='PARTIAL_LOAD_REJECTED' then
        -- Preserve032's policy calculation but roll back this attempted stage. The
        -- diagnostic remains readable; no terminal032 identity is manufactured.
        raise sqlstate 'P0054';
      end if;
      if receipt->>'status' <> 'VALIDADO' then raise exception 'PREVIEW_NOT_PUBLISHABLE'; end if;
    exception when sqlstate 'P0054' then
      p_summary := p_summary || jsonb_build_object('publishable',false,'blocked_reason','PARTIAL_LOAD_REJECTED',
        'absent_counts',receipt->'counts'->'ausentes');
      receipt := null;
    end;
    publication_id := (receipt->>'batch_id')::bigint;
    if publication_id is not null then
      p_summary := p_summary || jsonb_build_object('absent_counts',coalesce(receipt->'counts'->'ausentes','{}'::jsonb));
      if p_document->'identity'->'parameters'->>'absent_policy'='dar-de-baja' then
        p_effects := equitas_import_private.preview_absent_effects(publication_id,p_effects);
        select jsonb_object_agg(kind,n) into counts_value from (
          select k.kind,count(x) n from unnest(array['alta','actualizacion','sin_cambios','conflicto']) k(kind)
          left join jsonb_array_elements(p_effects) x on x->>'kind'=k.kind group by k.kind) c;
        p_summary := p_summary || jsonb_build_object('counts',counts_value,
          'deactivations',coalesce(receipt->'counts'->'ausentes','{}'::jsonb)-array['objetos','obligaciones']);
      end if;
    end if;
    -- Stage may return an earlier same-identity revision. Never bless its stale versions.
    if publication_id is not null and not exists(select 1 from public.import_publication where batch_id=publication_id
      and versions=equitas_import_private.versions(p_tenant,people) and expires_at>clock_timestamp()) then
      raise exception 'PREVIEW_INVALIDATED';
    end if;
    update public.import_publication set expires_at=least(expires_at,expires) where batch_id=publication_id;
    select payload_epoch,payload_hash into epoch_value,hash_value from public.import_publication where batch_id=publication_id;
    -- A fresh same-identity preview supersedes previous roots. Keep their links as
    -- provenance, but only the newest valid binding may authorize confirmation.
    update public.import_preview set invalidated=true where publication_batch=publication_id and root_id<>p_root;
  end if;
  revision_value := equitas_import_private.digest(jsonb_build_object('root',p_root,'head',p_head,
    'identity',p_document->'identity','versions',p_token,'effects',p_effects,'nonce',gen_random_uuid()));
  insert into public.import_preview(root_id,tenant,source_head,revision,mapping_hash,snapshot_token,people,
    publication_batch,publication_revision,summary,expires_at,payload_epoch,publication_payload_hash)
  values(p_root,p_tenant,p_head,revision_value,mapping_value,p_token,people,publication_id,receipt->>'revision',p_summary,expires,epoch_value,hash_value)
  on conflict(root_id) do update set preview_id=gen_random_uuid(),source_head=p_head,revision=revision_value,
    mapping_hash=mapping_value,snapshot_token=p_token,people=excluded.people,publication_batch=publication_id,
    publication_revision=receipt->>'revision',summary=p_summary,expires_at=expires,created_at=now(),invalidated=false,
    payload_epoch=epoch_value,publication_payload_hash=hash_value;
  delete from public.import_preview_row_staging where root_id=p_root;
  insert into public.import_preview_row_staging(root_id,ordinal,effect,result)
    select p_root,n,x->>'kind',x-'object_key' from jsonb_array_elements(p_effects) with ordinality a(x,n);
  return jsonb_build_object('root_id',p_root,'revision',revision_value,'publication',receipt,'status','PREVIEW_PREPARADO');
exception when lock_not_available or deadlock_detected or query_canceled then raise exception 'IMPORT_RETRY_REQUIRED';
end $$;

create or replace function public.read_import_preview(p_actor_user bigint,p_tenant bigint,p_root bigint,p_head bigint,
  p_kind text default null,p_page integer default 1,p_revision text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare item public.import_preview; total bigint; rows jsonb; job public.import_publication;
begin
  perform equitas_import_private.preview_source(p_actor_user,p_tenant,p_root,p_head);
  if p_page is null or p_page<1 or p_page>6000 or (p_kind is not null and p_kind not in ('alta','actualizacion','sin_cambios','conflicto')) then
    raise exception 'PREVIEW_INPUT_INVALID'; end if;
  select * into item from public.import_preview where root_id=p_root and tenant=p_tenant;
  if not found then raise exception 'PREVIEW_NOT_PREPARED'; end if;
  if item.expires_at<=statement_timestamp() then raise exception 'PREVIEW_EXPIRED'; end if;
  if item.invalidated or item.source_head<>p_head
    or item.snapshot_token is distinct from equitas_import_private.preview_token(p_tenant,item.people) then
    raise exception 'PREVIEW_INVALIDATED'; end if;
  if (p_revision is not null and p_revision<>item.revision) or (p_page>1 and p_revision is null) then
    raise exception 'PREVIEW_REVISION_CONFLICT'; end if;
  if item.publication_batch is not null then
    select * into job from public.import_publication where batch_id=item.publication_batch;
    if job.status is distinct from 'VALIDADO' or job.revision is distinct from item.publication_revision
      or job.payload_hash is distinct from item.publication_payload_hash
      or job.payload_epoch is distinct from item.payload_epoch or job.expires_at<=statement_timestamp()
      then raise exception 'PREVIEW_INVALIDATED'; end if;
  end if;
  select count(*) into total from public.import_preview_row_staging where root_id=p_root and (p_kind is null or effect=p_kind);
  if p_page>greatest(1,(total+99)/100) then raise exception 'PREVIEW_PAGE_OUT_OF_RANGE'; end if;
  select coalesce(jsonb_agg(result order by ordinal),'[]') into rows from (
    select ordinal,result from public.import_preview_row_staging where root_id=p_root and (p_kind is null or effect=p_kind)
    order by ordinal limit 100 offset ((p_page::bigint-1)*100)) page;
  return jsonb_build_object('root_id',p_root,'event_id',p_head,'preview_id',item.preview_id,'revision',item.revision,
    'mapping_hash',item.mapping_hash,'created_at',item.created_at,'expires_at',item.expires_at,
    'status','PREVIEW_VIGENTE','summary',item.summary,'publication',case when job.batch_id is not null then
      jsonb_build_object('batch_id',job.batch_id,'revision',job.revision,'idempotency_key',job.idempotency_key,'counts',job.document->'counts') else null end,
    'page',p_page,'page_size',100,'kind',p_kind,'total',total,'rows',rows);
end $$;

create or replace function equitas_import_private.guard_preview_publication() returns trigger
language plpgsql set search_path='' as $$
declare item public.import_preview;
begin
  if new.status='CONFIRMADO' and old.status<>'CONFIRMADO' then
    if exists(select 1 from public.import_preview where publication_batch=new.batch_id)
      and not exists(select 1 from public.import_preview where publication_batch=new.batch_id and not invalidated)
      then raise exception 'PREVIEW_INVALIDATED'; end if;
    for item in select * from public.import_preview where publication_batch=new.batch_id and not invalidated loop
      if item.expires_at<=clock_timestamp()
        or item.publication_revision is distinct from new.revision
        or item.payload_epoch is distinct from new.payload_epoch
        or item.publication_payload_hash is distinct from new.payload_hash
        or item.snapshot_token is distinct from equitas_import_private.preview_token(item.tenant,item.people) or exists(
        select 1 from public.import_batch where supersedes=item.source_head) then raise exception 'PREVIEW_INVALIDATED'; end if;
    end loop;
  end if;
  if new.status in ('PUBLICADO','FALLIDO','DESCARTADO') then
    delete from public.import_preview_row_staging where root_id in (select root_id from public.import_preview where publication_batch=new.batch_id);
    update public.import_preview set invalidated=true where publication_batch=new.batch_id;
  end if;
  return new;
end $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='equitas_import_private' and p.proname in
      ('preview_payload_changed','preview_payload_updated','preview_payload_truncated','preview_absent_effects'))
      or (n.nspname='public' and p.proname='read_import_preview_reference') loop
    execute format('alter function %s owner to equitas_import_definer',f.signature);
    execute format('revoke all on function %s from public,anon,authenticated,service_role,equitas_review_server,equitas_import_server,postgres',f.signature);
  end loop;
end $$;
grant execute on function public.read_import_preview_reference(bigint,bigint,bigint,bigint) to equitas_import_server;
revoke create on schema public from equitas_import_definer;
revoke equitas_import_definer from postgres;
notify pgrst,'reload schema';
