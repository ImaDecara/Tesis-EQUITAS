"""Normalizadores y builders: cada ajuste reemplaza una prueba que aceptaba una semántica falsa (ALIGN-026).

Reemplazos deliberados:
- inválido→0 (`parse_decimal('sin-monto') == 0.0`): ahora se rechaza con código; cero válido se conserva.
- `period == DEUD_id` e `issue_date`/`last_collection_date` copiadas: ahora null.
- estado inferido por vencimiento contra el reloj: ahora estado de origen y corte declarado.
- índice heredado relativo al promedio del lote y ajuste por persona: ya no se calculan.
"""

import json
from datetime import date
from decimal import Decimal
from pathlib import Path

import pandas as pd
import pytest
from oracle_lots import AS_OF, FIXTURE

from ETL.transform import (
    SemanticRejection,
    batch_counts,
    build_debt_payload,
    build_debtor_payload,
    build_debtor_person_payload,
    build_debtor_profile_detail_payload,
    build_debtor_profile_payload,
    build_person_payload,
    build_transform_summary,
    clean_text,
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
    with_catalog_ids,
)
from ETL.validate_source import (
    SourceTable,
    ValidationError,
    load_contract,
    load_mapping,
    validate_batch,
)

CUT_OFF = date(2026, 9, 30)


def debt_row(**overrides):
    return {'DEUD_id': '9001', 'Tipo_Ingreso_Id': '801', 'NOTD_capital': '1000.50', 'NOTD_totalActualizado': '1200.75',
            'NOTD_vencimiento': '01/01/2000', **overrides}


def build_debt(origin_state='PENDIENTE', **overrides):
    return build_debt_payload(debt_row(**overrides), debtor_id=77, cut_off=CUT_OFF, origin_state=origin_state, currency_code='ARS')


@pytest.mark.parametrize(('value', 'expected'), [
    (None, None), ('', None), ('   ', None), (float('nan'), None), (pd.NA, None), ('  x ', 'x'), (0, '0'),
    ('null', 'null'), ('None', 'None'), ('NaN', 'NaN'), ('NULL', 'NULL'),
])
def test_solo_es_ausencia_lo_vacio_o_un_nulo_real(value, expected):
    assert clean_text(value) == expected


@pytest.mark.parametrize(('value', 'expected'), [
    ('1234.56', Decimal('1234.56')), ('0', Decimal(0)), ('0.00', Decimal('0.00')), ('7', Decimal(7)),
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
    assert parse_optional_decimal('0') == Decimal(0)
    with pytest.raises(SemanticRejection):
        parse_optional_decimal('abc')


def test_texto_monetario_exacto():
    assert money_text(Decimal(1200)) == '1200.00'
    assert money_text(Decimal(0)) == '0.00'
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
    # Documento 00000000: dígito verificador válido sin corresponder a una persona real.
    ('20-00000000-1', 'CUIT'), ('30-00000000-7', 'CUIT'), ('20000000001', 'CUIT'),
    ('30-00000000-2', 'UNKNOWN'), ('20-00000000-9', 'UNKNOWN'), ('99-00000001-1', 'UNKNOWN'), ('12345678', 'UNKNOWN'), ('ABC', 'UNKNOWN'),
    ('', 'UNKNOWN'), (None, 'UNKNOWN'),
])
def test_tipo_de_documento_no_se_fuerza_a_cuit(document, expected):
    assert infer_document_type_key(document) == expected


@pytest.mark.parametrize(('document', 'expected'), [
    ('20-00000000-1', 'INDIVIDUAL'), ('20000000001', 'INDIVIDUAL'), ('30-00000000-7', 'LEGAL_PERSON'),
    ('20-1', 'UNKNOWN'), ('ABC20-00000000-1XYZ', 'UNKNOWN'), ('20-00000000-9', 'UNKNOWN'), ('99-1', 'UNKNOWN'),
    ('', 'UNKNOWN'), (None, 'UNKNOWN'),
])
def test_tipo_de_persona_solo_con_documento_de_estructura_valida(document, expected):
    assert infer_person_type_key(document) == expected


@pytest.mark.parametrize('document', ['ABC20-00000000-1XYZ', '20-00000000-1X', 'X20000000001', '20.00000000.1',
                                      '２０-００００００００-１', '2000000000１'])
