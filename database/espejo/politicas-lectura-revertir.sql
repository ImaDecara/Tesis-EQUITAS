-- EQUITAS — reversa de politicas-lectura.sql (noche 7). Probada SOLO en el espejo local.
-- Vuelve a las políticas abiertas (USING true) y a los permisos de escritura de la foto de octubre. Deja los índices:
-- no cambian ningún resultado.

begin;

drop policy if exists "member_read_tenant" on public."tenant";
drop policy if exists "authenticated_read_tenant" on public."tenant";
create policy "authenticated_read_tenant" on public."tenant" for select to authenticated using (true);
grant insert, update, delete on public."tenant" to authenticated;

drop policy if exists "member_read_user" on public."user";
drop policy if exists "authenticated_read_user" on public."user";
create policy "authenticated_read_user" on public."user" for select to authenticated using (true);
grant insert, update, delete on public."user" to authenticated;

drop policy if exists "member_read_tenant_user" on public."tenant_user";
drop policy if exists "authenticated_read_tenant_user" on public."tenant_user";
create policy "authenticated_read_tenant_user" on public."tenant_user" for select to authenticated using (true);
grant insert, update, delete on public."tenant_user" to authenticated;

drop policy if exists "member_read_debtor" on public."debtor";
drop policy if exists "authenticated_read_debtor" on public."debtor";
create policy "authenticated_read_debtor" on public."debtor" for select to authenticated using (true);
grant insert, update, delete on public."debtor" to authenticated;

drop policy if exists "member_read_debt" on public."debt";
drop policy if exists "authenticated_read_debt" on public."debt";
create policy "authenticated_read_debt" on public."debt" for select to authenticated using (true);
grant insert, update, delete on public."debt" to authenticated;

drop policy if exists "member_read_debtor_person" on public."debtor_person";
drop policy if exists "authenticated_read_debtor_person" on public."debtor_person";
create policy "authenticated_read_debtor_person" on public."debtor_person" for select to authenticated using (true);
grant insert, update, delete on public."debtor_person" to authenticated;

drop policy if exists "member_read_person" on public."person";
drop policy if exists "authenticated_read_person" on public."person";
create policy "authenticated_read_person" on public."person" for select to authenticated using (true);
grant insert, update, delete on public."person" to authenticated;

drop policy if exists "member_read_debtor_contact" on public."debtor_contact";
drop policy if exists "authenticated_read_debtor_contact" on public."debtor_contact";
create policy "authenticated_read_debtor_contact" on public."debtor_contact" for select to authenticated using (true);
grant insert, update, delete on public."debtor_contact" to authenticated;

drop policy if exists "member_read_address" on public."address";
drop policy if exists "authenticated_read_address" on public."address";
create policy "authenticated_read_address" on public."address" for select to authenticated using (true);
grant insert, update, delete on public."address" to authenticated;

drop policy if exists "member_read_debtor_profile" on public."debtor_profile";
drop policy if exists "authenticated_read_debtor_profile" on public."debtor_profile";
create policy "authenticated_read_debtor_profile" on public."debtor_profile" for select to authenticated using (true);
grant insert, update, delete on public."debtor_profile" to authenticated;

drop policy if exists "member_read_debtor_profile_detail" on public."debtor_profile_detail";
drop policy if exists "authenticated_read_debtor_profile_detail" on public."debtor_profile_detail";
create policy "authenticated_read_debtor_profile_detail" on public."debtor_profile_detail" for select to authenticated using (true);
grant insert, update, delete on public."debtor_profile_detail" to authenticated;

drop policy if exists "member_read_data_source" on public."data_source";
drop policy if exists "authenticated_read_data_source" on public."data_source";
create policy "authenticated_read_data_source" on public."data_source" for select to authenticated using (true);
grant insert, update, delete on public."data_source" to authenticated;

drop policy if exists "member_read_city" on public."city";
drop policy if exists "authenticated_read_city" on public."city";
create policy "authenticated_read_city" on public."city" for select to authenticated using (true);
grant insert, update, delete on public."city" to authenticated;

drop policy if exists "member_read_contact_type" on public."contact_type";
drop policy if exists "authenticated_read_contact_type" on public."contact_type";
create policy "authenticated_read_contact_type" on public."contact_type" for select to authenticated using (true);
grant insert, update, delete on public."contact_type" to authenticated;

drop policy if exists "member_read_currency" on public."currency";
drop policy if exists "authenticated_read_currency" on public."currency";
create policy "authenticated_read_currency" on public."currency" for select to authenticated using (true);
grant insert, update, delete on public."currency" to authenticated;

drop policy if exists "member_read_data_source_type" on public."data_source_type";
drop policy if exists "authenticated_read_data_source_type" on public."data_source_type";
create policy "authenticated_read_data_source_type" on public."data_source_type" for select to authenticated using (true);
grant insert, update, delete on public."data_source_type" to authenticated;

drop policy if exists "member_read_debt_status" on public."debt_status";
drop policy if exists "authenticated_read_debt_status" on public."debt_status";
create policy "authenticated_read_debt_status" on public."debt_status" for select to authenticated using (true);
grant insert, update, delete on public."debt_status" to authenticated;

drop policy if exists "member_read_debtor_type" on public."debtor_type";
drop policy if exists "authenticated_read_debtor_type" on public."debtor_type";
create policy "authenticated_read_debtor_type" on public."debtor_type" for select to authenticated using (true);
grant insert, update, delete on public."debtor_type" to authenticated;

drop policy if exists "member_read_document_type" on public."document_type";
drop policy if exists "authenticated_read_document_type" on public."document_type";
create policy "authenticated_read_document_type" on public."document_type" for select to authenticated using (true);
grant insert, update, delete on public."document_type" to authenticated;

drop policy if exists "member_read_person_status" on public."person_status";
drop policy if exists "authenticated_read_person_status" on public."person_status";
create policy "authenticated_read_person_status" on public."person_status" for select to authenticated using (true);
grant insert, update, delete on public."person_status" to authenticated;

drop policy if exists "member_read_person_type" on public."person_type";
drop policy if exists "authenticated_read_person_type" on public."person_type";
create policy "authenticated_read_person_type" on public."person_type" for select to authenticated using (true);
grant insert, update, delete on public."person_type" to authenticated;

drop policy if exists "member_read_province" on public."province";
drop policy if exists "authenticated_read_province" on public."province";
create policy "authenticated_read_province" on public."province" for select to authenticated using (true);
grant insert, update, delete on public."province" to authenticated;

drop policy if exists "member_read_role" on public."role";
drop policy if exists "authenticated_read_role" on public."role";
create policy "authenticated_read_role" on public."role" for select to authenticated using (true);
grant insert, update, delete on public."role" to authenticated;

commit;

notify pgrst, 'reload schema';
