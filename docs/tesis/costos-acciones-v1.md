# Costos y capacidad por tipo de acción e intensidad (v1)

> **Borrador — pendiente de validación (ALIGN-034, compuerta antes de cerrar).** Todos los valores numéricos son **supuestos del equipo**. Ninguno es un costo observado del municipio. ALIGN-034 se cierra recién cuando los directores o el personal municipal validen los supuestos (§11).

| Campo | Valor |
|---|---|
| Ticket | ALIGN-034, plan `2026-10-28-v2` (M5, validación académica) |
| Versión | `1.0.0`, estado `BORRADOR_PENDIENTE_VALIDACION` |
| Parámetros | `contracts/action-costs.v1.json` (fuente única de valores, rangos, fuentes y fórmulas) |
| Prueba | `quality/tests/test_action_costs_contract.py` (biblioteca estándar): validez del JSON, fuentes o rótulo de supuesto, rangos, coherencia con las reglas v1 y con esta tabla, ejemplo calculado a mano |
| Escala de intensidad | ALIGN-003, aprobada por el usuario el 29/10/2026: 0–4, intensa ≥ 3 con aprobación de supervisor; rige solo con datos sintéticos |
| Reglas que se costean | `contracts/decision-rules.v1.json` (ALIGN-008): intervenciones, R1–R7, M1 y motivos de revisión |
| Consumidores | ALIGN-035 (protocolo de simulación), ALIGN-036 (simulador), ALIGN-051 (resultados en la tesis) |
| Datos personales y reales | Ninguno (ALIGN-004). No hay costos, dotaciones ni tiempos del municipio |

## 1. Qué es y qué no es

La gestión uniforme omite comparar el valor esperado del recupero de cada caso con el costo total de la acción destinada a obtenerlo `[P0148]`, `[P0143]`. El objetivo 4 pide estimar ese costo por tipo de acción y segmento `[P0192]`, y la tabla de trazabilidad prevé validarlo verificando los parámetros contra la normativa usada `[T02.R05]`. El objetivo 8 compara la gestión priorizada con la uniforme a igual capacidad, y para eso necesita los costos `[T02.R09]`.

Esta versión es una **tabla paramétrica**:

- Da el costo de cada acción en **horas-persona por rol** y la **capacidad operativa** de cada rol en horas por mes, para la simulación de ALIGN-035/036.
- **No son costos observados.** La cartera no tiene costos ni registro de gestiones (plan v2 §7.7). Los costos, a diferencia de las probabilidades, "son valoraciones de las consecuencias que alguien debe adoptar" `[P0205]`. Por eso cada supuesto se valida con personas antes de cerrar el ticket.
- **Pesos solo con fuente.** Ningún importe en pesos tiene fuente verificable en esta versión: todos quedan `PENDIENTE_FUENTE`, sin cifra y nunca como 0.
- **Riesgo: precisión aparente.** "0,25 h" parece medido y no lo es. Cada supuesto lleva un rango de sensibilidad, y la simulación informa resultados por rango, no un número único.
- **Excluidos:** optimizador; cifras sin fuente presentadas como observadas.

## 2. Tipos de fuente y reglas de los valores

| Tipo de fuente | Qué exige |
|---|---|
| `NORMATIVA` | Ley, decreto o resolución vigente, con número, artículo y fecha de consulta |
| `ORDENANZA` | Ordenanza fiscal o tarifaria del municipio, con número, artículo y ejercicio `[P0123]` |
| `CONSULTA` | Dato informado por personal municipal o por los directores, con rol, fecha y referencia del registro |
| `SUPUESTO_DEL_EQUIPO` | Valor elegido por el equipo sin observación, con rango y justificación; se valida antes de cerrar ALIGN-034 |

Cada parámetro tiene uno de tres estados:

- `SUPUESTO`: valor y rango del equipo.
- `CON_FUENTE`: valor de una fuente `NORMATIVA`, `ORDENANZA` o `CONSULTA` (hoy ninguno).
- `PENDIENTE_FUENTE`: sin cifra hasta tener la fuente indicada.

Reglas comunes:

- min ≤ base ≤ max y min ≥ 0.
- Los importes en pesos nunca son supuestos.
- `null` significa "sin cifra", no 0.
- La unidad de caso es el **objeto tributario**, igual que en las reglas v1.

## 3. Acciones por intensidad

