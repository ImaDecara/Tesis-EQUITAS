# Contrato de origen v1 y validación sin credenciales

ALIGN-024 · plan EQUITAS `2026-10-28-v2` · **Provisional hasta la homologación del
custodio (ALIGN-046)**. El contrato verificable es
[`source-contract.v1.json`](../../contracts/source-contract.v1.json). Aplica las
unidades, faltantes y agregados de [ALIGN-007](contrato-dominio-v1.md), §§2–5,
y los controles del plan §§7.1–7.4 y 7.8. No certifica el significado del origen
real. La tesis exige un reporte de calidad previo a la carga (`[T02.R02]`,
`[P0189]`; requisitos R12, R13, R14 y R10).

## 1. Uso y límites

Desde `back/`, con Python 3.12:

```sh
.venv/bin/python -m ETL.validate_source \
  --folder tests/fixtures/sintetico-v1 \
  --contract ../contracts/source-contract.v1.json \
  --cut-off 2026-09-30 --output /tmp/align024-reporte
```

Produce `report.json` y `report.md`. Salidas: **0** lote validado; **1** lote
analizado pero bloqueado; **2** configuración, lectura del JSON o escritura de
salida no ejecutable. La fixture de contrato devuelve **1 deliberadamente**:
contiene cuarentenas, un huérfano e importe no informado. Un exit 1 en esta fixture
no implica una falla del programa. Una falla de lectura de TSV sí genera reporte
bloqueado; un JSON de configuración ilegible no permite construir ese reporte.
Un contrato incompleto o con tipos/efectos no soportados se rechaza antes de leer
filas con `CONFIGURACION_INVALIDA`, salida 2, sin traceback ni valores del origen.

No se importan `ETL.config`, `ETL.transform`, pandas, dotenv ni clientes de base;
no se leen variables de entorno ni `.env`. Solo se usa la biblioteca estándar.
El validador no publica, modifica ni consulta datos persistidos. Los límites son
25 000 000 bytes, 300 000 registros, 60 columnas y 32 767 caracteres por celda.
La lectura directa de rutas de este validador admite TSV. ALIGN-030 incorpora
el adaptador TSV/CSV en `ETL.extract`, que entrega `SourceTable` al mismo motor;
ALIGN-053 suma XLSX y los controles ante archivos hostiles
([`importacion-web.md`](importacion-web.md)).

`python -m ETL.inspect_tsv --cabecera … --detalle … --cut-off … [--mapping …]`
llama al mismo motor. Ya no tiene parsers monetarios propios, conciliación
independiente ni impresión de muestras. Sus constantes de columnas salen del
contrato JSON. El ejecutor `run_etl.py` conserva su comportamiento de ALIGN-025;
la conexión con esta validación corresponde a ALIGN-026.

## 2. Declaración de lote y mapeo

Fuera de la fixture se exige `--mapping <json>`; no se adivinan municipio,
jurisdicción, moneda, corte, catálogos ni formato. El JSON tiene esta estructura:

```json
{
  "version": "source-mapping.v1",
  "municipio": "municipio-sintetico-a",
  "jurisdiccion": "SINTETICA",
  "moneda": "ARS",
  "fecha_corte": "2026-09-30",
  "formato": {
    "tipo": "tsv", "separador": "\\t", "codificacion": "utf-8",
    "decimal": ",", "miles": ".", "fecha": "dd/mm/aaaa"
  },
  "catalogos": {
    "Bien_Tipo_Id": {"3": "RODADO"},
    "Tipo_Ingreso_Id": {"100": "automotor"},
    "NOTD_ESTA_id": {"10": "PENDIENTE", "20": "PAGADA"},
    "NOTD_SITU_id": {}
  },
  "columnas": {"detalle": {"NOTD_totalActualizado": "importe_exportado"}},
  "vigencia_contactos": [],
  "vigencia_por_defecto": "NO_INTEGRADO"
}
```

