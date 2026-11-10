"""Noche 7: «Cargar CSV» en un paso (`POST /imports/load`): recibe, valida y publica, o no cambia nada.

La lectura, validación y transformación son las reales (`services.import_preview_worker.prepare`, con
los lotes sintéticos de `front/public/ejemplos/carga-csv/`); solo se evita lanzar el proceso hijo, que
tiene sus propias pruebas (`test_import_preview_worker.py`, `test_import_preview_process.py`). La base
es el doble HTTP (`fake_supabase_http.py`).
"""

import json
import logging
import uuid
from pathlib import Path

import httpx
import pytest
import test_api_imports as base
from fake_supabase_http import (
    AUTH_ADMIN,
    AUTH_ADMIN_2,
    AUTH_ADMIN_OTRO_MUNICIPIO,
    AUTH_MULTI,
    AUTH_REVOCADO,
    AUTH_ROL_NO_RECONOCIDO,
    AUTH_SIN_MEMBRESIA,
    AUTH_SISTEMA,
    AUTH_USER,
    TENANT_A,
    TENANT_B,
)

from api import import_load
from api.upload_store import UploadStore, UploadStoreError
from ETL.config import ETLError
from ETL.transform import StructuralRejection, canonical_json_hash, source_contract
from ETL.validate_source import ValidationError
from services import import_preview_worker as worker
from services.import_preview_process import PreviewSourceError, _location

# Mismos fixtures que la recepción de lotes (`test_api_imports.py`): almacén temporal y doble HTTP.
supabase, client = base.supabase, base.client
MULTIPART, auth_headers, form = base.MULTIPART, base.auth_headers, base.form

ROOT = Path(__file__).resolve().parents[2]
EXAMPLES = ROOT / "front" / "public" / "ejemplos" / "carga-csv"
LOT_1 = EXAMPLES / "1-cartera-2026-09-30"
LOT_2 = EXAMPLES / "2-cartera-2026-10-31-con-errores"
LOT_3 = EXAMPLES / "3-cartera-2026-10-31"
MANIFEST = json.loads((EXAMPLES / "manifiesto.json").read_text(encoding="utf-8"))
CENTINELA = "CENTINELA_VALOR_DEL_ARCHIVO"
NOT_MODIFIED = "Esta carga no modificó la cartera ni su fecha."
PUBLISHED_STATES = ("PUBLICADO",)


# ---- Formulario


def lot_files(lot: Path) -> dict[str, bytes]:
    return {kind: (lot / f"{kind}.csv").read_bytes() for kind in ("cabecera", "detalle")}


def lot_form(files: dict[str, bytes], as_of: str | None = "2026-09-30", *extra) -> bytes:
    parts = [] if as_of is None else [("as_of", as_of.encode(), None)]
    parts += [(kind, data, f"{kind}.csv") for kind, data in files.items()]
    return form(*parts, *extra)


def load(client, supabase, body: bytes, user=AUTH_ADMIN, headers=None, **kwargs):
    return client.post("/imports/load", content=body,
                       headers={**auth_headers(supabase, user), **MULTIPART, **(headers or {})}, **kwargs)


def incoming(tmp_path) -> list[Path]:
    """Lo que quedó recibido sin pertenecer a un lote: la carga directa nunca deja nada."""
    folder = tmp_path / "almacen" / "incoming"
    return sorted(folder.rglob("*")) if folder.exists() else []


def with_sentinel(lot: Path) -> dict[str, bytes]:
    """Lote 2 con un valor centinela en la celda con IMPORTE_NO_NUMERICO (detalle, línea 9)."""
    files = lot_files(lot)
    lines = files["detalle"].split(b"\n")
    assert b"1170000.00" in lines[8]
    lines[8] = lines[8].replace(b"1170000.00", CENTINELA.encode())
    return {**files, "detalle": b"\n".join(lines)}


# ---- El proceso de validación, en el mismo proceso


@pytest.fixture
def prepared_calls(monkeypatch) -> list[dict]:
    """`prepare_input` sin proceso hijo: el mismo `prepare` y la misma traducción de rechazos, con
    el viaje por JSON que hace el hijo. Registra con qué se llamó."""
    calls = []

    def in_process(files, profile, tenant, policy, *, lock_fd=None):
        request = json.loads(json.dumps(
            {"files": {k: str(v) for k, v in files.items()}, "profile": profile, "tenant": tenant, "policy": policy}))
        calls.append({**request, "present": {k: Path(v).is_file() for k, v in request["files"].items()},
                      "lock_fd": lock_fd})
        try:
            result = worker.prepare(request)
        except (StructuralRejection, ValidationError, ETLError) as error:
            result = worker.rejection(error)
        result = json.loads(json.dumps(result, allow_nan=False))
        if "source_error" in result:
            raise PreviewSourceError(result["source_error"], _location(result.get("location")))
        return result

    monkeypatch.setattr(import_load, "prepare_input", in_process)
    return calls


def raising(error):
    def prepare_input(*_args, **_kwargs):
        raise error

    return prepare_input


def not_called(*_args, **_kwargs):
    pytest.fail("No debía llegar a validar el lote")


def batches(supabase, tenant=TENANT_A, status=None):
    return [b for b in supabase.tables["import_batch"]
            if b["tenant"] == tenant and (status is None or b["status"] == status)]


def assert_not_modified(response):
    body = response.json()
    assert NOT_MODIFIED in body["mensaje"]
    assert "siguen como estaban" not in response.text


# ---- 1. Autorización antes de leer el cuerpo


def test_anonymous_is_401_before_reading_the_body(client, supabase, tmp_path, monkeypatch):
    monkeypatch.setattr(import_load, "prepare_input", not_called)
    response = client.post("/imports/load", content=lot_form(lot_files(LOT_1)), headers=MULTIPART)
    assert response.status_code == 401
    assert response.json() == {"detail": "AUTH_REQUIRED"}
    assert incoming(tmp_path) == []
    assert supabase.rpc_order() == []


