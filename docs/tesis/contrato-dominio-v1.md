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

| Unidad | Tabla | Clave | Qué es | Qué **no** es |
|---|---|---|---|---|
| Municipio (tenant) | `tenant` | `id` | Jurisdicción que exporta la cartera | No viene en el archivo: hoy es `tenant=1` fijo (`back/ETL/config.py:21-22`) |
| Objeto tributario | `debtor` | `(tenant, type, external_id)` | Cuenta tributaria (RODADO, AGUA, INMUEBLE) sobre la que recaen obligaciones. **Unidad central** de totales, perfiles y colas | No es una persona ni un hogar, aunque la tabla se llame `debtor` |
| Obligación | `debt` | `(debtor, external_id)` | Registro individual de deuda (`DEUD_id`) con importe, vencimiento y estado | No es un período fiscal: `debt.period` hoy copia el ID (§8) |
| Persona | `person` | `external_id` (único global) | Destinatario/responsable informado en origen | No es un hogar; su identidad no está acotada por municipio (`supabase/migrations/20261021221030_active_membership_rls.sql:38,42`) |
| Relación persona–objeto | `debtor_person` | `(debtor, person)` | Vínculo con rol declarado (`role`) y **porcentaje declarado** (`priority`) | No es una prioridad de gestión ni prueba por sí sola una cuota legal de responsabilidad |
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
| `OBSERVADO` | El valor llegó del origen (o se derivó de valores observados con una regla de este contrato) y es válido. Incluye el **cero real** | valor tipado; `0` solo si el origen informó 0 | `NOTD_totalActualizado` informado como `0,00` → importe 0 observado |
| `NO_INFORMADO_EN_ORIGEN` | El archivo municipal no trae la columna, o la trae vacía para esa fila | valor `null` + estado | Vulnerabilidad, hogar, ingresos, fecha de nacimiento (nula en las 2493 personas), estado de origen de la obligación cuando, una vez integrado, el archivo no trae `NOTD_ESTA_id`/`NOTD_SITU_id` |
| `NO_INTEGRADO` | El dato existe o podría existir en origen, pero EQUITAS no lo carga, no lo lee o no tiene dónde guardarlo | valor `null` + estado | `previous_contact_count`/`previous_response_count` (siempre en el valor por defecto de la base), pagos, gestiones, `as_of` del lote, totales de control `Deuda_Actualizada`/`Periodos_Deuda` |
| `INVALIDO` | El valor llegó pero no se puede interpretar (importe ilegible, fecha imposible, código fuera de catálogo) | valor `null` + estado + código de motivo; el valor crudo no se muestra si es personal | `NOTD_capital = "abc"`, `NOTD_vencimiento = "31/02/2024"` |
| `NO_APLICA` | El dato no tiene sentido para esa unidad por definición | valor `null` + estado | Días de atraso de una obligación no vencida; porcentaje declarado de un objeto sin relaciones; fecha de nacimiento de una persona jurídica |

Reglas obligatorias (plan v2 §7.4):

- **Ninguna ausencia se representa ni se interpreta como 0**, como cadena vacía, como "Sin estado"/"Media"/"No especificada" ni como categoría de riesgo. El 0 solo es válido como valor `OBSERVADO`.
- Un faltante **nunca suma severidad**, nunca se convierte en "bajo riesgo" y nunca da lugar a una inferencia social.
- Un faltante se **muestra** como tal ("no informado", "no integrado", "inválido", "no aplica") y se **cuenta** aparte en los agregados (por ejemplo, "n objetos con importe inválido"), en lugar de sumarse como 0.
- Un agregado cuyo insumo no está `OBSERVADO` en ninguna fila es `NO_INTEGRADO` o `NO_INFORMADO_EN_ORIGEN`, no 0. Si una lectura de tabla falla (`DataWarning`), los indicadores que dependen de ella quedan "no disponible", no 0.

Orden de decisión cuando una fila admite más de un estado: `NO_APLICA` (por definición) → `NO_INTEGRADO` (EQUITAS no lo lee) → `NO_INFORMADO_EN_ORIGEN` (columna ausente o vacía) → `INVALIDO` (valor presente no interpretable) → `OBSERVADO`.

En código, el estado se expresa con el tipo `DataPresence` (`front/types/equitas-domain.ts`); la lista `DATA_PRESENCE_STATES` es la fuente única de los cinco valores y una prueba (`front/tests/unit/domain-contract.test.ts`) verifica que coincida con esta tabla.

## 5. Semántica temporal

