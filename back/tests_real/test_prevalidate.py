"""Independent054 oracle: source bytes -> real API/Auth/PostgREST -> persisted preview.

1005 existing objects, one changed header, one changed debt, one new object,
3 quarantined rows and one identical duplicate. All data is synthetic.
Expected BEFORE running: alta2, actualizacion2, sin_cambios2009, conflicto3.
No business row or private version (including xmin) may change during preparation/GET.
"""
import csv
import hashlib
import io
import json
import subprocess
from pathlib import Path
import uuid

import httpx
import pytest
from conftest import ROOT, psql

from ETL.publication import effective_mapping
from ETL.transform import canonical_json_hash

EXPECTED = {'alta':2,'actualizacion':2,'sin_cambios':2009,'conflicto':3}
TABLES = ('person','debtor','debt','debtor_person','debtor_contact','debtor_profile',
          'debtor_profile_detail','address','city','province')


def snapshot():
    result={}
    for table in TABLES:
        result[table]=psql(f"select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('xmin',xmin::text) order by id),'[]') from public.{table} t")
    for table in ('object_version','person_version'):
        result[table]=psql(f"select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('xmin',xmin::text) order by to_jsonb(t)::text),'[]') from equitas_import_private.{table} t")
    return result


def source():
    contract=json.loads((ROOT/'contracts/source-contract.v1.json').read_text())
    columns={k:list(contract['archivos'][k]['columnas']) for k in ('cabecera','detalle')}
    headers=[];details=[]
    for i in range(1,1008):
        h=dict.fromkeys(columns['cabecera'],'')
        h.update(ClaveAgrupacion=f'A054-{i}',Bien_Tipo_Id='1',Bien_Tipo='INMUEBLE',Cuenta=str(7000000+i),
                 Identificador=f'A054-{i}',Bien_Descripcion='CAMBIO' if i==1004 else 'Sintetico054',Estado='Activo',
                 Tipo_Ingreso_Id='1',Destinatario_Id=str(9000000+i),Destinatario=f'Persona sintetica {i}',
                 Destinatario_Tipo='Titular',Destinatario_Porcentaje='100',Deuda_Capital='9,00',
                 Deuda_Actualizada='11,00' if i==1005 else '10,00',Periodos_Deuda='1',Fecha_Actualizacion='29/09/2026')
        d=dict.fromkeys(columns['detalle'],'')
        d.update(ClaveAgrupacion=f'A054-{i}',Bien_Tipo_Id='1',Cuenta=str(7000000+i),DEUD_id=str(8000000+i),
                 Tipo_Ingreso_Id='1',NOTD_capital='9,00',NOTD_intereses='2,00' if i==1005 else '1,00',
                 NOTD_honorarios='0,00',NOTD_totalActualizado='11,00' if i==1005 else '10,00',
                 NOTD_vencimiento='01/01/2026',NOTD_ESTA_id='10')
        headers.append(h);details.append(d)
    details.append({**details[-1],'NOTD_capital':'8,00'})
    details.append(dict(details[0]))
    def encode(kind,rows):
        out=io.StringIO();w=csv.DictWriter(out,fieldnames=columns[kind],delimiter='\t',lineterminator='\n');w.writeheader();w.writerows(rows)
        return out.getvalue().encode()
    return {'cabecera':encode('cabecera',headers),'detalle':encode('detalle',details)}


