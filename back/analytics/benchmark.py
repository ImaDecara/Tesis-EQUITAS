"""Adapta el perfil escala sintético a filas crudas; los totales los calcula el mapper TS."""
import json
import sys
from datetime import datetime

from analytics.clustering import ROOT

sys.path.insert(0, str(ROOT))
from quality.fixtures.synthetic_portfolio import TENANT_A, build, parse_money


def raw_scale():
    portfolio = build(profile='escala')
    bundle = {'batch': {'as_of': portfolio['as_of'].isoformat()}, 'debtors': [], 'debts': [],
              'debtStatuses': [{'id': 1, 'key': 'OVERDUE', 'value': 'Vencida'}, {'id': 2, 'key': 'PAID', 'value': 'Pagada'}],
              'debtorTypes': [], 'debtorPeople': [], 'people': [], 'debtorContacts': [], 'debtorProfiles': [], 'warnings': []}
    for obj in portfolio['tenants'][TENANT_A]:
        if not obj.with_header:
            continue
        identifier = len(bundle['debtors']) + 1
        bundle['debtors'].append({'id': identifier})
        for debt in obj.obligations:
            try:
                due = datetime.strptime(debt.due, '%d/%m/%Y').date().isoformat()
            except ValueError:
                due = None
            amount = parse_money(debt.total)
            bundle['debts'].append({'id': len(bundle['debts']) + 1, 'debtor': identifier,
                                    'current_amount': str(amount) if amount is not None else None,
                                    'due_date': due, 'status': 2 if debt.state == '20' else 1})
    return bundle


if __name__ == '__main__':
    print(json.dumps(raw_scale()))
