"""Contrato de identidad y transporte; las garantías SQL se prueban en tests_real."""

import copy

import httpx
import pytest
from oracle_lots import AS_OF, derive_lot
from test_etl_semantic import database  # noqa: F401 -- mismo aislamiento de red y catálogos

from ETL import publication, run_etl
from ETL.config import ETLError
from ETL.transform import canonical_json_hash


@pytest.fixture
def prepared(tmp_path):
    folder = derive_lot(tmp_path / 'lote')
    return run_etl._prepare(folder, run_etl._load_mapping(folder, None), AS_OF)


def test_identidad_canonica_no_depende_de_etiquetas_orden_o_defaults(prepared):
    original = publication.publication_identity(prepared, 1, 'conservar')
    mapping = prepared.mapping
    mapping['version'] = '99.99.99'
    mapping['solo_fixture'] = False
    mapping['formato']['separador'] = '\t'
    mapping['formato'].pop('tipo', None)
    mapping['formato'].pop('fin_de_linea', None)
    mapping['columnas'] = {'cabecera': {'Cuenta': 'Cuenta'}}
    mapping['transformaciones'] = {'cabecera': {'Cuenta': []}}
    assert publication.publication_identity(prepared, 1, 'conservar') == original


@pytest.mark.parametrize('change', ['tenant', 'policy', 'mapping', 'file', 'contract'])
def test_cada_insumo_efectivo_cambia_la_clave(prepared, change):
    original = publication.publication_identity(prepared, 1, 'conservar')
    tenant, policy = 1, 'conservar'
    if change == 'tenant':
        tenant = 2
    elif change == 'policy':
        policy = 'dar-de-baja'
    elif change == 'mapping':
        prepared.mapping['catalogos']['NOTD_ESTA_id']['40'] = 'UNKNOWN'
    elif change == 'file':
        prepared.file_hashes['detalle'] = 'a' * 64
    else:
        prepared.file_hashes['contrato'] = 'b' * 64
    assert canonical_json_hash(publication.publication_identity(prepared, tenant, policy)) != canonical_json_hash(original)


def test_politica_invalida_se_rechaza_sin_rpc(prepared):
    with pytest.raises(ETLError, match='ABSENT_POLICY_INVALID'):
        publication.publication_identity(prepared, 1, 'inventada')


def test_staging_rechaza_lote_bloqueado_y_mapping_mutado_antes_de_enviar(prepared, monkeypatch):
    def network(*_args, **_kwargs):
        pytest.fail('No debe enviar datos')
    monkeypatch.setattr(publication, '_rpc', network)
    prepared.mapping['moneda'] = 'CAMBIO'
    with pytest.raises(ETLError, match='IMPORT_REVISION_CONFLICT'):
        publication.stage_batch(prepared, tenant=1)
    prepared.report['publicacion_permitida'] = False
    with pytest.raises(ETLError, match='BATCH_BLOCKED'):
        publication.stage_batch(prepared, tenant=1)


@pytest.mark.parametrize('body', ['ilegible', [], None, {'batch_id': '1', 'status': 'PUBLICADO'}, {'batch_id': 1}, {'status': 'PUBLICADO'}])
def test_respuesta_rpc_200_invalida_no_inventa_exito(database, monkeypatch, body):
    def reply(url, **_kwargs):
        if body == 'ilegible':
            return httpx.Response(200, text=body)
        return httpx.Response(200, json=body)
    monkeypatch.setattr(httpx, 'post', reply)
    with pytest.raises(ETLError, match='PUBLISH_OUTCOME_UNKNOWN'):
        publication._rpc('publish_import_batch', {})


@pytest.mark.parametrize('body', [[], None, {'message': 'CENTINELA_PERSONAL'}, 'ilegible'])
def test_error_rpc_solo_expone_codigo_controlado(database, monkeypatch, body):
    monkeypatch.setattr(httpx, 'post', lambda *_args, **_kwargs: httpx.Response(400, text=body) if isinstance(body, str) else httpx.Response(400, json=body))
    with pytest.raises(ETLError, match='IMPORT_PUBLICATION_FAILED') as error:
        publication._rpc('publish_import_batch', {})
    assert 'CENTINELA_PERSONAL' not in str(error.value)


