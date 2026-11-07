"""ALIGN-027. Carga V1 con las CLI reales contra la base local: validar, cargar, conciliar, recargar, reimportar, rechazar.

Fuera de `testpaths`. Desde `back/`, con el turno de la base y recién después de `db reset --local`:

    .venv/bin/python -m pytest tests_real/test_etl_v1_load.py -q

Solo datos sintéticos y destino loopback (`conftest.load_local_env`). Las pruebas corren en orden: cada una parte de lo
que dejó la anterior. Al terminar vacía las tablas, porque sus semillas chocan con las de otras suites de la sesión. Con
`EQUITAS_V1_EVIDENCE` escribe ahí la evidencia JSON (hashes, conteos y códigos, sin filas ni claves).

`sintetico-v1` completo siempre queda BLOQUEADO, a propósito. "El mismo archivo validado" se comprueba con su lote
VALIDADO derivado: el SHA-256 calculado al validar es el que queda registrado en `import_batch` al cargar.
"""

import csv
import hashlib
import json
import os
import subprocess
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlsplit

import httpx
import pytest
from conftest import BACK, DB_CONTAINER, LOOPBACK_HOSTS, ROOT, TESTING, load_local_env, psql

sys.path.append(str(BACK / "tests"))

from oracle_lots import (  # noqa: E402
    AS_OF,
    BIEN_TIPO_A_CLAVE,
    ESTADOS_A_CLAVE,
    FIXTURE,
    accepted_objects,
    accepted_with_altered,
    derive_lot,
    object_by_case,
    oracle,
    persisted_mismatches,
    synthetic_profile,
)

from ETL.transform import build_debtor_profile_payload  # noqa: E402
from reissue_lot import reissue_lot  # noqa: E402

TENANT = 1
CONTRACT = ROOT / "contracts" / "source-contract.v1.json"
PORTFOLIO = ("person", "debtor", "debt", "debtor_person", "debtor_contact", "debtor_profile", "debtor_profile_detail",
             "address", "city", "province")
CATALOG_COLUMNS = {"debt_status": "key", "debtor_type": "key", "document_type": "key", "person_type": "key",
                   "person_status": "key", "contact_type": "key", "currency": "code"}
QUARANTINED_CASE = "cuenta-ceros-izquierda"
# Tributos declarados por el contrato de datos del ETL. El oráculo no los agrega: se concilian contra el archivo.
TRIBUTE_BY_CODE = {"1": "inmuebles", "100": "vehicle_tax", "801": "water_connection", "905": "unknown_905"}
# La obligación modificada y los controles de su cabecera, para que el lote siga conciliando.
MODIFIED_CASE = "base-valido"
MODIFIED_DEBT = "700001"
MODIFIED_AMOUNT = ("13.817,54", Decimal("13817.54"))
MODIFIED_TOTAL = ("46.279,61", "46279.61")


def sha256(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def lot_hashes(lot: Path) -> dict[str, str]:
    return {name: sha256(lot / f"{name}.tsv") for name in ("cabecera", "detalle")}


def dataset_hash(hashes: dict[str, str]) -> str:
    return hashlib.sha256("".join(f"{name}:{hashes[name]}\n" for name in sorted(hashes)).encode()).hexdigest()


def canonical_hash(path: Path) -> str:
    value = json.loads(path.read_text(encoding="utf-8"))
    text = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(text.encode()).hexdigest()


def read_rows(table: str) -> list[dict]:
    """Por la base y no por la Data API: incluye `xmin`, que delata una reescritura aunque deje el mismo valor."""
    text = psql(f"select coalesce(json_agg(to_jsonb(t) || jsonb_build_object('_xmin', t.xmin::text) order by t.id), '[]') "
                f'from public."{table}" t')
    return json.loads(text, parse_float=Decimal)


def snapshot() -> dict[str, dict[int, dict]]:
    return {table: {row["id"]: row for row in read_rows(table)} for table in PORTFOLIO}


def changes(before: dict, after: dict) -> dict[str, dict[str, list[int]]]:
    """Filas insertadas, reescritas (cambie o no su valor) y borradas por tabla. Sin cambios: {}."""
    found = {}
    for table in PORTFOLIO:
        old, new = before[table], after[table]
        difference = {
            "insertadas": sorted(set(new) - set(old)),
            "actualizadas": sorted(key for key in set(old) & set(new) if old[key] != new[key]),
            "borradas": sorted(set(old) - set(new)),
        }
        if any(difference.values()):
            found[table] = difference
    return found


def tenant_tables(rows: dict[str, dict[int, dict]]) -> dict[str, list[dict]]:
    """Solo lo alcanzable desde los objetos de este municipio: otras pruebas de la misma sesión pueden dejar otros."""
    debtors = [row for row in rows["debtor"].values() if row["tenant"] == TENANT]
    debtor_ids = {row["id"] for row in debtors}
    relations = [row for row in rows["debtor_person"].values() if row["debtor"] in debtor_ids]
    person_ids = {row["person"] for row in relations}
    profiles = [row for row in rows["debtor_profile"].values() if row["debtor"] in debtor_ids]
    profile_ids = {row["id"] for row in profiles}
    return {
        "debtor": debtors,
        "debt": [row for row in rows["debt"].values() if row["debtor"] in debtor_ids],
        "debtor_person": relations,
        "person": [row for row in rows["person"].values() if row["id"] in person_ids],
        "debtor_contact": [row for row in rows["debtor_contact"].values() if row["person"] in person_ids],
        "debtor_profile": profiles,
        "debtor_profile_detail": [row for row in rows["debtor_profile_detail"].values()
                                  if row["debtor_profile"] in profile_ids],
    }


def catalogs() -> dict[str, dict[str, int]]:
    return {table: {row[column]: row["id"] for row in read_rows(table)} for table, column in CATALOG_COLUMNS.items()}


def batches() -> list[dict]:
    return [row for row in read_rows("import_batch") if row["tenant"] == TENANT]


def error_code(result: subprocess.CompletedProcess) -> str | None:
    return next((part.split("=", 1)[1] for part in result.stderr.split() if part.startswith("codigo=")), None)


def line_value(result: subprocess.CompletedProcess, label: str) -> str | None:
    return next((line.split(":", 1)[1].strip() for line in result.stdout.splitlines() if line.startswith(label)), None)


def drop_lines(path: Path, *matches: tuple[str, ...]) -> None:
    """Quita del archivo las líneas que tienen todas las celdas de alguna de las combinaciones pedidas."""
    lines = path.read_text(encoding="utf-8").splitlines()
    kept = [line for line in lines if not any(set(match) <= set(line.split("\t")) for match in matches)]
    assert len(kept) < len(lines), "La prueba no quitó ninguna línea"
    path.write_text("\n".join(kept) + "\n", encoding="utf-8")


def debtor_of(tables: dict, types: dict[str, int], case: str) -> dict:
    item = object_by_case(case)
    return next(row for row in tables["debtor"] if row["type"] == types[BIEN_TIPO_A_CLAVE[item["bien_tipo_id"]]]
                and str(row["external_id"]) == item["cuenta"])


def oracle_totals_by_object_type(objects: list[dict]) -> dict[str, dict]:
    totals: dict[str, dict] = defaultdict(lambda: {"objetos": 0, "obligaciones": 0, "actualizado": Decimal(0),
                                                   "capital": Decimal(0), "estados": Counter()})
    for item in objects:
        group = totals[BIEN_TIPO_A_CLAVE[item["bien_tipo_id"]]]
        group["objetos"] += 1
        group["obligaciones"] += item["obligaciones"]
        group["actualizado"] += Decimal(item["importe_actualizado"]["valor"])
        group["capital"] += Decimal(item["importe_capital"]["valor"])
        group["estados"].update({ESTADOS_A_CLAVE[name]: count for name, count in item["estados_al_corte"].items()
                                 if count and name in ESTADOS_A_CLAVE})
    return dict(totals)


def persisted_totals_by_object_type(tables: dict, ids: dict) -> dict[str, dict]:
    type_names = {value: key for key, value in ids["debtor_type"].items()}
    status_names = {value: key for key, value in ids["debt_status"].items()}
    totals: dict[str, dict] = defaultdict(lambda: {"objetos": 0, "obligaciones": 0, "actualizado": Decimal(0),
                                                   "capital": Decimal(0), "estados": Counter()})
    types_by_debtor = {row["id"]: type_names[row["type"]] for row in tables["debtor"]}
    for row in tables["debtor"]:
        totals[type_names[row["type"]]]["objetos"] += 1
    for row in tables["debt"]:
        group = totals[types_by_debtor[row["debtor"]]]
        group["obligaciones"] += 1
        group["actualizado"] += Decimal(str(row["current_amount"]))
        group["capital"] += Decimal(str(row["original_amount"]))
        group["estados"][status_names[row["status"]]] += 1
    return dict(totals)


def file_totals_by_tribute(lot: Path, objects: list[dict]) -> dict[str, dict]:
    """Del TSV, sin ETL: una fila por obligación de cada objeto aceptado (primera lectura, como el oráculo)."""
    keys = {item["clave_agrupacion"] for item in objects}
    rows: dict[tuple[str, str], dict] = {}
    with (lot / "detalle.tsv").open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle, delimiter="\t"):
            if row["ClaveAgrupacion"] in keys:
                rows.setdefault((row["ClaveAgrupacion"], row["DEUD_id"]), row)
    totals: dict[str, dict] = defaultdict(lambda: {"obligaciones": 0, "actualizado": Decimal(0), "capital": Decimal(0)})
    for row in rows.values():
        group = totals[TRIBUTE_BY_CODE[row["Tipo_Ingreso_Id"]]]
        group["obligaciones"] += 1
        group["actualizado"] += Decimal(row["NOTD_totalActualizado"].replace(".", "").replace(",", "."))
        group["capital"] += Decimal(row["NOTD_capital"].replace(".", "").replace(",", "."))
    return dict(totals)


