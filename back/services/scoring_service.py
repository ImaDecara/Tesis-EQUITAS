"""Servicio interno v1: cartera completa, corte explícito y colas por intervención.

La fórmula v0 (PY01–PY03) está archivada en el contrato y en git. No hay
fallback a sus agregados.

Cada función recibe el cliente de la solicitud, con el token del usuario, y el municipio
resuelto en el servidor (ALIGN-052). No existe un cliente global ni respaldo en la clave de
servicio general: sin sesión, no hay lectura. RLS acota a las membresías activas y el
filtro por `tenant` acota a una sola, porque un usuario puede tener más de una.
"""

import argparse
import os
import sys
from collections import defaultdict
from typing import Any

from services.decision_input import build_decision_input
from services.decision_rules_v1 import (
    RULES,
    RULES_VERSION,
    evaluate,
    parse_date,
    priority_sort_key,
)
from services.paginated_reader import (
    ID_CHUNK_SIZE,
    DataReadError,
    read_all_by_id,
    row_id,
)

GROUP_DEFINITIONS = RULES["intervenciones"]
DEBTOR_COLUMNS = "id,tenant,external_id,type,identifier,description,status"


def _read_for_ids(
    client: Any,
    table: str,
    columns: str,
    column: str,
    ids: list[int],
    *,
    active: bool = False,
) -> list[dict[str, Any]]:
    rows = []
    identifiers = sorted({row_id(identifier) for identifier in ids})
    for start in range(0, len(identifiers), ID_CHUNK_SIZE):
        chunk = identifiers[start : start + ID_CHUNK_SIZE]

        def query(chunk=chunk):
            result = client.table(table).select(columns).in_(column, chunk)
            return result.eq("active", True) if active else result

        rows.extend(read_all_by_id(table, query))
    return rows


def fetch_debtor_profiles(client: Any, debtor_ids: list[int]) -> list[dict[str, Any]]:
    """Metadatos únicamente: los valores persistidos v0 nunca alimentan v1."""
    return _read_for_ids(
        client, "debtor_profile", "id,debtor,active", "debtor", debtor_ids, active=True
    )


def fetch_debtors(client: Any, tenant: int) -> dict[int, dict[str, Any]]:
    """Toda la cartera del municipio. Una fila de otro invalida la lectura completa."""
    rows = read_all_by_id(
        "debtor",
        lambda: client.table("debtor").select(DEBTOR_COLUMNS).eq("tenant", tenant),
    )
    try:
        foreign = any(row_id(row["tenant"]) != tenant for row in rows)
    except (KeyError, TypeError, ValueError):
        raise DataReadError("debtor") from None
    if foreign:
        raise DataReadError("debtor")
    return {row_id(row["id"]): row for row in rows}


def build_case_scoring(
    entry: dict[str, Any],
    debtor: dict[str, Any] | None = None,
    profile_id: int | None = None,
) -> dict[str, Any]:
    """La decisión completa acompaña los campos de navegación del servicio."""
    decision = evaluate(entry)
    debtor = debtor or {}
    return {
        "debtor_id": row_id(entry["id"]),
        "debtor_profile_id": profile_id,
        "debtor_external_id": debtor.get("external_id"),
        "debtor_type": debtor.get("type"),
        "debtor_identifier": debtor.get("identifier"),
        "debtor_description": debtor.get("description"),
        "version_reglas": RULES_VERSION,
        "as_of": entry["as_of"],
        "procedencia_corte": "DECLARADO_POR_LLAMADOR; corte municipal no integrado",
        "decision": decision,
        "group_key": decision["intervencion"]["codigo"],
        "group_label": GROUP_DEFINITIONS[decision["intervencion"]["codigo"]]["cola"],
        "severity_band": decision["severidad"]["banda"],
        "priority_score": decision["prioridad"]["valor"],
        "tags": decision["banderas"],
        "available_contact_count": entry["contactos_activos"]["valor"],
    }


def _by_parent(
    rows: list[dict[str, Any]], key: str, table: str
) -> dict[int, list[dict[str, Any]]]:
    grouped: dict[int, list[dict[str, Any]]] = defaultdict(list)
    try:
        for row in rows:
            grouped[row_id(row[key])].append(row)
    except (KeyError, ValueError, TypeError):
        raise DataReadError(table) from None
    return grouped


