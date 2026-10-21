# Plan de pruebas y criterios de cierre — EQUITAS

Versión 1.3 — 21/10/2026. Formalización E00 y actualizaciones E01–E03.

## 1. Propósito y referencias de versión

Este plan establece el alcance, criterios, entornos y evidencias para concluir el TP Integrador de Calidad de Software del primer MVP de EQUITAS, declarado **Nivel 2 — prototipo parcial**.

La consigna de referencia es [consigna_pdf.md](consigna_pdf.md). La secuencia de ejecución está en [ROADMAP_TP_CALIDAD_SOFTWARE.md](ROADMAP_TP_CALIDAD_SOFTWARE.md); los requisitos de entrega conservan los IDs R01–R25 de su matriz. La fecha de presentación indicada es el 26/10/2026.

| Referencia | Identificador | Interpretación |
| --- | --- | --- |
| Código de producto validado | `531996f51243dc3d4c5a607338e2f35e32313f6b` | Base de las suites y métricas observadas el 21/10. |
| Checkpoint documental previo a E00 | `d4e61644298b18f790a9effb3b8a38472f988698` | Diagnóstico, evidencias, consigna, informe recibido y roadmap publicados en `main`. |
| Cierre de E00 | Commit que incorpora este plan y el registro de ejecución de E00. | Su SHA se obtiene del historial del archivo; no reemplaza la referencia del producto. |

Las cifras iniciales son antecedentes comprobados. El plan no presenta las actividades futuras como ejecutadas ni mantiene fijo el total de pruebas cuando se agreguen casos.

**Actualización E03:** DEF-DAT-001 corregido en ambas rutas con un lector común por cursor `id`, sin límite total fijo. Se conserva [CI rojo por cuatro fallos reales](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39672114249) y [CI verde tras corregirlos](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39673351642): 136 pruebas de producto aprobadas, cero fallidas y una externa omitida; 14 de infraestructura aprobadas por separado. Los mismos DAT-06 recuperan ahora 3.507 filas completas; límites, negativos y relaciones también aprobaron. Cobertura frontend 742/1.280 = **57,96 %**, aún menor al 60 %; las 28/28 líneas ejecutables nuevas de E03 están cubiertas. Duplicación 427/11.143 = **3,83 %**. E04 y la base fija del TP siguen pendientes de gate; DEF-SUP-001 y OBS-DEP-001 siguen abiertos. Ver [ficha E03](REGISTRO_EJECUCION_E03.md), [aceptación y resultados](CASOS_E03_LECTURA_COMPLETA.md) y [evidencias](evidencias/e03/ejecuciones-2026-10-21.json). Esta actualización prevalece sobre el estado anterior de DEF-DAT-001 y las métricas de E01/E02.

**Actualización E02:** workflow publicado en `5cfcc773a39fdaa7d5859744c430fd6b790c34d7`. [CI normal aprobado](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39669312471) en Linux, con 94 pruebas de producto aprobadas, una omitida y 14 pruebas de infraestructura aprobadas informadas por separado. [Ensayo controlado fallido](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39669377493) comprobó propagación del fallo y retención de artefactos; no cumple por sí mismo el defecto rojo/verde de E03. La instalación Linux, los reportes descargables y la excepción procesable de dependencias quedaron verificados. La cobertura frontend sigue en 45,96 % y E04 permanece pendiente. Ver [ficha E02](REGISTRO_EJECUCION_E02.md). Esta actualización prevalece sobre estados anteriores de CI o Linux pendientes.

**Actualización E01:** instalación nueva comprobada en Windows con Node 22.23.2, npm 11.21.1 y CPython 3.12.14. Next 16.4.2, Vitest/V8 4.1.12 y Vite 7.3.7; requisitos Python directos y transitivos fijados. Ver [reproducción de comandos](REPRODUCIBILIDAD_CALIDAD.md) y [ficha E01](REGISTRO_EJECUCION_E01.md). La ejecución Linux se verificará en E02. Se mantienen 94 aprobadas y 1 omitida. La cobertura frontend vigente es **45,96 %**, por cambio de mapeo V8 y con los mismos 54 archivos; requiere ampliación de pruebas antes de cerrar E04. La meta del 60 % se conserva. La auditoría completa devuelve 1 por cinco altos de desarrollo conocidos, con tratamiento temporal explícito; la productiva devuelve 0. Ninguna de estas observaciones se presenta como una entrega aprobada.

