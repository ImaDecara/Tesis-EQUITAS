"""Contrato de costos y capacidad ALIGN-034: fuentes o supuestos, rangos, reglas v1, documento y mutaciones."""

import copy
import json
import re
import unittest
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / 'contracts/action-costs.v1.json'
RULES = ROOT / 'contracts/decision-rules.v1.json'
DOC = ROOT / 'docs/tesis/costos-acciones-v1.md'
LABEL = 'Borrador — pendiente de validación (ALIGN-034, compuerta antes de cerrar)'
SOURCED = {'NORMATIVA', 'ORDENANZA', 'CONSULTA'}
DECISIONS = {'VALIDADO', 'AJUSTADO', 'OBJETADO'}
INTENSE_STAGES = {'PROPUESTA', 'APROBACION', 'EJECUCION'}
CAPACITY_UNITS = {'personas', 'horas_persona_por_mes', 'horas_persona_por_mes_por_persona'}
# Componentes de la vía judicial, literales de la tesis [P0149], en su orden.
JUDICIAL = [
    'tasa de justicia',
    'aportes a la caja previsional y al colegio profesional de los abogados intervinientes',
    'honorarios de los letrados y procuradores',
    'según el caso, honorarios de martilleros, tasadores y demás profesionales que intervienen en el juicio',
    'gastos de las medidas cautelares',
    'tiempos propios del proceso',
]
ISO_DATE = re.compile(r'\d{4}-\d{2}-\d{2}')
# La extracción de la tesis cubre [P0001]–[P0276] y las tablas T01 y T02 (SOURCES/TESIS-SINTESIS.md).
THESIS_BLOCK = re.compile(r'\[(P\d{4}|T\d{2}\.R\d{2})\]')
PERSONAL = re.compile(r'[\w.+-]+@[\w-]+\.[a-z]{2,}|\b(?:20|23|24|27|30|33|34)-?\d{8}-?\d\b|\b\d{1,2}\.\d{3}\.\d{3}\b'
                      r'|\+54[\d\s-]{8,}')


def is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def as_list(value) -> list:
    return value if isinstance(value, list) else [value]


def es(value) -> str:
    """Número con coma decimal y sin ceros sobrantes, como en el documento (0.25 → '0,25', 60 → '60')."""
    return format(Decimal(str(value)).normalize(), 'f').replace('.', ',') if is_number(value) else '?'


def span_of(p: dict) -> list:
    span = p.get('rango')
    return span if isinstance(span, list) and len(span) == 2 and all(map(is_number, span)) else [None, None]


def check_parameters(c: dict) -> list[str]:
    errors, seen = [], set()
    for p in c['parametros']:
        pid = p['id']
        if pid in seen:
            errors.append(f'{pid}: id duplicado')
        seen.add(pid)
        if p['unidad'] not in c['unidades']:
            errors.append(f'{pid}: unidad no declarada')
        if p['rol'] is not None and p['rol'] not in c['roles']:
            errors.append(f'{pid}: rol no declarado')
        state = p['estado']
        if state not in c['estados_de_parametro']:
            errors.append(f'{pid}: estado no declarado')
            continue
        if state == 'PENDIENTE_FUENTE':
            if p['base'] is not None or p['rango'] is not None or p['fuente'] is not None:
                errors.append(f'{pid}: PENDIENTE_FUENTE con cifra o fuente')
            if not p.get('fuente_requerida'):
                errors.append(f'{pid}: PENDIENTE_FUENTE sin fuente requerida')
            continue
        base, span = p['base'], p['rango']
        if not is_number(base) or not (isinstance(span, list) and len(span) == 2 and all(map(is_number, span))):
            errors.append(f'{pid}: valor o rango no numérico')
            continue
        if not 0 <= span[0] <= base <= span[1]:
            errors.append(f'{pid}: base fuera del rango o rango negativo')
        source = p.get('fuente') or {}
        if source.get('tipo') not in c['tipos_de_fuente'] or not source.get('referencia') \
                or not ISO_DATE.fullmatch(str(source.get('fecha'))):
            errors.append(f'{pid}: valor sin fuente (tipo, referencia y fecha)')
        if state == 'SUPUESTO':
            if source.get('tipo') != 'SUPUESTO_DEL_EQUIPO':
                errors.append(f'{pid}: SUPUESTO sin rótulo SUPUESTO_DEL_EQUIPO')
            if not p.get('justificacion'):
                errors.append(f'{pid}: SUPUESTO sin justificación')
            if p['unidad'].startswith('ars'):
                errors.append(f'{pid}: importe en pesos como supuesto')
        elif source.get('tipo') not in SOURCED:
            errors.append(f'{pid}: CON_FUENTE sin fuente verificable')
    return errors


