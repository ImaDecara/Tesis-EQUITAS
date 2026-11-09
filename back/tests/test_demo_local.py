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
            'memberships': [{'email': email, 'tenant': tenant, 'role': role, 'active': True} for email, tenant, role in sorted(demo.expected_memberships())],
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
        owner = json.loads((tmp_path / 'equitas-local-db' / 'lock' / 'owner.json').read_text())
        assert owner['tool'] == 'equitas-demo' and owner['pid'] == os.getpid()
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


# ------------------------------------------------------------------ ciclo 1 de N6 (N6-R1 a N6-R4)

def report(**tables):
    base = {'tables': [{'t': name, 'rows': rows, 'foreign': foreign} for name, (rows, foreign) in tables.items()],
            'databases': list(demo.KNOWN_DATABASES), 'largeobjects': 0}
    return base


def test_recreate_needs_every_row_proven_own():
    clean = report(**{'public.debtor': (15, 0), 'public.debt': (29, 0), 'auth.users': (6, 0), 'storage.migrations': (61, 0)})
    assert demo.recreate_blockers(clean) == []
    assert demo.recreate_blockers(report(**{'public.debtor': (0, 0)})) == []
    blocked = demo.recreate_blockers(report(**{'public.debtor': (16, 1), 'public.data_source': (1, 1), 'storage.migrations': (62, 62)}))
    assert any(item.startswith('public.debtor: 1 de 16') for item in blocked)
    assert any(item.startswith('public.data_source: 1 de 1') for item in blocked)
    assert any(item.startswith('storage.migrations: 62 de 62') for item in blocked)
    assert any('la demo tiene 0 o 15' in item for item in blocked)
    odd = report(**{'public.debtor': (15, 0)})
    odd['databases'] = [*odd['databases'], 'otra']
    odd['largeobjects'] = 2
    assert len(demo.recreate_blockers(odd)) == 2


def test_exhaustive_inventory_denies_unknown_tables_and_null_identifiers(monkeypatch, tmp_path):
    monkeypatch.setenv('EQUITAS_DEMO_HOME', str(tmp_path / 'privado'))
    home = demo.demo_home()
    listing = 'public.debtor\nstorage.migrations\nalgo.desconocido\npublic."raro"'
    queries = []
    monkeypatch.setattr(demo, 'psql', lambda text, **kwargs: listing)
    monkeypatch.setattr(demo, 'psql_json', lambda query, **kwargs: queries.append(query) or {'tables': [], 'databases': [], 'largeobjects': 0})
    demo.exhaustive_inventory(home, HASHES)
    query = queries[0]
    assert 'from "algo"."desconocido")' in query and '"algo"."desconocido" where' not in query  # desconocida: todas sus filas son ajenas
    assert 'case when count(*) = 61 then 0 else count(*) end from "storage"."migrations"' in query
    assert 'from "public"."debtor" where not coalesce((tenant = 1 and identifier in (' in query  # NULL nunca es propio
    rules = demo.ownership_rules(HASHES)
    assert all(case['identificador'] in rules['public.debtor'] for case in MANIFEST['casos'])
    assert 'like' not in rules['public.debtor'].lower()
    assert 'not coalesce(identifier in (' in demo.inventory_sql()


def test_unexpected_memberships_are_reported_as_foreign():
    inv = inventory(memberships=[{'email': 'demo-consulta@example.test', 'tenant': demo.TENANT_A, 'role': 'supervisor', 'active': True},
                                 {'email': 'demo-operador@example.test', 'tenant': demo.TENANT_A, 'role': 'operador', 'active': True}])
    assert demo.classify(inv, HASHES) == {'membresias': [f'demo-consulta@example.test:{demo.TENANT_A}:supervisor']}
    inactive = inventory(memberships=[{'email': 'demo-operador@example.test', 'tenant': demo.TENANT_A, 'role': 'operador', 'active': False}])
    assert demo.classify(inactive, HASHES) == {'membresias': [f'demo-operador@example.test:{demo.TENANT_A}:operador']}


def test_psql_errors_never_persist_sql_or_passwords(monkeypatch, tmp_path):
    monkeypatch.setenv('EQUITAS_DEMO_HOME', str(tmp_path / 'privado'))
    home = demo.demo_home()
    secret = 'f00dfeed0123456789abcdefAa1!'
    stderr = (f"psql:<stdin>:9: ERROR:  duplicate key value violates unique constraint \"user_email_key\"\n"
              f"LINE 4: ...extensions.crypt('{secret}', extensions.gen_salt('bf', 10))\n                     ^\n"
              f"CONTEXT:  SQL statement \"insert ... '{secret}'\"\nQUERY:  select '{secret}'\n")
    monkeypatch.setattr(demo, 'run', lambda *args, **kwargs: subprocess.CompletedProcess(args, 3, '', stderr))
    with pytest.raises(demo.DemoError) as error:
        demo.psql('select 1;', home=home, secrets_in_sql=(secret,))
    assert secret not in str(error.value)
    logs = list((home / 'logs').glob('*psql-error.log'))
    assert len(logs) == 1
    text = logs[0].read_text()
    assert secret not in text and 'LINE' not in text and 'CONTEXT' not in text and 'QUERY' not in text
    assert text.startswith('ERROR:  duplicate key value')


