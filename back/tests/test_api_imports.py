"""ALIGN-052: recepción de lotes por streaming, temporal privado, consulta y descarte."""

import asyncio
import errno
import hashlib
import logging
import os
import random
import shutil
import stat
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

import httpx
import jwt
import pytest
from fastapi.testclient import TestClient
from fake_supabase_http import (
    AUTH_CONSULTA,
    AUTH_IMPORTADOR,
    AUTH_MULTI,
    AUTH_OPERADOR,
    AUTH_OTRO_IMPORTADOR,
    AUTH_REVOCADO,
    AUTH_SIN_MEMBRESIA,
    AUTH_SISTEMA,
    AUTH_SUPERVISOR,
    IMPORT_JWT,
    PUBLISHABLE_KEY,
    TENANT_A,
    TENANT_B,
    URL,
    FakeSupabase,
)

from api import auth, imports, main
from api import upload_store as store_module
from api.multipart import MultipartError, PartEnd, PartStart, multipart_events
from api.upload_store import UploadStore, UploadStoreError

BOUNDARY = "----equitasLimiteSintetico"
CENTINELA = b"CENTINELA_PERSONA_ALIGN052;20-00000000-0;correo@example.invalid\n"


def form(*parts, boundary=BOUNDARY, end=True) -> bytes:
    body = b""
    for name, value, filename in parts:
        disposition = f'form-data; name="{name}"'
        if filename is not None:
            disposition += f'; filename="{filename}"'
        body += f"--{boundary}\r\nContent-Disposition: {disposition}\r\n".encode()
        if filename is not None:
            body += b"Content-Type: application/octet-stream\r\n"
        body += b"\r\n" + value + b"\r\n"
    return body + (f"--{boundary}--\r\n".encode() if end else b"")


CABECERA = b"Cuenta\tNombre\n1\t" + CENTINELA
DETALLE = b"Cuenta\tDEUD_id\n1\t9\n"


def batch_form(*extra, cabecera=CABECERA, detalle=DETALLE, as_of=b"2026-09-30") -> bytes:
    return form(
        ("as_of", as_of, None),
        ("cabecera", cabecera, "CENTINELA_NOMBRE_ARCHIVO.tsv"),
        ("detalle", detalle, "detalle.tsv"),
        *extra,
    )


MULTIPART = {"Content-Type": f"multipart/form-data; boundary={BOUNDARY}"}


@pytest.fixture
def supabase(monkeypatch, tmp_path) -> FakeSupabase:
    fake = FakeSupabase()
    monkeypatch.setenv("EQUITAS_TARGET_ENV", "local")
    monkeypatch.setenv("SUPABASE_URL", URL)
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", PUBLISHABLE_KEY)
    monkeypatch.setenv("EQUITAS_IMPORT_SERVER_JWT", IMPORT_JWT)
    monkeypatch.setenv("EQUITAS_IMPORT_TMP_DIR", str(tmp_path / "almacen"))
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


@pytest.fixture
def store(tmp_path) -> UploadStore:
    return UploadStore(tmp_path / "almacen")


def auth_headers(supabase, user=AUTH_IMPORTADOR) -> dict[str, str]:
    return {"Authorization": f"Bearer {supabase.token(user)}"}


def new_key() -> dict[str, str]:
    return {"Idempotency-Key": str(uuid.uuid4())}


def upload(client, supabase, body=None, *, user=AUTH_IMPORTADOR, headers=None, **kwargs):
    return client.post(
        "/imports",
        content=batch_form() if body is None else body,
        headers={**auth_headers(supabase, user), **MULTIPART, **new_key(), **(headers or {})},
        **kwargs,
    )


def stored_files(root) -> list:
    """Bytes de archivos recibidos: los archivos de exclusión no guardan nada."""
    return sorted(
        path for path in root.rglob("*") if path.is_file() and "bloqueos" not in path.parts
    )


# ---- Parser


def parse(body: bytes, *, chunk=None, boundary=BOUNDARY, **limits):
    async def stream():
        step = chunk or len(body) or 1
        for start in range(0, len(body), step):
            yield body[start : start + step]

    async def run():
        result = []
        async for event in multipart_events(stream(), boundary.encode(), **limits):
            result.append(event)
        return result

    return asyncio.run(run())


def collect(events):
    parts, current = [], None
    for event in events:
        if isinstance(event, PartStart):
            current = [event.name, event.filename, b""]
        elif isinstance(event, PartEnd):
            parts.append(tuple(current))
            current = None
        else:
            current[2] += event
    return parts


@pytest.mark.parametrize("chunk", [1, 2, 3, 7, 64, 1024, None])
def test_parser_reassembles_any_chunking(chunk):
    binary = bytes(range(256)) * 8 + b"\r\n--" + BOUNDARY.encode()[:-1] + b"\r\n--" + b"\r\n"
    body = form(("as_of", b"2026-09-30", None), ("cabecera", binary, "a.bin"), ("vacio", b"", None))
    assert collect(parse(body, chunk=chunk)) == [
        ("as_of", None, b"2026-09-30"),
        ("cabecera", "a.bin", binary),
        ("vacio", None, b""),
    ]


def test_parser_random_binary_roundtrip():
    rng = random.Random(52)
    for _ in range(60):
        data = rng.randbytes(rng.randrange(0, 4000))
        body = form(("cabecera", data, "x"))
        assert collect(parse(body, chunk=rng.randrange(1, 300)))[0][2] == data


def test_parser_accepts_an_empty_form_and_ignores_the_epilogue():
    assert parse(f"--{BOUNDARY}--\r\n".encode()) == []
    assert collect(parse(form(("a", b"1", None)) + b"epilogo"))[0][2] == b"1"


HOSTILE = {
    "vacio": b"",
    "sin delimitador": b"hola",
    "preambulo": b"basura\r\n" + form(("a", b"1", None)),
    "sin terminador": form(("a", b"1", None), end=False),
    "cortado en el cuerpo": f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="a"\r\n\r\nvalor'.encode(),
    "cortado en encabezados": f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="a"'.encode(),
    "sin nombre": f"--{BOUNDARY}\r\nContent-Disposition: form-data\r\n\r\n1\r\n--{BOUNDARY}--\r\n".encode(),
    "sin disposicion": f"--{BOUNDARY}\r\nContent-Type: text/plain\r\n\r\n1\r\n--{BOUNDARY}--\r\n".encode(),
    "otra disposicion": f'--{BOUNDARY}\r\nContent-Disposition: attachment; name="a"\r\n\r\n1\r\n--{BOUNDARY}--\r\n'.encode(),
    "nombre duplicado": f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="a"; name="b"\r\n\r\n1\r\n--{BOUNDARY}--\r\n'.encode(),
    "disposicion duplicada": (
        f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="a"\r\n'
        f'Content-Disposition: form-data; name="b"\r\n\r\n1\r\n--{BOUNDARY}--\r\n'
    ).encode(),
    "encabezado sin dos puntos": f"--{BOUNDARY}\r\nbasura\r\n\r\n1\r\n--{BOUNDARY}--\r\n".encode(),
    "parametro roto": f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="a\r\n\r\n1\r\n--{BOUNDARY}--\r\n'.encode(),
    "delimitador seguido de basura": f'--{BOUNDARY}X\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--{BOUNDARY}--\r\n'.encode(),
    "cierre con basura": (
        f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--{BOUNDARY}XY'
    ).encode(),
    "cortado con guiones": f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="a"\r\n\r\n--x'.encode(),
    "otro delimitador": b"X" * (len(BOUNDARY) + 2) + b"--\r\n",
    "codificacion de transferencia": (
        f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="a"\r\n'
        f"Content-Transfer-Encoding: base64\r\n\r\nMQ==\r\n--{BOUNDARY}--\r\n"
    ).encode(),
}


@pytest.mark.parametrize("case", sorted(HOSTILE))
@pytest.mark.parametrize("chunk", [1, None])
def test_parser_rejects_malformed_input_without_echoing_it(case, chunk):
    with pytest.raises(MultipartError) as error:
        parse(HOSTILE[case], chunk=chunk)
    assert error.value.code == "MULTIPART_INVALIDO"
    assert "basura" not in str(error.value)


def test_parser_emits_bytes_as_they_arrive_and_holds_only_the_marker_tail():
    """Es el motivo de existir de este lector: un archivo grande no se arma en memoria."""
    chunk = b"x" * 1_000_000
    head = f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="a"; filename="f"\r\n\r\n'.encode()
    consumed = []
    tail = f"\r\n--{BOUNDARY}--\r\n".encode()

    async def stream():
        yield head
        for index in range(5):
            consumed.append(index)
            yield chunk
        yield tail

    async def run():
        pending = []
        async for event in multipart_events(stream(), BOUNDARY.encode()):
            if isinstance(event, bytes):
                pending.append((len(consumed), len(event)))
        return pending

    pending = asyncio.run(run())
    assert pending[0][0] == 1, "El primer trozo debe salir antes de pedir el segundo"
    assert all(size <= len(chunk) + len(BOUNDARY) + 4 for _, size in pending)
    assert sum(size for _, size in pending) == 5 * len(chunk)


def test_parser_limits_headers_and_parts():
    long_header = (
        f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="a"\r\nX-Relleno: '.encode()
        + b"a" * 9000
        + f"\r\n\r\n1\r\n--{BOUNDARY}--\r\n".encode()
    )
    with pytest.raises(MultipartError):
        parse(long_header)
    many = form(*[(f"a{i}", b"1", None) for i in range(5)])
    with pytest.raises(MultipartError) as error:
        parse(many, max_parts=4)
    assert error.value.code == "MULTIPART_DEMASIADAS_PARTES"
    assert len(collect(parse(many, max_parts=5))) == 5


def test_parser_decodes_quoted_parameters_and_keeps_unicode_filenames():
    body = (
        f'--{BOUNDARY}\r\nContent-Disposition: form-data; name=sin_comillas; filename="a\\"b;c.tsv"\r\n\r\nx\r\n--{BOUNDARY}--\r\n'
    ).encode()
    assert collect(parse(body)) == [("sin_comillas", 'a"b;c.tsv', b"x")]


# ---- Almacén temporal


def test_store_uses_private_modes(store):
    token = store.begin()
    with store.open_part(token, "cabecera") as handle:
        handle.write(b"x")
    assert stat.S_IMODE(store.root.stat().st_mode) == 0o700
    assert stat.S_IMODE((store.root / "incoming" / token).stat().st_mode) == 0o700
    assert stat.S_IMODE((store.root / "incoming" / token / "cabecera").stat().st_mode) == 0o600
    assert store.commit(token, 1, 9) is True
    assert stat.S_IMODE((store.root / "lotes" / "1" / "9").stat().st_mode) == 0o700
    assert list(store.files(1, 9)) == ["cabecera"]


