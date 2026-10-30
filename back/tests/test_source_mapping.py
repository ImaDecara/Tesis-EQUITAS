"""ALIGN-030: equivalencia de formatos, perfiles explícitos y lectura sin escritura."""

import copy
import csv
import json
import subprocess
import sys
from pathlib import Path

import pytest

from ETL import extract
from ETL.transform import (
    build_debt_payload,
    build_debtor_payload,
    build_debtor_person_payload,
    build_person_payload,
)
from ETL.validate_source import load_contract, load_mapping, validate_batch

FIXTURE = Path(__file__).parent / 'fixtures/sintetico-v1'
KINDS = ('cabecera', 'detalle')


def converted_fixture(folder, mapping, *, aliases=False):
    """Conversión de transporte independiente: no importa código del lector nuevo."""
    files = {}
    for kind in KINDS:
        with (FIXTURE / f'{kind}.tsv').open(encoding='utf-8', newline='') as stream:
            records = list(csv.reader(stream, delimiter='\t'))
        if aliases:
            mapping.setdefault('columnas', {})[kind] = {name: f'col_{i}' for i, name in enumerate(records[0])}
            records[0] = list(mapping['columnas'][kind].values())
        path = folder / f'{kind}.csv'
        with path.open('w', encoding=mapping['formato']['codificacion'], newline='') as stream:
            writer = csv.writer(stream, delimiter=mapping['formato']['separador'], lineterminator='\r\n')
            writer.writerows(records)
        files[kind] = path
    return files


def payloads(source):
    headers = source.cabecera_df.to_dict('records')
    return {
        'personas': [build_person_payload(row) for row in headers],
        'objetos': [build_debtor_payload(row) for row in headers],
        'relaciones': [build_debtor_person_payload(row, 1, 2) for row in headers],
        'obligaciones': [build_debt_payload(row, 1) for row in source.detalle_df.to_dict('records')],
    }


@pytest.mark.parametrize('separator', [',', ';'])
@pytest.mark.parametrize('encoding', ['utf-8', 'utf-8-sig', 'cp1252'])
@pytest.mark.parametrize('aliases', [False, True])
def test_synthetic_tsv_csv_have_identical_payloads_and_validation(tmp_path, separator, encoding, aliases):
    mapping = load_mapping(FIXTURE)
    original = {kind: FIXTURE / f'{kind}.tsv' for kind in KINDS}
    contract = load_contract()
    expected = validate_batch(original, mapping, contract, mapping['fecha_corte'])
    baseline = extract.extract_source_files(*original.values())
    mapping['formato'].update(tipo='csv', separador=separator, codificacion=encoding)
    files = converted_fixture(tmp_path, mapping, aliases=aliases)
    before = copy.deepcopy(mapping)
    tables = extract.read_source_tables(files, mapping, contract=contract)
    report = validate_batch(tables, mapping, contract, mapping['fecha_corte'])
    actual = extract.extract_source_files(*files.values(), mapping=mapping, contract=contract)
    assert payloads(actual) == payloads(baseline)
    assert report == expected
    assert mapping == before
    assert [row.line for row in tables['cabecera'].rows] == list(range(2, 44))


def test_profile_tsv_also_matches_the_legacy_payloads():
    files = {kind: FIXTURE / f'{kind}.tsv' for kind in KINDS}
    profile = load_mapping(FIXTURE)
    assert payloads(extract.extract_source_files(*files.values(), mapping=profile)) == payloads(
        extract.extract_source_files(*files.values()))


def test_dry_run_reads_only_and_does_not_create_a_client(tmp_path, monkeypatch):
    mapping = load_mapping(FIXTURE)
    mapping['formato'].update(tipo='csv', separador=',')
    files = converted_fixture(tmp_path, mapping)
    before = {path.name: path.read_bytes() for path in tmp_path.iterdir()}
    original_open = Path.open

    def read_only(path, mode='r', *args, **kwargs):
        assert not set(mode) & set('wax+')
        return original_open(path, mode, *args, **kwargs)

    def forbidden(*args, **kwargs):
        pytest.fail('El dry-run intentó crear un cliente o escribir')

    monkeypatch.setattr(Path, 'open', read_only)
    monkeypatch.setattr('ETL.config.create_client', forbidden)
    report = extract.validate_source_files(files, mapping, cut_off=mapping['fecha_corte'])
    assert report['resultado_lote'] == 'BLOQUEADO'
    assert report['publicacion_permitida'] is False
    assert {path.name: path.read_bytes() for path in tmp_path.iterdir()} == before


