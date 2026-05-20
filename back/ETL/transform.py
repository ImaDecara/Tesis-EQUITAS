from dataclasses import dataclass
from datetime import date
from typing import Any
from collections.abc import Hashable, Mapping
import re

import pandas as pd

from ETL.config import settings
from ETL.extract import extract_from_input_folder


# ============================================================
# IDS DE CATÁLOGOS SEGÚN SUPABASE
# ============================================================

# document_type
DOCUMENT_TYPE_DNI_ID = 1
DOCUMENT_TYPE_CUIT_ID = 2
DOCUMENT_TYPE_CUIL_ID = 3
DOCUMENT_TYPE_UNKNOWN_ID = 4

# person_type
PERSON_TYPE_INDIVIDUAL_ID = 1
PERSON_TYPE_LEGAL_PERSON_ID = 2
PERSON_TYPE_COMPANY_ID = 3
PERSON_TYPE_ASSOCIATION_ID = 4
PERSON_TYPE_UNKNOWN_ID = 5

# person_status
PERSON_STATUS_ACTIVE_ID = 1
PERSON_STATUS_INACTIVE_ID = 2
PERSON_STATUS_UNKNOWN_ID = 3

# debtor_type
# Para este primer archivo de inmuebles, Bien_Tipo_Id = 1
DEFAULT_DEBTOR_TYPE_ID = 1

# debt.type
# Para este primer archivo, Tipo_Ingreso_Id = 1
DEFAULT_DEBT_TYPE_ID = 1

# currency
# Asumimos ARS = 1
DEFAULT_CURRENCY_ID = 1

# debt_status
DEBT_STATUS_ACTIVE_ID = 1
DEBT_STATUS_OVERDUE_ID = 2
DEBT_STATUS_PAYMENT_PLAN_ID = 3
DEBT_STATUS_JUDICIAL_ID = 4
DEBT_STATUS_CERTIFICATE_ACTIVE_ID = 5
DEBT_STATUS_PAID_ID = 6
DEBT_STATUS_CANCELLED_ID = 7
DEBT_STATUS_UNKNOWN_ID = 8


# ============================================================
# TIPOS PARA RESUMEN DE TRANSFORMACIÓN
# ============================================================

# Este resumen se construye antes de insertar nada en Supabase, para validar que la transformación tiene sentido.
@dataclass
class TransformSummary:
    persons_count: int
    debtors_count: int
    debtor_person_relations_count: int
    detail_rows_count: int
    unique_debts_count: int
    duplicated_debt_rows_count: int


# ============================================================
# FUNCIONES DE LIMPIEZA Y PARSEO
# ============================================================

#Limpia un valor y lo convierte a texto. Si viene vacío, devuelve None.
def clean_text(value: Any) -> str | None:
    
    if value is None:
        return None

    text = str(value).strip()

    if text == "" or text.lower() in {"nan", "none", "null"}:
        return None

    return text

# Convierte una fila proveniente de pandas a dict[str, Any], 
# asegurando que las claves sean strings panda usa claves hashables
def row_to_str_dict(row: Mapping[Hashable, Any]) -> dict[str, Any]:
    

    return {str(key): value for key, value in row.items()}


# Convierte un DataFrame a una lista de diccionarios con claves string.
def dataframe_to_records(dataframe: pd.DataFrame) -> list[dict[str, Any]]:
    
    raw_records = dataframe.to_dict(orient="records")

    return [row_to_str_dict(row) for row in raw_records]

#Devuelve solo los dígitos de un valor. Sirve para CUIT, CUIL, DNI, Cuenta, DEUD_id, etc.
def only_digits(value: Any) -> str | None:
    
    text = clean_text(value)

    if text is None:
        return None

    digits = re.sub(r"\D", "", text)

    return digits or None

#Convierte un valor a entero. Si no se puede, devuelve None o un default dado.
def parse_int(value: Any, default: int | None = None) -> int | None:
   
    digits = only_digits(value)

    if digits is None:
        return default

    try:
        return int(digits)
    except ValueError:
        return default


#Convierte un valor a decimal (float). Si no se puede, devuelve 0.0.
def parse_decimal(value: Any) -> float:

    text = clean_text(value)

    if text is None:
        return 0.0

    cleaned = text.replace("$", "").replace(" ", "")

    if "," in cleaned and "." in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    else:
        cleaned = cleaned.replace(",", ".")

    try:
        return float(cleaned)
    except ValueError:
        return 0.0

#Convierte fechas del TSV a formato ISO YYYY-MM-DD.
def parse_date(value: Any) -> str | None:
   
    text = clean_text(value)

    if text is None:
        return None

    parsed = pd.to_datetime(text, dayfirst=True, errors="coerce")

    if pd.isna(parsed):
        return None

    return parsed.date().isoformat()