def check_actions(c: dict, rules: dict) -> list[str]:
    errors = []
    params = {p['id']: p for p in c['parametros']}
    scale = rules['escala_intensidad']
    actions = {}
    for a in c['acciones']:
        aid, level = a['id'], a['intensidad']
        if aid in actions:
            errors.append(f'{aid}: acción duplicada')
        actions[aid] = a
        intense = level >= scale['intensa_desde']
        if a['intensa'] != intense:
            errors.append(f'{aid}: intensa no coincide con intensa_desde')
        if intense:
            if a['sugerible_por_sistema'] or a['intervencion'] is not None or a['reglas']:
                errors.append(f'{aid}: intensidad ≥ 3 sugerible por el sistema')
            if not a['requiere_aprobacion_supervisor']:
                errors.append(f'{aid}: intensidad ≥ 3 sin aprobación de supervisor')
            stages = {(part['etapa'], part['rol']) for part in a['componentes']}
            if {stage for stage, _ in stages} != INTENSE_STAGES or ('APROBACION', 'supervisor') not in stages:
                errors.append(f'{aid}: etapas de acción intensa incompletas')
        else:
            if not a['sugerible_por_sistema'] or a['requiere_aprobacion_supervisor'] or level > scale['maximo_automatico']:
                errors.append(f'{aid}: acción no intensa mal rotulada')
            if {part['etapa'] for part in a['componentes']} != {'EJECUCION'}:
                errors.append(f'{aid}: acción no intensa con etapas de aprobación')
        if a['requiere_canal'] != (level >= 1):
            errors.append(f'{aid}: requiere_canal no sigue la regla de canal')
        for part in a['componentes'] + a['condicionales']:
            p = params.get(part['parametro'])
            if p is None or p['unidad'] != 'horas_persona_por_caso' or p['rol'] != part['rol']:
                errors.append(f'{aid}: componente {part["parametro"]} inexistente, de otra unidad o de otro rol')
        for direct in a['costos_directos']:
            if params.get(direct, {}).get('unidad') != 'ars_por_caso':
                errors.append(f'{aid}: costo directo {direct} inexistente o no es ARS por caso')
    if {a['intensidad'] for a in actions.values()} != {n['nivel'] for n in scale['niveles']}:
        errors.append('intensidades de ALIGN-003 no cubiertas')
    expected = {(name, level) for name, spec in rules['intervenciones'].items() for level in as_list(spec['intensidad'])}
    covered = [(a['intervencion'], a['intensidad']) for a in actions.values() if a['intervencion'] is not None]
    if sorted(covered) != sorted(expected):
        errors.append('intervenciones de las reglas v1 no cubiertas una vez cada una')
    by_pair = {(a['intervencion'], a['intensidad']): a for a in actions.values()}
    for rule in rules['reglas_intervencion']['reglas']:
        target = by_pair.get((rule['intervencion'], rule['intensidad']))
        if target is None or rule['id'] not in target['reglas']:
            errors.append(f'{rule["id"]}: la regla no apunta a la acción que la costea')
    # M1 sobre R4 deja RECORDATORIO_INFORMATIVO (decision-rules.v1.json, modificador_vulnerabilidad).
    if 'M1' not in by_pair.get(('RECORDATORIO_INFORMATIVO', 1), {}).get('reglas', []):
        errors.append('M1: falta en RECORDATORIO_INFORMATIVO')
    review = c['revision_humana']
    if review['motivos'] != list(rules['revision']['motivos']) or params.get(review['parametro'], {}).get('rol') != 'operador':
        errors.append('revisión humana: motivos o parámetro distintos de las reglas v1')
    # Supervisión significativa [P0220]: revisar o aprobar nunca cuesta 0 horas.
    oversight = {review['parametro']} | {part['parametro'] for a in actions.values()
                                         for part in a['componentes'] if part['etapa'] == 'APROBACION'}
    for pid in sorted(oversight):
        if not (span_of(params.get(pid, {}))[0] or 0) > 0:
            errors.append(f'{pid}: revisión o aprobación con mínimo 0')
    return errors


