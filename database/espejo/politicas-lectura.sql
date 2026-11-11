-- EQUITAS — cambio de políticas de lectura (noche 7, encargo 10.5). NO ES ADITIVO: va aparte del paquete mínimo.
-- Probado SOLO en el espejo local. No se aplicó en ninguna base remota y este archivo no autoriza a hacerlo.
--
-- QUÉ CAMBIA
--   1. Elimina las 23 políticas que hoy permiten leer TODO a cualquier usuario autenticado (USING true).
--   2. Crea las políticas de membresía activa: cada persona lee solo la cartera de los municipios donde tiene una
--      membresía activa, con su usuario y el municipio activos. Son las del repositorio
--      (supabase/migrations/20261021221030_active_membership_rls.sql), sin cambios.
--   3. Retira de «authenticated» los permisos de INSERT, UPDATE y DELETE que la foto de octubre mostraba en las 23
--      tablas. Ninguna versión de la aplicación escribe la cartera con la sesión de una persona.
--   4. Agrega los índices que esas políticas necesitan para no recorrer tablas enteras.
--
-- POR QUÉ NO ES ADITIVO: después de aplicarlo, una cuenta SIN membresía activa deja de leer. Quien hoy lee
-- gracias a la política abierta (por ejemplo, una cuenta autenticada sin municipio) pasa a ver cero filas.
-- Antes de aplicarlo hay que conocer las membresías reales: politicas-lectura-verificar.sql las cuenta.
--
-- IMPACTO: toma bloqueos breves por tabla al cambiar políticas y crear índices. Conviene una ventana sin uso.
-- REVERSA: politicas-lectura-revertir.sql vuelve a las políticas abiertas y a los permisos de la foto.
-- Se puede repetir sin cambios.

begin;

drop policy if exists "authenticated_read_tenant" on public."tenant";
drop policy if exists "member_read_tenant" on public."tenant";
create policy "member_read_tenant" on public."tenant" for select to authenticated using (exists (select 1 from public.tenant_user tu join public."user" u on u.id=tu."user"
   where tu.tenant=tenant.id and tu.status and u.status='ACTIVE' and u.auth_user=(select auth.uid())) and status='ACTIVE');

drop policy if exists "authenticated_read_user" on public."user";
drop policy if exists "member_read_user" on public."user";
create policy "member_read_user" on public."user" for select to authenticated using (auth_user=(select auth.uid()));

drop policy if exists "authenticated_read_tenant_user" on public."tenant_user";
drop policy if exists "member_read_tenant_user" on public."tenant_user";
create policy "member_read_tenant_user" on public."tenant_user" for select to authenticated using ("user" in (select id from public."user"));

drop policy if exists "authenticated_read_debtor" on public."debtor";
drop policy if exists "member_read_debtor" on public."debtor";
create policy "member_read_debtor" on public."debtor" for select to authenticated using (tenant in (select id from public.tenant));

drop policy if exists "authenticated_read_debt" on public."debt";
drop policy if exists "member_read_debt" on public."debt";
create policy "member_read_debt" on public."debt" for select to authenticated using (debtor in (select id from public.debtor));

drop policy if exists "authenticated_read_debtor_person" on public."debtor_person";
drop policy if exists "member_read_debtor_person" on public."debtor_person";
create policy "member_read_debtor_person" on public."debtor_person" for select to authenticated using (debtor in (select id from public.debtor));

drop policy if exists "authenticated_read_person" on public."person";
drop policy if exists "member_read_person" on public."person";
create policy "member_read_person" on public."person" for select to authenticated using (id in (select person from public.debtor_person where active));

drop policy if exists "authenticated_read_debtor_contact" on public."debtor_contact";
drop policy if exists "member_read_debtor_contact" on public."debtor_contact";
create policy "member_read_debtor_contact" on public."debtor_contact" for select to authenticated using (person in (select id from public.person));

drop policy if exists "authenticated_read_address" on public."address";
drop policy if exists "member_read_address" on public."address";
create policy "member_read_address" on public."address" for select to authenticated using (person in (select id from public.person));

drop policy if exists "authenticated_read_debtor_profile" on public."debtor_profile";
drop policy if exists "member_read_debtor_profile" on public."debtor_profile";
create policy "member_read_debtor_profile" on public."debtor_profile" for select to authenticated using (debtor in (select id from public.debtor));

drop policy if exists "authenticated_read_debtor_profile_detail" on public."debtor_profile_detail";
drop policy if exists "member_read_debtor_profile_detail" on public."debtor_profile_detail";
create policy "member_read_debtor_profile_detail" on public."debtor_profile_detail" for select to authenticated using (debtor_profile in (select id from public.debtor_profile)
   and person in (select id from public.person));

drop policy if exists "authenticated_read_data_source" on public."data_source";
drop policy if exists "member_read_data_source" on public."data_source";
create policy "member_read_data_source" on public."data_source" for select to authenticated using (tenant in (select id from public.tenant));

drop policy if exists "authenticated_read_city" on public."city";
drop policy if exists "member_read_city" on public."city";
create policy "member_read_city" on public."city" for select to authenticated
  using (exists (select 1 from public.tenant));

