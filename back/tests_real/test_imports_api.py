"""ALIGN-052: criterios de aceptación contra Auth, PostgREST y RLS reales del stack local."""

import concurrent.futures
import hashlib
import os
import shutil
import socket
import stat
import subprocess
import sys
import time
import uuid
from pathlib import Path

import httpx
import jwt
import pytest
from conftest import BACK, GENERAL_KEYS, free_port, psql, wait_for_port
from cryptography.hazmat.primitives.asymmetric import ec
from jwt.algorithms import ECAlgorithm

ASOF = {"as_of": "2026-09-30"}
TENANT_A, TENANT_B = 920001, 920002
USER_IMPORTADOR = 920004
SENTINELS = {
    "file_person": "CENTINELA_A052_ARCHIVO_PERSONA",
    "file_document": "CENTINELA_A052_ARCHIVO_DOCUMENTO",
    "file_mail": "centinela-a052-archivo@example.invalid",
    "filename": "CENTINELA_A052_NOMBRE_ARCHIVO",
    "field": "CENTINELA_A052_CAMPO",
    "query": "CENTINELA_A052_CONSULTA",
    "header": "CENTINELA_A052_ENCABEZADO",
    "as_of": "CENTINELA_A052_FECHA",
}
ALL_ROUTES = [
    ("GET", "/health"),
    ("GET", "/case-groups"),
    ("GET", "/case-groups/summary"),
    ("GET", "/case-groups/definitions"),
    ("POST", "/imports"),
    ("GET", "/imports/1"),
    ("POST", "/imports/1/discard"),
]


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def multipart(*parts, boundary="limiteSinteticoA052"):
    body = b""
    for name, value, filename in parts:
        disposition = f'form-data; name="{name}"'
        if filename:
            disposition += f'; filename="{filename}"'
        body += f"--{boundary}\r\nContent-Disposition: {disposition}\r\n\r\n".encode()
        body += value + b"\r\n"
    return body + f"--{boundary}--\r\n".encode(), {
        "Content-Type": f"multipart/form-data; boundary={boundary}"
    }


CABECERA = (
    f"Cuenta\tNombre\tDocumento\tCorreo\n1\t{SENTINELS['file_person']}\t"
    f"{SENTINELS['file_document']}\t{SENTINELS['file_mail']}\n"
).encode()
DETALLE = b"Cuenta\tDEUD_id\n1\t9\n"


def batch(*extra, cabecera=CABECERA, detalle=DETALLE, as_of=b"2026-09-30"):
    return multipart(
        ("as_of", as_of, None),
        ("cabecera", cabecera, f"{SENTINELS['filename']}.tsv"),
        ("detalle", detalle, "detalle.tsv"),
        *extra,
    )


def post_batch(http, token, *extra, headers=None, params=None, **files):
    body, content_type = batch(*extra, **files)
    return http.post(
        "/imports",
        content=body,
        headers={
            **bearer(token),
            **content_type,
            "Idempotency-Key": str(uuid.uuid4()),
            **(headers or {}),
        },
        params=params,
    )


def batch_rows(root: int) -> str:
    return psql(
        "with recursive c as (select * from public.import_batch where id = %d "
        "union all select b.* from public.import_batch b join c on b.supersedes = c.id) "
        "select count(*) from c" % root
    ).strip()


# ---- Precondición: las pruebas apuntan a lo que dicen


def test_environment_has_no_general_key_and_targets_loopback(api_server):
    assert not set(GENERAL_KEYS) & set(api_server.environment)
    assert "127.0.0.1" in api_server.environment["SUPABASE_URL"]
    assert api_server.url.startswith("http://127.0.0.1:")


def test_real_sessions_are_es256_and_the_issuer_publishes_the_key(env, login):
    header = jwt.get_unverified_header(login("operador"))
    assert header["alg"] == "ES256"
    published = httpx.get(f"{env['API_URL']}/auth/v1/.well-known/jwks.json", trust_env=False)
    assert header["kid"] in {key["kid"] for key in published.json()["keys"]}
    assert all("d" not in key for key in published.json()["keys"])


# ---- 401


def signed(signing_key, env, login, **overrides):
    claims = jwt.decode(login("operador"), options={"verify_signature": False})
    claims.update(overrides)
    claims = {name: value for name, value in claims.items() if value is not None}
    key = ECAlgorithm.from_jwk(signing_key)
    return jwt.encode(claims, key, "ES256", headers={"kid": signing_key["kid"]})


@pytest.mark.parametrize(("method", "path"), ALL_ROUTES)
def test_every_route_without_token_is_401(http, method, path):
    response = http.request(method, path, params=ASOF)
    assert response.status_code == 401
    assert response.json() == {"detail": "AUTH_REQUIRED"}


@pytest.mark.parametrize(("method", "path"), ALL_ROUTES)
def test_every_route_with_expired_token_is_401(http, signing_key, env, login, method, path):
    token = signed(signing_key, env, login, exp=int(time.time()) - 60)
    assert http.request(method, path, params=ASOF, headers=bearer(token)).status_code == 401


def test_properly_signed_token_is_accepted_so_the_rejections_below_are_meaningful(
    http, signing_key, env, login
):
    token = signed(signing_key, env, login)
    assert http.get("/health", headers=bearer(token)).status_code == 200


@pytest.mark.parametrize(
    "overrides",
    [
        {"iss": "https://otro-emisor.example.invalid/auth/v1"},
        {"iss": "http://127.0.0.1:54321/auth/v1/"},
        {"iss": None},
        {"aud": "otra-audiencia"},
        {"aud": None},
        {"exp": None},
        {"sub": None},
        {"role": "service_role"},
        {"role": "anon"},
    ],
    ids=str,
)
def test_token_signed_with_the_real_key_but_wrong_claims_is_401(
    http, signing_key, env, login, overrides
):
    token = signed(signing_key, env, login, **overrides)
    assert http.get("/health", headers=bearer(token)).status_code == 401


