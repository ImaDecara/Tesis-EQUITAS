"""Noche 7: lo que el proceso de validación entrega a la carga directa, sin valores del archivo.

`prepare()` y `rejection()` en proceso con los lotes sintéticos de `front/public/ejemplos/carga-csv/` y el
perfil CSV; la forma cerrada de la ubicación (`reader_location`, `_location`); y `UploadStore.incoming_files`.
"""

import json
import os
from pathlib import Path
from types import SimpleNamespace

import pytest

from api.upload_store import UploadStore, UploadStoreError
from ETL.config import ETLError
from ETL.transform import (
    StructuralRejection,
    prepare_batch,
    reader_location,
    source_contract,
)
from ETL.validate_source import ValidationError
from services import import_preview_process as process
from services import import_preview_worker as worker

ROOT = Path(__file__).resolve().parents[2]
EXAMPLES = ROOT / "front" / "public" / "ejemplos" / "carga-csv"
MANIFEST = json.loads((EXAMPLES / "manifiesto.json").read_text(encoding="utf-8"))
CSV_PROFILE = json.loads((ROOT / "contracts" / "source-mapping.sintetico-csv.v1.json").read_text(encoding="utf-8"))
CENTINELA = "CENTINELA_VALOR_DEL_ARCHIVO"


def profile(as_of: str) -> dict:
    return {**CSV_PROFILE, "fecha_corte": as_of}


def lot_paths(name: str) -> dict[str, Path]:
    return {kind: EXAMPLES / name / f"{kind}.csv" for kind in ("cabecera", "detalle")}


def request(name: str, tenant: int = 1) -> dict:
    lot = MANIFEST["lotes"][name]
    return {"files": {k: str(v) for k, v in lot_paths(name).items()}, "profile": profile(lot["fecha_corte"]),
            "tenant": tenant, "policy": "rechazar"}


# ---- prepare() con los lotes de ejemplo


@pytest.mark.parametrize("name", ["1-cartera-2026-09-30", "3-cartera-2026-10-31"])
def test_example_lots_one_and_three_are_publishable(name):
    result = worker.prepare(request(name))
    expected = MANIFEST["lotes"][name]
    assert result["publishable"] is True
    assert result["validation"]["resultado_lote"] == "VALIDADO"
    assert result["validation"]["motivos_bloqueo"] == []
    counts = result["validation"]["conteos"]
    assert counts["objetos"] == expected["objetos_en_el_archivo"]
    assert counts["objetos_aceptados"] == expected["objetos_publicados"]
    assert counts["objetos_en_cuarentena"] == len(expected["objetos_en_cuarentena"])
    assert result["document"]["identity"]["parameters"]["as_of"] == expected["fecha_corte"]
    assert result["document"]["identity"]["parameters"]["absent_policy"] == "rechazar"
    assert {row["kind"] for row in result["rows"]} == {"person", "object"}
    # El resultado viaja por JSON entre procesos.
    assert json.loads(json.dumps(result, allow_nan=False)) == result


def test_example_lot_two_is_blocked_with_the_codes_of_the_manifest():
    name = "2-cartera-2026-10-31-con-errores"
    result = worker.prepare(request(name))
    assert result["publishable"] is False
    assert result["validation"]["resultado_lote"] == "BLOQUEADO"
    assert result["validation"]["motivos_bloqueo"]
    detail = result["detail"]
    shown = {(f["archivo"], f["linea"], f["campo"], f["codigo"]) for f in detail["hallazgos"]}
    for error in MANIFEST["lotes"][name]["errores_a_proposito"]:
        assert (error["archivo"], error["linea"], error["columna"], error["codigo"]) in shown
        assert detail["totales"]["errores"][error["codigo"]] >= 1


def test_detail_has_rows_findings_totals_and_catalogs():
    detail = worker.prepare(request("1-cartera-2026-09-30"))["detail"]
    assert set(detail) == {"filas", "hallazgos", "hallazgos_total", "totales", "catalogos"}
    assert detail["filas"]["detalle"] == {"leidas": 36, "aceptadas": 35, "rechazadas": 1}
    assert set(detail["filas"]["cabecera"]) == {"leidas", "aceptadas", "rechazadas"}
    assert detail["totales"] == {"errores": {"FECHA_VACIA": 1},
                                 "advertencias": {"CONTACTO_PLACEHOLDER": 3, "ESTADO_ORIGEN_NO_INFORMADO": 1}}
    assert detail["hallazgos_total"] == len(detail["hallazgos"]) == 5
    for finding in detail["hallazgos"]:
        assert set(finding) == {"archivo", "linea", "campo", "codigo", "efecto"}
    assert detail["catalogos"]["currency"] == ["ARS"]
    assert detail["catalogos"]["debtor_type"] == ["AGUA", "INMUEBLE", "RODADO"]
    for keys in detail["catalogos"].values():
        assert keys == sorted(keys)


