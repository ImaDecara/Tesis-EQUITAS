# Importación web: formatos, límites y defensa ante archivos hostiles

Qué archivos acepta el importador y qué le pasa a cada uno que no debería aceptarse. Implementado por ALIGN-053 en `back/ETL/readers/` y `back/ETL/extract.py`; la pantalla y la API son de ALIGN-052/056. El contrato del origen y los perfiles están en [`contrato-origen-v1.md`](contrato-origen-v1.md); el corpus de prueba, en [`fixtures-sinteticas.md`](fixtures-sinteticas.md) §3.5.

**Por qué importa.** Un municipio sube planillas de Excel y un archivo subido puede ser malicioso o enorme. El lector debe aceptar lo habitual sin exponer el servidor `[P0189]`, `[P0136]`.

## 1. Formatos

| Formato | Cómo se lee | Política |
|---|---|---|
| `.xlsx` | `openpyxl` 3.1.5 en modo `read_only=True, data_only=True` y XML con `defusedxml` 0.7.1 | Aceptado. Las hojas las elige el perfil |
| CSV y TSV | `csv` de la biblioteca estándar, con el separador y la codificación del perfil | Aceptados |
| `.xls` (Excel 97-2003) | No se lee | Rechazo con el mensaje «Formato .xls no soportado: guardá el archivo como .xlsx o .csv» (D-22, revisable) |
| `.xlsm` o un `vbaProject.bin` | No se lee | Rechazo: `MACRO_NO_PERMITIDA` |
| `.ods` y otros comprimidos | No se leen | Rechazo: `FORMATO_NO_SOPORTADO` |

**El tipo sale del contenido**, nunca de la extensión ni del MIME del cliente:

- XLSX: firma ZIP más `[Content_Types].xml` con un único libro de tipo `spreadsheetml.sheet.main`. Una plantilla, un `.xlsb` o un documento de otro programa se rechazan.
- CSV/TSV: texto decodificable, sin firma ZIP ni OLE2, sin BOM de UTF-16/32 ni NUL en la primera línea.
- Firma OLE2: da el mensaje de `.xls` con cualquier nombre y cualquier perfil.

El nombre solo agrega dos rechazos explícitos, `.xls` y `.xlsm`; nunca habilita un formato. Un libro guardado con el nombre `5f1e.tmp` o `datos.csv` se lee igual.

## 2. Límites

Son configurables: `FileLimits` en `back/ETL/readers/limits.py`. Los cuatro primeros salen de `limites` en `contracts/source-contract.v1.json`.

| Límite | Por defecto | Se verifica | Código |
|---|---|---|---|
| Tamaño por archivo | 25 000 000 bytes | Antes de leer un byte (`fstat`) y al copiar al temporal | `LIMITE_ARCHIVO_EXCEDIDO` |
| Filas de datos | 300 000 | Al leer | `LIMITE_ARCHIVO_EXCEDIDO` |
| Columnas | 60 | Al leer la cabecera; en XLSX, también cualquier celda con valor más allá de la 60 | `LIMITE_ARCHIVO_EXCEDIDO` |
| Caracteres por celda | 32 767 | Al leer | `CELDA_EXCEDE_LIMITE` |
| Descomprimido total (XLSX) | 200 000 000 bytes | **Antes de abrir**, con los tamaños del directorio ZIP | `TAMANO_DESCOMPRIMIDO_EXCEDIDO` |
| Razón de compresión (XLSX) | 100, en el total y en cada parte de 1 MiB o más | **Antes de abrir** | `RAZON_COMPRESION_EXCEDIDA` |
| Tiempo de lectura por lote | 120 s | Por fila, cadena o bloque de 64 KiB | `TIEMPO_LECTURA_EXCEDIDO` |
| Archivos por lote | 2 archivos, o 1 XLSX con 2 hojas | Al llamar: `cabecera` y `detalle` | `ARCHIVOS_REQUERIDOS` |

Un lote son siempre dos archivos lógicos: dos CSV/TSV, dos XLSX o un XLSX con dos hojas. Dos libros pueden usar el mismo nombre de hoja, como `Hoja1`. Un solo libro no, y da `PERFIL_INVALIDO`.

También hay topes internos, que un archivo normal no alcanza. Sin ellos, los 200 MB descomprimidos alcanzaban para agotar la memoria:

| Tope interno (XLSX) | Valor | Código |
|---|---|---|
| Partes del ZIP y tamaño del directorio, antes de armarlo | 2 048 y 1 MiB | `LIMITE_PARTES_ZIP_EXCEDIDO` |
| Tipos, libro, relaciones y estilos, que openpyxl arma enteros | 8 000 000 bytes y 500 000 elementos cada uno | `LIMITE_PARTE_ZIP_EXCEDIDO`, `LIMITE_XML_EXCEDIDO` |
| Profundidad del XML; elementos por fila o cadena; elementos sueltos por parte | 64; 65 536; 1 000 000 | `LIMITE_XML_EXCEDIDO` |
| Largo de un formato numérico y cantidad de formatos de celda | 255 y 65 490 (topes de Excel) | `LIMITE_XML_EXCEDIDO` |
| Cadenas compartidas | 4 000 000 | `LIMITE_CADENAS_EXCEDIDO` |
| Hojas del libro | 256 | `LIMITE_HOJAS_EXCEDIDO` |

En CSV/TSV, un registro no puede pasar de 60 × (2 × 32 767 + 3) caracteres, con un piso de 1 MiB: `csv` arma la fila entera antes de entregarla. Las líneas físicas, en blanco incluidas, no pueden pasar de 2 × 300 000 + 1. Ambos dan `LIMITE_ARCHIVO_EXCEDIDO`.

## 3. XLSX

**Por qué no `load_workbook`.** El lector usa `ExcelReader`, lo mismo que `load_workbook` usa por dentro, con el mismo modo. `load_workbook` no se puede acotar ni interrumpir: arma un árbol por cada hoja, también las ignoradas, solo para buscar su dimensión; arma enteras las cadenas compartidas; y aplica expresiones regulares cuadráticas a nombres definidos y formatos numéricos. Con un archivo de 3 MB medimos más de 3 GiB, y con 1 MB un cuelgue de más de un minuto. Por eso:

- **Solo se interpreta lo que se usa:** tipos de contenido, libro, relaciones, estilos, cadenas y hojas elegidas. Propiedades, tema, nombres definidos, gráficos y hojas ignoradas no se interpretan.
- **Antes de interpretar nada,** se recorren todas las partes en flujo: CRC, tamaño real y ningún DTD en el XML. Un tamaño declarado falso da `ZIP_CORRUPTO`, y cualquier `DOCTYPE` o entidad, `XML_ENTIDAD_EXTERNA`.
- **Hojas y cadenas van en flujo:** ningún elemento sobrevive a su fila o cadena, así que la memoria no crece con el tamaño de la parte.
- **No se evalúan fórmulas, no se siguen vínculos externos y no se extrae nada a disco.**

Un ZIP inusual se rechaza con `ZIP_CORRUPTO`: cifrado, compresión que no sea `deflate` o ninguna, Zip64, rutas con `..` o `\`, nombres repetidos o entradas superpuestas.

**Hojas.** El perfil elige una por archivo lógico (`formato.hojas`). Las demás se listan en `SourceBatch.ignored_sheets`, con el nombre saneado, y se ignoran; solo se comprueba que su ZIP y su DTD estén limpios. Si falta la elegida: `HOJA_NO_ENCONTRADA`.

**Celdas.** Se convierten al mismo texto que tendrían en TSV, para que el motor dé el mismo resultado:

| Celda | Resultado |
|---|---|
| Texto | Tal cual |
| Número | Texto exacto sin notación científica, con 15 dígitos significativos; en importes y porcentajes, con el decimal del perfil |
| Porcentaje con formato `%` | Multiplicado por 100, porque el contrato usa la escala 0-100 |
| Fecha serial o con estilo de fecha, con `fecha_serial` en el perfil | `fecha` del perfil, según el sistema declarado (`1900` o `1904`). Si el libro usa otro: `SISTEMA_FECHAS_NO_COINCIDE` |
| Número en una columna de fecha, sin `fecha_serial` | Queda crudo y el motor lo marca inválido |
| Celda con estilo de fecha, sin `fecha_serial` | `FECHA_SERIAL_NO_DECLARADA` |
| Fecha con hora, serial 60 del sistema 1900 (no existió) o fuera de rango | Queda visible y el motor la marca inválida |
| Fórmula con valor guardado | El valor guardado. Nunca se evalúa |
| Fórmula sin valor guardado | `FORMULA_SIN_VALOR`, con hoja y fila |
| Error de Excel (`#REF!`) | `CELDA_CON_ERROR` |
| Booleano, hora sola o infinito | `CELDA_TIPO_NO_SOPORTADO` |
| Fila o celda repetida o fuera de orden | `ESTRUCTURA_INVALIDA`; openpyxl las descartaba en silencio |

## 4. CSV y TSV

- **Codificación:** UTF-8 con o sin BOM. `cp1252` o `latin-1` solo si el perfil la declara; nunca se adivina. Un BOM de UTF-8 en un archivo declarado `cp1252` o `latin-1` da `CODIFICACION_NO_COINCIDE`: leerlo daría texto ilegible sin ningún error.
- **Comillas sin cerrar, ancho incorrecto o celdas multilínea:** `ESTRUCTURA_INVALIDA` o `ARCHIVO_NO_LEIBLE`.

