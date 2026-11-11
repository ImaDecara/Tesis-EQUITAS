"""Verificación de sesión y contexto de municipio de la API interna (ALIGN-052).

Dos comprobaciones por solicitud, sin secretos de firma compartidos:

1. Firma y claims con la clave pública que publica el emisor: algoritmo permitido
   explícito, emisor, audiencia, expiración, sujeto y rol de sesión.
2. Confirmación contra el propio Auth (equivalente a `getUser()`): una sesión cerrada
   deja de valer aunque su token no haya vencido.

El municipio y el rol salen de lecturas con el token del usuario, bajo RLS, en cada
solicitud. Nada que envíe el cliente interviene. Este módulo nunca lee la clave de
servicio general: el único cliente de datos que crea lleva el token que recibe.
"""

import logging
import os
import re
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from typing import Annotated, Any

import httpx
import jwt
from fastapi import Depends, Header, HTTPException
from postgrest import SyncPostgrestClient
from postgrest.exceptions import APIError

from ETL.config import ETLError, validate_execution_target
from services.paginated_reader import row_id

logger = logging.getLogger("equitas.api")

# El Auth local (supabase@2.108.0, ALIGN-016) firma las sesiones con ES256 y publica
# esa clave. HS256 también es válido para PostgREST: acá no se acepta a propósito.
ALLOWED_ALGORITHMS = ("ES256",)
AUDIENCE = "authenticated"
SESSION_ROLE = "authenticated"
MAX_TOKEN_CHARS = 8192
BEARER = re.compile(r"[Bb][Ee][Aa][Rr][Ee][Rr] ([A-Za-z0-9_.\-]+)")
JWKS_TTL_SECONDS = 600.0
JWKS_MIN_REFRESH_SECONDS = 30.0
HTTP_TIMEOUT = httpx.Timeout(10.0)

# ÚNICO lugar de esta capa donde se decide qué permite cada rol (noche 7, sección 4.2 del
# encargo). El catálogo es el de la base original: ADMIN y USER, comparados exactos. Leer la
# cartera lo hace cualquier miembro activo, como en main; cargar CSV cambia la cartera de
# todo el municipio y requiere ADMIN. `importador_sistema` es una credencial de máquina del
# cargador por terminal (ALIGN-060), sin sesión: nunca pasa por esta API.
# Equivalentes: `front/lib/server/dal.ts::PERMISSIONS` y `public.equitas_role_allows`.
PERMISSIONS: dict[str, tuple[str, ...]] = {
    "portfolio:read": ("ADMIN", "USER"),
    "import:write": ("ADMIN",),
}
READ_ROLES = PERMISSIONS["portfolio:read"]
IMPORT_ROLES = PERMISSIONS["import:write"]

_CONTEXT_READ_ERRORS = (
    APIError,
    httpx.HTTPError,
    KeyError,
    TypeError,
    ValueError,
    AttributeError,
    IndexError,
)


def new_http_client() -> httpx.Client:
    """Por solicitud: sin proxies del entorno y sin seguir redirecciones."""
    return httpx.Client(trust_env=False, timeout=HTTP_TIMEOUT, follow_redirects=False)


def _rejected(reason: str) -> HTTPException:
    logger.info("AUTH_RECHAZADO motivo=%s", reason)
    return HTTPException(401, "AUTH_REQUIRED", headers={"WWW-Authenticate": "Bearer"})


def _auth_unavailable() -> HTTPException:
    return HTTPException(503, "AUTH_UNAVAILABLE")


# ---- Configuración


@dataclass(frozen=True)
class ApiConfig:
    supabase_url: str
    publishable_key: str = field(repr=False)


def _is_general_key(key: str) -> bool:
    """Una clave secreta mal cargada como publicable abriría RLS: no se usa."""
    if key.startswith("sb_secret_"):
        return True
    try:
        claims = jwt.decode(key, options={"verify_signature": False})
    except jwt.PyJWTError:
        return False
    return claims.get("role") == "service_role"


def load_config() -> ApiConfig:
    """Se valida en cada solicitud: un destino que no es local no llega a usarse."""
    url = os.getenv("SUPABASE_URL", "").strip()
    key = os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
    try:
        validate_execution_target(url)
    except ETLError:
        raise HTTPException(503, "API_NOT_CONFIGURED") from None
    if not key or _is_general_key(key):
        raise HTTPException(503, "API_NOT_CONFIGURED")
    return ApiConfig(url.rstrip("/"), key)


