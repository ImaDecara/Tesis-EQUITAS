-- ALIGN-018. Pruebas de comportamiento por rol. SOLO base local aislada, con case-review-fixtures.sql cargado.
-- docker exec -i supabase_db_equitas-tp-testing psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -At -F '|' < database/testing/case-review-checks.sql
-- Se conecta como superusuario local solo para simular roles con SET LOCAL ROLE: el superusuario no ejecuta las pruebas.
-- Todo corre en una transaccion que termina en ROLLBACK: no deja filas ni cambios de esquema. Publica solo codigos y conteos, sin valores de filas.
-- Sale con error si algun caso no da lo esperado.
begin;

create temporary table a018_result(n serial, caso text, esperado text, obtenido text) on commit drop;

create function pg_temp.probe(p_role text, p_sub uuid, p_sql text, p_keep boolean default false) returns text
language plpgsql as $f$
declare v text;
begin
  begin
    perform set_config('request.jwt.claims', case when p_sub is null then '' else json_build_object('sub', p_sub, 'role', p_role)::text end, true);
    execute format('set local role %I', p_role);
    execute p_sql;
    if not p_keep then raise exception 'PROBE_OK' using errcode = 'EQ000'; end if;
    v := 'OK';
  exception when others then
    v := case when sqlstate = 'EQ000' then 'OK' when sqlstate = 'P0001' then sqlerrm else sqlstate end;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end $f$;

create function pg_temp.scalar(p_role text, p_sub uuid, p_sql text) returns text
language plpgsql as $f$
declare v text;
begin
  begin
    perform set_config('request.jwt.claims', case when p_sub is null then '' else json_build_object('sub', p_sub, 'role', p_role)::text end, true);
    execute format('set local role %I', p_role);
    execute p_sql into v;
    raise exception 'PROBE_OK' using errcode = 'EQ000';
  exception when others then
    if sqlstate <> 'EQ000' then v := case when sqlstate = 'P0001' then sqlerrm else sqlstate end; end if;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end $f$;

create function pg_temp.expect(p_caso text, p_esperado text, p_obtenido text) returns void
language sql as $f$
  insert into a018_result(caso, esperado, obtenido) values (p_caso, p_esperado, p_obtenido);
$f$;

-- ALIGN-020: evento PUBLICADO por debajo de la funcion, para fijar el corte vigente de cada municipio. Lo guarda en a018.corte_<tenant>.
create function pg_temp.publish_cutoff(p_tenant bigint, p_as_of date default '2026-10-30') returns bigint
language plpgsql as $f$
declare v bigint;
begin
  insert into public.import_batch(tenant, source, file_hashes, as_of, rules_version, status, created_by, created_by_role, idempotency_key)
  values (p_tenant, 'ETL_CLI', jsonb_build_object('cabecera', repeat('b', 64)), p_as_of, '1.0.0', 'PUBLICADO', 920004, 'importador', gen_random_uuid())
  returning id into v;
  perform set_config('a018.corte_' || p_tenant, v::text, true);
  return v;
end $f$;

-- Llamadas con valores validos por defecto: cada caso cambia solo lo que prueba.
create function pg_temp.review(p_user bigint, p_tenant bigint, p_debtor bigint, p_decision text default 'ACEPTA', p_extra text default null) returns text
language sql as $f$
  select format($s$select set_config('a018.id', r.review_id::text, true) from public.record_case_review(
    p_reviewer_user => %s, p_tenant => %s, p_debtor => %s, p_cutoff_batch => %s, p_rules_version => '1.0.0', p_as_of => '2026-10-30',
    p_inputs_hash => repeat('a', 64), p_suggested_intervention => 'RECORDATORIO_INFORMATIVO', p_suggested_intensity => 1,
    p_explanation => '{"factores":[]}', p_decision => %L, p_idempotency_key => gen_random_uuid()%s) r$s$,
    p_user, p_tenant, p_debtor, coalesce(current_setting('a018.corte_' || p_tenant, true), 'null'), p_decision,
    coalesce(', ' || p_extra, case when p_decision = 'ACEPTA' then ', p_decided_intervention => ''RECORDATORIO_INFORMATIVO'', p_decided_intensity => 1' else '' end));
$f$;

create function pg_temp.approval(p_user bigint, p_tenant bigint, p_review bigint, p_decision text default 'APRUEBA', p_extra text default null) returns text
language sql as $f$
  select format($s$select set_config('a018.id', r.approval_id::text, true) from public.record_case_review_approval(
    p_approver_user => %s, p_tenant => %s, p_case_review => %s, p_decision => %L, p_idempotency_key => gen_random_uuid(), p_cutoff_batch => %s%s) r$s$,
    p_user, p_tenant, p_review, p_decision, coalesce(current_setting('a018.corte_' || p_tenant, true), 'null'),
    coalesce(', ' || p_extra, case when p_decision = 'APRUEBA' then ', p_checklist => ''{"situacion_hogar":"NO_DISPONIBLE","estado_juridico_verificado":true,"canal_valido":true,"alternativa_asistida_ofrecida":true}''' else '' end));
$f$;

create function pg_temp.batch(p_user bigint, p_tenant bigint, p_status text default 'RECIBIDO', p_extra text default null, p_hashes text default '{"cabecera":"bbbb"}') returns text
language sql as $f$
  select format($s$select set_config('a018.id', r.batch_id::text, true) from public.record_import_batch(
    p_actor_user => %s, p_tenant => %s, p_source => 'ETL_CLI', p_file_hashes => %L, p_as_of => '2026-10-30',
    p_rules_version => '1.0.0', p_status => %L, p_idempotency_key => gen_random_uuid()%s) r$s$,
    p_user, p_tenant, replace(p_hashes, 'bbbb', repeat('b', 64)), p_status, coalesce(', ' || p_extra, ''));
$f$;

-- Filas con ID explicito, sin pasar por las funciones: para probar las restricciones por debajo de las RPC y para inyectar cadenas invalidas.
create function pg_temp.raw_review(p_rows text) returns text
language sql as $f$
  select format($s$insert into public.case_review(id, supersedes, tenant, debtor, rules_version, as_of, inputs_hash, suggested_intervention, suggested_intensity, explanation, decision, decided_intervention, decided_intensity, reason_code, checklist, reviewer, reviewer_role, idempotency_key)
    overriding system value select v.id, v.supersedes, 920001, 920001, '1.0.0', '2026-10-30'::date, repeat('a', 64), 'RECORDATORIO_INFORMATIVO', 1, '{}'::jsonb, 'MODIFICA', 'INTIMACION_ADMINISTRATIVA', 3, 'X',
      '{"situacion_hogar":"CONSULTADA","estado_juridico_verificado":true,"canal_valido":true,"alternativa_asistida_ofrecida":true}'::jsonb, 920002, 'operador', gen_random_uuid()
    from (values %s) v(id, supersedes)$s$, p_rows);
$f$;

create function pg_temp.raw_approval(p_review bigint, p_rows text) returns text
language sql as $f$
  select format($s$insert into public.case_review_approval(id, supersedes, tenant, case_review, decision, reason_code, approver, approver_role, idempotency_key)
    overriding system value select v.id, v.supersedes, 920001, %s, 'OBJETA', 'X', 920003, 'supervisor', gen_random_uuid()
    from (values %s) v(id, supersedes)$s$, p_review, p_rows);
$f$;

create function pg_temp.raw_batch(p_rows text) returns text
language sql as $f$
  select format($s$insert into public.import_batch(id, supersedes, tenant, source, file_hashes, as_of, rules_version, status, created_by, created_by_role, idempotency_key)
    overriding system value select v.id, v.supersedes, 920001, 'ETL_CLI', jsonb_build_object('cabecera', repeat('b', 64)), '2026-10-30'::date, '1.0.0', 'RECIBIDO', 920004, 'importador', gen_random_uuid()
    from (values %s) v(id, supersedes)$s$, p_rows);
$f$;

do $body$
declare
  -- IDs reservados de case-review-fixtures.sql.
  t_a constant bigint := 920001;
  t_b constant bigint := 920002;
  d_a constant bigint := 920001;
  d_b constant bigint := 920002;
  u_consulta constant bigint := 920001;
  u_operador constant bigint := 920002;
  u_supervisor constant bigint := 920003;
  u_importador constant bigint := 920004;
  u_sin constant bigint := 920005;
  u_inactivo constant bigint := 920006;
  u_otro_op constant bigint := 920007;
  u_otro_sup constant bigint := 920008;
  u_sistema constant bigint := 920009;
  ok_list constant text := 'p_checklist => ''{"situacion_hogar":"CONSULTADA","estado_juridico_verificado":true,"canal_valido":true,"alternativa_asistida_ofrecida":true}''';
  intensa constant text := 'p_decided_intervention => ''INTIMACION_ADMINISTRATIVA'', p_decided_intensity => 3, p_reason_code => ''MOTIVO_SINTETICO'', ' || ok_list;
  invalid constant text := 'INVALID_CASE_REVIEW:';
  invalid_ap constant text := 'INVALID_CASE_REVIEW_APPROVAL:';
  invalid_b constant text := 'INVALID_IMPORT_BATCH:';
  not_found constant text := 'SUPERSEDES_NOT_FOUND';
  d_a2 constant bigint := 920003;
  rol text;
  tbl text;
  sub_op uuid;
  sub_cons uuid;
  sub_sup uuid;
  sub_sin uuid;
  sub_ina uuid;
  sub_otro uuid;
  review_ok bigint;
  review_nota bigint;
  review_b bigint;
  prop bigint;
  prop2 bigint;
  prop3 bigint;
  appr bigint;
  appr_otra bigint;
  appr_b bigint;
  prop_b bigint;
  siguiente bigint;
  bat bigint;
  bat_b bigint;
  key1 uuid := gen_random_uuid();
  key2 uuid := gen_random_uuid();
  total_a text;
  total_b text;
