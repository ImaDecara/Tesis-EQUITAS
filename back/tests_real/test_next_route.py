"""ALIGN-052: el recorrido navegador → Route Handler de Next → FastAPI, con procesos reales."""

import base64
import hashlib
import json
import os
import time

import httpx
import pytest
from test_imports_api import CABECERA, DETALLE, SENTINELS, batch

TENANT_A = 920001


@pytest.fixture
def browser(next_server):
    with httpx.Client(base_url=next_server.url, trust_env=False, timeout=180) as client:
        yield client


def as_browser(next_server, cookie, *, write=False, **extra):
    headers = {"Cookie": cookie, **extra}
    if write:
        headers["Origin"] = next_server.url
    return headers


def post(browser, next_server, cookie, body, content_type, **extra):
    return browser.post(
        "/api/imports",
        content=body,
        headers={**as_browser(next_server, cookie, write=True), **content_type, **extra},
    )


def test_without_session_is_a_json_401_without_redirect_or_internals(browser, next_server):
    body, content_type = batch()
    created = browser.post(
        "/api/imports", content=body, headers={**content_type, "Origin": next_server.url}
    )
    read = browser.get("/api/imports/1")
    for response in (created, read):
        assert response.status_code == 401
        assert response.json() == {"detail": "AUTH_REQUIRED"}
        assert "location" not in response.headers
        assert next_server.internal_url not in response.text


def test_importer_flow_through_the_route_handler(browser, next_server, session_cookie):
    cookie = session_cookie("importador")
    body, content_type = batch(("tenant", b"920002", None))
    created = post(browser, next_server, cookie, body, content_type)
    assert created.status_code == 201
    data = created.json()
    assert data["tenant"] == TENANT_A
    assert data["file_hashes"] == {
        "cabecera": hashlib.sha256(CABECERA).hexdigest(),
        "detalle": hashlib.sha256(DETALLE).hexdigest(),
    }
    read = browser.get(f"/api/imports/{data['id']}", headers={"Cookie": cookie})
    assert read.status_code == 200
    assert read.json()["status"] == "RECIBIDO"
    discarded = browser.post(
        f"/api/imports/{data['id']}/discard", headers=as_browser(next_server, cookie, write=True)
    )
    assert discarded.status_code == 200
    assert discarded.json()["status"] == "DESCARTADO"


def test_file_over_ten_megabytes_arrives_whole(browser, next_server, session_cookie):
    """Con el proxy de Next en el camino, el cuerpo se cortaba en 10 MB sin ningún error."""
    cabecera = os.urandom(24_000_000)
    detalle = os.urandom(11_000_000)
    body, content_type = batch(cabecera=cabecera, detalle=detalle)
    response = post(browser, next_server, session_cookie("importador"), body, content_type)
    assert response.status_code == 201, response.text
    assert response.json()["file_hashes"] == {
        "cabecera": hashlib.sha256(cabecera).hexdigest(),
        "detalle": hashlib.sha256(detalle).hexdigest(),
    }
    assert response.json()["counts"]["bytes"] == 35_000_000


def test_oversize_gives_a_clear_error_through_next(browser, next_server, session_cookie):
    body, content_type = batch(cabecera=b"x" * 25_000_001, detalle=b"y")
    response = post(browser, next_server, session_cookie("importador"), body, content_type)
    assert response.status_code == 413
    assert response.json() == {"detail": "LIMITE_ARCHIVO_EXCEDIDO"}
    declared = browser.post(
        "/api/imports",
        content=b"x" * 51_048_577,
        headers={
            **as_browser(next_server, session_cookie("importador"), write=True),
            **content_type,
        },
    )
    assert declared.status_code == 413


@pytest.mark.parametrize("label", ["consulta", "operador", "supervisor"])
def test_direct_post_without_the_role_is_403(browser, next_server, session_cookie, label):
    body, content_type = batch()
    response = post(browser, next_server, session_cookie(label), body, content_type)
    assert response.status_code == 403
    assert response.json() == {"detail": "ROLE_FORBIDDEN"}


def test_batch_of_another_tenant_is_404(browser, next_server, session_cookie):
    body, content_type = batch()
    created = post(browser, next_server, session_cookie("importador"), body, content_type)
    identifier = created.json()["id"]
    other = session_cookie("otro-importador")
    assert browser.get(f"/api/imports/{identifier}", headers={"Cookie": other}).status_code == 404


