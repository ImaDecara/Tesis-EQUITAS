from collections.abc import Hashable, Mapping
from typing import Any
import argparse

import pandas as pd

from ETL.extract import extract_from_input_folder
from ETL.transform import (
    build_debt_payload,
    build_debtor_payload,
    build_debtor_person_payload,
    build_header_context_by_clave,
    build_person_payload,
    clean_text,
    get_issue_date_from_header,
    get_last_collection_date_from_header,
    parse_int,
    print_transform_summary,
)
from ETL.load import (
    load_debt,
    load_debtor,
    load_debtor_person,
    load_person,
)


def row_to_str_dict(row: Mapping[Hashable, Any]) -> dict[str, Any]:
    """
    Convierte una fila de pandas a dict[str, Any].
    """

    return {str(key): value for key, value in row.items()}


def dataframe_to_records(dataframe: pd.DataFrame) -> list[dict[str, Any]]:
    """
    Convierte un DataFrame a lista de diccionarios con claves string.
    """

    raw_records = dataframe.to_dict(orient="records")

    return [row_to_str_dict(row) for row in raw_records]


def run_etl(folder_name: str, execute: bool = False) -> None:
    """
    Ejecuta el ETL.

    Si execute=False:
        Solo muestra resumen. No carga datos.

    Si execute=True:
        Inserta/actualiza datos en Supabase.
    """

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

    # ========================================================
    # 1. PROCESAR CABECERA
    # ========================================================
    #
    # Desde cabecera cargamos:
    # - person
    # - debtor
    # - debtor_person
    #

    for row in dataframe_to_records(cabecera_df):
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

        debtor_person_payload = build_debtor_person_payload(
            row=row,
            debtor_id=debtor_id,
            person_id=person_id,
        )

        load_debtor_person(debtor_person_payload)

        persons_loaded += 1
        debtors_loaded += 1
        relations_loaded += 1

    # ========================================================
    # 2. PROCESAR DETALLE
    # ========================================================
    #
    # Desde detalle cargamos:
    # - debt
    #
    # Regla importante:
    # La deuda se deduplica por Cuenta + DEUD_id.
    #

    header_context_by_clave = build_header_context_by_clave(cabecera_df)

    loaded_debt_keys: set[tuple[int, int]] = set()

    for row in dataframe_to_records(detalle_df):
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

        loaded_debt_keys.add(debt_key)
        debts_loaded += 1

    print()
    print("CARGA FINALIZADA")
    print("-" * 80)
    print(f"Person rows procesadas:              {persons_loaded}")
    print(f"Debtor rows procesadas:              {debtors_loaded}")
    print(f"Relaciones debtor_person cargadas:   {relations_loaded}")
    print(f"Deudas únicas cargadas/actualizadas: {debts_loaded}")
    print(f"Deudas duplicadas omitidas:          {duplicate_debts_skipped}")
    print("-" * 80)


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