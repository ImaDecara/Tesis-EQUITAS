"""Lotes de importación: recepción, consulta y descarte (ALIGN-052).

Solo llegan hasta `RECIBIDO`: el archivo queda en el temporal privado sin interpretar.
Mapeo (056), preview (054) y confirmación (057) agregan sus endpoints a este router.

Lecturas con el token del usuario y filtro explícito por el municipio resuelto en el
servidor. Escrituras por `record_import_batch` con la credencial dedicada
`equitas_import_server`: no lee tablas y no es la clave de servicio general.
"""

import asyncio
import hashlib
import json
import logging
import os
import re
import tempfile
import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Annotated, Any

import anyio
import httpx
import jwt
from fastapi import APIRouter, Header, HTTPException, Request, Response
from fastapi import Path as PathParam
from postgrest import SyncPostgrestClient
from postgrest.exceptions import APIError
from starlette.concurrency import run_in_threadpool
from starlette.requests import ClientDisconnect

from api.auth import (
    ApiConfig,
    ImporterContext,
    SessionDep,
    TenantContext,
    UserClientDep,
    data_client,
)
from api.multipart import MultipartError, PartEnd, PartStart, multipart_events
from api.upload_store import FILE_KINDS, UploadStore, UploadStoreError
from ETL.config import PROJECT_ROOT
from services.decision_rules_v1 import RULES_VERSION, parse_date
from services.paginated_reader import DataReadError, row_id

logger = logging.getLogger("equitas.api")

router = APIRouter(prefix="/imports", tags=["imports"])

CONTRACT_LIMITS = json.loads(
    (PROJECT_ROOT / "contracts" / "source-contract.v1.json").read_text(encoding="utf-8")
)["limites"]
MAX_FILE_BYTES: int = CONTRACT_LIMITS["bytes"]
# Dos archivos al máximo más el formulario que los envuelve.
MAX_REQUEST_BYTES: int = 2 * MAX_FILE_BYTES + 1_048_576
MAX_FIELD_BYTES = 1024
UPLOAD_SECONDS = 300.0
SOURCE_WEB = "WEB_UPLOAD"
MAX_CHAIN_LENGTH = 256
MAX_BIGINT = 2**63 - 1

BOUNDARY = re.compile(
    r'multipart/form-data;[ \t]*boundary=(?:"([0-9A-Za-z\'()+_,./:=?-]{1,70})"|([0-9A-Za-z\'()+_,./:=?-]{1,70}))[ \t]*',
    re.IGNORECASE,
)
FORM_FIELDS = frozenset({"as_of", "source_updated_at"})
STATUS_RECEIVED = "RECIBIDO"
STATUS_DISCARDED = "DESCARTADO"
# Mientras ALIGN-032 no defina las transiciones: los estados cerrados no se descartan
# y su copia no se restaura.
OPEN_STATES = frozenset({STATUS_RECEIVED, "VALIDADO", "REQUIERE_NUEVO_PREVIEW"})
STORE_UNAVAILABLE = "ALMACEN_TEMPORAL_NO_DISPONIBLE"
STORE_ERRORS = (UploadStoreError, OSError)
PURGE_ERRORS = (*STORE_ERRORS, ValueError, TypeError, RuntimeError)
DEFAULT_PURGE_SECONDS = 900.0
MAX_PURGE_SECONDS = 3600
BATCH_COLUMNS = (
    "id,tenant,source,file_hashes,as_of,source_updated_at,rules_version,counts,"
    "status,created_by_role,created_at,supersedes"
)
RESPONSE_FIELDS = (
    "tenant",
    "source",
    "file_hashes",
    "as_of",
    "source_updated_at",
    "rules_version",
    "counts",
    "status",
    "created_by_role",
    "created_at",
)
_WRITE_REJECTIONS = {
    "ACTOR_NOT_ACTIVE_MEMBER": (403, "MEMBERSHIP_REQUIRED"),
    "ROLE_NOT_ALLOWED": (403, "ROLE_FORBIDDEN"),
    "IDEMPOTENCY_KEY_CONFLICT": (409, "IDEMPOTENCY_KEY_CONFLICT"),
    "SUPERSEDES_NOT_FOUND": (409, "SUPERSEDES_NOT_FOUND"),
    "INVALID_IMPORT_BATCH:import_batch_supersedes_key": (409, "BATCH_ALREADY_SUPERSEDED"),
}

BatchId = Annotated[int, PathParam(ge=1, le=MAX_BIGINT)]


