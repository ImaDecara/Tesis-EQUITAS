"""R054-03/04: real API, municipal volume and API death, with an owned local DB turn.

The versioned generator supplies2924 objects/56273 debts. Doubling only identities
stays within the input contract. Reports contain timings/counts/hashes, never rows.
"""
import hashlib
import json
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

import httpx
import pytest
from conftest import BACK, ROOT, free_port, psql, wait_for_port
from test_import_publish_scale import _accepted_scale
from test_prevalidate import body, publication_call, snapshot, upload

from api.upload_store import UploadStore, UploadStoreBusy


def record(name, value):
    destination=os.environ.get('EQUITAS_PREVIEW_SCALE_EVIDENCE')
    if destination:
        folder=Path(destination);folder.mkdir(parents=True,exist_ok=True)
        (folder/(name+'.json')).write_text(json.dumps(value,indent=2)+'\n')


@pytest.fixture(scope='module')
def lots(tmp_path_factory,accounts):
    work=tmp_path_factory.mktemp('preview-scale')
    generated=work/'generated'
    result=subprocess.run([sys.executable,str(ROOT/'quality/fixtures/synthetic_portfolio.py'),
        '--output',str(generated),'--profile','escala','--sin-variantes'],cwd=ROOT,
        capture_output=True,timeout=600)
    assert result.returncode==0,'Versioned synthetic generator failed'
    accepted=work/'accepted'
    assert _accepted_scale(generated,accepted)==(2924,56273)
    doubled=work/'doubled';doubled.mkdir()
    for name,keys in {'cabecera.tsv':('ClaveAgrupacion','Cuenta','Destinatario_Id'),
                      'detalle.tsv':('ClaveAgrupacion','Cuenta','DEUD_id')}.items():
        header,*rows=(accepted/name).read_text().splitlines()
        indices=[header.split('\t').index(key) for key in keys]
        output=[header,*rows]
        for row in rows:
            values=row.split('\t')
            for index in indices:
                value=values[index]
                values[index]=str(int(value)+10**8) if value.isdigit() else value+'-R1'
            output.append('\t'.join(values))
        (doubled/name).write_text('\n'.join(output)+'\n')
    psql("""
    insert into public.debtor_type(id,key,value) values(954101,'INMUEBLE','Inmueble'),(954103,'RODADO','Rodado'),(954106,'AGUA','Agua') on conflict do nothing;
    insert into public.document_type(id,key,value) values(954111,'CUIT','CUIT'),(954114,'UNKNOWN','Desconocido') on conflict do nothing;
    insert into public.person_type(id,key,value) values(954121,'INDIVIDUAL','Persona humana'),(954122,'LEGAL_PERSON','Persona juridica'),(954125,'UNKNOWN','Desconocido') on conflict do nothing;
    insert into public.person_status(id,key,value) values(954133,'UNKNOWN','Desconocido') on conflict do nothing;
    insert into public.currency(id,code,name) values(954141,'ARS','Peso') on conflict do nothing;
    insert into public.debt_status(id,key,value) values(954151,'ACTIVE','Vigente'),(954152,'OVERDUE','Vencida'),(954156,'PAID','Pagada'),(954157,'CANCELLED','Cancelada'),(954158,'UNKNOWN','Desconocido'),(954159,'SUSPENDED','Suspendida') on conflict do nothing;
    insert into public.contact_type(id,key,value) values(954161,'PHONE','Telefono'),(954162,'MOBILE','Celular'),(954163,'EMAIL','Email') on conflict do nothing;
    """)
    return accepted,doubled


def files(lot,suffix=b''):
    return {kind:(lot/(kind+'.tsv')).read_bytes()+suffix for kind in ('cabecera','detalle')}


