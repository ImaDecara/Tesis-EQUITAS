from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest

from services import scoring_service as scoring


def build_profile(**overrides: Any) -> dict[str, Any]:
    profile: dict[str, Any] = {
        'id': 1,
        'debtor': 10,
        'socioeconomic_risk_level': 80,
        'available_contact_count': 0,
        'overdue_debt_count': 12,
        'oldest_debt_days': 400,
        'active_person_count': 2,
        'total_debt_amount': 1500.5,
        'overdue_debt_amount': 1200.0,
        'debt_count': 13,
        'average_debt_age_days': 220,
    }
    profile.update(overrides)
    return profile


@pytest.mark.parametrize(
    ('value', 'expected'),
    [
        (None, 0),
        ('12.9', 12),
        ('invalid', 0),
        (8.5, 8),
    ],
)
def test_scoring_normalizes_numeric_values(value: Any, expected: int) -> None:
    assert scoring.to_int(value) == expected


@pytest.mark.parametrize(
    ('risk_score', 'expected_band'),
    [(0, 'low'), (25, 'medium'), (50, 'high'), (75, 'critical')],
)
def test_scoring_classifies_risk_boundaries(risk_score: int, expected_band: str) -> None:
    assert scoring.classify_risk_band(risk_score) == expected_band
    assert scoring.get_risk_band_label(expected_band).startswith('Riesgo')


@pytest.mark.parametrize(
    ('profile', 'expected_group'),
    [
        (build_profile(socioeconomic_risk_level=75, available_contact_count=0), 'critical_no_contact'),
        (build_profile(socioeconomic_risk_level=75, available_contact_count=1), 'critical_contactable'),
        (build_profile(socioeconomic_risk_level=50, overdue_debt_count=10), 'high_overdue_volume'),
        (build_profile(socioeconomic_risk_level=50, overdue_debt_count=2), 'high_recovery_priority'),
        (build_profile(socioeconomic_risk_level=25), 'medium_recovery'),
        (build_profile(socioeconomic_risk_level=24), 'low_monitoring'),
    ],
)
def test_scoring_assigns_each_operational_group(
    profile: dict[str, Any],
    expected_group: str,
) -> None:
    assert scoring.assign_case_group(profile) == expected_group


def test_scoring_builds_complete_case_with_tags_and_capped_priority() -> None:
    profile = build_profile(socioeconomic_risk_level=98)

    result = scoring.build_case_scoring(
        profile,
        debtor={
            'external_id': 5001,
            'type': 6,
            'identifier': 'AG-5001',
            'description': 'Conexion de agua',
        },
    )

    assert result['priority_score'] == 100
    assert result['group_key'] == 'critical_no_contact'
    assert result['risk_band'] == 'critical'
    assert set(result['tags']) == {
        'critical_risk',
        'no_contact',
        'data_quality_issue',
        'multi_person_case',
        'many_overdue_debts',
        'old_debt',
        'has_overdue_amount',
    }
    assert result['debtor_identifier'] == 'AG-5001'


@dataclass
class FakeResponse:
    data: Any


class FakeQuery:
    def __init__(self, execute_result: Any) -> None:
        self.execute_result = execute_result
        self.filters: list[tuple[str, Any]] = []

    def select(self, _columns: str) -> FakeQuery:
        return self

    def eq(self, column: str, value: Any) -> FakeQuery:
        self.filters.append((column, value))
        return self

    def in_(self, column: str, values: list[int]) -> FakeQuery:
        self.filters.append((column, values))
        return self

    def execute(self) -> FakeResponse:
        return FakeResponse(self.execute_result)


class FakeSupabase:
    def __init__(self, profiles: list[dict[str, Any]], debtors: list[dict[str, Any]]) -> None:
        self.profiles_query = FakeQuery(profiles)
        self.debtor_queries: list[FakeQuery] = []
        self.debtors = debtors

    def table(self, table_name: str) -> FakeQuery:
        if table_name == 'debtor_profile':
            return self.profiles_query

        query = FakeQuery(self.debtors)
        self.debtor_queries.append(query)
        return query


def test_scoring_reads_profiles_and_debtors_in_chunks(monkeypatch: pytest.MonkeyPatch) -> None:
    profiles = [build_profile(debtor=index) for index in range(1, 202)]
    debtors = [
        {'id': index, 'external_id': 10_000 + index, 'identifier': f'OBJ-{index}'}
        for index in range(1, 202)
    ]
    fake_supabase = FakeSupabase(profiles, debtors)
    monkeypatch.setattr(scoring, 'supabase', fake_supabase)

    fetched_profiles = scoring.fetch_debtor_profiles()
    fetched_debtors = scoring.fetch_debtors_by_ids(list(range(1, 202)))

    assert len(fetched_profiles) == 201
    assert fetched_debtors[201]['identifier'] == 'OBJ-201'
    assert len(fake_supabase.debtor_queries) == 2
    assert fake_supabase.debtor_queries[0].filters == [('id', list(range(1, 201)))]
    assert fake_supabase.debtor_queries[1].filters == [('id', [201])]


def test_scoring_builds_filters_paginates_and_summarizes_cases(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    profiles = [
        build_profile(id=1, debtor=10, socioeconomic_risk_level=80, available_contact_count=0),
        build_profile(id=2, debtor=20, socioeconomic_risk_level=55, available_contact_count=2),
        build_profile(id=3, debtor=30, socioeconomic_risk_level=20, available_contact_count=1),
    ]
    debtors = {
        10: {'id': 10, 'external_id': 100, 'identifier': 'AG-100', 'description': 'Agua'},
        20: {'id': 20, 'external_id': 200, 'identifier': 'IN-200', 'description': 'Inmueble'},
        30: {'id': 30, 'external_id': 300, 'identifier': 'RO-300', 'description': 'Rodado'},
    }
    monkeypatch.setattr(scoring, 'fetch_debtor_profiles', lambda: profiles)
    monkeypatch.setattr(scoring, 'fetch_debtors_by_ids', lambda _ids: debtors)

    cases = scoring.build_all_case_groups()
    filtered = scoring.filter_case_groups(cases, risk_band='critical', tag='no_contact', search='ag-100')
    page = scoring.get_case_groups(limit=1, offset=1)
    summary = scoring.get_case_groups_summary()
    scoring.print_case_groups_preview(cases)

    assert [case['debtor_id'] for case in cases] == [10, 20, 30]
    assert [case['debtor_id'] for case in filtered] == [10]
    assert page['total'] == 3
    assert len(page['items']) == 1
    assert summary['risk_bands'] == {'critical': 1, 'high': 1, 'medium': 0, 'low': 1}
    assert summary['contacts'] == {'without_contact': 1, 'with_contact': 2}
    assert 'Casos procesados: 3' in capsys.readouterr().out