# ---- Configuración de escritura y temporal


def open_store() -> UploadStore:
    root = os.getenv("EQUITAS_IMPORT_TMP_DIR", "").strip()
    uid = os.getuid() if hasattr(os, "getuid") else "local"
    path = Path(root) if root else Path(tempfile.gettempdir()) / f"equitas-imports-{uid}"
    return UploadStore(path)


def load_store() -> UploadStore:
    try:
        return open_store()
    except UploadStoreError:
        raise HTTPException(503, "ALMACEN_TEMPORAL_INSEGURO") from None


def _store_unavailable() -> HTTPException:
    return HTTPException(503, STORE_UNAVAILABLE)


def purge_once() -> None:
    """Una purga que falla se informa y no detiene nada: la próxima vuelve a intentar, y
    mientras tanto `UploadStore.files` no entrega lo vencido. Solo la clase, sin rutas."""
    try:
        open_store().purge_expired()
    except PURGE_ERRORS as error:
        logger.error("PURGA_FALLIDA clase=%s", type(error).__name__)


def purge_interval_seconds() -> float:
    """Acotado: un valor inválido no puede alargar la retención más allá de una hora."""
    value = os.getenv("EQUITAS_IMPORT_PURGE_SECONDS", "").strip()
    if value.isascii() and value.isdigit() and 1 <= int(value) <= MAX_PURGE_SECONDS:
        return float(value)
    return DEFAULT_PURGE_SECONDS


async def purge_periodically(interval: float) -> None:
    while True:
        await asyncio.sleep(interval)
        await run_in_threadpool(purge_once)


def writer_client(config: ApiConfig) -> SyncPostgrestClient:
    """Solo la credencial dedicada: otra clave, aunque funcione, se rechaza."""
    credential = os.getenv("EQUITAS_IMPORT_SERVER_JWT", "").strip()
    try:
        role = jwt.decode(credential, options={"verify_signature": False}).get("role")
    except jwt.PyJWTError:
        role = None
    if role != "equitas_import_server":
        raise HTTPException(503, "IMPORT_WRITER_NOT_CONFIGURED")
    return data_client(config, credential)


def _write_batch(
    config: ApiConfig,
    context: TenantContext,
    *,
    file_hashes: dict[str, str],
    as_of: str,
    status: str,
    idempotency_key: str,
    source: str = SOURCE_WEB,
    rules_version: str = RULES_VERSION,
    source_updated_at: str | None = None,
    counts: dict[str, Any] | None = None,
    supersedes: int | None = None,
) -> tuple[int, bool]:
    writer = writer_client(config)
    try:
        result = writer.rpc(
            "record_import_batch",
            {
                "p_actor_user": context.user_id,
                "p_tenant": context.tenant_id,
                "p_source": source,
                "p_file_hashes": file_hashes,
                "p_as_of": as_of,
                "p_rules_version": rules_version,
                "p_status": status,
                "p_idempotency_key": idempotency_key,
                "p_source_updated_at": source_updated_at,
                "p_counts": counts if counts is not None else {},
                "p_supersedes": supersedes,
            },
        ).execute()
        return row_id(result.data["batch_id"]), result.data["created"] is True
    except APIError as error:
        rejection = _WRITE_REJECTIONS.get(str(error.message))
        if rejection is not None:
            raise HTTPException(*rejection) from None
        if str(error.message).startswith("INVALID_IMPORT_BATCH:"):
            raise HTTPException(422, "INVALID_IMPORT_BATCH") from None
        raise HTTPException(503, "BATCH_WRITE_FAILED") from None
    except (httpx.HTTPError, KeyError, TypeError, ValueError, AttributeError):
        raise HTTPException(503, "BATCH_WRITE_FAILED") from None
    finally:
        writer.session.close()


# ---- Lectura de la cadena de eventos


def _one(
    client: SyncPostgrestClient, tenant: int, column: str, value: int
) -> dict[str, Any] | None:
    try:
        rows = (
            client.table("import_batch")
            .select(BATCH_COLUMNS)
            .eq("tenant", tenant)
            .eq(column, value)
            .limit(1)
            .execute()
            .data
        )
        if not isinstance(rows, list):
            raise TypeError("Respuesta inválida")
        if rows and row_id(rows[0]["id"]) and rows[0]["tenant"] != tenant:
            raise ValueError("Fila de otro municipio")
    except (APIError, httpx.HTTPError, KeyError, TypeError, ValueError, AttributeError):
        raise DataReadError("import_batch") from None
    return rows[0] if rows else None


