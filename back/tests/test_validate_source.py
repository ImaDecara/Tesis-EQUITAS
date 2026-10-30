"""Contrato observable: oráculo independiente de ALIGN-023 y entradas adversas."""

import copy
import csv
import json
import subprocess
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from ETL.validate_source import (
    SourceRow, SourceTable, ValidationError, load_contract, load_mapping, main,
    parse_amount, parse_date, render_markdown, validate_batch,
)

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = Path(__file__).parent / 'fixtures/sintetico-v1'
CONTRACT = ROOT / 'contracts/source-contract.v1.json'


def fixture_report():
    return validate_batch(
        {name: FIXTURE / f'{name}.tsv' for name in ('cabecera', 'detalle')},
        load_mapping(FIXTURE), load_contract(CONTRACT), '2026-09-30',
    )


def test_every_fixture_edge_matches_the_independent_oracle_once():
    expected = json.loads((FIXTURE / 'expected.json').read_text())['municipios']['municipio-sintetico-a']
    report = fixture_report()
    assert report['hallazgos'] == expected['hallazgos']
    assert len({tuple(f.values()) for f in report['hallazgos']}) == len(report['hallazgos'])
    for key, value in expected['conteos'].items():
        assert report['conteos'][key] == value, key
    for key, value in expected['importes'].items():
        assert report['importes'][key] == value, key
    assert len(report['objetos']) == len(expected['objetos'])
    for actual, oracle in zip(report['objetos'], expected['objetos'], strict=True):
        for key in ('resultado', 'motivos', 'banderas', 'obligaciones', 'importe_actualizado',
                    'importe_capital', 'estados_al_corte', 'vencimiento_mas_antiguo',
                    'dias_vencida_mas_antigua', 'suma_porcentajes', 'contactos_utilizables',
                    'contactos_inactivos'):
            assert actual[key] == oracle[key], (oracle['caso'], key)


def test_physical_rows_have_a_single_outcome_and_whole_objects_are_quarantined():
    report = fixture_report()
    for counts in report['filas'].values():
        assert counts['leidas'] == counts['aceptadas'] + counts['rechazadas']
        assert sum(counts['rechazadas_por_codigo'].values()) == counts['rechazadas']
        assert sum(counts['aceptadas_por_codigo'].values()) == counts['aceptadas']
    objects = {obj['referencia']: obj for obj in report['objetos']}
    for row in report['decisiones_filas']:
        if row['objeto'] and objects[row['objeto']]['resultado'] == 'CUARENTENA':
            assert row['resultado'] == 'RECHAZADA'
    assert report['importes']['actualizado_en_cuarentena_observado'] == '202712.94'


@pytest.fixture
def simple():
    with (FIXTURE / 'cabecera.tsv').open() as stream:
        header = next(csv.DictReader(stream, delimiter='\t'))
    with (FIXTURE / 'detalle.tsv').open() as stream:
        debt = next(csv.DictReader(stream, delimiter='\t'))
    header.update(Deuda_Actualizada='30,00', Deuda_Capital='30,00')
    debt.update(NOTD_totalActualizado='10,00', NOTD_capital='10,00', NOTD_vencimiento='29/09/2026')
    details = [{**debt, 'DEUD_id': str(700001 + i)} for i in range(3)]
    return {'cabecera': [header], 'detalle': details}


def tables(records):
    return {kind: SourceTable(list(rows[0]) if rows else list(load_contract()['archivos'][kind]['columnas']),
                              [SourceRow(i + 2, row) for i, row in enumerate(rows)])
            for kind, rows in records.items()}


def check(records, mapping=None, contract=None):
    return validate_batch(tables(records), mapping or load_mapping(FIXTURE), contract or load_contract(), date(2026, 9, 30))


def codes(report):
    return [f['codigo'] for f in report['hallazgos']]


