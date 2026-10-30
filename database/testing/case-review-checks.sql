-- ALIGN-018. Pruebas de comportamiento por rol. SOLO base local aislada, con case-review-fixtures.sql cargado.
-- docker exec -i supabase_db_equitas-tp-testing psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -At -F '|' < database/testing/case-review-checks.sql
-- Se conecta como superusuario local solo para simular roles con SET LOCAL ROLE: el superusuario no ejecuta las pruebas.
-- Todo corre en una transaccion que termina en ROLLBACK: no deja filas. Publica solo codigos y conteos, sin valores de filas.
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

-- Llamadas con valores validos por defecto: cada caso cambia solo lo que prueba.
create function pg_temp.review(p_user bigint, p_tenant bigint, p_debtor bigint, p_decision text default 'ACEPTA', p_extra text default null) returns text
language sql as $f$
  select format($s$select set_config('a018.id', r.review_id::text, true) from public.record_case_review(
    p_reviewer_user => %s, p_tenant => %s, p_debtor => %s, p_rules_version => '1.0.0', p_as_of => '2026-10-30',
    p_inputs_hash => repeat('a', 64), p_suggested_intervention => 'RECORDATORIO_INFORMATIVO', p_suggested_intensity => 1,
    p_explanation => '{"factores":[]}', p_decision => %L, p_idempotency_key => gen_random_uuid()%s) r$s$,
    p_user, p_tenant, p_debtor, p_decision,
    coalesce(', ' || p_extra, case when p_decision = 'ACEPTA' then ', p_decided_intervention => ''RECORDATORIO_INFORMATIVO'', p_decided_intensity => 1' else '' end));
$f$;

create function pg_temp.approval(p_user bigint, p_tenant bigint, p_review bigint, p_decision text default 'APRUEBA', p_extra text default null) returns text
language sql as $f$
  select format($s$select set_config('a018.id', r.approval_id::text, true) from public.record_case_review_approval(
    p_approver_user => %s, p_tenant => %s, p_case_review => %s, p_decision => %L, p_idempotency_key => gen_random_uuid()%s) r$s$,
    p_user, p_tenant, p_review, p_decision,
    coalesce(', ' || p_extra, case when p_decision = 'APRUEBA' then ', p_checklist => ''{"situacion_hogar":"NO_DISPONIBLE","estado_juridico_verificado":true,"canal_valido":true,"alternativa_asistida_ofrecida":true}''' else '' end));
$f$;

