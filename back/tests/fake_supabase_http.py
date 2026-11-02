"""Supabase falso a nivel HTTP para probar la API sin red ni credenciales reales.

Emula lo que la API usa de verdad: JWKS, /auth/v1/user, lecturas de PostgREST con las
políticas de RLS de la base y `record_import_batch`. Las pruebas contra el stack local
están en `tests_real/`; estas fijan el comportamiento con fallos que allí no se pueden
provocar (Auth caído, JWKS rotado, escritura rechazada).
"""

from __future__ import annotations

import json
import time
import uuid
from typing import Any
from urllib.parse import parse_qsl

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from jwt.algorithms import ECAlgorithm

URL = "http://127.0.0.1:54321"
ISSUER = f"{URL}/auth/v1"
PUBLISHABLE_KEY = "sb_publishable_FICTICIA_ALIGN052"
IMPORT_JWT = jwt.encode(
    {"role": "equitas_import_server"}, "secreto-ficticio-de-32-caracteres!!", "HS256"
)

TENANT_A, TENANT_B = 1, 2
AUTH_CONSULTA = "00000000-0000-4000-8000-000000000001"
AUTH_OPERADOR = "00000000-0000-4000-8000-000000000002"
AUTH_SUPERVISOR = "00000000-0000-4000-8000-000000000003"
AUTH_IMPORTADOR = "00000000-0000-4000-8000-000000000004"
AUTH_OTRO_IMPORTADOR = "00000000-0000-4000-8000-000000000005"
AUTH_SIN_MEMBRESIA = "00000000-0000-4000-8000-000000000006"
AUTH_REVOCADO = "00000000-0000-4000-8000-000000000007"
AUTH_MULTI = "00000000-0000-4000-8000-000000000008"
AUTH_INACTIVO = "00000000-0000-4000-8000-000000000009"
AUTH_SIN_USUARIO = "00000000-0000-4000-8000-00000000000a"
AUTH_OTRO_OPERADOR = "00000000-0000-4000-8000-00000000000b"
AUTH_SISTEMA = "00000000-0000-4000-8000-00000000000c"

_ROLES = {
    1: "consulta",
    2: "operador",
    3: "supervisor",
    4: "importador",
    5: "importador_sistema",
}


def _tables() -> dict[str, list[dict[str, Any]]]:
    users = [
        (1, AUTH_CONSULTA, "ACTIVE"),
        (2, AUTH_OPERADOR, "ACTIVE"),
        (3, AUTH_SUPERVISOR, "ACTIVE"),
        (4, AUTH_IMPORTADOR, "ACTIVE"),
        (5, AUTH_OTRO_IMPORTADOR, "ACTIVE"),
        (6, AUTH_SIN_MEMBRESIA, "ACTIVE"),
        (7, AUTH_REVOCADO, "ACTIVE"),
        (8, AUTH_MULTI, "ACTIVE"),
        (9, AUTH_INACTIVO, "INACTIVE"),
        (11, AUTH_OTRO_OPERADOR, "ACTIVE"),
        (12, AUTH_SISTEMA, "ACTIVE"),
    ]
    memberships = [
        (1, TENANT_A, 1, 1, True),
        (2, TENANT_A, 2, 2, True),
        (3, TENANT_A, 3, 3, True),
        (4, TENANT_A, 4, 4, True),
        (5, TENANT_B, 5, 4, True),
        (7, TENANT_A, 7, 2, False),
        (8, TENANT_A, 8, 2, True),
        (9, TENANT_B, 8, 2, True),
        (10, TENANT_A, 9, 2, True),
        (11, TENANT_B, 11, 2, True),
        (12, TENANT_A, 12, 5, True),
    ]
    return {
        "user": [
            {"id": i, "auth_user": a, "status": s, "full_name": "Fixture"}
            for i, a, s in users
        ],
        "tenant_user": [
            {"id": i, "tenant": t, "user": u, "role": r, "status": s}
            for i, t, u, r, s in memberships
        ],
        "tenant": [
            {"id": TENANT_A, "name": "A", "status": "ACTIVE"},
            {"id": TENANT_B, "name": "B", "status": "ACTIVE"},
        ],
        "role": [{"id": i, "name": n} for i, n in _ROLES.items()],
        "debtor": [
            {
                "id": 11,
                "tenant": TENANT_A,
                "external_id": 11,
                "type": None,
                "identifier": "SINT-A",
                "description": "Objeto A",
                "status": True,
            },
            {
                "id": 22,
                "tenant": TENANT_B,
                "external_id": 22,
                "type": None,
                "identifier": "CENTINELA_TENANT_B",
                "description": "CENTINELA_TENANT_B",
                "status": True,
            },
        ],
        "debt": [
            {"id": 1, "debtor": 11, "current_amount": 1000, "due_date": "2026-01-01"},
            {"id": 2, "debtor": 22, "current_amount": 999999, "due_date": "2026-01-01"},
        ],
        "debtor_profile": [
            {"id": 1, "debtor": 11, "active": True},
            {"id": 2, "debtor": 22, "active": True},
        ],
        "debtor_person": [
            {"id": 1, "debtor": 11, "person": 1, "priority": 100, "active": True},
            {"id": 2, "debtor": 22, "person": 2, "priority": 100, "active": True},
        ],
        "person": [{"id": 1, "type": 1}, {"id": 2, "type": 1}],
        "person_type": [{"id": 1, "key": "INDIVIDUAL"}],
        "debtor_contact": [
            {"id": 1, "person": 1, "type": 1, "value": "SINT-A", "active": True},
            {
                "id": 2,
                "person": 2,
                "type": 1,
                "value": "CENTINELA_TENANT_B",
                "active": True,
            },
        ],
        "import_batch": [],
    }


