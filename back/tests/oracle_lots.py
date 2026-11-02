"""Lotes derivados de sintetico-v1 y comparación de lo persistido contra su oráculo.

No importa nada de ETL: el oráculo (expected.json, ALIGN-023) y los TSV son las únicas fuentes.
Sirve a las pruebas aisladas y a la prueba contra la base local (database/testing/etl_semantic_local.py).
sintetico-v1 completo siempre queda BLOQUEADO; estos lotes permiten ejercitar uno VALIDADO.
"""

import csv
import io
import json
import shutil
from collections import Counter
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

FIXTURE = Path(__file__).parent / 'fixtures' / 'sintetico-v1'
MUNICIPIO_B = FIXTURE / 'seguridad' / 'municipio-sintetico-b'
AS_OF = '2026-09-30'
ESTADOS_A_CLAVE = {'VENCIDA': 'OVERDUE', 'VIGENTE': 'ACTIVE', 'PAGADA': 'PAID', 'ANULADA': 'CANCELLED',
                   'SUSPENDIDA': 'SUSPENDED', 'UNKNOWN': 'UNKNOWN'}
BIEN_TIPO_A_CLAVE = {'1': 'INMUEBLE', '3': 'RODADO', '6': 'AGUA'}
ESTADO_PENDIENTE = '10'


def oracle(municipio: str = 'municipio-sintetico-a') -> dict:
    return json.loads((FIXTURE / 'expected.json').read_text(encoding='utf-8'))['municipios'][municipio]


def accepted_objects(municipio: str = 'municipio-sintetico-a') -> list[dict]:
    return [item for item in oracle(municipio)['objetos'] if item['resultado'] == 'ACEPTADO']


def object_by_case(case: str, municipio: str = 'municipio-sintetico-a') -> dict:
    return next(item for item in oracle(municipio)['objetos'] if item['caso'] == case)


def _filter_file(source: Path, target: Path, keys: set[str], cells: dict, drop_columns: tuple[str, ...],
                 renames: dict[str, str]) -> None:
    """Conserva cada línea tal cual; solo reescribe las celdas o columnas que una prueba altera a propósito."""
    header, *rows = source.read_text(encoding='utf-8').splitlines()
    columns = header.split('\t')
    kept = [i for i, name in enumerate(columns) if name not in drop_columns]
    lines = ['\t'.join(renames.get(columns[i], columns[i]) for i in kept)]
    for row in rows:
        values = row.split('\t')
        key = values[columns.index('ClaveAgrupacion')]
        if key not in keys:
            continue
        for (clave, external, column), value in cells.items():
            if clave == key and (external is None or external in values):
                values[columns.index(column)] = value
        lines.append('\t'.join(values[i] for i in kept))
    target.write_text('\n'.join(lines) + '\n', encoding='utf-8')


def derive_lot(destination: Path, extra_cases: tuple[str, ...] = (), *, cabecera_cells: dict | None = None,
               detalle_cells: dict | None = None, drop_detail_columns: tuple[str, ...] = (),
               detail_renames: dict[str, str] | None = None) -> Path:
    """Objetos aceptados del oráculo + los casos pedidos, con manifiesto y vigencia de la fixture."""
    selected = accepted_objects() + [object_by_case(case) for case in extra_cases]
    keys = {item['clave_agrupacion'] for item in selected}
    destination.mkdir(parents=True, exist_ok=True)
    _filter_file(FIXTURE / 'cabecera.tsv', destination / 'cabecera.tsv', keys, cabecera_cells or {}, (), {})
    _filter_file(FIXTURE / 'detalle.tsv', destination / 'detalle.tsv', keys, detalle_cells or {},
                 drop_detail_columns, detail_renames or {})
    for name in ('manifest.json', 'contactos-vigencia.json'):
        shutil.copyfile(FIXTURE / name, destination / name)
    return destination


def municipio_b_mapping(destination: Path) -> Path:
    """El municipio B exige perfil explícito (contrato de origen §2); catálogos iguales a los del manifiesto."""
    base = json.loads((FIXTURE.parents[2].parent / 'contracts/source-mapping.sintetico-v1.json').read_text(encoding='utf-8'))
    base['municipio'] = 'municipio-sintetico-b'
    path = destination / 'perfil-b.json'
    path.write_text(json.dumps(base, ensure_ascii=False), encoding='utf-8')
    return path


def _amount(text: str) -> Decimal:
    return Decimal(text.replace('.', '').replace(',', '.'))


def _due(text: str) -> date:
    day, month, year = text.split('/')
    return date(int(year), int(month), int(day))


def _details_by_key(lot: Path) -> dict[str, dict[str, dict]]:
    """Última lectura del archivo, sin ETL: una fila por DEUD_id y clave de agrupación."""
    rows = csv.DictReader(io.StringIO((lot / 'detalle.tsv').read_text(encoding='utf-8')), delimiter='\t')
    result: dict[str, dict[str, dict]] = {}
    for row in rows:
        result.setdefault(row['ClaveAgrupacion'], {}).setdefault(row['DEUD_id'], row)
    return result


