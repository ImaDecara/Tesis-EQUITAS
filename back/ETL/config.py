import os
import re
import unicodedata
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

from dotenv import load_dotenv
from supabase import Client, create_client

# RUTAS BASE DEL PROYECTO
CURRENT_FILE = Path(__file__).resolve()
ETL_DIR = CURRENT_FILE.parent
BACK_DIR = ETL_DIR.parent
PROJECT_ROOT = BACK_DIR.parent

ENV_PATH = BACK_DIR / ".env"

# CONFIGURACIÓN FIJA DEL MVP
DEFAULT_TENANT_ID = 1
DEFAULT_TENANT_NAME = "Municipalidad Demo"

DEFAULT_CURRENCY_CODE = "ARS"

DEFAULT_BATCH_SIZE = 500

# PLAN §7.6: las cargas de este plan solo usan la base local aislada.
# Ninguna variable de entorno ni referencia puede ampliar esta allowlist.
ALLOWED_TARGET_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
FORBIDDEN_PROJECT_REF = "folyslqzqvnpolexcxjo"


class ETLError(RuntimeError):
    """Error cuyo código y mensaje son propios, nunca una respuesta remota."""

    def __init__(self, code: str, message: str | None = None) -> None:
        self.code = code
        super().__init__(message or code)


def contains_original_reference(value: str) -> bool:
    # Detectar también referencias con escapes, espacios o caracteres de formato.
    decoded = unicodedata.normalize("NFKC", unquote(value)).casefold()
    while decoded != value:
        value, decoded = decoded, unicodedata.normalize("NFKC", unquote(decoded)).casefold()
    return FORBIDDEN_PROJECT_REF in "".join(char for char in decoded if char.isalnum())


def validate_execution_target(url: str) -> None:
    references = [url, *(value for name, value in os.environ.items()
                         if name.startswith(("SUPABASE_", "EQUITAS_")))]
    if any(contains_original_reference(value) for value in references):
        raise ETLError("TARGET_ORIGINAL_FORBIDDEN")
    if os.getenv("EQUITAS_TARGET_ENV", "") not in {"local", "testing"}:
        raise ETLError("TARGET_ENV_INVALID")
    try:
        parsed = urlsplit(url)
        invalid = (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None or parsed.password is not None
            or parsed.path not in {"", "/"} or parsed.query or parsed.fragment
            or any(char.isspace() or ord(char) < 32 for char in url)
            or "\\" in url
            or parsed.port == 0
        )
    except ValueError:
        raise ETLError("TARGET_URL_INVALID") from None
    if invalid:
        raise ETLError("TARGET_URL_INVALID")
    if parsed.hostname not in ALLOWED_TARGET_HOSTS:
        raise ETLError("TARGET_HOST_FORBIDDEN")


# SETTINGS DEL ETL
@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_role_key: str = field(repr=False)

    tenant_id: int
    tenant_name: str

    default_currency_code: str
    default_batch_size: int

    project_root: Path
    back_dir: Path
    data_dir: Path
    input_dir: Path
    processed_dir: Path

# Función para cargar la configuración desde variables de entorno y rutas del proyecto.
def get_settings(*, execute: bool = False) -> Settings:
    supabase_url = ""
    supabase_service_role_key = ""
    if execute:
        load_dotenv(ENV_PATH)
        supabase_url = os.getenv("SUPABASE_URL", "").strip()
        validate_execution_target(supabase_url)
        supabase_service_role_key = (
            os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
            or os.getenv("SUPABASE_KEY", "").strip()
        )
        if not supabase_service_role_key:
            raise ETLError("SUPABASE_KEY_MISSING")

    data_dir = BACK_DIR / "data"
    input_dir = data_dir / "input"
    processed_dir = data_dir / "processed"

    return Settings(
        supabase_url=supabase_url,
        supabase_service_role_key=supabase_service_role_key,
        tenant_id=DEFAULT_TENANT_ID,
        tenant_name=DEFAULT_TENANT_NAME,
        default_currency_code=DEFAULT_CURRENCY_CODE,
        default_batch_size=DEFAULT_BATCH_SIZE,
        project_root=PROJECT_ROOT,
        back_dir=BACK_DIR,
        data_dir=data_dir,
        input_dir=input_dir,
        processed_dir=processed_dir,
    )


settings = get_settings()


@dataclass(frozen=True)
class ImportCredentials:
    """Registro de lotes: el JWT de equitas_import_server (ALIGN-018), nunca la clave general de servicio."""

    server_jwt: str = field(repr=False)
    public_key: str = field(repr=False)
    actor_user: int


def get_import_credentials() -> ImportCredentials:
    load_dotenv(ENV_PATH)
    server_jwt = os.getenv("EQUITAS_IMPORT_SERVER_JWT", "").strip()
    public_key = os.getenv("SUPABASE_ANON_KEY", "").strip()
    if not server_jwt or not public_key:
        raise ETLError("IMPORT_CREDENTIAL_MISSING")
    actor_user = os.getenv("EQUITAS_IMPORT_ACTOR_USER", "").strip()
    if not re.fullmatch(r"[1-9][0-9]{0,18}", actor_user):
        raise ETLError("IMPORT_ACTOR_INVALID")
    return ImportCredentials(server_jwt=server_jwt, public_key=public_key, actor_user=int(actor_user))



# La caché no evita la guardia: se valida la configuración en cada acceso.
@lru_cache(maxsize=1)
def _client_for_settings(current: Settings) -> Client:
    return create_client(
        current.supabase_url,
        current.supabase_service_role_key,
    )


def create_supabase_client() -> Client:
    return _client_for_settings(get_settings(execute=True))


class _LazySupabase:
    """Conserva los imports existentes sin crear un cliente al importar."""

    def __getattr__(self, name: str) -> Any:
        return getattr(create_supabase_client(), name)


supabase = _LazySupabase()
