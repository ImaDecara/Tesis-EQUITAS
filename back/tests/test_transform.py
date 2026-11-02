"""Normalizadores y builders: cada ajuste reemplaza una prueba que aceptaba una semántica falsa (ALIGN-026).

Reemplazos deliberados:
- inválido→0 (`parse_decimal('sin-monto') == 0.0`): ahora se rechaza con código; cero válido se conserva.
- `period == DEUD_id` e `issue_date`/`last_collection_date` copiadas: ahora null.
- estado inferido por vencimiento contra el reloj: ahora estado de origen y corte declarado.
- índice heredado relativo al promedio del lote y ajuste por persona: ya no se calculan.
"""

from datetime import date
from decimal import Decimal

import pandas as pd
import pytest

from ETL.transform import (
    SemanticRejection,
    batch_counts,
    build_debt_payload,
    build_debtor_payload,
    build_debtor_person_payload,
    build_debtor_profile_payload,
    build_person_payload,
    build_transform_summary,
    debt_status_key,
    infer_debt_type_key,
    infer_document_type_key,
    infer_person_type_key,
    money_text,
    parse_address_number,
    parse_date,
    parse_decimal,
    parse_int,
    parse_object_status,
    parse_optional_decimal,
    resolve_origin_state,
    with_catalog_ids,
)

CUT_OFF = date(2026, 9, 30)
STATES = {'NOTD_ESTA_id': {'10': 'PENDIENTE', '20': 'PAGADA', '30': 'ANULADA', '40': 'SUSPENDIDA', '99': 'UNKNOWN'},
          'NOTD_SITU_id': {'A': 'PENDIENTE', 'B': 'PAGADA', 'U': 'UNKNOWN'}}


def debt_row(**overrides):
    return {'DEUD_id': '9001', 'Tipo_Ingreso_Id': '801', 'NOTD_capital': '1000.50', 'NOTD_totalActualizado': '1200.75',
            'NOTD_vencimiento': '01/01/2000', 'NOTD_ESTA_id': '10', **overrides}


def build_debt(**overrides):
    return build_debt_payload(debt_row(**overrides), debtor_id=77, cut_off=CUT_OFF, state_catalogs=STATES, currency_code='ARS')


@pytest.mark.parametrize(('value', 'expected'), [
    ('1234.56', Decimal('1234.56')), ('0', Decimal('0')), ('0.00', Decimal('0.00')), ('7', Decimal('7')),
])
def test_importe_canonico_y_cero_valido_se_conservan(value, expected):
    assert parse_decimal(value) == expected


@pytest.mark.parametrize(('value', 'code'), [
    ('', 'IMPORTE_VACIO'), (None, 'IMPORTE_VACIO'), ('   ', 'IMPORTE_VACIO'),
    ('sin-monto', 'IMPORTE_NO_NUMERICO'), ('1.005', 'IMPORTE_NO_NUMERICO'), ('1e3', 'IMPORTE_NO_NUMERICO'),
    ('nan', 'IMPORTE_NO_NUMERICO'), ('Infinity', 'IMPORTE_NO_NUMERICO'), ('$10', 'IMPORTE_NO_NUMERICO'),
    ('-1', 'IMPORTE_NEGATIVO'), ('10000000000000000', 'IMPORTE_FUERA_DE_RANGO'),
])
def test_importe_vacio_o_invalido_se_rechaza_con_codigo_y_sin_valor(value, code):
    with pytest.raises(SemanticRejection) as error:
        parse_decimal(value)
    assert error.value.code == code
    assert str(value) not in str(error.value) or value in ('', None, '   ')


def test_importe_con_formato_del_lote():
    assert parse_decimal('1.234,56', decimal=',', thousands='.') == Decimal('1234.56')
    with pytest.raises(SemanticRejection):
        parse_decimal('1,234.56', decimal=',', thousands='.')


def test_importe_opcional_vacio_es_no_informado_no_cero():
    assert parse_optional_decimal('') is None
    assert parse_optional_decimal('0') == Decimal('0')
    with pytest.raises(SemanticRejection):
        parse_optional_decimal('abc')


def test_texto_monetario_exacto():
    assert money_text(Decimal('1200')) == '1200.00'
    assert money_text(Decimal('0')) == '0.00'
    assert money_text(Decimal('9999999999999999.99')) == '9999999999999999.99'


