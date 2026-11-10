-- EQUITAS — registro de la cartera YA cargada (noche 7, encargo 10.4). Requiere paquete-minimo.sql.
-- Probado SOLO en el espejo local.
--
-- PROBLEMA: las decisiones se atan a un lote con fecha de corte, y una base cargada antes de que existiera
-- import_batch no tiene ninguno. No se inventa procedencia: no hay archivo, ni huella de archivo, ni fecha de corte.
--
-- MECANISMO: una función que registra UN lote de origen CARTERA_HEREDADA, una sola vez por municipio y solo si
-- ese municipio no tiene ningún lote.
--   · La HUELLA y los CONTEOS los calcula la función sobre el contenido real de la cartera en ese momento. La clave
--     de la huella se llama «contenido_al_registrar»: dice qué es, y no pretende ser la huella de un archivo.
--   · La FECHA DE CORTE la declara una persona responsable, con rol ADMIN y membresía activa en el municipio.
--     Queda guardada como declarada (counts.fecha_declarada = 1) y la aplicación la muestra así.
--   · Solo la puede ejecutar quien administra la base (desde el editor SQL): no está expuesta a la aplicación.
--
-- USO, una vez por municipio (reemplazar los tres valores):
--   select public.register_inherited_portfolio(
--     p_actor_user := <id en public."user" de la persona ADMIN responsable>,
--     p_tenant := <id del municipio>,
--     p_declared_as_of := date '<fecha a la que corresponden los importes y estados cargados>',
--     p_rules_version := '1.1.0');

begin;

create or replace function public.register_inherited_portfolio(p_actor_user bigint, p_tenant bigint, p_declared_as_of date, p_rules_version text)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_role text;
  v_counts jsonb;
  v_hash text;
  v_id bigint;
begin
  -- El mismo cerrojo por municipio que usan las decisiones: nadie registra una decisión mientras se crea el lote.
  perform pg_advisory_xact_lock(hashtextextended(format('import_batch:%s', p_tenant), 0));
  -- Misma condición que public.equitas_member_role (membresía, usuario y municipio activos), escrita acá porque
  -- esa función solo la ejecuta el definidor y esta la corre quien administra la base.
  select r.name into v_role
  from public.tenant_user tu join public."user" u on u.id = tu."user" join public.tenant t on t.id = tu.tenant join public.role r on r.id = tu.role
  where tu.tenant = p_tenant and tu."user" = p_actor_user and tu.status and u.status = 'ACTIVE' and t.status = 'ACTIVE';
  if v_role is null then raise exception 'ACTOR_NOT_ACTIVE_MEMBER'; end if;
  if v_role <> 'ADMIN' then raise exception 'ROLE_NOT_ALLOWED'; end if;
  if p_declared_as_of is null or p_declared_as_of > current_date then raise exception 'DECLARED_DATE_INVALID'; end if;
  if exists (select 1 from public.import_batch b where b.tenant = p_tenant) then raise exception 'PORTFOLIO_ALREADY_REGISTERED'; end if;
  if not exists (select 1 from public.debtor d where d.tenant = p_tenant) then raise exception 'PORTFOLIO_EMPTY'; end if;

  select jsonb_build_object(
    'objetos', (select count(*) from public.debtor d where d.tenant = p_tenant),
    'obligaciones', (select count(*) from public.debt o join public.debtor d on d.id = o.debtor where d.tenant = p_tenant),
    'personas', (select count(distinct l.person) from public.debtor_person l join public.debtor d on d.id = l.debtor where d.tenant = p_tenant),
    'fecha_declarada', 1) into v_counts;

  -- Huella SHA-256 del contenido: objetos, obligaciones y vínculos del municipio, en orden estable.
  -- Sin nombres, documentos ni contactos: identifica QUÉ cartera se registró, no a quién pertenece.
  select encode(sha256(convert_to(
    coalesce((select string_agg(concat_ws('|', 'O', d.id, d.external_id, d.type, d.identifier, d.status), E'\n' order by d.id)
              from public.debtor d where d.tenant = p_tenant), '') || E'\n' ||
    coalesce((select string_agg(concat_ws('|', 'D', o.id, o.debtor, o.external_id, o.original_amount, o.current_amount, o.updated_amount,
                                           o.due_date, o.status), E'\n' order by o.id)
              from public.debt o join public.debtor d on d.id = o.debtor where d.tenant = p_tenant), '') || E'\n' ||
    coalesce((select string_agg(concat_ws('|', 'V', l.id, l.debtor, l.person, l.active), E'\n' order by l.id)
              from public.debtor_person l join public.debtor d on d.id = l.debtor where d.tenant = p_tenant), ''), 'UTF8')), 'hex')
  into v_hash;

  insert into public.import_batch(tenant, source, file_hashes, as_of, rules_version, counts, status, created_by, created_by_role, idempotency_key)
  values (p_tenant, 'CARTERA_HEREDADA', jsonb_build_object('contenido_al_registrar', v_hash), p_declared_as_of, p_rules_version,
          v_counts, 'PUBLICADO', p_actor_user, v_role, gen_random_uuid())
  returning id into v_id;

  return jsonb_build_object('batch_id', v_id, 'as_of', p_declared_as_of, 'counts', v_counts, 'contenido_al_registrar', v_hash);
end $function$;

comment on function public.register_inherited_portfolio(bigint, bigint, date, text) is
  'Registra una sola vez la cartera cargada antes de import_batch como lote CARTERA_HEREDADA: huella y conteos calculados, fecha declarada por una persona ADMIN.';

-- Solo quien administra la base: ni la aplicación ni la Data API.
revoke all on function public.register_inherited_portfolio(bigint, bigint, date, text) from public, anon, authenticated, service_role;

commit;

notify pgrst, 'reload schema';