begin
  select id into sub_op from auth.users where email = 'tp-a018-operador@example.test';
  select id into sub_cons from auth.users where email = 'tp-a018-consulta@example.test';
  select id into sub_sup from auth.users where email = 'tp-a018-supervisor@example.test';
  select id into sub_sin from auth.users where email = 'tp-a018-sin-membresia@example.test';
  select id into sub_ina from auth.users where email = 'tp-a018-inactivo@example.test';
  select id into sub_otro from auth.users where email = 'tp-a018-otro-operador@example.test';
  if sub_op is null or not exists(select 1 from public.tenant where id = t_a) then
    raise exception 'Cargar antes case-review-auth-fixtures.sql y case-review-fixtures.sql';
  end if;
  perform pg_temp.publish_cutoff(t_a);
  perform pg_temp.publish_cutoff(t_b);

  -- A. Escritura directa: falla por falta de privilegio para todos los roles de aplicacion.
  foreach rol in array array['anon', 'authenticated', 'service_role', 'equitas_review_server', 'equitas_import_server'] loop
    foreach tbl in array array['case_review', 'case_review_approval', 'import_batch'] loop
      perform pg_temp.expect(format('directo %s %s INSERT', rol, tbl), '42501', pg_temp.probe(rol, case when rol = 'authenticated' then sub_op end, format('insert into public.%I default values', tbl)));
      perform pg_temp.expect(format('directo %s %s UPDATE', rol, tbl), '42501', pg_temp.probe(rol, case when rol = 'authenticated' then sub_op end, format('update public.%I set created_at = now()', tbl)));
      perform pg_temp.expect(format('directo %s %s DELETE', rol, tbl), '42501', pg_temp.probe(rol, case when rol = 'authenticated' then sub_op end, format('delete from public.%I', tbl)));
      perform pg_temp.expect(format('directo %s %s TRUNCATE', rol, tbl), '42501', pg_temp.probe(rol, case when rol = 'authenticated' then sub_op end, format('truncate public.%I', tbl)));
    end loop;
  end loop;
  -- Operador legitimo con sugerencia, hash y version falsificados (hallazgo H2 de la decision D-16).
  perform pg_temp.expect('directo authenticated case_review procedencia falsificada', '42501', pg_temp.probe('authenticated', sub_op, format(
    $s$insert into public.case_review(tenant, debtor, rules_version, as_of, inputs_hash, suggested_intervention, suggested_intensity, explanation, decision, reviewer, reviewer_role, idempotency_key)
       values (%s, %s, '9.9.9', '2026-10-30', repeat('0', 64), 'FALSA', 2, '{}', 'RECHAZA', %s, 'operador', gen_random_uuid())$s$, t_a, d_a, u_operador)));
  perform pg_temp.expect('secuencia authenticated nextval', '42501', pg_temp.probe('authenticated', sub_op, $s$select nextval('public.case_review_id_seq')$s$));
  perform pg_temp.expect('secuencia anon setval', '42501', pg_temp.probe('anon', null, $s$select setval('public.import_batch_id_seq', 1)$s$));

  -- B. Las funciones solo las ejecuta su rol de servidor.
  foreach rol in array array['anon', 'authenticated', 'service_role', 'postgres', 'equitas_import_server'] loop
    perform pg_temp.expect(format('funcion %s record_case_review', rol), '42501', pg_temp.probe(rol, case when rol = 'authenticated' then sub_op end, pg_temp.review(u_operador, t_a, d_a)));
    perform pg_temp.expect(format('funcion %s record_case_review_approval', rol), '42501', pg_temp.probe(rol, case when rol = 'authenticated' then sub_sup end, pg_temp.approval(u_supervisor, t_a, 1)));
    perform pg_temp.expect(format('funcion %s read_case_review_reason_text', rol), '42501', pg_temp.probe(rol, case when rol = 'authenticated' then sub_op end, format('select public.read_case_review_reason_text(%s, %s, 1)', u_operador, t_a)));
  end loop;
  foreach rol in array array['anon', 'authenticated', 'service_role', 'postgres', 'equitas_review_server'] loop
    perform pg_temp.expect(format('funcion %s record_import_batch', rol), '42501', pg_temp.probe(rol, null, pg_temp.batch(u_importador, t_a)));
  end loop;
  foreach rol in array array['anon', 'authenticated', 'service_role', 'postgres', 'equitas_review_server', 'equitas_import_server'] loop
    perform pg_temp.expect(format('funcion %s equitas_member_role', rol), '42501', pg_temp.probe(rol, null, format('select public.equitas_member_role(%s, %s)', u_operador, t_a)));
  end loop;
  perform pg_temp.expect('servidor no lee tablas directamente', '42501', pg_temp.probe('equitas_review_server', null, 'select id from public.case_review'));

  -- C. Revision: actor y objeto.
  perform pg_temp.expect('revision objeto de otro tenant', 'OBJECT_NOT_IN_TENANT', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_b)));
  perform pg_temp.expect('revision objeto inexistente', 'OBJECT_NOT_IN_TENANT', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, 1)));
  perform pg_temp.expect('revision tenant ajeno al revisor', 'ACTOR_NOT_ACTIVE_MEMBER', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_b, d_b)));
  perform pg_temp.expect('revision revisor sin membresia', 'ACTOR_NOT_ACTIVE_MEMBER', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_sin, t_a, d_a)));
  perform pg_temp.expect('revision membresia inactiva', 'ACTOR_NOT_ACTIVE_MEMBER', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_inactivo, t_a, d_a)));
  perform pg_temp.expect('revision usuario inexistente', 'ACTOR_NOT_ACTIVE_MEMBER', pg_temp.probe('equitas_review_server', null, pg_temp.review(1, t_a, d_a)));
  perform pg_temp.expect('revision rol consulta', 'ROLE_NOT_ALLOWED', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_consulta, t_a, d_a)));
  perform pg_temp.expect('revision rol supervisor', 'ROLE_NOT_ALLOWED', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_supervisor, t_a, d_a)));
  perform pg_temp.expect('revision rol importador', 'ROLE_NOT_ALLOWED', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_importador, t_a, d_a)));
  perform pg_temp.expect('revision rol importador_sistema', 'ROLE_NOT_ALLOWED', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_sistema, t_a, d_a)));
  update public."user" set status = 'INACTIVE' where id = u_operador;
  perform pg_temp.expect('revision usuario no activo', 'ACTOR_NOT_ACTIVE_MEMBER', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a)));
  update public."user" set status = 'ACTIVE' where id = u_operador;
  update public.tenant set status = 'INACTIVE' where id = t_a;
  perform pg_temp.expect('revision tenant no activo', 'ACTOR_NOT_ACTIVE_MEMBER', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a)));
  update public.tenant set status = 'ACTIVE' where id = t_a;

  -- D. Revision: contenido.
  perform pg_temp.expect('decision MODIFICA sin motivo', invalid || 'case_review_decision_requires_reason', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'MODIFICA', 'p_decided_intervention => ''SEGUIMIENTO'', p_decided_intensity => 0')));
  perform pg_temp.expect('decision RECHAZA sin motivo', invalid || 'case_review_decision_requires_reason', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'RECHAZA')));
  perform pg_temp.expect('decision POSPONE sin motivo', invalid || 'case_review_decision_requires_reason', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'POSPONE')));
  perform pg_temp.expect('decision DERIVA sin motivo', invalid || 'case_review_decision_requires_reason', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'DERIVA')));
  perform pg_temp.expect('decision fuera de lista', invalid || 'case_review_decision_valid', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'OTRA', 'p_reason_code => ''X''')));
  perform pg_temp.expect('ACEPTA sin decidido', invalid || 'case_review_acepta_matches_suggestion', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'ACEPTA', 'p_reason_code => ''X''')));
  perform pg_temp.expect('ACEPTA con intensidad distinta', invalid || 'case_review_acepta_matches_suggestion', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'ACEPTA', 'p_decided_intervention => ''RECORDATORIO_INFORMATIVO'', p_decided_intensity => 2')));
  perform pg_temp.expect('MODIFICA sin cambio', invalid || 'case_review_modifica_changes_suggestion', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'MODIFICA', 'p_reason_code => ''X'', p_decided_intervention => ''RECORDATORIO_INFORMATIVO'', p_decided_intensity => 1')));
  perform pg_temp.expect('RECHAZA con intensidad', invalid || 'case_review_no_action_without_decided', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'RECHAZA', 'p_reason_code => ''X'', p_decided_intervention => ''SEGUIMIENTO'', p_decided_intensity => 1')));
  perform pg_temp.expect('intervencion e intensidad incompletas', invalid || 'case_review_decided_pair', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'DERIVA', 'p_reason_code => ''X'', p_decided_intervention => ''SEGUIMIENTO''')));
  perform pg_temp.expect('intensidad decidida fuera de rango', invalid || 'case_review_decided_intensity_range', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'MODIFICA', 'p_reason_code => ''X'', p_decided_intervention => ''SEGUIMIENTO'', p_decided_intensity => 5')));
  perform pg_temp.expect('el sistema no sugiere intensidad 3', invalid || 'case_review_suggested_intensity_range', pg_temp.probe('equitas_review_server', null, replace(pg_temp.review(u_operador, t_a, d_a, 'MODIFICA', 'p_reason_code => ''X'', p_decided_intervention => ''SEGUIMIENTO'', p_decided_intensity => 0'), 'p_suggested_intensity => 1', 'p_suggested_intensity => 3')));
  perform pg_temp.expect('hash de insumos invalido', invalid || 'case_review_inputs_hash_format', pg_temp.probe('equitas_review_server', null, replace(pg_temp.review(u_operador, t_a, d_a), 'repeat(''a'', 64)', '''abc''')));
  perform pg_temp.expect('version de reglas invalida', invalid || 'case_review_rules_version_format', pg_temp.probe('equitas_review_server', null, replace(pg_temp.review(u_operador, t_a, d_a), '''1.0.0''', '''v1''')));
  perform pg_temp.expect('version de reglas de longitud ilimitada', invalid || 'case_review_rules_version_format', pg_temp.probe('equitas_review_server', null, replace(pg_temp.review(u_operador, t_a, d_a), '''1.0.0''', quote_literal(repeat('1', 7) || '.0.0'))));
  perform pg_temp.expect('version de reglas con salto final', invalid || 'case_review_rules_version_format', pg_temp.probe('equitas_review_server', null, replace(pg_temp.review(u_operador, t_a, d_a), '''1.0.0''', quote_literal(E'1.0.0\n'))));
  perform pg_temp.expect('explicacion de mas de 16384 bytes', invalid || 'case_review_explanation_object', pg_temp.probe('equitas_review_server', null, replace(pg_temp.review(u_operador, t_a, d_a), '''{"factores":[]}''', quote_literal(jsonb_build_object('f', repeat('z', 16384))::text))));
  perform pg_temp.expect('codigo de motivo de 65 caracteres', invalid || 'case_review_reason_code_format', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'RECHAZA', format('p_reason_code => %L', 'X' || repeat('Y', 64)))));
  perform pg_temp.expect('codigo de motivo con salto final', invalid || 'case_review_reason_code_format', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'RECHAZA', format('p_reason_code => %L', E'X\n'))));
  perform pg_temp.expect('intervencion de 65 caracteres', invalid || 'case_review_decided_intervention_format', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'DERIVA', format('p_reason_code => ''X'', p_decided_intervention => %L, p_decided_intensity => 1', 'X' || repeat('Y', 64)))));
  perform pg_temp.expect('explicacion no es objeto', invalid || 'case_review_explanation_object', pg_temp.probe('equitas_review_server', null, replace(pg_temp.review(u_operador, t_a, d_a), '''{"factores":[]}''', '''[]''')));
  -- ALIGN-020: un corte nulo ya no llega a la tabla: no coincide con el del evento declarado.
  perform pg_temp.expect('corte nulo', 'CUTOFF_CHANGED', pg_temp.probe('equitas_review_server', null, replace(pg_temp.review(u_operador, t_a, d_a), '''2026-10-30''', 'null')));
  perform pg_temp.expect('texto de 501 caracteres', invalid || 'case_review_reason_text_length', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'RECHAZA', format('p_reason_code => ''X'', p_reason_text => %L', repeat('x', 501)))));
  perform pg_temp.expect('texto de 500 caracteres', 'OK', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'RECHAZA', format('p_reason_code => ''X'', p_reason_text => %L', repeat('x', 500)))));
  perform pg_temp.expect('texto en blanco', invalid || 'case_review_reason_text_not_blank', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'RECHAZA', 'p_reason_code => ''X'', p_reason_text => ''   ''')));
  perform pg_temp.expect('texto vacio', invalid || 'case_review_reason_text_not_blank', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'RECHAZA', 'p_reason_code => ''X'', p_reason_text => ''''')));
  perform pg_temp.expect('texto de tabulaciones y saltos', invalid || 'case_review_reason_text_not_blank', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'RECHAZA', format('p_reason_code => ''X'', p_reason_text => %L', E'\t\n '))));
  -- El limite mide lo que se guarda: los espacios cuentan y el texto no se normaliza.
  perform pg_temp.expect('501 espacios y una letra', invalid || 'case_review_reason_text_length', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'RECHAZA', format('p_reason_code => ''X'', p_reason_text => %L', repeat(' ', 501) || 'x'))));
  perform pg_temp.expect('una letra y 500 espacios', invalid || 'case_review_reason_text_length', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'RECHAZA', format('p_reason_code => ''X'', p_reason_text => %L', 'x' || repeat(' ', 500)))));
  perform pg_temp.expect('relleno a ambos lados, 501 en total', invalid || 'case_review_reason_text_length', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'RECHAZA', format('p_reason_code => ''X'', p_reason_text => %L', repeat(' ', 250) || 'x' || repeat(' ', 250)))));
  perform pg_temp.expect('relleno a ambos lados, 500 en total', 'OK', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'RECHAZA', format('p_reason_code => ''X'', p_reason_text => %L', repeat(' ', 250) || 'x' || repeat(' ', 249))), true));
  perform pg_temp.expect('se guarda sin normalizar: 500 con los espacios', '500', (select char_length(reason_text)::text from public.case_review where id = current_setting('a018.id')::bigint));
  perform pg_temp.expect('500 caracteres multibyte', 'OK', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'RECHAZA', format('p_reason_code => ''X'', p_reason_text => %L', repeat(chr(241), 500)))));
  perform pg_temp.expect('501 caracteres multibyte', invalid || 'case_review_reason_text_length', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'RECHAZA', format('p_reason_code => ''X'', p_reason_text => %L', repeat(chr(241), 501)))));
  perform pg_temp.expect('texto sin codigo de motivo', invalid || 'case_review_reason_text_requires_code', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'ACEPTA', 'p_decided_intervention => ''RECORDATORIO_INFORMATIVO'', p_decided_intensity => 1, p_reason_text => ''libre''')));
  perform pg_temp.expect('codigo de motivo con texto libre', invalid || 'case_review_reason_code_format', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'RECHAZA', 'p_reason_code => ''la familia no puede''')));
  perform pg_temp.expect('lista con clave desconocida', invalid || 'case_review_checklist_shape', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'ACEPTA', 'p_decided_intervention => ''RECORDATORIO_INFORMATIVO'', p_decided_intensity => 1, p_checklist => ''{"nota":"sobre el hogar"}''')));
  perform pg_temp.expect('lista con texto sobre el hogar', invalid || 'case_review_checklist_shape', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'ACEPTA', 'p_decided_intervention => ''RECORDATORIO_INFORMATIVO'', p_decided_intensity => 1, p_checklist => ''{"situacion_hogar":"sin ingresos"}''')));
  perform pg_temp.expect('lista con casilla no booleana', invalid || 'case_review_checklist_shape', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'ACEPTA', 'p_decided_intervention => ''RECORDATORIO_INFORMATIVO'', p_decided_intensity => 1, p_checklist => ''{"canal_valido":"si"}''')));
  perform pg_temp.expect('lista que no es objeto', invalid || 'case_review_checklist_shape', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'ACEPTA', 'p_decided_intervention => ''RECORDATORIO_INFORMATIVO'', p_decided_intensity => 1, p_checklist => ''[]''')));
  perform pg_temp.expect('intensidad 3 sin lista', invalid || 'case_review_intense_requires_checklist', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'MODIFICA', 'p_reason_code => ''X'', p_decided_intervention => ''INTIMACION_ADMINISTRATIVA'', p_decided_intensity => 3')));
  perform pg_temp.expect('intensidad 4 con lista incompleta', invalid || 'case_review_intense_requires_checklist', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'DERIVA', 'p_reason_code => ''X'', p_decided_intervention => ''DERIVACION_PROCURACION'', p_decided_intensity => 4, p_checklist => ''{"situacion_hogar":"NO_DISPONIBLE","canal_valido":true}''')));
  perform pg_temp.expect('intensidad 3 con casilla en falso', invalid || 'case_review_intense_requires_checklist', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'MODIFICA', 'p_reason_code => ''X'', p_decided_intervention => ''INTIMACION_ADMINISTRATIVA'', p_decided_intensity => 3, p_checklist => ''{"situacion_hogar":"CONSULTADA","estado_juridico_verificado":false,"canal_valido":true,"alternativa_asistida_ofrecida":true}''')));

  -- E. Revision: alta, fecha y rol de servidor, idempotencia, correccion.
  perform pg_temp.expect('revision valida', 'OK', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a), true));
  review_ok := current_setting('a018.id')::bigint;
  perform pg_temp.expect('fecha y rol los fija el servidor', '1', (select count(*)::text from public.case_review where id = review_ok and reviewer = u_operador and reviewer_role = 'operador' and created_at = now()));
  perform pg_temp.expect('revision de otro tenant valida', 'OK', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_otro_op, t_b, d_b), true));
  review_b := current_setting('a018.id')::bigint;
  perform pg_temp.expect('revision con motivo libre', 'OK', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'RECHAZA', 'p_reason_code => ''MOTIVO_SINTETICO'', p_reason_text => ''Texto sintetico'''), true));
  review_nota := current_setting('a018.id')::bigint;
  perform pg_temp.expect('idempotencia: primera llamada crea', 'true', pg_temp.scalar('equitas_review_server', null, replace(replace(pg_temp.review(u_operador, t_a, d_a), 'gen_random_uuid()', quote_literal(key1)), $s$select set_config('a018.id', r.review_id::text, true)$s$, 'select r.created::text')));
  perform pg_temp.probe('equitas_review_server', null, replace(pg_temp.review(u_operador, t_a, d_a), 'gen_random_uuid()', quote_literal(key1)), true);
  perform pg_temp.expect('idempotencia: repetir no crea', 'false', pg_temp.scalar('equitas_review_server', null, replace(replace(pg_temp.review(u_operador, t_a, d_a), 'gen_random_uuid()', quote_literal(key1)), $s$select set_config('a018.id', r.review_id::text, true)$s$, 'select r.created::text')));
  perform pg_temp.expect('idempotencia: una sola fila', '1', (select count(*)::text from public.case_review where tenant = t_a and idempotency_key = key1));
  perform pg_temp.expect('idempotencia: otra carga rechazada', 'IDEMPOTENCY_KEY_CONFLICT', pg_temp.probe('equitas_review_server', null, replace(pg_temp.review(u_operador, t_a, d_a, 'RECHAZA', 'p_reason_code => ''X'''), 'gen_random_uuid()', quote_literal(key1))));
  perform pg_temp.expect('correccion como evento nuevo', 'OK', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'ACEPTA', format('p_decided_intervention => ''RECORDATORIO_INFORMATIVO'', p_decided_intensity => 1, p_supersedes => %s', review_ok)), true));
  perform pg_temp.expect('la fila corregida no cambia', '2', (select count(*)::text from public.case_review where id in (review_ok, current_setting('a018.id')::bigint) and decision = 'ACEPTA'));
  perform pg_temp.expect('cada evento se corrige una vez', invalid || 'case_review_supersedes_key', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'ACEPTA', format('p_decided_intervention => ''RECORDATORIO_INFORMATIVO'', p_decided_intensity => 1, p_supersedes => %s', review_ok))));
  perform pg_temp.expect('supersedes de otro tenant', not_found, pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'ACEPTA', format('p_decided_intervention => ''RECORDATORIO_INFORMATIVO'', p_decided_intensity => 1, p_supersedes => %s', review_b))));
  perform pg_temp.expect('supersedes inexistente', not_found, pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'ACEPTA', 'p_decided_intervention => ''RECORDATORIO_INFORMATIVO'', p_decided_intensity => 1, p_supersedes => 999999999')));
  insert into public.debtor(id, tenant, external_id, identifier, description) values (d_a2, t_a, d_a2, 'TP-A018-3', 'Objeto sintetico de la cadena');
  perform pg_temp.expect('supersedes de otro objeto del tenant', not_found, pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a2, 'ACEPTA', format('p_decided_intervention => ''RECORDATORIO_INFORMATIVO'', p_decided_intensity => 1, p_supersedes => %s', review_nota))));
  -- Reproduce la revision: el siguiente ID de la secuencia seria el de la fila nueva, que asi se reemplazaria a si misma.
  select last_value + 1 into siguiente from public.case_review_id_seq;
  perform pg_temp.expect('revision que se reemplaza a si misma', not_found, pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'ACEPTA', format('p_decided_intervention => ''RECORDATORIO_INFORMATIVO'', p_decided_intensity => 1, p_supersedes => %s', siguiente))));
  perform pg_temp.expect('revision con antecedente futuro', not_found, pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'ACEPTA', format('p_decided_intervention => ''RECORDATORIO_INFORMATIVO'', p_decided_intensity => 1, p_supersedes => %s', siguiente + 5))));
  -- La tabla lo impide tambien por debajo de la funcion, con el propio definidor.
  perform pg_temp.expect('tabla: revision autorreferente', '23514', pg_temp.probe('equitas_write_definer', null, pg_temp.raw_review('(910001::bigint, 910001::bigint)')));
  perform pg_temp.expect('tabla: revision con antecedente posterior', '23514', pg_temp.probe('equitas_write_definer', null, pg_temp.raw_review('(910001::bigint, 910002::bigint), (910002::bigint, null)')));
  perform pg_temp.expect('tabla: revisiones en ciclo de 2', '23514', pg_temp.probe('equitas_write_definer', null, pg_temp.raw_review('(910001::bigint, 910002::bigint), (910002::bigint, 910001::bigint)')));
  perform pg_temp.expect('tabla: revisiones en ciclo de 3', '23514', pg_temp.probe('equitas_write_definer', null, pg_temp.raw_review('(910001::bigint, 910003::bigint), (910002::bigint, 910001::bigint), (910003::bigint, 910002::bigint)')));
  perform pg_temp.expect('tabla: la FK sigue cubriendo otro tenant', '23503', pg_temp.probe('equitas_write_definer', null, pg_temp.raw_review(format('(910001::bigint, %s::bigint)', review_b))));

  -- F. Aprobacion de intensidad >= 3.
  perform pg_temp.expect('propuesta de intensidad 3', 'OK', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'MODIFICA', intensa), true));
  prop := current_setting('a018.id')::bigint;
  perform pg_temp.expect('propuesta queda pendiente de supervisor', 'true', pg_temp.scalar('equitas_review_server', null, replace(pg_temp.review(u_operador, t_a, d_a, 'MODIFICA', intensa), $s$select set_config('a018.id', r.review_id::text, true)$s$, 'select r.pending_supervisor::text')));
  perform pg_temp.expect('aprobacion por operador', 'ROLE_NOT_ALLOWED', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_operador, t_a, prop)));
  perform pg_temp.expect('aprobacion por consulta', 'ROLE_NOT_ALLOWED', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_consulta, t_a, prop)));
  perform pg_temp.expect('aprobacion por importador', 'ROLE_NOT_ALLOWED', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_importador, t_a, prop)));
  perform pg_temp.expect('aprobacion por importador_sistema', 'ROLE_NOT_ALLOWED', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_sistema, t_a, prop)));
  perform pg_temp.expect('aprobacion sin membresia', 'ACTOR_NOT_ACTIVE_MEMBER', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_sin, t_a, prop)));
  perform pg_temp.expect('aprobacion membresia inactiva', 'ACTOR_NOT_ACTIVE_MEMBER', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_inactivo, t_a, prop)));
  perform pg_temp.expect('aprobacion supervisor de otro tenant', 'ACTOR_NOT_ACTIVE_MEMBER', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_otro_sup, t_a, prop)));
  perform pg_temp.expect('aprobacion revision de otro tenant', 'REVIEW_NOT_IN_TENANT', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_otro_sup, t_b, prop)));
  perform pg_temp.expect('aprobacion revision inexistente', 'REVIEW_NOT_IN_TENANT', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, 1)));
  perform pg_temp.expect('aprobacion de intensidad menor a 3', 'APPROVAL_NOT_REQUIRED', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, review_ok)));
  update public.tenant_user set role = 920003 where tenant = t_a and "user" = u_operador;
  perform pg_temp.expect('aprobacion por el mismo proponente', 'APPROVER_IS_PROPONENT', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_operador, t_a, prop)));
  update public.tenant_user set role = 920002 where tenant = t_a and "user" = u_operador;
  update public.tenant_user set status = true where tenant = t_a and "user" = u_inactivo;
  perform pg_temp.probe('equitas_review_server', null, pg_temp.review(u_inactivo, t_a, d_a, 'MODIFICA', intensa), true);
  prop2 := current_setting('a018.id')::bigint;
  perform pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'MODIFICA', intensa || format(', p_supersedes => %s', prop2)), true);
  prop3 := current_setting('a018.id')::bigint;
  update public.tenant_user set role = 920003 where tenant = t_a and "user" = u_inactivo;
  perform pg_temp.expect('aprobacion por proponente de una version anterior', 'APPROVER_IS_PROPONENT', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_inactivo, t_a, prop3)));
  update public.tenant_user set role = 920002, status = false where tenant = t_a and "user" = u_inactivo;
  perform pg_temp.expect('APRUEBA sin lista', invalid_ap || 'case_review_approval_requires_checklist', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop, 'APRUEBA', 'p_reason_code => ''X''')));
  perform pg_temp.expect('APRUEBA con lista incompleta', invalid_ap || 'case_review_approval_requires_checklist', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop, 'APRUEBA', 'p_checklist => ''{"canal_valido":true}''')));
  perform pg_temp.expect('aprobacion con texto en la lista', invalid_ap || 'case_review_checklist_shape', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop, 'OBJETA', 'p_reason_code => ''X'', p_checklist => ''{"situacion_hogar":"sin ingresos"}''')));
  perform pg_temp.expect('OBJETA sin motivo', invalid_ap || 'case_review_approval_objection_requires_reason', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop, 'OBJETA')));
  perform pg_temp.expect('decision de aprobacion fuera de lista', invalid_ap || 'case_review_approval_decision_valid', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop, 'OTRA', 'p_reason_code => ''X''')));
  perform pg_temp.expect('aprobacion de supervisor distinto', 'OK', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop), true));
  appr := current_setting('a018.id')::bigint;
  perform pg_temp.expect('rol del aprobador fijado por el servidor', '1', (select count(*)::text from public.case_review_approval where id = appr and approver = u_supervisor and approver_role = 'supervisor'));
  perform pg_temp.expect('segunda cadena sobre la misma revision', invalid_ap || 'case_review_approval_single_head', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop)));
  select last_value + 1 into siguiente from public.case_review_approval_id_seq;
  perform pg_temp.expect('aprobacion que se reemplaza a si misma', not_found, pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop, 'OBJETA', format('p_reason_code => ''X'', p_supersedes => %s', siguiente))));
  perform pg_temp.expect('aprobacion con antecedente futuro', not_found, pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop, 'OBJETA', format('p_reason_code => ''X'', p_supersedes => %s', siguiente + 5))));
  perform pg_temp.expect('aprobacion con supersedes inexistente', not_found, pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop, 'OBJETA', 'p_reason_code => ''X'', p_supersedes => 999999999')));
  perform pg_temp.expect('tabla: aprobacion autorreferente', '23514', pg_temp.probe('equitas_write_definer', null, pg_temp.raw_approval(prop, '(910001::bigint, 910001::bigint)')));
  perform pg_temp.expect('tabla: aprobaciones en ciclo de 2', '23514', pg_temp.probe('equitas_write_definer', null, pg_temp.raw_approval(prop, '(910001::bigint, 910002::bigint), (910002::bigint, 910001::bigint)')));
  perform pg_temp.expect('correccion de aprobacion como evento nuevo', 'OK', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop, 'OBJETA', format('p_reason_code => ''X'', p_supersedes => %s', appr))));
  perform pg_temp.expect('idempotencia de aprobacion: crea', 'OK', pg_temp.probe('equitas_review_server', null, replace(pg_temp.approval(u_supervisor, t_a, prop, 'OBJETA', format('p_reason_code => ''X'', p_supersedes => %s', appr)), 'gen_random_uuid()', quote_literal(key2)), true));
  perform pg_temp.expect('idempotencia de aprobacion: repetir no crea', 'false', pg_temp.scalar('equitas_review_server', null, replace(replace(pg_temp.approval(u_supervisor, t_a, prop, 'OBJETA', format('p_reason_code => ''X'', p_supersedes => %s', appr)), 'gen_random_uuid()', quote_literal(key2)), $s$select set_config('a018.id', r.approval_id::text, true)$s$, 'select r.created::text')));
  perform pg_temp.expect('idempotencia de aprobacion: otra carga rechazada', 'IDEMPOTENCY_KEY_CONFLICT', pg_temp.probe('equitas_review_server', null, replace(pg_temp.approval(u_supervisor, t_a, prop, 'OBJETA', 'p_reason_code => ''Y'''), 'gen_random_uuid()', quote_literal(key2))));
  perform pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'MODIFICA', intensa), true);
  prop2 := current_setting('a018.id')::bigint;
  perform pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'MODIFICA', intensa || format(', p_supersedes => %s', prop2)), true);
  prop3 := current_setting('a018.id')::bigint;
  perform pg_temp.expect('aprobar una propuesta ya corregida', 'REVIEW_SUPERSEDED', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop2)));
  perform pg_temp.expect('aprobar la propuesta vigente', 'OK', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop3), true));
  appr_otra := current_setting('a018.id')::bigint;
  perform pg_temp.expect('aprobacion con supersedes de otra revision', not_found, pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop, 'OBJETA', format('p_reason_code => ''X'', p_supersedes => %s', appr_otra))));
  perform pg_temp.probe('equitas_review_server', null, pg_temp.review(u_otro_op, t_b, d_b, 'MODIFICA', intensa), true);
  prop_b := current_setting('a018.id')::bigint;
  perform pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_otro_sup, t_b, prop_b), true);
  appr_b := current_setting('a018.id')::bigint;
  perform pg_temp.expect('aprobacion con supersedes de otro tenant', not_found, pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop, 'OBJETA', format('p_reason_code => ''X'', p_supersedes => %s', appr_b))));

  -- G. Lote.
  perform pg_temp.expect('lote por importador', 'OK', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a), true));
  bat := current_setting('a018.id')::bigint;
  perform pg_temp.expect('rol del lote fijado por el servidor', '1', (select count(*)::text from public.import_batch where id = bat and created_by = u_importador and created_by_role = 'importador'));
  perform pg_temp.expect('lote por credencial de maquina', 'OK', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_sistema, t_a)));
  -- ALIGN-003: supervisor aprueba u objeta. Sin membresia importador no registra lotes en ningun estado.
  perform pg_temp.expect('lote por supervisor sin permiso de importacion', 'ROLE_NOT_ALLOWED', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_supervisor, t_a)));
  perform pg_temp.expect('lote CONFIRMADO por supervisor', 'ROLE_NOT_ALLOWED', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_supervisor, t_a, 'CONFIRMADO')));
  perform pg_temp.expect('lote PUBLICADO por supervisor', 'ROLE_NOT_ALLOWED', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_supervisor, t_a, 'PUBLICADO')));
  perform pg_temp.expect('lote por supervisor de otro tenant', 'ROLE_NOT_ALLOWED', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_otro_sup, t_b)));
  -- Caso combinado: la funcion de importar sale de una membresia explicita, por tenant, y no se infiere de otra.
  insert into public.tenant_user(tenant, "user", role, status) values (t_b, u_supervisor, 920004, true);
  perform pg_temp.expect('supervisor con membresia importador explicita importa en ese tenant', 'OK', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_supervisor, t_b), true));
  bat_b := current_setting('a018.id')::bigint;
  perform pg_temp.expect('rol del lote combinado es importador', '1', (select count(*)::text from public.import_batch where id = bat_b and created_by = u_supervisor and created_by_role = 'importador'));
  perform pg_temp.expect('la membresia importador de otro tenant no se hereda', 'ROLE_NOT_ALLOWED', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_supervisor, t_a)));
  perform pg_temp.expect('la membresia importador no aprueba en ese tenant', 'ROLE_NOT_ALLOWED', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_b, prop_b)));
  delete from public.tenant_user where tenant = t_b and "user" = u_supervisor;
  perform pg_temp.expect('lote por operador', 'ROLE_NOT_ALLOWED', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_operador, t_a)));
  perform pg_temp.expect('lote por consulta', 'ROLE_NOT_ALLOWED', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_consulta, t_a)));
  perform pg_temp.expect('lote sin membresia', 'ACTOR_NOT_ACTIVE_MEMBER', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_sin, t_a)));
  perform pg_temp.expect('lote en otro tenant', 'ACTOR_NOT_ACTIVE_MEMBER', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_b)));
  perform pg_temp.expect('lote con estado fuera de lista', invalid_b || 'import_batch_status_valid', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'OTRO')));
  perform pg_temp.expect('lote con hash invalido', invalid_b || 'import_batch_file_hashes_format', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'RECIBIDO', null, '{"cabecera":"abc"}')));
  perform pg_temp.expect('lote sin hashes', invalid_b || 'import_batch_file_hashes_format', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'RECIBIDO', null, '{}')));
  perform pg_temp.expect('lote con hashes escalares', invalid_b || 'import_batch_file_hashes_format', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'RECIBIDO', null, '"bbbb"')));
  perform pg_temp.expect('lote con hashes en lista', invalid_b || 'import_batch_file_hashes_format', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'RECIBIDO', null, '["bbbb"]')));
  perform pg_temp.expect('lote con conteos escalares', invalid_b || 'import_batch_counts_format', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'RECIBIDO', 'p_counts => ''5''')));
  perform pg_temp.expect('lote con ruta de archivo como clave', invalid_b || 'import_batch_file_hashes_format', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'RECIBIDO', null, '{"/tmp/juan.tsv":"bbbb"}')));
  perform pg_temp.expect('lote con texto en conteos', invalid_b || 'import_batch_counts_format', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'RECIBIDO', 'p_counts => ''{"filas":{"nota":"texto"}}''')));
  perform pg_temp.expect('lote con conteo negativo', invalid_b || 'import_batch_counts_format', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'RECIBIDO', 'p_counts => ''{"filas":-1}''')));
  perform pg_temp.expect('cambio de estado como evento nuevo', 'OK', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'VALIDADO', format('p_supersedes => %s', bat)), true));
  perform pg_temp.expect('cada estado se reemplaza una vez', invalid_b || 'import_batch_supersedes_key', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'FALLIDO', format('p_supersedes => %s', bat))));
  perform pg_temp.expect('supersedes de lote de otro tenant', not_found, pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'FALLIDO', format('p_supersedes => %s', bat_b))));
  perform pg_temp.expect('supersedes de lote inexistente', not_found, pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'FALLIDO', 'p_supersedes => 999999999')));
  select last_value + 1 into siguiente from public.import_batch_id_seq;
  perform pg_temp.expect('lote que se reemplaza a si mismo', not_found, pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'FALLIDO', format('p_supersedes => %s', siguiente))));
  perform pg_temp.expect('lote con antecedente futuro', not_found, pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'FALLIDO', format('p_supersedes => %s', siguiente + 5))));
  perform pg_temp.expect('tabla: lote autorreferente', '23514', pg_temp.probe('equitas_write_definer', null, pg_temp.raw_batch('(910001::bigint, 910001::bigint)')));
  perform pg_temp.expect('tabla: lotes en ciclo de 2', '23514', pg_temp.probe('equitas_write_definer', null, pg_temp.raw_batch('(910001::bigint, 910002::bigint), (910002::bigint, 910001::bigint)')));
  perform pg_temp.expect('tabla: lotes en ciclo de 3', '23514', pg_temp.probe('equitas_write_definer', null, pg_temp.raw_batch('(910001::bigint, 910003::bigint), (910002::bigint, 910001::bigint), (910003::bigint, 910002::bigint)')));
  -- Longitudes y texto libre por otros campos del lote.
  perform pg_temp.expect('lote con version de reglas de longitud ilimitada', invalid_b || 'import_batch_rules_version_format', pg_temp.probe('equitas_import_server', null, replace(pg_temp.batch(u_importador, t_a), '''1.0.0''', quote_literal(repeat('1', 7) || '.0.0'))));
  perform pg_temp.expect('lote con hashes de mas de 16384 bytes', invalid_b || 'import_batch_file_hashes_format', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'RECIBIDO', null, (select jsonb_object_agg('h' || n, repeat('b', 64))::text from generate_series(1, 300) n))));
  perform pg_temp.expect('lote con conteos de mas de 16384 bytes', invalid_b || 'import_batch_counts_format', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'RECIBIDO', format('p_counts => %L', (select jsonb_object_agg('filas_' || n, 1)::text from generate_series(1, 2000) n)))));
  perform pg_temp.expect('lote con texto libre como clave de conteo', invalid_b || 'import_batch_counts_format', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'RECIBIDO', 'p_counts => ''{"la familia no puede pagar":1}''')));
  perform pg_temp.expect('lote con texto libre como clave anidada', invalid_b || 'import_batch_counts_format', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'RECIBIDO', 'p_counts => ''{"filas":{"Juan Perez":1}}''')));
  perform pg_temp.expect('lote con conteo decimal', invalid_b || 'import_batch_counts_format', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'RECIBIDO', 'p_counts => ''{"filas":1.5}''')));
  perform pg_temp.expect('lote con conteo en lista', invalid_b || 'import_batch_counts_format', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'RECIBIDO', 'p_counts => ''{"filas":[1,2]}''')));
  perform pg_temp.expect('lote con conteo nulo', invalid_b || 'import_batch_counts_format', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'RECIBIDO', 'p_counts => ''{"filas":null}''')));
  perform pg_temp.expect('lote con conteo booleano', invalid_b || 'import_batch_counts_format', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'RECIBIDO', 'p_counts => ''{"filas":true}''')));
  perform pg_temp.expect('lote con conteos anidados validos', 'OK', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'RECIBIDO', 'p_counts => ''{"filas":10,"rechazos":{"importe_invalido":0}}''')));
  perform pg_temp.expect('idempotencia de lote: crea', 'OK', pg_temp.probe('equitas_import_server', null, replace(pg_temp.batch(u_importador, t_a), 'gen_random_uuid()', quote_literal(key1)), true));
  perform pg_temp.expect('idempotencia de lote: repetir no crea', 'false', pg_temp.scalar('equitas_import_server', null, replace(replace(pg_temp.batch(u_importador, t_a), 'gen_random_uuid()', quote_literal(key1)), $s$select set_config('a018.id', r.batch_id::text, true)$s$, 'select r.created::text')));
  perform pg_temp.expect('idempotencia de lote: otra carga rechazada', 'IDEMPOTENCY_KEY_CONFLICT', pg_temp.probe('equitas_import_server', null, replace(pg_temp.batch(u_importador, t_a, 'VALIDADO'), 'gen_random_uuid()', quote_literal(key1))));

  -- Append-only tambien para el dueno, ya con filas en las tres tablas. TRUNCATE de case_review lo frena antes la FK de la aprobacion.
  foreach tbl in array array['case_review', 'case_review_approval', 'import_batch'] loop
    perform pg_temp.expect(format('dueno %s UPDATE', tbl), 'APPEND_ONLY', pg_temp.probe('postgres', null, format('update public.%I set created_at = now()', tbl)));
    perform pg_temp.expect(format('dueno %s DELETE', tbl), 'APPEND_ONLY', pg_temp.probe('postgres', null, format('delete from public.%I', tbl)));
    perform pg_temp.expect(format('dueno %s TRUNCATE', tbl), case tbl when 'case_review' then '0A000' else 'APPEND_ONLY' end, pg_temp.probe('postgres', null, format('truncate public.%I', tbl)));
  end loop;

  -- H. Lectura por membresia activa.
  select count(*)::text into total_a from public.case_review where tenant = t_a;
  select count(*)::text into total_b from public.case_review where tenant = t_b;
  perform pg_temp.expect('hay filas en ambos tenants', 'true', (total_a::bigint > 0 and total_b::bigint > 0)::text);
  perform pg_temp.expect('lectura operador ve su tenant', total_a, pg_temp.scalar('authenticated', sub_op, 'select count(*) from public.case_review'));
  perform pg_temp.expect('lectura operador no ve otro tenant', '0', pg_temp.scalar('authenticated', sub_op, format('select count(*) from public.case_review where tenant = %s', t_b)));
  perform pg_temp.expect('lectura consulta ve su tenant', total_a, pg_temp.scalar('authenticated', sub_cons, 'select count(*) from public.case_review'));
  perform pg_temp.expect('lectura supervisor ve su tenant', total_a, pg_temp.scalar('authenticated', sub_sup, 'select count(*) from public.case_review'));
  perform pg_temp.expect('lectura operador de otro tenant ve el suyo', total_b, pg_temp.scalar('authenticated', sub_otro, 'select count(*) from public.case_review'));
  perform pg_temp.expect('lectura sin membresia', '0', pg_temp.scalar('authenticated', sub_sin, 'select count(*) from public.case_review'));
  perform pg_temp.expect('lectura membresia inactiva', '0', pg_temp.scalar('authenticated', sub_ina, 'select count(*) from public.case_review'));
  perform pg_temp.expect('lectura anon', '0', pg_temp.scalar('anon', null, 'select count(*) from public.case_review'));
  foreach tbl in array array['case_review_approval', 'import_batch'] loop
    perform pg_temp.expect(format('lectura sin membresia %s', tbl), '0', pg_temp.scalar('authenticated', sub_sin, format('select count(*) from public.%I', tbl)));
    perform pg_temp.expect(format('lectura inactiva %s', tbl), '0', pg_temp.scalar('authenticated', sub_ina, format('select count(*) from public.%I', tbl)));
    perform pg_temp.expect(format('lectura anon %s', tbl), '0', pg_temp.scalar('anon', null, format('select count(*) from public.%I', tbl)));
    perform pg_temp.expect(format('lectura otro tenant filtrada %s', tbl), '0', pg_temp.scalar('authenticated', sub_op, format('select count(*) from public.%I where tenant = %s', tbl, t_b)));
  end loop;
  perform pg_temp.expect('lectura operador case_review_approval ve su tenant', (select count(*)::text from public.case_review_approval where tenant = t_a), pg_temp.scalar('authenticated', sub_op, 'select count(*) from public.case_review_approval'));
  perform pg_temp.expect('lectura operador import_batch ve su tenant', (select count(*)::text from public.import_batch where tenant = t_a), pg_temp.scalar('authenticated', sub_op, 'select count(*) from public.import_batch'));

  -- I. reason_text excluido por defecto.
  perform pg_temp.expect('authenticated no lee reason_text', '42501', pg_temp.probe('authenticated', sub_op, 'select reason_text from public.case_review'));
  perform pg_temp.expect('authenticated select * falla cerrado', '42501', pg_temp.probe('authenticated', sub_op, 'select * from public.case_review'));
  perform pg_temp.expect('anon no lee reason_text', '42501', pg_temp.probe('anon', null, 'select reason_text from public.case_review'));
  perform pg_temp.expect('service_role no lee reason_text', '42501', pg_temp.probe('service_role', null, 'select reason_text from public.case_review'));
  perform pg_temp.expect('authenticated lee las demas columnas', 'OK', pg_temp.probe('authenticated', sub_op, 'select id, decision, reason_code, checklist from public.case_review'));
  perform pg_temp.expect('motivo: operador lo lee por funcion', 'true', pg_temp.scalar('equitas_review_server', null, format($s$select public.read_case_review_reason_text(%s, %s, %s) = 'Texto sintetico'$s$, u_operador, t_a, review_nota)));
  perform pg_temp.expect('motivo: supervisor lo lee por funcion', 'true', pg_temp.scalar('equitas_review_server', null, format($s$select public.read_case_review_reason_text(%s, %s, %s) = 'Texto sintetico'$s$, u_supervisor, t_a, review_nota)));
  perform pg_temp.expect('motivo: consulta no lo lee', 'ROLE_NOT_ALLOWED', pg_temp.probe('equitas_review_server', null, format('select public.read_case_review_reason_text(%s, %s, %s)', u_consulta, t_a, review_nota)));
  perform pg_temp.expect('motivo: importador no lo lee', 'ROLE_NOT_ALLOWED', pg_temp.probe('equitas_review_server', null, format('select public.read_case_review_reason_text(%s, %s, %s)', u_importador, t_a, review_nota)));
  perform pg_temp.expect('motivo: importador_sistema no lo lee', 'ROLE_NOT_ALLOWED', pg_temp.probe('equitas_review_server', null, format('select public.read_case_review_reason_text(%s, %s, %s)', u_sistema, t_a, review_nota)));
  perform pg_temp.expect('motivo: sin membresia no lo lee', 'ACTOR_NOT_ACTIVE_MEMBER', pg_temp.probe('equitas_review_server', null, format('select public.read_case_review_reason_text(%s, %s, %s)', u_sin, t_a, review_nota)));
  perform pg_temp.expect('motivo: otro tenant no lo lee', 'ACTOR_NOT_ACTIVE_MEMBER', pg_temp.probe('equitas_review_server', null, format('select public.read_case_review_reason_text(%s, %s, %s)', u_otro_op, t_a, review_nota)));
  perform pg_temp.expect('motivo: revision de otro tenant', 'REVIEW_NOT_IN_TENANT', pg_temp.probe('equitas_review_server', null, format('select public.read_case_review_reason_text(%s, %s, %s)', u_otro_op, t_b, review_nota)));

  -- J. Un rechazo no publica el contenido de la fila. El bloque G dejo un VALIDADO abierto: sin un corte nuevo, el rechazo seria por el corte y este caso no probaria nada.
  perform pg_temp.publish_cutoff(t_a);
  begin
    set local role equitas_review_server;
    execute pg_temp.review(u_operador, t_a, d_a, 'RECHAZA', 'p_reason_code => ''MOTIVO_SINTETICO'', p_reason_text => ''SECRETO_SINTETICO'', p_decided_intervention => ''SEGUIMIENTO'', p_decided_intensity => 1');
  exception when others then
    declare v_detail text; v_hint text; v_context text;
    begin
      get stacked diagnostics v_detail = pg_exception_detail, v_hint = pg_exception_hint, v_context = pg_exception_context;
      execute 'reset role';
      perform pg_temp.expect('rechazo sin valores en el mensaje', 'false', (sqlerrm like '%SECRETO_SINTETICO%' or coalesce(v_detail, '') like '%SECRETO_SINTETICO%' or coalesce(v_hint, '') like '%SECRETO_SINTETICO%')::text);
    end;
  end;
  execute 'reset role';

  -- K. Lo que dejaron las RPC: ninguna fila con antecedente que no sea anterior.
  foreach tbl in array array['case_review', 'case_review_approval', 'import_batch'] loop
    execute format('select count(*)::text from public.%I where supersedes >= id', tbl) into total_a;
    perform pg_temp.expect(format('%s sin antecedente posterior ni propio', tbl), '0', total_a);
  end loop;

  -- L. postgres sin SET ni INHERIT sobre el definidor; authenticator sin ninguna membresia. El ADMIN OPTION residual se informa en case-review-verify.sql.
  perform pg_temp.expect('postgres sin SET sobre el definidor', 'false', pg_has_role('postgres', 'equitas_write_definer', 'SET')::text);
  perform pg_temp.expect('postgres sin INHERIT sobre el definidor', 'false', pg_has_role('postgres', 'equitas_write_definer', 'USAGE')::text);
  perform pg_temp.expect('authenticator sin SET sobre el definidor', 'false', pg_has_role('authenticator', 'equitas_write_definer', 'SET')::text);
  perform pg_temp.expect('authenticator sin ADMIN sobre el definidor', 'false', pg_has_role('authenticator', 'equitas_write_definer', 'MEMBER WITH ADMIN OPTION')::text);
