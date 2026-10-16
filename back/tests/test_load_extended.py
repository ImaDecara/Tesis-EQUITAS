from __future__ import annotations

from typing import Any

import pytest

from ETL import load


class FakeResponse:
    def __init__(self, data: Any) -> None:
        self.data = data


class FakeQuery:
    def __init__(self, response_data: Any) -> None:
        self.response_data = response_data
        self.filters: list[tuple[str, Any]] = []

    def select(self, _columns: str) -> FakeQuery:
        return self

    def eq(self, column: str, value: Any) -> FakeQuery:
        self.filters.append((column, value))
        return self

    def limit(self, _value: int) -> FakeQuery:
        return self

    def insert(self, _payload: Any) -> FakeQuery:
        return self

    def update(self, _payload: Any) -> FakeQuery:
        return self

    def execute(self) -> FakeResponse:
        return FakeResponse(self.response_data)


class FakeSupabase:
    def __init__(self, response_data: Any) -> None:
        self.response_data = response_data
        self.queries: list[FakeQuery] = []

    def table(self, _table_name: str) -> FakeQuery:
        query = FakeQuery(self.response_data)
        self.queries.append(query)
        return query


def test_loader_base_operations_use_mocked_supabase_responses(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_supabase = FakeSupabase([{'id': 9, 'external_id': 100}])
    monkeypatch.setattr(load, 'supabase', fake_supabase)

    fetched = load.fetch_one('person', {'external_id': 100})
    inserted = load.insert_row('person', {'external_id': 100})
    updated = load.update_row('person', 9, {'external_id': 100})
    bulk = load.bulk_insert_rows('person', [{'external_id': 100}])

    assert fetched == {'id': 9, 'external_id': 100}
    assert inserted['id'] == 9
    assert updated['id'] == 9
    assert bulk == [{'id': 9, 'external_id': 100}]
    assert fake_supabase.queries[0].filters == [('external_id', 100)]


@pytest.mark.parametrize(
    ('loader', 'payload', 'expected_table', 'expected_filters'),
    [
        (load.load_person, {'external_id': 1}, load.PERSON_TABLE, {'external_id': 1}),
        (load.load_debtor, {'tenant': 1, 'type': 6, 'external_id': 2}, load.DEBTOR_TABLE, {'tenant': 1, 'type': 6, 'external_id': 2}),
        (load.load_debtor_person, {'debtor': 2, 'person': 1}, load.DEBTOR_PERSON_TABLE, {'debtor': 2, 'person': 1}),
        (load.load_debt, {'debtor': 2, 'external_id': 3}, load.DEBT_TABLE, {'debtor': 2, 'external_id': 3}),
        (load.load_province, {'name': 'Santa Fe'}, load.PROVINCE_TABLE, {'name': 'Santa Fe'}),
        (load.load_city, {'province': 1, 'name': 'Rosario', 'postal_code': '2000'}, load.CITY_TABLE, {'province': 1, 'name': 'Rosario', 'postal_code': '2000'}),
        (load.load_address, {'person': 1}, load.ADDRESS_TABLE, {'person': 1}),
        (load.load_debtor_contact, {'person': 1, 'type': 1, 'value': '341'}, load.DEBTOR_CONTACT_TABLE, {'person': 1, 'type': 1, 'value': '341'}),
        (load.load_debtor_profile, {'debtor': 2}, load.DEBTOR_PROFILE_TABLE, {'debtor': 2}),
        (load.load_debtor_profile_detail, {'debtor_profile': 3, 'person': 1}, load.DEBTOR_PROFILE_DETAIL_TABLE, {'debtor_profile': 3, 'person': 1}),
    ],
)
def test_specific_loaders_keep_their_deduplication_contracts(
    monkeypatch: pytest.MonkeyPatch,
    loader,
    payload: dict[str, Any],
    expected_table: str,
    expected_filters: dict[str, Any],
) -> None:
    captured: dict[str, Any] = {}

    def fake_insert_or_update(
        table_name: str,
        payload: dict[str, Any],
        lookup_filters: dict[str, Any],
    ) -> dict[str, int]:
        captured.update({
            'table_name': table_name,
            'payload': payload,
            'lookup_filters': lookup_filters,
        })
        return {'id': 1}

    monkeypatch.setattr(load, 'insert_or_update_by_filters', fake_insert_or_update)

    assert loader(payload) == {'id': 1}
    assert captured == {
        'table_name': expected_table,
        'payload': payload,
        'lookup_filters': expected_filters,
    }


def test_loader_rejects_invalid_payloads_and_response_shapes() -> None:
    with pytest.raises(ValueError, match='sin external_id'):
        load.load_person({})

    with pytest.raises(ValueError, match='sin type'):
        load.load_debtor({'tenant': 1, 'external_id': 2})

    with pytest.raises(RuntimeError, match='Respuesta vac'):
        load.get_first_response_row([], 'person', 'select')

    with pytest.raises(RuntimeError, match='no es un objeto'):
        load.get_first_response_row([1], 'person', 'select')
