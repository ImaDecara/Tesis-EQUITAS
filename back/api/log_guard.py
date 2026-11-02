"""Ningún dato del cliente llega a los registros del servidor (ALIGN-052).

Uvicorn imprime lo que recibió, antes de que la aplicación decida nada y aunque no haya
sesión: ruta, consulta y método en el acceso; `X-Forwarded-For` como dirección del cliente
cuando la conexión viene de loopback; ruta y consulta de un handshake WebSocket; y, en nivel
`trace`, el scope entero. Por eso se filtra por lista cerrada, no por lista de lo prohibido:
lo que no se reconoce no se imprime.

Los identificadores internos que hagan falta salen del evento autorizado de la aplicación
(`IMPORT_RECIBIDO lote=…`), nunca de la ruta recibida: un número de la ruta puede ser un DNI.
"""

import logging

# Solo los segmentos fijos de las rutas. Una ruta nueva que no se agregue acá se ve como `<x>`.
LOGGABLE_SEGMENTS = frozenset(
    {"", "health", "case-groups", "summary", "definitions", "imports", "discard"}
)
HTTP_METHODS = frozenset({"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"})
HTTP_VERSIONS = frozenset({"1.0", "1.1", "2"})
VARIABLE = "<x>"
# Mensajes propios del ciclo de vida de uvicorn: ninguno cita datos de una solicitud.
SERVER_LIFECYCLE = (
    "Started server process",
    "Waiting for",
    "Application startup",
    "Application shutdown",
    "Uvicorn running on",
    "Shutting down",
    "Finished server process",
    "Invalid HTTP request",
)


class SafeAccessRecord(logging.Filter):
    """Del registro de acceso quedan la forma de la ruta, el método conocido y el código."""

    def filter(self, record: logging.LogRecord) -> bool:
        arguments = record.args
        if not (isinstance(arguments, tuple) and len(arguments) == 5):
            return False
        _client, method, path, version, status = arguments
        shape = "/".join(
            part if part in LOGGABLE_SEGMENTS else VARIABLE
            for part in str(path).split("?", 1)[0].split("/")
        )
        record.args = (
            "-",
            method if method in HTTP_METHODS else VARIABLE,
            shape,
            version if version in HTTP_VERSIONS else VARIABLE,
            status,
        )
        return True


class SafeServerRecord(logging.Filter):
    """De `uvicorn.error` queda el ciclo de vida. Un error conserva solo la clase; el resto
    (handshakes WebSocket, líneas de depuración) se descarta o queda sin sus valores."""

    def filter(self, record: logging.LogRecord) -> bool:
        if record.exc_info:
            error = record.exc_info[1]
            record.msg = "ERROR_NO_TRATADO clase=%s"
            record.args = (type(error).__name__,)
        elif not str(record.msg).startswith(SERVER_LIFECYCLE):
            if record.levelno < logging.WARNING:
                return False
            record.msg = "REGISTRO_SERVIDOR_OMITIDO"
            record.args = ()
        record.exc_info = None
        record.exc_text = None
        record.stack_info = None
        return True


class DropAll(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return False


def install_log_guards() -> logging.Logger:
    """Devuelve el registrador de la API, que uvicorn no configura por su cuenta."""
    logging.getLogger("uvicorn.access").addFilter(SafeAccessRecord())
    logging.getLogger("uvicorn.error").addFilter(SafeServerRecord())
    # En nivel `trace` imprime el scope completo de cada solicitud.
    logging.getLogger("uvicorn.asgi").addFilter(DropAll())
    # httpx anuncia en INFO cada URL saliente, con sus filtros.
    for noisy in ("httpx", "httpcore", "hpack", "websockets"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    logger = logging.getLogger("equitas.api")
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(levelname)s:     %(message)s"))
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
    return logger