def test_scale_previews_and_pages_preserve_portfolio(lots,api_server,login,env,import_jwt):
    token=login('importador');auth={'Authorization':'Bearer '+token};reports=[]
    with httpx.Client(base_url=api_server.url,trust_env=False,timeout=300) as client:
        # Empty baseline, a populated baseline and twice municipal volume.
        for index,(lot,suffix) in enumerate(((lots[0],b''),(lots[0],b'\n'),(lots[1],b''))):
            content=files(lot,suffix)
            expected=sum(len(value.splitlines())-1-len(suffix) for value in content.values())
            assert all(len(value)<=25_000_000 for value in content.values())
            root=upload(client,token,content);before=snapshot();started=time.monotonic()
            response=client.post(f'/imports/{root}/preview',headers=auth,json=body(root))
            report={'index':index,'sizes':{k:len(v) for k,v in content.items()},
                    'hashes':{k:hashlib.sha256(v).hexdigest() for k,v in content.items()},
                    'post_seconds':round(time.monotonic()-started,3),'post_status':response.status_code}
            reports.append(report);record('scale',reports)
            assert response.status_code==200,response.text
            review=response.json();timings=[];pages=sorted({1,(expected+199)//200,(expected+99)//100})
            for page in pages:
                started=time.monotonic()
                read=client.get(f'/imports/{root}/preview',headers=auth,params={'page':page,'revision':review['revision']})
                timings.append(round(time.monotonic()-started,3))
                assert read.status_code==200,read.text
                result=read.json()
                assert result['total']==expected and result['summary']['publishable'] is True
                assert sum(result['summary']['counts'].values())==expected
            report.update(page_seconds=timings,total=expected,portfolio_unchanged=snapshot()==before)
            record('scale',reports)
            assert report['portfolio_unchanged']
            # A five-second budget leaves wide local margin but rejects the observed
            # 7s/page regression. Identity/integrity are asserted independently above.
            assert max(timings)<5,'A page must not hash the whole frozen payload again'
            if index==0:
                published=publication_call(env,import_jwt,'publish_import_batch',review['publication'])
                assert published['status']=='PUBLICADO'
                assert published['counts']['objetos_publicados']==2924
                assert published['counts']['deudas_publicadas']==56273


def alive(pid):
    try:os.kill(pid,0);return True
    except ProcessLookupError:return False


def test_api_death_cannot_release_capacity_while_worker_is_alive(lots,api_server,login,tmp_path):
    token=login('importador');store=tmp_path/'store';apis=[];worker=None;thread=None;facts={}
    log=(tmp_path/'api-death.log').open('wb')
    def start():
        port=free_port()
        process=subprocess.Popen([sys.executable,'-m','uvicorn','api.main:app','--host','127.0.0.1','--port',str(port)],
            cwd=BACK,env={**api_server.environment,'EQUITAS_IMPORT_TMP_DIR':str(store)},
            stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        apis.append(process);wait_for_port(port,process)
        return process,f'http://127.0.0.1:{port}'
    def post(url,root):
        try:
            with httpx.Client(base_url=url,trust_env=False,timeout=120) as client:
                client.post(f'/imports/{root}/preview',headers={'Authorization':'Bearer '+token},json=body(root))
        except httpx.HTTPError:pass
    try:
        first,url=start()
        with httpx.Client(base_url=url,trust_env=False,timeout=120) as client:
            root=upload(client,token,files(lots[1],b'\n\n'))
        thread=threading.Thread(target=post,args=(url,root));thread.start()
        deadline=time.monotonic()+30
        while worker is None and time.monotonic()<deadline:
            processes=subprocess.run(['ps','-ax','-o','pid=,ppid=,comm='],capture_output=True,text=True,timeout=3)
            for line in processes.stdout.splitlines():
                pid,parent,command=line.strip().split(None,2)
                if int(parent)==first.pid and 'ython' in command:
                    worker=int(pid);break
            time.sleep(0.02)
        assert worker is not None,'Own preview worker was not observed'
        os.kill(worker,signal.SIGSTOP)
        first.kill();first.wait(timeout=10)
        assert alive(worker)
        with pytest.raises(UploadStoreBusy):
            with UploadStore(store).processing_slot():pytest.fail('Paused worker released capacity')
        second,url2=start()
        with httpx.Client(base_url=url2,trust_env=False,timeout=20) as client:
            busy=client.post(f'/imports/{root}/preview',headers={'Authorization':'Bearer '+token},json=body(root))
        assert busy.status_code==429
        started=time.monotonic();os.kill(worker,signal.SIGCONT)
        while alive(worker) and time.monotonic()-started<5:time.sleep(0.02)
        facts.update(worker_still_alive=alive(worker),death_seconds=round(time.monotonic()-started,3),
                     restarted_api_status=busy.status_code)
        assert not alive(worker),'Worker must terminate when its API lifeline closes'
        with UploadStore(store).processing_slot():pass
    finally:
        if worker and alive(worker):os.killpg(worker,signal.SIGKILL)
        for process in apis:
            if process.poll() is None:
                os.killpg(process.pid,signal.SIGTERM);process.wait(timeout=20)
        if thread:thread.join(timeout=20)
        log.close()
        facts['own_apis_stopped']=all(p.poll() is not None for p in apis)
        record('api-death',facts)
