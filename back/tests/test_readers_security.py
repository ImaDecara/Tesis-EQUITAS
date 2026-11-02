"""ALIGN-053: equivalencia TSV/CSV/XLSX, corpus hostil, límites y temporales privados."""

import copy
import csv
import inspect
import io
import json
import os
import re
import struct
import subprocess
import sys
import time
import traceback
import zipfile
import zlib
from dataclasses import replace
from datetime import date, datetime
from pathlib import Path

import pytest
from openpyxl import Workbook
from openpyxl.utils.datetime import MAC_EPOCH, to_excel
from test_source_mapping import payloads as _payloads

from ETL import extract
from ETL.readers import supervised
from ETL.readers import xlsx as xlsx_reader
from ETL.readers.limits import (
    XLS_MESSAGE,
    Deadline,
    FileLimits,
    PrivateUploadStore,
    sanitize_filename,
)
from ETL.validate_source import (
    SourceRow,
    SourceTable,
    ValidationError,
    load_contract,
    load_mapping,
    validate_batch,
)

BACK = Path(__file__).resolve().parents[1]
FIXTURE = Path(__file__).parent / 'fixtures/sintetico-v1'
GENERATOR = BACK.parent / 'quality/fixtures/synthetic_portfolio.py'
KINDS = ('cabecera', 'detalle')
SHEETS = {'cabecera': 'cabecera', 'detalle': 'detalle'}
SENTINEL = 'CENTINELA-EQUITAS'
# Presupuesto de cada rechazo en un proceso propio, medido sobre el corpus (tabla en la evidencia):
# el mayor es de 3,7 s y 107 MiB en macOS; el margen es para un servidor más lento o con otro asignador.
MAX_SECONDS = 15.0
MAX_RSS_GROWTH_MIB = 192
# Lo más caro que los límites dejan pasar: estilos (no interrumpibles), cadenas (millones de textos),
# una sola marca o texto de 190 MB (expat la guarda entera) y la mayor tabla CSV aceptada.
AT_LIMIT_CASES = ('estilos-al-limite.xlsx', 'cadenas-al-limite.xlsx', 'cadenas-demasiadas.xlsx', 'texto-190mb.xlsx',
                  'comentario-190mb.xlsx', 'atributo-190mb.xlsx', 'mayor-csv-aceptado.csv')
AT_LIMIT_MAX_SECONDS = 60.0
AT_LIMIT_MAX_RSS_GROWTH_MIB = 1024
MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
HEADER_ROW = '<row r="1"><c r="A1" t="inlineStr"><is><t>A</t></is></c></row>'
LAUGHS = (b'<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">'
          b'<!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;">]>')


def fixture_records(kind):
    with (FIXTURE / f'{kind}.tsv').open(encoding='utf-8', newline='') as stream:
        return list(csv.reader(stream, delimiter='\t'))


def workbook_bytes(sheets, *, configure=None):
    workbook = Workbook()
    workbook.remove(workbook.active)
    for name, rows in sheets.items():
        sheet = workbook.create_sheet(name)
        for row in rows:
            sheet.append(row)
    if configure:
        configure(workbook)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def fixture_sheets():
    return {kind: fixture_records(kind) for kind in KINDS}


def xlsx_profile(**fmt):
    mapping = load_mapping(FIXTURE)
    mapping['formato'].update(tipo='xlsx', separador=None, hojas=dict(SHEETS), **fmt)
    return mapping


def csv_profile(separator=','):
    mapping = load_mapping(FIXTURE)
    mapping['formato'].update(tipo='csv', separador=separator)
    return mapping


def write(folder, name, data):
    path = folder / name
    path.write_bytes(data)
    return path


def rewrite_zip(data, *, replace_parts=None, add=None, drop=(), compression=zipfile.ZIP_DEFLATED, stored=()):
    """Copia un paquete cambiando partes, sin pasar por openpyxl."""
    replace_parts, add = replace_parts or {}, add or {}
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as source, zipfile.ZipFile(output, 'w', compression) as target:
        assert set(replace_parts) <= set(source.namelist())
        for name in source.namelist():
            if name not in drop:
                target.writestr(name, replace_parts.get(name, source.read(name)),
                                zipfile.ZIP_STORED if name in stored else None)
        for name, content in add.items():
            target.writestr(name, content, zipfile.ZIP_STORED if name in stored else None)
    return output.getvalue()


def minimal_workbook():
    return workbook_bytes({'cabecera': [['A', 'B'], ['1', '2']], 'detalle': [['A', 'B'], ['3', '4']]})


def sheet_part(data, index=1):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return archive.read(f'xl/worksheets/sheet{index}.xml')


def raw_sheet(rows_xml):
    return (f'<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="{MAIN_NS}"><sheetData>'
            + rows_xml + '</sheetData></worksheet>').encode()


def with_sheet(rows_xml):
    return rewrite_zip(minimal_workbook(), replace_parts={'xl/worksheets/sheet1.xml': raw_sheet(rows_xml)})


def with_shared_strings(rows_xml, strings_xml, **kwargs):
    """Libro como los de Excel: las celdas de texto apuntan a la parte de cadenas compartidas."""
    book = minimal_workbook()
    types = _part(book, '[Content_Types].xml').replace(
        b'</Types>', b'<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument'
                     b'.spreadsheetml.sharedStrings+xml"/></Types>')
    return rewrite_zip(book, replace_parts={'[Content_Types].xml': types, 'xl/worksheets/sheet1.xml': raw_sheet(rows_xml)},
                       add={'xl/sharedStrings.xml': strings_xml}, **kwargs)


def noisy(unit, total, every=40_000):
    """Repite ``unit`` intercalando comentarios incompresibles: la razón de compresión queda bajo 100."""
    repeats = every // len(unit)
    blocks, size = [], 0
    while size < total:
        blocks.append(unit * repeats + b'<!--' + os.urandom(600).hex().encode() + b'-->')
        size += len(blocks[-1])
    return b''.join(blocks)


def with_styles(styles):
    return rewrite_zip(minimal_workbook(), replace_parts={'xl/styles.xml': styles}, stored=('xl/styles.xml',))


def central_flags(data, flags=None, method=None):
    """Cambia en el directorio central las banderas o el método de compresión de la primera parte."""
    start = data.index(b'PK\x01\x02')
    if flags is not None:
        data = data[:start + 8] + struct.pack('<H', flags) + data[start + 10:]
    if method is not None:
        data = data[:start + 10] + struct.pack('<H', method) + data[start + 12:]
    return data


def overlapping_entry(data):
    """Segunda entrada del directorio central que apunta a los mismos bytes de otra parte."""
    start = data.index(b'PK\x01\x02')
    end_record = data.rindex(b'PK\x05\x06')
    name_length, extra, comment = struct.unpack('<HHH', data[start + 28:start + 34])
    record = data[start:start + 46 + name_length + extra + comment]
    decoy = record[:46] + b'x' * name_length + record[46 + name_length:]
    entries, size, offset = struct.unpack('<HII', data[end_record + 10:end_record + 20])
    tail = struct.pack('<HHII', entries + 1, entries + 1, size + len(decoy), offset)
    return data[:end_record] + decoy + data[end_record:end_record + 8] + tail + data[end_record + 20:]


def hidden_zip64_directory(data):
    """Fin de ZIP chico delante del cual un registro Zip64 declara otro directorio: ZipFile le cree a éste."""
    position = data.rindex(b'PK\x05\x06')
    entries, directory, offset = struct.unpack('<HII', data[position + 10:position + 20])
    record = (b'PK\x06\x06' + struct.pack('<QHHIIQQQQ', 44, 45, 45, 0, 0, entries, entries, directory, offset)
              + b'PK\x06\x07' + struct.pack('<IQI', 0, position, 1))
    return data[:position] + record + data[position:]


def declared_size(data, part, size):
    """Cambia en el directorio central el tamaño descomprimido declarado de una parte."""
    position = 0
    encoded = part.encode()
    while (position := data.find(b'PK\x01\x02', position)) >= 0:
        name_length = struct.unpack('<H', data[position + 28:position + 30])[0]
        if data[position + 46:position + 46 + name_length] == encoded:
            return data[:position + 24] + struct.pack('<I', size) + data[position + 28:]
        position += 4
    raise AssertionError(part)


def reject(path, mapping, code, **kwargs):
    files = dict.fromkeys(KINDS, path)
    with pytest.raises(ValidationError) as error:
        extract.read_source_tables(files, mapping, **kwargs)
    message = str(error.value)
    assert message.split(':')[0] == code, message
    assert SENTINEL not in message and str(path.parent) not in message
    return message


@pytest.fixture(scope='module')
def corpus(tmp_path_factory):
    """Corpus hostil del generador de ALIGN-023, sin versionar."""
    output = tmp_path_factory.mktemp('hostil') / 'cartera'
    subprocess.run([sys.executable, '-I', str(GENERATOR), '--output', str(output), '--sin-variantes', '--hostil'],
                   check=True, cwd=BACK.parent, capture_output=True)
    manifest = json.loads((output / 'hostil/manifest.json').read_text(encoding='utf-8'))
    return output / 'hostil', {entry['ruta']: entry for entry in manifest['archivos']}


def profile_for(name):
    return csv_profile() if name.endswith('.csv') else xlsx_profile()


# ------------------------------------------------------------- equivalencia


def payloads_of(files, mapping):
    """Los payloads de un lote. ALIGN-026 hace que se armen desde las rutas y el perfil: esta prueba vale en las dos versiones."""
    if len(inspect.signature(_payloads).parameters) == 2:
        return _payloads(files, mapping)
    return _payloads(extract.extract_source_files(files['cabecera'], files['detalle'], mapping=mapping))


def tsv_reference():
    mapping = load_mapping(FIXTURE)
    files = {kind: FIXTURE / f'{kind}.tsv' for kind in KINDS}
    return files, mapping, validate_batch(files, mapping, load_contract(), mapping['fecha_corte'])


@pytest.mark.parametrize('layout', ['un_libro', 'dos_libros'])
def test_same_portfolio_gives_same_payloads_and_report_in_tsv_csv_and_xlsx(tmp_path, layout):
    original, mapping, expected = tsv_reference()
    baseline = payloads_of(original, mapping)
    sheets = fixture_sheets()
    if layout == 'un_libro':
        files = dict.fromkeys(KINDS, write(tmp_path, 'libro', workbook_bytes(sheets)))
    else:
        files = {kind: write(tmp_path, f'{kind}-libro', workbook_bytes({kind: sheets[kind]})) for kind in KINDS}
    profile = xlsx_profile()
    assert extract.validate_source_files(files, profile, cut_off=profile['fecha_corte']) == expected
    assert payloads_of(files, profile) == baseline
    tables = extract.read_source_tables(files, profile)
    assert [row.line for row in tables['cabecera'].rows] == list(range(2, 44))
    delimited = {}
    for kind in KINDS:
        path = tmp_path / f'{kind}.csv'
        with path.open('w', encoding='utf-8', newline='') as stream:
            csv.writer(stream, lineterminator='\r\n').writerows(sheets[kind])
        delimited[kind] = path
    profile = csv_profile()
    assert extract.validate_source_files(delimited, profile, cut_off=profile['fecha_corte']) == expected
    assert payloads_of(delimited, profile) == baseline


def test_generator_xlsx_variant_matches_the_oracle(tmp_path):
    output = tmp_path / 'cartera'
    subprocess.run([sys.executable, '-I', str(GENERATOR), '--output', str(output)], check=True, cwd=BACK.parent,
                   capture_output=True)
    _, _, expected = tsv_reference()
    book = output / 'variantes/xlsx/cartera.xlsx'
    profile = xlsx_profile()
    assert extract.validate_source_files(dict.fromkeys(KINDS, book), profile, cut_off=profile['fecha_corte']) == expected


def typed_sheets():
    """La misma cartera con importes numéricos y fechas seriales donde el dato es válido."""
    contract = load_contract()
    sheets = fixture_sheets()
    converted = 0
    for kind, rows in sheets.items():
        columns = contract['archivos'][kind]['columnas']
        types = [columns.get(name, {}).get('tipo') for name in rows[0]]
        for row in rows[1:]:
            for index, field_type in enumerate(types):
                value = row[index]
                if field_type == 'importe' and re.fullmatch(r'[0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2}|[0-9]+,[0-9]{2}', value):
                    row[index] = float(value.replace('.', '').replace(',', '.'))
                    converted += 1
                elif field_type == 'fecha' and re.fullmatch(r'[0-9]{2}/[0-9]{2}/[0-9]{4}', value):
                    try:
                        parsed = datetime.strptime(value, '%d/%m/%Y')
                    except ValueError:
                        continue
                    if parsed.year > 1900:
                        row[index] = parsed
                        converted += 1
    assert converted > 100
    return sheets


def test_numeric_cells_and_serial_dates_give_the_same_report_and_payloads(tmp_path):
    original, mapping, expected = tsv_reference()
    baseline = payloads_of(original, mapping)
    path = write(tmp_path, 'libro', workbook_bytes(typed_sheets()))
    profile = xlsx_profile(fecha_serial='1900')
    assert extract.validate_source_files(dict.fromkeys(KINDS, path), profile, cut_off=profile['fecha_corte']) == expected
    assert payloads_of(dict.fromkeys(KINDS, path), profile) == baseline


def typed_cells(tmp_path, values, *, configure=None, **fmt):
    headers = ['ClaveAgrupacion', 'NOTD_vencimiento', 'NOTD_capital', 'Detalle_Deuda']
    path = write(tmp_path, 'libro', workbook_bytes({'cabecera': [['A'], ['1']], 'detalle': [headers, values]},
                                                  configure=configure))
    return path, xlsx_profile(**fmt)


def read_detail(path, mapping):
    with open(path, 'rb') as stream:
        tables = extract.read_workbook(
            stream, {'detalle': 'detalle'}, mapping['formato'],
            {'detalle': extract._physical_types('detalle', mapping, load_contract())},
            FileLimits(), Deadline(60))
    return tables.tables['detalle'].rows[0].values


@pytest.mark.parametrize(('date_format', 'expected'), [('dd/mm/aaaa', '15/01/2024'), ('aaaa-mm-dd', '2024-01-15')])
def test_serial_dates_follow_the_profile(tmp_path, date_format, expected):
    serial = to_excel(date(2024, 1, 15))
    path, mapping = typed_cells(tmp_path, ['K', serial, 1234.5, 'x'], fecha=date_format, fecha_serial='1900')
    values = read_detail(path, mapping)
    assert values['NOTD_vencimiento'] == expected
    assert values['NOTD_capital'] == '1234,5'


def test_date_cell_and_serial_without_declaration(tmp_path):
    path, mapping = typed_cells(tmp_path, ['K', datetime(2024, 1, 15), 1, 'x'])
    with pytest.raises(ValidationError, match='FECHA_SERIAL_NO_DECLARADA: archivo=detalle, linea=2'):
        read_detail(path, mapping)
    # Sin declaración, un número en una columna de fecha llega crudo y el motor lo marca.
    path, mapping = typed_cells(tmp_path, ['K', 45306, 1, 'x'])
    assert read_detail(path, mapping)['NOTD_vencimiento'] == '45306'


def test_workbook_date_system_must_match_the_profile(tmp_path):
    def mac(workbook):
        workbook.epoch = MAC_EPOCH
    path, mapping = typed_cells(tmp_path, ['K', datetime(2024, 1, 15), 1, 'x'], configure=mac, fecha_serial='1900')
    with pytest.raises(ValidationError, match='SISTEMA_FECHAS_NO_COINCIDE'):
        read_detail(path, mapping)
    path, mapping = typed_cells(tmp_path, ['K', datetime(2024, 1, 15), 1, 'x'], configure=mac, fecha_serial='1904')
    assert read_detail(path, mapping)['NOTD_vencimiento'] == '15/01/2024'


def test_serial_out_of_range_and_time_stay_invalid_for_the_engine(tmp_path):
    path, mapping = typed_cells(tmp_path, ['K', 99999999999, 1, 'x'], fecha_serial='1900')
    assert read_detail(path, mapping)['NOTD_vencimiento'] == '99999999999'
    path, mapping = typed_cells(tmp_path, ['K', 45306.5, 1, 'x'], fecha_serial='1900')
    assert read_detail(path, mapping)['NOTD_vencimiento'] == '15/01/2024 12:00:00'
    path, mapping = typed_cells(tmp_path, ['K', datetime(2024, 1, 15, 8, 30), 1, 'x'], fecha_serial='1900')
    assert read_detail(path, mapping)['NOTD_vencimiento'] == '15/01/2024 08:30:00'


def test_numeric_text_is_exact_and_never_scientific(tmp_path):
    rows = ('<row r="1"><c r="A1" t="inlineStr"><is><t>ClaveAgrupacion</t></is></c>'
            '<c r="B1" t="inlineStr"><is><t>NOTD_capital</t></is></c><c r="C1" t="inlineStr"><is><t>DEUD_id</t></is></c>'
            '<c r="D1" t="inlineStr"><is><t>Detalle_Deuda</t></is></c></row>'
            '<row r="2"><c r="A2"><v>12345678901234567890</v></c><c r="B2"><v>1234.5599999999999</v></c>'
            '<c r="C2"><v>1E+20</v></c><c r="D2"><v>7.0</v></c></row>')
    path = write(tmp_path, 'libro', rewrite_zip(minimal_workbook(), replace_parts={'xl/worksheets/sheet2.xml': raw_sheet(rows)}))
    values = read_detail(path, xlsx_profile())
    assert values == {'ClaveAgrupacion': '12345678901234567890', 'NOTD_capital': '1234,56',
                      'DEUD_id': '100000000000000000000', 'Detalle_Deuda': '7'}


