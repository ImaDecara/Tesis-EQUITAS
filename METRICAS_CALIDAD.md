# Métricas y evolución verificable — EQUITAS

**Actualización E11, 23/10/2026:** validación técnica integral aprobada sobre `5b62c14`: cuatro jobs obligatorios, 180 pruebas de producto, nuevo Preview/smoke y dos cargas del mismo SHA; acumulado **183**, con **66 controles de infraestructura aparte**. [Manifiesto portable](evidencias/e11/validacion-integral.json), [ficha](REGISTRO_EJECUCION_E11.md), [guion y repaso individual](entrega/GUION_DEMOSTRACION.md). Auditorías completas/productivas actuales **0/0**, sin excepción utilizada; OBS-DEP-001 cerrado por retiro oficial del aviso, conservando la historia. DEF-SUP-001 original sigue abierto. **E11 no está completamente cerrada: falta confirmar preparación individual, ensayo oral y datos del equipo.** Esta nota prevalece sobre estados históricos anteriores.

Versión 1.1 — E11, 23/10/2026. Responsable: Axel Azcune. Requisitos R06, R07–R11 y R24 del [roadmap](ROADMAP_TP_CALIDAD_SOFTWARE.md).

## 1. Corte, fuentes y reglas de interpretación

El corte actual de análisis es `main`, SHA **`2f9e48fe11bf246d6fc73bc0308bda4692d0d866`**, [CI 39964341314](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39964341314), generado el 23/10/2026. Sus cuatro jobs aprobaron, incluida la integración real obligatoria. Los ZIP se descargaron y verificaron contra el SHA-256 de GitHub; [manifiesto](evidencias/e09/artefactos-ci.json), [resumen original](evidencias/e09/ci-summary.json), [gate](evidencias/e09/ci-gate.json), [ejecución](evidencias/e09/ejecucion-ci.json) y [cálculos](evidencias/e09/metricas.json). No se reejecutaron cargas para elaborar este documento.

Alcance de cobertura y duplicación: `front/app`, `front/components`, `front/lib`; `back/ETL`, `back/api`, `back/services`. No incluye toda la infraestructura, tests, migraciones ni `front/proxy.ts`. Frontend: Vitest/V8 4.1.12; backend: coverage.py 7.16.2; duplicación: jscpd 5.4.2. Los numeradores/denominadores prevalecen sobre la presentación redondeada. El gate usa el cociente sin redondear.

La clasificación responde a lo que se mide: **producto**, comportamiento/estructura del software; **proceso**, ejecución y seguimiento del trabajo de calidad; **proyecto**, tamaño del alcance analizado. Las metas de cobertura/duplicación proceden de la consigna y E04; las de carga fueron publicadas antes de ensayar en E08. Esta consolidación E09 no convierte una interpretación posterior en un criterio previo.

## 2. Métricas actuales de producto

Todas las filas de esta tabla corresponden al corte y fecha de la sección 1, salvo donde se indica otra fuente.

| Indicador | Fórmula y valor observado | Criterio / interpretación |
| --- | --- | --- |
| Sentencias frontend | 100 × 794 / 1.283 = **61,8862 %**; Vitest informa **61,88 %**. | ≥60 % existente: cumple. 489 sentencias no cubiertas en ese alcance. |
| Líneas frontend | 100 × 746 / 1.209 = **61,7039 %**; herramienta 61,70 %. | Indicador complementario; no reemplaza sentencias. |
| Funciones frontend | 100 × 200 / 326 = **61,3497 %**; herramienta 61,34 %. | 126 funciones sin cobertura registrada. Sin umbral adicional inventado. |
| Ramas frontend | 100 × 566 / 1.068 = **52,9963 %**; herramienta 52,99 %. | 502 ramas no cubiertas. Aprobar el mínimo de sentencias no las cubre. |
| Sentencias backend | 100 × 1.254 / 1.471 = **85,2481 %**. | ≥60 % existente: cumple; 217 sin cubrir. |
| Ramas backend | 100 × 339 / 498 = **68,0723 %**. | 159 ramas sin cubrir; no es MC/DC ni cobertura exhaustiva de condiciones. |
| Combinada backend | 100 × (1.254 + 339) / (1.471 + 498) = **80,9040 %**; terminal muestra 81 %. | Combina sentencias y salidas de ramas con sus cantidades; no es promedio simple ni 85,25 % de sentencias. |
| Funciones backend | No disponible en el reporte de coverage.py usado. | No medida; no se informa cero ni se inventa denominador. |
| Líneas ejecutables nuevas frontend | 100 × 36 / 36 = **100 %**. | ≥80 %: cumple contra base fija `531996f51243dc3d4c5a607338e2f35e32313f6b`. |
| Líneas ejecutables nuevas backend | 100 × 15 / 17 = **88,2353 %**. | ≥80 %: cumple por módulo. Dos líneas nuevas no cubiertas. |
| Duplicación por líneas | 100 × 427 / 11.159 = **3,8265 %**, presentación **3,83 %**; 36 clones. | ≤5 %: cumple. Es la medida del gate. |
| Duplicación por tokens | 100 × 2.533 / 53.287 = **4,7535 %**. | Otra medida: no usarla como duplicación por líneas. |
| ESLint | Conteo de hallazgos: **0 errores / 0 advertencias**, 81 archivos revisados. | Cumple el criterio estático; no certifica ausencia de fallos funcionales. |
| Ruff | Conteo de hallazgos no aceptados: **0** en alcance productivo. | Mantiene tres excepciones locales TRY004 documentadas en E01. |
| Dependencias frontend | Conteo npm audit E11 completo/productivo: **0/0**, códigos crudos **0/0**. | Aviso retirado oficialmente; OBS-DEP-001 cerrado sin cambio de paquete. Los cinco altos de E01-E10 siguen registrados como historia; excepción no utilizada ni prorrogada. |

