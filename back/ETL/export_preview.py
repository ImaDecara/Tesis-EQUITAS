from collections.abc import Hashable, Mapping
from pathlib import Path
from typing import Any
import argparse

import pandas as pd

from ETL.config import settings
from ETL.extract import extract_from_input_folder
from ETL.transform import (
    build_debtor_payload,
    build_header_context_by_clave,
    build_person_payload,
    clean_text,
    get_issue_date_from_header,
    get_last_collection_date_from_header,
    parse_decimal,
    parse_int,
    parse_date,
    infer_debt_status_id,
    DEFAULT_CURRENCY_ID,
    DEFAULT_DEBT_TYPE_ID,
)


def row_to_str_dict(row: Mapping[Hashable, Any]) -> dict[str, Any]:
    return {str(key): value for key, value in row.items()}


def dataframe_to_records(dataframe: pd.DataFrame) -> list[dict[str, Any]]:
    raw_records = dataframe.to_dict(orient="records")
    return [row_to_str_dict(row) for row in raw_records]


def build_person_preview(cabecera_df: pd.DataFrame) -> pd.DataFrame:
    rows: dict[int, dict[str, Any]] = {}

    for row in dataframe_to_records(cabecera_df):
        payload = build_person_payload(row)
        external_id = payload.get("external_id")

        if external_id is None:
            continue

        rows[int(external_id)] = payload

    return pd.DataFrame(rows.values())


def build_debtor_preview(cabecera_df: pd.DataFrame) -> pd.DataFrame:
    rows: dict[int, dict[str, Any]] = {}

    for row in dataframe_to_records(cabecera_df):
        payload = build_debtor_payload(row)
        external_id = payload.get("external_id")

        if external_id is None:
            continue

        rows[int(external_id)] = payload

    return pd.DataFrame(rows.values())


def build_debtor_person_preview(cabecera_df: pd.DataFrame) -> pd.DataFrame:
    rows: dict[tuple[int, int], dict[str, Any]] = {}

    for row in dataframe_to_records(cabecera_df):
        debtor_external_id = parse_int(row.get("Cuenta"))
        person_external_id = parse_int(row.get("Destinatario_Id"))

        if debtor_external_id is None or person_external_id is None:
            continue

        key = (debtor_external_id, person_external_id)

        rows[key] = {
            "debtor_external_id": debtor_external_id,
            "person_external_id": person_external_id,
            "priority": parse_decimal(row.get("Destinatario_Porcentaje")),
            "role": clean_text(row.get("Destinatario_Tipo")),
            "active": True,
            "source_clave_agrupacion": clean_text(row.get("ClaveAgrupacion")),
        }

    return pd.DataFrame(rows.values())


def build_debt_preview(
    cabecera_df: pd.DataFrame,
    detalle_df: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    header_context = build_header_context_by_clave(cabecera_df)

    unique_debts: dict[tuple[int, int], dict[str, Any]] = {}
    duplicated_rows: list[dict[str, Any]] = []

    for row in dataframe_to_records(detalle_df):
        account = parse_int(row.get("Cuenta"))
        debt_external_id = parse_int(row.get("DEUD_id"))

        if account is None or debt_external_id is None:
            continue

        debt_key = (account, debt_external_id)

        clave = clean_text(row.get("ClaveAgrupacion"))
        header_row = header_context.get(clave) if clave else None

        issue_date = get_issue_date_from_header(header_row)
        last_collection_date = get_last_collection_date_from_header(header_row)
        due_date = parse_date(row.get("NOTD_vencimiento"))

        preview_row = {
            "debtor_external_id": account,
            "external_id": debt_external_id,
            "type": parse_int(row.get("Tipo_Ingreso_Id"), DEFAULT_DEBT_TYPE_ID),
            "description": f"Deuda importada desde TSV - DEUD_id {debt_external_id}",
            "original_amount": parse_decimal(row.get("NOTD_capital")),
            "interest_amount_source": parse_decimal(row.get("NOTD_intereses")),
            "fee_amount_source": parse_decimal(row.get("NOTD_honorarios")),
            "current_amount": parse_decimal(row.get("NOTD_totalActualizado")),
            "currency": DEFAULT_CURRENCY_ID,
            "issue_date": issue_date,
            "due_date": due_date,
            "last_collection_date": last_collection_date,
            "period": clean_text(row.get("DEUD_id")),
            "status": infer_debt_status_id(due_date),
            "source_clave_agrupacion": clave,
            "source_cuenta": account,
            "source_notd_esta_id": clean_text(row.get("NOTD_ESTA_id")),
            "source_notd_situ_id": clean_text(row.get("NOTD_SITU_id")),
        }

        if debt_key in unique_debts:
            duplicated_rows.append(preview_row)
            continue

        unique_debts[debt_key] = preview_row

    return pd.DataFrame(unique_debts.values()), pd.DataFrame(duplicated_rows)


def build_summary_sheet(
    folder_name: str,
    cabecera_df: pd.DataFrame,
    detalle_df: pd.DataFrame,
    person_df: pd.DataFrame,
    debtor_df: pd.DataFrame,
    debtor_person_df: pd.DataFrame,
    debt_df: pd.DataFrame,
    duplicated_debt_df: pd.DataFrame,
) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {"metric": "folder", "value": folder_name},
            {"metric": "tenant_id", "value": settings.tenant_id},
            {"metric": "tenant_name", "value": settings.tenant_name},
            {"metric": "cabecera_rows", "value": len(cabecera_df)},
            {"metric": "detalle_rows", "value": len(detalle_df)},
            {"metric": "person_preview_rows", "value": len(person_df)},
            {"metric": "debtor_preview_rows", "value": len(debtor_df)},
            {"metric": "debtor_person_preview_rows", "value": len(debtor_person_df)},
            {"metric": "debt_unique_preview_rows", "value": len(debt_df)},
            {"metric": "debt_duplicated_rows_skipped", "value": len(duplicated_debt_df)},
        ]
    )


