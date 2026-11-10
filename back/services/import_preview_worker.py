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
from ETL.transform import (
    StructuralRejection,
    prepare_batch,
    required_catalog_keys,
    source_contract,
)
from ETL.validate_source import ValidationError

# Tope de hallazgos que viajan al proceso padre: el detalle completo no cabe en una pantalla. Los totales por
# código se calculan acá, sobre TODOS los hallazgos. Cada hallazgo es archivo, línea, campo y código: sin valores.
MAX_FINDINGS = 500


def finding_effect(contract, finding):
    """Misma regla que el validador (`_Validator.effect`): una columna opcional puede degradar el efecto."""
    spec = contract['codigos'].get(finding['codigo'], {})
    column = contract['archivos'].get(finding['archivo'], {}).get('columnas', {}).get(finding['campo'], {})
    effect = spec.get('efecto', 'BLOQUEO')
    return effect if column.get('requerida', True) else spec.get('efecto_opcional', effect)


def detail(batch):
    """Lo que la carga directa (noche 7) necesita para explicar un rechazo o un resumen. Va en una clave
    aparte de `validation`, que el preview guarda en su resumen. Errores = lo que excluye o bloquea;
    advertencias = lo que se carga igual."""
    report, contract = batch.report, source_contract()
    totals = {'errores': {}, 'advertencias': {}}
    shown = []
    for finding in report['hallazgos']:
        effect = finding_effect(contract, finding)
        group = totals['advertencias' if effect == 'ALERTA' else 'errores']
        group[finding['codigo']] = group.get(finding['codigo'], 0) + 1
        if len(shown) < MAX_FINDINGS:
            shown.append({'archivo': finding['archivo'], 'linea': finding['linea'], 'campo': finding['campo'],
                          'codigo': finding['codigo'], 'efecto': effect})
    return {'filas': {kind: {name: rows[name] for name in ('leidas','aceptadas','rechazadas')}
                      for kind, rows in report['filas'].items()},
            'hallazgos': shown, 'hallazgos_total': len(report['hallazgos']),
            'totales': {name: dict(sorted(group.items())) for name, group in totals.items()},
            'catalogos': {table: sorted(keys) for table, keys in required_catalog_keys(batch).items()}}


def prepare(request):
    batch = prepare_batch({k: Path(v) for k,v in request['files'].items()}, request['profile'],
                          source_contract(), request['profile']['fecha_corte'])
    rows = normalized_rows(batch, request['tenant'])
    return {'document': staging_document(batch, request['tenant'], request['policy']),
            'rows': rows, 'source': candidates(batch, request['tenant'], rows=rows, compact=True),
            'publishable': batch.publishable,
            'validation': {key: batch.report[key] for key in ('resultado_lote','motivos_bloqueo','conteos','cuarentena')},
            'detail': detail(batch)}


def rejection(error):
    """Código estable y, si el lector la informó, la ubicación (nombres del contrato, nunca valores)."""
    code = str(error).split(':', 1)[0]
    result = {'source_error': code if re.fullmatch(r'[A-Z][A-Z0-9_]{0,79}', code) else 'PREVIEW_SOURCE_INVALID'}
    location = getattr(error, 'location', None)
    if location:
        result['location'] = location
    return result


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
        result = rejection(error)
    json.dump(result, sys.stdout, allow_nan=False, separators=(',', ':'))