El mapeo es **nombre canónico → columna física**, con identidad para los nombres
no declarados. No admite dos campos canónicos leyendo la misma columna.
El lector TSV admite BOM inicial en UTF-8, recorta los encabezados y omite líneas
vacías sin delimitadores, incluso al final. Conserva los números de línea físicos;
las filas con delimitadores y celdas vacías sí se validan. Encabezados duplicados
después del recorte siguen siendo un error. Los nombres físicos del mapeo se
declaran ya recortados. ALIGN-030 debe conservar estas reglas en los adaptadores.
Los nombres desconocidos se ignoran y se cuentan; no se reproducen en reportes.
El corte ISO `aaaa-mm-dd` es obligatorio y debe coincidir con `fecha_corte`;
jamás se sustituye por el reloj. `moneda` es un código de tres letras mayúsculas.
El publicador debe obtener el municipio de su contexto autorizado, comprobarlo
contra el lote y congelar el mapeo; este dry-run no autentica al importador.

Solo `manifest.json` con versión `sintetico-v1` y clase sintética habilita el
adaptador automático: usa [el perfil sintético](../../contracts/source-mapping.sintetico-v1.json),
el formato/corte/catálogos del manifiesto y `contactos-vigencia.json`. El municipio
principal está declarado como `municipio-sintetico-a`, no inferido de las filas.
Ese adaptador no demuestra procedencia ni autoriza usar datos reales. Para el
municipio B se pasa un mapeo explícito con su municipio y los mismos catálogos.
No se lee `expected.json` desde el código productivo.

### 2.1 Perfiles TSV/CSV — ALIGN-030 (R14)

[`source-mapping.schema.json`](../../contracts/source-mapping.schema.json) es el
esquema JSON Schema Draft 7 compartido con ALIGN-056. El lector lo evalúa con
biblioteca estándar, sin añadir dependencias, y después verifica las restricciones
cruzadas del contrato mediante la API pública del validador. Los perfiles de
ejemplo son [`source-mapping.sintetico-v1.json`](../../contracts/source-mapping.sintetico-v1.json)
y [`source-mapping.sintetico-csv.v1.json`](../../contracts/source-mapping.sintetico-csv.v1.json).
No contienen datos reales ni homologan un layout municipal.

- `tipo`: `tsv`, `csv` o `xlsx`. En perfiles anteriores que lo omiten se deriva
  únicamente del separador declarado: tabulador para TSV, coma o punto y coma para
  CSV. El tipo del archivo se comprueba por su contenido, nunca por la extensión
  ni por el MIME. `.xls` y `.xlsm` se rechazan con sus códigos
  ([`importacion-web.md`](importacion-web.md)).
- `hojas` y `fecha_serial`: solo XLSX, que además declara `separador: null`.
- Codificaciones: `utf-8`, `utf-8-sig`, `cp1252`, `latin-1`, esta última solo si el
  perfil la declara; nada se adivina. UTF-8 admite BOM inicial.
  Decimales: coma o punto; miles: punto, coma o vacío, distinto del decimal.
  Fechas: `dd/mm/aaaa` o `aaaa-mm-dd`. No se usan locales del equipo.
- `fin_de_linea` es metadato heredado del manifiesto (`LF` o `CRLF`); ambos
  finales se leen. Las comillas CSV son dobles y se escapan duplicándolas.
  No se admiten celdas multilínea ni NUL, incluso si están entre comillas.
- Los encabezados se recortan y deben ser únicos. Las líneas vacías sin
  delimitadores se omiten conservando su posición física. La fila de títulos
  debe ser la primera. Las celdas y los identificadores siguen siendo texto.
- Los límites de bytes, filas, columnas y celda salen del contrato. Una lectura
  corrupta, excedida o incompleta lanza un error seguro y **no devuelve un prefijo
  utilizable del lote**. Una columna requerida ausente indica archivo, línea 1
  y nombre canónico, sin reproducir nombres externos ni valores del archivo.

`transformaciones` es opcional y contiene secuencias por archivo y campo canónico:

```json
{
  "cabecera": {
    "Estado": [
      {"operacion": "recortar"},
      {"operacion": "mayusculas"},
      {"operacion": "mapear_codigos", "valores": {"A": "Activo", "I": "Inactivo"}}
    ]
  },
  "detalle": {
    "NOTD_ESTA_id": [
      {"operacion": "mapear_codigos", "valores": {"P": "10", "C": "20"}}
    ]
  }
}
```

