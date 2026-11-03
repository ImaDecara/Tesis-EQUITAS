# Importación web: API interna de lotes (ALIGN-052)

Cómo una persona autorizada del municipio entrega un lote sin intervención técnica y sin abrir una puerta nueva a los datos `[P0189]`, `[T02.R02]`. Reglas de autenticación, roles y credenciales: [`back/api/README.md`](../../back/api/README.md). Decisión de arquitectura: [ADR-001](adr-001-reglas-y-capas.md) §5.1.

> Esta sección cubre recibir, consultar y descartar. El lote llega a `RECIBIDO` y el archivo no se interpreta. Mapeo (ALIGN-056), preview (ALIGN-054) y confirmación (ALIGN-057) agregan sus rutas a `back/api/imports.py` y a la lista cerrada de `front/lib/server/imports-forward.ts`.

## Camino de una solicitud

```text
Navegador ── cookie de sesión ──> Route Handler de Next ── Bearer + flujo ──> FastAPI ── token del usuario (RLS) ──> Supabase local
                                  front/app/api/imports/*                     127.0.0.1    └─ equitas_import_server: record_import_batch
```

- **El navegador nunca llama a FastAPI.** La URL interna está en `EQUITAS_IMPORT_API_URL`, sin prefijo público, y solo la lee un módulo `server-only`. Esta versión solo admite loopback.
- **Qué pasa y qué vuelve.** El Route Handler reenvía una lista cerrada de rutas, sin la consulta ni las cookies. Al navegador vuelven el código y un cuerpo JSON. Una redirección o una respuesta que no sea JSON se convierte en `502`, y un servicio caído en `503`, sin citar la URL.
- **Origen.** Una escritura exige un `Origin` igual al de la aplicación: esquema, host y puerto, tal como lo serializa un navegador. Si viene, además, `Sec-Fetch-Site: same-origin`. Si no, `403 ORIGIN_NOT_ALLOWED`.
- **La autoridad es FastAPI.** El Route Handler solo extrae el token de la sesión y la renueva si venció. Una cookie falsificada termina en `401` en FastAPI.

### `/api/imports` queda fuera del proxy de Next

Con `proxy.ts` en el camino, Next retiene el cuerpo en memoria y lo **corta en 10 MB sin ningún error** (`proxyClientMaxBodySize`, en `node_modules/next/dist/docs/`). Un lote de hasta 25 MB por archivo llegaría truncado. Por eso el matcher de `front/proxy.ts` excluye esta ruta. Reinyectado el defecto, el lector rechaza el cuerpo cortado con `MULTIPART_INVALIDO`: nunca se acepta un lote truncado. Fuera del proxy, una sesión ausente recibe un `401` en JSON y no una redirección a `/login`.

## Contrato

| Ruta | Cuerpo | Respuesta |
|---|---|---|
| `POST /imports` | `multipart/form-data`: `as_of` y `cabecera` + `detalle`, o `libro`; `source_updated_at` opcional. Encabezado **obligatorio** `Idempotency-Key` (UUID) | `201` nuevo, `200` repetición |
| `GET /imports/{id}` | — | `200` con el evento vigente |
| `POST /imports/{id}/discard` | — | `200` con el evento `DESCARTADO` |

La respuesta lleva `id` (evento vigente), `root_id` (lote), `tenant`, `status`, `source`, `file_hashes`, `as_of`, `source_updated_at`, `rules_version`, `counts`, `created_by_role`, `created_at`, `copy_available` y `copy_expires_at`. No lleva `created_by`, la clave de idempotencia ni rutas o nombres de archivo. `{id}` puede ser cualquier evento de la cadena.

