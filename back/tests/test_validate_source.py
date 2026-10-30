"""Contrato observable: oráculo independiente de ALIGN-023 y entradas adversas."""

import json
from pathlib import Path

from ETL.validate_source import load_contract, load_mapping, validate_batch

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = Path(__file__).parent / 'fixtures/sintetico-v1'
CONTRACT = ROOT / 'contracts/source-contract.v1.json'


def fixture_report():
    return validate_batch(
        {name: FIXTURE / f'{name}.tsv' for name in ('cabecera', 'detalle')},
        load_mapping(FIXTURE), load_contract(CONTRACT), '2026-09-30',
    )


def test_every_fixture_edge_matches_the_independent_oracle_once():
    expected = json.loads((FIXTURE / 'expected.json').read_text())['municipios']['municipio-sintetico-a']
    report = fixture_report()
    assert report['hallazgos'] == expected['hallazgos']
    assert len({tuple(f.values()) for f in report['hallazgos']}) == len(report['hallazgos'])
    for key, value in expected['conteos'].items():
        assert report['conteos'][key] == value, key
    for key, value in expected['importes'].items():
        assert report['importes'][key] == value, key
    assert len(report['objetos']) == len(expected['objetos'])
    for actual, oracle in zip(report['objetos'], expected['objetos'], strict=True):
        for key in ('resultado', 'motivos', 'banderas', 'obligaciones', 'importe_actualizado',
                    'importe_capital', 'estados_al_corte', 'vencimiento_mas_antiguo',
                    'dias_vencida_mas_antigua', 'suma_porcentajes', 'contactos_utilizables',
                    'contactos_inactivos'):
            assert actual[key] == oracle[key], (oracle['caso'], key)


def test_physical_rows_have_a_single_outcome_and_whole_objects_are_quarantined():
    report = fixture_report()
    for counts in report['filas'].values():
        assert counts['leidas'] == counts['aceptadas'] + counts['rechazadas']
        assert sum(counts['rechazadas_por_codigo'].values()) == counts['rechazadas']
    objects = {obj['referencia']: obj for obj in report['objetos']}
    for row in report['decisiones_filas']:
        if row['objeto'] and objects[row['objeto']]['resultado'] == 'CUARENTENA':
            assert row['resultado'] == 'RECHAZADA'
    assert report['importes']['actualizado_en_cuarentena_observado'] == '202712.94'