def _resolve_chain(
    client: SyncPostgrestClient, tenant: int, batch_id: int
) -> tuple[int, dict[str, Any]]:
    """Devuelve el id de origen y el evento vigente. `import_batch` es append-only:
    cada cambio de estado es una fila que reemplaza a la anterior (`supersedes`)."""
    row = _one(client, tenant, "id", batch_id)
    if row is None:
        # Inexistente y ajeno son indistinguibles: RLS y el filtro dan lo mismo.
        raise HTTPException(404, "BATCH_NOT_FOUND")
    origin = row
    for _ in range(MAX_CHAIN_LENGTH):
        if origin["supersedes"] is None:
            break
        origin = _one(client, tenant, "id", origin["supersedes"])
        if origin is None:
            raise DataReadError("import_batch")
    else:
        raise DataReadError("import_batch")
    current = row
    for _ in range(MAX_CHAIN_LENGTH):
        following = _one(client, tenant, "supersedes", row_id(current["id"]))
        if following is None:
            return row_id(origin["id"]), current
        current = following
    raise DataReadError("import_batch")


def _batch_view(
    store: UploadStore, tenant: int, origin: int, row: dict[str, Any]
) -> dict[str, Any]:
    """`copy_available` sale del disco, no de la fila: una copia perdida o vencida se ve."""
    counts = row["counts"] if isinstance(row["counts"], dict) else {}
    try:
        available, expires_at = store.describe(
            tenant, origin, row["file_hashes"], counts.get("bytes")
        )
    except STORE_ERRORS:
        raise _store_unavailable() from None
    return {
        "id": row_id(row["id"]),
        "root_id": origin,
        **{name: row[name] for name in RESPONSE_FIELDS},
        "copy_available": available,
        "copy_expires_at": (
            None if expires_at is None else datetime.fromtimestamp(expires_at, UTC).isoformat()
        ),
    }


# ---- Recepción


@dataclass
class ReceivedForm:
    token: str
    fields: dict[str, str] = field(default_factory=dict)
    hashes: dict[str, str] = field(default_factory=dict)
    sizes: dict[str, int] = field(default_factory=dict)


class _RequestTooLarge(Exception):
    pass


async def _bounded(request: Request):
    received = 0
    async for chunk in request.stream():
        received += len(chunk)
        if received > MAX_REQUEST_BYTES:
            raise _RequestTooLarge()
        yield chunk


def _unprocessable(code: str) -> HTTPException:
    return HTTPException(422, code)


class _FormSink:
    """Decide qué hacer con cada parte. Los campos que no son del lote se ignoran:
    entre ellos, cualquier `tenant` del cuerpo."""

    def __init__(self, store: UploadStore, token: str) -> None:
        self.store = store
        self.form = ReceivedForm(token)
        self._name: str | None = None
        self._hash: Any = None
        self._file: Any = None
        self._size = 0
        self._field = bytearray()
        self._seen_fields: set[str] = set()

    def start(self, part: PartStart) -> None:
        self._name, self._size, self._field = part.name, 0, bytearray()
        if part.filename is None:
            if part.name in FILE_KINDS:
                raise _unprocessable("CAMPO_NO_ESPERADO")
            if part.name in FORM_FIELDS:
                if part.name in self._seen_fields:
                    raise _unprocessable("CAMPO_DUPLICADO")
                self._seen_fields.add(part.name)
            return
        if part.name not in FILE_KINDS:
            raise _unprocessable("ARCHIVO_NO_ESPERADO")
        if part.name in self.form.hashes:
            raise _unprocessable("ARCHIVO_DUPLICADO")
        self._hash = hashlib.sha256()
        self._file = self.store.open_part(self.form.token, part.name)

    async def write(self, chunk: bytes) -> None:
        self._size += len(chunk)
        if self._file is None:
            if self._size > MAX_FIELD_BYTES:
                raise _unprocessable("CAMPO_EXCEDE_LIMITE")
            self._field += chunk
            return
        if self._size > MAX_FILE_BYTES:
            raise _RequestTooLarge()
        self._hash.update(chunk)
        await run_in_threadpool(self._file.write, chunk)

    def end(self) -> None:
        if self._file is None:
            if self._name in FORM_FIELDS:
                self.form.fields[self._name] = self._field.decode("latin-1")
            return
        self._file.close()
        self._file = None
        if self._size == 0:
            raise _unprocessable("ARCHIVO_VACIO")
        self.form.hashes[self._name] = self._hash.hexdigest()
        self.form.sizes[self._name] = self._size

    def close(self) -> None:
        if self._file is not None:
            self._file.close()
            self._file = None


