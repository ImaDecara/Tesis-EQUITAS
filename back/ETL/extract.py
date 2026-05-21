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


# Leemos un archivo TSV y lo devolvemos como DataFrame. TSV = Tab Separated Values. Es decir, columnas separadas por tabulaciones.
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


# Extrae los archivos de cabecera y detalle a partir de las rutas dadas.
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


# Extrae los archivos de cabecera y detalle a partir de una carpeta de input.
def extract_from_input_folder(folder_name: str) -> ExtractedSourceData:

    source_dir = settings.input_dir / folder_name

    cabecera_path = source_dir / "cabecera.tsv"
    detalle_path = source_dir / "detalle.tsv"

    return extract_source_files(
        cabecera_path=cabecera_path,
        detalle_path=detalle_path,
    )


# Limita los DataFrames a una cantidad máxima de objetos de deuda.
# El límite se aplica por Bien_Tipo_Id + Cuenta, no por cantidad de filas.
# Esto evita cortar relaciones o deudas a la mitad.
# Además permite priorizar ciertos Tipo_Ingreso_Id dentro del límite.
def limit_by_debtor_objects(
    cabecera_df: pd.DataFrame,
    detalle_df: pd.DataFrame,
    limit_objects: int | None,
    priority_tipo_ingreso_ids: list[int] | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame]:

    if limit_objects is None:
        return cabecera_df, detalle_df

    if limit_objects <= 0:
        raise ValueError("limit_objects debe ser mayor a 0.")

    required_columns = {"Bien_Tipo_Id", "Cuenta"}

    missing_cabecera = required_columns - set(cabecera_df.columns)
    missing_detalle = required_columns - set(detalle_df.columns)

    if missing_cabecera:
        raise ValueError(f"Cabecera no tiene columnas requeridas: {missing_cabecera}")

    if missing_detalle:
        raise ValueError(f"Detalle no tiene columnas requeridas: {missing_detalle}")

    priority_tipo_ingreso_ids = priority_tipo_ingreso_ids or []
    priority_tipo_ingreso_ids_str = {
        str(value).strip()
        for value in priority_tipo_ingreso_ids
    }

    object_columns = ["Bien_Tipo_Id", "Cuenta"]

    all_object_keys_df = (
        cabecera_df[object_columns]
        .drop_duplicates()
        .copy()
    )

    selected_keys: list[tuple[str, str]] = []
    selected_keys_set: set[tuple[str, str]] = set()

    # ========================================================
    # 1. SELECCIONAR PRIMERO OBJETOS PRIORITARIOS
    # ========================================================
    #
    # Ejemplo para Agua:
    # Tipo_Ingreso_Id 801 / 802 = conexiones.
    #

    if priority_tipo_ingreso_ids_str:
        if "Tipo_Ingreso_Id" not in cabecera_df.columns:
            raise ValueError(
                "Se indicó priority_tipo_ingreso_ids, pero cabecera no tiene Tipo_Ingreso_Id."
            )

        priority_rows_df = cabecera_df[
            cabecera_df["Tipo_Ingreso_Id"]
            .astype(str)
            .str.strip()
            .isin(priority_tipo_ingreso_ids_str)
        ]

        priority_object_keys_df = (
            priority_rows_df[object_columns]
            .drop_duplicates()
            .copy()
        )

        if len(priority_object_keys_df) > limit_objects:
            raise ValueError(
                f"Hay {len(priority_object_keys_df)} objetos prioritarios, "
                f"pero el límite es {limit_objects}. "
                "Aumentá limit_objects o reducí los tipos prioritarios."
            )

        for _, row in priority_object_keys_df.iterrows():
            key = (
                str(row["Bien_Tipo_Id"]).strip(),
                str(row["Cuenta"]).strip(),
            )

            if key not in selected_keys_set:
                selected_keys.append(key)
                selected_keys_set.add(key)

    # ========================================================
    # 2. COMPLETAR CON OBJETOS NO PRIORITARIOS HASTA EL LÍMITE
    # ========================================================

    for _, row in all_object_keys_df.iterrows():
        if len(selected_keys) >= limit_objects:
            break

        key = (
            str(row["Bien_Tipo_Id"]).strip(),
            str(row["Cuenta"]).strip(),
        )

        if key not in selected_keys_set:
            selected_keys.append(key)
            selected_keys_set.add(key)

    allowed_keys = set(selected_keys)

    # ========================================================
    # 3. FILTRAR CABECERA Y DETALLE USANDO LOS OBJETOS ELEGIDOS
    # ========================================================

    cabecera_keys = list(
        zip(
            cabecera_df["Bien_Tipo_Id"].astype(str).str.strip(),
            cabecera_df["Cuenta"].astype(str).str.strip(),
        )
    )

    detalle_keys = list(
        zip(
            detalle_df["Bien_Tipo_Id"].astype(str).str.strip(),
            detalle_df["Cuenta"].astype(str).str.strip(),
        )
    )

    limited_cabecera_df = cabecera_df[
        [key in allowed_keys for key in cabecera_keys]
    ].copy()

    limited_detalle_df = detalle_df[
        [key in allowed_keys for key in detalle_keys]
    ].copy()

    return limited_cabecera_df, limited_detalle_df


# Extrae archivos desde carpeta y opcionalmente limita la cantidad de objetos.
# También permite priorizar ciertos Tipo_Ingreso_Id dentro del límite.
def extract_from_input_folder_limited(
    folder_name: str,
    limit_objects: int | None = None,
    priority_tipo_ingreso_ids: list[int] | None = None,
) -> ExtractedSourceData:

    source_data = extract_from_input_folder(folder_name)

    cabecera_df, detalle_df = limit_by_debtor_objects(
        cabecera_df=source_data.cabecera_df,
        detalle_df=source_data.detalle_df,
        limit_objects=limit_objects,
        priority_tipo_ingreso_ids=priority_tipo_ingreso_ids,
    )

    return ExtractedSourceData(
        cabecera_df=cabecera_df,
        detalle_df=detalle_df,
        cabecera_path=source_data.cabecera_path,
        detalle_path=source_data.detalle_path,
    )


# Imprime un resumen simple de los archivos leídos. Sirve para probar que EXTRACT funciona correctamente.
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
