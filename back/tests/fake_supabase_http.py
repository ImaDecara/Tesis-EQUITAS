"""Supabase falso a nivel HTTP para probar la API sin red ni credenciales reales.

Emula lo que la API usa de verdad: JWKS, /auth/v1/user, lecturas de PostgREST con las
políticas de RLS de la base, `record_import_batch` y las funciones de la carga directa
(`stage_import_batch`, `publish_import_batch`, `settle_import_batch`, `read_import_receipt`,
`record_access_audit`). Las pruebas contra el stack local están en `tests_real/`; estas fijan
el comportamiento con fallos que allí no se pueden provocar (Auth caído, JWKS rotado,
escritura rechazada).

Catálogo de roles del doble (noche 7, matriz ADMIN/USER; ver `api.auth.PERMISSIONS` y
`public.equitas_role_allows` en 20261110100000_admin_user_access.sql):

- 1 `ADMIN` y 2 `USER`, los roles del producto, comparados exactos.
- 3 `ROL_NO_RECONOCIDO`: cualquier otro nombre; no lee ni importa.
- 4 `importador_sistema`: identidad de máquina del cargador por terminal. La base le permite
  importar, pero no tiene sesión de aplicación: por esta API no entra (403 `ROLE_FORBIDDEN`).

Regla de traducción de las pruebas anteriores (consulta, operador, supervisor, importador):

- leer (`/case-groups*`): ADMIN y USER sí. «consulta», «operador» y «supervisor» leían por
  igual: hoy son USER o ADMIN. La distinción «el importador no lee la cartera» dejó de
  existir: ADMIN importa y también lee.
- importar (`/imports*`): ADMIN sí (antes «importador»); USER no (403 `ROLE_FORBIDDEN`), igual
  que antes consulta, operador y supervisor; el rol no reconocido tampoco; `importador_sistema`
  no entra por esta API.
- lo que no depende del nombre del rol (otro municipio, sin membresía, membresía revocada,
  usuario inactivo, sesión inválida, token manipulado) se conserva tal cual.

Los identificadores de usuario se conservan respecto de la versión anterior del doble: el
usuario 4 sigue siendo quien importa en el municipio A y el 5 en el B.
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
ROL_NO_RECONOCIDO = "ROL_NO_RECONOCIDO"
AUTH_ROL_NO_RECONOCIDO = "00000000-0000-4000-8000-000000000001"
AUTH_USER = "00000000-0000-4000-8000-000000000002"
AUTH_ADMIN_2 = "00000000-0000-4000-8000-000000000003"
AUTH_ADMIN = "00000000-0000-4000-8000-000000000004"
AUTH_ADMIN_OTRO_MUNICIPIO = "00000000-0000-4000-8000-000000000005"
AUTH_SIN_MEMBRESIA = "00000000-0000-4000-8000-000000000006"
AUTH_REVOCADO = "00000000-0000-4000-8000-000000000007"
AUTH_MULTI = "00000000-0000-4000-8000-000000000008"
AUTH_INACTIVO = "00000000-0000-4000-8000-000000000009"
AUTH_SIN_USUARIO = "00000000-0000-4000-8000-00000000000a"
AUTH_USER_OTRO_MUNICIPIO = "00000000-0000-4000-8000-00000000000b"
AUTH_SISTEMA = "00000000-0000-4000-8000-00000000000c"

_ROLES = {
    1: "ADMIN",
    2: "USER",
    3: ROL_NO_RECONOCIDO,
    4: "importador_sistema",
}
# Igual que `equitas_role_allows(..., 'IMPORT_WRITE')`.
IMPORT_WRITE_ROLES = frozenset({"ADMIN", "importador_sistema"})


def _tables() -> dict[str, list[dict[str, Any]]]:
    users = [
        (1, AUTH_ROL_NO_RECONOCIDO, "ACTIVE"),
        (2, AUTH_USER, "ACTIVE"),
        (3, AUTH_ADMIN_2, "ACTIVE"),
        (4, AUTH_ADMIN, "ACTIVE"),
        (5, AUTH_ADMIN_OTRO_MUNICIPIO, "ACTIVE"),
        (6, AUTH_SIN_MEMBRESIA, "ACTIVE"),
        (7, AUTH_REVOCADO, "ACTIVE"),
        (8, AUTH_MULTI, "ACTIVE"),
        (9, AUTH_INACTIVO, "INACTIVE"),
        (11, AUTH_USER_OTRO_MUNICIPIO, "ACTIVE"),
        (12, AUTH_SISTEMA, "ACTIVE"),
    ]
    memberships = [
        (1, TENANT_A, 1, 3, True),
        (2, TENANT_A, 2, 2, True),
        (3, TENANT_A, 3, 1, True),
        (4, TENANT_A, 4, 1, True),
        (5, TENANT_B, 5, 1, True),
        (7, TENANT_A, 7, 2, False),
        (8, TENANT_A, 8, 2, True),
        (9, TENANT_B, 8, 2, True),
        (10, TENANT_A, 9, 2, True),
        (11, TENANT_B, 11, 2, True),
        (12, TENANT_A, 12, 4, True),
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
        "access_audit": [],
        # Catálogos que la carga directa comprueba antes de publicar (`CATALOG_KEY_COLUMNS`).
        **{
            table: [{"id": i, column: key} for i, key in enumerate(keys, 1)]
            for table, column, keys in CATALOGS
        },
    }


CATALOGS = (
    ("document_type", "key", ("CUIT", "UNKNOWN")),
    ("person_type", "key", ("INDIVIDUAL", "LEGAL_PERSON", "UNKNOWN")),
    ("person_status", "key", ("UNKNOWN",)),
    ("debt_status", "key", ("ACTIVE", "CANCELLED", "OVERDUE", "PAID", "SUSPENDED", "UNKNOWN")),
    ("contact_type", "key", ("EMAIL", "MOBILE", "PHONE")),
    ("debtor_type", "key", ("AGUA", "INMUEBLE", "RODADO")),
    ("currency", "code", ("ARS",)),
)
CLOSED_ATTEMPTS = frozenset({"FALLIDO", "DESCARTADO", "REQUIERE_NUEVO_PREVIEW"})
# Funciones de la carga directa que emula este doble (`api.import_load`).
LOAD_RPCS = (
    "stage_import_batch",
    "publish_import_batch",
    "settle_import_batch",
    "read_import_receipt",
    "record_access_audit",
)


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
        # Carga directa: respuesta fija por función (un dict es el cuerpo 200; un str, el
        # mensaje de un rechazo de la base) y estado de las publicaciones por identidad.
        self.rpc_reply: dict[str, Any] = {}
        self.publications: dict[str, dict[str, Any]] = {}

    # ---- Tokens
    def claims(self, sub: str = AUTH_USER, **overrides: Any) -> dict[str, Any]:
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

    def token(self, sub: str = AUTH_USER, *, kid: str | None = None, **overrides):
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
        name = path.removeprefix("/rest/v1/rpc/")
        if name in LOAD_RPCS:
            return self._load_rpc(request, name)
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
        if role not in IMPORT_WRITE_ROLES:
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

    # ---- Carga directa (20261105201716_import_batch_staging, 20261110110000_import_receipt_lookup,
    # 20261102170000_access_audit). Lo mínimo para fijar el orden de llamadas y cada resultado.

    def rpc_bodies(self, name: str) -> list[dict[str, Any]]:
        """Cuerpos enviados a una función, en orden."""
        return [
            json.loads(call.content)
            for call in self.calls
            if call.url.path == f"/rest/v1/rpc/{name}"
        ]

    def rpc_order(self) -> list[str]:
        return [
            call.url.path.removeprefix("/rest/v1/rpc/")
            for call in self.calls
            if call.url.path.startswith("/rest/v1/rpc/")
        ]

    def _authorize(self, body: dict[str, Any]) -> str | None:
        """Como `equitas_import_private.authorize`: rechazo o None."""
        memberships = [
            m
            for m in self.tables["tenant_user"]
            if m["user"] == body.get("p_actor_user")
            and m["tenant"] == body.get("p_tenant")
            and m["status"]
        ]
        if not memberships:
            return "ACTOR_NOT_ACTIVE_MEMBER"
        if _ROLES[memberships[0]["role"]] not in IMPORT_WRITE_ROLES:
            return "ROLE_NOT_ALLOWED"
        return None

    def _load_rpc(self, request: httpx.Request, name: str) -> httpx.Response:
        if self._bearer(request) != IMPORT_JWT:
            return httpx.Response(401, json={"message": "CENTINELA_SIN_CREDENCIAL"})
        body = json.loads(request.content)
        reply = self.rpc_reply.get(name)
        if callable(reply):
            reply = reply(body)
        if isinstance(reply, str):
            return self._rejection(reply)
        if isinstance(reply, httpx.Response):
            return reply
        if reply is not None:
            if name == "stage_import_batch" and isinstance(reply, dict) and "idempotency_key" not in reply:
                # La base siempre devuelve la huella de la identidad del lote; una respuesta forzada también.
                from ETL.transform import canonical_json_hash

                reply = {**reply, "idempotency_key": canonical_json_hash(body["p_document"]["identity"])}
            return httpx.Response(200, json=reply)
        rejection = (
            self._audit_rejection(body)
            if name == "record_access_audit"
            else self._authorize(body)
        )
        if rejection:
            return self._rejection(rejection)
        result = getattr(self, f"_{name}")(body)
        return result if isinstance(result, httpx.Response) else httpx.Response(200, json=result)

    def _publication(self, batch_id: int) -> dict[str, Any] | None:
        return next(
            (job for job in self.publications.values() if job["batch_id"] == batch_id), None
        )

    @staticmethod
    def _receipt(job: dict[str, Any]) -> dict[str, Any]:
        return {
            key: job[key] for key in ("batch_id", "idempotency_key", "revision", "status", "counts")
        }

    def _stage_import_batch(self, body: dict[str, Any]) -> dict[str, Any] | httpx.Response:
        from ETL.transform import canonical_json_hash

        document = body["p_document"]
        identity = canonical_json_hash(document["identity"])
        job = self.publications.get(identity)
        expected = body.get("p_expected_revision")
        if job is not None and job["status"] in CLOSED_ATTEMPTS:
            # Un intento cerrado sin publicar se reabre solo de forma explícita, con su revisión.
            if expected is None:
                return self._rejection("IMPORT_REVALIDATION_REQUIRED")
            if expected != job["revision"]:
                return self._rejection("IMPORT_REVISION_CONFLICT")
            job["status"] = "VALIDADO"
            job["revision"] = canonical_json_hash([job["revision"], "reintento"])
        if job is None:
            job = self.publications[identity] = {
                "batch_id": self.add_batch(
                    body["p_tenant"],
                    body["p_actor_user"],
                    "ADMIN",
                    status="VALIDADO",
                    source=document["source"],
                    file_hashes=document["file_hashes"],
                    as_of=document["identity"]["parameters"]["as_of"],
                ),
                # Como en la base: la clave del lote ES la huella de su identidad (import_publication.idempotency_key).
                "idempotency_key": identity,
                "identity": identity,
                "revision": canonical_json_hash([document, body["p_rows"]]),
                "status": "VALIDADO",
                "counts": document["counts"],
                "document": document,
            }
        return self._receipt(job)

    def _publish_import_batch(self, body: dict[str, Any]) -> dict[str, Any]:
        job = self._publication(body["p_batch_id"])
        if job is None or job["identity"] != body["p_idempotency_key"]:
            return {"status": "FALLIDO", "batch_id": body["p_batch_id"]}
        if job["revision"] != body["p_revision"]:
            job["status"] = "REQUIERE_NUEVO_PREVIEW"
        elif job["status"] == "VALIDADO":
            job["status"] = "PUBLICADO"
        return self._receipt(job)

    def _settle_import_batch(self, body: dict[str, Any]) -> dict[str, Any]:
        job = self._publication(body["p_batch_id"])
        if job is None or job["idempotency_key"] != body["p_idempotency_key"]:
            return {"status": "FALLIDO", "batch_id": body["p_batch_id"]}
        if job["status"] == "VALIDADO":
            job["status"] = body["p_status"]
        return self._receipt(job)

    def _read_import_receipt(self, body: dict[str, Any]) -> dict[str, Any] | httpx.Response:
        job = self.publications.get(body["p_idempotency_key"])
        if job is None:
            return self._rejection("BATCH_NOT_FOUND")
        # Como la función real: solo lo que hace falta para decidir un reintento.
        return {key: job[key] for key in ("batch_id", "status", "revision")}

    def _audit_rejection(self, body: dict[str, Any]) -> str | None:
        if not any(
            m["user"] == body.get("p_actor_user") and m["tenant"] == body.get("p_tenant") and m["status"]
            for m in self.tables["tenant_user"]
        ):
            return "ACTOR_NOT_ACTIVE_MEMBER"
        if body["p_action"] == "IMPORT_CONFIRM" and not any(
            str(b["id"]) == body["p_target"] and b["tenant"] == body["p_tenant"]
            for b in self.tables["import_batch"]
        ):
            return "OBJECT_NOT_IN_TENANT"
        return None

    def _record_access_audit(self, body: dict[str, Any]) -> dict[str, Any]:
        rows = self.tables["access_audit"]
        for row in rows:
            if (row["tenant"], row["idempotency_key"]) == (body["p_tenant"], body["p_idempotency_key"]):
                return {"audit_id": row["id"], "created": False}
        rows.append(
            {
                "id": len(rows) + 1,
                "tenant": body["p_tenant"],
                "actor": body["p_actor_user"],
                "action": body["p_action"],
                "target": body["p_target"],
                "idempotency_key": body["p_idempotency_key"],
            }
        )
        return {"audit_id": len(rows), "created": True}
