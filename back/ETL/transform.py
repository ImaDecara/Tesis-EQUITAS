import hashlib
import json
import re
from collections import Counter
from collections.abc import Hashable, Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal
from functools import lru_cache
from pathlib import Path
from typing import Any

import pandas as pd

from ETL.config import ETLError, settings
from ETL.extract import canonical_records, extract_from_input_folder, read_source_tables
from ETL.validate_source import parse_amount as parse_source_amount
from ETL.validate_source import parse_date as parse_source_date
from ETL.validate_source import load_contract, validate_batch

# ============================================================
# CATÁLOGOS: SIEMPRE POR CLAVE
# ============================================================

# Los payloads llevan la clave del catálogo; with_catalog_ids la cambia por el id de la base justo antes de escribir.
# Ningún id de catálogo está fijo en el código y ningún código de origen se usa como id (contrato de origen §3.1).
CATALOG_KEY_COLUMNS = {
    "document_type": "key",
    "person_type": "key",
    "person_status": "key",
    "debt_status": "key",
    "contact_type": "key",
    "debtor_type": "key",
    "currency": "code",
}
CATALOG_FIELDS = {
    "person": {"document_type": "document_type", "type": "person_type", "status": "person_status"},
    "debtor": {"type": "debtor_type"},
    "debt": {"currency": "currency", "status": "debt_status"},
    "debtor_contact": {"type": "contact_type"},
}
DOCUMENT_TYPE_CUIT = "CUIT"
DOCUMENT_TYPE_UNKNOWN = "UNKNOWN"
PERSON_TYPE_INDIVIDUAL = "INDIVIDUAL"
PERSON_TYPE_LEGAL_PERSON = "LEGAL_PERSON"
PERSON_TYPE_UNKNOWN = "UNKNOWN"
# El origen no informa el estado de la persona (PE07): no se afirma que esté activa.
PERSON_STATUS_NOT_INFORMED = "UNKNOWN"
CONTACT_TYPE_PHONE = "PHONE"
CONTACT_TYPE_MOBILE = "MOBILE"
CONTACT_TYPE_EMAIL = "EMAIL"
DEBT_STATUS_OVERDUE = "OVERDUE"
DEBT_STATUS_ACTIVE = "ACTIVE"
ORIGIN_STATE_PENDING = "PENDIENTE"
ORIGIN_STATE_UNKNOWN = "UNKNOWN"

# Formato del puente canónico (ETL.extract.canonical_records): decimal con punto, sin miles, fecha D/M/A.
CANONICAL_DATE_FORMAT = "dd/mm/aaaa"
CANONICAL_ID = re.compile(r"0|[1-9][0-9]{0,18}")
BIGINT_MAX = 9223372036854775807
ADDRESS_NUMBER = re.compile(r"[0-9]{1,9}")
CUIT_PREFIXES_INDIVIDUAL = {"20", "23", "24", "27"}
CUIT_PREFIXES_LEGAL = {"30", "33", "34"}
CUIT_WEIGHTS = (5, 4, 3, 2, 7, 6, 5, 4, 3, 2)
# El contrato v1 no declara una columna de período fiscal; si ALIGN-046 la homologa, llega con este nombre.
SOURCE_PERIOD_COLUMN = "Periodo_Fiscal"
UNUSABLE_CONTACT_CODES = {"CONTACTO_PLACEHOLDER", "CONTACTO_FORMATO_INVALIDO"}
INACTIVE_CONTACT_CODE = "CONTACTO_INACTIVO"
CONTACT_COLUMNS = (
    ("Destinatario_Telefono", CONTACT_TYPE_PHONE),
    ("Destinatario_Celular", CONTACT_TYPE_MOBILE),
    ("Destinatario_Email", CONTACT_TYPE_EMAIL),
)


