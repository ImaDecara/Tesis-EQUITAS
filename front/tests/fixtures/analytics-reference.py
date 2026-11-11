"""Independent SQLite reference for ALIGN-014; no application or rule-engine imports."""
import json
import sqlite3
import sys
from decimal import Decimal

request = json.load(sys.stdin)
raw, filters = request['raw'], request['filters']
db = sqlite3.connect(':memory:')
db.row_factory = sqlite3.Row
db.executescript('''
create table objects(id text primary key, identifier text, type text, profile integer, contact integer);
create table debts(obj text, cents integer, due text, paid integer);
create index debt_object on debts(obj);
''')
profiles = {str(row['debtor']): row['total_debt_amount'] for row in raw['debtorProfiles']}
types = {str(row['id']): row['value'] for row in raw['debtorTypes']}
contacts = {str(row['person']) for row in raw['debtorContacts'] if row['active'] and row['value']}
# Reglas 1.1.0: solo la clave de catálogo PAID excluye una obligación de la mora y del puntaje.
paid_status = {str(row['id']) for row in raw['debtStatuses'] if row.get('key') == 'PAID'}
for row in raw['debtors']:
    key = str(row['id'])
    profile = profiles.get(key)
    db.execute('insert into objects values (?,?,?,?,?)', (key, row['identifier'], types[str(row['type'])], None if profile is None else int(Decimal(str(profile)) * 100), int(key in contacts)))
for row in raw['debts']:
    amount = row['current_amount']
    db.execute('insert into debts values (?,?,?,?)', (str(row['debtor']), None if amount is None else int(Decimal(str(amount)) * 100), row['due_date'],
                                                     int(str(row.get('status')) in paid_status)))
db.execute('create table cutoff(day text)')
db.execute('insert into cutoff values (?)', (raw['batch']['as_of'],))
db.executescript('''
create view evaluated as
select *, not paid and cents is not null and cents>=0 and due is not null and due>='1970-01-01' as valid,
  not paid and cents>0 and due<(select day from cutoff) as overdue,
  cast(julianday((select day from cutoff))-julianday(due) as integer) as days
from debts;
create view sums as
select o.*, sum(d.cents) as total,
  -- Solo pagadas: el objeto se evalúa como sin obligaciones (monto 0, COMPLETA), no como no disponible.
  case when sum(case when paid then 0 else 1 end)=0 then 0 else sum(case when valid then cents end) end as evaluable,
  sum(case when valid then case when overdue then cents else 0 end end) as matured,
  sum(case when valid and overdue then 1 else 0 end) as quantity,
  max(case when valid and overdue then days end) as days,
  min(case when valid and overdue then due end) as oldest,
  sum(case when valid then 1 else 0 end) as valid_count, sum(case when paid then 0 else 1 end) as unpaid_count
from objects o join evaluated d on d.obj=o.id group by o.id;
create view scored as
select *, case when valid_count=0 and unpaid_count>0 then null when quantity=0 then 0 else
  case when evaluable>=100000000 then 50 when evaluable>=50000000 then 40 when evaluable>=20000000 then 30 when evaluable>=5000000 then 20 when evaluable>=1 then 10 else 0 end +
  case when days>=731 then 30 when days>=366 then 25 when days>=181 then 20 when days>=91 then 15 when days>=31 then 10 when days>=1 then 5 else 0 end +
  case when quantity>=12 then 20 when quantity>=6 then 15 when quantity>=3 then 10 when quantity>=1 then 5 else 0 end end as score
from sums;
create view classified as
select *, case when score is null then 'No disponible' when score>=70 then 'ALTO' when score>=40 then 'MEDIO' else 'BAJO' end as risk,
 case when contact=0 or score is null then 'MEJORAR_DATOS' when days>=1825 then 'REVISION_JURIDICA' when score>=70 then 'CONTACTO_PERSONAL_Y_PLAN' when score>=40 then 'RECORDATORIO_INFORMATIVO' else 'SEGUIMIENTO' end as queue,
 case when valid_count=0 and unpaid_count>0 then 'No disponible' when days is null then case when valid_count<unpaid_count then 'No disponible' else 'No aplica' end when days<=30 then '1-30 dias' when days<=90 then '31-90 dias' else '+90 dias' end as aging
from scored;
''')
conditions, params = [], []
for key in ['type', 'risk', 'queue']:
    if filters.get(key):
        conditions.append(f'{key}=?')
        params.append(filters[key])
if filters.get('contact'):
    conditions.append('contact=?')
    params.append(int(filters['contact'] == 'with'))
if filters.get('minAmount'):
    conditions.append('total>=?')
    params.append(int(Decimal(filters['minAmount']) * 100))
if filters.get('q'):
    conditions.append('lower(identifier) like ?')
    params.append('%' + filters['q'].lower() + '%')
db.execute('create table portfolio as select * from classified')
query = 'select * from portfolio' + (' where ' + ' and '.join(conditions) if conditions else '')
db.execute('create table selected as ' + query, params)
def rows(sql):
    return [dict(row) for row in db.execute(sql)]
def group(key):
    return {row[key]: row['n'] for row in db.execute(f'select {key},count(*) n from selected group by {key}')}
result = rows('''select count(*) as count, sum(total)/100.0 totalDebt, sum(matured)/100.0 overdueDebt,
 round(avg(case when quantity>0 then days end)) averageOverdueDays,
 sum(case when quantity>0 then 1 else 0 end) overdueCases,
 sum(case when score>=70 then 1 else 0 end) high,
 sum(contact) as withContact, sum(1-contact) withoutContact from selected''')[0]
if result['count'] == 0:
    for key in ['totalDebt','overdueDebt','overdueCases','high','withContact','withoutContact']:
        result[key] = 0
result.update(byRisk=group('risk'), byType=group('type'), aging=group('aging'))
result['topDebtIds'] = [row['id'] for row in db.execute('select id from selected where total is not null order by total desc,id collate binary asc limit 10')]
result['queues'] = {row['queue']: {'count': row['n'], 'amount': row['amount'], 'mean': row['mean']} for row in db.execute('select queue,count(*) n,sum(evaluable)/100.0 amount,avg(score) mean from selected group by queue')}
result['queueOrder'] = {code: [row['id'] for row in db.execute('select id from selected where queue=? order by score desc,evaluable desc,oldest is null,oldest,id collate binary', (code,))] for code in result['queues']}
json.dump(result, sys.stdout)
