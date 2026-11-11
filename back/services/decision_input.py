"""Adaptador del esquema actual al contrato v1, sin usar agregados heredados."""

from collections.abc import Mapping
from decimal import Decimal, InvalidOperation
from typing import Any

from services.decision_rules_v1 import parse_date
from services.paginated_reader import row_id


def presence(value: Any = None, state: str = "OBSERVADO") -> dict[str, Any]:
    return {"estado": state, "valor": value}


def _field(row: dict[str, Any], key: str, kind: str) -> dict[str, Any]:
    if key not in row:
        return presence(state="NO_INTEGRADO")
    value = row[key]
    if value is None or (isinstance(value, str) and not value.strip()):
        return presence(state="NO_INFORMADO_EN_ORIGEN")
    try:
        if kind == "date":
            return presence(parse_date(value).isoformat())
        if isinstance(value, bool):
            raise TypeError("No es un número")
        number = Decimal(str(value))
        if not number.is_finite() or (
            kind == "money" and number * 100 != (number * 100).to_integral_value()
        ):
            raise ValueError("Número fuera del contrato")
        return presence(number)
    except (ValueError, TypeError, InvalidOperation):
        return presence(state="INVALIDO")


def _person_type(
    person: dict[str, Any], catalog: dict[int, dict[str, Any]]
) -> dict[str, Any]:
    if "type" not in person:
        return presence(state="NO_INTEGRADO")
    if person["type"] is None:
        return presence(state="NO_INFORMADO_EN_ORIGEN")
    try:
        definition = catalog.get(row_id(person["type"]), {})
    except ValueError:
        return presence(state="INVALIDO")
    # Homologación de claves de catálogo, nunca inferencia por documento.
    value = {
        "FISICA": "FISICA",
        "JURIDICA": "JURIDICA",
        "INDIVIDUAL": "FISICA",
        "LEGAL_PERSON": "JURIDICA",
        "UNKNOWN": "UNKNOWN",
    }.get(str(definition.get("key", "")).upper())
    return presence(value) if value is not None else presence(state="INVALIDO")


def _debt_status(row: dict[str, Any], catalog: Mapping[int, dict[str, Any]]) -> dict[str, Any]:
    """Clave de debt_status (reglas 1.1.0, obligaciones_pagadas), sin interpretarla.

    Solo PAID observado excluye la obligación; ausente, inválido o UNKNOWN se computa igual.
    """
    if "status" not in row:
        return presence(state="NO_INTEGRADO")
    if row["status"] is None:
        return presence(state="NO_INFORMADO_EN_ORIGEN")
    try:
        definition = catalog.get(row_id(row["status"]))
    except ValueError:
        return presence(state="INVALIDO")
    if definition is None:
        return presence(state="INVALIDO")
    key = definition.get("key")
    if not isinstance(key, str) or not key:
        return presence(state="NO_INTEGRADO")
    return presence(state="NO_INFORMADO_EN_ORIGEN") if key.upper() == "UNKNOWN" else presence(key)


def build_decision_input(
    debtor: dict[str, Any],
    obligations: list[dict[str, Any]],
    relations: list[dict[str, Any]],
    people: dict[int, dict[str, Any]],
    contacts: list[dict[str, Any]],
    person_types: dict[int, dict[str, Any]],
    *,
    as_of: str,
    debt_statuses: Mapping[int, dict[str, Any]],
) -> dict[str, Any]:
    """Solo se llama después de completar todas las lecturas requeridas.

    DE02/DE10 y L05 no están integrados: period/status/issue_date no sustituyen
    período fiscal, estado de origen ni actualización del lote. AU01 no se infiere.
    debt.status solo alimenta estado_catalogo, con el catálogo debt_status ya leído
    completo: una lectura fallida del catálogo no llega acá (no se evalúa).
    """
    parse_date(as_of)
    active_relations = [
        relation for relation in relations if relation.get("active") is True
    ]
    person_ids = {int(relation["person"]) for relation in active_relations}
    contact_keys = set()
    for contact in contacts:
        if (
            contact.get("active") is not True
            or int(contact["person"]) not in person_ids
        ):
            continue
        value = str(contact.get("value") or "").strip()
        if not value:
            continue
        channel = str(contact.get("type") or ("Email" if "@" in value else "Telefono"))
        contact_keys.add((int(contact["person"]), channel.lower(), value.lower()))
    persons = []
    for relation in active_relations:
        person = people.get(int(relation["person"]), {})
        persons.append(
            {
                "tipo": _person_type(person, person_types),
                "porcentaje_declarado": _field(relation, "priority", "number"),
            }
        )
    return {
        "id": str(debtor["id"]),
        "as_of": as_of,
        "source_updated_at": presence(state="NO_INTEGRADO"),
        "obligaciones": [
            {
                "id": str(row["id"]),
                "current_amount": _field(
                    row,
                    "current_amount" if "current_amount" in row else "updated_amount",
                    "money",
                ),
                "due_date": _field(row, "due_date", "date"),
                "estado_origen": presence(state="NO_INTEGRADO"),
                "periodo_fiscal": presence(state="NO_INTEGRADO"),
                "estado_catalogo": _debt_status(row, debt_statuses),
            }
            for row in obligations
        ],
        "contactos_activos": presence(len(contact_keys)),
        "personas": persons,
        "vulnerabilidad": presence(state="NO_INFORMADO_EN_ORIGEN"),
    }
