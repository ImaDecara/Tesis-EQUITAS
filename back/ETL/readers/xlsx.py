"""Lector XLSX seguro: mide el paquete antes de abrirlo y solo interpreta lo que usa.

Lee con openpyxl en modo ``read_only=True, data_only=True``: no evalúa fórmulas, no sigue
vínculos externos y no extrae nada a disco. Usa ``ExcelReader`` (lo que ``load_workbook``
hace por dentro) porque ``load_workbook`` no se puede acotar ni interrumpir: arma un árbol
por cada hoja, incluidas las ignoradas, solo para buscar su dimensión; arma enteras las
cadenas compartidas; y aplica expresiones regulares cuadráticas a nombres definidos y a
formatos numéricos. Un archivo de 3 MB alcanzaba para consumir más de 3 GiB o colgar el
proceso.

Orden de defensa, cada paso antes del siguiente:

1. Fin del ZIP: cantidad de partes y tamaño del directorio, sin armarlo.
2. Directorio: tamaños y razón declarados, nombres, cifrado y macros, sin abrir ninguna parte.
3. Todas las partes en flujo: CRC, tamaño real y ningún DTD en el XML.
4. Tipos de contenido, libro, relaciones y estilos: bytes y elementos acotados antes de que
   openpyxl los arme enteros.
5. Cadenas y hojas elegidas: en flujo, con tope de elementos y profundidad; ningún elemento
   sobrevive a su fila o cadena. Las hojas no elegidas no se interpretan.

openpyxl decide qué parte es cada hoja: no hay una segunda lectura del libro que pueda
contradecirla.
"""

from __future__ import annotations

import math
import re
import struct
import warnings
import zipfile
import zlib
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from defusedxml.common import DefusedXmlException
from defusedxml.ElementTree import ParseError, iterparse
from openpyxl import DEFUSEDXML
from openpyxl.cell.text import Text
from openpyxl.packaging.relationship import get_rels_path
from openpyxl.reader.excel import ExcelReader
from openpyxl.styles.stylesheet import apply_stylesheet
from openpyxl.utils.datetime import MAC_EPOCH, WINDOWS_EPOCH, from_excel
from openpyxl.worksheet._read_only import ReadOnlyWorksheet
from openpyxl.worksheet._reader import (
    FORMULA_TAG,
    INLINE_STRING,
    ROW_TAG,
    VALUE_TAG,
    WorkSheetParser,
)
from openpyxl.xml.constants import (
    ARC_CONTENT_TYPES,
    ARC_STYLE,
    SHARED_STRINGS,
    SHEET_MAIN_NS,
    XLSX,
)

from ETL.readers.limits import (
    check_cells,
    check_header,
    sanitize_filename,
    source_error,
)
from ETL.validate_source import SourceRow, SourceTable, ValidationError

EPOCHS = {'1900': WINDOWS_EPOCH, '1904': MAC_EPOCH}
MAX_SHEET_ROW = 1_048_576
MAX_SHEET_COLUMN = 16_384
CELL_TAG = f'{{{SHEET_MAIN_NS}}}c'
STRING_TAG = f'{{{SHEET_MAIN_NS}}}si'
# Topes de Excel; openpyxl aplica a cada formato una expresión regular cuadrática.
MAX_FORMAT_CODE = 255
MAX_CELL_FORMATS = 65_490
_END_RECORD = b'PK\x05\x06'
_END_RECORD_TAIL = 22 + 65_535
_ZIP64_LOCATOR = b'PK\x06\x07'
_CHUNK = 1 << 16
_MACRO_MARKS = ('macroenabled', 'vbaproject', 'macrosheet')
# Excel guarda los caracteres de control de una celda como texto: _x0007_.
_EXCEL_CONTROL = re.compile(r'_x00(?:[01][0-9A-Fa-f]|7[Ff]|[89][0-9A-Fa-f])_')


@dataclass
class WorkbookTables:
    tables: dict[str, SourceTable]
    # Solo para el preview autorizado: las eligió el municipio, no el contrato.
    ignored_sheets: list[str]


def _local(tag):
    return tag.rpartition('}')[2]