def test_store_rejects_shared_directory_or_symlink(tmp_path):
    shared = tmp_path / "compartido"
    shared.mkdir()
    os.chmod(shared, 0o755)
    with pytest.raises(UploadStoreError):
        UploadStore(shared)
    target = tmp_path / "destino"
    target.mkdir(mode=0o700)
    link = tmp_path / "enlace"
    link.symlink_to(target)
    with pytest.raises(UploadStoreError):
        UploadStore(link)
    occupied = tmp_path / "archivo"
    occupied.write_bytes(b"x")
    with pytest.raises(UploadStoreError):
        UploadStore(occupied)


def test_store_does_not_follow_a_planted_symlink(store, tmp_path):
    token = store.begin()
    outside = tmp_path / "fuera"
    outside.write_bytes(b"original")
    (store.root / "incoming" / token / "cabecera").symlink_to(outside)
    with pytest.raises(OSError):
        store.open_part(token, "cabecera")
    assert outside.read_bytes() == b"original"


def test_store_rejects_foreign_tokens_kinds_and_ids(store):
    for token in ("../../etc", "", "x" * 32, "A" * 32):
        with pytest.raises(UploadStoreError):
            store.open_part(token, "cabecera")
    token = store.begin()
    with pytest.raises(UploadStoreError):
        store.open_part(token, "../fuera")
    with pytest.raises(UploadStoreError):
        store.commit(token, 0, 1)
    with pytest.raises(UploadStoreError):
        store.files(True, 1)


def test_store_commit_is_not_applied_twice_and_keeps_the_first_file(store):
    first = store.begin()
    with store.open_part(first, "cabecera") as handle:
        handle.write(b"primero")
    assert store.commit(first, 1, 9) is True
    second = store.begin()
    with store.open_part(second, "cabecera") as handle:
        handle.write(b"segundo")
    assert store.commit(second, 1, 9) is False
    assert store.files(1, 9)["cabecera"].read_bytes() == b"primero"
    store.discard(second)
    assert list((store.root / "incoming").iterdir()) == []


def test_store_release_is_idempotent(store):
    token = store.begin()
    with store.open_part(token, "cabecera") as handle:
        handle.write(b"x")
    store.commit(token, 1, 9)
    store.release(1, 9)
    store.release(1, 9)
    assert store.files(1, 9) == {}


def test_store_purges_only_what_expired(tmp_path):
    now = [1_000_000.0]
    store = UploadStore(tmp_path / "almacen", ttl_seconds=100, clock=lambda: now[0])
    old_incoming = store.begin()
    old = store.begin()
    with store.open_part(old, "cabecera") as handle:
        handle.write(b"x")
    store.commit(old, 1, 1)
    now[0] += 100
    assert store.purge_expired() == 2
    assert store.files(1, 1) == {}
    assert not (store.root / "incoming" / old_incoming).exists()
    fresh = store.begin()
    with store.open_part(fresh, "cabecera") as handle:
        handle.write(b"x")
    store.commit(fresh, 1, 2)
    now[0] += 99
    assert store.purge_expired() == 0
    assert list(store.files(1, 2)) == ["cabecera"]


def test_store_purge_survives_planted_symlinks_and_files(store, tmp_path):
    outside = tmp_path / "victima"
    outside.mkdir()
    (outside / "dato").write_bytes(b"x")
    (store.root / "lotes" / "suelto").write_bytes(b"x")
    os.mkdir(store.root / "lotes" / "1")
    (store.root / "lotes" / "1" / "enlace").symlink_to(outside)
    store.ttl_seconds = 0
    store.purge_expired()
    assert (outside / "dato").exists()


def test_store_default_root_is_private_and_outside_the_repository(monkeypatch, tmp_path):
    monkeypatch.delenv("EQUITAS_IMPORT_TMP_DIR", raising=False)
    monkeypatch.setattr(imports.tempfile, "gettempdir", lambda: str(tmp_path))
    store = imports.load_store()
    assert store.root.parent == tmp_path


# ---- POST /imports


def test_upload_creates_a_received_batch_and_a_private_copy(client, supabase, store):
    response = upload(client, supabase)
    assert response.status_code == 201
    body = response.json()
    assert body["id"] == body["root_id"] == 1
    assert body["status"] == "RECIBIDO"
    assert body["created"] is True
    assert body["tenant"] == TENANT_A
    assert body["as_of"] == "2026-09-30"
    assert body["file_hashes"] == {
        "cabecera": hashlib.sha256(CABECERA).hexdigest(),
        "detalle": hashlib.sha256(DETALLE).hexdigest(),
    }
    row = supabase.tables["import_batch"][0]
    assert row["status"] == "RECIBIDO"
    assert row["created_by"] == 4
    assert row["source"] == "WEB_UPLOAD"
    assert row["counts"] == {"archivos": 2, "bytes": len(CABECERA) + len(DETALLE)}
    files = store.files(TENANT_A, 1)
    assert files["cabecera"].read_bytes() == CABECERA
    assert files["detalle"].read_bytes() == DETALLE
    # Nada del archivo, su nombre ni su ruta vuelve al cliente.
    assert "CENTINELA" not in response.text
    assert str(store.root) not in response.text


def test_write_uses_the_dedicated_credential_and_not_the_session(client, supabase):
    upload(client, supabase)
    rpc = next(c for c in supabase.calls if c.url.path.endswith("record_import_batch"))
    assert rpc.headers["authorization"] == f"Bearer {IMPORT_JWT}"
    assert rpc.headers["apikey"] == PUBLISHABLE_KEY


def test_upload_accepts_a_single_workbook(client, supabase, store):
    response = upload(client, supabase, form(("as_of", b"2026-09-30", None), ("libro", b"PK..", "l.xlsx")))
    assert response.status_code == 201
    assert list(response.json()["file_hashes"]) == ["libro"]
    assert list(store.files(TENANT_A, 1)) == ["libro"]


def test_upload_records_the_declared_source_update(client, supabase):
    upload(client, supabase, batch_form(("source_updated_at", b"2026-09-01", None)))
    assert supabase.tables["import_batch"][0]["source_updated_at"] == "2026-09-01"


@pytest.mark.parametrize(
    "extra",
    [
        {"body_fields": [("tenant", b"2", None), ("tenant_id", b"2", None), ("p_tenant", b"2", None)]},
        {"params": {"tenant": "2", "tenant_id": "2"}},
        {"headers": {"X-Tenant": "2", "X-Tenant-Id": "2"}},
    ],
)
def test_tenant_sent_by_the_client_is_ignored(client, supabase, store, extra):
    response = upload(
        client,
        supabase,
        batch_form(*extra.get("body_fields", [])),
        headers=extra.get("headers"),
        params=extra.get("params"),
    )
    assert response.status_code == 201
    assert response.json()["tenant"] == TENANT_A
    row = supabase.tables["import_batch"][0]
    assert row["tenant"] == TENANT_A
    assert list(store.files(TENANT_B, 1)) == []


@pytest.mark.parametrize(
    ("user", "status", "code"),
    [
        (AUTH_CONSULTA, 403, "ROLE_FORBIDDEN"),
        (AUTH_OPERADOR, 403, "ROLE_FORBIDDEN"),
        (AUTH_SUPERVISOR, 403, "ROLE_FORBIDDEN"),
        (AUTH_SISTEMA, 403, "ROLE_FORBIDDEN"),
        (AUTH_SIN_MEMBRESIA, 403, "MEMBERSHIP_REQUIRED"),
        (AUTH_REVOCADO, 403, "MEMBERSHIP_REQUIRED"),
        (AUTH_MULTI, 409, "TENANT_SELECTION_REQUIRED"),
    ],
)
def test_upload_denied_before_reading_the_file(client, supabase, store, user, status, code):
    response = upload(client, supabase, user=user)
    assert response.status_code == status
    assert response.json() == {"detail": code}
    assert supabase.tables["import_batch"] == []
    assert stored_files(store.root) == []


def test_upload_requires_multipart(client, supabase):
    response = client.post(
        "/imports",
        content=b"{}",
        headers={**auth_headers(supabase), "Content-Type": "application/json"},
    )
    assert response.status_code == 415
    assert response.json() == {"detail": "MULTIPART_REQUERIDO"}


@pytest.mark.parametrize(
    "content_type",
    [
        "multipart/form-data",
        "multipart/form-data; boundary=",
        "multipart/form-data; boundary=" + "a" * 71,
        "multipart/mixed; boundary=abc",
        'multipart/form-data; boundary="abc def"',
    ],
)
def test_upload_rejects_unusable_boundaries(client, supabase, content_type):
    response = client.post(
        "/imports",
        content=batch_form(),
        headers={**auth_headers(supabase), "Content-Type": content_type},
    )
    assert response.status_code == 415


def test_upload_accepts_a_quoted_boundary(client, supabase):
    response = client.post(
        "/imports",
        content=batch_form(),
        headers={
            **auth_headers(supabase),
            **new_key(),
            "Content-Type": f'multipart/form-data; boundary="{BOUNDARY}"',
        },
    )
    assert response.status_code == 201


@pytest.mark.parametrize(
    ("body", "code"),
    [
        (form(("cabecera", b"x", "a"), ("detalle", b"y", "b")), "AS_OF_INVALIDO"),
        (batch_form(as_of=b"2026-02-30"), "AS_OF_INVALIDO"),
        (batch_form(as_of=b"CENTINELA_FECHA"), "AS_OF_INVALIDO"),
        (batch_form(("source_updated_at", b"ayer", None)), "SOURCE_UPDATED_AT_INVALIDO"),
        (form(("as_of", b"2026-09-30", None)), "ARCHIVOS_REQUERIDOS"),
        (form(("as_of", b"2026-09-30", None), ("cabecera", b"x", "a")), "ARCHIVOS_REQUERIDOS"),
        (form(("as_of", b"2026-09-30", None), ("detalle", b"x", "a")), "ARCHIVOS_REQUERIDOS"),
        (
            form(
                ("as_of", b"2026-09-30", None),
                ("libro", b"x", "l"),
                ("cabecera", b"x", "a"),
                ("detalle", b"y", "b"),
            ),
            "ARCHIVOS_REQUERIDOS",
        ),
        (batch_form(cabecera=b""), "ARCHIVO_VACIO"),
        (batch_form(("otro", b"x", "o.exe")), "ARCHIVO_NO_ESPERADO"),
        (batch_form(("cabecera", b"x", "dos.tsv")), "ARCHIVO_DUPLICADO"),
        (batch_form(("as_of", b"2026-01-01", None)), "CAMPO_DUPLICADO"),
        (form(("cabecera", b"sin nombre de archivo", None)), "CAMPO_NO_ESPERADO"),
        (b"no es multipart", "MULTIPART_INVALIDO"),
        (form(("as_of", b"2026-09-30", None), end=False), "MULTIPART_INVALIDO"),
    ],
)
def test_invalid_upload_is_rejected_and_leaves_nothing(client, supabase, store, body, code):
    response = upload(client, supabase, body)
    assert response.status_code == 422
    assert response.json() == {"detail": code}
    assert supabase.tables["import_batch"] == []
    assert stored_files(store.root) == []
    assert "CENTINELA" not in response.text