| Nombre | Significado | Quién lo fija | Estado hoy (@36f35b4) |
|---|---|---|---|
| `as_of` (corte) | Fecha a la que el municipio certifica el estado exportado. Antigüedad, "vencida", severidad y colas se calculan **respecto de `as_of`** | Manifiesto del lote (cada importación web lo declara) | `NO_INTEGRADO`: no existe. El ETL usa `date.today()` (`back/ETL/transform.py:266-279`, `512-523`) y el frontend `new Date()`/`Date.now()` (`front/lib/parsers/date-value-parser.ts:12-31`) |
| `computed_at` (cálculo) | Momento en que EQUITAS calculó un perfil, un índice o una cola | Sistema | `debtor_profile.profile_generated_at` (`back/ETL/transform.py:648`); los indicadores del frontend se recalculan en cada consulta y no guardan su momento |
| `source_updated_at` (actualización de origen) | Fecha de actualización del registro en el ERP municipal (`Fecha_Actualizacion`) | Archivo de origen | `NO_INTEGRADO` como tal: se guarda en `debt.issue_date` **y** `debt.last_collection_date` (`back/ETL/transform.py:763-777`). Destino propuesto: `import_batch.source_updated_at` |

Consecuencias:

- Un perfil calculado con `computed_at` anterior a la consulta **no es actual**: sus días de antigüedad difieren de un recálculo (informe de input §5, "Perfil temporal"). Mostrarlo exige rotular su `computed_at` y, cuando exista, su `as_of`.
- `issue_date` no es fecha de emisión y `last_collection_date` no es fecha de gestión o cobro: en todas las obligaciones observadas `issue_date > due_date` y `last_collection_date = issue_date`. Ninguna regla puede afirmar que hubo emisión, contacto o cobro a partir de ellas.
- Hasta que exista `as_of`, todo indicador temporal se rotula "calculado al día de la consulta" y su corte es `NO_INTEGRADO`.

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

Columnas: **Variable** (DTO del frontend o `tabla.columna`), **Rótulo** actual en pantalla ("—" si no se muestra), **Fuente → fórmula**, **Unidad**, **Corte** (`as_of` si depende de la fecha de corte; "—" si no depende), **Faltantes** (estado aplicable; "Hoy:" describe el comportamiento @36f35b4 cuando contradice §4), **Clase**.

### 7.1 Lote, municipio y tiempo

| ID | Variable | Rótulo | Fuente → fórmula | Unidad | Corte | Faltantes | Clase |
|---|---|---|---|---|---|---|---|
| L01 | `tenant.id`, `tenant.name` | — | `back/ETL/config.py:21-22` (fijo) | id / texto | — | El municipio real no está declarado en el lote: `NO_INTEGRADO` | D |
| L02 | `currency.id` | — (formato ARS) | `DEFAULT_CURRENCY_ID = 1` (`back/ETL/transform.py:36`) | id de catálogo | — | Moneda no informada por el lote: supuesto ARS | D |
| L03 | `as_of` | — | §5 | fecha | — | `NO_INTEGRADO` | A |
| L04 | `debtor_profile.profile_generated_at` (`computed_at`) | — | `datetime.now(UTC)` al construir el perfil (`back/ETL/transform.py:648`) | fecha-hora UTC | — | Nula si el perfil no se generó: `NO_INTEGRADO` | D |
| L05 | `Fecha_Actualizacion` (`source_updated_at`) | — | Cabecera, vía `ClaveAgrupacion` (`back/ETL/transform.py:747-777`) | fecha | — | Cabecera ausente → `NO_INFORMADO_EN_ORIGEN`; ilegible → `INVALIDO` (hoy ambos quedan nulos en `issue_date`) | O (semántica P) |
| L06 | `DataWarning` | Avisos de lectura (`front/components/equitas/data-warnings.tsx`) | Error de lectura de una tabla (`front/lib/data/raw-debtor-loader.ts`) | mensaje + código | — | Si existe, los indicadores que dependen de esa tabla son "no disponible", no 0 | D |

### 7.2 Objeto tributario

| ID | Variable | Rótulo | Fuente → fórmula | Unidad | Corte | Faltantes | Clase |
|---|---|---|---|---|---|---|---|
| OB01 | `debtor.id`, `DebtorListItem.id` | — (enlaces) | Identidad interna de la base | id | — | Fila sin id se descarta | D |
| OB02 | `debtor.external_id` | — | `Cuenta` (`back/ETL/transform.py:330-339`) | id numérico canónico | — | No numérico → hoy `None`; contrato: `INVALIDO` con rechazo (ALIGN-024) | O (P) |
| OB03 | `debtor.type`, `DebtorListItem.type` | Tipo | `Bien_Tipo_Id` → catálogo `debtor_type` | etiqueta de catálogo | — | Hoy "Sin tipo" (`front/lib/mappers/debtor-object-mapper.ts:498-502`); contrato: `NO_INFORMADO_EN_ORIGEN` o `INVALIDO` si el código no está en el catálogo | O |
| OB04 | `debtor.identifier`, `DebtorListItem.identifier` | Identificador / Objeto | `Identificador` | texto | — | Hoy `OBJ-<id>` (`front/lib/mappers/debtor-object-mapper.ts:503-511`); contrato: `NO_INFORMADO_EN_ORIGEN` con el id interno como referencia rotulada | O |
| OB05 | `debtor.description`, `DebtorListItem.description` | Descripcion | `Bien_Descripcion` | texto | — | Hoy "Objeto de deuda …" (`front/lib/mappers/debtor-object-mapper.ts:512-514`); contrato: `NO_INFORMADO_EN_ORIGEN` | O |
| OB06 | `debtor.status` | — | `Estado` → booleano, vacío → `true` (`back/ETL/transform.py:181-218`, `330-339`) | booleano (vigencia del objeto) | — | Vacío no significa activo: `NO_INFORMADO_EN_ORIGEN` | O (P) |
| OB07 | `DebtorListItem.status` | Estado | Primera etiqueta normalizada de estado de sus obligaciones, o `debtor.status`, o "Vencido"/"En gestion" según deuda vencida (`front/lib/mappers/debtor-object-mapper.ts:515-526`) | etiqueta | `as_of` | Mezcla vigencia del objeto con estado de obligaciones; sin estados → hoy "En gestion" inventado; contrato: `NO_INFORMADO_EN_ORIGEN` | D |