def _check_end_record(stream, kind, limits):
    """Mide el directorio central sin armarlo: ZipFile crea un objeto por entrada."""
    size = stream.seek(0, 2)
    stream.seek(max(0, size - _END_RECORD_TAIL))
    tail = stream.read()
    stream.seek(0)
    position = tail.rfind(_END_RECORD)
    if position < 0 or position + 22 > len(tail):
        source_error('ZIP_CORRUPTO', kind)
    entries, directory_bytes = struct.unpack('<HI', tail[position + 10:position + 16])
    # Zip64 es innecesario hasta 25 MB y su registro reemplazaría los valores que se miden acá.
    if entries == 0xFFFF or directory_bytes == 0xFFFFFFFF or tail[max(0, position - 20):position].startswith(_ZIP64_LOCATOR):
        source_error('ZIP_CORRUPTO', kind)
    if entries > limits.zip_parts or directory_bytes > limits.zip_directory_bytes:
        source_error('LIMITE_PARTES_ZIP_EXCEDIDO', kind)


def _check_directory(archive, kind, limits):
    """Tamaño y razón declarados, antes de descomprimir nada."""
    infos = archive.infolist()
    if len(infos) > limits.zip_parts:
        source_error('LIMITE_PARTES_ZIP_EXCEDIDO', kind)
    names = [info.filename for info in infos]
    if len(set(names)) != len(names):
        source_error('ZIP_CORRUPTO', kind)
    uncompressed = compressed = 0
    for info in infos:
        segments = info.filename.split('/')
        if info.filename.startswith('/') or '\\' in info.filename or '..' in segments:
            source_error('ZIP_CORRUPTO', kind)
        if info.flag_bits & 0x1 or info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            source_error('ZIP_CORRUPTO', kind)
        if segments[-1].lower() == 'vbaproject.bin':
            source_error('MACRO_NO_PERMITIDA', kind)
        uncompressed += info.file_size
        compressed += info.compress_size
    if uncompressed > limits.uncompressed_bytes:
        source_error('TAMANO_DESCOMPRIMIDO_EXCEDIDO', kind)
    if uncompressed > limits.compression_ratio * max(compressed, 1) or any(
            info.file_size >= limits.ratio_floor_bytes
            and info.file_size > limits.compression_ratio * max(info.compress_size, 1) for info in infos):
        source_error('RAZON_COMPRESION_EXCEDIDA', kind)
    return infos


def _check_parts(archive, infos, kind, deadline):
    """CRC y tamaño real de cada parte, y ningún DTD en el XML; nada más se interpreta acá."""
    for info in infos:
        with archive.open(info) as part:
            if info.filename.lower().endswith(('.xml', '.rels')):
                # Un DOCTYPE solo puede ir antes del elemento raíz.
                next(iterparse(part, events=('start',), forbid_dtd=True), None)
            while part.read(_CHUNK):
                deadline.check(kind)


def _checked_tree(archive, name, kind, limits):
    """Árbol de una parte que openpyxl arma entera; primero la mide, sin DTD ni entidades."""
    if archive.getinfo(name).file_size > limits.part_bytes:
        source_error('LIMITE_PARTE_ZIP_EXCEDIDO', kind)
    elements = depth = 0
    with archive.open(name) as part:
        parser = iterparse(part, events=('start', 'end'), forbid_dtd=True)
        for event, _ in parser:
            if event == 'end':
                depth -= 1
                continue
            depth += 1
            elements += 1
            if depth > limits.xml_depth or elements > limits.part_elements:
                source_error('LIMITE_XML_EXCEDIDO', kind)
        return parser.root


def _units(source, unit_tag, kind, limits, deadline):
    """Entrega cada ``unit_tag`` completo y suelta todo lo demás a medida que termina.

    La memoria queda acotada por la unidad en curso, cualquiera sea el tamaño de la parte.
    """
    open_elements = []
    unit = None
    inside = outside = 0
    for event, element in iterparse(source, events=('start', 'end'), forbid_dtd=True):
        if event == 'start':
            open_elements.append(element)
            if len(open_elements) > limits.xml_depth:
                source_error('LIMITE_XML_EXCEDIDO', kind)
            if unit is not None:
                inside += 1
                if inside > limits.unit_elements:
                    source_error('LIMITE_XML_EXCEDIDO', kind)
            elif element.tag == unit_tag:
                unit, inside = element, 0
            else:
                outside += 1
                if outside > limits.other_elements:
                    source_error('LIMITE_XML_EXCEDIDO', kind)
                if not outside % 4096:
                    deadline.check(kind)
            continue
        open_elements.pop()
        if element is unit:
            unit = None
            yield element
        if unit is None and open_elements:
            open_elements[-1].remove(element)


