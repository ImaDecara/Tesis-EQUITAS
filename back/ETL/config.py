from dataclasses import dataclass
from pathlib import Path
import os

from dotenv import load_dotenv
from supabase import Client, create_client


# RUTAS BASE DEL PROYECTO
CURRENT_FILE = Path(__file__).resolve()
ETL_DIR = CURRENT_FILE.parent
BACK_DIR = ETL_DIR.parent
PROJECT_ROOT = BACK_DIR.parent

ENV_PATH = BACK_DIR / ".env"

load_dotenv(ENV_PATH)



# CONFIGURACIÓN FIJA DEL MVP
DEFAULT_TENANT_ID = 1
DEFAULT_TENANT_NAME = "Municipalidad Demo"

DEFAULT_CURRENCY_CODE = "ARS"

DEFAULT_BATCH_SIZE = 500


# SETTINGS DEL ETL
@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_role_key: str

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
def get_settings() -> Settings:
    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    supabase_service_role_key = (
    os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    or os.getenv("SUPABASE_KEY", "").strip()
)

    if not supabase_url:
        raise RuntimeError("Falta configurar SUPABASE_URL en back/.env")

    if not supabase_service_role_key:
        raise RuntimeError( "Falta configurar SUPABASE_SERVICE_ROLE_KEY o SUPABASE_KEY en back/.env")

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



# CLIENTE SUPABASE PARA EL ETL
def create_supabase_client() -> Client:
    return create_client(
        settings.supabase_url,
        settings.supabase_service_role_key,
    )


supabase = create_supabase_client()