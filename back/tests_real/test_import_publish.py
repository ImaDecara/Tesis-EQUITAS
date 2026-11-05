"""ALIGN-032: publicación por CLI/Data API, exclusivamente contra el stack local.

Esta tanda tiene las mismas semillas excluyentes que 027 y requiere reset propio.
El fallo se inyecta con un trigger temporal de la prueba, nunca mediante una
opción o un bypass de la función de producción.
"""

import copy
import json
import os
import socket
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import pytest

from conftest import BACK, DB_CONTAINER, ROOT, TESTING, parse_accounts, psql
from test_etl_v1_load import (
    AS_OF,
    batches,
    campaign,  # noqa: F401 -- fixtures originales, sin cambiar sus semillas
    changes,
    derive_lot,
    drop_lines,
    object_by_case,
    snapshot,
    synthetic_profile,
    validated,  # noqa: F401
)

from ETL import publication, run_etl
from ETL.config import ETLError
from ETL.transform import canonical_json_hash
from reissue_lot import reissue_lot


@pytest.fixture
def importer(campaign, monkeypatch):
    for key, value in campaign.environment().items():
        monkeypatch.setenv(key, value)
    return campaign


def prepared(importer, name, *, cutoff=AS_OF, mapping=None, **changes):
    key = object_by_case("base-valido")["clave_agrupacion"]
    headers = {(key, None, "Bien_Descripcion"): f"Sintetico ALIGN032 {name}", **changes.pop("cabecera_cells", {})}
    lot = derive_lot(importer.work / name, ("cuenta-ceros-izquierda",), cabecera_cells=headers, **changes)
    selected = run_etl._load_mapping(lot, None) if mapping is None else mapping
    selected["fecha_corte"] = cutoff
    return run_etl._prepare(lot, selected, cutoff)


def stage(batch, **kwargs):
    return publication.stage_batch(batch, tenant=1, absent_policy="conservar", **kwargs)


def publish(batch, review):
    return publication.publish_batch(batch, review, tenant=1, absent_policy="conservar")


def publications():
    return json.loads(psql("select coalesce(json_agg(to_jsonb(t) || jsonb_build_object('_xmin',t.xmin::text) "
                           "order by batch_id),'[]') from public.import_publication t"))


def state(review):
    return next(row for row in publications() if row["batch_id"] == review["batch_id"])


def staging_count(review):
    return int(psql(f"select count(*) from public.import_row_staging where batch_id={review['batch_id']}"))


