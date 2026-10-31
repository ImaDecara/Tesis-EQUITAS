"""ALIGN-018. Herramientas locales de la credencial de servidor y prueba HTTP real. Solo stdlib.

mint-jwt   emite el JWT server-only de un rol de servidor en /tmp/equitas-local-db/ (0600). No lo imprime.
http-check ejercita Auth y la Data API del stack local con cuentas sinteticas. Publica solo codigos y conteos.

Solo acepta el stack local (docs/tesis/entorno-aislado.md, seccion 4). Requiere los archivos de
/tmp/equitas-local-db/ y deja filas: al terminar corresponde db reset.
"""
import argparse
import base64
import concurrent.futures
import hashlib
import hmac
import json
import os
import stat
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

LOCAL_DIR = '/tmp/equitas-local-db'
ENV_FILE = f'{LOCAL_DIR}/supabase-local.env'
CREDENTIALS_FILE = f'{LOCAL_DIR}/case-review-credentials.psv'
LOOPBACK_HOSTS = {'localhost', '127.0.0.1', '::1'}
SERVER_ROLES = ('equitas_review_server', 'equitas_import_server')
TABLES = ('case_review', 'case_review_approval', 'import_batch')
OPEN_URL = urllib.request.build_opener(urllib.request.ProxyHandler({})).open

TENANT_A, TENANT_B, OBJECT_A, OBJECT_B = 920001, 920002, 920001, 920002
USER_CONSULTA, USER_OPERADOR, USER_SUPERVISOR, USER_IMPORTADOR, USER_SIN = 920001, 920002, 920003, 920004, 920005
USER_SISTEMA = 920009
MISSING_ID = 999999999
READY_CHECKLIST = {'situacion_hogar': 'NO_DISPONIBLE', 'estado_juridico_verificado': True,
                   'canal_valido': True, 'alternativa_asistida_ofrecida': True}


def load_local_env():
    """Lee las claves sin mostrarlas y valida el destino antes de la primera solicitud."""
    with open(ENV_FILE, encoding='utf-8') as handle:
        values = {}
        for line in handle:
            name, separator, value = line.strip().partition('=')
            if separator:
                values[name] = value.strip('"')
    url = urllib.parse.urlsplit(values.get('API_URL', ''))
    if url.scheme != 'http' or url.hostname not in LOOPBACK_HOSTS or url.username or url.password:
        sys.exit('DETENERSE: API_URL no es el stack local')
    if any('supabase.co' in value for value in (*values.values(), *os.environ.values())):
        sys.exit('DETENERSE: hay un valor de configuracion que nombra un proyecto remoto (no se muestra)')
    return values


def b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()


def sign_jwt(secret, claims):
    header = b64url(json.dumps({'alg': 'HS256', 'typ': 'JWT'}, separators=(',', ':')).encode())
    payload = b64url(json.dumps(claims, separators=(',', ':')).encode())
    signature = hmac.new(secret.encode(), f'{header}.{payload}'.encode(), hashlib.sha256).digest()
    return f'{header}.{payload}.{b64url(signature)}'


def server_claims(role, hours):
    now = int(time.time())
    return {'role': role, 'iss': 'equitas-local', 'iat': now, 'exp': now + int(hours * 3600)}


def mint_jwt(role, hours):
    env = load_local_env()
    path = f'{LOCAL_DIR}/{role}.jwt'
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, stat.S_IRUSR | stat.S_IWUSR)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
        handle.write(sign_jwt(env['JWT_SECRET'], server_claims(role, hours)))
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
    print(f'{role}: credencial escrita en {path} (0600), vigencia {hours} h')


class Api:
    def __init__(self, env):
        self.url = env['API_URL'].rstrip('/')
        self.apikey = env['ANON_KEY']

    def call(self, method, path, token=None, body=None, apikey=None):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(f'{self.url}{path}', data=data, method=method)
        request.add_header('apikey', apikey or self.apikey)
        request.add_header('Content-Type', 'application/json')
        if token:
            request.add_header('Authorization', f'Bearer {token}')
        try:
            with OPEN_URL(request, timeout=15) as response:
                return response.status, json.loads(response.read() or b'null')
        except urllib.error.HTTPError as error:
            raw = error.read()
            try:
                return error.code, json.loads(raw or b'null')
            except json.JSONDecodeError:
                return error.code, None

    def rpc(self, name, token, body):
        return self.call('POST', f'/rest/v1/rpc/{name}', token, body)

    def rows(self, table, select, token):
        return self.call('GET', f'/rest/v1/{table}?select={select}', token)