def test_disallowed_algorithm_is_401_even_if_postgrest_would_accept_it(http, env, login):
    claims = jwt.decode(login("operador"), options={"verify_signature": False})
    token = jwt.encode(claims, env["JWT_SECRET"], "HS256")
    # Precondición: esa firma es válida para la base. La API la rechaza por el algoritmo.
    direct = httpx.get(
        f"{env['API_URL']}/rest/v1/tenant_user",
        params={"select": "id"},
        headers={"apikey": env["PUBLISHABLE_KEY"], **bearer(token)},
        trust_env=False,
    )
    assert direct.status_code == 200
    assert http.get("/health", headers=bearer(token)).status_code == 401


def test_alg_none_and_foreign_key_are_401(http, signing_key, env, login):
    claims = jwt.decode(login("operador"), options={"verify_signature": False})
    none = jwt.encode(claims, None, "none", headers={"kid": signing_key["kid"]})
    assert http.get("/health", headers=bearer(none)).status_code == 401
    other = ec.generate_private_key(ec.SECP256R1())
    forged = jwt.encode(claims, other, "ES256", headers={"kid": signing_key["kid"]})
    assert http.get("/health", headers=bearer(forged)).status_code == 401


def test_project_keys_and_server_credential_are_not_sessions(http, env, import_jwt):
    for credential in (env["ANON_KEY"], env["SERVICE_ROLE_KEY"], env["PUBLISHABLE_KEY"], import_jwt):
        assert http.get("/health", headers=bearer(credential)).status_code == 401


def test_closed_session_is_401_before_the_token_expires(http, env, login):
    token = login("de-sesion")
    assert http.get("/health", headers=bearer(token)).status_code == 200
    closed = httpx.post(
        f"{env['API_URL']}/auth/v1/logout",
        headers={"apikey": env["PUBLISHABLE_KEY"], **bearer(token)},
        trust_env=False,
    )
    assert closed.status_code == 204
    assert jwt.decode(token, options={"verify_signature": False})["exp"] > time.time()
    assert http.get("/health", headers=bearer(token)).status_code == 401


# ---- 403 y 404 en lotes


@pytest.mark.parametrize("label", ["consulta", "operador", "supervisor", "otro-operador"])
def test_roles_without_import_get_403(http, login, label):
    before = psql("select count(*) from public.import_batch").strip()
    response = post_batch(http, login(label))
    assert response.status_code == 403
    assert response.json() == {"detail": "ROLE_FORBIDDEN"}
    assert http.get("/imports/1", headers=bearer(login(label))).status_code == 403
    assert http.post("/imports/1/discard", headers=bearer(login(label))).status_code == 403
    assert psql("select count(*) from public.import_batch").strip() == before


@pytest.mark.parametrize("label", ["sin-membresia", "inactivo", "usuario-inactivo"])
def test_without_active_membership_get_403(http, login, label):
    response = post_batch(http, login(label))
    assert response.status_code == 403
    assert response.json() == {"detail": "MEMBERSHIP_REQUIRED"}


def test_two_memberships_require_a_selection_and_return_nothing(http, login):
    response = post_batch(http, login("multi"))
    assert response.status_code == 409
    assert response.json() == {"detail": "TENANT_SELECTION_REQUIRED"}
    scoring = http.get("/case-groups", params=ASOF, headers=bearer(login("multi")))
    assert scoring.status_code == 409
    assert "CENTINELA" not in scoring.text


def test_importer_creates_a_received_batch_with_the_dedicated_credential(http, login):
    response = post_batch(http, login("importador"))
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "RECIBIDO"
    assert body["tenant"] == TENANT_A
    assert body["created"] is True
    assert body["file_hashes"]["cabecera"] == hashlib.sha256(CABECERA).hexdigest()
    row = psql(
        "select tenant,status,created_by,created_by_role,source,rules_version,as_of,"
        f"counts->>'archivos' from public.import_batch where id = {body['id']}"
    ).strip()
    assert row == f"{TENANT_A}|RECIBIDO|{USER_IMPORTADOR}|importador|WEB_UPLOAD|1.0.0|2026-09-30|2"


def test_client_supplied_tenant_is_ignored_in_body_query_and_headers(http, login):
    response = post_batch(
        http,
        login("importador"),
        ("tenant", str(TENANT_B).encode(), None),
        ("tenant_id", str(TENANT_B).encode(), None),
        ("p_tenant", str(TENANT_B).encode(), None),
        params={"tenant": TENANT_B, "tenant_id": TENANT_B},
        headers={"X-Tenant": str(TENANT_B), "X-Tenant-Id": str(TENANT_B)},
    )
    assert response.status_code == 201
    assert response.json()["tenant"] == TENANT_A
    identifier = response.json()["id"]
    assert psql(f"select tenant from public.import_batch where id = {identifier}").strip() == str(
        TENANT_A
    )


def test_batch_of_another_tenant_is_404_for_read_and_discard(http, login):
    identifier = post_batch(http, login("importador")).json()["id"]
    other = bearer(login("otro-importador"))
    foreign = http.get(f"/imports/{identifier}", headers=other)
    missing = http.get("/imports/900000000", headers=other)
    assert foreign.status_code == missing.status_code == 404
    assert foreign.json() == missing.json() == {"detail": "BATCH_NOT_FOUND"}
    assert http.post(f"/imports/{identifier}/discard", headers=other).status_code == 404
    assert batch_rows(identifier) == "1"
    # El dueño sigue viéndolo intacto.
    own = http.get(f"/imports/{identifier}", headers=bearer(login("importador")))
    assert own.json()["status"] == "RECIBIDO"


def test_rls_alone_would_show_the_row_to_a_multi_tenant_member(env, login):
    """Precondición del filtro explícito: con dos membresías RLS muestra ambos municipios."""
    rows = httpx.get(
        f"{env['API_URL']}/rest/v1/debtor",
        params={"select": "tenant", "id": "in.(952001,952002)"},
        headers={"apikey": env["PUBLISHABLE_KEY"], **bearer(login("multi"))},
        trust_env=False,
    ).json()
    assert {row["tenant"] for row in rows} == {TENANT_A, TENANT_B}


