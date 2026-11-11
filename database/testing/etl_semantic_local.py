"""ALIGN-026. Archivo → base local → perfil, contra el oráculo independiente. Solo stdlib y back/tests/oracle_lots.py.

Ejecuta la CLI real (python -m ETL.run_etl) y lee lo persistido por la Data API local. Publica solo casos,
códigos y conteos. Requiere el stack local con db reset, etl-compat-catalogs.sql y etl-import-actor.sql
(SUPABASE_TESTING_CALIDAD.md) y deja filas: al terminar corresponde db reset.

  sintetico    fixture completa (bloqueada), lote validado, recarga, cuarentenas, credencial y actor rechazados,
               estados ausentes o catalogados, documentos, y las filas leídas de la base hasta el mapeador del frontend
  municipio-b  lote del municipio B con perfil explícito, sobre una base recién reconstruida
"""
import argparse
import copy
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'back' / 'tests'), str(Path(__file__).resolve().parent)]

from case_review_local import SERVER_ROLES, Api, load_local_env, server_claims, sign_jwt
from oracle_lots import (
    AS_OF,
    FIXTURE,
    MUNICIPIO_B,
    accepted_objects,
    accepted_with_altered,
    debt_ids,
    derive_lot,
    municipio_b_mapping,
    object_by_case,
    oracle,
    persisted_mismatches,
    synthetic_profile,
    to_iso_dates,
)

ACTOR_EMAIL = 'importador-etl@example.invalid'
PORTFOLIO = ('person', 'debtor', 'debt', 'debtor_person', 'debtor_contact', 'debtor_profile', 'debtor_profile_detail',
             'address', 'city', 'province')
CATALOG_TABLES = {'debt_status': 'key', 'debtor_type': 'key', 'document_type': 'key', 'person_type': 'key',
                  'person_status': 'key', 'contact_type': 'key', 'currency': 'code'}
STATE_LABELS = {'OVERDUE': 'vencida', 'ACTIVE': 'vigente', 'PAID': 'pagada', 'CANCELLED': 'anulada',
                'SUSPENDED': 'suspendida', 'UNKNOWN': 'unknown'}
NO_OBSERVADO = 'NO_INFORMADO_EN_ORIGEN'
MAPPER_CONFIG = Path(__file__).resolve().parent / 'etl-persisted-mapper.vitest.config.mjs'
QUARANTINE_CASES = ('cuenta-alfanumerica', 'importe-no-numerico', 'fecha-imposible', 'tipo-ingreso-fuera-de-catalogo',
                    'tipo-bien-fuera-de-catalogo', 'conciliacion-diferente', 'duplicado-conflictivo')


class Checks:
    def __init__(self):
        self.failed = 0
        self.total = 0

    def expect(self, case, expected, obtained):
        ok = str(expected) == str(obtained)
        self.total += 1
        self.failed += not ok
        print(f"{case}|{expected}|{obtained}|{'OK' if ok else 'FALLA'}", flush=True)

    def finish(self):
        print(f'TOTAL|{self.total}|FALLAS|{self.failed}')
        return 1 if self.failed else 0


class Local:
    def __init__(self):
        self.env = load_local_env()
        self.api = Api(self.env)
        self.service = self.env['SERVICE_ROLE_KEY']
        self.import_jwt = sign_jwt(self.env['JWT_SECRET'], server_claims(SERVER_ROLES[1], 1))

    def wait_for_rest(self, seconds=120):
        """Tras db reset, PostgREST puede responder PGRST002 hasta cargar su caché de esquema."""
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if self.api.call('GET', '/rest/v1/debtor?select=id&limit=1', self.service, apikey=self.service)[0] == 200:
                return
            time.sleep(2)
        sys.exit('DETENERSE: la Data API local no respondió 200')

    def rows(self, table, select='*'):
        status, rows = self.api.call('GET', f'/rest/v1/{table}?select={select}&order=id', self.service, apikey=self.service)
        if status != 200:
            sys.exit(f'DETENERSE: lectura de {table} http-{status}')
        return rows

    def tables(self):
        return {name: self.rows(name) for name in PORTFOLIO}

    def catalogs(self):
        return {table: {row[column]: row['id'] for row in self.rows(table, f'id,{column}')}
                for table, column in CATALOG_TABLES.items()}

    def actor(self):
        status, rows = self.api.call('GET', f'/rest/v1/user?select=id&email=eq.{ACTOR_EMAIL}', self.service, apikey=self.service)
        if status != 200 or len(rows) != 1:
            sys.exit('DETENERSE: falta database/testing/etl-import-actor.sql')
        return rows[0]['id']

    def etl(self, folder, *extra, jwt=None, actor=None):
        """Corre la CLI en un proceso nuevo. Las claves viajan solo por su entorno, nunca por argumentos."""
        env = {name: value for name, value in os.environ.items() if not name.startswith(('SUPABASE_', 'EQUITAS_'))}
        env.update(EQUITAS_TARGET_ENV='local', SUPABASE_URL=self.env['API_URL'], SUPABASE_SERVICE_ROLE_KEY=self.service,
                   SUPABASE_ANON_KEY=self.env['ANON_KEY'], EQUITAS_IMPORT_SERVER_JWT=jwt or self.import_jwt,
                   EQUITAS_IMPORT_ACTOR_USER=str(actor or self.actor()))
        return subprocess.run([str(ROOT / 'back/.venv/bin/python'), '-m', 'ETL.run_etl', '--folder', str(folder),
                               '--execute', '--cut-off', AS_OF, *extra],
                              cwd=ROOT / 'back', env=env, capture_output=True, text=True, check=False)


