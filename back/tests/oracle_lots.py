"""Lotes derivados de sintetico-v1 y comparación de lo persistido contra su oráculo.

No importa nada de ETL: el oráculo (expected.json, ALIGN-023) y los TSV son las únicas fuentes.
Para un objeto cuyos estados una prueba altera a propósito, oracle_with_file_states recalcula del archivo
solo estados y atraso, con la regla del oráculo (convenciones.vencida); el resto sigue siendo expected.json.
Sirve a las pruebas aisladas y a la prueba contra la base local (database/testing/etl_semantic_local.py).
sintetico-v1 completo siempre queda BLOQUEADO; estos lotes permiten ejercitar uno VALIDADO.
"""

import csv
import io
import json
import re
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
NO_OBSERVADO = 'NO_INFORMADO_EN_ORIGEN'


def oracle(municipio: str = 'municipio-sintetico-a') -> dict:
    return json.loads((FIXTURE / 'expected.json').read_text(encoding='utf-8'))['municipios'][municipio]


def accepted_objects(municipio: str = 'municipio-sintetico-a') -> list[dict]:
    return [item for item in oracle(municipio)['objetos'] if item['resultado'] == 'ACEPTADO']


def object_by_case(case: str, municipio: str = 'municipio-sintetico-a') -> dict:
    return next(item for item in oracle(municipio)['objetos'] if item['caso'] == case)


def manifest_state_catalogs() -> dict[str, dict[str, str]]:
    catalogs = json.loads((FIXTURE / 'manifest.json').read_text(encoding='utf-8'))['catalogos']
    return {'NOTD_ESTA_id': catalogs['NOTD_ESTA_id'], 'NOTD_SITU_id': {}}


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
               drop_header_columns: tuple[str, ...] = (), detail_renames: dict[str, str] | None = None) -> Path:
    """Objetos aceptados del oráculo + los casos pedidos, con manifiesto y vigencia de la fixture."""
    selected = accepted_objects() + [object_by_case(case) for case in extra_cases]
    keys = {item['clave_agrupacion'] for item in selected}
    destination.mkdir(parents=True, exist_ok=True)
    _filter_file(FIXTURE / 'cabecera.tsv', destination / 'cabecera.tsv', keys, cabecera_cells or {}, drop_header_columns, {})
    _filter_file(FIXTURE / 'detalle.tsv', destination / 'detalle.tsv', keys, detalle_cells or {},
                 drop_detail_columns, detail_renames or {})
    for name in ('manifest.json', 'contactos-vigencia.json'):
        shutil.copyfile(FIXTURE / name, destination / name)
    return destination


def synthetic_profile(destination: Path, **updates) -> Path:
    """Perfil explícito de la fixture, con su vigencia de contactos, para probar lo que un perfil puede declarar."""
    base = json.loads((FIXTURE.parents[2].parent / 'contracts/source-mapping.sintetico-v1.json').read_text(encoding='utf-8'))
    base['vigencia_contactos'] = json.loads((FIXTURE / 'contactos-vigencia.json').read_text(encoding='utf-8'))['contactos']
    base.update(updates)
    path = destination / 'perfil.json'
    path.write_text(json.dumps(base, ensure_ascii=False), encoding='utf-8')
    return path


def municipio_b_mapping(destination: Path) -> Path:
    """El municipio B exige perfil explícito (contrato de origen §2); catálogos iguales a los del manifiesto."""
    return synthetic_profile(destination, municipio='municipio-sintetico-b', vigencia_contactos=[])


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


def _file_state(row: dict, catalogs: dict[str, dict[str, str]]) -> str | None:
    """Estado observado de una fila del archivo. Un código fuera del catálogo no llega aquí: va a cuarentena."""
    states = [catalogs.get(column, {}).get((row.get(column) or '').strip()) for column in ('NOTD_ESTA_id', 'NOTD_SITU_id')]
    observed = [state for state in states if state not in (None, 'UNKNOWN')]
    return observed[0] if observed else None