end $body$;

-- N. ALIGN-020, ciclo 1: la decision y la aprobacion quedan atadas al corte vigente, dentro de la transaccion de la insercion.
-- La concurrencia real, con el bloqueo, se prueba por HTTP en front/tests/local-review/case-review-intercalaciones.http.ts.
create function pg_temp.cutoff_case(p_caso text, p_eventos text[], p_esperado integer) returns void
language plpgsql as $f$
declare
  v_tenant bigint := 920100 + (select count(*) from a018_result);
  v_ids bigint[] := '{}';
  v_evento text;
  v_id bigint;
  v_status text;
  v_antecedente integer;
begin
  insert into public.tenant(id, name) values (v_tenant, 'TP A020 corte');
  foreach v_evento in array p_eventos loop
    v_status := split_part(v_evento, '<', 1);
    v_antecedente := nullif(split_part(v_evento, '<', 2), '')::integer;
    insert into public.import_batch(tenant, source, file_hashes, as_of, rules_version, status, created_by, created_by_role, supersedes, idempotency_key)
    values (v_tenant, 'ETL_CLI', jsonb_build_object('cabecera', repeat('b', 64)), '2026-10-30', '1.0.0', v_status, 920004, 'importador', v_ids[v_antecedente], gen_random_uuid())
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;
  perform pg_temp.expect('corte vigente: ' || p_caso, coalesce(v_ids[p_esperado]::text, 'sin corte'), coalesce(public.equitas_current_cutoff(v_tenant)::text, 'sin corte'));
