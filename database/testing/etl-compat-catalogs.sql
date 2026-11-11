-- ALIGN-017. SOLO base local aislada con 20261030090000_etl_compat. Datos sinteticos.
-- Catalogos con claves estables: el ETL los resuelve por key, sin IDs fijos (ALIGN-026).
-- Mismos conteos que el original (informe de input §2), mas debt_status SUSPENDED: el contrato de origen
-- distingue SUSPENDIDA y el original tiene 8 estados cuyas claves no se observaron (homologar en ALIGN-046).
-- Excluyente con e06: comparte claves unicas ARS, OVERDUE, EMAIL y ACTIVE (fixtures.sql:15-21).
-- Ante un choque de id o clave falla sin modificar nada. Repetirlo no cambia la base.
-- psql -v ON_ERROR_STOP=1 -f database/testing/etl-compat-catalogs.sql (ver SUPABASE_TESTING_CALIDAD.md).
begin;
do $$ begin
  if not exists(select 1 from supabase_migrations.schema_migrations where version='20261030090000') then
    raise exception 'Requiere la migracion 20261030090000_etl_compat (solo base local)';
  end if;
end $$;

create function pg_temp.etl_seed(tbl text, key_col text, value_col text, seed jsonb) returns void
language plpgsql as $f$
declare collisions integer;
begin
  execute format('select count(*) from public.%1$I c join jsonb_to_recordset($1) s(id bigint, key text, value text)
    on c.id = s.id or c.%2$I = s.key where c.id <> s.id or c.%2$I is distinct from s.key', tbl, key_col)
    into collisions using seed;
  if collisions > 0 then
    raise exception 'Colision en %: % fila(s) con id o clave del ETL (p. ej. fixtures e06). Usar una base recien reconstruida', tbl, collisions;
  end if;
  execute format('insert into public.%1$I(id, %2$I, %3$I) select s.id, s.key, s.value
    from jsonb_to_recordset($1) s(id bigint, key text, value text)
    where not exists(select 1 from public.%1$I c where c.id = s.id)', tbl, key_col, value_col)
    using seed;
end $f$;

select pg_temp.etl_seed('document_type', 'key', 'value', '[
  {"id":1,"key":"DNI","value":"DNI"},{"id":2,"key":"CUIT","value":"CUIT"},
  {"id":3,"key":"CUIL","value":"CUIL"},{"id":4,"key":"UNKNOWN","value":"Desconocido"}]');
select pg_temp.etl_seed('person_type', 'key', 'value', '[
  {"id":1,"key":"INDIVIDUAL","value":"Persona humana"},{"id":2,"key":"LEGAL_PERSON","value":"Persona juridica"},
  {"id":3,"key":"COMPANY","value":"Empresa"},{"id":4,"key":"ASSOCIATION","value":"Asociacion"},
  {"id":5,"key":"UNKNOWN","value":"Desconocido"}]');
select pg_temp.etl_seed('person_status', 'key', 'value', '[
  {"id":1,"key":"ACTIVE","value":"Activa"},{"id":2,"key":"INACTIVE","value":"Inactiva"},
  {"id":3,"key":"UNKNOWN","value":"Desconocido"}]');
select pg_temp.etl_seed('currency', 'code', 'name', '[{"id":1,"key":"ARS","value":"Peso argentino"}]');
select pg_temp.etl_seed('debt_status', 'key', 'value', '[
  {"id":1,"key":"ACTIVE","value":"Vigente"},{"id":2,"key":"OVERDUE","value":"Vencida"},
  {"id":3,"key":"PAYMENT_PLAN","value":"Plan de pago"},{"id":4,"key":"JUDICIAL","value":"Judicial"},
  {"id":5,"key":"CERTIFICATE_ACTIVE","value":"Certificado activo"},{"id":6,"key":"PAID","value":"Pagada"},
  {"id":7,"key":"CANCELLED","value":"Cancelada"},{"id":8,"key":"UNKNOWN","value":"Desconocido"},
  {"id":9,"key":"SUSPENDED","value":"Suspendida"}]');
select pg_temp.etl_seed('contact_type', 'key', 'value', '[
  {"id":1,"key":"PHONE","value":"Telefono"},{"id":2,"key":"MOBILE","value":"Celular"},
  {"id":3,"key":"EMAIL","value":"Email"},{"id":4,"key":"LETTER","value":"Carta"},
  {"id":5,"key":"WHATSAPP","value":"WhatsApp"}]');
-- El perfil del lote mapea Bien_Tipo_Id a estas claves (contrato de origen). IDs propios de esta base.
select pg_temp.etl_seed('debtor_type', 'key', 'value', '[
  {"id":1,"key":"INMUEBLE","value":"Inmueble"},{"id":3,"key":"RODADO","value":"Rodado"},
  {"id":6,"key":"AGUA","value":"Agua"}]');

-- Precondicion del ETL actual: tenant 1 fijo (back/ETL/config.py:21). Su id lo genera la identidad.
do $$
declare new_id bigint;
begin
  if exists(select 1 from public.tenant where id=1 and name='Municipio sintetico ETL') then return; end if;
  insert into public.tenant(name) values('Municipio sintetico ETL') returning id into new_id;
  if new_id <> 1 then raise exception 'La identidad de tenant dio %, el ETL actual exige 1. Usar una base recien reconstruida', new_id; end if;
end $$;
commit;
