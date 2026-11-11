"""Reglas v1 puras, sin reloj, base de datos ni dependencias de la API.

El JSON versionado es la fuente de parámetros y textos. ``evaluate`` devuelve
exactamente la estructura del oráculo; el consumidor adjunta RULES_VERSION,
el identificador y el corte. Una lectura fallida nunca debe llegar como [].
Un mismo código evalúa cada versión del contrato: la activa por defecto y las
anteriores para reproducir decisiones registradas con ellas.
"""

from __future__ import annotations

import json
from collections import Counter
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"
RULES_FILES = {
    "1.0.0": CONTRACTS / "decision-rules.v1.json",
    "1.1.0": CONTRACTS / "decision-rules.v1.1.json",
}
# Versión ACTIVA: única por lenguaje; debe coincidir con front/lib/domain/decision-rules-v1.ts.
RULES_VERSION: str = "1.1.0"


def load_rules(version: str) -> dict[str, Any]:
    if version not in RULES_FILES:
        raise ValueError(f"Versión de reglas desconocida: {version}")
    contract = json.loads(RULES_FILES[version].read_text(encoding="utf-8"))
    if contract["version"] != version:
        raise ValueError(f"El archivo de reglas {version} declara {contract['version']}")
    return contract


RULES_PATH = RULES_FILES[RULES_VERSION]
RULES = load_rules(RULES_VERSION)


def parse_date(value: Any) -> date:
    """Exige fecha ISO sin hora; no depende del huso horario del proceso."""
    if not isinstance(value, str):
        raise TypeError("Se requiere una fecha ISO YYYY-MM-DD")
    parsed = date.fromisoformat(value)
    if parsed.isoformat() != value:
        raise ValueError("Se requiere una fecha ISO YYYY-MM-DD")
    return parsed


def _decimal(value: Any) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        raise TypeError("Se requiere un número finito")
    number = Decimal(str(value))
    if not number.is_finite():
        raise ValueError("Se requiere un número finito")
    return number


