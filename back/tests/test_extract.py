import pandas as pd
import pytest

from ETL.extract import extract_source_files, limit_by_debtor_objects, read_tsv


def test_read_tsv_and_extract_source_files_preserve_text_values(tmp_path) -> None:
    cabecera_path = tmp_path / 'cabecera.tsv'
    detalle_path = tmp_path / 'detalle.tsv'
    cabecera_path.write_text('Cuenta\tNombre\n001\tAna\n', encoding='utf-8')
    detalle_path.write_text('DEUD_id\tMonto\n10\t100,50\n', encoding='utf-8')

    source = extract_source_files(cabecera_path, detalle_path)
    read_rows = read_tsv(cabecera_path)

    assert source.cabecera_df.loc[0, 'Cuenta'] == '001'
    assert source.detalle_df.loc[0, 'Monto'] == '100,50'
    assert read_rows.equals(source.cabecera_df)


def test_limit_by_debtor_objects_keeps_header_and_detail_for_priority_type(
    cabecera_df: pd.DataFrame,
    detalle_df: pd.DataFrame,
) -> None:
    limited_headers, limited_details = limit_by_debtor_objects(
        cabecera_df,
        detalle_df,
        limit_objects=1,
        priority_tipo_ingreso_ids=[801],
    )

    assert limited_headers['Cuenta'].tolist() == ['1001']
    assert limited_details['Cuenta'].tolist() == ['1001', '1001']


def test_limit_by_debtor_objects_rejects_non_positive_limit(
    cabecera_df: pd.DataFrame,
    detalle_df: pd.DataFrame,
) -> None:
    with pytest.raises(ValueError, match='mayor a 0'):
        limit_by_debtor_objects(cabecera_df, detalle_df, limit_objects=0)
