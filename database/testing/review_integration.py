"""ALIGN-022. Runner y validador de campanas reales contra la base local. Solo stdlib.

Exige inventario exacto, sin omisiones, destino loopback y procedencia completa. Rechaza el proyecto
original y el de testing por URL y por project_ref, tambien si aparecen en una variable auxiliar, antes
de la primera solicitud. Los IDs prohibidos salen de quality/supabase-testing.json, que solo se lee.

Procedimiento: front/tests/external-review/README.md. Desde la raiz:
  back/.venv/bin/python database/testing/review_integration.py run --output <dir nuevo> \
    --config-file /tmp/.../config.json --http-base http://127.0.0.1:<puerto>
  back/.venv/bin/python database/testing/review_integration.py validate --report <dir>/review.json

Otra campana (ALIGN-059, por ejemplo) agrega su Campaign a CAMPAIGNS: no hace falta otro runner.
"""
import argparse
import base64
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = json.loads((ROOT / 'quality/supabase-testing.json').read_text(encoding='utf-8'))
PROHIBITED_REFS = (FIXTURE['original_project_ref'], FIXTURE['project_ref'])
LOOPBACK_HOSTS = ('localhost', '127.0.0.1', '::1')
VITEST_TIMEOUT_SECONDS = 600
OPEN_URL = urllib.request.build_opener(urllib.request.ProxyHandler({})).open

CASE_ID = re.compile(r'^([A-Z]+(?:-[A-Z]+)*-\d{2}): \S')
SHA_FORMAT = re.compile(r'^[0-9a-f]{40}$')
JWT_FORMAT = re.compile(r'eyJ[\w-]+\.[\w-]+\.[\w-]+')
KEY_FORMAT = re.compile(r'sb_(?:secret|publishable)_[\w-]+')
REMOTE_URL = re.compile(r'https?://[\w.-]*supabase\.co\S*', re.IGNORECASE)

REQUIRED_ACCOUNTS = ('consulta', 'operador', 'supervisor', 'importador', 'importador-real', 'sin-membresia',
                     'inactivo', 'otro-operador', 'otro-supervisor')
SERVER_CREDENTIALS = {'reviewJwt': 'equitas_review_server', 'importJwt': 'equitas_import_server'}

REVIEW_CASES = frozenset({
    'REV-ENV-01',
    'REV-FN-01', 'REV-FN-02', 'REV-FN-03', 'REV-FN-04', 'REV-FN-05', 'REV-FN-06', 'REV-FN-07', 'REV-FN-08', 'REV-FN-09', 'REV-FN-10', 'REV-FN-11', 'REV-FN-12',
    'REV-API-01', 'REV-API-02', 'REV-API-03', 'REV-API-04', 'REV-API-05', 'REV-API-06', 'REV-API-07', 'REV-API-08', 'REV-API-09', 'REV-API-10', 'REV-API-11', 'REV-API-12',
    'REV-APR-01', 'REV-APR-02', 'REV-APR-03', 'REV-APR-04', 'REV-APR-05', 'REV-APR-06', 'REV-APR-07', 'REV-APR-08',
    'REV-SUP-01', 'REV-SUP-02', 'REV-SUP-03', 'REV-SUP-04',
    'REV-CUT-01', 'REV-CUT-02', 'REV-CUT-03', 'REV-CUT-04', 'REV-CUT-05', 'REV-CUT-06',
    'REV-JWT-01', 'REV-JWT-02', 'REV-JWT-03', 'REV-JWT-04', 'REV-JWT-05', 'REV-JWT-06', 'REV-JWT-07',
    'REV-IMP-01', 'REV-IMP-02', 'REV-IMP-03', 'REV-IMP-04', 'REV-IMP-05', 'REV-IMP-06', 'REV-IMP-07', 'REV-IMP-08', 'REV-IMP-09',
    'REV-TP-01', 'REV-TP-02', 'REV-TP-03',
    'REV-READ-01', 'REV-READ-02', 'REV-READ-03', 'REV-READ-04', 'REV-READ-05', 'REV-READ-06',
    'REV-ACT-01', 'REV-ACT-02', 'REV-ACT-03', 'REV-ACT-04', 'REV-ACT-05', 'REV-ACT-06', 'REV-ACT-07',
})


