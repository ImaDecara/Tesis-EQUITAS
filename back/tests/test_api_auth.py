"""ALIGN-052: autenticación en todas las rutas, contexto de municipio y scoring sin clave general."""

import hashlib
import hmac
import logging
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from fake_supabase_http import (
    AUTH_CONSULTA,
    AUTH_IMPORTADOR,
    AUTH_INACTIVO,
    AUTH_MULTI,
    AUTH_OPERADOR,
    AUTH_OTRO_OPERADOR,
    AUTH_REVOCADO,
    AUTH_SIN_MEMBRESIA,
    AUTH_SIN_USUARIO,
    AUTH_SISTEMA,
    AUTH_SUPERVISOR,
    IMPORT_JWT,
    ISSUER,
    PUBLISHABLE_KEY,
    TENANT_A,
    URL,
    FakeSupabase,
)

from api import auth, main

ASOF = {"as_of": "2026-09-30"}
SERVICE_SENTINEL = "CENTINELA_CLAVE_SERVICIO_GENERAL"


@pytest.fixture
def supabase(monkeypatch) -> FakeSupabase:
    fake = FakeSupabase()
    monkeypatch.setenv("EQUITAS_TARGET_ENV", "local")
    monkeypatch.setenv("SUPABASE_URL", URL)
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", PUBLISHABLE_KEY)
    monkeypatch.setenv("EQUITAS_IMPORT_SERVER_JWT", IMPORT_JWT)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_KEY", raising=False)
    monkeypatch.setattr(
        auth,
        "new_http_client",
        lambda: httpx.Client(transport=httpx.MockTransport(fake), trust_env=False),
    )
    monkeypatch.setattr(auth, "JWKS", auth.JwksCache())
    return fake


@pytest.fixture
def client(supabase) -> TestClient:
    return TestClient(main.app, base_url="http://127.0.0.1", raise_server_exceptions=False)


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def concrete_path(route: APIRoute) -> str:
    return route.path.replace("{batch_id}", "1")


def walk(routes) -> list[APIRoute]:
    """FastAPI 0.157 guarda los routers incluidos como un nodo: se baja por ellos."""
    found = []
    for route in routes:
        if isinstance(route, APIRoute):
            found.append(route)
        else:
            found.extend(walk(route.original_router.routes))
    return found


def api_routes() -> list[tuple[str, str]]:
    return [
        (method, concrete_path(route))
        for route in walk(main.app.routes)
        for method in sorted(route.methods)
    ]


# ---- Todas las rutas


def test_inventory_covers_scoring_health_and_imports():
    assert {path for _, path in api_routes()} >= {
        "/health",
        "/case-groups",
        "/case-groups/summary",
        "/case-groups/definitions",
        "/imports",
        "/imports/1",
        "/imports/1/discard",
    }


@pytest.mark.parametrize(("method", "path"), api_routes())
def test_every_route_rejects_a_request_without_token(client, supabase, method, path):
    response = client.request(method, path, params=ASOF)
    assert response.status_code == 401
    assert response.json() == {"detail": "AUTH_REQUIRED"}
    assert response.headers["www-authenticate"] == "Bearer"
    # Se decide antes de consultar Auth o la base.
    assert supabase.calls == []


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"])
def test_documentation_is_not_published(client, path):
    assert client.get(path).status_code == 404


def test_invalid_token_beats_validation_errors(client):
    assert client.get("/case-groups", params={"as_of": "no"}).status_code == 401


# ---- Token rechazado


def forged_es256(supabase, **claims):
    other = ec.generate_private_key(ec.SECP256R1())
    return jwt.encode(
        supabase.claims(**claims), other, "ES256", headers={"kid": supabase.kid}
    )


def forged_rs256(supabase):
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return jwt.encode(supabase.claims(), other, "RS256", headers={"kid": supabase.kid})


def forged_hs256_secret(supabase):
    return jwt.encode(
        supabase.claims(),
        "secreto-compartido-sintetico-de-32-caracteres",
        "HS256",
        headers={"kid": supabase.kid},
    )


