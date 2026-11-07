-- ALIGN-032. Solo stack local. Conserva el historial append-only de ALIGN-018.
-- La única transacción que escribe cartera es publish_import_batch. Staging no publica.
-- El servidor registra FALLIDO en otra transacción; el recibo de PUBLICADO es durable.

-- Presupuesto acotado para la RPC de publicación completa, también por PostgREST.
-- No cambia authenticator ni los límites de los roles de lectura/revisión. El
-- cliente conserva 120 s para transporte y recuperación; la consulta tiene 60 s.
alter role equitas_import_server set statement_timeout = '60s';
alter role equitas_import_server set lock_timeout = '55s';

do $$ begin if not exists(select 1 from pg_roles where rolname='equitas_import_definer') then create role equitas_import_definer; end if; end $$;
alter role equitas_import_definer nologin noinherit nocreatedb nocreaterole bypassrls;
grant equitas_import_definer to postgres;
grant create on schema public to equitas_import_definer;
create schema equitas_import_private authorization equitas_import_definer;
revoke all on schema equitas_import_private from public, anon, authenticated, service_role;

grant usage on schema public to equitas_import_definer;
-- equitas_member_role es INVOKER: EXECUTE no concede sus lecturas de membresía.
grant select (id,status) on public."user" to equitas_import_definer;
grant select (tenant,"user",role,status) on public.tenant_user to equitas_import_definer;
grant select (id,name) on public.role to equitas_import_definer;
grant select (id,status) on public.tenant to equitas_import_definer;
grant select, insert on public.import_batch to equitas_import_definer;
grant equitas_write_definer to postgres;
grant execute on function public.equitas_member_role(bigint, bigint) to equitas_import_definer;
revoke equitas_write_definer from postgres;
grant execute on function public.recompute_debtor_profiles(bigint[], date, boolean) to equitas_import_definer;
grant select on public.debtor_type, public.debt_status, public.document_type, public.person_type,
  public.person_status, public.contact_type, public.currency to equitas_import_definer;
grant select, insert, update on public.person, public.debtor, public.debtor_person, public.debt,
  public.province, public.city, public.address, public.debtor_contact, public.debtor_profile,
  public.debtor_profile_detail to equitas_import_definer;

do $$ declare t text; begin
  foreach t in array array['import_batch','person','debtor','debtor_person','debt','province','city',
    'address','debtor_contact','debtor_profile','debtor_profile_detail'] loop
    execute format('grant usage, select on sequence %s to equitas_import_definer', pg_get_serial_sequence('public.' || t,'id'));
  end loop;
end $$;

create table public.import_publication (
  batch_id bigint primary key references public.import_batch(id),
  tenant bigint not null references public.tenant(id),
  head_id bigint not null references public.import_batch(id),
  actor bigint not null references public."user"(id),
  idempotency_key text not null check (idempotency_key ~ '^[0-9a-f]{64}$'),
  revision text not null check (revision ~ '^[0-9a-f]{64}$'),
  generation bigint not null default 1 check (generation > 0),
  payload_hash text not null,
  status text not null check (status in ('RECIBIDO','VALIDADO','CONFIRMADO','PUBLICADO','FALLIDO','DESCARTADO','REQUIERE_NUEVO_PREVIEW')),
  document jsonb not null,
  versions jsonb not null,
  result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  unique (tenant, idempotency_key),
  unique (tenant, batch_id)
);
create table public.import_row_staging (
  batch_id bigint not null references public.import_publication(batch_id) on delete cascade,
  row_number bigint not null check (row_number > 0),
  kind text not null check (kind in ('person','object')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  primary key (batch_id, row_number)
);
create index import_publication_expiration on public.import_publication(expires_at)
  where status in ('RECIBIDO','VALIDADO','CONFIRMADO','REQUIERE_NUEVO_PREVIEW');

-- Tombstones conservadas: borrar y recrear un objeto nunca recupera su versión anterior.
create table equitas_import_private.object_version (
  tenant bigint not null,
  object_type bigint not null,
  external_id bigint not null,
  version bigint not null default 1,
  last_as_of date,
  primary key (tenant, object_type, external_id)
);
create table equitas_import_private.person_version (
  external_id bigint primary key,
  version bigint not null default 1
);
insert into equitas_import_private.object_version(tenant, object_type, external_id)
select tenant, coalesce(type, 0), external_id from public.debtor;
insert into equitas_import_private.person_version(external_id) select external_id from public.person;

do $$ declare t text; begin
  foreach t in array array['public.import_publication','public.import_row_staging',
    'equitas_import_private.object_version','equitas_import_private.person_version'] loop
    execute format('alter table %s enable row level security',t);
    execute format('revoke all on %s from public, anon, authenticated, service_role, equitas_import_server, equitas_review_server',t);
    execute format('alter table %s owner to equitas_import_definer',t);
  end loop;
end $$;

-- JSON canónico compartido con Python: claves ordenadas por bytes UTF-8, sin espacios.
-- Los valores de identidad son strings, booleanos, enteros, objetos y arrays, nunca floats.
create function equitas_import_private.canonical(p_value jsonb) returns text
language sql immutable strict set search_path = '' as $$
  select case jsonb_typeof(p_value)
    when 'object' then (select '{' || coalesce(string_agg(to_jsonb(key)::text || ':' ||
      equitas_import_private.canonical(value), ',' order by key collate "C"),'') || '}' from jsonb_each(p_value))
    when 'array' then (select '[' || coalesce(string_agg(equitas_import_private.canonical(value), ',' order by n),'') || ']'
      from jsonb_array_elements(p_value) with ordinality a(value,n))
    else p_value::text end
$$;
create function equitas_import_private.digest(p_value jsonb) returns text
language sql immutable strict set search_path = '' as $$
  select encode(sha256(convert_to(equitas_import_private.canonical(p_value),'UTF8')),'hex')
$$;
create function equitas_import_private.authorize(p_actor bigint, p_tenant bigint) returns text
language plpgsql set search_path = '' as $$
declare r text := public.equitas_member_role(p_actor,p_tenant);
begin
  if r is null then raise exception 'ACTOR_NOT_ACTIVE_MEMBER'; end if;
  if r not in ('importador','importador_sistema') then raise exception 'ROLE_NOT_ALLOWED'; end if;
  return r;
end $$;

create function equitas_import_private.bump_object(p_debtor bigint) returns void
language plpgsql set search_path = '' as $$
declare d public.debtor;
begin
  select * into d from public.debtor where id=p_debtor;
  if not found then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(format('import_batch:%s',d.tenant),0));
  insert into equitas_import_private.object_version as v(tenant,object_type,external_id)
  values(d.tenant,coalesce(d.type,0),d.external_id)
  on conflict (tenant,object_type,external_id) do update set version=v.version+1;