@pytest.mark.parametrize(
    ("user", "status", "code"),
    [
        (AUTH_USER, 403, "ROLE_FORBIDDEN"),
        (AUTH_ROL_NO_RECONOCIDO, 403, "ROLE_FORBIDDEN"),
        (AUTH_SISTEMA, 403, "ROLE_FORBIDDEN"),
        (AUTH_SIN_MEMBRESIA, 403, "MEMBERSHIP_REQUIRED"),
        (AUTH_REVOCADO, 403, "MEMBERSHIP_REQUIRED"),
        (AUTH_MULTI, 409, "TENANT_SELECTION_REQUIRED"),
    ],
)
def test_only_admin_loads_and_the_rest_is_denied_before_reading(client, supabase, tmp_path, monkeypatch,
                                                                user, status, code):
    monkeypatch.setattr(import_load, "prepare_input", not_called)
    # Un cuerpo que ni siquiera es multipart válido: si se leyera, la respuesta sería 422.
    response = client.post("/imports/load", content=b"--roto", headers={**auth_headers(supabase, user), **MULTIPART})
    assert response.status_code == status
    assert response.json() == {"detail": code}
    assert incoming(tmp_path) == []
    assert supabase.rpc_order() == []
    assert supabase.tables["import_batch"] == []


def test_admin_of_another_tenant_loads_only_into_their_own(client, supabase, prepared_calls):
    body = lot_form(lot_files(LOT_1), "2026-09-30", ("tenant", b"1", None), ("p_tenant", b"1", None),
                    ("tenant_id", b"1", None))
    response = load(client, supabase, body, AUTH_ADMIN_OTRO_MUNICIPIO,
                    params={"tenant": "1"}, headers={"X-Tenant": "1"})
    assert response.status_code == 201, response.text
    assert [call["tenant"] for call in prepared_calls] == [TENANT_B]
    for name in ("stage_import_batch", "record_access_audit", "publish_import_batch"):
        for sent in supabase.rpc_bodies(name):
            assert (sent["p_tenant"], sent["p_actor_user"]) == (TENANT_B, 5)
    assert batches(supabase, TENANT_A) == []
    assert batches(supabase, TENANT_B)


# ---- 2. Entrada


@pytest.mark.parametrize("as_of", [None, "2026-02-30", "30/09/2026", "2026-9-30", "hoy"])
def test_cutoff_is_required_and_valid(client, supabase, tmp_path, monkeypatch, as_of):
    monkeypatch.setattr(import_load, "prepare_input", not_called)
    response = load(client, supabase, lot_form(lot_files(LOT_1), as_of))
    assert response.status_code == 422
    assert response.json() == {"detail": "AS_OF_INVALIDO"}
    assert incoming(tmp_path) == []


@pytest.mark.parametrize("kinds", [("cabecera",), ("detalle",), ("cabecera", "libro")])
def test_both_files_are_required(client, supabase, tmp_path, monkeypatch, kinds):
    monkeypatch.setattr(import_load, "prepare_input", not_called)
    files = {kind: b"a,b\n1,2\n" for kind in kinds}
    response = load(client, supabase, lot_form(files))
    assert response.status_code == 422
    assert response.json() == {"detail": "ARCHIVOS_REQUERIDOS"}
    assert incoming(tmp_path) == []


def test_a_workbook_is_not_supported(client, supabase, tmp_path, monkeypatch):
    monkeypatch.setattr(import_load, "prepare_input", not_called)
    response = load(client, supabase, lot_form({"libro": b"PK\x03\x04"}))
    assert response.status_code == 422
    assert response.json() == {"detail": "FORMATO_NO_SOPORTADO"}
    assert incoming(tmp_path) == []


@pytest.mark.parametrize("revision", [b"xyz", b"A" * 64, b"a" * 63, b"a" * 65, b"g" * 64])
def test_malformed_revision_is_rejected(client, supabase, tmp_path, monkeypatch, revision):
    monkeypatch.setattr(import_load, "prepare_input", not_called)
    response = load(client, supabase, lot_form(lot_files(LOT_1), "2026-09-30", ("revision", revision, None)))
    assert response.status_code == 422
    assert response.json() == {"detail": "REVISION_INVALIDA"}
    assert incoming(tmp_path) == []


def test_empty_revision_is_a_first_attempt(client, supabase, prepared_calls):
    response = load(client, supabase, lot_form(lot_files(LOT_1), "2026-09-30", ("revision", b"", None)))
    assert response.status_code == 201
    assert supabase.rpc_bodies("stage_import_batch")[0]["p_expected_revision"] is None


def test_without_the_write_credential_nothing_is_received(client, supabase, tmp_path, monkeypatch):
    monkeypatch.delenv("EQUITAS_IMPORT_SERVER_JWT")
    monkeypatch.setattr(import_load, "prepare_input", not_called)
    # Cuerpo inválido: el 503 demuestra que no se llegó a leerlo.
    response = client.post("/imports/load", content=b"--roto", headers={**auth_headers(supabase), **MULTIPART})
    assert response.status_code == 503
    assert response.json() == {"detail": "IMPORT_WRITER_NOT_CONFIGURED"}
    assert incoming(tmp_path) == []


def test_form_fields_of_the_load_are_as_of_and_revision_only(client, supabase, monkeypatch):
    """`_receive_form` con el conjunto propio: un campo repetido se rechaza; uno ajeno se ignora."""
    monkeypatch.setattr(import_load, "prepare_input", not_called)
    duplicated = lot_form(lot_files(LOT_1), "2026-09-30", ("as_of", b"2026-09-30", None))
    assert load(client, supabase, duplicated).json() == {"detail": "CAMPO_DUPLICADO"}
    twice = lot_form(lot_files(LOT_1), "2026-09-30", ("revision", b"", None), ("revision", b"", None))
    assert load(client, supabase, twice).json() == {"detail": "CAMPO_DUPLICADO"}


def test_unrelated_fields_are_ignored(client, supabase, prepared_calls):
    body = lot_form(lot_files(LOT_1), "2026-09-30", ("source_updated_at", b"no-es-fecha", None),
                    ("source_updated_at", b"otra", None))
    assert load(client, supabase, body).status_code == 201


@pytest.mark.parametrize("outcome", ["publicado", "bloqueado", "estructura", "proceso"])
def test_nothing_stays_in_incoming(client, supabase, tmp_path, prepared_calls, monkeypatch, outcome):
    files = {"publicado": lot_files(LOT_1), "bloqueado": lot_files(LOT_2),
             "estructura": {"cabecera": b"\x00\x01", "detalle": b"x"}, "proceso": lot_files(LOT_1)}[outcome]
    if outcome == "proceso":
        monkeypatch.setattr(import_load, "prepare_input", raising(ETLError("PREVIEW_PROCESS_FAILED")))
    response = load(client, supabase, lot_form(files, "2026-10-31" if outcome == "bloqueado" else "2026-09-30"))
    assert response.status_code in (201, 422, 503)
    assert incoming(tmp_path) == []
    if prepared_calls:
        assert all(prepared_calls[0]["present"].values())


