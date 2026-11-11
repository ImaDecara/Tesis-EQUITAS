"""Nueva entrega de los mismos valores, explícita en los ensayos de restauración.

032 devuelve el recibo del archivo ya publicado: volver a enviarlo NO deshace una
publicación posterior. Una reimportación nueva necesita otro artefacto de origen.
Reordenar columnas conserva cada registro y cambia los bytes, sin nonce productivo.
"""

import csv
import hashlib
import shutil
from pathlib import Path


def reissue_lot(source: Path, target: Path) -> Path:
    shutil.copytree(source, target)
    path = target / 'cabecera.tsv'
    with path.open(newline='', encoding='utf-8') as stream:
        reader = csv.DictReader(stream, delimiter='\t')
        old_fields = reader.fieldnames
        rows = list(reader)
    fields = sorted(old_fields, key=lambda field: hashlib.sha256((target.name + field).encode()).digest())
    assert fields != old_fields
    with path.open('w', newline='', encoding='utf-8') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, delimiter='\t', lineterminator='\n')
        writer.writeheader()
        writer.writerows(rows)
    with path.open(newline='', encoding='utf-8') as stream:
        assert list(csv.DictReader(stream, delimiter='\t')) == rows
    assert path.read_bytes() != (source / 'cabecera.tsv').read_bytes()
    return target