| Código | Motivo |
|---|---|
| `413 LIMITE_ARCHIVO_EXCEDIDO` | Más de 25 000 000 bytes por archivo (`limites.bytes` de `contracts/source-contract.v1.json`) o más de 51 048 576 bytes por solicitud. Se corta al pasar el límite, sin leer el resto |
| `415 MULTIPART_REQUERIDO` | Otro tipo de contenido o un límite multipart inválido |
| `408 UPLOAD_TIEMPO_EXCEDIDO` | La recepción tardó más de 300 s |
| `422` | `AS_OF_INVALIDO`, `SOURCE_UPDATED_AT_INVALIDO`, `ARCHIVOS_REQUERIDOS`, `ARCHIVO_VACIO`, `ARCHIVO_NO_ESPERADO`, `ARCHIVO_DUPLICADO`, `CAMPO_DUPLICADO`, `CAMPO_NO_ESPERADO`, `CAMPO_EXCEDE_LIMITE`, `MULTIPART_INVALIDO`, `MULTIPART_DEMASIADAS_PARTES`, `IDEMPOTENCY_KEY_REQUERIDA`, `IDEMPOTENCY_KEY_INVALIDA` |
| `404 BATCH_NOT_FOUND` | Lote inexistente o de otro municipio: mismo cuerpo |
| `409` | `IDEMPOTENCY_KEY_CONFLICT`, `BATCH_NOT_DISCARDABLE`, `BATCH_ALREADY_SUPERSEDED` |
| `503` | `READ_INCOMPLETE`, `BATCH_WRITE_FAILED`, `IMPORT_WRITER_NOT_CONFIGURED`, `ALMACEN_TEMPORAL_INSEGURO`, `ALMACEN_TEMPORAL_NO_DISPONIBLE` |

- **Un lote son dos archivos lógicos:** `cabecera` y `detalle`, o un `libro` con dos hojas. El tipo real lo decide el lector al leer, no esta ruta.
- **Los campos que no son del lote se ignoran**, también `tenant`, hasta 1024 bytes cada uno. Un archivo con otro nombre de campo se rechaza.
- **`as_of` es un hecho del lote, no del perfil** (R3 de ALIGN-030). Lo declara cada envío y no se reemplaza por la fecha de hoy.
- **Idempotencia.** La clave es obligatoria y se genera una por lote: el mismo envío se reintenta con la misma. Con el mismo contenido devuelve el mismo lote; con otro contenido, o de otra persona, `409`.
- **Fila y copia no se contradicen.** El destino se prepara antes de registrar: si no sirve, `503` y sin fila. Una vez registrada la fila, no se anuncia éxito hasta verificar una copia completa con los hashes declarados; si no se pudo guardar, `503 ALMACEN_TEMPORAL_NO_DISPONIBLE`. Ese envío se reintenta con la misma clave y restaura la copia. Lo mismo vale si la respuesta se perdió, si la copia venció o si quedó dañada, siempre que el lote siga abierto (`RECIBIDO`, `VALIDADO`, `REQUIERE_NUEVO_PREVIEW`). Un lote cerrado no recupera su copia: el reintento devuelve su estado actual. `copy_available` sale del disco, no de la fila: el `GET` comprueba clases y tamaño total sin leer los archivos.
- **Estados.** `import_batch` es append-only: un cambio de estado es una fila que reemplaza a la anterior. Se puede descartar en `RECIBIDO`, `VALIDADO` y `REQUIERE_NUEVO_PREVIEW`. `CONFIRMADO`, `PUBLICADO` y `FALLIDO` dan `409`. ALIGN-032 define las transiciones y puede afinar esta lista. Descartar dos veces da el mismo evento, también en simultáneo: la clave es derivada.

## Por qué un lector multipart propio

`python-multipart` no está entre las dependencias fijadas, así que `Request.form()` no se puede usar, y además arma cada parte antes de entregarla. `back/api/multipart.py` emite los bytes a medida que llegan y solo acepta lo que produce un navegador: sin preámbulo, sin codificación de transferencia, con cierre obligatorio. Los errores son códigos: no citan la entrada. Si más adelante se fija esa dependencia, este módulo se puede reemplazar sin cambiar el contrato.

## Temporal privado

`back/api/upload_store.py`. Directorios `0700` y archivos `0600`, fuera del repositorio (`EQUITAS_IMPORT_TMP_DIR`). Rechaza una raíz compartida, ajena o que sea un enlace simbólico.

```text
<raíz>/incoming/<token de 128 bits>/<clase>   mientras se recibe
<raíz>/lotes/<tenant>/<root_id>/<clase>       desde que el lote queda registrado
<raíz>/retirados/<token>/                     una generación retirada, hasta borrarla
<raíz>/bloqueos/<NN>.lock                     exclusión por lote; no guardan datos
```

Ninguna ruta se arma con datos del cliente y el nombre del archivo no se guarda. Un error, un corte de conexión o un tiempo excedido no dejan nada. El descarte borra la copia.

**Retención: 24 h, sin depender de que alguien suba o descarte.**

