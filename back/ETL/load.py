import re
import time
import uuid
from collections.abc import Callable, Iterable, Mapping
from contextvars import ContextVar, Token
from decimal import Decimal
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

IMPORT_BATCH_RPC_PATH = "/rest/v1/rpc/record_import_batch"
IMPORT_BATCH_TIMEOUT_SECONDS = 15
# Códigos estables de record_import_batch (SUPABASE_TESTING_CALIDAD.md). Cualquier otro texto no se propaga.
IMPORT_BATCH_STABLE_ERROR = re.compile(
    r"ROLE_NOT_ALLOWED|ACTOR_NOT_ACTIVE_MEMBER|IDEMPOTENCY_KEY_CONFLICT|SUPERSEDES_NOT_FOUND"
    r"|INVALID_IMPORT_BATCH:[a-z0-9_]{1,63}"
)

T = TypeVar("T")

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


def fetch_existing_debts_by_key(
    payloads: list[dict[str, Any]],
) -> dict[tuple[int, int], dict[str, Any]]:
    if not payloads:
        return {}

    expected_keys = {normalize_debt_key(payload) for payload in payloads}
    debtor_ids = sorted({debtor_id for debtor_id, _ in expected_keys})
    external_ids = sorted({external_id for _, external_id in expected_keys})
    select_columns = ",".join(("id", *DEBT_COMPARE_COLUMNS))

    def select_existing_debts() -> Any:
        return (
            supabase
            .table(DEBT_TABLE)
            .select(select_columns)
            .in_("debtor", debtor_ids)
            .in_("external_id", external_ids)
            .execute()
        )

    response = execute_supabase_operation(
        operation_name=f"bulk select {DEBT_TABLE} ({len(payloads)} keys)",
        operation=select_existing_debts,
    )

    rows_by_key: dict[tuple[int, int], dict[str, Any]] = {}

    if not response.data:
        return rows_by_key

    if not isinstance(response.data, list):
        raise ETLError("DEBT_LOOKUP_RESPONSE_INVALID", etl_message("DEBT_LOOKUP_RESPONSE_INVALID"))

    for row in response.data:
        if not isinstance(row, dict):
            continue

        row_key = normalize_debt_key(row)

        if row_key in expected_keys:
            rows_by_key[row_key] = cast(dict[str, Any], row)

    return rows_by_key


#1.Busca si ya existe un registro con lookup_filters.
#2. Si existe, actualiza.
#3. Si no existe, inserta.

def insert_or_update_by_filters(
    table_name: str,
    payload: dict[str, Any],
    lookup_filters: dict[str, Any],
) -> dict[str, Any]:

    def insert_or_update_operation() -> dict[str, Any]:
        existing_row = fetch_one(
            table_name=table_name,
            filters=lookup_filters,
            retry_http=False,
        )

        if existing_row:
            row_id = existing_row.get("id")

            if row_id is None:
                raise ETLError("ROW_ID_MISSING", etl_message("ROW_ID_MISSING"))

            return update_row(
                table_name=table_name,
                row_id=row_id,
                payload=payload,
                retry_http=False,
            )

        return insert_row(
            table_name=table_name,
            payload=payload,
            retry_http=False,
        )

    return execute_supabase_operation(
        operation_name=f"insert/update {table_name}",
        operation=insert_or_update_operation,
    )


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

    return insert_or_update_by_filters(
        table_name=CITY_TABLE,
        payload=payload,
        lookup_filters=lookup_filters,
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
# Inserta o actualiza el perfil calculado de un objeto de deuda.
def load_debtor_profile(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Regla de deduplicación:
    debtor_profile.debtor
    """

    debtor = payload.get("debtor")

    if debtor is None:
        raise ValueError(etl_message("PROFILE_DEBTOR_MISSING"))

    return insert_or_update_by_filters(
        table_name=DEBTOR_PROFILE_TABLE,
        payload=payload,
        lookup_filters={
            "debtor": debtor,
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
# REGISTRO DEL LOTE
# ============================================================

def _import_batch_error(response: httpx.Response) -> ETLError:
    try:
        message = response.json().get("message")
    except (ValueError, AttributeError):
        message = None

    if isinstance(message, str) and IMPORT_BATCH_STABLE_ERROR.fullmatch(message):
        return ETLError(message, etl_message(message))

    return ETLError("IMPORT_BATCH_REJECTED", etl_message("IMPORT_BATCH_REJECTED"))


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
