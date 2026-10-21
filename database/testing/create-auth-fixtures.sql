-- Ejecutar SOLO en EQUITAS-TP-TESTING, con Auth vacio.
-- El resultado contiene contrasenas aleatorias: guardarlo en .quality/, nunca publicarlo.
-- No se crean sesiones ni JWT artificiales: el ensayo inicia sesion por Auth HTTP.
do $$ begin
  if exists(select 1 from auth.users) then
    raise exception 'Auth debe estar vacio; no se modifican usuarios existentes';
  end if;
end $$;

create temporary table fixture_credentials as
select label, gen_random_uuid() as user_id,
  'tp-e06-' || label || '@example.test' as email,
  encode(extensions.gen_random_bytes(24), 'hex') || 'Aa1!' as password
from unnest(array['a','b','none','inactive']) as label;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,
  email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change_token_new,email_change)
select '00000000-0000-0000-0000-000000000000',user_id,'authenticated','authenticated',
  email,extensions.crypt(password,extensions.gen_salt('bf',10)),now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now(),
  '','','','' from fixture_credentials;

insert into auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at)
select user_id::text,user_id,jsonb_build_object('sub',user_id::text,'email',email,
  'email_verified',true,'phone_verified',false),'email',now(),now()
from fixture_credentials;

select label,user_id,email,password from fixture_credentials order by label;