def test_validation_uses_the_session_tenant_the_csv_profile_and_the_full_portfolio_policy(
        client, supabase, prepared_calls):
    assert load(client, supabase, lot_form(lot_files(LOT_1))).status_code == 201
    [call] = prepared_calls
    assert call["tenant"] == TENANT_A
    assert call["policy"] == "rechazar"
    assert call["profile"]["fecha_corte"] == "2026-09-30"
    profile = json.loads((ROOT / "contracts" / "source-mapping.sintetico-csv.v1.json").read_text(encoding="utf-8"))
    assert {**profile, "fecha_corte": "2026-09-30"} == call["profile"]
    assert sorted(call["files"]) == ["cabecera", "detalle"]
    assert isinstance(call["lock_fd"], int)
    # El perfil versionado no se modifica al declarar la fecha.
    assert import_load._profile("2026-10-31")["fecha_corte"] == "2026-10-31"
    assert "fecha_corte" not in profile or profile["fecha_corte"] != "2026-10-31"


# ---- 3. Rechazo estructural


@pytest.mark.parametrize(
    ("location", "expected"),
    [
        ({"archivo": "detalle", "linea": 7, "campo": "NOTD_capital"},
         {"archivo": "detalle", "linea": 7, "columna": "NOTD_capital"}),
        ({"archivo": "cabecera", "linea": 0, "campo": "*"}, {"archivo": "cabecera", "linea": None, "columna": None}),
        (None, {"archivo": None, "linea": None, "columna": None}),
    ],
)
def test_structural_rejection_points_to_file_line_and_column(client, supabase, monkeypatch, location, expected):
    monkeypatch.setattr(import_load, "prepare_input", raising(PreviewSourceError("ESTRUCTURA_INVALIDA", location)))
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 422
    body = response.json()
    assert body["resultado"] == "RECHAZADO"
    assert body["fecha_corte"] == "2026-09-30"
    assert body["intento_registrado"] is True
    assert body["estructura"] == {"codigo": "ESTRUCTURA_INVALIDA",
                                  "descripcion": import_load.STRUCTURAL_MESSAGES["ESTRUCTURA_INVALIDA"], **expected}
    assert_not_modified(response)
    [row] = batches(supabase)
    assert (row["status"], row["created_by"], row["source"], row["counts"]) == ("FALLIDO", 4, "WEB_UPLOAD", {})
    assert row["supersedes"] is None
    assert str(uuid.UUID(row["idempotency_key"])) == row["idempotency_key"]
    assert "stage_import_batch" not in supabase.rpc_order()


def test_unknown_structural_code_has_a_generic_description(client, supabase, monkeypatch):
    monkeypatch.setattr(import_load, "prepare_input", raising(PreviewSourceError("OTRO_CODIGO")))
    body = load(client, supabase, lot_form(lot_files(LOT_1))).json()
    assert body["estructura"]["descripcion"] == "El archivo no se pudo interpretar como un lote."


def test_real_binary_file_is_rejected_with_its_location(client, supabase, prepared_calls):
    files = {**lot_files(LOT_1), "cabecera": b"\x00\x01" + CENTINELA.encode() + b"\x00" * 20}
    response = load(client, supabase, lot_form(files))
    assert response.status_code == 422
    assert response.json()["estructura"] == {
        "codigo": "CONTENIDO_NO_TEXTO", "descripcion": import_load.STRUCTURAL_MESSAGES["CONTENIDO_NO_TEXTO"],
        "archivo": "cabecera", "linea": None, "columna": None}
    assert CENTINELA not in response.text


def test_real_missing_column_names_the_column(client, supabase, prepared_calls):
    files = {**lot_files(LOT_1), "cabecera": f"{CENTINELA},x\n1,2\n".encode()}
    response = load(client, supabase, lot_form(files))
    assert response.status_code == 422
    structure = response.json()["estructura"]
    assert (structure["codigo"], structure["archivo"], structure["linea"], structure["columna"]) == (
        "COLUMNA_OBLIGATORIA_AUSENTE", "cabecera", 1, "ClaveAgrupacion")
    assert CENTINELA not in response.text


def test_missing_column_is_described_as_such(client, supabase, prepared_calls):
    files = {**lot_files(LOT_1), "cabecera": b"x,y\n1,2\n"}
    description = load(client, supabase, lot_form(files)).json()["estructura"]["descripcion"]
    assert description != "El archivo no se pudo interpretar como un lote."


def test_same_person_and_file_twice_is_one_failed_record(client, supabase, monkeypatch):
    monkeypatch.setattr(import_load, "prepare_input", raising(PreviewSourceError("ESTRUCTURA_INVALIDA")))
    first = load(client, supabase, lot_form(lot_files(LOT_1)))
    second = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert first.json() == second.json()
    assert len(batches(supabase, status="FALLIDO")) == 1


def test_two_admins_with_the_same_rejected_file_leave_one_record_each(client, supabase, monkeypatch):
    monkeypatch.setattr(import_load, "prepare_input", raising(PreviewSourceError("ESTRUCTURA_INVALIDA")))
    assert load(client, supabase, lot_form(lot_files(LOT_1)), AUTH_ADMIN).json()["intento_registrado"] is True
    assert load(client, supabase, lot_form(lot_files(LOT_1)), AUTH_ADMIN_2).json()["intento_registrado"] is True
    rows = batches(supabase, status="FALLIDO")
    assert sorted(row["created_by"] for row in rows) == [3, 4]
    assert len({row["idempotency_key"] for row in rows}) == 2


def test_another_cutoff_is_another_attempt(client, supabase, monkeypatch):
    monkeypatch.setattr(import_load, "prepare_input", raising(PreviewSourceError("ESTRUCTURA_INVALIDA")))
    load(client, supabase, lot_form(lot_files(LOT_1), "2026-09-30"))
    load(client, supabase, lot_form(lot_files(LOT_1), "2026-10-31"))
    assert sorted(row["as_of"] for row in batches(supabase, status="FALLIDO")) == ["2026-09-30", "2026-10-31"]


