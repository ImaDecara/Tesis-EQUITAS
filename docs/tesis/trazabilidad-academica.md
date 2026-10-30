# Trazabilidad académica R01–R03 y matriz objetivos ↔ requisitos ↔ tickets ↔ evidencia

| Campo | Valor |
|---|---|
| Ticket | ALIGN-039, plan `2026-10-28-v2` (M6) |
| Estado | **Borrador para revisión del usuario; no aprobado.** El criterio de aceptación del ticket es "Revisión del usuario registrada" (preguntas en `execution/evidence/ALIGN-039/aprobacion.md`) |
| Requisitos | R01, R02 y R03 de `PlanToFinish/requirements.md` (sha256 `972e4e3e750004cc9b1ccc5c82ae15ade293784e96a6507251b8f5c08571a5da`). Este documento **no** lo modifica: aplicar cambios es tarea de ALIGN-043 |
| Tesis | `TesisEquitas-UltimaVersion.docx` (sha256 `1e07177acd13b9a1aa51be004dcb752faafdb08fe68848e632606689d2994adb`), bloques `[P0001]`–`[P0276]`, `[T01]` y `[T02]` de la extracción descrita en `SOURCES/TESIS-SINTESIS.md`. Cada cita se verificó contra el texto del DOCX el 2026-10-30 (lectura sin modificarlo) |
| Alcance aprobado | `execution/evidence/ALIGN-002/alcance.md` (decisión del usuario del 2026-10-30T00:15Z) y `APPROVAL.json` |
| Estados de los tickets | `execution/STATE.json` leído el **2026-10-30T04:57:53Z** (sha256 `6e852eb2356075c15ecd5ac755000f8dfb38e9a4b56cc828616132c3d69a5e26`) |
| Código descrito | `0658691` (rama de integración `delivery/2026-10-28-v2`, con ALIGN-007/008/009/011/013/015/023/025) |
| Datos personales | Ninguno |
| Exclusiones | Sin investigación de mercado nueva. No edita la tesis (ALIGN-040/041) ni `requirements.md` (ALIGN-043) |

## 1. Propósito y cómo leer

`requirements.md` registra R01 como **Pendiente** porque "el repositorio [...] no contiene un estudio comparativo identificable". La tesis sí lo contiene `[P0157]`–`[P0173]`, `[T01]` y lo amplía en el Marco Teórico 3 `[P0252]`–`[P0276]`. Este documento hace explícito ese vínculo (R01), convierte los objetivos de la tesis en indicadores medibles (R02), inventaría el alcance que el usuario aprobó (R03) y vincula cada objetivo con sus requisitos, tickets y evidencia.

Convenciones:

- `[P####]` es un párrafo y `[T##.R##]` una fila de tabla de la extracción de la tesis. No se citan páginas.
- Las rutas `execution/…`, `TICKETS/…`, `SOURCES/…`, `PLAN.md`, `TRACEABILITY.md` y `APPROVAL.json` son relativas al paquete del plan `PlanToFinish/DeliveryPlan/2026-10-28-v2/`, que está **fuera de git**. Se citan como texto, no como enlaces. Las rutas del repositorio sí son enlaces relativos.
- "Pendiente" significa que todavía **no hay evidencia**; no significa que esté mal. Ningún requisito se da por cerrado por existir una pantalla, un archivo o un test verde (`TRACEABILITY.md`, preámbulo; `requirements.md` §9).
- Los estados son una foto del momento de lectura de `STATE.json`. La §5 se regenera con el procedimiento de la §8.

## 2. R01 — Soluciones existentes: cerrado por evidencia de la tesis

### 2.1 Criterios de R01 frente a la tesis

| Criterio de aceptación de R01 (`requirements.md`) | Evidencia en la tesis | ¿Se cumple? |
|---|---|---|
| Comparación de al menos tres alternativas | Seis soluciones en cuatro categorías: Intervan y PGM `[P0160]`, Debitia `[P0161]`, Colektia y Moonflow `[P0162]`, ATM Mendoza `[P0163]`; tabla comparativa `[T01.R02]`–`[T01.R05]` | Sí |
| Usuarios, funciones, limitaciones y diferencias con EQUITAS | Columnas "Capacidades documentadas", "Alcance y limitaciones identificadas" y "Relación con EQUITAS y estado" de `[T01]`; lectura de la tabla `[P0164]`, `[P0165]` | Sí |
| Fuentes | Citas autor-fecha en el texto: Intervan (s. f.), PGM (s. f.), Debitia (s. f.), Colektia (s. f.), Angel Ventures (2021), Moonflow (s. f.), Gobierno de Mendoza (s. f.) `[P0160]`–`[P0163]` | **Parcial**: el DOCX aún no tiene Bibliografía (`SOURCES/TESIS-SINTESIS.md`, "Alcance del documento"); la lista de referencias completa es de ALIGN-041 |
| Fecha de consulta | "documentación pública [...] disponible al 12 de agosto de 2026" `[P0158]`; "hasta el 12 de agosto de 2026" `[P0172]` | Sí |
| Oportunidades concretas | Brecha: ninguna solución reúne seis características (orientación local, priorización económica, vulnerabilidad como moderador, explicabilidad y trazabilidad, apoyo y no ejecución autónoma, accesibilidad) `[P0172]` | Sí |
| Qué queda dentro y fuera del alcance | Decisiones derivadas de la §2.3 e inventario de la §4 (este documento) | Sí, sujeto a la revisión del usuario |
| No presentar hipótesis de mercado como validaciones | La tesis rotula las cifras de proveedores como "afirmaciones de los propios proveedores, sin validación independiente publicada" `[P0162]` y la ausencia de antecedentes académicos locales como "constatación provisoria" `[P0173]` | Sí |

Además de la oferta comercial, la tesis releva antecedentes de analítica en la cobranza pública y académica: Nueva York, proceso de decisión de Markov con restricciones y +8 % de recupero con los mismos recursos `[P0167]`, `[P0265]`; el documento del BCRA sobre credit scoring y sistemas híbridos de puntaje y juicio humano `[P0168]`; el experimento de mensajes en Junín `[P0169]`; y el agrupamiento más predicción en una distribuidora ecuatoriana `[P0170]`. El Marco Teórico 3 compara tipologías funcionales (transaccional, apoyo analítico, automatización) `[P0254]`–`[P0258]`, aplicaciones de aprendizaje automático `[P0260]`–`[P0267]` y condiciones de aplicación en el sector público local `[P0269]`–`[P0276]`.

**Conclusión propuesta.** R01 queda **cerrado por evidencia de la tesis**, sin investigación nueva. Quedan dos dependencias que no son de R01: la Bibliografía (ALIGN-041) y el cambio de estado en `requirements.md` (ALIGN-043, hoy bloqueado; propuesta en `PROPOSED-REQUIREMENTS-CHANGES.md` §2, fila R01). La información de mercado tiene fecha de corte 12/08/2026 y no se re-verificó (exclusión del ticket).

### 2.2 Alternativas relevadas (resumen trazable de `[T01]`)