def check_capacity(c: dict) -> list[str]:
    errors = []
    params = {p['id']: p for p in c['parametros']}
    pools = {pool['rol'] for pool in c['capacidad']['fondos']}
    used = {part['rol'] for a in c['acciones'] for part in a['componentes'] + a['condicionales']}
    if not used <= pools:
        errors.append(f'roles sin fondo de capacidad: {sorted(used - pools)}')
    for pool in c['capacidad']['fondos']:
        for pid in pool['formula']:
            p = params.get(pid)
            if p is None or p['unidad'] not in CAPACITY_UNITS or p['rol'] != pool['rol'] or not is_number(p['base']):
                errors.append(f'fondo {pool["rol"]}: parámetro {pid} inexistente, sin cifra o de otro rol')
    return errors


def check_judicial(c: dict) -> list[str]:
    errors = []
    params = {p['id']: p for p in c['parametros']}
    judicial = c['via_judicial']
    if judicial['fuente'] != '[P0149]' or [part['texto_tesis'] for part in judicial['componentes']] != JUDICIAL:
        errors.append('vía judicial: componentes distintos de [P0149]')
    for part in judicial['componentes']:
        if params.get(part['parametro'], {}).get('estado') not in {'PENDIENTE_FUENTE', 'CON_FUENTE'}:
            errors.append(f'vía judicial: {part["parametro"]} con cifra sin fuente')
    return errors


def check_validation(c: dict) -> list[str]:
    errors = []
    validation = c['validacion']
    assumed = {p['id'] for p in c['parametros'] if p['estado'] == 'SUPUESTO'}
    if validation['estado'] == 'PENDIENTE':
        if c['estado'] != 'BORRADOR_PENDIENTE_VALIDACION' or c['rotulo'] != LABEL or validation['registro']:
            errors.append('validación pendiente sin rótulo de borrador o con registros')
    elif validation['estado'] == 'VALIDADO':
        entries = {entry.get('parametro'): entry for entry in validation['registro']}
        if c['estado'] == 'BORRADOR_PENDIENTE_VALIDACION' or not assumed <= set(entries):
            errors.append('validación sin registro de cada supuesto')
        for pid, entry in entries.items():
            if entry.get('decision') not in DECISIONS or not entry.get('rol') or not entry.get('referencia') \
                    or not ISO_DATE.fullmatch(str(entry.get('fecha'))):
                errors.append(f'validación de {pid}: falta decisión, rol, fecha o referencia')
    else:
        errors.append('estado de validación desconocido')
    return errors


def totals(c: dict, components: list[dict], pick) -> dict[str, Decimal]:
    params = {p['id']: p for p in c['parametros']}
    result: dict[str, Decimal] = {}
    for part in components:
        value = pick(params[part['parametro']]) if part['parametro'] in params else None
        if is_number(value):  # Los parámetros inválidos ya fallan en check_parameters/check_actions.
            result[part['rol']] = result.get(part['rol'], Decimal(0)) + Decimal(str(value))
    return result


def base(p):
    return p['base']


def low(p):
    return span_of(p)[0]


def high(p):
    return span_of(p)[1]


