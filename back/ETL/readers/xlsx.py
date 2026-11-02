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
3. Todas las partes byte a byte: cabecera local igual al directorio, partes contiguas, flujo
   comprimido consumido entero, bytes reales y CRC. Desde acá, lo declarado es lo real: los
   límites del paso 2 quedan acreditados. Después, ningún DTD en el XML.
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
TEXT_TAG = f'{{{SHEET_MAIN_NS}}}t'
# Topes de Excel; openpyxl aplica a cada formato una expresión regular cuadrática.
MAX_FORMAT_CODE = 255
MAX_CELL_FORMATS = 65_490
_END_RECORD = b'PK\x05\x06'
_END_RECORD_TAIL = 22 + 65_535
_ZIP64_LOCATOR = b'PK\x06\x07'
_LOCAL_HEADER = struct.Struct('<4s5H3I2H')
_LOCAL_SIGNATURE = b'PK\x03\x04'
_DESCRIPTOR_SIGNATURE = b'PK\x07\x08'
_ZIP64_EXTRA = 1
_FLAG_ENCRYPTED, _FLAG_DESCRIPTOR, _FLAG_PATCHED, _FLAG_STRONG, _FLAG_UTF8, _FLAG_MASKED = 0x1, 0x8, 0x20, 0x40, 0x800, 0x2000
_FLAGS_UNSUPPORTED = _FLAG_ENCRYPTED | _FLAG_PATCHED | _FLAG_STRONG | _FLAG_MASKED
_CHUNK = 1 << 16
_MACRO_MARKS = ('macroenabled', 'vbaproject', 'macrosheet')
# Excel guarda los caracteres de control de una celda como texto: _x0007_.
_EXCEL_CONTROL = re.compile(r'_x00(?:[01][0-9A-Fa-f]|7[Ff]|[89][0-9A-Fa-f])_')
# int() y float() aceptan formas ajenas al formato: «-1», «1_0», « 0», dígitos arábigos.
_INDEX = re.compile(r'[0-9]{1,10}')
_NUMBER = re.compile(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?')
_CELL_TYPES = frozenset({'b', 'd', 'e', 'inlineStr', 'n', 's', 'str'})
# Lo que un formato numérico muestra tal cual: un % ahí adentro no escala el valor.
_FORMAT_LITERAL = re.compile(r'"[^"]*"|\\.|_.|\*.|\[[^\]]*\]', re.DOTALL)


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
    disks = struct.unpack('<HH', tail[position + 4:position + 8])
    entries, directory_bytes, directory_offset, comment = struct.unpack('<HIIH', tail[position + 10:position + 22])
    # Zip64 es innecesario hasta 25 MB y su registro reemplazaría los valores que se miden acá.
    if entries == 0xFFFF or directory_bytes == 0xFFFFFFFF or tail[max(0, position - 20):position].startswith(_ZIP64_LOCATOR):
        source_error('ZIP_CORRUPTO', kind)
    # El fin cierra el archivo y el directorio termina donde el fin empieza: sin datos delante ni detrás.
    end_at = size - len(tail) + position
    if disks != (0, 0) or position + 22 + comment != len(tail) or directory_offset + directory_bytes != end_at:
        source_error('ZIP_CORRUPTO', kind)
    if entries > limits.zip_parts or directory_bytes > limits.zip_directory_bytes:
        source_error('LIMITE_PARTES_ZIP_EXCEDIDO', kind)
    return entries


def _has_zip64(extra):
    position = 0
    while position + 4 <= len(extra):
        tag, size = struct.unpack_from('<HH', extra, position)
        if tag == _ZIP64_EXTRA:
            return True
        position += 4 + size
    return False


def _check_directory(archive, kind, limits, entries):
    """Tamaño y razón declarados, antes de descomprimir nada."""
    infos = archive.infolist()
    if len(infos) > limits.zip_parts:
        source_error('LIMITE_PARTES_ZIP_EXCEDIDO', kind)
    names = [info.filename for info in infos]
    if len(set(names)) != len(names) or len(infos) != entries:
        source_error('ZIP_CORRUPTO', kind)
    uncompressed = compressed = 0
    for info in infos:
        segments = info.filename.split('/')
        # zipfile corta el nombre en el NUL: ``orig_filename`` conserva el que trae el archivo.
        if info.filename.startswith('/') or '\\' in info.filename or '..' in segments or '\x00' in info.orig_filename:
            source_error('ZIP_CORRUPTO', kind)
        if info.flag_bits & _FLAGS_UNSUPPORTED or info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            source_error('ZIP_CORRUPTO', kind)
        if _has_zip64(info.extra):
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


def _check_local_header(stream, info, kind):
    """La cabecera local tiene que decir lo mismo que el directorio; devuelve dónde empiezan los datos."""
    stream.seek(info.header_offset)
    raw = stream.read(_LOCAL_HEADER.size)
    if len(raw) != _LOCAL_HEADER.size:
        source_error('ZIP_CORRUPTO', kind)
    signature, _, flags, method, _, _, *sizes, name_bytes, extra_bytes = _LOCAL_HEADER.unpack(raw)
    name = stream.read(name_bytes).decode('utf-8' if flags & _FLAG_UTF8 else 'cp437', 'replace')
    extra = stream.read(extra_bytes)
    declared = (info.CRC, info.compress_size, info.file_size)
    if flags & _FLAG_DESCRIPTOR:
        # Quien escribe en flujo todavía no los conoce: pueden faltar, pero no pueden contradecir.
        coherent = all(value in (0, expected) for value, expected in zip(sizes, declared, strict=True))
    else:
        coherent = tuple(sizes) == declared
    if (signature != _LOCAL_SIGNATURE or name != info.orig_filename or method != info.compress_type or not coherent
            or (flags ^ info.flag_bits) & (_FLAG_DESCRIPTOR | _FLAGS_UNSUPPORTED) or _has_zip64(extra)):
        source_error('ZIP_CORRUPTO', kind)
    return info.header_offset + _LOCAL_HEADER.size + name_bytes + extra_bytes


def _check_stream(stream, info, start, kind, deadline):
    """Bytes reales, fin del flujo y CRC completo; ``ZipExtFile`` termina donde el directorio le dice.

    Nunca produce más de un byte sobre lo declarado, y descarta lo que produce.
    """
    deflated = info.compress_type == zipfile.ZIP_DEFLATED
    inflater = zlib.decompressobj(-15) if deflated else None
    stream.seek(start)
    left, pending, produced, crc = info.compress_size, b'', 0, 0
    while True:
        deadline.check(kind)
        if left and not pending:
            pending = stream.read(min(left, _CHUNK))
            if not pending:
                source_error('ZIP_CORRUPTO', kind)
            left -= len(pending)
        if deflated:
            output = inflater.decompress(pending, min(_CHUNK, info.file_size - produced + 1))
            pending = inflater.unconsumed_tail
        else:
            output, pending = pending, b''
        produced += len(output)
        if produced > info.file_size:
            source_error('ZIP_CORRUPTO', kind)
        crc = zlib.crc32(output, crc)
        if (deflated and inflater.eof) or not (output or pending or left):
            break
    # Una entrada vacía puede no traer flujo. Lo demás tiene que terminar justo donde termina lo declarado.
    if deflated and info.compress_size and (not inflater.eof or inflater.unused_data or left or pending):
        source_error('ZIP_CORRUPTO', kind)
    if produced != info.file_size or crc != info.CRC:
        source_error('ZIP_CORRUPTO', kind)


def _check_entry_end(stream, info, data_end, next_offset, kind):
    """Entre el fin de los datos y lo que sigue solo puede ir el descriptor que el directorio confirma."""
    gap = next_offset - data_end
    if not info.flag_bits & _FLAG_DESCRIPTOR:
        if gap:
            source_error('ZIP_CORRUPTO', kind)
        return
    if gap not in (12, 16):
        source_error('ZIP_CORRUPTO', kind)
    stream.seek(data_end)
    record = stream.read(gap)
    if gap == 16 and not record.startswith(_DESCRIPTOR_SIGNATURE):
        source_error('ZIP_CORRUPTO', kind)
    if record[-12:] != struct.pack('<III', info.CRC, info.compress_size, info.file_size):
        source_error('ZIP_CORRUPTO', kind)


def _check_parts(archive, infos, kind, deadline):
    """Acredita con bytes reales lo que el directorio declara, y ningún DTD en el XML.

    Las partes tienen que ocupar el archivo sin huecos ni solapes. Nada se interpreta acá.
    """
    stream = archive.fp
    ordered = sorted(infos, key=lambda info: info.header_offset)
    position = 0
    for index, info in enumerate(ordered):
        if info.header_offset != position:
            source_error('ZIP_CORRUPTO', kind)
        start = _check_local_header(stream, info, kind)
        _check_stream(stream, info, start, kind, deadline)
        position = ordered[index + 1].header_offset if index + 1 < len(ordered) else archive.start_dir
        _check_entry_end(stream, info, start + info.compress_size, position, kind)
    for info in infos:
        # Un DOCTYPE solo puede ir antes del elemento raíz.
        if info.filename.lower().endswith(('.xml', '.rels')):
            with archive.open(info) as part:
                next(iterparse(part, events=('start',), forbid_dtd=True), None)
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


def _string_text(unit):
    # Las formas habituales evitan armar un objeto por cadena: son millones y sin esto tarda 5 veces más.
    if not len(unit):
        return ''
    if len(unit) == 1 and unit[0].tag == TEXT_TAG:
        return unit[0].text or ''
    return Text.from_tree(unit).content


class _SelectedSheet(ReadOnlyWorksheet):
    def _get_size(self):
        """La dimensión declarada puede mentir, y buscarla recorre la hoja entera."""


class _SheetParser(WorkSheetParser):
    """El intérprete de filas y celdas de openpyxl, en flujo y sin perder datos en silencio."""

    def __init__(self, source, sheet, kind, limits, deadline):
        # Sin formatos de fecha, openpyxl no convierte: el serial original llega a _number_cell_text
        # y una sola política decide, con estilo o sin él.
        super().__init__(source, sheet._shared_strings, data_only=True, epoch=sheet.parent.epoch)
        self.style_count = len(sheet.parent._cell_styles)
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

    def _check_references(self, element, stored, line):
        """Índices y tipos, antes de que openpyxl los use: un índice -1 sería un índice de Python."""
        cell_type = element.get('t', 'n')
        style = element.get('s')
        valid = cell_type in _CELL_TYPES and (
            style is None or (_INDEX.fullmatch(style) is not None and int(style) < self.style_count))
        if valid and stored is not None and stored.text:
            if cell_type == 's':
                valid = _INDEX.fullmatch(stored.text) is not None and int(stored.text) < len(self.shared_strings)
            elif cell_type == 'n':
                valid = _NUMBER.fullmatch(stored.text) is not None
        if not valid:
            source_error('ESTRUCTURA_INVALIDA', self.kind, line)

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
        self._check_references(element, stored, line)
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

    def __init__(self, stream, kind, limits, deadline, entries):
        super().__init__(stream, read_only=True, data_only=True, keep_links=False)
        self.kind = kind
        self.limits = limits
        self.deadline = deadline
        self.entries = entries

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
                text = _string_text(unit).replace('x005F_', '')
                if len(text) > limits.cell:
                    source_error('CELDA_EXCEDE_LIMITE', kind)
                if len(strings) >= limits.shared_strings:
                    source_error('LIMITE_CADENAS_EXCEDIDO', kind)
                strings.append(text)

    def read(self):
        infos = _check_directory(self.archive, self.kind, self.limits, self.entries)
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


def _serial_date(value, system):
    """La única vía por la que un número se vuelve fecha; ``None`` si no denota ningún día.

    Menos de 1 no es un día, en ninguno de los dos sistemas. El 29/02/1900 no existió: todo lo
    que caería en él, o que el redondeo de la hora arrastraría sobre él, tampoco.
    """
    if value < 1 or (system == '1900' and 59 < value < 61):
        return None
    try:
        return from_excel(value, EPOCHS[system])
    except (OverflowError, ValueError):
        return None


def _scales_as_percent(code, kind, line):
    """Si el formato multiplica por 100 al mostrar. Un formato que lo hace solo para algunos valores no se adivina."""
    sections = _FORMAT_LITERAL.sub('', code).split(';')[:3]
    scales = {'%' in section for section in sections if section}
    if len(scales) > 1:
        source_error('CELDA_TIPO_NO_SOPORTADO', kind, line)
    return True in scales


def _number_cell_text(cell, field_type, fmt, kind, line):
    """El estilo no cambia lo que un número significa: solo avisa que el municipio lo ve como fecha."""
    value = cell.value
    workbook = cell.parent.parent
    if not math.isfinite(value) or cell._style_id in workbook._timedelta_formats:
        source_error('CELDA_TIPO_NO_SOPORTADO', kind, line)
    styled = cell._style_id in workbook._date_formats
    if styled and 'fecha_serial' not in fmt:
        source_error('FECHA_SERIAL_NO_DECLARADA', kind, line)
    if 'fecha_serial' in fmt and (styled or field_type == 'fecha'):
        parsed = _serial_date(value, fmt['fecha_serial'])
        if parsed is not None:
            return _date_text(parsed, fmt['fecha'])
        # En una columna de fecha queda crudo y el motor lo marca. En otra, pasaría por un número válido.
        if field_type != 'fecha':
            source_error('CELDA_TIPO_NO_SOPORTADO', kind, line)
    if field_type == 'porcentaje':
        if _scales_as_percent(cell.number_format, kind, line):
            value = Decimal(format(value, '.15g')) * 100
            return format(value.normalize(), 'f').replace('.', fmt['decimal'])
        return _number_text(value, fmt['decimal'])
    if field_type == 'importe':
        return _number_text(value, fmt['decimal'])
    return _number_text(value)


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
    # Solo t="d", que trae una fecha ISO y no un serial: un número nunca llega acá convertido.
    if isinstance(value, (date, datetime)):
        if 'fecha_serial' not in fmt:
            source_error('FECHA_SERIAL_NO_DECLARADA', kind, line)
        return _date_text(value, fmt['fecha'])
    return _number_cell_text(cell, field_type, fmt, kind, line)


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
        entries = _check_end_record(stream, kind, limits)
        reader = _PackageReader(stream, kind, limits, deadline, entries)
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
            tables = {logical: _read_sheet(_SelectedSheet(reader.wb, name, parts[name], reader.shared_strings), logical,
                                           field_types[logical], fmt, limits, deadline)
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
