import argparse
import sys
from collections import Counter
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from ETL.config import ETLError, get_import_credentials, get_settings, settings
from ETL.extract import (
    extract_from_input_folder_limited,
    load_source_profile,
    source_files,
    source_folder,
)
from ETL.load import (
    ImportBatchRejected,
    etl_message,
    fetch_published_objects,
    load_address,
    load_city,
    load_debtor,
    load_debtor_contact,
    load_debtor_person,
    load_debtor_profile,
    load_debtor_profile_detail,
    load_debts_bulk,
    load_person,
    load_province,
    record_import_batch,
    reset_log_context,
    resolve_catalogs,
    set_log_context,
    start_write_tally,
    write_summary,
)

# El módulo de transformación contiene funciones específicas para convertir las filas del DataFrame
from ETL.transform import (
    CATALOG_KEY_COLUMNS,
    PreparedBatch,
    PreparedObject,
    SourceRowContext,
    StructuralRejection,
    batch_counts,
    build_address_payload,
    build_city_payload,
    build_debt_payload,
    build_debtor_contact_payloads,
    build_debtor_payload,
    build_debtor_person_payload,
    build_debtor_profile_detail_payload,
    build_debtor_profile_payload,
    build_person_payload,
    build_province_payload,
    build_transform_summary,
    coverage_gaps,
    parse_int,
    prepare_batch,
    required_catalog_keys,
    source_contract,
    with_catalog_ids,
)
from ETL.validate_source import ValidationError, load_mapping
from services.decision_rules_v1 import RULES_VERSION

IMPORT_SOURCE = "ETL_CLI"
STATUS_VALIDATED = "VALIDADO"
STATUS_PUBLISHED = "PUBLICADO"
STATUS_FAILED = "FALLIDO"


# Función principal del ETL.
def run_etl(
    folder_name: str,
    execute: bool = False,
    limit_objects: int | None = None,
    priority_tipo_ingreso_ids: list[int] | None = None,
    cut_off: str | None = None,
    mapping_path: str | None = None,
) -> None:
    token = set_log_context(0, None)
    try:
        # Rechazar antes de leer archivos, resumir filas o crear el cliente.
        _require_inputs(execute, cut_off, limit_objects, priority_tipo_ingreso_ids)
        if cut_off is None:
            _summarize_source(folder_name, limit_objects, priority_tipo_ingreso_ids)
        else:
            _validate_and_load(folder_name, execute, cut_off, mapping_path)
    # Frontera de salida: un error de parsing o del proveedor puede contener filas.
    except Exception as error:  # noqa: BLE001
        code = error.code if isinstance(error, ETLError) else "ETL_FAILED"
        raise ETLError(code, etl_message(code)) from None
    finally:
        reset_log_context(token)


def _require_inputs(
    execute: bool,
    cut_off: str | None,
    limit_objects: int | None,
    priority_tipo_ingreso_ids: list[int] | None,
) -> None:
    if execute:
        get_settings(execute=True)
        if not cut_off:
            raise ETLError("CUT_OFF_REQUIRED")
    # Un subconjunto no es el lote validado: sus hashes y conteos no lo describirían.
    if cut_off is not None and (limit_objects is not None or priority_tipo_ingreso_ids):
        raise ETLError("PARTIAL_LOAD_REJECTED")
    if execute:
        get_import_credentials()


