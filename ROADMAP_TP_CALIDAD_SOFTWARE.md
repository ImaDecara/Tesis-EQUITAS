# Roadmap para terminar el TP Integrador de Calidad de Software — EQUITAS

**Versión:** 1.4, cierre de la etapa E03 el 21 de octubre de 2026.
**Presentación indicada en la consigna:** 26 de octubre de 2026.  
**Nivel declarado:** Nivel 2 — prototipo parcial.  
**Responsable de continuidad:** Axel Azcune (`AxAzc`), a cargo del cierre del TP.  
**Estado del roadmap:** E00–E03 completadas en sus alcances; E04 es la siguiente etapa. La cobertura frontend vigente es 57,96 % y requiere ampliación de pruebas antes de cerrar E04. Las etapas siguientes conservan sus estados pendientes.

## 1. Objetivo y forma de usar este archivo

El objetivo es concluir el **TP de Calidad de Software** sobre el primer MVP de EQUITAS: completar las verificaciones obligatorias, automatizarlas, conservar evidencia del propio proyecto y entregar un PDF coherente con el repositorio y los reportes.

Se conserva el trabajo existente. No es necesario terminar todas las funcionalidades futuras de la tesis para completar este TP. Se deben cumplir las actividades de calidad exigidas para el alcance declarado, documentar los defectos y describir honestamente las limitaciones que permanezcan.

Este es el documento operativo para continuar. El diagnóstico explica lo observado; este roadmap indica **qué ejecutar, qué producir y cómo decidir que cada etapa está terminada**.

### 1.1. Reglas de seguimiento

1. Leer la etapa antes de comenzar y comprobar sus condiciones de entrada.
2. Cambiar su estado a **En curso** en el tablero de la sección 4.
3. Fijar los criterios de aceptación y parámetros del ensayo antes de ejecutarlo.
4. Implementar únicamente el alcance de esa etapa, conservando las pruebas existentes.
5. Ejecutar las verificaciones correspondientes y guardar resultados con fecha y commit.
6. Actualizar casos, defectos, métricas e informe durante el trabajo, sin dejar toda la documentación para el último día.
7. Marcar casillas y estado **Completada** solo cuando se cumplan los criterios de salida y existan los archivos o enlaces de evidencia.
8. Registrar un bloqueo concreto si falta una dependencia externa. Continuar las tareas independientes; una prueba omitida o un reporte ausente no equivale a aprobación.
9. Al cerrar una etapa, completar la ficha de ejecución de la sección 18 e indicar la siguiente etapa habilitada.

Los estados admitidos son **Pendiente**, **En curso**, **Bloqueada** y **Completada**. Una etapa parcialmente hecha conserva tareas abiertas; no se declara completa por tener una captura o un script sin ejecutar.

### 1.2. Alcance de la responsabilidad

- El compañero realizó el avance inicial. El usuario continúa CI/CD, gates, gestión de defectos, Supabase real, smoke, cargas e informe final en esta conversación.
- No hay un paquete de trabajo de otro compañero pendiente de recibir.
- El responsable de continuidad implementa y verifica dentro del alcance acordado, mantiene la documentación y configura los accesos externos necesarios.
- El equipo debe poder explicar lo entregado y conservar aportes individuales trazables.
- La preferencia del informe académico se mantiene: **sin índice**. El roadmap sí puede tener navegación y tablas de control.

## 2. Punto de partida comprobado

**Actualización posterior E03:** DEF-DAT-001 corregido mediante paginación por `id` en ambas rutas y sus relaciones. Se conserva [CI rojo con cuatro fallos reales](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39672114249) y [CI verde](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39673351642) con 136 pruebas de producto aprobadas, cero fallidas y una externa omitida; otras 14 de infraestructura aprobaron. Los mismos casos recuperan 3.507 filas completas; límites, negativos y agregados también aprobaron. Cobertura frontend **57,96 %**, duplicación **3,83 %** y 28/28 líneas ejecutables nuevas de E03 cubiertas. Los gates completos y el mínimo global siguen pendientes para E04. Ver [ficha E03](REGISTRO_EJECUCION_E03.md), [aceptación y resultados](CASOS_E03_LECTURA_COMPLETA.md) y [evidencias](evidencias/e03/ejecuciones-2026-10-21.json). Esta actualización prevalece sobre el estado anterior del defecto y las métricas históricas siguientes.

**Actualización posterior E02:** el pipeline base está publicado y ejecutado en GitHub. La [ejecución normal](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39669312471) aprobó en Linux con 94 pruebas de producto y 14 de infraestructura aprobadas, una prueba externa omitida y los tres jobs correctos. El [ensayo controlado de fallo](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39669377493) terminó en rojo y conservó sus tres artefactos. Ambos usan el commit `5cfcc773a39fdaa7d5859744c430fd6b790c34d7`. La instalación Linux y `uvloop` condicional quedaron verificadas. Esto no cierra E03/E04 ni integración, smoke o cargas. Ver [ficha E02](REGISTRO_EJECUCION_E02.md) y [evidencias](evidencias/e02/ejecuciones-2026-10-21.json).

**Actualización posterior E01:** la instalación y las dependencias quedaron controladas, con 94 pruebas aprobadas y una omitida, build aprobado, 16 correcciones Ruff y tres excepciones locales justificadas. La auditoría npm actual conserva cinco altos de desarrollo, sin críticos ni avisos productivos. Vitest 4.1.12 mide **45,96 % de sentencias frontend sobre los mismos 54 archivos**; la cifra histórica 60,43 % no es la medición actual. **OBS-COB-001 bloquea cerrar E04 hasta ampliar pruebas y cumplir el 60 %.** Ver [ficha E01](REGISTRO_EJECUCION_E01.md), [reproducción](REPRODUCIBILIDAD_CALIDAD.md) y [evidencias](evidencias/e01/resumen-2026-10-21.json). Las tablas de línea base siguientes conservan sus valores históricos.

### 2.1. Línea base local del 21/10/2026

Commit del producto revisado: `531996f51243dc3d4c5a607338e2f35e32313f6b`, rama `main`. El diagnóstico, las evidencias y este roadmap se publicaron en el checkpoint documental `d4e61644298b18f790a9effb3b8a38472f988698`. El código de producto no cambió entre ambos commits.

| Medida o verificación | Resultado comprobado | Cómo se utilizará |
| --- | --- | --- |
| Pruebas frontend | 33 aprobadas, 0 fallidas, 1 omitida. | Regresión de partida. |
| Pruebas backend | 61 aprobadas, 0 fallidas; una advertencia de Starlette/TestClient. | Regresión de partida. |
| Total de suites | **94 aprobadas, 0 fallidas, 1 omitida**. | Antecedente; actualizar cuando se agreguen pruebas. |
| Sentencias frontend | **3.372 / 5.580 = 60,43 %**. | Supera 60 % dentro del alcance configurado. |
| Ramas frontend | **292 / 472 = 61,86 %**. | Evidencia de cobertura de decisiones mediante ramas. |
| Funciones frontend | **74 / 135 = 54,81 %**. | Métrica complementaria. |
| Sentencias backend | **1.255 / 1.472 = 85,26 %**. | Supera 60 % dentro del alcance configurado. |
| Ramas backend | **339 / 498 = 68,07 %**. | Métrica complementaria de decisiones. |
| Combinada backend | **80,91 %**, mostrada como 81 % en terminal. | No confundir con 85,26 % de sentencias. |
| ESLint | 0 errores y 0 advertencias. | Control reproducido. |
| Ruff | 19 hallazgos en 8 archivos, salida 1. | Línea base con observaciones; requiere tratamiento. |
| Duplicación | 38 clones; **474 / 11.188 líneas = 4,24 %**. | Está por debajo del 5 % por líneas. |
| Complejidad reportada por jscpd | Máximo CX 119 en `back/ETL/transform.py`. | Línea base, no certificación independiente de complejidad. |
| Build frontend | Aprobado, incluyendo TypeScript. | Llevar a CI. La descarga de fuentes requirió red. |
| npm audit | 19 vulnerabilidades: 1 baja, 2 moderadas, 12 altas y 4 críticas. | Revisar alcance y tratamiento. Es otro conjunto distinto de Ruff. |
| Arranque/HTTP local | 6 comprobaciones satisfactorias. | Antecedente de disponibilidad; no reemplaza smoke desplegado. |

La cobertura histórica inicial documentada era 12,03 % frontend y 26,83 % backend. No se reejecutó esa etapa histórica sobre un commit antiguo; se conserva como antecedente documentado y no como una ejecución nueva.

Alcance actual: `front/app`, `front/components`, `front/lib`; `back/ETL`, `back/api`, `back/services`. Por ejemplo, `front/proxy.ts` no está dentro del alcance frontend configurado. Conservar y explicar el alcance; cualquier ampliación debe mostrar su nuevo denominador. No excluir archivos para forzar porcentajes.

### 2.2. Supabase real observado

Proyecto EQUITAS: `folyslqzqvnpolexcxjo`, estado observado `ACTIVE_HEALTHY`. Se verificaron 23 tablas públicas, 2.933 objetos, 56.286 deudas, 2.493 personas y un tenant con un usuario. No se encontraron branches de desarrollo entre los recursos devueltos por el plugin.

Los controles seleccionados de integridad no mostraron duplicados por clave de deuda, huérfanos ni discrepancias de conteo o importe de perfiles. Esa evidencia no demuestra todas las reglas del ETL ni sustituye una nueva carga idempotente de testing.

| Defecto | Estado y evidencia | Qué falta |
| --- | --- | --- |
| **DEF-DAT-001** | Condición inicial: consultas únicas limitadas y volumen superior. E03 lo corrigió con rojo/verde y regresión de ambas rutas; [ficha](REGISTRO_EJECUCION_E03.md). | Validar en integración/despliegue E06/E07; cierre automatizado de E03 comprobado. |
| **DEF-SUP-001** | Las políticas SELECT son `TO authenticated USING (true)`. Una identidad SQL sintética sin pertenencia contó toda la cartera. | Corrección y validación por roles/tenants en testing, sin romper el acceso autorizado. |

