"""Preview effects and coherence; the independent SQL oracle is in tests_real."""
import copy
from datetime import date
from importlib import import_module

import pytest
from oracle_lots import AS_OF, derive_lot

from ETL import publication, run_etl


def engine():
    return import_module('ETL.prevalidate')


def test_preview_classifies_actual_source_without_writes(tmp_path):
    lot = derive_lot(tmp_path / 'lot')
    batch = run_etl._prepare(lot, run_etl._load_mapping(lot, None), AS_OF)
    result = engine().classify(batch, {'debtor': [], 'person': [], 'debt': [],
                                     'debtor_person': [], 'debtor_contact': [], 'address': []}, tenant=1)
    assert result['counts']['alta'] == sum(len(obj.headers) + len(obj.details) for obj in batch.objects)
    assert result['counts']['actualizacion'] == 0
    assert result['counts']['sin_cambios'] == batch.report['conteos']['duplicados_identicos']
    assert {r['archivo'] for r in result['rows']} == {'cabecera', 'detalle'}
    assert len({(r['archivo'],r['linea']) for r in result['rows']}) == len(result['rows'])


def test_exact_numbers_nulls_and_unknown_are_not_zero():
    compare = engine().different_fields
    assert compare({'current_amount':'0.00','status':'UNKNOWN'}, {'current_amount':None,'status':None}) == ['current_amount','status']
    assert compare({'current_amount':'12345678901234.01'}, {'current_amount':'12345678901234.02'}) == ['current_amount']
    assert compare({'current_amount':'1.00','priority':'100'}, {'current_amount':'1','priority':'100.000'}) == []


def header(reference, line, *, name='Sintetica'):
    return {'archivo':'cabecera','linea':line,'objeto':reference,'key':('INMUEBLE',line),
            'debtor':{'type':'INMUEBLE','external_id':line},
            'person':{'external_id':99,'full_name':name},'location':None,
            'relation':{'relation':{'priority':'100','role':'Titular','active':True},'contacts':[]}}


def empty():
    return {table:[] for table in engine().TABLES}


def test_person_conflict_quarantines_every_reference_not_only_last_pair():
    source=[header('A',1),header('B',2),header('C',3,name='Distinta'),header('D',4,name='Distinta')]
    result=engine().classify_candidates(source,empty())
    assert result['counts']['conflicto']==4 and result['new_conflicts']
    assert all(row['excluded'] and 'PERSONA_INTRAARCHIVO_CONFLICTIVA' in row['codes'] for row in result['rows'])


@pytest.mark.parametrize('numeric',['NaN','Infinity','not-a-number'])
def test_invalid_persisted_numeric_never_becomes_zero(numeric):
    with pytest.raises(ValueError,match='PREVIEW_DATA_INVALID'):
        engine().different_fields({'current_amount':'0'}, {'current_amount':numeric})


def test_base_currency_collision_quarantines_whole_object_with_source_trace():
    persisted=empty()
    persisted['debtor']=[{'id':10,'external_id':1,'type':'INMUEBLE'}]
    persisted['debt']=[{'id':20,'debtor':10,'external_id':25,'currency':'USD','current_amount':'10'}]
    source=[header('A',1),{'archivo':'detalle','linea':2,'objeto':'A','key':('INMUEBLE',1),
                          'debt':{'external_id':25,'currency':'ARS','current_amount':'10'}}]
    result=engine().classify_candidates(source,persisted)
    assert result['counts']['conflicto']==2
    assert all(row['excluded'] and 'BASE_MONEDA_CONFLICTIVA' in row['codes'] for row in result['rows'])
    assert [(row['archivo'],row['linea']) for row in result['rows']]==[('cabecera',1),('detalle',2)]


def test_shared_person_has_conflict_without_reading_foreign_values():
    persisted=empty();persisted['person']=[{'id':5,'external_id':99,'shared':True}]
    result=engine().classify_candidates([header('A',1)],persisted)
    assert result['rows'][0]['kind']=='conflicto'
    assert 'BASE_PERSONA_COMPARTIDA' in result['rows'][0]['codes']


def test_relation_contact_and_address_differences_are_updates():
    row=header('A',1)
    row['relation']['contacts']=[{'type':'EMAIL','value':'synthetic@example.test','active':True}]
    row['location']={'province':{'name':'P'},'city':{'name':'C','postal_code':None},'address':{'street':'Calle','number':'1'}}
    persisted=empty()
    persisted.update(debtor=[{'id':10,**row['debtor']}],person=[{'id':5,**row['person']}],
                     debtor_person=[{'id':1,'debtor':10,'person':5,'priority':None,'role':'Titular','active':True}],
                     debtor_contact=[{'id':1,'person':5,**row['relation']['contacts'][0],'active':False}],
                     address=[{'id':1,'person':5,'province':{'name':'P'},'city':{'name':'C','postal_code':'1000'},
                               'address':{'street':'Anterior','number':'1'}}])
    result=engine().classify_candidates([row],persisted)['rows'][0]
    assert result['kind']=='actualizacion'
    assert result['changed_fields']==['address.street','debtor_contact.active','debtor_person.priority']


def test_missing_location_catalog_is_a_change_without_null_coercion():
    assert engine().Comparison.compare({'name':'P'},[None],'province')==(['province'],[])