def test_prepare_never_carries_values_into_the_detail(tmp_path):
    source = lot_paths("2-cartera-2026-10-31-con-errores")
    detalle = source["detalle"].read_bytes().replace(b"1170000.00", CENTINELA.encode())
    (tmp_path / "detalle.csv").write_bytes(detalle)
    result = worker.prepare({**request("2-cartera-2026-10-31-con-errores"),
                             "files": {"cabecera": str(source["cabecera"]), "detalle": str(tmp_path / "detalle.csv")}})
    assert CENTINELA not in json.dumps(result["detail"])
    assert CENTINELA not in json.dumps(result["validation"])


# ---- Totales sobre todos los hallazgos, detalle acotado


def synthetic_batch(findings):
    """Lo que `detail` lee del lote: el reporte y lo necesario para los catálogos."""
    real = prepare_batch(lot_paths("1-cartera-2026-09-30"), profile("2026-09-30"), source_contract(), "2026-09-30")
    report = {**real.report, "hallazgos": findings}
    return SimpleNamespace(report=report, objects=real.objects, debtor_type_keys=real.debtor_type_keys,
                           mapping=real.mapping)


def finding(index, code="IMPORTE_NO_NUMERICO", campo="NOTD_totalActualizado", archivo="detalle"):
    return {"archivo": archivo, "linea": index + 2, "campo": campo, "codigo": code}


def test_more_than_five_hundred_findings_are_all_counted_and_five_hundred_shown():
    findings = [finding(i) for i in range(620)] + [finding(i, "CONTACTO_PLACEHOLDER", "Destinatario_Email", "cabecera")
                                                   for i in range(30)]
    detail = worker.detail(synthetic_batch(findings))
    assert worker.MAX_FINDINGS == 500
    assert detail["hallazgos_total"] == 650
    assert len(detail["hallazgos"]) == 500
    assert detail["totales"] == {"errores": {"IMPORTE_NO_NUMERICO": 620}, "advertencias": {"CONTACTO_PLACEHOLDER": 30}}
    # Los primeros 500, en orden, y los totales no dependen de cuáles se muestran.
    assert [f["linea"] for f in detail["hallazgos"]] == [i + 2 for i in range(500)]


def test_reduced_limit_on_a_real_lot(monkeypatch):
    monkeypatch.setattr(worker, "MAX_FINDINGS", 2)
    full = worker.prepare(request("2-cartera-2026-10-31-con-errores"))["detail"]
    assert len(full["hallazgos"]) == 2
    assert full["hallazgos_total"] == 11
    assert sum(full["totales"]["errores"].values()) + sum(full["totales"]["advertencias"].values()) == 11


def test_totals_are_sorted_by_code():
    findings = [finding(0, "PORCENTAJE_INVALIDO", "Destinatario_Porcentaje", "cabecera"), finding(1), finding(2, "FECHA_VACIA",
                                                                                                           "NOTD_vencimiento")]
    totals = worker.detail(synthetic_batch(findings))["totales"]["errores"]
    assert list(totals) == sorted(totals)


# ---- Efecto: la columna opcional puede degradarlo


@pytest.mark.parametrize(
    ("item", "effect"),
    [
        (finding(0, "FECHA_CENTINELA", "NOTD_vencimiento"), "CUARENTENA"),  # obligatoria
        (finding(0, "FECHA_CENTINELA", "NOTD_ESTA_id"), "ALERTA"),  # opcional, con efecto_opcional
        (finding(0, "IMPORTE_NO_NUMERICO", "NOTD_intereses"), "CUARENTENA"),  # opcional, sin efecto_opcional
        (finding(0, "CONTACTO_PLACEHOLDER", "Destinatario_Email", "cabecera"), "ALERTA"),
        (finding(0, "CODIGO_DESCONOCIDO", "NOTD_vencimiento"), "BLOQUEO"),
        (finding(0, "FECHA_CENTINELA", "COLUMNA_INEXISTENTE"), "CUARENTENA"),  # columna desconocida: obligatoria
        (finding(0, "FECHA_CENTINELA", "NOTD_ESTA_id", "libro"), "CUARENTENA"),  # archivo sin columnas
    ],
)
def test_finding_effect(item, effect):
    assert worker.finding_effect(source_contract(), item) == effect


