-- ALIGN-029. Solo tras reset LOCAL y etl-compat-catalogs.sql. Salida privada (contraseñas).
begin;
create temporary table flow_credentials on commit drop as
select label, gen_random_uuid() as user_id, 'flow029-' || label || '@example.test' as email,
  encode(extensions.gen_random_bytes(24), 'hex') || 'Aa1!' as password
from unnest(array['operador', 'supervisor']) as label;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
select '00000000-0000-0000-0000-000000000000',user_id,'authenticated','authenticated',email,
  extensions.crypt(password,extensions.gen_salt('bf',10)),now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now(),'','','',''
from flow_credentials;
insert into auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at)
select user_id::text,user_id,jsonb_build_object('sub',user_id::text,'email',email,
  'email_verified',true,'phone_verified',false),'email',now(),now() from flow_credentials;
insert into public.role(id,name,description)
select 290000 + row_number() over(order by label), label, 'Rol sintetico ALIGN-029' from flow_credentials
where not exists(select 1 from public.role where name=label);
insert into public."user"(auth_user,full_name,email)
select user_id,'Actor sintetico ' || label,email from flow_credentials;
insert into public.tenant_user(tenant,"user",role)
select 1,u.id,r.id from flow_credentials c join public."user" u on u.auth_user=c.user_id
join public.role r on r.name=c.label;
select label,email,password from flow_credentials order by label;
commit;
