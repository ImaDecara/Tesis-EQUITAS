"""Temporal privado de los archivos recibidos (ALIGN-052).

Disposición, siempre con directorios 0700 y archivos 0600:

    <raíz>/incoming/<token de 128 bits>/<clase>   durante la recepción
    <raíz>/lotes/<tenant>/<lote>/<clase>          desde que el lote queda registrado
    <raíz>/retirados/<token>/                     una generación retirada, hasta borrarla
    <raíz>/bloqueos/<NN>.lock                     exclusión por lote; no guardan datos

Ninguna ruta se arma con datos del cliente: el token es propio, tenant y lote son enteros
resueltos en el servidor y la clase sale de una lista cerrada. Lo abandonado se retira por
TTL: la API corre `purge_expired` al arrancar y periódicamente, sin depender de que alguien
suba o descarte, y `files` no entrega ni deja una copia vencida. Se lee con ETL/readers de
ALIGN-053 cuando esté integrado, en un proceso aparte (`importacion-web.md`).

**Concurrencia.** El nombre de un lote puede ir ocupándolo una copia tras otra: una generación
vence, un reintento instala la siguiente en la misma ruta. Por eso:

- `lock(tenant, lote)` da exclusión real por lote, entre hilos y entre procesos, y el núcleo la
  suelta si el proceso muere. Instalar, retirar y decidir sobre una copia ocurren bajo ella.
- Nada se borra por el nombre del lote. Bajo la exclusión, la generación se mueve a un nombre
  privado de `retirados/`, y recién ahí se borra: una decisión vieja no alcanza a otra generación.
- Quien cierra un lote (descarte, publicación) escribe el evento y retira la copia bajo la misma
  exclusión; quien instala lee el estado bajo ella. Así ningún orden deja una copia de un lote
  cerrado. ALIGN-057 debe hacer lo mismo al publicar.
"""

import hashlib
import logging
import os
import re
import secrets
import shutil
import stat
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import BinaryIO

if os.name == "nt":
    import msvcrt

    def _try_exclusive(descriptor: int) -> bool:
        try:
            msvcrt.locking(descriptor, msvcrt.LK_NBLCK, 1)
        except OSError:
            return False
        return True
else:
    import fcntl

    def _try_exclusive(descriptor: int) -> bool:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return False
        return True

logger = logging.getLogger("equitas.api")

DEFAULT_TTL_SECONDS = 86_400
HASH_CHUNK_BYTES = 1 << 20
FILE_KINDS = frozenset({"cabecera", "detalle", "libro"})
# Un conjunto fijo de archivos: no hay que borrarlos, que sería otra carrera. Dos lotes en el
# mismo archivo solo se esperan entre sí. Nadie toma más de uno a la vez: no hay interbloqueo.
LOCK_STRIPES = 64
# Tope de espera: ante un lote ocupado, 503 y el mismo envío se reintenta, sin colgar la solicitud.
LOCK_WAIT_SECONDS = 30.0
LOCK_POLL_SECONDS = 0.01
_TOKEN = re.compile(r"[0-9a-f]{32}")
_held = threading.local()


class UploadStoreError(RuntimeError):
    """Mensaje fijo: nunca incluye rutas."""

    def __init__(self) -> None:
        super().__init__("ALMACEN_TEMPORAL_INSEGURO")


