"""Temporal privado de los archivos recibidos (ALIGN-052).

Disposición, siempre con directorios 0700 y archivos 0600:

    <raíz>/incoming/<token de 128 bits>/<clase>   durante la recepción
    <raíz>/lotes/<tenant>/<lote>/<clase>          desde que el lote queda registrado

Ninguna ruta se arma con datos del cliente: el token es propio, tenant y lote son enteros
resueltos en el servidor y la clase sale de una lista cerrada. Lo abandonado se retira por
TTL: la API corre `purge_expired` al arrancar y periódicamente, sin depender de que alguien
suba o descarte, y `files` no entrega ni deja una copia vencida. Se lee con ETL/readers de
ALIGN-053 cuando esté integrado, en un proceso aparte (`importacion-web.md`).
"""

import hashlib
import logging
import os
import re
import secrets
import shutil
import stat
import time
from collections.abc import Callable
from pathlib import Path
from typing import BinaryIO

logger = logging.getLogger("equitas.api")

DEFAULT_TTL_SECONDS = 86_400
HASH_CHUNK_BYTES = 1 << 20
FILE_KINDS = frozenset({"cabecera", "detalle", "libro"})
_TOKEN = re.compile(r"[0-9a-f]{32}")


class UploadStoreError(RuntimeError):
    """Mensaje fijo: nunca incluye rutas."""

    def __init__(self) -> None:
        super().__init__("ALMACEN_TEMPORAL_INSEGURO")


def _private_directory(path: Path, *, parents: bool = False) -> Path:
    try:
        path.mkdir(mode=0o700, parents=parents, exist_ok=True)
        info = os.lstat(path)
    except OSError:
        raise UploadStoreError() from None
    if not stat.S_ISDIR(info.st_mode):
        raise UploadStoreError()
    if os.name == "posix" and (info.st_mode & 0o077 or info.st_uid != os.getuid()):
        raise UploadStoreError()
    return path


def _positive_id(value: int) -> str:
    if type(value) is not int or value < 1:
        raise UploadStoreError()
    return str(value)


