import json
from pathlib import Path

from ETL import inspect_tsv
from ETL.validate_source import load_contract, load_mapping, validate_batch

FIXTURE = Path(__file__).parent / 'fixtures/sintetico-v1'


def test_inspector_has_no_second_validator_or_personal_output(capsys):
    files = {name: FIXTURE / f'{name}.tsv' for name in ('cabecera', 'detalle')}
    expected = validate_batch(files, load_mapping(FIXTURE), load_contract(), '2026-09-30')
    actual = inspect_tsv.inspect_files(files['cabecera'], files['detalle'])
    assert actual == expected
    output = capsys.readouterr().out
    assert 'CUENTA_NO_CANONICA' in output
    assert '202712.94' in output
    assert 'Persona Sintética' not in output
    assert '@example.invalid' not in output


def test_inspector_rejects_missing_columns_and_never_prints_file_values(tmp_path, capsys):
    header, detail = tmp_path / 'cabecera.tsv', tmp_path / 'detalle.tsv'
    header.write_text('Cuenta\nCENTINELA-PRIVADO\n')
    detail.write_text('DEUD_id\n10\n')
    report = inspect_tsv.inspect_files(header, detail, mapping=load_mapping(FIXTURE))
    assert report['resultado_lote'] == 'BLOQUEADO'
    assert report['filas']['cabecera']['rechazadas'] == 1
    assert 'COLUMNA_OBLIGATORIA_AUSENTE' in capsys.readouterr().out
    assert 'CENTINELA-PRIVADO' not in json.dumps(report)


def test_inspector_cli_writes_same_reports_and_handles_bad_configuration(tmp_path, capsys):
    args = ['--cabecera', str(FIXTURE / 'cabecera.tsv'), '--detalle', str(FIXTURE / 'detalle.tsv'),
            '--cut-off', '2026-09-30', '--output', str(tmp_path)]
    assert inspect_tsv.main(args) == 1
    assert json.loads((tmp_path / 'report.json').read_text())['conteos']['objetos'] == 40
    assert inspect_tsv.main([*args, '--mapping', str(tmp_path / 'missing.json')]) == 2
    assert 'VALIDACION_NO_EJECUTABLE' in capsys.readouterr().out