def test_percentage_format_keeps_the_contract_scale(tmp_path):
    def percent(workbook):
        workbook['cabecera']['B2'].number_format = '0%'
    data = workbook_bytes({'cabecera': [['ClaveAgrupacion', 'Destinatario_Porcentaje'], ['K', 0.5]],
                           'detalle': [['A'], ['1']]}, configure=percent)
    path = write(tmp_path, 'libro', data)
    mapping = xlsx_profile()
    with open(path, 'rb') as stream:
        tables = extract.read_workbook(stream, {'cabecera': 'cabecera'}, mapping['formato'],
                                       {'cabecera': extract._physical_types('cabecera', mapping, load_contract())},
                                       FileLimits(), Deadline(60))
    assert tables.tables['cabecera'].rows[0].values['Destinatario_Porcentaje'] == '50'


def test_formula_with_stored_value_reads_the_value_without_evaluating(tmp_path):
    rows = ('<row r="1"><c r="A1" t="inlineStr"><is><t>ClaveAgrupacion</t></is></c>'
            '<c r="B1" t="inlineStr"><is><t>Detalle_Deuda</t></is></c></row>'
            '<row r="2"><c r="A2"><f>1+1</f><v>41</v></c><c r="B2" t="str"><f>IF(1,"","x")</f><v></v></c></row>')
    path = write(tmp_path, 'libro', rewrite_zip(minimal_workbook(), replace_parts={'xl/worksheets/sheet2.xml': raw_sheet(rows)}))
    assert read_detail(path, xlsx_profile()) == {'ClaveAgrupacion': '41', 'Detalle_Deuda': ''}


def test_short_rows_blank_rows_and_false_dimension_do_not_lose_data(tmp_path):
    sheet = (f'<?xml version="1.0"?><worksheet xmlns="{MAIN_NS}"><dimension ref="A1:A1"/><sheetData>'
             '<row r="1"><c r="A1" t="inlineStr"><is><t>ClaveAgrupacion</t></is></c>'
             '<c r="B1" t="inlineStr"><is><t>Detalle_Deuda</t></is></c></row>'
             '<row r="4"><c r="A4" t="inlineStr"><is><t>K1</t></is></c></row>'
             '<row r="7"><c r="A7" t="inlineStr"><is><t>K2</t></is></c><c r="B7" t="inlineStr"><is><t>d</t></is></c></row>'
             '</sheetData></worksheet>').encode()
    path = write(tmp_path, 'libro', rewrite_zip(minimal_workbook(), replace_parts={'xl/worksheets/sheet2.xml': sheet}))
    mapping = xlsx_profile()
    with open(path, 'rb') as stream:
        table = extract.read_workbook(stream, {'detalle': 'detalle'}, mapping['formato'], {'detalle': {}},
                                      FileLimits(), Deadline(60)).tables['detalle']
    assert [(row.line, row.values) for row in table.rows] == [
        (4, {'ClaveAgrupacion': 'K1', 'Detalle_Deuda': ''}), (7, {'ClaveAgrupacion': 'K2', 'Detalle_Deuda': 'd'})]


def test_shared_strings_like_excel_are_read(tmp_path):
    rows = ('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
            '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>')
    strings = (f'<sst xmlns="{MAIN_NS}"><si><t>ClaveAgrupacion</t></si><si><t>Bien_Descripcion</t></si><si><t>000123</t></si>'
               '<si><r><t>rico </t></r><r><t xml:space="preserve">y ñ</t></r></si></sst>').encode()
    path = write(tmp_path, 'libro', with_shared_strings(rows, strings))
    mapping = xlsx_profile()
    with open(path, 'rb') as stream:
        table = extract.read_workbook(stream, {'cabecera': 'cabecera'}, mapping['formato'], {'cabecera': {}},
                                      FileLimits(), Deadline(60)).tables['cabecera']
    assert table.columns == ['ClaveAgrupacion', 'Bien_Descripcion']
    assert table.rows[0].values == {'ClaveAgrupacion': '000123', 'Bien_Descripcion': 'rico y ñ'}


def test_package_with_everything_excel_writes_is_read(tmp_path):
    """Lo que Excel agrega a un libro real no debe confundirse con un archivo hostil."""
    book = workbook_bytes({'cabecera': [['A', 'B']], 'detalle': [['A'], ['2']], 'otra': [['x']]})
    extra = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac'
    rows = ('<row r="1" spans="1:2" ht="15" customHeight="1" x14ac:dyDescent="0.25"><c r="A1" s="0" t="inlineStr"><is><t>A</t></is></c>'
            '<c r="B1" t="inlineStr"><is><t>B</t></is></c><c r="C1" s="0"/></row>'
            '<row r="3" spans="1:2" s="0" customFormat="1" x14ac:dyDescent="0.25"><c r="A3"><f>1+1</f><v>2</v></c>'
            '<c r="B3" t="str"><f t="shared" ref="B3:B4" si="0">"x"</f><v>x</v><extLst/></c></row>')
    sheet = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="{MAIN_NS}" xmlns:x14ac="{extra}" '
             'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
             '<dimension ref="A1:B3"/><sheetViews><sheetView workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews>'
             '<sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="2" width="9"/></cols>'
             f'<sheetData>{rows}</sheetData><mergeCells count="1"><mergeCell ref="D5:E5"/></mergeCells>'
             '<hyperlinks><hyperlink ref="D1" location="otra!A1"/></hyperlinks><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
             '<extLst><ext uri="{x}" xmlns:x14="urn:x14"><x14:algo/></ext></extLst></worksheet>').encode()
    path = write(tmp_path, 'libro', rewrite_zip(book, replace_parts={'xl/worksheets/sheet1.xml': sheet}, add={
        'xl/printerSettings/printerSettings1.bin': bytes(4096), 'xl/calcChain.xml': b'<calcChain xmlns="' + MAIN_NS.encode() + b'"/>',
        'customXml/item1.xml': b'<a/>'}))
    mapping = xlsx_profile()
    with open(path, 'rb') as stream:
        table = extract.read_workbook(stream, {'cabecera': 'cabecera'}, mapping['formato'], {'cabecera': {}},
                                      FileLimits(), Deadline(60)).tables['cabecera']
    assert table.columns == ['A', 'B']
    assert [(row.line, row.values) for row in table.rows] == [(3, {'A': '2', 'B': 'x'})]


def test_workbook_without_styles_and_blank_rows_are_read(tmp_path):
    rows = (HEADER_ROW + '<row r="2"><c r="A2"/></row><row r="3"><c r="A3" t="inlineStr"><is><t>K</t></is></c></row>')
    book = rewrite_zip(minimal_workbook(), replace_parts={'xl/worksheets/sheet1.xml': raw_sheet(rows)}, drop=('xl/styles.xml',))
    mapping = xlsx_profile()
    table = extract.read_workbook(io.BytesIO(book), {'cabecera': 'cabecera'}, mapping['formato'], {'cabecera': {}},
                                  FileLimits(), Deadline(60)).tables['cabecera']
    assert [(row.line, row.values) for row in table.rows] == [(3, {'A': 'K'})]


def test_percentage_without_percent_format_keeps_its_value(tmp_path):
    data = workbook_bytes({'cabecera': [['ClaveAgrupacion', 'Destinatario_Porcentaje'], ['K', 12.5]], 'detalle': [['A'], ['1']]})
    mapping = xlsx_profile()
    tables = extract.read_workbook(io.BytesIO(data), {'cabecera': 'cabecera'}, mapping['formato'],
                                   {'cabecera': extract._physical_types('cabecera', mapping, load_contract())},
                                   FileLimits(), Deadline(60))
    assert tables.tables['cabecera'].rows[0].values['Destinatario_Porcentaje'] == '12,5'


def test_shared_string_limit_and_its_forms(tmp_path):
    rows = '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>3</v></c></row>'
    strings = (f'<sst xmlns="{MAIN_NS}"><si><t>A</t></si><si/><si><t>B</t></si><si><r><t>c</t></r><r><t>d</t></r></si><otro/></sst>').encode()
    book = with_shared_strings(rows, strings)
    mapping = xlsx_profile()
    table = extract.read_workbook(io.BytesIO(book), {'cabecera': 'cabecera'}, mapping['formato'], {'cabecera': {}},
                                  FileLimits(), Deadline(60)).tables['cabecera']
    assert table.columns == ['A', 'B']
    assert table.rows[0].values == {'A': '', 'B': 'cd'}
    with pytest.raises(ValidationError, match='LIMITE_CADENAS_EXCEDIDO'):
        extract.read_workbook(io.BytesIO(book), {'cabecera': 'cabecera'}, mapping['formato'], {'cabecera': {}},
                              replace(FileLimits(), shared_strings=3), Deadline(60))


def test_transformations_and_aliases_apply_to_xlsx(tmp_path):
    sheets = fixture_sheets()
    header = sheets['detalle'][0]
    position = header.index('NOTD_ESTA_id')
    for row in sheets['detalle'][1:]:
        row[position] = {'10': 'P', '20': 'G'}.get(row[position], row[position])
    header[position] = 'estado físico'
    path = write(tmp_path, 'libro', workbook_bytes(sheets))
    profile = xlsx_profile()
    profile['columnas'] = {'detalle': {'NOTD_ESTA_id': 'estado físico'}}
    profile['transformaciones'] = {'detalle': {'NOTD_ESTA_id': [
        {'operacion': 'mapear_codigos', 'valores': {'P': '10', 'G': '20', '30': '30', '40': '40', '99': '99'}}]}}
    try:
        report = extract.validate_source_files(dict.fromkeys(KINDS, path), profile, cut_off=profile['fecha_corte'])
    except ValidationError as error:  # Un código no previsto de la fixture debe avisar, no pasar en silencio.
        raise AssertionError(str(error)) from None
    assert report == tsv_reference()[2]


# ------------------------------------------------------------- corpus del generador


@pytest.mark.parametrize('name', ['bomba-zip.xlsx', 'xml-entidad-externa.xlsx', 'macro.xlsm', 'xls-renombrado.xlsx',
                                  'binario.csv', 'celda-gigante.xlsx', 'celda-gigante.csv', 'formulas.xlsx', 'formulas.csv'])
def test_generator_hostile_file_is_rejected_with_its_declared_code(corpus, name):
    folder, entries = corpus
    reject(folder / name, profile_for(name), entries[name]['esperado'])


def test_extra_sheets_are_listed_ignored_and_never_interpreted(corpus):
    folder, entries = corpus
    assert entries['hojas-extra.xlsx']['esperado'] == 'HOJAS_EXTRA_IGNORADAS'
    path = folder / 'hojas-extra.xlsx'
    batch = extract.read_source_batch(dict.fromkeys(KINDS, path), xlsx_profile())
    assert batch.ignored_sheets == ['notas', 'oculta']
    text = json.dumps([row.values for table in batch.tables.values() for row in table.rows])
    assert 'HOJA-NOTAS' not in text and 'HOJA-OCULTA' not in text
    assert 'HOJAS-EXTRA-XLSX-DATO' in text


def test_hostile_ignored_sheet_is_not_interpreted_but_its_xml_is_checked(tmp_path):
    data = workbook_bytes({'cabecera': [['A'], ['1']], 'detalle': [['A'], ['2']], 'otra': [['x']]})
    broken = rewrite_zip(data, replace_parts={'xl/worksheets/sheet3.xml': raw_sheet('<row r="1"><c r="A1"><f>1+1</f></c></row>')})
    table = extract.read_workbook(io.BytesIO(broken), SHEETS, xlsx_profile()['formato'],
                                  {'cabecera': {}, 'detalle': {}}, FileLimits(), Deadline(60))
    assert table.ignored_sheets == ['otra']
    dtd = rewrite_zip(data, replace_parts={'xl/worksheets/sheet3.xml': LAUGHS + b'<worksheet/>'})
    reject(write(tmp_path, 'libro', dtd), xlsx_profile(), 'XML_ENTIDAD_EXTERNA')


# ------------------------------------------------------------- corpus propio


