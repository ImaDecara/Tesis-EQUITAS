"""El mismo oráculo congelado que consume ALIGN-009, sin copias de resultados."""

import json
from copy import deepcopy
from pathlib import Path

import pytest

from services import decision_rules_v1 as rules

GOLDEN = json.loads(
    (
        Path(__file__).resolve().parents[2] / "contracts/decision-rules.v1.golden.json"
    ).read_text()
)
CASES = {case["id"]: case for case in GOLDEN["casos"]}


@pytest.mark.parametrize("case", GOLDEN["casos"], ids=lambda case: case["id"])
def test_complete_golden_output(case):
    entry = deepcopy(case["entrada"])
    assert rules.evaluate(entry) == case["esperado"]
    assert entry == case["entrada"]
    assert rules.RULES_VERSION == GOLDEN["version_reglas"]


@pytest.mark.parametrize(
    "pair",
    GOLDEN["pares_contrafactuales"],
    ids=lambda pair: pair["base"] + "/" + pair["variante"],
)
def test_counterfactual_properties(pair):
    base = rules.evaluate(CASES[pair["base"]]["entrada"])
    variant = rules.evaluate(CASES[pair["variante"]]["entrada"])
    assert base["severidad"] == variant["severidad"]
    assert base["prioridad"]["valor"] == variant["prioridad"]["valor"]
    if pair["propiedad"] == "intensidad_no_aumenta":
        assert (
            variant["intervencion"]["intensidad"] <= base["intervencion"]["intensidad"]
        )
    if pair["propiedad"] == "solo_cambian_banderas":
        assert {k: v for k, v in base.items() if k != "banderas"} == {
            k: v for k, v in variant.items() if k != "banderas"
        }


@pytest.mark.parametrize(
    "ordering", GOLDEN["ordenamientos"], ids=lambda ordering: ordering["cola"]
)
def test_queue_ordering(ordering):
    evaluated = [
        (case["id"], rules.evaluate(case["entrada"]))
        for case in reversed(GOLDEN["casos"])
    ]
    queue = [
        (identifier, result)
        for identifier, result in evaluated
        if result["prioridad"]["cola"] == ordering["cola"]
    ]
    assert [
        identifier
        for identifier, _ in sorted(
            queue, key=lambda pair: rules.priority_sort_key(*pair)
        )
    ] == ordering["orden_esperado"]


@pytest.mark.parametrize("case", GOLDEN["casos"], ids=lambda case: case["id"])
def test_safety_invariants(case):
    decision = rules.evaluate(case["entrada"])
    severity = decision["severidad"]
    intervention = decision["intervencion"]
    assert (
        intervention["intensidad"]
        <= rules.RULES["escala_intensidad"]["maximo_automatico"]
    )
    assert (decision["prioridad"]["valor"] is None) == (
        severity["estado"] == "NO_DISPONIBLE"
    )
    if intervention["intensidad"] >= 1:
        assert "SIN_CONTACTO_ACTIVO" not in decision["banderas"]
        assert intervention["canal_requerido"]
    if severity["cantidad_vencidas"] == 0:
        assert severity["valor"] == 0


@pytest.mark.parametrize(
    "case",
    [
        case
        for case in GOLDEN["casos"]
        if case["esperado"]["severidad"]["estado"] == "PARCIAL"
    ],
    ids=lambda case: case["id"],
)
def test_completing_missing_obligations_cannot_lower_severity(case):
    entry = deepcopy(case["entrada"])
    before = rules.evaluate(entry)
    for obligation in entry["obligaciones"]:
        amount = obligation["current_amount"]
        due = obligation["due_date"]
        if amount["estado"] != "OBSERVADO" or amount["valor"] < 0:
            obligation["current_amount"] = {"estado": "OBSERVADO", "valor": 100_000}
        if (
            due["estado"] != "OBSERVADO"
            or due["valor"] < rules.RULES["evaluabilidad"]["fecha_minima_plausible"]
        ):
            obligation["due_date"] = {"estado": "OBSERVADO", "valor": "2020-01-01"}
    after = rules.evaluate(entry)
    assert after["severidad"]["estado"] == "COMPLETA"
    assert after["severidad"]["valor"] >= before["severidad"]["valor"]


@pytest.mark.parametrize(
    "cutoff", [None, "", "2026-02-30", "20260930", "2026-09-30T00:00:00Z", 20260930]
)
def test_cutoff_is_required_and_must_be_an_iso_date(cutoff):
    entry = deepcopy(CASES["SINT-G01"]["entrada"])
    entry["as_of"] = cutoff
    with pytest.raises((ValueError, TypeError)):
        rules.evaluate(entry)


@pytest.mark.parametrize(
    "field,value", [("id", 1), ("id", "á"), ("id", ""), ("obligaciones", None)]
)
def test_rejects_invalid_object_input(field, value):
    entry = deepcopy(CASES["SINT-G01"]["entrada"])
    entry[field] = value
    with pytest.raises((ValueError, TypeError)):
        rules.evaluate(entry)


@pytest.mark.parametrize(
    "datum",
    [
        None,
        {"estado": "MISSING", "valor": None},
        {"estado": "OBSERVADO", "valor": None},
        {"estado": "INVALIDO", "valor": 0},
        {"estado": "OBSERVADO", "valor": "UNKNOWN"},
    ],
)
def test_rejects_malformed_presence_and_vulnerability(datum):
    entry = deepcopy(CASES["SINT-G01"]["entrada"])
    entry["vulnerabilidad"] = datum
    with pytest.raises((ValueError, TypeError)):
        rules.evaluate(entry)


@pytest.mark.parametrize("value", [True, "0", float("inf"), float("nan")])
def test_rejects_invalid_observed_numbers(value):
    entry = deepcopy(CASES["SINT-G01"]["entrada"])
    entry["obligaciones"][0]["current_amount"]["valor"] = value
    with pytest.raises((ValueError, TypeError)):
        rules.evaluate(entry)


def test_money_uses_integer_cents_and_percentage_tolerance_is_decimal():
    entry = deepcopy(CASES["SINT-G01"]["entrada"])
    entry["obligaciones"] = entry["obligaciones"][:2]
    entry["obligaciones"][0]["current_amount"]["valor"] = 0.1
    entry["obligaciones"][1]["current_amount"]["valor"] = 0.2
    entry["personas"][0]["porcentaje_declarado"]["valor"] = 100.01
    result = rules.evaluate(entry)
    assert result["severidad"]["monto_actualizado_ars"] == 0.3
    assert "PORCENTAJES_NO_SUMAN_100" not in result["banderas"]
    entry["personas"][0]["porcentaje_declarado"]["valor"] = 100.02
    assert "PORCENTAJES_NO_SUMAN_100" in rules.evaluate(entry)["banderas"]


def test_partial_vulnerable_case_uses_partial_explanation_and_both_review_reasons():
    entry = deepcopy(CASES["SINT-G01"]["entrada"])
    entry["obligaciones"].append(
        deepcopy(CASES["SINT-G28"]["entrada"]["obligaciones"][0])
    )
    entry["vulnerabilidad"] = {"estado": "OBSERVADO", "valor": "INDICIO_VULNERABILIDAD"}
    result = rules.evaluate(entry)
    assert result["intervencion"]["regla"] == "R4"
    assert result["intervencion"]["intensidad"] == 1
    assert result["revision"]["motivos"] == [
        "INDICIO_VULNERABILIDAD",
        "SEVERIDAD_PARCIAL",
    ]
    assert "la severidad puede ser mayor" in result["explicacion"]["frase_contrastiva"]