def test_long_unexpected_field_is_rejected(client, supabase):
    response = upload(client, supabase, batch_form(("tenant", b"9" * 5000, None)))
    assert response.status_code == 422
    assert response.json() == {"detail": "CAMPO_EXCEDE_LIMITE"}


def test_declared_oversize_is_rejected_without_reading(client, supabase, store, monkeypatch):
    monkeypatch.setattr(imports, "MAX_REQUEST_BYTES", 100)
    response = upload(client, supabase, b"x" * 101)
    assert response.status_code == 413
    assert response.json() == {"detail": "LIMITE_ARCHIVO_EXCEDIDO"}
    assert stored_files(store.root) == []


def test_declared_size_is_checked_before_reading_the_body(monkeypatch):
    monkeypatch.setattr(imports, "MAX_REQUEST_BYTES", 100)

    async def receive():
        raise AssertionError("No debe leerse el cuerpo")

    def request(length):
        scope = {
            "type": "http",
            "method": "POST",
            "path": "/imports",
            "headers": [(b"content-length", length)],
            "query_string": b"",
        }
        return imports.Request(scope, receive)

    imports._check_declared_size(request(b"100"))
    with pytest.raises(imports.HTTPException) as error:
        imports._check_declared_size(request(b"101"))
    assert error.value.status_code == 413
    with pytest.raises(imports.HTTPException) as error:
        imports._check_declared_size(request(b"x"))
    assert error.value.status_code == 400


def test_invalid_content_length_is_rejected(client, supabase):
    response = upload(client, supabase, headers={"Content-Length": "x"})
    assert response.status_code in {400, 413}


def test_file_over_the_limit_stops_the_upload(client, supabase, store, monkeypatch):
    monkeypatch.setattr(imports, "MAX_FILE_BYTES", 10)
    response = upload(client, supabase, batch_form(cabecera=b"x" * 11, detalle=b"y"))
    assert response.status_code == 413
    assert response.json() == {"detail": "LIMITE_ARCHIVO_EXCEDIDO"}
    assert supabase.tables["import_batch"] == []
    assert stored_files(store.root) == []


def test_file_exactly_at_the_limit_is_accepted(client, supabase, monkeypatch):
    monkeypatch.setattr(imports, "MAX_FILE_BYTES", 10)
    response = upload(client, supabase, batch_form(cabecera=b"x" * 10, detalle=b"y" * 10))
    assert response.status_code == 201


def test_chunked_body_over_the_request_limit_stops(client, supabase, monkeypatch, store):
    monkeypatch.setattr(imports, "MAX_REQUEST_BYTES", 50)

    def chunks():
        for _ in range(100):
            yield b"x" * 10

    response = client.post(
        "/imports",
        content=chunks(),
        headers={**auth_headers(supabase), **MULTIPART, **new_key()},
    )
    assert response.status_code == 413
    assert stored_files(store.root) == []


class _Scope:
    @staticmethod
    def request(receive) -> "imports.Request":
        scope = {
            "type": "http",
            "method": "POST",
            "path": "/imports",
            "headers": [(b"content-type", MULTIPART["Content-Type"].encode())],
            "query_string": b"",
        }
        return imports.Request(scope, receive)


def test_client_disconnect_leaves_nothing(store):
    sequence = [
        {"type": "http.request", "body": batch_form()[:200], "more_body": True},
        {"type": "http.disconnect"},
    ]

    async def receive():
        return sequence.pop(0)

    async def run():
        return await imports._receive_form(_Scope.request(receive), BOUNDARY.encode(), store)

    with pytest.raises(imports.HTTPException) as error:
        asyncio.run(run())
    assert error.value.status_code == 400
    assert error.value.detail == "UPLOAD_INTERRUMPIDO"
    assert stored_files(store.root) == []


def test_slow_upload_times_out_and_leaves_nothing(store, monkeypatch):
    monkeypatch.setattr(imports, "UPLOAD_SECONDS", 0.05)
    first = [{"type": "http.request", "body": batch_form()[:200], "more_body": True}]

    async def receive():
        if first:
            return first.pop(0)
        await asyncio.sleep(5)
        raise AssertionError("El tope de tiempo no actuó")

    async def run():
        return await imports._receive_form(_Scope.request(receive), BOUNDARY.encode(), store)

    with pytest.raises(imports.HTTPException) as error:
        asyncio.run(run())
    assert error.value.status_code == 408
    assert error.value.detail == "UPLOAD_TIEMPO_EXCEDIDO"
    assert stored_files(store.root) == []


def test_replay_with_the_same_key_returns_the_same_batch(client, supabase, store):
    key = str(uuid.uuid4())
    first = upload(client, supabase, headers={"Idempotency-Key": key})
    second = upload(client, supabase, headers={"Idempotency-Key": key})
    assert first.status_code == 201
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["created"] is False
    assert len(supabase.tables["import_batch"]) == 1
    assert len(store.files(TENANT_A, 1)) == 2
    assert list((store.root / "incoming").iterdir()) == []


def test_same_key_with_other_content_conflicts(client, supabase, store):
    key = str(uuid.uuid4())
    upload(client, supabase, headers={"Idempotency-Key": key})
    response = upload(
        client, supabase, batch_form(cabecera=b"otro"), headers={"Idempotency-Key": key}
    )
    assert response.status_code == 409
    assert response.json() == {"detail": "IDEMPOTENCY_KEY_CONFLICT"}
    assert store.files(TENANT_A, 1)["cabecera"].read_bytes() == CABECERA
    assert list((store.root / "incoming").iterdir()) == []


def test_invalid_idempotency_key_is_rejected(client, supabase):
    response = upload(client, supabase, headers={"Idempotency-Key": "CENTINELA"})
    assert response.status_code == 422
    assert response.json() == {"detail": "IDEMPOTENCY_KEY_INVALIDA"}


def test_each_new_key_is_a_new_batch(client, supabase):
    assert upload(client, supabase).json()["id"] == 1
    assert upload(client, supabase).json()["id"] == 2


@pytest.mark.parametrize(
    ("message", "status", "code"),
    [
        ("ACTOR_NOT_ACTIVE_MEMBER", 403, "MEMBERSHIP_REQUIRED"),
        ("ROLE_NOT_ALLOWED", 403, "ROLE_FORBIDDEN"),
        ("IDEMPOTENCY_KEY_CONFLICT", 409, "IDEMPOTENCY_KEY_CONFLICT"),
        ("SUPERSEDES_NOT_FOUND", 409, "SUPERSEDES_NOT_FOUND"),
        ("INVALID_IMPORT_BATCH:import_batch_supersedes_key", 409, "BATCH_ALREADY_SUPERSEDED"),
        ("INVALID_IMPORT_BATCH:import_batch_counts_format", 422, "INVALID_IMPORT_BATCH"),
        ("CENTINELA_ERROR_INESPERADO", 503, "BATCH_WRITE_FAILED"),
    ],
)
def test_write_rejections_are_translated_and_clean_up(client, supabase, store, message, status, code):
    supabase.rpc_message = message
    response = upload(client, supabase)
    assert response.status_code == status
    assert response.json() == {"detail": code}
    assert stored_files(store.root) == []


def test_write_network_failure_is_503(client, supabase, store):
    supabase.raise_on.add("/rest/v1/rpc/record_import_batch")
    response = upload(client, supabase)
    assert response.status_code == 503
    assert response.json() == {"detail": "BATCH_WRITE_FAILED"}
    assert stored_files(store.root) == []


@pytest.mark.parametrize(
    "credential",
    [
        "",
        "no-es-un-jwt",
        jwt.encode({"role": "service_role"}, "s" * 32, "HS256"),
        jwt.encode({"role": "authenticated"}, "s" * 32, "HS256"),
    ],
)
def test_write_requires_the_dedicated_credential(client, supabase, store, monkeypatch, credential):
    monkeypatch.setenv("EQUITAS_IMPORT_SERVER_JWT", credential)
    response = upload(client, supabase)
    assert response.status_code == 503
    assert response.json() == {"detail": "IMPORT_WRITER_NOT_CONFIGURED"}
    assert not any(c.url.path.endswith("record_import_batch") for c in supabase.calls)
    assert stored_files(store.root) == []


def test_insecure_store_is_503_without_paths(client, supabase, tmp_path, monkeypatch):
    shared = tmp_path / "compartido"
    shared.mkdir()
    os.chmod(shared, 0o755)
    monkeypatch.setenv("EQUITAS_IMPORT_TMP_DIR", str(shared))
    response = upload(client, supabase)
    assert response.status_code == 503
    assert response.json() == {"detail": "ALMACEN_TEMPORAL_INSEGURO"}
    assert str(tmp_path) not in response.text


def test_upload_purges_expired_temporaries(client, supabase, store):
    token = store.begin()
    old = store.root / "incoming" / token
    os.utime(old, (1, 1))
    assert upload(client, supabase).status_code == 201
    assert not old.exists()


def test_upload_logs_carry_no_sentinels(client, supabase, caplog):
    with caplog.at_level(logging.DEBUG):
        response = upload(client, supabase)
    assert response.status_code == 201
    assert "CENTINELA" not in caplog.text
    assert "IMPORT_RECIBIDO" in caplog.text


# ---- GET /imports/{id}


def test_batch_reads_filter_by_the_resolved_tenant_with_the_user_token(client, supabase):
    identifier = upload(client, supabase).json()["id"]
    token = supabase.token(AUTH_IMPORTADOR)
    supabase.calls.clear()
    client.get(f"/imports/{identifier}", headers={"Authorization": f"Bearer {token}"})
    reads = [c for c in supabase.calls if c.url.path.endswith("/import_batch")]
    assert reads
    for call in reads:
        assert f"tenant=eq.{TENANT_A}" in str(call.url)
        assert call.headers["authorization"] == f"Bearer {token}"


def test_get_returns_the_batch_without_private_fields(client, supabase):
    identifier = upload(client, supabase).json()["id"]
    response = client.get(f"/imports/{identifier}", headers=auth_headers(supabase))
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == body["root_id"] == identifier
    assert body["status"] == "RECIBIDO"
    assert body["tenant"] == TENANT_A
    assert "created_by" not in body
    assert "idempotency_key" not in body


