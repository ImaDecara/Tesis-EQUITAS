"""Carga simulada de un lote validado. ALIGN-026: las filas salen de un lote derivado del oráculo, no de una
fuente de dos objetos que el contrato pondría en cuarentena. La persistencia real es de ALIGN-027."""

from pathlib import Path
from typing import Any
from unittest.mock import Mock

import pytest
from oracle_lots import AS_OF, accepted_objects, derive_lot

from ETL import run_etl
from ETL.transform import CATALOG_KEY_COLUMNS


def install_fake_loaders(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    monkeypatch.setenv('EQUITAS_TARGET_ENV', 'local')
    monkeypatch.setenv('SUPABASE_URL', 'http://127.0.0.1:54321')
    monkeypatch.setenv('SUPABASE_SERVICE_ROLE_KEY', 'CLAVE_FICTICIA_ALIGN025')
    monkeypatch.setenv('SUPABASE_ANON_KEY', 'CLAVE_PUBLICA_FICTICIA_ALIGN026')
    monkeypatch.setenv('EQUITAS_IMPORT_SERVER_JWT', 'JWT_FICTICIO_ALIGN026')
    monkeypatch.setenv('EQUITAS_IMPORT_ACTOR_USER', '7')
    state: dict[str, Any] = {
        'persons': {},
        'debtors': {},
        'relations': [],
        'contacts': [],
        'profiles': [],
        'profile_details': [],
        'debt_batches': [],
        'stored_debts': {},
        'debt_summaries': [],
        'batches': [],
    }

    def load_person(payload: dict[str, Any]) -> dict[str, int]:
        external_id = int(payload['external_id'])
        person_id = state['persons'].setdefault(external_id, len(state['persons']) + 1)
        return {'id': person_id}

    def load_debtor(payload: dict[str, Any]) -> dict[str, int]:
        debtor_key = (int(payload['type']), int(payload['external_id']))
        debtor_id = state['debtors'].setdefault(debtor_key, len(state['debtors']) + 100)
        return {'id': debtor_id}

    def load_debtor_person(payload: dict[str, Any]) -> None:
        state['relations'].append(payload)

    def load_province(payload: dict[str, Any]) -> dict[str, int]:
        return {'id': 10}

    def load_city(payload: dict[str, Any]) -> dict[str, int]:
        return {'id': 20}

    def load_address(payload: dict[str, Any]) -> None:
        return None

    def load_debtor_contact(payload: dict[str, Any]) -> None:
        state['contacts'].append(payload)

    def load_debtor_profile(payload: dict[str, Any]) -> dict[str, int]:
        state['profiles'].append(payload)
        return {'id': 1_000 + int(payload['debtor'])}

    def load_debtor_profile_detail(payload: dict[str, Any]) -> None:
        state['profile_details'].append(payload)

    def load_debts_bulk(payloads: list[dict[str, Any]]) -> dict[str, int]:
        state['debt_batches'].append(payloads)
        summary = {
            'received': len(payloads),
            'unique': len(payloads),
            'inserted': 0,
            'updated': 0,
            'unchanged': 0,
        }

        for payload in payloads:
            debt_key = (int(payload['debtor']), int(payload['external_id']))
            existing_payload = state['stored_debts'].get(debt_key)

            if existing_payload is None:
                state['stored_debts'][debt_key] = payload
                summary['inserted'] += 1
            elif existing_payload == payload:
                summary['unchanged'] += 1
            else:
                state['stored_debts'][debt_key] = payload
                summary['updated'] += 1

        state['debt_summaries'].append(summary)
        return summary

    def resolve_catalogs(required: dict[str, set[str]], key_columns: dict[str, str]) -> dict[str, dict[str, int]]:
        assert set(required) <= set(CATALOG_KEY_COLUMNS) and key_columns == CATALOG_KEY_COLUMNS
        return {table: {key: index for index, key in enumerate(sorted(keys), start=1)} for table, keys in required.items()}

    def record_import_batch(**event: Any) -> int:
        state['batches'].append(event)
        return len(state['batches'])

    monkeypatch.setattr(run_etl, 'fetch_published_objects', lambda _tenant: {})
    monkeypatch.setattr(run_etl, 'load_person', load_person)
    monkeypatch.setattr(run_etl, 'load_debtor', load_debtor)
    monkeypatch.setattr(run_etl, 'load_debtor_person', load_debtor_person)
    monkeypatch.setattr(run_etl, 'load_province', load_province)
    monkeypatch.setattr(run_etl, 'load_city', load_city)
    monkeypatch.setattr(run_etl, 'load_address', load_address)
    monkeypatch.setattr(run_etl, 'load_debtor_contact', load_debtor_contact)
    monkeypatch.setattr(run_etl, 'load_debtor_profile', load_debtor_profile)
    monkeypatch.setattr(run_etl, 'load_debtor_profile_detail', load_debtor_profile_detail)
    monkeypatch.setattr(run_etl, 'load_debts_bulk', load_debts_bulk)
    monkeypatch.setattr(run_etl, 'resolve_catalogs', resolve_catalogs)
    monkeypatch.setattr(run_etl, 'record_import_batch', record_import_batch)

    return state


def test_etl_integrates_tsv_extraction_transformation_and_simulated_idempotent_load(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = install_fake_loaders(monkeypatch)
    lot = derive_lot(tmp_path / 'lote')
    debts = sum(item['obligaciones'] for item in accepted_objects())

    run_etl.run_etl(str(lot), execute=True, cut_off=AS_OF)
    run_etl.run_etl(str(lot), execute=True, cut_off=AS_OF)

    assert len(state['debt_batches'][0]) == debts
    assert state['debt_summaries'][0] == {
        'received': debts,
        'unique': debts,
        'inserted': debts,
        'updated': 0,
        'unchanged': 0,
    }
    assert state['debt_summaries'][1] == {
        'received': debts,
        'unique': debts,
        'inserted': 0,
        'updated': 0,
        'unchanged': debts,
    }
    assert len(state['stored_debts']) == debts
    assert len(state['profiles']) == 2 * len(accepted_objects())
    assert [event['status'] for event in state['batches']] == ['VALIDADO', 'PUBLICADO'] * 2


def test_etl_excludes_a_quarantined_object_before_preparing_debts(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = install_fake_loaders(monkeypatch)
    target = accepted_objects()[0]
    lot = derive_lot(tmp_path / 'lote', cabecera_cells={(target['clave_agrupacion'], None, 'Destinatario_Id'): ''})

    run_etl.run_etl(str(lot), execute=True, cut_off=AS_OF)

    assert set(target['personas']).isdisjoint(state['persons'])
    assert state['debt_summaries'][0]['received'] == sum(item['obligaciones'] for item in accepted_objects()[1:])


def test_etl_stops_when_the_simulated_debt_loader_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = install_fake_loaders(monkeypatch)
    monkeypatch.setattr(run_etl, 'load_debts_bulk', Mock(side_effect=RuntimeError('fallo de carga simulado')))

    with pytest.raises(RuntimeError, match='codigo=ETL_FAILED'):
        run_etl.run_etl(str(derive_lot(tmp_path / 'lote')), execute=True, cut_off=AS_OF)

    assert [event['status'] for event in state['batches']] == ['VALIDADO', 'FALLIDO']
    assert state['profiles'] == []
