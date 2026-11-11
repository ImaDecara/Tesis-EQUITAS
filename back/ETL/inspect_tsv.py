"""Entrada de compatibilidad: el inspector usa la misma validación que la API/CLI."""

import argparse
from pathlib import Path

from ETL.validate_source import (
    DEFAULT_CONTRACT,
    ValidationError,
    load_contract,
    load_mapping,
    render_markdown,
    validate_batch,
    write_report,
)


def _fields(kind, required):
    return {name: [name] for name, spec in load_contract()['archivos'][kind]['columnas'].items()
            if spec['requerida'] == required}


# Las columnas tienen una sola fuente, el contrato JSON, también para ALIGN-023.
CABECERA_REQUIRED_FIELDS = _fields('cabecera', True)
CABECERA_OPTIONAL_FIELDS = _fields('cabecera', False)
DETALLE_REQUIRED_FIELDS = _fields('detalle', True)
DETALLE_OPTIONAL_FIELDS = _fields('detalle', False)


def inspect_files(cabecera_path, detalle_path, *, mapping=None, contract=None, cut_off=None):
    mapping = mapping if mapping is not None else load_mapping(Path(cabecera_path).parent)
    report = validate_batch(
        {'cabecera': cabecera_path, 'detalle': detalle_path}, mapping,
        contract if contract is not None else load_contract(), cut_off or mapping['fecha_corte'],
    )
    print(render_markdown(report), end='')
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description='Inspección TSV con el contrato de origen v1.')
    parser.add_argument('--cabecera', type=Path, required=True)
    parser.add_argument('--detalle', type=Path, required=True)
    parser.add_argument('--cut-off', required=True)
    parser.add_argument('--contract', type=Path, default=DEFAULT_CONTRACT)
    parser.add_argument('--mapping', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args(argv)
    try:
        report = inspect_files(args.cabecera, args.detalle, cut_off=args.cut_off,
                               contract=load_contract(args.contract),
                               mapping=load_mapping(args.cabecera.parent, args.mapping))
        if args.output:
            write_report(report, args.output)
    except (ValidationError, OSError):
        print('VALIDACION_NO_EJECUTABLE: revisar contrato, mapeo, corte y archivos.')
        return 2
    return 1 if report['resultado_lote'] == 'BLOQUEADO' else 0


if __name__ == '__main__':
    raise SystemExit(main())