def test_other_tenant_batch_looks_like_a_missing_one(client, supabase):
    identifier = upload(client, supabase).json()["id"]
    other = auth_headers(supabase, AUTH_OTRO_IMPORTADOR)
    foreign = client.get(f"/imports/{identifier}", headers=other)
    missing = client.get("/imports/999999", headers=other)
    assert foreign.status_code == missing.status_code == 404
    assert foreign.json() == missing.json() == {"detail": "BATCH_NOT_FOUND"}
    discard = client.post(f"/imports/{identifier}/discard", headers=other)
    assert discard.status_code == 404
    assert supabase.tables["import_batch"][-1]["status"] == "RECIBIDO"


def test_multi_tenant_rls_does_not_widen_the_batch_lookup(client, supabase):
    """Aunque RLS muestre la fila, el filtro explícito por el municipio resuelto manda."""
    identifier = supabase.add_batch(TENANT_B, 5, "importador")
    next(m for m in supabase.tables["tenant_user"] if m["user"] == 4)["status"] = True
    supabase.tables["tenant_user"].append(
        {"id": 90, "tenant": TENANT_B, "user": 4, "role": 2, "status": False}
    )
    response = client.get(f"/imports/{identifier}", headers=auth_headers(supabase))
    assert response.status_code == 404


@pytest.mark.parametrize("user", [AUTH_CONSULTA, AUTH_OPERADOR, AUTH_SUPERVISOR])
def test_other_roles_cannot_read_or_discard(client, supabase, user):
    identifier = upload(client, supabase).json()["id"]
    headers = auth_headers(supabase, user)
    assert client.get(f"/imports/{identifier}", headers=headers).status_code == 403
    assert client.post(f"/imports/{identifier}/discard", headers=headers).status_code == 403


@pytest.mark.parametrize("identifier", ["0", "-1", "abc", "9" * 30, "1.5"])
def test_invalid_ids_do_not_reach_the_database(client, supabase, identifier):
    response = client.get(f"/imports/{identifier}", headers=auth_headers(supabase))
    assert response.status_code == 422
    assert not any("import_batch" in c.url.path for c in supabase.calls)


def test_get_follows_the_chain_from_any_event(client, supabase):
    first = supabase.add_batch(TENANT_A, 4, "importador")
    second = supabase.add_batch(TENANT_A, 4, "importador", status="VALIDADO", supersedes=first)
    headers = auth_headers(supabase)
    for identifier in (first, second):
        body = client.get(f"/imports/{identifier}", headers=headers).json()
        assert body["id"] == second
        assert body["root_id"] == first
        assert body["status"] == "VALIDADO"


def test_get_read_failure_is_503(client, supabase):
    identifier = upload(client, supabase).json()["id"]
    supabase.fail_tables.add("import_batch")
    response = client.get(f"/imports/{identifier}", headers=auth_headers(supabase))
    assert response.status_code == 503
    assert response.json() == {"detail": "READ_INCOMPLETE", "table": "import_batch"}


def test_broken_chain_is_503_and_not_a_shorter_history(client, supabase):
    identifier = supabase.add_batch(TENANT_A, 4, "importador", supersedes=999)
    response = client.get(f"/imports/{identifier}", headers=auth_headers(supabase))
    assert response.status_code == 503


def test_a_cycle_in_the_chain_fails_closed(client, supabase):
    first = supabase.add_batch(TENANT_A, 4, "importador")
    second = supabase.add_batch(TENANT_A, 4, "importador", supersedes=first)
    supabase.tables["import_batch"][0]["supersedes"] = second
    response = client.get(f"/imports/{second}", headers=auth_headers(supabase))
    assert response.status_code == 503


def test_malformed_chain_row_is_503(client, supabase):
    identifier = supabase.add_batch(TENANT_A, 4, "importador")
    supabase.tables["import_batch"][0]["supersedes"] = "no-es-id"
    response = client.get(f"/imports/{identifier}", headers=auth_headers(supabase))
    assert response.status_code == 503


def test_row_of_another_tenant_invalidates_the_read(client, supabase, monkeypatch):
    """Si un filtro o una política fallan, la fila ajena no se muestra."""
    identifier = supabase.add_batch(TENANT_B, 5, "importador")
    original = FakeSupabase._filter
    monkeypatch.setattr(
        FakeSupabase,
        "_filter",
        staticmethod(lambda rows, column, value: rows if column == "tenant" else original(rows, column, value)),
    )
    supabase.tables["tenant_user"].append(
        {"id": 90, "tenant": TENANT_B, "user": 4, "role": 4, "status": True}
    )
    monkeypatch.setattr(
        supabase,
        "_member_tenants",
        lambda _sub: {TENANT_A, TENANT_B},
    )
    supabase.tables["tenant_user"].pop()
    response = client.get(f"/imports/{identifier}", headers=auth_headers(supabase))
    assert response.status_code == 503
    assert response.json() == {"detail": "READ_INCOMPLETE", "table": "import_batch"}


# ---- POST /imports/{id}/discard


def test_discard_appends_an_event_and_removes_the_copy(client, supabase, store):
    identifier = upload(client, supabase).json()["id"]
    assert len(store.files(TENANT_A, identifier)) == 2
    response = client.post(f"/imports/{identifier}/discard", headers=auth_headers(supabase))
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "DESCARTADO"
    assert body["root_id"] == identifier
    assert body["id"] != identifier
    rows = supabase.tables["import_batch"]
    assert [row["status"] for row in rows] == ["RECIBIDO", "DESCARTADO"]
    assert rows[1]["supersedes"] == identifier
    assert rows[1]["file_hashes"] == rows[0]["file_hashes"]
    assert rows[1]["tenant"] == TENANT_A
    assert rows[1]["created_by"] == 4
    assert store.files(TENANT_A, identifier) == {}
    assert stored_files(store.root) == []


def test_discard_key_is_derived_so_concurrent_requests_make_one_event(client, supabase):
    identifier = upload(client, supabase).json()["id"]
    client.post(f"/imports/{identifier}/discard", headers=auth_headers(supabase))
    expected = uuid.uuid5(uuid.NAMESPACE_URL, f"equitas:discard:{TENANT_A}:{identifier}")
    assert supabase.tables["import_batch"][1]["idempotency_key"] == str(expected)


def test_repeated_discard_is_idempotent(client, supabase):
    identifier = upload(client, supabase).json()["id"]
    headers = auth_headers(supabase)
    first = client.post(f"/imports/{identifier}/discard", headers=headers)
    second = client.post(f"/imports/{identifier}/discard", headers=headers)
    by_event = client.post(f"/imports/{first.json()['id']}/discard", headers=headers)
    assert first.status_code == second.status_code == by_event.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert len(supabase.tables["import_batch"]) == 2


@pytest.mark.parametrize("status", ["VALIDADO", "REQUIERE_NUEVO_PREVIEW"])
def test_open_states_can_be_discarded(client, supabase, status):
    first = supabase.add_batch(TENANT_A, 4, "importador")
    supabase.add_batch(TENANT_A, 4, "importador", status=status, supersedes=first)
    response = client.post(f"/imports/{first}/discard", headers=auth_headers(supabase))
    assert response.status_code == 200
    assert response.json()["status"] == "DESCARTADO"
    assert response.json()["root_id"] == first


@pytest.mark.parametrize("status", ["CONFIRMADO", "PUBLICADO", "FALLIDO"])
def test_closed_states_cannot_be_discarded(client, supabase, store, status):
    first = supabase.add_batch(TENANT_A, 4, "importador")
    supabase.add_batch(TENANT_A, 4, "importador", status=status, supersedes=first)
    response = client.post(f"/imports/{first}/discard", headers=auth_headers(supabase))
    assert response.status_code == 409
    assert response.json() == {"detail": "BATCH_NOT_DISCARDABLE"}
    assert len(supabase.tables["import_batch"]) == 2


def test_discard_lost_race_is_409_and_keeps_the_copy(client, supabase, store):
    identifier = upload(client, supabase).json()["id"]
    supabase.rpc_message = "INVALID_IMPORT_BATCH:import_batch_supersedes_key"
    response = client.post(f"/imports/{identifier}/discard", headers=auth_headers(supabase))
    assert response.status_code == 409
    assert len(store.files(TENANT_A, identifier)) == 2


def test_discard_after_expired_copy_still_records_the_event(client, supabase, store):
    identifier = upload(client, supabase).json()["id"]
    store.release(TENANT_A, identifier)
    response = client.post(f"/imports/{identifier}/discard", headers=auth_headers(supabase))
    assert response.status_code == 200


def test_replay_of_a_discarded_upload_reports_the_current_state(client, supabase):
    key = str(uuid.uuid4())
    identifier = upload(client, supabase, headers={"Idempotency-Key": key}).json()["id"]
    client.post(f"/imports/{identifier}/discard", headers=auth_headers(supabase))
    replay = upload(client, supabase, headers={"Idempotency-Key": key})
    assert replay.status_code == 200
    assert replay.json()["status"] == "DESCARTADO"
    assert replay.json()["created"] is False


def test_unexpected_rpc_payload_is_503(client, supabase, monkeypatch):
    original = supabase._record_import_batch
    monkeypatch.setattr(
        supabase,
        "_record_import_batch",
        lambda request: (original(request), httpx.Response(200, json=[{"x": 1}]))[1],
    )
    response = upload(client, supabase)
    assert response.status_code == 503
    assert response.json() == {"detail": "BATCH_WRITE_FAILED"}


# ---- Ciclo 1, B1: ninguna fila anuncia una copia que no existe

KEY = "11111111-1111-4111-8111-111111111111"
EXPIRED_AGE = 86_401


def batch_dir(store, batch=1, tenant=TENANT_A):
    return store.root / "lotes" / str(tenant) / str(batch)


def age_copy(path) -> None:
    old = time.time() - EXPIRED_AGE
    os.utime(path, (old, old))


def assert_whole_copy(store, batch=1):
    assert store.files(TENANT_A, batch)["cabecera"].read_bytes() == CABECERA
    assert store.files(TENANT_A, batch)["detalle"].read_bytes() == DETALLE


def incoming_is_empty(store) -> bool:
    return list((store.root / "incoming").iterdir()) == []


def test_b1_upload_without_a_key_is_rejected_because_it_could_not_be_retried(
    client, supabase, store
):
    response = client.post(
        "/imports", content=batch_form(), headers={**auth_headers(supabase), **MULTIPART}
    )
    assert response.status_code == 422
    assert response.json() == {"detail": "IDEMPOTENCY_KEY_REQUERIDA"}
    assert supabase.tables["import_batch"] == []
    assert stored_files(store.root) == []


