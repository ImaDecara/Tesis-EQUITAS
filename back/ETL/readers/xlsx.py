"""Lector XLSX seguro: verifica el paquete antes de abrirlo y entrega SourceTable.

Orden de defensa: directorio ZIP (partes, tamaños, razón, nombres y macros), tipos de
contenido, recorrido en flujo de cada parte (CRC y XML con defusedxml) y recién entonces
openpyxl en modo ``read_only=True, data_only=True``. No se evalúan fórmulas, no se siguen
vínculos externos, no se extrae nada a disco y las hojas no elegidas no se interpretan.
"""

from __future__ import annotations

import math
import posixpath
import struct
import warnings
import zipfile
import zlib
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from xml.sax import SAXParseException
from xml.sax.handler import ContentHandler

from defusedxml import ElementTree as SafeElementTree
from defusedxml.common import DefusedXmlException
from defusedxml.expatreader import create_parser
from openpyxl import DEFUSEDXML, load_workbook
from openpyxl.utils.datetime import MAC_EPOCH, WINDOWS_EPOCH, from_excel
from openpyxl.utils.exceptions import InvalidFileException

from ETL.readers.limits import (
    check_cells,
    check_header,
    sanitize_filename,
    source_error,
)
from ETL.validate_source import SourceRow, SourceTable, ValidationError

WORKBOOK_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
WORKSHEET_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
SHARED_STRINGS_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml'
CONTENT_TYPES = '[Content_Types].xml'
EPOCHS = {'1900': WINDOWS_EPOCH, '1904': MAC_EPOCH}
MAX_SHEET_ROW = 1_048_576
_END_RECORD = b'PK\x05\x06'
_END_RECORD_TAIL = 22 + 65_535
_CHUNK = 1 << 16
# openpyxl deja escapar errores de muy distinto tipo ante un archivo hostil.
_HOSTILE_FILE_ERRORS = (ArithmeticError, AssertionError, AttributeError, LookupError, MemoryError, OSError,
                        RuntimeError, TypeError, ValueError, struct.error, InvalidFileException)


@dataclass
class WorkbookTables:
    tables: dict[str, SourceTable]
    # Solo para el preview autorizado: las eligió el municipio, no el contrato.
    ignored_sheets: list[str]


class _StopAtRoot(Exception):
    pass


class _PrologScan(ContentHandler):
    """DOCTYPE y entidades solo pueden estar antes del elemento raíz."""

    def startElement(self, name, attrs):
        raise _StopAtRoot


class _SheetScan(ContentHandler):
    """Recorre una hoja sin armar celdas: límites y fórmulas sin valor antes de openpyxl."""

    def __init__(self, kind, limits):
        super().__init__()
        self.kind = kind
        self.limits = limits
        self.rows = 0
        self.row = 0
        self.column = 0
        self.row_has_content = False
        self.cell_type = None
        self.in_value = self.has_value_tag = self.has_text = self.has_formula = False

    def startElement(self, name, attrs):
        name = name.rpartition(':')[2]
        if name == 'c':
            reference = attrs.get('r')
            self.column = _column_index(reference) if reference else self.column + 1
            self.cell_type = attrs.get('t')
            self.has_value_tag = self.has_text = self.has_formula = False
        elif name == 'v':
            self.in_value = self.has_value_tag = True
        elif name == 'f':
            self.has_formula = True
        elif name == 'is':
            self.has_text = True
        elif name == 'row':
            reference = attrs.get('r')
            self.row = int(reference) if reference else self.row + 1
            self.column = 0
            self.row_has_content = False
            if not 1 <= self.row <= MAX_SHEET_ROW:
                source_error('ESTRUCTURA_INVALIDA', self.kind)

    def characters(self, content):
        if self.in_value and content:
            self.has_text = True

    def endElement(self, name):
        name = name.rpartition(':')[2]
        if name == 'v':
            self.in_value = False
        elif name == 'c':
            # t="str" con <v> vacío es un resultado guardado de texto vacío.
            if self.has_formula and not (self.has_text or (self.has_value_tag and self.cell_type == 'str')):
                source_error('FORMULA_SIN_VALOR', self.kind, self.row)
            if self.has_text:
                self.row_has_content = True
                if self.column > self.limits.columns:
                    source_error('LIMITE_ARCHIVO_EXCEDIDO', self.kind, self.row)
        elif name == 'row' and self.row_has_content:
            self.rows += 1
            if self.rows > self.limits.rows + 1:
                source_error('LIMITE_ARCHIVO_EXCEDIDO', self.kind, self.row)


