-- ALIGN-054. New migration: never change the frozen 032 payload or its kind semantics.
grant equitas_import_definer to postgres;
grant create on schema public to equitas_import_definer;

create table public.import_preview (
  root_id bigint primary key,
  tenant bigint not null,
  source_head bigint not null,
  preview_id uuid not null unique default gen_random_uuid(),
  revision text not null,
  mapping_hash text not null,
  snapshot_token text not null,
  people bigint[] not null,
  publication_batch bigint references public.import_publication(batch_id),
  publication_revision text,
  summary jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  invalidated boolean not null default false
);
create table public.import_preview_row_staging (
  root_id bigint not null references public.import_preview(root_id) on delete cascade,
  ordinal bigint not null check(ordinal > 0),
  effect text not null check(effect in ('alta','actualizacion','sin_cambios','conflicto')),
  result jsonb not null,
  primary key(root_id,ordinal)
);
create index import_preview_effect_page on public.import_preview_row_staging(root_id,effect,ordinal);
create index import_preview_expiration on public.import_preview(expires_at) where not invalidated;

do $$ declare t text; begin
  foreach t in array array['import_preview','import_preview_row_staging'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role,equitas_import_server,equitas_review_server',t);
    execute format('alter table public.%I owner to equitas_import_definer',t);
  end loop;
end $$;

-- No FK to append-only history: its TRUNCATE contract must still report APPEND_ONLY.
create function equitas_import_private.preview_history() returns trigger
language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from public.import_batch where id=new.root_id and tenant=new.tenant and supersedes is null)
    or not exists(select 1 from public.import_batch where id=new.source_head and tenant=new.tenant) then
    raise exception 'IMPORT_HISTORY_REFERENCE_INVALID';
  end if;
  return null;
end $$;
create constraint trigger import_preview_history after insert or update on public.import_preview
not deferrable for each row execute function equitas_import_private.preview_history();

create function equitas_import_private.preview_source(p_actor bigint,p_tenant bigint,p_root bigint,p_head bigint)
returns public.import_batch language plpgsql stable set search_path='' as $$
declare root public.import_batch; current_id bigint; current_status text;
begin
  perform equitas_import_private.authorize(p_actor,p_tenant);
  select * into root from public.import_batch where id=p_root and tenant=p_tenant and supersedes is null;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  with recursive chain as (
    select id,status from public.import_batch where id=root.id
    union all select b.id,b.status from public.import_batch b join chain c on b.supersedes=c.id where b.tenant=p_tenant
  ) select id,status into current_id,current_status from chain order by id desc limit 1;
  if current_id is distinct from p_head then raise exception 'PREVIEW_INVALIDATED'; end if;
  -- 056 is not integrated here. Its validation requires its exact immutable binding,
  -- not merely status VALIDADO or a client-supplied profile. Fail closed until adapter.
  if current_status <> 'RECIBIDO' then raise exception 'PREVIEW_SOURCE_NOT_READY'; end if;
  return root;
end $$;

create function equitas_import_private.preview_token(p_tenant bigint,p_people bigint[]) returns text
language sql stable set search_path='' as $$
  select equitas_import_private.digest(jsonb_build_object(
    'versions',equitas_import_private.versions(p_tenant,p_people),
    'catalogs',jsonb_build_array(
      (select jsonb_agg(to_jsonb(x) order by id) from public.debtor_type x),
      (select jsonb_agg(to_jsonb(x) order by id) from public.debt_status x),
      (select jsonb_agg(to_jsonb(x) order by id) from public.currency x),
      (select jsonb_agg(to_jsonb(x) order by id) from public.person_type x),
      (select jsonb_agg(to_jsonb(x) order by id) from public.document_type x),
      (select jsonb_agg(to_jsonb(x) order by id) from public.person_status x),
      (select jsonb_agg(to_jsonb(x) order by id) from public.contact_type x))))
$$;

