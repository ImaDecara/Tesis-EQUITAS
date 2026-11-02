"""ALIGN-022. El validador no acepta faltantes, omitidos ni destinos prohibidos. Solo stdlib y sin red.

Desde la raiz: back/.venv/bin/python -m unittest database/testing/test_review_integration.py
"""
import base64
import json
import re
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest import mock

from database.testing import review_integration as runner

SHA = 'a' * 40
CAMPAIGN = runner.CAMPAIGNS['review']
ORIGINAL = runner.FIXTURE['original_project_ref']
TESTING = runner.FIXTURE['project_ref']
HTTP_BASE = 'http://127.0.0.1:32222'


def fake_jwt(role):
    encode = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b'=').decode()
    return f"{encode({'alg': 'HS256'})}.{encode({'role': role})}.firma-sintetica"


def local_config(**overrides):
    config = {
        'supabaseUrl': 'http://127.0.0.1:54321',
        'publishableKey': 'sb_publishable_sintetica',
        'reviewJwt': fake_jwt('equitas_review_server'),
        'importJwt': fake_jwt('equitas_import_server'),
        'jwtSecret': 'secreto-sintetico-de-prueba-unitaria',
        'accounts': {label: {'email': f'tp-{label}@example.test', 'password': f'clave-privada-{label}'}
                     for label in runner.REQUIRED_ACCOUNTS},
    }
    config.update(overrides)
    return config


def complete_report(**overrides):
    cases = [{'name': f'{case}: variante', 'status': 'passed', 'duration_ms': 1} for case in sorted(CAMPAIGN.required_cases)]
    report = {
        'campaign': CAMPAIGN.name, 'ticket': CAMPAIGN.ticket, 'source_sha': SHA, 'worktree_clean': True,
        'test_source_sha256': 'b' * 64, 'passed': True, 'exit_code': 0, 'report_errors': [],
        'environment': {'target': 'local', 'supabase_url': 'http://127.0.0.1:54321', 'http_base': HTTP_BASE,
                        'project_ref': None, 'build_sha': SHA},
        'tests': {'passed': len(cases), 'failed': 0, 'skipped': 0}, 'cases': cases,
    }
    report.update(overrides)
    return report


def without(report, position):
    cases = [case for index, case in enumerate(report['cases']) if index != position]
    return {**report, 'cases': cases, 'tests': {**report['tests'], 'passed': len(cases)}}