La simulación SQL fue READ ONLY con ROLLBACK. No creó una cuenta ni obtuvo un JWT válido. El rol anónimo vio cero filas. No se comprobó un ataque HTTP ni un recorrido entre dos tenants reales.

### 2.3. Qué sigue pendiente

- Gates completos, incluyendo 80 % sobre código nuevo.
- Corrección y validación de autorización RLS; mantener el rojo/verde de lectura ya conseguido en E03.
- Integración Auth/Data API real desde el cliente de aplicación en testing.
- Despliegue nuevo con smoke automático posterior.
- Estrés y esfuerzo sostenido ejecutados con criterios previos.
- Gestión completa de casos/defectos y herramienta incorporada mediante cinco pasos.
- Consolidación del informe académico, PDF y demostración.

Las 136 pruebas actuales y las consultas de investigación no se convierten automáticamente en esos entregables.

## 3. Fuentes y función de cada documento

| Archivo existente | Función |
| --- | --- |
| [consigna_pdf.md](consigna_pdf.md) | Fuente de requisitos obligatorios. |
| [PLAN_PRUEBAS_CALIDAD.md](PLAN_PRUEBAS_CALIDAD.md) | Plan vigente de alcance, objetivos, entornos, criterios y riesgos, formalizado en E00. |
| [REGISTRO_EJECUCION_E00.md](REGISTRO_EJECUCION_E00.md) | Ficha de cierre y verificaciones de la primera etapa. |
| [REGISTRO_EJECUCION_E03.md](REGISTRO_EJECUCION_E03.md) | Corrección de lectura completa, rojo/verde, regresión y métricas vigentes. |
| [CASOS_E03_LECTURA_COMPLETA.md](CASOS_E03_LECTURA_COMPLETA.md) | Aceptación publicada antes de corregir y resultados vinculados. |
| [tp-Calidad.md](tp-Calidad.md) | Base del informe académico recibido; llega hasta QA/QC y contiene capturas. |
| [INFORME_TP_CALIDAD_SOFTWARE.md](INFORME_TP_CALIDAD_SOFTWARE.md) | Respaldo técnico extenso y actualización de resultados. |
| [CALIDAD_SOFTWARE_PRUEBAS.md](CALIDAD_SOFTWARE_PRUEBAS.md) | Antecedentes de pruebas y cobertura. |
| [CALIDAD_SOFTWARE_INTEGRACION.md](CALIDAD_SOFTWARE_INTEGRACION.md) | Integraciones simuladas, preparación de la prueba real y ampliación por plugin. |
| [DIAGNOSTICO_CIERRE_CALIDAD.md](DIAGNOSTICO_CIERRE_CALIDAD.md) | Diagnóstico general y matriz de brechas. |
| [REVISION_SUPABASE.md](REVISION_SUPABASE.md) | Investigación del servicio real y sus límites. |
| [REGISTRO_DEFECTOS_CALIDAD.md](REGISTRO_DEFECTOS_CALIDAD.md) | Registro inicial de defectos, pasos y criterios de cierre. |
| [validacion-2026-10-21.json](evidencias/validacion-2026-10-21.json) | Evidencia estructurada de la verificación local. |
| [supabase-2026-10-21.json](evidencias/supabase-2026-10-21.json) | Evidencia de metadatos, conteos y pruebas por rol. |
| [schema-observado-2026-10-21.json](database/schema-observado-2026-10-21.json) | Snapshot observado; no es una migración ni reconstruye por sí solo Supabase/Auth. |
| [verificacion_supabase_solo_lectura.sql](database/verificacion_supabase_solo_lectura.sql) | Consultas de lectura para reproducir las comprobaciones de roles y conteos. |

Los nuevos nombres de scripts y documentos que se proponen más adelante son **entregables a crear**, no archivos ya implementados. Los nombres finales pueden adaptarse; actualizar sus referencias al hacerlo.

## 4. Tablero de etapas y dependencias

| Etapa | Propósito | Estado inicial | Depende de |
| --- | --- | --- | --- |
| **E00** | Consolidar alcance, línea base y checkpoint de trabajo. | Completada; ver ficha de ejecución E00. | Evidencias existentes. |
| **E01** | Reproducibilidad, dependencias y tratamiento del análisis estático. | **Completada**; riesgos residuales documentados. | E00. |
| **E02** | Pipeline base con build, suites y reportes. | **Completada**; ejecución normal y ensayo de fallo comprobados. | E00–E01. |
| **E03** | Reproducir y corregir DEF-DAT-001 con rojo/verde. | **Completada**; 27 controles, ambas rutas, rojo/verde y regresión verificados. | E02; registro de defectos iniciado. |
| **E04** | Quality gates completos y comprobados. | En curso: implementación y verificación de gates. | E01–E03. |
| **E05** | Formalizar gestión de casos, defectos y trazabilidad. | Registro inicial creado; formalización pendiente. | Comienza en E00 y se actualiza en todas las etapas. |
| **E06** | Supabase de testing, autorización y cliente real. | Inspección realizada; integración de aplicación pendiente. | E00–E02; entorno aislado disponible. |
| **E07** | Despliegue nuevo y smoke automático posterior. | Pendiente. | E04, E06. |
| **E08** | Estrés y esfuerzo sostenido, ejecutados por pipeline. | Pendiente. | E02 y escenario aislado; E03/E06 según componente elegido. |
| **E09** | Herramienta de cinco pasos y documentación transversal. | Parcial en los informes; cierre pendiente. | Puede avanzar junto con E01–E08. |
| **E10** | Informe académico consolidado y PDF revisado. | Base recibida hasta QA/QC. | Evidencias finales de E03–E09. |
| **E11** | Validación integral, entrega y ensayo de defensa. | Pendiente. | E00–E10. |

Ruta técnica principal: **E00 → E01/E02 → E03 → E04 → E06 → E07 → E08 → E10 → E11**. E05 y E09 acompañan el desarrollo. La preparación del entorno E06 puede comenzar mientras se construye CI, sin declarar completa la integración antes de ejecutar sus pruebas.

E00–E03 están completas; el siguiente objetivo ejecutable es E04. E03 conserva una ejecución roja por un defecto real y otra verde tras corregirlo. El ensayo controlado de E02 conserva su propósito de verificar CI. Una ejecución verde del pipeline base no equivale todavía al ciclo integral de entrega.

## 5. Matriz completa de requisitos de la consigna

| ID | Requisito que debe quedar cubierto | Etapas | Evidencia de cierre |
| --- | --- | --- | --- |
| R01 | Nivel declarado y alcance del MVP. | E00, E10 | Justificación Nivel 2 y alcance versionado. |
| R02 | Objetivos medibles desde usuario, equipo y organización; contingencia de dependencia crítica. | E09, E10 | Objetivos con métrica/umbral y protocolo Supabase. |
| R03 | Plan versionado con entrada, salida y estrategia. | E00, E09 | Plan actualizado y aplicado. |
| R04 | Ocho características ISO 25010 y top 3 justificado. | E09, E10 | Matriz con criterio, evidencia y estado. |
| R05 | Unitarias AAA, aceptación previa y siete principios del testing. | E03, E09 | Casos reales, código y explicación aplicada. |
| R06 | Equivalencias, límites, tabla de decisión y cobertura de sentencia/decisión. | E03, E06, E09 | Casos trazados y reportes de sentencias/ramas con límites explicados. |
| R07 | Cobertura mínima de código existente Nivel 2: 60 %. | E02, E04 | Reporte y gate por módulo, alcance explícito. |
| R08 | Cobertura sobre código nuevo: 80 %. | E04 | Base, diff, denominador, cobertura nueva y bloqueo comprobado. |
| R09 | Análisis estático y gate ante bugs críticos. | E01, E04 | Reporte, clasificación y resultado del gate. |
| R10 | Gate ante duplicación mayor a 5 %. | E04 | Reporte por líneas y bloqueo comprobado. |
| R11 | Métricas interpretadas, una de proceso y una de proyecto, mejora antes/después. | E03, E09 | Fórmulas, valores, versiones y análisis. |
| R12 | Riesgos P × I, QA/QC y plantillas de caso/defecto. | E05, E09 | Matriz coherente y plantillas utilizadas. |
| R13 | Registro y trazabilidad requisito → caso → defecto; regresión por corrección. | E03, E05, E06 | Registro, enlaces y pruebas de regresión. |
| R14 | Defecto real con rojo/verde. | E03; E06 para RLS | Mismo caso fallido antes y aprobado después. |
| R15 | Pirámide, pruebas de API e integración con dobles. | E02, E09 | Mapa de niveles y suites existentes ejecutadas. |
| R16 | Una integración externa probada contra entorno real. | E06 | Auth + lectura por cliente real con datos conocidos. |
| R17 | Pipeline versionado con build, pruebas, análisis, cobertura, gate y reportes automáticos. | E02, E04, E07, E08 | Workflow y artefactos accesibles. |
| R18 | Pipeline completo verde y pipeline fallido por problema real. | E03, E11 | URLs, SHA, causa y reportes de ambas ejecuciones. |
| R19 | Smoke ejecutado por pipeline tras el despliegue. | E07 | URL nueva, SHA y reporte posterior a disponibilidad. |
| R20 | Estrés ejecutado con resultados y umbrales; reporte por pipeline. | E08 | Script, configuración previa, reporte y análisis. |
| R21 | Esfuerzo sostenido ejecutable y documentado. | E08 | Duración, serie temporal y resultado. |
| R22 | Herramienta nueva mediante cinco pasos y mapa de herramientas. | E09 | Necesidad, alternativas, PoC, matriz y adopción. |
| R23 | PDF con nivel, metas, evolución, análisis crítico y conclusiones. | E10 | PDF revisado y fuente editable. |
| R24 | Demostración con despliegue nuevo y aporte individual trazable. | E11 | Guion, ejecución y registro de aportes. |
| R25 | Todas las clases de pruebas ejecutables con un comando. | E02, E06–E08, E11 | Tabla de comandos comprobados desde un entorno preparado. |

