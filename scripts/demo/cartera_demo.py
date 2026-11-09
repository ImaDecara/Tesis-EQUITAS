"""Cartera sintética de la demo local V1 (noche 6): pequeña, determinista y válida.

Escribe ``cabecera.tsv`` y ``detalle.tsv`` en el formato que lee el ETL (perfil
``contracts/source-mapping.sintetico-v1.json``) y ``manifiesto-demo.json`` con versión, corte,
hashes, conteos, importes y resultados esperados calculados desde los propios casos, nunca
desde la base ni desde la aplicación. No hay azar: cada importe y fecha está escrito abajo.

Reutiliza los formatos del generador de ALIGN-023 (``quality/fixtures/synthetic_portfolio.py``).
Ningún dato es real: documentos con prefijo 99, teléfonos 0000-555, correos example.invalid.

Uso desde la raíz del repositorio:
  python3 scripts/demo/cartera_demo.py --output database/demo/cartera-demo-v1          # regenerar
  python3 scripts/demo/cartera_demo.py --check database/demo/cartera-demo-v1           # comprobar
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VERSION = 'cartera-demo-v1'
CUTOFF = date(2026, 9, 30)
MAPPING = 'contracts/source-mapping.sintetico-v1.json'
CONTRACT = 'contracts/source-contract.v1.json'
FILES = ('cabecera.tsv', 'detalle.tsv')
MANIFEST = 'manifiesto-demo.json'
STATE_NAMES = {'10': 'PENDIENTE', '20': 'PAGADA', '30': 'ANULADA', '40': 'SUSPENDIDA'}


def _generator():
    spec = importlib.util.spec_from_file_location('synthetic_portfolio', ROOT / 'quality/fixtures/synthetic_portfolio.py')
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault('synthetic_portfolio', module)
    spec.loader.exec_module(module)
    return module


GEN = _generator()


@dataclass(frozen=True)
class Person:
    pid: int
    name: str
    document: str
    phone: str = ''
    mobile: str = ''
    email: str = ''


@dataclass(frozen=True)
class Debt:
    capital: str
    interest: str | None
    due: date
    state: str = '10'

    def total(self) -> Decimal:
        return Decimal(self.capital) + Decimal(self.interest or '0')


@dataclass(frozen=True)
class Case:
    cuenta: str
    tipo: str
    label: str
    relations: tuple[tuple[Person, str, str], ...]
    debts: tuple[Debt, ...]
    estado: str = 'Activo'
    optional_missing: bool = False
    notes: tuple[str, ...] = field(default_factory=tuple)
    flags: tuple[str, ...] = field(default_factory=tuple)  # banderas del validador (contrato v1)

    @property
    def clave(self) -> str:
        return f'{self.tipo}-{self.cuenta}'

    @property
    def identifier(self) -> str:
        return f'DEMO6-{self.tipo}-{self.cuenta}'


def person(n: int, *, phone=False, mobile=False, email=False, legal=False, placeholders=False) -> Person:
    kind = 'Entidad Demo' if legal else 'Persona Demo'
    base = Person(pid=96000 + n, name=f'{kind} {n:02d}', document=f'99-{96000000 + n:08d}-{n % 10}')
    if placeholders:
        return Person(base.pid, base.name, base.document, phone='0', mobile='-', email='NO POSEE')
    return Person(base.pid, base.name, base.document,
                  phone=f'0000-555-{6000 + n:04d}' if phone else '',
                  mobile=f'0000-15-555-{6000 + n:04d}' if mobile else '',
                  email=f'persona.demo.{n:02d}@example.invalid' if email else '')


def d(text: str) -> date:
    day, month, year = (int(part) for part in text.split('/'))
    return date(year, month, day)


P8 = person(8, phone=True, email=True)
CASES: tuple[Case, ...] = (
    Case('60001', '3', 'contacto-completo-mora-media', ((person(1, phone=True, mobile=True, email=True), '100', 'Titular'),),
         (Debt('180000.00', '36000.00', d('15/03/2025')), Debt('190000.00', '28500.00', d('15/07/2025')),
          Debt('200000.00', '20000.00', d('15/11/2025')))),
    Case('60002', '6', 'solo-email', ((person(2, email=True), '100', 'Titular'),),
         (Debt('45000.00', '9000.00', d('10/01/2026')), Debt('47000.00', '4700.00', d('10/04/2026')))),
    Case('60003', '1', 'importe-alto', ((person(3, phone=True), '100', 'Titular'),),
         (Debt('850000.00', '340000.00', d('20/02/2024')), Debt('900000.00', '270000.00', d('20/08/2024')),
          Debt('950000.00', '190000.00', d('20/02/2025')), Debt('1000000.00', '100000.00', d('20/08/2025')))),
    Case('60004', '3', 'sin-contacto', ((person(4), '100', 'Titular'),),
         (Debt('320000.00', '96000.00', d('05/05/2024')), Debt('340000.00', '68000.00', d('05/11/2024'))),
         notes=('sin teléfono, celular ni correo',), flags=('SIN_CONTACTO_UTILIZABLE',)),
    Case('60005', '6', 'contacto-no-utilizable', ((person(5, placeholders=True), '100', 'Titular'),),
         (Debt('38000.00', '3800.00', d('12/06/2026')),),
         notes=('marcadores 0, - y NO POSEE: no cuentan como contacto',),
         flags=('CONTACTO_NO_UTILIZABLE', 'SIN_CONTACTO_UTILIZABLE')),
    Case('60006', '1', 'dos-titulares', ((person(6, mobile=True), '50', 'Titular'), (person(7, email=True), '50', 'Cotitular')),
         (Debt('600000.00', '120000.00', d('30/09/2025')), Debt('620000.00', '62000.00', d('31/03/2026'))),
         flags=('MULTIPLES_PERSONAS',)),
    Case('60007', '3', 'persona-con-dos-objetos-1', ((P8, '100', 'Titular'),),
         (Debt('150000.00', '15000.00', d('01/02/2026')),)),
    Case('60008', '6', 'persona-con-dos-objetos-2', ((P8, '100', 'Titular'),),
         (Debt('52000.00', '5200.00', d('01/05/2026')), Debt('54000.00', '2700.00', d('01/08/2026')))),
    Case('60009', '3', 'vencimiento-antiguo', ((person(9, mobile=True), '100', 'Titular'),),
         (Debt('210000.00', '168000.00', d('10/03/2019')), Debt('220000.00', '154000.00', d('10/09/2019'))),
         notes=('más de cinco años de atraso al corte',)),
    Case('60010', '6', 'mora-reciente-baja', ((person(10, email=True), '100', 'Titular'),),
         (Debt('12000.00', '0.00', d('15/09/2026')),)),
    Case('60011', '3', 'vence-despues-del-corte', ((person(11, phone=True), '100', 'Titular'),),
         (Debt('260000.00', '0.00', d('15/11/2026')), Debt('260000.00', '0.00', d('15/12/2026'))),
         notes=('ninguna obligación vencida al corte',)),
    Case('60012', '6', 'estados-de-origen', ((person(12, email=True), '100', 'Titular'),),
         (Debt('40000.00', '8000.00', d('10/10/2025'), '20'), Debt('41000.00', '6150.00', d('10/01/2026'), '40'),
          Debt('42000.00', '4200.00', d('10/04/2026')))),
    Case('60013', '1', 'persona-juridica', ((person(13, phone=True, email=True, legal=True), '100', 'Responsable'),),
         (Debt('1500000.00', '450000.00', d('15/06/2025')),)),
    Case('60014', '3', 'datos-opcionales-faltantes', ((person(14, email=True), '', 'Titular'),),
         (Debt('175000.00', None, d('20/12/2025')), Debt('175000.00', None, d('20/06/2026'))),
         estado='', optional_missing=True,
         notes=('sin estado, porcentaje, intereses, capital de cabecera, períodos, fecha de actualización ni domicilio',),
         flags=('ESTADO_OBJETO_NO_INFORMADO', 'PORCENTAJE_FALTANTE')),
    Case('60015', '6', 'objeto-inactivo-en-origen', ((person(15, mobile=True), '100', 'Titular'),),
         (Debt('30000.00', '3000.00', d('01/03/2026')),), estado='Inactivo', flags=('OBJETO_INACTIVO_EN_ORIGEN',)),
)


def money(value: Decimal | str | None) -> str:
    return '' if value is None else GEN.money(Decimal(value))


def header_rows(cases=CASES) -> list[dict[str, str]]:
    rows = []
    for case in cases:
        capital = sum((Decimal(debt.capital) for debt in case.debts), Decimal(0))
        total = sum((debt.total() for debt in case.debts), Decimal(0))
        for index, (who, percent, role) in enumerate(case.relations, start=1):
            missing = case.optional_missing
            rows.append({
                'ClaveAgrupacion': case.clave, 'Bien_Tipo_Id': case.tipo, 'Bien_Tipo': GEN.BIEN_TIPOS[case.tipo],
                'Cuenta': case.cuenta, 'Identificador': case.identifier,
                'Bien_Descripcion': f"{GEN.DESCRIPCIONES[case.tipo]} (demo)", 'Estado': case.estado,
                'Tipo_Ingreso_Id': GEN.TIPO_INGRESO_POR_BIEN[case.tipo], 'Destinatario_Id': str(who.pid),
                'Destinatario': who.name, 'Destinatario_CUIT': who.document, 'Destinatario_Tipo': role,
                'Destinatario_Porcentaje': percent, 'Destinatario_Telefono': who.phone,
                'Destinatario_Celular': who.mobile, 'Destinatario_Email': who.email,
                'Destinatario_Calle': '' if missing else f'Calle Demo {who.pid % 97 + 1}',
                'Destinatario_Numeracion': '' if missing else str(who.pid % 900 + 100),
                'Destinatario_Piso': '', 'Destinatario_Depto': 'B' if index > 1 else '',
                'Destinatario_Localidad': '' if missing else f'Localidad Demo {who.pid % 7 + 1}',
                'Destinatario_CP': '' if missing else '0000', 'Destinatario_Provincia': '' if missing else 'Provincia Demo',
                'Deuda_Capital': '' if missing else money(capital), 'Deuda_Actualizada': money(total),
                'Periodos_Deuda': '' if missing else str(len(case.debts)),
                'Fecha_Actualizacion': '' if missing else GEN.day(CUTOFF - timedelta(days=1)),
            })
    return rows


def detail_rows(cases=CASES) -> list[dict[str, str]]:
    rows, next_id = [], 6000001
    for case in cases:
        for debt in case.debts:
            rows.append({
                'ClaveAgrupacion': case.clave, 'Bien_Tipo_Id': case.tipo, 'Cuenta': case.cuenta, 'DEUD_id': str(next_id),
                'Tipo_Ingreso_Id': GEN.TIPO_INGRESO_POR_BIEN[case.tipo],
                'Detalle_Deuda': f'Cuota {debt.due.month:02d}/{debt.due.year} (demo)',
                'NOTD_capital': money(debt.capital), 'NOTD_intereses': money(debt.interest),
                'NOTD_honorarios': '' if case.optional_missing else money('0'),
                'NOTD_totalActualizado': money(debt.total()), 'NOTD_vencimiento': GEN.day(debt.due),
                'NOTD_ESTA_id': debt.state, 'NOTD_SITU_id': '',
            })
            next_id += 1
    return rows


def encode(columns, rows) -> bytes:
    return GEN.encode_table(columns, rows, '\t', '\n').encode('utf-8')


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def dataset_digest(hashes: dict[str, str]) -> str:
    """Misma fórmula que el recibo de ALIGN-029: sha256 de 'tipo:hash' ordenado."""
    return sha256(''.join(f'{kind}:{hashes[kind]}\n' for kind in sorted(hashes)).encode())


def expected(cases=CASES) -> dict:
    debts = [(case, debt) for case in cases for debt in case.debts]
    total = sum((debt.total() for _, debt in debts), Decimal(0))
    by_state: dict[str, Decimal] = {}
    for _, debt in debts:
        by_state[STATE_NAMES[debt.state]] = by_state.get(STATE_NAMES[debt.state], Decimal(0)) + debt.total()
    usable = lambda who: any(value and value not in ('0', '-', 'NO POSEE') for value in (who.phone, who.mobile, who.email))
    people = {who.pid: who for case in cases for who, _, _ in case.relations}
    no_contact = [case.identifier for case in cases if not any(usable(who) for who, _, _ in case.relations)]
    overdue = [case.identifier for case in cases if any(debt.due < CUTOFF and debt.state == '10' for debt in case.debts)]
    by_type: dict[str, int] = {}
    for case in cases:
        by_type[GEN.BIEN_TIPOS[case.tipo]] = by_type.get(GEN.BIEN_TIPOS[case.tipo], 0) + 1
    return {
        'objetos': len(cases), 'obligaciones': len(debts), 'personas': len(people),
        'relaciones_objeto_persona': sum(len(case.relations) for case in cases),
        'objetos_por_tipo': dict(sorted(by_type.items())),
        'importe_total_actualizado_ars': str(total.quantize(Decimal('0.01'))),
        'importe_por_estado_de_origen_ars': {name: str(value.quantize(Decimal('0.01'))) for name, value in sorted(by_state.items())},
        'objetos_sin_contacto_utilizable': no_contact,
        'objetos_con_obligacion_pendiente_vencida_al_corte': overdue,
        'objetos_sin_obligacion_vencida_al_corte': [case.identifier for case in cases if case.identifier not in overdue],
        'validacion_esperada': {'resultado_lote': 'VALIDADO', 'publicacion_permitida': True, 'objetos_aceptados': len(cases),
                                'objetos_en_cuarentena': 0},
    }


def build() -> tuple[dict[str, bytes], dict]:
    files = {'cabecera.tsv': encode(GEN.CABECERA_COLUMNS, header_rows()),
             'detalle.tsv': encode(GEN.DETALLE_COLUMNS, detail_rows())}
    hashes = {name.removesuffix('.tsv'): sha256(data) for name, data in files.items()}
    manifest = {
        'version': VERSION,
        'generador': 'scripts/demo/cartera_demo.py',
        'semilla': None,
        'determinismo': 'Sin azar: casos, importes y fechas escritos en el generador.',
        'fecha_corte': CUTOFF.isoformat(),
        'municipio_etl': 'tenant 1 (back/ETL/config.py DEFAULT_TENANT_ID)',
        'perfil_mapeo': {'ruta': MAPPING, 'sha256': sha256((ROOT / MAPPING).read_bytes())},
        'contrato': {'ruta': CONTRACT, 'sha256': sha256((ROOT / CONTRACT).read_bytes())},
        'archivos': {name: {'sha256': sha256(data), 'bytes': len(data)} for name, data in files.items()},
        'dataset_sha256': dataset_digest(hashes),
        'casos': [{'identificador': case.identifier, 'clave': case.clave, 'tipo': GEN.BIEN_TIPOS[case.tipo], 'caso': case.label,
                   'obligaciones': len(case.debts), 'personas': len(case.relations),
                   'importe_actualizado_ars': str(sum((debt.total() for debt in case.debts), Decimal(0)).quantize(Decimal('0.01'))),
                   'banderas_esperadas': list(case.flags), 'notas': list(case.notes)} for case in CASES],
        'resultados_esperados': expected(),
        'origen_de_los_datos': 'Sintético. Ninguna persona, documento, teléfono ni correo pertenece a alguien.',
    }
    return files, manifest


def manifest_bytes(manifest: dict) -> bytes:
    return (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def write(output: Path) -> None:
    files, manifest = build()
    output.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        (output / name).write_bytes(data)
    (output / MANIFEST).write_bytes(manifest_bytes(manifest))


def check(folder: Path) -> list[str]:
    """Diferencias entre la carpeta y lo que genera este archivo (vacía si coinciden byte a byte)."""
    files, manifest = build()
    expected_files = {**files, MANIFEST: manifest_bytes(manifest)}
    problems = []
    for name, data in expected_files.items():
        path = folder / name
        if not path.is_file():
            problems.append(f'falta {name}')
        elif path.read_bytes() != data:
            problems.append(f'{name} difiere del generador')
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--output', type=Path)
    group.add_argument('--check', type=Path)
    args = parser.parse_args(argv)
    if args.output:
        write(args.output)
        print(f'{VERSION}: escrita en {args.output}')
        return 0
    problems = check(args.check)
    for problem in problems:
        print(problem, file=sys.stderr)
    print(f'{VERSION}: {"coincide" if not problems else "NO coincide"} con el generador')
    return 1 if problems else 0


if __name__ == '__main__':
    raise SystemExit(main())