class Report:
    def __init__(self):
        self.results = []

    def expect(self, case, expected, obtained):
        self.results.append((case, str(expected), str(obtained)))

    def error(self, case, expected_code, response):
        status, body = response
        code = body.get('code') if isinstance(body, dict) else None
        self.expect(case, expected_code, code if status >= 400 else f'http-{status}')

    def rejected(self, case, expected_message, response):
        status, body = response
        message = body.get('message') if isinstance(body, dict) else None
        self.expect(case, expected_message, message if status >= 400 else f'http-{status}')
        if isinstance(body, dict) and status >= 400:
            self.expect(f'{case}: sin detalle de fila', 'None', body.get('details'))

    def finish(self):
        failed = 0
        for case, expected, obtained in self.results:
            ok = expected == obtained
            failed += not ok
            print(f"{case}|{expected}|{obtained}|{'OK' if ok else 'FALLA'}")
        print(f'TOTAL|{len(self.results)}|FALLAS|{failed}')
        return 1 if failed else 0


def review_body(user, tenant, debtor, decision='ACEPTA', **extra):
    body = {'p_reviewer_user': user, 'p_tenant': tenant, 'p_debtor': debtor, 'p_rules_version': '1.0.0',
            'p_as_of': '2026-10-30', 'p_inputs_hash': 'a' * 64, 'p_suggested_intervention': 'RECORDATORIO_INFORMATIVO',
            'p_suggested_intensity': 1, 'p_explanation': {'factores': []}, 'p_decision': decision,
            'p_idempotency_key': str(uuid.uuid4())}
    if decision == 'ACEPTA':
        body.update(p_decided_intervention='RECORDATORIO_INFORMATIVO', p_decided_intensity=1)
    body.update(extra)
    return body


def approval_body(user, tenant, review, decision='APRUEBA', **extra):
    body = {'p_approver_user': user, 'p_tenant': tenant, 'p_case_review': review, 'p_decision': decision,
            'p_idempotency_key': str(uuid.uuid4()), 'p_checklist': READY_CHECKLIST}
    body.update(extra)
    return body


def batch_body(user, tenant, **extra):
    body = {'p_actor_user': user, 'p_tenant': tenant, 'p_source': 'ETL_CLI', 'p_file_hashes': {'cabecera': 'b' * 64},
            'p_as_of': '2026-10-30', 'p_rules_version': '1.0.0', 'p_status': 'RECIBIDO',
            'p_idempotency_key': str(uuid.uuid4()), 'p_counts': {'filas': 1}}
    body.update(extra)
    return body


def login_all(api, report):
    sessions = {}
    with open(CREDENTIALS_FILE, encoding='utf-8') as handle:
        for line in handle:
            label, email, password = line.rstrip('\n').split('|')
            status, body = api.call('POST', '/auth/v1/token?grant_type=password', body={'email': email, 'password': password})
            report.expect(f'login {label}', 200, status)
            sessions[label] = body.get('access_token') if isinstance(body, dict) else None
    return sessions


def check_clients_denied(api, report, clients):
    for name, token, key in clients:
        for table in TABLES:
            for method, path, body in (('POST', f'/rest/v1/{table}', {}),
                                       ('PATCH', f'/rest/v1/{table}?id=eq.0', {'created_at': 'now'}),
                                       ('DELETE', f'/rest/v1/{table}?id=eq.0', None)):
                report.error(f'{name} {method} {table}', '42501', api.call(method, path, token, body, key))
        report.error(f'{name} rpc record_case_review', '42501', api.call(
            'POST', '/rest/v1/rpc/record_case_review', token, review_body(USER_OPERADOR, TENANT_A, OBJECT_A), key))
        report.error(f'{name} rpc record_case_review_approval', '42501', api.call(
            'POST', '/rest/v1/rpc/record_case_review_approval', token, approval_body(USER_SUPERVISOR, TENANT_A, 1), key))
        report.error(f'{name} rpc record_import_batch', '42501', api.call(
            'POST', '/rest/v1/rpc/record_import_batch', token, batch_body(USER_IMPORTADOR, TENANT_A), key))