def test_b1_destination_is_prepared_before_registering_the_batch(client, supabase, store):
    (store.root / "lotes" / str(TENANT_A)).write_bytes(b"ocupa el lugar del directorio")
    response = upload(client, supabase, headers={"Idempotency-Key": KEY})
    assert response.status_code == 503
    assert response.json() == {"detail": "ALMACEN_TEMPORAL_NO_DISPONIBLE"}
    assert supabase.tables["import_batch"] == []
    assert not any(c.url.path.endswith("record_import_batch") for c in supabase.calls)
    assert incoming_is_empty(store)
    assert str(store.root) not in response.text


@pytest.mark.parametrize(
    "failure", [OSError(errno.ENOSPC, "sin espacio"), PermissionError(errno.EACCES, "negado")]
)
def test_b1_failed_move_is_not_success_and_the_retry_restores_the_copy(
    client, supabase, store, monkeypatch, failure
):
    original = UploadStore.commit
    monkeypatch.setattr(UploadStore, "commit", lambda *_args: (_ for _ in ()).throw(failure))
    first = upload(client, supabase, headers={"Idempotency-Key": KEY})
    assert first.status_code == 503
    assert first.json() == {"detail": "ALMACEN_TEMPORAL_NO_DISPONIBLE"}
    assert len(supabase.tables["import_batch"]) == 1
    # El estado queda explícito: la fila existe y la copia no.
    state = client.get("/imports/1", headers=auth_headers(supabase)).json()
    assert state["status"] == "RECIBIDO"
    assert state["copy_available"] is False
    assert state["copy_expires_at"] is None
    monkeypatch.setattr(UploadStore, "commit", original)
    retry = upload(client, supabase, headers={"Idempotency-Key": KEY})
    assert retry.status_code == 200
    assert retry.json()["created"] is False
    assert retry.json()["copy_available"] is True
    assert len(supabase.tables["import_batch"]) == 1
    assert_whole_copy(store)
    assert incoming_is_empty(store)


def test_b1_success_is_not_announced_if_the_stored_copy_does_not_verify(
    client, supabase, store, monkeypatch
):
    monkeypatch.setattr(UploadStore, "verify", lambda *_args: False)
    response = upload(client, supabase, headers={"Idempotency-Key": KEY})
    assert response.status_code == 503
    assert response.json() == {"detail": "ALMACEN_TEMPORAL_NO_DISPONIBLE"}


def test_b1_lost_response_retry_keeps_the_first_copy_without_a_second_row(
    client, supabase, store
):
    assert upload(client, supabase, headers={"Idempotency-Key": KEY}).status_code == 201
    first = store.files(TENANT_A, 1)["cabecera"].stat().st_ino
    retry = upload(client, supabase, headers={"Idempotency-Key": KEY})
    assert retry.status_code == 200
    assert retry.json()["copy_available"] is True
    assert store.files(TENANT_A, 1)["cabecera"].stat().st_ino == first
    assert len(supabase.tables["import_batch"]) == 1
    assert incoming_is_empty(store)


def test_b1_retry_after_the_ttl_restores_the_copy_with_a_new_term(client, supabase, store):
    assert upload(client, supabase, headers={"Idempotency-Key": KEY}).status_code == 201
    age_copy(batch_dir(store))
    retry = upload(client, supabase, headers={"Idempotency-Key": KEY})
    assert retry.status_code == 200
    assert retry.json()["status"] == "RECIBIDO"
    assert retry.json()["copy_available"] is True
    assert retry.json()["copy_expires_at"] is not None
    assert_whole_copy(store)
    assert batch_dir(store).stat().st_mtime > time.time() - 60


def test_b1_retry_repairs_a_truncated_copy(client, supabase, store):
    assert upload(client, supabase, headers={"Idempotency-Key": KEY}).status_code == 201
    store.files(TENANT_A, 1)["cabecera"].write_bytes(CABECERA[:5])
    retry = upload(client, supabase, headers={"Idempotency-Key": KEY})
    assert retry.status_code == 200
    assert retry.json()["copy_available"] is True
    assert_whole_copy(store)
    assert incoming_is_empty(store)


def test_b1_retry_does_not_bring_back_a_discarded_batch(client, supabase, store):
    assert upload(client, supabase, headers={"Idempotency-Key": KEY}).status_code == 201
    client.post("/imports/1/discard", headers=auth_headers(supabase))
    retry = upload(client, supabase, headers={"Idempotency-Key": KEY})
    assert retry.status_code == 200
    assert retry.json()["status"] == "DESCARTADO"
    assert retry.json()["copy_available"] is False
    assert stored_files(store.root) == []


@pytest.mark.parametrize("status", ["CONFIRMADO", "PUBLICADO", "FALLIDO"])
def test_b1_retry_does_not_touch_the_copy_of_a_closed_batch(client, supabase, store, status):
    assert upload(client, supabase, headers={"Idempotency-Key": KEY}).status_code == 201
    supabase.add_batch(TENANT_A, 4, "importador", status=status, supersedes=1)
    store.release(TENANT_A, 1)
    retry = upload(client, supabase, headers={"Idempotency-Key": KEY})
    assert retry.status_code == 200
    assert retry.json()["status"] == status
    assert retry.json()["copy_available"] is False
    assert stored_files(store.root) == []


@pytest.mark.parametrize("status", ["VALIDADO", "REQUIERE_NUEVO_PREVIEW"])
def test_b1_retry_restores_the_copy_of_an_open_batch(client, supabase, store, status):
    assert upload(client, supabase, headers={"Idempotency-Key": KEY}).status_code == 201
    root = supabase.tables["import_batch"][0]
    supabase.add_batch(
        TENANT_A,
        4,
        "importador",
        status=status,
        supersedes=1,
        file_hashes=root["file_hashes"],
        counts=root["counts"],
    )
    store.release(TENANT_A, 1)
    retry = upload(client, supabase, headers={"Idempotency-Key": KEY})
    assert retry.status_code == 200
    assert retry.json()["root_id"] == 1
    assert retry.json()["copy_available"] is True
    assert_whole_copy(store)


def test_b1_discard_that_wins_the_race_with_a_restore_leaves_no_copy(
    client, supabase, store, monkeypatch
):
    assert upload(client, supabase, headers={"Idempotency-Key": KEY}).status_code == 201
    store.release(TENANT_A, 1)
    original = UploadStore.commit

    def discard_meanwhile(self, *args):
        supabase.add_batch(TENANT_A, 4, "importador", status="DESCARTADO", supersedes=1)
        return original(self, *args)

    monkeypatch.setattr(UploadStore, "commit", discard_meanwhile)
    retry = upload(client, supabase, headers={"Idempotency-Key": KEY})
    assert retry.status_code == 200
    assert retry.json()["status"] == "DESCARTADO"
    assert retry.json()["copy_available"] is False
    assert stored_files(store.root) == []


def test_b1_conflicting_retry_does_not_touch_the_first_copy_after_a_failed_move(
    client, supabase, store, monkeypatch
):
    assert upload(client, supabase, headers={"Idempotency-Key": KEY}).status_code == 201
    conflict = upload(
        client, supabase, batch_form(cabecera=b"otro"), headers={"Idempotency-Key": KEY}
    )
    assert conflict.status_code == 409
    assert_whole_copy(store)


def test_b1_two_retries_at_once_keep_one_whole_copy(store):
    """Dos reintentos sin copia previa: gana uno, el otro comprueba y no pisa."""
    hashes = {"cabecera": hashlib.sha256(b"x").hexdigest()}
    tokens = [store.begin(), store.begin()]
    for token in tokens:
        with store.open_part(token, "cabecera") as handle:
            handle.write(b"x")
    assert store.commit(tokens[0], TENANT_A, 1) is True
    assert store.commit(tokens[1], TENANT_A, 1) is False
    assert store.verify(TENANT_A, 1, hashes) is True
    store.discard(tokens[1])
    assert incoming_is_empty(store)


def test_b1_replace_swaps_a_damaged_copy_and_leaves_no_residue(store):
    token = store.begin()
    with store.open_part(token, "cabecera") as handle:
        handle.write(b"danada")
    store.commit(token, TENANT_A, 1)
    fresh = store.begin()
    with store.open_part(fresh, "cabecera") as handle:
        handle.write(b"entera")
    store.replace(fresh, TENANT_A, 1)
    assert store.files(TENANT_A, 1)["cabecera"].read_bytes() == b"entera"
    assert incoming_is_empty(store)
    # Sin nada que reemplazar también instala.
    store.release(TENANT_A, 1)
    other = store.begin()
    with store.open_part(other, "cabecera") as handle:
        handle.write(b"nueva")
    store.replace(other, TENANT_A, 1)
    assert store.files(TENANT_A, 1)["cabecera"].read_bytes() == b"nueva"


def test_b1_replace_that_loses_the_race_keeps_the_winner(store, monkeypatch):
    stored_first = store.begin()
    with store.open_part(stored_first, "cabecera") as handle:
        handle.write(b"danada")
    store.commit(stored_first, TENANT_A, 1)
    late = store.begin()
    with store.open_part(late, "cabecera") as handle:
        handle.write(b"tardia")
    original = os.rename
    calls = []

    def rename(source, target):
        calls.append(target)
        if len(calls) < 2:
            return original(source, target)
        # Otra solicitud instaló la suya justo antes.
        os.mkdir(target, 0o700)
        Path(target, "cabecera").write_bytes(b"ganadora")
        raise OSError(errno.ENOTEMPTY, "ocupado")

    monkeypatch.setattr(os, "rename", rename)
    store.replace(late, TENANT_A, 1)
    monkeypatch.undo()
    assert store.files(TENANT_A, 1)["cabecera"].read_bytes() == b"ganadora"


def test_b1_replace_that_cannot_install_reports_the_failure(store, monkeypatch):
    token = store.begin()
    with store.open_part(token, "cabecera") as handle:
        handle.write(b"x")
    original = os.rename

    def rename(source, target):
        if Path(source).name == token:
            raise OSError(errno.EIO, "x")
        return original(source, target)

    monkeypatch.setattr(os, "rename", rename)
    with pytest.raises(OSError):
        store.replace(token, TENANT_A, 1)
    monkeypatch.undo()
    assert store.files(TENANT_A, 1) == {}