-- One snapshot per RPC, token and page together. The caller rejects any token change,
-- including the final empty page. All monetary values are exact decimal strings.
create function public.read_import_preview_source(p_actor_user bigint,p_tenant bigint,p_root bigint,p_head bigint,
  p_people bigint[],p_table text,p_after bigint default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare data jsonb;
begin
  perform equitas_import_private.preview_source(p_actor_user,p_tenant,p_root,p_head);
  if p_after<0 or p_after is null or p_people is null or cardinality(p_people)>100000 then
    raise exception 'PREVIEW_INPUT_INVALID';
  end if;
  case p_table
  when 'debtor' then
    select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') into data from (
      select d.id,d.external_id,d.tenant,t.key type,d.identifier,d.description,d.status
      from public.debtor d left join public.debtor_type t on t.id=d.type
      where d.tenant=p_tenant and d.id>p_after order by d.id limit 1000) s;
  when 'person' then
    select coalesce(jsonb_agg(value order by id),'[]') into data from (
      select p.id,case when exists(select 1 from public.debtor_person r join public.debtor d on d.id=r.debtor
          where r.person=p.id and d.tenant<>p_tenant)
        then jsonb_build_object('id',p.id,'external_id',p.external_id,'shared',true)
        else to_jsonb(p) || jsonb_build_object('type',t.key,'status',s.key,'document_type',dt.key) end value
      from public.person p left join public.person_type t on t.id=p.type
      left join public.person_status s on s.id=p.status left join public.document_type dt on dt.id=p.document_type
      where p.external_id=any(p_people) and p.id>p_after order by p.id limit 1000) s;
  when 'debt' then
    select coalesce(jsonb_agg(value order by id),'[]') into data from (
      select x.id,to_jsonb(x) || jsonb_build_object('original_amount',x.original_amount::text,
        'current_amount',x.current_amount::text,'status',s.key,'currency',c.code) value
      from public.debt x join public.debtor d on d.id=x.debtor
      left join public.debt_status s on s.id=x.status left join public.currency c on c.id=x.currency
      where d.tenant=p_tenant and x.id>p_after order by x.id limit 1000) s;
  when 'debtor_person' then
    select coalesce(jsonb_agg(value order by id),'[]') into data from (
      select r.id,to_jsonb(r) || jsonb_build_object('priority',r.priority::text) value
      from public.debtor_person r join public.debtor d on d.id=r.debtor
      where d.tenant=p_tenant and r.id>p_after order by r.id limit 1000) s;
  when 'debtor_contact' then
    select coalesce(jsonb_agg(value order by id),'[]') into data from (
      select c.id,to_jsonb(c) || jsonb_build_object('type',t.key) value
      from public.debtor_contact c join public.person p on p.id=c.person
      left join public.contact_type t on t.id=c.type
      where p.external_id=any(p_people) and c.id>p_after
        and not exists(select 1 from public.debtor_person r join public.debtor d on d.id=r.debtor where r.person=p.id and d.tenant<>p_tenant)
      order by c.id limit 1000) s;
  when 'address' then
    select coalesce(jsonb_agg(value order by id),'[]') into data from (
      select a.id,jsonb_build_object('id',a.id,'person',a.person,
        'address',to_jsonb(a)-array['id','person','city','created_at'],
        'city',to_jsonb(c)-array['id','province','created_at'],
        'province',to_jsonb(v)-array['id','created_at']) value
      from public.address a join public.person p on p.id=a.person
      left join public.city c on c.id=a.city left join public.province v on v.id=c.province
      where p.external_id=any(p_people) and a.id>p_after
        and not exists(select 1 from public.debtor_person r join public.debtor d on d.id=r.debtor where r.person=p.id and d.tenant<>p_tenant)
      order by a.id limit 1000) s;
  else raise exception 'PREVIEW_INPUT_INVALID';
  end case;
  return jsonb_build_object('token',equitas_import_private.preview_token(p_tenant,p_people),'rows',data);
end $$;

