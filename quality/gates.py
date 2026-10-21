"""Fail-closed quality gates over original reports and a fixed product base."""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[1]
POLICY = ROOT / 'quality/gate-policy.json'


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def integer(value, minimum=0):
    if type(value) is not int or value < minimum:
        raise ValueError(f'Invalid nonnegative integer: {value!r}')
    return value


def ratio(covered, total, threshold, minimum=True, allow_empty=False):
    integer(covered)
    integer(total)
    if covered > total or (total == 0 and not allow_empty):
        raise ValueError('Invalid coverage/duplication denominator')
    if total == 0:
        return {'covered': 0, 'total': 0, 'pct': None, 'applicable': False, 'passed': True}
    passed = 100 * covered >= threshold * total if minimum else 100 * covered <= threshold * total
    return {'covered': covered, 'total': total, 'pct': 100 * covered / total,
            'applicable': True, 'passed': passed}


def git(root, *args):
    return subprocess.check_output(['git', '-c', 'core.quotepath=false', *args], cwd=root,
                                   encoding='utf-8', stderr=subprocess.PIPE)


def product_files(root, policy):
    files = git(root, 'ls-files', '-z').split('\0')
    result = {}
    for name, prefixes in policy['scope'].items():
        result[name] = {f for f in files if f.startswith(tuple(prefixes)) and (
            (name == 'frontend' and f.endswith(('.ts', '.tsx')) and not f.endswith('.d.ts')) or
            (name == 'backend' and f.endswith('.py')))}
        if not result[name]:
            raise ValueError(f'Empty product scope: {name}')
    return result


def normalize_path(value, module):
    value = value.replace('\\', '/')
    prefix = 'front/' if module == 'frontend' else 'back/'
    if '/' + prefix in value:
        value = prefix + value.rsplit('/' + prefix, 1)[1]
    elif not value.startswith(prefix):
        value = prefix + value
    if '..' in value.split('/') or ':' in value or value.startswith('/'):
        raise ValueError(f'Unexpected coverage path: {value}')
    return value


def read_lcov(path):
    result, current, ended = {}, None, True
    for line in path.read_text(encoding='utf-8').splitlines():
        if line.startswith('SF:'):
            current = normalize_path(line[3:], 'frontend')
            if current in result or not ended:
                raise ValueError('Duplicate or unterminated LCOV record')
            result[current], ended = {}, False
        elif line.startswith('DA:'):
            if current is None:
                raise ValueError('LCOV DA without file')
            number, hits, *_ = line[3:].split(',')
            number, hits = integer(int(number), 1), integer(int(hits))
            if number in result[current]:
                raise ValueError('Duplicate executable LCOV line')
            result[current][number] = hits > 0
        elif line == 'end_of_record':
            if current is None:
                raise ValueError('Unexpected LCOV end')
            current, ended = None, True
    if not result or not ended:
        raise ValueError('Empty or truncated LCOV report')
    return result


def read_python_lines(data):
    result = {}
    for path, report in data['files'].items():
        path = normalize_path(path, 'backend')
        if path in result:
            raise ValueError('Duplicate Python coverage file')
        executed = {integer(n, 1) for n in report['executed_lines']}
        missing = {integer(n, 1) for n in report['missing_lines']}
        if executed & missing:
            raise ValueError('Overlapping executed/missing lines')
        if integer(report['summary']['num_statements']) != len(executed | missing):
            raise ValueError('Python coverage line totals disagree')
        result[path] = {n: n in executed for n in executed | missing}
    if not result:
        raise ValueError('Empty Python coverage report')
    return result


def added_lines(diff):
    result, path, number = {}, None, None
    for line in diff.splitlines():
        if line.startswith('+++ '):
            value = line[4:].split('\t', 1)[0]
            value = json.loads(value) if value.startswith('"') else value
            path = value[2:] if value.startswith('b/') else None
            if path:
                result[path] = set()
        elif line.startswith('@@'):
            number = int(re.search(r'\+(\d+)', line).group(1))
        elif line.startswith('+') and path and number is not None:
            result[path].add(number)
            number += 1
        elif line.startswith(' ') and number is not None:
            number += 1
    return result


def new_coverage(changes, coverage, files, threshold):
    details = []
    for path in sorted(changes.keys() & files):
        if path not in coverage:
            raise ValueError(f'Missing coverage for changed product file: {path}')
        executable = sorted(changes[path] & coverage[path].keys())
        covered = [n for n in executable if coverage[path][n]]
        measured_file = ratio(len(covered), len(executable), threshold, allow_empty=True)
        measured_file.pop('passed')  # The 80% decision is per module; files explain its denominator.
        details.append({'path': path, 'executable_new_lines': executable, 'covered_new_lines': covered,
                        **measured_file})
    measured = ratio(sum(d['covered'] for d in details), sum(d['total'] for d in details),
                     threshold, allow_empty=True)
    return {**measured, 'files': details}


