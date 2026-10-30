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
FINDING_CODES = frozenset({
    'DUPLICADO_IDENTICO',
    'ESTADO_ORIGEN_NO_INFORMADO',
    'CONTACTO_PLACEHOLDER',
    'CONTACTO_FORMATO_INVALIDO',
    'CONTACTO_INACTIVO',
    'CUENTA_NO_CANONICA',
    'IDENTIFICADOR_INVALIDO',
    'CAMPO_OBLIGATORIO_VACIO',
    'IMPORTE_VACIO',
    'IMPORTE_NO_NUMERICO',
    'IMPORTE_NEGATIVO',
    'IMPORTE_FUERA_DE_RANGO',
    'FECHA_VACIA',
    'FECHA_CENTINELA',
    'FECHA_FORMATO_INVALIDO',
    'FECHA_IMPOSIBLE',
    'ESTADO_ORIGEN_DESCONOCIDO',
    'ESTADOS_ORIGEN_CONFLICTIVOS',
    'ESTADO_OBJETO_DESCONOCIDO',
    'TIPO_BIEN_FUERA_DE_CATALOGO',
    'TIPO_INGRESO_FUERA_DE_CATALOGO',
    'DUPLICADO_CONFLICTIVO',
    'DETALLE_SIN_CABECERA',
    'CLAVE_AGRUPACION_AMBIGUA',
    'CABECERAS_INCONSISTENTES',
    'CUENTA_DETALLE_DIFERENTE',
    'TIPO_BIEN_DETALLE_DIFERENTE',
    'CONCILIACION_DIFERENTE',
    'PORCENTAJE_INVALIDO',
    'ENTERO_INVALIDO',
    'ARCHIVO_NO_LEIBLE',
    'ESTRUCTURA_INVALIDA',
    'COLUMNA_OBLIGATORIA_AUSENTE',
    'LIMITE_ARCHIVO_EXCEDIDO',
})


class ValidationError(ValueError):
    """Solo códigos propios: nunca incluye el valor recibido ni rutas del usuario."""


def require(condition):
    if not condition:
        raise ValidationError('CONFIGURACION_INVALIDA')


