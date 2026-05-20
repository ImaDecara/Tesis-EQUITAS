from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from ETL.config import settings


@dataclass
class ExtractedSourceData:
    cabecera_df: pd.DataFrame
    detalle_df: pd.DataFrame
    cabecera_path: Path
    detalle_path: Path

#Leemos un archivo TSV y lo devolvemos como DataFrame. TSV = Tab Separated Values. Es decir, columnas separadas por tabulaciones.
def read_tsv(path: Path) -> pd.DataFrame:
    """
    Lee un archivo TSV y lo devuelve como DataFrame.

    TSV = Tab Separated Values.
    Es decir, columnas separadas por tabulaciones.
    """

    if not path.exists():
        raise FileNotFoundError(f"No existe el archivo: {path}")

    if not path.is_file():
        raise ValueError(f"La ruta no corresponde a un archivo: {path}")

    return pd.read_csv(
        path,
        sep="\t",
        dtype=str,
        encoding="utf-8-sig",
        keep_default_na=False,
    )


#Extrae los archivos de cabecera y detalle a partir de las rutas dadas
def extract_source_files(
    cabecera_path: str | Path,
    detalle_path: str | Path,
) -> ExtractedSourceData:
   
    cabecera_file = Path(cabecera_path)
    detalle_file = Path(detalle_path)

    cabecera_df = read_tsv(cabecera_file)
    detalle_df = read_tsv(detalle_file)

    return ExtractedSourceData(
        cabecera_df=cabecera_df,
        detalle_df=detalle_df,
        cabecera_path=cabecera_file,
        detalle_path=detalle_file,
    )


#Ectrae los archivos de cabecera y detalle a partir de una carpeta de input
def extract_from_input_folder(folder_name: str) -> ExtractedSourceData:
    
    source_dir = settings.input_dir / folder_name

    cabecera_path = source_dir / "cabecera.tsv"
    detalle_path = source_dir / "detalle.tsv"

    return extract_source_files(
        cabecera_path=cabecera_path,
        detalle_path=detalle_path,
    )

#Imprime un resumen simple de los archivos leídos. Sirve para probar que EXTRACT funciona correctamente.
def print_extraction_summary(source_data: ExtractedSourceData) -> None:
    
    print("EXTRACT OK")
    print("-" * 80)

    print(f"Cabecera: {source_data.cabecera_path}")
    print(
        f"Filas cabecera: {len(source_data.cabecera_df)} | "
        f"Columnas cabecera: {len(source_data.cabecera_df.columns)}"
    )

    print()

    print(f"Detalle: {source_data.detalle_path}")
    print(
        f"Filas detalle: {len(source_data.detalle_df)} | "
        f"Columnas detalle: {len(source_data.detalle_df.columns)}"
    )

    print("-" * 80)

    print("Primeras columnas de cabecera:")
    print(list(source_data.cabecera_df.columns[:10]))

    print()

    print("Primeras columnas de detalle:")
    print(list(source_data.detalle_df.columns[:10]))


if __name__ == "__main__":
    data = extract_from_input_folder("inmuebles")
    print_extraction_summary(data)