class TargetValidationTests(unittest.TestCase):
    def accept(self, config=None, http_base=HTTP_BASE, env=None):
        return runner.validate_target(json.dumps(config or local_config()), http_base, env or {})

    def reject(self, raw, http_base=HTTP_BASE, env=None):
        with self.assertRaises(ValueError) as result:
            runner.validate_target(raw, http_base, env or {})
        return str(result.exception)

    def test_accepts_only_the_loopback_stack(self):
        self.assertEqual(self.accept()['supabaseUrl'], 'http://127.0.0.1:54321')
        self.assertEqual(self.accept(local_config(supabaseUrl='http://localhost:54321'))['supabaseUrl'], 'http://localhost:54321')
        self.assertEqual(self.accept(local_config(supabaseUrl='http://[::1]:54321'))['supabaseUrl'], 'http://[::1]:54321')

    def test_missing_or_malformed_config_is_rejected_without_echoing_it(self):
        for raw in (None, '', 'clave-privada-sin-json', '[]', '{"password":"clave-privada"}'):
            with self.subTest(raw=bool(raw)):
                self.assertNotIn('clave-privada', self.reject(raw))

    def test_original_and_testing_are_rejected_by_url(self):
        for ref in (ORIGINAL, TESTING):
            with self.subTest(ref='prohibido'):
                message = self.reject(json.dumps(local_config(supabaseUrl=f'https://{ref}.supabase.co')))
                self.assertIn('prohibido', message)
                self.assertNotIn(ref, message)

    def test_original_and_testing_are_rejected_by_project_ref(self):
        for field in ('project_ref', 'projectRef'):
            for ref in (ORIGINAL, TESTING):
                with self.subTest(field=field):
                    message = self.reject(json.dumps(local_config(**{field: ref})))
                    self.assertIn('prohibido', message)
                    self.assertNotIn(ref, message)

    def test_any_declared_project_ref_is_rejected(self):
        self.assertIn('project_ref', self.reject(json.dumps(local_config(project_ref='otroproyectoremoto12'))))

    def test_prohibited_reference_anywhere_in_the_config_is_rejected(self):
        for config in (local_config(nota=f'copiado de {ORIGINAL}'),
                       local_config(publishableKey=f'sb_publishable_{TESTING}'),
                       local_config(accounts={'a': {'email': f'{ORIGINAL}@example.test', 'password': 'x'}})):
            with self.subTest():
                self.assertIn('prohibido', self.reject(json.dumps(config)))

    def test_prohibited_reference_in_an_auxiliary_variable_is_rejected(self):
        for value in (ORIGINAL, f'https://{TESTING}.supabase.co', 'https://cualquiera.supabase.co'):
            with self.subTest():
                message = self.reject(json.dumps(local_config()), env={'VARIABLE_AUXILIAR': value})
                self.assertIn('VARIABLE_AUXILIAR', message)
                self.assertNotIn(value, message)

    def test_other_hosts_schemes_and_disguises_are_rejected(self):
        for url in ('https://127.0.0.1:54321', 'http://example.org:54321', 'http://127.0.0.1.nip.io:54321',
                    'http://localhost.example.org:54321', 'http://usuario:clave@127.0.0.1:54321',
                    'http://127.0.0.1:54321/rest/v1', 'http://127.0.0.1:54321?x=1', 'http://0.0.0.0:54321',
                    'http://10.0.0.1:54321', '127.0.0.1:54321', '', None, 54321):
            with self.subTest(url=url):
                self.reject(json.dumps(local_config(supabaseUrl=url)))

    def test_http_base_must_be_loopback(self):
        for base in (None, '', 'https://127.0.0.1:32222', 'http://example.org:32222', 'http://127.0.0.1:32222/ruta',
                     f'https://{ORIGINAL}.supabase.co'):
            with self.subTest(base=bool(base)):
                self.reject(json.dumps(local_config()), http_base=base)

    def test_administrative_or_foreign_credentials_are_rejected(self):
        for field, value in (('publishableKey', 'sb_secret_no-usar'), ('publishableKey', ''),
                             ('reviewJwt', fake_jwt('service_role')), ('importJwt', fake_jwt('service_role')),
                             ('reviewJwt', fake_jwt('equitas_import_server')), ('reviewJwt', 'no-es-un-jwt')):
            with self.subTest(field=field):
                self.reject(json.dumps(local_config(**{field: value})))

    def test_all_synthetic_accounts_are_required(self):
        config = local_config()
        for label in runner.REQUIRED_ACCOUNTS:
            accounts = {key: value for key, value in config['accounts'].items() if key != label}
            with self.subTest(label=label):
                self.assertIn(label, self.reject(json.dumps({**config, 'accounts': accounts})))
        real = {**config['accounts'], 'operador': {'email': 'persona@municipio.example', 'password': 'x'}}
        self.assertIn('operador', self.reject(json.dumps({**config, 'accounts': real})))

    def test_errors_never_contain_secret_values(self):
        message = self.reject(json.dumps(local_config(supabaseUrl='http://example.org')))
        for secret in ('clave-privada', 'secreto-sintetico', 'firma-sintetica'):
            self.assertNotIn(secret, message)