end $f$;

do $body$
declare
  t_a constant bigint := 920001;
  t_b constant bigint := 920002;
  d_a constant bigint := 920001;
  u_operador constant bigint := 920002;
  u_supervisor constant bigint := 920003;
  cambio constant text := 'CUTOFF_CHANGED';
  decidido constant text := 'p_decided_intervention => ''RECORDATORIO_INFORMATIVO'', p_decided_intensity => 1';
  lista constant text := 'p_checklist => ''{"situacion_hogar":"CONSULTADA","estado_juridico_verificado":true,"canal_valido":true,"alternativa_asistida_ofrecida":true}''';
  intensa constant text := 'p_decided_intervention => ''INTIMACION_ADMINISTRATIVA'', p_decided_intensity => 3, p_reason_code => ''MOTIVO_SINTETICO'', ' || lista;
  sin_parametro constant text := ',? *p_cutoff_batch => \w+,?';
  con_corte constant text := 'p_cutoff_batch => \w+';
  rol text;
  corte bigint;
  corte_viejo bigint;
  corte_b bigint;
  validado bigint;
  prop bigint;
  clave uuid := gen_random_uuid();
begin
  -- Firma: el parametro no se puede omitir ni queda una sobrecarga anterior.
  perform pg_temp.expect('firma anterior de la revision', 'no existe', coalesce(to_regprocedure('public.record_case_review(bigint, bigint, bigint, text, date, text, text, integer, jsonb, text, uuid, text, integer, text, text, jsonb, bigint)')::text, 'no existe'));
  perform pg_temp.expect('firma anterior de la aprobacion', 'no existe', coalesce(to_regprocedure('public.record_case_review_approval(bigint, bigint, bigint, text, uuid, text, jsonb, bigint)')::text, 'no existe'));
  perform pg_temp.expect('revision sin el parametro', '42883', pg_temp.probe('equitas_review_server', null, regexp_replace(pg_temp.review(u_operador, t_a, d_a), sin_parametro, ',')));
  perform pg_temp.expect('aprobacion sin el parametro', '42883', pg_temp.probe('equitas_review_server', null, regexp_replace(pg_temp.approval(u_supervisor, t_a, 1), sin_parametro, ',')));

  -- Las auxiliares no se ejecutan desde afuera de las funciones.
  foreach rol in array array['anon', 'authenticated', 'service_role', 'postgres', 'equitas_review_server', 'equitas_import_server'] loop
    perform pg_temp.expect(format('funcion %s equitas_current_cutoff', rol), '42501', pg_temp.probe(rol, null, format('select public.equitas_current_cutoff(%s)', t_a)));
    perform pg_temp.expect(format('funcion %s equitas_verify_cutoff', rol), '42501', pg_temp.probe(rol, null, format($s$select public.equitas_verify_cutoff(%s, 1, '2026-10-30')$s$, t_a)));
  end loop;

  -- Que corte vale: la misma tabla de casos que selectCurrentCutoff en front/tests/unit/case-review-snapshot.test.ts.
  perform pg_temp.cutoff_case('sin lote', '{}', 0);
  perform pg_temp.cutoff_case('solo validado', '{VALIDADO}', 0);
  perform pg_temp.cutoff_case('carga en curso sobre uno publicado', '{PUBLICADO,VALIDADO}', 0);
  perform pg_temp.cutoff_case('confirmado sobre uno publicado', '{PUBLICADO,CONFIRMADO}', 0);
  perform pg_temp.cutoff_case('carga fallida a mitad de camino', '{PUBLICADO,VALIDADO,FALLIDO<2}', 0);
  perform pg_temp.cutoff_case('lote bloqueado antes de escribir', '{PUBLICADO,FALLIDO}', 1);
  perform pg_temp.cutoff_case('recibido y descartado no cuentan', '{PUBLICADO,RECIBIDO,DESCARTADO}', 1);
  perform pg_temp.cutoff_case('requiere nuevo preview no cuenta', '{PUBLICADO,REQUIERE_NUEVO_PREVIEW}', 1);
  perform pg_temp.cutoff_case('publicado reemplazado por descartado', '{PUBLICADO,DESCARTADO<1}', 0);
  perform pg_temp.cutoff_case('publicado reemplazado por nuevo preview', '{PUBLICADO,REQUIERE_NUEVO_PREVIEW<1}', 0);
  perform pg_temp.cutoff_case('validado y publicado', '{VALIDADO,PUBLICADO<1}', 2);
  perform pg_temp.cutoff_case('el ultimo publicado gana', '{VALIDADO,PUBLICADO<1,VALIDADO,PUBLICADO<3}', 4);
  perform pg_temp.cutoff_case('dos publicados sin cadena', '{PUBLICADO,PUBLICADO}', 2);

  corte_viejo := pg_temp.publish_cutoff(t_a);
  corte := pg_temp.publish_cutoff(t_a);
  corte_b := pg_temp.publish_cutoff(t_b);
  perform pg_temp.expect('corte vigente del municipio, no del otro', corte::text, public.equitas_current_cutoff(t_a)::text);

  -- Revision: que evento se declara.
  perform pg_temp.expect('corte vigente pasa', 'OK', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a)));
  perform pg_temp.expect('corte declarado nulo', cambio, pg_temp.probe('equitas_review_server', null, regexp_replace(pg_temp.review(u_operador, t_a, d_a), con_corte, 'p_cutoff_batch => null')));
  perform pg_temp.expect('corte anterior', cambio, pg_temp.probe('equitas_review_server', null, regexp_replace(pg_temp.review(u_operador, t_a, d_a), con_corte, 'p_cutoff_batch => ' || corte_viejo)));
  perform pg_temp.expect('corte de otro municipio', cambio, pg_temp.probe('equitas_review_server', null, regexp_replace(pg_temp.review(u_operador, t_a, d_a), con_corte, 'p_cutoff_batch => ' || corte_b)));
  perform pg_temp.expect('corte inexistente', cambio, pg_temp.probe('equitas_review_server', null, regexp_replace(pg_temp.review(u_operador, t_a, d_a), con_corte, 'p_cutoff_batch => 999999999')));
  perform pg_temp.expect('fecha distinta de la del evento', cambio, pg_temp.probe('equitas_review_server', null, replace(pg_temp.review(u_operador, t_a, d_a), '''2026-10-30''', '''2026-10-31''')));

  -- Eventos que no tocan la cartera: el corte sigue vigente.
  perform pg_temp.probe('equitas_import_server', null, pg_temp.batch(920004, t_a, 'RECIBIDO'), true);
  perform pg_temp.expect('RECIBIDO no invalida', 'OK', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a)));
  perform pg_temp.probe('equitas_import_server', null, pg_temp.batch(920004, t_a, 'FALLIDO'), true);
  perform pg_temp.expect('FALLIDO sin antecedente no invalida', 'OK', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a)));

  -- Respuesta idempotente: lo guardado se responde igual aunque despues cambie el corte. Solo una insercion nueva lo verifica.
  perform pg_temp.expect('propuesta con el corte vigente', 'OK', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'MODIFICA', intensa), true));
  prop := current_setting('a018.id')::bigint;
  perform pg_temp.expect('alta con clave fija', 'OK', pg_temp.probe('equitas_review_server', null, replace(pg_temp.review(u_operador, t_a, d_a), 'gen_random_uuid()', quote_literal(clave)), true));

  -- Empieza una carga: nada que confirme pasa, por la funcion de lotes real.
  perform pg_temp.expect('lote VALIDADO por su funcion', 'OK', pg_temp.probe('equitas_import_server', null, pg_temp.batch(920004, t_a, 'VALIDADO'), true));
  validado := current_setting('a018.id')::bigint;
  perform pg_temp.expect('corte con VALIDADO mas nuevo', 'sin corte', coalesce(public.equitas_current_cutoff(t_a)::text, 'sin corte'));
  perform pg_temp.expect('revision con VALIDADO mas nuevo', cambio, pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a)));
  perform pg_temp.expect('APRUEBA con VALIDADO mas nuevo', cambio, pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop)));
  perform pg_temp.expect('reenvio de lo ya guardado responde igual', 'false', pg_temp.scalar('equitas_review_server', null, replace(replace(pg_temp.review(u_operador, t_a, d_a), 'gen_random_uuid()', quote_literal(clave)), $s$select set_config('a018.id', r.review_id::text, true)$s$, 'select r.created::text')));
  perform pg_temp.expect('OBJETA con VALIDADO mas nuevo y corte nulo', 'OK', pg_temp.probe('equitas_review_server', null, regexp_replace(pg_temp.approval(u_supervisor, t_a, prop, 'OBJETA', 'p_reason_code => ''X'''), con_corte, 'p_cutoff_batch => null')));
  perform pg_temp.expect('APRUEBA con corte nulo y VALIDADO mas nuevo', cambio, pg_temp.probe('equitas_review_server', null, regexp_replace(pg_temp.approval(u_supervisor, t_a, prop), con_corte, 'p_cutoff_batch => null')));
  perform pg_temp.expect('decision fuera de lista no saltea la restriccion', 'INVALID_CASE_REVIEW_APPROVAL:case_review_approval_decision_valid', pg_temp.probe('equitas_review_server', null, regexp_replace(pg_temp.approval(u_supervisor, t_a, prop, 'OTRA', 'p_reason_code => ''X'''), con_corte, 'p_cutoff_batch => null')));

  -- Termina con otra publicacion: el evento anterior no vale, el nuevo si.
  perform pg_temp.expect('lote PUBLICADO por su funcion', 'OK', pg_temp.probe('equitas_import_server', null, pg_temp.batch(920004, t_a, 'PUBLICADO', format('p_supersedes => %s', validado)), true));
  corte_viejo := corte;
  corte := current_setting('a018.id')::bigint;
  perform set_config('a018.corte_' || t_a, corte::text, true);
  perform pg_temp.expect('revision con el corte anterior a la publicacion', cambio, pg_temp.probe('equitas_review_server', null, regexp_replace(pg_temp.review(u_operador, t_a, d_a), con_corte, 'p_cutoff_batch => ' || corte_viejo)));
  perform pg_temp.expect('APRUEBA con el corte anterior a la publicacion', cambio, pg_temp.probe('equitas_review_server', null, regexp_replace(pg_temp.approval(u_supervisor, t_a, prop), con_corte, 'p_cutoff_batch => ' || corte_viejo)));
  perform pg_temp.expect('APRUEBA con el corte nuevo y la propuesta de esa fecha', 'OK', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop)));

  -- Una propuesta de otra fecha no se aprueba con el corte vigente, aunque la accion no lo hubiera notado.
  perform pg_temp.publish_cutoff(t_a, '2026-11-15');
  perform pg_temp.expect('APRUEBA de una propuesta de otro corte', cambio, pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop)));
  perform pg_temp.publish_cutoff(t_a);