@dataclass(frozen=True)
class Campaign:
    name: str
    ticket: str
    test_file: str
    vitest_config: str
    required_cases: frozenset
    transport: str


CAMPAIGNS = {
    'review': Campaign(
        name='review', ticket='ALIGN-022',
        test_file='front/tests/external-review/case-review.integration.test.ts',
        vitest_config='front/vitest.review.config.ts', required_cases=REVIEW_CASES,
        transport='Auth y Data API locales reales; acciones compiladas por HTTP contra next start',
    ),
}


def names_prohibited(text):
    return any(ref in text for ref in PROHIBITED_REFS) or 'supabase.co' in text.lower()


def require_loopback(value, field):
    """Devuelve la URL. El mensaje nombra el campo, nunca el valor."""
    if isinstance(value, str) and names_prohibited(value):
        raise ValueError(f'{field}: destino prohibido.')
    try:
        parts = urlsplit(value) if isinstance(value, str) else None
        port = parts.port if parts else None
    except ValueError:
        parts, port = None, None
    if (not parts or parts.scheme != 'http' or parts.hostname not in LOOPBACK_HOSTS or not port or parts.username
            or parts.password or parts.path or parts.query or parts.fragment):
        raise ValueError(f'{field}: solo se admite http en localhost, 127.0.0.1 o ::1, con puerto y sin ruta.')
    return value


def jwt_role(token):
    payload = token.split('.')[1]
    claims = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
    return claims.get('role')


def validate_credentials(config):
    if not config['publishableKey'].startswith('sb_publishable_'):
        raise ValueError('publishableKey: se requiere clave publicable; no se aceptan claves administrativas.')
    if not isinstance(config['jwtSecret'], str) or not config['jwtSecret']:
        raise ValueError('jwtSecret: falta el secreto del stack local.')
    for field, role in SERVER_CREDENTIALS.items():
        try:
            valid = jwt_role(config[field]) == role
        except (AttributeError, IndexError, TypeError, ValueError):
            valid = False
        if not valid:
            raise ValueError(f'{field}: se requiere un JWT del rol {role}.')


def validate_accounts(config):
    for label in REQUIRED_ACCOUNTS:
        account = config['accounts'].get(label)
        if not account or not str(account.get('email', '')).endswith('@example.test') or not account.get('password'):
            raise ValueError(f'accounts: falta la cuenta sintetica {label}.')


def validate_target(raw, http_base, environ):
    """Falla antes de crear clientes o procesos. Ningun mensaje repite valores de la configuracion."""
    if not raw:
        raise ValueError('Falta la configuracion local; la campana real no se omite.')
    if names_prohibited(raw):
        raise ValueError('La configuracion nombra un destino prohibido.')
    for name, value in environ.items():
        if names_prohibited(value):
            raise ValueError(f'La variable {name} nombra un destino prohibido.')
    try:
        config = json.loads(raw)
        if not isinstance(config, dict):
            raise TypeError
        require_loopback(config['supabaseUrl'], 'supabaseUrl')
        require_loopback(http_base, 'http_base')
        for field in ('project_ref', 'projectRef'):
            if config.get(field) is not None:
                raise ValueError(f'{field}: la campana local no admite un proyecto remoto.')
        validate_credentials(config)
        validate_accounts(config)
    except (KeyError, TypeError, AttributeError, json.JSONDecodeError) as error:
        raise ValueError('La configuracion local tiene estructura invalida.') from error
    return config


def validate_build(build, sha):
    if not isinstance(build, dict):
        raise ValueError('El servidor local no devolvio su identificacion.')
    if build.get('supabaseProjectRef') is not None:
        raise ValueError('El servidor local apunta a un proyecto remoto: destino prohibido.')
    if build.get('sourceSha') != sha:
        raise ValueError('El servidor local corresponde a otro commit.')


def inventory_errors(cases, campaign):
    if not isinstance(cases, list):
        return ['cases: no es una lista de casos.']
    errors, seen, unapproved = [], set(), []
    for case in cases:
        name = case.get('name') if isinstance(case, dict) else None
        match = CASE_ID.match(name) if isinstance(name, str) else None
        if not match:
            errors.append('Hay un caso sin identificador de inventario.')
            continue
        identifier = match.group(1)
        if identifier in seen:
            errors.append(f'Caso duplicado: {identifier}.')
        seen.add(identifier)
        if case.get('status') != 'passed':
            unapproved.append(f"{identifier} ({case.get('status')})")
    if missing := sorted(campaign.required_cases - seen):
        errors.append(f"Faltan casos del inventario: {', '.join(missing)}.")
    if extra := sorted(seen - campaign.required_cases):
        errors.append(f"Casos fuera del inventario: {', '.join(extra)}.")
    if unapproved:
        errors.append(f"Casos sin aprobar: {', '.join(sorted(unapproved))}.")
    return errors


