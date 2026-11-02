"""Integración sintética: consultas reales del servicio contra un cliente falso."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from services import scoring_service as scoring
from services.paginated_reader import DataReadError, read_all_by_id, row_id

CUTOFF = "2026-09-30"
GOLDEN = json.loads(
    (
        Path(__file__).resolve().parents[2] / "contracts/decision-rules.v1.golden.json"
    ).read_text()
)


class FakeQuery:
    def __init__(self, client, table):
        self.client, self.table_name = client, table
        self.columns = []
        self.predicates = []
        self.order_column = None
        self.requested_limit = None

    def select(self, columns):
        self.columns = columns.split(",")
        return self

    def eq(self, column, value):
        self.predicates.append(("eq", column, value))
        return self

    def in_(self, column, values):
        self.predicates.append(("in", column, values))
        return self

    def gt(self, column, value):
        self.predicates.append(("gt", column, value))
        return self

    def order(self, column):
        self.order_column = column
        return self

    def limit(self, count):
        self.requested_limit = count
        return self

    def execute(self):
        self.client.queries.append(self)
        assert self.order_column == "id"
        assert self.requested_limit == 1000
        if self.table_name in self.client.fail_tables:
            raise RuntimeError("sensitive remote payload must not be exposed")
        rows = deepcopy(self.client.tables.get(self.table_name, []))
        for operation, column, value in self.predicates:
            if operation == "eq":
                rows = [row for row in rows if row.get(column) == value]
            elif operation == "in":
                rows = [row for row in rows if row[column] in value]
            else:
                rows = [row for row in rows if int(row[column]) > value]
        rows.sort(key=lambda row: int(row["id"]))
        rows = rows[: min(self.client.cap, self.requested_limit)]
        return SimpleNamespace(
            data=[{key: row.get(key) for key in self.columns} for row in rows]
        )


class FakeSupabase:
    def __init__(self, tables=None, cap=1000, fail_tables=()):
        self.tables = tables or {}
        self.cap = cap
        self.fail_tables = fail_tables
        self.queries = []

    def table(self, table_name):
        return FakeQuery(self, table_name)


TENANT = 7


def install_client(_monkeypatch, **kwargs):
    client = FakeSupabase(**kwargs)
    for row in client.tables.get("debtor", []):
        row.setdefault("tenant", TENANT)
    return client


def build_cases(client, as_of=CUTOFF):
    return scoring.build_all_case_groups(client, tenant=TENANT, as_of=as_of)


@pytest.mark.parametrize("cap", [1000, 37])
def test_reads_all_2933_profiles_and_debtors_under_server_cap(monkeypatch, cap):
    ids = [number * 3 for number in range(1, 2934)]
    profiles = [
        {"id": number, "debtor": number, "active": True} for number in reversed(ids)
    ]
    profiles.append({"id": 1, "debtor": 1, "active": False})
    debtors = [
        {"id": number, "identifier": f"SINT-{number}"} for number in reversed(ids)
    ]
    client = install_client(
        monkeypatch, tables={"debtor_profile": profiles, "debtor": debtors}, cap=cap
    )
    assert list(scoring.fetch_debtors(client, TENANT)) == ids
    debtor_queries = [query for query in client.queries if query.table_name == "debtor"]
    assert len(debtor_queries) == (2933 + cap - 1) // cap + 1
    assert all(("eq", "tenant", TENANT) in query.predicates for query in debtor_queries)
    assert ("gt", "id", ids[-1]) in debtor_queries[-1].predicates
    assert sorted(
        row["id"] for row in scoring.fetch_debtor_profiles(client, ids + ids[:2])
    ) == ids
    profile_queries = [
        query for query in client.queries if query.table_name == "debtor_profile"
    ]
    assert all(("eq", "active", True) in query.predicates for query in profile_queries)
    chunks = [
        value
        for query in client.queries
        for op, column, value in query.predicates
        if op == "in"
    ]
    assert max(map(len, chunks)) == 200
    count = len(client.queries)
    assert scoring.fetch_debtor_profiles(client, []) == []
    assert len(client.queries) == count


@pytest.mark.parametrize("count", [0, 1, 1000, 2000])
def test_reads_through_empty_page_for_exact_multiples(monkeypatch, count):
    client = install_client(
        monkeypatch,
        tables={
            "debtor": [{"id": index + 1} for index in range(count)],
        },
    )
    assert len(scoring.fetch_debtors(client, TENANT)) == count
    assert len(client.queries) == (count + 999) // 1000 + 1


@pytest.mark.parametrize(
    "pages",
    [
        [None],
        [{}],
        [[None]],
        [[{"id": None}]],
        [[{"id": True}]],
        [[{"id": 2}, {"id": 1}]],
        [[{"id": 1}], [{"id": 1}]],
        [[{"id": 1}], RuntimeError("private remote payload")],
        [[{"id": 1}], None],
    ],
)
def test_incomplete_read_raises_instead_of_returning_prefix(pages):
    class BrokenQuery:
        def order(self, _column):
            return self

        def limit(self, _limit):
            return self

        def gt(self, _column, _value):
            return self

        def execute(self):
            item = pages.pop(0)
            if isinstance(item, Exception):
                raise item
            return SimpleNamespace(data=item)

    with pytest.raises(DataReadError, match="^READ_INCOMPLETE:debt$"):
        read_all_by_id("debt", BrokenQuery)


@pytest.mark.parametrize("value", [None, False, 0, -1, 1.5, "", "1.5", "١"])
def test_rejects_invalid_cursor_ids(value):
    with pytest.raises(ValueError):
        row_id(value)


def test_accepts_bigint_string_without_float_rounding():
    assert row_id("9007199254740993") == 9007199254740993


def synthetic_tables():
    tables: dict[str, list[dict[str, Any]]] = {
        "debtor": [
            {"id": index, "identifier": f"SINT-OBJ-{index}"} for index in (1, 2, 3, 4)
        ],
        "debtor_profile": [
            {
                "id": index,
                "debtor": index,
                "active": True,
                "socioeconomic_risk_level": 100,
                "total_debt_amount": 999999999,
                "available_contact_count": 999,
            }
            for index in (1, 2, 3)
        ],
        "debt": [],
        "debtor_person": [
            {
                "id": index,
                "debtor": index,
                "person": index,
                "priority": 100,
                "active": True,
            }
            for index in (1, 2, 3, 4)
        ],
        "person": [{"id": index, "type": 1} for index in (1, 2, 3, 4)],
        "person_type": [{"id": 1, "key": "INDIVIDUAL"}],
        "debtor_contact": [
            {
                "id": index,
                "person": index,
                "type": 1,
                "value": f"SINT-contact-{index}",
                "active": True,
            }
            for index in (2, 3, 4)
        ],
    }
    for identifier, golden_index in ((1, 0), (2, 0), (3, 1)):
        for obligation in GOLDEN["casos"][golden_index]["entrada"]["obligaciones"]:
            tables["debt"].append(
                {
                    "id": len(tables["debt"]) + 1,
                    "debtor": identifier,
                    "current_amount": obligation["current_amount"]["valor"],
                    "due_date": obligation["due_date"]["valor"],
                }
            )
    return tables


def test_service_evaluates_raw_debt_not_legacy_profiles_and_includes_objects_without_profile(
    monkeypatch,
):
    tables = synthetic_tables()
    client = install_client(monkeypatch, tables=tables, cap=2)
    cases = build_cases(client)
    by_id = {case["debtor_id"]: case for case in cases}
    assert set(by_id) == {1, 2, 3, 4}
    assert by_id[1]["priority_score"] == by_id[2]["priority_score"] == 75
    assert by_id[1]["group_key"] == "MEJORAR_DATOS"
    assert by_id[2]["group_key"] == "CONTACTO_PERSONAL_Y_PLAN"
    assert by_id[3]["group_key"] == "RECORDATORIO_INFORMATIVO"
    assert by_id[4]["group_key"] == "SEGUIMIENTO"
    assert by_id[4]["debtor_profile_id"] is None
    assert by_id[4]["priority_score"] == 0
    for case in cases:
        assert "socioeconomic_risk_level" not in case
        assert "risk_band" not in case
        assert case["as_of"] == CUTOFF
        assert case["version_reglas"] == "1.0.0"
    # Ningún agregado heredado afecta la salida ni siquiera si es contradictorio.
    tables["debtor_profile"][0].update(
        socioeconomic_risk_level=0, total_debt_amount=None
    )
    assert build_cases(client) == cases


def test_paginated_obligations_do_not_stop_at_1000_for_one_object(monkeypatch):
    tables = synthetic_tables()
    tables["debt"] = [
        {"id": index, "debtor": 2, "current_amount": 1000, "due_date": "2026-09-01"}
        for index in range(1, 2934)
    ]
    client = install_client(monkeypatch, tables=tables)
    case = next(
        case
        for case in build_cases(client)
        if case["debtor_id"] == 2
    )
    assert case["decision"]["severidad"]["cantidad_vencidas"] == 2933
    assert case["decision"]["severidad"]["monto_actualizado_ars"] == 2933000
    assert case["priority_score"] == 75


def test_2933_case_portfolio_is_complete_end_to_end(monkeypatch):
    tables = {
        "debtor": [{"id": index} for index in range(1, 2934)],
        "debtor_profile": [
            {"id": index, "debtor": index, "active": True} for index in range(1, 2934)
        ],
    }
    client = install_client(monkeypatch, tables=tables)
    cases = build_cases(client)
    assert len(cases) == 2933
    assert [case["debtor_id"] for case in cases] == sorted(range(1, 2934), key=str)
    assert all(case["priority_score"] == 0 for case in cases)


@pytest.mark.parametrize(
    "table",
    [
        "debt",
        "debtor_person",
        "person",
        "debtor_contact",
        "person_type",
        "debtor",
        "debtor_profile",
    ],
)
def test_failed_table_cannot_become_zero_debt_or_zero_contacts(monkeypatch, table):
    client = install_client(monkeypatch, tables=synthetic_tables(), fail_tables=(table,))
    with pytest.raises(DataReadError, match=f"^READ_INCOMPLETE:{table}$"):
        build_cases(client)


def test_invalid_parent_id_cannot_silently_drop_obligation(monkeypatch):
    tables = synthetic_tables()
    tables["debtor_person"][0]["person"] = None
    client = install_client(monkeypatch, tables=tables)
    with pytest.raises(DataReadError, match="debtor_person"):
        build_cases(client)


def test_filters_pagination_summary_and_console_use_v1(monkeypatch, capsys):
    client = install_client(monkeypatch, tables=synthetic_tables())
    cases = build_cases(client)
    filtered = scoring.filter_case_groups(
        cases,
        group_key="MEJORAR_DATOS",
        severity_band="ALTA",
        tag="SIN_CONTACTO_ACTIVO",
        search=" sint-obj-1 ",
    )
    assert [case["debtor_id"] for case in filtered] == [1]
    assert scoring.filter_case_groups(cases, group_key="missing") == []
    assert scoring.filter_case_groups(cases, severity_band="missing") == []
    assert scoring.filter_case_groups(cases, tag="missing") == []
    assert scoring.filter_case_groups(cases, search="missing") == []
    page = scoring.get_case_groups(client, tenant=TENANT, as_of=CUTOFF, limit=1, offset=1)
    assert page["total"] == 4
    assert page["items"] == cases[1:2]
    summary = scoring.get_case_groups_summary(client, tenant=TENANT, as_of=CUTOFF)
    assert summary["total_cases"] == 4
    assert summary["severity_bands"] == {
        "BAJA": 1,
        "MEDIA": 1,
        "ALTA": 2,
        "NO_DISPONIBLE": 0,
    }
    assert summary["contacts"] == {
        "without_contact": 1,
        "with_contact": 3,
        "unavailable": 0,
    }
    scoring.print_case_groups_preview(cases)
    output = capsys.readouterr().out
    assert "Casos procesados: 4" in output
    assert "SINT-OBJ" not in output
    assert "%" not in output


def test_unavailable_severity_is_counted_separately_and_sorted_last(monkeypatch):
    tables = synthetic_tables()
    tables["debt"].append(
        {"id": 100, "debtor": 4, "current_amount": None, "due_date": None}
    )
    client = install_client(monkeypatch, tables=tables)
    cases = build_cases(client)
    queue = [case for case in cases if case["group_key"] == "MEJORAR_DATOS"]
    assert [case["debtor_id"] for case in queue] == [1, 4]
    assert queue[-1]["priority_score"] is None
    assert (
        scoring.get_case_groups_summary(client, tenant=TENANT, as_of=CUTOFF)[
            "severity_bands"
        ]["NO_DISPONIBLE"]
        == 1
    )


def test_empty_portfolio_and_cutoff_and_pagination_validation(monkeypatch):
    client = install_client(monkeypatch)
    assert build_cases(client) == []
    assert (
        scoring.get_case_groups_summary(client, tenant=TENANT, as_of=CUTOFF)["total_cases"]
        == 0
    )
    count = len(client.queries)
    with pytest.raises(ValueError):
        build_cases(client, as_of="invalid")
    with pytest.raises(ValueError):
        scoring.get_case_groups(client, tenant=TENANT, as_of=CUTOFF, limit=0)
    with pytest.raises(ValueError):
        scoring.get_case_groups(client, tenant=TENANT, as_of=CUTOFF, offset=-1)
    assert len(client.queries) == count


def test_foreign_or_unidentified_tenant_row_invalidates_the_portfolio(monkeypatch):
    for tenant in (TENANT + 1, None):
        tables = synthetic_tables()
        client = install_client(monkeypatch, tables=tables)
        tables["debtor"][0]["tenant"] = tenant

        class IgnoresTenantFilter:
            """Simula una política o un filtro roto: el servicio no confía en la consulta."""

            def table(self, name):
                query = client.table(name)
                query.eq = lambda _column, _value: query
                return query

        with pytest.raises(DataReadError, match="debtor"):
            scoring.build_all_case_groups(IgnoresTenantFilter(), tenant=TENANT, as_of=CUTOFF)


def test_console_preview_prints_only_counts(monkeypatch, capsys):
    client = install_client(monkeypatch, tables=synthetic_tables())
    scoring.print_case_groups_preview(build_cases(client)[:2])
    assert "Casos procesados: 2" in capsys.readouterr().out