def test_optional_column_moves_a_finding_to_warnings():
    findings = [finding(0, "FECHA_CENTINELA", "NOTD_vencimiento"), finding(1, "FECHA_CENTINELA", "NOTD_ESTA_id")]
    detail = worker.detail(synthetic_batch(findings))
    assert detail["totales"] == {"errores": {"FECHA_CENTINELA": 1}, "advertencias": {"FECHA_CENTINELA": 1}}
    assert [f["efecto"] for f in detail["hallazgos"]] == ["CUARENTENA", "ALERTA"]


# ---- rejection(): código estable y ubicación


def test_rejection_of_a_structural_error_keeps_its_location():
    location = {"archivo": "detalle", "linea": 4, "campo": "NOTD_capital"}
    assert worker.rejection(StructuralRejection("ESTRUCTURA_INVALIDA", {}, location)) == {
        "source_error": "ESTRUCTURA_INVALIDA", "location": location}


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (StructuralRejection("ESTRUCTURA_INVALIDA", {}), {"source_error": "ESTRUCTURA_INVALIDA"}),
        (ValidationError(f"ARCHIVO_NO_LEIBLE: {CENTINELA}"), {"source_error": "ARCHIVO_NO_LEIBLE"}),
        (ETLError("SOURCE_CHANGED_DURING_READ"), {"source_error": "SOURCE_CHANGED_DURING_READ"}),
        (ValidationError(CENTINELA.lower()), {"source_error": "PREVIEW_SOURCE_INVALID"}),
        (ValidationError("X" * 81), {"source_error": "PREVIEW_SOURCE_INVALID"}),
    ],
)
def test_rejection_codes_are_safe(error, expected):
    assert worker.rejection(error) == expected


def test_rejection_of_a_real_binary_file(tmp_path):
    files = lot_paths("1-cartera-2026-09-30")
    (tmp_path / "cabecera.csv").write_bytes(b"\x00\x01" + CENTINELA.encode() + b"\x00" * 20)
    with pytest.raises(StructuralRejection) as error:
        worker.prepare({**request("1-cartera-2026-09-30"),
                        "files": {"cabecera": str(tmp_path / "cabecera.csv"), "detalle": str(files["detalle"])}})
    assert error.value.location == {"archivo": "cabecera", "linea": 0, "campo": "*"}
    result = worker.rejection(error.value)
    assert result == {"source_error": "CONTENIDO_NO_TEXTO", "location": {"archivo": "cabecera", "linea": 0, "campo": "*"}}
    assert CENTINELA not in json.dumps(result)


# ---- reader_location y StructuralRejection.location


@pytest.mark.parametrize(
    ("detail", "expected"),
    [
        (" archivo=detalle, linea=12, campo=NOTD_capital", {"archivo": "detalle", "linea": 12, "campo": "NOTD_capital"}),
        ("archivo=cabecera, linea=0, campo=*", {"archivo": "cabecera", "linea": 0, "campo": "*"}),
        ("archivo=libro, linea=999999999, campo=x", {"archivo": "libro", "linea": 999999999, "campo": "x"}),
        ("archivo=otro, linea=1, campo=x", None),
        ("archivo=detalle, linea=1234567890, campo=x", None),
        ("archivo=detalle, linea=1, campo=Juan Pérez", None),
        (f"archivo=detalle, linea=1, campo=x, valor={CENTINELA}", None),
        (f"{CENTINELA} archivo=detalle, linea=1, campo=x", None),
        ("", None),
    ],
)
def test_reader_location_accepts_only_the_exact_form(detail, expected):
    assert reader_location(detail) == expected


def test_structural_rejection_location_defaults_to_none():
    error = StructuralRejection("ESTRUCTURA_INVALIDA", {"cabecera": "a" * 64})
    assert (error.code, error.file_hashes, error.location) == ("ESTRUCTURA_INVALIDA", {"cabecera": "a" * 64}, None)


def test_prepare_batch_passes_the_reader_location(tmp_path):
    files = lot_paths("1-cartera-2026-09-30")
    (tmp_path / "cabecera.csv").write_bytes(files["cabecera"].read_bytes() + b"3-1,3\n")
    with pytest.raises(StructuralRejection) as error:
        prepare_batch({"cabecera": tmp_path / "cabecera.csv", "detalle": files["detalle"]}, profile("2026-09-30"),
                      source_contract(), "2026-09-30")
    assert error.value.code == "ESTRUCTURA_INVALIDA"
    assert error.value.location == {"archivo": "cabecera", "linea": 23, "campo": "*"}