def _hostile_cases():
    """(nombre, bytes, perfil, código, límites); se construye perezosamente por ser costoso."""
    book = minimal_workbook()
    rows_default = ''.join(f'<row r="{n}"><c r="A{n}"><v>1</v></c></row>' for n in range(1, 300_003))
    columns_default = ''.join(f'<c r="{_letters(n)}1"><v>1</v></c>' for n in range(1, 62))
    many_sheets = workbook_bytes({f'h{n}': [['x']] for n in range(255)} | {name: [['A']] for name in SHEETS})
    many_parts = rewrite_zip(book, add={f'xl/media/{n}.bin': b'x' for n in range(2100)})
    big_part = rewrite_zip(book, replace_parts={'xl/styles.xml': b'<a/>' * 2_100_000}, compression=zipfile.ZIP_STORED)
    # Peor memoria aceptada por los límites: openpyxl arma estas partes enteras antes de leer la hoja.
    # Cada formato de celda al tope de Excel apunta a un código que maximiza la expresión de openpyxl.
    worst_styles = (f'<styleSheet xmlns="{MAIN_NS}"><numFmts count="1"><numFmt numFmtId="164" formatCode="{"[" * 255}"/></numFmts>'
                    f'<cellXfs count="65490">{chr(60)}xf numFmtId="164"/>'.encode()
                    + b'<xf numFmtId="164"/>' * 65_489 + b'</cellXfs>' + b'<a/>' * 430_000 + b'</styleSheet>')
    strings_at_limit = b''.join(b'<si><t>%07d</t></si>' % number for number in range(3_999_000))
    # Un solo texto de 190 MB, con una mezcla mínima para que la razón de compresión quede bajo 100.
    solid_text = b''.join(b'x' * 40_000 + os.urandom(300).hex().encode() for _ in range(4_700)).decode()
    random_block = os.urandom(1 << 20)
    oversized = rewrite_zip(book, add={'xl/media/grande.bin': random_block})
    no_types = rewrite_zip(book, drop=('[Content_Types].xml',))
    ods = rewrite_zip(book, drop=('[Content_Types].xml',), add={'mimetype': b'application/vnd.oasis.opendocument.spreadsheet'})
    corrupt = bytearray(book)
    corrupt[60:90] = b'\xff' * 30
    duplicate = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(book)) as source, zipfile.ZipFile(duplicate, 'w') as target:
        for name in source.namelist():
            target.writestr(name, source.read(name))
        with pytest.warns(UserWarning):
            target.writestr('xl/styles.xml', b'<a/>')
    traversal = rewrite_zip(book, add={'../../fuera.xml': b'<a/>'})
    backslash = rewrite_zip(book, add={'xl\\fuera.xml': b'<a/>'})
    sentinel = f'{SENTINEL}-VALOR'.encode()
    return [
        ('zip-truncado.xlsx', book[:len(book) // 2], xlsx_profile(), 'ZIP_CORRUPTO', None),
        ('zip-crc.xlsx', bytes(corrupt), xlsx_profile(), 'ZIP_CORRUPTO', None),
        ('zip-basura.xlsx', b'PK\x03\x04' + b'\x00' * 200, xlsx_profile(), 'ZIP_CORRUPTO', None),
        ('zip-parte-duplicada.xlsx', duplicate.getvalue(), xlsx_profile(), 'ZIP_CORRUPTO', None),
        ('zip-ruta-relativa.xlsx', traversal, xlsx_profile(), 'ZIP_CORRUPTO', None),
        ('zip-barra-invertida.xlsx', backslash, xlsx_profile(), 'ZIP_CORRUPTO', None),
        ('zip-tamano-falso.xlsx', declared_size(book, 'xl/styles.xml', 5), xlsx_profile(), 'ZIP_CORRUPTO', None),
        ('bomba-tamano.xlsx', declared_size(oversized, 'xl/media/grande.bin', 100_000_000), xlsx_profile(),
         'TAMANO_DESCOMPRIMIDO_EXCEDIDO', replace(FileLimits(), uncompressed_bytes=50_000_000)),
        ('bomba-razon-total.xlsx', rewrite_zip(book, add={'xl/media/ceros.bin': bytes(8 << 20)}), xlsx_profile(),
         'RAZON_COMPRESION_EXCEDIDA', None),
        ('demasiadas-partes.xlsx', many_parts, xlsx_profile(), 'LIMITE_PARTES_ZIP_EXCEDIDO', None),
        ('parte-metadatos-gigante.xlsx', big_part, xlsx_profile(), 'LIMITE_PARTE_ZIP_EXCEDIDO', None),
        ('sin-tipos.xlsx', no_types, xlsx_profile(), 'FORMATO_NO_SOPORTADO', None),
        ('ods-disfrazado.xlsx', ods, xlsx_profile(), 'FORMATO_NO_SOPORTADO', None),
        ('texto-como-xlsx.xlsx', b'ClaveAgrupacion,Cuenta\n1,2\n', xlsx_profile(), 'FORMATO_NO_SOPORTADO', None),
        ('xlsx-como-csv.csv', book, csv_profile(), 'FORMATO_NO_SOPORTADO', None),
        ('ole-como-csv.csv', b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1' + bytes(600), csv_profile(), 'FORMATO_XLS_NO_SOPORTADO', None),
        ('nombre-xls.xls', b'ClaveAgrupacion,Cuenta\n1,2\n', csv_profile(), 'FORMATO_XLS_NO_SOPORTADO', None),
        ('NOMBRE-XLSM.XLSM', book, xlsx_profile(), 'MACRO_NO_PERMITIDA', None),
        ('macro-renombrada', rewrite_zip(book, add={'XL/VBAPROJECT.BIN': b'vba'}), xlsx_profile(), 'MACRO_NO_PERMITIDA', None),
        ('tipo-macro', rewrite_zip(book, replace_parts={'[Content_Types].xml': _macro_types(book)}), xlsx_profile(),
         'MACRO_NO_PERMITIDA', None),
        ('entidades-tipos.xlsx', rewrite_zip(book, replace_parts={'[Content_Types].xml': LAUGHS + re.sub(
            rb'^<\?xml[^>]*\?>', b'', _part(book, '[Content_Types].xml'))}),
         xlsx_profile(), 'XML_ENTIDAD_EXTERNA', None),
        ('entidades-libro.xlsx', rewrite_zip(book, replace_parts={'xl/workbook.xml': LAUGHS + b'<workbook/>'}),
         xlsx_profile(), 'XML_ENTIDAD_EXTERNA', None),
        ('entidades-relaciones.xlsx', rewrite_zip(book, replace_parts={'xl/_rels/workbook.xml.rels': LAUGHS + b'<Relationships/>'}),
         xlsx_profile(), 'XML_ENTIDAD_EXTERNA', None),
        ('entidades-cadenas.xlsx', with_shared_strings('<row r="1"><c r="A1" t="s"><v>0</v></c></row>', LAUGHS + b'<sst>&c;</sst>'),
         xlsx_profile(), 'XML_ENTIDAD_EXTERNA', None),
        ('entidades-parte-suelta.xlsx', rewrite_zip(book, add={'customXml/item1.xml': LAUGHS + b'<a>&c;</a>'}),
         xlsx_profile(), 'XML_ENTIDAD_EXTERNA', None),
        ('indice-cadena.xlsx', with_shared_strings('<row r="1"><c r="A1" t="s"><v>99</v></c></row>', b'<sst><si><t>A</t></si></sst>'),
         xlsx_profile(), 'ESTRUCTURA_INVALIDA', None),
        ('estilos-al-limite.xlsx', with_styles(worst_styles), xlsx_profile(), 'COLUMNA_OBLIGATORIA_AUSENTE', None),
        ('cadenas-al-limite.xlsx', with_shared_strings('<row r="1"><c r="A1" t="s"><v>0</v></c></row>', _sst(strings_at_limit)),
         xlsx_profile(), 'COLUMNA_OBLIGATORIA_AUSENTE', None),
        ('entidad-hoja.xlsx', rewrite_zip(book, replace_parts={'xl/worksheets/sheet1.xml': LAUGHS + raw_sheet('').split(b'?>', 1)[1]}),
         xlsx_profile(), 'XML_ENTIDAD_EXTERNA', None),
        ('entidad-utf16.xlsx', rewrite_zip(book, replace_parts={'xl/worksheets/sheet1.xml': (
            '<?xml version="1.0" encoding="UTF-16"?><!DOCTYPE a [<!ENTITY b SYSTEM "file:///nonexistent">]><a>&b;</a>').encode('utf-16')}),
         xlsx_profile(), 'XML_ENTIDAD_EXTERNA', None),
        ('xml-roto.xlsx', rewrite_zip(book, replace_parts={'xl/worksheets/sheet1.xml': b'<worksheet><sheetData>'}), xlsx_profile(), 'XML_INVALIDO', None),
        ('xml-control.xlsx', with_sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>A&#7;</t></is></c></row>'), xlsx_profile(), 'XML_INVALIDO', None),
        ('celda-control.xlsx', with_sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>A</t></is></c></row>'
                                          '<row r="2"><c r="A2" t="inlineStr"><is><t>a&#x85;b</t></is></c></row>'),
         xlsx_profile(), 'CARACTER_CONTROL', None),
        ('celda-control.csv', b'ClaveAgrupacion,Cuenta\nK\x07,' + sentinel + b'\n', csv_profile(), 'CARACTER_CONTROL', None),
        ('celda-salto.xlsx', with_sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>A</t></is></c></row>'
                                        '<row r="2"><c r="A2" t="inlineStr"><is><t>a&#10;b</t></is></c></row>'),
         xlsx_profile(), 'ESTRUCTURA_INVALIDA', None),
        ('celda-error.xlsx', with_sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>A</t></is></c></row>'
                                        '<row r="2"><c r="A2" t="e"><v>#REF!</v></c></row>'), xlsx_profile(), 'CELDA_CON_ERROR', None),
        ('celda-booleana.xlsx', with_sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>A</t></is></c></row>'
                                           '<row r="2"><c r="A2" t="b"><v>1</v></c></row>'), xlsx_profile(), 'CELDA_TIPO_NO_SOPORTADO', None),
        ('celda-infinita.xlsx', with_sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>A</t></is></c></row>'
                                           '<row r="2"><c r="A2"><v>1E+999</v></c></row>'), xlsx_profile(), 'CELDA_TIPO_NO_SOPORTADO', None),
        ('formula-sin-v.xlsx', with_sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>A</t></is></c></row>'
                                          '<row r="2"><c r="A2"><f>1+1</f></c></row>'), xlsx_profile(), 'FORMULA_SIN_VALOR', None),
        ('celda-otro-espacio.xlsx', with_sheet(HEADER_ROW + '<row r="2"><x:c xmlns:x="urn:x" r="A2"><x:f>1</x:f><x:v></x:v></x:c></row>'),
         xlsx_profile(), 'ESTRUCTURA_INVALIDA', None),
        ('elemento-en-fila.xlsx', with_sheet(HEADER_ROW + '<row r="2"><zz r="A2"><f>1+1</f></zz></row>'), xlsx_profile(),
         'ESTRUCTURA_INVALIDA', None),
        ('fila-repetida.xlsx', with_sheet(HEADER_ROW + '<row r="5"><c r="A5"><v>5</v></c></row><row r="5"><c r="A5"><v>6</v></c></row>'),
         xlsx_profile(), 'ESTRUCTURA_INVALIDA', None),
        ('fila-desordenada.xlsx', with_sheet(HEADER_ROW + '<row r="5"><c r="A5"><v>5</v></c></row><row r="3"><c r="A3"><v>3</v></c></row>'),
         xlsx_profile(), 'ESTRUCTURA_INVALIDA', None),
        ('celda-repetida.xlsx', with_sheet(HEADER_ROW + '<row r="2"><c r="A2"><v>1</v></c><c r="A2"><v>2</v></c></row>'),
         xlsx_profile(), 'ESTRUCTURA_INVALIDA', None),
        ('celda-desordenada.xlsx', with_sheet(HEADER_ROW + '<row r="2"><c r="B2"><v>1</v></c><c r="A2"><v>2</v></c></row>'),
         xlsx_profile(), 'ESTRUCTURA_INVALIDA', None),
        ('celda-otra-fila.xlsx', with_sheet(HEADER_ROW + '<row r="2"><c r="A9"><v>1</v></c></row>'), xlsx_profile(), 'ESTRUCTURA_INVALIDA', None),
        ('celda-fuera-de-excel.xlsx', with_sheet(HEADER_ROW + '<row r="2"><c r="XFE2"/></row>'), xlsx_profile(), 'ESTRUCTURA_INVALIDA', None),
        ('coordenada-rota.xlsx', with_sheet(HEADER_ROW + '<row r="2"><c r="!!"><v>1</v></c></row>'), xlsx_profile(), 'ESTRUCTURA_INVALIDA', None),
        ('celda-escape-control.xlsx', with_sheet(HEADER_ROW + '<row r="2"><c r="A2" t="inlineStr"><is><t>a_x0007_b</t></is></c></row>'),
         xlsx_profile(), 'CARACTER_CONTROL', None),
        ('numero-enorme.xlsx', with_sheet(HEADER_ROW + '<row r="2"><c r="A2"><v>' + '9' * 5000 + '</v></c></row>'), xlsx_profile(),
         'ARCHIVO_NO_LEIBLE', None),
        ('valor-enorme.xlsx', with_sheet(HEADER_ROW + '<row r="2"><c r="A2"><v>' + '9' * 40_000 + '</v></c></row>'), xlsx_profile(),
         'CELDA_EXCEDE_LIMITE', None),
        # Con ZIP mínimo: pocos MB que openpyxl sin acotar convertía en más de 3 GiB o en un cuelgue.
        ('hoja-ignorada-sin-dimension.xlsx', rewrite_zip(book, add={'xl/worksheets/sheet9.xml': _worksheet(noisy(b'<a/>', 150_000_000))}),
         xlsx_profile(), 'COLUMNA_OBLIGATORIA_AUSENTE', None),
        ('hoja-elementos-extra.xlsx', with_raw_sheet(_worksheet(noisy(b'<a/>', 150_000_000))), xlsx_profile(), 'LIMITE_XML_EXCEDIDO', None),
        ('hoja-profunda.xlsx', with_raw_sheet(_worksheet(noisy(b'<a>', 150_000_000))), xlsx_profile(), 'LIMITE_XML_EXCEDIDO', None),
        ('fila-millones-de-celdas.xlsx', with_raw_sheet(_worksheet(b'<sheetData><row r="1">' + noisy(b'<c/>', 150_000_000))), xlsx_profile(),
         'LIMITE_XML_EXCEDIDO', None),
        ('fila-sin-fin.xlsx', with_raw_sheet(_worksheet(b'<sheetData><row r="1"><c r="A1" t="inlineStr"><is>' + noisy(b'<r><t>x</t></r>', 150_000_000))),
         xlsx_profile(), 'LIMITE_XML_EXCEDIDO', None),
        ('filas-vacias-repetidas.xlsx', with_raw_sheet(_worksheet(b'<sheetData>' + noisy(b'<row r="1"/>', 150_000_000))), xlsx_profile(),
         'ESTRUCTURA_INVALIDA', None),
        ('filas-vacias-hasta-excel.xlsx', with_raw_sheet(_worksheet(b'<sheetData>' + b''.join(
            b'<row r="%d"/>' % n for n in range(1, 1_048_577)) + b'</sheetData>'), stored=('xl/worksheets/sheet1.xml',)), xlsx_profile(),
         'ESTRUCTURA_INVALIDA', None),
        ('estilos-con-tipo-de-hoja.xlsx', rewrite_zip(book, replace_parts={
            'xl/styles.xml': _sst(noisy(b'<a/>', 150_000_000)),
            '[Content_Types].xml': _part(book, '[Content_Types].xml').replace(
                b'</Types>', b'<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument'
                             b'.spreadsheetml.worksheet+xml"/></Types>')}), xlsx_profile(), 'LIMITE_PARTE_ZIP_EXCEDIDO', None),
        ('estilos-demasiados-elementos.xlsx', with_styles(_sst(b'<a/>' * 500_001)), xlsx_profile(), 'LIMITE_XML_EXCEDIDO', None),
        ('estilos-formato-cuadratico.xlsx', with_styles(f'<styleSheet xmlns="{MAIN_NS}"><numFmts><numFmt numFmtId="164" '
                                                        f'formatCode="{"[" * 5_000_000}"/></numFmts><cellXfs><xf numFmtId="164"/>'
                                                        '</cellXfs></styleSheet>'.encode()), xlsx_profile(), 'LIMITE_XML_EXCEDIDO', None),
        ('estilos-demasiados-formatos.xlsx', with_styles(_sst(b'<xf numFmtId="164"/>' * 65_491)), xlsx_profile(), 'LIMITE_XML_EXCEDIDO', None),
        ('nombre-definido-cuadratico.xlsx', rewrite_zip(book, replace_parts={'xl/workbook.xml': _part(book, 'xl/workbook.xml').replace(
            b'</workbook>', b'<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">' + b'a' * 5_000_000
            + b'</definedName></definedNames></workbook>')}, stored=('xl/workbook.xml',)), xlsx_profile(), 'COLUMNA_OBLIGATORIA_AUSENTE', None),
        ('cadenas-demasiadas.xlsx', with_shared_strings('<row r="1"><c r="A1" t="s"><v>0</v></c></row>', _sst(b'<si/>' * 4_000_001),
                                                        stored=('xl/sharedStrings.xml',)), xlsx_profile(), 'LIMITE_CADENAS_EXCEDIDO', None),
        ('cadenas-elementos-sueltos.xlsx', with_shared_strings('<row r="1"><c r="A1" t="s"><v>0</v></c></row>', _sst(noisy(b'<a/>', 150_000_000))),
         xlsx_profile(), 'LIMITE_XML_EXCEDIDO', None),
        ('cadena-mayor-a-celda.xlsx', with_shared_strings('<row r="1"><c r="A1" t="s"><v>0</v></c></row>',
                                                          _sst(b'<si><t>' + os.urandom(16_384).hex().encode() + b'</t></si>')),
         xlsx_profile(), 'CELDA_EXCEDE_LIMITE', None),
        ('zip64-oculto.xlsx', hidden_zip64_directory(book), xlsx_profile(), 'ZIP_CORRUPTO', None),
        ('zip-cifrado.xlsx', central_flags(book, flags=0x1), xlsx_profile(), 'ZIP_CORRUPTO', None),
        ('zip-otra-compresion.xlsx', central_flags(book, method=zipfile.ZIP_BZIP2), xlsx_profile(), 'ZIP_CORRUPTO', None),
        ('hoja-vacia.xlsx', with_sheet(''), xlsx_profile(), 'ESTRUCTURA_INVALIDA', None),
        ('sin-fila-1.xlsx', with_sheet('<row r="2"><c r="A2" t="inlineStr"><is><t>A</t></is></c></row>'), xlsx_profile(), 'ESTRUCTURA_INVALIDA', None),
        ('hojas-mismo-nombre.xlsx', rewrite_zip(workbook_bytes({'cabecera': [['A']], 'detalle': [['A']]}), replace_parts={
            'xl/workbook.xml': _part(workbook_bytes({'cabecera': [['A']], 'detalle': [['A']]}), 'xl/workbook.xml').replace(b'name="detalle"', b'name="cabecera"')}),
         xlsx_profile(), 'ESTRUCTURA_INVALIDA', None),
        ('zip-entradas-superpuestas.xlsx', overlapping_entry(book), xlsx_profile(), 'ZIP_CORRUPTO', None),
        ('texto-190mb.xlsx', with_sheet(HEADER_ROW + '<row r="2"><c r="A2" t="inlineStr"><is><t>' + solid_text + '</t></is></c></row>'),
         xlsx_profile(), 'CELDA_EXCEDE_LIMITE', None),
        ('comentario-190mb.xlsx', with_raw_sheet(raw_sheet(HEADER_ROW).replace(b'<sheetData>', f'<!--{solid_text}--><sheetData>'.encode())),
         xlsx_profile(), 'COLUMNA_OBLIGATORIA_AUSENTE', None),
        ('atributo-190mb.xlsx', with_raw_sheet(raw_sheet(HEADER_ROW).replace(b'<sheetData>', f'<a b="{solid_text}"/><sheetData>'.encode())),
         xlsx_profile(), 'COLUMNA_OBLIGATORIA_AUSENTE', None),
        # El tiempo máximo corta de verdad: hojas, cadenas y texto, sin esperar al final del archivo.
        ('tiempo-hoja.xlsx', with_raw_sheet(_worksheet(b'<sheetData>' + noisy(b'<row><c><v>1</v></c></row>', 150_000_000) + b'</sheetData></worksheet>')),
         xlsx_profile(), 'TIEMPO_LECTURA_EXCEDIDO', replace(FileLimits(), read_seconds=0.5)),
        ('tiempo-cadenas.xlsx', with_shared_strings('<row r="1"><c r="A1" t="s"><v>0</v></c></row>', _sst(noisy(b'<si/>', 150_000_000))),
         xlsx_profile(), 'TIEMPO_LECTURA_EXCEDIDO', replace(FileLimits(), read_seconds=0.5)),
        # 300 000 filas de CSV se leen en unos 0,3 s: con menos que eso, el tiempo corta antes que el tope de filas.
        ('tiempo-texto.csv', b'A,B\n' + b'1,2\n' * 5_000_000, csv_profile(), 'TIEMPO_LECTURA_EXCEDIDO', replace(FileLimits(), read_seconds=0.02)),
        ('plantilla-y-libro.xlsx', rewrite_zip(book, replace_parts={'[Content_Types].xml': _part(book, '[Content_Types].xml').replace(
            b'</Types>', b'<Override PartName="/xl/otro.xml" ContentType="application/vnd.openxmlformats-officedocument'
                         b'.spreadsheetml.template.main+xml"/></Types>')}), xlsx_profile(), 'FORMATO_NO_SOPORTADO', None),
        ('solo-plantilla.xlsx', rewrite_zip(book, replace_parts={'[Content_Types].xml': _part(book, '[Content_Types].xml').replace(
            b'spreadsheetml.sheet.main+xml', b'spreadsheetml.template.main+xml')}), xlsx_profile(), 'FORMATO_NO_SOPORTADO', None),
        ('hoja-de-macros.xlsx', rewrite_zip(book, replace_parts={'[Content_Types].xml': _part(book, '[Content_Types].xml').replace(
            b'</Types>', b'<Override PartName="/xl/macrosheets/sheet1.xml" ContentType="application/vnd.ms-excel.macrosheet+xml"/></Types>')},
            add={'xl/macrosheets/sheet1.xml': b'<a/>'}), xlsx_profile(), 'MACRO_NO_PERMITIDA', None),
        ('relacion-a-macro.xlsx', rewrite_zip(book, replace_parts={'xl/_rels/workbook.xml.rels': _part(book, 'xl/_rels/workbook.xml.rels').replace(
            b'</Relationships>', b'<Relationship Id="rId99" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" '
                                 b'Target="otro.dat"/></Relationships>')}), xlsx_profile(), 'MACRO_NO_PERMITIDA', None),
        ('formula-texto.xlsx', with_sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>A</t></is></c></row>'
                                          '<row r="2"><c r="A2" t="inlineStr"><is><t>=1+1</t></is></c></row>'),
         xlsx_profile(), 'FORMULA_EN_CELDA', None),
        ('demasiadas-filas.xlsx', with_sheet(rows_default), xlsx_profile(), 'LIMITE_ARCHIVO_EXCEDIDO', None),
        ('demasiadas-filas.csv', b'A\n' + b'1\n' * 300_001, csv_profile(), 'LIMITE_ARCHIVO_EXCEDIDO', None),
        ('mayor-csv-aceptado.csv', ','.join(f'c{n}' for n in range(60)).encode() + b'\n' + (b'1' + b',' * 59 + b'\n') * 300_000,
         csv_profile(), 'COLUMNA_OBLIGATORIA_AUSENTE', None),
        ('lineas-en-blanco.csv', b'A\n' + b'\n' * 24_000_000, csv_profile(), 'LIMITE_ARCHIVO_EXCEDIDO', None),
        ('una-linea-enorme.csv', b'ab,' * 8_000_000, csv_profile(), 'LIMITE_ARCHIVO_EXCEDIDO', None),
        ('fila-multilinea-enorme.csv', b'A\n' + b'"\n",' * 4_000_000, csv_profile(), 'LIMITE_ARCHIVO_EXCEDIDO', None),
        ('celda-enorme-entre-comillas.csv', b'A\n"' + b'x' * 200_000 + b'"\n', csv_profile(), 'CELDA_EXCEDE_LIMITE', None),
        ('bom-utf8-declarado-cp1252.csv', b'\xef\xbb\xbfA\n1\n', _csv_encoding('cp1252'), 'CODIFICACION_NO_COINCIDE', None),
        ('bom-utf16-declarado-cp1252.csv', b'\xff\xfeA\xe9\n', _csv_encoding('cp1252'), 'CONTENIDO_NO_TEXTO', None),
        ('bom-utf16-sin-nul.csv', b'\xff\xfeA\n', csv_profile(), 'CONTENIDO_NO_TEXTO', None),
        ('bom-doble.csv', b'\xef\xbb\xbf\xef\xbb\xbfA\n1\n', csv_profile(), 'CARACTER_CONTROL', None),
        ('c1-en-latin1.csv', b'A\n\x80\n', _csv_encoding('latin-1'), 'CARACTER_CONTROL', None),
        ('control-bidireccional.csv', 'A\nnombre\u202egnp\n'.encode(), csv_profile(), 'CARACTER_CONTROL', None),
        ('separador-linea-unicode.csv', 'A\nuno\u2028dos\n'.encode(), csv_profile(), 'CARACTER_CONTROL', None),
        ('formula-con-espacios.csv', b'A\n"  =1+1"\n', csv_profile(), 'FORMULA_EN_CELDA', None),
        ('demasiadas-columnas.xlsx', with_sheet(f'<row r="1">{columns_default}</row>'), xlsx_profile(), 'LIMITE_ARCHIVO_EXCEDIDO', None),
        ('demasiadas-columnas.csv', b','.join(f'c{n}'.encode() for n in range(61)) + b'\n', csv_profile(), 'LIMITE_ARCHIVO_EXCEDIDO', None),
        ('fila-fuera-de-excel.xlsx', with_sheet('<row r="1048577"><c r="A1048577"><v>1</v></c></row>'), xlsx_profile(), 'ESTRUCTURA_INVALIDA', None),
        ('demasiadas-hojas.xlsx', many_sheets, xlsx_profile(), 'LIMITE_HOJAS_EXCEDIDO', None),
        ('hoja-ausente.xlsx', workbook_bytes({'otra': [['x']]}), xlsx_profile(), 'HOJA_NO_ENCONTRADA', None),
        ('archivo-grande.csv', b'A\n' + b'x' * 25_000_000, csv_profile(), 'LIMITE_ARCHIVO_EXCEDIDO', None),
        ('celda-larga.csv', b'A\n' + b'x' * 32_768 + b'\n', csv_profile(), 'CELDA_EXCEDE_LIMITE', None),
        ('celda-larga.xlsx', with_sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>A</t></is></c></row>'
                                        '<row r="2"><c r="A2" t="inlineStr"><is><t>' + os.urandom(16_384).hex() + '</t></is></c></row>'),
         xlsx_profile(), 'CELDA_EXCEDE_LIMITE', None),
        ('utf16.csv', 'ClaveAgrupacion,Cuenta\n1,2\n'.encode('utf-16'), csv_profile(), 'CONTENIDO_NO_TEXTO', None),
        ('gzip.csv', b'\x1f\x8b\x08\x00' + bytes(40), csv_profile(), 'CONTENIDO_NO_TEXTO', None),
    ]