@pytest.mark.parametrize("failure", ["rechazo", "red"])
def test_rejection_is_reported_even_if_it_could_not_be_recorded(client, supabase, monkeypatch, caplog, failure):
    monkeypatch.setattr(import_load, "prepare_input", raising(PreviewSourceError("ESTRUCTURA_INVALIDA")))
    if failure == "rechazo":
        supabase.rpc_message = "CENTINELA_ERROR_INESPERADO"
    else:
        supabase.raise_on.add("/rest/v1/rpc/record_import_batch")
    with caplog.at_level(logging.INFO, logger="equitas.api"):
        response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 422
    assert response.json()["intento_registrado"] is False
    assert response.json()["resultado"] == "RECHAZADO"
    assert "IMPORT_RECHAZO_SIN_REGISTRO codigo=BATCH_WRITE_FAILED" in caplog.text
    assert "CENTINELA" not in caplog.text and "CENTINELA" not in response.text


def test_rejection_already_recorded_with_other_counts_counts_as_recorded(client, supabase, monkeypatch):
    monkeypatch.setattr(import_load, "prepare_input", raising(PreviewSourceError("ESTRUCTURA_INVALIDA")))
    supabase.rpc_message = "IDEMPOTENCY_KEY_CONFLICT"
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 422
    assert response.json()["intento_registrado"] is True


@pytest.mark.parametrize(("message", "code"), [("ROLE_NOT_ALLOWED", "ROLE_FORBIDDEN"),
                                               ("ACTOR_NOT_ACTIVE_MEMBER", "MEMBERSHIP_REQUIRED")])
def test_a_forbidden_registration_is_propagated(client, supabase, monkeypatch, message, code):
    monkeypatch.setattr(import_load, "prepare_input", raising(PreviewSourceError("ESTRUCTURA_INVALIDA")))
    supabase.rpc_message = message
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 403
    assert response.json() == {"detail": code}


# ---- 4. Lote BLOQUEADO (lote de ejemplo 2)


def test_blocked_lot_separates_errors_and_warnings_with_totals(client, supabase, prepared_calls):
    response = load(client, supabase, lot_form(lot_files(LOT_2), "2026-10-31"))
    assert response.status_code == 422
    body = response.json()
    assert body["resultado"] == "RECHAZADO"
    assert body["fecha_corte"] == "2026-10-31"
    assert body["intento_registrado"] is True
    assert_not_modified(response)
    codes = source_contract()["codigos"]
    errors = {item["codigo"]: item for item in body["errores"]["por_codigo"]}
    expected = {item["codigo"] for item in MANIFEST["lotes"][LOT_2.name]["errores_a_proposito"]}
    assert expected <= set(errors)
    for code, item in errors.items():
        assert item["descripcion"] == codes[code]["descripcion"]
    assert body["errores"]["total"] == sum(item["cantidad"] for item in body["errores"]["por_codigo"])
    # Ordenado por cantidad y código.
    ordering = [(-item["cantidad"], item["codigo"]) for item in body["errores"]["por_codigo"]]
    assert ordering == sorted(ordering)
    shown = {(i["archivo"], i["linea"], i["columna"], i["codigo"]) for i in body["errores"]["detalle"]}
    for item in MANIFEST["lotes"][LOT_2.name]["errores_a_proposito"]:
        assert (item["archivo"], item["linea"], item["columna"], item["codigo"]) in shown
    assert all(item["efecto"] != "ALERTA" for item in body["errores"]["detalle"])
    assert body["advertencias"]["detalle"] and all(i["efecto"] == "ALERTA" for i in body["advertencias"]["detalle"])
    assert {i["codigo"] for i in body["advertencias"]["por_codigo"]} == {"CONTACTO_PLACEHOLDER",
                                                                        "ESTADO_ORIGEN_NO_INFORMADO"}
    assert body["hallazgos_total"] == body["errores"]["total"] + body["advertencias"]["total"]
    assert body["hallazgos_mostrados"] == body["hallazgos_total"]
    assert body["truncado"] is False
    blockers = {item["codigo"]: item["descripcion"] for item in body["motivos"]}
    assert set(blockers) == {"CUARENTENA_EXCEDE_IMPORTE", "CUARENTENA_EXCEDE_OBJETOS",
                             "CUARENTENA_IMPORTE_NO_EVALUABLE"}
    assert blockers["CUARENTENA_EXCEDE_OBJETOS"] == source_contract()["codigos_resumen"]["CUARENTENA_EXCEDE_OBJETOS"]
    assert body["resumen"]["objetos"] == 21
    # Se registra como FALLIDO, con los conteos del documento, y nunca llega a staging.
    [row] = batches(supabase, status="FALLIDO")
    assert row["counts"]["objetos"] == 21
    assert "stage_import_batch" not in supabase.rpc_order()


def test_blocked_lot_never_quotes_values_of_the_file(client, supabase, prepared_calls, caplog):
    with caplog.at_level(logging.DEBUG):
        response = load(client, supabase, lot_form(with_sentinel(LOT_2), "2026-10-31"))
    assert response.status_code == 422
    assert ("detalle", 9, "NOTD_totalActualizado", "IMPORTE_NO_NUMERICO") in {
        (i["archivo"], i["linea"], i["columna"], i["codigo"]) for i in response.json()["errores"]["detalle"]}
    for text in (response.text, caplog.text):
        assert CENTINELA not in text
        assert "Persona Demo" not in text
        assert "example.invalid" not in text


def test_truncated_findings_are_declared(client, supabase, prepared_calls, monkeypatch):
    monkeypatch.setattr(worker, "MAX_FINDINGS", 3)
    body = load(client, supabase, lot_form(lot_files(LOT_2), "2026-10-31")).json()
    assert body["truncado"] is True
    assert body["hallazgos_mostrados"] == 3
    assert body["hallazgos_total"] > 3
    assert body["errores"]["total"] + body["advertencias"]["total"] == body["hallazgos_total"]


def test_blocker_descriptions_fall_back_to_a_fixed_text():
    described = {item["codigo"]: item["descripcion"] for item in import_load._blockers(
        ["FECHA_VACIA", "LOTE_VACIO", "CODIGO_SIN_TEXTO"])}
    assert described["FECHA_VACIA"] == source_contract()["codigos"]["FECHA_VACIA"]["descripcion"]
    assert described["LOTE_VACIO"] == source_contract()["codigos_resumen"]["LOTE_VACIO"]
    assert described["CODIGO_SIN_TEXTO"] == import_load.BLOCKER_FALLBACK


# ---- 5. Publicable: límites, catálogos y staging


