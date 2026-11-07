"""Authorization before preview I/O, stable errors, pagination and bounded work."""
import copy
import json
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from fake_supabase_http import AUTH_OPERADOR, AUTH_OTRO_IMPORTADOR
from postgrest.exceptions import APIError
from test_api_imports import auth_headers, client, supabase, upload  # noqa: F401

from api import import_preview as preview
from ETL.publication import effective_mapping
from ETL.transform import canonical_json_hash
from services.paginated_reader import DataReadError

PROFILE=json.loads((Path(__file__).resolve().parents[2]/'contracts/source-mapping.sintetico-v1.json').read_text())


def body(root=1):
    return {'expected_event':root,'profile':copy.deepcopy(PROFILE),
            'mapping_hash':canonical_json_hash(effective_mapping(PROFILE)),'absent_policy':'conservar'}


@pytest.mark.parametrize('method',['get','post'])
def test_anonymous_cannot_prepare_or_read(client,method):
    assert getattr(client,method)('/imports/1/preview').status_code==401


@pytest.mark.parametrize('method',['get','post'])
def test_operator_forbidden(client,supabase,method):
    assert getattr(client,method)('/imports/1/preview',headers=auth_headers(supabase,AUTH_OPERADOR)).status_code==403


@pytest.mark.parametrize('path',['0001','999999999','920000001','9223372036854775808','CENTINELA','0','-1'])
def test_unknown_and_manipulated_id(client,supabase,path):
    response=client.get(f'/imports/{path}/preview',headers=auth_headers(supabase))
    assert response.status_code in (404,422)
    assert path not in response.text


def test_other_tenant_cannot_read(client,supabase):
    root=upload(client,supabase).json()['root_id']
    assert client.get(f'/imports/{root}/preview',headers=auth_headers(supabase,AUTH_OTRO_IMPORTADOR)).status_code==404


@pytest.mark.parametrize('query',['kind=person','page=0','page=1.5','page=01','page=6001','page=1&page=2','tenant=9','revision=secret'])
def test_filters_fail_closed_before_rpc(client,supabase,monkeypatch,query):
    root=upload(client,supabase).json()['root_id']
    monkeypatch.setattr(preview,'_rpc',lambda *a,**k:pytest.fail('Should not call RPC'))
    result=client.get(f'/imports/{root}/preview?{query}',headers=auth_headers(supabase))
    assert result.status_code==422


@pytest.mark.parametrize('change',[
    {'expected_event':True},{'expected_event':0},{'expected_event':2**63},{'tenant':1},
    {'mapping_hash':'x'},{'mapping_hash':'f'*64},{'profile':{}},{'absent_policy':'automatico'},
    {'expected_preview':None},
])
def test_request_validation(change):
    with pytest.raises(HTTPException):
        preview._body_check({**body(),**change})


def test_valid_profile_not_reinterpreted():
    value=body()
    assert preview._body_check(value) is value


@pytest.mark.parametrize('content,content_type,status',[
    ('{}','text/plain',415), ('{','application/json',422), ('[]','application/json',422),
    ('{"x":1,"x":2}','application/json',422), ('{"x":NaN}','application/json',422),
    ('x'*131073,'application/json',413),
])
def test_json_input(client,supabase,content,content_type,status):
    result=client.post('/imports/1/preview',headers={**auth_headers(supabase),'Content-Type':content_type},content=content)
    assert result.status_code==status
    assert 'NaN' not in result.text


def test_full_cursor_reader_does_not_stop_at_short_page():
    calls=[]
    def rpc(table,after):
        calls.append((table,after))
        rows=[{'id':after+1}] if table=='debtor' and after<1001 else []
        return {'token':'a'*64,'rows':rows}
    result,token=preview.read_snapshot(rpc)
    assert len(result['debtor'])==1001 and token=='a'*64
    assert ('debtor',1001) in calls


