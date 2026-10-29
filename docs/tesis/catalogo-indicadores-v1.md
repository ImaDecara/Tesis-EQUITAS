# Catálogo de indicadores visibles (v1)

| Campo | Valor |
|---|---|
| Ticket | ALIGN-013, plan `2026-10-28-v2` (M1) |
| Versión | v1, **provisional**: hereda el carácter provisional del [contrato de dominio][contrato] (ALIGN-007) y de las [reglas de decisión v1][reglas] (ALIGN-008) |
| Código descrito | `c17a1bf83bc71fc63dc720d6b2d2be90d5e65b4f`. Las pantallas y los componentes no cambiaron desde `36f35b4`, de modo que las citas `archivo:línea` del contrato siguen valiendo |
| Fuentes | Pantallas `front/app/**/page.tsx` y componentes `front/components/**`; contrato de dominio v1 (§7, en especial §7.9); reglas de decisión v1; plan v2 §4 y §7 |
| Consumidores | ALIGN-014 (tablero y vistas analíticas según este catálogo), ALIGN-010/021 (colas por intervención), ALIGN-012 (rótulos), tesis (capítulo de indicadores) |
| Arquitectura | [ADR-001: reglas y capas][adr] |
| Datos personales | Ninguno. Las cifras citadas son agregados del informe de input que ya figuran en el contrato |

## 1. Propósito y cómo leer cada entrada