# ---- Scoring con el contexto del usuario


def identifiers(response) -> set[str]:
    return {case["debtor_identifier"] for case in response.json()["items"]}


@pytest.mark.parametrize("label", ["consulta", "operador", "supervisor"])
def test_scoring_of_a_tenant_shows_only_its_rows_and_counts(http, login, label):
    headers = bearer(login(label))
    cases = http.get("/case-groups", params={**ASOF, "limit": 500}, headers=headers)
    assert cases.status_code == 200
    assert "CENTINELA_A052_OBJETO_A" in identifiers(cases)
    assert "CENTINELA_A052_OBJETO_B" not in cases.text
    assert "777777" not in cases.text
    assert all(str(case["debtor_id"]) != "952002" for case in cases.json()["items"])
    summary = http.get("/case-groups/summary", params=ASOF, headers=headers).json()
    assert summary["total_cases"] == cases.json()["total"]
    expected = psql(f"select count(*) from public.debtor where tenant = {TENANT_A}").strip()
    assert str(summary["total_cases"]) == expected


def test_scoring_of_the_other_tenant_shows_only_its_rows_and_counts(http, login):
    headers = bearer(login("otro-operador"))
    cases = http.get("/case-groups", params={**ASOF, "limit": 500}, headers=headers)
    assert "CENTINELA_A052_OBJETO_B" in identifiers(cases)
    assert "CENTINELA_A052_OBJETO_A" not in cases.text
    summary = http.get("/case-groups/summary", params=ASOF, headers=headers).json()
    expected = psql(f"select count(*) from public.debtor where tenant = {TENANT_B}").strip()
    assert str(summary["total_cases"]) == expected


def test_client_supplied_tenant_does_not_change_scoring(http, login):
    cases = http.get(
        "/case-groups",
        params={**ASOF, "tenant": TENANT_B, "tenant_id": TENANT_B},
        headers={**bearer(login("operador")), "X-Tenant": str(TENANT_B)},
    )
    assert "CENTINELA_A052_OBJETO_B" not in cases.text


@pytest.mark.parametrize("path", ["/case-groups", "/case-groups/summary", "/case-groups/definitions"])
@pytest.mark.parametrize("label", ["sin-membresia", "inactivo", "usuario-inactivo"])
def test_scoring_without_membership_returns_no_rows_or_counts(http, login, path, label):
    response = http.get(path, params=ASOF, headers=bearer(login(label)))
    assert response.status_code == 403
    assert response.json() == {"detail": "MEMBERSHIP_REQUIRED"}


def test_importer_does_not_read_the_portfolio(http, login):
    response = http.get("/case-groups", params=ASOF, headers=bearer(login("importador")))
    assert response.status_code == 403
    assert response.json() == {"detail": "ROLE_FORBIDDEN"}


def test_revoking_a_membership_applies_on_the_next_request(http, login):
    token = login("revocable")
    headers = bearer(token)
    assert http.get("/case-groups", params=ASOF, headers=headers).status_code == 200
    psql("update public.tenant_user set status = false where id = 952005")
    try:
        revoked = http.get("/case-groups", params=ASOF, headers=headers)
        assert revoked.status_code == 403
        assert "CENTINELA" not in revoked.text
    finally:
        psql("update public.tenant_user set status = true where id = 952005")
    assert http.get("/case-groups", params=ASOF, headers=headers).status_code == 200


def test_service_scoped_to_one_tenant_for_a_multi_tenant_session(api_server, env, login, monkeypatch):
    """El servicio con el cliente de sesión real: RLS muestra dos municipios, sale uno."""
    from api import auth
    from services import scoring_service as scoring

    config = auth.ApiConfig(env["API_URL"], env["PUBLISHABLE_KEY"])
    client = auth.data_client(config, login("multi"))
    for tenant, own, foreign in (
        (TENANT_A, "CENTINELA_A052_OBJETO_A", "CENTINELA_A052_OBJETO_B"),
        (TENANT_B, "CENTINELA_A052_OBJETO_B", "CENTINELA_A052_OBJETO_A"),
    ):
        text = str(scoring.build_all_case_groups(client, tenant=tenant, as_of="2026-09-30"))
        assert own in text
        assert foreign not in text


# ---- Cadena, descarte y temporal


def test_validated_batch_is_read_at_its_head_and_can_be_discarded(http, env, login, import_jwt, api_server):
    identifier = post_batch(http, login("importador")).json()["id"]
    row = http.get(f"/imports/{identifier}", headers=bearer(login("importador"))).json()
    advanced = httpx.post(
        f"{env['API_URL']}/rest/v1/rpc/record_import_batch",
        headers={"apikey": env["PUBLISHABLE_KEY"], **bearer(import_jwt)},
        json={
            "p_actor_user": USER_IMPORTADOR,
            "p_tenant": TENANT_A,
            "p_source": row["source"],
            "p_file_hashes": row["file_hashes"],
            "p_as_of": row["as_of"],
            "p_rules_version": row["rules_version"],
            "p_status": "VALIDADO",
            "p_idempotency_key": str(uuid.uuid4()),
            "p_counts": row["counts"],
            "p_supersedes": identifier,
        },
        trust_env=False,
    ).json()
    headers = bearer(login("importador"))
    head = http.get(f"/imports/{identifier}", headers=headers).json()
    assert head["status"] == "VALIDADO"
    assert head["id"] == advanced["batch_id"]
    assert head["root_id"] == identifier
    discarded = http.post(f"/imports/{identifier}/discard", headers=headers)
    assert discarded.status_code == 200
    assert discarded.json()["status"] == "DESCARTADO"
    assert batch_rows(identifier) == "3"
    assert not (api_server.store_root / "lotes" / str(TENANT_A) / str(identifier)).exists()


