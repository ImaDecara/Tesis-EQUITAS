"""Contratos de la cartera sintética ALIGN-023: semilla, oráculo independiente, variantes y privacidad."""

import ast
import csv
import hashlib
import importlib.util
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from quality.fixtures import synthetic_portfolio as portfolio

SCRIPT = ROOT / 'quality/fixtures/synthetic_portfolio.py'
FIXTURE = ROOT / 'back/tests/fixtures/sintetico-v1'
MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
RELS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
STDLIB_ONLY = {'__future__', 'argparse', 'csv', 'hashlib', 'io', 'json', 'random', 're', 'sys', 'zipfile',
               'dataclasses', 'datetime', 'decimal', 'pathlib'}


def interpreter() -> str:
    """Intérprete con openpyxl==3.1.5: el actual o el venv del backend que crea ci.py."""
    if importlib.util.find_spec('openpyxl'):
        return sys.executable
    candidate = ROOT / 'back/.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if candidate.exists():
        return str(candidate)
    raise AssertionError('Falta openpyxl==3.1.5 (back/requirements.txt) para generar la variante XLSX')


def generate(output: Path, *args: str) -> subprocess.CompletedProcess:
    # -I: sin directorio actual ni del script en sys.path; el generador no puede importar back/ETL.
    return subprocess.run([interpreter(), '-I', str(SCRIPT), '--output', str(output), *args],
                          capture_output=True, text=True, timeout=300, check=False)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_delimited(path: Path, delimiter: str, encoding: str) -> list[list[str]]:
    text = path.read_bytes().decode(encoding)
    quoting = csv.QUOTE_NONE if delimiter == '\t' else csv.QUOTE_MINIMAL
    return list(csv.reader(io.StringIO(text, newline=''), delimiter=delimiter, quoting=quoting))


