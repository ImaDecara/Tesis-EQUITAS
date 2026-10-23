"""Isolated process: product handlers/services, synthetic connector, no credentials."""

import os
import sys
from pathlib import Path
from types import ModuleType

from anyio.to_thread import current_default_thread_limiter
from quality.load.fixture import FixtureConnector, make_oracle

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'back'))
connector_config = ModuleType('ETL.config')
connector_config.supabase = FixtureConnector()
# Substitution happens before service import; back/.env and real SDK setup never run.
sys.modules['ETL.config'] = connector_config

from api.main import app

ORACLE = make_oracle()


@app.get('/__quality')
async def quality_metadata():
    return {'fixture_version': ORACLE['fixture_version'], 'dataset_hash': ORACLE['dataset_hash'],
            'profiles': ORACLE['profiles'], 'source_sha': os.environ['QUALITY_SOURCE_SHA'],
            'pid': os.getpid(), 'connector': 'synthetic-local-read-only', 'workers': 1,
            'threadpool_tokens': current_default_thread_limiter().total_tokens}
