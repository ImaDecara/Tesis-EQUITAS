-- ALIGN-018. Verificacion de politicas y privilegios: solo metadatos y conteos, sin filas ni valores.
-- psql -At -F '|' -f database/testing/case-review-verify.sql. Esperados en SUPABASE_TESTING_CALIDAD.md.
-- Solo lectura. Tambien corre antes de la migracion: politicas_23_md5, grants_23_md5 y acl_23_md5 son la base de comparacion.
with nueva(nombre) as (
  values ('case_review'), ('case_review_approval'), ('import_batch')
), existente(nombre) as (
  values ('address'), ('city'), ('contact_type'), ('currency'), ('data_source'), ('data_source_type'), ('debt'), ('debt_status'),
    ('debtor'), ('debtor_contact'), ('debtor_person'), ('debtor_profile'), ('debtor_profile_detail'), ('debtor_type'), ('document_type'),
    ('person'), ('person_status'), ('person_type'), ('province'), ('role'), ('tenant'), ('tenant_user'), ('user')
), tabla_nueva as (
  select c.oid, c.relname as nombre, c.relrowsecurity as rls, c.relforcerowsecurity as forzada,
    (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text::bigint as filas,
    (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I where supersedes >= id', c.relname), false, true, '')))[1]::text::bigint as filas_cadena_invalida
  from pg_class c join pg_namespace n on n.oid = c.relnamespace join nueva on nueva.nombre = c.relname
  where n.nspname = 'public' and c.relkind = 'r'
), politica_nueva as (
  select p.* from pg_policies p join nueva on nueva.nombre = p.tablename where p.schemaname = 'public'
), politica_existente as (
  select p.* from pg_policies p join existente on existente.nombre = p.tablename where p.schemaname = 'public'
), rol_cliente(rol) as (
  values ('anon'), ('authenticated'), ('service_role'), ('equitas_review_server'), ('equitas_import_server')
), rol_presente as (
  select rol from rol_cliente where exists(select 1 from pg_roles r where r.rolname = rol)
), privilegio(p) as (
  values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')
), funcion as (
  select f.oid, f.proname, f.prosecdef as definer, f.proconfig, f.proowner, f.proacl
  from pg_proc f where f.pronamespace = 'public'::regnamespace
    and f.proname in ('record_case_review', 'record_case_review_approval', 'read_case_review_reason_text', 'record_import_batch', 'equitas_member_role', 'equitas_append_only')
), funcion_servidor as (
  select * from funcion where definer
), rol_nuevo(rol) as (
  values ('equitas_write_definer'), ('equitas_review_server'), ('equitas_import_server')
), membresia_nueva as (
  select r.rolname as rol, m.rolname as miembro, a.admin_option, a.inherit_option, a.set_option
  from pg_auth_members a join pg_roles r on r.oid = a.roleid join pg_roles m on m.oid = a.member join rol_nuevo on rol_nuevo.rol = r.rolname
), restriccion_nueva as (
  select k.conname from pg_constraint k join tabla_nueva t on t.oid = k.conrelid where k.contype = 'c' and k.convalidated
)
select 'migraciones', (select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations)
union all select 'tablas_nuevas', count(*)::text from tabla_nueva
union all select 'tablas_nuevas_con_rls', count(*) filter (where rls)::text from tabla_nueva
union all select 'tablas_nuevas_sin_rls', count(*) filter (where not rls)::text from tabla_nueva
union all select 'politicas_nuevas', count(*)::text from politica_nueva
union all select 'politicas_nuevas_using_true', count(*) filter (where lower(btrim(qual)) in ('true', '(true)') or lower(btrim(with_check)) in ('true', '(true)'))::text from politica_nueva
union all select 'politicas_nuevas_no_select', count(*) filter (where cmd <> 'SELECT')::text from politica_nueva
union all select 'politicas_nuevas_anon_o_public', count(*) filter (where roles && array['anon', 'public']::name[])::text from politica_nueva
union all select 'politicas_nuevas_sin_tenant', count(*) filter (where qual is null or qual not like '%tenant%')::text from politica_nueva
union all select 'privilegios_escritura_clientes', count(*) filter (where has_table_privilege(r.rol, t.oid, a.p))::text
  from rol_presente r cross join tabla_nueva t cross join privilegio a
union all select 'privilegios_definidor_distintos_de_insert', (select count(*)::text from tabla_nueva t cross join privilegio a
  where a.p <> 'INSERT' and exists(select 1 from pg_roles where rolname = 'equitas_write_definer') and has_table_privilege('equitas_write_definer', t.oid, a.p))
union all select 'select_tabla_anon_authenticated', count(*)::text from information_schema.role_table_grants g join nueva on nueva.nombre = g.table_name
  where g.table_schema = 'public' and g.grantee in ('anon', 'authenticated') and g.privilege_type = 'SELECT'
union all select 'reason_text_legible_por_clientes', count(*) filter (where has_column_privilege(r.rol, t.oid, 'reason_text', 'SELECT'))::text
  from rol_presente r join tabla_nueva t on t.nombre = 'case_review'
union all select 'columnas_case_review_legibles_authenticated', count(*)::text from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'case_review' and grantee = 'authenticated' and privilege_type = 'SELECT'
union all select 'secuencias_nuevas_privilegios_clientes', count(*)::text from pg_class c
  join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a
  where n.nspname = 'public' and c.relkind = 'S' and c.relname in ('case_review_id_seq', 'case_review_approval_id_seq', 'import_batch_id_seq')
    and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated', 'service_role', 'equitas_review_server', 'equitas_import_server')))
union all select 'funciones_security_definer', count(*)::text from funcion_servidor
union all select 'funciones_sin_search_path_vacio', count(*) filter (where proconfig is null or not ('search_path=""' = any(proconfig)))::text from funcion
union all select 'funciones_definer_dueno_definidor', count(*) filter (where pg_get_userbyid(proowner) = 'equitas_write_definer')::text from funcion_servidor
union all select 'funciones_ejecutables_public', count(*) filter (where proacl is null or exists(select 1 from aclexplode(proacl) a where a.grantee = 0))::text from funcion
union all select 'funciones_ejecutables_anon_authenticated_service', count(*) filter (where has_function_privilege(r.rol, f.oid, 'EXECUTE'))::text
  from funcion f cross join (values ('anon'), ('authenticated'), ('service_role')) r(rol)
union all select 'funciones_servidor_revision', count(*) filter (where exists(select 1 from pg_roles where rolname = 'equitas_review_server') and has_function_privilege('equitas_review_server', f.oid, 'EXECUTE'))::text from funcion f
union all select 'funciones_servidor_importacion', count(*) filter (where exists(select 1 from pg_roles where rolname = 'equitas_import_server') and has_function_privilege('equitas_import_server', f.oid, 'EXECUTE'))::text from funcion f
union all select 'roles_servidor_con_login_o_bypass', count(*)::text from pg_roles
  where rolname in ('equitas_review_server', 'equitas_import_server') and (rolcanlogin or rolbypassrls or rolsuper or rolcreaterole or rolcreatedb)
union all select 'rol_definidor_con_login_o_super', count(*)::text from pg_roles
  where rolname = 'equitas_write_definer' and (rolcanlogin or rolsuper or rolcreaterole or rolcreatedb)
union all select 'definidor_miembros_con_set_o_inherit', count(*)::text from membresia_nueva where rol = 'equitas_write_definer' and (set_option or inherit_option)
union all select 'roles_nuevos_miembros_con_set_o_inherit', coalesce(string_agg(rol || '>' || miembro, ',' order by rol, miembro), '') from membresia_nueva where set_option or inherit_option
union all select 'roles_nuevos_miembros_con_admin_option', coalesce(string_agg(rol || '>' || miembro, ',' order by rol, miembro), '') from membresia_nueva where admin_option
union all select 'definidor_create_en_public', (select count(*)::text from pg_roles where rolname = 'equitas_write_definer' and has_schema_privilege(rolname, 'public', 'CREATE'))
union all select 'grants_columna_definidor_en_existentes', (select count(*)::text from information_schema.column_privileges g join existente on existente.nombre = g.table_name
  where g.table_schema = 'public' and g.grantee = 'equitas_write_definer')
union all select 'grants_columna_clientes_en_existentes', (select count(*)::text from pg_attribute a join pg_class c on c.oid = a.attrelid join existente on existente.nombre = c.relname, aclexplode(a.attacl) x
  where c.relnamespace = 'public'::regnamespace and (x.grantee = 0 or pg_get_userbyid(x.grantee) in ('anon', 'authenticated', 'service_role', 'equitas_review_server', 'equitas_import_server')))
union all select 'restricciones_supersedes_anterior', count(*)::text from restriccion_nueva where conname like '%\_supersedes\_anterior'
union all select 'restricciones_reason_text', coalesce(string_agg(conname, ',' order by conname), '') from restriccion_nueva where conname like 'case\_review\_reason\_text\_%'
union all select 'filas_con_cadena_invalida', coalesce(sum(filas_cadena_invalida), 0)::text from tabla_nueva
union all select 'triggers_append_only', count(*)::text from pg_trigger g join tabla_nueva t on t.oid = g.tgrelid
  where not g.tgisinternal and (g.tgname like '%\_append\_only' or g.tgname like '%\_no\_truncate')
union all select 'politicas_23', count(*)::text from politica_existente
union all select 'politicas_23_md5', md5(coalesce(string_agg(concat_ws('~', tablename, policyname, permissive, roles::text, cmd, qual, with_check), '|' order by tablename, policyname), '')) from politica_existente
union all select 'grants_23_md5', md5(coalesce(string_agg(concat_ws('~', g.table_name, g.grantee, g.privilege_type), '|' order by g.table_name, g.grantee, g.privilege_type), ''))
  from information_schema.role_table_grants g join existente on existente.nombre = g.table_name
  where g.table_schema = 'public' and g.grantee in ('anon', 'authenticated', 'service_role')
union all select 'acl_23_md5', md5(string_agg(c.relname || '=' || coalesce(c.relacl::text, ''), '|' order by c.relname))
  from pg_class c join existente on existente.nombre = c.relname where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
union all select 'filas_por_tabla_nueva', coalesce(string_agg(nombre || '=' || filas, ',' order by nombre), '') from tabla_nueva
union all select 'filas_nuevas_total', coalesce(sum(filas), 0)::text from tabla_nueva
union all select 'tenants_reservados_a018', (select count(*)::text from public.tenant where id between 920001 and 920099)
union all select 'usuarios_auth_a018', (select count(*)::text from auth.users where email like 'tp-a018-%@example.test');