@pytest.mark.parametrize('value', ['000123', '001', '01', 'R-0456', '12a', '1.0', '-1', '+1', '1e3', ' ',
                                   '9223372036854775808', '', None, '١٢٣'])
def test_identificador_no_canonico_no_se_convierte(value):
    assert parse_int(value) is None


@pytest.mark.parametrize(('value', 'expected'), [('0', 0), ('1', 1), (' 123 ', 123), ('9223372036854775807', 9223372036854775807)])
def test_identificador_canonico(value, expected):
    assert parse_int(value) == expected


def test_001_y_1_no_colapsan_en_el_resumen():
    cabecera = pd.DataFrame([{'Bien_Tipo_Id': '3', 'Cuenta': cuenta, 'Destinatario_Id': persona}
                             for cuenta, persona in (('1', '10'), ('001', '11'), ('R-1', '12'))])
    summary = build_transform_summary(cabecera, pd.DataFrame(columns=['Bien_Tipo_Id', 'Cuenta', 'DEUD_id']))
    assert summary.debtors_count == 1
    assert summary.persons_count == 3


@pytest.mark.parametrize(('value', 'expected'), [('31/12/2025', '2025-12-31'), ('', None), (None, None),
                                                 ('00/00/0000', None), ('01/01/1900', None), ('31/12/9999', None)])
def test_fecha_del_puente_canonico(value, expected):
    assert parse_date(value) == expected


@pytest.mark.parametrize(('value', 'code'), [('fecha-invalida', 'FECHA_FORMATO_INVALIDO'), ('2025-12-31', 'FECHA_FORMATO_INVALIDO'),
                                             ('31/02/2024', 'FECHA_IMPOSIBLE')])
def test_fecha_invalida_se_rechaza_con_codigo(value, code):
    with pytest.raises(SemanticRejection) as error:
        parse_date(value)
    assert error.value.code == code


@pytest.mark.parametrize(('value', 'expected'), [('Activo', True), ('ACTIVO', True), ('inactivo', False), ('', None), (None, None)])
def test_estado_del_objeto_vacio_no_es_activo(value, expected):
    assert parse_object_status(value) is expected


@pytest.mark.parametrize('value', ['1', 'si', 'true'])
def test_estado_del_objeto_fuera_del_catalogo_se_rechaza(value):
    with pytest.raises(SemanticRejection):
        parse_object_status(value)


@pytest.mark.parametrize(('value', 'expected'), [('123', 123), ('0', 0), ('S/N', None), ('PB', None), ('1.5', None), ('', None)])
def test_numeracion_no_numerica_no_es_cero(value, expected):
    assert parse_address_number(value) == expected


@pytest.mark.parametrize(('document', 'expected'), [
    ('20-12345678-6', 'CUIT'), ('30-71234567-1', 'CUIT'), ('20123456786', 'CUIT'),
    ('30-71234567-2', 'UNKNOWN'), ('20-12345678-9', 'UNKNOWN'), ('99-00000001-1', 'UNKNOWN'), ('12345678', 'UNKNOWN'), ('ABC', 'UNKNOWN'),
    ('', 'UNKNOWN'), (None, 'UNKNOWN'),
])
def test_tipo_de_documento_no_se_fuerza_a_cuit(document, expected):
    assert infer_document_type_key(document) == expected


@pytest.mark.parametrize(('document', 'expected'), [('20-1', 'INDIVIDUAL'), ('30-1', 'LEGAL_PERSON'), ('99-1', 'UNKNOWN'), ('', 'UNKNOWN'), (None, 'UNKNOWN')])
def test_tipo_de_persona_por_prefijo(document, expected):
    assert infer_person_type_key(document) == expected


def test_persona_sin_estado_de_origen_no_queda_activa():
    person = build_person_payload({'Destinatario_Id': '501', 'Destinatario_CUIT': '99-1', 'Destinatario': 'Persona'})
    assert person == {'external_id': 501, 'document_type': 'UNKNOWN', 'document_number': '99-1', 'full_name': 'Persona',
                      'type': 'UNKNOWN', 'birth_date': None, 'status': 'UNKNOWN'}