def test_published_batch_cannot_be_discarded(http, env, login, import_jwt, api_server):
    identifier = post_batch(http, login("importador")).json()["id"]
    row = http.get(f"/imports/{identifier}", headers=bearer(login("importador"))).json()
    httpx.post(
        f"{env['API_URL']}/rest/v1/rpc/record_import_batch",
        headers={"apikey": env["PUBLISHABLE_KEY"], **bearer(import_jwt)},
        json={
            "p_actor_user": USER_IMPORTADOR,
            "p_tenant": TENANT_A,
            "p_source": row["source"],
            "p_file_hashes": row["file_hashes"],
            "p_as_of": row["as_of"],
            "p_rules_version": row["rules_version"],
            "p_status": "PUBLICADO",
            "p_idempotency_key": str(uuid.uuid4()),
            "p_counts": row["counts"],
            "p_supersedes": identifier,
        },
        trust_env=False,
    ).raise_for_status()
    response = http.post(f"/imports/{identifier}/discard", headers=bearer(login("importador")))
    assert response.status_code == 409
    assert response.json() == {"detail": "BATCH_NOT_DISCARDABLE"}
    assert batch_rows(identifier) == "2"


def test_eight_concurrent_discards_make_one_event(http, login, api_server):
    token = login("importador")
    identifier = post_batch(http, token).json()["id"]

    def discard(_):
        with httpx.Client(base_url=api_server.url, trust_env=False, timeout=60) as client:
            return client.post(f"/imports/{identifier}/discard", headers=bearer(token))

    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        responses = list(pool.map(discard, range(8)))
    assert {response.status_code for response in responses} == {200}
    assert {response.json()["id"] for response in responses} == {responses[0].json()["id"]}
    assert batch_rows(identifier) == "2"


def test_replay_with_the_same_key_keeps_one_batch(http, login, api_server):
    key = str(uuid.uuid4())
    token = login("importador")
    first = post_batch(http, token, headers={"Idempotency-Key": key})
    second = post_batch(http, token, headers={"Idempotency-Key": key})
    assert (first.status_code, second.status_code) == (201, 200)
    assert second.json()["id"] == first.json()["id"]
    conflict = post_batch(http, token, headers={"Idempotency-Key": key}, cabecera=b"otro")
    assert conflict.status_code == 409
    assert conflict.json() == {"detail": "IDEMPOTENCY_KEY_CONFLICT"}


def test_private_copy_is_intact_with_private_modes(http, login, api_server):
    identifier = post_batch(http, login("importador")).json()["id"]
    directory = api_server.store_root / "lotes" / str(TENANT_A) / str(identifier)
    assert (directory / "cabecera").read_bytes() == CABECERA
    assert (directory / "detalle").read_bytes() == DETALLE
    for path in (api_server.store_root, directory):
        assert stat.S_IMODE(path.stat().st_mode) == 0o700
    assert stat.S_IMODE((directory / "cabecera").stat().st_mode) == 0o600
    assert list((api_server.store_root / "incoming").iterdir()) == []


def test_oversize_declared_and_streamed_are_413_and_leave_nothing(http, login, api_server):
    token = login("importador")
    before = psql("select count(*) from public.import_batch").strip()
    body, content_type = batch(cabecera=b"x" * 25_000_001, detalle=b"y")
    key = {"Idempotency-Key": str(uuid.uuid4())}
    streamed = http.post("/imports", content=body, headers={**bearer(token), **content_type, **key})
    assert streamed.status_code == 413
    assert streamed.json() == {"detail": "LIMITE_ARCHIVO_EXCEDIDO"}

    def chunks():
        for _ in range(60):
            yield b"z" * 1_000_000

    chunked = http.post(
        "/imports", content=chunks(), headers={**bearer(token), **content_type, **key}
    )
    assert chunked.status_code in {413, 422}
    assert psql("select count(*) from public.import_batch").strip() == before
    assert list((api_server.store_root / "incoming").iterdir()) == []


def test_file_at_the_limit_is_stored_whole(http, login, api_server):
    content = os.urandom(25_000_000)
    response = post_batch(http, login("importador"), cabecera=content)
    assert response.status_code == 201
    assert response.json()["file_hashes"]["cabecera"] == hashlib.sha256(content).hexdigest()
    path = Path(api_server.store_root, "lotes", str(TENANT_A), str(response.json()["id"]), "cabecera")
    assert path.stat().st_size == 25_000_000


# ---- Ciclo 1, B1: fila y copia no se contradicen, con Auth y PostgREST reales


def copy_dir(api_server, identifier, tenant=TENANT_A) -> Path:
    return api_server.store_root / "lotes" / str(tenant) / str(identifier)


def age_copy(path: Path) -> None:
    old = time.time() - 86_401
    os.utime(path, (old, old))


def rows_with_key(key: str) -> str:
    return psql(f"select count(*) from public.import_batch where idempotency_key = '{key}'").strip()


def assert_whole_copy(directory: Path) -> None:
    assert (directory / "cabecera").read_bytes() == CABECERA
    assert (directory / "detalle").read_bytes() == DETALLE


def test_b1_planted_file_in_the_destination_gives_503_and_no_row(http, login, api_server):
    # Una subida asegura que el almacén existe; se ocupa el lugar del directorio del municipio B.
    assert post_batch(http, login("importador")).status_code == 201
    tenant_dir = api_server.store_root / "lotes" / str(TENANT_B)
    if tenant_dir.exists():
        shutil.rmtree(tenant_dir)
    tenant_dir.write_bytes(b"ocupa el lugar del directorio")
    key = str(uuid.uuid4())
    try:
        response = post_batch(http, login("otro-importador"), headers={"Idempotency-Key": key})
    finally:
        tenant_dir.unlink()
    assert response.status_code == 503
    assert response.json() == {"detail": "ALMACEN_TEMPORAL_NO_DISPONIBLE"}
    assert rows_with_key(key) == "0"
    assert list((api_server.store_root / "incoming").iterdir()) == []
    # Quitado el obstáculo, el mismo envío funciona.
    assert post_batch(http, login("otro-importador"), headers={"Idempotency-Key": key}).status_code == 201