def test_b1_verify_rejects_missing_extra_or_altered_files(store):
    token = store.begin()
    for kind, content in (("cabecera", b"a"), ("detalle", b"b")):
        with store.open_part(token, kind) as handle:
            handle.write(content)
    store.commit(token, TENANT_A, 1)
    good = {"cabecera": hashlib.sha256(b"a").hexdigest(), "detalle": hashlib.sha256(b"b").hexdigest()}
    assert store.verify(TENANT_A, 1, good) is True
    assert store.verify(TENANT_A, 1, {"cabecera": good["cabecera"]}) is False
    assert store.verify(TENANT_A, 1, {**good, "libro": good["cabecera"]}) is False
    assert store.verify(TENANT_A, 1, {**good, "detalle": "0" * 64}) is False
    assert store.verify(TENANT_A, 2, good) is False


def test_b1_get_reports_the_state_of_the_copy(client, supabase, store):
    identifier = upload(client, supabase).json()["id"]
    body = client.get(f"/imports/{identifier}", headers=auth_headers(supabase)).json()
    assert body["copy_available"] is True
    expires = batch_dir(store).stat().st_mtime + 86_400
    assert abs(_timestamp(body["copy_expires_at"]) - expires) < 1
    # Un archivo que no coincide en tamaño con lo registrado no cuenta como copia.
    store.files(TENANT_A, identifier)["detalle"].write_bytes(b"corto")
    body = client.get(f"/imports/{identifier}", headers=auth_headers(supabase)).json()
    assert body["copy_available"] is False
    store.release(TENANT_A, identifier)
    body = client.get(f"/imports/{identifier}", headers=auth_headers(supabase)).json()
    assert body["copy_available"] is False
    assert body["copy_expires_at"] is None


def test_b1_get_with_an_incomplete_set_of_files_reports_no_copy(client, supabase, store):
    identifier = upload(client, supabase).json()["id"]
    store.files(TENANT_A, identifier)["detalle"].unlink()
    body = client.get(f"/imports/{identifier}", headers=auth_headers(supabase)).json()
    assert body["copy_available"] is False


def test_b1_missing_class_counts_even_without_a_declared_size(client, supabase, store):
    identifier = supabase.add_batch(
        TENANT_A, 4, "importador", file_hashes={"cabecera": "a" * 64, "detalle": "b" * 64}
    )
    token = store.begin()
    with store.open_part(token, "cabecera") as handle:
        handle.write(b"x")
    store.commit(token, TENANT_A, identifier)
    body = client.get(f"/imports/{identifier}", headers=auth_headers(supabase)).json()
    assert body["copy_available"] is False


def test_b1_batch_without_a_declared_size_is_judged_by_its_files(client, supabase, store):
    identifier = supabase.add_batch(TENANT_A, 4, "importador")
    token = store.begin()
    with store.open_part(token, "cabecera") as handle:
        handle.write(b"x")
    store.commit(token, TENANT_A, identifier)
    body = client.get(f"/imports/{identifier}", headers=auth_headers(supabase)).json()
    assert body["copy_available"] is True


def test_b1_full_disk_while_receiving_is_503_and_leaves_nothing(client, supabase, store, monkeypatch):
    original = UploadStore.open_part

    class FullDisk:
        def __init__(self, handle):
            self.handle = handle

        def write(self, _chunk):
            raise OSError(errno.ENOSPC, "sin espacio")

        def close(self):
            self.handle.close()

    monkeypatch.setattr(UploadStore, "open_part", lambda *args: FullDisk(original(*args)))
    response = upload(client, supabase, headers={"Idempotency-Key": KEY})
    assert response.status_code == 503
    assert response.json() == {"detail": "ALMACEN_TEMPORAL_NO_DISPONIBLE"}
    assert supabase.tables["import_batch"] == []
    assert stored_files(store.root) == []


def test_b1_unusable_temporary_area_is_503_before_reading_the_body(
    client, supabase, store, monkeypatch
):
    def fails(_self):
        raise OSError(errno.EACCES, "negado")

    monkeypatch.setattr(UploadStore, "begin", fails)
    response = upload(client, supabase, headers={"Idempotency-Key": KEY})
    assert response.status_code == 503
    assert response.json() == {"detail": "ALMACEN_TEMPORAL_NO_DISPONIBLE"}
    assert supabase.tables["import_batch"] == []


# ---- Ciclo 1, B2: el TTL rige sin que nadie suba ni descarte


def _timestamp(value: str) -> float:
    from datetime import datetime

    return datetime.fromisoformat(value).timestamp()


def clocked_store(tmp_path, now):
    return UploadStore(tmp_path / "almacen", ttl_seconds=100, clock=lambda: now[0])


def stored(store, tenant=1, batch=1, content=b"x"):
    token = store.begin()
    with store.open_part(token, "cabecera") as handle:
        handle.write(content)
    store.commit(token, tenant, batch)


def test_b2_an_expired_copy_is_not_handed_out_and_disappears(tmp_path):
    now = [1_000_000.0]
    store = clocked_store(tmp_path, now)
    stored(store)
    assert list(store.files(1, 1)) == ["cabecera"]
    now[0] += 99
    assert list(store.files(1, 1)) == ["cabecera"]
    now[0] += 1
    assert store.files(1, 1) == {}
    assert not (store.root / "lotes" / "1" / "1").exists()
    assert store.verify(1, 1, {"cabecera": hashlib.sha256(b"x").hexdigest()}) is False


def test_b2_expiry_is_reported_from_the_copy_itself(tmp_path):
    now = [1_000_000.0]
    store = clocked_store(tmp_path, now)
    stored(store)
    available, expires = store.describe(1, 1, {"cabecera": "a" * 64}, 1)
    assert (available, expires) == (True, 1_000_100.0)
    now[0] += 100
    assert store.describe(1, 1, {"cabecera": "a" * 64}, 1) == (False, None)


def test_b2_get_of_an_expired_copy_does_not_offer_it_and_the_bytes_go(client, supabase, store):
    identifier = upload(client, supabase).json()["id"]
    age_copy(batch_dir(store, identifier))
    response = client.get(f"/imports/{identifier}", headers=auth_headers(supabase))
    assert response.status_code == 200
    assert response.json()["status"] == "RECIBIDO"
    assert response.json()["copy_available"] is False
    assert stored_files(store.root) == []


def test_b2_only_regular_files_of_the_batch_are_handed_out(store, tmp_path):
    stored(store)
    outside = tmp_path / "fuera"
    outside.write_bytes(b"secreto")
    (store.root / "lotes" / "1" / "1" / "detalle").symlink_to(outside)
    (store.root / "lotes" / "1" / "1" / "otro").write_bytes(b"x")
    assert list(store.files(1, 1)) == ["cabecera"]


def test_b2_a_planted_file_instead_of_a_batch_directory_is_no_copy(store):
    store.prepare(1)
    (store.root / "lotes" / "1" / "1").write_bytes(b"x")
    assert store.files(1, 1) == {}


def test_b2_prepare_refuses_foreign_ids_and_planted_files(store):
    with pytest.raises(UploadStoreError):
        store.prepare(0)
    (store.root / "lotes" / "1").write_bytes(b"x")
    with pytest.raises(UploadStoreError):
        store.prepare(1)


def test_b2_startup_purges_what_expired_while_the_process_was_down(supabase, store):
    stored(store)
    age_copy(store.root / "lotes" / "1" / "1")
    token = store.begin()
    age_copy(store.root / "incoming" / token)
    with TestClient(main.app, base_url="http://127.0.0.1"):
        assert stored_files(store.root) == []
        assert not (store.root / "incoming" / token).exists()


def test_b2_purge_runs_periodically_without_requests(supabase, store, monkeypatch):
    moments = []

    async def fake_sleep(seconds):
        moments.append(seconds)
        if len(moments) == 1:
            stored(store)
            age_copy(store.root / "lotes" / "1" / "1")
            return
        assert stored_files(store.root) == []
        raise asyncio.CancelledError

    monkeypatch.setattr(imports.asyncio, "sleep", fake_sleep)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(imports.purge_periodically(7.0))
    assert moments == [7.0, 7.0]


def test_b2_the_periodic_task_runs_inside_the_real_lifespan(supabase, store, monkeypatch):
    monkeypatch.setenv("EQUITAS_IMPORT_PURGE_SECONDS", "1")
    with TestClient(main.app, base_url="http://127.0.0.1"):
        stored(store)
        age_copy(store.root / "lotes" / "1" / "1")
        deadline = time.monotonic() + 15
        while stored_files(store.root) and time.monotonic() < deadline:
            time.sleep(0.05)
        assert stored_files(store.root) == []


def test_b2_a_failed_purge_is_logged_and_does_not_stop_the_next_one(
    supabase, store, monkeypatch, caplog
):
    original = UploadStore.purge_expired
    attempts = []

    def flaky(self):
        attempts.append(1)
        if len(attempts) == 1:
            raise OSError(errno.EIO, f"{self.root} CENTINELA_RUTA")
        return original(self)

    monkeypatch.setattr(UploadStore, "purge_expired", flaky)
    with caplog.at_level(logging.INFO, logger="equitas.api"):
        imports.purge_once()
        imports.purge_once()
    assert len(attempts) == 2
    assert "PURGA_FALLIDA clase=OSError" in caplog.text
    assert "CENTINELA" not in caplog.text
    assert str(store.root) not in caplog.text


def test_b2_a_purge_that_cannot_delete_says_so_and_the_copy_stays_unreadable(
    store, monkeypatch, caplog
):
    stored(store)
    age_copy(store.root / "lotes" / "1" / "1")
    monkeypatch.setattr(shutil, "rmtree", lambda *_args, **_kwargs: None)
    with caplog.at_level(logging.WARNING, logger="equitas.api"):
        assert store.purge_expired() == 0
    assert "PURGA_INCOMPLETA pendientes=1" in caplog.text
    assert store.files(1, 1) == {}


def test_b2_an_insecure_store_does_not_stop_the_process_or_the_loop(
    supabase, tmp_path, monkeypatch, caplog
):
    shared = tmp_path / "compartido"
    shared.mkdir()
    os.chmod(shared, 0o755)
    monkeypatch.setenv("EQUITAS_IMPORT_TMP_DIR", str(shared))
    with caplog.at_level(logging.ERROR, logger="equitas.api"):
        imports.purge_once()
    assert "PURGA_FALLIDA clase=UploadStoreError" in caplog.text
    assert str(shared) not in caplog.text


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, 900.0),
        ("", 900.0),
        ("60", 60.0),
        ("1", 1.0),
        ("3600", 3600.0),
        ("0", 900.0),
        ("-5", 900.0),
        ("3601", 900.0),
        ("abc", 900.0),
        ("١٢", 900.0),
    ],
)
def test_b2_purge_interval_has_a_bounded_value(monkeypatch, value, expected):
    if value is None:
        monkeypatch.delenv("EQUITAS_IMPORT_PURGE_SECONDS", raising=False)
    else:
        monkeypatch.setenv("EQUITAS_IMPORT_PURGE_SECONDS", value)
    assert imports.purge_interval_seconds() == expected