### 7.3 Obligación

| ID | Variable | Rótulo | Fuente → fórmula | Unidad | Corte | Faltantes | Clase |
|---|---|---|---|---|---|---|---|
| DE01 | `debt.external_id`, `DebtorDebtItem.id` | — | `DEUD_id` (`back/ETL/transform.py:357-379`) | id externo | — | No numérico → `INVALIDO` | O |
| DE02 | `debt.period`, `DebtorDebtItem.period` | Periodo | Copia de `DEUD_id` (`back/ETL/transform.py:378`) | — (no es período) | — | El período fiscal real es `NO_INTEGRADO` (¿`Detalle_Deuda`/`Periodos_Deuda`?, P). Hoy, si falta, "Sin periodo" (`front/lib/mappers/debtor-object-mapper.ts:214-220`) | O (semántica P) |
| DE03 | `debt.type` | — | `Tipo_Ingreso_Id` → clave textual de 8 códigos fijos (`back/ETL/transform.py:286-308`) | clave de tributo | — | Código no listado → `unknown_<id>`; contrato: `INVALIDO` con motivo | O |
| DE04 | `debt.original_amount`, `DebtorDebtItem.originalAmount` | Monto original | `NOTD_capital` | ARS | — | Hoy inválido → `0.0` (`back/ETL/transform.py:142-160`) y en el frontend inválido → 0 (`front/lib/parsers/numeric-value-parser.ts:6-18`); contrato: `INVALIDO`, cero real preservado | O |
| DE05 | `debt.current_amount` | — | `NOTD_totalActualizado` | ARS | `source_updated_at` | Igual que DE04 | O |
| DE06 | `debt.updated_amount`, `DebtorDebtItem.updatedAmount` | Monto actualizado | En el original es columna generada desde `current_amount`; en la migración de testing es numérica ordinaria. El frontend lee `updated_amount` y, si da 0 o falta, usa el original (`front/lib/mappers/debtor-object-mapper.ts:188-195`) | ARS | `source_updated_at` | Un 0 observado se **reemplaza** por el original (viola §4). Contrato: leer `current_amount` (o `updated_amount` idéntico), conservar 0, ausente = `NO_INTEGRADO` | O |
| DE07 | `debt.due_date`, `DebtorDebtItem.dueDate` | Vencimiento | `NOTD_vencimiento` (`back/ETL/transform.py:163-177`) | fecha | — | Ilegible → hoy nula; contrato: `INVALIDO` con rechazo | O |
| DE08 | `debt.issue_date` | — | `Fecha_Actualizacion` de cabecera (`back/ETL/transform.py:763-768`) | fecha | — | No es emisión: la fecha de emisión real es `NO_INTEGRADO` | O (semántica P) |
| DE09 | `debt.last_collection_date` | — | `Fecha_Actualizacion` de cabecera (`back/ETL/transform.py:772-777`) | fecha | — | No es gestión ni cobro: la última gestión real es `NO_INTEGRADO` | O (semántica P) |
| DE10 | `debt.status`, `DebtorDebtItem.status` | Estado | FK a `debt_status` (8 claves, `back/ETL/transform.py:39-46`), hoy **inferida** por vencimiento contra `date.today()` (`back/ETL/transform.py:266-279`). En el frontend: etiqueta de catálogo, columna de texto o inferencia por vencimiento (`front/lib/mappers/debtor-object-mapper.ts:199-205`) | etiqueta de catálogo | `as_of` | Estado de origen (`NOTD_ESTA_id`/`NOTD_SITU_id`) `NO_INTEGRADO`; si falta, `UNKNOWN`, nunca "vencida" ni "vigente" inventada. Hoy "Sin estado" si no hay vencimiento | P |
| DE11 | `debt.description` | — | Texto fijo con el `DEUD_id` (`back/ETL/transform.py:371`) | texto | — | `Detalle_Deuda` de origen `NO_INTEGRADO` | D |
| DE12 | `debt.currency` | — | L02 | id | — | L02 | D |

### 7.4 Persona, relación y contacto