@pytest.mark.parametrize(('value', 'expected', 'code'), [
    ('0,00', Decimal(0), None), ('1.234,56', Decimal('1234.56'), None),
    ('1234,5', Decimal('1234.5'), None), ('9999999999999999,99', Decimal('9999999999999999.99'), None),
    ('', None, 'IMPORTE_VACIO'), ('NaN', None, 'IMPORTE_NO_NUMERICO'),
    ('Infinity', None, 'IMPORTE_NO_NUMERICO'), ('$ 1.234,56', None, 'IMPORTE_NO_NUMERICO'),
    ('12.34', None, 'IMPORTE_NO_NUMERICO'), ('1,234.56', None, 'IMPORTE_NO_NUMERICO'),
    ('1e2', None, 'IMPORTE_NO_NUMERICO'), ('1,234', None, 'IMPORTE_NO_NUMERICO'),
    ('-1,00', None, 'IMPORTE_NEGATIVO'), ('10000000000000000,00', None, 'IMPORTE_FUERA_DE_RANGO'),
])
def test_amount_never_guesses_or_substitutes_zero(value, expected, code):
    parsed = parse_amount(value, ',', '.')
    assert parsed.value == expected
    assert parsed.code == code
    assert parsed.presence == ('OBSERVADO' if code is None else
                               'NO_INFORMADO_EN_ORIGEN' if not value else 'INVALIDO')


@pytest.mark.parametrize(('value', 'code', 'presence'), [
    ('', 'FECHA_VACIA', 'NO_INFORMADO_EN_ORIGEN'),
    ('31/02/2024', 'FECHA_IMPOSIBLE', 'INVALIDO'),
    ('30/09/0000', 'FECHA_IMPOSIBLE', 'INVALIDO'),
    ('2026-09-30', 'FECHA_FORMATO_INVALIDO', 'INVALIDO'),
    ('9/3/2026', 'FECHA_FORMATO_INVALIDO', 'INVALIDO'),
    *[(value, 'FECHA_CENTINELA', 'NO_INFORMADO_EN_ORIGEN') for value in
      ('0000-00-00', '00/00/0000', '01/01/1900', '01/01/2999', '31/12/9999')],
])
def test_due_dates_missing_impossible_and_sentinel_quarantine(simple, value, code, presence):
    simple['detalle'][0]['NOTD_vencimiento'] = value
    report = check(simple)
    assert codes(report) == [code]
    assert report['objetos'][0]['resultado'] == 'CUARENTENA'
    assert report['objetos'][0]['vencimiento_mas_antiguo']['filas_no_observadas'] == {presence: 1}


def test_iso_and_dot_decimal_are_explicit_batch_formats(simple):
    mapping = load_mapping(FIXTURE)
    mapping['formato'].update(fecha='aaaa-mm-dd', decimal='.', miles=',')
    for rows in simple.values():
        for row in rows:
            for name in row:
                if name in ('NOTD_vencimiento', 'Fecha_Actualizacion'):
                    row[name] = '2026-09-29'
                if name in ('Deuda_Actualizada', 'Deuda_Capital', 'NOTD_totalActualizado',
                            'NOTD_capital', 'NOTD_intereses', 'NOTD_honorarios'):
                    row[name] = row[name].replace('.', '').replace(',', '.')
    assert check(simple, mapping)['resultado_lote'] == 'VALIDADO'
    assert parse_date('2026-09-30', 'aaaa-mm-dd', load_contract()).value == date(2026, 9, 30)
    assert parse_amount('1,234.56', '.', ',').value == Decimal('1234.56')