class SemanticRejection(ValueError):
    """Valor que no se puede publicar. Solo lleva el código del contrato, nunca el valor."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


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

@lru_cache(maxsize=1)
def source_contract() -> dict:
    return load_contract()


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


# Identificador leído como texto: solo el decimal canónico de un bigint no negativo.
# No quita ceros ni caracteres: "000123" y "R-0456" no son 123 ni 456 (la base conserva bigint, ALIGN-017).
def parse_int(value: Any, default: int | None = None) -> int | None:

    text = clean_text(value)

    if text is None or not CANONICAL_ID.fullmatch(text) or int(text) > BIGINT_MAX:
        return default

    return int(text)


def _amount_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


# Importe exacto. Vacío o inválido se rechaza con su código; el cero válido se conserva.
# Rechaza fracciones de centavo: el motor de reglas v1 nunca recibe un importe que haya que redondear.
def parse_decimal(value: Any, *, decimal: str = ".", thousands: str = "") -> Decimal:

    cell = parse_source_amount(_amount_text(value), decimal, thousands)

    if cell.value is None:
        raise SemanticRejection(str(cell.code))

    return cell.value


# Igual que parse_decimal, pero el vacío significa no informado (None), nunca 0.
def parse_optional_decimal(value: Any, *, decimal: str = ".", thousands: str = "") -> Decimal | None:

    if not _amount_text(value):
        return None

    return parse_decimal(value, decimal=decimal, thousands=thousands)


# Texto exacto para numeric: PostgREST lo convierte sin pasar por float.
def money_text(value: Decimal) -> str:
    return format(value.quantize(Decimal("0.01")), "f")


def plain_number_text(value: Decimal) -> str:
    return format(value, "f")


# Fecha del puente canónico a ISO. Vacía o centinela: None. Otra cosa se rechaza con su código.
def parse_date(value: Any, date_format: str = CANONICAL_DATE_FORMAT) -> str | None:

    text = "" if value is None else str(value).strip()
    cell = parse_source_date(text, date_format, source_contract())

    if cell.value is not None:
        return cell.value.isoformat()

    if cell.code in {"FECHA_VACIA", "FECHA_CENTINELA"}:
        return None

    raise SemanticRejection(str(cell.code))


# Estado del objeto según el catálogo cerrado del contrato. Vacío no significa activo.
def parse_object_status(value: Any) -> bool | None:

    text = "" if value is None else str(value).strip()

    if not text:
        return None

    catalog = {key.casefold(): state for key, state in source_contract()["catalogos"]["Estado"].items()}
    state = catalog.get(text.casefold())

    if state is None:
        raise SemanticRejection("ESTADO_OBJETO_DESCONOCIDO")

    return state == "ACTIVO"


# Numeración o piso: columna numérica en la base. "S/N" o "PB" no son 0: quedan sin informar.
def parse_address_number(value: Any) -> int | None:

    text = clean_text(value)

    if text is None or not ADDRESS_NUMBER.fullmatch(text):
        return None

    return int(text)


# Normaliza nombres simples, eliminando espacios extra y capitalizando cada palabra.
def normalize_name(value: Any) -> str | None:

    text = clean_text(value)

    if text is None:
        return None

    return " ".join(text.split()).title()


# ============================================================
# REGLAS DE INFERENCIA
# ============================================================

def _document_digits(document_number: Any) -> str:
    return re.sub(r"\D", "", clean_text(document_number) or "")


def _has_cuit_structure(digits: str) -> bool:
    if len(digits) != 11 or digits[:2] not in CUIT_PREFIXES_INDIVIDUAL | CUIT_PREFIXES_LEGAL:
        return False

    remainder = sum(int(digit) * weight for digit, weight in zip(digits, CUIT_WEIGHTS, strict=False)) % 11
    check_digit = {0: 0, 1: 9}.get(remainder, 11 - remainder)

    return int(digits[10]) == check_digit


# La columna se llama Destinatario_CUIT, pero no todo lo que llega es un CUIT: solo se afirma si su estructura lo es.
def infer_document_type_key(document_number: str | None) -> str:
    return DOCUMENT_TYPE_CUIT if _has_cuit_structure(_document_digits(document_number)) else DOCUMENT_TYPE_UNKNOWN


# Para este primer MVP, inferimos el tipo de persona a partir del prefijo de su CUIT/CUIL (PE04).
def infer_person_type_key(document_number: str | None) -> str:

    prefix = _document_digits(document_number)[:2]

    if prefix in CUIT_PREFIXES_INDIVIDUAL:
        return PERSON_TYPE_INDIVIDUAL

    if prefix in CUIT_PREFIXES_LEGAL:
        return PERSON_TYPE_LEGAL_PERSON

    return PERSON_TYPE_UNKNOWN


# Estado semántico de la obligación según el catálogo del lote. Nunca se deduce del vencimiento.
def resolve_origin_state(row: dict[str, Any], state_catalogs: Mapping[str, Mapping[str, str]]) -> str:

    states: set[str] = set()

    for column in ("NOTD_ESTA_id", "NOTD_SITU_id"):
        code = clean_text(row.get(column))

        if code is None:
            continue

        state = state_catalogs.get(column, {}).get(code)

        if state is None:
            raise SemanticRejection("ESTADO_ORIGEN_DESCONOCIDO")

        if state != ORIGIN_STATE_UNKNOWN:
            states.add(state)

    if len(states) > 1:
        raise SemanticRejection("ESTADOS_ORIGEN_CONFLICTIVOS")

    return states.pop() if states else ORIGIN_STATE_UNKNOWN


# Clave de debt_status. "Vencida" es un derivado de una obligación pendiente respecto del corte declarado.
def debt_status_key(origin_state: str, due_date: str | None, cut_off: date) -> str:

    status_by_state = source_contract()["catalogos"]["debt_status_por_estado"]

    if origin_state != ORIGIN_STATE_PENDING:
        return status_by_state[origin_state]

    if due_date is None:
        raise SemanticRejection("FECHA_VACIA")

    overdue = date.fromisoformat(due_date) < cut_off

    return status_by_state["PENDIENTE_VENCIDA" if overdue else "PENDIENTE_VIGENTE"]


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

# Reemplaza las claves de catálogo por los ids de la base. Una clave sin id falla antes de escribir.
def with_catalog_ids(
    entity: str,
    payload: dict[str, Any],
    catalogs: Mapping[str, Mapping[str, int]],
) -> dict[str, Any]:

    resolved = dict(payload)

    for field, catalog in CATALOG_FIELDS[entity].items():
        identifier = catalogs.get(catalog, {}).get(payload[field])

        if identifier is None:
            raise ETLError("CATALOG_KEY_MISSING")

        resolved[field] = identifier

    return resolved


def build_person_payload(row: dict[str, Any]) -> dict[str, Any]:

    document_number = clean_text(row.get("Destinatario_CUIT"))

    return {
        "external_id": parse_int(row.get("Destinatario_Id")),
        "document_type": infer_document_type_key(document_number),
        "document_number": document_number,
        "full_name": clean_text(row.get("Destinatario")),
        "type": infer_person_type_key(document_number),
        "birth_date": None,
        "status": PERSON_STATUS_NOT_INFORMED,
    }


# debtor_type_keys es el mapa Bien_Tipo_Id → debtor_type.key que declara el perfil del lote.
def build_debtor_payload(row: dict[str, Any], debtor_type_keys: Mapping[str, str]) -> dict[str, Any]:

    code = clean_text(row.get("Bien_Tipo_Id"))

    if code not in debtor_type_keys:
        raise SemanticRejection("TIPO_BIEN_FUERA_DE_CATALOGO")

    return {
        "tenant": settings.tenant_id,
        "external_id": parse_int(row.get("Cuenta")),
        "type": debtor_type_keys[code],
        "identifier": clean_text(row.get("Identificador")),
        "description": clean_text(row.get("Bien_Descripcion")),
        "status": parse_object_status(row.get("Estado")),
    }


def build_debtor_person_payload(
    row: dict[str, Any],
    debtor_id: int,
    person_id: int,
) -> dict[str, Any]:

    declared = parse_optional_decimal(row.get("Destinatario_Porcentaje"))

    return {
        "debtor": debtor_id,
        "person": person_id,
        "priority": None if declared is None else plain_number_text(declared),
        "role": clean_text(row.get("Destinatario_Tipo")),
        "active": True,
    }


def build_debt_payload(
    row: dict[str, Any],
    debtor_id: int,
    *,
    cut_off: date,
    state_catalogs: Mapping[str, Mapping[str, str]],
    currency_code: str,
) -> dict[str, Any]:

    debt_external_id = parse_int(row.get("DEUD_id"))

    if debt_external_id is None:
        raise SemanticRejection("IDENTIFICADOR_INVALIDO")

    due_date = parse_date(row.get("NOTD_vencimiento"))
    origin_state = resolve_origin_state(row, state_catalogs)

    return {
        "external_id": debt_external_id,
        "debtor": debtor_id,
        "type": infer_debt_type_key(row.get("Tipo_Ingreso_Id")),
        "description": f"Deuda importada desde TSV - DEUD_id {debt_external_id}",
        "original_amount": money_text(parse_decimal(row.get("NOTD_capital"))),
        "current_amount": money_text(parse_decimal(row.get("NOTD_totalActualizado"))),
        "currency": currency_code,
        # Sin fuente real de emisión ni de gestión. Fecha_Actualizacion va a import_batch.source_updated_at.
        "issue_date": None,
        "due_date": due_date,
        "last_collection_date": None,
        # Solo un período de origen; nunca el identificador de la obligación.
        "period": clean_text(row.get(SOURCE_PERIOD_COLUMN)),
        "status": debt_status_key(origin_state, due_date, cut_off),
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
    number = parse_address_number(row.get("Destinatario_Numeracion"))
    floor = parse_address_number(row.get("Destinatario_Piso"))
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
    findings: Mapping[str, str] | None = None,
) -> list[dict[str, Any]]:
    """
    Construye payloads para debtor_contact.

    Una misma persona puede tener teléfono, celular y email. `findings` son los hallazgos del validador
    para esta fila, por columna: un marcador o un formato ilegible no es un contacto y no se carga;
    una baja explícita se conserva con active=False.
    """

    payloads: list[dict[str, Any]] = []
    findings = findings or {}

    for column, contact_type in CONTACT_COLUMNS:
        value = clean_text(row.get(column))
        finding = findings.get(column)

        if value is None or finding in UNUSABLE_CONTACT_CODES:
            continue

        payloads.append(
            {
                "person": person_id,
                "type": contact_type,
                "value": value.lower() if contact_type == CONTACT_TYPE_EMAIL else value,
                "active": finding != INACTIVE_CONTACT_CODE,
            }
        )

    return payloads


# ============================================================
# BUILDERS PARA PERFIL CALCULADO
# ============================================================

def _rounded_average(values: list[int]) -> int:
    return int((Decimal(sum(values)) / len(values)).quantize(Decimal(1), rounding=ROUND_HALF_UP))


# Perfil del objeto: agregados de sus obligaciones respecto del corte. debt_rows lleva claves de catálogo.
# Antigüedad: días de atraso de las obligaciones vencidas al corte; sin vencidas no aplica (None), nunca 0.
# El índice heredado no se calcula: dependía del promedio del lote y la severidad la calcula reglas v1 (ALIGN-008).
def build_debtor_profile_payload(
    debtor_id: int,
    debt_rows: list[dict[str, Any]],
    active_person_count: int,
    available_contact_count: int,
    cut_off: date | None,
) -> dict[str, Any]:

    overdue_rows = [row for row in debt_rows if row["status"] == DEBT_STATUS_OVERDUE]
    days_overdue = [(cut_off - date.fromisoformat(row["due_date"])).days for row in overdue_rows] if cut_off else []
    total = sum((Decimal(str(row["current_amount"])) for row in debt_rows), Decimal(0))
    overdue = sum((Decimal(str(row["current_amount"])) for row in overdue_rows), Decimal(0))

    return {
        "debtor": debtor_id,
        "total_debt_amount": money_text(total),
        "overdue_debt_amount": money_text(overdue),
        "debt_count": len(debt_rows),
        "overdue_debt_count": len(overdue_rows),
        "oldest_debt_days": max(days_overdue) if days_overdue else None,
        "average_debt_age_days": _rounded_average(days_overdue) if days_overdue else None,
        "active_person_count": active_person_count,
        "available_contact_count": available_contact_count,
        "socioeconomic_risk_level": None,
        "profile_generated_at": datetime.now(UTC).isoformat(),
        "active": True,
    }


# ============================================================
# LOTE VALIDADO: LO ÚNICO QUE SE PUEDE PUBLICAR
# ============================================================

@dataclass(frozen=True)
class SourceRowContext:
    """Fila canónica aceptada, con los hallazgos de sus contactos por columna."""

    values: dict[str, Any]
    line: int
    contact_findings: dict[str, str]


@dataclass(frozen=True)
class PreparedObject:
    reference: str
    headers: tuple[SourceRowContext, ...]
    details: tuple[SourceRowContext, ...]


@dataclass(frozen=True)
class PreparedBatch:
    """Resultado de validar los archivos, antes de crear cualquier cliente de base."""

    report: dict[str, Any]
    mapping: dict[str, Any]
    cut_off: date
    file_hashes: dict[str, str]
    objects: tuple[PreparedObject, ...]
    source_updated_at: str | None

    @property
    def publishable(self) -> bool:
        return self.report["publicacion_permitida"] is True

    @property
    def state_catalogs(self) -> dict[str, dict[str, str]]:
        return {name: self.mapping["catalogos"][name] for name in ("NOTD_ESTA_id", "NOTD_SITU_id")}

    @property
    def debtor_type_keys(self) -> dict[str, str]:
        return self.mapping["catalogos"]["Bien_Tipo_Id"]


class StructuralRejection(Exception):
    """El archivo no se pudo leer como lote: no hay reporte, pero sí hashes para registrar el rechazo."""

    def __init__(self, code: str, file_hashes: dict[str, str]) -> None:
        self.code = code
        self.file_hashes = file_hashes
        super().__init__(code)


def canonical_json_hash(value: Any) -> str:
    text = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _sha256_of_files(files: Mapping[str, Path]) -> dict[str, str]:
    return {name: hashlib.sha256(Path(path).read_bytes()).hexdigest() for name, path in files.items()}


def _accepted_rows(tables: Mapping[str, Any], report: dict, mapping: dict, contract: dict, kind: str):
    """Une cada fila canónica con la decisión que tomó el motor para esa misma línea física."""
    decisions = {item["linea"]: item for item in report["decisiones_filas"] if item["archivo"] == kind}
    contact_findings: dict[int, dict[str, str]] = {}

    for finding in report["hallazgos"]:
        if finding["archivo"] == kind:
            contact_findings.setdefault(finding["linea"], {})[finding["campo"]] = finding["codigo"]

    table = tables[kind]

    for source, record in zip(table.rows, canonical_records(table, kind, mapping, contract), strict=True):
        decision = decisions.get(source.line)

        if decision and decision["resultado"] == "ACEPTADA":
            yield decision["objeto"], SourceRowContext(record, source.line, contact_findings.get(source.line, {}))


def _group_objects(tables, report, mapping, contract) -> tuple[PreparedObject, ...]:
    headers: dict[str, list[SourceRowContext]] = {}
    details: dict[str, list[SourceRowContext]] = {}

    for reference, row in _accepted_rows(tables, report, mapping, contract, "cabecera"):
        headers.setdefault(reference, []).append(row)

    for reference, row in _accepted_rows(tables, report, mapping, contract, "detalle"):
        details.setdefault(reference, []).append(row)

    return tuple(
        PreparedObject(reference, tuple(rows), tuple(details.get(reference, ())))
        for reference, rows in headers.items()
    )


def _latest_source_update(objects: Iterable[PreparedObject]) -> str | None:
    dates = [
        parse_date(row.values.get("Fecha_Actualizacion"))
        for item in objects
        for row in item.headers
    ]
    return max((value for value in dates if value), default=None)


# Lee, valida y agrupa. No crea clientes ni escribe: lo que devuelve es todo lo que la carga puede usar.
def prepare_batch(files: Mapping[str, Path], mapping: dict, contract: dict, cut_off: str) -> PreparedBatch:

    hashes = {
        **_sha256_of_files(files),
        "mapeo": canonical_json_hash(mapping),
        "contrato": canonical_json_hash(contract),
    }

    try:
        tables = read_source_tables(dict(files), mapping, contract=contract)
    except ValueError as error:
        raise StructuralRejection(str(error).split(":", 1)[0], hashes) from None

    if _sha256_of_files(files) != {name: hashes[name] for name in files}:
        raise ETLError("SOURCE_CHANGED_DURING_READ")

    report = validate_batch(tables, mapping, contract, cut_off)
    objects = _group_objects(tables, report, mapping, contract)

    return PreparedBatch(
        report=report,
        mapping=mapping,
        cut_off=date.fromisoformat(cut_off),
        file_hashes=hashes,
        objects=objects,
        source_updated_at=_latest_source_update(objects),
    )


# Claves que la carga va a necesitar. Se resuelven todas antes de la primera escritura.
def required_catalog_keys(batch: PreparedBatch) -> dict[str, set[str]]:

    status_by_state = source_contract()["catalogos"]["debt_status_por_estado"]

    return {
        "document_type": {DOCUMENT_TYPE_CUIT, DOCUMENT_TYPE_UNKNOWN},
        "person_type": {PERSON_TYPE_INDIVIDUAL, PERSON_TYPE_LEGAL_PERSON, PERSON_TYPE_UNKNOWN},
        "person_status": {PERSON_STATUS_NOT_INFORMED},
        "debt_status": set(status_by_state.values()),
        "contact_type": {CONTACT_TYPE_PHONE, CONTACT_TYPE_MOBILE, CONTACT_TYPE_EMAIL},
        "debtor_type": {
            batch.debtor_type_keys[clean_text(row.values.get("Bien_Tipo_Id"))]
            for item in batch.objects
            for row in item.headers
        },
        "currency": {batch.mapping["moneda"]},
    }


def _lower_keys(values: Mapping[str, int]) -> dict[str, int]:
    return {code.lower(): count for code, count in values.items()}


def _centavos(value: str | None) -> int | None:
    return None if value is None else int(Decimal(value) * 100)


# Conteos para import_batch: solo enteros con claves propias, sin filas ni valores de origen. Un dato no calculado se omite.
def batch_counts(report: dict[str, Any]) -> dict[str, Any]:

    counts: dict[str, Any] = {name: value for name, value in report["conteos"].items() if value is not None}

    for kind, rows in report["filas"].items():
        counts[f"filas_{kind}_leidas"] = rows["leidas"]
        counts[f"filas_{kind}_aceptadas"] = rows["aceptadas"]
        counts[f"filas_{kind}_rechazadas"] = rows["rechazadas"]
        counts[f"rechazos_{kind}"] = _lower_keys(rows["rechazadas_por_codigo"])

    states: Counter[str] = Counter()

    for item in report["objetos"]:
        states.update(item["estados_al_corte"])

    counts["estados_al_corte"] = {name.lower(): count for name, count in states.items() if count}
    counts["hallazgos"] = _lower_keys(report["hallazgos_por_codigo"])
    counts["bloqueos"] = _lower_keys(dict.fromkeys(report["motivos_bloqueo"], 1))

    for name, source in (("importe_aceptado_centavos", "actualizado_aceptado"),
                         ("importe_en_cuarentena_centavos", "actualizado_en_cuarentena_observado")):
        cents = _centavos(report["importes"][source])

        if cents is not None:
            counts[name] = cents

    return counts


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


if __name__ == "__main__":
    source_data = extract_from_input_folder("inmuebles")

    print_transform_summary(
        cabecera_df=source_data.cabecera_df,
        detalle_df=source_data.detalle_df,
    )