end $$;

-- Las escrituras administrativas/legacy también invalidan revisiones. No depende de que
-- el cliente acuerde incrementar una versión. Los no-op no la incrementan.
create function equitas_import_private.track_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  old_row jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) else '{}' end;
  new_row jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) else '{}' end;
  ids bigint[] := '{}'; people bigint[] := '{}'; item record; d public.debtor;
begin
  if tg_op='UPDATE' and old_row = new_row then return new; end if;
  if tg_table_name in ('province','city') then
    perform pg_advisory_xact_lock(hashtextextended('import_locations',0));
    select coalesce(array_agg(distinct a.person),'{}') into people from public.address a
    join public.city c on c.id=a.city
    where (tg_table_name='city' and c.id in ((old_row->>'id')::bigint,(new_row->>'id')::bigint))
       or (tg_table_name='province' and c.province in ((old_row->>'id')::bigint,(new_row->>'id')::bigint));
  elsif tg_table_name='person' then
    people := array[(old_row->>'id')::bigint,(new_row->>'id')::bigint];
    for item in select distinct x from unnest(array[(old_row->>'external_id')::bigint,(new_row->>'external_id')::bigint]) x where x is not null order by x loop
      perform pg_advisory_xact_lock(hashtextextended(format('import_person:%s',item.x),0));
      insert into equitas_import_private.person_version as v(external_id) values(item.x)
      on conflict(external_id) do update set version=v.version+1;
    end loop;
  elsif tg_table_name in ('address','debtor_contact','debtor_person','debtor_profile_detail') then
    people := array[(old_row->>'person')::bigint,(new_row->>'person')::bigint];
  end if;
  for item in select distinct p.external_id from public.person p where p.id=any(people) order by p.external_id loop
    perform pg_advisory_xact_lock(hashtextextended(format('import_person:%s',item.external_id),0));
    insert into equitas_import_private.person_version as v(external_id) values(item.external_id)
    on conflict(external_id) do update set version=v.version+1;
  end loop;
  if tg_table_name='debtor' then
    -- Antes de borrar o mover la clave, invalidar también la identidad anterior.
    for item in select distinct (r->>'tenant')::bigint tenant, coalesce((r->>'type')::bigint,0) typ,
      (r->>'external_id')::bigint ext from unnest(array[old_row,new_row]) r where r ? 'tenant' order by 1,2,3 loop
      perform pg_advisory_xact_lock(hashtextextended(format('import_batch:%s',item.tenant),0));
      insert into equitas_import_private.object_version as v(tenant,object_type,external_id) values(item.tenant,item.typ,item.ext)
      on conflict(tenant,object_type,external_id) do update set version=v.version+1;
    end loop;
  elsif tg_table_name in ('debt','debtor_person','debtor_profile') then
    ids := array[(old_row->>'debtor')::bigint,(new_row->>'debtor')::bigint];
  elsif tg_table_name='debtor_profile_detail' then
    select coalesce(array_agg(id),'{}') into ids from public.debtor where id in
      (select debtor from public.debtor_profile where id in ((old_row->>'debtor_profile')::bigint,(new_row->>'debtor_profile')::bigint));
  end if;
  -- Unir primero las claves afectadas permite búsquedas por PK. El OR anterior
  -- recorría debtor entero por cada deuda escrita (decenas de miles por lote).
  for d in select obj.* from public.debtor obj join
    (select unnest(ids) id union select debtor from public.debtor_person where person=any(people)) affected
    on obj.id=affected.id order by obj.tenant,obj.id loop
    perform equitas_import_private.bump_object(d.id);
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['person','debtor','debtor_person','debt','province','city','address',
    'debtor_contact','debtor_profile','debtor_profile_detail'] loop
    execute format('create trigger import_version_change before insert or update or delete on public.%I for each row execute function equitas_import_private.track_change()',t);
  end loop;
end $$;

create function equitas_import_private.lock_scope(p_tenant bigint,p_people bigint[]) returns void
language plpgsql set search_path = '' as $$
declare person_key bigint;
begin
  -- Orden único: localidades compartidas, personas ordenadas, tenant; luego filas.
  perform pg_advisory_xact_lock(hashtextextended('import_locations',0));
  for person_key in select distinct x from unnest(p_people) x order by x loop
    perform pg_advisory_xact_lock(hashtextextended(format('import_person:%s',person_key),0));
  end loop;
  perform pg_advisory_xact_lock(hashtextextended(format('import_batch:%s',p_tenant),0));
  if exists(select 1 from public.person p join public.debtor_person r on r.person=p.id
    join public.debtor d on d.id=r.debtor where p.external_id=any(p_people) and d.tenant<>p_tenant) then
    raise exception 'SHARED_PERSON_OTHER_TENANT';
  end if;