def error_code(result):
    return next((part.split('=', 1)[1] for part in result.stderr.split() if part.startswith('codigo=')), 'sin-codigo')


def line_value(result, label):
    return next((line.split(':', 1)[1].strip() for line in result.stdout.splitlines() if line.startswith(label)), 'sin-dato')


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def portfolio_rows(local):
    return sum(len(rows) for rows in local.tables().values())


def check_rejected_credentials(local, checks, folder):
    result = local.etl(folder, jwt=local.service)
    checks.expect('la clave general no registra lotes: salida', 1, result.returncode)
    checks.expect('la clave general no registra lotes: código', 'IMPORT_BATCH_REJECTED', error_code(result))
    checks.expect('la clave general no registra lotes: filas', 0, portfolio_rows(local))
    result = local.etl(folder, actor=999999999)
    checks.expect('actor sin membresía: código', 'ACTOR_NOT_ACTIVE_MEMBER', error_code(result))
    checks.expect('actor sin membresía: filas', 0, portfolio_rows(local))


def check_blocked(local, checks):
    result = local.etl(FIXTURE)
    checks.expect('fixture completa: salida', 1, result.returncode)
    checks.expect('fixture completa: código', 'BATCH_BLOCKED', error_code(result))
    checks.expect('fixture completa: resultado', 'BLOQUEADO', line_value(result, 'Resultado del lote'))
    checks.expect('fixture completa: filas de cartera', 0, portfolio_rows(local))
    batches = local.rows('import_batch', 'id,status,as_of,counts,file_hashes')
    checks.expect('fixture completa: eventos', 'FALLIDO', ','.join(row['status'] for row in batches))
    counts = batches[-1]['counts']
    for name, value in oracle()['conteos'].items():
        checks.expect(f'fixture completa: conteo {name}', value, counts.get(name))
    checks.expect('fixture completa: importe aceptado', 251923614, counts.get('importe_aceptado_centavos'))
    checks.expect('fixture completa: hash detalle', sha256(FIXTURE / 'detalle.tsv'), batches[-1]['file_hashes']['detalle'])


def check_validated(local, checks, work):
    lot = derive_lot(work / 'validado', ('cuenta-ceros-izquierda',))
    before = len(local.rows('import_batch', 'id'))
    result = local.etl(lot)
    checks.expect('lote validado: salida', 0, result.returncode)
    checks.expect('lote validado: resultado', 'VALIDADO', line_value(result, 'Resultado del lote'))
    catalogs = local.catalogs()
    problems = persisted_mismatches(local.tables(), accepted_objects(), catalogs, lot)
    for problem in problems:
        print(f'DIFERENCIA|{problem}')
    checks.expect('lote validado: diferencias con el oráculo', 0, len(problems))
    events = local.rows('import_batch', 'id,status,as_of,source_updated_at,rules_version,counts,file_hashes,supersedes,created_by_role')[before:]
    checks.expect('lote validado: eventos', 'VALIDADO,PUBLICADO', ','.join(row['status'] for row in events))
    checks.expect('lote validado: cadena', events[0]['id'], events[1]['supersedes'])
    for row in events:
        checks.expect('lote validado: corte', AS_OF, row['as_of'])
        checks.expect('lote validado: actualización de origen', '2026-09-29', row['source_updated_at'])
        checks.expect('lote validado: versión de reglas', '1.0.0', row['rules_version'])
        checks.expect('lote validado: rol', 'importador_sistema', row['created_by_role'])
        checks.expect('lote validado: hash cabecera', sha256(lot / 'cabecera.tsv'), row['file_hashes']['cabecera'])
        checks.expect('lote validado: hash detalle', sha256(lot / 'detalle.tsv'), row['file_hashes']['detalle'])
    check_collapse(local, checks, catalogs)
    check_states(local, checks, catalogs)
    check_reload(local, checks, lot, catalogs)
    return lot, catalogs