- Una copia vencida **no se entrega**: `UploadStore.files` y `verify` la tratan como ausente desde el segundo 86 400 y la borran.
- Los bytes se retiran solos: `purge_expired` corre al arrancar el proceso, para lo que venció con el proceso detenido, y después cada `EQUITAS_IMPORT_PURGE_SECONDS` (900 por defecto, 3600 como máximo). También en cada recepción y en cada descarte. Mientras el proceso corre, un archivo vencido queda en disco como mucho ese intervalo más.
- Si una purga falla, queda `PURGA_FALLIDA clase=…` o `PURGA_INCOMPLETA pendientes=…` en el registro, sin rutas, y la siguiente vuelve a intentar. Lo que no se pudo borrar sigue sin entregarse.
- **Límite:** con el proceso detenido nada purga hasta el próximo arranque. Es la condición de esta versión local; un despliegue (ALIGN-050) debe decidir si además hace falta una tarea externa.

**Concurrencia: fila, copia y purga no se contradicen, en ningún orden.** El nombre de un lote puede ir ocupándolo una copia tras otra, así que:

- `UploadStore.lock(tenant, lote)` da exclusión real por lote, con `flock`: rige entre hilos y entre procesos, y el núcleo la suelta si el proceso muere. La espera tiene tope: 30 s y `503 ALMACEN_TEMPORAL_NO_DISPONIBLE`, y el mismo envío se reintenta.
- **Instalar** lee el estado bajo la exclusión y decide con él: abierto, instala y verifica; descartado, retira. **Descartar** escribe el evento y retira la copia bajo la misma exclusión. Una creación pendiente que llega después de un descarte ya ve `DESCARTADO`.
- **Nada se borra por el nombre del lote.** Bajo la exclusión, la generación se mueve a `retirados/` con un nombre privado, y recién ahí se borra. La purga solo toma una candidata al recorrer: vuelve a decidir bajo la exclusión. Una decisión vieja no alcanza a una copia nueva. Si el lote está ocupado, queda para la próxima purga, sin entregarse.
- Un descarte interrumpido entre el evento y el borrado se repara en el siguiente `GET`, reintento o descarte.
- **Quien agregue un cierre (ALIGN-057 al publicar) debe escribir el evento y llamar a `release` bajo `store.lock(tenant, root_id)`.** Instalar relee el estado después de copiar, así que un cierre sin exclusión tampoco deja copia de un `DESCARTADO`, pero esa relectura no sustituye a la exclusión.
- **Costo:** `GET`, descarte y reintento leen todos los eventos del municipio, paginados, para no poner el `{id}` en una URL. Son pocos: un lote produce un puñado de eventos.

**Para quien lea el archivo (ALIGN-054, 056).** `UploadStore.files(tenant, root_id)` devuelve las rutas de la copia vigente y `verify(tenant, root_id, file_hashes)` comprueba el contenido antes de confiar en él. Si no están, se perdió o venció: hay que pedir que se reenvíe con la misma clave. Cuando ALIGN-053 esté integrado, el lector corre **en un proceso aparte, con tope de memoria y de tiempo**, y hay que decidir si este almacén se unifica con `PrivateUploadStore`, que resuelve lo mismo por token.

## Lo que esta versión no hace

