from typing import Any, cast

from ETL.config import supabase


# ============================================================
# NOMBRES DE TABLAS
# ============================================================

PERSON_TABLE = "person"
DEBTOR_TABLE = "debtor"
DEBTOR_PERSON_TABLE = "debtor_person"
DEBT_TABLE = "debt"


# ============================================================
# FUNCIONES BASE DE SUPABASE
# ============================================================

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
) -> dict[str, Any] | None:

    query = supabase.table(table_name).select(columns)

    for column, value in filters.items():
        if value is None:
            raise ValueError(
                f"No se puede buscar en {table_name} con {column}=None"
            )

        query = query.eq(column, value)

    response = query.limit(1).execute()

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
) -> dict[str, Any]:
    
    response = supabase.table(table_name).insert(payload).execute()

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
) -> dict[str, Any]:
    
    response = (
        supabase
        .table(table_name)
        .update(payload)
        .eq("id", row_id)
        .execute()
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


#1.Busca si ya existe un registro con lookup_filters.
#2. Si existe, actualiza.
#3. Si no existe, inserta.

def insert_or_update_by_filters(
    table_name: str,
    payload: dict[str, Any],
    lookup_filters: dict[str, Any],
) -> dict[str, Any]:
    
    existing_row = fetch_one(
        table_name=table_name,
        filters=lookup_filters,
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
        )

    return insert_row(
        table_name=table_name,
        payload=payload,
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
    debtor.tenant + debtor.external_id
    """

    tenant = payload.get("tenant")
    external_id = payload.get("external_id")

    if tenant is None:
        raise ValueError(f"Debtor sin tenant. Payload: {payload}")

    if external_id is None:
        raise ValueError(f"Debtor sin external_id. Payload: {payload}")

    return insert_or_update_by_filters(
        table_name=DEBTOR_TABLE,
        payload=payload,
        lookup_filters={
            "tenant": tenant,
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

    response = supabase.table(PERSON_TABLE).select("id").limit(1).execute()

    print("LOAD CONNECTION OK")
    print(f"Tabla consultada: {PERSON_TABLE}")
    print(f"Respuesta data: {response.data}")


if __name__ == "__main__":
    test_connection()