def check_collapse(local, checks, catalogs):
    canonical = object_by_case('cuenta-canonica-123')
    debtors = [row for row in local.rows('debtor')
               if row['type'] == catalogs['debtor_type']['RODADO'] and row['external_id'] == 123]
    checks.expect('000123 no colapsa con 123: objetos', 1, len(debtors))
    debts = [row for row in local.rows('debt') if row['debtor'] == debtors[0]['id']]
    checks.expect('000123 no colapsa con 123: obligaciones', canonical['obligaciones'], len(debts))
    persons = {row['external_id'] for row in local.rows('person')}
    excluded = object_by_case('cuenta-ceros-izquierda')['personas'][0]
    checks.expect('000123 en cuarentena: persona ausente', False, excluded in persons)


def check_states(local, checks, catalogs):
    expected = object_by_case('estados-origen-vencimiento-viejo')
    type_id = catalogs['debtor_type']['AGUA']
    debtor = next(row for row in local.rows('debtor') if row['type'] == type_id and str(row['external_id']) == expected['cuenta'])
    names = {identifier: key for key, identifier in catalogs['debt_status'].items()}
    states = sorted(names[row['status']] for row in local.rows('debt') if row['debtor'] == debtor['id'])
    checks.expect('estado suspendido y demás al corte', 'CANCELLED,OVERDUE,PAID,SUSPENDED,UNKNOWN', ','.join(states))
    zero = object_by_case('importe-cero')
    zero_type = catalogs['debtor_type']['AGUA']
    target = next(row for row in local.rows('debtor') if row['type'] == zero_type and str(row['external_id']) == zero['cuenta'])
    amounts = [row['current_amount'] for row in local.rows('debt') if row['debtor'] == target['id']]
    checks.expect('cero válido observado', True, any(amount == 0 for amount in amounts))
    types = {row['document_type'] for row in local.rows('person')}
    checks.expect('documento sintético no forzado a CUIT', {catalogs['document_type']['UNKNOWN']}, types)


def snapshot(local, table):
    return json.dumps(local.rows(table), sort_keys=True)


def check_reload(local, checks, lot, catalogs):
    debts = snapshot(local, 'debt')
    result = local.etl(lot)
    checks.expect('recarga: salida', 0, result.returncode)
    checks.expect('recarga: deudas insertadas', 0, line_value(result, 'Deudas insertadas'))
    checks.expect('recarga: deudas actualizadas', 0, line_value(result, 'Deudas actualizadas'))
    checks.expect('recarga: deudas sin cambio', True, debts == snapshot(local, 'debt'))
    checks.expect('recarga: diferencias con el oráculo', 0, len(persisted_mismatches(local.tables(), accepted_objects(), catalogs, lot)))


def check_quarantines(local, checks, work, catalogs):
    for case in QUARANTINE_CASES:
        expected = object_by_case(case)
        lot = derive_lot(work / case, (case,))
        debts = snapshot(local, 'debt')
        result = local.etl(lot)
        checks.expect(f'{case}: salida', 0, result.returncode)
        checks.expect(f'{case}: objetos en cuarentena', 1, line_value(result, 'objetos_en_cuarentena'))
        checks.expect(f'{case}: persona ausente', False, expected['personas'][0] in {row['external_id'] for row in local.rows('person')})
        checks.expect(f'{case}: sin cambios en deudas', True, debts == snapshot(local, 'debt'))
        checks.expect(f'{case}: diferencias con el oráculo', 0, len(persisted_mismatches(local.tables(), accepted_objects(), catalogs, lot)))


