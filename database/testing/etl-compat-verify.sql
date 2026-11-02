-- ALIGN-017. Verificacion de la base local: solo metadatos y conteos, sin filas ni valores.
-- psql -At -F '|' -f database/testing/etl-compat-verify.sql. Esperados en SUPABASE_TESTING_CALIDAD.md.
-- Solo lectura: tambien sirve antes de la migracion (estado de 20261021221030).
with tabla as (
  select c.relname as nombre, c.relrowsecurity as rls,
    (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text::bigint as filas
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
), identidad as (
  select t.nombre, pg_get_serial_sequence(format('public.%I', t.nombre), 'id') as secuencia
  from tabla t join information_schema.columns k on k.table_schema = 'public' and k.table_name = t.nombre
  where k.column_name = 'id' and k.is_identity = 'YES'
), proximo as (
  select i.nombre,
    (xpath('/row/n/text()', query_to_xml(format('select case when is_called then last_value + 1 else last_value end as n from %s', i.secuencia), false, true, '')))[1]::text::bigint as siguiente,
    (xpath('/row/n/text()', query_to_xml(format('select coalesce(max(id), 0) as n from public.%I', i.nombre), false, true, '')))[1]::text::bigint as maximo
  from identidad i
), politica as (
  select * from pg_policies where schemaname = 'public'
), secuencia_acl as (
  select a.grantee from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a
  where n.nspname = 'public' and c.relkind = 'S'
)
select 'migraciones', (select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations)
union all select 'tablas_public', count(*)::text from tabla
union all select 'tablas_con_rls', count(*) filter (where rls)::text from tabla
union all select 'politicas', count(*)::text from politica
union all select 'politicas_using_true', count(*) filter (where qual = 'true' or with_check = 'true')::text from politica
union all select 'politicas_no_select', count(*) filter (where cmd <> 'SELECT')::text from politica
union all select 'politicas_anon_o_public', count(*) filter (where roles && array['anon', 'public']::name[])::text from politica
union all select 'politicas_md5', md5(coalesce(string_agg(concat_ws('~', tablename, policyname, permissive, roles::text, cmd, qual, with_check), '|' order by tablename, policyname), '')) from politica
union all select 'grants_escritura_anon_authenticated', count(*)::text from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'
union all select 'grants_tablas_md5', md5(coalesce(string_agg(concat_ws('~', table_name, grantee, privilege_type), '|' order by table_name, grantee, privilege_type), ''))
  from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
union all select 'grants_secuencias_anon_authenticated_public', count(*)::text from secuencia_acl
  where grantee = 0 or grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated'))
union all select 'tablas_identity_by_default', count(*)::text from information_schema.columns
  where table_schema = 'public' and column_name = 'id' and is_identity = 'YES' and identity_generation = 'BY DEFAULT'
union all select 'tablas_identity_always', count(*)::text from information_schema.columns
  where table_schema = 'public' and column_name = 'id' and is_identity = 'YES' and identity_generation = 'ALWAYS'
union all select 'tablas_identity', coalesce(string_agg(nombre, ',' order by nombre), '') from identidad
union all select 'secuencias_sin_superar_maximo', count(*) filter (where siguiente <= maximo)::text from proximo
union all select 'debt_updated_amount', (select concat_ws(':', data_type, is_generated, generation_expression, ordinal_position)
  from information_schema.columns where table_schema = 'public' and table_name = 'debt' and column_name = 'updated_amount')
union all select 'external_id_tipos', (select string_agg(table_name || '=' || data_type, ',' order by table_name)
  from information_schema.columns where table_schema = 'public' and column_name = 'external_id')
union all select 'columnas_nulables_etl', (select string_agg(table_name || '.' || column_name || '=' || is_nullable, ',' order by table_name, column_name)
  from information_schema.columns where table_schema = 'public' and (table_name, column_name) in
    (('debtor', 'status'), ('debtor_profile', 'socioeconomic_risk_level'), ('debtor_profile', 'oldest_debt_days'), ('debtor_profile', 'average_debt_age_days'), ('debtor_profile_detail', 'risk_value')))
union all select 'filas_por_tabla', coalesce(string_agg(nombre || '=' || filas, ',' order by nombre), '') from tabla
union all select 'filas_total', coalesce(sum(filas), 0)::text from tabla
union all select 'debt_updated_distinto_current', (select count(*)::text from public.debt where updated_amount is distinct from current_amount)
union all select 'usuarios_auth', (select count(*)::text from auth.users);