def check_server_credential(api, report, env, review_jwt, import_jwt):
    report.error('JWT firmado con otro secreto', 'PGRST301', api.rpc(
        'record_case_review', sign_jwt('otro-secreto-sintetico-de-32-caracteres!', server_claims(SERVER_ROLES[0], 1)),
        review_body(USER_OPERADOR, TENANT_A, OBJECT_A)))
    report.error('JWT vencido', 'PGRST303', api.rpc(
        'record_case_review', sign_jwt(env['JWT_SECRET'], server_claims(SERVER_ROLES[0], -1)),
        review_body(USER_OPERADOR, TENANT_A, OBJECT_A)))
    for table in TABLES:
        report.error(f'servidor POST {table}', '42501', api.call('POST', f'/rest/v1/{table}', review_jwt, {}))
        report.error(f'servidor GET {table}', '42501', api.rows(table, 'id', review_jwt))
    report.rejected('credencial de servidor con clave publicable', 'ROLE_NOT_ALLOWED', api.call(
        'POST', '/rest/v1/rpc/record_case_review', review_jwt, review_body(USER_CONSULTA, TENANT_A, OBJECT_A), env['PUBLISHABLE_KEY']))
    report.error('servidor de revision no registra lotes', '42501', api.rpc('record_import_batch', review_jwt, batch_body(USER_IMPORTADOR, TENANT_A)))
    report.error('servidor de importacion no registra decisiones', '42501', api.rpc('record_case_review', import_jwt, review_body(USER_OPERADOR, TENANT_A, OBJECT_A)))


def check_write_flow(api, report, review_jwt, import_jwt):
    body = review_body(USER_OPERADOR, TENANT_A, OBJECT_A)
    status, first = api.rpc('record_case_review', review_jwt, body)
    report.expect('revision valida por el servidor', '200-True', f"{status}-{first.get('created')}")
    status, again = api.rpc('record_case_review', review_jwt, body)
    report.expect('doble envio no crea otra fila', '200-False-True', f"{status}-{again.get('created')}-{again.get('review_id') == first.get('review_id')}")
    twin = review_body(USER_OPERADOR, TENANT_A, OBJECT_A)
    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        replies = list(pool.map(lambda _: api.rpc('record_case_review', review_jwt, twin), range(8)))
    report.expect('8 envios simultaneos crean una fila', '8-1', f"{sum(r[0] == 200 for r in replies)}-{sum(r[1].get('created') is True for r in replies)}")
    report.rejected('objeto de otro tenant', 'OBJECT_NOT_IN_TENANT', api.rpc('record_case_review', review_jwt, review_body(USER_OPERADOR, TENANT_A, OBJECT_B)))
    report.rejected('revisor sin membresia', 'ACTOR_NOT_ACTIVE_MEMBER', api.rpc('record_case_review', review_jwt, review_body(USER_SIN, TENANT_A, OBJECT_A)))
    report.rejected('decision sin motivo', 'INVALID_CASE_REVIEW:case_review_decision_requires_reason', api.rpc(
        'record_case_review', review_jwt, review_body(USER_OPERADOR, TENANT_A, OBJECT_A, 'RECHAZA', p_reason_text='SECRETO_SINTETICO')))
    status, proposal = api.rpc('record_case_review', review_jwt, review_body(
        USER_OPERADOR, TENANT_A, OBJECT_A, 'MODIFICA', p_decided_intervention='INTIMACION_ADMINISTRATIVA', p_decided_intensity=3,
        p_reason_code='MOTIVO_SINTETICO', p_reason_text='Texto sintetico', p_checklist=READY_CHECKLIST))
    report.expect('propuesta de intensidad 3 pendiente', '200-True', f"{status}-{proposal.get('pending_supervisor')}")
    review = proposal.get('review_id')
    report.rejected('operador aprobando', 'ROLE_NOT_ALLOWED', api.rpc('record_case_review_approval', review_jwt, approval_body(USER_OPERADOR, TENANT_A, review)))
    status, approved = api.rpc('record_case_review_approval', review_jwt, approval_body(USER_SUPERVISOR, TENANT_A, review))
    report.expect('supervisor distinto aprueba', '200-True', f"{status}-{approved.get('created')}")
    status, text = api.rpc('read_case_review_reason_text', review_jwt, {'p_actor_user': USER_SUPERVISOR, 'p_tenant': TENANT_A, 'p_case_review': review})
    report.expect('motivo libre por la funcion de servidor', '200-True', f"{status}-{text == 'Texto sintetico'}")
    status, batch = api.rpc('record_import_batch', import_jwt, batch_body(USER_IMPORTADOR, TENANT_A))
    report.expect('lote por el servidor de importacion', '200-True', f"{status}-{batch.get('created')}")


