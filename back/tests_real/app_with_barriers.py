"""La API real con una pausa en un punto elegido: fija el orden de una carrera sin cambiar la
lógica. Solo para `tests_real`. La prueba espera `<punto>.paused` y crea `<punto>.resume`."""

import os
import time
from pathlib import Path

from api import imports
from api.main import app  # noqa: F401
from api.upload_store import UploadStore

DIRECTORY = Path(os.environ["EQUITAS_TEST_BARRIER_DIR"])
POINT = os.environ["EQUITAS_TEST_BARRIER"]
_fired: set[str] = set()


def _pause_once(point: str) -> None:
    if point in _fired:
        return
    _fired.add(point)
    (DIRECTORY / f"{point}.paused").touch()
    while not (DIRECTORY / f"{point}.resume").exists():
        time.sleep(0.01)


if POINT == "settle":
    # La fila ya se registró y la copia todavía no empezó a instalarse.
    _settle_copy = imports._settle_copy

    def _paused_settle(*args):
        _pause_once("settle")
        return _settle_copy(*args)

    imports._settle_copy = _paused_settle

if POINT == "commit":
    # Dentro de la instalación de la copia.
    _commit = UploadStore.commit

    def _paused_commit(self, *args):
        _pause_once("commit")
        return _commit(self, *args)

    UploadStore.commit = _paused_commit

if POINT == "expired":
    # La purga ya decidió que la copia venció y todavía no la retiró.
    _expired = UploadStore._expired

    def _paused_expired(self, entry):
        result = _expired(self, entry)
        if result and Path(entry.path).parent.parent.name == "lotes":
            _pause_once("expired")
        return result

    UploadStore._expired = _paused_expired

    _purge_once = imports.purge_once
    _purges = DIRECTORY / "purges.count"

    def _counted_purge() -> None:
        _purge_once()
        previous = int(_purges.read_text()) if _purges.exists() else 0
        _purges.write_text(str(previous + 1))

    imports.purge_once = _counted_purge