def _column_index(reference):
    index = 0
    # Excel llega a tres letras: una cuarta ya supera cualquier límite.
    for char in reference[:4]:
        if not 'A' <= char <= 'Z':
            break
        index = index * 26 + ord(char) - 64
    return index


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
    if entries == 0xFFFF or directory_bytes == 0xFFFFFFFF:  # Zip64: innecesario hasta 25 MB.
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
            raise ValidationError('MACRO_NO_PERMITIDA')
        uncompressed += info.file_size
        compressed += info.compress_size
    if uncompressed > limits.uncompressed_bytes:
        source_error('TAMANO_DESCOMPRIMIDO_EXCEDIDO', kind)
    if uncompressed > limits.compression_ratio * max(compressed, 1) or any(
            info.file_size > limits.compression_ratio * max(info.compress_size, 1) for info in infos):
        source_error('RAZON_COMPRESION_EXCEDIDA', kind)
    return infos


def _parse_part(archive, name, kind, limits):
    if archive.getinfo(name).file_size > limits.part_bytes:
        source_error('LIMITE_PARTE_ZIP_EXCEDIDO', kind)
    return SafeElementTree.fromstring(archive.read(name), forbid_dtd=True)


def _local(tag):
    return tag.rpartition('}')[2]


def _content_types(archive, kind, limits):
    """Devuelve la parte del libro y el tipo de cada parte declarada."""
    if CONTENT_TYPES not in archive.namelist():
        source_error('FORMATO_NO_SOPORTADO', kind)
    root = _parse_part(archive, CONTENT_TYPES, kind, limits)
    declared = [node.get('ContentType', '') for node in root]
    if any('macroenabled' in value.lower() or 'vbaproject' in value.lower() for value in declared):
        raise ValidationError('MACRO_NO_PERMITIDA')
    overrides = {node.get('PartName', '').lstrip('/'): node.get('ContentType', '')
                 for node in root if _local(node.tag) == 'Override'}
    workbooks = [name for name, value in overrides.items() if value == WORKBOOK_TYPE]
    if len(workbooks) != 1 or workbooks[0] not in archive.namelist():
        source_error('FORMATO_NO_SOPORTADO', kind)
    return workbooks[0], overrides


def _check_part_sizes(infos, overrides, kind, limits):
    for info in infos:
        declared = overrides.get(info.filename)
        if declared == WORKSHEET_TYPE:
            continue
        limit = limits.shared_strings_bytes if declared == SHARED_STRINGS_TYPE else limits.part_bytes
        if info.file_size > limit:
            source_error('LIMITE_PARTE_ZIP_EXCEDIDO', kind)


def _sheet_parts(archive, workbook_part, kind, limits):
    """Nombre de hoja -> parte, leídos del libro sin abrirlo con openpyxl."""
    root = _parse_part(archive, workbook_part, kind, limits)
    directory, base = posixpath.split(workbook_part)
    relations = _parse_part(archive, posixpath.join(directory, '_rels', base + '.rels'), kind, limits)
    targets = {}
    for relation in relations:
        target = relation.get('Target', '')
        targets[relation.get('Id')] = (target.lstrip('/') if target.startswith('/')
                                       else posixpath.normpath(posixpath.join(directory, target)))
    sheets = {}
    nodes = [node for node in root.iter() if _local(node.tag) == 'sheet']
    if len(nodes) > limits.workbook_sheets:
        source_error('LIMITE_HOJAS_EXCEDIDO', kind)
    for node in nodes:
        name = node.get('name')
        relation = next((value for key, value in node.attrib.items() if _local(key) == 'id'), None)
        if name in sheets:
            source_error('ESTRUCTURA_INVALIDA', kind)
        sheets[name] = targets.get(relation)
    return sheets