La consigna ya queda cubierta por Supabase como integración elegida; no exige agregar otro servidor MCP. El flujo E2E completo en cada despliegue corresponde al Nivel 3 en la tabla; para Nivel 2 sí son obligatorios la integración real y el smoke posterior al despliegue.

## 6. E00 — Consolidar el avance y preparar el checkpoint

**Objetivo:** comenzar desde un estado identificado y conservar el trabajo recibido.  
**Entrada:** este roadmap y las evidencias existentes.  
**Requisitos relacionados:** R01, R03, R12, R13, R24.

### Tareas

- [x] Revisar `git status`, rama y SHA actuales; diferenciar archivos recibidos, documentación nueva y cambios ajenos a la etapa.
- [x] Registrar el commit de partida y el estado del árbol de trabajo. No asumir que los archivos sin seguimiento ya están en GitHub.
- [x] Versionar los documentos y evidencias pertinentes mediante cambios revisables, sin descartar originales ni cambios del usuario.
- [x] Si se crea una rama de trabajo, utilizar un nombre descriptivo. Registrar su nombre real; no crear ramas ficticias en la documentación. **No aplica creación: se conserva `main`.**
- [x] Mantener Nivel 2 y un alcance centrado en el primer MVP existente.
- [x] Crear o consolidar un plan versionado de pruebas. **Formalizado en `PLAN_PRUEBAS_CALIDAD.md`.**
- [x] Fijar criterios de entrada/salida, componentes, entornos, fuentes de datos y responsables.
- [x] Asignar un responsable nominal al trabajo y a los defectos. **Axel Azcune (`AxAzc`).**
- [x] Elegir el soporte de casos/defectos. **GitHub Issues y registro Markdown; altas de tickets previstas en E05.**
- [x] Mantener las credenciales en configuración local o secretos del proveedor. El contexto de trabajo local se conserva fuera de la publicación.
- [x] Registrar el alcance de las métricas y el commit `531996f51243dc3d4c5a607338e2f35e32313f6b` como referencia del producto revisado.

### Verificar y cumplir

- [x] El estado inicial está identificado con SHA y fecha, sin atribuir archivos nuevos a un commit anterior.
- [x] Los valores de la sección 2 se conservan como históricos; cualquier nueva medición tiene fecha/versión propia.
- [x] El plan distingue pruebas aisladas, integración real, smoke y rendimiento.
- [x] Queda claro qué se entregará y qué no forma parte de completar la tesis completa.

**Cierre E00:** [REGISTRO_EJECUCION_E00.md](REGISTRO_EJECUCION_E00.md) y [evidencia estructurada](evidencias/e00-consolidacion-2026-10-21.json). El checkpoint previo publicado es `d4e61644298b18f790a9effb3b8a38472f988698`; la versión que incorpora esta ficha identifica el cierre documental de la etapa.

**Salida y evidencia:** checkpoint de Git, plan actualizado, responsable y soporte de seguimiento definidos.  
**No cerrar si:** se perdió trabajo recibido, no se sabe qué versión se prueba o se declara completo algo solo por estar mencionado en el chat.

## 7. E01 — Reproducibilidad y tratamiento de dependencias/análisis

**Objetivo:** hacer repetibles las verificaciones y establecer un tratamiento explícito de los hallazgos.  
**Entrada:** E00.  
**Requisitos relacionados:** R07, R09, R11, R17.

### Tareas

- [x] Registrar versiones efectivas de Node, npm, Python, paquetes de pruebas y analizadores.
- [x] Mantener `npm ci` y el lockfile frontend. No sustituirlo por una instalación que resuelva versiones distintas sin registrar el cambio.
- [x] Definir versiones reproducibles de dependencias Python. El `pip freeze` de la auditoría es evidencia del entorno observado; revisarlo antes de adoptarlo como lockfile para otra plataforma.
- [x] Ejecutar la regresión sobre las dependencias elegidas, evitando repetir suites sin motivo después de una verificación suficiente.
- [x] Revisar Ruff desde `back`, conservando versión, reglas, alcance y directorio de ejecución. Los 19 hallazgos son una línea base, no un resultado aprobado.
- [x] Corregir observaciones seguras y revisar manualmente las que afecten excepciones, datos o comportamiento. No ejecutar fixes inseguros masivos para obtener cero.
- [x] Clasificar hallazgos por tipo, severidad y tratamiento. La severidad de negocio no se deriva automáticamente del nombre de una regla Ruff.
- [x] Revisar las vulnerabilidades npm, separando dependencias productivas y de desarrollo, alcance, corrección disponible y regresión necesaria.
- [x] Tratar los hallazgos que incumplan los criterios de liberación; justificar explícitamente cualquier pendiente, sin ocultarlo con filtros globales o ignorando códigos de salida.
- [x] Si se actualizan Next.js, Supabase u otros paquetes con cambios de API, consultar documentación de la versión y las instrucciones locales antes de modificar código.
- [x] Documentar la dependencia de red de `next/font` o adoptar una solución reproducible si es necesaria. Un fallo de descarga de fuentes no cuenta como defecto funcional corregido para R14.
- [x] Capturar métricas antes/después de los cambios aplicados y ejecutar build, análisis y regresión que correspondan.

### Comandos actuales de referencia

Desde `front`: `npm ci`, `npm run test:coverage`, `npm run lint`, `npm run build`, `npm run quality:duplicates`, `npm run quality:complexity`, `npm audit`.

Desde `back`, con el entorno ya preparado: `.\.venv\Scripts\python.exe -m pytest --cov --cov-report=term-missing --cov-report=html`, `.\.venv\Scripts\python.exe -m ruff check ETL api services --output-format concise`, `.\.venv\Scripts\python.exe -m pip check`.

Si cambia el mecanismo de instalación o un comando, actualizar el plan y la tabla final de reproducción. No depender exclusivamente de una ruta de runtime privada de esta máquina.

**Herramientas elegidas al cerrar E01:** Node 22.23.2, npm 11.21.1 y CPython 3.12.14. La instalación con npm puede ejecutarse mediante `npx --yes --package=npm@11.21.1 npm ci`. Los comandos de esta guía presuponen esas versiones; [REPRODUCIBILIDAD_CALIDAD.md](REPRODUCIBILIDAD_CALIDAD.md) detalla preparación, comandos y salidas esperadas, incluida la auditoría completa con salida 1 y tratamiento explícito.

### Verificar y cumplir

- [x] Se puede preparar un entorno nuevo con las versiones declaradas.
- [x] Build y suites pasan después de cualquier actualización/corrección de esta etapa.
- [x] Cada control fallido tiene resultado y tratamiento registrados.
- [x] No se presenta `pip check` como auditoría de vulnerabilidades.
- [x] El alcance de cobertura y duplicación permanece explicado y comparable.

**Cierre E01:** [REGISTRO_EJECUCION_E01.md](REGISTRO_EJECUCION_E01.md), [evidencia estructurada](evidencias/e01/resumen-2026-10-21.json) y seis reportes Ruff/auditoría en esa carpeta. Windows comprobado con instalaciones nuevas; Linux se comprobará en E02. OBS-DEP-001 y OBS-COB-001 permanecen abiertas con tratamiento y responsables; el cierre de reproducibilidad no las declara resueltas.

**Salida y evidencia:** dependencias/configuración reproducibles, triage de análisis y dependencias, reportes y comparación antes/después si hubo cambios.
**No cerrar si:** una actualización rompe la regresión, la instalación depende de versiones desconocidas o un control fallido se convierte en verde ignorando su salida.

## 8. E02 — Pipeline base con pruebas y reportes

**Objetivo:** ejecutar automáticamente los controles locales y conservar resultados de ejecuciones correctas y fallidas.  
**Entrada:** E00; decisiones de instalación de E01 disponibles o en curso.  
**Requisitos relacionados:** R07, R09, R15, R17, R18, R25.

### Tareas

- [x] Crear el workflow versionado de CI, por ejemplo bajo `.github/workflows/`. El archivo debe existir en el repositorio entregado.
- [x] Definir disparadores para cambios y revisión de código; agregar ejecución manual cuando ayude a reproducir la entrega.
- [x] Configurar directorios de trabajo: `front` para npm y `back` para Python/Ruff.
- [x] Usar versiones de runtime declaradas y cache asociada a los lockfiles/configuración.
- [x] Ejecutar build, ESLint, Vitest con cobertura, Pytest con cobertura, Ruff y duplicación con los criterios documentados.
- [x] Exportar resultados procesables de pruebas y cobertura: JSON/XML/LCOV según la herramienta elegida, además de reportes HTML para lectura.
- [x] Configurar los reporteros necesarios. La configuración frontend inicial tiene texto, JSON y HTML; LCOV u otro formato adicional debe incorporarse si el gate lo necesita.
- [x] Generar reportes de análisis, no solo imprimir comandos o conservar una captura vacía.
- [x] Subir los artefactos que existan aun si falló una prueba o un control. Identificar lo que no pudo generarse por un fallo anterior.
- [x] Crear un resumen de ejecución con aprobadas, fallidas, omitidas, coberturas, análisis, versión y resultado.
- [x] Evitar que `continue-on-error`, `|| true`, un paso omitido o un código de salida perdido produzcan verde engañoso.
- [x] Distinguir los jobs sin servicios externos de los que requieren secretos de testing; no exponer secretos a código no confiable.
- [x] Publicar y ejecutar el workflow en GitHub. Guardar su URL, SHA y resultado real.

