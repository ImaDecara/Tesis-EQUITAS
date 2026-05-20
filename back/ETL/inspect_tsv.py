from pathlib import Path
import argparse
import pandas as pd



# CAMPOS LÓGICOS ESPERADOS EN CABECERA
CABECERA_REQUIRED_FIELDS = {
    "relation.clave_agrupacion": ["ClaveAgrupacion"],

    "person.external_id": ["Destinatario_Id"],
    "person.document_number": ["Destinatario_CUIT"],
    "person.full_name": ["Destinatario"],

    "debtor.external_id": ["Cuenta"],
    "debtor.identifier": ["Identificador"],

    "debtor_type.external_id": ["Bien_Tipo_Id"],
    "debtor_type.value": ["Bien_Tipo"],
}

CABECERA_OPTIONAL_FIELDS = {
    "debtor.description": ["Bien_Descripcion"],
    "debtor.status": ["Estado"],

    "debtor_person.priority": ["Destinatario_Porcentaje"],
    "debtor_person.role": ["Destinatario_Tipo"],

    "debtor_profile.total_debt_amount": ["Deuda_Actualizada"],
    "debtor_profile.original_debt_amount": ["Deuda_Capital"],
    "debtor_profile.profile_generated_at": ["Fecha_Actualizacion"],
    "debtor_profile.periods": ["Periodos_Deuda"],

    "contact.email": ["Destinatario_Email"],
    "contact.phone": ["Destinatario_Telefono"],
    "contact.mobile": ["Destinatario_Celular"],

    "address.street": ["Destinatario_Calle"],
    "address.number": ["Destinatario_Numeracion"],
    "address.floor": ["Destinatario_Piso"],
    "address.apartment": ["Destinatario_Depto"],
    "address.city": ["Destinatario_Localidad"],
    "address.postal_code": ["Destinatario_CP"],
    "address.province": ["Destinatario_Provincia"],
}



# CAMPOS LÓGICOS ESPERADOS EN DETALLE
DETALLE_REQUIRED_FIELDS = {
    "relation.clave_agrupacion": ["ClaveAgrupacion"],

    "debt.external_id": ["DEUD_id"],
    "debt.original_amount": ["NOTD_capital"],
    "debt.current_amount": ["NOTD_totalActualizado"],
    "debt.due_date": ["NOTD_vencimiento"],
}

DETALLE_OPTIONAL_FIELDS = {
    "debt.interest_amount": ["NOTD_intereses"],
    "debt.fee_amount": ["NOTD_honorarios"],
    "debt.status": ["NOTD_ESTA_id", "NOTD_SITU_id"],
    "debt.type": ["Tipo_Ingreso_Id"],
    "debt.description": ["Detalle_Deuda", "Tipo_Ingreso_Id"],
    "debt.period": ["Detalle_Deuda", "DEUD_id"],
    "debt.account": ["Cuenta"],
}


# ============================================================
# FUNCIONES AUXILIARES
# ============================================================

# Estas funciones se encargan de leer los archivos, validar su estructura y contenido, y mostrar estadísticas útiles para el ETL.
def read_tsv(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"No existe el archivo: {path}")

    return pd.read_csv(
        path,
        sep="\t",
        dtype=str,
        encoding="utf-8-sig",
        keep_default_na=False,
    )


# Estas funciones se encargan de transformar los datos, inferir valores faltantes y construir los payloads para la carga.
def print_section(title: str) -> None:
    print("\n" + "=" * 80)
    print(title)
    print("=" * 80)

# Estas funciones se encargan de cargar los datos transformados a Supabase, usando las funciones definidas en load.py.
def parse_decimal(value: str) -> float:
    if value is None:
        return 0.0

    value = str(value).strip()

    if value == "":
        return 0.0

    # Soporta formatos tipo:
    # 1234.56
    # 1234,56
    # 1.234,56
    # $ 1.234,56
    cleaned = value.replace("$", "").replace(" ", "")

    if "," in cleaned and "." in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    else:
        cleaned = cleaned.replace(",", ".")

    try:
        return float(cleaned)
    except ValueError:
        return 0.0

# Estas funciones se encargan de ejecutar el proceso completo de ETL, coordinando la extracción, transformación y carga, y mostrando resúmenes y estadísticas útiles para el usuario.
def validate_field_groups(
    dataframe: pd.DataFrame,
    field_groups: dict[str, list[str]],
    file_label: str,
    required: bool = True,
) -> list[str]:
    missing_fields = []

    title = "campos obligatorios" if required else "campos opcionales"
    print(f"\nValidando {title} de {file_label}:")

    for target_field, possible_columns in field_groups.items():
        found_columns = [
            column for column in possible_columns if column in dataframe.columns
        ]

        if found_columns:
            print(f"✅ {target_field} ← {found_columns[0]}")
        else:
            missing_fields.append(target_field)
            icon = "❌" if required else "⚠️"
            print(
                f"{icon} {target_field} no encontrado. "
                f"Columnas candidatas: {possible_columns}"
            )

    return missing_fields

