-- ALIGN-018. SOLO base local aislada con 20261030100000_case_review. Cuentas totalmente sinteticas.
-- El resultado contiene contrasenas aleatorias: guardarlo solo en /tmp/equitas-local-db/ (umask 077),
-- nunca en el repositorio, en la evidencia ni en una conversacion. Ver SUPABASE_TESTING_CALIDAD.md.
-- No exige Auth vacio: convive con las cuentas e06 si estas se crearon antes (create-auth-fixtures.sql si lo exige).
-- Ante una cuenta ya creada falla sin modificar nada. No se crean sesiones ni JWT artificiales.
begin;
do $$ begin
  if not exists(select 1 from supabase_migrations.schema_migrations where version='20261030100000') then
    raise exception 'Requiere la migracion 20261030100000_case_review (solo base local)';
  end if;
  if exists(select 1 from auth.users where email like 'tp-a018-%@example.test') then
    raise exception 'Las cuentas de ALIGN-018 ya existen; no se modifican. Usar una base recien reconstruida';
  end if;
end $$;

create temporary table a018_credentials on commit drop as
select label, gen_random_uuid() as user_id,
  'tp-a018-' || label || '@example.test' as email,
  encode(extensions.gen_random_bytes(24), 'hex') || 'Aa1!' as password
from unnest(array['consulta','operador','supervisor','importador','sin-membresia',
  'inactivo','otro-operador','otro-supervisor']) as label;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,
  email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change_token_new,email_change)
select '00000000-0000-0000-0000-000000000000',user_id,'authenticated','authenticated',
  email,extensions.crypt(password,extensions.gen_salt('bf',10)),now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now(),
  '','','','' from a018_credentials;

insert into auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at)
select user_id::text,user_id,jsonb_build_object('sub',user_id::text,'email',email,
  'email_verified',true,'phone_verified',false),'email',now(),now()
from a018_credentials;

select label,email,password from a018_credentials order by label;
commit;
