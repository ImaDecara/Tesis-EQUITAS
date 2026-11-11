"""Noche 7: carga directa de un lote CSV (`POST /imports/load`) contra Auth, PostgREST, RLS y las funciones reales.

Fuera de `testpaths`. Desde `back/`, con el turno de la base y sobre un proyecto local recién creado (por ejemplo,
`scripts/campanas/equitas_campanas.py importacion`), en su propia tanda:

    .venv/bin/python -m pytest tests_real/test_import_load_real.py -q

Usa los lotes sintéticos de `front/public/ejemplos/carga-csv`. Las pruebas corren en orden: cada una parte de lo que dejó
la anterior. En ninguna secuencia, una vez publicada la primera cartera, la fecha vigente (`equitas_current_cutoff`) queda
nula. Se afirma por `resultado` y por código HTTP del servicio FastAPI (Next responde 200 para todo desenlace con
`resultado`; acá no se pasa por Next).
"""

import concurrent.futures
import json
import subprocess
from pathlib import Path

import httpx
import pytest
from conftest import DB_CONTAINER, ROOT, TESTING, parse_accounts, psql

EXAMPLES = ROOT / "front" / "public" / "ejemplos" / "carga-csv"
LOT_1 = EXAMPLES / "1-cartera-2026-09-30"
LOT_2 = EXAMPLES / "2-cartera-2026-10-31-con-errores"
LOT_3 = EXAMPLES / "3-cartera-2026-10-31"
MANIFEST = json.loads((EXAMPLES / "manifiesto.json").read_text(encoding="utf-8"))
TENANT = 953001
BOUNDARY = "limiteSinteticoN7Carga"
MULTIPART = {"Content-Type": f"multipart/form-data; boundary={BOUNDARY}"}


def form(lot: Path, as_of: str, revision: str | None = None) -> bytes:
    body = b""
    parts = [("as_of", as_of.encode(), None)] + ([("revision", revision.encode(), None)] if revision else [])
    parts += [(kind, (lot / f"{kind}.csv").read_bytes(), f"{kind}.csv") for kind in ("cabecera", "detalle")]
    for name, value, filename in parts:
        disposition = f'form-data; name="{name}"' + (f'; filename="{filename}"' if filename else "")
        body += f"--{BOUNDARY}\r\nContent-Disposition: {disposition}\r\n".encode()
        if filename:
            body += b"Content-Type: text/csv\r\n"
        body += b"\r\n" + value + b"\r\n"
    return body + f"--{BOUNDARY}--\r\n".encode()


def admin_sql(sql: str) -> str:
    """`equitas_current_cutoff` no la ejecuta postgres: se consulta como supabase_admin, solo lectura."""
    done = subprocess.run(["docker", "exec", "-i", DB_CONTAINER, "psql", "-X", "-qAt", "-U", "supabase_admin", "-d", "postgres",
                           "-v", "ON_ERROR_STOP=1"], input=sql, capture_output=True, text=True, timeout=20, check=False)
    assert done.returncode == 0, "consulta administrativa sintetica fallida"
    return done.stdout.strip()


def cutoff() -> str:
    """Fecha de la cartera vigente: el as_of del lote que devuelve equitas_current_cutoff ('' si no hay)."""
    return admin_sql(f"select coalesce((select as_of::text from public.import_batch where id = public.equitas_current_cutoff({TENANT})), '')")


def events() -> int:
    return int(psql(f"select count(*) from public.import_batch where tenant = {TENANT}").strip())


def published(as_of: str) -> int:
    return int(psql(f"select count(*) from public.import_batch where tenant = {TENANT} and status = 'PUBLICADO' "
                    f"and as_of = '{as_of}'").strip())


def debtors() -> int:
    return int(psql(f"select count(*) from public.debtor where tenant = {TENANT}").strip())


@pytest.fixture(scope="module")
def load_accounts(accounts):
    psql(script=TESTING / "etl-compat-catalogs.sql")
    found = parse_accounts(psql(script=Path(__file__).parent / "load-fixtures.sql"))
    accounts.update(found)
    return found


@pytest.fixture(scope="module")
def tokens(load_accounts, login):
    return {"admin": login("carga-admin"), "user": login("carga-user")}


def load(http, token: str, lot: Path, as_of: str, revision: str | None = None) -> httpx.Response:
    return http.post("/imports/load", content=form(lot, as_of, revision),
                     headers={"Authorization": f"Bearer {token}", **MULTIPART})


def test_01_user_cannot_load_and_nothing_changes(http, tokens):
    assert cutoff() == "" and events() == 0 and debtors() == 0
    response = load(http, tokens["user"], LOT_1, "2026-09-30")
    assert response.status_code == 403
    assert response.json() == {"detail": "ROLE_FORBIDDEN"}
    assert cutoff() == "" and events() == 0 and debtors() == 0