# Vista previa sin corte: solo conteos de los archivos. No valida ni autoriza cargar.
def _summarize_source(
    folder_name: str,
    limit_objects: int | None,
    priority_tipo_ingreso_ids: list[int] | None,
) -> None:
    source_data = extract_from_input_folder_limited(
        folder_name=folder_name,
        limit_objects=limit_objects,
        priority_tipo_ingreso_ids=priority_tipo_ingreso_ids,
    )

    summary = build_transform_summary(
        cabecera_df=source_data.cabecera_df,
        detalle_df=source_data.detalle_df,
    )
    print("RESUMEN DE TRANSFORMACIÓN")
    print(f"Personas únicas: {summary.persons_count}")
    print(f"Objetos únicos: {summary.debtors_count}")
    print(f"Relaciones únicas: {summary.debtor_person_relations_count}")
    print(f"Filas de detalle: {summary.detail_rows_count}")
    print(f"Deudas únicas: {summary.unique_debts_count}")
    print(f"Deudas duplicadas: {summary.duplicated_debt_rows_count}")

    print()
    print(etl_message("SOURCE_SELECTED", key=folder_name))
    print(f"Límite de objetos: {limit_objects}")
    print(f"Tipos de ingreso priorizados: {priority_tipo_ingreso_ids or []}")

    print()
    print("DRY-RUN FINALIZADO")
    print("No se insertó ni actualizó nada en Supabase.")
    print("Para validar el lote, indicá --cut-off; para cargarlo, agregá --execute.")


# Los errores de configuración son códigos propios del contrato: se conservan sin valores ni rutas.
def _source_error(error: ValidationError) -> ETLError:
    return ETLError(str(error).split(":", 1)[0])


def _load_mapping(folder: Path, mapping_path: str | None) -> dict[str, Any]:
    try:
        if mapping_path is not None:
            return load_source_profile(mapping_path, source_contract())
        return load_mapping(folder)
    except ValidationError as error:
        raise _source_error(error) from None


def _prepare(folder: Path, mapping: dict[str, Any], cut_off: str) -> PreparedBatch:
    try:
        return prepare_batch(source_files(folder, mapping), mapping, source_contract(), cut_off)
    except OSError:
        raise ETLError("ARCHIVO_NO_LEIBLE") from None
    except ValidationError as error:
        raise _source_error(error) from None


def _print_validation(batch: PreparedBatch) -> None:
    report = batch.report
    print("VALIDACIÓN DEL LOTE")
    print(f"Resultado del lote: {report['resultado_lote']}")
    print(f"Motivos de bloqueo: {', '.join(report['motivos_bloqueo']) or 'ninguno'}")
    print(f"Corte: {report['fecha_corte']}")
    for name, value in report["conteos"].items():
        print(f"{name}: {'no disponible' if value is None else value}")
    for kind, rows in report["filas"].items():
        print(f"Filas de {kind}: {rows['leidas']} leídas, {rows['aceptadas']} aceptadas, {rows['rechazadas']} rechazadas")
        for code, count in rows["rechazadas_por_codigo"].items():
            print(f"  Rechazo {code}: {count}")
    print()


def _register_batch(
    batch_hashes: dict[str, str],
    cut_off: str,
    status: str,
    counts: dict[str, Any],
    *,
    source_updated_at: str | None = None,
    supersedes: int | None = None,
) -> int:
    return record_import_batch(
        tenant=settings.tenant_id,
        source=IMPORT_SOURCE,
        file_hashes=batch_hashes,
        as_of=cut_off,
        rules_version=RULES_VERSION,
        status=status,
        counts=counts,
        source_updated_at=source_updated_at,
        supersedes=supersedes,
    )


def _validate_and_load(folder_name: str, execute: bool, cut_off: str, mapping_path: str | None) -> None:
    folder = source_folder(folder_name)
    mapping = _load_mapping(folder, mapping_path)

    try:
        batch = _prepare(folder, mapping, cut_off)
    except StructuralRejection as rejection:
        if execute:
            _register_batch(rejection.file_hashes, cut_off, STATUS_FAILED, {})
        raise ETLError(rejection.code) from None

    _print_validation(batch)

    if execute and batch.publishable:
        _publish_validated_batch(batch)
        return

    if execute:
        _register_batch(batch.file_hashes, cut_off, STATUS_FAILED, batch_counts(batch.report),
                        source_updated_at=batch.source_updated_at)
    if not batch.publishable:
        raise ETLError("BATCH_BLOCKED")

    print("DRY-RUN FINALIZADO")
    print("No se insertó ni actualizó nada en Supabase.")
    print("Para ejecutar la carga real, usá el flag --execute.")