async def _consume(sink: _FormSink, request: Request, boundary: bytes) -> None:
    async for event in multipart_events(_bounded(request), boundary):
        if isinstance(event, PartStart):
            sink.start(event)
        elif isinstance(event, PartEnd):
            sink.end()
        else:
            await sink.write(event)


async def _receive_form(
    request: Request, boundary: bytes, store: UploadStore
) -> ReceivedForm:
    """Si no termina bien, no queda nada en disco. Quien llama confirma o descarta."""
    try:
        token = store.begin()
    except STORE_ERRORS:
        raise _store_unavailable() from None
    sink = _FormSink(store, token)
    try:
        with anyio.fail_after(UPLOAD_SECONDS):
            await _consume(sink, request, boundary)
    except BaseException as error:
        sink.close()
        store.discard(token)
        if isinstance(error, MultipartError):
            raise _unprocessable(error.code) from None
        if isinstance(error, _RequestTooLarge):
            raise HTTPException(413, "LIMITE_ARCHIVO_EXCEDIDO") from None
        if isinstance(error, TimeoutError):
            raise HTTPException(408, "UPLOAD_TIEMPO_EXCEDIDO") from None
        if isinstance(error, ClientDisconnect):
            raise HTTPException(400, "UPLOAD_INTERRUMPIDO") from None
        if isinstance(error, STORE_ERRORS):
            raise _store_unavailable() from None
        raise
    return sink.form


def _boundary(request: Request) -> bytes:
    match = BOUNDARY.fullmatch(request.headers.get("content-type", ""))
    if match is None:
        raise HTTPException(415, "MULTIPART_REQUERIDO")
    return (match.group(1) or match.group(2)).encode("ascii")


def _check_declared_size(request: Request) -> None:
    declared = request.headers.get("content-length", "0")
    if not declared.isascii() or not declared.isdigit():
        raise HTTPException(400, "CONTENT_LENGTH_INVALIDO")
    if int(declared) > MAX_REQUEST_BYTES:
        raise HTTPException(413, "LIMITE_ARCHIVO_EXCEDIDO")


def _idempotency_key(value: str | None) -> str:
    """Obligatoria: es lo que permite reintentar sin duplicar y restaurar una copia perdida.
    Sin ella, una fila cuya copia no se pudo guardar no tendría forma de recuperarse."""
    if value is None:
        raise _unprocessable("IDEMPOTENCY_KEY_REQUERIDA")
    try:
        return str(uuid.UUID(value))
    except ValueError:
        raise _unprocessable("IDEMPOTENCY_KEY_INVALIDA") from None


def _declared_date(fields: dict[str, str], name: str, code: str) -> str | None:
    value = fields.get(name)
    if value is None:
        return None
    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError
        parse_date(value)
    except ValueError:
        raise _unprocessable(code) from None
    return date.fromisoformat(value).isoformat()


def _validated_batch(form: ReceivedForm) -> tuple[str, str | None]:
    as_of = _declared_date(form.fields, "as_of", "AS_OF_INVALIDO")
    if as_of is None:
        raise _unprocessable("AS_OF_INVALIDO")
    source_updated_at = _declared_date(
        form.fields, "source_updated_at", "SOURCE_UPDATED_AT_INVALIDO"
    )
    # Un lote son siempre dos archivos lógicos: dos archivos o un libro con dos hojas.
    if set(form.hashes) not in ({"cabecera", "detalle"}, {"libro"}):
        raise _unprocessable("ARCHIVOS_REQUERIDOS")
    return as_of, source_updated_at


def _install_copy(store: UploadStore, form: ReceivedForm, tenant: int, origin: int) -> None:
    """Deja en el lote una copia completa con los hashes declarados, o falla. Si otra
    solicitud ya la instaló se conserva; si la que hay no verifica, se reemplaza."""
    try:
        if not store.commit(form.token, tenant, origin) and not store.verify(
            tenant, origin, form.hashes
        ):
            store.replace(form.token, tenant, origin)
        verified = store.verify(tenant, origin, form.hashes)
    except STORE_ERRORS:
        raise _store_unavailable() from None
    if not verified:
        raise _store_unavailable()