def key_confusion(supabase):
    """El clásico: firmar con HS256 usando la clave pública publicada como secreto."""
    pem = supabase.private_key.public_key().public_bytes(
        Encoding.PEM, PublicFormat.SubjectPublicKeyInfo
    )
    header = jwt.utils.base64url_encode(b'{"alg":"HS256","typ":"JWT","kid":"kid-sintetico"}')
    payload = jwt.utils.base64url_encode(
        jwt.api_jws.json.dumps(supabase.claims()).encode()
    )
    signature = jwt.utils.base64url_encode(
        hmac.new(pem, header + b"." + payload, hashlib.sha256).digest()
    )
    return (header + b"." + payload + b"." + signature).decode()


def alg_none(supabase):
    header = jwt.utils.base64url_encode(b'{"alg":"none","typ":"JWT","kid":"kid-sintetico"}')
    payload = jwt.utils.base64url_encode(
        jwt.api_jws.json.dumps(supabase.claims()).encode()
    )
    return (header + b"." + payload + b".").decode()


def tampered(supabase):
    head, payload, signature = supabase.token().split(".")
    claims = jwt.utils.base64url_encode(
        jwt.api_jws.json.dumps(supabase.claims(AUTH_SUPERVISOR)).encode()
    ).decode()
    assert claims != payload
    return f"{head}.{claims}.{signature}"


REJECTED = {
    "vencido": lambda s: s.token(exp=1_000_000),
    "otro emisor": lambda s: s.token(iss="https://otro-emisor.example.invalid/auth/v1"),
    "emisor con barra final": lambda s: s.token(iss=f"{ISSUER}/"),
    "otra audiencia": lambda s: s.token(aud="otra"),
    "sin vencimiento": lambda s: s.token(exp=None),
    "sin emisor": lambda s: s.token(iss=None),
    "sin audiencia": lambda s: s.token(aud=None),
    "sin sujeto": lambda s: _without_sub(s),
    "sujeto no uuid": lambda s: s.token("no-es-uuid"),
    "rol anon": lambda s: s.token(role="anon"),
    "rol service_role": lambda s: s.token(role="service_role"),
    "rol de servidor": lambda s: s.token(role="equitas_import_server"),
    "sin rol": lambda s: s.token(role=None),
    "alg none": alg_none,
    "HS256 con secreto": forged_hs256_secret,
    "HS256 con la clave publica": key_confusion,
    "RS256 de otra clave": forged_rs256,
    "ES256 de otra clave": forged_es256,
    "kid desconocido": lambda s: s.token(kid="kid-desconocido"),
    "firma alterada": tampered,
    "basura": lambda _s: "esto.no.es-un-jwt",
    "muy largo": lambda _s: "a" * 8193,
}


def _without_sub(supabase):
    claims = supabase.claims()
    del claims["sub"]
    return jwt.encode(claims, supabase.private_key, "ES256", headers={"kid": supabase.kid})


@pytest.mark.parametrize("case", sorted(REJECTED))
def test_rejected_tokens_get_401_with_the_same_body(client, supabase, case):
    response = client.get("/health", headers=bearer(REJECTED[case](supabase)))
    assert response.status_code == 401, case
    assert response.json() == {"detail": "AUTH_REQUIRED"}


def test_valid_token_is_accepted_and_scheme_is_case_insensitive(client, supabase):
    assert client.get("/health", headers=bearer(supabase.token())).json() == {
        "status": "ok"
    }
    response = client.get(
        "/health", headers={"Authorization": f"bearer {supabase.token()}"}
    )
    assert response.status_code == 200


@pytest.mark.parametrize(
    "headers",
    [{"Authorization": "Basic abc"}, {"Authorization": "Bearer"}, {"Authorization": "Bearer a b"}],
)
def test_other_schemes_are_rejected(client, headers):
    assert client.get("/health", headers=headers).status_code == 401


def test_token_is_not_read_from_query_or_cookie(client, supabase):
    token = supabase.token()
    assert client.get("/health", params={"access_token": token}).status_code == 401
    assert client.get("/health", headers={"Cookie": f"sb-access-token={token}"}).status_code == 401


@pytest.mark.parametrize("status", [400, 401, 403, 404])
def test_session_rejected_by_auth_is_401(client, supabase, status):
    supabase.auth_status = status
    assert client.get("/health", headers=bearer(supabase.token())).status_code == 401