def admin_sql(sql):
    result = subprocess.run(["docker", "exec", "-i", DB_CONTAINER, "psql", "-X", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-At"],
                            input=sql, text=True, capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr
    return result.stdout


def rpc(importer, name, body, token=None):
    return httpx.post(importer.env["API_URL"] + "/rest/v1/rpc/" + name, json=body,
                      headers={"apikey": importer.env["ANON_KEY"], "Authorization": "Bearer " + (token or importer.jwt)},
                      timeout=120, trust_env=False)


def reference(importer, review, **overrides):
    return {"p_batch_id": review["batch_id"], "p_idempotency_key": review["idempotency_key"],
            "p_revision": review["revision"], "p_tenant": 1, "p_actor_user": int(importer.actor), **overrides}


def test_fallo_entre_deudas_y_perfiles_no_es_visible_y_revierte_toda_la_carga(campaign, validated):
    before = snapshot()
    psql("""
        create function public.align032_test_profile_failure() returns trigger
        language plpgsql set search_path = '' as $$
        begin
          perform pg_sleep(5);
          raise exception 'SYNTHETIC_PROFILE_FAILURE';
        end $$;
        create trigger align032_test_failure before insert or update on public.debtor_profile
        for each row execute function public.align032_test_profile_failure();
    """)
    command = [sys.executable, "-m", "ETL.run_etl", "--folder", str(validated.lot),
               "--execute", "--cut-off", AS_OF]
    process = subprocess.Popen(command, cwd=BACK, env={"PATH": os.environ["PATH"], **campaign.environment()},
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        deadline = time.monotonic() + 45
        observed = False
        while time.monotonic() < deadline and process.poll() is None:
            observed = psql("select exists(select 1 from pg_stat_activity where wait_event = 'PgSleep' "
                            "and (query like '%recompute_debtor_profiles%' or query like '%publish_import_batch%'))").strip() == "t"
            if observed:
                break
            time.sleep(0.05)
        # Consulta independiente mientras la llamada de publicación está detenida.
        intermediate = changes(before, snapshot())
        stdout, stderr = process.communicate(timeout=90)
        assert observed, f"No se alcanzó la barrera entre deudas y perfiles: {stderr}"
        assert process.returncode == 1
        assert batches()[-1]["status"] == "FALLIDO"
        events = batches()
        assert [row['status'] for row in events] == ['RECIBIDO', 'VALIDADO', 'FALLIDO']
        assert int(events[-1]['_xmin']) > int(events[-2]['_xmin'])
        assert staging_count({'batch_id': events[0]['id']}) == 0
        assert "SYNTHETIC_PROFILE_FAILURE" not in stdout + stderr
        assert intermediate == {}, "La segunda conexión vio escrituras antes del commit"
        assert changes(before, snapshot()) == {}, "El fallo dejó escrituras de cartera"
    finally:
        if process.poll() is None:
            process.terminate()
            process.communicate(timeout=15)
        psql("drop trigger align032_test_failure on public.debtor_profile; "
             "drop function public.align032_test_profile_failure();")


def test_staging_valida_sin_tocar_cartera_y_doble_confirmacion_devuelve_el_recibo(importer):
    batch = prepared(importer, "doble")
    before = snapshot()
    review = stage(batch)
    assert review["status"] == "VALIDADO"
    assert staging_count(review) > 0
    assert changes(before, snapshot()) == {}
    assert stage(batch) == review
    first = publish(batch, review)
    after = snapshot()
    stored = state(review)
    assert first == publish(batch, review) == stage(batch)
    assert state(review) == stored, "Repetir no reescribe siquiera el recibo"
    assert changes(after, snapshot()) == {}
    assert staging_count(review) == 0
    assert first["counts"]["filas_insertadas"] > 0
    events = [row for row in batches() if row["id"] >= review["batch_id"]]
    assert [row["status"] for row in events] == ["RECIBIDO", "VALIDADO", "CONFIRMADO", "PUBLICADO"]
    # Cartera, CONFIRMADO y PUBLICADO comparten la transacción; VALIDADO es anterior.
    assert events[-2]["_xmin"] == events[-1]["_xmin"]
    changed = [row for table, rows in after.items() for identifier, row in rows.items()
               if before[table].get(identifier) != row]
    assert {row["_xmin"] for row in changed} == {events[-1]["_xmin"]}
    assert int(events[1]["_xmin"]) < int(events[-1]["_xmin"])


def test_idempotencia_es_canonica_y_esta_restringida_en_la_base(importer):
    batch = prepared(importer, "canonico")
    review = stage(batch)
    mapping = copy.deepcopy(batch.mapping)
    mapping["formato"]["separador"] = "\t"
    mapping["formato"].pop("tipo", None)
    mapping["formato"].pop("fin_de_linea", None)
    mapping["columnas"] = {"cabecera": {"Cuenta": "Cuenta"}}
    mapping["transformaciones"] = {"detalle": {"DEUD_id": []}}
    # Mismos archivos y mapping efectivo, aunque cambie la serialización y los defaults explícitos.
    lot = importer.work / "canonico"
    equivalent = run_etl._prepare(lot, dict(reversed(list(mapping.items()))), AS_OF)
    assert batch.file_hashes["mapeo"] != equivalent.file_hashes["mapeo"]
    assert stage(equivalent) == review
    assert review["idempotency_key"] == canonical_json_hash(publication.publication_identity(batch, 1, "conservar"))
    assert psql("select exists(select 1 from pg_constraint where conrelid='public.import_publication'::regclass "
                "and contype='u' and pg_get_constraintdef(oid)='UNIQUE (tenant, idempotency_key)')").strip() == "t"
    conflict = subprocess.run(["docker", "exec", "-i", DB_CONTAINER, "psql", "-X", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
        input=f"begin; insert into public.import_publication select batch_id+100000,tenant,head_id,actor,idempotency_key,revision,generation,payload_hash,status,document,versions,result,created_at,expires_at from public.import_publication where batch_id={review['batch_id']}; rollback;",
        capture_output=True, text=True, timeout=15)
    assert conflict.returncode != 0 and "duplicate key" in conflict.stderr


@pytest.mark.parametrize('variant', ['tenant-text', 'cutoff-spelling', 'unused-nonce'])
def test_identidad_no_acepta_coerciones_o_parametros_sin_efecto(importer, variant):
    batch = prepared(importer, 'identity-' + variant)
    review = stage(batch)
    document = state(review)['document']
    if variant == 'tenant-text':
        document['identity']['tenant'] = '1'
    elif variant == 'cutoff-spelling':
        document['identity']['parameters']['as_of'] = '2026-9-30'
    else:
        document['identity']['nonce'] = 'otra-clave-para-la-misma-entrada'
    before = batches()
    response = rpc(importer, 'stage_import_batch', {'p_actor_user': int(importer.actor), 'p_tenant': 1,
                   'p_document': document, 'p_rows': publication.normalized_rows(batch, 1), 'p_expected_revision': None})
    assert response.status_code == 400 and response.json()['message'] == 'IMPORT_INPUT_INVALID'
    assert batches() == before


def test_otro_mapeo_cambia_clave_y_mutarlo_despues_de_validar_invalida(importer):
    batch = prepared(importer, "mapping")
    review = stage(batch)
    before = snapshot()
    batch.mapping["catalogos"]["NOTD_ESTA_id"]["40"] = "UNKNOWN"
    with pytest.raises(ETLError, match="REQUIERE_NUEVO_PREVIEW"):
        publish(batch, review)
    assert state(review)["status"] == "REQUIERE_NUEVO_PREVIEW"
    assert changes(before, snapshot()) == {}
    changed = run_etl._prepare(importer.work / "mapping", batch.mapping, AS_OF)
    assert stage(changed)["idempotency_key"] != review["idempotency_key"]


def test_staging_no_admite_reemplazar_el_snapshot_con_la_misma_identidad(importer):
    batch = prepared(importer, "frozen")
    review = stage(batch)
    original = state(review)
    batch.objects[0].headers[0].values["Bien_Descripcion"] = "Cambio posterior a la validacion"
    with pytest.raises(ETLError, match="IMPORT_REVISION_CONFLICT"):
        stage(batch)
    assert state(review) == original


def test_checksum_del_staging_tambien_se_compara_al_confirmar(importer):
    batch = prepared(importer, "checksum")
    review = stage(batch)
    before = snapshot()
    admin_sql(f"update public.import_row_staging set payload=jsonb_set(payload,'{{debtor,description}}','\"Cambio SQL sintetico\"') "
         f"where batch_id={review['batch_id']} and kind='object'")
    with pytest.raises(ETLError, match="REQUIERE_NUEVO_PREVIEW"):
        publish(batch, review)
    assert changes(before, snapshot()) == {}


def test_mismo_lote_confirmado_concurrentemente_publica_una_sola_vez(importer):
    batch = prepared(importer, "concurrente-mismo")
    review = stage(batch)
    barrier = threading.Barrier(2)

    def confirm():
        barrier.wait(timeout=10)
        response = rpc(importer, "publish_import_batch", reference(importer, review))
        assert response.status_code == 200
        return response.json()

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(confirm) for _ in range(2)]
        first, second = [future.result(timeout=120) for future in futures]
    assert first == second and first["status"] == "PUBLICADO"
    assert sum(row["status"] == "PUBLICADO" and row["id"] >= review["batch_id"] for row in batches()) == 1
    assert staging_count(review) == 0


def test_lotes_distintos_con_version_previa_se_serializan_y_el_segundo_no_publica(importer):
    left, right = prepared(importer, "concurrente-a"), prepared(importer, "concurrente-b")
    reviews = [stage(left), stage(right)]
    barrier = threading.Barrier(2)

    def confirm(review):
        barrier.wait(timeout=10)
        response = rpc(importer, "publish_import_batch", reference(importer, review))
        assert response.status_code == 200
        return response.json()

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(confirm, review) for review in reviews]
        results = [future.result(timeout=120) for future in futures]
    assert sorted(result["status"] for result in results) == ["PUBLICADO", "REQUIERE_NUEVO_PREVIEW"]
    loser = next(review for review, result in zip(reviews, results, strict=True) if result["status"] != "PUBLICADO")
    assert state(loser)["status"] == "REQUIERE_NUEVO_PREVIEW"
    frozen = snapshot()
    response = rpc(importer, "publish_import_batch", reference(importer, loser))
    assert response.json()["status"] == "REQUIERE_NUEVO_PREVIEW"
    assert changes(frozen, snapshot()) == {}


def test_publicacion_sin_cambios_de_valores_tambien_invalida_otro_preview(importer):
    batch = prepared(importer, 'version-sin-cambios')
    publish(batch, stage(batch))
    lots = [reissue_lot(importer.work / 'version-sin-cambios', importer.work / f'otra-entrega-{number}') for number in (1, 2)]
    batches_to_publish = [run_etl._prepare(lot, run_etl._load_mapping(lot, None), AS_OF) for lot in lots]
    reviews = [stage(item) for item in batches_to_publish]
    assert reviews[0]['idempotency_key'] != reviews[1]['idempotency_key']
    before = snapshot()
    result = publish(batches_to_publish[0], reviews[0])
    assert result['counts']['filas_insertadas'] == result['counts']['filas_actualizadas'] == 0
    assert changes(before, snapshot()) == {}
    with pytest.raises(ETLError, match='REQUIERE_NUEVO_PREVIEW'):
        publish(batches_to_publish[1], reviews[1])
    assert changes(before, snapshot()) == {}


@pytest.mark.parametrize("table", ["debt", "debtor", "debtor_person", "person", "address", "debtor_contact", "debtor_profile", "debtor_profile_detail"])
def test_todos_los_objetos_y_dependencias_afectadas_tienen_version(importer, table):
    batch = prepared(importer, f"version-{table}")
    review = stage(batch)
    before_versions = state(review)["versions"]
    expressions = {"debt": "current_amount=current_amount+0.01", "debtor": "description=coalesce(description,'')||' cambio'",
                   "debtor_person": "active=not active", "person": "full_name=coalesce(full_name,'')||' cambio'",
                   "address": "street=coalesce(street,'')||' cambio'", "debtor_contact": "active=not active",
                   "debtor_profile": "previous_contact_count=17", "debtor_profile_detail": "reason='Cambio sintetico'"}
    # Una fila de otro objeto, no solo el primero del lote.
    psql(f"update public.{table} set {expressions[table]} where id=(select max(id) from public.{table})")
    frozen = snapshot()
    assert before_versions == state(review)["versions"], "La validación no debe reescribir su snapshot"
    with pytest.raises(ETLError, match="REQUIERE_NUEVO_PREVIEW"):
        publish(batch, review)
    assert changes(frozen, snapshot()) == {}


def test_revalidacion_explicita_renueva_version_sin_cambiar_identidad(importer):
    batch = prepared(importer, "revalidar")
    review = stage(batch)
    psql("update public.debtor set description='Cambio administrativo sintetico' where id=(select min(id) from public.debtor)")
    with pytest.raises(ETLError, match="REQUIERE_NUEVO_PREVIEW"):
        publish(batch, review)
    with pytest.raises(ETLError, match="IMPORT_REVALIDATION_REQUIRED"):
        stage(batch)
    refreshed = stage(batch, expected_revision=review["revision"])
    assert refreshed["batch_id"] == review["batch_id"]
    assert refreshed["idempotency_key"] == review["idempotency_key"]
    assert refreshed["revision"] != review["revision"]
    assert publish(batch, refreshed)["status"] == "PUBLICADO"


def test_cli_revalida_explicitamente_un_fallo_con_la_misma_identidad(importer):
    batch = prepared(importer, 'cli-recovery')
    review = stage(batch)
    publication.settle_batch(review, tenant=1)
    lot = importer.work / 'cli-recovery'
    failed = importer.etl(lot, '--ausentes', 'conservar')
    assert failed.returncode == 1 and 'IMPORT_REVALIDATION_REQUIRED' in failed.stderr
    recovered = importer.etl(lot, '--ausentes', 'conservar', '--revalidate', review['revision'])
    assert recovered.returncode == 0, recovered.stderr
    assert state(review)['status'] == 'PUBLICADO'
    assert state(review)['revision'] != review['revision']
    assert state(review)['idempotency_key'] == review['idempotency_key']


@pytest.mark.parametrize("terminal", ["FALLIDO", "DESCARTADO"])
def test_terminales_purgan_staging_y_no_pueden_fallar_un_lote_ya_publicado(importer, terminal):
    batch = prepared(importer, f"terminal-{terminal}")
    review = stage(batch)
    frozen = snapshot()
    answer = publication.settle_batch(review, tenant=1, status=terminal)
    assert answer["status"] == terminal and staging_count(review) == 0
    assert state(review)["document"] == {}
    assert changes(frozen, snapshot()) == {}
    refreshed = stage(batch, expected_revision=review["revision"])
    published = publish(batch, refreshed)
    assert publication.settle_batch(refreshed, tenant=1, status=terminal) == published
    assert state(refreshed)["status"] == "PUBLICADO"


def test_ttl_24_horas_con_reloj_controlado_y_evento_descartado(importer):
    batch = prepared(importer, "ttl")
    review = stage(batch)
    expires = state(review)["expires_at"]
    before = snapshot()

    def purge(offset):
        result = subprocess.run(["docker", "exec", "-i", DB_CONTAINER, "psql", "-X", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-At"],
                                input=f"set role equitas_import_definer; select equitas_import_private.purge('{expires}'::timestamptz + interval '{offset}');",
                                text=True, capture_output=True, timeout=30)
        assert result.returncode == 0
        return int(result.stdout.strip())

    purge("-1 microsecond")
    assert staging_count(review) > 0
    purge("0 seconds")
    assert staging_count(review) == 0 and state(review)["status"] == "DESCARTADO"
    assert next(row for row in batches() if row["id"] == state(review)["head_id"])["status"] == "DESCARTADO"
    assert changes(before, snapshot()) == {}


def test_staging_y_fallo_atomico_conservan_el_corte_vigente(importer):
    batch = prepared(importer, 'corte-publicado')
    result = publish(batch, stage(batch))

    def current():
        return int(admin_sql('set role equitas_write_definer; select public.equitas_current_cutoff(1);').strip())

    assert current() == result['published_event_id']
    review = stage(prepared(importer, 'corte-validado'))
    assert current() == result['published_event_id']
    publication.settle_batch(review, tenant=1)
    assert current() == result['published_event_id']


def test_cron_purga_abandonados_sin_nueva_importacion(importer):
    review = stage(prepared(importer, 'ttl-cron'))
    # El reloj de la purga ya se ensayó arriba. Aquí se envejece solo esta fixture
    # para comprobar la llamada periódica real, sin esperar 24 horas.
    admin_sql(f"update public.import_publication set expires_at=clock_timestamp()-interval '1 second' where batch_id={review['batch_id']}")
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline and staging_count(review):
        time.sleep(1)
    assert staging_count(review) == 0
    assert state(review)['status'] == 'DESCARTADO'
    assert psql("select exists(select 1 from cron.job j join cron.job_run_details r using(jobid) "
                "where j.jobname='equitas-import-staging-ttl' and r.status='succeeded')").strip() == 't'


@pytest.fixture(scope="module")
def auth_tokens(campaign):
    accounts = parse_accounts(psql(script=TESTING / "case-review-auth-fixtures.sql"))
    psql("""insert into public.role(id,name) select coalesce(max(id),0)+1,'importador' from public.role;
         insert into public.role(id,name) select coalesce(max(id),0)+1,'operador' from public.role;
         insert into public.tenant(id,name) values(8032,'Municipio aislado ALIGN032');
         insert into public."user"(auth_user,full_name,email)
           select id,'Persona de prueba ALIGN032',email from auth.users where email like 'tp-a018-%@example.test';
         insert into public.tenant_user(tenant,"user",role)
           select case when u.email like '%otro-operador@%' then 8032 else 1 end,u.id,r.id
           from public."user" u join public.role r on r.name=case when u.email like '%operador@%' and u.email not like '%otro-operador@%' then 'operador' else 'importador' end
           where u.email in ('tp-a018-importador@example.test','tp-a018-operador@example.test','tp-a018-otro-operador@example.test');""")
    tokens = {}
    for label in ("importador", "operador", "otro-operador"):
        email, password = accounts[label]
        response = httpx.post(campaign.env["API_URL"] + "/auth/v1/token?grant_type=password", headers={"apikey": campaign.env["ANON_KEY"]},
                              json={"email": email, "password": password}, timeout=20, trust_env=False)
        assert response.status_code == 200
        tokens[label] = response.json()["access_token"]
    return tokens


@pytest.mark.parametrize("role", ["anon", "authenticated", "authenticated-other-tenant", "service_role", "review_server", "definer"])
def test_data_api_denegaciones_reales_de_publicacion_y_staging(importer, auth_tokens, role):
    sys.path.insert(0, str(ROOT / "database/testing"))
    from case_review_local import server_claims, sign_jwt

    tokens = {"anon": importer.env["ANON_KEY"], "authenticated": auth_tokens["importador"],
              "authenticated-other-tenant": auth_tokens["otro-operador"], "service_role": importer.env["SERVICE_ROLE_KEY"],
              "review_server": sign_jwt(importer.env["JWT_SECRET"], server_claims("equitas_review_server", 1)),
              "definer": sign_jwt(importer.env["JWT_SECRET"], server_claims("equitas_import_definer", 1))}
    batch = prepared(importer, f"security-{role}")
    review = stage(batch)
    frozen = snapshot()
    token = tokens[role]
    denied = rpc(importer, "publish_import_batch", reference(importer, review), token)
    assert denied.status_code in (401, 403) and denied.json()["code"] == "42501"
    inserted = httpx.post(importer.env["API_URL"] + "/rest/v1/import_row_staging", headers={"apikey": importer.env["ANON_KEY"], "Authorization": "Bearer " + token},
                          json={"batch_id": review["batch_id"], "row_number": 99999, "kind": "object", "payload": {}}, timeout=15, trust_env=False)
    assert inserted.status_code in (401, 403) and inserted.json()["code"] == "42501"
    hidden = httpx.get(importer.env['API_URL'] + '/rest/v1/import_publication',
                       headers={'apikey': importer.env['ANON_KEY'], 'Authorization': 'Bearer ' + token}, timeout=15, trust_env=False)
    assert hidden.status_code in (401, 403) and hidden.json()['code'] == '42501'
    assert changes(frozen, snapshot()) == {}
    assert state(review)["status"] == "VALIDADO"


def test_servidor_de_importacion_verifica_actor_tenant_y_snapshot(importer, auth_tokens):
    batch = prepared(importer, "tenant")
    review = stage(batch)
    operator = int(psql("select id from public.\"user\" where email='tp-a018-operador@example.test'"))
    other = int(psql("select id from public.\"user\" where email='tp-a018-otro-operador@example.test'"))
    for overrides, code in [({"p_actor_user": operator}, "ROLE_NOT_ALLOWED"),
                            ({"p_tenant": 8032}, "ACTOR_NOT_ACTIVE_MEMBER"),
                            ({"p_tenant": 8032, "p_actor_user": other}, "BATCH_NOT_FOUND")]:
        response = rpc(importer, "publish_import_batch", reference(importer, review, **overrides))
        assert response.status_code == 400 and response.json()["message"] == code
    direct = httpx.get(importer.env["API_URL"] + "/rest/v1/import_batch", params={"id": f"eq.{review['batch_id']}"},
                       headers={"apikey": importer.env["ANON_KEY"], "Authorization": "Bearer " + auth_tokens["otro-operador"]}, timeout=15, trust_env=False)
    assert direct.status_code == 200 and direct.json() == []
    inserted = httpx.post(importer.env["API_URL"] + "/rest/v1/import_row_staging", headers={"apikey": importer.env["ANON_KEY"], "Authorization": "Bearer " + importer.jwt},
                          json={"batch_id": review["batch_id"], "row_number": 99999, "kind": "object", "payload": {}}, timeout=15, trust_env=False)
    assert inserted.status_code == 403 and inserted.json()["code"] == "42501"


class LostCommitProxy:
    """Proxy HTTP local: recibe el 200 del COMMIT y corta el socket sin entregar la respuesta."""

    def __init__(self, upstream):
        self.dropped = 0
        self.publish_calls = 0
        proxy = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def forward(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                headers = {key: value for key, value in self.headers.items() if key.lower() not in {"host", "content-length", "connection"}}
                response = httpx.request(self.command, upstream + self.path, headers=headers, content=body, timeout=120, trust_env=False)
                if self.path.endswith("/rpc/publish_import_batch"):
                    proxy.publish_calls += 1
                    if response.status_code == 200 and response.json()["status"] == "PUBLICADO" and not proxy.dropped:
                        proxy.dropped += 1
                        self.connection.shutdown(socket.SHUT_RDWR)
                        self.connection.close()
                        return
                self.send_response(response.status_code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(response.content)))
                self.end_headers()
                self.wfile.write(response.content)

            do_POST = forward
            do_GET = forward

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_args):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=10)
        assert not self.thread.is_alive()


def test_cli_recupera_respuesta_perdida_despues_del_commit_con_reclasificaciones(importer, validated):
    key = object_by_case("base-valido")["clave_agrupacion"]
    full = prepared(importer, "o5-inicial", detalle_cells={(key, "700001", "NOTD_vencimiento"): "01/10/2026"})
    publish(full, stage(full))
    lot = derive_lot(importer.work / "o5-delta", ("cuenta-ceros-izquierda",), cabecera_cells={
        (key, None, "Deuda_Actualizada"): "32.462,07", (key, None, "Deuda_Capital"): "27.196,60", (key, None, "Periodos_Deuda"): "2"})
    drop_lines(lot / "detalle.tsv", (key, "700001"))
    other_keys = [(item["clave_agrupacion"],) for item in validated.selected if item["caso"] != "base-valido"]
    drop_lines(lot / "cabecera.tsv", *other_keys)
    drop_lines(lot / "detalle.tsv", *other_keys)
    mapping = synthetic_profile(lot, fecha_corte="2026-10-02")
    before = snapshot()
    with LostCommitProxy(importer.env["API_URL"]) as proxy:
        environment = {**importer.environment(), "SUPABASE_URL": f"http://127.0.0.1:{proxy.server.server_port}"}
        result = importer._run(environment, "ETL.run_etl", "--folder", str(lot), "--execute", "--cut-off", "2026-10-02", "--mapping", str(mapping), "--ausentes", "conservar")
        assert result.returncode == 0, result.stderr
        assert proxy.dropped == 1 and proxy.publish_calls == 2
    receipt = publications()[-1]["result"]
    assert receipt["status"] == "PUBLICADO"
    assert receipt["counts"]["escrituras"]["debt"]["actualizadas"] == 1
    assert receipt["counts"]["deudas_actualizadas"] == 0
    assert receipt["counts"]["importe_aceptado_centavos"] == 3246207
    after = snapshot()
    assert len(changes(before, after)["debt"]["actualizadas"]) == 1
    second = importer.etl(lot, "--mapping", str(mapping), "--ausentes", "conservar", cut_off="2026-10-02")
    assert second.returncode == 0
    assert publications()[-1]["result"] == receipt
    assert changes(after, snapshot()) == {}
    assert "FALLIDO" not in [row["status"] for row in batches() if row["id"] >= receipt["batch_id"]]
    # O4: los demás perfiles conservan su propio corte; no se les atribuye el recálculo.
    cuts = {item["as_of"] for item in receipt["object_cutoffs"]}
    assert AS_OF in cuts and "2026-10-02" in cuts
