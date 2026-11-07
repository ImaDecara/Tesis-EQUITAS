import re
import time
import uuid
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable, Mapping
from contextvars import ContextVar, Token
from datetime import date
from decimal import Decimal, InvalidOperation
from hashlib import blake2b
from secrets import token_bytes
from typing import Any, TypeVar, cast

import httpx

from ETL.config import ETLError, get_import_credentials, get_settings, supabase

# La sal es efímera: las claves solo se correlacionan dentro del mismo proceso.
_LOG_HASH_KEY = token_bytes(32)


def hash_key(key: Any) -> str:
    return blake2b(repr(key).encode("utf-8"), key=_LOG_HASH_KEY, digest_size=12).hexdigest()


_LOG_CONTEXT: ContextVar[tuple[int, str]] = ContextVar("etl_log_context", default=(0, hash_key(None)))


def set_log_context(row_number: int, key: Any) -> Token:
    return _LOG_CONTEXT.set((row_number, hash_key(key)))


def reset_log_context(token: Token) -> None:
    _LOG_CONTEXT.reset(token)


def etl_message(code: str, *, key: Any = None) -> str:
    row_number, key_hash = _LOG_CONTEXT.get()
    if key is not None:
        key_hash = hash_key(key)
    return f"fila={row_number} clave_hash={key_hash} codigo={code}"

# ============================================================
# NOMBRES DE TABLAS
# ============================================================

#Etapa 1
PERSON_TABLE = "person"
DEBTOR_TABLE = "debtor"
DEBTOR_PERSON_TABLE = "debtor_person"
DEBT_TABLE = "debt"


#Etapa 2
PROVINCE_TABLE = "province"
CITY_TABLE = "city"
ADDRESS_TABLE = "address"
DEBTOR_CONTACT_TABLE = "debtor_contact"
DEBTOR_PROFILE_TABLE = "debtor_profile"
DEBTOR_PROFILE_DETAIL_TABLE = "debtor_profile_detail"

TRANSIENT_SUPABASE_ERRORS = (
    httpx.RemoteProtocolError,
    httpx.ReadTimeout,
    httpx.ConnectTimeout,
    httpx.ConnectError,
)
MAX_SUPABASE_ATTEMPTS = 5
SUPABASE_RETRY_DELAYS_SECONDS = (1, 2, 4, 8)
DEFAULT_BULK_BATCH_SIZE = 500
READ_PAGE_SIZE = 1000
READ_IDS_PER_REQUEST = 200
PROFILE_RECOMPUTE_FUNCTION = "recompute_debtor_profiles"
PROFILE_RECOMPUTE_OBJECTS_PER_CALL = 500
PROFILE_DETAILS_UPDATED = "detalles_actualizados"
PROFILE_DEBTS_RECLASSIFIED = "deudas_reclasificadas"

# Qué le pasó a cada fila en una carga. Una recarga idéntica tiene que dar solo "sin_cambios".
WRITE_INSERTED = "insertadas"
WRITE_UPDATED = "actualizadas"
WRITE_UNCHANGED = "sin_cambios"
WRITE_OUTCOMES = (WRITE_INSERTED, WRITE_UPDATED, WRITE_UNCHANGED)
_WRITE_TALLY: ContextVar[dict[str, Counter[str]] | None] = ContextVar("etl_write_tally", default=None)

# Cuándo se calculó el perfil no es parte de lo calculado: si nada más cambió, sigue valiendo el cálculo anterior.

DEBT_COMPARE_COLUMNS = (
    "external_id",
    "debtor",
    "type",
    "description",
    "original_amount",
    "current_amount",
    "currency",
    "issue_date",
    "due_date",
    "last_collection_date",
    "period",
    "status",
)
DEBT_NUMERIC_COLUMNS = {"original_amount", "current_amount"}
DEBT_INTEGER_COLUMNS = {"external_id", "debtor", "currency", "status"}

# Importes. Por la Data API llegan como número JSON y Python los vuelve float, que pierde centavos desde unos 100 billones:
# una corrección de un centavo pasaría por igual. Para comparar se leen como texto. El porcentaje no hace falta: el validador
# lo acota a 100 con dos decimales, y un float lo representa sin pérdida al volver a texto.
EXACT_NUMERIC_COLUMNS = {
    DEBT_TABLE: frozenset(DEBT_NUMERIC_COLUMNS),
}

