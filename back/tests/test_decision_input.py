from decimal import Decimal

import pytest

from services.decision_input import build_decision_input
from services.decision_rules_v1 import evaluate


def make_entry(*, debts=None, relations=None, contacts=None, people=None, types=None):
    return build_decision_input(
        {"id": 1},
        debts or [],
        relations or [],
        people or {},
        contacts or [],
        types or {},
        as_of="2026-09-30",
    )


@pytest.mark.parametrize(
    "value,state,expected",
    [
        (0, "OBSERVADO", 0),
        ("0.00", "OBSERVADO", 0),
        ("10.01", "OBSERVADO", Decimal("10.01")),
        (None, "NO_INFORMADO_EN_ORIGEN", None),
        (" ", "NO_INFORMADO_EN_ORIGEN", None),
        ("bad", "INVALIDO", None),
        ("NaN", "INVALIDO", None),
        (float("inf"), "INVALIDO", None),
        (True, "INVALIDO", None),
        ("1.001", "INVALIDO", None),
        (-1, "OBSERVADO", -1),
    ],
)
def test_amount_presence_never_falls_back_to_capital_or_alias(value, state, expected):
    entry = make_entry(
        debts=[
            {
                "id": 1,
                "current_amount": value,
                "updated_amount": 999,
                "original_amount": 9999,
                "due_date": "2026-09-01",
            }
        ]
    )
    assert entry["obligaciones"][0]["current_amount"] == {
        "estado": state,
        "valor": expected,
    }


def test_alias_is_only_used_when_current_amount_column_is_absent():
    entry = make_entry(
        debts=[{"id": 1, "updated_amount": 3}, {"id": 2, "original_amount": 10}]
    )
    assert entry["obligaciones"][0]["current_amount"] == {
        "estado": "OBSERVADO",
        "valor": 3,
    }
    assert entry["obligaciones"][1]["current_amount"] == {
        "estado": "NO_INTEGRADO",
        "valor": None,
    }


@pytest.mark.parametrize(
    "value,state",
    [
        (None, "NO_INFORMADO_EN_ORIGEN"),
        ("", "NO_INFORMADO_EN_ORIGEN"),
        ("1900-01-01", "OBSERVADO"),
        ("2026-09-01", "OBSERVADO"),
        ("2026-02-30", "INVALIDO"),
        ("2026-09-01T00:00:00Z", "INVALIDO"),
    ],
)
def test_date_presence_and_implausible_observed_date(value, state):
    entry = make_entry(debts=[{"id": 1, "current_amount": 10, "due_date": value}])
    assert entry["obligaciones"][0]["due_date"]["estado"] == state
    if value == "1900-01-01":
        result = evaluate(entry)
        assert result["severidad"]["estado"] == "NO_DISPONIBLE"
        assert "FECHAS_INCONSISTENTES" in result["banderas"]


def test_unintegrated_source_fields_and_vulnerability_are_not_inferred():
    entry = make_entry(
        debts=[
            {
                "id": 1,
                "current_amount": 10,
                "due_date": "2026-01-01",
                "status": 1,
                "period": "9876",
                "issue_date": "2026-01-02",
            }
        ]
    )
    for key in ("estado_origen", "periodo_fiscal"):
        assert entry["obligaciones"][0][key] == {
            "estado": "NO_INTEGRADO",
            "valor": None,
        }
    assert entry["source_updated_at"] == {"estado": "NO_INTEGRADO", "valor": None}
    assert entry["vulnerabilidad"] == {
        "estado": "NO_INFORMADO_EN_ORIGEN",
        "valor": None,
    }


def test_contacts_use_active_relations_and_active_nonempty_deduplicated_values():
    relations = [
        {"id": 1, "person": 1, "priority": 100, "active": True},
        {"id": 2, "person": 2, "priority": 20, "active": False},
        {"id": 3, "person": 3, "priority": 0, "active": True},
    ]
    contacts = [
        {"id": 1, "person": 1, "type": 1, "value": " SINT-CHANNEL ", "active": True},
        {"id": 2, "person": 1, "type": 1, "value": "sint-channel", "active": True},
        {"id": 3, "person": 1, "type": 2, "value": "sint-channel", "active": True},
        {"id": 4, "person": 1, "type": 1, "value": " ", "active": True},
        {"id": 5, "person": 1, "type": 1, "value": "INACTIVE", "active": False},
        {"id": 6, "person": 2, "type": 1, "value": "UNLINKED", "active": True},
        {"id": 7, "person": 3, "type": 1, "value": "sint-channel", "active": True},
    ]
    entry = make_entry(
        relations=relations,
        contacts=contacts,
        people={1: {"type": 1}, 3: {"type": 2}},
        types={1: {"key": "INDIVIDUAL"}, 2: {"key": "LEGAL_PERSON"}},
    )
    assert entry["contactos_activos"] == {"estado": "OBSERVADO", "valor": 3}
    assert [person["tipo"]["valor"] for person in entry["personas"]] == [
        "FISICA",
        "JURIDICA",
    ]
    assert [
        person["porcentaje_declarado"]["valor"] for person in entry["personas"]
    ] == [100, 0]
    assert "PORCENTAJES_NO_SUMAN_100" not in evaluate(entry)["banderas"]


def test_unknown_person_and_missing_percentage_only_raise_quality_flags():
    entry = make_entry(relations=[{"id": 1, "person": 1, "active": True}])
    result = evaluate(entry)
    assert entry["personas"][0]["tipo"] == {"estado": "NO_INTEGRADO", "valor": None}
    assert result["severidad"]["valor"] == 0
    assert "TIPO_PERSONA_DESCONOCIDO" in result["banderas"]
    assert "PORCENTAJES_NO_SUMAN_100" in result["banderas"]


@pytest.mark.parametrize(
    "person,catalog,state,value",
    [
        ({"type": None}, {}, "NO_INFORMADO_EN_ORIGEN", None),
        ({"type": "bad"}, {}, "INVALIDO", None),
        ({"type": 99}, {}, "INVALIDO", None),
        ({"type": 1}, {1: {"key": "UNMAPPED"}}, "INVALIDO", None),
        ({"type": "1"}, {1: {"key": "UNKNOWN"}}, "OBSERVADO", "UNKNOWN"),
    ],
)
def test_person_type_preserves_missing_and_invalid_catalog_data(
    person, catalog, state, value
):
    entry = make_entry(
        relations=[{"id": 1, "person": 1, "priority": 100, "active": True}],
        people={1: person},
        types=catalog,
    )
    assert entry["personas"][0]["tipo"] == {"estado": state, "valor": value}
    assert "TIPO_PERSONA_DESCONOCIDO" in evaluate(entry)["banderas"]
