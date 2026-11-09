"""N6: cartera y lanzador de la demo local (scripts/demo). Sin Docker, red ni base: solo lógica y archivos."""

import importlib.util
import inspect
import json
import os
import stat
import subprocess
import sys
from decimal import Decimal
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / 'database/demo/cartera-demo-v1'


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts/demo' / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


cartera = load('cartera_demo')
demo = load('equitas_demo')
MANIFEST = json.loads((FIXTURE / 'manifiesto-demo.json').read_text(encoding='utf-8'))


def test_versioned_fixture_is_exactly_what_the_generator_writes():
    assert cartera.check(FIXTURE) == []
    assert sorted(path.name for path in FIXTURE.iterdir()) == ['cabecera.tsv', 'detalle.tsv', 'manifiesto-demo.json']


def test_manifest_totals_come_from_the_cases_not_from_the_app():
    expected = MANIFEST['resultados_esperados']
    cases = MANIFEST['casos']
    assert len(cases) == expected['objetos'] == 15
    assert sum(case['obligaciones'] for case in cases) == expected['obligaciones'] == 29
    assert sum(Decimal(case['importe_actualizado_ars']) for case in cases) == Decimal(expected['importe_total_actualizado_ars'])
    assert sum(Decimal(value) for value in expected['importe_por_estado_de_origen_ars'].values()) == Decimal(expected['importe_total_actualizado_ars'])
    assert MANIFEST['fecha_corte'] == json.loads((ROOT / cartera.MAPPING).read_text())['fecha_corte']
    assert all(case['identificador'].startswith(demo.IDENTIFIER_PREFIX) for case in cases)
    assert set(expected['objetos_sin_contacto_utilizable']) == {case['identificador'] for case in cases if 'SIN_CONTACTO_UTILIZABLE' in case['banderas_esperadas']}


def test_fixture_contains_only_obvious_synthetic_identities():
    text = (FIXTURE / 'cabecera.tsv').read_text(encoding='utf-8')
    rows = [line.split('\t') for line in text.splitlines()[1:]]
    header = text.splitlines()[0].split('\t')
    for row in rows:
        values = dict(zip(header, row, strict=True))
        assert values['Destinatario_CUIT'].startswith('99-')
        assert values['Destinatario_Email'] in ('', 'NO POSEE') or values['Destinatario_Email'].endswith('@example.invalid')
        assert values['Destinatario_Telefono'] in ('', '0') or values['Destinatario_Telefono'].startswith('0000-555-')


