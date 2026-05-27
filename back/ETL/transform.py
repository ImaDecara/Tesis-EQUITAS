from dataclasses import dataclass
from datetime import date, datetime, timezone
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

# contact_type
CONTACT_TYPE_PHONE_ID = 1
CONTACT_TYPE_MOBILE_ID = 2
CONTACT_TYPE_EMAIL_ID = 3
CONTACT_TYPE_LETTER_ID = 4
CONTACT_TYPE_WHATSAPP_ID = 5


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

# Limpia un valor y lo convierte a texto. Si viene vacío, devuelve None.
def clean_text(value: Any) -> str | None:

    if value is None:
        return None

    text = str(value).strip()

    if text == "" or text.lower() in {"nan", "none", "null"}:
        return None

    return text


# Convierte una fila proveniente de pandas a dict[str, Any],
# asegurando que las claves sean strings porque pandas usa claves hashables.
def row_to_str_dict(row: Mapping[Hashable, Any]) -> dict[str, Any]:
    return {str(key): value for key, value in row.items()}


# Convierte un DataFrame a una lista de diccionarios con claves string.
def dataframe_to_records(dataframe: pd.DataFrame) -> list[dict[str, Any]]:
    raw_records = dataframe.to_dict(orient="records")
    return [row_to_str_dict(row) for row in raw_records]


# Devuelve solo los dígitos de un valor. Sirve para CUIT, CUIL, DNI, Cuenta, DEUD_id, etc.
def only_digits(value: Any) -> str | None:

    text = clean_text(value)

    if text is None:
        return None

    digits = re.sub(r"\D", "", text)

    return digits or None


# Convierte un valor a entero. Si no se puede, devuelve None o un default dado.
def parse_int(value: Any, default: int | None = None) -> int | None:

    digits = only_digits(value)

    if digits is None:
        return default

    try:
        return int(digits)
    except ValueError:
        return default


# Convierte un valor a decimal opcional.
# Si el valor viene vacío, devuelve None.
# Sirve para campos como number o floor, donde no queremos guardar 0 si el dato no existe.
def parse_optional_decimal(value: Any) -> float | None:

    text = clean_text(value)

    if text is None:
        return None

    return parse_decimal(text)


# Convierte un valor a decimal (float). Si no se puede, devuelve 0.0.
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


# Convierte fechas del TSV a formato ISO YYYY-MM-DD.
def parse_date(value: Any) -> str | None:

    text = clean_text(value)

    if text is None:
        return None

    parsed = pd.to_datetime(text, dayfirst=True, errors="coerce")

    if pd.isna(parsed):
        return None

    return parsed.date().isoformat()


# Convierte textos del TSV a booleano.
# Activo -> True
# Inactivo -> False
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


# Normaliza nombres simples, eliminando espacios extra y capitalizando cada palabra.
def normalize_name(value: Any) -> str | None:

    text = clean_text(value)

    if text is None:
        return None

    return " ".join(text.split()).title()


# ============================================================
# REGLAS DE INFERENCIA
# ============================================================

# Estas funciones infieren valores a partir de otros campos, para completar los payloads.
def infer_document_type_id(document_number: str | None) -> int:

    if not document_number:
        return DOCUMENT_TYPE_UNKNOWN_ID

    return DOCUMENT_TYPE_CUIT_ID


# Para este primer MVP, inferimos el tipo de persona a partir del prefijo de su CUIT/CUIL.
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


# Inferimos el estado de la deuda a partir de su fecha de vencimiento.
# Si la fecha de vencimiento es anterior a hoy, se marca como vencida.
def infer_debt_status_id(due_date: str | None) -> int:

    if not due_date:
        return DEBT_STATUS_UNKNOWN_ID

    parsed = pd.to_datetime(due_date, errors="coerce")

    if pd.isna(parsed):
        return DEBT_STATUS_UNKNOWN_ID

    if parsed.date() < date.today():
        return DEBT_STATUS_OVERDUE_ID

    return DEBT_STATUS_ACTIVE_ID