# Registra el lote, publica sus objetos aceptados y cierra la cadena de eventos en import_batch.
# V1: las escrituras por la Data API no son una transacción. Una falla deja el lote en FALLIDO y lo ya escrito
# no se revierte; la publicación atómica es de ALIGN-032.
# Desde que VALIDADO quedó registrado, todo camino en el que se sabe que PUBLICADO no quedó termina en FALLIDO con antecedente.
def _publish_validated_batch(batch: PreparedBatch) -> None:
    cut_off = batch.report["fecha_corte"]
    catalogs = resolve_catalogs(required_catalog_keys(batch), CATALOG_KEY_COLUMNS)
    counts = batch_counts(batch.report)
    # Lectura, sin escribir cartera. Un FALLIDO sin antecedente declara justamente eso: no tocó nada.
    missing = coverage_gaps(batch, fetch_published_objects(settings.tenant_id))

    if missing:
        _register_batch(batch.file_hashes, cut_off, STATUS_FAILED, {**counts, "faltantes": missing},
                        source_updated_at=batch.source_updated_at)
        raise ETLError("PARTIAL_LOAD_REJECTED")

    validated_id = _register_batch(batch.file_hashes, cut_off, STATUS_VALIDATED, counts,
                                   source_updated_at=batch.source_updated_at)

    try:
        print("INICIANDO CARGA REAL EN SUPABASE")
        print("-" * 80)
        loaded = _load_objects(batch, catalogs)
    # También ante una interrupción: se sabe que la carga no terminó.
    except BaseException:
        _register_failure(batch, counts, validated_id)
        raise

    try:
        _register_batch(batch.file_hashes, cut_off, STATUS_PUBLISHED, {**counts, **loaded},
                        source_updated_at=batch.source_updated_at, supersedes=validated_id)
    # La base respondió que no: no quedó, y hay escrituras sin lote que las declare. Los conteos son los que ya aceptó VALIDADO.
    except ImportBatchRejected:
        _register_failure(batch, counts, validated_id)
        raise
    # Respuesta perdida, 5xx o interrupción: PUBLICADO pudo quedar, y un FALLIDO podría ser falso. Lo resuelve ALIGN-032.
    except BaseException:
        print(etl_message("PUBLISH_OUTCOME_UNKNOWN"))
        raise

    _print_load_summary(loaded)


# La causa original es la que se informa: si tampoco se puede registrar la falla, solo se avisa con un código.
def _register_failure(batch: PreparedBatch, counts: dict[str, Any], validated_id: int) -> None:
    try:
        _register_batch(batch.file_hashes, batch.report["fecha_corte"], STATUS_FAILED, counts,
                        source_updated_at=batch.source_updated_at, supersedes=validated_id)
    except Exception:  # noqa: BLE001
        print(etl_message("IMPORT_BATCH_FAILURE_NOT_RECORDED"))


def _load_location(row: dict[str, Any], person_id: int, loaded: Counter[str]) -> None:
    # Cargamos provincia, localidad y dirección de la persona, en ese orden: cada una depende de la anterior.
    province_payload = build_province_payload(row)

    if not province_payload:
        return

    province_id = int(load_province(province_payload)["id"])
    city_payload = build_city_payload(row=row, province_id=province_id)

    if not city_payload:
        return

    city_id = int(load_city(city_payload)["id"])
    address_payload = build_address_payload(row=row, person_id=person_id, city_id=city_id)

    if address_payload:
        load_address(address_payload)
        loaded["direcciones_publicadas"] += 1


def _has_location(row: dict[str, Any]) -> bool:
    return bool(
        build_province_payload(row)
        and build_city_payload(row=row, province_id=0)
        and build_address_payload(row=row, person_id=0, city_id=0)
    )