class UploadStoreBusy(UploadStoreError):
    """El lote lo tiene otra operación más allá del tope de espera."""


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
        self._retired = _private_directory(self.root / "retirados")
        self._locks = _private_directory(self.root / "bloqueos")

    def _incoming_dir(self, token: str) -> Path:
        if not isinstance(token, str) or not _TOKEN.fullmatch(token):
            raise UploadStoreError()
        return self._incoming / token

    def _batch_dir(self, tenant: int, batch: int) -> Path:
        return self._batches / _positive_id(tenant) / _positive_id(batch)

    def _touch(self, path: Path) -> None:
        now = self._clock()
        os.utime(path, (now, now))

    def _lock_path(self, tenant: object, batch: object) -> Path:
        digest = hashlib.sha256(f"{tenant}/{batch}".encode()).digest()
        return self._locks / f"{int.from_bytes(digest[:4], 'big') % LOCK_STRIPES:02d}.lock"

    @contextmanager
    def lock(
        self, tenant: object, batch: object, *, wait: float | None = None
    ) -> Iterator[None]:
        """Exclusión por lote, reentrante en el mismo hilo. `flock` no se hereda entre
        descriptores: rige entre hilos y procesos, y el núcleo la suelta si el proceso muere."""
        path = str(self._lock_path(tenant, batch))
        held = _held.__dict__.setdefault("paths", set())
        if path in held:
            yield
            return
        descriptor = os.open(
            path,
            os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0),
            0o600,
        )
        try:
            deadline = time.monotonic() + (LOCK_WAIT_SECONDS if wait is None else wait)
            while not _try_exclusive(descriptor):
                if time.monotonic() >= deadline:
                    raise UploadStoreBusy()
                time.sleep(LOCK_POLL_SECONDS)
            held.add(path)
            try:
                yield
            finally:
                held.discard(path)
        finally:
            os.close(descriptor)

    def _retire(self, path: Path) -> Path | None:
        """Mueve una generación a un nombre privado. None si ya no estaba."""
        retired = self._retired / secrets.token_hex(16)
        try:
            os.rename(path, retired)
        except FileNotFoundError:
            return None
        return retired

    def _erase(self, path: Path | None) -> bool:
        """Un directorio se borra con su contenido. Un enlace o un archivo plantado en el lugar de
        un lote se quita él mismo: nunca se sigue el enlace."""
        if path is None:
            return True
        if os.path.isdir(path) and not os.path.islink(path):
            shutil.rmtree(path, ignore_errors=True)
        else:
            try:
                os.unlink(path)
            except OSError:
                pass
        return not os.path.lexists(path)

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
        with self.lock(tenant, batch):
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
        stale = None
        try:
            with self.lock(tenant, batch):
                _private_directory(target.parent)
                stale = self._retire(target)
                try:
                    os.rename(source, target)
                except OSError:
                    if not target.exists():
                        raise
                else:
                    self._touch(target)
        finally:
            self._erase(stale)

    def discard(self, token: str) -> None:
        shutil.rmtree(self._incoming_dir(token), ignore_errors=True)

    def _retire_if_expired(self, tenant: object, batch: object, directory: Path) -> bool:
        """Retira la generación solo si, bajo la exclusión, sigue vencida. True si el nombre
        quedó libre; False si lo ocupa otra generación, vigente. Si el lote está ocupado, o
        no se pudo mover, lanza: la purga vuelve a intentar y `files` no la entrega."""
        with self.lock(tenant, batch, wait=0):
            try:
                info = os.lstat(directory)
            except FileNotFoundError:
                return True
            if not stat.S_ISDIR(info.st_mode):
                return True
            if info.st_mtime + self.ttl_seconds > self._clock():
                return False
            retired = self._retire(directory)
        if not self._erase(retired):
            raise OSError("Generación retirada sin borrar")
        return True

    def _live_copy(self, tenant: int, batch: int) -> tuple[Path, os.stat_result] | None:
        """El directorio del lote si existe y no venció. Lo vencido no se entrega ni se deja."""
        directory = self._batch_dir(tenant, batch)
        try:
            info = os.lstat(directory)
        except OSError:
            return None
        if not stat.S_ISDIR(info.st_mode):
            return None
        if info.st_mtime + self.ttl_seconds > self._clock():
            return directory, info
        try:
            freed = self._retire_if_expired(tenant, batch, directory)
        except (UploadStoreError, OSError):
            return None
        if freed:
            return None
        try:
            return directory, os.lstat(directory)
        except OSError:
            return None

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
        try:
            for kind, path in found.items():
                digest = hashlib.sha256()
                with path.open("rb") as handle:
                    while chunk := handle.read(HASH_CHUNK_BYTES):
                        digest.update(chunk)
                if digest.hexdigest() != hashes[kind]:
                    return False
        except FileNotFoundError:  # La retiraron mientras se leía: no hay copia.
            return False
        return True

    def describe(
        self, tenant: int, batch: int, hashes: dict[str, str], total_bytes: int | None
    ) -> tuple[bool, float | None]:
        """Estado barato para mostrar, sin leer los archivos: clases y tamaño total."""
        found = self.files(tenant, batch)
        if not found:
            return False, None
        try:
            size = sum(path.stat().st_size for path in found.values())
            expires_at = os.lstat(self._batch_dir(tenant, batch)).st_mtime + self.ttl_seconds
        except FileNotFoundError:  # La retiraron mientras se miraba: no hay copia.
            return False, None
        complete = set(found) == set(hashes) and total_bytes in (None, size)
        return complete, expires_at

    def release(self, tenant: int, batch: int) -> None:
        """Se borra al descartar o publicar. Es idempotente. Quien cierra el lote lo llama
        bajo `lock`, junto con el evento que lo cierra."""
        target = self._batch_dir(tenant, batch)
        retired = None
        try:
            with self.lock(tenant, batch):
                retired = self._retire(target)
        except OSError:
            logger.warning("RETIRO_INCOMPLETO")
            return
        if not self._erase(retired):
            logger.warning("RETIRO_INCOMPLETO")

    def _expired(self, entry: os.DirEntry) -> bool:
        info = entry.stat(follow_symlinks=False)
        return (
            stat.S_ISDIR(info.st_mode)
            and info.st_mtime + self.ttl_seconds <= self._clock()
        )

    def _purge_incoming(self) -> tuple[int, int]:
        """Cada token se usa una sola vez: su nombre no lo puede ocupar otra generación."""
        removed = pending = 0
        for entry in os.scandir(self._incoming):
            try:
                if not self._expired(entry):
                    continue
                if self._erase(self._retire(Path(entry.path))):
                    removed += 1
                else:
                    pending += 1
            except FileNotFoundError:
                continue
            except OSError:
                pending += 1
        return removed, pending

    def _purge_batches(self, tenant_directory: Path) -> tuple[int, int]:
        """La decisión de este recorrido es solo una candidata: la que vale es la que se
        vuelve a tomar bajo la exclusión del lote. Un lote ocupado queda para la próxima."""
        removed = pending = 0
        for entry in os.scandir(tenant_directory):
            try:
                if not self._expired(entry):
                    continue
                if self._retire_if_expired(tenant_directory.name, entry.name, Path(entry.path)):
                    removed += 1
            except FileNotFoundError:
                continue
            except UploadStoreBusy:
                continue
            except (UploadStoreError, OSError):
                pending += 1
        return removed, pending

    def _sweep_retired(self) -> tuple[int, int]:
        """Lo que un proceso caído dejó a medio borrar, o lo que no se pudo borrar antes."""
        removed = pending = 0
        for entry in os.scandir(self._retired):
            if self._erase(Path(entry.path)):
                removed += 1
            else:
                pending += 1
        return removed, pending

    def purge_expired(self) -> int:
        """Devuelve lo retirado. Lo que no se pudo borrar se informa y `files` no lo entrega."""
        removed, pending = self._sweep_retired()
        counts = [self._purge_incoming()]
        for tenant in os.scandir(self._batches):
            if tenant.is_dir(follow_symlinks=False):
                counts.append(self._purge_batches(Path(tenant.path)))
        removed += sum(count[0] for count in counts)
        pending += sum(count[1] for count in counts)
        if pending:
            logger.warning("PURGA_INCOMPLETA pendientes=%s", pending)
        return removed