end $body$;

-- M. Cadena invalida preexistente. Por las funciones y por la tabla ya no se puede crear (bloques E, F y G): se retiran aca sus restricciones,
-- solo dentro de esta transaccion, para comprobar que la aprobacion igual termina y la rechaza. El limite de tiempo convierte una regresion en falla.
set local statement_timeout = '20s';

alter table public.case_review drop constraint case_review_supersedes_anterior, drop constraint case_review_supersedes_key;

do $body$
declare
  invalida constant text := 'SUPERSEDES_CHAIN_INVALID';
  u_supervisor constant bigint := 920003;
  u_operador constant bigint := 920002;
  t_a constant bigint := 920001;
begin
  execute pg_temp.raw_review('(910001::bigint, 910001::bigint)');
  execute pg_temp.raw_review('(910002::bigint, 910003::bigint), (910003::bigint, 910002::bigint)');
  execute pg_temp.raw_review('(910004::bigint, 910006::bigint), (910005::bigint, 910004::bigint), (910006::bigint, 910005::bigint)');
  -- Antecedente posterior sin ciclo, y una cola que entra en un ciclo (por eso se retira tambien la unica).
  execute pg_temp.raw_review('(910007::bigint, 910008::bigint), (910008::bigint, null)');
  execute pg_temp.raw_review('(910010::bigint, 910011::bigint), (910011::bigint, 910010::bigint), (910012::bigint, 910011::bigint)');
  perform pg_temp.expect('aprobacion sobre ciclo de 1', invalida, pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, 910001)));
  perform pg_temp.expect('aprobacion sobre ciclo de 2, primer eslabon', invalida, pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, 910002)));
  perform pg_temp.expect('aprobacion sobre ciclo de 2, segundo eslabon', invalida, pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, 910003)));
  perform pg_temp.expect('aprobacion sobre ciclo de 3, eslabon 1', invalida, pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, 910004)));
  perform pg_temp.expect('aprobacion sobre ciclo de 3, eslabon 2', invalida, pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, 910005)));
  perform pg_temp.expect('aprobacion sobre ciclo de 3, eslabon 3', invalida, pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, 910006)));
  perform pg_temp.expect('aprobacion sobre antecedente posterior sin ciclo', invalida, pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, 910007)));
  perform pg_temp.expect('aprobacion sobre cola que entra en un ciclo', invalida, pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, 910012)));
  -- La cadena invalida se rechaza antes que cualquier otra conclusion: tampoco el proponente recibe otra respuesta.
  update public.tenant_user set role = 920003 where tenant = t_a and "user" = u_operador;
  perform pg_temp.expect('proponente sobre ciclo de 2', invalida, pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_operador, t_a, 910002)));
  update public.tenant_user set role = 920002 where tenant = t_a and "user" = u_operador;
  perform pg_temp.expect('ninguna aprobacion sobre cadenas invalidas', '0', (select count(*)::text from public.case_review_approval where case_review between 910001 and 910012));
end $body$;

select caso, esperado, obtenido, case when esperado is not distinct from obtenido then 'OK' else 'FALLA' end from a018_result order by n;
select 'TOTAL', count(*), 'FALLAS', count(*) filter (where esperado is distinct from obtenido) from a018_result;
do $$ begin
  if exists(select 1 from a018_result where esperado is distinct from obtenido) then
    raise exception 'Hay casos que no dieron lo esperado';
  end if;
end $$;
rollback;