def check_example(c: dict) -> list[str]:
    errors = []
    params = {p['id']: p for p in c['parametros']}
    actions = {a['id']: a for a in c['acciones']}
    example = c['ejemplo_calculado']
    if set(example['acciones']) != set(actions):
        errors.append('ejemplo: no cubre todas las acciones')
    for aid, expected in example['acciones'].items():
        parts = actions[aid]['componentes'] if aid in actions else []
        by_role = totals(c, parts, base)
        declared = {role: Decimal(str(v)) for role, v in expected['base_por_rol'].items()}
        if by_role != declared or sum(by_role.values()) != Decimal(str(expected['base_total'])) \
                or sum(totals(c, parts, low).values()) != Decimal(str(expected['min_total'])) \
                or sum(totals(c, parts, high).values()) != Decimal(str(expected['max_total'])):
            errors.append(f'ejemplo: {aid} no coincide con sus componentes')
    intense = next(a for a in actions.values() if a['intensa'])
    objected = totals(c, [part for part in intense['componentes'] if part['etapa'] != 'EJECUCION'], base)
    declared = example['propuesta_intensa_objetada']
    if objected != {k: Decimal(str(v)) for k, v in declared['base_por_rol'].items()} \
            or sum(objected.values()) != Decimal(str(declared['base_total'])):
        errors.append('ejemplo: propuesta objetada no coincide')
    capacity = {}
    for pool in c['capacidad']['fondos']:
        value = Decimal(1)
        for pid in pool['formula']:
            value *= Decimal(str(params[pid]['base'])) if is_number(params.get(pid, {}).get('base')) else 0
        capacity[pool['rol']] = value
    if capacity != {k: Decimal(str(v)) for k, v in example['capacidad_base'].items()}:
        errors.append('ejemplo: capacidad base no coincide con los fondos')
    pairs = {
        'recordatorios_por_mes_con_todo_el_fondo_operador': ('operador', 'H_RECORDATORIO'),
        'contactos_personales_por_mes_con_todo_el_fondo_operador': ('operador', 'H_CONTACTO_PERSONAL_Y_PLAN'),
        'aprobaciones_por_mes_con_todo_el_fondo_supervisor': ('supervisor', 'H_APROBACION_SUPERVISOR'),
        'verificaciones_juridicas_por_mes_con_todo_el_fondo_juridico': ('personal_juridico', 'H_REVISION_JURIDICA'),
    }
    for key, (role, pid) in pairs.items():
        if Decimal(str(example['equivalencias_base'][key])) != capacity.get(role, 0) // Decimal(str(params[pid]['base'])):
            errors.append(f'ejemplo: equivalencia {key} no coincide')
    order = [sum(totals(c, actions[aid]['componentes'], base).values()) for aid in c['orden_de_costos']['acciones']]
    if order != sorted(order):
        errors.append('orden de costos: el total base decrece con la intensidad')
    return errors


def check_citations(text: str) -> list[str]:
    errors = []
    for block in THESIS_BLOCK.findall(text):
        if block.startswith('P') and not 1 <= int(block[1:]) <= 276:
            errors.append(f'cita fuera de la extracción de la tesis: [{block}]')
        if block.startswith('T') and block[:3] not in {'T01', 'T02'}:
            errors.append(f'tabla inexistente en la tesis: [{block}]')
    return errors


def check_document(c: dict, doc: str) -> list[str]:
    errors = []
    if LABEL not in doc or f'`{c["version"]}`' not in doc or c['estado'] not in doc:
        errors.append('documento sin rótulo, versión o estado del contrato')
    rows = {}
    for line in doc.splitlines():
        match = re.match(r'^\| `([A-Z0-9_]+)` \|(.*)\|$', line)
        if match:
            rows.setdefault(match.group(1), []).append([cell.strip() for cell in match.group(2).split('|')])
    for p in c['parametros']:
        found = rows.get(p['id'], [])
        if len(found) != 1:
            errors.append(f'documento: {p["id"]} no tiene exactamente una fila')
            continue
        cells = found[0]
        if p['estado'] == 'PENDIENTE_FUENTE':
            expected = ('—', '—', 'Pendiente de fuente')
        else:
            expected = (es(p['base']), '–'.join(map(es, span_of(p))), 'Supuesto del equipo')
        if (cells[3], cells[4]) != expected[:2] or not cells[5].startswith(expected[2]):
            errors.append(f'documento: {p["id"]} con base, rango o estado distintos del JSON')
    for a in c['acciones']:
        if f'`{a["id"]}`' not in doc:
            errors.append(f'documento: falta la acción {a["id"]}')
    return errors