def _overdue_from_file(rows: dict[str, dict], cut_off: date) -> tuple[Decimal, list[int]]:
    overdue = [row for row in rows.values()
               if row.get('NOTD_ESTA_id') == ESTADO_PENDIENTE and _due(row['NOTD_vencimiento']) < cut_off]
    amount = sum((_amount(row['NOTD_totalActualizado']) for row in overdue), Decimal(0))
    return amount, [(cut_off - _due(row['NOTD_vencimiento'])).days for row in overdue]


def _sum(rows: list[dict], column: str) -> Decimal:
    return sum((Decimal(str(row[column])) for row in rows), Decimal(0))


def persisted_mismatches(tables: dict[str, list[dict]], expected: list[dict], catalogs: dict[str, dict[str, int]],
                         lot: Path, cut_off: str = AS_OF) -> list[str]:
    """Compara filas persistidas con el oráculo. Devuelve caso, campo, esperado y obtenido; ningún dato personal."""
    corte = date.fromisoformat(cut_off)
    problems: list[str] = []
    file_details = _details_by_key(lot)
    status_names = {identifier: key for key, identifier in catalogs['debt_status'].items()}
    people = {row['id']: row for row in tables['person']}

    def check(case: str, field: str, wanted, obtained) -> None:
        if wanted != obtained:
            problems.append(f'{case}|{field}|esperado={wanted}|obtenido={obtained}')

    check('lote', 'objetos', len(expected), len(tables['debtor']))
    check('lote', 'perfiles', len(expected), len(tables['debtor_profile']))
    check('lote', 'indice_heredado_detalle', 0, len(tables['debtor_profile_detail']))
    for item in expected:
        case = item['caso']
        type_id = catalogs['debtor_type'][BIEN_TIPO_A_CLAVE[item['bien_tipo_id']]]
        found = [row for row in tables['debtor']
                 if row['type'] == type_id and str(row['external_id']) == item['cuenta']]
        check(case, 'debtor', 1, len(found))
        if not found:
            continue
        debtor = found[0]
        debts = [row for row in tables['debt'] if row['debtor'] == debtor['id']]
        check(case, 'obligaciones', item['obligaciones'], len(debts))
        check(case, 'importe_actualizado', Decimal(item['importe_actualizado']['valor']), _sum(debts, 'current_amount'))
        check(case, 'importe_capital', Decimal(item['importe_capital']['valor']), _sum(debts, 'original_amount'))
        states = Counter(status_names[row['status']] for row in debts)
        wanted_states = {ESTADOS_A_CLAVE[name]: count for name, count in item['estados_al_corte'].items()
                         if count and name in ESTADOS_A_CLAVE}
        check(case, 'estados_al_corte', wanted_states, dict(states))
        oldest = min((row['due_date'] for row in debts), default=None)
        check(case, 'vencimiento_mas_antiguo', item['vencimiento_mas_antiguo']['valor'], oldest)
        for row in debts:
            check(case, 'period', None, row['period'])
            check(case, 'issue_date', None, row['issue_date'])
            check(case, 'last_collection_date', None, row['last_collection_date'])
        relations = [row for row in tables['debtor_person'] if row['debtor'] == debtor['id']]
        persons = sorted(people[row['person']]['external_id'] for row in relations)
        check(case, 'personas', sorted(item['personas']), persons)
        declared = [row['priority'] for row in relations]
        percent = item['suma_porcentajes']['valor']
        if percent is None:
            check(case, 'porcentaje_no_es_cero', [None] * len(declared), declared)
        else:
            check(case, 'suma_porcentajes', Decimal(percent), sum((Decimal(str(value)) for value in declared), Decimal(0)))
        if 'OBJETO_INACTIVO_EN_ORIGEN' in item['banderas']:
            check(case, 'objeto_inactivo', False, debtor['status'])
        person_ids = {row['person'] for row in relations}
        contacts = [row for row in tables['debtor_contact'] if row['person'] in person_ids]
        check(case, 'contactos_inactivos', item['contactos_inactivos'], sum(row['active'] is False for row in contacts))
        profile = next((row for row in tables['debtor_profile'] if row['debtor'] == debtor['id']), None)
        if profile is None:
            problems.append(f'{case}|perfil|esperado=1|obtenido=0')
            continue
        amount, ages = _overdue_from_file(file_details.get(item['clave_agrupacion'], {}), corte)
        average = None if not ages else int((Decimal(sum(ages)) / len(ages)).quantize(Decimal(1), rounding=ROUND_HALF_UP))
        for field, wanted in (
            ('total_debt_amount', Decimal(item['importe_actualizado']['valor'])),
            ('overdue_debt_amount', amount),
        ):
            check(case, field, wanted, Decimal(str(profile[field])))
        for field, wanted in (
            ('debt_count', item['obligaciones']),
            ('overdue_debt_count', item['estados_al_corte']['VENCIDA']),
            ('oldest_debt_days', item['dias_vencida_mas_antigua']['valor']),
            ('average_debt_age_days', average),
            ('active_person_count', len(item['personas'])),
            ('available_contact_count', item['contactos_utilizables']),
            ('socioeconomic_risk_level', None),
        ):
            check(case, field, wanted, profile[field])
    return problems
