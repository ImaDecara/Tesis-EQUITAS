"""Arranque aislado de la app contra la base original: start | stop | status.

No inicia importadores, Docker ni aplica SQL. Configuración: ~/.equitas-original/app.env.
Solo las dos variables públicas; ni credenciales administrativas ni JWT de servidor.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shlex
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
FRONT = ROOT / 'front'
ORIGINAL_URL = 'https://folyslqzqvnpolexcxjo.supabase.co'
PORT = 3200
BUILD = FRONT / 'build/original-next'
PUBLIC = {'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'}


class OriginalError(RuntimeError):
    pass


def private_home() -> Path:
    home = Path.home() / '.equitas-original'
    if home.is_symlink():
        raise OriginalError('La carpeta privada no puede ser un enlace.')
    home.mkdir(mode=0o700, exist_ok=True)
    home.chmod(0o700)
    return home


def write_private(path: Path, text: str) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'w') as handle:
        handle.write(text)
    path.chmod(0o600)


def guard_environment(env: dict[str, str]) -> None:
    for key, value in env.items():
        name = key.upper()
        if value and key not in PUBLIC and (
            name.startswith(('SUPABASE_', 'EQUITAS_IMPORT', 'EQUITAS_REVIEW', 'PGPASSWORD', 'DATABASE_URL'))
            or any(marker in name for marker in ('SERVICE_ROLE', 'SERVER_JWT', 'JWT_SECRET'))
            or value.startswith('sb_secret_')
        ):
            raise OriginalError('Hay una credencial de servidor, importación o base en el entorno. Usá una terminal limpia.')


def configuration(home: Path) -> dict[str, str]:
    guard_environment(dict(os.environ))
    path = home / 'app.env'
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise OriginalError('Falta app.env privado (modo 0600, sin enlaces).')
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, sep, raw = line.partition('=')
        parsed = shlex.split(raw)
        if not sep or key not in PUBLIC or key in values or len(parsed) != 1:
            raise OriginalError('app.env debe contener únicamente las dos variables públicas, sin duplicados.')
        values[key] = parsed[0]
    if set(values) != PUBLIC or values['NEXT_PUBLIC_SUPABASE_URL'] != ORIGINAL_URL:
        raise OriginalError('Se requiere la URL exacta del proyecto original; no se acepta otro destino.')
    if not values['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'].startswith('sb_publishable_'):
        raise OriginalError('Se requiere una clave publicable; no se admiten JWT ni service_role.')
    # Next carga .env automáticamente, aun cuando Popen reciba un entorno limpio.
    for folder in (ROOT, FRONT):
        if any((folder / name).exists() for name in ('.env', '.env.local', '.env.production', '.env.production.local')):
            raise OriginalError('Hay un archivo .env que Next podría cargar. Movelo fuera de esta carpeta antes de arrancar.')
    return values


def command(*args: str) -> str:
    return subprocess.check_output(args, cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()


def child_environment(values: dict[str, str]) -> dict[str, str]:
    return {'PATH': os.environ.get('PATH', ''), 'HOME': str(Path.home()), 'NODE_ENV': 'production',
            'NEXT_TELEMETRY_DISABLED': '1', 'EQUITAS_ORIGINAL_BUILD': '1',
            'QUALITY_SOURCE_SHA': command('git', 'rev-parse', 'HEAD'), **values}


def port_busy() -> bool:
    with socket.socket() as sock:
        try:
            sock.bind(('127.0.0.1', PORT))
        except OSError:
            return True
    return False


def process_identity(pid: int) -> dict[str, str] | None:
    if pid <= 1:
        return None
    try:
        cmd = command('ps', '-o', 'command=', '-p', str(pid))
        started = command('ps', '-o', 'lstart=', '-p', str(pid))
        cwd = command('lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn')
    except (OSError, subprocess.CalledProcessError):
        return None
    if not any(marker in cmd for marker in ('next-server', 'next/dist/bin/next')):
        return None
    if f'n{FRONT.resolve()}' not in cwd.splitlines():
        return None
    return {'started': started, 'cwd': str(FRONT.resolve())}


def own_process(home: Path) -> dict | None:
    path = home / 'app.json'
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    return data if process_identity(data['pid']) == data['identity'] else None


def build(home: Path, values: dict[str, str]) -> None:
    if not (FRONT / 'node_modules/next/dist/bin/next').is_file():
        raise OriginalError('Faltan las dependencias del frontend.')
    if not (ROOT / 'contracts').is_dir():
        raise OriginalError('La compilación necesita contracts/ junto a front/.')
    BUILD.parent.mkdir(parents=True, exist_ok=True)
    config = {'extends': '../tsconfig.json', 'include': ['../next-env.d.ts', '../**/*.ts', '../**/*.tsx',
                                                       'original-next/types/**/*.ts'],
              'exclude': ['../node_modules', '../.next']}
    (BUILD.parent / 'original-tsconfig.json').write_text(json.dumps(config, indent=2) + '\n')
    log = home / 'build.log'
    write_private(log, '')
    print('Compilando con las dos variables públicas; salida en el registro privado.', flush=True)
    with log.open('a') as handle:
        result = subprocess.run(['node', 'node_modules/next/dist/bin/next', 'build'], cwd=FRONT,
                                env=child_environment(values), stdout=handle, stderr=handle, timeout=1800, check=False)
    if result.returncode:
        raise OriginalError('Falló la compilación. Revisá ~/.equitas-original/build.log (no incluye credenciales).')


def start(home: Path) -> None:
    values = configuration(home)
    if port_busy():
        raise OriginalError('El puerto 3200 está ocupado. No se detuvo ni modificó ese proceso.')
    if own_process(home):
        raise OriginalError('Esta carpeta ya tiene una aplicación original en marcha.')
    build(home, values)
    if port_busy():
        raise OriginalError('El puerto 3200 se ocupó durante la compilación.')
    log = home / 'app.log'
    write_private(log, '')
    with log.open('a') as handle:
        process = subprocess.Popen(['node', 'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1',
                                    '--port', str(PORT)], cwd=FRONT, env=child_environment(values),
                                   stdout=handle, stderr=handle, stdin=subprocess.DEVNULL, start_new_session=True)
    for _ in range(60):
        if process.poll() is not None:
            raise OriginalError('La aplicación terminó durante el arranque; revisá el registro privado.')
        identity = process_identity(process.pid)
        if identity:
            write_private(home / 'app.json', json.dumps({'pid': process.pid, 'identity': identity,
                          'sha': command('git', 'rev-parse', 'HEAD')}) + '\n')
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{PORT}/api/build-info', timeout=2) as response:
                info = json.load(response)
            if info.get('supabaseProjectRef') != 'folyslqzqvnpolexcxjo':
                raise OriginalError('La compilación no declara el destino esperado.')
            if identity:
                print('Aplicación lista: http://127.0.0.1:3200/login · base original, solo lectura, sin importador.')
                return
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(1)
    stop(home)
    raise OriginalError('La aplicación no respondió dentro del plazo de arranque.')


def stop(home: Path) -> None:
    data = own_process(home)
    if not data:
        print('No hay un proceso propio verificado en esta carpeta. No se detuvo ningún proceso.')
        return
    os.kill(data['pid'], signal.SIGTERM)
    (home / 'app.json').unlink()
    print('Aplicación original detenida. Las demos y las bases quedaron intactas.')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['start', 'stop', 'status'])
    args = parser.parse_args()
    try:
        home = private_home()
        if args.command == 'start':
            start(home)
        elif args.command == 'stop':
            stop(home)
        else:
            print('Aplicación original: ' + ('en marcha en http://127.0.0.1:3200' if own_process(home) else 'detenida'))
        return 0
    except OriginalError as error:
        print(str(error), file=sys.stderr)
        return 2
    except (OSError, ValueError, subprocess.SubprocessError):
        # No mostrar excepciones con URLs, entornos o contenido de archivos privados.
        print('No se pudo completar el comando. Revisá destino, permisos 0600, entorno limpio, puerto y registro privado.', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
