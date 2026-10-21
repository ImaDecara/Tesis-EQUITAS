-- Datos totalmente sinteticos. SOLO en el proyecto de testing vacio/preparado.
-- IDs reservados 910001..910004; no es una carga de la cartera real.
insert into public.tenant(id,name) values(910001,'TP E06 A'),(910002,'TP E06 B');
insert into public.role(id,name) values(910001,'tp_operator');
insert into public."user"(id,auth_user,full_name,email)
select 910000 + case split_part(email,'@',1)
  when 'tp-e06-a' then 1 when 'tp-e06-b' then 2
  when 'tp-e06-none' then 3 when 'tp-e06-inactive' then 4 end,
  id,'Fixture '||email,email from auth.users where email in
  ('tp-e06-a@example.test','tp-e06-b@example.test','tp-e06-none@example.test','tp-e06-inactive@example.test');
insert into public.tenant_user(id,tenant,"user",role,status) values
  (910001,910001,910001,910001,true),
  (910002,910002,910002,910001,true),
  (910004,910001,910004,910001,false);
insert into public.currency(id,code,name) values(910001,'ARS','Peso sintetico');
insert into public.debtor_type(id,key,value) values(910001,'TP','Objeto de prueba');
insert into public.debt_status(id,key,value) values(910001,'OVERDUE','Vencida');
insert into public.contact_type(id,key,value) values(910001,'EMAIL','Email');
insert into public.document_type(id,key,value) values(910001,'TEST','Documento sintetico');
insert into public.person_type(id,key,value) values(910001,'TEST','Persona sintetica');
insert into public.person_status(id,key,value) values(910001,'ACTIVE','Activa');
insert into public.province(id,name) values(910001,'Provincia sintetica');
insert into public.city(id,province,name) values(910001,910001,'Ciudad sintetica');
insert into public.data_source_type(id,name) values(910001,'Fixture');
insert into public.debtor(id,tenant,external_id,type,identifier,description) values
  (910001,910001,910001,910001,'TP-A','Objeto A sintetico'),
  (910002,910002,910002,910001,'TP-B','Objeto B sintetico');
insert into public.debt(id,external_id,debtor,original_amount,current_amount,currency,status,due_date) values
  (910001,910001,910001,1250,1250,910001,910001,'2026-01-01'),
  (910002,910002,910002,2500,2500,910001,910001,'2026-01-01');
insert into public.person(id,external_id,full_name,document_type,type,status) values
  (910001,910001,'Persona sintetica A',910001,910001,910001),
  (910002,910002,'Persona sintetica B',910001,910001,910001);
insert into public.debtor_person(id,debtor,person,role,priority) values
  (910001,910001,910001,'Titular',1),(910002,910002,910002,'Titular',1);
insert into public.debtor_contact(id,person,type,value) values
  (910001,910001,910001,'persona-a@example.test'),
  (910002,910002,910001,'persona-b@example.test');
insert into public.address(id,person,street,city) values
  (910001,910001,'Calle sintetica A',910001),(910002,910002,'Calle sintetica B',910001);
insert into public.data_source(id,tenant,name,type,connection_info) values
  (910001,910001,'Fuente A',910001,'{"fixture":true}'),
  (910002,910002,'Fuente B',910001,'{"fixture":true}');
insert into public.debtor_profile(id,debtor,total_debt_amount,overdue_debt_amount,debt_count,
  overdue_debt_count,active_person_count,available_contact_count,socioeconomic_risk_level) values
  (910001,910001,1250,1250,1,1,1,1,20),(910002,910002,2500,2500,1,1,1,1,80);
insert into public.debtor_profile_detail(id,debtor_profile,person,risk_value,reason) values
  (910001,910001,910001,20,'Fixture A'),(910002,910002,910002,80,'Fixture B');