### Verificar y cumplir

- [x] Un cambio dispara CI según la configuración declarada.
- [x] Los jobs realmente ejecutan las suites y build del proyecto.
- [x] Un fallo de prueba provoca fallo del job y del control que corresponde.
- [x] Los reportes se pueden abrir/descargar y pertenecen a esa ejecución.
- [x] Una prueba externa omitida queda visible como omitida; no se declara aprobada.
- [x] El pipeline base se identifica como base: aún faltan gates definitivos, despliegue, smoke y cargas para el ciclo integral.

**Cierre E02:** [REGISTRO_EJECUCION_E02.md](REGISTRO_EJECUCION_E02.md), [guía operativa del pipeline](quality/README.md) y [metadata/evidencias](evidencias/e02/ejecuciones-2026-10-21.json). CI normal aprobado y fallo de prueba propagado, con seis ZIP descargados/verificados. Las 14 pruebas de infraestructura se informan aparte de las 94 de producto. El caso externo permanece omitido y los gates completos siguen pendientes de E04.

**Salida y evidencia:** workflow, URL de ejecución, reportes automáticos y resumen.
**No cerrar si:** solo funciona localmente, no hay una ejecución remota o los reportes se copiaron a mano desde la auditoría anterior.

## 9. E03 — Defecto real de lectura completa, rojo/verde y regresión

**Objetivo:** corregir DEF-DAT-001 y utilizar su detección para demostrar un fallo real, su corrección y el contraste de pipeline.  
**Entrada:** E02 y ficha de DEF-DAT-001.  
**Requisitos relacionados:** R05, R06, R11, R13, R14, R18.

**Cierre:** 27/27 controles verificados. [Ficha E03](REGISTRO_EJECUCION_E03.md), [rojo real](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39672114249), [verde](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39673351642) y [evidencias](evidencias/e03/ejecuciones-2026-10-21.json). Código corregido `3bfe156…`; 136 pruebas de producto aprobadas, una externa omitida, 14 de infraestructura aprobadas. Siguiente etapa: E04.

### 9.1. Definir los casos antes de corregir

- [x] Asociar el requisito R-DAT-01 y un identificador de caso a cada prueba nueva.
- [x] Preparar datos sintéticos; no descargar datos personales reales para unitarias.
- [x] Incorporar un caso con más de 3.000 filas y un resultado completo conocido.
- [x] Cubrir ambas rutas de lectura afectadas: objetos de deuda y personas, incluyendo sus relaciones.
- [x] Definir orden estable por clave y comprobar ausencia de omisiones o duplicados.
- [x] Fijar el comportamiento esperado ante un error en una página intermedia: no presentar un conjunto parcial como si fuera completo.
- [x] Definir tamaños de página compatibles con los límites efectivos del servicio; un límite pedido por el cliente no garantiza que el servidor entregue esa cantidad.

| Caso mínimo | Entrada o condición | Resultado esperado |
| --- | --- | --- |
| DAT-01 | Conjunto vacío. | Lista vacía válida y fin de lectura. |
| DAT-02 | Menos de una página. | Todas las filas, sin consulta infinita. |
| DAT-03 | Exactamente una página completa. | Todas las filas y terminación correcta. |
| DAT-04 | Más de una página, última parcial. | Recuperación completa y orden estable. |
| DAT-05 | Total múltiplo exacto del tamaño. | Sin omisiones, duplicados ni bucle. |
| DAT-06 | Más de 3.000 filas, total conocido. | Total completo, sin el truncamiento actual. |
| DAT-07 | Error en una página posterior. | Error/alerta según contrato; no éxito silencioso con datos parciales. |
| DAT-08 | Relaciones de distintas páginas. | Mapeo y agregados coherentes con todas las filas. |

Los casos DAT-01–08 están implementados y aprobados; DAT-06 conserva su rojo previo. Ver [aceptación y resultados](CASOS_E03_LECTURA_COMPLETA.md) y [ficha E03](REGISTRO_EJECUCION_E03.md). DAT-09–14 complementan los negativos del lector.

### 9.2. Conservar el rojo real

- [x] Ejecutar la prueba de recuperación completa sobre el comportamiento anterior a la corrección.
- [x] Confirmar que falla por pérdida de filas y no por un mock mal construido, import roto o configuración ausente.
- [x] Conservar el commit con la prueba y el comportamiento defectuoso.
- [x] Ejecutar esa versión en CI y guardar URL, log y aserción fallida.
- [x] Vincular la evidencia a DEF-DAT-001. Evitar fusionar una versión roja como versión final de entrega.

### 9.3. Corregir y conservar el verde

- [x] Implementar recuperación paginada de base o una solución equivalente que cubra el conjunto autorizado completo.
- [x] Mantener contrato de datos/advertencias compatible o documentar y probar cualquier cambio necesario.
- [x] Evitar sustituir 3.000 por otro límite fijo grande: eso no garantiza completitud.
- [x] Ejecutar la misma prueba que falló y verificar su aprobación.
- [x] Ejecutar casos límite/negativos, regresión, build y análisis pertinentes.
- [x] Medir la cobertura de las nuevas ramas y del código nuevo; enlazar con E04.
- [x] Conservar commit de corrección y ejecución verde de CI.
- [x] Medir antes/después sobre el mismo dataset sintético: recuperadas/esperadas, omisiones y duplicados.
- [x] Actualizar el defecto con causa, corrección, evidencia y regresión. Su cierre requiere el alcance completo afectado.

### Verificar y cumplir

- [x] El rojo y el verde usan el mismo criterio de aceptación.
- [x] La corrección cambia el comportamiento productivo defectuoso; no debilita la aserción para aprobar.
- [x] Existe recuperación completa con más de 3.000 registros en la prueba.
- [x] La regresión anterior permanece aprobada; el nuevo total puede superar 94.
- [x] Hay evidencia de CI fallido por este problema real y CI aprobado tras corregirlo.
- [x] Los resultados sintéticos no se describen como importes comprobados en la interfaz real.

**Salida y evidencia:** pruebas, corrección, comparación antes/después, defecto actualizado y dos ejecuciones vinculadas.  
**No cerrar si:** se fabricó un fallo, solo se aumentó el límite fijo, quedó una ruta sin corregir o no se conservó evidencia del rojo.

## 10. E04 — Quality gates completos y comprobados

**Objetivo:** bloquear automáticamente los incumplimientos exigidos por la consigna.  
**Entrada:** E01–E03.  
**Requisitos relacionados:** R07–R10, R17.

### 10.1. Contrato del gate

- [ ] Resolver **OBS-COB-001**: con Vitest 4.1.12 la cobertura frontend actual es **57,96 %** tras E03 (E01/E02: 45,96 %). Ampliar pruebas significativas hasta al menos 60 % dentro del alcance declarado antes de cerrar E04; mantener el nuevo método y el umbral. No usar la cifra histórica ni recortar archivos sin cobertura para aprobar.

| Control | Criterio de aceptación | Debe fallar cuando |
| --- | --- | --- |
| Build y pruebas | Compilación y suites obligatorias aprobadas. | Una compilación o prueba requerida falla. |
| Existente frontend | Sentencias >= 60 % dentro del alcance declarado. | Menor a 60 % o reporte requerido ausente/inválido. |
| Existente backend | Sentencias >= 60 % dentro del alcance declarado. | Menor a 60 % o reporte requerido ausente/inválido. |
| Código nuevo | >= 80 % de líneas ejecutables nuevas/cambiadas cubiertas. | Menor a 80 %, base irresoluble o datos necesarios ausentes. |
| Duplicación | <= 5 % de líneas duplicadas. | Mayor a 5 % o reporte requerido ausente/inválido. |
| Bugs críticos | Cero hallazgos críticos abiertos dentro del criterio definido. | Aparece un bug clasificado crítico por el mecanismo documentado. |
| Análisis estático | Criterios de errores/reglas y severidades explícitos. | Se incumple una condición bloqueante definida. |

El umbral de 80 % se aplica al código nuevo, no al total histórico ni al número de tests. Las ramas se reportan como medida complementaria de decisiones; no se inventa un umbral de ramas exigido por la consigna. Si el equipo adopta uno adicional, identificarlo como decisión propia.

### 10.2. Medición de código nuevo

- [ ] Registrar como base fija del TP el commit de producto revisado `531996f51243dc3d4c5a607338e2f35e32313f6b`, salvo una decisión distinta justificada y versionada antes de medir.
- [ ] Obtener historia suficiente para resolver la base y el diff en CI.
- [ ] Mapear líneas ejecutables añadidas/cambiadas a los reportes frontend y backend; excluir líneas eliminadas del denominador nuevo.
- [ ] Incluir archivos productivos nuevos; tratar renombres, rutas y separadores de Windows/Linux de forma coherente.
- [ ] Reportar cubiertas, ejecutables y porcentaje nuevo, preferentemente separado por módulo para evitar que uno oculte al otro.
- [ ] Si no hay líneas productivas nuevas ejecutables, informar «no aplica, 0 líneas nuevas»; no inventar 100 % ni aprobar un reporte roto.
- [ ] No cambiar la base a HEAD para vaciar el diff cuando la cobertura es insuficiente.
- [ ] Si también se usa merge-base para PR, distinguir esa medición incremental de la base fija de evaluación del TP.

### 10.3. Bugs críticos y pruebas del mecanismo

- [ ] Elegir un analizador con severidades o un clasificador versionado y documentado que produzca un resultado procesable.
- [ ] Definir qué se considera bug crítico y cómo se evalúan hallazgos sin severidad nativa. No atribuir severidad crítica automática a todas las reglas Ruff ni asegurar ausencia total de bugs porque pasan unitarias.
- [ ] Mantener separados bugs funcionales, vulnerabilidades de dependencias y avisos informativos. Definir el tratamiento de cada conjunto.
- [ ] Probar el gate con entradas controladas: 79,99 % nuevo falla; 80 % pasa; duplicación > 5 % falla; 5 % pasa; un crítico bloquea; reporte ausente no pasa.
- [ ] Verificar que el código de salida llegue al estado del workflow.
- [ ] Conservar reporte del gate con base, SHA, criterios y decisión por control.
- [ ] Ejecutar nuevamente CI sobre el producto corregido.

