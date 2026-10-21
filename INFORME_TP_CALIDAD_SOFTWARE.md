# Trabajo Práctico Integrador de Calidad de Software

## Evaluación del primer MVP de EQUITAS

| Dato | Información |
| --- | --- |
| Carrera | Ingeniería en Sistemas |
| Universidad | Universidad Católica de Córdoba |
| Asignatura | Calidad de Software |
| Proyecto | EQUITAS — Recupero municipal |
| Nivel declarado | Nivel 2 — Prototipo parcial |
| Integrantes | Ignacio Magoia, Axel Azcune e Imanol Decara. Legajos pendientes. |
| Docente | **PENDIENTE:** completar. |
| Fecha de presentación | 26 de octubre de 2026 |
| Versión del documento | 1.4 — Defecto de lectura corregido con rojo/verde E03, 21/10/2026 |

> **Nota de integridad académica.** Este informe contiene solamente resultados obtenidos durante las ejecuciones documentadas en el repositorio. Las actividades no realizadas se identifican explícitamente como **PENDIENTE**; no se simulan capturas, métricas ni validaciones externas.

> **Actualización E03, 21/10/2026.** DEF-DAT-001 quedó corregido y validado mediante regresión aislada en ambas rutas y sus relaciones. El [rojo real](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39672114249), commit `f155cfc…`, conservó cuatro pruebas fallidas por truncamiento; el [verde](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39673351642), commit `3bfe156…`, recuperó las 3.507 filas esperadas en los mismos casos, sin omisiones ni duplicados. Se agregaron 42 pruebas: total **136 aprobadas, cero fallidas y una omitida externa**, más 14 de infraestructura aprobadas por separado. Sentencias frontend **742/1.280 = 57,96 %**, todavía menor al mínimo 60 %; ramas 504/1.056 = 47,72 %. Backend conserva 85,25 % de sentencias. Las 28/28 líneas ejecutables nuevas de E03 están cubiertas y la duplicación baja a 427/11.143 = 3,83 %. Se verificaron los seis ZIP del rojo/verde. La [ficha E03](REGISTRO_EJECUCION_E03.md) contiene casos, comparación, metodología, evidencia y límites; prevalece para el estado actual sobre los antecedentes del cuerpo. Siguen pendientes los gates E04, RLS/integración real, despliegue/smoke, cargas y la consolidación final/PDF. No se modificó ni validó la cartera real mediante estas pruebas.

> **Actualización E02, 21/10/2026.** El pipeline base está implementado y [aprobado en GitHub Actions](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39669312471), con Node 22.23.2/npm 11.21.1 y CPython 3.12.14 en Ubuntu 24.04. Conserva 94 pruebas de producto aprobadas y una omitida; otras 14 pruebas de infraestructura aprueban por separado. El [ensayo controlado de fallo](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39669377493) dejó una prueba fallida, bloqueó frontend/resumen y conservó sus reportes. Se descargaron y verificaron seis artefactos ZIP de ambas ejecuciones. La cobertura frontend sigue en 45,96 %; E04 debe cumplir el 60 % y proteger código nuevo. La excepción temporal de dependencias conserva cinco altos de desarrollo y sus salidas crudas. Esto no sustituye el defecto real de E03 ni integración, despliegue, smoke o cargas. Ver [ficha E02](REGISTRO_EJECUCION_E02.md) y [evidencia](evidencias/e02/ejecuciones-2026-10-21.json); prevalecen sobre los estados históricos de CI o Linux pendientes del cuerpo del informe.

> **Actualización E01, 21/10/2026.** Se comprobaron instalaciones nuevas y se fijaron runtimes, dependencias y transitivas. Next 16.4.2 y Vitest/V8 4.1.12 mantienen 94 pruebas aprobadas y una omitida; build/TypeScript y lint aprueban. Ruff: 16 correcciones y tres excepciones locales justificadas. npm audit: cinco altos de desarrollo por una cadena sin parche, cero críticos y cero avisos productivos; la auditoría completa conserva salida 1 y tratamiento temporal. La cobertura frontend vigente es **586/1.275 = 45,96 %**, por el nuevo mapeo AST de V8 y con los mismos 54 archivos: no cumple aún el 60 % y requiere nuevas pruebas antes del cierre de E04. Backend: 85,25 % de sentencias y 68,07 % de ramas. Duplicación: 474/11.182 = 4,24 %. Las cifras anteriores del cuerpo se conservan como históricas; para el estado técnico actual prevalecen [la ficha E01](REGISTRO_EJECUCION_E01.md) y [su evidencia](evidencias/e01/resumen-2026-10-21.json). El informe final y PDF siguen pendientes.

> **Actualización del 21/10/2026.** El cuerpo original conserva la etapa de pruebas y planificación del 16/10. La nueva ejecución local reprodujo las 94 pruebas aprobadas y una omitida. Además, se inspeccionó Supabase real por plugin: 23 tablas, 2.933 objetos, 56.286 deudas y consistencia de los agregados seleccionados. Se reprodujo un defecto de autorización RLS: el rol autenticado sin pertenencia accede a conteos de toda la cartera. También se confirmó que el volumen supera el límite de lectura de la web. Ambos están abiertos en `REGISTRO_DEFECTOS_CALIDAD.md`. El alcance y evidencias actuales están en `REVISION_SUPABASE.md` y `DIAGNOSTICO_CIERRE_CALIDAD.md`; estas actualizaciones prevalecen sobre los estados históricos de «sin defectos confirmados» o «servicio externo no inspeccionado». La prueba Auth del cliente sigue omitida y CI/CD, smoke, cargas y rojo/verde completo siguen pendientes. No se aplicaron cambios a Supabase.

---

## Índice

