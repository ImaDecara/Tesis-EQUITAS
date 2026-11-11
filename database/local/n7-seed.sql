-- Noche 7. SOLO el proyecto Supabase LOCAL de pruebas (scripts/local/equitas_local.py). Datos sinteticos.
-- Catalogos, roles y municipios del entorno local. Repetirlo no cambia la base; ante un choque de id o clave falla sin modificar nada.
-- No crea cuentas ni membresias (las genera el script, con contrasenas privadas) y no carga cartera: la cartera entra por «Cargar CSV».

begin;

do $$ begin
  if not exists(select 1 from supabase_migrations.schema_migrations where version = '20261110100000') then
    raise exception 'Requiere la migracion 20261110100000_admin_user_access (solo base local)';
  end if;
end $$;

create function pg_temp.seed(tbl text, key_col text, value_col text, seed jsonb) returns void
language plpgsql as $f$
declare collisions integer;
begin
  execute format('select count(*) from public.%1$I c join jsonb_to_recordset($1) s(id bigint, key text, value text)
    on c.id = s.id or c.%2$I = s.key where c.id <> s.id or c.%2$I is distinct from s.key', tbl, key_col)
    into collisions using seed;
  if collisions > 0 then
    raise exception 'Colision en %: % fila(s) con otro id o clave. Usar un proyecto local recien creado', tbl, collisions;
  end if;
  execute format('insert into public.%1$I(id, %2$I, %3$I) select s.id, s.key, s.value
    from jsonb_to_recordset($1) s(id bigint, key text, value text)
    where not exists(select 1 from public.%1$I c where c.id = s.id)', tbl, key_col, value_col)
    using seed;
end $f$;

-- Mismos catalogos que database/testing/etl-compat-catalogs.sql: el cargador los resuelve por clave.
-- debt_status: los ocho de main mas SUSPENDED (9), que el formato de origen distingue. Ningun rotulo cambia de significado.
select pg_temp.seed('document_type', 'key', 'value', '[
  {"id":1,"key":"DNI","value":"DNI"},{"id":2,"key":"CUIT","value":"CUIT"},
  {"id":3,"key":"CUIL","value":"CUIL"},{"id":4,"key":"UNKNOWN","value":"Desconocido"}]');
select pg_temp.seed('person_type', 'key', 'value', '[
  {"id":1,"key":"INDIVIDUAL","value":"Persona humana"},{"id":2,"key":"LEGAL_PERSON","value":"Persona juridica"},
  {"id":3,"key":"COMPANY","value":"Empresa"},{"id":4,"key":"ASSOCIATION","value":"Asociacion"},
  {"id":5,"key":"UNKNOWN","value":"Desconocido"}]');
select pg_temp.seed('person_status', 'key', 'value', '[
  {"id":1,"key":"ACTIVE","value":"Activa"},{"id":2,"key":"INACTIVE","value":"Inactiva"},
  {"id":3,"key":"UNKNOWN","value":"Desconocido"}]');
select pg_temp.seed('currency', 'code', 'name', '[{"id":1,"key":"ARS","value":"Peso argentino"}]');
select pg_temp.seed('debt_status', 'key', 'value', '[
  {"id":1,"key":"ACTIVE","value":"Vigente"},{"id":2,"key":"OVERDUE","value":"Vencida"},
  {"id":3,"key":"PAYMENT_PLAN","value":"Plan de pago"},{"id":4,"key":"JUDICIAL","value":"Judicial"},
  {"id":5,"key":"CERTIFICATE_ACTIVE","value":"Certificado activo"},{"id":6,"key":"PAID","value":"Pagada"},
  {"id":7,"key":"CANCELLED","value":"Cancelada"},{"id":8,"key":"UNKNOWN","value":"Desconocido"},
  {"id":9,"key":"SUSPENDED","value":"Suspendida"}]');
select pg_temp.seed('contact_type', 'key', 'value', '[
  {"id":1,"key":"PHONE","value":"Telefono"},{"id":2,"key":"MOBILE","value":"Celular"},
  {"id":3,"key":"EMAIL","value":"Email"},{"id":4,"key":"LETTER","value":"Carta"},
  {"id":5,"key":"WHATSAPP","value":"WhatsApp"}]');
select pg_temp.seed('debtor_type', 'key', 'value', '[
  {"id":1,"key":"INMUEBLE","value":"Inmueble"},{"id":3,"key":"RODADO","value":"Rodado"},
  {"id":6,"key":"AGUA","value":"Agua"}]');

-- Catalogo de roles como el de la base original: 1 ADMIN, 2 USER. El tercero NO es un rol del producto:
-- existe solo para probar que una cuenta con un rol que la aplicacion no reconoce recibe un mensaje y no entra.
select pg_temp.seed('role', 'name', 'description', '[
  {"id":1,"key":"ADMIN","value":"Administrador del sistema"},
  {"id":2,"key":"USER","value":"Usuario estándar"},
  {"id":3,"key":"ROL_DE_PRUEBA_NO_RECONOCIDO","value":"Solo entorno local: prueba del rechazo de un rol no reconocido"}]');

-- Dos municipios sinteticos. A recibe la cartera por «Cargar CSV»; B queda sin cartera para probar el aislamiento.
do $$
declare expected record; found_id bigint;
begin
  for expected in select * from (values (1, 'Municipio sintético A'), (2, 'Municipio sintético B')) v(id, name) loop
    select id into found_id from public.tenant where name = expected.name;
    if found_id is null then
      insert into public.tenant(name) values (expected.name) returning id into found_id;
    end if;
    if found_id <> expected.id then
      raise exception 'El municipio % quedo con id %, se esperaba %. Usar un proyecto local recien creado', expected.name, found_id, expected.id;
    end if;
  end loop;
end $$;

commit;