@pytest.fixture(scope='module')
def seeded(accounts):
    # SQL expectation authored independently of ETL builders. No response is planted in staging.
    psql("""
    insert into public.debtor_type(id,key,value) values(954054,'INMUEBLE','Inmueble') on conflict(key) do nothing;
    insert into public.document_type(id,key,value) values(954054,'UNKNOWN','No informado') on conflict(key) do nothing;
    insert into public.person_type(id,key,value) values(954054,'UNKNOWN','No informado') on conflict(key) do nothing;
    insert into public.person_status(id,key,value) values(954054,'UNKNOWN','No informado') on conflict(key) do nothing;
    insert into public.debt_status(id,key,value) values(954054,'OVERDUE','Vencida') on conflict(key) do nothing;
    insert into public.currency(id,code,name) values(954054,'ARS','Peso') on conflict(code) do nothing;
    insert into public.person(id,external_id,full_name,document_type,type,status)
      select 954000+i,9000000+i,'Persona sintetica '||i,
        (select id from public.document_type where key='UNKNOWN'),(select id from public.person_type where key='UNKNOWN'),
        (select id from public.person_status where key='UNKNOWN') from generate_series(1,1005) i;
    insert into public.debtor(id,tenant,external_id,type,identifier,description,status)
      select 954000+i,920001,7000000+i,(select id from public.debtor_type where key='INMUEBLE'),
      'A054-'||i,'Sintetico054',true from generate_series(1,1005) i;
    insert into public.debtor_person(id,debtor,person,priority,role,active)
      select 954000+i,954000+i,954000+i,100,'Titular',true from generate_series(1,1005) i;
    insert into public.debt(id,external_id,debtor,type,description,original_amount,current_amount,currency,due_date,status)
      select 954000+i,8000000+i,954000+i,'inmuebles','Deuda importada desde TSV - DEUD_id '||(8000000+i),
      9,10,(select id from public.currency where code='ARS'),'2026-01-01',(select id from public.debt_status where key='OVERDUE')
      from generate_series(1,1005) i;
    insert into public.debtor(id,tenant,external_id,type,identifier,description,status)
      values(955100,920002,7001006,(select id from public.debtor_type where key='INMUEBLE'),'OTRO','NO INFLUYE',true);
    """)
    return source()


def upload(http,token,files):
    response=http.post('/imports',headers={'Authorization':'Bearer '+token,'Idempotency-Key':str(uuid.uuid4())},
                       data={'as_of':'2026-09-30'},files={k:(k+'.tsv',v,'text/tab-separated-values') for k,v in files.items()})
    assert response.status_code==201
    return response.json()['root_id']


def body(root,**updates):
    profile=json.loads((ROOT/'contracts/source-mapping.sintetico-v1.json').read_text())
    return {'expected_event':root,'profile':profile,'mapping_hash':canonical_json_hash(effective_mapping(profile)),
            'absent_policy':'conservar',**updates}


@pytest.fixture(scope='module')
def token(login):
    return login('importador')


