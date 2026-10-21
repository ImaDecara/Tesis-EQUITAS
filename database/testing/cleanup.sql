-- SOLO EQUITAS-TP-TESTING. Transaccion atomica: ante colision/FK ajena, rollback.
-- Mantiene esquema y politicas. Borrar fixtures deja CI fallando hasta recrearlas.
begin;
do $$ begin
  if exists(select 1 from public.tenant where id in(910001,910002)
    and name not in('TP E06 A','TP E06 B')) then
    raise exception 'Colision de IDs: no se eliminan datos ajenos';
  end if;
  if exists(select 1 from public."user" where id between 910001 and 910004
    and email not in('tp-e06-a@example.test','tp-e06-b@example.test',
                    'tp-e06-none@example.test','tp-e06-inactive@example.test')) then
    raise exception 'Colision de usuarios: no se eliminan cuentas ajenas';
  end if;
end $$;
delete from public.tenant where (id=910001 and name='TP E06 A') or (id=910002 and name='TP E06 B');
delete from public.person where id in(910001,910002) and external_id=id
  and full_name in('Persona sintetica A','Persona sintetica B');
delete from auth.sessions where user_id in(select id from auth.users where email in
  ('tp-e06-a@example.test','tp-e06-b@example.test','tp-e06-none@example.test','tp-e06-inactive@example.test'));
delete from auth.users where email in
  ('tp-e06-a@example.test','tp-e06-b@example.test','tp-e06-none@example.test','tp-e06-inactive@example.test');
delete from public.role where id=910001 and name='tp_operator';
delete from public.city where id=910001 and name='Ciudad sintetica';
delete from public.province where id=910001 and name='Provincia sintetica';
delete from public.contact_type where id=910001 and key='EMAIL';
delete from public.currency where id=910001 and code='ARS';
delete from public.data_source_type where id=910001 and name='Fixture';
delete from public.debt_status where id=910001 and key='OVERDUE';
delete from public.debtor_type where id=910001 and key='TP';
delete from public.document_type where id=910001 and key='TEST';
delete from public.person_status where id=910001 and key='ACTIVE';
delete from public.person_type where id=910001 and key='TEST';
commit;