end $$;
create function equitas_import_private.versions(p_tenant bigint,p_people bigint[]) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('objects',coalesce((select jsonb_agg(jsonb_build_array(object_type,external_id,version)
    order by object_type,external_id) from equitas_import_private.object_version where tenant=p_tenant),'[]'::jsonb),
    'people',coalesce((select jsonb_agg(jsonb_build_array(x,coalesce(v.version,0)) order by x)
      from (select distinct unnest(p_people) x) keys left join equitas_import_private.person_version v on v.external_id=keys.x),'[]'::jsonb))
$$;

-- No acepta identificadores SQL del cliente. Solo las tablas/columnas de la cartera
-- versionada y claves internas que el publicador elige. Los casts son los del esquema.
create function equitas_import_private.upsert_row(p_table text,p_payload jsonb,p_keys text[],p_ignore text[] default '{}') returns jsonb
language plpgsql set search_path = '' as $$
declare allowed text[]; columns_sql text; values_sql text; predicate text; equal_sql text; set_sql text;
  row_id bigint; same boolean; outcome text;
begin
  allowed := case p_table
    when 'person' then array['external_id','document_type','document_number','full_name','type','birth_date','status']
    when 'debtor' then array['tenant','external_id','type','identifier','description','status']
    when 'debtor_person' then array['debtor','person','priority','role','active']
    when 'debt' then array['external_id','debtor','type','description','original_amount','current_amount','currency','issue_date','due_date','last_collection_date','period','status']
    when 'province' then array['name','active']
    when 'city' then array['province','name','postal_code','active']
    when 'address' then array['person','street','number','neighborhood','city','floor','apartment','tower','building_name','lot','block','reference','coordinates','active']
    when 'debtor_contact' then array['person','type','value','active']
    when 'debtor_profile_detail' then array['debtor_profile','person','risk_value','reason','active']
    else null end;
  if allowed is null or jsonb_typeof(p_payload)<>'object' or p_payload-array(select unnest(allowed))<>'{}'::jsonb
    or not p_keys<@allowed or not p_ignore<@allowed or not p_payload ?& p_keys then raise exception 'IMPORT_INPUT_INVALID'; end if;
  -- Las claves no nulas usan igualdad e índices; la rama nula conserva exactamente
  -- la semántica anterior. IS NOT DISTINCT FROM sigue comparando los valores para
  -- evitar reescribir una fila sin cambios, pero no obliga a buscarla por barrido.
  select string_agg(case when p_payload->x='null'::jsonb then format('t.%I is null',x)
    else format('t.%I = r.%I',x,x) end,' and ') into predicate from unnest(p_keys) x;
  select string_agg(format('t.%I is not distinct from r.%I',x,x),' and '),
    string_agg(format('%I = r.%I',x,x),',') into equal_sql,set_sql
    from jsonb_object_keys(p_payload) x where not x=any(p_ignore);
  execute format('select t.id,(%s) from public.%I t cross join jsonb_populate_record(null::public.%I,$1) r where %s order by t.id limit 1',
    equal_sql,p_table,p_table,predicate) into row_id,same using p_payload;
  if row_id is not null then
    outcome := 'sin_cambios';
    if not same then
      execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$1) r where t.id=$2',p_table,set_sql,p_table) using p_payload,row_id;
      outcome := 'actualizadas';
    end if;
  else
    select string_agg(format('%I',x),','),string_agg(format('r.%I',x),',') into columns_sql,values_sql from jsonb_object_keys(p_payload) x;
    execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1) r returning id',
      p_table,columns_sql,values_sql,p_table) into row_id using p_payload;
    outcome := 'insertadas';
  end if;
  return jsonb_build_object('id',row_id,'table',p_table,'outcome',outcome);
end $$;
create function equitas_import_private.tally(p_tally jsonb,p_table text,p_outcome text,p_count bigint default 1) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_set(p_tally,array[p_table],coalesce(p_tally->p_table,'{"insertadas":0,"actualizadas":0,"sin_cambios":0}'::jsonb) ||
    jsonb_build_object(p_outcome,coalesce((p_tally->p_table->>p_outcome)::bigint,0)+p_count))