Los ensayos controlados del evaluador prueban que el gate funciona. No sustituyen la ejecución fallida por un defecto real de E03.

**Salida y evidencia:** configuración/scripts de gate, pruebas de sus límites, reporte y CI que bloquee de verdad.  
**No cerrar si:** se mide solo cobertura global, el umbral está escrito pero no se aplica, se ignoran fallos o se cambia el denominador para aprobar.

## 11. E05 — Casos, defectos y trazabilidad durante todo el trabajo

**Objetivo:** que cada problema y verificación pueda seguirse desde el requisito hasta su cierre.  
**Entrada:** registro inicial; comenzar junto con E00 y mantener hasta E11.  
**Requisitos relacionados:** R03, R05, R06, R12–R14, R24.

### Tareas

- [ ] Formalizar el soporte elegido en E00. Jira es una opción; la consigna admite otra herramienta. Si se utiliza GitHub Issues, guardar URLs reales e identificadores y enlazarlos al registro.
- [ ] Conservar los IDs DEF-DAT-001 y DEF-SUP-001 y asociarlos a los casos implementados, commits y ejecuciones.
- [ ] Crear una plantilla de caso con ID, requisito, objetivo, nivel, técnica, precondiciones, entrada, pasos, resultado esperado, resultado obtenido, entorno, fecha y evidencia.
- [ ] Crear una plantilla de defecto con ID, caso origen, severidad/prioridad justificadas, versión, pasos, esperado/obtenido, evidencia, responsable, estado, corrección y regresión.
- [ ] Documentar clases de equivalencia y valores límite de casos realmente ejecutados.
- [ ] Crear al menos una tabla de decisión con combinaciones y resultados que correspondan a código real y estén vinculadas a pruebas.
- [ ] Sustituir resultados vagos como «aplicar la regla definida» por salidas verificables.
- [ ] Mantener estados: abierto, reproducido, en corrección, corregido pendiente de validación, cerrado o reabierto, según corresponda.
- [ ] Incorporar una prueba de regresión por cada defecto que se declare corregido.
- [ ] Registrar la participación real de cada integrante mediante commits/documentos o actividades identificadas; no inventar autorías.

### Verificar y cumplir

- [ ] Se puede navegar requisito → caso → resultado → defecto → commit → regresión.
- [ ] Un caso aprobado tiene una ejecución identificable; un caso propuesto no figura como ejecutado.
- [ ] Un defecto cerrado tiene corrección y validación posterior, no solo una descripción.
- [ ] Los pendientes conservan estado, impacto y siguiente acción.
- [ ] Si no se utiliza Jira, el informe identifica claramente el soporte efectivamente usado.

**Salida y evidencia:** plantillas utilizadas, registro actualizado, tabla de trazabilidad y enlaces reales a la herramienta elegida.  
**No cerrar si:** existen tickets sin esperado/obtenido, cierres sin regresión o enlaces inventados.

## 12. E06 — Supabase aislado, autorización y cliente real

**Objetivo:** comprobar la integración de aplicación con un Supabase real de testing y tratar DEF-SUP-001 con regresión.  
**Entrada:** E00–E02, snapshot observado y acceso a un entorno aislado.  
**Requisitos relacionados:** R06, R13, R14, R16, R17.

### 12.1. Preparar el entorno y el contrato

- [ ] Identificar y registrar URL/referencia del entorno de testing, separada de la cartera conectada investigada.
- [ ] Elegir cómo provisionarlo y registrar recursos/costos reales si los hubiera antes de crear recursos que los generen. La conexión del plugin no demuestra que ya exista testing.
- [ ] Preparar esquema, restricciones y políticas a partir del modelo observado, revisando el SQL necesario. El snapshot JSON no es un instalador.
- [ ] Utilizar la skill Supabase y documentación vigente al implementar. Si se usa CLI, descubrir comandos con `--help`; no inventar comandos o nombres de migración.
- [ ] Versionar los cambios de esquema/políticas y un procedimiento de preparación del entorno, separando estado observado, propuesta y cambio aplicado.
- [ ] Crear datos sintéticos identificables: al menos tenants A/B, usuarios autorizados por tenant, usuario sin pertenencia activa y una cartera pequeña de valores conocidos.
- [ ] Definir datos esperados para cada usuario. La lectura positiva debe comprobar filas conocidas, no solo que la respuesta sea un array vacío sin error.
- [ ] Establecer alta/limpieza reproducibles de las fixtures, sin afectar datos ni cuentas ajenos al ensayo.
- [ ] Configurar secretos de testing en local/CI. No poner service role en frontend, capturas, JSON de evidencias ni logs.
- [ ] Usar una clave pública/publicable y una sesión de usuario normal para comprobar Auth y lectura de aplicación; una consulta administrativa no prueba RLS del usuario.

La prueba existente utiliza estas variables, cuyos nombres se conservan o se actualizan junto con su documentación: `SUPABASE_TEST_ENABLED`, `SUPABASE_TEST_URL`, `SUPABASE_TEST_PUBLISHABLE_KEY`, `SUPABASE_TEST_EMAIL`, `SUPABASE_TEST_PASSWORD`. Casos adicionales pueden requerir otras identidades de testing; registrar los nombres de configuración, no sus valores.

### 12.2. Corregir y comprobar autorización

- [ ] Conservar la evidencia roja de SUP-RLS-02 y reproducir el criterio sobre el entorno de testing preparado.
- [ ] Definir la pertenencia activa como condición de acceso a datos de negocio y las relaciones necesarias para filas sin tenant directo.
- [ ] Clasificar tablas de negocio y catálogos compartidos. No reemplazar todas las políticas con un mismo predicado sin revisar el modelo.
- [ ] Asegurar que el lookup de `public.user`/`tenant_user` usado por la aplicación funciona con acceso limitado y sin recursión de políticas.
- [ ] Comprobar objetos, deudas, personas, contactos, relaciones y perfiles; restringir solo `debtor` no prueba aislamiento de los datos relacionados.
- [ ] Mantener explícita la política de escritura. Un GRANT observado no equivale a permiso efectivo de escritura por RLS.
- [ ] Revisar los avisos de Security Advisors y clasificar tratamiento. La función `rls_auto_enable` es un event trigger; no ejecutar RPCs privilegiados para intentar explotar el aviso.
- [ ] Ejecutar advisors después de cambios aplicados y conservar el resultado junto con pruebas de negocio: no sustituyen estas pruebas.
- [ ] Repetir el caso rojo y comprobar cero filas de negocio sin pertenencia.
- [ ] Registrar el estado por entorno. Una corrección aplicada solo en testing no significa que el proyecto conectado original ya esté corregido.

### 12.3. Casos reales mínimos

| Caso | Condición | Esperado |
| --- | --- | --- |
| SUP-AUTH-01 | Credenciales válidas de testing. | Usuario autenticado y contexto de aplicación esperado. |
| SUP-AUTH-02 | Credenciales inválidas de testing. | Rechazo controlado, sin autorizar datos. |
| SUP-DATA-02 | Usuario A con pertenencia activa. | Recupera las filas sintéticas conocidas de A. |
| SUP-RLS-01 | Cliente anónimo. | Cero filas de negocio. |
| SUP-RLS-02 | Identidad sin pertenencia válida. | Cero filas de negocio; caso del defecto existente. |
| SUP-RLS-03 | Usuario A consulta filas de B. | Sin acceso a filas de B. |
| SUP-RLS-04 | Usuario B consulta filas de A. | Sin acceso a filas de A. |
| SUP-RLS-05 | Pertenencia inactiva. | Acceso de negocio denegado. |
| SUP-AUTH-03 | Cierre de sesión. | Sesión finalizada y siguiente acceso protegido denegado. |

Los nuevos casos se implementarán y ejecutarán; los IDs no indican por sí solos aprobación. Las pruebas SQL por rol y las HTTP con JWT válido deben identificarse por separado.

### 12.4. Integrar en CI

- [ ] Mantener las pruebas aisladas ejecutables sin credenciales externas.
- [ ] Crear un job/ejecución obligatoria para integración real de la entrega.
- [ ] Si faltan secretos en esa ejecución obligatoria, fallar indicando configuración ausente; no completar la entrega con el caso omitido.
- [ ] Usar un evento/contexto confiable para los secretos de testing. Un PR sin acceso a secretos puede conservar una omisión explícita, pero necesita luego la ejecución real obligatoria.
- [ ] Guardar reporte con proyecto de testing, fecha, SHA, casos y esperado/obtenido, sin credenciales ni tokens.
- [ ] Documentar condiciones de indisponibilidad externa y comportamiento del pipeline.

### Verificar y cumplir

- [ ] Hay Auth y lectura reales desde el cliente, sin mocks y sin credencial administrativa que evada RLS.
- [ ] Se comprueba acceso positivo a datos conocidos y rechazo de accesos no autorizados.
- [ ] El defecto RLS tiene resultado antes/después en el entorno declarado y su regresión permanece automatizada.
- [ ] Se conserva la distinción entre corrección en testing y eventual aplicación al proyecto conectado.
- [ ] Las pruebas existentes de frontend/backend siguen aprobando después de cambios necesarios.
- [ ] La integración real requerida no está omitida en la ejecución final.

**Salida y evidencia:** entorno preparado, SQL/configuración versionados, fixtures sintéticas, reportes reales y estado de DEF-SUP-001 por entorno.  
**No cerrar si:** solo se usó MCP administrativo, solo hubo simulación SQL, el caso positivo acepta cualquier vacío, falta comprobar pertenencia o se conserva un skip en la validación final.