def _worksheet(body):
    return b'<?xml version="1.0"?><worksheet xmlns="' + MAIN_NS.encode() + b'">' + body


def _sst(body):
    return b'<sst xmlns="' + MAIN_NS.encode() + b'">' + body + b'</sst>'


def with_raw_sheet(sheet, **kwargs):
    # Cerrado o no: el rechazo debe llegar antes que el error de XML.
    return rewrite_zip(minimal_workbook(), replace_parts={'xl/worksheets/sheet1.xml': sheet}, **kwargs)


def _csv_encoding(encoding):
    mapping = csv_profile()
    mapping['formato']['codificacion'] = encoding
    return mapping


def _letters(number):
    text = ''
    while number:
        number, remainder = divmod(number - 1, 26)
        text = chr(65 + remainder) + text
    return text


def _part(data, name):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return archive.read(name)


def _macro_types(book):
    return _part(book, '[Content_Types].xml').replace(
        b'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
        b'application/vnd.ms-excel.sheet.macroEnabled.main+xml')


@pytest.fixture(scope='module')
def hostile_cases():
    return _hostile_cases()


def test_own_hostile_corpus_is_rejected_with_its_code(tmp_path, hostile_cases):
    outcomes = {}
    cases = [case for case in hostile_cases if case[0] not in AT_LIMIT_CASES]  # Costosos: se miden en un proceso propio.
    for name, data, mapping, code, limits in cases:
        path = write(tmp_path, name, data)
        try:
            extract.read_source_tables(dict.fromkeys(KINDS, path), mapping, limits=limits)
            outcomes[name] = 'ACEPTADO'
        except ValidationError as error:
            outcomes[name] = str(error).split(':')[0]
            assert SENTINEL not in str(error) and str(tmp_path) not in str(error)
    assert outcomes == {case[0]: case[3] for case in cases}


CHILD = '''
import json, resource, sys, time
sys.path.insert(0, sys.argv[1])
from ETL.readers.limits import Deadline, FileLimits, open_source
from ETL.readers.xlsx import read_workbook
import ETL.extract as extract
from ETL.validate_source import ValidationError, load_contract
path, profile, limits = sys.argv[2], json.loads(sys.argv[3]), json.loads(sys.argv[4])
contract = load_contract()
limits = FileLimits.from_contract(contract, **limits)
scale = 1 if sys.platform == 'darwin' else 1024
before = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * scale
start = time.perf_counter()
try:
    extract.read_source_tables(dict.fromkeys(('cabecera', 'detalle'), path), profile, contract=contract, limits=limits)
    code = 'ACEPTADO'
except ValidationError as error:
    code = str(error).split(':')[0]
print(json.dumps({'codigo': code, 'segundos': time.perf_counter() - start,
                  'memoria_mib': (resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * scale - before) / 2**20}))
'''


def measure(path, mapping, limits=None):
    """Mide un archivo en un proceso propio: ru_maxrss no baja dentro del mismo proceso."""
    overrides = {} if limits is None else {
        name: getattr(limits, name) for name in ('uncompressed_bytes', 'compression_ratio', 'read_seconds')}
    # Sin esto, pytest-cov mide también al hijo y el tiempo sale varias veces mayor que el real.
    env = {name: value for name, value in os.environ.items() if not name.startswith(('COV_CORE', 'COVERAGE'))}
    result = subprocess.run([sys.executable, '-B', '-c', CHILD, str(BACK), str(path), json.dumps(mapping), json.dumps(overrides)],
                            capture_output=True, text=True, cwd=BACK, timeout=120, check=False, env=env)
    assert result.returncode == 0, result.stderr[-400:]
    assert 'Traceback' not in result.stderr
    assert SENTINEL not in result.stdout + result.stderr
    return json.loads(result.stdout)


def test_hostile_files_stay_within_the_measured_memory_and_time_budget(tmp_path, corpus, hostile_cases):
    folder, entries = corpus
    cases = [(folder / name, profile_for(name), entry['esperado'], None) for name, entry in entries.items()
             if entry['esperado'] != 'HOJAS_EXTRA_IGNORADAS']
    cases += [(write(tmp_path, name, data), mapping, code, limits) for name, data, mapping, code, limits in hostile_cases]
    for path, mapping, code, limits in cases:
        outcome = measure(path, mapping, limits)
        at_limit = path.name in AT_LIMIT_CASES
        assert outcome['codigo'] == code, path.name
        assert outcome['segundos'] <= (AT_LIMIT_MAX_SECONDS if at_limit else MAX_SECONDS), (path.name, outcome)
        assert outcome['memoria_mib'] <= (AT_LIMIT_MAX_RSS_GROWTH_MIB if at_limit else MAX_RSS_GROWTH_MIB), (path.name, outcome)


AUDIT_CHILD = '''
import json, sys
sys.path.insert(0, sys.argv[1])
from ETL import extract
files, profile = json.loads(sys.argv[2]), json.loads(sys.argv[3])
events = []
def hook(name, args):
    if name.startswith(('socket.', 'subprocess.', 'os.system', 'os.exec', 'os.fork', 'os.posix_spawn', 'os.spawn', 'urllib.', 'http.',
                        'ftplib.', 'smtplib.', 'tempfile.', 'os.remove', 'os.rename', 'os.mkdir', 'shutil.')):
        events.append(name)
    elif name == 'open' and isinstance(args[1], str) and set(args[1]) & set('wax+'):
        events.append(name)
    elif name == 'open' and isinstance(args[2], int) and args[2] & 3:
        events.append(name)
sys.addaudithook(hook)
tables = extract.read_source_tables(files, profile)
print(json.dumps({'eventos': events, 'filas': {kind: len(table.rows) for kind, table in tables.items()}}))
'''


def test_reading_uses_no_network_no_process_and_writes_nothing(tmp_path):
    """Los archivos nunca salen a un servicio externo, ni la lectura deja nada en disco."""
    book = write(tmp_path, 'libro', workbook_bytes(fixture_sheets()))
    profile = xlsx_profile()
    result = subprocess.run([sys.executable, '-B', '-c', AUDIT_CHILD, str(BACK), json.dumps(dict.fromkeys(KINDS, str(book))), json.dumps(profile)],
                            capture_output=True, text=True, cwd=BACK, check=False)
    assert result.returncode == 0, result.stderr[-400:]
    outcome = json.loads(result.stdout)
    assert outcome['eventos'] == []
    assert outcome['filas']['cabecera'] > 0
    assert sorted(path.name for path in tmp_path.iterdir()) == ['libro']


def test_size_and_ratio_are_verified_before_opening_any_part(tmp_path, monkeypatch):
    def forbidden(*_, **__):
        raise AssertionError('no debe abrirse')
    book = minimal_workbook()
    by_size = write(tmp_path, 'libro', declared_size(rewrite_zip(book, add={'xl/media/a.bin': os.urandom(1 << 16)}),
                                                     'xl/media/a.bin', 400_000_000))
    by_ratio = write(tmp_path, 'libro2', rewrite_zip(book, add={'xl/media/a.bin': bytes(1 << 20)}))
    monkeypatch.setattr('ETL.readers.xlsx._check_parts', forbidden)
    monkeypatch.setattr(zipfile.ZipFile, 'open', forbidden)
    reject(by_size, xlsx_profile(), 'TAMANO_DESCOMPRIMIDO_EXCEDIDO')
    reject(by_ratio, xlsx_profile(), 'RAZON_COMPRESION_EXCEDIDA')


def test_count_in_the_end_record_can_lie_but_the_directory_cannot(tmp_path):
    many = io.BytesIO()
    with zipfile.ZipFile(many, 'w') as archive:
        for number in range(2100):
            archive.writestr(str(number), b'')
    data = many.getvalue()
    position = data.rindex(b'PK\x05\x06')
    lying = data[:position + 8] + struct.pack('<HH', 1, 1) + data[position + 12:]
    reject(write(tmp_path, 'libro', lying), xlsx_profile(), 'LIMITE_PARTES_ZIP_EXCEDIDO')


def test_directory_is_measured_before_zipfile_builds_it(tmp_path, monkeypatch):
    def forbidden(*_, **__):
        raise AssertionError('no debe construirse')
    many = io.BytesIO()
    with zipfile.ZipFile(many, 'w') as archive:
        for number in range(2100):
            archive.writestr(str(number), b'')
    data = many.getvalue()
    position = data.rindex(b'PK\x05\x06')
    # El contador puede mentir: ZipFile recorre el directorio por tamaño, no por cantidad.
    lying = data[:position + 8] + struct.pack('<HH', 1, 1) + data[position + 12:]
    by_count = write(tmp_path, 'libro', data)
    by_bytes = write(tmp_path, 'libro2', lying)
    monkeypatch.setattr('ETL.readers.xlsx._PackageReader', forbidden)
    reject(by_count, xlsx_profile(), 'LIMITE_PARTES_ZIP_EXCEDIDO')
    reject(by_bytes, xlsx_profile(), 'LIMITE_PARTES_ZIP_EXCEDIDO', limits=replace(FileLimits(), zip_directory_bytes=1024))


def test_xls_has_the_exact_message_for_any_profile_or_name(tmp_path, corpus):
    assert XLS_MESSAGE == 'Formato .xls no soportado: guardá el archivo como .xlsx o .csv'
    folder, _ = corpus
    for path, mapping in ((folder / 'xls-renombrado.xlsx', xlsx_profile()), (folder / 'xls-renombrado.xlsx', csv_profile()),
                          (write(tmp_path, 'planilla.XLS', b'A\n1\n'), csv_profile())):
        with pytest.raises(ValidationError) as error:
            extract.read_source_tables(dict.fromkeys(KINDS, path), mapping)
        assert str(error.value) == f'FORMATO_XLS_NO_SOPORTADO: {XLS_MESSAGE}'


def test_type_comes_from_content_not_from_the_name(tmp_path):
    book = workbook_bytes(fixture_sheets())
    expected = tsv_reference()[2]
    profile = xlsx_profile()
    for name in ('sin-extension', 'libro.csv', 'libro.txt', '5f1e.tmp'):
        path = write(tmp_path, name, book)
        assert extract.validate_source_files(dict.fromkeys(KINDS, path), profile, cut_off=profile['fecha_corte']) == expected
    text_files = {}
    for kind in KINDS:
        buffer = io.StringIO()
        csv.writer(buffer, lineterminator='\n').writerows(fixture_records(kind))
        text_files[kind] = write(tmp_path, f'{kind}.xlsx', buffer.getvalue().encode())
    profile = csv_profile()
    assert extract.validate_source_files(text_files, profile, cut_off=profile['fecha_corte']) == expected