Las únicas operaciones son `recortar`, `mayusculas`, `minusculas` y
`mapear_codigos`. Se aplican en el orden escrito, antes de validar; el mapa del
ejemplo entrega `10`/`20` al catálogo del lote, que los interpreta como
`PENDIENTE`/`PAGADA`. Los códigos no incluidos generan `CODIGO_NO_MAPEADO`, sin
default. Vacíos y espacios sin contenido permanecen faltantes; no se permiten
entradas o destinos vacíos en el mapa. Una transformación sobre una columna
ausente genera `COLUMNA_MAPEADA_AUSENTE`. No se ejecutan expresiones, scripts,
regex del usuario ni inferencias sobre identificadores. Las transformaciones
también deben respetar el límite de celda después de aplicarse.

Los perfiles rechazan propiedades extra, operaciones desconocidas, alias
ambiguos y campos ajenos al contrato. `load_source_profile(path)` lee y valida;
`validate_source_profile(mapping, contract)` valida un dict sin modificarlo.
Los errores de esquema usan `PERFIL_INVALIDO`; los del contrato o sus
restricciones cruzadas, `CONFIGURACION_INVALIDA` o `CORTE_INVALIDO`.

Desde `back/`, el nuevo comando es siempre dry-run y escribe el reporte solo
en stdout. `-B` evita además la generación de cachés de bytecode:

```sh
.venv/bin/python -B -m ETL.extract \
  --cabecera /tmp/lote-sintetico/cabecera.csv \
  --detalle /tmp/lote-sintetico/detalle.csv \
  --mapping /tmp/lote-sintetico/perfil.json \
  --contract ../contracts/source-contract.v1.json --cut-off 2026-09-30
```

Salidas: **0** validado, **1** analizado y bloqueado, **2** perfil/archivo no
procesable. No tiene modo de publicación ni crea reportes en disco, clientes de
base o conexiones. El módulo de extracción conserva sus imports del ETL
heredado; la garantía de biblioteca estándar sin importarlos corresponde a
`ETL.validate_source`. `run_etl.py` conserva sus argumentos y su flujo de TSV de
ALIGN-025; no adquiere un `--mapping` ni publica a través de este adaptador.

## 3. Columnas, claves y tipos

La lista exacta y su condición están en `archivos.*.columnas` del contrato.
**Columna requerida** y **valor requerido** son cosas distintas: nombres,
documentos e identificadores descriptivos pueden estar vacíos sin inventar un
valor. Las claves, importes obligatorios y vencimiento deben estar informados.

| Archivo | Columnas requeridas | Opcionales principales |
|---|---|---|
| Cabecera | `ClaveAgrupacion`, `Bien_Tipo_Id`, `Bien_Tipo`, `Cuenta`, `Identificador`, `Destinatario_Id`, `Destinatario`, `Destinatario_CUIT`, `Deuda_Actualizada` | Descripción, estado del objeto, rol, porcentaje, contactos, domicilio, `Deuda_Capital`, `Periodos_Deuda`, `Fecha_Actualizacion`, tributo descriptivo |
| Detalle | `ClaveAgrupacion`, `DEUD_id`, `NOTD_capital`, `NOTD_totalActualizado`, `NOTD_vencimiento`, `Tipo_Ingreso_Id` | `Bien_Tipo_Id`, `Cuenta`, `Detalle_Deuda`, intereses, honorarios, `NOTD_ESTA_id`, `NOTD_SITU_id` |

`Deuda_Actualizada` y el tributo del detalle pasan a ser obligatorios para validar
conciliación y catálogo. El tributo de la cabecera es descriptivo; la obligación
define el tributo validado, evitando dos hallazgos por la misma referencia.

- Objeto: `(municipio, Bien_Tipo_Id, Cuenta)`; obligación: esa clave + `DEUD_id`;
  relación: esa clave + `Destinatario_Id`. Un `DEUD_id` repetido en otro objeto
  no es duplicado. La cuenta igual en dos tipos define dos objetos.
- `ClaveAgrupacion` enlaza cabecera y detalle. Puede repetirse entre relaciones
  del mismo objeto; si apunta a objetos distintos, todos quedan en cuarentena
  y la ambigüedad bloquea el lote. Un enlace vacío nunca se registra ni se busca:
  se informa `CAMPO_OBLIGATORIO_VACIO`; el detalle no asignable también se informa
  como `DETALLE_SIN_CABECERA`. No se concilia un objeto cuyo enlace es vacío o
  ambiguo. Sus subtotales tienen presencia `NO_INTEGRADO` y `completo=false`:
  el universo de obligaciones del objeto no se puede determinar. Son null si no
  hay detalles asignados; si los hay, conservan ese subtotal parcial. El importe de
  los detalles no asignables sigue informado aparte; `importe_evaluable=false`.
