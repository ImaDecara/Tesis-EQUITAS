-- EQUITAS: consultas ejecutadas durante la revisión del 21/10/2026.
-- Solo lectura; no ejecuta migraciones ni modifica filas.
-- Ejecutar contra el proyecto correcto con un rol autorizado para inspección.
-- Las identidades JWT de estas consultas son sintéticas; no son un login real.
-- Cada prueba de roles revierte su configuración local con ROLLBACK.

-- SUP-INT-01: conteos exactos, sin datos personales.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SELECT
  (SELECT count(*) FROM public.tenant) AS tenants,
  (SELECT count(*) FROM public.debtor) AS debtors,
  (SELECT count(*) FROM public.debt) AS debts,
  (SELECT count(*) FROM public.person) AS people,
  (SELECT count(*) FROM public.debtor_profile) AS profiles;
ROLLBACK;

-- SUP-RLS-01: se esperan cero filas de negocio visibles para anon.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL request.jwt.claims = '{"role":"anon"}';
SET LOCAL ROLE anon;
SELECT current_user AS database_role,
       (SELECT count(*) FROM public.debtor) AS visible_debtors,
       (SELECT count(*) FROM public.debt) AS visible_debts,
       (SELECT count(*) FROM public.person) AS visible_people,
       (SELECT count(*) FROM public."user") AS visible_app_users;
ROLLBACK;

-- SUP-RLS-02: se esperan cero filas para una identidad sin pertenencia.
-- Resultado observado: matching_app_users=0, matching_active_memberships=0,
-- visible_debtors=2933, visible_debts=56286, visible_people=2493.
-- Esta expectativa NO se cumple en el estado revisado; ver DEF-SUP-001.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT current_user AS database_role,
       auth.uid() = '00000000-0000-4000-8000-000000000001'::uuid AS synthetic_identity_applied,
       (SELECT count(*) FROM public."user" WHERE auth_user = auth.uid()) AS matching_app_users,
       (SELECT count(*) FROM public.tenant_user tu JOIN public."user" u ON u.id = tu."user" WHERE u.auth_user = auth.uid() AND tu.status = true) AS matching_active_memberships,
       (SELECT count(*) FROM public.debtor) AS visible_debtors,
       (SELECT count(*) FROM public.debt) AS visible_debts,
       (SELECT count(*) FROM public.person) AS visible_people,
       (SELECT count(*) FROM public."user") AS visible_app_users;
ROLLBACK;