create function pg_temp.batch(p_user bigint, p_tenant bigint, p_status text default 'RECIBIDO', p_extra text default null, p_hashes text default '{"cabecera":"bbbb"}') returns text
language sql as $f$
  select format($s$select set_config('a018.id', r.batch_id::text, true) from public.record_import_batch(
    p_actor_user => %s, p_tenant => %s, p_source => 'ETL_CLI', p_file_hashes => %L, p_as_of => '2026-10-30',
    p_rules_version => '1.0.0', p_status => %L, p_idempotency_key => gen_random_uuid()%s) r$s$,
    p_user, p_tenant, replace(p_hashes, 'bbbb', repeat('b', 64)), p_status, coalesce(', ' || p_extra, ''));
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
  perform pg_temp.expect('explicacion no es objeto', invalid || 'case_review_explanation_object', pg_temp.probe('equitas_review_server', null, replace(pg_temp.review(u_operador, t_a, d_a), '''{"factores":[]}''', '''[]''')));
  perform pg_temp.expect('corte nulo', invalid || 'not_null', pg_temp.probe('equitas_review_server', null, replace(pg_temp.review(u_operador, t_a, d_a), '''2026-10-30''', 'null')));
  perform pg_temp.expect('texto de 501 caracteres', invalid || 'case_review_reason_text_length', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'RECHAZA', format('p_reason_code => ''X'', p_reason_text => %L', repeat('x', 501)))));
  perform pg_temp.expect('texto de 500 caracteres', 'OK', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'RECHAZA', format('p_reason_code => ''X'', p_reason_text => %L', repeat('x', 500)))));
  perform pg_temp.expect('texto en blanco', invalid || 'case_review_reason_text_length', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'RECHAZA', 'p_reason_code => ''X'', p_reason_text => ''   ''')));
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
  perform pg_temp.expect('supersedes de otro tenant', invalid || 'case_review_supersedes_fkey', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'ACEPTA', format('p_decided_intervention => ''RECORDATORIO_INFORMATIVO'', p_decided_intensity => 1, p_supersedes => %s', review_b))));
  perform pg_temp.expect('supersedes inexistente', invalid || 'case_review_supersedes_fkey', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'ACEPTA', 'p_decided_intervention => ''RECORDATORIO_INFORMATIVO'', p_decided_intensity => 1, p_supersedes => 1')));

  -- F. Aprobacion de intensidad >= 3.
  perform pg_temp.expect('propuesta de intensidad 3', 'OK', pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'MODIFICA', intensa), true));
  prop := current_setting('a018.id')::bigint;
  perform pg_temp.expect('propuesta queda pendiente de supervisor', 'true', pg_temp.scalar('equitas_review_server', null, replace(pg_temp.review(u_operador, t_a, d_a, 'MODIFICA', intensa), $s$select set_config('a018.id', r.review_id::text, true)$s$, 'select r.pending_supervisor::text')));
  perform pg_temp.expect('aprobacion por operador', 'ROLE_NOT_ALLOWED', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_operador, t_a, prop)));
  perform pg_temp.expect('aprobacion por consulta', 'ROLE_NOT_ALLOWED', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_consulta, t_a, prop)));
  perform pg_temp.expect('aprobacion por importador', 'ROLE_NOT_ALLOWED', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_importador, t_a, prop)));
  perform pg_temp.expect('aprobacion sin membresia', 'ACTOR_NOT_ACTIVE_MEMBER', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_sin, t_a, prop)));
  perform pg_temp.expect('aprobacion membresia inactiva', 'ACTOR_NOT_ACTIVE_MEMBER', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_inactivo, t_a, prop)));
  perform pg_temp.expect('aprobacion supervisor de otro tenant', 'ACTOR_NOT_ACTIVE_MEMBER', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_otro_sup, t_a, prop)));
  perform pg_temp.expect('aprobacion revision de otro tenant', 'REVIEW_NOT_IN_TENANT', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_otro_sup, t_b, prop)));
  perform pg_temp.expect('aprobacion revision inexistente', 'REVIEW_NOT_IN_TENANT', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, 1)));
  perform pg_temp.expect('aprobacion de intensidad menor a 3', 'APPROVAL_NOT_REQUIRED', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, review_ok)));
  update public.tenant_user set role = 920003 where tenant = t_a and "user" = u_operador;
  perform pg_temp.expect('aprobacion por el mismo proponente', 'APPROVER_IS_PROPONENT', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_operador, t_a, prop)));
  update public.tenant_user set role = 920002 where tenant = t_a and "user" = u_operador;
  perform pg_temp.expect('APRUEBA sin lista', invalid_ap || 'case_review_approval_requires_checklist', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop, 'APRUEBA', 'p_reason_code => ''X''')));
  perform pg_temp.expect('APRUEBA con lista incompleta', invalid_ap || 'case_review_approval_requires_checklist', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop, 'APRUEBA', 'p_checklist => ''{"canal_valido":true}''')));
  perform pg_temp.expect('aprobacion con texto en la lista', invalid_ap || 'case_review_checklist_shape', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop, 'OBJETA', 'p_reason_code => ''X'', p_checklist => ''{"situacion_hogar":"sin ingresos"}''')));
  perform pg_temp.expect('OBJETA sin motivo', invalid_ap || 'case_review_approval_objection_requires_reason', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop, 'OBJETA')));
  perform pg_temp.expect('decision de aprobacion fuera de lista', invalid_ap || 'case_review_approval_decision_valid', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop, 'OTRA', 'p_reason_code => ''X''')));
  perform pg_temp.expect('aprobacion de supervisor distinto', 'OK', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop), true));
  appr := current_setting('a018.id')::bigint;
  perform pg_temp.expect('rol del aprobador fijado por el servidor', '1', (select count(*)::text from public.case_review_approval where id = appr and approver = u_supervisor and approver_role = 'supervisor'));
  perform pg_temp.expect('segunda cadena sobre la misma revision', invalid_ap || 'case_review_approval_single_head', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop)));
  perform pg_temp.expect('correccion de aprobacion como evento nuevo', 'OK', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop, 'OBJETA', format('p_reason_code => ''X'', p_supersedes => %s', appr))));
  perform pg_temp.expect('idempotencia de aprobacion: crea', 'OK', pg_temp.probe('equitas_review_server', null, replace(pg_temp.approval(u_supervisor, t_a, prop, 'OBJETA', format('p_reason_code => ''X'', p_supersedes => %s', appr)), 'gen_random_uuid()', quote_literal(key2)), true));
  perform pg_temp.expect('idempotencia de aprobacion: repetir no crea', 'false', pg_temp.scalar('equitas_review_server', null, replace(replace(pg_temp.approval(u_supervisor, t_a, prop, 'OBJETA', format('p_reason_code => ''X'', p_supersedes => %s', appr)), 'gen_random_uuid()', quote_literal(key2)), $s$select set_config('a018.id', r.approval_id::text, true)$s$, 'select r.created::text')));
  perform pg_temp.expect('idempotencia de aprobacion: otra carga rechazada', 'IDEMPOTENCY_KEY_CONFLICT', pg_temp.probe('equitas_review_server', null, replace(pg_temp.approval(u_supervisor, t_a, prop, 'OBJETA', 'p_reason_code => ''Y'''), 'gen_random_uuid()', quote_literal(key2))));
  perform pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'MODIFICA', intensa), true);
  prop2 := current_setting('a018.id')::bigint;
  perform pg_temp.probe('equitas_review_server', null, pg_temp.review(u_operador, t_a, d_a, 'MODIFICA', intensa || format(', p_supersedes => %s', prop2)), true);
  prop3 := current_setting('a018.id')::bigint;
  perform pg_temp.expect('aprobar una propuesta ya corregida', 'REVIEW_SUPERSEDED', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop2)));
  perform pg_temp.expect('aprobar la propuesta vigente', 'OK', pg_temp.probe('equitas_review_server', null, pg_temp.approval(u_supervisor, t_a, prop3)));

  -- G. Lote.
  perform pg_temp.expect('lote por importador', 'OK', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a), true));
  bat := current_setting('a018.id')::bigint;
  perform pg_temp.expect('rol del lote fijado por el servidor', '1', (select count(*)::text from public.import_batch where id = bat and created_by = u_importador and created_by_role = 'importador'));
  perform pg_temp.expect('lote por credencial de maquina', 'OK', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_sistema, t_a)));
  perform pg_temp.expect('lote por supervisor', 'OK', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_supervisor, t_a)));
  perform pg_temp.expect('lote por operador', 'ROLE_NOT_ALLOWED', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_operador, t_a)));
  perform pg_temp.expect('lote por consulta', 'ROLE_NOT_ALLOWED', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_consulta, t_a)));
  perform pg_temp.expect('lote sin membresia', 'ACTOR_NOT_ACTIVE_MEMBER', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_sin, t_a)));
  perform pg_temp.expect('lote en otro tenant', 'ACTOR_NOT_ACTIVE_MEMBER', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_b)));
  perform pg_temp.expect('lote con estado fuera de lista', invalid_b || 'import_batch_status_valid', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'OTRO')));
  perform pg_temp.expect('lote con hash invalido', invalid_b || 'import_batch_file_hashes_format', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'RECIBIDO', null, '{"cabecera":"abc"}')));
  perform pg_temp.expect('lote sin hashes', invalid_b || 'import_batch_file_hashes_format', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'RECIBIDO', null, '{}')));
  perform pg_temp.expect('lote con ruta de archivo como clave', invalid_b || 'import_batch_file_hashes_format', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'RECIBIDO', null, '{"/tmp/juan.tsv":"bbbb"}')));
  perform pg_temp.expect('lote con texto en conteos', invalid_b || 'import_batch_counts_format', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'RECIBIDO', 'p_counts => ''{"filas":{"nota":"texto"}}''')));
  perform pg_temp.expect('lote con conteo negativo', invalid_b || 'import_batch_counts_format', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'RECIBIDO', 'p_counts => ''{"filas":-1}''')));
  perform pg_temp.expect('cambio de estado como evento nuevo', 'OK', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'VALIDADO', format('p_supersedes => %s', bat)), true));
  perform pg_temp.expect('cada estado se reemplaza una vez', invalid_b || 'import_batch_supersedes_key', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'FALLIDO', format('p_supersedes => %s', bat))));
  perform pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_otro_sup, t_b), true);
  bat_b := current_setting('a018.id')::bigint;
  perform pg_temp.expect('supersedes de lote de otro tenant', invalid_b || 'import_batch_supersedes_fkey', pg_temp.probe('equitas_import_server', null, pg_temp.batch(u_importador, t_a, 'FALLIDO', format('p_supersedes => %s', bat_b))));
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
  perform pg_temp.expect('motivo: sin membresia no lo lee', 'ACTOR_NOT_ACTIVE_MEMBER', pg_temp.probe('equitas_review_server', null, format('select public.read_case_review_reason_text(%s, %s, %s)', u_sin, t_a, review_nota)));
  perform pg_temp.expect('motivo: otro tenant no lo lee', 'ACTOR_NOT_ACTIVE_MEMBER', pg_temp.probe('equitas_review_server', null, format('select public.read_case_review_reason_text(%s, %s, %s)', u_otro_op, t_a, review_nota)));
  perform pg_temp.expect('motivo: revision de otro tenant', 'REVIEW_NOT_IN_TENANT', pg_temp.probe('equitas_review_server', null, format('select public.read_case_review_reason_text(%s, %s, %s)', u_otro_op, t_b, review_nota)));

  -- J. Un rechazo no publica el contenido de la fila.
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
end $body$;

select caso, esperado, obtenido, case when esperado is not distinct from obtenido then 'OK' else 'FALLA' end from a018_result order by n;
select 'TOTAL', count(*), 'FALLAS', count(*) filter (where esperado is distinct from obtenido) from a018_result;
do $$ begin
  if exists(select 1 from a018_result where esperado is distinct from obtenido) then
    raise exception 'Hay casos que no dieron lo esperado';
  end if;
end $$;
rollback;