$$;
create function equitas_import_private.catalogs(p_entity text,p_payload jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare field text; catalog text; id_value bigint; result jsonb := p_payload;
begin
  for field,catalog in select field_name,table_name from (values
    ('person','document_type','document_type'),('person','type','person_type'),('person','status','person_status'),
    ('debtor','type','debtor_type'),('debt','status','debt_status'),('debt','currency','currency'),('debtor_contact','type','contact_type'))
    fields(entity,field_name,table_name) where entity=p_entity loop
    execute format('select id from public.%I where %I=$1',catalog,case when catalog='currency' then 'code' else 'key' end)
      into id_value using p_payload->>field;
    if id_value is null then raise exception 'CATALOG_KEY_MISSING'; end if;
    result := jsonb_set(result,array[field],to_jsonb(id_value));
  end loop;
  return result;
end $$;

create function equitas_import_private.receipt(p_batch bigint) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(result,jsonb_build_object('batch_id',batch_id,'idempotency_key',idempotency_key,
    'revision',revision,'status',status,'counts',coalesce(document->'counts','{}'::jsonb)))
  from public.import_publication where batch_id=p_batch
$$;
create function equitas_import_private.event(p_batch bigint,p_status text,p_counts jsonb) returns bigint
language plpgsql set search_path = '' as $$
declare job public.import_publication; root public.import_batch; event_id bigint; actor_role text;
begin
  select * into strict job from public.import_publication where batch_id=p_batch;
  select * into strict root from public.import_batch where id=p_batch;
  actor_role := coalesce(public.equitas_member_role(job.actor,job.tenant),root.created_by_role);
  insert into public.import_batch(tenant,source,file_hashes,as_of,source_updated_at,rules_version,counts,status,
    created_by,created_by_role,supersedes,idempotency_key)
  values(root.tenant,root.source,root.file_hashes,root.as_of,root.source_updated_at,root.rules_version,
    p_counts || '{"publicacion_atomica":1}'::jsonb,p_status,job.actor,actor_role,job.head_id,gen_random_uuid()) returning id into event_id;
  update public.import_publication set head_id=event_id,status=p_status where batch_id=p_batch;
  if p_status in ('PUBLICADO','FALLIDO','DESCARTADO') then
    delete from public.import_row_staging where batch_id=p_batch;
    update public.import_publication set document='{}'::jsonb where batch_id=p_batch;
  end if;
  return event_id;
end $$;

-- La función antigua de eventos no puede suplantar ni prolongar la cadena de un lote atómico.
create function public.guard_atomic_import_event() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user <> 'equitas_import_definer' and
    (new.counts ? 'publicacion_atomica' or exists(select 1 from public.import_batch b
      where b.id=new.supersedes and b.counts ? 'publicacion_atomica')) then
    raise exception 'ATOMIC_IMPORT_EVENT_REQUIRED';
  end if;
  return new;
end $$;
create trigger import_atomic_event_guard before insert on public.import_batch
for each row execute function public.guard_atomic_import_event();

create function equitas_import_private.absent(p_batch bigint) returns jsonb
language sql stable set search_path = '' as $$
  with job as (select * from public.import_publication where batch_id=p_batch),
  staged as (select payload from public.import_row_staging where batch_id=p_batch and kind='object'),
  accepted as (select s.payload,d.id from staged s cross join job j
    join public.debtor d on d.tenant=j.tenant
    join public.debtor_type t on t.id=d.type
    where t.key=s.payload->'debtor'->>'type' and d.external_id=(s.payload->'debtor'->>'external_id')::bigint),
  missing_objects as (select count(*) n from public.debtor d join public.debtor_type t on t.id=d.type cross join job j
    where d.tenant=j.tenant and not exists(select 1 from jsonb_array_elements(j.document->'file_object_keys') k
      where k->>0=t.key and k->>1=d.external_id::text)),
  missing_debts as (select count(*) n from accepted a join public.debt d on d.debtor=a.id
    where not exists(select 1 from jsonb_array_elements(a.payload->'debts') x where (x->>'external_id')::bigint=d.external_id)),
  missing_relations as (select r.id from accepted a join public.debtor_person r on r.debtor=a.id and r.active
    join public.person p on p.id=r.person where not exists(select 1 from jsonb_array_elements(a.payload->'relations') x
      where (x->>'external_id')::bigint=p.external_id)),
  staged_people as (select (r->>'external_id')::bigint external_id,r->'contacts' contacts from staged s,
    lateral jsonb_array_elements(s.payload->'relations') r),
  missing_contacts as (select distinct c.id from public.debtor_contact c join public.person p on p.id=c.person
    join public.contact_type t on t.id=c.type cross join job j
    where c.active and j.document->'contact_types' ? t.key
      and not (j.document->'protected_people' ? p.external_id::text)
      and exists(select 1 from staged_people s where s.external_id=p.external_id)
      and exists(select 1 from public.debtor_person r join public.debtor d on d.id=r.debtor
        where r.person=p.id and r.active and d.tenant=j.tenant)
      and not exists(select 1 from staged_people s,lateral jsonb_array_elements(s.contacts) x
        where s.external_id=p.external_id and x->>'type'=t.key and x->>'value'=c.value))
  select jsonb_build_object('counts',jsonb_strip_nulls(jsonb_build_object(
      'objetos',nullif((select n from missing_objects),0), 'obligaciones',nullif((select n from missing_debts),0),
      'relaciones',nullif((select count(*) from missing_relations),0),'contactos',nullif((select count(*) from missing_contacts),0))),
    'relations',coalesce((select jsonb_agg(id order by id) from missing_relations),'[]'::jsonb),
    'contacts',coalesce((select jsonb_agg(id order by id) from missing_contacts),'[]'::jsonb))
$$;

create function public.stage_import_batch(p_actor_user bigint,p_tenant bigint,p_document jsonb,p_rows jsonb,
  p_expected_revision text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor_role text; ident jsonb := p_document->'identity'; key_value text; row_hash text; frozen_versions jsonb;
  people bigint[]; job public.import_publication; root_id bigint; generation_value bigint := 1;
  revision_value text; missing jsonb; counts_value jsonb; parameters jsonb := ident->'parameters';
begin
  actor_role := equitas_import_private.authorize(p_actor_user,p_tenant);
  if p_document is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>200000
    or ident->'tenant' is distinct from to_jsonb(p_tenant)
    or ident-array['tenant','files','mapping_hash','contract','parameters']<>'{}'::jsonb
    or parameters-array['as_of','absent_policy','rejections','rules_version']<>'{}'::jsonb
    or (ident->'contract')-array['version','sha256']<>'{}'::jsonb
    or ident->>'mapping_hash' is distinct from equitas_import_private.digest(p_document->'mapping')
    or ident->'files' is distinct from ((p_document->'file_hashes')-'mapeo'-'contrato')
    or ident->'contract'->>'sha256' is distinct from p_document->'file_hashes'->>'contrato'
    or parameters->>'absent_policy' not in ('rechazar','conservar','dar-de-baja')
    or (parameters->>'as_of')::date is null
    or parameters->>'as_of' is distinct from ((parameters->>'as_of')::date)::text
    or jsonb_typeof(p_document->'counts') is distinct from 'object'
    or exists(select 1 from jsonb_array_elements(p_rows) r where r->>'kind' not in ('person','object')
       or jsonb_typeof(r->'payload') is distinct from 'object'
       or (r->>'kind'='object' and (r->'payload'->'debtor'->>'tenant')::bigint is distinct from p_tenant)) then
    raise exception 'IMPORT_INPUT_INVALID';
  end if;
  key_value := equitas_import_private.digest(ident);
  row_hash := equitas_import_private.digest(p_rows);
  -- PUBLICADO es inmutable. Su recibo no depende de vínculos o versiones que
  -- otra operación pueda haber cambiado después de ese commit.
  select * into job from public.import_publication where tenant=p_tenant and idempotency_key=key_value;
  if found and job.status='PUBLICADO' then
    if job.payload_hash<>row_hash then raise exception 'IMPORT_REVISION_CONFLICT'; end if;
    return job.result;
  end if;
  select coalesce(array_agg(distinct (r->'payload'->'person'->>'external_id')::bigint),'{}') into people
    from jsonb_array_elements(p_rows) r where r->>'kind'='person';
  perform equitas_import_private.lock_scope(p_tenant,people);
  select * into job from public.import_publication where tenant=p_tenant and idempotency_key=key_value for update;
  if found then
    if job.payload_hash<>row_hash then raise exception 'IMPORT_REVISION_CONFLICT'; end if;
    if job.status in ('PUBLICADO','VALIDADO','CONFIRMADO') then return equitas_import_private.receipt(job.batch_id); end if;
    if p_expected_revision is null then raise exception 'IMPORT_REVALIDATION_REQUIRED'; end if;
    if p_expected_revision<>job.revision then raise exception 'IMPORT_REVISION_CONFLICT'; end if;
    generation_value := job.generation+1;
    root_id := job.batch_id;
    delete from public.import_row_staging where batch_id=root_id;
    update public.import_publication set actor=p_actor_user,document=p_document where batch_id=root_id;
    perform equitas_import_private.event(root_id,'RECIBIDO',p_document->'counts');
  else
    if p_expected_revision is not null then raise exception 'IMPORT_REVISION_CONFLICT'; end if;
    insert into public.import_batch(tenant,source,file_hashes,as_of,source_updated_at,rules_version,counts,status,
      created_by,created_by_role,idempotency_key)
    values(p_tenant,p_document->>'source',p_document->'file_hashes',(parameters->>'as_of')::date,
      (p_document->>'source_updated_at')::date,parameters->>'rules_version',p_document->'counts' || '{"publicacion_atomica":1}'::jsonb,
      'RECIBIDO',p_actor_user,actor_role,gen_random_uuid()) returning id into root_id;
  end if;
  frozen_versions := equitas_import_private.versions(p_tenant,people);
  revision_value := equitas_import_private.digest(jsonb_build_object('identity',key_value,'payload',row_hash,
    'versions',frozen_versions,'generation',generation_value));
  insert into public.import_publication(batch_id,tenant,head_id,actor,idempotency_key,revision,generation,payload_hash,status,document,versions)
  values(root_id,p_tenant,root_id,p_actor_user,key_value,revision_value,generation_value,row_hash,'RECIBIDO',p_document,frozen_versions)
  on conflict(batch_id) do update set revision=revision_value,generation=generation_value,document=p_document,
    versions=frozen_versions,status='RECIBIDO',result=null,expires_at=now()+interval '24 hours';
  insert into public.import_row_staging(batch_id,row_number,kind,payload)
    select root_id,n,r->>'kind',r->'payload' from jsonb_array_elements(p_rows) with ordinality a(r,n);
  missing := equitas_import_private.absent(root_id);
  counts_value := p_document->'counts';
  if missing->'counts'<>'{}'::jsonb then counts_value := counts_value || jsonb_build_object('ausentes',missing->'counts'); end if;
  update public.import_publication set document=jsonb_set(document,'{counts}',counts_value) || jsonb_build_object('absent',missing)
    where batch_id=root_id;
  if parameters->>'absent_policy'='rechazar' and ((missing->'counts')-'contactos')<>'{}'::jsonb then
    perform equitas_import_private.event(root_id,'FALLIDO',counts_value || jsonb_build_object('faltantes',missing->'counts'));
    update public.import_publication set result=jsonb_build_object('batch_id',root_id,'idempotency_key',key_value,
      'revision',revision_value,'status','FALLIDO','error','PARTIAL_LOAD_REJECTED','counts',counts_value) where batch_id=root_id;
  else
    perform equitas_import_private.event(root_id,'VALIDADO',counts_value);
  end if;
  return equitas_import_private.receipt(root_id);
exception when others then
  if sqlerrm in ('ACTOR_NOT_ACTIVE_MEMBER','ROLE_NOT_ALLOWED','IMPORT_INPUT_INVALID','IMPORT_REVISION_CONFLICT',
    'IMPORT_REVALIDATION_REQUIRED','SHARED_PERSON_OTHER_TENANT') then raise exception '%',sqlerrm; end if;
  raise exception 'IMPORT_INPUT_INVALID';
end $$;

create function equitas_import_private.write_rows(p_batch bigint) returns jsonb
language plpgsql set search_path = '' as $$
declare
  job public.import_publication; item record; relation jsonb; debt_row jsonb; contact jsonb; result_row jsonb;
  person_ids jsonb := '{}'; object_ids bigint[] := '{}'; links jsonb := '[]'; tally_value jsonb := '{}';
  province_id bigint; city_id bigint; person_id bigint; debtor_id bigint; profile_id bigint; counter bigint;
  people_count bigint := 0; object_count bigint := 0; relation_count bigint := 0; contact_count bigint := 0;
  address_count bigint := 0; debt_count bigint := 0; debt_inserted bigint := 0; debt_updated bigint := 0; debt_same bigint := 0;
  relation_deactivated bigint := 0; contact_deactivated bigint := 0; profiles jsonb; outcome text; loaded jsonb;
begin
  select * into strict job from public.import_publication where batch_id=p_batch;
  for item in select payload from public.import_row_staging where batch_id=p_batch and kind='person' order by row_number loop
    result_row := equitas_import_private.upsert_row('person',equitas_import_private.catalogs('person',item.payload->'person'),array['external_id']);
    tally_value := equitas_import_private.tally(tally_value,'person',result_row->>'outcome');
    person_id := (result_row->>'id')::bigint;
    person_ids := person_ids || jsonb_build_object(item.payload->'person'->>'external_id',person_id);
    people_count := people_count+1;
    if item.payload->'location'<>'null'::jsonb then
      result_row := equitas_import_private.upsert_row('province',item.payload->'location'->'province',array['name']);
      tally_value := equitas_import_private.tally(tally_value,'province',result_row->>'outcome');
      province_id := (result_row->>'id')::bigint;
      result_row := equitas_import_private.upsert_row('city',item.payload->'location'->'city' || jsonb_build_object('province',province_id),
        case when item.payload->'location'->'city'->>'postal_code' is null then array['province','name'] else array['province','name','postal_code'] end,
        case when item.payload->'location'->'city'->>'postal_code' is null then array['postal_code'] else '{}'::text[] end);
      tally_value := equitas_import_private.tally(tally_value,'city',result_row->>'outcome');
      city_id := (result_row->>'id')::bigint;
      result_row := equitas_import_private.upsert_row('address',item.payload->'location'->'address' || jsonb_build_object('person',person_id,'city',city_id),array['person']);
      tally_value := equitas_import_private.tally(tally_value,'address',result_row->>'outcome');
      address_count := address_count+1;
    end if;
  end loop;
  for item in select payload from public.import_row_staging where batch_id=p_batch and kind='object' order by row_number loop
    if (item.payload->'debtor'->>'tenant')::bigint is distinct from job.tenant then raise exception 'IMPORT_INPUT_INVALID'; end if;
    result_row := equitas_import_private.upsert_row('debtor',equitas_import_private.catalogs('debtor',item.payload->'debtor'),array['tenant','type','external_id']);
    tally_value := equitas_import_private.tally(tally_value,'debtor',result_row->>'outcome');
    debtor_id := (result_row->>'id')::bigint;
    object_ids := array_append(object_ids,debtor_id);
    object_count := object_count+1;
    for relation in select value from jsonb_array_elements(item.payload->'relations') loop
      person_id := (person_ids->>(relation->>'external_id'))::bigint;
      if person_id is null then raise exception 'IMPORT_INPUT_INVALID'; end if;
      result_row := equitas_import_private.upsert_row('debtor_person',relation->'relation' || jsonb_build_object('debtor',debtor_id,'person',person_id),array['debtor','person']);
      tally_value := equitas_import_private.tally(tally_value,'debtor_person',result_row->>'outcome');
      relation_count := relation_count+1;
      links := links || jsonb_build_array(jsonb_build_object('debtor',debtor_id,'person',person_id));
      for contact in select value from jsonb_array_elements(relation->'contacts') loop
        result_row := equitas_import_private.upsert_row('debtor_contact',equitas_import_private.catalogs('debtor_contact',contact) ||
          jsonb_build_object('person',person_id),array['person','type','value']);
        tally_value := equitas_import_private.tally(tally_value,'debtor_contact',result_row->>'outcome');
        contact_count := contact_count+1;
      end loop;
    end loop;
    for debt_row in select value from jsonb_array_elements(item.payload->'debts') loop
      result_row := equitas_import_private.upsert_row('debt',equitas_import_private.catalogs('debt',debt_row) ||
        jsonb_build_object('debtor',debtor_id),array['debtor','external_id']);
      outcome := result_row->>'outcome';
      tally_value := equitas_import_private.tally(tally_value,'debt',outcome);
      debt_count := debt_count+1;
      debt_inserted := debt_inserted+(outcome='insertadas')::integer;
      debt_updated := debt_updated+(outcome='actualizadas')::integer;
      debt_same := debt_same+(outcome='sin_cambios')::integer;
    end loop;
  end loop;
  if job.document->'identity'->'parameters'->>'absent_policy'='dar-de-baja' then
    update public.debtor_person set active=false where active and id in
      (select value::bigint from jsonb_array_elements_text(job.document->'absent'->'relations'));
    get diagnostics relation_deactivated = row_count;
    update public.debtor_contact set active=false where active and id in
      (select value::bigint from jsonb_array_elements_text(job.document->'absent'->'contacts'));
    get diagnostics contact_deactivated = row_count;
    tally_value := equitas_import_private.tally(tally_value,'debtor_person','actualizadas',relation_deactivated);
    tally_value := equitas_import_private.tally(tally_value,'debtor_contact','actualizadas',contact_deactivated);
  end if;
  -- Escribe también debt.status: nunca se llama en staging/preview. Todo sigue en la misma transacción.
  profiles := public.recompute_debtor_profiles(object_ids,(job.document->'identity'->'parameters'->>'as_of')::date,
    (job.document->>'contact_columns_integrated')::boolean);
  foreach outcome in array array['insertadas','actualizadas','sin_cambios'] loop
    tally_value := equitas_import_private.tally(tally_value,'debtor_profile',outcome,(profiles->>outcome)::bigint);
  end loop;
  tally_value := equitas_import_private.tally(tally_value,'debt','actualizadas',(profiles->>'deudas_reclasificadas')::bigint);
  tally_value := equitas_import_private.tally(tally_value,'debtor_profile_detail','actualizadas',(profiles->>'detalles_actualizados')::bigint);
  for item in select distinct (x->>'debtor')::bigint debtor,(x->>'person')::bigint person from jsonb_array_elements(links) x order by 1,2 loop
    select id into strict profile_id from public.debtor_profile where debtor=item.debtor;
    result_row := equitas_import_private.upsert_row('debtor_profile_detail',jsonb_build_object('debtor_profile',profile_id,
      'person',item.person,'risk_value',null,'reason','Índice heredado no calculado: la severidad la calculan las reglas v1.','active',true),array['debtor_profile','person']);
    tally_value := equitas_import_private.tally(tally_value,'debtor_profile_detail',result_row->>'outcome');
  end loop;
  -- Publicar también avanza la versión cuando todos los valores de cartera eran
  -- iguales: otra revisión anterior no puede confirmar sobre ese mismo objeto.
  update equitas_import_private.object_version v set version=v.version+1,
    last_as_of=(job.document->'identity'->'parameters'->>'as_of')::date
    from public.debtor d where d.id=any(object_ids) and (v.tenant,v.object_type,v.external_id)=(d.tenant,coalesce(d.type,0),d.external_id);
  loaded := jsonb_build_object('objetos_publicados',object_count,'relaciones_publicadas',relation_count,
    'deudas_publicadas',debt_count,'deudas_insertadas',debt_inserted,'deudas_actualizadas',debt_updated,'deudas_sin_cambios',debt_same,
    'direcciones_publicadas',address_count,'contactos_publicados',contact_count,'perfiles_publicados',object_count,
    'bajas_relaciones',relation_deactivated,'bajas_contactos',contact_deactivated,'escrituras',tally_value);
  foreach outcome in array array['insertadas','actualizadas','sin_cambios'] loop
    select coalesce(sum((value->>outcome)::bigint),0) into counter from jsonb_each(tally_value);
    loaded := loaded || jsonb_build_object('filas_'||outcome,counter);
  end loop;
  return loaded;
end $$;

create function public.publish_import_batch(p_batch_id bigint,p_idempotency_key text,p_revision text,
  p_tenant bigint,p_actor_user bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job public.import_publication; people bigint[]; current_payload jsonb; counts_value jsonb; published_id bigint; receipt_value jsonb;
begin
  perform equitas_import_private.authorize(p_actor_user,p_tenant);
  select * into job from public.import_publication where batch_id=p_batch_id and tenant=p_tenant;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if job.status='PUBLICADO' then
    if job.idempotency_key is distinct from p_idempotency_key or job.revision is distinct from p_revision then raise exception 'IDEMPOTENCY_KEY_CONFLICT'; end if;
    return job.result;
  end if;
  select coalesce(array_agg((x->>0)::bigint),'{}') into people from jsonb_array_elements(job.versions->'people') x;
  perform equitas_import_private.lock_scope(p_tenant,people);
  select * into strict job from public.import_publication where batch_id=p_batch_id for update;
  if job.status='PUBLICADO' then
    if job.idempotency_key is distinct from p_idempotency_key or job.revision is distinct from p_revision then raise exception 'IDEMPOTENCY_KEY_CONFLICT'; end if;
    return job.result;
  end if;
  if job.status in ('FALLIDO','DESCARTADO','REQUIERE_NUEVO_PREVIEW') then return equitas_import_private.receipt(p_batch_id); end if;
  if job.status<>'VALIDADO' then raise exception 'BATCH_NOT_VALIDATED'; end if;
  if job.expires_at<=now() then
    perform equitas_import_private.event(p_batch_id,'DESCARTADO',job.document->'counts');
    update public.import_publication set result=jsonb_build_object('batch_id',job.batch_id,
      'idempotency_key',job.idempotency_key,'revision',job.revision,'status','DESCARTADO',
      'reason','TTL_EXPIRED','counts',job.document->'counts') where batch_id=p_batch_id;
    return equitas_import_private.receipt(p_batch_id);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'payload',payload) order by row_number),'[]'::jsonb)
    into current_payload from public.import_row_staging where batch_id=p_batch_id;
  if job.idempotency_key is distinct from p_idempotency_key or job.revision is distinct from p_revision
    or job.payload_hash is distinct from equitas_import_private.digest(current_payload)
    or job.versions is distinct from equitas_import_private.versions(p_tenant,people) then
    perform equitas_import_private.event(p_batch_id,'REQUIERE_NUEVO_PREVIEW',job.document->'counts');
    return equitas_import_private.receipt(p_batch_id);
  end if;
  update public.import_publication set actor=p_actor_user where batch_id=p_batch_id;
  perform equitas_import_private.event(p_batch_id,'CONFIRMADO',job.document->'counts');
  counts_value := job.document->'counts' || equitas_import_private.write_rows(p_batch_id);
  -- Persistir el recibo y PUBLICADO antes del COMMIT de esta misma llamada: O5 de 031.
  published_id := equitas_import_private.event(p_batch_id,'PUBLICADO',counts_value);
  receipt_value := jsonb_build_object('batch_id',p_batch_id,'published_event_id',published_id,
    'idempotency_key',job.idempotency_key,'revision',job.revision,'status','PUBLICADO','counts',counts_value,
    'object_cutoffs',coalesce((select jsonb_agg(jsonb_build_object('type',v.object_type,'external_id',v.external_id,
      'as_of',v.last_as_of) order by v.object_type,v.external_id) from equitas_import_private.object_version v
      join public.debtor d on (d.tenant,coalesce(d.type,0),d.external_id)=(v.tenant,v.object_type,v.external_id)
      where v.tenant=p_tenant),'[]'::jsonb));
  update public.import_publication set result=receipt_value where batch_id=p_batch_id;
  return receipt_value;