def test_record_limit_is_reported_before_writing(client, supabase, prepared_calls, monkeypatch):
    monkeypatch.setattr(import_load, "MAX_STAGED_ROWS", 10)
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 422
    body = response.json()
    assert body["motivos"][0]["codigo"] == "LIMITE_REGISTROS_EXCEDIDO"
    assert "10 registros" in body["mensaje"]
    assert body["resumen"]["objetos"] == 20
    assert_not_modified(response)
    # No llega a staging: lo único que escribe es el registro del intento, cerrado como FALLIDO (encargo §7.6).
    assert supabase.rpc_order() == ["record_import_batch"]
    assert body["intento_registrado"] is True
    assert len(batches(supabase, status="FALLIDO")) == 1


def test_record_limit_is_two_hundred_thousand():
    assert import_load.MAX_STAGED_ROWS == 200_000


def test_missing_catalog_keys_stop_before_staging(client, supabase, prepared_calls):
    supabase.tables["currency"] = []
    supabase.tables["debtor_type"] = [{"id": 1, "key": "AGUA"}]
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 503
    body = response.json()
    assert (body["resultado"], body["codigo"]) == ("NO_COMPLETADO", "CATALOGO_INCOMPLETO")
    assert body["faltantes"] == ["currency:ARS", "debtor_type:INMUEBLE", "debtor_type:RODADO"]
    assert_not_modified(response)
    assert supabase.rpc_order() == []


@pytest.mark.parametrize("failure", ["rechazo", "red", "forma"])
def test_unreadable_catalogs_stop_before_staging(client, supabase, prepared_calls, monkeypatch, failure):
    if failure == "rechazo":
        supabase.fail_tables.add("currency")
    elif failure == "red":
        supabase.raise_on.add("/rest/v1/debt_status")
    else:
        monkeypatch.setattr(import_load, "CATALOG_KEY_COLUMNS", {})
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 503
    assert response.json()["codigo"] == "CATALOGOS_NO_DISPONIBLES"
    assert "CENTINELA" not in response.text
    assert supabase.rpc_order() == []


class _Rows:
    def __init__(self, data):
        self.data = data

    def table(self, _name):
        return self

    def select(self, _column):
        return self

    def execute(self):
        return self


@pytest.mark.parametrize(("data", "error"), [({"key": "ARS"}, TypeError), ([{"otra": "ARS"}], KeyError)])
def test_catalog_reader_fails_closed_on_an_unexpected_shape(data, error):
    with pytest.raises(error):
        import_load._check_catalogs(_Rows(data), {"currency": ["ARS"]})


def test_catalog_reader_lists_what_is_missing_in_order():
    rows = _Rows([{"key": "AGUA"}, {"key": "ARS"}])
    assert import_load._check_catalogs(rows, {"debtor_type": ["AGUA", "RODADO"], "contact_type": ["EMAIL"]}) == [
        "contact_type:EMAIL", "debtor_type:RODADO"]


def test_catalogs_are_read_with_the_user_token(client, supabase, prepared_calls):
    token = supabase.token(AUTH_ADMIN)
    client.post("/imports/load", content=lot_form(lot_files(LOT_1)),
                headers={"Authorization": f"Bearer {token}", **MULTIPART})
    reads = [c for c in supabase.calls if c.url.path == "/rest/v1/currency"]
    assert reads and all(c.headers["authorization"] == f"Bearer {token}" for c in reads)


def test_same_lot_already_published_is_reported_without_publishing_again(client, supabase, prepared_calls):
    first = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert first.status_code == 201
    supabase.calls.clear()
    second = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert second.status_code == 200
    body = second.json()
    assert body["resultado"] == "YA_CARGADO"
    assert body["lote"] == first.json()["lote"]
    assert body["publicado"] == first.json()["publicado"]
    assert body["resumen"] == first.json()["resumen"]
    assert supabase.rpc_order() == ["stage_import_batch"]


def test_staging_that_finds_a_partial_portfolio_is_a_rejection(client, supabase, prepared_calls):
    supabase.rpc_reply["stage_import_batch"] = {"status": "FALLIDO", "batch_id": 9,
                                                "counts": {"ausentes": {"objetos": 2, "obligaciones": 3}}}
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 422
    body = response.json()
    assert body["resultado"] == "RECHAZADO"
    assert body["motivos"][0]["codigo"] == "PARTIAL_LOAD_REJECTED"
    assert body["ausentes"] == {"objetos": 2, "obligaciones": 3}
    assert body["lote"] == 9
    assert "errores" in body and "resumen" in body
    assert_not_modified(response)
    assert supabase.rpc_order() == ["stage_import_batch"]


@pytest.mark.parametrize(
    ("message", "status", "result", "code"),
    [
        # Sin reintento pedido, un conflicto de contenido o una entrada que la base no acepta no se arreglan
        # repitiendo: no se invita a repetir (el caso CON revisión está en test_stale_retry_reference_*).
        ("IMPORT_REVISION_CONFLICT", 503, "NO_COMPLETADO", "PREPARACION_RECHAZADA"),
        ("IMPORT_INPUT_INVALID", 503, "NO_COMPLETADO", "PREPARACION_RECHAZADA"),
        ("SHARED_PERSON_OTHER_TENANT", 422, "RECHAZADO", None),
        ("IMPORT_RETRY_REQUIRED", 503, "NO_COMPLETADO", "IMPORT_RETRY_REQUIRED"),
        ("CENTINELA_OTRO_RECHAZO", 503, "NO_COMPLETADO", "STAGING_NO_DISPONIBLE"),
    ],
)
def test_each_staging_rejection_has_its_outcome(client, supabase, prepared_calls, message, status, result, code):
    supabase.rpc_reply["stage_import_batch"] = message
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == status
    body = response.json()
    assert body["resultado"] == result
    assert body.get("codigo") == code
    assert_not_modified(response)
    assert "CENTINELA" not in response.text
    if code == "PREPARACION_RECHAZADA":
        assert "repetí" not in body["mensaje"].lower()
    if message == "SHARED_PERSON_OTHER_TENANT":
        assert body["motivos"][0]["codigo"] == "SHARED_PERSON_OTHER_TENANT"
    assert supabase.rpc_order() == ["stage_import_batch"]


