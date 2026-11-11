"""Pruebas sin red ni credenciales: las guardas no arrancan ni detienen procesos ajenos."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('original', Path(__file__).with_name('equitas_original.py'))
original = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(original)


class OriginalGuards(unittest.TestCase):
    def test_rejects_server_credentials(self):
        for name in ['EQUITAS_REVIEW_SERVER_JWT', 'EQUITAS_IMPORT_SERVER_JWT', 'EQUITAS_IMPORT_API_URL',
                     'SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY', 'SUPABASE_URL', 'DATABASE_URL', 'JWT_SECRET']:
            with self.subTest(name=name), self.assertRaises(original.OriginalError):
                original.guard_environment({name: 'synthetic'})
        with self.assertRaises(original.OriginalError):
            original.guard_environment({'UNKNOWN': 'sb_secret_synthetic'})
        original.guard_environment({'PATH': '/bin', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY': 'sb_publishable_synthetic'})

    def test_only_original_and_public_key(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict('os.environ', {}, clear=True):
            home = Path(directory)
            for url, key, extra in [
                ('http://127.0.0.1:56321', 'sb_publishable_synthetic', ''),
                (original.ORIGINAL_URL + '/rest/v1', 'sb_publishable_synthetic', ''),
                (original.ORIGINAL_URL, 'eyJ.synthetic.token', ''),
                (original.ORIGINAL_URL, 'sb_publishable_synthetic', '\nEQUITAS_REVIEW_SERVER_JWT=synthetic'),
                (original.ORIGINAL_URL, 'sb_publishable_synthetic', '\nNEXT_PUBLIC_SUPABASE_URL=duplicate'),
            ]:
                original.write_private(home / 'app.env', f'NEXT_PUBLIC_SUPABASE_URL={url}\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY={key}{extra}\n')
                with self.subTest(url=url), self.assertRaises(original.OriginalError):
                    original.configuration(home)
            original.write_private(home / 'app.env', f'NEXT_PUBLIC_SUPABASE_URL="{original.ORIGINAL_URL}"\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_synthetic\n')
            self.assertEqual(original.configuration(home)['NEXT_PUBLIC_SUPABASE_URL'], original.ORIGINAL_URL)
            (home / 'app.env').chmod(0o644)
            with self.assertRaises(original.OriginalError):
                original.configuration(home)

    def test_occupied_port_never_builds(self):
        with patch.object(original, 'configuration', return_value={}), patch.object(original, 'port_busy', return_value=True), patch.object(original, 'build') as build:
            with self.assertRaises(original.OriginalError):
                original.start(Path('/unused'))
            build.assert_not_called()

    def test_stop_never_kills_unverified_or_recycled_process(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(original, 'process_identity', return_value=None), patch('os.kill') as kill:
            home = Path(directory)
            original.write_private(home / 'app.json', json.dumps({'pid': 12345, 'identity': {'started': 'old', 'cwd': '/old'}}))
            original.stop(home)
            kill.assert_not_called()

    def test_child_environment_does_not_inherit_secrets(self):
        with patch.dict('os.environ', {'UNRELATED_TOKEN': 'synthetic'}, clear=True), patch.object(original, 'command', return_value='sha'):
            env = original.child_environment({'NEXT_PUBLIC_SUPABASE_URL': original.ORIGINAL_URL, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY': 'sb_publishable_synthetic'})
            self.assertNotIn('UNRELATED_TOKEN', env)
            self.assertNotIn('EQUITAS_REVIEW_SERVER_JWT', env)
            self.assertEqual(env['EQUITAS_ORIGINAL_BUILD'], '1')


if __name__ == '__main__':
    unittest.main()
