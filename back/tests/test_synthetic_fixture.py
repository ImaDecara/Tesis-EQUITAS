import hashlib
import json
from pathlib import Path

from ETL.extract import extract_source_files
from ETL.inspect_tsv import (
    CABECERA_OPTIONAL_FIELDS,
    CABECERA_REQUIRED_FIELDS,
    DETALLE_OPTIONAL_FIELDS,
    DETALLE_REQUIRED_FIELDS,
)

# Fixture generada por quality/fixtures/synthetic_portfolio.py (ALIGN-023); no se edita a mano.
FIXTURE = Path(__file__).parent / 'fixtures' / 'sintetico-v1'


def load_manifest() -> dict:
    return json.loads((FIXTURE / 'manifest.json').read_text(encoding='utf-8'))


def test_versioned_fixture_bytes_match_its_manifest():
    for entry in load_manifest()['archivos']:
        data = (FIXTURE / entry['ruta']).read_bytes()
        assert hashlib.sha256(data).hexdigest() == entry['sha256'], entry['ruta']


def test_extract_reads_every_column_expected_by_the_inspector():
    data = extract_source_files(FIXTURE / 'cabecera.tsv', FIXTURE / 'detalle.tsv')
    for fields, columns in (
        (CABECERA_REQUIRED_FIELDS | CABECERA_OPTIONAL_FIELDS, set(data.cabecera_df.columns)),
        (DETALLE_REQUIRED_FIELDS | DETALLE_OPTIONAL_FIELDS, set(data.detalle_df.columns)),
    ):
        missing = [name for name, candidates in fields.items() if not set(candidates) & columns]
        assert missing == []
    counts = load_manifest()['conteos']['municipio-sintetico-a']
    assert len(data.cabecera_df) == counts['filas_cabecera']
    assert len(data.detalle_df) == counts['filas_detalle']
    # Los identificadores se leen como texto: la cuenta con ceros a la izquierda llega intacta al ETL.
    assert {'000123', '123', 'R-0456'} <= set(data.cabecera_df['Cuenta'])