@pytest.mark.parametrize("message", ["ROLE_NOT_ALLOWED", "ACTOR_NOT_ACTIVE_MEMBER"])
def test_staging_refused_by_role_is_403(client, supabase, prepared_calls, message):
    supabase.rpc_reply["stage_import_batch"] = message
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 403
    assert response.json() == {"detail": "ROLE_FORBIDDEN"}
    assert supabase.rpc_order() == ["stage_import_batch"]


@pytest.mark.parametrize("failure", ["red", "forma", "estado", "lote", "revision"])
def test_staging_without_a_usable_answer_changes_nothing(client, supabase, prepared_calls, failure):
    replies = {"forma": httpx.Response(200, json=[1]),
               "estado": {"status": "RECIBIDO", "batch_id": 1, "revision": "a" * 64},
               "lote": {"status": "VALIDADO", "batch_id": "1", "revision": "a" * 64},
               "revision": {"status": "VALIDADO", "batch_id": 1}}
    if failure == "red":
        supabase.raise_on.add("/rest/v1/rpc/stage_import_batch")
    else:
        supabase.rpc_reply["stage_import_batch"] = replies[failure]
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 503
    expected = "SERVICIO_NO_DISPONIBLE" if failure in ("red", "forma") else "STAGING_ESTADO_INESPERADO"
    assert response.json()["codigo"] == expected
    assert_not_modified(response)
    assert supabase.rpc_order() == ["stage_import_batch"]


# ---- Reintento explícito: `read_import_receipt`, nunca publish ni settle


def failed_attempt(client, supabase):
    """Primer intento cerrado como FALLIDO: la publicación falla y `settle` lo cierra."""
    supabase.raise_on.add("/rest/v1/rpc/publish_import_batch")
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    supabase.raise_on.clear()
    assert response.status_code == 503 and response.json()["estado"] == "FALLIDO"
    return response.json()


def test_retry_of_a_closed_attempt_needs_confirmation_and_then_publishes(client, supabase, prepared_calls):
    first = failed_attempt(client, supabase)
    supabase.calls.clear()
    second = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert second.status_code == 409
    body = second.json()
    assert (body["resultado"], body["estado_anterior"]) == ("REQUIERE_CONFIRMACION", "FALLIDO")
    assert body["revision"] == first["revision"]
    assert_not_modified(second)
    assert supabase.rpc_order() == ["stage_import_batch", "read_import_receipt"]
    [lookup] = supabase.rpc_bodies("read_import_receipt")
    document = supabase.rpc_bodies("stage_import_batch")[0]["p_document"]
    assert lookup == {"p_actor_user": 4, "p_tenant": TENANT_A,
                      "p_idempotency_key": canonical_json_hash(document["identity"])}
    third = load(client, supabase, lot_form(lot_files(LOT_1), "2026-09-30", ("revision", body["revision"].encode(), None)))
    assert third.status_code == 201
    assert supabase.rpc_bodies("stage_import_batch")[-1]["p_expected_revision"] == body["revision"]


@pytest.mark.parametrize("state", ["FALLIDO", "DESCARTADO", "REQUIERE_NUEVO_PREVIEW"])
def test_closed_receipt_offers_its_revision(client, supabase, prepared_calls, state):
    supabase.rpc_reply["stage_import_batch"] = "IMPORT_REVALIDATION_REQUIRED"
    supabase.rpc_reply["read_import_receipt"] = {"status": state, "revision": "b" * 64, "batch_id": 3}
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 409
    assert (response.json()["revision"], response.json()["estado_anterior"]) == ("b" * 64, state)
    assert "publish_import_batch" not in supabase.rpc_order()
    assert "settle_import_batch" not in supabase.rpc_order()


@pytest.mark.parametrize("message", ["ROLE_NOT_ALLOWED", "ACTOR_NOT_ACTIVE_MEMBER"])
def test_receipt_refused_by_role_is_403(client, supabase, prepared_calls, message):
    supabase.rpc_reply["stage_import_batch"] = "IMPORT_REVALIDATION_REQUIRED"
    supabase.rpc_reply["read_import_receipt"] = message
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 403
    assert response.json() == {"detail": "ROLE_FORBIDDEN"}
    assert supabase.rpc_order() == ["stage_import_batch", "read_import_receipt"]


def test_stale_retry_reference_asks_to_choose_the_files_again(client, supabase, prepared_calls):
    supabase.rpc_reply["stage_import_batch"] = "IMPORT_REVISION_CONFLICT"
    response = load(client, supabase, lot_form(lot_files(LOT_1), "2026-09-30", ("revision", b"c" * 64, None)))
    assert response.status_code == 409
    body = response.json()
    assert body["resultado"] == "REQUIERE_CONFIRMACION"
    assert (body["revision"], body["estado_anterior"]) == (None, None)
    assert_not_modified(response)
    assert supabase.rpc_order() == ["stage_import_batch"]


def test_a_different_fingerprint_from_the_database_stops_before_publishing(client, supabase, prepared_calls):
    supabase.rpc_reply["stage_import_batch"] = {"status": "VALIDADO", "batch_id": 1, "revision": "a" * 64,
                                                "idempotency_key": "f" * 64}
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 503
    assert response.json()["codigo"] == "HUELLA_INCONSISTENTE"
    assert_not_modified(response)
    assert supabase.rpc_order() == ["stage_import_batch"]


@pytest.mark.parametrize("receipt", ["BATCH_NOT_FOUND", "red", "forma",
                                     {"status": "VALIDADO", "revision": "b" * 64},
                                     {"status": "PUBLICADO", "revision": "b" * 64},
                                     {"status": "FALLIDO", "revision": "B" * 64},
                                     {"status": "FALLIDO", "revision": None}])
def test_retry_without_a_usable_receipt_is_not_completed(client, supabase, prepared_calls, receipt):
    supabase.rpc_reply["stage_import_batch"] = "IMPORT_REVALIDATION_REQUIRED"
    if receipt == "red":
        supabase.raise_on.add("/rest/v1/rpc/read_import_receipt")
    elif receipt == "forma":
        supabase.rpc_reply["read_import_receipt"] = httpx.Response(200, json="texto")
    else:
        supabase.rpc_reply["read_import_receipt"] = receipt
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 503
    assert response.json()["codigo"] == "INTENTO_ANTERIOR_SIN_REFERENCIA"
    assert_not_modified(response)
    assert supabase.rpc_order() == ["stage_import_batch", "read_import_receipt"]