def test_b1_retry_restores_a_copy_lost_after_the_row_was_recorded(http, login, api_server):
    token = login("importador")
    key = str(uuid.uuid4())
    identifier = post_batch(http, token, headers={"Idempotency-Key": key}).json()["id"]
    shutil.rmtree(copy_dir(api_server, identifier))
    state = http.get(f"/imports/{identifier}", headers=bearer(token)).json()
    assert state["status"] == "RECIBIDO"
    assert state["copy_available"] is False
    retry = post_batch(http, token, headers={"Idempotency-Key": key})
    assert retry.status_code == 200
    assert retry.json()["id"] == identifier
    assert retry.json()["copy_available"] is True
    assert rows_with_key(key) == "1"
    assert_whole_copy(copy_dir(api_server, identifier))


def test_b1_retry_after_the_ttl_restores_the_copy(http, login, api_server):
    token = login("importador")
    key = str(uuid.uuid4())
    identifier = post_batch(http, token, headers={"Idempotency-Key": key}).json()["id"]
    age_copy(copy_dir(api_server, identifier))
    retry = post_batch(http, token, headers={"Idempotency-Key": key})
    assert retry.status_code == 200
    assert retry.json()["status"] == "RECIBIDO"
    assert retry.json()["copy_available"] is True
    assert rows_with_key(key) == "1"
    assert_whole_copy(copy_dir(api_server, identifier))


def test_b1_retry_of_a_discarded_batch_does_not_bring_the_copy_back(http, login, api_server):
    token = login("importador")
    key = str(uuid.uuid4())
    identifier = post_batch(http, token, headers={"Idempotency-Key": key}).json()["id"]
    assert http.post(f"/imports/{identifier}/discard", headers=bearer(token)).status_code == 200
    retry = post_batch(http, token, headers={"Idempotency-Key": key})
    assert retry.status_code == 200
    assert retry.json()["status"] == "DESCARTADO"
    assert retry.json()["copy_available"] is False
    assert not copy_dir(api_server, identifier).exists()


def test_b1_eight_simultaneous_sends_make_one_batch_and_one_whole_copy(login, api_server):
    token = login("importador")
    key = str(uuid.uuid4())
    body, content_type = batch()

    def send(_):
        with httpx.Client(base_url=api_server.url, trust_env=False, timeout=60) as client:
            return client.post(
                "/imports",
                content=body,
                headers={**bearer(token), **content_type, "Idempotency-Key": key},
            )

    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        responses = list(pool.map(send, range(8)))
    assert sorted(response.status_code for response in responses) == [200] * 7 + [201]
    assert {response.json()["id"] for response in responses} == {responses[0].json()["id"]}
    assert all(response.json()["copy_available"] is True for response in responses)
    assert rows_with_key(key) == "1"
    assert_whole_copy(copy_dir(api_server, responses[0].json()["id"]))
    assert list((api_server.store_root / "incoming").iterdir()) == []


def test_b1_upload_without_a_key_is_422_and_makes_no_row(http, login, api_server):
    token = login("importador")
    before = psql("select count(*) from public.import_batch").strip()
    body, content_type = batch()
    response = http.post("/imports", content=body, headers={**bearer(token), **content_type})
    assert response.status_code == 422
    assert response.json() == {"detail": "IDEMPOTENCY_KEY_REQUERIDA"}
    assert psql("select count(*) from public.import_batch").strip() == before


# ---- Ciclo 1, B2: el vencimiento no depende de otra subida


def test_b2_expired_copy_is_not_offered_by_get_and_its_bytes_go(http, login, api_server):
    token = login("importador")
    identifier = post_batch(http, token).json()["id"]
    directory = copy_dir(api_server, identifier)
    age_copy(directory)
    response = http.get(f"/imports/{identifier}", headers=bearer(token))
    assert response.status_code == 200
    assert response.json()["copy_available"] is False
    assert not directory.exists()


def test_b2_idle_process_purges_without_any_request(api_server, tmp_path):
    """Otro uvicorn real, con su almacén y sin ninguna solicitud después de arrancar."""
    root = tmp_path / "almacen"
    (root / "incoming").mkdir(parents=True, mode=0o700)
    (root / "lotes" / str(TENANT_A)).mkdir(parents=True, mode=0o700)
    os.chmod(tmp_path, 0o700)
    os.chmod(root, 0o700)
    at_boot = root / "lotes" / str(TENANT_A) / "1"
    at_boot.mkdir(mode=0o700)
    (at_boot / "cabecera").write_bytes(b"vencida antes de arrancar")
    age_copy(at_boot)
    log_path = tmp_path / "uvicorn.log"
    port = free_port()
    environment = {
        **api_server.environment,
        "EQUITAS_IMPORT_TMP_DIR": str(root),
        "EQUITAS_IMPORT_PURGE_SECONDS": "1",
    }
    with log_path.open("wb") as log:
        process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "api.main:app", "--host", "127.0.0.1",
             "--port", str(port), "--log-level", "info"],
            cwd=BACK, env=environment, stdout=log, stderr=subprocess.STDOUT,
        )
    try:
        wait_for_port(port, process)
        # Reinicio: lo vencido mientras no corría se fue al arrancar.
        assert not at_boot.exists()
        while_idle = root / "lotes" / str(TENANT_A) / "2"
        while_idle.mkdir(mode=0o700)
        (while_idle / "cabecera").write_bytes(b"vence con el proceso inactivo")
        age_copy(while_idle)
        deadline = time.monotonic() + 15
        while while_idle.exists() and time.monotonic() < deadline:
            time.sleep(0.1)
        assert not while_idle.exists()
    finally:
        process.terminate()
        process.wait(timeout=20)


# ---- Ciclo 2, R1 y R2: carreras con un orden fijado, contra Auth, PostgREST y uvicorn reales