- `Cuenta` y `Bien_Tipo_Id` del detalle se comparan con la cabecera únicamente
  cuando están informados. Su vacío opcional no es una diferencia ni invalida.
  En los catálogos obligatorios, vacío es `CAMPO_OBLIGATORIO_VACIO` con presencia
  `NO_INFORMADO_EN_ORIGEN`; un código presente ajeno al catálogo es `INVALIDO`.
- Cuenta y claves numéricas: representación decimal canónica de bigint no
  negativo, entre 0 y 9223372036854775807. Se recortan espacios externos; no se
  quitan ceros ni caracteres: `000123`, `R-0456`, signos y exponentes se rechazan.
- Una cabecera representa una relación. Sus controles y campos comunes deben
  coincidir con los de las otras relaciones del objeto; no se suman por persona.
  La deuda por persona sigue siendo exposición asociada **no aditiva**.
- Importes: `Decimal`, hasta `numeric(18,2)`, no negativos, cero conservado;
  uno o dos decimales o entero, agrupación de miles correcta si aparece.
  Separadores declarados por lote, sin símbolos monetarios, exponentes, NaN ni
  Infinity. No se mezclan `1.234,56` y `1,234.56` ni se prueba otro formato al fallar.
- Porcentaje: 0–100, con separador decimal declarado, sin miles; ausencia alerta,
  valor ilegible/fuera de rango invalida la relación. Suma distinta de 100 alerta
  al objeto; nunca se normaliza. `Periodos_Deuda` es un conteo entero no negativo,
  no el período fiscal; `DEUD_id` tampoco es un período fiscal.
- Se recortan espacios externos. Duplicado idéntico significa mismos valores
  canónicos recortados; se excluye la repetición y se conserva la primera una
  sola vez. Una diferencia en un campo conocido es `DUPLICADO_CONFLICTIVO`:
  cuarentena completa, sin seleccionar una versión para publicar. Los subtotales
  diagnósticos cuentan la primera ocurrencia única; no certifican su corrección.

## 4. Fechas, estados y faltantes

Hay un único formato de fecha por lote: `dd/mm/aaaa` o `aaaa-mm-dd`, estricto y
sin hora. `03/04/2023` significa 3 de abril bajo el primer formato. Fecha que no
respeta el formato → `FECHA_FORMATO_INVALIDO`; fecha inexistente →
`FECHA_IMPOSIBLE`, ambas `INVALIDO`. No se prueban formatos alternativos.

Centinelas declarados: `00/00/0000`, `0000-00-00`, y los días 1900-01-01,
2999-01-01 y 9999-12-31 en el formato del lote. Son `FECHA_CENTINELA` con
`NO_INFORMADO_EN_ORIGEN`, nunca vencimientos vigentes o históricos observados.
Vencimiento vacío → `FECHA_VACIA`, misma presencia. Al ser un insumo obligatorio,
todos estos casos ponen al objeto en cuarentena. Una `Fecha_Actualizacion`
ausente es opcional; su centinela solo alerta (`efecto_opcional: ALERTA` en el
JSON), con presencia `NO_INFORMADO_EN_ORIGEN`. Una fecha opcional informada pero
imposible o fuera del formato sí invalida la cabecera.
Representa `source_updated_at`, no emisión ni gestión.

El catálogo municipal declara códigos semánticos `PENDIENTE`, `PAGADA`, `ANULADA`,
`SUSPENDIDA` o `UNKNOWN`. Se resuelve cada columna informada; si ESTA falta puede
usarse SITU, únicamente con catálogo explícito. `UNKNOWN` se descarta como ausencia
antes de comparar; UNKNOWN más PENDIENTE se resuelve como PENDIENTE. Si no queda
ningún estado observado, se emite una sola alerta de estado no informado.
Dos estados observados deben
coincidir; de lo contrario, `ESTADOS_ORIGEN_CONFLICTIVOS` y cuarentena.