[Cobertura frontend original](evidencias/e09/frontend-coverage.json), [auditoría productiva](evidencias/e09/audit-production.json), [decisión de excepción](evidencias/e09/audit-decision.json) y [Ruff](evidencias/e09/ruff.json). Las ramas son salidas instrumentadas por herramientas diferentes; no se suman porcentajes frontend/backend. `branchesTrue` frontend tiene denominador cero y no aporta una medida útil de decisiones: su 100 % convencional no se utiliza.

## 3. Evolución de cobertura con sus cambios de método

| Momento / versión | Frontend sentencias | Backend sentencias / combinada | Lectura válida |
| --- | --- | --- | --- |
| Antecedente recibido | **12,03 % → 60,43 %**. | **26,83 % → 85,26 %** de sentencias. | Evolución informada en el material recibido; no se reprodujo el extremo inicial sobre un checkout antiguo. |
| Diagnóstico 21/10, `531996f…` | 3.372/5.580 = 60,4301 %. Vitest/V8 3.2.4. | 1.255/1.472 = 85,2582 %; combinada 80,9137 %. | Extremo final recibido corroborado independientemente: [snapshot](evidencias/validacion-2026-10-21.json). |
| E01, 21/10; cambios sobre `a96b482…` | 586/1.275 = **45,9608 %**. Vitest/V8 4.1.12. | 1.254/1.471 = 85,2481 %; combinada 80,9040 %. | Mismos 54 archivos frontend, cambio de remapeo AST de V8. Backend cambia una sentencia por corrección estática. [E01](evidencias/e01/resumen-2026-10-21.json). |
| E03, `3bfe156…`, CI 39673351642 | 742/1.280 = **57,9688 %**; herramienta 57,96 %. | 1.254/1.471 = 85,2481 %. | Lector común y nuevas regresiones; 55 archivos. Todavía no cumple 60 %. [E03](REGISTRO_EJECUCION_E03.md). |
| E04, `c95a9ab…`, CI 39677574195 | 791/1.280 = **61,7969 %**; herramienta 61,79 %. | 1.254/1.471 = 85,2481 %. | Mismo denominador/método que E03: +49 sentencias cubiertas, **+3,8281 puntos porcentuales** por ampliación de pruebas. [E04](REGISTRO_EJECUCION_E04.md). |
| E06, `4bb783f…`, CI 39686380481 | 788/1.277 = **61,7071 %**; herramienta 61,70 %. | 1.254/1.471 = 85,2481 %. | Ajuste Auth productivo y prueba real; cambia denominador. |
| E07, `a6497a7…`, CI 39955381596 | 794/1.283 = **61,8862 %**; herramienta 61,88 %. | 1.254/1.471 = 85,2481 %. | Agrega metadata de build y regresión del filtro en navegador. |
| E08 / corte E09, `2f9e48f…`, CI 39964341314 | **794/1.283**, sin cambio. | **1.254/1.471**, sin cambio. | E08 agregó infraestructura de cargas. E09 consolida documentos y evidencia, sin cambiar producto ni tests. |

Fuente histórica: [informe recibido](tp-Calidad.md) y secciones de métricas del [respaldo técnico](INFORME_TP_CALIDAD_SOFTWARE.md). Las diferencias históricas reportadas son +48,40 y +58,43 puntos porcentuales; no se presentan como comparación experimental reproducida. La caída numérica frontend de 60,43 % a 45,96 % **no prueba una regresión de producto**: cambió la instrumentación, sin excluir archivos para mejorar el resultado. La comparación E03→E04 sí conserva denominador y método, y muestra incremento real de cobertura.

## 4. Mejora funcional comparable: lectura completa E03