| ID | Variable | Rótulo | Fuente → fórmula | Unidad | Corte | Faltantes | Clase |
|---|---|---|---|---|---|---|---|
| PE01 | `person.external_id`, `PersonListItem.id`, `DebtorPersonItem.id`, `DebtorPersonRelation.personId` | — (enlaces) | `Destinatario_Id` (`back/ETL/transform.py:315-326`) | id externo, único global | — | No numérico → `INVALIDO` | O |
| PE02 | `person.full_name`, `DebtorPersonItem.name`, `PersonListItem.name`, `DebtorContactItem.personName` | Nombre / Persona | `Destinatario` | texto personal | — | Hoy "Persona <id>" (`front/lib/mappers/person-risk-mapper.ts:245-248`); contrato: `NO_INFORMADO_EN_ORIGEN` | O |
| PE03 | `person.document_number`, `DebtorPersonItem.document`, `PersonListItem.document` | Documento | `Destinatario_CUIT` | texto personal | — | Hoy "Sin documento"; contrato: `NO_INFORMADO_EN_ORIGEN`. Validez no verificada | O |
| PE04 | `person.type` | — | Inferido por prefijo del CUIT (`back/ETL/transform.py:246-262`) | catálogo `person_type` | — | Prefijo no reconocido → `UNKNOWN` (1242 personas). Nunca es factor de prioridad | D |
| PE05 | `person.document_type` | — | Inferido: documento presente → CUIT (`back/ETL/transform.py:237-242`) | catálogo | — | Sin documento → desconocido | D |
| PE06 | `person.birth_date` | — | Siempre `None` (`back/ETL/transform.py:325`) | fecha | — | `NO_INFORMADO_EN_ORIGEN` (o `NO_APLICA` para personas jurídicas) | A |
| PE07 | `person.status` | — | Siempre activo (`back/ETL/transform.py:326`) | catálogo | — | El estado de origen es `NO_INTEGRADO` | D |
| RE01 | `debtor_person.priority`, `DebtorPersonItem.priority`, `DebtorPersonRelation.priority` | Prioridad de contacto | `Destinatario_Porcentaje` (`back/ETL/transform.py:342-354`) = **porcentaje declarado** | % (0–100) | — | Hoy, si falta, el frontend muestra "Media" (`front/lib/mappers/debtor-object-mapper.ts:261-262`) y el ETL lo lee como 0; contrato: `NO_INFORMADO_EN_ORIGEN`. Suma ≠100 → bandera, sin normalizar | O (semántica P) |
| RE02 | `debtor_person.role`, `DebtorPersonItem.relation`, `DebtorPersonRelation.relation` | Relacion | `Destinatario_Tipo` | texto | — | Hoy "No especificada"; contrato: `NO_INFORMADO_EN_ORIGEN` | O (semántica P) |
| RE03 | `debtor_person.active` | — | Siempre `true` al cargar (`back/ETL/transform.py:353`) | booleano | — | La baja de relaciones en origen es `NO_INTEGRADO` | D |
| CO01 | `debtor_contact.value`, `DebtorContactItem.value`, `DebtorPersonItem.contact` | Valor / Contacto | `Destinatario_Telefono`, `Destinatario_Celular`, `Destinatario_Email` (`back/ETL/transform.py:455-505`) | texto personal | — | Sin valor → no se crea fila. Validez y consentimiento: `NO_INTEGRADO` ("no verificado"). Hoy "Sin contacto" en el resumen por persona | O; validez A |
| CO02 | `debtor_contact.type`, `DebtorContactItem.channel` | Canal | Tipo fijado por la columna de origen; en el frontend, columna explícita o inferencia por `@` (`front/lib/mappers/debtor-object-mapper.ts:87-105`) | catálogo `contact_type` | — | Inferencia por `@` es D, no O | O |
| CO03 | `debtor_contact.active`, `DebtorContactItem.isActive` | Estado | Siempre `true` al cargar | booleano | — | Activo ≠ verificado | D |
| CO04 | `DebtorContactItem.id`, `DebtorContactItem.personId` | — | Identidad interna | id | — | — | D |

### 7.5 Perfil del objeto calculado por el ETL

Todas las columnas de `debtor_profile` son **D** con `computed_at = profile_generated_at` y antigüedad calculada contra `date.today()` del momento de carga (`back/ETL/transform.py:601-650`). Las de `debtor_profile_detail` se construyen en `back/ETL/transform.py:694`.