def _check_manifest(package, names, kind):
    """Devuelve la parte del libro; openpyxl elegiría una plantilla antes que un libro."""
    declared = [item.ContentType for item in (*package.Default, *package.Override)]
    if any(mark in value.lower() for value in declared for mark in _MACRO_MARKS):
        source_error('MACRO_NO_PERMITIDA', kind)
    workbooks = [item for item in package.Override if '.main+xml' in item.ContentType and 'spreadsheetml' in item.ContentType]
    if len(workbooks) != 1 or workbooks[0].ContentType != XLSX or workbooks[0].PartName[1:] not in names:
        source_error('FORMATO_NO_SOPORTADO', kind)
    return workbooks[0].PartName[1:]


def _check_workbook(root, kind, limits):
    if sum(_local(node.tag) == 'sheet' for node in root.iter()) > limits.workbook_sheets:
        source_error('LIMITE_HOJAS_EXCEDIDO', kind)


def _check_relations(root, kind):
    if any(mark in node.get('Type', '').lower() for node in root for mark in ('vbaproject', 'macrosheet')):
        source_error('MACRO_NO_PERMITIDA', kind)


def _check_styles(root, kind):
    formats = 0
    for node in root.iter():
        name = _local(node.tag)
        if name == 'numFmt' and len(node.get('formatCode', '')) > MAX_FORMAT_CODE:
            source_error('LIMITE_XML_EXCEDIDO', kind)
        if name == 'xf':
            formats += 1
    if formats > MAX_CELL_FORMATS:
        source_error('LIMITE_XML_EXCEDIDO', kind)


class _SelectedSheet(ReadOnlyWorksheet):
    def _get_size(self):
        """La dimensión declarada puede mentir, y buscarla recorre la hoja entera."""


class _SheetParser(WorkSheetParser):
    """El intérprete de filas y celdas de openpyxl, en flujo y sin perder datos en silencio."""

    def __init__(self, source, sheet, kind, limits, deadline):
        workbook = sheet.parent
        super().__init__(source, sheet._shared_strings, data_only=True, epoch=workbook.epoch,
                         date_formats=workbook._date_formats, timedelta_formats=workbook._timedelta_formats)
        self.kind = kind
        self.limits = limits
        self.deadline = deadline

    def parse(self):
        for row in _units(self.source, ROW_TAG, self.kind, self.limits, self.deadline):
            self.deadline.check(self.kind, self.row_counter)
            yield self.parse_row(row)

    def parse_row(self, row):
        previous = self.row_counter
        line, cells = super().parse_row(row)
        self.row_dimensions.clear()
        # openpyxl descarta en silencio una fila repetida o fuera de orden.
        if not previous < line <= MAX_SHEET_ROW:
            source_error('ESTRUCTURA_INVALIDA', self.kind, previous)
        return line, cells

    def parse_cell(self, element):
        line, previous = self.row_counter, self.col_counter
        if element.tag != CELL_TAG:
            source_error('ESTRUCTURA_INVALIDA', self.kind, line)
        stored = element.find(VALUE_TAG)
        if stored is not None and stored.text and len(stored.text) > self.limits.cell:
            source_error('CELDA_EXCEDE_LIMITE', self.kind, line)
        if element.find(FORMULA_TAG) is not None and not (
                element.find(INLINE_STRING) is not None
                # t="str" con <v> vacío es un resultado guardado de texto vacío.
                or (stored is not None and (stored.text or element.get('t') == 'str'))):
            source_error('FORMULA_SIN_VALOR', self.kind, line)
        cell = super().parse_cell(element)
        # openpyxl se queda con la última de dos celdas en la misma posición.
        if cell['row'] != line or not previous < cell['column'] <= MAX_SHEET_COLUMN:
            source_error('ESTRUCTURA_INVALIDA', self.kind, line)
        if cell['value'] is not None and cell['column'] > self.limits.columns:
            source_error('LIMITE_ARCHIVO_EXCEDIDO', self.kind, line)
        return cell