@pytest.mark.parametrize(('kind', 'column', 'value', 'code'), [
    ('cabecera', 'Deuda_Actualizada', 'abc', 'IMPORTE_NO_NUMERICO'),
    ('cabecera', 'Cuenta', '000123', 'CUENTA_NO_CANONICA'),
    ('cabecera', 'Cuenta', '9223372036854775808', 'CUENTA_NO_CANONICA'),
    ('cabecera', 'Destinatario_Id', '', 'IDENTIFICADOR_INVALIDO'),
    ('cabecera', 'Bien_Tipo_Id', '99', 'TIPO_BIEN_FUERA_DE_CATALOGO'),
    ('cabecera', 'Estado', 'activo_desconocido', 'ESTADO_OBJETO_DESCONOCIDO'),
    ('cabecera', 'Destinatario_Porcentaje', '101', 'PORCENTAJE_INVALIDO'),
    ('cabecera', 'Destinatario_Porcentaje', 'abc', 'PORCENTAJE_INVALIDO'),
    ('cabecera', 'Periodos_Deuda', '1.5', 'ENTERO_INVALIDO'),
    ('cabecera', 'Fecha_Actualizacion', '31/02/2024', 'FECHA_IMPOSIBLE'),
    ('detalle', 'NOTD_capital', 'abc', 'IMPORTE_NO_NUMERICO'),
    ('detalle', 'NOTD_intereses', '-1', 'IMPORTE_NEGATIVO'),
    ('detalle', 'Tipo_Ingreso_Id', '999', 'TIPO_INGRESO_FUERA_DE_CATALOGO'),
    ('detalle', 'NOTD_ESTA_id', '999', 'ESTADO_ORIGEN_DESCONOCIDO'),
    ('detalle', 'DEUD_id', 'ABC', 'IDENTIFICADOR_INVALIDO'),
    ('detalle', 'Cuenta', '123', 'CUENTA_DETALLE_DIFERENTE'),
    ('detalle', 'Bien_Tipo_Id', '6', 'TIPO_BIEN_DETALLE_DIFERENTE'),
])
def test_one_invalid_header_or_debt_excludes_every_row_and_full_amount(simple, kind, column, value, code):
    simple[kind][0][column] = value
    report = check(simple)
    assert code in codes(report)
    assert all(row['resultado'] == 'RECHAZADA' for row in report['decisiones_filas'])
    assert report['importes']['actualizado_aceptado'] == '0.00'
    assert report['importes']['actualizado_en_cuarentena_observado'] == '30.00'


def test_partial_amount_is_a_subtotal_and_reconciliation_is_not_fabricated(simple):
    simple['detalle'][0].update(NOTD_capital='', NOTD_totalActualizado='')
    report = check(simple)
    obj = report['objetos'][0]
    assert obj['importe_actualizado'] == {'valor': '20.00', 'presencia': 'OBSERVADO',
        'filas_no_observadas': {'NO_INFORMADO_EN_ORIGEN': 1}, 'completo': False}
    assert obj['importe_capital'] == obj['importe_actualizado']
    assert obj['conciliacion']['evaluable'] is False
    assert codes(report) == ['IMPORTE_VACIO', 'IMPORTE_VACIO']  # dos campos, una fila rechazada
    assert report['filas']['detalle']['rechazadas_por_codigo'] == {'IMPORTE_VACIO': 1, 'OBJETO_EN_CUARENTENA': 2}
    assert 'CUARENTENA_IMPORTE_NO_EVALUABLE' in report['motivos_bloqueo']


def test_all_missing_is_null_and_empty_read_universe_is_observed_zero(simple):
    for row in simple['detalle']:
        row['NOTD_totalActualizado'] = ''
    amount = check(simple)['objetos'][0]['importe_actualizado']
    assert amount['valor'] is None and amount['presencia'] == 'NO_INFORMADO_EN_ORIGEN'
    simple['detalle'] = []
    simple['cabecera'][0]['Deuda_Actualizada'] = '0,00'
    obj = check(simple)['objetos'][0]
    assert obj['importe_actualizado']['valor'] == '0.00'
    assert obj['importe_actualizado']['presencia'] == 'OBSERVADO'
    assert obj['vencimiento_mas_antiguo']['presencia'] == 'NO_APLICA'
    assert obj['resultado'] == 'ACEPTADO'


def test_missing_inputs_count_once_per_debt_in_age_breakdown(simple):
    simple['detalle'][0].update(NOTD_vencimiento='31/02/2024', NOTD_ESTA_id='999')
    obj = check(simple)['objetos'][0]
    assert obj['dias_vencida_mas_antigua']['filas_no_observadas'] == {'INVALIDO': 1}
    assert obj['estados_al_corte']['UNKNOWN'] == 1
    assert sum(obj['estados_al_corte'].values()) == 3
    simple['detalle'][0]['NOTD_ESTA_id'] = ''
    obj = check(simple)['objetos'][0]
    assert obj['dias_vencida_mas_antigua']['filas_no_observadas'] == {'NO_INFORMADO_EN_ORIGEN': 1}


