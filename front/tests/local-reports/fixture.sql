-- ALIGN-028. SOLO base local, con turno. Datos totalmente sinteticos, sobre case-review-fixtures.sql (ALIGN-018).
-- Cartera evaluable con celdas hostiles en el municipio A, y filas marcadas del municipio B para detectar fugas.
-- IDs reservados 928001..928999. Para limpiar: db reset.
begin;
do $$ begin
  if (select count(*) from public.tenant where id in (920001, 920002)) <> 2 then
    raise exception 'Faltan las semillas de ALIGN-018';
  end if;
end $$;

-- Dos membresias: supervisor en B (semilla) y consulta en A. Sin seleccion no entra.
insert into public.tenant_user(id, tenant, "user", role, status) values (928001, 920001, 920008, 920001, true);

insert into public.debtor_type(id, key, value) values (928001, 'A028', 'Tributo sintetico; "A028"');
insert into public.contact_type(id, key, value) values (928001, 'A028', 'Email sintetico');
insert into public.debt_status(id, key, value)
  select 928001, 'OVERDUE', 'Vencida' where not exists(select 1 from public.debt_status where key = 'OVERDUE');

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

-- Un lote publicado que el lector de cartera todavia no usa: el reporte no debe adoptar su corte
-- mientras las reglas calculen con otra fecha.
insert into public.import_batch(tenant, source, file_hashes, as_of, rules_version, status, created_by, created_by_role, idempotency_key) values
  (920001, 'WEB', jsonb_build_object('cartera', repeat('a', 64)), '2026-08-31', '1.0.0', 'PUBLICADO', 920004, 'importador', gen_random_uuid());

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
  (928402, 920001, 928102, '1.0.0', '2026-09-30', 'MODIFICA', 'RECORDATORIO_INFORMATIVO', 2, 'DATO_DESACTUALIZADO', 'TP-A028-TEXTO-LIBRE', 920002, '2026-10-03T15:30:00Z', null),
  (928403, 920001, 928102, '1.0.0', '2026-09-30', 'RECHAZA', null, null, 'CASO_YA_GESTIONADO', 'TP-A028-TEXTO-LIBRE', 920002, '2026-10-04T15:30:00Z', 928402),
  (928404, 920001, 928103, '1.0.0', '2026-09-30', 'MODIFICA', 'INTIMACION', 3, 'REINCIDENCIA', null, 920002, '2026-10-05T15:30:00Z', null),
  (928405, 920001, 928104, '1.0.0', '2026-09-30', 'MODIFICA', 'INTIMACION', 3, 'REINCIDENCIA', null, 920002, '2026-10-06T15:30:00Z', null),
  (928406, 920001, 928105, '1.0.0', '2026-09-30', 'MODIFICA', 'PROCURACION', 4, 'FORMULA_NO', null, 920002, '2026-10-07T15:30:00Z', null),
  (928407, 920001, 928106, '1.1.0', '2026-10-15', 'POSPONE', null, null, 'ESPERA_DATOS', null, 920002, '2026-10-16T15:30:00Z', null),
  (928408, 920001, 928107, '1.0.0', '2026-09-30', 'DERIVA', null, null, 'OTRA_AREA', null, 920002, '2026-10-25T02:00:00Z', null),
  (928499, 920002, 928201, '1.0.0', '2026-09-30', 'RECHAZA', null, null, 'TP_A028_AJENO_B', 'TP-A028-AJENO-B', 920007, '2026-10-08T15:30:00Z', null)
) as rows(id, tenant, debtor, version, cutoff, decision, intervention, intensity, code, free_text, reviewer, created, supersedes);

insert into public.case_review_approval(id, tenant, case_review, decision, reason_code, checklist, approver, approver_role, created_at, supersedes, idempotency_key)
overriding system value
select id, 920001, review, decision, code,
  case when decision = 'APRUEBA' then '{"situacion_hogar":"NO_DISPONIBLE","estado_juridico_verificado":true,"canal_valido":true,"alternativa_asistida_ofrecida":true}'::jsonb else '{}'::jsonb end,
  920003, 'supervisor', '2026-10-20T10:00:00Z', supersedes, gen_random_uuid()
from (values
  (928501::bigint, 928405::bigint, 'APRUEBA', null::text, null::bigint),
  (928502, 928406, 'APRUEBA', null, null),
  (928503, 928406, 'OBJETA', 'FALTA_ALTERNATIVA', 928502)
) as rows(id, review, decision, code, supersedes);
commit;