@pytest.mark.parametrize(('payload', 'code'), [
    (b'ClaveAgrupacion,Cuenta\n"sin cerrar', 'ARCHIVO_NO_LEIBLE'),
    (b'ClaveAgrupacion,Cuenta\n\xff,1\n', 'ARCHIVO_NO_LEIBLE'),
    (b'ClaveAgrupacion,Cuenta\n', 'COLUMNA_OBLIGATORIA_AUSENTE'),
    (b'Cuenta, Cuenta \n1,2\n', 'ESTRUCTURA_INVALIDA'),
    (b'', 'ESTRUCTURA_INVALIDA'),
])
def test_bad_source_is_rejected_with_a_safe_code(tmp_path, payload, code):
    mapping = load_mapping(FIXTURE)
    mapping['formato'].update(tipo='csv', separador=',')
    path = tmp_path / 'CENTINELA-ARCHIVO.csv'
    path.write_bytes(payload)
    with pytest.raises(extract.ValidationError, match=code) as error:
        extract.read_source_tables(dict.fromkeys(KINDS, path), mapping)
    assert 'CENTINELA' not in str(error.value)
    assert 'sin cerrar' not in str(error.value)


def test_unsupported_format_is_rejected_before_reading(tmp_path):
    mapping = load_mapping(FIXTURE)
    mapping['formato']['tipo'] = 'xlsx'
    with pytest.raises(extract.ValidationError, match='FORMATO_NO_SOPORTADO'):
        extract.read_source_tables(dict.fromkeys(KINDS, tmp_path / 'input.xlsx'), mapping)


def test_profile_schema_is_versioned_and_used_by_the_reader():
    schema = json.loads(extract.MAPPING_SCHEMA.read_text())
    assert schema['properties']['version']['const'] == 'source-mapping.v1'
    extract.validate_source_profile(load_mapping(FIXTURE))
    for path in (extract.MAPPING_SCHEMA.parent / 'source-mapping.sintetico-v1.json',
                 extract.MAPPING_SCHEMA.parent / 'source-mapping.sintetico-csv.v1.json'):
        assert extract.load_source_profile(path)['version'] == 'source-mapping.v1'


@pytest.mark.parametrize('mutation', [
    lambda m: m.update(version='v0'), lambda m: m.update(ejecutar='CENTINELA'),
    lambda m: m.pop('municipio'), lambda m: m.update(municipio=' '),
    lambda m: m.update(fecha_corte='2026-02-30'), lambda m: m.update(moneda='ARS\n'),
    lambda m: m['formato'].update(separador='|'), lambda m: m['formato'].update(codificacion='auto'),
    lambda m: m['formato'].update(decimal='.', miles='.'), lambda m: m['formato'].update(tipo='csv'),
    lambda m: m['formato'].update(fecha='%Y'), lambda m: m['formato'].update(fin_de_linea='otro'),
    lambda m: m.update(columnas={'detalle': {'NOTD_capital': 'NOTD_totalActualizado'}}),
    lambda m: m.update(columnas={'detalle': {'NOTD_capital': ' importe '}}),
    lambda m: m.update(columnas={'detalle': {'no_existe': 'importe'}}),
    lambda m: m.update(columnas=[]), lambda m: m.update(vigencia_contactos={}),
    lambda m: m['catalogos'].update(NOTD_ESTA_id={'10': 'VENCIDA'}),
    lambda m: m['catalogos']['Bien_Tipo_Id'].update({'': 'RODADO'}),
    lambda m: m.update(transformaciones={'cabecera': {'no_existe': []}}),
    lambda m: m.update(transformaciones={'cabecera': {'Estado': ['mayusculas']}}),
    lambda m: m.update(transformaciones={'cabecera': {'Estado': [{'operacion': 'eval', 'codigo': 'CENTINELA'}]}}),
    lambda m: m.update(transformaciones={'cabecera': {'Estado': [{'operacion': 'recortar', 'valores': {}}]}}),
    lambda m: m.update(transformaciones={'cabecera': {'Estado': [{'operacion': 'mapear_codigos', 'valores': {}}]}}),
    lambda m: m.update(transformaciones={'cabecera': {'Estado': [{'operacion': 'mapear_codigos', 'valores': {'': 'Activo'}}]}}),
    lambda m: m.update(transformaciones={'cabecera': {'Estado': [{'operacion': 'mapear_codigos', 'valores': {'A': ''}}]}}),
])
def test_invalid_profiles_fail_before_reading_and_never_execute_code(tmp_path, mutation):
    mapping = load_mapping(FIXTURE)
    mutation(mapping)
    with pytest.raises(extract.ValidationError, match='^(PERFIL_INVALIDO|CONFIGURACION_INVALIDA|CORTE_INVALIDO)$'):
        extract.read_source_tables(dict.fromkeys(KINDS, tmp_path / 'no_existe.tsv'), mapping)


