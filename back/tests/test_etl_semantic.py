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
from datetime import date
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from oracle_lots import (
    AS_OF,
    FIXTURE,
    MUNICIPIO_B,
    accepted_objects,
    derive_lot,
    municipio_b_mapping,
    object_by_case,
    oracle,
    persisted_mismatches,
    synthetic_profile,
)

from ETL import config, load, run_etl, transform
from ETL.config import ETLError

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
        self.database, self.table, self.filters, self.action = database, table, [], ('select', None)

    def select(self, _columns):
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
            self.database.check(self.table, payload)
            for row in matches:
                row.update(json.loads(json.dumps(payload)))
            return SimpleNamespace(data=[dict(row) for row in matches])
        return SimpleNamespace(data=[dict(row) for row in matches])


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
        self.writes = 0
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
        self.next_id += 1
        self.batches.append({**body, 'id': self.next_id})
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
        debtor_id=9, cut_off=date(2026, 9, 30), state_catalogs={'NOTD_ESTA_id': {'10': 'PENDIENTE'}}, currency_code='ARS',
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