class _PackageReader(ExcelReader):
    """``load_workbook`` sin lo que este lector no usa: propiedades, tema, nombres definidos,
    hojas no elegidas. Cada parte se acota antes de que openpyxl la interprete."""

    def __init__(self, stream, kind, limits, deadline):
        super().__init__(stream, read_only=True, data_only=True, keep_links=False)
        self.kind = kind
        self.limits = limits
        self.deadline = deadline

    def _tree(self, name):
        return _checked_tree(self.archive, name, self.kind, self.limits)

    def read_strings(self):
        part = self.package.find(SHARED_STRINGS)
        if part is None:
            return
        limits, kind = self.limits, self.kind
        strings = self.shared_strings = []
        with self.archive.open(part.PartName[1:]) as source:
            for unit in _units(source, STRING_TAG, kind, limits, self.deadline):
                self.deadline.check(kind)
                text = Text.from_tree(unit).content.replace('x005F_', '')
                if len(text) > limits.cell:
                    source_error('CELDA_EXCEDE_LIMITE', kind)
                if len(strings) >= limits.shared_strings:
                    source_error('LIMITE_CADENAS_EXCEDIDO', kind)
                strings.append(text)

    def read(self):
        infos = _check_directory(self.archive, self.kind, self.limits)
        _check_parts(self.archive, infos, self.kind, self.deadline)
        if ARC_CONTENT_TYPES not in self.valid_files:
            source_error('FORMATO_NO_SOPORTADO', self.kind)
        self._tree(ARC_CONTENT_TYPES)
        self.read_manifest()
        workbook_part = _check_manifest(self.package, self.valid_files, self.kind)
        _check_workbook(self._tree(workbook_part), self.kind, self.limits)
        _check_relations(self._tree(get_rels_path(workbook_part)), self.kind)
        if ARC_STYLE in self.valid_files:
            _check_styles(self._tree(ARC_STYLE), self.kind)
        self.read_strings()
        self.read_workbook()
        apply_stylesheet(self.archive, self.wb)

    def sheet_parts(self):
        """Nombre de hoja -> parte, según openpyxl: no hay una segunda lectura que la contradiga."""
        sheets = [(sheet.name, relation.target) for sheet, relation in self.parser.find_sheets()]
        result = dict(sheets)
        if len(result) != len(sheets):
            source_error('ESTRUCTURA_INVALIDA', self.kind)
        return result

    def selected_sheet(self, name, part):
        if part not in self.valid_files:
            source_error('HOJA_NO_ENCONTRADA', self.kind)
        return _SelectedSheet(self.wb, name, part, self.shared_strings)


def _number_text(value, decimal_separator='.'):
    if isinstance(value, int):
        return str(value)
    # 15 dígitos significativos: lo que Excel muestra y guardó el usuario, sin ruido binario.
    text = format(Decimal(format(value, '.15g')), 'f')
    return text.replace('.', decimal_separator)


def _date_text(value, date_format):
    text = value.isoformat()[:10]
    if date_format == 'dd/mm/aaaa':
        text = f'{text[8:10]}/{text[5:7]}/{text[:4]}'
    if isinstance(value, datetime) and value.time() != time(0):
        # Una hora no es parte del contrato: queda visible y el motor la marca inválida.
        text += value.strftime(' %H:%M:%S')
    return text


def _cell_text(cell, field_type, fmt, kind, line):
    """Una celda como texto del contrato. Nunca inventa un valor ni evalúa una fórmula."""
    value = cell.value
    if value is None:
        return ''
    if cell.data_type == 'e':
        source_error('CELDA_CON_ERROR', kind, line)
    if isinstance(value, str):
        if '_x' in value and _EXCEL_CONTROL.search(value):
            source_error('CARACTER_CONTROL', kind, line)
        return value
    if isinstance(value, (bool, time, timedelta)):
        source_error('CELDA_TIPO_NO_SOPORTADO', kind, line)
    if isinstance(value, (date, datetime)):
        if 'fecha_serial' not in fmt:
            source_error('FECHA_SERIAL_NO_DECLARADA', kind, line)
        return _date_text(value, fmt['fecha'])
    if not math.isfinite(value):
        source_error('CELDA_TIPO_NO_SOPORTADO', kind, line)
    # El 29/02/1900 no existió: 60 en el sistema 1900 queda crudo y el motor lo marca.
    if field_type == 'fecha' and 'fecha_serial' in fmt and value >= 1 and not (value == 60 and fmt['fecha_serial'] == '1900'):
        try:
            parsed = from_excel(value, EPOCHS[fmt['fecha_serial']])
        except (OverflowError, ValueError):
            parsed = None
        if isinstance(parsed, datetime):
            return _date_text(parsed, fmt['fecha'])
    if field_type == 'porcentaje':
        if '%' in cell.number_format:
            value = Decimal(format(value, '.15g')) * 100
            return format(value.normalize(), 'f').replace('.', fmt['decimal'])
        return _number_text(value, fmt['decimal'])
    if field_type == 'importe':
        return _number_text(value, fmt['decimal'])
    return _number_text(value)