| Situación | Presencia | Efecto |
|---|---|---|
| Estado vacío, columna ausente o código catalogado explícitamente como UNKNOWN | `NO_INFORMADO_EN_ORIGEN` | `ESTADO_ORIGEN_NO_INFORMADO`, categoría UNKNOWN, alerta |
| Código presente fuera de catálogo | `INVALIDO` | `ESTADO_ORIGEN_DESCONOCIDO`, cuarentena igual que una fecha inválida |
| Pendiente y vencimiento anterior al corte | `OBSERVADO` | VENCIDA; atraso respecto del corte |
| Pendiente y vencimiento igual/posterior al corte | `OBSERVADO` | VIGENTE |
| Pagada, anulada o suspendida, aunque su vencimiento sea antiguo | `OBSERVADO` | Conserva su categoría, no se transforma en vencida |

El estado del objeto (`Estado`: Activo/Inactivo) es independiente del estado de
la obligación. Se recortan espacios y se aplica `casefold` antes de validar,
deduplicar y comparar cabeceras: Activo, ACTIVO y activo son equivalentes. Esta
normalización se declara en `catalogos.normalizacion_estado_objeto`; el catálogo
sigue siendo global y cerrado. El código `1` no se interpreta como activo.
Vacío queda no informado, nunca activo por defecto; otro valor presente queda
inválido. ALIGN-046 debe homologar si el origen usa códigos numéricos y requiere
un catálogo por lote; ALIGN-030 no debe aplicar conversiones booleanas implícitas.
Los IDs de catálogos sintéticos no son IDs del municipio
real ni claves internas de base. Un tributo catalogado pero sin mapeo en el ETL
heredado alerta `TIPO_INGRESO_SIN_MAPEO_EN_ETL`; no autoriza inventar un ID de base.

Cada agregado declara `valor`, `presencia`, `filas_no_observadas`, `completo`.
Con aportes observados muestra su subtotal/mínimo/máximo y cuenta aparte lo no
observado. Sin ningún aporte muestra null con la presencia correspondiente;
sin obligaciones, la suma es cero derivado y el mínimo/máximo `NO_APLICA`.
El orden de presencia sigue ALIGN-007: NO_APLICA → NO_INTEGRADO →
NO_INFORMADO_EN_ORIGEN → INVALIDO → OBSERVADO.

**Cada obligación contribuye una sola vez al desglose de atraso**, aunque le
fallen fecha y estado. Sin estado no se sabe si está pendiente y se cuenta su
presencia una vez; con estado pendiente y fecha inválida se cuenta la presencia
de esa fecha. El desglose de vencimiento tiene su propio universo de fechas.
No se suman ambos desgloses como si fueran filas distintas. Cada obligación
también tiene exactamente una categoría de `estados_al_corte`.

## 5. Contactos y vigencia

Contacto vacío: no informado. `0`, `-`, `NO POSEE` (sin distinguir mayúsculas):
`CONTACTO_PLACEHOLDER`, `INVALIDO`. Teléfono/celular admite dígitos y separadores
usuales, al menos seis dígitos; email exige una forma básica con `@` y dominio.
Formato ilegible: `CONTACTO_FORMATO_INVALIDO`, `INVALIDO`. Estos defectos alertan,
no invalidan la deuda ni aumentan severidad. Sin contactos de formato utilizable
no dados de baja, el objeto lleva `SIN_CONTACTO_UTILIZABLE`.

`vigencia_contactos` es un complemento explícito con claves
`(municipio, Destinatario_Id, columna)` y valor `ACTIVO`/`INACTIVO`. No se deduce
del texto ni se agrega una columna ficticia al origen municipal. En la fixture,
`contactos-vigencia.json` fija la precondición del oráculo: mismo teléfono activo
en una persona e inactivo en otra. Baja explícita → `CONTACTO_INACTIVO`, presencia
**OBSERVADO**, no utilizable incluso si el formato es correcto.

Fuera de la fixture, la vigencia ausente es `NO_INTEGRADO`; la ausencia de una
baja no prueba vigencia. `contactos_utilizables` cuenta candidatos de formato
aceptable y no dados de baja, **no canales verificados, consentidos ni habilitados
para envío**. El default ACTIVO del perfil es una convención sintética declarada.
No se afirma validez real ni se envían comunicaciones.

## 6. Cuarentena, conciliación y conteos

