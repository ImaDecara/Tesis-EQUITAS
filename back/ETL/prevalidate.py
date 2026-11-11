"""Read-only effects against a complete, version-checked persisted snapshot (ALIGN-054).

A source row is not a staging entity: one header can affect several tables. No profile
RPC, writes, catalog IDs or floating point arithmetic belong in this module.
"""
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation

from ETL.publication import normalized_rows

KINDS = ('alta', 'actualizacion', 'sin_cambios', 'conflicto')
TABLES = ('debtor', 'person', 'debt', 'debtor_person', 'debtor_contact', 'address')
NUMERIC = frozenset({'current_amount', 'original_amount', 'priority'})


def different_fields(expected, persisted):
    """Only fields actually written by 032. Missing/null never become zero."""
    changes = []
    for key, value in expected.items():
        other = persisted.get(key)
        if key in NUMERIC and value is not None and other is not None:
            try:
                value, other = Decimal(str(value)), Decimal(str(other))
                if not value.is_finite() or not other.is_finite():
                    raise ValueError('PREVIEW_DATA_INVALID')
            except InvalidOperation:
                raise ValueError('PREVIEW_DATA_INVALID') from None
        if value != other:
            changes.append(key)
    return sorted(changes)


def candidates(batch, tenant, *, rows=None, compact=False):
    """Source locators refer to the exact032 payload, never a second interpretation.

    A person shared by source objects has one final payload (last header and last
    nonempty address in032 order). Compact locators avoid serializing every debt
    twice across the process boundary; expanding them does not copy its payload.
    """
    rows = normalized_rows(batch, tenant) if rows is None else rows
    objects = [(index, row['payload']) for index, row in enumerate(rows) if row['kind'] == 'object']
    source = []
    for obj, (index, payload) in zip(batch.objects, objects, strict=True):
        for member, header in enumerate(obj.headers):
            source.append({'archivo': 'cabecera', 'linea': header.line, 'objeto': obj.reference,
                           'entity': index, 'member': member})
        for member, detail in enumerate(obj.details):
            source.append({'archivo': 'detalle', 'linea': detail.line, 'objeto': obj.reference,
                           'entity': index, 'member': member})
    accepted = {(row['archivo'], row['linea']) for row in source}
    for decision in batch.report['decisiones_filas']:
        if (decision['archivo'], decision['linea']) not in accepted:
            source.append({**decision, 'excluded': True})
    source.sort(key=lambda row: (row['archivo'], row['linea']))
    return source if compact else list(expand_candidates(source, rows))


def expand_candidates(source, rows):
    people = {row['payload']['person']['external_id']: row['payload']
              for row in rows if row['kind'] == 'person'}
    for row in source:
        if row.get('excluded'):
            yield row
            continue
        payload = rows[row['entity']]['payload']
        value = {key: row[key] for key in ('archivo', 'linea', 'objeto')}
        value['key'] = (payload['debtor']['type'], payload['debtor']['external_id'])
        if row['archivo'] == 'detalle':
            value['debt'] = payload['debts'][row['member']]
        else:
            relation = payload['relations'][row['member']]
            person = people[relation['external_id']]
            value.update(debtor=payload['debtor'], relation=relation,
                         person=person['person'], location=person['location'])
        yield value


def _index(rows, keys):
    result = defaultdict(list)
    for row in rows:
        result[tuple(row.get(key) for key in keys)].append(row)
    return result


