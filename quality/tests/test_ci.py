"""Infrastructure contracts: failures and unknown audit findings must block CI."""

import copy
import json
import os
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from quality.audit_policy import evaluate
from quality.ci import collect_metrics, run_control, summarize

ROOT = Path(__file__).resolve().parents[2]


class AuditPolicyTests(unittest.TestCase):
    def setUp(self):
        self.policy = json.loads((ROOT / 'quality/npm-audit-policy.json').read_text())
        self.audit = json.loads((ROOT / 'evidencias/e01/npm-audit-despues.json').read_text())
        self.clean = json.loads((ROOT / 'evidencias/e01/npm-audit-produccion.json').read_text())
        self.lock = json.loads((ROOT / 'front/package-lock.json').read_text())

    def decision(self, **changes):
        values = {'audit': self.audit, 'production': self.clean, 'lock': self.lock, 'policy': self.policy,
                  'raw_codes': [1, 0], 'today': date(2026, 10, 21)}
        values.update(changes)
        return evaluate(**values)

    def test_known_exception_keeps_raw_failure_visible(self):
        decision = self.decision()
        self.assertTrue(decision['accepted'])
        self.assertEqual(decision['raw_exit_codes']['all'], 1)
        self.assertEqual(len(decision['accepted_packages']), 5)

    def test_new_critical_finding_blocks(self):
        self.audit['vulnerabilities']['braces']['severity'] = 'critical'
        self.assertFalse(self.decision()['accepted'])

    def test_new_advisory_in_known_package_blocks(self):
        self.audit['vulnerabilities']['braces']['via'][0]['url'] = 'https://example.com/new-advisory'
        self.assertFalse(self.decision()['accepted'])

    def test_changed_dependency_version_blocks(self):
        self.lock['packages']['node_modules/braces']['version'] = '3.0.4'
        self.assertFalse(self.decision()['accepted'])

    def test_production_finding_blocks(self):
        self.assertFalse(self.decision(production=copy.deepcopy(self.audit), raw_codes=[1, 1])['accepted'])

    def test_expired_exception_blocks(self):
        self.assertFalse(self.decision(today=date(2026, 10, 26))['accepted'])

    def test_network_or_invalid_report_blocks(self):
        self.assertFalse(self.decision(audit={})['accepted'])
        self.assertFalse(self.decision(raw_codes=[2, 0])['accepted'])

    def test_clean_audits_need_no_exception(self):
        decision = self.decision(audit=self.clean, raw_codes=[0, 0], today=date(2027, 1, 1))
        self.assertTrue(decision['accepted'])
        self.assertIsNone(decision['exception'])


class ExecutionContractTests(unittest.TestCase):
    def setUp(self):
        # These tests isolate summary propagation; raw gate contracts have their own suite.
        patcher = patch('quality.ci.evaluate_gates', return_value={
            'passed': True, 'base_sha': 'fixed-test-base', 'checks': [],
        })
        patcher.start()
        self.addCleanup(patcher.stop)

    def component_reports(self, source):
        source.mkdir()
        for component in ('frontend', 'backend'):
            path = source / component
            path.mkdir()
            metrics = {'tests': {'passed': 1, 'failed': 0, 'skipped': 1}}
            if component == 'frontend':
                metrics.update({'coverage': {'statements': {'pct': 60}, 'branches': {'pct': 50}},
                                'duplication': {'percentage': 0}, 'audit': {'high': 5},
                                'audit_policy': {'raw_exit_codes': {'all': 1, 'production': 0}}})
            else:
                metrics['coverage'] = {'percent_statements_covered': 80, 'percent_branches_covered': 70}
            (path / 'component.json').write_text(json.dumps({
                'component': component, 'source_sha': 'test', 'run_id': None,
                'run_attempt': None, 'passed': True,
                'controls': [{'name': 'tests', 'exit_code': 0}], 'metrics': metrics,
            }))

    def test_child_failure_is_recorded_without_rewriting_exit(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            result = run_control('failed-test', [sys.executable, '-c', 'print("assertion failed"); raise SystemExit(7)'], ROOT, output)
            self.assertEqual(result['exit_code'], 7)
            self.assertIn('assertion failed', (output / 'failed-test.log').read_text())
            self.assertEqual(json.loads((output / 'failed-test.exit.json').read_text())['exit_code'], 7)

    def test_missing_test_or_coverage_report_is_not_success(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            with self.assertRaises(FileNotFoundError):
                collect_metrics('frontend', output)

    def test_missing_component_reports_fail_summary_and_preserve_it(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {}, clear=True):
            output = Path(folder) / 'out'
            self.assertEqual(summarize(Path(folder) / 'missing', output), 1)
            self.assertFalse(json.loads((output / 'summary.json').read_text())['passed'])
            self.assertTrue((output / 'summary.md').is_file())

    def test_github_failure_cannot_be_hidden_by_successful_report(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'FRONTEND_RESULT': 'failure'}, clear=True):
            source = Path(folder) / 'artifacts'
            self.component_reports(source)
            self.assertEqual(summarize(source, Path(folder) / 'summary'), 1)

    def test_valid_reports_keep_skips_and_do_not_approve_release(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {}, clear=True):
            source, output = Path(folder) / 'artifacts', Path(folder) / 'summary'
            self.component_reports(source)
            self.assertEqual(summarize(source, output), 0)
            result = json.loads((output / 'summary.json').read_text())
            self.assertEqual(result['tests'], {'passed': 2, 'failed': 0, 'skipped': 2})
            self.assertFalse(result['release_approved'])

    def test_reports_from_another_sha_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'GITHUB_SHA': 'other'}, clear=True):
            source = Path(folder) / 'artifacts'
            self.component_reports(source)
            self.assertEqual(summarize(source, Path(folder) / 'summary'), 1)

    def test_gate_failure_reaches_summary_exit_and_report(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {}, clear=True):
            source, output = Path(folder) / 'artifacts', Path(folder) / 'summary'
            self.component_reports(source)
            with patch('quality.ci.evaluate_gates', return_value={'passed': False, 'base_sha': 'fixed', 'checks': []}):
                self.assertEqual(summarize(source, output), 1)
            result = json.loads((output / 'summary.json').read_text(encoding='utf-8'))
            self.assertFalse(result['passed'])
            self.assertFalse(result['quality_gates_passed'])
            self.assertFalse(json.loads((output / 'gate.json').read_text(encoding='utf-8'))['passed'])

    def test_required_external_job_cannot_be_skipped_or_missing(self):
        for job_result in ('skipped', 'failure', 'success'):
            with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {
                'SUPABASE_REQUIRED': 'true', 'SUPABASE_RESULT': job_result,
            }, clear=True):
                source, output = Path(folder) / 'artifacts', Path(folder) / 'summary'
                self.component_reports(source)
                self.assertEqual(summarize(source, output), 1)
                self.assertTrue(any(error.startswith('E06:') for error in json.loads(
                    (output / 'summary.json').read_text(encoding='utf-8'))['errors']))

    def test_invalid_manifest_preserves_failure_report(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {}, clear=True):
            source, output = Path(folder) / 'artifacts', Path(folder) / 'summary'
            self.component_reports(source)
            (source / 'frontend/component.json').write_text('{', encoding='utf-8')
            self.assertEqual(summarize(source, output), 1)
            self.assertFalse(json.loads((output / 'summary.json').read_text(encoding='utf-8'))['passed'])


if __name__ == '__main__':
    unittest.main()