La unidad publicable es el **objeto completo**, con todas sus relaciones y
obligaciones. Una obligación inválida, una relación inválida, una cabecera
inválida, duplicado conflictivo o conciliación diferente excluye todas sus filas.
La instrucción al consumidor es conservar el estado previo y marcar
**actualización pendiente**; jamás convertirlo en ausencia de deuda. El dry-run
solo informa esta instrucción, no implementa persistencia.

`Deuda_Actualizada` se compara una vez por objeto contra Σ `NOTD_totalActualizado`
de obligaciones únicas. Diferencia absoluta **>0,05** →
`CONCILIACION_DIFERENTE`. El límite es inclusivo (0,05 se admite); se calcula con
Decimal. Con control o detalle no observado, la conciliación es no evaluable,
sin sumar el faltante como cero ni producir otro falso motivo de conciliación.
Sin detalles, el total derivado es 0 y solo concilia con control equivalente.
Esta regla exige un enlace válido: un enlace vacío o ambiguo deja la conciliación
no evaluable, sin generar una diferencia contra un cero artificial.

Un error de estructura bloquea todo el lote. También lo bloquean detalles sin
cabecera/ambiguos, más del 5 % de objetos en cuarentena, más del 5 % del importe
observado en cuarentena o importes incompletos que impiden certificar ese límite.
Los dos límites porcentuales viven en `consistencias` (configuración de servidor,
no una opción del importador). Exactamente 5 % no los supera. El porcentaje de
importe observado se declara diagnóstico cuando el importe está incompleto.
**Decisión conservadora v1, aceptada por la orquestación:** un solo importe
actualizado no evaluable o un detalle huérfano bloquea el lote, aunque los
porcentajes observados no superen el 5 %. No se estima el faltante con el control
de cabecera. **Pregunta de homologación para ALIGN-046:** ¿se mantiene el bloqueo
total o se admite una regla explícita de estimación y publicación parcial?
Hasta resolverla, ALIGN-026/052 deben respetar el bloqueo actual.

Por archivo: **leídas = aceptadas + rechazadas**. Son registros físicos, no
hallazgos. Cada registro tiene una decisión y un código primario; sus desgloses
de aceptadas/rechazadas suman los respectivos totales. Una repetición idéntica
cuenta como fila rechazada por `DUPLICADO_IDENTICO`, sin rechazar el objeto.
Los registros candidatos de un lote bloqueado no pueden publicarse:
`publicacion_permitida=false` prevalece sobre `ACEPTADA`.

Los hallazgos únicos son `(archivo, linea, campo, codigo)`, sin valores de origen.
Una fila puede tener varios defectos; el conteo de hallazgos no se suma al de filas.
El código primario de rechazo es el primer defecto detectado según el orden de
validación; si la fila no tiene defecto propio, `OBJETO_EN_CUARENTENA`. El primero
de las alertas ordenadas por campo/código explica una aceptación con hallazgos;
`OBJETO_CON_ALERTAS`/`SIN_OBSERVACIONES` completan las otras aceptaciones.

Los importes aceptados y en cuarentena se suman **una vez por objeto**, con
subtotal observado y desglose de faltantes. El importe del detalle que no puede
asignarse a un objeto se informa aparte (`detalle_sin_objeto`), sin atribuirlo a
un objeto inventado. Ante estructura/lectura fallida, los importes son null y
`universo_completo=false`. Los conteos de objetos, personas, relaciones,
obligaciones, duplicados, huérfanos, contactos y porcentajes no se calculan:
son **null**, con `conteos_presencia.<campo> = NO_INTEGRADO`. Los importes y el
desglose de faltantes también son null con presencia explícita en
`importes.presencias`; un desglose no calculado no se representa con `{}`.

Cada categoría se calcula con el mismo agregado que los objetos: si tiene
contribuciones pero ninguna observada, informa null con la presencia del faltante,
no un cero. Una categoría vacía y completamente leída sí suma cero observado.
`importes.presencias.detalle_sin_objeto` coincide con la presencia de su agregado.
Estos casos límite corrigen N2 de la revisión de ALIGN-024 sin modificar la
fixture ni el oráculo independiente de ALIGN-023.