def test_real_validator_accepts_the_demo_lot_with_the_expected_flags(tmp_path):
    output = tmp_path / 'validacion'
    result = subprocess.run([sys.executable, '-m', 'ETL.validate_source', '--folder', str(FIXTURE), '--mapping', str(ROOT / cartera.MAPPING),
                             '--contract', str(ROOT / cartera.CONTRACT), '--cut-off', MANIFEST['fecha_corte'], '--output', str(output)],
                            cwd=ROOT / 'back', capture_output=True, text=True, timeout=300, check=False, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
    assert result.returncode == 0, result.stdout[-2000:]
    report = json.loads((output / 'report.json').read_text(encoding='utf-8'))
    expected = MANIFEST['resultados_esperados']['validacion_esperada']
    assert report['resultado_lote'] == expected['resultado_lote']
    assert report['publicacion_permitida'] is expected['publicacion_permitida']
    assert report['conteos']['objetos_aceptados'] == expected['objetos_aceptados']
    assert report['conteos']['objetos_en_cuarentena'] == expected['objetos_en_cuarentena']
    assert report['importes']['actualizado_aceptado'] == MANIFEST['resultados_esperados']['importe_total_actualizado_ars']
    assert [sorted(item['banderas']) for item in report['objetos']] == [sorted(case['banderas_esperadas']) for case in MANIFEST['casos']]


@pytest.mark.parametrize('value', ['https://abc.supabase.co', 'postgres://folyslqzqvnpolexcxjo', 'X IYLWGHGVTYDPMWIDOJDO y'])
def test_guard_refuses_any_remote_reference_without_echoing_it(value):
    with pytest.raises(demo.DemoError) as error:
        demo.guard_environment({'CUALQUIERA': value})
    assert value not in str(error.value)


def test_guard_accepts_the_local_stack():
    demo.guard_environment({'API_URL': 'http://127.0.0.1:54321', 'OTRA': 'valor'})


@pytest.mark.parametrize('url', ['https://127.0.0.1:54321', 'http://example.com:54321', 'http://user:pw@127.0.0.1:54321',
                                 'http://127.0.0.1:54321/rest', 'http://10.0.0.5:54321'])
def test_api_url_must_be_plain_loopback(url):
    with pytest.raises(demo.DemoError):
        demo.check_api_url(url)
    assert demo.check_api_url('http://127.0.0.1:54321/') == 'http://127.0.0.1:54321'


def test_sql_literals_are_escaped_and_reject_nul():
    assert demo.sql_literal("o'neil") == "'o''neil'"
    with pytest.raises(demo.DemoError):
        demo.sql_literal('a\x00b')


def test_account_sql_only_creates_or_completes_and_never_deletes():
    passwords = {'consulta': 'abcAa1!', 'operador': 'defAa1!'}
    text = demo.accounts_sql(passwords, rotate={'operador'})
    lowered = text.lower()
    for forbidden in ('delete ', 'truncate', 'drop ', 'alter ', 'reset'):
        assert forbidden not in lowered
    assert text.count('extensions.crypt(') == 3  # dos altas posibles y una rotación pedida
    assert "'abcAa1!'" in text and "'defAa1!'" in text
    assert 'update auth.users set encrypted_password' in text and text.count('update auth.users') == 1
    assert 'MEMBRESIA_INESPERADA' in text and 'CUENTA_SIN_MEMBRESIA_CON_MEMBRESIA' in text
    assert text.startswith('begin;') and text.rstrip().endswith('commit;')


def test_private_files_are_owner_only(tmp_path, monkeypatch):
    monkeypatch.setenv('EQUITAS_DEMO_HOME', str(tmp_path / 'privado'))
    home = demo.demo_home()
    assert stat.S_IMODE(home.stat().st_mode) == 0o700
    target = home / 'cuentas.json'
    demo.write_private(target, '{}')
    assert stat.S_IMODE(target.stat().st_mode) == 0o600
    demo.save_credentials(home, {'consulta': {'password': 'x'}}, 'http://127.0.0.1:3000')
    for name in ('cuentas.json', 'cuentas.txt'):
        assert stat.S_IMODE((home / name).stat().st_mode) == 0o600
    assert 'init --rotar-claves' in (home / 'cuentas.txt').read_text()


def test_private_home_cannot_live_inside_the_repository_or_be_a_symlink(tmp_path, monkeypatch):
    monkeypatch.setenv('EQUITAS_DEMO_HOME', str(ROOT / '.equitas-demo-prueba'))
    with pytest.raises(demo.DemoError):
        demo.demo_home()
    assert not (ROOT / '.equitas-demo-prueba').exists(), 'Se rechaza antes de crear nada en el repositorio'
    link = tmp_path / 'enlace'
    link.symlink_to(tmp_path)
    monkeypatch.setenv('EQUITAS_DEMO_HOME', str(link))
    with pytest.raises(demo.DemoError):
        demo.demo_home()


HASHES = {'cabecera': MANIFEST['archivos']['cabecera.tsv']['sha256'], 'detalle': MANIFEST['archivos']['detalle.tsv']['sha256']}


def inventory(**overrides):
    batches = [{'id': index, 'tenant': 1, 'status': status, 'as_of': MANIFEST['fecha_corte'], 'atomica': 1, **HASHES}
               for index, status in enumerate(('RECIBIDO', 'VALIDADO', 'CONFIRMADO', 'PUBLICADO'), start=1)]
    base = {'tenants': [{'id': 1, 'name': demo.TENANT_A}, {'id': 2, 'name': demo.TENANT_B}],
            'auth_emails': [email for _, email, _, _ in demo.ACCOUNTS],
            'app_users': [{'email': email, 'auth': True} for _, email, _, _ in demo.ACCOUNTS] + [{'email': demo.IMPORT_ACTOR_EMAIL, 'auth': False}],
            'batches': batches, 'foreign_debtors_tenant1': 0, 'debtors_by_tenant': {'1': 15},
            'demo_debtors': 15, 'demo_debts': 29, 'demo_amount': MANIFEST['resultados_esperados']['importe_total_actualizado_ars']}
    base.update(overrides)
    return base


def test_own_resources_are_recognised_and_foreign_ones_reported():
    assert demo.classify(inventory(), HASHES) == {}
    foreign = demo.classify(inventory(tenants=[{'id': 1, 'name': demo.TENANT_A}, {'id': 920001, 'name': 'Municipio A'}],
                                      auth_emails=['otra@example.test'], foreign_debtors_tenant1=2, debtors_by_tenant={'1': 17, '920001': 3}), HASHES)
    assert set(foreign) == {'municipios', 'cuentas_auth', 'objetos_tenant_1', 'objetos_otros_municipios'}
    other_batch = inventory()['batches'] + [{'id': 9, 'tenant': 1, 'status': 'PUBLICADO', 'cabecera': 'x', 'detalle': 'y', 'atomica': 1}]
    assert demo.classify(inventory(batches=other_batch), HASHES) == {'lotes': ['9']}


def test_portfolio_check_compares_the_database_with_the_manifest():
    assert demo.check_portfolio(inventory(), HASHES) == []
    problems = demo.check_portfolio(inventory(demo_debtors=14, demo_amount='1.00', batches=[]), HASHES)
    assert len(problems) == 3
    unpublished = inventory()['batches'] + [{'id': 5, 'tenant': 1, 'status': 'FALLIDO', 'atomica': None, **HASHES}]
    assert any('corte no disponible' in problem for problem in demo.check_portfolio(inventory(batches=unpublished), HASHES))


def test_start_never_seeds_resets_or_loads(monkeypatch, tmp_path):
    monkeypatch.setenv('EQUITAS_DEMO_HOME', str(tmp_path / 'privado'))
    calls = []
    monkeypatch.setattr(demo, 'prepare', lambda home: {'API_URL': 'http://127.0.0.1:54321'})
    monkeypatch.setattr(demo, 'inventory', lambda home=None: inventory(demo_debtors=0, demo_debts=0, demo_amount='0', batches=[]))
    for name in ('publish_portfolio', 'accounts_sql', 'psql', 'ensure_build', 'start_next'):
        monkeypatch.setattr(demo, name, lambda *args, _name=name, **kwargs: calls.append(_name))
    with pytest.raises(demo.DemoError) as error:
        demo.cmd_start(type('Args', (), {'reiniciar': False, 'rebuild': False, 'puerto': 3000, 'horas': 24})())
    assert 'ejecutá init' in str(error.value)
    assert calls == []
    for command in (demo.cmd_start, demo.cmd_stop, demo.cmd_status, demo.cmd_renew):
        source = inspect.getsource(command)
        for forbidden in ('reset', 'accounts_sql', 'publish_portfolio', 'etl-compat-catalogs'):
            assert forbidden not in source, (command.__name__, forbidden)


def test_shared_db_turn_is_exclusive_and_only_releases_its_own(monkeypatch, tmp_path):
    monkeypatch.setattr(demo, 'SHARED_LOCK', tmp_path / 'equitas-local-db' / 'lock')
    with demo.db_turn('prueba'):
        assert (tmp_path / 'equitas-local-db' / 'lock' / 'owner.json').exists()
        with pytest.raises(demo.DemoError), demo.db_turn('otra'):
            pass
    assert not (tmp_path / 'equitas-local-db' / 'lock').exists()
    foreign = tmp_path / 'equitas-local-db' / 'lock'
    foreign.mkdir()
    with pytest.raises(demo.DemoError), demo.db_turn('prueba'):
        pass
    assert foreign.exists()


def test_a_run_file_pointing_to_another_process_is_not_treated_as_the_app(monkeypatch, tmp_path):
    monkeypatch.setenv('EQUITAS_DEMO_HOME', str(tmp_path / 'privado'))
    home = demo.demo_home()
    demo.write_private(demo.run_file(home), json.dumps({'pid': os.getpid()}))
    assert demo.own_next(home) is None
    assert demo.stop_next(home) is False
    assert not demo.run_file(home).exists()


def test_cli_refuses_destructive_recreation_without_the_phrase(capsys):
    assert demo.main(['recrear']) == 2
    assert demo.RECREATE_PHRASE in capsys.readouterr().err
    with pytest.raises(SystemExit):
        demo.main(['start', '--horas', '0'])
    with pytest.raises(SystemExit):
        demo.main(['renew', '--horas', str(demo.MAX_JWT_HOURS + 1)])