El tablero mezcla cifras que parecen iguales y no lo son: "críticos" y "deuda crítica" tienen poblaciones distintas ([KPI-55](#kpi-55) y [KPI-56](#kpi-56)), "Deuda asociada" significa tres cosas según la pantalla ([KPI-35](#kpi-35), [KPI-46](#kpi-46), [KPI-48](#kpi-48)) y el "riesgo" es un índice heredado de severidad, no una probabilidad ni un dato social `[P0105]`, `[P0108]`. Este catálogo da a **cada cifra visible** una definición enlazable y dice qué decisión apoya y qué **no** significa `[P0211]`, `[P0228]`.

Cada entrada tiene un ancla estable (`#kpi-NN`) y estos campos:

- **Pantallas:** dónde se muestra, con su rótulo actual.
- **Fórmula:** cómo se calcula hoy (`c17a1bf`), con el archivo que la implementa.
- **Unidad:** objetos, personas, obligaciones, ARS, días, puntos 0–100 o porcentaje. Los puntajes son **puntos, no porcentajes**.
- **Población:** el universo sobre el que se cuenta o suma (todos los objetos leídos, los filtrados, los de una categoría…).
- **Corte:** de qué fecha depende el valor y su procedencia temporal ([contrato §5.1][c51]). Mientras `as_of` sea `NO_INTEGRADO`, ningún indicador tiene corte municipal: se rotula según la procedencia.
- **Cobertura:** qué filas de la población tienen el dato observado y qué pasa hoy con las demás. Las [reglas de agregación][c41] exigen calcular sobre las filas observadas y mostrar al lado cuántas quedaron fuera ("n de N con dato"); hoy ninguna pantalla lo hace.
- **Decisión que apoya:** la decisión operativa concreta que la cifra informa. Una cifra que no apoya ninguna decisión se marca así.
- **No significa:** las lecturas incorrectas que la cifra invita.
- **Contrato:** la entrada del diccionario de ALIGN-007 que fija el significado de la variable.

**Comportamiento actual y brechas.** El catálogo describe lo que hoy calcula el código. Cuando el contrato ya prevé un cambio de comportamiento (ceros reemplazados con `||`, persona sin detalle tratada como riesgo 0, bases vacías mostradas como 0 %), la entrada cita la brecha del [contrato §10][c10] y el ticket que la corrige; no anticipa cómo quedará la pantalla. ALIGN-011 (mapeadores) no está integrado en la base descrita.

**Regla de incorporación.** Ninguna cifra nueva se muestra sin una entrada aquí. Las vistas de ALIGN-014 y las colas de ALIGN-010/021 que reemplacen indicadores heredados por las dimensiones de las [reglas v1][reglas] (severidad, banderas, intervención, prioridad dentro de la cola) agregan sus entradas en una versión nueva de este catálogo.

## 2. Inventario de cifras visibles

Inventario completo de `front/app/**/page.tsx` y `front/components/**`. La columna **Expresión** lista lo que el código muestra; la columna **Entrada** lleva a su definición. No se inventarían la paginación ("Mostrando a–b de n", página actual; no es un dato de dominio, [contrato §7.9][c79]), las claves usadas solo para enlaces y `key` de React, las opciones de los formularios de filtro ni la navegación.

| Pantalla (archivo) | Rótulo visible | Expresión | Entrada |
|---|---|---|---|
| Tablero (`front/app/page.tsx`) | Objetos prioritarios | `dashboard.priorityCases` | [KPI-19](#kpi-19) |
| Tablero (`front/app/page.tsx`) | Deuda total | `dashboard.totalDebt` | [KPI-20](#kpi-20) |
| Tablero (`front/app/page.tsx`) | Casos vencidos | `dashboard.overdueCases` | [KPI-21](#kpi-21) |
| Tablero (`front/app/page.tsx`) | Casos sin contacto; Con contacto; "Hay n casos bloqueados por falta de contacto" | `dashboard.withoutContactCases`, `dashboard.withContactCases` | [KPI-22](#kpi-22) |
| Tablero (`front/app/page.tsx`) | Recomendacion urgente | `dashboard.urgentRecommendationCases` | [KPI-23](#kpi-23) |
| Tablero (`front/app/page.tsx`) | "n% de los objetos estan en riesgo alto" | `highRiskShare` | [KPI-24](#kpi-24) |
| Tablero (`front/app/page.tsx`) | "Los 5 objetos con mayor deuda concentran n% del saldo total" | `topDebtConcentration` | [KPI-25](#kpi-25) |
| Tablero (`front/app/page.tsx`) | Recomendaciones sugeridas: "n casos (p%)" y barra | `count`, `percentage` | [KPI-26](#kpi-26) |
| Tablero (`front/app/page.tsx`) | «"<categoría>" concentra n% de los objetos actuales» | `dominantRecommendation` | [KPI-27](#kpi-27) |
| Tablero (`front/app/page.tsx`) | Distribucion por riesgo | `dashboard.byRisk` | [KPI-28](#kpi-28) |
| Tablero (`front/app/page.tsx`) | Objetos por tipo | `dashboard.byDebtorType` | [KPI-29](#kpi-29) |
| Tablero (`front/app/page.tsx`) | Top de deuda | `dashboard.topDebtChart` | [KPI-30](#kpi-30) |
| Tablero (`front/app/page.tsx`) | A quien gestionar primero; Casos sin contacto (top 5): Objeto, Riesgo, Deuda, Atraso, Recomendacion, "Score n" | `debtor.riskScore`, `debtor.risk`, `debtor.totalDebt`, `debtor.overdueDays`, `debtor.recommendationType`, `debtor.priorityScore` | [KPI-31](#kpi-31), [KPI-09](#kpi-09), [KPI-01](#kpi-01), [KPI-03](#kpi-03), [KPI-13](#kpi-13), [KPI-11](#kpi-11) |
| Objetos (`front/app/debtors/page.tsx`) | "n / N registros" | `filteredDebtors.length`, `debtors.length` | [KPI-51](#kpi-51) |
| Objetos (`front/app/debtors/page.tsx`) | Deuda total | `debtor.totalDebt` | [KPI-01](#kpi-01) |
| Objetos (`front/app/debtors/page.tsx`) | Estado | `debtor.status` | [KPI-14](#kpi-14) |
| Objetos (`front/app/debtors/page.tsx`) | Personas | `debtor.peopleCount` | [KPI-06](#kpi-06) |
| Objetos (`front/app/debtors/page.tsx`) | Contacto | `debtor.hasContact` | [KPI-08](#kpi-08) |
| Objetos (`front/app/debtors/page.tsx`) | Riesgo | `debtor.risk`, `debtor.riskScore` | [KPI-09](#kpi-09) |
| Objetos (`front/app/debtors/page.tsx`) | "Prioridad <banda>", "Score n" | `debtor.priorityLevel`, `debtor.priorityScore` | [KPI-12](#kpi-12), [KPI-11](#kpi-11) |
| Objetos (`front/app/debtors/page.tsx`) | Recomendacion y motivo | `debtor.recommendationType`, `debtor.recommendationReason` | [KPI-13](#kpi-13) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | Riesgo (cabecera y tarjeta) | `debtor.risk`, `debtor.riskScore` | [KPI-09](#kpi-09) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | Deuda total; Deuda vencida | `debtor.totalDebt`, `debtor.overdueDebt` | [KPI-01](#kpi-01), [KPI-02](#kpi-02) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | Atraso ("n dias", resumen y lectura operativa) | `debtor.maxDaysOverdue` | [KPI-03](#kpi-03) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | Estado | `debtor.status` | [KPI-14](#kpi-14) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | Contacto: Disponible / Faltante | `debtor.hasContact` | [KPI-08](#kpi-08) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | "n persona(s) asociada(s)" | `debtor.peopleCount` | [KPI-06](#kpi-06) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | "<banda> (score n)" | `debtor.priorityLevel`, `debtor.priorityScore` | [KPI-12](#kpi-12), [KPI-11](#kpi-11) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | Recomendacion actual / sugerida, texto y motivo | `debtor.recommendationType`, `debtor.recommendation`, `debtor.recommendationReason` | [KPI-13](#kpi-13) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | Perfil: Deuda total; Deuda vencida | `profile.totalDebt`, `profile.overdueDebt` | [KPI-01](#kpi-01), [KPI-02](#kpi-02) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | Perfil: Cantidad de deudas | `profile.debtCount` | [KPI-05](#kpi-05) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | Perfil: Antiguedad | `profile.antiquityDays` | [KPI-04](#kpi-04) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | Perfil: Contactos disponibles | `profile.availableContacts` | [KPI-07](#kpi-07) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | Perfil: Nivel socioeconomico / riesgo | `profile.risk`, `profile.riskScore`, `profile.socioeconomicLevel` | [KPI-10](#kpi-10) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | Personas asociadas, contactos y deudas: campos de registro | `person.name`, `person.document`, `person.priority`, `person.relation`, `person.contact`, `contact.personId`, `contact.channel`, `contact.value`, `contact.isActive`, `debt.originalAmount`, `debt.updatedAmount`, `debt.period`, `debt.dueDate`, `debt.status` | [Campos de registro](#campos-de-registro) |
| Casos prioritarios (`front/app/priority-cases/page.tsx`) | "n casos" | `filteredCases.length` | [KPI-51](#kpi-51) |
| Casos prioritarios (`front/app/priority-cases/page.tsx`) | Ranking operativo: Riesgo, Score / prioridad, Atraso, Deuda total, Contacto, Recomendacion | `debtor.risk`, `debtor.riskScore`, `debtor.priorityScore`, `debtor.priorityLevel`, `debtor.maxDaysOverdue`, `debtor.totalDebt`, `debtor.hasContact`, `debtor.recommendationType` | [KPI-31](#kpi-31), [KPI-09](#kpi-09), [KPI-11](#kpi-11), [KPI-12](#kpi-12), [KPI-03](#kpi-03), [KPI-01](#kpi-01), [KPI-08](#kpi-08), [KPI-13](#kpi-13) |
| Personas (`front/app/people/page.tsx`) | "n / N personas" | `filteredPeople.length`, `people.length` | [KPI-51](#kpi-51) |
| Personas (`front/app/people/page.tsx`) | Riesgo bajo; Riesgo medio; Riesgo alto | `peopleDashboard.lowRiskCount`, `peopleDashboard.mediumRiskCount`, `peopleDashboard.highRiskCount` | [KPI-32](#kpi-32) |
| Personas (`front/app/people/page.tsx`) | Distribucion de riesgo individual | `peopleDashboard.individualRiskDistribution` | [KPI-32](#kpi-32) |
| Personas (`front/app/people/page.tsx`) | Sin contacto | `peopleDashboard.withoutContactCount` | [KPI-33](#kpi-33) |
| Personas (`front/app/people/page.tsx`) | "Con contacto: n" | `withContactCount` | [KPI-34](#kpi-34) |
| Personas (`front/app/people/page.tsx`) | Deuda asociada | `totalDebtAssociated` | [KPI-35](#kpi-35) |
| Personas (`front/app/people/page.tsx`) | "Riesgo promedio n / 100" | `averageRiskValue` | [KPI-36](#kpi-36) |
| Personas (`front/app/people/page.tsx`) | Top 5 personas con mayor riesgo | `peopleDashboard.topPeopleByRiskValue` | [KPI-37](#kpi-37) |
| Personas (`front/app/people/page.tsx`) | Riesgo individual; Puntaje | `person.individualRisk`, `person.riskValue` | [KPI-15](#kpi-15) |
| Personas (`front/app/people/page.tsx`) | Objetos / Objetos asociados | `person.debtorsCount` | [KPI-16](#kpi-16) |
| Personas (`front/app/people/page.tsx`) | Contacto disponible: Disponible / Faltante | `person.hasContact` | [KPI-17](#kpi-17) |
| Personas (`front/app/people/page.tsx`) | Deuda total asociada | `person.totalDebtAssociated` | [KPI-18](#kpi-18) |
| Personas (`front/app/people/page.tsx`) | Nombre; Documento | `person.name`, `person.document` | [Campos de registro](#campos-de-registro) |
| Riesgo (`front/app/risk-analysis/page.tsx`) | "Objetos con riesgo > 90" y tabla de 10 | `highRiskCases.length`, `highRiskCases` | [KPI-38](#kpi-38) |
| Riesgo (`front/app/risk-analysis/page.tsx`) | "Personas con puntaje alto" y tabla de 10 | `highIndividualRiskPeople.length`, `highIndividualRiskPeople` | [KPI-39](#kpi-39) |
| Riesgo (`front/app/risk-analysis/page.tsx`) | Distribucion de objetos por riesgo | `objectRiskDistribution` | [KPI-28](#kpi-28) |
| Riesgo (`front/app/risk-analysis/page.tsx`) | Distribucion de personas por riesgo individual | `peopleDashboard.individualRiskDistribution` | [KPI-32](#kpi-32) |
| Riesgo (`front/app/risk-analysis/page.tsx`) | Tablas: Riesgo, Deuda, Riesgo individual, Puntaje, Objetos | `debtor.risk`, `debtor.riskScore`, `debtor.totalDebt`, `person.individualRisk`, `person.riskValue`, `person.debtorsCount` | [KPI-09](#kpi-09), [KPI-01](#kpi-01), [KPI-15](#kpi-15), [KPI-16](#kpi-16) |
| Riesgo (`front/app/risk-analysis/page.tsx`) | Persona; documento | `person.name`, `person.document` | [Campos de registro](#campos-de-registro) |
| Deuda y mora (`front/app/debt-aging/page.tsx`) | Deuda total | `summary.totalDebt` | [KPI-20](#kpi-20) |
| Deuda y mora (`front/app/debt-aging/page.tsx`) | Deuda vencida | `summary.overdueDebt` | [KPI-40](#kpi-40) |
| Deuda y mora (`front/app/debt-aging/page.tsx`) | Promedio de atraso | `summary.averageOverdueDays` | [KPI-41](#kpi-41) |
| Deuda y mora (`front/app/debt-aging/page.tsx`) | Distribucion por atraso | `summary.agingDistribution` | [KPI-42](#kpi-42) |
| Deuda y mora (`front/app/debt-aging/page.tsx`) | Deuda por estado | `debtByStatusChart` | [KPI-43](#kpi-43) |
| Deuda y mora (`front/app/debt-aging/page.tsx`) | Top deuda por objeto; Top 10 mayor deuda | `topDebtChart`, `summary.topDebtCases` | [KPI-44](#kpi-44) |
| Deuda y mora (`front/app/debt-aging/page.tsx`) | Tablas: Deuda total, Deuda vencida, Atraso / Dias de atraso, Estado | `debtor.totalDebt`, `debtor.overdueDebt`, `debtor.maxDaysOverdue`, `debtor.status` | [KPI-01](#kpi-01), [KPI-02](#kpi-02), [KPI-03](#kpi-03), [KPI-14](#kpi-14) |
| Acciones (`front/app/recommended-actions/page.tsx`) | Tarjeta por recomendación: cantidad y monto | `item?.count`, `item?.debtAssociated` | [KPI-45](#kpi-45), [KPI-46](#kpi-46) |
| Acciones (`front/app/recommended-actions/page.tsx`) | Resumen: Cantidad de casos; Deuda asociada; "Riesgo promedio n / 100" | `group.count`, `group.debtAssociated`, `group.averageRisk` | [KPI-45](#kpi-45), [KPI-46](#kpi-46), [KPI-47](#kpi-47) |
| Acciones (`front/app/recommended-actions/page.tsx`) | Recomendacion; Casos destacados | `group.recommendation`, `group.highlightedCases` | [KPI-13](#kpi-13), [KPI-31](#kpi-31) |
| Sin contacto (`front/app/no-contact/page.tsx`) | Total sin contacto | `noContactCases.length` | [KPI-22](#kpi-22) |
| Sin contacto (`front/app/no-contact/page.tsx`) | Deuda asociada | `associatedDebt` | [KPI-48](#kpi-48) |
| Sin contacto (`front/app/no-contact/page.tsx`) | Riesgo alto sin contacto | `highRiskNoContact` | [KPI-49](#kpi-49) |
| Sin contacto (`front/app/no-contact/page.tsx`) | Sobre el total | `totalShare` | [KPI-50](#kpi-50) |
| Sin contacto (`front/app/no-contact/page.tsx`) | Listado: Riesgo, Deuda, Atraso | `debtor.risk`, `debtor.riskScore`, `debtor.totalDebt`, `debtor.maxDaysOverdue` | [KPI-31](#kpi-31), [KPI-09](#kpi-09), [KPI-01](#kpi-01), [KPI-03](#kpi-03) |
| Ingreso (`front/app/login/page.tsx`) | Casos criticos; Sin contacto; Deuda gestionada; barras Alto/Medio/Bajo | `metric.value`, `item.width` | [KPI-54](#kpi-54) |
| Varias pantallas (`front/app/**`) | Identificador / Objeto; Tipo; Descripcion | `debtor.identifier`, `debtor.type`, `debtor.description` | [Campos de registro](#campos-de-registro) |
| Gráficos (`front/components/charts/debtor-dashboard-charts.tsx`) | Valor de cada barra o sector | `row.value`, `row.label` | Entrada de la serie que recibe el gráfico ([KPI-28](#kpi-28), [KPI-29](#kpi-29), [KPI-30](#kpi-30), [KPI-32](#kpi-32), [KPI-42](#kpi-42), [KPI-43](#kpi-43), [KPI-44](#kpi-44)) |
| Gráficos (`front/components/charts/debtor-dashboard-charts.tsx`) | "n,n%" en la leyenda del anillo | `percentage` | [KPI-52](#kpi-52) |
| Gráficos (`front/components/charts/debtor-dashboard-charts.tsx`) | Barra o sector "Sin datos" | `rows` | [KPI-53](#kpi-53) |
| Insignias (`front/components/equitas/risk-badge.tsx`) | "ALTO (n)" | `Math.round(score)` | [KPI-09](#kpi-09) |
| Insignias (`front/components/people/person-risk-badge.tsx`) | "ALTO (n)" | `Math.round(score)` | [KPI-15](#kpi-15) |
| Insignias (`front/components/debtors/contact-availability-badge.tsx`) | Con contacto / Sin contacto | `hasContact` | [KPI-08](#kpi-08) |

## 3. Indicadores del objeto tributario (por fila)

La unidad es el **objeto tributario** (cuenta), no la persona ni el hogar ([contrato §2][c2]).

### <a id="kpi-01"></a>KPI-01 · Deuda total del objeto

- **Pantallas:** "Deuda total" / "Deuda" en Objetos, Ficha (resumen y perfil), Casos prioritarios, Deuda y mora, Riesgo, Sin contacto y tablas del tablero.
- **Fórmula:** total del perfil persistido (`debtor_profile.total_debt_amount`) o, si da 0 o falta, Σ `updatedAmount` de las obligaciones leídas (`front/lib/mappers/debtor-object-mapper.ts:445-451`).
- **Unidad:** ARS por objeto.
- **Población:** un objeto; sus obligaciones leídas.
- **Corte:** mixto (§5.1): persistido al momento de la carga o recalculado en la consulta; `as_of` no integrado.
- **Cobertura:** hoy no se informa. Un objeto sin perfil usa la suma; un total 0 observado se reemplaza por la suma (`||`) y un importe ilegible entra como 0 ([contrato §10][c10]; ALIGN-011 y ALIGN-024).
- **Decisión que apoya:** dimensionar el monto en juego de un caso; es el insumo de monto de la severidad v1 ([reglas §4][r4]).
- **No significa:** deuda exigible ni vencida (incluye obligaciones no vencidas), monto recuperable, ni deuda de una persona.
- **Contrato:** [FO01][c76], [PR01][c75], [DE05/DE06][c73].

### <a id="kpi-02"></a>KPI-02 · Deuda vencida del objeto

- **Pantallas:** "Deuda vencida" en Ficha (resumen y perfil) y tablas de Deuda y mora.
- **Fórmula:** `debtor_profile.overdue_debt_amount` o, si da 0 o falta, Σ `updatedAmount` de las obligaciones consideradas vencidas (`front/lib/mappers/debtor-object-mapper.ts:453-459`).
- **Unidad:** ARS por objeto.
- **Población:** obligaciones del objeto con estado vencido (inferido por vencimiento contra la fecha de carga o de consulta).
- **Corte:** mixto; "vencida" depende de `as_of`, hoy sustituido por el reloj de la carga o de la consulta.
- **Cobertura:** hoy no se informa. El estado de origen de la obligación no está integrado: las 56 286 obligaciones del corte figuran vencidas por inferencia ([DE10][c73]).
- **Decisión que apoya:** distinguir un objeto en mora de uno al día antes de sugerir una gestión.
- **No significa:** deuda exigible ni con estado jurídico verificado; tampoco el estado administrativo de origen.
- **Contrato:** [FO02][c76], [PR02][c75], [DE10][c73].

### <a id="kpi-03"></a>KPI-03 · Días de atraso del objeto

- **Pantallas:** "Atraso" / "Dias de atraso" en Ficha, Casos prioritarios, Sin contacto, Deuda y mora y "Casos sin contacto" del tablero (`overdueDays`).
- **Fórmula:** máximo de días desde `dueDate` entre las obligaciones vencidas, contados con el reloj de la consulta (`front/lib/mappers/debtor-object-mapper.ts:460-463`).
- **Unidad:** días.
- **Población:** obligaciones vencidas del objeto.
- **Corte:** mixto (conjunto de vencidas persistido o inferido; días con el reloj de la consulta); `as_of` no integrado.
- **Cobertura:** sin vencidas, hoy muestra 0 (contrato: `NO_APLICA`); un vencimiento ilegible cuenta 0 días (contrato: `INVALIDO`).
- **Decisión que apoya:** ordenar por antigüedad de la mora; insumo de antigüedad de la severidad v1 ([reglas §4][r4]).
- **No significa:** días desde la última gestión ni desde la emisión; tampoco prescripción (eso solo lo indica la bandera `VERIFICAR_PRESCRIPCION`, que pide verificación jurídica).
- **Contrato:** [FO05][c76].

### <a id="kpi-04"></a>KPI-04 · Antigüedad

- **Pantallas:** "Antiguedad" en el perfil de la Ficha.
- **Fórmula:** días desde el vencimiento más antiguo del objeto (`front/lib/services/debtor-data-service.ts:21-36`).
- **Unidad:** días.
- **Población:** obligaciones del objeto con vencimiento.
- **Corte:** recalculado en la consulta ("calculado al día de la consulta; corte no integrado").
- **Cobertura:** sin vencimientos, hoy 0 (contrato: `NO_INFORMADO_EN_ORIGEN`).
- **Decisión que apoya:** contexto del caso en la ficha; no ordena ninguna cola.
- **No significa:** atraso de la deuda vencida (puede incluir obligaciones al día) ni antigüedad de la relación con el contribuyente.
- **Contrato:** [FO06][c76].

### <a id="kpi-05"></a>KPI-05 · Cantidad de deudas

- **Pantallas:** "Cantidad de deudas" en el perfil de la Ficha.
- **Fórmula:** obligaciones leídas del objeto.
- **Unidad:** obligaciones.
- **Población:** obligaciones del objeto.
- **Corte:** no depende de una fecha.
- **Cobertura:** si la lectura de obligaciones falla, el valor es "no disponible", no 0 ([contrato §4.1][c41], regla 6).
- **Decisión que apoya:** dimensionar el trabajo administrativo del caso.
- **No significa:** cantidad de períodos fiscales (el período real no está integrado) ni cantidad de vencidas.
- **Contrato:** [FO03][c76].

### <a id="kpi-06"></a>KPI-06 · Personas asociadas

- **Pantallas:** "Personas" en Objetos; "n persona(s) asociada(s)" en la Ficha; nombres en Sin contacto y Casos prioritarios.
- **Fórmula:** relaciones activas persona–objeto.
- **Unidad:** personas.
- **Población:** relaciones del objeto.
- **Corte:** no depende de una fecha.
- **Cobertura:** todo objeto observado tiene al menos una relación; sin relaciones, `NO_INFORMADO_EN_ORIGEN`.
- **Decisión que apoya:** saber a quién corresponde contactar o verificar.
- **No significa:** integrantes de un hogar ni responsables con cuota legal (el porcentaje declarado no es una cuota verificada).
- **Contrato:** [FO07][c76], [RE01–RE03][c74].

### <a id="kpi-07"></a>KPI-07 · Contactos disponibles

- **Pantallas:** "Contactos disponibles" en el perfil de la Ficha.
- **Fórmula:** máximo entre el conteo del perfil, las personas con contacto activo y los contactos activos (`front/lib/mappers/debtor-object-mapper.ts:436-442`).
- **Unidad:** ambigua: mezcla contactos y personas.
- **Población:** contactos de las personas del objeto.
- **Corte:** no depende de una fecha.
- **Cobertura:** "disponible" = con valor cargado; validez y consentimiento `NO_INTEGRADO` (AU05).
- **Decisión que apoya:** si hay algún canal cargado para intentar un contacto.
- **No significa:** contactos válidos, vigentes ni con permiso de uso. La unidad mezclada es una brecha del contrato (unificación en ALIGN-011).
- **Contrato:** [FO08][c76], [PR06][c75], [AU05][c711].

### <a id="kpi-08"></a>KPI-08 · Contacto del objeto (con / sin contacto)

- **Pantallas:** "Contacto" (Disponible/Faltante, Con/Sin contacto) en Objetos, Casos prioritarios y Ficha.
- **Fórmula:** `contactCount > 0` ([KPI-07](#kpi-07)).
- **Unidad:** booleano.
- **Población:** un objeto.
- **Corte:** no depende de una fecha.
- **Cobertura:** "sin contacto" incluye tanto cero contactos cargados como contactos no leídos; hoy no se distinguen.
- **Decisión que apoya:** si el caso puede gestionarse con el contribuyente o primero requiere mejorar datos (cola `MEJORAR_DATOS` de las [reglas v1][r7]).
- **No significa:** que el contribuyente no quiera o no pueda ser contactado; la falta de contacto es una **bandera de calidad** (`SIN_CONTACTO_ACTIVO`), nunca severidad ([reglas §5][r5]).
- **Contrato:** [FO09][c76], [AU05][c711].

### <a id="kpi-09"></a>KPI-09 · Riesgo del objeto (puntaje y banda)

- **Pantallas:** insignia "ALTO/MEDIO/BAJO (n)" en Objetos, Ficha, Casos prioritarios, Riesgo, Sin contacto y tablero.
- **Fórmula:** índice heredado de severidad v0 del perfil (`socioeconomic_risk_level`: monto relativo al promedio del lote, mora, antigüedad, contactos y personas; `back/ETL/transform.py:535-597`); si no hay perfil, fallback 85/55/25 o 78/55/25 por señales (`front/lib/services/debtor-risk-calculator.ts:85-134`). Bandas: 0–39 BAJO, 40–69 MEDIO, 70–100 ALTO. La insignia redondea con `Math.round`.
- **Unidad:** puntos 0–100 (no %) y banda.
- **Población:** un objeto.
- **Corte:** persistido ("calculado el `<computed_at>`"; hoy "momento de cálculo desconocido") o inferido en la consulta cuando no hay perfil; relativo al lote de carga.
- **Cobertura:** hoy no se distingue el perfil observado del fallback: un objeto sin perfil recibe banda igual.
- **Decisión que apoya:** hoy, ordenar y filtrar casos; en v1 lo reemplaza la **severidad** 0–100 con bandas absolutas ([reglas §4][r4], ALIGN-010).
- **No significa:** probabilidad de pago o de incumplimiento, riesgo social ni vulnerabilidad. La falta de contacto **sube** el índice heredado (+15 en el ETL, 55 en el fallback): defecto declarado en el [contrato §10][c10] que corrigen las reglas v1.
- **Contrato:** [FO10][c76], [PR08][c75], [VP14][c79], [nombre heredado][c8] `socioeconomic_risk_level`.

### <a id="kpi-10"></a>KPI-10 · Nivel socioeconómico / riesgo

- **Pantallas:** tarjeta "Nivel socioeconomico / riesgo" del perfil en la Ficha: insignia de [KPI-09](#kpi-09) y el texto "No informado".
- **Fórmula:** insignia = KPI-09; texto = literal "No informado" (`front/lib/services/debtor-data-service.ts:41`).
- **Unidad:** banda y texto.
- **Población:** un objeto.
- **Corte:** el de KPI-09.
- **Cobertura:** la vulnerabilidad no existe en la cartera (`NO_INFORMADO_EN_ORIGEN`).
- **Decisión que apoya:** ninguna; el rótulo induce a error.
- **No significa:** nivel socioeconómico de nadie. El índice no es social; ALIGN-012 separa "Vulnerabilidad: no informada" en un bloque propio.
- **Contrato:** [FO11][c76], [AU01][c711], [mapa de nombres][c8].

### <a id="kpi-11"></a>KPI-11 · Score / prioridad (puntaje operativo heredado)

- **Pantallas:** "Score n" en Objetos y tablero; "Score / prioridad" en Casos prioritarios; "(score n)" en la Ficha.
- **Fórmula:** `min(total/250000, 4)·18 + min(días/30, 4)·10 + {30,18,8} por banda + (contacto ? 10 : −6) + {20,14,9,4} por recomendación`, piso 0 (`front/lib/mappers/debtor-object-mapper.ts:120-147`).
- **Unidad:** puntos 0–172 (no 0–100, no %).
- **Población:** un objeto.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** hereda los faltantes de KPI-01, KPI-03 y KPI-09.
- **Decisión que apoya:** hoy, el orden de "A quien gestionar primero" y del ranking ([KPI-31](#kpi-31)). En v1 lo reemplaza la **prioridad operativa 0–100 dentro de cada cola** ([reglas §8][r8]).
- **No significa:** urgencia comparable entre colas ni probabilidad; es distinto del `priority_score` 0–100 de Python ([PY02][c710]).
- **Contrato:** [FO13][c76].

### <a id="kpi-12"></a>KPI-12 · Prioridad (banda)

- **Pantallas:** "Prioridad <banda>" en Objetos, Casos prioritarios y Ficha.
- **Fórmula:** KPI-11 ≥ 105 ALTA, ≥ 70 MEDIA, resto BAJA (`front/lib/mappers/debtor-object-mapper.ts:107-117`).
- **Unidad:** banda.
- **Población:** un objeto.
- **Corte:** el de KPI-11.
- **Cobertura:** la de KPI-11.
- **Decisión que apoya:** hoy, marcar los objetos de [KPI-19](#kpi-19).
- **No significa:** que el caso deba recibir una acción intensa; la intensidad se decide por intervención y nunca supera 2 en forma automática ([reglas §7][r7]).
- **Contrato:** [FO14][c76].

### <a id="kpi-13"></a>KPI-13 · Recomendación

- **Pantallas:** "Recomendacion" (categoría, texto y motivo) en Objetos, Casos prioritarios, Ficha y tablero; filas de Acciones.
- **Fórmula:** reglas por banda de riesgo, contacto, deuda vencida y atraso ≥ 60 días (`front/lib/services/debtor-recommendation-generator.ts:19-73`). Cuatro categorías: Llamado prioritario, Mensaje recordatorio, Plan de pago / revision humana, Seguimiento posterior.
- **Unidad:** categoría de acción.
- **Población:** un objeto.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** sin contacto y riesgo ALTO produce "revision humana" urgente.
- **Decisión que apoya:** qué acción sugerir; en v1 la reemplaza la **intervención** con intensidad y canal requerido ([reglas §7][r7]).
- **No significa:** una decisión tomada ni una acción registrada: no existe registro de gestiones (AU03) y "revision humana" hoy es solo un texto.
- **Contrato:** [FO12][c76].

### <a id="kpi-14"></a>KPI-14 · Estado del objeto

- **Pantallas:** "Estado" en Objetos, Ficha y Deuda y mora.
- **Fórmula:** primera etiqueta de estado de sus obligaciones, o la vigencia del objeto, o "Vencido"/"En gestion" según haya deuda vencida (`front/lib/mappers/debtor-object-mapper.ts:515-526`).
- **Unidad:** etiqueta.
- **Población:** un objeto.
- **Corte:** `as_of` no integrado.
- **Cobertura:** sin estados, hoy "En gestion" inventado (contrato: `NO_INFORMADO_EN_ORIGEN`).
- **Decisión que apoya:** ninguna confiable hoy: mezcla vigencia del objeto con estado de las obligaciones.
- **No significa:** que el objeto esté en gestión, ni su estado administrativo o jurídico.
- **Contrato:** [OB07][c72], [DE10][c73].

## 4. Indicadores de la persona (por fila)

### <a id="kpi-15"></a>KPI-15 · Puntaje y riesgo individual de la persona

- **Pantallas:** "Riesgo individual" (insignia) y "Puntaje" (dos decimales) en Personas y Riesgo; "Riesgo" en el top 5 de Personas.
- **Fórmula:** índice del objeto (PR08) + 15/3 por 0/1 contactos de la persona + 5 si el rol contiene "responsable" + 5 si el porcentaje declarado ≥ 75, acotado a 0–100 (`back/ETL/transform.py:694`); el frontend toma el **máximo** entre los objetos de la persona (`front/lib/mappers/person-risk-mapper.ts:127-150`). Banda con los cortes de KPI-09.
- **Unidad:** puntos 0–100 (no %) y banda.
- **Población:** una persona y sus objetos vinculados.
- **Corte:** persistido; momento de cálculo hoy desconocido en pantalla.
- **Cobertura:** una persona sin detalle de perfil hoy aparece con 0 y BAJO ([contrato §10][c10]; ALIGN-011).
- **Decisión que apoya:** ninguna decisión de cobranza por sí sola: la unidad de gestión es el objeto. Sirve para revisar la exposición de una persona con varios objetos.
- **No significa:** riesgo social, vulnerabilidad, capacidad ni voluntad de pago de la persona. El rótulo correcto es "máxima severidad entre sus objetos" ([mapa de nombres][c8]).
- **Contrato:** [PR09][c75], [FP01][c77], [VP14][c79].

### <a id="kpi-16"></a>KPI-16 · Objetos asociados a la persona

- **Pantallas:** "Objetos" / "Objetos asociados" en Personas y Riesgo.
- **Fórmula:** objetos con relación activa con la persona.
- **Unidad:** objetos.
- **Población:** relaciones activas de la persona.
- **Corte:** no depende de una fecha.
- **Cobertura:** completa para las relaciones cargadas.
- **Decisión que apoya:** detectar personas vinculadas a varias cuentas (360 en el corte) para coordinar la gestión.
- **No significa:** propiedad ni responsabilidad legal sobre cada objeto.
- **Contrato:** [FP02][c77].

### <a id="kpi-17"></a>KPI-17 · Contacto disponible de la persona

- **Pantallas:** "Contacto disponible" (Disponible/Faltante) en Personas.
- **Fórmula:** al menos un contacto activo con valor (`front/lib/mappers/person-risk-mapper.ts:186-233`).
- **Unidad:** booleano.
- **Población:** una persona.
- **Corte:** no depende de una fecha.
- **Cobertura:** validez y consentimiento `NO_INTEGRADO`.
- **Decisión que apoya:** si hay un canal cargado para esa persona.
- **No significa:** contacto verificado ni autorizado.
- **Contrato:** [FP03][c77], [AU05][c711].

### <a id="kpi-18"></a>KPI-18 · Deuda total asociada de la persona

- **Pantallas:** "Deuda total asociada" en el listado de Personas.
- **Fórmula:** Σ del total de cada objeto vinculado (`front/lib/mappers/person-risk-mapper.ts:98-125`, `258-261`).
- **Unidad:** ARS, **exposición no aditiva**.
- **Población:** objetos vinculados a la persona.
- **Corte:** el de KPI-01.
- **Cobertura:** usa `updated_amount` o, si da 0, el importe original (brecha de [DE06][c73]; ALIGN-011).
- **Decisión que apoya:** ver cuánto se gestiona en total a través de una persona.
- **No significa:** deuda de la persona ni una parte proporcional: si dos personas comparten un objeto, ambas muestran su total completo; no se suma entre personas ([contrato §3][c3]).
- **Contrato:** [FP04][c77].

## 5. Tablero (`/`)

### <a id="kpi-19"></a>KPI-19 · Objetos prioritarios

- **Pantallas:** tarjeta "Objetos prioritarios" del tablero.
- **Fórmula:** objetos con [KPI-12](#kpi-12) = ALTA.
- **Unidad:** objetos.
- **Población:** todos los objetos leídos.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** hereda la de KPI-11; no se informa cuántos objetos usan fallback.
- **Decisión que apoya:** dimensionar la carga de gestión prioritaria del día.
- **No significa:** objetos "críticos" ([KPI-55](#kpi-55)) ni objetos con riesgo > 90 ([KPI-38](#kpi-38)): son tres poblaciones distintas.
- **Contrato:** [AG05][c78].

### <a id="kpi-20"></a>KPI-20 · Deuda total de la cartera

- **Pantallas:** "Deuda total" en el tablero (`dashboard.totalDebt`) y en Deuda y mora (`summary.totalDebt`).
- **Fórmula:** Σ [KPI-01](#kpi-01) sobre todos los objetos (`front/lib/mappers/dashboard-metrics-mapper.ts:111`; `front/lib/equitas-view-selectors.ts:71-113`).
- **Unidad:** ARS.
- **Población:** todos los objetos leídos (suma por objeto, sin duplicar personas).
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** objetos con total no observado deberían contarse aparte ([contrato §4.1][c41]); hoy entran con el reemplazo de KPI-01.
- **Decisión que apoya:** tamaño de la cartera cargada y base de la concentración ([KPI-25](#kpi-25)).
- **No significa:** recaudación esperada ni deuda exigible.
- **Contrato:** [AG02][c78], [AG16][c78].

### <a id="kpi-21"></a>KPI-21 · Casos vencidos

- **Pantallas:** tarjeta "Casos vencidos" del tablero.
- **Fórmula:** objetos con [KPI-02](#kpi-02) > 0.
- **Unidad:** objetos (no obligaciones).
- **Población:** todos los objetos leídos.
- **Corte:** `as_of` no integrado; "vencido" según el reloj de la carga o de la consulta.
- **Cobertura:** depende del estado inferido ([DE10][c73]).
- **Decisión que apoya:** cuántos objetos están en mora.
- **No significa:** casos con estado administrativo "vencido" en origen ni casos en gestión.
- **Contrato:** [AG03][c78].

### <a id="kpi-22"></a>KPI-22 · Objetos sin contacto / con contacto

- **Pantallas:** tarjetas "Casos sin contacto" y "Con contacto" y frase "Hay n casos bloqueados por falta de contacto" del tablero; "Total sin contacto" en Sin contacto.
- **Fórmula:** objetos por [KPI-08](#kpi-08) falso / verdadero (`dashboard-metrics-mapper.ts`; en Sin contacto, `getNoContactCases`, `front/lib/equitas-view-selectors.ts`).
- **Unidad:** objetos.
- **Población:** todos los objetos leídos; con + sin = total leído.
- **Corte:** no depende de una fecha.
- **Cobertura:** "sin contacto" = sin valor cargado (1568 de 2933 objetos en el corte); la validez de los cargados no está integrada.
- **Decisión que apoya:** dimensionar el trabajo de mejora de datos (cola `MEJORAR_DATOS`, [reglas §7][r7]).
- **No significa:** contribuyentes inubicables ni renuentes. "Bloqueados" se refiere a la gestión directa, no a la persona.
- **Contrato:** [AG04][c78], [AG17][c78].

### <a id="kpi-23"></a>KPI-23 · Recomendación urgente

- **Pantallas:** tarjeta "Recomendacion urgente" del tablero.
- **Fórmula:** objetos con `isUrgentRecommendation` ([KPI-13](#kpi-13)).
- **Unidad:** objetos.
- **Población:** todos los objetos leídos.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** hereda la de KPI-13.
- **Decisión que apoya:** cuántos casos el recomendador heredado marca como urgentes.
- **No significa:** urgencia jurídica ni plazos; incluye objetos sin contacto con riesgo alto.
- **Contrato:** [AG06][c78].

### <a id="kpi-24"></a>KPI-24 · Porcentaje de objetos en riesgo alto

- **Pantallas:** "n% de los objetos estan en riesgo alto" (Resumen operativo del dia).
- **Fórmula:** `round(100 · byRisk[ALTO] / totalDebtors)` (`front/app/page.tsx:42-46`).
- **Unidad:** % de objetos, entero.
- **Población:** todos los objetos leídos.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** con 0 objetos hoy 0 % (contrato: `NO_APLICA`); los objetos sin perfil entran con la banda del fallback ([contrato §10][c10]).
- **Decisión que apoya:** magnitud relativa de la cartera con índice heredado alto.
- **No significa:** porcentaje de contribuyentes que no pagarán.
- **Contrato:** [VP01][c79], [AG10][c78], [AG01][c78] (base).

### <a id="kpi-25"></a>KPI-25 · Concentración de la deuda en los 5 objetos mayores

- **Pantallas:** "Los 5 objetos con mayor deuda concentran n% del saldo total".
- **Fórmula:** `round(100 · Σ KPI-01 de los 5 mayores / KPI-20)` (`front/app/page.tsx:47-54`).
- **Unidad:** % del saldo ARS, entero.
- **Población:** todos los objetos leídos; con ≤ 5 objetos da 100 %.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** saldo ≤ 0 hoy 0 % (contrato: `NO_APLICA`); hereda el reemplazo de KPI-01.
- **Decisión que apoya:** si conviene una gestión específica de los grandes saldos.
- **No significa:** concentración por contribuyente (son objetos, no personas).
- **Contrato:** [VP02][c79].

### <a id="kpi-26"></a>KPI-26 · Distribución de recomendaciones

- **Pantallas:** "Recomendaciones sugeridas": "n casos (p%)" y barra por categoría.
- **Fórmula:** conteo de objetos por categoría de [KPI-13](#kpi-13) y `round(100 · count / totalDebtors)` (`front/app/page.tsx:247-251`).
- **Unidad:** objetos y % de objetos, entero.
- **Población:** todos los objetos leídos; las 4 categorías siempre presentes.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** con 0 objetos hoy 0 % (contrato: `NO_APLICA`); los redondeos pueden no sumar 100.
- **Decisión que apoya:** repartir capacidad entre tipos de acción; en v1, el tamaño de cada cola por intervención.
- **No significa:** acciones realizadas.
- **Contrato:** [AG11][c78], [VP03][c79], [AG01][c78] (base).

### <a id="kpi-27"></a>KPI-27 · Recomendación dominante

- **Pantallas:** «"<categoría>" concentra n% de los objetos actuales».
- **Fórmula:** categoría de mayor conteo de KPI-26 (en empate gana la primera en orden fijo); `round(100 · value / max(totalDebtors, 1))` (`front/app/page.tsx:55-58`, `279-283`).
- **Unidad:** categoría y % de objetos.
- **Población:** todos los objetos leídos.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** con 0 objetos hoy muestra «"Llamado prioritario" concentra 0%» (contrato: `NO_APLICA`); un empate no se declara.
- **Decisión que apoya:** lectura rápida de la acción más frecuente.
- **No significa:** la acción más importante ni la recomendada para la cartera.
- **Contrato:** [VP04][c79], [AG01][c78] (base).

### <a id="kpi-28"></a>KPI-28 · Distribución de objetos por riesgo

- **Pantallas:** anillo "Distribucion por riesgo" (tablero) y "Distribucion de objetos por riesgo" (Riesgo).
- **Fórmula:** conteo de objetos por banda de [KPI-09](#kpi-09) (`front/lib/mappers/dashboard-metrics-mapper.ts:24-38`; en Riesgo, recálculo local `front/app/risk-analysis/page.tsx:29-32`); porcentajes de la leyenda en [KPI-52](#kpi-52).
- **Unidad:** objetos.
- **Población:** todos los objetos leídos.
- **Corte:** persistido o inferido (KPI-09).
- **Cobertura:** el riesgo no disponible debería ir en categoría propia, nunca en BAJO; hoy recibe banda por fallback.
- **Decisión que apoya:** composición de la cartera por índice heredado.
- **No significa:** distribución de probabilidad de pago ni de situación social.
- **Contrato:** [AG10][c78], [VP09][c79].

### <a id="kpi-29"></a>KPI-29 · Objetos por tipo

- **Pantallas:** barras "Objetos por tipo" del tablero.
- **Fórmula:** objetos por tipo de objeto (RODADO, AGUA, INMUEBLE…).
- **Unidad:** objetos.
- **Población:** todos los objetos leídos.
- **Corte:** no depende de una fecha.
- **Cobertura:** tipo faltante hoy "Sin tipo" (contrato: `NO_INFORMADO_EN_ORIGEN` o `INVALIDO`).
- **Decisión que apoya:** composición de la cartera por tributo o tipo de bien.
- **No significa:** deuda por tipo (cuenta objetos, no importes).
- **Contrato:** [AG09][c78], [OB03][c72].

### <a id="kpi-30"></a>KPI-30 · Top de deuda (5 objetos)

- **Pantallas:** barras "Top de deuda" del tablero.
- **Fórmula:** los 5 objetos de mayor [KPI-01](#kpi-01), rotulados por identificador (`front/lib/mappers/dashboard-metrics-mapper.ts:8-16`).
- **Unidad:** ARS por objeto.
- **Población:** todos los objetos leídos.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** hereda KPI-01.
- **Decisión que apoya:** identificar los saldos más grandes.
- **No significa:** los casos a gestionar primero ([KPI-31](#kpi-31)) ni los más vencidos. Es distinto del top 10 de Deuda y mora ([KPI-44](#kpi-44)).
- **Contrato:** [AG12][c78].

### <a id="kpi-31"></a>KPI-31 · Orden operativo heredado (rankings y listados)

- **Pantallas:** "A quien gestionar primero" y "Casos sin contacto" (top 5) del tablero; "Ranking operativo" de Casos prioritarios; listado de Sin contacto; tabla de Riesgo; "Casos destacados" (3 por categoría) de Acciones.
- **Fórmula:** orden por [KPI-11](#kpi-11) descendente, luego [KPI-09](#kpi-09), [KPI-01](#kpi-01) y [KPI-03](#kpi-03) (`sortByOperationalPriority`, `front/lib/equitas-view-selectors.ts`; misma regla en `front/lib/mappers/dashboard-metrics-mapper.ts`).
- **Unidad:** posición en una lista de objetos.
- **Población:** todos los objetos leídos, o el subconjunto de la pantalla (sin contacto, riesgo > 90, una categoría).
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** hereda la de sus criterios; no hay desempate explícito por `id` (los empates conservan el orden de lectura).
- **Decisión que apoya:** a quién gestionar primero. En v1 se reemplaza por el orden dentro de cada cola con desempates deterministas ([reglas §8][r8]).
- **No significa:** un orden comparable entre colas ni un orden validado contra resultados de gestión.
- **Contrato:** [AG12][c78], [FO13][c76].

## 6. Personas (`/people`)

### <a id="kpi-32"></a>KPI-32 · Personas por riesgo individual

- **Pantallas:** tarjetas "Riesgo bajo / medio / alto" y anillo "Distribucion de riesgo individual" (Personas); anillo "Distribucion de personas por riesgo individual" (Riesgo).
- **Fórmula:** conteo de personas por banda de [KPI-15](#kpi-15) (`front/lib/mappers/person-risk-mapper.ts:29-31`, `40-44`).
- **Unidad:** personas.
- **Población:** todas las personas leídas (no las filtradas).
- **Corte:** persistido.
- **Cobertura:** las personas sin detalle hoy cuentan como BAJO ([contrato §10][c10]); deberían ir en categoría "no disponible".
- **Decisión que apoya:** ninguna decisión de gestión directa; describe a quiénes alcanzan los objetos de severidad alta.
- **No significa:** personas en riesgo social o vulnerables.
- **Contrato:** [AG10][c78], [FP01][c77].

### <a id="kpi-33"></a>KPI-33 · Personas sin contacto

- **Pantallas:** tarjeta "Sin contacto" de Personas.
- **Fórmula:** personas sin contacto activo con valor ([KPI-17](#kpi-17) falso).
- **Unidad:** personas.
- **Población:** **todas** las personas leídas, aunque haya filtros activos.
- **Corte:** no depende de una fecha.
- **Cobertura:** validez `NO_INTEGRADO`.
- **Decisión que apoya:** dimensionar la verificación de datos de contacto por persona.
- **No significa:** el complemento de [KPI-34](#kpi-34): se muestran juntas pero tienen universos distintos.
- **Contrato:** [AG13][c78].

### <a id="kpi-34"></a>KPI-34 · Personas filtradas con contacto

- **Pantallas:** "Con contacto: n" dentro de la tarjeta "Sin contacto".
- **Fórmula:** personas filtradas con [KPI-17](#kpi-17) verdadero (`front/app/people/page.tsx:109`).
- **Unidad:** personas.
- **Población:** personas que pasan los filtros de la pantalla ([KPI-51](#kpi-51)).
- **Corte:** no depende de una fecha.
- **Cobertura:** subconjunto vacío → 0 derivado.
- **Decisión que apoya:** cuántas de las personas buscadas tienen un canal cargado.
- **No significa:** "total − sin contacto"; no se suma ni se resta con [KPI-33](#kpi-33).
- **Contrato:** [VP05][c79].

### <a id="kpi-35"></a>KPI-35 · Deuda asociada de las personas filtradas

- **Pantallas:** tarjeta "Deuda asociada" de Personas.
- **Fórmula:** Σ [KPI-18](#kpi-18) de las personas filtradas (`front/app/people/page.tsx:101-104`).
- **Unidad:** ARS.
- **Población:** personas que pasan los filtros.
- **Corte:** el de KPI-01.
- **Cobertura:** hoy **suma exposiciones no aditivas**: un objeto compartido se cuenta una vez por persona. El contrato exige deduplicar por objeto ([contrato §3][c3]; brecha en [§10][c10], ALIGN-011).
- **Decisión que apoya:** ninguna confiable hoy: puede superar la deuda total de la cartera.
- **No significa:** deuda de esas personas ni parte de la cartera ([KPI-20](#kpi-20)).
- **Contrato:** [AG14][c78].

### <a id="kpi-36"></a>KPI-36 · Riesgo promedio de las personas filtradas

- **Pantallas:** "Riesgo promedio n / 100" en la tarjeta "Deuda asociada".
- **Fórmula:** Σ [KPI-15](#kpi-15) / n con un decimal (`front/app/people/page.tsx:105-108`).
- **Unidad:** puntos 0–100 (no %).
- **Población:** personas que pasan los filtros.
- **Corte:** persistido.
- **Cobertura:** sin personas hoy 0,0 (contrato: `NO_APLICA`); personas sin detalle entran con 0.
- **Decisión que apoya:** ninguna decisión operativa; es descriptivo.
- **No significa:** riesgo medio de la cartera ni de los objetos.
- **Contrato:** [AG14][c78].

### <a id="kpi-37"></a>KPI-37 · Top 5 personas con mayor riesgo

- **Pantallas:** tabla "Top 5 personas con mayor riesgo" de Personas.
- **Fórmula:** las 5 personas de mayor [KPI-15](#kpi-15) (`front/lib/mappers/person-risk-mapper.ts:28-68`).
- **Unidad:** personas.
- **Población:** todas las personas leídas.
- **Corte:** persistido.
- **Cobertura:** las personas sin detalle quedan fuera sin aviso.
- **Decisión que apoya:** revisar personas vinculadas a objetos de severidad alta.
- **No significa:** contribuyentes a priorizar como personas: la gestión se decide por objeto.
- **Contrato:** [AG13][c78].

## 7. Riesgo (`/risk-analysis`)

### <a id="kpi-38"></a>KPI-38 · Objetos con riesgo mayor a 90

- **Pantallas:** "Objetos con riesgo > 90" y tabla "Objetos con riesgo mayor a 90" (10 primeros).
- **Fórmula:** objetos con [KPI-09](#kpi-09) `riskScore > 90` estrictamente (`getHighRiskCases`, `front/lib/equitas-view-selectors.ts:55-57`), en el orden de [KPI-31](#kpi-31).
- **Unidad:** objetos.
- **Población:** todos los objetos leídos.
- **Corte:** persistido o inferido (KPI-09).
- **Cobertura:** el riesgo no disponible debería contarse aparte; hoy el fallback nunca supera 85, así que esos objetos quedan fuera sin aviso.
- **Decisión que apoya:** revisar el extremo superior del índice heredado.
- **No significa:** "casos críticos" ([KPI-55](#kpi-55)), que es un conjunto más amplio. Es la misma condición que `riskAboveNinetyCases` (AG07b), que no se muestra.
- **Contrato:** [VP10][c79], [AG07b][c78].

### <a id="kpi-39"></a>KPI-39 · Personas con puntaje alto

- **Pantallas:** "Personas con puntaje alto" ("Puntaje individual desde 70") y tabla de 10.
- **Fórmula:** personas con [KPI-15](#kpi-15) ≥ 70, ordenadas por puntaje y luego por [KPI-18](#kpi-18) (`front/lib/equitas-view-selectors.ts:59-69`).
- **Unidad:** personas.
- **Población:** todas las personas leídas.
- **Corte:** persistido.
- **Cobertura:** personas sin detalle quedan fuera sin aviso.
- **Decisión que apoya:** la misma que [KPI-37](#kpi-37), con umbral.
- **No significa:** personas vulnerables ni de alto riesgo social.
- **Contrato:** [VP11][c79].

## 8. Deuda y mora (`/debt-aging`)

### <a id="kpi-40"></a>KPI-40 · Deuda vencida de la cartera

- **Pantallas:** tarjeta "Deuda vencida" de Deuda y mora.
- **Fórmula:** Σ [KPI-02](#kpi-02) sobre todos los objetos (`buildDebtAgingSummary`, `front/lib/equitas-view-selectors.ts:71-113`).
- **Unidad:** ARS.
- **Población:** todos los objetos leídos.
- **Corte:** mixto; "vencida" según el reloj de carga o consulta.
- **Cobertura:** depende del estado inferido ([DE10][c73]).
- **Decisión que apoya:** magnitud de la mora de la cartera.
- **No significa:** deuda exigible ni recuperable.
- **Contrato:** [AG16][c78].

### <a id="kpi-41"></a>KPI-41 · Promedio de atraso

- **Pantallas:** tarjeta "Promedio de atraso" ("n dias").
- **Fórmula:** promedio redondeado de [KPI-03](#kpi-03) sobre los objetos con deuda vencida.
- **Unidad:** días.
- **Población:** objetos con [KPI-02](#kpi-02) > 0.
- **Corte:** mixto; reloj de la consulta.
- **Cobertura:** sin objetos vencidos hoy 0 (contrato: `NO_APLICA`).
- **Decisión que apoya:** antigüedad típica de la mora.
- **No significa:** atraso promedio de las obligaciones (es el máximo por objeto, promediado).
- **Contrato:** [AG16][c78].

### <a id="kpi-42"></a>KPI-42 · Distribución por atraso

- **Pantallas:** barras "Distribucion por atraso" (Sin atraso / 1-30 / 31-90 / +90 días).
- **Fórmula:** conteo de objetos por banda de [KPI-03](#kpi-03).
- **Unidad:** objetos.
- **Población:** todos los objetos leídos.
- **Corte:** mixto; reloj de la consulta.
- **Cobertura:** atraso `NO_APLICA` o ilegible hoy cae en "Sin atraso".
- **Decisión que apoya:** repartir la cartera por antigüedad de la mora.
- **No significa:** las bandas de antigüedad de la severidad v1 (1 / 31 / 91 / 181 / 366 / 731 días, [reglas §4][r4]).
- **Contrato:** [AG16][c78].

### <a id="kpi-43"></a>KPI-43 · Deuda por estado

- **Pantallas:** barras "Deuda por estado".
- **Fórmula:** Σ [KPI-01](#kpi-01) agrupada por [KPI-14](#kpi-14) (`front/app/debt-aging/page.tsx:52-60`).
- **Unidad:** ARS por etiqueta de estado del objeto.
- **Población:** todos los objetos leídos.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** objetos sin estado caen en "En gestion" inventado.
- **Decisión que apoya:** ninguna confiable hoy (la etiqueta no es un estado de origen).
- **No significa:** conteo de obligaciones por estado ([KPI-57](#kpi-57)) ni estado administrativo de las deudas.
- **Contrato:** [VP07][c79], [OB07][c72].

### <a id="kpi-44"></a>KPI-44 · Top deuda por objeto (10 objetos)

- **Pantallas:** barras "Top deuda por objeto" y tabla "Top 10 mayor deuda".
- **Fórmula:** los 10 objetos de mayor [KPI-01](#kpi-01) (`front/lib/equitas-view-selectors.ts:82`).
- **Unidad:** ARS por objeto.
- **Población:** todos los objetos leídos.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** hereda KPI-01.
- **Decisión que apoya:** la misma que [KPI-30](#kpi-30), con 10 objetos.
- **No significa:** el top 5 del tablero ni un orden de gestión.
- **Contrato:** [VP08][c79].

## 9. Acciones recomendadas (`/recommended-actions`)

### <a id="kpi-45"></a>KPI-45 · Casos por recomendación

- **Pantallas:** valor de cada tarjeta y "Cantidad de casos" del resumen.
- **Fórmula:** objetos por categoría de [KPI-13](#kpi-13) (`buildRecommendationSummary`, `front/lib/equitas-view-selectors.ts:115-134`).
- **Unidad:** objetos.
- **Población:** todos los objetos leídos; las 4 categorías siempre presentes.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** categoría vacía → 0 derivado.
- **Decisión que apoya:** capacidad necesaria por tipo de acción.
- **No significa:** acciones realizadas ni pendientes registradas.
- **Contrato:** [AG15][c78].

### <a id="kpi-46"></a>KPI-46 · Deuda asociada por recomendación

- **Pantallas:** monto de cada tarjeta y "Deuda asociada" del resumen.
- **Fórmula:** Σ [KPI-01](#kpi-01) de los objetos de la categoría.
- **Unidad:** ARS.
- **Población:** objetos de una categoría (las 4 categorías particionan la cartera).
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** hereda KPI-01.
- **Decisión que apoya:** monto en juego de cada tipo de acción.
- **No significa:** la "Deuda asociada" de Personas ([KPI-35](#kpi-35)) ni la de Sin contacto ([KPI-48](#kpi-48)).
- **Contrato:** [AG15][c78].

### <a id="kpi-47"></a>KPI-47 · Riesgo promedio por recomendación

- **Pantallas:** "Riesgo promedio n / 100" del resumen.
- **Fórmula:** promedio de [KPI-09](#kpi-09) de los objetos de la categoría, un decimal.
- **Unidad:** puntos 0–100 (no %).
- **Población:** objetos de una categoría.
- **Corte:** persistido o inferido.
- **Cobertura:** categoría vacía hoy 0,0 (contrato: `NO_APLICA`).
- **Decisión que apoya:** ninguna decisión operativa; describe la categoría.
- **No significa:** probabilidad media de pago.
- **Contrato:** [AG15][c78].

## 10. Sin contacto (`/no-contact`)

### <a id="kpi-48"></a>KPI-48 · Deuda asociada a objetos sin contacto

- **Pantallas:** tarjeta "Deuda asociada" de Sin contacto.
- **Fórmula:** Σ [KPI-01](#kpi-01) de los objetos sin contacto (`front/app/no-contact/page.tsx:47-51`).
- **Unidad:** ARS.
- **Población:** objetos con [KPI-08](#kpi-08) falso.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** hereda KPI-01.
- **Decisión que apoya:** monto que no puede gestionarse con el contribuyente hasta mejorar datos.
- **No significa:** deuda incobrable.
- **Contrato:** [AG17][c78].

### <a id="kpi-49"></a>KPI-49 · Riesgo alto sin contacto

- **Pantallas:** tarjeta "Riesgo alto sin contacto".
- **Fórmula:** objetos sin contacto con banda [KPI-09](#kpi-09) = ALTO.
- **Unidad:** objetos.
- **Población:** objetos con [KPI-08](#kpi-08) falso.
- **Corte:** persistido o inferido.
- **Cobertura:** el índice heredado **suma** por falta de contacto, de modo que este conteo está inflado por construcción ([contrato §10][c10]).
- **Decisión que apoya:** priorizar la mejora de datos entre objetos con deuda grande o antigua.
- **No significa:** contribuyentes de alto riesgo que evitan el contacto.
- **Contrato:** [AG17][c78].

### <a id="kpi-50"></a>KPI-50 · Sin contacto sobre el total

- **Pantallas:** tarjeta "Sobre el total" ("n%").
- **Fórmula:** `round(100 · objetos sin contacto / objetos leídos)`.
- **Unidad:** % de objetos, entero.
- **Población:** todos los objetos leídos.
- **Corte:** no depende de una fecha.
- **Cobertura:** base 0 hoy 0 % (contrato: `NO_APLICA`).
- **Decisión que apoya:** magnitud del problema de calidad de contactos.
- **No significa:** porcentaje de contribuyentes inubicables.
- **Contrato:** [AG17][c78].

## 11. Transversales y cifras que no son datos

### <a id="kpi-51"></a>KPI-51 · Contadores de resultados de filtros

- **Pantallas:** "n / N registros" (Objetos), "n casos" (Casos prioritarios), "n / N personas" (Personas).
- **Fórmula:** elementos que pasan los filtros de la pantalla / total leído (`front/app/debtors/page.tsx:72-99`; `front/app/priority-cases/page.tsx:69-88`; `front/app/people/page.tsx:36-48`).
- **Unidad:** objetos o personas.
- **Población:** la del listado.
- **Corte:** no depende de una fecha.
- **Cobertura:** lectura fallida debería mostrarse "no disponible", no "0 / 0"; un monto mínimo no numérico hoy da "0 casos" (contrato: filtro `INVALIDO`).
- **Decisión que apoya:** acotar el trabajo a un subconjunto.
- **No significa:** casos prioritarios por sí mismo (en Casos prioritarios cuenta todos los objetos filtrados).
- **Contrato:** [VP06][c79].

### <a id="kpi-52"></a>KPI-52 · Porcentaje en la leyenda del anillo

- **Pantallas:** "n,n%" junto a cada banda de los anillos ([KPI-28](#kpi-28), [KPI-32](#kpi-32)).
- **Fórmula:** 100 · valor de la banda / Σ de la serie, un decimal (`front/components/charts/debtor-dashboard-charts.tsx:170`).
- **Unidad:** % de la serie.
- **Población:** la serie del gráfico.
- **Corte:** el de la serie.
- **Cobertura:** serie vacía hoy dibuja "Sin datos" con valor 1, mostrado como 100,0 % (contrato: sin porcentaje, `NO_APLICA`).
- **Decisión que apoya:** la de la serie.
- **No significa:** un porcentaje de la cartera si la serie es de personas.
- **Contrato:** [VP12][c79].

### <a id="kpi-53"></a>KPI-53 · Barra "Sin datos"

- **Pantallas:** barra o sector "Sin datos" de los gráficos con serie vacía.
- **Fórmula:** relleno `{ label: 'Sin datos', value: 0 }` (barras) o `value: 1` (anillo).
- **Unidad:** —.
- **Población:** —.
- **Corte:** —.
- **Cobertura:** no distingue "sin datos" de "lectura fallida".
- **Decisión que apoya:** ninguna.
- **No significa:** un cero observado.
- **Contrato:** [VP13][c79].

### <a id="kpi-54"></a>KPI-54 · Cifras de la pantalla de ingreso

- **Pantallas:** "Casos criticos 186", "Sin contacto 176", "Deuda gestionada $99M" y barras Alto/Medio/Bajo de la pantalla de ingreso.
- **Fórmula:** literales fijos en el código (`PREVIEW_METRICS` y `RISK_PREVIEW`, `front/app/login/page.tsx:7-32`).
- **Unidad:** —.
- **Población:** ninguna.
- **Corte:** —.
- **Cobertura:** no hay dato de gestión (`NO_INTEGRADO`).
- **Decisión que apoya:** ninguna. **No son datos**: ALIGN-012 los retira o rotula "ilustrativo".
- **No significa:** casos, contactos ni deuda gestionada reales.
- **Contrato:** [AG18][c78] (las barras `RISK_PREVIEW` no figuran en AG18; ver §14).

## 12. Indicadores no visibles que generan confusión

No se muestran hoy, pero existen en `DashboardData` y ALIGN-014 debe redefinir "críticos" con este catálogo antes de mostrarlos.

### <a id="kpi-55"></a>KPI-55 · Casos críticos hoy (no visible)

- **Fórmula:** objetos con `riskScore > 90` **o** recomendación urgente **o** (deuda vencida > 0 **y** sin contacto) (`front/lib/mappers/dashboard-metrics-mapper.ts:98-103`, `117`).
- **Unidad:** objetos.
- **Población:** todos los objetos leídos.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** un objeto sin perfil o sin contacto entra por el fallback o por la falta de contacto.
- **Decisión que apoya:** ninguna definida: mezcla severidad, recomendación y calidad de datos.
- **No significa:** la población de [KPI-56](#kpi-56) ("deuda crítica") ni la de [KPI-38](#kpi-38).
- **Contrato:** [AG07a][c78].

### <a id="kpi-56"></a>KPI-56 · Deuda crítica (no visible)

- **Fórmula:** Σ [KPI-01](#kpi-01) de los objetos con `riskScore > 90` (`front/lib/mappers/dashboard-metrics-mapper.ts:105-107`).
- **Unidad:** ARS.
- **Población:** la de [KPI-38](#kpi-38), **no** la de [KPI-55](#kpi-55).
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** sin objetos > 90 con universo leído → 0 derivado.
- **Decisión que apoya:** ninguna definida.
- **No significa:** la deuda de los "casos críticos": mostrarlas juntas sugeriría que comparten población.
- **Contrato:** [AG07c][c78].

### <a id="kpi-57"></a>KPI-57 · Obligaciones por estado (no visible)

- **Fórmula:** conteo de obligaciones por etiqueta de estado de la obligación (`front/lib/mappers/dashboard-metrics-mapper.ts:120-122`).
- **Unidad:** obligaciones.
- **Población:** obligaciones leídas.
- **Corte:** `as_of` no integrado.
- **Cobertura:** estado inferido ([DE10][c73]).
- **Decisión que apoya:** ninguna hoy.
- **No significa:** la "Deuda por estado" visible ([KPI-43](#kpi-43)), que suma ARS por estado del objeto.
- **Contrato:** [AG08][c78].

## 13. <a id="campos-de-registro"></a>Campos de registro (no son indicadores)

Valores de una fila que se muestran tal como llegan (o con un rótulo heredado). No se agregan ni orientan una decisión por sí solos; su significado está en el contrato. Los marcados con † tienen rótulo engañoso que corrige ALIGN-012.

| Rótulo visible | Expresión | Significado correcto | Contrato |
|---|---|---|---|
| Identificador / Objeto | `debtor.identifier` | `Identificador` de origen; hoy `OBJ-<id>` si falta | [OB04][c72] |
| Tipo | `debtor.type` | Tipo de objeto del catálogo | [OB03][c72] |
| Descripcion | `debtor.description` | `Bien_Descripcion` de origen | [OB05][c72] |
| Nombre / Persona | `person.name`, `contact.personId` (respaldo "Persona <id>") | Destinatario informado en origen | [PE02][c74] |
| Documento | `person.document` | CUIT informado; validez no verificada | [PE03][c74] |
| Prioridad de contacto † | `person.priority` | **Porcentaje declarado** en origen, no una prioridad | [RE01][c74] |
| Relacion | `person.relation` | Rol declarado en origen | [RE02][c74] |
| Contacto (persona) | `person.contact` | Primer contacto cargado, no verificado | [CO01][c74] |
| Canal; Valor; Estado (contacto) | `contact.channel`, `contact.value`, `contact.isActive` | Tipo y valor cargados; "Activo" ≠ verificado | [CO01–CO03][c74] |
| Monto original | `debt.originalAmount` | `NOTD_capital` | [DE04][c73] |
| Monto actualizado | `debt.updatedAmount` | `NOTD_totalActualizado`; hoy un 0 se reemplaza por el original | [DE06][c73] |
| Periodo † | `debt.period` | **ID externo** de la obligación (`DEUD_id`), no período fiscal | [DE02][c73] |
| Vencimiento | `debt.dueDate` | `NOTD_vencimiento` | [DE07][c73] |
| Estado (obligación) | `debt.status` | Estado **inferido** por vencimiento, no estado de origen | [DE10][c73] |

## 14. Hallazgos para el contrato (no corregidos aquí)

El contrato de ALIGN-007 no se modifica en este ticket. Al inventariar se encontró:

1. [VP14][c79] cita `riskValue.toFixed(2)` solo en Riesgo; el listado y el top 5 de Personas también lo muestran (`front/app/people/page.tsx`). El significado no cambia ([KPI-15](#kpi-15)).
2. [AG18][c78] describe las tres tarjetas de la pantalla de ingreso, pero no las barras `RISK_PREVIEW` (Alto/Medio/Bajo con anchos fijos), que son igualmente ilustrativas ([KPI-54](#kpi-54)).
3. Ninguna entrada del contrato nombra el **orden operativo** `sortByOperationalPriority`, que decide qué casos se ven primero en cuatro pantallas; aquí se cataloga como [KPI-31](#kpi-31) a partir de [AG12][c78] y [FO13][c76].

## 15. Control de versiones

| Versión | Fecha | Cambio |
|---|---|---|
| v1 | 29/10/2026 | Versión inicial (ALIGN-013): inventario de cifras visibles en `c17a1bf` y una entrada enlazable por indicador. Provisional como el contrato y las reglas que cita. Cada indicador nuevo o redefinido (ALIGN-010, 014, 021) se agrega en una versión nueva |

[contrato]: contrato-dominio-v1.md
[reglas]: reglas-decision-v1.md
[adr]: adr-001-reglas-y-capas.md
[c2]: contrato-dominio-v1.md#2-unidades-de-dominio
[c3]: contrato-dominio-v1.md#3-agregación-totales-por-objeto-y-exposición-no-aditiva
[c41]: contrato-dominio-v1.md#41-reglas-de-agregación
[c51]: contrato-dominio-v1.md#51-procedencia-temporal-y-rótulo-obligatorio
[c72]: contrato-dominio-v1.md#72-objeto-tributario
[c73]: contrato-dominio-v1.md#73-obligación
[c74]: contrato-dominio-v1.md#74-persona-relación-y-contacto
[c75]: contrato-dominio-v1.md#75-perfil-del-objeto-calculado-por-el-etl
[c76]: contrato-dominio-v1.md#76-indicadores-del-objeto-calculados-por-el-frontend
[c77]: contrato-dominio-v1.md#77-indicadores-de-personas
[c78]: contrato-dominio-v1.md#78-agregados-de-tablero-y-listados
[c79]: contrato-dominio-v1.md#79-cálculos-locales-de-páginas-y-componentes
[c710]: contrato-dominio-v1.md#710-reglas-de-prioridad-en-python-servicio-de-scoring
[c711]: contrato-dominio-v1.md#711-dimensiones-ausentes-no-inferibles-con-esta-cartera
[c8]: contrato-dominio-v1.md#8-mapa-de-nombres-heredados
[c10]: contrato-dominio-v1.md#10-brechas-del-código-actual-frente-a-este-contrato
[r4]: reglas-decision-v1.md#4-dimensión-1-severidad-0100
[r5]: reglas-decision-v1.md#5-dimensión-2-banderas-de-calidad
[r7]: reglas-decision-v1.md#7-dimensión-4-intervención-e-intensidad
[r8]: reglas-decision-v1.md#8-dimensión-5-prioridad-operativa
