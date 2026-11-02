"""Lectores TSV/CSV/XLSX por perfil; validación dry-run y compatibilidad con el ETL."""

import argparse
import csv
import io
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from ETL.config import settings
from ETL.readers.limits import (
    Deadline,
    FileLimits,
    check_cells,
    check_header,
    open_source,
    source_error,
)
from ETL.readers.xlsx import read_workbook
from ETL.validate_source import (
    DEFAULT_CONTRACT,
    MAPPING_SCHEMA,
    SourceRow,
    SourceTable,
    ValidationError,
    check_schema,
    load_contract,
    parse_amount,
    parse_date,
    profile_require,
    read_profile,
    render_markdown,
    validate_batch,
)

KINDS = ('cabecera', 'detalle')


def _source_format(mapping):
    fmt = mapping['formato']
    if fmt.get('tipo') == 'xlsx':
        return 'xlsx', None
    separator = fmt['separador']
    inferred = 'tsv' if separator in ('\t', '\\t') else 'csv'
    kind = fmt.get('tipo', inferred)
    profile_require(kind == inferred)
    return kind, '\t' if kind == 'tsv' else separator


def validate_source_profile(mapping, contract=None):
    """Esquema compartido con ALIGN-056 y restricciones cruzadas del motor v1."""
    contract = load_contract() if contract is None else contract
    if (isinstance(mapping, dict) and isinstance(mapping.get('formato'), dict)
            and mapping['formato'].get('tipo', 'tsv') not in ('tsv', 'csv', 'xlsx')):
        raise ValidationError('FORMATO_NO_SOPORTADO')
    schema = load_contract(MAPPING_SCHEMA)
    check_schema(mapping, schema, schema)
    _source_format(mapping)
    # El motor valida el contrato, corte, alias, separadores y catálogos antes
    # de leer. Tablas vacías permiten usar esa API pública sin copiar sus reglas.
    validate_batch(dict.fromkeys(KINDS, SourceTable([], [])),
                   mapping, contract, mapping['fecha_corte'])
    for kind in KINDS:
        known = contract['archivos'][kind]['columnas']
        transformations = mapping.get('transformaciones', {}).get(kind, {})
        profile_require(set(transformations) <= set(known))
        for operations in transformations.values():
            for operation in operations:
                for code in operation.get('valores', {}):
                    check_schema(code, schema['definitions']['texto'], schema)
        for catalog in mapping['catalogos'].values():
            for code in catalog:
                check_schema(code, schema['definitions']['texto'], schema)


def load_source_profile(path, contract=None):
    """Lee y valida un perfil explícito; nunca busca credenciales ni layouts."""
    mapping = read_profile(path)
    validate_source_profile(mapping, contract)
    return mapping


def apply_source_transformations(table, kind, mapping, contract=None):
    """Copia una SourceTable, preservando encabezados físicos y líneas.

    El perfil debe validarse antes. No agrega columnas ni rellena faltantes.
    """
    contract = load_contract() if contract is None else contract
    limits = FileLimits.from_contract(contract)
    operations = mapping.get('transformaciones', {}).get(kind, {})
    aliases = mapping.get('columnas', {}).get(kind, {})
    rows = []
    for name in operations:
        if aliases.get(name, name) not in table.columns:
            source_error('COLUMNA_MAPEADA_AUSENTE', kind, 1, name)
    for row in table.rows:
        values = row.values.copy()
        for name, sequence in operations.items():
            column = aliases.get(name, name)
            value = values[column]
            for operation in sequence:
                action = operation['operacion']
                if action == 'recortar':
                    value = value.strip()
                elif action == 'mayusculas':
                    value = value.upper()
                elif action == 'minusculas':
                    value = value.lower()
                elif value.strip():
                    if value not in operation['valores']:
                        source_error('CODIGO_NO_MAPEADO', kind, row.line, name)
                    value = operation['valores'][value]
            values[column] = value
        check_cells(values.values(), kind, row.line, limits)
        rows.append(SourceRow(row.line, values))
    return SourceTable(table.columns.copy(), rows)


def _finish_table(table, kind, mapping, contract):
    aliases = mapping.get('columnas', {}).get(kind, {})
    for name, spec in contract['archivos'][kind]['columnas'].items():
        if spec['requerida'] and aliases.get(name, name) not in table.columns:
            source_error('COLUMNA_OBLIGATORIA_AUSENTE', kind, 1, name)
    # Sin operaciones, copiar las filas duplicaría el pico de memoria sin cambiar nada.
    if not mapping.get('transformaciones', {}).get(kind):
        return table
    return apply_source_transformations(table, kind, mapping, contract)


