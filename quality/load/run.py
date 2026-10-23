"""One-command, loopback-only campaign with provenance and failure evidence."""

import argparse
import csv
import gzip
import hashlib
import json
import os
import platform
import signal
import socket
import subprocess
import sys
import sysconfig
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from quality.load.fixture import digest, make_dataset, make_oracle
from quality.load.report import evaluate, phases


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def process_sample(pid):
    if platform.system() != 'Linux':
        return None
    try:
        fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        return {'cpu_seconds': (int(fields[11]) + int(fields[12])) / os.sysconf('SC_CLK_TCK'),
                'rss_mib': int(fields[21]) * os.sysconf('SC_PAGE_SIZE') / 1024**2}
    except (OSError, ValueError, IndexError):
        return None


def environment():
    result = {k: v for k, v in os.environ.items() if not k.startswith(('SUPABASE', 'NEXT_PUBLIC_SUPABASE', 'VERCEL'))
              and k not in ('GH_TOKEN', 'GITHUB_TOKEN')}
    result['PYTHONPATH'] = str(ROOT)
    return result


def campaign(mode, output, binary):
    if (output / 'run.json').exists():
        raise ValueError('Use a new output directory to preserve prior evidence')
    output.mkdir(parents=True, exist_ok=True)
    policy = json.loads((ROOT / 'quality/load/policy.json').read_text(encoding='utf-8'))
    sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip())
    report = {'stage': 'E08', 'scenario': mode, 'source_sha': sha, 'dirty_worktree': dirty,
              'run_id': os.getenv('GITHUB_RUN_ID'), 'run_attempt': os.getenv('GITHUB_RUN_ATTEMPT'),
              'started_at_utc': datetime.now(UTC).isoformat(), 'passed': False, 'errors': [],
              'policy_version': policy['version'], 'policy_sha256': digest(policy),
              'environment': {'os': platform.platform(), 'python': platform.python_version(),
                              'cpu_count': os.cpu_count(), 'machine': platform.machine(),
                              'server_config': policy['server'], 'shared_server_generator_host': True},
              'resources_supported': platform.system() == 'Linux'}
    write(output / 'run.json', report)
    server = generator = None
    server_log = generator_log = None
    resources, previous = [], {}
    stop_reason, code, elapsed = None, -1, 0
    raw = output / 'samples.ndjson'
    try:
        version = subprocess.check_output([str(binary), 'version'], text=True).strip()
        if 'v' + policy['tool']['version'] + ' ' not in version:
            raise ValueError('Wrong k6 version; run the pinned installer')
        report['k6_version'] = version
        report['k6_binary_sha256'] = hashlib.sha256(binary.read_bytes()).hexdigest()
        for name in ('uvicorn', 'fastapi', 'starlette', 'anyio'):
            from importlib.metadata import version as package_version
            report.setdefault('python_packages', {})[name] = package_version(name)
        if platform.system() == 'Linux':
            report['environment']['cpu_model'] = next((line.split(':', 1)[1].strip() for line in Path('/proc/cpuinfo').read_text().splitlines() if line.startswith('model name')), 'unavailable')
            report['environment']['memory_kib'] = int(Path('/proc/meminfo').read_text().splitlines()[0].split()[1])
        oracle = make_oracle()
        write(output / 'oracle.json', oracle)
        write(output / 'policy.json', policy)
        report['dataset'] = {k: oracle[k] for k in ('fixture_version', 'dataset_hash', 'profiles', 'debtors', 'represented_debts')}
        profiles, debtors, _ = make_dataset()
        with gzip.open(output / 'dataset.json.gz', 'wt', encoding='utf-8') as stream:
            json.dump({'profiles': profiles, 'debtors': debtors}, stream, separators=(',', ':'))
        with socket.socket() as lease:
            lease.bind(('127.0.0.1', 0))
            port = lease.getsockname()[1]
        env = environment()
        env['QUALITY_SOURCE_SHA'] = sha
        # Windows venv redirectors spawn a different PID; use the base interpreter
        # with this venv's package directory so ownership/cleanup stay exact.
        server_python = sys.executable
        if os.name == 'nt':
            server_python = sys._base_executable
            env['PYTHONPATH'] += os.pathsep + sysconfig.get_path('purelib')
        server_command = [server_python, '-m', 'uvicorn', 'quality.load.server:app', '--host', '127.0.0.1',
                          '--port', str(port), '--workers', '1', '--loop', 'asyncio', '--http', 'h11',
                          '--log-level', 'warning', '--no-access-log']
        report['server_command'] = server_command
        server_log = (output / 'server.log').open('w', encoding='utf-8')
        flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        server = subprocess.Popen(server_command, cwd=ROOT, env=env, stdout=server_log,
                                  stderr=subprocess.STDOUT, creationflags=flags)
        base = 'http://127.0.0.1:' + str(port)
        ready = time.monotonic() + 60
        while True:
            if server.poll() is not None:
                raise ValueError('Isolated server exited; inspect server.log')
            try:
                with urllib.request.urlopen(base + '/__quality', timeout=2) as response:
                    meta = json.load(response)
                report['server_metadata'] = meta
                if meta['pid'] != server.pid or meta['dataset_hash'] != oracle['dataset_hash'] or meta['source_sha'] != sha:
                    raise ValueError('Wrong process, dataset or source version on loopback')
                break
            except (urllib.error.URLError, TimeoutError):
                if time.monotonic() > ready:
                    raise ValueError('Server readiness timeout') from None
                time.sleep(0.25)
        env.update(BASE_URL=base, ORACLE_PATH=str(output / 'oracle.json'), SOURCE_SHA=sha,
                   LOAD_SCENARIO=mode, K6_SUMMARY_PATH=str(output / 'k6-summary.json'),
                   K6_NO_USAGE_REPORT='true', K6_WEB_DASHBOARD='true', K6_WEB_DASHBOARD_PORT='-1',
                   K6_WEB_DASHBOARD_PERIOD='5s', K6_WEB_DASHBOARD_EXPORT=str(output / 'report.html'),
                   K6_WEB_DASHBOARD_OPEN='false', NO_COLOR='1')
        command = [str(binary), 'run', '--out', 'json=' + str(raw), str(ROOT / 'quality/load/scenarios.js')]
        report['generator_command'] = command
        generator_log = (output / 'k6.log').open('w', encoding='utf-8')
        generator = subprocess.Popen(command, cwd=ROOT, env=env, stdout=generator_log,
                                     stderr=subprocess.STDOUT, creationflags=flags)
        started = time.monotonic()
        schedule = phases(policy, mode)
        seconds = sum(p[2] for p in schedule) + policy['drain_seconds'] * (len(schedule) - 1)
        deadline = started + seconds + policy['stop']['deadline_extra_seconds']
        while generator.poll() is None:
            now = time.monotonic()
            for label, process in [('server', server), ('generator', generator)]:
                sample = process_sample(process.pid)
                if sample is not None:
                    old = previous.get(label)
                    cpu_pct = 100 * (sample['cpu_seconds'] - old[1]) / (now - old[0]) if old else None
                    previous[label] = (now, sample['cpu_seconds'])
                    resources.append({'at_utc': datetime.now(UTC).isoformat(), 'elapsed_seconds': now - started,
                                      'process': label, 'pid': process.pid, 'cpu_pct_one_core': cpu_pct, **sample})
                    if sample['rss_mib'] > policy['stop']['process_rss_mib_max']:
                        stop_reason = label + ' RSS budget exceeded'
            if server.poll() is not None:
                stop_reason = 'Server process exited during campaign'
            if now > deadline:
                stop_reason = 'Configured campaign deadline exceeded'
            if raw.exists() and raw.stat().st_size > policy['stop']['raw_output_mib_max'] * 1024**2:
                stop_reason = 'Raw output budget exceeded'
            if stop_reason:
                generator.terminate()
                break
            time.sleep(policy['acceptance']['resource_sample_seconds'])
        code = generator.wait(timeout=20)
        elapsed = time.monotonic() - started
    except (OSError, ValueError, KeyError, subprocess.SubprocessError, KeyboardInterrupt) as error:
        stop_reason = type(error).__name__ + ': ' + str(error)
    finally:
        for process in (generator, server):
            if process is not None and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
        for stream in (server_log, generator_log):
            if stream is not None:
                stream.close()
        result = evaluate(raw, policy, mode, code, elapsed, stop_reason)
        report.update(result, k6_exit_code=code, stop_reason=stop_reason,
                      resources=resources, finished_at_utc=datetime.now(UTC).isoformat())
        if (output / 'k6-summary.json').exists():
            report['k6_run_state'] = json.loads((output / 'k6-summary.json').read_text(encoding='utf-8')).get('state', {})
        if not report['resources_supported']:
            report['resource_limit'] = 'Linux /proc CPU/RSS collector unavailable on this OS; resources not measured'
        report['code_sha256'] = {str(p.relative_to(ROOT)).replace('\\', '/'): hashlib.sha256(p.read_bytes().replace(b'\r\n', b'\n')).hexdigest()
                                 for p in [* (ROOT / 'quality/load').glob('*.py'), ROOT / 'quality/load/scenarios.js',
                                           ROOT / 'back/api/main.py', ROOT / 'back/services/scoring_service.py']}
        write(output / 'run.json', report)
        write(output / 'series.json', report['time_series'])
        if report['time_series']:
            with (output / 'series.csv').open('w', newline='', encoding='utf-8') as stream:
                writer = csv.DictWriter(stream, fieldnames=list(report['time_series'][0]))
                writer.writeheader()
                writer.writerows(report['time_series'])
        if resources:
            with (output / 'resources.csv').open('w', newline='', encoding='utf-8') as stream:
                writer = csv.DictWriter(stream, fieldnames=list(resources[0]))
                writer.writeheader()
                writer.writerows(resources)
        if raw.exists():
            with raw.open('rb') as source, gzip.open(output / 'samples.ndjson.gz', 'wb') as destination:
                import shutil
                shutil.copyfileobj(source, destination)
            raw.unlink()
        passed = report['passed']
        xml = '<testsuite name="E08 isolated API load" tests="1" failures="' + ('0' if passed else '1') + '" skipped="0"><testcase name="' + mode + '">'
        if not passed:
            xml += '<failure message="Prior load criteria failed">' + escape('\n'.join(report['errors'])) + '</failure>'
        (output / 'tests.xml').write_text(xml + '</testcase></testsuite>\n', encoding='utf-8')
        markdown = '# E08 - ' + mode + '\n\nSHA: `' + sha + '`. Policy: `' + report['policy_sha256'] + '`.\n\n**' + ('APROBADO' if passed else 'FALLIDO') + '**. One campaign; warmup excluded from main SLO.\n\n'
        markdown += '| Phase | VUs | Requests | p50 ms | p95 ms | p99 ms | Errors | req/s | SLO required |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |\n'
        for row in report['phases']:
            numbers = [f'{row[key]:.2f}' if row[key] is not None else 'n/a' for key in ('p50_ms', 'p95_ms', 'p99_ms')]
            markdown += f'| {row["phase"]} | {row["users"]} | {row["requests"]} | ' + ' | '.join(numbers) + f' | {row["unexpected_errors"]} | {row["requests_per_second"]:.2f} | {row["slo_required"]} |\n'
        markdown += '\nActual process duration: ' + str(round(elapsed, 3)) + ' s.\n\n' + '\n'.join(report['errors']) + '\n'
        markdown += '\nScope: isolated production API processing; synthetic source; no cloud/Web capacity claim.\n'
        (output / 'summary.md').write_text(markdown, encoding='utf-8')
        if os.getenv('GITHUB_STEP_SUMMARY'):
            with Path(os.environ['GITHUB_STEP_SUMMARY']).open('a', encoding='utf-8') as stream:
                stream.write(markdown)
        print(markdown)
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('scenario', choices=['poc', 'stress', 'soak'])
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--k6', type=Path, default=ROOT / '.quality/tools/k6' / ('k6.exe' if os.name == 'nt' else 'k6'))
    args = parser.parse_args()
    if hasattr(signal, 'SIGTERM'):
        def stopped(signum, frame):
            raise KeyboardInterrupt('Termination requested')
        signal.signal(signal.SIGTERM, stopped)
    sys.exit(campaign(args.scenario, args.output.resolve(), args.k6.resolve()))
