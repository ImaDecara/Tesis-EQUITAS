# Contrato de dominio, diccionario de variables y representación de faltantes (v1)

| Campo | Valor |
|---|---|
| Ticket | ALIGN-007, plan `2026-10-28-v2` (M1) |
| Versión | v1, **provisional** hasta que el custodio homologue el significado de origen (ALIGN-004) |
| Código descrito | `36f35b4fc3cd3078246054026e6c8cc3f2e1c7fd` (las citas `archivo:línea` refieren a ese commit) |
| Tipo asociado | `DataPresence` y `DATA_PRESENCE_STATES` en `front/types/equitas-domain.ts` |
| Fuentes | Código del repositorio; informe agregado de input del 25/10/2026 (§3 y §5); plan v2 §7; síntesis de tesis (`[P####]`) |
| Datos personales | Ninguno. Las cifras citadas son agregados del informe de input |

## 1. Propósito y alcance

Este documento fija **qué significa cada dato** que EQUITAS muestra o usa en reglas, antes de priorizar con él. Es la referencia que citan las reglas de decisión (ALIGN-008), los mapeadores (ALIGN-011), las etiquetas de pantalla (ALIGN-012) y el contrato de origen y su validador (ALIGN-024).

- La tesis define el puntaje del MVP como un indicador de riesgo/prioridad por reglas, **no** como una probabilidad calibrada `[P0105]`, `[P0108]`. Ningún nombre de este contrato puede sugerir otra cosa.
- La vulnerabilidad modera la intensidad de la cobranza y nunca la agrava `[P0093]`, `[P0156]`; la cartera cargada no contiene datos sociales, por lo que la vulnerabilidad queda **no informada**.
- La trazabilidad exige reconstruir con qué datos y criterios se generó cada recomendación `[P0113]`; para eso cada dato necesita fuente, fórmula, unidad, corte y estado de presencia.
- La calidad de un padrón es su aptitud para el uso `[P0233]`: un dato apto para emitir boletas puede no serlo para priorizar.

**Qué no hace este contrato:** no renombra columnas de la base, no modifica el proyecto original ni cambia el comportamiento del código. Describe el comportamiento actual, el significado correcto y la brecha; las correcciones pertenecen a los tickets indicados en §10.

## 2. Unidades de dominio

La **clave interna** (`id`) la asigna la base, no viene del archivo municipal y es la única que usan las FK, los DTO del frontend y los enlaces de pantalla. La **clave externa** (`external_id` y sus compuestas) proviene del archivo municipal y la usa el ETL para deduplicar; el frontend no la lee como identidad. No son intercambiables (§7.2–§7.4: OB01/OB02, DE00/DE01, PE00/PE01).

| Unidad | Tabla | Clave interna / clave externa | Qué es | Qué **no** es |
|---|---|---|---|---|
| Municipio (tenant) | `tenant` | `id` / ninguna | Jurisdicción que exporta la cartera | No viene en el archivo: hoy es `tenant=1` fijo (`back/ETL/config.py:21-22`) |
| Objeto tributario | `debtor` | `id` / `(tenant, type, external_id)` = (municipio, `Bien_Tipo_Id`, `Cuenta`) (`supabase/migrations/20261021220156_equitas_testing_schema.sql:256`) | Cuenta tributaria (RODADO, AGUA, INMUEBLE) sobre la que recaen obligaciones. **Unidad central** de totales, perfiles y colas | No es una persona ni un hogar, aunque la tabla se llame `debtor` |
| Obligación | `debt` | `id` / `(debtor, external_id)` = (objeto, `DEUD_id`) (`supabase/migrations/20261021220156_equitas_testing_schema.sql:246`) | Registro individual de deuda (`DEUD_id`) con importe, vencimiento y estado | No es un período fiscal: `debt.period` hoy copia el ID externo (§8) |
| Persona | `person` | `id` / `external_id` = `Destinatario_Id`, único global (`supabase/migrations/20261021220156_equitas_testing_schema.sql:286`) | Destinatario/responsable informado en origen | No es un hogar; su identidad externa no está acotada por municipio (`supabase/migrations/20261021221030_active_membership_rls.sql:38,42`) |
| Relación persona–objeto | `debtor_person` | `(debtor, person)`: FK a `debtor.id` y `person.id` (`supabase/migrations/20261021220156_equitas_testing_schema.sql:342-344`) / ninguna propia | Vínculo con rol declarado (`role`) y **porcentaje declarado** (`priority`) | No es una prioridad de gestión ni prueba por sí sola una cuota legal de responsabilidad |
| Contacto | `debtor_contact` | `id` (por persona) | Valor de teléfono, celular o email informado en origen | Tener un valor no prueba que sea válido, vigente ni que haya permiso para usarlo |
| Perfil del objeto | `debtor_profile` | `debtor` | Agregado **derivado** por el ETL al momento del cálculo | No es un dato de origen ni está actualizado por sí mismo (§5) |
| Detalle del perfil por persona | `debtor_profile_detail` | `(debtor_profile, person)` | Índice heredado por persona dentro de un objeto | No es riesgo social ni probabilidad individual |

**Hogar: no modelado ni inferido.** Ninguna tabla, regla ni pantalla agrupa personas en hogares, ni infiere composición, ingresos o situación del hogar a partir de domicilio, apellido, documento o vínculos. Toda mención a hogar es `NO_INFORMADO_EN_ORIGEN`.

Cardinalidades observadas en el corte del informe de input (§3): 2933 objetos, 56 286 obligaciones, 2493 personas, 3007 relaciones; 65 objetos con varias personas activas, 360 personas con varios objetos activos y 27 objetos cuya suma de porcentajes activos no es 100.

## 3. Agregación: totales por objeto y exposición no aditiva

1. **Los totales de deuda se calculan siempre por objeto**: Σ `debt.current_amount` de las obligaciones del objeto. Un total de cartera, de cola o de filtro es la suma sobre **objetos distintos**.
2. **Deuda por persona = exposición asociada no aditiva**: la suma de los totales de los objetos con los que la persona tiene una relación activa. Si dos personas comparten un objeto, ambas muestran el total completo de ese objeto. La exposición **no se reparte** por `priority` (porcentaje declarado) ni por cantidad de personas, y **no se suma** entre personas.
3. Un total sobre un conjunto de personas (por ejemplo, "Deuda asociada" de las personas filtradas) se obtiene **deduplicando por objeto**: unión de los objetos vinculados y suma de sus totales una sola vez.
4. Un porcentaje declarado cuya suma por objeto no es 100 es una **alerta semántica** (bandera `PORCENTAJES_NO_SUMAN_100`, ALIGN-008). Nunca se normaliza automáticamente.

## 4. Estados de presencia (`DataPresence`)

Todo dato visible o usado en una regla tiene, además de su valor, uno de estos cinco estados:

| Estado | Definición | Representación | Ejemplo en EQUITAS |
|---|---|---|---|
| `OBSERVADO` | El valor llegó del origen (o se derivó de valores observados con una regla de este contrato) y es válido. Incluye el **cero real** | valor tipado; `0` solo como cero observado en origen o cero derivado legítimo (§4.1) | `NOTD_totalActualizado` informado como `0,00` → importe 0 observado; ningún objeto leído supera riesgo 90 → conteo 0 derivado |
| `NO_INFORMADO_EN_ORIGEN` | El archivo municipal no trae la columna, o la trae vacía para esa fila | valor `null` + estado | Vulnerabilidad, hogar, ingresos, fecha de nacimiento (nula en las 2493 personas), estado de origen de la obligación cuando, una vez integrado, el archivo no trae `NOTD_ESTA_id`/`NOTD_SITU_id` |
| `NO_INTEGRADO` | El dato existe o podría existir en origen, pero EQUITAS no lo carga, no lo lee o no tiene dónde guardarlo | valor `null` + estado | `previous_contact_count`/`previous_response_count` (siempre en el valor por defecto de la base), pagos, gestiones, `as_of` del lote, totales de control `Deuda_Actualizada`/`Periodos_Deuda` |
| `INVALIDO` | El valor llegó pero no se puede interpretar (importe ilegible, fecha imposible, código fuera de catálogo) | valor `null` + estado + código de motivo; el valor crudo no se muestra si es personal | `NOTD_capital = "abc"`, `NOTD_vencimiento = "31/02/2024"` |
| `NO_APLICA` | El dato no tiene sentido para esa unidad por definición | valor `null` + estado | Días de atraso de una obligación no vencida; porcentaje declarado de un objeto sin relaciones; fecha de nacimiento de una persona jurídica |

Reglas obligatorias (plan v2 §7.4):

- **Ninguna ausencia se representa ni se interpreta como 0**, como cadena vacía, como "Sin estado"/"Media"/"No especificada" ni como categoría de riesgo. El 0 solo es válido como valor `OBSERVADO`: cero observado en origen o cero derivado legítimo (§4.1).
- Un faltante **nunca suma severidad**, nunca se convierte en "bajo riesgo" y nunca da lugar a una inferencia social.
- Un faltante se **muestra** como tal ("no informado", "no integrado", "inválido", "no aplica") y se **cuenta** aparte en los agregados (por ejemplo, "n objetos con importe inválido"), en lugar de sumarse como 0.

Orden de decisión cuando una fila admite más de un estado: `NO_APLICA` (por definición) → `NO_INTEGRADO` (EQUITAS no lo lee) → `NO_INFORMADO_EN_ORIGEN` (columna ausente o vacía) → `INVALIDO` (valor presente no interpretable) → `OBSERVADO`.

### 4.1 Reglas de agregación

Un agregado (conteo, suma, promedio, porcentaje, máximo) declara su **universo** (qué filas considera) y su **insumo** (qué variable lee de cada fila). Las entradas de §7 aplican estas reglas; ninguna entrada puede convertir un faltante en 0.

1. **Cero observado en origen**: el archivo municipal informó 0 para esa fila (p. ej., un importe `0,00`). Se conserva como 0 `OBSERVADO`.
2. **Cero derivado legítimo**: el universo se leyó completo, las filas pertinentes tienen su insumo `OBSERVADO` y ninguna cumple la condición (o todas suman 0 observado). El resultado es 0 `OBSERVADO` derivado. Ejemplo: "objetos con riesgo > 90" = 0 cuando todos los objetos leídos tienen riesgo observado ≤ 90.
3. **Filas no observadas aparte**: las filas del universo cuyo insumo no está `OBSERVADO` no se suman como 0 ni se cuentan dentro de una categoría observada. El agregado se calcula sobre las filas observadas y muestra al lado el conteo por estado (p. ej., "12 objetos con importe `INVALIDO`").
4. **Ninguna fila observada**: el agregado es `null`. Si todas las filas comparten un estado, el agregado toma ese estado (`NO_INFORMADO_EN_ORIGEN`, `NO_INTEGRADO` o `INVALIDO`); si difieren, toma el primero según el orden de decisión de §4 y muestra el desglose por estado.
5. **`NO_APLICA` por definición**: un promedio, porcentaje o máximo cuyo denominador o conjunto es vacío en un universo leído correctamente (p. ej., promedio de atraso sin objetos con mora, porcentaje sobre 0 objetos) es `NO_APLICA`, no 0. Un conteo o una suma sobre un subconjunto vacío sí es 0 derivado (regla 2).
6. **Lectura fallida**: si la lectura de una tabla falla (`DataWarning`), el universo no se conoce: los agregados que dependen de ella son "no disponible" (`NO_INTEGRADO` en esa consulta), nunca 0 derivado ni `NO_APLICA`.

En código, el estado se expresa con el tipo `DataPresence` (`front/types/equitas-domain.ts`); la lista `DATA_PRESENCE_STATES` es la fuente única de los cinco valores y una prueba (`front/tests/unit/domain-contract.test.ts`) verifica que coincida con esta tabla.