def _scan_parts(archive, infos, scans, kind, deadline):
    """Lee cada parte en flujo: CRC, tamaño real y XML sin DTD ni entidades."""
    for info in infos:
        scan = scans.get(info.filename)
        is_xml = scan is not None or info.filename.lower().endswith(('.xml', '.rels'))
        parser = None
        if is_xml:
            parser = create_parser(forbid_dtd=True, forbid_entities=True, forbid_external=True)
            parser.setContentHandler(scan or _PrologScan())
        with archive.open(info) as part:
            while chunk := part.read(_CHUNK):
                deadline.check(kind)
                if parser is not None:
                    try:
                        parser.feed(chunk)
                    except _StopAtRoot:
                        parser = None
        if parser is not None:
            parser.close()


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
        return value
    if isinstance(value, (bool, time, timedelta)):
        source_error('CELDA_TIPO_NO_SOPORTADO', kind, line)
    if isinstance(value, (date, datetime)):
        if 'fecha_serial' not in fmt:
            source_error('FECHA_SERIAL_NO_DECLARADA', kind, line)
        return _date_text(value, fmt['fecha'])
    if not math.isfinite(value):
        source_error('CELDA_TIPO_NO_SOPORTADO', kind, line)
    if field_type == 'fecha' and 'fecha_serial' in fmt and value >= 1:
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
    # La dimensión declarada puede mentir y openpyxl truncaría el resto en silencio.
    sheet.reset_dimensions()
    cells_by_row = sheet.iter_rows(max_col=limits.columns)
    raw_columns = [_cell_text(cell, 'texto', fmt, kind, 1) for cell in next(cells_by_row, ())]
    while raw_columns and not raw_columns[-1]:
        raw_columns.pop()
    check_cells(raw_columns, kind, 1, limits)
    columns = check_header(raw_columns, kind, limits)
    types = [field_types.get(name, 'texto') for name in columns]
    width = len(columns)
    rows = []
    for line, cells in enumerate(cells_by_row, start=2):
        deadline.check(kind, line)
        if all(cell.value is None for cell in cells):
            continue
        if len(rows) >= limits.rows:
            source_error('LIMITE_ARCHIVO_EXCEDIDO', kind, line)
        if any(cell.value is not None for cell in cells[width:]):
            source_error('ESTRUCTURA_INVALIDA', kind, line)
        values = [_cell_text(cell, field_type, fmt, kind, line) for cell, field_type in zip(cells, types, strict=False)]
        values += [''] * (width - len(values))
        check_cells(values, kind, line, limits)
        rows.append(SourceRow(line, dict(zip(columns, values, strict=True))))
    return SourceTable(columns, rows)


def read_workbook(stream, selection, fmt, field_types, limits, deadline):
    """Lee las hojas elegidas por el perfil; ``selection`` es archivo lógico -> hoja.

    Las demás hojas se listan e ignoran. Ante cualquier defecto lanza un error seguro y
    no entrega un prefijo parcial.
    """
    kind = next(iter(selection))
    workbook = None
    try:
        if not DEFUSEDXML:
            source_error('XML_SEGURO_NO_DISPONIBLE', kind)
        _check_end_record(stream, kind, limits)
        with zipfile.ZipFile(stream) as archive:
            infos = _check_directory(archive, kind, limits)
            workbook_part, overrides = _content_types(archive, kind, limits)
            _check_part_sizes(infos, overrides, kind, limits)
            sheets = _sheet_parts(archive, workbook_part, kind, limits)
            scans = {}
            for logical, name in selection.items():
                if sheets.get(name) not in archive.namelist():
                    source_error('HOJA_NO_ENCONTRADA', logical)
                scans[sheets[name]] = _SheetScan(logical, limits)
            _scan_parts(archive, infos, scans, kind, deadline)
        stream.seek(0)
        # Las advertencias de openpyxl pueden citar valores de celda.
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            workbook = load_workbook(stream, read_only=True, data_only=True, keep_links=False)
            if 'fecha_serial' in fmt and workbook.epoch != EPOCHS[fmt['fecha_serial']]:
                source_error('SISTEMA_FECHAS_NO_COINCIDE', kind)
            tables = {logical: _read_sheet(workbook[name], logical, field_types[logical], fmt, limits, deadline)
                      for logical, name in selection.items()}
        ignored = [sanitize_filename(name, 31) for name in sheets if name not in selection.values()]
        return WorkbookTables(tables, ignored)
    except ValidationError:
        raise
    except DefusedXmlException:
        source_error('XML_ENTIDAD_EXTERNA', kind)
    except (zipfile.BadZipFile, zlib.error, EOFError):
        source_error('ZIP_CORRUPTO', kind)
    except (SAXParseException, SafeElementTree.ParseError):
        source_error('XML_INVALIDO', kind)
    except _HOSTILE_FILE_ERRORS:
        source_error('ARCHIVO_NO_LEIBLE', kind)
    finally:
        if workbook is not None:
            workbook.close()