def test_auth_reporting_another_user_is_401(client, supabase):
    supabase.auth_body = {"id": AUTH_SUPERVISOR}
    assert client.get("/health", headers=bearer(supabase.token())).status_code == 401
    supabase.auth_body = {}
    assert client.get("/health", headers=bearer(supabase.token())).status_code == 401


@pytest.mark.parametrize("status", [429, 500, 502, 503])
def test_auth_outage_fails_closed_as_unavailable_not_as_logout(client, supabase, status):
    supabase.auth_status = status
    response = client.get("/health", headers=bearer(supabase.token()))
    assert response.status_code == 503
    assert response.json() == {"detail": "AUTH_UNAVAILABLE"}


def test_auth_network_failure_fails_closed_without_leaking(client, supabase):
    supabase.raise_on.add("/auth/v1/user")
    response = client.get("/health", headers=bearer(supabase.token()))
    assert response.status_code == 503
    assert "CENTINELA" not in response.text
    assert "127.0.0.1" not in response.text


@pytest.mark.parametrize("status", [404, 500])
def test_jwks_unavailable_fails_closed(client, supabase, status):
    supabase.jwks_status = status
    assert client.get("/health", headers=bearer(supabase.token())).status_code == 503


def test_jwks_network_failure_fails_closed(client, supabase):
    supabase.raise_on.add("/auth/v1/.well-known/jwks.json")
    assert client.get("/health", headers=bearer(supabase.token())).status_code == 503


# ---- JWKS


def jwks_calls(supabase) -> int:
    return sum(call.url.path.endswith("jwks.json") for call in supabase.calls)