def _overdue_from_file(rows: dict[str, dict], cut_off: date,
                       catalogs: dict[str, dict[str, str]]) -> tuple[Decimal, list[int], int]:
    overdue = [row for row in rows.values()
               if _file_state(row, catalogs) == 'PENDIENTE' and _due(row['NOTD_vencimiento']) < cut_off]
    amount = sum((_amount(row['NOTD_totalActualizado']) for row in overdue), Decimal(0))
    not_observed = sum(_file_state(row, catalogs) is None for row in rows.values())
    return amount, [(cut_off - _due(row['NOTD_vencimiento'])).days for row in overdue], not_observed


def _calendar(text: str) -> date | None:
    text = (text or '').strip()
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', text):
        return date.fromisoformat(text)
    return _due(text) if re.fullmatch(r'\d{2}/\d{2}/\d{4}', text) else None


def _profile_overdue_from_file(rows: dict[str, dict], cut_off: date,
                               catalogs: dict[str, dict[str, str]]) -> tuple[Decimal | None, int | None, list[int]]:
    """Mora del perfil con las reglas 1.1.0, sin ETL: no pagadas (estado distinto de PAGADA, o sin estado) con
    importe > 0 y vencimiento anterior al corte. Una no pagada sin importe o vencimiento evaluable, sin ninguna
    vencida, deja importe y conteo nulos (no es un cero legítimo)."""
    unpaid = [row for row in rows.values() if _file_state(row, catalogs) != 'PAGADA']

    def evaluable(row: dict) -> bool:
        due = _calendar(row.get('NOTD_vencimiento'))
        text = (row.get('NOTD_totalActualizado') or '').strip()
        return bool(text) and _amount(text) >= 0 and due is not None and due >= date(1970, 1, 1)

    overdue = [row for row in unpaid if evaluable(row) and _amount(row['NOTD_totalActualizado']) > 0
               and _calendar(row['NOTD_vencimiento']) < cut_off]
    ages = [(cut_off - _calendar(row['NOTD_vencimiento'])).days for row in overdue]
    if not overdue and any(not evaluable(row) for row in unpaid):
        return None, None, ages
    return sum((_amount(row['NOTD_totalActualizado']) for row in overdue), Decimal(0)), len(overdue), ages


def oracle_with_file_states(item: dict, lot: Path, catalogs: dict[str, dict[str, str]] | None = None,
                            cut_off: str = AS_OF) -> dict:
    """Copia de un objeto del oráculo con estados y atraso recalculados del archivo alterado por la prueba."""
    corte = date.fromisoformat(cut_off)
    catalogs = catalogs or manifest_state_catalogs()
    rows = _details_by_key(lot).get(item['clave_agrupacion'], {})
    states = {name: 0 for name in item['estados_al_corte']}
    for row in rows.values():
        state = _file_state(row, catalogs)
        if state == 'PENDIENTE':
            state = 'VENCIDA' if _due(row['NOTD_vencimiento']) < corte else 'VIGENTE'
        states[state or 'UNKNOWN'] += 1
    _, ages, not_observed = _overdue_from_file(rows, corte, catalogs)
    presence = 'OBSERVADO' if ages else NO_OBSERVADO if not_observed else 'NO_APLICA'
    dues = [due.isoformat() for due in map(_calendar, (row['NOTD_vencimiento'] for row in rows.values())) if due]
    oldest = {**item['vencimiento_mas_antiguo'], 'valor': min(dues, default=None)}
    return {**item, 'estados_al_corte': states, 'vencimiento_mas_antiguo': oldest, 'dias_vencida_mas_antigua': {
        'valor': max(ages, default=None), 'presencia': presence, 'completo': not not_observed,
        'filas_no_observadas': {NO_OBSERVADO: not_observed} if not_observed else {},
    }}


def accepted_with_altered(cases: tuple[str, ...], lot: Path, catalogs: dict[str, dict[str, str]] | None = None,
                          cut_off: str = AS_OF) -> list[dict]:
    """Objetos aceptados tal cual en expected.json, salvo los que una prueba alteró, recalculados del archivo."""
    return [oracle_with_file_states(item, lot, catalogs, cut_off) if item['caso'] in cases else item
            for item in accepted_objects()]


