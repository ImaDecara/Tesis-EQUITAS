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

No se importan `ETL.config`, `ETL.transform`, pandas, dotenv ni clientes de base;
no se leen variables de entorno ni `.env`. Solo se usa la biblioteca estándar.
El validador no publica, modifica ni consulta datos persistidos. Los límites son
25 000 000 bytes, 300 000 registros, 60 columnas y 32 767 caracteres por celda.
La lectura de rutas de esta versión admite TSV; los lectores CSV/XLSX pertenecen
a ALIGN-030/053. No sustituye los controles de archivos hostiles de esos tickets.

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
    "separador": "\\t", "codificacion": "utf-8",
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
  y los detalles ambiguos bloquean el lote.
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
ausente es opcional; informada e inválida/centinela también invalida la cabecera.
Representa `source_updated_at`, no emisión ni gestión.

El catálogo municipal declara códigos semánticos `PENDIENTE`, `PAGADA`, `ANULADA`,
`SUSPENDIDA` o `UNKNOWN`. Se resuelve cada columna informada; si ESTA falta puede
usarse SITU, únicamente con catálogo explícito. Dos estados informados deben
coincidir; de lo contrario, `ESTADOS_ORIGEN_CONFLICTIVOS` y cuarentena.

| Situación | Presencia | Efecto |
|---|---|---|
| Estado vacío, columna ausente o código catalogado explícitamente como UNKNOWN | `NO_INFORMADO_EN_ORIGEN` | `ESTADO_ORIGEN_NO_INFORMADO`, categoría UNKNOWN, alerta |
| Código presente fuera de catálogo | `INVALIDO` | `ESTADO_ORIGEN_DESCONOCIDO`, cuarentena igual que una fecha inválida |
| Pendiente y vencimiento anterior al corte | `OBSERVADO` | VENCIDA; atraso respecto del corte |
| Pendiente y vencimiento igual/posterior al corte | `OBSERVADO` | VIGENTE |
| Pagada, anulada o suspendida, aunque su vencimiento sea antiguo | `OBSERVADO` | Conserva su categoría, no se transforma en vencida |

El estado del objeto (`Estado`: Activo/Inactivo) es independiente del estado de
la obligación. Vacío queda no informado, nunca activo por defecto; otro valor
presente queda inválido. Los IDs de catálogos sintéticos no son IDs del municipio
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

Un error de estructura bloquea todo el lote. También lo bloquean detalles sin
cabecera/ambiguos, más del 5 % de objetos en cuarentena, más del 5 % del importe
observado en cuarentena o importes incompletos que impiden certificar ese límite.
Los dos límites porcentuales viven en `consistencias` (configuración de servidor,
no una opción del importador). Exactamente 5 % no los supera. El porcentaje de
importe observado se declara diagnóstico cuando el importe está incompleto.

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
`universo_completo=false`: los conteos solo describen lo alcanzado a leer.

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
TSV v1 rechaza celdas multilínea. La fila de títulos es 1. Los adaptadores futuros
deben documentar cómo corresponde `line` a registro/fila de hoja.

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
