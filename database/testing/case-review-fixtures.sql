-- ALIGN-018. SOLO base local aislada con 20261030100000_case_review. Datos totalmente sinteticos.
-- Requiere case-review-auth-fixtures.sql. IDs reservados 920001..920009; no es una carga de cartera.
-- Convive con e06 (cargar e06 primero: create-auth-fixtures.sql exige Auth vacio; cleanup.sql no toca estas filas)
-- y con los catalogos y el ETL de ALIGN-017: no usa catalogos con clave unica de esos escenarios y deja debtor.type nulo.
-- Los IDs explicitos no avanzan las secuencias: tenant, user, tenant_user y debtor siguen generando desde el valor
-- anterior, asi etl-compat-catalogs.sql sigue obteniendo tenant 1 (ver secuencias_sin_superar_maximo en la documentacion).
-- No crea revisiones: son append-only y se generan por las funciones de servidor. Para limpiar: db reset.
-- Ante un conflicto de PK o clave unica falla sin modificar nada.
begin;
do $$ begin
  if not exists(select 1 from supabase_migrations.schema_migrations where version='20261030100000') then
    raise exception 'Requiere la migracion 20261030100000_case_review (solo base local)';
  end if;
  if (select count(*) from auth.users where email like 'tp-a018-%@example.test') <> 8 then
    raise exception 'Faltan las cuentas de case-review-auth-fixtures.sql';
  end if;
end $$;

insert into public.tenant(id,name) values(920001,'TP A018 Municipio'),(920002,'TP A018 Otro municipio');
-- Nombres de roles aprobados en ALIGN-003. Las funciones de escritura los leen por nombre.
insert into public.role(id,name,description) values
  (920001,'consulta','Solo lectura'),
  (920002,'operador','Decide intensidad hasta 2 y propone 3 o mas'),
  (920003,'supervisor','Aprueba u objeta intensidad 3 o mas'),
  (920004,'importador','Sube, mapea y confirma lotes'),
  (920005,'importador_sistema','Credencial de maquina para la ingesta, sin pantallas');
insert into public."user"(id,auth_user,full_name,email)
select 920000 + case split_part(email,'@',1)
  when 'tp-a018-consulta' then 1 when 'tp-a018-operador' then 2 when 'tp-a018-supervisor' then 3
  when 'tp-a018-importador' then 4 when 'tp-a018-sin-membresia' then 5 when 'tp-a018-inactivo' then 6
  when 'tp-a018-otro-operador' then 7 when 'tp-a018-otro-supervisor' then 8 end,
  id,'Fixture '||email,email from auth.users where email like 'tp-a018-%@example.test';
-- Credencial de maquina: usuario de aplicacion sin cuenta de Auth, no puede iniciar sesion.
insert into public."user"(id,full_name,email) values(920009,'Fixture sistema','tp-a018-sistema@example.test');
insert into public.tenant_user(id,tenant,"user",role,status) values
  (920001,920001,920001,920001,true),
  (920002,920001,920002,920002,true),
  (920003,920001,920003,920003,true),
  (920004,920001,920004,920004,true),
  (920006,920001,920006,920002,false),
  (920007,920002,920007,920002,true),
  (920008,920002,920008,920003,true),
  (920009,920001,920009,920005,true);
insert into public.debtor(id,tenant,external_id,identifier,description) values
  (920001,920001,920001,'TP-A018-1','Objeto sintetico del municipio'),
  (920002,920002,920002,'TP-A018-2','Objeto sintetico de otro municipio');
commit;
