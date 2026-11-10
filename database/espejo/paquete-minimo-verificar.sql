-- EQUITAS — verificación de SOLO LECTURA del paquete mínimo (noche 7, encargo 10.3).
-- Se corre ANTES y DESPUÉS de paquete-minimo.sql (y de su reversa) y se comparan las dos salidas.
-- No modifica nada: conviene correrlo dentro de una transacción de solo lectura.

-- 1. Tablas del módulo: existen o no, filas, RLS y políticas.
select name as tabla,
       case when to_regclass('public.' || name) is null then 'no existe' else 'existe' end as estado,
       case when to_regclass('public.' || name) is null then null
            else (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', name), false, true, '')))[1]::text::bigint end as filas,
       (select relrowsecurity from pg_class where oid = to_regclass('public.' || name)) as rls,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = name) as politicas,
       (select count(*) from pg_trigger t where t.tgrelid = to_regclass('public.' || name) and not t.tgisinternal) as disparadores
from unnest(array['import_batch', 'case_review', 'case_review_approval', 'access_audit']) name order by 1;

-- 2. Funciones del módulo: dueño, SECURITY DEFINER, search_path, huella del cuerpo y quién puede ejecutarlas.
select name as funcion, coalesce(p.oid::regprocedure::text, 'no existe') as firma, pg_get_userbyid(p.proowner) as dueno,
       p.prosecdef as definer, p.proconfig as configuracion, left(md5(p.prosrc), 12) as huella_cuerpo,
       (select string_agg(r, ',' order by r) from unnest(array['anon', 'authenticated', 'service_role', 'equitas_review_server']) r
        where has_function_privilege(r, p.oid, 'execute')) as pueden_ejecutar
from unnest(array['equitas_append_only', 'equitas_role_allows', 'equitas_member_role', 'equitas_current_cutoff', 'equitas_verify_cutoff',
                  'record_case_review', 'record_case_review_approval', 'read_case_review_reason_text', 'record_access_audit',
                  'register_inherited_portfolio']) name
left join pg_proc p on p.proname = name and p.pronamespace = 'public'::regnamespace order by 1;

-- 3. Roles del módulo.
select name as rol, r.rolname is not null as existe, r.rolcanlogin as inicia_sesion, r.rolbypassrls as bypassrls,
       (select string_agg(m.rolname, ',' order by m.rolname) from pg_auth_members am join pg_roles m on m.oid = am.member where am.roleid = r.oid) as lo_asumen
from unnest(array['equitas_write_definer', 'equitas_review_server']) name left join pg_roles r on r.rolname = name order by 1;

-- 4. Tipo del módulo y único cambio sobre una tabla existente.
select 'tipo case_review_checklist' as objeto, exists(select 1 from pg_type where typname = 'case_review_checklist' and typnamespace = 'public'::regnamespace) as existe
union all
select 'restricción debtor_tenant_id_key', exists(select 1 from pg_constraint where conrelid = 'public.debtor'::regclass and conname = 'debtor_tenant_id_key');

-- 5. Tablas EXISTENTES: nada debe cambiar salvo una restricción más en debtor (71 -> 72).
--    Columnas, restricciones, políticas e índices de las 23 tablas originales, con una huella de sus definiciones.
with original as (
  select c.oid, c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
    and c.relname not in ('import_batch', 'case_review', 'case_review_approval', 'access_audit'))
select (select count(*) from original) as tablas,
       (select count(*) from information_schema.columns k join original o on o.relname = k.table_name where k.table_schema = 'public') as columnas,
       (select left(md5(string_agg(k.table_name || '.' || k.column_name || ':' || k.data_type || ':' || k.is_nullable || ':' || coalesce(k.column_default, ''), ';'
                order by k.table_name, k.ordinal_position)), 12)
        from information_schema.columns k join original o on o.relname = k.table_name where k.table_schema = 'public') as huella_columnas,
       (select count(*) from pg_constraint k join original o on o.oid = k.conrelid) as restricciones,
       (select count(*) from pg_policies p join original o on o.relname = p.tablename where p.schemaname = 'public') as politicas,
       (select left(md5(string_agg(p.tablename || ':' || p.policyname || ':' || p.cmd || ':' || coalesce(p.qual, ''), ';' order by p.tablename, p.policyname)), 12)
        from pg_policies p join original o on o.relname = p.tablename where p.schemaname = 'public') as huella_politicas,
       (select count(*) from pg_index i join original o on o.oid = i.indrelid) as indices;

-- 6. Tablas de membresía: de ellas depende quién es ADMIN. Tienen que tener RLS activo y ninguna política de
--    escritura para roles de cliente; si no, el paquete se niega a instalarse (PAQUETE_BASE_INSEGURA).
select c.relname as tabla, c.relrowsecurity as rls,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.cmd <> 'SELECT'
          and p.roles && array['public', 'anon', 'authenticated']::name[]) as politicas_de_escritura_de_cliente,
       has_table_privilege('authenticated', c.oid, 'insert') or has_table_privilege('authenticated', c.oid, 'update')
         or has_table_privilege('authenticated', c.oid, 'delete') as authenticated_tiene_permiso_de_escritura
from pg_class c where c.oid = any (array['public.tenant_user', 'public."user"', 'public.role', 'public.tenant']::regclass[]) order by 1;

-- 7. La cartera no se toca: mismos conteos antes y después.
select (select count(*) from public.debtor) as objetos, (select count(*) from public.debt) as obligaciones,
       (select count(*) from public.person) as personas, (select count(*) from public.tenant_user) as membresias,
       (select count(*) from public.role) as roles_del_catalogo;
