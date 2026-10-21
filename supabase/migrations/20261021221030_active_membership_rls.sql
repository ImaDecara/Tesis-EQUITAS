-- DEF-SUP-001. Aplicar despues del esquema observado; no contiene datos ni secretos.

-- Lectura por membresia activa. No se agregan funciones SECURITY DEFINER ni RPC.

-- public.user -> tenant_user -> tenant -> debtor -> relaciones: sin ciclos RLS.

-- anon puede consultar pero recibe cero filas. authenticated no tiene escrituras.

-- La cartera real requiere revision/ventana de despliegue independiente.

drop policy "authenticated_read_tenant" on public."tenant";

create policy "member_read_tenant" on public."tenant" for select to authenticated using (exists (select 1 from public.tenant_user tu join public."user" u on u.id=tu."user"
   where tu.tenant=tenant.id and tu.status and u.status='ACTIVE' and u.auth_user=(select auth.uid())) and status='ACTIVE');

drop policy "authenticated_read_user" on public."user";

create policy "member_read_user" on public."user" for select to authenticated using (auth_user=(select auth.uid()));

drop policy "authenticated_read_tenant_user" on public."tenant_user";

create policy "member_read_tenant_user" on public."tenant_user" for select to authenticated using ("user" in (select id from public."user"));

drop policy "authenticated_read_debtor" on public."debtor";

create policy "member_read_debtor" on public."debtor" for select to authenticated using (tenant in (select id from public.tenant));

drop policy "authenticated_read_debt" on public."debt";

create policy "member_read_debt" on public."debt" for select to authenticated using (debtor in (select id from public.debtor));

drop policy "authenticated_read_debtor_person" on public."debtor_person";

create policy "member_read_debtor_person" on public."debtor_person" for select to authenticated using (debtor in (select id from public.debtor));

drop policy "authenticated_read_person" on public."person";

create policy "member_read_person" on public."person" for select to authenticated using (id in (select person from public.debtor_person where active));

drop policy "authenticated_read_debtor_contact" on public."debtor_contact";

create policy "member_read_debtor_contact" on public."debtor_contact" for select to authenticated using (person in (select id from public.person));

drop policy "authenticated_read_address" on public."address";

create policy "member_read_address" on public."address" for select to authenticated using (person in (select id from public.person));

drop policy "authenticated_read_debtor_profile" on public."debtor_profile";

create policy "member_read_debtor_profile" on public."debtor_profile" for select to authenticated using (debtor in (select id from public.debtor));

drop policy "authenticated_read_debtor_profile_detail" on public."debtor_profile_detail";

create policy "member_read_debtor_profile_detail" on public."debtor_profile_detail" for select to authenticated using (debtor_profile in (select id from public.debtor_profile)
   and person in (select id from public.person));

drop policy "authenticated_read_data_source" on public."data_source";

create policy "member_read_data_source" on public."data_source" for select to authenticated using (tenant in (select id from public.tenant));

drop policy "authenticated_read_city" on public."city";

create policy "member_read_city" on public."city" for select to authenticated
  using (exists (select 1 from public.tenant));

drop policy "authenticated_read_contact_type" on public."contact_type";

create policy "member_read_contact_type" on public."contact_type" for select to authenticated
  using (exists (select 1 from public.tenant));

drop policy "authenticated_read_currency" on public."currency";

create policy "member_read_currency" on public."currency" for select to authenticated
  using (exists (select 1 from public.tenant));

drop policy "authenticated_read_data_source_type" on public."data_source_type";

create policy "member_read_data_source_type" on public."data_source_type" for select to authenticated
  using (exists (select 1 from public.tenant));

drop policy "authenticated_read_debt_status" on public."debt_status";

create policy "member_read_debt_status" on public."debt_status" for select to authenticated
  using (exists (select 1 from public.tenant));

drop policy "authenticated_read_debtor_type" on public."debtor_type";

create policy "member_read_debtor_type" on public."debtor_type" for select to authenticated
  using (exists (select 1 from public.tenant));

drop policy "authenticated_read_document_type" on public."document_type";

create policy "member_read_document_type" on public."document_type" for select to authenticated
  using (exists (select 1 from public.tenant));

drop policy "authenticated_read_person_status" on public."person_status";

create policy "member_read_person_status" on public."person_status" for select to authenticated
  using (exists (select 1 from public.tenant));

drop policy "authenticated_read_person_type" on public."person_type";

create policy "member_read_person_type" on public."person_type" for select to authenticated
  using (exists (select 1 from public.tenant));

drop policy "authenticated_read_province" on public."province";

create policy "member_read_province" on public."province" for select to authenticated
  using (exists (select 1 from public.tenant));

drop policy "authenticated_read_role" on public."role";

create policy "member_read_role" on public."role" for select to authenticated
  using (exists (select 1 from public.tenant));

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

-- El event trigger de plataforma no es una API de negocio.

do $$ begin
 if to_regprocedure('public.rls_auto_enable()') is not null then
  revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
 end if;
end $$;

notify pgrst, 'reload schema';
