"""Lector estricto de multipart/form-data en flujo (ALIGN-052).

`python-multipart` no está entre las dependencias fijadas, así que `Request.form()` no
está disponible, y además arma cada parte antes de entregarla. Este lector emite los
bytes a medida que llegan y solo acepta lo que produce un navegador: rechaza preámbulo,
codificación de transferencia, encabezados rotos y un cuerpo sin cierre.

Los errores llevan solo un código: nunca citan bytes de la entrada.
"""

import re
from collections.abc import AsyncIterable, AsyncIterator
from dataclasses import dataclass

MAX_HEADER_BYTES = 8192
MAX_PARTS = 16
_DISPOSITION_PARAMETER = re.compile(
    r';[ \t]*([A-Za-z0-9_.*-]+)=(?:"((?:[^"\\]|\\.)*)"|([^";\s]*))[ \t]*'
)
_UNESCAPE = re.compile(r"\\(.)")


class MultipartError(ValueError):
    def __init__(self, code: str = "MULTIPART_INVALIDO") -> None:
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class PartStart:
    name: str
    filename: str | None


@dataclass(frozen=True)
class PartEnd:
    pass


def _parse_disposition(value: str) -> PartStart:
    kind, separator, _ = value.partition(";")
    if kind.strip().lower() != "form-data" or not separator:
        raise MultipartError()
    parameters: dict[str, str] = {}
    position = len(kind)
    while position < len(value):
        match = _DISPOSITION_PARAMETER.match(value, position)
        if match is None:
            raise MultipartError()
        name = match.group(1).lower()
        if name in parameters:
            raise MultipartError()
        quoted, plain = match.group(2), match.group(3)
        parameters[name] = (
            _UNESCAPE.sub(r"\1", quoted) if quoted is not None else plain
        )
        position = match.end()
    if not parameters.get("name"):
        raise MultipartError()
    return PartStart(parameters["name"], parameters.get("filename"))


def _parse_headers(raw: bytes) -> PartStart:
    disposition = None
    for line in raw.decode("latin-1").split("\r\n"):
        name, separator, value = line.partition(":")
        if not separator or not name or name != name.strip():
            raise MultipartError()
        lowered = name.lower()
        if lowered == "content-disposition":
            if disposition is not None:
                raise MultipartError()
            disposition = value.strip()
        elif lowered == "content-transfer-encoding":
            raise MultipartError()
    if disposition is None:
        raise MultipartError()
    return _parse_disposition(disposition)


class _Buffer:
    def __init__(self, stream: AsyncIterable[bytes]) -> None:
        self.data = bytearray()
        self._chunks = aiter(stream)

    async def fill(self) -> bool:
        try:
            self.data += await anext(self._chunks)
        except StopAsyncIteration:
            return False
        return True

    async def require(self, count: int) -> None:
        while len(self.data) < count:
            if not await self.fill():
                raise MultipartError()

    async def drain(self) -> None:
        while await self.fill():
            self.data.clear()


async def multipart_events(
    stream: AsyncIterable[bytes],
    boundary: bytes,
    *,
    max_header_bytes: int = MAX_HEADER_BYTES,
    max_parts: int = MAX_PARTS,
) -> AsyncIterator[PartStart | PartEnd | bytes]:
    """Emite PartStart, trozos de bytes y PartEnd por cada parte; valida el cierre."""
    delimiter = b"--" + boundary
    marker = b"\r\n" + delimiter
    buffer = _Buffer(stream)

    await buffer.require(len(delimiter) + 2)
    if not buffer.data.startswith(delimiter):
        raise MultipartError()
    del buffer.data[: len(delimiter)]
    count = 0
    while True:
        # Tras un delimitador solo puede venir el cierre o el inicio de una parte.
        await buffer.require(2)
        follows = bytes(buffer.data[:2])
        del buffer.data[:2]
        if follows == b"--":
            await buffer.drain()
            return
        if follows != b"\r\n":
            raise MultipartError()
        count += 1
        if count > max_parts:
            raise MultipartError("MULTIPART_DEMASIADAS_PARTES")

        while (end := buffer.data.find(b"\r\n\r\n")) < 0:
            if len(buffer.data) > max_header_bytes or not await buffer.fill():
                raise MultipartError()
        if end > max_header_bytes:
            raise MultipartError()
        yield _parse_headers(bytes(buffer.data[:end]))
        del buffer.data[: end + 4]

        while True:
            position = buffer.data.find(marker)
            if position >= 0:
                if position:
                    yield bytes(buffer.data[:position])
                del buffer.data[: position + len(marker)]
                break
            # Lo último puede ser el comienzo de un marcador que sigue en el próximo trozo.
            keep = len(marker) - 1
            if len(buffer.data) > keep:
                yield bytes(buffer.data[:-keep])
                del buffer.data[:-keep]
            if not await buffer.fill():
                raise MultipartError()
        yield PartEnd()
