-- ALIGN-020. SOLO base local, con turno. Datos totalmente sinteticos, sobre case-review-fixtures.sql (ALIGN-018).
-- Cartera con importes, vencimientos, personas y contactos: un lote VALIDADO real, no un objeto vacio.
-- Sin lotes ni revisiones: los lotes los registra la prueba por la funcion de servidor. Para limpiar: db reset.
begin;
do $$ begin
  if (select count(*) from public.tenant where id in (920001, 920002)) <> 2 then
    raise exception 'Faltan las semillas de ALIGN-018';
  end if;
end $$;

-- Compatibilidad E06, de solo lectura. La cuenta `importador` queda con este rol para probarlo con una sesion real;
-- los lotes los registra importador_sistema, que no inicia sesion.
insert into public.role(id, name, description) values (920010, 'tp_operator', 'Compatibilidad E06: solo lectura');
update public.tenant_user set role = 920010 where id = 920004;
-- Dos membresias: operador en el municipio B, consulta en el A. Sin seleccion no entra, y la cookie no suma permisos.
insert into public.tenant_user(id, tenant, "user", role, status) values (920010, 920001, 920007, 920001, true);

insert into public.debt_status(id, key, value) values (920001, 'OVERDUE', 'Vencida');
insert into public.contact_type(id, key, value) values (920001, 'EMAIL', 'Email sintetico');

insert into public.debtor(id, tenant, external_id, identifier, description) values
  (920011, 920001, 920011, 'TP-A020-1', 'Objeto sintetico de doble envio'),
  (920012, 920001, 920012, 'TP-A020-2', 'Objeto sintetico de propuesta intensa'),
  (920013, 920001, 920013, 'TP-A020-3', 'Objeto sintetico de insumos cambiados'),
  (920014, 920001, 920014, 'TP-A020-4', 'Objeto sintetico de cadena'),
  (920015, 920001, 920015, 'TP-A020-5', 'Objeto sintetico sin contacto');

insert into public.debt(id, external_id, debtor, original_amount, current_amount, due_date, status) values
  (920001, 920001, 920001, 900000, 950000.50, '2026-03-01', 920001),
  (920002, 920002, 920001, 1000, 1250.25, '2026-09-15', 920001),
  (920011, 920011, 920011, 500000, 520000, '2026-06-01', 920001),
  (920012, 920012, 920012, 800000, 815000, '2026-02-01', 920001),
  (920013, 920013, 920013, 800000, 815000, '2026-02-01', 920001),
  (920014, 920014, 920014, 300000, 310000, '2026-05-01', 920001),
  (920015, 920015, 920015, 300000, 310000, '2026-05-01', 920001),
  (920002000, 920002000, 920002, 777000, 777000, '2026-03-01', 920001);

insert into public.person(id, external_id, full_name) values
  (920001, 920001, 'TP-A020 Persona compartida'),
  (920002, 920002, 'TP-A020 Persona de un objeto'),
  (920003, 920003, 'TP-A020 Persona de baja'),
  (920004, 920004, 'TP-A020 Persona de otro municipio');

-- Una persona compartida entre objetos y una relacion inactiva: el recorte por objeto no puede mezclarlas.
insert into public.debtor_person(id, debtor, person, priority, active) values
  (920001, 920001, 920001, 60, true),
  (920002, 920001, 920002, 40, true),
  (920003, 920001, 920003, 100, false),
  (920011, 920011, 920001, 100, true),
  (920012, 920012, 920001, 100, true),
  (920013, 920013, 920002, 100, true),
  (920014, 920014, 920002, 100, true),
  (920015, 920015, 920003, 100, true),
  (920020, 920002, 920004, 100, true);

insert into public.debtor_contact(id, person, type, value, active) values
  (920001, 920001, 920001, 'tp-a020-compartida@example.test', true),
  (920002, 920002, 920001, 'tp-a020-objeto@example.test', true),
  (920003, 920003, 920001, 'tp-a020-baja@example.test', false),
  (920004, 920004, 920001, 'tp-a020-otro@example.test', true);
commit;