IMPORT_BATCH_RPC_PATH = "/rest/v1/rpc/record_import_batch"
IMPORT_BATCH_TIMEOUT_SECONDS = 15
# Códigos estables de record_import_batch (SUPABASE_TESTING_CALIDAD.md). Cualquier otro texto no se propaga.
IMPORT_BATCH_STABLE_ERROR = re.compile(
    r"ROLE_NOT_ALLOWED|ACTOR_NOT_ACTIVE_MEMBER|IDEMPOTENCY_KEY_CONFLICT|SUPERSEDES_NOT_FOUND"
    r"|INVALID_IMPORT_BATCH:[a-z0-9_]{1,63}"
)

T = TypeVar("T")


class ImportBatchRejected(ETLError):
    """La base respondió que no registró el evento. A diferencia de una respuesta perdida o un 5xx, se sabe que no quedó."""


def start_write_tally() -> dict[str, Counter[str]]:
    tally: dict[str, Counter[str]] = defaultdict(Counter)
    _WRITE_TALLY.set(tally)
    return tally


def _count_writes(table_name: str, outcome: str, rows: int = 1) -> None:
    tally = _WRITE_TALLY.get()
    if tally is not None:
        tally[table_name][outcome] += rows


# Solo enteros y claves propias: se guarda tal cual en import_batch.counts.
def write_summary(tally: Mapping[str, Counter[str]]) -> dict[str, Any]:
    tables = {table: {outcome: counts[outcome] for outcome in WRITE_OUTCOMES} for table, counts in sorted(tally.items())}
    totals = {f"filas_{outcome}": sum(counts[outcome] for counts in tables.values()) for outcome in WRITE_OUTCOMES}
    return {**totals, "escrituras": tables}


# ============================================================
# FUNCIONES BASE DE SUPABASE
# ============================================================

def execute_supabase_operation(
    operation_name: str,
    operation: Callable[[], T],
    retry: bool = True,
) -> T:
    attempts = MAX_SUPABASE_ATTEMPTS if retry else 1
    for attempt in range(1, attempts + 1):
        try:
            return operation()
        except TRANSIENT_SUPABASE_ERRORS as error:
            if attempt == attempts:
                # Conservar el tipo transitorio permite el reintento del llamador.
                raise type(error)(etl_message("SUPABASE_RETRY_EXHAUSTED")) from None

            delay_seconds = SUPABASE_RETRY_DELAYS_SECONDS[attempt - 1]
            print(
                f"{etl_message('SUPABASE_RETRY')} "
                f"Reintento {attempt + 1}/{MAX_SUPABASE_ATTEMPTS} "
                f"en {delay_seconds}s."
            )
            time.sleep(delay_seconds)
        except ETLError:
            raise
        # Frontera de salida: no propagar mensajes arbitrarios del proveedor.
        except Exception:  # noqa: BLE001
            raise ETLError("SUPABASE_OPERATION_FAILED", etl_message("SUPABASE_OPERATION_FAILED")) from None

    raise ETLError("SUPABASE_OPERATION_FAILED", etl_message("SUPABASE_OPERATION_FAILED"))


# Valida que la respuesta de Supabase sea una lista con un diccionario
def get_first_response_row(
    data: Any,
    table_name: str,
    action: str,
) -> dict[str, Any]:

    if not isinstance(data, list) or len(data) == 0:
        raise ETLError("RESPONSE_EMPTY_OR_INVALID", etl_message("RESPONSE_EMPTY_OR_INVALID"))

    first_row = data[0]

    if not isinstance(first_row, dict):
        raise ETLError("RESPONSE_ROW_INVALID", etl_message("RESPONSE_ROW_INVALID"))

    return cast(dict[str, Any], first_row)

# Función para hacer fetch de un registro usando filtros, con manejo de errores.
def fetch_one(
    table_name: str,
    filters: dict[str, Any],
    columns: str = "*",
    retry_http: bool = True,
) -> dict[str, Any] | None:

    for value in filters.values():
        if value is None:
            raise ValueError(etl_message("FILTER_NULL", key=tuple(filters.values())))

    def select_operation() -> Any:
        query = supabase.table(table_name).select(columns)

        for column, value in filters.items():
            query = query.eq(column, value)

        return query.limit(1).execute()

    response = execute_supabase_operation(
        operation_name=f"select {table_name}",
        operation=select_operation,
        retry=retry_http,
    )

    if not response.data:
        return None

    return get_first_response_row(
    data=response.data,
    table_name=table_name,
    action="select",
)


