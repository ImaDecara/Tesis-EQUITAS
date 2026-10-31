-- SOLO Supabase local, con exclusividad concedida y la primera migracion aplicada.
-- Variables psql auth_a, auth_b, auth_none, auth_inactive y auth_multi:
-- UUID de cinco cuentas Auth sinteticas previamente provisionadas por el runner.
-- No contiene claves ni passwords. No crea/borra cuentas ni cambia politicas.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='debtor' AND qual='true') THEN
    RAISE EXCEPTION 'ALIGN-019 requiere la base local con USING(true)';
  END IF;
END $$;
INSERT INTO public.role (id,name) VALUES (9801901,'consulta'), (9801902,'supervisor');
INSERT INTO public.tenant (id,name) VALUES (9801901,'ALIGN019 municipio A'), (9801902,'ALIGN019 municipio B');
INSERT INTO public."user" (id,auth_user,full_name,email,status) VALUES
  (9801901, :'auth_a', 'ALIGN019 usuario A', 'align019-a@example.test', 'ACTIVE'),
  (9801902, :'auth_b', 'ALIGN019 usuario B', 'align019-b@example.test', 'ACTIVE'),
  (9801903, :'auth_none', 'ALIGN019 sin membresia', 'align019-none@example.test', 'ACTIVE'),
  (9801904, :'auth_inactive', 'ALIGN019 inactivo', 'align019-inactive@example.test', 'INACTIVE'),
  (9801905, :'auth_multi', 'ALIGN019 multiple', 'align019-multi@example.test', 'ACTIVE');
INSERT INTO public.tenant_user (id,tenant,"user",role,status) VALUES
  (9801901,9801901,9801901,9801901,true), (9801902,9801902,9801902,9801901,true),
  (9801904,9801901,9801904,9801901,true),
  (9801905,9801901,9801905,9801902,true), (9801906,9801902,9801905,9801902,true);
INSERT INTO public.debtor_type (id,key,value) VALUES (9801901,'ALIGN019','Tributo sintetico');
INSERT INTO public.debt_status (id,key,value) VALUES (9801901,'OVERDUE','Vencida');
INSERT INTO public.contact_type (id,key,value) VALUES (9801901,'EMAIL','Email sintetico');
INSERT INTO public.debtor (id,tenant,external_id,type,identifier) VALUES
  (9801901,9801901,9801901,9801901,'ALIGN019_OBJ_A'), (9801902,9801902,9801902,9801901,'ALIGN019_OBJ_B');
INSERT INTO public.debt (id,external_id,debtor,original_amount,current_amount,due_date,status) VALUES
  (9801901,9801901,9801901,101,101,'2026-01-01',9801901), (9801902,9801902,9801902,202,202,'2026-01-01',9801901);
INSERT INTO public.person (id,external_id,full_name) VALUES
  (9801901,9801901,'ALIGN019_PERSON_A'), (9801902,9801902,'ALIGN019_PERSON_B'),
  (9801903,9801903,'ALIGN019_PERSON_SHARED');
INSERT INTO public.debtor_person (id,debtor,person,priority) VALUES
  (9801901,9801901,9801901,100), (9801902,9801902,9801902,100),
  (9801903,9801901,9801903,90), (9801904,9801902,9801903,90);
INSERT INTO public.debtor_contact (id,person,type,value) VALUES
  (9801901,9801901,9801901,'align019-a@example.test'), (9801902,9801902,9801901,'align019-b@example.test'),
  (9801903,9801903,9801901,'align019-shared@example.test');
INSERT INTO public.debtor_profile (id,debtor,total_debt_amount) VALUES (9801901,9801901,101), (9801902,9801902,202);
INSERT INTO public.debtor_profile_detail (id,debtor_profile,person,risk_value) VALUES
  (9801901,9801901,9801901,10), (9801902,9801902,9801902,20),
  (9801903,9801901,9801903,33), (9801904,9801902,9801903,77);
COMMIT;