## 5. Semántica temporal

| Nombre | Significado | Quién lo fija | Estado hoy (@36f35b4) |
|---|---|---|---|
| `as_of` (corte) | Fecha a la que el municipio certifica el estado exportado. Antigüedad, "vencida", severidad y colas se calculan **respecto de `as_of`** | Manifiesto del lote (cada importación web lo declara) | `NO_INTEGRADO`: no se carga (`import_batch.as_of` existe desde ALIGN-018, solo en la base local, sin datos). El ETL usa `date.today()` (`back/ETL/transform.py:266-279`, `512-523`) y el frontend `new Date()`/`Date.now()` (`front/lib/parsers/date-value-parser.ts:12-31`) |
| `computed_at` (cálculo) | Momento en que EQUITAS calculó un perfil, un índice o una cola | Sistema | Perfiles: `debtor_profile.profile_generated_at` (`back/ETL/transform.py:648`), persistido y leído por el mapeador de objetos desde ALIGN-011. Estado inferido de la obligación (`debt.status`): calculado al cargar, **sin registro** de su momento (desconocido). Indicadores del frontend: se recalculan en cada consulta y no guardan su momento |
| `source_updated_at` (actualización de origen) | Fecha de actualización del registro en el ERP municipal (`Fecha_Actualizacion`) | Archivo de origen | `NO_INTEGRADO` como tal: se guarda en `debt.issue_date` **y** `debt.last_collection_date` (`back/ETL/transform.py:763-777`). Destino: `import_batch.source_updated_at` (tabla de ALIGN-018, solo base local; la alimenta ALIGN-026) |

Consecuencias:

- Un perfil calculado con `computed_at` anterior a la consulta **no es actual**: sus días de antigüedad difieren de un recálculo (informe de input §5, "Perfil temporal"; perfiles generados entre el 30/09 y el 02/10/2026, §3). Consultarlo no lo recalcula.
- `issue_date` no es fecha de emisión y `last_collection_date` no es fecha de gestión o cobro: en todas las obligaciones observadas `issue_date > due_date` y `last_collection_date = issue_date`. Ninguna regla puede afirmar que hubo emisión, contacto o cobro a partir de ellas.
- Mientras `as_of` no exista, el corte de **todo** indicador es `NO_INTEGRADO`. La fecha de lectura, la de carga o la de cálculo **no sustituyen** al corte municipal ni a la antigüedad de los insumos (`source_updated_at`).

### 5.1 Procedencia temporal y rótulo obligatorio

Cada indicador temporal tiene una de tres procedencias. El rótulo depende de la procedencia, no de la pantalla donde se muestra:

| Procedencia | Qué significa | Rótulo obligatorio (mientras `as_of` sea `NO_INTEGRADO`) | Indicadores (@36f35b4) |
|---|---|---|---|
| **Recalculado en la consulta** | Se calcula con el reloj del servidor (`new Date()`/`Date.now()`) cada vez que se arma la pantalla | "Calculado al día de la consulta; corte no integrado" | FO06; DE10 cuando el frontend lo infiere por vencimiento (`resolveDebtStatusFromDueDate`, `front/lib/mappers/debtor-object-mapper.ts:199-205`) |
| **Persistido** | Se calculó antes (ETL) y se lee tal cual; la consulta no lo recalcula | "Calculado el `<computed_at>`; corte no integrado". Para `debtor_profile`/`debtor_profile_detail`, `computed_at` = `profile_generated_at`; si no se lee o falta: "momento de cálculo desconocido". Para `debt.status` inferido por el ETL: "momento de cálculo desconocido" (no se registra) | PR01–PR10; DE10 cuando proviene del catálogo (`debt.status` inferido al cargar, `back/ETL/transform.py:266-279`); FP01, AG13 y VP11 (leen PR09) |
| **Mixto** | Combina valores persistidos con cálculos de la consulta, o elige entre ambos según haya perfil | Declara las dos partes: "Calculado el `<computed_at>` o momento desconocido (componente persistido) y al día de la consulta (componente recalculado); corte no integrado". No se reduce a ninguno de los dos | FO01/FO02 (PR01/PR02 o recálculo según haya perfil, `front/lib/mappers/debtor-object-mapper.ts:445-459`); FO10 (PR08 o fallback por señales); FO04, FO05 (conjunto de vencidas según DE10 persistido o inferido; días con el reloj de la consulta); FO12–FO14; AG02, AG03, AG05–AG07c, AG10 (parte de objetos), AG11, AG12, AG15–AG17; VP01–VP04, VP07–VP10 |

Reglas:

- El rótulo "calculado al día de la consulta" se usa **solo** para la procedencia "recalculado en la consulta". Un valor persistido nunca se rotula así, aunque se lea en esa consulta.
- Un valor persistido muestra su `computed_at` real; ALIGN-011 lee `profile_generated_at` para los objetos; si la fecha falta o es ilegible, declara momento de cálculo desconocido. La consulta de personas no lee esa fecha y conserva momento desconocido. Nunca se muestra la fecha de lectura en su lugar.
- Un indicador mixto declara qué parte es persistida y cuál recalculada. Si la elección depende de cada objeto (con perfil o sin él), la procedencia se declara por objeto o el agregado se rotula mixto.
- Los indicadores sin dependencia temporal (Corte "—" en §7) no llevan rótulo temporal.

En §7, la columna **Corte** indica de qué fecha depende el valor: `as_of` (depende del corte; hoy sustituido por un reloj según §5.1), `computed_at` (valor persistido, válido a la fecha de su cálculo), `source_updated_at` (vale a la fecha de actualización de origen) o "—" (no depende de una fecha).

## 6. Clasificación de origen (O/D/A/S/P)

| Clase | Significado |
|---|---|
| **O** | Observado: viene del archivo municipal y se cargó en la base |
| **D** | Derivado: se calcula con una regla a partir de datos O (la regla queda documentada aquí) |
| **A** | Ausente: no existe en la cartera disponible |
| **S** | Sintético: solo existe en fixtures o simulaciones, nunca en datos reales |
| **P** | Pendiente de verificar: el dato existe pero su significado de origen no fue homologado (ALIGN-004) |

Las combinaciones como "O (semántica P)" indican un valor observado cuyo significado aún no está confirmado. La clasificación coincide con el contrato de origen del plan v2 §7.1.

## 7. Diccionario de variables

Columnas: **Variable** (DTO del frontend o `tabla.columna`), **Rótulo** actual en pantalla ("—" si no se muestra), **Fuente → fórmula**, **Unidad**, **Corte** (fecha de la que depende el valor, §5; su rótulo sigue la procedencia de §5.1), **Faltantes** (estado aplicable; "Hoy:" describe el comportamiento @36f35b4 cuando contradice §4), **Clase**.

El diccionario cubre los campos de los DTO, las columnas usadas en reglas y también los **cálculos hechos dentro de páginas y componentes** (§7.9, prefijo VP), que no pasan por un DTO.

### 7.1 Lote, municipio y tiempo

| ID | Variable | Rótulo | Fuente → fórmula | Unidad | Corte | Faltantes | Clase |
|---|---|---|---|---|---|---|---|
| L01 | `tenant.id`, `tenant.name` | — | `back/ETL/config.py:21-22` (fijo) | id / texto | — | El municipio real no está declarado en el lote: `NO_INTEGRADO` | D |
| L02 | `currency.id` | — (formato ARS) | `DEFAULT_CURRENCY_ID = 1` (`back/ETL/transform.py:36`) | id de catálogo | — | Moneda no informada por el lote: supuesto ARS | D |
| L03 | `as_of` | — | §5 | fecha | — | `NO_INTEGRADO` | A |
| L04 | `debtor_profile.profile_generated_at` (`computed_at`) | — | `datetime.now(UTC)` al construir el perfil (`back/ETL/transform.py:648`) | fecha-hora UTC | — | Nula si el perfil no se generó: `NO_INTEGRADO`. ALIGN-011 lee la fecha en `DebtorListItem.computedAt` y expone `DebtorListItem.temporalProvenance`; si falta, declara momento de cálculo desconocido (§5.1) | D |
| L05 | `Fecha_Actualizacion` (`source_updated_at`) | — | Cabecera, vía `ClaveAgrupacion` (`back/ETL/transform.py:747-777`) | fecha | — | Cabecera ausente → `NO_INFORMADO_EN_ORIGEN`; ilegible → `INVALIDO` (hoy ambos quedan nulos en `issue_date`) | O (semántica P) |
| L06 | `DataWarning` | Avisos de lectura (`front/components/equitas/data-warnings.tsx`) | Error de lectura de una tabla (`front/lib/data/raw-debtor-loader.ts`) | mensaje + código | — | Si existe, los indicadores que dependen de esa tabla son "no disponible", no 0 | D |

### 7.2 Objeto tributario

| ID | Variable | Rótulo | Fuente → fórmula | Unidad | Corte | Faltantes | Clase |
|---|---|---|---|---|---|---|---|
| OB01 | `debtor.id`, `DebtorListItem.id`, `PersonListItem.debtorIds`, FK `debt.debtor`, `debtor_person.debtor`, `debtor_profile.debtor` | — (enlaces `/debtors/<id>`) | **Clave interna** asignada por la base (`supabase/migrations/20261021220156_equitas_testing_schema.sql:91-92`); el frontend lee `id`/`debtor_id` (`front/lib/mappers/debtor-object-mapper.ts:422-424`) y las FK de obligaciones, relaciones y perfiles (`:173-175`, `:231-233`, `:404-406`) | id interno (texto en el DTO) | — | Fila sin id: se descarta (`front/lib/mappers/debtor-object-mapper.ts:426-428`). No es la cuenta municipal | D (identidad del sistema) |
| OB02 | `debtor.external_id` | — (solo como respaldo de "Identificador") | `Cuenta` → solo dígitos (`back/ETL/transform.py:102-125`, `334`); clave externa compuesta `(tenant, type, external_id)` (`supabase/migrations/20261021220156_equitas_testing_schema.sql:256`). El frontend no lo usa como identidad; solo lo muestra si faltan `identifier`/`code`/`account_number`/`domain` (`front/lib/mappers/debtor-object-mapper.ts:503-511`) | id externo numérico (cuenta municipal) | — | Sin dígitos → `None` y la fila se omite al cargar (`back/ETL/run_etl.py:146-148`); con caracteres no numéricos se conservan solo los dígitos. Contrato: `INVALIDO` con rechazo (ALIGN-024) | O (P) |
| OB03 | `debtor.type`, `DebtorListItem.type` | Tipo | `Bien_Tipo_Id` → catálogo `debtor_type` | etiqueta de catálogo | — | Hoy "Sin tipo" (`front/lib/mappers/debtor-object-mapper.ts:498-502`); contrato: `NO_INFORMADO_EN_ORIGEN` o `INVALIDO` si el código no está en el catálogo | O |
| OB04 | `debtor.identifier`, `DebtorListItem.identifier` | Identificador / Objeto | `Identificador` | texto | — | Hoy `OBJ-<id>` (`front/lib/mappers/debtor-object-mapper.ts:503-511`); contrato: `NO_INFORMADO_EN_ORIGEN` con el id interno como referencia rotulada | O |
| OB05 | `debtor.description`, `DebtorListItem.description` | Descripcion | `Bien_Descripcion` | texto | — | Hoy "Objeto de deuda …" (`front/lib/mappers/debtor-object-mapper.ts:512-514`); contrato: `NO_INFORMADO_EN_ORIGEN` | O |
| OB06 | `debtor.status` | — | `Estado` → booleano, vacío → `true` (`back/ETL/transform.py:181-218`, `330-339`) | booleano (vigencia del objeto) | — | Vacío no significa activo: `NO_INFORMADO_EN_ORIGEN` | O (P) |
| OB07 | `DebtorListItem.status` | Estado | Primera etiqueta normalizada de estado de sus obligaciones, o `debtor.status`, o "Vencido"/"En gestion" según deuda vencida (`front/lib/mappers/debtor-object-mapper.ts:515-526`) | etiqueta | `as_of` | Mezcla vigencia del objeto con estado de obligaciones; sin estados → ALIGN-011 muestra "No informado" (`NO_INFORMADO_EN_ORIGEN`), sin inventar gestión | D |

