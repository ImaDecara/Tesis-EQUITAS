from typing import Any, cast
import argparse

from ETL.config import supabase


# ============================================================
# DEFINICIÓN DE GRUPOS PARA DASHBOARD
# ============================================================

# Estos grupos son calculados dinámicamente desde debtor_profile.
# No se guardan en Supabase para mantener simple el MVP.
GROUP_DEFINITIONS: dict[str, dict[str, str]] = {
    "critical_no_contact": {
        "label": "Crítico sin contacto disponible",
        "description": "Casos críticos donde primero se debe validar o conseguir contacto.",
        "recommended_action": (
            "Priorizar búsqueda, validación o actualización de datos de contacto "
            "antes de iniciar gestión intensiva."
        ),
    },
    "critical_contactable": {
        "label": "Crítico con contacto disponible",
        "description": "Casos críticos que ya tienen al menos un contacto disponible.",
        "recommended_action": (
            "Iniciar contacto inmediato y ofrecer alternativa de regularización."
        ),
    },
    "high_overdue_volume": {
        "label": "Alto riesgo con muchas deudas vencidas",
        "description": "Casos de riesgo alto con volumen importante de obligaciones vencidas.",
        "recommended_action": (
            "Priorizar gestión por volumen de deuda vencida y evaluar plan de pago."
        ),
    },
    "high_recovery_priority": {
        "label": "Alta prioridad de recupero",
        "description": "Casos de riesgo alto que conviene incluir en gestión prioritaria.",
        "recommended_action": "Incluir en lote prioritario de recupero.",
    },
    "medium_recovery": {
        "label": "Riesgo medio para regularización",
        "description": "Casos aptos para campañas generales de regularización.",
        "recommended_action": (
            "Incluir en campaña de regularización o recordatorio preventivo."
        ),
    },
    "low_monitoring": {
        "label": "Riesgo bajo para seguimiento preventivo",
        "description": "Casos de bajo riesgo que no requieren gestión intensiva inmediata.",
        "recommended_action": (
            "Mantener seguimiento preventivo sin priorización intensiva."
        ),
    },
}


# ============================================================
# FUNCIONES AUXILIARES
# ============================================================

# Convierte un valor a entero de forma segura.
def to_int(value: Any, default: int = 0) -> int:
    try:
        if value is None:
            return default

        return int(float(value))
    except (TypeError, ValueError):
        return default


# Convierte un valor a decimal de forma segura.
def to_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default

        return float(value)
    except (TypeError, ValueError):
        return default


# Limita un puntaje entre un mínimo y un máximo.
def clamp_score(value: float, minimum: int = 0, maximum: int = 100) -> int:
    return int(max(minimum, min(round(value), maximum)))