class ReportValidationTests(unittest.TestCase):
    def reject(self, report, **kwargs):
        with self.assertRaises(ValueError) as result:
            runner.validate_report(report, CAMPAIGN, **kwargs)
        return str(result.exception)

    def test_complete_report_is_accepted(self):
        runner.validate_report(complete_report(), CAMPAIGN, sha=SHA)

    def test_missing_case_is_rejected_and_named(self):
        report = complete_report()
        lost = report['cases'][0]['name'].split(':')[0]
        message = self.reject(without(report, 0))
        self.assertIn('Faltan', message)
        self.assertIn(lost, message)

    def test_empty_inventory_is_rejected(self):
        self.assertIn('Faltan', self.reject(complete_report(cases=[], tests={'passed': 0, 'failed': 0, 'skipped': 0})))

    def test_omitted_cases_are_rejected_in_every_form(self):
        for status in ('skipped', 'pending', 'todo', 'disabled', 'focused', '', None):
            report = complete_report()
            report['cases'][3]['status'] = status
            report['tests'] = {'passed': len(report['cases']) - 1, 'failed': 0, 'skipped': 1}
            with self.subTest(status=status):
                self.assertIn(report['cases'][3]['name'].split(':')[0], self.reject(report))

    def test_omission_declared_only_in_the_counts_is_rejected(self):
        report = complete_report()
        for tests in ({**report['tests'], 'skipped': 1}, {**report['tests'], 'failed': 1},
                      {**report['tests'], 'passed': report['tests']['passed'] - 1}, {}, None, 'todo bien'):
            with self.subTest(tests=tests):
                self.assertIn('conteos', self.reject({**report, 'tests': tests}))

    def test_failed_case_is_rejected(self):
        report = complete_report()
        report['cases'][5]['status'] = 'failed'
        self.assertIn(report['cases'][5]['name'].split(':')[0], self.reject(report))

    def test_duplicate_extra_and_unnamed_cases_are_rejected(self):
        report = complete_report()
        first = report['cases'][0]
        self.assertIn('duplicado', self.reject(complete_report(cases=[*report['cases'], dict(first)])))
        extra = {'name': 'REV-XXX-99: fuera de inventario', 'status': 'passed'}
        self.assertIn('REV-XXX-99', self.reject(complete_report(cases=[*report['cases'], extra])))
        for bad in ({'name': 'sin identificador', 'status': 'passed'}, {'name': None, 'status': 'passed'},
                    {'status': 'passed'}, 'REV-ENV-01', None):
            with self.subTest(bad=bad):
                self.assertIn('identificador', self.reject(complete_report(cases=[*report['cases'], bad])))
        self.assertIn('cases', self.reject(complete_report(cases='todos')))

    def test_prohibited_destination_is_rejected_by_url_and_project_ref(self):
        for ref in (ORIGINAL, TESTING):
            environment = complete_report()['environment']
            for change in ({'project_ref': ref}, {'supabase_url': f'https://{ref}.supabase.co'},
                           {'http_base': f'https://{ref}.supabase.co'}, {'nota': ref}):
                with self.subTest(change=sorted(change)):
                    message = self.reject(complete_report(environment={**environment, **change}))
                    self.assertIn('prohibido', message)
                    self.assertNotIn(ref, message)

    def test_non_local_environment_is_rejected(self):
        environment = complete_report()['environment']
        for change in ({'target': 'testing'}, {'target': None}, {'project_ref': 'otro'},
                       {'supabase_url': 'http://example.org:54321'}, {'supabase_url': None}, {'http_base': None}):
            with self.subTest(change=sorted(change)):
                self.reject(complete_report(environment={**environment, **change}))
        for environment in (None, {}, 'local'):
            with self.subTest(environment=environment):
                self.reject(complete_report(environment=environment))

    def test_provenance_is_mandatory(self):
        self.assertIn('otra ejecucion', self.reject(complete_report(), sha='c' * 40))
        self.assertIn('build_sha', self.reject(complete_report(environment={**complete_report()['environment'], 'build_sha': 'c' * 40})))
        for sha in (None, '', 'corto', 'A' * 40):
            with self.subTest(sha=sha):
                self.assertIn('source_sha', self.reject(complete_report(source_sha=sha)))
        self.assertIn('limpio', self.reject(complete_report(worktree_clean=False)))
        self.assertIn('limpio', self.reject({k: v for k, v in complete_report().items() if k != 'worktree_clean'}))
        self.assertIn('test_source_sha256', self.reject(complete_report(test_source_sha256=None)))
        self.assertIn('test_source_sha256', self.reject(complete_report(), test_source_sha256='d' * 64))

    def test_other_campaign_is_rejected(self):
        self.assertIn('campana', self.reject(complete_report(campaign='import')))
        self.assertIn('campana', self.reject(complete_report(ticket='ALIGN-059')))

    def test_a_failed_run_cannot_pass(self):
        for change in ({'passed': False}, {'passed': 'true'}, {'exit_code': 1}, {'exit_code': None},
                       {'report_errors': ['fallo']}, {'report_errors': None}):
            with self.subTest(change=sorted(change)):
                self.reject(complete_report(**change))

    def test_all_problems_are_reported_together(self):
        report = without(complete_report(project_ref=None, worktree_clean=False), 0)
        message = self.reject(report)
        self.assertIn('Faltan', message)
        self.assertIn('limpio', message)

    def test_not_a_report(self):
        for report in (None, [], 'aprobado', {}):
            with self.subTest(report=report):
                self.reject(report)