def test_alternate_state_is_used_only_with_an_explicit_catalog_and_conflicts_quarantine(simple):
    mapping = load_mapping(FIXTURE)
    mapping['catalogos']['NOTD_SITU_id'] = {'P': 'PAGADA', 'U': 'UNKNOWN'}
    simple['detalle'][0].update(NOTD_ESTA_id='', NOTD_SITU_id='P')
    assert check(simple, mapping)['objetos'][0]['estados_al_corte']['PAGADA'] == 1
    simple['detalle'][0]['NOTD_ESTA_id'] = '10'
    assert 'ESTADOS_ORIGEN_CONFLICTIVOS' in codes(check(simple, mapping))
    simple['detalle'][0].update(NOTD_ESTA_id='', NOTD_SITU_id='U')
    report = check(simple, mapping)
    assert codes(report) == ['ESTADO_ORIGEN_NO_INFORMADO']
    assert report['hallazgos'][0]['campo'] == 'NOTD_SITU_id'


def test_optional_absence_is_disclosed_and_does_not_turn_into_active_or_zero(simple):
    for kind, rows in simple.items():
        specs = load_contract()['archivos'][kind]['columnas']
        for row in rows:
            for name in list(row):
                if not specs[name]['requerida']:
                    del row[name]
    report = check(simple)
    assert report['resultado_lote'] == 'VALIDADO'
    obj = report['objetos'][0]
    assert 'ESTADO_OBJETO_NO_INFORMADO' in obj['banderas']
    assert obj['suma_porcentajes']['valor'] is None
    assert obj['estados_al_corte']['UNKNOWN'] == 3
    assert report['columnas']['detalle']['opcionales_presentes'] == []
    assert 'NOTD_ESTA_id' in report['columnas']['detalle']['opcionales_ausentes']


def test_identical_duplicates_exclude_only_repeat_and_conflicts_quarantine(simple):
    simple['cabecera'].append(simple['cabecera'][0].copy())
    simple['detalle'].append(simple['detalle'][0].copy())
    report = check(simple)
    assert report['conteos']['duplicados_identicos'] == 2
    assert report['conteos']['objetos_aceptados'] == 1
    assert report['importes']['actualizado_aceptado'] == '30.00'
    assert sum(r['resultado'] == 'RECHAZADA' for r in report['decisiones_filas']) == 2
    simple['cabecera'][-1]['Destinatario'] = 'CENTINELA-CONFLICTO'
    assert check(simple)['conteos']['objetos_en_cuarentena'] == 1


def test_multi_person_headers_must_agree_on_object_controls(simple):
    simple['cabecera'].append({**simple['cabecera'][0], 'Destinatario_Id': '42', 'Deuda_Actualizada': '31,00'})
    report = check(simple)
    assert codes(report) == ['CABECERAS_INCONSISTENTES']
    assert report['importes']['actualizado_en_cuarentena_observado'] == '30.00'


def test_join_ambiguity_quarantines_both_objects_and_blocks_unknown_assignment(simple):
    simple['cabecera'].append({**simple['cabecera'][0], 'Cuenta': '42'})
    report = check(simple)
    assert report['conteos']['objetos_en_cuarentena'] == 2
    assert not report['publicacion_permitida']
    assert report['importes']['detalle_sin_objeto']['valor'] == '30.00'
    assert all(r['resultado'] == 'RECHAZADA' for r in report['decisiones_filas'])


def test_empty_link_and_orphan_never_publish(simple):
    simple['cabecera'][0]['ClaveAgrupacion'] = ''
    report = check(simple)
    assert 'CAMPO_OBLIGATORIO_VACIO' in codes(report)
    assert report['conteos']['detalle_sin_cabecera'] == 3
    assert not report['publicacion_permitida']


def test_reconciliation_tolerance_is_inclusive_and_decimal_exact(simple):
    simple['cabecera'][0]['Deuda_Actualizada'] = '30,05'
    assert check(simple)['objetos'][0]['resultado'] == 'ACEPTADO'
    simple['cabecera'][0]['Deuda_Actualizada'] = '30,06'
    assert codes(check(simple)) == ['CONCILIACION_DIFERENTE']