def check_chains(api, report, review_jwt, import_jwt):
    """Tras una insercion valida con id=n, el siguiente es n+1: pedirlo como antecedente seria reemplazarse a si misma."""
    _, review = api.rpc('record_case_review', review_jwt, review_body(USER_OPERADOR, TENANT_A, OBJECT_A))
    report.rejected('revision que se reemplaza a si misma', 'SUPERSEDES_NOT_FOUND', api.rpc(
        'record_case_review', review_jwt, review_body(USER_OPERADOR, TENANT_A, OBJECT_A, p_supersedes=review.get('review_id') + 1)))
    report.rejected('revision con antecedente inexistente', 'SUPERSEDES_NOT_FOUND', api.rpc(
        'record_case_review', review_jwt, review_body(USER_OPERADOR, TENANT_A, OBJECT_A, p_supersedes=MISSING_ID)))
    _, proposal = api.rpc('record_case_review', review_jwt, review_body(
        USER_OPERADOR, TENANT_A, OBJECT_A, 'MODIFICA', p_decided_intervention='INTIMACION_ADMINISTRATIVA', p_decided_intensity=3,
        p_reason_code='MOTIVO_SINTETICO', p_checklist=READY_CHECKLIST))
    target = proposal.get('review_id')
    status, approval = api.rpc('record_case_review_approval', review_jwt, approval_body(USER_SUPERVISOR, TENANT_A, target))
    report.expect('aprobacion base de la cadena', '200-True', f"{status}-{approval.get('created')}")
    report.rejected('aprobacion que se reemplaza a si misma', 'SUPERSEDES_NOT_FOUND', api.rpc(
        'record_case_review_approval', review_jwt, approval_body(USER_SUPERVISOR, TENANT_A, target, p_supersedes=approval.get('approval_id') + 1)))
    report.rejected('aprobacion con antecedente inexistente', 'SUPERSEDES_NOT_FOUND', api.rpc(
        'record_case_review_approval', review_jwt, approval_body(USER_SUPERVISOR, TENANT_A, target, p_supersedes=MISSING_ID)))
    _, batch = api.rpc('record_import_batch', import_jwt, batch_body(USER_IMPORTADOR, TENANT_A))
    report.rejected('lote que se reemplaza a si mismo', 'SUPERSEDES_NOT_FOUND', api.rpc(
        'record_import_batch', import_jwt, batch_body(USER_IMPORTADOR, TENANT_A, p_supersedes=batch.get('batch_id') + 1)))
    report.rejected('lote con antecedente inexistente', 'SUPERSEDES_NOT_FOUND', api.rpc(
        'record_import_batch', import_jwt, batch_body(USER_IMPORTADOR, TENANT_A, p_supersedes=MISSING_ID)))


def check_reason_length(api, report, review_jwt):
    """El limite de 500 mide lo que se guarda: los espacios cuentan y el texto no se normaliza."""
    too_long = 'INVALID_CASE_REVIEW:case_review_reason_text_length'
    blank = 'INVALID_CASE_REVIEW:case_review_reason_text_not_blank'

    def reason(text):
        return api.rpc('record_case_review', review_jwt, review_body(
            USER_OPERADOR, TENANT_A, OBJECT_A, 'RECHAZA', p_reason_code='MOTIVO_SINTETICO', p_reason_text=text))

    report.rejected('501 espacios y una letra', too_long, reason(' ' * 501 + 'x'))
    report.rejected('una letra y 500 espacios', too_long, reason('x' + ' ' * 500))
    report.rejected('relleno a ambos lados, 501 en total', too_long, reason(' ' * 250 + 'x' + ' ' * 250))
    report.rejected('motivo solo con espacios', blank, reason('   '))
    report.rejected('motivo vacio', blank, reason(''))
    report.rejected('motivo de tabulaciones y saltos', blank, reason('\t\n '))
    padded = ' ' * 250 + 'x' + ' ' * 249
    status, created = reason(padded)
    report.expect('relleno a ambos lados, 500 en total', '200-True', f"{status}-{created.get('created')}")
    status, text = api.rpc('read_case_review_reason_text', review_jwt, {
        'p_actor_user': USER_OPERADOR, 'p_tenant': TENANT_A, 'p_case_review': created.get('review_id')})
    report.expect('se guarda igual a como llego', '200-500-True', f"{status}-{len(text)}-{text == padded}")


