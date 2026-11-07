"""Bounded030/024 preparation in a credential-free child, never in the event loop."""
import json
import os
import re
import subprocess
import sys
import tempfile
import time

from ETL.config import ETLError
from ETL.readers.supervised import BACK, _resident_bytes, _worker_environment

PROCESS_SECONDS = 180
MEMORY_BYTES = 2 * 1024**3
RESULT_BYTES = 64 * 1024**2


class PreviewSourceError(ETLError):
    """A bounded reader/validator rejection, with a safe code and no source value."""


def prepare_input(files, profile, tenant, policy):
    request = {'files': {k: str(v) for k, v in files.items()}, 'profile': profile,
               'tenant': tenant, 'policy': policy}
    with tempfile.TemporaryFile() as incoming, tempfile.TemporaryFile() as outgoing:
        incoming.write(json.dumps(request, allow_nan=False).encode())
        incoming.seek(0)
        process = subprocess.Popen([sys.executable, '-B', '-m', 'services.import_preview_worker'], cwd=BACK,
                                   env=_worker_environment(), stdin=incoming, stdout=outgoing, stderr=subprocess.DEVNULL)
        started = time.monotonic()
        try:
            while process.poll() is None:
                if time.monotonic()-started > PROCESS_SECONDS:
                    raise ETLError('PREVIEW_TIME_LIMIT')
                if _resident_bytes(process.pid) > MEMORY_BYTES or os.fstat(outgoing.fileno()).st_size > RESULT_BYTES:
                    raise ETLError('PREVIEW_WORK_LIMIT')
                time.sleep(0.1)
            if process.returncode != 0 or os.fstat(outgoing.fileno()).st_size > RESULT_BYTES:
                raise ETLError('PREVIEW_PROCESS_FAILED')
            outgoing.seek(0)
            try:
                result = json.load(outgoing)
            except (ValueError, RecursionError):
                raise ETLError('PREVIEW_PROCESS_FAILED') from None
            if isinstance(result, dict) and isinstance(result.get('source_error'), str) and re.fullmatch(r'[A-Z][A-Z0-9_]{0,79}', result['source_error']):
                raise PreviewSourceError(result['source_error'])
            if not isinstance(result, dict) or not {'document','rows','source','publishable','validation'} <= result.keys():
                raise ETLError('PREVIEW_PROCESS_FAILED')
            return result
        finally:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=10)