Cada acción de las reglas v1 tiene su fila. Las intensidades 3 y 4 solo existen como **propuesta humana**: el sistema nunca las sugiere. Las horas son por objeto. Los totales usan los valores base de §4 y, entre paréntesis, el mínimo y el máximo con todos los componentes en su extremo.

| Nivel | Acción (`id`) | Origen | Quién | Componentes (horas-persona) | Total base (mín.–máx.) | Costos directos en pesos |
|---|---|---|---|---|---|---|
| 0 | `MEJORAR_DATOS` | R1, R2 | Operador | `H_MEJORAR_DATOS` | 0,25 h (0,1–0,75) | — |
| 0 | `REVISION_JURIDICA` | R3 | Personal jurídico | `H_REVISION_JURIDICA` | 0,5 h (0,25–2) | — |
| 0 | `SEGUIMIENTO_SIN_GESTION` | R7 | Operador | `H_SEGUIMIENTO_SIN_GESTION` | 0 h (0–0,05) | — |
| 1 | `SEGUIMIENTO_RECORDATORIO` | R6 | Operador | `H_RECORDATORIO` | 0,1 h (0,02–0,25) | `ARS_CANAL_RECORDATORIO` (pendiente) |
| 1 | `RECORDATORIO_INFORMATIVO` | R5; M1 sobre R4 | Operador | `H_RECORDATORIO` | 0,1 h (0,02–0,25) | `ARS_CANAL_RECORDATORIO` (pendiente) |
| 2 | `CONTACTO_PERSONAL_Y_PLAN` | R4 | Operador | `H_CONTACTO_PERSONAL_Y_PLAN`; si regulariza, además `H_FORMALIZAR_PLAN` | 0,5 h (0,25–1,5) + 0,5 h si regulariza | `ARS_CANAL_CONTACTO_PERSONAL` (pendiente) |
| 3 | `INTIMACION_ADMINISTRATIVA` | Propuesta humana, aprobación de supervisor | Operador, personal jurídico, supervisor | `H_PROPUESTA_INTENSA` + `H_REVISION_JURIDICA` + `H_APROBACION_SUPERVISOR` + `H_EMISION_INTIMACION` | 2 h (0,85–5,5) | `ARS_NOTIFICACION_INTIMACION` (pendiente) |
| 4 | `DERIVACION_PROCURACION` | Propuesta humana, aprobación de supervisor | Operador, personal jurídico, supervisor | `H_PROPUESTA_INTENSA` + `H_REVISION_JURIDICA` + `H_APROBACION_SUPERVISOR` + `H_ARMADO_DERIVACION` | 2,25 h (1,1–6,5) **sin el proceso judicial** | Componentes de la vía judicial (§7, pendientes) |

- **Revisión humana caso por caso** (`H_REVISION_CASO`): se suma a la acción cuando la sugerencia exige revisión (`INDICIO_VULNERABILIDAD` o `SEVERIDAD_PARCIAL`), y a cada caso que una política simulada someta a revisión.
- **Etapas de las intensas.** `PROPUESTA` y `APROBACION` se cargan siempre. `EJECUCION` y sus costos directos se cargan **solo si el supervisor aprueba**. Una propuesta objetada consume 1,25 h: 0,5 de operador, 0,5 de personal jurídico y 0,25 de supervisor.
- **Identificadores nuevos.** `INTIMACION_ADMINISTRATIVA` y `DERIVACION_PROCURACION` son identificadores propios de este contrato, porque las reglas v1 no tienen intervenciones de nivel 3 y 4. ALIGN-018/021 pueden adoptarlos o mapearlos.
- **Orden de costos.** Con los valores base, el costo no decrece con la intensidad entre las acciones con contacto (0,1 ≤ 0,5 ≤ 2 ≤ 2,25). Que lo extrajudicial cueste menos que lo judicial lo dice la tesis `[P0080]`, `[P0081]`. El orden entre los niveles 1, 2 y 3 es un supuesto. Los rangos se superponen a propósito: la sensibilidad debe poder invertir el orden entre niveles vecinos.

## 4. Tabla paramétrica

Fecha de todos los supuestos: 29/10/2026. Referencia: "ALIGN-034, borrador sin consulta municipal". Las citas de la tesis respaldan **que la acción o el componente existen**, no el valor.

