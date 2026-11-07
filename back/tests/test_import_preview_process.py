"""Real030 worker contract and bounded child termination, without database credentials."""
import json
from pathlib import Path

import pytest
from oracle_lots import derive_lot
from ETL.config import ETLError
from services import import_preview_process as process
from services.import_preview_worker import prepare

PROFILE=json.loads((Path(__file__).resolve().parents[2]/'contracts/source-mapping.sintetico-v1.json').read_text())


def files(tmp_path):
    lot=derive_lot(tmp_path/'lot')
    return {k:lot/(k+'.tsv') for k in ('cabecera','detalle')}


def test_real_child_prepares_same030024032_document_without_credentials(tmp_path,monkeypatch):
    source=files(tmp_path)
    monkeypatch.setenv('EQUITAS_IMPORT_SERVER_JWT','PRIVATE_SENTINEL_NOT_FOR_CHILD')
    result=process.prepare_input(source,PROFILE,1,'conservar')
    expected=prepare({'files':source,'profile':PROFILE,'tenant':1,'policy':'conservar'})
    assert result==json.loads(json.dumps(expected))
    assert 'PRIVATE_SENTINEL' not in json.dumps(result)
    assert result['document']['identity']['parameters']['absent_policy']=='conservar'
    assert {r['kind'] for r in result['rows']}=={'person','object'}


def test_real_child_rejection_is_safe_code(tmp_path):
    source={k:tmp_path/k for k in ('cabecera','detalle')}
    for path in source.values():path.write_text('CENTINELA_PRIVADA\n')
    with pytest.raises(process.PreviewSourceError) as error:
        process.prepare_input(source,PROFILE,1,'conservar')
    assert 'CENTINELA' not in str(error.value)


@pytest.mark.parametrize('limit,code',[('PROCESS_SECONDS','PREVIEW_TIME_LIMIT'),('MEMORY_BYTES','PREVIEW_WORK_LIMIT')])
def test_parent_terminates_child_on_budget_exhaustion(tmp_path,monkeypatch,limit,code):
    monkeypatch.setattr(process,limit,-1)
    with pytest.raises(ETLError,match=code):
        process.prepare_input(files(tmp_path),PROFILE,1,'conservar')
