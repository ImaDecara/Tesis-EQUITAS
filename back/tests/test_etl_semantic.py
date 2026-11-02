"""ALIGN-026. Archivo → base simulada → perfil, contra el oráculo independiente de ALIGN-023.

La base simulada rechaza lo mismo que la real en lo que importa aquí: claves únicas, FK de catálogo,
importes y fechas con tipo correcto. Sus IDs de catálogo no coinciden con los códigos del lote ni con los
valores históricos del ETL, para que una resolución por constante falle. La misma comparación se repite
contra la base local con database/testing/etl_semantic_local.py.
"""

import csv
import hashlib
import json
import os
import re
import sys
from collections import Counter
from datetime import date
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
from oracle_lots import (
    AS_OF,
    FIXTURE,
    MUNICIPIO_B,
    accepted_objects,
    accepted_with_altered,
    derive_lot,
    municipio_b_mapping,
    object_by_case,
    oracle,
    persisted_mismatches,
    synthetic_profile,
    to_iso_dates,
)

from ETL import config, load, run_etl, transform, validate_source
from ETL.config import ETLError
from ETL.extract import canonical_records
from ETL.validate_source import SourceRow, SourceTable

CATALOGS = {
    'document_type': {'DNI': 101, 'CUIT': 102, 'CUIL': 103, 'UNKNOWN': 104},
    'person_type': {'INDIVIDUAL': 111, 'LEGAL_PERSON': 112, 'COMPANY': 113, 'ASSOCIATION': 114, 'UNKNOWN': 115},
    'person_status': {'ACTIVE': 121, 'INACTIVE': 122, 'UNKNOWN': 123},
    'debt_status': {'ACTIVE': 201, 'OVERDUE': 202, 'PAYMENT_PLAN': 203, 'JUDICIAL': 204, 'CERTIFICATE_ACTIVE': 205,
                    'PAID': 206, 'CANCELLED': 207, 'UNKNOWN': 208, 'SUSPENDED': 209},
    'contact_type': {'PHONE': 301, 'MOBILE': 302, 'EMAIL': 303, 'LETTER': 304, 'WHATSAPP': 305},
    'debtor_type': {'INMUEBLE': 71, 'RODADO': 73, 'AGUA': 76},
    'currency': {'ARS': 401},
}
UNIQUE = {
    'person': ('external_id',), 'debtor': ('tenant', 'type', 'external_id'), 'debt': ('debtor', 'external_id'),
    'debtor_person': ('debtor', 'person'), 'debtor_contact': ('person', 'type', 'value'),
    'debtor_profile': ('debtor',), 'debtor_profile_detail': ('debtor_profile', 'person'), 'address': ('person',), 'province': ('name',),
    'city': ('province', 'name', 'postal_code'),
}
FOREIGN_KEYS = {
    'person': {'document_type': 'document_type', 'type': 'person_type', 'status': 'person_status'},
    'debtor': {'type': 'debtor_type'}, 'debt': {'currency': 'currency', 'status': 'debt_status'},
    'debtor_contact': {'type': 'contact_type'},
}
NOT_NULL = {'debt': ('external_id', 'debtor', 'original_amount', 'current_amount'), 'person': ('external_id',),
            'debtor': ('tenant', 'external_id')}
NUMERIC = {'debt': ('original_amount', 'current_amount'), 'debtor_profile': ('total_debt_amount', 'overdue_debt_amount'),
           'debtor_person': ('priority',)}
CARTERA = ('person', 'debtor', 'debt', 'debtor_person', 'debtor_contact', 'debtor_profile', 'debtor_profile_detail',
           'address', 'city', 'province')
SERVICE_KEY = 'CLAVE_GENERAL_FICTICIA'
PUBLIC_KEY = 'CLAVE_PUBLICA_FICTICIA'
IMPORT_JWT = 'JWT_IMPORTADOR_FICTICIO'
ACTOR = 7


class FakeError(Exception):
    pass


class FakeQuery:
    def __init__(self, database, table):
        self.database, self.table, self.filters, self.action, self.page = database, table, [], ('select', None), None

    def select(self, columns):
        self.columns = columns
        return self

    def order(self, column):
        self.sort_column = column
        return self

    def range(self, start, end):
        self.page = (start, end)
        return self

    def eq(self, column, value):
        self.filters.append((column, lambda current, wanted=value: current == wanted))
        return self

    def in_(self, column, values):
        self.filters.append((column, lambda current, wanted=tuple(values): current in wanted))
        return self

    def limit(self, _size):
        return self

    def insert(self, payload):
        self.action = ('insert', payload)
        return self

    def update(self, payload):
        self.action = ('update', payload)
        return self

    def execute(self):
        rows = self.database.tables.setdefault(self.table, [])
        matches = [row for row in rows if all(test(row.get(column)) for column, test in self.filters)]
        name, payload = self.action
        if name == 'insert':
            payloads = payload if isinstance(payload, list) else [payload]
            created = [self.database.insert(self.table, item) for item in payloads]
            return SimpleNamespace(data=created)
        if name == 'update':
            self.database.updates += 1
            self.database.check(self.table, payload)
            for row in matches:
                row.update(json.loads(json.dumps(payload)))
            return SimpleNamespace(data=[dict(row) for row in matches])
        if self.page:
            # Como la Data API: corta en su máximo de filas aunque la página pedida sea mayor.
            matches = sorted(matches, key=lambda row: row[self.sort_column])[self.page[0]:self.page[1] + 1][:self.database.max_rows]
        return SimpleNamespace(data=[self.as_data_api(row) for row in matches])

    def as_data_api(self, row):
        """Un numeric llega como número JSON y Python lo vuelve float, salvo que se pida con ::text."""
        exact = re.findall(r'(\w+)::text', getattr(self, 'columns', ''))
        return {column: float(value) if column in NUMERIC.get(self.table, ()) and column not in exact and value is not None else value
                for column, value in row.items()}


class FakeDatabase:
    def __init__(self, catalogs=CATALOGS):
        self.catalogs = catalogs
        self.tables = {name: [] for name in CARTERA}
        for table, keys in catalogs.items():
            key_column = 'code' if table == 'currency' else 'key'
            self.tables[table] = [{'id': identifier, key_column: key} for key, identifier in keys.items()]
        self.batches = []
        self.rpc_headers = []
        self.fail_on = None
        self.rpc_outcomes = {}
        self.max_rows = 1000
        self.writes = 0
        self.updates = 0
        self.next_id = 1000

    def table(self, name):
        return FakeQuery(self, name)

    def check(self, table, row):
        json.dumps(row)  # Como PostgREST: Decimal o date sin serializar fallarían al enviar.
        for column in NOT_NULL.get(table, ()):
            if column in row and row[column] is None:
                raise FakeError(f'not_null:{column}')
        for column in NUMERIC.get(table, ()):
            if row.get(column) is not None:
                assert isinstance(row[column], str), f'{table}.{column} debe viajar como texto exacto'
                assert re.fullmatch(r'[0-9]+(\.[0-9]+)?', row[column]), f'{table}.{column}'
        for column, catalog in FOREIGN_KEYS.get(table, {}).items():
            if row.get(column) is not None and row[column] not in self.catalogs[catalog].values():
                raise FakeError(f'fk:{column}')

    def insert(self, table, payload):
        self.writes += 1
        if self.fail_on == table:
            raise FakeError('fallo inyectado NOMBRE_SINTETICO_A026')
        self.check(table, payload)
        row = json.loads(json.dumps(payload))
        key = UNIQUE.get(table)
        if key and any(all(existing.get(c) == row.get(c) for c in key) for existing in self.tables.setdefault(table, [])):
            raise FakeError(f'unique:{table}')
        self.next_id += 1
        row['id'] = self.next_id
        self.tables.setdefault(table, []).append(row)
        return dict(row)

    def rpc(self, url, *, headers, json, timeout, **_):  # noqa: A002
        assert url == 'http://127.0.0.1:54321/rest/v1/rpc/record_import_batch'
        self.rpc_headers.append(headers)
        body = json
        for name, value in body['p_file_hashes'].items():
            assert re.fullmatch(r'[a-z][a-z0-9_]{0,63}', name) and re.fullmatch(r'[0-9a-f]{64}', value)
        check_counts(body['p_counts'])
        assert re.fullmatch(r'[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}', body['p_rules_version'])
        assert re.fullmatch(r'[A-Z][A-Z0-9_]{0,63}', body['p_source'])
        outcome = self.rpc_outcomes.get(body['p_status'])
        if isinstance(outcome, int):
            return httpx.Response(outcome, json={'message': 'detalle del proveedor NOMBRE_SINTETICO_A026'}, request=httpx.Request('POST', url))
        if isinstance(outcome, str):
            return httpx.Response(400, json={'message': outcome}, request=httpx.Request('POST', url))
        if outcome is not None and not isinstance(outcome, tuple):
            raise outcome
        # Como record_import_batch: un reintento con la misma clave no agrega otro evento.
        if not any(event['p_idempotency_key'] == body['p_idempotency_key'] for event in self.batches):
            self.next_id += 1
            self.batches.append({**body, 'id': self.next_id})
        if isinstance(outcome, tuple):  # El evento quedó, pero la respuesta no se entiende o se pierde.
            if outcome[0] == 'perdida':
                raise outcome[1]
            return httpx.Response(200, text='no es json', request=httpx.Request('POST', url))
        return httpx.Response(200, json={'batch_id': self.next_id, 'created': True},
                              request=httpx.Request('POST', url))

    def cartera_rows(self):
        return sum(len(self.tables[name]) for name in CARTERA)


def check_counts(value):
    assert isinstance(value, dict)
    for name, item in value.items():
        assert re.fullmatch(r'[a-z][a-z0-9_]{0,63}', name), name
        if isinstance(item, dict):
            check_counts(item)
        else:
            assert type(item) is int and item >= 0, name
    assert len(json.dumps(value)) <= 16384