def test_receipt_not_found_with_the_default_double(client, supabase, prepared_calls):
    """Sin `rpc_reply`: el doble responde BATCH_NOT_FOUND porque no hay publicación con esa identidad."""
    supabase.rpc_reply["stage_import_batch"] = "IMPORT_REVALIDATION_REQUIRED"
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.json()["codigo"] == "INTENTO_ANTERIOR_SIN_REFERENCIA"


# ---- 6. Orden y guardas


def test_publication_order_actor_and_tenant_come_from_the_session(client, supabase, prepared_calls):
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 201
    order = supabase.rpc_order()
    assert order == ["stage_import_batch", "record_access_audit", "publish_import_batch"]
    for name in order:
        [sent] = supabase.rpc_bodies(name)
        assert (sent["p_actor_user"], sent["p_tenant"]) == (4, TENANT_A)
    [stage] = supabase.rpc_bodies("stage_import_batch")
    assert stage["p_document"]["source"] == "WEB_UPLOAD"
    assert stage["p_expected_revision"] is None
    assert stage["p_rows"] and {row["kind"] for row in stage["p_rows"]} == {"person", "object"}
    batch_id = response.json()["lote"]
    [audit] = supabase.rpc_bodies("record_access_audit")
    assert audit["p_action"] == "IMPORT_CONFIRM"
    assert audit["p_target"] == str(batch_id)
    [publish] = supabase.rpc_bodies("publish_import_batch")
    assert publish["p_batch_id"] == batch_id
    assert publish["p_idempotency_key"] == canonical_json_hash(stage["p_document"]["identity"])
    job = supabase._publication(batch_id)
    assert publish["p_revision"] == job["revision"]
    # Toda escritura va con la credencial dedicada, nunca con el token de la persona.
    for call in supabase.calls:
        if call.url.path.startswith("/rest/v1/rpc/"):
            assert call.headers["authorization"] == f"Bearer {import_load.imports.os.environ['EQUITAS_IMPORT_SERVER_JWT']}"


def test_audit_key_is_per_person_batch_and_revision(client, supabase, prepared_calls):
    """Dos ADMIN que confirman el mismo lote dejan dos auditorías; la misma persona, una."""
    supabase.raise_on.update({"/rest/v1/rpc/publish_import_batch", "/rest/v1/rpc/settle_import_batch"})
    for user in (AUTH_ADMIN, AUTH_ADMIN, AUTH_ADMIN_2):
        response = load(client, supabase, lot_form(lot_files(LOT_1)), user)
        assert response.status_code == 503 and response.json()["resultado"] == "NO_CONFIRMADO"
    keys = [body["p_idempotency_key"] for body in supabase.rpc_bodies("record_access_audit")]
    assert keys[0] == keys[1] != keys[2]
    assert sorted(row["actor"] for row in supabase.tables["access_audit"]) == [3, 4]


@pytest.mark.parametrize("change", ["rol", "revocada", "sesion"])
def test_session_is_confirmed_again_before_writing(client, supabase, prepared_calls, change):
    def stage_then_change(body):
        if change == "rol":
            next(m for m in supabase.tables["tenant_user"] if m["user"] == 4)["role"] = 2
        elif change == "revocada":
            next(m for m in supabase.tables["tenant_user"] if m["user"] == 4)["status"] = False
        else:
            supabase.auth_status = 401
        return supabase._stage_import_batch(body)

    supabase.rpc_reply["stage_import_batch"] = stage_then_change
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == {"rol": 403, "revocada": 403, "sesion": 401}[change]
    assert response.json()["detail"] == {"rol": "ROLE_FORBIDDEN", "revocada": "MEMBERSHIP_REQUIRED",
                                         "sesion": "AUTH_REQUIRED"}[change]
    assert supabase.rpc_order() == ["stage_import_batch"]


@pytest.mark.parametrize("failure", ["rechazo", "red", "sin_id"])
def test_without_audit_there_is_no_publication(client, supabase, prepared_calls, failure):
    if failure == "rechazo":
        supabase.rpc_reply["record_access_audit"] = "OBJECT_NOT_IN_TENANT"
    elif failure == "red":
        supabase.raise_on.add("/rest/v1/rpc/record_access_audit")
    else:
        supabase.rpc_reply["record_access_audit"] = {"audit_id": None, "created": False}
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 503
    assert response.json()["codigo"] == "AUDITORIA_NO_DISPONIBLE"
    assert_not_modified(response)
    assert supabase.rpc_order() == ["stage_import_batch", "record_access_audit"]


# ---- 7. Publicación


def test_accepted_lot_is_published_with_a_summary(client, supabase, prepared_calls, caplog):
    with caplog.at_level(logging.DEBUG):
        response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 201
    body = response.json()
    assert body["resultado"] == "PUBLICADO"
    assert body["fecha_corte"] == "2026-09-30"
    assert type(body["lote"]) is int
    expected = MANIFEST["lotes"][LOT_1.name]
    assert body["resumen"]["objetos"] == expected["objetos_en_el_archivo"]
    assert body["resumen"]["objetos_aceptados"] == expected["objetos_publicados"]
    assert body["resumen"]["objetos_en_cuarentena"] == len(expected["objetos_en_cuarentena"])
    assert body["resumen"]["filas"]["detalle"]["leidas"] == 36
    assert body["publicado"]["objetos"] == 20
    assert body["errores"]["total"] == 1 and body["advertencias"]["total"] == 4
    assert "La carga se completó" in body["mensaje"]
    assert f"IMPORT_PUBLICADO lote={body['lote']}" in caplog.text
    assert supabase._publication(body["lote"])["status"] == "PUBLICADO"
    for text in (response.text, caplog.text):
        assert "Persona Demo" not in text and "example.invalid" not in text


def test_third_example_lot_is_a_later_portfolio(client, supabase, prepared_calls):
    assert load(client, supabase, lot_form(lot_files(LOT_1))).status_code == 201
    response = load(client, supabase, lot_form(lot_files(LOT_3), "2026-10-31"))
    assert response.status_code == 201
    assert response.json()["resumen"]["objetos_aceptados"] == MANIFEST["lotes"][LOT_3.name]["objetos_publicados"]
    assert len(supabase.publications) == 2