# Convierte el Tipo_Ingreso_Id del archivo origen a una clave textual para debt.type.
# Para el MVP usamos strings en debt.type, no FK numérica.
# Convierte el Tipo_Ingreso_Id del archivo origen a una clave textual para debt.type.
# Para el MVP usamos strings en debt.type, no FK numérica.
def infer_debt_type_key(tipo_ingreso_id: Any) -> str:
    tipo_id = parse_int(tipo_ingreso_id)

    debt_type_by_origin_id = {
        # Inmuebles
        1: "inmuebles",

        # Rodados
        100: "vehicle_tax",
        101: "vehicle_deregistration",
        102: "vehicle_clearance",
        109: "vehicle_registration",

        # Agua
        800: "water_service",
        801: "water_connection",
        802: "water_connection_70m",
    }

    if tipo_id is None:
        return "unknown"

    return debt_type_by_origin_id.get(tipo_id, f"unknown_{tipo_id}")


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
        "type": parse_int(row.get("Bien_Tipo_Id")),
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
        "type": infer_debt_type_key(row.get("Tipo_Ingreso_Id")),
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


def build_province_payload(row: dict[str, Any]) -> dict[str, Any] | None:
    """
    Construye payload para province.
    """

    province_name = normalize_name(row.get("Destinatario_Provincia"))

    if not province_name:
        return None

    return {
        "name": province_name,
        "active": True,
    }


def build_city_payload(
    row: dict[str, Any],
    province_id: int,
) -> dict[str, Any] | None:
    """
    Construye payload para city.
    """

    city_name = normalize_name(row.get("Destinatario_Localidad"))

    if not city_name:
        return None

    return {
        "province": province_id,
        "name": city_name,
        "postal_code": clean_text(row.get("Destinatario_CP")),
        "active": True,
    }


def build_address_payload(
    row: dict[str, Any],
    person_id: int,
    city_id: int,
) -> dict[str, Any] | None:
    """
    Construye payload para address.
    """

    street = clean_text(row.get("Destinatario_Calle"))
    number = parse_optional_decimal(row.get("Destinatario_Numeracion"))
    floor = parse_optional_decimal(row.get("Destinatario_Piso"))
    apartment = clean_text(row.get("Destinatario_Depto"))

    if not street and number is None and not apartment:
        return None

    return {
        "person": person_id,
        "city": city_id,
        "street": street,
        "number": number,
        "neighborhood": None,
        "floor": floor,
        "apartment": apartment,
        "tower": None,
        "building_name": None,
        "lot": None,
        "block": None,
        "reference": None,
        "coordinates": None,
        "active": True,
    }


def build_debtor_contact_payloads(
    row: dict[str, Any],
    person_id: int,
) -> list[dict[str, Any]]:
    """
    Construye payloads para debtor_contact.

    Una misma persona puede tener:
    - teléfono
    - celular
    - email
    """

    payloads: list[dict[str, Any]] = []

    phone = clean_text(row.get("Destinatario_Telefono"))
    mobile = clean_text(row.get("Destinatario_Celular"))
    email = clean_text(row.get("Destinatario_Email"))

    if phone:
        payloads.append(
            {
                "person": person_id,
                "type": CONTACT_TYPE_PHONE_ID,
                "value": phone,
                "active": True,
            }
        )

    if mobile:
        payloads.append(
            {
                "person": person_id,
                "type": CONTACT_TYPE_MOBILE_ID,
                "value": mobile,
                "active": True,
            }
        )

    if email:
        payloads.append(
            {
                "person": person_id,
                "type": CONTACT_TYPE_EMAIL_ID,
                "value": email.lower(),
                "active": True,
            }
        )

    return payloads


# ============================================================
# BUILDERS PARA PERFIL CALCULADO
# ============================================================

# Calcula los días de antigüedad de una deuda a partir de su fecha de vencimiento.
def calculate_debt_age_days(due_date: Any) -> int:
    parsed_due_date = parse_date(due_date)

    if parsed_due_date is None:
        return 0

    parsed = pd.to_datetime(parsed_due_date, errors="coerce")

    if pd.isna(parsed):
        return 0

    return max((date.today() - parsed.date()).days, 0)


# Limita un puntaje de riesgo para que quede dentro del rango 0 a 100.
# Lo usamos para que todos los scores sean interpretables como porcentaje.
def clamp_risk_score(value: float, minimum: int = 0, maximum: int = 100) -> int:
    return int(max(minimum, min(round(value), maximum)))