- **Usuario con dos membresías activas:** recibe `409 TENANT_SELECTION_REQUIRED`, sin filas. El ticket pide ignorar cualquier municipio enviado por el cliente, así que no se usa la cookie de selección de la web. Si esas personas deben importar o leer por esta API, hace falta una decisión expresa sobre cómo llega la selección.
- **`importador_sistema`:** credencial de máquina, por ALIGN-060.
- **Cuota por municipio:** un importador autorizado puede ocupar disco hasta que venza el TTL. Lo cubre la campaña de tamaño y tiempo de ALIGN-059.
- **Registros de Kong fuera de esta API.** Esta API no pone ningún valor del cliente en una URL (`back/api/README.md`). La web sí lee por la Data API con la DAL de ALIGN-019: `front/lib/auth/tenant-access.ts` filtra `tenant_user` por el valor de la cookie de selección de municipio, antes de saber si hay membresía, y Kong registra ese valor. `front/lib/server/case-review-snapshot.ts` (ALIGN-020) filtra por el objeto de la decisión. Es otro recorrido, con otras pantallas: cerrarlo exige cambiar esos tickets y queda fuera de este. Tampoco se cambia la configuración de Kong: la genera la CLI de Supabase del stack local.
- **Despliegue fuera de loopback:** ALIGN-050. El origen se compara entero contra el esquema con que Next recibió la solicitud y el `Host`. Detrás de otro proxy hay que fijar el origen confiable de la aplicación y revisar `X-Forwarded-*`.

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
| Descomprimido total (XLSX) | 200 000 000 bytes | **Antes de abrir**, con los tamaños del directorio ZIP; después se acreditan con los bytes reales (§3) | `TAMANO_DESCOMPRIMIDO_EXCEDIDO` |
| Razón de compresión (XLSX) | 100, en el total y en cada parte de 1 MiB o más | **Antes de abrir**, y se acredita igual | `RAZON_COMPRESION_EXCEDIDA` |
| Tiempo de lectura por lote | 120 s | Dentro del lector, entre operaciones y antes de entregar el lote; corte real con `read_source_batch_supervised` (§7) | `TIEMPO_LECTURA_EXCEDIDO` |
| Memoria de la lectura | 2 GiB residentes | Solo con `read_source_batch_supervised` (§7) | `MEMORIA_LECTURA_EXCEDIDA` |
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
- **Antes de interpretar nada,** se recorren todas las partes byte a byte, y los límites dejan de apoyarse en lo declarado: la cabecera local dice lo mismo que el directorio, las partes ocupan el archivo sin huecos ni solapes, el flujo comprimido se consume entero y termina donde termina lo declarado, y los bytes reales y el CRC coinciden. Se descomprime descartando la salida y se corta en el primer byte de más: 200 MB reales detrás de un tamaño chico no llegan a producirse. Cualquier diferencia da `ZIP_CORRUPTO`, y cualquier `DOCTYPE` o entidad, `XML_ENTIDAD_EXTERNA`.
- **Hojas y cadenas van en flujo:** ningún elemento sobrevive a su fila o cadena, así que la memoria no crece con el tamaño de la parte.
- **No se evalúan fórmulas, no se siguen vínculos externos y no se extrae nada a disco.**

