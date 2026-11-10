-- ALIGN-052. SOLO base local aislada, despues de case-review-auth-fixtures.sql y case-review-fixtures.sql.
-- Cuentas y cartera totalmente sinteticas. El resultado contiene contrasenas aleatorias: el conftest
-- las toma en memoria y no las guarda. IDs reservados 952000..952099. Para limpiar: db reset.
begin;
do $$ begin
  if not exists(select 1 from auth.users where email = 'tp-a018-importador@example.test') then
    raise exception 'Faltan las cuentas de case-review-auth-fixtures.sql';
  end if;
  if exists(select 1 from auth.users where email like 'tp-a052-%@example.test') then
    raise exception 'Las cuentas de ALIGN-052 ya existen: se requiere db reset';
  end if;
end $$;

create temporary table a052_credentials on commit drop as
select label, gen_random_uuid() as user_id,
  'tp-a052-' || label || '@example.test' as email,
  encode(extensions.gen_random_bytes(24), 'hex') || 'Aa1!' as password
from unnest(array['otro-importador','multi','usuario-inactivo','revocable','de-sesion']) as label;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,
  email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change_token_new,email_change)
select '00000000-0000-0000-0000-000000000000',user_id,'authenticated','authenticated',
  email,extensions.crypt(password,extensions.gen_salt('bf',10)),now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now(),
  '','','','' from a052_credentials;

insert into auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at)
select user_id::text,user_id,jsonb_build_object('sub',user_id::text,'email',email,
  'email_verified',true,'phone_verified',false),'email',now(),now()
from a052_credentials;

insert into public."user"(id,auth_user,full_name,email,status)
select 952000 + case label when 'otro-importador' then 1 when 'multi' then 2 when 'usuario-inactivo' then 3
    when 'revocable' then 4 when 'de-sesion' then 5 end,
  user_id,'Fixture '||email,email,
  case label when 'usuario-inactivo' then 'INACTIVE' else 'ACTIVE' end
from a052_credentials;

-- Noche 7: 920001 USER, 920002 ADMIN (case-review-fixtures.sql). Antes 920002 era operador y 920004 importador:
-- las cuentas que importaban (otro-importador, de-sesion) y las que leian (multi, usuario-inactivo, revocable) quedan ADMIN.
insert into public.tenant_user(id,tenant,"user",role,status) values
  (952001,920002,952001,920002,true),
  (952002,920001,952002,920002,true),
  (952003,920002,952002,920002,true),
  (952004,920001,952003,920002,true),
  (952005,920001,952004,920002,true),
  (952006,920001,952005,920002,true);

-- Cartera: un objeto con deuda y contacto por municipio, con centinelas distintos.
insert into public.person_type(id,key,value) values (952001,'A052_INDIVIDUAL','Sintetico');
insert into public.contact_type(id,key,value) values (952001,'A052_EMAIL','Sintetico');
insert into public.debtor(id,tenant,external_id,identifier,description) values
  (952001,920001,952001,'CENTINELA_A052_OBJETO_A','Objeto sintetico A'),
  (952002,920002,952002,'CENTINELA_A052_OBJETO_B','CENTINELA_A052_OBJETO_B');
insert into public.debt(id,external_id,debtor,current_amount,due_date) values
  (952001,952001,952001,1000,'2026-01-01'),
  (952002,952002,952002,777777,'2026-01-01');
insert into public.person(id,external_id,full_name,type) values
  (952001,952001,'CENTINELA_A052_PERSONA_A',952001),
  (952002,952002,'CENTINELA_A052_PERSONA_B',952001);
insert into public.debtor_person(id,debtor,person,priority,active) values
  (952001,952001,952001,100,true),
  (952002,952002,952002,100,true);
insert into public.debtor_contact(id,person,type,value,active) values
  (952001,952001,952001,'centinela-a052-a@example.invalid',true),
  (952002,952002,952001,'centinela-a052-b@example.invalid',true);
insert into public.debtor_profile(id,debtor,active) values
  (952001,952001,true),
  (952002,952002,true);

select label,email,password from a052_credentials order by label;
commit;
