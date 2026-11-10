"""Bounded030/024 preparation in a credential-free child, never in the event loop."""
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import time

from ETL.config import ETLError
from ETL.readers.supervised import BACK, _worker_environment
from ETL.transform import source_contract

PROCESS_SECONDS = 180
MEMORY_BYTES = 2 * 1024**3
RESULT_BYTES = 64 * 1024**2


class PreviewSourceError(ETLError):
    """A bounded reader/validator rejection, with a safe code and no source value."""

    def __init__(self, code, location=None):
        super().__init__(code)
        # Archivo, línea y campo que informó el lector, si los hubo. Nunca un valor del archivo.
        self.location = location


def _location(value):
    """Forma cerrada: archivo y línea del lote, y un campo que sea una columna del contrato para ese archivo
    (o `*`). Cualquier otra cosa se descarta: por construcción nunca viaja un valor del archivo."""
    if not (isinstance(value, dict) and set(value) == {'archivo', 'linea', 'campo'}
            and value['archivo'] in ('cabecera', 'detalle', 'libro')
            and type(value['linea']) is int and 0 <= value['linea'] < 10**9):
        return None
    columns = source_contract()['archivos'].get(value['archivo'], {}).get('columnas', {})
    return {'archivo': value['archivo'], 'linea': value['linea'],
            'campo': value['campo'] if isinstance(value['campo'], str) and value['campo'] in columns else '*'}


def _stop(process):
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    except PermissionError:
        if process.poll() is None:
            raise


def _group_memory(pid):
    try:
        result = subprocess.run(['ps', '-e', '-o', 'pgid=,rss='], capture_output=True,
                                text=True, timeout=1, check=True)
        return sum(int(rss) * 1024 for group, rss in (line.split() for line in result.stdout.splitlines())
                   if int(group) == pid)
    except (OSError, ValueError, subprocess.SubprocessError):
        raise ETLError('PREVIEW_PROCESS_FAILED') from None


def prepare_input(files, profile, tenant, policy, *, lock_fd=None):
    request = {'files': {k: str(v) for k, v in files.items()}, 'profile': profile,
               'tenant': tenant, 'policy': policy}
    with tempfile.TemporaryFile() as incoming, tempfile.TemporaryFile() as outgoing:
        incoming.write(json.dumps(request, allow_nan=False).encode())
        incoming.seek(0)
        life_read, life_write = os.pipe()
        try:
            process = subprocess.Popen([sys.executable, '-B', '-m', 'services.import_preview_worker'], cwd=BACK,
                                       env={**_worker_environment(), 'EQUITAS_PREVIEW_LIFELINE_FD': str(life_read)},
                                       stdin=incoming, stdout=outgoing, stderr=subprocess.DEVNULL,
                                       start_new_session=True, pass_fds=(life_read,) + (() if lock_fd is None else (lock_fd,)))
        except OSError:
            os.close(life_write)
            raise ETLError('PREVIEW_PROCESS_FAILED') from None
        finally:
            os.close(life_read)
        started = time.monotonic()
        try:
            while process.poll() is None:
                if time.monotonic()-started > PROCESS_SECONDS:
                    raise ETLError('PREVIEW_TIME_LIMIT')
                if _group_memory(process.pid) > MEMORY_BYTES or os.fstat(outgoing.fileno()).st_size > RESULT_BYTES:
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
                raise PreviewSourceError(result['source_error'], _location(result.get('location')))
            if not isinstance(result, dict) or not {'document','rows','source','publishable','validation'} <= result.keys():
                raise ETLError('PREVIEW_PROCESS_FAILED')
            return result
        finally:
            os.close(life_write)
            _stop(process)
            process.wait(timeout=10)
