import argparse
import re
import sys
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
    etl_message,
    execute_import_batch,
    record_import_batch,
    reset_log_context,
    resolve_catalogs,
    set_log_context,
)

# El módulo de transformación contiene funciones específicas para convertir las filas del DataFrame
from ETL.transform import (
    CATALOG_KEY_COLUMNS,
    PreparedBatch,
    StructuralRejection,
    batch_counts,
    build_transform_summary,
    prepare_batch,
    required_catalog_keys,
    source_contract,
)
from ETL.validate_source import ValidationError, load_mapping
from services.decision_rules_v1 import RULES_VERSION

IMPORT_SOURCE = "ETL_CLI"
STATUS_VALIDATED = "VALIDADO"
STATUS_PUBLISHED = "PUBLICADO"
STATUS_FAILED = "FALLIDO"

# Qué hacer con lo publicado que el archivo ya no trae. La decide quien carga, nunca el ETL por su cuenta:
# - rechazar (por defecto): lote completo. Falta un objeto, una obligación o una relación: FALLIDO, sin escribir;
# - conservar: delta. Lo ausente queda como está, activo y contando en su perfil;
# - dar-de-baja: delta con bajas. De los objetos aceptados, las relaciones y los contactos ausentes pasan a inactivos.
# En las tres, un objeto ausente no se toca y una obligación ausente se conserva: el archivo no dice que se pagó, y debt no
# tiene baja. Lo ausente se informa siempre en counts.ausentes y lo desactivado en bajas_relaciones y bajas_contactos.
ABSENT_REJECT = "rechazar"
ABSENT_KEEP = "conservar"
ABSENT_DEACTIVATE = "dar-de-baja"
ABSENT_POLICIES = (ABSENT_REJECT, ABSENT_KEEP, ABSENT_DEACTIVATE)


# Función principal del ETL.
def run_etl(
    folder_name: str,
    execute: bool = False,
    limit_objects: int | None = None,
    priority_tipo_ingreso_ids: list[int] | None = None,
    cut_off: str | None = None,
    mapping_path: str | None = None,
    absent_policy: str = ABSENT_REJECT,
    expected_revision: str | None = None,
) -> None:
    token = set_log_context(0, None)
    try:
        # Rechazar antes de leer archivos, resumir filas o crear el cliente.
        if absent_policy not in ABSENT_POLICIES:
            raise ETLError("ABSENT_POLICY_INVALID")
        if expected_revision is not None and (not execute or re.fullmatch(r"[0-9a-f]{64}", expected_revision) is None):
            raise ETLError("IMPORT_REVISION_CONFLICT")
        _require_inputs(execute, cut_off, limit_objects, priority_tipo_ingreso_ids)
        if cut_off is None:
            _summarize_source(folder_name, limit_objects, priority_tipo_ingreso_ids)
        else:
            _validate_and_load(folder_name, execute, cut_off, mapping_path, absent_policy, expected_revision)
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


def _validate_and_load(folder_name: str, execute: bool, cut_off: str, mapping_path: str | None, absent_policy: str,
                       expected_revision: str | None = None) -> None:
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
        _publish_validated_batch(batch, absent_policy, expected_revision)
        return

    if execute:
        _register_batch(batch.file_hashes, cut_off, STATUS_FAILED, batch_counts(batch.report),
                        source_updated_at=batch.source_updated_at)
    if not batch.publishable:
        raise ETLError("BATCH_BLOCKED")

    print("DRY-RUN FINALIZADO")
    print("No se insertó ni actualizó nada en Supabase.")
    print("Para ejecutar la carga real, usá el flag --execute.")


# El registro append-only, la revisión congelada y las escrituras se coordinan en SQL.
# Staging no escribe cartera. PUBLICADO incluye el recibo durable de esa transacción.
def _publish_validated_batch(batch: PreparedBatch, absent_policy: str = ABSENT_REJECT,
                             expected_revision: str | None = None) -> None:
    resolve_catalogs(required_catalog_keys(batch), CATALOG_KEY_COLUMNS)
    print("INICIANDO CARGA REAL EN SUPABASE")
    result = execute_import_batch(batch, tenant=settings.tenant_id, absent_policy=absent_policy,
                                  expected_revision=expected_revision)
    loaded = result["counts"]
    if loaded.get("ausentes"):
        print("Ausentes del archivo: " + ", ".join(f"{name}={count}" for name, count in loaded["ausentes"].items()))
    print(f"Lote publicado: {result['batch_id']}")
    _print_load_summary(loaded)


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
    print(f"Relaciones dadas de baja:            {loaded.get('bajas_relaciones', 0)}")
    print(f"Contactos dados de baja:             {loaded.get('bajas_contactos', 0)}")
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
        "--ausentes",
        choices=ABSENT_POLICIES,
        default=ABSENT_REJECT,
        help="Qué hacer con lo publicado que el archivo ya no trae: rechazar el lote (por defecto), "
        "conservarlo (delta) o dar de baja relaciones y contactos de los objetos aceptados.",
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

    parser.add_argument("--revalidate", default=None,
                        help="Revalidar explícitamente un lote fallido, descartado o desactualizado; revisión SHA-256 anterior.")

    args = parser.parse_args()

    try:
        run_etl(
            folder_name=args.folder,
            execute=args.execute,
            limit_objects=args.limit_objects,
            priority_tipo_ingreso_ids=args.priority_tipo_ingreso,
            cut_off=args.cut_off,
            mapping_path=args.mapping,
            absent_policy=args.ausentes,
            expected_revision=args.revalidate,
        )
    except ETLError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