def test_jwks_is_cached_and_a_new_key_is_picked_up_after_the_floor(client, supabase, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(auth, "JWKS", auth.JwksCache(clock=lambda: now[0]))
    headers = bearer(supabase.token())
    assert client.get("/health", headers=headers).status_code == 200
    assert client.get("/health", headers=headers).status_code == 200
    assert jwks_calls(supabase) == 1
    # Un kid desconocido no dispara una consulta a Auth por cada token inventado.
    assert client.get("/health", headers=bearer(supabase.token(kid="otro"))).status_code == 401
    assert jwks_calls(supabase) == 1
    # Rotación: pasado el piso, la clave nueva se reconoce.
    supabase.private_key = ec.generate_private_key(ec.SECP256R1())
    supabase.kid = "kid-rotado"
    now[0] += auth.JWKS_MIN_REFRESH_SECONDS + 1
    assert client.get("/health", headers=bearer(supabase.token())).status_code == 200
    assert jwks_calls(supabase) == 2


def test_jwks_expires_after_ttl(client, supabase, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(auth, "JWKS", auth.JwksCache(clock=lambda: now[0]))
    headers = bearer(supabase.token())
    client.get("/health", headers=headers)
    now[0] += auth.JWKS_TTL_SECONDS + 1
    client.get("/health", headers=headers)
    assert jwks_calls(supabase) == 2


def test_jwks_ignores_keys_that_cannot_verify(supabase, monkeypatch):
    other = ec.generate_private_key(ec.SECP256R1())
    private_pem = other.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption())
    assert private_pem
    payload = {
        "keys": [
            {"kty": "oct", "k": "c2VjcmV0", "kid": "simetrica", "alg": "HS256"},
            {"kty": "EC", "crv": "P-256", "kid": "incompleta"},
            {**supabase.public_jwk(other, "de-cifrado"), "use": "enc"},
            {**supabase.public_jwk(other, "otro-alg"), "alg": "ES384"},
            "no-es-objeto",
            {**supabase.public_jwk(), "kid": 7},
            {**supabase.public_jwk(other, "valida")},
        ]
    }
    http = httpx.Client(
        transport=httpx.MockTransport(lambda _r: httpx.Response(200, json=payload)),
        trust_env=False,
    )
    keys = auth._fetch_jwks(URL, http)
    assert list(keys) == ["valida"]


@pytest.mark.parametrize("payload", [{"keys": []}, {"keys": "x"}, [], {"sin": "keys"}])
def test_jwks_without_usable_keys_is_an_outage(payload):
    http = httpx.Client(
        transport=httpx.MockTransport(lambda _r: httpx.Response(200, json=payload)),
        trust_env=False,
    )
    with pytest.raises(auth.HTTPException) as error:
        auth._fetch_jwks(URL, http)
    assert error.value.status_code == 503


def test_jwks_non_json_is_an_outage():
    http = httpx.Client(
        transport=httpx.MockTransport(lambda _r: httpx.Response(200, text="<html>")),
        trust_env=False,
    )
    with pytest.raises(auth.HTTPException):
        auth._fetch_jwks(URL, http)


# ---- Configuración


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("SUPABASE_URL", ""),
        ("SUPABASE_URL", "https://remoto.example.invalid"),
        ("SUPABASE_URL", "http://127.0.0.1:54321/rest/v1"),
        ("EQUITAS_TARGET_ENV", "produccion"),
        ("SUPABASE_PUBLISHABLE_KEY", ""),
        ("SUPABASE_PUBLISHABLE_KEY", "sb_secret_CENTINELA"),
        (
            "SUPABASE_PUBLISHABLE_KEY",
            jwt.encode({"role": "service_role"}, "s" * 32, "HS256"),
        ),
    ],
)
def test_invalid_configuration_fails_closed(client, supabase, monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    response = client.get("/health", headers=bearer(supabase.token()))
    assert response.status_code == 503
    assert response.json() == {"detail": "API_NOT_CONFIGURED"}
    assert supabase.calls == []


def test_config_never_exposes_the_key_in_repr(monkeypatch):
    monkeypatch.setenv("EQUITAS_TARGET_ENV", "local")
    monkeypatch.setenv("SUPABASE_URL", URL)
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", PUBLISHABLE_KEY)
    assert PUBLISHABLE_KEY not in repr(auth.load_config())


def test_session_repr_hides_the_token():
    session = auth.Session("u", "TOKEN_CENTINELA", auth.ApiConfig(URL, "k"))
    assert "TOKEN_CENTINELA" not in repr(session)


# ---- Contexto


@pytest.mark.parametrize(
    ("user", "status", "code"),
    [
        (AUTH_SIN_MEMBRESIA, 403, "MEMBERSHIP_REQUIRED"),
        (AUTH_REVOCADO, 403, "MEMBERSHIP_REQUIRED"),
        (AUTH_INACTIVO, 403, "MEMBERSHIP_REQUIRED"),
        (AUTH_SIN_USUARIO, 403, "MEMBERSHIP_REQUIRED"),
        (AUTH_MULTI, 409, "TENANT_SELECTION_REQUIRED"),
        (AUTH_IMPORTADOR, 403, "ROLE_FORBIDDEN"),
        (AUTH_SISTEMA, 403, "ROLE_FORBIDDEN"),
    ],
)
@pytest.mark.parametrize("path", ["/case-groups", "/case-groups/summary", "/case-groups/definitions"])
def test_scoring_denied_without_rows_or_counts(client, supabase, path, user, status, code):
    response = client.get(path, params=ASOF, headers=bearer(supabase.token(user)))
    assert response.status_code == status
    assert response.json() == {"detail": code}
    assert "items" not in response.text and "total" not in response.text


def test_revocation_applies_to_the_next_request(client, supabase):
    headers = bearer(supabase.token(AUTH_OPERADOR))
    assert client.get("/case-groups", params=ASOF, headers=headers).status_code == 200
    next(m for m in supabase.tables["tenant_user"] if m["user"] == 2)["status"] = False
    assert client.get("/case-groups", params=ASOF, headers=headers).status_code == 403


def test_inactive_tenant_is_denied(client, supabase):
    supabase.tables["tenant"][0]["status"] = "INACTIVE"
    response = client.get("/case-groups", params=ASOF, headers=bearer(supabase.token()))
    assert response.status_code == 403
    assert response.json() == {"detail": "MEMBERSHIP_REQUIRED"}


def test_unknown_role_is_denied(client, supabase):
    supabase.tables["role"] = []
    response = client.get("/case-groups", params=ASOF, headers=bearer(supabase.token()))
    assert response.status_code == 403


@pytest.mark.parametrize("table", ["user", "tenant_user", "tenant", "role"])
def test_context_read_failure_is_503_without_remote_payload(client, supabase, table):
    supabase.fail_tables.add(table)
    response = client.get("/case-groups", params=ASOF, headers=bearer(supabase.token()))
    assert response.status_code == 503
    assert response.json() == {"detail": "CONTEXT_UNAVAILABLE"}


def test_malformed_membership_row_fails_closed(client, supabase):
    supabase.tables["tenant_user"][1]["tenant"] = None
    response = client.get("/case-groups", params=ASOF, headers=bearer(supabase.token()))
    assert response.status_code == 503


# ---- Scoring con el contexto del usuario


@pytest.mark.parametrize(
    "user", [AUTH_CONSULTA, AUTH_OPERADOR, AUTH_SUPERVISOR]
)
def test_scoring_roles_see_only_their_tenant(client, supabase, user):
    response = client.get("/case-groups", params=ASOF, headers=bearer(supabase.token(user)))
    assert response.status_code == 200
    assert [case["debtor_id"] for case in response.json()["items"]] == [11]
    assert response.json()["total"] == 1
    assert "CENTINELA_TENANT_B" not in response.text
    summary = client.get(
        "/case-groups/summary", params=ASOF, headers=bearer(supabase.token(user))
    )
    assert summary.json()["total_cases"] == 1


def test_other_tenant_user_sees_only_their_rows(client, supabase):
    response = client.get(
        "/case-groups", params=ASOF, headers=bearer(supabase.token(AUTH_OTRO_OPERADOR))
    )
    assert [case["debtor_id"] for case in response.json()["items"]] == [22]


@pytest.mark.parametrize(
    "extra",
    [
        {"params": {"tenant": "2", "tenant_id": "2", "p_tenant": "2"}},
        {"headers": {"X-Tenant": "2", "X-Tenant-Id": "2", "X-Equitas-Tenant": "2"}},
        {"cookies": {"equitas_tenant_id": "2"}},
    ],
)
def test_client_supplied_tenant_is_ignored(client, supabase, extra):
    params = {**ASOF, **extra.get("params", {})}
    headers = {**bearer(supabase.token()), **extra.get("headers", {})}
    client.cookies.update(extra.get("cookies", {}))
    response = client.get("/case-groups", params=params, headers=headers)
    assert [case["debtor_id"] for case in response.json()["items"]] == [11]
    client.cookies.clear()


def test_scoring_uses_the_user_token_and_never_a_general_key(client, supabase, monkeypatch):
    # Aunque esté en el entorno, ninguna solicitud saliente la lleva.
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_SENTINEL)
    monkeypatch.setenv("SUPABASE_KEY", SERVICE_SENTINEL)
    token = supabase.token()
    assert client.get("/case-groups", params=ASOF, headers=bearer(token)).status_code == 200
    reads = [call for call in supabase.calls if call.url.path.startswith("/rest/v1/")]
    assert {call.url.path.split("/")[-1] for call in reads} >= {
        "debtor",
        "debt",
        "debtor_person",
        "debtor_contact",
        "person",
        "person_type",
        "debtor_profile",
    }
    for call in supabase.calls:
        assert SERVICE_SENTINEL not in str(call.headers)
    for call in reads:
        assert call.headers["authorization"] == f"Bearer {token}"
        assert call.headers["apikey"] == PUBLISHABLE_KEY