| ID | Variable | Rótulo | Fuente → fórmula | Unidad | Corte | Faltantes | Clase |
|---|---|---|---|---|---|---|---|
| PR01 | `debtor_profile.total_debt_amount` | (vía DebtorListItem.totalDebt) | Σ `current_amount` del objeto | ARS | `computed_at` | Perfil ausente → `NO_INTEGRADO`, no 0 | D |
| PR02 | `debtor_profile.overdue_debt_amount` | (vía DebtorListItem.overdueDebt) | Σ `current_amount` con estado inferido "vencida" | ARS | `as_of` (hoy fecha de carga) | Depende de DE10 (P) | D |
| PR03 | `debtor_profile.debt_count`, `debtor_profile.overdue_debt_count` | — | Conteo de obligaciones / de obligaciones vencidas inferidas | obligaciones | `as_of` | — | D |
| PR04 | `debtor_profile.oldest_debt_days`, `debtor_profile.average_debt_age_days` | — | Máximo / promedio de días desde `due_date` hasta la fecha de carga (`back/ETL/transform.py:512-523`) | días | `as_of` (hoy fecha de carga) | Vencimiento ilegible → hoy 0 días; contrato: `INVALIDO` | D |
| PR05 | `debtor_profile.active_person_count` | — | Personas con relación activa | personas | — | — | D |
| PR06 | `debtor_profile.available_contact_count` | — | Contactos con valor de las personas del objeto | contactos | — | "Disponible" = con valor, no verificado | D |
| PR07 | `debtor_profile.previous_contact_count`, `debtor_profile.previous_response_count` | — | Ningún código los alimenta ni los lee; quedan en el valor por defecto de la base | gestiones / respuestas | — | **`NO_INTEGRADO`**. El valor almacenado no significa "cero gestiones" | A |
| PR08 | `debtor_profile.socioeconomic_risk_level` | Riesgo (vía DebtorListItem.riskScore) / "Nivel socioeconomico / riesgo" | Índice heredado de severidad v0 (§8): `min(35·deuda/promedio del lote, 60) + min(10·vencida/total, 10) + min(vencidas, 10) + min(15·días/365, 15) + {15, 5, 0} por 0/1/≥2 contactos + 5 si >1 persona`, acotado a 0–100 (`back/ETL/transform.py:535-597`; promedio en `back/ETL/run_etl.py:343-358`) | puntos 0–100 (no %) | `computed_at`, relativo al lote | Total ≤0 → hoy 0; contrato: `NO_APLICA` | D |
| PR09 | `debtor_profile_detail.risk_value`, `PersonListItem.riskValue` | Puntaje / Riesgo individual | PR08 del objeto + 15/3 por 0/1 contactos de la persona + 5 si el rol contiene "responsable" + 5 si el porcentaje declarado ≥75, acotado a 0–100 (`back/ETL/transform.py:694`). El frontend toma el **máximo** entre los objetos de la persona (`front/lib/mappers/person-risk-mapper.ts:127-150`) | puntos 0–100 | `computed_at` | Persona sin detalle → hoy 0 y "BAJO" (`front/lib/mappers/person-risk-mapper.ts:252`); contrato: `NO_INTEGRADO` ("no disponible") | D |
| PR10 | `debtor_profile_detail.reason` | — | Texto explicativo del ajuste (`back/ETL/transform.py:655`) | texto | `computed_at` | — | D |

### 7.6 Indicadores del objeto calculados por el frontend

Se recalculan en cada consulta en `front/lib/mappers/debtor-object-mapper.ts:420-553`; su corte es el reloj del servidor (`as_of` `NO_INTEGRADO`).

