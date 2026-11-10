-- ALIGN-022. SOLO base local, con turno. Datos totalmente sinteticos, sobre case-review-fixtures.sql y local-review/fixture.sql.
-- El resultado contiene una contrasena aleatoria: guardarlo solo en un archivo 0600 de /tmp, nunca en el repositorio ni en la evidencia.
-- local-review/fixture.sql deja a la cuenta `importador` con rol tp_operator: esta semilla agrega una cuenta que importa de verdad
-- y los actores que faltan para la campana. Noche 7: esa cuenta (importador-real) es ADMIN, como todo el que importa; usuario
-- inactivo, municipio inactivo y proponente son ADMIN (920002, antes operador). Sin revisiones ni lotes: los crea la prueba por las funciones de servidor. Para limpiar: db reset.
begin;
do $$ begin
  if not exists(select 1 from public.role where id = 920010 and name = 'tp_operator') then
    raise exception 'Falta front/tests/local-review/fixture.sql';
  end if;
  if exists(select 1 from auth.users where email like 'tp-a022-%@example.test') then
    raise exception 'Las cuentas de ALIGN-022 ya existen; usar una base recien reconstruida';
  end if;
end $$;

create temporary table a022_credentials on commit drop as
select 'importador-real'::text as label, gen_random_uuid() as user_id, 'tp-a022-importador@example.test'::text as email,
  encode(extensions.gen_random_bytes(24), 'hex') || 'Aa1!' as password;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,
  email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change_token_new,email_change)
select '00000000-0000-0000-0000-000000000000',user_id,'authenticated','authenticated',
  email,extensions.crypt(password,extensions.gen_salt('bf',10)),now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now(),
  '','','','' from a022_credentials;

insert into auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at)
select user_id::text,user_id,jsonb_build_object('sub',user_id::text,'email',email,
  'email_verified',true,'phone_verified',false),'email',now(),now()
from a022_credentials;

-- Municipio inactivo con su objeto, para probar que una membresia activa no alcanza.
insert into public.tenant(id,name,status) values (920003,'TP A022 Municipio inactivo','INACTIVE');
insert into public.debtor(id,tenant,external_id,identifier,description)
  values (920003,920003,920003,'TP-A022-1','Objeto sintetico de un municipio inactivo');

insert into public."user"(id,auth_user,full_name,email)
  select 920010,user_id,'Fixture importador real',email from a022_credentials;
-- Actores sin cuenta de Auth: se nombran solo por la credencial de servidor.
insert into public."user"(id,full_name,email,status) values
  (920011,'Fixture usuario inactivo','tp-a022-usuario-inactivo@example.test','INACTIVE'),
  (920012,'Fixture de municipio inactivo','tp-a022-municipio-inactivo@example.test','ACTIVE'),
  (920013,'Fixture proponente','tp-a022-proponente@example.test','ACTIVE');
insert into public.tenant_user(id,tenant,"user",role,status) values
  (920012,920001,920010,920002,true),
  (920013,920001,920011,920002,true),
  (920014,920003,920012,920002,true),
  (920015,920001,920013,920002,true);

select label,email,password from a022_credentials;
commit;