#Convierte textos del TSV a booleano.
#Activo -> True
#Inactivo -> False
def parse_bool(value: Any, default: bool = True) -> bool:

    text = clean_text(value)

    if text is None:
        return default

    normalized = text.lower()

    true_values = {
        "true",
        "t",
        "1",
        "si",
        "sí",
        "yes",
        "y",
        "activo",
        "activa",
    }

    false_values = {
        "false",
        "f",
        "0",
        "no",
        "n",
        "inactivo",
        "inactiva",
    }

    if normalized in true_values:
        return True

    if normalized in false_values:
        return False

    return default


# ============================================================
# REGLAS DE INFERENCIA
# ============================================================

# Estas funciones infieren valores a partir de otros campos, para completar los payloads
def infer_document_type_id(document_number: str | None) -> int:
    """
    Infere document_type.

    Como el archivo trae Destinatario_CUIT, por defecto lo tratamos como CUIT.
    Si falta, asignamos unknown.
    """

    if not document_number:
        return DOCUMENT_TYPE_UNKNOWN_ID

    return DOCUMENT_TYPE_CUIT_ID


def infer_person_type_id(document_number: str | None) -> int:

    digits = only_digits(document_number)

    if not digits or len(digits) < 2:
        return PERSON_TYPE_UNKNOWN_ID

    prefix = digits[:2]

    if prefix in {"20", "23", "24", "27"}:
        return PERSON_TYPE_INDIVIDUAL_ID

    if prefix in {"30", "33", "34"}:
        return PERSON_TYPE_LEGAL_PERSON_ID

    return PERSON_TYPE_UNKNOWN_ID


def infer_debt_status_id(due_date: str | None) -> int:

    if not due_date:
        return DEBT_STATUS_UNKNOWN_ID

    parsed = pd.to_datetime(due_date, errors="coerce")

    if pd.isna(parsed):
        return DEBT_STATUS_UNKNOWN_ID

    if parsed.date() < date.today():
        return DEBT_STATUS_OVERDUE_ID

    return DEBT_STATUS_ACTIVE_ID


# ============================================================
# BUILDERS DE PAYLOADS PARA SUPABASE
# ============================================================

def build_person_payload(row: dict[str, Any]) -> dict[str, Any]:

    document_number = clean_text(row.get("Destinatario_CUIT"))

    return {
        "external_id": parse_int(row.get("Destinatario_Id")),
        "document_type": infer_document_type_id(document_number),
        "document_number": document_number,
        "full_name": clean_text(row.get("Destinatario")),
        "type": infer_person_type_id(document_number),
        "birth_date": None,
        "status": PERSON_STATUS_ACTIVE_ID,
    }


def build_debtor_payload(row: dict[str, Any]) -> dict[str, Any]:
    
    return {
        "tenant": settings.tenant_id,
        "external_id": parse_int(row.get("Cuenta")),
        "type": parse_int(row.get("Bien_Tipo_Id"), DEFAULT_DEBTOR_TYPE_ID),
        "identifier": clean_text(row.get("Identificador")),
        "description": clean_text(row.get("Bien_Descripcion")),
        "status": parse_bool(row.get("Estado"), default=True),
    }


def build_debtor_person_payload(
    row: dict[str, Any],
    debtor_id: int,
    person_id: int,
) -> dict[str, Any]:
    
    return {
        "debtor": debtor_id,
        "person": person_id,
        "priority": parse_decimal(row.get("Destinatario_Porcentaje")),
        "role": clean_text(row.get("Destinatario_Tipo")),
        "active": True,
    }


def build_debt_payload(
    row: dict[str, Any],
    debtor_id: int,
    issue_date: str | None = None,
    last_collection_date: str | None = None,
) -> dict[str, Any]:

    debt_external_id = parse_int(row.get("DEUD_id"))
    due_date = parse_date(row.get("NOTD_vencimiento"))

    return {
        "external_id": debt_external_id,
        "debtor": debtor_id,
        "type": parse_int(row.get("Tipo_Ingreso_Id"), DEFAULT_DEBT_TYPE_ID),
        "description": f"Deuda importada desde TSV - DEUD_id {debt_external_id}",
        "original_amount": parse_decimal(row.get("NOTD_capital")),
        "current_amount": parse_decimal(row.get("NOTD_totalActualizado")),
        "currency": DEFAULT_CURRENCY_ID,
        "issue_date": issue_date,
        "due_date": due_date,
        "last_collection_date": last_collection_date,
        "period": clean_text(row.get("DEUD_id")),
        "status": infer_debt_status_id(due_date),
    }


# ============================================================
# FUNCIONES AUXILIARES PARA TRANSFORMACIÓN
# ============================================================

# Crea un diccionario para acceder rápidamente a una fila de cabecera usando ClaveAgrupacion.
# Esto servirá después para tomar Fecha_Actualizacion de cabecera cuando estemos procesando detalle.
def build_header_context_by_clave(cabecera_df: pd.DataFrame) -> dict[str, dict[str, Any]]:
    
    context: dict[str, dict[str, Any]] = {}

    for row in dataframe_to_records(cabecera_df):
        clave = clean_text(row.get("ClaveAgrupacion"))

        if clave and clave not in context:
            context[clave] = row

    return context