drop policy if exists "authenticated_read_contact_type" on public."contact_type";
drop policy if exists "member_read_contact_type" on public."contact_type";
create policy "member_read_contact_type" on public."contact_type" for select to authenticated
  using (exists (select 1 from public.tenant));

drop policy if exists "authenticated_read_currency" on public."currency";
drop policy if exists "member_read_currency" on public."currency";
create policy "member_read_currency" on public."currency" for select to authenticated
  using (exists (select 1 from public.tenant));

drop policy if exists "authenticated_read_data_source_type" on public."data_source_type";
drop policy if exists "member_read_data_source_type" on public."data_source_type";
create policy "member_read_data_source_type" on public."data_source_type" for select to authenticated
  using (exists (select 1 from public.tenant));

drop policy if exists "authenticated_read_debt_status" on public."debt_status";
drop policy if exists "member_read_debt_status" on public."debt_status";
create policy "member_read_debt_status" on public."debt_status" for select to authenticated
  using (exists (select 1 from public.tenant));

drop policy if exists "authenticated_read_debtor_type" on public."debtor_type";
drop policy if exists "member_read_debtor_type" on public."debtor_type";
create policy "member_read_debtor_type" on public."debtor_type" for select to authenticated
  using (exists (select 1 from public.tenant));

drop policy if exists "authenticated_read_document_type" on public."document_type";
drop policy if exists "member_read_document_type" on public."document_type";
create policy "member_read_document_type" on public."document_type" for select to authenticated
  using (exists (select 1 from public.tenant));

drop policy if exists "authenticated_read_person_status" on public."person_status";
drop policy if exists "member_read_person_status" on public."person_status";
create policy "member_read_person_status" on public."person_status" for select to authenticated
  using (exists (select 1 from public.tenant));

drop policy if exists "authenticated_read_person_type" on public."person_type";
drop policy if exists "member_read_person_type" on public."person_type";
create policy "member_read_person_type" on public."person_type" for select to authenticated
  using (exists (select 1 from public.tenant));

drop policy if exists "authenticated_read_province" on public."province";
drop policy if exists "member_read_province" on public."province";
create policy "member_read_province" on public."province" for select to authenticated
  using (exists (select 1 from public.tenant));

drop policy if exists "authenticated_read_role" on public."role";
drop policy if exists "member_read_role" on public."role";
create policy "member_read_role" on public."role" for select to authenticated
  using (exists (select 1 from public.tenant));

-- Permisos de escritura sobrantes: la cartera solo la escribe quien administra la base o el cargador.

revoke insert, update, delete on public."tenant" from authenticated;
revoke insert, update, delete on public."user" from authenticated;
revoke insert, update, delete on public."tenant_user" from authenticated;
revoke insert, update, delete on public."debtor" from authenticated;
revoke insert, update, delete on public."debt" from authenticated;
revoke insert, update, delete on public."debtor_person" from authenticated;
revoke insert, update, delete on public."person" from authenticated;
revoke insert, update, delete on public."debtor_contact" from authenticated;
revoke insert, update, delete on public."address" from authenticated;
revoke insert, update, delete on public."debtor_profile" from authenticated;
revoke insert, update, delete on public."debtor_profile_detail" from authenticated;
revoke insert, update, delete on public."data_source" from authenticated;
revoke insert, update, delete on public."city" from authenticated;
revoke insert, update, delete on public."contact_type" from authenticated;
revoke insert, update, delete on public."currency" from authenticated;
revoke insert, update, delete on public."data_source_type" from authenticated;
revoke insert, update, delete on public."debt_status" from authenticated;
revoke insert, update, delete on public."debtor_type" from authenticated;
revoke insert, update, delete on public."document_type" from authenticated;
revoke insert, update, delete on public."person_status" from authenticated;
revoke insert, update, delete on public."person_type" from authenticated;
revoke insert, update, delete on public."province" from authenticated;
revoke insert, update, delete on public."role" from authenticated;

-- Índices que usan las políticas y las lecturas de la aplicación.
create index if not exists "tenant_user_user_idx" on public."tenant_user"("user");
create index if not exists "tenant_user_role_idx" on public."tenant_user"("role");
create index if not exists "debt_currency_idx" on public."debt"("currency");
create index if not exists "debt_status_idx" on public."debt"("status");
create index if not exists "debtor_type_idx" on public."debtor"("type");
create index if not exists "debtor_person_person_idx" on public."debtor_person"("person");
create index if not exists "debtor_contact_type_idx" on public."debtor_contact"("type");
create index if not exists "debtor_profile_detail_person_idx" on public."debtor_profile_detail"("person");
create index if not exists "address_city_idx" on public."address"("city");
create index if not exists "data_source_tenant_idx" on public."data_source"("tenant");
create index if not exists "data_source_type_idx" on public."data_source"("type");
create index if not exists "person_document_type_idx" on public."person"("document_type");
create index if not exists "person_type_idx" on public."person"("type");
create index if not exists "person_status_idx" on public."person"("status");

-- El disparador de plataforma no es una función de negocio.
do $$ begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