`filas.*` conserva los conteos de registros alcanzados a leer, con
`leidas = aceptadas + rechazadas`. Si `lectura_completa=false`, el total
`conteos.filas_<archivo>` es null y su `conteos_presencia` es `NO_INTEGRADO`:
ese prefijo no permite conocer el total del archivo. Si no se pudo
leer la tabla, `columnas.*.opcionales_presentes/ausentes` y `extras_ignoradas`
son null, `presencia=NO_INTEGRADO`, sin inventar faltas de columnas obligatorias.

Con tablas leídas y vacías, `LOTE_VACIO` bloquea: los conteos cero y la suma vacía
son observados, pero el porcentaje sobre cero objetos es null con `NO_APLICA`.
También es null/`NO_APLICA` el porcentaje de importe con denominador cero y sin
faltantes. Con faltantes conserva su presencia; un numerador sin observaciones
da porcentaje null aunque el denominador tenga importes observados.
En un lote estructural, ambos porcentajes son null/`NO_INTEGRADO`. Sus presencias
están en `cuarentena.<campo>_presencia`. El Markdown muestra «no disponible»,
«no aplica» y «no evaluable» (conciliación), nunca `None` ni ceros sustitutos.

## 7. Biblioteca compartida y privacidad

```python
from ETL.validate_source import SourceRow, SourceTable, validate_batch

report = validate_batch(
    {"cabecera": path_cabecera, "detalle": path_detalle},
    mapping, contract, "2026-09-30",
)
```

`files` es un dict con esas dos claves. Cada valor admite `Path`/ruta TSV o
`SourceTable(columns=[...], rows=[SourceRow(line, values), ...])`; las celdas son
texto y `line` es entero >=2, único dentro de la tabla. El adaptador preserva
ceros y ubicaciones. Los adaptadores CSV pueden declarar separador coma/punto y
coma, XLSX `null`; la lectura de rutas del validador solo permite tabulador.
TSV v1 rechaza celdas multilínea. La fila de títulos es 1. En XLSX, `line` es el
número de fila de la hoja; en CSV/TSV, la línea física.

Para leer CSV o aplicar transformaciones, ALIGN-026/052 deben usar el adaptador:

```python
from ETL.extract import load_source_profile, read_source_tables, validate_source_files

mapping = load_source_profile(path_perfil, contract)
tables = read_source_tables(files, mapping, contract=contract)
report = validate_batch(tables, mapping, contract, "2026-09-30")
# Alternativa de una llamada, también sin escrituras:
report = validate_source_files(files, mapping, contract=contract, cut_off="2026-09-30")
```

Las tablas preservan nombres físicos, líneas y todos los registros, incluidos
los que el motor pondrá en cuarentena. Se pasan con el mismo mapeo; el lector no
deduplica ni filtra objetos. `apply_source_transformations` copia las tablas y
se aplica también a las hojas XLSX. ALIGN-056 debe guardar el mismo JSON y validar
en servidor, sin crear un segundo motor de reglas en la pantalla.
Las transformaciones pertenecen al adaptador: un perfil con `transformaciones` da
`LECTOR_TSV_SIN_TRANSFORMACIONES` si se pasan rutas directamente a `validate_batch`,
que validaría otro dato que el que después se carga. Debe pasar por
`read_source_tables` o `validate_source_files`. Un perfil leído de un archivo se
valida contra el esquema también en `load_mapping`, y las claves JSON duplicadas se
rechazan con `PERFIL_INVALIDO`.

`extract_source_files(cabecera, detalle, mapping=mapping, contract=contract)`
ofrece el puente a DataFrames del ETL existente. Renombra campos canónicos y
normaliza únicamente importes/porcentajes válidos a decimal punto sin miles y
fechas válidas a `dd/mm/aaaa`, formatos consumidos por el transformador heredado.
No completa importes ausentes ni convierte inválidos a cero. Los DataFrames no
son un reporte de validación ni una autorización de publicación: ALIGN-026 debe
validar las `SourceTable` originales, preservar objetos completos en cuarentena
y consumir sus decisiones antes de construir payloads. La llamada sin `mapping`
mantiene la lectura TSV heredada. La semántica del publicador sigue en ALIGN-026.