Un ZIP inusual se rechaza con `ZIP_CORRUPTO`: cifrado, datos parcheados o cabeceras enmascaradas, compresión que no sea `deflate` o ninguna, Zip64 en cualquier cabecera o registro, rutas con `..` o `\`, un NUL en el nombre, nombres repetidos, entradas superpuestas, datos antes de la primera parte o después del fin, y un contador de partes distinto del real. El descriptor de datos que dejan los programas que escriben en flujo se acepta, con o sin firma, si coincide con el directorio; el de 64 bits no.

**Hojas.** El perfil elige una por archivo lógico (`formato.hojas`). Las demás se listan en `SourceBatch.ignored_sheets`, con el nombre saneado, y se ignoran; solo se comprueba que su ZIP y su DTD estén limpios. Si falta la elegida: `HOJA_NO_ENCONTRADA`.

**Celdas.** Se convierten al mismo texto que tendrían en TSV, para que el motor dé el mismo resultado. **Un estilo no cambia lo que un número significa:** openpyxl no convierte nada por estilo, y una sola regla decide con estilo, sin estilo y para el resultado guardado de una fórmula, en los dos sistemas de fechas.

| Celda | Resultado |
|---|---|
| Texto | Tal cual |
| Número | Texto exacto sin notación científica, con 15 dígitos significativos; en importes y porcentajes, con el decimal del perfil |
| Porcentaje con formato `%` | Multiplicado por 100, porque el contrato usa la escala 0-100. Un `%` literal (entre comillas, escapado, de relleno o entre corchetes) no escala, igual que en Excel |
| Porcentaje con un formato que escala solo algunos valores (`0%;0.0`) | `CELDA_TIPO_NO_SOPORTADO`: no se adivina |
| Número en una columna de fecha, con `fecha_serial` en el perfil, con o sin estilo | `fecha` del perfil, según el sistema declarado (`1900` o `1904`). Si el libro usa otro: `SISTEMA_FECHAS_NO_COINCIDE` |
| Ese número con menos de 1 (cero, negativos, una hora sola) en cualquier sistema; entre 59 y 61 sin incluirlos en el sistema 1900, porque el 29/02/1900 no existió; o fuera de rango | Queda crudo y el motor lo marca inválido, con o sin estilo |
| Fecha con hora | Queda visible y el motor la marca inválida |
| Número en una columna de fecha, sin `fecha_serial` | Queda crudo y el motor lo marca inválido |
| Cualquier número con estilo de fecha, sin `fecha_serial` | `FECHA_SERIAL_NO_DECLARADA` |
| Número con estilo de fecha fuera de una columna de fecha | Serial válido: el texto de la fecha, que en un importe el motor marca inválido. Serial imposible: `CELDA_TIPO_NO_SOPORTADO`, porque crudo pasaría por un número válido |
| Número con estilo de duración (`[h]:mm`) | `CELDA_TIPO_NO_SOPORTADO` |
| Fórmula con valor guardado | El valor guardado. Nunca se evalúa |
| Fórmula sin valor guardado | `FORMULA_SIN_VALOR`, con hoja y fila |
| Error de Excel (`#REF!`) | `CELDA_CON_ERROR` |
| Booleano, infinito, o `t="d"` con una hora sola | `CELDA_TIPO_NO_SOPORTADO` |
| `t="d"`, que trae una fecha ISO y no un serial, con una fecha imposible | `ARCHIVO_NO_LEIBLE` |
| Fila o celda repetida o fuera de orden | `ESTRUCTURA_INVALIDA`; openpyxl las descartaba en silencio |
| Índice de cadena o de estilo negativo, fuera de la tabla o con formas que Python acepta y el formato no (`-1`, `1_0`, ` 0`, dígitos arábigos) | `ESTRUCTURA_INVALIDA`; un -1 tomaba el último elemento |
| Lo mismo en el número guardado, el número de fila o la coordenada; tipo de celda desconocido | `ESTRUCTURA_INVALIDA` |
| Celda con `<is>` y otro tipo, o con `<is>` y `<v>` a la vez | `ESTRUCTURA_INVALIDA`; openpyxl leía uno y descartaba el otro en silencio |
| Estilo con un formato numérico propio que no declara | `ESTRUCTURA_INVALIDA`; openpyxl renumera y caía sobre otro formato, como un `0%` |

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
| Cada uno de los 118 archivos hostiles, salvo los 7 de abajo | 15 s y 192 MiB | Máximo 3,1 s y 106 MiB |
| Cadenas compartidas al límite: 3 999 000 distintas | 60 s y 1 GiB | 10 s y 217 MiB |
| Una cadena más que el límite: 4 000 001 vacías | 60 s y 1 GiB | 8 s y 36 MiB |
| Estilos al límite, la única parte no interrumpible con costo apreciable | 60 s y 1 GiB | 4 s y 92 MiB |
| Un solo texto de 190 MB en una celda | 60 s y 1 GiB | 1 s y 427 MiB |
| Un solo comentario o atributo de 190 MB en la hoja | 60 s y 1 GiB | 1 s y 740 MiB |
| Mayor CSV aceptado: 300 000 filas × 60 columnas | 60 s y 1 GiB | 3 s y 525 MiB |

Se midió aparte, sin incluirlo en la suite porque tarda: un XLSX de 180 MB descomprimidos con 200 000 filas × 60 columnas numéricas se lee en 72 s con 842 MiB. La cartera `escala` (2990 cabeceras y 56 289 detalles) da el mismo reporte y los mismos payloads en TSV, CSV y XLSX. Un libro guardado por LibreOffice 26.2 de verdad, con descriptores de datos, da el mismo reporte que el TSV. Excel real no se probó.

Con `read_source_batch_supervised` (§8), con memoria residente total del hijo, base incluida:

| Caso | Resultado | Tiempo | Memoria del hijo |
|---|---|---:|---:|
| Estilos al límite, plazo de 1,5 s | `TIEMPO_LECTURA_EXCEDIDO`. Dentro del proceso, esta fase demora el rechazo a unos 3,5 s | 1,51 s | 175 MiB |
| Texto de 190 MB, tope de 250 MiB | `MEMORIA_LECTURA_EXCEDIDA`. El hijo llegó a pasarlo antes del corte | 0,75 s | 292 MiB |
| Dos CSV de 300 000 filas × 60 columnas, lote entero | Aceptado. El padre, que recibe las filas, crece 846 MiB | 9,3 s | 1136 MiB |
| Mayor XLSX | Rechazo por columnas, tras leerlo entero | 72 s | 949 MiB |
| Dos XLSX al máximo (cerca de 192 000 filas × 60 cada uno), plazo por defecto | `TIEMPO_LECTURA_EXCEDIDO`: no entran en 120 s | 120 s | 1356 MiB |
| Los mismos, con un plazo de 400 s | Aceptado. El padre llega a 870 MiB | 155 s | 1827 MiB |

