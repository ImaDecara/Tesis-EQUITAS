"""Noche 7: coherencia de la matriz ADMIN/USER entre capas y de los lotes de ejemplo que se publican.

1. La misma tabla de permisos en Python (`back/api/auth.py::PERMISSIONS`), TypeScript
   (`front/lib/server/dal.ts::PERMISSIONS`) y SQL (`public.equitas_role_allows`). Se lee por texto: estas
   pruebas corren sin las dependencias de la API ni de Next.
2. `front/public/ejemplos/carga-csv/` es exactamente lo que escribe `scripts/local/cartera_ejemplo.py`.
"""

import ast
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUTH_PY = ROOT / 'back' / 'api' / 'auth.py'
DAL_TS = ROOT / 'front' / 'lib' / 'server' / 'dal.ts'
TENANT_ACCESS_TS = ROOT / 'front' / 'lib' / 'auth' / 'tenant-access.ts'
ACCESS_SQL = ROOT / 'supabase' / 'migrations' / '20261110100000_admin_user_access.sql'
EXAMPLES = ROOT / 'front' / 'public' / 'ejemplos' / 'carga-csv'
GENERATOR = ROOT / 'scripts' / 'local' / 'cartera_ejemplo.py'

OLD_ROLES = {'consulta', 'operador', 'supervisor', 'importador'}
MACHINE_IMPORTER = 'importador_sistema'
E06_COMPAT = 'tp_operator'


def python_permissions():
    tree = ast.parse(AUTH_PY.read_text(encoding='utf-8'))
    for node in tree.body:
        if isinstance(node, ast.AnnAssign) and getattr(node.target, 'id', None) == 'PERMISSIONS':
            return {key: set(roles) for key, roles in ast.literal_eval(node.value).items()}
    raise AssertionError('PERMISSIONS no está en back/api/auth.py')


def typescript_permissions():
    text = DAL_TS.read_text(encoding='utf-8')
    block = re.search(r'^const PERMISSIONS = \{\n(.*?)\n\} as const', text, re.MULTILINE | re.DOTALL)
    if block is None:
        raise AssertionError('Bloque PERMISSIONS no encontrado en dal.ts')
    compat = re.search(r"export const E06_READ_ONLY_COMPAT_ROLE = '(\w+)'", TENANT_ACCESS_TS.read_text(encoding='utf-8'))
    constants = {'E06_READ_ONLY_COMPAT_ROLE': compat.group(1)}
    body = re.sub(r'//[^\n]*', '', block.group(1))
    entries = re.findall(r"'([a-z]+:[a-z-]+)':\s*\[([^\]]*)\],?", body)
    # Cada fila de la tabla se leyó: nada quedó sin interpretar.
    leftover = re.sub(r"'([a-z]+:[a-z-]+)':\s*\[([^\]]*)\],?", '', body).strip()
    if leftover:
        raise AssertionError('Fila de PERMISSIONS no reconocida: ' + leftover)
    table = {}
    for key, items in entries:
        roles = set()
        for item in (part.strip() for part in items.split(',') if part.strip()):
            quoted = re.fullmatch(r"'([^']*)'", item)
            roles.add(quoted.group(1) if quoted else constants[item])
        table[key] = roles
    return table


def sql_permissions():
    text = ACCESS_SQL.read_text(encoding='utf-8')
    function = re.search(
        r'create function public\.equitas_role_allows\(p_role text, p_capability text\).*?\$\$(.*?)\$\$',
        text, re.DOTALL)
    if function is None:
        raise AssertionError('equitas_role_allows no encontrada')
    body = function.group(1)
    table = {}
    for capability, condition in re.findall(r"when '([A-Z_]+)' then (p_role [^\n]+?)\s*\n", body):
        single = re.fullmatch(r"p_role = '([^']+)'", condition)
        many = re.fullmatch(r"p_role in \(([^)]*)\)", condition)
        if single:
            table[capability] = {single.group(1)}
        elif many:
            table[capability] = set(re.findall(r"'([^']+)'", many.group(1)))
        else:
            raise AssertionError('Condición no reconocida: ' + condition)
    if not re.search(r'else false\s+end, false\)', body):
        raise AssertionError('Una capacidad desconocida debe negarse')
    return table, body


