from collections.abc import Hashable, Mapping
from typing import Any
import argparse
import pandas as pd

from ETL.extract import extract_from_input_folder

# El módulo de transformación contiene funciones específicas para convertir las filas del DataFrame
from ETL.transform import (
    build_address_payload,
    build_city_payload,
    build_debt_payload,
    build_debtor_contact_payloads,
    build_debtor_profile_detail_payload,
    build_debtor_profile_payload,
    build_debtor_payload,
    build_debtor_person_payload,
    build_header_context_by_clave,
    build_person_payload,
    build_province_payload,
    clean_text,
    get_issue_date_from_header,
    get_last_collection_date_from_header,
    parse_decimal,
    parse_int,
    print_transform_summary,
)
from ETL.load import (
    load_address,
    load_city,
    load_debt,
    load_debtor,
    load_debtor_contact,
    load_debtor_person,
    load_debtor_profile,
    load_debtor_profile_detail,
    load_person,
    load_province,
)


#Convierte una fila de pandas a dict[str, Any], asegurando que las claves sean strings.
def row_to_str_dict(row: Mapping[Hashable, Any]) -> dict[str, Any]:
   
    return {str(key): value for key, value in row.items()}


#Convierte un DataFrame a lista de diccionarios con claves string.
# Esto es útil para evitar problemas de tipo de clave (por ejemplo, si el DataFrame tiene columnas con nombres que no son strings).
def dataframe_to_records(dataframe: pd.DataFrame) -> list[dict[str, Any]]:

    raw_records = dataframe.to_dict(orient="records")

    return [row_to_str_dict(row) for row in raw_records]