Mismo dataset sintético **N=3.507**, mismos IDs y aserciones, dos rutas (objetos/personas), dos máximos de respuesta del servidor simulado. Métrica de completitud = 100 × IDs únicos obtenidos / IDs esperados. Ausencias = esperados − obtenidos; duplicados se controlan aparte. No se suman las cuatro variantes como si fueran filas de una cartera mayor.

| Rutas | Máximo servidor | Antes, rojo | Después, verde | Mejora |
| --- | ---: | --- | --- | --- |
| Objetos y personas, cada una | 1.000 | 1.000/3.507 = **28,5144 %**; 2.507 ausentes. | 3.507/3.507 = **100 %**; 0 ausentes/duplicados. | +71,4856 puntos porcentuales por ruta. |
| Objetos y personas, cada una | 3.000 | 3.000/3.507 = **85,5432 %**; 507 ausentes. | 3.507/3.507 = **100 %**; 0 ausentes/duplicados. | +14,4568 puntos porcentuales por ruta. |

[Comparación con números originales](evidencias/e03/comparacion-dat-06.json), [rojo real 39672114249](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39672114249), [verde 39673351642](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39673351642), corrección `3bfe15688a72360b336b7d8732867c6991a1d42e`. El bloque inicial de aserciones no se modificó. La corrección usa cursor `id` hasta agotar respuestas; no reemplaza el límite de 3.000 por otro tope total. También aprobaron agregados y relaciones entre páginas.

Esta es evidencia comparable de DEF-DAT-001 con un servicio simulado. E06 verifica Auth/Data API real con un conjunto pequeño conocido; E07 añade recorrido desplegado. Ninguno prueba lectura de 3.507 filas contra Supabase real ni exactitud de todas las reglas municipales.

## 5. Análisis estático y dependencias antes/después

E01, 21/10: Ruff 0.17.1, mismas **407 reglas habilitadas**. Antes **19** hallazgos; **16 corregidos** y **3 excepciones locales TRY004** justificadas por contrato ValueError. Después **0 no aceptados**; ignorar los `noqa` vuelve a mostrar las tres excepciones. Corrección efectiva = 16/19 = **84,21 %** de hallazgos iniciales; el restante 15,79 % se acepta localmente, no desaparece por una corrección. No se deshabilitó globalmente la regla ni se redujo el alcance. [Antes](evidencias/e01/ruff-antes.json), [después](evidencias/e01/ruff-despues.json), [excepciones](evidencias/e01/ruff-excepciones.json) y [ficha](REGISTRO_EJECUCION_E01.md). El corte actual mantiene cero no aceptados; los imports de infraestructura E08 se corrigieron tras un bloqueo posterior de CI.

