"""Run CI controls, retain their actual exits, and build portable reports."""

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[1]


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def run_control(name, command, cwd, output):
    started = datetime.now(UTC)
    print(f'\n[{name}] {command}', flush=True)
    code = 127
    with (output / f'{name}.log').open('w', encoding='utf-8') as log:
        try:
            with subprocess.Popen(
                command, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding='utf-8', errors='replace',
            ) as process:
                for line in process.stdout:
                    log.write(line)
                    print(line, end='', flush=True)
                code = process.wait()
        except OSError as error:
            log.write(str(error))
            print(error)
    result = {
        'name': name, 'command': [str(arg) for arg in command],
        'cwd': cwd.relative_to(ROOT).as_posix() or '.', 'exit_code': code,
        'started_at_utc': started.isoformat(),
        'duration_seconds': (datetime.now(UTC) - started).total_seconds(),
    }
    write_json(output / f'{name}.exit.json', result)
    return result


def collect_metrics(component, output):
    if component == 'frontend':
        tests = read_json(output / 'tests.json')
        lint = read_json(output / 'eslint.json')
        if not lint:
            raise ValueError('ESLint report contains no analyzed files')
        coverage = read_json(output / 'coverage/coverage-summary.json')['total']
        duplicates = read_json(output / 'duplication/jscpd-report.json')['statistics']['total']
        audit = read_json(output / 'npm-audit-all.json')['metadata']['vulnerabilities']
        return {
            'tests': {'passed': tests['numPassedTests'], 'failed': tests['numFailedTests'],
                      'skipped': tests['numPendingTests']},
            'coverage': coverage,
            'lint': {'errors': sum(item['errorCount'] for item in lint),
                     'warnings': sum(item['warningCount'] for item in lint), 'files': len(lint)},
            'duplication': duplicates, 'audit': audit,
            'audit_policy': read_json(output / 'npm-audit-decision.json'),
        }
    suite = ElementTree.parse(output / 'tests.xml').getroot()
    suites = [suite] if suite.tag == 'testsuite' else list(suite.findall('testsuite'))
    counts = {key: sum(int(item.get(key, '0')) for item in suites)
              for key in ('tests', 'failures', 'errors', 'skipped')}
    coverage = read_json(output / 'coverage.json')['totals']
    lint = read_json(output / 'ruff.json')
    return {
        'tests': {'passed': counts['tests'] - counts['failures'] - counts['errors'] - counts['skipped'],
                  'failed': counts['failures'] + counts['errors'], 'skipped': counts['skipped']},
        'coverage': coverage, 'lint': {'unaccepted_findings': len(lint)},
    }