class BarrierServer:
    def __init__(self, api_server, tmp_path, point, *, purge_seconds="3600"):
        self.point = point
        self.directory = tmp_path / "barreras"
        self.directory.mkdir(mode=0o700)
        self.root = tmp_path / "almacen"
        self.log_path = tmp_path / "uvicorn.log"
        self.port = free_port()
        self.url = f"http://127.0.0.1:{self.port}"
        os.chmod(tmp_path, 0o700)
        self.environment = {
            **api_server.environment,
            "EQUITAS_IMPORT_TMP_DIR": str(self.root),
            "EQUITAS_IMPORT_PURGE_SECONDS": purge_seconds,
            "EQUITAS_TEST_BARRIER_DIR": str(self.directory),
            "EQUITAS_TEST_BARRIER": point,
            "PYTHONPATH": str(BACK),
        }

    def __enter__(self):
        with self.log_path.open("wb") as log:
            self.process = subprocess.Popen(
                [sys.executable, "-m", "uvicorn", "--app-dir", str(Path(__file__).parent),
                 "app_with_barriers:app", "--host", "127.0.0.1", "--port", str(self.port),
                 "--log-level", "info"],
                cwd=BACK, env=self.environment, stdout=log, stderr=subprocess.STDOUT,
            )
        wait_for_port(self.port, self.process)
        return self

    def __exit__(self, *_):
        self.resume()
        self.process.terminate()
        self.process.wait(timeout=20)

    def wait_paused(self):
        marker = self.directory / f"{self.point}.paused"
        deadline = time.monotonic() + 60
        while not marker.exists():
            assert time.monotonic() < deadline, "La barrera no se alcanzó"
            time.sleep(0.01)

    def resume(self):
        (self.directory / f"{self.point}.resume").touch()

    def copy(self, identifier):
        return self.root / "lotes" / str(TENANT_A) / str(identifier)

    def client(self):
        return httpx.Client(base_url=self.url, trust_env=False, timeout=120)


def send_batch(server, token, key):
    body, content_type = batch()
    with server.client() as client:
        return client.post(
            "/imports",
            content=body,
            headers={**bearer(token), **content_type, "Idempotency-Key": key},
        )


def test_r1_pending_creation_does_not_bring_back_a_discarded_copy(api_server, login, tmp_path):
    token = login("importador")
    key = str(uuid.uuid4())
    with BarrierServer(api_server, tmp_path, "settle") as server:
        with concurrent.futures.ThreadPoolExecutor(1) as pool:
            pending = pool.submit(send_batch, server, token, key)
            server.wait_paused()
            retry = send_batch(server, token, key)
            assert retry.status_code == 200
            assert retry.json()["copy_available"] is True
            identifier = retry.json()["id"]
            with server.client() as client:
                discarded = client.post(f"/imports/{identifier}/discard", headers=bearer(token))
            assert discarded.status_code == 200
            assert discarded.json()["status"] == "DESCARTADO"
            assert not server.copy(identifier).exists()
            server.resume()
            first = pending.result(timeout=60)
        assert first.status_code == 201
        assert first.json()["status"] == "DESCARTADO"
        assert first.json()["copy_available"] is False
        assert not server.copy(identifier).exists()
        with server.client() as client:
            state = client.get(f"/imports/{identifier}", headers=bearer(token)).json()
        assert state["copy_available"] is False
        again = send_batch(server, token, key)
        assert (again.status_code, again.json()["copy_available"]) == (200, False)
        assert not server.copy(identifier).exists()
        assert rows_with_key(key) == "1"
        assert batch_rows(identifier) == "2"
        assert list((server.root / "incoming").iterdir()) == []


def test_r1_discard_and_retry_wait_for_an_installation_in_progress(api_server, login, tmp_path):
    """Pausa dentro de la instalación: los demás esperan, y el resultado es el mismo."""
    token = login("importador")
    key = str(uuid.uuid4())
    with BarrierServer(api_server, tmp_path, "commit") as server:
        with concurrent.futures.ThreadPoolExecutor(3) as pool:
            pending = pool.submit(send_batch, server, token, key)
            server.wait_paused()
            identifier = int(psql(
                f"select id from public.import_batch where idempotency_key = '{key}'"
            ).strip())

            def discard():
                with server.client() as client:
                    return client.post(f"/imports/{identifier}/discard", headers=bearer(token))

            retrying = pool.submit(send_batch, server, token, key)
            discarding = pool.submit(discard)
            with pytest.raises(concurrent.futures.TimeoutError):
                discarding.result(timeout=1.5)
            assert batch_rows(identifier) == "1", "El descarte no debe adelantarse a la instalación"
            server.resume()
            first, retried, discarded = pending.result(60), retrying.result(60), discarding.result(60)
        assert first.status_code == 201
        assert retried.status_code == 200
        assert discarded.status_code == 200
        assert not server.copy(identifier).exists()
        with server.client() as client:
            state = client.get(f"/imports/{identifier}", headers=bearer(token)).json()
        assert state["status"] == "DESCARTADO"
        assert state["copy_available"] is False


def test_r2_stale_purge_decision_does_not_delete_the_new_copy(api_server, login, tmp_path):
    token = login("importador")
    key = str(uuid.uuid4())
    with BarrierServer(api_server, tmp_path, "expired", purge_seconds="1") as server:
        created = send_batch(server, token, key)
        assert created.status_code == 201
        identifier = created.json()["id"]
        age_copy(server.copy(identifier))
        # La purga periódica decide que venció y queda detenida antes de retirarla.
        server.wait_paused()
        retry = send_batch(server, token, key)
        assert retry.status_code == 200
        assert retry.json()["copy_available"] is True
        count = server.directory / "purges.count"
        finished = int(count.read_text())
        server.resume()
        deadline = time.monotonic() + 30
        while int(count.read_text()) <= finished:
            assert time.monotonic() < deadline, "La purga detenida no terminó"
            time.sleep(0.01)
        with server.client() as client:
            state = client.get(f"/imports/{identifier}", headers=bearer(token)).json()
        assert state["copy_available"] is True
        assert_whole_copy(server.copy(identifier))
        assert rows_with_key(key) == "1"