def persisted_totals_by_tribute(tables: dict) -> dict[str, dict]:
    totals: dict[str, dict] = defaultdict(lambda: {"obligaciones": 0, "actualizado": Decimal(0), "capital": Decimal(0)})
    for row in tables["debt"]:
        group = totals[row["type"]]
        group["obligaciones"] += 1
        group["actualizado"] += Decimal(str(row["current_amount"]))
        group["capital"] += Decimal(str(row["original_amount"]))
    return dict(totals)


def amounts_and_counts(tables: dict) -> dict:
    """Lo que una recarga no puede mover: conteos por tabla y sumas de obligaciones y perfiles."""
    return {
        "filas": {name: len(rows) for name, rows in tables.items()},
        "actualizado": sum((Decimal(str(row["current_amount"])) for row in tables["debt"]), Decimal(0)),
        "capital": sum((Decimal(str(row["original_amount"])) for row in tables["debt"]), Decimal(0)),
        "perfiles": sum((Decimal(str(row["total_debt_amount"])) for row in tables["debtor_profile"]), Decimal(0)),
    }


@dataclass
class Campaign:
    env: dict[str, str] = field(repr=False)
    jwt: str = field(repr=False)
    actor: str
    work: Path
    steps: list[dict] = field(default_factory=list)
    outputs: list[str] = field(default_factory=list, repr=False)

    def _run(self, environment: dict[str, str], *arguments: str) -> subprocess.CompletedProcess:
        """Proceso nuevo con un entorno armado desde cero. Las claves viajan por su entorno, nunca por argumentos."""
        result = subprocess.run([sys.executable, "-m", *arguments], cwd=BACK, env={"PATH": os.environ["PATH"], **environment},
                                capture_output=True, text=True, check=False)
        self.outputs.append(result.stdout + result.stderr)
        return result

    def environment(self) -> dict[str, str]:
        return {
            "PATH": os.environ["PATH"],
            "EQUITAS_TARGET_ENV": "local",
            "SUPABASE_URL": self.env["API_URL"],
            "SUPABASE_SERVICE_ROLE_KEY": self.env["SERVICE_ROLE_KEY"],
            "SUPABASE_ANON_KEY": self.env["ANON_KEY"],
            "EQUITAS_IMPORT_SERVER_JWT": self.jwt,
            "EQUITAS_IMPORT_ACTOR_USER": self.actor,
        }

    def etl(self, folder: Path, *extra: str, cut_off: str = AS_OF) -> subprocess.CompletedProcess:
        return self._run(self.environment(), "ETL.run_etl", "--folder", str(folder), "--execute", "--cut-off", cut_off, *extra)

    def validate(self, folder: Path, output: Path) -> subprocess.CompletedProcess:
        """Sin ninguna clave ni URL: si necesitara la base, fallaría."""
        return self._run({}, "ETL.validate_source", "--folder", str(folder), "--contract", str(CONTRACT),
                         "--cut-off", AS_OF, "--output", str(output))

    def record(self, step: str, **data) -> None:
        self.steps.append({"paso": step, **data})


@dataclass
class Validated:
    lot: Path
    hashes: dict[str, str]
    report: dict
    selected: list[dict]


@dataclass
class Published:
    validated: Validated
    result: subprocess.CompletedProcess
    events: list[dict]
    rows: dict


def public_tables() -> list[str]:
    return psql("select tablename from pg_tables where schemaname = 'public' order by 1").split()


def nonempty_tables() -> list[str]:
    return [name for name in public_tables() if psql(f'select exists(select 1 from public."{name}")').strip() == "t"]


