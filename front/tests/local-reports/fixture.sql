-- ALIGN-028. SOLO base local, con turno. Datos totalmente sinteticos, sobre case-review-fixtures.sql (ALIGN-018).
-- Cartera evaluable con celdas hostiles en el municipio A, y filas marcadas del municipio B para detectar fugas.
-- IDs reservados 928001..928999. Para limpiar: db reset.
-- Noche 7: los roles del producto son ADMIN y USER (migracion 20261110100000_admin_user_access). Las cuentas de
-- ALIGN-018 conservan su etiqueta (consulta, operador, ...), que es el nombre de la CUENTA, no del rol:
-- case-review-fixtures.sql ya les asigna ADMIN o USER (importador = ADMIN); abajo se reafirma y se ajusta lo propio
-- de esta campana (otro-operador = USER en B). Las revisiones guardadas conservan `reviewer_role = 'operador'`: son
-- el dato historico que los reportes exportan como tal.
begin;
do $$ begin
  if (select count(*) from public.tenant where id in (920001, 920002)) <> 2 then
    raise exception 'Faltan las semillas de ALIGN-018';
  end if;
end $$;

-- Roles del producto, por nombre exacto. La inicializacion local puede haberlos sembrado ya.
insert into public.role(id, name, description)
select v.id, v.name, v.description
from (values (928011::bigint, 'ADMIN', 'Administrador'), (928012::bigint, 'USER', 'Usuario')) as v(id, name, description)
where not exists(select 1 from public.role r where r.name = v.name);

-- Cuenta -> rol. A: consulta USER; operador ADMIN (registra); supervisor ADMIN (aprueba); importador ADMIN; inactivo
-- ADMIN con la membresia inactiva. B: otro-operador USER; otro-supervisor ADMIN.
update public.tenant_user set role = (select id from public.role where name = 'ADMIN') where id in (920002, 920003, 920004, 920006, 920008);
update public.tenant_user set role = (select id from public.role where name = 'USER') where id in (920001, 920007);

-- Dos membresias: ADMIN en B (semilla) y USER en A. Sin seleccion no entra.
insert into public.tenant_user(id, tenant, "user", role, status)
values (928001, 920001, 920008, (select id from public.role where name = 'USER'), true);

insert into public.debtor_type(id, key, value) values (928001, 'A028', 'Tributo sintetico; "A028"');
insert into public.contact_type(id, key, value) values (928001, 'A028', 'Email sintetico');
insert into public.debt_status(id, key, value)
  select 928001, 'OVERDUE', 'Vencida' where not exists(select 1 from public.debt_status where key = 'OVERDUE');
-- Reglas 1.1.0: una obligacion pagada suma al total registrado y no a la deuda pendiente ni a la vencida.
insert into public.debt_status(id, key, value)
  select 928002, 'PAID', 'Pagada' where not exists(select 1 from public.debt_status where key = 'PAID');

insert into public.debtor(id, tenant, external_id, type, identifier, description) values
  (928101, 920001, 928101, 928001, 'TP-A028-CONTACTO', 'TP-A028-DESCRIPCION-SECRETA'),
  (928102, 920001, 928102, 928001, 'TP-A028-SIN-CONTACTO', 'TP-A028-DESCRIPCION-SECRETA'),
  (928103, 920001, 928103, 928001, '=HYPERLINK("http://x.example","y")', 'TP-A028-DESCRIPCION-SECRETA'),
  (928104, 920001, 928104, 928001, '-2+3', 'TP-A028-DESCRIPCION-SECRETA'),
  (928105, 920001, 928105, 928001, '@SUM(A1)', 'TP-A028-DESCRIPCION-SECRETA'),
  (928106, 920001, 928106, 928001, 'TP-A028-NEGATIVO', 'TP-A028-DESCRIPCION-SECRETA'),
  (928107, 920001, 928107, 928001, 'TP-A028-SIN-VENCIMIENTO', 'TP-A028-DESCRIPCION-SECRETA'),
  (928201, 920002, 928201, 928001, 'TP-A028-AJENO-B', 'TP-A028-AJENO-B');