def test_encoding_is_only_what_the_profile_declares(tmp_path):
    payload = 'ClaveAgrupacion\tBien_Descripcion\nK\tPeñón Ñandú\n'
    mapping = load_mapping(FIXTURE)
    latin = write(tmp_path, 'latin.tsv', payload.encode('latin-1'))
    reject(latin, mapping, 'ARCHIVO_NO_LEIBLE')  # UTF-8 no adivina otra codificación.
    mapping['formato']['codificacion'] = 'cp1252'
    # cp1252 cubre el Latin-1 imprimible; 0x80-0x9F son control en Latin-1 y aquí no se leen como tal.
    with pytest.raises(ValidationError, match='COLUMNA_OBLIGATORIA_AUSENTE'):
        extract.read_source_tables(dict.fromkeys(KINDS, latin), mapping)
    bom = write(tmp_path, 'bom.tsv', b'\xef\xbb\xbf' + payload.encode('utf-8'))
    mapping['formato']['codificacion'] = 'utf-8'
    with pytest.raises(ValidationError, match='COLUMNA_OBLIGATORIA_AUSENTE'):
        extract.read_source_tables(dict.fromkeys(KINDS, bom), mapping)


@pytest.mark.parametrize('value', ['-', '--', '-1234,50', '+54 351 555-0000', '+', '- cuota 3', '@usuario.com', '=', 'a=1', '1+1'])
def test_ordinary_values_are_not_mistaken_for_formulas(tmp_path, value):
    path = write(tmp_path, 'datos.tsv', f'A\tB\nK\t{value}\n'.encode())
    mapping = load_mapping(FIXTURE)
    with pytest.raises(ValidationError, match='COLUMNA_OBLIGATORIA_AUSENTE'):
        extract.read_source_tables(dict.fromkeys(KINDS, path), mapping)


@pytest.mark.parametrize('value', ['=1+1', '=cmd|x', '@SUM(1)', '+cmd', '-cmd', '-2+3', '+1*2'])
def test_formula_like_text_is_rejected_in_every_format(tmp_path, value):
    path = write(tmp_path, 'datos.csv', f'A,B\nK,"{value}"\n'.encode())
    reject(path, csv_profile(), 'FORMULA_EN_CELDA')
    path = write(tmp_path, 'libro', workbook_bytes({'cabecera': [['A', 'B'], ['K', None]], 'detalle': [['A'], ['1']]},
                                                   configure=lambda book: _set_text(book, value)))
    reject(path, xlsx_profile(), 'FORMULA_EN_CELDA')


def _set_text(book, value):
    cell = book['cabecera']['B2']
    cell.value = value
    cell.data_type = 's'


def test_reading_time_limit_applies_to_each_format(tmp_path):
    limits = replace(FileLimits(), read_seconds=0)
    path = write(tmp_path, 'datos.csv', b'A\n1\n')
    reject(path, csv_profile(), 'TIEMPO_LECTURA_EXCEDIDO', limits=limits)
    path = write(tmp_path, 'libro', minimal_workbook())
    reject(path, xlsx_profile(), 'TIEMPO_LECTURA_EXCEDIDO', limits=limits)
    reads = iter([0.0, 0.0, 99.0])
    deadline = Deadline(10, clock=lambda: next(reads))
    deadline.check('cabecera')
    with pytest.raises(ValidationError, match='TIEMPO_LECTURA_EXCEDIDO: archivo=detalle, linea=7'):
        deadline.check('detalle', 7)


def test_xlsx_limits_at_the_boundary_are_accepted(tmp_path):
    rows = ''.join(f'<row r="{n}"><c r="A{n}" t="inlineStr"><is><t>v{n}</t></is></c></row>' for n in range(1, 5))
    path = write(tmp_path, 'libro', with_sheet(rows))
    mapping = xlsx_profile()
    limits = replace(FileLimits(), rows=3, columns=1)
    with open(path, 'rb') as stream:
        table = extract.read_workbook(stream, {'cabecera': 'cabecera'}, mapping['formato'], {'cabecera': {}},
                                      limits, Deadline(60)).tables['cabecera']
    assert len(table.rows) == 3
    with open(path, 'rb') as stream, pytest.raises(ValidationError, match='LIMITE_ARCHIVO_EXCEDIDO'):
        extract.read_workbook(stream, {'cabecera': 'cabecera'}, mapping['formato'], {'cabecera': {}},
                              replace(limits, rows=2), Deadline(60))


def test_extra_cell_beyond_header_is_rejected_and_blank_trailing_columns_are_not(tmp_path):
    rows = ('<row r="1"><c r="A1" t="inlineStr"><is><t>A</t></is></c><c r="B1"/></row>'
            '<row r="2"><c r="A2"><v>1</v></c><c r="B2"/></row>'
            '<row r="3"><c r="A3"><v>1</v></c><c r="B3"><v>2</v></c></row>')
    path = write(tmp_path, 'libro', with_sheet(rows))
    with pytest.raises(ValidationError, match='ESTRUCTURA_INVALIDA: archivo=cabecera, linea=3'):
        extract.read_source_tables(dict.fromkeys(KINDS, path), xlsx_profile())


def test_profile_schema_rules_for_xlsx():
    good = xlsx_profile()
    extract.validate_source_profile(good)
    assert extract.load_source_profile(extract.MAPPING_SCHEMA.parent / 'source-mapping.sintetico-xlsx.v1.json')['formato']['tipo'] == 'xlsx'
    for change in ({'separador': ','}, {'hojas': None}, {'hojas': {'cabecera': 'a'}}, {'fecha_serial': '1901'},
                   {'hojas': {'cabecera': 'a', 'detalle': 'b', 'x': 'c'}}):
        mapping = copy.deepcopy(good)
        mapping['formato'].update(change)
        with pytest.raises(ValidationError, match='^PERFIL_INVALIDO$'):
            extract.validate_source_profile(mapping)
    for extra in ({'hojas': dict(SHEETS)}, {'fecha_serial': '1900'}):
        mapping = load_mapping(FIXTURE)
        mapping['formato'].update(extra)
        with pytest.raises(ValidationError, match='^PERFIL_INVALIDO$'):
            extract.validate_source_profile(mapping)
    mapping = load_mapping(FIXTURE)
    mapping['formato'].update(tipo='xlsx', separador=None)
    with pytest.raises(ValidationError, match='^PERFIL_INVALIDO$'):
        extract.validate_source_profile(mapping)


def test_two_workbooks_may_use_the_same_sheet_name_but_one_workbook_may_not(tmp_path):
    sheets = fixture_sheets()
    files = {kind: write(tmp_path, kind, workbook_bytes({'Hoja1': sheets[kind]})) for kind in KINDS}
    profile = xlsx_profile()
    profile['formato']['hojas'] = {'cabecera': 'Hoja1', 'detalle': 'Hoja1'}
    assert extract.validate_source_files(files, profile, cut_off=profile['fecha_corte']) == tsv_reference()[2]
    with pytest.raises(ValidationError, match='^PERFIL_INVALIDO$'):
        extract.read_source_tables(dict.fromkeys(KINDS, files['cabecera']), profile)


def test_two_sheet_names_cannot_point_to_the_same_part(tmp_path):
    book = minimal_workbook()
    relations = _part(book, 'xl/_rels/workbook.xml.rels').replace(b'worksheets/sheet2.xml', b'worksheets/sheet1.xml')
    path = write(tmp_path, 'libro', rewrite_zip(book, replace_parts={'xl/_rels/workbook.xml.rels': relations}))
    reject(path, xlsx_profile(), 'ESTRUCTURA_INVALIDA')


def test_the_guarded_part_is_the_one_openpyxl_reads_even_with_a_decoy_id(tmp_path):
    """Un atributo ``id`` en otro espacio de nombres no puede desviar la hoja que se controla."""
    book = minimal_workbook()
    workbook = _part(book, 'xl/workbook.xml')
    decoy = re.sub(rb'<sheet ([^>]*name="cabecera"[^>]*)/>', rb'<sheet xmlns:z="urn:z" z:id="rId2" \1/>', workbook)
    assert decoy != workbook
    formula = raw_sheet(HEADER_ROW + '<row r="2"><c r="A2"><f>1+1</f></c></row>')
    path = write(tmp_path, 'libro', rewrite_zip(book, replace_parts={'xl/workbook.xml': decoy, 'xl/worksheets/sheet1.xml': formula}))
    reject(path, xlsx_profile(), 'FORMULA_SIN_VALOR')


def test_ignored_sheets_are_not_interpreted_at_all(tmp_path, monkeypatch):
    """Nada de ``load_workbook``: ni la hoja ignorada, ni propiedades, tema o nombres definidos."""
    from openpyxl.reader.excel import ExcelReader
    from openpyxl.reader.workbook import WorkbookParser
    opened = []
    original = zipfile.ZipFile.open
    def spy(self, name, *args, **kwargs):
        opened.append(name.filename if isinstance(name, zipfile.ZipInfo) else name)
        return original(self, name, *args, **kwargs)
    def forbidden(*_, **__):
        pytest.fail('no debe interpretarse')
    for method in ('read_properties', 'read_custom', 'read_theme', 'read_worksheets', 'read_chartsheet'):
        monkeypatch.setattr(ExcelReader, method, forbidden)
    monkeypatch.setattr(WorkbookParser, 'assign_names', forbidden)
    data = workbook_bytes({'cabecera': [['A'], ['1']], 'detalle': [['A'], ['2']], 'otra': [['x']]})
    mapping = xlsx_profile()
    monkeypatch.setattr(zipfile.ZipFile, 'open', spy)
    result = extract.read_workbook(io.BytesIO(data), SHEETS, mapping['formato'], {'cabecera': {}, 'detalle': {}},
                                   FileLimits(), Deadline(60))
    assert result.ignored_sheets == ['otra']
    # Se abre una sola vez, para el CRC y el prólogo; las elegidas, una vez más para leerlas.
    assert opened.count('xl/worksheets/sheet3.xml') == 1
    assert opened.count('xl/worksheets/sheet1.xml') == 2


def test_chart_sheets_are_listed_and_ignored(tmp_path):
    book = workbook_bytes({'cabecera': [['A'], ['1']], 'detalle': [['A'], ['2']], 'grafico': [['x']]})
    relations = _part(book, 'xl/_rels/workbook.xml.rels').replace(b'relationships/worksheet" Target="/xl/worksheets/sheet3.xml',
                                                                  b'relationships/chartsheet" Target="/xl/worksheets/sheet3.xml')
    assert relations != _part(book, 'xl/_rels/workbook.xml.rels')
    data = rewrite_zip(book, replace_parts={'xl/_rels/workbook.xml.rels': relations, 'xl/worksheets/sheet3.xml': b'<chartsheet/>'})
    result = extract.read_workbook(io.BytesIO(data), SHEETS, xlsx_profile()['formato'], {'cabecera': {}, 'detalle': {}},
                                   FileLimits(), Deadline(60))
    assert result.ignored_sheets == ['grafico']


def test_serial_60_of_the_1900_system_does_not_exist(tmp_path):
    path, mapping = typed_cells(tmp_path, ['K', 60, 1, 'x'], fecha_serial='1900')
    assert read_detail(path, mapping)['NOTD_vencimiento'] == '60'
    path, mapping = typed_cells(tmp_path, ['K', 61, 1, 'x'], fecha_serial='1900')
    assert read_detail(path, mapping)['NOTD_vencimiento'] == '01/03/1900'


def test_latin_1_is_read_only_when_declared(tmp_path):
    files = {}
    for kind in KINDS:
        buffer = io.StringIO()
        csv.writer(buffer, lineterminator='\n').writerows(fixture_records(kind))
        files[kind] = write(tmp_path, f'{kind}.csv', buffer.getvalue().encode('latin-1'))
    reject(files['cabecera'], csv_profile(), 'ARCHIVO_NO_LEIBLE')  # Sin declararla no se adivina.
    mapping = _csv_encoding('latin-1')
    extract.validate_source_profile(mapping)
    assert extract.validate_source_files(files, mapping, cut_off=mapping['fecha_corte']) == tsv_reference()[2]


def test_error_chain_never_carries_the_original_exception(tmp_path):
    """Un traceback completo en un log tampoco debe traer valores ni rutas del archivo."""
    secret = SENTINEL.lower()
    cases = [(write(tmp_path, 'a.csv', b'ok\n\xff' + secret.encode() + b'\n'), csv_profile()),
             (write(tmp_path, 'b', with_sheet(HEADER_ROW + f'<row r="2"><c r="{secret}2"><v>1</v></c></row>')), xlsx_profile()),
             (tmp_path / secret / 'no-existe.csv', csv_profile())]
    for path, mapping in cases:
        with pytest.raises(ValidationError) as error:
            extract.read_source_tables(dict.fromkeys(KINDS, path), mapping)
        rendered = ''.join(traceback.format_exception(error.value))
        assert secret not in rendered and 'During handling' not in rendered, rendered


def test_contact_regex_does_not_blow_up_on_a_giant_cell():
    """La expresión del motor es cuadrática: una celda de 32 767 caracteres tardaba 2 s."""
    mapping = load_mapping(FIXTURE)
    header, detail = fixture_records('cabecera'), fixture_records('detalle')
    values = dict(zip(header[0], header[1], strict=True))
    values['Destinatario_Email'] = 'a@' + '.' * 32_760 + ' '
    rows = [SourceRow(line, dict(values)) for line in range(2, 202)]
    start = time.perf_counter()
    report = validate_batch({'cabecera': SourceTable(header[0], rows),
                             'detalle': SourceTable(detail[0], [SourceRow(2, dict(zip(detail[0], detail[1], strict=True)))])},
                            mapping, load_contract(), mapping['fecha_corte'])
    assert time.perf_counter() - start < 5
    assert report['resultado_lote'] == 'BLOQUEADO'


def test_cli_reads_a_single_workbook_for_both_logical_files(tmp_path):
    book = write(tmp_path, 'libro', workbook_bytes(fixture_sheets()))
    profile = write(tmp_path, 'perfil.json', json.dumps(xlsx_profile()).encode())
    result = subprocess.run([sys.executable, '-B', '-m', 'ETL.extract', '--cabecera', str(book), '--detalle', str(book),
                             '--mapping', str(profile), '--cut-off', '2026-09-30'],
                            capture_output=True, text=True, cwd=BACK, env={}, check=False)
    assert result.returncode == 1  # La fixture está bloqueada a propósito.
    assert 'BLOQUEADO' in result.stdout and 'Traceback' not in result.stderr
    bad = write(tmp_path, 'viejo.xls', b'x')
    result = subprocess.run([sys.executable, '-B', '-m', 'ETL.extract', '--cabecera', str(bad), '--detalle', str(bad),
                             '--mapping', str(profile), '--cut-off', '2026-09-30'],
                            capture_output=True, text=True, cwd=BACK, env={}, check=False)
    assert result.returncode == 2
    assert XLS_MESSAGE in result.stdout


def test_openpyxl_is_really_using_defusedxml():
    from openpyxl.xml import functions
    assert functions.iterparse.__module__.startswith('defusedxml')
    assert functions.fromstring.__module__.startswith('defusedxml')


def test_reader_refuses_to_run_without_defusedxml(tmp_path, monkeypatch):
    monkeypatch.setattr('ETL.readers.xlsx.DEFUSEDXML', False)
    reject(write(tmp_path, 'libro', minimal_workbook()), xlsx_profile(), 'XML_SEGURO_NO_DISPONIBLE')


def test_openpyxl_warnings_never_reach_the_caller(tmp_path, recwarn):
    # openpyxl avisaría con el valor si convirtiera un serial fuera de rango; ya no convierte por estilo,
    # y en una columna que no es de fecha ese serial no pasa por un número válido.
    def date_style(workbook):
        workbook['cabecera']['A2'].number_format = 'dd/mm/yyyy'
    data = workbook_bytes({'cabecera': [['A'], [10**12]], 'detalle': [['A'], ['1']]}, configure=date_style)
    assert b's="1"' in sheet_part(data)
    reject(write(tmp_path, 'libro', data), xlsx_profile(fecha_serial='1900'), 'CELDA_TIPO_NO_SOPORTADO')
    assert not recwarn.list


# ------------------------------------------------------------- nombres y temporales


@pytest.mark.parametrize(('name', 'expected'), [
    ('../../etc/passwd', 'passwd'), ('..\\..\\windows\\system32\\cmd.exe', 'cmd.exe'), ('/abs/ruta/lote.xlsx', 'lote.xlsx'),
    ('C:\\Users\\persona\\cartera.csv', 'cartera.csv'), ('a\x00b\x07.csv', 'ab.csv'), ('..', 'archivo'), ('', 'archivo'),
    ('=1+1.csv', '_1_1.csv'), ('-cmd.csv', 'cmd.csv'), ('nombre\u202egnp.exe', 'nombregnp.exe'), ('／etc／passwd', 'passwd'), ('x' * 500 + '.xlsx', 'x' * 115 + '.xlsx'),
])
def test_file_names_are_sanitized(name, expected):
    assert sanitize_filename(name) == expected


def test_store_never_uses_the_uploaded_name_as_a_path(tmp_path):
    with PrivateUploadStore(tmp_path / 'privado') as store:
        upload = store.save(io.BytesIO(b'A\n1\n'), '../../fuera.csv')
        assert upload.display_name == 'fuera.csv'
        assert upload.path.parent == store.root
        assert re.fullmatch(r'[0-9a-f]{32}', upload.path.name)
        assert not (tmp_path / 'fuera.csv').exists()
        assert upload.path.read_bytes() == b'A\n1\n' and upload.size == 4
        if os.name == 'posix':
            assert upload.path.stat().st_mode & 0o777 == 0o600
            assert store.root.stat().st_mode & 0o777 == 0o700
        assert store.resolve(upload.token) == upload.path
    assert not (tmp_path / 'privado').exists()