def test_tipo_de_documento_mira_el_valor_tal_como_llego(document):
    assert infer_document_type_key(document) == 'UNKNOWN'


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


def test_tipo_de_tributo_conserva_el_codigo_sin_mapeo():
    assert infer_debt_type_key('801') == 'water_connection'
    assert infer_debt_type_key('905') == 'unknown_905'
    assert infer_debt_type_key('0801') == 'unknown_0801'
    assert infer_debt_type_key('null') == 'unknown_null'
    assert infer_debt_type_key('') == 'unknown'


@pytest.mark.parametrize('mutation', [
    lambda catalogos: catalogos.pop('debt_status_por_estado'),
    lambda catalogos: catalogos['debt_status_por_estado'].pop('SUSPENDIDA'),
    lambda catalogos: catalogos['debt_status_por_estado'].update(PAGADA=''),
])
def test_contrato_sin_el_mapa_de_estados_completo_se_rechaza(mutation):
    contract = load_contract()
    mutation(contract['catalogos'])
    empty = dict.fromkeys(('cabecera', 'detalle'), SourceTable([], []))
    with pytest.raises(ValidationError, match='^CONFIGURACION_INVALIDA$'):
        validate_batch(empty, load_mapping(FIXTURE), contract, AS_OF)


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
    # Reglas 1.1.0: el total registrado incluye todo; la mora es por calendario sobre las no pagadas.
    # Sale la pagada y el 0,00 OVERDUE; entran la suspendida y la UNKNOWN vencidas el 2000-01-01 (9769 días).
    assert profile['total_debt_amount'] == '170.30'
    assert profile['overdue_debt_amount'] == '154.30'
    assert (profile['debt_count'], profile['overdue_debt_count']) == (7, 4)
    assert (profile['oldest_debt_days'], profile['average_debt_age_days']) == (9769, 4888)
    assert (profile['active_person_count'], profile['available_contact_count']) == (2, 3)
    assert profile['socioeconomic_risk_level'] is None
    assert profile['previous_contact_count'] is None and profile['previous_response_count'] is None


def test_detalle_por_persona_conserva_la_fila_sin_indice_heredado():
    detail = build_debtor_profile_detail_payload(11, 22)
    assert (detail['debtor_profile'], detail['person'], detail['risk_value']) == (11, 22, None)
    assert 'no calculado' in detail['reason']


def test_perfil_con_estado_desconocido_computa_por_importe_y_vencimiento():
    # 1.1.0: sin estado observado no hay excepción; solo PAID sale de la mora.
    rows = [{'current_amount': '9.00', 'status': 'UNKNOWN', 'due_date': '2000-01-01'},
            {'current_amount': '1.00', 'status': None, 'due_date': '2001-01-01'}]
    profile = build_debtor_profile_payload(11, rows, 1, 0, CUT_OFF)
    assert profile['total_debt_amount'] == '10.00' and profile['debt_count'] == 2
    assert (profile['overdue_debt_amount'], profile['overdue_debt_count']) == ('10.00', 2)
    assert (profile['oldest_debt_days'], profile['average_debt_age_days']) == (9769, 9586)
    assert profile['debt_state_not_observed_count'] == 2


def test_perfil_con_no_pagada_no_evaluable_y_sin_vencidas_no_publica_cero():
    rows = [{'current_amount': '9.00', 'status': 'ACTIVE', 'due_date': '2027-01-01'},
            {'current_amount': '1.00', 'status': 'UNKNOWN', 'due_date': None}]
    profile = build_debtor_profile_payload(11, rows, 1, 0, CUT_OFF)
    assert (profile['overdue_debt_amount'], profile['overdue_debt_count']) == (None, None)
    assert profile['debt_state_not_observed_count'] == 1


def test_perfil_con_no_pagada_no_evaluable_y_vencidas_conserva_el_subtotal():
    rows = [{'current_amount': '9.00', 'status': 'OVERDUE', 'due_date': '2026-09-20'},
            {'current_amount': '1.00', 'status': 'UNKNOWN', 'due_date': None}]
    profile = build_debtor_profile_payload(11, rows, 1, 0, CUT_OFF)
    assert (profile['overdue_debt_amount'], profile['overdue_debt_count']) == ('9.00', 1)
    assert (profile['oldest_debt_days'], profile['debt_state_not_observed_count']) == (10, 1)