class _BoundedLines:
    """Líneas para csv.reader, con tope por registro: csv arma la fila entera antes de entregarla.

    Con 25 MB en una sola línea, o miles de celdas multilínea, serían millones de celdas en memoria.
    """

    def __init__(self, text, kind, limit):
        self.text = text
        self.kind = kind
        self.limit = limit
        self.line = self.pending = 0

    def __iter__(self):
        return self

    def __next__(self):
        chunk = self.text.readline(self.limit + 1)
        if not chunk:
            raise StopIteration
        self.line += 1
        self.pending += len(chunk)
        if self.pending > self.limit:
            source_error('LIMITE_ARCHIVO_EXCEDIDO', self.kind, self.line)
        return chunk


def _read_delimited(path, kind, mapping, contract, limits, deadline):
    source_type, separator = _source_format(mapping)
    encoding = mapping['formato']['codificacion']
    rows = []
    with open_source(path, kind, source_type, limits, encoding) as stream:
        try:
            text = io.TextIOWrapper(stream, encoding='utf-8-sig' if encoding == 'utf-8' else encoding, newline='')
            # Cada celda puede llevar comillas duplicadas, entre comillas y con su separador. Con
            # límites chicos, el piso deja que la fila llegue a su control y dé su código propio.
            lines = _BoundedLines(text, kind, max(1 << 20, limits.columns * (2 * limits.cell + 3)))
            reader = csv.reader(lines, delimiter=separator, strict=True)
            raw_columns = next(reader, [])
            check_cells(raw_columns, kind, 1, limits)
            columns = check_header(raw_columns, kind, limits)
            for values in reader:
                lines.pending = 0
                line = reader.line_num
                deadline.check(kind, line)
                # Las líneas en blanco no son filas, pero recorrerlas también cuesta.
                if line > 2 * limits.rows + 1:
                    source_error('LIMITE_ARCHIVO_EXCEDIDO', kind, line)
                check_cells(values, kind, line, limits)
                if not values or (len(values) == 1 and not values[0].strip()):
                    continue
                if len(rows) >= limits.rows:
                    source_error('LIMITE_ARCHIVO_EXCEDIDO', kind, line)
                if len(values) != len(columns):
                    source_error('ESTRUCTURA_INVALIDA', kind, line)
                rows.append(SourceRow(line, dict(zip(columns, values, strict=True))))
        except ValidationError:
            raise
        except csv.Error as error:
            # csv corta antes de nuestro límite de celda si el campo supera su propio tope global.
            source_error('CELDA_EXCEDE_LIMITE' if 'field larger' in str(error) else 'ARCHIVO_NO_LEIBLE', kind, lines.line)
        except (OSError, UnicodeError, TypeError, ValueError):
            source_error('ARCHIVO_NO_LEIBLE', kind)
    return _finish_table(SourceTable(columns, rows), kind, mapping, contract)


def _physical_types(kind, mapping, contract):
    aliases = mapping.get('columnas', {}).get(kind, {})
    return {aliases.get(name, name): spec['tipo'] for name, spec in contract['archivos'][kind]['columnas'].items()}


def _read_xlsx(files, mapping, contract, limits, deadline):
    """Un libro con las dos hojas (misma ruta) o un libro por archivo lógico."""
    fmt = mapping['formato']
    groups = {}
    for kind in KINDS:
        groups.setdefault(str(files[kind]), []).append(kind)
    tables, ignored = {}, []
    for kinds in groups.values():
        # Dos libros pueden traer la misma hoja, «Hoja1»; un solo libro, no.
        profile_require(len({fmt['hojas'][kind] for kind in kinds}) == len(kinds))
        with open_source(files[kinds[0]], kinds[0], 'xlsx', limits) as stream:
            result = read_workbook(stream, {kind: fmt['hojas'][kind] for kind in kinds}, fmt,
                                   {kind: _physical_types(kind, mapping, contract) for kind in kinds},
                                   limits, deadline)
        ignored += result.ignored_sheets
        for kind, table in result.tables.items():
            tables[kind] = _finish_table(table, kind, mapping, contract)
    return tables, ignored