exception when others then
  if sqlerrm in ('ACTOR_NOT_ACTIVE_MEMBER','ROLE_NOT_ALLOWED','BATCH_NOT_FOUND','BATCH_NOT_VALIDATED',
    'IDEMPOTENCY_KEY_CONFLICT','SHARED_PERSON_OTHER_TENANT') then raise exception '%',sqlerrm; end if;
  raise exception 'IMPORT_PUBLICATION_FAILED';
end $$;

create function public.settle_import_batch(p_batch_id bigint,p_idempotency_key text,p_revision text,
  p_tenant bigint,p_actor_user bigint,p_status text default 'FALLIDO') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job public.import_publication; receipt_value jsonb;
begin
  perform equitas_import_private.authorize(p_actor_user,p_tenant);
  if p_status not in ('FALLIDO','DESCARTADO') then raise exception 'IMPORT_INPUT_INVALID'; end if;
  -- La publicación tiene este lock hasta COMMIT/ROLLBACK. Ni timeout ni 5xx autorizan
  -- a inventar FALLIDO: esperar y consultar el resultado persistido es la autoridad.
  perform pg_advisory_xact_lock(hashtextextended(format('import_batch:%s',p_tenant),0));
  select * into job from public.import_publication where batch_id=p_batch_id and tenant=p_tenant for update;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if job.idempotency_key is distinct from p_idempotency_key or job.revision is distinct from p_revision then raise exception 'IMPORT_REVISION_CONFLICT'; end if;
  if job.status in ('PUBLICADO','FALLIDO','DESCARTADO','REQUIERE_NUEVO_PREVIEW') then return equitas_import_private.receipt(p_batch_id); end if;
  receipt_value := equitas_import_private.receipt(p_batch_id) || jsonb_build_object('status',p_status);
  perform equitas_import_private.event(p_batch_id,p_status,job.document->'counts');
  update public.import_publication set result=receipt_value where batch_id=p_batch_id;
  return receipt_value;