@pytest.mark.parametrize('row', [
    {'current_amount': '-1.00', 'status': 'ACTIVE', 'due_date': '2026-01-01'},
    {'current_amount': '5.00', 'status': 'ACTIVE', 'due_date': '1969-12-31'},
    {'current_amount': None, 'status': 'OVERDUE', 'due_date': '2026-01-01'},
])
def test_perfil_trata_como_no_evaluable_lo_mismo_que_las_reglas(row):
    profile = build_debtor_profile_payload(11, [row], 1, 0, CUT_OFF)
    assert (profile['overdue_debt_amount'], profile['overdue_debt_count']) == (None, None)


def test_perfil_excluye_pagadas_aunque_les_falte_importe_o_vencimiento():
    rows = [{'current_amount': None, 'status': 'PAID', 'due_date': None},
            {'current_amount': '-3.00', 'status': 'PAID', 'due_date': '1969-01-01'},
            {'current_amount': '4.00', 'status': 'PAID', 'due_date': '2026-01-01'}]
    profile = build_debtor_profile_payload(11, rows, 1, 0, CUT_OFF)
    assert profile['total_debt_amount'] == '1.00' and profile['debt_count'] == 3
    assert (profile['overdue_debt_amount'], profile['overdue_debt_count']) == ('0.00', 0)
    assert profile['oldest_debt_days'] is None


def test_perfil_sin_corte_no_calcula_mora():
    rows = [{'current_amount': '9.00', 'status': 'OVERDUE', 'due_date': '2000-01-01'}]
    profile = build_debtor_profile_payload(11, rows, 1, 0, None)
    assert profile['total_debt_amount'] == '9.00'
    assert (profile['overdue_debt_amount'], profile['overdue_debt_count']) == (None, None)
    assert (profile['oldest_debt_days'], profile['average_debt_age_days']) == (None, None)


SMALL_CASES = json.loads((Path(__file__).resolve().parents[2] / 'contracts/portfolio-small-cases.v1.json').read_text(encoding='utf-8'))


@pytest.mark.parametrize('case', SMALL_CASES['casos'], ids=lambda case: case['id'])
def test_perfil_de_los_casos_chicos(case):
    keys = {row['id']: row['key'] for row in SMALL_CASES['catalogo_debt_status']}
    # Un estado fuera del catálogo no tiene clave (la base lo impide con la FK): queda sin estado.
    rows = [{'current_amount': None if item['importe'] is None else str(item['importe']),
             'due_date': item['vencimiento'], 'status': keys.get(item['estado_id'])} for item in case['obligaciones']]
    profile = build_debtor_profile_payload(case['objeto']['id'], rows, len(case['titulares']), 0,
                                           date.fromisoformat(SMALL_CASES['fecha_cartera']))
    assert {key: profile[key] for key in case['esperado']['perfil']} == case['esperado']['perfil']
    assert Decimal(profile['total_debt_amount']) == case['esperado']['total_registrado']['valor']


def test_perfil_sin_obligaciones_mantiene_el_cero_derivado():
    profile = build_debtor_profile_payload(11, [], 1, None, CUT_OFF)
    assert (profile['overdue_debt_amount'], profile['overdue_debt_count']) == ('0.00', 0)
    assert profile['debt_state_not_observed_count'] == 0 and profile['available_contact_count'] is None
    assert profile['previous_contact_count'] is None and profile['previous_response_count'] is None


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
        'objetos': [{'resultado': 'ACEPTADO', 'estados_al_corte': {'VENCIDA': 2, 'PAGADA': 0}},
                    {'resultado': 'ACEPTADO', 'estados_al_corte': {'VENCIDA': 1, 'PAGADA': 1}},
                    {'resultado': 'CUARENTENA', 'estados_al_corte': {'VENCIDA': 5, 'PAGADA': 0}}],
        'hallazgos_por_codigo': {'CUENTA_NO_CANONICA': 1}, 'motivos_bloqueo': ['LOTE_VACIO'],
        'importes': {'actualizado_aceptado': '10.50', 'actualizado_en_cuarentena_observado': None},
    }
    counts = batch_counts(report)
    assert 'objetos' not in counts and counts['filas_cabecera'] == 2
    assert counts['rechazos_cabecera'] == {'cuenta_no_canonica': 1}
    assert counts['estados_al_corte'] == {'vencida': 3, 'pagada': 1}
    assert counts['estados_al_corte_en_cuarentena'] == {'vencida': 5}
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