def _settle_copy(
    store: UploadStore,
    client: SyncPostgrestClient,
    tenant: int,
    batch_id: int,
    created: bool,
    form: ReceivedForm,
) -> tuple[int, dict[str, Any]]:
    """La fila ya está registrada: no se anuncia éxito sin copia. Un reintento del mismo
    contenido (la base garantizó que los hashes coinciden) restaura una copia perdida o
    vencida mientras el lote siga abierto. Lo cerrado no se resucita."""
    if created:
        _install_copy(store, form, tenant, batch_id)
        return _resolve_chain(client, tenant, batch_id)
    origin, row = _resolve_chain(client, tenant, batch_id)
    if row["status"] not in OPEN_STATES:
        return origin, row
    _install_copy(store, form, tenant, origin)
    # Un descarte pudo ganar la carrera y borrar antes de que esta copia llegara.
    origin, row = _resolve_chain(client, tenant, batch_id)
    if row["status"] == STATUS_DISCARDED:
        store.release(tenant, origin)
    return origin, row


@router.post("", status_code=201)
async def create_import(
    request: Request,
    response: Response,
    context: ImporterContext,
    session: SessionDep,
    client: UserClientDep,
    idempotency_key: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """Se autoriza antes de leer un byte del cuerpo: `Depends` corre primero."""
    boundary = _boundary(request)
    _check_declared_size(request)
    key = _idempotency_key(idempotency_key)
    store = load_store()
    await run_in_threadpool(purge_once)
    try:
        store.prepare(context.tenant_id)
    except STORE_ERRORS:
        raise _store_unavailable() from None
    form = await _receive_form(request, boundary, store)
    try:
        as_of, source_updated_at = _validated_batch(form)
        batch_id, created = await run_in_threadpool(
            _write_batch,
            session.config,
            context,
            file_hashes=form.hashes,
            as_of=as_of,
            status=STATUS_RECEIVED,
            idempotency_key=key,
            source_updated_at=source_updated_at,
            counts={"archivos": len(form.hashes), "bytes": sum(form.sizes.values())},
        )
        origin, row = await run_in_threadpool(
            _settle_copy, store, client, context.tenant_id, batch_id, created, form
        )
    finally:
        store.discard(form.token)
    logger.info(
        "IMPORT_RECIBIDO lote=%s creado=%s archivos=%s bytes=%s",
        batch_id,
        created,
        len(form.hashes),
        sum(form.sizes.values()),
    )
    if not created:
        response.status_code = 200
    view = await run_in_threadpool(_batch_view, store, context.tenant_id, origin, row)
    return {**view, "created": created}


@router.get("/{batch_id}")
def read_import(
    batch_id: BatchId, context: ImporterContext, client: UserClientDep
) -> dict[str, Any]:
    store = load_store()
    origin, row = _resolve_chain(client, context.tenant_id, batch_id)
    return _batch_view(store, context.tenant_id, origin, row)


@router.post("/{batch_id}/discard")
def discard_import(
    batch_id: BatchId,
    context: ImporterContext,
    session: SessionDep,
    client: UserClientDep,
) -> dict[str, Any]:
    store = load_store()
    purge_once()
    origin, current = _resolve_chain(client, context.tenant_id, batch_id)
    if current["status"] == STATUS_DISCARDED:
        store.release(context.tenant_id, origin)
        return _batch_view(store, context.tenant_id, origin, current)
    if current["status"] not in OPEN_STATES:
        raise HTTPException(409, "BATCH_NOT_DISCARDABLE")
    current_id = row_id(current["id"])
    # Clave derivada: un reintento o dos clics concurrentes producen un solo evento.
    key = uuid.uuid5(uuid.NAMESPACE_URL, f"equitas:discard:{context.tenant_id}:{current_id}")
    event_id, _created = _write_batch(
        session.config,
        context,
        file_hashes=current["file_hashes"],
        as_of=current["as_of"],
        status=STATUS_DISCARDED,
        idempotency_key=str(key),
        source=current["source"],
        rules_version=current["rules_version"],
        source_updated_at=current["source_updated_at"],
        counts=current["counts"],
        supersedes=current_id,
    )
    store.release(context.tenant_id, origin)
    logger.info("IMPORT_DESCARTADO lote=%s evento=%s", origin, event_id)
    origin, row = _resolve_chain(client, context.tenant_id, event_id)
    return _batch_view(store, context.tenant_id, origin, row)