def check_previous_state(local, checks, work):
    target = object_by_case('base-valido')
    before = snapshot(local, 'debt')
    lot = derive_lot(work / 'previo', detalle_cells={(target['clave_agrupacion'], None, 'NOTD_capital'): 'sin-monto'})
    result = local.etl(lot)
    checks.expect('cuarentena conserva el estado previo: salida', 0, result.returncode)
    checks.expect('cuarentena conserva el estado previo', True, before == snapshot(local, 'debt'))


def check_amount_change(local, checks, work, catalogs):
    """Corrección por reimportación: importe nuevo, exacto, sin tocar los demás objetos."""
    target = object_by_case('base-valido')
    key = target['clave_agrupacion']
    lot = derive_lot(work / 'cambio', cabecera_cells={(key, None, 'Deuda_Actualizada'): '46.279,61'},
                     detalle_cells={(key, '700001', 'NOTD_totalActualizado'): '13.817,54'})
    before = {row['id']: copy.deepcopy(row) for row in local.rows('debt')}
    result = local.etl(lot)
    checks.expect('reimportación con un centavo más: salida', 0, result.returncode)
    checks.expect('reimportación con un centavo más: actualizadas', 1, line_value(result, 'Deudas actualizadas'))
    changed = [row for row in local.rows('debt') if before[row['id']] != row]
    checks.expect('reimportación con un centavo más: filas distintas', 1, len(changed))
    checks.expect('reimportación con un centavo más: importe', 13817.54, changed[0]['current_amount'])
    debtor = next(row for row in local.rows('debtor') if row['type'] == catalogs['debtor_type']['RODADO'] and row['external_id'] == int(target['cuenta']))
    profile = next(row for row in local.rows('debtor_profile') if row['debtor'] == debtor['id'])
    checks.expect('reimportación con un centavo más: perfil', 46279.61, profile['total_debt_amount'])


def debtor_of(local, catalogs, case):
    item = object_by_case(case)
    type_id = catalogs['debtor_type'][{'1': 'INMUEBLE', '3': 'RODADO', '6': 'AGUA'}[item['bien_tipo_id']]]
    return next(row for row in local.rows('debtor') if row['type'] == type_id and str(row['external_id']) == item['cuenta'])


def profile_of(local, debtor):
    return next(row for row in local.rows('debtor_profile') if row['debtor'] == debtor['id'])


def check_states_match_batch(local, checks, catalogs, label):
    names = {identifier: key for key, identifier in catalogs['debt_status'].items()}
    persisted = {}
    for row in local.rows('debt', 'id,status'):
        name = STATE_LABELS[names[row['status']]]
        persisted[name] = persisted.get(name, 0) + 1
    published = [row for row in local.rows('import_batch', 'id,status,counts') if row['status'] == 'PUBLICADO'][-1]
    checks.expect(f'{label}: estados de debt = conteos del lote', dict(sorted(published['counts']['estados_al_corte'].items())), dict(sorted(persisted.items())))


def check_oracle(local, checks, catalogs, label, lot, expected, state_catalogs=None):
    problems = persisted_mismatches(local.tables(), expected, catalogs, lot, state_catalogs=state_catalogs)
    for problem in problems:
        print(f'DIFERENCIA|{label}|{problem}')
    checks.expect(f'{label}: diferencias con el oráculo', 0, len(problems))