@pytest.mark.parametrize('token', ['../fuera', 'A' * 32, '', None, 'a' * 31, 'a' * 32 + '/..'])
def test_store_rejects_tokens_that_are_not_its_own(tmp_path, token):
    victim = write(tmp_path, 'victima', b'x')
    with PrivateUploadStore(tmp_path / 'privado') as store:
        with pytest.raises(ValidationError, match='TEMPORAL_INVALIDO'):
            store.release(token)
        with pytest.raises(ValidationError, match='TEMPORAL_INVALIDO'):
            store.resolve(token)
    assert victim.exists()


def test_no_temporary_file_remains_after_publish_discard_failure_or_ttl(tmp_path):
    now = [1_000_000_000.0]
    root = tmp_path / 'privado'
    store = PrivateUploadStore(root, clock=lambda: now[0])
    # Al publicar y al descartar.
    published = store.save(io.BytesIO(minimal_workbook()), 'lote.xlsx')
    discarded = store.save(io.BytesIO(b'A\n'), 'lote.csv')
    assert len(os.listdir(root)) == 2
    store.release(published.token)
    store.release(discarded.token)
    store.release(discarded.token)
    assert os.listdir(root) == []
    # Una copia que excede el tope no deja un parcial.
    limited = PrivateUploadStore(root, limits=replace(FileLimits(), file_bytes=3), clock=lambda: now[0])
    with pytest.raises(ValidationError, match='LIMITE_ARCHIVO_EXCEDIDO'):
        limited.save(io.BytesIO(b'demasiado'), 'lote.csv')
    assert os.listdir(root) == []
    # Lo abandonado vence a las 24 h; en cada save y en resolve.
    abandoned = store.save(io.BytesIO(b'A\n'), 'lote.csv')
    assert abandoned.expires_at == now[0] + 86_400
    now[0] += 86_399
    assert store.purge_expired() == 0
    assert store.resolve(abandoned.token) == abandoned.path
    now[0] += 1
    with pytest.raises(ValidationError, match='TEMPORAL_INEXISTENTE'):
        store.resolve(abandoned.token)
    assert os.listdir(root) == []
    with pytest.raises(ValidationError, match='TEMPORAL_INEXISTENTE'):
        store.resolve(abandoned.token)
    store.save(io.BytesIO(b'A\n'), 'lote.csv')
    now[0] += 86_400
    fresh = store.save(io.BytesIO(b'A\n'), 'lote.csv')
    assert os.listdir(root) == [fresh.token]
    assert store.purge_expired() == 0
    store.close()
    assert not root.exists()


def test_purge_tolerates_a_file_another_process_just_removed(tmp_path, monkeypatch):
    now = [1_000_000_000.0]
    with PrivateUploadStore(tmp_path / 'privado', clock=lambda: now[0]) as store:
        upload = store.save(io.BytesIO(b'A\n'), 'lote.csv')
        class Gone:
            path = str(upload.path)

            def stat(self, **_):
                raise FileNotFoundError

        monkeypatch.setattr('ETL.readers.limits.os.scandir', lambda _: [Gone()])
        now[0] += 86_400
        assert store.purge_expired() == 0
        monkeypatch.undo()
        assert store.purge_expired() == 1
        assert not upload.path.exists()


def test_unreadable_paths_have_a_safe_code(tmp_path):
    reject_values = [None, tmp_path, tmp_path / 'no-existe.csv']
    for value in reject_values:
        with pytest.raises(ValidationError, match='^ARCHIVO_NO_LEIBLE: archivo=cabecera'):
            extract.read_source_tables(dict.fromkeys(KINDS, value), csv_profile())


def test_store_refuses_a_shared_or_forged_directory(tmp_path):
    shared = tmp_path / 'compartido'
    shared.mkdir()
    shared.chmod(0o755)
    with pytest.raises(ValidationError, match='ALMACEN_TEMPORAL_INSEGURO'):
        PrivateUploadStore(shared)
    target = tmp_path / 'real'
    target.mkdir(mode=0o700)
    link = tmp_path / 'enlace'
    link.symlink_to(target)
    with pytest.raises(ValidationError, match='ALMACEN_TEMPORAL_INSEGURO'):
        PrivateUploadStore(link)


def test_store_rejects_forbidden_names_and_defaults_to_a_private_directory():
    with PrivateUploadStore() as store:
        with pytest.raises(ValidationError, match='FORMATO_XLS_NO_SOPORTADO'):
            store.save(io.BytesIO(b'x'), 'viejo.xls')
        with pytest.raises(ValidationError, match='MACRO_NO_PERMITIDA'):
            store.save(io.BytesIO(b'x'), 'macro.xlsm')
        assert os.listdir(store.root) == []
        assert store.limits.temp_ttl_seconds == 86_400


def test_full_read_cycle_through_the_store_creates_no_other_file(tmp_path, monkeypatch):
    scratch = tmp_path / 'tmp'
    scratch.mkdir()
    monkeypatch.setenv('TMPDIR', str(scratch))
    monkeypatch.setattr('tempfile.tempdir', None)
    root = tmp_path / 'privado'
    with PrivateUploadStore(root) as store:
        upload = store.save(io.BytesIO(workbook_bytes(fixture_sheets())), 'C:\\cartera.xlsx')
        profile = xlsx_profile()
        report = extract.validate_source_files(dict.fromkeys(KINDS, store.resolve(upload.token)), profile,
                                               cut_off=profile['fecha_corte'])
        assert report == tsv_reference()[2]
        assert os.listdir(scratch) == []
        store.release(upload.token)
        assert os.listdir(root) == []
    assert os.listdir(scratch) == []
    assert not root.exists()


def test_errors_reveal_no_values_names_or_paths(tmp_path, corpus):
    folder, entries = corpus
    for name in entries:
        if entries[name]['esperado'] == 'HOJAS_EXTRA_IGNORADAS':
            continue
        with pytest.raises(ValidationError) as error:
            extract.read_source_tables(dict.fromkeys(KINDS, folder / name), profile_for(name))
        text = str(error.value)
        assert 'CENTINELA' not in text and name not in text and str(folder) not in text
    secret = f'{SENTINEL}-archivo.csv'
    path = write(tmp_path, secret, f'A\n{SENTINEL}\x07\n'.encode())
    assert secret not in reject(path, csv_profile(), 'CARACTER_CONTROL')


# ------------------------------------------------------------- ciclo 1: fechas y referencias


def validated_sheets():
    """Una cabecera y tres detalles que el motor da por VALIDADO: sintetico-v1 siempre queda BLOQUEADO."""
    def first(kind):
        with (FIXTURE / f'{kind}.tsv').open(encoding='utf-8', newline='') as stream:
            return next(csv.DictReader(stream, delimiter='\t'))
    header, debt = first('cabecera'), first('detalle')
    header.update(Deuda_Actualizada='30,00', Deuda_Capital='30,00')
    debt.update(NOTD_totalActualizado='10,00', NOTD_capital='10,00', NOTD_vencimiento='29/09/2026')
    details = [{**debt, 'DEUD_id': str(700001 + number)} for number in range(3)]
    return {'cabecera': [list(header), list(header.values())],
            'detalle': [list(debt), *[list(row.values()) for row in details]]}


def validated_data(value=None, number_format=None, *, epoch=None, formula=False, column='NOTD_vencimiento'):
    sheets = validated_sheets()
    position = sheets['detalle'][0].index(column)
    if value is not None:
        sheets['detalle'][1][position] = value

    def configure(workbook):
        if epoch:
            workbook.epoch = epoch
        if number_format:
            workbook['detalle'].cell(2, position + 1).number_format = number_format
    data = workbook_bytes(sheets, configure=configure)
    if formula:
        sheet = re.sub(rb'(<c r="[A-Z]+2"[^>]*>)<v>' + str(value).encode(), rb'\1<f>1+1</f><v>' + str(value).encode(),
                       _part(data, 'xl/worksheets/sheet2.xml'), count=1)
        assert b'<f>' in sheet
        data = rewrite_zip(data, replace_parts={'xl/worksheets/sheet2.xml': sheet})
    return data


def validated_book(folder, *args, **kwargs):
    return write(folder, 'validado', validated_data(*args, **kwargs))


def lot_result(path, mapping):
    report = extract.validate_source_files(dict.fromkeys(KINDS, path), mapping, cut_off=mapping['fecha_corte'])
    return report['resultado_lote']


def test_the_control_workbook_is_validated_before_any_change(tmp_path):
    assert lot_result(validated_book(tmp_path), xlsx_profile()) == 'VALIDADO'
    assert lot_result(validated_book(tmp_path), xlsx_profile(fecha_serial='1900')) == 'VALIDADO'


SERIALS = {
    '1900': [(59, '28/02/1900'), (60, '60'), (61, '01/03/1900'), (59.5, '59.5'), (60.5, '60.5'),
             (59.99999999999, '59.99999999999'), (60.00000000001, '60.00000000001'), (0, '0'), (-1, '-1'),
             (0.5, '0.5'), (-0.5, '-0.5'), (1, '01/01/1900'), (45306, '15/01/2024'),
             (45306.5, '15/01/2024 12:00:00'), (99999999999, '99999999999')],
    '1904': [(0, '0'), (-1, '-1'), (0.5, '0.5'), (-0.5, '-0.5'), (1, '02/01/1904'), (59, '29/02/1904'), (60, '01/03/1904'),
             (61, '02/03/1904'), (60.5, '01/03/1904 12:00:00'), (43844, '15/01/2024'), (99999999999, '99999999999')],
}


@pytest.mark.parametrize(('system', 'serial', 'expected'), [(system, *case) for system, cases in SERIALS.items() for case in cases])
@pytest.mark.parametrize('style', [None, 'dd/mm/yyyy', 'yyyy-mm-dd hh:mm', 'hh:mm'])
@pytest.mark.parametrize('formula', [False, True])
def test_a_serial_means_the_same_with_any_style_or_as_a_stored_formula_result(tmp_path, system, serial, expected, style, formula):
    path = validated_book(tmp_path, serial, style, epoch=MAC_EPOCH if system == '1904' else None, formula=formula)
    mapping = xlsx_profile(fecha_serial=system)
    assert read_detail(path, mapping)['NOTD_vencimiento'] == expected
    # El contrato trata 01/01/1900 como fecha centinela: el lector la entrega y el motor la marca, igual que en TSV.
    is_plain_date = re.fullmatch(r'[0-9]{2}/[0-9]{2}/[0-9]{4}', expected) is not None and expected != '01/01/1900'
    assert lot_result(path, mapping) == ('VALIDADO' if is_plain_date else 'BLOQUEADO')


def test_serial_60_is_blocked_with_a_date_style_exactly_as_without_it(tmp_path):
    """El caso B1 de la revisión: el mismo serial no puede bloquear sin estilo y validar con estilo."""
    mapping = xlsx_profile(fecha_serial='1900')
    assert lot_result(validated_book(tmp_path, 60), mapping) == 'BLOQUEADO'
    assert lot_result(validated_book(tmp_path, 60, 'dd/mm/yyyy'), mapping) == 'BLOQUEADO'
    assert lot_result(validated_book(tmp_path, 59, 'dd/mm/yyyy'), mapping) == 'VALIDADO'
    assert lot_result(validated_book(tmp_path, 61, 'dd/mm/yyyy'), mapping) == 'VALIDADO'


def test_date_style_outside_a_date_column_never_passes_for_a_valid_number(tmp_path):
    mapping = xlsx_profile(fecha_serial='1900')
    path = validated_book(tmp_path, 45306, 'dd/mm/yyyy', column='NOTD_capital')
    assert read_detail(path, mapping)['NOTD_capital'] == '15/01/2024'
    assert lot_result(path, mapping) == 'BLOQUEADO'
    for serial in (60, 0, -1, 0.5):
        reject(validated_book(tmp_path, serial, 'dd/mm/yyyy', column='NOTD_capital'), mapping, 'CELDA_TIPO_NO_SOPORTADO')
    reject(validated_book(tmp_path, 60, 'dd/mm/yyyy', column='NOTD_capital'), xlsx_profile(), 'FECHA_SERIAL_NO_DECLARADA')
    reject(validated_book(tmp_path, 60, 'dd/mm/yyyy'), xlsx_profile(), 'FECHA_SERIAL_NO_DECLARADA')


@pytest.mark.parametrize('column', ['NOTD_vencimiento', 'NOTD_capital'])
def test_a_duration_style_is_never_a_date_or_a_number(tmp_path, column):
    reject(validated_book(tmp_path, 45306, '[h]:mm', column=column), xlsx_profile(fecha_serial='1900'), 'CELDA_TIPO_NO_SOPORTADO')


def percentage_text(folder, code, value=0.5):
    def percent(workbook):
        workbook['cabecera']['B2'].number_format = code
    data = workbook_bytes({'cabecera': [['ClaveAgrupacion', 'Destinatario_Porcentaje'], ['K', value]],
                           'detalle': [['A'], ['1']]}, configure=percent)
    mapping = xlsx_profile()
    with open(write(folder, 'libro', data), 'rb') as stream:
        tables = extract.read_workbook(stream, {'cabecera': 'cabecera'}, mapping['formato'],
                                       {'cabecera': extract._physical_types('cabecera', mapping, load_contract())},
                                       FileLimits(), Deadline(60))
    return tables.tables['cabecera'].rows[0].values['Destinatario_Porcentaje']


@pytest.mark.parametrize(('code', 'expected'), [
    ('0%', '50'), ('0.00%', '50'), ('[Red]0%', '50'), ('0%;0%', '50'), ('0%;;', '50'),
    # Un % literal no escala en Excel: la celda muestra 0,5 %, no 50 %.
    ('0.0"%"', '0,5'), ('0.0\\%', '0,5'), ('"%"0.0', '0,5'), ('0.0_%', '0,5'), ('0.0*%', '0,5'), ('[$%-409]0.0', '0,5'), ('0.0;0.0;0.0;@%', '0,5')])
def test_only_a_real_percent_format_scales_the_value(tmp_path, code, expected):
    assert percentage_text(tmp_path, code) == expected


def test_a_format_that_scales_only_some_values_is_not_guessed(tmp_path):
    with pytest.raises(ValidationError, match='CELDA_TIPO_NO_SOPORTADO: archivo=cabecera, linea=2'):
        percentage_text(tmp_path, '0%;0.0')


STRINGS = f'<sst xmlns="{MAIN_NS}"><si><t>A</t></si><si><t>B</t></si></sst>'.encode()


@pytest.mark.parametrize('index', ['-1', '-2', '2', '99', '1_0', ' 0', '0 ', '+0', '0.0', '1e0', '٠', '9' * 11])
def test_a_shared_string_index_must_be_a_plain_number_inside_the_table(tmp_path, index):
    path = write(tmp_path, 'libro', with_shared_strings(f'<row r="1"><c r="A1" t="s"><v>{index}</v></c></row>', STRINGS))
    assert reject(path, xlsx_profile(), 'ESTRUCTURA_INVALIDA').endswith('archivo=cabecera, linea=1, campo=*')


@pytest.mark.parametrize('style', ['-1', '1_0', ' 0', '+0', '1.0', '٠', '999', '9' * 11])
def test_a_style_index_must_be_a_plain_number_inside_the_table(tmp_path, style):
    path = write(tmp_path, 'libro', with_sheet(f'{HEADER_ROW}<row r="2"><c r="A2" s="{style}"><v>1</v></c></row>'))
    assert reject(path, xlsx_profile(), 'ESTRUCTURA_INVALIDA').endswith('archivo=cabecera, linea=2, campo=*')


def test_a_negative_style_cannot_borrow_the_percent_format_of_the_last_style(tmp_path):
    data = workbook_bytes({'cabecera': [['ClaveAgrupacion', 'Destinatario_Porcentaje'], ['K', 0.5]], 'detalle': [['A'], ['1']]},
                          configure=lambda workbook: setattr(workbook['cabecera']['B2'], 'number_format', '0%'))
    sheet = re.sub(rb'(<c r="B2") s="[0-9]+"', rb'\1 s="-1"', _part(data, 'xl/worksheets/sheet1.xml'))
    assert b's="-1"' in sheet
    path = write(tmp_path, 'libro', rewrite_zip(data, replace_parts={'xl/worksheets/sheet1.xml': sheet}))
    reject(path, xlsx_profile(), 'ESTRUCTURA_INVALIDA')


@pytest.mark.parametrize('text', ['1_000', ' 5', '5 ', '٣', '0x10', 'nan', 'inf', 'Infinity', '1e', '--1', '1,5'])
def test_a_stored_number_must_be_a_number_of_the_format(tmp_path, text):
    path = write(tmp_path, 'libro', with_sheet(f'{HEADER_ROW}<row r="2"><c r="A2"><v>{text}</v></c></row>'))
    reject(path, xlsx_profile(), 'ESTRUCTURA_INVALIDA')