def cents(value: Any) -> int:
    """Sumas y comparaciones monetarias en centavos enteros (contrato v1)."""
    return int((_decimal(value) * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _observed(datum: dict[str, Any], rules: dict[str, Any] = RULES) -> Any:
    if (
        not isinstance(datum, dict)
        or datum.get("estado") not in rules["estados_de_presencia"]
    ):
        raise ValueError("Estado de presencia inválido")
    if datum["estado"] == "OBSERVADO":
        if datum.get("valor") is None:
            raise ValueError("OBSERVADO requiere un valor")
        return datum["valor"]
    if datum.get("valor") is not None:
        raise ValueError("Un dato no observado debe tener valor null")
    return None


def is_paid(obligation: dict[str, Any], rules: dict[str, Any] = RULES) -> bool:
    """obligaciones_pagadas (1.1.0): estado_catalogo OBSERVADO igual a la clave.

    Ausente, no observado o con otra clave: no es pagada. 1.0.0 no distingue estados.
    """
    paid = rules.get("obligaciones_pagadas")
    if not paid or "estado_catalogo" not in obligation:
        return False
    key = _observed(obligation["estado_catalogo"], rules)
    if key is not None and not isinstance(key, str):
        raise TypeError("estado_catalogo debe ser una clave de texto")
    return key == paid["clave_catalogo"]


def _unpaid(entry: dict[str, Any], rules: dict[str, Any]) -> list[dict[str, Any]]:
    return [item for item in entry["obligaciones"] if not is_paid(item, rules)]


def _band(value: int | Decimal, bands: list[dict[str, Any]], key: str) -> Any:
    return next(
        band[key] for band in reversed(bands) if value >= Decimal(str(band["desde"]))
    )


def _obligations(
    entry: dict[str, Any], as_of: date, rules: dict[str, Any]
) -> dict[str, Any]:
    minimum = parse_date(rules["evaluabilidad"]["fecha_minima_plausible"])
    evaluable: list[tuple[int, date]] = []
    reasons: Counter[tuple[str, str]] = Counter()
    inconsistent = False
    obligations = _unpaid(entry, rules)
    for obligation in obligations:
        amount = _observed(obligation["current_amount"], rules)
        due_value = _observed(obligation["due_date"], rules)
        due = parse_date(due_value) if due_value is not None else None
        valid = True
        if amount is None:
            reasons["IMPORTE_NO_OBSERVADO", obligation["current_amount"]["estado"]] += 1
            valid = False
        elif _decimal(amount) < 0:
            reasons["IMPORTE_NEGATIVO", "OBSERVADO"] += 1
            valid = False
        if due is None:
            reasons["VENCIMIENTO_NO_OBSERVADO", obligation["due_date"]["estado"]] += 1
            valid = False
        elif due < minimum:
            reasons["VENCIMIENTO_INCONSISTENTE", "OBSERVADO"] += 1
            inconsistent = True
            valid = False
        if valid:
            evaluable.append((cents(amount), due))
    missing = len(obligations) - len(evaluable)
    state = "COMPLETA" if not missing else "PARCIAL" if evaluable else "NO_DISPONIBLE"
    overdue = [(amount, due) for amount, due in evaluable if amount > 0 and due < as_of]
    result = {
        "estado": state,
        "monto_actualizado_ars": sum(amount for amount, _ in evaluable) / 100
        if evaluable or not missing
        else None,
        "dias_atraso_maximo": max(
            ((as_of - due).days for _, due in overdue), default=None
        ),
        "cantidad_vencidas": len(overdue) if state != "NO_DISPONIBLE" else None,
        "vencimiento_mas_antiguo": min(
            (due.isoformat() for _, due in overdue), default=None
        ),
        "obligaciones_no_evaluables": missing,
        "motivos_no_evaluables": [
            {
                "motivo": reason,
                "estado": presence,
                "cantidad": reasons[reason, presence],
            }
            for reason in rules["evaluabilidad"]["motivos_no_evaluable"]
            for presence in rules["estados_de_presencia"]
            if reasons[reason, presence]
        ],
        "fechas_inconsistentes": inconsistent,
    }
    if rules.get("obligaciones_pagadas"):
        result["obligaciones_pagadas"] = len(entry["obligaciones"]) - len(obligations)
    return result


def _severity(
    entry: dict[str, Any], as_of: date, rules: dict[str, Any]
) -> tuple[dict[str, Any], list[dict[str, Any]], bool]:
    severity = _obligations(entry, as_of, rules)
    inconsistent = severity.pop("fechas_inconsistentes")
    factors = []
    for name in rules["explicacion"]["factores"]:
        definition = rules["severidad"]["factores"][name]
        points = None
        if severity["estado"] != "NO_DISPONIBLE":
            # Con cero vencidas, todos aportan cero aunque el monto sea alto.
            value = severity[name] if severity["cantidad_vencidas"] else 0
            points = _band(_decimal(value), definition["bandas"], "puntos")
        factors.append(
            {
                "factor": name,
                "insumo": severity[name],
                "puntos": points,
                "maximo": definition["peso_maximo"],
            }
        )
    severity["valor"] = (
        None
        if severity["estado"] == "NO_DISPONIBLE"
        else sum(f["puntos"] for f in factors)
    )
    severity["banda"] = (
        rules["severidad"]["banda_sin_valor"]
        if severity["valor"] is None
        else _band(severity["valor"], rules["severidad"]["bandas"], "codigo")
    )
    return severity, factors, inconsistent


def _flags(
    entry: dict[str, Any],
    severity: dict[str, Any],
    inconsistent: bool,
    as_of: date,
    rules: dict[str, Any],
) -> list[str]:
    contacts = _observed(entry["contactos_activos"], rules)
    percentages = [
        _observed(person["porcentaje_declarado"], rules) for person in entry["personas"]
    ]
    types = [_observed(person["tipo"], rules) for person in entry["personas"]]
    updated = _observed(entry["source_updated_at"], rules)
    # Las banderas de obligación no miran las pagadas (1.1.0, obligaciones_pagadas).
    obligations = _unpaid(entry, rules)
    conditions = {
        "SIN_CONTACTO_ACTIVO": contacts is None or _decimal(contacts) < 1,
        "PORCENTAJES_NO_SUMAN_100": bool(percentages)
        and (
            any(value is None for value in percentages)
            or abs(sum((_decimal(value) for value in percentages), Decimal(0)) - 100)
            > Decimal(str(rules["banderas"]["tolerancia_porcentajes"]))
        ),
        "ESTADO_ORIGEN_NO_INFORMADO": any(
            _observed(o["estado_origen"], rules) is None for o in obligations
        ),
        "PERIODO_NO_INFORMADO": any(
            _observed(o["periodo_fiscal"], rules) is None for o in obligations
        ),
        "FECHAS_INCONSISTENTES": inconsistent
        or (updated is not None and parse_date(updated) > as_of),
        "TIPO_PERSONA_DESCONOCIDO": any(
            value is None or value == "UNKNOWN" for value in types
        ),
        "VERIFICAR_PRESCRIPCION": severity["dias_atraso_maximo"] is not None
        and severity["dias_atraso_maximo"]
        >= rules["banderas"]["verificar_prescripcion"]["umbral_dias_atraso"],
    }
    return [name for name in rules["banderas"]["orden"] if conditions[name]]


def _intervention(
    severity: dict[str, Any], flags: list[str], vulnerable: bool, rules: dict[str, Any]
) -> dict[str, Any]:
    conditions = {
        "SIN_CONTACTO_ACTIVO": "SIN_CONTACTO_ACTIVO" in flags,
        "severidad NO_DISPONIBLE": severity["estado"] == "NO_DISPONIBLE",
        "VERIFICAR_PRESCRIPCION": "VERIFICAR_PRESCRIPCION" in flags,
        "banda ALTA": severity["banda"] == "ALTA",
        "banda MEDIA": severity["banda"] == "MEDIA",
        "banda BAJA y severidad > 0": severity["banda"] == "BAJA"
        and severity["valor"] > 0,
        "severidad = 0": severity["valor"] == 0,
    }
    table = rules["reglas_intervencion"]["reglas"]
    rule = next(rule for rule in table if conditions[rule["condicion"]])
    code, intensity = rule["intervencion"], rule["intensidad"]
    modifier = None
    if vulnerable:
        modifier = rules["reglas_intervencion"]["modificador_vulnerabilidad"]["id"]
        intensity = min(
            intensity, rules["vulnerabilidad"]["tope_intensidad_con_indicio"]
        )
        # M1 está expresado en prosa en el JSON: documento §7, R4 pasa a R5.
        if rule["id"] == "R4":
            code = next(item["intervencion"] for item in table if item["id"] == "R5")
    return {
        "codigo": code,
        "intensidad": intensity,
        "canal_requerido": intensity >= 1,
        "regla": rule["id"],
        "modificador": modifier,
    }


def _explanation(
    severity: dict[str, Any],
    intervention: dict[str, Any],
    total: int,
    rules: dict[str, Any],
) -> str:
    config = rules["explicacion"]
    details = rules["evaluabilidad"]["detalle_no_evaluables"]
    labels = [
        details["etiquetas"][item["motivo"]].format(estado=item["estado"])
        + f": {item['cantidad']}"
        for item in severity["motivos_no_evaluables"]
    ]
    # El sufijo del campo texto describe cómo unir las entradas; no es texto visible.
    # Las pagadas no entran en las obligaciones leídas del texto (1.1.0).
    detail = (
        details["texto"]
        .split("; {etiqueta}")[0]
        .format(
            obligaciones_no_evaluables=severity["obligaciones_no_evaluables"],
            obligaciones_leidas=total - severity.get("obligaciones_pagadas", 0),
        )
    )
    if labels:
        detail += "; " + "; ".join(labels)
    thresholds = {
        band["codigo"]: band["desde"] for band in rules["severidad"]["bandas"]
    }
    values = {
        "severidad_texto": config["severidad_texto"][severity["estado"]].format(
            valor=severity["valor"]
        ),
        "umbral_alta": thresholds["ALTA"],
        "umbral_media": thresholds["MEDIA"],
        "umbral_prescripcion": rules["banderas"]["verificar_prescripcion"][
            "umbral_dias_atraso"
        ],
        "detalle_no_evaluables": detail,
    }
    key = (
        "M1"
        if intervention["modificador"] and intervention["regla"] == "R4"
        else intervention["regla"]
    )
    if severity["estado"] == "PARCIAL":
        template = (
            config["frases_contrastivas_parcial"][key]
            + " "
            + config["complemento_parcial"]
        )
    else:
        template = config["frases_contrastivas"][key]
    return template.format(**values)


def evaluate(entry: dict[str, Any], rules: dict[str, Any] | None = None) -> dict[str, Any]:
    """Evalúa un objeto normalizado, sin modificarlo. Corte obligatorio.

    Datos con estado OBSERVADO deben respetar el tipo del contrato. Entradas
    mal formadas se rechazan; el adaptador distingue INVALIDO de un cero real.
    ``rules`` es el contrato a aplicar (por defecto el activo, RULES).
    """
    rules = RULES if rules is None else rules
    as_of = parse_date(entry.get("as_of"))
    if (
        not isinstance(entry.get("id"), str)
        or not entry["id"]
        or not entry["id"].isascii()
    ):
        raise ValueError("El id debe ser texto ASCII no vacío")
    if not isinstance(entry.get("obligaciones"), list):
        raise TypeError("Las obligaciones deben ser una lectura completa (lista)")
    severity, factors, inconsistent = _severity(entry, as_of, rules)
    flags = _flags(entry, severity, inconsistent, as_of, rules)
    vulnerability = _observed(entry["vulnerabilidad"], rules)
    if (
        vulnerability is not None
        and vulnerability not in rules["entrada"]["valores_vulnerabilidad_observada"]
    ):
        raise ValueError("Valor de vulnerabilidad no reconocido")
    vulnerable = vulnerability == "INDICIO_VULNERABILIDAD"
    intervention = _intervention(severity, flags, vulnerable, rules)
    reasons = {
        "INDICIO_VULNERABILIDAD": vulnerable,
        "SEVERIDAD_PARCIAL": severity["estado"] == "PARCIAL",
    }
    review = [name for name in rules["revision"]["orden_motivos"] if reasons[name]]
    message_config = rules["mensajes_borrador"]
    message_key = intervention["codigo"]
    if message_key == "SEGUIMIENTO":
        message_key += f"_intensidad_{intervention['intensidad']}"
    message_id = message_config["seleccion"].get(message_key)
    return {
        "severidad": severity,
        "banderas": flags,
        "vulnerabilidad": {
            "valor": vulnerability or "NO_INFORMADA",
            "efecto": "TOPE_INTENSIDAD_1_Y_REVISION" if vulnerable else "NINGUNO",
        },
        "intervencion": intervention,
        "revision": {"requiere_revision_humana": bool(review), "motivos": review},
        "prioridad": {"cola": intervention["codigo"], "valor": severity["valor"]},
        "explicacion": {
            "factores": factors,
            "frase_contrastiva": _explanation(
                severity, intervention, len(entry["obligaciones"]), rules
            ),
        },
        "mensaje_borrador": {
            "plantilla_id": message_id,
            "estado": message_config["estado"],
        }
        if message_id
        else None,
    }


def priority_sort_key(identifier: str, decision: dict[str, Any]) -> tuple[Any, ...]:
    """Clave únicamente para casos de una misma cola; null siempre al final."""
    priority = decision["prioridad"]["valor"]
    amount = decision["severidad"]["monto_actualizado_ars"]
    oldest = decision["severidad"]["vencimiento_mas_antiguo"]
    return (
        priority is None,
        -priority if priority is not None else 0,
        amount is None,
        -cents(amount) if amount is not None else 0,
        oldest is None,
        oldest or "",
        identifier,
    )
