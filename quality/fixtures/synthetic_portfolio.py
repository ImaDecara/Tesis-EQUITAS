"""Generador determinista de una cartera sintética con forma municipal (ALIGN-023).

Escribe ``cabecera.tsv`` y ``detalle.tsv`` con las columnas que leen ``back/ETL/extract.py``,
``transform.py`` e ``inspect_tsv.py`` (incluidas las opcionales), un ``manifest.json`` con
semilla, conteos y sha256, y un ``expected.json`` calculado con el modelo de este generador:
nunca se importa ni se invoca el ETL. También escribe la misma cartera en CSV y XLSX, la
vigencia explícita de contactos (artefacto complementario), un escenario social separado, la
familia de seguridad (dos municipios y roles) y, a pedido, un corpus de archivos hostiles
generado por código.

Ningún valor proviene de la cartera real: identidades obviamente ficticias y proporciones
redondeadas o supuestas (ver ``docs/tesis/fixtures-sinteticas.md``).
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import random
import re
import sys
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

VERSION = 'sintetico-v1'
DEFAULT_SEED = 20261028
DEFAULT_AS_OF = date(2026, 9, 30)
PROFILES = {
    # Familia contrato: casos borde fijos + relleno chico. Es la fixture versionada.
    'contrato': {'objects': 40, 'obligations': 160},
    # Familia escala: cardinalidades del informe agregado (§3), sin distribuciones finas.
    'escala': {'objects': 2933, 'obligations': 56286},
}
TENANT_A = 'municipio-sintetico-a'
TENANT_B = 'municipio-sintetico-b'
ROLES = ('consulta', 'operador', 'importador', 'supervisor')
ZIP_EPOCH = (1980, 1, 1, 0, 0, 0)
XLSX_TIMESTAMP = '2026-09-30T00:00:00Z'
SENTINEL = 'CENTINELA-EQUITAS-SINTETICO'
XLSX_STORED_LIMIT = 25 * 1000 * 1000

CABECERA_COLUMNS = [
    'ClaveAgrupacion', 'Bien_Tipo_Id', 'Bien_Tipo', 'Cuenta', 'Identificador', 'Bien_Descripcion',
    'Estado', 'Tipo_Ingreso_Id', 'Destinatario_Id', 'Destinatario', 'Destinatario_CUIT',
    'Destinatario_Tipo', 'Destinatario_Porcentaje', 'Destinatario_Telefono', 'Destinatario_Celular',
    'Destinatario_Email', 'Destinatario_Calle', 'Destinatario_Numeracion', 'Destinatario_Piso',
    'Destinatario_Depto', 'Destinatario_Localidad', 'Destinatario_CP', 'Destinatario_Provincia',
    'Deuda_Capital', 'Deuda_Actualizada', 'Periodos_Deuda', 'Fecha_Actualizacion',
]
DETALLE_COLUMNS = [
    'ClaveAgrupacion', 'Bien_Tipo_Id', 'Cuenta', 'DEUD_id', 'Tipo_Ingreso_Id', 'Detalle_Deuda',
    'NOTD_capital', 'NOTD_intereses', 'NOTD_honorarios', 'NOTD_totalActualizado', 'NOTD_vencimiento',
    'NOTD_ESTA_id', 'NOTD_SITU_id',
]

# Catálogos declarados por el lote sintético. Sus IDs no coinciden a propósito con las
# constantes del ETL (p. ej. Tipo_Ingreso_Id 905 no está en transform.infer_debt_type_key).
BIEN_TIPOS = {'1': 'INMUEBLE', '3': 'RODADO', '6': 'AGUA'}
TIPO_INGRESO_POR_BIEN = {'1': '1', '3': '100', '6': '801'}
TIPOS_INGRESO = {'1': 'inmuebles', '100': 'automotor', '801': 'conexion de agua', '905': 'tasa sintetica sin mapeo en el ETL'}
ESTADOS_ORIGEN = {'10': 'PENDIENTE', '20': 'PAGADA', '30': 'ANULADA', '40': 'SUSPENDIDA'}
DESCRIPCIONES = {'1': 'Inmueble sintético', '3': 'Rodado sintético', '6': 'Conexión de agua sintética'}
# Agregados del informe de input (§3) redondeados (5 puntos, o 1 punto si < 5 %) o supuestos:
# reutilización de personas e intereses son supuestos (docs/tesis/fixtures-sinteticas.md §6).
PROPORCIONES = {
    'tipo_bien': {'3': 0.60, '6': 0.35, '1': 0.05},
    'objeto_con_dos_personas': 0.02,
    'persona_reutilizada': 0.10,
    'persona_sin_contacto': 0.55,
    'porcentaje_distinto_de_100': 0.01,
    'interes_maximo_sobre_capital': 0.80,
}
VENCIMIENTO_DESDE = date(2020, 1, 15)
VENCIMIENTO_HASTA = date(2025, 11, 30)
PLACEHOLDERS = {'0', '-', 'NO POSEE'}
HUNDRED = Decimal(100)
CENT = Decimal('0.01')


@dataclass
class Person:
    pid: int
    name: str
    document: str
    phone: str = ''
    mobile: str = ''
    email: str = ''
    # Vigencia declarada por columna de contacto (ACTIVO/INACTIVO). El TSV de origen no tiene esa
    # columna: se escribe en el artefacto complementario contactos-vigencia.json. Sin entrada: activo.
    vigencia: dict[str, str] = field(default_factory=dict)


@dataclass
class Relation:
    person: Person
    percent: str
    role: str = 'Titular'


@dataclass
class Obligation:
    deud_id: str
    capital: str
    interest: str
    fees: str
    total: str
    due: str
    state: str
    tipo_ingreso: str
    detail: str
    extra_rows: list[dict[str, str]] = field(default_factory=list)


@dataclass
class TaxObject:
    tenant: str
    tipo: str
    cuenta: str
    case: str
    relations: list[Relation]
    obligations: list[Obligation]
    estado: str = 'Activo'
    tipo_ingreso: str = ''
    control_offset: Decimal = Decimal(0)
    with_header: bool = True

    @property
    def clave(self) -> str:
        return f'{self.tipo}-{self.cuenta}'


# ------------------------------------------------------------------ formatos de origen

def money(value: Decimal) -> str:
    """Formato del lote: miles con punto y decimales con coma (1.234,56)."""
    text = f'{value.quantize(CENT):,.2f}'
    return text.replace(',', '_').replace('.', ',').replace('_', '.')


def day(value: date) -> str:
    return value.strftime('%d/%m/%Y')


def parse_money(text: str) -> Decimal | None:
    """Lectura estricta del formato declarado; solo la usa el modelo, no el ETL."""
    if not re.fullmatch(r'-?\d{1,3}(\.\d{3})*,\d{2}', text):
        return None
    return Decimal(text.replace('.', '').replace(',', '.'))


def parse_day(text: str) -> date | None:
    if not re.fullmatch(r'\d{2}/\d{2}/\d{4}', text):
        return None
    try:
        return datetime.strptime(text, '%d/%m/%Y').date()
    except ValueError:
        return None


# ------------------------------------------------------------------ construcción del modelo

class Builder:
    def __init__(self, seed: int, as_of: date):
        self.rng = random.Random(f'{seed}:cartera')
        self.as_of = as_of
        self.next_person = 1
        self.next_debt = 700001
        self.next_account = 10001
        self.people: list[Person] = []

    def person(self, *, contact: bool = True, legal: bool = False) -> Person:
        n = self.next_person
        self.next_person += 1
        kind = 'Entidad Sintética' if legal else 'Persona Sintética'
        # Prefijo 99: no asignado a CUIT/CUIL; el documento no puede pertenecer a nadie.
        person = Person(pid=90000 + n, name=f'{kind} {n:04d}', document=f'99-{n:08d}-{n % 10}')
        if contact:
            channel = self.rng.choice(('phone', 'mobile', 'email', 'all'))
            if channel in ('phone', 'all'):
                person.phone = f'0000-555-{n:04d}'
            if channel in ('mobile', 'all'):
                person.mobile = f'0000-15-555-{n:04d}'
            if channel in ('email', 'all'):
                person.email = f'persona.sintetica.{n:04d}@example.invalid'
        self.people.append(person)
        return person

    def account(self) -> str:
        value = str(self.next_account)
        self.next_account += 1
        return value

    def obligation(self, tipo_ingreso: str) -> Obligation:
        debt_id = str(self.next_debt)
        self.next_debt += 1
        capital = Decimal(self.rng.randint(5_000, 2_500_000)) / 100
        interest = (capital * Decimal(self.rng.randint(0, int(PROPORCIONES['interes_maximo_sobre_capital'] * 100))) / 100).quantize(CENT)
        span = (VENCIMIENTO_HASTA - VENCIMIENTO_DESDE).days
        due = VENCIMIENTO_DESDE + timedelta(days=self.rng.randint(0, span))
        return Obligation(
            deud_id=debt_id, capital=money(capital), interest=money(interest), fees=money(Decimal(0)),
            total=money(capital + interest), due=day(due), state='10', tipo_ingreso=tipo_ingreso,
            detail=f'Cuota {due.month:02d}/{due.year} (sintética)',
        )

    def obj(self, tenant: str, tipo: str, case: str, relations: list[Relation], n: int,
            cuenta: str | None = None, **extra) -> TaxObject:
        tipo_ingreso = extra.pop('tipo_ingreso', TIPO_INGRESO_POR_BIEN.get(tipo, '1'))
        obligations = [self.obligation(tipo_ingreso) for _ in range(n)]
        return TaxObject(tenant=tenant, tipo=tipo, cuenta=cuenta or self.account(), case=case,
                         relations=relations, obligations=obligations, tipo_ingreso=tipo_ingreso, **extra)


def contract_cases(b: Builder) -> list[TaxObject]:
    """Familia contrato: un objeto por caso borde, con oráculo manual en las pruebas."""
    def one(**kw) -> list[Relation]:
        return [Relation(b.person(**kw), '100')]

    cases = [
        b.obj(TENANT_A, '3', 'base-valido', one(), 3, cuenta='4100'),
        b.obj(TENANT_A, '6', 'misma-cuenta-otro-tipo', one(), 2, cuenta='4100'),
        b.obj(TENANT_A, '3', 'cuenta-canonica-123', one(), 1, cuenta='123'),
        b.obj(TENANT_A, '3', 'cuenta-ceros-izquierda', one(), 1, cuenta='000123'),
        b.obj(TENANT_A, '6', 'cuenta-alfanumerica', one(), 1, cuenta='R-0456'),
    ]
    zero = b.obj(TENANT_A, '6', 'importe-cero', one(), 2)
    zero.obligations[0].total = money(Decimal(0))
    zero.obligations[0].capital = money(Decimal(0))
    zero.obligations[0].interest = money(Decimal(0))
    empty = b.obj(TENANT_A, '6', 'importe-vacio', one(), 2)
    empty.obligations[1].total = ''
    bad = b.obj(TENANT_A, '3', 'importe-no-numerico', one(), 2)
    bad.obligations[0].capital = 'abc'
    ambiguous = b.obj(TENANT_A, '3', 'fecha-ambigua', one(), 1)
    ambiguous.obligations[0].due = '03/04/2023'
    impossible = b.obj(TENANT_A, '3', 'fecha-imposible', one(), 1)
    impossible.obligations[0].due = '31/02/2024'
    states = b.obj(TENANT_A, '6', 'estados-origen-vencimiento-viejo', one(), 5)
    for obligation, state in zip(states.obligations, ('20', '30', '40', '10', '')):
        obligation.state = state
        obligation.due = '15/01/2020'
    future = b.obj(TENANT_A, '3', 'vencimiento-posterior-al-corte', one(), 1)
    future.obligations[0].due = day(b.as_of + timedelta(days=45))
    placeholder = b.person(contact=False)
    placeholder.phone, placeholder.mobile, placeholder.email = '0', '-', 'NO POSEE'
    invalid_mail = b.person(contact=False)
    invalid_mail.email = f'persona.sintetica.{invalid_mail.pid}(arroba)example.invalid'
    shared = b.person()
    pair = [Relation(b.person(), '50', 'Titular'), Relation(b.person(), '50', 'Cotitular')]
    cases += [
        zero, empty, bad, ambiguous, impossible, states, future,
        b.obj(TENANT_A, '3', 'contacto-placeholder', [Relation(placeholder, '100')], 1),
        b.obj(TENANT_A, '3', 'contacto-formato-invalido', [Relation(invalid_mail, '100')], 1),
        b.obj(TENANT_A, '3', 'sin-contacto', one(contact=False), 2),
        b.obj(TENANT_A, '6', 'dos-personas-un-objeto', pair, 2),
        b.obj(TENANT_A, '3', 'persona-varios-objetos-1', [Relation(shared, '100')], 1),
        b.obj(TENANT_A, '6', 'persona-varios-objetos-2', [Relation(shared, '100')], 1),
        b.obj(TENANT_A, '1', 'persona-varios-objetos-3', [Relation(shared, '100')], 1),
        b.obj(TENANT_A, '6', 'porcentajes-120', [Relation(b.person(), '60'), Relation(b.person(), '60', 'Cotitular')], 1),
        b.obj(TENANT_A, '3', 'porcentaje-80', [Relation(b.person(), '80')], 1),
        b.obj(TENANT_A, '3', 'porcentaje-faltante', [Relation(b.person(), '')], 1),
        b.obj(TENANT_A, '1', 'persona-juridica', [Relation(b.person(legal=True), '100', 'Responsable')], 1),
        b.obj(TENANT_A, '3', 'objeto-inactivo-en-origen', one(), 1, estado='Inactivo'),
        b.obj(TENANT_A, '6', 'tipo-ingreso-sin-mapeo-etl', one(), 1, tipo_ingreso='905'),
        b.obj(TENANT_A, '6', 'tipo-ingreso-fuera-de-catalogo', one(), 1, tipo_ingreso='999'),
        b.obj(TENANT_A, '9', 'tipo-bien-fuera-de-catalogo', one(), 1),
        b.obj(TENANT_A, '3', 'conciliacion-diferente', one(), 2, control_offset=Decimal('10.00')),
        b.obj(TENANT_A, '6', 'cabecera-sin-detalle', one(), 0),
    ]
    identical = b.obj(TENANT_A, '3', 'duplicado-identico', one(), 2)
    identical.obligations[0].extra_rows.append({})
    conflicting = b.obj(TENANT_A, '6', 'duplicado-conflictivo', one(), 2)
    conflicting.obligations[0].extra_rows.append({'NOTD_totalActualizado': money(Decimal('1.00'))})
    orphan = b.obj(TENANT_A, '3', 'detalle-sin-cabecera', one(), 1, with_header=False)
    # Contacto dado de baja: el mismo teléfono bien formado está INACTIVO para una persona y ACTIVO
    # para otra; solo contactos-vigencia.json los distingue (el TSV no trae vigencia).
    inactive, active = b.person(contact=False), b.person(contact=False)
    number = inactive.pid - 90000
    inactive.phone, inactive.email = f'0000-555-{number:04d}', f'persona.sintetica.{number:04d}@example.invalid'
    inactive.vigencia = {'Destinatario_Telefono': 'INACTIVO', 'Destinatario_Email': 'INACTIVO'}
    active.phone, active.vigencia = inactive.phone, {'Destinatario_Telefono': 'ACTIVO'}
    return cases + [identical, conflicting, orphan,
                    b.obj(TENANT_A, '3', 'contacto-inactivo', [Relation(inactive, '100')], 1),
                    b.obj(TENANT_A, '6', 'contacto-activo-mismo-valor', [Relation(active, '100')], 1)]


def filler(b: Builder, tenant: str, objects: int, obligations: int) -> list[TaxObject]:
    """Relleno con proporciones redondeadas o supuestas, ajustado a conteos exactos."""
    if objects <= 0:
        return []
    if obligations < objects:
        raise ValueError('cada objeto de relleno necesita al menos una obligación')
    sizes = [b.rng.randint(1, 37) for _ in range(objects)]
    diff = obligations - sum(sizes)
    index = 0
    while diff:
        step = 1 if diff > 0 else -1
        if sizes[index % objects] + step >= 1:
            sizes[index % objects] += step
            diff -= step
        index += 1
    weights = PROPORCIONES['tipo_bien']
    result = []
    reusable: list[Person] = []
    for size in sizes:
        tipo = b.rng.choices(list(weights), weights=list(weights.values()))[0]
        if reusable and b.rng.random() < PROPORCIONES['persona_reutilizada']:
            first = b.rng.choice(reusable)
        else:
            first = b.person(contact=b.rng.random() >= PROPORCIONES['persona_sin_contacto'])
            reusable.append(first)
        relations = [Relation(first, '100')]
        if b.rng.random() < PROPORCIONES['objeto_con_dos_personas']:
            relations = [Relation(first, '50'), Relation(b.person(), '50', 'Cotitular')]
        if b.rng.random() < PROPORCIONES['porcentaje_distinto_de_100']:
            relations[0].percent = str(b.rng.choice((40, 70, 90)))
        result.append(b.obj(tenant, tipo, 'relleno', relations, size))
    return result


def security_cases(b: Builder) -> list[TaxObject]:
    """Familia seguridad: segundo municipio con una cuenta y una persona compartidas."""
    shared_person = b.people[0]
    return [
        b.obj(TENANT_B, '3', 'misma-cuenta-otro-municipio', [Relation(shared_person, '100')], 2, cuenta='4100'),
        b.obj(TENANT_B, '6', 'relleno', [Relation(b.person(), '100')], 3),
        b.obj(TENANT_B, '1', 'relleno', [Relation(b.person(contact=False), '100')], 1),
    ]


# ------------------------------------------------------------------ filas de los archivos

def header_rows(objects: list[TaxObject], as_of: date) -> list[dict[str, str]]:
    rows = []
    for item in objects:
        if not item.with_header:
            continue
        capital = sum((parse_money(o.capital) or Decimal(0) for o in item.obligations), Decimal(0))
        total = sum((parse_money(o.total) or Decimal(0) for o in item.obligations), Decimal(0))
        for index, relation in enumerate(item.relations, start=1):
            person = relation.person
            rows.append({
                'ClaveAgrupacion': item.clave, 'Bien_Tipo_Id': item.tipo, 'Bien_Tipo': BIEN_TIPOS.get(item.tipo, 'COMERCIO'),
                'Cuenta': item.cuenta, 'Identificador': f'SINT-{item.tipo}-{item.cuenta}',
                'Bien_Descripcion': DESCRIPCIONES.get(item.tipo, 'Objeto sintético'), 'Estado': item.estado,
                'Tipo_Ingreso_Id': item.tipo_ingreso, 'Destinatario_Id': str(person.pid), 'Destinatario': person.name,
                'Destinatario_CUIT': person.document, 'Destinatario_Tipo': relation.role,
                'Destinatario_Porcentaje': relation.percent, 'Destinatario_Telefono': person.phone,
                'Destinatario_Celular': person.mobile, 'Destinatario_Email': person.email,
                'Destinatario_Calle': f'Calle Sintética {person.pid % 97 + 1}', 'Destinatario_Numeracion': str(person.pid % 900 + 100),
                'Destinatario_Piso': '', 'Destinatario_Depto': 'B' if index > 1 else '',
                'Destinatario_Localidad': f'Localidad Sintética {person.pid % 7 + 1}', 'Destinatario_CP': '0000',
                'Destinatario_Provincia': 'Provincia Sintética', 'Deuda_Capital': money(capital),
                'Deuda_Actualizada': money(total + item.control_offset), 'Periodos_Deuda': str(len(item.obligations)),
                'Fecha_Actualizacion': day(as_of - timedelta(days=1)),
            })
    return rows


def detail_rows(objects: list[TaxObject]) -> list[dict[str, str]]:
    rows = []
    for item in objects:
        for o in item.obligations:
            row = {
                'ClaveAgrupacion': item.clave, 'Bien_Tipo_Id': item.tipo, 'Cuenta': item.cuenta, 'DEUD_id': o.deud_id,
                'Tipo_Ingreso_Id': o.tipo_ingreso, 'Detalle_Deuda': o.detail, 'NOTD_capital': o.capital,
                'NOTD_intereses': o.interest, 'NOTD_honorarios': o.fees, 'NOTD_totalActualizado': o.total,
                'NOTD_vencimiento': o.due, 'NOTD_ESTA_id': o.state, 'NOTD_SITU_id': '',
            }
            rows.append(row)
            rows.extend({**row, **extra} for extra in o.extra_rows)
    return rows


# ------------------------------------------------------------------ oráculo (modelo del generador)

def _money_field(text: str) -> tuple[Decimal | None, str | None]:
    if text == '':
        return None, 'IMPORTE_VACIO'
    value = parse_money(text)
    return (value, None) if value is not None else (None, 'IMPORTE_NO_NUMERICO')


def _usable_contacts(person: Person) -> tuple[int, list[tuple[str, str, str]]]:
    usable, issues = 0, []
    for column, value in (('Destinatario_Telefono', person.phone), ('Destinatario_Celular', person.mobile),
                          ('Destinatario_Email', person.email)):
        if value == '':
            continue
        if value in PLACEHOLDERS:
            issues.append((column, 'CONTACTO_PLACEHOLDER', 'INVALIDO'))
        elif column == 'Destinatario_Email' and not re.fullmatch(r'[^@\s]+@[^@\s]+\.[a-z]+', value):
            issues.append((column, 'CONTACTO_FORMATO_INVALIDO', 'INVALIDO'))
        elif person.vigencia.get(column) == 'INACTIVO':
            # Bien formado y dado de baja: la vigencia es un dato observado (CO03), no un formato inválido.
            issues.append((column, 'CONTACTO_INACTIVO', 'OBSERVADO'))
        else:
            usable += 1
    return usable, issues


def oracle(objects: list[TaxObject], as_of: date) -> dict:
    """Interpreta la cartera con las reglas del contrato (ALIGN-007) sobre el modelo propio."""
    headers = header_rows(objects, as_of)
    details = detail_rows(objects)
    findings: list[dict] = []
    header_line = {}
    for line, row in enumerate(headers, start=2):
        header_line.setdefault(row['ClaveAgrupacion'], line)
    detail_lines: dict[str, list[int]] = {}
    for line, row in enumerate(details, start=2):
        detail_lines.setdefault(row['ClaveAgrupacion'], []).append(line)
    result_objects = []
    seen_keys: set[tuple[str, str, str]] = set()
    counts = {'duplicados_identicos': 0, 'duplicados_conflictivos': 0, 'detalle_sin_cabecera': 0}
    totals = {'aceptado': Decimal(0), 'cuarentena': Decimal(0)}
    not_observed: dict[str, int] = {}

    def note(file: str, line: int, column: str, code: str, presence: str) -> None:
        findings.append({'archivo': file, 'linea': line, 'campo': column, 'codigo': code, 'presencia': presence})

    for item in objects:
        lines = iter(detail_lines.get(item.clave, []))
        if not item.with_header:
            for _ in detail_rows([item]):
                counts['detalle_sin_cabecera'] += 1
                note('detalle', next(lines), 'ClaveAgrupacion', 'DETALLE_SIN_CABECERA', 'INVALIDO')
            continue
        reasons, flags = set(), set()
        first_line = header_line[item.clave]
        if not re.fullmatch(r'[1-9]\d*', item.cuenta):
            reasons.add('CUENTA_NO_CANONICA')
            note('cabecera', first_line, 'Cuenta', 'CUENTA_NO_CANONICA', 'INVALIDO')
        if item.tipo not in BIEN_TIPOS:
            reasons.add('TIPO_BIEN_FUERA_DE_CATALOGO')
            note('cabecera', first_line, 'Bien_Tipo_Id', 'TIPO_BIEN_FUERA_DE_CATALOGO', 'INVALIDO')
        if item.estado == 'Inactivo':
            flags.add('OBJETO_INACTIVO_EN_ORIGEN')
        statuses = {'VENCIDA': 0, 'VIGENTE': 0, 'PAGADA': 0, 'ANULADA': 0, 'SUSPENDIDA': 0, 'UNKNOWN': 0,
                    'PENDIENTE_VENCIMIENTO_NO_OBSERVADO': 0}
        sums = {'NOTD_capital': Decimal(0), 'NOTD_totalActualizado': Decimal(0)}
        # Filas no observadas por estado de presencia, por agregado (§4.1 regla 3).
        missing: dict[str, dict[str, int]] = {'NOTD_capital': {}, 'NOTD_totalActualizado': {},
                                              'vencimiento': {}, 'atraso': {}}
        oldest, earliest = None, None
        unique = 0
        for o in item.obligations:
            raw_rows = [{}] + o.extra_rows
            for position, extra in enumerate(raw_rows):
                line = next(lines)
                key = (item.tipo, item.cuenta, o.deud_id)
                if position:
                    conflicting = any(v != getattr(o, _FIELD[k]) for k, v in extra.items())
                    code = 'DUPLICADO_CONFLICTIVO' if conflicting else 'DUPLICADO_IDENTICO'
                    counts['duplicados_conflictivos' if conflicting else 'duplicados_identicos'] += 1
                    note('detalle', line, 'DEUD_id', code, 'INVALIDO' if conflicting else 'OBSERVADO')
                    (reasons if conflicting else flags).add(code)
                    continue
                seen_keys.add(key)
                unique += 1
                if o.tipo_ingreso not in TIPOS_INGRESO:
                    reasons.add('TIPO_INGRESO_FUERA_DE_CATALOGO')
                    note('detalle', line, 'Tipo_Ingreso_Id', 'TIPO_INGRESO_FUERA_DE_CATALOGO', 'INVALIDO')
                elif o.tipo_ingreso == '905':
                    flags.add('TIPO_INGRESO_SIN_MAPEO_EN_ETL')
                for column, text in (('NOTD_capital', o.capital), ('NOTD_totalActualizado', o.total)):
                    value, code = _money_field(text)
                    if code:
                        presence = 'NO_INFORMADO_EN_ORIGEN' if code == 'IMPORTE_VACIO' else 'INVALIDO'
                        tally(missing[column], presence)
                        reasons.add(code)
                        note('detalle', line, column, code, presence)
                    else:
                        sums[column] += value
                due, due_presence = parse_day(o.due), None
                if due is None:
                    # La obligación sigue en el universo: su vencimiento se cuenta aparte, no se descarta.
                    code, due_presence = (('FECHA_VACIA', 'NO_INFORMADO_EN_ORIGEN') if o.due == ''
                                          else ('FECHA_IMPOSIBLE', 'INVALIDO'))
                    reasons.add(code)
                    note('detalle', line, 'NOTD_vencimiento', code, due_presence)
                    tally(missing['vencimiento'], due_presence)
                else:
                    earliest = due if earliest is None else min(earliest, due)
                state = ESTADOS_ORIGEN.get(o.state)
                if state is None:
                    statuses['UNKNOWN'] += 1
                    note('detalle', line, 'NOTD_ESTA_id', 'ESTADO_ORIGEN_NO_INFORMADO', 'NO_INFORMADO_EN_ORIGEN')
                    # Sin estado no se sabe si está pendiente: queda fuera del máximo de atraso y se cuenta aparte.
                    tally(missing['atraso'], 'NO_INFORMADO_EN_ORIGEN')
                elif state == 'PENDIENTE' and due is None:
                    statuses['PENDIENTE_VENCIMIENTO_NO_OBSERVADO'] += 1
                    tally(missing['atraso'], due_presence)
                elif state == 'PENDIENTE':
                    overdue = due < as_of
                    statuses['VENCIDA' if overdue else 'VIGENTE'] += 1
                    if overdue:
                        days = (as_of - due).days
                        oldest = days if oldest is None else max(oldest, days)
                else:
                    statuses[state] += 1
        if unique == 0:
            flags.add('CABECERA_SIN_DETALLE')
        control = sum((parse_money(o.total) or Decimal(0) for o in item.obligations), Decimal(0)) + item.control_offset
        total = sums['NOTD_totalActualizado']
        if not missing['NOTD_totalActualizado'] and control != total:
            reasons.add('CONCILIACION_DIFERENTE')
            note('cabecera', first_line, 'Deuda_Actualizada', 'CONCILIACION_DIFERENTE', 'OBSERVADO')
        percents = [parse_percent(r.percent) for r in item.relations]
        if any(p is None for p in percents):
            percent_sum, percent_presence = None, 'NO_INFORMADO_EN_ORIGEN'
            flags.add('PORCENTAJE_FALTANTE')
        else:
            percent_sum, percent_presence = sum(percents, Decimal(0)), 'OBSERVADO'
            if percent_sum != HUNDRED:
                flags.add('PORCENTAJES_NO_SUMAN_100')
        if len(item.relations) > 1:
            flags.add('MULTIPLES_PERSONAS')
        usable, inactive = 0, 0
        for offset, relation in enumerate(item.relations):
            count, issues = _usable_contacts(relation.person)
            usable += count
            for column, code, presence in issues:
                flags.add('CONTACTO_NO_UTILIZABLE')
                if code == 'CONTACTO_INACTIVO':
                    flags.add(code)
                    inactive += 1
                note('cabecera', first_line + offset, column, code, presence)
        if usable == 0:
            flags.add('SIN_CONTACTO_UTILIZABLE')
        quarantined = bool(reasons)
        totals['cuarentena' if quarantined else 'aceptado'] += total
        for presence, rows in missing['NOTD_totalActualizado'].items():
            tally(not_observed, presence, rows)
        amounts = {column: amount(sums[column], unique - sum(missing[column].values()), missing[column]) for column in sums}
        result_objects.append({
            'caso': item.case, 'bien_tipo_id': item.tipo, 'cuenta': item.cuenta, 'clave_agrupacion': item.clave,
            'resultado': 'CUARENTENA' if quarantined else 'ACEPTADO', 'motivos': sorted(reasons), 'banderas': sorted(flags),
            'personas': [r.person.pid for r in item.relations], 'obligaciones': unique,
            'importe_actualizado': amounts['NOTD_totalActualizado'],
            'importe_capital': amounts['NOTD_capital'],
            'estados_al_corte': statuses,
            'vencimiento_mas_antiguo': aggregate(earliest.isoformat() if earliest else None, missing['vencimiento']),
            'dias_vencida_mas_antigua': aggregate(oldest, missing['atraso']),
            'suma_porcentajes': {'valor': None if percent_sum is None else str(percent_sum), 'presencia': percent_presence},
            'contactos_utilizables': usable,
            'contactos_inactivos': inactive,
        })
    people = {r.person.pid for o in objects if o.with_header for r in o.relations}
    accepted = [o for o in result_objects if o['resultado'] == 'ACEPTADO']
    return {
        'conteos': {
            'filas_cabecera': len(headers), 'filas_detalle': len(details), 'objetos': len(result_objects),
            'objetos_aceptados': len(accepted), 'objetos_en_cuarentena': len(result_objects) - len(accepted),
            'personas': len(people), 'relaciones': len(headers),
            'obligaciones_unicas': len(seen_keys), **counts,
            'objetos_sin_contacto_utilizable': sum('SIN_CONTACTO_UTILIZABLE' in o['banderas'] for o in result_objects),
            'objetos_porcentajes_no_100': sum('PORCENTAJES_NO_SUMAN_100' in o['banderas'] for o in result_objects),
        },
        'importes': {'actualizado_aceptado': str(totals['aceptado'].quantize(CENT)),
                     'actualizado_en_cuarentena_observado': str(totals['cuarentena'].quantize(CENT)),
                     'actualizado_filas_no_observadas': dict(sorted(not_observed.items()))},
        'objetos': result_objects,
        'hallazgos': sorted(findings, key=lambda f: (f['archivo'], f['linea'], f['campo'], f['codigo'])),
    }


PRESENCE_ORDER = ('NO_APLICA', 'NO_INTEGRADO', 'NO_INFORMADO_EN_ORIGEN', 'INVALIDO')


def tally(counter: dict[str, int], presence: str, rows: int = 1) -> None:
    counter[presence] = counter.get(presence, 0) + rows


def aggregate(value, missing: dict[str, int]) -> dict:
    """Agregado por objeto (§4.1): ``valor`` sale solo de las filas observadas y al lado va el desglose.

    ``completo`` es falso si alguna fila del universo no está observada: el valor es entonces un
    subtotal (o máximo/mínimo) de las observadas, no el total del objeto. Nulo solo sin aporte
    observado: ``NO_APLICA`` si el universo se leyó completo (sin obligaciones o sin vencidas) y, si
    hay filas no observadas, el primer estado del orden de §4 (regla 4).
    """
    if value is not None:
        presence = 'OBSERVADO'
    elif not missing:
        presence = 'NO_APLICA'
    else:
        presence = next(state for state in PRESENCE_ORDER if state in missing)
    return {'valor': value, 'presencia': presence, 'filas_no_observadas': dict(sorted(missing.items())),
            'completo': not missing}


def amount(total: Decimal, observed_rows: int, missing: dict[str, int]) -> dict:
    """Suma por objeto: subtotal de las filas observadas; 0 derivado si no hay obligaciones; nunca un faltante como 0."""
    return aggregate(str(total.quantize(CENT)) if observed_rows or not missing else None, missing)


_FIELD = {'NOTD_totalActualizado': 'total', 'NOTD_capital': 'capital', 'NOTD_vencimiento': 'due'}


def parse_percent(text: str) -> Decimal | None:
    return Decimal(text) if re.fullmatch(r'\d{1,3}', text) else None


# ------------------------------------------------------------------ escritura

def encode_table(columns: list[str], rows: list[dict[str, str]], delimiter: str, terminator: str) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=delimiter, lineterminator=terminator,
                        quoting=csv.QUOTE_MINIMAL if delimiter != '\t' else csv.QUOTE_NONE, escapechar=None)
    writer.writerow(columns)
    writer.writerows([row[c] for c in columns] for row in rows)
    return buffer.getvalue()


def normalize_zip(data: bytes, *, add: dict[str, bytes] | None = None, replace: dict[str, bytes] | None = None,
                  deflate: frozenset[str] = frozenset(), deflate_all: bool = False) -> bytes:
    """Reescribe un ZIP con fecha fija y sin compresión salvo pedido, para hashes estables."""
    add, replace = add or {}, replace or {}
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as source, zipfile.ZipFile(output, 'w') as target:
        if unknown := set(replace) - set(source.namelist()):
            raise ValueError(f'Partes inexistentes en el ZIP: {sorted(unknown)}')
        entries = [(n, replace.get(n, source.read(n))) for n in source.namelist()] + sorted(add.items())
        for name, content in entries:
            if name == 'docProps/core.xml':
                content = re.sub(rb'(<dcterms:(?:created|modified)[^>]*>)[^<]*', rb'\g<1>' + XLSX_TIMESTAMP.encode(), content)
            info = zipfile.ZipInfo(name, date_time=ZIP_EPOCH)
            info.create_system = 3
            info.external_attr = 0o644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED if deflate_all or name in deflate else zipfile.ZIP_STORED
            target.writestr(info, content)
    return output.getvalue()


def xlsx_bytes(sheets: list[tuple[str, list[list[str]]]], hidden: frozenset[str] = frozenset(),
               deflate_all: bool = False) -> bytes:
    # Import diferido: solo XLSX necesita la dependencia fijada (openpyxl==3.1.5).
    from openpyxl import Workbook

    workbook = Workbook()
    workbook.remove(workbook.active)
    workbook.properties.creator = 'quality/fixtures/synthetic_portfolio.py'
    for name, rows in sheets:
        sheet = workbook.create_sheet(name)
        if name in hidden:
            sheet.sheet_state = 'hidden'
        for row in rows:
            sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return normalize_zip(buffer.getvalue(), deflate_all=deflate_all)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def dump_json(value: dict) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


CSV_VARIANTS = [
    ('csv-coma-utf8', ',', 'utf-8-sig', '\r\n'),
    ('csv-puntoycoma-utf8', ';', 'utf-8-sig', '\r\n'),
    ('csv-coma-cp1252', ',', 'cp1252', '\r\n'),
    ('csv-puntoycoma-cp1252', ';', 'cp1252', '\r\n'),
]


def build(seed: int = DEFAULT_SEED, profile: str = 'contrato', as_of: date = DEFAULT_AS_OF) -> dict:
    """Construye la cartera completa en memoria (modelo, filas y oráculo)."""
    b = Builder(seed, as_of)
    cases = contract_cases(b)
    target = PROFILES[profile]
    contract_objects = sum(1 for c in cases if c.with_header)
    contract_debts = sum(len(c.obligations) for c in cases if c.with_header)
    portfolio_a = cases + filler(b, TENANT_A, target['objects'] - contract_objects, target['obligations'] - contract_debts)
    portfolio_b = security_cases(b)
    return {'seed': seed, 'profile': profile, 'as_of': as_of, 'tenants': {TENANT_A: portfolio_a, TENANT_B: portfolio_b},
            'people': b.people}


def social_scenario(seed: int, portfolio: dict) -> dict:
    rng = random.Random(f'{seed}:social')
    rows = []
    for tenant, objects in portfolio['tenants'].items():
        for item in objects:
            if item.with_header:
                rows.append({'municipio': tenant, 'bien_tipo_id': item.tipo, 'cuenta': item.cuenta,
                             'vulnerable_sintetico': rng.random() < 0.20,
                             'grupo_sintetico': rng.choice(('G1', 'G2', 'G3'))})
    return {
        'version': VERSION, 'semilla': seed, 'clase': 'S',
        'uso_permitido': 'solo simulación (ALIGN-036) y evaluaciones de equidad (ALIGN-062/063)',
        'prohibido': 'variable de entrada de cualquier regla, puntaje o modelo; nunca se une a cabecera/detalle en el ETL',
        'proceso_generador': 'Bernoulli independiente por objeto (p=0,20, supuesto) y grupo uniforme G1-G3; '
                             'independiente de importes, contactos y domicilio',
        'objetos': rows,
    }


def security_file(portfolio: dict) -> dict:
    tenants = portfolio['tenants']
    keys = {t: {(o.tipo, o.cuenta) for o in objs if o.with_header} for t, objs in tenants.items()}
    persons = {t: {r.person.pid for o in objs if o.with_header for r in o.relations} for t, objs in tenants.items()}
    return {
        'version': VERSION,
        'municipios': [{'clave': TENANT_A, 'nombre': 'Municipio Sintético A', 'lote': '.'},
                       {'clave': TENANT_B, 'nombre': 'Municipio Sintético B', 'lote': f'seguridad/{TENANT_B}'}],
        'cuentas': [{'municipio': t, 'rol': r, 'email': f'{r}.{t}@example.invalid'} for t in tenants for r in ROLES],
        'credenciales': 'no incluidas: cada campaña crea contraseñas efímeras en la base local',
        'objetos_por_municipio': {t: sorted(f'{a}-{c}' for a, c in keys[t]) for t in tenants},
        'objetos_misma_clave_en_ambos': sorted(f'{a}-{c}' for a, c in keys[TENANT_A] & keys[TENANT_B]),
        'personas_en_ambos': sorted(persons[TENANT_A] & persons[TENANT_B]),
        'esperado': 'un usuario de un municipio nunca ve objetos, personas ni contactos cargados solo por el otro; '
                    'la persona compartida expone DEF-SEC-003 (identidad y contactos sin municipio)',
    }


def contact_validity_file(portfolio: dict) -> dict:
    """Precondición de la fixture de contrato: vigencia explícita de contactos que el TSV no puede expresar."""
    rows, seen = [], set()
    for tenant, objects in portfolio['tenants'].items():
        for person in (r.person for o in objects if o.with_header for r in o.relations):
            if (tenant, person.pid) in seen:
                continue
            seen.add((tenant, person.pid))
            rows.extend({'municipio': tenant, 'Destinatario_Id': str(person.pid), 'columna': column, 'vigencia': state}
                        for column, state in sorted(person.vigencia.items()))
    return {
        'version': VERSION, 'clase': 'S',
        'tipo': 'artefacto complementario de la fixture de contrato; no es una columna del archivo municipal',
        'motivo': 'cabecera.tsv no trae vigencia de contacto y el origen real tampoco (CO03: hoy siempre activo)',
        'clave': ['municipio', 'Destinatario_Id', 'columna'],
        'valores': {'ACTIVO': 'vigente: utilizable si el formato es válido',
                    'INACTIVO': 'dado de baja: no utilizable aunque esté bien formado (CONTACTO_INACTIVO, OBSERVADO)'},
        'por_defecto': 'contacto con valor no listado: ACTIVO',
        'distinto_de': 'marcador o formato inválido (CONTACTO_PLACEHOLDER/CONTACTO_FORMATO_INVALIDO, INVALIDO) '
                       'y ausencia (columna vacía: no hay contacto)',
        'contactos': rows,
    }


def write_portfolio(output: Path, seed: int = DEFAULT_SEED, profile: str = 'contrato', as_of: date = DEFAULT_AS_OF,
                    variants: bool = True, hostile: bool = False, bomb_mib: int = 16) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise ValueError(f'La carpeta de salida debe estar vacía: {output}')
    portfolio = build(seed, profile, as_of)
    files: dict[str, bytes] = {}
    tables = {}
    for tenant, objects in portfolio['tenants'].items():
        prefix = '' if tenant == TENANT_A else f'seguridad/{tenant}/'
        tables[tenant] = (header_rows(objects, as_of), detail_rows(objects))
        files[f'{prefix}cabecera.tsv'] = encode_table(CABECERA_COLUMNS, tables[tenant][0], '\t', '\n').encode('utf-8')
        files[f'{prefix}detalle.tsv'] = encode_table(DETALLE_COLUMNS, tables[tenant][1], '\t', '\n').encode('utf-8')
    expected = {'version': VERSION, 'semilla': seed, 'perfil': profile, 'fecha_corte': as_of.isoformat(),
                'calculado_por': 'modelo del generador; no usa back/ETL ni lee los archivos escritos',
                'convenciones': {'linea': 'línea física del archivo; la cabecera de columnas es la línea 1',
                                 'importes': 'texto decimal con dos decimales', 'vencida': 'PENDIENTE con vencimiento < fecha_corte',
                                 'agregados': 'valor solo de filas observadas y filas_no_observadas aparte (contrato §4.1); '
                                              'completo=false: valor es un subtotal, no el total del objeto'},
                'municipios': {t: oracle(objs, as_of) for t, objs in portfolio['tenants'].items()}}
    files['expected.json'] = dump_json(expected)
    files['contactos-vigencia.json'] = dump_json(contact_validity_file(portfolio))
    files['escenario-social.json'] = dump_json(social_scenario(seed, portfolio))
    files['seguridad/municipios.json'] = dump_json(security_file(portfolio))
    variant_list = [{'id': 'tsv', 'archivos': ['cabecera.tsv', 'detalle.tsv'], 'separador': '\\t',
                     'codificacion': 'utf-8', 'fin_de_linea': 'LF', 'oraculo': 'expected.json'}]
    if variants:
        header, detail = tables[TENANT_A]
        for name, delimiter, encoding, terminator in CSV_VARIANTS:
            for stem, columns, rows in (('cabecera', CABECERA_COLUMNS, header), ('detalle', DETALLE_COLUMNS, detail)):
                files[f'variantes/{name}/{stem}.csv'] = encode_table(columns, rows, delimiter, terminator).encode(encoding)
            variant_list.append({'id': name, 'archivos': [f'variantes/{name}/cabecera.csv', f'variantes/{name}/detalle.csv'],
                                 'separador': delimiter, 'codificacion': encoding, 'fin_de_linea': 'CRLF', 'oraculo': 'expected.json'})
        sheets = [('cabecera', [CABECERA_COLUMNS] + [[r[c] for c in CABECERA_COLUMNS] for r in header]),
                  ('detalle', [DETALLE_COLUMNS] + [[r[c] for c in DETALLE_COLUMNS] for r in detail])]
        # Sin compresión el hash no depende de la versión de zlib; si superara el límite de
        # importación (25 MB, ALIGN-053) se comprime y el hash vale para la misma plataforma.
        workbook = xlsx_bytes(sheets)
        compression = 'stored'
        if len(workbook) > XLSX_STORED_LIMIT:
            workbook, compression = xlsx_bytes(sheets, deflate_all=True), 'deflate'
        files['variantes/xlsx/cartera.xlsx'] = workbook
        variant_list.append({'id': 'xlsx', 'archivos': ['variantes/xlsx/cartera.xlsx'], 'hojas': ['cabecera', 'detalle'],
                             'compresion': compression, 'oraculo': 'expected.json',
                             'celdas': 'texto (conserva ceros a la izquierda y el formato de origen)'})
    # El corpus hostil lleva su propio manifiesto: no altera los hashes de la cartera.
    extra = hostile_corpus(seed, tables[TENANT_A], bomb_mib) if hostile else {}
    for name, data in {**files, **extra}.items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    manifest = {
        'generador': 'quality/fixtures/synthetic_portfolio.py', 'version': VERSION, 'semilla': seed, 'perfil': profile,
        'fecha_corte': as_of.isoformat(), 'clase': 'S (sintético; ninguna fila deriva de la cartera real)',
        'formato_origen': {'separador': '\\t', 'codificacion': 'utf-8', 'decimal': ',', 'miles': '.',
                           'fecha': 'dd/mm/aaaa', 'fin_de_linea': 'LF'},
        'catalogos': {'Bien_Tipo_Id': BIEN_TIPOS, 'Tipo_Ingreso_Id': TIPOS_INGRESO, 'NOTD_ESTA_id': ESTADOS_ORIGEN,
                      'NOTD_SITU_id': 'columna presente y vacía (NO_INFORMADO_EN_ORIGEN)'},
        'proporciones': PROPORCIONES,
        'procedencia_proporciones': 'cardinalidades y proporciones agregadas del informe de input §3 redondeadas (5 '
                                    'puntos, o 1 punto si < 5 %) o supuestas; sin ALIGN-004 no se calibra con la cartera real',
        'conteos': {t: m['conteos'] for t, m in expected['municipios'].items()},
        'variantes': variant_list,
        'complementarios': [{'ruta': 'contactos-vigencia.json', 'uso': 'precondición del oráculo: vigencia explícita '
                             'de contactos (clave municipio, Destinatario_Id, columna); no se atribuye al origen real'}],
        'oraculo': {'ruta': 'expected.json', 'sha256': sha256(files['expected.json'])},
        'privacidad': {'nombres': 'Persona Sintética NNNN / Entidad Sintética NNNN',
                       'documentos': 'prefijo 99 (no asignado a CUIT/CUIL)', 'emails': '@example.invalid',
                       'telefonos': '0000-555-NNNN y 0000-15-555-NNNN', 'domicilios': 'Calle/Localidad/Provincia Sintética'},
        'archivos': [{'ruta': name, 'bytes': len(data), 'sha256': sha256(data)} for name, data in sorted(files.items())],
    }
    (output / 'manifest.json').write_bytes(dump_json(manifest))
    return manifest


# ------------------------------------------------------------------ corpus hostil

def marker(file: str, place: str) -> str:
    """Centinela por archivo y ubicación: ALIGN-059 identifica qué se filtró y si debía verse."""
    return f'{SENTINEL}-{file.replace(".", "-")}-{place}'.upper()


def hostile_corpus(seed: int, tables: tuple[list[dict], list[dict]], bomb_mib: int) -> dict[str, bytes]:
    """Archivos hostiles acotados para ALIGN-053/059; nada se descarga ni se versiona.

    Cada archivo lleva al menos un centinela. ``en_preview_autorizado`` indica si debe verse en el
    preview autorizado (campo de datos de las hojas que lee el importador) o nunca (hojas ignoradas,
    entidad externa, macro, binarios, celdas rechazadas, fórmulas); en logs nunca debe aparecer.
    """
    rng = random.Random(f'{seed}:hostil')
    header, detail = tables
    selected = ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']

    def sheets(file: str, extra: list[list[str]] | None = None) -> list[tuple[str, list[list[str]]]]:
        # Centinela en un campo de datos no personal de cabecera y detalle (las hojas seleccionadas).
        data = marker(file, 'dato')
        head = [dict(header[0], Bien_Descripcion=data), header[1]]
        det = [dict(detail[0], Detalle_Deuda=data), detail[1]]
        return [('cabecera', [CABECERA_COLUMNS] + [[r[c] for c in CABECERA_COLUMNS] for r in head] + (extra or [])),
                ('detalle', [DETALLE_COLUMNS] + [[r[c] for c in DETALLE_COLUMNS] for r in det])]

    def part(data: bytes, name: str) -> bytes:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            return archive.read(name)

    def seen(file: str, place: str = 'dato', parts: list[str] = selected, preview: bool = True) -> dict:
        return {'valor': marker(file, place), 'partes': parts, 'en_preview_autorizado': preview}

    corpus = {}
    base = xlsx_bytes(sheets('bomba-zip.xlsx'))
    corpus['bomba-zip.xlsx'] = (normalize_zip(base, add={'xl/media/relleno.bin': b'\0' * (bomb_mib << 20)},
                                              deflate=frozenset({'xl/media/relleno.bin'})),
                                'RAZON_COMPRESION_EXCEDIDA', [seen('bomba-zip.xlsx')])
    # Entidad externa hacia una ruta inexistente: prueba el rechazo sin leer nada del sistema.
    base = xlsx_bytes(sheets('xml-entidad-externa.xlsx'))
    entity = (b'<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE worksheet [<!ENTITY xxe SYSTEM '
              b'"file:///nonexistent/' + marker('xml-entidad-externa.xlsx', 'entidad').encode() + b'">]>\n'
              + part(base, selected[0]).replace(b'<t>SINT-', b'<t>&xxe;SINT-', 1))
    corpus['xml-entidad-externa.xlsx'] = (
        normalize_zip(base, replace={selected[0]: entity}), 'XML_ENTIDAD_EXTERNA',
        [seen('xml-entidad-externa.xlsx'), seen('xml-entidad-externa.xlsx', 'entidad', selected[:1], False)])
    base = xlsx_bytes(sheets('macro.xlsm'))
    macro_types = part(base, '[Content_Types].xml').replace(
        b'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
        b'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
    ).replace(b'</Types>', b'<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>')
    corpus['macro.xlsm'] = (
        normalize_zip(base, replace={'[Content_Types].xml': macro_types},
                      add={'xl/vbaProject.bin': f'{marker("macro.xlsm", "vba")} vba ficticio, no ejecutable'.encode()}),
        'MACRO_NO_PERMITIDA', [seen('macro.xlsm'), seen('macro.xlsm', 'vba', ['xl/vbaProject.bin'], False)])
    # Sin ZIP: el centinela va en los bytes del archivo (partes vacías) y nunca hay preview.
    tag = marker('xls-renombrado.xlsx', 'ole').encode()
    corpus['xls-renombrado.xlsx'] = (b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1' + bytes(504) + tag + bytes(3584 - len(tag)),
                                     'FORMATO_XLS_NO_SOPORTADO', [seen('xls-renombrado.xlsx', 'ole', [], False)])
    tag = marker('binario.csv', 'binario').encode()
    corpus['binario.csv'] = (bytes([0, 255, 254, 0]) + tag + rng.randbytes(4092 - len(tag)), 'CONTENIDO_NO_TEXTO',
                             [seen('binario.csv', 'binario', [], False)])
    giant = f'{marker("celda-gigante.xlsx", "celda")}-' + 'X' * 40_000
    # openpyxl trunca a 32 767 caracteres: la celda gigante se inyecta en el XML ya escrito.
    filler_row = ['__CELDA_GIGANTE__'] + [''] * (len(CABECERA_COLUMNS) - 1)
    base = xlsx_bytes(sheets('celda-gigante.xlsx', [filler_row]))
    corpus['celda-gigante.xlsx'] = (
        normalize_zip(base, replace={selected[0]: part(base, selected[0]).replace(b'__CELDA_GIGANTE__', giant.encode(), 1)}),
        'CELDA_EXCEDE_LIMITE', [seen('celda-gigante.xlsx'), seen('celda-gigante.xlsx', 'celda', selected[:1], False)])
    giant = f'{marker("celda-gigante.csv", "celda")}-' + 'X' * 40_000
    row = dict(header[0], Destinatario=giant, Bien_Descripcion=marker('celda-gigante.csv', 'dato'))
    corpus['celda-gigante.csv'] = (encode_table(CABECERA_COLUMNS, [row], ',', '\r\n').encode('utf-8'), 'CELDA_EXCEDE_LIMITE',
                                   [seen('celda-gigante.csv', parts=[]), seen('celda-gigante.csv', 'celda', [], False)])
    formula = f'=HYPERLINK("https://example.invalid/{marker("formulas.xlsx", "formula")}")'
    corpus['formulas.xlsx'] = (xlsx_bytes(sheets('formulas.xlsx', [['=1+1', '=SUM(A1:A2)', formula]])), 'FORMULA_SIN_VALOR',
                               [seen('formulas.xlsx'), seen('formulas.xlsx', 'formula', selected[:1], False)])
    row = dict(header[0], Destinatario='=1+1', Destinatario_Email='@SUM(1)', Identificador='+cmd',
               Destinatario_Numeracion='-2+3', Bien_Descripcion=marker('formulas.csv', 'dato'))
    corpus['formulas.csv'] = (encode_table(CABECERA_COLUMNS, [row], ',', '\r\n').encode('utf-8'), 'FORMULA_EN_CELDA',
                              [seen('formulas.csv', parts=[])])
    extra = [('notas', [['nota', marker('hojas-extra.xlsx', 'hoja-notas')]]),
             ('oculta', [['dato', marker('hojas-extra.xlsx', 'hoja-oculta')]])]
    corpus['hojas-extra.xlsx'] = (
        xlsx_bytes(sheets('hojas-extra.xlsx') + extra, hidden=frozenset({'oculta'})), 'HOJAS_EXTRA_IGNORADAS',
        [seen('hojas-extra.xlsx'), seen('hojas-extra.xlsx', 'hoja-notas', ['xl/worksheets/sheet3.xml'], False),
         seen('hojas-extra.xlsx', 'hoja-oculta', ['xl/worksheets/sheet4.xml'], False)])
    files = {f'hostil/{name}': data for name, (data, _, _) in corpus.items()}
    files['hostil/manifest.json'] = dump_json({
        'version': VERSION, 'semilla': seed, 'centinela': SENTINEL,
        'nota': 'códigos sugeridos; ALIGN-053 fija los definitivos. Generado en tiempo de ejecución, nunca versionado. '
                'centinelas[].partes: partes del ZIP que lo contienen (vacío: los bytes del archivo); '
                'en_preview_autorizado: debe verse en el preview autorizado; nunca debe verse en logs ni respuestas no autorizadas',
        'archivos': [{'ruta': name, 'bytes': len(data), 'sha256': sha256(data), 'esperado': code, 'centinelas': markers}
                     for name, (data, code, markers) in sorted(corpus.items())],
    })
    return files


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Genera la cartera sintética ALIGN-023 (cabecera, detalle, manifiesto y oráculo).')
    parser.add_argument('--output', required=True, type=Path, help='carpeta nueva o vacía')
    parser.add_argument('--seed', type=int, default=DEFAULT_SEED)
    parser.add_argument('--profile', choices=sorted(PROFILES), default='contrato')
    parser.add_argument('--as-of', type=date.fromisoformat, default=DEFAULT_AS_OF, help='fecha de corte AAAA-MM-DD')
    parser.add_argument('--sin-variantes', action='store_true', help='omite CSV y XLSX')
    parser.add_argument('--hostil', action='store_true', help='agrega el corpus hostil en hostil/')
    parser.add_argument('--bomba-mib', type=int, default=16, help='tamaño descomprimido del ZIP hostil (MiB, 1-64)')
    args = parser.parse_args(argv)
    if not 1 <= args.bomba_mib <= 64:
        parser.error('--bomba-mib debe estar entre 1 y 64')
    try:
        manifest = write_portfolio(args.output, args.seed, args.profile, args.as_of, not args.sin_variantes,
                                   args.hostil, args.bomba_mib)
    except ValueError as error:
        parser.error(str(error))
    print(json.dumps({'salida': str(args.output), 'conteos': manifest['conteos'],
                      'archivos': len(manifest['archivos'])}, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