### 7.3 Obligación

| ID | Variable | Rótulo | Fuente → fórmula | Unidad | Corte | Faltantes | Clase |
|---|---|---|---|---|---|---|---|
| DE00 | `debt.id`, `DebtorDebtItem.id` | — (clave de fila) | **Clave interna** asignada por la base (`supabase/migrations/20261021220156_equitas_testing_schema.sql:67`). El frontend lee `id`/`debt_id` y, si falta, genera `<debtor_id>-<n>` por posición de lectura (`front/lib/mappers/debtor-object-mapper.ts:207-210`); no lee `external_id` para este campo | id interno (texto en el DTO) | — | El id posicional del respaldo es **D** inestable: no identifica la obligación entre consultas ni es `DEUD_id`. Contrato: sin id interno, la obligación no es enlazable (`NO_INTEGRADO`) | D (identidad del sistema) |
| DE01 | `debt.external_id` | — (no se lee en el frontend; su texto se copia en DE02 y DE11) | `DEUD_id` → solo dígitos (`back/ETL/transform.py:364`, `368`); clave externa `(debtor, external_id)` (`supabase/migrations/20261021220156_equitas_testing_schema.sql:246`); al cargar se deduplica por (`Bien_Tipo_Id`, `Cuenta`, `DEUD_id`) (`back/ETL/run_etl.py:291-296`) | id externo numérico | — | Sin dígitos → la fila se omite al cargar (`back/ETL/run_etl.py:287-289`). Contrato: `INVALIDO` con rechazo (ALIGN-024) | O |
| DE02 | `debt.period`, `DebtorDebtItem.period` | Periodo | Copia de `DEUD_id` (`back/ETL/transform.py:378`) | — (no es período) | — | El período fiscal real es `NO_INTEGRADO` (¿`Detalle_Deuda`/`Periodos_Deuda`?, P). ALIGN-011 muestra "No informado" si falta el identificador heredado | O (semántica P) |
| DE03 | `debt.type` | — | `Tipo_Ingreso_Id` → clave textual de 8 códigos fijos (`back/ETL/transform.py:286-308`) | clave de tributo | — | Código no listado → `unknown_<id>`; contrato: `INVALIDO` con motivo | O |
| DE04 | `debt.original_amount`, `DebtorDebtItem.originalAmount` | Monto original | `NOTD_capital` | ARS | — | Hoy inválido → `0.0` (`back/ETL/transform.py:142-160`) y el frontend de ALIGN-011 representa el inválido como null + `INVALIDO` en `DebtorDebtItem.metrics`; contrato: `INVALIDO`, cero real preservado | O |
| DE05 | `debt.current_amount` | — | `NOTD_totalActualizado` | ARS | `source_updated_at` | Igual que DE04 | O |
| DE06 | `debt.updated_amount`, `DebtorDebtItem.updatedAmount` | Monto actualizado | En el original y en la base local (ALIGN-017) es columna generada desde `current_amount`; en la migración de testing es numérica ordinaria. ALIGN-011 lee `current_amount`, o el alias `updated_amount` si la columna actual no existe; nunca usa el capital | ARS | `source_updated_at` | ALIGN-011 conserva 0; campo vacío = `NO_INFORMADO_EN_ORIGEN`, ilegible = `INVALIDO`, lectura fallida = `NO_INTEGRADO`; estado y conteos en `DebtorDebtItem.metrics` | O |
| DE07 | `debt.due_date`, `DebtorDebtItem.dueDate` | Vencimiento | `NOTD_vencimiento` (`back/ETL/transform.py:163-177`) | fecha | — | Ilegible → hoy nula; contrato: `INVALIDO` con rechazo | O |
| DE08 | `debt.issue_date` | — | `Fecha_Actualizacion` de cabecera (`back/ETL/transform.py:763-768`) | fecha | — | No es emisión: la fecha de emisión real es `NO_INTEGRADO` | O (semántica P) |
| DE09 | `debt.last_collection_date` | — | `Fecha_Actualizacion` de cabecera (`back/ETL/transform.py:772-777`) | fecha | — | No es gestión ni cobro: la última gestión real es `NO_INTEGRADO` | O (semántica P) |
| DE10 | `debt.status`, `DebtorDebtItem.status` | Estado | FK a `debt_status` (8 claves, `back/ETL/transform.py:39-46`), hoy **inferida** por vencimiento contra `date.today()` (`back/ETL/transform.py:266-279`). En el frontend de ALIGN-011: etiqueta de catálogo por FK `status`, sin inferir por vencimiento | etiqueta de catálogo | `as_of` | Estado de origen (`NOTD_ESTA_id`/`NOTD_SITU_id`) `NO_INTEGRADO`; si falta, `UNKNOWN`, nunca "vencida" ni "vigente" inventada. ALIGN-011 resuelve la FK `status` por catálogo y usa `UNKNOWN` si falta o no se reconoce, sin inferencia por fecha; `DebtorDebtItem.statusPresence` distingue ausencia, código inválido y lectura fallida | P |
| DE11 | `debt.description` | — | Texto fijo con el `DEUD_id` (`back/ETL/transform.py:371`) | texto | — | `Detalle_Deuda` de origen `NO_INTEGRADO` | D |
| DE12 | `debt.currency` | — | L02 | id | — | L02 | D |

### 7.4 Persona, relación y contacto

| ID | Variable | Rótulo | Fuente → fórmula | Unidad | Corte | Faltantes | Clase |
|---|---|---|---|---|---|---|---|
| PE00 | `person.id`, `PersonListItem.id`, `DebtorPersonItem.id`, `DebtorPersonRelation.personId`, `DebtorContactItem.personId`, `DebtorListItem.peopleIds`, FK `debtor_person.person`, `debtor_contact.person`, `debtor_profile_detail.person` | — (enlaces y filtro `personId`) | **Clave interna** asignada por la base (`supabase/migrations/20261021220156_equitas_testing_schema.sql:160`, `288`); las FK apuntan a `person.id` (`:338`, `:344`, `:350`). El frontend lee `id`/`person_id` de `person` (`front/lib/mappers/person-risk-mapper.ts:237`; `front/lib/mappers/debtor-object-mapper.ts:164`) y la FK de la relación (`front/lib/mappers/debtor-object-mapper.ts:234-236`), que conserva como id del DTO (`:379`) | id interno (texto en el DTO) | — | Persona sin id o relación sin FK: se descarta (`front/lib/mappers/person-risk-mapper.ts:239-241`; `front/lib/mappers/debtor-object-mapper.ts:238-240`). No es `Destinatario_Id` | D (identidad del sistema) |
| PE01 | `person.external_id` | — (no se lee en el frontend) | `Destinatario_Id` → solo dígitos (`back/ETL/transform.py:320`); clave de deduplicación al cargar (`back/ETL/load.py:380-395`); única global, sin municipio (`supabase/migrations/20261021220156_equitas_testing_schema.sql:286`) | id externo numérico, único global | — | Sin dígitos → la fila se omite al cargar (`back/ETL/run_etl.py:142-144`). Contrato: `INVALIDO` con rechazo (ALIGN-024); la unicidad global sin municipio es brecha (§2) | O |
| PE02 | `person.full_name`, `DebtorPersonItem.name`, `PersonListItem.name`, `DebtorContactItem.personName` | Nombre / Persona | `Destinatario` | texto personal | — | Hoy "Persona <id>" (`front/lib/mappers/person-risk-mapper.ts:245-248`); contrato: `NO_INFORMADO_EN_ORIGEN` | O |
| PE03 | `person.document_number`, `DebtorPersonItem.document`, `PersonListItem.document` | Documento | `Destinatario_CUIT` | texto personal | — | Hoy "Sin documento"; contrato: `NO_INFORMADO_EN_ORIGEN`. Validez no verificada | O |
| PE04 | `person.type` | — | Inferido por prefijo del CUIT (`back/ETL/transform.py:246-262`) | catálogo `person_type` | — | Prefijo no reconocido → `UNKNOWN` (1242 personas). Nunca es factor de prioridad | D |
| PE05 | `person.document_type` | — | Inferido: documento presente → CUIT (`back/ETL/transform.py:237-242`) | catálogo | — | Sin documento → desconocido | D |
| PE06 | `person.birth_date` | — | Siempre `None` (`back/ETL/transform.py:325`) | fecha | — | `NO_INFORMADO_EN_ORIGEN` (o `NO_APLICA` para personas jurídicas) | A |
| PE07 | `person.status` | — | Siempre activo (`back/ETL/transform.py:326`) | catálogo | — | El estado de origen es `NO_INTEGRADO` | D |
| RE01 | `debtor_person.priority`, `DebtorPersonItem.priority`, `DebtorPersonRelation.priority` | Prioridad de contacto | `Destinatario_Porcentaje` (`back/ETL/transform.py:342-354`) = **porcentaje declarado** | % (0–100) | — | ALIGN-011 muestra "No informado" si falta; el ETL aún lo lee como 0; contrato: `NO_INFORMADO_EN_ORIGEN`. Suma ≠100 → bandera, sin normalizar | O (semántica P) |
| RE02 | `debtor_person.role`, `DebtorPersonItem.relation`, `DebtorPersonRelation.relation` | Relacion | `Destinatario_Tipo` | texto | — | ALIGN-011 muestra "No informado" (`NO_INFORMADO_EN_ORIGEN`) | O (semántica P) |
| RE03 | `debtor_person.active` | — | Siempre `true` al cargar (`back/ETL/transform.py:353`) | booleano | — | La baja de relaciones en origen es `NO_INTEGRADO` | D |
| CO01 | `debtor_contact.value`, `DebtorContactItem.value`, `DebtorPersonItem.contact` | Valor / Contacto | `Destinatario_Telefono`, `Destinatario_Celular`, `Destinatario_Email` (`back/ETL/transform.py:455-505`) | texto personal | — | Sin valor → no se crea fila. Validez y consentimiento: `NO_INTEGRADO` ("no verificado"). Hoy "Sin contacto" en el resumen por persona | O; validez A |
| CO02 | `debtor_contact.type`, `DebtorContactItem.channel` | Canal | Tipo fijado por la columna de origen; en el frontend, columna explícita o inferencia por `@` (`front/lib/mappers/debtor-object-mapper.ts:87-105`) | catálogo `contact_type` | — | Inferencia por `@` es D, no O | O |
| CO03 | `debtor_contact.active`, `DebtorContactItem.isActive` | Estado | Siempre `true` al cargar | booleano | — | Activo ≠ verificado | D |
| CO04 | `DebtorContactItem.id` (`personId`: PE00) | — | Clave interna de `debtor_contact`; si falta, el frontend genera `<person_id>-<n>` por posición (`front/lib/mappers/debtor-object-mapper.ts:320-322`) | id interno | — | El id posicional del respaldo no es identidad estable | D (identidad del sistema) |

### 7.5 Perfil del objeto calculado por el ETL

Todas las columnas de `debtor_profile` son **D** y **persistidas** (§5.1): `computed_at = profile_generated_at` y antigüedad calculada contra `date.today()` del momento de carga (`back/ETL/transform.py:601-650`). Las de `debtor_profile_detail` se construyen en `back/ETL/transform.py:694` en la misma carga. Leerlas no las recalcula: se rotulan "calculado el `<profile_generated_at>`" (ALIGN-011 lee esa columna para los objetos; cuando falta o no se lee, declara "momento de cálculo desconocido") y su corte es `NO_INTEGRADO`; nunca "calculado al día de la consulta".

