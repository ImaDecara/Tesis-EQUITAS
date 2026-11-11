"""Coherencia de la trazabilidad académica ALIGN-039 (docs/tesis/trazabilidad-academica.md).

Verifica, solo con el documento y el repositorio, que las citas de la tesis estén en rango, que los
enlaces relativos resuelvan y que las tablas de la matriz (por ticket, por requisito y por objetivo)
y los estados citados en el texto sean coherentes entre sí. Si EQUITAS_PLAN_PKG apunta al paquete
del plan (fuera de git), también compara la matriz con el frontmatter congelado de los tickets y
comprueba que existan las rutas de evidencia citadas.
"""

import os
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOC = ROOT / 'docs/tesis/trazabilidad-academica.md'
TICKET_IDS = {f'ALIGN-{i:03d}' for i in range(1, 72)} - {'ALIGN-049'}
STATUSES = {'PLANNED', 'READY', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'BLOCKED', 'DEFERRED'}
EXISTING = {f'R{i:02d}' for i in range(1, 29)}
PROPOSED = {f'R{i:02d}' for i in range(29, 39)}
STATUS_REF = re.compile(r'\b(\d{3}) (' + '|'.join(sorted(STATUSES)) + r')\b')
MARKERS = ('MATRIZ-OBJETIVOS', 'MATRIZ-REQUISITOS', 'MATRIZ-TICKETS')


def text() -> str:
    return DOC.read_text(encoding='utf-8')


def block(name: str) -> str:
    match = re.search(rf'<!-- {name}:INICIO -->\n(.*?)<!-- {name}:FIN -->', text(), re.DOTALL)
    if not match:
        raise AssertionError(f'Falta el bloque {name}')
    return match.group(1)


def rows(name: str) -> list[list[str]]:
    lines = [line for line in block(name).splitlines() if line.startswith('|')]
    return [[cell.strip() for cell in line.strip('|').split('|')] for line in lines[2:]]


def expand(cell: str) -> set[str]:
    """Requisitos de una celda; un rango 'R01–R28' se expande."""
    found = set()
    for start, end in re.findall(r'R(\d\d)–R(\d\d)', cell):
        found |= {f'R{i:02d}' for i in range(int(start), int(end) + 1)}
    return found | set(re.findall(r'R\d\d', re.sub(r'R\d\d–R\d\d', '', cell)))


def objectives(cell: str) -> set[int] | str:
    if cell == '1–8':
        return 'transversal'
    return {int(x) for x in re.findall(r'\d+', cell)}


def tickets() -> dict[str, dict[str, str]]:
    table = {}
    for ticket, milestone, tier, obj, req, status, evidence in rows('MATRIZ-TICKETS'):
        if ticket in table:
            raise AssertionError(f'{ticket} repetido en la matriz por ticket')
        table[ticket] = {'milestone': milestone, 'tier': tier, 'obj': obj, 'req': req,
                         'status': status, 'evidence': evidence}
    return table


def short_ids(cell: str) -> set[str]:
    return {f'ALIGN-{x}' for x in re.findall(r'\b(\d{3})\b', cell)}