Por eso el tope por defecto es de 2 GiB: alcanza para lo más grande que los límites dejan pasar, sin holgura de sobra. Otra máquina o asignador pueden necesitar otro valor, y es configurable.

**Qué no cubren estos límites.** Dentro del proceso no se puede interrumpir el armado de los estilos, unos 5 s: por eso, un archivo subido se lee con `read_source_batch_supervised` (§8).

## 8. Quién corta de verdad

Hay dos maneras de leer, y **un archivo subido se lee con la segunda**:

| | `read_source_batch` | `read_source_batch_supervised` |
|---|---|---|
| Dónde corre | En el proceso de quien llama | En un proceso hijo, `ETL.readers.supervised` |
| Plazo | Se comprueba entre operaciones, al terminar cada parte y antes de entregar: un lote vencido nunca se entrega. No interrumpe un parser en plena operación: un rechazo puede llegar tarde | Un vigilante en el padre mata al hijo al vencer. El rechazo llega a tiempo, sea cual sea la fase |
| Memoria | Sin tope | El mismo vigilante mata al hijo si pasa de `read_memory_bytes` |
| Uso | Pruebas y línea de comandos, con archivos propios | API y cualquier archivo de un usuario |

El hijo es no confiable: no hereda el entorno, así que no ve ninguna credencial; no tiene stderr, para que un traceback no cite un valor; y contesta en JSON por líneas, no en pickle, para que un hijo comprometido no pueda ejecutar nada en el padre. Sin la marca final no hay lote: un hijo que muere o contesta otra cosa da `LECTURA_INTERRUMPIDA`, nunca un prefijo. El plazo incluye el arranque del hijo, cerca de 1 s.

**Qué resuelve este ticket y qué queda para quien lo invoca:**

- **ALIGN-054/055** llaman a `read_source_batch_supervised` con las rutas que entrega `UploadStore.files`, y traducen sus códigos a la respuesta HTTP. Ese almacén sigue siendo el dueño del archivo: la lectura no copia ni borra nada. No hace falta `PrivateUploadStore`, y no conviene copiar a un segundo almacén, porque reiniciaría el TTL.
- **`validate_batch` no está cubierto** por `read_seconds`: corre después, en quien invoca, sobre filas ya acotadas. Si esa ruta necesita un máximo total, lo pone quien la arma.
- **La llamada bloquea:** el hijo tarda hasta `read_seconds`. Quien la haga desde una ruta asíncrona la manda a un hilo y limita cuántas corren a la vez, porque cada una usa hasta `read_memory_bytes`. Eso, y cuántos lotes simultáneos admite el servidor, es de ALIGN-055 y del despliegue.
- **ALIGN-059** cuenta con que el tope de memoria es una medición del padre cada 0,1 s, no un límite del núcleo: una reserva muy brusca puede pasarlo por un instante antes del corte. Un `cgroup` o `--memory` en el despliegue lo vuelve estricto. El hijo tampoco está encerrado: sin red ni disco, si se quiere, es tarea del despliegue.

## 9. Uso

```python
from ETL.extract import load_source_profile
from ETL.readers.limits import XLS_MESSAGE
from ETL.readers.supervised import read_source_batch_supervised

mapping = load_source_profile(ruta_perfil, contract)
batch = read_source_batch_supervised({'cabecera': ruta, 'detalle': ruta}, mapping, contract=contract)
# batch.tables: SourceTable para validate_batch; batch.ignored_sheets: para el preview autorizado.
```

Con archivos sueltos, fuera de la API, `PrivateUploadStore` los guarda con TTL: `save` devuelve un token, `resolve` da la ruta y `release` borra al publicar o descartar.

Los errores son `ValidationError`, cuyo texto es `CODIGO: archivo=…, linea=…, campo=…` o solo el código. El de `.xls` es `FORMATO_XLS_NO_SOPORTADO: ` seguido de `XLS_MESSAGE`.
