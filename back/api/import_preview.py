"""Explicit preview preparation and authenticated, revision-bound reads. No publication."""
import json
import re
import time
from types import SimpleNamespace
from typing import Annotated

import anyio
import httpx
from fastapi import APIRouter, HTTPException, Path, Request
from postgrest.exceptions import APIError
from starlette.concurrency import run_in_threadpool
from starlette.requests import ClientDisconnect

from api import imports
from api.auth import (
    ImporterContext,
    SessionDep,
    UserClientDep,
    resolve_tenant_context,
    session_for_token,
)
from api.upload_store import UploadStoreBusy
from ETL.config import ETLError
from ETL.extract import validate_source_profile
from ETL.prevalidate import KINDS, TABLES, classify_candidates
from ETL.publication import effective_mapping
from ETL.transform import canonical_json_hash
from ETL.validate_source import ValidationError, _unique_keys
from services.import_preview_process import PreviewSourceError, prepare_input
from services.paginated_reader import DataReadError, read_all_by_id

router = APIRouter(prefix='/imports', tags=['imports'])
PreviewId = Annotated[str, Path(pattern=r'^[1-9][0-9]{0,18}$')]
HASH = re.compile(r'[0-9a-f]{64}')
MAX_JSON = 131072
MAX_SNAPSHOT_ROWS = 200000
MAX_SNAPSHOT_BYTES = 64 * 1024**2
ERRORS = {
    'ACTOR_NOT_ACTIVE_MEMBER': 403, 'ROLE_NOT_ALLOWED': 403, 'BATCH_NOT_FOUND': 404,
    'PREVIEW_NOT_PREPARED': 404, 'PREVIEW_EXPIRED': 410, 'PREVIEW_INVALIDATED': 409,
    'PREVIEW_SOURCE_NOT_READY': 409, 'PREVIEW_REVISION_CONFLICT': 409, 'PREVIEW_NOT_PUBLISHABLE': 409,
    'PREVIEW_PAGE_OUT_OF_RANGE': 422, 'PREVIEW_INPUT_INVALID': 422, 'IMPORT_RETRY_REQUIRED': 503,
    'IMPORT_REVISION_CONFLICT': 409, 'IMPORT_REVALIDATION_REQUIRED': 409,
    'SHARED_PERSON_OTHER_TENANT': 409,
}


def _rpc(session, context, name, **params):
    writer = imports.writer_client(session.config)
    writer.session.timeout = httpx.Timeout(75)
    try:
        data = writer.rpc(name, {'p_actor_user': context.user_id, 'p_tenant': context.tenant_id, **params}).execute().data
        if not isinstance(data, dict):
            raise TypeError
        return data
    except APIError as error:
        code = str(error.message)
        if code in ERRORS:
            raise HTTPException(ERRORS[code], code) from None
        raise HTTPException(503, 'PREVIEW_SERVICE_UNAVAILABLE') from None
    except (httpx.HTTPError, ValueError, TypeError, AttributeError):
        raise HTTPException(503, 'PREVIEW_SERVICE_UNAVAILABLE') from None
    finally:
        writer.session.close()


def _id(value):
    if type(value) is not int or not 1 <= value <= imports.MAX_BIGINT:
        raise HTTPException(422, 'PREVIEW_INPUT_INVALID')
    return value


def _body_check(body):
    required = {'expected_event','profile','mapping_hash','absent_policy'}
    if not isinstance(body, dict) or not required <= body.keys() or set(body)-required-{'expected_preview'}:
        raise HTTPException(422, 'PREVIEW_INPUT_INVALID')
    _id(body['expected_event'])
    for key in ('mapping_hash','expected_preview'):
        if key in body and (not isinstance(body[key], str) or not HASH.fullmatch(body[key])):
            raise HTTPException(422, 'PREVIEW_INPUT_INVALID')
    if body['absent_policy'] not in ('rechazar','conservar','dar-de-baja'):
        raise HTTPException(422, 'PREVIEW_INPUT_INVALID')
    try:
        validate_source_profile(body['profile'])
        if canonical_json_hash(effective_mapping(body['profile'])) != body['mapping_hash']:
            raise HTTPException(409, 'PREVIEW_MAPPING_CONFLICT')
    except (ValidationError, KeyError, TypeError, RecursionError):
        raise HTTPException(422, 'PREVIEW_PROFILE_INVALID') from None
    return body