| ID | Variable | Rótulo | Fuente → fórmula | Unidad | Corte | Faltantes | Clase |
|---|---|---|---|---|---|---|---|
| PR01 | `debtor_profile.total_debt_amount` | (vía DebtorListItem.totalDebt) | Σ `current_amount` del objeto | ARS | `computed_at` | Perfil ausente → `NO_INTEGRADO`, no 0 | D |
| PR02 | `debtor_profile.overdue_debt_amount` | (vía DebtorListItem.overdueDebt) | Σ `current_amount` con estado inferido "vencida" | ARS | `computed_at` (`as_of` `NO_INTEGRADO`; "vencida" según la fecha de carga) | Depende de DE10 (P) | D |
| PR03 | `debtor_profile.debt_count`, `debtor_profile.overdue_debt_count` | — | Conteo de obligaciones / de obligaciones vencidas inferidas | obligaciones | `computed_at` (`as_of` `NO_INTEGRADO`) | — | D |
| PR04 | `debtor_profile.oldest_debt_days`, `debtor_profile.average_debt_age_days` | — | Máximo / promedio de días desde `due_date` hasta la fecha de carga (`back/ETL/transform.py:512-523`, `620-625`) | días a la fecha de `computed_at` | `computed_at` (`as_of` `NO_INTEGRADO`; no equivale a días a la fecha de consulta) | Vencimiento ilegible → hoy 0 días; contrato: `INVALIDO` | D |
| PR05 | `debtor_profile.active_person_count` | — | Personas con relación activa | personas | — | — | D |
| PR06 | `debtor_profile.available_contact_count` | — | Contactos con valor de las personas del objeto | contactos | — | "Disponible" = con valor, no verificado | D |
| PR07 | `debtor_profile.previous_contact_count`, `debtor_profile.previous_response_count` | — | Ningún código los alimenta ni los lee; quedan en el valor por defecto de la base | gestiones / respuestas | — | **`NO_INTEGRADO`**. El valor almacenado no significa "cero gestiones" | A |
| PR08 | `debtor_profile.socioeconomic_risk_level` | Riesgo (vía DebtorListItem.riskScore) / "Nivel socioeconomico / riesgo" | Índice heredado de severidad v0 (§8): `min(35·deuda/promedio del lote, 60) + min(10·vencida/total, 10) + min(vencidas, 10) + min(15·días/365, 15) + {15, 5, 0} por 0/1/≥2 contactos + 5 si >1 persona`, acotado a 0–100 (`back/ETL/transform.py:535-597`; promedio en `back/ETL/run_etl.py:343-358`) | puntos 0–100 (no %) | `computed_at`, relativo al lote | Total ≤0 → hoy 0; contrato: `NO_APLICA` | D |
| PR09 | `debtor_profile_detail.risk_value`, `PersonListItem.riskValue` | Puntaje / Riesgo individual | PR08 del objeto + 15/3 por 0/1 contactos de la persona + 5 si el rol contiene "responsable" + 5 si el porcentaje declarado ≥75, acotado a 0–100 (`back/ETL/transform.py:694`). El frontend toma el **máximo** entre los objetos de la persona (`front/lib/mappers/person-risk-mapper.ts:127-150`) | puntos 0–100 | `computed_at` | ALIGN-011: persona sin detalle → null + `NO_INTEGRADO` ("no disponible"), fuera de BAJO; `PersonListItem.metrics` conserva presencia y conteo de faltantes | D |
| PR10 | `debtor_profile_detail.reason` | — | Texto explicativo del ajuste (`back/ETL/transform.py:655`) | texto | `computed_at` | — | D |

### 7.6 Indicadores del objeto calculados por el frontend

Se arman en cada consulta en `front/lib/mappers/debtor-object-mapper.ts:420-553`, pero **no todos se recalculan**: varios reutilizan valores persistidos del perfil cuando existen (FO01, FO02, FO10) y otros dependen del estado DE10 inferido al cargar. Su procedencia temporal (recalculado, persistido o mixto) y su rótulo están en §5.1; el corte es siempre `NO_INTEGRADO`.

| ID | Variable | Rótulo | Fuente → fórmula | Unidad | Corte | Faltantes | Clase |
|---|---|---|---|---|---|---|---|
| FO01 | `DebtorListItem.totalDebt`, `DebtorProfileSummary.totalDebt` | Deuda total / Deuda | PR01 del perfil (incluido 0) o, si falta, Σ importes actuales observados (`front/lib/mappers/debtor-object-mapper.ts:445-451`) | ARS por objeto | `computed_at` | ALIGN-011 conserva 0; perfil inválido no se reemplaza; sin perfil se suma el importe actual leído (§4.1). `DebtorListItem.metrics` y `DebtorProfileSummary.metrics` conservan presencia y conteos de faltantes | D |
| FO02 | `DebtorListItem.overdueDebt`, `DebtorProfileSummary.overdueDebt` | Deuda vencida | PR02 o Σ `updatedAmount` de obligaciones vencidas (`front/lib/mappers/debtor-object-mapper.ts:453-459`) | ARS por objeto | `as_of` | Igual que FO01 | D |
| FO03 | `DebtorListItem.debtCount`, `DebtorProfileSummary.debtCount` | Cantidad de deudas | Obligaciones leídas del objeto | obligaciones | — | Lectura fallida → "no disponible" | D |
| FO04 | `DebtorListItem.overdueDebtsCount` | — | Obligaciones con clave de catálogo `key='OVERDUE'`; solo si falta `key` se admite la etiqueta heredada "OVERDUE" o "venc/mora/atras", sin inferencia por fecha (`front/lib/mappers/debtor-object-mapper.ts`, `isDebtOverdue`) | obligaciones | `as_of` | Depende de DE10 (P). ALIGN-011 c1: un estado no observado deja el conteo y el máximo de atraso no disponibles; la suma de mora conserva importes observados y faltantes por estado (§4.1), sin tratar el estado incompleto como lectura fallida | D |
| FO05 | `DebtorListItem.maxDaysOverdue` (`overdueDays` en el tablero) | Atraso / Dias de atraso | Máximo de días desde `dueDate` de obligaciones vencidas (`front/lib/mappers/debtor-object-mapper.ts:460-463`) | días | `as_of` | ALIGN-011: sin vencidas → null + `NO_APLICA`; vencimiento ilegible → null + `INVALIDO`, sin sustituir por 0 | D |
| FO06 | `DebtorProfileSummary.antiquityDays` | Antiguedad | Días desde el vencimiento más antiguo (`front/lib/services/debtor-data-service.ts:21-36`) | días | `as_of` | ALIGN-011: sin vencimientos → null + `NO_INFORMADO_EN_ORIGEN`; lectura fallida → `NO_INTEGRADO` | D |
| FO07 | `DebtorListItem.peopleCount`, `DebtorListItem.peopleIds`, `DebtorListItem.peopleNames`, `DebtorProfileSummary.associatedPeople` | Personas / Personas asociadas | Relaciones activas del objeto (`peopleIds` = ids internos PE00) | personas | — | Sin relaciones → `NO_INFORMADO_EN_ORIGEN` (todo objeto observado tiene ≥1) | D |
| FO08 | `DebtorListItem.contactCount`, `DebtorProfileSummary.availableContacts` | Contactos disponibles | ALIGN-011: contactos activos con valor de personas vinculadas activas; deduplicados por persona, canal y valor, sin usar PR06 | contactos | — | Lectura fallida = null + `NO_INTEGRADO`; validez `NO_INTEGRADO` | D |
| FO09 | `DebtorListItem.hasContact` | Contacto / Con contacto | `contactCount > 0` | booleano | — | "Con contacto" = con valor cargado, no verificado | D |
| FO10 | `DebtorListItem.riskScore`, `DebtorListItem.risk`, `DebtorProfileSummary.riskScore`, `DebtorProfileSummary.risk` | Riesgo | ALIGN-011 lee PR08 numérico si existe; conserva el cero y no infiere un índice si falta. Bandas: 0–39 BAJO, 40–69 MEDIO, 70–100 ALTO (`front/lib/services/debtor-risk-calculator.ts:14-29`) | puntos 0–100 / banda | `computed_at` | ALIGN-011 deja null + `NO_INTEGRADO` cuando falta el perfil; ya no invoca el fallback del servicio para estos objetos. Las fórmulas heredadas del servicio y del ETL quedan a cargo de ALIGN-008 | D |
| FO11 | `DebtorProfileSummary.socioeconomicLevel` | Nivel socioeconomico / riesgo | Literal "No informado" (`front/lib/services/debtor-data-service.ts:41`) | — | — | Vulnerabilidad `NO_INFORMADO_EN_ORIGEN`; el rótulo junto al riesgo sugiere que el índice es social | A |
| FO12 | `DebtorListItem.recommendationType`, `DebtorListItem.recommendation`, `DebtorListItem.recommendationReason`, `DebtorListItem.isUrgentRecommendation` | Recomendacion | Reglas por banda, contacto, deuda vencida y atraso ≥60 días (`front/lib/services/debtor-recommendation-generator.ts:19-73`) | categoría de acción | `as_of` | Sin contacto + riesgo ALTO → "revision humana" urgente | D |
| FO13 | `DebtorListItem.priorityScore` | Score / prioridad | `min(total/250000, 4)·18 + min(días/30, 4)·10 + {30,18,8} por banda + (contacto ? 10 : −6) + {20,14,9,4} por recomendación`, piso 0 (`front/lib/mappers/debtor-object-mapper.ts:120-147`) | puntos 0–172 (no 0–100) | `as_of` | Hereda los faltantes de FO01, FO05 y FO10 | D |
| FO14 | `DebtorListItem.priorityLevel` | Prioridad | ≥105 ALTA, ≥70 MEDIA, resto BAJA (`front/lib/mappers/debtor-object-mapper.ts:107-117`) | banda | `as_of` | — | D |

### 7.7 Indicadores de personas

| ID | Variable | Rótulo | Fuente → fórmula | Unidad | Corte | Faltantes | Clase |
|---|---|---|---|---|---|---|---|
| FP01 | `PersonListItem.individualRisk` | Riesgo individual | Banda de FO10 aplicada a PR09 | banda | `computed_at` | ALIGN-011: sin detalle → null, "no disponible"; cero observado conserva BAJO | D |
| FP02 | `PersonListItem.debtorsCount`, `PersonListItem.debtorIds`, `PersonListItem.debtorIdentifiers` | Objetos / Objetos asociados | Objetos con relación activa (`debtorIds` = ids internos OB01; `debtorIdentifiers` = OB04 o `OBJ-<id interno>`) | objetos | — | — | D |
| FP03 | `PersonListItem.hasContact` | Contacto disponible | Al menos un contacto activo con valor (`front/lib/mappers/person-risk-mapper.ts:186-233`) | booleano | — | Validez `NO_INTEGRADO` | D |
| FP04 | `PersonListItem.totalDebtAssociated` | Deuda total asociada | Σ total por objeto vinculado (`front/lib/mappers/person-risk-mapper.ts:98-125`, `258-261`) = **exposición asociada no aditiva** (§3) | ARS, no aditivo | `computed_at` | ALIGN-011 conserva `current_amount` incluido 0, sin sustituir por capital; `PersonListItem.debtExposure` mantiene objeto y presencia del importe; `PersonListItem.exposureLabel` declara "Exposición asociada (no aditiva)" | D |

### 7.8 Agregados de tablero y listados