# Calcula el riesgo general del objeto de deuda en escala 0 a 100%.
# Esta versión usa una regla relativa al promedio de deuda de la cartera importada.
# La idea es obtener una escala más precisa que 1 a 5 y poder ordenar mejor los casos.
def calculate_socioeconomic_risk_level(
    total_debt_amount: float,
    overdue_debt_amount: float,
    overdue_debt_count: int,
    oldest_debt_days: int,
    active_person_count: int,
    available_contact_count: int,
    average_total_debt_amount: float,
) -> int:

    if total_debt_amount <= 0:
        return 0

    if average_total_debt_amount <= 0:
        average_total_debt_amount = total_debt_amount

    debt_ratio = total_debt_amount / average_total_debt_amount

    # Componente principal: peso relativo de la deuda frente al promedio de la cartera.
    # Tiene un máximo de 60 puntos sobre 100.
    debt_amount_score = min(debt_ratio * 35, 60)

    # Proporción de deuda vencida sobre deuda total.
    # Tiene un máximo de 10 puntos.
    overdue_amount_ratio = (
        overdue_debt_amount / total_debt_amount
        if total_debt_amount > 0
        else 0
    )
    overdue_amount_score = min(overdue_amount_ratio * 10, 10)

    # Cantidad de deudas vencidas.
    # Tiene un máximo de 10 puntos.
    overdue_count_score = min(overdue_debt_count, 10)

    # Antigüedad de la deuda más vieja.
    # A partir de un año o más, aporta el máximo de 15 puntos.
    age_score = min((oldest_debt_days / 365) * 15, 15)

    # Disponibilidad de contacto.
    # Sin contactos sube bastante el riesgo operativo.
    # Con un solo contacto sube levemente porque hay menor redundancia.
    if available_contact_count == 0:
        contact_score = 15
    elif available_contact_count == 1:
        contact_score = 5
    else:
        contact_score = 0

    # Multiplicidad de personas asociadas al objeto.
    # Suma un ajuste pequeño porque puede requerir gestión más compleja.
    multi_person_score = 5 if active_person_count > 1 else 0

    total_score = (
        debt_amount_score
        + overdue_amount_score
        + overdue_count_score
        + age_score
        + contact_score
        + multi_person_score
    )

    return clamp_risk_score(total_score)


# Construye payload para debtor_profile a partir de las deudas, personas y contactos asociados a un debtor.
def build_debtor_profile_payload(
    debtor_id: int,
    debt_rows: list[dict[str, Any]],
    active_person_count: int,
    available_contact_count: int,
    average_total_debt_amount: float,
) -> dict[str, Any]:
    current_amounts = [parse_decimal(row.get("current_amount")) for row in debt_rows]
    original_amounts = [parse_decimal(row.get("original_amount")) for row in debt_rows]

    total_debt_amount = round(sum(current_amounts), 2)
    original_debt_amount = round(sum(original_amounts), 2)

    overdue_rows = [
        row for row in debt_rows
        if parse_int(row.get("status")) == DEBT_STATUS_OVERDUE_ID
    ]

    overdue_amounts = [parse_decimal(row.get("current_amount")) for row in overdue_rows]
    overdue_debt_amount = round(sum(overdue_amounts), 2)

    debt_ages = [calculate_debt_age_days(row.get("due_date")) for row in debt_rows]
    debt_count = len(debt_rows)
    overdue_debt_count = len(overdue_rows)

    oldest_debt_days = max(debt_ages) if debt_ages else 0
    average_debt_age_days = int(round(sum(debt_ages) / len(debt_ages))) if debt_ages else 0

    risk_level = calculate_socioeconomic_risk_level(
        total_debt_amount=total_debt_amount,
        overdue_debt_amount=overdue_debt_amount,
        overdue_debt_count=overdue_debt_count,
        oldest_debt_days=oldest_debt_days,
        active_person_count=active_person_count,
        available_contact_count=available_contact_count,
        average_total_debt_amount=average_total_debt_amount,
    )

    return {
        "debtor": debtor_id,
        "total_debt_amount": total_debt_amount,
        "overdue_debt_amount": overdue_debt_amount,
        "debt_count": debt_count,
        "overdue_debt_count": overdue_debt_count,
        "oldest_debt_days": oldest_debt_days,
        "average_debt_age_days": average_debt_age_days,
        "active_person_count": active_person_count,
        "available_contact_count": available_contact_count,
        "socioeconomic_risk_level": risk_level,
        "profile_generated_at": datetime.now(timezone.utc).isoformat(),
        "active": True,
    }