def autosize_excel_columns(
    writer: pd.ExcelWriter,
    sheet_name: str,
    dataframe: pd.DataFrame,
) -> None:
    """
    Ajusta automáticamente el ancho de columnas del Excel.

    Convierte todos los valores a texto antes de calcular len(),
    porque algunas columnas tienen floats, ints, fechas o None.
    """

    worksheet = writer.sheets[sheet_name]

    for column_index, column_name in enumerate(dataframe.columns, start=1):
        sample_values = dataframe[column_name].head(200).tolist()

        string_values = [str(value) for value in sample_values]

        max_length = max(
            [len(str(column_name)), *(len(value) for value in string_values)]
        )

        column_letter = worksheet.cell(
            row=1,
            column=column_index,
        ).column_letter

        worksheet.column_dimensions[column_letter].width = min(
            max_length + 2,
            60,
        )


def export_preview(folder_name: str, output_path: Path | None = None) -> Path:
    source_data = extract_from_input_folder(folder_name)

    cabecera_df = source_data.cabecera_df
    detalle_df = source_data.detalle_df

    person_df = build_person_preview(cabecera_df)
    debtor_df = build_debtor_preview(cabecera_df)
    debtor_person_df = build_debtor_person_preview(cabecera_df)
    debt_df, duplicated_debt_df = build_debt_preview(cabecera_df, detalle_df)

    summary_df = build_summary_sheet(
        folder_name=folder_name,
        cabecera_df=cabecera_df,
        detalle_df=detalle_df,
        person_df=person_df,
        debtor_df=debtor_df,
        debtor_person_df=debtor_person_df,
        debt_df=debt_df,
        duplicated_debt_df=duplicated_debt_df,
    )

    settings.processed_dir.mkdir(parents=True, exist_ok=True)

    if output_path is None:
        output_path = settings.processed_dir / f"{folder_name}_preview.xlsx"

    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        sheets = {
            "01_summary": summary_df,
            "02_person": person_df,
            "03_debtor": debtor_df,
            "04_debtor_person": debtor_person_df,
            "05_debt_unique": debt_df,
            "06_debt_duplicates_skipped": duplicated_debt_df,
        }

        for sheet_name, dataframe in sheets.items():
            dataframe.to_excel(writer, sheet_name=sheet_name, index=False)
            autosize_excel_columns(writer, sheet_name, dataframe)

    return output_path


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Exporta un Excel de preview del ETL antes de cargar Supabase."
    )

    parser.add_argument(
        "--folder",
        default="inmuebles",
        help="Carpeta dentro de back/data/input. Por defecto: inmuebles.",
    )

    parser.add_argument(
        "--output",
        default=None,
        help="Ruta opcional del archivo Excel de salida.",
    )

    args = parser.parse_args()

    output_path = Path(args.output) if args.output else None

    generated_path = export_preview(
        folder_name=args.folder,
        output_path=output_path,
    )

    print("EXPORT PREVIEW OK")
    print("-" * 80)
    print(f"Archivo generado: {generated_path}")
    print("-" * 80)


if __name__ == "__main__":
    main()