| ID | Variable | Rótulo | Fuente → fórmula | Unidad | Corte | Faltantes | Clase |
|---|---|---|---|---|---|---|---|
| AG01 | `DashboardData.totalDebtors` | — (base de porcentajes) | Objetos leídos | objetos | — | Lectura fallida → "no disponible" | D |
| AG02 | `DashboardData.totalDebt` | Deuda total | Σ FO01 por objeto (`front/lib/mappers/dashboard-metrics-mapper.ts:111`) | ARS | `computed_at` | Objetos con total no `OBSERVADO` se cuentan aparte en `DashboardData.metrics`; lectura fallida → null + `NO_INTEGRADO` | D |
| AG03 | `DashboardData.overdueCases` | Casos vencidos | Objetos con FO02 > 0 | objetos | `as_of` | — | D |
| AG04 | `DashboardData.withContactCases`, `DashboardData.withoutContactCases` | Con contacto / Casos sin contacto | Objetos por FO09 | objetos | — | "Sin contacto" = sin valor cargado | D |
| AG05 | `DashboardData.priorityCases` | Objetos prioritarios | Objetos con FO14 = ALTA | objetos | `as_of` | — | D |
| AG06 | `DashboardData.urgentRecommendationCases` | Recomendacion urgente | Objetos con FO12 urgente | objetos | `as_of` | — | D |
| AG07a | `DashboardData.criticalCasesToday` | — (no se muestra hoy) | **Conjunto operativo amplio**: objetos con FO10 `riskScore > 90` **o** FO12 `isUrgentRecommendation` **o** (FO02 > 0 **y** FO09 falso) (`front/lib/mappers/dashboard-metrics-mapper.ts:98-103`, `117`) | objetos | `as_of` | Hereda FO02, FO09, FO10 y FO12; un objeto sin perfil entra por el fallback de FO10 o por falta de contacto | D |
| AG07b | `DashboardData.riskAboveNinetyCases` | — (no se muestra hoy; riesgo-análisis calcula su propio conteo, VP10) | Objetos con FO10 `riskScore > 90` **estrictamente**; no incluye urgentes ni vencidos sin contacto (`front/lib/mappers/dashboard-metrics-mapper.ts:104`) | objetos | `as_of` | Objetos con riesgo no disponible se cuentan aparte (§4.1), no como ≤ 90 | D |
| AG07c | `DashboardData.criticalDebtTotal` | — (no se muestra hoy) | Σ FO01 de los objetos de AG07b (riesgo > 90), **no** de AG07a (`front/lib/mappers/dashboard-metrics-mapper.ts:105-107`) | ARS | `as_of` | Hereda FO01; ningún objeto > 90 con universo leído → 0 derivado (§4.1 regla 2) | D |
| AG08 | `DashboardData.byDebtStatus` | — (no se muestra hoy; **no** es el gráfico "Deuda por estado", VP07) | **Conteo de obligaciones** agrupado por la etiqueta DE10 de cada obligación (`front/lib/mappers/debtor-object-mapper.ts:413-418`; `front/lib/mappers/dashboard-metrics-mapper.ts:120-122`), orden descendente | obligaciones | `as_of` | Estados `NO_INTEGRADO` o `UNKNOWN` en barra propia | D |
| AG09 | `DashboardData.byDebtorType` | Objetos por tipo | Objetos por OB03 | objetos | — | — | D |
| AG10 | `DashboardData.byRisk`, `PeopleDashboardSummary.individualRiskDistribution`, `PeopleDashboardSummary.lowRiskCount`, `PeopleDashboardSummary.mediumRiskCount`, `PeopleDashboardSummary.highRiskCount` | Distribucion por riesgo / Riesgo bajo, medio, alto | Conteo por banda FO10 (objetos, `front/lib/mappers/dashboard-metrics-mapper.ts:24-38`) / FP01 (personas, `front/lib/mappers/person-risk-mapper.ts:29-31`, `40-44`); las tres bandas se inicializan en 0 | objetos / personas | `computed_at` | "No disponible" en categoría propia, nunca en BAJO; `PeopleDashboardSummary.metrics` conserva el desglose de faltantes de personas | D |
| AG11 | `DashboardData.byRecommendation` | Recomendaciones sugeridas | Conteo de objetos por FO12; las cuatro categorías se inicializan en 0 (`front/lib/mappers/dashboard-metrics-mapper.ts:29-42`) | objetos | `as_of` | — | D |
| AG12 | `DashboardData.topDebtChart`, `DashboardData.topDebtors`, `DashboardData.topDebtDebtors`, `DashboardData.topPriorityDebtors`, `DashboardData.withoutContactDebtors` | Top de deuda / A quien gestionar primero / Casos sin contacto | Proyecciones de `DebtorListItem` ordenadas por FO01 o FO13 (`overdueDays` = FO05) | objetos | `as_of` | Heredan los de sus campos | D |
| AG13 | `PeopleDashboardSummary.totalPeople`, `PeopleDashboardSummary.withoutContactCount`, `PeopleDashboardSummary.topPeopleByRiskValue` | Sin contacto / Top 5 personas con mayor riesgo | Conteos y orden por PR09 (`front/lib/mappers/person-risk-mapper.ts:28-68`) | personas | `computed_at` | — | D |
| AG14 | `totalDebtAssociated` y `averageRiskValue` de las personas filtradas | Deuda asociada / Riesgo promedio | Universo: personas que pasan los filtros de VP06. `totalDebtAssociated` = Σ de los objetos distintos vinculados; `averageRiskValue` = Σ `riskValue` (PR09) / n, con un decimal (`front/app/people/page.tsx:101-108`, mostrado en `:186`, `:189`) | ARS / puntos 0–100 | `computed_at` | ALIGN-011 deduplica la unión de objetos antes de paginar. Sin personas: suma 0 derivada, promedio null + `NO_APLICA`; sin detalle se cuenta aparte y no entra en el promedio | D |
| AG15 | Resumen por recomendación (`buildRecommendationSummary`) | Cantidad de casos / Deuda asociada / Riesgo promedio | Por cada categoría FO12: conteo de objetos, Σ FO01, promedio de FO10 `riskScore` (un decimal) y los 3 primeros por prioridad operativa (`front/lib/equitas-view-selectors.ts:115-134`; `front/app/recommended-actions/page.tsx:30`, `48-55`, `105-108`) | objetos / ARS / puntos | `as_of` | ALIGN-011: promedio sin casos → null + `NO_APLICA`; lectura fallida → `NO_INTEGRADO`. Conteo y suma de una categoría vacía leída correctamente: 0 derivado | D |
| AG16 | Resumen de antigüedad (`buildDebtAgingSummary`) | Deuda total / Deuda vencida / Promedio de atraso / Distribucion por atraso | Σ FO01, Σ FO02, promedio de FO05 sobre objetos con deuda vencida, bandas 0 / 1–30 / 31–90 / +90 días (`front/lib/equitas-view-selectors.ts:71-113`) | ARS / días / objetos | `as_of` | ALIGN-011: promedio sin casos → null + `NO_APLICA`; FO05 no observado queda fuera de las bandas y se cuenta aparte | D |
| AG17 | `noContactCases`, `associatedDebt`, `highRiskNoContact`, `totalShare` | Total sin contacto / Deuda asociada / Riesgo alto sin contacto / Sobre el total | Universo: objetos con FO09 falso. Conteo; Σ FO01; conteo con banda FO10 = ALTO; `totalShare` = round(100 · sin contacto / objetos leídos) (`front/app/no-contact/page.tsx:47-51`, mostrados en `:75-96`) | objetos / ARS / % entero | `as_of` | ALIGN-011: base 0 → null + `NO_APLICA`; lectura fallida → `NO_INTEGRADO`. "Sin contacto" = sin valor cargado (validez `NO_INTEGRADO`) | D |
| AG18 | Cifras de la pantalla de ingreso | Casos criticos / Sin contacto / Deuda gestionada | Literales fijos en código (`front/app/login/page.tsx:9-24`) | — | — | **No son datos**: no hay ningún dato de gestión (`NO_INTEGRADO`). Retirar o rotular "ilustrativo" (ALIGN-012) | S |

### 7.9 Cálculos locales de páginas y componentes

Valores que una página o un componente calcula y muestra sin que existan en un DTO. Inventario completo de `front/app/**/page.tsx` y `front/components/**` @36f35b4: las demás cifras de esas pantallas son campos de DTO ya definidos en §7.2–§7.8 (incluida la ficha `front/app/debtors/[debtorId]/page.tsx`, que solo muestra campos de `DebtorListItem`, `DebtorProfileSummary`, `DebtorDebtItem`, `DebtorPersonItem` y `DebtorContactItem`), o son paginación (página actual, "Mostrando a–b de n", `front/lib/pagination.ts:18-29`), que no es un dato de dominio. La prueba `front/tests/unit/domain-contract.test.ts` exige que cada nombre de esta tabla siga existiendo en su archivo y tenga entrada aquí.

