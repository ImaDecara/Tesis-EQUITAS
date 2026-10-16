import pandas as pd

from ETL.transform import (
    DEBT_STATUS_ACTIVE_ID,
    DEBT_STATUS_OVERDUE_ID,
    build_debt_payload,
    build_debtor_profile_detail_payload,
    build_person_payload,
    build_transform_summary,
    calculate_socioeconomic_risk_level,
    parse_bool,
    parse_date,
    parse_decimal,
)


def test_normalizers_handle_common_and_invalid_values() -> None:
    parsed_amount = parse_decimal('1.234,56')
    invalid_amount = parse_decimal('sin-monto')
    parsed_date = parse_date('31/12/2025')
    invalid_date = parse_date('fecha-invalida')
    active = parse_bool('Activo')
    inactive = parse_bool('inactivo')

    assert parsed_amount == 1234.56
    assert invalid_amount == 0.0
    assert parsed_date == '2025-12-31'
    assert invalid_date is None
    assert active is True
    assert inactive is False


def test_build_payloads_normalize_person_and_debt_values() -> None:
    person = build_person_payload(
        {'Destinatario_Id': '501', 'Destinatario_CUIT': '20-12345678-9', 'Destinatario': 'Ana Perez'}
    )
    debt = build_debt_payload(
        {
            'DEUD_id': '9001', 'Tipo_Ingreso_Id': '801', 'NOTD_capital': '1.000,50',
            'NOTD_totalActualizado': '1.200,75', 'NOTD_vencimiento': '01/01/2000',
        },
        debtor_id=77,
        issue_date='2025-01-10',
        last_collection_date='2025-01-10',
    )

    assert person['external_id'] == 501
    assert person['document_number'] == '20-12345678-9'
    assert debt == {
        'external_id': 9001, 'debtor': 77, 'type': 'water_connection',
        'description': 'Deuda importada desde TSV - DEUD_id 9001', 'original_amount': 1000.5,
        'current_amount': 1200.75, 'currency': 1, 'issue_date': '2025-01-10',
        'due_date': '2000-01-01', 'last_collection_date': '2025-01-10',
        'period': '9001', 'status': DEBT_STATUS_OVERDUE_ID,
    }


def test_risk_calculation_respects_zero_and_high_boundary() -> None:
    zero_risk = calculate_socioeconomic_risk_level(0, 0, 0, 0, 0, 0, 100)
    high_risk = calculate_socioeconomic_risk_level(1000, 1000, 10, 365, 2, 0, 1000)

    assert zero_risk == 0
    assert high_risk == 90


def test_profile_detail_caps_individual_risk_and_explains_reason() -> None:
    payload = build_debtor_profile_detail_payload(
        debtor_profile_id=11, person_id=22, profile_risk_level=90,
        person_contact_count=0, role='Responsable', priority=75,
    )

    assert payload['risk_value'] == 100
    assert payload['active'] is True
    assert 'Riesgo base del objeto: 90.0%' in str(payload['reason'])


def test_transform_summary_deduplicates_by_type_account_and_debt_id(
    cabecera_df: pd.DataFrame,
    detalle_df: pd.DataFrame,
) -> None:
    summary = build_transform_summary(cabecera_df, detalle_df)

    assert summary.persons_count == 2
    assert summary.debtors_count == 2
    assert summary.debtor_person_relations_count == 2
    assert summary.detail_rows_count == 3
    assert summary.unique_debts_count == 2
    assert summary.duplicated_debt_rows_count == 1


def test_build_debt_payload_marks_future_due_date_as_active() -> None:
    payload = build_debt_payload(
        {
            'DEUD_id': '9002', 'Tipo_Ingreso_Id': '1', 'NOTD_capital': '100',
            'NOTD_totalActualizado': '100', 'NOTD_vencimiento': '01/01/2999',
        },
        debtor_id=77,
    )

    assert payload['status'] == DEBT_STATUS_ACTIVE_ID
