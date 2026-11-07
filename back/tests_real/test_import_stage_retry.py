"""Reintentos de stage: tanda propia con reset, separada del estado inicial de publicación."""

import pytest
from conftest import psql
from test_etl_v1_load import campaign, changes, snapshot  # noqa: F401 -- fixture original con reset propio
from test_import_publish import importer, prepared, publications, publish, stage  # noqa: F401

from ETL.config import ETLError


@pytest.mark.parametrize('sqlstate', ['55P03', '40P01', '57014'])
def test_stage_abortado_es_reintentable_y_revierte_antes_del_mismo_reintento(importer, sqlstate):
    batch = prepared(importer, 'retry-' + sqlstate)
    before = snapshot()
    before_jobs = publications()
    before_events = psql('select count(*) from public.import_batch')
    psql(f"""
        create function public.align032_stage_retry() returns trigger language plpgsql as $$
        begin raise exception using errcode='{sqlstate}', message='SYNTHETIC_STAGE_ABORT'; end $$;
        create trigger align032_stage_retry before insert on public.import_batch
        for each row execute function public.align032_stage_retry();
    """)
    try:
        with pytest.raises(ETLError, match='IMPORT_RETRY_REQUIRED'):
            stage(batch)
    finally:
        psql('drop trigger align032_stage_retry on public.import_batch; drop function public.align032_stage_retry();')
    assert changes(before, snapshot()) == {}
    assert publications() == before_jobs
    assert psql('select count(*) from public.import_batch') == before_events
    review = stage(batch)
    assert review['status'] == 'VALIDADO'
    assert publish(batch, review)['status'] == 'PUBLICADO'