def build_all_case_groups(client: Any, *, tenant: int, as_of: str) -> list[dict[str, Any]]:
    """Evalúa todos los objetos, también los que no tienen perfil persistido.

    Una lectura fallida aborta con READ_INCOMPLETE: jamás se convierte en cero
    obligaciones/contactos. Las consultas por id requieren un lote estable.
    """
    parse_date(as_of)
    debtors = fetch_debtors(client, tenant)
    if not debtors:
        return []
    debtor_ids = list(debtors)
    profiles = fetch_debtor_profiles(client, debtor_ids)
    obligations = _read_for_ids(
        client, "debt", "id,debtor,current_amount,due_date", "debtor", debtor_ids
    )
    relations = _read_for_ids(
        client,
        "debtor_person",
        "id,debtor,person,priority,active",
        "debtor",
        debtor_ids,
        active=True,
    )
    debts_by_object = _by_parent(obligations, "debtor", "debt")
    relations_by_object = _by_parent(relations, "debtor", "debtor_person")
    relations_by_person = _by_parent(relations, "person", "debtor_person")
    person_ids = list(relations_by_person)
    people = {
        row_id(row["id"]): row
        for row in _read_for_ids(client, "person", "id,type", "id", person_ids)
    }
    contacts = _read_for_ids(
        client,
        "debtor_contact",
        "id,person,type,value,active",
        "person",
        person_ids,
        active=True,
    )
    contacts_by_person = _by_parent(contacts, "person", "debtor_contact")
    person_types = (
        {
            row_id(row["id"]): row
            for row in read_all_by_id(
                "person_type", lambda: client.table("person_type").select("id,key")
            )
        }
        if person_ids
        else {}
    )
    profiles_by_object = _by_parent(profiles, "debtor", "debtor_profile")
    queues: dict[str, list[dict[str, Any]]] = {key: [] for key in GROUP_DEFINITIONS}
    for identifier, debtor in debtors.items():
        object_relations = relations_by_object[identifier]
        object_person_ids = {
            row_id(relation["person"]) for relation in object_relations
        }
        object_contacts = [
            contact
            for person in object_person_ids
            for contact in contacts_by_person[person]
        ]
        entry = build_decision_input(
            debtor,
            debts_by_object[identifier],
            object_relations,
            people,
            object_contacts,
            person_types,
            as_of=as_of,
        )
        object_profiles = profiles_by_object[identifier]
        # Si hay más de un perfil, solo se referencia el último id: no altera reglas.
        profile_id = max(
            (row_id(profile["id"]) for profile in object_profiles), default=None
        )
        case = build_case_scoring(entry, debtor, profile_id)
        queues[case["group_key"]].append(case)
    return [
        case
        for queue in queues.values()
        for case in sorted(
            queue,
            key=lambda item: priority_sort_key(
                str(item["debtor_id"]), item["decision"]
            ),
        )
    ]


def filter_case_groups(
    cases: list[dict[str, Any]],
    group_key: str | None = None,
    severity_band: str | None = None,
    tag: str | None = None,
    search: str | None = None,
) -> list[dict[str, Any]]:
    query = search.strip().lower() if search else ""
    return [
        case
        for case in cases
        if (not group_key or case["group_key"] == group_key)
        and (not severity_band or case["severity_band"] == severity_band)
        and (not tag or tag in case["tags"])
        and (
            not query
            or any(
                query in str(case.get(key) or "").lower()
                for key in (
                    "debtor_external_id",
                    "debtor_identifier",
                    "debtor_description",
                )
            )
        )
    ]


def get_case_groups(
    client: Any,
    *,
    tenant: int,
    as_of: str,
    group_key: str | None = None,
    severity_band: str | None = None,
    tag: str | None = None,
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    if limit < 1 or offset < 0:
        raise ValueError("Paginación inválida")
    cases = filter_case_groups(
        build_all_case_groups(client, tenant=tenant, as_of=as_of),
        group_key,
        severity_band,
        tag,
        search,
    )
    return {
        "version_reglas": RULES_VERSION,
        "as_of": as_of,
        "total": len(cases),
        "limit": limit,
        "offset": offset,
        "items": cases[offset : offset + limit],
    }


def get_case_groups_summary(client: Any, *, tenant: int, as_of: str) -> dict[str, Any]:
    cases = build_all_case_groups(client, tenant=tenant, as_of=as_of)
    counts = {key: 0 for key in GROUP_DEFINITIONS}
    bands = {band["codigo"]: 0 for band in RULES["severidad"]["bandas"]}
    bands[RULES["severidad"]["banda_sin_valor"]] = 0
    contacts = {"without_contact": 0, "with_contact": 0, "unavailable": 0}
    for case in cases:
        counts[case["group_key"]] += 1
        bands[case["severity_band"]] += 1
        available = case["available_contact_count"]
        contacts[
            "unavailable"
            if available is None
            else "with_contact"
            if available > 0
            else "without_contact"
        ] += 1
    return {
        "version_reglas": RULES_VERSION,
        "as_of": as_of,
        "total_cases": len(cases),
        "groups": [
            {"group_key": key, "group_label": definition["cola"], "total": counts[key]}
            for key, definition in GROUP_DEFINITIONS.items()
        ],
        "severity_bands": bands,
        "contacts": contacts,
    }


def print_case_groups_preview(cases: list[dict[str, Any]]) -> None:
    # Solo conteos: no expone identificadores municipales ni datos de personas.
    print(f"Reglas {RULES_VERSION} | Casos procesados: {len(cases)}")
    for key in GROUP_DEFINITIONS:
        print(f"{key}: {sum(case['group_key'] == key for case in cases)}")


def main() -> None:
    # Importación tardía: `api` depende de este módulo, y usarlo como CLI es lo infrecuente.
    from fastapi import HTTPException

    from api.auth import (
        READ_ROLES,
        data_client,
        resolve_tenant_context,
        session_for_token,
    )

    parser = argparse.ArgumentParser(
        description=(
            "Scoring v1 interno con la sesión de EQUITAS_SESSION_TOKEN; "
            "solo local sintético (ADR-001)."
        )
    )
    parser.add_argument(
        "--as-of",
        required=True,
        help="Corte declarado YYYY-MM-DD; no se sustituye por hoy.",
    )
    parser.add_argument("--limit", type=int, default=50)
    args = parser.parse_args()
    try:
        session = session_for_token(os.environ.get("EQUITAS_SESSION_TOKEN", ""))
        client = data_client(session.config, session.token)
        context = resolve_tenant_context(client, session)
        if context.role not in READ_ROLES:
            raise HTTPException(403, "ROLE_FORBIDDEN")
    except HTTPException as error:
        print(error.detail, file=sys.stderr)
        raise SystemExit(2) from None
    cases = build_all_case_groups(client, tenant=context.tenant_id, as_of=args.as_of)
    print_case_groups_preview(cases[: args.limit])


if __name__ == "__main__":
    main()