def read_xlsx(path: Path) -> dict[str, list[list[str]]]:
    """Lector mínimo con la biblioteca estándar, independiente de openpyxl."""
    sheets = {}
    with zipfile.ZipFile(path) as archive:
        targets = {r.get('Id'): r.get('Target') for r in ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
        names = archive.namelist()
        shared = []
        if 'xl/sharedStrings.xml' in names:
            shared = [''.join(t.text or '' for t in si.iter(f'{{{MAIN}}}t'))
                      for si in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
        for sheet in ET.fromstring(archive.read('xl/workbook.xml')).iter(f'{{{MAIN}}}sheet'):
            target = targets[sheet.get(f'{{{RELS}}}id')].lstrip('/')
            root = ET.fromstring(archive.read(target if target.startswith('xl/') else f'xl/{target}'))
            rows = []
            for row in root.iter(f'{{{MAIN}}}row'):
                cells = {}
                for cell in row.iter(f'{{{MAIN}}}c'):
                    letters = re.match(r'[A-Z]+', cell.get('r')).group()
                    column = sum((ord(ch) - 64) * 26 ** i for i, ch in enumerate(reversed(letters))) - 1
                    if cell.get('t') == 'inlineStr':
                        cells[column] = ''.join(t.text or '' for t in cell.iter(f'{{{MAIN}}}t'))
                    elif cell.get('t') == 's':
                        cells[column] = shared[int(cell.find(f'{{{MAIN}}}v').text)]
                    else:
                        value = cell.find(f'{{{MAIN}}}v')
                        cells[column] = '' if value is None or value.text is None else value.text
                rows.append(cells)
            width = max((max(c) + 1 for c in rows if c), default=0)
            sheets[sheet.get('name')] = [[cells.get(i, '') for i in range(width)] for cells in rows]
    return sheets


def by_case(expected: dict, tenant: str = portfolio.TENANT_A) -> dict[str, dict]:
    return {o['caso']: o for o in expected['municipios'][tenant]['objetos'] if o['caso'] != 'relleno'}


def records(path: Path) -> list[dict[str, str]]:
    table = read_delimited(path, '\t', 'utf-8')
    return [dict(zip(table[0], row)) for row in table[1:]]


def first_rows(path: Path) -> dict[str, list[dict[str, str]]]:
    """Primera fila de cada (ClaveAgrupacion, DEUD_id), agrupada por objeto: la obligación única."""
    seen, objects = set(), {}
    for row in records(path):
        if (row['ClaveAgrupacion'], row['DEUD_id']) not in seen:
            seen.add((row['ClaveAgrupacion'], row['DEUD_id']))
            objects.setdefault(row['ClaveAgrupacion'], []).append(row)
    return objects


def money(text: str) -> Decimal | None:
    return Decimal(text.replace('.', '').replace(',', '.')) if re.fullmatch(r'-?\d{1,3}(\.\d{3})*,\d{2}', text) else None


def day(text: str):
    try:
        return datetime.strptime(text, '%d/%m/%Y').date() if re.fullmatch(r'\d{2}/\d{2}/\d{4}', text) else None
    except ValueError:
        return None


def zip_contents(path: Path) -> dict[str, bytes]:
    if not zipfile.is_zipfile(path):
        return {'': path.read_bytes()}
    with zipfile.ZipFile(path) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


class SyntheticPortfolioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        base = Path(cls.tmp.name)
        cls.first, cls.second, cls.other = base / 'primera', base / 'segunda', base / 'otra-semilla'
        cls.plain = base / 'sin-variantes'
        for output, args in ((cls.first, ['--hostil', '--bomba-mib', '4']), (cls.second, ['--hostil', '--bomba-mib', '4']),
                             (cls.other, ['--seed', '7', '--sin-variantes']), (cls.plain, ['--sin-variantes'])):
            result = generate(output, *args)
            if result.returncode:
                raise AssertionError(result.stderr)
        cls.manifest = json.loads((cls.first / 'manifest.json').read_text(encoding='utf-8'))
        cls.expected = json.loads((cls.first / 'expected.json').read_text(encoding='utf-8'))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_same_seed_produces_same_hashes_and_other_seed_differs(self):
        for name in ('manifest.json', 'hostil/manifest.json'):
            with self.subTest(name=name):
                self.assertEqual((self.first / name).read_bytes(), (self.second / name).read_bytes())
        for entry in self.manifest['archivos']:
            with self.subTest(path=entry['ruta']):
                self.assertEqual(sha(self.first / entry['ruta']), entry['sha256'])
                self.assertEqual(sha(self.second / entry['ruta']), entry['sha256'])
        self.assertNotEqual(sha(self.first / 'cabecera.tsv'), sha(self.other / 'cabecera.tsv'))
        self.assertEqual(self.manifest['semilla'], portfolio.DEFAULT_SEED)
        self.assertEqual(self.manifest['fecha_corte'], '2026-09-30')
        self.assertNotIn('generado_en', json.dumps(self.manifest))

    def test_versioned_fixture_is_the_default_seed_output(self):
        # .gitignore excluye *.csv y *.xlsx (resguardo de datos reales): se versionan TSV y JSON y las
        # variantes se generan en ejecución con el mismo oráculo.
        versioned = json.loads((FIXTURE / 'manifest.json').read_text(encoding='utf-8'))
        stored = sorted(p.relative_to(FIXTURE).as_posix() for p in FIXTURE.rglob('*') if p.is_file())
        self.assertEqual(stored, sorted([e['ruta'] for e in versioned['archivos']] + ['manifest.json']))
        self.assertEqual((FIXTURE / 'manifest.json').read_bytes(), (self.plain / 'manifest.json').read_bytes())
        self.assertEqual((FIXTURE / 'expected.json').read_bytes(), (self.first / 'expected.json').read_bytes())
        self.assertFalse([p for p in FIXTURE.rglob('*') if p.suffix in ('.csv', '.xlsx', '.xlsm', '.xls')])
        for entry in versioned['archivos']:
            with self.subTest(path=entry['ruta']):
                self.assertEqual(sha(FIXTURE / entry['ruta']), entry['sha256'])
        self.assertLess(sum(e['bytes'] for e in versioned['archivos']), 1_000_000)

    def test_generator_never_imports_the_etl(self):
        tree = ast.parse(SCRIPT.read_text(encoding='utf-8'))
        modules = {(node.module if isinstance(node, ast.ImportFrom) else alias.name).split('.')[0]
                   for node in ast.walk(tree) if isinstance(node, (ast.Import, ast.ImportFrom))
                   for alias in node.names}
        self.assertEqual(modules - STDLIB_ONLY, {'openpyxl'})
        self.assertNotRegex(SCRIPT.read_text(encoding='utf-8'), r'\bETL\.\w|pandas')
        self.assertIn('no usa back/ETL', self.expected['calculado_por'])

    def test_manual_oracle_for_contract_cases(self):
        cases = by_case(self.expected)
        accepted = {name for name, o in cases.items() if o['resultado'] == 'ACEPTADO'}
        quarantine = {name: o['motivos'] for name, o in cases.items() if o['resultado'] == 'CUARENTENA'}
        self.assertEqual(quarantine, {
            'cuenta-ceros-izquierda': ['CUENTA_NO_CANONICA'], 'cuenta-alfanumerica': ['CUENTA_NO_CANONICA'],
            'importe-vacio': ['IMPORTE_VACIO'], 'importe-no-numerico': ['IMPORTE_NO_NUMERICO'],
            'fecha-imposible': ['FECHA_IMPOSIBLE'], 'tipo-ingreso-fuera-de-catalogo': ['TIPO_INGRESO_FUERA_DE_CATALOGO'],
            'tipo-bien-fuera-de-catalogo': ['TIPO_BIEN_FUERA_DE_CATALOGO'], 'conciliacion-diferente': ['CONCILIACION_DIFERENTE'],
            'duplicado-conflictivo': ['DUPLICADO_CONFLICTIVO'],
        })
        self.assertTrue({'base-valido', 'misma-cuenta-otro-tipo', 'cuenta-canonica-123', 'importe-cero'} <= accepted)
        self.assertEqual((cases['base-valido']['cuenta'], cases['misma-cuenta-otro-tipo']['cuenta']), ('4100', '4100'))
        # Faltante parcial (§4.1 reglas 3 y 4): subtotal de las filas observadas, desglose aparte y
        # completo=false; nunca nulo si hay filas observadas, nunca el faltante como 0.
        rows = first_rows(self.first / 'detalle.tsv')
        observed = [r['NOTD_totalActualizado'] for r in rows[cases['importe-vacio']['clave_agrupacion']]
                    if r['NOTD_totalActualizado']]
        self.assertEqual(len(observed), 1)
        self.assertEqual(cases['importe-vacio']['importe_actualizado'],
                         {'valor': str(money(observed[0])), 'presencia': 'OBSERVADO',
                          'filas_no_observadas': {'NO_INFORMADO_EN_ORIGEN': 1}, 'completo': False})
        observed = [r['NOTD_capital'] for r in rows[cases['importe-no-numerico']['clave_agrupacion']] if r['NOTD_capital'] != 'abc']
        self.assertEqual(cases['importe-no-numerico']['importe_capital'],
                         {'valor': str(money(observed[0])), 'presencia': 'OBSERVADO',
                          'filas_no_observadas': {'INVALIDO': 1}, 'completo': False})
        self.assertEqual(cases['importe-cero']['importe_actualizado']['completo'], True)
        self.assertEqual(cases['cabecera-sin-detalle']['importe_actualizado'],
                         {'valor': '0.00', 'presencia': 'OBSERVADO', 'filas_no_observadas': {}, 'completo': True})
        self.assertEqual(cases['fecha-ambigua']['vencimiento_mas_antiguo']['valor'], '2023-04-03')
        self.assertEqual(cases['estados-origen-vencimiento-viejo']['estados_al_corte'],
                         {'VENCIDA': 1, 'VIGENTE': 0, 'PAGADA': 1, 'ANULADA': 1, 'SUSPENDIDA': 1, 'UNKNOWN': 1,
                          'PENDIENTE_VENCIMIENTO_NO_OBSERVADO': 0})
        not_applicable = {'valor': None, 'presencia': 'NO_APLICA', 'filas_no_observadas': {}, 'completo': True}
        self.assertEqual(cases['vencimiento-posterior-al-corte']['dias_vencida_mas_antigua'], not_applicable)
        self.assertEqual(cases['cabecera-sin-detalle']['dias_vencida_mas_antigua'], not_applicable)
        self.assertEqual(cases['cabecera-sin-detalle']['vencimiento_mas_antiguo'], not_applicable)
        # Vencimiento imposible: INVALIDO, distinto del NO_APLICA de una obligación no vencida.
        invalid = {'valor': None, 'presencia': 'INVALIDO', 'filas_no_observadas': {'INVALIDO': 1}, 'completo': False}
        self.assertEqual(cases['fecha-imposible']['dias_vencida_mas_antigua'], invalid)
        self.assertEqual(cases['fecha-imposible']['vencimiento_mas_antiguo'], invalid)
        self.assertEqual(cases['fecha-imposible']['estados_al_corte']['PENDIENTE_VENCIMIENTO_NO_OBSERVADO'], 1)
        # El estado vacío no puede contarse como vencida: el máximo es de las observadas y se cuenta aparte.
        self.assertEqual(cases['estados-origen-vencimiento-viejo']['dias_vencida_mas_antigua'],
                         {'valor': (portfolio.DEFAULT_AS_OF - portfolio.date(2020, 1, 15)).days, 'presencia': 'OBSERVADO',
                          'filas_no_observadas': {'NO_INFORMADO_EN_ORIGEN': 1}, 'completo': False})
        for name in ('contacto-placeholder', 'contacto-formato-invalido', 'sin-contacto', 'contacto-inactivo'):
            self.assertIn('SIN_CONTACTO_UTILIZABLE', cases[name]['banderas'])
            self.assertEqual(cases[name]['contactos_utilizables'], 0)
        for name in ('contacto-placeholder', 'contacto-formato-invalido', 'sin-contacto'):
            self.assertNotIn('CONTACTO_INACTIVO', cases[name]['banderas'])
            self.assertEqual(cases[name]['contactos_inactivos'], 0)
        self.assertEqual((cases['contacto-inactivo']['contactos_inactivos'], cases['contacto-activo-mismo-valor']['contactos_utilizables']),
                         (2, 1))
        self.assertIn('CONTACTO_INACTIVO', cases['contacto-inactivo']['banderas'])
        self.assertNotIn('contacto-inactivo-placeholder', cases)
        self.assertEqual(cases['porcentajes-120']['suma_porcentajes'], {'valor': '120', 'presencia': 'OBSERVADO'})
        self.assertIn('PORCENTAJES_NO_SUMAN_100', cases['porcentaje-80']['banderas'])
        self.assertEqual(cases['porcentaje-faltante']['suma_porcentajes'], {'valor': None, 'presencia': 'NO_INFORMADO_EN_ORIGEN'})
        self.assertEqual(len(cases['dos-personas-un-objeto']['personas']), 2)
        shared = {cases[f'persona-varios-objetos-{n}']['personas'][0] for n in (1, 2, 3)}
        self.assertEqual(len(shared), 1)
        self.assertIn('DUPLICADO_IDENTICO', cases['duplicado-identico']['banderas'])
        self.assertIn('TIPO_INGRESO_SIN_MAPEO_EN_ETL', cases['tipo-ingreso-sin-mapeo-etl']['banderas'])
        self.assertEqual(cases['cabecera-sin-detalle']['obligaciones'], 0)
        self.assertNotIn('detalle-sin-cabecera', cases)
        for tenant in self.expected['municipios']:
            for item in self.expected['municipios'][tenant]['objetos']:
                with self.subTest(clave=item['clave_agrupacion']):
                    # Cada obligación única se clasifica una sola vez; ninguna se descarta del universo.
                    self.assertEqual(sum(item['estados_al_corte'].values()), item['obligaciones'])
        counts = self.expected['municipios'][portfolio.TENANT_A]['conteos']
        self.assertEqual((counts['objetos'], counts['obligaciones_unicas']), (40, 160))
        self.assertEqual((counts['duplicados_identicos'], counts['duplicados_conflictivos'], counts['detalle_sin_cabecera']), (1, 1, 1))

    def test_oracle_totals_match_an_independent_reading_of_the_files(self):
        """Recalcula, leyendo el TSV, importes y agregados temporales de todos los objetos (también en cuarentena)."""
        order = ('NO_APLICA', 'NO_INTEGRADO', 'NO_INFORMADO_EN_ORIGEN', 'INVALIDO')  # contrato §4

        def expected_aggregate(value, missing):
            presence = 'OBSERVADO' if value is not None else 'NO_APLICA' if not missing else next(
                state for state in order if state in missing)
            return {'valor': value, 'presencia': presence, 'filas_no_observadas': dict(sorted(missing.items())),
                    'completo': not missing}

        as_of = datetime.strptime(self.manifest['fecha_corte'], '%Y-%m-%d').date()
        states = self.manifest['catalogos']['NOTD_ESTA_id']
        header = read_delimited(self.first / 'cabecera.tsv', '\t', 'utf-8')
        municipality = self.expected['municipios'][portfolio.TENANT_A]
        self.assertEqual(len(header) - 1, municipality['conteos']['filas_cabecera'])
        rows = first_rows(self.first / 'detalle.tsv')
        totals = {'ACEPTADO': Decimal(0), 'CUARENTENA': Decimal(0)}
        not_observed: dict[str, int] = {}
        for item in municipality['objetos']:
            obligations = rows.get(item['clave_agrupacion'], [])
            for column, key in (('NOTD_totalActualizado', 'importe_actualizado'), ('NOTD_capital', 'importe_capital')):
                missing: dict[str, int] = {}
                values = [money(r[column]) for r in obligations]
                for r, value in zip(obligations, values):
                    if value is None:
                        state = 'NO_INFORMADO_EN_ORIGEN' if r[column] == '' else 'INVALIDO'
                        missing[state] = missing.get(state, 0) + 1
                subtotal = sum((v for v in values if v is not None), Decimal(0))
                observed = len(obligations) > sum(missing.values()) or not missing
                with self.subTest(clave=item['clave_agrupacion'], campo=key):
                    self.assertEqual(item[key], expected_aggregate(f'{subtotal:.2f}' if observed else None, missing))
                if column == 'NOTD_totalActualizado':
                    totals[item['resultado']] += subtotal
                    for state, count in missing.items():
                        not_observed[state] = not_observed.get(state, 0) + count
            due_missing: dict[str, int] = {}
            late_missing: dict[str, int] = {}
            dues, late = [], []
            for r in obligations:
                due = day(r['NOTD_vencimiento'])
                due_state = 'NO_INFORMADO_EN_ORIGEN' if r['NOTD_vencimiento'] == '' else 'INVALIDO'
                if due is None:
                    due_missing[due_state] = due_missing.get(due_state, 0) + 1
                else:
                    dues.append(due)
                label = states.get(r['NOTD_ESTA_id'])
                if label is None or (label == 'PENDIENTE' and due is None):
                    state = 'NO_INFORMADO_EN_ORIGEN' if label is None and r['NOTD_ESTA_id'] == '' else (
                        'INVALIDO' if label is None else due_state)
                    late_missing[state] = late_missing.get(state, 0) + 1
                elif label == 'PENDIENTE' and due < as_of:
                    late.append((as_of - due).days)
            with self.subTest(clave=item['clave_agrupacion'], campo='temporal'):
                self.assertEqual(item['vencimiento_mas_antiguo'],
                                 expected_aggregate(min(dues).isoformat() if dues else None, due_missing))
                self.assertEqual(item['dias_vencida_mas_antigua'], expected_aggregate(max(late) if late else None, late_missing))
        self.assertEqual(municipality['importes'], {
            'actualizado_aceptado': f"{totals['ACEPTADO']:.2f}", 'actualizado_en_cuarentena_observado': f"{totals['CUARENTENA']:.2f}",
            'actualizado_filas_no_observadas': dict(sorted(not_observed.items()))})

    def test_aggregate_without_observed_rows_is_null_with_the_first_state(self):
        # §4.1 regla 4 (no la cubre la fixture): sin filas observadas el agregado es nulo, nunca 0.
        self.assertEqual(portfolio.amount(Decimal(0), 0, {'INVALIDO': 2}),
                         {'valor': None, 'presencia': 'INVALIDO', 'filas_no_observadas': {'INVALIDO': 2}, 'completo': False})
        mixed = portfolio.amount(Decimal(0), 0, {'INVALIDO': 1, 'NO_INFORMADO_EN_ORIGEN': 1})
        self.assertEqual((mixed['valor'], mixed['presencia']), (None, 'NO_INFORMADO_EN_ORIGEN'))
        self.assertEqual(portfolio.amount(Decimal('5.5'), 1, {'INVALIDO': 1})['valor'], '5.50')
        self.assertEqual(portfolio.amount(Decimal(0), 0, {})['valor'], '0.00')

    def test_tsv_csv_and_xlsx_variants_share_the_same_table_and_oracle(self):
        oracle_sha = sha(self.first / 'expected.json')
        self.assertEqual(self.manifest['oraculo'], {'ruta': 'expected.json', 'sha256': oracle_sha})
        reference = {stem: read_delimited(self.first / f'{stem}.tsv', '\t', 'utf-8') for stem in ('cabecera', 'detalle')}
        variants = {v['id']: v for v in self.manifest['variantes']}
        self.assertEqual(set(variants), {'tsv', 'csv-coma-utf8', 'csv-puntoycoma-utf8', 'csv-coma-cp1252',
                                         'csv-puntoycoma-cp1252', 'xlsx'})
        for variant in variants.values():
            self.assertEqual(variant['oraculo'], 'expected.json')
            if variant['id'].startswith('csv'):
                for path in variant['archivos']:
                    with self.subTest(path=path):
                        raw = (self.first / path).read_bytes()
                        self.assertEqual(raw.startswith(b'\xef\xbb\xbf'), variant['codificacion'] == 'utf-8-sig')
                        self.assertIn(b'\r\n', raw)
                        table = read_delimited(self.first / path, variant['separador'], variant['codificacion'])
                        self.assertEqual(table, reference[Path(path).stem])
        self.assertIn('Sintética'.encode('cp1252'), (self.first / 'variantes/csv-coma-cp1252/cabecera.csv').read_bytes())
        self.assertEqual(variants['xlsx']['compresion'], 'stored')
        workbook = read_xlsx(self.first / 'variantes/xlsx/cartera.xlsx')
        self.assertEqual(list(workbook), ['cabecera', 'detalle'])
        for stem, table in reference.items():
            width = len(table[0])
            self.assertEqual([row + [''] * (width - len(row)) for row in workbook[stem]], table)
        self.assertTrue({'000123', 'R-0456', '123'} <= {row[3] for row in reference['cabecera'][1:]})

    def test_content_is_obviously_fictitious(self):
        patterns = {
            'Destinatario': r'(Persona|Entidad) Sintética \d{4}', 'Destinatario_CUIT': r'99-\d{8}-\d',
            'Destinatario_Email': r'|NO POSEE|persona\.sintetica\.\d+(@|\(arroba\))example\.invalid',
            'Destinatario_Telefono': r'|0|0000-555-\d{4}', 'Destinatario_Celular': r'|-|0000-15-555-\d{4}',
            'Destinatario_Calle': r'Calle Sintética \d+', 'Destinatario_Localidad': r'Localidad Sintética \d',
            'Destinatario_Provincia': 'Provincia Sintética', 'Destinatario_CP': '0000',
            'Identificador': r'SINT-\d-[\w-]+',
        }
        for path in (self.first / 'cabecera.tsv', self.first / f'seguridad/{portfolio.TENANT_B}/cabecera.tsv'):
            table = read_delimited(path, '\t', 'utf-8')
            for row in table[1:]:
                record = dict(zip(table[0], row))
                for column, pattern in patterns.items():
                    with self.subTest(path=path.name, column=column):
                        self.assertRegex(record[column], f'^(?:{pattern})$')
        security = json.loads((self.first / 'seguridad/municipios.json').read_text(encoding='utf-8'))
        self.assertTrue(all(a['email'].endswith('@example.invalid') for a in security['cuentas']))
        self.assertNotIn('password', json.dumps(security).lower())
        everything = b''.join(p.read_bytes() for p in self.first.rglob('*') if p.is_file())
        for forbidden in (b'folyslqzqvnpolexcxjo', b'iylwghgvtydpmwidojdo', b'Municipalidad Demo', b'@gmail', b'@hotmail'):
            self.assertNotIn(forbidden, everything)

    def test_social_scenario_is_separate_and_never_an_input_column(self):
        social = json.loads((self.first / 'escenario-social.json').read_text(encoding='utf-8'))
        self.assertIn('nunca', social['prohibido'])
        columns = set(portfolio.CABECERA_COLUMNS) | set(portfolio.DETALLE_COLUMNS)
        self.assertFalse({key for row in social['objetos'] for key in row} & columns)
        for stem in ('cabecera', 'detalle'):
            header = (self.first / f'{stem}.tsv').read_text(encoding='utf-8').splitlines()[0].lower()
            self.assertNotIn('vulnerab', header)
            self.assertNotIn('grupo', header)
        objects = sum(m['conteos']['objetos'] for m in self.expected['municipios'].values())
        self.assertEqual(len(social['objetos']), objects)

    def test_security_family_has_two_tenants_roles_and_shared_keys(self):
        security = json.loads((self.first / 'seguridad/municipios.json').read_text(encoding='utf-8'))
        self.assertEqual([m['clave'] for m in security['municipios']], [portfolio.TENANT_A, portfolio.TENANT_B])
        self.assertEqual(len(security['cuentas']), 2 * len(portfolio.ROLES))
        self.assertEqual(security['objetos_misma_clave_en_ambos'], ['3-4100'])
        self.assertEqual(len(security['personas_en_ambos']), 1)
        header = (self.first / f'seguridad/{portfolio.TENANT_B}/cabecera.tsv').read_text(encoding='utf-8').splitlines()[0]
        self.assertEqual(header.split('\t'), portfolio.CABECERA_COLUMNS)

    def test_hostile_corpus_is_generated_bounded_and_hostile(self):
        hostile = self.first / 'hostil'
        manifest = json.loads((hostile / 'manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(len(manifest['archivos']), 10)
        for entry in manifest['archivos']:
            with self.subTest(path=entry['ruta']):
                self.assertEqual(sha(hostile / entry['ruta']), entry['sha256'])
                self.assertLess(entry['bytes'], 1_000_000)
        with zipfile.ZipFile(hostile / 'bomba-zip.xlsx') as bomb:
            size = sum(i.file_size for i in bomb.infolist())
            self.assertGreater(size / (hostile / 'bomba-zip.xlsx').stat().st_size, 100)
        with zipfile.ZipFile(hostile / 'xml-entidad-externa.xlsx') as archive:
            sheet = archive.read('xl/worksheets/sheet1.xml')
            self.assertRegex(sheet, rb'<!ENTITY xxe SYSTEM "file:///nonexistent/')
            self.assertIn(b'&xxe;', sheet)
        with zipfile.ZipFile(hostile / 'macro.xlsm') as archive:
            self.assertIn('xl/vbaProject.bin', archive.namelist())
            self.assertIn(b'macroEnabled', archive.read('[Content_Types].xml'))
        legacy = (hostile / 'xls-renombrado.xlsx').read_bytes()
        self.assertTrue(legacy.startswith(b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'))
        self.assertFalse(zipfile.is_zipfile(hostile / 'xls-renombrado.xlsx'))
        binary = (hostile / 'binario.csv').read_bytes()
        self.assertIn(b'\0', binary)
        with self.assertRaises(UnicodeDecodeError):
            binary.decode('utf-8')
        giant = read_xlsx(hostile / 'celda-gigante.xlsx')['cabecera']
        self.assertGreater(max(len(cell) for row in giant for cell in row), 32_767)
        self.assertGreater(max(len(c) for r in read_delimited(hostile / 'celda-gigante.csv', ',', 'utf-8') for c in r), 32_767)
        with zipfile.ZipFile(hostile / 'formulas.xlsx') as archive:
            self.assertRegex(archive.read('xl/worksheets/sheet1.xml'), rb'<f>1\+1</f><v ?/>')
        self.assertRegex((hostile / 'formulas.csv').read_text(encoding='utf-8'), r',=1\+1,')
        with zipfile.ZipFile(hostile / 'hojas-extra.xlsx') as archive:
            workbook = archive.read('xl/workbook.xml')
        self.assertEqual(len(re.findall(rb'<sheet ', workbook)), 4)
        self.assertIn(b'state="hidden"', workbook)

    def test_every_hostile_file_carries_its_declared_sentinels(self):
        """Presencia en la entrada antes de que ALIGN-059 compruebe ausencia en logs y respuestas restringidas."""
        hostile = self.first / 'hostil'
        manifest = json.loads((hostile / 'manifest.json').read_text(encoding='utf-8'))
        unreadable = {'xls-renombrado.xlsx', 'binario.csv'}
        for entry in manifest['archivos']:
            with self.subTest(path=entry['ruta']):
                contents = zip_contents(hostile / entry['ruta'])
                self.assertIn(portfolio.SENTINEL.encode(), b''.join(contents.values()))
                self.assertTrue(entry['centinelas'])
                for marker in entry['centinelas']:
                    self.assertTrue(marker['valor'].startswith(portfolio.SENTINEL))
                    for part in marker['partes'] or ['']:
                        self.assertIn(marker['valor'].encode(), contents[part])
                shown = {m['valor'] for m in entry['centinelas'] if m['en_preview_autorizado']}
                self.assertEqual(bool(shown), entry['ruta'] not in unreadable)
                # Un archivo legible lleva su centinela como valor completo de un campo de datos seleccionado.
                if entry['ruta'].endswith('.csv') and shown:
                    cells = {c for r in read_delimited(hostile / entry['ruta'], ',', 'utf-8') for c in r}
                    self.assertLessEqual(shown, cells)
                elif shown and entry['ruta'] != 'xml-entidad-externa.xlsx':  # ElementTree rechaza la entidad externa
                    workbook = read_xlsx(hostile / entry['ruta'])
                    for sheet in ('cabecera', 'detalle'):
                        self.assertLessEqual(shown, {c for row in workbook[sheet] for c in row})
        entry = next(e for e in manifest['archivos'] if e['ruta'] == 'hojas-extra.xlsx')
        shown = {m['valor'] for m in entry['centinelas'] if m['en_preview_autorizado']}
        hidden = {m['valor'] for m in entry['centinelas'] if not m['en_preview_autorizado']}
        workbook = read_xlsx(hostile / 'hojas-extra.xlsx')
        selected = {c for sheet in ('cabecera', 'detalle') for row in workbook[sheet] for c in row}
        ignored = {c for sheet in ('notas', 'oculta') for row in workbook[sheet] for c in row}
        self.assertEqual((len(shown), len(hidden)), (1, 2))
        self.assertTrue(shown <= selected and not shown & ignored)
        self.assertTrue(hidden <= ignored and not hidden & selected)

    def test_contact_validity_distinguishes_the_same_value_active_and_inactive(self):
        cases = by_case(self.expected)
        validity = json.loads((self.first / 'contactos-vigencia.json').read_text(encoding='utf-8'))
        self.assertEqual(validity['clave'], ['municipio', 'Destinatario_Id', 'columna'])
        self.assertIn('contactos-vigencia.json', [c['ruta'] for c in self.manifest['complementarios']])
        declared = {(c['municipio'], c['Destinatario_Id'], c['columna']): c['vigencia'] for c in validity['contactos']}
        header = {row['Destinatario_Id']: row for row in records(self.first / 'cabecera.tsv')}
        inactive, active = (str(cases[name]['personas'][0]) for name in ('contacto-inactivo', 'contacto-activo-mismo-valor'))
        phone = header[inactive]['Destinatario_Telefono']
        # Mismo valor bien formado en el TSV: solo la vigencia declarada separa los dos resultados.
        self.assertRegex(phone, r'^0000-555-\d{4}$')
        self.assertEqual(header[active]['Destinatario_Telefono'], phone)
        self.assertRegex(header[inactive]['Destinatario_Email'], r'^persona\.sintetica\.\d{4}@example\.invalid$')
        self.assertEqual(declared[(portfolio.TENANT_A, inactive, 'Destinatario_Telefono')], 'INACTIVO')
        self.assertEqual(declared[(portfolio.TENANT_A, inactive, 'Destinatario_Email')], 'INACTIVO')
        self.assertEqual(declared[(portfolio.TENANT_A, active, 'Destinatario_Telefono')], 'ACTIVO')
        self.assertEqual([cases[n]['contactos_utilizables'] for n in ('contacto-inactivo', 'contacto-activo-mismo-valor')], [0, 1])
        findings = {(f['campo'], f['presencia']) for f in self.expected['municipios'][portfolio.TENANT_A]['hallazgos']
                    if f['codigo'] == 'CONTACTO_INACTIVO'}
        self.assertEqual(findings, {('Destinatario_Telefono', 'OBSERVADO'), ('Destinatario_Email', 'OBSERVADO')})
        person = portfolio.Person(pid=1, name='Persona Sintética 0001', document='99-00000001-1', phone=phone)
        self.assertEqual(portfolio._usable_contacts(person), (1, []))
        person.vigencia = {'Destinatario_Telefono': 'INACTIVO'}
        self.assertEqual(portfolio._usable_contacts(person), (0, [('Destinatario_Telefono', 'CONTACTO_INACTIVO', 'OBSERVADO')]))

    def test_scale_family_reaches_documented_cardinalities(self):
        with tempfile.TemporaryDirectory() as directory:
            result = generate(Path(directory) / 'escala', '--profile', 'escala', '--sin-variantes')
            self.assertEqual(result.returncode, 0, result.stderr)
            counts = json.loads((Path(directory) / 'escala/manifest.json').read_text(encoding='utf-8'))['conteos']
        main = counts[portfolio.TENANT_A]
        self.assertEqual((main['objetos'], main['obligaciones_unicas']), (2933, 56286))
        self.assertGreater(main['filas_detalle'], 3000)
        self.assertGreater(main['filas_cabecera'], 2933)
        self.assertGreater(main['objetos_sin_contacto_utilizable'], 0)

    def test_cli_rejects_non_empty_output_and_unbounded_bomb(self):
        result = generate(self.first)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('vacía', result.stderr)
        with tempfile.TemporaryDirectory() as directory:
            result = generate(Path(directory) / 'x', '--hostil', '--bomba-mib', '65')
            self.assertEqual(result.returncode, 2)
        with self.assertRaises(ValueError):
            portfolio.filler(portfolio.Builder(1, portfolio.DEFAULT_AS_OF), portfolio.TENANT_A, 5, 2)


if __name__ == '__main__':
    unittest.main()