## 13. E07 — Despliegue nuevo y smoke posterior automático

**Objetivo:** demostrar que una versión desplegada funciona en su recorrido básico y que esa comprobación ocurre después del despliegue.  
**Entrada:** E04 y E06, configuración de despliegue y usuario/datos de testing.  
**Requisitos relacionados:** R17–R19, R24, R25.

### Tareas

- [ ] Identificar proveedor y proyecto de hosting reales; Vercel es el hosting descrito en el avance. Verificar configuración efectiva al implementar.
- [ ] Definir entorno de preview/testing asociado a Supabase de testing y variables correspondientes.
- [ ] Conectar pruebas/gates con el despliegue mediante jobs o workflows relacionados, sin perder la asociación al mismo commit.
- [ ] Obtener la URL del despliegue recién generado y comprobar su disponibilidad con timeout acotado.
- [ ] Evitar ejecutar el smoke contra una URL antigua mientras el nuevo despliegue todavía se está preparando.
- [ ] Implementar un smoke automatizado ejecutable con un comando, usando navegador cuando el comportamiento dependa de JavaScript, Auth y navegación.
- [ ] Comprobar login de testing, llegada al dashboard, datos conocidos y navegación a objetos o personas.
- [ ] Comprobar una interacción básica relevante, como filtro o paginación, y cierre de sesión.
- [ ] Detectar un error visible, una página vacía inesperada o un estado de validación que nunca termina; HTTP 200 por sí solo no basta.
- [ ] Asociar capturas/trazas y resultado a la URL y SHA probados. Utilizar únicamente datos sintéticos en imágenes de evidencia.
- [ ] Hacer fallar la verificación de despliegue si falla el smoke. Conservar diagnóstico y documentar recuperación/rollback del entorno.
- [ ] Ejecutar el smoke automáticamente en cada despliegue del flujo declarado, no solo una vez manualmente.

### Casos básicos y aceptación

| Paso | Comprobación |
| --- | --- |
| Disponibilidad | Nueva URL accesible antes del timeout definido. |
| Acceso | Login de testing correcto; estado autenticado resuelto. |
| Pantalla principal | Dashboard con datos sintéticos esperados, sin error crítico visible. |
| Navegación | Listado protegido accesible y una interacción básica correcta. |
| Cierre | Sesión finalizada y acceso protegido denegado posteriormente. |

Definir el timeout y los datos exactos antes de ejecutar. Esto es un recorrido smoke acotado; no obliga a implementar todas las combinaciones E2E del Nivel 3.

### Verificar y cumplir

- [ ] Existe un despliegue nuevo vinculado al commit evaluado.
- [ ] El pipeline ejecuta el smoke después de que esa versión esté disponible.
- [ ] El recorrido usa la configuración de testing real y datos conocidos.
- [ ] Queda resultado procesable además de capturas opcionales.
- [ ] El comando permite repetirlo especificando URL y configuración externa.

**Salida y evidencia:** despliegue, URL, SHA, comando, workflow y reporte de smoke.  
**No cerrar si:** solo se hizo GET a `/health`, solo se probó localmente o se usó un despliegue distinto del declarado.

## 14. E08 — Estrés y esfuerzo sostenido con reportes de pipeline

**Objetivo:** producir evidencia de rendimiento sobre operaciones representativas en un entorno controlado, con umbrales fijados previamente.  
**Entrada:** E02 y entorno/dataset aislados; E03/E06 según el componente.  
**Requisitos relacionados:** R11, R17, R20, R21, R25.

### 14.1. Definir qué se está midiendo

- [ ] Elegir un componente y operación reales, por ejemplo agrupación/scoring o consultas de cartera de la web.
- [ ] Evitar una respuesta HTTP fija que no ejecute lógica productiva. Si se usa una fuente sintética local, conservar el procesamiento real y describir esa sustitución.
- [ ] No usar únicamente `/health` para concluir que el procesamiento de cartera soporta carga.
- [ ] Registrar qué dependencia es real y cuál está sustituida. La API FastAPI no aparece consumida por la web actual; medirla no equivale a medir el dashboard desplegado.
- [ ] Fijar dataset reproducible, cantidad de objetos/deudas, filtros y mezcla de solicitudes.
- [ ] Registrar hardware/runner, sistema, runtime, configuración del servidor, número de workers y versión del producto.
- [ ] Limitar el ensayo al entorno de pruebas elegido. No lanzar las cargas sobre la cartera conectada por el plugin.
- [ ] Definir calentamiento, concurrencias, duración, política de parada y criterios de aceptación antes de ejecutar.

### 14.2. Escenarios y umbrales propuestos para preparar

La siguiente tabla es una **propuesta de diseño**, no una medición ni un SLA acordado con usuarios municipales. Adoptarla o ajustarla justificadamente antes de ejecutar y conservar la versión usada.

| Escenario | Propuesta inicial | Criterio a fijar |
| --- | --- | --- |
| Calentamiento / referencia | Carga baja, por ejemplo 1 usuario durante 30 segundos, excluida del resumen principal. | Servidor listo y respuestas funcionales válidas. |
| Estrés progresivo | Escalones de 1, 5, 10, 20 y 40 usuarios, por ejemplo 60 segundos por escalón. | Registrar degradación y límite observado. Fijar la carga objetivo antes de exigir un SLO. |
| Operación objetivo | Por ejemplo 10 usuarios concurrentes. | Propuesta: p95 <= 2.000 ms y errores inesperados <= 1 %, a justificar para el entorno. |
| Esfuerzo sostenido | Por ejemplo 10 usuarios durante 10 minutos tras calentamiento. | Mismos umbrales de operación, consistencia de resultados y seguimiento temporal. |
| Parada controlada | Condición de errores/indisponibilidad o recursos fijada antes del ensayo. | Guardar reporte parcial y causa de parada; no ocultar la interrupción. |

En estrés, exceder el SLO por encima de la carga objetivo puede ser el límite que se busca observar. No se cambia retrospectivamente el objetivo para aprobar. Si el ensayo termina sin saturación, informar «límite no alcanzado hasta la carga ensayada», sin inventar un punto de ruptura.

### 14.3. Implementar y ejecutar

- [ ] Elegir herramienta apropiada y registrar su versión. Si se utiliza como herramienta nueva de R22, iniciar la evaluación de E09 antes de incorporarla.
- [ ] Crear escenarios o comandos diferenciados para estrés y esfuerzo sostenido.
- [ ] Validar contenido funcional y status de las respuestas, no solo latencia.
- [ ] Generar resumen y serie temporal con muestras, p50/p95/p99 cuando corresponda, errores, throughput y duración real.
- [ ] Registrar consumo de recursos si el entorno permite medirlo; declarar explícitamente lo no medido. No afirmar ausencia de fugas de memoria sin evidencia.
- [ ] Ejecutar ambos escenarios y conservar configuración, datos, logs y reportes.
- [ ] Analizar el resultado frente al criterio previo; describir incumplimientos y limitaciones del entorno.
- [ ] Si se realiza una mejora, repetir con condiciones comparables para demostrar antes/después.
- [ ] Integrar la ejecución y generación de reportes en el pipeline. Puede existir una ejecución integral/manual de release para cargas más largas; no presentarla como ejecutada en cada PR si no lo está.
- [ ] Publicar reportes aun cuando un umbral no se cumpla o se interrumpa el ensayo.

### Verificar y cumplir

- [ ] Hay dos escenarios ejecutados: progresivo y sostenido, con duraciones reales registradas.
- [ ] Los umbrales tienen una versión anterior a la ejecución y los resultados se interpretan contra ella.
- [ ] Se mide lógica representativa del componente declarado.
- [ ] El pipeline genera los reportes de carga exigidos; no solo sube un reporte local antiguo.
- [ ] Se puede repetir cada escenario con un comando y el mismo dataset.
- [ ] Se distingue capacidad observada del componente, comportamiento de Supabase externo y experiencia de la web.

**Salida y evidencia:** scripts, parámetros previos, dataset/seed, reportes automáticos, ejecución de pipeline y análisis.  
**No cerrar si:** existe solo un plan sin ejecución, falta el escenario sostenido, se inventaron umbrales después de ver resultados o se generaliza una prueba de health a todo EQUITAS.

## 15. E09 — Herramienta, métricas y documentación transversal

**Objetivo:** cubrir los ejes de proceso/calidad que deben acompañar las pruebas y preparar material verificable para el PDF.  
**Entrada:** documentos existentes; avanza junto con E01–E08.  
**Requisitos relacionados:** R02–R06, R11–R13, R15, R22.

### 15.1. Herramienta incorporada mediante cinco pasos

Elegir una herramienta realmente incorporada al trabajo. Una herramienta de carga de E08 permite documentar el proceso durante su adopción. Si se utiliza Vitest u otra incorporada en el avance recibido, identificar como retrospectiva cualquier reconstrucción de la decisión, sin inventar fechas o evaluaciones anteriores.

- [ ] **Requisitos:** problema a resolver, stack, ejecución local/CI, formatos, esfuerzo y limitaciones.
- [ ] **Alternativas:** investigar opciones y conservar referencias primarias vigentes y criterios relevantes.
- [ ] **PoC:** ejecutar un caso pequeño del propio EQUITAS y conservar comando, configuración, resultado y dificultad encontrada.
- [ ] **Matriz de decisión:** fijar criterios/pesos antes de puntuar; puntuaciones justificadas con la PoC o documentación.
- [ ] **Adopción incremental:** describir incorporación inicial, extensión al caso representativo, integración CI y mantenimiento de configuración.
- [ ] Guardar herramienta/versión elegida y razones. No agregar herramientas solo para aumentar la lista.