class FakeSupabase:
    def __init__(self) -> None:
        self.private_key = ec.generate_private_key(ec.SECP256R1())
        self.kid = "kid-sintetico"
        self.tables = _tables()
        self.calls: list[httpx.Request] = []
        self.auth_status = 200
        self.auth_body: dict[str, Any] | None = None
        self.jwks_status = 200
        self.raise_on: set[str] = set()
        self.fail_tables: set[str] = set()
        self.rpc_message: str | None = None
        # Tablas cuya política se simula rota: fija las comprobaciones propias de la API.
        self.rls_off: set[str] = set()

    # ---- Tokens
    def claims(self, sub: str = AUTH_OPERADOR, **overrides: Any) -> dict[str, Any]:
        now = int(time.time())
        values = {
            "iss": ISSUER,
            "aud": "authenticated",
            "sub": sub,
            "role": "authenticated",
            "iat": now - 5,
            "exp": now + 600,
            "session_id": str(uuid.uuid4()),
        }
        values.update(overrides)
        return {k: v for k, v in values.items() if v is not None}

    def token(self, sub: str = AUTH_OPERADOR, *, kid: str | None = None, **overrides):
        return jwt.encode(
            self.claims(sub, **overrides),
            self.private_key,
            "ES256",
            headers={"kid": kid or self.kid},
        )

    def public_jwk(self, private_key=None, kid: str | None = None) -> dict[str, Any]:
        jwk = json.loads(
            ECAlgorithm.to_jwk((private_key or self.private_key).public_key())
        )
        jwk.update(kid=kid or self.kid, alg="ES256", use="sig")
        return jwk

    # ---- HTTP
    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        path = request.url.path
        if path in self.raise_on:
            raise httpx.ConnectError("CENTINELA_RED_INTERNA")
        if path == "/auth/v1/.well-known/jwks.json":
            if self.jwks_status != 200:
                return httpx.Response(self.jwks_status, json={"message": "x"})
            return httpx.Response(200, json={"keys": [self.public_jwk()]})
        if path == "/auth/v1/user":
            return self._auth_user(request)
        if path == "/rest/v1/rpc/record_import_batch":
            return self._record_import_batch(request)
        if path.startswith("/rest/v1/"):
            return self._read(request, path.removeprefix("/rest/v1/"))
        return httpx.Response(404, json={"message": "ruta desconocida"})

    def _bearer(self, request: httpx.Request) -> str:
        return request.headers.get("authorization", "").removeprefix("Bearer ")

    def _auth_user(self, request: httpx.Request) -> httpx.Response:
        if self.auth_status != 200:
            return httpx.Response(self.auth_status, json={"message": "x"})
        if self.auth_body is not None:
            return httpx.Response(200, json=self.auth_body)
        sub = jwt.decode(self._bearer(request), options={"verify_signature": False})
        return httpx.Response(200, json={"id": sub["sub"]})

    # ---- RLS: misma lógica que 20261021221030_active_membership_rls.sql
    def _member_tenants(self, sub: str) -> set[int]:
        user_ids = {
            u["id"]
            for u in self.tables["user"]
            if u["auth_user"] == sub and u["status"] == "ACTIVE"
        }
        return {
            m["tenant"]
            for m in self.tables["tenant_user"]
            if m["user"] in user_ids and m["status"]
        }

    def _visible(self, table: str, sub: str) -> list[dict[str, Any]]:
        rows = self.tables.get(table, [])
        if table in self.rls_off:
            return rows
        tenants = self._member_tenants(sub)
        own = {u["id"] for u in self.tables["user"] if u["auth_user"] == sub}
        debtors = {d["id"] for d in self.tables["debtor"] if d["tenant"] in tenants}
        people = {
            r["person"]
            for r in self.tables["debtor_person"]
            if r["debtor"] in debtors and r["active"]
        }
        if table == "user":
            return [r for r in rows if r["id"] in own]
        if table == "tenant_user":
            return [r for r in rows if r["user"] in own]
        if table == "tenant":
            return [r for r in rows if r["id"] in tenants and r["status"] == "ACTIVE"]
        if table in {"debtor", "import_batch"}:
            return [r for r in rows if r["tenant"] in tenants]
        if table in {"debt", "debtor_profile", "debtor_person"}:
            return [r for r in rows if r["debtor"] in debtors]
        if table == "person":
            return [r for r in rows if r["id"] in people]
        if table == "debtor_contact":
            return [r for r in rows if r["person"] in people]
        return rows if tenants else []

    def _read(self, request: httpx.Request, table: str) -> httpx.Response:
        if table in self.fail_tables:
            return httpx.Response(
                400,
                json={
                    "message": "CENTINELA_ERROR_REMOTO",
                    "code": "XX000",
                    "details": "CENTINELA_DETALLE",
                    "hint": None,
                },
            )
        sub = jwt.decode(self._bearer(request), options={"verify_signature": False})
        rows = self._visible(table, sub.get("sub", ""))
        columns: list[str] = []
        limit = None
        for key, value in parse_qsl(request.url.query.decode()):
            if key == "select":
                columns = value.split(",")
            elif key == "limit":
                limit = int(value)
            elif key not in {"order", "offset"}:
                rows = self._filter(rows, key, value)
        rows = sorted(rows, key=lambda row: row["id"])
        if limit is not None:
            rows = rows[:limit]
        return httpx.Response(
            200, json=[{c: row.get(c) for c in columns} for row in rows]
        )

    @staticmethod
    def _filter(rows: list[dict], column: str, expression: str) -> list[dict]:
        operator, _, value = expression.partition(".")
        if operator == "eq":
            return [r for r in rows if str(r.get(column)).lower() == value.lower()]
        if operator == "in":
            allowed = set(value.strip("()").split(","))
            return [r for r in rows if str(r.get(column)) in allowed]
        if operator == "gt":
            return [r for r in rows if r.get(column) > int(value)]
        raise AssertionError(f"Filtro no emulado: {operator}")

    def _rejection(self, message: str) -> httpx.Response:
        return httpx.Response(
            400, json={"message": message, "code": "P0001", "details": None, "hint": None}
        )

    def _record_import_batch(self, request: httpx.Request) -> httpx.Response:
        if self.rpc_message:
            return self._rejection(self.rpc_message)
        if self._bearer(request) != IMPORT_JWT:
            return httpx.Response(401, json={"message": "CENTINELA_SIN_CREDENCIAL"})
        body = json.loads(request.content)
        tenant, actor = body["p_tenant"], body["p_actor_user"]
        memberships = [
            m
            for m in self.tables["tenant_user"]
            if m["user"] == actor and m["tenant"] == tenant and m["status"]
        ]
        if not memberships:
            return self._rejection("ACTOR_NOT_ACTIVE_MEMBER")
        role = _ROLES[memberships[0]["role"]]
        if role not in {"importador", "importador_sistema"}:
            return self._rejection("ROLE_NOT_ALLOWED")
        batches = self.tables["import_batch"]
        for row in batches:
            if (row["tenant"], row["idempotency_key"]) == (
                tenant,
                body["p_idempotency_key"],
            ):
                same = (
                    row["file_hashes"] == body["p_file_hashes"]
                    and row["status"] == body["p_status"]
                    and row["created_by"] == actor
                )
                if not same:
                    return self._rejection("IDEMPOTENCY_KEY_CONFLICT")
                return httpx.Response(200, json={"batch_id": row["id"], "created": False})
        supersedes = body.get("p_supersedes")
        if supersedes is not None and not any(
            r["id"] == supersedes and r["tenant"] == tenant for r in batches
        ):
            return self._rejection("SUPERSEDES_NOT_FOUND")
        if supersedes is not None and any(r["supersedes"] == supersedes for r in batches):
            return self._rejection("INVALID_IMPORT_BATCH:import_batch_supersedes_key")
        return httpx.Response(
            200,
            json={"batch_id": self.add_batch(tenant, actor, role, body), "created": True},
        )

    def add_batch(
        self, tenant: int, actor: int, role: str, body: dict[str, Any] | None = None, **row
    ) -> int:
        body = body or {}
        batches = self.tables["import_batch"]
        identifier = len(batches) + 1
        batches.append(
            {
                "id": identifier,
                "tenant": tenant,
                "source": body.get("p_source", "WEB_UPLOAD"),
                "file_hashes": body.get("p_file_hashes", {"cabecera": "a" * 64}),
                "as_of": body.get("p_as_of", "2026-09-30"),
                "source_updated_at": body.get("p_source_updated_at"),
                "rules_version": body.get("p_rules_version", "1.0.0"),
                "counts": body.get("p_counts", {}),
                "status": body.get("p_status", "RECIBIDO"),
                "created_by": actor,
                "created_by_role": role,
                "created_at": "2026-11-02T00:00:00+00:00",
                "supersedes": body.get("p_supersedes"),
                "idempotency_key": body.get("p_idempotency_key", str(uuid.uuid4())),
            }
            | row
        )
        return identifier