@dataclass
class SourceBatch:
    tables: dict[str, SourceTable]
    # Para el preview autorizado; el reporte del motor no las incluye.
    ignored_sheets: list[str] = field(default_factory=list)


def read_source_batch(files, mapping, *, contract=None, limits=None):
    """Lee TSV/CSV/XLSX según el perfil y devuelve tablas y hojas ignoradas.

    El tipo sale del contenido del archivo, no del nombre ni del MIME del cliente. Ante
    una lectura corrupta no entrega prefijos parciales. Los errores son códigos seguros
    con ubicación; no contienen valores ni nombres externos.

    El plazo se comprueba entre operaciones y al terminar: un lote vencido nunca se entrega.
    Para un archivo subido, el corte real es ``ETL.readers.supervised.read_source_batch_supervised``.
    """
    contract = load_contract() if contract is None else contract
    validate_source_profile(mapping, contract)
    if not isinstance(files, dict) or set(files) != set(KINDS):
        raise ValidationError('ARCHIVOS_REQUERIDOS')
    limits = FileLimits.from_contract(contract) if limits is None else limits
    deadline = Deadline(limits.read_seconds)
    if _source_format(mapping)[0] == 'xlsx':
        batch = SourceBatch(*_read_xlsx(files, mapping, contract, limits, deadline))
    else:
        batch = SourceBatch({kind: _read_delimited(files[kind], kind, mapping, contract, limits, deadline) for kind in KINDS})
    deadline.check(KINDS[-1])
    return batch


def read_source_tables(files, mapping, *, contract=None, limits=None):
    """Las tablas de ``read_source_batch``, listas para validate_batch."""
    return read_source_batch(files, mapping, contract=contract, limits=limits).tables


def validate_source_files(files, mapping, *, contract=None, cut_off, limits=None):
    """Dry-run: el reporte del motor, sin archivos de salida ni publicación."""
    contract = load_contract() if contract is None else contract
    tables = read_source_tables(files, mapping, contract=contract, limits=limits)
    return validate_batch(tables, mapping, contract, cut_off)


def _canonical_dataframe(table, kind, mapping, contract):
    """Puente al ETL heredado: nombres canónicos, decimal sin miles y fecha D/M/A.

    Solo normaliza formatos válidos. Nunca convierte celdas inválidas o ausentes
    en cero. Los consumidores deben validar las SourceTable antes de publicar.
    """
    fmt = mapping['formato']
    aliases = mapping.get('columnas', {}).get(kind, {})
    columns = {name: aliases.get(name, name) for name in contract['archivos'][kind]['columnas']
               if aliases.get(name, name) in table.columns}
    records = []
    for row in table.rows:
        record = {}
        for name, physical in columns.items():
            value = row.values[physical].strip()
            field_type = contract['archivos'][kind]['columnas'][name]['tipo']
            if field_type in ('importe', 'porcentaje'):
                parsed = parse_amount(value, fmt['decimal'], '' if field_type == 'porcentaje' else fmt['miles'])
                if parsed.value is not None:
                    value = format(parsed.value, 'f')
            elif field_type == 'fecha':
                parsed = parse_date(value, fmt['fecha'], contract)
                if parsed.value is not None:
                    value = parsed.value.strftime('%d/%m/%Y')
            record[name] = value
        records.append(record)
    return pd.DataFrame(records, columns=list(columns), dtype=str)


@dataclass
class ExtractedSourceData:
    cabecera_df: pd.DataFrame
    detalle_df: pd.DataFrame
    cabecera_path: Path
    detalle_path: Path


# Leemos un archivo TSV y lo devolvemos como DataFrame. TSV = Tab Separated Values. Es decir, columnas separadas por tabulaciones.
def read_tsv(path: Path) -> pd.DataFrame:
    """
    Lee un archivo TSV y lo devuelve como DataFrame.

    TSV = Tab Separated Values.
    Es decir, columnas separadas por tabulaciones.
    """

    if not path.exists():
        raise FileNotFoundError(f"No existe el archivo: {path}")

    if not path.is_file():
        raise ValueError(f"La ruta no corresponde a un archivo: {path}")

    return pd.read_csv(
        path,
        sep="\t",
        dtype=str,
        encoding="utf-8-sig",
        keep_default_na=False,
    )


