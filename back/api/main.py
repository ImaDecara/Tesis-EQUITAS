from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from services.decision_rules_v1 import RULES_VERSION, parse_date
from services.paginated_reader import DataReadError
from services.scoring_service import (
    GROUP_DEFINITIONS,
    get_case_groups,
    get_case_groups_summary,
)

app = FastAPI(
    title="EQUITAS interno — solo local sintético",
    version="0.2.0",
    description="Sin autenticación hasta ALIGN-052. No desplegar ni consumir desde la web (ADR-001).",
)


def declared_cutoff(as_of: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$")) -> str:
    try:
        parse_date(as_of)
    except ValueError:
        raise HTTPException(
            status_code=422, detail="as_of debe ser una fecha ISO válida"
        ) from None
    return as_of


@app.exception_handler(DataReadError)
async def incomplete_read(_request: Request, error: DataReadError) -> JSONResponse:
    return JSONResponse(
        status_code=503, content={"detail": "READ_INCOMPLETE", "table": error.table}
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
    }


@app.get("/case-groups/definitions")
def case_group_definitions() -> dict[str, Any]:
    return {
        "version_reglas": RULES_VERSION,
        "groups": GROUP_DEFINITIONS,
    }


@app.get("/case-groups/summary")
def case_group_summary(as_of: str = Depends(declared_cutoff)) -> dict[str, Any]:
    return get_case_groups_summary(as_of=as_of)


@app.get("/case-groups")
def case_groups(
    as_of: str = Depends(declared_cutoff),
    group_key: str | None = Query(default=None),
    severity_band: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    search: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    return get_case_groups(
        as_of=as_of,
        group_key=group_key,
        severity_band=severity_band,
        tag=tag,
        search=search,
        limit=limit,
        offset=offset,
    )