| Categoría | Soluciones | Qué documentan | Límite identificado en la fuente | Relación con EQUITAS | Bloques |
|---|---|---|---|---|---|
| ERP tributario municipal | Intervan, PGM (SUATS) | Registro de deuda, liquidación de tributos, emisión de boletas | Gestión transaccional; sin priorización analítica de la mora ni criterios sociales documentados | Fuente de los datos; no se reemplaza | `[P0160]`, `[T01.R02]` |
| Cobranza de propósito general | Debitia | Clasificación y priorización predictiva, seguimiento de gestiones, asistencia a operadores; menciona el sector público | Sin vulnerabilidad social como dimensión; no orientada a gobiernos locales de capacidad limitada | Coincide en priorizar y segmentar; se diferencia por la vulnerabilidad como moderador y la orientación local | `[P0161]`, `[T01.R03]` |
| Fintech de cobranza con IA | Colektia, Moonflow | Agentes conversacionales (incluido WhatsApp), derivación a gestores humanos; mejoras declaradas por los proveedores | Banca, fintech y comercio minorista; cifras sin validación independiente; sin criterio social | EQUITAS antepone el apoyo con revisión humana a la ejecución autónoma del cobro | `[P0162]`, `[T01.R04]` |
| IA en la administración tributaria | Administración Tributaria Mendoza | Fiscalización, cruce de datos y gestión del cobro a escala provincial | Gran administración provincial; sin modelo de decisión económico-social público | Comparte la analítica pública; EQUITAS se orienta a organismos locales con pocos recursos técnicos | `[P0163]`, `[T01.R05]` |

### 2.3 Decisiones de alcance derivadas de R01

| ID | Decisión | Fundamento en la tesis | Consecuencia en el MVP aprobado | Dónde se verifica |
|---|---|---|---|---|
| DA-1 | **No reemplazar el ERP tributario municipal** | El ERP es la "fuente natural de los datos" `[P0160]` y EQUITAS es complementario, no competencia `[T01.R02]`; un sistema transaccional no decide sobre los casos y sus datos deben consolidarse para apoyar decisiones `[P0213]`, `[P0255]` | EQUITAS ingiere exportaciones del ERP (TSV, CSV, XLSX y API); registro de deuda, liquidación y emisión de boletas siguen en el ERP `[T01.R02]`; planes de pago, convenios y flujo judicial quedan fuera de un DSS (`PLAN.md` §3.4) | Contrato de origen y validador (024 IN_REVIEW), importación web y API (052–060); [ADR-001](adr-001-reglas-y-capas.md) |
| DA-2 | **Apoyo a la decisión, no ejecución autónoma** | DSS y "no un cobrador automático"; la decisión final es de una persona `[P0057]`, `[P0070]`; característica (v) de la brecha `[P0172]`; frente a las fintech `[T01.R04]`; un sistema que recomienda sigue siendo apoyo mientras la recomendación no obligue `[P0256]`; el caso Robodebt `[P0258]`, `[P0275]` | El sistema nunca sugiere intensidad 3 o 4; las acciones intensas las propone una persona y las aprueba un supervisor con lista de control (ALIGN-003); decisiones registradas append-only; sin envíos automáticos ni cobro; el chat informa y deriva a una persona | Escala aprobada en `execution/evidence/ALIGN-003/intensidad-roles.md` (003 DONE); [reglas v1 §7](reglas-decision-v1.md) (008 DONE, 009 DONE, 015 DONE); registro de revisión (018 PLANNED, 020 PLANNED, 022 PLANNED); canal (065 PLANNED, 066 PLANNED) |
| DA-3 | **La vulnerabilidad modera; nunca agrava** | Principio de diseño `[P0156]`, `[P0059]`; definición `[P0093]`; característica (iii) de la brecha `[P0172]`; ninguna solución relevada la documenta `[P0165]`; reutilizar padrones sociales para cobrar choca con la finalidad y el signo del error `[P0244]` | En la cartera real la vulnerabilidad es `NO_INFORMADA` y no tiene efecto; un indicio (solo en casos sintéticos) solo baja la intensidad y exige revisión; prohibido inferirla de la deuda, el domicilio, el tipo de persona o la falta de contacto; el escenario social sintético solo mide equidad en la simulación | [Reglas v1 §6](reglas-decision-v1.md) (008 DONE); [contrato de dominio §7.11](contrato-dominio-v1.md) (007 DONE); simulación (036 PLANNED) |
| DA-4 | **Reglas interpretables y explicables antes que aprendizaje automático** | MVP con reglas y modelos como evolución `[P0058]`, `[P0191]`; el FMI recomienda que reglas y modelos coexistan hasta que estos demuestren ser mejores `[P0267]`; sin historial de acciones y resultados hay sesgo de selección, deriva y fuga `[P0270]`, `[P0271]`; predecir el pago no indica a quién conviene gestionar `[P0263]`; con datos sintéticos solo se acredita factibilidad `[T02.R04]`; explicabilidad y trazabilidad, característica (iv) `[P0172]`, `[P0113]` | Las reglas v1 (severidad y prioridad 0–100 heurísticas, no probabilidades) deciden colas e intensidad con explicación por factores; propensión y clustering son **experimentales con datos sintéticos**, rotulados y sin efecto en prioridad ni intensidad; se registran acciones y resultados sintéticos desde el inicio | [Reglas v1 §1](reglas-decision-v1.md) (008 DONE, 009 DONE, 015 DONE); protocolo de ML (048 IN_PROGRESS); experimentos (062 PLANNED, 063 PLANNED); pantalla sin efecto en decisiones (064 PLANNED) |
| DA-5 | **Proporcionalidad a la capacidad local** | Orientación a organismos locales con recursos limitados y accesibilidad sin equipos técnicos, características (i) y (vi) `[P0172]`; frente a la escala provincial `[T01.R05]`; inversiones del orden de millones (Nueva York, sistema polaco) orientan hacia soluciones proporcionadas `[P0272]`; herramienta paramétrica por jurisdicción `[P0136]` | Se conserva el stack (Next.js, Supabase, ETL Python) sin microservicios ni reescritura; importación desde el navegador con mapeo, preview y confirmación para usuarios sin equipo técnico; un solo municipio en esta versión | [ADR-001](adr-001-reglas-y-capas.md) (013 DONE); importación web (055 PLANNED, 056 PLANNED, 057 PLANNED, 058 PLANNED) |

## 3. R02 — Objetivos con indicador, método y criterio

### 3.1 Objetivos de la tesis

El objetivo global `[P0186]` y los ocho específicos `[P0189]`–`[P0196]` "abarcan el proyecto en su conjunto", MVP y evolución `[P0188]`. La tabla de trazabilidad `[T02.R02]`–`[T02.R09]` da para cada uno una validación prevista; aquí se la convierte en indicador, método y criterio.

**Tipo de evaluación** `[P0247]`: es **artificial** si se aparta de al menos una de tres realidades (usuarios, sistemas o problemas reales), por ejemplo pruebas de laboratorio, simulaciones o análisis por criterios; es **naturalista** si examina el desempeño con personas, sistemas y situaciones reales. Con la decisión de ALIGN-004 (ningún dato real) y sin relevamiento de campo `[P0246]`, **todas las mediciones del MVP son artificiales**: pueden mostrar coherencia interna bajo los supuestos adoptados, "pero no impacto real, ni usabilidad, ni ajuste a una organización" `[P0250]`, `[P0251]`. Las evaluaciones naturalistas quedan como evolución.

### 3.2 Tabla objetivo → indicador → método → criterio

