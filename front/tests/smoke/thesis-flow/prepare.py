"""ALIGN-029: fixture S, validador y carga CLI reales. Requiere reset local y lock propio.

No inventa eventos de importación, no modifica fixtures E06, no inicia ni detiene el stack.
Uso desde raíz: back/.venv/bin/python front/tests/smoke/thesis-flow/prepare.py
  --private-dir /tmp/... --output <nuevo> --lock-owner <nonce de owner.json>
"""
import argparse
import base64
import csv
import hashlib
import hmac
import json
import os
from pathlib import Path
import subprocess
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[4]
LOCAL = Path('/tmp/equitas-local-db')
DB = 'supabase_db_equitas-tp-testing'
CUTOFF = '2026-09-30'


def utc():
    return datetime.now(timezone.utc).isoformat()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def jwt(secret, role):
    encode = lambda value: base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).decode().rstrip('=')
    now = int(time.time())
    unsigned = encode({'alg': 'HS256', 'typ': 'JWT'}) + '.' + encode({'role': role, 'iss': 'supabase', 'iat': now, 'exp': now + 43200})
    signature = base64.urlsafe_b64encode(hmac.new(secret.encode(), unsigned.encode(), hashlib.sha256).digest()).decode().rstrip('=')
    return unsigned + '.' + signature


def sql(text):
    result = subprocess.run(['docker', 'exec', '-i', DB, 'psql', '-X', '-q', '-At', '-F', '|', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], input=text, text=True, capture_output=True, timeout=120)
    if result.returncode:
        raise RuntimeError('Falló SQL local (no se imprime la salida privada)')
    return result.stdout.strip()


