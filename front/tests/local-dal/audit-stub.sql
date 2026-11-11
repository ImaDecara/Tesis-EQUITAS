-- ALIGN-069. SOLO Supabase local, para esta suite. Va despues de fixture.sql.
-- Esta base tiene solo la primera migracion (USING(true)), sin auditoria, y la ficha falla cerrada sin registro.
-- La suite prueba la frontera de lectura de ALIGN-019, no la auditoria (tests/local-audit): basta con que la funcion responda.
-- Con `db reset --local` desaparece. Nunca se aplica fuera de esta base: la migracion real es 20261102170000_access_audit.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='debtor' AND qual='true') THEN
    RAISE EXCEPTION 'Este stub requiere la base local con USING(true)';
  END IF;
END $$;
CREATE ROLE equitas_review_server NOLOGIN NOINHERIT;
GRANT equitas_review_server TO authenticator;
CREATE FUNCTION public.record_access_audit(p_actor_user bigint, p_tenant bigint, p_action text, p_target text, p_idempotency_key uuid, OUT audit_id bigint, OUT created boolean)
  LANGUAGE sql AS $$ SELECT 1::bigint, true $$;
REVOKE ALL ON FUNCTION public.record_access_audit(bigint, bigint, text, text, uuid) FROM public, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_access_audit(bigint, bigint, text, text, uuid) TO equitas_review_server;
COMMIT;
NOTIFY pgrst, 'reload schema';