class Comparison:
    def __init__(self, persisted):
        self.objects = _index(persisted['debtor'], ('type', 'external_id'))
        self.people = _index(persisted['person'], ('external_id',))
        self.debts = _index(persisted['debt'], ('debtor', 'external_id'))
        self.relations = _index(persisted['debtor_person'], ('debtor', 'person'))
        self.contacts = _index(persisted['debtor_contact'], ('person', 'type', 'value'))
        self.addresses = _index(persisted['address'], ('person',))

    @staticmethod
    def compare(expected, found, prefix):
        if len(found) > 1:
            return [], ['BASE_CLAVE_AMBIGUA']
        if not found or found[0] is None:
            return [prefix], []
        if found[0].get('shared'):
            return [], ['BASE_PERSONA_COMPARTIDA']
        return [prefix + '.' + field for field in different_fields(expected, found[0])], []

    def row(self, row):
        objects = self.objects.get(tuple(row['key']), [])
        if len(objects) > 1:
            return 'conflicto', [], ['BASE_CLAVE_AMBIGUA']
        debtor_id = objects[0]['id'] if objects else None
        if row['archivo'] == 'detalle':
            debt = row['debt']
            found = self.debts.get((debtor_id, debt['external_id']), [])
            fields, codes = self.compare(debt, found, 'debt')
            if found and found[0].get('currency') != debt['currency']:
                codes.append('BASE_MONEDA_CONFLICTIVA')
            return ('conflicto' if codes else 'alta' if not found else
                    'actualizacion' if fields else 'sin_cambios'), fields, codes
        person = row['person']
        people = self.people.get((person['external_id'],), [])
        person_id = people[0]['id'] if people else None
        relations = self.relations.get((debtor_id, person_id), [])
        fields, codes = [], []
        items = [(row['debtor'], objects, 'debtor'), (person, people, 'person'),
                 (row['relation']['relation'], relations, 'debtor_person')]
        for contact in row['relation']['contacts']:
            items.append((contact, self.contacts.get((person_id, contact['type'], contact['value']), []), 'debtor_contact'))
        if row['location']:
            # SQL projects the actual location with the same natural catalog names.
            addresses = self.addresses.get((person_id,), [])
            location = row['location']
            for part in ('province', 'city', 'address'):
                expected = location[part]
                if part == 'city' and expected['postal_code'] is None:
                    expected = {k: v for k, v in expected.items() if k != 'postal_code'}
                items.append((expected, [r[part] for r in addresses], part))
        for expected, existing, prefix in items:
            changed, conflict = self.compare(expected, existing, prefix)
            fields.extend(changed)
            codes.extend(conflict)
        return ('conflicto' if codes else 'alta' if not objects or not relations else
                'actualizacion' if fields else 'sin_cambios'), sorted(set(fields)), sorted(set(codes))


def classify_candidates(source, persisted):
    # A batch-level rejection already exists in032. Do not refine that signal into
    # the identity or source row of a person related to another municipality.
    if any(row.get('shared') for row in persisted['person']):
        results = [{**{key: row[key] for key in ('archivo', 'linea', 'objeto')},
                    'kind': 'conflicto', 'codes': ['BASE_NO_DISPONIBLE_PARA_PREVIEW'],
                    'changed_fields': [], 'excluded': True} for row in source]
        counts = {kind: len(results) if kind == 'conflicto' else 0 for kind in KINDS}
        return {'rows': results, 'counts': counts, 'excluded_counts': {'conflicto': len(results)},
                'new_conflicts': True}
    comparison = Comparison(persisted)
    conflicts = {}
    results = []
    for row in source:
        result = {key: row[key] for key in ('archivo', 'linea', 'objeto')}
        excluded = row.get('excluded', False)
        if excluded:
            code = row['codigo']
            kind, fields, codes = ('sin_cambios' if code == 'DUPLICADO_IDENTICO' else 'conflicto'), [], [code]
        else:
            kind, fields, codes = comparison.row(row)
            if kind == 'conflicto':
                conflicts[row['objeto']] = codes[0]
            codes = codes or ['BASE_' + kind.upper()]
            # Private input to the RPC: it identifies source headers affected by
            # relation/contact deactivations, including the person to distinguish
            # coholders. The RPC strips this entire locator before persistence.
            if row['archivo'] == 'cabecera':
                result['object_key'] = [*row['key'], row['person']['external_id']]
        results.append({**result, 'kind': kind, 'codes': codes, 'changed_fields': fields, 'excluded': excluded})
    for row in results:
        if row['objeto'] in conflicts:
            row.update(kind='conflicto', excluded=True, codes=sorted({*row['codes'], conflicts[row['objeto']]}))
    counts = Counter(row['kind'] for row in results)
    # Quarantine and deduplicated rows remain separately countable and paginated.
    return {'rows': results, 'counts': {kind: counts[kind] for kind in KINDS},
            'excluded_counts': dict(Counter(row['kind'] for row in results if row['excluded'])),
            'new_conflicts': bool(conflicts)}


def classify(batch, persisted, *, tenant):
    return classify_candidates(candidates(batch, tenant), persisted)
