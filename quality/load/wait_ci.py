"""Require successful quality CI of the exact trusted commit before load jobs."""

import argparse
import json
import os
import re
import sys
import time
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlencode


def validate_run(run, sha, branch, repository):
    return (run.get('head_sha') == sha and run.get('head_branch') == branch
            and run.get('head_repository', {}).get('full_name') == repository
            and run.get('event') in ('push', 'workflow_dispatch')
            and run.get('path') == '.github/workflows/quality-ci.yml')


def main(output):
    output.mkdir(parents=True, exist_ok=True)
    sha = os.environ['GITHUB_SHA']
    branch = os.environ['GITHUB_REF_NAME']
    repository = os.environ['GITHUB_REPOSITORY']
    record = {'passed': False, 'source_sha': sha, 'branch': branch,
              'started_at_utc': datetime.now(UTC).isoformat(), 'errors': []}
    try:
        if not re.fullmatch(r'[a-f0-9]{40}', sha) or branch not in ('quality/e08-rendimiento', 'main'):
            raise ValueError('Untrusted load source')
        deadline = time.monotonic() + 360
        while time.monotonic() < deadline:
            query = urlencode({'head_sha': sha, 'branch': branch, 'per_page': 20})
            request = urllib.request.Request('https://api.github.com/repos/' + repository + '/actions/workflows/quality-ci.yml/runs?' + query,
                                             headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
                                                      'Accept': 'application/vnd.github+json'})
            with urllib.request.urlopen(request, timeout=20) as response:
                runs = json.load(response)['workflow_runs']
            matches = [run for run in runs if validate_run(run, sha, branch, repository)]
            if matches and matches[0]['status'] == 'completed':
                run = matches[0]
                record.update(quality_run_id=run['id'], quality_url=run['html_url'], conclusion=run['conclusion'])
                if run['conclusion'] != 'success':
                    raise ValueError('Quality CI failed; load is not accepted for this commit')
                record['passed'] = True
                break
            time.sleep(10)
        if not record['passed']:
            raise ValueError('Timeout waiting for quality CI of this exact commit')
    except (ValueError, KeyError, OSError) as error:
        record['errors'].append(str(error))
    record['finished_at_utc'] = datetime.now(UTC).isoformat()
    (output / 'ci.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(record))
    return 0 if record['passed'] else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    sys.exit(main(parser.parse_args().output.resolve()))