def debt_ids(case: str, lot: Path = FIXTURE) -> list[str]:
    return list(_details_by_key(lot).get(object_by_case(case)['clave_agrupacion'], {}))


def to_iso_dates(lot: Path) -> None:
    """Pasa las fechas del detalle a aaaa-mm-dd, para probar un lote que declara ese formato."""
    path = lot / 'detalle.tsv'
    path.write_text(re.sub(r'\b(\d{2})/(\d{2})/(\d{4})\b', r'\3-\2-\1', path.read_text(encoding='utf-8')), encoding='utf-8')


def _sum(rows: list[dict], column: str) -> Decimal:
    return sum((Decimal(str(row[column])) for row in rows), Decimal(0))


def _optional_decimal(value) -> Decimal | None:
    return None if value is None else Decimal(str(value))


def persisted_mismatches(tables: dict[str, list[dict]], expected: list[dict], catalogs: dict[str, dict[str, int]],
                         lot: Path, cut_off: str = AS_OF, state_catalogs: dict[str, dict[str, str]] | None = None) -> list[str]:
    """Compara filas persistidas con el oráculo. Devuelve caso, campo, esperado y obtenido; ningún dato personal."""
    corte = date.fromisoformat(cut_off)
    state_catalogs = state_catalogs or manifest_state_catalogs()
    problems: list[str] = []
    file_details = _details_by_key(lot)
    status_names = {identifier: key for key, identifier in catalogs['debt_status'].items()}
    people = {row['id']: row for row in tables['person']}

    def check(case: str, field: str, wanted, obtained) -> None:
        if wanted != obtained:
            problems.append(f'{case}|{field}|esperado={wanted}|obtenido={obtained}')

    check('lote', 'objetos', len(expected), len(tables['debtor']))
    check('lote', 'perfiles', len(expected), len(tables['debtor_profile']))
    check('lote', 'indice_heredado_detalle', [], [row['risk_value'] for row in tables['debtor_profile_detail']
                                                  if row['risk_value'] is not None])
    check('lote', 'filas_detalle_por_relacion', sum(len(item['personas']) for item in expected), len(tables['debtor_profile_detail']))
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
        details = file_details.get(item['clave_agrupacion'], {})
        _, _, not_observed = _overdue_from_file(details, corte, state_catalogs)
        # Reglas 1.1.0 (perfil 20261110120000): mora por calendario sobre las no pagadas; el estado OVERDUE ya no la
        # decide. El total registrado y los estados persistidos siguen saliendo de expected.json.
        amount, count, ages = _profile_overdue_from_file(details, corte, state_catalogs)
        average = None if not ages else int((Decimal(sum(ages)) / len(ages)).quantize(Decimal(1), rounding=ROUND_HALF_UP))
        delay = item['dias_vencida_mas_antigua']
        check(case, 'total_debt_amount', Decimal(item['importe_actualizado']['valor']), _optional_decimal(profile['total_debt_amount']))
        check(case, 'overdue_debt_amount', amount, _optional_decimal(profile['overdue_debt_amount']))
        for field, wanted in (
            ('debt_count', item['obligaciones']),
            ('overdue_debt_count', count),
            ('oldest_debt_days', max(ages, default=None)),
            ('average_debt_age_days', average),
            ('active_person_count', len(item['personas'])),
            ('available_contact_count', item['contactos_utilizables']),
            ('socioeconomic_risk_level', None),
            ('previous_contact_count', None),
            ('previous_response_count', None),
            ('debt_state_not_observed_count', sum(delay['filas_no_observadas'].values())),
        ):
            check(case, field, wanted, profile[field])
        unobserved = profile['debt_state_not_observed_count']
        presence = 'OBSERVADO' if profile['oldest_debt_days'] is not None else NO_OBSERVADO if unobserved else 'NO_APLICA'
        check(case, 'presencia_del_atraso', 'OBSERVADO' if ages else NO_OBSERVADO if not_observed else 'NO_APLICA', presence)
        check(case, 'atraso_completo', delay['completo'], unobserved == 0)
    return problems