@pytest.fixture(scope="module")
def campaign(env, import_jwt, tmp_path_factory):
    # Tras db reset, PostgREST puede responder PGRST002 hasta cargar su caché de esquema.
    for _ in range(60):
        response = httpx.get(f"{env['API_URL']}/rest/v1/debtor", params={"select": "id", "limit": "1"},
                             headers={"apikey": env["SERVICE_ROLE_KEY"], "Authorization": f"Bearer {env['SERVICE_ROLE_KEY']}"},
                             timeout=10, trust_env=False)
        if response.status_code == 200:
            break
        time.sleep(2)
    else:
        pytest.fail("La Data API local no respondió 200")
    assert not nonempty_tables(), "Se requiere db reset --local antes de esta campaña"
    assert urlsplit(env["API_URL"]).hostname in LOOPBACK_HOSTS
    psql(script=TESTING / "etl-compat-catalogs.sql")
    actor = psql(script=TESTING / "etl-import-actor.sql").strip()
    assert actor.isdigit(), "etl-import-actor.sql no devolvió un id"
    yield Campaign(env, import_jwt, actor, tmp_path_factory.mktemp("lotes"))
    # Sus semillas son excluyentes con las de otras suites de la sesión (ALIGN-052): deja las tablas como tras db reset.
    # Como administrador y sin disparadores: import_batch es de solo agregado y rechaza el truncate de cualquier otro.
    tables = ", ".join(f'public."{name}"' for name in public_tables())
    subprocess.run(["docker", "exec", "-i", DB_CONTAINER, "psql", "-X", "-q", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
                   input=f"set session_replication_role = replica; truncate {tables} restart identity cascade;".encode(),
                   check=True, capture_output=True)
    assert not nonempty_tables()


@pytest.fixture(scope="module")
def validated(campaign) -> Validated:
    lot = derive_lot(campaign.work / "validado", (QUARANTINED_CASE,))
    hashes = lot_hashes(lot)
    output = campaign.work / "reporte-validado"
    result = campaign.validate(lot, output)
    assert result.returncode == 0, result.stdout
    report = json.loads((output / "report.json").read_text(encoding="utf-8"))
    selected = [*accepted_objects(), object_by_case(QUARANTINED_CASE)]
    return Validated(lot, hashes, report, selected)


@pytest.fixture(scope="module")
def published(campaign, validated) -> Published:
    before = len(batches())
    result = campaign.etl(validated.lot)
    assert result.returncode == 0, result.stderr
    return Published(validated, result, batches()[before:], snapshot())


def test_el_destino_que_no_es_local_detiene_la_campana(tmp_path, monkeypatch):
    import conftest as real_conftest

    settings = tmp_path / "remoto.env"
    settings.write_text('API_URL="https://proyecto.example.invalid"\n', encoding="utf-8")
    monkeypatch.setattr(real_conftest, "ENV_FILE", settings)
    with pytest.raises(pytest.exit.Exception, match="no es el stack local"):
        load_local_env()


def test_la_fixture_completa_se_rechaza_con_cero_filas_y_lote_fallido(campaign):
    expected = oracle()
    hashes = lot_hashes(FIXTURE)
    result = campaign.etl(FIXTURE)
    assert (result.returncode, error_code(result)) == (1, "BATCH_BLOCKED")
    assert line_value(result, "Resultado del lote") == "BLOQUEADO"
    rows = snapshot()
    assert {table: len(found) for table, found in rows.items() if found} == {}
    events = batches()
    assert [(event["status"], event["supersedes"]) for event in events] == [("FALLIDO", None)]
    event = events[0]
    assert event["as_of"] == AS_OF
    assert (event["file_hashes"]["cabecera"], event["file_hashes"]["detalle"]) == (hashes["cabecera"], hashes["detalle"])
    for name, value in expected["conteos"].items():
        assert event["counts"][name] == value, name
    assert event["counts"]["importe_aceptado_centavos"] == int(Decimal(expected["importes"]["actualizado_aceptado"]) * 100)
    for kind in ("cabecera", "detalle"):
        assert event["counts"][f"filas_{kind}_aceptadas"] + event["counts"][f"filas_{kind}_rechazadas"] \
            == event["counts"][f"filas_{kind}_leidas"] == expected["conteos"][f"filas_{kind}"]
    campaign.record("fixture completa rechazada", salida=result.returncode, codigo=error_code(result),
                    estado=event["status"], filas_de_cartera=0, dataset=dataset_hash(hashes), hashes=hashes)


def test_el_lote_derivado_son_lineas_de_la_fixture_sin_alterar(validated):
    for name in ("cabecera", "detalle"):
        source = (FIXTURE / f"{name}.tsv").read_text(encoding="utf-8").splitlines()
        lines = iter(source)
        derived = (validated.lot / f"{name}.tsv").read_text(encoding="utf-8").splitlines()
        assert len(derived) < len(source), "El lote validado es un derivado: sin cuarentena de más ni detalle huérfano"
        assert all(line in lines for line in derived), "Una línea del lote no está en la fixture o cambió de orden"


def test_el_validador_aprueba_el_lote_sin_credenciales_ni_base(validated):
    assert validated.report["resultado_lote"] == "VALIDADO"
    assert validated.report["publicacion_permitida"] is True
    assert validated.report["motivos_bloqueo"] == []
    assert validated.report["conteos"]["objetos_en_cuarentena"] == 1
    assert validated.report["conteos"]["objetos_aceptados"] == len(accepted_objects())


def test_la_carga_publica_lo_mismo_que_dice_el_oraculo(campaign, published):
    tables = tenant_tables(published.rows)
    ids = catalogs()
    assert persisted_mismatches(tables, accepted_objects(), ids, published.validated.lot) == []
    assert line_value(published.result, "Resultado del lote") == "VALIDADO"
    campaign.record("primera carga", salida=published.result.returncode, eventos=[event["status"] for event in published.events],
                    filas_insertadas=published.events[-1]["counts"]["filas_insertadas"], totales=_jsonable(amounts_and_counts(tables)))


def test_conteos_y_montos_por_tipo_de_objeto_son_identicos_al_oraculo(published):
    tables = tenant_tables(published.rows)
    wanted = oracle_totals_by_object_type(accepted_objects())
    assert persisted_totals_by_object_type(tables, catalogs()) == wanted
    assert sum((group["actualizado"] for group in wanted.values()), Decimal(0)) \
        == Decimal(oracle()["importes"]["actualizado_aceptado"])


def test_conteos_y_montos_por_tributo_son_identicos_al_archivo(published):
    tables = tenant_tables(published.rows)
    wanted = file_totals_by_tribute(published.validated.lot, accepted_objects())
    assert persisted_totals_by_tribute(tables) == wanted
    assert sum((group["actualizado"] for group in wanted.values()), Decimal(0)) \
        == Decimal(oracle()["importes"]["actualizado_aceptado"])
    assert sum(group["obligaciones"] for group in wanted.values()) == sum(item["obligaciones"] for item in accepted_objects())


def test_aceptadas_mas_rechazadas_es_igual_a_leidas(published):
    counts = published.events[-1]["counts"]
    files = {name: sum(1 for _ in (published.validated.lot / f"{name}.tsv").open(encoding="utf-8")) - 1
             for name in ("cabecera", "detalle")}
    rejected = 0
    for name, read in files.items():
        accepted, refused = counts[f"filas_{name}_aceptadas"], counts[f"filas_{name}_rechazadas"]
        assert accepted + refused == counts[f"filas_{name}_leidas"] == read
        rejected += refused
    assert rejected > 0, "Con un lote sin rechazos esta prueba sería vacía"
    for name, rows in published.validated.report["filas"].items():
        assert rows["aceptadas"] + rows["rechazadas"] == rows["leidas"] == counts[f"filas_{name}_leidas"]


def test_los_estados_del_lote_concilian_con_debt(published):
    tables = tenant_tables(published.rows)
    names = {value: key for key, value in catalogs()["debt_status"].items()}
    persisted = Counter(names[row["status"]] for row in tables["debt"])
    labels = {clave: estado.lower() for estado, clave in ESTADOS_A_CLAVE.items()}
    assert published.events[-1]["counts"]["estados_al_corte"] == {labels[key]: count for key, count in persisted.items()}


def test_el_perfil_de_cada_objeto_es_la_suma_de_sus_deudas(published):
    tables = tenant_tables(published.rows)
    overdue = catalogs()["debt_status"]["OVERDUE"]
    tolerance = Decimal("0.01")
    assert tables["debtor_profile"], "Sin perfiles esta prueba sería vacía"
    for profile in tables["debtor_profile"]:
        debts = [row for row in tables["debt"] if row["debtor"] == profile["debtor"]]
        total = sum((Decimal(str(row["current_amount"])) for row in debts), Decimal(0))
        assert abs(Decimal(str(profile["total_debt_amount"])) - total) <= tolerance
        assert profile["debt_count"] == len(debts)
        if profile["overdue_debt_amount"] is not None:
            late = [row for row in debts if row["status"] == overdue]
            assert abs(Decimal(str(profile["overdue_debt_amount"])) - sum((Decimal(str(row["current_amount"])) for row in late), Decimal(0))) <= tolerance
            assert profile["overdue_debt_count"] == len(late)


def test_el_hash_cargado_es_el_mismo_que_el_validado(campaign, published):
    hashes = published.validated.hashes
    assert lot_hashes(published.validated.lot) == hashes, "El archivo cambió después de validarlo"
    assert [event["status"] for event in published.events] == ["RECIBIDO", "VALIDADO", "CONFIRMADO", "PUBLICADO"]
    for event in published.events:
        assert event["file_hashes"]["cabecera"] == hashes["cabecera"]
        assert event["file_hashes"]["detalle"] == hashes["detalle"]
        assert event["file_hashes"]["contrato"] == canonical_hash(CONTRACT)
        assert event["as_of"] == AS_OF
        assert event["created_by_role"] == "importador_sistema"
    assert published.events[0]["file_hashes"] == published.events[1]["file_hashes"]
    campaign.record("mismo archivo validado", hashes_validados=hashes, hashes_cargados=published.events[-1]["file_hashes"],
                    dataset=dataset_hash(hashes), contrato=published.validated.report["contrato"])


def test_lo_que_vio_el_validador_es_lo_que_se_registro_al_cargar(published):
    report, counts = published.validated.report, published.events[-1]["counts"]
    for name, value in report["conteos"].items():
        assert counts[name] == value, name
    for name, rows in report["filas"].items():
        assert counts[f"filas_{name}_aceptadas"] == rows["aceptadas"]
        assert counts[f"filas_{name}_rechazadas"] == rows["rechazadas"]
    assert counts["importe_aceptado_centavos"] == int(Decimal(report["importes"]["actualizado_aceptado"]) * 100)


def test_la_cadena_de_eventos_termina_publicada(published):
    received, validated, confirmed, last = published.events
    assert received['status'] == 'RECIBIDO' and received['supersedes'] is None
    assert [event['status'] for event in published.events] == ['RECIBIDO', 'VALIDADO', 'CONFIRMADO', 'PUBLICADO']
    for previous, current in zip(published.events, published.events[1:]):
        assert current['supersedes'] == previous['id'] < current['id']


def test_toda_escritura_de_cartera_comparte_la_transaccion_de_publicado(published):
    """032 fortalece 020: ninguna escritura antes de VALIDADO, todas junto a PUBLICADO."""
    first, confirmed, last = published.events[1:]
    written = [int(row['_xmin']) for rows in published.rows.values() for row in rows.values()]
    assert written, "Sin filas esta prueba sería vacía"
    assert int(first['_xmin']) < min(written)
    assert set(written) == {int(last['_xmin'])} == {int(confirmed['_xmin'])}


def test_la_primera_carga_informa_cuantas_filas_inserto(published):
    counts = published.events[-1]["counts"]
    tables = published.rows
    assert counts["filas_actualizadas"] == 0
    assert counts["filas_insertadas"] == sum(len(tables[name]) for name in PORTFOLIO)
    assert {name: value["insertadas"] for name, value in counts["escrituras"].items()} \
        == {name: len(tables[name]) for name in PORTFOLIO}


def test_recargar_el_mismo_lote_no_inserta_ni_actualiza_nada(campaign, published):
    before = snapshot()
    totals = amounts_and_counts(tenant_tables(before))
    previous = len(batches())
    result = campaign.etl(published.validated.lot)
    after = snapshot()
    assert result.returncode == 0, result.stderr
    assert changes(before, after) == {}, "La recarga reescribió filas de cartera"
    assert amounts_and_counts(tenant_tables(after)) == totals
    assert batches()[previous:] == [], "Repetir tampoco agrega eventos"
    counts = batches()[-1]['counts']
    assert counts == published.events[-1]['counts'], "Mismos conteos originales, no conteos de un reintento"
    assert (line_value(result, 'Filas insertadas'), line_value(result, 'Filas actualizadas')) == (
        str(counts['filas_insertadas']), str(counts['filas_actualizadas']))
    assert persisted_mismatches(tenant_tables(after), accepted_objects(), catalogs(), published.validated.lot) == []
    campaign.record("recarga", salida=result.returncode, filas_insertadas=counts["filas_insertadas"],
                    filas_actualizadas=counts["filas_actualizadas"], filas_sin_cambios=counts["filas_sin_cambios"],
                    semantica_conteos="recibo_original_durable", filas_nuevas_en_la_base=0,
                    filas_reescritas_en_la_base=0, totales=_jsonable(totals))


def _modified_lot(campaign, name: str) -> Path:
    key = object_by_case(MODIFIED_CASE)["clave_agrupacion"]
    lot = derive_lot(campaign.work / name, (QUARANTINED_CASE,),
                     cabecera_cells={(key, None, "Deuda_Actualizada"): MODIFIED_TOTAL[0]},
                     detalle_cells={(key, MODIFIED_DEBT, "NOTD_totalActualizado"): MODIFIED_AMOUNT[0]})
    return reissue_lot(lot, campaign.work / (name + "-nueva-entrega"))


def test_reimportar_una_obligacion_modificada_solo_cambia_esa_y_el_perfil_de_su_objeto(campaign, published):
    ids = catalogs()
    before = snapshot()
    tables = tenant_tables(before)
    debtor = debtor_of(tables, ids["debtor_type"], MODIFIED_CASE)
    debt = next(row for row in tables["debt"] if row["debtor"] == debtor["id"] and str(row["external_id"]) == MODIFIED_DEBT)
    profile = next(row for row in tables["debtor_profile"] if row["debtor"] == debtor["id"])
    lot = _modified_lot(campaign, "una-obligacion")
    previous = len(batches())
    result = campaign.etl(lot)
    after = snapshot()
    assert result.returncode == 0, result.stderr
    assert line_value(result, "Resultado del lote") == "VALIDADO"
    assert changes(before, after) == {
        "debt": {"insertadas": [], "actualizadas": [debt["id"]], "borradas": []},
        "debtor_profile": {"insertadas": [], "actualizadas": [profile["id"]], "borradas": []},
    }
    assert after["debt"][debt["id"]]["current_amount"] == MODIFIED_AMOUNT[1]
    # updated_amount es una columna generada desde current_amount (ALIGN-017): cambia con ella.
    assert after["debt"][debt["id"]]["updated_amount"] == MODIFIED_AMOUNT[1]
    for column in set(debt) - {"current_amount", "updated_amount", "_xmin"}:
        assert after["debt"][debt["id"]][column] == debt[column], column
    new_profile = after["debtor_profile"][profile["id"]]
    assert Decimal(str(new_profile["total_debt_amount"])) == Decimal(MODIFIED_TOTAL[1])
    assert new_profile["profile_generated_at"] != profile["profile_generated_at"]
    expected = [{**item, "importe_actualizado": {**item["importe_actualizado"], "valor": MODIFIED_TOTAL[1]}}
                if item["caso"] == MODIFIED_CASE else item for item in accepted_objects()]
    assert persisted_mismatches(tenant_tables(after), expected, ids, lot) == []
    events = batches()[previous:]
    counts = events[-1]["counts"]
    assert (counts["filas_insertadas"], counts["filas_actualizadas"]) == (0, 2)
    assert (counts["deudas_insertadas"], counts["deudas_actualizadas"]) == (0, 1)
    assert {name: value["actualizadas"] for name, value in counts["escrituras"].items() if value["actualizadas"]} \
        == {"debt": 1, "debtor_profile": 1}
    assert events[-1]["file_hashes"]["detalle"] != published.events[-1]["file_hashes"]["detalle"], "Otro archivo, otro hash"
    campaign.record("reimportación con una obligación modificada", salida=result.returncode, filas_actualizadas=counts["filas_actualizadas"],
                    tablas_cambiadas=sorted(changes(before, after)), hashes=lot_hashes(lot))


def restore_original(campaign, published):
    # Cada restauración es una entrega explícitamente nueva; el archivo original sigue inmutable.
    number = getattr(campaign, '_restore_number', 0) + 1
    campaign._restore_number = number
    lot = reissue_lot(published.validated.lot, campaign.work / f'restauracion-{number}')
    result = campaign.etl(lot)
    campaign.record('nueva entrega de valores originales', salida=result.returncode,
                    hashes=lot_hashes(lot), origen=published.validated.hashes)
    return result


def test_nueva_entrega_de_los_valores_originales_solo_toca_esas_mismas_dos_filas(campaign, published):
    before = snapshot()
    repeat = campaign.etl(published.validated.lot)
    assert repeat.returncode == 0 and changes(before, snapshot()) == {}
    assert int(line_value(repeat, 'Filas insertadas')) == published.events[-1]['counts']['filas_insertadas']
    result = restore_original(campaign, published)
    after = snapshot()
    assert result.returncode == 0, result.stderr
    found = changes(before, after)
    assert set(found) == {"debt", "debtor_profile"}
    assert (len(found["debt"]["actualizadas"]), len(found["debtor_profile"]["actualizadas"])) == (1, 1)
    assert persisted_mismatches(tenant_tables(after), accepted_objects(), catalogs(), published.validated.lot) == []


# ---------------------------------------------------------------------------
# ALIGN-031: perfiles desde lo persistido, lectura completa y política de ausentes
# ---------------------------------------------------------------------------

PROFILE_AMOUNTS = ("total_debt_amount", "overdue_debt_amount")
PROFILE_COLUMNS = (*PROFILE_AMOUNTS, "debt_count", "overdue_debt_count", "debt_state_not_observed_count", "oldest_debt_days",
                   "average_debt_age_days", "active_person_count", "available_contact_count", "previous_contact_count",
                   "previous_response_count", "socioeconomic_risk_level", "active")


def _same_within_a_cent(column: str, found, wanted) -> bool:
    if column in PROFILE_AMOUNTS and found is not None and wanted is not None:
        return abs(Decimal(str(found)) - Decimal(str(wanted))) <= Decimal("0.01")
    return found == wanted


def _python_oracle(tables: dict, status_keys: dict, debtor: int) -> dict:
    """El mismo cálculo en Python, alimentado solo con lo persistido."""
    debts = [{**row, "status": status_keys.get(row["status"], "UNKNOWN")} for row in tables["debt"] if row["debtor"] == debtor]
    people = {row["person"] for row in tables["debtor_person"] if row["debtor"] == debtor and row["active"]}
    contacts = [row for row in tables["debtor_contact"] if row["person"] in people and row["active"]]
    return build_debtor_profile_payload(debtor, debts, len(people), len(contacts), date.fromisoformat(AS_OF))


def test_la_funcion_sql_coincide_con_los_dos_oraculos_en_un_lote_validado(campaign, published):
    ids = catalogs()
    before = snapshot()
    tables = tenant_tables(before)
    status_keys = {value: key for key, value in ids["debt_status"].items()}
    debtors = sorted(row["id"] for row in tables["debtor"])
    assert line_value(published.result, "Resultado del lote") == "VALIDADO"
    answer = json.loads(psql(f"select public.recompute_debtor_profiles(array{debtors}::bigint[], '{AS_OF}')"))
    assert answer == {"insertadas": 0, "actualizadas": 0, "sin_cambios": len(debtors), "detalles_actualizados": 0, "deudas_reclasificadas": 0}
    assert changes(before, snapshot()) == {}, "Sin cambios no hay escritura: profile_generated_at se conserva"
    assert persisted_mismatches(tables, accepted_objects(), ids, published.validated.lot) == []
    differences = []
    for profile in tables["debtor_profile"]:
        wanted = _python_oracle(tables, status_keys, profile["debtor"])
        differences += [(profile["debtor"], column) for column in PROFILE_COLUMNS if not _same_within_a_cent(column, profile[column], wanted[column])]
    assert differences == []
    observed = {(row["overdue_debt_amount"] is None, row["debt_state_not_observed_count"] > 0) for row in tables["debtor_profile"]}
    assert {(False, False), (False, True)} <= observed, "Completo, y subtotal con estados faltantes"
    campaign.record("paridad SQL y oráculos", objetos=len(debtors), diferencias=len(differences))


def test_con_estados_faltantes_y_sin_vencidas_la_paridad_se_mantiene_en_un_lote_validado(campaign, published):
    item = object_by_case(MODIFIED_CASE)
    ids = catalogs()
    status_keys = {value: key for key, value in ids["debt_status"].items()}
    lot = derive_lot(campaign.work / "sin-estados", (QUARANTINED_CASE,), detalle_cells={(item["clave_agrupacion"], None, "NOTD_ESTA_id"): ""})
    result = campaign.etl(lot)
    assert result.returncode == 0, result.stderr
    assert line_value(result, "Resultado del lote") == "VALIDADO"
    tables = tenant_tables(snapshot())
    profile = next(row for row in tables["debtor_profile"] if row["debtor"] == debtor_of(tables, ids["debtor_type"], MODIFIED_CASE)["id"])
    assert (profile["overdue_debt_amount"], profile["overdue_debt_count"]) == (None, None), "Regla 2 de §4.1: no es un cero"
    assert profile["debt_state_not_observed_count"] == item["obligaciones"]
    assert persisted_mismatches(tables, accepted_with_altered((MODIFIED_CASE,), lot), ids, lot) == []
    wanted = _python_oracle(tables, status_keys, profile["debtor"])
    assert [column for column in PROFILE_COLUMNS if not _same_within_a_cent(column, profile[column], wanted[column])] == []
    assert restore_original(campaign, published).returncode == 0
    assert persisted_mismatches(tenant_tables(snapshot()), accepted_objects(), ids, published.validated.lot) == []


def _recompute_in_rollback(debts: list[tuple], *, integrated: bool = True, extra: str = "") -> tuple[dict, dict]:
    """Objeto sintético dentro de una transacción que se revierte: no deja nada en la cartera de la campaña."""
    ids = catalogs()
    values = ", ".join(
        f"({900000 + index}, 990001, {amount}, {amount}, " + (f"'{due}'" if due else "null") + ", "
        + (str(ids["debt_status"][status]) if status else "null") + ")"
        for index, (amount, status, due) in enumerate(debts)
    )
    insert = f"insert into public.debt (external_id, debtor, original_amount, current_amount, due_date, status) values {values};" if debts else ""
    call = f"select public.recompute_debtor_profiles(array[990001, 990002]::bigint[], '{AS_OF}', {str(integrated).lower()});"
    lines = psql(f"""begin;
        insert into public.debtor (id, tenant, external_id, type) values (990001, {TENANT}, 990001, {next(iter(ids["debtor_type"].values()))});
        {insert} {call} {extra}
        select to_jsonb(p) from public.debtor_profile p where p.debtor = 990001;
        rollback;""").strip().splitlines()
    return json.loads(lines[0]), json.loads(lines[-1], parse_float=Decimal)


RECOMPUTE_CASES = {
    "sin-obligaciones-cero-derivado": ([], {"total_debt_amount": 0, "overdue_debt_amount": 0, "debt_count": 0, "overdue_debt_count": 0,
                                            "debt_state_not_observed_count": 0, "oldest_debt_days": None}),
    "faltantes-sin-vencidas-nulos": ([("10.50", "UNKNOWN", "2026-01-01"), ("5", "ACTIVE", AS_OF)],
                                     {"total_debt_amount": Decimal("15.50"), "overdue_debt_amount": None, "overdue_debt_count": None,
                                      "debt_state_not_observed_count": 1, "oldest_debt_days": None, "average_debt_age_days": None}),
    "faltantes-con-vencidas-subtotal": ([("10.50", "OVERDUE", "2026-09-28"), ("3", "UNKNOWN", "2026-01-01")],
                                        {"overdue_debt_amount": Decimal("10.50"), "overdue_debt_count": 1,
                                         "debt_state_not_observed_count": 1, "oldest_debt_days": 2, "average_debt_age_days": 2}),
    "observados-sin-vencidas-cero": ([("7", "ACTIVE", AS_OF)], {"overdue_debt_amount": 0, "overdue_debt_count": 0,
                                                                        "debt_state_not_observed_count": 0}),
    "promedio-mitad-hacia-arriba": ([("1", "OVERDUE", "2026-09-28"), ("1", "OVERDUE", "2026-09-27")],
                                    {"oldest_debt_days": 3, "average_debt_age_days": 3}),
}


@pytest.mark.parametrize("name", RECOMPUTE_CASES)
def test_cada_regla_del_perfil_coincide_con_el_oraculo_python(published, name):
    debts, wanted = RECOMPUTE_CASES[name]
    answer, profile = _recompute_in_rollback(debts)
    assert answer == {"insertadas": 1, "actualizadas": 0, "sin_cambios": 0, "detalles_actualizados": 0, "deudas_reclasificadas": 0}, "El objeto que no existe no cuenta"
    for column, value in wanted.items():
        assert profile[column] == value, column
    oracle_rows = [{"status": status, "due_date": due, "current_amount": amount} for amount, status, due in debts]
    python = build_debtor_profile_payload(990001, oracle_rows, 0, 0, date.fromisoformat(AS_OF))
    assert [column for column in PROFILE_COLUMNS if not _same_within_a_cent(column, profile[column], python[column])] == []


def test_un_estado_nulo_tampoco_esta_observado_y_sin_columnas_de_contacto_no_hay_conteo(published):
    _answer, profile = _recompute_in_rollback([("4", None, "2026-01-01")], integrated=False)
    assert (profile["debt_state_not_observed_count"], profile["overdue_debt_amount"], profile["overdue_debt_count"]) == (1, None, None)
    assert profile["available_contact_count"] is None
    _answer, profile = _recompute_in_rollback([("4", "ACTIVE", "2026-01-01")])
    assert profile["available_contact_count"] == 0


def test_una_cifra_igual_con_otra_escala_no_reescribe_el_perfil(published):
    answer, profile = _recompute_in_rollback([("10.50", "ACTIVE", "2026-01-01")], extra=f"""
        update public.debtor_profile set total_debt_amount = 10.5, profile_generated_at = '2000-01-01 00:00:00+00' where debtor = 990001;
        select public.recompute_debtor_profiles(array[990001]::bigint[], '{AS_OF}');""")
    assert profile["profile_generated_at"].startswith("2000-01-01")
    _answer, profile = _recompute_in_rollback([("10.50", "ACTIVE", "2026-01-01")], extra=f"""
        update public.debt set current_amount = 10.51 where debtor = 990001;
        update public.debtor_profile set profile_generated_at = '2000-01-01 00:00:00+00' where debtor = 990001;
        select public.recompute_debtor_profiles(array[990001]::bigint[], '{AS_OF}');""")
    assert not profile["profile_generated_at"].startswith("2000-01-01")
    assert profile["total_debt_amount"] == Decimal("10.51")


def test_la_funcion_no_es_ejecutable_por_clientes_y_rechaza_entradas_nulas(published):
    signature = "public.recompute_debtor_profiles(bigint[], date, boolean)"
    allowed = psql(f"select has_function_privilege('anon', '{signature}', 'execute'), has_function_privilege('authenticated', '{signature}', 'execute'), "
                   f"has_function_privilege('service_role', '{signature}', 'execute')").strip()
    assert allowed == "f|f|t"
    with pytest.raises(pytest.fail.Exception, match="INVALID_RECOMPUTE_INPUT"):
        psql(f"select public.recompute_debtor_profiles(null, '{AS_OF}')")
    with pytest.raises(pytest.fail.Exception, match="INVALID_RECOMPUTE_INPUT"):
        psql("select public.recompute_debtor_profiles(array[1]::bigint[], null)")


def test_reclasificacion_sql_respeta_estados_faltantes_fechas_y_objetos_ajenos(published):
    ids = catalogs()
    # Estado previo, vencimiento, importe y resultado esperado: independientes del agregado SQL y del helper Python.
    cases = [
        ("ACTIVE", "2026-09-28", "10.50", "OVERDUE"),
        ("OVERDUE", AS_OF, "7", "ACTIVE"),
        ("OVERDUE", "2026-10-01", "9", "ACTIVE"),
        ("ACTIVE", "2026-10-02", "5", "ACTIVE"),
        ("OVERDUE", "2026-09-25", "11", "OVERDUE"),
        *((key, "2026-09-01", "13", key) for key in
          ("PAID", "CANCELLED", "SUSPENDED", "UNKNOWN", None, "PAYMENT_PLAN", "JUDICIAL", "CERTIFICATE_ACTIVE")),
        ("ACTIVE", None, "17", "ACTIVE"),
        ("OVERDUE", None, "19", "OVERDUE"),
    ]
    values = ",".join(
        f"({900000 + index},990001,{amount},{amount}," + (f"'{due}'" if due else "null") + ","
        + (str(ids["debt_status"][status]) if status else "null") + ")"
        for index, (status, due, amount, _) in enumerate(cases)
    )
    # ctid, a diferencia de xmin, detecta otra versión incluso dentro de esta misma transacción.
    read = """select json_build_object(
        'debts', (select json_agg(to_jsonb(d) || jsonb_build_object('_ctid', d.ctid::text) order by d.id)
                  from public.debt d where d.debtor in (990001,990002)),
        'profiles', (select coalesce(json_agg(to_jsonb(p) || jsonb_build_object('_ctid', p.ctid::text) order by p.id), '[]')
                     from public.debtor_profile p where p.debtor in (990001,990002)));"""
    call = f"select public.recompute_debtor_profiles(array[990001]::bigint[], '{AS_OF}');"
    lines = psql(f"""begin;
        insert into public.debtor(id,tenant,external_id,type) values
            (990001,{TENANT},990001,{next(iter(ids['debtor_type'].values()))}),
            (990002,{TENANT},990002,{next(iter(ids['debtor_type'].values()))});
        insert into public.debt(external_id,debtor,original_amount,current_amount,due_date,status) values
            {values}, (990002,990002,47,47,'2026-09-01',{ids['debt_status']['ACTIVE']});
        {read} {call} {read} {call} {read}
        rollback;""").splitlines()
    before, first, after, second, repeated = [json.loads(line, parse_float=Decimal) for line in lines]
    assert first == {"insertadas": 1, "actualizadas": 0, "sin_cambios": 0, "detalles_actualizados": 0, "deudas_reclasificadas": 3}
    assert second == {"insertadas": 0, "actualizadas": 0, "sin_cambios": 1, "detalles_actualizados": 0, "deudas_reclasificadas": 0}
    assert repeated == after, "Repetir el mismo corte no reescribe ninguna fila"
    expected = {900000 + index: ids["debt_status"][status] if status else None for index, (*_, status) in enumerate(cases)}
    expected[990002] = ids["debt_status"]["ACTIVE"]
    for old, new in zip(before["debts"], after["debts"], strict=True):
        assert new["status"] == expected[new["external_id"]]
        if old["status"] == new["status"]:
            assert old == new, "No se reescriben estados ajenos, faltantes ni ya correctos"
        else:
            assert {k: v for k, v in old.items() if k not in ("status", "_ctid")} == {
                k: v for k, v in new.items() if k not in ("status", "_ctid")}
    assert len(after["profiles"]) == 1
    profile = after["profiles"][0]
    assert profile["debtor"] == 990001
    assert profile["total_debt_amount"] == sum(Decimal(amount) for _, _, amount, _ in cases)
    assert (profile["overdue_debt_amount"], profile["overdue_debt_count"], profile["debt_state_not_observed_count"]) == (Decimal("40.50"), 3, 2)
    assert (profile["oldest_debt_days"], profile["average_debt_age_days"]) == (5, 4)


def test_error_de_perfil_revierte_la_reclasificacion_de_la_misma_rpc(published):
    ids = catalogs()
    # Solo atomicidad de la RPC. La publicación completa de la CLI sigue siendo alcance de ALIGN-032.
    result = psql(f"""begin;
        insert into public.debtor(id,tenant,external_id,type) values (990001,{TENANT},990001,{next(iter(ids['debtor_type'].values()))});
        insert into public.debt(external_id,debtor,original_amount,current_amount,due_date,status)
            values(990001,990001,10.50,10.50,'2026-09-01',{ids['debt_status']['ACTIVE']});
        create function pg_temp.fail_profile031() returns trigger language plpgsql as $$
            begin raise exception 'PROFILE031_TEST_FAILURE'; end $$;
        create trigger fail_profile031 before insert on public.debtor_profile for each row execute function pg_temp.fail_profile031();
        do $$ begin
            perform public.recompute_debtor_profiles(array[990001]::bigint[], '{AS_OF}');
            raise exception 'EXPECTED_RPC_FAILURE';
        exception when raise_exception then
            if sqlerrm <> 'PROFILE031_TEST_FAILURE' then raise; end if;
        end $$;
        select json_build_object('status',(select status from public.debt where debtor=990001),
            'profiles',(select count(*) from public.debtor_profile where debtor=990001));
        rollback;""")
    assert json.loads(result) == {"status": ids["debt_status"]["ACTIVE"], "profiles": 0}


def test_carga_parcial_no_altera_perfiles_ajenos(campaign, published):
    ids = catalogs()
    before = snapshot()
    tables = tenant_tables(before)
    debtor = debtor_of(tables, ids["debtor_type"], MODIFIED_CASE)
    debt = next(row for row in tables["debt"] if row["debtor"] == debtor["id"] and str(row["external_id"]) == MODIFIED_DEBT)
    profile = next(row for row in tables["debtor_profile"] if row["debtor"] == debtor["id"])
    lot = _modified_lot(campaign, "delta-un-objeto")
    keys = [item["clave_agrupacion"] for item in published.validated.selected if item["caso"] != MODIFIED_CASE]
    drop_lines(lot / "cabecera.tsv", *[(key,) for key in keys])
    drop_lines(lot / "detalle.tsv", *[(key,) for key in keys])
    previous = len(batches())
    result = campaign.etl(lot, "--ausentes", "conservar")
    after = snapshot()
    assert result.returncode == 0, result.stderr
    assert line_value(result, "Resultado del lote") == "VALIDADO"
    assert changes(before, after) == {
        "debt": {"insertadas": [], "actualizadas": [debt["id"]], "borradas": []},
        "debtor_profile": {"insertadas": [], "actualizadas": [profile["id"]], "borradas": []},
    }, "Un perfil ajeno reescrito cambia su xmin aunque deje los mismos valores"
    assert Decimal(str(after["debtor_profile"][profile["id"]]["total_debt_amount"])) == Decimal(MODIFIED_TOTAL[1])
    events = batches()[previous:]
    assert [event["status"] for event in events] == ["RECIBIDO", "VALIDADO", "CONFIRMADO", "PUBLICADO"]
    assert all(event["counts"]["ausentes"] == {"objetos": len(tables["debtor"]) - 1} for event in events[1:])
    assert "Ausentes del archivo: objetos=" in result.stdout
    assert restore_original(campaign, published).returncode == 0
    assert persisted_mismatches(tenant_tables(snapshot()), accepted_objects(), ids, published.validated.lot) == []
    campaign.record("delta con un objeto", salida=result.returncode, tablas_cambiadas=sorted(changes(before, after)))


def test_una_obligacion_ausente_se_conserva_se_informa_y_sigue_contando(campaign, published):
    lot = _rejected_missing_debt(campaign, "conservar-obligacion")[0]
    before = snapshot()
    previous = len(batches())
    result = campaign.etl(lot, "--ausentes", "dar-de-baja")
    assert result.returncode == 0, result.stderr
    assert batches()[previous:][-1]["counts"]["ausentes"] == {"obligaciones": 1}
    assert changes(before, snapshot()) == {}, "El archivo no dice que se pagó: la obligación y el perfil quedan como estaban"


def test_dar_de_baja_una_relacion_es_explicita_y_reversible(campaign, published):
    item = object_by_case("dos-personas-un-objeto")
    lot = _rejected_missing_relation(campaign, "baja-relacion")[0]
    before = snapshot()
    tables = tenant_tables(before)
    debtor = debtor_of(tables, catalogs()["debtor_type"], "dos-personas-un-objeto")
    person = next(row["id"] for row in tables["person"] if row["external_id"] == item["personas"][-1])
    relation = next(row for row in tables["debtor_person"] if row["debtor"] == debtor["id"] and row["person"] == person)
    profile = next(row for row in tables["debtor_profile"] if row["debtor"] == debtor["id"])
    detail = next(row for row in tables["debtor_profile_detail"] if row["debtor_profile"] == profile["id"] and row["person"] == person)
    previous = len(batches())
    result = campaign.etl(lot, "--ausentes", "dar-de-baja")
    after = snapshot()
    assert result.returncode == 0, result.stderr
    assert changes(before, after) == {
        "debtor_person": {"insertadas": [], "actualizadas": [relation["id"]], "borradas": []},
        "debtor_profile": {"insertadas": [], "actualizadas": [profile["id"]], "borradas": []},
        "debtor_profile_detail": {"insertadas": [], "actualizadas": [detail["id"]], "borradas": []},
    }
    assert after["debtor_person"][relation["id"]]["active"] is False
    assert after["debtor_profile_detail"][detail["id"]]["active"] is False
    assert after["debtor_profile"][profile["id"]]["active_person_count"] == profile["active_person_count"] - 1
    counts = batches()[previous:][-1]["counts"]
    assert (counts["ausentes"], counts["bajas_relaciones"], counts["bajas_contactos"]) == ({"relaciones": 1}, 1, 0)
    assert (counts["filas_insertadas"], counts["filas_actualizadas"]) == (0, 3), "Lo informado es lo que muestra xmin"
    # Ya dada de baja, recargar el mismo archivo con la política por defecto no encuentra ausentes ni escribe.
    again = campaign.etl(lot)
    assert again.returncode == 0, again.stderr
    assert changes(after, snapshot()) == {}
    assert "ausentes" not in batches()[-1]["counts"]
    # Si vuelve a venir, se reactiva y todo concilia con el oráculo.
    assert restore_original(campaign, published).returncode == 0
    restored = snapshot()
    assert restored["debtor_person"][relation["id"]]["active"] is True
    assert persisted_mismatches(tenant_tables(restored), accepted_objects(), catalogs(), published.validated.lot) == []
    campaign.record("baja de una relación", salida=result.returncode, bajas=counts["bajas_relaciones"])


def test_un_contacto_ausente_se_informa_y_solo_se_desactiva_si_la_politica_lo_pide(campaign, published):
    item = object_by_case(MODIFIED_CASE)
    key = item["clave_agrupacion"]
    assert item["contactos_utilizables"] == 1
    lot = derive_lot(campaign.work / "sin-contacto", (QUARANTINED_CASE,), cabecera_cells={
        (key, None, column): "" for column in ("Destinatario_Telefono", "Destinatario_Celular", "Destinatario_Email")})
    before = snapshot()
    tables = tenant_tables(before)
    debtor = debtor_of(tables, catalogs()["debtor_type"], MODIFIED_CASE)
    profile = next(row for row in tables["debtor_profile"] if row["debtor"] == debtor["id"])
    person = next(row["person"] for row in tables["debtor_person"] if row["debtor"] == debtor["id"])
    contact = next(row for row in tables["debtor_contact"] if row["person"] == person and row["active"])
    for policy in ((), ("--ausentes", "conservar")):
        result = campaign.etl(lot, *policy)
        assert result.returncode == 0, result.stderr
        assert batches()[-1]["counts"]["ausentes"] == {"contactos": 1}
        assert changes(before, snapshot()) == {}, "Sin baja pedida no se desactiva nada"
    result = campaign.etl(lot, "--ausentes", "dar-de-baja")
    after = snapshot()
    assert result.returncode == 0, result.stderr
    assert batches()[-1]["counts"]["bajas_contactos"] == 1
    assert changes(before, after) == {
        "debtor_contact": {"insertadas": [], "actualizadas": [contact["id"]], "borradas": []},
        "debtor_profile": {"insertadas": [], "actualizadas": [profile["id"]], "borradas": []},
    }
    assert after["debtor_contact"][contact["id"]]["active"] is False
    assert after["debtor_profile"][profile["id"]]["available_contact_count"] == 0
    assert contact["value"] not in result.stdout + result.stderr, "El valor del contacto no sale por la CLI"
    assert contact["value"] not in json.dumps(batches()[-1]["counts"]), "Ni queda en el lote"
    assert restore_original(campaign, published).returncode == 0
    assert persisted_mismatches(tenant_tables(snapshot()), accepted_objects(), catalogs(), published.validated.lot) == []


def test_mas_de_1000_deudas_existentes_se_leen_todas_por_la_data_api(campaign, published):
    tables = tenant_tables(snapshot())
    debtor = debtor_of(tables, catalogs()["debtor_type"], MODIFIED_CASE)["id"]
    psql(f"insert into public.debt (external_id, debtor, original_amount, current_amount) "
         f"select 980000 + n, {debtor}, 1, 1.25 from generate_series(1, 1203) n")
    try:
        capped = httpx.get(f"{campaign.env['API_URL']}/rest/v1/debt", params={"select": "id", "debtor": f"eq.{debtor}"},
                           headers={"apikey": campaign.env["SERVICE_ROLE_KEY"], "Authorization": f"Bearer {campaign.env['SERVICE_ROLE_KEY']}"},
                           timeout=30, trust_env=False)
        assert len(capped.json()) == 1000, "Sin el corte de la Data API esta prueba no prueba nada"
        code = ("from ETL import load; "
                f"keys = [{{'debtor': {debtor}, 'external_id': 980000 + n}} for n in range(1, 1204)]; "
                "print(len(load.fetch_existing_debts_by_key(keys)))")
        result = subprocess.run([sys.executable, "-c", code], cwd=BACK, env=campaign.environment(), capture_output=True, text=True, check=False)
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip().splitlines()[-1] == "1203"
    finally:
        psql(f"delete from public.debt where debtor = {debtor} and external_id > 980000")


def test_un_objeto_publicado_que_cae_en_cuarentena_conserva_su_estado_y_no_es_una_baja(campaign, published):
    key = object_by_case(MODIFIED_CASE)["clave_agrupacion"]
    lot = derive_lot(campaign.work / "cae-en-cuarentena", detalle_cells={(key, MODIFIED_DEBT, "NOTD_capital"): "sin-monto"})
    before = snapshot()
    result = campaign.etl(lot)
    assert result.returncode == 0, result.stderr
    assert line_value(result, "objetos_en_cuarentena") == "1"
    assert changes(before, snapshot()) == {}
    assert batches()[-1]["status"] == "PUBLICADO"
    campaign.record("objeto publicado en cuarentena", salida=result.returncode, filas_reescritas_en_la_base=0)


def test_una_persona_con_datos_distintos_en_varios_objetos_no_se_reescribe_al_recargar(campaign, published):
    """90015 viene en tres objetos. Con datos distintos, escribirla por fila iría y volvería en cada recarga."""
    objects = ("3-10012", "6-10013", "1-10014")
    lot = derive_lot(campaign.work / "persona-varios-objetos", (QUARANTINED_CASE,), cabecera_cells={
        (objects[0], None, "Destinatario_Calle"): "Calle Primera", (objects[1], None, "Destinatario_Localidad"): "Localidad Intermedia",
        (objects[1], None, "Destinatario_CP"): "", (objects[2], None, "Destinatario_Calle"): "Calle Ultima",
        (objects[2], None, "Destinatario"): "Nombre Sintetico Ultimo",
    })
    assert campaign.etl(lot).returncode == 0
    rows = snapshot()
    person = next(row for row in rows["person"].values() if row["external_id"] == 90015)
    assert person["full_name"] == "Nombre Sintetico Ultimo"
    assert next(row for row in rows["address"].values() if row["person"] == person["id"])["street"] == "Calle Ultima"
    result = campaign.etl(lot)
    assert result.returncode == 0
    assert changes(rows, snapshot()) == {}
    assert (line_value(result, "Filas insertadas"), line_value(result, "Filas actualizadas")) == ("0", "2")
    assert restore_original(campaign, published).returncode == 0
    assert persisted_mismatches(tenant_tables(snapshot()), accepted_objects(), catalogs(), published.validated.lot) == []


def _rejected_fixture(campaign, _name):
    return FIXTURE, "BATCH_BLOCKED", False


def _rejected_missing_column(campaign, name):
    return derive_lot(campaign.work / name, (QUARANTINED_CASE,), drop_header_columns=("Cuenta",)), "COLUMNA_OBLIGATORIA_AUSENTE", False


def _rejected_unreadable(campaign, name):
    lot = derive_lot(campaign.work / name, (QUARANTINED_CASE,))
    (lot / "detalle.tsv").write_bytes((lot / "detalle.tsv").read_bytes() + b"\xff\xfe\n")
    return lot, None, False


def _rejected_missing_object(campaign, name):
    lot = derive_lot(campaign.work / name, (QUARANTINED_CASE,))
    key = object_by_case("base-valido")["clave_agrupacion"]
    drop_lines(lot / "cabecera.tsv", (key,))
    drop_lines(lot / "detalle.tsv", (key,))
    return lot, "PARTIAL_LOAD_REJECTED", True


def _rejected_missing_debt(campaign, name):
    key = object_by_case("base-valido")["clave_agrupacion"]
    # Controles de la cabecera ajustados: el archivo concilia y solo le falta una obligación ya publicada.
    lot = derive_lot(campaign.work / name, (QUARANTINED_CASE,),
                     cabecera_cells={(key, None, "Deuda_Actualizada"): "32.462,07", (key, None, "Deuda_Capital"): "27.196,60",
                                     (key, None, "Periodos_Deuda"): "2"})
    drop_lines(lot / "detalle.tsv", (key, MODIFIED_DEBT))
    return lot, "PARTIAL_LOAD_REJECTED", True


def _rejected_missing_relation(campaign, name):
    item = object_by_case("dos-personas-un-objeto")
    lot = derive_lot(campaign.work / name, (QUARANTINED_CASE,))
    drop_lines(lot / "cabecera.tsv", (item["clave_agrupacion"], str(item["personas"][-1])))
    return lot, "PARTIAL_LOAD_REJECTED", True


@pytest.mark.parametrize("policy", ["conservar", "dar-de-baja"])
def test_delta_conservado_reclasifica_la_deuda_pendiente_al_nuevo_corte(campaign, published, policy):
    """R31-01: el archivo omite una pendiente que vence entre ambos cortes; el oráculo no lee su estado guardado."""
    key = object_by_case(MODIFIED_CASE)["clave_agrupacion"]
    full = derive_lot(campaign.work / f"corte-inicial-{policy}", (QUARANTINED_CASE,),
                      detalle_cells={(key, MODIFIED_DEBT, "NOTD_vencimiento"): "01/10/2026"})
    full = reissue_lot(full, campaign.work / f"nueva-entrega-corte-{policy}")
    delta = _rejected_missing_debt(campaign, f"corte-delta-{policy}")[0]
    # El delta solo acepta el objeto objetivo: también debe dejar intactos los perfiles y deudas ajenos.
    other_keys = [(item["clave_agrupacion"],) for item in published.validated.selected if item["caso"] != MODIFIED_CASE]
    drop_lines(delta / "cabecera.tsv", *other_keys)
    drop_lines(delta / "detalle.tsv", *other_keys)
    try:
        initial = campaign.etl(full)
        assert initial.returncode == 0, initial.stderr
        before = snapshot()
        debtor = debtor_of(tenant_tables(before), catalogs()["debtor_type"], MODIFIED_CASE)["id"]
        debt = next(row for row in before["debt"].values() if row["debtor"] == debtor and str(row["external_id"]) == MODIFIED_DEBT)
        profile = next(row for row in before["debtor_profile"].values() if row["debtor"] == debtor)
        assert debt["status"] == catalogs()["debt_status"]["ACTIVE"]
        assert (profile["overdue_debt_count"], profile["overdue_debt_amount"]) == (2, Decimal("32462.07"))
        for cutoff, expected_status, expected_count, expected_amount in (
            ("2026-10-02", "OVERDUE", 3, Decimal("46279.60")),
            ("2026-10-01", "ACTIVE", 2, Decimal("32462.07")),
            (AS_OF, "ACTIVE", 2, Decimal("32462.07")),
        ):
            mapping = synthetic_profile(delta, fecha_corte=cutoff)
            previous = snapshot()
            result = campaign.etl(delta, "--ausentes", policy, "--mapping", str(mapping), cut_off=cutoff)
            assert result.returncode == 0, result.stderr
            after = snapshot()
            got = after["debtor_profile"][profile["id"]]
            assert after["debt"][debt["id"]]["status"] == catalogs()["debt_status"][expected_status]
            assert (got["overdue_debt_count"], got["overdue_debt_amount"]) == (expected_count, expected_amount)
            # Las tres obligaciones del caso son PENDIENTE en el origen: la fecha determina la mora, no la FK previa.
            overdue = [row for row in before["debt"].values() if row["debtor"] == debtor and row["due_date"] < cutoff]
            days = [(date.fromisoformat(cutoff) - date.fromisoformat(row["due_date"])).days for row in overdue]
            assert got["oldest_debt_days"] == max(days)
            assert got["average_debt_age_days"] == int((Decimal(sum(days)) / len(days)).quantize(Decimal(1), rounding="ROUND_HALF_UP"))
            assert (got["debt_count"], got["total_debt_amount"]) == (3, Decimal("46279.60"))
            changed_debts = [debt["id"]] if previous["debt"][debt["id"]]["status"] != after["debt"][debt["id"]]["status"] else []
            expected_changes = {"debtor_profile": {"insertadas": [], "actualizadas": [profile["id"]], "borradas": []}}
            if changed_debts:
                expected_changes["debt"] = {"insertadas": [], "actualizadas": changed_debts, "borradas": []}
            assert changes(previous, after) == expected_changes
            counts = batches()[-1]["counts"]
            assert counts["ausentes"]["obligaciones"] == 1
            assert counts["filas_actualizadas"] == 1 + len(changed_debts)
            assert counts["escrituras"]["debt"]["actualizadas"] == len(changed_debts)
            assert counts["deudas_actualizadas"] == 0, "La reclasificación es de una deuda conservada, no de una fila del archivo"
            again = campaign.etl(delta, "--ausentes", policy, "--mapping", str(mapping), cut_off=cutoff)
            assert again.returncode == 0, again.stderr
            assert changes(after, snapshot()) == {}, "Ni deuda ni profile_generated_at se reescriben al repetir el mismo corte"
            assert batches()[-1]["counts"] == counts
            assert int(line_value(again, "Filas actualizadas")) == counts["filas_actualizadas"]
            campaign.record("delta conservado al nuevo corte", politica=policy, corte=cutoff, mora=str(got["overdue_debt_amount"]),
                            vencidas=got["overdue_debt_count"], reclasificadas=len(changed_debts), idempotente=True)
    finally:
        restored = restore_original(campaign, published)
        assert restored.returncode == 0, restored.stderr


REJECTED = {
    "fixture-completa": _rejected_fixture,
    "falta-una-columna": _rejected_missing_column,
    "archivo-ilegible": _rejected_unreadable,
    "falta-un-objeto": _rejected_missing_object,
    "falta-una-obligacion": _rejected_missing_debt,
    "falta-una-relacion": _rejected_missing_relation,
}


@pytest.mark.parametrize("name", REJECTED)
def test_un_archivo_rechazado_no_cambia_nada_y_queda_fallido(campaign, published, name):
    lot, wanted_code, validates = REJECTED[name](campaign, name)
    if validates:
        lot = reissue_lot(lot, campaign.work / f'rechazo-nuevo-{name}')
    before = snapshot()
    previous = len(batches())
    result = campaign.etl(lot)
    after = snapshot()
    code = error_code(result)
    assert result.returncode == 1, result.stdout
    if wanted_code:
        assert code == wanted_code
    assert changes(before, after) == {}, "Un archivo rechazado escribió cartera"
    if validates:
        assert line_value(result, "Resultado del lote") == "VALIDADO", "Debe rechazarse por parcial, no por otra causa"
    events = batches()[previous:]
    expected_events = [('RECIBIDO', None), ('FALLIDO', events[0]['id'])] if validates else [('FALLIDO', None)]
    assert [(event['status'], event['supersedes']) for event in events] == expected_events
    assert events[-1]['file_hashes']['detalle'] == sha256(lot / 'detalle.tsv')
    if wanted_code == 'PARTIAL_LOAD_REJECTED':
        assert sum(events[-1]['counts']['faltantes'].values()) >= 1
    campaign.record(f'rechazo: {name}', salida=result.returncode, codigo=code, estado=events[-1]['status'],
                    filas_reescritas_en_la_base=0, dataset=dataset_hash(lot_hashes(lot)))


def test_pedir_un_subconjunto_del_lote_se_rechaza_antes_de_leer(campaign, published):
    before = snapshot()
    previous = len(batches())
    result = campaign.etl(published.validated.lot, "--limit-objects", "1")
    assert (result.returncode, error_code(result)) == (1, "PARTIAL_LOAD_REJECTED")
    assert changes(before, snapshot()) == {}
    assert len(batches()) == previous
    campaign.record("rechazo: subconjunto pedido por parámetro", salida=result.returncode, codigo=error_code(result))


def test_una_falla_durante_la_carga_termina_fallido_con_antecedente(campaign, published):
    """Sin VALIDADO colgado: es lo que ALIGN-020 usa para saber que una revisión ya no tiene corte vigente."""
    psql("create function public.a027_falla() returns trigger language plpgsql as "
         "$$ begin raise exception 'falla inyectada ALIGN-027'; end $$; "
         "create trigger a027_falla before update on public.debt for each row execute function public.a027_falla();")
    try:
        before = snapshot()
        previous = len(batches())
        result = campaign.etl(_modified_lot(campaign, "con-falla"))
    finally:
        psql("drop trigger a027_falla on public.debt; drop function public.a027_falla();")
    assert result.returncode == 1
    assert error_code(result) == "IMPORT_PUBLICATION_FAILED"
    assert "falla inyectada" not in result.stdout + result.stderr, "El mensaje del proveedor no se propaga"
    events = batches()[previous:]
    assert [(event["status"], event["supersedes"]) for event in events] == [("RECIBIDO", None), ("VALIDADO", events[0]["id"]), ("FALLIDO", events[1]["id"])]
    assert changes(before, snapshot()) == {}
    campaign.record("falla durante la carga", salida=result.returncode, codigo=error_code(result),
                    eventos=[event["status"] for event in events])


def test_un_rechazo_de_publicado_termina_fallido_con_antecedente(campaign, published):
    """Después de escrituras efectivas la base rechaza el cierre, y sigue disponible: el lote no puede quedar abierto."""
    psql("create function public.a027_rechaza_publicado() returns trigger language plpgsql as "
         "$$ begin if new.status = 'PUBLICADO' then raise exception 'rechazo inyectado ALIGN-027'; end if; return new; end $$; "
         "create trigger a027_rechaza_publicado before insert on public.import_batch "
         "for each row execute function public.a027_rechaza_publicado();")
    try:
        before = snapshot()
        previous = len(batches())
        result = campaign.etl(_modified_lot(campaign, "publicado-rechazado"))
    finally:
        psql("drop trigger a027_rechaza_publicado on public.import_batch; drop function public.a027_rechaza_publicado();")
    assert (result.returncode, error_code(result)) == (1, "IMPORT_PUBLICATION_FAILED")
    assert "rechazo inyectado" not in result.stdout + result.stderr, "El mensaje del proveedor no se propaga"
    events = batches()[previous:]
    assert [(event["status"], event["supersedes"]) for event in events] == [("RECIBIDO", None), ("VALIDADO", events[0]["id"]), ("FALLIDO", events[1]["id"])]
    assert events[1]["file_hashes"] == events[0]["file_hashes"]
    # El rechazo del cierre revierte también deudas y perfiles, en la misma transacción.
    assert changes(before, snapshot()) == {}
    campaign.record("rechazo de PUBLICADO", salida=result.returncode, codigo=error_code(result),
                    eventos=[event["status"] for event in events], tablas_cambiadas=[])
    assert restore_original(campaign, published).returncode == 0, "Una recarga posterior recupera el lote"
    assert persisted_mismatches(tenant_tables(snapshot()), accepted_objects(), catalogs(), published.validated.lot) == []


@pytest.mark.parametrize("base", ["100000000000000", "1000000000000000"])
def test_un_centavo_en_un_importe_extremo_se_actualiza_y_la_recarga_no_cambia_nada(campaign, published, base):
    target = object_by_case(MODIFIED_CASE)
    key = target["clave_agrupacion"]
    others = Decimal(target["importe_actualizado"]["valor"]) - Decimal("13817.53")

    def amount_text(value: Decimal) -> str:
        whole, cents = format(value, ".2f").split(".")
        return f"{int(whole):,}".replace(",", ".") + "," + cents

    def lot(cents: str) -> Path:
        amount = Decimal(f"{base}.{cents}")
        return derive_lot(campaign.work / f"extremo-{base}-{cents}", (QUARANTINED_CASE,),
                          cabecera_cells={(key, None, "Deuda_Actualizada"): amount_text(amount + others)},
                          detalle_cells={(key, MODIFIED_DEBT, "NOTD_totalActualizado"): amount_text(amount)})

    assert campaign.etl(lot("01")).returncode == 0
    before = snapshot()
    ids = catalogs()
    tables = tenant_tables(before)
    debtor = debtor_of(tables, ids["debtor_type"], MODIFIED_CASE)
    debt = next(row for row in tables["debt"] if row["debtor"] == debtor["id"] and str(row["external_id"]) == MODIFIED_DEBT)
    profile = next(row for row in tables["debtor_profile"] if row["debtor"] == debtor["id"])
    corrected = lot("02")
    result = campaign.etl(corrected)
    after = snapshot()
    assert result.returncode == 0, result.stderr
    assert line_value(result, "Deudas actualizadas") == "1", "Un centavo es un cambio, también en un importe extremo"
    assert changes(before, after) == {
        "debt": {"insertadas": [], "actualizadas": [debt["id"]], "borradas": []},
        "debtor_profile": {"insertadas": [], "actualizadas": [profile["id"]], "borradas": []},
    }
    assert after["debt"][debt["id"]]["current_amount"] == Decimal(f"{base}.02")
    assert after["debtor_profile"][profile["id"]]["total_debt_amount"] == Decimal(f"{base}.02") + others
    reload = campaign.etl(corrected)
    assert changes(after, snapshot()) == {}, "La recarga de un importe extremo reescribió filas"
    assert (line_value(reload, "Filas insertadas"), line_value(reload, "Filas actualizadas")) == ("0", "2")
    campaign.record(f"centavo en importe extremo {base}", salida=result.returncode, filas_actualizadas=2,
                    recibo_filas_actualizadas=int(line_value(reload, "Filas actualizadas")), recarga_filas_reescritas_en_la_base=0)
    assert restore_original(campaign, published).returncode == 0
    assert persisted_mismatches(tenant_tables(snapshot()), accepted_objects(), catalogs(), published.validated.lot) == []


def test_ningun_lote_queda_sin_cerrar(campaign, published):
    events = batches()
    closed = {event["supersedes"] for event in events}
    assert [event["id"] for event in events if event["status"] == "VALIDADO" and event["id"] not in closed] == []
    assert {event["status"] for event in events} == {"RECIBIDO", "VALIDADO", "CONFIRMADO", "PUBLICADO", "FALLIDO"}
    assert all(event["supersedes"] is not None for event in events if event["status"] == "VALIDADO")


def test_ninguna_salida_expone_claves_ni_datos_personales(campaign):
    secrets = (campaign.env["SERVICE_ROLE_KEY"], campaign.env["ANON_KEY"], campaign.jwt)
    assert campaign.outputs, "Sin salidas esta prueba sería vacía"
    for output in campaign.outputs:
        assert not any(secret in output for secret in secrets)
        assert "Persona Sintética" not in output
        assert "Calle Sintética" not in output


def _jsonable(value):
    return json.loads(json.dumps(value, default=str))


def test_la_evidencia_json_declara_dataset_corte_contrato_sha_y_entorno(campaign, published):
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    dirty = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
    hashes = published.validated.hashes
    url = urlsplit(campaign.env["API_URL"])
    evidence = {
        "ticket": "ALIGN-027",
        "generado_utc": datetime.now(UTC).isoformat(),
        "sha": head,
        "arbol_limpio": not dirty.strip(),
        "entorno": {"destino": "local", "host": url.hostname, "puerto": url.port, "municipio": TENANT,
                    "postgres": psql("show server_version").strip()},
        "corte": AS_OF,
        "contrato": {"version": contract["version"], "sha256_canonico": canonical_hash(CONTRACT)},
        "dataset": {"sha256": dataset_hash(hashes), "archivos": hashes,
                    "origen": "sintetico-v1: objetos aceptados del oráculo + un caso en cuarentena"},
        "fixture_completa": {"sha256": dataset_hash(lot_hashes(FIXTURE)), "archivos": lot_hashes(FIXTURE)},
        "requisitos": {"R05": "parcial", "R13": "parcial", "R28": "parcial"},
        "pasos": campaign.steps,
    }
    assert {"fixture completa rechazada", "primera carga", "mismo archivo validado", "recarga",
            "reimportación con una obligación modificada", "rechazo: fixture-completa"} <= {step["paso"] for step in campaign.steps}
    text = json.dumps(evidence, ensure_ascii=False, indent=2)
    assert not any(secret in text for secret in (campaign.env["SERVICE_ROLE_KEY"], campaign.env["ANON_KEY"], campaign.jwt))
    assert "Persona Sintética" not in text
    target = os.environ.get("EQUITAS_V1_EVIDENCE")
    if target:
        Path(target).write_text(text + "\n", encoding="utf-8")