# Función para insertar un registro, con manejo de errores.
def insert_row(
    table_name: str,
    payload: dict[str, Any],
    retry_http: bool = True,
) -> dict[str, Any]:

    response = execute_supabase_operation(
        operation_name=f"insert {table_name}",
        operation=lambda: supabase.table(table_name).insert(payload).execute(),
        retry=retry_http,
    )

    if not response.data:
        raise ETLError("INSERT_EMPTY_RESPONSE", etl_message("INSERT_EMPTY_RESPONSE"))

    return get_first_response_row(
    data=response.data,
    table_name=table_name,
    action="insert",
)


# Función para actualizar un registro por su id, con manejo de errores.
def update_row(
    table_name: str,
    row_id: int,
    payload: dict[str, Any],
    retry_http: bool = True,
) -> dict[str, Any]:

    response = execute_supabase_operation(
        operation_name=f"update {table_name}",
        operation=lambda: (
            supabase
            .table(table_name)
            .update(payload)
            .eq("id", row_id)
            .execute()
        ),
        retry=retry_http,
    )

    if not response.data:
        raise ETLError("UPDATE_EMPTY_RESPONSE", etl_message("UPDATE_EMPTY_RESPONSE"))

    return get_first_response_row(
    data=response.data,
    table_name=table_name,
    action="update",
)


def chunk_list(items: list[dict[str, Any]], batch_size: int) -> list[list[dict[str, Any]]]:
    return [
        items[start:start + batch_size]
        for start in range(0, len(items), batch_size)
    ]


