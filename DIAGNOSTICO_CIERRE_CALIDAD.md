# EQUITAS — Diagnóstico y plan de cierre del TP de Calidad de Software

**Actualización E09, 23/10/2026:** documentación transversal completada, **31/31 controles**. [Métricas con fórmulas/evolución](METRICAS_CALIDAD.md), [matriz ISO de ocho características](MATRIZ_ISO25010_CALIDAD.md), [plan vigente 2.0](PLAN_PRUEBAS_CALIDAD.md), [niveles/QA-QC/principios/técnicas](PROCESO_Y_TECNICAS_CALIDAD.md), [ficha E09](REGISTRO_EJECUCION_E09.md) y [validación](evidencias/e09/validacion-registros.json). Último corte de análisis: main 2f9e48f…, CI 39964341314 aprobado, 180 de producto y 66 controles separados; el corte acumulado conserva 183 con smoke/cargas de sus fuentes. DEF-SUP-001 original y OBS-DEP-001 siguen abiertos; excepción dev vence 26/10/2026. **Sigue E10, informe/PDF; E11, demostración.** Las notas E00–E08 son históricas y esta actualización prevalece para el estado actual.

**Actualización E08, 23/10/2026:** estrés progresivo y sostenido completados en [pipeline](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39960952025), SHA `f6f83f9a3172fc2e42912305a181057130d9577b`, después del [CI del mismo commit](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39960952039). Se midió la API FastAPI con lógica productiva y conector sintético local: 3.600 perfiles/objetos y 72.000 deudas representadas. Ambas campañas aprobaron sus criterios previos; E08 tiene 24/24 controles. Corte acumulado: **168 aisladas + 12 externas + un smoke + dos cargas = 183 pruebas/campañas de producto**, con **66 controles de infraestructura aparte**, cero fallidas/omitidas en ese corte. Los requests no se cuentan como tests. [Ficha E08](REGISTRO_EJECUCION_E08.md), [comandos/alcance](RENDIMIENTO_CALIDAD.md), [resultados](evidencias/e08/resultados.json), [CAS-PERF #12](https://github.com/ImaDecara/Tesis-EQUITAS/issues/12). La capacidad de Vercel/Supabase/web no fue ensayada por estas cargas. E09 tiene la herramienta documentada y conserva sus demás pendientes; siguen abiertos DEF-SUP-001 original y OBS-DEP-001. Esta nota prevalece sobre estados históricos de cargas pendientes.

**Actualización E07, 23/10/2026:** etapa cerrada en Preview de `quality/tp-testing`, SHA `a6497a73b226f9d27abb4e9080d5540503d95539`. [CI](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39955381596) aprobado y [smoke automático](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39955572523) aprobado sobre el mismo commit y Supabase testing: **168 pruebas aisladas + 12 HTTP reales + 1 recorrido de navegador = 181 de producto**, cero fallidas/omitidas; **55 controles de infraestructura aparte**. El recorrido contiene cinco comprobaciones y valida realmente `/people`, su título y el listado operativo. [Ficha y límites](REGISTRO_EJECUCION_E07.md), [deployment](evidencias/e07/deployment.json), [reporte](evidencias/e07/smoke.json) y [CAS-SMOKE #10](https://github.com/ImaDecara/Tesis-EQUITAS/issues/10). E00–E07 completadas en sus alcances; sigue E08. DEF-SUP-001 permanece abierto en el original y OBS-DEP-001 conserva su vencimiento 26/10/2026. Esta actualización prevalece sobre los estados históricos de despliegue pendiente.

**Actualización E06, 21/10/2026:** Supabase aislado **EQUITAS-TP-TESTING**, `iylwghgvtydpmwidojdo`, creado en Ignacio Magoia con cotización USD 0 mensuales. Auth/Data API reales y funciones productivas verificadas en [CI main](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39686380481), SHA `4bb783f1a34c25e9003ee6ece66825668b1c1106`: **163 pruebas aisladas + 12 reales = 175 de producto aprobadas, cero fallidas/omitidas**, y **48 controles de infraestructura** aparte. Se conserva rojo/verde HTTP de SUP-RLS-02. **DEF-SUP-001 corregido en testing; sigue abierto para el proyecto original**, que mantiene sus políticas permisivas. CAS-EXT #9 cerrado; nueve issues, siete cerrados y dos abiertos (#1 y #3). [Ficha E06](REGISTRO_EJECUCION_E06.md), [preparación/comandos](SUPABASE_TESTING_CALIDAD.md) y [evidencias](evidencias/e06/resumen-ci.json). Frontend 788/1.277 sentencias (61,7071 %; Vitest informa 61,70 %); backend 1.254/1.471 (85,25 %); nuevo frontend 30/30 y backend 15/17 contra base fija `531996f…`; duplicación 427/11.141 (3,83 %). No cambiaron los filtros de cobertura. E07 es la siguiente etapa; despliegue/smoke, cargas y cierre académico permanecen pendientes. Esta actualización prevalece sobre los estados históricos de integración omitida o pendiente.

Fecha de revisión: **21 de octubre de 2026**. Presentación: **26 de octubre de 2026**.

**Actualización E05, 21/10/2026:** gestión formalizada en **GitHub Issues**, con nueve tickets reales asignados a `AxAzc`: seis cerrados en su alcance y tres abiertos. [Catálogo](CASOS_PRUEBA_CALIDAD.md) de 49 IDs/casos-familia, [matriz](TRAZABILIDAD_CALIDAD.md), [gestión y plantillas](GESTION_CALIDAD.md), [aportes del historial](APORTES_TP_CALIDAD.md) y [ficha E05](REGISTRO_EJECUCION_E05.md). El inventario conserva 162 aprobadas/0 fallidas/1 omitida de producto y 41 de infraestructura de E04, sin convertir documentación en nuevas pruebas. DEF-DAT-001 se cierra por código y regresión aislada; OBS-COB-001, por cobertura/gates. [DEF-SUP-001 #1](https://github.com/ImaDecara/Tesis-EQUITAS/issues/1), [OBS-DEP-001 #3](https://github.com/ImaDecara/Tesis-EQUITAS/issues/3) y [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) siguen abiertos. Esta actualización prevalece sobre los estados históricos de tickets/trazabilidad pendientes; integración real y RLS siguen en E06. No se utiliza Jira.

**Actualización E04, 21/10/2026:** gates implementados en `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`. [CI normal aprobado](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195) y [ensayo crítico controlado bloqueado](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574162), ambos con 162 pruebas de producto aprobadas, cero fallidas y una externa omitida; otras 41 de infraestructura aprobadas. Frontend **791/1.280 sentencias, 61,79 % informado por Vitest**, sobre el mismo alcance de 55 archivos. Nuevo frontend **28/28**, nuevo backend **15/17 (88,24 %)** contra la base fija `531996f…`; duplicación **3,83 %**. **OBS-COB-001 cerrada**. El gate rechaza insuficiencia, críticos y evidencia inválida; la inyección sintética demuestra el mecanismo y el defecto real conserva su evidencia E03. Ver [ficha E04](REGISTRO_EJECUCION_E04.md), [casos](CASOS_E04_GATES.md) y [evidencias](evidencias/e04/ejecuciones-2026-10-21.json). Esta actualización prevalece sobre los estados históricos de cobertura/gates pendientes. DEF-SUP-001 y OBS-DEP-001 siguen abiertos; integración real, despliegue/smoke, cargas y cierre final permanecen pendientes.

**Actualización E03:** se corrigió DEF-DAT-001 en objetos y personas. [CI rojo](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39672114249) conservó cuatro fallos por filas ausentes; [CI verde](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39673351642) recuperó 3.507 filas en los mismos casos y aprobó límites, errores y agregados. Resultado: 136 pruebas de producto aprobadas, ninguna fallida y una externa omitida; otras 14 de infraestructura aprobadas. Cobertura frontend **57,96 %**, todavía menor a 60 %; duplicación **3,83 %**; código ejecutable nuevo de E03 **28/28 cubierto**. Para el estado vigente prevalecen [la ficha E03](REGISTRO_EJECUCION_E03.md) y [sus evidencias](evidencias/e03/ejecuciones-2026-10-21.json). E04 es la siguiente etapa; RLS, integración real, despliegue, smoke, cargas y PDF continúan pendientes. Las observaciones siguientes conservan el diagnóstico histórico.

Commit verificado: `531996f51243dc3d4c5a607338e2f35e32313f6b`, rama `main`. La consulta a GitHub confirmó el mismo commit en `main`, una sola rama publicada, ninguna PR encontrada y **0 ejecuciones de GitHub Actions** disponibles al momento de la revisión. Esto no permite descartar trabajo todavía no publicado por el equipo.

**Conclusión del diagnóstico inicial:** la base local de EQUITAS compila, arranca y supera las suites existentes. Su medición histórica de sentencias superaba el 60 % en ambos módulos. La entrega completa del TP todavía no está demostrada: faltan automatización de CI/CD, quality gates, validación Auth real desde el cliente, smoke posterior al despliegue, cargas, defecto con corrección rojo/verde y cierre documental.

**Actualización E02, 21/10/2026:** CI base implementado y [aprobado en GitHub](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39669312471), con instalaciones Linux nuevas, 94 pruebas de producto y 14 de infraestructura aprobadas, y una prueba externa omitida. Se comprobó además [un fallo controlado](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39669377493) propagado a jobs/resumen con artefactos descargados y verificados. La cobertura frontend sigue en 45,96 % y la excepción de cinco avisos de desarrollo permanece abierta. El ensayo comprueba CI, no el defecto funcional de E03. Para el estado vigente prevalecen [la ficha E02](REGISTRO_EJECUCION_E02.md) y [sus evidencias](evidencias/e02/ejecuciones-2026-10-21.json); despliegue, gates completos, integración, smoke, cargas y PDF siguen pendientes.

**Actualización E01, 21/10/2026:** etapa completada con instalación nueva, versiones fijadas, Next 16.4.2, Vitest/V8 4.1.12, regresión de 94 aprobadas y una omitida, build aprobado y Ruff con 16 correcciones/3 excepciones locales justificadas. La auditoría npm baja de 19 a cinco altos de desarrollo, sin críticos ni avisos productivos. La nueva medición frontend es **45,96 %**, con los mismos 54 archivos y mapeo V8 basado en AST: **R07 frontend no cumple actualmente**. Ampliar pruebas antes de cerrar E04 (OBS-COB-001). Las tablas posteriores son antecedentes de la revisión inicial. Prevalecen los resultados y limitaciones de [REGISTRO_EJECUCION_E01.md](REGISTRO_EJECUCION_E01.md) para el estado técnico vigente.

**Ampliación mediante el plugin Supabase, 21/10/2026:** se inspeccionó el servicio real, se confirmaron 2.933 objetos y 56.286 deudas, se verificaron restricciones y agregados, y se reprodujo una falla de autorización RLS mediante transacciones de solo lectura. El rol autenticado sin pertenencia ve toda la cartera. Ver `REVISION_SUPABASE.md`, `REGISTRO_DEFECTOS_CALIDAD.md` y `evidencias/supabase-2026-10-21.json`. La comprobación administrativa no convierte en aprobada la prueba Auth del frontend que sigue omitida. Jira conserva su estado previo, sin evidencia externa nueva.

**Cierre de formalización E00:** el checkpoint documental se publicó en `d4e61644298b18f790a9effb3b8a38472f988698`. El plan vigente está en `PLAN_PRUEBAS_CALIDAD.md`, la continuidad corresponde a Axel Azcune (`AxAzc`) y se eligió GitHub Issues junto con el registro versionado para seguimiento; los tickets se completarán en E05. La ficha `REGISTRO_EJECUCION_E00.md` conserva los controles de esta etapa. CI, gates, integración de aplicación, smoke, cargas y correcciones siguen pendientes según el roadmap.

## 1. Fuentes revisadas y punto de partida

| Fuente | Qué aporta | Situación al revisarla |
| --- | --- | --- |
| `consigna_pdf.md` | Requisitos y entregables obligatorios. | Fuente para determinar cumplimiento. |
| Antecedentes locales de trabajo | Diagnóstico inicial, implementaciones, decisiones y reparto del trabajo. | Utilizados como contexto para reconstruir el avance y contrastarlo con archivos y ejecuciones. |
| `tp-Calidad.md` | Informe académico que se estaba armando desde Word. | Llega hasta QA/QC; incluye logo y nueve capturas de terminal/cobertura. Se revisaron también las diez imágenes embebidas. |
| `INFORME_TP_CALIDAD_SOFTWARE.md` | Informe técnico más amplio, con 18 secciones. | Incluye planificación y trazabilidad; conserva apartados pendientes. |
| `CALIDAD_SOFTWARE_PRUEBAS.md` | Línea base y ampliación de pruebas. | Resultados históricos reproducidos en esta revisión. |
| `CALIDAD_SOFTWARE_INTEGRACION.md` | Contratos simulados y preparación de Supabase real. | Prueba real condicionada a credenciales de testing. |
| Código, configuraciones, pruebas, dependencias y estado de GitHub | Contraste entre documentación e implementación. | Se utilizó el grafo del código, lectura de fuentes y ejecuciones locales. |

En el chat se decidió trabajar sobre el **primer MVP**, declarar **Nivel 2**, conservar los resultados reales y avanzar por etapas verificadas. También se pidió **no incluir índice** en el informe académico. La clasificación de nivel corresponde al avance funcional del MVP; no equivale a haber cumplido ya todos los requisitos de calidad de ese nivel.

**Responsabilidad de continuidad aclarada por el usuario:** el usuario de esta conversación es la persona a quien se asignaron CI/CD, quality gates, gestión de defectos, Supabase real, smoke y cargas. Su compañero realizó el avance inicial; ahora corresponde continuar y concluir esas tareas desde este repositorio. No hay un paquete de trabajo de otra persona pendiente de recibir. Los apartados sin implementación o evidencia deben completarse aquí como parte del cierre del TP.

## 2. Arquitectura y alcance comprobados

- **Frontend:** Next.js 16.2.6, React 19.2.4, TypeScript, Tailwind, Recharts y clientes Supabase para navegador y servidor. Incluye login, dashboard, objetos, detalle, personas, mora, riesgo, prioridades y recomendaciones.
- **Acceso a datos:** las consultas de la web van a Supabase. La autorización valida la relación `auth.users → public.user → tenant_user`. Las pruebas actuales simulan las respuestas de esas tablas; no prueban las políticas RLS reales.
- **Backend:** FastAPI expone `/health`, `/case-groups/definitions`, `/case-groups/summary` y `/case-groups`. El servicio de scoring agrupa y prioriza casos desde Supabase. No se encontraron llamadas de `front/app`, `front/components` o `front/lib` hacia estos endpoints: no debe dibujarse una conexión web → FastAPI como flujo ya integrado.
- **ETL:** extracción de `cabecera.tsv` y `detalle.tsv`, transformación, payloads, deduplicación, cargas y reintentos. Las pruebas utilizan TSV temporales y cargas simuladas. La revisión no ejecutó cargas reales.
- **Infraestructura externa:** el chat identifica Vercel como hosting. Al iniciar la revisión `database/` solo contenía `.gitkeep`. La ampliación Supabase incorporó un snapshot de esquema/políticas y consultas de solo lectura; todavía no hay migraciones ni un procedimiento completo para reconstruir el entorno externo.

Rutas centrales: `front/lib/data/raw-debtor-loader.ts`, `front/lib/services/person-data-service.ts`, `front/lib/services/auth-service.ts`, `front/lib/supabase-server.ts`, `front/proxy.ts`, `back/ETL/`, `back/services/scoring_service.py` y `back/api/main.py`.

## 3. Verificación nueva realizada el 21/10/2026

Se instalaron las dependencias declaradas, usando el lockfile del frontend y un entorno virtual local para Python. No se cambió código productivo, configuración de cobertura, lockfiles, Supabase ni Vercel. Entorno: Windows, Node **22.23.2**, npm **10.9.8**, Python **3.12.14**, Vitest **3.2.4**, Pytest **8.4.2** y Ruff **0.17.1**.

| Verificación | Resultado actual | Interpretación |
| --- | --- | --- |
| Vitest con cobertura | **33 aprobadas, 0 fallidas, 1 omitida**. | La omitida es la integración real de Supabase. |
| Pytest con cobertura | **61 aprobadas, 0 fallidas**; 1 advertencia de Starlette/TestClient. | ETL, API, scoring e integraciones simuladas pasan. |
| Total de suites existentes | **94 aprobadas, 0 fallidas, 1 omitida**. | Coincide con los documentos y capturas anteriores. |
| ESLint | **0 errores y 0 advertencias**, 70 archivos. | Aprobado localmente. |
| Ruff, ejecutado desde `back` | **19 hallazgos en 8 archivos**, salida 1. | Es una línea base con observaciones, no un análisis aprobado. |
| jscpd, duplicación por líneas | **38 clones**, **474 / 11.188 = 4,24 %**; 62 archivos. | Por debajo del umbral del 5 %, todavía sin gate. |
| jscpd, complejidad | Máximo CX **119** en `back/ETL/transform.py`. | Coincide con la línea base documentada. |
| Build Next.js y TypeScript | **Aprobado**. | Compilación de producción y generación de rutas completadas. |
| `pip check` | Sin requisitos incompatibles. | No sustituye un análisis de vulnerabilidades Python. |
| `npm audit` | **19 vulnerabilidades**: 1 baja, 2 moderadas, 12 altas, 4 críticas; salida 1. | Requiere revisión y tratamiento; no se aplicó `audit fix`. |
| Arranque y HTTP local | **6 comprobaciones satisfactorias**. | Solo disponibilidad y respuestas básicas, detalladas abajo. |

La primera compilación falló porque la red restringida impidió descargar Geist y Geist Mono desde Google Fonts. La repetición con acceso de red pasó. Es una dependencia del proceso de compilación que conviene considerar al preparar CI, no evidencia de un defecto funcional corregido.

Los avisos de npm incluyen dependencias directas como Next.js, Vitest y su proveedor de cobertura. El recuento de avisos no demuestra que cada vulnerabilidad sea explotable en el despliegue concreto, pero tampoco permite declarar seguridad aprobada a partir de ESLint o del triage de Ruff.

### Cobertura: aclaración necesaria para el informe

| Medida | Frontend | Backend |
| --- | ---: | ---: |
| Sentencias | **3.372 / 5.580 = 60,43 %** | **1.255 / 1.472 = 85,26 %** |
| Ramas | **292 / 472 = 61,86 %** | **339 / 498 = 68,07 %** |
| Funciones | **74 / 135 = 54,81 %** | No informadas por Coverage.py. |
| Combinada: sentencias + ramas | No usada como criterio en esta revisión. | **1.594 / 1.970 = 80,91 %**, mostrado redondeado como **81 %**. |

**85,26 % y 81 % no son resultados contradictorios.** El primero mide sentencias; el segundo es el indicador combinado que Coverage.py presenta cuando está habilitada la cobertura de ramas. El PDF debe nombrar cada medida correctamente. Las ramas aportan evidencia de decisiones; no se midió MC/DC ni cobertura exhaustiva de condiciones.

La cobertura histórica registrada era 12,03 % frontend y 26,83 % backend. La comparación actual mantiene las mejoras de **48,40** y **58,43 puntos porcentuales**. La ejecución histórica inicial no se volvió a ejecutar sobre un commit anterior; se conserva como antecedente documentado.

El alcance configurado sigue siendo `app/`, `components/`, `lib/` en frontend y `ETL/`, `api/`, `services/` en backend. No representa todos los archivos del repositorio: por ejemplo, `front/proxy.ts` no está dentro de ese alcance de cobertura. No se alteró el denominador en esta revisión.

### Comprobaciones de ejecución local

Se iniciaron procesos reales de Uvicorn y `next start` en puertos locales temporales y se detuvieron al terminar. El backend usó URL y clave ficticias; no se consultaron endpoints que leen cartera en Supabase.

| Servicio / consulta | Respuesta comprobada |
| --- | --- |
| API `GET /health` | 200 y `{"status":"ok"}`. |
| API `GET /case-groups/definitions` | 200 y definición `critical_no_contact`. |
| API `GET /case-groups?limit=0` | 422 por límite inválido, antes de consultar datos externos. |
| Web `GET /login` | 200 y contenido «Iniciar sesion». |
| Web `GET /` | 200 y estado inicial «Validando sesion». |
| Web, ruta inexistente | 404 y contenido «Objeto de deuda no encontrado». |

Estas seis comprobaciones **no se suman a las 94 pruebas existentes**. No ejecutan JavaScript de navegador, autenticación real ni dashboard autenticado; tampoco sustituyen el smoke posterior a un despliegue. Dos aserciones iniciales del comprobador HTTP se ajustaron al comportamiento existente: sin credenciales no se muestra un formulario operativo y la página 404 tiene texto propio en español. Ese ajuste del comprobador no constituye un defecto de producto ni un caso rojo/verde para la consigna.

## 4. Matriz de cumplimiento contra la consigna

| Requisito | Estado verificable | Qué falta para cerrarlo |
| --- | --- | --- |
| Nivel declarado y objetivos desde usuario/equipo/organización | Documentado; mejor desarrollado en el informe técnico. | Consolidar objetivos medibles en el académico. |
| Plan de pruebas, entrada/salida y riesgos P × I | Documentado en el informe técnico. | Unificar escala de riesgos y llevar criterios de cierre al PDF. |
| Matriz ISO de ocho características y top 3 | Documentada en ambos informes, con mayor evidencia en el técnico. | Completar métrica, criterio y estado por característica en el académico. |
| Unitarias AAA, API e integración simulada | Implementadas y aprobadas localmente. | Llevarlas a CI y conservar sus reportes. |
| Equivalencias, límites y tablas de decisión | Casos reales en código; documentación académica parcial. | Reemplazar ejemplos vagos por entradas y salidas de pruebas existentes; agregar una tabla de decisión concreta. |
| Siete principios del testing | Incluidos en el informe técnico. | Integrarlos de forma breve en el informe académico. |
| Cobertura del código existente >= 60 % | **Cumplido en ambos módulos dentro del alcance configurado.** | Mantener el alcance y bloquear regresiones. |
| Cobertura de código nuevo >= 80 % | **No medida.** | Elegir base de comparación, medir líneas nuevas/cambiadas y aplicar gate; no sustituir por cobertura global. |
| Análisis estático, duplicación y complejidad | Ejecutados; Ruff y npm audit con observaciones. | Definir tratamiento y criterio de bloqueo; reportes desde CI. |
| Métrica de proceso y métrica de proyecto | En el informe técnico: éxito de ejecución y tamaño analizado. | Incorporar valor, fórmula e interpretación en el académico. |
| Mejora antes/después | Aumento de cobertura documentado y valor actual reproducido. | Mantener evidencia de la línea base; si se agrega mejora estática, medirla y validar regresión. La consigna no exige que esta mejora adicional sea obligatoriamente un refactor. |
| Herramienta nueva por proceso de cinco pasos | Herramientas instaladas y utilizadas. | Documento de requisitos, alternativas, PoC, matriz de decisión y adopción incremental; enumerar herramientas no cumple estos cinco pasos. |
| Pirámide de automatización y comandos | Suites y scripts disponibles; mapa de niveles en el técnico. | Incorporar smoke/cargas, comandos y relación con el pipeline. |
| Pipeline con build, pruebas, análisis, cobertura, gate y reportes | **Pendiente**: no hay workflow en el repositorio ni ejecuciones de Actions. | Configurar y ejecutar CI; publicar artefactos incluso si falla un control. |
| Gate por bugs críticos, duplicación > 5 % y código nuevo < 80 % | **Pendiente**. | Implementar comprobaciones que fallen; el 60 % global no reemplaza el 80 % nuevo. Definir detección y severidad de bugs críticos. |
| Ejecución de pipeline verde y fallida por problema real | **Pendiente**. | Enlaces, commit, logs y explicación de ambas ejecuciones. |
| Integración externa real de Nivel 2 | **Parcial**: servicio real inspeccionado por MCP; Auth del cliente sigue omitido y hay un defecto RLS confirmado. | Configurar Supabase de testing, corregir autorización y ejecutar Auth + lectura del cliente con sus datos esperados. |
| Smoke por pipeline después del despliegue | **Pendiente**. | Ejecutarlo contra la URL de un despliegue nuevo y conservar resultado. |
| Estrés con resultados y umbrales | **Pendiente**: no hay script ni ejecución. | Definir entorno, escenario, concurrencia, duración, volumen y criterios antes de ejecutar. |
| Esfuerzo sostenido | **Pendiente**: no hay script ni ejecución. | Mantener carga estable durante una duración justificada y registrar evolución, errores y recursos. |
| Registro de defectos, plantillas y trazabilidad completa | Registro versionado de DEF-SUP-001 y DEF-DAT-001 con pasos, esperado/obtenido y evidencia; sin información nueva de Jira. | Asignar responsables, incorporar plantilla reutilizable y conservar corrección/cierre/regresión. |
| Defecto rojo/verde y regresión por corrección | **Parcial**: falla real de autorización reproducida y registrada; no hay corrección ni verde. | Corregir, repetir el mismo caso y automatizar su regresión; conservar versiones/evidencias. |
| Informe PDF, análisis crítico y conclusiones | Markdown académico parcial; PDF inexistente en el estado revisado. | Integrar resultados finales, limitaciones, metas cumplidas/no cumplidas y revisión visual del PDF. |
| Demostración con despliegue nuevo | **Pendiente**. | Ejecutar y documentar el flujo completo sobre la versión entregada. |

No es obligatorio agregar un servidor MCP: **Supabase ya es la integración externa elegida**. El código E2E completo por despliegue corresponde al Nivel 3 en la tabla; para Nivel 2 sí son obligatorios la integración real y el smoke posterior al despliegue.

## 5. Riesgos técnicos que continúan abiertos

1. **Datos incompletos:** ambos loaders del frontend usan `.select('*').limit(TABLE_LIMIT)`, con límite 3.000 y sin paginación de la base. La paginación visual de 10/20 elementos no recupera los registros truncados. El límite efectivo también depende de la configuración de Supabase. Es un candidato concreto para investigar como defecto, con una regresión que reproduzca la pérdida de filas antes de corregirlo.
2. **Seguridad externa con defecto confirmado:** el snapshot incorporado muestra 23 políticas SELECT `TO authenticated USING (true)`. La prueba SQL por rol confirmó que una identidad sintética sin pertenencia cuenta todas las filas de negocio. El flujo entre dos tenants reales sigue sin probarse. La lectura opcional de `debtor` acepta una lista vacía; por sí sola no demuestra acceso a filas esperadas ni aislamiento.
3. **API de scoring:** no se observó autenticación propia en los endpoints de datos. Debe definirse su exposición y control de acceso antes de publicarla; en esta revisión solo se levantó en loopback.
4. **Reproducibilidad:** Python tiene dependencias productivas sin versiones fijadas. La instalación actual funcionó y quedó registrada con `pip freeze`, pero un entorno posterior puede resolver versiones diferentes.
5. **Calidad estática y dependencias:** los 19 avisos Ruff y los 19 de npm audit son dos conjuntos diferentes. «0 hallazgos ESLint» no debe convertirse en «0 problemas de calidad o seguridad».
6. **Escaso margen de cobertura frontend:** 60,43 % está apenas 0,43 puntos por encima del mínimo. Se necesitan aserciones útiles para los cambios nuevos y protección automática del umbral.

## 6. Correcciones y ampliaciones para el informe académico

`tp-Calidad.md` debe conservar su carátula, redacción aprovechable y capturas reales. No necesita rehacerse desde cero. Las nueve capturas técnicas son coherentes con las suites y métricas reproducidas; varias tienen unos 600 píxeles de ancho, por lo que conviene verificar su legibilidad al exportar el PDF.

- Completar después de QA/QC: automatización y quality gates; integración externa real; smoke, estrés y esfuerzo sostenido; defectos y trazabilidad; incorporación de herramienta; evaluación de metas; análisis crítico; conclusiones y evidencias.
- Sustituir la tabla ilustrativa CP-01 a CP-04. «Aplicación de la regla definida» no es un resultado esperado verificable y esos cuatro casos no están trazados como ejecuciones. Ejemplos comprobados: riesgo 39 → BAJO, 40 → MEDIO, 69 → MEDIO, 70 → ALTO; paginación de 25 elementos en página 2/tamaño 20 → elementos 21 a 25; `parse_decimal('1.234,56')` → 1234.56 e inválido → 0.0.
- Añadir una tabla de decisión que corresponda a código y casos concretos, con todas las combinaciones seleccionadas y resultado esperado. Las reglas de riesgo del frontend y los grupos de scoring del backend tienen propósitos distintos; no deben mezclarse sus escalas.
- Aclarar el 85,26 % de sentencias frente al 80,91 % combinado de backend; conservar porcentajes de ramas para evidenciar decisiones.
- Adoptar una única escala de prioridad de riesgos. El académico llama «alta» a 15/16 y «media» a 12; el técnico usa crítica 15–25, alta 10–14, media 5–9 y baja 1–4. Las etiquetas deben seguir la misma convención en ambos.
- Completar ISO con evidencia y estado, sin convertir una característica planificada en validada.
- Incorporar fórmulas: éxito de ejecución = 94/94 = 100 %, con una prueba adicional omitida; tamaño analizado = 62 archivos y 11.188 líneas; duplicación por líneas = 474/11.188. El 5,16 % de tokens duplicados es otra medida y no debe confundirse con el 4,24 % de líneas.
- Añadir las plantillas de caso y defecto y la trazabilidad requisito → caso → defecto → corrección/prueba de regresión.
- Desarrollar los cinco pasos de adopción de una herramienta. Una evaluación retrospectiva debe identificarse como tal, sin inventar fechas de decisiones o PoC previas.
- Mantener la preferencia del chat de **no agregar índice**. La consigna no lo exige. El informe técnico puede seguir sirviendo como anexo de trabajo.
- Completar datos académicos y cerrar con una tabla de metas cumplidas/no cumplidas, conclusiones y límites de la evidencia. No presentar un PDF final como entrega completa mientras falten los resultados externos.

## 7. Orden concreto para concluir

| Orden | Trabajo | Criterio de cierre |
| --- | --- | --- |
| 1 | Consolidar el avance recibido y formalizar su continuidad. **Completado en E00.** | Checkpoint publicado, plan versionado y responsable/seguimiento identificados; ver ficha E00. |
| 2 | Revisar dependencias y Ruff con cambios controlados; seleccionar un defecto funcional reproducible. | Triage registrado, pruebas de regresión y evidencia antes/después; sin fixes masivos para forzar verde. |
| 3 | Automatizar controles y gates en CI. | Build + suites + análisis + 60 % existente + 80 % nuevo + duplicación <= 5 %; artefactos generados. |
| 4 | Ejecutar Supabase real de testing. | Prueba aprobada contra URL aislada con usuario de prueba; datos esperados y límites del caso documentados. |
| 5 | Preparar despliegue y smoke. | Pipeline comprueba una URL del nuevo despliegue; evidencia vinculada al commit. |
| 6 | Ejecutar estrés y esfuerzo sostenido en entorno controlado. | Escenario, umbrales previos, p95, errores, throughput, evolución y limitaciones registrados. Un `/health` bajo carga no valida el procesamiento de cartera. |
| 7 | Cerrar defectos, herramienta, métricas e informe. | Registro formal, rojo/verde real, tabla de cinco pasos y cifras coherentes con CI. |
| 8 | Exportar, revisar PDF y ensayar defensa. | Tablas/capturas legibles, conclusiones respaldadas y demostración reproducible. |

Los pasos con integración y despliegue requieren que exista el entorno y su configuración. No se encontraron `.env` locales ni variables `SUPABASE_TEST_*` en esta sesión. Las credenciales deben configurarse localmente o en secretos del proveedor; no agregarse al informe ni a Git.

## 8. Evidencias y reproducción

El resumen estructurado y portable de la revisión local está en `evidencias/validacion-2026-10-21.json`. Incluye hash SHA-256 de las fuentes, commit, recuentos, denominadores y alcance. La ampliación externa está en `evidencias/supabase-2026-10-21.json`; el snapshot observado y las consultas se guardaron en `database/`. Los hashes del primer resumen describen las versiones de los documentos existentes antes de esta ampliación.

Los resultados detallados locales se conservaron en `.quality/audit/`: `vitest.log`, `vitest.json`, `frontend-coverage-summary.json`, `pytest.log`, `pytest.xml`, `backend-coverage.json`, `backend-coverage.xml`, `eslint.json`, `ruff-default.json`, `ruff-settings.txt`, `npm-audit.json`, `build.log`, `build-network.log`, `duplicates.log`, `complexity.log`, `python-installed.txt` y `local-runtime.json`. El comprobador temporal está en `check_local_runtime.py`; sus procesos terminan al finalizar. El nombre `ruff-default.json` identifica la ejecución con el comando habitual desde `back`.

`.quality/`, `front/coverage/` y `back/htmlcov/` están ignorados por Git; por eso estos reportes locales **no son artefactos ya publicados por un pipeline**. El resumen portable conserva los valores, pero no reemplaza los reportes completos que debe publicar CI.

Comandos principales, desde la raíz en PowerShell:

```powershell
# Frontend, con dependencias ya instaladas mediante npm ci
Set-Location front
npm run test:coverage
npm run lint
npm run build
npm run quality:duplicates
npm run quality:complexity
npm audit

# Backend, con dependencias ya instaladas en el entorno virtual
Set-Location ..\back
.\.venv\Scripts\python.exe -m pytest --cov --cov-report=term-missing --cov-report=html --cov-report=json
.\.venv\Scripts\python.exe -m ruff check ETL api services --output-format concise
.\.venv\Scripts\python.exe -m pip check
```

Ruff y npm audit terminan con salida distinta de cero en este estado, por sus hallazgos. Las pruebas con credenciales de Supabase ausentes no validan la integración real. La conclusión defendible hoy es **base local validada y cierre integral todavía pendiente**.