def repeated_objects(simple, count):
    result = {'cabecera': [], 'detalle': []}
    for i in range(count):
        identity = {'Cuenta': str(5000 + i), 'ClaveAgrupacion': f'G{i}'}
        result['cabecera'].append({**simple['cabecera'][0], **identity})
        result['detalle'].extend({**row, **identity} for row in simple['detalle'])
    return result


def test_quarantine_threshold_is_strictly_greater_than_five_percent(simple):
    records = repeated_objects(simple, 20)
    records['cabecera'][0]['Estado'] = 'DESCONOCIDO'
    report = check(records)
    assert report['cuarentena']['objetos_pct'] == '5.00'
    assert report['publicacion_permitida']
    assert report['conteos']['obligaciones_unicas'] == 60  # misma DEUD_id en objetos distintos
    assert report['importes']['actualizado_aceptado'] == '570.00'
    records['cabecera'].pop()
    del records['detalle'][-3:]
    report = check(records)
    assert set(report['motivos_bloqueo']) == {'CUARENTENA_EXCEDE_OBJETOS', 'CUARENTENA_EXCEDE_IMPORTE'}


def test_amount_threshold_can_block_even_when_object_count_is_below_limit(simple):
    records = repeated_objects(simple, 21)
    records['cabecera'][0].update(Estado='DESCONOCIDO', Deuda_Actualizada='300,00')
    for row in records['detalle'][:3]:
        row['NOTD_totalActualizado'] = '100,00'
    report = check(records)
    assert report['motivos_bloqueo'] == ['CUARENTENA_EXCEDE_IMPORTE']


def test_contact_validity_is_scoped_to_municipality_and_never_deduced_from_value(simple):
    header = simple['cabecera'][0]
    header.update(Destinatario_Email='', Destinatario_Telefono='0000-555-9999', Destinatario_Celular='')
    mapping = load_mapping(FIXTURE)
    mapping['vigencia_contactos'] = [{'municipio': mapping['municipio'], 'Destinatario_Id': header['Destinatario_Id'],
                                    'columna': 'Destinatario_Telefono', 'vigencia': 'INACTIVO'}]
    obj = check(simple, mapping)['objetos'][0]
    assert obj['contactos_inactivos'] == 1 and obj['contactos_utilizables'] == 0
    mapping['municipio'] = 'municipio-sintetico-b'
    obj = check(simple, mapping)['objetos'][0]
    assert obj['contactos_inactivos'] == 0 and obj['contactos_utilizables'] == 1


def test_no_source_values_or_unknown_column_names_leak_in_reports(simple):
    simple['cabecera'][0].update(Destinatario='CENTINELA-NOMBRE', Destinatario_Email='CENTINELA-EMAIL',
                                Destinatario_CUIT='CENTINELA-DOCUMENTO', CENTINELA_COLUMNA='CENTINELA-VALOR')
    report = check(simple)
    assert 'CENTINELA' not in json.dumps(report) + render_markdown(report)
    assert report['columnas']['cabecera']['extras_ignoradas'] == 1


def test_column_mapping_is_explicit_and_inputs_are_not_modified(simple):
    for row in simple['detalle']:
        row['importe_externo'] = row.pop('NOTD_totalActualizado')
    mapping = load_mapping(FIXTURE)
    mapping['columnas'] = {'detalle': {'NOTD_totalActualizado': 'importe_externo'}}
    before = copy.deepcopy((simple, mapping))
    assert check(simple, mapping)['resultado_lote'] == 'VALIDADO'
    assert (simple, mapping) == before


@pytest.mark.parametrize('delimiter', [',', ';', None])
def test_external_reader_adapters_share_rules_without_enabling_other_path_readers(simple, delimiter):
    mapping = load_mapping(FIXTURE)
    mapping['formato']['separador'] = delimiter
    assert check(simple, mapping)['resultado_lote'] == 'VALIDADO'
    with pytest.raises(ValidationError, match='LECTOR_TSV_REQUIERE_TABULADOR'):
        validate_batch({name: FIXTURE / f'{name}.tsv' for name in ('cabecera', 'detalle')},
                       mapping, load_contract(), '2026-09-30')