insert into public.debt(id, external_id, debtor, original_amount, current_amount, due_date, status)
select id, id, debtor, greatest(amount, 0), amount, due, (select d.id from public.debt_status d where d.key = 'OVERDUE')
from (values
  (928101::bigint, 928101::bigint, 950000.50::numeric, '2026-03-01'::date),
  (928102, 928101, 1250.25, '2026-09-15'),
  (928103, 928102, 815000, '2026-02-01'),
  (928104, 928103, 120000.75, '2026-06-01'),
  (928105, 928104, 80000, '2026-07-01'),
  (928106, 928105, 310000, '2026-05-01'),
  (928107, 928106, -50, '2026-04-01'),
  (928108, 928107, 300, null),
  (928201, 928201, 777000, '2026-03-01')
) as rows(id, debtor, amount, due);

insert into public.debt(id, external_id, debtor, original_amount, current_amount, due_date, status)
values (928109, 928109, 928101, 700, 700, '2026-02-01', (select d.id from public.debt_status d where d.key = 'PAID'));

insert into public.person(id, external_id, full_name, document_number) values
  (928301, 928301, 'TP-A028-PERSONA-UNO', 'TP-A028-DOC-UNO'),
  (928302, 928302, 'TP-A028-PERSONA-DOS', 'TP-A028-DOC-DOS'),
  (928399, 928399, 'TP-A028-AJENO-B', 'TP-A028-AJENO-B');

insert into public.debtor_person(id, debtor, person, role, priority) values
  (928301, 928101, 928301, 'Titular', 100),
  (928302, 928102, 928302, 'Titular', 100),
  (928303, 928103, 928301, 'Titular', 100),
  (928304, 928104, 928301, 'Titular', 100),
  (928305, 928105, 928301, 'Titular', 100),
  (928306, 928106, 928301, 'Titular', 100),
  (928307, 928107, 928301, 'Titular', 100),
  (928399, 928201, 928399, 'Titular', 100);

insert into public.debtor_contact(id, person, type, value) values
  (928301, 928301, 928001, 'tp-a028-uno@example.test'),
  (928399, 928399, 928001, 'tp-a028-ajeno-b@example.test');

-- Lote publicado: desde la integracion de la fecha de la cartera, el lector y los cinco reportes usan su fecha
-- (fecha_cartera y, en cola y calidad, fecha_corte). Es la fecha de la decision 928407 (reglas 1.1.0): esa queda
-- al dia y las demas, registradas al 30/09 con las reglas 1.0.0, salen con datos_anteriores = SI.
-- created_by_role conserva el rol de entonces: es un registro historico.
insert into public.import_batch(tenant, source, file_hashes, as_of, rules_version, status, created_by, created_by_role, idempotency_key) values
  (920001, 'WEB', jsonb_build_object('cartera', repeat('a', 64)), '2026-10-15', '1.1.0', 'PUBLICADO', 920004, 'importador', gen_random_uuid());

-- Revisiones. Los eventos reemplazados y la cadena de aprobacion cubren los casos de los reportes.
insert into public.case_review(id, tenant, debtor, rules_version, as_of, inputs_hash, suggested_intervention, suggested_intensity, explanation,
  decision, decided_intervention, decided_intensity, reason_code, reason_text, checklist, reviewer, reviewer_role, created_at, supersedes, idempotency_key)
overriding system value
select id, tenant, debtor, version, cutoff, repeat('b', 64), 'SEGUIMIENTO', 1, '{"texto":"TP-A028-EXPLICACION-SECRETA"}'::jsonb,
  decision, intervention, intensity, code, free_text,
  case when intensity >= 3 then '{"situacion_hogar":"NO_DISPONIBLE","estado_juridico_verificado":true,"canal_valido":true,"alternativa_asistida_ofrecida":true}'::jsonb else '{}'::jsonb end,
  reviewer, 'operador', created, supersedes, gen_random_uuid()