def classify_findings(eslint, ruff, policy):
    if not isinstance(eslint, list) or not eslint or not isinstance(ruff, list):
        raise ValueError('Invalid or empty analysis report')
    findings, critical = [], []
    for file in eslint:
        integer(file['errorCount'])
        integer(file['warningCount'])
        messages = file['messages']
        if not isinstance(messages, list):
            raise TypeError('Invalid ESLint messages')
        if file['errorCount'] != sum(m['severity'] == 2 for m in messages) or file['warningCount'] != sum(m['severity'] == 1 for m in messages):
            raise ValueError('ESLint counts disagree with messages')
        for message in messages:
            if type(message['severity']) is not int:
                raise TypeError('Invalid ESLint severity type')
            if message['severity'] not in (1, 2):
                raise ValueError('Unknown ESLint severity')
            finding = {'tool': 'eslint', 'path': file['filePath'], 'rule': message['ruleId'],
                       'line': message.get('line'), 'message': message['message']}
            findings.append(finding)
            if message.get('fatal') or finding['rule'] in policy['critical_rules']['eslint']:
                critical.append(finding)
    for item in ruff:
        finding = {'tool': 'ruff', 'path': item['filename'], 'rule': item['code'],
                   'line': item['location']['row'], 'message': item['message']}
        findings.append(finding)
        if finding['rule'] in policy['critical_rules']['ruff']:
            critical.append(finding)
    return {'findings': findings, 'critical': critical, 'passed': not findings}


