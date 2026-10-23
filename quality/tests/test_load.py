"""Prevent load reports from approving incomplete or functionally wrong campaigns."""

import copy
import json
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

from quality.load.fixture import FixtureConnector, make_dataset, make_oracle
from quality.load.report import evaluate, percentile, phases

POLICY = json.loads((Path(__file__).resolve().parents[1] / 'load/policy.json').read_text(encoding='utf-8'))


class LoadEvidenceTests(unittest.TestCase):
    def samples(self, directory, *, latency=100, error=False, content=False, missing=False, corrupt=False):
        policy = copy.deepcopy(POLICY)
        policy['stress']['users'] = [10]
        path = Path(directory) / 'samples.ndjson'
        values = []
        for phase, seconds, start in [('warmup', 30, 0), ('stress_10', 60, 40)]:
            if missing and phase == 'stress_10':
                continue
            for index in range(seconds):
                values.append({'type': 'Point', 'metric': 'operation_ms', 'data': {
                    'time': datetime.fromtimestamp(1800000000 + start + index, UTC).isoformat(),
                    'value': latency, 'tags': {'phase': phase, 'op': ['list', 'filtered', 'summary'][index % 3],
                                             'unexpected': str(error).lower(), 'content_mismatch': str(content).lower()}}})
        path.write_text('\n'.join(json.dumps(v) for v in values) + ('\n{"truncated"' if corrupt else '\n'), encoding='utf-8')
        return path, policy

    def test_fixture_is_deterministic_complete_and_covers_six_groups(self):
        first, second = make_oracle(), make_oracle()
        self.assertEqual(first, second)
        profiles, debtors, expected = make_dataset()
        self.assertEqual((len(profiles), len(debtors), len(expected)), (3600, 3600, 3600))
        self.assertEqual(len({p['id'] for p in profiles}), 3600)
        self.assertEqual(set(first['summary']['groups'].values()), {600})
        self.assertEqual(first['list']['items'][0]['debtor_id'], 1)
        self.assertEqual(first['filtered']['items'][0]['debtor_id'], 303)

    def test_connector_is_read_only_strict_and_returns_independent_rows(self):
        client = FixtureConnector()
        query = client.table('debtor').select('id,identifier').in_('id', [1, 3600])
        rows = query.execute().data
        self.assertEqual([r['id'] for r in rows], [1, 3600])
        rows[0]['identifier'] = 'changed'
        self.assertEqual(query.execute().data[0]['identifier'], 'E08-000001')
        for table in ['debt', 'user', 'tenant']:
            with self.assertRaises(ValueError):
                client.table(table)
        with self.assertRaises(ValueError):
            client.table('debtor').select('id').in_('id', list(range(201)))

    def test_profiles_are_complete_in_source_without_cloud_response_caps(self):
        rows = FixtureConnector().table('debtor_profile').select('id,active').eq('active', True).execute().data
        self.assertEqual(len(rows), 3600)
        self.assertTrue(all(row['active'] for row in rows))
        with self.assertRaises(ValueError):
            FixtureConnector().table('debtor_profile').select('id').eq('active', False)

    def test_fixed_schedule_has_target_and_ten_minute_sustained_phase(self):
        self.assertEqual([p[1] for p in phases(POLICY, 'stress')], [1, 1, 5, 10, 20, 40])
        self.assertEqual(phases(POLICY, 'soak')[-1], ('soak', 10, 600))
        with self.assertRaises(ValueError):
            phases(POLICY, 'foreign')

    def test_percentile_does_not_hide_threshold_excess_by_rounding(self):
        self.assertEqual(percentile([0, 100], 95), 95)
        self.assertIsNone(percentile([], 95))
        with tempfile.TemporaryDirectory() as directory:
            path, policy = self.samples(directory, latency=2000.00001)
            self.assertFalse(evaluate(path, policy, 'stress', 0, 101)['passed'])

    def test_valid_report_excludes_warmup_and_preserves_operation_breakdown(self):
        with tempfile.TemporaryDirectory() as directory:
            path, policy = self.samples(directory)
            result = evaluate(path, policy, 'stress', 0, 101)
            self.assertTrue(result['passed'], result['errors'])
            self.assertFalse(result['phases'][0]['slo_required'])
            self.assertEqual(result['phases'][1]['operations']['filtered']['requests'], 20)

    def test_http_error_or_incorrect_content_cannot_pass(self):
        for options in [{'error': True}, {'content': True}]:
            with self.subTest(options=options), tempfile.TemporaryDirectory() as directory:
                path, policy = self.samples(directory, **options)
                self.assertFalse(evaluate(path, policy, 'stress', 0, 101)['passed'])

    def test_missing_phase_and_short_execution_cannot_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            path, policy = self.samples(directory, missing=True)
            self.assertFalse(evaluate(path, policy, 'stress', 0, 20)['passed'])

    def test_nonzero_exit_resource_stop_and_corrupt_output_cannot_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            path, policy = self.samples(directory)
            self.assertFalse(evaluate(path, policy, 'stress', 99, 101)['passed'])
            self.assertFalse(evaluate(path, policy, 'stress', 0, 101, 'RSS exceeded')['passed'])
            path, policy = self.samples(directory, corrupt=True)
            self.assertFalse(evaluate(path, policy, 'stress', 0, 101)['passed'])

    def test_above_target_degradation_is_observed_without_changing_target(self):
        with tempfile.TemporaryDirectory() as directory:
            path, policy = self.samples(directory, latency=2100)
            path.write_text(path.read_text(encoding='utf-8').replace('stress_10', 'stress_40'), encoding='utf-8')
            policy['stress']['users'] = [40]
            result = evaluate(path, policy, 'stress', 0, 101)
            self.assertTrue(result['passed'], result['errors'])
            self.assertEqual(result['first_above_target_slo_failure_users'], 40)
