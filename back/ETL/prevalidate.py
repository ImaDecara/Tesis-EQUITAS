"""Read-only effects against a complete, version-checked persisted snapshot (ALIGN-054).

A source row is not a staging entity: one header can affect several tables. No profile
RPC, writes, catalog IDs or floating point arithmetic belong in this module.
"""
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation

from ETL.publication import _location, normalized_rows
from ETL.transform import build_person_payload

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


def candidates(batch, tenant):
    rows = normalized_rows(batch, tenant)
    objects = [row['payload'] for row in rows if row['kind'] == 'object']
    source = []
    for obj, payload in zip(batch.objects, objects, strict=True):
        key = (payload['debtor']['type'], payload['debtor']['external_id'])
        for header, relation in zip(obj.headers, payload['relations'], strict=True):
            source.append({'archivo': 'cabecera', 'linea': header.line, 'objeto': obj.reference,
                           'key': key, 'debtor': payload['debtor'], 'person': build_person_payload(header.values),
                           'relation': relation, 'location': _location(header.values)})
        for detail, debt in zip(obj.details, payload['debts'], strict=True):
            source.append({'archivo': 'detalle', 'linea': detail.line, 'objeto': obj.reference,
                           'key': key, 'debt': debt})
    accepted = {(row['archivo'], row['linea']) for row in source}
    for decision in batch.report['decisiones_filas']:
        if (decision['archivo'], decision['linea']) not in accepted:
            source.append({**decision, 'excluded': True})
    return sorted(source, key=lambda row: (row['archivo'], row['linea']))


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
    comparison = Comparison(persisted)
    conflicts, person_values = {}, defaultdict(list)
    # 024 groups by object; a person may occur in several objects. 032 would keep the
    # last person's payload: differing values are an explicit conflict, never last-wins.
    for row in source:
        if row['archivo'] == 'cabecera' and not row.get('excluded'):
            key = row['person']['external_id']
            value = (row['person'], row['location'])
            person_values[key].append((value, row['objeto']))
    for occurrences in person_values.values():
        if any(value != occurrences[0][0] for value, _ in occurrences[1:]):
            for _, reference in occurrences:
                conflicts[reference] = 'PERSONA_INTRAARCHIVO_CONFLICTIVA'
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