# Una persona puede venir en varios objetos con datos distintos. Mandan los últimos, como siempre, pero se escriben una
# sola vez: ir y volver entre dos valores reescribiría sus filas en cada recarga del mismo lote.
def _load_people(
    batch: PreparedBatch,
    catalogs: Mapping[str, Mapping[str, int]],
    loaded: Counter[str],
) -> dict[int, int]:
    headers_by_person: dict[int, list[SourceRowContext]] = {}

    for item in batch.objects:
        for header in item.headers:
            headers_by_person.setdefault(parse_int(header.values.get("Destinatario_Id")), []).append(header)

    person_ids: dict[int, int] = {}

    for external_id, headers in headers_by_person.items():
        last = headers[-1]
        set_log_context(last.line, ("persona", external_id))
        person_payload = with_catalog_ids("person", build_person_payload(last.values), catalogs)
        person_ids[external_id] = int(load_person(person_payload)["id"])
        located = next((header for header in reversed(headers) if _has_location(header.values)), last)
        _load_location(located.values, person_ids[external_id], loaded)

    return person_ids


def _load_header(
    header: SourceRowContext,
    debtor_id: int,
    id_by_person: Mapping[int, int],
    catalogs: Mapping[str, Mapping[str, int]],
    loaded: Counter[str],
) -> tuple[int, set[tuple[str, str]]]:
    row = header.values
    person_id = id_by_person[parse_int(row.get("Destinatario_Id"))]
    load_debtor_person(build_debtor_person_payload(row=row, debtor_id=debtor_id, person_id=person_id))
    loaded["relaciones_publicadas"] += 1

    usable: set[tuple[str, str]] = set()
    contacts = build_debtor_contact_payloads(row=row, person_id=person_id, findings=header.contact_findings)

    for contact in contacts:
        load_debtor_contact(with_catalog_ids("debtor_contact", contact, catalogs))
        loaded["contactos_publicados"] += 1
        if contact["active"]:
            usable.add((contact["type"], contact["value"]))

    return person_id, usable


def _load_object(
    item: PreparedObject,
    batch: PreparedBatch,
    id_by_person: Mapping[int, int],
    catalogs: Mapping[str, Mapping[str, int]],
    loaded: Counter[str],
) -> tuple[int, set[int], int, list[dict[str, Any]]]:
    first = item.headers[0]
    set_log_context(first.line, ("objeto", item.reference))
    debtor_payload = build_debtor_payload(first.values, batch.debtor_type_keys)
    debtor_id = int(load_debtor(with_catalog_ids("debtor", debtor_payload, catalogs))["id"])
    loaded["objetos_publicados"] += 1

    person_ids: set[int] = set()
    usable_contacts = 0

    for header in item.headers:
        set_log_context(header.line, ("cabecera", item.reference))
        person_id, usable = _load_header(header, debtor_id, id_by_person, catalogs, loaded)
        person_ids.add(person_id)
        usable_contacts += len(usable)

    debts = [
        build_debt_payload(
            row.values,
            debtor_id,
            cut_off=batch.cut_off,
            origin_state=row.origin_state,
            currency_code=batch.mapping["moneda"],
        )
        for row in item.details
    ]

    return debtor_id, person_ids, usable_contacts, debts


# Solo llegan aquí filas que el motor aceptó en un lote cuya publicación está permitida.
# Los objetos en cuarentena conservan su estado previo: no se escribe ninguna de sus filas.
def _load_objects(batch: PreparedBatch, catalogs: Mapping[str, Mapping[str, int]]) -> dict[str, Any]:
    tally = start_write_tally()
    loaded: Counter[str] = Counter()
    profile_inputs = []
    all_debts: list[dict[str, Any]] = []
    id_by_person = _load_people(batch, catalogs, loaded)

    for index, item in enumerate(batch.objects, start=1):
        debtor_id, person_ids, usable_contacts, debts = _load_object(item, batch, id_by_person, catalogs, loaded)
        all_debts.extend(debts)
        profile_inputs.append((debtor_id, debts, person_ids, usable_contacts))

        if index % 10 == 0:
            print(f"Objetos procesados: {index}/{len(batch.objects)}")

    print()
    print(f"Cargando {len(all_debts)} deudas por lotes en Supabase...")
    set_log_context(0, tuple((row["debtor"], row["external_id"]) for row in all_debts))
    debt_summary = load_debts_bulk([with_catalog_ids("debt", row, catalogs) for row in all_debts])
    loaded["deudas_publicadas"] = debt_summary["unique"]
    loaded["deudas_insertadas"] = debt_summary["inserted"]
    loaded["deudas_actualizadas"] = debt_summary["updated"]
    loaded["deudas_sin_cambios"] = debt_summary["unchanged"]

    # El perfil se calcula al final porque resume las obligaciones del objeto al corte.
    for debtor_id, debts, person_ids, usable_contacts in profile_inputs:
        set_log_context(0, ("perfil", debtor_id))
        profile = load_debtor_profile(
            build_debtor_profile_payload(
                debtor_id=debtor_id,
                debt_rows=debts,
                active_person_count=len(person_ids),
                available_contact_count=usable_contacts if batch.contact_columns_integrated else None,
                cut_off=batch.cut_off,
            )
        )
        loaded["perfiles_publicados"] += 1

        for person_id in sorted(person_ids):
            load_debtor_profile_detail(build_debtor_profile_detail_payload(int(profile["id"]), person_id))

    return {**loaded, **write_summary(tally)}


