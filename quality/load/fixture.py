"""Deterministic source and independent expected pages for isolated scoring load."""

import hashlib
import json
from types import SimpleNamespace

PATTERNS = (
    ('critical_no_contact', 'critical', 90, 0, 12, 400, 2, 100),
    ('critical_contactable', 'critical', 90, 1, 12, 400, 1, 100),
    ('high_overdue_volume', 'high', 65, 1, 12, 400, 1, 78),
    ('high_recovery_priority', 'high', 65, 1, 2, 30, 1, 68),
    ('medium_recovery', 'medium', 35, 1, 2, 30, 1, 38),
    ('low_monitoring', 'low', 10, 1, 0, 0, 1, 13),
)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def make_dataset():
    profiles, debtors, expected = [], [], []
    for index in range(3600):
        group, band, risk, contact, overdue, days, people, priority = PATTERNS[index % 6]
        identifier = f'E08-{index + 1:06d}'
        profiles.append({'id': index + 1, 'debtor': index + 1, 'active': True,
                         'total_debt_amount': 10000, 'overdue_debt_amount': overdue * 500,
                         'debt_count': 20, 'overdue_debt_count': overdue,
                         'oldest_debt_days': days, 'average_debt_age_days': days // 2,
                         'active_person_count': people, 'available_contact_count': contact,
                         'socioeconomic_risk_level': risk})
        debtors.append({'id': index + 1, 'tenant': 880001, 'external_id': identifier,
                        'identifier': identifier, 'type': 'E08 synthetic',
                        'description': 'Objeto sintetico E08', 'status': 'active'})
        expected.append({'debtor_id': index + 1, 'debtor_profile_id': index + 1,
                         'debtor_identifier': identifier, 'group_key': group, 'risk_band': band,
                         'socioeconomic_risk_level': risk, 'priority_score': priority,
                         'total_debt_amount': 10000, 'overdue_debt_amount': overdue * 500,
                         'debt_count': 20, 'overdue_debt_count': overdue})
    expected.sort(key=lambda row: (row['priority_score'], row['socioeconomic_risk_level'],
                                   row['total_debt_amount']), reverse=True)
    return profiles, debtors, expected


def make_oracle():
    profiles, debtors, expected = make_dataset()
    high = [row for row in expected if row['risk_band'] == 'high']
    return {'fixture_version': 'e08-fixture-v1', 'dataset_hash': digest([profiles, debtors]),
            'profiles': len(profiles), 'debtors': len(debtors), 'represented_debts': 72000,
            'list': {'path': '/case-groups?limit=25&offset=0', 'total': 3600,
                     'limit': 25, 'offset': 0, 'items': expected[:25]},
            'filtered': {'path': '/case-groups?risk_band=high&limit=25&offset=50', 'total': 1200,
                         'limit': 25, 'offset': 50, 'items': high[50:75]},
            'summary': {'path': '/case-groups/summary', 'total_cases': 3600,
                        'groups': {pattern[0]: 600 for pattern in PATTERNS},
                        'risk_bands': {'critical': 1200, 'high': 1200, 'medium': 600, 'low': 600},
                        'contacts': {'without_contact': 600, 'with_contact': 3000}}}


class FixtureQuery:
    def __init__(self, source, table):
        self.source, self.table = source, table
        self.columns, self.ids, self.active = None, None, None

    def select(self, columns):
        self.columns = columns.split(',')
        return self

    def eq(self, column, value):
        if (self.table, column, value) != ('debtor_profile', 'active', True):
            raise ValueError('Unsupported fixture predicate')
        self.active = True
        return self

    def in_(self, column, values):
        if self.table != 'debtor' or column != 'id' or len(values) > 200:
            raise ValueError('Unsupported fixture ID query')
        self.ids = values
        return self

    def execute(self):
        if not self.columns:
            raise ValueError('A projection is required')
        if self.table == 'debtor_profile' and self.active:
            rows = self.source.profiles
        elif self.table == 'debtor' and self.ids is not None:
            rows = [self.source.debtors[key] for key in self.ids if key in self.source.debtors]
        else:
            raise ValueError('Incomplete fixture query')
        return SimpleNamespace(data=[{key: row[key] for key in self.columns} for row in rows])


class FixtureConnector:
    def __init__(self):
        profiles, debtors, _ = make_dataset()
        self.profiles = tuple(profiles)
        self.debtors = {row['id']: row for row in debtors}

    def table(self, name):
        if name not in ('debtor_profile', 'debtor'):
            raise ValueError('Only synthetic read tables are supported')
        return FixtureQuery(self, name)