@pytest.mark.parametrize(('text', 'expected'), [('5', '5'), ('-5', '-5'), ('+5', '5'), ('.5', '0.5'), ('5.', '5'), ('1E+2', '100'), ('2.5e-1', '0.25')])
def test_every_number_form_of_the_format_is_read(tmp_path, text, expected):
    rows = f'{HEADER_ROW}<row r="2"><c r="A2"><v>{text}</v></c></row>'
    path = write(tmp_path, 'libro', with_sheet(rows))
    mapping = xlsx_profile()
    with open(path, 'rb') as stream:
        table = extract.read_workbook(stream, {'cabecera': 'cabecera'}, mapping['formato'], {'cabecera': {}},
                                      FileLimits(), Deadline(60)).tables['cabecera']
    assert table.rows[0].values == {'A': expected}


def test_a_cell_type_outside_the_format_is_rejected(tmp_path):
    path = write(tmp_path, 'libro', with_sheet(f'{HEADER_ROW}<row r="2"><c r="A2" t="zz"><v>1</v></c></row>'))
    reject(path, xlsx_profile(), 'ESTRUCTURA_INVALIDA')


# ------------------------------------------------------------- ciclo 1: ZIP byte a byte


def handmade_zip(data, change=None, *, lead=b'', trailer=b'', entries_delta=0):
    """Arma el paquete a mano: ``change`` altera lo que cada parte declara, sin pasar por zipfile."""
    entries = {}
    with zipfile.ZipFile(io.BytesIO(data)) as source:
        for name in source.namelist():
            content = source.read(name)
            packer = zlib.compressobj(wbits=-15)
            entries[name] = {'name': name.encode(), 'stream': packer.compress(content) + packer.flush(), 'method': 8,
                             'crc': zlib.crc32(content), 'size': len(content), 'flags': 0, 'extra': b'', 'after': b''}
    if change:
        change(entries)
    output, directory = bytearray(lead), bytearray()
    for entry in entries.values():
        offset = len(output)
        stream, compressed = entry['stream'], entry.get('compressed', len(entry['stream']))
        declared = (entry['crc'], compressed, entry['size'])
        local = (entry.get('local_crc', declared[0]), entry.get('local_compressed', declared[1]), entry.get('local_size', declared[2]))
        local_name, local_extra = entry.get('local_name', entry['name']), entry.get('local_extra', b'')
        output += struct.pack('<4s5H3I2H', b'PK\x03\x04', 20, entry.get('local_flags', entry['flags']), entry.get('local_method', entry['method']),
                              0, 33, *local, len(local_name), len(local_extra)) + local_name + local_extra + stream + entry['after']
        directory += struct.pack('<4s6H3I5H2I', b'PK\x01\x02', 20, 20, entry['flags'], entry['method'], 0, 33, *declared,
                                 len(entry['name']), len(entry['extra']), 0, 0, 0, 0, offset) + entry['name'] + entry['extra']
    start = len(output)
    count = len(entries) + entries_delta
    return bytes(output + directory + struct.pack('<4s4H2IH', b'PK\x05\x06', 0, 0, count, count, len(directory), start, 0) + trailer)


STYLES_PART = 'xl/styles.xml'


def _prefix_of_a_longer_stream(entries, extra=b'<!-- mas datos -->' * 40):
    """Directorio y cabecera local describen un XML completo, pero el flujo comprimido sigue."""
    entry = entries[STYLES_PART]
    prefix = zlib.decompress(entry['stream'], -15)
    packer = zlib.compressobj(wbits=-15)
    entry['stream'] = packer.compress(prefix + extra) + packer.flush()


def _descriptor(entry, *, signature=True, crc=None):
    record = struct.pack('<III', entry['crc'] if crc is None else crc, len(entry['stream']), entry['size'])
    return (b'PK\x07\x08' if signature else b'') + record


def _with_descriptor(**options):
    def change(entries):
        for entry in entries.values():
            entry.update(flags=0x8, local_crc=0, local_compressed=0, local_size=0, after=_descriptor(entry, **options))
    return change


def _set(**values):
    def change(entries):
        entries[STYLES_PART].update(values)
    return change


def _truncated(entries):
    entries[STYLES_PART]['stream'] = entries[STYLES_PART]['stream'][:-3]


def _trailing_bytes(entries):
    entries[STYLES_PART]['stream'] += b'datos que el flujo no consume'


def _nul_in_name(entries):
    entries['xl/media/oculto.bin\x00.xml'] = {**entries[STYLES_PART], 'name': b'xl/media/oculto.bin\x00.xml'}


def _shorter_compressed_size(entries):
    entries[STYLES_PART].update(compressed=len(entries[STYLES_PART]['stream']) - 3, after=b'')


def _bad_descriptor(entries):
    _with_descriptor()(entries)
    entries[STYLES_PART]['after'] = _descriptor(entries[STYLES_PART], crc=1)


def _local_zip64(entries):
    entry = entries[STYLES_PART]
    entry['local_extra'] = struct.pack('<HHQQ', 1, 16, entry['size'], len(entry['stream']))


def _central_zip64(entries):
    entry = entries[STYLES_PART]
    entry['extra'] = struct.pack('<HHQ', 1, 8, entry['size'])


def _local_sizes_marked_zip64(entries):
    entries[STYLES_PART].update(local_compressed=0xFFFFFFFF, local_size=0xFFFFFFFF)


FORGED_PACKAGES = [
    ('prefijo-en-ambas-cabeceras', _prefix_of_a_longer_stream, {}),
    ('tamano-falso-solo-en-la-local', _set(local_size=999), {}),
    ('crc-falso-solo-en-la-local', _set(local_crc=1), {}),
    ('comprimido-falso-solo-en-la-local', _set(local_compressed=1), {}),
    ('nombre-distinto-en-la-local', _set(local_name=b'xl/stylez.xml'), {}),
    ('metodo-distinto-en-la-local', _set(local_method=0), {}),
    ('descriptor-solo-en-la-local', _set(local_flags=0x8), {}),
    ('tamano-real-menor-al-declarado', _set(size=7_000), {}),
    ('crc-falso-en-ambas', _set(crc=1), {}),
    ('flujo-truncado', _truncated, {}),
    ('bytes-tras-el-fin-del-flujo', _trailing_bytes, {}),
    ('tamano-comprimido-menor-al-flujo', _shorter_compressed_size, {}),
    ('hueco-entre-partes', _set(after=b'relleno'), {}),
    ('datos-antes-de-la-primera-parte', None, {'lead': b'PK\x03\x04relleno'}),
    ('datos-tras-el-fin-del-zip', None, {'trailer': b'relleno'}),
    ('contador-del-fin-menor', None, {'entries_delta': -1}),
    ('contador-del-fin-mayor', None, {'entries_delta': 1}),
    ('descriptor-falso', _bad_descriptor, {}),
    ('descriptor-sin-bandera', _set(after=b'PK\x07\x08' + bytes(12)), {}),
    ('nul-en-el-nombre', _nul_in_name, {}),
    ('zip64-solo-en-la-local', _local_zip64, {}),
    ('zip64-solo-en-el-directorio', _central_zip64, {}),
    ('tamanos-marcados-zip64-en-la-local', _local_sizes_marked_zip64, {}),
    ('datos-parcheados', _set(flags=0x20), {}),
    ('cifrado-fuerte', _set(flags=0x40), {}),
    ('cabeceras-enmascaradas', _set(flags=0x2000), {}),
]


def test_a_handmade_package_with_nothing_changed_is_validated(tmp_path):
    assert lot_result(write(tmp_path, 'libro', handmade_zip(validated_data())), xlsx_profile()) == 'VALIDADO'


@pytest.mark.parametrize(('name', 'change', 'options'), FORGED_PACKAGES, ids=[case[0] for case in FORGED_PACKAGES])
def test_a_package_whose_structures_disagree_is_rejected_before_reading_it(tmp_path, name, change, options):
    path = write(tmp_path, name, handmade_zip(validated_data(), change, **options))
    reject(path, xlsx_profile(), 'ZIP_CORRUPTO')


@pytest.mark.parametrize('options', [{}, {'signature': False}], ids=['con-firma', 'sin-firma'])
def test_a_streaming_writer_with_data_descriptors_is_validated(tmp_path, options):
    path = write(tmp_path, 'libro', handmade_zip(validated_data(), _with_descriptor(**options)))
    assert lot_result(path, xlsx_profile()) == 'VALIDADO'


def test_a_real_writer_to_an_unseekable_stream_is_validated(tmp_path):
    class Unseekable(io.BytesIO):
        def seekable(self):
            return False

        def seek(self, *_):
            raise io.UnsupportedOperation

        def tell(self):
            raise io.UnsupportedOperation
    output = io.BytesIO()

    class Forward(Unseekable):
        def write(self, chunk):
            return output.write(chunk)
    with zipfile.ZipFile(io.BytesIO(validated_data())) as source, zipfile.ZipFile(Forward(), 'w', zipfile.ZIP_DEFLATED) as target:
        for name in source.namelist():
            target.writestr(name, source.read(name))
    assert struct.unpack('<H', output.getvalue()[6:8])[0] & 0x8
    assert lot_result(write(tmp_path, 'libro', output.getvalue()), xlsx_profile()) == 'VALIDADO'


def test_a_stored_package_is_validated_and_its_real_bytes_are_checked_too(tmp_path):
    stored = rewrite_zip(validated_data(), compression=zipfile.ZIP_STORED)
    assert lot_result(write(tmp_path, 'libro', stored), xlsx_profile()) == 'VALIDADO'

    def inflate(entries):
        entry = entries[STYLES_PART]
        entry.update(stream=zlib.decompress(entry['stream'], -15) + b'<!-- mas -->', method=0)
    reject(write(tmp_path, 'libro2', handmade_zip(validated_data(), inflate)), xlsx_profile(), 'ZIP_CORRUPTO')


def test_real_bytes_beyond_the_declared_size_are_cut_at_once(tmp_path, monkeypatch):
    """Más de 200 MB reales detrás de un tamaño declarado chico: se corta sin descomprimirlos."""
    def huge(entries):
        entry = entries[STYLES_PART]
        prefix = zlib.decompress(entry['stream'], -15)
        packer = zlib.compressobj(wbits=-15)
        entry['stream'] = packer.compress(prefix) + b''.join(packer.compress(bytes(1 << 20)) for _ in range(210)) + packer.flush()
    path = write(tmp_path, 'libro', handmade_zip(validated_data(), huge))
    produced = []
    real = zlib.decompressobj

    class Counting:
        def __init__(self, *args):
            self.inner = real(*args)

        def decompress(self, *args):
            output = self.inner.decompress(*args)
            produced.append(len(output))
            return output

        def __getattr__(self, name):
            return getattr(self.inner, name)
    monkeypatch.setattr('ETL.readers.xlsx.zlib.decompressobj', Counting)
    reject(path, xlsx_profile(), 'ZIP_CORRUPTO')
    # Ningún byte de más: a lo sumo uno sobre lo declarado por las partes que se recorrieron.
    declared = sum(info.file_size for info in zipfile.ZipFile(io.BytesIO(validated_data())).infolist())
    assert sum(produced) <= declared + 1


def test_an_entry_declared_empty_without_a_stream_is_read_as_empty(tmp_path):
    def empty(entries):
        entries['xl/vacia.bin'] = {'name': b'xl/vacia.bin', 'stream': b'', 'method': 8, 'crc': 0, 'size': 0, 'flags': 0, 'extra': b'', 'after': b''}
    assert lot_result(write(tmp_path, 'libro', handmade_zip(validated_data(), empty)), xlsx_profile()) == 'VALIDADO'


def test_a_zip_comment_of_the_declared_length_is_accepted(tmp_path):
    data = validated_data()
    position = data.rindex(b'PK\x05\x06')
    commented = data[:position + 20] + struct.pack('<H', 7) + b'esquema'
    assert lot_result(write(tmp_path, 'libro', commented), xlsx_profile()) == 'VALIDADO'


# ------------------------------------------------------------- ciclo 1: el plazo


class Scripted:
    """Reloj de prueba: el tiempo pasa solo cuando la prueba lo dice."""

    def __init__(self, monkeypatch):
        self.now = 0.0
        monkeypatch.setattr(extract, 'Deadline', lambda seconds: Deadline(seconds, clock=lambda: self.now))

    def expire(self):
        self.now = 1e9


class _EndsTime:
    """Envuelve un recorrido XML y avisa cuando se termina la parte."""

    def __init__(self, parser, ended):
        self.parser, self.ended = parser, ended

    def __iter__(self):
        return self

    def __next__(self):
        try:
            return next(self.parser)
        except StopIteration:
            self.ended()
            raise

    def __getattr__(self, name):
        return getattr(self.parser, name)


def _excel_like_book():
    return with_shared_strings('<row r="1"><c r="A1" t="s"><v>0</v></c></row>', f'<sst xmlns="{MAIN_NS}"><si><t>A</t></si></sst>'.encode())


def test_the_deadline_is_checked_when_every_xml_part_ends(tmp_path, monkeypatch):
    """Un comentario enorme al final de una parte no da ningún lugar donde cortar mientras se lee."""
    path = write(tmp_path, 'libro', _excel_like_book())
    clock = Scripted(monkeypatch)
    real = xlsx_reader.iterparse
    ended = [0]
    expire_at = [None]

    def timed(*args, **kwargs):
        def on_end():
            ended[0] += 1
            if ended[0] == expire_at[0]:
                clock.expire()
        return _EndsTime(real(*args, **kwargs), on_end)
    monkeypatch.setattr(xlsx_reader, 'iterparse', timed)
    # Sin vencimiento rechaza por lo que le falta al libro: el recorrido llegó al final.
    reject(path, xlsx_profile(), 'COLUMNA_OBLIGATORIA_AUSENTE')
    parts = ended[0]
    assert parts >= 6
    for position in range(1, parts + 1):
        ended[0], clock.now = 0, 0.0
        expire_at[0] = position
        reject(path, xlsx_profile(), 'TIEMPO_LECTURA_EXCEDIDO')


def test_the_deadline_is_checked_right_after_the_stylesheet_is_built(tmp_path, monkeypatch):
    path = write(tmp_path, 'libro', minimal_workbook())
    clock = Scripted(monkeypatch)
    real = xlsx_reader.apply_stylesheet

    def slow(*args):
        real(*args)
        clock.expire()
    monkeypatch.setattr(xlsx_reader, 'apply_stylesheet', slow)
    monkeypatch.setattr(xlsx_reader, '_read_sheet', lambda *_: pytest.fail('no debe leer hojas después del plazo'))
    reject(path, xlsx_profile(), 'TIEMPO_LECTURA_EXCEDIDO')


def test_the_stylesheet_is_not_started_after_the_deadline(tmp_path, monkeypatch):
    path = write(tmp_path, 'libro', minimal_workbook())
    clock = Scripted(monkeypatch)
    real = xlsx_reader._PackageReader.read_workbook

    def slow(*args):
        real(*args)
        clock.expire()
    monkeypatch.setattr(xlsx_reader._PackageReader, 'read_workbook', slow)
    monkeypatch.setattr(xlsx_reader, 'apply_stylesheet', lambda *_: pytest.fail('no debe arrancar una fase que no se puede cortar'))
    reject(path, xlsx_profile(), 'TIEMPO_LECTURA_EXCEDIDO')


def test_an_expired_batch_never_reaches_validation_in_any_format(tmp_path, monkeypatch):
    book = validated_book(tmp_path)
    sheets = validated_sheets()
    delimited = {}
    for kind in KINDS:
        path = tmp_path / f'{kind}.csv'
        with path.open('w', encoding='utf-8', newline='') as stream:
            csv.writer(stream).writerows(sheets[kind])
        delimited[kind] = path
    assert lot_result(book, xlsx_profile()) == 'VALIDADO'
    profile = csv_profile()
    assert extract.validate_source_files(delimited, profile, cut_off=profile['fecha_corte'])['resultado_lote'] == 'VALIDADO'
    clock = Scripted(monkeypatch)
    real = extract._finish_table

    def finish(table, kind, *args):
        result = real(table, kind, *args)
        if kind == 'detalle':
            clock.expire()  # Lo último que hace la lectura: después no queda ninguna fila donde cortar.
        return result
    monkeypatch.setattr(extract, '_finish_table', finish)
    with pytest.raises(ValidationError, match='TIEMPO_LECTURA_EXCEDIDO'):
        extract.validate_source_files(dict.fromkeys(KINDS, book), xlsx_profile(), cut_off='2026-09-30')
    clock.now = 0.0
    with pytest.raises(ValidationError, match='TIEMPO_LECTURA_EXCEDIDO'):
        extract.validate_source_files(delimited, profile, cut_off='2026-09-30')


class _Counting(Deadline):
    def __init__(self):
        super().__init__(60)
        self.calls = 0

    def check(self, kind, line=0):
        self.calls += 1


def test_measuring_a_part_checks_the_deadline_while_it_walks(tmp_path):
    styles = f'<styleSheet xmlns="{MAIN_NS}">'.encode() + b'<a/>' * 100_000 + b'</styleSheet>'
    deadline = _Counting()
    with zipfile.ZipFile(io.BytesIO(with_styles(styles))) as archive:
        xlsx_reader._checked_tree(archive, 'xl/styles.xml', 'cabecera', FileLimits(), deadline)
    assert deadline.calls >= 100_000 // 4096