def entorno_vacio(monkeypatch, tmp_path):
    for name in tuple(os.environ):
        if name.startswith(('SUPABASE_', 'EQUITAS_')):
            monkeypatch.delenv(name)
    monkeypatch.setattr(config, 'ENV_PATH', tmp_path / 'sin-credenciales.env')


@pytest.fixture
def database(monkeypatch, tmp_path):
    entorno_vacio(monkeypatch, tmp_path)
    for name, value in (('EQUITAS_TARGET_ENV', 'local'), ('SUPABASE_URL', 'http://127.0.0.1:54321'),
                        ('SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY), ('SUPABASE_ANON_KEY', PUBLIC_KEY),
                        ('EQUITAS_IMPORT_SERVER_JWT', IMPORT_JWT), ('EQUITAS_IMPORT_ACTOR_USER', str(ACTOR))):
        monkeypatch.setenv(name, value)
    fake = FakeDatabase()
    monkeypatch.setattr(load, 'supabase', fake)
    monkeypatch.setattr(load.httpx, 'post', fake.rpc)
    return fake


def execute(folder, cut_off=AS_OF, mapping=None):
    run_etl.run_etl(str(folder), execute=True, cut_off=cut_off, mapping_path=None if mapping is None else str(mapping))


def debts_of(database, bien_tipo, cuenta):
    key = {'1': 'INMUEBLE', '3': 'RODADO', '6': 'AGUA'}[bien_tipo]
    debtor = next(row for row in database.tables['debtor']
                  if row['type'] == CATALOGS['debtor_type'][key] and row['external_id'] == int(cuenta))
    return debtor, [row for row in database.tables['debt'] if row['debtor'] == debtor['id']]


def profile_of(database, debtor):
    return next(row for row in database.tables['debtor_profile'] if row['debtor'] == debtor['id'])


# ---------------------------------------------------------------- lote bloqueado


def test_fixture_completa_queda_bloqueada_sin_filas_y_con_lote_fallido(database):
    with pytest.raises(ETLError) as error:
        execute(FIXTURE)
    assert error.value.code == 'BATCH_BLOCKED'
    assert database.cartera_rows() == 0
    assert database.writes == 0
    batch = database.batches[-1]
    assert batch['p_status'] == 'FALLIDO' and batch['p_as_of'] == AS_OF
    assert len(database.batches) == 1
    conteos = oracle()['conteos']
    for name in ('objetos', 'objetos_aceptados', 'objetos_en_cuarentena', 'personas', 'relaciones',
                 'obligaciones_unicas', 'duplicados_identicos', 'duplicados_conflictivos', 'detalle_sin_cabecera',
                 'filas_cabecera', 'filas_detalle'):
        assert batch['p_counts'][name] == conteos[name], name
    assert batch['p_counts']['bloqueos']['detalle_sin_cabecera'] == 1
    assert batch['p_counts']['importe_aceptado_centavos'] == 251923614


def test_importe_actualizado_ausente_bloquea_sin_convertirse_en_cero(database, tmp_path):
    lot = derive_lot(tmp_path / 'importe-vacio', ('importe-vacio',))
    with pytest.raises(ETLError) as error:
        execute(lot)
    assert error.value.code == 'BATCH_BLOCKED'
    assert database.cartera_rows() == 0
    counts = database.batches[-1]['p_counts']
    assert counts['bloqueos']['cuarentena_importe_no_evaluable'] == 1
    assert counts['hallazgos']['importe_vacio'] == 1
    assert database.batches[-1]['p_status'] == 'FALLIDO'


@pytest.mark.parametrize('value', ['1,005', '1.234,567', '12,3456', '1e3', '$100,00', '1,234.56', 'NaN'])
def test_fraccion_de_centavo_o_formato_ajeno_bloquea_el_lote(database, tmp_path, value):
    caso = accepted_objects()[0]['clave_agrupacion']
    lot = derive_lot(tmp_path / 'importe', detalle_cells={(caso, None, 'NOTD_totalActualizado'): value})
    with pytest.raises(ETLError, match='BATCH_BLOCKED'):
        execute(lot)
    assert database.cartera_rows() == 0
    assert database.batches[-1]['p_counts']['hallazgos']['importe_no_numerico'] >= 1


# ---------------------------------------------------------------- lote validado contra el oráculo


def test_lote_validado_persistido_coincide_con_el_oraculo(database, tmp_path):
    lot = derive_lot(tmp_path / 'validado', ('cuenta-ceros-izquierda',))
    execute(lot)
    assert persisted_mismatches(database.tables, accepted_objects(), CATALOGS, lot) == []
    assert [batch['p_status'] for batch in database.batches] == ['VALIDADO', 'PUBLICADO']
    assert database.batches[1]['p_supersedes'] == database.batches[0]['id']
    assert database.batches[1]['p_counts']['objetos_publicados'] == 31
    assert database.batches[1]['p_counts']['deudas_insertadas'] == sum(item['obligaciones'] for item in accepted_objects())


def test_municipio_b_validado_coincide_con_su_oraculo(database, tmp_path):
    expected = oracle('municipio-sintetico-b')['objetos']
    execute(MUNICIPIO_B, mapping=municipio_b_mapping(tmp_path))
    assert persisted_mismatches(database.tables, expected, CATALOGS, MUNICIPIO_B) == []


def test_comparacion_detecta_una_fila_alterada(database, tmp_path):
    """Control de la prueba: el comparador no aprueba cualquier cosa."""
    lot = derive_lot(tmp_path / 'validado')
    execute(lot)
    database.tables['debt'][0]['period'] = str(database.tables['debt'][0]['external_id'])
    database.tables['debt'][1]['current_amount'] = '0.00'
    profile = database.tables['debtor_profile'][0]
    profile['socioeconomic_risk_level'] = 0
    problems = persisted_mismatches(database.tables, accepted_objects(), CATALOGS, lot)
    assert any('|period|' in item for item in problems)
    assert any('|importe_actualizado|' in item for item in problems)
    assert any('|socioeconomic_risk_level|' in item for item in problems)


@pytest.mark.parametrize('case', ['cuenta-ceros-izquierda', 'cuenta-alfanumerica', 'importe-no-numerico', 'fecha-imposible',
                                  'tipo-ingreso-fuera-de-catalogo', 'tipo-bien-fuera-de-catalogo',
                                  'conciliacion-diferente', 'duplicado-conflictivo'])
def test_objeto_en_cuarentena_no_se_persiste_y_el_lote_informa_el_motivo(database, tmp_path, case):
    expected = object_by_case(case)
    lot = derive_lot(tmp_path / case, (case,))
    execute(lot)
    assert persisted_mismatches(database.tables, accepted_objects(), CATALOGS, lot) == []
    persons = {row['external_id'] for row in database.tables['person']}
    assert not set(expected['personas']) & persons
    counts = database.batches[0]['p_counts']
    assert counts['objetos_en_cuarentena'] == 1
    assert counts['hallazgos'][expected['motivos'][0].lower()] >= 1


def test_ceros_a_la_izquierda_no_colapsan_con_la_cuenta_canonica(database, tmp_path):
    lot = derive_lot(tmp_path / 'ceros', ('cuenta-ceros-izquierda',))
    canonical = object_by_case('cuenta-canonica-123')
    execute(lot)
    debtor, debts = debts_of(database, '3', '123')
    assert len(debts) == canonical['obligaciones']
    total = sum(Decimal(row['current_amount']) for row in debts)
    assert total == Decimal(canonical['importe_actualizado']['valor'])
    assert profile_of(database, debtor)['total_debt_amount'] == canonical['importe_actualizado']['valor']
    cuentas_rodado = [row['external_id'] for row in database.tables['debtor']
                      if row['type'] == CATALOGS['debtor_type']['RODADO']]
    assert cuentas_rodado.count(123) == 1


def test_invalido_de_capital_va_a_cuarentena_sin_guardar_cero(database, tmp_path):
    target = accepted_objects()[0]
    lot = derive_lot(tmp_path / 'capital', detalle_cells={(target['clave_agrupacion'], None, 'NOTD_capital'): 'sin-monto'})
    execute(lot)
    assert database.batches[0]['p_status'] == 'VALIDADO'
    assert int(target['cuenta']) not in [row['external_id'] for row in database.tables['debtor']
                                         if row['type'] == CATALOGS['debtor_type']['RODADO']]
    assert database.batches[0]['p_counts']['hallazgos']['importe_no_numerico'] >= 1
    assert all(row['original_amount'] is not None for row in database.tables['debt'])


def test_cero_valido_se_conserva_como_cero_observado(database, tmp_path):
    expected = object_by_case('importe-cero')
    lot = derive_lot(tmp_path / 'cero')
    execute(lot)
    _, debts = debts_of(database, expected['bien_tipo_id'], expected['cuenta'])
    assert len(debts) == expected['obligaciones']
    assert any(Decimal(row['current_amount']) == 0 for row in debts)
    assert all(row['current_amount'] is not None for row in debts)


def test_estado_suspendido_y_demas_estados_de_origen_no_se_vuelven_vencida(database, tmp_path):
    expected = object_by_case('estados-origen-vencimiento-viejo')
    lot = derive_lot(tmp_path / 'estados')
    execute(lot)
    debtor, debts = debts_of(database, expected['bien_tipo_id'], expected['cuenta'])
    names = {identifier: key for key, identifier in CATALOGS['debt_status'].items()}
    assert sorted(names[row['status']] for row in debts) == ['CANCELLED', 'OVERDUE', 'PAID', 'SUSPENDED', 'UNKNOWN']
    profile = profile_of(database, debtor)
    assert profile['overdue_debt_count'] == 1
    assert profile['oldest_debt_days'] == expected['dias_vencida_mas_antigua']['valor']
    assert Decimal(profile['total_debt_amount']) == Decimal(expected['importe_actualizado']['valor'])
    assert Decimal(profile['overdue_debt_amount']) < Decimal(profile['total_debt_amount'])


def test_edades_y_vencida_dependen_del_corte_declarado_y_no_del_reloj(database, tmp_path, monkeypatch):
    expected = object_by_case('vencimiento-posterior-al-corte')
    lot = derive_lot(tmp_path / 'corte')
    execute(lot, cut_off='2031-01-01', mapping=synthetic_profile(tmp_path, fecha_corte='2031-01-01'))
    debtor, debts = debts_of(database, expected['bien_tipo_id'], expected['cuenta'])
    names = {identifier: key for key, identifier in CATALOGS['debt_status'].items()}
    assert [names[row['status']] for row in debts] == ['OVERDUE']
    profile = profile_of(database, debtor)
    assert profile['overdue_debt_count'] == 1
    assert profile['oldest_debt_days'] is not None
    assert database.batches[0]['p_as_of'] == '2031-01-01'


def test_vencimiento_igual_al_corte_es_vigente_y_un_dia_antes_es_vencida(database, tmp_path):
    first, second = accepted_objects()[0], accepted_objects()[2]
    assert first['obligaciones'] > 0
    lot = derive_lot(tmp_path / 'borde', detalle_cells={
        (first['clave_agrupacion'], None, 'NOTD_vencimiento'): '30/09/2026',
        (second['clave_agrupacion'], None, 'NOTD_vencimiento'): '29/09/2026',
    })
    execute(lot)
    names = {identifier: key for key, identifier in CATALOGS['debt_status'].items()}
    debtor, debts = debts_of(database, first['bien_tipo_id'], first['cuenta'])
    assert {names[row['status']] for row in debts} == {'ACTIVE'}
    assert profile_of(database, debtor)['oldest_debt_days'] is None
    assert profile_of(database, debtor)['overdue_debt_count'] == 0
    debtor, debts = debts_of(database, second['bien_tipo_id'], second['cuenta'])
    assert {names[row['status']] for row in debts} == {'OVERDUE'}
    assert profile_of(database, debtor)['oldest_debt_days'] == 1


def test_objeto_sin_obligaciones_no_inventa_antiguedad(database, tmp_path):
    expected = object_by_case('cabecera-sin-detalle')
    execute(derive_lot(tmp_path / 'sin-detalle'))
    debtor, debts = debts_of(database, expected['bien_tipo_id'], expected['cuenta'])
    assert debts == []
    profile = profile_of(database, debtor)
    assert profile['total_debt_amount'] == '0.00'
    assert profile['oldest_debt_days'] is None and profile['average_debt_age_days'] is None


# ---------------------------------------------------------------- ciclo 1: B1, ausencia de estados


def test_sin_ningun_estado_observado_el_vencido_queda_no_disponible(database, tmp_path):
    target = object_by_case('base-valido')
    lot = derive_lot(tmp_path / 'sin-estados', detalle_cells={(target['clave_agrupacion'], None, 'NOTD_ESTA_id'): ''})
    execute(lot)
    debtor, _ = debts_of(database, target['bien_tipo_id'], target['cuenta'])
    profile = profile_of(database, debtor)
    assert profile['overdue_debt_amount'] is None and profile['overdue_debt_count'] is None
    assert profile['oldest_debt_days'] is None and profile['average_debt_age_days'] is None
    assert profile['debt_state_not_observed_count'] == target['obligaciones']
    assert profile['total_debt_amount'] == target['importe_actualizado']['valor']
    assert persisted_mismatches(database.tables, accepted_with_altered(('base-valido',), lot), CATALOGS, lot) == []


def test_codigo_catalogado_como_unknown_equivale_a_sin_estado(database, tmp_path):
    target = object_by_case('base-valido')
    catalogos = json.loads(synthetic_profile(tmp_path).read_text(encoding='utf-8'))['catalogos']
    catalogos['NOTD_ESTA_id']['99'] = 'UNKNOWN'
    lot = derive_lot(tmp_path / 'unknown', detalle_cells={(target['clave_agrupacion'], None, 'NOTD_ESTA_id'): '99'})
    execute(lot, mapping=synthetic_profile(tmp_path, catalogos=catalogos))
    debtor, _ = debts_of(database, target['bien_tipo_id'], target['cuenta'])
    assert profile_of(database, debtor)['overdue_debt_amount'] is None


def test_lote_sin_columnas_de_estado_no_publica_ningun_cero_de_vencido(database, tmp_path):
    lot = derive_lot(tmp_path / 'sin-columnas', drop_detail_columns=('NOTD_ESTA_id', 'NOTD_SITU_id'))
    execute(lot)
    for profile in database.tables['debtor_profile']:
        if profile['debt_count'] == 0:
            assert profile['overdue_debt_amount'] == '0.00' and profile['overdue_debt_count'] == 0
        else:
            assert profile['overdue_debt_amount'] is None and profile['overdue_debt_count'] is None
            assert profile['debt_state_not_observed_count'] == profile['debt_count']


def test_mixto_conserva_el_subtotal_y_declara_lo_no_observado(database, tmp_path):
    expected = object_by_case('estados-origen-vencimiento-viejo')
    execute(derive_lot(tmp_path / 'mixto'))
    debtor, _ = debts_of(database, expected['bien_tipo_id'], expected['cuenta'])
    profile = profile_of(database, debtor)
    assert expected['dias_vencida_mas_antigua']['completo'] is False
    assert profile['oldest_debt_days'] == expected['dias_vencida_mas_antigua']['valor']
    assert profile['overdue_debt_count'] == 1
    assert profile['debt_state_not_observed_count'] == sum(expected['dias_vencida_mas_antigua']['filas_no_observadas'].values())


def test_estado_faltante_sin_vencidas_observadas_no_es_un_cero_legitimo(database, tmp_path):
    target = object_by_case('misma-cuenta-otro-tipo')
    key = target['clave_agrupacion']
    lot = derive_lot(tmp_path / 'mixto-cero', detalle_cells={(key, '700004', 'NOTD_ESTA_id'): '',
                                                             (key, '700005', 'NOTD_vencimiento'): '30/09/2026'})
    execute(lot)
    debtor, _ = debts_of(database, target['bien_tipo_id'], target['cuenta'])
    profile = profile_of(database, debtor)
    assert (profile['overdue_debt_amount'], profile['overdue_debt_count']) == (None, None)
    assert profile['debt_state_not_observed_count'] == 1
    assert persisted_mismatches(database.tables, accepted_with_altered(('misma-cuenta-otro-tipo',), lot), CATALOGS, lot) == []


def test_sin_obligaciones_el_cero_sigue_siendo_derivado_y_el_atraso_no_aplica(database, tmp_path):
    expected = object_by_case('cabecera-sin-detalle')
    execute(derive_lot(tmp_path / 'vacio'))
    debtor, _ = debts_of(database, expected['bien_tipo_id'], expected['cuenta'])
    profile = profile_of(database, debtor)
    assert (profile['overdue_debt_amount'], profile['overdue_debt_count']) == ('0.00', 0)
    assert profile['debt_state_not_observed_count'] == 0 and profile['oldest_debt_days'] is None
    assert expected['dias_vencida_mas_antigua']['presencia'] == 'NO_APLICA'


def test_gestiones_no_integradas_no_quedan_en_cero(database, tmp_path):
    execute(derive_lot(tmp_path / 'gestiones'))
    assert {row['previous_contact_count'] for row in database.tables['debtor_profile']} == {None}
    assert {row['previous_response_count'] for row in database.tables['debtor_profile']} == {None}


def test_sin_columnas_de_contacto_el_conteo_no_es_cero(database, tmp_path):
    lot = derive_lot(tmp_path / 'sin-contactos',
                     drop_header_columns=('Destinatario_Email', 'Destinatario_Telefono', 'Destinatario_Celular'))
    execute(lot)
    assert {row['available_contact_count'] for row in database.tables['debtor_profile']} == {None}
    assert database.tables['debtor_contact'] == []


def test_contacto_vacio_con_columna_presente_es_cero_como_dice_el_oraculo(database, tmp_path):
    expected = object_by_case('sin-contacto')
    assert expected['contactos_utilizables'] == 0
    execute(derive_lot(tmp_path / 'contacto-vacio'))
    debtor, _ = debts_of(database, expected['bien_tipo_id'], expected['cuenta'])
    assert profile_of(database, debtor)['available_contact_count'] == 0


def test_estados_persistidos_coinciden_con_los_conteos_del_lote(database, tmp_path):
    lot = derive_lot(tmp_path / 'paridad', ('cuenta-ceros-izquierda',))
    execute(lot)
    assert_states_match_batch(database)
    counts = database.batches[-1]['p_counts']
    assert counts['estados_al_corte_en_cuarentena'] == {'vencida': 1}


def assert_states_match_batch(database):
    names = {identifier: key for key, identifier in CATALOGS['debt_status'].items()}
    labels = {'OVERDUE': 'vencida', 'ACTIVE': 'vigente', 'PAID': 'pagada', 'CANCELLED': 'anulada',
              'SUSPENDED': 'suspendida', 'UNKNOWN': 'unknown'}
    persisted = Counter(labels[names[row['status']]] for row in database.tables['debt'])
    assert dict(persisted) == database.batches[-1]['p_counts']['estados_al_corte']


# ---------------------------------------------------------------- ciclo 1: B2, un solo parser por campo


@pytest.mark.parametrize('code', ['null', 'NULL', 'None', 'none', 'NaN', 'nan'])
@pytest.mark.parametrize('column', ['NOTD_ESTA_id', 'NOTD_SITU_id'])
def test_estado_catalogado_con_palabra_de_nulo_se_conserva(database, tmp_path, code, column):
    target = object_by_case('base-valido')
    key = target['clave_agrupacion']
    catalogos = json.loads(synthetic_profile(tmp_path).read_text(encoding='utf-8'))['catalogos']
    catalogos[column][code] = 'SUSPENDIDA'
    cells = {(key, None, column): code}
    if column == 'NOTD_SITU_id':
        cells[(key, None, 'NOTD_ESTA_id')] = ''
    lot = derive_lot(tmp_path / 'palabra', detalle_cells=cells)
    execute(lot, mapping=synthetic_profile(tmp_path, catalogos=catalogos))
    _, debts = debts_of(database, target['bien_tipo_id'], target['cuenta'])
    assert {row['status'] for row in debts} == {CATALOGS['debt_status']['SUSPENDED']}
    assert_states_match_batch(database)
    state_catalogs = {name: catalogos[name] for name in ('NOTD_ESTA_id', 'NOTD_SITU_id')}
    expected = accepted_with_altered(('base-valido',), lot, state_catalogs)
    assert persisted_mismatches(database.tables, expected, CATALOGS, lot, state_catalogs=state_catalogs) == []


@pytest.mark.parametrize('code', ['null', 'None', 'NaN'])
def test_tipo_de_objeto_catalogado_con_palabra_de_nulo_se_publica(database, tmp_path, code):
    target = object_by_case('base-valido')
    key = target['clave_agrupacion']
    catalogos = json.loads(synthetic_profile(tmp_path).read_text(encoding='utf-8'))['catalogos']
    catalogos['Bien_Tipo_Id'][code] = 'INMUEBLE'
    lot = derive_lot(tmp_path / 'tipo', cabecera_cells={(key, None, 'Bien_Tipo_Id'): code},
                     detalle_cells={(key, None, 'Bien_Tipo_Id'): code})
    execute(lot, mapping=synthetic_profile(tmp_path, catalogos=catalogos))
    types = {row['type'] for row in database.tables['debtor'] if row['external_id'] == int(target['cuenta'])}
    assert CATALOGS['debtor_type']['INMUEBLE'] in types


@pytest.mark.parametrize('code', ['null', 'ABC', '0801'])
def test_tributo_catalogado_no_colapsa_en_una_clave_generica(database, tmp_path, code):
    target = object_by_case('base-valido')
    key = target['clave_agrupacion']
    catalogos = json.loads(synthetic_profile(tmp_path).read_text(encoding='utf-8'))['catalogos']
    catalogos['Tipo_Ingreso_Id'][code] = 'tributo sintetico'
    lot = derive_lot(tmp_path / 'tributo', detalle_cells={(key, None, 'Tipo_Ingreso_Id'): code})
    execute(lot, mapping=synthetic_profile(tmp_path, catalogos=catalogos))
    _, debts = debts_of(database, target['bien_tipo_id'], target['cuenta'])
    assert {row['type'] for row in debts} == {f'unknown_{code}'}


@pytest.mark.parametrize(('column', 'table', 'field'), [
    ('Destinatario', 'person', 'full_name'), ('Identificador', 'debtor', 'identifier'),
    ('Bien_Descripcion', 'debtor', 'description'), ('Destinatario_Tipo', 'debtor_person', 'role'),
])
@pytest.mark.parametrize('word', ['null', 'None', 'NaN'])
def test_texto_de_origen_con_palabra_de_nulo_no_se_vuelve_ausencia(database, tmp_path, column, table, field, word):
    target = object_by_case('base-valido')
    execute(derive_lot(tmp_path / 'texto', cabecera_cells={(target['clave_agrupacion'], None, column): word}))
    assert word in {row[field] for row in database.tables[table]}


@pytest.mark.parametrize('sentinel', ['2999-01-01', '9999-12-31', '1900-01-01', '0000-00-00'])
def test_fecha_centinela_en_lote_iso_no_es_fecha_real_ni_rompe_la_carga(database, tmp_path, sentinel):
    keys = {item['clave_agrupacion'] for item in accepted_objects()}
    lot = derive_lot(tmp_path / 'iso', cabecera_cells={(key, None, 'Fecha_Actualizacion'): sentinel for key in keys})
    to_iso_dates(lot)
    formato = json.loads(synthetic_profile(tmp_path).read_text(encoding='utf-8'))['formato']
    profile = synthetic_profile(tmp_path, formato={**formato, 'fecha': 'aaaa-mm-dd'})
    execute(lot, mapping=profile)
    assert database.batches[0]['p_status'] == 'VALIDADO'
    assert database.batches[0]['p_source_updated_at'] is None


def test_fecha_anterior_al_anio_1000_llega_igual_desde_el_puente():
    table = SourceTable(['NOTD_vencimiento', 'DEUD_id'], [SourceRow(2, {'NOTD_vencimiento': '0999-01-02', 'DEUD_id': '1'})])
    contract = validate_source.load_contract()
    mapping = json.loads(json.dumps(validate_source.load_mapping(FIXTURE)))
    mapping['formato']['fecha'] = 'aaaa-mm-dd'
    assert canonical_records(table, 'detalle', mapping, contract)[0]['NOTD_vencimiento'] == '02/01/0999'
    assert transform.parse_date('02/01/0999') == '0999-01-02'


@pytest.mark.parametrize(('column', 'cabecera'), [('Cuenta', True), ('Destinatario_Id', True), ('DEUD_id', False)])
def test_identificador_cero_es_un_valor_y_no_una_ausencia(database, tmp_path, column, cabecera):
    target = object_by_case('base-valido')
    key = target['clave_agrupacion']
    if column == 'Cuenta':
        cells = {'cabecera_cells': {(key, None, 'Cuenta'): '0'}, 'detalle_cells': {(key, None, 'Cuenta'): '0'}}
    elif cabecera:
        cells = {'cabecera_cells': {(key, None, column): '0'}}
    else:
        cells = {'detalle_cells': {(key, '700001', column): '0'}}
    execute(derive_lot(tmp_path / 'cero-id', **cells))
    table = {'Cuenta': 'debtor', 'Destinatario_Id': 'person', 'DEUD_id': 'debt'}[column]
    assert 0 in {row['external_id'] for row in database.tables[table]}


def test_validador_y_transformacion_comparten_la_regla_de_identificador():
    contract = validate_source.load_contract()
    for value in ('0', '1', '000123', '123', 'R-0456', '', '9223372036854775807', '9223372036854775808', '１２３', '+1'):
        assert (transform.parse_int(value) is not None) == validate_source.is_canonical_id(value, contract), value


# ---------------------------------------------------------------- ciclo 1: B3, documento tal como llegó


@pytest.mark.parametrize('document', ['ABC20-00000000-1XYZ', 'A20000000001', '20000000001X', '20-0000X0000-1', '20.00000000.1',
                                      '20 00000000 1', '2-000000000-1', '200-0000000-1', '２０-００００００００-１', '20-00000000-1-'])
def test_documento_con_caracteres_ajenos_no_se_afirma_cuit(database, tmp_path, document):
    target = object_by_case('base-valido')
    execute(derive_lot(tmp_path / 'doc', cabecera_cells={(target['clave_agrupacion'], None, 'Destinatario_CUIT'): document}))
    person = next(row for row in database.tables['person'] if row['external_id'] == target['personas'][0])
    assert person['document_type'] == CATALOGS['document_type']['UNKNOWN']
    assert person['type'] == CATALOGS['person_type']['UNKNOWN']
    assert person['document_number'] == document


@pytest.mark.parametrize(('document', 'person_type'), [('20-00000000-1', 'INDIVIDUAL'), ('20000000001', 'INDIVIDUAL'),
                                                       ('30-00000000-7', 'LEGAL_PERSON'), (' 30-00000000-7 ', 'LEGAL_PERSON')])
def test_documento_con_estructura_valida_se_clasifica(database, tmp_path, document, person_type):
    target = object_by_case('base-valido')
    execute(derive_lot(tmp_path / 'doc', cabecera_cells={(target['clave_agrupacion'], None, 'Destinatario_CUIT'): document}))
    person = next(row for row in database.tables['person'] if row['external_id'] == target['personas'][0])
    assert person['document_type'] == CATALOGS['document_type']['CUIT']
    assert person['type'] == CATALOGS['person_type'][person_type]
    assert person['document_number'] == document.strip()


@pytest.mark.parametrize('document', ['20-00000000-9', '30-00000000-2', '99-00000001-1'])
def test_digito_verificador_o_prefijo_invalido_no_clasifica_documento_ni_persona(database, tmp_path, document):
    target = object_by_case('base-valido')
    execute(derive_lot(tmp_path / 'doc', cabecera_cells={(target['clave_agrupacion'], None, 'Destinatario_CUIT'): document}))
    person = next(row for row in database.tables['person'] if row['external_id'] == target['personas'][0])
    assert person['document_type'] == CATALOGS['document_type']['UNKNOWN']
    assert person['type'] == CATALOGS['person_type']['UNKNOWN']


# ---------------------------------------------------------------- catálogos y mapeos


def test_tipo_de_objeto_sale_del_mapa_declarado_y_no_del_codigo(database, tmp_path):
    lot = derive_lot(tmp_path / 'mapa')
    catalogos = json.loads(synthetic_profile(tmp_path).read_text(encoding='utf-8'))['catalogos']
    catalogos['Bien_Tipo_Id'] = {'1': 'AGUA', '3': 'INMUEBLE', '6': 'RODADO'}
    execute(lot, mapping=synthetic_profile(tmp_path, catalogos=catalogos))
    expected = object_by_case('base-valido')
    types = {row['type'] for row in database.tables['debtor'] if row['external_id'] == int(expected['cuenta'])}
    assert CATALOGS['debtor_type']['INMUEBLE'] in types
    assert not types & {1, 3, 6}


def test_clave_de_catalogo_faltante_falla_antes_de_escribir(database, tmp_path, monkeypatch):
    without = {**CATALOGS, 'debt_status': {k: v for k, v in CATALOGS['debt_status'].items() if k != 'SUSPENDED'}}
    fake = FakeDatabase(without)
    monkeypatch.setattr(load, 'supabase', fake)
    monkeypatch.setattr(load.httpx, 'post', fake.rpc)
    with pytest.raises(ETLError, match='CATALOG_KEY_MISSING'):
        execute(derive_lot(tmp_path / 'catalogo'))
    assert fake.writes == 0 and fake.batches == []


def test_detalle_sin_columnas_opcionales_se_enlaza_por_clave_de_agrupacion(database, tmp_path):
    lot = derive_lot(tmp_path / 'opcionales', drop_detail_columns=('Bien_Tipo_Id', 'Cuenta'))
    execute(lot)
    assert persisted_mismatches(database.tables, accepted_objects(), CATALOGS, lot) == []


def test_alias_de_columnas_del_perfil_llegan_a_la_carga(database, tmp_path):
    lot = derive_lot(tmp_path / 'alias', detail_renames={'NOTD_totalActualizado': 'importe_exportado'})
    execute(lot, mapping=synthetic_profile(tmp_path, columnas={'detalle': {'NOTD_totalActualizado': 'importe_exportado'}}))
    expected = accepted_objects()
    (lot / 'detalle.tsv').write_text((lot / 'detalle.tsv').read_text(encoding='utf-8').replace('importe_exportado', 'NOTD_totalActualizado'), encoding='utf-8')
    assert persisted_mismatches(database.tables, expected, CATALOGS, lot) == []


def test_lote_csv_con_perfil_explicito_se_publica_igual(database, tmp_path):
    lot = derive_lot(tmp_path / 'csv')
    for name in ('cabecera', 'detalle'):
        rows = list(csv.reader((lot / f'{name}.tsv').read_text(encoding='utf-8').splitlines(), delimiter='\t'))
        with (lot / f'{name}.csv').open('w', encoding='utf-8', newline='') as stream:
            csv.writer(stream, delimiter=';').writerows(rows)
    formato = json.loads(synthetic_profile(tmp_path).read_text(encoding='utf-8'))['formato']
    execute(lot, mapping=synthetic_profile(tmp_path, formato={**formato, 'tipo': 'csv', 'separador': ';'}))
    assert persisted_mismatches(database.tables, accepted_objects(), CATALOGS, lot) == []
    assert database.batches[0]['p_file_hashes']['detalle'] == hashlib.sha256((lot / 'detalle.csv').read_bytes()).hexdigest()


def test_contacto_marcador_o_ilegible_no_se_carga_y_el_inactivo_queda_inactivo(database, tmp_path):
    execute(derive_lot(tmp_path / 'contactos'))
    people = {row['external_id']: row['id'] for row in database.tables['person']}
    by_person = lambda case: [row for row in database.tables['debtor_contact']  # noqa: E731
                              if row['person'] == people[object_by_case(case)['personas'][0]]]
    assert by_person('contacto-placeholder') == []
    assert by_person('contacto-formato-invalido') == []
    assert by_person('sin-contacto') == []
    inactive = by_person('contacto-inactivo')
    assert inactive and all(row['active'] is False for row in inactive)
    assert all(row['active'] is True for row in by_person('contacto-activo-mismo-valor'))


def test_porcentaje_ausente_no_es_cero_y_estado_vacio_no_es_activo(database, tmp_path):
    target = object_by_case('base-valido')
    lot = derive_lot(tmp_path / 'vacios', cabecera_cells={(target['clave_agrupacion'], None, 'Estado'): ''})
    execute(lot)
    missing = object_by_case('porcentaje-faltante')
    debtor, _ = debts_of(database, missing['bien_tipo_id'], missing['cuenta'])
    assert [row['priority'] for row in database.tables['debtor_person'] if row['debtor'] == debtor['id']] == [None]
    debtor, _ = debts_of(database, target['bien_tipo_id'], target['cuenta'])
    assert debtor['status'] is None


def test_numeracion_no_numerica_del_domicilio_no_se_guarda_como_cero(database, tmp_path):
    target = object_by_case('base-valido')
    lot = derive_lot(tmp_path / 'domicilio', cabecera_cells={(target['clave_agrupacion'], None, 'Destinatario_Numeracion'): 'S/N',
                                                             (target['clave_agrupacion'], None, 'Destinatario_Piso'): 'PB'})
    execute(lot)
    person = next(row['id'] for row in database.tables['person'] if row['external_id'] == target['personas'][0])
    address = next(row for row in database.tables['address'] if row['person'] == person)
    assert address['number'] is None and address['floor'] is None and address['street']


def test_importe_alto_viaja_exacto_sin_pasar_por_float(database, tmp_path):
    target = object_by_case('base-valido')
    key = target['clave_agrupacion']
    # 700001 cambia de 13.817,53 a un importe que un float no representa; la cabecera se ajusta para conciliar.
    lot = derive_lot(tmp_path / 'alto',
                     cabecera_cells={(key, None, 'Deuda_Actualizada'): '999.999.999.999.948,62'},
                     detalle_cells={(key, '700001', 'NOTD_totalActualizado'): '999.999.999.999.916,55',
                                    (key, '700002', 'NOTD_totalActualizado'): '32,07',
                                    (key, '700003', 'NOTD_totalActualizado'): '0,00'})
    execute(lot)
    _, debts = debts_of(database, target['bien_tipo_id'], target['cuenta'])
    assert '999999999999916.55' in {row['current_amount'] for row in debts}
    assert '999999999999916.55' != format(float('999999999999916.55'), '.2f')


def test_importe_con_mas_digitos_que_un_float_llega_exacto_al_payload():
    payload = transform.build_debt_payload(
        {'DEUD_id': '1', 'NOTD_capital': '9999999999999999.99', 'NOTD_totalActualizado': '1234567890123456.78',
         'NOTD_vencimiento': '01/01/2020', 'Tipo_Ingreso_Id': '1', 'NOTD_ESTA_id': '10'},
        debtor_id=9, cut_off=date(2026, 9, 30), origin_state='PENDIENTE', currency_code='ARS',
    )
    assert payload['original_amount'] == '9999999999999999.99'
    assert payload['current_amount'] == '1234567890123456.78'
    assert load.debt_values_are_equal('current_amount', '1234567890123456.78', '1234567890123456.79') is False


# ---------------------------------------------------------------- registro del lote


def test_import_batch_registra_hashes_conteos_corte_reglas_y_credencial_propia(database, tmp_path):
    from services.decision_rules_v1 import RULES_VERSION

    lot = derive_lot(tmp_path / 'lote')
    execute(lot)
    for batch in database.batches:
        assert batch['p_tenant'] == 1 and batch['p_actor_user'] == ACTOR and batch['p_source'] == 'ETL_CLI'
        assert batch['p_as_of'] == AS_OF and batch['p_rules_version'] == RULES_VERSION
        assert batch['p_source_updated_at'] == '2026-09-29'
        for name in ('cabecera', 'detalle'):
            assert batch['p_file_hashes'][name] == hashlib.sha256((lot / f'{name}.tsv').read_bytes()).hexdigest()
        assert set(batch['p_file_hashes']) == {'cabecera', 'detalle', 'mapeo', 'contrato'}
    assert database.batches[0]['p_idempotency_key'] != database.batches[1]['p_idempotency_key']
    for headers in database.rpc_headers:
        assert headers['apikey'] == PUBLIC_KEY
        assert headers['Authorization'] == f'Bearer {IMPORT_JWT}'
        assert SERVICE_KEY not in json.dumps(headers)


def test_sin_fecha_actualizacion_observada_queda_nula_y_nunca_va_a_la_deuda(database, tmp_path):
    keys = {item['clave_agrupacion']: '' for item in accepted_objects()}
    lot = derive_lot(tmp_path / 'sin-fecha', cabecera_cells={(key, None, 'Fecha_Actualizacion'): '' for key in keys})
    execute(lot)
    assert database.batches[0]['p_source_updated_at'] is None
    assert all(row['issue_date'] is None and row['last_collection_date'] is None for row in database.tables['debt'])


def test_fecha_centinela_de_actualizacion_no_es_fecha_real(database, tmp_path):
    keys = {item['clave_agrupacion'] for item in accepted_objects()}
    lot = derive_lot(tmp_path / 'centinela', cabecera_cells={(key, None, 'Fecha_Actualizacion'): '01/01/1900' for key in keys})
    execute(lot)
    assert database.batches[0]['p_source_updated_at'] is None


def test_recarga_identica_no_inserta_ni_actualiza_deudas(database, tmp_path, capsys):
    lot = derive_lot(tmp_path / 'recarga')
    execute(lot)
    before = json.dumps(sorted(database.tables['debt'], key=lambda row: row['id']))
    capsys.readouterr()
    execute(lot)
    salida = capsys.readouterr().out
    assert before == json.dumps(sorted(database.tables['debt'], key=lambda row: row['id']))
    assert re.search(r'Deudas insertadas:\s+0', salida) and re.search(r'Deudas actualizadas:\s+0', salida)
    assert database.batches[-1]['p_counts']['deudas_sin_cambios'] == len(database.tables['debt'])


def _portfolio(database):
    return json.dumps({name: database.tables[name] for name in CARTERA}, sort_keys=True)


def test_recarga_identica_no_reescribe_ninguna_fila_ni_el_momento_del_perfil(database, tmp_path, capsys):
    lot = derive_lot(tmp_path / 'recarga')
    execute(lot)
    first = database.batches[-1]['p_counts']
    assert first['filas_actualizadas'] == 0
    assert first['filas_insertadas'] == database.cartera_rows()
    assert {name: value['insertadas'] for name, value in first['escrituras'].items()} \
        == {name: len(database.tables[name]) for name in CARTERA}
    before = _portfolio(database)
    writes = database.writes
    capsys.readouterr()
    execute(lot)
    salida = capsys.readouterr().out
    assert _portfolio(database) == before
    assert (database.writes, database.updates) == (writes, 0)
    counts = database.batches[-1]['p_counts']
    assert (counts['filas_insertadas'], counts['filas_actualizadas']) == (0, 0)
    assert counts['filas_sin_cambios'] >= database.cartera_rows()
    assert re.search(r'Filas insertadas:\s+0\n', salida) and re.search(r'Filas actualizadas:\s+0\n', salida)


def test_corregir_una_obligacion_solo_toca_esa_fila_y_el_perfil_de_su_objeto(database, tmp_path):
    target = object_by_case('base-valido')
    key = target['clave_agrupacion']
    execute(derive_lot(tmp_path / 'primero'))
    profiles = {row['id']: dict(row) for row in database.tables['debtor_profile']}
    debts = {row['id']: dict(row) for row in database.tables['debt']}
    execute(derive_lot(tmp_path / 'corregido', cabecera_cells={(key, None, 'Deuda_Actualizada'): '46.279,61'},
                       detalle_cells={(key, '700001', 'NOTD_totalActualizado'): '13.817,54'}))
    assert database.updates == 2
    assert [row['id'] for row in database.tables['debt'] if row != debts[row['id']]] == \
        [next(row['id'] for row in database.tables['debt'] if row['external_id'] == 700001)]
    debtor, _ = debts_of(database, target['bien_tipo_id'], target['cuenta'])
    changed = [row for row in database.tables['debtor_profile'] if row != profiles[row['id']]]
    assert [row['debtor'] for row in changed] == [debtor['id']]
    assert changed[0]['total_debt_amount'] == '46279.61'
    assert changed[0]['profile_generated_at'] != profiles[changed[0]['id']]['profile_generated_at']
    assert database.batches[-1]['p_counts']['escrituras']['debtor_profile']['actualizadas'] == 1
    assert database.batches[-1]['p_counts']['escrituras']['debt']['actualizadas'] == 1


def test_corregir_solo_el_capital_no_recalcula_el_perfil(database, tmp_path):
    key = object_by_case('base-valido')['clave_agrupacion']
    execute(derive_lot(tmp_path / 'primero'))
    profiles = json.dumps(database.tables['debtor_profile'], sort_keys=True)
    execute(derive_lot(tmp_path / 'capital', cabecera_cells={(key, None, 'Deuda_Capital'): '38.807,98'},
                       detalle_cells={(key, '700001', 'NOTD_capital'): '11.611,38'}))
    assert database.updates == 1
    assert database.batches[-1]['p_counts']['escrituras']['debt']['actualizadas'] == 1
    assert json.dumps(database.tables['debtor_profile'], sort_keys=True) == profiles


def test_persona_con_datos_distintos_en_dos_objetos_se_escribe_una_vez_y_mandan_los_ultimos(database, tmp_path):
    objects = ('3-10012', '6-10013', '1-10014')
    cells = {(objects[0], None, 'Destinatario'): 'Nombre Sintetico Primero', (objects[0], None, 'Destinatario_Calle'): 'Calle Primera',
             (objects[2], None, 'Destinatario'): 'Nombre Sintetico Ultimo', (objects[2], None, 'Destinatario_Calle'): 'Calle Ultima',
             (objects[1], None, 'Destinatario_Localidad'): 'Localidad Intermedia'}
    lot = derive_lot(tmp_path / 'persona', cabecera_cells=cells)
    execute(lot)
    person = next(row for row in database.tables['person'] if row['external_id'] == 90015)
    address = next(row for row in database.tables['address'] if row['person'] == person['id'])
    assert person['full_name'] == 'Nombre Sintetico Ultimo'
    assert address['street'] == 'Calle Ultima'
    assert database.updates == 0, 'Una sola escritura por persona y dirección'
    execute(lot)
    counts = database.batches[-1]['p_counts']
    assert (counts['filas_insertadas'], counts['filas_actualizadas'], database.updates) == (0, 0, 0)


def test_la_ultima_fila_sin_domicilio_no_borra_el_de_una_fila_anterior(database, tmp_path):
    columns = ('Destinatario_Calle', 'Destinatario_Numeracion', 'Destinatario_Piso', 'Destinatario_Depto')
    lot = derive_lot(tmp_path / 'sin-domicilio', cabecera_cells={('1-10014', None, column): '' for column in columns})
    execute(lot)
    person = next(row for row in database.tables['person'] if row['external_id'] == 90015)
    assert next(row for row in database.tables['address'] if row['person'] == person['id'])['street'] == 'Calle Sintética 97'


@pytest.mark.parametrize('position', [0, -1])
def test_localidad_sin_codigo_postal_no_borra_el_de_otra_ni_mueve_direcciones(database, tmp_path, position):
    target = accepted_objects()[position]['clave_agrupacion']
    lot = derive_lot(tmp_path / 'sin-cp', cabecera_cells={(target, None, 'Destinatario_Localidad'): 'Localidad Sintética 1',
                                                          (target, None, 'Destinatario_CP'): ''})
    execute(lot)
    # Si la localidad ya existe se reutiliza con su código postal; si esta fila es la primera, nace sin él.
    postal_codes = [row['postal_code'] for row in database.tables['city'] if row['name'] == 'Localidad Sintética 1']
    assert '0000' in postal_codes and postal_codes.count(None) == (1 if position == 0 else 0)
    before = _portfolio(database)
    execute(lot)
    counts = database.batches[-1]['p_counts']
    assert (counts['filas_insertadas'], counts['filas_actualizadas']) == (0, 0)
    assert _portfolio(database) == before


def _corrected_lot(tmp_path, name):
    key = object_by_case('base-valido')['clave_agrupacion']
    return derive_lot(tmp_path / name, cabecera_cells={(key, None, 'Deuda_Actualizada'): '46.279,61'},
                      detalle_cells={(key, '700001', 'NOTD_totalActualizado'): '13.817,54'})


@pytest.mark.parametrize(('outcome', 'code'), [
    (400, 'IMPORT_BATCH_REJECTED'), (401, 'IMPORT_BATCH_REJECTED'), (403, 'IMPORT_BATCH_REJECTED'), (409, 'IMPORT_BATCH_REJECTED'),
    ('ACTOR_NOT_ACTIVE_MEMBER', 'ACTOR_NOT_ACTIVE_MEMBER'), ('INVALID_IMPORT_BATCH:import_batch_counts_format', 'INVALID_IMPORT_BATCH:import_batch_counts_format'),
])
def test_rechazo_confirmado_de_publicado_cierra_con_fallido_y_conserva_el_error(database, tmp_path, capsys, outcome, code):
    execute(derive_lot(tmp_path / 'primero'))
    database.rpc_outcomes['PUBLICADO'] = outcome
    previous = len(database.batches)
    capsys.readouterr()
    with pytest.raises(ETLError) as error:
        execute(_corrected_lot(tmp_path, 'corregido'))
    assert error.value.code == code
    events = database.batches[previous:]
    assert [event['p_status'] for event in events] == ['VALIDADO', 'FALLIDO']
    assert events[1]['p_supersedes'] == events[0]['id']
    assert events[1]['p_file_hashes'] == events[0]['p_file_hashes']
    # Son los conteos que ya aceptó VALIDADO: si el rechazo fue por los conteos de PUBLICADO, FALLIDO igual puede quedar.
    assert events[1]['p_counts'] == events[0]['p_counts']
    salida = capsys.readouterr()
    assert 'NOMBRE_SINTETICO_A026' not in salida.out + salida.err
    assert 'PUBLISH_OUTCOME_UNKNOWN' not in salida.out


def test_si_tampoco_se_puede_registrar_fallido_se_informa_la_causa_original(database, tmp_path, capsys):
    execute(derive_lot(tmp_path / 'primero'))
    database.rpc_outcomes.update({'PUBLICADO': 'ACTOR_NOT_ACTIVE_MEMBER', 'FALLIDO': 'ROLE_NOT_ALLOWED'})
    previous = len(database.batches)
    capsys.readouterr()
    with pytest.raises(ETLError) as error:
        execute(_corrected_lot(tmp_path, 'corregido'))
    assert error.value.code == 'ACTOR_NOT_ACTIVE_MEMBER'
    assert [event['p_status'] for event in database.batches[previous:]] == ['VALIDADO']
    assert 'IMPORT_BATCH_FAILURE_NOT_RECORDED' in capsys.readouterr().out


@pytest.mark.parametrize(('outcome', 'recorded'), [
    (500, False), (502, False), (503, False), (504, False),
    (httpx.ReadTimeout('sin respuesta'), False), (httpx.RemoteProtocolError('cortada'), False), (httpx.ReadError('reiniciada'), False),
    (('perdida', httpx.ReadTimeout('sin respuesta')), True), (('ilegible', None), True),
], ids=['500', '502', '503', '504', 'timeout', 'protocolo', 'lectura', 'perdida-con-evento', '200-ilegible'])
def test_publicado_con_resultado_incierto_no_registra_un_fallido_que_podria_ser_falso(database, tmp_path, capsys, monkeypatch, outcome, recorded):
    monkeypatch.setattr(load.time, 'sleep', lambda _seconds: None)
    execute(derive_lot(tmp_path / 'primero'))
    database.rpc_outcomes['PUBLICADO'] = outcome
    previous = len(database.batches)
    capsys.readouterr()
    with pytest.raises(ETLError):
        execute(_corrected_lot(tmp_path, 'corregido'))
    assert [event['p_status'] for event in database.batches[previous:]] == (['VALIDADO', 'PUBLICADO'] if recorded else ['VALIDADO'])
    salida = capsys.readouterr()
    assert 'codigo=PUBLISH_OUTCOME_UNKNOWN' in salida.out
    assert 'NOMBRE_SINTETICO_A026' not in salida.out + salida.err


def test_una_interrupcion_durante_la_carga_termina_fallido_con_antecedente(database, tmp_path, monkeypatch):
    monkeypatch.setattr(run_etl, 'load_person', Mock(side_effect=KeyboardInterrupt))
    with pytest.raises(KeyboardInterrupt):
        execute(derive_lot(tmp_path / 'interrumpido'))
    events = database.batches
    assert [event['p_status'] for event in events] == ['VALIDADO', 'FALLIDO']
    assert events[1]['p_supersedes'] == events[0]['id']


def test_una_falla_entre_validado_y_la_primera_escritura_tambien_cierra_el_lote(database, tmp_path, monkeypatch):
    def broken_stdout(*values, **_kwargs):
        if values and str(values[0]).startswith('INICIANDO'):
            raise BrokenPipeError
    monkeypatch.setattr(run_etl, 'print', broken_stdout, raising=False)
    with pytest.raises(ETLError):
        execute(derive_lot(tmp_path / 'sin-salida'))
    events = database.batches
    assert [event['p_status'] for event in events] == ['VALIDADO', 'FALLIDO']
    assert events[1]['p_supersedes'] == events[0]['id']
    assert database.cartera_rows() == 0


def _es_ar(value):
    entero, decimales = format(value, '.2f').split('.')
    return f"{int(entero):,}".replace(',', '.') + ',' + decimales


@pytest.mark.parametrize('base', ['10000000000000', '100000000000000', '1000000000000000', '9999999999900000'])
def test_un_centavo_en_un_importe_extremo_se_actualiza_y_la_recarga_no_cambia_nada(database, tmp_path, base):
    target = object_by_case('base-valido')
    key = target['clave_agrupacion']
    others = Decimal(target['importe_actualizado']['valor']) - Decimal('13817.53')

    def lot(cents):
        amount = Decimal(f'{base}.{cents}')
        return derive_lot(tmp_path / f'importe-{cents}', cabecera_cells={(key, None, 'Deuda_Actualizada'): _es_ar(amount + others)},
                          detalle_cells={(key, '700001', 'NOTD_totalActualizado'): _es_ar(amount)}), amount + others

    first, _ = lot('01')
    second, total = lot('02')
    execute(first)
    execute(second)
    counts = database.batches[-1]['p_counts']
    assert (counts['deudas_actualizadas'], counts['filas_actualizadas']) == (1, 2)
    debtor, debts = debts_of(database, target['bien_tipo_id'], target['cuenta'])
    assert next(row for row in debts if row['external_id'] == 700001)['current_amount'] == f'{base}.02'
    assert profile_of(database, debtor)['total_debt_amount'] == format(total, 'f')
    updates = database.updates
    execute(second)
    counts = database.batches[-1]['p_counts']
    assert (counts['filas_insertadas'], counts['filas_actualizadas'], database.updates) == (0, 0, updates)


def test_un_centavo_en_el_capital_extremo_tambien_se_detecta(database, tmp_path):
    target = object_by_case('base-valido')
    key = target['clave_agrupacion']

    def lot(name, cents):
        capital = Decimal(f'100000000000000.{cents}')
        control = capital + Decimal(target['importe_capital']['valor']) - Decimal('11611.37')
        return derive_lot(tmp_path / name, cabecera_cells={(key, None, 'Deuda_Capital'): _es_ar(control)},
                          detalle_cells={(key, '700001', 'NOTD_capital'): _es_ar(capital)})

    execute(lot('primero', '01'))
    execute(lot('segundo', '02'))
    assert database.batches[-1]['p_counts']['escrituras']['debt']['actualizadas'] == 1
    _, debts = debts_of(database, target['bien_tipo_id'], target['cuenta'])
    assert next(row for row in debts if row['external_id'] == 700001)['original_amount'] == '100000000000000.02'


def test_una_misma_cifra_con_otra_escala_no_cuenta_como_cambio():
    assert load._same_value('33.30', '33.3', numeric=True) is True
    assert load._same_value('33.30', '33.31', numeric=True) is False
    assert load._same_value('33.30', '33.3') is False
    assert load._same_value('no-numero', '33.3', numeric=True) is False


def test_un_perfil_escrito_con_otra_escala_no_se_reescribe(database):
    """El texto exacto de un numeric puede traer otra escala si otro camino escribió la fila: no es un cambio."""
    database.tables['debtor_profile'].append({'id': 1, 'debtor': 7, 'total_debt_amount': '10.5', 'overdue_debt_amount': None})
    load.load_debtor_profile({'debtor': 7, 'total_debt_amount': '10.50', 'overdue_debt_amount': None, 'profile_generated_at': 'ahora'})
    assert database.updates == 0
    load.load_debtor_profile({'debtor': 7, 'total_debt_amount': '10.51', 'overdue_debt_amount': None, 'profile_generated_at': 'ahora'})
    assert database.updates == 1


def _drop_lines(path, *cells):
    lines = path.read_text(encoding='utf-8').splitlines()
    kept = [line for line in lines if not set(cells) <= set(line.split('\t'))]
    assert len(kept) < len(lines)
    path.write_text('\n'.join(kept) + '\n', encoding='utf-8')


def _sin_objeto(tmp_path):
    key = object_by_case('base-valido')['clave_agrupacion']
    lot = derive_lot(tmp_path / 'sin-objeto')
    _drop_lines(lot / 'cabecera.tsv', key)
    _drop_lines(lot / 'detalle.tsv', key)
    return lot, {'objetos': 1}


def _sin_obligacion(tmp_path):
    key = object_by_case('base-valido')['clave_agrupacion']
    lot = derive_lot(tmp_path / 'sin-obligacion', cabecera_cells={(key, None, 'Deuda_Actualizada'): '32.462,07',
                                                                  (key, None, 'Deuda_Capital'): '27.196,60'})
    _drop_lines(lot / 'detalle.tsv', key, '700001')
    return lot, {'obligaciones': 1}


def _sin_relacion(tmp_path):
    item = object_by_case('dos-personas-un-objeto')
    lot = derive_lot(tmp_path / 'sin-relacion')
    _drop_lines(lot / 'cabecera.tsv', item['clave_agrupacion'], str(item['personas'][-1]))
    return lot, {'relaciones': 1}


def _cuenta_con_ceros(tmp_path):
    # 000123 no es la cuenta 123: el objeto publicado deja de venir, aunque el otro quede en cuarentena.
    canonical = object_by_case('cuenta-canonica-123')
    lot = derive_lot(tmp_path / 'ceros', cabecera_cells={(canonical['clave_agrupacion'], None, 'Cuenta'): '000123'},
                     detalle_cells={(canonical['clave_agrupacion'], None, 'Cuenta'): '000123'})
    return lot, {'objetos': 1}


@pytest.mark.parametrize('partial', [_sin_objeto, _sin_obligacion, _sin_relacion, _cuenta_con_ceros])
def test_archivo_parcial_o_con_bajas_se_rechaza_sin_escribir(database, tmp_path, partial):
    execute(derive_lot(tmp_path / 'completo'))
    before = _portfolio(database)
    writes, updates = database.writes, database.updates
    lot, missing = partial(tmp_path)
    with pytest.raises(ETLError) as error:
        execute(lot)
    assert error.value.code == 'PARTIAL_LOAD_REJECTED'
    assert _portfolio(database) == before
    assert (database.writes, database.updates) == (writes, updates)
    event = database.batches[-1]
    assert (event['p_status'], event['p_supersedes']) == ('FALLIDO', None)
    assert event['p_counts']['faltantes'] == missing
    assert event['p_file_hashes']['detalle'] == hashlib.sha256((lot / 'detalle.tsv').read_bytes()).hexdigest()


def test_un_objeto_publicado_en_cuarentena_no_es_una_baja(database, tmp_path):
    target = object_by_case('base-valido')
    execute(derive_lot(tmp_path / 'primero'))
    before = json.dumps(debts_of(database, target['bien_tipo_id'], target['cuenta'])[1])
    execute(derive_lot(tmp_path / 'segundo', detalle_cells={(target['clave_agrupacion'], None, 'NOTD_capital'): 'sin-monto'}))
    assert database.batches[-1]['p_status'] == 'PUBLICADO'
    assert json.dumps(debts_of(database, target['bien_tipo_id'], target['cuenta'])[1]) == before


def test_lo_publicado_se_lee_entero_aunque_la_data_api_corte_antes(database, tmp_path, monkeypatch):
    execute(derive_lot(tmp_path / 'completo'))
    published = load.fetch_published_objects(1)
    total = len(database.tables['debt'])
    assert sum(len(item['obligaciones']) for item in published.values()) == total
    database.max_rows = 2
    monkeypatch.setattr(load, 'READ_IDS_PER_REQUEST', 3)
    assert len(load.fetch_all_rows('debt', 'id')) == total
    assert load.fetch_published_objects(1) == published
    database.max_rows = 1000
    monkeypatch.setattr(load, 'READ_PAGE_SIZE', 2)
    assert len(load.fetch_all_rows('debt', 'id')) == total


def test_una_lectura_invalida_no_se_confunde_con_lo_publicado(monkeypatch):
    client = Mock()
    for name in ('table', 'select', 'eq', 'in_', 'order', 'range'):
        getattr(client, name).return_value = client
    client.execute.return_value = SimpleNamespace(data={'datos': 1})
    monkeypatch.setattr(load, 'supabase', client)
    with pytest.raises(ETLError) as error:
        load.fetch_all_rows('debt', 'id', filters={'tenant': 1}, in_filter=('debtor', [1]))
    assert error.value.code == 'READ_RESPONSE_INVALID'


@pytest.mark.parametrize(('current', 'wanted', 'same'), [
    (None, None, True), (None, 0, False), (0, None, False), (None, '', False),
    (True, True, True), (True, False, False), (True, 1, False), (1, True, False),
    ('a', 'a', True), ('a', 'b', False), ('1', '1.0', False), ('0000', '0', False),
    (46279.6, '46279.60', True), (46279.6, '46279.61', False), (5, '5', True), (5, 5, True), (5, 6, False), (5, 'x', False),
])
def test_comparacion_de_valores_sin_float_ni_coerciones(current, wanted, same):
    assert load._same_value(current, wanted) is same


def test_escritura_fuera_de_una_carga_no_lleva_cuenta(database):
    load._WRITE_TALLY.set(None)
    row = load.insert_or_update_by_filters('province', {'name': 'X'}, {'name': 'X'})
    assert row['name'] == 'X'
    assert load._WRITE_TALLY.get() is None
    updated = load.insert_or_update_by_filters('province', {'name': 'X', 'active': True}, {'name': 'X'})
    assert updated['active'] is True
    assert load.write_summary({}) == {'filas_insertadas': 0, 'filas_actualizadas': 0, 'filas_sin_cambios': 0, 'escrituras': {}}


def test_cuarentena_conserva_el_estado_previo_del_objeto(database, tmp_path):
    target = object_by_case('base-valido')
    execute(derive_lot(tmp_path / 'primero'))
    before = json.dumps(debts_of(database, target['bien_tipo_id'], target['cuenta'])[1])
    execute(derive_lot(tmp_path / 'segundo',
                       detalle_cells={(target['clave_agrupacion'], None, 'NOTD_capital'): 'sin-monto'}))
    assert json.dumps(debts_of(database, target['bien_tipo_id'], target['cuenta'])[1]) == before


def test_fallo_a_mitad_de_carga_registra_fallido_sin_filtrar_datos(database, tmp_path, capsys):
    lot = derive_lot(tmp_path / 'fallo')
    database.fail_on = 'debtor_profile'
    with pytest.raises(ETLError) as error:
        execute(lot)
    assert [batch['p_status'] for batch in database.batches] == ['VALIDADO', 'FALLIDO']
    assert database.batches[1]['p_supersedes'] == database.batches[0]['id']
    salida = capsys.readouterr()
    assert 'NOMBRE_SINTETICO_A026' not in salida.out + salida.err + str(error.value)
    assert 'Persona Sint' not in salida.out + salida.err


def test_error_de_estructura_registra_fallido_con_hashes(database, tmp_path):
    lot = derive_lot(tmp_path / 'estructura', drop_detail_columns=('NOTD_vencimiento',))
    with pytest.raises(ETLError) as error:
        execute(lot)
    assert error.value.code == 'COLUMNA_OBLIGATORIA_AUSENTE'
    assert database.cartera_rows() == 0
    assert database.batches[-1]['p_status'] == 'FALLIDO'
    assert database.batches[-1]['p_counts'] == {}
    assert database.batches[-1]['p_file_hashes']['detalle']


@pytest.mark.parametrize(('status', 'body', 'code'), [
    (400, {'message': 'ROLE_NOT_ALLOWED', 'details': 'NOMBRE_SINTETICO_A026'}, 'ROLE_NOT_ALLOWED'),
    (400, {'message': 'INVALID_IMPORT_BATCH:import_batch_counts_format'}, 'INVALID_IMPORT_BATCH:import_batch_counts_format'),
    (500, {'message': 'NOMBRE_SINTETICO_A026'}, 'IMPORT_BATCH_REJECTED'),
    (403, None, 'IMPORT_BATCH_REJECTED'),
])
def test_rechazo_del_registro_detiene_la_carga_con_codigo_estable(database, tmp_path, monkeypatch, status, body, code):
    def rechazar(url, **_):
        return httpx.Response(status, json=body, request=httpx.Request('POST', url))

    monkeypatch.setattr(load.httpx, 'post', rechazar)
    with pytest.raises(ETLError) as error:
        execute(derive_lot(tmp_path / 'rechazo'))
    assert error.value.code == code
    assert 'NOMBRE_SINTETICO_A026' not in str(error.value)
    assert database.cartera_rows() == 0


# ---------------------------------------------------------------- guardias de la CLI


@pytest.mark.parametrize(('missing', 'code'), [
    ('EQUITAS_IMPORT_SERVER_JWT', 'IMPORT_CREDENTIAL_MISSING'),
    ('SUPABASE_ANON_KEY', 'IMPORT_CREDENTIAL_MISSING'),
    ('EQUITAS_IMPORT_ACTOR_USER', 'IMPORT_ACTOR_INVALID'),
])
def test_execute_exige_credencial_de_importacion_antes_de_leer(database, monkeypatch, tmp_path, missing, code):
    monkeypatch.delenv(missing)
    with pytest.raises(ETLError) as error:
        execute(tmp_path / 'inexistente')
    assert error.value.code == code
    assert database.batches == []


def test_execute_rechaza_actor_no_canonico(database, monkeypatch, tmp_path):
    monkeypatch.setenv('EQUITAS_IMPORT_ACTOR_USER', '007')
    with pytest.raises(ETLError) as error:
        execute(tmp_path / 'inexistente')
    assert error.value.code == 'IMPORT_ACTOR_INVALID'


def test_execute_exige_corte_antes_de_leer_archivos(database, tmp_path):
    with pytest.raises(ETLError) as error:
        run_etl.run_etl(str(tmp_path / 'inexistente'), execute=True)
    assert error.value.code == 'CUT_OFF_REQUIRED'
    assert database.batches == []


@pytest.mark.parametrize('execute_flag', [True, False])
@pytest.mark.parametrize('partial', [{'limit_objects': 2}, {'priority_tipo_ingreso_ids': [801]}])
def test_lote_con_corte_rechaza_subconjuntos(database, tmp_path, execute_flag, partial):
    lot = derive_lot(tmp_path / 'parcial')
    with pytest.raises(ETLError) as error:
        run_etl.run_etl(str(lot), execute=execute_flag, cut_off=AS_OF, **partial)
    assert error.value.code == 'PARTIAL_LOAD_REJECTED'
    assert database.cartera_rows() == 0 and database.batches == []


@pytest.mark.parametrize(('cut_off', 'code'), [('30/09/2026', 'CORTE_INVALIDO'), ('2026-02-30', 'CORTE_INVALIDO'),
                                               ('2026-10-01', 'CONFIGURACION_INVALIDA')])
def test_corte_ilegible_o_distinto_del_declarado_se_rechaza(database, tmp_path, cut_off, code):
    with pytest.raises(ETLError) as error:
        execute(derive_lot(tmp_path / 'corte'), cut_off=cut_off)
    assert error.value.code == code
    assert database.cartera_rows() == 0


def test_lote_sin_manifiesto_exige_perfil(database, tmp_path):
    lot = derive_lot(tmp_path / 'sin-manifiesto')
    (lot / 'manifest.json').unlink()
    with pytest.raises(ETLError) as error:
        execute(lot)
    assert error.value.code == 'JSON_NO_LEIBLE'


def test_archivo_ausente_no_registra_lote(database, tmp_path):
    lot = derive_lot(tmp_path / 'ausente')
    (lot / 'detalle.tsv').unlink()
    with pytest.raises(ETLError) as error:
        execute(lot)
    assert error.value.code == 'ARCHIVO_NO_LEIBLE'
    assert database.batches == []


def test_archivo_que_cambia_durante_la_lectura_se_rechaza(database, tmp_path, monkeypatch):
    lot = derive_lot(tmp_path / 'cambia')
    original = transform.read_source_tables

    def leer_y_alterar(files, mapping, *, contract=None):
        tables = original(files, mapping, contract=contract)
        with (lot / 'detalle.tsv').open('a', encoding='utf-8') as stream:
            stream.write('\n')
        return tables

    monkeypatch.setattr(transform, 'read_source_tables', leer_y_alterar)
    with pytest.raises(ETLError) as error:
        execute(lot)
    assert error.value.code == 'SOURCE_CHANGED_DURING_READ'
    assert database.cartera_rows() == 0


def test_dry_run_con_corte_valida_sin_escribir_ni_exigir_credenciales(monkeypatch, tmp_path, capsys):
    entorno_vacio(monkeypatch, tmp_path)
    lot = derive_lot(tmp_path / 'seco')
    run_etl.run_etl(str(lot), cut_off=AS_OF)
    salida = capsys.readouterr()
    assert 'Resultado del lote: VALIDADO' in salida.out and 'DRY-RUN FINALIZADO' in salida.out
    assert 'Persona Sint' not in salida.out + salida.err
    assert '700001' not in salida.out


def test_dry_run_de_un_lote_bloqueado_termina_con_codigo(monkeypatch, tmp_path, capsys):
    entorno_vacio(monkeypatch, tmp_path)
    monkeypatch.setattr(sys, 'argv', ['etl', '--folder', str(FIXTURE), '--cut-off', AS_OF])
    with pytest.raises(SystemExit) as exit_info:
        run_etl.main()
    assert exit_info.value.code == 1
    salida = capsys.readouterr()
    assert 'Resultado del lote: BLOQUEADO' in salida.out
    assert 'codigo=BATCH_BLOCKED' in salida.err
    assert 'Persona Sint' not in salida.out + salida.err


def test_cli_execute_sin_corte_termina_con_codigo(database, monkeypatch, capsys, tmp_path):
    monkeypatch.setattr(sys, 'argv', ['etl', '--execute', '--folder', str(tmp_path)])
    with pytest.raises(SystemExit) as exit_info:
        run_etl.main()
    assert exit_info.value.code == 1
    assert 'codigo=CUT_OFF_REQUIRED' in capsys.readouterr().err


def test_cli_execute_con_perfil_explicito_publica(database, monkeypatch, capsys, tmp_path):
    monkeypatch.setattr(sys, 'argv', ['etl', '--execute', '--folder', str(MUNICIPIO_B), '--cut-off', AS_OF,
                                      '--mapping', str(municipio_b_mapping(tmp_path))])
    run_etl.main()
    assert 'CARGA FINALIZADA' in capsys.readouterr().out
    assert [batch['p_status'] for batch in database.batches] == ['VALIDADO', 'PUBLICADO']


def test_ningun_archivo_de_produccion_usa_el_reloj_para_edades_o_estado():
    source = (Path(run_etl.__file__).parent / 'transform.py').read_text(encoding='utf-8')
    assert 'date.today' not in source
    assert 'average_total_debt_amount' not in source
    assert 'average_total_debt_amount' not in Path(run_etl.__file__).read_text(encoding='utf-8')