| Parámetro | Qué mide | Rol | Unidad | Base | Rango | Estado y fuente | Justificación |
|---|---|---|---|---|---|---|---|
| `H_MEJORAR_DATOS` | Buscar o verificar datos en registros internos, sin contacto | Operador | h-persona por caso | 0,25 | 0,1–0,75 | Supuesto del equipo | De una consulta rápida en un sistema único a una búsqueda sin éxito en varias fuentes. Mejorar los datos de contacto puede aumentar el cobro `[P0257]` |
| `H_REVISION_JURIDICA` | Verificar estado jurídico y posible prescripción | Personal jurídico | h-persona por caso | 0,5 | 0,25–2 | Supuesto del equipo | El máximo cubre objetos con muchas obligaciones. Perseguir deuda prescripta es un gasto sin retorno `[P0124]`, `[P0148]` |
| `H_SEGUIMIENTO_SIN_GESTION` | Seguimiento de un objeto sin vencidas (R7) | Operador | h-persona por caso | 0 | 0–0,05 | Supuesto del equipo | Sin tarea manual: se reevalúa en el próximo corte. El máximo contempla una mirada a la cola |
| `H_RECORDATORIO` | Adaptar el borrador, enviarlo fuera de EQUITAS y registrarlo (nivel 1) | Operador | h-persona por caso | 0,1 | 0,02–0,25 | Supuesto del equipo | ≈6 min de a uno; ≈1 min en envíos agrupados. Lo extrajudicial tiene bajo costo unitario `[P0081]`; hay canales automatizables de bajo costo `[P0257]` |
| `H_CONTACTO_PERSONAL_Y_PLAN` | Contacto personal con ofrecimiento de plan o asistencia (nivel 2), se concrete o no | Operador | h-persona por caso | 0,5 | 0,25–1,5 | Supuesto del equipo | Incluye intentos fallidos. Que cueste más que un recordatorio es un supuesto `[P0257]` |
| `H_FORMALIZAR_PLAN` | Registrar la adhesión a un plan de pago; solo si regulariza | Operador | h-persona por caso | 0,5 | 0,25–1 | Supuesto del equipo | El régimen de planes lo fija la normativa local `[P0086]`, `[P0123]`, `[P0134]` |
| `H_REVISION_CASO` | Revisión humana caso por caso | Operador | h-persona por caso | 0,25 | 0,1–0,5 | Supuesto del equipo | Mínimo > 0 a propósito: una revisión sin tiempo no es supervisión significativa `[P0220]` |
| `H_PROPUESTA_INTENSA` | Propuesta de nivel 3 o 4 con la lista de control de ALIGN-003 | Operador | h-persona por caso | 0,5 | 0,25–1 | Supuesto del equipo | Casillas o códigos, sin texto libre sobre el hogar. El estado jurídico se cuenta en `H_REVISION_JURIDICA` |
| `H_APROBACION_SUPERVISOR` | Aprobar u objetar una propuesta intensa con registro | Supervisor | h-persona por caso | 0,25 | 0,1–0,5 | Supuesto del equipo | Mínimo > 0: hace falta tiempo, información y autoridad para cambiar la decisión `[P0220]` |
| `H_EMISION_INTIMACION` | Emitir y notificar la intimación aprobada | Operador | h-persona por caso | 0,75 | 0,25–2 | Supuesto del equipo | Forma y medio según la normativa local `[P0082]`, `[P0123]` |
| `H_ARMADO_DERIVACION` | Liquidación o boleta de deuda y legajo para procuración | Operador | h-persona por caso | 1 | 0,5–3 | Supuesto del equipo | La liquidación sirve de título `[P0076]`; la procuración impulsa el cobro `[P0087]`. Sin el proceso judicial |
| `N_OPERADORES` | Operadores que dedican parte de su jornada a la mora | Operador | personas | 2 | 1–4 | Supuesto del equipo | Capacidad operativa limitada y estructura reducida `[P0138]`, `[P0178]`. No es la dotación de ningún municipio |
| `H_OPERADOR_MES` | Horas por operador y por mes dedicadas a la mora | Operador | h-persona por mes y persona | 60 | 20–120 | Supuesto del equipo | ≈14 h por semana; de ≈5 a ≈28 h por semana. La mora compite con otras tareas `[P0178]` |
| `H_SUPERVISOR_MES` | Horas de supervisión por mes para propuestas intensas | Supervisor | h-persona por mes | 8 | 2–20 | Supuesto del equipo | ≈2 h por semana de una jefatura con otras funciones |
| `H_JURIDICO_MES` | Horas jurídicas por mes para la mora | Personal jurídico | h-persona por mes | 8 | 2–20 | Supuesto del equipo | ≈2 h por semana. Limita juntas la cola de revisión jurídica y las verificaciones de intensas |
| `ARS_VALOR_HORA_PERSONA` | Costo de una hora-persona, por rol si difiere | — | ARS por hora-persona | — | — | Pendiente de fuente: consulta al municipio | Sin cifra |
| `ARS_CANAL_RECORDATORIO` | Costo directo del canal por recordatorio | — | ARS por caso | — | — | Pendiente de fuente: consulta (tarifa del canal) | Sin cifra |
| `ARS_CANAL_CONTACTO_PERSONAL` | Costo directo de llamadas o traslados | — | ARS por caso | — | — | Pendiente de fuente: consulta | Sin cifra |
| `ARS_NOTIFICACION_INTIMACION` | Costo del medio de notificación de la intimación | — | ARS por caso | — | — | Pendiente de fuente: ordenanza o consulta `[P0123]` | Sin cifra |
| `ARS_TASA_DE_JUSTICIA` | Tasa de justicia `[P0149]` | — | ARS | — | — | Pendiente de fuente: normativa provincial vigente | Sin cifra; la tesis nombra el componente, no la norma |
| `ARS_APORTES_CAJA_Y_COLEGIO` | Aportes a la caja previsional y al colegio de abogados `[P0149]` | — | ARS | — | — | Pendiente de fuente: normativa vigente | Sin cifra |
| `ARS_HONORARIOS_LETRADOS_Y_PROCURADORES` | Honorarios de letrados y procuradores `[P0149]` | — | ARS | — | — | Pendiente de fuente: régimen arancelario o contrato de procuración | Sin cifra; la procuración externa suele pactar un porcentaje de lo cobrado `[P0092]`, `[P0178]` |
| `ARS_HONORARIOS_OTROS_PROFESIONALES` | Martilleros, tasadores y otros profesionales, según el caso `[P0149]` | — | ARS | — | — | Pendiente de fuente: normativa o consulta | Sin cifra |
| `ARS_MEDIDAS_CAUTELARES` | Gastos de medidas cautelares `[P0149]` | — | ARS | — | — | Pendiente de fuente: normativa o consulta | Sin cifra |
| `MESES_DURACION_PROCESO` | Tiempos propios del proceso `[P0149]` | — | meses | — | — | Pendiente de fuente: consulta a la procuración | Sin cifra |

