# Cartera sintética con forma municipal y oráculo independiente (v1)

| Campo | Valor |
|---|---|
| Ticket | ALIGN-023, plan `2026-10-28-v2` (M3) |
| Generador | `quality/fixtures/synthetic_portfolio.py` (biblioteca estándar + `openpyxl==3.1.5` solo para XLSX) |
| Pruebas | `quality/tests/test_synthetic_portfolio.py` (INFRA) y `back/tests/test_synthetic_fixture.py` (BE) |
| Fixture versionada | `back/tests/fixtures/sintetico-v1/` (perfil `contrato`, semilla por defecto, `--sin-variantes`: TSV + JSON, ~120 KB) |
| Contrato aplicado | `docs/tesis/contrato-dominio-v1.md` (ALIGN-007): estados de presencia, corte, agregación por objeto |
| Datos personales | Ninguno. Clase **S**: ninguna fila ni distribución fina deriva de la cartera real |

## 1. Para qué sirve

Las fixtures del ETL (`back/tests/conftest.py`) son dos filas cómodas; no muestran ceros a la izquierda, importes ilegibles, porcentajes que no suman 100, duplicados ni estados de origen. Esta cartera reproduce **la forma** del archivo municipal (`cabecera.tsv` + `detalle.tsv` con las columnas que leen `back/ETL/extract.py`, `transform.py` e `inspect_tsv.py`, incluidas las opcionales) con identidades ficticias, para probar validador (ALIGN-024), mapeos CSV (ALIGN-030), XLSX y corpus hostil (ALIGN-053/059), carga y simulación sin exponer personas `[P0098]`.

## 2. Cómo generar

```bash
# Desde la raíz, con el venv del backend (trae openpyxl==3.1.5)
back/.venv/bin/python quality/fixtures/synthetic_portfolio.py --output <carpeta-nueva>            # perfil contrato
back/.venv/bin/python quality/fixtures/synthetic_portfolio.py --output <carpeta> --profile escala # 2933 objetos / 56 286 obligaciones
back/.venv/bin/python quality/fixtures/synthetic_portfolio.py --output <carpeta> --hostil          # + corpus hostil en hostil/
```

| Opción | Defecto | Efecto |
|---|---|---|
| `--seed` | `20261028` | Semilla. Misma semilla y versión → mismos bytes y mismos sha256 |
| `--profile` | `contrato` | `contrato` (40 objetos, 160 obligaciones) o `escala` (2933 / 56 286) |
| `--as-of` | `2026-09-30` | Fecha de corte (`as_of`) del lote; "vencida" se calcula contra ella, nunca contra el reloj |
| `--sin-variantes` | — | Omite CSV y XLSX (no requiere openpyxl) |
| `--hostil`, `--bomba-mib` | 16 MiB | Agrega el corpus hostil; el ZIP extremo se acota a 1–64 MiB descomprimidos |

La carpeta de salida debe estar vacía. Para regenerar la fixture versionada: borrar `back/tests/fixtures/sintetico-v1/` y ejecutar `back/.venv/bin/python quality/fixtures/synthetic_portfolio.py --output back/tests/fixtures/sintetico-v1 --sin-variantes`; `test_versioned_fixture_is_the_default_seed_output` exige que coincida byte a byte y que su `expected.json` sea idéntico al de la generación con variantes. Las variantes CSV/XLSX **no se versionan**: `.gitignore` excluye `*.csv` y `*.xlsx` como resguardo contra datos reales y ese resguardo no se debilita; ALIGN-030/053 las generan en una carpeta temporal. `.gitattributes` marca la carpeta `-text` para que Git no cambie los finales de línea.

### 2.1 Salida

| Ruta | Contenido |
|---|---|
| `cabecera.tsv`, `detalle.tsv` | Lote principal (`municipio-sintetico-a`): UTF-8 sin BOM, tabulador, LF, importes `1.234,56`, fechas `dd/mm/aaaa` |
| `manifest.json` | Versión, semilla, perfil, corte, formato, catálogos del lote, proporciones y su procedencia, conteos por municipio, variantes, sha256 y bytes de cada archivo, sha256 del oráculo. Sin marca de tiempo (determinismo) |
| `expected.json` | Oráculo (§4) por municipio |
| `contactos-vigencia.json` | Artefacto complementario: vigencia explícita de contactos que el TSV no puede expresar (§3.1.1) |
| `escenario-social.json` | Escenario social sintético separado (§3.4) |
| `seguridad/municipios.json`, `seguridad/municipio-sintetico-b/*.tsv` | Familia de seguridad (§3.2) |
| `variantes/csv-{coma,puntoycoma}-{utf8,cp1252}/`, `variantes/xlsx/cartera.xlsx` | La **misma** cartera en CSV y XLSX (§3.3) |
| `hostil/` (solo con `--hostil`) | Corpus hostil con su propio `manifest.json` (§3.5); nunca se versiona |