# Extrae los archivos de cabecera y detalle a partir de las rutas dadas.
def extract_source_files(
    cabecera_path: str | Path,
    detalle_path: str | Path,
    *,
    mapping: dict | None = None,
    contract: dict | None = None,
) -> ExtractedSourceData:

    cabecera_file = Path(cabecera_path)
    detalle_file = Path(detalle_path)

    if mapping is None:
        cabecera_df = read_tsv(cabecera_file)
        detalle_df = read_tsv(detalle_file)
    else:
        contract = load_contract() if contract is None else contract
        tables = read_source_tables({'cabecera': cabecera_file, 'detalle': detalle_file}, mapping, contract=contract)
        cabecera_df, detalle_df = (_canonical_dataframe(tables[kind], kind, mapping, contract)
                                  for kind in ('cabecera', 'detalle'))

    return ExtractedSourceData(
        cabecera_df=cabecera_df,
        detalle_df=detalle_df,
        cabecera_path=cabecera_file,
        detalle_path=detalle_file,
    )


# Extrae los archivos de cabecera y detalle a partir de una carpeta de input.
def extract_from_input_folder(folder_name: str) -> ExtractedSourceData:

    source_dir = settings.input_dir / folder_name

    cabecera_path = source_dir / "cabecera.tsv"
    detalle_path = source_dir / "detalle.tsv"

    return extract_source_files(
        cabecera_path=cabecera_path,
        detalle_path=detalle_path,
    )


# Limita los DataFrames a una cantidad máxima de objetos de deuda.
# El límite se aplica por Bien_Tipo_Id + Cuenta, no por cantidad de filas.
# Esto evita cortar relaciones o deudas a la mitad.
# Además permite priorizar ciertos Tipo_Ingreso_Id dentro del límite.
def limit_by_debtor_objects(
    cabecera_df: pd.DataFrame,
    detalle_df: pd.DataFrame,
    limit_objects: int | None,
    priority_tipo_ingreso_ids: list[int] | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame]:

    if limit_objects is None:
        return cabecera_df, detalle_df

    if limit_objects <= 0:
        raise ValueError("limit_objects debe ser mayor a 0.")

    required_columns = {"Bien_Tipo_Id", "Cuenta"}

    missing_cabecera = required_columns - set(cabecera_df.columns)
    missing_detalle = required_columns - set(detalle_df.columns)

    if missing_cabecera:
        raise ValueError(f"Cabecera no tiene columnas requeridas: {missing_cabecera}")

    if missing_detalle:
        raise ValueError(f"Detalle no tiene columnas requeridas: {missing_detalle}")

    priority_tipo_ingreso_ids = priority_tipo_ingreso_ids or []
    priority_tipo_ingreso_ids_str = {
        str(value).strip()
        for value in priority_tipo_ingreso_ids
    }

    object_columns = ["Bien_Tipo_Id", "Cuenta"]

    all_object_keys_df = (
        cabecera_df[object_columns]
        .drop_duplicates()
        .copy()
    )

    selected_keys: list[tuple[str, str]] = []
    selected_keys_set: set[tuple[str, str]] = set()

    # ========================================================
    # 1. SELECCIONAR PRIMERO OBJETOS PRIORITARIOS
    # ========================================================
    #
    # Ejemplo para Agua:
    # Tipo_Ingreso_Id 801 / 802 = conexiones.
    #

    if priority_tipo_ingreso_ids_str:
        if "Tipo_Ingreso_Id" not in cabecera_df.columns:
            raise ValueError(
                "Se indicó priority_tipo_ingreso_ids, pero cabecera no tiene Tipo_Ingreso_Id."
            )

        priority_rows_df = cabecera_df[
            cabecera_df["Tipo_Ingreso_Id"]
            .astype(str)
            .str.strip()
            .isin(priority_tipo_ingreso_ids_str)
        ]

        priority_object_keys_df = (
            priority_rows_df[object_columns]
            .drop_duplicates()
            .copy()
        )

        if len(priority_object_keys_df) > limit_objects:
            raise ValueError(
                f"Hay {len(priority_object_keys_df)} objetos prioritarios, "
                f"pero el límite es {limit_objects}. "
                "Aumentá limit_objects o reducí los tipos prioritarios."
            )

        for _, row in priority_object_keys_df.iterrows():
            key = (
                str(row["Bien_Tipo_Id"]).strip(),
                str(row["Cuenta"]).strip(),
            )

            if key not in selected_keys_set:
                selected_keys.append(key)
                selected_keys_set.add(key)

    # ========================================================
    # 2. COMPLETAR CON OBJETOS NO PRIORITARIOS HASTA EL LÍMITE
    # ========================================================

    for _, row in all_object_keys_df.iterrows():
        if len(selected_keys) >= limit_objects:
            break

        key = (
            str(row["Bien_Tipo_Id"]).strip(),
            str(row["Cuenta"]).strip(),
        )

        if key not in selected_keys_set:
            selected_keys.append(key)
            selected_keys_set.add(key)

    allowed_keys = set(selected_keys)

    # ========================================================
    # 3. FILTRAR CABECERA Y DETALLE USANDO LOS OBJETOS ELEGIDOS
    # ========================================================

    cabecera_keys = list(
        zip(
            cabecera_df["Bien_Tipo_Id"].astype(str).str.strip(),
            cabecera_df["Cuenta"].astype(str).str.strip(),
        )
    )

    detalle_keys = list(
        zip(
            detalle_df["Bien_Tipo_Id"].astype(str).str.strip(),
            detalle_df["Cuenta"].astype(str).str.strip(),
        )
    )

    limited_cabecera_df = cabecera_df[
        [key in allowed_keys for key in cabecera_keys]
    ].copy()

    limited_detalle_df = detalle_df[
        [key in allowed_keys for key in detalle_keys]
    ].copy()

    return limited_cabecera_df, limited_detalle_df


