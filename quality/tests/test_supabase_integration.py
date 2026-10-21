"""The real campaign cannot pass on skips, wrong environments or missing secrets."""

import json
import unittest

from quality.supabase_integration import (
    FIXTURE,
    REQUIRED_CASES,
    validate_config,
    validate_result,
)


class SupabaseContractTests(unittest.TestCase):
    def test_missing_secret_fails_without_echoing_values(self):
        for raw in (None, '', 'invalid-secret-json', '{"password":"private-value"}'):
            with self.subTest(raw=bool(raw)), self.assertRaises(ValueError) as result:
                validate_config(raw)
            self.assertNotIn('private-value', str(result.exception))

    def test_real_portfolio_and_admin_keys_are_rejected(self):
        base = {'url': FIXTURE['url'], 'publishableKey': 'sb_publishable_test', 'accounts': {
            label: {'email': f'tp-e06-{label}@example.test', 'password': 'not-a-real-secret'}
            for label in ('a', 'b', 'none', 'inactive')}}
        self.assertEqual(validate_config(json.dumps(base)), base)
        for field, value in [('url', 'https://folyslqzqvnpolexcxjo.supabase.co'),
                             ('publishableKey', 'sb_secret_do-not-use')]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_config(json.dumps({**base, field: value}))

    def report(self):
        cases = [{'name': name + ': variant', 'status': 'passed'} for name in sorted(REQUIRED_CASES)]
        cases += [{'name': name + ': second variant', 'status': 'passed'}
                  for name in ('SUP-AUTH-01', 'SUP-DATA-02')]
        return {'passed': True, 'report_errors': [], 'project_ref': FIXTURE['project_ref'],
                'fixture_version': FIXTURE['fixture_version'], 'source_sha': 'sha', 'run_id': 'run',
                'run_attempt': '1', 'tests': {'passed': 12, 'failed': 0, 'skipped': 0}, 'cases': cases}

    def test_complete_real_report_is_accepted(self):
        validate_result(self.report(), 'sha', 'run', '1')

    def test_omitted_or_failed_cases_block(self):
        for counts in ({'passed': 11, 'failed': 0, 'skipped': 1}, {'passed': 11, 'failed': 1, 'skipped': 0}):
            with self.subTest(counts=counts), self.assertRaises(ValueError):
                validate_result({**self.report(), 'tests': counts})

    def test_wrong_provenance_or_duplicate_cases_block(self):
        for field, value in [('project_ref', 'wrong'), ('fixture_version', 'old'),
                             ('source_sha', 'old'), ('run_id', 'old'), ('run_attempt', '2')]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_result({**self.report(), field: value}, 'sha', 'run', '1')
        report = self.report()
        report['cases'][-1] = report['cases'][0]
        with self.assertRaises(ValueError):
            validate_result(report)

    def test_missing_required_case_id_blocks(self):
        report = self.report()
        report['cases'][0]['name'] = 'OTHER: variant'
        with self.assertRaises(ValueError):
            validate_result(report)
