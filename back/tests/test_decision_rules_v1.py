"""El mismo oráculo congelado que consume ALIGN-009, sin copias de resultados.

Un único evaluador reproduce el golden 1.0.0 con el contrato 1.0.0 y el golden 1.1.0
(versión activa) con el contrato 1.1.0.
"""

import json
import re
from copy import deepcopy
from pathlib import Path

import pytest

from services import decision_rules_v1 as rules

ROOT = Path(__file__).resolve().parents[2]
GOLDENS = {
    version: json.loads((ROOT / f"contracts/{name}").read_text(encoding="utf-8"))
    for version, name in (
        ("1.0.0", "decision-rules.v1.golden.json"),
        ("1.1.0", "decision-rules.v1.1.golden.json"),
    )
}
CONTRACTS = {version: rules.load_rules(version) for version in GOLDENS}
GOLDEN = GOLDENS[rules.RULES_VERSION]
CASES = {case["id"]: case for case in GOLDEN["casos"]}
SMALL = json.loads(
    (ROOT / "contracts/portfolio-small-cases.v1.json").read_text(encoding="utf-8")
)
VERSIONED_CASES = [
    (version, case) for version, golden in GOLDENS.items() for case in golden["casos"]
]


def _versioned_id(item):
    return f"{item[0]}/{item[1]['id']}"


@pytest.mark.parametrize("item", VERSIONED_CASES, ids=_versioned_id)
def test_complete_golden_output(item):
    version, case = item
    entry = deepcopy(case["entrada"])
    assert rules.evaluate(entry, CONTRACTS[version]) == case["esperado"]
    assert entry == case["entrada"]
    assert GOLDENS[version]["version_reglas"] == CONTRACTS[version]["version"]


def test_active_version_is_1_1_0_and_matches_typescript():
    assert rules.RULES_VERSION == "1.1.0" == rules.RULES["version"]
    assert rules.RULES_PATH.name == "decision-rules.v1.1.json"
    source = (ROOT / "front/lib/domain/decision-rules-v1.ts").read_text(encoding="utf-8")
    assert re.findall(r"export const RULES_VERSION = '([0-9.]+)'", source) == [
        rules.RULES_VERSION
    ]
    with pytest.raises(ValueError, match="desconocida"):
        rules.load_rules("9.9.9")


def test_1_1_0_golden_keeps_the_1_0_0_results_for_cases_without_paid():
    old = {case["id"]: case for case in GOLDENS["1.0.0"]["casos"]}
    for case in GOLDENS["1.1.0"]["casos"]:
        if case["id"] not in old:
            continue
        expected = deepcopy(case["esperado"])
        assert expected["severidad"].pop("obligaciones_pagadas") == 0
        assert expected == old[case["id"]]["esperado"]
        # 1.0.0 ignora estado_catalogo: la misma entrada da el resultado histórico.
        assert rules.evaluate(case["entrada"], CONTRACTS["1.0.0"]) == expected


