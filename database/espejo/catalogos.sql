-- ESPEJO local de la base original (scripts/espejo/equitas_espejo.py). Datos sintéticos. Se puede repetir sin cambios.
-- Catálogos y municipios con ids explícitos: los id de la base original no tienen identidad comprobada.

begin;

-- Catálogo de roles INFORMADO POR EL USUARIO para la base original: 1 ADMIN, 2 USER.
insert into public.role(id, name, description) values
  (1, 'ADMIN', 'Administrador del sistema'), (2, 'USER', 'Usuario estándar')
on conflict (id) do nothing;

-- Estados de obligación: los OCHO que declara el cargador de main (back/ETL/transform.py en main@36f35b4).
-- TOMADO DEL CÓDIGO DE MAIN: el catálogo vivo de producción no se observó. No incluye SUSPENDED.
insert into public.debt_status(id, key, value) values
  (1, 'ACTIVE', 'Vigente'), (2, 'OVERDUE', 'Vencida'), (3, 'PAYMENT_PLAN', 'Plan de pago'), (4, 'JUDICIAL', 'Judicial'),
  (5, 'CERTIFICATE_ACTIVE', 'Certificado activo'), (6, 'PAID', 'Pagada'), (7, 'CANCELLED', 'Cancelada'), (8, 'UNKNOWN', 'Desconocido')
on conflict (id) do nothing;

insert into public.document_type(id, key, value) values (1, 'DNI', 'DNI'), (2, 'CUIT', 'CUIT'), (3, 'CUIL', 'CUIL'), (4, 'UNKNOWN', 'Desconocido')
on conflict (id) do nothing;
insert into public.person_type(id, key, value) values
  (1, 'INDIVIDUAL', 'Persona humana'), (2, 'LEGAL_PERSON', 'Persona juridica'), (3, 'COMPANY', 'Empresa'),
  (4, 'ASSOCIATION', 'Asociacion'), (5, 'UNKNOWN', 'Desconocido')
on conflict (id) do nothing;
insert into public.person_status(id, key, value) values (1, 'ACTIVE', 'Activa'), (2, 'INACTIVE', 'Inactiva'), (3, 'UNKNOWN', 'Desconocido')
on conflict (id) do nothing;
insert into public.currency(id, code, name) values (1, 'ARS', 'Peso argentino') on conflict (id) do nothing;
insert into public.contact_type(id, key, value) values
  (1, 'PHONE', 'Telefono'), (2, 'MOBILE', 'Celular'), (3, 'EMAIL', 'Email'), (4, 'LETTER', 'Carta'), (5, 'WHATSAPP', 'WhatsApp')
on conflict (id) do nothing;
insert into public.debtor_type(id, key, value) values (1, 'INMUEBLE', 'Inmueble'), (3, 'RODADO', 'Rodado'), (6, 'AGUA', 'Agua')
on conflict (id) do nothing;

insert into public.tenant(id, name, legal_name, status) values
  (1, 'Municipio sintético A (espejo)', 'Municipio sintético A', 'ACTIVE'),
  (2, 'Municipio sintético B (espejo)', 'Municipio sintético B', 'ACTIVE')
on conflict (id) do nothing;

commit;