def validate_contract(contract):
    """Comprueba los insumos del motor antes de leer una fila; no admite tipos nuevos."""
    c = contract
    require(c['version'] == 'source-contract.v1')
    require(set(c['codigos']) == FINDING_CODES)
    for spec in c['codigos'].values():
        require(spec['efecto'] in ('ALERTA', 'CUARENTENA', 'BLOQUEO'))
        require(spec.get('efecto_opcional', spec['efecto']) in ('ALERTA', 'CUARENTENA', 'BLOQUEO'))
        require(type(spec.get('bloquea_lote', False)) is bool)
    formats = c['formatos']
    require(formats['fechas'] and all((k, v) in (('dd/mm/aaaa', '%d/%m/%Y'), ('aaaa-mm-dd', '%Y-%m-%d'))
                                    for k, v in formats['fechas'].items()))
    for key, supported in (('codificaciones', {'utf-8', 'utf-8-sig', 'cp1252'}),
                           ('separadores_decimales', {',', '.'}), ('separadores_miles', {'', ',', '.'}),
                           ('separadores_adaptadores', {'\\t', ',', ';', None})):
        require(isinstance(formats[key], list) and formats[key] and set(formats[key]) <= supported)
    for key in ('fechas_centinela', 'dias_centinela_iso'):
        require(isinstance(formats[key], list) and all(isinstance(v, str) for v in formats[key]))
    require(set(c['limites']) == {'bytes', 'filas', 'columnas', 'celda'})
    require(all(type(v) is int and v > 0 for v in c['limites'].values()))
    require(0 < int(c['claves']['bigint_max']) <= 9223372036854775807)
    require(set(c['archivos']) == {'cabecera', 'detalle'})
    required = {'cabecera': {'ClaveAgrupacion': 'texto', 'Bien_Tipo_Id': 'catalogo', 'Cuenta': 'cuenta',
                             'Destinatario_Id': 'id', 'Deuda_Actualizada': 'importe'},
                'detalle': {'ClaveAgrupacion': 'texto', 'DEUD_id': 'id', 'NOTD_capital': 'importe',
                            'NOTD_totalActualizado': 'importe', 'NOTD_vencimiento': 'fecha', 'Tipo_Ingreso_Id': 'catalogo'}}
    types = {'texto', 'id', 'cuenta', 'importe', 'fecha', 'catalogo', 'entero', 'estado_objeto',
             'estado_obligacion', 'porcentaje', 'contacto'}
    for kind, fields in required.items():
        columns = c['archivos'][kind]['columnas']
        require(isinstance(columns, dict))
        for name, spec in columns.items():
            require(isinstance(name, str) and name and spec['tipo'] in types and type(spec['requerida']) is bool)
            require(spec['tipo'] != 'catalogo' or name in ('Bien_Tipo_Id', 'Tipo_Ingreso_Id'))
        for name, field_type in fields.items():
            require(columns[name]['tipo'] == field_type and columns[name]['requerida'])
    catalogs = c['catalogos']
    require(set(catalogs['por_lote']) == {'Bien_Tipo_Id', 'Tipo_Ingreso_Id', 'NOTD_ESTA_id', 'NOTD_SITU_id'})
    require(set(catalogs['estados_obligacion']) == {'PENDIENTE', 'PAGADA', 'ANULADA', 'SUSPENDIDA', 'UNKNOWN'})
    require(catalogs['normalizacion_estado_objeto'] == 'casefold')
    require(catalogs['Estado'] and all(isinstance(k, str) and k and v in ('ACTIVO', 'INACTIVO')
                                    for k, v in catalogs['Estado'].items()))
    require(len({k.casefold() for k in catalogs['Estado']}) == len(catalogs['Estado']))
    require(isinstance(catalogs['tipos_ingreso_mapeados_etl_v0'], list)
            and all(isinstance(v, str) for v in catalogs['tipos_ingreso_mapeados_etl_v0']))
    require(set(c['contactos']['columnas']) == {'Destinatario_Email', 'Destinatario_Telefono', 'Destinatario_Celular'})
    require(isinstance(c['contactos']['marcadores'], list) and all(isinstance(v, str) for v in c['contactos']['marcadores']))
    rules = c['consistencias']
    require(isinstance(rules['campos_comunes_cabecera'], list)
            and set(rules['campos_comunes_cabecera']) <= set(c['archivos']['cabecera']['columnas']))
    for name in ('tolerancia_importe', 'porcentaje_total', 'cuarentena_max_objetos_pct', 'cuarentena_max_importe_pct'):
        number = Decimal(rules[name])
        require(number.is_finite() and number >= 0 and (name == 'tolerancia_importe' or number <= 100))


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
        self.unreadable = set()
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
            validate_contract(c)
            require(m['version'] == 'source-mapping.v1')
            require(all(isinstance(m[k], str) and m[k].strip() for k in ('municipio', 'jurisdiccion', 'moneda')))
            require(re.fullmatch(r'[A-Z]{3}', m['moneda']))
            require(m['fecha_corte'] == self.cut_off.isoformat())
            f = m['formato']
            require(f['fecha'] in c['formatos']['fechas'])
            require(f['codificacion'] in c['formatos']['codificaciones'])
            # Separador físico del lote; los adaptadores CSV/XLSX entregan SourceTable.
            separator = '\\t' if f['separador'] == '\t' else f['separador']
            require(separator in c['formatos']['separadores_adaptadores'])
            require(f['decimal'] in c['formatos']['separadores_decimales']
                    and f['miles'] in c['formatos']['separadores_miles'])
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
        except (KeyError, TypeError, ValueError, ArithmeticError, AttributeError):
            raise ValidationError('CONFIGURACION_INVALIDA') from None

    def effect(self, kind, column, code):
        spec = self.contract['codigos'][code]
        required = self.contract['archivos'][kind]['columnas'].get(column, {}).get('requerida', True)
        return spec['efecto'] if required else spec.get('efecto_opcional', spec['efecto'])

    def note(self, row, column, code, presence=INVALID):
        finding = {'archivo': row.kind, 'linea': row.line, 'campo': column, 'codigo': code, 'presencia': presence}
        self.findings[(row.kind, row.line, column, code)] = finding
        effect = self.effect(row.kind, column, code)
        if (effect != 'ALERTA' or code == 'DUPLICADO_IDENTICO') and code not in row.codes:
            row.codes.append(code)
        if effect == 'CUARENTENA' and row.obj:
            row.obj.reasons.add(code)
        if effect == 'BLOQUEO' or self.contract['codigos'][code].get('bloquea_lote', False):
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
                encoding = self.mapping['formato']['codificacion']
                with path.open(encoding='utf-8-sig' if encoding == 'utf-8' else encoding, newline='') as stream:
                    reader = csv.reader(stream, delimiter='\t', strict=True)
                    columns = [name.strip() for name in next(reader, [])]
                    for values in reader:
                        if not values or (len(values) == 1 and not values[0].strip()):
                            continue
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
            self.unreadable.add(kind)
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
            readable = kind not in self.unreadable
            if readable and (not columns or len(set(columns)) != len(columns)
                             or any(not isinstance(c, str) or not c for c in columns)):
                self.note(head, '*', 'ESTRUCTURA_INVALIDA')
            if len(columns) > limits['columnas'] or len(table.rows) > limits['filas']:
                self.note(head, '*', 'LIMITE_ARCHIVO_EXCEDIDO')
            mapping = self.mapping.get('columnas', {}).get(kind, {})
            known = definitions['columnas']
            available = {name for name in known if mapping.get(name, name) in columns}
            optional = {name for name, spec in known.items() if not spec['requerida']}
            self.columns[kind] = {'opcionales_presentes': sorted(optional & available) if readable else None,
                                  'opcionales_ausentes': sorted(optional - available) if readable else None,
                                  'extras_ignoradas': len(set(columns) - {mapping.get(n, n) for n in known}) if readable else None,
                                  'presencia': OBSERVED if readable else 'NO_INTEGRADO'}
            for name, spec in known.items():
                if readable and spec['requerida'] and name not in available:
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
                if kind == 'cabecera' and 'Estado' in checked.values:
                    checked.values['Estado'] = checked.values['Estado'].casefold()

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
                if not raw:
                    self.note(row, name, 'CAMPO_OBLIGATORIO_VACIO', MISSING)
                elif raw not in self.mapping['catalogos'][name]:
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
        catalog = {k.casefold(): v for k, v in self.contract['catalogos']['Estado'].items()}
        if not status:
            row.obj.flags.add('ESTADO_OBJETO_NO_INFORMADO')
        elif status.casefold() not in catalog:
            self.note(row, 'Estado', 'ESTADO_OBJETO_DESCONOCIDO')
        elif catalog[status.casefold()] == 'INACTIVO':
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
                if value == 'UNKNOWN':
                    continue  # Ausencia semántica: no contradice un estado observado.
                cell = Cell(value) if value else Cell(None, INVALID, 'ESTADO_ORIGEN_DESCONOCIDO')
                self.cell(row, name, cell)
                states.append(cell)
        if not states:
            state = Cell(None, MISSING, 'ESTADO_ORIGEN_NO_INFORMADO')
            name = 'NOTD_SITU_id' if row.values.get('NOTD_SITU_id') and not row.values.get('NOTD_ESTA_id') else 'NOTD_ESTA_id'
            self.cell(row, name, state)
        elif any(s.value is None for s in states):
            state = Cell(None, INVALID)
        elif len({s.value for s in states}) > 1:
            state = Cell(None, INVALID, 'ESTADOS_ORIGEN_CONFLICTIVOS')
            self.cell(row, 'NOTD_ESTA_id', state)
        else:
            state = states[0]
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
            if link and obj not in links[link]:
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
            link = row.values.get('ClaveAgrupacion', '')
            if not link:
                self.note(row, 'ClaveAgrupacion', 'CAMPO_OBLIGATORIO_VACIO', MISSING)
            linked = links.get(link, []) if link else []
            if not linked:
                self.note(row, 'ClaveAgrupacion', 'DETALLE_SIN_CABECERA')
                continue
            if len(linked) > 1:
                self.note(row, 'ClaveAgrupacion', 'CLAVE_AGRUPACION_AMBIGUA')
                continue
            row.obj = obj = linked[0]
            if self.deduplicate(row, obligations, (*obj.key, row.values.get('DEUD_id', '')), 'DEUD_id'):
                continue
            obj.details.append(row)
            self.validate_fields(row)
            for name, expected, code in (('Cuenta', obj.key[1], 'CUENTA_DETALLE_DIFERENTE'),
                                         ('Bien_Tipo_Id', obj.key[0], 'TIPO_BIEN_DETALLE_DIFERENTE')):
                if row.values.get(name) and row.values[name] != expected:
                    self.note(row, name, code)

    def object_report(self, obj):
        amounts = {name: aggregate([r.cells[name] for r in obj.details], 'sum')
                   for name in ('NOTD_totalActualizado', 'NOTD_capital')}
        actual = amounts['NOTD_totalActualizado']
        header = obj.headers[0]
        control = header.cells['Deuda_Actualizada']
        difference = None
        link_evaluable = all(r.values.get('ClaveAgrupacion') for r in obj.headers) and 'CLAVE_AGRUPACION_AMBIGUA' not in obj.reasons
        if control.value is not None and actual['completo'] and link_evaluable:
            difference = control.value - Decimal(actual['valor'])
            if abs(difference) > Decimal(self.contract['consistencias']['tolerancia_importe']):
                self.note(header, 'Deuda_Actualizada', 'CONCILIACION_DIFERENTE', OBSERVED)
        difference_missing = ([control.presence] if control.value is None else []) + list(actual['filas_no_observadas'])
        if not link_evaluable:
            difference_missing.append('NO_INTEGRADO')
        difference_presence = next((p for p in PRESENCE_ORDER if p in difference_missing), OBSERVED)
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
        if not obj.details and link_evaluable:
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
                              'evaluable': difference is not None,
                              'presencia_diferencia': difference_presence},
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
        object_pct = Decimal(len(quarantined) * 100) / len(objects) if objects and not structural else None
        denominator = sum(amounts.values())
        amount_pct = amounts['actualizado_en_cuarentena_observado'] * 100 / denominator if denominator and not structural else None
        rules = self.contract['consistencias']
        if object_pct is not None and object_pct > Decimal(rules['cuarentena_max_objetos_pct']):
            self.blockers.add('CUARENTENA_EXCEDE_OBJETOS')
        if amount_pct is not None and amount_pct > Decimal(rules['cuarentena_max_importe_pct']):
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
            if self.effect(finding['archivo'], finding['campo'], finding['codigo']) == 'ALERTA':
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
                                'rechazadas': sum(primary.values()), 'rechazadas_por_codigo': dict(sorted(primary.items())),
                                'lectura_completa': kind not in self.unreadable}
        findings = sorted(self.findings.values(), key=lambda f: (f['archivo'], f['linea'], f['campo'], f['codigo']))
        codes = Counter(f['codigo'] for f in findings)
        totals = {'objetos': len(objects), 'objetos_aceptados': len(objects) - len(quarantined),
                  'objetos_en_cuarentena': len(quarantined),
                  'personas': len({r.values.get('Destinatario_Id') for r in self.rows if r.kind == 'cabecera'}),
                  'relaciones': sum(len(o.headers) for o in self.objects.values()),
                  'obligaciones_unicas': sum(o['obligaciones'] for o in objects),
                  'duplicados_identicos': codes['DUPLICADO_IDENTICO'], 'duplicados_conflictivos': codes['DUPLICADO_CONFLICTIVO'],
                  'detalle_sin_cabecera': codes['DETALLE_SIN_CABECERA'],
                  'objetos_sin_contacto_utilizable': sum('SIN_CONTACTO_UTILIZABLE' in o['banderas'] for o in objects),
                  'objetos_porcentajes_no_100': sum('PORCENTAJES_NO_SUMAN_100' in o['banderas'] for o in objects)}
        totals = {key: None if structural else value for key, value in totals.items()}
        presence = dict.fromkeys(totals, 'NO_INTEGRADO' if structural else OBSERVED)
        for kind in counts:
            totals[f'filas_{kind}'] = counts[kind]['leidas']
            presence[f'filas_{kind}'] = OBSERVED  # Registros alcanzados a leer, no total inferido del archivo.
        amount_presence = 'NO_INTEGRADO' if structural else OBSERVED
        missing_pct_presence = 'NO_INTEGRADO' if structural else 'NO_APLICA'
        return {
            'version': 'source-report.v1', 'contrato': self.contract['version'], 'fecha_corte': self.cut_off.isoformat(),
            'moneda': self.mapping['moneda'],
            'resultado_lote': 'BLOQUEADO' if self.blockers else 'VALIDADO', 'motivos_bloqueo': sorted(self.blockers),
            'universo_completo': self.complete and not structural,
            'publicacion_permitida': not self.blockers,
            'accion_cuarentena': 'CONSERVAR_ESTADO_PREVIO_MARCAR_ACTUALIZACION_PENDIENTE',
            'columnas': self.columns, 'filas': counts, 'decisiones_filas': decisions,
            'conteos': totals, 'conteos_presencia': presence,
            'importes': {**{key: None if structural else f'{value:.2f}' for key, value in amounts.items()},
                      'presencias': dict.fromkeys([*amounts, 'actualizado_filas_no_observadas', 'detalle_sin_objeto'], amount_presence),
                      'actualizado_filas_no_observadas': None if structural else dict(sorted(missing.items())),
                      'detalle_sin_objeto': None if structural else aggregate(unlinked, 'sum'),
                      'completo': not missing and not structural},
            'cuarentena': {'objetos_pct': None if object_pct is None else f'{object_pct:.2f}',
                            'objetos_pct_presencia': missing_pct_presence if object_pct is None else OBSERVED,
                            'importe_observado_pct': None if amount_pct is None else f'{amount_pct:.2f}',
                            'importe_observado_pct_presencia': missing_pct_presence if amount_pct is None else OBSERVED,
                            'importe_evaluable': amount_pct is not None and not missing},
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


def display(value, presence='NO_INTEGRADO', unavailable='no disponible'):
    if value is None:
        return 'no aplica' if presence == 'NO_APLICA' else unavailable
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def render_markdown(report: dict) -> str:
    lines = ['# Validación de origen v1', '', f"Corte: {report['fecha_corte']}. Lote: **{report['resultado_lote']}**.",
             '', 'Dry-run: ninguna escritura. Los objetos en cuarentena conservan su estado anterior',
             'y deben marcarse actualización pendiente en el publicador.', '',
             '| Archivo | Leídas | Aceptadas candidatas | Rechazadas |', '|---|---:|---:|---:|']
    for kind, counts in report['filas'].items():
        lines.append(f"| {kind} | {counts['leidas']} | {counts['aceptadas']} | {counts['rechazadas']} |")
    lines += ['', f"Objetos en cuarentena: {display(report['conteos']['objetos_en_cuarentena'])}.",
              f"Importe excluido observado de esos objetos ({report['moneda']}): {display(report['importes']['actualizado_en_cuarentena_observado'])}.",
              f"Importes completos: {report['importes']['completo']}. Los faltantes no son cero.",
              f"Desglose de importes no observados: {display(report['importes']['actualizado_filas_no_observadas'])}.",
              f"Bloqueos: {', '.join(report['motivos_bloqueo']) or 'ninguno'}.",
              f"Duplicados idénticos: {display(report['conteos']['duplicados_identicos'])}; conflictivos: {display(report['conteos']['duplicados_conflictivos'])}.",
              f"Detalle sin cabecera: {display(report['conteos']['detalle_sin_cabecera'])}.",
              f"Objetos sin contacto utilizable: {display(report['conteos']['objetos_sin_contacto_utilizable'])}.",
              f"Objetos con porcentajes ≠100: {display(report['conteos']['objetos_porcentajes_no_100'])}.", '']
    for name, title in (('objetos_pct', 'Objetos en cuarentena (%)'), ('importe_observado_pct', 'Importe observado en cuarentena (%)')):
        lines.append(f"{title}: {display(report['cuarentena'][name], report['cuarentena'][name + '_presencia'])}.")
    lines += ['', 'Leídas cuenta solo registros alcanzados; si la lectura es incompleta, no representa el total del archivo.',
              'Lectura incompleta: ' + (', '.join(k for k, v in report['filas'].items() if not v['lectura_completa']) or 'ninguna') + '.', '']
    for kind, metadata in report['columnas'].items():
        lines += [f"Columnas opcionales presentes ({kind}): {display(None) if metadata['opcionales_presentes'] is None else ', '.join(metadata['opcionales_presentes']) or 'ninguna'}.",
                  f"Columnas opcionales ausentes ({kind}): {display(None) if metadata['opcionales_ausentes'] is None else ', '.join(metadata['opcionales_ausentes']) or 'ninguna'}.", '']
    lines += ['| Archivo | Resultado | Código primario | Filas |', '|---|---|---|---:|']
    for kind, counts in report['filas'].items():
        for outcome in ('aceptadas', 'rechazadas'):
            for code, count in counts[outcome + '_por_codigo'].items():
                lines.append(f'| {kind} | {outcome} | {code} | {count} |')
    lines += ['', '| Objeto (referencia local) | Resultado | Subtotal actualizado | Completo | Control | Diferencia | Motivos / banderas |',
              '|---|---|---:|---|---:|---:|---|']
    for obj in report['objetos']:
        amount, control = obj['importe_actualizado'], obj['conciliacion']
        lines.append(f"| {obj['referencia']} | {obj['resultado']} | {display(amount['valor'], amount['presencia'])} | {amount['completo']} | "
                     f"{display(control['control'], control['presencia_control'])} | {display(control['diferencia'], unavailable='no evaluable')} | {', '.join(obj['motivos'] + obj['banderas']) or 'ninguno'} |")
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
    except ValidationError as error:
        print(str(error))
        return 2
    except OSError:
        print('VALIDACION_NO_EJECUTABLE: revisar contrato, mapeo, corte y archivos de entrada/salida.')
        return 2
    print(f"{report['resultado_lote']}: objetos={display(report['conteos']['objetos'])}; "
          f"cuarentena={display(report['conteos']['objetos_en_cuarentena'])}")
    return 1 if report['resultado_lote'] == 'BLOQUEADO' else 0


if __name__ == '__main__':
    raise SystemExit(main())