class CaseSourceTests(unittest.TestCase):
    """Inventario y codigo de las pruebas no pueden separarse, tampoco sin base local."""

    source = (runner.ROOT / CAMPAIGN.test_file).read_text(encoding='utf-8')

    def test_ids_in_the_source_are_exactly_the_inventory(self):
        titles = re.findall(r"\bit\(\s*'(REV-[A-Z]+-\d{2}):", self.source)
        self.assertEqual(len(titles), len(set(titles)), 'ID duplicado en el codigo')
        self.assertEqual(set(titles), CAMPAIGN.required_cases)

    def test_source_declares_no_way_to_omit_or_focus(self):
        for pattern in (r'\.(skip|skipIf|runIf|todo|only|fails)\b', r'\bexpect\.soft\b', r'ctx\.skip|context\.skip'):
            with self.subTest(pattern=pattern):
                self.assertIsNone(re.search(pattern, self.source))

    def test_every_it_is_a_case_of_the_inventory(self):
        self.assertEqual(len(re.findall(r'\bit(?:\.\w+)?\(', self.source)), len(CAMPAIGN.required_cases))
        self.assertIsNone(re.search(r'\bit\.each\b|\btest\(', self.source))


class SuiteSeparationTests(unittest.TestCase):
    def read(self, relative):
        return (runner.ROOT / relative).read_text(encoding='utf-8')

    def test_isolated_suite_excludes_both_real_campaigns(self):
        exclude = re.search(r'exclude:\s*\[([^\]]*)\]', self.read('front/vitest.config.ts')).group(1)
        self.assertIn("'tests/external/**'", exclude)
        self.assertIn("'tests/external-review/**'", exclude)

    def test_campaign_of_12_does_not_collect_this_campaign(self):
        supabase = self.read('front/vitest.supabase.config.ts')
        self.assertIn("include: ['tests/external/**/*.test.ts']", supabase)
        self.assertNotIn('external-review', supabase)

    def test_review_config_collects_only_this_campaign_and_forbids_focus(self):
        review = self.read(CAMPAIGN.vitest_config)
        self.assertIn("include: ['tests/external-review/**/*.integration.test.ts']", review)
        self.assertNotIn("'tests/external/", review)
        self.assertIn('allowOnly: false', review)
        self.assertIn('retry: 0', review)
        self.assertIn('readLocalReviewConfig()', review)


class RunnerTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.output = Path(temporary.name) / 'salida'
        self.config_file = Path(temporary.name) / 'config.json'
        self.config_file.write_text(json.dumps(local_config()), encoding='utf-8')
        patches = {
            'current_sha': mock.patch.object(runner, 'current_sha', return_value=SHA),
            'is_clean': mock.patch.object(runner, 'worktree_is_clean', return_value=True),
            'build': mock.patch.object(runner, 'read_build_info', return_value={'sourceSha': SHA, 'supabaseProjectRef': None}),
            'tools': mock.patch.object(runner, 'tool_versions', return_value={'node': 'v22', 'npm': '11.21.1', 'vitest': '4'}),
            'environ': mock.patch.dict(runner.os.environ, {}, clear=False),
        }
        self.mocks = {name: patch.start() for name, patch in patches.items()}
        for patch in patches.values():
            self.addCleanup(patch.stop)
        for name in list(runner.os.environ):
            if any(mark in runner.os.environ[name] for mark in ('supabase.co', ORIGINAL, TESTING)):
                del runner.os.environ[name]

    def vitest(self, cases=None, returncode=0, extra_failure=''):
        cases = cases if cases is not None else [(f'{case}: variante', 'passed') for case in sorted(CAMPAIGN.required_cases)]

        def run(command, **kwargs):
            flag = next(arg for arg in command if arg.startswith('--outputFile.json='))
            passed = sum(status == 'passed' for _, status in cases)
            failed = sum(status == 'failed' for _, status in cases)
            Path(flag.split('=', 1)[1]).write_text(json.dumps({
                'numTotalTests': len(cases), 'numPassedTests': passed, 'numFailedTests': failed,
                'numPendingTests': sum(status in ('skipped', 'pending') for _, status in cases),
                'numTodoTests': sum(status == 'todo' for _, status in cases),
                'testResults': [{'assertionResults': [
                    {'title': name, 'status': status, 'duration': 1, 'failureMessages': [extra_failure] if status == 'failed' else []}
                    for name, status in cases]}],
            }), encoding='utf-8')
            kwargs['stdout'].write(f'salida de vitest {extra_failure}\n')
            return mock.Mock(returncode=returncode)

        return mock.patch.object(runner.subprocess, 'run', side_effect=run)

    def execute(self, config_file=None):
        return runner.run(self.output, config_file or self.config_file, HTTP_BASE, CAMPAIGN)

    def saved(self):
        return json.loads((self.output / 'review.json').read_text(encoding='utf-8'))

    def test_complete_run_passes_and_records_sha_and_environment(self):
        with self.vitest():
            self.assertEqual(self.execute(), 0)
        report = self.saved()
        self.assertTrue(report['passed'])
        self.assertEqual(report['source_sha'], SHA)
        self.assertEqual(report['environment']['target'], 'local')
        self.assertIsNone(report['environment']['project_ref'])
        self.assertEqual(report['environment']['build_sha'], SHA)
        runner.validate_report(report, CAMPAIGN, sha=SHA)

    def test_junit_carries_sha_environment_and_every_case(self):
        with self.vitest():
            self.execute()
        suite = ET.parse(self.output / 'review.xml').getroot().find('testsuite')
        properties = {item.get('name'): item.get('value') for item in suite.find('properties')}
        self.assertEqual(properties['source_sha'], SHA)
        self.assertEqual(properties['target'], 'local')
        self.assertEqual(properties['project_ref'], 'none')
        self.assertEqual(int(suite.get('tests')), len(CAMPAIGN.required_cases))
        self.assertEqual(int(suite.get('failures')), 0)
        self.assertEqual(len(suite.findall('testcase')), len(CAMPAIGN.required_cases))

    def test_junit_counts_missing_cases_as_failures(self):
        cases = [(f'{case}: variante', 'passed') for case in sorted(CAMPAIGN.required_cases)]
        with self.vitest(cases[1:]):
            self.assertEqual(self.execute(), 1)
        suite = ET.parse(self.output / 'review.xml').getroot().find('testsuite')
        self.assertEqual(int(suite.get('failures')), 1)
        self.assertIn('Faltan', self.saved()['report_errors'][0])

    def test_missing_skipped_and_failed_cases_fail_the_run(self):
        cases = [(f'{case}: variante', 'passed') for case in sorted(CAMPAIGN.required_cases)]
        for label, variant, code in (('faltante', cases[1:], 0), ('omitido', [(cases[0][0], 'skipped'), *cases[1:]], 0),
                                     ('todo', [(cases[0][0], 'todo'), *cases[1:]], 0), ('fallido', [(cases[0][0], 'failed'), *cases[1:]], 1)):
            with self.subTest(label=label), tempfile.TemporaryDirectory() as folder:
                self.output = Path(folder) / 'salida'
                with self.vitest(variant, code):
                    self.assertEqual(self.execute(), 1)
                report = self.saved()
                self.assertFalse(report['passed'])
                self.assertIn(cases[0][0].split(':')[0], report['report_errors'][0])

    def test_a_passing_exit_code_does_not_rescue_an_incomplete_inventory(self):
        with self.vitest([], 0):
            self.assertEqual(self.execute(), 1)
        self.assertFalse(self.saved()['passed'])

    def test_prohibited_destination_never_reaches_vitest_nor_the_network(self):
        for config in (local_config(supabaseUrl=f'https://{ORIGINAL}.supabase.co'),
                       local_config(supabaseUrl=f'https://{TESTING}.supabase.co'),
                       local_config(project_ref=ORIGINAL)):
            with self.subTest(), tempfile.TemporaryDirectory() as folder:
                self.output = Path(folder) / 'salida'
                self.config_file.write_text(json.dumps(config), encoding='utf-8')
                with mock.patch.object(runner.subprocess, 'run') as launched:
                    self.assertEqual(self.execute(), 1)
                launched.assert_not_called()
                self.mocks['build'].assert_not_called()
                report = self.saved()
                self.assertFalse(report['passed'])
                self.assertIn('prohibido', report['report_errors'][0])
                self.assertNotIn(ORIGINAL, json.dumps(report))
                self.assertNotIn(TESTING, json.dumps(report))

    def test_build_of_another_commit_is_rejected_before_running(self):
        self.mocks['build'].return_value = {'sourceSha': 'c' * 40, 'supabaseProjectRef': None}
        with mock.patch.object(runner.subprocess, 'run') as launched:
            self.assertEqual(self.execute(), 1)
        launched.assert_not_called()
        self.assertIn('otro commit', self.saved()['report_errors'][0])

    def test_build_pointing_to_a_remote_project_is_rejected_before_running(self):
        self.mocks['build'].return_value = {'sourceSha': SHA, 'supabaseProjectRef': ORIGINAL}
        with mock.patch.object(runner.subprocess, 'run') as launched:
            self.assertEqual(self.execute(), 1)
        launched.assert_not_called()
        self.assertNotIn(ORIGINAL, json.dumps(self.saved()))

    def test_unreachable_build_info_fails_the_run(self):
        self.mocks['build'].side_effect = ValueError('El servidor local no responde.')
        with mock.patch.object(runner.subprocess, 'run') as launched:
            self.assertEqual(self.execute(), 1)
        launched.assert_not_called()

    def test_dirty_worktree_cannot_be_reported_as_passed(self):
        self.mocks['is_clean'].return_value = False
        with self.vitest():
            self.assertEqual(self.execute(), 1)
        self.assertIn('limpio', self.saved()['report_errors'][0])

    def test_previous_evidence_is_refused(self):
        self.output.mkdir()
        (self.output / 'anterior.json').write_text('{}', encoding='utf-8')
        with self.assertRaises(ValueError):
            self.execute()

    def test_secrets_are_redacted_from_every_output(self):
        secret = 'clave-privada-operador'
        jwt = fake_jwt('equitas_review_server')
        cases = [(f'{case}: variante', 'passed') for case in sorted(CAMPAIGN.required_cases)]
        with self.vitest([(cases[0][0], 'failed'), *cases[1:]], 1, f'{secret} {jwt} sb_publishable_sintetica {ORIGINAL} {TESTING}'):
            self.execute()
        for path in self.output.iterdir():
            text = path.read_text(encoding='utf-8')
            for value in (secret, jwt, 'sb_publishable_', ORIGINAL, TESTING):
                with self.subTest(path=path.name):
                    self.assertNotIn(value, text)

    def test_report_can_be_validated_again_from_disk(self):
        with self.vitest():
            self.execute()
        self.assertEqual(runner.validate_saved(self.output / 'review.json', CAMPAIGN, SHA), 0)
        report = without(self.saved(), 0)
        (self.output / 'review.json').write_text(json.dumps(report), encoding='utf-8')
        self.assertEqual(runner.validate_saved(self.output / 'review.json', CAMPAIGN, SHA), 1)


if __name__ == '__main__':
    unittest.main()