def test_scoring_works_without_any_general_key_in_the_environment(client, supabase):
    response = client.get("/case-groups/summary", params=ASOF, headers=bearer(supabase.token()))
    assert response.status_code == 200


def test_api_modules_cannot_reach_the_general_client():
    root = Path(__file__).resolve().parents[1]
    sources = [*(root / "api").glob("*.py"), root / "services" / "scoring_service.py"]
    assert len(sources) >= 5
    for source in sources:
        text = source.read_text(encoding="utf-8")
        assert "SUPABASE_SERVICE_ROLE_KEY" not in text, source.name
        assert "SUPABASE_KEY" not in text, source.name
        assert "create_supabase_client" not in text, source.name
        assert "ETL.config import supabase" not in text, source.name


def test_importing_the_api_without_general_key_makes_no_client():
    code = (
        "import api.main, ETL.config\n"
        "assert ETL.config._client_for_settings.cache_info().currsize == 0\n"
    )
    env = {"PATH": "/usr/bin:/bin", "PYTHONPATH": str(Path(__file__).resolve().parents[1])}
    done = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True)
    assert done.returncode == 0, done.stderr


def test_multi_tenant_rows_are_scoped_even_if_rls_shows_both(supabase):
    """Con dos membresías RLS muestra ambos municipios: el filtro del servicio es el que acota."""
    from services import scoring_service as scoring

    http = httpx.Client(transport=httpx.MockTransport(supabase), trust_env=False)
    config = auth.ApiConfig(URL, PUBLISHABLE_KEY)
    data = auth.data_client(config, supabase.token(AUTH_MULTI), http)
    cases = scoring.build_all_case_groups(data, tenant=TENANT_A, as_of="2026-09-30")
    assert [case["debtor_id"] for case in cases] == [11]
    assert "CENTINELA_TENANT_B" not in str(cases)
    reads = {call.url.path.split("/")[-1]: call for call in supabase.calls}
    assert "tenant=eq.1" in str(reads["debtor"].url)