| ID | Variable | Rótulo | Fuente → fórmula | Unidad | Corte | Faltantes | Clase |
|---|---|---|---|---|---|---|---|
| VP01 | `highRiskShare` (`front/app/page.tsx`) | "n% de los objetos estan en riesgo alto" | `round(100 · byRisk[ALTO] / totalDebtors)`; numerador AG10 (banda FO10 = ALTO, `riskScore` ≥ 70), denominador AG01 (`front/app/page.tsx:42-46`, mostrado en `:128`) | % de objetos, entero | `as_of` | Universo: todos los objetos leídos. `totalDebtors` = 0 → ALIGN-011 devuelve null + `NO_APLICA` (lectura fallida: "no disponible"). Objetos con riesgo no disponible: fuera del numerador y contados aparte (ALIGN-011 ya no les asigna una banda por fallback) | D |
| VP02 | `topDebtConcentration` (`front/app/page.tsx`) | "Los 5 objetos con mayor deuda concentran n% del saldo total" | `round(100 · Σ FO01 de topDebtDebtors / totalDebt)`: numerador = los 5 objetos de mayor FO01 (AG12), denominador AG02 (`front/app/page.tsx:47-54`, mostrado en `:133`) | % del saldo ARS, entero | `as_of` | Universo: todos los objetos leídos; con ≤5 objetos da 100 %. `totalDebt` ≤ 0 → ALIGN-011 devuelve null + `NO_APLICA`; total desconocido → `NO_INTEGRADO` | D |
| VP03 | `percentage` por recomendación (`front/app/page.tsx`) | "n casos (p%)" y ancho de la barra | Para cada una de las 4 categorías FO12: `count` = valor de AG11 (`?? 0`) y `percentage` = `round(100 · count / totalDebtors)` (`front/app/page.tsx:247-251`, mostrado en `:260`, `:272`) | objetos / % de objetos, entero | `as_of` | Universo: todos los objetos leídos. `count` 0 de una categoría vacía es 0 derivado (AG11 siempre trae las 4). `totalDebtors` = 0 → ALIGN-011 devuelve null + `NO_APLICA`. Los redondeos pueden no sumar 100 | D |
| VP04 | `dominantRecommendation` (`front/app/page.tsx`) | «"<categoría>" concentra n% de los objetos actuales» | Categoría de mayor conteo en AG11 (orden descendente estable: en empate gana la primera de las 4 en su orden fijo); participación = `round(100 · value / max(totalDebtors, 1))` (`front/app/page.tsx:55-58`, `279-283`) | categoría FO12 / % de objetos, entero | `as_of` | ALIGN-011: sin objetos no elige categoría dominante (`NO_APLICA`); cuando varias categorías tienen el máximo, declara el empate | D |
| VP05 | `withContactCount` (`front/app/people/page.tsx`) | "Con contacto: n" (dentro de la tarjeta "Sin contacto") | Conteo de las **personas filtradas** (VP06) con FP03 `hasContact` verdadero (`front/app/people/page.tsx:109`, mostrado en `:176`) | personas | — | Universo filtrado, distinto del de `PeopleDashboardSummary.withoutContactCount` (AG13, todas las personas) que se muestra en la misma tarjeta (`:173`): no se suman ni se restan entre sí. "Con contacto" = con valor activo cargado, no verificado (AU05). Subconjunto vacío → 0 derivado | D |
| VP06 | `filteredPeople`, `filteredDebtors`, `filteredCases` (contadores de resultados) | "n / N personas", "n / N registros", "n casos" | Conteo de personas u objetos que pasan los filtros de la pantalla: personas por texto (nombre o documento) y banda FP01 (`front/app/people/page.tsx:36-48`, `89`, mostrado en `:125-126`); objetos por texto, FO10, OB07, OB03, FO09 y persona (`front/app/debtors/page.tsx:72-99`, `154`, mostrado en `:192-193`); casos prioritarios por texto, FO10, FO09, OB03 y monto mínimo sobre FO01 (`front/app/priority-cases/page.tsx:69-88`, mostrado en `:108`). `N` = total leído | personas / objetos | — | Lectura fallida → "no disponible", no "0 / 0". ALIGN-011 informa "Monto mínimo inválido" cuando el filtro no es numérico; una lectura fallida muestra "no disponible" | D |
| VP07 | `debtByStatusChart` (`front/app/debt-aging/page.tsx`) | "Deuda por estado" | **Suma ARS** de FO01 (`DebtorListItem.totalDebt`) agrupada por la etiqueta de estado **del objeto** OB07 (`DebtorListItem.status`), orden descendente (`front/app/debt-aging/page.tsx:52-60`, mostrado en `:115`) | ARS por etiqueta de estado del objeto | `as_of` | **No es AG08**: AG08 cuenta obligaciones por estado de la obligación (DE10). ALIGN-011: objetos sin estado usan "No informado" (OB07); solo se suman importes observados de FO01 | D |
| VP08 | `topDebtChart` de Deuda y mora (`front/app/debt-aging/page.tsx`) | "Top deuda por objeto" / "Top 10 mayor deuda" | Los 10 objetos de mayor FO01 (`buildDebtAgingSummary().topDebtCases`, `front/lib/equitas-view-selectors.ts:82`), rotulados por OB04 (`front/app/debt-aging/page.tsx:61-64`, mostrado en `:116`) | ARS por objeto | `as_of` | Distinto de `DashboardData.topDebtChart` (top 5, AG12). Hereda FO01 | D |
| VP09 | `objectRiskDistribution` (`front/app/risk-analysis/page.tsx`) | "Distribucion de objetos por riesgo" | Conteo de objetos por banda FO10 (ALTO/MEDIO/BAJO), recalculado en la página con la misma regla que AG10 (`front/app/risk-analysis/page.tsx:29-32`, mostrado en `:96`) | objetos | `as_of` | Igual que AG10: riesgo no disponible en categoría propia, nunca en BAJO | D |
| VP10 | `highRiskCases` (`front/app/risk-analysis/page.tsx`) | "Objetos con riesgo > 90" y tabla "Objetos con riesgo mayor a 90" | Objetos con FO10 `riskScore > 90` estrictamente, ordenados por prioridad operativa (`getHighRiskCases`, `front/lib/equitas-view-selectors.ts:55-57`; `front/app/risk-analysis/page.tsx:33`, conteo en `:64`, 10 primeros en `:120`). Misma condición que AG07b | objetos | `as_of` | Conjunto sin objetos > 90 con universo leído → 0 derivado; riesgo no disponible se cuenta aparte | D |
| VP11 | `highIndividualRiskPeople` (`front/app/risk-analysis/page.tsx`) | "Personas con puntaje alto" ("Puntaje individual desde 70") | Personas con PR09 `riskValue` ≥ 70 (coincide con la banda ALTO de FP01), ordenadas por `riskValue` y luego FP04 (`getHighIndividualRiskPeople`, `front/lib/equitas-view-selectors.ts:59-69`; `front/app/risk-analysis/page.tsx:34`, conteo en `:85`, 10 primeros en `:162`) | personas | `computed_at` | ALIGN-011: personas sin detalle quedan fuera del conjunto y se cuentan aparte como "no disponible" | D |
| VP12 | Porcentaje de la leyenda de `RiskDonutChart` (`front/components/charts/debtor-dashboard-charts.tsx`) | "n,n%" junto a cada banda | `percentage` = 100 · valor de la banda / Σ valores de la serie, un decimal (`front/components/charts/debtor-dashboard-charts.tsx:124-125`, `170`, mostrado en `:202`). Series: AG10 `byRisk`, VP09 y `individualRiskDistribution` | % de la serie (objetos o personas) | según la serie | ALIGN-011: serie vacía o suma 0 → "Sin datos disponibles" sin anillo ni porcentaje (`NO_APLICA`) | D |
| VP13 | Relleno "Sin datos" de `BarDistributionChart` y `TopDebtHorizontalChart` (`front/components/charts/debtor-dashboard-charts.tsx`) | Barra "Sin datos" | ALIGN-011: serie vacía → mensaje sin barra (`front/components/charts/debtor-dashboard-charts.tsx:69`, `220`) | — | — | ALIGN-011 muestra "Sin datos disponibles" sin fabricar una barra de valor 0 | D |
| VP14 | Puntaje redondeado en `RiskBadge` y `PersonRiskBadge` | "ALTO (n)" | `Math.round(score)` de FO10 / PR09 (`front/components/equitas/risk-badge.tsx:8`; `front/components/people/person-risk-badge.tsx:9`); en riesgo-análisis también `riskValue.toFixed(2)` (`front/app/risk-analysis/page.tsx:171`) | puntos 0–100 (no %) | según el puntaje | Solo formato: hereda los faltantes de FO10/PR09 | D |

### 7.10 Reglas de prioridad en Python (servicio de scoring)

| ID | Variable | Rótulo | Fuente → fórmula | Unidad | Corte | Faltantes | Clase |
|---|---|---|---|---|---|---|---|
| PY01 | `risk_band` | — | PR08: ≥75 critical, ≥50 high, ≥25 medium, resto low (`back/services/scoring_service.py:108-118`) — bandas distintas de FO10 | banda | `computed_at` | — | D |
| PY02 | `priority_score` | — | PR08 + 10/3 por 0/1 contactos + 5 si ≥10 vencidas + 5 si ≥365 días + 5 si >1 persona, acotado a 100 (`back/services/scoring_service.py:139-167`) — fórmula distinta de FO13 | puntos 0–100 | `computed_at` | La falta de contacto suma prioridad (faltante como severidad) | D |
| PY03 | `case_group`, `tags` | — | Grupos y etiquetas por PR08, contactos, vencidas y antigüedad (`back/services/scoring_service.py:175-235`) | categoría | `computed_at` | `no_contact` se etiqueta además `data_quality_issue` (correcto como bandera, no como severidad) | D |

### 7.11 Dimensiones ausentes (no inferibles con esta cartera)

| ID | Variable | Estado | Regla |
|---|---|---|---|
| AU01 | Vulnerabilidad / situación social | `NO_INFORMADO_EN_ORIGEN` | Se muestra "Vulnerabilidad: no informada". Solo puede bajar intensidad o exigir revisión, nunca subirla `[P0156]`. Prohibido inferirla del domicilio, tipo de persona, documento o deuda |
| AU02 | Hogar, composición, ingresos | `NO_INFORMADO_EN_ORIGEN` | No modelado ni inferido (§2) |
| AU03 | Pagos, planes, gestiones y sus resultados | `NO_INTEGRADO` | Sin tabla de eventos; PR07 no prueba ausencia de gestión. Destino propuesto `action_log`/`payment_event` (ALIGN-061); en la demo solo **S** |
| AU04 | Estado jurídico, prescripción | `NO_INFORMADO_EN_ORIGEN` | Solo bandera `VERIFICAR_PRESCRIPCION`; nunca se afirma prescripción (ALIGN-008) |
| AU05 | Validez y consentimiento de contactos | `NO_INTEGRADO` | Contacto "no verificado" hasta su verificación |
| AU06 | Costo de cada acción | `NO_INFORMADO_EN_ORIGEN` | Parámetro con fuente o supuesto declarado (ALIGN-034) |
| AU07 | Totales de control `Deuda_Actualizada`, `Deuda_Capital`, `Periodos_Deuda` | `NO_INTEGRADO` | Columnas de cabecera esperadas pero no cargadas (`back/ETL/inspect_tsv.py:28-31`); insumo del validador (ALIGN-024) |
| AU08 | Domicilio como factor | `NO_APLICA` como factor | Se carga para identificación (`address`, `city`, `province`), pero está **prohibido** como factor de prioridad, segmentación o analítica (plan v2 §7.1) |

### 7.12 Adaptación de reglas v1 — ALIGN-010