1. [Resumen ejecutivo](#resumen-ejecutivo)
2. [Introducción y descripción del proyecto](#introduccion)
3. [Arquitectura del MVP](#arquitectura)
4. [Nivel de madurez declarado](#nivel)
5. [Objetivos de calidad y alcance](#objetivos)
6. [Plan de pruebas, estrategia y niveles](#plan-pruebas)
7. [Pruebas unitarias e integración](#pruebas)
8. [Técnicas de pruebas dinámicas](#tecnicas)
9. [Modelo ISO/IEC 25010](#iso-25010)
10. [Análisis estático y métricas](#analisis-estatico)
11. [Cobertura y evolución](#cobertura)
12. [Riesgos y contingencia](#riesgos)
13. [QA, QC, automatización y CI/CD](#qa-qc)
14. [Smoke, estrés y esfuerzo sostenido](#rendimiento)
15. [Defectos y trazabilidad](#defectos)
16. [Herramientas incorporadas](#herramientas)
17. [Análisis crítico y conclusiones](#conclusiones)
18. [Anexos, evidencias y checklist final](#anexos)

> **PENDIENTE PARA PDF:** actualizar la numeración de páginas del índice después de convertir este Markdown al formato definitivo.

---

<a id="resumen-ejecutivo"></a>
## 1. Resumen ejecutivo

EQUITAS es un MVP orientado a apoyar la gestión municipal de deuda mediante la centralización de objetos de deuda, personas asociadas, riesgo, mora y recomendaciones operativas. El presente trabajo aplica prácticas de calidad de software sobre el nivel declarado **Nivel 2 — prototipo parcial**.

La etapa documentada incorporó y ejecutó pruebas automatizadas, análisis estático, métricas de mantenibilidad y una planificación de riesgos. Los resultados principales son los siguientes:

| Indicador | Resultado verificado |
| --- | ---: |
| Pruebas aprobadas | **94** |
| Pruebas fallidas | **0** |
| Pruebas omitidas | **1** |
| Cobertura de sentencias frontend | **60,43 %** |
| Cobertura de sentencias backend | **85,26 %** |
| Hallazgos ESLint | **0** |
| Hallazgos Ruff | **19** |
| Duplicación de código | **4,24 %** |

El objetivo de cobertura de sentencias definido para el Nivel 2, de al menos 60 % por módulo, se alcanzó tanto en frontend como en backend. La integración real con Supabase permanece preparada pero omitida por no disponer de un entorno exclusivo de testing configurado. CI/CD, quality gates, pruebas de rendimiento, smoke testing desplegado y gestión formal de defectos se mantienen como actividades pendientes.

<a id="introduccion"></a>
## 2. Introducción y descripción del proyecto

### 2.1. Contexto y propósito

EQUITAS es el primer MVP de una solución de recupero municipal. Su propósito es transformar información de deuda en una vista operativa que permita priorizar casos, identificar falta de contacto, analizar mora y riesgo, y consultar personas asociadas a cada objeto de deuda.

El sistema recibe datos mediante un proceso ETL basado en archivos TSV. Luego persiste y consulta la información mediante Supabase, mientras que el frontend presenta tableros y listados para usuarios municipales. El alcance de este informe no contempla modificar la lógica de negocio, las tablas, las políticas RLS, Supabase ni Vercel.

### 2.2. Alcance del trabajo de calidad

Se evaluaron componentes del frontend, ETL, servicios, API y contratos de integración simulados. No se realizaron cargas reales, migraciones, conexiones a Supabase de producción ni modificaciones de despliegue.

| Incluido | Excluido de esta etapa |
| --- | --- |
| Pruebas de lógica, mappers, filtros, paginación, riesgo, mora y pantallas. | Cambios de lógica productiva. |
| Pruebas de ETL con datos sintéticos, mocks, idempotencia y reintentos. | Carga ETL real o modificación de datos externos. |
| Integración simulada de Supabase/Auth/RLS y prueba real opcional de solo lectura. | Supabase de producción, service role, migraciones o políticas RLS. |
| Cobertura, lint, Ruff, duplicación y complejidad estática. | CI/CD, quality gates, UAT, performance y seguridad ofensiva. |

<a id="arquitectura"></a>
## 3. Arquitectura del MVP

### 3.1. Componentes y tecnologías

| Capa | Tecnologías verificadas | Responsabilidad principal | Evidencia en el repositorio |
| --- | --- | --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS, Recharts y Lucide. | Vistas operativas, dashboard, filtros y listados. | `front/package.json`, `front/app/`, `front/components/`. |
| Datos y autenticación | `@supabase/ssr` y `@supabase/supabase-js`. | Clientes de navegador/servidor, sesión y acceso a datos. | `front/lib/supabase-browser.ts`, `front/lib/supabase-server.ts`, `front/lib/services/auth-service.ts`. |
| ETL y backend | Python, Pandas, OpenPyXL, FastAPI, Uvicorn y cliente Supabase. | Extracción TSV, transformación, carga y scoring. | `back/requirements.txt`, `back/ETL/`, `back/api/`, `back/services/`. |
| Persistencia | Supabase. | Autenticación, datos y políticas de acceso. | Configuración y servicios del proyecto; esquema/RLS no versionados en este repositorio. |

### 3.2. Flujo arquitectónico

```text
Archivos TSV
    │
    ▼
ETL: extracción → transformación → validación → preparación/carga simulable
    │                                      │
    └──────────────────────────────────────┼────► Supabase
                                           │          │
Frontend Next.js ◄── clientes SSR/browser ┘          │
    │                                                │
    ├── Dashboard y análisis                         │
    ├── Casos, deuda, personas y recomendaciones     │
    └── Auth y contexto usuario–tenant ◄─────────────┘

API FastAPI + servicio de scoring
    └── Servicios de cálculo y agrupación operativa
```

> **Figura 1 — PENDIENTE PARA PDF:** incorporar un diagrama arquitectónico exportado desde una herramienta de diagramación o una captura del esquema validada por el equipo. El diagrama textual anterior no reemplaza esa evidencia visual.

### 3.3. Consideraciones de seguridad

Las pruebas y la documentación preservan el modelo de autenticación existente: cliente browser, cliente SSR y validación de la relación `auth.users → public.user → tenant_user`. No se habilitó acceso `anon`, no se incorporó una `service_role` al frontend y no se modificaron políticas RLS.

<a id="nivel"></a>
## 4. Justificación del Nivel 2 — Prototipo parcial

El proyecto se clasifica como Nivel 2 porque presenta funcionalidades operativas, pruebas automatizadas y métricas reproducibles, pero aún no cuenta con todos los mecanismos de aseguramiento esperables de una solución madura en producción.

| Evidencia de avance | Limitación que impide declarar un nivel superior |
| --- | --- |
| Frontend con dashboard, listados, análisis y autenticación. | No hay validación formal de requisitos con usuarios municipales. |
| ETL, API y servicio de scoring disponibles. | La integración real con Supabase de testing está omitida. |
| 94 pruebas aprobadas, cobertura superior al 60 % y análisis estático. | No existe CI/CD ni quality gates automatizados. |
| Riesgos, ISO/IEC 25010 y plan de pruebas documentados. | No hay smoke, rendimiento, estrés, UAT ni gestión de defectos en Jira ejecutados. |

<a id="objetivos"></a>
## 5. Objetivos de calidad y criterios de evaluación

### 5.1. Objetivos por interesado

| Interesado | Objetivo de calidad |
| --- | --- |
| Usuario municipal | Consultar prioridades, mora, riesgo y contacto con información comprensible y consistente. |
| Equipo de desarrollo | Modificar frontend, ETL y scoring con señales de regresión, cobertura y mantenibilidad. |
| Organización | Proteger datos sensibles, reducir riesgo de cargas incorrectas y conservar evidencia reproducible. |

### 5.2. Criterios vigentes en esta etapa

| Criterio | Resultado |
| --- | --- |
| Cobertura de sentencias >= 60 % en frontend y backend. | Cumplido: 60,43 % y 85,26 %. |
| Sin fallos en las suites ejecutables. | Cumplido: 94 aprobadas, 0 fallidas. |
| Lint del frontend sin hallazgos. | Cumplido: ESLint sin salida de error ni advertencia. |
| Hallazgos de mantenibilidad registrados, sin fixes automáticos. | Cumplido: Ruff y jscpd documentados. |
| Validación real de Supabase aislada. | **PENDIENTE:** prueba preparada, pero omitida por entorno ausente. |

<a id="plan-pruebas"></a>
## 6. Plan de pruebas, estrategia y niveles

El plan vigente se formalizó en E00 y se conserva en [PLAN_PRUEBAS_CALIDAD.md](PLAN_PRUEBAS_CALIDAD.md), con alcance, objetivos, entornos, criterios y riesgos. El [registro de ejecución de E00](REGISTRO_EJECUCION_E00.md) identifica el checkpoint y sus verificaciones. Los resultados históricos y los trabajos posteriores conservan su estado y evidencia propios.

### 6.1. Estrategia general

Las pruebas se diseñaron para aislar dependencias externas mediante mocks, `monkeypatch`, archivos TSV temporales y clientes falsos. Las suites no requieren credenciales reales ni ejecutan operaciones contra producción. Se priorizaron funciones con impacto sobre priorización, riesgo, mora, datos de deuda, autenticación y carga ETL.

### 6.2. Criterios de entrada y salida

| Tipo | Criterio |
| --- | --- |
| Entrada | Dependencias de desarrollo instaladas, configuraciones de Vitest/Pytest disponibles, datos sintéticos o mocks y ausencia de credenciales de producción. |
| Salida de esta etapa | Pruebas ejecutables sin fallos, cobertura >= 60 % por módulo, lint ejecutado, análisis estático documentado y riesgos priorizados. |
| Aceptación técnica mínima | Mantener cobertura, cero fallos en suites ejecutables, ESLint sin hallazgos y revisión del hallazgo Ruff de prioridad media antes de una próxima liberación. |
| Aceptación de producto | **PENDIENTE:** UAT municipal, RLS real, accesibilidad/usabilidad, rendimiento y despliegue controlado. |

### 6.3. Mapa de niveles de prueba

| Nivel | Alcance y evidencia | Estado |
| --- | --- | --- |
| Unidad frontend | Paginación, riesgo, mora, mappers y selectores. | 14 pruebas aprobadas. |
| Presentación aislada | Páginas principales, login, loading y not-found con fachadas de datos simuladas. | 11 pruebas aprobadas. |
| Unidad backend | Extracción, transformación, carga simulada, scoring, API, exportación e inspección TSV. | 53 pruebas aprobadas. |
| Integración simulada | Loader Supabase, Auth/RLS, pipeline ETL, idempotencia y reintentos. | 16 pruebas aprobadas. |
| Integración real | Lectura de solo lectura contra Supabase de testing. | 1 prueba omitida por variables de entorno ausentes. |
| Sistema, E2E, aceptación, smoke y rendimiento | Recorridos completos y validación no funcional. | **PENDIENTE.** |

### 6.4. Siete principios del testing aplicados

| Principio | Aplicación en EQUITAS |
| --- | --- |
| Las pruebas muestran presencia de defectos | Ruff informó 19 hallazgos y jscpd detectó 38 clones; que las pruebas aprueben no prueba ausencia total de defectos. |
| Las pruebas exhaustivas son imposibles | Se priorizaron cálculos, ETL, Auth/RLS simulados y pantallas principales; no se cubren todas las combinaciones ni volúmenes reales. |
| Pruebas tempranas ahorran tiempo y dinero | Los controles se ejecutan antes de cambios externos, con datos temporales y mocks. |
| Agrupamiento de defectos | Complejidad y duplicación orientan la revisión futura a `transform.py`, `load.py`, mappers y pantallas de listado. |
| Paradoja del pesticida | Los datos sintéticos deben renovarse y complementarse con casos anonimizados y fallos nuevos. |
| Las pruebas dependen del contexto | La estrategia prioriza seguridad, fiabilidad e idempotencia por el carácter municipal y sensible de los datos. |
| Ausencia de errores es una falacia | La cobertura alcanzada no garantiza usabilidad, rendimiento, RLS real ni cumplimiento total de requisitos. |

<a id="pruebas"></a>
## 7. Pruebas unitarias e integración

### 7.1. Resultados consolidados

| Suite | Aprobadas | Fallidas | Omitidas | Comando de referencia |
| --- | ---: | ---: | ---: | --- |
| Frontend | 33 | 0 | 1 | `npm run test:coverage` |
| Backend / ETL / API | 61 | 0 | 0 | `python -m pytest --cov ...` |
| **Total** | **94** | **0** | **1** | Ejecución consolidada |

### 7.2. Pruebas unitarias y de presentación

| Área | Archivo de prueba | Aspectos evaluados |
| --- | --- | --- |
| Frontend | `front/tests/unit/pagination.test.ts` | Tamaños de página, límites, páginas inválidas y listados vacíos. |
| Frontend | `front/tests/unit/risk-and-aging.test.ts` | Bandas de riesgo, prioridad, mora, entradas inválidas y valores límite. |
| Frontend | `front/tests/unit/debtor-mapper-and-selectors.test.ts` | Mapeo de objetos, relaciones, contacto y selectores. |
| Frontend | `front/tests/pages/data-pages.test.ts` | Dashboard, deuda, casos, personas, riesgo, recomendaciones y detalle con datos simulados. |
| Frontend | `front/tests/pages/static-pages.test.ts` | Login, estado de carga y recurso inexistente. |
| Backend | `back/tests/test_extract.py`, `back/tests/test_transform.py` | Parseo TSV, normalización, payloads, riesgo y deduplicación. |
| Backend | `back/tests/test_load_unit.py`, `back/tests/test_load_extended.py` | Claves, comparación de payloads, idempotencia y carga bulk simulada. |
| Backend | `back/tests/test_scoring_service.py` | Puntaje, riesgo, agrupación y filtros. |
| Backend | `back/tests/test_api_endpoints.py` | Endpoints FastAPI y validaciones de entrada. |
| Backend | `back/tests/test_export_preview.py`, `back/tests/test_inspect_tsv.py` | Exportación e inspección de archivos. |

### 7.3. Pruebas de integración

| Integración | Evidencia | Resultado |
| --- | --- | --- |
| Lectura frontend + Supabase simulada | `front/tests/integration/raw-debtor-loader.integration.test.ts` | 4 aprobadas: éxito, respuesta vacía, error de conexión y error de permisos. |
| Auth/RLS simulada | `front/tests/integration/auth-service.integration.test.ts` | 4 aprobadas: acceso autorizado, usuario/dato inválido y permisos denegados. |
| ETL extracción → transformación → carga simulada | `back/tests/integration/test_etl_pipeline_integration.py` | 3 aprobadas: flujo, duplicados/idempotencia e inválidos/fallo de carga. |
| Retry del loader | `back/tests/integration/test_supabase_loader_integration.py` | 5 aprobadas: errores transitorios y agotamiento de reintentos. |
| Supabase real de testing | `front/tests/integration/supabase-testing.integration.test.ts` | **Omitida:** faltan URL, publishable key y usuario del proyecto de testing. |

La prueba real opcional es de solo lectura y no usa `service_role`. No se intentó conexión a Supabase de producción durante las ejecuciones registradas.

> **Evidencia E-01 — PENDIENTE PARA PDF:** insertar captura real del resultado de `npm run test:coverage`, donde se visualicen las 33 pruebas aprobadas y la prueba omitida.

> **Evidencia E-02 — PENDIENTE PARA PDF:** insertar captura real de Pytest con las 61 pruebas aprobadas y el resumen de cobertura.

<a id="tecnicas"></a>
## 8. Técnicas de pruebas dinámicas

| Técnica | Aplicación concreta |
| --- | --- |
| Arrange–Act–Assert | Estructura de pruebas unitarias de frontend y backend. |
| Clases de equivalencia | Entradas válidas, inválidas, vacías y con permisos denegados. |
| Valores límite | Paginación, puntajes de riesgo, antigüedad de mora y filtros. |
| Tablas de decisión | Clasificación de riesgo, prioridad y agrupación de casos. |
| Pruebas positivas y negativas | Lecturas exitosas, respuestas vacías, errores de conexión, errores RLS y registros inválidos. |
| Dobles de prueba | Mocks de Supabase, `monkeypatch`, TSV temporales y almacenamientos simulados. |
| Regresión | Ejecución completa de Vitest, Pytest y lint después de ampliar la cobertura. |

Estas técnicas permiten verificar comportamiento de manera aislada. No sustituyen pruebas de aceptación, navegación real de navegador ni comportamiento bajo carga.

<a id="iso-25010"></a>
## 9. Modelo de calidad ISO/IEC 25010

| Característica | Aplicación a EQUITAS | Métrica y criterio | Evidencia disponible | Estado |
| --- | --- | --- | --- | --- |
| Adecuación funcional | Dashboard, listados, filtros, cálculos de riesgo/mora y ETL. | 0 fallos en suites ejecutables y >= 60 % de cobertura por módulo. | 94 aprobadas, 0 fallidas; cobertura objetivo alcanzada. | Parcial: falta validación municipal de requisitos. |
| Eficiencia de desempeño | Consultas del tablero y carga ETL. | Tiempos por volumen representativo; umbral **PENDIENTE**. | No hay pruebas de rendimiento ni carga completa. | **Pendiente.** |
| Compatibilidad | Navegadores, TSV, Supabase y API. | Matriz de plataformas y formatos; criterio **PENDIENTE**. | Integraciones simuladas y TSV sintéticos. | Parcial. |
| Usabilidad | Operación por personal municipal no técnico. | Tareas completadas, observación y encuesta; umbral **PENDIENTE**. | No hay evaluación de usabilidad ni accesibilidad formal. | **Pendiente.** |
| Fiabilidad | Reintentos ETL, validaciones e idempotencia. | Casos simulados de retry/idempotencia aprobados. | Integraciones ETL simuladas aprobadas. | Parcial: falta servicio real y carga sostenida. |
| Seguridad | Auth, RLS y aislamiento usuario–tenant. | Auth/RLS simulados y validación real en entorno aislado. | Mocks aprobados; lectura real de testing omitida. | Parcial. |
| Mantenibilidad | Frontend, ETL, mappers y servicios. | ESLint, Ruff, duplicación, complejidad y cobertura. | ESLint 0; Ruff 19; duplicación 4,24 %; cobertura alcanzada. | Parcial: revisión y refactorización pendientes. |
| Portabilidad | Next.js/Vercel y backend Python. | Build/despliegue repetible y matriz de entornos; criterio **PENDIENTE**. | Dependencias y scripts versionados. | **Pendiente.** |

### 9.1. Características prioritarias del MVP

1. **Seguridad.** El sistema procesa información municipal y de deudores; Auth, RLS y aislamiento por tenant son condiciones necesarias para el uso responsable de los datos.
2. **Adecuación funcional.** La utilidad del MVP depende de que riesgo, mora, priorización y recomendaciones representen correctamente la información disponible.
3. **Fiabilidad.** La carga ETL y el acceso a datos deben tolerar errores transitorios y evitar duplicaciones o estados inconsistentes.

<a id="analisis-estatico"></a>
## 10. Análisis estático y métricas de mantenibilidad

### 10.1. Herramientas y resultados

| Herramienta | Versión | Comando ejecutado | Alcance | Resultado |
| --- | --- | --- | --- | --- |
| ESLint | Configurada con ESLint 9 del proyecto | `npm run lint` | Frontend según `front/eslint.config.mjs`. | 0 hallazgos. |
| Ruff | 0.17.1 | `python -m ruff check ETL api services --output-format concise` | 9 archivos Python de ETL, API y servicios. | 19 hallazgos en 8 archivos. |
| jscpd | 5.4.1 | `npm run quality:duplicates` | 62 archivos productivos frontend y backend. | 38 clones; 4,24 % de líneas duplicadas. |
| jscpd | 5.4.1 | `npm run quality:complexity` | 62 archivos productivos frontend y backend. | Línea base de complejidad estática por archivo y carpeta. |

Ruff se declara en `back/requirements-dev.txt`; jscpd se declara como dependencia de desarrollo y expone scripts en `front/package.json`. Los reportes generados se almacenan en `.quality/`, directorio ignorado por Git por ser reproducible.

### 10.2. Clasificación de hallazgos Ruff

Ruff no asigna severidad de negocio. La siguiente clasificación es un triage interno y no supone que haya defectos funcionales confirmados.

| Severidad de triage | Reglas | Cantidad | Tratamiento propuesto |
| --- | --- | ---: | --- |
| Media | `F841` | 1 | Revisar manualmente `original_debt_amount` sin uso en `back/ETL/transform.py` antes de eliminar o incorporar el dato. |
| Baja | `I001` | 8 | Ordenamiento de imports en ocho archivos. |
| Baja | `F401` | 2 | Imports sin uso en `back/ETL/export_preview.py`; confirmar su innecesariedad. |
| Baja | `TRY004` | 3 | Preferencia de tipo de excepción en `back/ETL/load.py`. |
| Baja | `C401`, `UP017`, `UP035`, `RUF046`, `SIM118` | 5 | Simplificación, modernización o estilo de acceso a colecciones. |
| Alta o crítica | — | 0 | No se detectaron reglas de esta severidad bajo el triage definido. |

De los 19 hallazgos, Ruff informa 13 potencialmente corregibles; tres requieren una modalidad insegura. No se ejecutó `--fix` ni se modificó código productivo por esta actividad.

### 10.3. Duplicación y complejidad

jscpd se ejecutó con umbral de 5 líneas y 50 tokens, sin analizar pruebas ni dependencias. La distribución de la duplicación es la siguiente:

| Formato | Archivos analizados | Clones | Líneas duplicadas |
| --- | ---: | ---: | ---: |
| Python | 9 | 3 | 25 (0,60 %) |
| TSX | 32 | 30 | 375 (8,05 %) |
| TypeScript | 20 | 5 | 74 (3,16 %) |
| CSS | 1 | 0 | 0 (0,00 %) |
| **Total** | **62** | **38** | **474 (4,24 %)** |

El valor `CX` se presenta como línea base comparativa informada por jscpd; no equivale por sí mismo a una certificación independiente de complejidad ciclomática.

| Archivo prioritario | Líneas | CX |
| --- | ---: | ---: |
| `back/ETL/transform.py` | 911 | 119 |
| `front/lib/mappers/debtor-object-mapper.ts` | 563 | 109 |
| `back/services/scoring_service.py` | 574 | 98 |
| `back/ETL/load.py` | 763 | 97 |
| `front/app/debtors/page.tsx` | 454 | 74 |
| `back/ETL/export_preview.py` | 607 | 67 |

### 10.4. Matriz de métricas

| Categoría | Métrica | Línea base / resultado actual | Objetivo o criterio | Interpretación |
| --- | --- | --- | --- | --- |
| Producto | Cobertura de sentencias frontend. | 12,03 % inicial; **60,43 %** actual. | >= 60 %. | Cumplido para Nivel 2. |
| Producto | Cobertura de sentencias backend. | 26,83 % inicial; **85,26 %** actual. | >= 60 %. | Cumplido para Nivel 2. |
| Proceso | Éxito de ejecución = aprobadas / ejecutadas. | **94 / 94 = 100 %**; 1 caso opcional omitido. | 100 % sin fallos en suites ejecutables. | Cumplido en la ejecución registrada. |
| Producto | Hallazgos ESLint. | **0**. | 0 errores o advertencias. | Cumplido. |
| Producto | Hallazgos Ruff. | **19**: 1 medio y 18 bajos según triage. | 0 alta/crítica y revisión del medio antes de liberar. | Línea base registrada; revisión pendiente. |
| Producto | Duplicación = líneas duplicadas / líneas analizadas. | **474 / 11.188 = 4,24 %**. | No superar 5 % y justificar excepciones. | Cumple el objetivo propuesto; concentración principal en TSX. |
| Proyecto | Tamaño analizado. | **62 archivos, 11.188 líneas y 53.179 tokens**. | Medir en cada entrega para observar tendencia. | Línea base del alcance productivo analizado. |
| Producto | Complejidad estática máxima. | `transform.py`, CX **119**. | No aumentar los módulos prioritarios sin revisión. | Línea base; no existe umbral histórico para afirmar cumplimiento. |

Los objetivos de duplicación y complejidad son criterios propuestos para futuras revisiones, no quality gates ya aprobados. No se los presenta como requisitos históricos del proyecto.

<a id="cobertura"></a>
## 11. Cobertura y evolución

### 11.1. Evolución de cobertura de sentencias

| Módulo | Línea base | Resultado final | Variación | Objetivo Nivel 2 |
| --- | ---: | ---: | ---: | --- |
| Frontend | 12,03 % | **60,43 %** | +48,40 puntos porcentuales | Cumplido. |
| Backend / ETL / API | 26,83 % (395/1472) | **85,26 %** (1255/1472) | +58,43 puntos porcentuales | Cumplido. |

```text
Gráfico 1 — Cobertura de sentencias (objetivo: 60 %)

Frontend  12,03 % → 60,43 %  ████████████░░░░░░░░  Cumple
Backend   26,83 % → 85,26 %  █████████████████░░░  Cumple
```

La cobertura final del frontend es 61,86 % de ramas y 54,81 % de funciones. En backend, Coverage.py informa 68,07 % de ramas y 80,91 % de cobertura combinada; para el criterio del TP se utiliza específicamente el valor de **85,26 % de sentencias**.

### 11.2. Interpretación

La ampliación de la cobertura incorporó principalmente pruebas de pantallas con datos simulados en frontend y pruebas de ETL, API, exportación, inspección y scoring en backend. Persisten áreas con menor cobertura, especialmente componentes interactivos, clientes Supabase específicos y ramas de CLI/errores excepcionales. No se excluyó código productivo ni se modificó el denominador para elevar artificialmente los resultados.

> **Evidencia E-03 — PENDIENTE PARA PDF:** insertar captura real de los resúmenes de cobertura de Vitest y Coverage.py. El gráfico textual representa exclusivamente los porcentajes verificados.

<a id="riesgos"></a>
## 12. Riesgos y plan de contingencia

La prioridad se calcula mediante `P × I`: 15–25 crítica, 10–14 alta, 5–9 media y 1–4 baja. Probabilidad e impacto son estimaciones de planificación; no representan incidentes ocurridos.

| ID | Riesgo | P | I | P × I | Prioridad | Prevención | Contingencia |
| --- | --- | ---: | ---: | ---: | --- | --- | --- |
| R-01 | Caída o indisponibilidad de Supabase. | 3 | 5 | 15 | Crítica | Monitorear disponibilidad y mantener reintentos ETL. | Detener cargas, registrar incidente y seguir el protocolo específico. |
| R-02 | Fallo de autenticación o contexto usuario–tenant. | 3 | 5 | 15 | Crítica | Mantener casos Auth/RLS y validar entorno de testing. | Bloquear acceso, mostrar error controlado y revisar sesión/políticas. |
| R-03 | Pérdida o inconsistencia de datos ETL. | 3 | 5 | 15 | Crítica | Validar TSV, claves, deduplicación e idempotencia. | Detener lote, revisar fuente/mapeo y repetir solo con procedimiento aprobado. |
| R-04 | Acceso no autorizado a datos sensibles. | 2 | 5 | 10 | Alta | RLS para autenticados, relación usuario–tenant y sin service role frontend. | Revocar acceso afectado, revisar políticas y registrar incidente. |
| R-05 | Datos incompletos por límite de 3.000 filas. | 4 | 4 | 16 | Crítica | Registrar límite y planificar lectura paginada. | Advertir posible incompletitud y restringir decisiones masivas hasta corregirla. |
| R-06 | Fallo de despliegue o configuración de Vercel. | 2 | 4 | 8 | Media | Validar build y variables en entorno controlado. | Revertir al último despliegue estable. |
| R-07 | Regresión al cambiar frontend, ETL o scoring. | 3 | 4 | 12 | Alta | Ejecutar pruebas, lint y revisar módulos de mayor complejidad. | Revertir el cambio y agregar una prueba de regresión. |

### 12.1. Contingencia ante caída de Supabase

1. **Detectar y registrar:** conservar hora, operación, lote y mensaje de error sin registrar secretos.
2. **Contener:** no reintentar indefinidamente; tras agotar los reintentos del loader, detener la carga para evitar estados inciertos.
3. **Comunicar:** informar a operadores que no deben realizar decisiones masivas con datos posiblemente desactualizados.
4. **Recuperar:** verificar estado del servicio, credenciales y políticas del entorno correspondiente; reanudar únicamente operaciones idempotentes o lotes validados.
5. **Verificar:** revisar conteos, duplicados y alertas del lote reanudado, y registrar causa y resolución.

> El protocolo es un plan de contingencia. No se simuló una caída real de Supabase ni se validaron procedimientos de backup/restauración administrados por el servicio.

<a id="qa-qc"></a>
## 13. QA, QC, automatización y CI/CD

### 13.1. QA y QC

| Disciplina | Actividades aplicadas o planificadas |
| --- | --- |
| QA — aseguramiento preventivo | Plan de pruebas, objetivos de calidad, matriz ISO/IEC 25010, riesgos, criterios de entrada/salida, versiones fijadas de herramientas y trazabilidad. |
| QC — control detectivo | Vitest, Pytest, cobertura, ESLint, Ruff, jscpd, mocks de Supabase, TSV temporales y ejecución de regresión. |

### 13.2. Automatización disponible

| Área | Automatización actual | Estado |
| --- | --- | --- |
| Frontend | Scripts de pruebas, cobertura, lint, duplicación y complejidad. | Ejecutado localmente. |
| Backend | Pytest, pytest-cov y Ruff mediante entorno virtual. | Ejecutado localmente. |
| Integración real Supabase | Prueba opcional de solo lectura condicionada por variables de testing. | Preparada, omitida. |
| CI/CD y quality gates | Pipeline que ejecute y bloquee cambios por criterios de calidad. | **PENDIENTE.** |

### 13.3. Apartado para trabajo conjunto — CI/CD y quality gates

> **PENDIENTE — A COMPLETAR POR EL EQUIPO:** describir el proveedor de CI, archivo de pipeline, eventos disparadores, jobs, cache, variables protegidas, artefactos y condiciones de fallo.

| Elemento | Evidencia requerida | Estado actual |
| --- | --- | --- |
| Pipeline de pruebas | Archivo de configuración y ejecución exitosa. | **Pendiente.** |
| Quality gate | Umbrales de cobertura, lint, Ruff y duplicación. | **Pendiente.** |
| Pipeline fallido | Captura real de una ejecución bloqueada y causa. | **Pendiente.** |
| Pipeline exitoso | Captura real de una ejecución completa exitosa. | **Pendiente.** |

<a id="rendimiento"></a>
## 14. Smoke testing, estrés y esfuerzo sostenido

### 14.1. Smoke testing

No se ejecutó smoke testing sobre un entorno desplegado. Para una siguiente etapa se propone verificar: inicio de sesión con usuario de testing, carga del dashboard, navegación a objetos/personas, aplicación de un filtro y cierre de sesión.

> **PENDIENTE PARA PDF:** incluir evidencia de smoke testing únicamente cuando se ejecute sobre un entorno autorizado y aislado.

### 14.2. Pruebas de estrés y esfuerzo sostenido

No se realizaron pruebas de carga, estrés ni esfuerzo sostenido. Tampoco se establecieron tiempos de respuesta objetivo con usuarios municipales. Se propone definir antes de ejecutarlas:

- volumen de objetos, personas y deudas representativo;
- concurrencia y duración del escenario;
- métricas de tiempo de respuesta, errores y consumo de recursos;
- entorno aislado que no modifique Supabase de producción;
- criterio de aceptación validado por el equipo y la organización.

<a id="defectos"></a>
## 15. Defectos y trazabilidad

### 15.1. Estado de defectos observado

No se confirmaron defectos funcionales a partir de las 94 pruebas aprobadas. Los 19 hallazgos Ruff y los 38 clones de jscpd son hallazgos de mantenibilidad que requieren revisión; no se clasifican automáticamente como defectos funcionales. La advertencia de deprecación de `Starlette TestClient` observada durante Pytest queda registrada como deuda técnica a evaluar, sin modificación de dependencias en esta etapa.

### 15.2. Trazabilidad inicial

| ID | Requisito o funcionalidad | Caso / archivo de prueba | Resultado | Defecto asociado |
| --- | --- | --- | --- | --- |
| FE-U-01 | Paginación válida, límites y lista vacía. | `front/tests/unit/pagination.test.ts` | Aprobado. | Ninguno confirmado. |
| FE-U-02 | Riesgo, prioridad y mora. | `front/tests/unit/risk-and-aging.test.ts` | Aprobado. | Ninguno confirmado. |
| FE-U-03 | Mapper y selectores de objetos de deuda. | `front/tests/unit/debtor-mapper-and-selectors.test.ts` | Aprobado. | Ninguno confirmado. |
| FE-P-01 | Dashboard, filtros y pantallas de datos. | `front/tests/pages/data-pages.test.ts` | Aprobado. | Ninguno confirmado. |
| FE-P-02 | Login, carga y recurso inexistente. | `front/tests/pages/static-pages.test.ts` | Aprobado. | Ninguno confirmado. |
| FE-I-01 | Lectura y errores Supabase simulados. | `front/tests/integration/raw-debtor-loader.integration.test.ts` | Aprobado. | Ninguno confirmado. |
| FE-I-02 | Autorización usuario–tenant simulada. | `front/tests/integration/auth-service.integration.test.ts` | Aprobado. | Ninguno confirmado. |
| FE-I-03 | Lectura real de Supabase testing. | `front/tests/integration/supabase-testing.integration.test.ts` | Omitido. | **Pendiente:** entorno de testing. |
| BE-U-01 | Extracción y transformación TSV. | `back/tests/test_extract.py`, `back/tests/test_transform.py` | Aprobado. | Ninguno confirmado. |
| BE-U-02 | Carga, deduplicación e idempotencia simulada. | `back/tests/test_load_unit.py`, `back/tests/test_load_extended.py` | Aprobado. | Ninguno confirmado. |
| BE-U-03 | Scoring y grupos operativos. | `back/tests/test_scoring_service.py` | Aprobado. | Ninguno confirmado. |
| BE-U-04 | API, exportación e inspección. | `back/tests/test_api_endpoints.py`, `back/tests/test_export_preview.py`, `back/tests/test_inspect_tsv.py` | Aprobado. | Ninguno confirmado. |
| BE-I-01 | Pipeline ETL y reintentos simulados. | `back/tests/integration/` | Aprobado. | Ninguno confirmado. |

### 15.3. Apartado para Jira y registro formal de defectos

> **PENDIENTE — A COMPLETAR POR EL EQUIPO:** incorporar enlace o exportación de Jira cuando exista, junto con identificador, severidad, estado, responsable, evidencia, versión afectada y fecha de cierre de cada defecto.

<a id="herramientas"></a>
## 16. Herramientas incorporadas

| Herramienta | Propósito | Evidencia de incorporación |
| --- | --- | --- |
| Vitest + V8 | Pruebas y cobertura frontend. | `front/vitest.config.ts`, `front/package.json`, `front/tests/`. |
| Pytest + pytest-cov | Pruebas y cobertura backend/ETL/API. | `back/pytest.ini`, `back/.coveragerc`, `back/requirements-dev.txt`, `back/tests/`. |
| Ruff 0.17.1 | Análisis estático Python. | `back/requirements-dev.txt`. |
| jscpd 5.4.1 | Duplicación y complejidad estática. | `front/package.json`, scripts `quality:duplicates` y `quality:complexity`. |
| ESLint | Análisis estático frontend. | `front/eslint.config.mjs`, script `lint`. |

No se incorporaron herramientas de CI/CD, seguridad ofensiva, pruebas E2E ni rendimiento. Estas necesidades se mantienen como pendientes para evitar afirmar evidencia inexistente.

<a id="conclusiones"></a>
## 17. Análisis crítico y conclusiones

La etapa logró establecer una base objetiva de calidad para el MVP. La cobertura de sentencias supera el umbral del Nivel 2 en ambos módulos y la regresión automatizada no reportó fallos. El uso de datos sintéticos y mocks permitió probar lógica e integraciones sin afectar información sensible ni ejecutar cargas reales.

El análisis estático también aportó evidencia útil: ESLint no detectó hallazgos, mientras que Ruff y jscpd identificaron oportunidades concretas de mantenibilidad. La duplicación se concentra en TSX y los mayores valores de complejidad se ubican en transformación ETL, mappers, scoring y listados. Estos resultados no justifican cambios automáticos; orientan el trabajo de refactorización posterior con pruebas de regresión.

Las principales limitaciones permanecen en las validaciones externas: Supabase real de testing, CI/CD, quality gates, usabilidad, rendimiento, smoke testing, estrés, aceptación municipal y gestión formal de defectos. Por ello, el proyecto conserva coherentemente su clasificación de Nivel 2.

La siguiente etapa debería priorizar: (1) habilitar el entorno Supabase de testing para ejecutar la integración real de solo lectura, (2) definir y automatizar quality gates en CI, (3) revisar el hallazgo Ruff de prioridad media y los módulos de mayor complejidad, y (4) acordar escenarios de rendimiento, usabilidad y aceptación con las partes interesadas.

<a id="anexos"></a>
## 18. Anexos, evidencias y checklist final

### Anexo A — Comandos reproducibles

```powershell
# Frontend
Set-Location front
npm run test:coverage
npm run lint
npm run quality:duplicates
npm run quality:complexity

# Backend
Set-Location ..\back
.\.venv\Scripts\python.exe -m pytest --cov --cov-report=term-missing --cov-report=html
.\.venv\Scripts\python.exe -m ruff check ETL api services --output-format concise
```

Ruff finaliza con código distinto de cero mientras existan los 19 hallazgos registrados; este resultado se documenta como línea base y no como una prueba aprobada. Los reportes reproducibles se generan en `front/coverage/`, `back/htmlcov/` y `.quality/`.

### Anexo B — Espacios reservados para evidencia visual

| ID | Evidencia real a incorporar | Ubicación sugerida |
| --- | --- | --- |
| E-01 | Captura del resumen Vitest/V8. | Sección 7.3. |
| E-02 | Captura de Pytest/Coverage.py. | Sección 7.3. |
| E-03 | Captura de ESLint sin hallazgos. | Sección 10.1. |
| E-04 | Captura de Ruff con los 19 hallazgos. | Sección 10.2. |
| E-05 | Captura o exportación de jscpd. | Sección 10.3. |
| E-06 | Gráfico visual de cobertura generado desde los porcentajes verificados. | Sección 11.1. |
| E-07 | Pipeline CI exitoso. | Sección 13.3 — **Pendiente.** |
| E-08 | Pipeline CI fallido y quality gate. | Sección 13.3 — **Pendiente.** |
| E-09 | Ejecución de smoke testing. | Sección 14.1 — **Pendiente.** |
| E-10 | Prueba real de Supabase de testing. | Sección 7.3 — **Pendiente.** |

### Anexo C — Documentos complementarios existentes

- `CALIDAD_SOFTWARE_PRUEBAS.md`: detalle inicial y actualización de pruebas unitarias/cobertura.
- `CALIDAD_SOFTWARE_INTEGRACION.md`: alcance, casos y requisitos de la integración real de Supabase de testing.
- `front/coverage/`, `back/htmlcov/` y `.quality/`: reportes regenerables no versionados.

### Anexo D — Checklist final de cumplimiento del informe

| Requisito del TP / informe | Estado | Verificación |
| --- | --- | --- |
| Portada académica con campos institucionales. | Cumplido. | Portada de este documento. |
| Índice y estructura académica. | Cumplido. | Índice y secciones 1 a 18. |
| Resultados reales de pruebas y cobertura. | Cumplido. | Secciones 7 y 11. |
| Pruebas unitarias, integración y técnicas dinámicas. | Cumplido. | Secciones 7 y 8. |
| Matriz ISO/IEC 25010 y top 3 de calidad. | Cumplido. | Sección 9. |
| Análisis estático, duplicación, complejidad y métricas. | Cumplido. | Sección 10. |
| Riesgos y contingencia de Supabase. | Cumplido. | Sección 12. |
| QA, QC, automatización y espacios CI/CD/quality gates. | Parcial. | Sección 13; CI/CD y gates pendientes. |
| Smoke, estrés y esfuerzo sostenido. | Pendiente. | Sección 14. |
| Defectos, trazabilidad y espacio para Jira. | Parcial. | Sección 15; Jira pendiente. |
| Herramientas nuevas incorporadas. | Cumplido. | Sección 16. |
| Capturas reales y evidencias de pipeline. | Pendiente. | Anexo B. |
| Integración real Supabase de testing. | Pendiente. | Sección 7.3 y `CALIDAD_SOFTWARE_INTEGRACION.md`. |
| Conversión a PDF y revisión final de formato. | Pendiente. | Actualizar índice, capturas y datos institucionales antes de entregar. |
