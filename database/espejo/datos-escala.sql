-- ESPEJO local. Cartera SINTÉTICA a escala, SOLO para medir: del orden de 2.900 objetos y 56.000 obligaciones
-- en el municipio 1. Sin personas, documentos ni contactos reales. La corre `equitas_espejo.py cargar escala`,
-- que antes vacía la cartera del espejo y después ejecuta ANALYZE.
--
-- Los estados se asignan como lo hace el cargador de main: por fecha de vencimiento (vigente, vencida,
-- desconocida si no hay fecha). Un 3 % se marca «Pagada» para que la exclusión de pagadas tenga efecto medible.

-- Un titular por objeto.
insert into public.person(id, external_id, document_type, document_number, full_name, type, status)
select 2000000 + n, 2000000 + n, 1, null, 'Persona sintética ' || n, case when n % 23 = 0 then 2 else 1 end, 1
from generate_series(1, 2900) n;

insert into public.debtor(id, tenant, external_id, type, identifier, description, status)
select 1000000 + n, 1, n, (array[1, 3, 6])[1 + n % 3], 'ESC-' || (array[1, 3, 6])[1 + n % 3] || '-' || lpad(n::text, 5, '0'),
       'Objeto sintético a escala', true
from generate_series(1, 2900) n;

insert into public.debtor_person(id, debtor, person, priority, role, active)
select 3000000 + n, 1000000 + n, 2000000 + n, 100, 'TITULAR', true from generate_series(1, 2900) n;
-- Uno de cada diez objetos tiene un segundo titular (la persona del objeto siguiente).
insert into public.debtor_person(id, debtor, person, priority, role, active)
select 3100000 + n, 1000000 + n, 2000000 + n + 1, 50, 'COTITULAR', true from generate_series(1, 2899) n where n % 10 = 0;

-- El 85 % de las personas tiene un correo cargado; el resto queda sin contacto.
insert into public.debtor_contact(id, person, type, value, active)
select 4000000 + n, 2000000 + n, 3, 'persona' || n || '@example.test', true from generate_series(1, 2900) n where n % 20 >= 3;

-- Entre 1 y 38 obligaciones por objeto (19,4 en promedio). Vencimientos repartidos en ocho años; un 2 % sin fecha.
insert into public.debt(id, external_id, debtor, type, description, original_amount, current_amount, updated_amount, currency, due_date, period, status)
select 5000000 + row_number() over (), row_number() over (), 1000000 + n, 'TASA', 'Obligación sintética',
       amount, amount, amount, 1, due,
       to_char(coalesce(due, date '2026-01-01'), 'YYYY-MM'),
       case when h % 100 < 3 then 6 when due is null then 8 when due < current_date then 2 else 1 end
from generate_series(1, 2900) n
cross join lateral generate_series(1, 1 + abs(hashint8(n)) % 38) k
cross join lateral (select abs(hashint8(n * 1000 + k)) as h) seed
cross join lateral (select 1000 + (seed.h % 4990) * 100 as amount,
                           case when seed.h % 50 = 7 then null else current_date + 120 - (seed.h % 2900)::int end as due) value;

-- Perfil por objeto, con la misma definición que el recálculo vigente (total registrado; vencida por calendario
-- sobre las no pagadas con importe mayor que cero).
insert into public.debtor_profile(id, debtor, total_debt_amount, overdue_debt_amount, debt_count, overdue_debt_count,
  oldest_debt_days, average_debt_age_days, active_person_count, available_contact_count, profile_generated_at, active)
select 6000000 + row_number() over (), d.debtor, sum(d.current_amount),
       coalesce(sum(d.current_amount) filter (where overdue), 0), count(*), count(*) filter (where overdue),
       coalesce(max(current_date - d.due_date) filter (where overdue), 0),
       coalesce(round(avg(current_date - d.due_date) filter (where overdue)), 0)::int, 1, 1, now(), true
from (select debtor, current_amount, due_date,
             coalesce(status, 0) <> 6 and current_amount > 0 and due_date < current_date as overdue from public.debt) d
group by d.debtor;
