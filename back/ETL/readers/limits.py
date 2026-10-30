"""Límites y política de archivos de origen: tipo por contenido, nombres y temporales.

Sin servicios externos. Los errores son códigos con ubicación lógica: nunca incluyen
valores, nombres de archivo subidos ni rutas.
"""

from __future__ import annotations

import os
import re
import secrets
import shutil
import stat
import tempfile
import time
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from ETL.validate_source import ValidationError

XLS_MESSAGE = 'Formato .xls no soportado: guardá el archivo como .xlsx o .csv'
OLE2_SIGNATURE = b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'
ZIP_SIGNATURES = (b'PK\x03\x04', b'PK\x05\x06')
SNIFF_BYTES = 8192
_COPY_CHUNK = 1 << 16
_CONTROL = re.compile('[\x01-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]')
# Inyección al reabrir en una planilla. Deja pasar negativos, teléfonos y el marcador «-».
_FORMULA = re.compile(r'=.|@\w+\(|[+-][^\W\d_]|[+-][0-9.,]+\s*[+*/^&=<>]', re.DOTALL)
_TOKEN = re.compile(r'[0-9a-f]{32}')


@dataclass(frozen=True)
class FileLimits:
    file_bytes: int = 25_000_000
    rows: int = 300_000
    columns: int = 60
    cell: int = 32_767
    uncompressed_bytes: int = 200_000_000
    compression_ratio: int = 100
    zip_parts: int = 2_048
    zip_directory_bytes: int = 1_048_576
    # openpyxl arma estas partes enteras en memoria; las hojas se recorren en flujo.
    part_bytes: int = 8_000_000
    shared_strings_bytes: int = 64_000_000
    workbook_sheets: int = 32
    read_seconds: float = 120.0
    temp_ttl_seconds: int = 86_400

    @classmethod
    def from_contract(cls, contract, **overrides):
        limits = contract['limites']
        return cls(file_bytes=limits['bytes'], rows=limits['filas'], columns=limits['columnas'],
                   cell=limits['celda'], **overrides)


class Deadline:
    """Tiempo máximo de lectura de un lote completo."""

    def __init__(self, seconds, clock=time.monotonic):
        self._clock = clock
        self._at = clock() + seconds

    def check(self, kind, line=0):
        if self._clock() >= self._at:
            source_error('TIEMPO_LECTURA_EXCEDIDO', kind, line)


def source_error(code, kind, line=0, field='*'):
    # kind/field son nombres del contrato, nunca rutas o valores municipales.
    raise ValidationError(f'{code}: archivo={kind}, linea={line}, campo={field}')


def reject_xls():
    raise ValidationError(f'FORMATO_XLS_NO_SOPORTADO: {XLS_MESSAGE}')


def reject_forbidden_name(name):
    """El nombre nunca habilita un formato; solo agrega estos dos rechazos explícitos."""
    suffix = Path(str(name).rstrip(' .')).suffix.lower()
    if suffix == '.xls':
        reject_xls()
    if suffix == '.xlsm':
        raise ValidationError('MACRO_NO_PERMITIDA')


def open_source(path, kind, source_type, limits):
    """Abre una ruta del servidor y detecta el tipo por contenido; devuelve el flujo binario."""
    try:
        path = Path(path)
        reject_forbidden_name(path.name)
        if not path.is_file():
            source_error('ARCHIVO_NO_LEIBLE', kind)
        stream = path.open('rb')
    except ValidationError:
        raise
    except (OSError, TypeError, ValueError):
        source_error('ARCHIVO_NO_LEIBLE', kind)
    try:
        if os.fstat(stream.fileno()).st_size > limits.file_bytes:
            source_error('LIMITE_ARCHIVO_EXCEDIDO', kind)
        head = stream.read(SNIFF_BYTES)
        stream.seek(0)
        if head.startswith(OLE2_SIGNATURE):
            reject_xls()
        if head.startswith(ZIP_SIGNATURES) != (source_type == 'xlsx'):
            source_error('FORMATO_NO_SOPORTADO', kind)
        # Un NUL en una fila posterior es un defecto ubicable de esa fila, no un binario.
        if source_type != 'xlsx' and b'\x00' in head.partition(b'\n')[0]:
            source_error('CONTENIDO_NO_TEXTO', kind)
    except BaseException:
        stream.close()
        raise
    return stream