@pytest.mark.parametrize('mapping', [None, [], 'CENTINELA', {'version': 'source-mapping.v1'}])
def test_wrong_profile_shape_has_a_safe_error(mapping):
    with pytest.raises(extract.ValidationError, match='^PERFIL_INVALIDO$'):
        extract.validate_source_profile(mapping)


def first_rows():
    records = {}
    for kind in KINDS:
        with (FIXTURE / f'{kind}.tsv').open() as stream:
            records[kind] = [next(csv.DictReader(stream, delimiter='\t'))]
    return records


def write_records(folder, records, *, separator='\t', suffix='tsv'):
    files = {}
    for kind, rows in records.items():
        path = folder / f'{kind}.{suffix}'
        with path.open('w', encoding='utf-8', newline='') as stream:
            writer = csv.DictWriter(stream, list(rows[0]), delimiter=separator, lineterminator='\n')
            writer.writeheader()
            writer.writerows(rows)
        files[kind] = path
    return files


def test_explicit_number_and_date_formats_produce_identical_payloads(tmp_path):
    records = first_rows()
    contract = load_contract()
    mapping = load_mapping(FIXTURE)
    for kind, rows in records.items():
        for name, spec in contract['archivos'][kind]['columnas'].items():
            if spec['tipo'] == 'importe':
                rows[0][name] = '1.234,56'
            elif spec['tipo'] == 'fecha':
                rows[0][name] = '29/09/2026'
    original = write_records(tmp_path, records)
    expected = extract.extract_source_files(*original.values(), mapping=mapping)
    expected_report = extract.validate_source_files(original, mapping, cut_off=mapping['fecha_corte'])
    for rows in records.values():
        for row in rows:
            for name, value in row.items():
                row[name] = {'1.234,56': '1,234.56', '29/09/2026': '2026-09-29'}.get(value, value)
    files = write_records(tmp_path, records, separator=',', suffix='csv')
    mapping['formato'].update(tipo='csv', separador=',', decimal='.', miles=',', fecha='aaaa-mm-dd')
    actual = extract.extract_source_files(*files.values(), mapping=mapping)
    assert payloads(actual) == payloads(expected)
    assert actual.detalle_df.iloc[0]['NOTD_totalActualizado'] == '1234.56'
    assert actual.detalle_df.iloc[0]['NOTD_vencimiento'] == '29/09/2026'
    assert extract.validate_source_files(files, mapping, cut_off=mapping['fecha_corte']) == expected_report


def test_transformations_are_ordered_explicit_and_preserve_blanks_and_lines(tmp_path):
    records = first_rows()
    records['cabecera'][0]['Estado'] = ' a '
    records['cabecera'][0]['Cuenta'] = '000123'
    records['cabecera'][0]['Destinatario_Email'] = 'SINTETICO@EXAMPLE.INVALID'
    records['detalle'][0]['NOTD_ESTA_id'] = 'pend'
    records['detalle'][0]['NOTD_SITU_id'] = ''
    mapping = load_mapping(FIXTURE)
    mapping['transformaciones'] = {
        'cabecera': {
            'Estado': [{'operacion': 'recortar'}, {'operacion': 'mayusculas'},
                       {'operacion': 'mapear_codigos', 'valores': {'A': 'Activo'}}],
            'Destinatario_Email': [{'operacion': 'minusculas'}],
        },
        'detalle': {
            'NOTD_ESTA_id': [{'operacion': 'mapear_codigos', 'valores': {'pend': '10'}}],
            'NOTD_SITU_id': [{'operacion': 'mapear_codigos', 'valores': {'pend': '10'}}],
        },
    }
    before = copy.deepcopy(mapping)
    files = write_records(tmp_path, records)
    tables = extract.read_source_tables(files, mapping)
    assert tables['cabecera'].rows[0].values['Estado'] == 'Activo'
    assert tables['cabecera'].rows[0].values['Cuenta'] == '000123'
    assert tables['cabecera'].rows[0].values['Destinatario_Email'] == 'sintetico@example.invalid'
    assert tables['detalle'].rows[0].values['NOTD_ESTA_id'] == '10'
    assert tables['detalle'].rows[0].values['NOTD_SITU_id'] == ''
    assert tables['cabecera'].rows[0].line == 2
    report = validate_batch(tables, mapping, load_contract(), mapping['fecha_corte'])
    assert report['objetos'][0]['estados_al_corte']['UNKNOWN'] == 0
    assert 'CUENTA_NO_CANONICA' in report['hallazgos_por_codigo']
    assert mapping == before


