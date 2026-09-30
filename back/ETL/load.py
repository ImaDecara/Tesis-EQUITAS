import time
from typing import Any, Callable, TypeVar, cast

import httpx

from ETL.config import supabase


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

T = TypeVar("T")

# ============================================================
# FUNCIONES BASE DE SUPABASE
# ============================================================

def execute_supabase_operation(
    operation_name: str,
    operation: Callable[[], T],
    retry: bool = True,
) -> T:
    if not retry:
        return operation()

    for attempt in range(1, MAX_SUPABASE_ATTEMPTS + 1):
        try:
            return operation()
        except TRANSIENT_SUPABASE_ERRORS as error:
            if attempt == MAX_SUPABASE_ATTEMPTS:
                raise

            delay_seconds = SUPABASE_RETRY_DELAYS_SECONDS[attempt - 1]
            print(
                f"[Supabase retry] {operation_name} falló por "
                f"{error.__class__.__name__}. "
                f"Reintento {attempt + 1}/{MAX_SUPABASE_ATTEMPTS} "
                f"en {delay_seconds}s."
            )
            time.sleep(delay_seconds)

    raise RuntimeError(f"No se pudo ejecutar {operation_name}")


# Valida que la respuesta de Supabase sea una lista con un diccionario
def get_first_response_row(
    data: Any,
    table_name: str,
    action: str,
) -> dict[str, Any]:

    if not isinstance(data, list) or len(data) == 0:
        raise RuntimeError(
            f"Respuesta vacía o inválida al hacer {action} en {table_name}. "
            f"Data recibida: {data}"
        )

    first_row = data[0]

    if not isinstance(first_row, dict):
        raise RuntimeError(
            f"La respuesta de {table_name} no es un objeto/dict válido. "
            f"Data recibida: {data}"
        )

    return cast(dict[str, Any], first_row)

# Función para hacer fetch de un registro usando filtros, con manejo de errores.
def fetch_one(
    table_name: str,
    filters: dict[str, Any],
    columns: str = "*",
    retry_http: bool = True,
) -> dict[str, Any] | None:

    for column, value in filters.items():
        if value is None:
            raise ValueError(
                f"No se puede buscar en {table_name} con {column}=None"
            )

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
        raise RuntimeError(
            f"No se pudo insertar en {table_name}. Payload: {payload}"
        )

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
        operation_name=f"update {table_name} id={row_id}",
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
        raise RuntimeError(
            f"No se pudo actualizar {table_name} id={row_id}. Payload: {payload}"
        )

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
        raise RuntimeError(
            f"No se pudo insertar bulk en {table_name}. Filas: {len(payloads)}"
        )

    if not isinstance(response.data, list):
        raise RuntimeError(
            f"Respuesta inválida al insertar bulk en {table_name}. "
            f"Data recibida: {response.data}"
        )

    return cast(list[dict[str, Any]], response.data)


def normalize_debt_key(payload: dict[str, Any]) -> tuple[int, int]:
    debtor_id = payload.get("debtor")
    external_id = payload.get("external_id")

    if debtor_id is None:
        raise ValueError(f"Debt sin debtor. Payload: {payload}")

    if external_id is None:
        raise ValueError(f"Debt sin external_id. Payload: {payload}")

    return int(debtor_id), int(external_id)


def debt_values_are_equal(column: str, current_value: Any, next_value: Any) -> bool:
    if column in DEBT_NUMERIC_COLUMNS:
        return abs(float(current_value or 0) - float(next_value or 0)) < 0.000001

    if column in DEBT_INTEGER_COLUMNS:
        if current_value is None or next_value is None:
            return current_value is None and next_value is None

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
        raise RuntimeError(
            f"Respuesta inválida al buscar deudas existentes. "
            f"Data recibida: {response.data}"
        )

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
                raise RuntimeError(
                    f"El registro encontrado en {table_name} no tiene columna id."
                )

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
        raise ValueError(f"Person sin external_id. Payload: {payload}")

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
        raise ValueError(f"Debtor sin tenant. Payload: {payload}")

    if debtor_type is None:
        raise ValueError(f"Debtor sin type. Payload: {payload}")

    if external_id is None:
        raise ValueError(f"Debtor sin external_id. Payload: {payload}")

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
        raise ValueError(f"DebtorPerson sin debtor. Payload: {payload}")

    if person_id is None:
        raise ValueError(f"DebtorPerson sin person. Payload: {payload}")

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
        raise ValueError(f"Debt sin debtor. Payload: {payload}")

    if external_id is None:
        raise ValueError(f"Debt sin external_id. Payload: {payload}")

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
                raise RuntimeError(
                    f"La deuda encontrada no tiene columna id. Payload: {payload}"
                )

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
        raise ValueError(f"Province sin name. Payload: {payload}")

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
        raise ValueError(f"City sin province. Payload: {payload}")

    if not name:
        raise ValueError(f"City sin name. Payload: {payload}")

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
        raise ValueError(f"Address sin person. Payload: {payload}")

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
        raise ValueError(f"DebtorContact sin person. Payload: {payload}")

    if contact_type is None:
        raise ValueError(f"DebtorContact sin type. Payload: {payload}")

    if not value:
        raise ValueError(f"DebtorContact sin value. Payload: {payload}")

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
        raise ValueError(f"DebtorProfile sin debtor. Payload: {payload}")

    return insert_or_update_by_filters(
        table_name=DEBTOR_PROFILE_TABLE,
        payload=payload,
        lookup_filters={
            "debtor": debtor,
        },
    )


# Inserta o actualiza el detalle de riesgo de una persona dentro de un perfil.
def load_debtor_profile_detail(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Regla de deduplicación:
    debtor_profile_detail.debtor_profile + debtor_profile_detail.person
    """

    debtor_profile = payload.get("debtor_profile")
    person = payload.get("person")

    if debtor_profile is None:
        raise ValueError(f"DebtorProfileDetail sin debtor_profile. Payload: {payload}")

    if person is None:
        raise ValueError(f"DebtorProfileDetail sin person. Payload: {payload}")

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
) -> int:
    row = fetch_one(
        table_name=table_name,
        filters={"key": key},
        columns="id,key,value",
    )

    if not row:
        raise RuntimeError(
            f"No existe key='{key}' en la tabla catálogo {table_name}"
        )

    row_id = row.get("id")

    if row_id is None:
        raise RuntimeError(
            f"El catálogo {table_name} con key='{key}' no tiene id."
        )

    return int(row_id)


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
    print(f"Respuesta data: {response.data}")


if __name__ == "__main__":
    test_connection()