def test_objeto_toma_su_tipo_del_mapa_declarado():
    row = {'Bien_Tipo_Id': '3', 'Cuenta': '4100', 'Identificador': 'X', 'Bien_Descripcion': 'Y', 'Estado': 'Inactivo'}
    payload = build_debtor_payload(row, {'3': 'RODADO'})
    assert (payload['type'], payload['external_id'], payload['status']) == ('RODADO', 4100, False)
    with pytest.raises(SemanticRejection) as error:
        build_debtor_payload({**row, 'Bien_Tipo_Id': '9'}, {'3': 'RODADO'})
    assert error.value.code == 'TIPO_BIEN_FUERA_DE_CATALOGO'


def test_relacion_conserva_porcentaje_declarado_sin_inventarlo():
    assert build_debtor_person_payload({'Destinatario_Porcentaje': '100'}, 1, 2)['priority'] == '100'
    assert build_debtor_person_payload({'Destinatario_Porcentaje': '0'}, 1, 2)['priority'] == '0'
    assert build_debtor_person_payload({'Destinatario_Porcentaje': ''}, 1, 2)['priority'] is None


def test_deuda_no_usa_el_id_como_periodo_ni_copia_fechas():
    debt = build_debt()
    assert debt == {
        'external_id': 9001, 'debtor': 77, 'type': 'water_connection',
        'description': 'Deuda importada desde TSV - DEUD_id 9001', 'original_amount': '1000.50',
        'current_amount': '1200.75', 'currency': 'ARS', 'issue_date': None, 'due_date': '2000-01-01',
        'last_collection_date': None, 'period': None, 'status': 'OVERDUE',
    }


def test_periodo_de_origen_se_conserva_si_existe():
    assert build_debt(Periodo_Fiscal='2024/03')['period'] == '2024/03'


@pytest.mark.parametrize(('field', 'code'), [('NOTD_capital', 'IMPORTE_VACIO'), ('NOTD_totalActualizado', 'IMPORTE_VACIO')])
def test_deuda_con_importe_vacio_nunca_se_vuelve_cero(field, code):
    with pytest.raises(SemanticRejection) as error:
        build_debt(**{field: ''})
    assert error.value.code == code


@pytest.mark.parametrize('external', ['000123', 'R-1', ''])
def test_deuda_con_id_no_canonico_se_rechaza(external):
    with pytest.raises(SemanticRejection) as error:
        build_debt(DEUD_id=external)
    assert error.value.code == 'IDENTIFICADOR_INVALIDO'


@pytest.mark.parametrize(('state', 'due', 'expected'), [
    ('PENDIENTE', '2026-09-29', 'OVERDUE'), ('PENDIENTE', '2026-09-30', 'ACTIVE'), ('PENDIENTE', '2026-10-01', 'ACTIVE'),
    ('PAGADA', '2000-01-01', 'PAID'), ('ANULADA', '2000-01-01', 'CANCELLED'), ('SUSPENDIDA', '2000-01-01', 'SUSPENDED'),
    ('UNKNOWN', '2000-01-01', 'UNKNOWN'), ('UNKNOWN', None, 'UNKNOWN'),
])
def test_estado_al_corte(state, due, expected):
    assert debt_status_key(state, due, CUT_OFF) == expected


def test_pendiente_sin_vencimiento_no_se_clasifica():
    with pytest.raises(SemanticRejection) as error:
        debt_status_key('PENDIENTE', None, CUT_OFF)
    assert error.value.code == 'FECHA_VACIA'


@pytest.mark.parametrize(('row', 'expected'), [
    ({'NOTD_ESTA_id': '40'}, 'SUSPENDIDA'), ({'NOTD_ESTA_id': '', 'NOTD_SITU_id': 'B'}, 'PAGADA'),
    ({'NOTD_ESTA_id': '99', 'NOTD_SITU_id': 'A'}, 'PENDIENTE'), ({'NOTD_ESTA_id': '10', 'NOTD_SITU_id': 'A'}, 'PENDIENTE'),
    ({}, 'UNKNOWN'), ({'NOTD_ESTA_id': '99'}, 'UNKNOWN'),
])
def test_estado_de_origen_por_catalogo(row, expected):
    assert resolve_origin_state(row, STATES) == expected


@pytest.mark.parametrize(('row', 'code'), [({'NOTD_ESTA_id': '77'}, 'ESTADO_ORIGEN_DESCONOCIDO'),
                                           ({'NOTD_ESTA_id': '10', 'NOTD_SITU_id': 'B'}, 'ESTADOS_ORIGEN_CONFLICTIVOS')])