def test_01_real_preparation_exact_oracle_pagination_no_writes(seeded,http,token):
    root=upload(http,token,seeded)
    before=snapshot()
    auth={'Authorization':'Bearer '+token}
    assert http.get(f'/imports/{root}/preview',headers=auth).status_code==404
    response=http.post(f'/imports/{root}/preview',headers=auth,json=body(root))
    assert response.status_code==200, response.text
    review=response.json()
    first=http.get(f'/imports/{root}/preview',headers=auth)
    assert first.status_code==200, first.text
    page=first.json()
    assert page['summary']['counts']==EXPECTED
    assert page['total']==2016 and page['summary']['publishable'] is True
    assert http.get(f'/imports/{root}',headers=auth).json()['status']=='RECIBIDO'
    rows=[]
    for n in range(1,22):
        result=http.get(f'/imports/{root}/preview',params={'page':n,'revision':review['revision']},headers=auth)
        assert result.status_code==200
        rows.extend(result.json()['rows'])
    assert len(rows)==2016 and len({(r['archivo'],r['linea']) for r in rows})==2016
    assert {(r['archivo'],r['linea']) for r in rows if r['kind']=='actualizacion'}=={('cabecera',1005),('detalle',1006)}
    assert {(r['archivo'],r['linea']) for r in rows if r['kind']=='alta'}=={('cabecera',1007),('detalle',1007)}
    assert any('DUPLICADO_IDENTICO' in r['codes'] for r in rows)
    assert any('DUPLICADO_CONFLICTIVO' in r['codes'] for r in rows)
    for kind,count in EXPECTED.items():
        filtered=http.get(f'/imports/{root}/preview',params={'kind':kind},headers=auth).json()
        assert filtered['total']==count and all(r['kind']==kind for r in filtered['rows'])
    assert snapshot()==before
    # Bindings, payload hash and032 versions remain exactly what032 expects.
    publication=review['publication']
    stored=json.loads(psql(f"select jsonb_build_object('hash',payload_hash,'rows',(select jsonb_agg(jsonb_build_object('kind',kind,'payload',payload) order by row_number) from public.import_row_staging where batch_id={publication['batch_id']})) from public.import_publication where batch_id={publication['batch_id']}"))
    encoded=json.dumps(stored['rows'],sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()
    assert hashlib.sha256(encoded).hexdigest()==stored['hash']


_counter=0

def new_preview(http,token,seeded):
    global _counter
    _counter+=1
    files={**seeded,'cabecera':seeded['cabecera']+b'\n'*_counter}
    root=upload(http,token,files)
    response=http.post(f'/imports/{root}/preview',headers={'Authorization':'Bearer '+token},json=body(root))
    assert response.status_code==200,response.text
    return root,response.json()


@pytest.mark.parametrize('method',['get','post'])
@pytest.mark.parametrize('role,status',[('anonymous',401),('operador',403),('sin-membresia',403),('otro-importador',404)])
def test_02_auth_and_tenant(seeded,http,token,login,method,role,status):
    root=upload(http,token,seeded)
    auth={} if role=='anonymous' else {'Authorization':'Bearer '+login(role)}
    result=(http.get(f'/imports/{root}/preview',headers=auth) if method=='get' else
            http.post(f'/imports/{root}/preview',headers=auth,json=body(root)))
    assert result.status_code==status


@pytest.mark.parametrize('selector',['99999999','0001','-1','9223372036854775808','CENTINELA_ID'])
def test_03_identifiers(seeded,http,token,selector,api_server):
    response=http.get(f'/imports/{selector}/preview',headers={'Authorization':'Bearer '+token})
    assert response.status_code in (404,422)
    assert selector not in response.text
    assert 'CENTINELA_ID' not in api_server.logs()


@pytest.mark.parametrize('query',['page=0','page=01','page=6001','page=1&page=2','kind=object','kind=alta&kind=conflicto',
                                  'tenant=920002','revision=CENTINELA_QUERY'])
def test_04_filters(seeded,http,token,query):
    root=upload(http,token,seeded)
    response=http.get(f'/imports/{root}/preview?{query}',headers={'Authorization':'Bearer '+token})
    assert response.status_code==422


def test_05_revision_expiry_and_terminal(seeded,http,token,api_server):
    import os
    root,review=new_preview(http,token,seeded);auth={'Authorization':'Bearer '+token}
    for params,expected in [({'page':2},409),({'revision':'f'*64},409),({'page':22,'revision':review['revision']},422)]:
        assert http.get(f'/imports/{root}/preview',headers=auth,params=params).status_code==expected
    assert http.post(f'/imports/{root}/preview',headers=auth,json=body(root,mapping_hash='f'*64)).status_code==409
    assert http.post(f'/imports/{root}/preview',headers=auth,json=body(root,expected_event=root+1)).status_code==409
    directory=api_server.store_root/'lotes'/'920001'/str(root)
    os.utime(directory,(1,1))
    assert http.get(f'/imports/{root}/preview',headers=auth).status_code==410
    assert http.post(f'/imports/{root}/preview',headers=auth,json=body(root,expected_preview=review['revision'])).status_code==410
    another=upload(http,token,seeded)
    assert http.post(f'/imports/{another}/discard',headers=auth).status_code==200
    assert http.post(f'/imports/{another}/preview',headers=auth,json=body(another)).status_code==409


def test_06_direct_data_api_cannot_read_or_write_staging(seeded,env,login,import_jwt):
    for credential in (env['ANON_KEY'],login('importador'),import_jwt):
        headers={'apikey':env['ANON_KEY'],'Authorization':'Bearer '+credential}
        for table in ('import_preview','import_preview_row_staging','import_row_staging'):
            response=httpx.get(env['API_URL']+'/rest/v1/'+table,headers=headers,timeout=10,trust_env=False)
            assert response.status_code in (401,403)
    for credential in (env['ANON_KEY'],login('importador')):
        headers={'apikey':env['ANON_KEY'],'Authorization':'Bearer '+credential}
        for rpc,params in [('read_import_preview',{'p_actor_user':920004,'p_tenant':920001,'p_root':1,'p_head':1}),
                           ('read_import_preview_source',{'p_actor_user':920004,'p_tenant':920001,'p_root':1,'p_head':1,'p_people':[],'p_table':'debt'}),
                           ('prepare_import_preview',{'p_actor_user':920004,'p_tenant':920001,'p_root':1,'p_head':1,
                            'p_document':{},'p_rows':[],'p_effects':[],'p_summary':{},'p_token':'a'*64,
                            'p_expires':'2099-01-01','p_publishable':False})]:
            response=httpx.post(env['API_URL']+'/rest/v1/rpc/'+rpc,headers=headers,json=params,timeout=10,trust_env=False)
            assert response.status_code in (401,403)


def test_07_change_during_pagination_rejected_before_persist(seeded,http,token,api_server,monkeypatch):
    from api import auth, import_preview
    from fastapi import HTTPException
    for k,v in api_server.environment.items(): monkeypatch.setenv(k,v)
    root=upload(http,token,{**seeded,'cabecera':seeded['cabecera']+b'\n'*80})
    session=auth.session_for_token(token);client=auth.data_client(session.config,token)
    original=import_preview._rpc;changed=[]
    def interleaved(*args,**kwargs):
        result=original(*args,**kwargs)
        if args[2]=='read_import_preview_source' and not changed:
            psql("update public.debt set current_amount=current_amount+1 where id=955005")
            changed.append(True)
        return result
    monkeypatch.setattr(import_preview,'_rpc',interleaved)
    try:
        context=auth.resolve_tenant_context(client,session)
        with pytest.raises(HTTPException) as error:
            import_preview._prepare(body(root),root,context,session,client)
        assert changed and error.value.detail=='PREVIEW_INVALIDATED'
        assert psql(f'select count(*) from public.import_preview where root_id={root}').strip()=='0'
    finally:
        client.session.close()
        psql("update public.debt set current_amount=10 where id=955005")


def test_08_publication_regression_and_version_invalidation(seeded,http,token,env,import_jwt):
    root,review=new_preview(http,token,seeded);auth={'Authorization':'Bearer '+token}
    before=snapshot()
    record=review['publication']
    actor=int(psql("select id from public.\"user\" where email='tp-a018-importador@example.test'"))
    response=httpx.post(env['API_URL']+'/rest/v1/rpc/publish_import_batch',timeout=120,trust_env=False,
                        headers={'apikey':env['ANON_KEY'],'Authorization':'Bearer '+import_jwt},json={
                            'p_actor_user':actor,'p_tenant':920001,'p_batch_id':record['batch_id'],
                            'p_revision':record['revision'],'p_idempotency_key':record['idempotency_key']})
    assert response.status_code==200,response.text
    assert response.json()['status']=='PUBLICADO' and snapshot()!=before
    assert http.get(f'/imports/{root}/preview',headers=auth).status_code==409
    assert psql(f"select count(*) from public.import_preview_row_staging where root_id={root}").strip()=='0'
    # Direct stable S2: real publication is the cutoff, despite other nonpublished atomic batches.
    published=response.json()['published_event_id']
    cutoff=subprocess.run(['docker','exec','-i','supabase_db_equitas-tp-testing','psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],
                          input='select public.equitas_current_cutoff(920001);',capture_output=True,text=True,timeout=10)
    assert cutoff.returncode==0 and cutoff.stdout.strip()==str(published)


def test_09_later_mutation_invalidates_032_without_business_writes(seeded,http,token,env,import_jwt):
    root,review=new_preview(http,token,seeded)
    psql("update public.debt set current_amount=current_amount+1 where id=955004")
    before=snapshot()
    auth={'Authorization':'Bearer '+token}
    assert http.get(f'/imports/{root}/preview',headers=auth).status_code==409
    actor=int(psql("select id from public.\"user\" where email='tp-a018-importador@example.test'"))
    record=review['publication']
    response=httpx.post(env['API_URL']+'/rest/v1/rpc/publish_import_batch',timeout=120,trust_env=False,
                        headers={'apikey':env['ANON_KEY'],'Authorization':'Bearer '+import_jwt},json={
                            'p_actor_user':actor,'p_tenant':920001,'p_batch_id':record['batch_id'],
                            'p_revision':record['revision'],'p_idempotency_key':record['idempotency_key']})
    assert response.status_code==200 and response.json()['status']=='REQUIERE_NUEVO_PREVIEW'
    assert snapshot()==before


def test_10_other_tenant_changes_do_not_invalidate(seeded,http,token):
    root,review=new_preview(http,token,seeded)
    auth={'Authorization':'Bearer '+token}
    before=http.get(f'/imports/{root}/preview',headers=auth).json()
    psql("update public.debtor set description='OTRO TENANT CAMBIO' where id=955100")
    response=http.get(f'/imports/{root}/preview',headers=auth)
    assert response.status_code==200 and response.json()==before


@pytest.mark.parametrize('policy',['rechazar','conservar','dar-de-baja'])
def test_11_absent_policies_preserve_business_and_allow_diagnostic(seeded,http,token,policy):
    global _counter
    _counter+=1
    root=upload(http,token,{**seeded,'cabecera':seeded['cabecera']+b'\n'*(100+_counter)})
    # Own baseline contains an additional object absent from this file.
    psql("insert into public.debtor(id,tenant,type,external_id,status) values(955101,920001,(select id from public.debtor_type where key='INMUEBLE'),9999054,true) on conflict(id) do nothing")
    before=snapshot();auth={'Authorization':'Bearer '+token}
    response=http.post(f'/imports/{root}/preview',headers=auth,json=body(root,absent_policy=policy))
    assert response.status_code==200,response.text
    result=http.get(f'/imports/{root}/preview',headers=auth)
    assert result.status_code==200
    if policy=='rechazar':
        assert result.json()['summary']['publishable'] is False
        assert result.json()['summary']['blocked_reason']=='PARTIAL_LOAD_REJECTED'
        assert result.json()['publication'] is None
    else:
        assert result.json()['publication'] is not None
    assert snapshot()==before


def test_12_replace_is_revision_bound_and_payload_intact(seeded,http,token):
    root,old=new_preview(http,token,seeded);auth={'Authorization':'Bearer '+token}
    before=snapshot()
    rejected=http.post(f'/imports/{root}/preview',headers=auth,json=body(root))
    assert rejected.status_code==409
    response=http.post(f'/imports/{root}/preview',headers=auth,json=body(root,expected_preview=old['revision']))
    assert response.status_code==200,response.text
    assert response.json()['revision']!=old['revision']
    assert response.json()['publication']['batch_id']==old['publication']['batch_id']
    assert response.json()['publication']['revision']!=old['publication']['revision']
    assert http.get(f'/imports/{root}/preview',headers=auth,params={'page':2,'revision':old['revision']}).status_code==409
    assert http.get(f'/imports/{root}/preview',headers=auth).status_code==200
    assert snapshot()==before


def test_13_server_rpc_rechecks_actor_and_tenant(seeded,http,token,env,import_jwt):
    root,review=new_preview(http,token,seeded)
    headers={'apikey':env['ANON_KEY'],'Authorization':'Bearer '+import_jwt}
    actor=int(psql("select id from public.\"user\" where email='tp-a018-importador@example.test'"))
    for who,tenant in [(actor,920002),(999999999,920001)]:
        result=httpx.post(env['API_URL']+'/rest/v1/rpc/read_import_preview',headers=headers,timeout=15,trust_env=False,
                          json={'p_actor_user':who,'p_tenant':tenant,'p_root':root,'p_head':root})
        assert result.status_code!=200 and 'rows' not in result.json()


def test_14_payload_integrity_and_ttl_purge(seeded,http,token):
    root,review=new_preview(http,token,seeded);auth={'Authorization':'Bearer '+token}
    batch=review['publication']['batch_id']
    def administrative_probe(sql):
        result=subprocess.run(['docker','exec','-i','supabase_db_equitas-tp-testing','psql','-X','-qAt',
                               '-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],
                              input=sql,capture_output=True,text=True,timeout=10)
        assert result.returncode==0,'Administrative synthetic probe failed'
    administrative_probe(f"update public.import_row_staging set payload=payload||'{{\"tamper\":true}}'::jsonb where batch_id={batch} and row_number=1")
    assert http.get(f'/imports/{root}/preview',headers=auth).status_code==409
    administrative_probe(f"update public.import_preview set expires_at=now()-interval '1 second' where root_id={root}")
    assert http.get(f'/imports/{root}/preview',headers=auth).status_code==410
    psql('select public.purge_import_previews()')
    assert psql(f'select count(*) from public.import_preview_row_staging where root_id={root}').strip()=='0'


def administrative(sql):
    """Synthetic local mutations only; never include credentials in a failure."""
    result=subprocess.run(['docker','exec','-i','supabase_db_equitas-tp-testing','psql','-X','-qAt',
                           '-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],
                          input=sql,capture_output=True,text=True,timeout=20)
    assert result.returncode==0,'Administrative synthetic probe failed'
    return result.stdout.strip()


def small_source(seeded,edit=None):
    """Three accepted objects; each invocation has a distinct, reproducible identity."""
    global _counter
    _counter+=1
    files={}
    for kind in ('cabecera','detalle'):
        reader=csv.DictReader(io.StringIO(seeded[kind].decode()),delimiter='\t')
        rows=[next(reader) for _ in range(3)]
        if edit:edit(kind,rows)
        output=io.StringIO()
        writer=csv.DictWriter(output,fieldnames=reader.fieldnames,delimiter='\t',lineterminator='\n')
        writer.writeheader();writer.writerows(rows)
        files[kind]=output.getvalue().encode()+b'\n'*_counter
    return files


def prepare_files(http,token,files):
    root=upload(http,token,files)
    result=http.post(f'/imports/{root}/preview',headers={'Authorization':'Bearer '+token},json=body(root))
    assert result.status_code==200,result.text
    return root,result.json()


def publication_call(env,import_jwt,name,record,**extra):
    actor=int(psql("select id from public.\"user\" where email='tp-a018-importador@example.test'"))
    response=httpx.post(env['API_URL']+'/rest/v1/rpc/'+name,timeout=120,trust_env=False,
        headers={'apikey':env['ANON_KEY'],'Authorization':'Bearer '+import_jwt},json={
            'p_actor_user':actor,'p_tenant':920001,'p_batch_id':record['batch_id'],
            'p_revision':record['revision'],'p_idempotency_key':record['idempotency_key'],**extra})
    assert response.status_code==200,response.text
    return response.json()


def test_15_shared_source_person_uses_032_final_payload_without_conflict(seeded,http,token):
    def change(kind,rows):
        if kind!='cabecera':return
        for n,row in enumerate(rows):
            row.update(Destinatario_Id='9000001',Destinatario=f'Nombre sintetico final {n+1}')
        rows[0].update(Destinatario_Calle='Calle sintetica',Destinatario_Numeracion='123',
                       Destinatario_Localidad='Ciudad sintetica',Destinatario_Provincia='Provincia sintetica')
    before=snapshot()
    root,review=prepare_files(http,token,small_source(seeded,change))
    page=http.get(f'/imports/{root}/preview',headers={'Authorization':'Bearer '+token}).json()
    assert page['summary']['publishable'] is True
    assert page['summary']['counts']['conflicto']==0
    assert len(page['rows'])==6
    batch=review['publication']['batch_id']
    people=json.loads(administrative(f"select jsonb_agg(payload) from public.import_row_staging where batch_id={batch} and kind='person'"))
    assert len(people)==1
    assert people[0]['person']['full_name']=='Nombre sintetico final 3'
    assert people[0]['location']['address']['street']=='Calle sintetica'
    assert snapshot()==before


@pytest.mark.parametrize('terminal',['expired','FALLIDO','DESCARTADO','REQUIERE_NUEVO_PREVIEW'])
def test_16_same_bytes_recover_terminal_or_expired_staging(seeded,http,token,env,import_jwt,terminal):
    files=small_source(seeded)
    root,review=prepare_files(http,token,files)
    auth={'Authorization':'Bearer '+token};record=review['publication'];batch=record['batch_id']
    if terminal=='expired':
        administrative(f"update public.import_publication set expires_at=now()-interval '1 second' where batch_id={batch}")
    elif terminal=='REQUIERE_NUEVO_PREVIEW':
        administrative(f"set role equitas_import_definer; select equitas_import_private.event({batch},'{terminal}','{{}}');")
    else:
        assert publication_call(env,import_jwt,'settle_import_batch',record,p_status=terminal)['status']==terminal
    before=snapshot()
    assert http.get(f'/imports/{root}/preview',headers=auth).status_code==409
    ref=http.get(f'/imports/{root}/preview?reference=1',headers=auth)
    assert ref.status_code==200 and ref.json()['revision']==review['revision']
    assert ref.json()['status']=='PREVIEW_REFERENCIA' and 'rows' not in ref.json()
    stale=http.post(f'/imports/{root}/preview',headers=auth,json=body(root,expected_preview='f'*64))
    assert stale.status_code==409
    result=http.post(f'/imports/{root}/preview',headers=auth,json=body(root,expected_preview=ref.json()['revision']))
    assert result.status_code==200,result.text
    updated=result.json()
    assert updated['publication']['batch_id']==batch and updated['publication']['status']=='VALIDADO'
    assert updated['publication']['revision']!=record['revision']
    assert updated['revision']!=review['revision']
    assert http.get(f'/imports/{root}/preview',headers=auth).status_code==200
    assert snapshot()==before


def test_17_new_upload_supersedes_old_binding_and_returns_publication_receipt(seeded,http,token,env,import_jwt,api_server):
    import os
    files=small_source(seeded)
    root,review=prepare_files(http,token,files);auth={'Authorization':'Bearer '+token}
    record=review['publication'];batch=record['batch_id']
    administrative(f"update public.import_publication set expires_at=now()-interval '1 second' where batch_id={batch}")
    os.utime(api_server.store_root/'lotes'/'920001'/str(root),(1,1))
    assert http.get(f'/imports/{root}/preview',headers=auth).status_code==410
    reference=http.get(f'/imports/{root}/preview?reference=1',headers=auth)
    assert reference.status_code==200 and reference.json()['revision']==review['revision']
    second,current=prepare_files(http,token,files)
    assert second!=root and current['publication']['batch_id']==batch
    assert administrative(f"select invalidated from public.import_preview where root_id={root}")=='t'
    assert http.get(f'/imports/{second}/preview',headers=auth).status_code==200
    published=publication_call(env,import_jwt,'publish_import_batch',current['publication'])
    assert published['status']=='PUBLICADO'
    before=snapshot()
    third,receipt=prepare_files(http,token,files)
    assert third not in (root,second)
    assert receipt['status']=='PREVIEW_YA_PUBLICADO' and receipt['publication']==published
    assert snapshot()==before


@pytest.mark.parametrize('operation',['insert','update','delete','move'])
def test_18_staging_epoch_invalidates_only_affected_publications(seeded,http,token,operation):
    root,review=prepare_files(http,token,small_source(seeded))
    other,other_review=prepare_files(http,token,small_source(seeded))
    batch=review['publication']['batch_id'];other_batch=other_review['publication']['batch_id']
    before=snapshot();auth={'Authorization':'Bearer '+token}
    if operation=='insert':
        sql=f"insert into public.import_row_staging(batch_id,row_number,kind,payload) select batch_id,999999,kind,payload from public.import_row_staging where batch_id={batch} and row_number=1"
    elif operation=='update':
        sql=f"update public.import_row_staging set payload=payload||'{{\"synthetic_tamper\":true}}' where batch_id={batch} and row_number=1"
    elif operation=='delete':
        sql=f"delete from public.import_row_staging where batch_id={batch} and row_number=1"
    else:
        sql=f"update public.import_row_staging set batch_id={other_batch},row_number=999999 where batch_id={batch} and row_number=1"
    administrative(sql)
    assert http.get(f'/imports/{root}/preview',headers=auth).status_code==409
    assert http.get(f'/imports/{other}/preview',headers=auth).status_code==(409 if operation=='move' else 200)
    assert snapshot()==before


def test_19_absent_counts_and_soft_deactivations_match_real_publication(seeded,http,token,env,import_jwt):
    psql("""
    insert into public.contact_type(id,key,value) values(956054,'EMAIL','Correo') on conflict(key) do nothing;
    insert into public.debtor_contact(id,person,type,value,active) values
      (956054,954001,(select id from public.contact_type where key='EMAIL'),'synthetic-absent@example.test',true);
    insert into public.debtor_person(id,debtor,person,priority,role,active) values(956054,954001,954004,100,'Titular',true);
    """)
    root=upload(http,token,small_source(seeded));auth={'Authorization':'Bearer '+token};before=snapshot()
    response=http.post(f'/imports/{root}/preview',headers=auth,json=body(root,absent_policy='dar-de-baja'))
    assert response.status_code==200,response.text
    page=http.get(f'/imports/{root}/preview',headers=auth).json()
    assert page['summary']['absent_counts']['relaciones']==1
    assert page['summary']['absent_counts']['contactos']==1
    assert page['summary']['deactivations']=={'relaciones':1,'contactos':1}
    assert page['publication']['counts']['ausentes']==page['summary']['absent_counts']
    first=next(row for row in page['rows'] if row['archivo']=='cabecera' and row['linea']==2)
    assert first['kind']=='actualizacion' and 'BAJAS_PREVISTAS' in first['codes']
    assert {'debtor_person.active','debtor_contact.active'}<=set(first['changed_fields'])
    assert all('object_key' not in row for row in page['rows'])
    assert snapshot()==before
    published=publication_call(env,import_jwt,'publish_import_batch',response.json()['publication'])
    assert published['status']=='PUBLICADO'
    assert published['counts']['bajas_relaciones']==published['counts']['bajas_contactos']==1
    assert psql('select active from public.debtor_contact where id=956054').strip()=='f'
    assert psql('select active from public.debtor_person where id=956054').strip()=='f'


def test_20_foreign_person_link_never_localizes_the_rejection(seeded,http,token):
    auth={'Authorization':'Bearer '+token};results=[]
    try:
        for person in (954001,954002):
            psql(f"insert into public.debtor_person(id,debtor,person,active) values(956055,955100,{person},true) on conflict(id) do update set person=excluded.person")
            before=snapshot()
            root,review=prepare_files(http,token,small_source(seeded))
            page=http.get(f'/imports/{root}/preview',headers=auth).json()
            assert page['summary']['publishable'] is False and review['publication'] is None
            assert all(row['codes']==['BASE_NO_DISPONIBLE_PARA_PREVIEW'] for row in page['rows'])
            results.append(page['rows'])
            assert snapshot()==before
        assert results[0]==results[1]
    finally:
        psql('delete from public.debtor_person where id=956055')


def test_21_truncate_staging_invalidates_all_bound_previews(seeded,http,token):
    roots=[prepare_files(http,token,small_source(seeded))[0] for _ in range(2)]
    before=snapshot()
    administrative('truncate public.import_row_staging')
    for root in roots:
        assert http.get(f'/imports/{root}/preview',headers={'Authorization':'Bearer '+token}).status_code==409
    assert snapshot()==before