class UploadStore:
    def __init__(
        self,
        root: Path,
        *,
        ttl_seconds: int = DEFAULT_TTL_SECONDS,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.root = _private_directory(Path(root), parents=True)
        self.ttl_seconds = ttl_seconds
        self._clock = clock
        self._incoming = _private_directory(self.root / "incoming")
        self._batches = _private_directory(self.root / "lotes")

    def _incoming_dir(self, token: str) -> Path:
        if not isinstance(token, str) or not _TOKEN.fullmatch(token):
            raise UploadStoreError()
        return self._incoming / token

    def _batch_dir(self, tenant: int, batch: int) -> Path:
        return self._batches / _positive_id(tenant) / _positive_id(batch)

    def _touch(self, path: Path) -> None:
        now = self._clock()
        os.utime(path, (now, now))

    def begin(self) -> str:
        token = secrets.token_hex(16)
        path = self._incoming_dir(token)
        path.mkdir(mode=0o700)
        self._touch(path)
        return token

    def open_part(self, token: str, kind: str) -> BinaryIO:
        directory = self._incoming_dir(token)
        if kind not in FILE_KINDS or not directory.is_dir():
            raise UploadStoreError()
        flags = (
            os.O_WRONLY
            | os.O_CREAT
            | os.O_EXCL
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_BINARY", 0)
        )
        return os.fdopen(os.open(directory / kind, flags, 0o600), "wb")

    def prepare(self, tenant: int) -> None:
        """Se llama antes de registrar el lote: si el destino no sirve, no hay fila sin copia."""
        _private_directory(self._batches / _positive_id(tenant))

    def commit(self, token: str, tenant: int, batch: int) -> bool:
        """Mueve lo recibido al lote. False si el lote ya tiene su copia: se conserva."""
        source = self._incoming_dir(token)
        target = self._batch_dir(tenant, batch)
        _private_directory(target.parent)
        try:
            os.rename(source, target)
        except OSError:
            if target.exists():
                return False
            raise
        self._touch(target)
        return True

    def replace(self, token: str, tenant: int, batch: int) -> None:
        """Instala lo recibido en lugar de una copia que no verificó. Si otra solicitud
        instaló la suya justo antes, se conserva esa: quien llama vuelve a verificar."""
        source = self._incoming_dir(token)
        target = self._batch_dir(tenant, batch)
        _private_directory(target.parent)
        stale = self._incoming_dir(secrets.token_hex(16))
        try:
            os.rename(target, stale)
        except FileNotFoundError:
            pass
        try:
            os.rename(source, target)
        except OSError:
            if not target.exists():
                raise
        else:
            self._touch(target)
        finally:
            shutil.rmtree(stale, ignore_errors=True)

    def discard(self, token: str) -> None:
        shutil.rmtree(self._incoming_dir(token), ignore_errors=True)

    def _live_copy(self, tenant: int, batch: int) -> tuple[Path, os.stat_result] | None:
        """El directorio del lote si existe y no venció. Lo vencido no se entrega ni se deja."""
        directory = self._batch_dir(tenant, batch)
        try:
            info = os.lstat(directory)
        except OSError:
            return None
        if not stat.S_ISDIR(info.st_mode):
            return None
        if info.st_mtime + self.ttl_seconds <= self._clock():
            shutil.rmtree(directory, ignore_errors=True)
            return None
        return directory, info

    def files(self, tenant: int, batch: int) -> dict[str, Path]:
        """Rutas de la copia vigente: solo archivos regulares de las clases conocidas.
        Para confiar en el contenido, `verify` compara contra los hashes del lote."""
        live = self._live_copy(tenant, batch)
        if live is None:
            return {}
        with os.scandir(live[0]) as entries:
            found = [
                (entry.name, Path(entry.path))
                for entry in entries
                if entry.name in FILE_KINDS and entry.is_file(follow_symlinks=False)
            ]
        return dict(sorted(found))

    def verify(self, tenant: int, batch: int, hashes: dict[str, str]) -> bool:
        """Copia completa y con los hashes declarados, vigente. Lee todos los bytes."""
        found = self.files(tenant, batch)
        if set(found) != set(hashes):
            return False
        for kind, path in found.items():
            digest = hashlib.sha256()
            with path.open("rb") as handle:
                while chunk := handle.read(HASH_CHUNK_BYTES):
                    digest.update(chunk)
            if digest.hexdigest() != hashes[kind]:
                return False
        return True

    def describe(
        self, tenant: int, batch: int, hashes: dict[str, str], total_bytes: int | None
    ) -> tuple[bool, float | None]:
        """Estado barato para mostrar, sin leer los archivos: clases y tamaño total."""
        found = self.files(tenant, batch)
        if not found:
            return False, None
        size = sum(path.stat().st_size for path in found.values())
        complete = set(found) == set(hashes) and total_bytes in (None, size)
        expires_at = os.lstat(self._batch_dir(tenant, batch)).st_mtime + self.ttl_seconds
        return complete, expires_at

    def release(self, tenant: int, batch: int) -> None:
        """Se borra al descartar o publicar. Es idempotente."""
        shutil.rmtree(self._batch_dir(tenant, batch), ignore_errors=True)

    def _expired(self, entry: os.DirEntry) -> bool:
        info = entry.stat(follow_symlinks=False)
        return (
            stat.S_ISDIR(info.st_mode)
            and info.st_mtime + self.ttl_seconds <= self._clock()
        )

    def _purge_directory(self, directory: Path) -> tuple[int, int]:
        removed = pending = 0
        for entry in os.scandir(directory):
            try:
                if not self._expired(entry):
                    continue
            except FileNotFoundError:  # Otra solicitud lo retiró o lo publicó.
                continue
            shutil.rmtree(entry.path, ignore_errors=True)
            if os.path.lexists(entry.path):
                pending += 1
            else:
                removed += 1
        return removed, pending

    def purge_expired(self) -> int:
        """Devuelve lo retirado. Lo que no se pudo borrar se informa y `files` no lo entrega."""
        removed, pending = self._purge_directory(self._incoming)
        for tenant in os.scandir(self._batches):
            if tenant.is_dir(follow_symlinks=False):
                tenant_removed, tenant_pending = self._purge_directory(Path(tenant.path))
                removed += tenant_removed
                pending += tenant_pending
        if pending:
            logger.warning("PURGA_INCOMPLETA pendientes=%s", pending)
        return removed