Ejemplo de criterios/pesos para adaptar: compatibilidad 25 %, automatización CI 20 %, reportes 20 %, facilidad de uso 15 %, reproducibilidad 10 %, costo/licencia 10 %. Suman 100 %. Son una propuesta de valoración, no resultados ya obtenidos. Las puntuaciones quedan pendientes hasta evaluarlas.

**Entregable propuesto:** documento de herramienta con cinco apartados, PoC real, matriz completa y referencias; por ejemplo `HERRAMIENTA_INCORPORADA_CALIDAD.md`.

### 15.2. Métricas y mejora antes/después

- [ ] Separar métricas de producto, proceso y proyecto, con fórmula, alcance, fecha y versión.
- [ ] Reportar sentencias, ramas y funciones cuando existan; distinguir la cobertura combinada backend.
- [ ] Conservar el antecedente histórico 12,03 % → 60,43 % frontend y 26,83 % → 85,26 % backend, con su fuente y límites de reproducción.
- [ ] Incorporar la mejora de completitud de lectura de E03 sobre el mismo dataset sintético.
- [ ] Registrar análisis estático antes/después cuando se hayan aplicado correcciones, sin afirmar una mejora que solo cambió reglas o alcance.
- [ ] Incluir como métrica de proceso, por ejemplo aprobadas/ejecutadas, separando omitidas. En la base: 94/94 = 100 % y una prueba adicional omitida.
- [ ] Incluir como métrica de proyecto, por ejemplo tamaño analizado. En la base: 62 archivos y 11.188 líneas productivas del análisis de duplicación.
- [ ] Explicar la duplicación por líneas; el 5,16 % de tokens duplicados de la base es otra medida distinta del 4,24 % por líneas.
- [ ] Usar los nuevos valores finales cuando cambie el producto, conservando la evolución histórica.

### 15.3. ISO 25010, riesgos y proceso

- [ ] Completar la matriz del modelo de ocho características solicitado: adecuación funcional, eficiencia de desempeño, compatibilidad, usabilidad, fiabilidad, seguridad, mantenibilidad y portabilidad.
- [ ] Para cada característica: objetivo concreto, métrica, aceptación, evidencia y estado. «Aplicación en EQUITAS» por sí sola no es una evaluación completa.
- [ ] Mantener y justificar el top 3 del MVP: adecuación funcional, seguridad y fiabilidad, con el orden que se adopte explícitamente.
- [ ] No declarar usabilidad municipal, accesibilidad completa o seguridad total verificadas sin ensayos que lo respalden. Estas limitaciones se informan; no convierten por sí mismas toda mejora futura de la tesis en requisito nuevo del TP.
- [ ] Unificar la escala de riesgos. Propuesta coherente con el técnico: 15–25 crítica, 10–14 alta, 5–9 media y 1–4 baja; conservar P/I como estimaciones del equipo.
- [ ] Actualizar riesgos de Supabase, autorización, truncamiento, datos ETL, despliegue y regresión después de las correcciones.
- [ ] Diferenciar QA preventivo —plan, criterios, revisión— de QC detectivo —pruebas, análisis, mediciones— con ejemplos del trabajo.
- [ ] Completar contingencia Supabase: detección, contención, comunicación, recuperación y verificación, sin afirmar restauraciones o backups ensayados si no se hicieron.
- [ ] Mostrar la pirámide/mapa de pruebas con cantidades actuales y límites: unitarias/componentes, API/integración, smoke y externas.
- [ ] Aplicar los siete principios con evidencia: presencia de defectos, imposibilidad de exhaustividad, pruebas tempranas, agrupamiento, renovación de casos, contexto y falacia de ausencia de errores.
- [ ] Incluir un ejemplo AAA real, particiones/límites reales y una tabla de decisión ejecutada. Vincularlos a E05.

### Verificar y cumplir

- [ ] La herramienta tiene los cinco pasos y una matriz justificada, no solo una enumeración de nombres.
- [ ] Hay una métrica de proceso, una de proyecto y una mejora antes/después con evidencia comparable.
- [ ] ISO incluye las ocho características y el top 3 con justificación.
- [ ] Riesgos, QA/QC, principios y niveles corresponden al proyecto actual.
- [ ] Los pendientes no se presentan como características aprobadas.

**Salida y evidencia:** documento de herramienta, matriz, métricas, plan/ISO/riesgos/técnicas actualizados y fuentes listas para el informe.  
**No cerrar si:** se inventa una PoC, una fecha de decisión o una validación municipal; faltan fórmulas o se mezclan distintos indicadores de cobertura.

## 16. E10 — Informe académico completo y PDF revisado

**Objetivo:** entregar un documento único y entendible, con cifras coherentes con la ejecución final.  
**Entrada:** E03–E09 verificadas o con limitaciones explícitamente registradas. Una obligación técnica pendiente no se vuelve cumplida por escribirla en el PDF.  
**Requisitos relacionados:** R01–R06, R11–R24.

### 16.1. Conservar y corregir la base recibida

- [ ] Mantener carátula, introducción y contenido aprovechable de `tp-Calidad.md`.
- [ ] Completar nombres/datos académicos que falten. No inventar legajos, docente u otros datos.
- [ ] Conservar la preferencia de informe sin índice.
- [ ] Aclarar arquitectura: la web consulta Supabase; no dibujar consumo de FastAPI desde la web como flujo implementado si sigue sin existir.
- [ ] Mantener Nivel 2 como avance declarado, no como afirmación de que ya están aprobados todos sus requisitos.
- [ ] Reemplazar CP-01 a CP-04 ilustrativos por casos implementados con resultados verificables.
- [ ] Corregir la distinción 85,26 % de sentencias / 80,91 % combinada backend.
- [ ] Unificar riesgos, nombres de casos, defectos y denominadores con la documentación técnica actualizada.

### 16.2. Completar desde QA/QC

- [ ] Agregar automatización, workflow y criterios exactos de gate.
- [ ] Agregar pipeline rojo y verde con SHA, causa y enlaces.
- [ ] Describir integración real de aplicación y distinguirla de mocks e investigación por plugin.
- [ ] Describir smoke posterior al despliegue con URL, versión y resultado.
- [ ] Incorporar estrés y esfuerzo sostenido: entorno, dataset, parámetros previos, umbrales, resultados y límites.
- [ ] Incluir gestión de defectos y trazabilidad de los casos seleccionados.
- [ ] Desarrollar la herramienta de cinco pasos y matriz de decisión.
- [ ] Presentar evolución de métricas con fecha y alcance; las nuevas pruebas pueden cambiar el total y porcentajes.
- [ ] Añadir tabla final de metas cumplidas/no cumplidas y evidencia por cada una.
- [ ] Redactar análisis crítico: qué confianza aportan las pruebas, qué no cubren y qué riesgos quedan.
- [ ] Redactar conclusiones sobre los resultados finales, sin asegurar ausencia total de defectos o preparación productiva completa.
- [ ] Agregar mapa breve de herramientas y anexos/enlaces útiles del repositorio.

### 16.3. Evidencia visual y exportación

- [ ] Usar capturas de ejecuciones del propio proyecto, no imágenes inventadas de terminal/pipeline.
- [ ] Generar gráficos únicamente a partir de datos reales identificados. Etiquetar eje, unidad, fechas y alcance.
- [ ] Diferenciar capturas históricas de capturas de la versión final. No etiquetar una imagen de 94 pruebas como resultado actual si la suite ya cambió.
- [ ] Elegir capturas legibles; varias recibidas tienen unos 600 píxeles de ancho y pueden necesitar reemplazo por exportaciones nuevas.
- [ ] Evitar incluir credenciales, tokens o datos personales reales en capturas.
- [ ] Conservar fuente editable, documento de generación si se usa y PDF final dentro de la estructura de entrega elegida.
- [ ] Al crear documentos/PDF usar las skills correspondientes y su flujo de renderizado/revisión visual.
- [ ] Revisar todas las páginas exportadas: tablas completas, títulos, cortes, pies de figura, caracteres y enlaces.
- [ ] Comprobar que los números coincidan con los artefactos de CI y que las conclusiones respondan a esos números.

**Salida y evidencia:** fuente académica consolidada, PDF revisado y tabla de cumplimiento con referencias reales.  
**No cerrar si:** faltan secciones obligatorias, un «pendiente» está presentado como aprobado, las capturas contradicen las cifras o el PDF todavía no se abrió/renderizó para revisarlo.

## 17. E11 — Validación integral, entrega y defensa

**Objetivo:** comprobar el conjunto sobre una versión identificada y preparar una demostración que el equipo pueda repetir y explicar.  
**Entrada:** etapas anteriores cerradas y PDF revisado.  
**Requisitos relacionados:** R17–R25 y revisión de todos los R01–R25.

### Tareas

- [ ] Preparar un checkout o entorno limpio de la versión candidata, respetando cambios existentes del usuario.
- [ ] Instalar usando las versiones y configuración documentadas.
- [ ] Ejecutar el ciclo completo: build, suites, análisis, cobertura, gates, integración real, despliegue/smoke y cargas que correspondan.
- [ ] Conservar una ejecución integral verde sobre el SHA candidato. Los jobs obligatorios no pueden estar omitidos para esa ejecución final.
- [ ] Vincular la ejecución roja de E03 y explicar el defecto que detectó. Ambas evidencias pueden ser de commits distintos, cuya relación debe quedar clara.
- [ ] Verificar que el despliegue nuevo y su smoke corresponden al mismo SHA declarado para esa validación.
- [ ] Comprobar que los reportes de carga fueron generados por el pipeline y que su componente/entorno se declara.
- [ ] Reconciliar las métricas del PDF con la ejecución final; actualizar el PDF si hubo cambios posteriores de código/pruebas.
- [ ] Revisar que scripts, workflows, casos, configuraciones no secretas, plantillas, documentación y PDF están efectivamente versionados/publicados según la entrega elegida.
- [ ] Revisar permanencia/accesibilidad de URLs y artefactos; guardar un manifiesto portable con identificadores y resultados para que no dependan solo de capturas.
- [ ] Preparar un guion de demostración: presentación del MVP, pipeline, defecto rojo/verde, integración, despliegue/smoke, cargas y conclusiones.
- [ ] Ensayar el recorrido sobre datos de testing y conservar los comandos para repetirlo.
- [ ] Cada integrante debe poder explicar qué hace una prueba, cómo se calcula la cobertura, qué bloquea el gate, qué demuestra el rojo/verde y qué límites tienen las cargas y la revisión RLS.
- [ ] Registrar aportes individuales reales y confirmar datos de la entrega.