## 5. Revisión humana y aprobación

- La revisión caso por caso que exigen las reglas v1 cuesta `H_REVISION_CASO` además de la acción. Se cuenta igual cuando la revisión **baja** la intensidad: la salvaguarda no es gratuita, y la simulación debe mostrar su costo.
- Toda acción intensa suma tres cosas: la propuesta del operador con la lista de control, la verificación jurídica y la decisión del supervisor. Si el supervisor objeta, se pierden esas 1,25 h (base) y no hay ejecución.
- Los mínimos de revisión y aprobación son mayores que 0. La supervisión significativa exige tiempo disponible, competencia, información y autoridad efectiva `[P0220]`. Un rango que llegara a 0 simularía una aprobación simbólica.

## 6. Capacidad operativa

La capacidad se modela como horas de trabajo por rol. La tesis describe un antecedente que tomó la capacidad de cada organización en horas como restricción que debía respetarse en todo momento `[P0265]`. Los valores son supuestos.

| Fondo (por mes) | Fórmula | Base | Rango |
|---|---|---|---|
| Operador | `N_OPERADORES` × `H_OPERADOR_MES` | 120 h | 20–480 h |
| Supervisor | `H_SUPERVISOR_MES` | 8 h | 2–20 h |
| Personal jurídico | `H_JURIDICO_MES` | 8 h | 2–20 h |

Reglas de uso:

1. Cada componente consume horas del fondo de su rol en el mes de su etapa.
2. Una acción se ejecuta solo si todos los fondos que necesita tienen horas en ese mes; si no, pasa al mes siguiente.
3. Las horas no usadas no se acumulan (supuesto).
4. **Igual capacidad:** todas las políticas comparadas usan los mismos fondos y valores en cada corrida.

Con los valores base, el fondo de operador alcanza para 1200 recordatorios o 240 contactos personales por mes. El de supervisor alcanza para 32 aprobaciones. El jurídico, para 16 verificaciones, compartidas entre la cola R3 y las acciones intensas. Esa última restricción es la más estrecha de la tabla y conviene validarla primero (§11).

