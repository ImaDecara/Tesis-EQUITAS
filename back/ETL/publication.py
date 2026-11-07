"""Contrato interno de staging y confirmación; compartido por CLI y futuros consumidores.

No calcula previews con la RPC de perfiles: esa RPC también escribe debt.status.
El contenido normalizado no vuelve a enviarse al confirmar una revisión congelada.
"""

import copy
from collections import defaultdict
from collections.abc import Mapping
from typing import Any

import httpx

from ETL import load
from ETL.config import ETLError, get_import_credentials, get_settings
from ETL.transform import (
    PreparedBatch,
    batch_counts,
    build_address_payload,
    build_city_payload,
    build_debt_payload,
    build_debtor_contact_payloads,
    build_debtor_payload,
    build_debtor_person_payload,
    build_person_payload,
    build_province_payload,
    canonical_json_hash,
    parse_int,
    source_contract,
)
from services.decision_rules_v1 import RULES_VERSION

RPC_TIMEOUT = 120
STABLE_ERRORS = frozenset({
    "ACTOR_NOT_ACTIVE_MEMBER", "ROLE_NOT_ALLOWED", "BATCH_NOT_FOUND", "BATCH_NOT_VALIDATED",
    "IMPORT_INPUT_INVALID", "IMPORT_PUBLICATION_FAILED", "IMPORT_REVISION_CONFLICT", "IMPORT_RETRY_REQUIRED",
    "IMPORT_REVALIDATION_REQUIRED", "IDEMPOTENCY_KEY_CONFLICT", "SHARED_PERSON_OTHER_TENANT",
    "CATALOG_KEY_MISSING", "PARTIAL_LOAD_REJECTED",
})


def effective_mapping(mapping: Mapping[str, Any]) -> dict[str, Any]:
    """Defaults explícitos y orden estable; las secuencias de transformación conservan orden."""
    value = copy.deepcopy(dict(mapping))
    for field in ("version", "solo_fixture", "fecha_corte"):
        value.pop(field, None)
    fmt = value["formato"]
    if fmt["separador"] == "\\t":
        fmt["separador"] = "\t"
    fmt.setdefault("tipo", "tsv" if fmt["separador"] == "\t" else "csv")
    fmt.pop("fin_de_linea", None)  # El lector acepta ambos finales; no transforma valores.
    value["columnas"] = {
        kind: {name: value.get("columnas", {}).get(kind, {}).get(name, name) for name in spec["columnas"]}
        for kind, spec in source_contract()["archivos"].items()
    }
    value["transformaciones"] = {
        kind: {name: sequence for name, sequence in fields.items() if sequence}
        for kind, fields in value.get("transformaciones", {}).items() if any(fields.values())
    }
    value.setdefault("vigencia_por_defecto", "NO_INTEGRADO")
    value["vigencia_contactos"] = sorted(value.get("vigencia_contactos", []),
                                        key=lambda row: (row["municipio"], row["Destinatario_Id"], row["columna"]))
    return value


def publication_identity(batch: PreparedBatch, tenant: int, absent_policy: str) -> dict[str, Any]:
    if absent_policy not in {"rechazar", "conservar", "dar-de-baja"}:
        raise ETLError("ABSENT_POLICY_INVALID")
    contract = source_contract()
    return {
        "tenant": tenant,
        "files": {name: digest for name, digest in batch.file_hashes.items() if name not in {"mapeo", "contrato"}},
        "mapping_hash": canonical_json_hash(effective_mapping(batch.mapping)),
        "contract": {"version": contract["version"], "sha256": batch.file_hashes["contrato"]},
        "parameters": {"as_of": batch.cut_off.isoformat(), "absent_policy": absent_policy,
                       "rejections": contract["limites"], "rules_version": RULES_VERSION},
    }


def _location(row: dict[str, Any]) -> dict[str, Any] | None:
    province = build_province_payload(row)
    city = build_city_payload(row, 0)
    address = build_address_payload(row, 0, 0)
    if province and city and address:
        return {"province": province, "city": {k: v for k, v in city.items() if k != "province"},
                "address": {k: v for k, v in address.items() if k not in {"person", "city"}}}
    return None


def normalized_rows(batch: PreparedBatch, tenant: int) -> list[dict[str, Any]]:
    """Solo filas aceptadas. Las referencias son claves naturales; no IDs elegidos por el cliente."""
    headers_by_person: dict[int, list] = defaultdict(list)
    for item in batch.objects:
        for header in item.headers:
            headers_by_person[parse_int(header.values.get("Destinatario_Id"))].append(header)
    rows = []
    for headers in headers_by_person.values():
        location = next((found for header in reversed(headers) if (found := _location(header.values))), None)
        rows.append({"kind": "person", "payload": {"person": build_person_payload(headers[-1].values),
                                                   "location": location}})
    for item in batch.objects:
        debtor = build_debtor_payload(item.headers[0].values, batch.debtor_type_keys)
        debtor["tenant"] = tenant
        relations = []
        for header in item.headers:
            relation = build_debtor_person_payload(header.values, 0, 0)
            contacts = build_debtor_contact_payloads(header.values, 0, header.contact_findings)
            relations.append({"external_id": parse_int(header.values.get("Destinatario_Id")),
                              "relation": {k: v for k, v in relation.items() if k not in {"debtor", "person"}},
                              "contacts": [{k: v for k, v in row.items() if k != "person"} for row in contacts]})
        debts = [build_debt_payload(row.values, 0, cut_off=batch.cut_off, origin_state=row.origin_state,
                                    currency_code=batch.mapping["moneda"]) for row in item.details]
        rows.append({"kind": "object", "payload": {"debtor": debtor, "relations": relations,
                     "debts": [{k: v for k, v in row.items() if k != "debtor"} for row in debts]}})
    return rows