def test_walking_inside_a_row_or_a_string_checks_the_deadline(tmp_path):
    source = io.BytesIO(f'<sst xmlns="{MAIN_NS}"><si>'.encode() + b'<r/>' * 60_000 + b'</si></sst>')
    deadline = _Counting()
    assert len(list(xlsx_reader._units(source, xlsx_reader.STRING_TAG, 'cabecera', FileLimits(), deadline))) == 1
    assert deadline.calls >= 60_000 // 4096


# ------------------------------------------------------------- ciclo 1: proceso aparte


def supervised_outcome(files, mapping, **kwargs):
    start = time.perf_counter()
    try:
        batch = supervised.read_source_batch_supervised(files, mapping, **kwargs)
    except ValidationError as error:
        return str(error), time.perf_counter() - start
    return batch, time.perf_counter() - start


def rows_of(table):
    return table.columns, [(row.line, row.values) for row in table.rows]


def _delimited_validated(folder, separator=','):
    files = {}
    for kind, rows in validated_sheets().items():
        path = folder / f'{kind}.csv'
        with path.open('w', encoding='utf-8', newline='') as stream:
            csv.writer(stream, delimiter=separator).writerows(rows)
        files[kind] = path
    return files


@pytest.mark.parametrize('layout', ['xlsx', 'csv'])
def test_supervised_reading_gives_exactly_what_the_reader_gives(tmp_path, layout):
    if layout == 'xlsx':
        data = rewrite_zip(validated_data(), add={})
        files, mapping = dict.fromkeys(KINDS, write(tmp_path, 'libro', data)), xlsx_profile()
    else:
        files, mapping = _delimited_validated(tmp_path), csv_profile()
    expected = extract.read_source_batch(files, mapping)
    batch, _ = supervised_outcome(files, mapping)
    assert {kind: rows_of(table) for kind, table in batch.tables.items()} == {kind: rows_of(table) for kind, table in expected.tables.items()}
    assert batch.ignored_sheets == expected.ignored_sheets
    contract = load_contract()
    report = validate_batch(batch.tables, mapping, contract, mapping['fecha_corte'])
    assert report == validate_batch(expected.tables, mapping, contract, mapping['fecha_corte'])
    assert report['resultado_lote'] == 'VALIDADO'


def test_supervised_reading_keeps_the_codes_of_the_reader_and_leaves_nothing_behind(tmp_path):
    book = write(tmp_path, 'libro', minimal_workbook())
    assert supervised_outcome(dict.fromkeys(KINDS, book), xlsx_profile())[0].startswith('COLUMNA_OBLIGATORIA_AUSENTE')
    forged = write(tmp_path, 'forjado', handmade_zip(minimal_workbook(), _prefix_of_a_longer_stream))
    message = supervised_outcome(dict.fromkeys(KINDS, forged), xlsx_profile())[0]
    assert message.split(':')[0] == 'ZIP_CORRUPTO' and str(tmp_path) not in message
    assert sorted(path.name for path in tmp_path.iterdir()) == ['forjado', 'libro']
    with pytest.raises(ValidationError, match='ARCHIVOS_REQUERIDOS'):
        supervised.read_source_batch_supervised({'cabecera': book}, xlsx_profile())


def captured_processes(monkeypatch):
    processes = []
    real = supervised.subprocess.Popen

    def popen(*args, **kwargs):
        processes.append(real(*args, **kwargs))
        processes[-1].options = kwargs
        return processes[-1]
    monkeypatch.setattr(supervised.subprocess, 'Popen', popen)
    return processes


def test_expiry_during_a_phase_that_cannot_be_interrupted_is_a_real_cut(tmp_path, hostile_cases, monkeypatch):
    """Los estilos no devuelven el control durante segundos: quien espera no espera más que el plazo."""
    data = next(case[1] for case in hostile_cases if case[0] == 'estilos-al-limite.xlsx')
    path = write(tmp_path, 'libro', data)
    processes = captured_processes(monkeypatch)
    seconds = 1.5
    limits = replace(FileLimits(), read_seconds=seconds)
    message, elapsed = supervised_outcome(dict.fromkeys(KINDS, path), xlsx_profile(), limits=limits)
    assert message.split(':')[0] == 'TIEMPO_LECTURA_EXCEDIDO'
    assert seconds <= elapsed < seconds + 2
    assert processes[0].returncode == -9
    # Sin el proceso aparte, esa misma lectura no puede cortar a tiempo: la fase dura más que todo el margen.
    alone = measure(path, xlsx_profile(), limits)
    assert alone['codigo'] == 'TIEMPO_LECTURA_EXCEDIDO'
    assert alone['segundos'] > elapsed


def test_too_much_memory_is_a_real_cut(tmp_path, hostile_cases, monkeypatch):
    data = next(case[1] for case in hostile_cases if case[0] == 'texto-190mb.xlsx')
    path = write(tmp_path, 'libro', data)
    processes = captured_processes(monkeypatch)
    limits = replace(FileLimits(), read_memory_bytes=250 * 2**20)
    message, _ = supervised_outcome(dict.fromkeys(KINDS, path), xlsx_profile(), limits=limits)
    assert message.split(':')[0] == 'MEMORIA_LECTURA_EXCEDIDA'
    assert processes[0].returncode == -9


def test_the_child_inherits_no_credentials_and_has_no_stderr(tmp_path, monkeypatch):
    monkeypatch.setenv('SUPABASE_SERVICE_ROLE_KEY', SENTINEL)
    processes = captured_processes(monkeypatch)
    book = write(tmp_path, 'libro', minimal_workbook())
    supervised_outcome(dict.fromkeys(KINDS, book), xlsx_profile())
    options = processes[0].options
    assert SENTINEL not in json.dumps(options['env']) and set(options['env']) == {'LC_ALL', 'PYTHONUTF8'}
    assert options['stderr'] == subprocess.DEVNULL


@pytest.mark.parametrize('script', [
    'raise SystemExit(3)',
    'import sys; sys.stdin.read(); print("no es json")',
    'import sys; sys.stdin.read(); print("[1, [\\"parcial\\"]]")',
    'import sys; sys.stdin.read(); print(\'{"tabla": "cabecera", "columnas": ["A"]}\'); print(\'[2, ["a", "b"]]\')',
    'import sys; sys.stdin.read(); print(\'{"tabla": "cabecera", "columnas": ["A"]}\'); print(\'[2, ["a"]]\')',
    'import sys; sys.stdin.read(); print("{}")',
    'import sys; sys.stdin.read(); print(\'{"hojas_ignoradas": []}\')',
    'import sys; sys.stdin.read(); print(\'{"tabla": "otra", "columnas": ["A"]}\')',
    'import sys; sys.stdin.read(); print(\'{"tabla": "cabecera", "columnas": [1]}\')',
    'import sys; sys.stdin.read(); print(\'{"tabla": "cabecera", "columnas": ["A"]}\'); print(\'[2, [1]]\')',
    'import sys; sys.stdin.read(); print(\'{"tabla": "cabecera", "columnas": ["A"]}\'); print(\'["2", ["a"]]\')',
    'import sys; sys.stdin.read(); print(\'{"error": "CODIGO: 30123456, Persona Sintetica"}\')',
    'import sys; sys.stdin.read(); print(\'{"error": ["CODIGO"]}\')',
    'import sys; sys.stdin.read(); print("[" * 100000)',
], ids=['muere', 'basura', 'fila-sin-tabla', 'ancho-distinto', 'sin-marca-final', 'objeto-desconocido', 'marca-sin-tablas', 'tabla-desconocida',
        'columna-no-texto', 'celda-no-texto', 'linea-no-entera', 'error-con-valores', 'error-no-texto', 'anidado-sin-fin'])
def test_a_child_that_dies_or_answers_nonsense_never_gives_a_batch(tmp_path, monkeypatch, script):
    monkeypatch.setattr(supervised, '_worker_command', lambda: [sys.executable, '-B', '-c', script])
    book = write(tmp_path, 'libro', minimal_workbook())
    message, _ = supervised_outcome(dict.fromkeys(KINDS, book), xlsx_profile())
    assert message.split(':')[0] == 'LECTURA_INTERRUMPIDA'


def test_a_child_that_cannot_start_has_a_safe_code(tmp_path, monkeypatch):
    def refused(*_, **__):
        raise OSError(str(tmp_path))
    monkeypatch.setattr(supervised.subprocess, 'Popen', refused)
    book = write(tmp_path, 'libro', minimal_workbook())
    message, _ = supervised_outcome(dict.fromkeys(KINDS, book), xlsx_profile())
    assert message.split(':')[0] == 'LECTURA_INTERRUMPIDA' and str(tmp_path) not in message


def test_the_widest_row_the_limits_allow_fits_in_the_answer_line(tmp_path):
    """Un carácter fuera del plano básico son 12 bytes en JSON: la línea más larga tiene que entrar igual."""
    columns = [f'c{number}' for number in range(60)]
    cell = '\U0001F600' * FileLimits().cell
    path = write(tmp_path, 'ancho.csv', (','.join(columns) + '\n' + ','.join([cell] * 60) + '\n').encode())
    message = supervised_outcome(dict.fromkeys(KINDS, path), csv_profile())[0]
    assert message.split(':')[0] == 'COLUMNA_OBLIGATORIA_AUSENTE'
    sheets = validated_sheets()
    files = {}
    for kind, rows in sheets.items():
        names = rows[0] + [f'relleno{number}' for number in range(60 - len(rows[0]))]
        target = tmp_path / f'{kind}.csv'
        target.write_text(','.join(names) + '\n' + ','.join([cell] * 60) + '\n', encoding='utf-8')
        files[kind] = target
    batch, _ = supervised_outcome(files, csv_profile())
    assert batch.tables['detalle'].rows[0].values['relleno0'] == cell


def test_a_child_that_answers_more_rows_than_allowed_never_gives_a_batch(tmp_path, monkeypatch):
    script = ('import sys; sys.stdin.read(); print(\'{"tabla": "cabecera", "columnas": ["A"]}\'); '
              'print(\'[2, ["a"]]\'); print(\'[3, ["a"]]\'); print(\'{"tabla": "detalle", "columnas": ["A"]}\'); '
              'print(\'{"hojas_ignoradas": []}\')')
    monkeypatch.setattr(supervised, '_worker_command', lambda: [sys.executable, '-B', '-c', script])
    book = write(tmp_path, 'libro', minimal_workbook())
    message, _ = supervised_outcome(dict.fromkeys(KINDS, book), xlsx_profile(), limits=replace(FileLimits(), rows=1))
    assert message.split(':')[0] == 'LECTURA_INTERRUMPIDA'


def test_a_batch_that_arrives_after_the_deadline_is_not_delivered(tmp_path, monkeypatch):
    book = write(tmp_path, 'libro', validated_data())
    real = supervised._receive
    limits = replace(FileLimits(), read_seconds=60)
    moments = iter([0.0, 61.0])
    monkeypatch.setattr(supervised, '_receive', real)
    monkeypatch.setattr(supervised.threading, 'Thread', lambda **_: _NoWatcher())
    monkeypatch.setattr(supervised.time, 'monotonic', lambda: next(moments))
    with pytest.raises(ValidationError, match='TIEMPO_LECTURA_EXCEDIDO'):
        supervised.read_source_batch_supervised(dict.fromkeys(KINDS, book), xlsx_profile(), limits=limits)


class _NoWatcher:
    def start(self):
        pass

    def join(self):
        pass


def test_resident_memory_is_read_from_proc_when_the_system_has_it(tmp_path, monkeypatch):
    (tmp_path / '7').write_text('10 20 30', encoding='ascii')
    monkeypatch.setattr(supervised, '_STATM', str(tmp_path / '{pid}'))
    assert supervised._resident_bytes(7) == 20 * supervised._PAGE_BYTES
    monkeypatch.setattr(supervised, '_STATM', str(tmp_path / 'nada-{pid}'))
    assert supervised._resident_bytes(os.getpid()) > 0
    assert supervised._resident_bytes(2**22 + 3) == 0
    # Sin forma de medir, la memoria da 0 y el vigilante sigue vivo para cortar por tiempo.
    monkeypatch.setattr(supervised.subprocess, 'run', lambda *_, **__: (_ for _ in ()).throw(OSError()))
    assert supervised._resident_bytes(os.getpid()) == 0


def test_the_child_side_answers_rows_errors_and_final_mark():
    book = FIXTURE / 'cabecera.tsv'
    request = {'files': {kind: str(FIXTURE / f'{kind}.tsv') for kind in KINDS}, 'mapping': load_mapping(FIXTURE),
               'contract': load_contract(), 'limits': supervised.asdict(FileLimits())}
    output = io.StringIO()
    supervised.serve(io.StringIO(json.dumps(request)), output)
    lines = [json.loads(line) for line in output.getvalue().splitlines()]
    assert lines[0]['tabla'] == 'cabecera' and lines[-1] == {'hojas_ignoradas': []}
    assert isinstance(lines[1], list) and book.exists()
    request['files'] = {'cabecera': str(book)}
    output = io.StringIO()
    supervised.serve(io.StringIO(json.dumps(request)), output)
    assert json.loads(output.getvalue()) == {'error': 'ARCHIVOS_REQUERIDOS'}


# ------------------------------------------------------------- ciclo 1: otros casos del mismo tipo


@pytest.mark.parametrize(('number', 'cell'), [('1_0', 'A10'), (' 2', 'A2'), ('٣', 'A3'), ('1e1', 'A10'), ('+2', 'A2')])
def test_a_row_number_must_be_a_plain_number(tmp_path, number, cell):
    path = write(tmp_path, 'libro', with_sheet(f'{HEADER_ROW}<row r="{number}"><c r="{cell}"><v>1</v></c></row>'))
    reject(path, xlsx_profile(), 'ESTRUCTURA_INVALIDA')


def test_a_row_number_written_as_a_whole_float_keeps_being_read(tmp_path):
    rows = f'{HEADER_ROW}<row r="2.0"><c r="A2"><v>1</v></c></row>'
    mapping = xlsx_profile()
    with open(write(tmp_path, 'libro', with_sheet(rows)), 'rb') as stream:
        table = extract.read_workbook(stream, {'cabecera': 'cabecera'}, mapping['formato'], {'cabecera': {}},
                                      FileLimits(), Deadline(60)).tables['cabecera']
    assert [row.line for row in table.rows] == [2]


@pytest.mark.parametrize('coordinate', ['A1_0', 'a10', 'A 10', '$A$10', 'A١٠', 'A+10'])
def test_a_cell_coordinate_must_be_plain(tmp_path, coordinate):
    path = write(tmp_path, 'libro', with_sheet(f'{HEADER_ROW}<row r="10"><c r="{coordinate}"><v>1</v></c></row>'))
    reject(path, xlsx_profile(), 'ESTRUCTURA_INVALIDA')


@pytest.mark.parametrize('cell', ['<c r="A2" t="inlineStr"><v>123</v></c>', '<c r="A2" t="inlineStr"><is><t>x</t></is><v>123</v></c>',
                                  '<c r="A2"><is><t>x</t></is></c>', '<c r="A2" t="s"><is><t>x</t></is><v>0</v></c>'])
def test_a_value_the_cell_type_would_discard_is_not_lost_in_silence(tmp_path, cell):
    path = write(tmp_path, 'libro', with_shared_strings(f'{HEADER_ROW}<row r="2">{cell}</row>', STRINGS))
    reject(path, xlsx_profile(), 'ESTRUCTURA_INVALIDA')


def _styles_with(xf_format):
    return (f'<styleSheet xmlns="{MAIN_NS}"><numFmts count="1"><numFmt numFmtId="200" formatCode="0%"/></numFmts>'
            f'<cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="{xf_format}"/></cellXfs></styleSheet>').encode()


@pytest.mark.parametrize('xf_format', ['164', '-1', '1_0', '٠', '999'])
def test_a_style_cannot_borrow_a_number_format_it_does_not_declare(tmp_path, xf_format):
    """openpyxl renumera los formatos: el 164 inexistente caería sobre el 0% declarado con otro número."""
    path = write(tmp_path, 'libro', with_styles(_styles_with(xf_format)))
    reject(path, xlsx_profile(), 'ESTRUCTURA_INVALIDA')


@pytest.mark.parametrize('xf_format', ['200', '9', '0'])
def test_a_style_with_a_declared_or_builtin_format_is_read(tmp_path, xf_format):
    reject(write(tmp_path, 'libro', with_styles(_styles_with(xf_format))), xlsx_profile(), 'COLUMNA_OBLIGATORIA_AUSENTE')


def test_a_format_declared_only_for_conditional_styles_is_not_a_cell_format(tmp_path):
    styles = (f'<styleSheet xmlns="{MAIN_NS}"><cellXfs count="1"><xf numFmtId="170"/></cellXfs>'
              '<dxfs count="1"><dxf><numFmt numFmtId="170" formatCode="0%"/></dxf></dxfs></styleSheet>').encode()
    reject(write(tmp_path, 'libro', with_styles(styles)), xlsx_profile(), 'ESTRUCTURA_INVALIDA')