def check_import_permission(api, report, review_jwt, import_jwt):
    """ALIGN-003: solo importador e importador_sistema. Supervisor no adquiere el permiso por serlo."""
    for status_name in ('RECIBIDO', 'CONFIRMADO', 'PUBLICADO'):
        report.rejected(f'supervisor sin permiso de importacion, {status_name}', 'ROLE_NOT_ALLOWED', api.rpc(
            'record_import_batch', import_jwt, batch_body(USER_SUPERVISOR, TENANT_A, p_status=status_name)))
    report.rejected('operador sin permiso de importacion', 'ROLE_NOT_ALLOWED', api.rpc('record_import_batch', import_jwt, batch_body(USER_OPERADOR, TENANT_A)))
    report.rejected('consulta sin permiso de importacion', 'ROLE_NOT_ALLOWED', api.rpc('record_import_batch', import_jwt, batch_body(USER_CONSULTA, TENANT_A)))
    status, machine = api.rpc('record_import_batch', import_jwt, batch_body(USER_SISTEMA, TENANT_A))
    report.expect('importador_sistema registra lotes', '200-True', f"{status}-{machine.get('created')}")
    report.error('credencial de revision no registra lotes de supervisor', '42501', api.rpc('record_import_batch', review_jwt, batch_body(USER_SUPERVISOR, TENANT_A)))


def check_reads(api, report, sessions):
    def count(table, token):
        status, rows = api.rows(table, 'id', token)
        return len(rows) if status == 200 and isinstance(rows, list) else f'http-{status}'

    # Filas de check_write_flow, check_chains, check_reason_length y check_import_permission.
    expected = {'case_review': 6, 'case_review_approval': 2, 'import_batch': 3}
    for table, rows in expected.items():
        for label in ('consulta', 'operador', 'supervisor', 'importador'):
            report.expect(f'lectura {label} {table}', rows, count(table, sessions[label]))
        for label in ('sin-membresia', 'inactivo', 'otro-operador', 'otro-supervisor'):
            report.expect(f'lectura {label} {table}', 0, count(table, sessions[label]))
        report.expect(f'lectura anon {table}', 0, count(table, None))
    report.error('select=* falla cerrado', '42501', api.rows('case_review', '*', sessions['operador']))
    report.error('select=reason_text sin privilegio', '42501', api.rows('case_review', 'reason_text', sessions['supervisor']))


def http_check():
    env = load_local_env()
    api = Api(env)
    report = Report()
    review_jwt = sign_jwt(env['JWT_SECRET'], server_claims(SERVER_ROLES[0], 1))
    import_jwt = sign_jwt(env['JWT_SECRET'], server_claims(SERVER_ROLES[1], 1))
    sessions = login_all(api, report)
    check_clients_denied(api, report, [('anon', None, None), ('authenticated', sessions['operador'], None),
                                       ('service_role', env['SERVICE_ROLE_KEY'], env['SERVICE_ROLE_KEY'])])
    check_server_credential(api, report, env, review_jwt, import_jwt)
    check_write_flow(api, report, review_jwt, import_jwt)
    check_chains(api, report, review_jwt, import_jwt)
    check_reason_length(api, report, review_jwt)
    check_import_permission(api, report, review_jwt, import_jwt)
    check_reads(api, report, sessions)
    return report.finish()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    mint = commands.add_parser('mint-jwt')
    mint.add_argument('--role', choices=SERVER_ROLES, required=True)
    mint.add_argument('--hours', type=float, default=12)
    commands.add_parser('http-check')
    args = parser.parse_args()
    if args.command == 'mint-jwt':
        mint_jwt(args.role, args.hours)
        return 0
    return http_check()


if __name__ == '__main__':
    sys.exit(main())
