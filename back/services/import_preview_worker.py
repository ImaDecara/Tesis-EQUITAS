"""No credentials, no database and no logging of source values."""
import json
import os
import re
import signal
import sys
import threading
from pathlib import Path

from ETL.config import ETLError
from ETL.prevalidate import candidates
from ETL.publication import normalized_rows, staging_document
from ETL.transform import StructuralRejection, prepare_batch, source_contract
from ETL.validate_source import ValidationError


def prepare(request):
    batch = prepare_batch({k: Path(v) for k,v in request['files'].items()}, request['profile'],
                          source_contract(), request['profile']['fecha_corte'])
    rows = normalized_rows(batch, request['tenant'])
    return {'document': staging_document(batch, request['tenant'], request['policy']),
            'rows': rows, 'source': candidates(batch, request['tenant'], rows=rows, compact=True),
            'publishable': batch.publishable,
            'validation': {key: batch.report[key] for key in ('resultado_lote','motivos_bloqueo','conteos','cuarentena')}}


def watch_parent():
    """The API alone owns the pipe writer; EOF kills this private process group."""
    descriptor = int(os.environ['EQUITAS_PREVIEW_LIFELINE_FD'])
    if os.getpgrp() != os.getpid():
        raise RuntimeError('PREVIEW_PROCESS_GROUP_INVALID')

    def monitor():
        try:
            os.read(descriptor, 1)
        finally:
            os.killpg(os.getpgrp(), signal.SIGKILL)

    threading.Thread(target=monitor, daemon=True).start()


if __name__ == '__main__':
    watch_parent()
    try:
        result = prepare(json.load(sys.stdin))
    except (StructuralRejection, ValidationError, ETLError) as error:
        code = str(error).split(':', 1)[0]
        result = {'source_error': code if re.fullmatch(r'[A-Z][A-Z0-9_]{0,79}', code) else 'PREVIEW_SOURCE_INVALID'}
    json.dump(result, sys.stdout, allow_nan=False, separators=(',', ':'))
