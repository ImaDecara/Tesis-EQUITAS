"""Lectura de archivos subidos en un proceso aparte, con tope real de tiempo y de memoria.

``read_source_batch`` corta entre fila y fila, pero no puede interrumpir un parser en plena
operación: armar los estilos tarda segundos sin devolver el control. Acá el corte no depende
del lector: un vigilante en el proceso padre mata al hijo al vencer el plazo o al pasarse de
memoria. Lo que quien invoca ve es un rechazo con su código, nunca una espera sin fin.

El hijo es tratado como no confiable: no hereda el entorno (credenciales), no tiene stderr
(un traceback podría citar un valor) y contesta en JSON por líneas, no en pickle, porque un
hijo comprometido por un archivo hostil no debe poder ejecutar nada en el padre.
"""

from __future__ import annotations

import json
import mmap
import subprocess
import sys
import threading
import time
from dataclasses import asdict
from pathlib import Path

from ETL.extract import KINDS, SourceBatch, read_source_batch
from ETL.readers.limits import FileLimits, source_error
from ETL.validate_source import SourceRow, SourceTable, ValidationError, load_contract

BACK = Path(__file__).resolve().parents[2]
WATCH_SECONDS = 0.1
_STATM = '/proc/{pid}/statm'
_PAGE_BYTES = mmap.PAGESIZE
# Una línea es una fila: cada celda puede quedar hasta 6 veces más larga al escaparla en JSON.
_JSON_CELL_FACTOR = 6


def _worker_command():
    return [sys.executable, '-B', '-m', 'ETL.readers.supervised']


def _worker_environment():
    """Nada del entorno del servidor: el hijo no necesita ninguna credencial para leer un archivo."""
    return {'LC_ALL': 'C.UTF-8', 'PYTHONUTF8': '1'}


def _resident_bytes(pid):
    """Memoria residente del hijo. Si no se puede medir da 0: el plazo sigue vigente igual."""
    try:
        with open(_STATM.format(pid=pid), encoding='ascii') as stream:
            return int(stream.read().split()[1]) * _PAGE_BYTES
    except OSError:
        pass
    try:
        result = subprocess.run(['ps', '-o', 'rss=', '-p', str(pid)], capture_output=True, text=True, check=False, timeout=1)
        return int(result.stdout.strip() or 0) * 1024
    except (OSError, ValueError, subprocess.SubprocessError):
        return 0


def _watch(process, limits, finished, verdict):
    """Corre en el padre: el hijo no puede demorarlo, haga lo que haga el parser."""
    expires = time.monotonic() + limits.read_seconds
    while True:
        remaining = expires - time.monotonic()
        if remaining > 0 and finished.wait(min(WATCH_SECONDS, remaining)):
            return
        if remaining <= 0:
            verdict.append('TIEMPO_LECTURA_EXCEDIDO')
        elif process.poll() is None and _resident_bytes(process.pid) > limits.read_memory_bytes:
            verdict.append('MEMORIA_LECTURA_EXCEDIDA')
        if verdict:
            process.kill()
            return


def _message(process, limit):
    line = process.stdout.readline(limit)
    if not line.endswith(b'\n'):
        raise EOFError
    return json.loads(line)


def _receive(process, limits):
    """Lee la respuesta del hijo; sin la marca final no hay lote: nunca se entrega un prefijo."""
    limit = 1024 + limits.columns * (_JSON_CELL_FACTOR * limits.cell + 3)
    tables = {}
    table = None
    while True:
        message = _message(process, limit)
        if isinstance(message, list):
            line, values = message
            if table is None or len(table.rows) >= limits.rows or len(values) != len(table.columns):
                raise ValueError
            table.rows.append(SourceRow(line, dict(zip(table.columns, values, strict=True))))
        elif 'error' in message:
            raise ValidationError(str(message['error']))
        elif 'tabla' in message:
            table = tables[message['tabla']] = SourceTable(message['columnas'], [])
        else:
            return SourceBatch(tables, message['hojas_ignoradas'])


def _close(pipe):
    try:
        pipe.close()
    except OSError:  # El hijo ya murió con datos sin leer.
        pass


def read_source_batch_supervised(files, mapping, *, contract=None, limits=None):
    """Como ``read_source_batch``, con un corte real al vencer ``read_seconds`` o ``read_memory_bytes``.

    El plazo cubre el lote completo, incluido el arranque del intérprete hijo (cerca de 1 s).
    No cubre ``validate_batch``, que corre después en quien invoca. Códigos propios:
    ``TIEMPO_LECTURA_EXCEDIDO``, ``MEMORIA_LECTURA_EXCEDIDA`` y ``LECTURA_INTERRUMPIDA``.
    """
    contract = load_contract() if contract is None else contract
    if not isinstance(files, dict) or set(files) != set(KINDS):
        raise ValidationError('ARCHIVOS_REQUERIDOS')
    limits = FileLimits.from_contract(contract) if limits is None else limits
    request = json.dumps({'files': {kind: str(path) for kind, path in files.items()}, 'mapping': mapping,
                          'contract': contract, 'limits': asdict(limits)}).encode()
    process = subprocess.Popen(_worker_command(), cwd=BACK, env=_worker_environment(), stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    finished, verdict = threading.Event(), []
    watcher = threading.Thread(target=_watch, args=(process, limits, finished, verdict), daemon=True)
    started = time.monotonic()
    watcher.start()
    batch = None
    try:
        process.stdin.write(request)
        process.stdin.close()
        batch = _receive(process, limits)
    except ValidationError:
        raise
    except (OSError, EOFError, KeyError, TypeError, ValueError):
        pass  # El hijo murió o contestó algo que no corresponde: se decide abajo, sin citar nada de lo recibido.
    finally:
        finished.set()
        watcher.join()
        process.kill()
        process.wait()
        _close(process.stdin)
        _close(process.stdout)
    if verdict:
        source_error(verdict[0], KINDS[0])
    if batch is None:
        source_error('LECTURA_INTERRUMPIDA', KINDS[0])
    # Nada se entrega después del plazo, aunque haya vencido mientras llegaban las últimas filas.
    if time.monotonic() - started >= limits.read_seconds:
        source_error('TIEMPO_LECTURA_EXCEDIDO', KINDS[0])
    return batch


def serve(source, output):
    """El lado del hijo: lee el pedido, lee los archivos y contesta una línea por fila."""
    request = json.load(source)
    limits = FileLimits(**request['limits'])
    try:
        batch = read_source_batch(request['files'], request['mapping'], contract=request['contract'], limits=limits)
    except ValidationError as error:
        output.write(json.dumps({'error': str(error)}) + '\n')
        return
    for kind, table in batch.tables.items():
        output.write(json.dumps({'tabla': kind, 'columnas': table.columns}) + '\n')
        for row in table.rows:
            output.write(json.dumps([row.line, [row.values[name] for name in table.columns]]) + '\n')
    output.write(json.dumps({'hojas_ignoradas': batch.ignored_sheets}) + '\n')


if __name__ == '__main__':
    serve(sys.stdin, sys.stdout)