def test_read_failure_stays_503_without_partial_results(client, supabase):
    supabase.fail_tables.add("debt")
    response = client.get("/case-groups", params=ASOF, headers=bearer(supabase.token()))
    assert response.status_code == 503
    assert response.json() == {"detail": "READ_INCOMPLETE", "table": "debt"}


# ---- Superficie HTTP


def test_cors_stays_closed(client, supabase):
    origin = {"Origin": "http://localhost:3000"}
    response = client.get("/health", headers={**origin, **bearer(supabase.token())})
    assert "access-control-allow-origin" not in response.headers
    preflight = client.options(
        "/imports", headers={**origin, "Access-Control-Request-Method": "POST"}
    )
    assert preflight.status_code in {401, 405}
    assert "access-control-allow-origin" not in preflight.headers


@pytest.mark.parametrize(
    "host", ["evil.example.invalid", "equitas.example.invalid:8000", "10.0.0.5"]
)
def test_only_loopback_host_headers_are_accepted(client, supabase, host):
    response = client.get("/health", headers={**bearer(supabase.token()), "Host": host})
    assert response.status_code == 400


@pytest.mark.parametrize("host", ["127.0.0.1", "localhost", "[::1]", "127.0.0.1:8123"])
def test_loopback_host_headers_are_accepted(client, supabase, host):
    response = client.get("/health", headers={**bearer(supabase.token()), "Host": host})
    assert response.status_code == 200


def test_responses_are_not_cacheable(client, supabase):
    response = client.get("/health", headers=bearer(supabase.token()))
    assert response.headers["cache-control"] == "no-store"
    assert client.get("/health").headers["cache-control"] == "no-store"


def test_trailing_slash_does_not_redirect_to_the_internal_url(client, supabase):
    response = client.get(
        "/health/", headers=bearer(supabase.token()), follow_redirects=False
    )
    assert response.status_code == 404
    assert "location" not in response.headers


def test_validation_errors_do_not_echo_values(client, supabase):
    response = client.get(
        "/case-groups",
        params={"as_of": "2026-09-30", "limit": "CENTINELA_ENTRADA"},
        headers=bearer(supabase.token()),
    )
    assert response.status_code == 422
    assert "CENTINELA_ENTRADA" not in response.text
    assert response.json() == {"detail": "VALIDATION_ERROR", "fields": ["query.limit"]}


def test_unhandled_error_gives_500_without_details_or_traceback(
    client, supabase, monkeypatch, caplog
):
    def explodes(*_args, **_kwargs):
        raise RuntimeError("CENTINELA_EXCEPCION")

    monkeypatch.setattr(main, "get_case_groups", explodes)
    with caplog.at_level(logging.DEBUG):
        response = client.get("/case-groups", params=ASOF, headers=bearer(supabase.token()))
    assert response.status_code == 500
    assert response.json() == {"detail": "INTERNAL_ERROR"}
    assert "CENTINELA" not in caplog.text
    assert "RuntimeError" in caplog.text
    assert all(record.exc_info is None for record in caplog.records)


