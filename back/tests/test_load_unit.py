from copy import deepcopy

import pytest

from ETL import load


def build_debt_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        'external_id': 9001, 'debtor': 77, 'type': 'water_connection',
        'description': 'Deuda de prueba', 'original_amount': 1000.0,
        'current_amount': 1200.0, 'currency': 1, 'issue_date': '2025-01-10',
        'due_date': '2020-01-01', 'last_collection_date': '2025-01-10',
        'period': '9001', 'status': 2,
    }
    payload.update(overrides)
    return payload


def test_normalize_debt_key_requires_debtor_and_external_id() -> None:
    key = load.normalize_debt_key(build_debt_payload())

    assert key == (77, 9001)

    with pytest.raises(ValueError, match='sin debtor'):
        load.normalize_debt_key({'external_id': 9001})


def test_debt_comparison_tolerates_numeric_format_and_detects_changes() -> None:
    payload = build_debt_payload(current_amount=1200.0)
    existing = deepcopy(payload)
    existing['id'] = 1
    existing['current_amount'] = '1200.0000001'

    matches = load.debt_payload_matches_existing(payload, existing)
    changed = load.debt_payload_matches_existing(build_debt_payload(current_amount=1300.0), existing)

    assert matches is True
    assert changed is False


def test_bulk_loader_deduplicates_payloads_before_inserting(monkeypatch: pytest.MonkeyPatch) -> None:
    inserted_payloads: list[dict[str, object]] = []
    first_payload = build_debt_payload()
    repeated_payload = build_debt_payload(description='Ultima version')

    monkeypatch.setattr(load, 'fetch_existing_debts_by_key', lambda payloads: {})
    monkeypatch.setattr(
        load,
        'bulk_insert_rows',
        lambda table_name, payloads: inserted_payloads.extend(payloads),
    )

    summary = load.load_debts_bulk([first_payload, repeated_payload], batch_size=10)

    assert summary == {'received': 2, 'unique': 1, 'inserted': 1, 'updated': 0, 'unchanged': 0}
    assert inserted_payloads == [repeated_payload]


def test_bulk_loader_updates_existing_debt_only_when_data_changed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    updates: list[tuple[int, dict[str, object]]] = []
    payload = build_debt_payload(current_amount=1300.0)
    existing = build_debt_payload(current_amount=1200.0)
    existing['id'] = 44

    monkeypatch.setattr(load, 'fetch_existing_debts_by_key', lambda payloads: {(77, 9001): existing})
    monkeypatch.setattr(
        load,
        'update_row',
        lambda table_name, row_id, payload: updates.append((row_id, payload)),
    )

    summary = load.load_debts_bulk([payload], batch_size=10)

    assert summary['inserted'] == 0
    assert summary['updated'] == 1
    assert updates == [(44, payload)]
