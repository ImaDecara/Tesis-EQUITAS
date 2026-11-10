-- Noche 7. SOLO base local aislada, despues de case-review-auth-fixtures.sql, case-review-fixtures.sql (roles ADMIN y USER)
-- y database/testing/etl-compat-catalogs.sql (catalogos que el formato CSV sintetico resuelve por clave).
-- Un municipio sin cartera y dos cuentas sinteticas con una sola membresia cada una: ADMIN carga, USER no.
-- El resultado contiene contrasenas aleatorias: el conftest las toma en memoria y no las guarda. IDs 953000..953099.
begin;
do $$ begin
  if (select count(*) from public.role where name in ('ADMIN', 'USER')) <> 2 then
    raise exception 'Faltan los roles ADMIN y USER (case-review-fixtures.sql)';
  end if;
  if not exists(select 1 from public.debt_status where key = 'PAID') then
    raise exception 'Faltan los catalogos (database/testing/etl-compat-catalogs.sql)';
  end if;
  if exists(select 1 from auth.users where email like 'tp-n7carga-%@example.test') then
    raise exception 'Las cuentas de la carga ya existen: se requiere un proyecto recien creado';
  end if;
end $$;

create temporary table n7carga_credentials on commit drop as
select label, gen_random_uuid() as user_id, 'tp-n7carga-' || label || '@example.test' as email,
  encode(extensions.gen_random_bytes(24), 'hex') || 'Aa1!' as password
from unnest(array['admin', 'user']) as label;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,
  email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change_token_new,email_change)
select '00000000-0000-0000-0000-000000000000',user_id,'authenticated','authenticated',
  email,extensions.crypt(password,extensions.gen_salt('bf',10)),now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now(),
  '','','','' from n7carga_credentials;

insert into auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at)
select user_id::text,user_id,jsonb_build_object('sub',user_id::text,'email',email,
  'email_verified',true,'phone_verified',false),'email',now(),now()
from n7carga_credentials;

insert into public.tenant(id,name) values (953001,'TP N7 Municipio de carga');
insert into public."user"(id,auth_user,full_name,email)
select case label when 'admin' then 953001 else 953002 end, user_id, 'Fixture ' || email, email from n7carga_credentials;
insert into public.tenant_user(id,tenant,"user",role,status) values
  (953001,953001,953001,(select id from public.role where name = 'ADMIN'),true),
  (953002,953001,953002,(select id from public.role where name = 'USER'),true);

select 'carga-' || label, email, password from n7carga_credentials order by label;
commit;