# Convierte la respuesta genérica de Supabase a list[dict[str, Any]].
# Esto evita errores de tipado en Pylance/Pyright.
def cast_response_rows(data: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []

    if not data:
        return rows

    for item in data:
        if isinstance(item, dict):
            rows.append(cast(dict[str, Any], item))

    return rows


# ============================================================
# CLASIFICACIÓN DE RIESGO
# ============================================================

# Clasifica el riesgo porcentual en una banda legible.
def classify_risk_band(risk_score: int) -> str:
    if risk_score >= 75:
        return "critical"

    if risk_score >= 50:
        return "high"

    if risk_score >= 25:
        return "medium"

    return "low"


# Devuelve una etiqueta legible para la banda de riesgo.
def get_risk_band_label(risk_band: str) -> str:
    labels = {
        "critical": "Riesgo crítico",
        "high": "Riesgo alto",
        "medium": "Riesgo medio",
        "low": "Riesgo bajo",
    }

    return labels.get(risk_band, "Riesgo no clasificado")


# ============================================================
# SCORE OPERATIVO
# ============================================================

# Calcula un score operativo para ordenar casos dentro del dashboard.
# Parte del riesgo porcentual del objeto y suma ajustes por complejidad operativa.
def calculate_priority_score(profile: dict[str, Any]) -> int:
    risk_score = to_int(profile.get("socioeconomic_risk_level"))

    available_contact_count = to_int(profile.get("available_contact_count"))
    overdue_debt_count = to_int(profile.get("overdue_debt_count"))
    oldest_debt_days = to_int(profile.get("oldest_debt_days"))
    active_person_count = to_int(profile.get("active_person_count"))

    score = risk_score

    # Sin contactos disponibles: más difícil de gestionar.
    if available_contact_count == 0:
        score += 10
    elif available_contact_count == 1:
        score += 3

    # Muchas deudas vencidas: mayor complejidad.
    if overdue_debt_count >= 10:
        score += 5

    # Deuda muy antigua: mayor urgencia de gestión.
    if oldest_debt_days >= 365:
        score += 5

    # Más de una persona asociada: puede requerir análisis adicional.
    if active_person_count > 1:
        score += 5

    return clamp_score(score)


# ============================================================
# TAGS DEL CASO
# ============================================================

# Genera etiquetas auxiliares para explicar el caso.
def build_case_tags(profile: dict[str, Any]) -> list[str]:
    tags: list[str] = []

    risk_score = to_int(profile.get("socioeconomic_risk_level"))
    available_contact_count = to_int(profile.get("available_contact_count"))
    overdue_debt_count = to_int(profile.get("overdue_debt_count"))
    oldest_debt_days = to_int(profile.get("oldest_debt_days"))
    active_person_count = to_int(profile.get("active_person_count"))
    overdue_debt_amount = to_float(profile.get("overdue_debt_amount"))

    risk_band = classify_risk_band(risk_score)

    tags.append(f"{risk_band}_risk")

    if available_contact_count == 0:
        tags.append("no_contact")
        tags.append("data_quality_issue")
    else:
        tags.append("contactable")

    if active_person_count > 1:
        tags.append("multi_person_case")

    if overdue_debt_count >= 10:
        tags.append("many_overdue_debts")

    if oldest_debt_days >= 365:
        tags.append("old_debt")

    if overdue_debt_amount > 0:
        tags.append("has_overdue_amount")

    return tags


# ============================================================
# AGRUPACIÓN PRINCIPAL DEL CASO
# ============================================================

# Asigna el grupo principal del caso según riesgo y gestionabilidad.
def assign_case_group(profile: dict[str, Any]) -> str:
    risk_score = to_int(profile.get("socioeconomic_risk_level"))
    available_contact_count = to_int(profile.get("available_contact_count"))
    overdue_debt_count = to_int(profile.get("overdue_debt_count"))

    if risk_score >= 75 and available_contact_count == 0:
        return "critical_no_contact"

    if risk_score >= 75 and available_contact_count > 0:
        return "critical_contactable"

    if risk_score >= 50 and overdue_debt_count >= 10:
        return "high_overdue_volume"

    if risk_score >= 50:
        return "high_recovery_priority"

    if risk_score >= 25:
        return "medium_recovery"

    return "low_monitoring"


# ============================================================
# ARMADO DEL CASO PARA EL DASHBOARD
# ============================================================

# Construye el resultado completo de scoring y agrupación para un debtor_profile.
# Puede recibir datos del debtor para mostrar cuenta, identificador y descripción en el frontend.
def build_case_scoring(
    profile: dict[str, Any],
    debtor: dict[str, Any] | None = None,
) -> dict[str, Any]:
    risk_score = to_int(profile.get("socioeconomic_risk_level"))
    risk_band = classify_risk_band(risk_score)
    group_key = assign_case_group(profile)
    group_definition = GROUP_DEFINITIONS[group_key]

    debtor = debtor or {}

    return {
        "debtor_profile_id": profile.get("id"),
        "debtor_id": profile.get("debtor"),
        "debtor_external_id": debtor.get("external_id"),
        "debtor_type": debtor.get("type"),
        "debtor_identifier": debtor.get("identifier"),
        "debtor_description": debtor.get("description"),
        "socioeconomic_risk_level": risk_score,
        "risk_band": risk_band,
        "risk_band_label": get_risk_band_label(risk_band),
        "priority_score": calculate_priority_score(profile),
        "group_key": group_key,
        "group_label": group_definition["label"],
        "group_description": group_definition["description"],
        "recommended_action": group_definition["recommended_action"],
        "tags": build_case_tags(profile),
        "total_debt_amount": to_float(profile.get("total_debt_amount")),
        "overdue_debt_amount": to_float(profile.get("overdue_debt_amount")),
        "debt_count": to_int(profile.get("debt_count")),
        "overdue_debt_count": to_int(profile.get("overdue_debt_count")),
        "oldest_debt_days": to_int(profile.get("oldest_debt_days")),
        "average_debt_age_days": to_int(profile.get("average_debt_age_days")),
        "active_person_count": to_int(profile.get("active_person_count")),
        "available_contact_count": to_int(profile.get("available_contact_count")),
    }


# ============================================================
# LECTURA DESDE SUPABASE
# ============================================================

# Trae perfiles calculados desde Supabase.
def fetch_debtor_profiles() -> list[dict[str, Any]]:
    response = (
        supabase
        .table("debtor_profile")
        .select(
            "id,"
            "debtor,"
            "total_debt_amount,"
            "overdue_debt_amount,"
            "debt_count,"
            "overdue_debt_count,"
            "oldest_debt_days,"
            "average_debt_age_days,"
            "active_person_count,"
            "available_contact_count,"
            "socioeconomic_risk_level,"
            "active"
        )
        .eq("active", True)
        .execute()
    )

    return cast_response_rows(response.data)


# Trae objetos debtor por lote para enriquecer la respuesta al frontend.
def fetch_debtors_by_ids(debtor_ids: list[int]) -> dict[int, dict[str, Any]]:
    if not debtor_ids:
        return {}

    rows: list[dict[str, Any]] = []
    chunk_size = 200

    for start in range(0, len(debtor_ids), chunk_size):
        chunk = debtor_ids[start:start + chunk_size]

        response = (
            supabase
            .table("debtor")
            .select(
                "id,"
                "tenant,"
                "external_id,"
                "type,"
                "identifier,"
                "description,"
                "status"
            )
            .in_("id", chunk)
            .execute()
        )

        rows.extend(cast_response_rows(response.data))

    return {
        int(row["id"]): row
        for row in rows
        if row.get("id") is not None
    }


# ============================================================
# QUERY DE CASOS PARA FRONTEND
# ============================================================

# Construye todos los casos agrupados dinámicamente desde debtor_profile.
def build_all_case_groups() -> list[dict[str, Any]]:
    profiles = fetch_debtor_profiles()

    debtor_ids = [
        int(profile["debtor"])
        for profile in profiles
        if profile.get("debtor") is not None
    ]

    debtors_by_id = fetch_debtors_by_ids(debtor_ids)

    cases = [
        build_case_scoring(
            profile=profile,
            debtor=debtors_by_id.get(int(profile["debtor"])),
        )
        for profile in profiles
        if profile.get("debtor") is not None
    ]

    cases.sort(
        key=lambda item: (
            int(item["priority_score"]),
            int(item["socioeconomic_risk_level"]),
            float(item["total_debt_amount"]),
        ),
        reverse=True,
    )

    return cases


# Aplica filtros de grupo, banda, tag o búsqueda textual.
def filter_case_groups(
    cases: list[dict[str, Any]],
    group_key: str | None = None,
    risk_band: str | None = None,
    tag: str | None = None,
    search: str | None = None,
) -> list[dict[str, Any]]:
    filtered = cases

    if group_key:
        filtered = [
            case for case in filtered
            if case["group_key"] == group_key
        ]

    if risk_band:
        filtered = [
            case for case in filtered
            if case["risk_band"] == risk_band
        ]

    if tag:
        filtered = [
            case for case in filtered
            if tag in case["tags"]
        ]

    if search:
        normalized_search = search.lower().strip()

        filtered = [
            case for case in filtered
            if normalized_search in str(case.get("debtor_external_id", "")).lower()
            or normalized_search in str(case.get("debtor_identifier", "")).lower()
            or normalized_search in str(case.get("debtor_description", "")).lower()
        ]

    return filtered


# Devuelve casos agrupados paginados para el frontend.
def get_case_groups(
    group_key: str | None = None,
    risk_band: str | None = None,
    tag: str | None = None,
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    cases = build_all_case_groups()

    filtered_cases = filter_case_groups(
        cases=cases,
        group_key=group_key,
        risk_band=risk_band,
        tag=tag,
        search=search,
    )

    total = len(filtered_cases)
    paginated_items = filtered_cases[offset:offset + limit]

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": paginated_items,
    }


# ============================================================
# SUMMARY PARA DASHBOARD
# ============================================================

# Devuelve resumen de grupos para tarjetas del dashboard.
def get_case_groups_summary() -> dict[str, Any]:
    cases = build_all_case_groups()

    group_counts: dict[str, int] = {
        group_key: 0
        for group_key in GROUP_DEFINITIONS.keys()
    }

    risk_band_counts: dict[str, int] = {
        "critical": 0,
        "high": 0,
        "medium": 0,
        "low": 0,
    }

    contact_counts: dict[str, int] = {
        "without_contact": 0,
        "with_contact": 0,
    }

    for case in cases:
        group_counts[str(case["group_key"])] += 1
        risk_band_counts[str(case["risk_band"])] += 1

        if int(case["available_contact_count"]) == 0:
            contact_counts["without_contact"] += 1
        else:
            contact_counts["with_contact"] += 1

    groups = []

    for group_key, definition in GROUP_DEFINITIONS.items():
        groups.append(
            {
                "group_key": group_key,
                "group_label": definition["label"],
                "description": definition["description"],
                "recommended_action": definition["recommended_action"],
                "total": group_counts[group_key],
            }
        )

    return {
        "total_cases": len(cases),
        "groups": groups,
        "risk_bands": risk_band_counts,
        "contacts": contact_counts,
    }


# ============================================================
# PREVIEW POR CONSOLA
# ============================================================

# Imprime un resumen simple para validar la agrupación.
def print_case_groups_preview(case_groups: list[dict[str, Any]]) -> None:
    print("SCORING / CASE GROUPING PREVIEW")
    print("-" * 80)
    print(f"Casos procesados: {len(case_groups)}")
    print()

    group_counts: dict[str, int] = {}

    for case in case_groups:
        group_key = str(case["group_key"])
        group_counts[group_key] = group_counts.get(group_key, 0) + 1

    print("Distribución por grupo:")
    for group_key, count in sorted(group_counts.items()):
        print(f"- {group_key}: {count}")

    print()
    print("Primeros casos:")
    print("-" * 80)

    for case in case_groups[:10]:
        print(
            f"debtor={case['debtor_id']} | "
            f"risk={case['socioeconomic_risk_level']}% | "
            f"priority={case['priority_score']} | "
            f"group={case['group_key']} | "
            f"contacts={case['available_contact_count']} | "
            f"overdue_count={case['overdue_debt_count']}"
        )


# ============================================================
# ENTRYPOINT CLI
# ============================================================

# Permite ejecutar el servicio desde consola.
def main() -> None:
    parser = argparse.ArgumentParser(
        description="Calcula scoring operativo y agrupación de casos desde debtor_profile."
    )

    parser.add_argument(
        "--limit",
        type=int,
        default=50,
        help="Cantidad máxima de perfiles a mostrar para preview.",
    )

    args = parser.parse_args()

    all_cases = build_all_case_groups()
    preview_cases = all_cases[:args.limit]

    print_case_groups_preview(preview_cases)


if __name__ == "__main__":
    main()