@pytest.mark.parametrize(
    "headers",
    [
        {"Origin": "http://malicioso.example.invalid"},
        {"Origin": "null"},
        {},
        {"Sec-Fetch-Site": "cross-site"},
    ],
    ids=str,
)
def test_cross_origin_write_is_rejected(browser, next_server, session_cookie, headers):
    body, content_type = batch()
    response = browser.post(
        "/api/imports",
        content=body,
        headers={"Cookie": session_cookie("importador"), **content_type, **headers},
    )
    assert response.status_code == 403
    assert response.json() == {"detail": "ORIGIN_NOT_ALLOWED"}


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/imports/case-groups"),
        ("GET", "/api/imports/1/../../health"),
        ("POST", "/api/imports/1/otra"),
        ("GET", "/api/imports/..%2f..%2fhealth"),
    ],
)
def test_only_listed_routes_are_forwarded(browser, next_server, session_cookie, method, path):
    headers = as_browser(next_server, session_cookie("importador"), write=method == "POST")
    response = browser.request(method, path, headers=headers)
    assert response.status_code == 404


def test_browser_never_receives_the_internal_url_or_credentials(
    browser, next_server, session_cookie, env, import_jwt
):
    cookie = session_cookie("importador")
    responses = [
        browser.get("/api/imports/1", headers={"Cookie": cookie}),
        browser.get("/api/imports/900000000", headers={"Cookie": cookie}),
        browser.get("/login"),
    ]
    forbidden = (next_server.internal_url, import_jwt, env["SERVICE_ROLE_KEY"], env["JWT_SECRET"])
    for response in responses:
        rendered = f"{response.headers}\n{response.text}"
        for value in forbidden:
            assert value not in rendered
        assert "uvicorn" not in str(response.headers).lower()
    for response in responses[:2]:
        assert sorted(response.headers) == sorted(
            name for name in response.headers if name in KNOWN_NEXT_HEADERS
        ), sorted(response.headers)
        assert response.headers["cache-control"] == "private, no-store"
    bundle = next_server.static_files()
    assert bundle, "Falta el bundle estático"
    for path in bundle:
        data = path.read_bytes()
        assert b"EQUITAS_IMPORT_API_URL" not in data, path.name
        assert next_server.internal_url.encode() not in data, path.name
        assert import_jwt.encode() not in data, path.name


def session_from(cookie: str) -> tuple[str, dict]:
    """Reúne la sesión de @supabase/ssr, que puede venir partida en varias cookies."""
    pairs = sorted(part.split("=", 1) for part in cookie.split("; "))
    name = pairs[0][0].split(".")[0]
    value = "".join(item for _, item in pairs).removeprefix("base64-")
    value += "=" * (-len(value) % 4)
    return name, json.loads(base64.urlsafe_b64decode(value))


def cookie_with(name: str, session: dict) -> str:
    encoded = base64.urlsafe_b64encode(json.dumps(session).encode()).decode().rstrip("=")
    return f"{name}=base64-{encoded}"


def test_expired_session_is_refreshed_because_the_proxy_does_not_run_here(
    browser, next_server, session_cookie
):
    """Fuera del proxy, nadie más renueva la sesión: lo hace el Route Handler."""
    name, session = session_from(session_cookie("importador"))
    session["expires_at"] = int(time.time()) - 60
    response = browser.get("/api/imports/900000000", headers={"Cookie": cookie_with(name, session)})
    assert response.status_code == 404, response.text
    assert response.json() == {"detail": "BATCH_NOT_FOUND"}
    assert any(name in value for value in response.headers.get_list("set-cookie"))


def test_forged_session_cookie_is_rejected_by_fastapi(browser, next_server, session_cookie):
    """`getSession` no valida el token: la autoridad es la API, y responde 401."""
    name, session = session_from(session_cookie("importador"))
    session["access_token"] = "a.b.c"
    response = browser.get("/api/imports/1", headers={"Cookie": cookie_with(name, session)})
    assert response.status_code == 401
    assert response.json() == {"detail": "AUTH_REQUIRED"}


def test_next_logs_carry_no_sentinels_or_session_data(browser, next_server, session_cookie):
    cookie = session_cookie("importador")
    body, content_type = batch()
    assert post(browser, next_server, cookie, body, content_type).status_code == 201
    logs = next_server.logs()
    assert "Ready in" in logs, "El registro de Next debe haberse capturado"
    for sentinel in SENTINELS.values():
        assert sentinel not in logs, sentinel
    assert next_server.internal_url not in logs
    assert cookie not in logs


KNOWN_NEXT_HEADERS = {"cache-control", "content-type", "date", "connection", "keep-alive",
                      "transfer-encoding", "vary", "content-length", "x-powered-by"}