# ---- _location del proceso padre y PreviewSourceError


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ({"archivo": "detalle", "linea": 3, "campo": "NOTD_capital"}, {"archivo": "detalle", "linea": 3, "campo": "NOTD_capital"}),
        ({"archivo": "cabecera", "linea": 0, "campo": "*"}, {"archivo": "cabecera", "linea": 0, "campo": "*"}),
        # Un campo que no es columna del contrato PARA ESE ARCHIVO se reemplaza.
        ({"archivo": "cabecera", "linea": 3, "campo": "NOTD_capital"}, {"archivo": "cabecera", "linea": 3, "campo": "*"}),
        ({"archivo": "detalle", "linea": 3, "campo": CENTINELA}, {"archivo": "detalle", "linea": 3, "campo": "*"}),
        ({"archivo": "detalle", "linea": 3, "campo": 7}, {"archivo": "detalle", "linea": 3, "campo": "*"}),
        ({"archivo": "libro", "linea": 1, "campo": "Cuenta"}, {"archivo": "libro", "linea": 1, "campo": "*"}),
        ({"archivo": "detalle", "linea": 3, "campo": "x", "valor": CENTINELA}, None),
        ({"archivo": "detalle", "linea": 3}, None),
        ({"archivo": CENTINELA, "linea": 3, "campo": "*"}, None),
        ({"archivo": "detalle", "linea": True, "campo": "*"}, None),
        ({"archivo": "detalle", "linea": -1, "campo": "*"}, None),
        ({"archivo": "detalle", "linea": 10**9, "campo": "*"}, None),
        ({"archivo": "detalle", "linea": "3", "campo": "*"}, None),
        ([("archivo", "detalle")], None),
        (None, None),
        (CENTINELA, None),
    ],
)
def test_parent_location_is_a_closed_form(value, expected):
    assert process._location(value) == expected


def test_preview_source_error_keeps_code_and_location():
    plain = process.PreviewSourceError("ESTRUCTURA_INVALIDA")
    assert (str(plain), plain.location) == ("ESTRUCTURA_INVALIDA", None)
    located = process.PreviewSourceError("ESTRUCTURA_INVALIDA", {"archivo": "detalle", "linea": 1, "campo": "*"})
    assert located.location == {"archivo": "detalle", "linea": 1, "campo": "*"}
    assert isinstance(located, ETLError)


def test_real_child_reports_a_structural_rejection_with_its_location(tmp_path):
    files = lot_paths("1-cartera-2026-09-30")
    (tmp_path / "cabecera.csv").write_bytes(b"x,y\n1,2\n")
    with pytest.raises(process.PreviewSourceError) as error:
        process.prepare_input({"cabecera": tmp_path / "cabecera.csv", "detalle": files["detalle"]},
                              profile("2026-09-30"), 1, "rechazar")
    assert str(error.value) == "COLUMNA_OBLIGATORIA_AUSENTE"
    assert error.value.location == {"archivo": "cabecera", "linea": 1, "campo": "ClaveAgrupacion"}


def test_real_child_prepares_the_csv_lot_like_the_parent():
    result = process.prepare_input(lot_paths("1-cartera-2026-09-30"), profile("2026-09-30"), 1, "rechazar")
    assert result == json.loads(json.dumps(worker.prepare(request("1-cartera-2026-09-30"))))


# ---- UploadStore.incoming_files


def test_incoming_files_lists_only_regular_files_of_known_kinds(tmp_path):
    store = UploadStore(tmp_path / "almacen")
    token = store.begin()
    for kind in ("detalle", "cabecera"):
        with store.open_part(token, kind) as part:
            part.write(b"x")
    folder = tmp_path / "almacen" / "incoming" / token
    (folder / "otro").write_bytes(b"x")
    os.mkdir(folder / "libro")
    outside = tmp_path / "fuera"
    outside.write_bytes(CENTINELA.encode())
    found = store.incoming_files(token)
    assert list(found) == ["cabecera", "detalle"]
    assert found == {"cabecera": folder / "cabecera", "detalle": folder / "detalle"}
    os.rmdir(folder / "libro")
    os.symlink(outside, folder / "libro")
    assert list(store.incoming_files(token)) == ["cabecera", "detalle"]


def test_incoming_files_of_a_missing_or_invalid_token_fail_closed(tmp_path):
    store = UploadStore(tmp_path / "almacen")
    with pytest.raises(UploadStoreError):
        store.incoming_files("0" * 32)
    for token in ("../lotes", "", "Z" * 32):
        with pytest.raises(UploadStoreError):
            store.incoming_files(token)


def test_incoming_files_after_discard_fail_closed(tmp_path):
    store = UploadStore(tmp_path / "almacen")
    token = store.begin()
    store.discard(token)
    with pytest.raises(UploadStoreError):
        store.incoming_files(token)
