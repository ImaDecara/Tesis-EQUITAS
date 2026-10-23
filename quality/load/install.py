"""Install one pinned official k6 binary after checking the archive SHA-256."""

import argparse
import hashlib
import io
import json
import platform
import tarfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def install(output):
    policy = json.loads((ROOT / 'quality/load/policy.json').read_text(encoding='utf-8'))
    target = {'Windows': 'windows-amd64', 'Linux': 'linux-amd64'}.get(platform.system())
    if platform.machine().lower() not in ('amd64', 'x86_64') or target is None:
        raise ValueError('This pinned installer supports Linux/Windows amd64 only')
    asset = policy['tool']['assets'][target]
    url = 'https://github.com/grafana/k6/releases/download/v' + policy['tool']['version'] + '/' + asset['file']
    with urllib.request.urlopen(url, timeout=120) as response:
        archive = response.read(100 * 1024 * 1024)
    if hashlib.sha256(archive).hexdigest() != asset['sha256']:
        raise ValueError('Official k6 archive checksum mismatch')
    binary_name = 'k6.exe' if target.startswith('windows') else 'k6'
    if binary_name.endswith('.exe'):
        with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
            names = [name for name in zipped.namelist() if name.endswith('/' + binary_name)]
            if len(names) != 1:
                raise ValueError('Unexpected k6 archive layout')
            binary = zipped.read(names[0])
    else:
        with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as zipped:
            names = [item for item in zipped.getmembers() if item.name.endswith('/k6') and item.isfile()]
            if len(names) != 1:
                raise ValueError('Unexpected k6 archive layout')
            binary = zipped.extractfile(names[0]).read()
    output.mkdir(parents=True, exist_ok=True)
    destination = output / binary_name
    destination.write_bytes(binary)
    destination.chmod(0o755)
    (output / 'installation.json').write_text(json.dumps({
        'version': policy['tool']['version'], 'asset': asset['file'], 'archive_sha256': asset['sha256'],
        'binary_sha256': hashlib.sha256(binary).hexdigest(), 'source': url,
    }, indent=2) + '\n', encoding='utf-8')
    print('Verified k6 ' + policy['tool']['version'] + ': ' + str(destination))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / '.quality/tools/k6')
    install(parser.parse_args().output.resolve())
