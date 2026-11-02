-- ALIGN-028. Lo que deben decir los reportes del municipio A, calculado con SQL y sin pasar por la aplicacion.
-- Como `postgres`, sin RLS: solo conteos y sumas de datos sinteticos. Devuelve una fila JSON.
with objects as (select id from public.debtor where tenant = 920001),
debts as (select d.* from public.debt d join objects o on o.id = d.debtor),
reviews as (select * from public.case_review where tenant = 920001),
current_reviews as (select r.* from reviews r where not exists(select 1 from reviews n where n.supersedes = r.id)),
approvals as (select * from public.case_review_approval where tenant = 920001),
current_approvals as (select a.* from approvals a where not exists(select 1 from approvals n where n.supersedes = a.id)),
intense as (select r.id from current_reviews r where r.decided_intensity >= 3)
select json_build_object(
  'objetos', (select count(*) from objects),
  'obligaciones', (select count(*) from debts),
  'deuda_total', (select sum(current_amount) from debts),
  'sin_contacto', (select count(*) from objects o where not exists(
    select 1 from public.debtor_person dp join public.debtor_contact c on c.person = dp.person
    where dp.debtor = o.id and dp.active and c.active and c.value <> '')),
  'eventos', (select count(*) from reviews),
  'vigentes', (select count(*) from current_reviews),
  'por_tipo', (select json_object_agg(decision, n) from (select decision, count(*) n from current_reviews group by decision) t),
  'no_acepta', (select count(*) from current_reviews where decision <> 'ACEPTA'),
  'motivos', (select json_object_agg(reason_code, n) from (select reason_code, count(*) n from current_reviews where reason_code is not null group by reason_code) t),
  'requerida', (select count(*) from intense),
  'pendientes', (select count(*) from intense i where not exists(select 1 from current_approvals a where a.case_review = i.id)),
  'aprueba', (select count(*) from intense i join current_approvals a on a.case_review = i.id where a.decision = 'APRUEBA'),
  'objeta', (select count(*) from intense i join current_approvals a on a.case_review = i.id where a.decision = 'OBJETA')
);