# Construye la razón textual para el riesgo de una persona dentro del perfil del objeto.
# Explica el riesgo base del objeto, el ajuste individual y el riesgo final en porcentaje.
def build_profile_detail_reason(
    profile_risk_level: int,
    final_risk_value: float,
    person_contact_count: int,
    role: str | None,
    priority: float | None,
) -> str:
    reasons: list[str] = []

    base_risk = round(float(profile_risk_level), 2)
    final_risk = round(float(final_risk_value), 2)
    adjustment = round(final_risk - base_risk, 2)

    reasons.append(f"Riesgo base del objeto: {base_risk}%.")
    reasons.append(f"Riesgo individual final: {final_risk}%.")

    if adjustment > 0:
        reasons.append(f"El riesgo individual se elevó {adjustment} punto(s) por condiciones particulares de la persona.")
    elif adjustment < 0:
        reasons.append(f"El riesgo individual se redujo {abs(adjustment)} punto(s) por condiciones particulares de la persona.")

    if person_contact_count == 0:
        reasons.append("La persona no tiene contactos disponibles.")
    elif person_contact_count == 1:
        reasons.append("La persona tiene 1 contacto disponible.")
    else:
        reasons.append(f"La persona tiene {person_contact_count} contactos disponibles.")

    if role:
        reasons.append(f"Rol frente al objeto: {role}.")

    if priority is not None:
        reasons.append(f"Porcentaje/prioridad declarada: {priority}.")

    return " ".join(reasons)


# Construye payload para debtor_profile_detail por cada persona asociada al objeto.
# risk_value representa el riesgo individual de esa persona dentro del objeto, en escala 0 a 100%.
def build_debtor_profile_detail_payload(
    debtor_profile_id: int,
    person_id: int,
    profile_risk_level: int,
    person_contact_count: int,
    role: str | None = None,
    priority: float | None = None,
) -> dict[str, Any]:
    risk_value = float(profile_risk_level)

    # Ajuste por contacto individual.
    # Si la persona no tiene contactos, se eleva el riesgo operativo.
    # Si tiene un solo contacto, se suma un ajuste menor.
    if person_contact_count == 0:
        risk_value += 15
    elif person_contact_count == 1:
        risk_value += 3

    # Ajuste leve por rol: si figura como responsable de pago, puede ser
    # más relevante para la gestión operativa del caso.
    normalized_role = role.lower() if role else ""

    if "responsable" in normalized_role:
        risk_value += 5

    # Ajuste leve por prioridad/porcentaje de responsabilidad.
    # Un porcentaje alto indica mayor peso de esa persona frente al objeto.
    if priority is not None and priority >= 75:
        risk_value += 5

    risk_value = round(max(0, min(risk_value, 100)), 2)

    reason = build_profile_detail_reason(
        profile_risk_level=profile_risk_level,
        final_risk_value=risk_value,
        person_contact_count=person_contact_count,
        role=role,
        priority=priority,
    )

    return {
        "debtor_profile": debtor_profile_id,
        "person": person_id,
        "risk_value": risk_value,
        "reason": reason,
        "active": True,
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


# Estas funciones toman la fecha de actualización de la cabecera para usarla como issue_date y last_collection_date de las deudas.
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
    debtors_by_key: set[tuple[int, int]] = set()
    debtor_person_relations: set[tuple[int, int, int]] = set()

    for row in dataframe_to_records(cabecera_df):
        debtor_type_id = parse_int(row.get("Bien_Tipo_Id"))
        person_external_id = parse_int(row.get("Destinatario_Id"))
        debtor_external_id = parse_int(row.get("Cuenta"))

        if person_external_id is not None:
            persons_by_external_id.add(person_external_id)

        if debtor_type_id is not None and debtor_external_id is not None:
            debtors_by_key.add((debtor_type_id, debtor_external_id))

        if (
            debtor_type_id is not None
            and debtor_external_id is not None
            and person_external_id is not None
        ):
            debtor_person_relations.add(
                (debtor_type_id, debtor_external_id, person_external_id)
            )

    unique_debt_keys: set[tuple[int, int, int]] = set()
    duplicated_debt_rows_count = 0

    for row in dataframe_to_records(detalle_df):
        debtor_type_id = parse_int(row.get("Bien_Tipo_Id"))
        debtor_external_id = parse_int(row.get("Cuenta"))
        debt_external_id = parse_int(row.get("DEUD_id"))

        if debtor_type_id is None or debtor_external_id is None or debt_external_id is None:
            continue

        # Clave correcta para no duplicar deudas:
        # una deuda se carga una sola vez por Bien_Tipo_Id + Cuenta + DEUD_id.
        debt_key = (debtor_type_id, debtor_external_id, debt_external_id)

        if debt_key in unique_debt_keys:
            duplicated_debt_rows_count += 1
        else:
            unique_debt_keys.add(debt_key)

    return TransformSummary(
        persons_count=len(persons_by_external_id),
        debtors_count=len(debtors_by_key),
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
    print(f"Deudas únicas por Bien_Tipo + Cuenta + DEUD_id: {summary.unique_debts_count}")
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