@pytest.mark.parametrize("failure", ["red", "rechazo"])
def test_failed_publish_settled_as_published_is_success(client, supabase, prepared_calls, failure):
    if failure == "red":
        supabase.raise_on.add("/rest/v1/rpc/publish_import_batch")
    else:
        supabase.rpc_reply["publish_import_batch"] = "CENTINELA_TIEMPO_AGOTADO"

    def settled(body):
        job = supabase._publication(body["p_batch_id"])
        assert body["p_idempotency_key"] == job["idempotency_key"]
        assert body["p_status"] == "FALLIDO"
        job["status"] = "PUBLICADO"
        return supabase._receipt(job)

    supabase.rpc_reply["settle_import_batch"] = settled
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 201
    assert response.json()["resultado"] == "PUBLICADO"
    assert supabase.rpc_order() == ["stage_import_batch", "record_access_audit", "publish_import_batch",
                                    "settle_import_batch"]


def test_failed_publish_settled_as_failed_is_not_completed(client, supabase, prepared_calls):
    supabase.raise_on.add("/rest/v1/rpc/publish_import_batch")
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 503
    body = response.json()
    assert (body["resultado"], body["codigo"], body["estado"]) == ("NO_COMPLETADO", "PUBLICACION_NO_COMPLETADA",
                                                                    "FALLIDO")
    assert body["mensaje"].startswith("La carga no se completó.")
    assert body["revision"] == supabase._publication(body["lote"])["revision"]
    assert_not_modified(response)


def test_settle_also_failing_is_not_confirmed(client, supabase, prepared_calls):
    supabase.raise_on.update({"/rest/v1/rpc/publish_import_batch", "/rest/v1/rpc/settle_import_batch"})
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 503
    body = response.json()
    assert body["resultado"] == "NO_CONFIRMADO"
    assert type(body["lote"]) is int
    assert "no se duplica" in body["mensaje"]


@pytest.mark.parametrize("message", ["ROLE_NOT_ALLOWED", "ACTOR_NOT_ACTIVE_MEMBER"])
def test_publish_refused_by_role_is_403_without_settling(client, supabase, prepared_calls, message):
    supabase.rpc_reply["publish_import_batch"] = message
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 403
    assert response.json() == {"detail": "ROLE_FORBIDDEN"}
    assert "settle_import_batch" not in supabase.rpc_order()


@pytest.mark.parametrize("path", ["publish", "settle"])
def test_portfolio_changed_while_preparing(client, supabase, prepared_calls, path):
    changed = {"status": "REQUIERE_NUEVO_PREVIEW", "batch_id": 1}
    if path == "publish":
        supabase.rpc_reply["publish_import_batch"] = changed
    else:
        supabase.raise_on.add("/rest/v1/rpc/publish_import_batch")
        supabase.rpc_reply["settle_import_batch"] = changed
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 503
    body = response.json()
    assert body["resultado"] == "NO_COMPLETADO"
    assert body["estado"] == "REQUIERE_NUEVO_PREVIEW"
    assert body["mensaje"].startswith("La cartera cambió mientras se preparaba esta carga")
    assert_not_modified(response)


def test_report_is_built_before_staging(client, supabase, prepared_calls, monkeypatch):
    """Si armar el resumen falla, no se llegó a escribir nada."""
    monkeypatch.setattr(import_load, "_summary", lambda prepared: 1 / 0)
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 500
    assert supabase.rpc_order() == []


# ---- 8. Concurrencia y límites del proceso


def test_a_second_simultaneous_load_is_429(client, supabase, tmp_path, monkeypatch):
    monkeypatch.setattr(import_load, "prepare_input", not_called)
    store = UploadStore(tmp_path / "almacen")
    with store.processing_slot():
        response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 429
    body = response.json()
    assert (body["resultado"], body["codigo"]) == ("NO_COMPLETADO", "CARGA_EN_CURSO")
    assert_not_modified(response)
    assert incoming(tmp_path) == []
    assert supabase.rpc_order() == []


@pytest.mark.parametrize("code", ["PREVIEW_TIME_LIMIT", "PREVIEW_WORK_LIMIT"])
def test_process_limits_are_a_rejection(client, supabase, monkeypatch, code):
    monkeypatch.setattr(import_load, "prepare_input", raising(ETLError(code)))
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 422
    body = response.json()
    assert body["resultado"] == "RECHAZADO"
    assert body["motivos"][0]["codigo"] == "LIMITE_PROCESO_EXCEDIDO"
    assert_not_modified(response)
    # El intento queda registrado y cerrado como FALLIDO, igual que cualquier otro rechazo (encargo §7.6).
    assert supabase.rpc_order() == ["record_import_batch"]
    assert body["intento_registrado"] is True
    assert len(batches(supabase, status="FALLIDO")) == 1


def test_other_process_failure_is_not_a_file_problem(client, supabase, monkeypatch):
    monkeypatch.setattr(import_load, "prepare_input", raising(ETLError("PREVIEW_PROCESS_FAILED")))
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 503
    body = response.json()
    assert (body["resultado"], body["codigo"]) == ("NO_COMPLETADO", "PROCESO_NO_DISPONIBLE")
    assert "No es un problema del archivo" in body["mensaje"]
    assert supabase.rpc_order() == []


@pytest.mark.parametrize("error", [UploadStoreError(), OSError("CENTINELA_RUTA")])
def test_unreadable_upload_area_is_503(client, supabase, monkeypatch, tmp_path, error):
    monkeypatch.setattr(import_load, "prepare_input", not_called)

    def broken(self, token):
        raise error

    monkeypatch.setattr(UploadStore, "incoming_files", broken)
    response = load(client, supabase, lot_form(lot_files(LOT_1)))
    assert response.status_code == 503
    assert response.json() == {"detail": "ALMACEN_TEMPORAL_NO_DISPONIBLE"}
    assert "CENTINELA" not in response.text
    assert incoming(tmp_path) == []


# ---- 9. Ningún error cita valores del archivo


def test_no_error_response_quotes_the_file(client, supabase, prepared_calls, monkeypatch):
    files = with_sentinel(LOT_2)
    responses = [load(client, supabase, lot_form(files, "2026-10-31"))]
    responses.append(load(client, supabase, lot_form({**files, "cabecera": f"{CENTINELA},y\n".encode()})))
    responses.append(load(client, supabase, lot_form({"cabecera": files["cabecera"]})))
    supabase.rpc_reply["stage_import_batch"] = "SHARED_PERSON_OTHER_TENANT"
    responses.append(load(client, supabase, lot_form(lot_files(LOT_1))))
    assert [r.status_code for r in responses] == [422, 422, 422, 422]
    for response in responses:
        assert CENTINELA not in response.text
        assert "DEMO6-" not in response.text
        assert "99-96" not in response.text