def _print_load_summary(loaded: Mapping[str, Any]) -> None:
    print()
    print("CARGA FINALIZADA")
    print("-" * 80)
    print(f"Objetos publicados:                  {loaded.get('objetos_publicados', 0)}")
    print(f"Relaciones debtor_person publicadas: {loaded.get('relaciones_publicadas', 0)}")
    print(f"Deudas únicas cargadas/actualizadas: {loaded.get('deudas_publicadas', 0)}")
    print(f"Deudas insertadas:                   {loaded.get('deudas_insertadas', 0)}")
    print(f"Deudas actualizadas:                 {loaded.get('deudas_actualizadas', 0)}")
    print(f"Deudas sin cambios:                  {loaded.get('deudas_sin_cambios', 0)}")
    print(f"Direcciones publicadas:              {loaded.get('direcciones_publicadas', 0)}")
    print(f"Contactos publicados:                {loaded.get('contactos_publicados', 0)}")
    print(f"Perfiles debtor_profile publicados:  {loaded.get('perfiles_publicados', 0)}")
    print(f"Filas insertadas:                    {loaded.get('filas_insertadas', 0)}")
    print(f"Filas actualizadas:                  {loaded.get('filas_actualizadas', 0)}")
    print(f"Filas sin cambios:                   {loaded.get('filas_sin_cambios', 0)}")
    print("-" * 80)


# Entry point para ejecutar el ETL desde línea de comandos.
def main() -> None:
    parser = argparse.ArgumentParser(
        description="Ejecuta el ETL de archivos TSV hacia Supabase."
    )

    parser.add_argument(
        "--folder",
        default="inmuebles",
        help="Carpeta dentro de back/data/input, o ruta absoluta del lote. Por defecto: inmuebles",
    )

    parser.add_argument(
        "--execute",
        action="store_true",
        help="Ejecuta la carga real en Supabase. Exige --cut-off. Si no se usa, corre en modo dry-run.",
    )

    parser.add_argument(
        "--cut-off",
        default=None,
        help="Fecha de corte del lote, AAAA-MM-DD, igual a la declarada en el perfil. Obligatoria con --execute.",
    )

    parser.add_argument(
        "--mapping",
        default=None,
        help="Perfil JSON del lote. Sin él, solo se admite una fixture sintética con manifest.json.",
    )

    parser.add_argument(
        "--limit-objects",
        type=int,
        default=None,
        help="Solo vista previa sin corte. Limita el resumen a N objetos únicos por Bien_Tipo_Id + Cuenta.",
    )

    parser.add_argument(
        "--priority-tipo-ingreso",
        type=int,
        nargs="*",
        default=None,
        help="Solo vista previa sin corte. Tipo_Ingreso_Id que deben priorizarse dentro del límite.",
    )

    args = parser.parse_args()

    try:
        run_etl(
            folder_name=args.folder,
            execute=args.execute,
            limit_objects=args.limit_objects,
            priority_tipo_ingreso_ids=args.priority_tipo_ingreso,
            cut_off=args.cut_off,
            mapping_path=args.mapping,
        )
    except ETLError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