## 2. Responsabilidades y seguimiento

| Responsabilidad | Asignación |
| --- | --- |
| Continuidad técnica, criterios, evidencias y cierre de etapas | **Axel Azcune**, cuenta de repositorio `AxAzc`. |
| Continuidad de los defectos DEF-DAT-001 y DEF-SUP-001 | Axel Azcune. |
| Revisión del informe final y preparación de la defensa | Equipo: Ignacio Magoia, Axel Azcune e Imanol Decara. Las intervenciones se registrarán cuando ocurran. |
| Trabajo recibido | Se conserva como avance inicial; no hay una entrega de otro compañero pendiente de recepción. |

El soporte elegido es **GitHub Issues** en [ImaDecara/Tesis-EQUITAS](https://github.com/ImaDecara/Tesis-EQUITAS/issues), acompañado por el [registro versionado de defectos](REGISTRO_DEFECTOS_CALIDAD.md) y las evidencias del repositorio. Se comprobó que Issues está habilitado y que la cuenta conectada tiene permisos de escritura/triage.

E00 define el soporte. Las altas de tickets, plantillas y enlaces de casos se completarán en E05. **Este plan no afirma que ya existan tickets ni una instancia de Jira.** Cada ticket futuro deberá enlazar su ID de requisito/caso/defecto, commit y ejecución. El registro Markdown conserva la explicación portable y el historial de cambios.

## 3. Alcance del sistema

### Incluido

- Funciones frontend de paginación, parsers, riesgo, mora, mappers y selectores.
- Componentes/páginas existentes, con sus pruebas aisladas y el smoke de despliegue que se incorporará.
- Autenticación y validación `auth.users → public.user → tenant_user`.
- Lectura completa y autorizada de datos y sus relaciones.
- ETL de TSV: extracción, transformación, payloads, deduplicación, idempotencia simulada y reintentos.
- API FastAPI y servicio de scoring existentes, con alcance independiente de la web.
- Integración real Auth/Data API en testing, políticas de lectura y aislamiento de datos.
- Build, análisis estático, cobertura, duplicación, gates, CI, despliegue y evidencias.
- Estrés y esfuerzo sostenido sobre un componente representativo y un entorno aislado declarado.

### Límites del trabajo

- Se evalúa el primer MVP; no se exige implementar todas las funcionalidades futuras de la tesis.
- No hay evidencia de consumo de FastAPI desde el frontend. Las pruebas del scoring no se describirán como pruebas del dashboard completo.
- El alcance de cobertura vigente es `front/app`, `front/components`, `front/lib`, `back/ETL`, `back/api`, `back/services`. Cualquier ampliación se registrará con su nuevo denominador; por ejemplo, `front/proxy.ts` no forma parte de la base frontend medida.
- La investigación administrativa por plugin y las pruebas SQL por rol no sustituyen el login HTTP/SSR de un usuario real.
- La verificación local de respuestas HTTP no sustituye el smoke posterior a un despliegue nuevo.
- La evidencia sobre una consulta o un dataset no demuestra la exactitud de toda la cartera municipal ni todas las reglas de negocio.
- No se declararán UAT municipal, auditoría de seguridad completa, restauración de backups o ausencia de fugas de memoria sin ensayos específicos.

## 4. Objetivos de calidad y criterios medibles

Los criterios de pruebas futuras se fijan antes de su ejecución. Los tiempos/cargas concretos de rendimiento se aprobarán en el diseño de E08 y se identificarán como objetivos del ensayo, no como acuerdos municipales existentes.

| Interesado | Objetivo | Medida y aceptación | Evidencia prevista |
| --- | --- | --- | --- |
| Usuario municipal | Datos completos para consultas y agregados. | Cero filas omitidas/duplicadas en un dataset autorizado conocido, incluyendo más de 3.000 filas. | Casos de DEF-DAT-001 y comparación de agregados. |
| Usuario municipal | Acceso limitado a su organización. | Usuario sin pertenencia o de otra organización ve cero filas de negocio ajenas; usuario válido conserva sus filas conocidas. | Casos SQL y HTTP de testing, diferenciados. |
| Usuario municipal | Recorrido básico disponible después de desplegar. | Login, pantalla principal, navegación/interacción y logout del smoke aprobados. | Reporte post-deploy con URL/SHA. |
| Equipo | Cambios con regresión detectada. | Cero fallos en suites obligatorias; una regresión por cada defecto declarado corregido. | CI y trazabilidad. |
| Equipo | Cobertura existente y nueva protegidas. | Sentencias existentes >= 60 % por módulo; líneas ejecutables nuevas/cambiadas >= 80 % con base registrada. | Reportes y gates E04. |
| Equipo | Hallazgos tratados y gates efectivos. | Cero bugs críticos abiertos según clasificador documentado; duplicación por líneas <= 5 %; criterios estáticos cumplidos. | Análisis, triage y salida de gate. |
| Organización | Evitar inconsistencias de importación. | Sin claves duplicadas/huérfanas en los controles seleccionados; repetición de carga de testing sin duplicación según contrato. | Fixtures y casos ETL; verificación real solo en el alcance ejecutado. |
| Organización | Recuperación controlada ante dependencia caída. | Error identificable, reintentos acotados y parada/recuperación verificables según caso. | Pruebas negativas, logs de ensayo y contingencia documentada. |
| Organización | Entrega reproducible y entendible. | Comandos, versión y reportes disponibles; PDF coherente con la ejecución final. | Reproducción E11 y revisión del PDF. |

Los avisos Ruff, las vulnerabilidades de dependencias y los bugs de negocio se registran como conjuntos diferentes. El resultado de un linter no demuestra ausencia total de errores funcionales o problemas de seguridad.

## 5. Entornos y datos

| Entorno | Estado al formalizar E00 | Uso permitido por este plan |
| --- | --- | --- |
| Local aislado | Dependencias y suites utilizadas durante la validación del 21/10. | Unitarias, componentes, mocks, TSV temporales y build. |
| GitHub Actions | Pipeline todavía pendiente. | CI y generación de reportes desde E02. |
| Supabase conectado | Proyecto `folyslqzqvnpolexcxjo`, cartera real observada. | Fuente de la inspección de lectura ya documentada; no es automáticamente el entorno de cargas/testing. |
| Supabase de testing | No identificado/provisionado como parte de E00. | Preparación E06: esquema, fixtures sintéticas, cuentas y dos tenants de prueba. |
| Preview/despliegue de prueba | Pendiente de configurar/verificar. | Smoke E07 asociado a una versión nueva y datos de testing. |
| Rendimiento aislado | Componente/hardware/runner pendientes de definir en E08. | Escenarios de estrés y sostenido con límites y configuración previa. |

Datos para las pruebas aisladas: fixtures sintéticas, archivos temporales y respuestas controladas. Datos para integración: filas conocidas y etiquetadas en testing. No se utilizarán cuentas o escrituras de la cartera real para fabricar una demostración.

Las variables externas se documentan por nombre. La prueba Auth existente requiere `SUPABASE_TEST_ENABLED`, `SUPABASE_TEST_URL`, `SUPABASE_TEST_PUBLISHABLE_KEY`, `SUPABASE_TEST_EMAIL` y `SUPABASE_TEST_PASSWORD`. Los valores se configuran fuera de Git. La ejecución final obligatoria de integración debe fallar por configuración ausente en lugar de aprobar mediante una omisión.

## 6. Niveles de prueba y línea base

| Nivel | Ejemplo de alcance | Línea base / situación |
| --- | --- | --- |
| Unidad frontend | Paginación, riesgo/mora, mapper/selectores. | 14 casos aprobados. |
| Presentación aislada frontend | Páginas con fachada de datos simulada; login/loading/not-found. | 11 casos aprobados; no son recorridos de navegador autenticado. |
| Integración simulada frontend | Loader y relación usuario–tenant. | 8 casos aprobados. |
| Integración real frontend | Login y lectura real de Supabase testing. | 1 omitida, pendiente de E06. |
| Unidad/componentes/API backend | Extract, transform, load simulado, scoring, API y utilidades. | 53 casos aprobados; el grupo incluye distintos alcances, no solo funciones puras. |
| Integración simulada backend | Pipeline ETL, idempotencia y reintentos. | 8 casos aprobados. |
| Investigación de base real | Metadatos, agregados y roles SQL. | Evidencia separada; no aumenta el total de 94 pruebas. |
| Sistema/smoke | Recorrido básico de despliegue. | Pendiente. |
| No funcional | Estrés y sostenido. | Pendientes. |

Las futuras cantidades reflejarán los casos realmente implementados. Las 94 aprobadas y una omitida describen el estado base, no un objetivo de cantidad que deba conservarse.

## 7. Diseño de casos, técnicas y trazabilidad

Cada caso tendrá ID, requisito, nivel/técnica, precondiciones, entrada, pasos, esperado, obtenido, versión/entorno y evidencia. El resultado esperado se registra antes de ejecutar.

| Técnica | Aplicación concreta | Estado |
| --- | --- | --- |
| AAA | Datos/fixtures, llamada bajo prueba y aserciones sobre salida conocida. | Aplicada en suites existentes; mantener al ampliar. |
| Clases de equivalencia | Datos válidos, vacíos, inválidos; acceso autorizado/denegado. | Casos existentes y ampliación prevista. |
| Valores límite | Riesgo 39/40 y 69/70, lista vacía, página exacta/parcial, más de 3.000 filas. | Riesgo/paginación base probados; completitud ampliada pendiente. |
| Tabla de decisión | Contexto Auth, usuario de aplicación y pertenencia activa. | Criterios siguientes fijados; asignar pruebas/evidencias en E05/E06. |
| Regresión | Repetir el caso que detectó cada defecto después de corregir. | Pendiente para los dos defectos abiertos. |
| Sentencias/decisiones | Cobertura de sentencias y ramas reportadas por herramientas. | Base medida; no se afirma MC/DC ni exhaustividad de condiciones. |

Tabla de decisión de aceptación para acceso a datos de negocio:

| Sesión válida | Usuario de aplicación vinculado | Pertenencia activa al tenant solicitado | Esperado |
| --- | --- | --- | --- |
| No | No aplica. | No aplica. | Acceso protegido denegado. |
| Sí | No | No aplica. | Acceso de negocio denegado. |
| Sí | Sí | No | Acceso de negocio denegado. |
| Sí | Sí | Sí | Acceso solo a las filas autorizadas y contexto esperado. |

Esta tabla define criterios; no declara que todas sus combinaciones ya se hayan validado en el servicio real.

Trazabilidad inicial: R-DAT-01 → SUP-DATA-01/casos DAT → DEF-DAT-001; R-SEG-01 → SUP-RLS-02 → DEF-SUP-001. Se agregarán commits, ejecuciones rojas/verdes y regresiones al implementar. El soporte y los detalles permanecen vinculados al registro de defectos.

## 8. Criterios de entrada y salida

### Entrada a una ejecución técnica

- Versión de código y configuración identificadas; dependencias preparadas según el mecanismo documentado.
- Caso, esperado, entorno y dataset conocidos; pruebas aisladas sin dependencia inadvertida de producción.
- Para pruebas externas: URL aislada y cuentas/secretos configurados; permisos y alcance de datos definidos.
- Para cargas: componente, concurrencia, duración, calentamiento, umbrales y parada fijados previamente.
- Capacidad de generar y conservar reportes con el resultado obtenido, incluido un fallo.

### Salida de una etapa

- Tareas y verificaciones de la etapa satisfechas con evidencia.
- Defectos y métricas actualizados, sin convertir una omisión en aprobación.
- Ficha de ejecución completada con límites y siguiente etapa habilitada.
- Los archivos y enlaces necesarios pertenecen a la versión declarada.

### Salida integral del TP

- Todos los requisitos R01–R25 revisados y respaldados; obligaciones técnicas ejecutadas y automatizadas en el alcance exigido.
- Suites obligatorias, build y gates aprobados; evidencia roja por un problema real y verde posterior.
- Integración de aplicación real, despliegue nuevo con smoke y ambos tipos de carga con reportes de pipeline.
- Registro de defectos/casos, herramienta de cinco pasos y métricas interpretadas.
- PDF y demostración coherentes con la versión final, con limitaciones y metas no alcanzadas explícitas.

La salida de E00 solo formaliza este plan y el checkpoint. No exige ni declara ejecutados los trabajos de E01–E11.

## 9. Riesgos priorizados y contingencias

Escala P/I de 1 a 5, estimada para planificación. Prioridad P × I: crítica 15–25, alta 10–14, media 5–9 y baja 1–4. La prioridad de riesgo no es una severidad asignada automáticamente a una regla de análisis.

| ID | Riesgo | P | I | P × I | Prevención / pruebas | Contingencia |
| --- | --- | ---: | ---: | ---: | --- | --- |
| R-01 | Indisponibilidad de Supabase. | 3 | 5 | 15, crítica. | Reintentos acotados y casos de error. | Detener operación incierta, registrar y verificar recuperación. |
| R-02 | Contexto Auth/tenant incorrecto. | 3 | 5 | 15, crítica. | Casos positivos/negativos, sesión y pertenencia. | Denegar acceso, revisar contexto y repetir en testing. |
| R-03 | Inconsistencia o duplicación en carga ETL. | 3 | 5 | 15, crítica. | Fixtures, claves únicas, idempotencia y conteos. | Parar lote, revisar entradas y reanudar solo operaciones verificadas. |
| R-04 | Lectura de datos sin pertenencia adecuada. | 2 | 5 | 10, alta. | Tratar DEF-SUP-001 y probar roles/tenants. | Contener el acceso afectado mediante cambio validado y verificar alcance. |
| R-05 | Cartera incompleta por truncamiento. | 4 | 4 | 16, crítica. | Tratar DEF-DAT-001, paginación y agregados de totalidad. | Advertir incompletitud; evitar decisiones basadas en totales no verificados. |
| R-06 | Despliegue o variables incorrectas. | 2 | 4 | 8, media. | Build/gates, URL/SHA y smoke post-deploy. | Recuperar despliegue estable y corregir configuración. |
| R-07 | Regresión al cambiar módulos o dependencias. | 3 | 4 | 12, alta. | Suites, revisión y cobertura del cambio. | Revertir el cambio afectado y conservar caso de regresión. |

Las puntuaciones son estimaciones del equipo. Los defectos observados y su impacto se registran aparte; estas cifras no representan frecuencia histórica medida ni incidentes de explotación confirmados.

### Protocolo ante caída de Supabase

1. Detectar y registrar hora, operación, lote/contexto y error sin credenciales.
2. Contener: agotar solo los reintentos definidos y detener cargas cuyo estado sea incierto.
3. Informar el estado operativo y la posible desactualización de datos a quienes intervengan.
4. Recuperar: verificar disponibilidad y configuración; revisar el estado del lote antes de reanudar.
5. Verificar: repetir controles de conteos, claves/duplicados y la operación afectada; registrar resolución.

El protocolo es planificación. Las pruebas de error/reintento y cualquier simulación real se identificarán por separado. No se afirma que se ensayó backup/restauración del servicio.

## 10. QA, QC y modelo de calidad

QA: plan, criterios previos, revisión, gestión de riesgos, configuración reproducible y trazabilidad. QC: ejecución de pruebas, análisis, cobertura, gates y comprobación de defectos. Las actividades se registrarán con sus resultados al realizarlas.

El modelo solicitado comprende adecuación funcional, eficiencia de desempeño, compatibilidad, usabilidad, fiabilidad, seguridad, mantenibilidad y portabilidad. La matriz detallada del informe técnico se consolidará en E09 y E10 con objetivo, criterio, evidencia y estado para cada característica.

Top 3 del MVP: **adecuación funcional** por cálculos y completitud de la cartera; **seguridad** por autorización y datos municipales; **fiabilidad** por consistencia, reintentos y carga. El informe no debe convertir la existencia de una prueba en aprobación de toda la característica.

Los siete principios se aplicarán con casos reales: las pruebas detectan presencia de defectos; la exhaustividad es imposible; se prueba temprano; el riesgo se concentra en ciertos módulos; se renuevan casos; la estrategia depende del contexto; pasar pruebas no garantiza satisfacer todas las necesidades del usuario.

## 11. Comandos, reportes y cambios posteriores

La tabla de comandos del roadmap es la referencia operativa. Son ejecutables actualmente las suites locales, cobertura, build, ESLint, Ruff, duplicación y complejidad. El gate, la integración externa obligatoria, smoke y cargas requieren implementación en sus etapas; no se inventa un comando que todavía no existe.

Los reportes actuales locales están en directorios regenerables ignorados por Git. Los resúmenes de `evidencias/` conservan fecha, alcance y medidas históricas. El pipeline deberá generar sus propios reportes y publicarlos con el SHA de la ejecución; copiar los resultados locales antiguos no cumple ese requisito.

Cada evidencia futura tendrá etapa/caso, fecha, SHA, entorno, herramientas, comando/workflow, esperado/obtenido y enlace al reporte. No se sobrescribirán snapshots históricos para hacerlos coincidir con cifras posteriores.

Este plan se actualiza al cambiar alcance, entorno, criterios, responsables o comandos. Las modificaciones deben conservar la distinción entre línea base, objetivo y resultado real, y reflejarse en roadmap, registro de defectos e informe final cuando corresponda.