def get_issue_date_from_header(header_row: dict[str, Any] | None) -> str | None:

    if not header_row:
        return None

    return parse_date(header_row.get("Fecha_Actualizacion"))


# Para el MVP usamos Fecha_Actualizacion también como last_collection_date.
def get_last_collection_date_from_header(header_row: dict[str, Any] | None) -> str | None:
    
    if not header_row:
        return None

    return parse_date(header_row.get("Fecha_Actualizacion"))


# ============================================================
# RESUMEN DRY-RUN DE TRANSFORMACIÓN
# ============================================================

# Construye un resumen de lo que se transformaría, sin insertar nada en Supabase.
# Sirve para validar que la transformación tiene sentido antes de hacer cualquier inserción.
def build_transform_summary(
    cabecera_df: pd.DataFrame,
    detalle_df: pd.DataFrame,
) -> TransformSummary:
    
    persons_by_external_id: set[int] = set()
    debtors_by_account: set[int] = set()
    debtor_person_relations: set[tuple[int, int]] = set()

    for row in cabecera_df.to_dict(orient="records"):
        person_external_id = parse_int(row.get("Destinatario_Id"))
        debtor_external_id = parse_int(row.get("Cuenta"))

        if person_external_id is not None:
            persons_by_external_id.add(person_external_id)

        if debtor_external_id is not None:
            debtors_by_account.add(debtor_external_id)

        if debtor_external_id is not None and person_external_id is not None:
            debtor_person_relations.add((debtor_external_id, person_external_id))

    unique_debt_keys: set[tuple[int, int]] = set()
    duplicated_debt_rows_count = 0

    for row in dataframe_to_records(detalle_df):
        debtor_external_id = parse_int(row.get("Cuenta"))
        debt_external_id = parse_int(row.get("DEUD_id"))

        if debtor_external_id is None or debt_external_id is None:
            continue

        # Clave correcta para no duplicar deudas:
        # una deuda se carga una sola vez por Cuenta + DEUD_id.
        debt_key = (debtor_external_id, debt_external_id)

        if debt_key in unique_debt_keys:
            duplicated_debt_rows_count += 1
        else:
            unique_debt_keys.add(debt_key)

    return TransformSummary(
        persons_count=len(persons_by_external_id),
        debtors_count=len(debtors_by_account),
        debtor_person_relations_count=len(debtor_person_relations),
        detail_rows_count=len(detalle_df),
        unique_debts_count=len(unique_debt_keys),
        duplicated_debt_rows_count=duplicated_debt_rows_count,
    )


# Imprime un resumen de lo que el ETL transformaría. Sirve para validar que la transformación tiene sentido antes de hacer cualquier inserción.
def print_transform_summary(
    cabecera_df: pd.DataFrame,
    detalle_df: pd.DataFrame,
) -> None:
    summary = build_transform_summary(cabecera_df, detalle_df)

    print("TRANSFORM DRY-RUN OK")
    print("-" * 80)
    print(f"Tenant actual:                          {settings.tenant_id} - {settings.tenant_name}")
    print(f"Personas únicas detectadas:             {summary.persons_count}")
    print(f"Debtors / cuentas únicas detectadas:    {summary.debtors_count}")
    print(f"Relaciones debtor_person detectadas:    {summary.debtor_person_relations_count}")
    print(f"Filas de detalle leídas:                {summary.detail_rows_count}")
    print(f"Deudas únicas por Cuenta + DEUD_id:     {summary.unique_debts_count}")
    print(f"Filas de deuda duplicadas a ignorar:    {summary.duplicated_debt_rows_count}")
    print("-" * 80)

    if len(cabecera_df) > 0:
        first_header_row = row_to_str_dict(cabecera_df.iloc[0].to_dict())

        print("\nEjemplo person_payload:")
        print(build_person_payload(first_header_row))

        print("\nEjemplo debtor_payload:")
        print(build_debtor_payload(first_header_row))

        print("\nEjemplo debtor_person_payload con IDs internos simulados:")
        print(
            build_debtor_person_payload(
                first_header_row,
                debtor_id=999,
                person_id=888,
            )
        )

    if len(detalle_df) > 0:
        first_detail_row = row_to_str_dict(detalle_df.iloc[0].to_dict())

        header_context = build_header_context_by_clave(cabecera_df)
        clave = clean_text(first_detail_row.get("ClaveAgrupacion"))
        header_row = header_context.get(clave) if clave else None

        issue_date = get_issue_date_from_header(header_row)
        last_collection_date = get_last_collection_date_from_header(header_row)

        print("\nEjemplo debt_payload con debtor_id interno simulado:")
        print(
            build_debt_payload(
                first_detail_row,
                debtor_id=999,
                issue_date=issue_date,
                last_collection_date=last_collection_date,
            )
        )


if __name__ == "__main__":
    source_data = extract_from_input_folder("inmuebles")

    print_transform_summary(
        cabecera_df=source_data.cabecera_df,
        detalle_df=source_data.detalle_df,
    )