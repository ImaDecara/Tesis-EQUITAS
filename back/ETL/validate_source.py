"""Contrato de origen v1: validación pura, sin configuración ETL ni servicios externos.

La CLI y el inspector llaman a ``validate_batch``. Los lectores de CSV/XLSX pueden
entregar SourceTable conservando texto y ubicación; la validación no cambia.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

DEFAULT_CONTRACT = Path(__file__).resolve().parents[2] / 'contracts/source-contract.v1.json'
MISSING = 'NO_INFORMADO_EN_ORIGEN'
INVALID = 'INVALIDO'
OBSERVED = 'OBSERVADO'
PRESENCE_ORDER = ('NO_APLICA', 'NO_INTEGRADO', MISSING, INVALID)


class ValidationError(ValueError):
    """Solo códigos propios: nunca incluye el valor recibido ni rutas del usuario."""


def require(condition):
    if not condition:
        raise ValidationError('CONFIGURACION_INVALIDA')


@dataclass
class SourceRow:
    line: int
    values: dict[str, str]


@dataclass
class SourceTable:
    columns: list[str]
    rows: list[SourceRow]


@dataclass(frozen=True)
class Cell:
    value: object
    presence: str = OBSERVED
    code: str | None = None


@dataclass
class CheckedRow:
    kind: str
    line: int
    values: dict[str, str]
    cells: dict[str, Cell] = field(default_factory=dict)
    codes: list[str] = field(default_factory=list)
    duplicate: bool = False
    obj: ObjectCheck | None = None


@dataclass
class ObjectCheck:
    reference: str
    key: tuple[str, str]
    headers: list[CheckedRow] = field(default_factory=list)
    details: list[CheckedRow] = field(default_factory=list)
    reasons: set[str] = field(default_factory=set)
    flags: set[str] = field(default_factory=set)


def load_contract(path=DEFAULT_CONTRACT) -> dict:
    return _read_json(path)


def _read_json(path) -> dict:
    try:
        result = json.loads(Path(path).read_text(encoding='utf-8'))
        if not isinstance(result, dict):
            raise TypeError
        return result
    except (OSError, UnicodeError, ValueError, TypeError):
        raise ValidationError('JSON_NO_LEIBLE') from None


def load_mapping(folder, path=None) -> dict:
    """Solo autoconfigura la fixture declarada; los otros lotes exigen mapping JSON."""
    if path is not None:
        return _read_json(path)
    folder = Path(folder)
    manifest = _read_json(folder / 'manifest.json')
    if (manifest.get('version') != 'sintetico-v1'
            or not isinstance(manifest.get('clase'), str) or not manifest['clase'].startswith('S ')):
        raise ValidationError('MAPEO_REQUERIDO')
    mapping = _read_json(DEFAULT_CONTRACT.with_name('source-mapping.sintetico-v1.json'))
    mapping['fecha_corte'] = manifest.get('fecha_corte')
    mapping['formato'] = manifest.get('formato_origen')
    # El manifiesto v1 documenta NOTD_SITU_id como texto explicativo, no como catálogo.
    catalogs = manifest.get('catalogos', {})
    if not isinstance(catalogs, dict):
        raise ValidationError('CONFIGURACION_INVALIDA')
    mapping['catalogos'] = {name: catalogs.get(name, {}) for name in
                           ('Bien_Tipo_Id', 'Tipo_Ingreso_Id', 'NOTD_ESTA_id')}
    mapping['catalogos']['NOTD_SITU_id'] = {}
    mapping['vigencia_contactos'] = _read_json(folder / 'contactos-vigencia.json').get('contactos', [])
    return mapping


def parse_amount(value: str, decimal: str, thousands: str) -> Cell:
    """Un solo formato por lote; no adivina separadores, moneda ni exponentes."""
    if not value:
        return Cell(None, MISSING, 'IMPORTE_VACIO')
    integer = r'[0-9]+' if not thousands else rf'(?:[0-9]+|[0-9]{{1,3}}(?:{re.escape(thousands)}[0-9]{{3}})+)'
    if not re.fullmatch(rf'-?{integer}(?:{re.escape(decimal)}[0-9]{{1,2}})?', value):
        return Cell(None, INVALID, 'IMPORTE_NO_NUMERICO')
    number = Decimal((value.replace(thousands, '') if thousands else value).replace(decimal, '.'))
    if number < 0:
        return Cell(None, INVALID, 'IMPORTE_NEGATIVO')
    if number > Decimal('9999999999999999.99'):
        return Cell(None, INVALID, 'IMPORTE_FUERA_DE_RANGO')
    return Cell(number)


def parse_date(value: str, format_name: str, contract: dict) -> Cell:
    if not value:
        return Cell(None, MISSING, 'FECHA_VACIA')
    formats = contract['formatos']
    if value in formats['fechas_centinela']:
        return Cell(None, MISSING, 'FECHA_CENTINELA')
    pattern = r'[0-9]{2}/[0-9]{2}/[0-9]{4}' if format_name == 'dd/mm/aaaa' else r'[0-9]{4}-[0-9]{2}-[0-9]{2}'
    if not re.fullmatch(pattern, value):
        return Cell(None, INVALID, 'FECHA_FORMATO_INVALIDO')
    try:
        parsed = datetime.strptime(value, formats['fechas'][format_name]).date()
    except ValueError:
        return Cell(None, INVALID, 'FECHA_IMPOSIBLE')
    if parsed.isoformat() in formats['dias_centinela_iso']:
        return Cell(None, MISSING, 'FECHA_CENTINELA')
    return Cell(parsed)


def aggregate(cells: list[Cell], operation: str) -> dict:
    """Una contribución por fila: ausencia de varios insumos no duplica faltantes."""
    missing = Counter(cell.presence for cell in cells if cell.value is None)
    values = [cell.value for cell in cells if cell.value is not None]
    if operation == 'sum':
        result = f'{sum(values, Decimal(0)):.2f}' if values or not missing else None
    else:
        result = (min(values) if operation == 'min' else max(values)) if values else None
        if isinstance(result, date):
            result = result.isoformat()
    presence = OBSERVED if result is not None else next((p for p in PRESENCE_ORDER if p in missing), 'NO_APLICA')
    return {'valor': result, 'presencia': presence, 'filas_no_observadas': dict(sorted(missing.items())), 'completo': not missing}


class _Validator:
    def __init__(self, mapping, contract, cut_off):
        self.mapping, self.contract = mapping, contract
        self.findings = {}
        self.rows = []
        self.columns = {}
        self.objects = {}
        self.blockers = set()
        self.complete = True
        self._configuration(cut_off)

    def _configuration(self, cut_off):
        try:
            if isinstance(cut_off, date):
                cut_off = cut_off.isoformat()
            if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', cut_off):
                raise ValueError
            self.cut_off = date.fromisoformat(cut_off)
        except (TypeError, ValueError):
            raise ValidationError('CORTE_INVALIDO') from None
        try:
            m, c = self.mapping, self.contract
            require(c['version'] == 'source-contract.v1')
            require(m['version'] == 'source-mapping.v1')
            require(all(isinstance(m[k], str) and m[k].strip() for k in ('municipio', 'jurisdiccion', 'moneda')))
            require(re.fullmatch(r'[A-Z]{3}', m['moneda']))
            require(m['fecha_corte'] == self.cut_off.isoformat())
            f = m['formato']
            require(f['fecha'] in c['formatos']['fechas'])
            require(f['codificacion'] in c['formatos']['codificaciones'])
            # Separador físico del lote; los adaptadores CSV/XLSX entregan SourceTable.
            require(f['separador'] in ('\t', '\\t', ',', ';', None))
            require(f['decimal'] in (',', '.') and f['miles'] in ('', ',', '.'))
            require(f['decimal'] != f['miles'])
            require(isinstance(m.get('columnas', {}), dict))
            require(set(m.get('columnas', {})) <= {'cabecera', 'detalle'})
            for kind in ('cabecera', 'detalle'):
                columns = m.get('columnas', {}).get(kind, {})
                require(isinstance(columns, dict) and set(columns) <= set(c['archivos'][kind]['columnas']))
                require(all(isinstance(v, str) and v for v in columns.values()))
                effective = [columns.get(name, name) for name in c['archivos'][kind]['columnas']]
                require(len(effective) == len(set(effective)))
            for name in c['catalogos']['por_lote']:
                require(isinstance(m['catalogos'][name], dict))
                require(all(isinstance(k, str) and isinstance(v, str) and k and v
                           for k, v in m['catalogos'][name].items()))
            require(m['catalogos']['Bien_Tipo_Id'] and m['catalogos']['Tipo_Ingreso_Id'])
            for name in ('NOTD_ESTA_id', 'NOTD_SITU_id'):
                require(set(m['catalogos'][name].values()) <= set(c['catalogos']['estados_obligacion']))
            require(m.get('vigencia_por_defecto', 'NO_INTEGRADO') in ('ACTIVO', 'NO_INTEGRADO'))
            self.validity = {}
            for item in m.get('vigencia_contactos', []):
                key = (item['municipio'], item['Destinatario_Id'], item['columna'])
                require(all(isinstance(k, str) and k for k in key))
                require(key not in self.validity and key[2] in c['contactos']['columnas'])
                require(item['vigencia'] in ('ACTIVO', 'INACTIVO'))
                self.validity[key] = item['vigencia']
            rules = c['consistencias']
            require(Decimal(rules['tolerancia_importe']).is_finite() and Decimal(rules['tolerancia_importe']) >= 0)
            for name in ('cuarentena_max_objetos_pct', 'cuarentena_max_importe_pct'):
                require(Decimal(rules[name]).is_finite() and 0 <= Decimal(rules[name]) <= 100)
            require(set(c['archivos']) == {'cabecera', 'detalle'})
            require(all(type(v) is int and v > 0 for v in c['limites'].values()))
        except (KeyError, TypeError, ValueError, ArithmeticError, AttributeError):
            raise ValidationError('CONFIGURACION_INVALIDA') from None

    def note(self, row, column, code, presence=INVALID):
        finding = {'archivo': row.kind, 'linea': row.line, 'campo': column, 'codigo': code, 'presencia': presence}
        self.findings[(row.kind, row.line, column, code)] = finding
        effect = self.contract['codigos'][code]['efecto']
        if (effect != 'ALERTA' or code == 'DUPLICADO_IDENTICO') and code not in row.codes:
            row.codes.append(code)
        if effect == 'CUARENTENA' and row.obj:
            row.obj.reasons.add(code)
        if effect == 'BLOQUEO':
            self.blockers.add(code)

    def read(self, kind, source):
        limits = self.contract['limites']
        if isinstance(source, SourceTable):
            return source
        if self.mapping['formato']['separador'] not in ('\t', '\\t'):
            raise ValidationError('LECTOR_TSV_REQUIERE_TABULADOR')
        rows, columns = [], []
        code = None
        try:
            path = Path(source)
            if path.stat().st_size > limits['bytes']:
                code = 'LIMITE_ARCHIVO_EXCEDIDO'
            else:
                with path.open(encoding=self.mapping['formato']['codificacion'], newline='') as stream:
                    reader = csv.reader(stream, delimiter='\t', strict=True)
                    columns = next(reader, [])
                    for values in reader:
                        if len(rows) >= limits['filas']:
                            code = 'LIMITE_ARCHIVO_EXCEDIDO'
                            break
                        line = reader.line_num  # TSV v1 no admite campos multilínea.
                        if any('\n' in v or '\r' in v or '\x00' in v for v in values) or len(values) != len(columns):
                            self.note(CheckedRow(kind, line, {}), '*', 'ESTRUCTURA_INVALIDA')
                        rows.append(SourceRow(line, dict(zip(columns, values))))
        except (OSError, UnicodeError, csv.Error, TypeError, ValueError):
            code = 'ARCHIVO_NO_LEIBLE'
        if code:
            self.complete = False
            self.note(CheckedRow(kind, 0, {}), '*', code)
        return SourceTable(columns, rows)

    def prepare(self, files):
        if not isinstance(files, dict) or set(files) != {'cabecera', 'detalle'}:
            raise ValidationError('ARCHIVOS_REQUERIDOS')
        for kind, definitions in self.contract['archivos'].items():
            table = self.read(kind, files[kind])
            columns = table.columns
            limits = self.contract['limites']
            head = CheckedRow(kind, 1, {})
            if not columns or len(set(columns)) != len(columns) or any(not isinstance(c, str) or not c for c in columns):
                self.note(head, '*', 'ESTRUCTURA_INVALIDA')
            if len(columns) > limits['columnas'] or len(table.rows) > limits['filas']:
                self.note(head, '*', 'LIMITE_ARCHIVO_EXCEDIDO')
            mapping = self.mapping.get('columnas', {}).get(kind, {})
            known = definitions['columnas']
            available = {name for name in known if mapping.get(name, name) in columns}
            optional = {name for name, spec in known.items() if not spec['requerida']}
            self.columns[kind] = {'opcionales_presentes': sorted(optional & available),
                                      'opcionales_ausentes': sorted(optional - available),
                                      'extras_ignoradas': len(set(columns) - {mapping.get(n, n) for n in known})}
            for name, spec in known.items():
                if spec['requerida'] and name not in available:
                    self.note(head, name, 'COLUMNA_OBLIGATORIA_AUSENTE', MISSING)
            lines = set()
            for row in table.rows:
                checked = CheckedRow(kind, row.line, {})
                self.rows.append(checked)
                if (type(row.line) is not int or row.line < 2 or row.line in lines
                        or set(row.values) != set(columns)
                        or any(not isinstance(v, str) or '\x00' in v or '\n' in v or '\r' in v for v in row.values.values())):
                    if isinstance(files[kind], SourceTable):
                        raise ValidationError('TABLA_INVALIDA')
                    self.note(checked, '*', 'ESTRUCTURA_INVALIDA')
                    continue
                lines.add(row.line)
                if any(len(v) > limits['celda'] for v in row.values.values()):
                    self.note(checked, '*', 'LIMITE_ARCHIVO_EXCEDIDO')
                checked.values = {name: row.values[mapping.get(name, name)].strip() for name in available}

    def cell(self, row, name, value):
        """Registra el defecto una vez y conserva presencia aunque otro insumo falle."""
        row.cells[name] = value
        if value.code:
            self.note(row, name, value.code, value.presence)

    def validate_fields(self, row):
        definitions = self.contract['archivos'][row.kind]['columnas']
        fmt = self.mapping['formato']
        for name, spec in definitions.items():
            raw = row.values.get(name, '')
            kind = spec['tipo']
            if kind in ('id', 'cuenta'):
                if not re.fullmatch(r'(?:0|[1-9][0-9]{0,18})', raw) or int(raw) > int(self.contract['claves']['bigint_max']):
                    code = 'CUENTA_NO_CANONICA' if kind == 'cuenta' else 'IDENTIFICADOR_INVALIDO'
                    # Cuenta en detalle se compara con la cabecera; el defecto se informa allí una sola vez.
                    if row.kind == 'cabecera' or name == 'DEUD_id':
                        self.note(row, name, code, INVALID if raw else MISSING)
            elif kind == 'importe' and (raw or spec['requerida']):
                self.cell(row, name, parse_amount(raw, fmt['decimal'], fmt['miles']))
            elif kind == 'fecha' and (raw or spec['requerida']):
                self.cell(row, name, parse_date(raw, fmt['fecha'], self.contract))
            elif kind == 'catalogo' and (raw or spec['requerida']):
                # Los códigos de bien/cuenta repetidos en detalle se verifican contra el objeto.
                if row.kind == 'detalle' and name == 'Bien_Tipo_Id':
                    continue
                if raw not in self.mapping['catalogos'][name]:
                    code = 'TIPO_BIEN_FUERA_DE_CATALOGO' if name == 'Bien_Tipo_Id' else 'TIPO_INGRESO_FUERA_DE_CATALOGO'
                    self.note(row, name, code, INVALID if raw else MISSING)
                elif name == 'Tipo_Ingreso_Id' and raw not in self.contract['catalogos']['tipos_ingreso_mapeados_etl_v0']:
                    row.obj.flags.add('TIPO_INGRESO_SIN_MAPEO_EN_ETL')
            elif kind == 'entero' and raw and not re.fullmatch(r'[0-9]+', raw):
                self.note(row, name, 'ENTERO_INVALIDO')
        if not row.values.get('ClaveAgrupacion'):
            self.note(row, 'ClaveAgrupacion', 'CAMPO_OBLIGATORIO_VACIO', MISSING)
        if row.kind == 'cabecera':
            self.header_fields(row)
        else:
            self.debt_state(row)

    def header_fields(self, row):
        status = row.values.get('Estado', '')
        if not status:
            row.obj.flags.add('ESTADO_OBJETO_NO_INFORMADO')
        elif status not in self.contract['catalogos']['Estado']:
            self.note(row, 'Estado', 'ESTADO_OBJETO_DESCONOCIDO')
        elif self.contract['catalogos']['Estado'][status] == 'INACTIVO':
            row.obj.flags.add('OBJETO_INACTIVO_EN_ORIGEN')
        percent = row.values.get('Destinatario_Porcentaje', '')
        if not percent:
            row.cells['Destinatario_Porcentaje'] = Cell(None, MISSING)
            row.obj.flags.add('PORCENTAJE_FALTANTE')
        else:
            cell = parse_amount(percent, self.mapping['formato']['decimal'], '')
            if cell.value is None or cell.value > 100:
                cell = Cell(None, INVALID, 'PORCENTAJE_INVALIDO')
            self.cell(row, 'Destinatario_Porcentaje', cell)
        for name in self.contract['contactos']['columnas']:
            raw = row.values.get(name, '')
            if not raw:
                row.cells[name] = Cell(None, MISSING)
                continue
            key = (self.mapping['municipio'], row.values.get('Destinatario_Id', ''), name)
            active = self.validity.get(key, self.mapping.get('vigencia_por_defecto', 'NO_INTEGRADO'))
            if raw.upper() in self.contract['contactos']['marcadores']:
                contact = Cell(None, INVALID, 'CONTACTO_PLACEHOLDER')
            elif not (re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', raw) if name == 'Destinatario_Email'
                      else re.fullmatch(r'[+0-9() .-]+', raw) and len(re.sub(r'\D', '', raw)) >= 6):
                contact = Cell(None, INVALID, 'CONTACTO_FORMATO_INVALIDO')
            elif active == 'INACTIVO':
                contact = Cell(False, OBSERVED, 'CONTACTO_INACTIVO')
                row.obj.flags.add('CONTACTO_INACTIVO')
            else:
                # Formato utilizable ≠ vigencia comprobada, verificado o consentido.
                contact = Cell(True)
            if contact.code:
                row.obj.flags.add('CONTACTO_NO_UTILIZABLE')
            self.cell(row, name, contact)

    def debt_state(self, row):
        states = []
        for name in ('NOTD_ESTA_id', 'NOTD_SITU_id'):
            raw = row.values.get(name, '')
            if raw:
                value = self.mapping['catalogos'][name].get(raw)
                cell = Cell(value) if value else Cell(None, INVALID, 'ESTADO_ORIGEN_DESCONOCIDO')
                self.cell(row, name, cell)
                states.append(cell)
        if not states:
            state = Cell(None, MISSING, 'ESTADO_ORIGEN_NO_INFORMADO')
            self.cell(row, 'NOTD_ESTA_id', state)
        elif any(s.value is None for s in states):
            state = Cell(None, INVALID)
        elif len({s.value for s in states}) > 1:
            state = Cell(None, INVALID, 'ESTADOS_ORIGEN_CONFLICTIVOS')
            self.cell(row, 'NOTD_ESTA_id', state)
        else:
            state = states[0]
            if state.value == 'UNKNOWN':
                state = Cell(None, MISSING, 'ESTADO_ORIGEN_NO_INFORMADO')
                name = 'NOTD_ESTA_id' if row.values.get('NOTD_ESTA_id') else 'NOTD_SITU_id'
                self.cell(row, name, state)
        row.cells['estado'] = state

    def deduplicate(self, row, seen, key, column):
        if key not in seen:
            seen[key] = row
            return False
        same = seen[key].values == row.values
        code = 'DUPLICADO_IDENTICO' if same else 'DUPLICADO_CONFLICTIVO'
        row.duplicate = True
        self.note(row, column, code, OBSERVED if same else INVALID)
        if same:
            row.obj.flags.add(code)
        return True

    def group(self):
        links, relations, obligations = defaultdict(list), {}, {}
        for row in (r for r in self.rows if r.kind == 'cabecera'):
            key = (row.values.get('Bien_Tipo_Id', ''), row.values.get('Cuenta', ''))
            if key not in self.objects:
                self.objects[key] = ObjectCheck(f'objeto-{len(self.objects) + 1:06}', key)
            row.obj = obj = self.objects[key]
            link = row.values.get('ClaveAgrupacion', '')
            if obj not in links[link]:
                links[link].append(obj)
            if self.deduplicate(row, relations, (*key, row.values.get('Destinatario_Id', '')), 'Destinatario_Id'):
                continue
            obj.headers.append(row)
            self.validate_fields(row)
            if len(obj.headers) > 1:
                first = obj.headers[0]
                for name in self.contract['consistencias']['campos_comunes_cabecera']:
                    if row.values.get(name) != first.values.get(name):
                        self.note(row, name, 'CABECERAS_INCONSISTENTES')
        for linked in links.values():
            if len(linked) > 1:
                for obj in linked:
                    self.note(obj.headers[0], 'ClaveAgrupacion', 'CLAVE_AGRUPACION_AMBIGUA')
        for row in (r for r in self.rows if r.kind == 'detalle'):
            linked = links.get(row.values.get('ClaveAgrupacion', ''), [])
            if not linked:
                self.note(row, 'ClaveAgrupacion', 'DETALLE_SIN_CABECERA')
                self.blockers.add('DETALLE_SIN_CABECERA')
                continue
            if len(linked) > 1:
                self.note(row, 'ClaveAgrupacion', 'CLAVE_AGRUPACION_AMBIGUA')
                self.blockers.add('CLAVE_AGRUPACION_AMBIGUA')
                continue
            row.obj = obj = linked[0]
            if self.deduplicate(row, obligations, (*obj.key, row.values.get('DEUD_id', '')), 'DEUD_id'):
                continue
            obj.details.append(row)
            self.validate_fields(row)
            for name, expected, code in (('Cuenta', obj.key[1], 'CUENTA_DETALLE_DIFERENTE'),
                                         ('Bien_Tipo_Id', obj.key[0], 'TIPO_BIEN_DETALLE_DIFERENTE')):
                if name in row.values and row.values[name] != expected:
                    self.note(row, name, code)

    def object_report(self, obj):
        amounts = {name: aggregate([r.cells[name] for r in obj.details], 'sum')
                   for name in ('NOTD_totalActualizado', 'NOTD_capital')}
        actual = amounts['NOTD_totalActualizado']
        header = obj.headers[0]
        control = header.cells['Deuda_Actualizada']
        difference = None
        if control.value is not None and actual['completo']:
            difference = control.value - Decimal(actual['valor'])
            if abs(difference) > Decimal(self.contract['consistencias']['tolerancia_importe']):
                self.note(header, 'Deuda_Actualizada', 'CONCILIACION_DIFERENTE', OBSERVED)
        percents = [r.cells['Destinatario_Porcentaje'] for r in obj.headers]
        unknown = [p.presence for p in percents if p.value is None]
        percent = None if unknown else sum((p.value for p in percents), Decimal(0))
        if percent is not None and percent != Decimal(self.contract['consistencias']['porcentaje_total']):
            obj.flags.add('PORCENTAJES_NO_SUMAN_100')
        if len(obj.headers) > 1:
            obj.flags.add('MULTIPLES_PERSONAS')
        contacts = [r.cells[name] for r in obj.headers for name in self.contract['contactos']['columnas']]
        usable = sum(c.value is True for c in contacts)
        if not usable:
            obj.flags.add('SIN_CONTACTO_UTILIZABLE')
        if not obj.details:
            obj.flags.add('CABECERA_SIN_DETALLE')
        statuses = dict.fromkeys(('VENCIDA', 'VIGENTE', 'PAGADA', 'ANULADA', 'SUSPENDIDA', 'UNKNOWN',
                                  'PENDIENTE_VENCIMIENTO_NO_OBSERVADO'), 0)
        ages = []
        for row in obj.details:
            state, due = row.cells['estado'], row.cells['NOTD_vencimiento']
            if state.value is None:
                statuses['UNKNOWN'] += 1
                ages.append(Cell(None, state.presence))
            elif state.value != 'PENDIENTE':
                statuses[state.value] += 1
            elif due.value is None:
                statuses['PENDIENTE_VENCIMIENTO_NO_OBSERVADO'] += 1
                ages.append(Cell(None, due.presence))
            else:
                overdue = due.value < self.cut_off
                statuses['VENCIDA' if overdue else 'VIGENTE'] += 1
                if overdue:
                    ages.append(Cell((self.cut_off - due.value).days))
        return {
            'referencia': obj.reference, 'filas_cabecera': [r.line for r in obj.headers],
            'resultado': 'CUARENTENA' if obj.reasons else 'ACEPTADO', 'motivos': sorted(obj.reasons),
            'banderas': sorted(obj.flags), 'obligaciones': len(obj.details),
            'importe_actualizado': actual, 'importe_capital': amounts['NOTD_capital'],
            'conciliacion': {'control': None if control.value is None else f'{control.value:.2f}',
                              'presencia_control': control.presence, 'diferencia': None if difference is None else f'{difference:.2f}',
                              'evaluable': difference is not None},
            'estados_al_corte': statuses,
            'vencimiento_mas_antiguo': aggregate([r.cells['NOTD_vencimiento'] for r in obj.details], 'min'),
            'dias_vencida_mas_antigua': aggregate(ages, 'max'),
            'suma_porcentajes': {'valor': None if percent is None else str(percent),
                                 'presencia': next((p for p in PRESENCE_ORDER if p in unknown), OBSERVED)},
            'contactos_utilizables': usable, 'contactos_inactivos': sum(c.code == 'CONTACTO_INACTIVO' for c in contacts),
        }

    def report(self, structural=False):
        objects = [] if structural else [self.object_report(obj) for obj in self.objects.values()]
        quarantined = [o for o in objects if o['resultado'] == 'CUARENTENA']
        amounts = {'actualizado_aceptado': Decimal(0), 'actualizado_en_cuarentena_observado': Decimal(0)}
        missing = Counter()
        for obj in objects:
            key = 'actualizado_aceptado' if obj['resultado'] == 'ACEPTADO' else 'actualizado_en_cuarentena_observado'
            value = obj['importe_actualizado']['valor']
            if value is not None:
                amounts[key] += Decimal(value)
            missing.update(obj['importe_actualizado']['filas_no_observadas'])
        object_pct = Decimal(len(quarantined) * 100) / len(objects) if objects else Decimal(0)
        denominator = sum(amounts.values())
        amount_pct = amounts['actualizado_en_cuarentena_observado'] * 100 / denominator if denominator else Decimal(0)
        rules = self.contract['consistencias']
        if object_pct > Decimal(rules['cuarentena_max_objetos_pct']):
            self.blockers.add('CUARENTENA_EXCEDE_OBJETOS')
        if amount_pct > Decimal(rules['cuarentena_max_importe_pct']):
            self.blockers.add('CUARENTENA_EXCEDE_IMPORTE')
        if missing:
            self.blockers.add('CUARENTENA_IMPORTE_NO_EVALUABLE')
        unlinked = []
        for row in self.rows:
            if row.kind == 'detalle' and row.obj is None:
                fmt = self.mapping['formato']
                unlinked.append(parse_amount(row.values.get('NOTD_totalActualizado', ''), fmt['decimal'], fmt['miles']))
        counts, decisions = {}, []
        warnings = {}
        for finding in sorted(self.findings.values(), key=lambda f: (f['archivo'], f['linea'], f['campo'], f['codigo'])):
            if self.contract['codigos'][finding['codigo']]['efecto'] == 'ALERTA':
                warnings.setdefault((finding['archivo'], finding['linea']), finding['codigo'])
        for kind in ('cabecera', 'detalle'):
            primary = Counter()
            accepted = Counter()
            for row in (r for r in self.rows if r.kind == kind):
                code = row.codes[0] if row.codes else None
                if structural:
                    code = code or 'LOTE_ESTRUCTURA_INVALIDA'
                elif row.obj and row.obj.reasons:
                    code = code or 'OBJETO_EN_CUARENTENA'
                if code:
                    primary[code] += 1
                else:
                    accepted_code = warnings.get((kind, row.line)) or (
                        'OBJETO_CON_ALERTAS' if row.obj and row.obj.flags else 'SIN_OBSERVACIONES')
                    accepted[accepted_code] += 1
                decisions.append({'archivo': kind, 'linea': row.line, 'objeto': row.obj.reference if row.obj else None,
                                      'resultado': 'RECHAZADA' if code else 'ACEPTADA', 'codigo': code or accepted_code})
            counts[kind] = {'leidas': sum(accepted.values()) + sum(primary.values()), 'aceptadas': sum(accepted.values()),
                                'aceptadas_por_codigo': dict(sorted(accepted.items())),
                                'rechazadas': sum(primary.values()), 'rechazadas_por_codigo': dict(sorted(primary.items()))}
        findings = sorted(self.findings.values(), key=lambda f: (f['archivo'], f['linea'], f['campo'], f['codigo']))
        codes = Counter(f['codigo'] for f in findings)
        return {
            'version': 'source-report.v1', 'contrato': self.contract['version'], 'fecha_corte': self.cut_off.isoformat(),
            'moneda': self.mapping['moneda'],
            'resultado_lote': 'BLOQUEADO' if self.blockers else 'VALIDADO', 'motivos_bloqueo': sorted(self.blockers),
            'universo_completo': self.complete and not structural,
            'publicacion_permitida': not self.blockers,
            'accion_cuarentena': 'CONSERVAR_ESTADO_PREVIO_MARCAR_ACTUALIZACION_PENDIENTE',
            'columnas': self.columns, 'filas': counts, 'decisiones_filas': decisions,
            'conteos': {'filas_cabecera': counts['cabecera']['leidas'], 'filas_detalle': counts['detalle']['leidas'],
                         'objetos': len(objects), 'objetos_aceptados': len(objects) - len(quarantined),
                         'objetos_en_cuarentena': len(quarantined),
                         'personas': len({r.values.get('Destinatario_Id') for r in self.rows if r.kind == 'cabecera'}),
                         'relaciones': sum(len(o.headers) for o in self.objects.values()),
                         'obligaciones_unicas': sum(o['obligaciones'] for o in objects),
                         'duplicados_identicos': codes['DUPLICADO_IDENTICO'], 'duplicados_conflictivos': codes['DUPLICADO_CONFLICTIVO'],
                         'detalle_sin_cabecera': codes['DETALLE_SIN_CABECERA'],
                         'objetos_sin_contacto_utilizable': sum('SIN_CONTACTO_UTILIZABLE' in o['banderas'] for o in objects),
                         'objetos_porcentajes_no_100': sum('PORCENTAJES_NO_SUMAN_100' in o['banderas'] for o in objects)},
            'importes': {**{key: None if structural else f'{value:.2f}' for key, value in amounts.items()},
                      'actualizado_filas_no_observadas': dict(sorted(missing.items())),
                      'detalle_sin_objeto': None if structural else aggregate(unlinked, 'sum'),
                      'completo': not missing and not structural},
            'cuarentena': {'objetos_pct': f'{object_pct:.2f}', 'importe_observado_pct': f'{amount_pct:.2f}',
                            'importe_evaluable': not missing and not structural},
            'objetos': objects, 'hallazgos': findings, 'hallazgos_por_codigo': dict(sorted(codes.items())),
        }


def validate_batch(files, mapping, contract, cut_off) -> dict:
    """Valida sin escribir: rutas TSV o SourceTable, mapping y contrato como dicts.

    Devuelve solo ubicaciones, referencias ordinales, códigos y agregados. ACEPTADA
    significa candidata; si publicacion_permitida es false no se publica ninguna.
    """
    validator = _Validator(mapping, contract, cut_off)
    validator.prepare(files)
    structural = bool(validator.blockers)
    if not structural:
        validator.group()
        if not validator.objects:
            validator.blockers.add('LOTE_VACIO')
    return validator.report(structural)


def render_markdown(report: dict) -> str:
    lines = ['# Validación de origen v1', '', f"Corte: {report['fecha_corte']}. Lote: **{report['resultado_lote']}**.",
             '', 'Dry-run: ninguna escritura. Los objetos en cuarentena conservan su estado anterior',
             'y deben marcarse actualización pendiente en el publicador.', '',
             '| Archivo | Leídas | Aceptadas candidatas | Rechazadas |', '|---|---:|---:|---:|']
    for kind, counts in report['filas'].items():
        lines.append(f"| {kind} | {counts['leidas']} | {counts['aceptadas']} | {counts['rechazadas']} |")
    lines += ['', f"Objetos en cuarentena: {report['conteos']['objetos_en_cuarentena']}.",
              f"Importe excluido observado de esos objetos ({report['moneda']}): {report['importes']['actualizado_en_cuarentena_observado']}.",
              f"Importes completos: {report['importes']['completo']}. Los faltantes no son cero.",
              f"Desglose de importes no observados: {json.dumps(report['importes']['actualizado_filas_no_observadas'], ensure_ascii=False)}.",
              f"Bloqueos: {', '.join(report['motivos_bloqueo']) or 'ninguno'}.",
              f"Duplicados idénticos: {report['conteos']['duplicados_identicos']}; conflictivos: {report['conteos']['duplicados_conflictivos']}.",
              f"Detalle sin cabecera: {report['conteos']['detalle_sin_cabecera']}.",
              f"Objetos sin contacto utilizable: {report['conteos']['objetos_sin_contacto_utilizable']}.",
              f"Objetos con porcentajes ≠100: {report['conteos']['objetos_porcentajes_no_100']}.", '']
    for kind, metadata in report['columnas'].items():
        lines += [f"Columnas opcionales presentes ({kind}): {', '.join(metadata['opcionales_presentes']) or 'ninguna'}.",
                  f"Columnas opcionales ausentes ({kind}): {', '.join(metadata['opcionales_ausentes']) or 'ninguna'}.", '']
    lines += ['| Archivo | Resultado | Código primario | Filas |', '|---|---|---|---:|']
    for kind, counts in report['filas'].items():
        for outcome in ('aceptadas', 'rechazadas'):
            for code, count in counts[outcome + '_por_codigo'].items():
                lines.append(f'| {kind} | {outcome} | {code} | {count} |')
    lines += ['', '| Objeto (referencia local) | Resultado | Subtotal actualizado | Completo | Control | Diferencia | Motivos / banderas |',
              '|---|---|---:|---|---:|---:|---|']
    for obj in report['objetos']:
        amount, control = obj['importe_actualizado'], obj['conciliacion']
        lines.append(f"| {obj['referencia']} | {obj['resultado']} | {amount['valor']} | {amount['completo']} | "
                     f"{control['control']} | {control['diferencia']} | {', '.join(obj['motivos'] + obj['banderas']) or 'ninguno'} |")
    lines += ['',
              '| Archivo | Línea | Campo | Código | Presencia |', '|---|---:|---|---|---|']
    for finding in report['hallazgos']:
        lines.append('| ' + ' | '.join(str(finding[k]) for k in ('archivo', 'linea', 'campo', 'codigo', 'presencia')) + ' |')
    return '\n'.join(lines) + '\n'


def write_report(report, output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    (output / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    (output / 'report.md').write_text(render_markdown(report), encoding='utf-8')


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description='Valida un lote sin credenciales ni conexión a una base.')
    parser.add_argument('--folder', type=Path, required=True)
    parser.add_argument('--contract', type=Path, required=True)
    parser.add_argument('--cut-off', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--mapping', type=Path)
    args = parser.parse_args(argv)
    try:
        report = validate_batch({name: args.folder / f'{name}.tsv' for name in ('cabecera', 'detalle')},
                                load_mapping(args.folder, args.mapping), load_contract(args.contract), args.cut_off)
        write_report(report, args.output)
    except (ValidationError, OSError):
        print('VALIDACION_NO_EJECUTABLE: revisar contrato, mapeo, corte y archivos de entrada/salida.')
        return 2
    print(f"{report['resultado_lote']}: objetos={report['conteos']['objetos']}; "
          f"cuarentena={report['conteos']['objetos_en_cuarentena']}")
    return 1 if report['resultado_lote'] == 'BLOQUEADO' else 0


if __name__ == '__main__':
    raise SystemExit(main())