<!-- R02:INICIO -->
| Obj. | Objetivo (bloque) | Indicador observable | Método (tipo) | Criterio de logro | Tickets (estado) |
|---|---|---|---|---|---|
| 1 | Ingesta paramétrica con validación `[P0189]`, `[T02.R02]` | Conciliación del lote (leídas = aceptadas + rechazadas; conteos e importes por tipo de objeto y tributo); rechazos con código y fila, sin valores personales; equivalencia TSV/CSV/XLSX y `.xls` rechazado con mensaje; recorrido web archivo → preview → confirmación → base → tablero | Prueba funcional de carga y reporte de calidad con la cartera sintética y su oráculo independiente, corpus hostil y smoke E2E en base local (**artificial**). Naturalista: lote real (046, fuera del alcance aprobado) | Igualdad con el oráculo (perfil = Σ deudas ±0,01); archivo rechazado publica 0 filas; recarga idéntica: 0 insertados y 0 actualizados; smoke E2E y campaña de seguridad aprobados | 023 DONE, 024 IN_REVIEW, 027 PLANNED, 030 BLOCKED, 053 PLANNED, 057 PLANNED, 058 PLANNED, 059 PLANNED |
| 2 | Perfil unificado del deudor `[P0190]`, `[T02.R03]` | Perfil del objeto al corte = Σ de sus obligaciones; cada faltante con estado de presencia (nunca 0); persona como exposición no aditiva; recencia y frecuencia de pago sobre historial sintético; dimensión social "no informada" | Prueba funcional sobre el dataset sintético del proyecto, verificada después de persistir (archivo → base → perfil) (**artificial**). Naturalista: dimensión social con fuente lícita (evolución) | Coincidencia con el oráculo en todos los casos borde; cero conservado y error ≠ 0; total único deduplicado con dos personas y un objeto; ningún evento posterior al corte | 007 DONE, 011 DONE, 026 PLANNED, 027 PLANNED, 031 PLANNED, 061 PLANNED |
| 3 | Segmentación y puntaje de recuperabilidad `[P0191]`, `[T02.R04]` | Reglas: paridad de casos golden TypeScript = Python y orden determinista; colas con conteos = casos listados. Experimental: AUC-ROC/PR y calibración frente a baselines y reglas, en total y en submuestra aleatoria; escenario nulo; estabilidad y utilidad operativa de los segmentos | Golden y paridad (**artificial**); experimento pre-registrado con mundo sintético (**artificial**); validez aparente con personas que conocen el dominio `[P0248]` (**artificial**, análisis por criterios). Naturalista: modelos con datos reales (evolución; condiciones de 048) | Golden 100 % iguales en TS y Python; mismos datos, corte y versión → mismo orden; escenario nulo dentro del intervalo declarado (fuera = fuga); resultados publicados aunque el modelo pierda; sin efecto en prioridad ni intensidad; acta de validez aparente con objeciones resueltas. Solo acredita factibilidad `[T02.R04]` | 008 DONE, 009 DONE, 015 DONE, 010 IN_PROGRESS, 048 IN_PROGRESS, 062 PLANNED, 063 PLANNED, 064 PLANNED, 070 PLANNED, 037 PLANNED |
| 4 | Costo de recupero por acción y segmento `[P0192]`, `[T02.R05]` | Tabla paramétrica de costo y capacidad por tipo de acción e intensidad: cada valor con fuente o rótulo "supuesto", rango y fecha | Verificación de parámetros contra la normativa tributaria utilizada y revisión por directores o personal municipal (**artificial**, análisis por criterios). Naturalista: costos reales del municipio (evolución) | Ningún valor sin fuente o rótulo "supuesto"; rangos aptos para sensibilidad; revisión registrada | 034 IN_REVIEW |
| 5 | Motor económico-social y estrategias diferenciadas `[P0193]`, `[T02.R06]` | Intensidad sugerida ≤ 2 en todos los casos; cada intensidad ≥ 3 con aprobación de supervisor registrada; con indicio de vulnerabilidad (sintético) intensidad ≤ 1 y revisión obligatoria; la falta de contacto nunca sube la intensidad; mensajes solo borrador; en simulación, acciones intensas por nivel de vulnerabilidad | Golden y pares contrafactuales, pruebas de revisión con aprobación de supervisor en base local, simulación y revisión de la matriz y sus salidas (**artificial**). Naturalista: matriz con dato social real (evolución) | Propiedades verificadas en el 100 % de los golden; ninguna intensidad ≥ 3 sin aprobación registrada; acta de validez aparente | 003 DONE, 008 DONE, 009 DONE, 010 IN_PROGRESS, 020 PLANNED, 021 PLANNED, 036 PLANNED, 037 PLANNED |
| 6 | Interfaces desacopladas y simples `[P0194]`, `[T02.R07]` | Eficacia, eficiencia, satisfacción y utilidad percibida en tareas definidas (importar y entender errores, encontrar un caso, explicar la sugerencia, registrar una discrepancia, exportar, atender una consulta del chat) `[P0249]`; cada cifra del tablero con fórmula, unidad, población y corte; chat con respuesta idéntica para cualquier referencia, derivación registrada y purga por retención | Prueba formativa con 2–5 participantes y criterios fijados antes, sobre el sistema local con datos sintéticos (**artificial con usuarios reales**); verificación técnica del tablero y del canal (**artificial**). Naturalista: prueba de aceptación o piloto en una organización real `[T02.R07]`, `[P0249]` (evolución) | Criterios previos que fija el protocolo de 038 antes de probar (no se inventan aquí); totales = consultas de referencia; verificación integrada del canal con no revelación y purga comprobadas. Canal **parcial** sin identificación del usuario | 011 DONE, 013 DONE, 012 READY, 014 PLANNED, 021 PLANNED, 047 IN_REVIEW, 058 PLANNED, 065 PLANNED, 066 PLANNED, 071 PLANNED, 038 PLANNED |
| 7 | Seguridad, roles, auditoría y revisión humana `[P0195]`, `[T02.R08]` | Identidad sin membresía → 0 filas; otro municipio no lee; escrituras solo por canal de servidor; cada acción auditada → exactamente un registro; escritura, edición y borrado directos rechazados; API interna con autenticación en todas las rutas | Prueba funcional de permisos y del registro de auditoría en base local con cuentas sintéticas (**artificial**). Naturalista: operación real y remediación del original (045, fuera del alcance aprobado) | Campañas 100 % aprobadas y 0 omitidas; un registro por acción auditada; las lecturas directas por la Data API se declaran no auditadas | 003 DONE, 004 DONE, 025 DONE, 016 IN_REVIEW, 018 PLANNED, 019 PLANNED, 020 PLANNED, 022 PLANNED, 052 PLANNED, 059 PLANNED, 069 PLANNED |
| 8 | Evaluación frente a la gestión uniforme `[P0196]`, `[T02.R09]` | Eficiencia (costo, recupero esperado) y equidad (acciones intensas por nivel de vulnerabilidad) a igual capacidad, con análisis de sensibilidad | Simulación con protocolo pre-registrado, pago simulado independiente del puntaje y simulador reproducible (**artificial**: coherencia interna bajo supuestos `[P0250]`, `[P0251]`). Naturalista: evaluación con un municipio (evolución) | Protocolo aprobado y fechado antes de cualquier corrida; misma semilla → mismos resultados; prueba de que el pago no usa la severidad; capacidad igual verificada; informe rotulado "evaluación artificial; no acredita impacto real ni usabilidad" | 034 IN_REVIEW, 035 PLANNED, 036 PLANNED, 037 PLANNED, 051 PLANNED |
<!-- R02:FIN -->

Los criterios provienen de los criterios de aceptación de los tickets citados (`TICKETS/ALIGN-###.md`); donde un ticket deja el umbral para su protocolo (038, 048, 035), aquí no se fija un número.

### 3.3 Usuarios destinatarios, unidades y escenarios

