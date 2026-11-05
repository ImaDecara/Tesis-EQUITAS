"""Archivo real → normalización → doble SQL. La misma persistencia se exige en tests_real.

El doble de 032 recibe el documento que usa la CLI; no hay una ruta alternativa de
carga por mocks de funciones eliminadas. Atomicidad y permisos se ensayan en PostgreSQL.
"""

import copy
from unittest.mock import Mock

import pytest
from oracle_lots import AS_OF, accepted_objects, derive_lot
from test_etl_semantic import database  # noqa: F401

from ETL import load, run_etl


def test_etl_integrates_tsv_extraction_transformation_and_simulated_idempotent_load(tmp_path, database):
    lot = derive_lot(tmp_path / 'lote')
    debts = sum(item['obligaciones'] for item in accepted_objects())
    run_etl.run_etl(str(lot), execute=True, cut_off=AS_OF)
    before = copy.deepcopy(database.tables)
    writes = database.writes, database.updates
    receipt = copy.deepcopy(database.batches[-1]['p_counts'])
    run_etl.run_etl(str(lot), execute=True, cut_off=AS_OF)
    assert len(database.tables['debt']) == debts
    assert receipt['deudas_insertadas'] == debts and receipt['deudas_actualizadas'] == 0
    assert database.tables == before and (database.writes, database.updates) == writes
    assert database.batches[-1]['p_counts'] == receipt
    assert len(database.tables['debtor_profile']) == len(accepted_objects())
    assert [event['p_status'] for event in database.batches] == ['RECIBIDO', 'VALIDADO', 'CONFIRMADO', 'PUBLICADO']


def test_etl_excludes_a_quarantined_object_before_preparing_debts(tmp_path, database):
    target = accepted_objects()[0]
    lot = derive_lot(tmp_path / 'lote', cabecera_cells={(target['clave_agrupacion'], None, 'Destinatario_Id'): ''})
    run_etl.run_etl(str(lot), execute=True, cut_off=AS_OF)
    assert set(target['personas']).isdisjoint(row['external_id'] for row in database.tables['person'])
    assert len(database.tables['debt']) == sum(item['obligaciones'] for item in accepted_objects()[1:])


def test_etl_stops_when_the_simulated_debt_loader_fails(tmp_path, database, monkeypatch):
    monkeypatch.setattr(load, 'load_debts_bulk', Mock(side_effect=RuntimeError('fallo de carga simulado')))
    with pytest.raises(RuntimeError, match='codigo=SUPABASE_OPERATION_FAILED'):
        run_etl.run_etl(str(derive_lot(tmp_path / 'lote')), execute=True, cut_off=AS_OF)
    assert [event['p_status'] for event in database.batches] == ['RECIBIDO', 'VALIDADO', 'FALLIDO']
    assert database.cartera_rows() == 0