def test_unknown_mapped_code_is_never_defaulted_or_exposed(tmp_path):
    records = first_rows()
    records['cabecera'][0]['Estado'] = 'CENTINELA-CODIGO'
    mapping = load_mapping(FIXTURE)
    mapping['transformaciones'] = {'cabecera': {'Estado': [{'operacion': 'mapear_codigos', 'valores': {'A': 'Activo'}}]}}
    with pytest.raises(extract.ValidationError, match='CODIGO_NO_MAPEADO: archivo=cabecera, linea=2, campo=Estado') as error:
        extract.read_source_tables(write_records(tmp_path, records), mapping)
    assert 'CENTINELA' not in str(error.value)


def test_explicit_transform_target_cannot_be_silently_absent(tmp_path):
    records = first_rows()
    records['cabecera'][0].pop('Estado')
    mapping = load_mapping(FIXTURE)
    mapping['transformaciones'] = {'cabecera': {'Estado': [{'operacion': 'recortar'}]}}
    with pytest.raises(extract.ValidationError, match='COLUMNA_MAPEADA_AUSENTE'):
        extract.read_source_tables(write_records(tmp_path, records), mapping)


@pytest.mark.parametrize('mutation', ['short', 'long', 'nul', 'multiline', 'blank_multiline'])
def test_bad_csv_row_is_rejected_without_partial_tables(tmp_path, mutation):
    records = first_rows()
    files = write_records(tmp_path, records, separator=',', suffix='csv')
    path = files['cabecera']
    with path.open() as stream:
        rows = list(csv.reader(stream))
    if mutation == 'short':
        rows[1].pop()
    elif mutation == 'long':
        rows[1].append('CENTINELA')
    elif mutation == 'nul':
        rows[1][0] = '\x00'
    elif mutation == 'multiline':
        rows[1][0] = 'CENTINELA\nOTRA-LINEA'
    else:
        rows.append(['\n'])
    with path.open('w', newline='') as stream:
        csv.writer(stream).writerows(rows)
    mapping = load_mapping(FIXTURE)
    mapping['formato']['separador'] = ','  # tipo es opcional: se infiere del separador explícito.
    with pytest.raises(extract.ValidationError, match='ESTRUCTURA_INVALIDA'):
        extract.read_source_tables(files, mapping)


@pytest.mark.parametrize('limit', ['bytes', 'filas', 'columnas', 'celda'])
def test_profile_reader_enforces_contract_limits(tmp_path, limit):
    records = first_rows()
    records['cabecera'].append(records['cabecera'][0].copy())
    files = write_records(tmp_path, records)
    contract = load_contract()
    contract['limites'][limit] = 1
    with pytest.raises(extract.ValidationError, match='LIMITE_ARCHIVO_EXCEDIDO'):
        extract.read_source_tables(files, load_mapping(FIXTURE), contract=contract)


def test_bom_trimmed_headers_blank_lines_and_crlf_keep_physical_locations(tmp_path):
    records = first_rows()
    files = write_records(tmp_path, records)
    for path in files.values():
        header, row = path.read_text().splitlines()
        path.write_text('\ufeff' + header.replace('\t', ' \t') + ' \r\n\r\n  \r\n' + row + '\r\n', newline='')
    tables = extract.read_source_tables(files, load_mapping(FIXTURE))
    assert tables['cabecera'].rows[0].line == 4
    assert tables['detalle'].rows[0].line == 4
    assert tables['cabecera'].columns == list(records['cabecera'][0])


