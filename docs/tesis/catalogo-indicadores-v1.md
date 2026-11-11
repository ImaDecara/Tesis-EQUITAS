# Catálogo de indicadores visibles (v1)

| Campo | Valor |
|---|---|
| Ticket | ALIGN-013, plan `2026-10-28-v2` (M1) |
| Versión | v1 con [adenda vigente ALIGN-014 (§21)](#analitica-align014), **provisional**: hereda el carácter provisional del [contrato de dominio][contrato] (ALIGN-007) y de las [reglas de decisión v1][reglas] (ALIGN-008) |
| Código descrito | `ab4c5b30526e5631390dd05e17851fb6ad7465a6`: integración del plan con ALIGN-011 (mapeadores con estados de presencia de datos). Las citas `archivo:línea` de este catálogo remiten a ese código; algunas citas del contrato ALIGN-007 remiten a `36f35b4` y se corrieron (§14) |
| Fuentes | Pantallas `front/app/**/page.tsx` y componentes `front/components/**`; contrato de dominio v1 (§7, en especial §7.9); reglas de decisión v1; plan v2 §4 y §7 |
| Consumidores | ALIGN-014 (tablero y vistas analíticas según este catálogo), ALIGN-010/021 (colas por intervención), ALIGN-012 (rótulos), tesis (capítulo de indicadores) |
| Arquitectura | [ADR-001: reglas y capas][adr] |
| Datos personales | Ninguno. Las cifras citadas son agregados del informe de input que ya figuran en el contrato |

## 1. Propósito y cómo leer cada entrada

La versión histórica del tablero mezclaba cifras que parecían iguales; [§21](#analitica-align014) fija las correcciones vigentes. En la descripción histórica: "críticos" y "deuda crítica" tienen poblaciones distintas ([KPI-55](#kpi-55) y [KPI-56](#kpi-56)), "Deuda asociada" significa tres cosas según la pantalla ([KPI-35](#kpi-35), [KPI-46](#kpi-46), [KPI-48](#kpi-48)) y el "riesgo" es un índice heredado de severidad, no una probabilidad ni un dato social `[P0105]`, `[P0108]`. Este catálogo da a **cada cifra visible** una definición enlazable y dice qué decisión apoya y qué **no** significa `[P0211]`, `[P0228]`.

Cada entrada tiene un ancla estable (`#kpi-NN`) y estos campos:

- **Pantallas:** dónde se muestra, con su rótulo actual.
- **Fórmula:** cómo se calcula hoy (`ab4c5b3`), con el archivo que la implementa. En los órdenes se listan **todos** los desempates.
- **Unidad:** objetos, personas, obligaciones, ARS, días, puntos 0–100 o porcentaje. Los puntajes son **puntos, no porcentajes**.
- **Población:** el universo sobre el que se cuenta o suma (todos los objetos leídos, los filtrados, los de una categoría…).
- **Corte:** de qué fecha depende el valor y su procedencia temporal ([contrato §5.1][c51]). Mientras `as_of` sea `NO_INTEGRADO`, ningún indicador tiene corte municipal: se rotula según la procedencia.
- **Cobertura:** qué filas de la población tienen el dato observado y qué pasa hoy con las demás. Las [reglas de agregación][c41] exigen calcular sobre las filas observadas y mostrar al lado cuántas quedaron fuera ("n de N con dato"); hoy las pantallas lo informan en una línea de faltantes por estado ([KPI-60](#kpi-60)), no junto a cada cifra.
- **Decisión que apoya:** la decisión operativa concreta que la cifra informa. Una cifra que no apoya ninguna decisión se marca así.
- **No significa:** las lecturas incorrectas que la cifra invita.
- **Contrato:** la entrada del diccionario de ALIGN-007 que fija el significado de la variable.

**Comportamiento actual y brechas.** El catálogo describe lo que calcula el código integrado, que ya incluye ALIGN-011. Un dato faltante no se muestra como 0: los mapeadores devuelven `null` con su estado de presencia (`front/lib/data-presence.ts:4-21`) y las pantallas lo rotulan "No disponible" (`formatNumber`, `front/lib/data-presence.ts:76-79`; `formatCurrency`, `front/lib/utils.ts:10-17`; insignias neutras), o "No aplica" cuando la base es vacía (`percentageData` y `formatPercentage`, `front/lib/data-presence.ts:81-88`). Si falla la lectura de una tabla (advertencia de lectura), queda "No disponible" cada indicador que depende de ella (`readingFailed`, `front/lib/data-presence.ts:33-35`). Las sumas, máximos y promedios usan las filas observadas y conservan el conteo de faltantes (`aggregateData`, `front/lib/data-presence.ts:39-56`). En todos los órdenes, un valor no disponible va al final (`compareNullable`, `front/lib/data-presence.ts:70-74`). Las brechas que siguen abiertas citan el [contrato §10][c10].

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
| Tablero (`front/app/page.tsx`) | Recomendaciones sugeridas: "n casos (p%)" y barra | `count`, `percentage`, `percentage.value` | [KPI-26](#kpi-26) |
| Tablero (`front/app/page.tsx`) | «"<categoría>" concentra n% de los objetos actuales» | `dominantRecommendation` | [KPI-27](#kpi-27) |
| Tablero (`front/app/page.tsx`) | Distribucion por riesgo | `dashboard.byRisk` | [KPI-28](#kpi-28) |
| Tablero (`front/app/page.tsx`) | Objetos por tipo | `dashboard.byDebtorType` | [KPI-29](#kpi-29) |
| Tablero (`front/app/page.tsx`) | Top de deuda | `dashboard.topDebtChart` | [KPI-30](#kpi-30) |
| Tablero (`front/app/page.tsx`) | A quien gestionar primero; Casos sin contacto (top 5, orden propio del tablero): Objeto, Riesgo, Deuda, Atraso, Recomendacion, "Score n" | `debtor.riskScore`, `debtor.risk`, `debtor.totalDebt`, `debtor.overdueDays`, `debtor.recommendationType`, `debtor.priorityScore` | [KPI-58](#kpi-58), [KPI-09](#kpi-09), [KPI-01](#kpi-01), [KPI-03](#kpi-03), [KPI-13](#kpi-13), [KPI-11](#kpi-11) |
| Objetos (`front/app/debtors/page.tsx`) | "n / N registros" | `filteredDebtors.length`, `debtors.length` | [KPI-51](#kpi-51) |
| Objetos (`front/app/debtors/page.tsx`) | Deuda total | `debtor.totalDebt` | [KPI-01](#kpi-01) |
| Objetos (`front/app/debtors/page.tsx`) | Estado de catálogo | `debtor.status` | [KPI-14](#kpi-14) |
| Objetos (`front/app/debtors/page.tsx`) | Personas | `debtor.peopleCount` | [KPI-06](#kpi-06) |
| Objetos (`front/app/debtors/page.tsx`) | Contacto | `debtor.hasContact` | [KPI-08](#kpi-08) |
| Objetos (`front/app/debtors/page.tsx`) | Riesgo | `debtor.risk`, `debtor.riskScore` | [KPI-09](#kpi-09) |
| Objetos (`front/app/debtors/page.tsx`) | "Prioridad <banda>", "Score n" | `debtor.priorityLevel`, `debtor.priorityScore` | [KPI-12](#kpi-12), [KPI-11](#kpi-11) |
| Objetos (`front/app/debtors/page.tsx`) | Recomendacion y motivo | `debtor.recommendationType`, `debtor.recommendationReason` | [KPI-13](#kpi-13) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | Riesgo (cabecera y tarjeta) | `debtor.risk`, `debtor.riskScore` | [KPI-09](#kpi-09) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | Deuda total; Deuda vencida al corte | `debtor.totalDebt`, `debtor.overdueDebt` | [KPI-01](#kpi-01), [KPI-02](#kpi-02) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | Atraso ("n dias", resumen y lectura operativa) | `debtor.maxDaysOverdue` | [KPI-03](#kpi-03) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | Estado de catálogo | `debtor.status` | [KPI-14](#kpi-14) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | Contacto: Disponible / Faltante / No disponible | `debtor.hasContact` | [KPI-08](#kpi-08) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | "n persona(s) asociada(s)" | `debtor.peopleCount` | [KPI-06](#kpi-06) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | "<banda> (score n)" | `debtor.priorityLevel`, `debtor.priorityScore` | [KPI-12](#kpi-12), [KPI-11](#kpi-11) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | Recomendacion actual / sugerida, texto y motivo | `debtor.recommendationType`, `debtor.recommendation`, `debtor.recommendationReason` | [KPI-13](#kpi-13) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | Perfil: Deuda total; Deuda vencida al corte | `profile.totalDebt`, `debtor.overdueDebt` proyectado al calendario | [KPI-01](#kpi-01), [KPI-02](#kpi-02) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | Perfil: Cantidad de deudas | `profile.debtCount` | [KPI-05](#kpi-05) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | Perfil: Antiguedad | `profile.antiquityDays` | [KPI-04](#kpi-04) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | Perfil: Contactos disponibles | `profile.availableContacts` | [KPI-07](#kpi-07) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | Perfil: Nivel socioeconomico / riesgo | `profile.risk`, `profile.riskScore`, `profile.socioeconomicLevel` | [KPI-10](#kpi-10) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | Procedencia temporal ("Calculado el …; corte no integrado") | `debtor.temporalProvenance` | [KPI-61](#kpi-61) |
| Ficha (`front/app/debtors/[debtorId]/page.tsx`) | Personas asociadas, contactos y deudas: campos de registro | `person.name`, `person.document`, `person.priority`, `person.relation`, `person.contact`, `contact.personId`, `contact.channel`, `contact.value`, `contact.isActive`, `debt.originalAmount`, `debt.updatedAmount`, `debt.period`, `debt.dueDate`, `debt.status` | [Campos de registro](#campos-de-registro) |
| Casos prioritarios (`front/app/priority-cases/page.tsx`) | "n casos" | `filteredCases.length` | [KPI-51](#kpi-51) |
| Casos prioritarios (`front/app/priority-cases/page.tsx`) | Cola elegida (antes "Ranking operativo"): Riesgo, Score / prioridad, Atraso, Deuda total, Contacto, Recomendacion | `debtor.risk`, `debtor.riskScore`, `debtor.priorityScore`, `debtor.priorityLevel`, `debtor.maxDaysOverdue`, `debtor.totalDebt`, `debtor.hasContact`, `debtor.recommendationType` | [KPI-31](#kpi-31), [KPI-09](#kpi-09), [KPI-11](#kpi-11), [KPI-12](#kpi-12), [KPI-03](#kpi-03), [KPI-01](#kpi-01), [KPI-08](#kpi-08), [KPI-13](#kpi-13) |
| Casos prioritarios (`front/app/priority-cases/page.tsx`) | "<cola> n casos" en la navegación de colas | `group.count` | [KPI-V1-10](#kpi-v1-casos-cola) |
| Ficha, pestaña Revisión sin snapshot (`front/components/review/review-panel.tsx`) | Deuda total; Deuda vencida; procedencia temporal de la ficha | `detail.debtor.totalDebt` histórico y `detail.debtor.overdueDebt` proyectado como el resumen. Sin corte evaluable, mora no disponible; sin publicaciones, la fecha de cálculo queda explícita y no habilita registrar | [KPI-01](#kpi-01), [KPI-02](#kpi-02) |
| Ficha, pestaña Revisión (`front/components/review/review-panel.tsx`) | Monto actualizado al corte; Obligaciones vencidas al corte; Atraso máximo al corte; Obligaciones no evaluables | factores y severidad de `getCaseReviewSnapshot` | [KPI-V1-11](#kpi-v1-monto-corte), [KPI-V1-12](#kpi-v1-vencidas-corte), [KPI-V1-13](#kpi-v1-atraso-corte), [KPI-V1-14](#kpi-v1-no-evaluables) |
| Ficha, pestaña Revisión (`front/components/review/review-panel.tsx`) | Severidad del objeto (v1); "n de m puntos"; Intensidad n | `explanation.severidad`, `explanation.factores`, `suggestedIntensity`, `decided_intensity` | [KPI-V1-15](#kpi-v1-severidad-revision), [KPI-V1-16](#kpi-v1-intensidad) |
| Ficha, pestaña Revisión (`front/components/review/review-form-controls.tsx`) | "n de 500 caracteres, contando los espacios" | `reasonCharCount` | [KPI-V1-17](#kpi-v1-contador-motivo) |
| Ficha, pestaña Revisión (`front/components/review/review-panel.tsx`) | Historial: fecha, rol, decisión, motivo, corte y versión | `case_review`, `case_review_approval` | [Adenda ALIGN-021](#adenda-revision-colas) |
| Personas (`front/app/people/page.tsx`) | "n / N personas" | `filteredPeople.length`, `peopleDashboard.totalPeople` | [KPI-51](#kpi-51) |
| Personas (`front/app/people/page.tsx`) | Riesgo bajo; Riesgo medio; Riesgo alto | `peopleDashboard.lowRiskCount`, `peopleDashboard.mediumRiskCount`, `peopleDashboard.highRiskCount` | [KPI-32](#kpi-32) |
| Personas (`front/app/people/page.tsx`) | Distribucion de riesgo individual | `peopleDashboard.individualRiskDistribution` | [KPI-32](#kpi-32) |
| Personas (`front/app/people/page.tsx`) | Sin contacto | `peopleDashboard.withoutContactCount` | [KPI-33](#kpi-33) |
| Personas (`front/app/people/page.tsx`) | "Con contacto: n" | `withContactCount` | [KPI-34](#kpi-34) |
| Personas (`front/app/people/page.tsx`) | Deuda asociada | `totalDebtAssociated` | [KPI-35](#kpi-35) |
| Personas (`front/app/people/page.tsx`) | "Riesgo promedio n / 100" | `averageRiskValue` | [KPI-36](#kpi-36) |
| Personas (`front/app/people/page.tsx`) | Top 5 personas con mayor riesgo | `peopleDashboard.topPeopleByRiskValue` | [KPI-37](#kpi-37) |
| Personas (`front/app/people/page.tsx`) | Riesgo individual; Puntaje | `person.individualRisk`, `person.riskValue` | [KPI-15](#kpi-15) |
| Personas (`front/app/people/page.tsx`) | Objetos / Objetos asociados | `person.debtorsCount` | [KPI-16](#kpi-16) |
| Personas (`front/app/people/page.tsx`) | Contacto disponible: Disponible / Faltante / No disponible | `person.hasContact` | [KPI-17](#kpi-17) |
| Personas (`front/app/people/page.tsx`) | Deuda total asociada; rótulo "Exposición asociada (no aditiva)" | `person.totalDebtAssociated`, `person.exposureLabel` | [KPI-18](#kpi-18) |
| Personas (`front/app/people/page.tsx`) | Nombre; Documento | `person.name`, `person.document` | [Campos de registro](#campos-de-registro) |
| Riesgo (`front/app/risk-analysis/page.tsx`) | Objetos con severidad alta y tabla de hasta 10 por cola | `objectDashboard.priorityCases`, `highRiskCases` | [KPI-38](#kpi-38), [KPI-31](#kpi-31) |
| Riesgo (`front/app/risk-analysis/page.tsx`) | "Personas con puntaje alto" y tabla de 10 | `peopleDashboard.highRiskCount`, `highIndividualRiskPeople` | [KPI-39](#kpi-39) |
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
| Deuda y mora (`front/app/debt-aging/page.tsx`) | Listado economico: orden de las filas | `sortedDebtors` | [KPI-59](#kpi-59) |
| Deuda y mora (`front/app/debt-aging/page.tsx`) | Tablas: Deuda total, Deuda vencida, Atraso / Dias de atraso, Estado de catálogo | `debtor.totalDebt`, `debtor.overdueDebt`, `debtor.maxDaysOverdue`, `debtor.status` | [KPI-01](#kpi-01), [KPI-02](#kpi-02), [KPI-03](#kpi-03), [KPI-14](#kpi-14) |
| Acciones (`front/app/recommended-actions/page.tsx`) | Tarjeta por recomendación: cantidad y monto | `item?.count`, `item?.debtAssociated` | [KPI-45](#kpi-45), [KPI-46](#kpi-46) |
| Acciones (`front/app/recommended-actions/page.tsx`) | Resumen: Cantidad de casos; Deuda asociada; "Riesgo promedio n / 100" | `group.count`, `group.debtAssociated`, `group.averageRisk` | [KPI-45](#kpi-45), [KPI-46](#kpi-46), [KPI-47](#kpi-47) |
| Acciones (`front/app/recommended-actions/page.tsx`) | Recomendacion; Casos destacados | `group.recommendation`, `group.highlightedCases` | [KPI-13](#kpi-13), [KPI-31](#kpi-31) |
| Acciones (`front/app/recommended-actions/page.tsx`) | "Qué suma el monto de cada cola": Suma de las colas | `reconciliation.queueTotal` | [KPI-V1-07](#kpi-v1-suma-colas) |
| Acciones (`front/app/recommended-actions/page.tsx`) | "Qué suma el monto de cada cola": Importe sin vencimiento evaluable; "n objetos · m obligaciones"; "n de esas obligaciones no tiene(n) importe observado" | `reconciliation.outsideAmount`, `reconciliation.outsideObjects`, `reconciliation.outsideObligations`, `reconciliation.outsideWithoutAmount` | [KPI-V1-08](#kpi-v1-fuera-colas) |
| Acciones (`front/app/recommended-actions/page.tsx`) | "Qué suma el monto de cada cola": Deuda total del tablero y sus faltantes | `reconciliation.dashboardTotal` | [KPI-20](#kpi-20), [KPI-60](#kpi-60) |
| Acciones (`front/app/recommended-actions/page.tsx`) | "Qué suma el monto de cada cola": Diferencia con el tablero; Resto de la diferencia | `reconciliation.difference`, `reconciliation.otherDifference` | [KPI-V1-09](#kpi-v1-diferencia-colas) |
| Sin contacto (`front/app/no-contact/page.tsx`) | Total sin contacto | `noContactCases.length` | [KPI-22](#kpi-22) |
| Sin contacto (`front/app/no-contact/page.tsx`) | Deuda asociada | `associatedDebt` | [KPI-48](#kpi-48) |
| Sin contacto (`front/app/no-contact/page.tsx`) | Riesgo alto sin contacto | `highRiskNoContact` | [KPI-49](#kpi-49) |
| Sin contacto (`front/app/no-contact/page.tsx`) | Sobre el total | `totalShare` | [KPI-50](#kpi-50) |
| Sin contacto (`front/app/no-contact/page.tsx`) | Listado (orden de [KPI-31](#kpi-31)): Riesgo, Deuda, Atraso | `debtor.risk`, `debtor.riskScore`, `debtor.totalDebt`, `debtor.maxDaysOverdue` | [KPI-31](#kpi-31), [KPI-09](#kpi-09), [KPI-01](#kpi-01), [KPI-03](#kpi-03) |
| Ingreso (`front/app/login/page.tsx`) | Casos criticos; Sin contacto; Deuda gestionada; barras Alto/Medio/Bajo | `metric.value`, `item.width` | [KPI-54](#kpi-54) |
| Varias pantallas (`front/app/**`) | Línea de faltantes ("Deuda total: n NO_INTEGRADO; …") | `missingSummary` | [KPI-60](#kpi-60) |
| Varias pantallas (`front/app/**`) | Identificador / Objeto; Tipo; Descripcion | `debtor.identifier`, `debtor.type`, `debtor.description` | [Campos de registro](#campos-de-registro) |
| Gráficos (`front/components/charts/debtor-dashboard-charts.tsx`) | Valor de cada barra o sector | `row.value`, `row.label` | Entrada de la serie que recibe el gráfico ([KPI-28](#kpi-28), [KPI-29](#kpi-29), [KPI-30](#kpi-30), [KPI-32](#kpi-32), [KPI-42](#kpi-42), [KPI-43](#kpi-43), [KPI-44](#kpi-44)) |
| Gráficos (`front/components/charts/debtor-dashboard-charts.tsx`) | "n,n%" en la leyenda del anillo | `percentage` | [KPI-52](#kpi-52) |
| Gráficos (`front/components/charts/debtor-dashboard-charts.tsx`) | Mensaje "Sin datos disponibles" | `rows` | [KPI-53](#kpi-53) |
| Insignias (`front/components/equitas/risk-badge.tsx`) | "ALTO (n)"; "No disponible" | `Math.round(score)` | [KPI-09](#kpi-09) |
| Insignias (`front/components/people/person-risk-badge.tsx`) | "ALTO (n)"; "No disponible" | `Math.round(score)` | [KPI-15](#kpi-15) |
| Insignias (`front/components/debtors/contact-availability-badge.tsx`) | Con contacto / Sin contacto / No disponible | `hasContact` | [KPI-08](#kpi-08) |

## 3. Indicadores del objeto tributario (por fila)

La unidad es el **objeto tributario** (cuenta), no la persona ni el hogar ([contrato §2][c2]).

### <a id="kpi-01"></a>KPI-01 · Deuda total del objeto

- **Pantallas:** "Deuda total" / "Deuda" en Objetos, Ficha (resumen y perfil), Casos prioritarios, Deuda y mora, Riesgo, Sin contacto y tablas del tablero.
- **Fórmula:** total del perfil persistido (`debtor_profile.total_debt_amount`), **incluido un 0 observado**; si el perfil no trae ese dato, Σ del importe actual de las obligaciones leídas (`current_amount`, o `updated_amount` si esa columna no existe; nunca el capital) (`front/lib/mappers/debtor-object-mapper.ts:428-432`; `currentAmount`, `front/lib/data-presence.ts:27-31`).
- **Unidad:** ARS por objeto.
- **Población:** un objeto; sus obligaciones leídas.
- **Corte:** mixto (§5.1): persistido al momento de la carga o recalculado en la consulta ([KPI-61](#kpi-61)); `as_of` no integrado.
- **Cobertura:** un total ilegible del perfil queda `INVALIDO` ("No disponible") y no se reemplaza por la suma; sin perfil, la suma cubre las obligaciones con importe observado y cuenta las demás como faltantes ([KPI-60](#kpi-60)); si falla la lectura de obligaciones, objetos o perfiles, "No disponible" (`front/lib/mappers/debtor-object-mapper.ts:425-426`, `430`).
- **Decisión que apoya:** dimensionar el monto en juego de un caso; es el insumo de monto de la severidad v1 ([reglas §4][r4]).
- **No significa:** deuda exigible ni vencida (incluye obligaciones no vencidas), monto recuperable, ni deuda de una persona.
- **Contrato:** [FO01][c76], [PR01][c75], [DE05/DE06][c73].

### <a id="kpi-02"></a>KPI-02 · Deuda vencida del objeto

- **Pantallas:** «Deuda vencida al corte» en Ficha (resumen y tarjeta), tablas de Deuda y mora y CSV de cola.
- **Fórmula:** suma en centavos de importes actuales positivos evaluables con vencimiento estrictamente anterior al corte v1 (`maturityMetrics` y `withMaturityMetrics`). No usa el estado de catálogo ni `debtor_profile.overdue_debt_amount` para representar la mora actual.
- **Unidad y población:** ARS de las obligaciones evaluables del objeto; no implica exigibilidad ni verificación jurídica.
- **Corte y cobertura:** mismo `decisionAsOf` que la severidad; datos parciales conservan subtotal y faltantes. Sin decisión evaluable → «No disponible»; completo sin vencidas → 0 observado. Véase [§21](#analitica-align014).
- **Histórico:** FO02/PR02 del mapeador y la base conservan su definición por estado de catálogo; la proyección de la vista no reescribe ese dato.

### <a id="kpi-03"></a>KPI-03 · Días de atraso del objeto

- **Pantallas:** «Atraso» / «Dias de atraso» en Ficha, Casos prioritarios, Sin contacto, Deuda y mora, tablas del tablero y CSV de cola.
- **Fórmula:** máximo de días calendario entre vencimiento y corte v1 para obligaciones evaluables con importe positivo y vencimiento anterior al corte; reutiliza `decision.severidad.dias_atraso_maximo`.
- **Unidad y población:** días, obligaciones evaluables vencidas del objeto; no es prescripción ni fecha de última gestión.
- **Corte y cobertura:** mismo `decisionAsOf` que [KPI-02](#kpi-02). Completo sin vencidas → `NO_APLICA`; las tablas lo presentan como «No disponible» sin unidad y la distribución como «No aplica». Parcial sin vencidas conocidas o corte no evaluable → «No disponible». Los faltantes permanecen en cobertura.
- **Histórico:** FO05 del DTO interno conserva la derivación por estado; la vista usa la proyección común de [§21](#analitica-align014), también ante objetos ausentes o en cuarentena en una carga parcial de ALIGN-031.

### <a id="kpi-04"></a>KPI-04 · Antigüedad

- **Pantallas:** "Antiguedad" en el perfil de la Ficha.
- **Fórmula:** días desde el vencimiento más antiguo del objeto, vencido o no (`front/lib/services/debtor-data-service.ts:21-25`, `37`).
- **Unidad:** días.
- **Población:** obligaciones del objeto con vencimiento.
- **Corte:** recalculado en la consulta ("calculado al día de la consulta; corte no integrado").
- **Cobertura:** sin vencimientos o con fecha ilegible, "No disponible" (`NO_INFORMADO_EN_ORIGEN` / `INVALIDO`); también si falla la lectura de obligaciones.
- **Decisión que apoya:** contexto del caso en la ficha; no ordena ninguna cola.
- **No significa:** atraso de la deuda vencida (puede incluir obligaciones al día) ni antigüedad de la relación con el contribuyente.
- **Contrato:** [FO06][c76].

### <a id="kpi-05"></a>KPI-05 · Cantidad de deudas

- **Pantallas:** "Cantidad de deudas" en el perfil de la Ficha.
- **Fórmula:** obligaciones leídas del objeto (`front/lib/mappers/debtor-object-mapper.ts:517`; mostrado en `front/app/debtors/[debtorId]/page.tsx:348`).
- **Unidad:** obligaciones.
- **Población:** obligaciones del objeto.
- **Corte:** no depende de una fecha.
- **Cobertura:** si falla la lectura de obligaciones u objetos, muestra "No disponible", no 0 ([contrato §4.1][c41], regla 6; `front/lib/mappers/debtor-object-mapper.ts:425`). Un objeto leído sin obligaciones muestra 0.
- **Decisión que apoya:** dimensionar el trabajo administrativo del caso.
- **No significa:** cantidad de períodos fiscales (el período real no está integrado) ni cantidad de vencidas.
- **Contrato:** [FO03][c76].

### <a id="kpi-06"></a>KPI-06 · Personas asociadas

- **Pantallas:** "Personas" en Objetos; "n persona(s) asociada(s)" en la Ficha; nombres en Sin contacto y Casos prioritarios.
- **Fórmula:** personas distintas con relación activa con el objeto (`front/lib/mappers/debtor-object-mapper.ts:352-354`, `510`).
- **Unidad:** personas.
- **Población:** relaciones del objeto.
- **Corte:** no depende de una fecha.
- **Cobertura:** todo objeto observado tiene al menos una relación; sin relaciones, `NO_INFORMADO_EN_ORIGEN`. Si falla la lectura de relaciones o personas, "No disponible".
- **Decisión que apoya:** saber a quién corresponde contactar o verificar.
- **No significa:** integrantes de un hogar ni responsables con cuota legal (el porcentaje declarado no es una cuota verificada).
- **Contrato:** [FO07][c76], [RE01–RE03][c74].

### <a id="kpi-07"></a>KPI-07 · Contactos disponibles

- **Pantallas:** "Contactos disponibles" en el perfil de la Ficha.
- **Fórmula:** contactos activos con valor de las personas con relación activa, deduplicados por persona, canal de origen (el tipo, no su etiqueta: una falla del catálogo no cambia el conteo) y valor; ya no usa el conteo del perfil (`front/lib/mappers/debtor-object-mapper.ts:328-338`, `387`, `421-423`).
- **Unidad:** contactos.
- **Población:** contactos de las personas del objeto.
- **Corte:** no depende de una fecha.
- **Cobertura:** si falla la lectura de contactos o de relaciones, "No disponible". "Disponible" = con valor cargado; validez y consentimiento `NO_INTEGRADO` (AU05).
- **Decisión que apoya:** si hay algún canal cargado para intentar un contacto.
- **No significa:** contactos válidos, vigentes ni con permiso de uso; tampoco personas con contacto.
- **Contrato:** [FO08][c76], [PR06][c75], [AU05][c711].

### <a id="kpi-08"></a>KPI-08 · Contacto del objeto (con / sin contacto)

- **Pantallas:** "Contacto" (Disponible/Faltante/No disponible, Con/Sin contacto) en Objetos, Casos prioritarios y Ficha.
- **Fórmula:** `contactCount > 0` ([KPI-07](#kpi-07)); si el conteo no está disponible, el valor es `null` (`front/lib/mappers/debtor-object-mapper.ts:424`) y la insignia dice "No disponible" (`front/components/debtors/contact-availability-badge.tsx:5`).
- **Unidad:** booleano.
- **Población:** un objeto.
- **Corte:** no depende de una fecha.
- **Cobertura:** "sin contacto" = cero contactos activos cargados. Un objeto con lectura fallida de contactos queda "No disponible" y no entra en las listas "sin contacto", que filtran por falso explícito (`front/lib/equitas-view-selectors.ts:54-56`).
- **Decisión que apoya:** si el caso puede gestionarse con el contribuyente o primero requiere mejorar datos (cola `MEJORAR_DATOS` de las [reglas v1][r7]).
- **No significa:** que el contribuyente no quiera o no pueda ser contactado; la falta de contacto es una **bandera de calidad** (`SIN_CONTACTO_ACTIVO`), nunca severidad ([reglas §5][r5]).
- **Contrato:** [FO09][c76], [AU05][c711].

### <a id="kpi-09"></a>KPI-09 · Riesgo del objeto (puntaje y banda)

- **Pantallas:** insignia "ALTO/MEDIO/BAJO (n)" o "No disponible" en Objetos, Ficha, Casos prioritarios, Riesgo, Sin contacto y tablero.
- **Fórmula:** índice heredado de severidad v0 del perfil (`socioeconomic_risk_level`: monto relativo al promedio del lote, mora, antigüedad, contactos y personas; `back/ETL/transform.py:535-597`), acotado a 0–100. Sin perfil, o con el valor faltante o ilegible, es "No disponible": el frontend ya no infiere un índice por señales (`front/lib/mappers/debtor-object-mapper.ts:446-450`). Bandas: 0–39 BAJO, 40–69 MEDIO, 70–100 ALTO (`front/lib/services/debtor-risk-calculator.ts:17-29`). La insignia redondea con `Math.round` (`front/components/equitas/risk-badge.tsx:8`).
- **Unidad:** puntos 0–100 (no %) y banda.
- **Población:** un objeto.
- **Corte:** persistido; la Ficha muestra "calculado el `<profile_generated_at>`" o "momento de cálculo desconocido" ([KPI-61](#kpi-61)); relativo al lote de carga.
- **Cobertura:** objeto sin perfil → "No disponible" (insignia neutra, `front/components/equitas/risk-badge.tsx:13`) y categoría "No disponible" en [KPI-28](#kpi-28); nunca BAJO.
- **Decisión que apoya:** hoy, ordenar y filtrar casos; en v1 lo reemplaza la **severidad** 0–100 con bandas absolutas ([reglas §4][r4], ALIGN-010).
- **No significa:** probabilidad de pago o de incumplimiento, riesgo social ni vulnerabilidad. La falta de contacto **sube** el índice heredado (+15 en el ETL): defecto declarado en el [contrato §10][c10] que corrigen las reglas v1.
- **Contrato:** [FO10][c76], [PR08][c75], [VP14][c79], [nombre heredado][c8] `socioeconomic_risk_level`.

### <a id="kpi-10"></a>KPI-10 · Nivel socioeconómico / riesgo

- **Pantallas:** tarjeta "Nivel socioeconomico / riesgo" del perfil en la Ficha: insignia de [KPI-09](#kpi-09) y el texto "No informado".
- **Fórmula:** insignia = KPI-09; texto = literal "No informado" (`front/lib/services/debtor-data-service.ts:42`).
- **Unidad:** banda y texto.
- **Población:** un objeto.
- **Corte:** el de KPI-09.
- **Cobertura:** la vulnerabilidad no existe en la cartera (`NO_INFORMADO_EN_ORIGEN`).
- **Decisión que apoya:** ninguna; el rótulo induce a error.
- **No significa:** nivel socioeconómico de nadie. El índice no es social; ALIGN-012 separa "Vulnerabilidad: no informada" en un bloque propio.
- **Contrato:** [FO11][c76], [AU01][c711], [mapa de nombres][c8].

### <a id="kpi-11"></a>KPI-11 · Score / prioridad (puntaje operativo heredado)

- **Pantallas:** "Score n" en Objetos y tablero; "Score / prioridad" en Casos prioritarios; "(score n)" en la Ficha.
- **Fórmula:** `min(total/250000, 4)·18 + min(días/30, 4)·10 + {30,18,8} por banda + (contacto ? 10 : −6) + {20,14,9,4} por recomendación`, redondeado, piso 0 (`front/lib/mappers/debtor-object-mapper.ts:119-146`). Solo se calcula si riesgo, deuda total, deuda vencida, contacto y atraso (o atraso `NO_APLICA`, que entra como 0 días) están disponibles; si no, "No disponible" (`:454-459`).
- **Unidad:** puntos 0–172 (no 0–100, no %).
- **Población:** un objeto.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** un insumo no disponible de KPI-01, KPI-02, KPI-03, KPI-08 o KPI-09 deja el puntaje "No disponible"; ya no se calcula con ceros sustitutos.
- **Decisión que apoya:** hoy, el orden de "A quien gestionar primero" ([KPI-58](#kpi-58)) y de los listados ([KPI-31](#kpi-31)). En v1 lo reemplaza la **prioridad operativa 0–100 dentro de cada cola** ([reglas §8][r8]).
- **No significa:** urgencia comparable entre colas ni probabilidad; es distinto del `priority_score` 0–100 de Python ([PY02][c710]).
- **Contrato:** [FO13][c76].

### <a id="kpi-12"></a>KPI-12 · Prioridad (banda)

- **Pantallas:** "Prioridad <banda>" en Objetos, Casos prioritarios y Ficha.
- **Fórmula:** KPI-11 ≥ 105 ALTA, ≥ 70 MEDIA, resto BAJA (`front/lib/mappers/debtor-object-mapper.ts:106-116`); sin puntaje, "No disponible" (`:456`).
- **Unidad:** banda.
- **Población:** un objeto.
- **Corte:** el de KPI-11.
- **Cobertura:** la de KPI-11.
- **Decisión que apoya:** hoy, marcar los objetos de [KPI-19](#kpi-19).
- **No significa:** que el caso deba recibir una acción intensa; la intensidad se decide por intervención y nunca supera 2 en forma automática ([reglas §7][r7]).
- **Contrato:** [FO14][c76].

### <a id="kpi-13"></a>KPI-13 · Recomendación

- **Pantallas:** "Recomendacion" (categoría, texto y motivo) en Objetos, Casos prioritarios, Ficha y tablero; filas de Acciones.
- **Fórmula:** reglas por banda de riesgo, contacto, deuda vencida y atraso ≥ 60 días (`front/lib/services/debtor-recommendation-generator.ts:19-73`). Cuatro categorías: Llamado prioritario, Mensaje recordatorio, Plan de pago / revision humana, Seguimiento posterior. Si falta algún insumo, la categoría es "No disponible" con motivo "Insumos no disponibles" (`front/lib/mappers/debtor-object-mapper.ts:451-453`).
- **Unidad:** categoría de acción.
- **Población:** un objeto.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** sin contacto y riesgo ALTO produce "revision humana" urgente. "No disponible" no es una de las cuatro categorías: no tiene tarjeta en Acciones ([KPI-45](#kpi-45)).
- **Decisión que apoya:** qué acción sugerir; en v1 la reemplaza la **intervención** con intensidad y canal requerido ([reglas §7][r7]).
- **No significa:** una decisión tomada ni una acción registrada: no existe registro de gestiones (AU03) y "revision humana" hoy es solo un texto.
- **Contrato:** [FO12][c76].

### <a id="kpi-14"></a>KPI-14 · Estado del objeto

- **Pantallas:** "Estado" en Objetos, Ficha y Deuda y mora.
- **Fórmula:** primera etiqueta de estado de sus obligaciones (etiqueta del catálogo `debt_status`; "UNKNOWN" si la obligación no tiene estado de catálogo, "No disponible" si el catálogo no se leyó), o el estado del objeto, o "No informado" (`front/lib/mappers/debtor-object-mapper.ts:192-198`, `486-497`).
- **Unidad:** etiqueta.
- **Población:** un objeto.
- **Corte:** `as_of` no integrado.
- **Cobertura:** sin estados, "No informado" (`NO_INFORMADO_EN_ORIGEN`); ya no inventa "En gestion" ni "Vencido".
- **Decisión que apoya:** ninguna confiable hoy: mezcla vigencia del objeto con estado de las obligaciones.
- **No significa:** que el objeto esté en gestión, ni su estado administrativo o jurídico.
- **Contrato:** [OB07][c72], [DE10][c73].

## 4. Indicadores de la persona (por fila)

### <a id="kpi-15"></a>KPI-15 · Puntaje y riesgo individual de la persona

- **Pantallas:** "Riesgo individual" (insignia) y "Puntaje" (dos decimales) en Personas y Riesgo; "Riesgo" en el top 5 de Personas.
- **Fórmula:** índice del objeto (PR08) + 15/3 por 0/1 contactos de la persona + 5 si el rol contiene "responsable" + 5 si el porcentaje declarado ≥ 75, acotado a 0–100 (`back/ETL/transform.py:694`); el frontend toma el **máximo** entre las filas de detalle de la persona (`front/lib/mappers/person-risk-mapper.ts:121-129`, `231-233`). Banda con los cortes de KPI-09.
- **Unidad:** puntos 0–100 (no %) y banda.
- **Población:** una persona y sus objetos vinculados.
- **Corte:** persistido; la consulta de personas no lee la fecha de cálculo (momento desconocido).
- **Cobertura:** una persona sin detalle de perfil muestra "No disponible" en insignia y puntaje, no 0 ni BAJO (`front/lib/mappers/person-risk-mapper.ts:231-233`; `front/components/people/person-risk-badge.tsx:19`); también si falla la lectura del detalle o de personas.
- **Decisión que apoya:** ninguna decisión de cobranza por sí sola: la unidad de gestión es el objeto. Sirve para revisar la exposición de una persona con varios objetos.
- **No significa:** riesgo social, vulnerabilidad, capacidad ni voluntad de pago de la persona. El rótulo correcto es "máxima severidad entre sus objetos" ([mapa de nombres][c8]).
- **Contrato:** [PR09][c75], [FP01][c77], [VP14][c79].

### <a id="kpi-16"></a>KPI-16 · Objetos asociados a la persona

- **Pantallas:** "Objetos" / "Objetos asociados" en Personas y Riesgo.
- **Fórmula:** objetos con relación activa con la persona (`front/lib/mappers/person-risk-mapper.ts:131-163`, `250`).
- **Unidad:** objetos.
- **Población:** relaciones activas de la persona.
- **Corte:** no depende de una fecha.
- **Cobertura:** completa para las relaciones cargadas; si falla la lectura de relaciones u objetos, "No disponible".
- **Decisión que apoya:** detectar personas vinculadas a varias cuentas (360 en el corte) para coordinar la gestión.
- **No significa:** propiedad ni responsabilidad legal sobre cada objeto.
- **Contrato:** [FP02][c77].

### <a id="kpi-17"></a>KPI-17 · Contacto disponible de la persona

- **Pantallas:** "Contacto disponible" (Disponible/Faltante/No disponible) en Personas.
- **Fórmula:** al menos un contacto activo con valor (`front/lib/mappers/person-risk-mapper.ts:165-212`, `251`).
- **Unidad:** booleano.
- **Población:** una persona.
- **Corte:** no depende de una fecha.
- **Cobertura:** si falla la lectura de contactos o personas, "No disponible". Validez y consentimiento `NO_INTEGRADO`.
- **Decisión que apoya:** si hay un canal cargado para esa persona.
- **No significa:** contacto verificado ni autorizado.
- **Contrato:** [FP03][c77], [AU05][c711].

### <a id="kpi-18"></a>KPI-18 · Deuda total asociada de la persona

- **Pantallas:** "Deuda total asociada" en el listado de Personas, con el rótulo "Exposición asociada (no aditiva)".
- **Fórmula:** Σ, por cada objeto vinculado, del importe actual de sus obligaciones (`current_amount` o `updated_amount`, sin usar el capital) (`front/lib/mappers/person-risk-mapper.ts:113-120`, `238-242`); rótulo en `:254`.
- **Unidad:** ARS, **exposición no aditiva**.
- **Población:** objetos vinculados a la persona.
- **Corte:** recalculado en la consulta a partir de las obligaciones leídas; `as_of` no integrado.
- **Cobertura:** los importes no observados se cuentan como faltantes; si falla la lectura de obligaciones, objetos, relaciones o personas, "No disponible". No usa el total del perfil del objeto, de modo que puede diferir de [KPI-01](#kpi-01).
- **Decisión que apoya:** ver cuánto se gestiona en total a través de una persona.
- **No significa:** deuda de la persona ni una parte proporcional: si dos personas comparten un objeto, ambas muestran su total completo; no se suma entre personas ([contrato §3][c3]).
- **Contrato:** [FP04][c77].

## 5. Tablero (`/`)

### <a id="kpi-19"></a>KPI-19 · Objetos prioritarios

- **Pantallas:** tarjeta "Objetos prioritarios" del tablero.
- **Fórmula:** objetos con [KPI-12](#kpi-12) = ALTA; un objeto sin puntaje cuenta como faltante, no como no prioritario (`front/lib/mappers/dashboard-metrics-mapper.ts:108-114`, `121`).
- **Unidad:** objetos.
- **Población:** todos los objetos leídos.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** los objetos con puntaje no disponible no se cuentan y se informan en [KPI-60](#kpi-60); si ninguno tiene puntaje o falla una lectura, "No disponible".
- **Decisión que apoya:** dimensionar la carga de gestión prioritaria del día.
- **No significa:** objetos "críticos" ([KPI-55](#kpi-55)) ni objetos con riesgo > 90 ([KPI-38](#kpi-38)): son tres poblaciones distintas.
- **Contrato:** [AG05][c78].

### <a id="kpi-20"></a>KPI-20 · Deuda total de la cartera

- **Pantallas:** "Deuda total" en el tablero (`dashboard.totalDebt`) y en Deuda y mora (`summary.totalDebt`); "Deuda total del tablero" en Acciones, para comparar con las colas ([§9](#diferencia-colas-tablero)).
- **Fórmula:** Σ [KPI-01](#kpi-01) sobre los objetos con total disponible (`front/lib/mappers/dashboard-metrics-mapper.ts:117`; `front/lib/equitas-view-selectors.ts:74-79`).
- **Unidad:** ARS.
- **Población:** todos los objetos leídos (suma por objeto, sin duplicar personas).
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** los objetos con total no disponible quedan fuera de la suma y se cuentan en [KPI-60](#kpi-60) ([contrato §4.1][c41]); si falla la lectura de objetos, obligaciones o perfiles, "No disponible".
- **Decisión que apoya:** tamaño de la cartera cargada y base de la concentración ([KPI-25](#kpi-25)).
- **No significa:** recaudación esperada ni deuda exigible.
- **Contrato:** [AG02][c78], [AG16][c78].

### <a id="kpi-21"></a>KPI-21 · Casos vencidos

- **Pantallas:** tarjeta "Casos vencidos" del tablero.
- **Fórmula:** objetos con [KPI-02](#kpi-02) > 0 (`front/lib/mappers/dashboard-metrics-mapper.ts:118`).
- **Unidad:** objetos (no obligaciones).
- **Población:** todos los objetos leídos.
- **Corte:** `as_of` no integrado; "vencido" según el estado que el ETL infirió al cargar.
- **Cobertura:** los objetos con deuda vencida no disponible se cuentan aparte ([KPI-60](#kpi-60)); depende del estado inferido ([DE10][c73]).
- **Decisión que apoya:** cuántos objetos están en mora.
- **No significa:** casos con estado administrativo "vencido" en origen ni casos en gestión.
- **Contrato:** [AG03][c78].

### <a id="kpi-22"></a>KPI-22 · Objetos sin contacto / con contacto

- **Pantallas:** tarjetas "Casos sin contacto" y "Con contacto" y frase "Hay n casos bloqueados por falta de contacto" del tablero; "Total sin contacto" en Sin contacto.
- **Fórmula:** objetos con [KPI-08](#kpi-08) falso / verdadero (`front/lib/mappers/dashboard-metrics-mapper.ts:119-120`; en Sin contacto, `getNoContactCases`, `front/lib/equitas-view-selectors.ts:54-56`).
- **Unidad:** objetos.
- **Población:** todos los objetos leídos; con + sin = objetos con contacto disponible.
- **Corte:** no depende de una fecha.
- **Cobertura:** los objetos con contacto no disponible no entran en ninguno de los dos y se informan en [KPI-60](#kpi-60); si falla la lectura de contactos o relaciones, "No disponible". "Sin contacto" = sin valor cargado (1568 de 2933 objetos en el corte); la validez de los cargados no está integrada.
- **Decisión que apoya:** dimensionar el trabajo de mejora de datos (cola `MEJORAR_DATOS`, [reglas §7][r7]).
- **No significa:** contribuyentes inubicables ni renuentes. "Bloqueados" se refiere a la gestión directa, no a la persona.
- **Contrato:** [AG04][c78], [AG17][c78].

### <a id="kpi-23"></a>KPI-23 · Recomendación urgente

- **Pantallas:** tarjeta "Recomendacion urgente" del tablero.
- **Fórmula:** objetos con `isUrgentRecommendation` ([KPI-13](#kpi-13)); los objetos sin puntaje se cuentan como faltantes (`front/lib/mappers/dashboard-metrics-mapper.ts:122`).
- **Unidad:** objetos.
- **Población:** todos los objetos leídos.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** hereda la de KPI-13; faltantes en [KPI-60](#kpi-60).
- **Decisión que apoya:** cuántos casos el recomendador heredado marca como urgentes.
- **No significa:** urgencia jurídica ni plazos; incluye objetos sin contacto con riesgo alto.
- **Contrato:** [AG06][c78].

### <a id="kpi-24"></a>KPI-24 · Porcentaje de objetos en riesgo alto

- **Pantallas:** "n% de los objetos estan en riesgo alto" (Resumen operativo del dia).
- **Fórmula:** `round(100 · byRisk[ALTO] / totalDebtors)` (`front/app/page.tsx:44`).
- **Unidad:** % de objetos, entero.
- **Población:** todos los objetos leídos; los de riesgo no disponible están en el denominador pero no pueden ser ALTO.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** sin objetos, "No aplica"; si ningún objeto tiene riesgo o falla la lectura de perfiles, "No disponible".
- **Decisión que apoya:** magnitud relativa de la cartera con índice heredado alto.
- **No significa:** porcentaje de contribuyentes que no pagarán.
- **Contrato:** [VP01][c79], [AG10][c78], [AG01][c78] (base).

### <a id="kpi-25"></a>KPI-25 · Concentración de la deuda en los 5 objetos mayores

- **Pantallas:** "Los 5 objetos con mayor deuda concentran n% del saldo total".
- **Fórmula:** `round(100 · Σ KPI-01 de los 5 mayores / KPI-20)` (`front/app/page.tsx:45`); los 5 mayores salen de un orden por KPI-01 con los no disponibles al final (`front/lib/mappers/dashboard-metrics-mapper.ts:60`, `76`).
- **Unidad:** % del saldo ARS, entero.
- **Población:** todos los objetos leídos; con ≤ 5 objetos da 100 %.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** saldo 0, "No aplica"; saldo no disponible, "No disponible"; hereda los faltantes de KPI-01.
- **Decisión que apoya:** si conviene una gestión específica de los grandes saldos.
- **No significa:** concentración por contribuyente (son objetos, no personas).
- **Contrato:** [VP02][c79].

### <a id="kpi-26"></a>KPI-26 · Distribución de recomendaciones

- **Pantallas:** "Recomendaciones sugeridas": "n casos (p%)" y barra por categoría.
- **Fórmula:** conteo de objetos por categoría de [KPI-13](#kpi-13) (las 4 categorías parten de 0, `front/lib/mappers/dashboard-metrics-mapper.ts:32-37`, `149`) y `round(100 · count / totalDebtors)` (`front/app/page.tsx:240-242`).
- **Unidad:** objetos y % de objetos, entero.
- **Población:** todos los objetos leídos; los de recomendación "No disponible" están en el denominador sin barra propia.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** si ningún objeto tiene puntaje, la serie queda vacía y las 4 categorías muestran "No disponible"; sin objetos, "No aplica"; los redondeos pueden no sumar 100.
- **Decisión que apoya:** repartir capacidad entre tipos de acción; en v1, el tamaño de cada cola por intervención.
- **No significa:** acciones realizadas.
- **Contrato:** [AG11][c78], [VP03][c79], [AG01][c78] (base).

### <a id="kpi-27"></a>KPI-27 · Recomendación dominante

- **Pantallas:** «"<categoría>" concentra n% de los objetos actuales» o «Empate: <categorías> concentra n%…».
- **Fórmula:** categoría de mayor conteo de KPI-26, sin contar "No disponible"; si varias empatan, se nombran todas con "Empate:"; `round(100 · value / totalDebtors)` (`front/app/page.tsx:46-49`, `271`).
- **Unidad:** categoría y % de objetos.
- **Población:** todos los objetos leídos.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** sin objetos (o total no disponible) muestra "Sin datos suficientes para consolidar recomendacion dominante."; los objetos "No disponible" están en el denominador.
- **Decisión que apoya:** lectura rápida de la acción más frecuente.
- **No significa:** la acción más importante ni la recomendada para la cartera.
- **Contrato:** [VP04][c79], [AG01][c78] (base).

### <a id="kpi-28"></a>KPI-28 · Distribución de objetos por riesgo

- **Pantallas:** anillo "Distribucion por riesgo" (tablero) y "Distribucion de objetos por riesgo" (Riesgo).
- **Fórmula:** conteo de objetos por banda de [KPI-09](#kpi-09) más la categoría "No disponible" (`front/lib/mappers/dashboard-metrics-mapper.ts:27-31`, `41`, `146-148`); Riesgo usa el mismo mapeador (`front/app/risk-analysis/page.tsx:31-32`); porcentajes de la leyenda en [KPI-52](#kpi-52).
- **Unidad:** objetos.
- **Población:** todos los objetos leídos.
- **Corte:** persistido (KPI-09).
- **Cobertura:** los objetos sin riesgo van en "No disponible", nunca en BAJO; si ningún objeto tiene riesgo, solo aparece esa categoría; si falla la lectura de perfiles, la serie queda vacía ([KPI-53](#kpi-53)).
- **Decisión que apoya:** composición de la cartera por índice heredado.
- **No significa:** distribución de probabilidad de pago ni de situación social.
- **Contrato:** [AG10][c78], [VP09][c79].

### <a id="kpi-29"></a>KPI-29 · Objetos por tipo

- **Pantallas:** barras "Objetos por tipo" del tablero.
- **Fórmula:** objetos por tipo de objeto (RODADO, AGUA, INMUEBLE…) (`front/lib/mappers/dashboard-metrics-mapper.ts:40`, `143-145`).
- **Unidad:** objetos.
- **Población:** todos los objetos leídos.
- **Corte:** no depende de una fecha.
- **Cobertura:** tipo faltante, "Sin tipo" (contrato: `NO_INFORMADO_EN_ORIGEN` o `INVALIDO`); si falla la lectura del catálogo de tipos, la serie queda vacía.
- **Decisión que apoya:** composición de la cartera por tributo o tipo de bien.
- **No significa:** deuda por tipo (cuenta objetos, no importes).
- **Contrato:** [AG09][c78], [OB03][c72].

### <a id="kpi-30"></a>KPI-30 · Top de deuda (5 objetos)

- **Pantallas:** barras "Top de deuda" del tablero.
- **Fórmula:** los 5 objetos de mayor [KPI-01](#kpi-01) entre los que tienen total disponible, rotulados por identificador (`front/lib/mappers/dashboard-metrics-mapper.ts:10-19`); sin desempate explícito (orden de lectura).
- **Unidad:** ARS por objeto.
- **Población:** objetos leídos con total disponible.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** hereda KPI-01; los objetos con total no disponible no se dibujan.
- **Decisión que apoya:** identificar los saldos más grandes.
- **No significa:** los casos a gestionar primero ([KPI-58](#kpi-58)) ni los más vencidos. Es distinto del top 10 de Deuda y mora ([KPI-44](#kpi-44)).
- **Contrato:** [AG12][c78].

### <a id="kpi-31"></a>KPI-31 · Orden operativo de los listados (`sortByOperationalPriority`)

- **Pantallas:** Casos prioritarios ya no usa este orden global: desde ALIGN-021 muestra una cola por vez ([KPI-V1-10](#kpi-v1-casos-cola)); el conjunto filtrado para [KPI-51](#kpi-51) sigue saliendo de esta lista. Listado de Sin contacto (`front/app/no-contact/page.tsx:48`); listado de Sin contacto (`front/app/no-contact/page.tsx:48`); tabla "Objetos con riesgo mayor a 90" de Riesgo (`front/app/risk-analysis/page.tsx:33`, `121`); "Casos destacados" (3 por categoría) de Acciones (`front/lib/equitas-view-selectors.ts:139`). **No** lo usan las tablas del tablero ([KPI-58](#kpi-58)).
- **Fórmula:** `sortByOperationalPriority` (`front/lib/equitas-view-selectors.ts:32-48`): [KPI-11](#kpi-11) descendente; si empata, puntaje de [KPI-09](#kpi-09) descendente; si empata, [KPI-01](#kpi-01) descendente; si empata, [KPI-03](#kpi-03) descendente. En cada criterio, un valor no disponible va al final (`compareNullable`, `front/lib/data-presence.ts:70-74`).
- **Unidad:** posición en una lista de objetos.
- **Población:** todos los objetos leídos (Casos prioritarios, antes de sus filtros) o el subconjunto de la pantalla (sin contacto, riesgo > 90, una categoría de recomendación).
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** hereda la de sus criterios. Los objetos con puntaje no disponible no se excluyen: van al final. No hay desempate por `id`: el ordenamiento es estable y, si empatan los cuatro criterios, conserva el orden de lectura.
- **Decisión que apoya:** a quién gestionar primero dentro de cada listado. En v1 se reemplaza por el orden dentro de cada cola con desempates deterministas ([reglas §8][r8]).
- **No significa:** el mismo orden del tablero ([KPI-58](#kpi-58)), que no desempata por riesgo: con igual puntaje, el ranking pone primero al de mayor riesgo y el tablero al de mayor deuda, de modo que el primer caso puede diferir. Tampoco es un orden comparable entre colas ni validado contra resultados de gestión.
- **Contrato:** [AG12][c78], [FO13][c76].

### <a id="kpi-58"></a>KPI-58 · Orden del tablero ("A quien gestionar primero" y "Casos sin contacto")

- **Pantallas:** tablas top 5 "A quien gestionar primero" y "Casos sin contacto" del tablero (`front/app/page.tsx:160`, `205`).
- **Fórmula:** `sortedByPriority` (`front/lib/mappers/dashboard-metrics-mapper.ts:48-58`): [KPI-11](#kpi-11) descendente; si empata, [KPI-01](#kpi-01) descendente; si empata, [KPI-03](#kpi-03) descendente; **sin desempate por riesgo** ([KPI-09](#kpi-09)); no disponibles al final. "A quien gestionar primero" toma los 5 primeros y descarta los de puntaje no disponible (`:62`, `162`); "Casos sin contacto" toma los 5 primeros con [KPI-08](#kpi-08) falso, sin descartar puntajes no disponibles (`:87-89`).
- **Unidad:** posición en una lista de objetos.
- **Población:** todos los objetos leídos / los objetos sin contacto.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** un objeto sin puntaje no aparece en "A quien gestionar primero" (la tabla puede tener menos de 5 filas); en "Casos sin contacto" puede aparecer después de los que tienen puntaje. No hay desempate por `id` (orden estable de lectura). La descripción de la tarjeta dice "por prioridad, deuda y riesgo" (`front/app/page.tsx:143`), pero el riesgo no interviene.
- **Decisión que apoya:** a quién gestionar primero desde el tablero.
- **No significa:** el orden de los listados ([KPI-31](#kpi-31)). Ejemplo sintético: dos objetos sin contacto con igual puntaje y atraso, A con riesgo 75 y deuda mayor y B con riesgo 95 y deuda menor: el tablero muestra A, B; el ranking, B, A.
- **Contrato:** [AG12][c78], [FO13][c76].

## 6. Personas (`/people`)

### <a id="kpi-32"></a>KPI-32 · Personas por riesgo individual

- **Pantallas:** tarjetas "Riesgo bajo / medio / alto" y anillo "Distribucion de riesgo individual" (Personas); anillo "Distribucion de personas por riesgo individual" (Riesgo).
- **Fórmula:** conteo de personas por banda de [KPI-15](#kpi-15); el anillo agrega la categoría "No disponible" (`front/lib/mappers/person-risk-mapper.ts:31-33`, `40`, `48-59`).
- **Unidad:** personas.
- **Población:** todas las personas leídas (no las filtradas).
- **Corte:** persistido.
- **Cobertura:** las personas sin detalle de perfil van en "No disponible", no en BAJO. Si ninguna persona tiene puntaje, las tres tarjetas dicen "No disponible" y el anillo muestra solo esa categoría; si falla la lectura del detalle o de personas, tarjetas "No disponible" y serie vacía.
- **Decisión que apoya:** ninguna decisión de gestión directa; describe a quiénes alcanzan los objetos de severidad alta.
- **No significa:** personas en riesgo social o vulnerables.
- **Contrato:** [AG10][c78], [FP01][c77].

### <a id="kpi-33"></a>KPI-33 · Personas sin contacto

- **Pantallas:** tarjeta "Sin contacto" de Personas.
- **Fórmula:** personas con [KPI-17](#kpi-17) falso (`front/lib/mappers/person-risk-mapper.ts:34`, `51`).
- **Unidad:** personas.
- **Población:** **todas** las personas leídas, aunque haya filtros activos.
- **Corte:** no depende de una fecha.
- **Cobertura:** si falla la lectura de personas o contactos, "No disponible". Validez `NO_INTEGRADO`.
- **Decisión que apoya:** dimensionar la verificación de datos de contacto por persona.
- **No significa:** el complemento de [KPI-34](#kpi-34): se muestran juntas pero tienen universos distintos.
- **Contrato:** [AG13][c78].

### <a id="kpi-34"></a>KPI-34 · Personas filtradas con contacto

- **Pantallas:** "Con contacto: n" dentro de la tarjeta "Sin contacto".
- **Fórmula:** personas filtradas con [KPI-17](#kpi-17) verdadero (`front/app/people/page.tsx:107`).
- **Unidad:** personas.
- **Población:** personas que pasan los filtros de la pantalla ([KPI-51](#kpi-51)).
- **Corte:** no depende de una fecha.
- **Cobertura:** subconjunto vacío → 0 derivado; si falla la lectura que usa el filtro, de personas o de contactos, "No disponible".
- **Decisión que apoya:** cuántas de las personas buscadas tienen un canal cargado.
- **No significa:** "total − sin contacto"; no se suma ni se resta con [KPI-33](#kpi-33).
- **Contrato:** [VP05][c79].

### <a id="kpi-35"></a>KPI-35 · Deuda asociada de las personas filtradas

- **Pantallas:** tarjeta "Deuda asociada" de Personas.
- **Fórmula:** Σ del importe de los **objetos distintos** vinculados a las personas filtradas: un objeto compartido por varias personas se cuenta una vez (`summarizePeople`, `front/lib/mappers/person-risk-mapper.ts:280-289`; `front/app/people/page.tsx:104-105`).
- **Unidad:** ARS.
- **Población:** objetos vinculados a las personas que pasan los filtros (antes de paginar).
- **Corte:** el de [KPI-18](#kpi-18).
- **Cobertura:** deduplica por objeto ([contrato §3][c3]); los importes no observados quedan fuera y se informan en [KPI-60](#kpi-60); si falla una lectura, "No disponible".
- **Decisión que apoya:** dimensionar la cartera alcanzada por un grupo de personas (por ejemplo, una búsqueda).
- **No significa:** deuda de esas personas, ni la suma de las filas de [KPI-18](#kpi-18) (exposiciones no aditivas), ni la deuda total de la cartera ([KPI-20](#kpi-20)).
- **Contrato:** [AG14][c78].

### <a id="kpi-36"></a>KPI-36 · Riesgo promedio de las personas filtradas

- **Pantallas:** "Riesgo promedio n / 100" en la tarjeta "Deuda asociada".
- **Fórmula:** promedio de [KPI-15](#kpi-15) de las personas filtradas con puntaje disponible, un decimal (`front/lib/mappers/person-risk-mapper.ts:288`; `front/app/people/page.tsx:188`).
- **Unidad:** puntos 0–100 (no %).
- **Población:** personas que pasan los filtros y tienen puntaje.
- **Corte:** persistido.
- **Cobertura:** sin personas, "No aplica"; las personas sin detalle quedan fuera del promedio y se informan en [KPI-60](#kpi-60); si ninguna tiene puntaje, "No disponible".
- **Decisión que apoya:** ninguna decisión operativa; es descriptivo.
- **No significa:** riesgo medio de la cartera ni de los objetos.
- **Contrato:** [AG14][c78].

### <a id="kpi-37"></a>KPI-37 · Top 5 personas con mayor riesgo

- **Pantallas:** tabla "Top 5 personas con mayor riesgo" de Personas (`front/app/people/page.tsx:215`).
- **Fórmula:** personas con [KPI-15](#kpi-15) disponible, ordenadas por puntaje descendente; si empata, [KPI-18](#kpi-18) descendente (no disponible al final); si empata, nombre ascendente (`localeCompare`); se toman las 5 primeras (`front/lib/mappers/person-risk-mapper.ts:60-72`).
- **Unidad:** personas.
- **Población:** todas las personas leídas (no las filtradas) **con puntaje disponible**.
- **Corte:** persistido.
- **Cobertura:** las personas sin detalle de perfil (puntaje "No disponible") **quedan fuera** del top; no participan con 0 ni BAJO. La tabla no lo advierte: esas personas solo se ven en la categoría "No disponible" de [KPI-32](#kpi-32). Con menos de 5 personas con puntaje, la tabla tiene menos filas. Hasta `c17a1bf` participaban con 0/BAJO; el cambio llega con ALIGN-011.
- **Decisión que apoya:** revisar personas vinculadas a objetos de severidad alta.
- **No significa:** contribuyentes a priorizar como personas: la gestión se decide por objeto.
- **Contrato:** [AG13][c78].

## 7. Riesgo (`/risk-analysis`)

### <a id="kpi-38"></a>KPI-38 · Objetos con severidad alta

- **Pantallas:** tarjeta «Objetos con severidad alta» y tabla de hasta diez objetos, ordenados dentro de cada cola.
- **Fórmula:** banda `ALTA` de la severidad v1, desde 70 puntos inclusive. Tarjeta (`priorityCases`) y tabla (`getHighRiskCases`) comparten selección. La prioridad solo ordena dentro de cada intervención; no compara colas.
- **Unidad:** objetos; los puntos de severidad no son porcentajes ni probabilidades.
- **Población:** objetos que cumplen los filtros de la vista, antes de paginar; los objetos sin puntaje se conservan en cobertura y en «No disponible».
- **Corte:** `decisionAsOf`, según la publicación vigente o la fecha de cálculo explícitamente rotulada (§21).
- **Cobertura:** perfil histórico fallido no invalida la severidad v1; falta de obligaciones, relaciones o corte evaluable produce «No disponible». Ningún objeto completo en banda alta → 0 observado.
- **Decisión que apoya:** revisar los objetos de banda alta con el corte y los faltantes visibles.
- **Compatibilidad:** comparte población con «críticos» ([KPI-55](#kpi-55)), [KPI-19](#kpi-19) y AG05. `riskAboveNinetyCases` (AG07b) sigue como compatibilidad interna, sin alimentar esta vista.
- **Contrato:** [VP10][c79], [AG05][c78]; definición vigente en [§21](#analitica-align014).

### <a id="kpi-39"></a>KPI-39 · Personas con puntaje alto

- **Pantallas:** "Personas con puntaje alto" ("Puntaje individual desde 70") y tabla de 10.
- **Fórmula:** conteo = personas en banda ALTO de [KPI-32](#kpi-32) (`highRiskCount`, equivale a [KPI-15](#kpi-15) ≥ 70; `front/app/risk-analysis/page.tsx:86`); tabla = personas con puntaje ≥ 70, ordenadas por puntaje descendente y luego [KPI-18](#kpi-18) descendente, sin más desempate (`getHighIndividualRiskPeople`, `front/lib/equitas-view-selectors.ts:62-72`), 10 primeras.
- **Unidad:** personas.
- **Población:** todas las personas leídas con puntaje disponible.
- **Corte:** persistido.
- **Cobertura:** las personas sin detalle quedan fuera; si ninguna tiene puntaje, el conteo es "No disponible".
- **Decisión que apoya:** la misma que [KPI-37](#kpi-37), con umbral.
- **No significa:** personas vulnerables ni de alto riesgo social.
- **Contrato:** [VP11][c79].

## 8. Deuda y mora (`/debt-aging`)

### <a id="kpi-40"></a>KPI-40 · Deuda vencida de la cartera

- **Pantallas:** tarjeta "Deuda vencida" de Deuda y mora.
- **Fórmula:** Σ [KPI-02](#kpi-02) sobre los objetos con deuda vencida disponible (`buildDebtAgingSummary`, `front/lib/equitas-view-selectors.ts:74-80`).
- **Unidad:** ARS.
- **Población:** todos los objetos leídos.
- **Corte:** mixto; "vencida" según el estado que el ETL infirió al cargar.
- **Cobertura:** los faltantes se informan en [KPI-60](#kpi-60); si falla la lectura de objetos, obligaciones, perfiles o del catálogo de estados, "No disponible". Depende del estado inferido ([DE10][c73]).
- **Decisión que apoya:** magnitud de la mora de la cartera.
- **No significa:** deuda exigible ni recuperable.
- **Contrato:** [AG16][c78].

### <a id="kpi-41"></a>KPI-41 · Promedio de atraso

- **Pantallas:** tarjeta "Promedio de atraso" ("n dias").
- **Fórmula:** promedio redondeado de [KPI-03](#kpi-03) sobre los objetos con deuda vencida > 0 y atraso disponible (`front/lib/equitas-view-selectors.ts:80-85`).
- **Unidad:** días.
- **Población:** objetos con [KPI-02](#kpi-02) > 0.
- **Corte:** mixto; reloj de la consulta.
- **Cobertura:** sin objetos vencidos, "No aplica", sin unidad; los objetos con deuda vencida o atraso no disponible se cuentan como faltantes ([KPI-60](#kpi-60)).
- **Decisión que apoya:** antigüedad típica de la mora.
- **No significa:** atraso promedio de las obligaciones (es el máximo por objeto, promediado).
- **Contrato:** [AG16][c78].

### <a id="kpi-42"></a>KPI-42 · Distribución por atraso

- **Pantallas:** barras "Distribucion por atraso" (Sin atraso / 1-30 / 31-90 / +90 días, y "No aplica" / "No disponible" cuando hay casos).
- **Fórmula:** conteo de objetos por banda de [KPI-03](#kpi-03); "No aplica" = objetos sin obligaciones vencidas; "No disponible" = atraso no disponible por otro motivo (`front/lib/equitas-view-selectors.ts:87-115`).
- **Unidad:** objetos.
- **Población:** todos los objetos leídos.
- **Corte:** mixto; reloj de la consulta.
- **Cobertura:** si falla la lectura de objetos, obligaciones, perfiles o del catálogo de estados, la serie queda vacía ([KPI-53](#kpi-53)).
- **Decisión que apoya:** repartir la cartera por antigüedad de la mora.
- **No significa:** las bandas de antigüedad de la severidad v1 (1 / 31 / 91 / 181 / 366 / 731 días, [reglas §4][r4]). "Sin atraso" cuenta solo objetos con vencidas de 0 días, no los que no tienen vencidas.
- **Contrato:** [AG16][c78].

### <a id="kpi-43"></a>KPI-43 · Deuda por estado

- **Pantallas:** barras "Deuda por estado".
- **Fórmula:** Σ [KPI-01](#kpi-01) agrupada por [KPI-14](#kpi-14), orden descendente; los objetos con total no disponible no se suman (`front/app/debt-aging/page.tsx:52-61`).
- **Unidad:** ARS por etiqueta de estado del objeto.
- **Población:** objetos leídos con total disponible.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** objetos sin estado caen en "No informado" (o "UNKNOWN" si la obligación no tiene estado de catálogo).
- **Decisión que apoya:** ninguna confiable hoy (la etiqueta no es un estado de origen).
- **No significa:** conteo de obligaciones por estado ([KPI-57](#kpi-57)) ni estado administrativo de las deudas.
- **Contrato:** [VP07][c79], [OB07][c72].

### <a id="kpi-44"></a>KPI-44 · Top deuda por objeto (10 objetos)

- **Pantallas:** barras "Top deuda por objeto" y tabla "Top 10 mayor deuda".
- **Fórmula:** los 10 objetos de mayor [KPI-01](#kpi-01), no disponibles al final, sin desempate explícito (`front/lib/equitas-view-selectors.ts:86`); el gráfico omite los de total no disponible (`front/app/debt-aging/page.tsx:62-65`).
- **Unidad:** ARS por objeto.
- **Población:** todos los objetos leídos.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** hereda KPI-01.
- **Decisión que apoya:** la misma que [KPI-30](#kpi-30), con 10 objetos.
- **No significa:** el top 5 del tablero ni un orden de gestión; tampoco el orden del Listado economico ([KPI-59](#kpi-59)).
- **Contrato:** [VP08][c79].

### <a id="kpi-59"></a>KPI-59 · Orden del "Listado economico"

- **Pantallas:** tabla "Listado economico" de Deuda y mora, paginada (`front/app/debt-aging/page.tsx:159-164`).
- **Fórmula:** `sortedDebtors` (`front/app/debt-aging/page.tsx:66-72`): [KPI-02](#kpi-02) descendente; si empata, [KPI-03](#kpi-03) descendente; no disponibles al final; sin más desempates (orden estable de lectura).
- **Unidad:** posición en una lista de objetos.
- **Población:** todos los objetos leídos.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** los objetos con deuda vencida no disponible van al final; los que no tienen vencidas (0 ARS) quedan antes que ellos.
- **Decisión que apoya:** revisar primero los objetos con mayor monto en mora.
- **No significa:** el top 10 por deuda total ([KPI-44](#kpi-44)) ni el orden operativo ([KPI-31](#kpi-31), [KPI-58](#kpi-58)).
- **Contrato:** [AG16][c78], [FO02][c76].

## 9. Acciones recomendadas (`/recommended-actions`)

### <a id="diferencia-colas-tablero"></a>Por qué la suma de las colas difiere de la deuda total del tablero

Son dos cifras con definición distinta, y ninguna corrige a la otra. Desde ALIGN-010 el monto de cada cola es [KPI-V1-05](#kpi-v1-monto-cola), no [KPI-46](#kpi-46): suma solo las **obligaciones evaluables** de sus objetos (importe observado y ≥ 0, con vencimiento observado y no anterior a `fecha_minima_plausible`), vencidas o no. La deuda total del tablero ([KPI-20](#kpi-20)) suma [KPI-01](#kpi-01) por objeto: el total del perfil persistido o, si el perfil no lo trae, todas las obligaciones con importe, tengan o no vencimiento.

La diferencia se muestra en pantalla y tiene dos partes:

1. **Importe sin vencimiento evaluable** ([KPI-V1-08](#kpi-v1-fuera-colas)): importe observado de las obligaciones cuyo vencimiento falta, es inválido o es anterior al mínimo plausible. Un objeto puede estar en una cola y aportar solo una parte de su deuda (severidad `PARCIAL`), o estar en la cola con monto "No disponible" (`NO_DISPONIBLE`).
2. **Resto de la diferencia** ([KPI-V1-09](#kpi-v1-diferencia-colas)): totales del perfil distintos de la suma de obligaciones, importes negativos (no evaluables, pero suman en KPI-01) y objetos sin decisión. Puede ser negativo.

Caso armado a mano (`front/tests/pages/correcciones-noche-4.test.ts`, corte 2026-09-30, sin perfil):

| Objeto | Obligaciones | En la cola | Sin vencimiento evaluable | En el tablero |
|---|---|---|---|---|
| A | 1000 con vencimiento; 300 sin vencimiento | 1000 | 300 | 1300 |
| B | 500 con vencimiento futuro | 500 | 0 | 500 |
| C | 200 sin vencimiento | No disponible | 200 | 200 |
| D | importe y vencimiento faltantes | No disponible | sin importe observado | No disponible |
| E | 700 con vencimiento de 1960 | No disponible | 700 | 700 |
| F | −50 con vencimiento válido | No disponible | 0 | −50 |
| **Total** | | **1500** | **1200** (4 objetos, 4 obligaciones, 1 sin importe) | **2650** |

Diferencia: 2650 − 1500 = 1150. Resto: 1150 − 1200 = −50, el importe negativo de F.

Si falla una lectura de la que depende una cifra, esa cifra y las que se derivan de ella quedan "No disponible": nunca $0 ni "0 objetos" fuera de las colas ([contrato §4.1][c41], reglas 4 y 6).

### <a id="kpi-45"></a>KPI-45 · Casos por recomendación

- **Pantallas:** valor de cada tarjeta y "Cantidad de casos" del resumen.
- **Fórmula:** objetos por categoría de [KPI-13](#kpi-13) (`buildRecommendationSummary`, `front/lib/equitas-view-selectors.ts:126-150`).
- **Unidad:** objetos.
- **Población:** todos los objetos leídos; las 4 categorías siempre presentes; "No disponible" no tiene tarjeta.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** categoría vacía → 0 derivado; los objetos con recomendación "No disponible" se informan como faltantes en cada categoría ([KPI-60](#kpi-60)); si falla una lectura, "No disponible".
- **Decisión que apoya:** capacidad necesaria por tipo de acción.
- **No significa:** acciones realizadas ni pendientes registradas.
- **Contrato:** [AG15][c78].

### <a id="kpi-46"></a>KPI-46 · Deuda asociada por recomendación

- **Pantallas:** monto de cada tarjeta y "Deuda asociada" del resumen.
- **Fórmula:** Σ [KPI-01](#kpi-01) de los objetos de la categoría con total disponible (`front/lib/equitas-view-selectors.ts:133-136`).
- **Unidad:** ARS.
- **Población:** objetos de una categoría (las 4 categorías y los "No disponible" particionan la cartera).
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** los totales no disponibles y los objetos "No disponible" se informan como faltantes ([KPI-60](#kpi-60)); si falla una lectura, "No disponible".
- **Decisión que apoya:** monto en juego de cada tipo de acción.
- **No significa:** la "Deuda asociada" de Personas ([KPI-35](#kpi-35)) ni la de Sin contacto ([KPI-48](#kpi-48)).
- **Contrato:** [AG15][c78].

### <a id="kpi-47"></a>KPI-47 · Riesgo promedio por recomendación

- **Pantallas:** "Riesgo promedio n / 100" del resumen.
- **Fórmula:** promedio de [KPI-09](#kpi-09) de los objetos de la categoría con riesgo disponible, un decimal (`front/lib/equitas-view-selectors.ts:135`).
- **Unidad:** puntos 0–100 (no %).
- **Población:** objetos de una categoría.
- **Corte:** persistido.
- **Cobertura:** categoría vacía, "No aplica" (o "No disponible" si hay objetos con recomendación "No disponible").
- **Decisión que apoya:** ninguna decisión operativa; describe la categoría.
- **No significa:** probabilidad media de pago.
- **Contrato:** [AG15][c78].

## 10. Sin contacto (`/no-contact`)

### <a id="kpi-48"></a>KPI-48 · Deuda asociada a objetos sin contacto

- **Pantallas:** tarjeta "Deuda asociada" de Sin contacto.
- **Fórmula:** Σ [KPI-01](#kpi-01) de los objetos sin contacto con total disponible (`front/app/no-contact/page.tsx:49`).
- **Unidad:** ARS.
- **Población:** objetos con [KPI-08](#kpi-08) falso.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** hereda KPI-01; si falla la lectura de objetos, obligaciones, contactos o relaciones, "No disponible".
- **Decisión que apoya:** monto que no puede gestionarse con el contribuyente hasta mejorar datos.
- **No significa:** deuda incobrable.
- **Contrato:** [AG17][c78].

### <a id="kpi-49"></a>KPI-49 · Riesgo alto sin contacto

- **Pantallas:** tarjeta "Riesgo alto sin contacto".
- **Fórmula:** objetos sin contacto con banda [KPI-09](#kpi-09) = ALTO (`front/app/no-contact/page.tsx:50-52`).
- **Unidad:** objetos.
- **Población:** objetos con [KPI-08](#kpi-08) falso.
- **Corte:** persistido.
- **Cobertura:** los objetos sin riesgo se informan como faltantes en la línea de [KPI-60](#kpi-60) de la pantalla (`front/app/no-contact/page.tsx:74`). El índice heredado **suma** por falta de contacto, de modo que este conteo está inflado por construcción ([contrato §10][c10]).
- **Decisión que apoya:** priorizar la mejora de datos entre objetos con deuda grande o antigua.
- **No significa:** contribuyentes de alto riesgo que evitan el contacto.
- **Contrato:** [AG17][c78].

### <a id="kpi-50"></a>KPI-50 · Sin contacto sobre el total

- **Pantallas:** tarjeta "Sobre el total" ("n%").
- **Fórmula:** `round(100 · objetos sin contacto / objetos leídos)` (`front/app/no-contact/page.tsx:53-54`).
- **Unidad:** % de objetos, entero.
- **Población:** todos los objetos leídos (incluidos los de contacto no disponible, en el denominador).
- **Corte:** no depende de una fecha.
- **Cobertura:** base 0, "No aplica"; lectura fallida de objetos, contactos o relaciones, "No disponible".
- **Decisión que apoya:** magnitud del problema de calidad de contactos.
- **No significa:** porcentaje de contribuyentes inubicables.
- **Contrato:** [AG17][c78].

## 11. Transversales y cifras que no son datos

### <a id="kpi-51"></a>KPI-51 · Contadores de resultados de filtros

- **Pantallas:** "n / N registros" (Objetos), "n casos" (Casos prioritarios), "n / N personas" (Personas).
- **Fórmula:** elementos que pasan los filtros de la pantalla / total leído (`front/app/debtors/page.tsx:75-102`, `197-198`; `front/app/priority-cases/page.tsx:72-89`, `109`; `front/app/people/page.tsx:38-50`, `123-124`).
- **Unidad:** objetos o personas.
- **Población:** la del listado.
- **Corte:** no depende de una fecha.
- **Cobertura:** si falla la lectura de una tabla que usa el filtro, "No disponible". Un monto mínimo no numérico da "0 casos" junto al aviso "Monto mínimo inválido"; con monto mínimo, los objetos de total no disponible quedan fuera.
- **Decisión que apoya:** acotar el trabajo a un subconjunto.
- **No significa:** casos prioritarios por sí mismo (en Casos prioritarios cuenta todos los objetos filtrados).
- **Contrato:** [VP06][c79].

### <a id="kpi-52"></a>KPI-52 · Porcentaje en la leyenda del anillo

- **Pantallas:** "n,n%" junto a cada banda de los anillos ([KPI-28](#kpi-28), [KPI-32](#kpi-32)).
- **Fórmula:** 100 · valor de la banda / Σ de la serie, un decimal (`front/components/charts/debtor-dashboard-charts.tsx:131`, `177`); la categoría "No disponible" entra en la serie y en el denominador.
- **Unidad:** % de la serie.
- **Población:** la serie del gráfico.
- **Corte:** el de la serie.
- **Cobertura:** serie vacía o de total 0, sin anillo ni porcentaje: "Sin datos disponibles" (`front/components/charts/debtor-dashboard-charts.tsx:135`).
- **Decisión que apoya:** la de la serie.
- **No significa:** un porcentaje de la cartera si la serie es de personas, ni un porcentaje sobre los objetos con dato (incluye los "No disponible").
- **Contrato:** [VP12][c79].

### <a id="kpi-53"></a>KPI-53 · Mensaje "Sin datos disponibles"

- **Pantallas:** tarjeta del gráfico con el texto "Sin datos disponibles" cuando la serie está vacía.
- **Fórmula:** serie vacía → tarjeta con el título y el texto, sin barra ni sector (`EmptyChart`, `front/components/charts/debtor-dashboard-charts.tsx:63-66`, `79`, `135`, `230`).
- **Unidad:** —.
- **Población:** —.
- **Corte:** —.
- **Cobertura:** aparece también cuando falló la lectura (los mapeadores devuelven serie vacía): el mensaje no distingue "sin datos" de "lectura fallida"; la advertencia de lectura se muestra aparte.
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

### <a id="kpi-60"></a>KPI-60 · Línea de faltantes por estado

- **Pantallas:** línea de texto bajo las advertencias de lectura en el tablero (`front/app/page.tsx:66`), la Ficha (`front/app/debtors/[debtorId]/page.tsx:74`), Personas (`front/app/people/page.tsx:130`), Riesgo (`front/app/risk-analysis/page.tsx:50`), Deuda y mora (`front/app/debt-aging/page.tsx:90`), Acciones (`front/app/recommended-actions/page.tsx:46`) y Sin contacto (`front/app/no-contact/page.tsx:74`).
- **Fórmula:** para cada indicador agregado de la pantalla, "<rótulo>: n <ESTADO>" por cada estado de presencia con faltantes (`missingSummary`, `front/lib/data-presence.ts:90-102`); los conteos salen de `aggregateData` (`front/lib/data-presence.ts:39-56`). En los conteos de objetos del tablero, cada objeto incompleto cuenta una vez por estado (`front/lib/mappers/dashboard-metrics-mapper.ts:108-114`).
- **Unidad:** filas (objetos, personas u obligaciones) por estado de presencia.
- **Población:** la de cada indicador listado.
- **Corte:** el del indicador.
- **Cobertura:** no lista las bases vacías (`NO_APLICA`) ni las lecturas fallidas, que dejan el valor "No disponible" sin conteo; un indicador sin rótulo propio aparece como "Dato"; los estados se muestran con su código (`NO_INTEGRADO`, `NO_INFORMADO_EN_ORIGEN`, `INVALIDO`).
- **Decisión que apoya:** saber cuántas filas quedaron fuera de cada cifra antes de usarla ("n de N con dato", [contrato §4.1][c41]).
- **No significa:** errores de la cartera: `NO_INTEGRADO` puede ser un dato que EQUITAS todavía no lee.
- **Contrato:** [reglas de agregación][c41].

### <a id="kpi-61"></a>KPI-61 · Procedencia temporal del objeto

- **Pantallas:** línea de texto bajo el encabezado de la Ficha (`front/app/debtors/[debtorId]/page.tsx:73`).
- **Fórmula:** texto del mapeador: con perfil, "Calculado el `<profile_generated_at>` (componente persistido); al día de la consulta (antigüedad recalculada); estado del catálogo persistido: momento de cálculo desconocido; corte no integrado", o "en momento de cálculo desconocido" si la fecha falta o es ilegible; sin perfil, "Calculado al día de la consulta (importes y antigüedad); perfil no integrado; …" (`front/lib/mappers/debtor-object-mapper.ts:460-464`).
- **Unidad:** texto con fecha-hora.
- **Población:** un objeto.
- **Corte:** es la declaración del corte de los valores de la Ficha.
- **Cobertura:** la consulta de personas no lee esa fecha; las demás pantallas no muestran la procedencia.
- **Decisión que apoya:** saber de cuándo son los valores persistidos antes de usarlos.
- **No significa:** la fecha de corte municipal (`as_of` no integrado) ni la fecha de la consulta.
- **Contrato:** [procedencia temporal][c51].

## 12. Indicadores no visibles que generan confusión

No se muestran hoy, pero existen en `DashboardData` y ALIGN-014 debe redefinir "críticos" con este catálogo antes de mostrarlos.

### <a id="kpi-55"></a>KPI-55 · Casos críticos hoy (no visible)

- **Fórmula:** objetos con `riskScore > 90` **o** recomendación urgente **o** (deuda vencida > 0 **y** sin contacto) (`front/lib/mappers/dashboard-metrics-mapper.ts:101-105`, `123`).
- **Unidad:** objetos.
- **Población:** todos los objetos leídos.
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** un objeto sin riesgo o sin contacto disponible no entra por esas condiciones; los objetos sin puntaje se cuentan como faltantes.
- **Decisión que apoya:** ninguna definida: mezcla severidad, recomendación y calidad de datos.
- **No significa:** la población de [KPI-56](#kpi-56) ("deuda crítica") ni la de [KPI-38](#kpi-38).
- **Contrato:** [AG07a][c78].

### <a id="kpi-56"></a>KPI-56 · Deuda crítica (no visible)

- **Fórmula:** Σ [KPI-01](#kpi-01) de los objetos con `riskScore > 90` (`front/lib/mappers/dashboard-metrics-mapper.ts:125`).
- **Unidad:** ARS.
- **Población:** la de [KPI-38](#kpi-38), **no** la de [KPI-55](#kpi-55).
- **Corte:** mixto; `as_of` no integrado.
- **Cobertura:** sin objetos > 90 con universo leído → 0 derivado; los objetos sin riesgo se cuentan como faltantes.
- **Decisión que apoya:** ninguna definida.
- **No significa:** la deuda de los "casos críticos": mostrarlas juntas sugeriría que comparten población.
- **Contrato:** [AG07c][c78].

### <a id="kpi-57"></a>KPI-57 · Obligaciones por estado (no visible)

- **Fórmula:** conteo de obligaciones por etiqueta de estado de catálogo de la obligación (`front/lib/mappers/debtor-object-mapper.ts:401-406`; `front/lib/mappers/dashboard-metrics-mapper.ts:140-142`).
- **Unidad:** obligaciones.
- **Población:** obligaciones leídas.
- **Corte:** `as_of` no integrado.
- **Cobertura:** estado inferido por el ETL ([DE10][c73]); si falla la lectura de obligaciones o del catálogo de estados, serie vacía.
- **Decisión que apoya:** ninguna hoy.
- **No significa:** la "Deuda por estado" visible ([KPI-43](#kpi-43)), que suma ARS por estado del objeto.
- **Contrato:** [AG08][c78].

## 13. <a id="campos-de-registro"></a>Campos de registro (no son indicadores)

Valores de una fila que se muestran tal como llegan, con un rótulo heredado o con "No informado" si faltan. No se agregan ni orientan una decisión por sí solos; su significado está en el contrato. Los marcados con † tienen rótulo engañoso que corrige ALIGN-012.

| Rótulo visible | Expresión | Significado correcto | Contrato |
|---|---|---|---|
| Identificador / Objeto | `debtor.identifier` | `Identificador` de origen; hoy `OBJ-<id>` si falta | [OB04][c72] |
| Tipo | `debtor.type` | Tipo de objeto del catálogo | [OB03][c72] |
| Descripcion | `debtor.description` | `Bien_Descripcion` de origen | [OB05][c72] |
| Nombre / Persona | `person.name`, `contact.personId` (respaldo "Persona <id>") | Destinatario informado en origen | [PE02][c74] |
| Documento | `person.document` | CUIT informado; validez no verificada | [PE03][c74] |
| Prioridad de contacto † | `person.priority` | **Porcentaje declarado** en origen, no una prioridad; "No informado" si falta | [RE01][c74] |
| Relacion | `person.relation` | Rol declarado en origen | [RE02][c74] |
| Contacto (persona) | `person.contact` | Primer contacto cargado, no verificado | [CO01][c74] |
| Canal | `contact.channel` | Etiqueta del catálogo `contact_type`, nunca el ID. "No disponible" si el tipo no figura en el catálogo o el catálogo no se leyó (con aviso). Solo sin tipo se infiere por `@` (Email o Telefono; dato derivado) | [CO02][c74] |
| Valor; Estado (contacto) | `contact.value`, `contact.isActive` | Valor cargado; "Activo" ≠ verificado | [CO01][c74], [CO03][c74] |
| Monto original | `debt.originalAmount` | `NOTD_capital` | [DE04][c73] |
| Monto actualizado | `debt.updatedAmount` | Importe actual (`current_amount` o `updated_amount`); un 0 se conserva y no se reemplaza por el capital | [DE06][c73] |
| Periodo † | `debt.period` | **ID externo** de la obligación (`DEUD_id`), no período fiscal; "No informado" si falta | [DE02][c73] |
| Vencimiento | `debt.dueDate` | `NOTD_vencimiento` | [DE07][c73] |
| Estado (obligación) | `debt.status` | Etiqueta del catálogo `debt_status`: estado **inferido** por el ETL al cargar, no estado de origen; "UNKNOWN" sin estado | [DE10][c73] |

## 14. Hallazgos para el contrato (no corregidos aquí)

El contrato de ALIGN-007 no se modifica en este ticket. Al inventariar se encontró:

1. [VP14][c79] cita `riskValue.toFixed(2)` solo en Riesgo; el listado y el top 5 de Personas también lo muestran (`front/app/people/page.tsx`). El significado no cambia ([KPI-15](#kpi-15)).
2. [AG18][c78] describe las tres tarjetas de la pantalla de ingreso, pero no las barras `RISK_PREVIEW` (Alto/Medio/Bajo con anchos fijos), que son igualmente ilustrativas ([KPI-54](#kpi-54)).
3. Ninguna entrada del contrato nombra los **órdenes** que deciden qué casos se ven primero: `sortByOperationalPriority` (cuatro pantallas), el orden propio del tablero, que no desempata por riesgo, y el del Listado economico; aquí se catalogan como [KPI-31](#kpi-31), [KPI-58](#kpi-58) y [KPI-59](#kpi-59) a partir de [AG12][c78], [AG16][c78] y [FO13][c76].
4. Tras ALIGN-011, varias citas `archivo:línea` del contrato remiten a líneas que se corrieron (por ejemplo, FO01 cita las líneas 445-451 de `front/lib/mappers/debtor-object-mapper.ts`, y el cálculo está hoy en `front/lib/mappers/debtor-object-mapper.ts:428-432`; PR09 cita las líneas 127-150 de `front/lib/mappers/person-risk-mapper.ts`, y el cálculo está hoy en `front/lib/mappers/person-risk-mapper.ts:121-129`, `231-233`). Este catálogo cita las líneas del código integrado. Tampoco hay entrada para la línea de faltantes ([KPI-60](#kpi-60)).

## 15. Control de versiones

| Versión | Fecha | Cambio |
|---|---|---|
| v1 | 29/10/2026 | Versión inicial (ALIGN-013): inventario de cifras visibles en `c17a1bf` y una entrada enlazable por indicador. Provisional como el contrato y las reglas que cita. Cada indicador nuevo o redefinido (ALIGN-010, 014, 021) se agrega en una versión nueva |
| v1 (corrección 1) | 29/10/2026 | Revisión independiente: el orden del tablero se separa del de los listados ([KPI-58](#kpi-58)); población real del top 5 de personas; orden del Listado economico ([KPI-59](#kpi-59)). Se describe el código integrado con ALIGN-011 (`ab4c5b3`): estados "No disponible"/"No aplica", línea de faltantes ([KPI-60](#kpi-60)) y procedencia temporal ([KPI-61](#kpi-61)) |
| v1.2 | 02/11/2026 | Correcciones tras la prueba manual: entradas [KPI-V1-07](#kpi-v1-suma-colas), [KPI-V1-08](#kpi-v1-fuera-colas) y [KPI-V1-09](#kpi-v1-diferencia-colas) ([§17](#adenda-reconciliacion-colas)); [KPI-V1-05](#kpi-v1-monto-cola) y [§9](#diferencia-colas-tablero) documentan la diferencia con [KPI-20](#kpi-20); ninguna unidad acompaña a un valor faltante ([KPI-03](#kpi-03), [KPI-41](#kpi-41)); el canal se resuelve por catálogo ([§13](#campos-de-registro)). No cambia ninguna fórmula existente |
| v1.3 | 02/11/2026 | ALIGN-021: entradas [KPI-V1-10](#kpi-v1-casos-cola) a [KPI-V1-17](#kpi-v1-contador-motivo) ([§19](#adenda-revision-colas)) para las colas y la pestaña Revisión. Sin renumerar. Casos prioritarios deja de mostrar un ranking único |

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

## 16. Adenda ALIGN-010: colas y dimensiones v1

**Versión del catálogo: v1.1 (adaptador ALIGN-010).** Las entradas históricas de
v1 siguen describiendo `ab4c5b3`. Esta adenda reemplaza la semántica de KPI-09,
KPI-11–13 y de las colas de §9; el tablero y sus órdenes propios siguen sujetos
a ALIGN-014. La implementación se describe en
[reglas v1 §17](reglas-decision-v1.md#17-adaptador-web--align-010) y los campos en
[contrato de dominio §7.12](contrato-dominio-v1.md#712-adaptación-de-reglas-v1--align-010).

| Entrada | Campo / fórmula | Unidad y población | Corte / cobertura | Decisión y límite |
|---|---|---|---|---|
| <a id="kpi-v1-severidad"></a>KPI-V1-01 Severidad | `decision.severidad`; alias `riskScore` y `risk` del objeto | Puntos 0–100, **no % ni probabilidad**, por objeto | Fecha usada `decisionAsOf`; COMPLETA/PARCIAL/NO_DISPONIBLE; parcial es mínimo y conserva motivos | Ordena dentro de la cola; no mide vulnerabilidad ni riesgo social |
| <a id="kpi-v1-prioridad"></a>KPI-V1-02 Prioridad | `decision.prioridad.valor` = severidad; alias `priorityScore`; banda en `priorityLevel` | Puntos 0–100, **no %**, objetos de una misma intervención | Mismo corte/estado que severidad; null al final | Prioridad ↓, monto evaluable ↓, vencimiento más antiguo ↑, id ASCII ↑. Las prioridades de colas distintas no se comparan |
| <a id="kpi-v1-intervencion"></a>KPI-V1-03 Intervención | `decision.intervencion` y etiquetas de `contracts/decision-rules.v1.json`; `recommendationType`/`recommendationReason` | Código, etiqueta e intensidad 0–4 (automático ≤2), **no %**, por objeto | Incluye versión, fecha usada y aviso si no hay corte municipal | Falta de contacto → mejorar datos, intensidad 0; no aumenta severidad; revisión se evalúa con supervisor |
| <a id="kpi-v1-colas"></a>KPI-V1-04 Casos de cola | `buildRecommendationSummary`: con pertenencia conocida, `count = cases.length`, destacados = primeros 3 de `cases` | Cantidad de objetos distintos de esa intervención | Cola vacía conocida = 0; falla de `debtor`/`debt`/`debtor_contact`/`debtor_person` o ningún objeto con decisión en un universo no vacío: colas null, listas vacías. El grupo No disponible conserva los objetos conocidos; con evaluación parcial se cuentan aparte los bloqueados | Elegir casos de la intervención; el orden visual de colas no implica una prioridad global |
| <a id="kpi-v1-monto-cola"></a>KPI-V1-05 Monto de cola | Σ `decision.severidad.monto_actualizado_ars` de los objetos de `cases` | ARS de obligaciones evaluables, vencidas o no; cada objeto una vez | No usa importes persistidos del perfil; conserva faltantes; sin observados → null, cola vacía leída → 0. **No suma el importe de las obligaciones sin vencimiento evaluable**: la suma de colas difiere de [KPI-20](#kpi-20) ([§9](#diferencia-colas-tablero)) | Dimensionar exposición evaluable; un parcial no es el total certificado ni se compara con el total del tablero sin [KPI-V1-08](#kpi-v1-fuera-colas) |
| <a id="kpi-v1-promedio-cola"></a>KPI-V1-06 Severidad media de cola | Media de `decision.severidad.valor` entre casos con valor | Puntos 0–100, **no %**, casos evaluados de la cola | Con faltantes se informa el desglose; cola vacía conocida → NO_APLICA; pertenencia desconocida → null/NO_INTEGRADO, igual que el monto de KPI-V1-05 | Describe esa cola; no predice pago ni compara prioridades entre intervenciones |

Los nombres del DTO anterior se mantienen para compatibilidad de pantallas,
pero el adaptador ya no genera las cuatro recomendaciones heredadas. ALIGN-012
renombra los rótulos y explicita “puntos” en el detalle, `/people`, `/risk-analysis`,
el ingreso y la línea de faltantes; los de `/`, `/debtors`, `/no-contact`,
`/priority-cases` y `/recommended-actions` se traspasan a ALIGN-014. Las
participaciones de objetos en una categoría siguen siendo porcentajes verdaderos. ALIGN-010 inicializa las
categorías del tablero desde el catálogo v1: cola vacía conocida = 0; la misma
condición de pertenencia desconocida de KPI-V1-04 conserva `byRecommendation: []`.
Una decisión R2 permite contar la cola aunque su puntaje sea null. Fallas de
`person`, `debtor_profile` o `debt_status` no afectan esa disponibilidad.
ALIGN-014 debe sustituir el orden
global y las dependencias heredadas de perfiles/estados. Las demás cifras y el orden del tablero
no se confunden con el contrato de `buildRecommendationSummary` de esta adenda.

## 17. <a id="adenda-reconciliacion-colas"></a>Adenda v1.2: lectura del monto de cola

**Versión del catálogo: v1.2.** Estas cifras explican la diferencia entre colas y tablero; no cambian [KPI-V1-05](#kpi-v1-monto-cola) ni [KPI-20](#kpi-20). Las calcula `buildQueueReconciliation` (`front/lib/equitas-view-selectors.ts`) y se muestran en "Qué suma el monto de cada cola" (`front/app/recommended-actions/page.tsx`).

| Entrada | Campo / fórmula | Unidad y población | Corte / cobertura | Decisión y límite |
|---|---|---|---|---|
| <a id="kpi-v1-suma-colas"></a>KPI-V1-07 Suma de las colas | `queueTotal`: Σ [KPI-V1-05](#kpi-v1-monto-cola) de las cinco intervenciones; el grupo "No disponible" no suma | ARS de obligaciones evaluables, vencidas o no; cada objeto una vez | El de KPI-V1-05. Una cola vacía no cuenta como observación: si ninguna cola con objetos tiene monto observado, "No disponible", nunca 0; 0 solo con la cartera vacía o con importes 0 observados. Los faltantes se informan al lado de la cifra. Pertenencia desconocida (falla de `debtor`, `debt`, `debtor_contact` o `debtor_person`, o ningún objeto con decisión): "No disponible" | Comparar colas con el tablero; no es la deuda de la cartera ni deuda exigible |
| <a id="kpi-v1-fuera-colas"></a>KPI-V1-08 Fuera de las colas por vencimiento | `outsideAmount`: Σ de los importes observados y ≥ 0 de las obligaciones con vencimiento no observado o anterior a `fecha_minima_plausible`. `outsideObjects`: objetos con al menos una de esas obligaciones. `outsideObligations`: esas obligaciones, con y sin importe. `outsideWithoutAmount`: las que no tienen importe observado | ARS, objetos y obligaciones, **no %**; todos los objetos leídos, en cualquier cola | Fecha usada `decisionAsOf`. Sin obligaciones así → 0 derivado. Si ninguna tiene importe observado → "No disponible", con el conteo al lado; si algunas no lo tienen, el importe es parcial y se avisa. Pertenencia desconocida: los cuatro valores "No disponible", nunca 0 | Dimensionar cuánta deuda requiere corregir el vencimiento antes de evaluarla. Un objeto contado aquí puede seguir en una cola por sus otras obligaciones; no significa que el objeto esté fuera de gestión ni que no deba nada |
| <a id="kpi-v1-diferencia-colas"></a>KPI-V1-09 Diferencia con el tablero y resto | `difference` = [KPI-20](#kpi-20) − KPI-V1-07. `otherDifference` = `difference` − `outsideAmount`, en centavos | ARS; puede ser negativo. Población: la de sus términos | Si algún término es null → "No disponible", nunca 0. Faltantes del tablero: [KPI-60](#kpi-60), al lado de la cifra. Un resto de 0 solo es válido con todos los términos observados | Saber cuánto de la diferencia se explica por vencimientos. El resto agrupa totales del perfil distintos de la suma de obligaciones, importes negativos y objetos sin decisión; no se desglosa ni indica un error de la cartera por sí mismo |

## 18. Adenda ALIGN-026: carga semántica V1

Solo para lo cargado por `python -m ETL.run_etl --execute` en la base local (ver
[contrato de dominio §14](contrato-dominio-v1.md#14-semántica-de-la-carga-v1-align-026)).
Donde este catálogo dice que el ETL infirió el estado de una obligación al cargar, en esta carga
es el estado de origen con su catálogo, y "vencida" significa pendiente con vencimiento anterior al
corte declarado. El índice heredado (PR08) y el índice individual (PR09) quedan nulos: no se
calculan. Sin vencidas observadas y con estados faltantes, la mora del perfil también queda nula y
se muestra como no disponible; con vencidas observadas, es un subtotal con su desglose de faltantes.
Los datos del original conservan la semántica descrita arriba.

## 19. <a id="reportes-csv"></a>Reportes CSV de servidor (ALIGN-028)

Los Route Handlers de `front/app/api/reports/` generan estos archivos en el servidor, con cliente de sesión y RLS. **Sin datos personales:** ningún reporte lleva nombre, documento, contacto, domicilio, `debtor.description`, texto libre de motivo (`reason_text`) ni identidad de quien decidió o aprobó, para ningún rol. Tampoco lleva crudo un campo que una persona pueda editar: ver [códigos editables](#codigos-editables). Ninguno reemplaza a una pantalla: una cifra de un reporte significa lo mismo que su entrada de este catálogo.

| Reporte | Ruta | Archivo | Roles (permiso en `front/lib/server/dal.ts`) |
|---|---|---|---|
| [Cola de trabajo](#reporte-cola) | `/api/reports/queue` | `equitas-cola-de-trabajo.csv` | `consulta`, `operador`, `supervisor`; `tp_operator` por compatibilidad de solo lectura (`portfolio:read`) |
| [Decisiones](#reporte-decisiones) | `/api/reports/decisions` | `equitas-decisiones.csv` | `consulta`, `operador`, `supervisor` (`decision:read`) |
| [Supervisión](#reporte-supervision) | `/api/reports/supervision` | `equitas-supervision.csv` | `supervisor` (`supervision:read`) |
| [Calidad de datos](#reporte-calidad) | `/api/reports/data-quality` | `equitas-calidad-de-datos.csv` | Igual que la cola (`portfolio:read`) |
| [Accesos](#reporte-accesos) (ALIGN-069) | `/api/reports/access` | `equitas-accesos.csv` | `supervisor` (`audit:read`) |

`importador` e `importador_sistema` no reciben ninguno, porque no leen cartera ([ADR-001][adr]).

### Formato común

- UTF-8 con BOM, separador `;`, fin de línea CRLF y comillas de RFC 4180. Números sin miles, con coma decimal y dos decimales si no son enteros: `1234,50`. Lo generan `serializeCsv` y `formatCsvNumber` (`front/lib/reports/csv.ts`).
- Cada fila lleva `fecha_corte`, `version_reglas`, `filtros`, `generado_en`, `definiciones` y `tipo_fila`, también en un archivo sin filas de detalle: la fila `TOTAL` o `AGREGADO` nunca falta.
- `generado_en` es el único valor tomado del reloj (fecha-hora UTC de la generación). `fecha_corte` sale del dato: el `as_of` del manifiesto en la cartera y `case_review.as_of` en las decisiones. Mientras la lectura de cartera no aporte manifiesto (`RawDebtorDataBundle.batch`), vale `NO_INTEGRADO` ([contrato §5][c51]). Una fila que resume varios cortes declara el intervalo (`2026-09-30/2026-10-15`) y las versiones (`1.0.0|1.1.0`); sin filas, `NO_APLICA`.
- `definiciones` es la ruta de esta sección en el repositorio. No hay un sitio público de documentación; el día que exista, se cambia en `definitionsLink`.
- `filtros` describe lo aplicado: `SIN_FILTROS` o `clave=valor` separados por `|`, en orden alfabético. El texto de búsqueda `q` no se copia y figura `q=TEXTO_OMITIDO`, porque puede ser el nombre de una persona. `type` se copia solo si es una etiqueta del catálogo leído; si no, filtra igual y figura `type=VALOR_NO_CATALOGADO`.
- **Ausencias:** una celda nunca queda vacía ni en 0 por falta de dato. Lleva el estado de presencia (`NO_INTEGRADO`, `NO_INFORMADO_EN_ORIGEN`, `INVALIDO`, `NO_APLICA`) según el [contrato §4][c41].
- **Lectura fallida:** si una tabla no se puede leer, no hay archivo. La respuesta es `503` con `{"error":"LECTURA_FALLIDA","tablas":[…]}`. Un filtro inválido o desconocido responde `400` (`FILTRO_INVALIDO`): un filtro mal escrito no exporta todo ni parece una selección vacía.
- **Sin autorización:** `401`, `403` o `409` con el código de la DAL y sin datos. Un anónimo que llega por el navegador recibe antes el 307 de `front/proxy.ts` a `/login`.

**Inyección de fórmulas (`neutralizeCsvText`).** Los caracteres de control y separadores de línea de un texto se reemplazan por un espacio: una celda es siempre una línea. Si el primer carácter visible es `=`, `+`, `-`, `@`, sus anchos completos o el signo menos `−`, se antepone un apóstrofo. Los blancos, tabulaciones y caracteres invisibles iniciales no protegen, porque una planilla puede recortarlos: `  =1+1` sale `'  =1+1`. **Números negativos:** un valor de tipo número (importes y conteos) sale sin apóstrofo, `-50`, porque el generador solo puede producir `-?dígitos(,dd)?`, que no es una fórmula, y con apóstrofo dejaría de sumarse. Un *texto* que parece un negativo (`-50` como identificador) sí lleva apóstrofo. El apóstrofo queda visible al abrir el archivo: es la marca de que la celda no se evalúa.

**<a id="codigos-editables"></a>Códigos editables.** La base y las acciones de servidor solo exigen el formato `^[A-Z][A-Z0-9_]{0,63}$`, que también cumple un nombre con su documento. Por eso `reason_code`, `decided_intervention`, `suggested_intervention`, `reviewer_role` y `decision` se exportan solo si están en una lista cerrada (`front/lib/reports/report-codes.ts`). Cualquier otro valor sale como `CODIGO_NO_CATALOGADO`, sin copiarlo, y su fila se sigue contando. Se aplica al leer, así que cubre los eventos ya registrados.

| Campo | Lista cerrada |
|---|---|
| Motivos | Once códigos, iguales a la lista **provisional** de ALIGN-021. Esta lista no es el catálogo de motivos ni lo aprueba: solo indica qué cadenas no llevan datos de una persona. Si se aprueba otra, un motivo nuevo sale como `CODIGO_NO_CATALOGADO` hasta agregarlo |
| Intervenciones | Las de `contracts/decision-rules.v1.json` y `contracts/action-costs.v1.json`, que incluye las de intensidad 3 y 4 |
| Roles | Los de `WEB_ROLES` |
| Decisiones | Las cinco de la base |

`rules_version` se exige con su formato numérico; si no lo cumple, `INVALIDO`. Los demás textos de los reportes salen de contratos o de constantes, salvo `tipo` (catálogo `debtor_type`, que no se edita desde la aplicación) y `identificador` (dato de origen).

### <a id="reporte-cola"></a>Cola de trabajo

- **Pantalla equivalente:** `/priority-cases`, con sus mismos filtros (`q`, `risk`, `contact`, `type`, `minAmount`), el mismo orden y sin paginar (`page` y `pageSize` se ignoran).
- **Filas:** una `DETALLE` por objeto y una `TOTAL`.
- **Decisión que apoya:** trabajar una lista priorizada fuera de la aplicación y controlar que coincida con la pantalla.
- **Corte:** `fecha_corte` según el formato común. Si no hay manifiesto, las reglas usan la fecha de cálculo, que se informa aparte en `fecha_calculo_usada`, con el mismo sentido que en la pantalla ([DV03](contrato-dominio-v1.md#712-adaptación-de-reglas-v1--align-010)).
- **No significa:** una instrucción de gestión ni una probabilidad de pago. `posicion` es el orden operativo de la pantalla: las prioridades de colas distintas no se comparan ([KPI-V1-02](#kpi-v1-prioridad)).

| Columna | Significado | Unidad | Definición | Fila `TOTAL` |
|---|---|---|---|---|
| `posicion` | Lugar en el orden de `getPriorityCases` | orden | [KPI-31](#kpi-31) | `NO_APLICA` |
| `objeto_id`, `identificador`, `tipo` | Clave interna, identificador de origen y tipo. Sin identificador o sin tipo, `NO_INFORMADO_EN_ORIGEN`, aunque la pantalla muestre `OBJ-<id>` o «Sin tipo». `Identificador` es texto libre del archivo municipal: solo lo reciben `operador` y `supervisor`; `consulta` y `tp_operator` reciben `OMITIDO_POR_ROL` y ubican el caso por `objeto_id` | texto | [OB01, OB04, OB03][c72] | `NO_APLICA` |
| `intervencion_codigo`, `intervencion`, `intensidad` | Sugerencia de reglas v1 | código, etiqueta, 0–4 | [KPI-V1-03](#kpi-v1-intervencion) | `NO_APLICA` |
| `revision_requerida` | La pantalla pide evaluar con supervisor: `SI`/`NO` | booleano | `isUrgentRecommendation` | `NO_APLICA` |
| `severidad_puntos`, `severidad_banda`, `severidad_estado` | Severidad v1 | puntos 0–100, **no %** | [KPI-V1-01](#kpi-v1-severidad) | `NO_APLICA` |
| `prioridad_puntos` | Prioridad dentro de la cola | puntos 0–100, **no %** | [KPI-V1-02](#kpi-v1-prioridad) | `NO_APLICA` |
| `deuda_total_ars`, `deuda_vencida_ars` | Importes del objeto | ARS | [KPI-01](#kpi-01), [KPI-02](#kpi-02) | Suma de `buildDebtAgingSummary`, igual que `/debt-aging`; sin filas observadas, el estado |
| `monto_evaluable_ars` | Importes evaluables por reglas v1 | ARS | [KPI-V1-05](#kpi-v1-monto-cola) | Suma por objeto |
| `dias_atraso_max` | Mayor atraso | días | [KPI-03](#kpi-03) | `NO_APLICA` |
| `obligaciones` | Obligaciones leídas | obligaciones | [KPI-05](#kpi-05) | Suma |
| `contactos_disponibles`, `con_contacto` | Contactos con valor cargado, **no verificados** | contactos, `SI`/`NO` | [KPI-07](#kpi-07), [KPI-08](#kpi-08) | `NO_APLICA`: una persona con varios objetos se contaría varias veces |
| `banderas` | Banderas v1 separadas por `\|`, o `SIN_BANDERAS` | códigos | [reglas §5][r5] | `NO_APLICA` |
| `fecha_calculo_usada` | Fecha del reloj que usaron las reglas si no hay manifiesto; con manifiesto, `NO_APLICA` | fecha | [DV03](contrato-dominio-v1.md#712-adaptación-de-reglas-v1--align-010) | Igual |
| `objetos` | 1 en cada `DETALLE`; en `TOTAL`, las filas de detalle | objetos | Igual que el contador de `/priority-cases`, [KPI-51](#kpi-51) | Conteo; una selección vacía de un universo leído da 0 derivado |
| `faltantes` | Filas fuera de cada suma: `columna:ESTADO=n` separados por `\|`, o `NINGUNO` | obligaciones | [KPI-60](#kpi-60) | Acumulado |

### <a id="reporte-decisiones"></a>Decisiones

- **Fuente:** `case_review` y `case_review_approval`, con columnas explícitas (`front/lib/server/review-report-reader.ts`). No se piden `reason_text`, `reviewer`, `approver`, `explanation`, `inputs_hash`, `checklist` ni `idempotency_key`.
- **Filtros:** `desde` y `hasta` (día UTC de `created_at`, inclusive), `corte` (`as_of` exacto), `decision` y `vigente` (`si`/`no`).
- **Filas:** una `DETALLE` por evento, también los reemplazados, y una `TOTAL`. En cada `DETALLE`, `fecha_corte` y `version_reglas` son los de esa decisión.
- **Decisión que apoya:** rendir cuentas de lo decidido.
- **Limitación:** todavía no hay una pantalla de decisiones con la cual conciliar. Las cifras se concilian con el reporte de supervisión y con la base.
- **No significa:** una acción ejecutada. Es una decisión registrada ([contrato §13](contrato-dominio-v1.md#13-decisión-humana-aprobación-y-lote-align-018)).

| Columna | Significado | Faltantes |
|---|---|---|
| `decision_id`, `objeto_id` | Claves internas del evento y del objeto | — |
| `fecha` | `created_at`, en UTC | Ilegible: `INVALIDO` |
| `rol` | `reviewer_role`, rol en ese momento. Sin identidad de la persona | Fuera de lista: `CODIGO_NO_CATALOGADO` |
| `decision` | `ACEPTA`, `MODIFICA`, `RECHAZA`, `POSPONE` o `DERIVA` | Fuera de lista: `CODIGO_NO_CATALOGADO` |
| `codigo_motivo` | `reason_code`. Nunca el texto libre | `NO_APLICA` si no hay código (solo `ACEPTA` puede no tenerlo). Fuera de lista: `CODIGO_NO_CATALOGADO` |
| `intervencion_sugerida`, `intensidad_sugerida` | Sugerencia de reglas | Intervención fuera de lista: `CODIGO_NO_CATALOGADO` |
| `intervencion_decidida`, `intensidad_decidida` | Lo decidido | `NO_APLICA`: sin intervención decidida, **nunca intensidad 0**. Intervención fuera de lista: `CODIGO_NO_CATALOGADO`, y la intensidad se conserva |
| `reemplaza_a` | `supersedes`: evento anterior | `NO_APLICA` |
| `vigente` | `SI` si ningún evento lo reemplaza, sobre todo lo leído, antes de filtrar | — |
| `aprobacion` | `NO_REQUERIDA` (intensidad < 3 o sin decidir), `PENDIENTE`, `APRUEBA`, `OBJETA` (aprobación vigente) o `REEMPLAZADA` (intensa, reemplazada sin aprobación) | — |
| `decisiones`, `vigentes` | En `DETALLE`, 1 y 1/0. En `TOTAL`, los conteos de las filas | Sin eventos: 0 derivado |

### <a id="reporte-supervision"></a>Supervisión

- **Formato:** filas `AGREGADO` con `indicador`, `categoria`, `valor`, `numerador`, `denominador`, `unidad` y `estado`. `numerador` y `denominador` valen `NO_APLICA` en los totales simples. Sin objetos ni personas.
- **Filtros:** `desde`, `hasta` y `corte`, iguales a los de decisiones. Con los mismos filtros, sus cifras coinciden con las de ese reporte.
- **Población:** decisiones vigentes del municipio. Un evento reemplazado por otro que quedó fuera del filtro sigue sin ser vigente.
- **Decisión que apoya:** observar si la supervisión ocurre: cuánto se aparta la persona de la sugerencia, con qué motivos y qué sigue pendiente.
- **No significa:** error de la persona ni del sistema, ni evaluación de desempeño. Un porcentaje alto o bajo no prueba por sí solo la calidad de la revisión.

| `indicador` | `categoria` | Fórmula | Unidad |
|---|---|---|---|
| `decisiones_vigentes` | `TOTAL` | Eventos que ningún otro reemplaza | decisiones |
| `eventos_reemplazados` | `TOTAL` | Eventos seleccionados − vigentes | eventos |
| `decisiones_por_tipo` | Cada decisión; las cinco siempre aparecen, y `CODIGO_NO_CATALOGADO` solo si hay alguna | Conteo sobre vigentes | decisiones |
| `porcentaje_discrepancia` | `TOTAL` | 100 · vigentes con `decision` distinta de `ACEPTA` / vigentes, dos decimales. Incluye `POSPONE` y `DERIVA`, porque no aceptan la sugerencia y la base les exige motivo (`case_review_decision_requires_reason`); el desglose permite recalcularlo. Sin vigentes: `NO_APLICA`, **no 0** | % |
| `motivos_decision` | Cada `reason_code` de la lista cerrada, `CODIGO_NO_CATALOGADO` o `SIN_CODIGO` | Conteo sobre vigentes; las categorías suman `decisiones_vigentes` | decisiones |
| `aprobacion_requerida` | `TOTAL` | Vigentes con intensidad decidida ≥ 3 | decisiones |
| `pendientes_aprobacion` | `TOTAL` | De las anteriores, sin aprobación vigente | decisiones |
| `aprobaciones_vigentes` | `APRUEBA`, `OBJETA` | De las anteriores, por aprobación vigente | decisiones |
| `motivos_objecion` | Cada `reason_code` de la lista cerrada de una objeción vigente, `CODIGO_NO_CATALOGADO` o `SIN_CODIGO` | Conteo | decisiones |

### <a id="reporte-accesos"></a>Accesos

- **Formato:** una fila `DETALLE` por registro de `access_audit`, con `registro_id`, `fecha` (UTC), `accion`, `objetivo`, `actor_id` y `rol_actor`, y una fila `TOTAL` con la cantidad en `registros`. `fecha_corte` y `version_reglas` valen `NO_APLICA`: no depende de un corte ni de reglas. Solo identificadores internos y códigos, sin nombres, correos ni documentos.
- **Filtros:** `desde` y `hasta` (día UTC del registro, inclusive), `accion` (lista cerrada) y `actor` (`user.id`).
- **Población:** registros del municipio activo. Bajar este reporte también deja un registro, que aparece en la descarga siguiente: se registra después de armar el archivo.
- **Decisión que apoya:** detectar y explicar accesos indebidos: quién abrió un caso o exportó un reporte, y cuándo.
- **No significa:** todo lo que se leyó. Una lectura directa por la Data API no queda registrada, ni los intentos denegados (contrato §15). HEAD consulta solo metadatos autorizados, sin descargar ni registrar una exportación, en los cinco reportes. Un registro indica que la ficha o el archivo se entregaron, no que alguien los haya mirado.

### <a id="reporte-calidad"></a>Calidad de datos

- **Formato:** filas `AGREGADO`, con las mismas columnas que supervisión. Sin filtros. Solo conteos y códigos: los ids de obligación de `decisionIssues` no se copian.
- **Población:** todos los objetos del municipio leídos para las pantallas.
- **Corte:** `fecha_corte` según el formato común. Los estados de obligación y los importes dependen de la procedencia del [contrato §5.1][c51].
- **Decisión que apoya:** saber qué datos faltan y en cuántos objetos antes de confiar en una cifra.
- **No significa:** errores de la cartera municipal: `NO_INTEGRADO` puede ser un dato que EQUITAS todavía no lee ([KPI-60](#kpi-60)).

| `indicador` | `categoria` | Fórmula | Unidad |
|---|---|---|---|
| `objetos_leidos` | `TOTAL` | Objetos del universo, [AG01][c78] | objetos |
| `presencia_deuda_total`, `presencia_deuda_vencida`, `presencia_contactos`, `presencia_atraso`, `presencia_severidad` | `OBSERVADO`, `OBSERVADO_PARCIAL` y cada estado sin dato | Objetos por estado de su indicador ([KPI-01](#kpi-01), [KPI-02](#kpi-02), [KPI-07](#kpi-07), [KPI-03](#kpi-03), [KPI-V1-01](#kpi-v1-severidad)). `OBSERVADO_PARCIAL`: tiene valor, pero alguna fila quedó fuera. Las categorías suman `objetos_leidos` | objetos |
| `obligaciones_leidas` | `TOTAL` | Σ [KPI-05](#kpi-05) | obligaciones |
| `obligaciones_no_evaluables` | `TOTAL` y `MOTIVO:ESTADO` | Obligaciones que reglas v1 no evalúa, por motivo ([reglas][reglas]). Solo lista motivos presentes | obligaciones |
| `incidencias_decision` | `TOTAL` y `campo:ESTADO:MOTIVO` | Entradas de `decisionIssues` ([DV06](contrato-dominio-v1.md#712-adaptación-de-reglas-v1--align-010)). Solo lista las presentes | incidencias |
| `severidad_estado` | `COMPLETA`, `PARCIAL`, `NO_DISPONIBLE`, `SIN_DECISION` | Objetos por estado de la severidad. `SIN_DECISION`: las reglas no pudieron evaluar. Suman `objetos_leidos` | objetos |
| `banderas` | Cada bandera de reglas v1; todas aparecen | Objetos con esa bandera, sobre los objetos con decisión ([reglas §5][r5]) | objetos |
| `objetos_sin_contacto` | `TOTAL` | Objetos sin contacto activo con valor; igual que `/no-contact`, [KPI-48](#kpi-48) | objetos |

## 20. <a id="adenda-revision-colas"></a>Adenda ALIGN-021: revisión humana y colas

Cifras nuevas de la pestaña "Revisión" (`front/components/review/review-panel.tsx`) y de `/priority-cases` (`front/app/priority-cases/page.tsx`). Las de la pestaña salen de `getCaseReviewSnapshot`: usan el **corte publicado**, no la fecha de cálculo, y, desde ALIGN-014 (§21), comparten selección de corte con cartera y CSV ([KPI-61](#kpi-61)).

| Entrada | Rótulo visible | Campo / fórmula | Unidad y población | Corte / cobertura | Decisión y límite |
|---|---|---|---|---|---|
| <a id="kpi-v1-casos-cola"></a>KPI-V1-10 Casos de cada cola | "<cola> n casos" en la navegación de colas | `group.cases.filter(matchesFilters).length`, por intervención de [`buildRecommendationSummary`](../../front/lib/equitas-view-selectors.ts); el grupo "No disponible" solo aparece con objetos | Objetos (`debtor`) que pasan los filtros de la pantalla, **no %** | Fecha de `decisionAsOf`. La suma coincide con [KPI-51](#kpi-51) cuando la pertenencia es conocida. Pertenencia desconocida → "No disponible", nunca 0 | Elegir por dónde empezar. No compara colas: cada una tiene su propia prioridad. Un caso ya decidido sigue contado |
| <a id="kpi-v1-monto-corte"></a>KPI-V1-11 Monto actualizado al corte | "Monto actualizado al corte" | Factor `monto_actualizado_ars` de la explicación | ARS de obligaciones evaluables, vencidas o no; un objeto | Corte publicado. Faltante → "No disponible" | Hecho previo a la sugerencia. No es la deuda vencida ni deuda exigible |
| <a id="kpi-v1-vencidas-corte"></a>KPI-V1-12 Obligaciones vencidas al corte | "Obligaciones vencidas al corte" | Factor `cantidad_vencidas` | Obligaciones evaluables con importe positivo y vencimiento anterior al corte; un objeto | Corte publicado. Faltante → "No disponible" | Se determina por calendario: no afirma estado de origen, exigibilidad ni falta de pago |
| <a id="kpi-v1-atraso-corte"></a>KPI-V1-13 Atraso máximo al corte | "Atraso máximo al corte" | Factor `dias_atraso_maximo` | Días calendario, un objeto | Corte publicado. Sin vencidas → "No aplica"; faltante → "No disponible", sin unidad | No indica prescripción: eso lo pide verificar la bandera `VERIFICAR_PRESCRIPCION` |
| <a id="kpi-v1-no-evaluables"></a>KPI-V1-14 Obligaciones no evaluables | "Obligaciones no evaluables" | `severidad.obligaciones_no_evaluables` | Obligaciones leídas sin importe o vencimiento evaluable; un objeto | Corte publicado. Faltante → "No disponible" | Con más de cero, la severidad es un mínimo o no está disponible |
| <a id="kpi-v1-severidad-revision"></a>KPI-V1-15 Severidad y puntos por factor | "Severidad del objeto (v1)"; "n de m puntos" | `severidad.valor` y `factores[].puntos` / `maximo` de la explicación | Puntos de 0 a 100, **no %** ni probabilidad; un objeto | Corte publicado. `PARCIAL` → "al menos n". Faltante → "No disponible", sin unidad | Explica la sugerencia. No mide situación social ni capacidad de pago |
| <a id="kpi-v1-intensidad"></a>KPI-V1-16 Intensidad | "Intensidad n"; rótulo de cada acción | `suggestedIntensity`, `decided_intensity` | Escala 0 a 4 de ALIGN-003, sin unidad; un objeto | La sugerida nunca supera 2. Desde 3 requiere aprobación de supervisor | No es una medida de la persona: ordena la acción |
| <a id="kpi-v1-contador-motivo"></a>KPI-V1-17 Contador del detalle | "n de 500 caracteres, contando los espacios" | `[...texto].length` | Puntos de código del texto escrito | Vacío → 0 y se envía `null` | Límite de `reason_text`. No es un dato de dominio |

Campos de registro del historial (no son indicadores): fecha, rol, decisión, motivo, corte, versión de reglas y lista de control de `case_review` y `case_review_approval`. Las fechas de corte se muestran con `formatDate`; los instantes, en hora de Córdoba.

## 21. <a id="analitica-align014"></a>Analítica vigente — ALIGN-014 (noche 5)

Esta sección define el comportamiento vigente del tablero, `/risk-analysis`, `/debt-aging`, `/recommended-actions`, `/no-contact` y sus listados. Reemplaza las fórmulas y rótulos históricos incompatibles de las secciones anteriores; sus anclas se conservan como trazabilidad. Las reglas congeladas v1 y sus umbrales no cambian.

### Población, corte y cobertura

Cada vista muestra la población **antes de paginar**, la fecha del manifiesto cuando existe y, cuando falta, la fecha de cálculo del calendario de Córdoba (`America/Argentina/Cordoba`). El instante de cálculo sigue siendo UTC. Entre las 21:00 y 24:00 de Córdoba no se toma el día siguiente. Un manifiesto presente con fecha inválida bloquea la decisión; no se sustituye por el reloj.

La leyenda distingue el corte de las decisiones del **saldo histórico**, cuyo corte de origen no está integrado y puede provenir de `debtor_profile`. Ningún monto afirma exigibilidad. El cargador común lee todos los eventos de `import_batch` del municipio autorizado, antes y después de la cartera. Usa `selectCurrentCutoff`, también usado por revisión y equivalente a `equitas_current_cutoff`: último evento vigente que afecta la cartera, solo si es PUBLICADO. VALIDADO/CONFIRMADO o FALLIDO con antecedente bloquean el corte; RECIBIDO, descartes y FALLIDO sin antecedente no sustituyen una publicación. Un estado desconocido, una cadena inválida, una página fallida o un cambio de publicación durante la carga bloquean la evaluación y los CSV (503), sin recurrir al reloj. Sin publicación ni indicios de escritura parcial se conserva la fecha de cálculo rotulada y `fecha_corte=NO_INTEGRADO`. Una cartera vacía conserva el corte publicado en pantalla y CSV. No se deduce fecha del perfil. La doble lectura detecta cambios de publicación; no constituye una transacción MVCC entre peticiones HTTP ni detecta escrituras directas de cartera sin un evento de importación. La escritura de revisión mantiene su comprobación transaccional en la base.

`n de N objetos con dato` significa valores observados sobre la población pertinente de cada cifra. Se informa además cuántos valores son parciales; el desglose de `DataPresence` conserva los faltantes de obligaciones. Un mínimo parcial no prueba ausencia de otras vencidas ni una banda máxima. En la media de atraso, N incluye objetos con mora observada y objetos cuyo atraso es desconocido; excluye los objetos completos sin mora, para los cuales el atraso es `NO_APLICA`.

Los parámetros repetidos usan su primer valor, igual que `URLSearchParams.get`; se normalizan antes de filtrar, paginar o construir enlaces. Una lista de valores vacía equivale a ausencia. Los filtros `q`, `risk` (banda de severidad), `type`, `contact`, `minAmount`, `status`, `personId` y `queue` acompañan los enlaces entre las siete vistas, el detalle y el regreso al listado. La página y el tamaño se conservan en su paginación; cambiar de vista reinicia la página. La cola elegida explícitamente se conserva; una cola seleccionada por defecto no restringe una búsqueda nueva. Cuando falta un dato necesario para filtrar se declara cuántos objetos no pueden evaluarse y se muestran coincidencias observadas. Cero coincidencias con objetos no evaluables se presenta como selección incompleta, no como vacío confirmado.

### Definiciones aplicadas

| Cifra o vista | Fórmula y población | Unidad y denominador | Corte y ausencias |
|---|---|---|---|
| Objetos con severidad alta (KPI-19/24/38, AG05) | Objetos de banda ALTA v1, desde 70 inclusive; KPI y tabla comparten selección | objetos; porcentaje sobre todos los objetos seleccionados, incluidos los sin puntaje | Corte v1; perfil histórico fallido no invalida severidad |
| Críticos y deuda crítica (KPI-55/56, compatibilidad) | `criticalCasesToday` cuenta banda ALTA; `criticalDebtTotal` suma el saldo histórico **de esa misma población** | objetos / ARS | Contador al corte v1; saldo histórico sin corte integrado. `riskAboveNinetyCases` se retiene solo por compatibilidad y no alimenta el KPI visible |
| Deuda total (KPI-01/20) | Una suma por objeto de saldo histórico observado, conservando la preferencia previa por perfil | ARS; cobertura de objetos con saldo sobre seleccionados | No se equipara a monto evaluable ni a deuda exigible |
| Casos vencidos (KPI-21) | Objetos con al menos una obligación evaluable, importe positivo y vencimiento estrictamente anterior al corte | objetos, nunca cantidad de obligaciones | Datos parciales: mínimo observado; no usa estado de catálogo ni saldo vencido persistido |
| Deuda vencida y atraso (KPI-40/41/42) | Suma de importes evaluables vencidos; media redondeada del máximo de días por objeto con mora; distribución por máximo | ARS / días calendario / objetos; la media no pondera por obligaciones ni por monto | Corte v1; completo sin vencidas → `NO_APLICA` en atraso; parcial sin vencidas conocidas → no disponible; faltantes en categoría propia |
| Con/sin contacto (KPI-08/22/50) | Objetos con/sin un contacto cargado activo por relación activa; `null` nunca es sin contacto | objetos; proporción sobre todos los seleccionados | Estado leído, sin fecha de verificación integrada; no equivale a contacto verificado ni consentimiento |
| Revisión requerida (KPI-23) | Decisiones que exigen revisión, incluidas R2 sin puntaje | objetos con decisión; cobertura explícita | No se condiciona a tener un puntaje numérico |
| Severidad por banda y por tipo (KPI-28/29) | Objetos en cada categoría observada; sin puntaje en No disponible | objetos; porcentajes sobre suma de categorías, incluido No disponible | Corte v1 para banda; tipo leído sin fecha de origen |
| Intervenciones, montos y medias (KPI-V1-04/05/06) | Cinco colas v1 y objetos sin cola conocida; cada monto suma obligaciones evaluables, vencidas o no; media de severidad observada | objetos / ARS / puntos 0–100; cobertura separada por monto y severidad | No disponible conserva conteo de objetos conocidos y motivos `INVALIDO`; una lectura fallida no crea cinco colas vacías |
| Primeros casos de cada cola (reemplaza KPI-58 global) | Hasta tres por intervención, prioridad descendente → monto evaluable descendente → vencimiento más antiguo → ID por código | puntos 0–100 **solo dentro de esa cola** | Nunca se publica un orden comparativo de prioridad entre intervenciones; `topPriorityDebtors` queda vacío por compatibilidad |
| Mayores saldos y concentración (KPI-25/30/44) | Top 5 o 10 de importes históricos observados; saldo descendente y empate ID por código; concentración top 5 / saldo observado seleccionado | ARS / % del subtotal observado | Nulos fuera del ranking y presentes en cobertura; subtotal parcial rotulado |
| Monto evaluable por intervención (reemplaza KPI-43) | Misma suma por cola de KPI-V1-05 | ARS por intervención | Sustituye el gráfico de saldo por estado persistido; no cambia `byDebtStatus`, conteo de obligaciones de compatibilidad |
| Panel de personas en análisis | Máximo del índice heredado entre perfiles vinculados; población completa de personas leídas, declarada junto al panel | personas / puntos; cobertura de personas | Corte del índice no integrado. Los filtros de objetos no se presentan como filtros de personas |

`withMaturityMetrics` proyecta la mora al calendario v1 sin volver a ejecutar el motor ni mutar el DTO histórico del mapeador. La usan la ficha (resumen, tarjeta de deuda vencida y datos de respaldo de la pestaña Revisión), Casos prioritarios, Sin contacto y `buildDebtAgingSummary`; el CSV de cola toma esas mismas filas analíticas. El CSV de calidad calcula `presencia_deuda_vencida` y `presencia_atraso` sobre esa misma proyección, con estados observados, parciales o no disponibles según los vencimientos y el corte, sin usar el perfil histórico como respaldo. Por eso deuda vencida y atraso coinciden para el mismo objeto y corte, incluso si una carga parcial conservó su estado o perfil anterior. El saldo total sigue siendo histórico y el estado de catálogo se identifica como tal: no decide la mora por calendario. La conciliación de montos en acciones conserva separados saldo histórico, monto evaluable, importes sin vencimiento evaluable y resto de la diferencia.

### Vacío, fallo y precisión

Una selección completa vacía permite conteo y suma cero; la media es `NO_APLICA`. Una lectura fallida devuelve valores no disponibles y aviso, no "No hay objetos/personas/casos", paginación 0–0 ni 404. La ficha usa 404 solo cuando la lectura del objeto concluyó sin encontrarlo. Las vistas conservan los objetos conocidos aun cuando no puede determinarse su cola. Los datos parciales muestran cobertura y faltantes.

Los importes se leen como texto decimal desde PostgREST en `debt` y `debtor_profile`, antes de convertir a `number`; se verifica el valor exacto en centavos. Un importe o suma que exceda el rango seguro o pierda centavos se declara `INVALIDO`, sin redondearlo silenciosamente (incluye el límite heredado LIM-027-01). Las sumas y diferencias monetarias usan enteros `BigInt` en centavos y validan el resultado representable. Esto también protege la exposición asociada de personas. No se modifica el esquema ni el núcleo de reglas.

La proyección de `person` excluye `birth_date`; la de `debtor_profile_detail` excluye `reason`. Se mantienen columnas usadas por los mapeadores, claves escalares, uniones y filtros de alcance existentes. ALIGN-014 no cambia autenticación, permisos ni filtros por municipio/objeto; la corrección de privacidad coordinada pertenece a su dueño separado.

### Comprobación reproducible

`front/tests/integration/analytics-reference.integration.test.ts` contrasta 3.507 objetos sintéticos y sus obligaciones contra consultas SQLite independientes (`front/tests/fixtures/analytics-reference.py`), sin importar selectores ni motor de producción en la referencia. Fija corte y compara seis selecciones, totales, mora, bandas, tipos, distribución de atraso, top 10 y 5 y **todos** los IDs ordenados de cada cola. Se conserva además la regresión de lectura paginada de 3.507 filas.

Las pruebas de `analytics-catalog` cubren el día civil de Córdoba, perfil fallido, población de críticos, `INVALIDO`, mora por calendario, precisión decimal, filtros conservados, fallos frente a vacío y asociaciones de las cuatro etiquetas con sus controles. La evidencia de comandos, SHA, UI local, E06, SMOKE-01, gates y campaña 022 se entrega fuera de git en la carpeta de ALIGN-014/noche-5. La revisión independiente y la decisión de integración corresponden al padre.

La regresión `portfolio-cutoff.integration.test.ts` cubre el caso coordinado de ALIGN-029 (carga VALIDADO→PUBLICADO, corte 2026-09-30), aislamiento municipal, historial de más de 1000 eventos, error tardío, publicación intercalada, estados desconocidos/parciales/fallidos y cartera vacía. No sustituye la campaña 029: el padre repetirá ese flujo sobre la integración identificada por SHA.

## 22. <a id="adenda-noche-7"></a>Adenda noche 7 (10/11/2026): reportes y vocabulario

Esta adenda actualiza [§19](#reportes-csv) sin reescribirla. Código: `front/lib/reports/`, `front/app/api/reports/`, `front/lib/server/report-response.ts`.

**Quién descarga.** Los nombres de rol de §19 son históricos. Hoy: *Casos por grupo de trabajo*, *Calidad de datos* y *Decisiones registradas* los descarga cualquier cuenta activa del municipio (`ADMIN` o `USER`); *Supervisión de decisiones* y *Registro de accesos* requieren `ADMIN`. Un rol histórico guardado en una fila antigua se exporta con el rótulo «(rol anterior)».

**Fecha y versión en cada fila.** Todos los reportes traen `fecha_cartera` y `version_reglas_vigente`, constantes en el archivo e iguales a las de la línea de contexto de la aplicación. La fecha de la cartera es la del último lote publicado; dejó de informarse como `NO_INTEGRADO`.

**Columnas nuevas.** Su definición vigente está en `NEW_COLUMNS` (`front/lib/reports/report-definitions.ts`):

| Columna | Reporte | Significado |
|---|---|---|
| `fecha_cartera`, `version_reglas_vigente` | todos | Fecha de la cartera y versión de reglas vigentes |
| `deuda_pendiente_ars`, `presencia_deuda_pendiente` | cola | Total registrado menos pagadas, y el estado de ese dato |
| `identificador` | decisiones, accesos | Identificador visible del caso; `NO_EN_CARTERA_VIGENTE` si ya no está |
| `decision_rotulo`, `motivo_rotulo`, `accion_sugerida`, `accion_decidida`, `aprobacion_rotulo` | decisiones | Lo mismo que muestra la ficha, en palabras |
| `datos_anteriores` | decisiones | `SI` cuando la decisión se registró con otra fecha de cartera u otras reglas |
| `rol_rotulo`, `rol_actor_rotulo`, `accion_rotulo`, `quien` | decisiones, accesos | Rol y acción en palabras; `quien` es `PROPIO` u `OTRA_PERSONA`, sin nombres |

`deuda_total_ars` conserva su nombre de columna por compatibilidad y contiene el **total registrado**.

**Selección incompleta.** Cuando un filtro deja la selección vacía y hay casos sin el dato necesario para evaluarlo, la descarga responde 422 `SELECCION_INCOMPLETA` con una explicación, en lugar de entregar un archivo con cero filas.

**Coincidencia con el tablero.** La fila `TOTAL` del reporte de cola sin filtros da las mismas cifras de deuda pendiente y deuda vencida que el tablero. Lo comprueba el recorrido en navegador (`front/tests/smoke/n7-local-walkthrough.mjs`).

**Vocabulario.** En pantalla, «severidad», «riesgo» y «prioridad operativa» se muestran con un solo nombre: **puntaje de prioridad**. «Colas» se muestra como **grupos de trabajo**. Los identificadores de indicador (KPI-…) y los nombres de columna no cambiaron.