## 7. Vía judicial: componentes sin cifras

La tesis enumera los costos que agrega la ejecución fiscal `[P0149]`. Esta versión los lista **sin cifras**: ninguna fuente verificable las da.

| Componente | Texto de la tesis `[P0149]` | Parámetro |
|---|---|---|
| Tasa de justicia | "la tasa de justicia" | `ARS_TASA_DE_JUSTICIA` |
| Aportes | "aportes a la caja previsional y al colegio profesional de los abogados intervinientes" | `ARS_APORTES_CAJA_Y_COLEGIO` |
| Honorarios de letrados y procuradores | "honorarios de los letrados y procuradores" | `ARS_HONORARIOS_LETRADOS_Y_PROCURADORES` |
| Otros profesionales | "según el caso, honorarios de martilleros, tasadores y demás profesionales que intervienen en el juicio" | `ARS_HONORARIOS_OTROS_PROFESIONALES` |
| Medidas cautelares | "los gastos de las medidas cautelares" | `ARS_MEDIDAS_CAUTELARES` |
| Tiempos del proceso | "los tiempos propios del proceso" | `MESES_DURACION_PROCESO` |

- **Quién los soporta: no se determina en v1.** La tesis advierte dos cosas. Para el organismo, pueden volver deficitario el recupero de deudas pequeñas o de baja recuperabilidad `[P0149]`. Para el contribuyente, se agregan a la deuda que se le reclama si el caso escala `[P0181]`. La distribución depende de la normativa procesal y del resultado del proceso.
- **En la simulación**, mientras estén pendientes, se informan como "costo judicial no estimado", nunca como 0. La derivación carga solo sus horas municipales.

## 8. Verificación contra la normativa (`[T02.R05]`)

La tesis toma Córdoba como ámbito de referencia `[P0134]` y exige una herramienta paramétrica `[P0136]`. La normativa que valida estos parámetros es la del municipio que use la herramienta. No se asume que la cartera sintética represente a un municipio concreto. Esta versión **no cita normas que la tesis no cite**.

| Norma, según la tesis | Qué dice la tesis | Qué parámetros permite verificar |
|---|---|---|
| Ley provincial 9024 (Córdoba) | Regula la ejecución fiscal por juicio ejecutivo; la liquidación expedida por funcionario autorizado es título suficiente `[P0076]`, `[P0080]`, `[P0134]` | `H_ARMADO_DERIVACION`, componentes de §7 |
| Código Tributario Provincial, Ley 6006 (t. o. 2023) | Rige la ejecución fiscal junto con la Ley 9024 `[P0080]`, `[P0134]` | Componentes de §7 |
| Código Procesal Civil y Comercial de Córdoba, Ley 8465 | Se aplica supletoriamente `[P0080]`, `[P0134]` | Componentes de §7 |
| Ordenanza 10.363 (Código Tributario de la ciudad de Córdoba) y ordenanza tarifaria anual | Definen tributos, accesorios por mora y regímenes de facilidades; son la fuente de los parámetros locales `[P0123]`, `[P0134]` | `H_FORMALIZAR_PLAN`, `H_EMISION_INTIMACION`, `ARS_NOTIFICACION_INTIMACION` |

Las normas que fijan la tasa de justicia, los aportes y los honorarios se identifican durante la validación. Cada parámetro lo indica en su `fuente_requerida`.

## 9. Uso en la simulación (ALIGN-035/036)

- **Independencia.** No depende del mundo sintético de ALIGN-048: costos y capacidad sirven para cualquier población y modelo de pago que fije ALIGN-035. Una capacidad de gestiones que use el generador del historial sintético es un parámetro de ese generador y no reemplaza a esta.
- **Cuándo se cargan.** Al ejecutar la acción, con independencia del resultado. Solo `H_FORMALIZAR_PLAN` depende de una regularización. Cuánto cuenta una regularización como recupero lo declara ALIGN-035.
- **Unidad.** Horas-persona por rol. Mientras los importes estén pendientes, la simulación informa la eficiencia como **recupero por hora-persona** y **no informa recupero neto en pesos**.
- **Lista de control.** Antes de una intensa hay que haber ofrecido una alternativa asistida. Su costo es el de la acción que la ofreció y no se duplica.
- **Revisión jurídica previa.** Si el objeto ya tuvo una dentro del horizonte, ALIGN-035 declara si se reutiliza o se repite.
- **Sensibilidad.**
  - Un parámetro por vez en {mín., base, máx.}, con los demás en su base.
  - Para Monte Carlo se sugiere `triangular(mín., base, máx.)`.
  - Los parámetros pendientes no se muestrean.