def test_file_extension_missing_file_and_wrong_batch_shape_fail_safely(tmp_path):
    mapping = load_mapping(FIXTURE)
    for path, code in ((tmp_path / 'missing.tsv', 'ARCHIVO_NO_LEIBLE'),
                       (tmp_path / 'sheet.xlsx', 'FORMATO_NO_SOPORTADO'),
                       (tmp_path / 'dir.tsv', 'ARCHIVO_NO_LEIBLE')):
        if path.name == 'dir.tsv':
            path.mkdir()
        with pytest.raises(extract.ValidationError, match=code):
            extract.read_source_tables(dict.fromkeys(KINDS, path), mapping)
    with pytest.raises(extract.ValidationError, match='ARCHIVOS_REQUERIDOS'):
        extract.read_source_tables({}, mapping)


def test_profile_cli_is_a_real_dry_run_without_credentials(tmp_path):
    mapping = load_mapping(FIXTURE)
    mapping['formato'].update(tipo='csv', separador=',')
    files = converted_fixture(tmp_path, mapping)
    profile = tmp_path / 'perfil.json'
    profile.write_text(json.dumps(mapping))
    before = {path.name: path.read_bytes() for path in tmp_path.iterdir()}
    result = subprocess.run([sys.executable, '-B', '-m', 'ETL.extract', '--cabecera', str(files['cabecera']),
                             '--detalle', str(files['detalle']), '--mapping', str(profile),
                             '--cut-off', '2026-09-30'], env={}, capture_output=True, text=True, check=False)
    assert result.returncode == 1, result.stderr
    assert 'BLOQUEADO' in result.stdout
    assert 'Dry-run: ninguna escritura' in result.stdout
    assert result.stderr == ''
    assert 'Persona Sintética' not in result.stdout
    assert {path.name: path.read_bytes() for path in tmp_path.iterdir()} == before


def test_cli_validated_and_unprocessable_exits_are_safe(tmp_path, capsys):
    records = first_rows()
    records['cabecera'][0]['Deuda_Actualizada'] = records['detalle'][0]['NOTD_totalActualizado']
    files = write_records(tmp_path, records)
    profile = tmp_path / 'perfil.json'
    profile.write_text(json.dumps(load_mapping(FIXTURE)))
    args = ['--cabecera', str(files['cabecera']), '--detalle', str(files['detalle']),
            '--mapping', str(profile), '--cut-off', '2026-09-30']
    assert extract.main(args) == 0
    assert 'VALIDADO' in capsys.readouterr().out
    assert extract.main([*args, '--cut-off', '2026-09-29']) == 2
    assert capsys.readouterr().out == 'CONFIGURACION_INVALIDA\n'
    files['detalle'].unlink()
    assert extract.main(args) == 2
    assert capsys.readouterr().out.startswith('ARCHIVO_NO_LEIBLE: archivo=detalle')
    profile.write_text('{"CENTINELA":')
    assert extract.main(args) == 2
    assert capsys.readouterr().out == 'JSON_NO_LEIBLE\n'


def test_aliases_and_transformations_compose_without_mutating_the_source_table(tmp_path):
    records = first_rows()
    records['cabecera'][0]['estado_exportado'] = records['cabecera'][0].pop('Estado').upper()
    mapping = load_mapping(FIXTURE)
    mapping['columnas'] = {'cabecera': {'Estado': 'estado_exportado'}}
    mapping['transformaciones'] = {'cabecera': {'Estado': [{'operacion': 'minusculas'}]}}
    files = write_records(tmp_path, records)
    tables = extract.read_source_tables(files, mapping)
    assert tables['cabecera'].rows[0].values['estado_exportado'] == 'activo'
    original = copy.deepcopy(tables['cabecera'])
    copied = extract.apply_source_transformations(original, 'cabecera', mapping)
    assert copied == original
    copied.rows[0].values['estado_exportado'] = 'Inactivo'
    assert original.rows[0].values['estado_exportado'] == 'activo'


def test_transformation_expansion_cannot_exceed_the_cell_limit(tmp_path):
    records = first_rows()
    records['cabecera'][0]['Estado'] = 'A'
    mapping = load_mapping(FIXTURE)
    mapping['transformaciones'] = {'cabecera': {'Estado': [
        {'operacion': 'mapear_codigos', 'valores': {'A': 'X' * 101}},
    ]}}
    contract = load_contract()
    contract['limites']['celda'] = 100
    with pytest.raises(extract.ValidationError, match='LIMITE_ARCHIVO_EXCEDIDO'):
        extract.read_source_tables(write_records(tmp_path, records), mapping, contract=contract)