def _read_sheet(sheet, kind, field_types, fmt, limits, deadline):
    columns = None
    rows = []
    with sheet._get_source() as source:
        for line, parsed in _SheetParser(source, sheet, kind, limits, deadline).parse():
            cells = sheet._get_row(parsed, 1, limits.columns)
            if columns is None:
                raw_columns = [_cell_text(cell, 'texto', fmt, kind, line) for cell in cells] if line == 1 else []
                while raw_columns and not raw_columns[-1]:
                    raw_columns.pop()
                check_cells(raw_columns, kind, 1, limits)
                columns = check_header(raw_columns, kind, limits)
                types = [field_types.get(name, 'texto') for name in columns]
                width = len(columns)
                continue
            if all(cell.value is None for cell in cells):
                continue
            if len(rows) >= limits.rows:
                source_error('LIMITE_ARCHIVO_EXCEDIDO', kind, line)
            if any(cell.value is not None for cell in cells[width:]):
                source_error('ESTRUCTURA_INVALIDA', kind, line)
            values = [_cell_text(cell, field_type, fmt, kind, line) for cell, field_type in zip(cells, types, strict=False)]
            check_cells(values, kind, line, limits)
            rows.append(SourceRow(line, dict(zip(columns, values, strict=True))))
    if columns is None:
        check_header([], kind, limits)
    return SourceTable(columns, rows)


def read_workbook(stream, selection, fmt, field_types, limits, deadline):
    """Lee las hojas elegidas por el perfil; ``selection`` es archivo lógico -> hoja.

    Las demás hojas se listan e ignoran. Ante cualquier defecto lanza un error seguro y
    no entrega un prefijo parcial.
    """
    kind = next(iter(selection))
    reader = None
    try:
        if not DEFUSEDXML:
            source_error('XML_SEGURO_NO_DISPONIBLE', kind)
        _check_end_record(stream, kind, limits)
        reader = _PackageReader(stream, kind, limits, deadline)
        # Las advertencias de openpyxl pueden citar valores de celda.
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            reader.read()
            parts = reader.sheet_parts()
            chosen = [parts.get(name) for name in selection.values()]
            for logical, name in selection.items():
                if parts.get(name) not in reader.valid_files:
                    source_error('HOJA_NO_ENCONTRADA', logical)
            if len(set(chosen)) != len(chosen):
                source_error('ESTRUCTURA_INVALIDA', kind)
            if 'fecha_serial' in fmt and reader.wb.epoch != EPOCHS[fmt['fecha_serial']]:
                source_error('SISTEMA_FECHAS_NO_COINCIDE', kind)
            tables = {logical: _read_sheet(reader.selected_sheet(name, parts[name]), logical, field_types[logical],
                                           fmt, limits, deadline)
                      for logical, name in selection.items()}
        ignored = [sanitize_filename(name, 31) for name in parts if name not in selection.values()]
        return WorkbookTables(tables, ignored)
    except ValidationError:
        raise
    except DefusedXmlException:
        code = 'XML_ENTIDAD_EXTERNA'
    except (zipfile.BadZipFile, zlib.error, EOFError):
        code = 'ZIP_CORRUPTO'
    except ParseError:
        code = 'XML_INVALIDO'
    except Exception:  # noqa: BLE001 - openpyxl deja escapar errores de muy distinto tipo ante un archivo hostil.
        code = 'ARCHIVO_NO_LEIBLE'
    finally:
        if reader is not None:
            reader.archive.close()
    source_error(code, kind)