| ID | Variable | Rótulo | Fuente → fórmula | Unidad | Corte | Faltantes | Clase |
|---|---|---|---|---|---|---|---|
| FO01 | `DebtorListItem.totalDebt`, `DebtorProfileSummary.totalDebt` | Deuda total / Deuda | PR01 del perfil o, si da 0 o falta, Σ `updatedAmount` (`front/lib/mappers/debtor-object-mapper.ts:445-451`) | ARS por objeto | `computed_at` | Un total 0 observado se reemplaza por la suma (`||`); contrato: 0 se conserva, perfil ausente = `NO_INTEGRADO` | D |
| FO02 | `DebtorListItem.overdueDebt`, `DebtorProfileSummary.overdueDebt` | Deuda vencida | PR02 o Σ `updatedAmount` de obligaciones vencidas (`front/lib/mappers/debtor-object-mapper.ts:453-459`) | ARS por objeto | `as_of` | Igual que FO01 | D |
| FO03 | `DebtorListItem.debtCount`, `DebtorProfileSummary.debtCount` | Cantidad de deudas | Obligaciones leídas del objeto | obligaciones | — | Lectura fallida → "no disponible" | D |
| FO04 | `DebtorListItem.overdueDebtsCount` | — | Obligaciones con estado de texto "venc/mora/atras" o vencimiento anterior a hoy (`front/lib/mappers/debtor-object-mapper.ts:73-85`) | obligaciones | `as_of` | Depende de DE10 (P) | D |
| FO05 | `DebtorListItem.maxDaysOverdue` (`overdueDays` en el tablero) | Atraso / Dias de atraso | Máximo de días desde `dueDate` de obligaciones vencidas (`front/lib/mappers/debtor-object-mapper.ts:460-463`) | días | `as_of` | Sin vencidas → `NO_APLICA` (hoy 0); vencimiento ilegible → hoy 0 (`front/lib/parsers/date-value-parser.ts:23-31`), contrato `INVALIDO` | D |
| FO06 | `DebtorProfileSummary.antiquityDays` | Antiguedad | Días desde el vencimiento más antiguo (`front/lib/services/debtor-data-service.ts:21-36`) | días | `as_of` | Sin vencimientos → hoy 0; contrato: `NO_INFORMADO_EN_ORIGEN` | D |
| FO07 | `DebtorListItem.peopleCount`, `DebtorListItem.peopleIds`, `DebtorListItem.peopleNames`, `DebtorProfileSummary.associatedPeople` | Personas / Personas asociadas | Relaciones activas del objeto | personas | — | Sin relaciones → `NO_INFORMADO_EN_ORIGEN` (todo objeto observado tiene ≥1) | D |
| FO08 | `DebtorListItem.contactCount`, `DebtorProfileSummary.availableContacts` | Contactos disponibles | Máximo entre PR06, personas con contacto activo y contactos activos (`front/lib/mappers/debtor-object-mapper.ts:436-442`): mezcla unidades distintas | contactos o personas (ambiguo) | — | Unificar en ALIGN-011; validez `NO_INTEGRADO` | D |
| FO09 | `DebtorListItem.hasContact` | Contacto / Con contacto | `contactCount > 0` | booleano | — | "Con contacto" = con valor cargado, no verificado | D |
| FO10 | `DebtorListItem.riskScore`, `DebtorListItem.risk`, `DebtorProfileSummary.riskScore`, `DebtorProfileSummary.risk` | Riesgo | PR08 si existe; si no, etiqueta textual (85/55/25) o fallback 78/55/25 por señales, donde **la falta de contacto sube a 55** (`front/lib/services/debtor-risk-calculator.ts:85-134`). Bandas: 0–39 BAJO, 40–69 MEDIO, 70–100 ALTO (`front/lib/services/debtor-risk-calculator.ts:14-29`) | puntos 0–100 / banda | `computed_at` | El fallback convierte un perfil `NO_INTEGRADO` en riesgo inferido y un faltante (contacto) en severidad: viola §4 | D |
| FO11 | `DebtorProfileSummary.socioeconomicLevel` | Nivel socioeconomico / riesgo | Literal "No informado" (`front/lib/services/debtor-data-service.ts:41`) | — | — | Vulnerabilidad `NO_INFORMADO_EN_ORIGEN`; el rótulo junto al riesgo sugiere que el índice es social | A |
| FO12 | `DebtorListItem.recommendationType`, `DebtorListItem.recommendation`, `DebtorListItem.recommendationReason`, `DebtorListItem.isUrgentRecommendation` | Recomendacion | Reglas por banda, contacto, deuda vencida y atraso ≥60 días (`front/lib/services/debtor-recommendation-generator.ts:19-73`) | categoría de acción | `as_of` | Sin contacto + riesgo ALTO → "revision humana" urgente | D |
| FO13 | `DebtorListItem.priorityScore` | Score / prioridad | `min(total/250000, 4)·18 + min(días/30, 4)·10 + {30,18,8} por banda + (contacto ? 10 : −6) + {20,14,9,4} por recomendación`, piso 0 (`front/lib/mappers/debtor-object-mapper.ts:120-147`) | puntos 0–172 (no 0–100) | `as_of` | Hereda los faltantes de FO01, FO05 y FO10 | D |
| FO14 | `DebtorListItem.priorityLevel` | Prioridad | ≥105 ALTA, ≥70 MEDIA, resto BAJA (`front/lib/mappers/debtor-object-mapper.ts:107-117`) | banda | `as_of` | — | D |

### 7.7 Indicadores de personas

| ID | Variable | Rótulo | Fuente → fórmula | Unidad | Corte | Faltantes | Clase |
|---|---|---|---|---|---|---|---|
| FP01 | `PersonListItem.individualRisk` | Riesgo individual | Banda de FO10 aplicada a PR09 | banda | `computed_at` | Sin detalle → hoy "BAJO"; contrato: "no disponible" | D |
| FP02 | `PersonListItem.debtorsCount`, `PersonListItem.debtorIds`, `PersonListItem.debtorIdentifiers` | Objetos / Objetos asociados | Objetos con relación activa | objetos | — | — | D |
| FP03 | `PersonListItem.hasContact` | Contacto disponible | Al menos un contacto activo con valor (`front/lib/mappers/person-risk-mapper.ts:186-233`) | booleano | — | Validez `NO_INTEGRADO` | D |
| FP04 | `PersonListItem.totalDebtAssociated` | Deuda total asociada | Σ total por objeto vinculado (`front/lib/mappers/person-risk-mapper.ts:98-125`, `258-261`) = **exposición asociada no aditiva** (§3) | ARS, no aditivo | `computed_at` | Usa `updated_amount` o, si da 0, el original (mismo defecto que DE06) | D |

### 7.8 Agregados de tablero y listados

