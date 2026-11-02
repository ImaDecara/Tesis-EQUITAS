"""Temporal privado de los archivos recibidos (ALIGN-052).

Disposición, siempre con directorios 0700 y archivos 0600:

    <raíz>/incoming/<token de 128 bits>/<clase>   durante la recepción
    <raíz>/lotes/<tenant>/<lote>/<clase>          desde que el lote queda registrado

Ninguna ruta se arma con datos del cliente: el token es propio, tenant y lote son enteros
resueltos en el servidor y la clase sale de una lista cerrada. Lo abandonado se retira por
TTL con `purge_expired`, que la API llama en cada recepción y en cada descarte. Se lee con
ETL/readers de ALIGN-053 cuando esté integrado, en un proceso aparte (`importacion-web.md`).
"""

import os
import re
import secrets
import shutil
import stat
import time
from collections.abc import Callable
from pathlib import Path
from typing import BinaryIO

DEFAULT_TTL_SECONDS = 86_400
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

    def discard(self, token: str) -> None:
        shutil.rmtree(self._incoming_dir(token), ignore_errors=True)

    def files(self, tenant: int, batch: int) -> dict[str, Path]:
        directory = self._batch_dir(tenant, batch)
        if not directory.is_dir():
            return {}
        return {path.name: path for path in sorted(directory.iterdir())}

    def release(self, tenant: int, batch: int) -> None:
        """Se borra al descartar o publicar. Es idempotente."""
        shutil.rmtree(self._batch_dir(tenant, batch), ignore_errors=True)

    def _expired(self, entry: os.DirEntry) -> bool:
        info = entry.stat(follow_symlinks=False)
        return (
            stat.S_ISDIR(info.st_mode)
            and info.st_mtime + self.ttl_seconds <= self._clock()
        )

    def _purge_directory(self, directory: Path) -> int:
        removed = 0
        for entry in os.scandir(directory):
            try:
                if self._expired(entry):
                    shutil.rmtree(entry.path, ignore_errors=True)
                    removed += 1
            except FileNotFoundError:  # Otra solicitud lo retiró o lo publicó.
                continue
        return removed

    def purge_expired(self) -> int:
        removed = self._purge_directory(self._incoming)
        for tenant in os.scandir(self._batches):
            if tenant.is_dir(follow_symlinks=False):
                removed += self._purge_directory(Path(tenant.path))
        return removed