## 10. Ejemplo calculado a mano

Valores base de §4. La prueba los recalcula desde los componentes del JSON.

| Caso | Operador | Personal jurídico | Supervisor | Total |
|---|---|---|---|---|
| Recordatorio (nivel 1) | 0,1 | — | — | 0,1 h |
| Contacto y plan (nivel 2) que termina en regularización | 0,5 + 0,5 | — | — | 1 h |
| Contacto y plan con revisión humana obligatoria por `SEVERIDAD_PARCIAL` (mínimo en banda ALTA, R4) | 0,5 + 0,25 | — | — | 0,75 h |
| Recordatorio con revisión obligatoria por `INDICIO_VULNERABILIDAD` (M1 sobre R4, solo sintético) | 0,1 + 0,25 | — | — | 0,35 h |
| Intimación aprobada (nivel 3) | 0,5 + 0,75 | 0,5 | 0,25 | 2 h |
| Propuesta intensa objetada | 0,5 | 0,5 | 0,25 | 1,25 h |
| Derivación aprobada (nivel 4), sin proceso judicial | 0,5 + 1 | 0,5 | 0,25 | 2,25 h + costo judicial no estimado |

Ejemplo de capacidad: con 120 h de operador, 8 h de supervisor y 8 h jurídicas, 10 intimaciones aprobadas consumen 12,5 h de operador, 5 h jurídicas y 2,5 h de supervisor. El cuello de botella es el fondo jurídico: con 16 verificaciones por mes, no caben más de 16 propuestas intensas aunque sobren horas de operador.

## 11. Validación pendiente (compuerta antes de cerrar)

Pueden validar los directores de la tesis o personal municipal que conozca la gestión de la mora. Para cada supuesto se registra:

- **Decisión:** `VALIDADO`, `AJUSTADO` (valor nuevo con su fuente y fecha) u `OBJETADO`.
- **Quién y cuándo:** rol de quien valida, fecha y referencia del registro (acta, correo o mensaje), sin otros datos personales.

Registrar la validación crea una versión nueva del contrato, que no se edita en silencio. Preguntas concretas:

1. ¿Los tiempos por caso de §4 están en el orden de magnitud correcto? Interesan sobre todo el contacto personal (0,5 h), la intimación (0,75 h más 1,25 h de propuesta y aprobación) y el armado de la derivación (1 h).
2. ¿Cuántas personas y horas por mes dedica a la mora un organismo como los que describe la tesis (2 operadores × 60 h; 8 h de supervisión; 8 h jurídicas)? ¿El fondo jurídico es el cuello de botella real?
3. ¿Las acciones intensas pasan por verificación jurídica cada vez, o alcanza una verificación previa vigente?
4. ¿Hay fuente con fecha para el costo de la hora-persona, de un recordatorio y de la notificación de una intimación? ¿Quién podría informarlo?
5. ¿Qué normas fijan hoy la tasa de justicia, los aportes y los honorarios de la ejecución fiscal, y quién los soporta según el resultado?
6. ¿Es aceptable que, sin fuente en pesos, la simulación informe recupero por hora-persona y no recupero neto en pesos?

| Parámetro | Decisión | Rol de quien valida | Fecha | Referencia |
|---|---|---|---|---|
| (sin registros: pendiente) | | | | |

## 12. Limitaciones

- Ningún valor sale de observar una gestión real. La simulación que los use es una evaluación artificial: muestra coherencia interna bajo supuestos, no impacto real `[P0250]`, `[P0251]`.
- Los costos por caso son promedios por acción. No varían por tipo de objeto, monto ni segmento. El objetivo 4 menciona el segmento `[P0192]`: variarlo exige datos o una versión nueva.
- Las horas no incluyen tareas que no son acciones sobre un objeto: preparar plantillas, capacitar o atender consultas del canal.
- No se modelan los recargos e intereses que la mora acumula para el contribuyente `[P0181]`. Pertenecen a la deuda, no al costo de la acción.

## 13. Control de versiones

| Versión | Fecha | Cambio |
|---|---|---|
| 1.0.0 | 29/10/2026 | Borrador inicial (ALIGN-034), pendiente de validación. Cualquier ajuste de valores o fuentes, y el registro de la validación, crean una versión nueva; esta no se edita en silencio |