- **Usuarios** (roles aprobados en ALIGN-003): `consulta` (solo lectura), `operador` (decide intensidad ≤ 2, propone ≥ 3 y atiende consultas del canal), `supervisor` (aprueba u objeta ≥ 3, ve auditoría y analítica experimental), `importador` (sube, mapea y confirma lotes) e `importador_sistema` (credencial de máquina para la API). Afectados: contribuyentes, que usan el chat para informarse y pedir contacto (`PLAN.md` §1).
- **Unidades**: el **objeto tributario** es la unidad central de totales, perfiles y colas; la **obligación** es cada registro de deuda; la **persona** es el destinatario informado en origen y su deuda es una exposición no aditiva; el hogar no se modela ni se infiere ([contrato de dominio §2–§3](contrato-dominio-v1.md)).
- **Escenarios para validar la utilidad** (propuestos para la prueba formativa de ALIGN-038; no medidos todavía):
  1. *Operador*: abre la cola "Contacto y plan", elige el primer caso, lee la explicación por factores y la fecha de corte, y registra una decisión que modifica la sugerencia con motivo (`PLAN.md` §5.1, paso 5).
  2. *Supervisor*: recibe una propuesta de intensidad 3, revisa la lista de control (situación del hogar consultada o "no disponible", estado jurídico verificado, canal válido, alternativa asistida ofrecida) y la aprueba u objeta; luego exporta el reporte de decisiones (ALIGN-003; `PLAN.md` §5.1, pasos 5–6).
  3. *Importador*: sube un XLSX sintético, mapea columnas, revisa errores y cuarentenas en el preview, confirma y descarga el resumen (`PLAN.md` §5.2).

## 4. R03 — Inventario del alcance aprobado

### 4.1 Decisión y fuente

El usuario aprobó el 2026-10-30T00:15Z la propuesta por defecto: **"MVP completo de PLAN.md §3, .xls rechazado con mensaje, consulta de cuenta y WhatsApp como evolucion"** (`execution/evidence/ALIGN-002/alcance.md`). ML y clustering experimental y el chat web se mantienen **imprescindibles**; si los directores dijeran lo contrario, pasarían a evolución con una nueva decisión, sin borrarse. `APPROVAL.json` autoriza los tickets imprescindibles (I) y de validación académica (VA) y deja fuera la evolución (033, 050, 067, 068) y las operaciones restringidas (005, 045, 046).

### 4.2 Alcance por objetivo

| Obj. | Imprescindible (MVP completo) | Validación académica | Evolución | Evidencia esperada |
|---|---|---|---|---|
| 1 Ingesta paramétrica | Contrato y validador, ETL seguro y semántico, carga V1, TSV/CSV/XLSX, `.xls` **rechazado con mensaje**, importación web con mapeo, preview, confirmación y resumen, API para sistemas (023–032, 052–060) | — | Lote real (046, restringido) | Smoke V1 (029) y E2E de importación web (058), campaña de seguridad (059) |
| 2 Perfil unificado | Perfil al corte con faltantes explícitos, persona no aditiva, vulnerabilidad "no informada", recencia y frecuencia de pago con historial sintético (007, 010, 011, 026, 061) | — | Dimensión social con fuente lícita | Pruebas contra el oráculo sintético (023/024/027) |
| 3 Segmentación y puntaje | Reglas v1 0–100 y colas; propensión y clustering **experimentales con datos sintéticos, rotulados y sin decidir intensidad** (008–010, 015, 048, 061–064, 070) | Validez aparente (037) | Modelos con datos reales | Golden TS/Python; protocolo 048 aprobado; verificación 070 |
| 4 Costo de recupero | — | Tabla paramétrica con fuente o supuesto (034) | Costos reales del municipio | Tabla 034 validada por directores o personal municipal |
| 5 Motor económico-social | Intensidad 0–4 (ALIGN-003), salvaguarda de vulnerabilidad no informada, plantillas borrador (003, 008, 021) | Simulación (035, 036); validez aparente (037) | Matriz con dato social real | Golden y pruebas de revisión con aprobación de supervisor |
| 6 Interfaces simples | Dashboard corregido y actualizado tras importar, revisión, reportes, **chat web por reglas con derivación a operador** (012, 014, 021, 028, 047, 058, 065, 066, 071) | Prueba formativa (038) | **Consulta de cuenta** con identificación robusta (067) y **WhatsApp** (068) | Verificación del canal (071) |
| 7 Seguridad, roles, auditoría | Roles, DAL de servidor, registro append-only, auditoría de accesos, API autenticada, campañas reales (018–022, 052, 059, 069) | — | Remediación del original (045, restringida) | Pruebas de permisos (022) y de auditoría (069) en base local |
| 8 Evaluación comparativa | Resultados integrados como evidencia académica (051) | Protocolo pre-registrado (035), simulador (036), validez aparente (037) | Evaluación naturalista con municipio | Protocolo 035 aprobado antes de correr; resultados en 051 |

Fuente: tabla aprobada de `execution/evidence/ALIGN-002/alcance.md`, copiada sin cambios (reproduce `PLAN.md` §3 y `TRACEABILITY.md` §2). Observación: ALIGN-042 (análisis preliminar de impacto en protección de datos, objetivo 7) es validación académica y está autorizado en `APPROVAL.json`, pero no figura en la tabla aprobada; `PLAN.md` §3.2 sí lo lista. Se consulta al usuario en `aprobacion.md`.

### 4.3 Definiciones explícitas que pide R03

| Punto | Definición aprobada | Fuente |
|---|---|---|
| Formato de importación | TSV, CSV y XLSX, por CLI, desde el navegador y por API; `.xls`, `.xlsm` y `.ods` rechazados con mensaje; tipo detectado por contenido | `PLAN.md` §7.8; ALIGN-002 |
| Reportería | CSV generados en servidor: cola, decisiones, supervisión y calidad de datos; resumen descargable de cada importación sin datos personales | ALIGN-028, ALIGN-057 |
| Estrategias de acción | Intensidad 0–4; el sistema sugiere como máximo 2; 3 y 4 solo las propone una persona y las aprueba un supervisor; mensajes borrador sin envío | ALIGN-003; [reglas v1 §7 y §10](reglas-decision-v1.md) |
| Datos | Solo cartera sintética; ningún dato real en demos, pruebas, capturas ni tesis más allá de los conteos agregados ya documentados | ALIGN-004 (`execution/evidence/ALIGN-004/gobernanza.md`) |
| Excluido del MVP | Liquidación y emisión (ERP); planes de pago, convenios y flujo judicial; WhatsApp, LLM en el canal, envíos automáticos y cobro; mostrar deuda en el chat sin identificación robusta; integraciones SINTyS/ANSES/ARCA; inferir vulnerabilidad; usar propensión o segmentos para decidir; microservicios o reescritura; despliegue público de la API; más de un municipio | `PLAN.md` §3.4 |

### 4.4 Recorrido principal de punta a punta

