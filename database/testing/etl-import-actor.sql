-- ALIGN-026. SOLO base local aislada, despues de etl-compat-catalogs.sql. Datos sinteticos.
-- Crea la cuenta de maquina que registra lotes del ETL en el tenant 1 (rol importador_sistema, ALIGN-003).
-- Sin auth_user ni pantallas. Repetirlo no cambia la base. Imprime el id para EQUITAS_IMPORT_ACTOR_USER.
-- psql -At -v ON_ERROR_STOP=1 -f database/testing/etl-import-actor.sql
begin;
insert into public.role(id, name, description)
select coalesce((select max(id) from public.role), 0) + 1, 'importador_sistema', 'Credencial de maquina para la ingesta, sin pantallas'
where not exists(select 1 from public.role where name = 'importador_sistema');

insert into public."user"(full_name, email) values('Importador sintetico ETL', 'importador-etl@example.invalid')
on conflict (email) do nothing;

insert into public.tenant_user(tenant, "user", role)
select 1, u.id, r.id
from public."user" u, public.role r
where u.email = 'importador-etl@example.invalid' and r.name = 'importador_sistema'
on conflict (tenant, "user") do nothing;
commit;

select id from public."user" where email = 'importador-etl@example.invalid';
