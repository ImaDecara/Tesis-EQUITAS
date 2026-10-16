from pathlib import Path

import pandas as pd

from ETL import inspect_tsv


def write_tsv(path: Path, dataframe: pd.DataFrame) -> None:
    dataframe.to_csv(path, sep='\t', index=False)


def test_inspect_helpers_parse_values_validate_columns_and_clean_keys() -> None:
    dataframe = pd.DataFrame({'ClaveAgrupacion': [' A ', '', 'A', 'B']})

    missing = inspect_tsv.validate_field_groups(
        pd.DataFrame({'Cuenta': ['1']}),
        {'debt.external_id': ['DEUD_id'], 'debt.account': ['Cuenta']},
        'detalle.tsv',
    )

    assert inspect_tsv.parse_decimal('$ 1.234,50') == 1234.5
    assert inspect_tsv.parse_decimal('invalid') == 0.0
    assert missing == ['debt.external_id']
    assert inspect_tsv.get_clean_key_set(dataframe, 'ClaveAgrupacion') == {'A', 'B'}


def test_inspect_files_reports_valid_structure_and_detects_quality_warnings(
    tmp_path: Path,
    capsys,
) -> None:
    cabecera = pd.DataFrame(
        [{
            'ClaveAgrupacion': 'A', 'Destinatario_Id': '1', 'Destinatario_CUIT': '20-1',
            'Destinatario': 'Ana', 'Cuenta': '100', 'Identificador': 'AG-100',
            'Bien_Tipo_Id': '6', 'Bien_Tipo': 'Agua', 'Deuda_Actualizada': '120.00',
        }]
    )
    detalle = pd.DataFrame(
        [{
            'ClaveAgrupacion': 'A', 'DEUD_id': '10', 'NOTD_capital': '100',
            'NOTD_totalActualizado': '120', 'NOTD_vencimiento': '01/01/2020',
            'Cuenta': '101',
        }]
    )
    cabecera_path = tmp_path / 'cabecera.tsv'
    detalle_path = tmp_path / 'detalle.tsv'
    write_tsv(cabecera_path, cabecera)
    write_tsv(detalle_path, detalle)

    inspect_tsv.inspect_files(cabecera_path, detalle_path)

    output = capsys.readouterr().out
    assert 'Cabecera y detalle encajan por ClaveAgrupacion' in output
    assert 'Hay diferencias entre Cuenta de cabecera y Cuenta de detalle' in output
    assert 'La suma del detalle coincide' in output


def test_inspect_files_stops_after_missing_required_fields(tmp_path: Path, capsys) -> None:
    cabecera_path = tmp_path / 'cabecera.tsv'
    detalle_path = tmp_path / 'detalle.tsv'
    write_tsv(cabecera_path, pd.DataFrame({'Cuenta': ['100']}))
    write_tsv(detalle_path, pd.DataFrame({'DEUD_id': ['10']}))

    inspect_tsv.inspect_files(cabecera_path, detalle_path)

    output = capsys.readouterr().out
    assert 'Hay campos obligatorios faltantes' in output
    assert 'VALIDACION DE CLAVE DE RELACION' not in output
