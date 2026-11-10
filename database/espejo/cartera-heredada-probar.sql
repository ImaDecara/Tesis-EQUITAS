-- ESPEJO local. Prueba de public.register_inherited_portfolio (encargo 10.4). TODO ocurre dentro de una transacción
-- que termina en ROLLBACK: no deja ningún lote. Requiere la cartera «chico» o «escala» cargada, paquete-minimo.sql y
-- cartera-heredada.sql. Cuentas del espejo: 101 ADMIN, 102 USER, 105 membresía inactiva (municipio 1); 103 USER (municipio 2).

begin;

create function pg_temp.espera(p_caso text, p_sql text, p_error text) returns text language plpgsql as $f$
begin
  execute p_sql;
  return format('FALLA  %s: se esperaba %s y no falló', p_caso, p_error);
exception when others then
  return format('%s  %s: %s', case when sqlerrm = p_error then 'ok   ' else 'FALLA' end, p_caso, sqlerrm);
end $f$;

select pg_temp.espera('una cuenta USER no puede registrar', $$select public.register_inherited_portfolio(102, 1, date '2026-09-30', '1.1.0')$$, 'ROLE_NOT_ALLOWED');
select pg_temp.espera('una membresía inactiva no puede registrar', $$select public.register_inherited_portfolio(105, 1, date '2026-09-30', '1.1.0')$$, 'ACTOR_NOT_ACTIVE_MEMBER');
select pg_temp.espera('una persona de otro municipio no puede registrar', $$select public.register_inherited_portfolio(103, 1, date '2026-09-30', '1.1.0')$$, 'ACTOR_NOT_ACTIVE_MEMBER');
select pg_temp.espera('la fecha declarada no puede ser futura', $$select public.register_inherited_portfolio(101, 1, current_date + 1, '1.1.0')$$, 'DECLARED_DATE_INVALID');
select pg_temp.espera('la fecha declarada es obligatoria', $$select public.register_inherited_portfolio(101, 1, null, '1.1.0')$$, 'DECLARED_DATE_INVALID');

-- Un municipio sin cartera no se registra (se le da un ADMIN solo dentro de esta transacción).
insert into public.tenant_user(id, tenant, "user", role, status) values (999, 2, 101, 1, true);
select pg_temp.espera('un municipio sin cartera no se registra', $$select public.register_inherited_portfolio(101, 2, date '2026-09-30', '1.1.0')$$, 'PORTFOLIO_EMPTY');

-- Registro válido: cumple TODAS las restricciones reales de import_batch (si no, el insert fallaría).
select 'registro válido: ' || (public.register_inherited_portfolio(101, 1, date '2026-09-30', '1.1.0') - 'contenido_al_registrar')::text;
select 'lote guardado:  ' || concat_ws(' | ', source, status, as_of, rules_version, created_by_role, counts::text,
       'huella de ' || length(file_hashes->>'contenido_al_registrar') || ' hex', 'supersedes ' || coalesce(supersedes::text, 'nulo'))
from public.import_batch where tenant = 1;
select 'la huella coincide con los conteos reales: ' ||
       ((counts->>'objetos')::bigint = (select count(*) from public.debtor where tenant = 1)
        and (counts->>'obligaciones')::bigint = (select count(*) from public.debt o join public.debtor d on d.id = o.debtor where d.tenant = 1))::text
from public.import_batch where tenant = 1;

select pg_temp.espera('una segunda ejecución falla', $$select public.register_inherited_portfolio(101, 1, date '2026-09-30', '1.1.0')$$, 'PORTFOLIO_ALREADY_REGISTERED');
select pg_temp.espera('con un lote previo, otra fecha tampoco entra', $$select public.register_inherited_portfolio(101, 1, date '2026-08-31', '1.1.0')$$, 'PORTFOLIO_ALREADY_REGISTERED');
select pg_temp.espera('el lote no se puede modificar', $$update public.import_batch set as_of = date '2026-01-01' where tenant = 1$$, 'APPEND_ONLY');

-- La función de corte de la base selecciona ese lote (se ejecuta con el rol dueño, solo dentro de esta transacción).
grant equitas_write_definer to postgres with set true;
set local role equitas_write_definer;
select 'equitas_current_cutoff lo selecciona: ' || (public.equitas_current_cutoff(1) = (select id from public.import_batch where tenant = 1))::text;
select pg_temp.espera('una decisión con otra fecha de cartera no entra', $$select public.equitas_verify_cutoff(1, public.equitas_current_cutoff(1), date '2026-10-31')$$, 'CUTOFF_CHANGED');
select 'la fecha declarada es la que verifica una decisión: ' || (public.equitas_verify_cutoff(1, public.equitas_current_cutoff(1), date '2026-09-30') is not null)::text;
reset role;

-- Nadie fuera de quien administra la base puede ejecutarla.
select 'ejecutable por anon/authenticated/service_role/equitas_review_server: ' || string_agg(r || '=' || has_function_privilege(r, 'public.register_inherited_portfolio(bigint,bigint,date,text)', 'execute'), ' ')
from unnest(array['anon', 'authenticated', 'service_role', 'equitas_review_server']) r;

rollback;