def test_02_valid_lot_is_published(http, tokens):
    response = load(http, tokens["admin"], LOT_1, "2026-09-30")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["resultado"] == "PUBLICADO"
    assert body["fecha_corte"] == "2026-09-30"
    assert cutoff() == "2026-09-30"
    assert published("2026-09-30") == 1
    expected = MANIFEST["lotes"]["1-cartera-2026-09-30"]
    assert body["resumen"]["objetos_aceptados"] == expected["objetos_publicados"]
    assert debtors() == expected["objetos_publicados"]
    total = psql(f"select sum(d.current_amount) from public.debt d join public.debtor o on o.id = d.debtor where o.tenant = {TENANT}").strip()
    assert float(total) == float(expected["total_registrado_ars"])


def test_03_same_lot_is_already_loaded_without_new_events(http, tokens):
    before = events()
    response = load(http, tokens["admin"], LOT_1, "2026-09-30")
    assert response.status_code == 200, response.text
    assert response.json()["resultado"] == "YA_CARGADO"
    assert events() == before
    assert published("2026-09-30") == 1
    assert cutoff() == "2026-09-30"


def test_04_lot_with_errors_is_rejected_and_the_date_stays(http, tokens):
    debts_before = psql(f"select count(*) from public.debt d join public.debtor o on o.id = d.debtor where o.tenant = {TENANT}").strip()
    response = load(http, tokens["admin"], LOT_2, "2026-10-31")
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["resultado"] == "RECHAZADO"
    assert body["motivos"] or body.get("errores", {}).get("total")
    assert cutoff() == "2026-09-30"
    assert published("2026-10-31") == 0
    assert psql(f"select count(*) from public.debt d join public.debtor o on o.id = d.debtor where o.tenant = {TENANT}").strip() == debts_before


def test_05_double_simultaneous_submission_publishes_one_lot(http, tokens):
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        replies = list(pool.map(lambda _: load(http, tokens["admin"], LOT_3, "2026-10-31"), range(2)))
    outcomes = sorted(reply.json().get("resultado") for reply in replies)
    assert outcomes.count("PUBLICADO") == 1, outcomes
    # La otra: ya estaba cargado (si llegó después) o no completada por carga en curso (429, nada escrito).
    other = next(reply for reply in replies if reply.json().get("resultado") != "PUBLICADO")
    assert (other.status_code, other.json()["resultado"]) in ((200, "YA_CARGADO"), (429, "NO_COMPLETADO")), other.text
    assert published("2026-10-31") == 1
    assert cutoff() == "2026-10-31"


def test_06_closed_attempt_requires_confirmation_then_retry_publishes(http, tokens):
    # Falla sintética al publicar, con un trigger temporal de la prueba (como ALIGN-032): nunca una opción del producto.
    psql("""
        create function public.n7carga_test_profile_failure() returns trigger language plpgsql set search_path = '' as $$
        begin raise exception 'SYNTHETIC_PROFILE_FAILURE'; end $$;
        create trigger n7carga_test_failure before insert or update on public.debtor_profile
        for each row execute function public.n7carga_test_profile_failure();
    """)
    try:
        failed = load(http, tokens["admin"], LOT_3, "2026-11-30")
        assert failed.json()["resultado"] == "NO_COMPLETADO", failed.text
        assert "SYNTHETIC_PROFILE_FAILURE" not in failed.text
        assert cutoff() == "2026-10-31"
        assert published("2026-11-30") == 0
    finally:
        psql("drop trigger n7carga_test_failure on public.debtor_profile; drop function public.n7carga_test_profile_failure();")
    again = load(http, tokens["admin"], LOT_3, "2026-11-30")
    assert again.status_code == 409, again.text
    body = again.json()
    assert body["resultado"] == "REQUIERE_CONFIRMACION"
    assert isinstance(body["revision"], str) and len(body["revision"]) == 64
    assert cutoff() == "2026-10-31"
    retried = load(http, tokens["admin"], LOT_3, "2026-11-30", body["revision"])
    assert retried.status_code == 201, retried.text
    assert retried.json()["resultado"] == "PUBLICADO"
    assert published("2026-11-30") == 1
    assert cutoff() == "2026-11-30"


def test_07_user_still_cannot_load_and_the_date_is_never_null(http, tokens):
    before = events()
    response = load(http, tokens["user"], LOT_3, "2026-12-31")
    assert response.status_code == 403
    assert events() == before
    assert cutoff() == "2026-11-30"
    # Ningún evento de la cadena dejó al municipio sin fecha vigente: la última publicación es la vigente.
    assert admin_sql(f"select public.equitas_current_cutoff({TENANT}) is not null") == "t"