## 3. Familias

### 3.1 Contrato (oráculo manual)

Cada caso es un objeto con nombre propio en `expected.json` (`caso`), y la prueba INFRA fija a mano su resultado esperado:

| Caso | Qué ejercita | Resultado esperado |
|---|---|---|
| `base-valido` / `misma-cuenta-otro-tipo` | Cuenta `4100` con `Bien_Tipo_Id` 3 y 6 | Dos objetos distintos, ambos aceptados |
| `cuenta-canonica-123` / `cuenta-ceros-izquierda` / `cuenta-alfanumerica` | `123`, `000123`, `R-0456` (el ETL actual colapsaría `000123` con `123`) | No canónicas → `CUENTA_NO_CANONICA`, cuarentena |
| `importe-cero` | `0,00` en capital y total | Cero **observado** y conservado |
| `importe-vacio` / `importe-no-numerico` | Total vacío en una de dos obligaciones; capital `abc` en una de dos | `IMPORTE_VACIO` (`NO_INFORMADO_EN_ORIGEN`) / `IMPORTE_NO_NUMERICO` (`INVALIDO`), cuarentena. El importe del objeto es el **subtotal de las filas observadas** (`OBSERVADO`, `completo: false`) con el desglose de las no observadas al lado; nunca el faltante como 0 (§4) |
| `fecha-ambigua` / `fecha-imposible` | `03/04/2023`; `31/02/2024` (única obligación, pendiente) | Formato declarado `dd/mm/aaaa` → 2023-04-03; `FECHA_IMPOSIBLE`, cuarentena, vencimiento más antiguo y días de atraso nulos con presencia **`INVALIDO`** (no `NO_APLICA`) y la obligación contada en `PENDIENTE_VENCIMIENTO_NO_OBSERVADO` |
| `estados-origen-vencimiento-viejo` | `NOTD_ESTA_id` pagada/anulada/suspendida/pendiente/vacío con vencimiento 2020 | Solo la pendiente es `VENCIDA`; vacío → `UNKNOWN` (nunca "vencida" inventada). Días de atraso: máximo de las observadas con la fila sin estado contada aparte (`NO_INFORMADO_EN_ORIGEN`, `completo: false`) |
| `vencimiento-posterior-al-corte` | Pendiente con vencimiento > corte | `VIGENTE`; días de atraso `NO_APLICA` (universo leído completo y sin vencidas) |
| `contacto-placeholder` / `contacto-formato-invalido` / `sin-contacto` | `0`, `-`, `NO POSEE`; email sin `@`; sin valores | Marcador o formato `INVALIDO` / ausencia; no utilizable; bandera `SIN_CONTACTO_UTILIZABLE` (no suma severidad). No son contactos inactivos |
| `contacto-inactivo` / `contacto-activo-mismo-valor` | El **mismo** teléfono bien formado: `INACTIVO` (con un email bien formado también `INACTIVO`) para una persona y `ACTIVO` para otra, declarado en `contactos-vigencia.json` | `CONTACTO_INACTIVO` (`OBSERVADO`), 0 utilizables y `SIN_CONTACTO_UTILIZABLE` / 1 utilizable. Solo la vigencia declarada separa ambos resultados (§3.1.1) |
| `dos-personas-un-objeto` / `persona-varios-objetos-1..3` | 2 personas 50/50; 1 persona en 3 objetos | Relaciones correctas; exposición no aditiva |
| `porcentajes-120` / `porcentaje-80` / `porcentaje-faltante` | Suma ≠ 100 y vacío | `PORCENTAJES_NO_SUMAN_100` / `PORCENTAJE_FALTANTE`; nunca se normaliza |
| `duplicado-identico` / `duplicado-conflictivo` | Misma `(Bien_Tipo_Id, Cuenta, DEUD_id)` repetida igual o con otro importe | Se cuenta una vez / `DUPLICADO_CONFLICTIVO`, cuarentena |
| `tipo-ingreso-sin-mapeo-etl` / `tipo-ingreso-fuera-de-catalogo` / `tipo-bien-fuera-de-catalogo` | `905` está en el catálogo del lote pero no en las constantes del ETL; `999` y `Bien_Tipo_Id 9` en ninguno | Aceptado con bandera / cuarentena con código |
| `conciliacion-diferente` | `Deuda_Actualizada` ≠ Σ `NOTD_totalActualizado` | `CONCILIACION_DIFERENTE`, cuarentena |
| `cabecera-sin-detalle` / `detalle-sin-cabecera` | Objeto sin obligaciones; `ClaveAgrupacion` huérfana | Total 0 derivado; fila `DETALLE_SIN_CABECERA` |
| `objeto-inactivo-en-origen`, `persona-juridica` | `Estado = Inactivo`; "Entidad Sintética" | Banderas informativas |