def count_errors(tests, campaign):
    expected = {'passed': len(campaign.required_cases), 'failed': 0, 'skipped': 0}
    if tests != expected:
        return [f"Los conteos no coinciden con {expected['passed']} aprobadas, 0 fallidas y 0 omitidas."]
    return []


def destination_errors(report):
    environment = report.get('environment')
    if names_prohibited(json.dumps(report, default=str)):
        return ['El reporte nombra un destino prohibido.']
    if not isinstance(environment, dict) or environment.get('target') != 'local':
        return ['environment: la campana solo vale contra la base local.']
    errors = []
    if environment.get('project_ref') is not None:
        errors.append('environment.project_ref: la campana local no admite un proyecto remoto.')
    for field in ('supabase_url', 'http_base'):
        try:
            require_loopback(environment.get(field), f'environment.{field}')
        except ValueError as error:
            errors.append(str(error))
    return errors


def provenance_errors(report, campaign, sha, test_source_sha256):
    errors = []
    if report.get('campaign') != campaign.name or report.get('ticket') != campaign.ticket:
        errors.append('El reporte es de otra campana.')
    source = report.get('source_sha')
    if not isinstance(source, str) or not SHA_FORMAT.match(source):
        errors.append('source_sha: falta el SHA completo.')
    elif sha and source != sha:
        errors.append('El reporte es de otra ejecucion: source_sha.')
    environment = report.get('environment') if isinstance(report.get('environment'), dict) else {}
    if environment.get('build_sha') != source:
        errors.append('environment.build_sha: el servidor probado no corresponde a source_sha.')
    if report.get('worktree_clean') is not True:
        errors.append('El arbol de trabajo no estaba limpio: el SHA no describe lo que corrio.')
    tested = report.get('test_source_sha256')
    if not tested or (test_source_sha256 and tested != test_source_sha256):
        errors.append('test_source_sha256: no corresponde al codigo de la campana.')
    return errors


def validate_report(report, campaign, sha=None, test_source_sha256=None):
    """Junta todos los problemas: un reporte incompleto no aprueba aunque vitest haya salido con 0."""
    if not isinstance(report, dict):
        raise ValueError('El reporte no tiene la estructura esperada.')
    errors = [*destination_errors(report), *inventory_errors(report.get('cases'), campaign),
              *count_errors(report.get('tests'), campaign), *provenance_errors(report, campaign, sha, test_source_sha256)]
    if report.get('passed') is not True or report.get('exit_code') != 0 or report.get('report_errors') != []:
        errors.append('La campana no aprobo.')
    if errors:
        raise ValueError(' '.join(errors))


def current_sha():
    return subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()


def worktree_is_clean():
    return not subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip()


def read_build_info(http_base):
    try:
        with OPEN_URL(f'{http_base}/api/build-info', timeout=15) as response:
            return json.loads(response.read())
    except (OSError, ValueError) as error:
        raise ValueError('El servidor local no responde en /api/build-info.') from error


def tool_versions():
    def version(command):
        return subprocess.check_output(command, cwd=ROOT / 'front', text=True).strip()

    package = json.loads((ROOT / 'front/node_modules/vitest/package.json').read_text(encoding='utf-8'))
    return {'node': version([shutil.which('node') or 'node', '-v']), 'npm': version([shutil.which('npm') or 'npm', '-v']), 'vitest': package['version']}


def sha256_of(relative):
    return hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()