# ---- Ciclo 2, R1: una creación pendiente no reinstala la copia de un lote ya descartado


def test_r1_pending_creation_does_not_bring_back_a_discarded_copy(
    client, supabase, store, monkeypatch
):
    """Crear pendiente → reintentar → descartar → termina la creación."""
    original = imports._settle_copy
    nested = []

    def creation_still_pending(*args):
        if not nested:
            nested.append(True)
            retry = upload(client, supabase, headers={"Idempotency-Key": KEY})
            assert retry.status_code == 200
            assert retry.json()["copy_available"] is True
            discarded = client.post("/imports/1/discard", headers=auth_headers(supabase))
            assert discarded.json()["status"] == "DESCARTADO"
            assert not batch_dir(store).exists()
        return original(*args)

    monkeypatch.setattr(imports, "_settle_copy", creation_still_pending)
    first = upload(client, supabase, headers={"Idempotency-Key": KEY})
    assert first.status_code == 201
    assert first.json()["status"] == "DESCARTADO"
    assert first.json()["copy_available"] is False
    assert stored_files(store.root) == []
    assert client.get("/imports/1", headers=auth_headers(supabase)).json()["copy_available"] is False
    again = upload(client, supabase, headers={"Idempotency-Key": KEY})
    assert (again.status_code, again.json()["copy_available"]) == (200, False)
    assert [row["status"] for row in supabase.tables["import_batch"]] == ["RECIBIDO", "DESCARTADO"]
    assert incoming_is_empty(store)


def test_r1_discard_cannot_interleave_with_an_installation(client, supabase, store, monkeypatch):
    original = UploadStore.commit
    results = {}

    def discard_request():
        other = TestClient(main.app, base_url="http://127.0.0.1", raise_server_exceptions=False)
        results["discard"] = other.post("/imports/1/discard", headers=auth_headers(supabase))

    worker = threading.Thread(target=discard_request)

    def commit_while_a_discard_arrives(self, *args):
        if worker.ident is None:
            worker.start()
            worker.join(0.3)
            results["waited"] = worker.is_alive()
        return original(self, *args)

    monkeypatch.setattr(UploadStore, "commit", commit_while_a_discard_arrives)
    first = upload(client, supabase, headers={"Idempotency-Key": KEY})
    worker.join()
    assert results["waited"] is True, "El descarte debe esperar a que termine la instalación"
    assert first.status_code == 201
    assert results["discard"].json()["status"] == "DESCARTADO"
    assert results["discard"].json()["copy_available"] is False
    assert stored_files(store.root) == []


def test_r1_retry_removes_the_copy_left_by_an_interrupted_discard(client, supabase, store):
    """Proceso caído entre el evento y el borrado: queda DESCARTADO con copia."""
    assert upload(client, supabase, headers={"Idempotency-Key": KEY}).status_code == 201
    root = supabase.tables["import_batch"][0]
    supabase.add_batch(
        TENANT_A, 4, "importador", status="DESCARTADO", supersedes=1,
        file_hashes=root["file_hashes"], counts=root["counts"],
    )
    assert len(stored_files(store.root)) == 2
    retry = upload(client, supabase, headers={"Idempotency-Key": KEY})
    assert retry.status_code == 200
    assert retry.json()["copy_available"] is False
    assert stored_files(store.root) == []


def test_r1_get_removes_the_copy_left_by_an_interrupted_discard(client, supabase, store):
    assert upload(client, supabase, headers={"Idempotency-Key": KEY}).status_code == 201
    root = supabase.tables["import_batch"][0]
    supabase.add_batch(
        TENANT_A, 4, "importador", status="DESCARTADO", supersedes=1,
        file_hashes=root["file_hashes"], counts=root["counts"],
    )
    body = client.get("/imports/1", headers=auth_headers(supabase)).json()
    assert body["status"] == "DESCARTADO"
    assert body["copy_available"] is False
    assert stored_files(store.root) == []


def test_r1_response_of_a_retry_is_a_consistent_snapshot(client, supabase, store, monkeypatch):
    """Estado y copia se leen dentro de la exclusión: no se contradicen en la misma respuesta."""
    assert upload(client, supabase, headers={"Idempotency-Key": KEY}).status_code == 201
    original = imports._batch_view
    held = []

    def view(view_store, tenant, origin, row):
        with pytest.raises(store_module.UploadStoreBusy):
            _other_thread_tries_the_lock(view_store, tenant, origin)
        held.append(True)
        return original(view_store, tenant, origin, row)

    monkeypatch.setattr(imports, "_batch_view", view)
    assert upload(client, supabase, headers={"Idempotency-Key": KEY}).status_code == 200
    assert held


# ---- Ciclo 2, exclusión por lote


def _other_thread_tries_the_lock(store, tenant, batch) -> None:
    errors = []

    def attempt():
        try:
            with store.lock(tenant, batch, wait=0):
                pass
        except store_module.UploadStoreBusy as error:
            errors.append(error)

    thread = threading.Thread(target=attempt)
    thread.start()
    thread.join()
    if errors:
        raise errors[0]


class hold_lock:
    """Sostiene el lote desde otro hilo hasta salir del bloque."""

    def __init__(self, store, tenant=TENANT_A, batch=1):
        self.args = (store, tenant, batch)
        self.ready = threading.Event()
        self.leave = threading.Event()
        self.thread = threading.Thread(target=self._run)

    def _run(self):
        store, tenant, batch = self.args
        with store.lock(tenant, batch):
            self.ready.set()
            self.leave.wait()

    def __enter__(self):
        self.thread.start()
        assert self.ready.wait(10)
        return self

    def __exit__(self, *_):
        self.leave.set()
        self.thread.join()


def test_lock_excludes_other_threads_and_is_reentrant_in_the_same_one(store):
    with store.lock(TENANT_A, 1):
        with store.lock(TENANT_A, 1):
            with pytest.raises(store_module.UploadStoreBusy):
                _other_thread_tries_the_lock(store, TENANT_A, 1)
        with pytest.raises(store_module.UploadStoreBusy):
            _other_thread_tries_the_lock(store, TENANT_A, 1)
    _other_thread_tries_the_lock(store, TENANT_A, 1)


def test_lock_is_shared_by_every_store_instance_on_the_same_root(store):
    other = UploadStore(store.root)
    with store.lock(TENANT_A, 1), pytest.raises(store_module.UploadStoreBusy):
        _other_thread_tries_the_lock(other, TENANT_A, 1)


LOCK_HOLDER = """
import sys
from pathlib import Path
from api.upload_store import UploadStore
with UploadStore(Path(sys.argv[1])).lock(1, 1):
    print("LISTO", flush=True)
    sys.stdin.read()
"""


def _holder_process(store):
    process = subprocess.Popen(
        [sys.executable, "-c", LOCK_HOLDER, str(store.root)],
        cwd=Path(__file__).resolve().parents[1],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
    )
    assert process.stdout.readline().strip() == "LISTO"
    return process


def test_lock_excludes_other_processes_and_dies_with_its_holder(store):
    """Con más de un worker también rige. Un proceso que muere no deja el lote tomado."""
    process = _holder_process(store)
    try:
        with pytest.raises(store_module.UploadStoreBusy):
            with store.lock(1, 1, wait=0):
                pass
    finally:
        process.kill()
        process.wait()
        process.stdin.close()
        process.stdout.close()
    with store.lock(1, 1, wait=5):
        pass


def test_lock_wait_is_bounded_and_the_upload_can_be_retried(
    client, supabase, store, monkeypatch
):
    monkeypatch.setattr(store_module, "LOCK_WAIT_SECONDS", 0.05)
    with hold_lock(store):
        first = upload(client, supabase, headers={"Idempotency-Key": KEY})
    assert first.status_code == 503
    assert first.json() == {"detail": "ALMACEN_TEMPORAL_NO_DISPONIBLE"}
    assert incoming_is_empty(store)
    retry = upload(client, supabase, headers={"Idempotency-Key": KEY})
    assert retry.status_code == 200
    assert retry.json()["copy_available"] is True
    assert_whole_copy(store)


def test_lock_busy_on_discard_is_503_and_changes_nothing(client, supabase, store, monkeypatch):
    assert upload(client, supabase, headers={"Idempotency-Key": KEY}).status_code == 201
    monkeypatch.setattr(store_module, "LOCK_WAIT_SECONDS", 0.05)
    with hold_lock(store):
        response = client.post("/imports/1/discard", headers=auth_headers(supabase))
    assert response.status_code == 503
    assert [row["status"] for row in supabase.tables["import_batch"]] == ["RECIBIDO"]
    assert_whole_copy(store)


def test_lock_file_planted_as_symlink_is_refused(store, tmp_path):
    outside = tmp_path / "fuera"
    outside.write_bytes(b"x")
    for index in range(store_module.LOCK_STRIPES):
        path = store.root / "bloqueos" / f"{index:02d}.lock"
        path.unlink(missing_ok=True)
        path.symlink_to(outside)
    with pytest.raises(OSError):
        with store.lock(1, 1, wait=0):
            pass
    assert outside.read_bytes() == b"x"


# ---- Ciclo 2, R2: la purga no borra una generación nueva


def test_r2_stale_purge_decision_does_not_delete_the_new_copy(
    client, supabase, store, monkeypatch
):
    """La purga decidió sobre la copia vencida; el reintento instala otra en la misma ruta."""
    assert upload(client, supabase, headers={"Idempotency-Key": KEY}).status_code == 201
    age_copy(batch_dir(store))
    original = UploadStore._expired
    fired = []

    def decided_then_retry(self, entry):
        result = original(self, entry)
        if result and entry.name == "1" and not fired:
            fired.append(True)
            retry = upload(client, supabase, headers={"Idempotency-Key": KEY})
            assert retry.status_code == 200
            assert retry.json()["copy_available"] is True
        return result

    monkeypatch.setattr(UploadStore, "_expired", decided_then_retry)
    UploadStore(store.root).purge_expired()
    assert fired
    body = client.get("/imports/1", headers=auth_headers(supabase)).json()
    assert body["copy_available"] is True
    assert_whole_copy(store)
    assert incoming_is_empty(store)