| ID | Variable | Rótulo | Fuente → fórmula | Unidad | Corte | Faltantes | Clase |
|---|---|---|---|---|---|---|---|
| AG01 | `DashboardData.totalDebtors` | — (base de porcentajes) | Objetos leídos | objetos | — | Lectura fallida → "no disponible" | D |
| AG02 | `DashboardData.totalDebt` | Deuda total | Σ FO01 por objeto (`front/lib/mappers/dashboard-metrics-mapper.ts:111`) | ARS | `computed_at` | Objetos con total no `OBSERVADO` se cuentan aparte | D |
| AG03 | `DashboardData.overdueCases` | Casos vencidos | Objetos con FO02 > 0 | objetos | `as_of` | — | D |
| AG04 | `DashboardData.withContactCases`, `DashboardData.withoutContactCases` | Con contacto / Casos sin contacto | Objetos por FO09 | objetos | — | "Sin contacto" = sin valor cargado | D |
| AG05 | `DashboardData.priorityCases` | Objetos prioritarios | Objetos con FO14 = ALTA | objetos | `as_of` | — | D |
| AG06 | `DashboardData.urgentRecommendationCases` | Recomendacion urgente | Objetos con FO12 urgente | objetos | `as_of` | — | D |
| AG07 | `DashboardData.criticalCasesToday`, `DashboardData.riskAboveNinetyCases`, `DashboardData.criticalDebtTotal` | — (riesgo-análisis usa el mismo umbral) | FO10 > 90, recomendación urgente o deuda vencida sin contacto (`front/lib/mappers/dashboard-metrics-mapper.ts:98-107`) | objetos / ARS | `as_of` | — | D |
| AG08 | `DashboardData.byDebtStatus` | Deuda por estado | Conteo de obligaciones por DE10 | obligaciones | `as_of` | Estados `NO_INTEGRADO` o `UNKNOWN` en barra propia | D |
| AG09 | `DashboardData.byDebtorType` | Objetos por tipo | Objetos por OB03 | objetos | — | — | D |
| AG10 | `DashboardData.byRisk`, `PeopleDashboardSummary.individualRiskDistribution`, `PeopleDashboardSummary.lowRiskCount`, `PeopleDashboardSummary.mediumRiskCount`, `PeopleDashboardSummary.highRiskCount` | Distribucion por riesgo / Riesgo bajo, medio, alto | Conteo por banda FO10 / FP01 | objetos / personas | `computed_at` | "No disponible" en categoría propia, nunca en BAJO | D |
| AG11 | `DashboardData.byRecommendation` | Recomendaciones sugeridas | Conteo por FO12 | objetos | `as_of` | — | D |
| AG12 | `DashboardData.topDebtChart`, `DashboardData.topDebtors`, `DashboardData.topDebtDebtors`, `DashboardData.topPriorityDebtors`, `DashboardData.withoutContactDebtors` | Top de deuda / A quien gestionar primero / Casos sin contacto | Proyecciones de `DebtorListItem` ordenadas por FO01 o FO13 (`overdueDays` = FO05) | objetos | `as_of` | Heredan los de sus campos | D |
| AG13 | `PeopleDashboardSummary.totalPeople`, `PeopleDashboardSummary.withoutContactCount`, `PeopleDashboardSummary.topPeopleByRiskValue` | Sin contacto / Top 5 personas con mayor riesgo | Conteos y orden por PR09 (`front/lib/mappers/person-risk-mapper.ts:28-68`) | personas | `computed_at` | — | D |
| AG14 | "Deuda asociada" y "Riesgo promedio" de personas filtradas | Deuda asociada | Σ FP04 y promedio de PR09 de las personas filtradas (`front/app/people/page.tsx:101-108`) | ARS / puntos | `computed_at` | **Suma exposiciones no aditivas** (viola §3); sin personas → hoy 0 | D |
| AG15 | Resumen por recomendación (`buildRecommendationSummary`) | Cantidad de casos / Deuda asociada / Riesgo promedio | Conteo, Σ FO01 y promedio de FO10 por FO12 (`front/lib/equitas-view-selectors.ts:115-134`) | objetos / ARS / puntos | `as_of` | Promedio sin casos → hoy 0; contrato: `NO_APLICA` | D |
| AG16 | Resumen de antigüedad (`buildDebtAgingSummary`) | Deuda total / Deuda vencida / Promedio de atraso / Distribucion por atraso | Σ FO01, Σ FO02, promedio de FO05 sobre objetos con deuda vencida, bandas 0 / 1–30 / 31–90 / +90 días (`front/lib/equitas-view-selectors.ts:71-113`) | ARS / días / objetos | `as_of` | Promedio sin casos → hoy 0 (`NO_APLICA`); FO05 `NO_APLICA` hoy cae en "Sin atraso" | D |
| AG17 | Métricas de casos sin contacto | Total sin contacto / Deuda asociada / Riesgo alto sin contacto / Sobre el total | Conteo, Σ FO01, conteo con FO10 ALTO y proporción sobre AG01 (`front/app/no-contact/page.tsx`) | objetos / ARS / % | — | Base 0 → `NO_APLICA` | D |
| AG18 | Cifras de la pantalla de ingreso | Casos criticos / Sin contacto / Deuda gestionada | Literales fijos en código (`front/app/login/page.tsx:9-24`) | — | — | **No son datos**: no hay ningún dato de gestión (`NO_INTEGRADO`). Retirar o rotular "ilustrativo" (ALIGN-012) | S |