El audit completo pasó de **19 paquetes afectados** (4 críticos/12 altos/2 moderados/1 bajo) a **5 altos de desarrollo**, con actualización de dependencias en E01. Reducción descriptiva: (19−5)/19 = **73,68 %**; críticos 4→0. No equivale a eliminar 14 CVE independientes ni a una reducción de riesgo del 73,68 %. La auditoría de producción se informa por separado: filtrar desarrollo no justifica afirmar cero en el audit completo. [Antes](evidencias/e01/npm-audit-antes.json), [después](evidencias/e01/npm-audit-despues.json), [excepción histórica #3, cerrada por retiro en E11](https://github.com/ImaDecara/Tesis-EQUITAS/issues/3).

Duplicación: línea base **474/11.188 = 4,2367 % por líneas**, frente a **2.742/53.179 = 5,1562 % por tokens**. Corte actual **427/11.159 = 3,8265 % por líneas**. La extracción del lector común E03 acompaña la disminución de clones; también cambiaron tamaño y versión jscpd desde la base, por lo que no se atribuye toda variación porcentual a una única intervención aislada.

## 6. Métricas de proceso y proyecto

| Tipo / fecha y versión | Fórmula | Resultado e interpretación |
| --- | --- | --- |
| Proceso, base 21/10 `531996f…` | Aprobadas / ejecutadas = 94/(94+0). | **100 %**; una externa omitida aparte. Inventariadas 95; ejecución 94/95 = **98,95 %**; omisión 1/95 = **1,05 %**. Nunca 95 aprobadas. |
| Proceso, CI actual 23/10 `2f9e48f…` | (107 frontend + 61 backend + 12 externas) / 180 ejecutadas. | **180/180 = 100 %**, cero omitidas/fallidas. El campo `summary.tests` agrupa solo las 168 aisladas; las 12 externas están en `external_integration.tests`. |
| Proceso, corte acumulado E07–E09 | (168 aisladas + 12 externas + 1 smoke + 2 campañas) / 183. | **183/183 = 100 %**, en fuentes distintas. No es una ejecución única ni una medida de completitud de requisitos. |
| Proceso de infraestructura, CI actual | 66 controles aprobados / 66 ejecutados. | **100 %**, aparte del producto: [log original](evidencias/e09/infrastructure-tests.log). |
| Proceso de seguimiento, 23/10 | Tickets cerrados / registrados = 11/12. | **91,67 %**, uno abierto; mezcla campañas, observaciones y defectos. No es tasa de resolución de bugs: [snapshot E11](evidencias/e11/seguimiento.json). |
| Proyecto, base 21/10 `531996f…` | Conteo jscpd del alcance productivo. | **62 archivos / 11.188 líneas**; no tamaño total del repositorio ni horas de trabajo. |
| Proyecto, actual 23/10 `2f9e48f…` | Mismo tipo de conteo del alcance declarado. | **64 archivos / 11.159 líneas**. Diferencia +2 archivos/−29 líneas respecto a la base; no demuestra por sí sola mayor productividad o menor complejidad. |

Una tasa de aprobación alta solo expresa concordancia con los oráculos seleccionados. No mide defectos desconocidos, satisfacción municipal, seguridad total, porcentaje de requisitos cumplidos ni preparación productiva. No se calculan MTBF, disponibilidad anual, velocidad del equipo ni esfuerzo individual porque no hay series temporales/horas observadas que lo permitan.

## 7. Rendimiento: indicador observado y alcance

Fuente E08, 23/10, SHA `f6f83f9…`, [pipeline 39960952025](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39960952025). k6 2.3.0 contra FastAPI real con repositorio sintético local: 3.600 perfiles/objetos y 72.000 deudas representadas por agregados. No se cargaron esas deudas en Supabase ni se midió la web.

| Campaña / fórmula | Valor | Criterio previo y lectura |
| --- | --- | --- |
| Estrés 1/5/10/20/40 usuarios, 60 s por escalón; percentil 95 de latencia funcional por fase | **47,20 / 174,14 / 389,46 / 794,16 / 1.647,00 ms**; 6.408 solicitudes principales. | Hasta 10 usuarios: p95≤2.000 ms y errores≤1 %, agregado y por operación; cero contenido incorrecto. Cumple. Los escalones superiores exploran degradación. |
| Sostenido 10 usuarios, 600 s | **12.160** solicitudes principales; p95 **532,58 ms**; errores **0/12.160 = 0 %**. | Mismos criterios por operación; campaña completa, cumple. |
| Recursos, muestras cada 2 s | RSS servidor máximo observado: **265,89 MiB** estrés / **115,57 MiB** sostenido; CPU cerca de un núcleo ocupado. | No se alcanzó parada de 1.024 MiB. Mediana RSS del primer al último minuto sostenido: **+5,09 MiB**; no prueba ausencia/presencia de fuga. |

Percentil: ordenar n muestras y usar interpolación lineal en índice `(n−1)×p`, excluyendo warmup. Throughput: requests de la fase / duración configurada. Los máximos de recursos son muestreados. Los dos runners tienen modelos de CPU diferentes: no atribuir diferencias de latencia entre campañas a degradación por tiempo. No se alcanzó incumplimiento del SLO hasta 40 usuarios, pero el throughput se estanca entre 20 y 40 y aumenta la latencia; es indicio de saturación, no un límite universal.

[Parámetros previos](PLAN_RENDIMIENTO_E08.md), [resultados y series](evidencias/e08/resultados.json), [análisis completo](REGISTRO_EJECUCION_E08.md) y [repetición](RENDIMIENTO_CALIDAD.md). Son **dos campañas**, no 18.568 pruebas de producto. No hubo optimización del SUT seguida de una comparación de rendimiento antes/después.

## 8. Cómo actualizar para el informe final

Conservar estos snapshots. Si cambia producto, pruebas, dependencias o configuración, ejecutar el workflow correspondiente y agregar un corte nuevo con SHA/fecha/entorno/denominadores. Si solo cambia el documento, verificar el CI de publicación sin atribuirle nuevas cargas o smoke. E10 debe usar este corte y sus fuentes diferenciadas, conservar el antecedente recibido y declarar las limitaciones. La base fija de cobertura nueva no se mueve al último commit.

## Repetición final E11

Misma política/dataset, fuente 5b62c14, pipeline 40032355979. Estrés: 5312 solicitudes principales; p95 a 10 VU 501,80 ms. Sostenido: 15149 solicitudes principales, p95 360,06 ms y 600 s. Cero errores inesperados/diferencias de contenido. A 40 VU exploratorios p95 2216,71 ms supera 2000; primer escalón observado fuera del objetivo, conservado explícitamente. El objetivo obligatorio hasta 10 VU aprobó. No se atribuye la diferencia con E08 a una optimización: el producto no cambió y los runners tienen CPU distintas. [Reportes, fases y recursos](evidencias/e11/resultados-cargas.json). La repetición no aumenta el inventario de 183 pruebas/campañas.