def test_race_real_retries_and_discards_at_once_end_without_a_copy(login, api_server):
    token = login("importador")
    key = str(uuid.uuid4())
    identifier = post_batch(http_client_for(api_server), token, headers={"Idempotency-Key": key}).json()["id"]
    body, content_type = batch()

    def retry(_):
        with httpx.Client(base_url=api_server.url, trust_env=False, timeout=60) as client:
            return client.post(
                "/imports", content=body,
                headers={**bearer(token), **content_type, "Idempotency-Key": key},
            )

    def discard(_):
        with httpx.Client(base_url=api_server.url, trust_env=False, timeout=60) as client:
            return client.post(f"/imports/{identifier}/discard", headers=bearer(token))

    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        retries = [pool.submit(retry, index) for index in range(5)]
        discards = [pool.submit(discard, index) for index in range(3)]
        results = [future.result(60) for future in (*retries, *discards)]
    assert {response.status_code for response in results} == {200}
    assert batch_rows(identifier) == "2"
    assert not copy_dir(api_server, identifier).exists()


def http_client_for(api_server):
    return httpx.Client(base_url=api_server.url, trust_env=False, timeout=60)


# ---- Ciclo 2, R3: el número del cliente no llega a los registros de la infraestructura

INFRASTRUCTURE = (
    "supabase_kong_equitas-tp-testing",
    "supabase_rest_equitas-tp-testing",
    "supabase_auth_equitas-tp-testing",
    "supabase_db_equitas-tp-testing",
)


def docker_logs(container: str, since: float) -> str:
    done = subprocess.run(
        ["docker", "logs", "--since", str(int(since) - 1), container],
        capture_output=True, check=False,
    )
    return (done.stdout + done.stderr).decode(errors="replace")


def flushed_infrastructure_logs(env, since: float) -> dict[str, str]:
    """Una marca directa a Kong confirma que su registro ya llegó y que esta captura ve la
    consulta de una URL: sin ese control positivo, una captura vacía parecería un acierto."""
    marker = f"marca{uuid.uuid4().hex}"
    response = httpx.get(
        f"{env['API_URL']}/rest/v1/role",
        params={"select": "id", "limit": "1", "nota": f"eq.{marker}"},
        headers={"apikey": env["PUBLISHABLE_KEY"]},
        trust_env=False,
    )
    assert response.status_code in {200, 400}
    deadline = time.monotonic() + 20
    while marker not in docker_logs(INFRASTRUCTURE[0], since):
        assert time.monotonic() < deadline, "La marca no llegó al registro de Kong"
        time.sleep(0.1)
    return {container: docker_logs(container, since) for container in INFRASTRUCTURE}


def fresh_number() -> str:
    return f"2{uuid.uuid4().int % 10**10:010d}"


def test_r3_number_of_the_client_does_not_reach_kong_postgrest_auth_or_the_database(
    http, env, login
):
    since = time.time()
    number = fresh_number()
    token = login("importador")
    operator = login("operador")
    headers = bearer(token)
    identifier = post_batch(http, token).json()["id"]
    assert http.get(f"/imports/{number}", headers=headers).status_code == 404
    assert http.get(f"/imports/000{number}", headers=headers).status_code == 404
    assert http.post(f"/imports/{number}/discard", headers=headers).status_code == 404
    other = bearer(login("otro-importador"))
    assert http.get(f"/imports/{number}", headers=other).status_code == 404
    assert http.get(f"/imports/{identifier}", headers=other).status_code == 404
    scoring = http.get(
        "/case-groups",
        params={**ASOF, "search": number, "group_key": number, "severity_band": number, "tag": number},
        headers=bearer(operator),
    )
    assert scoring.status_code == 200
    # También con errores que la base rechaza: una clave repetida con otro contenido.
    key = f"{number[:8]}-{number[8:]}0-4000-8000-000000000000"
    assert post_batch(http, token, headers={"Idempotency-Key": key}).status_code == 201
    conflict = post_batch(http, token, cabecera=number.encode(), headers={"Idempotency-Key": key})
    assert conflict.status_code == 409
    logs = flushed_infrastructure_logs(env, since)
    assert "/rest/v1/import_batch" in logs[INFRASTRUCTURE[0]], "Kong debe haber registrado la lectura"
    assert f"tenant=eq.{TENANT_A}" in logs[INFRASTRUCTURE[0]]
    for container, text in logs.items():
        assert number not in text, container
        assert number[:8] not in text, container
        assert token not in text, container
    assert f"id=eq.{identifier}" not in logs[INFRASTRUCTURE[0]]


def test_r3_control_a_number_in_a_url_is_visible_in_the_capture(env):
    """Si esta captura no viera el dato, la prueba anterior no probaría nada."""
    since = time.time()
    number = fresh_number()
    httpx.get(
        f"{env['API_URL']}/rest/v1/import_batch",
        params={"select": "id", "id": f"eq.{number}"},
        headers={"apikey": env["PUBLISHABLE_KEY"]},
        trust_env=False,
    )
    logs = flushed_infrastructure_logs(env, since)
    assert number in logs[INFRASTRUCTURE[0]]


def test_expired_temporary_is_purged_on_the_next_upload(http, login, api_server):
    token = login("importador")
    identifier = post_batch(http, token).json()["id"]
    directory = api_server.store_root / "lotes" / str(TENANT_A) / str(identifier)
    old = time.time() - 86_401
    os.utime(directory, (old, old))
    assert post_batch(http, token).status_code == 201
    assert not directory.exists()


# ---- Registros y errores