def _rpc(name: str, body: dict[str, Any]) -> dict[str, Any]:
    credentials = get_import_credentials()
    url = get_settings(execute=True).supabase_url.rstrip("/") + "/rest/v1/rpc/" + name
    headers = {"apikey": credentials.public_key, "Authorization": f"Bearer {credentials.server_jwt}"}
    response = load.execute_supabase_operation(
        name, lambda: httpx.post(url, headers=headers, json=body, timeout=RPC_TIMEOUT, trust_env=False),
    )
    if response.status_code != 200:
        try:
            message = response.json().get("message")
        except (ValueError, AttributeError):
            message = None
        code = message if isinstance(message, str) and message in STABLE_ERRORS else "IMPORT_PUBLICATION_FAILED"
        raise ETLError(code, load.etl_message(code))
    try:
        result = response.json()
    except ValueError:
        raise ETLError("PUBLISH_OUTCOME_UNKNOWN") from None
    if not isinstance(result, dict) or not isinstance(result.get("batch_id"), int) or not isinstance(result.get("status"), str):
        raise ETLError("PUBLISH_OUTCOME_UNKNOWN")
    return result


def staging_document(batch: PreparedBatch, tenant: int, absent_policy: str) -> dict[str, Any]:
    """Documento compartido; los metadatos de preview se guardan fuera de este payload."""
    if canonical_json_hash(batch.mapping) != batch.file_hashes["mapeo"]:
        raise ETLError("IMPORT_REVISION_CONFLICT")
    identity = publication_identity(batch, tenant, absent_policy)
    return {
        "identity": identity, "mapping": effective_mapping(batch.mapping), "file_hashes": batch.file_hashes,
        "source": "ETL_CLI", "source_updated_at": batch.source_updated_at, "counts": batch_counts(batch.report),
        "file_object_keys": sorted([list(key) for key in batch.file_object_keys]),
        "protected_people": sorted(batch.people_outside_accepted_rows),
        "contact_types": sorted(batch.contact_types_in_file),
        "contact_columns_integrated": batch.contact_columns_integrated,
    }


def stage_batch(batch: PreparedBatch, *, tenant: int, absent_policy: str = "rechazar",
                expected_revision: str | None = None) -> dict[str, Any]:
    if not batch.publishable:
        raise ETLError("BATCH_BLOCKED")
    document = staging_document(batch, tenant, absent_policy)
    return _rpc("stage_import_batch", {"p_actor_user": get_import_credentials().actor_user, "p_tenant": tenant,
                "p_document": document, "p_rows": normalized_rows(batch, tenant), "p_expected_revision": expected_revision})


def _reference(review: Mapping[str, Any], tenant: int) -> dict[str, Any]:
    return {"p_batch_id": review["batch_id"], "p_idempotency_key": review["idempotency_key"],
            "p_revision": review["revision"], "p_tenant": tenant, "p_actor_user": get_import_credentials().actor_user}


def settle_batch(review: Mapping[str, Any], *, tenant: int, status: str = "FALLIDO") -> dict[str, Any]:
    """Transacción posterior: espera la publicación en curso y devuelve su recibo si ya confirmó."""
    return _rpc("settle_import_batch", {**_reference(review, tenant), "p_status": status})


def publish_batch(batch: PreparedBatch, review: Mapping[str, Any], *, tenant: int,
                  absent_policy: str = "rechazar") -> dict[str, Any]:
    reference = _reference(review, tenant)
    # Recalcular, no confiar en la etiqueta ni en un hash guardado por el llamador.
    reference["p_idempotency_key"] = canonical_json_hash(publication_identity(batch, tenant, absent_policy))
    try:
        result = _rpc("publish_import_batch", reference)
    except BaseException as original:
        try:
            result = settle_batch(review, tenant=tenant)
        except Exception:  # noqa: BLE001 -- nunca sustituye la causa ni afirma un resultado incierto
            print(load.etl_message("PUBLISH_OUTCOME_UNKNOWN"))
            raise original from None
        if result["status"] != "PUBLICADO":
            raise original from None
    if result["status"] != "PUBLICADO":
        raise ETLError(result["status"] if result["status"] in {"REQUIERE_NUEVO_PREVIEW", "FALLIDO", "DESCARTADO"}
                       else "BATCH_NOT_VALIDATED")
    if not isinstance(result.get("counts"), dict):
        raise ETLError("PUBLISH_OUTCOME_UNKNOWN")
    return result


def execute_batch(batch: PreparedBatch, *, tenant: int, absent_policy: str = "rechazar",
                  expected_revision: str | None = None) -> dict[str, Any]:
    review = stage_batch(batch, tenant=tenant, absent_policy=absent_policy, expected_revision=expected_revision)
    print(f"Referencia del lote: {review['batch_id']} revision={review['revision']}")
    if review.get("error") == "PARTIAL_LOAD_REJECTED":
        raise ETLError("PARTIAL_LOAD_REJECTED")
    return publish_batch(batch, review, tenant=tenant, absent_policy=absent_policy)