def test_change_on_empty_page_discards_complete_prefix():
    def rpc(table,after):
        return {'token':('b' if after else 'a')*64,'rows':[] if after else [{'id':1}]}
    with pytest.raises(HTTPException) as error:
        preview.read_snapshot(rpc)
    assert error.value.status_code==409


@pytest.mark.parametrize('response',[{'token':'bad','rows':[]},{'token':'a'*64,'rows':[{'id':1},{'id':1}]},
                                     {'token':'a'*64,'rows':None},{}])
def test_incomplete_snapshot_never_returns_prefix(response):
    with pytest.raises(DataReadError):
        preview.read_snapshot(lambda *_:response)


def test_snapshot_work_limit(monkeypatch):
    monkeypatch.setattr(preview,'MAX_SNAPSHOT_ROWS',1)
    with pytest.raises(HTTPException) as error:
        preview.read_snapshot(lambda *_:{'token':'a'*64,'rows':[{'id':1},{'id':2}]})
    assert error.value.detail=='PREVIEW_WORK_LIMIT'


@pytest.mark.parametrize('error,status,code',[
    (APIError({'message':'PREVIEW_INVALIDATED','code':'P0001','details':None,'hint':None}),409,'PREVIEW_INVALIDATED'),
    (APIError({'message':'CENTINELA_SECRETA','code':'P0001','details':None,'hint':None}),503,'PREVIEW_SERVICE_UNAVAILABLE'),
    (httpx.ReadTimeout('CENTINELA_SECRETA'),503,'PREVIEW_SERVICE_UNAVAILABLE'),
    (None,503,'PREVIEW_SERVICE_UNAVAILABLE'),
])
def test_rpc_errors_are_safe_and_close_client(monkeypatch,error,status,code):
    closed=[]
    def execute():
        if error: raise error
        return SimpleNamespace(data=[])
    writer=SimpleNamespace(session=SimpleNamespace(close=lambda:closed.append(True)),
                           rpc=lambda *a:SimpleNamespace(execute=execute))
    monkeypatch.setattr(preview.imports,'writer_client',lambda _:writer)
    with pytest.raises(HTTPException) as found:
        preview._rpc(SimpleNamespace(config=None),SimpleNamespace(user_id=1,tenant_id=1),'x')
    assert (found.value.status_code,found.value.detail)==(status,code)
    assert closed==[True]


def test_read_uses_canonical_root_and_safe_query(client,supabase,monkeypatch):
    root=upload(client,supabase).json()['root_id'];calls=[]
    monkeypatch.setattr(preview,'_rpc',lambda *a,**k:calls.append(k) or {'revision':'a'*64})
    result=client.get(f'/imports/{root}/preview?kind=alta&page=1',headers=auth_headers(supabase))
    assert result.status_code==200 and calls[0]['p_root']==root
    assert calls[0]['p_kind']=='alta' and calls[0]['p_page']==1


def test_expired_copy_does_not_read_staging(client,supabase,monkeypatch):
    root=upload(client,supabase).json()['root_id']
    store=preview.imports.load_store();store.release(1,root)
    monkeypatch.setattr(preview,'_rpc',lambda *a,**k:pytest.fail('No staging read'))
    assert client.get(f'/imports/{root}/preview',headers=auth_headers(supabase)).status_code==410


def test_a_validado_label_without056_binding_is_not_a_valid_preview_source(client,supabase,monkeypatch):
    root=upload(client,supabase).json()['root_id']
    original=preview.imports._resolve_chain
    def changed(*args):
        origin,current=original(*args)
        return origin,{**current,'status':'VALIDADO'}
    monkeypatch.setattr(preview.imports,'_resolve_chain',changed)
    monkeypatch.setattr(preview,'prepare_input',lambda *args:pytest.fail('No obsolete profile interpretation'))
    response=client.post(f'/imports/{root}/preview',headers=auth_headers(supabase),json=body(root))
    assert response.status_code==409 and response.json()['detail']=='PREVIEW_SOURCE_NOT_READY'