def check_cells(values, kind, line, limits):
    for value in values:
        if '\x00' in value or '\n' in value or '\r' in value:
            source_error('ESTRUCTURA_INVALIDA', kind, line)
        if _CONTROL.search(value):
            source_error('CARACTER_CONTROL', kind, line)
        if len(value) > limits.cell:
            source_error('CELDA_EXCEDE_LIMITE', kind, line)
        if value[:1] in ('=', '+', '-', '@') and _FORMULA.match(value):
            source_error('FORMULA_EN_CELDA', kind, line)


def check_header(raw_columns, kind, limits):
    columns = [name.strip() for name in raw_columns]
    if not columns or any(not name for name in columns) or len(set(columns)) != len(columns):
        source_error('ESTRUCTURA_INVALIDA', kind, 1)
    if len(columns) > limits.columns:
        source_error('LIMITE_ARCHIVO_EXCEDIDO', kind, 1)
    return columns


def sanitize_filename(name, limit=120):
    """Nombre solo para mostrar: sin rutas ni controles. Nunca se usa para abrir un archivo."""
    text = unicodedata.normalize('NFKC', str(name))
    text = re.split(r'[\\/]', text)[-1]
    text = ''.join(char for char in text if unicodedata.category(char)[0] != 'C')
    text = re.sub(r'[^\w .()-]', '_', text).strip(' .')
    stem, suffix = os.path.splitext(text)
    suffix = suffix[:12]
    return (stem[:limit - len(suffix)] + suffix) or 'archivo'


@dataclass(frozen=True)
class StoredUpload:
    token: str
    display_name: str
    path: Path
    size: int
    expires_at: float


class PrivateUploadStore:
    """Temporales privados con TTL: el nombre en disco es un token, nunca el del usuario.

    Hay que llamar a ``release`` al publicar o descartar; ``purge_expired`` retira lo
    abandonado y corre también en cada ``save``. Ningún método envía datos afuera.
    """

    def __init__(self, root=None, limits=None, clock=time.time):
        self.limits = FileLimits() if limits is None else limits
        self._clock = clock
        self.root = Path(tempfile.mkdtemp(prefix='equitas-uploads-')) if root is None else Path(root)
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = os.lstat(self.root)
        if not stat.S_ISDIR(info.st_mode) or (os.name == 'posix' and (
                info.st_mode & 0o077 or info.st_uid != os.getuid())):
            raise ValidationError('ALMACEN_TEMPORAL_INSEGURO')

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def _path(self, token):
        if not isinstance(token, str) or not _TOKEN.fullmatch(token):
            raise ValidationError('TEMPORAL_INVALIDO')
        return self.root / token

    def save(self, source, original_name):
        """Copia un flujo con tope de bytes; si falla, no queda archivo parcial."""
        self.purge_expired()
        reject_forbidden_name(sanitize_filename(original_name))
        token = secrets.token_hex(16)
        path = self._path(token)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_BINARY', 0)
        size = 0
        try:
            with os.fdopen(os.open(path, flags, 0o600), 'wb') as target:
                while chunk := source.read(_COPY_CHUNK):
                    size += len(chunk)
                    if size > self.limits.file_bytes:
                        raise ValidationError('LIMITE_ARCHIVO_EXCEDIDO')
                    target.write(chunk)
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        return StoredUpload(token, sanitize_filename(original_name), path, size,
                            self._clock() + self.limits.temp_ttl_seconds)

    def resolve(self, token):
        path = self._path(token)
        try:
            expired = os.lstat(path).st_mtime + self.limits.temp_ttl_seconds <= self._clock()
        except OSError:
            raise ValidationError('TEMPORAL_INEXISTENTE') from None
        if expired:
            path.unlink(missing_ok=True)
            raise ValidationError('TEMPORAL_INEXISTENTE')
        return path

    def release(self, token):
        """Borra al publicar o descartar. Es idempotente."""
        self._path(token).unlink(missing_ok=True)

    def purge_expired(self):
        removed = 0
        for entry in os.scandir(self.root):
            if entry.stat(follow_symlinks=False).st_mtime + self.limits.temp_ttl_seconds <= self._clock():
                Path(entry.path).unlink(missing_ok=True)
                removed += 1
        return removed

    def close(self):
        shutil.rmtree(self.root, ignore_errors=True)