### 7.9 Reglas de prioridad en Python (servicio de scoring)

| ID | Variable | Rótulo | Fuente → fórmula | Unidad | Corte | Faltantes | Clase |
|---|---|---|---|---|---|---|---|
| PY01 | `risk_band` | — | PR08: ≥75 critical, ≥50 high, ≥25 medium, resto low (`back/services/scoring_service.py:108-118`) — bandas distintas de FO10 | banda | `computed_at` | — | D |
| PY02 | `priority_score` | — | PR08 + 10/3 por 0/1 contactos + 5 si ≥10 vencidas + 5 si ≥365 días + 5 si >1 persona, acotado a 100 (`back/services/scoring_service.py:139-167`) — fórmula distinta de FO13 | puntos 0–100 | `computed_at` | La falta de contacto suma prioridad (faltante como severidad) | D |
| PY03 | `case_group`, `tags` | — | Grupos y etiquetas por PR08, contactos, vencidas y antigüedad (`back/services/scoring_service.py:175-235`) | categoría | `computed_at` | `no_contact` se etiqueta además `data_quality_issue` (correcto como bandera, no como severidad) | D |

### 7.10 Dimensiones ausentes (no inferibles con esta cartera)

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
3. **Error ≠ 0**: un valor no interpretable produce `INVALIDO`, no 0 (`front/lib/parsers/numeric-value-parser.ts:6-18` hoy devuelve 0).
4. **Estado por catálogo**: el estado de la obligación se resuelve por la FK `debt.status` contra `debt_status`; sin estado de origen → `UNKNOWN`, sin inferir "Vencida"/"Vigente".
5. **Lectura fallida**: ante un `DataWarning` de una tabla, los indicadores que dependen de ella son "no disponible".
6. **Persona sin detalle de perfil**: "no disponible" (`NO_INTEGRADO`), nunca riesgo 0 ni banda BAJO.
7. **Totales por objeto**: los totales sobre conjuntos de personas se deduplican por objeto (§3); la exposición individual se rotula "no aditiva".
8. **Faltante no suma severidad**: la falta de contacto o de perfil es una bandera de calidad, no un incremento de riesgo ni de prioridad.
9. **Valores por defecto prohibidos**: no se reemplaza un faltante por un texto que parezca dato ("Media", "No especificada", "Sin estado", "En gestion", "Sin periodo"); se muestra el estado de §4.

## 10. Brechas del código actual frente a este contrato

| Brecha (@36f35b4) | Evidencia | Ticket que la corrige |
|---|---|---|
| 0 reemplazado por otro importe con `||` | `front/lib/mappers/debtor-object-mapper.ts:188-195`, `445-459`; `front/lib/mappers/person-risk-mapper.ts:108-122` | ALIGN-011 |
| Importe o fecha ilegible → 0 / nula | `back/ETL/transform.py:142-177`; `front/lib/parsers/numeric-value-parser.ts:6-18`; `front/lib/parsers/date-value-parser.ts:23-31` | ALIGN-024 (origen), ALIGN-011 (frontend) |
| Persona sin detalle → 0 y BAJO | `front/lib/mappers/person-risk-mapper.ts:252` | ALIGN-011 |
| Exposición sumada entre personas | `front/app/people/page.tsx:101-104` | ALIGN-011 |
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
| §3 Perfiles generados entre 30/09 y 02/10/2026 | L04, §5 |
| §3 `previous_*_count` en 0 en los 2933 perfiles, sin alimentarse | PR07, §8, AU03 |
| §3 `socioeconomic_risk_level` entre 25 y 100, no calibrado | PR08, §8 |
| §5 Período fiscal sin contrato (`period = external_id`) | DE02, §8 |
| §5 Fechas con significado mezclado (`issue_date > due_date`, `last_collection_date = issue_date`) | DE08–DE09, §5 |
| §5 Estado inferido por vencimiento | DE10 |
| §5 Perfil temporal: edades persistidas difieren del recálculo | §5, PR04 |
| §5 Riesgo no social | PR08, FO11, §8, AU01 |
| §5 Prioridad no unificada (frontend 0–172, Python 0–100) | FO13, PY02, §8 |
| §5 Gestión sin historia comprobada | PR07, AU03 |
| §5 Contactabilidad limitada | FO09, AG04, AG17 |
| §5 Relaciones y duplicación económica | §3, FP04, AG14 |
| §5 Procedencia insuficiente (`data_source` vacía, tenant "Demo") | L01, L03 |
| §5 Identidad multitenant (`person.external_id` global) | §2, PE01 |
| §5 Original y migración de testing difieren (`updated_amount` generado vs numérico) | DE06, §9 regla 2 |
| §5 Importes actuales sin ceros ni negativos en la carga | §4 (cero real `OBSERVADO`), §9 regla 1: se prueba con datos sintéticos |

## 12. Control de versiones

| Versión | Fecha | Cambio |
|---|---|---|
| v1 | 28/10/2026 | Versión inicial (ALIGN-007). Provisional hasta la homologación del significado de origen por el custodio (ALIGN-004) |