def component_run(component, output, install):
    if output.exists() and any(output.iterdir()):
        raise ValueError(f'Use an empty report directory; stale reports are not accepted: {output}')
    output.mkdir(parents=True, exist_ok=True)
    sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    report = {
        'component': component, 'source_sha': sha,
        'run_id': os.getenv('GITHUB_RUN_ID'), 'run_attempt': os.getenv('GITHUB_RUN_ATTEMPT'),
        'event': os.getenv('GITHUB_EVENT_NAME', 'local'),
        'failure_probe': os.getenv('CI_FAILURE_PROBE') == 'true',
        'runtime': {'python': platform.python_version(), 'os': platform.platform()},
        'controls': [], 'report_errors': [], 'metrics': None,
        'scope': 'CI base E02; quality gates E04 and external integration E06 remain pending.',
    }
    write_json(output / 'component.json', report)
    cwd = ROOT / ('front' if component == 'frontend' else 'back')
    relative = Path(os.path.relpath(output, cwd)).as_posix()

    def control(name, command):
        result = run_control(name, [str(arg) for arg in command], cwd, output)
        report['controls'].append(result)
        write_json(output / 'component.json', report)
        return result['exit_code'] == 0

    ready = True
    if component == 'frontend':
        npm = shutil.which('npm')
        if not npm:
            raise ValueError('npm is not on PATH')
        if install:
            before = hashlib.sha256((cwd / 'package-lock.json').read_bytes()).hexdigest()
            ready = control('install', [npm, 'ci', '--no-audit', '--no-fund'])
            after = hashlib.sha256((cwd / 'package-lock.json').read_bytes()).hexdigest()
            report['lock_sha256'] = after
            if before != after:
                report['report_errors'].append('npm ci changed the lockfile')
        if ready:
            for name, executable in [('node', shutil.which('node')), ('npm', npm)]:
                report['runtime'][name] = subprocess.check_output([executable, '--version'], cwd=cwd, text=True).strip()
            if report['runtime']['node'] != 'v22.23.2' or report['runtime']['npm'] != '11.21.1':
                report['report_errors'].append('Unexpected Node/npm version; use the E01 pins')
            write_json(output / 'runtime.json', report['runtime'])
            control('dependencies', [npm, 'ls', '--all', '--json'])
            if report['failure_probe']:
                if report['event'] != 'workflow_dispatch':
                    raise ValueError('Failure probe is restricted to manual workflow_dispatch runs')
                probe = cwd / 'tests/ci-contract-probe.test.ts'
                with probe.open('x', encoding='utf-8') as file:
                    file.write("import { expect, it } from 'vitest'\n"
                               "it('E02: ensayo controlado de propagacion de fallo', () => { expect(1).toBe(2) })\n")
            control('tests', [npm, 'run', 'test:coverage', '--', '--reporter=default', '--reporter=json',
                '--reporter=junit', f'--outputFile.json={relative}/tests.json',
                f'--outputFile.junit={relative}/tests.xml', f'--coverage.reportsDirectory={relative}/coverage',
                '--coverage.reportOnFailure=true'])
            control('lint', [npm, 'run', 'lint', '--', '--format', 'json', '--output-file', f'{relative}/eslint.json'])
            control('build', [npm, 'run', 'build'])
            scope = ['app', 'components', 'lib', '../back/ETL', '../back/api', '../back/services']
            control('duplication', [npm, 'exec', '--no', '--', 'jscpd', *scope,
                '--min-lines', '5', '--min-tokens', '50', '--reporters', 'console,json',
                '--output', f'{relative}/duplication', '--no-colors'])
            control('complexity', [npm, 'exec', '--no', '--', 'jscpd', *scope,
                '--complexity', '--reporters', 'console,json', '--output', f'{relative}/complexity', '--no-colors'])
            control('audit', [sys.executable, ROOT / 'quality/audit_policy.py', '--npm', npm, '--output', output])
    else:
        python = cwd / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
        if install:
            ready = control('venv', [sys.executable, '-m', 'venv', '.venv'])
            if ready:
                ready = control('pip', [python, '-m', 'pip', 'install', 'pip==25.0.1'])
            if ready:
                ready = control('install', [python, '-m', 'pip', 'install', '-r', 'requirements-dev.txt'])
        if ready:
            control('infrastructure-tests', [sys.executable, '-m', 'unittest', 'discover', '-s', '../quality/tests', '-v'])
            control('versions', [python, '-m', 'pip', 'freeze'])
            control('dependencies', [python, '-m', 'pip', 'check'])
            control('tests', [python, '-m', 'pytest', '--cov', '--cov-report=term-missing',
                f'--cov-report=json:{relative}/coverage.json', f'--cov-report=xml:{relative}/coverage.xml',
                f'--cov-report=html:{relative}/coverage-html', f'--junitxml={relative}/tests.xml'])
            control('lint', [python, '-m', 'ruff', 'check', 'ETL', 'api', 'services',
                '--output-format', 'json', '--output-file', f'{relative}/ruff.json'])
    try:
        report['metrics'] = collect_metrics(component, output)
        required = ['tests.xml', 'coverage/lcov.info', 'coverage/index.html', 'complexity/jscpd-complexity.json'] if component == 'frontend' else ['coverage.xml', 'coverage-html/index.html']
        for name in required:
            if not (output / name).is_file():
                report['report_errors'].append(f'Missing required report: {name}')
    except (OSError, ValueError, KeyError, ElementTree.ParseError) as error:
        report['report_errors'].append(str(error))
    report['passed'] = bool(report['controls']) and ready and not report['report_errors'] and all(
        control['exit_code'] == 0 for control in report['controls']
    )
    write_json(output / 'component.json', report)
    return 0 if report['passed'] else 1


