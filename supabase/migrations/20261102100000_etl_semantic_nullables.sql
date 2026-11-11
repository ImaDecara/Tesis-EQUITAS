-- ALIGN-026. SOLO base local aislada (docs/tesis/entorno-aislado.md); nunca en el original ni en testing.

-- Permite que la carga guarde la ausencia como nula en lugar de un cero o un activo inventado (contrato-dominio-v1.md §4.1).

-- Sin datos. No crea, modifica ni elimina politicas, RLS ni grants. Conserva los valores por defecto: e06 no escribe estas columnas.

-- Reversion: db reset --version 20261030100000 (solo local). Inversa: SUPABASE_TESTING_CALIDAD.md.

do $$ begin if to_regclass('public.import_batch') is null then raise exception 'Requiere 20261030100000_case_review'; end if; end $$;

-- Indice heredado: no se recalcula con el promedio del lote (contrato-dominio-v1.md, PR08). Sin vencidas, la antiguedad no aplica (PR04).

alter table public."debtor_profile" alter column "socioeconomic_risk_level" drop not null;

alter table public."debtor_profile" alter column "oldest_debt_days" drop not null;

alter table public."debtor_profile" alter column "average_debt_age_days" drop not null;

-- Sin ningun estado de origen observado no se sabe que obligaciones estan vencidas: importe y conteo son nulos, no cero (PR02, PR03).

alter table public."debtor_profile" alter column "overdue_debt_amount" drop not null;

alter table public."debtor_profile" alter column "overdue_debt_count" drop not null;

-- Obligaciones del objeto sin estado observado. Nula en un perfil que no la calculo. Distingue un subtotal de un total y "no se sabe" de "no aplica" (PR04, PR11).

alter table public."debtor_profile" add column "debt_state_not_observed_count" integer;

alter table public."debtor_profile" add constraint "debtor_profile_debt_state_not_observed_count_check" check (debt_state_not_observed_count >= 0);

-- Sin ninguna columna de contacto en el archivo, el conteo no es cero (PR06).

alter table public."debtor_profile" alter column "available_contact_count" drop not null;

-- Gestiones previas: ninguna fuente las alimenta. El valor por defecto no significa cero gestiones (PR07).

alter table public."debtor_profile" alter column "previous_contact_count" drop not null;

alter table public."debtor_profile" alter column "previous_response_count" drop not null;

-- El detalle por persona derivaba de ese indice: la fila se conserva con valor nulo (PR09). Una tabla vacia se leeria como falla de RLS.

alter table public."debtor_profile_detail" alter column "risk_value" drop not null;

-- Estado del objeto vacio: no informado en origen, no activo (OB06).

alter table public."debtor" alter column "status" drop not null;

notify pgrst, 'reload schema';
