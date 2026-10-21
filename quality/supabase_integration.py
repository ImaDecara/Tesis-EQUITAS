"""Run the mandatory real Supabase campaign; retain failures without secrets."""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = json.loads((ROOT / 'quality/supabase-testing.json').read_text(encoding='utf-8'))
REQUIRED_CASES = {
    'SUP-AUTH-01', 'SUP-AUTH-02', 'SUP-AUTH-03', 'SUP-DATA-02',
    'SUP-RLS-01', 'SUP-RLS-02', 'SUP-RLS-03', 'SUP-RLS-04', 'SUP-RLS-05', 'SUP-WRITE-01',
}


def validate_config(raw):
    if not raw:
        raise ValueError('Falta SUPABASE_TEST_CONFIG; la integracion obligatoria no se omite.')
    try:
        config = json.loads(raw)
        if config['url'] != FIXTURE['url']:
            raise ValueError('La URL debe corresponder exactamente al proyecto aislado registrado.')
        if not config['publishableKey'].startswith('sb_publishable_'):
            raise ValueError('Se requiere clave publicable; no se aceptan claves administrativas.')
        for label in ('a', 'b', 'none', 'inactive'):
            account = config['accounts'][label]
            if account['email'] != f'tp-e06-{label}@example.test' or not account['password']:
                raise ValueError(f'Credenciales de fixture ausentes o invalidas para {label}.')
    except (KeyError, TypeError, AttributeError, json.JSONDecodeError) as error:
        raise ValueError('SUPABASE_TEST_CONFIG tiene estructura invalida.') from error
    return config


def validate_result(report, sha=None, run_id=None, attempt=None):
    if not report.get('passed') or report.get('report_errors'):
        raise ValueError('La integracion real no aprobo.')
    if report.get('project_ref') != FIXTURE['project_ref'] or report.get('fixture_version') != FIXTURE['fixture_version']:
        raise ValueError('Proyecto o fixtures de integracion incorrectos.')
    if report.get('tests') != {'passed': 12, 'failed': 0, 'skipped': 0}:
        raise ValueError('Se requieren las 12 variantes reales aprobadas y sin omisiones.')
    cases = report.get('cases', [])
    if len(cases) != 12 or len({c['name'] for c in cases}) != 12 or any(c['status'] != 'passed' for c in cases):
        raise ValueError('Inventario real incompleto, duplicado o no aprobado.')
    if {c['name'].split(':', 1)[0] for c in cases} != REQUIRED_CASES:
        raise ValueError('Faltan IDs de la campana real.')
    for name, expected in [('source_sha', sha), ('run_id', run_id), ('run_attempt', attempt)]:
        if expected and report.get(name) != expected:
            raise ValueError(f'Integracion de otra ejecucion: {name}.')


def run(output, config_file=None):
    if output.exists() and any(output.iterdir()):
        raise ValueError('Usar un directorio de reportes vacio; no se aceptan evidencias anteriores.')
    output.mkdir(parents=True, exist_ok=True)
    sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    test_file = ROOT / 'front/tests/external/supabase.integration.test.ts'
    report = {
        'source_sha': sha, 'run_id': os.getenv('GITHUB_RUN_ID'),
        'run_attempt': os.getenv('GITHUB_RUN_ATTEMPT'),
        'started_at_utc': datetime.now(UTC).isoformat(),
        'project_ref': FIXTURE['project_ref'], 'fixture_version': FIXTURE['fixture_version'],
        'transport': 'Supabase Auth HTTP + Data API; publishable key and normal user JWT',
        'application_code': ['validateAuthUserTenantAccess', 'loadAllTableRows'],
        'test_source_sha256': hashlib.sha256(test_file.read_bytes()).hexdigest(),
        'passed': False, 'report_errors': [], 'tests': {}, 'cases': [],
    }
    try:
        raw = config_file.read_text(encoding='utf-8-sig') if config_file else os.getenv('SUPABASE_TEST_CONFIG')
        validate_config(raw)
        env = {**os.environ, 'SUPABASE_TEST_CONFIG': raw}
        npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
        if not npm:
            raise ValueError('npm no esta disponible.')
        command = [npm, 'run', 'test:supabase', '--', '--reporter=default', '--reporter=json',
                   '--reporter=junit', f'--outputFile.json={output / "tests.json"}',
                   f'--outputFile.junit={output / "tests.xml"}']
        with (output / 'tests.log').open('w', encoding='utf-8') as log:
            result = subprocess.run(command, cwd=ROOT / 'front', env=env, stdout=log,
                                    stderr=subprocess.STDOUT, timeout=420, check=False)
        report['exit_code'] = result.returncode
        tests = json.loads((output / 'tests.json').read_text(encoding='utf-8'))
        report['tests'] = {'passed': tests['numPassedTests'], 'failed': tests['numFailedTests'],
                           'skipped': tests['numPendingTests']}
        report['cases'] = [{'name': case['title'], 'status': case['status'],
                            'duration_ms': case.get('duration')}
                           for suite in tests['testResults'] for case in suite['assertionResults']]
        report['passed'] = result.returncode == 0
        validate_result(report, sha)
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
        report['passed'] = False
        # Configuration errors describe fields, never their secret values.
        report['report_errors'].append(str(error))
    report['finished_at_utc'] = datetime.now(UTC).isoformat()
    (output / 'supabase.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    lines = ['# E06 - Integracion real Supabase', '', f'Proyecto: `{report["project_ref"]}`.',
             f'SHA: `{sha}`. Fixtures: `{report["fixture_version"]}`.', '',
             f'Resultado: **{"aprobado" if report["passed"] else "fallido"}**; {report["tests"]}.', '',
             '| Caso/variante | Resultado |', '| --- | --- |']
    lines += [f'| {c["name"]} | {c["status"]} |' for c in report['cases']]
    lines += ['', *report['report_errors'], '',
              'El proyecto original no fue modificado. Logout prueba el cliente tras salir, no revocacion instantanea de JWT copiados.']
    markdown = '\n'.join(lines) + '\n'
    (output / 'summary.md').write_text(markdown, encoding='utf-8')
    if os.getenv('GITHUB_STEP_SUMMARY'):
        with Path(os.environ['GITHUB_STEP_SUMMARY']).open('a', encoding='utf-8') as file:
            file.write(markdown)
    print(markdown)
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--config-file', type=Path)
    args = parser.parse_args()
    sys.exit(run(args.output.resolve(), args.config_file))