Esta adenda registra el contrato implementado por ALIGN-010. Las filas históricas
FO10–FO14 describen la base anterior: los nombres `risk`/`riskScore` de objetos
pasan a ser alias de la **severidad v1** y `priorityScore` es la prioridad 0–100
**dentro de la cola**, sin sumar contacto ni recomendación. El índice persistido
no alimenta ninguna decisión. Los importes y estados históricos de FO01/FO02 y
DE10 se conservan separados de los insumos evaluables de la decisión; nunca se
usan para sustituir `current_amount`, `due_date`, `estado_origen` o `periodo_fiscal`.
Ver [implementación y procedencia](reglas-decision-v1.md#17-adaptador-web--align-010)
y [catálogo v1, adenda ALIGN-010](catalogo-indicadores-v1.md#16-adenda-align-010-colas-y-dimensiones-v1).

El adaptador de **objetos** lee exclusivamente `current_amount`: si falta la
clave, informa `NO_INTEGRADO`; no la sustituye por `updated_amount` ni otros
alias. La compatibilidad con alias descrita en DE06 y §9 regla 2 queda para
el mapeador de **personas**, que conserva el selector general de importes.

| ID | Variable | Rótulo | Fuente → fórmula | Unidad | Corte | Faltantes | Clase |
|---|---|---|---|---|---|---|---|
| DV01 | `DebtorListItem.decision` | Intervención / prioridad | Salida completa de `evaluateDecisionRulesV1`; incluye severidad, banderas, vulnerabilidad no informada, intensidad, revisión, prioridad y explicación | puntos 0–100, códigos e intensidad 0–4 (máximo automático 2), **no %** | `decisionAsOf` | null ante lectura incompleta, corte no evaluable o entrada fuera de contrato; los importes individuales inválidos producen severidad parcial/no disponible según v1 | D |
| DV02 | `DebtorListItem.decisionInput`, `DebtorDebtItem.ruleInput` | — (trazabilidad del adaptador) | Insumos normalizados con los cinco estados; `status`, `period`, `issue_date` y `last_collection_date` heredados nunca sustituyen a campos de origen | datos tipados con presencia | `decisionAsOf` | `decisionInput` null si no se puede construir una entrada completa de obligaciones/corte o falla la lectura de relaciones `debtor_person`; registra `personas: NO_INTEGRADO: LECTURA_FALLIDA`, sin enviar una lista vacía ficticia al núcleo. Un dato individual no observado conserva null y su estado | D |
| DV03 | `DebtorListItem.decisionAsOf`, `DebtorListItem.decisionAsOfSource` | Corte del manifiesto / Fecha de cálculo usada | `RawDebtorDataBundle.batch.as_of`; si no hay manifiesto, fecha UTC de `decisionComputedAt` con aviso “corte de origen no informado” | fecha y procedencia | — | Un manifiesto presente con corte inválido o vacío bloquea la evaluación: no se sustituye silenciosamente | O/D |
| DV04 | `DebtorListItem.decisionComputedAt` | Decisión calculada el | Una captura de reloj UTC por lectura; inyectable para reproducir | fecha-hora UTC | — | Fecha de cálculo, nunca evidencia del corte municipal ni del momento del perfil persistido | D |
| DV05 | `DebtorListItem.rulesVersion` | Reglas v1.0.0 | `RULES_VERSION` del JSON compartido | versión | — | Siempre informada por el adaptador | D |
| DV06 | `DebtorListItem.decisionIssues`, `DebtorDebtItem.decisionIssues` | Motivos de datos no evaluables | Campo, clave interna de obligación cuando corresponda, estado y código de motivo; sin valores personales crudos | lista de motivos | `decisionAsOf` | Lista vacía si no hay incidencias; fracciones de centavo → INVALIDO, nunca redondeo/cero | D |

## 8. Mapa de nombres heredados

Los nombres de columnas **no se cambian** (exclusión de ALIGN-007). Este mapa fija su significado y el rótulo que corresponde en pantalla (ALIGN-012 lo aplica).

| Nombre heredado | Significado correcto | Rótulo correcto | Evidencia |
|---|---|---|---|
| `socioeconomic_risk_level` | **Índice heredado de severidad v0** (no social): monto relativo al promedio del lote, mora, antigüedad, contactos y personas. No es vulnerabilidad ni probabilidad de pago | "Índice heredado de severidad (no social)" | `back/ETL/transform.py:535-597` |
| `debtor_person.priority` | **Porcentaje declarado** en origen (`Destinatario_Porcentaje`) | "Porcentaje declarado en origen", con aviso si la suma ≠100 | `back/ETL/transform.py:351`; pantalla "Prioridad de contacto" en `front/app/debtors/[debtorId]/page.tsx:210` |
| `debt.period` | **ID externo** de la obligación (`DEUD_id`), no período fiscal | "ID externo de la obligación" | `back/ETL/transform.py:378` |
| `debt.issue_date` / `debt.last_collection_date` | **Fecha de actualización de origen** (`Fecha_Actualizacion`, `source_updated_at`), no emisión ni gestión | "Actualización en origen" (o no mostrar) | `back/ETL/transform.py:763-777` |
| `debtor_profile.previous_contact_count` / `previous_response_count` (`previous_*_count`) | **No integrado**: el valor almacenado es el defecto de la base | "No integrado" | `supabase/migrations/20261021220156_equitas_testing_schema.sql:129-130` |
| `debt.status` | **FK al catálogo `debt_status`**; hoy inferida por vencimiento, no el estado de origen | Etiqueta del catálogo; `UNKNOWN` si falta el estado de origen | `back/ETL/transform.py:266-279`, `supabase/migrations/20261021220156_equitas_testing_schema.sql:332` |
| `debtor` (tabla) | Objeto tributario | "Objeto" | §2 |
| `DebtorProfileSummary.socioeconomicLevel` / "Nivel socioeconomico / riesgo" | Vulnerabilidad no informada, separada del índice de severidad | "Vulnerabilidad: no informada" en bloque propio | `front/lib/services/debtor-data-service.ts:41`, `front/app/debtors/[debtorId]/page.tsx:366` |
| `debtor_profile_detail.risk_value` / "Riesgo individual" | Índice heredado del objeto con ajustes por persona; para una persona con varios objetos, el máximo entre ellos | "Máxima severidad entre sus objetos" | `back/ETL/transform.py:694`, `front/lib/mappers/person-risk-mapper.ts:146-149` |
| `PersonListItem.totalDebtAssociated` / "Deuda total asociada" | Exposición asociada no aditiva | "Exposición asociada (no aditiva)" | §3 |
| `DebtorListItem.priorityScore` / "Score / prioridad" | Puntaje operativo heredado 0–172 del frontend, distinto de `priority_score` de Python (0–100) | Reemplazado por la prioridad operativa 0–100 de ALIGN-008 | `front/lib/mappers/debtor-object-mapper.ts:120-147`, `back/services/scoring_service.py:139-167` |

## 9. Reglas para mapeadores (las aplica ALIGN-011)

1. **Cero conservado**: un numérico observado igual a 0 se conserva. No se usa `||` ni ningún reemplazo por "falsy" para numéricos; la ausencia se detecta por columna ausente o valor nulo y produce el estado de §4.
2. **Importe actual**: se lee `current_amount` (o `updated_amount`, generado e idéntico en el original). Nunca se sustituye por `original_amount`.
3. **Error ≠ 0**: un valor no interpretable produce `INVALIDO`, no 0 (ALIGN-011 usa `front/lib/data-presence.ts`: null + `INVALIDO`; el parser heredado no alimenta estos mapeadores).
4. **Estado por catálogo**: el estado de la obligación se resuelve por la FK `debt.status` contra `debt_status`; `key` decide `UNKNOWN` y `OVERDUE`, y `value` es la etiqueta visible (respaldo semántico solo si falta `key`). Sin estado de origen → `UNKNOWN`, sin inferir "Vencida"/"Vigente". ALIGN-011 c1 conserva el desglose de faltantes hasta los KPI; los conteos de objetos cuentan cada objeto incompleto una vez por estado.
5. **Lectura fallida**: ante un `DataWarning` de una tabla, los indicadores que dependen de ella son "no disponible".
6. **Persona sin detalle de perfil**: "no disponible" (`NO_INTEGRADO`), nunca riesgo 0 ni banda BAJO.
7. **Totales por objeto**: los totales sobre conjuntos de personas se deduplican por objeto (§3); la exposición individual se rotula "no aditiva".
8. **Faltante no suma severidad**: la falta de contacto o de perfil es una bandera de calidad, no un incremento de riesgo ni de prioridad.
9. **Valores por defecto prohibidos**: no se reemplaza un faltante por un texto que parezca dato ("Media", "No especificada", "Sin estado", "En gestion", "Sin periodo"); se muestra el estado de §4.
10. **Procedencia temporal**: un valor persistido se expone con su `computed_at` real (`profile_generated_at` para perfiles) o como "momento de cálculo desconocido"; solo lo recalculado con el reloj de la consulta se rotula "calculado al día de la consulta" (§5.1).
11. **Identidad**: los DTO y enlaces usan la clave interna (`id`/FK); la clave externa (`external_id`) se expone, si hace falta, en un campo propio rotulado como identificador municipal, nunca en lugar del `id` (§2).

## 10. Brechas del código actual frente a este contrato

| Brecha (@36f35b4) | Evidencia | Ticket que la corrige |
|---|---|---|
| 0 reemplazado por otro importe con `||` | `front/lib/mappers/debtor-object-mapper.ts:188-195`, `445-459`; `front/lib/mappers/person-risk-mapper.ts:108-122` | ALIGN-011 |
| Importe o fecha ilegible → 0 / nula | `back/ETL/transform.py:142-177`; `front/lib/parsers/numeric-value-parser.ts:6-18`; `front/lib/parsers/date-value-parser.ts:23-31` | ALIGN-024 (origen), ALIGN-011 (frontend) |
| Persona sin detalle → 0 y BAJO | `front/lib/mappers/person-risk-mapper.ts:252` | ALIGN-011 |
| Exposición sumada entre personas | `front/app/people/page.tsx:101-104` | ALIGN-011 |
| Porcentaje o promedio con base vacía mostrado como 0 % / 0; recomendación dominante con 0 objetos; serie vacía dibujada como barra 0 o anillo 100 % | VP01–VP04, VP12, VP13; AG14–AG17 | ALIGN-011 (valores), ALIGN-012 (pantallas) |
| Valores persistidos sin momento de cálculo en pantalla (`profile_generated_at` no se lee) | §5.1; `front/lib/mappers/debtor-object-mapper.ts:434-476` | ALIGN-011 |
| Falta de contacto suma riesgo/prioridad (+15 ETL, +10 Python, fallback 55 frontend) y resta −6 en el puntaje frontend | `back/ETL/transform.py:577-582`; `back/services/scoring_service.py:150-153`; `front/lib/services/debtor-risk-calculator.ts:121-127`; `front/lib/mappers/debtor-object-mapper.ts:136` | ALIGN-008 |
| Índice relativo al promedio del lote y antigüedad contra `date.today()` | `back/ETL/transform.py:512-523`, `535-597`; `back/ETL/run_etl.py:343-358` | ALIGN-008, ALIGN-010 |
| Rótulos engañosos ("Prioridad de contacto", "Periodo", "Nivel socioeconomico / riesgo", cifras fijas del ingreso) | §8; `front/app/login/page.tsx:9-24` | ALIGN-012 |
| `period` = `DEUD_id`, fechas de origen como emisión/gestión, estado inferido | `back/ETL/transform.py:266-279`, `378`, `763-777` | ALIGN-024 (contrato de origen); migración propuesta en ALIGN-017 |

## 11. Revisión cruzada contra el informe de input

| Hallazgo del informe (§3 / §5) | Cobertura en este contrato |
|---|---|
| §3 Las 56 286 obligaciones figuran OVERDUE (estado inferido) | DE10, §8 `debt.status`, §9 regla 4 |
| §3 Contactos cargados ≠ válidos; 1568 de 2933 objetos sin contacto activo | CO01–CO03, FO08–FO09, AU05 |
| §3 Objetos con varias personas y personas con varios objetos | §2, §3, FP04, AG14 |
| §3 27 objetos con porcentajes que no suman 100 | §3 regla 4, RE01 |
| §3 Tipo de persona UNKNOWN en 1242 personas | PE04 |
| §3 Fecha de nacimiento nula en todas las personas | PE06 |
| §3 Perfiles generados entre 30/09 y 02/10/2026 | L04, §5, §5.1 (rótulo de valores persistidos) |
| §3 `previous_*_count` en 0 en los 2933 perfiles, sin alimentarse | PR07, §8, AU03 |
| §3 `socioeconomic_risk_level` entre 25 y 100, no calibrado | PR08, §8 |
| §5 Período fiscal sin contrato (`period = external_id`) | DE02, §8 |
| §5 Fechas con significado mezclado (`issue_date > due_date`, `last_collection_date = issue_date`) | DE08–DE09, §5 |
| §5 Estado inferido por vencimiento | DE10 |
| §5 Perfil temporal: edades persistidas difieren del recálculo | §5, §5.1, PR04 |
| §5 Riesgo no social | PR08, FO11, §8, AU01 |
| §5 Prioridad no unificada (frontend 0–172, Python 0–100) | FO13, PY02, §8 |
| §5 Gestión sin historia comprobada | PR07, AU03 |
| §5 Contactabilidad limitada | FO09, AG04, AG17 |
| §5 Relaciones y duplicación económica | §3, FP04, AG14 |
| §5 Procedencia insuficiente (`data_source` vacía, tenant "Demo") | L01, L03 |
| §5 Identidad multitenant (`person.external_id` global) | §2, PE00 (clave interna), PE01 (clave externa) |
| §5 Original y migración de testing difieren (`updated_amount` generado vs numérico) | DE06, §9 regla 2 |
| §5 Importes actuales sin ceros ni negativos en la carga | §4 (cero real `OBSERVADO`), §9 regla 1: se prueba con datos sintéticos |

## 12. Control de versiones

| Versión | Fecha | Cambio |
|---|---|---|
| v1 | 28/10/2026 | Versión inicial (ALIGN-007). Provisional hasta la homologación del significado de origen por el custodio (ALIGN-004) |
| v1 (corrección 1) | 29/10/2026 | Revisión independiente de ALIGN-007: inventario de cálculos de páginas y componentes (§7.9) y separación de AG08/VP07; claves internas separadas de las externas (§2, OB01/OB02, DE00/DE01, PE00/PE01, CO04); procedencia temporal y rótulos (§5.1); AG07 dividido en AG07a–c; reglas de agregación (§4.1) |
| v1 (adenda ALIGN-018) | 30/10/2026 | §13: decisión humana, aprobación y lote, solo base local. DE06 refleja `updated_amount` generado en la base local (ALIGN-017); `as_of` y `source_updated_at` nombran su destino en `import_batch` |
| v1 (adenda ALIGN-018, corrección 1) | 31/10/2026 | Revisión independiente de ALIGN-018: antecedente siempre anterior en las cadenas; límite de `reason_text` sobre lo almacenado; `supervisor` no registra lotes; límites y claves de `counts` |
| v1 (adenda ALIGN-026) | 02/11/2026 | §14: semántica de la carga V1 en la base local. Prevalece sobre las columnas de faltantes y las brechas de §5, §7.1–§7.5, §8 y §10 para los campos que lista |

## 13. Decisión humana, aprobación y lote (ALIGN-018)

Tablas append-only `case_review`, `case_review_approval` e `import_batch`, **solo en la base local**. Clase **S**: hoy solo reciben datos sintéticos. Hasta que ALIGN-020 y ALIGN-026 las alimenten, ninguna pantalla ni carga las lee. Roles, funciones y credencial: [`SUPABASE_TESTING_CALIDAD.md`](../../SUPABASE_TESTING_CALIDAD.md). La unidad es el objeto tributario (§2). Una corrección o un cambio de estado es una fila nueva con `supersedes`: la fila vigente es la que ninguna otra reemplaza. El antecedente existe en el mismo tenant (y objeto o revisión) y es siempre anterior: una cadena no puede cerrarse sobre sí misma.

| Variable | Significado | Quién la fija | Faltantes y límites |
|---|---|---|---|
| `case_review.tenant`, `case_review.debtor` | Municipio y objeto. La FK compuesta impide cruzar tenants | Servidor, verificado por la función | Obligatorios |
| `case_review.rules_version`, `case_review.as_of`, `case_review.inputs_hash` | Versión de reglas (`decision-rules`), corte (§5) y SHA-256 de los insumos con que se calculó la sugerencia | Servidor (ALIGN-020 los recalcula) | Obligatorios: sin corte no hay decisión registrable |
| `case_review.suggested_intervention`, `case_review.suggested_intensity`, `case_review.explanation` | Sugerencia de reglas y su explicación. Intensidad 0–2: el sistema nunca sugiere 3 o 4 | Servidor | Obligatorios. Es una sugerencia, no una probabilidad ni un hecho sobre la persona |
| `case_review.decision` | `ACEPTA`, `MODIFICA`, `RECHAZA`, `POSPONE` o `DERIVA` | Persona operadora | Obligatoria |
| `case_review.decided_intervention`, `case_review.decided_intensity` | Lo decidido, intensidad 0–4. `≥3` queda pendiente de supervisor. Es una propuesta o decisión registrada, no una acción ejecutada | Persona operadora | Nulos en `RECHAZA` y `POSPONE`, y opcionales en `DERIVA`: nulo significa "sin intervención decidida", nunca intensidad 0 |
| `case_review.reason_code` | Código de motivo | Persona operadora | Obligatorio si la decisión no es `ACEPTA` |
| `case_review.reason_text` | Texto libre de hasta 500 caracteres contando los espacios, con advertencia de no incluir datos personales. Se guarda sin normalizar y no puede quedar en blanco | Persona operadora | **Excluido por defecto** de evidencias y exportaciones: ningún rol de cliente lo lee (regla al pie de esta sección) |
| `case_review.checklist`, `case_review_approval.checklist` | Lista de control de ALIGN-003: `situacion_hogar` (`CONSULTADA` o `NO_DISPONIBLE`) y tres casillas booleanas | Persona | Sin texto sobre el hogar. `NO_DISPONIBLE` no es un dato del hogar ni autoriza a inferirlo (§2, AU02) |
| `case_review.reviewer`, `case_review.reviewer_role`, `case_review.created_at` | Quién decidió, con qué rol en ese momento y cuándo (hora de la base) | Base de datos, a partir de la membresía activa | Obligatorios; el rol no cambia si luego cambia la membresía |
| `case_review_approval.decision`, `case_review_approval.reason_code`, `case_review_approval.approver`, `case_review_approval.approver_role` | Aprobación u objeción de un supervisor distinto de quien propuso esa versión o una anterior de la cadena | Supervisor y base de datos | El motivo es obligatorio en `OBJETA`. Sin fila de aprobación, la decisión `≥3` sigue pendiente, no aprobada |
| `import_batch.source`, `import_batch.file_hashes` | Canal de carga (código) y SHA-256 por archivo | Servidor | Sin rutas ni nombres de archivo |
| `import_batch.as_of`, `import_batch.source_updated_at` | Corte certificado y actualización de origen (§5) | Manifiesto del lote | `source_updated_at` nulo = `NO_INFORMADO_EN_ORIGEN` |
| `import_batch.rules_version`, `import_batch.counts`, `import_batch.status` | Versión de reglas, conteos y estado (`RECIBIDO`, `VALIDADO`, `CONFIRMADO`, `PUBLICADO`, `FALLIDO`, `DESCARTADO`, `REQUIERE_NUEVO_PREVIEW`) | Servidor | Los conteos son enteros no negativos con claves en código: no admiten texto, ni como valor ni como clave. Un conteo ausente se omite y no es 0 (§4) |
| `import_batch.created_by`, `import_batch.created_by_role`, `import_batch.created_at` | Quién registró el lote, con qué rol en ese momento y cuándo | Base de datos, a partir de la membresía activa | Solo `importador` o `importador_sistema`: `supervisor` no adquiere el permiso por serlo |

**Regla de lectura:** las lecturas de `case_review` listan columnas y no incluyen `reason_text`; solo se obtiene con `read_case_review_reason_text`, para quien decide o supervisa en ese tenant.

## 14. Semántica de la carga V1 (ALIGN-026)

Vale para lo que carga `python -m ETL.run_etl --execute`, **solo en la base local**, y prevalece sobre lo que §5, §7.1–§7.5, §8 y §10 describen @36f35b4 para estos campos. **No corrige datos ya cargados en el original**, que conservan la semántica heredada. Un mismo nombre de columna significa aquí lo que dice el origen a la fecha de corte del lote. Detalle del archivo: [`contrato-origen-v1.md` §9](contrato-origen-v1.md).

| ID | Variable | Fuente → regla en la carga V1 | Faltantes | Clase |
|---|---|---|---|---|
| L03 | `import_batch.as_of` | `--cut-off`, obligatorio con `--execute` e igual a la fecha que declara el perfil. Edades y "vencida" se calculan contra él, nunca contra el reloj | Sin corte no hay carga (`CUT_OFF_REQUIRED`) | O |
| L05 | `import_batch.source_updated_at` | Mayor `Fecha_Actualizacion` de las cabeceras aceptadas | Ausente o centinela → nula = `NO_INFORMADO_EN_ORIGEN` | O (semántica P) |
| L02, DE12 | `debt.currency` | `moneda` del perfil → `currency.code` | Clave ausente: no hay carga (`CATALOG_KEY_MISSING`) | O |
| OB02, DE01, PE01 | `debtor.external_id`, `debt.external_id`, `person.external_id` | Texto → decimal canónico de bigint no negativo. No se quitan ceros ni caracteres | No canónico → `INVALIDO`, objeto en cuarentena, sin colapsar con el canónico | O |
| OB03 | `debtor.type` | `Bien_Tipo_Id` → valor declarado en el perfil → `debtor_type.key` | Fuera de catálogo → `INVALIDO`, cuarentena | O |
| OB06 | `debtor.status` | `Estado` → verdadero/falso con el catálogo del contrato | Vacío → nulo = `NO_INFORMADO_EN_ORIGEN`, no activo | O (P) |
| DE02 | `debt.period` | Período de origen si existiera. El contrato v1 no declara esa columna: hoy siempre nulo. Nunca `DEUD_id` | Nulo = `NO_INFORMADO_EN_ORIGEN`; `DEUD_id` no es período | A (P) |
| DE04, DE05 | `debt.original_amount`, `debt.current_amount` | `NOTD_capital`, `NOTD_totalActualizado`, exactos con dos decimales, sin `float` | Vacío o inválido → `INVALIDO`/`NO_INFORMADO_EN_ORIGEN` y nunca se guardan. Fracción de centavo → `INVALIDO`. Cero observado se conserva | O |
| DE08, DE09 | `debt.issue_date`, `debt.last_collection_date` | Nulas: no hay fuente real. `Fecha_Actualizacion` ya no se copia aquí | `NO_INTEGRADO` | A |
| DE10 | `debt.status` | Estado de origen con el catálogo del lote → `debt_status.key`, con `SUSPENDED`. "Vencida" = `PENDIENTE` con vencimiento anterior al corte | Sin estado → `UNKNOWN`, nunca inferido por vencimiento | O (semántica P) |
| PE05 | `person.document_type` | `CUIT` solo si el documento tiene 11 dígitos, prefijo conocido y dígito verificador correcto; si no, `UNKNOWN`. Validez ante el organismo no verificada | Sin documento o sin esa estructura → `UNKNOWN` | D |
| PE07 | `person.status` | `UNKNOWN`: el origen no lo informa | `NO_INTEGRADO` en origen | A |
| RE01 | `debtor_person.priority` | `Destinatario_Porcentaje`, exacto | Vacío → nulo, no 0 | O (semántica P) |
| CO01, CO03 | `debtor_contact.value`, `debtor_contact.active` | Solo valores con formato utilizable. Baja explícita → `active=false` | Marcador o formato ilegible: no se carga. Activo sigue sin significar verificado | O; validez A |
| PR01 | `debtor_profile.total_debt_amount` | Σ `current_amount` de las obligaciones del objeto, incluidas las pagadas, anuladas y suspendidas, porque así lo define el oráculo | Sin obligaciones → 0 derivado (§4.1) | D |
| PR02, PR03 | `debtor_profile.overdue_debt_amount`, `debtor_profile.overdue_debt_count` | Σ y conteo de las obligaciones vencidas al corte | Un estado `UNKNOWN` no se cuenta como vencida; su cantidad está en `import_batch.counts.estados_al_corte` | D |
| PR04 | `debtor_profile.oldest_debt_days`, `debtor_profile.average_debt_age_days` | Máximo y promedio, redondeado a entero medio hacia arriba, de los días de atraso al corte de las vencidas | Sin vencidas → nulos = `NO_APLICA`, nunca 0 | D |
| PR06 | `debtor_profile.available_contact_count` | Contactos activos con formato utilizable de las personas del objeto en este lote | Cero observado derivado | D |
| PR08 | `debtor_profile.socioeconomic_risk_level` | **No se calcula.** Nulo: dependía del promedio del lote. La severidad la calculan las reglas v1 al leer (ALIGN-008) | Legado del original; nulo aquí = `NO_INTEGRADO` | A |
| PR09, PR10 | `debtor_profile_detail.risk_value`, `debtor_profile_detail.reason` | **No se calcula.** Una fila por relación, con `risk_value` nulo y `reason` que lo declara: derivaba de PR08 | Nulo, nunca 0 ni BAJO. El mapeador actual lo presenta como no informado (§9 regla 6) | A |

`import_batch` (§13) recibe los eventos de cada carga: `VALIDADO` → `PUBLICADO`, o `FALLIDO` si el lote se bloquea o la carga falla, con hashes de archivo, mapeo y contrato, conteos, corte y versión de reglas. Quien lo escribe es `equitas_import_server`, con un actor `importador_sistema`. **Pendiente de otros tickets:** los adaptadores de decisión (`back/services/decision_input.py`, `front/lib/mappers/debtor-object-mapper.ts`) siguen declarando `estado_origen`, `periodo_fiscal` y `source_updated_at` como `NO_INTEGRADO`, aunque el estado y la actualización ya tienen destino; conectarlos no pertenece a este carril. La semántica real de período y estado sigue siendo **P** hasta la homologación (ALIGN-046).