def check_absent_states(local, checks, work, catalogs):
    """B1: la ausencia de estado no se publica como cero de deuda vencida, después de persistir."""
    case = 'base-valido'
    target = object_by_case(case)
    lot = derive_lot(work / 'sin-estados', detalle_cells={(target['clave_agrupacion'], None, 'NOTD_ESTA_id'): ''})
    checks.expect('sin estados: salida', 0, local.etl(lot).returncode)
    profile = profile_of(local, debtor_of(local, catalogs, case))
    checks.expect('sin estados: importe vencido', None, profile['overdue_debt_amount'])
    checks.expect('sin estados: conteo vencido', None, profile['overdue_debt_count'])
    checks.expect('sin estados: antigüedad', None, profile['oldest_debt_days'])
    checks.expect('sin estados: obligaciones sin estado', target['obligaciones'], profile['debt_state_not_observed_count'])
    checks.expect('sin estados: total conservado', float(target['importe_actualizado']['valor']), profile['total_debt_amount'])
    check_oracle(local, checks, catalogs, 'sin estados', lot, accepted_with_altered((case,), lot))
    check_states_match_batch(local, checks, catalogs, 'sin estados')
    mixed = object_by_case('estados-origen-vencimiento-viejo')
    profile = profile_of(local, debtor_of(local, catalogs, 'estados-origen-vencimiento-viejo'))
    checks.expect('mixto: oráculo incompleto', False, mixed['dias_vencida_mas_antigua']['completo'])
    checks.expect('mixto: antigüedad del oráculo', mixed['dias_vencida_mas_antigua']['valor'], profile['oldest_debt_days'])
    checks.expect('mixto: conteo vencido observado', 1, profile['overdue_debt_count'])
    checks.expect('mixto: obligaciones sin estado', 1, profile['debt_state_not_observed_count'])
    lot = derive_lot(work / 'sin-columnas', drop_detail_columns=('NOTD_ESTA_id', 'NOTD_SITU_id'))
    checks.expect('sin columnas de estado: salida', 0, local.etl(lot).returncode)
    profiles = local.rows('debtor_profile')
    checks.expect('sin columnas de estado: ceros de vencido con obligaciones', 0,
                  sum(row['debt_count'] > 0 and row['overdue_debt_amount'] is not None for row in profiles))
    empty = profile_of(local, debtor_of(local, catalogs, 'cabecera-sin-detalle'))
    checks.expect('sin obligaciones: importe vencido es cero derivado', 0.0, float(empty['overdue_debt_amount']))
    checks.expect('sin obligaciones: conteo y sin faltantes', (0, 0), (empty['overdue_debt_count'], empty['debt_state_not_observed_count']))


def check_catalogued_words(local, checks, work, catalogs):
    """B2: un código catalogado se conserva aunque se lea como una palabra de nulo."""
    target = object_by_case('base-valido')
    key = target['clave_agrupacion']
    base = json.loads(synthetic_profile(work).read_text(encoding='utf-8'))['catalogos']
    for code in ('null', 'None', 'NaN'):
        folder = work / f'palabra-{code}'
        folder.mkdir()
        catalogos = copy.deepcopy(base)
        catalogos['NOTD_ESTA_id'][code] = 'SUSPENDIDA'
        catalogos['Tipo_Ingreso_Id'][code] = 'tributo sintetico'
        catalogos['Bien_Tipo_Id'][code] = 'RODADO'
        lot = derive_lot(folder / 'lote', cabecera_cells={(key, None, 'Bien_Tipo_Id'): code},
                         detalle_cells={(key, None, 'NOTD_ESTA_id'): code, (key, None, 'Tipo_Ingreso_Id'): code, (key, None, 'Bien_Tipo_Id'): code})
        result = local.etl(lot, '--mapping', str(synthetic_profile(folder, catalogos=catalogos)))
        checks.expect(f'estado {code}: salida', 0, result.returncode)
        names = {identifier: name for name, identifier in catalogs['debt_status'].items()}
        debtor = debtor_of(local, catalogs, 'base-valido')
        debts = [row for row in local.rows('debt') if row['debtor'] == debtor['id']]
        checks.expect(f'estado {code}: persistido', {'SUSPENDED'}, {names[row['status']] for row in debts})
        checks.expect(f'estado {code}: tributo', {f'unknown_{code}'}, {row['type'] for row in debts})
        check_states_match_batch(local, checks, catalogs, f'estado {code}')
        states = {name: catalogos[name] for name in ('NOTD_ESTA_id', 'NOTD_SITU_id')}
        check_oracle(local, checks, catalogs, f'estado {code}', lot, accepted_with_altered(('base-valido',), lot, states), states)


def check_documents(local, checks, work, catalogs):
    """B3: documento y persona se clasifican mirando el valor tal como llegó."""
    target = object_by_case('base-valido')
    cases = (('ABC20-00000000-1XYZ', 'UNKNOWN', 'UNKNOWN'), ('20-0000X0000-1', 'UNKNOWN', 'UNKNOWN'), ('20.00000000.1', 'UNKNOWN', 'UNKNOWN'),
             ('２０-００００００００-１', 'UNKNOWN', 'UNKNOWN'), ('20-00000000-9', 'UNKNOWN', 'UNKNOWN'),
             ('20-00000000-1', 'CUIT', 'INDIVIDUAL'), ('20000000001', 'CUIT', 'INDIVIDUAL'), ('30-00000000-7', 'CUIT', 'LEGAL_PERSON'))
    for index, (document, document_type, person_type) in enumerate(cases):
        lot = derive_lot(work / f'documento-{index}', cabecera_cells={(target['clave_agrupacion'], None, 'Destinatario_CUIT'): document})
        checks.expect(f'documento {index}: salida', 0, local.etl(lot).returncode)
        person = next(row for row in local.rows('person') if row['external_id'] == target['personas'][0])
        checks.expect(f'documento {index}: tipo', catalogs['document_type'][document_type], person['document_type'])
        checks.expect(f'documento {index}: persona', catalogs['person_type'][person_type], person['type'])
        checks.expect(f'documento {index}: valor conservado', True, person['document_number'] == document)


