from dataclasses import replace
from pathlib import Path

import pandas as pd
import pytest

from ETL import export_preview
from ETL.extract import ExtractedSourceData


def test_preview_builders_deduplicate_and_calculate_profiles(
    cabecera_df: pd.DataFrame,
    detalle_df: pd.DataFrame,
) -> None:
    cabecera_df = cabecera_df.assign(Bien_Tipo=['Agua', 'Inmueble'])
    detalle_df = detalle_df.assign(NOTD_intereses='10', NOTD_honorarios='5')

    person_df = export_preview.build_person_preview(cabecera_df)
    debtor_df = export_preview.build_debtor_preview(cabecera_df)
    relation_df = export_preview.build_debtor_person_preview(cabecera_df)
    debt_df, duplicated_df = export_preview.build_debt_preview(cabecera_df, detalle_df)
    province_df = export_preview.build_province_preview(cabecera_df)
    city_df = export_preview.build_city_preview(cabecera_df)
    address_df = export_preview.build_address_preview(cabecera_df)
    contact_df = export_preview.build_debtor_contact_preview(cabecera_df)
    profile_df = export_preview.build_debtor_profile_preview(debt_df, relation_df, contact_df)
    profile_detail_df = export_preview.build_debtor_profile_detail_preview(
        profile_df,
        relation_df,
        contact_df,
    )

    assert person_df['external_id'].tolist() == [501, 502]
    assert debtor_df[['type', 'external_id']].values.tolist() == [[6, 1001], [1, 2001]]
    assert len(relation_df) == 2
    assert len(debt_df) == 2
    assert len(duplicated_df) == 1
    assert province_df['name'].tolist() == ['Santa Fe']
    assert city_df['name'].tolist() == ['Rosario']
    assert address_df['person_external_id'].tolist() == [501, 502]
    assert len(contact_df) == 2
    assert len(profile_df) == 2
    assert len(profile_detail_df) == 2


def test_export_preview_generates_all_sheets_with_temporary_source_data(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    cabecera_df: pd.DataFrame,
    detalle_df: pd.DataFrame,
) -> None:
    source_data = ExtractedSourceData(
        cabecera_df=cabecera_df,
        detalle_df=detalle_df,
        cabecera_path=tmp_path / 'cabecera.tsv',
        detalle_path=tmp_path / 'detalle.tsv',
    )
    output_path = tmp_path / 'preview.xlsx'
    monkeypatch.setattr(export_preview, 'extract_from_input_folder_limited', lambda **_kwargs: source_data)
    monkeypatch.setattr(
        export_preview,
        'settings',
        replace(export_preview.settings, processed_dir=tmp_path / 'processed'),
    )

    generated_path = export_preview.export_preview('agua', output_path=output_path, limit_objects=2)

    workbook = pd.ExcelFile(generated_path)
    summary_df = pd.read_excel(generated_path, sheet_name='01_summary')

    assert generated_path == output_path
    assert generated_path.exists()
    assert workbook.sheet_names == [
        '01_summary', '02_person', '03_debtor', '04_debtor_person',
        '05_debt_unique', '06_debt_duplicates_skipped', '07_province',
        '08_city', '09_address', '10_debtor_contact', '11_debtor_profile',
        '12_debtor_profile_detail',
    ]
    assert summary_df.loc[summary_df['metric'] == 'debt_unique_preview_rows', 'value'].item() == 2


def test_profile_preview_returns_empty_dataframes_without_debts_or_relations() -> None:
    empty = pd.DataFrame()

    profiles = export_preview.build_debtor_profile_preview(empty, empty, empty)
    profile_details = export_preview.build_debtor_profile_detail_preview(empty, empty, empty)

    assert profiles.empty
    assert profile_details.empty
