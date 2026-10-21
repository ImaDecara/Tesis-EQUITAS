"""Select a fresh Vercel preview by exact SHA after successful quality CI."""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlencode, urlsplit

ROOT = Path(__file__).resolve().parents[1]
POLICY = json.loads((ROOT / 'quality/preview-policy.json').read_text(encoding='utf-8'))
FIXTURE = json.loads((ROOT / 'quality/supabase-testing.json').read_text(encoding='utf-8'))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def validate_build(info, sha):
    if info.get('sourceBranch') != POLICY['branch']:
        return False
    if (info.get('sourceSha') != sha or info.get('environment') != 'preview'
            or info.get('supabaseProjectRef') != FIXTURE['project_ref']):
        raise ValueError('El preview de la rama de testing tiene SHA, entorno o Supabase incorrectos.')
    return True


def select_preview(deployments, statuses, sha):
    for deployment in deployments:
        if (deployment.get('sha') != sha or deployment.get('environment') != POLICY['environment']
                or deployment.get('creator', {}).get('login') != POLICY['creator']):
            continue
        latest = statuses.get(deployment['id'], [])
        if not latest:
            continue
        status = latest[0]
        if status.get('state') in ('failure', 'error'):
            raise ValueError('El despliegue preview del SHA evaluado fallo en Vercel.')
        if status.get('state') != 'success':
            continue
        url = status.get('environment_url', '')
        parts = urlsplit(url)
        if (parts.scheme != 'https' or not re.fullmatch(POLICY['hostname_pattern'], parts.netloc)
                or parts.path not in ('', '/') or parts.query or parts.fragment):
            raise ValueError('URL de despliegue inesperada; no se entregan credenciales a otro destino.')
        return {'deployment_id': deployment['id'], 'url': url.rstrip('/'), 'source_sha': sha,
                'environment': deployment['environment'], 'deployment_created_at': deployment['created_at'],
                'ready_at': status.get('created_at'), 'provider': POLICY['provider']}
    return None


def validate_quality(quality, sha, repository):
    if (quality['head_sha'] != sha or quality['conclusion'] != 'success'
            or quality['head_branch'] != POLICY['branch']
            or quality['event'] not in ('push', 'workflow_dispatch')
            or quality['head_repository']['full_name'] != repository
            or quality['path'] != '.github/workflows/quality-ci.yml'):
        raise ValueError('La ejecucion de calidad no corresponde al SHA/rama/contexto confiable.')


def main(output, sha, run_id):
    output.mkdir(parents=True, exist_ok=True)
    record = {'passed': False, 'source_sha': sha, 'quality_run_id': run_id,
              'started_at_utc': datetime.now(UTC).isoformat(), 'errors': []}
    repository = os.getenv('GITHUB_REPOSITORY', 'ImaDecara/Tesis-EQUITAS')

    def api(path):
        token = os.getenv('GH_TOKEN') or os.getenv('GITHUB_TOKEN')
        if not token:
            raise ValueError('Falta el token GitHub del job para verificar CI y despliegue.')
        req = urllib.request.Request('https://api.github.com/repos/' + repository + '/' + path,
                                     headers={'Authorization': 'Bearer ' + token,
                                              'Accept': 'application/vnd.github+json'})
        with urllib.request.urlopen(req, timeout=20) as response:
            return json.load(response)

    try:
        if not re.fullmatch(r'[a-f0-9]{40}', sha) or not str(run_id).isdigit():
            raise ValueError('Se requiere SHA completo e ID de ejecucion de calidad.')
        quality = api('actions/runs/' + str(run_id))
        validate_quality(quality, sha, repository)
        deadline = time.monotonic() + POLICY['deployment_timeout_seconds']
        while time.monotonic() < deadline:
            deployments = api('deployments?' + urlencode({'sha': sha, 'per_page': 100}))
            candidates = [d for d in deployments if d.get('sha') == sha and d.get('environment') == POLICY['environment']]
            statuses = {d['id']: api(f'deployments/{d["id"]}/statuses?per_page=1') for d in candidates}
            for candidate in candidates:
                selected = select_preview([candidate], statuses, sha)
                if not selected:
                    continue
                headers = {}
                if os.getenv('VERCEL_AUTOMATION_BYPASS_SECRET'):
                    headers['x-vercel-protection-bypass'] = os.environ['VERCEL_AUTOMATION_BYPASS_SECRET']
                request = urllib.request.Request(selected['url'] + '/api/build-info', headers=headers)
                try:
                    # No se siguen redirects que puedan reenviar el header a otro origen.
                    with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
                        info = json.load(response)
                except urllib.error.HTTPError as error:
                    if error.code in (301, 302, 303, 307, 308, 401, 403):
                        raise ValueError('Preview protegido; falta configurar VERCEL_AUTOMATION_BYPASS_SECRET.') from error
                    if error.code in (404, 502, 503):
                        continue
                    raise
                if validate_build(info, sha):
                    record.update(selected, passed=True, build_info=info)
                    break
            if record['passed']:
                break
            time.sleep(15)
        if not record['passed']:
            raise ValueError('Timeout esperando un preview nuevo para el SHA exacto; no se usa una URL anterior.')
    except (ValueError, KeyError, OSError, urllib.error.URLError) as error:
        record['errors'].append(str(error))
    record['finished_at_utc'] = datetime.now(UTC).isoformat()
    (output / 'deployment.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(record, ensure_ascii=False))
    return 0 if record['passed'] else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--sha', required=True)
    parser.add_argument('--quality-run-id', required=True)
    args = parser.parse_args()
    sys.exit(main(args.output.resolve(), args.sha, args.quality_run_id))