def test_stage_preserva_codigo_reintentable_sin_atribuirlo_a_los_archivos(database, monkeypatch):
    monkeypatch.setattr(httpx, 'post', lambda *_args, **_kwargs: httpx.Response(400, json={'message': 'IMPORT_RETRY_REQUIRED'}))
    with pytest.raises(ETLError, match='IMPORT_RETRY_REQUIRED'):
        publication._rpc('stage_import_batch', {})


@pytest.mark.parametrize('status', ['REQUIERE_NUEVO_PREVIEW', 'FALLIDO', 'DESCARTADO', 'RECIBIDO'])
def test_confirmacion_no_publicada_no_se_informa_como_exito(database, prepared, monkeypatch, status):
    review = publication.stage_batch(prepared, tenant=1)
    monkeypatch.setattr(publication, '_rpc', lambda *_args, **_kwargs: {**review, 'status': status})
    with pytest.raises(ETLError, match=status if status != 'RECIBIDO' else 'BATCH_NOT_VALIDATED'):
        publication.publish_batch(prepared, review, tenant=1)


def test_confirmacion_usa_identidad_recalculada_sin_reenviar_filas(database, prepared, monkeypatch):
    review = publication.stage_batch(prepared, tenant=1)
    requests = []
    prepared.mapping['catalogos']['NOTD_ESTA_id']['40'] = 'UNKNOWN'
    monkeypatch.setattr(publication, '_rpc', lambda name, body: requests.append((name, body)) or {**review, 'status': 'PUBLICADO'})
    publication.publish_batch(prepared, review, tenant=1)
    assert requests[0][0] == 'publish_import_batch'
    assert requests[0][1]['p_revision'] == review['revision']
    assert requests[0][1]['p_idempotency_key'] != review['idempotency_key']
    assert set(requests[0][1]) == {'p_batch_id', 'p_idempotency_key', 'p_revision', 'p_tenant', 'p_actor_user'}


def test_recibo_sin_conteos_no_se_informa_como_exito(database, prepared, monkeypatch):
    review = publication.stage_batch(prepared, tenant=1)
    result = {**review, 'status': 'PUBLICADO', 'counts': None}
    monkeypatch.setattr(publication, '_rpc', lambda *_args: result)
    with pytest.raises(ETLError, match='PUBLISH_OUTCOME_UNKNOWN'):
        publication.publish_batch(prepared, review, tenant=1)


@pytest.mark.parametrize('revision,execute', [('no-hash', True), ('a' * 64, False)])
def test_cli_revalidacion_exige_revision_y_execute(tmp_path, revision, execute):
    with pytest.raises(ETLError, match='IMPORT_REVISION_CONFLICT'):
        run_etl.run_etl(str(tmp_path / 'inexistente'), execute=execute, expected_revision=revision)


def test_staging_transporta_revision_explicita_y_normaliza_sin_ids_de_catalogo(database, prepared, monkeypatch):
    captured = []
    monkeypatch.setattr(publication, '_rpc', lambda name, body: captured.append(copy.deepcopy(body)) or {'batch_id': 1, 'status': 'VALIDADO'})
    publication.stage_batch(prepared, tenant=8, expected_revision='f' * 64)
    body = captured[0]
    assert body['p_expected_revision'] == 'f' * 64 and body['p_tenant'] == 8
    objects = [row['payload'] for row in body['p_rows'] if row['kind'] == 'object']
    assert all(obj['debtor']['tenant'] == 8 and isinstance(obj['debtor']['type'], str) for obj in objects)
    assert all('debtor' not in debt and isinstance(debt['status'], str) for obj in objects for debt in obj['debts'])
