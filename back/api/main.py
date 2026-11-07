"""API interna de EQUITAS (ALIGN-052): autenticada en todas sus rutas y solo en loopback.

El navegador nunca la llama: el Route Handler de Next reenvía servidor a servidor con el
token de la sesión. Por eso no hay CORS, ni documentación publicada, ni redirecciones.
"""

import asyncio
import contextlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.middleware.trustedhost import TrustedHostMiddleware

from api.auth import (
    ReaderContext,
    UserClientDep,
    require_session,
)
from api.import_preview import router as preview_router
from api.imports import (
    purge_interval_seconds,
    purge_once,
    purge_periodically,
)
from api.imports import router as imports_router
from api.log_guard import install_log_guards
from services.decision_rules_v1 import RULES_VERSION, parse_date
from services.paginated_reader import DataReadError
from services.scoring_service import (
    GROUP_DEFINITIONS,
    get_case_groups,
    get_case_groups_summary,
)

logger = install_log_guards()

LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "[::1]"]


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """El TTL del temporal rige sin solicitudes: al arrancar se retira lo que venció con el
    proceso detenido, y mientras corre, periódicamente."""
    await run_in_threadpool(purge_once)
    task = asyncio.create_task(purge_periodically(purge_interval_seconds()))
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


class NoStoreMiddleware:
    """Las respuestas pueden traer datos de la cartera: ninguna se guarda en cache."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        async def with_header(message) -> None:
            if message["type"] == "http.response.start":
                headers = [
                    (name, value)
                    for name, value in message.get("headers", [])
                    if name.lower() != b"cache-control"
                ]
                message["headers"] = [*headers, (b"cache-control", b"no-store")]
            await send(message)

        await self.app(scope, receive, with_header)


app = FastAPI(
    title="EQUITAS interno — solo local sintético",
    version="0.3.0",
    description="Servicio interno de importación y scoring. Autenticado (ALIGN-052).",
    dependencies=[Depends(require_session)],
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    redirect_slashes=False,
    lifespan=lifespan,
)
app.include_router(imports_router)
app.include_router(preview_router)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=LOOPBACK_HOSTS)
app.add_middleware(NoStoreMiddleware)


def declared_cutoff(as_of: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$")) -> str:
    try:
        parse_date(as_of)
    except ValueError:
        raise HTTPException(
            status_code=422, detail="as_of debe ser una fecha ISO válida"
        ) from None
    return as_of


CutoffDep = Annotated[str, Depends(declared_cutoff)]


@app.exception_handler(DataReadError)
async def incomplete_read(_request: Request, error: DataReadError) -> JSONResponse:
    return JSONResponse(
        status_code=503, content={"detail": "READ_INCOMPLETE", "table": error.table}
    )


@app.exception_handler(RequestValidationError)
async def invalid_request(
    _request: Request, error: RequestValidationError
) -> JSONResponse:
    # La respuesta por defecto devuelve el valor recibido en `input`.
    return JSONResponse(
        status_code=422,
        content={
            "detail": "VALIDATION_ERROR",
            "fields": [
                ".".join(str(part) for part in item["loc"]) for item in error.errors()
            ],
        },
    )


@app.exception_handler(Exception)
async def unhandled_error(_request: Request, error: Exception) -> JSONResponse:
    logger.error("ERROR_NO_TRATADO clase=%s", type(error).__name__)
    return JSONResponse(
        status_code=500,
        content={"detail": "INTERNAL_ERROR"},
        headers={"Cache-Control": "no-store"},
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
    }


@app.get("/case-groups/definitions")
def case_group_definitions(_context: ReaderContext) -> dict[str, Any]:
    return {
        "version_reglas": RULES_VERSION,
        "groups": GROUP_DEFINITIONS,
    }


@app.get("/case-groups/summary")
def case_group_summary(
    context: ReaderContext, client: UserClientDep, as_of: CutoffDep
) -> dict[str, Any]:
    return get_case_groups_summary(client, tenant=context.tenant_id, as_of=as_of)


@app.get("/case-groups")
def case_groups(
    context: ReaderContext,
    client: UserClientDep,
    as_of: CutoffDep,
    group_key: str | None = Query(default=None),
    severity_band: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    search: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    return get_case_groups(
        client,
        tenant=context.tenant_id,
        as_of=as_of,
        group_key=group_key,
        severity_band=severity_band,
        tag=tag,
        search=search,
        limit=limit,
        offset=offset,
    )