def check_same_family(local, checks, work, catalogs):
    """Otros agregados sin insumos y otras divergencias entre validador y publicador."""
    lot = derive_lot(work / 'sin-contactos', drop_header_columns=('Destinatario_Email', 'Destinatario_Telefono', 'Destinatario_Celular'))
    checks.expect('sin columnas de contacto: salida', 0, local.etl(lot).returncode)
    checks.expect('sin columnas de contacto: conteo', {None}, {row['available_contact_count'] for row in local.rows('debtor_profile')})
    profiles = local.rows('debtor_profile')
    checks.expect('gestiones sin fuente: nulas', {None}, {row['previous_contact_count'] for row in profiles} | {row['previous_response_count'] for row in profiles})
    keys = {item['clave_agrupacion'] for item in accepted_objects()}
    lot = derive_lot(work / 'iso', cabecera_cells={(key, None, 'Fecha_Actualizacion'): '2999-01-01' for key in keys})
    to_iso_dates(lot)
    formato = json.loads(synthetic_profile(work).read_text(encoding='utf-8'))['formato']
    result = local.etl(lot, '--mapping', str(synthetic_profile(work, formato={**formato, 'fecha': 'aaaa-mm-dd'})))
    checks.expect('centinela en lote ISO: salida', 0, result.returncode)
    event = local.rows('import_batch', 'id,status,source_updated_at')[-1]
    checks.expect('centinela en lote ISO: evento', ('PUBLICADO', None), (event['status'], event['source_updated_at']))
    word = object_by_case('base-valido')
    lot = derive_lot(work / 'texto', cabecera_cells={(word['clave_agrupacion'], None, 'Destinatario'): 'null', (word['clave_agrupacion'], None, 'Identificador'): 'NaN'})
    checks.expect('texto con palabra de nulo: salida', 0, local.etl(lot).returncode)
    person = next(row for row in local.rows('person') if row['external_id'] == word['personas'][0])
    checks.expect('texto con palabra de nulo: persona', 'null', person['full_name'])
    checks.expect('texto con palabra de nulo: objeto', 'NaN', debtor_of(local, catalogs, 'base-valido')['identifier'])


def check_restore(local, checks, work, catalogs):
    lot = derive_lot(work / 'restaurado', ('cuenta-ceros-izquierda',))
    checks.expect('restauración: salida', 0, local.etl(lot).returncode)
    check_oracle(local, checks, catalogs, 'restauración', lot, accepted_objects())
    check_states_match_batch(local, checks, catalogs, 'restauración')


def overdue_metric(value, missing=0):
    presence = 'OBSERVADO' if value is not None else NO_OBSERVADO
    return {'value': value, 'presence': presence, 'missing': {NO_OBSERVADO: missing} if missing else {}}