async def _body(request):
    if request.headers.get('content-type','').split(';')[0].strip() != 'application/json':
        raise HTTPException(415, 'JSON_REQUERIDO')
    content = bytearray()
    try:
        with anyio.fail_after(10):
            async for part in request.stream():
                content.extend(part)
                if len(content)>MAX_JSON:
                    raise HTTPException(413, 'PREVIEW_WORK_LIMIT')
        result = json.loads(content, object_pairs_hook=_unique_keys,
                            parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except TimeoutError:
        raise HTTPException(408, 'PREVIEW_TIME_LIMIT') from None
    except (ValueError, RecursionError, ClientDisconnect):
        raise HTTPException(422, 'PREVIEW_INPUT_INVALID') from None
    return _body_check(result)


class SnapshotQuery:
    """Adapter to031's complete keyset reader. Token is checked even on the empty page."""
    def __init__(self, loader, table):
        self.loader, self.table, self.after = loader, table, 0

    def order(self, _column):
        return self

    def limit(self, _size):
        return self

    def gt(self, _column, cursor):
        self.after = cursor
        return self

    def execute(self):
        state = self.loader
        if time.monotonic() > state['deadline']:
            state['limited'] = True
            raise ValueError('PREVIEW_WORK_LIMIT')
        data = state['rpc'](self.table, self.after)
        if not isinstance(data.get('token'), str) or not HASH.fullmatch(data['token']):
            raise ValueError('PREVIEW_DATA_INVALID')
        if state['token'] is None:
            state['token'] = data['token']
        if data['token'] != state['token']:
            # DataReadError masks arbitrary exceptions; retain a safe reason outside it.
            state['invalidated'] = True
            raise ValueError('PREVIEW_INVALIDATED')
        rows = data['rows']
        state['rows'] += len(rows)
        state['bytes'] += len(json.dumps(rows).encode())
        if state['rows']>MAX_SNAPSHOT_ROWS or state['bytes']>MAX_SNAPSHOT_BYTES:
            state['limited'] = True
            raise ValueError('PREVIEW_WORK_LIMIT')
        return SimpleNamespace(data=rows)


def read_snapshot(call):
    state = {'rpc': call, 'token': None, 'rows': 0, 'bytes': 0, 'invalidated': False, 'limited': False, 'deadline': time.monotonic()+180}
    try:
        data = {table: read_all_by_id(table, lambda t=table: SnapshotQuery(state,t)) for table in TABLES}
    except DataReadError:
        if state['invalidated']:
            raise HTTPException(409, 'PREVIEW_INVALIDATED') from None
        if state['limited']:
            raise HTTPException(422, 'PREVIEW_WORK_LIMIT') from None
        raise
    return data, state['token']


def _available(store, tenant, origin, current):
    available, expires = store.describe(tenant,origin,current['file_hashes'],None)
    if not available:
        raise HTTPException(410,'PREVIEW_EXPIRED')
    return expires


def _prepare(body, batch_id, context, session, client):
    tenant = context.tenant_id
    store = imports.load_store()
    origin, current = imports._resolve_chain(client,tenant,batch_id)
    if current['id'] != body['expected_event']:
        raise HTTPException(409, 'PREVIEW_INVALIDATED')
    if current['status'] != 'RECIBIDO':
        raise HTTPException(409, 'PREVIEW_SOURCE_NOT_READY')
    if body['profile']['fecha_corte'] != current['as_of']:
        raise HTTPException(409, 'PREVIEW_MAPPING_CONFLICT')
    try:
        # Global fixed lock per store; prepare work has one bounded worker, no queue.
        with store.lock('preview-processing','global',wait=0), store.lock(tenant,origin,wait=0):
            expires = _available(store,tenant,origin,current)
            if not store.verify(tenant,origin,current['file_hashes']):
                raise HTTPException(410, 'PREVIEW_COPY_CHANGED')
            files = store.files(tenant,origin)
            if set(files)=={'libro'}:
                files = dict.fromkeys(('cabecera','detalle'),files['libro'])
            prepared = prepare_input(files,body['profile'],tenant,body['absent_policy'])
            people = sorted({r['payload']['person']['external_id'] for r in prepared['rows'] if r['kind']=='person'})
            persisted, token = read_snapshot(lambda table,after: _rpc(session,context,'read_import_preview_source',
                p_root=origin,p_head=current['id'],p_people=people,p_table=table,p_after=after))
            try:
                result = classify_candidates(prepared['source'],persisted)
            except (ValueError, TypeError, KeyError):
                raise HTTPException(503, 'PREVIEW_DATA_INVALID') from None
            if not store.verify(tenant,origin,current['file_hashes']):
                raise HTTPException(410, 'PREVIEW_COPY_CHANGED')
            _available(store,tenant,origin,current)
            verified = session_for_token(session.token)
            if resolve_tenant_context(client,verified) != context:
                raise HTTPException(403,'ROLE_FORBIDDEN')
            summary = {key: result[key] for key in ('counts','excluded_counts')}
            summary.update(validation=prepared['validation'],absent_policy=body['absent_policy'],
                           publishable=prepared['publishable'] and not result['new_conflicts'],
                           unchanged_cutoffs='AUSENTES_Y_CUARENTENA_CONSERVAN_CORTE_PREVIO')
            from datetime import UTC, datetime
            return _rpc(session,context,'prepare_import_preview',p_root=origin,p_head=current['id'],
                        p_document=prepared['document'],p_rows=prepared['rows'],p_effects=result['rows'],
                        p_summary=summary,p_token=token,p_expires=datetime.fromtimestamp(expires,UTC).isoformat(),
                        p_publishable=summary['publishable'],p_expected_preview=body.get('expected_preview'))
    except UploadStoreBusy:
        raise HTTPException(429,'PREVIEW_BUSY') from None
    except imports.STORE_ERRORS:
        raise HTTPException(503,'ALMACEN_TEMPORAL_NO_DISPONIBLE') from None
    except PreviewSourceError as error:
        raise HTTPException(422, str(error)) from None
    except ETLError as error:
        code = str(error)
        raise HTTPException(422 if code=='PREVIEW_WORK_LIMIT' else 503,
                            code if code in {'PREVIEW_WORK_LIMIT','PREVIEW_TIME_LIMIT'} else 'PREVIEW_PROCESS_FAILED') from None


@router.post('/{batch_id}/preview')
async def prepare_preview(request: Request,batch_id: PreviewId,context: ImporterContext,
                          session: SessionDep,client: UserClientDep):
    body = await _body(request)
    return await run_in_threadpool(_prepare,body,_id(int(batch_id)),context,session,client)


@router.get('/{batch_id}/preview')
def read_preview(request: Request,batch_id: PreviewId,context: ImporterContext,
                 session: SessionDep,client: UserClientDep):
    origin,current = imports._resolve_chain(client,context.tenant_id,_id(int(batch_id)))
    query = request.query_params
    if set(query)-{'kind','page','revision'} or any(len(query.getlist(k))!=1 for k in query):
        raise HTTPException(422,'PREVIEW_INPUT_INVALID')
    kind,page,revision = query.get('kind') or None,query.get('page','1'),query.get('revision')
    if (kind is not None and kind not in KINDS) or not re.fullmatch(r'[1-9][0-9]{0,3}',page) or int(page)>6000:
        raise HTTPException(422,'PREVIEW_INPUT_INVALID')
    if revision is not None and not HASH.fullmatch(revision):
        raise HTTPException(422,'PREVIEW_INPUT_INVALID')
    store=imports.load_store()
    _available(store,context.tenant_id,origin,current)
    result=_rpc(session,context,'read_import_preview',p_root=origin,p_head=current['id'],
                p_kind=kind,p_page=int(page),p_revision=revision)
    _available(store,context.tenant_id,origin,current)
    return result