def evaluate_gates(artifacts, root=ROOT, policy_path=POLICY):
    report = {'stage': 'E04', 'passed': False, 'checks': [], 'errors': [], 'source_sha': None,
              'base_sha': None, 'release_approved': False}

    def check(name, passed, observed, criterion):
        report['checks'].append({'id': name, 'passed': passed, 'observed': observed, 'criterion': criterion})

    try:
        policy = read_json(policy_path)
        if (policy['version'], policy['minimum_statements_pct'], policy['minimum_new_lines_pct'],
            policy['maximum_duplicated_lines_pct']) != (1, 60, 80, 5):
            raise ValueError('Unexpected policy version or TP thresholds')
        report['policy_sha256'] = hashlib.sha256(policy_path.read_bytes()).hexdigest()
        report['criteria'] = policy
        base = report['base_sha'] = policy['base_sha']
        if base != '531996f51243dc3d4c5a607338e2f35e32313f6b':
            raise ValueError('The fixed TP base must not change to empty the diff')
        head = report['source_sha'] = git(root, 'rev-parse', 'HEAD').strip()
        git(root, 'cat-file', '-e', base + '^{commit}')
        git(root, 'merge-base', '--is-ancestor', base, head)
        check('fixed_base', True, {'base': base, 'head': head}, 'Fixed base exists and is an ancestor of HEAD')
        directories = {}
        controls = {}
        for path in artifacts.rglob('component.json'):
            manifest = read_json(path)
            name = manifest['component']
            if name not in ('frontend', 'backend') or name in directories:
                raise ValueError(f'Duplicate/unknown component: {name}')
            if manifest['source_sha'] != head:
                raise ValueError(f'{name}: report source does not match HEAD')
            for env, field in [('GITHUB_RUN_ID', 'run_id'), ('GITHUB_RUN_ATTEMPT', 'run_attempt')]:
                if os.getenv(env) and manifest[field] != os.getenv(env):
                    raise ValueError(f'{name}: wrong {field}')
            directories[name], controls[name] = path.parent, manifest
        if set(directories) != {'frontend', 'backend'}:
            raise ValueError('Both component reports are required')
        required = {'frontend': {'dependencies', 'tests', 'lint', 'build', 'duplication', 'complexity', 'audit'},
                    'backend': {'infrastructure-tests', 'infrastructure-lint', 'versions', 'dependencies', 'tests', 'lint'}}
        controls_ok = True
        for name, manifest in controls.items():
            names = [c['name'] for c in manifest['controls']]
            if len(names) != len(set(names)) or not required[name] <= set(names):
                raise ValueError(f'{name}: missing/duplicate controls')
            controls_ok &= manifest['passed'] is True and not manifest['report_errors'] and all(
                type(c['exit_code']) is int and c['exit_code'] == 0 for c in manifest['controls'])
            counts = manifest['metrics']['tests']
            controls_ok &= integer(counts['passed'], 1) > 0 and integer(counts['failed']) == 0
        check('build_and_tests', bool(controls_ok), {n: c['passed'] for n, c in controls.items()},
              'All required isolated controls and suites pass; mandatory real integration is verified separately by CI summary')
        for name, directory in directories.items():
            cases = list(ElementTree.parse(directory / 'tests.xml').getroot().iter('testcase'))
            failed = sum(c.find('failure') is not None or c.find('error') is not None for c in cases)
            skipped = sum(c.find('skipped') is not None for c in cases)
            counts = {'passed': len(cases) - failed - skipped, 'failed': failed, 'skipped': skipped}
            if not cases or counts != controls[name]['metrics']['tests']:
                raise ValueError(f'{name}: JUnit counts disagree with component report')
        frontend, backend = directories['frontend'], directories['backend']
        vitest = read_json(frontend / 'tests.json')
        if {k: integer(vitest[v]) for k, v in [('passed', 'numPassedTests'), ('failed', 'numFailedTests'), ('skipped', 'numPendingTests')]} != controls['frontend']['metrics']['tests']:
            raise ValueError('Vitest JSON counts disagree with component report')
        summary = read_json(frontend / 'coverage/coverage-summary.json')
        python = read_json(backend / 'coverage.json')
        coverage = {'frontend': read_lcov(frontend / 'coverage/lcov.info'), 'backend': read_python_lines(python)}
        files = product_files(root, policy)
        summary_files = {normalize_path(p, 'frontend') for p in summary if p != 'total'}
        if summary_files != files['frontend'] or set(coverage['frontend']) != files['frontend'] or set(coverage['backend']) != files['backend']:
            raise ValueError('Coverage file inventory differs from the declared product scope')
        for path, values in summary.items():
            if path != 'total':
                lines = coverage['frontend'][normalize_path(path, 'frontend')]
                if (integer(values['lines']['total']) != len(lines) or
                    integer(values['lines']['covered']) != sum(lines.values())):
                    raise ValueError('LCOV lines disagree with frontend coverage summary')
        front_total = summary['total']['statements']
        if (sum(integer(v['statements']['total']) for k, v in summary.items() if k != 'total') != integer(front_total['total']) or
            sum(integer(v['statements']['covered']) for k, v in summary.items() if k != 'total') != integer(front_total['covered'])):
            raise ValueError('Frontend coverage totals disagree with per-file values')
        back_total = python['totals']
        if (integer(back_total['num_statements']) != sum(len(v) for v in coverage['backend'].values()) or
            integer(back_total['covered_lines']) != sum(sum(v.values()) for v in coverage['backend'].values())):
            raise ValueError('Backend coverage totals disagree with executable lines')
        for name, covered, total in [('frontend', front_total['covered'], front_total['total']),
                                    ('backend', back_total['covered_lines'], back_total['num_statements'])]:
            metric = ratio(covered, total, policy['minimum_statements_pct'])
            check(name + '_statements', metric['passed'], metric, 'Statements >= 60%, declared full scope')
        diff = git(root, 'diff', '--no-ext-diff', '--no-renames', '--unified=0', base, head, '--', 'front/app', 'front/components', 'front/lib', 'back/ETL', 'back/api', 'back/services')
        changes = added_lines(diff)
        report['diff_sha256'] = hashlib.sha256(diff.encode('utf-8')).hexdigest()
        for name in ('frontend', 'backend'):
            metric = new_coverage(changes, coverage[name], files[name], policy['minimum_new_lines_pct'])
            check(name + '_new_lines', metric['passed'], metric, 'New executable lines >= 80%; no new executable lines = not applicable')
        duplicates = read_json(frontend / 'duplication/jscpd-report.json')['statistics']['total']
        metric = ratio(duplicates['duplicatedLines'], duplicates['lines'], policy['maximum_duplicated_lines_pct'], minimum=False)
        check('duplication', metric['passed'], metric, 'Duplicated lines <= 5% (not rounded percentage or tokens)')
        analysis = classify_findings(read_json(frontend / 'eslint.json'), read_json(backend / 'ruff.json'), policy)
        check('critical_bugs', not analysis['critical'], analysis['critical'], 'Zero project-classified critical findings')
        check('static_analysis', analysis['passed'], analysis['findings'], 'Zero ESLint errors/warnings and unaccepted Ruff findings')
        audit = read_json(frontend / 'npm-audit-decision.json')
        all_audit = read_json(frontend / 'npm-audit-all.json')['metadata']['vulnerabilities']
        production = read_json(frontend / 'npm-audit-production.json')['metadata']['vulnerabilities']
        audit_ok = audit['accepted'] is True and integer(all_audit['critical']) == 0 and integer(production['total']) == 0
        check('dependencies', audit_ok, audit, 'Separate reviewed audit policy; no critical or production vulnerabilities')
    except (OSError, ValueError, KeyError, TypeError, AttributeError, ElementTree.ParseError, subprocess.CalledProcessError) as error:
        report['errors'].append(str(error))
        check('report_integrity', False, str(error), 'Reports, fixed base and source mappings must be valid and complete')
    report['passed'] = bool(report['checks']) and not report['errors'] and all(c['passed'] for c in report['checks'])
    return report


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    parser = argparse.ArgumentParser()
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = evaluate_gates(args.artifacts.resolve())
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'gate.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