| Paso | V1 por CLI (`PLAN.md` §5.1) | V-Web (`PLAN.md` §5.2) |
|---|---|---|
| Entrada y validación | Cartera sintética con oráculo y validador dry-run: 023 DONE, 024 IN_REVIEW | Subida, lectores seguros y mapeo: 052 PLANNED, 053 PLANNED, 055 PLANNED, 056 PLANNED |
| Carga y publicación | ETL seguro y semántico, carga V1: 025 DONE, 026 PLANNED, 027 PLANNED | Preview, confirmación transaccional y resumen: 054 PLANNED, 032 PLANNED, 057 PLANNED |
| Perfil y sugerencia | Reglas v1 en pantallas y colas: 009 DONE, 010 IN_PROGRESS, 012 READY | Perfiles, puntaje y tablero actualizados: 031 PLANNED, 058 PLANNED |
| Revisión humana | Registro de decisiones y aprobación de supervisor: 018 PLANNED, 019 PLANNED, 020 PLANNED, 021 PLANNED, 022 PLANNED | La misma revisión sobre los casos importados |
| Reporte y prueba | CSV y smoke: 028 PLANNED, 029 PLANNED | Campaña de seguridad: 059 PLANNED |

Lo que V1 y V-Web **no** demuestran: utilidad para un municipio real, supervisión efectiva por personas reales, impacto en la recaudación ni seguridad del entorno original (`PLAN.md` §5.2).

### 4.5 Capacidades que la tesis declara desarrolladas frente a su estado verificado

La tesis afirma un MVP "ya desarrollado" `[P0058]`, `[P0071]`. Para que ninguna capacidad sugerida figure como entregada, esta tabla compara cada afirmación con el diagnóstico del plan (`PLAN.md` §2, verificación del 26/10/2026 sobre `36f35b4`) y con lo integrado hasta `0658691`. Es insumo para ALIGN-040, que propone los cambios a la columna "Estado" de `[T02]`.

| Capacidad declarada | Estado en `36f35b4` | Integrado hasta `0658691` | Falta |
|---|---|---|---|
| Carga y normalización con control de duplicados | Parcial: ETL TSV por CLI con conversiones silenciosas y logs con filas completas | ETL seguro con guardia de destino y logs sin datos personales: 025 DONE | Validador y ETL semántico (024 IN_REVIEW, 026 PLANNED), carga V1 verificada (027 PLANNED) |
| Perfiles por objeto de deuda | Parcial: calculados con `date.today()` y relativos al promedio del lote | Contrato de dominio con corte `as_of` y estados de presencia: 007 DONE; mapeadores con ceros, faltantes y no aditividad: 011 DONE | Perfiles al corte y desde lo persistido (026 PLANNED, 031 PLANNED) |
| Puntaje de prioridad 0–100 por reglas interpretables | Implementado sin verificar y semánticamente incorrecto: tres fórmulas incompatibles, prioridad 0–172 en el frontend | Reglas v1 0–100 especificadas con golden: 008 DONE; núcleo TypeScript: 009 DONE; paridad Python: 015 DONE | Uso en pantallas y colas (010 IN_PROGRESS) |
| Agrupación operativa de casos | Seis grupos en Python no consumidos | Colas por intervención v1 en TS y Python: 008 DONE, 009 DONE, 015 DONE | Colas visibles (010 IN_PROGRESS, 021 PLANNED) |
| Recomendaciones iniciales por reglas | Parcial: cuatro tipos sin intensidad; "recordatorio" sin verificar canal | Intervención, intensidad y canal requerido en reglas v1: 008 DONE, 009 DONE | Adaptador y revisión (010 IN_PROGRESS, 020 PLANNED, 021 PLANNED) |
| Tablero de visualización | Verificado técnicamente; semántica parcial (etiquetas "socioeconómico", cifras fijas, "críticos" ambiguo) | Catálogo de indicadores y ADR: 013 DONE; contrato en mapeadores: 011 DONE | Etiquetas y tablero según catálogo (012 READY, 014 PLANNED) |
| Autenticación de usuarios institucionales | Autenticación y RLS por membresía verificadas en testing; el original con políticas abiertas (DEF-SUP-001) | Sin cambios en autenticación ni roles; el ETL rechaza siempre el destino original (025 DONE, [`back/ETL/README.md`](../../back/ETL/README.md)) | Roles, DAL, registro y campañas (018 PLANNED, 019 PLANNED, 022 PLANNED); el original queda fuera del alcance aprobado (005, 045) |

## 5. Matriz objetivos ↔ requisitos ↔ tickets ↔ evidencia

Fuentes: objetivos y requisitos de cada ticket según su frontmatter congelado (`TICKETS/ALIGN-###.md`); columna "Obj." de cada requisito según `TRACEABILITY.md` §1 (R29–R38 son **propuestos** y no existen en `requirements.md` hasta que el usuario apruebe `PROPOSED-REQUIREMENTS-CHANGES.md`); estados según `STATE.json` a la hora indicada en la cabecera; "fuera del alcance aprobado" según `APPROVAL.json`. Al momento de la lectura: 70 tickets activos (12 DONE, 4 IN_REVIEW, 3 IN_PROGRESS, 1 READY, 2 BLOCKED y 48 PLANNED); 7 de ellos están fuera del alcance aprobado.

### 5.1 Por objetivo

<!-- MATRIZ-OBJETIVOS:INICIO -->
| Obj. | Requisitos (columna Obj. de §5.2) | Tickets I | Tickets VA | E o fuera del alcance aprobado | DONE con evidencia | DONE / en alcance |
|---|---|---|---|---|---|---|
| 1 | R05, R10, R12, R13, R14, R26, R28, R36, R37 | 004, 016, 017, 018, 023, 024, 025, 026, 027, 029, 030, 031, 032, 052, 053, 054, 055, 056, 057, 058, 060 | — | 046, 050 | 004, 023, 025 | 3 / 21 |
| 2 | R09, R11, R24, R28, R30 | 004, 007, 011, 014, 017, 026, 027, 029, 031, 032, 058, 061 | — | 033, 046 | 004, 007, 011 | 3 / 12 |
| 3 | R04, R07, R08, R15, R16, R35 | 007, 008, 009, 010, 013, 014, 015, 029, 048, 058, 061, 062, 063, 064, 070 | 036, 037 | — | 007, 008, 009, 013, 015 | 5 / 17 |
| 4 | R31 | — | 034 | — | — | 0 / 1 |
| 5 | R08, R17, R29, R30 | 003, 007, 008, 009, 010, 018, 020, 021, 029 | 036, 037 | — | 003, 007, 008, 009 | 4 / 11 |
| 6 | R04, R06, R07, R18, R19, R23, R27, R33, R36 | 010, 011, 012, 013, 014, 021, 028, 029, 047, 055, 057, 058, 064, 065, 066, 070, 071 | 038 | 033, 067, 068 | 011, 013 | 2 / 18 |
| 7 | R05, R19, R22, R26, R29, R38 | 003, 004, 012, 016, 017, 018, 019, 020, 021, 022, 025, 028, 029, 032, 052, 053, 057, 059, 066, 069, 071 | 038, 042 | 005, 045, 050, 067 | 003, 004, 025 | 3 / 23 |
| 8 | R32 | 003, 004, 015, 023, 048, 062 | 034, 035, 036, 037 | — | 003, 004, 015, 023 | 4 / 10 |
| 1–8 (transversales) | R01, R02, R03, R20, R21, R25, R34 | 001, 002, 039, 040, 041, 044, 051 | — | — | 001, 002 | 2 / 7 |
<!-- MATRIZ-OBJETIVOS:FIN -->

Los tickets con objetivos "1–8" se cuentan una sola vez, en la fila de transversales. ALIGN-006 (TP de Calidad) y ALIGN-043 no declaran objetivos de la tesis.

### 5.2 Por requisito