# Extrae archivos desde carpeta y opcionalmente limita la cantidad de objetos.
# También permite priorizar ciertos Tipo_Ingreso_Id dentro del límite.
def extract_from_input_folder_limited(
    folder_name: str,
    limit_objects: int | None = None,
    priority_tipo_ingreso_ids: list[int] | None = None,
) -> ExtractedSourceData:

    source_data = extract_from_input_folder(folder_name)

    cabecera_df, detalle_df = limit_by_debtor_objects(
        cabecera_df=source_data.cabecera_df,
        detalle_df=source_data.detalle_df,
        limit_objects=limit_objects,
        priority_tipo_ingreso_ids=priority_tipo_ingreso_ids,
    )

    return ExtractedSourceData(
        cabecera_df=cabecera_df,
        detalle_df=detalle_df,
        cabecera_path=source_data.cabecera_path,
        detalle_path=source_data.detalle_path,
    )


# Imprime un resumen simple de los archivos leídos. Sirve para probar que EXTRACT funciona correctamente.
def print_extraction_summary(source_data: ExtractedSourceData) -> None:

    print("EXTRACT OK")
    print("-" * 80)

    print(f"Cabecera: {source_data.cabecera_path}")
    print(
        f"Filas cabecera: {len(source_data.cabecera_df)} | "
        f"Columnas cabecera: {len(source_data.cabecera_df.columns)}"
    )

    print()

    print(f"Detalle: {source_data.detalle_path}")
    print(
        f"Filas detalle: {len(source_data.detalle_df)} | "
        f"Columnas detalle: {len(source_data.detalle_df.columns)}"
    )

    print("-" * 80)

    print("Primeras columnas de cabecera:")
    print(list(source_data.cabecera_df.columns[:10]))

    print()

    print("Primeras columnas de detalle:")
    print(list(source_data.detalle_df.columns[:10]))


def main(argv=None):
    parser = argparse.ArgumentParser(description='Lectura TSV/CSV/XLSX y validación dry-run; no escribe ni publica.')
    parser.add_argument('--cabecera', type=Path, required=True)
    parser.add_argument('--detalle', type=Path, required=True)
    parser.add_argument('--mapping', type=Path, required=True)
    parser.add_argument('--contract', type=Path, default=DEFAULT_CONTRACT)
    parser.add_argument('--cut-off', required=True)
    args = parser.parse_args(argv)
    try:
        contract = load_contract(args.contract)
        mapping = load_source_profile(args.mapping, contract)
        report = validate_source_files({'cabecera': args.cabecera, 'detalle': args.detalle}, mapping,
                                       contract=contract, cut_off=args.cut_off)
    except ValidationError as error:
        print(str(error))
        return 2
    print(render_markdown(report), end='')
    return 1 if report['resultado_lote'] == 'BLOQUEADO' else 0


if __name__ == '__main__':
    raise SystemExit(main())