def read_results(path, returncode, report):
    results = json.loads(path.read_text(encoding='utf-8'))
    report['exit_code'] = returncode
    report['cases'] = [{'name': case['title'], 'status': case['status'], 'duration_ms': case.get('duration')}
                       for suite in results['testResults'] for case in suite['assertionResults']]
    statuses = [case['status'] for case in report['cases']]
    report['tests'] = {'passed': statuses.count('passed'), 'failed': statuses.count('failed'),
                       'skipped': len(statuses) - statuses.count('passed') - statuses.count('failed')}
    if (results.get('numPassedTests'), results.get('numFailedTests')) != (report['tests']['passed'], report['tests']['failed']):
        raise ValueError('Los conteos de vitest no coinciden con sus casos.')
    report['passed'] = returncode == 0


def run_vitest(output, config_file, http_base, campaign, report):
    env = {**os.environ, 'EQUITAS_REVIEW_LOCAL_CONFIG': str(config_file), 'EQUITAS_REVIEW_HTTP_BASE': http_base}
    command = [shutil.which('npx') or 'npx', '--no', 'vitest', 'run', '--config', Path(campaign.vitest_config).name,
               '--reporter=default', '--reporter=json', '--reporter=junit',
               f'--outputFile.json={output / "tests.json"}', f'--outputFile.junit={output / "tests.xml"}']
    with (output / 'tests.log').open('w', encoding='utf-8') as log:
        result = subprocess.run(command, cwd=ROOT / 'front', env=env, stdout=log, stderr=subprocess.STDOUT,
                                timeout=VITEST_TIMEOUT_SECONDS, check=False)
    read_results(output / 'tests.json', result.returncode, report)


def junit_document(report, campaign):
    cases = [case for case in report['cases'] if isinstance(case, dict)]
    known = {CASE_ID.match(case['name']).group(1) for case in cases if CASE_ID.match(case['name'])}
    missing = sorted(campaign.required_cases - known) if report['cases'] or report['exit_code'] is not None else []
    failed = sum(case['status'] == 'failed' for case in cases) + len(missing)
    skipped = sum(case['status'] not in ('passed', 'failed') for case in cases)
    root = ET.Element('testsuites', name=f'{campaign.ticket} {campaign.name}')
    suite = ET.SubElement(root, 'testsuite', name=campaign.name, tests=str(len(cases) + len(missing)), failures=str(failed),
                          skipped=str(skipped), errors='0', timestamp=report['started_at_utc'])
    properties = ET.SubElement(suite, 'properties')
    environment = report['environment']
    values = {'ticket': campaign.ticket, 'source_sha': report['source_sha'], 'worktree_clean': report['worktree_clean'],
              'test_source_sha256': report['test_source_sha256'], 'passed': report['passed'], **environment,
              'project_ref': environment.get('project_ref') or 'none'}
    for name, value in values.items():
        ET.SubElement(properties, 'property', name=name, value=str(value))
    for case in cases:
        element = ET.SubElement(suite, 'testcase', classname=campaign.name, name=case['name'], time=str((case.get('duration_ms') or 0) / 1000))
        if case['status'] == 'failed':
            ET.SubElement(element, 'failure', message='Ver tests.json y tests.log')
        elif case['status'] != 'passed':
            ET.SubElement(element, 'skipped', message=str(case['status']))
    for identifier in missing:
        element = ET.SubElement(suite, 'testcase', classname=campaign.name, name=f'{identifier}: faltante')
        ET.SubElement(element, 'failure', message='Caso del inventario sin resultado')
    return ET.tostring(root, encoding='unicode')


def collect_secrets(raw):
    try:
        config = json.loads(raw)
        return [value for value in (config.get('publishableKey'), config.get('reviewJwt'), config.get('importJwt'), config.get('jwtSecret'),
                                    *(account.get('password') for account in config.get('accounts', {}).values())) if isinstance(value, str) and value]
    except (AttributeError, TypeError, ValueError):
        return []


def redact(text, secrets):
    for value in secrets:
        text = text.replace(value, '<REDACTADO>')
    for ref in PROHIBITED_REFS:
        text = text.replace(ref, '<DESTINO-PROHIBIDO>')
    text = JWT_FORMAT.sub('<REDACTADO-JWT>', text)
    text = KEY_FORMAT.sub('<REDACTADO-CLAVE>', text)
    return REMOTE_URL.sub('<URL-REMOTA>', text)