def test_logs_and_errors_carry_no_sentinels_or_credentials(http, login, api_server, accounts, import_jwt):
    token = login("importador")
    responses = [
        post_batch(
            http,
            token,
            ("campo_libre", SENTINELS["field"].encode(), None),
            headers={"X-Otro": SENTINELS["header"]},
            params={"nota": SENTINELS["query"]},
        ),
        post_batch(http, token, as_of=SENTINELS["as_of"].encode()),
        post_batch(http, token, ("otro", SENTINELS["file_person"].encode(), SENTINELS["filename"])),
        http.get(
            "/case-groups",
            params={**ASOF, "search": SENTINELS["query"]},
            headers=bearer(login("operador")),
        ),
        http.get(
            "/case-groups",
            params={"as_of": SENTINELS["as_of"], "limit": SENTINELS["query"]},
            headers=bearer(login("operador")),
        ),
        http.get("/imports/" + SENTINELS["query"], headers=bearer(token)),
        http.post(
            "/imports",
            content=SENTINELS["file_person"].encode(),
            headers={
                **bearer(token),
                "Idempotency-Key": str(uuid.uuid4()),
                "Content-Type": f"multipart/form-data; boundary={SENTINELS['header']}",
            },
        ),
    ]
    assert responses[0].status_code == 201
    assert responses[1].status_code == 422
    for response in responses:
        for sentinel in SENTINELS.values():
            assert sentinel not in response.text
    logs = api_server.logs()
    assert "GET /case-groups HTTP" in logs, "El registro de acceso debe estar activo"
    assert "IMPORT_RECIBIDO" in logs
    for sentinel in SENTINELS.values():
        assert sentinel not in logs, sentinel
    assert "CENTINELA_A052" not in logs
    for credential in (token, import_jwt, *[password for _, password in accounts.values()]):
        assert credential not in logs
    assert "Traceback" not in logs
    assert str(api_server.store_root) not in logs


# ---- Ciclo 1, B3: ningún dato del cliente llega a los registros, con o sin sesión

NUMERIC = "20000000000"


def raw_exchange(url: str, request: str) -> bytes:
    host, port = url.removeprefix("http://").split(":")
    with socket.create_connection((host, int(port)), timeout=10) as connection:
        connection.sendall(request.encode())
        try:
            return connection.recv(200)
        except OSError:
            return b""


def numeric_requests(url: str) -> dict[str, str]:
    host = url.removeprefix("http://")
    common = f"Host: {host}\r\nConnection: close\r\n"
    return {
        "segmento": f"GET /imports/{NUMERIC} HTTP/1.1\r\n{common}\r\n",
        "ruta inexistente": f"GET /no-existe/{NUMERIC} HTTP/1.1\r\n{common}\r\n",
        "ceros iniciales": f"POST /imports/000{NUMERIC}/discard HTTP/1.1\r\n{common}Content-Length: 0\r\n\r\n",
        "consulta": f"GET /health?dni={NUMERIC} HTTP/1.1\r\n{common}\r\n",
        "x-forwarded-for": f"GET /health HTTP/1.1\r\n{common}X-Forwarded-For: {NUMERIC}\r\n\r\n",
        "metodo": f"X{NUMERIC} /health HTTP/1.1\r\n{common}\r\n",
        "host": f"GET /health HTTP/1.1\r\nHost: {NUMERIC}\r\nConnection: close\r\n\r\n",
        "websocket": (
            f"GET /imports/{NUMERIC}?dni={NUMERIC} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\n"
            "Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        ),
        "http invalido": f"GET /{NUMERIC} HTTP/9.9 basura\r\n\r\n",
    }


def test_b3_numeric_data_without_a_session_stays_out_of_the_logs(api_server):
    before = len(api_server.logs())
    for name, request in numeric_requests(api_server.url).items():
        assert raw_exchange(api_server.url, request), name
    time.sleep(0.5)
    logs = api_server.logs()[before:]
    assert '"GET /imports/<x> HTTP' in logs, "El registro de acceso debe estar activo"
    assert NUMERIC not in logs


@pytest.mark.parametrize("level", ["debug", "trace"])
def test_b3_most_verbose_levels_do_not_print_client_data_or_tokens(api_server, login, tmp_path, level):
    log_path = tmp_path / f"uvicorn-{level}.log"
    port = free_port()
    url = f"http://127.0.0.1:{port}"
    with log_path.open("wb") as log:
        process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "api.main:app", "--host", "127.0.0.1",
             "--port", str(port), "--log-level", level, "--access-log"],
            cwd=BACK, env=api_server.environment, stdout=log, stderr=subprocess.STDOUT,
        )
    token = login("operador")
    try:
        wait_for_port(port, process)
        for request in numeric_requests(url).values():
            raw_exchange(url, request)
        response = httpx.get(
            f"{url}/case-groups",
            params={**ASOF, "search": NUMERIC},
            headers=bearer(token),
            trust_env=False,
            timeout=30,
        )
        assert response.status_code == 200
    finally:
        process.terminate()
        process.wait(timeout=20)
    logs = log_path.read_text(encoding="utf-8", errors="replace")
    assert "Application startup complete" in logs
    assert NUMERIC not in logs
    assert token not in logs
    assert "Bearer" not in logs


def test_unhandled_error_gives_500_and_uvicorn_prints_no_traceback(api_server, login, tmp_path):
    """Uvicorn imprime el traceback real si nadie lo impide. Se usa el servidor de verdad."""
    log_path = tmp_path / "uvicorn.log"
    port = free_port()
    with log_path.open("wb") as log:
        process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "--app-dir", str(Path(__file__).parent), "app_with_failure:app", "--host", "127.0.0.1",
             "--port", str(port), "--log-level", "debug"],
            cwd=BACK, env=api_server.environment, stdout=log, stderr=subprocess.STDOUT,
        )
    try:
        wait_for_port(port, process)
        response = httpx.get(
            f"http://127.0.0.1:{port}/falla-sin-tratar",
            headers=bearer(login("operador")),
            trust_env=False,
            timeout=30,
        )
    finally:
        process.terminate()
        process.wait(timeout=20)
    assert response.status_code == 500
    assert response.json() == {"detail": "INTERNAL_ERROR"}
    logs = log_path.read_text(encoding="utf-8", errors="replace")
    assert "ERROR_NO_TRATADO clase=RuntimeError" in logs
    assert "CENTINELA_A052_EXCEPCION" not in logs
    assert "Traceback" not in logs
