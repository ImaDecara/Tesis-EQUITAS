"""No credentials, no database and no logging of source values."""
import json
import re
import sys
from pathlib import Path

from ETL.config import ETLError
from ETL.prevalidate import candidates
from ETL.publication import normalized_rows, staging_document
from ETL.transform import StructuralRejection, prepare_batch, source_contract
from ETL.validate_source import ValidationError


def prepare(request):
    batch = prepare_batch({k: Path(v) for k,v in request['files'].items()}, request['profile'],
                          source_contract(), request['profile']['fecha_corte'])
    return {'document': staging_document(batch, request['tenant'], request['policy']),
            'rows': normalized_rows(batch, request['tenant']), 'source': candidates(batch, request['tenant']),
            'publishable': batch.publishable,
            'validation': {key: batch.report[key] for key in ('resultado_lote','motivos_bloqueo','conteos','cuarentena')}}


if __name__ == '__main__':
    try:
        result = prepare(json.load(sys.stdin))
    except (StructuralRejection, ValidationError, ETLError) as error:
        code = str(error).split(':', 1)[0]
        result = {'source_error': code if re.fullmatch(r'[A-Z][A-Z0-9_]{0,79}', code) else 'PREVIEW_SOURCE_INVALID'}
    json.dump(result, sys.stdout, allow_nan=False)