@pytest.mark.parametrize(
    "item",
    [
        (version, pair)
        for version, golden in GOLDENS.items()
        for pair in golden["pares_contrafactuales"]
    ],
    ids=lambda item: f"{item[0]}/{item[1]['base']}/{item[1]['variante']}",
)
def test_counterfactual_properties(item):
    version, pair = item
    cases = {case["id"]: case for case in GOLDENS[version]["casos"]}
    base = rules.evaluate(cases[pair["base"]]["entrada"], CONTRACTS[version])
    variant = rules.evaluate(cases[pair["variante"]]["entrada"], CONTRACTS[version])
    if pair["propiedad"] == "pagadas_no_alteran_la_decision":
        assert variant["severidad"].pop("obligaciones_pagadas") > 0
        base["severidad"].pop("obligaciones_pagadas")
        assert variant == base
        return
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
    "item",
    [
        (version, ordering)
        for version, golden in GOLDENS.items()
        for ordering in golden["ordenamientos"]
    ],
    ids=lambda item: f"{item[0]}/{item[1]['cola']}",
)
def test_queue_ordering(item):
    version, ordering = item
    evaluated = [
        (case["id"], rules.evaluate(case["entrada"], CONTRACTS[version]))
        for case in reversed(GOLDENS[version]["casos"])
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


@pytest.mark.parametrize("item", VERSIONED_CASES, ids=_versioned_id)
def test_safety_invariants(item):
    version, case = item
    decision = rules.evaluate(case["entrada"], CONTRACTS[version])
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


def _paid_entry(status, amount=None, due=None):
    entry = deepcopy(CASES["SINT-G01"]["entrada"])
    entry["obligaciones"] = [
        {
            "id": "SINT-PAGO",
            "current_amount": {"estado": "OBSERVADO", "valor": amount}
            if amount is not None
            else {"estado": "NO_INFORMADO_EN_ORIGEN", "valor": None},
            "due_date": {"estado": "OBSERVADO", "valor": due}
            if due is not None
            else {"estado": "NO_INFORMADO_EN_ORIGEN", "valor": None},
            "estado_origen": {"estado": "NO_INTEGRADO", "valor": None},
            "periodo_fiscal": {"estado": "NO_INTEGRADO", "valor": None},
            "estado_catalogo": status,
        }
    ]
    return entry


@pytest.mark.parametrize(
    "status",
    [
        {"estado": "OBSERVADO", "valor": "paid"},
        {"estado": "OBSERVADO", "valor": " PAID"},
        {"estado": "OBSERVADO", "valor": "Pagada"},
        {"estado": "OBSERVADO", "valor": "SUSPENDED"},
        {"estado": "NO_INTEGRADO", "valor": None},
        {"estado": "INVALIDO", "valor": None},
        {"estado": "NO_INFORMADO_EN_ORIGEN", "valor": None},
    ],
    ids=lambda status: f"{status['estado']}:{status['valor']}",
)
def test_only_the_exact_observed_paid_key_excludes_an_obligation(status):
    result = rules.evaluate(_paid_entry(status, 1000, "2026-01-01"))
    assert result["severidad"]["obligaciones_pagadas"] == 0
    assert result["severidad"]["cantidad_vencidas"] == 1
    assert result["severidad"]["monto_actualizado_ars"] == 1000


def test_missing_catalog_field_is_not_paid_and_1_0_0_has_no_paid_count():
    entry = _paid_entry({"estado": "OBSERVADO", "valor": "PAID"}, 1000, "2026-01-01")
    del entry["obligaciones"][0]["estado_catalogo"]
    assert rules.evaluate(entry)["severidad"]["cantidad_vencidas"] == 1
    paid = _paid_entry({"estado": "OBSERVADO", "valor": "PAID"}, 1000, "2026-01-01")
    assert rules.evaluate(paid)["severidad"]["cantidad_vencidas"] == 0
    old = rules.evaluate(paid, CONTRACTS["1.0.0"])["severidad"]
    assert old["cantidad_vencidas"] == 1 and "obligaciones_pagadas" not in old


@pytest.mark.parametrize(
    "status",
    [None, {"estado": "OBSERVADO", "valor": None}, {"estado": "OBSERVADO", "valor": 6}],
)
def test_rejects_malformed_catalog_state(status):
    with pytest.raises((ValueError, TypeError)):
        rules.evaluate(_paid_entry(status, 1000, "2026-01-01"))


def test_paid_without_amount_or_due_date_is_neither_partial_nor_inconsistent():
    entry = _paid_entry({"estado": "OBSERVADO", "valor": "PAID"})
    entry["obligaciones"].append(
        _paid_entry({"estado": "OBSERVADO", "valor": "PAID"}, -5, "1969-12-31")[
            "obligaciones"
        ][0]
    )
    result = rules.evaluate(entry)
    assert result["severidad"]["estado"] == "COMPLETA"
    assert result["severidad"]["obligaciones_pagadas"] == 2
    assert result["severidad"]["motivos_no_evaluables"] == []
    assert result["banderas"] == []
    assert result["intervencion"]["regla"] == "R7"


def _small_case_entry(case):
    catalog = {row["id"]: row["key"] for row in SMALL["catalogo_debt_status"]}
    missing = {"estado": "NO_INFORMADO_EN_ORIGEN", "valor": None}

    def datum(value):
        return missing if value is None else {"estado": "OBSERVADO", "valor": value}

    def status(identifier):
        if identifier is None:
            return missing
        if identifier not in catalog:
            return {"estado": "INVALIDO", "valor": None}
        return datum(catalog[identifier])

    holders = case["titulares"]
    return {
        "id": case["objeto"]["identificador"],
        "as_of": SMALL["fecha_cartera"],
        "source_updated_at": {"estado": "NO_INTEGRADO", "valor": None},
        "obligaciones": [
            {
                "id": str(item["id"]),
                "current_amount": datum(item["importe"]),
                "due_date": datum(item["vencimiento"]),
                "estado_origen": {"estado": "NO_INTEGRADO", "valor": None},
                "periodo_fiscal": {"estado": "NO_INTEGRADO", "valor": None},
                "estado_catalogo": status(item["estado_id"]),
            }
            for item in case["obligaciones"]
        ],
        "contactos_activos": datum(
            sum(len(holder["contactos"]) for holder in holders)
        ),
        "personas": [
            {
                "tipo": {"estado": "OBSERVADO", "valor": "FISICA"},
                "porcentaje_declarado": datum(holder["porcentaje"]),
            }
            for holder in holders
        ],
        "vulnerabilidad": {"estado": "NO_INFORMADO_EN_ORIGEN", "valor": None},
    }


@pytest.mark.parametrize("case", SMALL["casos"], ids=lambda case: case["id"])
def test_small_cases_give_the_hand_computed_numbers(case):
    expected = case["esperado"]
    result = rules.evaluate(_small_case_entry(case))
    severity = result["severidad"]
    assert severity["valor"] == expected["puntaje"]
    assert severity["banda"] == expected["banda"]
    assert severity["estado"] == expected["estado_severidad"]
    assert severity["monto_actualizado_ars"] == expected["monto_evaluable"]
    assert severity["cantidad_vencidas"] == expected["obligaciones_vencidas"]
    assert severity["dias_atraso_maximo"] == expected["atraso_maximo_dias"]["valor"]
    assert severity["obligaciones_pagadas"] == expected["obligaciones_pagadas"]
    assert severity["obligaciones_no_evaluables"] == expected["obligaciones_no_evaluables"]
    assert result["intervencion"]["codigo"] == expected["intervencion"]
    assert result["intervencion"]["regla"] == expected["regla"]
    assert result["intervencion"]["intensidad"] == expected["intensidad"]
    assert rules.RULES["intervenciones"][expected["intervencion"]]["cola"] == expected["grupo"]
    golden = CASES[case["golden"]]["esperado"]
    assert severity == golden["severidad"]
    assert result["intervencion"] == golden["intervencion"]


def test_a_rules_file_declaring_another_version_is_rejected(monkeypatch):
    monkeypatch.setitem(rules.RULES_FILES, "1.1.0", rules.RULES_FILES["1.0.0"])
    with pytest.raises(ValueError, match="declara 1.0.0"):
        rules.load_rules("1.1.0")