### Checklist final de entrega

- [ ] Nivel y alcance declarados; objetivos medibles y plan versionado.
- [ ] ISO de ocho características, top 3, riesgos y contingencia.
- [ ] Unitarias AAA, API/integración, técnicas dinámicas y cobertura de decisiones explicadas.
- [ ] 60 % existente y 80 % nuevo verificados con su alcance/base.
- [ ] Análisis, duplicación y bugs críticos controlados por gate automático.
- [ ] Pipeline versionado con ejecución completa verde y roja por problema real.
- [ ] Reportes automáticos de pruebas, cobertura, análisis y estrés accesibles.
- [ ] Integración externa real de aplicación aprobada y no omitida.
- [ ] Smoke desde pipeline después de un despliegue nuevo.
- [ ] Estrés y esfuerzo sostenido ejecutados con parámetros y criterios previos.
- [ ] Casos/defectos en soporte identificado y regresión de cada corrección.
- [ ] Herramienta incorporada con cinco pasos y matriz de decisión.
- [ ] Métricas de producto/proceso/proyecto y mejora antes/después interpretadas.
- [ ] Un comando comprobado para cada clase de prueba.
- [ ] PDF revisado, metas cumplidas/no cumplidas, análisis crítico y conclusiones.
- [ ] Demostración ensayada, enlaces disponibles y aporte individual trazable.

**Salida:** versión entregable identificada, repositorio, PDF, evidencias y demostración.  
**No cerrar si:** alguna obligación está pendiente, faltan pruebas de ejecución o el informe corresponde a otra versión. Si llega la fecha con incumplimientos, registrarlos explícitamente; no declarar que la entrega satisface todo.

## 18. Gestión de evidencias y ficha para cerrar cada etapa

### 18.1. Convención de evidencia

Cada ejecución relevante debe identificar:

- Etapa, caso o defecto relacionado.
- Fecha/hora y zona horaria cuando sea relevante.
- Commit completo y rama/contexto real.
- Entorno: local, CI, testing o despliegue.
- Versiones de runtime/herramientas y configuración/dataset.
- Comando o workflow ejecutado y su URL/ID cuando exista.
- Criterio fijado antes, resultado obtenido y estado aprobado/fallido/omitido.
- Rutas de reportes y límites de lo comprobado.

Los reportes voluminosos regenerables pueden seguir en directorios ignorados y como artefactos de CI. Versionar resúmenes/manifiestos y referencias suficientes; no asumir que un archivo dentro de `.quality/` ya forma parte de la entrega.

Los archivos `evidencias/validacion-2026-10-21.json` y `evidencias/supabase-2026-10-21.json` son snapshots históricos. Agregar nuevas evidencias al evolucionar el producto; no sobrescribirlos para hacerlos coincidir con una versión posterior.

### 18.2. Ficha de ejecución para completar

```text
Etapa:
Estado anterior → estado actual:
Responsable:
Fecha:
Commit/contexto inicial:
Objetivo y criterios fijados antes:
Archivos implementados/modificados:
Comandos o workflows ejecutados:
Resultados: aprobadas / fallidas / omitidas:
Métricas con numeradores, denominadores y alcance:
Evidencias: rutas y URLs:
Defectos afectados y estado por entorno:
Documentos actualizados:
Limitaciones o bloqueos concretos:
Criterios de salida satisfechos / pendientes:
Siguiente etapa habilitada:
```

### 18.3. Pedido reutilizable para comenzar una etapa

```text
Comenzá la etapa EXX del archivo ROADMAP_TP_CALIDAD_SOFTWARE.md.
Usá el estado actual y las evidencias previas del repositorio.
Verificá sus condiciones de entrada, implementá las tareas y ejecutá
las comprobaciones necesarias. Conservá los cambios existentes.
Usá el grafo MCP para descubrir código y el plugin/skill correspondiente
para Supabase u otros servicios cuando intervengan.
Actualizá casos, defectos, evidencias y el estado de la etapa.
No marques tareas completas sin ejecución/evidencia ni inventes resultados.
Al finalizar, completá la ficha de ejecución y explicá qué cambió,
cómo se verificó, qué queda pendiente y qué etapa sigue.
```

## 19. Tabla de comandos que debe quedar completa al entregar

Esta tabla parte de los comandos existentes. Completar los futuros con los nombres efectivos después de implementarlos y comprobarlos desde el directorio indicado.

| Clase | Comando actual o estado | Directorio | Evidencia final requerida |
| --- | --- | --- | --- |
| Preparación local/CI | [Versiones y comandos](REPRODUCIBILIDAD_CALIDAD.md): Node 22.23.2, npm 11.21.1, CPython 3.12.14; `npm ci` y requisitos/constraints Python. | `front` / `back` | Instalaciones nuevas Windows E01 y Linux E02 comprobadas. |
| CI base E02 | Workflow [quality-ci.yml](.github/workflows/quality-ci.yml); push/PR/manual; [operación y descarga](quality/README.md). | GitHub Actions, Ubuntu 24.04. | [Normal aprobada](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39669312471), [fallo controlado](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39669377493), JSON/JUnit/LCOV/HTML y resumen. |
| Regresión E03 | `npm exec --no -- vitest run tests/integration/complete-data.integration.test.ts tests/unit/paginated-table-reader.test.ts` | `front`, con npm 11.21.1. | 42 pruebas; [rojo real](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39672114249) y [verde](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39673351642). |
| Suite frontend | `npm run test` | `front` | Reporte del SHA final. |
| Unitarias frontend | `npm run test:unit` | `front` | Reporte local/CI. |
| Integraciones frontend | `npm run test:integration` | `front` | Diferenciar simuladas y reales. |
| Cobertura frontend | `npm run test:coverage` | `front` | JSON/HTML y formato del gate. |
| Análisis frontend | `npm run lint` | `front` | Reporte y código de salida. |
| Build frontend | `npm run build` | `front` | Compilación/TypeScript aprobados. |
| Duplicación | `npm run quality:duplicates` | `front` | Reporte por líneas y gate <= 5 %. |
| Complejidad | `npm run quality:complexity` | `front` | Métrica interpretada. |
| Suite backend | `.\.venv\Scripts\python.exe -m pytest` | `back` | Reporte del SHA final. |
| Integraciones backend | `.\.venv\Scripts\python.exe -m pytest tests/integration -q` | `back` | Reporte de dobles/fixtures actuales. |
| Cobertura backend | `.\.venv\Scripts\python.exe -m pytest --cov --cov-report=term-missing --cov-report=html` | `back` | Exportación procesable adicional para CI/gate. |
| Análisis backend | `.\.venv\Scripts\python.exe -m ruff check ETL api services --output-format concise` | `back` | Reglas, versión y tratamiento de hallazgos. |
| Gate completo / código nuevo | **Pendiente de implementar en E04.** | Por definir y registrar. | Base/diff/porcentajes y salida de bloqueo. |
| Integración externa obligatoria | **Preparada parcialmente; completar E06.** | Según implementación final. | Auth/lectura reales sin skip final. |
| Smoke desplegado | **Pendiente de implementar en E07.** | Según implementación final. | URL/SHA/reportes post-deploy. |
| Estrés | **Pendiente de implementar en E08.** | Según implementación final. | Parámetros previos y reporte por pipeline. |
| Esfuerzo sostenido | **Pendiente de implementar en E08.** | Según implementación final. | Duración/serie temporal y reporte. |
| Ciclo integral de entrega | **Pendiente de integrar al finalizar.** | Workflow/comando documentado. | Todos los jobs obligatorios y evidencia consolidada. |

Configurar secretos es una precondición de los comandos externos, no una serie de operaciones manuales ocultas en cada ensayo. La documentación debe permitir a otra persona preparar el entorno y luego ejecutar cada suite con un comando.

## 20. Secuencia orientativa hasta la presentación

La siguiente distribución es una propuesta de organización, no un registro de trabajo realizado ni una garantía de duración. Ajustar según los resultados reales sin eliminar obligaciones de la matriz.

| Ventana de trabajo | Prioridad | Resultado esperado |
| --- | --- | --- |
| Inicio, desde el 21/10 | E00, E01 y E02; abrir seguimiento E05. | Checkpoint, instalación reproducible y pipeline base. |
| Siguiente bloque | E03 y E04; preparar entorno E06. | Defecto de lectura con rojo/verde y gates operativos. |
| Bloque de integración | E06 y E07; avanzar E09. | Auth/RLS de testing y despliegue con smoke. |
| Bloque de rendimiento | E08 y cierre E09. | Estrés/sostenido con reportes y documentación transversal completa. |
| Antes de presentar | E10 y E11, idealmente con margen el 25/10. | PDF revisado, ejecución integral y demostración ensayada. |
| 26/10 | Presentación según consigna. | Versión/evidencias preparadas y explicación individual. |

**Siguiente paso concreto:** comenzar E04: ampliar la cobertura frontend desde 57,96 % hasta al menos 60 % y construir/verificar el gate de existente, código nuevo, duplicación, críticos y reportes válidos. Conservar la base fija `531996f…` y la evidencia rojo/verde de E03. Este archivo debe actualizarse al completar cada etapa.