#### 3.1.1 Vigencia de contactos (artefacto complementario)

El archivo municipal actual no trae vigencia de contacto y el ETL crea todos los contactos activos (contrato CO03); por eso `cabecera.tsv` no puede expresar un contacto dado de baja. La fixture de contrato agrega `contactos-vigencia.json` como **precondición del oráculo**, no como columna del origen real: clave (`municipio`, `Destinatario_Id`, `columna`), valores `ACTIVO` (utilizable si el formato es válido) e `INACTIVO` (dado de baja: no utilizable aunque esté bien formado; hallazgo `CONTACTO_INACTIVO` con presencia `OBSERVADO`); un contacto con valor no listado es `ACTIVO`. La vigencia es distinta de la validez de formato o los marcadores (`INVALIDO`) y de la ausencia (columna vacía). Un consumidor que solo lea el TSV no distingue `contacto-inactivo` de `contacto-activo-mismo-valor`; la prueba `test_contact_validity_distinguishes_the_same_value_active_and_inactive` lo fija.

Los catálogos del lote (`Bien_Tipo_Id` 1/3/6, `Tipo_Ingreso_Id` 1/100/801/905, `NOTD_ESTA_id` 10/20/30/40) son **sintéticos** y se declaran en el manifiesto: no son los IDs del municipio real (pendientes de ALIGN-004) ni los de las constantes del ETL.

### 3.2 Seguridad

Dos municipios (`municipio-sintetico-a`, `municipio-sintetico-b`) y los roles `consulta`, `operador`, `importador` y `supervisor` por municipio, con cuentas `rol.municipio@example.invalid` **sin credenciales** (cada campaña crea contraseñas efímeras en la base local). El lote B repite la cuenta `3-4100` del lote A y una persona compartida (mismo `Destinatario_Id`) para ejercitar DEF-SEC-003 (identidad y contactos sin municipio).

### 3.3 Variantes de formato

La misma tabla se escribe en TSV, CSV con `,` y `;` en UTF-8 con BOM y en Windows-1252 (CRLF), y XLSX con hojas `cabecera` y `detalle`. Todas declaran `oraculo: expected.json`; la prueba decodifica cada variante (el XLSX con un lector de biblioteca estándar, sin openpyxl) y exige celdas idénticas a la TSV. En XLSX todas las celdas son **texto** (conservan `000123` y `1.234,56`); un XLSX con celdas numéricas o fechas seriales es otra cartera y queda para ALIGN-053. El XLSX se guarda sin compresión (el sha256 no depende de la versión de zlib); si superara 25 MB (límite por defecto de importación) se comprime y el manifiesto lo declara (`compresion: deflate`), con hash reproducible en la misma plataforma.

### 3.4 Escenario social (archivo separado)

`escenario-social.json` asigna a cada objeto `vulnerable_sintetico` (Bernoulli p = 0,20, supuesto) y `grupo_sintetico` (G1–G3 uniforme), con un generador aleatorio propio e **independiente** de importes, contactos y domicilio. Solo lo leen la simulación (ALIGN-036) y las evaluaciones de equidad (ALIGN-062/063). **Nunca** es variable de entrada de una regla, puntaje o modelo, no aparece en `cabecera`/`detalle` y la prueba lo verifica. ALIGN-061 puede reemplazarlo por el mundo sintético versionado.

### 3.5 Corpus hostil (generado por código)