# Función principal del ETL
def run_etl(folder_name: str, execute: bool = False) -> None:
    source_data = extract_from_input_folder(folder_name)

    cabecera_df = source_data.cabecera_df
    detalle_df = source_data.detalle_df

    print_transform_summary(
        cabecera_df=cabecera_df,
        detalle_df=detalle_df,
    )

    if not execute:
        print()
        print("DRY-RUN FINALIZADO")
        print("No se insertó ni actualizó nada en Supabase.")
        print("Para ejecutar la carga real, usá el flag --execute.")
        return

    print()
    print("INICIANDO CARGA REAL EN SUPABASE")
    print("-" * 80)

    debtor_id_by_account: dict[int, int] = {}
    person_id_by_external_id: dict[int, int] = {}

    persons_loaded = 0
    debtors_loaded = 0
    relations_loaded = 0
    debts_loaded = 0
    duplicate_debts_skipped = 0

    provinces_loaded = 0
    cities_loaded = 0
    addresses_loaded = 0
    contacts_loaded = 0
    profiles_loaded = 0
    profile_details_loaded = 0

    # Diccionarios auxiliares para calcular debtor_profile al final del ETL.
    persons_by_debtor_id: dict[int, set[int]] = {}
    contact_keys_by_person_id: dict[int, set[tuple[int, str]]] = {}
    debt_payloads_by_debtor_id: dict[int, list[dict[str, Any]]] = {}
    relation_metadata_by_debtor_and_person: dict[tuple[int, int], dict[str, Any]] = {}

    # ========================================================
    # 1. PROCESAR CABECERA
    # ========================================================

    #Cargamos primero personas y deudores, para luego poder referenciarlos desde el detalle.
    for index, row in enumerate(dataframe_to_records(cabecera_df), start=1):
        person_payload = build_person_payload(row)
        debtor_payload = build_debtor_payload(row)

        person_external_id = person_payload.get("external_id")
        debtor_external_id = debtor_payload.get("external_id")

        if person_external_id is None:
            print(f"⚠️ Fila omitida: person sin external_id. Row: {row}")
            continue

        if debtor_external_id is None:
            print(f"⚠️ Fila omitida: debtor sin external_id. Row: {row}")
            continue

        person_row = load_person(person_payload)
        debtor_row = load_debtor(debtor_payload)

        person_id = int(person_row["id"])
        debtor_id = int(debtor_row["id"])

        person_id_by_external_id[int(person_external_id)] = person_id
        debtor_id_by_account[int(debtor_external_id)] = debtor_id
        persons_by_debtor_id.setdefault(debtor_id, set()).add(person_id)

        debtor_person_payload = build_debtor_person_payload(
            row=row,
            debtor_id=debtor_id,
            person_id=person_id,
        )

        load_debtor_person(debtor_person_payload)

        relation_metadata_by_debtor_and_person[(debtor_id, person_id)] = {
            "role": debtor_person_payload.get("role"),
            "priority": debtor_person_payload.get("priority"),
        }

        persons_loaded += 1
        debtors_loaded += 1
        relations_loaded += 1

        # ====================================================
        # 1.1 PROVINCE
        # ====================================================

        province_payload = build_province_payload(row)

        province_id: int | None = None
        city_id: int | None = None

        if province_payload:
            province_row = load_province(province_payload)
            province_id = int(province_row["id"])
            provinces_loaded += 1

        # ====================================================
        # 1.2 CITY
        # ====================================================

        if province_id is not None:
            city_payload = build_city_payload(
                row=row,
                province_id=province_id,
            )

            if city_payload:
                city_row = load_city(city_payload)
                city_id = int(city_row["id"])
                cities_loaded += 1

        # ====================================================
        # 1.3 ADDRESS
        # ====================================================

        if city_id is not None:
            address_payload = build_address_payload(
                row=row,
                person_id=person_id,
                city_id=city_id,
            )

            if address_payload:
                load_address(address_payload)
                addresses_loaded += 1

        # ====================================================
        # 1.4 DEBTOR CONTACT
        # ====================================================

        contact_payloads = build_debtor_contact_payloads(
            row=row,
            person_id=person_id,
        )

        for contact_payload in contact_payloads:
            load_debtor_contact(contact_payload)
            contacts_loaded += 1

            contact_type = contact_payload.get("type")
            contact_value = contact_payload.get("value")

            if contact_type is not None and contact_value:
                contact_keys_by_person_id.setdefault(person_id, set()).add(
                    (int(contact_type), str(contact_value))
                )

        if index % 10 == 0:
            print(f"Cabecera procesada: {index}/{len(cabecera_df)}")


    # ========================================================
    # 2. PROCESAR DETALLE
    # ========================================================
    
    # Desde detalle cargamos:
    # - debt
    # La deuda se deduplica por Cuenta + DEUD_id.
    
    header_context_by_clave = build_header_context_by_clave(cabecera_df)

    loaded_debt_keys: set[tuple[int, int]] = set()

    for index, row in enumerate(dataframe_to_records(detalle_df), start=1):
        account = parse_int(row.get("Cuenta"))
        debt_external_id = parse_int(row.get("DEUD_id"))

        if account is None:
            print(f"⚠️ Detalle omitido: sin Cuenta. Row: {row}")
            continue

        if debt_external_id is None:
            print(f"⚠️ Detalle omitido: sin DEUD_id. Row: {row}")
            continue

        debt_key = (account, debt_external_id)

        if debt_key in loaded_debt_keys:
            duplicate_debts_skipped += 1
            continue

        debtor_id = debtor_id_by_account.get(account)

        if debtor_id is None:
            print(
                f"⚠️ Detalle omitido: no existe debtor para Cuenta={account}, "
                f"DEUD_id={debt_external_id}"
            )
            continue

        clave = clean_text(row.get("ClaveAgrupacion"))
        header_row = header_context_by_clave.get(clave) if clave else None

        issue_date = get_issue_date_from_header(header_row)
        last_collection_date = get_last_collection_date_from_header(header_row)

        debt_payload = build_debt_payload(
            row=row,
            debtor_id=debtor_id,
            issue_date=issue_date,
            last_collection_date=last_collection_date,
        )

        load_debt(debt_payload)

        debt_payloads_by_debtor_id.setdefault(debtor_id, []).append(debt_payload)
        loaded_debt_keys.add(debt_key)
        debts_loaded += 1

        if index % 100 == 0:
            print(
                f"Detalle procesado: {index}/{len(detalle_df)} | "
                f"Deudas cargadas: {debts_loaded} | "
                f"Duplicadas omitidas: {duplicate_debts_skipped}"
            )


    # Calcula el promedio de deuda total por objeto para usarlo como referencia relativa del riesgo.
    total_debt_amounts_for_average: list[float] = []

    for debt_rows in debt_payloads_by_debtor_id.values():
        total_amount = sum(
            parse_decimal(row.get("current_amount"))
            for row in debt_rows
        )

        if total_amount > 0:
            total_debt_amounts_for_average.append(total_amount)

    average_total_debt_amount = (
        sum(total_debt_amounts_for_average) / len(total_debt_amounts_for_average)
        if total_debt_amounts_for_average
        else 0.0
    )

    print(f"Promedio de deuda por objeto usado para riesgo: {average_total_debt_amount:.2f}")

    # ========================================================
    # 3. CALCULAR Y CARGAR DEBTOR_PROFILE
    # ========================================================

    # El perfil se calcula al final porque depende de deudas, personas asociadas y contactos ya cargados.
    for debtor_id, person_ids in persons_by_debtor_id.items():
        debt_rows = debt_payloads_by_debtor_id.get(debtor_id, [])

        available_contact_count = sum(
            len(contact_keys_by_person_id.get(person_id, set()))
            for person_id in person_ids
        )

        debtor_profile_payload = build_debtor_profile_payload(
            debtor_id=debtor_id,
            debt_rows=debt_rows,
            active_person_count=len(person_ids),
            available_contact_count=available_contact_count,
            average_total_debt_amount=average_total_debt_amount,
        )

        debtor_profile_row = load_debtor_profile(debtor_profile_payload)
        debtor_profile_id = int(debtor_profile_row["id"])
        profiles_loaded += 1

        # ====================================================
        # 3.1 CALCULAR Y CARGAR DEBTOR_PROFILE_DETAIL
        # ====================================================

        # El detalle del perfil se calcula por cada persona asociada al objeto de deuda.
        for person_id in sorted(person_ids):
            person_contact_count = len(contact_keys_by_person_id.get(person_id, set()))
            relation_metadata = relation_metadata_by_debtor_and_person.get(
                (debtor_id, person_id),
                {},
            )

            debtor_profile_detail_payload = build_debtor_profile_detail_payload(
                debtor_profile_id=debtor_profile_id,
                person_id=person_id,
                profile_risk_level=int(debtor_profile_payload["socioeconomic_risk_level"]),
                person_contact_count=person_contact_count,
                role=clean_text(relation_metadata.get("role")),
                priority=parse_decimal(relation_metadata.get("priority")),
            )

            load_debtor_profile_detail(debtor_profile_detail_payload)
            profile_details_loaded += 1


    #Print de resumen final
    print()
    print("CARGA FINALIZADA")
    print("-" * 80)
    print(f"Person rows procesadas:              {persons_loaded}")
    print(f"Debtor rows procesadas:              {debtors_loaded}")
    print(f"Relaciones debtor_person cargadas:   {relations_loaded}")
    print(f"Deudas únicas cargadas/actualizadas: {debts_loaded}")
    print(f"Deudas duplicadas omitidas:          {duplicate_debts_skipped}")
    print(f"Provincias procesadas:               {provinces_loaded}")
    print(f"Ciudades procesadas:                 {cities_loaded}")
    print(f"Direcciones cargadas/actualizadas:   {addresses_loaded}")
    print(f"Contactos cargados/actualizados:     {contacts_loaded}")
    print(f"Perfiles debtor_profile cargados:    {profiles_loaded}")
    print(f"Detalles debtor_profile_detail:      {profile_details_loaded}")
    print("-" * 80)


# Entry point para ejecutar el ETL desde línea de comandos
def main() -> None:
    parser = argparse.ArgumentParser(
        description="Ejecuta el ETL de archivos TSV hacia Supabase."
    )

    parser.add_argument(
        "--folder",
        default="inmuebles",
        help="Carpeta dentro de back/data/input. Por defecto: inmuebles",
    )

    parser.add_argument(
        "--execute",
        action="store_true",
        help="Ejecuta la carga real en Supabase. Si no se usa, corre en modo dry-run.",
    )

    args = parser.parse_args()

    run_etl(
        folder_name=args.folder,
        execute=args.execute,
    )


if __name__ == "__main__":
    main()