end $$;

create function equitas_import_private.purge(p_now timestamptz) returns bigint
language plpgsql set search_path = '' as $$
declare item record; job public.import_publication; purged bigint := 0;
begin
  -- Reloj recibido por el helper interno; la RPC pública siempre usa el reloj de DB.
  for item in select batch_id,tenant from public.import_publication where expires_at<=p_now
    and status in ('RECIBIDO','VALIDADO','CONFIRMADO','REQUIERE_NUEVO_PREVIEW') order by tenant,batch_id loop
    perform pg_advisory_xact_lock(hashtextextended(format('import_batch:%s',item.tenant),0));
    select * into strict job from public.import_publication where batch_id=item.batch_id for update;
    if job.expires_at<=p_now and job.status in ('RECIBIDO','VALIDADO','CONFIRMADO','REQUIERE_NUEVO_PREVIEW') then
      -- El actor puede haberse desactivado: la limpieza no vuelve a autorizar acciones de negocio.
      perform equitas_import_private.event(item.batch_id,'DESCARTADO',coalesce(job.document->'counts','{}'::jsonb));
      update public.import_publication set status='DESCARTADO',document='{}',result=
        jsonb_build_object('batch_id',job.batch_id,'idempotency_key',job.idempotency_key,'revision',job.revision,
          'status','DESCARTADO','reason','TTL_EXPIRED','counts',coalesce(job.document->'counts','{}'::jsonb)) where batch_id=item.batch_id;
      purged := purged+1;
    end if;
  end loop;
  return purged;