def check_mapper_chain(local, checks, work, catalogs):
    """Archivo → base → perfil → mapeador: el frontend recibe filas leídas de la base por la Data API."""
    base = object_by_case('base-valido')
    pending = debt_ids('dos-personas-un-objeto')
    paid = object_by_case('misma-cuenta-otro-tipo')
    pair = object_by_case('dos-personas-un-objeto')
    lot = derive_lot(work / 'mapeador', detalle_cells={
        (base['clave_agrupacion'], None, 'NOTD_ESTA_id'): '',
        (paid['clave_agrupacion'], None, 'NOTD_ESTA_id'): '20',
        (pair['clave_agrupacion'], pending[0], 'NOTD_ESTA_id'): '',
        (pair['clave_agrupacion'], pending[1], 'NOTD_vencimiento'): '30/09/2026',
    })
    checks.expect('mapeador: salida de la carga', 0, local.etl(lot).returncode)
    mixed = debtor_of(local, catalogs, 'estados-origen-vencimiento-viejo')
    mixed_amount = profile_of(local, mixed)['overdue_debt_amount']
    expected = [
        {'caso': 'sin ningún estado observado', 'debtor': debtor_of(local, catalogs, 'base-valido')['id'],
         'overdue': overdue_metric(None, base['obligaciones']), 'delay': NO_OBSERVADO},
        {'caso': 'mixto con vencidas observadas', 'debtor': mixed['id'], 'overdue': overdue_metric(mixed_amount, 1), 'delay': NO_OBSERVADO},
        {'caso': 'estado faltante sin vencidas observadas', 'debtor': debtor_of(local, catalogs, 'dos-personas-un-objeto')['id'],
         'overdue': overdue_metric(None, 1), 'delay': NO_OBSERVADO},
        {'caso': 'todos observados sin vencidas', 'debtor': debtor_of(local, catalogs, 'misma-cuenta-otro-tipo')['id'],
         'overdue': overdue_metric(0), 'delay': 'NO_APLICA'},
        {'caso': 'sin obligaciones', 'debtor': debtor_of(local, catalogs, 'cabecera-sin-detalle')['id'],
         'overdue': overdue_metric(0), 'delay': 'NO_APLICA'},
    ]
    raw = {'batch': {'as_of': AS_OF}, 'warnings': [], 'debtors': local.rows('debtor'), 'debtorTypes': local.rows('debtor_type'),
           'debts': local.rows('debt'), 'debtStatuses': local.rows('debt_status'), 'debtorPeople': local.rows('debtor_person'),
           'people': local.rows('person'), 'debtorContacts': local.rows('debtor_contact'), 'debtorProfiles': local.rows('debtor_profile')}
    rows = work / 'filas-persistidas.json'
    rows.write_text(json.dumps({'raw': raw, 'expected': expected}, ensure_ascii=False), encoding='utf-8')
    result = subprocess.run([str(ROOT / 'front/node_modules/.bin/vitest'), 'run', '--config', str(MAPPER_CONFIG)],
                            cwd=ROOT / 'front', env={**os.environ, 'EQUITAS_ETL_PERSISTED_ROWS': str(rows)},
                            capture_output=True, text=True, check=False)
    for line in result.stdout.splitlines():
        if any(mark in line for mark in ('Tests ', 'Test Files', 'FAIL', 'AssertionError', 'Error:')):
            print(f'MAPEADOR|{line.strip()}')
    checks.expect('mapeador: filas persistidas', 0, result.returncode)


def stage_sintetico(local, checks):
    with tempfile.TemporaryDirectory(prefix='a026-') as name:
        work = Path(name)
        check_rejected_credentials(local, checks, derive_lot(work / 'credenciales'))
        check_blocked(local, checks)
        _, catalogs = check_validated(local, checks, work)
        check_states_match_batch(local, checks, catalogs, 'lote validado')
        check_quarantines(local, checks, work, catalogs)
        check_previous_state(local, checks, work)
        check_amount_change(local, checks, work, catalogs)
        check_absent_states(local, checks, work, catalogs)
        check_catalogued_words(local, checks, work, catalogs)
        check_documents(local, checks, work, catalogs)
        check_same_family(local, checks, work, catalogs)
        check_restore(local, checks, work, catalogs)
        check_mapper_chain(local, checks, work, catalogs)


def stage_municipio_b(local, checks):
    with tempfile.TemporaryDirectory(prefix='a026-') as name:
        work = Path(name)
        shutil.copytree(MUNICIPIO_B, work / 'b')
        result = local.etl(work / 'b', '--mapping', str(municipio_b_mapping(work)))
        checks.expect('municipio B: salida', 0, result.returncode)
        checks.expect('municipio B: resultado', 'VALIDADO', line_value(result, 'Resultado del lote'))
        problems = persisted_mismatches(local.tables(), oracle('municipio-sintetico-b')['objetos'], local.catalogs(), work / 'b')
        for problem in problems:
            print(f'DIFERENCIA|{problem}')
        checks.expect('municipio B: diferencias con el oráculo', 0, len(problems))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('stage', choices=('sintetico', 'municipio-b'))
    args = parser.parse_args()
    checks = Checks()
    local = Local()
    local.wait_for_rest()
    if args.stage == 'sintetico':
        stage_sintetico(local, checks)
    else:
        stage_municipio_b(local, checks)
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
