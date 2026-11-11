"""Lotes CSV de ejemplo para «Cargar CSV» (noche 7): sintéticos, chicos y deterministas.

Escribe tres lotes en el formato del perfil ``contracts/source-mapping.sintetico-csv.v1.json`` (dos archivos por
lote: ``cabecera.csv`` y ``detalle.csv``) y un ``manifiesto.json`` con los resultados esperados, calculados desde
los propios casos y nunca desde la base ni desde la aplicación:

  1-cartera-2026-09-30               lote válido: la cartera de la demo más los casos chicos de cálculo
  2-cartera-2026-10-31-con-errores   la cartera de octubre con errores a propósito: se rechaza y no cambia nada
  3-cartera-2026-10-31               la misma cartera de octubre corregida: fecha posterior, entra

Reutiliza los casos y formatos de ``scripts/demo/cartera_demo.py`` (los mismos objetos DEMO6-*). No hay azar.
Ningún dato es real: documentos con prefijo 99, teléfonos 0000-555, correos example.invalid.

Uso desde la raíz del repositorio:
  python3 scripts/local/cartera_ejemplo.py --output front/public/ejemplos/carga-csv     # regenerar
  python3 scripts/local/cartera_ejemplo.py --check front/public/ejemplos/carga-csv      # comprobar
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
from dataclasses import replace
from datetime import date
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAPPING = 'contracts/source-mapping.sintetico-csv.v1.json'
MANIFEST = 'manifiesto.json'
FIRST, SECOND = date(2026, 9, 30), date(2026, 10, 31)
LOTS = ('1-cartera-2026-09-30', '2-cartera-2026-10-31-con-errores', '3-cartera-2026-10-31')
PAID = '20'


def _demo():
    spec = importlib.util.spec_from_file_location('cartera_demo', ROOT / 'scripts/demo/cartera_demo.py')
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault('cartera_demo', module)
    spec.loader.exec_module(module)
    return module


DEMO = _demo()
GEN, Case, Debt, person, d = DEMO.GEN, DEMO.Case, DEMO.Debt, DEMO.person, DEMO.d

# Casos chicos de cálculo (encargo §9.5) que el cargador acepta. «Sin importe» no puede estar en un lote válido:
# el contrato de origen bloquea el lote cuando falta un importe. «Sin vencimiento» queda en cuarentena.
SMALL_CASES = (
    Case('60016', '6', 'solo-pagadas', ((person(16, email=True), '100', 'Titular'),),
         (Debt('30000.00', '3000.00', d('10/02/2026'), PAID), Debt('31000.00', '1550.00', d('10/05/2026'), PAID)),
         notes=('todas las obligaciones pagadas: deuda pendiente 0 y ninguna vencida',)),
    Case('60017', '3', 'vencida-con-importe-cero', ((person(17, phone=True), '100', 'Titular'),),
         (Debt('0.00', '0.00', d('15/05/2026')),),
         notes=('vencimiento anterior a la fecha de la cartera e importe cero: no cuenta como vencida',)),
    Case('60018', '6', 'estado-ausente', ((person(18, mobile=True), '100', 'Titular'),),
         (Debt('64000.00', '6400.00', d('20/03/2026'), ''),),
         notes=('sin estado de origen: se computa por importe y vencimiento',)),
    Case('60019', '3', 'sin-vencimiento', ((person(19, email=True), '100', 'Titular'),),
         (Debt('9000.00', '0.00', None),),
         notes=('sin fecha de vencimiento: el objeto queda en cuarentena y no se publica',)),
    Case('60020', '6', 'anulada-en-origen', ((person(20, phone=True, email=True), '100', 'Titular'),),
         (Debt('25000.00', '2500.00', d('05/04/2026'), '30'), Debt('26000.00', '1300.00', d('05/07/2026'))),
         notes=('una obligación anulada en origen (Cancelada): se computa por importe y vencimiento, como antes',)),
)
QUARANTINED = ('60019',)
FIRST_CASES = (*DEMO.CASES, *SMALL_CASES)


def _with_debts(case, debts):
    return replace(case, debts=tuple(debts))


def second_cases():
    """La cartera un mes después: mismos objetos y obligaciones (el lote es la cartera completa), con novedades."""
    cases = []
    for case in FIRST_CASES:
        debts = list(case.debts)
        if case.cuenta == '60010':    # se pagó la única cuota
            debts[0] = replace(debts[0], state=PAID)
        if case.cuenta == '60002':    # una cuota nueva, vencida en octubre
            debts.append(Debt('49000.00', '2450.00', d('10/10/2026')))
        if case.cuenta == '60001':    # los intereses de la última cuota se actualizaron
            debts[2] = replace(debts[2], interest='24000.00')
        cases.append(_with_debts(case, debts))
    cases.append(Case('60021', '1', 'objeto-nuevo-en-octubre', ((person(21, phone=True, mobile=True), '100', 'Titular'),),
                      (Debt('480000.00', '48000.00', d('01/08/2026')), Debt('490000.00', '24500.00', d('01/10/2026')))))
    return tuple(cases)


SECOND_CASES = second_cases()
# Errores a propósito del lote 2: (archivo, cuenta, índice de la obligación o del titular, columna, valor, código esperado).
ERRORS = (
    ('detalle', '60001', 0, 'NOTD_vencimiento', '31/02/2025', 'FECHA_IMPOSIBLE'),
    ('detalle', '60003', 1, 'NOTD_totalActualizado', '1170000.00', 'IMPORTE_NO_NUMERICO'),
    ('detalle', '60008', 0, 'NOTD_ESTA_id', '99', 'ESTADO_ORIGEN_DESCONOCIDO'),
    ('cabecera', '60013', 0, 'Destinatario_Porcentaje', '150', 'PORCENTAJE_INVALIDO'),
    ('cabecera', '60015', 0, 'Bien_Tipo_Id', '9', 'TIPO_BIEN_FUERA_DE_CATALOGO'),
)


def debt_id(case, index: int) -> str:
    """Estable entre lotes: la misma obligación conserva su identificador aunque se agreguen otras."""
    return str(7_000_000 + (int(case.cuenta) - 60_000) * 100 + index + 1)


def header_rows(cases) -> list[dict[str, str]]:
    return DEMO.header_rows(cases)


def detail_rows(cases) -> list[dict[str, str]]:
    rows = []
    for case in cases:
        for index, debt in enumerate(case.debts):
            rows.append({
                'ClaveAgrupacion': case.clave, 'Bien_Tipo_Id': case.tipo, 'Cuenta': case.cuenta, 'DEUD_id': debt_id(case, index),
                'Tipo_Ingreso_Id': GEN.TIPO_INGRESO_POR_BIEN[case.tipo],
                'Detalle_Deuda': f'Cuota {debt.due.month:02d}/{debt.due.year} (demo)' if debt.due else 'Cuota sin vencimiento (demo)',
                'NOTD_capital': DEMO.money(debt.capital), 'NOTD_intereses': DEMO.money(debt.interest),
                'NOTD_honorarios': '' if case.optional_missing else DEMO.money('0'),
                'NOTD_totalActualizado': DEMO.money(debt.total()), 'NOTD_vencimiento': GEN.day(debt.due) if debt.due else '',
                'NOTD_ESTA_id': debt.state, 'NOTD_SITU_id': '',
            })
    return rows


def with_errors(cases) -> tuple[list[dict[str, str]], list[dict[str, str]], list[dict]]:
    header, detail = header_rows(cases), detail_rows(cases)
    applied = []
    for kind, cuenta, index, column, value, code in ERRORS:
        rows = header if kind == 'cabecera' else detail
        matches = [n for n, row in enumerate(rows) if row['Cuenta'] == cuenta]
        position = matches[index]
        rows[position][column] = value
        # Línea física del archivo: el encabezado es la línea 1.
        applied.append({'archivo': kind, 'linea': position + 2, 'columna': column, 'codigo': code,
                        'identificador': f'DEMO6-{next(c.tipo for c in cases if c.cuenta == cuenta)}-{cuenta}'})
    return header, detail, applied


def encode(columns, rows) -> bytes:
    return GEN.encode_table(columns, rows, ',', '\n').encode('utf-8')


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def money(value: Decimal) -> str:
    return str(value.quantize(Decimal('0.01')))


def case_expectation(case, cutoff: date) -> dict:
    """Definiciones del encargo §9.3, a mano desde el caso: total registrado, deuda pendiente y deuda vencida."""
    pending = [debt for debt in case.debts if debt.state != PAID]
    overdue = [debt for debt in pending if debt.total() > 0 and debt.due is not None and debt.due < cutoff]
    return {
        'identificador': case.identifier, 'caso': case.label, 'obligaciones': len(case.debts), 'titulares': len(case.relations),
        'total_registrado_ars': money(sum((debt.total() for debt in case.debts), Decimal(0))),
        'deuda_pendiente_ars': money(sum((debt.total() for debt in pending), Decimal(0))),
        'obligaciones_pagadas': len(case.debts) - len(pending),
        'obligaciones_vencidas': len(overdue),
        'deuda_vencida_ars': money(sum((debt.total() for debt in overdue), Decimal(0))),
        'atraso_maximo_dias': max(((cutoff - debt.due).days for debt in overdue), default=None),
        'notas': list(case.notes),
    }


def lot_expectation(cases, cutoff: date) -> dict:
    published = [case for case in cases if case.cuenta not in QUARANTINED]
    rows = [case_expectation(case, cutoff) for case in published]
    total = lambda key: money(sum((Decimal(row[key]) for row in rows), Decimal(0)))  # noqa: E731
    return {
        'fecha_corte': cutoff.isoformat(), 'objetos_en_el_archivo': len(cases), 'objetos_publicados': len(published),
        'objetos_en_cuarentena': [f'DEMO6-{case.tipo}-{case.cuenta}' for case in cases if case.cuenta in QUARANTINED],
        'obligaciones_publicadas': sum(len(case.debts) for case in published),
        'personas': len({who.pid for case in published for who, _, _ in case.relations}),
        'total_registrado_ars': total('total_registrado_ars'), 'deuda_pendiente_ars': total('deuda_pendiente_ars'),
        'deuda_vencida_ars': total('deuda_vencida_ars'),
        'objetos_con_deuda_vencida': sum(1 for row in rows if row['obligaciones_vencidas'] > 0),
        'casos': rows,
    }


def build() -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    error_header, error_detail, applied = with_errors(SECOND_CASES)
    tables = {
        LOTS[0]: (header_rows(FIRST_CASES), detail_rows(FIRST_CASES)),
        LOTS[1]: (error_header, error_detail),
        LOTS[2]: (header_rows(SECOND_CASES), detail_rows(SECOND_CASES)),
    }
    for lot, (header, detail) in tables.items():
        files[f'{lot}/cabecera.csv'] = encode(GEN.CABECERA_COLUMNS, header)
        files[f'{lot}/detalle.csv'] = encode(GEN.DETALLE_COLUMNS, detail)
    manifest = {
        'version': 'ejemplos-carga-csv-v1',
        'generador': 'scripts/local/cartera_ejemplo.py',
        'determinismo': 'Sin azar: casos, importes y fechas escritos en el generador.',
        'perfil_de_formato': {'ruta': MAPPING, 'sha256': sha256((ROOT / MAPPING).read_bytes())},
        'origen_de_los_datos': 'Sintético. Ninguna persona, documento, teléfono ni correo pertenece a alguien.',
        'definiciones': {
            'total_registrado': 'importe de todas las obligaciones, cualquiera sea su estado',
            'deuda_pendiente': 'suma de las obligaciones no pagadas',
            'deuda_vencida': 'obligaciones no pagadas con importe mayor que cero y vencimiento anterior a la fecha de la cartera',
        },
        'lotes': {
            LOTS[0]: {'resultado_esperado': 'se carga', **lot_expectation(FIRST_CASES, FIRST)},
            LOTS[1]: {'resultado_esperado': 'se rechaza: más del 5 % de los objetos con errores; la cartera anterior queda intacta',
                      'fecha_corte': SECOND.isoformat(), 'errores_a_proposito': applied},
            LOTS[2]: {'resultado_esperado': 'se carga como cartera con fecha posterior', **lot_expectation(SECOND_CASES, SECOND)},
        },
        'archivos': {name: {'sha256': sha256(data), 'bytes': len(data)} for name, data in sorted(files.items())},
    }
    files[MANIFEST] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    return files


def write(output: Path) -> None:
    for name, data in build().items():
        path = output / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)


def check(folder: Path) -> list[str]:
    """Diferencias entre la carpeta y lo que genera este archivo (vacía si coinciden byte a byte)."""
    expected = build()
    problems = []
    for name, data in expected.items():
        path = folder / name
        if not path.is_file():
            problems.append(f'falta {name}')
        elif path.read_bytes() != data:
            problems.append(f'{name} difiere del generador')
    # La carpeta se publica con la aplicación: no puede contener nada que este generador no haya escrito.
    if folder.is_dir():
        for path in sorted(folder.rglob('*')):
            if path.is_file() and path.relative_to(folder).as_posix() not in expected:
                problems.append(f'{path.relative_to(folder).as_posix()} no es un archivo generado: sobra')
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--output', type=Path)
    group.add_argument('--check', type=Path)
    args = parser.parse_args(argv)
    if args.output:
        write(args.output)
        print(f'Lotes de ejemplo escritos en {args.output}')
        return 0
    problems = check(args.check)
    for problem in problems:
        print(problem, file=sys.stderr)
    print(f'Lotes de ejemplo: {"coinciden" if not problems else "NO coinciden"} con el generador')
    return 1 if problems else 0


if __name__ == '__main__':
    raise SystemExit(main())
