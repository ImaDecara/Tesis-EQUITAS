from typing import Any

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from services.scoring_service import (
    GROUP_DEFINITIONS,
    get_case_groups,
    get_case_groups_summary,
)


app = FastAPI(
    title="EQUITAS Backend",
    version="0.1.0",
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
        "groups": GROUP_DEFINITIONS,
    }


@app.get("/case-groups/summary")
def case_group_summary() -> dict[str, Any]:
    return get_case_groups_summary()


@app.get("/case-groups")
def case_groups(
    group_key: str | None = Query(default=None),
    risk_band: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    search: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    return get_case_groups(
        group_key=group_key,
        risk_band=risk_band,
        tag=tag,
        search=search,
        limit=limit,
        offset=offset,
    )