No se mutan entradas. El resultado es serializable y determinista, sin timestamps
del equipo, personas, documentos, teléfonos, correos, domicilios, cuentas, claves
externas, nombres/rutas de archivos subidos ni nombres de columnas desconocidas.
Las referencias `objeto-000001` son ordinales locales del reporte, **no IDs de
dominio ni seudónimos persistentes**. `decisiones_filas` permite al consumidor
identificar registros candidatos usando ubicaciones en sus propias entradas.

El código de biblioteca lanza `ValidationError` con códigos propios ante entradas
de programación/configuración inválidas. La CLI no imprime el texto original de
excepciones. El contrato es configuración confiable del servidor; no se debe
aceptar un contrato arbitrario del navegador. No se devuelve un payload para
base: la publicación transaccional, la autenticación y la revisión congelada
siguen perteneciendo a ALIGN-032/052/054.

## 8. Códigos y verificación

`codigos` del JSON es el catálogo de hallazgos con efecto `ALERTA`, `CUARENTENA`
o `BLOQUEO`; `banderas` enumera observaciones por objeto sin multiplicar filas y
`codigos_resumen` identifica propagación de cuarentena y límites de lote.
`PORCENTAJE_FALTANTE` pertenece solo a `banderas`; `LOTE_VACIO`, solo a
`codigos_resumen`. `bloquea_lote: true` declara el bloqueo adicional de huérfanos
y enlaces ambiguos; `efecto_opcional` distingue la centinela opcional. El motor
lee esos efectos y los separadores permitidos desde el contrato. Valida que los
nombre, tipo y obligatoriedad de cada columna coincidan con el motor v1, y que
estén todos sus códigos emitibles. No admite columnas nuevas en el contrato ni
redefinir como texto una fecha, un porcentaje, un contacto o un estado; una
prueba genera cada código y compara el conjunto con `codigos`.

| Familia | Códigos principales |
|---|---|
| Identidad/enlace | CUENTA_NO_CANONICA, IDENTIFICADOR_INVALIDO, CAMPO_OBLIGATORIO_VACIO, DETALLE_SIN_CABECERA, CLAVE_AGRUPACION_AMBIGUA |
| Importes | IMPORTE_VACIO, IMPORTE_NO_NUMERICO, IMPORTE_NEGATIVO, IMPORTE_FUERA_DE_RANGO, CONCILIACION_DIFERENTE |
| Fechas | FECHA_VACIA, FECHA_CENTINELA, FECHA_FORMATO_INVALIDO, FECHA_IMPOSIBLE |
| Catálogos/estado | TIPO_BIEN_FUERA_DE_CATALOGO, TIPO_INGRESO_FUERA_DE_CATALOGO, ESTADO_ORIGEN_NO_INFORMADO, ESTADO_ORIGEN_DESCONOCIDO, ESTADOS_ORIGEN_CONFLICTIVOS, ESTADO_OBJETO_DESCONOCIDO |
| Relaciones/contactos | CABECERAS_INCONSISTENTES, PORCENTAJE_INVALIDO, CONTACTO_PLACEHOLDER, CONTACTO_FORMATO_INVALIDO, CONTACTO_INACTIVO |
| Duplicados/estructura | DUPLICADO_IDENTICO, DUPLICADO_CONFLICTIVO, COLUMNA_OBLIGATORIA_AUSENTE, ESTRUCTURA_INVALIDA, ARCHIVO_NO_LEIBLE, LIMITE_ARCHIVO_EXCEDIDO |

`back/tests/test_validate_source.py` compara los 18 hallazgos, todos los objetos,
banderas, importes, contactos y agregados temporales contra el oráculo independiente
de ALIGN-023: 40 objetos, 31 aceptados, 9 en cuarentena, 2519236.14 aceptado y
202712.94 en cuarentena observado. La obligación con importe vacío se cuenta
aparte. También prueba cabecera inválida con detalles válidos, una sola obligación
inválida, umbral 5 %, claves compuestas, centinelas, estados, límites, privacidad,
mapeo, entorno vacío e importaciones prohibidas. No cambia el oráculo.

Para integrar: ALIGN-026 debe usar decisiones por fila/objeto y evitar cargar o
recalcular los objetos en cuarentena; ALIGN-030 adapta formatos sin cambiar las
reglas; ALIGN-052 llama esta función y respeta bloqueos/privacidad, con autorización
del tenant obtenida en servidor. Los gates y la revisión independiente se registran
en la evidencia de la ejecución; la homologación real permanece pendiente.