| Archivo | Ataque | Código sugerido |
|---|---|---|
| `bomba-zip.xlsx` | Parte de 16 MiB de ceros comprimida (razón > 100) | `RAZON_COMPRESION_EXCEDIDA` |
| `xml-entidad-externa.xlsx` | `<!DOCTYPE>` con entidad `SYSTEM` hacia una ruta inexistente | `XML_ENTIDAD_EXTERNA` |
| `macro.xlsm` | Tipo `macroEnabled` + `xl/vbaProject.bin` ficticio (no ejecutable) | `MACRO_NO_PERMITIDA` |
| `xls-renombrado.xlsx` | Firma OLE2 de Excel 97-2003 con extensión `.xlsx` | `FORMATO_XLS_NO_SOPORTADO` |
| `binario.csv` | Bytes no decodificables con NUL | `CONTENIDO_NO_TEXTO` |
| `celda-gigante.xlsx` / `.csv` | Celda de 40 000 caracteres (> 32 767) | `CELDA_EXCEDE_LIMITE` |
| `formulas.xlsx` / `.csv` | Fórmulas sin valor guardado; `=`, `+`, `-`, `@` al inicio | `FORMULA_SIN_VALOR` / `FORMULA_EN_CELDA` |
| `hojas-extra.xlsx` | Hojas `notas` y `oculta` además de las esperadas | `HOJAS_EXTRA_IGNORADAS` |

ALIGN-053 adoptó estos códigos sin cambios ([`importacion-web.md`](importacion-web.md)); `HOJAS_EXTRA_IGNORADAS` no es un rechazo: las hojas se listan e ignoran y la lectura sigue. Ningún archivo supera 1 MB en disco y no se versiona ninguno.

**Centinelas.** Cada archivo lleva al menos un centinela con el prefijo `CENTINELA-EQUITAS-SINTETICO`, distinto por archivo y ubicación (`CENTINELA-EQUITAS-SINTETICO-<ARCHIVO>-<LUGAR>`), sin alterar su condición hostil. `hostil/manifest.json` declara por archivo `centinelas[]` con `valor`, `partes` (partes del ZIP que lo contienen; vacío = bytes del archivo) y `en_preview_autorizado`:

- `…-DATO` (`true`): campo de datos no personal de las hojas que lee el importador (`Bien_Descripcion` en `cabecera`, `Detalle_Deuda` en `detalle`; en CSV, `Bien_Descripcion`). Si el archivo se acepta, debe verse en el preview autorizado; si se rechaza, no hay preview. Está en todos los archivos legibles.
- `false`: ubicaciones que nunca deben mostrarse: hojas ignoradas (`…-HOJA-NOTAS`, `…-HOJA-OCULTA`), destino de la entidad externa, `vbaProject.bin`, bytes del OLE2 y del binario, celda gigante y fórmula.

Ningún centinela debe aparecer en logs ni en respuestas no autorizadas. `test_every_hostile_file_carries_its_declared_sentinels` exige su presencia en la entrada (partes descomprimidas incluidas) para que la comprobación de ausencia de ALIGN-059 no sea vacía, y que en `hojas-extra.xlsx` el centinela de datos esté solo en `cabecera`/`detalle` y los de las hojas ignoradas solo en `notas`/`oculta`.

### 3.6 Escala

`--profile escala` produce exactamente 2933 objetos y 56 286 obligaciones únicas en el municipio A (las cardinalidades agregadas del informe de input §3), más de 3000 filas de detalle (56 289 con la semilla por defecto; la cabecera tiene 2990 relaciones), e incluye los casos de contrato. Las proporciones solo fijan la forma, no la calibran.

## 4. Oráculo (`expected.json`)

