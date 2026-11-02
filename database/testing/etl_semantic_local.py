"""ALIGN-026. Archivo → base local → perfil, contra el oráculo independiente. Solo stdlib y back/tests/oracle_lots.py.

Ejecuta la CLI real (python -m ETL.run_etl) y lee lo persistido por la Data API local. Publica solo casos,
códigos y conteos. Requiere el stack local con db reset, etl-compat-catalogs.sql y etl-import-actor.sql
(SUPABASE_TESTING_CALIDAD.md) y deja filas: al terminar corresponde db reset.

  sintetico    fixture completa (bloqueada), lote validado, recarga, cuarentenas, credencial y actor rechazados
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
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'back' / 'tests'), str(Path(__file__).resolve().parent)]

from case_review_local import SERVER_ROLES, Api, load_local_env, server_claims, sign_jwt
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
)

ACTOR_EMAIL = 'importador-etl@example.invalid'
PORTFOLIO = ('person', 'debtor', 'debt', 'debtor_person', 'debtor_contact', 'debtor_profile', 'debtor_profile_detail',
             'address', 'city', 'province')
CATALOG_TABLES = {'debt_status': 'key', 'debtor_type': 'key', 'document_type': 'key', 'person_status': 'key',
                  'contact_type': 'key', 'currency': 'code'}
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


def stage_sintetico(local, checks):
    with tempfile.TemporaryDirectory(prefix='a026-') as name:
        work = Path(name)
        check_rejected_credentials(local, checks, derive_lot(work / 'credenciales'))
        check_blocked(local, checks)
        _, catalogs = check_validated(local, checks, work)
        check_quarantines(local, checks, work, catalogs)
        check_previous_state(local, checks, work)
        check_amount_change(local, checks, work, catalogs)


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
    if args.stage == 'sintetico':
        stage_sintetico(local, checks)
    else:
        stage_municipio_b(local, checks)
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
