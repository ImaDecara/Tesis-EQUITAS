from dataclasses import replace
from pathlib import Path
from typing import Any

import pandas as pd
import pytest

from ETL import extract, run_etl


def write_source_files(
    tmp_path: Path,
    cabecera_df: pd.DataFrame,
    detalle_df: pd.DataFrame,
) -> None:
    source_dir = tmp_path / 'agua'
    source_dir.mkdir()
    cabecera_df.to_csv(source_dir / 'cabecera.tsv', sep='\t', index=False)
    detalle_df.to_csv(source_dir / 'detalle.tsv', sep='\t', index=False)


def install_fake_loaders(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
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

    return state


def test_etl_integrates_tsv_extraction_transformation_and_simulated_idempotent_load(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    cabecera_df: pd.DataFrame,
    detalle_df: pd.DataFrame,
) -> None:
    write_source_files(tmp_path, cabecera_df, detalle_df)
    monkeypatch.setattr(extract, 'settings', replace(extract.settings, input_dir=tmp_path))
    state = install_fake_loaders(monkeypatch)

    run_etl.run_etl(folder_name='agua', execute=True)
    run_etl.run_etl(folder_name='agua', execute=True)

    first_batch = state['debt_batches'][0]
    assert len(first_batch) == 2
    assert {(payload['debtor'], payload['external_id']) for payload in first_batch} == {
        (100, 9001),
        (101, 9001),
    }
    assert state['debt_summaries'][0] == {
        'received': 2,
        'unique': 2,
        'inserted': 2,
        'updated': 0,
        'unchanged': 0,
    }
    assert state['debt_summaries'][1] == {
        'received': 2,
        'unique': 2,
        'inserted': 0,
        'updated': 0,
        'unchanged': 2,
    }
    assert len(state['stored_debts']) == 2
    assert len(state['profiles']) == 4


def test_etl_omits_invalid_rows_before_preparing_debts(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    cabecera_df: pd.DataFrame,
    detalle_df: pd.DataFrame,
) -> None:
    invalid_cabecera_df = cabecera_df.copy()
    invalid_cabecera_df.loc[0, 'Destinatario_Id'] = ''
    write_source_files(tmp_path, invalid_cabecera_df, detalle_df)
    monkeypatch.setattr(extract, 'settings', replace(extract.settings, input_dir=tmp_path))
    state = install_fake_loaders(monkeypatch)

    run_etl.run_etl(folder_name='agua', execute=True)

    assert state['persons'] == {502: 1}
    assert state['debt_summaries'] == [
        {
            'received': 1,
            'unique': 1,
            'inserted': 1,
            'updated': 0,
            'unchanged': 0,
        }
    ]


def test_etl_stops_when_the_simulated_debt_loader_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    cabecera_df: pd.DataFrame,
    detalle_df: pd.DataFrame,
) -> None:
    write_source_files(tmp_path, cabecera_df, detalle_df)
    monkeypatch.setattr(extract, 'settings', replace(extract.settings, input_dir=tmp_path))
    install_fake_loaders(monkeypatch)

    def fail_loading_debts(payloads: list[dict[str, Any]]) -> dict[str, int]:
        raise RuntimeError(f'fallo de carga simulado para {len(payloads)} deudas')

    monkeypatch.setattr(run_etl, 'load_debts_bulk', fail_loading_debts)

    with pytest.raises(RuntimeError, match='fallo de carga simulado'):
        run_etl.run_etl(folder_name='agua', execute=True)
