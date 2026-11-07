"""R032C1-01: una espera de importación no confirma después del error del cliente.

API 052, Auth y PostgREST reales. Requiere turno exclusivo y reset local. El lock
controlado simula la contención de publicación sin cambiar los límites del rol.
"""

import concurrent.futures
import json
import os
import subprocess
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

import httpx
from conftest import DB_CONTAINER, psql
from test_imports_api import TENANT_A, USER_IMPORTADOR, post_batch


def _record(name, result):
    destination = os.environ.get("EQUITAS_LOCK_EVIDENCE")
    if destination:
        path = Path(destination)
        report = json.loads(path.read_text()) if path.exists() else {}
        report[name] = result
        path.write_text(json.dumps(report, indent=2) + "\n")


@contextmanager
def _tenant_lock(seconds):
    application = "test_import_lock_" + uuid.uuid4().hex
    process = subprocess.Popen(
        ["docker", "exec", "-i", "-e", f"PGAPPNAME={application}", DB_CONTAINER,
         "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    process.stdin.write(
        ("begin;\nselect pg_advisory_xact_lock(hashtextextended("
         f"'import_batch:{TENANT_A}',0));\nselect pg_sleep({seconds});\ncommit;\n").encode()
    )
    process.stdin.close()
    try:
        deadline = time.monotonic() + 10
        while psql("select count(*) from pg_stat_activity where "
                   f"application_name='{application}' and wait_event='PgSleep'").strip() != "1":
            assert process.poll() is None and time.monotonic() < deadline, "No se pudo establecer el lock propio"
            time.sleep(0.1)
        yield
        assert process.wait(timeout=seconds + 10) == 0, "El retenedor debe liberar su transacción"
    finally:
        if process.poll() is None:
            psql(f"select pg_terminate_backend(pid) from pg_stat_activity where application_name='{application}'")
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


def _settle_requests():
    # Una respuesta HTTP puede llegar antes de que termine el trabajo en PostgREST.
    deadline = time.monotonic() + 10
    while psql("select count(*) from pg_stat_activity where usename='authenticator' "
              "and state='active' and query like '%record_import_batch%'").strip() != "0":
        assert time.monotonic() < deadline, "Quedó una solicitud de escritura activa"
        time.sleep(0.1)


def _rows(keys):
    values = ",".join(f"'{uuid.UUID(key)}'" for key in keys)
    return int(psql(f"select count(*) from public.import_batch where idempotency_key in ({values})").strip())


def test_api_error_por_contencion_no_deja_un_recibido_tardio(http, login):
    token = login("importador")
    # Control positivo: la ruta, sesión, archivos y rol sí pueden registrar un lote.
    control = post_batch(http, token)
    assert control.status_code == 201
    key = str(uuid.uuid4())
    with _tenant_lock(15):
        started = time.monotonic()
        response = post_batch(http, token, headers={"Idempotency-Key": key})
        elapsed = time.monotonic() - started
        immediate = _rows([key])
    _settle_requests()
    after = _rows([key])
    _record("api_052", {"status": response.status_code, "body": response.json(),
                       "seconds": round(elapsed, 3), "rows_on_response": immediate,
                       "rows_after_release": after, "positive_control_status": control.status_code})
    assert response.status_code == 503 and response.json() == {"detail": "BATCH_WRITE_FAILED"}
    assert immediate == after == 0, "El error de la API no puede convertirse en RECIBIDO al liberarse el lock"
    assert elapsed < 10, "La base debe resolver la espera antes del timeout de 10s del cliente de 052"


def test_esperas_de_importacion_liberan_pool_para_una_lectura_ajena(env, accounts, import_jwt):
    keys = [str(uuid.uuid4()) for _ in range(12)]
    barrier = threading.Barrier(13)

    def writer(key):
        payload = {"p_actor_user": USER_IMPORTADOR, "p_tenant": TENANT_A,
                   "p_source": "WEB_UPLOAD", "p_file_hashes": {"cabecera": "a" * 64, "detalle": "b" * 64},
                   "p_as_of": "2026-09-30", "p_rules_version": "1.0.0", "p_status": "RECIBIDO",
                   "p_idempotency_key": key, "p_source_updated_at": None, "p_counts": {}, "p_supersedes": None}
        with httpx.Client(trust_env=False, timeout=40) as client:
            barrier.wait(timeout=10)
            started = time.monotonic()
            response = client.post(f"{env['API_URL']}/rest/v1/rpc/record_import_batch", json=payload,
                                   headers={"apikey": env["PUBLISHABLE_KEY"], "Authorization": f"Bearer {import_jwt}"})
            return {"status": response.status_code, "code": response.json().get("code"),
                    "seconds": round(time.monotonic() - started, 3)}

    with _tenant_lock(25), concurrent.futures.ThreadPoolExecutor(max_workers=12) as executor:
        futures = [executor.submit(writer, key) for key in keys]
        barrier.wait(timeout=10)
        # Ocupamos el pool antes de enviar la lectura; 8s deben liberar conexiones.
        time.sleep(3)
        started = time.monotonic()
        reader = httpx.get(f"{env['API_URL']}/rest/v1/role", params={"select": "id", "limit": "1"},
                           headers={"apikey": env["SERVICE_ROLE_KEY"], "Authorization": f"Bearer {env['SERVICE_ROLE_KEY']}"},
                           trust_env=False, timeout=20)
        elapsed = time.monotonic() - started
        results = [future.result(timeout=45) for future in futures]
    _settle_requests()
    after = _rows(keys)
    _record("pool", {"reader_status": reader.status_code, "reader_seconds": round(elapsed, 3),
                     "waiters": results, "rows_after_release": after})
    assert reader.status_code == 200, "Las esperas del importador no deben agotar el pool de la lectura ajena"
    assert after == 0 and all(result["status"] >= 400 for result in results)
    assert elapsed < 10, "La lectura debe obtener conexión antes del timeout de adquisición del pool"
