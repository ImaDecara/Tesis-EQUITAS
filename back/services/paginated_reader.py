"""Lectura por cursor id: nunca confunde un error ni una página corta con fin."""

from collections.abc import Callable
from typing import Any

from httpx import HTTPError
from postgrest.exceptions import APIError

PAGE_SIZE = 1000
ID_CHUNK_SIZE = 200


class DataReadError(RuntimeError):
    """Diagnóstico sin respuestas remotas ni datos personales."""

    def __init__(self, table: str) -> None:
        self.table = table
        super().__init__(f"READ_INCOMPLETE:{table}")


def row_id(value: Any) -> int:
    if isinstance(value, str) and value.isascii() and value.isdigit():
        value = int(value)
    if type(value) is not int or value < 1:
        raise ValueError("Se requiere un id entero positivo")
    return value


def read_all_by_id(
    table: str, query_factory: Callable[[], Any]
) -> list[dict[str, Any]]:
    """Query nueva por página, orden total y cursor estrictamente creciente.

    No ofrece un snapshot transaccional entre consultas: usar un lote estable.
    Una respuesta inválida o un fallo intermedio invalida la lectura completa.
    """
    rows: list[dict[str, Any]] = []
    cursor: int | None = None
    while True:
        try:
            query = query_factory().order("id").limit(PAGE_SIZE)
            if cursor is not None:
                query = query.gt("id", cursor)
            page = query.execute().data
            if not isinstance(page, list):
                raise TypeError("Respuesta inválida")
            if not page:
                return rows
            for row in page:
                identifier = row_id(row["id"])
                if cursor is not None and identifier <= cursor:
                    raise ValueError("El cursor no avanza")
                cursor = identifier
            rows.extend(page)
        except (
            APIError,
            HTTPError,
            OSError,
            RuntimeError,
            ValueError,
            TypeError,
            KeyError,
            AttributeError,
        ):
            # No devolver el prefijo leído ni filtrar una fila inválida.
            raise DataReadError(table) from None