def test_estado_de_origen_inconsistente_se_rechaza(row, code):
    with pytest.raises(SemanticRejection) as error:
        resolve_origin_state(row, STATES)
    assert error.value.code == code


def test_tipo_de_tributo_no_acepta_id_no_canonico():
    assert infer_debt_type_key('801') == 'water_connection'
    assert infer_debt_type_key('905') == 'unknown_905'
    assert infer_debt_type_key('0801') == 'unknown'


def test_claves_de_catalogo_se_cambian_por_id_y_faltante_falla():
    payload = {'type': 'RODADO', 'external_id': 3}
    assert with_catalog_ids('debtor', payload, {'debtor_type': {'RODADO': 73}}) == {'type': 73, 'external_id': 3}
    with pytest.raises(RuntimeError, match='CATALOG_KEY_MISSING'):
        with_catalog_ids('debtor', payload, {'debtor_type': {}})


def test_perfil_agrega_al_corte_sin_indice_heredado():
    rows = [
        {'current_amount': '100.10', 'status': 'OVERDUE', 'due_date': '2026-09-20'},
        {'current_amount': '50.20', 'status': 'OVERDUE', 'due_date': '2026-09-27'},
        {'current_amount': '0.00', 'status': 'OVERDUE', 'due_date': '2026-09-29'},
        {'current_amount': '7.00', 'status': 'PAID', 'due_date': '2000-01-01'},
        {'current_amount': '3.00', 'status': 'SUSPENDED', 'due_date': '2000-01-01'},
        {'current_amount': '1.00', 'status': 'UNKNOWN', 'due_date': '2000-01-01'},
        {'current_amount': '9.00', 'status': 'ACTIVE', 'due_date': '2027-01-01'},
    ]
    profile = build_debtor_profile_payload(11, rows, 2, 3, CUT_OFF)
    assert profile['total_debt_amount'] == '170.30'
    assert profile['overdue_debt_amount'] == '150.30'
    assert (profile['debt_count'], profile['overdue_debt_count']) == (7, 3)
    assert (profile['oldest_debt_days'], profile['average_debt_age_days']) == (10, 5)
    assert (profile['active_person_count'], profile['available_contact_count']) == (2, 3)
    assert profile['socioeconomic_risk_level'] is None
    assert 'previous_contact_count' not in profile


def test_perfil_sin_vencidas_no_inventa_antiguedad():
    rows = [{'current_amount': '9.00', 'status': 'ACTIVE', 'due_date': '2027-01-01'}]
    profile = build_debtor_profile_payload(11, rows, 1, 0, CUT_OFF)
    assert profile['oldest_debt_days'] is None and profile['average_debt_age_days'] is None
    assert profile['overdue_debt_amount'] == '0.00' and profile['overdue_debt_count'] == 0


def test_promedio_de_atraso_redondea_medio_hacia_arriba():
    rows = [{'current_amount': '1.00', 'status': 'OVERDUE', 'due_date': day} for day in ('2026-09-29', '2026-09-28')]
    assert build_debtor_profile_payload(1, rows, 1, 0, CUT_OFF)['average_debt_age_days'] == 2


def test_conteos_omiten_lo_no_calculado_y_solo_llevan_enteros():
    report = {
        'conteos': {'objetos': None, 'filas_cabecera': 2},
        'filas': {'cabecera': {'leidas': 2, 'aceptadas': 1, 'rechazadas': 1, 'rechazadas_por_codigo': {'CUENTA_NO_CANONICA': 1}}},
        'objetos': [{'estados_al_corte': {'VENCIDA': 2, 'PAGADA': 0}}, {'estados_al_corte': {'VENCIDA': 1, 'PAGADA': 1}}],
        'hallazgos_por_codigo': {'CUENTA_NO_CANONICA': 1}, 'motivos_bloqueo': ['LOTE_VACIO'],
        'importes': {'actualizado_aceptado': '10.50', 'actualizado_en_cuarentena_observado': None},
    }
    counts = batch_counts(report)
    assert 'objetos' not in counts and counts['filas_cabecera'] == 2
    assert counts['rechazos_cabecera'] == {'cuenta_no_canonica': 1}
    assert counts['estados_al_corte'] == {'vencida': 3, 'pagada': 1}
    assert counts['bloqueos'] == {'lote_vacio': 1}
    assert counts['importe_aceptado_centavos'] == 1050
    assert 'importe_en_cuarentena_centavos' not in counts


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
