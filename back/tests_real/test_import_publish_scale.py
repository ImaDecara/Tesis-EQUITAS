"""R032-01: la CLI debe publicar y reentregar el volumen municipal por la Data API.

Requiere reset local propio. Usa el generador versionado sin modificarlo y conserva
solo los objetos aceptados del municipio A. Los tiempos se informan, pero el límite
efectivo lo imponen PostgREST y el cliente reales, sin SET ROLE ni bypass del timeout.
"""

import hashlib
import json
import os
import shutil
import subprocess
import sys
import time

from conftest import ROOT, psql
from test_etl_v1_load import PORTFOLIO, batches, campaign, error_code, reissue_lot  # noqa: F401 -- fixture original


def _accepted_scale(source, target):
    expected = json.loads((source / "expected.json").read_text())["municipios"]["municipio-sintetico-a"]
    accepted = [row for row in expected["objetos"] if row["resultado"] == "ACEPTADO"]
    keys = {row["clave_agrupacion"] for row in accepted}
    target.mkdir()
    for name in ("cabecera.tsv", "detalle.tsv"):
        header, *rows = (source / name).read_text().splitlines()
        index = header.split("\t").index("ClaveAgrupacion")
        selected = [row for row in rows if row.split("\t")[index] in keys]
        (target / name).write_text("\n".join([header, *selected]) + "\n")
    for name in ("manifest.json", "contactos-vigencia.json"):
        shutil.copyfile(source / name, target / name)
    return len(accepted), sum(row["obligaciones"] for row in accepted)


def _portfolio_fingerprints():
    # xmin detecta una reescritura aun cuando preserve todos los valores de la fila.
    return {
        table: psql(
            'select count(*)::text || \'|\' || md5(coalesce(string_agg('
            '(to_jsonb(t) || jsonb_build_object(\'_xmin\',t.xmin::text))::text,\'\' order by t.id),\'\')) '
            f'from public."{table}" t'
        ).strip()
        for table in PORTFOLIO
    }


def test_cli_publica_y_reentrega_escala_sin_reescribir(request):
    loader = request.getfixturevalue("campaign")
    report = {"objects": 2924, "debts": 56273, "runs": []}
    destination = os.environ.get("EQUITAS_SCALE_EVIDENCE")

    def save():
        if destination:
            from pathlib import Path
            Path(destination).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")

    def load(name, folder):
        started = time.monotonic()
        result = loader.etl(folder)
        report["runs"].append({"name": name, "exit_code": result.returncode,
                               "error_code": error_code(result),
                               "duration_seconds": round(time.monotonic() - started, 3)})
        report["events"] = [{"id": row["id"], "status": row["status"]} for row in batches()]
        save()
        assert result.returncode == 0, "La CLI real debe completar la publicación; ver código y tiempos en evidencia"

    generated = loader.work / "escala-generada"
    result = subprocess.run(
        [sys.executable, str(ROOT / "quality/fixtures/synthetic_portfolio.py"), "--output", str(generated),
         "--profile", "escala", "--sin-variantes"],
        cwd=ROOT, capture_output=True, timeout=600, check=False,
    )
    assert result.returncode == 0, "El generador versionado debe terminar"
    lot = loader.work / "escala-aceptada"
    assert _accepted_scale(generated, lot) == (2924, 56273)
    report["file_sha256"] = {
        name: hashlib.sha256((lot / name).read_bytes()).hexdigest() for name in ("cabecera.tsv", "detalle.tsv")
    }
    save()
    load("primera-publicacion", lot)
    assert psql("select (select count(*) from public.debtor where tenant=1)::text || '|' || "
                "(select count(*) from public.debt d join public.debtor o on o.id=d.debtor where o.tenant=1)::text").strip() == "2924|56273"
    first = [row for row in batches() if row["status"] == "PUBLICADO"]
    assert len(first) == 1
    before = _portfolio_fingerprints()
    load("repeticion-mismos-archivos", lot)
    assert [row["id"] for row in batches() if row["status"] == "PUBLICADO"] == [first[0]["id"]]
    assert _portfolio_fingerprints() == before, "Repetir el mismo lote no reescribe cartera"
    redelivery = reissue_lot(lot, loader.work / "escala-reentrega")
    assert hashlib.sha256((redelivery / "cabecera.tsv").read_bytes()).hexdigest() != report["file_sha256"]["cabecera.tsv"]
    load("reentrega-mensual-sin-cambios", redelivery)
    final = [row for row in batches() if row["status"] == "PUBLICADO"]
    assert len(final) == 2
    assert final[-1]["idempotency_key"] != first[0]["idempotency_key"]
    assert _portfolio_fingerprints() == before, "Una nueva entrega idéntica en valores tampoco reescribe cartera"
    counts = final[-1]["counts"]
    assert counts["deudas_publicadas"] == counts["deudas_sin_cambios"] == 56273
    assert counts["deudas_insertadas"] == counts["deudas_actualizadas"] == 0
    assert psql("select count(*) from public.import_row_staging").strip() == "0"
    report.update(passed=True, portfolio_unchanged=True, published_batches=2, staging_remaining=0)
    save()