def test_command_logs_are_saved_redacted(monkeypatch, tmp_path):
    monkeypatch.setenv('EQUITAS_DEMO_HOME', str(tmp_path / 'privado'))
    home = demo.demo_home()
    log = demo.private_log(home, 'prueba')
    noisy = ('print("anon key: eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.firma-sintetica");'
             'print("JWT secret: super-secret-jwt-token-sintetico-de-prueba");'
             'print("Publishable key: sb_publishable_SINTETICA0123456789");'
             'print("S3 Access Key: 0123456789abcdef0123456789abcdef")')
    result = demo.run([sys.executable, '-I', '-c', noisy], log=log, timeout=60)
    assert result.returncode == 0 and result.stdout == ''
    text = log.read_text()
    for leak in ('eyJ', 'super-secret', 'sb_publishable_', '0123456789abcdef0123'):
        assert leak not in text, leak
    assert stat.S_IMODE(log.stat().st_mode) == 0o600


@pytest.fixture
def foreign_turn(monkeypatch, tmp_path):
    lock = tmp_path / 'equitas-local-db' / 'lock'
    lock.mkdir(parents=True)
    monkeypatch.setattr(demo, 'SHARED_LOCK', lock)
    monkeypatch.setenv('EQUITAS_DEMO_HOME', str(tmp_path / 'privado'))
    commands = []
    monkeypatch.setattr(demo, 'run', lambda command, **kwargs: commands.append(list(command)) or subprocess.CompletedProcess(command, 0, '', ''))
    monkeypatch.setattr(demo, 'docker_ready', lambda: True)
    monkeypatch.setattr(demo, 'guard_environment', lambda environ=None: None)
    return lock, commands


def test_stop_stack_does_nothing_while_another_turn_holds_the_db(foreign_turn, monkeypatch):
    lock, commands = foreign_turn
    monkeypatch.setattr(demo, 'stack_running', lambda: True)
    monkeypatch.setattr(demo, 'stop_next', lambda home: False)
    with pytest.raises(demo.DemoError):
        demo.cmd_stop(type('Args', (), {'stack': True})())
    assert commands == [] and lock.exists()


def test_init_recreate_and_stack_start_take_the_turn_first(foreign_turn, monkeypatch):
    lock, commands = foreign_turn
    touched = []
    monkeypatch.setattr(demo, 'prepare', lambda home: touched.append('prepare'))
    args = type('Args', (), {'rotar_claves': False, 'republicar': False, 'puerto': 3000, 'confirmar': demo.RECREATE_PHRASE})()
    for command in (demo.cmd_init, demo.cmd_recreate):
        with pytest.raises(demo.DemoError):
            command(args)
    monkeypatch.setattr(demo, 'stack_running', lambda: False)
    with pytest.raises(demo.DemoError):
        demo.ensure_stack(demo.demo_home())
    assert touched == [] and commands == [] and lock.exists()


def test_the_turn_is_reentrant_inside_one_process(monkeypatch, tmp_path):
    lock = tmp_path / 'equitas-local-db' / 'lock'
    monkeypatch.setattr(demo, 'SHARED_LOCK', lock)
    with demo.db_turn('externo'), demo.db_turn('interno'):
        assert lock.exists()
    assert not lock.exists() and demo._TURN['nonce'] is None


def test_uncommitted_changes_always_rebuild(monkeypatch, tmp_path):
    monkeypatch.setenv('EQUITAS_DEMO_HOME', str(tmp_path / 'privado'))
    home = demo.demo_home()
    front = tmp_path / 'front'
    (front / 'node_modules/next/dist/bin').mkdir(parents=True)
    (front / 'node_modules/next/dist/bin/next').write_text('')
    (front / '.next').mkdir()
    (front / '.next/BUILD_ID').write_text('x')
    monkeypatch.setattr(demo, 'FRONT', front)
    env = {'API_URL': 'http://127.0.0.1:54321', 'PUBLISHABLE_KEY': 'clave-publicable-sintetica'}
    status = {'value': ''}
    monkeypatch.setattr(demo, 'git', lambda *args: status['value'] if args[0] == 'status' else 'a' * 40)
    builds = []
    monkeypatch.setattr(demo, 'run', lambda command, **kwargs: builds.append(command) or subprocess.CompletedProcess(command, 0, '', ''))
    (front / '.next/equitas-demo-build.json').write_text(json.dumps(demo.build_stamp(env)))
    demo.ensure_build(home, env)
    assert builds == []
    status['value'] = ' M front/app/page.tsx'
    demo.ensure_build(home, env)
    demo.ensure_build(home, env)
    assert len(builds) == 2