from (values
  (928401::bigint, 920001::bigint, 928101::bigint, '1.0.0', '2026-09-30'::date, 'ACEPTA', 'SEGUIMIENTO', 1, null::text, null::text, 920002::bigint, '2026-10-02T15:30:00Z'::timestamptz, null::bigint),
  (928402, 920001, 928102, '1.0.0', '2026-09-30', 'MODIFICA', 'RECORDATORIO_INFORMATIVO', 2, 'DATOS_INCOMPLETOS', 'TP-A028-TEXTO-LIBRE', 920002, '2026-10-03T15:30:00Z', null),
  (928403, 920001, 928102, '1.0.0', '2026-09-30', 'RECHAZA', null, null, 'GESTION_EN_CURSO', 'TP-A028-TEXTO-LIBRE', 920002, '2026-10-04T15:30:00Z', 928402),
  (928404, 920001, 928103, '1.0.0', '2026-09-30', 'MODIFICA', 'INTIMACION_ADMINISTRATIVA', 3, 'CRITERIO_DEL_SERVICIO', null, 920002, '2026-10-05T15:30:00Z', null),
  (928405, 920001, 928104, '1.0.0', '2026-09-30', 'MODIFICA', 'INTIMACION_ADMINISTRATIVA', 3, 'CRITERIO_DEL_SERVICIO', null, 920002, '2026-10-06T15:30:00Z', null),
  (928406, 920001, 928105, '1.0.0', '2026-09-30', 'MODIFICA', 'DERIVACION_PROCURACION', 4, 'VERIFICACION_JURIDICA', null, 920002, '2026-10-07T15:30:00Z', null),
  (928407, 920001, 928106, '1.1.0', '2026-10-15', 'POSPONE', null, null, 'ESPERA_DE_INFORMACION', null, 920002, '2026-10-16T15:30:00Z', null),
  (928408, 920001, 928107, '1.0.0', '2026-09-30', 'DERIVA', null, null, 'CORRESPONDE_A_OTRA_AREA', null, 920002, '2026-10-25T02:00:00Z', null),
  (928499, 920002, 928201, '1.0.0', '2026-09-30', 'RECHAZA', null, null, 'TP_A028_AJENO_B', 'TP-A028-AJENO-B', 920007, '2026-10-08T15:30:00Z', null)
) as rows(id, tenant, debtor, version, cutoff, decision, intervention, intensity, code, free_text, reviewer, created, supersedes);

-- B1 de la revision: codigos que cumplen el formato de la base y llevan un nombre y un documento, todos sinteticos.
-- La fila se inserta directo porque el rol tambien se prueba hostil: las funciones de servidor lo fijan solas.
insert into public.case_review(id, tenant, debtor, rules_version, as_of, inputs_hash, suggested_intervention, suggested_intensity, explanation,
  decision, decided_intervention, decided_intensity, reason_code, checklist, reviewer, reviewer_role, created_at, idempotency_key)
overriding system value values
  (928409, 920001, 920001, '1.0.0', '2026-09-30', repeat('b', 64), 'MARTA_DIAZ_DNI_11222333', 1, '{}'::jsonb,
   'MODIFICA', 'ALICIA_ROJAS_DNI_12345678', 2, 'ANA_PEREZ_DNI_12345678', '{}'::jsonb, 920002, 'SILVIA_PAZ', '2026-10-09T15:30:00Z', gen_random_uuid()),
  (928410, 920001, 920001, '1.0.0', '2026-09-30', repeat('b', 64), 'SEGUIMIENTO', 1, '{}'::jsonb,
   'MODIFICA', 'INTIMACION_ADMINISTRATIVA', 3, 'PEDRO_SOSA_DNI_44555666',
   '{"situacion_hogar":"NO_DISPONIBLE","estado_juridico_verificado":true,"canal_valido":true,"alternativa_asistida_ofrecida":true}'::jsonb,
   920002, 'operador', '2026-10-10T15:30:00Z', gen_random_uuid());

insert into public.case_review_approval(id, tenant, case_review, decision, reason_code, checklist, approver, approver_role, created_at, supersedes, idempotency_key)
overriding system value
select id, 920001, review, decision, code,
  case when decision = 'APRUEBA' then '{"situacion_hogar":"NO_DISPONIBLE","estado_juridico_verificado":true,"canal_valido":true,"alternativa_asistida_ofrecida":true}'::jsonb else '{}'::jsonb end,
  920003, 'supervisor', '2026-10-20T10:00:00Z', supersedes, gen_random_uuid()
from (values
  (928501::bigint, 928405::bigint, 'APRUEBA', null::text, null::bigint),
  (928502, 928406, 'APRUEBA', null, null),
  (928503, 928406, 'OBJETA', 'ALTERNATIVA_NO_OFRECIDA', 928502),
  (928504, 928410, 'OBJETA', 'LUIS_GOMEZ_DNI_87654321', null)
) as rows(id, review, decision, code, supersedes);
commit;