def write_outputs(output, report, campaign, secrets):
    (output / f'{campaign.name}.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (output / f'{campaign.name}.xml').write_text(junit_document(report, campaign) + '\n', encoding='utf-8')
    environment = report['environment']
    lines = [f'# {campaign.ticket} - campana {campaign.name}', '',
             f"SHA: `{report['source_sha']}`. Arbol limpio: {report['worktree_clean']}. Servidor probado: `{environment.get('build_sha')}`.",
             f"Destino: {environment.get('target')} (`{environment.get('supabase_url')}`, `{environment.get('http_base')}`), project_ref {environment.get('project_ref')}.", '',
             f"Resultado: **{'aprobado' if report['passed'] else 'fallido'}**; {report['tests']}. Inventario: {len(campaign.required_cases)} casos.", '',
             '| Caso | Resultado |', '| --- | --- |']
    lines += [f"| {case['name']} | {case['status']} |" for case in report['cases'] if isinstance(case, dict)]
    lines += ['', *report['report_errors']]
    markdown = '\n'.join(lines) + '\n'
    (output / 'summary.md').write_text(markdown, encoding='utf-8')
    # Un fallo de vitest puede citar lo que comparo: ninguna salida conserva claves ni referencias prohibidas.
    for path in output.iterdir():
        if path.is_file():
            path.write_text(redact(path.read_text(encoding='utf-8', errors='replace'), secrets), encoding='utf-8')
    print(redact(markdown, secrets))


def run(output, config_file, http_base, campaign):
    if output.exists() and any(output.iterdir()):
        raise ValueError('Usar un directorio de reportes vacio; no se aceptan evidencias anteriores.')
    output.mkdir(parents=True, exist_ok=True)
    sha = current_sha()
    test_hash = sha256_of(campaign.test_file)
    report = {
        'campaign': campaign.name, 'ticket': campaign.ticket, 'source_sha': sha, 'worktree_clean': worktree_is_clean(),
        'started_at_utc': datetime.now(UTC).isoformat(), 'transport': campaign.transport, 'test_source_sha256': test_hash,
        'environment': {'target': None, 'supabase_url': None, 'http_base': None, 'project_ref': None, 'build_sha': None},
        'passed': False, 'exit_code': None, 'report_errors': [], 'tests': {}, 'cases': [],
    }
    raw = None
    try:
        raw = Path(config_file).read_text(encoding='utf-8-sig') if config_file else None
        config = validate_target(raw, http_base, os.environ)
        build = read_build_info(http_base)
        validate_build(build, sha)
        report['environment'] = {'target': 'local', 'supabase_url': config['supabaseUrl'], 'http_base': http_base, 'project_ref': None,
                                 'build_sha': build['sourceSha'], 'python': platform.python_version(), **tool_versions()}
        run_vitest(output, Path(config_file), http_base, campaign, report)
        validate_report(report, campaign, sha, test_hash)
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        report['passed'] = False
        report['report_errors'].append(str(error))
    report['finished_at_utc'] = datetime.now(UTC).isoformat()
    write_outputs(output, report, campaign, collect_secrets(raw))
    return 0 if report['passed'] else 1


def validate_saved(path, campaign, sha=None):
    """Vuelve a validar un reporte ya escrito, sin ejecutar nada: para el resumen de M2 y para ALIGN-029."""
    try:
        report = json.loads(Path(path).read_text(encoding='utf-8'))
        validate_report(report, campaign, sha, sha256_of(campaign.test_file))
    except (OSError, ValueError) as error:
        print(f'RECHAZADO: {error}')
        return 1
    print(f"APROBADO: {campaign.ticket}, {len(campaign.required_cases)} casos, SHA {report['source_sha']}, destino {report['environment']['target']}.")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--campaign', choices=sorted(CAMPAIGNS), default='review')
    commands = parser.add_subparsers(dest='command', required=True)
    execute = commands.add_parser('run')
    execute.add_argument('--output', type=Path, required=True)
    execute.add_argument('--config-file', type=Path, required=True)
    execute.add_argument('--http-base', required=True)
    check = commands.add_parser('validate')
    check.add_argument('--report', type=Path, required=True)
    check.add_argument('--sha')
    args = parser.parse_args()
    campaign = CAMPAIGNS[args.campaign]
    if args.command == 'validate':
        return validate_saved(args.report, campaign, args.sha)
    try:
        return run(args.output.resolve(), args.config_file, args.http_base, campaign)
    except ValueError as error:
        print(f'RECHAZADO: {error}')
        return 1


if __name__ == '__main__':
    sys.exit(main())