<!-- MATRIZ-REQUISITOS:INICIO -->
| Req | Nombre (TRACEABILITY.md) | Obj. | Tickets que lo citan | DONE / total |
|---|---|---|---|---|
| R01 | Investigar soluciones | transv. | ALIGN-039 | 0 / 1 |
| R02 | Problema y objetivos | 1–8 | ALIGN-002, ALIGN-007, ALIGN-038, ALIGN-039, ALIGN-040, ALIGN-051 | 2 / 6 |
| R03 | Alcance MVP | 1–8 | ALIGN-001, ALIGN-002, ALIGN-039, ALIGN-040 | 2 / 4 |
| R04 | Arquitectura | 3, 6 | ALIGN-013, ALIGN-015, ALIGN-019 | 2 / 3 |
| R05 | Modelo de BD | 1, 7 | ALIGN-016, ALIGN-017, ALIGN-018, ALIGN-026, ALIGN-027, ALIGN-032 | 0 / 6 |
| R06 | UI y mockups | 6 | ALIGN-021, ALIGN-055 | 0 / 2 |
| R07 | Diseño de dashboard | 6, 3 | ALIGN-012, ALIGN-013, ALIGN-014, ALIGN-064 | 1 / 4 |
| R08 | Reglas de decisión | 3, 5 | ALIGN-003, ALIGN-008, ALIGN-037 | 2 / 3 |
| R09 | Perfil del deudor | 2 | ALIGN-007, ALIGN-010, ALIGN-011, ALIGN-026, ALIGN-031, ALIGN-061 | 2 / 6 |
| R10 | Dataset final | 1 | ALIGN-004, ALIGN-023, ALIGN-024, ALIGN-046 | 2 / 4 |
| R11 | Variables | 2 | ALIGN-007, ALIGN-061 | 1 / 2 |
| R12 | Limpieza y transformación | 1 | ALIGN-023, ALIGN-024, ALIGN-026, ALIGN-053, ALIGN-054 | 1 / 5 |
| R13 | Validar datos cargados | 1 | ALIGN-023, ALIGN-024, ALIGN-027, ALIGN-032, ALIGN-046, ALIGN-054, ALIGN-057, ALIGN-058 | 1 / 8 |
| R14 | CSV o Excel | 1 | ALIGN-024, ALIGN-030, ALIGN-052, ALIGN-053, ALIGN-055, ALIGN-056, ALIGN-060 | 0 / 7 |
| R15 | Segmentación | 3 | ALIGN-008, ALIGN-009, ALIGN-010, ALIGN-015, ALIGN-063, ALIGN-064 | 3 / 6 |
| R16 | Score de prioridad | 3 | ALIGN-003, ALIGN-008, ALIGN-009, ALIGN-010, ALIGN-015, ALIGN-037, ALIGN-062 | 4 / 7 |
| R17 | Estrategias de acción | 5 | ALIGN-003, ALIGN-008, ALIGN-009, ALIGN-010, ALIGN-020, ALIGN-021, ALIGN-037 | 3 / 7 |
| R18 | Dashboard (implementación) | 6 | ALIGN-011, ALIGN-012, ALIGN-014, ALIGN-058 | 1 / 4 |
| R19 | Reportes | 6, 7 | ALIGN-028, ALIGN-057 | 0 / 2 |
| R20 | Testing | transv. | ALIGN-006, ALIGN-016, ALIGN-022, ALIGN-023, ALIGN-029, ALIGN-038, ALIGN-044, ALIGN-051, ALIGN-058, ALIGN-059, ALIGN-070, ALIGN-071 | 1 / 12 |
| R21 | Ajustes finales | todos | ALIGN-001, ALIGN-002, ALIGN-006, ALIGN-040, ALIGN-041, ALIGN-044, ALIGN-050, ALIGN-051 | 2 / 8 |
| R22 | Autenticación y tenant | 7 | ALIGN-003, ALIGN-005, ALIGN-015, ALIGN-018, ALIGN-019, ALIGN-020, ALIGN-022, ALIGN-025, ALIGN-042, ALIGN-045, ALIGN-052, ALIGN-059, ALIGN-069 | 3 / 13 |
| R23 | Consultas y rendimiento | 6 | ALIGN-014, ALIGN-033 | 0 / 2 |
| R24 | Contrato de datos | 2 | ALIGN-007, ALIGN-011, ALIGN-017, ALIGN-026 | 2 / 4 |
| R25 | Entorno y CI | transv. | ALIGN-001, ALIGN-006, ALIGN-016, ALIGN-019, ALIGN-029, ALIGN-044, ALIGN-050 | 1 / 7 |
| R26 | Operación y trazabilidad | 1, 7 | ALIGN-004, ALIGN-018, ALIGN-020, ALIGN-025, ALIGN-026, ALIGN-032, ALIGN-042, ALIGN-050, ALIGN-052, ALIGN-069 | 2 / 10 |
| R27 | Usabilidad y accesibilidad | 6 | ALIGN-012, ALIGN-014, ALIGN-021, ALIGN-038, ALIGN-055 | 0 / 5 |
| R28 | Carga idempotente | 1, 2 | ALIGN-017, ALIGN-027, ALIGN-031, ALIGN-032, ALIGN-054, ALIGN-057 | 0 / 6 |
| R29 | Revisión humana registrada (prop.) | 7, 5 | ALIGN-066 | 0 / 1 |
| R30 | Dimensión social con salvaguarda (prop.) | 2, 5 |  | 0 / 0 |
| R31 | Costos de acción (prop.) | 4 | ALIGN-034 | 0 / 1 |
| R32 | Evaluación comparativa (prop.) | 8 | ALIGN-035, ALIGN-036 | 0 / 2 |
| R33 | Canal desacoplado (prop.) | 6 | ALIGN-047, ALIGN-065, ALIGN-066, ALIGN-067, ALIGN-068, ALIGN-071 | 0 / 6 |
| R34 | Gobernanza de datos reales (prop.) | transv. |  | 0 / 0 |
| R35 | Modelos predictivos y clustering (prop.) | 3 | ALIGN-048, ALIGN-061, ALIGN-062, ALIGN-063, ALIGN-064, ALIGN-070 | 0 / 6 |
| R36 | Importación web asistida (prop.) | 1, 6 | ALIGN-052, ALIGN-053, ALIGN-054, ALIGN-055, ALIGN-056, ALIGN-057, ALIGN-058, ALIGN-059 | 0 / 8 |
| R37 | Ingesta por API (prop.) | 1 | ALIGN-060 | 0 / 1 |
| R38 | Auditoría de acciones de la aplicación (prop.) | 7 | ALIGN-069 | 0 / 1 |
<!-- MATRIZ-REQUISITOS:FIN -->

Notas:

- ALIGN-043 declara "R01–R28" porque aplica a `requirements.md` los cambios aprobados para todos los requisitos; no se repite en cada fila. Está **bloqueado** hasta que el usuario apruebe `PROPOSED-REQUIREMENTS-CHANGES.md`.
- **R30 y R34 (propuestos) no aparecen en el frontmatter de ningún ticket.** `TRACEABILITY.md` §1 los asigna a ALIGN-007, 008 y 042 (R30, dimensión social con salvaguarda) y a ALIGN-004, 042 y 046 (R34, gobernanza de datos reales). Es una inconsistencia del paquete del plan, que es de solo lectura: se registra para ALIGN-043.
- "DONE / total" cuenta tickets, no cierra requisitos: el cierre exige el criterio común de `requirements.md` §9.

### 5.3 Por ticket