class AccessParityTests(unittest.TestCase):
    def setUp(self):
        self.python = python_permissions()
        self.typescript = typescript_permissions()
        self.sql, self.sql_body = sql_permissions()

    def test_import_is_admin_in_the_three_layers_and_the_machine_identity_only_in_sql(self):
        self.assertEqual(self.python['import:write'], {'ADMIN'})
        self.assertEqual(self.typescript['import:write'], {'ADMIN'})
        self.assertEqual(self.sql['IMPORT_WRITE'], {'ADMIN', MACHINE_IMPORTER})
        self.assertEqual(self.sql['IMPORT_WRITE'] - self.typescript['import:write'], {MACHINE_IMPORTER})
        for table in (self.python, self.typescript):
            self.assertFalse(any(MACHINE_IMPORTER in roles for roles in table.values()))

    def test_new_functions_that_write_or_supervise_are_admin_only(self):
        for capability in ('DECISION_RECORD', 'DECISION_APPROVE', 'REASON_TEXT_READ', 'AUDIT_READ'):
            self.assertEqual(self.sql[capability], {'ADMIN'}, capability)
        for permission in ('decision:record', 'decision:approve', 'supervision:read', 'audit:read'):
            self.assertEqual(self.typescript[permission], {'ADMIN'}, permission)
        self.assertEqual(set(self.sql), {'DECISION_RECORD', 'DECISION_APPROVE', 'REASON_TEXT_READ', 'AUDIT_READ',
                                         'IMPORT_WRITE'})

    def test_reading_the_portfolio_is_admin_and_user(self):
        self.assertEqual(self.python['portfolio:read'], {'ADMIN', 'USER'})
        self.assertEqual(self.typescript['portfolio:read'], {'ADMIN', 'USER', E06_COMPAT})
        # La compatibilidad E06 solo lee cartera.
        self.assertEqual([key for key, roles in self.typescript.items() if E06_COMPAT in roles], ['portfolio:read'])
        self.assertEqual(set(self.python), {'portfolio:read', 'import:write'})

    def test_old_role_names_grant_nothing_anywhere(self):
        for layer in (self.python, self.typescript, self.sql):
            for key, roles in layer.items():
                self.assertFalse(roles & OLD_ROLES, key)
                self.assertTrue(roles <= {'ADMIN', 'USER', E06_COMPAT, MACHINE_IMPORTER}, key)
        for name in OLD_ROLES:
            self.assertNotIn(f"'{name}'", self.sql_body)

    def test_role_names_are_exact(self):
        self.assertNotIn('lower(', self.sql_body.lower())
        self.assertNotIn('ilike', self.sql_body.lower())


class ExampleLotsTests(unittest.TestCase):
    def check(self, folder):
        return subprocess.run([sys.executable, str(GENERATOR), '--check', str(folder)], cwd=ROOT,
                              capture_output=True, text=True, timeout=120, check=False)

    def test_published_examples_match_the_generator(self):
        done = self.check(EXAMPLES)
        self.assertEqual(done.returncode, 0, done.stderr)

    def test_an_extra_file_in_the_published_folder_is_detected(self):
        with tempfile.TemporaryDirectory() as temporary:
            copy = Path(temporary) / 'carga-csv'
            shutil.copytree(EXAMPLES, copy)
            self.assertEqual(self.check(copy).returncode, 0)
            (copy / '1-cartera-2026-09-30' / 'notas.txt').write_text('sobra\n', encoding='utf-8')
            done = self.check(copy)
            self.assertNotEqual(done.returncode, 0)
            self.assertIn('notas.txt no es un archivo generado', done.stderr)

    def test_a_changed_file_is_detected(self):
        with tempfile.TemporaryDirectory() as temporary:
            copy = Path(temporary) / 'carga-csv'
            shutil.copytree(EXAMPLES, copy)
            detalle = copy / '3-cartera-2026-10-31' / 'detalle.csv'
            detalle.write_bytes(detalle.read_bytes() + b'\n')
            self.assertNotEqual(self.check(copy).returncode, 0)


if __name__ == '__main__':
    unittest.main()