def check_privacy(text: str) -> list[str]:
    return [f'posible dato personal: {hit}' for hit in PERSONAL.findall(text)]


def validate(c: dict, rules: dict, doc: str) -> list[str]:
    raw = json.dumps(c, ensure_ascii=False)
    return (check_parameters(c) + check_actions(c, rules) + check_capacity(c) + check_judicial(c)
            + check_validation(c) + check_example(c) + check_citations(raw + doc) + check_document(c, doc)
            + check_privacy(raw + doc))


class ActionCostsContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads(CONTRACT.read_text(encoding='utf-8'))
        cls.rules = json.loads(RULES.read_text(encoding='utf-8'))
        cls.doc = DOC.read_text(encoding='utf-8')

    def errors(self, contract=None, doc=None) -> list[str]:
        return validate(contract or self.contract, self.rules, doc or self.doc)

    def mutated(self, change) -> list[str]:
        contract = copy.deepcopy(self.contract)
        change(contract, {p['id']: p for p in contract['parametros']}, {a['id']: a for a in contract['acciones']})
        return self.errors(contract)

    def test_contract_is_valid_and_consistent(self):
        self.assertEqual(self.errors(), [])

    def test_contract_is_a_draft_pending_human_validation(self):
        self.assertEqual(self.contract['estado'], 'BORRADOR_PENDIENTE_VALIDACION')
        self.assertEqual(self.contract['validacion']['estado'], 'PENDIENTE')
        self.assertTrue(self.doc.lstrip('# ').split('\n', 2)[2].startswith(f'> **{LABEL}.**'))

    def test_every_number_is_an_assumption_and_no_peso_has_a_figure(self):
        states = {p['id']: p['estado'] for p in self.contract['parametros']}
        self.assertTrue(states)
        for p in self.contract['parametros']:
            if p['unidad'].startswith('ars') or p['unidad'] == 'meses':
                self.assertEqual(p['estado'], 'PENDIENTE_FUENTE', p['id'])
            else:
                self.assertEqual(p['estado'], 'SUPUESTO', p['id'])

    def test_hand_computed_examples(self):
        actions = {a['id']: a for a in self.contract['acciones']}
        self.assertEqual(sum(totals(self.contract, actions['INTIMACION_ADMINISTRATIVA']['componentes'], base).values()),
                         Decimal('2.0'))
        self.assertEqual(sum(totals(self.contract, actions['DERIVACION_PROCURACION']['componentes'], high).values()),
                         Decimal('6.5'))
        contact = actions['CONTACTO_PERSONAL_Y_PLAN']
        regularized = contact['componentes'] + contact['condicionales']
        self.assertEqual(sum(totals(self.contract, regularized, base).values()), Decimal('1.0'))

    def test_mutations_are_rejected(self):
        def pending_with_zero(c, p, a):
            p['ARS_TASA_DE_JUSTICIA'].update(base=0, rango=[0, 0])

        def peso_as_assumption(c, p, a):
            p['ARS_VALOR_HORA_PERSONA'].update(estado='SUPUESTO', base=1, rango=[1, 1], justificacion='x',
                                               fuente={'tipo': 'SUPUESTO_DEL_EQUIPO', 'referencia': 'x',
                                                       'fecha': '2026-10-29'})

        def break_order(c, p, a):
            p['H_RECORDATORIO'].update(base=0.25)
            p['H_CONTACTO_PERSONAL_Y_PLAN'].update(base=0.2, rango=[0.1, 1.5])

        cases = {
            'valor sin fuente': (lambda c, p, a: p['H_MEJORAR_DATOS'].update(fuente=None), 'valor sin fuente'),
            'supuesto sin rótulo': (lambda c, p, a: p['H_MEJORAR_DATOS']['fuente'].update(tipo='CONSULTA'),
                                    'SUPUESTO sin rótulo'),
            'supuesto sin justificación': (lambda c, p, a: p['H_RECORDATORIO'].update(justificacion=''),
                                           'sin justificación'),
            'base fuera del rango': (lambda c, p, a: p['H_REVISION_CASO'].update(base=0.9), 'fuera del rango'),
            'rango sin sensibilidad': (lambda c, p, a: p['N_OPERADORES'].update(rango=None), 'no numérico'),
            'pendiente con cifra 0': (pending_with_zero, 'PENDIENTE_FUENTE con cifra'),
            'pesos como supuesto': (peso_as_assumption, 'importe en pesos como supuesto'),
            'sistema sugiere 3': (lambda c, p, a: a['INTIMACION_ADMINISTRATIVA'].update(sugerible_por_sistema=True),
                                  'sugerible por el sistema'),
            'intensa sin supervisor': (lambda c, p, a: a['DERIVACION_PROCURACION'].update(
                requiere_aprobacion_supervisor=False), 'sin aprobación de supervisor'),
            'intensa sin etapa de aprobación': (lambda c, p, a: a['INTIMACION_ADMINISTRATIVA']['componentes'].pop(2),
                                                'etapas de acción intensa'),
            'intervención sin costear': (lambda c, p, a: c['acciones'].remove(a['SEGUIMIENTO_RECORDATORIO']),
                                         'no cubiertas una vez'),
            'componente inexistente': (lambda c, p, a: a['MEJORAR_DATOS']['componentes'][0].update(parametro='H_X'),
                                       'componente H_X'),
            'componente de otro rol': (lambda c, p, a: a['REVISION_JURIDICA']['componentes'][0].update(rol='operador'),
                                       'de otro rol'),
            'aprobación gratuita': (lambda c, p, a: p['H_APROBACION_SUPERVISOR'].update(rango=[0, 0.5]), 'mínimo 0'),
            'rol sin capacidad': (lambda c, p, a: c['capacidad']['fondos'].pop(), 'roles sin fondo'),
            'cifra judicial sin fuente': (lambda c, p, a: p['MESES_DURACION_PROCESO'].update(
                estado='SUPUESTO', base=12, rango=[6, 24]), 'vía judicial'),
            'componente judicial omitido': (lambda c, p, a: c['via_judicial']['componentes'].pop(), 'componentes'),
            'validado sin registro': (lambda c, p, a: c['validacion'].update(estado='VALIDADO'),
                                      'sin registro de cada supuesto'),
            'rótulo alterado': (lambda c, p, a: c.update(rotulo='Aprobado'), 'rótulo de borrador'),
            'ejemplo desactualizado': (lambda c, p, a: c['ejemplo_calculado']['acciones']['MEJORAR_DATOS'].update(
                base_total=0.3), 'MEJORAR_DATOS no coincide'),
            'orden de costos invertido': (break_order, 'orden de costos'),
            'cita inexistente': (lambda c, p, a: c['via_judicial'].update(regla='[P0300]'), '[P0300]'),
            'dato personal': (lambda c, p, a: c.update(datos_personales='contacto@ejemplo.com.ar'),
                              'posible dato personal'),
        }
        for name, (change, expected) in cases.items():
            with self.subTest(name):
                errors = self.mutated(change)
                self.assertTrue(any(expected in error for error in errors), errors)

    def test_document_drift_is_rejected(self):
        self.assertIn('| `H_MEJORAR_DATOS` | ', self.doc)
        drifted = self.doc.replace('| h-persona por caso | 0,25 | 0,1–0,75 |', '| h-persona por caso | 0,3 | 0,1–0,75 |', 1)
        self.assertNotEqual(drifted, self.doc)
        self.assertTrue(any('H_MEJORAR_DATOS' in error for error in self.errors(doc=drifted)))
        unlabeled = self.doc.replace(LABEL, 'Versión aprobada')
        self.assertTrue(any('rótulo' in error for error in self.errors(doc=unlabeled)))


if __name__ == '__main__':
    unittest.main()
