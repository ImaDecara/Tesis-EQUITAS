"""Doble del límite SQL para los ensayos de transformación del oráculo.

Recibe los mismos documentos normalizados que PostgREST. La atomicidad, permisos,
versiones y concurrencia se comprueban exclusivamente con tests_real; este doble
permite conservar el oráculo de campos y catálogos con IDs deliberadamente distintos.
"""

import copy
import uuid
from collections import Counter
from datetime import date

import httpx

from ETL import load, transform


class PublicationModel:
    def __init__(self, database):
        self.db = database
        self.jobs = {}

    def event(self, job, status, counts):
        doc = job['document']
        params = doc['identity']['parameters']
        self.db.next_id += 1
        event = dict(id=self.db.next_id, p_actor_user=job['actor'], p_tenant=doc['identity']['tenant'],
                     p_source=doc['source'], p_file_hashes=doc['file_hashes'], p_as_of=params['as_of'],
                     p_source_updated_at=doc['source_updated_at'], p_rules_version=params['rules_version'],
                     p_status=status, p_counts=copy.deepcopy(counts) | {'publicacion_atomica': 1},
                     p_supersedes=job.get('head'), p_idempotency_key=str(uuid.uuid4()))
        self.db.batches.append(event)
        job.update(head=event['id'], status=status)
        return event['id']

    def missing(self, job):
        doc, rows = job['document'], job['rows']
        published = load.fetch_published_objects(doc['identity']['tenant'])
        counts = Counter()
        keys = {tuple(row) for row in doc['file_object_keys']}
        counts['objetos'] = len(set(published) - keys)
        relation_ids, contact_ids = set(), set()
        people = {}
        for row in rows:
            if row['kind'] != 'object':
                continue
            obj = row['payload']
            key = (obj['debtor']['type'], str(obj['debtor']['external_id']))
            previous = published.get(key)
            for relation in obj['relations']:
                people.setdefault(relation['external_id'], set()).update((c['type'], c['value']) for c in relation['contacts'])
            if previous is None:
                continue
            counts['obligaciones'] += len(set(previous['obligaciones']) - {d['external_id'] for d in obj['debts']})
            wanted = {r['external_id'] for r in obj['relations']}
            relation_ids.update(identifier for key, identifier in previous['relaciones'].items() if key not in wanted)
        persons = {row['id']: row['external_id'] for row in self.db.tables['person']}
        types = {v: k for k, v in self.db.catalogs['contact_type'].items()}
        for row in self.db.tables['debtor_contact']:
            person = persons[row['person']]
            kind = types[row['type']]
            if (row['active'] and person in people and str(person) not in doc['protected_people']
                    and kind in doc['contact_types'] and (kind, row['value']) not in people[person]):
                contact_ids.add(row['id'])
        counts.update(relaciones=len(relation_ids), contactos=len(contact_ids))
        return {k: v for k, v in counts.items() if v}, relation_ids, contact_ids

    def receipt(self, job):
        return job.get('result') or {k: job[k] for k in ('batch_id', 'idempotency_key', 'revision', 'status', 'counts')}

    def post(self, name, body, url):
        def response(value, status=200):
            return httpx.Response(status, json=value, request=httpx.Request('POST', url))

        if name == 'stage_import_batch':
            document = body['p_document']
            key = transform.canonical_json_hash(document['identity'])
            if key in self.jobs:
                return response(self.receipt(self.jobs[key]))
            job = dict(document=document, rows=body['p_rows'], actor=body['p_actor_user'],
                       counts=copy.deepcopy(document['counts']), idempotency_key=key, revision=key)
            self.jobs[key] = job
            job['batch_id'] = self.event(job, 'RECIBIDO', job['counts'])
            absent, relations, contacts = self.missing(job)
            job.update(relations=relations, contacts=contacts)
            if absent:
                job['counts']['ausentes'] = absent
            if document['identity']['parameters']['absent_policy'] == 'rechazar' and set(absent) - {'contactos'}:
                job['counts']['faltantes'] = absent
                self.event(job, 'FALLIDO', job['counts'])
                job['result'] = self.receipt(job) | {'error': 'PARTIAL_LOAD_REJECTED'}
            else:
                self.event(job, 'VALIDADO', job['counts'])
            return response(self.receipt(job))
        job = self.jobs[body['p_idempotency_key']]
        if job['status'] == 'PUBLICADO':
            return response(self.receipt(job))
        desired = body.get('p_status', 'PUBLICADO')
        outcome = self.db.rpc_outcomes.get(desired)
        if isinstance(outcome, int):
            return response({'message': 'NOMBRE_SINTETICO_A026'}, outcome)
        if isinstance(outcome, str):
            return response({'message': outcome}, 400)
        if isinstance(outcome, BaseException):
            raise outcome
        if name == 'settle_import_batch':
            self.event(job, desired, job['counts'])
            job['result'] = self.receipt(job)
            return response(job['result'])
        assert name == 'publish_import_batch'
        saved = copy.deepcopy(self.db.tables), len(self.db.batches), self.db.writes, self.db.updates
        try:
            self.event(job, 'CONFIRMADO', job['counts'])
            job['counts'].update(self.write(job))
            published_id = self.event(job, 'PUBLICADO', job['counts'])
        except BaseException:
            self.db.tables, length, self.db.writes, self.db.updates = saved
            del self.db.batches[length:]
            job.update(status='VALIDADO', head=self.db.batches[-1]['id'])
            raise
        job['result'] = self.receipt(job) | {'published_event_id': published_id}
        if isinstance(outcome, tuple):
            if outcome[0] == 'perdida':
                raise outcome[1]
            return httpx.Response(200, text='ilegible', request=httpx.Request('POST', url))
        return response(job['result'])

    def write(self, job):
        loaded = Counter()
        tally = load.start_write_tally()
        people, links, debtors = {}, [], []
        catalog = lambda entity, row: transform.with_catalog_ids(entity, row, self.db.catalogs)
        for row in job['rows']:
            if row['kind'] != 'person':
                continue
            payload = row['payload']
            person = load.load_person(catalog('person', payload['person']))['id']
            people[payload['person']['external_id']] = person
            location = payload['location']
            if location:
                province = load.load_province(location['province'])['id']
                city = load.load_city(location['city'] | {'province': province})['id']
                load.load_address(location['address'] | {'person': person, 'city': city})
                loaded['direcciones_publicadas'] += 1
        for row in job['rows']:
            if row['kind'] != 'object':
                continue
            obj = row['payload']
            debtor = load.load_debtor(catalog('debtor', obj['debtor']))['id']
            debtors.append(debtor)
            for relation in obj['relations']:
                person = people[relation['external_id']]
                load.load_debtor_person(relation['relation'] | {'debtor': debtor, 'person': person})
                links.append((debtor, person))
                loaded['relaciones_publicadas'] += 1
                for contact in relation['contacts']:
                    load.load_debtor_contact(catalog('debtor_contact', contact) | {'person': person})
                    loaded['contactos_publicados'] += 1
            result = load.load_debts_bulk([catalog('debt', debt) | {'debtor': debtor} for debt in obj['debts']])
            for output, field in [('publicadas', 'unique'), ('insertadas', 'inserted'), ('actualizadas', 'updated'), ('sin_cambios', 'unchanged')]:
                loaded['deudas_' + output] += result[field]
        params = job['document']['identity']['parameters']
        if params['absent_policy'] == 'dar-de-baja':
            for table, field, ids in [('debtor_person', 'bajas_relaciones', job['relations']), ('debtor_contact', 'bajas_contactos', job['contacts'])]:
                loaded[field] = load.deactivate_rows(table, ids)
        profiles = load.recompute_debtor_profiles(debtors, date.fromisoformat(params['as_of']),
                                                  contact_columns_integrated=job['document']['contact_columns_integrated'])
        for debtor, person in links:
            load.load_debtor_profile_detail(transform.build_debtor_profile_detail_payload(profiles[debtor], person))
        loaded.update(objetos_publicados=len(debtors), perfiles_publicados=len(profiles))
        return dict(loaded) | load.write_summary(tally)