## 5. Reglas comunes a todos los formatos

- **Caracteres de control** (`CARACTER_CONTROL`): C0 y C1, incluidos los que Excel guarda como `_x0007_`, más los invisibles que disfrazan un valor: separadores de línea Unicode, controles de dirección de texto, un BOM dentro de una celda y no-caracteres. Los saltos de línea y el NUL dan `ESTRUCTURA_INVALIDA`.
- **Texto que una planilla ejecutaría** (`FORMULA_EN_CELDA`): `=…`, `@FUNC(…)`, `+texto`, `-texto` y `-2+3`, también con espacios delante, porque el motor y las planillas los recortan. Pasan negativos, teléfonos y el marcador `-`.
- **Nada del archivo sale en un error.** Los mensajes son códigos con archivo lógico, línea y campo canónico; tampoco quedan valores en la cadena de excepciones ni en las advertencias de openpyxl. La única excepción con texto libre es el mensaje fijo de `.xls`.
- **Ante cualquier defecto no se entrega un prefijo parcial:** se lee todo o nada.

## 6. Nombres y temporales

- `sanitize_filename` deja un nombre solo para mostrar: sin ruta, controles ni caracteres raros. **Nunca se usa para abrir un archivo.**
- `PrivateUploadStore` guarda en un directorio `0700`, con archivos `0600` nombrados con un token aleatorio de 128 bits. Rechaza un directorio compartido o un enlace simbólico (`ALMACEN_TEMPORAL_INSEGURO`) y cualquier token que no sea propio (`TEMPORAL_INVALIDO`). La copia tiene tope de bytes y no deja parciales.
- **TTL de 24 h**, configurable. `release` borra al publicar o descartar y es idempotente. Lo abandonado se retira en cada `save`, en cada `resolve` de ese token y con `purge_expired`.
- **Ningún método envía datos afuera**, y la lectura no crea otros archivos.

## 7. Mediciones

Cada archivo se midió en un proceso propio; el crecimiento de memoria es `ru_maxrss` respecto del arranque del proceso. macOS arm64, Python 3.12.13. `back/tests/test_readers_security.py` lo exige con cada corrida.

| Caso | Presupuesto de la prueba | Medido |
|---|---|---|
| Cada uno de los 118 archivos hostiles, salvo los 7 de abajo | 15 s y 192 MiB | Máximo 3,7 s y 107 MiB |
| Cadenas compartidas al límite: 3 999 000 distintas | 60 s y 1 GiB | 13 s y 219 MiB |
| Una cadena más que el límite: 4 000 001 vacías | 60 s y 1 GiB | 11 s y 34 MiB |
| Estilos al límite, la única parte no interrumpible con costo apreciable | 60 s y 1 GiB | 5 s y 93 MiB |
| Un solo texto de 190 MB en una celda | 60 s y 1 GiB | 1 s y 427 MiB |
| Un solo comentario o atributo de 190 MB en la hoja | 60 s y 1 GiB | 1 s y 741 MiB |
| Mayor CSV aceptado: 300 000 filas × 60 columnas | 60 s y 1 GiB | 4 s y 526 MiB |

Se midió aparte, sin incluirlo en la suite porque tarda: un XLSX de 180 MB descomprimidos con 200 000 filas × 60 columnas numéricas se lee en 78 s con 864 MiB. La cartera `escala` (2990 cabeceras y 56 289 detalles) da el mismo reporte y los mismos payloads en TSV, CSV y XLSX.

**Qué no cubren estos límites.** Dentro del proceso no se puede interrumpir el armado de los estilos, unos 5 s. Con dos archivos al máximo, estimamos cerca de 1,8 GiB, el doble de lo medido con uno. Por eso, el servidor debería correr el lector en un proceso aparte, con tope de memoria y de tiempo (ALIGN-052/059).

## 8. Uso

```python
from ETL.extract import load_source_profile, read_source_batch, validate_source_files
from ETL.readers.limits import PrivateUploadStore, XLS_MESSAGE

with PrivateUploadStore(raiz_privada) as store:
    upload = store.save(flujo_subido, nombre_del_usuario)   # upload.display_name es solo para mostrar
    path = store.resolve(upload.token)
    mapping = load_source_profile(ruta_perfil, contract)
    batch = read_source_batch({'cabecera': path, 'detalle': path}, mapping, contract=contract)
    # batch.tables: SourceTable para validate_batch; batch.ignored_sheets: para el preview autorizado.
    store.release(upload.token)                             # al publicar o descartar
```

Los errores son `ValidationError`, cuyo texto es `CODIGO: archivo=…, linea=…, campo=…` o solo el código. El de `.xls` es `FORMATO_XLS_NO_SOPORTADO: ` seguido de `XLS_MESSAGE`.