# Estas funciones se encargan de coordinar la ejecución del ETL, mostrando resúmenes y estadísticas útiles para el usuario
# permitiendo hacer un dry-run para validar los archivos antes de cargar datos reales a Supabase.
def get_clean_key_set(dataframe: pd.DataFrame, column: str) -> set[str]:
    return set(
        dataframe[column]
        .astype(str)
        .str.strip()
        .replace("", pd.NA)
        .dropna()
    )


# Convierte las claves de un diccionario a string, para evitar problemas de tipo de clave.
def inspect_files(cabecera_path: Path, detalle_path: Path) -> None:
    print_section("LECTURA DE ARCHIVOS")

    cabecera_df = read_tsv(cabecera_path)
    detalle_df = read_tsv(detalle_path)

    print(f"Cabecera: {cabecera_path}")
    print(f"Detalle:   {detalle_path}")

    print_section("ESTRUCTURA GENERAL")

    print(f"Cabecera → filas: {len(cabecera_df)}, columnas: {len(cabecera_df.columns)}")
    print(f"Detalle   → filas: {len(detalle_df)}, columnas: {len(detalle_df.columns)}")

    print_section("COLUMNAS CABECERA")
    print(list(cabecera_df.columns))

    print_section("COLUMNAS DETALLE")
    print(list(detalle_df.columns))

    print_section("VALIDACIÓN DE CAMPOS LÓGICOS")

    missing_cabecera_required = validate_field_groups(
        cabecera_df,
        CABECERA_REQUIRED_FIELDS,
        "cabecera.tsv",
        required=True,
    )

    validate_field_groups(
        cabecera_df,
        CABECERA_OPTIONAL_FIELDS,
        "cabecera.tsv",
        required=False,
    )

    missing_detalle_required = validate_field_groups(
        detalle_df,
        DETALLE_REQUIRED_FIELDS,
        "detalle.tsv",
        required=True,
    )

    validate_field_groups(
        detalle_df,
        DETALLE_OPTIONAL_FIELDS,
        "detalle.tsv",
        required=False,
    )

    if missing_cabecera_required or missing_detalle_required:
        print_section("RESULTADO FINAL")
        print("❌ Hay campos obligatorios faltantes.")
        print("No conviene ejecutar el ETL hasta corregir el archivo o el mapeo.")
        return

    print_section("VALIDACIÓN DE CLAVE DE RELACIÓN")

    cabecera_keys = get_clean_key_set(cabecera_df, "ClaveAgrupacion")
    detalle_keys = get_clean_key_set(detalle_df, "ClaveAgrupacion")

    detalle_sin_cabecera = detalle_keys - cabecera_keys
    cabecera_sin_detalle = cabecera_keys - detalle_keys

    print(f"Claves únicas en cabecera: {len(cabecera_keys)}")
    print(f"Claves únicas en detalle:   {len(detalle_keys)}")

    if not detalle_sin_cabecera:
        print("✅ No hay detalles huérfanos. Todo detalle tiene cabecera.")
    else:
        print("❌ Hay ClaveAgrupacion en detalle que no existen en cabecera:")
        for key in sorted(detalle_sin_cabecera):
            print(f"   - {key}")

    if not cabecera_sin_detalle:
        print("✅ No hay cabeceras sin detalle.")
    else:
        print("⚠️ Hay cabeceras que no tienen detalle:")
        for key in sorted(cabecera_sin_detalle):
            print(f"   - {key}")

    print_section("VALIDACIÓN DE DUPLICADOS")

    duplicated_cabecera_keys = cabecera_df[
        cabecera_df.duplicated(subset=["ClaveAgrupacion"], keep=False)
    ]

    if duplicated_cabecera_keys.empty:
        print("✅ No hay ClaveAgrupacion duplicadas en cabecera.")
    else:
        print("⚠️ Hay ClaveAgrupacion duplicadas en cabecera.")
        print(
            duplicated_cabecera_keys[
                ["ClaveAgrupacion", "Cuenta", "Destinatario_Id"]
            ].head(20).to_string(index=False)
        )

    duplicated_debt_ids = detalle_df[
        detalle_df.duplicated(subset=["DEUD_id"], keep=False)
    ]

    if duplicated_debt_ids.empty:
        print("✅ No hay DEUD_id duplicados en detalle.")
    else:
        print("⚠️ Hay DEUD_id duplicados en detalle.")
        print(
            duplicated_debt_ids[
                ["DEUD_id", "ClaveAgrupacion", "Cuenta"]
            ].head(20).to_string(index=False)
        )

    print_section("VALIDACIÓN CUENTA CABECERA VS DETALLE")

    if "Cuenta" in cabecera_df.columns and "Cuenta" in detalle_df.columns:
        cabecera_account_by_key = (
            cabecera_df[["ClaveAgrupacion", "Cuenta"]]
            .drop_duplicates()
            .set_index("ClaveAgrupacion")["Cuenta"]
            .to_dict()
        )

        mismatches = []

        for _, row in detalle_df.iterrows():
            key = str(row["ClaveAgrupacion"]).strip()
            detalle_cuenta = str(row["Cuenta"]).strip()
            cabecera_cuenta = str(cabecera_account_by_key.get(key, "")).strip()

            if cabecera_cuenta and detalle_cuenta and cabecera_cuenta != detalle_cuenta:
                mismatches.append((key, cabecera_cuenta, detalle_cuenta))

        if not mismatches:
            print("✅ Las cuentas coinciden entre cabecera y detalle para cada ClaveAgrupacion.")
        else:
            print("⚠️ Hay diferencias entre Cuenta de cabecera y Cuenta de detalle:")
            for key, cabecera_cuenta, detalle_cuenta in mismatches[:20]:
                print(
                    f"   - ClaveAgrupacion={key} | "
                    f"cabecera.Cuenta={cabecera_cuenta} | "
                    f"detalle.Cuenta={detalle_cuenta}"
                )

    print_section("ESTADÍSTICAS ÚTILES PARA EL ETL")

    print(f"Cuentas únicas en cabecera: {cabecera_df['Cuenta'].nunique()}")
    print(f"Destinatarios únicos:       {cabecera_df['Destinatario_Id'].nunique()}")
    print(f"Deudas individuales:        {detalle_df['DEUD_id'].nunique()}")

    print("\nCantidad de detalles por ClaveAgrupacion:")
    print(
        detalle_df.groupby("ClaveAgrupacion")
        .size()
        .sort_values(ascending=False)
        .head(10)
        .to_string()
    )

    print_section("VALIDACIÓN DE MONTOS CONSOLIDADOS")

    if "Deuda_Actualizada" in cabecera_df.columns and "NOTD_totalActualizado" in detalle_df.columns:
        detalle_sum = (
            detalle_df.assign(
                parsed_total=detalle_df["NOTD_totalActualizado"].apply(parse_decimal)
            )
            .groupby("ClaveAgrupacion")["parsed_total"]
            .sum()
            .to_dict()
        )

        differences = []

        for _, row in cabecera_df.iterrows():
            key = str(row["ClaveAgrupacion"]).strip()
            cabecera_total = parse_decimal(row.get("Deuda_Actualizada", "0"))
            detalle_total = detalle_sum.get(key, 0.0)

            # Se permite una diferencia mínima por redondeos.
            if abs(cabecera_total - detalle_total) > 0.05:
                differences.append((key, cabecera_total, detalle_total))

        if not differences:
            print("✅ La suma del detalle coincide con Deuda_Actualizada de cabecera.")
        else:
            print("⚠️ Hay diferencias entre cabecera.Deuda_Actualizada y suma detalle.NOTD_totalActualizado.")
            print("   Esto no necesariamente bloquea el ETL, pero conviene revisarlo.")
            for key, cabecera_total, detalle_total in differences[:20]:
                print(
                    f"   - ClaveAgrupacion={key} | "
                    f"cabecera={cabecera_total:.2f} | "
                    f"detalle={detalle_total:.2f}"
                )
    else:
        print("⚠️ No se pudo comparar Deuda_Actualizada vs NOTD_totalActualizado porque falta alguna columna.")

    print_section("MUESTRA DE DATOS")

    print("Cabecera:")
    print(cabecera_df.head(3).to_string(index=False))

    print("\nDetalle:")
    print(detalle_df.head(3).to_string(index=False))

    print_section("RESULTADO FINAL")

    if detalle_sin_cabecera:
        print("❌ Validación fallida: existen detalles sin cabecera.")
        print("No conviene ejecutar el ETL hasta resolver esas claves.")
    else:
        print("✅ Validación principal correcta.")
        print("Cabecera y detalle encajan por ClaveAgrupacion.")

    print("\nEste script no insertó datos en Supabase. Solo inspeccionó los archivos.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Inspecciona archivos TSV de cabecera y detalle antes del ETL."
    )

    parser.add_argument(
        "--cabecera",
        required=True,
        help="Ruta al archivo cabecera.tsv",
    )

    parser.add_argument(
        "--detalle",
        required=True,
        help="Ruta al archivo detalle.tsv",
    )

    args = parser.parse_args()

    inspect_files(
        cabecera_path=Path(args.cabecera),
        detalle_path=Path(args.detalle),
    )


if __name__ == "__main__":
    main()