@pytest.mark.parametrize('mutation', [
    lambda m: m.update(version='v0'), lambda m: m.update(fecha_corte='2026-10-01'),
    lambda m: m.pop('municipio'), lambda m: m.update(moneda='CENTINELA-MONEDA'),
    lambda m: m['formato'].update(fecha='auto'), lambda m: m['formato'].update(decimal='.', miles='.'),
    lambda m: m['formato'].update(codificacion='auto'), lambda m: m['catalogos'].update(NOTD_ESTA_id={'1': 'VENCIDA'}),
    lambda m: m.update(columnas={'detalle': {'NOTD_capital': 'NOTD_totalActualizado'}}),
    lambda m: m.update(columnas={'detalle': {'campo_inexistente': 'importe'}}),
    lambda m: m['vigencia_contactos'].append(m['vigencia_contactos'][0].copy()),
    lambda m: m.update(vigencia_por_defecto='SUPUESTO'),
])
def test_invalid_batch_configuration_is_rejected_with_a_safe_code(simple, mutation):
    mapping = load_mapping(FIXTURE)
    mutation(mapping)
    with pytest.raises(ValidationError, match='^CONFIGURACION_INVALIDA$'):
        check(simple, mapping)


@pytest.mark.parametrize('cut', ['2026-02-30', '30/09/2026', '20260930', None])
def test_cut_off_is_required_iso_and_never_the_machine_clock(simple, cut):
    with pytest.raises(ValidationError, match='^CORTE_INVALIDO$'):
        validate_batch(tables(simple), load_mapping(FIXTURE), load_contract(), cut)


def test_structural_failures_block_entire_batch_and_do_not_claim_zero(simple):
    del simple['detalle'][0]['NOTD_capital']
    for row in simple['detalle'][1:]:
        del row['NOTD_capital']
    report = check(simple)
    assert 'COLUMNA_OBLIGATORIA_AUSENTE' in codes(report)
    assert report['importes']['actualizado_aceptado'] is None
    assert report['universo_completo'] is False
    assert all(row['resultado'] == 'RECHAZADA' for row in report['decisiones_filas'])


@pytest.mark.parametrize('payload', [b'A\tA\n1\t2\n', b'A\tB\n1\n', b'A\n\xff\n',
                                    b'A\n"two\nlines"\n', b'A\n\x00\n', b''])
def test_malformed_file_is_blocked_without_raw_content(tmp_path, payload):
    path = tmp_path / 'input.tsv'
    path.write_bytes(payload)
    report = validate_batch({'cabecera': path, 'detalle': path}, load_mapping(FIXTURE), load_contract(), '2026-09-30')
    assert not report['publicacion_permitida']
    assert report['universo_completo'] is False
    assert 'two' not in json.dumps(report)


def test_file_size_row_column_and_cell_limits_are_enforced(simple, tmp_path):
    for name in ('columnas', 'filas', 'celda'):
        contract = load_contract()
        contract['limites'][name] = 1
        report = check(simple, contract=contract)
        assert 'LIMITE_ARCHIVO_EXCEDIDO' in codes(report)
    path = tmp_path / 'input.tsv'
    path.write_text('A\n123\n')
    contract = load_contract()
    contract['limites']['bytes'] = 1
    report = validate_batch(dict.fromkeys(('cabecera', 'detalle'), path), load_mapping(FIXTURE), contract, '2026-09-30')
    assert 'LIMITE_ARCHIVO_EXCEDIDO' in codes(report)


def test_empty_and_absent_inputs_and_invalid_adapter_table(simple, tmp_path):
    assert check({'cabecera': [], 'detalle': []})['motivos_bloqueo'] == ['LOTE_VACIO']
    with pytest.raises(ValidationError, match='ARCHIVOS_REQUERIDOS'):
        validate_batch({}, load_mapping(FIXTURE), load_contract(), '2026-09-30')
    files = tables(simple)
    files['detalle'].rows[0].line = 1
    with pytest.raises(ValidationError, match='TABLA_INVALIDA'):
        validate_batch(files, load_mapping(FIXTURE), load_contract(), '2026-09-30')
    files['detalle'] = tmp_path / 'ausente'
    assert 'ARCHIVO_NO_LEIBLE' in codes(validate_batch(files, load_mapping(FIXTURE), load_contract(), '2026-09-30'))