- **Calculado por el modelo del generador**: los valores salen de los objetos en memoria con un lector estricto del formato declarado; el generador no importa `back/ETL` ni pandas y se ejecuta con `python -I` (la prueba revisa sus importaciones con `ast`). Una segunda prueba recalcula, leyendo los archivos con la biblioteca estándar, los importes y los agregados temporales de **todos** los objetos, también los que están en cuarentena.
- Por municipio: `conteos` (filas, objetos aceptados/en cuarentena, personas, relaciones, obligaciones únicas, duplicados, detalle sin cabecera, objetos sin contacto utilizable y con porcentajes ≠ 100), `importes` (aceptado y en cuarentena observado, más el desglose de filas de total no observadas), `objetos` (caso, clave, resultado `ACEPTADO`/`CUARENTENA`, motivos, banderas, personas, obligaciones, importes, estados al corte, vencimiento más antiguo, días de la vencida más antigua, suma de porcentajes, contactos utilizables e inactivos) y `hallazgos` (archivo, línea, campo, código y estado de presencia; **sin valores**).
- **Agregados por objeto** (importes, vencimiento más antiguo, días de la vencida más antigua) con la forma `{valor, presencia, filas_no_observadas, completo}` (§4.1 del contrato): `valor` sale solo de las filas observadas y `filas_no_observadas` cuenta aparte las demás por estado. Con `completo: false` el valor es un **subtotal** (o el máximo/mínimo) de las observadas, no el total del objeto; la cuarentena del objeto se mantiene. `valor` es nulo solo si ninguna fila aporta: `NO_APLICA` si el universo se leyó completo (sin obligaciones, o sin vencidas) y, si hay filas no observadas, el primer estado del orden de §4 (`INVALIDO` para un vencimiento imposible). Para los días de atraso, una obligación sin estado de origen o pendiente con vencimiento no interpretable es una fila no observada. `estados_al_corte` cuenta cada obligación única una sola vez (`PENDIENTE_VENCIMIENTO_NO_OBSERVADO` para la pendiente sin vencimiento interpretable).
- Convenciones: `linea` es la línea física (la fila de nombres de columna es la 1); un faltante nunca se suma como 0 (§4.1 del contrato); la unidad de cuarentena es el objeto (plan v2 §7.8).
- Es la **lectura más acotada** del contrato v1 para un validador que aún no existe: si ALIGN-024 define otros códigos o reglas, se actualiza el modelo y se sube la versión (`sintetico-v2`), nunca se edita `expected.json` a mano.

## 5. Privacidad

| Dato | Forma |
|---|---|
| Nombre | `Persona Sintética 0001`, `Entidad Sintética 0042` |
| Documento | `99-0000NNNN-D`: el prefijo 99 no se asigna a CUIT/CUIL (el ETL lo clasifica `UNKNOWN`) |
| Email | `persona.sintetica.NNNN@example.invalid` (dominio reservado, RFC 2606) |
| Teléfono / celular | `0000-555-NNNN` / `0000-15-555-NNNN` |
| Domicilio | `Calle Sintética N`, `Localidad Sintética N`, `Provincia Sintética`, CP `0000` |
| Identificador del objeto | `SINT-<tipo>-<cuenta>` (no son patentes ni partidas reales) |

La prueba `test_content_is_obviously_fictitious` valida cada campo personal con esas expresiones en ambos municipios y verifica que ningún archivo contenga referencias de proyectos Supabase, el tenant real ni dominios de correo comunes (`@gmail`, `@hotmail`).

## 6. Qué NO representa

- **No es la cartera real ni una muestra de ella.** Solo usa agregados ya documentados (informe de input §3: 2933 objetos, 56 286 obligaciones, rango de vencimientos 2020-01-15 a 2025-11-30) y proporciones redondeadas (a 5 puntos, o a 1 punto si son menores de 5 %: tipo de objeto 60/35/5 con inmueble elevado a 5 % para que aparezca, objetos con dos personas 2 %, porcentajes ≠ 100 1 %, personas sin contacto 55 %) o **supuestas** (importes, intereses, reutilización de personas, canales de contacto, escenario social). Calibrar con la cartera real exige la autorización de ALIGN-004.
- Los importes, vencimientos, estados de origen y catálogos no reflejan la distribución real; no sirven para estimar recaudación, mora ni severidad reales.
- No permite evaluar lo que el plan v2 §7.7 excluye: probabilidad de pago o recuperabilidad reales, respuesta a canales, costo, efecto incremental de una acción `[P0263]`, vulnerabilidad, estado jurídico, validez de contactos, utilidad para usuarios reales ni impacto en recaudación o equidad real `[P0250]`.
- El escenario social es un supuesto declarado, no una medición; no informa sobre hogares ni ingresos (hogar no modelado, contrato §2).
- No contiene historial de acciones ni pagos (ALIGN-061).

## 7. Control de versiones

| Versión | Fecha | Cambio |
|---|---|---|
| `sintetico-v1` | 2026-10-29 | Generador, oráculo, variantes, familia de seguridad, escenario social y corpus hostil (ALIGN-023) |
| `sintetico-v1` (corrección 1) | 2026-10-29 | Antes de integrarse, por la revisión independiente: subtotales observados con desglose, presencia de vencimientos no interpretables en los agregados temporales, vigencia explícita de contactos (`contactos-vigencia.json`) y centinelas declarados en cada archivo hostil. Sin consumidores todavía: se mantiene la versión |