def generate(lot):
    """Dos copias declaradas de un molde sintético, con controles exactos e independientes."""
    source = ROOT / 'back/tests/fixtures/sintetico-v1'
    lot.mkdir()
    for kind in ('cabecera', 'detalle'):
        with (source / f'{kind}.tsv').open() as stream:
            reader = csv.DictReader(stream, delimiter='\t')
            fields = reader.fieldnames
            templates = [row for row in reader if row['ClaveAgrupacion'] == '3-4100']
        rows = []
        for index, letter in enumerate(('A', 'B')):
            account = str(290001 + index)
            for offset, template in enumerate(templates):
                row = {**template, 'ClaveAgrupacion': f'3-{account}', 'Cuenta': account}
                if kind == 'cabecera':
                    row.update(Identificador=f'FLOW029-{letter}', Destinatario_Id=str(290001 + index),
                               Destinatario=f'Persona Sintética FLOW029 {letter}', Destinatario_CUIT=f'99-0000029{index}-1',
                               Destinatario_Telefono='', Destinatario_Email=f'flow029-{letter.lower()}@example.invalid',
                               Deuda_Capital='900.000,00', Deuda_Actualizada='900.000,00')
                else:
                    row.update(DEUD_id=str(2900010 + index * 10 + offset), NOTD_capital='300.000,00',
                               NOTD_intereses='0,00', NOTD_totalActualizado='300.000,00', NOTD_vencimiento='01/01/2024',
                               Detalle_Deuda='Obligación sintética ALIGN-029')
                rows.append(row)
        with (lot / f'{kind}.tsv').open('w', newline='') as stream:
            writer = csv.DictWriter(stream, fields, delimiter='\t', lineterminator='\n')
            writer.writeheader()
            writer.writerows(rows)
    mapping = json.loads((ROOT / 'contracts/source-mapping.sintetico-v1.json').read_text())
    (lot / 'mapping.json').write_text(json.dumps(mapping, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--private-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--lock-owner', required=True)
    args = parser.parse_args()
    private = args.private_dir.resolve()
    if not private.is_relative_to(Path('/tmp').resolve()) or private.stat().st_mode & 0o077:
        raise ValueError('El directorio privado debe estar en /tmp y tener modo 0700')
    lock = LOCAL / 'lock'
    owner = json.loads((lock / 'owner.json').read_text())
    if owner.get('ticket') != 'ALIGN-029' or owner.get('nonce') != args.lock_owner or owner.get('inode') != lock.stat().st_ino:
        raise ValueError('No es el lock propio de ALIGN-029')
    env = dict(line.split('=', 1) for line in (LOCAL / 'supabase-local.env').read_text().splitlines() if '=' in line)
    env = {k: v.strip('"') for k, v in env.items()}
    if env.get('API_URL') != 'http://127.0.0.1:54321':
        raise ValueError('Solo stack local')
    if sql('select count(*) from public.tenant') != '0':
        raise ValueError('Se requiere reset local, no una cartera existente')
    output = args.output.resolve()
    output.mkdir()
    sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    evidence = {'version': 'thesis-flow-load.v1', 'passed': False, 'sha': sha, 'started_at_utc': utc(),
                'scope': 'isolated_branch', 'supabase_url': env['API_URL'], 'tenant': 1, 'cutoff': CUTOFF,
                'rules_version': json.loads((ROOT / 'contracts/decision-rules.v1.json').read_text())['version'],
                'rules_sha256': digest(ROOT / 'contracts/decision-rules.v1.json'), 'commands': []}
    try:
        lot = output / 'dataset'
        generate(lot)
        hashes = {kind: digest(lot / f'{kind}.tsv') for kind in ('cabecera', 'detalle')}
        dataset = hashlib.sha256(''.join(f'{key}:{hashes[key]}\n' for key in sorted(hashes)).encode()).hexdigest()
        evidence.update(dataset_sha256=dataset, file_hashes=hashes, mapping_sha256=digest(lot / 'mapping.json'))
        sql((ROOT / 'database/testing/etl-compat-catalogs.sql').read_text())
        actor = sql((ROOT / 'database/testing/etl-import-actor.sql').read_text())
        accounts = {}
        for line in sql(Path(__file__).with_name('actors.sql').read_text()).splitlines():
            label, email, password = line.split('|')
            accounts[label] = {'email': email, 'password': password}
        config = {'supabaseUrl': env['API_URL'], 'publishableKey': env['PUBLISHABLE_KEY'], 'lockNonce': args.lock_owner,
                  'reviewJwt': jwt(env['JWT_SECRET'], 'equitas_review_server'), 'jwtSecret': env['JWT_SECRET'], 'accounts': accounts}
        target = private / 'flow-config.json'
        target.write_text(json.dumps(config))
        target.chmod(0o600)
        import_env = {'EQUITAS_TARGET_ENV': 'local', 'SUPABASE_URL': env['API_URL'],
                      'SUPABASE_SERVICE_ROLE_KEY': env['SERVICE_ROLE_KEY'], 'SUPABASE_ANON_KEY': env['ANON_KEY'],
                      'EQUITAS_IMPORT_SERVER_JWT': jwt(env['JWT_SECRET'], 'equitas_import_server'), 'EQUITAS_IMPORT_ACTOR_USER': actor}
        python = str(ROOT / 'back/.venv/bin/python')
        commands = [
            ('validate', [python, '-m', 'ETL.validate_source', '--folder', str(lot), '--mapping', str(lot / 'mapping.json'), '--contract', str(ROOT / 'contracts/source-contract.v1.json'), '--cut-off', CUTOFF, '--output', str(output / 'validator')], {}),
            ('load', [python, '-m', 'ETL.run_etl', '--folder', str(lot), '--mapping', str(lot / 'mapping.json'), '--execute', '--cut-off', CUTOFF], import_env),
        ]
        for label, command, variables in commands:
            started = utc()
            result = subprocess.run(command, cwd=ROOT / 'back', env={'PATH': os.environ['PATH'], **variables}, text=True, capture_output=True, timeout=600)
            log = private / f'flow-{label}.log'
            log.write_text(result.stdout + result.stderr)
            log.chmod(0o600)
            evidence['commands'].append({'command': command, 'cwd': str(ROOT / 'back'), 'sha': sha,
                                         'started_at_utc': started, 'ended_at_utc': utc(), 'exit_code': result.returncode,
                                         'environment': 'local; sin secretos en evidencia'})
            if result.returncode:
                raise RuntimeError(f'{label}: exit {result.returncode}; salida solo en log privado')
        validation = json.loads((output / 'validator/report.json').read_text())
        assert validation['resultado_lote'] == 'VALIDADO' and validation['publicacion_permitida'] is True
        assert validation['conteos']['objetos_aceptados'] == 2
        events = json.loads(sql("select json_agg(t order by id) from (select id,status,supersedes,file_hashes,as_of,rules_version,counts,source from public.import_batch) t"))
        assert [event['status'] for event in events] == ['VALIDADO', 'PUBLICADO']
        assert events[1]['supersedes'] == events[0]['id']
        for event in events:
            assert all(event['file_hashes'][key] == value for key, value in hashes.items())
            assert event['as_of'] == CUTOFF and event['rules_version'] == evidence['rules_version'] and event['source'] == 'ETL_CLI'
        debtors = json.loads(sql('select json_agg(t order by identifier) from (select id,identifier from public.debtor where tenant=1) t'))
        assert [row['identifier'] for row in debtors] == ['FLOW029-A', 'FLOW029-B']
        totals = json.loads(sql('select json_build_object(\'objects\',(select count(*) from public.debtor),\'obligations\',count(*),\'amount\',sum(current_amount)) from public.debt'))
        assert totals == {'objects': 2, 'obligations': 6, 'amount': 1800000}
        evidence.update(passed=True, events=events, debtors=debtors, totals=totals,
                        validator_sha256=digest(output / 'validator/report.json'))
    finally:
        evidence['ended_at_utc'] = utc()
        (output / 'load.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print('Fixture sintética: validador y carga reales OK; 2 objetos, 6 obligaciones, ARS 1800000')


if __name__ == '__main__':
    main()