def test_r2_read_cleanup_does_not_delete_a_new_generation(store, monkeypatch, tmp_path):
    """Lo mismo en la limpieza al leer: decidió con un `stat` viejo."""
    stored(store, TENANT_A, 1, b"vieja")
    target = batch_dir(store)
    age_copy(target)
    original = os.lstat
    fired = []

    def stale_stat(path, *args, **kwargs):
        result = original(path, *args, **kwargs)
        if Path(path) == target and not fired:
            fired.append(True)
            os.rename(target, tmp_path / "vieja-apartada")
            os.mkdir(target, 0o700)
            (target / "cabecera").write_bytes(b"nueva")
        return result

    monkeypatch.setattr(os, "lstat", stale_stat)
    found = store.files(TENANT_A, 1)
    monkeypatch.undo()
    assert fired
    assert (target / "cabecera").read_bytes() == b"nueva"
    assert found["cabecera"].read_bytes() == b"nueva"


def test_r2_busy_batch_is_left_for_the_next_purge_and_stays_unreadable(store):
    stored(store, TENANT_A, 1)
    age_copy(batch_dir(store))
    with hold_lock(store):
        assert store.purge_expired() == 0
        assert batch_dir(store).exists()
        assert store.files(TENANT_A, 1) == {}
        assert batch_dir(store).exists()
    assert store.purge_expired() == 1
    assert not batch_dir(store).exists()


def test_r2_expired_generation_is_retired_to_a_private_name_before_deleting(store, monkeypatch):
    stored(store, TENANT_A, 1)
    age_copy(batch_dir(store))
    deleted = []
    original = shutil.rmtree

    def recording(path, *args, **kwargs):
        deleted.append(Path(path))
        return original(path, *args, **kwargs)

    monkeypatch.setattr(shutil, "rmtree", recording)
    assert store.purge_expired() == 1
    assert batch_dir(store) not in deleted
    assert all(path.parent == store.root / "retirados" for path in deleted)
    assert list((store.root / "retirados").iterdir()) == []


def test_r2_release_retires_to_a_private_name_before_deleting(store, monkeypatch):
    stored(store, TENANT_A, 1)
    deleted = []
    original = shutil.rmtree

    def recording(path, *args, **kwargs):
        deleted.append(Path(path))
        return original(path, *args, **kwargs)

    monkeypatch.setattr(shutil, "rmtree", recording)
    store.release(TENANT_A, 1)
    assert batch_dir(store) not in deleted
    assert not batch_dir(store).exists()
    store.release(TENANT_A, 1)


def test_r2_a_generation_left_half_way_is_swept_by_the_next_purge(store):
    leftover = store.root / "retirados" / ("a" * 32)
    leftover.mkdir(mode=0o700)
    (leftover / "cabecera").write_bytes(b"resto de un proceso caido")
    assert store.purge_expired() == 1
    assert list((store.root / "retirados").iterdir()) == []


def test_r2_generation_that_cannot_be_retired_is_reported_and_stays_unreadable(
    store, monkeypatch, caplog
):
    stored(store, TENANT_A, 1)
    age_copy(batch_dir(store))
    original = os.rename

    def refuses(source, target):
        if Path(source) == batch_dir(store):
            raise PermissionError(errno.EACCES, "negado")
        return original(source, target)

    monkeypatch.setattr(os, "rename", refuses)
    with caplog.at_level(logging.WARNING, logger="equitas.api"):
        assert store.purge_expired() == 0
    assert "PURGA_INCOMPLETA pendientes=1" in caplog.text
    assert store.files(TENANT_A, 1) == {}
    monkeypatch.undo()
    assert store.purge_expired() == 1


def test_r2_release_that_cannot_retire_is_reported(store, monkeypatch, caplog):
    stored(store, TENANT_A, 1)
    original = os.rename

    def refuses(source, target):
        if Path(source) == batch_dir(store):
            raise PermissionError(errno.EACCES, "negado")
        return original(source, target)

    monkeypatch.setattr(os, "rename", refuses)
    with caplog.at_level(logging.WARNING, logger="equitas.api"):
        store.release(TENANT_A, 1)
    assert "RETIRO_INCOMPLETO" in caplog.text


# ---- Ciclo 2, otras carreras del mismo tipo


def test_race_copy_vanishing_while_verifying_is_no_copy_not_an_error(store, monkeypatch):
    stored(store, TENANT_A, 1)
    original = UploadStore.files

    def vanish_after_listing(self, tenant, batch):
        found = original(self, tenant, batch)
        self.release(tenant, batch)
        return found

    monkeypatch.setattr(UploadStore, "files", vanish_after_listing)
    assert store.verify(TENANT_A, 1, {"cabecera": hashlib.sha256(b"x").hexdigest()}) is False


def test_race_copy_vanishing_while_describing_is_no_copy_not_an_error(store, monkeypatch):
    stored(store, TENANT_A, 1)
    original = UploadStore.files

    def vanish_after_listing(self, tenant, batch):
        found = original(self, tenant, batch)
        self.release(tenant, batch)
        return found

    monkeypatch.setattr(UploadStore, "files", vanish_after_listing)
    assert store.describe(TENANT_A, 1, {"cabecera": "a" * 64}, None) == (False, None)


def test_race_get_during_a_discard_waits_and_never_says_discarded_with_a_copy(
    client, supabase, store, monkeypatch
):
    identifier = upload(client, supabase).json()["id"]
    original = UploadStore.release
    seen = {}

    def get_request():
        other = TestClient(main.app, base_url="http://127.0.0.1", raise_server_exceptions=False)
        seen["get"] = other.get(f"/imports/{identifier}", headers=auth_headers(supabase)).json()

    worker = threading.Thread(target=get_request)

    def read_in_the_middle(self, tenant, batch):
        # El evento ya está registrado y la copia todavía no se retiró.
        if worker.ident is None:
            worker.start()
            worker.join(0.3)
            seen["waited"] = worker.is_alive()
        return original(self, tenant, batch)

    monkeypatch.setattr(UploadStore, "release", read_in_the_middle)
    assert client.post(f"/imports/{identifier}/discard", headers=auth_headers(supabase)).status_code == 200
    worker.join()
    assert seen["waited"] is True
    assert seen["get"]["status"] == "DESCARTADO"
    assert seen["get"]["copy_available"] is False


def test_race_two_discards_of_different_events_make_one_event(client, supabase, store):
    identifier = upload(client, supabase).json()["id"]
    original = imports._write_batch
    results = []

    def second_discard_arrives(*args, **kwargs):
        results.append(original(*args, **kwargs))
        return results[-1]

    imports._write_batch, restore = second_discard_arrives, original
    try:
        first = client.post(f"/imports/{identifier}/discard", headers=auth_headers(supabase))
        second = client.post(f"/imports/{first.json()['id']}/discard", headers=auth_headers(supabase))
    finally:
        imports._write_batch = restore
    assert first.status_code == second.status_code == 200
    assert len(results) == 1
    assert len(supabase.tables["import_batch"]) == 2


def test_race_reception_whose_temporary_was_purged_fails_cleanly_and_retries(
    client, supabase, store, monkeypatch
):
    original = imports._settle_copy
    fired = []

    def purged_meanwhile(*args):
        if not fired:
            fired.append(True)
            for path in (store.root / "incoming").iterdir():
                age_copy(path)
            store.purge_expired()
        return original(*args)

    monkeypatch.setattr(imports, "_settle_copy", purged_meanwhile)
    first = upload(client, supabase, headers={"Idempotency-Key": KEY})
    assert first.status_code == 503
    assert first.json() == {"detail": "ALMACEN_TEMPORAL_NO_DISPONIBLE"}
    retry = upload(client, supabase, headers={"Idempotency-Key": KEY})
    assert retry.status_code == 200
    assert_whole_copy(store)


def test_race_replace_keeps_the_old_generation_out_of_the_name_before_installing(store):
    stored(store, TENANT_A, 1, b"danada")
    token = store.begin()
    with store.open_part(token, "cabecera") as handle:
        handle.write(b"entera")
    store.replace(token, TENANT_A, 1)
    assert (batch_dir(store) / "cabecera").read_bytes() == b"entera"
    assert list((store.root / "retirados").iterdir()) == []


# ---- Ciclo 2, R3: el número del cliente no sale en una URL


NUMBER = "20000000009"


def _outgoing(supabase):
    return [f"{call.url} {dict(call.headers)}" for call in supabase.calls]


def test_r3_batch_number_of_the_client_never_reaches_an_outgoing_request(client, supabase):
    identifier = upload(client, supabase).json()["id"]
    supabase.calls.clear()
    headers = auth_headers(supabase)
    assert client.get(f"/imports/{NUMBER}", headers=headers).status_code == 404
    assert client.get(f"/imports/000{NUMBER}", headers=headers).status_code == 404
    assert client.post(f"/imports/{NUMBER}/discard", headers=headers).status_code == 404
    assert supabase.calls
    assert not [line for line in _outgoing(supabase) if NUMBER in line]
    # Tampoco un id existente: lo que viaja son filtros resueltos en el servidor.
    supabase.calls.clear()
    assert client.get(f"/imports/{identifier}", headers=headers).status_code == 200
    for call in supabase.calls:
        if call.url.path.endswith("/import_batch"):
            assert "id=eq." not in str(call.url)
            assert "supersedes=eq." not in str(call.url)
            assert f"tenant=eq.{TENANT_A}" in str(call.url)


def test_r3_lookup_is_resolved_over_more_than_one_page(client, supabase, monkeypatch):
    """Sin filtro por id hay que leer todo lo del municipio, sin cortarse en una página."""
    first = None
    for index in range(1, 2502):
        last = supabase.add_batch(TENANT_A, 4, "importador")
        first = first or last
    response = client.get(f"/imports/{last}", headers=auth_headers(supabase))
    assert response.status_code == 200
    assert response.json()["id"] == last
    assert client.get(f"/imports/{last + 1}", headers=auth_headers(supabase)).status_code == 404
    pages = [c for c in supabase.calls if c.url.path.endswith("/import_batch")]
    assert len(pages) >= 3


def test_r3_scoring_filters_of_the_client_never_reach_an_outgoing_request(client, supabase):
    supabase.calls.clear()
    response = client.get(
        "/case-groups",
        params={
            "as_of": "2026-09-30",
            "search": NUMBER,
            "group_key": NUMBER,
            "severity_band": NUMBER,
            "tag": NUMBER,
        },
        headers=auth_headers(supabase, AUTH_OPERADOR),
    )
    assert response.status_code == 200
    assert supabase.calls
    assert not [line for line in _outgoing(supabase) if NUMBER in line]


def test_r3_upload_data_of_the_client_travels_only_in_the_body(client, supabase):
    key = f"{NUMBER[:8]}-{NUMBER[8:]}0-4000-8000-000000000000"
    supabase.calls.clear()
    assert upload(client, supabase, headers={"Idempotency-Key": key}).status_code == 201
    assert not [line for line in _outgoing(supabase) if NUMBER[:8] in line]
    assert any(NUMBER[:8] in c.content.decode() for c in supabase.calls if c.content)