<!-- MATRIZ-TICKETS:INICIO -->
| Ticket | Hito | Alcance | Objetivos | Requisitos | Estado | Evidencia |
|---|---|---|---|---|---|---|
| ALIGN-001 | M0 | I | 1–8 | R03, R21, R25 | DONE | Registro de la decisión del usuario `execution/evidence/ALIGN-001/decision.md` (registro revisado: APPROVED) |
| ALIGN-002 | M0 | I | 1–8 | R02, R03, R21 | DONE | Registro de la decisión del usuario `execution/evidence/ALIGN-002/alcance.md` (registro revisado: APPROVED) |
| ALIGN-003 | M0 | I | 5, 7, 8 | R08, R16, R17, R22 | DONE | Registro de la decisión del usuario `execution/evidence/ALIGN-003/intensidad-roles.md` (registro revisado: APPROVED) |
| ALIGN-004 | M0 | I | 1, 2, 7, 8 | R10, R26 | DONE | Registro de la decisión del usuario `execution/evidence/ALIGN-004/gobernanza.md` (registro revisado: APPROVED) |
| ALIGN-005 | M0 | I | 7 | R22 | PLANNED | Fuera del alcance aprobado (`APPROVAL.json`: operacion restringida); sin evidencia |
| ALIGN-006 | M0 | I | — | R20, R21, R25 | PLANNED | Pendiente |
| ALIGN-007 | M1 | I | 2, 3, 5 | R02, R09, R11, R24 | DONE | Commit final `b153263`; criterios `execution/evidence/ALIGN-007/criterios.md`; revisión APPROVED (`execution/evidence/ALIGN-007/review-2.md`); en el repo: [contrato-dominio-v1.md](contrato-dominio-v1.md), [`front/types/equitas-domain.ts`](../../front/types/equitas-domain.ts) |
| ALIGN-008 | M1 | I | 3, 5 | R08, R15, R16, R17 | DONE | Commit final `c17a1bf`; criterios `execution/evidence/ALIGN-008/criterios.md`; revisión APPROVED (`execution/evidence/ALIGN-008/review-2.md`); en el repo: [reglas-decision-v1.md](reglas-decision-v1.md), [`contracts/decision-rules.v1.json`](../../contracts/decision-rules.v1.json), [golden](../../contracts/decision-rules.v1.golden.json) |
| ALIGN-009 | M1 | I | 3, 5 | R16, R15, R17 | DONE | Commit final `0658691`; criterios `execution/evidence/ALIGN-009/criterios.md`; revisión APPROVED (`execution/evidence/ALIGN-009/review.md`); en el repo: [`front/lib/domain/decision-rules-v1.ts`](../../front/lib/domain/decision-rules-v1.ts) |
| ALIGN-010 | M1 | I | 3, 5, 6 | R16, R15, R17, R09 | IN_PROGRESS | Pendiente: en ejecución |
| ALIGN-011 | M1 | I | 2, 6 | R24, R18, R09 | DONE | Commit final `ab4c5b3`; criterios `execution/evidence/ALIGN-011/criterios.md`; revisión APPROVED (`execution/evidence/ALIGN-011/review-2.md`); en el repo: [`front/lib/data-presence.ts`](../../front/lib/data-presence.ts), mapeadores de `front/lib/mappers/` |
| ALIGN-012 | M1 | I | 6, 7 | R07, R18, R27 | READY | Pendiente: listo para iniciar |
| ALIGN-013 | M1 | I | 3, 6 | R07, R04 | DONE | Commit final `b5bc9ab`; criterios `execution/evidence/ALIGN-013/criterios.md`; revisión APPROVED (`execution/evidence/ALIGN-013/review-2.md`); en el repo: [catalogo-indicadores-v1.md](catalogo-indicadores-v1.md), [adr-001-reglas-y-capas.md](adr-001-reglas-y-capas.md) |
| ALIGN-014 | M1 | I | 2, 3, 6 | R07, R18, R23, R27 | PLANNED | Pendiente |
| ALIGN-015 | M1 | I | 3, 8 | R04, R15, R16, R22 | DONE | Commit final `7833bd3`; revisión APPROVED (`execution/evidence/ALIGN-015/review.md`); en el repo: [`back/services/decision_rules_v1.py`](../../back/services/decision_rules_v1.py), [`back/api/README.md`](../../back/api/README.md) |
| ALIGN-016 | M2 | I | 1, 7 | R05, R20, R25 | IN_REVIEW | Pendiente: en revisión independiente; evidencia aún no registrada en `STATE.json` |
| ALIGN-017 | M2 | I | 1, 2, 7 | R05, R24, R28 | PLANNED | Pendiente |
| ALIGN-018 | M2 | I | 1, 5, 7 | R05, R22, R26 | PLANNED | Pendiente |
| ALIGN-019 | M2 | I | 7 | R22, R04, R25 | PLANNED | Pendiente |
| ALIGN-020 | M2 | I | 5, 7 | R17, R22, R26 | PLANNED | Pendiente |
| ALIGN-021 | M2 | I | 5, 6, 7 | R17, R27, R06 | PLANNED | Pendiente |
| ALIGN-022 | M2 | I | 7 | R20, R22 | PLANNED | Pendiente |
| ALIGN-023 | M3 | I | 1, 8 | R10, R12, R13, R20 | DONE | Commit final `bc0fd54`; criterios `execution/evidence/ALIGN-023/criterios.md`; revisión APPROVED (`execution/evidence/ALIGN-023/review-2.md`); en el repo: [fixtures-sinteticas.md](fixtures-sinteticas.md), [`quality/fixtures/synthetic_portfolio.py`](../../quality/fixtures/synthetic_portfolio.py) |
| ALIGN-024 | M3 | I | 1 | R12, R13, R14, R10 | IN_REVIEW | Pendiente: en revisión independiente; evidencia aún no registrada en `STATE.json` |
| ALIGN-025 | M3 | I | 1, 7 | R26, R22 | DONE | Commit final `84fffb9`; criterios `execution/evidence/ALIGN-025/criterios.md`; revisión APPROVED (`execution/evidence/ALIGN-025/review.md`); en el repo: [`back/ETL/README.md`](../../back/ETL/README.md) |
| ALIGN-026 | M3 | I | 1, 2 | R05, R09, R12, R24, R26 | PLANNED | Pendiente |
| ALIGN-027 | M3 | I | 1, 2 | R13, R28, R05 | PLANNED | Pendiente |
| ALIGN-028 | M3 | I | 6, 7 | R19 | PLANNED | Pendiente |
| ALIGN-029 | M3 | I | 1, 2, 3, 5, 6, 7 | R20, R25 | PLANNED | Pendiente |
| ALIGN-030 | M4 | I | 1 | R14 | BLOCKED | Pendiente: bloqueado (ALIGN-023 DONE e integrado, luego ALIGN-024 DONE (noche 2)) |
| ALIGN-031 | M4 | I | 1, 2 | R28, R09 | PLANNED | Pendiente |
| ALIGN-032 | M4 | I | 1, 2, 7 | R28, R13, R26, R05 | PLANNED | Pendiente |
| ALIGN-033 | M4 | E | 2, 6 | R23 | PLANNED | Fuera del alcance aprobado (`APPROVAL.json`: evolucion (E)); sin evidencia |
| ALIGN-034 | M5 | VA | 4, 8 | R31 | IN_REVIEW | Pendiente: en revisión independiente; evidencia aún no registrada en `STATE.json` |
| ALIGN-035 | M5 | VA | 8 | R32 | PLANNED | Pendiente |
| ALIGN-036 | M5 | VA | 3, 5, 8 | R32 | PLANNED | Pendiente |
| ALIGN-037 | M5 | VA | 3, 5, 8 | R08, R16, R17 | PLANNED | Pendiente |
| ALIGN-038 | M5 | VA | 6, 7 | R27, R20, R02 | PLANNED | Pendiente |
| ALIGN-039 | M6 | I | 1–8 | R01, R02, R03 | IN_PROGRESS | Este documento; pendiente de revisión independiente y de revisión del usuario (`execution/evidence/ALIGN-039/aprobacion.md`) |
| ALIGN-040 | M6 | I | 1–8 | R02, R03, R21 | PLANNED | Pendiente |
| ALIGN-041 | M6 | I | 1–8 | R21 | PLANNED | Pendiente |
| ALIGN-042 | M6 | VA | 7 | R22, R26 | PLANNED | Pendiente |
| ALIGN-043 | M6 | I | — | R01–R28 | BLOCKED | Pendiente: bloqueado (Aprobacion explicita (total o parcial) de PROPOSED-REQUIREMENTS-CHANGES.md por el usuario) |
| ALIGN-044 | M6 | I | 1–8 | R20, R21, R25 | PLANNED | Pendiente |
| ALIGN-045 | R | I | 7 | R22 | PLANNED | Fuera del alcance aprobado (`APPROVAL.json`: operacion restringida); sin evidencia |
| ALIGN-046 | R | I | 1, 2 | R10, R13 | PLANNED | Fuera del alcance aprobado (`APPROVAL.json`: operacion restringida); sin evidencia |
| ALIGN-047 | M9 | I | 6 | R33 | IN_REVIEW | Pendiente: en revisión independiente; evidencia aún no registrada en `STATE.json` |
| ALIGN-048 | M8 | I | 3, 8 | R35 | IN_PROGRESS | Pendiente: en corrección tras revisión CHANGES_REQUESTED (`execution/evidence/ALIGN-048/review.md`) |
| ALIGN-050 | E | E | 1, 7 | R26, R21, R25 | PLANNED | Fuera del alcance aprobado (`APPROVAL.json`: evolucion (E)); sin evidencia |
| ALIGN-051 | M6 | I | 1–8 | R02, R20, R21 | PLANNED | Pendiente |
| ALIGN-052 | M7 | I | 1, 7 | R14, R22, R26, R36 | PLANNED | Pendiente |
| ALIGN-053 | M7 | I | 1, 7 | R14, R12, R36 | PLANNED | Pendiente |
| ALIGN-054 | M7 | I | 1 | R12, R13, R28, R36 | PLANNED | Pendiente |
| ALIGN-055 | M7 | I | 1, 6 | R06, R14, R27, R36 | PLANNED | Pendiente |
| ALIGN-056 | M7 | I | 1 | R14, R36 | PLANNED | Pendiente |
| ALIGN-057 | M7 | I | 1, 6, 7 | R13, R19, R28, R36 | PLANNED | Pendiente |
| ALIGN-058 | M7 | I | 1, 2, 3, 6 | R13, R18, R20, R36 | PLANNED | Pendiente |
| ALIGN-059 | M7 | I | 7 | R20, R22, R36 | PLANNED | Pendiente |
| ALIGN-060 | M7 | I | 1 | R14, R37 | PLANNED | Pendiente |
| ALIGN-061 | M8 | I | 2, 3 | R09, R11, R35 | PLANNED | Pendiente |
| ALIGN-062 | M8 | I | 3, 8 | R16, R35 | PLANNED | Pendiente |
| ALIGN-063 | M8 | I | 3 | R15, R35 | PLANNED | Pendiente |
| ALIGN-064 | M8 | I | 3, 6 | R07, R15, R35 | PLANNED | Pendiente |
| ALIGN-065 | M9 | I | 6 | R33 | PLANNED | Pendiente |
| ALIGN-066 | M9 | I | 6, 7 | R29, R33 | PLANNED | Pendiente |
| ALIGN-067 | E | E | 6, 7 | R33 | PLANNED | Fuera del alcance aprobado (`APPROVAL.json`: evolucion (E)); sin evidencia |
| ALIGN-068 | E | E | 6 | R33 | PLANNED | Fuera del alcance aprobado (`APPROVAL.json`: evolucion (E)); sin evidencia |
| ALIGN-069 | M2 | I | 7 | R22, R26, R38 | PLANNED | Pendiente |
| ALIGN-070 | M8 | I | 3, 6 | R20, R35 | PLANNED | Pendiente |
| ALIGN-071 | M9 | I | 6, 7 | R20, R33 | PLANNED | Pendiente |
<!-- MATRIZ-TICKETS:FIN -->