def bulk_insert_rows(
    table_name: str,
    payloads: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not payloads:
        return []

    response = execute_supabase_operation(
        operation_name=f"bulk insert {table_name} ({len(payloads)} rows)",
        operation=lambda: supabase.table(table_name).insert(payloads).execute(),
    )

    if not response.data:
        raise ETLError("BULK_EMPTY_RESPONSE", etl_message("BULK_EMPTY_RESPONSE"))

    if not isinstance(response.data, list):
        raise ETLError("BULK_RESPONSE_INVALID", etl_message("BULK_RESPONSE_INVALID"))

    return cast(list[dict[str, Any]], response.data)


def normalize_debt_key(payload: dict[str, Any]) -> tuple[int, int]:
    debtor_id = payload.get("debtor")
    external_id = payload.get("external_id")

    if debtor_id is None:
        raise ValueError(etl_message("DEBT_DEBTOR_MISSING"))

    if external_id is None:
        raise ValueError(etl_message("DEBT_EXTERNAL_ID_MISSING"))

    try:
        return int(debtor_id), int(external_id)
    except (TypeError, ValueError):
        raise ValueError(etl_message("DEBT_KEY_INVALID", key=(debtor_id, external_id))) from None


def debt_values_are_equal(column: str, current_value: Any, next_value: Any) -> bool:
    if current_value is None or next_value is None:
        return current_value is None and next_value is None

    # Exacto y sin float: un centavo es un cambio y un nulo nunca equivale a 0.
    if column in DEBT_NUMERIC_COLUMNS:
        return Decimal(str(current_value)) == Decimal(str(next_value))

    if column in DEBT_INTEGER_COLUMNS:
        return int(current_value) == int(next_value)

    return current_value == next_value


def debt_payload_matches_existing(
    payload: dict[str, Any],
    existing_row: dict[str, Any],
) -> bool:
    return all(
        debt_values_are_equal(
            column=column,
            current_value=existing_row.get(column),
            next_value=payload.get(column),
        )
        for column in DEBT_COMPARE_COLUMNS
    )


def _exact_select(table_name: str, columns: Iterable[str]) -> str:
    exact = EXACT_NUMERIC_COLUMNS.get(table_name, frozenset())
    return ",".join(f"{column}::text" if column in exact else column for column in columns)


def fetch_existing_debts_by_key(
    payloads: list[dict[str, Any]],
) -> dict[tuple[int, int], dict[str, Any]]:
    if not payloads:
        return {}

    expected_keys = {normalize_debt_key(payload) for payload in payloads}
    debtor_ids = sorted({debtor_id for debtor_id, _ in expected_keys})
    select_columns = _exact_select(DEBT_TABLE, ("id", *DEBT_COMPARE_COLUMNS))
    rows_by_key: dict[tuple[int, int], dict[str, Any]] = {}

    # Todas las páginas: una fila existente que no se lee se insertaría de nuevo o se contaría como nueva.
    for row in _rows_for_ids(DEBT_TABLE, select_columns, "debtor", debtor_ids):
        if not isinstance(row, dict):
            continue

        row_key = normalize_debt_key(row)

        if row_key in expected_keys:
            rows_by_key[row_key] = cast(dict[str, Any], row)

    return rows_by_key


def _same_value(current: Any, wanted: Any, *, numeric: bool = False) -> bool:
    if current is None or wanted is None:
        return current is None and wanted is None

    if isinstance(current, bool) or isinstance(wanted, bool):
        return isinstance(current, bool) and isinstance(wanted, bool) and current == wanted

    if not numeric and isinstance(current, str) and isinstance(wanted, str):
        return current == wanted

    # Un número contra otro, o el texto exacto de una columna numérica, que puede tener otra escala. Un centavo es un cambio.
    try:
        return Decimal(str(current)) == Decimal(str(wanted))
    except InvalidOperation:
        return False


def _row_already_has(
    table_name: str,
    existing_row: Mapping[str, Any],
    payload: Mapping[str, Any],
    ignored_columns: Iterable[str],
) -> bool:
    ignored = set(ignored_columns)
    exact = EXACT_NUMERIC_COLUMNS.get(table_name, frozenset())
    return all(
        _same_value(existing_row.get(column), value, numeric=column in exact)
        for column, value in payload.items()
        if column not in ignored
    )


#1.Busca si ya existe un registro con lookup_filters.
#2. Si existe y ya tiene esos valores, no lo toca. Si difiere, actualiza.
#3. Si no existe, inserta.

def insert_or_update_by_filters(
    table_name: str,
    payload: dict[str, Any],
    lookup_filters: dict[str, Any],
    ignored_columns: Iterable[str] = (),
) -> dict[str, Any]:

    def insert_or_update_operation() -> tuple[dict[str, Any], str]:
        existing_row = fetch_one(
            table_name=table_name,
            filters=lookup_filters,
            columns=_exact_select(table_name, ("id", *payload)),
            retry_http=False,
        )

        if existing_row:
            row_id = existing_row.get("id")

            if row_id is None:
                raise ETLError("ROW_ID_MISSING", etl_message("ROW_ID_MISSING"))

            if _row_already_has(table_name, existing_row, payload, ignored_columns):
                return existing_row, WRITE_UNCHANGED

            updated_row = update_row(
                table_name=table_name,
                row_id=row_id,
                payload=payload,
                retry_http=False,
            )
            return updated_row, WRITE_UPDATED

        inserted_row = insert_row(
            table_name=table_name,
            payload=payload,
            retry_http=False,
        )
        return inserted_row, WRITE_INSERTED

    row, outcome = execute_supabase_operation(
        operation_name=f"insert/update {table_name}",
        operation=insert_or_update_operation,
    )
    _count_writes(table_name, outcome)
    return row


# ============================================================
# LOADERS ESPECÍFICOS DEL MODELO EQUITAS
# ============================================================

#Inserta o actualiza una persona.
def load_person(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Regla de deduplicación:
    person.external_id
    """

    external_id = payload.get("external_id")

    if external_id is None:
        raise ValueError(etl_message("PERSON_EXTERNAL_ID_MISSING"))

    return insert_or_update_by_filters(
        table_name=PERSON_TABLE,
        payload=payload,
        lookup_filters={
            "external_id": external_id,
        },
    )


#Inserta o actualiza un objeto de deuda.
def load_debtor(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Regla de deduplicación:
    debtor.tenant + debtor.type + debtor.external_id
    """

    tenant = payload.get("tenant")
    debtor_type = payload.get("type")
    external_id = payload.get("external_id")

    if tenant is None:
        raise ValueError(etl_message("DEBTOR_TENANT_MISSING"))

    if debtor_type is None:
        raise ValueError(etl_message("DEBTOR_TYPE_MISSING"))

    if external_id is None:
        raise ValueError(etl_message("DEBTOR_EXTERNAL_ID_MISSING"))

    return insert_or_update_by_filters(
        table_name=DEBTOR_TABLE,
        payload=payload,
        lookup_filters={
            "tenant": tenant,
            "type": debtor_type,
            "external_id": external_id,
        },
    )

#Inserta o actualiza la relación entre debtor y person.
def load_debtor_person(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Regla de deduplicación:
    debtor_person.debtor + debtor_person.person
    """

    debtor_id = payload.get("debtor")
    person_id = payload.get("person")

    if debtor_id is None:
        raise ValueError(etl_message("RELATION_DEBTOR_MISSING"))

    if person_id is None:
        raise ValueError(etl_message("RELATION_PERSON_MISSING"))

    return insert_or_update_by_filters(
        table_name=DEBTOR_PERSON_TABLE,
        payload=payload,
        lookup_filters={
            "debtor": debtor_id,
            "person": person_id,
        },
    )


# Inserta o actualiza una deuda individual.
def load_debt(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Regla de deduplicación:
    debt.debtor + debt.external_id

    Esto es importante porque DEUD_id puede repetirse cuando un objeto
    tiene varios titulares/personas asociadas.
    """

    debtor_id = payload.get("debtor")
    external_id = payload.get("external_id")

    if debtor_id is None:
        raise ValueError(etl_message("DEBT_DEBTOR_MISSING"))

    if external_id is None:
        raise ValueError(etl_message("DEBT_EXTERNAL_ID_MISSING"))

    return insert_or_update_by_filters(
        table_name=DEBT_TABLE,
        payload=payload,
        lookup_filters={
            "debtor": debtor_id,
            "external_id": external_id,
        },
    )


def load_debts_bulk(
    payloads: list[dict[str, Any]],
    batch_size: int = DEFAULT_BULK_BATCH_SIZE,
) -> dict[str, int]:
    """
    Carga deudas por lotes manteniendo la regla de deduplicaciÃ³n:
    debt.debtor + debt.external_id.

    Para evitar duplicados sin depender de cambios de esquema:
    1. busca existentes por lote;
    2. inserta nuevas en bulk;
    3. actualiza individualmente solo las existentes que cambiaron.
    """

    unique_payloads_by_key: dict[tuple[int, int], dict[str, Any]] = {}

    for payload in payloads:
        debt_key = normalize_debt_key(payload)
        unique_payloads_by_key[debt_key] = payload

    unique_payloads = list(unique_payloads_by_key.values())
    summary = {
        "received": len(payloads),
        "unique": len(unique_payloads),
        "inserted": 0,
        "updated": 0,
        "unchanged": 0,
    }

    if not unique_payloads:
        return summary

    batches = chunk_list(unique_payloads, batch_size)

    for batch_index, batch in enumerate(batches, start=1):
        existing_debts_by_key = fetch_existing_debts_by_key(batch)
        payloads_to_insert: list[dict[str, Any]] = []
        payloads_to_update: list[tuple[int, dict[str, Any]]] = []

        for payload in batch:
            debt_key = normalize_debt_key(payload)
            existing_row = existing_debts_by_key.get(debt_key)

            if existing_row is None:
                payloads_to_insert.append(payload)
                continue

            if debt_payload_matches_existing(payload, existing_row):
                summary["unchanged"] += 1
                continue

            row_id = existing_row.get("id")

            if row_id is None:
                raise ETLError("DEBT_ROW_ID_MISSING", etl_message("DEBT_ROW_ID_MISSING", key=debt_key))

            payloads_to_update.append((int(row_id), payload))

        if payloads_to_insert:
            bulk_insert_rows(
                table_name=DEBT_TABLE,
                payloads=payloads_to_insert,
            )
            summary["inserted"] += len(payloads_to_insert)

        for row_id, payload in payloads_to_update:
            update_row(
                table_name=DEBT_TABLE,
                row_id=row_id,
                payload=payload,
            )
            summary["updated"] += 1

        print(
            f"Batch debt {batch_index}/{len(batches)} | "
            f"insertadas: {summary['inserted']} | "
            f"actualizadas: {summary['updated']} | "
            f"sin cambios: {summary['unchanged']}"
        )

    _count_writes(DEBT_TABLE, WRITE_INSERTED, summary["inserted"])
    _count_writes(DEBT_TABLE, WRITE_UPDATED, summary["updated"])
    _count_writes(DEBT_TABLE, WRITE_UNCHANGED, summary["unchanged"])
    return summary

#Inserta o actualiza una provincia.
def load_province(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Inserta o actualiza una provincia.

    Regla de deduplicación:
    province.name
    """

    name = payload.get("name")

    if not name:
        raise ValueError(etl_message("PROVINCE_NAME_MISSING"))

    return insert_or_update_by_filters(
        table_name=PROVINCE_TABLE,
        payload=payload,
        lookup_filters={
            "name": name,
        },
    )

# Inserta o actualiza una ciudad.
def load_city(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Inserta o actualiza una ciudad.

    Regla de deduplicación:
    city.province + city.name + city.postal_code, si hay CP.
    Si no hay CP, usa city.province + city.name.
    """

    province = payload.get("province")
    name = payload.get("name")
    postal_code = payload.get("postal_code")

    if province is None:
        raise ValueError(etl_message("CITY_PROVINCE_MISSING"))

    if not name:
        raise ValueError(etl_message("CITY_NAME_MISSING"))

    lookup_filters = {
        "province": province,
        "name": name,
    }

    if postal_code:
        lookup_filters["postal_code"] = postal_code

    # Sin código postal se reutiliza la localidad que exista: borrarle el suyo obligaría a crearla de nuevo en cada recarga.
    return insert_or_update_by_filters(
        table_name=CITY_TABLE,
        payload=payload,
        lookup_filters=lookup_filters,
        ignored_columns=() if postal_code else ("postal_code",),
    )

# Inserta o actualiza una dirección.
def load_address(payload: dict[str, Any]) -> dict[str, Any]:
    
    person = payload.get("person")

    if person is None:
        raise ValueError(etl_message("ADDRESS_PERSON_MISSING"))

    return insert_or_update_by_filters(
        table_name=ADDRESS_TABLE,
        payload=payload,
        lookup_filters={
            "person": person,
        },
    )


# Inserta o actualiza un contacto de un deudor.
def load_debtor_contact(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Regla de deduplicación:
    debtor_contact.person + debtor_contact.type + debtor_contact.value
    """

    person = payload.get("person")
    contact_type = payload.get("type")
    value = payload.get("value")

    if person is None:
        raise ValueError(etl_message("CONTACT_PERSON_MISSING"))

    if contact_type is None:
        raise ValueError(etl_message("CONTACT_TYPE_MISSING"))

    if not value:
        raise ValueError(etl_message("CONTACT_VALUE_MISSING"))

    return insert_or_update_by_filters(
        table_name=DEBTOR_CONTACT_TABLE,
        payload=payload,
        lookup_filters={
            "person": person,
            "type": contact_type,
            "value": value,
        },
    )
# Inserta o actualiza el detalle de una persona dentro de un perfil.
def load_debtor_profile_detail(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Regla de deduplicación:
    debtor_profile_detail.debtor_profile + debtor_profile_detail.person
    """

    debtor_profile = payload.get("debtor_profile")
    person = payload.get("person")

    if debtor_profile is None:
        raise ValueError(etl_message("DETAIL_PROFILE_MISSING"))

    if person is None:
        raise ValueError(etl_message("DETAIL_PERSON_MISSING"))

    return insert_or_update_by_filters(
        table_name=DEBTOR_PROFILE_DETAIL_TABLE,
        payload=payload,
        lookup_filters={
            "debtor_profile": debtor_profile,
            "person": person,
        },
    )


# ============================================================
# FUNCIONES AUXILIARES PARA CATÁLOGOS
# ============================================================

# Función para obtener el id de un catálogo a partir de su key, con manejo de errores.
def get_catalog_id_by_key(
    table_name: str,
    key: str,
    key_column: str = "key",
) -> int:
    row = fetch_one(
        table_name=table_name,
        filters={key_column: key},
        columns=f"id,{key_column}",
    )

    if not row:
        raise ETLError("CATALOG_KEY_MISSING", etl_message("CATALOG_KEY_MISSING", key=key))

    row_id = row.get("id")

    if row_id is None:
        raise ETLError("CATALOG_ID_MISSING", etl_message("CATALOG_ID_MISSING", key=key))

    return int(row_id)


# Resuelve todas las claves que la carga necesita, antes de la primera escritura. Una clave ausente detiene la carga.
def resolve_catalogs(
    required: Mapping[str, Iterable[str]],
    key_columns: Mapping[str, str],
) -> dict[str, dict[str, int]]:
    return {
        table_name: {
            key: get_catalog_id_by_key(table_name, key, key_columns[table_name])
            for key in sorted(keys)
        }
        for table_name, keys in required.items()
    }


# ============================================================
# LECTURA DE LO YA PUBLICADO
# ============================================================

# Hasta la página vacía: la Data API corta en su máximo de filas sin avisar, y ese máximo puede ser menor que la página.
def fetch_all_rows(
    table_name: str,
    columns: str,
    filters: Mapping[str, Any] | None = None,
    in_filter: tuple[str, list[int]] | None = None,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []

    def select_page() -> Any:
        query = supabase.table(table_name).select(columns)

        for column, value in (filters or {}).items():
            query = query.eq(column, value)

        if in_filter is not None:
            query = query.in_(*in_filter)

        return query.order("id").range(len(rows), len(rows) + READ_PAGE_SIZE - 1).execute()

    while True:
        response = execute_supabase_operation(f"select {table_name}", select_page)

        if not response.data:
            return rows

        if not isinstance(response.data, list):
            raise ETLError("READ_RESPONSE_INVALID", etl_message("READ_RESPONSE_INVALID"))

        rows.extend(response.data)


def _rows_for_ids(table_name: str, columns: str, column: str, ids: Iterable[int]) -> list[dict[str, Any]]:
    unique_ids = sorted(set(ids))
    return [
        row
        for start in range(0, len(unique_ids), READ_IDS_PER_REQUEST)
        for row in fetch_all_rows(table_name, columns, in_filter=(column, unique_ids[start:start + READ_IDS_PER_REQUEST]))
    ]


# Objetos publicados del municipio, por (tipo, cuenta), con las obligaciones, personas y contactos que tienen hoy. Solo lee.
# Una relación o un contacto ya inactivos no pueden "dejar de venir": no se comparan.
def fetch_published_objects(tenant: int) -> dict[tuple[str | None, str], dict[str, Any]]:
    type_keys = {row["id"]: row["key"] for row in fetch_all_rows("debtor_type", "id,key")}
    contact_type_keys = {row["id"]: row["key"] for row in fetch_all_rows("contact_type", "id,key")}
    debtors = fetch_all_rows(DEBTOR_TABLE, "id,type,external_id", filters={"tenant": tenant})
    debtor_ids = [row["id"] for row in debtors]
    relations = [row for row in _rows_for_ids(DEBTOR_PERSON_TABLE, "id,debtor,person,active", "debtor", debtor_ids) if row["active"]]
    person_ids = [row["person"] for row in relations]
    person_keys = {row["id"]: row["external_id"] for row in _rows_for_ids(PERSON_TABLE, "id,external_id", "id", person_ids)}
    contacts_by_person: dict[int, dict[tuple[int, str | None, str], int]] = defaultdict(dict)

    for row in _rows_for_ids(DEBTOR_CONTACT_TABLE, "id,person,type,value,active", "person", person_ids):
        if row["active"]:
            key = (person_keys[row["person"]], contact_type_keys.get(row["type"]), row["value"])
            contacts_by_person[row["person"]][key] = row["id"]

    published: dict[int, dict[str, Any]] = {
        row["id"]: {"obligaciones": set(), "relaciones": {}, "contactos": {}} for row in debtors
    }

    for row in _rows_for_ids(DEBT_TABLE, "id,debtor,external_id", "debtor", debtor_ids):
        published[row["debtor"]]["obligaciones"].add(row["external_id"])

    for row in relations:
        published[row["debtor"]]["relaciones"][person_keys[row["person"]]] = row["id"]
        published[row["debtor"]]["contactos"].update(contacts_by_person.get(row["person"], {}))

    return {(type_keys.get(row["type"]), str(row["external_id"])): published[row["id"]] for row in debtors}


# ============================================================
# BAJAS Y PERFILES DESDE LO PERSISTIDO
# ============================================================

# Baja explícita de lo que la política pidió dar de baja. Nunca borra: una fila inactiva se reactiva si vuelve a venir.
def deactivate_rows(table_name: str, row_ids: Iterable[int]) -> int:
    unique_ids = sorted(set(row_ids))

    for start in range(0, len(unique_ids), READ_IDS_PER_REQUEST):
        chunk = unique_ids[start:start + READ_IDS_PER_REQUEST]
        execute_supabase_operation(
            f"deactivate {table_name}",
            lambda ids=chunk: supabase.table(table_name).update({"active": False}).in_("id", ids).execute(),
        )

    _count_writes(table_name, WRITE_UPDATED, len(unique_ids))
    return len(unique_ids)


# Recalcula los perfiles pedidos desde las deudas, relaciones y contactos persistidos. No toca ningún otro objeto.
# Devuelve el id de perfil por objeto, leído aparte y por páginas.
def recompute_debtor_profiles(
    debtor_ids: Iterable[int],
    as_of: date,
    *,
    contact_columns_integrated: bool,
) -> dict[int, int]:
    unique_ids = sorted(set(debtor_ids))

    for start in range(0, len(unique_ids), PROFILE_RECOMPUTE_OBJECTS_PER_CALL):
        params = {
            "p_object_ids": unique_ids[start:start + PROFILE_RECOMPUTE_OBJECTS_PER_CALL],
            "p_as_of": as_of.isoformat(),
            "p_contact_columns_integrated": contact_columns_integrated,
        }
        response = execute_supabase_operation(
            "recompute debtor_profile",
            lambda body=params: supabase.rpc(PROFILE_RECOMPUTE_FUNCTION, body).execute(),
        )
        result = response.data

        counters = (*WRITE_OUTCOMES, PROFILE_DETAILS_UPDATED, PROFILE_DEBTS_RECLASSIFIED)
        if not isinstance(result, dict) or any(not isinstance(result.get(name), int) for name in counters):
            raise ETLError("PROFILE_RECOMPUTE_RESPONSE_INVALID", etl_message("PROFILE_RECOMPUTE_RESPONSE_INVALID"))

        for outcome in WRITE_OUTCOMES:
            _count_writes(DEBTOR_PROFILE_TABLE, outcome, result[outcome])

        _count_writes(DEBTOR_PROFILE_DETAIL_TABLE, WRITE_UPDATED, result[PROFILE_DETAILS_UPDATED])
        _count_writes(DEBT_TABLE, WRITE_UPDATED, result[PROFILE_DEBTS_RECLASSIFIED])

    return {row["debtor"]: row["id"] for row in _rows_for_ids(DEBTOR_PROFILE_TABLE, "id,debtor", "debtor", unique_ids)}


# ============================================================
# REGISTRO DEL LOTE
# ============================================================

def _import_batch_error(response: httpx.Response) -> ETLError:
    try:
        message = response.json().get("message")
    except (ValueError, AttributeError):
        message = None

    code = message if isinstance(message, str) and IMPORT_BATCH_STABLE_ERROR.fullmatch(message) else "IMPORT_BATCH_REJECTED"

    # Un 5xx puede venir de la puerta de enlace con la transacción ya confirmada: no prueba que el evento no haya quedado.
    if 400 <= response.status_code < 500:
        return ImportBatchRejected(code, etl_message(code))

    return ETLError(code, etl_message(code))


# Agrega un evento a import_batch por la función de servidor (ALIGN-018): credencial propia del servicio de
# importación, nunca la clave general, que no tiene EXECUTE. Cada llamada es un evento: la clave de idempotencia
# solo protege los reintentos de esa misma llamada. La clave por lote la define ALIGN-032.
def record_import_batch(
    *,
    tenant: int,
    source: str,
    file_hashes: dict[str, str],
    as_of: str,
    rules_version: str,
    status: str,
    counts: dict[str, Any],
    source_updated_at: str | None = None,
    supersedes: int | None = None,
) -> int:
    credentials = get_import_credentials()
    url = get_settings(execute=True).supabase_url.rstrip("/") + IMPORT_BATCH_RPC_PATH
    body = {
        "p_actor_user": credentials.actor_user,
        "p_tenant": tenant,
        "p_source": source,
        "p_file_hashes": file_hashes,
        "p_as_of": as_of,
        "p_rules_version": rules_version,
        "p_status": status,
        "p_idempotency_key": str(uuid.uuid4()),
        "p_source_updated_at": source_updated_at,
        "p_counts": counts,
        "p_supersedes": supersedes,
    }
    headers = {"apikey": credentials.public_key, "Authorization": f"Bearer {credentials.server_jwt}"}

    def record_operation() -> httpx.Response:
        return httpx.post(url, headers=headers, json=body, timeout=IMPORT_BATCH_TIMEOUT_SECONDS, trust_env=False)

    response = execute_supabase_operation(f"record {status}", record_operation)

    if response.status_code != 200:
        raise _import_batch_error(response)

    return int(response.json()["batch_id"])


def execute_import_batch(batch: Any, *, tenant: int, absent_policy: str,
                         expected_revision: str | None = None) -> dict[str, Any]:
    """Único camino de publicación de la CLI; el commit y sus conteos viven en SQL."""
    from ETL.publication import execute_batch

    return execute_batch(batch, tenant=tenant, absent_policy=absent_policy, expected_revision=expected_revision)


# ============================================================
# TEST RÁPIDO DE CONEXIÓN
# ============================================================

# Función para probar la conexión a Supabase. No inserta datos.
def test_connection() -> None:

    response = execute_supabase_operation(
        operation_name=f"test select {PERSON_TABLE}",
        operation=lambda: (
            supabase.table(PERSON_TABLE).select("id").limit(1).execute()
        ),
    )

    print("LOAD CONNECTION OK")
    print(f"Tabla consultada: {PERSON_TABLE}")
    print(f"Registros recibidos: {len(response.data or [])}")


if __name__ == "__main__":
    test_connection()
