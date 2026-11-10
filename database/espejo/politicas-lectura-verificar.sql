-- EQUITAS — verificación de SOLO LECTURA de las políticas de lectura (noche 7, encargo 10.5).
-- Se corre antes y después de politicas-lectura.sql. La comprobación de qué lee cada cuenta se hace por la Data API
-- real, con la sesión de cada una: `equitas_espejo.py probar-lectura`.

-- 1. Políticas de lectura por tipo.
select count(*) filter (where qual = 'true') as abiertas, count(*) filter (where qual <> 'true') as con_condicion,
       count(*) as total from pg_policies where schemaname = 'public' and cmd = 'SELECT'
  and tablename not in ('import_batch', 'case_review', 'case_review_approval', 'access_audit');

-- 2. Tablas de la aplicación donde «authenticated» todavía puede escribir.
select count(*) filter (where has_table_privilege('authenticated', c.oid, 'insert')) as con_insert,
       count(*) filter (where has_table_privilege('authenticated', c.oid, 'update')) as con_update,
       count(*) filter (where has_table_privilege('authenticated', c.oid, 'delete')) as con_delete
from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  and c.relname not in ('import_batch', 'case_review', 'case_review_approval', 'access_audit');

-- 3. A quién deja de servirle la política abierta: cuentas que hoy pueden iniciar sesión y NO tienen una membresía activa.
--    Solo conteos, sin correos ni nombres.
select (select count(*) from public."user") as usuarios_de_aplicacion,
       (select count(*) from public."user" u where u.status = 'ACTIVE'
          and exists (select 1 from public.tenant_user tu join public.tenant t on t.id = tu.tenant
                      where tu."user" = u.id and tu.status and t.status = 'ACTIVE')) as con_membresia_activa,
       (select count(*) from public."user" u where not exists (select 1 from public.tenant_user tu join public.tenant t on t.id = tu.tenant
                      where tu."user" = u.id and tu.status and t.status = 'ACTIVE') or u.status <> 'ACTIVE') as sin_membresia_activa,
       (select count(*) from public."user" u where u.auth_user is null) as sin_cuenta_de_autenticacion;

-- 4. Membresías por rol y estado (los roles salen del catálogo; no se listan personas).
select r.name as rol, tu.status as membresia_activa, count(*) as membresias
from public.tenant_user tu join public.role r on r.id = tu.role group by 1, 2 order by 1, 2;
