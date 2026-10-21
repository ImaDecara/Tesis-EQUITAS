"""Evaluate the temporary E01 exception without discarding npm's raw result."""

import argparse
import json
import subprocess
import sys
from datetime import UTC, date, datetime
from pathlib import Path


def evaluate(audit, production, lock, policy, raw_codes, today=None):
    today = today or datetime.now(UTC).date()
    errors = []
    for label, report, code in zip(('all', 'production'), (audit, production), raw_codes, strict=True):
        if code not in (0, 1):
            errors.append(f'{label}: npm exit {code}')
        if report.get('auditReportVersion') != 2 or 'error' in report:
            errors.append(f'{label}: invalid audit report')
        vulnerabilities = report.get('vulnerabilities')
        counts = report.get('metadata', {}).get('vulnerabilities', {})
        if not isinstance(vulnerabilities, dict) or counts.get('total') != len(vulnerabilities):
            errors.append(f'{label}: missing or inconsistent vulnerability counts')
        elif code != (1 if vulnerabilities else 0):
            errors.append(f'{label}: exit code inconsistent with report')
    if errors:
        return {'accepted': False, 'errors': errors, 'accepted_packages': []}
    if production['vulnerabilities']:
        errors.append('production: new dependency findings require review')
    findings = audit['vulnerabilities']
    if findings and today >= date.fromisoformat(policy['expires_on']):
        errors.append(f"exception {policy['exception']} expired")
    allowed = policy['packages']
    direct_advisory_found = False
    for name, finding in findings.items():
        if name not in allowed or finding.get('severity') != 'high':
            errors.append(f'{name}: not covered by the reviewed high-severity exception')
            continue
        nodes = finding.get('nodes', [])
        if not nodes or set(nodes) != set(allowed[name]):
            errors.append(f'{name}: dependency paths changed')
        for node in nodes:
            package = lock.get('packages', {}).get(node, {})
            if package.get('version') != allowed[name].get(node) or package.get('dev') is not True:
                errors.append(f'{name}: version or dev-only scope changed')
        via = finding.get('via', [])
        if not via:
            errors.append(f'{name}: missing advisory chain')
        for advisory in via:
            if isinstance(advisory, str):
                if advisory not in allowed or advisory not in findings:
                    errors.append(f'{name}: unknown advisory dependency {advisory}')
            elif isinstance(advisory, dict) and advisory.get('url') == policy['advisory'] and advisory.get('severity') == 'high':
                direct_advisory_found = True
            else:
                errors.append(f'{name}: unknown advisory')
    if findings and not direct_advisory_found:
        errors.append('No reviewed advisory at the root of the dependency chain')
    return {
        'accepted': not errors, 'errors': errors,
        'accepted_packages': sorted(findings) if not errors else [],
        'exception': policy['exception'] if findings else None,
        'expires_on': policy['expires_on'],
        'raw_exit_codes': dict(zip(('all', 'production'), raw_codes, strict=True)),
        'evaluated_at_utc': datetime.now(UTC).isoformat(),
        'meaning': 'Reviewed temporary exception; findings remain open. No production findings allowed.',
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--npm', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    args.output.mkdir(parents=True, exist_ok=True)
    reports, codes = [], []
    for name, flags in [('all', []), ('production', ['--omit=dev'])]:
        result = subprocess.run(
            [args.npm, 'audit', '--json', *flags], cwd=root / 'front',
            capture_output=True, text=True, encoding='utf-8', errors='replace', check=False,
        )
        (args.output / f'npm-audit-{name}.json').write_text(result.stdout, encoding='utf-8')
        (args.output / f'npm-audit-{name}.stderr.log').write_text(result.stderr, encoding='utf-8')
        codes.append(result.returncode)
        try:
            reports.append(json.loads(result.stdout))
        except json.JSONDecodeError:
            reports.append({})
    decision = evaluate(
        *reports, json.loads((root / 'front/package-lock.json').read_text()),
        json.loads((root / 'quality/npm-audit-policy.json').read_text()), codes,
    )
    (args.output / 'npm-audit-decision.json').write_text(
        json.dumps(decision, indent=2) + '\n', encoding='utf-8',
    )
    print(json.dumps(decision, indent=2))
    return 0 if decision['accepted'] else 1


if __name__ == '__main__':
    sys.exit(main())
