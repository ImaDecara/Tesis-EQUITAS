"""Boundary and failure contracts for the fixed-base quality gates."""

import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from quality.gate_probe import inject
from quality.gates import (
    POLICY,
    added_lines,
    classify_findings,
    evaluate_gates,
    new_coverage,
    normalize_path,
    ratio,
    read_json,
    read_lcov,
)

HEAD = 'a' * 40
FRONT = 'front/lib/case.ts'
BACK = 'back/ETL/case.py'
DIFF = f'+++ b/{FRONT}\n@@ -0,0 +1,5 @@\n+a\n+b\n+c\n+d\n+e\n'


class ThresholdTests(unittest.TestCase):
    def test_new_coverage_7999_fails_and_80_passes(self):
        self.assertFalse(ratio(7999, 10000, 80)['passed'])
        self.assertTrue(ratio(8000, 10000, 80)['passed'])

    def test_existing_coverage_5999_fails_and_60_passes(self):
        self.assertFalse(ratio(5999, 10000, 60)['passed'])
        self.assertTrue(ratio(6000, 10000, 60)['passed'])

    def test_duplication_5_passes_501_fails_without_rounding(self):
        self.assertTrue(ratio(500, 10000, 5, minimum=False)['passed'])
        self.assertFalse(ratio(501, 10000, 5, minimum=False)['passed'])
        self.assertFalse(ratio(50001, 1000000, 5, minimum=False)['passed'])

    def test_invalid_counts_cannot_approve(self):
        for covered, total in [(1, 0), (-1, 10), (11, 10), (True, 10), (1.5, 10), (1, float('nan'))]:
            with self.subTest(covered=covered, total=total), self.assertRaises(ValueError):
                ratio(covered, total, 80)

    def test_no_new_lines_has_null_percentage_not_invented_100(self):
        result = new_coverage({}, {FRONT: {1: False}}, {FRONT}, 80)
        self.assertEqual((result['total'], result['pct'], result['applicable'], result['passed']), (0, None, False, True))

    def test_windows_linux_and_relative_paths_are_equivalent(self):
        for path in ['lib/case.ts', FRONT, 'C:\\work\\front\\lib\\case.ts', '/home/runner/repo/front/lib/case.ts']:
            self.assertEqual(normalize_path(path, 'frontend'), FRONT)
        with self.assertRaises(ValueError):
            normalize_path('../secret.ts', 'frontend')

    def test_deleted_lines_do_not_enter_new_denominator(self):
        changes = added_lines('+++ /dev/null\n@@ -1 +0,0 @@\n-deleted\n' + DIFF)
        self.assertEqual(changes, {FRONT: set(range(1, 6))})
        coverage = {FRONT: {1: True, 3: False}}
        result = new_coverage(changes, coverage, {FRONT}, 80)
        self.assertEqual((result['covered'], result['total'], result['passed']), (1, 2, False))

    def test_real_git_rename_is_a_complete_new_file_with_no_renames(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=root, encoding='utf-8', stderr=subprocess.PIPE)
            git('init', '-q')
            path = root / 'old name.ts'
            path.write_text('const a = 1\nconst b = 2\n', encoding='utf-8')
            git('add', '.')
            git('-c', 'user.name=Gate test', '-c', 'user.email=gate@example.test', 'commit', '-qm', 'base')
            path.rename(root / 'new name.ts')
            git('add', '-A')
            diff = git('diff', '--cached', '--no-renames', '--unified=0')
            self.assertEqual(added_lines(diff), {'new name.ts': {1, 2}})

    def test_critical_and_noncritical_rules_remain_separate(self):
        policy = read_json(POLICY)
        eslint = [{'filePath': FRONT, 'errorCount': 0, 'warningCount': 0, 'messages': []}]
        diagnostic = {'filename': BACK, 'code': 'F821', 'location': {'row': 1}, 'message': 'undefined name'}
        result = classify_findings(eslint, [diagnostic], policy)
        self.assertEqual(len(result['critical']), 1)
        diagnostic['code'] = 'I001'
        result = classify_findings(eslint, [diagnostic], policy)
        self.assertFalse(result['passed'])
        self.assertEqual(result['critical'], [])

    def test_eslint_selected_rule_and_parse_error_are_critical(self):
        for rule, fatal in [('no-unsafe-finally', False), (None, True)]:
            eslint = [{'filePath': FRONT, 'errorCount': 1, 'warningCount': 0,
                       'messages': [{'severity': 2, 'ruleId': rule, 'fatal': fatal, 'message': 'test error'}]}]
            self.assertEqual(len(classify_findings(eslint, [], read_json(POLICY))['critical']), 1)


class GateReportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.artifacts = Path(self.temp.name)
        self.front, self.back = self.artifacts / 'frontend', self.artifacts / 'backend'
        self.diff = DIFF
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.git_mock = patch('quality.gates.git', side_effect=self.git)
        self.git_mock.start()
        self.addCleanup(self.git_mock.stop)
        for name, directory in [('frontend', self.front), ('backend', self.back)]:
            names = ['dependencies', 'tests', 'lint'] + (['build', 'duplication', 'complexity', 'audit'] if name == 'frontend' else ['versions', 'infrastructure-tests', 'infrastructure-lint'])
            self.put(directory / 'component.json', {'component': name, 'source_sha': HEAD, 'run_id': '1', 'run_attempt': '1',
                'passed': True, 'controls': [{'name': n, 'exit_code': 0} for n in names],
                'report_errors': [], 'metrics': {'tests': {'passed': 1, 'failed': 0, 'skipped': 1}}})
            (directory / 'tests.xml').write_text('<testsuite><testcase/><testcase><skipped/></testcase></testsuite>', encoding='utf-8')
        self.put(self.front / 'tests.json', {'numPassedTests': 1, 'numFailedTests': 0, 'numPendingTests': 1})
        metric = {'covered': 4, 'total': 5, 'pct': 80}
        self.put(self.front / 'coverage/coverage-summary.json', {'total': {'statements': metric}, FRONT: {'statements': metric, 'lines': metric}})
        path = self.front / 'coverage/lcov.info'
        path.write_text('SF:lib/case.ts\n' + '\n'.join(f'DA:{n},{1 if n < 5 else 0}' for n in range(1, 6)) + '\nend_of_record\n', encoding='utf-8')
        self.put(self.back / 'coverage.json', {'files': {'ETL/case.py': {'executed_lines': [1, 2, 3, 4], 'missing_lines': [5], 'summary': {'num_statements': 5}}},
            'totals': {'covered_lines': 4, 'num_statements': 5}})
        self.put(self.front / 'duplication/jscpd-report.json', {'statistics': {'total': {'duplicatedLines': 5, 'lines': 100}}})
        self.put(self.front / 'eslint.json', [{'filePath': FRONT, 'errorCount': 0, 'warningCount': 0, 'messages': []}])
        self.put(self.back / 'ruff.json', [])
        self.put(self.front / 'npm-audit-decision.json', {'accepted': True})
        self.put(self.front / 'npm-audit-all.json', {'metadata': {'vulnerabilities': {'critical': 0}}})
        self.put(self.front / 'npm-audit-production.json', {'metadata': {'vulnerabilities': {'total': 0}}})

    def git(self, root, *args):
        if args[0] == 'rev-parse':
            return HEAD
        if args[0] == 'ls-files':
            return FRONT + '\0' + BACK + '\0'
        if args[0] == 'diff':
            return self.diff
        return ''

    def put(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding='utf-8')

    def check(self, name):
        result = evaluate_gates(self.artifacts)
        return next(c for c in result['checks'] if c['id'] == name)

    def test_valid_reports_pass_with_fixed_base_and_explicit_external_skip(self):
        result = evaluate_gates(self.artifacts)
        self.assertTrue(result['passed'], result)
        self.assertEqual(result['base_sha'], read_json(POLICY)['base_sha'])
        self.assertFalse(result['release_approved'])
        self.assertEqual(self.check('frontend_new_lines')['observed']['pct'], 80)

    def test_new_lines_below_80_block_whole_evaluation(self):
        self.diff = f'+++ b/{FRONT}\n@@ -0,0 +4,2 @@\n+a\n+b\n'
        self.assertFalse(self.check('frontend_new_lines')['passed'])
        self.assertFalse(evaluate_gates(self.artifacts)['passed'])

    def test_missing_required_reports_never_pass(self):
        for path in ['coverage/lcov.info', 'coverage/coverage-summary.json', 'eslint.json', 'duplication/jscpd-report.json']:
            file = self.front / path
            saved = file.read_bytes()
            file.unlink()
            self.assertFalse(evaluate_gates(self.artifacts)['passed'], path)
            file.write_bytes(saved)

    def test_json_and_counts_corruption_preserve_a_failure_explanation(self):
        path = self.front / 'coverage/coverage-summary.json'
        for invalid in ['{', 'null', '[]', '{"total": {"statements": {"covered": true, "total": 5}}}']:
            path.write_text(invalid, encoding='utf-8')
            result = evaluate_gates(self.artifacts)
            self.assertFalse(result['passed'])
            self.assertTrue(result['errors'])

    def test_missing_file_and_partial_lcov_are_rejected(self):
        path = self.front / 'coverage/lcov.info'
        path.write_text('SF:lib/case.ts\nend_of_record\n', encoding='utf-8')
        self.assertFalse(evaluate_gates(self.artifacts)['passed'])
        path.write_text('SF:lib/case.ts\nDA:1,1\n', encoding='utf-8')
        with self.assertRaises(ValueError):
            read_lcov(path)

    def test_backend_coverage_cannot_hide_a_missing_line(self):
        data = read_json(self.back / 'coverage.json')
        data['files']['ETL/case.py']['missing_lines'] = []
        self.put(self.back / 'coverage.json', data)
        self.assertFalse(evaluate_gates(self.artifacts)['passed'])

    def test_test_reports_are_required_and_must_agree(self):
        path = self.front / 'tests.xml'
        saved = path.read_bytes()
        path.unlink()
        self.assertFalse(evaluate_gates(self.artifacts)['passed'])
        path.write_text('<invalid', encoding='utf-8')
        self.assertFalse(evaluate_gates(self.artifacts)['passed'])
        path.write_bytes(saved)
        self.put(self.front / 'tests.json', {'numPassedTests': 2, 'numFailedTests': 0, 'numPendingTests': 1})
        self.assertFalse(evaluate_gates(self.artifacts)['passed'])

    def test_wrong_sha_run_attempt_and_duplicate_manifest_are_rejected(self):
        path = self.front / 'component.json'
        original = read_json(path)
        for field, value in [('source_sha', 'other'), ('run_id', '2'), ('run_attempt', '2')]:
            data = copy.deepcopy(original)
            data[field] = value
            self.put(path, data)
            with patch.dict(os.environ, {'GITHUB_RUN_ID': '1', 'GITHUB_RUN_ATTEMPT': '1'}):
                self.assertFalse(evaluate_gates(self.artifacts)['passed'])
        self.put(path, original)
        self.put(self.artifacts / 'duplicate/component.json', original)
        self.assertFalse(evaluate_gates(self.artifacts)['passed'])

    def test_absent_base_cannot_silently_become_head(self):
        with patch('quality.gates.git', side_effect=subprocess.CalledProcessError(128, ['git'])):
            self.assertFalse(evaluate_gates(self.artifacts)['passed'])
        policy = read_json(POLICY)
        policy['base_sha'] = HEAD
        path = self.artifacts / 'changed-policy.json'
        self.put(path, policy)
        self.assertFalse(evaluate_gates(self.artifacts, policy_path=path)['passed'])

    def test_no_diff_does_not_hide_missing_reports(self):
        self.diff = ''
        result = self.check('frontend_new_lines')['observed']
        self.assertEqual((result['total'], result['pct']), (0, None))
        (self.back / 'coverage.json').unlink()
        self.assertFalse(evaluate_gates(self.artifacts)['passed'])

    def test_lint_diagnostic_count_disagreement_is_invalid(self):
        data = read_json(self.front / 'eslint.json')
        data[0]['errorCount'] = 1
        self.put(self.front / 'eslint.json', data)
        self.assertFalse(evaluate_gates(self.artifacts)['passed'])

    def test_failed_build_and_missing_control_block(self):
        path = self.front / 'component.json'
        data = read_json(path)
        data['controls'][3]['exit_code'] = 7
        self.put(path, data)
        self.assertFalse(self.check('build_and_tests')['passed'])
        data['controls'] = []
        self.put(path, data)
        self.assertFalse(evaluate_gates(self.artifacts)['passed'])

    def test_dependency_policy_rejection_is_separate_from_functional_criticals(self):
        self.put(self.front / 'npm-audit-decision.json', {'accepted': False})
        self.assertFalse(self.check('dependencies')['passed'])
        self.assertTrue(self.check('critical_bugs')['passed'])

    def test_controlled_probe_retains_original_and_blocks_critical_gate(self):
        with patch.dict(os.environ, {'GITHUB_EVENT_NAME': 'workflow_dispatch', 'CI_GATE_PROBE': 'critical'}):
            output = self.artifacts / 'probe-output'
            record = inject(self.artifacts, output)
        self.assertTrue(record['synthetic'])
        self.assertEqual(read_json(output / 'ruff-before-probe.json'), [])
        self.assertFalse(self.check('critical_bugs')['passed'])
        self.assertFalse(evaluate_gates(self.artifacts)['passed'])

    def test_probe_is_restricted_to_manual_opt_in(self):
        with self.assertRaises(ValueError):
            inject(self.artifacts, self.artifacts / 'out')


if __name__ == '__main__':
    unittest.main()