def test_uvicorn_error_log_keeps_only_the_exception_class():
    try:
        raise RuntimeError("CENTINELA_EXCEPCION")
    except RuntimeError:
        record = logging.LogRecord(
            "uvicorn.error",
            logging.ERROR,
            __file__,
            1,
            "Exception in ASGI application\n",
            (),
            sys.exc_info(),
        )
    assert main.DropTraceback().filter(record) is True
    assert record.exc_info is None
    assert record.getMessage() == "ERROR_NO_TRATADO clase=RuntimeError"
    plain = logging.LogRecord(
        "uvicorn.error", logging.INFO, __file__, 1, "Started server", (), None
    )
    assert main.DropTraceback().filter(plain) is True
    assert plain.getMessage() == "Started server"


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("/case-groups?search=CENTINELA", "/case-groups"),
        ("/imports/12/discard", "/imports/12/discard"),
        ("/imports/CENTINELA", "/imports/<x>"),
        ("/imports/12/CENTINELA?x=CENTINELA", "/imports/12/<x>"),
        ("/CENTINELA/health", "/<x>/health"),
    ],
)
def test_access_log_keeps_only_the_shape_of_the_path(path, expected):
    record = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        __file__,
        1,
        '%s - "%s %s HTTP/%s" %d',
        ("127.0.0.1:1", "GET", path, "1.1", 200),
        None,
    )
    assert main.SafeAccessPath().filter(record) is True
    assert "CENTINELA" not in record.getMessage()
    assert f"GET {expected} HTTP" in record.getMessage()


def test_access_log_filter_ignores_other_records():
    assert main.SafeAccessPath().filter(SimpleNamespace(args=None)) is True


def test_api_logger_writes_somewhere_without_extra_configuration():
    api_logger = logging.getLogger("equitas.api")
    assert api_logger.handlers
    assert api_logger.isEnabledFor(logging.INFO)


def test_noisy_loggers_do_not_print_outgoing_urls():
    for name in ("httpx", "httpcore", "hpack"):
        assert logging.getLogger(name).getEffectiveLevel() >= logging.WARNING


def test_auth_rejection_logs_only_a_code(client, supabase, caplog):
    token = supabase.token(exp=1_000_000)
    with caplog.at_level(logging.DEBUG, logger="equitas.api"):
        client.get("/health", headers=bearer(token))
    assert token not in caplog.text
    assert "AUTH_RECHAZADO" in caplog.text


# ---- CLI y scoring por token


def test_cli_scores_with_the_session_token_only(client, supabase, monkeypatch, capsys):
    from services import scoring_service as scoring

    monkeypatch.setenv("EQUITAS_SESSION_TOKEN", supabase.token(AUTH_OPERADOR))
    monkeypatch.setattr("sys.argv", ["scoring_service", "--as-of", "2026-09-30"])
    scoring.main()
    output = capsys.readouterr().out
    assert "Casos procesados: 1" in output
    assert "SINT-A" not in output


@pytest.mark.parametrize(
    "token", ["", "TOKEN_INVALIDO"]
)
def test_cli_without_a_valid_session_stops_with_a_code(supabase, monkeypatch, capsys, token):
    from services import scoring_service as scoring

    monkeypatch.setenv("EQUITAS_SESSION_TOKEN", token)
    monkeypatch.setattr("sys.argv", ["scoring_service", "--as-of", "2026-09-30"])
    with pytest.raises(SystemExit) as error:
        scoring.main()
    assert error.value.code == 2
    assert "AUTH_REQUIRED" in capsys.readouterr().err


def test_cli_denies_a_role_without_read_access(supabase, monkeypatch, capsys):
    from services import scoring_service as scoring

    monkeypatch.setenv("EQUITAS_SESSION_TOKEN", supabase.token(AUTH_IMPORTADOR))
    monkeypatch.setattr("sys.argv", ["scoring_service", "--as-of", "2026-09-30"])
    with pytest.raises(SystemExit):
        scoring.main()
    assert "ROLE_FORBIDDEN" in capsys.readouterr().err


def test_cli_requires_the_cutoff(monkeypatch):
    from services import scoring_service as scoring

    monkeypatch.setattr("sys.argv", ["scoring_service"])
    with pytest.raises(SystemExit) as error:
        scoring.main()
    assert error.value.code == 2