class AcademicTraceabilityTests(unittest.TestCase):
    def test_tesis_citations_are_within_extracted_blocks(self):
        for kind, number in re.findall(r'\[(P|T01\.R|T02\.R)(\d{2,4})\]', text()):
            limit = {'P': 276, 'T01.R': 5, 'T02.R': 9}[kind]
            self.assertTrue(1 <= int(number) <= limit, f'[{kind}{number}] fuera de la extracción')
        self.assertEqual(set(re.findall(r'\[(T\d\d)[\].]', text())), {'T01', 'T02'})

    def test_relative_links_resolve_inside_repository(self):
        for link in re.findall(r'\]\(([^)#\s]+)(?:#[^)]*)?\)', text()):
            if re.match(r'[a-z]+://', link):
                continue
            target = (DOC.parent / link).resolve()
            self.assertTrue(target.exists(), link)
            self.assertIn(ROOT, target.parents, link)

    def test_ticket_matrix_lists_every_active_ticket_once_with_honest_evidence(self):
        table = tickets()
        self.assertEqual(set(table), TICKET_IDS)
        for ticket, row in table.items():
            self.assertIn(row['status'], STATUSES, ticket)
            evidence = row['evidence']
            if row['status'] == 'DONE':
                self.assertFalse(evidence.startswith(('Pendiente', 'Fuera')), ticket)
                self.assertRegex(evidence, r'`execution/evidence/' + ticket + r'/', ticket)
            else:
                self.assertTrue(evidence.startswith(('Pendiente', 'Fuera del alcance', 'Este documento')),
                                f'{ticket} sin evidencia debe figurar como pendiente')
            if row['tier'] == 'E':
                self.assertTrue(evidence.startswith('Fuera del alcance aprobado'), ticket)

    def test_requirement_matrix_matches_ticket_matrix(self):
        table = tickets()
        listed = rows('MATRIZ-REQUISITOS')
        self.assertEqual([row[0] for row in listed], sorted(EXISTING | PROPOSED))
        uncovered = set()
        for req, _name, _obj, cited, done_total in listed:
            explicit = {t for t, row in table.items() if '–' not in row['req'] and req in expand(row['req'])}
            self.assertEqual(set(re.findall(r'ALIGN-\d{3}', cited)), explicit, req)
            done = sum(table[t]['status'] == 'DONE' for t in explicit)
            self.assertEqual(done_total, f'{done} / {len(explicit)}', req)
            if not explicit:
                uncovered.add(req)
        self.assertFalse(uncovered & EXISTING, 'Todo requisito existente debe estar en algún ticket')
        note = next(line for line in text().splitlines() if 'no aparecen en el frontmatter de ningún ticket' in line)
        self.assertEqual(uncovered, set(re.findall(r'R\d\d', note.split('no aparecen')[0])))

    def test_objective_matrix_matches_ticket_and_requirement_matrices(self):
        table = tickets()
        req_objectives = {row[0]: row[2] for row in rows('MATRIZ-REQUISITOS')}
        listed = rows('MATRIZ-OBJETIVOS')
        self.assertEqual([row[0] for row in listed], [str(k) for k in range(1, 9)] + ['1–8 (transversales)'])
        for obj, reqs, i_tier, va_tier, out, done, ratio in listed[:-1]:
            k = int(obj)
            expected = {t for t, row in table.items() if objectives(row['obj']) != 'transversal' and k in objectives(row['obj'])}
            self.assertEqual(short_ids(i_tier) | short_ids(va_tier) | short_ids(out), expected, obj)
            groups = [short_ids(i_tier), short_ids(va_tier), short_ids(out)]
            self.assertEqual(sum(map(len, groups)), len(set().union(*groups)), f'{obj}: grupos superpuestos')
            self.assertEqual(short_ids(done), {t for t in expected if table[t]['status'] == 'DONE'}, obj)
            in_scope = short_ids(i_tier) | short_ids(va_tier)
            self.assertEqual(ratio, f'{sum(table[t]["status"] == "DONE" for t in in_scope)} / {len(in_scope)}', obj)
            from_reqs = {r for r, o in req_objectives.items() if o not in ('transv.', 'todos', '1–8') and k in objectives(o)}
            self.assertEqual(set(re.findall(r'R\d\d', reqs)), from_reqs, obj)
        transversal = {t for t, row in table.items() if objectives(row['obj']) == 'transversal'}
        self.assertEqual(short_ids(listed[-1][2]), transversal)

    def test_r02_table_covers_eight_objectives_with_method_and_criterion(self):
        lines = [line for line in block('R02').splitlines() if line.startswith('|')][2:]
        table = [[cell.strip() for cell in line.strip('|').split('|')] for line in lines]
        self.assertEqual([row[0] for row in table], [str(k) for k in range(1, 9)])
        for obj, statement, indicator, method, criterion, refs in table:
            self.assertRegex(statement, r'\[P0(189|19[0-6])\]', obj)
            self.assertRegex(statement, rf'\[T02\.R0{int(obj) + 1}\]', obj)
            self.assertIn('artificial', method, obj)
            self.assertIn('Naturalista', method, obj)
            self.assertTrue(indicator and criterion and refs, obj)

    def test_statuses_quoted_in_text_match_ticket_matrix(self):
        table = tickets()
        prose = text()
        for name in MARKERS:
            prose = prose.replace(block(name), '')
        quoted = STATUS_REF.findall(prose)
        self.assertGreater(len(quoted), 50)
        for number, status in quoted:
            self.assertEqual(table[f'ALIGN-{number}']['status'], status, f'ALIGN-{number}')

    def test_document_has_no_personal_data_patterns(self):
        patterns = {
            'email': r'[\w.+-]+@[\w-]+\.[\w.]+',
            'cuit': r'\b\d{2}-?\d{8}-?\d\b',
            'dni': r'\b\d{1,2}\.\d{3}\.\d{3}\b',
            'telefono': r'(\+54|\b0?351)[\s-]?\d{3,4}[\s-]?\d{4}\b',
        }
        for label, pattern in patterns.items():
            self.assertIsNone(re.search(pattern, text()), label)


@unittest.skipUnless(os.environ.get('EQUITAS_PLAN_PKG'), 'EQUITAS_PLAN_PKG no definido: paquete del plan fuera de git')
class PlanPackageCrossCheckTests(unittest.TestCase):
    def setUp(self):
        self.pkg = Path(os.environ['EQUITAS_PLAN_PKG'])
        self.assertTrue((self.pkg / 'TICKETS').is_dir(), self.pkg)

    def frontmatter(self, ticket: str) -> dict[str, str]:
        head = (self.pkg / 'TICKETS' / f'{ticket}.md').read_text(encoding='utf-8').split('---', 2)[1]
        return {key.strip(): value.strip().strip('"') for key, _, value in
                (line.partition(':') for line in head.strip().splitlines())}

    def test_matrix_matches_frozen_ticket_frontmatter(self):
        for ticket, row in tickets().items():
            meta = self.frontmatter(ticket)
            self.assertEqual(row['tier'], meta['scope_tier'], ticket)
            self.assertEqual(row['milestone'], meta['milestone'], ticket)
            self.assertEqual(expand(row['req']), expand(meta['requirements']), ticket)
            expected = objectives(meta['objectives']) if not meta['objectives'].startswith('1–8') else 'transversal'
            if meta['objectives'].startswith('—'):
                expected = set()
            self.assertEqual(objectives(row['obj']) if row['obj'] != '—' else set(), expected, ticket)

    def test_cited_plan_paths_exist(self):
        for path in set(re.findall(r'`((?:execution|TICKETS|SOURCES)/[^`*]+?)`', text())):
            if path.startswith('execution/evidence/ALIGN-039/') or '…' in path or '#' in path:
                continue
            self.assertTrue((self.pkg / path).exists(), path)
        for name in ('PLAN.md', 'TRACEABILITY.md', 'APPROVAL.json', 'PROPOSED-REQUIREMENTS-CHANGES.md'):
            self.assertTrue((self.pkg / name).exists(), name)


if __name__ == '__main__':
    unittest.main()