create function public.prepare_import_preview(p_actor_user bigint,p_tenant bigint,p_root bigint,p_head bigint,
  p_document jsonb,p_rows jsonb,p_effects jsonb,p_summary jsonb,p_token text,p_expires timestamptz,
  p_publishable boolean,p_expected_preview text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare source public.import_batch; people bigint[]; person_key bigint; old public.import_preview;
  receipt jsonb; revision_value text; expires timestamptz; mapping_value text; publication_id bigint;
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
  if old.publication_batch is not null then
    if exists(select 1 from public.import_publication where batch_id=old.publication_batch and status in ('PUBLICADO','FALLIDO','DESCARTADO')) then
      raise exception 'PREVIEW_SOURCE_NOT_READY';
    end if;
    -- Withdraw the old binding before replacement; its payload cannot be confirmed later.
    if exists(select 1 from public.import_publication where batch_id=old.publication_batch and status='VALIDADO') then
      perform equitas_import_private.event(old.publication_batch,'REQUIERE_NUEVO_PREVIEW','{}');
    end if;
  end if;
  if p_publishable then
    if exists(select 1 from jsonb_array_elements(p_effects) x where x->>'kind'='conflicto' and not (x->>'excluded')::boolean) then
      raise exception 'PREVIEW_INPUT_INVALID';
    end if;
    begin
      receipt := public.stage_import_batch(p_actor_user,p_tenant,p_document,p_rows,
      case when old.publication_batch is not null and exists(select 1 from public.import_publication
        where batch_id=old.publication_batch and idempotency_key=equitas_import_private.digest(p_document->'identity'))
      then old.publication_revision else null end);
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
    -- Stage may return an earlier same-identity revision. Never bless its stale versions.
    if publication_id is not null and not exists(select 1 from public.import_publication where batch_id=publication_id
      and versions=equitas_import_private.versions(p_tenant,people) and expires_at>clock_timestamp()) then
      raise exception 'PREVIEW_INVALIDATED';
    end if;
    update public.import_publication set expires_at=least(expires_at,expires) where batch_id=publication_id;
  end if;
  revision_value := equitas_import_private.digest(jsonb_build_object('root',p_root,'head',p_head,
    'identity',p_document->'identity','versions',p_token,'effects',p_effects,'nonce',gen_random_uuid()));
  insert into public.import_preview(root_id,tenant,source_head,revision,mapping_hash,snapshot_token,people,
    publication_batch,publication_revision,summary,expires_at)
  values(p_root,p_tenant,p_head,revision_value,mapping_value,p_token,people,publication_id,receipt->>'revision',p_summary,expires)
  on conflict(root_id) do update set preview_id=gen_random_uuid(),source_head=p_head,revision=revision_value,
    mapping_hash=mapping_value,snapshot_token=p_token,people=excluded.people,publication_batch=publication_id,
    publication_revision=receipt->>'revision',summary=p_summary,expires_at=expires,created_at=now(),invalidated=false;
  delete from public.import_preview_row_staging where root_id=p_root;
  insert into public.import_preview_row_staging(root_id,ordinal,effect,result)
    select p_root,n,x->>'kind',x from jsonb_array_elements(p_effects) with ordinality a(x,n);
  return jsonb_build_object('root_id',p_root,'revision',revision_value,'publication',receipt,'status','PREVIEW_PREPARADO');
exception when lock_not_available or deadlock_detected or query_canceled then raise exception 'IMPORT_RETRY_REQUIRED';
end $$;

create function public.read_import_preview(p_actor_user bigint,p_tenant bigint,p_root bigint,p_head bigint,
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
    if job.status<>'VALIDADO' or job.revision<>item.publication_revision or job.payload_hash is distinct from
      (select equitas_import_private.digest(coalesce(jsonb_agg(jsonb_build_object('kind',kind,'payload',payload) order by row_number),'[]'::jsonb))
       from public.import_row_staging where batch_id=job.batch_id) then raise exception 'PREVIEW_INVALIDATED'; end if;
  end if;
  select count(*) into total from public.import_preview_row_staging where root_id=p_root and (p_kind is null or effect=p_kind);
  if p_page>greatest(1,(total+99)/100) then raise exception 'PREVIEW_PAGE_OUT_OF_RANGE'; end if;
  select coalesce(jsonb_agg(result order by ordinal),'[]') into rows from (
    select ordinal,result from public.import_preview_row_staging where root_id=p_root and (p_kind is null or effect=p_kind)
    order by ordinal limit 100 offset ((p_page::bigint-1)*100)) page;
  return jsonb_build_object('root_id',p_root,'event_id',p_head,'preview_id',item.preview_id,'revision',item.revision,
    'mapping_hash',item.mapping_hash,'created_at',item.created_at,'expires_at',item.expires_at,
    'status','PREVIEW_VIGENTE','summary',item.summary,'publication',case when job.batch_id is not null then
      jsonb_build_object('batch_id',job.batch_id,'revision',job.revision,'idempotency_key',job.idempotency_key) else null end,
    'page',p_page,'page_size',100,'kind',p_kind,'total',total,'rows',rows);
end $$;

-- A source invalidation cannot leave a linked032 revision publishable. No new event
-- masquerades as atomic; these guards merely reject a stale preparation.
create function equitas_import_private.guard_preview_publication() returns trigger
language plpgsql set search_path='' as $$
declare item public.import_preview;
begin
  if new.status='CONFIRMADO' and old.status<>'CONFIRMADO' then
    for item in select * from public.import_preview where publication_batch=new.batch_id loop
      if item.invalidated or item.expires_at<=clock_timestamp()
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
create trigger preview_publication_guard before update on public.import_publication
for each row execute function equitas_import_private.guard_preview_publication();

create function public.purge_import_previews() returns bigint
language plpgsql security definer set search_path='' as $$
declare n bigint;
begin
  delete from public.import_preview_row_staging s using public.import_preview p
    where s.root_id=p.root_id and (p.expires_at<=clock_timestamp() or p.invalidated or exists(
      select 1 from public.import_batch b where b.supersedes=p.source_head));
  get diagnostics n=row_count;
  update public.import_preview p set invalidated=true,summary='{}' where not invalidated and
    (expires_at<=clock_timestamp() or exists(select 1 from public.import_batch b where b.supersedes=p.source_head));
  return n;
end $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='equitas_import_private' and p.proname in ('preview_history','preview_source','preview_token','guard_preview_publication'))
      or (n.nspname='public' and p.proname in ('read_import_preview_source','prepare_import_preview','read_import_preview','purge_import_previews')) loop
    execute format('alter function %s owner to equitas_import_definer',f.signature);
    execute format('revoke all on function %s from public,anon,authenticated,service_role,equitas_review_server,equitas_import_server,postgres',f.signature);
  end loop;
end $$;
grant execute on function public.read_import_preview_source(bigint,bigint,bigint,bigint,bigint[],text,bigint),
  public.prepare_import_preview(bigint,bigint,bigint,bigint,jsonb,jsonb,jsonb,jsonb,text,timestamptz,boolean,text),
  public.read_import_preview(bigint,bigint,bigint,bigint,text,integer,text) to equitas_import_server;
grant execute on function public.purge_import_previews() to postgres;
revoke create on schema public from equitas_import_definer;
revoke equitas_import_definer from postgres;
select cron.schedule('equitas-import-preview-ttl','* * * * *',
  $$set statement_timeout='45s'; select public.purge_import_previews();$$);
notify pgrst,'reload schema';