def test_cli_report_is_deterministic_and_contains_no_personal_values(tmp_path, capsys):
    args = ['--folder', str(FIXTURE), '--contract', str(CONTRACT), '--cut-off', '2026-09-30', '--output', str(tmp_path)]
    assert main(args) == 1
    first = (tmp_path / 'report.json').read_bytes()
    assert main(args) == 1
    assert (tmp_path / 'report.json').read_bytes() == first
    report = json.loads(first)
    assert (tmp_path / 'report.md').read_text() == render_markdown(report)
    output = first.decode() + (tmp_path / 'report.md').read_text() + capsys.readouterr().out
    for value in ('Persona Sintética', 'Entidad Sintética', '@example.invalid', '0000-555-', '99-',
                  '3-4100', '90001', 'Calle Sintética'):
        assert value not in output
    assert main([*args, '--cut-off', 'CENTINELA-CORTE']) == 2
    assert 'CENTINELA-CORTE' not in capsys.readouterr().out


def test_configuration_errors_and_cli_success_are_safe(simple, tmp_path, capsys):
    bad_json = tmp_path / 'bad.json'
    bad_json.write_text('[]')
    with pytest.raises(ValidationError, match='JSON_NO_LEIBLE'):
        load_contract(bad_json)
    (tmp_path / 'manifest.json').write_text('{"version": "no-homologada", "clase": 42}')
    with pytest.raises(ValidationError, match='MAPEO_REQUERIDO'):
        load_mapping(tmp_path)
    (tmp_path / 'manifest.json').write_text('{"version": "sintetico-v1", "clase": "S sintético", "catalogos": []}')
    with pytest.raises(ValidationError, match='CONFIGURACION_INVALIDA'):
        load_mapping(tmp_path)
    mapping_path = tmp_path / 'mapping.json'
    mapping_path.write_text(json.dumps(load_mapping(FIXTURE)))
    for kind, rows in simple.items():
        with (tmp_path / f'{kind}.tsv').open('w') as stream:
            writer = csv.DictWriter(stream, list(rows[0]), delimiter='\t')
            writer.writeheader()
            writer.writerows(rows)
    args = ['--folder', str(tmp_path), '--contract', str(CONTRACT), '--cut-off', '2026-09-30',
            '--mapping', str(mapping_path), '--output', str(tmp_path / 'out')]
    assert main(args) == 0
    assert json.loads((tmp_path / 'out/report.json').read_text())['publicacion_permitida']
    assert main([*args, '--output', str(bad_json)]) == 2
    assert 'Traceback' not in capsys.readouterr().out


def test_row_limit_is_enforced_during_reading_before_validation(tmp_path):
    path = tmp_path / 'input.tsv'
    path.write_text('A\n1\n2\n3\n')
    contract = load_contract()
    contract['limites']['filas'] = 1
    report = validate_batch(dict.fromkeys(('cabecera', 'detalle'), path), load_mapping(FIXTURE), contract, '2026-09-30')
    assert report['filas']['cabecera']['leidas'] == 1
    assert not report['universo_completo']
    assert 'LIMITE_ARCHIVO_EXCEDIDO' in codes(report)


def test_cli_in_empty_environment_never_imports_config_or_network(tmp_path):
    script = '''
import importlib.abc, runpy, sys
from pathlib import Path
sys.path.insert(0, str(Path.cwd()))
class Forbid(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname in {'ETL.config', 'ETL.transform', 'supabase', 'dotenv', 'pandas', 'socket'}:
            raise RuntimeError('Import prohibido: ' + fullname)
sys.meta_path.insert(0, Forbid())
sys.argv = ['validate_source', *sys.argv[1:]]
runpy.run_module('ETL.validate_source', run_name='__main__')
'''
    result = subprocess.run([sys.executable, '-I', '-c', script, '--folder', str(FIXTURE.resolve()),
        '--contract', str(CONTRACT), '--cut-off', '2026-09-30', '--output', str(tmp_path)],
        cwd=ROOT / 'back', env={}, capture_output=True, text=True)
    assert result.returncode == 1, result.stderr
    assert result.stdout.startswith('BLOQUEADO: objetos=40; cuarentena=9')
    assert result.stderr == ''
    assert (tmp_path / 'report.json').is_file()
