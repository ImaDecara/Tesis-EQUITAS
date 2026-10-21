"""A deployed smoke must not select another SHA, provider or environment."""

import copy
import unittest

from quality.wait_preview import POLICY, select_preview, validate_quality


class PreviewSelectionTests(unittest.TestCase):
    def setUp(self):
        self.sha = 'a' * 40
        self.deployment = {'id': 1, 'sha': self.sha, 'environment': 'Preview',
                           'creator': {'login': 'vercel[bot]'}, 'created_at': '2026-10-21T22:00:00Z'}
        self.status = {'state': 'success', 'environment_url': 'https://tesis-equitas-abc123-equitas.vercel.app',
                       'created_at': '2026-10-21T22:01:00Z'}

    def test_exact_ready_preview_returns_immutable_url(self):
        result = select_preview([self.deployment], {1: [self.status]}, self.sha)
        self.assertEqual(result['url'], self.status['environment_url'])
        self.assertEqual(result['source_sha'], self.sha)
        self.assertEqual(result['deployment_id'], 1)

    def test_previous_sha_production_and_foreign_creator_are_not_selected(self):
        for field, value in [('sha', 'b' * 40), ('environment', 'Production'), ('creator', {'login': 'other'})]:
            with self.subTest(field=field):
                self.assertIsNone(select_preview([{**self.deployment, field: value}], {1: [self.status]}, self.sha))

    def test_pending_and_skipped_deployments_are_not_ready(self):
        for state in ('pending', 'in_progress', 'inactive'):
            with self.subTest(state=state):
                self.assertIsNone(select_preview([self.deployment], {1: [{**self.status, 'state': state}]}, self.sha))
        self.assertIsNone(select_preview([self.deployment], {}, self.sha))

    def test_failed_deployment_blocks(self):
        with self.assertRaises(ValueError):
            select_preview([self.deployment], {1: [{**self.status, 'state': 'failure'}]}, self.sha)

    def test_foreign_host_query_or_insecure_url_blocks_credentials(self):
        for url in ('https://example.test', 'http://tesis-equitas-abc123-equitas.vercel.app',
                    self.status['environment_url'] + '?secret=value', self.status['environment_url'] + '/login'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                select_preview([self.deployment], {1: [{**self.status, 'environment_url': url}]}, self.sha)

    def test_quality_gate_requires_same_sha_trusted_branch_and_success(self):
        quality = {'head_sha': self.sha, 'conclusion': 'success', 'head_branch': POLICY['branch'],
                   'event': 'push', 'head_repository': {'full_name': 'ImaDecara/Tesis-EQUITAS'},
                   'path': '.github/workflows/quality-ci.yml'}
        validate_quality(quality, self.sha, 'ImaDecara/Tesis-EQUITAS')
        for field, value in [('head_sha', 'b' * 40), ('conclusion', 'failure'), ('head_branch', 'other'),
                             ('event', 'pull_request'), ('head_repository', {'full_name': 'foreign/repo'}),
                             ('path', '.github/workflows/other.yml')]:
            modified = copy.deepcopy(quality)
            modified[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_quality(modified, self.sha, 'ImaDecara/Tesis-EQUITAS')
