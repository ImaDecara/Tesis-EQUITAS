"""Manual laboratory probe: add a disclosed synthetic critical diagnostic."""

import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path


def inject(artifacts, output):
    if os.getenv('GITHUB_EVENT_NAME') != 'workflow_dispatch' or os.getenv('CI_GATE_PROBE') != 'critical':
        raise ValueError('Critical report probe is restricted to explicit manual runs')
    candidates = list(artifacts.rglob('ruff.json'))
    if len(candidates) != 1:
        raise ValueError('Exactly one original Ruff report is required')
    path = candidates[0]
    findings = json.loads(path.read_text(encoding='utf-8'))
    if findings != []:
        raise ValueError('Probe requires a clean original Ruff report')
    output.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, output / 'ruff-before-probe.json')
    findings.append({'code': 'F821', 'message': 'E04 controlled synthetic diagnostic: undefined name',
                     'filename': 'services/__e04_report_probe__.py', 'location': {'row': 1, 'column': 1}})
    path.write_text(json.dumps(findings, indent=2) + '\n', encoding='utf-8')
    shutil.copyfile(path, output / 'ruff-after-probe.json')
    record = {'synthetic': True, 'mode': 'critical', 'source_sha': os.getenv('GITHUB_SHA'),
              'run_id': os.getenv('GITHUB_RUN_ID'), 'run_attempt': os.getenv('GITHUB_RUN_ATTEMPT'),
              'original_sha256': hashlib.sha256((output / 'ruff-before-probe.json').read_bytes()).hexdigest(),
              'modified_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
              'meaning': 'Report injection only; source and original component artifacts are unchanged. Not the E03 real defect.'}
    (output / 'gate-probe.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    return record


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    inject(args.artifacts, args.output)


if __name__ == '__main__':
    main()