## 6. Inconsistencias y pendientes para otros tickets

| # | Hallazgo | Para |
|---|---|---|
| 1 | `requirements.md` R01 dice que no hay estudio comparativo; la tesis lo contiene (§2). La propuesta de cambio ya existe (`PROPOSED-REQUIREMENTS-CHANGES.md` §2, fila R01) | ALIGN-043 (bloqueado) |
| 2 | R30 y R34 no están en el frontmatter de ningún ticket (§5.2) | ALIGN-043 |
| 3 | El DOCX no tiene Bibliografía: las citas de R01 son autor-fecha sin lista de referencias | ALIGN-041 |
| 4 | `[T02.R07]` prevé un canal "con identificación del usuario"; el alcance aprobado es un chat sin identificación (canal parcial) y deja la consulta de cuenta como evolución (067) | ALIGN-040 |
| 5 | `[P0058]` y `[P0071]` declaran desarrolladas capacidades que el código de `36f35b4` tenía parciales o incorrectas (§4.5) | ALIGN-040 |
| 6 | La cabecera de [reglas-decision-v1.md](reglas-decision-v1.md) todavía dice que la escala de intensidad está "pendiente de ALIGN-003 (no aprobado todavía por el usuario)"; ALIGN-003 se aprobó el 2026-10-30T00:15Z sin cambios a la escala | Próximo ticket que edite ese documento |
| 7 | La fecha de corte del relevamiento de mercado (12/08/2026) no se re-verificó; si la defensa es muy posterior, el usuario puede decidir actualizarla (sería investigación nueva, fuera de este ticket) | Usuario |

## 7. Qué no afirma este documento

- No agrega investigación de mercado: resume y vincula lo que la tesis ya contiene.
- No cierra R02 ni R03 por sí solo: queda sujeto a la revisión del usuario; el cambio de estado en `requirements.md` es de ALIGN-043.
- No afirma impacto, utilidad real ni desempeño predictivo: todas las mediciones previstas para el MVP son artificiales (§3.1).
- No contiene datos personales ni filas de la cartera real.

## 8. Control de versiones y regeneración

- **v1 (2026-10-30, ALIGN-039):** borrador inicial sobre `0658691`, pendiente de revisión independiente y de revisión del usuario.
- La §5 se generó desde el paquete del plan con el script guardado en `execution/evidence/ALIGN-039/gen_matrix.py.txt` (lee los frontmatter de `TICKETS/`, `TRACEABILITY.md`, `APPROVAL.json` y una copia de `STATE.json`; no escribe en el paquete). Para actualizarla: regenerar las tablas, reemplazar las de la §5, actualizar en la cabecera la hora y el sha256 de `STATE.json` y los estados citados en §2.3, §3.2, §4.4 y §4.5. La prueba [`quality/tests/test_academic_traceability.py`](../../quality/tests/test_academic_traceability.py) verifica que esas tablas sean coherentes entre sí.
