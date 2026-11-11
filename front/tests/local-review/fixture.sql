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
-- Noche 7: los roles 920001/920002 son USER/ADMIN (case-review-fixtures.sql).
-- Dos membresias: otro-operador es ADMIN en el municipio B y USER en el A. Sin seleccion no entra, y la cookie no suma permisos.
insert into public.tenant_user(id, tenant, "user", role, status) values
  (920010, 920001, 920007, 920001, true),
  (920011, 920002, 920009, 920005, true);

insert into public.debt_status(id, key, value) values (920001, 'OVERDUE', 'Vencida');
insert into public.contact_type(id, key, value) values (920001, 'EMAIL', 'Email sintetico');

insert into public.debtor(id, tenant, external_id, identifier, description) values
  (920011, 920001, 920011, 'TP-A020-1', 'Objeto sintetico de doble envio'),
  (920012, 920001, 920012, 'TP-A020-2', 'Objeto sintetico de propuesta intensa'),
  (920013, 920001, 920013, 'TP-A020-3', 'Objeto sintetico de insumos cambiados'),
  (920014, 920001, 920014, 'TP-A020-4', 'Objeto sintetico de cadena'),
  (920015, 920001, 920015, 'TP-A020-5', 'Objeto sintetico sin contacto'),
  (920016, 920001, 920016, 'TP-A020-6', 'Intercalacion: registro con lote publicado'),
  (920017, 920001, 920017, 'TP-A020-7', 'Intercalacion: aprobacion con lote validado'),
  (920018, 920001, 920018, 'TP-A020-8', 'Intercalacion: sin cambios'),
  (920019, 920001, 920019, 'TP-A020-9', 'Intercalacion: doble envio'),
  (920021, 920001, 920021, 'TP-A020-10', 'Intercalacion: registro esperando el bloqueo de lotes'),
  (920022, 920001, 920022, 'TP-A020-11', 'Intercalacion: aprobacion esperando el bloqueo de lotes'),
  (920023, 920001, 920023, 'TP-A020-12', 'Intercalacion: objecion con lote validado');

insert into public.debt(id, external_id, debtor, original_amount, current_amount, due_date, status) values
  (920001, 920001, 920001, 900000, 950000.50, '2026-03-01', 920001),
  (920002, 920002, 920001, 1000, 1250.25, '2026-09-15', 920001),
  (920011, 920011, 920011, 500000, 520000, '2026-06-01', 920001),
  (920012, 920012, 920012, 800000, 815000, '2026-02-01', 920001),
  (920013, 920013, 920013, 800000, 815000, '2026-02-01', 920001),
  (920014, 920014, 920014, 300000, 310000, '2026-05-01', 920001),
  (920015, 920015, 920015, 300000, 310000, '2026-05-01', 920001),
  (920016, 920016, 920016, 800000, 815000, '2026-02-01', 920001),
  (920017, 920017, 920017, 800000, 815000, '2026-02-01', 920001),
  (920018, 920018, 920018, 800000, 815000, '2026-02-01', 920001),
  (920019, 920019, 920019, 800000, 815000, '2026-02-01', 920001),
  (920021, 920021, 920021, 800000, 815000, '2026-02-01', 920001),
  (920022, 920022, 920022, 800000, 815000, '2026-02-01', 920001),
  (920023, 920023, 920023, 800000, 815000, '2026-02-01', 920001),
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
  (920016, 920016, 920002, 100, true),
  (920017, 920017, 920002, 100, true),
  (920018, 920018, 920002, 100, true),
  (920019, 920019, 920002, 100, true),
  (920021, 920021, 920002, 100, true),
  (920022, 920022, 920002, 100, true),
  (920023, 920023, 920002, 100, true),
  (920020, 920002, 920004, 100, true);

insert into public.debtor_contact(id, person, type, value, active) values
  (920001, 920001, 920001, 'tp-a020-compartida@example.test', true),
  (920002, 920002, 920001, 'tp-a020-objeto@example.test', true),
  (920003, 920003, 920001, 'tp-a020-baja@example.test', false),
  (920004, 920004, 920001, 'tp-a020-otro@example.test', true);
commit;