# ---- Claves del emisor


def _fetch_jwks(base_url: str, http: httpx.Client) -> dict[str, jwt.PyJWK]:
    try:
        response = http.get(f"{base_url}/auth/v1/.well-known/jwks.json")
        document = response.json() if response.status_code == 200 else None
    except (httpx.HTTPError, ValueError):
        raise _auth_unavailable() from None
    entries = document.get("keys") if isinstance(document, dict) else None
    keys: dict[str, jwt.PyJWK] = {}
    for entry in entries if isinstance(entries, list) else []:
        if (
            not isinstance(entry, dict)
            or not isinstance(entry.get("kid"), str)
            or entry.get("kty") != "EC"
            or entry.get("alg", "ES256") not in ALLOWED_ALGORITHMS
            or entry.get("use", "sig") != "sig"
        ):
            continue
        public = {
            name: entry[name]
            for name in ("kty", "crv", "x", "y", "kid")
            if name in entry
        }
        try:
            keys[entry["kid"]] = jwt.PyJWK.from_dict(public, algorithm="ES256")
        except jwt.PyJWTError:
            continue
    if not keys:
        raise _auth_unavailable()
    return keys


class JwksCache:
    """Cache corta: una clave rotada se reconoce y un kid inventado no consulta Auth."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._lock = threading.Lock()
        self._entries: dict[str, tuple[float, dict[str, jwt.PyJWK]]] = {}

    def key_for(self, base_url: str, kid: str, http: httpx.Client) -> jwt.PyJWK | None:
        with self._lock:
            now = self._clock()
            fetched_at, keys = self._entries.get(base_url, (None, {}))
            age = None if fetched_at is None else now - fetched_at
            if age is not None and age < JWKS_TTL_SECONDS and kid in keys:
                return keys[kid]
            if age is not None and age < JWKS_MIN_REFRESH_SECONDS:
                return None
            keys = _fetch_jwks(base_url, http)
            self._entries[base_url] = (now, keys)
            return keys.get(kid)


JWKS = JwksCache()


# ---- Token y sesión


@dataclass(frozen=True)
class Session:
    auth_user: str
    token: str = field(repr=False)
    config: ApiConfig = field(repr=False)


def verify_access_token(token: str, config: ApiConfig, http: httpx.Client) -> str:
    """Devuelve el sujeto del token. Ante cualquier duda sobre el token, 401."""
    if len(token) > MAX_TOKEN_CHARS:
        raise _rejected("LARGO")
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        raise _rejected("FORMATO") from None
    if header.get("alg") not in ALLOWED_ALGORITHMS:
        raise _rejected("ALGORITMO")
    kid = header.get("kid")
    if not isinstance(kid, str):
        raise _rejected("KID")
    key = JWKS.key_for(config.supabase_url, kid, http)
    if key is None:
        raise _rejected("KID")
    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=list(ALLOWED_ALGORITHMS),
            audience=AUDIENCE,
            issuer=f"{config.supabase_url}/auth/v1",
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
        )
    except jwt.PyJWTError as error:
        raise _rejected(type(error).__name__) from None
    if claims.get("role") != SESSION_ROLE:
        raise _rejected("ROL")
    try:
        return str(uuid.UUID(str(claims["sub"]), version=4))
    except ValueError:
        raise _rejected("SUJETO") from None


def confirm_session(
    token: str, auth_user: str, config: ApiConfig, http: httpx.Client
) -> None:
    """Una caída de Auth no es una sesión inválida: falla cerrada, pero como 503."""
    try:
        response = http.get(
            f"{config.supabase_url}/auth/v1/user",
            headers={
                "apikey": config.publishable_key,
                "Authorization": f"Bearer {token}",
            },
        )
    except httpx.HTTPError:
        raise _auth_unavailable() from None
    if response.status_code == 429 or response.status_code >= 500:
        raise _auth_unavailable()
    if response.status_code != 200:
        raise _rejected("SESION")
    try:
        same_user = response.json().get("id") == auth_user
    except (ValueError, AttributeError):
        raise _auth_unavailable() from None
    if not same_user:
        raise _rejected("SESION")


def session_for_token(token: str) -> Session:
    config = load_config()
    with new_http_client() as http:
        auth_user = verify_access_token(token, config, http)
        confirm_session(token, auth_user, config, http)
    return Session(auth_user, token, config)


def require_session(
    authorization: Annotated[str | None, Header()] = None,
) -> Session:
    """Dependencia de toda la aplicación (`FastAPI(dependencies=...)`)."""
    match = BEARER.fullmatch(authorization or "")
    if match is None:
        raise _rejected("AUSENTE")
    return session_for_token(match.group(1))


SessionDep = Annotated[Session, Depends(require_session)]


# ---- Clientes de datos


def data_client(
    config: ApiConfig, bearer: str, http: httpx.Client | None = None
) -> SyncPostgrestClient:
    return SyncPostgrestClient(
        f"{config.supabase_url}/rest/v1",
        schema="public",
        headers={
            "apikey": config.publishable_key,
            "Authorization": f"Bearer {bearer}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        http_client=http or new_http_client(),
    )


def user_data_client(session: SessionDep) -> Iterator[SyncPostgrestClient]:
    """Cliente por solicitud con el token del usuario: RLS decide qué filas existen."""
    client = data_client(session.config, session.token)
    try:
        yield client
    finally:
        client.session.close()


UserClientDep = Annotated[SyncPostgrestClient, Depends(user_data_client)]


# ---- Contexto


@dataclass(frozen=True)
class TenantContext:
    auth_user: str
    user_id: int
    tenant_id: int
    role: str


def _membership_required() -> HTTPException:
    return HTTPException(403, "MEMBERSHIP_REQUIRED")


def _rows(query: Any) -> list[dict[str, Any]]:
    data = query.execute().data
    if not isinstance(data, list):
        raise TypeError("Respuesta inválida")
    return data


def _read_context(client: SyncPostgrestClient, auth_user: str) -> TenantContext:
    users = _rows(
        client.table("user")
        .select("id,auth_user,status")
        .eq("auth_user", auth_user)
        .limit(2)
    )
    if len(users) != 1 or users[0]["status"] != "ACTIVE":
        raise _membership_required()
    user_id = row_id(users[0]["id"])
    memberships = _rows(
        client.table("tenant_user")
        .select("tenant,role,status")
        .eq("user", user_id)
        .eq("status", True)
        .limit(2)
    )
    if not memberships:
        raise _membership_required()
    if len(memberships) > 1:
        raise HTTPException(409, "TENANT_SELECTION_REQUIRED")
    tenant_id = row_id(memberships[0]["tenant"])
    tenants = _rows(
        client.table("tenant").select("id,status").eq("id", tenant_id).limit(1)
    )
    if not tenants or tenants[0]["status"] != "ACTIVE":
        raise _membership_required()
    roles = _rows(
        client.table("role")
        .select("id,name")
        .eq("id", row_id(memberships[0]["role"]))
        .limit(1)
    )
    if not roles or not isinstance(roles[0]["name"], str):
        raise _membership_required()
    return TenantContext(auth_user, user_id, tenant_id, roles[0]["name"])


def resolve_tenant_context(
    client: SyncPostgrestClient, session: Session
) -> TenantContext:
    try:
        return _read_context(client, session.auth_user)
    except _CONTEXT_READ_ERRORS:
        raise HTTPException(503, "CONTEXT_UNAVAILABLE") from None


def tenant_context(session: SessionDep, client: UserClientDep) -> TenantContext:
    return resolve_tenant_context(client, session)


def require_roles(*allowed: str) -> Callable[[TenantContext], TenantContext]:
    def dependency(
        context: Annotated[TenantContext, Depends(tenant_context)],
    ) -> TenantContext:
        if context.role not in allowed:
            raise HTTPException(403, "ROLE_FORBIDDEN")
        return context

    return dependency


require_reader = require_roles(*READ_ROLES)
require_importer = require_roles(*IMPORT_ROLES)
ReaderContext = Annotated[TenantContext, Depends(require_reader)]
ImporterContext = Annotated[TenantContext, Depends(require_importer)]