end $$;
create function public.purge_import_staging() returns bigint
language sql security definer set search_path = '' as $$
  select equitas_import_private.purge(clock_timestamp())
$$;

-- Propietario aislado y cierre explícito del EXECUTE predeterminado de PostgreSQL.
-- Solo authenticator puede asumir el rol importador, nunca este definidor.
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='equitas_import_private' or (n.nspname='public' and p.proname in
      ('stage_import_batch','publish_import_batch','settle_import_batch','purge_import_staging')) loop
    execute format('alter function %s owner to equitas_import_definer',f.signature);
    execute format('revoke all on function %s from public, anon, authenticated, service_role, equitas_review_server, equitas_import_server, postgres',f.signature);
  end loop;
end $$;
revoke all on function public.guard_atomic_import_event() from public, anon, authenticated, service_role;
grant execute on function public.stage_import_batch(bigint,bigint,jsonb,jsonb,text),
  public.publish_import_batch(bigint,text,text,bigint,bigint),
  public.settle_import_batch(bigint,text,text,bigint,bigint,text),public.purge_import_staging() to equitas_import_server;
revoke create on schema public from equitas_import_definer;

-- El selector mantiene el cierre conservador de cargas legacy. Un lote 032 sin
-- PUBLICADO no modifica la cartera, por lo que staging/rollback no retiran el corte.
grant equitas_write_definer to postgres;
create or replace function public.equitas_current_cutoff(p_tenant bigint) returns bigint
language sql stable set search_path = '' as $$
  select case when e.status='PUBLICADO' then e.id end from public.import_batch e
  where e.tenant=p_tenant
    and not exists(select 1 from public.import_batch s where s.tenant=e.tenant and s.supersedes=e.id)
    and (e.status='PUBLICADO' or (e.counts->'publicacion_atomica' is distinct from '1'::jsonb
      and (e.status in ('VALIDADO','CONFIRMADO') or (e.status='FALLIDO' and e.supersedes is not null))))
  order by e.id desc limit 1
$$;
revoke equitas_write_definer from postgres;

-- TTL efectivo aunque no lleguen nuevas importaciones. El job solo llama la RPC
-- sin parámetros de reloj, con timeout acotado y sin secretos en cron.job.
create extension if not exists pg_cron with schema pg_catalog;
grant execute on function public.purge_import_staging() to postgres;
revoke equitas_import_definer from postgres;
select cron.schedule('equitas-import-staging-ttl','* * * * *',
  $$set statement_timeout='45s'; select public.purge_import_staging();$$);
notify pgrst, 'reload schema';
notify pgrst, 'reload config';
