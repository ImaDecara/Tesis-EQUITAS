-- EQUITAS — reversa completa de paquete-minimo.sql y cartera-heredada.sql (noche 7, encargo 10.3).
-- Probada SOLO en el espejo local. Deja la base como estaba antes del paquete.
--
-- SEGURO: si alguna tabla del módulo tiene filas (decisiones, aprobaciones, lotes o registros de acceso), la
-- reversa FALLA sin cambiar nada y dice cuántas son. Para borrarlas a sabiendas hay que ejecutar antes, en la
-- misma sesión, con ESE número exacto:
--     set equitas.confirmar_borrado = '<cantidad de filas que informó el intento anterior>';
-- Borrar esas filas es irreversible: son el registro de lo que decidieron personas. La confirmación se limpia al
-- terminar para que no quede puesta en una conexión reutilizada.

begin;

-- Nadie puede registrar nada mientras se cuenta y se borra.
do $$
declare t text;
begin
  foreach t in array array['case_review_approval', 'case_review', 'access_audit', 'import_batch'] loop
    if to_regclass('public.' || t) is not null then
      execute format('lock table public.%I in access exclusive mode', t);
    end if;
  end loop;
end $$;

do $$
declare t text; n bigint; total bigint := 0;
begin
  foreach t in array array['case_review_approval', 'case_review', 'access_audit', 'import_batch'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into n;
      total := total + n;
    end if;
  end loop;
  if total > 0 and coalesce(current_setting('equitas.confirmar_borrado', true), '') <> total::text then
    raise exception 'REVERSA_CON_DATOS: las tablas del módulo tienen % fila(s). No se cambió nada. Ver el encabezado del archivo.', total;
  end if;
end $$;

drop function if exists public.register_inherited_portfolio(bigint, bigint, date, text);
drop table if exists public.case_review_approval;
drop table if exists public.case_review;
drop table if exists public.access_audit;
drop table if exists public.import_batch;
drop function if exists public.record_access_audit(bigint, bigint, text, text, uuid);
drop function if exists public.read_case_review_reason_text(bigint, bigint, bigint);
drop function if exists public.record_case_review_approval(bigint, bigint, bigint, text, uuid, bigint, text, jsonb, bigint);
drop function if exists public.record_case_review(bigint, bigint, bigint, bigint, text, date, text, text, integer, jsonb, text, uuid, text, integer, text, text, jsonb, bigint);
drop function if exists public.equitas_verify_cutoff(bigint, bigint, date);
drop function if exists public.equitas_current_cutoff(bigint);
drop function if exists public.equitas_member_role(bigint, bigint);
drop function if exists public.equitas_role_allows(text, text);
drop function if exists public.equitas_append_only();
drop domain if exists public.case_review_checklist;

-- Los roles: primero se retira lo que el paquete les otorgó sobre tablas existentes, después el rol.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'equitas_write_definer') then
    revoke select (id, tenant) on public.debtor from equitas_write_definer;
    revoke select (id, name) on public.role from equitas_write_definer;
    revoke select (id, status) on public.tenant from equitas_write_definer;
    revoke select (tenant, "user", role, status) on public.tenant_user from equitas_write_definer;
    revoke select (id, status) on public."user" from equitas_write_definer;
    revoke create on schema public from equitas_write_definer;
    drop role equitas_write_definer;
  end if;
  if exists (select 1 from pg_roles where rolname = 'equitas_review_server') then
    revoke equitas_review_server from authenticator;
    drop role equitas_review_server;
  end if;
end $$;

-- El único cambio sobre una tabla existente: se quita SOLO si lo creó el paquete (lleva su marca). Si la
-- restricción ya existía antes, no tiene la marca y se deja como estaba.
do $$ begin
  if exists (select 1 from pg_constraint c where c.conrelid = 'public.debtor'::regclass and c.conname = 'debtor_tenant_id_key'
               and obj_description(c.oid, 'pg_constraint') = 'equitas:paquete-minimo') then
    alter table public.debtor drop constraint debtor_tenant_id_key;
  end if;
end $$;

commit;

reset equitas.confirmar_borrado;

notify pgrst, 'reload schema';