def summarize(artifacts, output):
    output.mkdir(parents=True, exist_ok=True)
    reports, errors = {}, []
    for path in artifacts.rglob('component.json'):
        report = read_json(path)
        name = report['component']
        if name in reports:
            errors.append(f'Duplicate report: {name}')
        reports[name] = report
    expected_sha = os.getenv('GITHUB_SHA')
    for name in ('frontend', 'backend'):
        if name not in reports:
            errors.append(f'Missing component report: {name}')
            continue
        report = reports[name]
        if expected_sha and report['source_sha'] != expected_sha:
            errors.append(f'{name}: wrong source SHA')
        if os.getenv('GITHUB_RUN_ID') and report['run_id'] != os.getenv('GITHUB_RUN_ID'):
            errors.append(f'{name}: wrong run ID')
        if os.getenv('GITHUB_RUN_ATTEMPT') and report['run_attempt'] != os.getenv('GITHUB_RUN_ATTEMPT'):
            errors.append(f'{name}: wrong run attempt')
        if not report.get('controls') or not isinstance(report.get('metrics'), dict):
            errors.append(f'{name}: incomplete component report')
        if not report.get('passed'):
            errors.append(f'{name}: controls or reports failed')
        result = os.getenv(f'{name.upper()}_RESULT')
        if result and result != 'success':
            errors.append(f'{name}: GitHub job result {result}')
    counts = {key: sum(report.get('metrics', {}).get('tests', {}).get(key, 0)
                        for report in reports.values() if report.get('metrics'))
              for key in ('passed', 'failed', 'skipped')}
    summary = {'source_sha': expected_sha, 'run_id': os.getenv('GITHUB_RUN_ID'),
               'run_attempt': os.getenv('GITHUB_RUN_ATTEMPT'), 'passed': not errors,
               'errors': errors, 'tests': counts, 'components': reports,
               'release_approved': False, 'quality_gates_stage': 'E04 pending'}
    write_json(output / 'summary.json', summary)
    lines = ['# EQUITAS - CI base E02', '', f"SHA: `{expected_sha or 'local'}`", '',
             f"Pruebas de producto: **{counts['passed']} aprobadas, {counts['failed']} fallidas, {counts['skipped']} omitidas**.", '',
             '| Componente | Control | Salida |', '| --- | --- | --- |']
    for name, report in sorted(reports.items()):
        for control in report['controls']:
            lines.append(f"| {name} | {control['name']} | {control['exit_code']} |")
    lines.extend(['', '## Metricas y versiones', ''])
    for name, report in sorted(reports.items()):
        lines.append(f"{name}: `{json.dumps(report.get('runtime', {}))}`.")
        metrics = report.get('metrics')
        if metrics and name == 'frontend':
            lines.extend(['', (f"Frontend: sentencias **{metrics['coverage']['statements']['pct']} %**; "
                f"ramas {metrics['coverage']['branches']['pct']} %; duplicacion {metrics['duplication']['percentage']:.2f} %."),
                (f"Auditoria completa: {metrics['audit']}; salida cruda "
                f"{metrics['audit_policy']['raw_exit_codes']}. Excepcion temporal OBS-DEP-001, no corregida.")])
        if metrics and name == 'backend':
            lines.extend(['', (f"Backend: sentencias **{metrics['coverage']['percent_statements_covered']:.2f} %**; "
                f"ramas {metrics['coverage']['percent_branches_covered']:.2f} %.")])
    lines.extend(['', '## Alcance y pendientes', '',
        'Pipeline base: no acredita el cierre de los gates E04, despliegue, smoke, cargas o integracion externa.',
        'OBS-COB-001: frontend requiere >= 60 % antes de cerrar E04. Codigo nuevo requiere >= 80 % en E04.',
        'Supabase real se mantiene omitida de forma visible; E06 debera ejecutarla en testing sin omisiones.',
        'La prueba controlada de fallo manual verifica CI; no sustituye el defecto real rojo/verde de E03.', '',
        'Resultado CI base: **' + ('aprobado' if not errors else 'fallido') + '**.', *errors])
    markdown = '\n'.join(lines) + '\n'
    (output / 'summary.md').write_text(markdown, encoding='utf-8')
    if os.getenv('GITHUB_STEP_SUMMARY'):
        with Path(os.environ['GITHUB_STEP_SUMMARY']).open('a', encoding='utf-8') as file:
            file.write(markdown)
    print(markdown)
    return 0 if not errors else 1


def main():
    # Windows redirected consoles can default to cp1252; retain Unicode test logs.
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    run = sub.add_parser('run')
    run.add_argument('component', choices=['frontend', 'backend'])
    run.add_argument('--output', type=Path, required=True)
    run.add_argument('--install', action='store_true')
    summary = sub.add_parser('summary')
    summary.add_argument('--artifacts', type=Path, required=True)
    summary.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'run':
        return component_run(args.component, args.output.resolve(), args.install)
    return summarize(args.artifacts.resolve(), args.output.resolve())


if __name__ == '__main__':
    sys.exit(main())
