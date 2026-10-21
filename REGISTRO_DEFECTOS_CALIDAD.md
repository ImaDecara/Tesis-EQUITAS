# EQUITAS — Registro de defectos de calidad

Registro versionado iniciado el **21/10/2026** y vinculado a **tickets reales de GitHub Issues en E05**. No es una exportación de Jira. [Matriz completa](TRAZABILIDAD_CALIDAD.md), [casos](CASOS_PRUEBA_CALIDAD.md) y [snapshot de seguimiento](evidencias/e05/seguimiento-2026-10-21.json). E03 corrige y valida DEF-DAT-001 mediante regresión automatizada aislada. DEF-SUP-001 y OBS-DEP-001 permanecen abiertos. OBS-COB-001 queda cerrada en E04 con pruebas y gates verificados. E06 verificó integración real y corrigió RLS exclusivamente en testing; el despliegue sigue en E07. [Seguimiento E06](evidencias/e06/seguimiento-2026-10-21.json).

## DEF-SUP-001 — El rol autenticado lee cartera sin pertenencia al tenant

**Ticket:** [#1](https://github.com/ImaDecara/Tesis-EQUITAS/issues/1), abierto/reproducido; [campaña externa #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9). Prioridad P1 por impacto de autorización en el proyecto original. E06 completada en testing aislado; campaña #9 cerrada en ese alcance.

| Campo | Valor |
| --- | --- |
| Estado | **Original: abierto/reproducido. Testing: corregido y validado E06**. |
| Severidad / prioridad | **Alta**, propuesta técnica por afectar autorización de información municipal. |
| Entorno y versión | Supabase EQUITAS `folyslqzqvnpolexcxjo`, estado observado el 21/10/2026; cliente local base `531996f`. Las políticas son configuración remota, no un cambio de ese commit. |
| Responsable | Axel Azcune (`AxAzc`). |
| Requisito | R-SEG-01: las filas de negocio requieren pertenencia activa al tenant autorizado. |
| Caso | **SUP-RLS-02**, en `database/verificacion_supabase_solo_lectura.sql`. |
| Precondición | Conexión de administración autorizada para ejecutar una transacción READ ONLY y cambiar el rol local. |
| Entrada | Rol `authenticated`, claim `sub` sintético `00000000-0000-4000-8000-000000000001`, sin usuario ni pertenencia coincidente. |
| Resultado esperado | Conteos visibles de objetos, deudas y personas iguales a **0**. |
| Resultado obtenido | **2.933 objetos, 56.286 deudas y 2.493 personas**; usuarios coincidentes **0**, pertenencias activas coincidentes **0**. |
| Causa observada | Las políticas SELECT de las 23 tablas públicas permiten `TO authenticated USING (true)`. |
| Evidencia | `evidencias/supabase-2026-10-21.json`, `probes.authenticated_without_membership`; snapshot de políticas y `REVISION_SUPABASE.md`. |
| Corrección / commit | Solo testing: políticas por membresía/relación en `4bb783f1a34c25e9003ee6ece66825668b1c1106` y migración `20261021221030_active_membership_rls.sql`. El original no se modificó. |
| Regresión / verde | [CI E06](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39686380481): 12 variantes reales aprobadas sin omisiones; rojo sin membresía devolvió IDs A/B, verde devuelve cero. [Comparación](evidencias/e06/red-green.json). |

Pasos de reproducción:

1. Ejecutar el bloque `SUP-RLS-02` del SQL versionado contra el entorno correcto con una conexión autorizada.
2. Comprobar `database_role=authenticated`, identidad sintética aplicada y ausencia de pertenencia activa.
3. Comparar los conteos con la expectativa de cero filas.
4. Finalizar en ROLLBACK; el script ya lo incluye.

La reproducción comprueba RLS dentro de PostgreSQL. No creó una cuenta, no obtuvo un JWT firmado y no probó una explotación por HTTP. El control anónimo `SUP-RLS-01` obtuvo cero filas y no constituye este defecto.

Criterios de cierre:

- Identidad sin pertenencia → cero filas de negocio.
- Usuario válido → mantiene acceso a su propia organización.
- Usuario de otro tenant → no ve filas ajenas, incluyendo personas, contactos, relaciones y perfiles.
- La consulta de usuario/pertenencia usada por el frontend funciona sin recursión ni acceso global a otros usuarios.
- Conservar prueba antes/después y regresión automatizada sobre un entorno de testing. La inspección actual de una sola organización no sustituye ese caso con dos tenants.

**Actualización E06:** los pasos SQL anteriores describen la detección original. El ensayo HTTP real se ejecutó después en `iylwghgvtydpmwidojdo`, con cuatro identidades, dos tenants y filas conocidas. [Procedimiento](SUPABASE_TESTING_CALIDAD.md). Para cerrar este issue globalmente falta aplicar/revisar y validar la corrección en el proyecto original; no se declara corregido por asociación con testing.

## DEF-DAT-001 — La lectura de datos se trunca antes de paginar la interfaz

**Ticket:** [#2](https://github.com/ImaDecara/Tesis-EQUITAS/issues/2), cerrado en código/regresión aislada; [casos #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5). Prioridad histórica P1 por integridad de la cartera. La [campaña real #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) quedó cerrada E06 para lectura mínima y autorización en testing; volumen real e interfaz desplegada no se infieren de esa campaña.

| Campo | Valor |
| --- | --- |
| Estado | **Cerrado en código y regresión automatizada aislada de ambas rutas/relaciones**, validados E03. E06 verificó el lector con datos mínimos y RLS reales; despliegue/interfaz siguen en E07. La prueba de gran volumen conserva el alcance aislado E03. |
| Severidad / prioridad | **Alta**, propuesta técnica por posible incompletitud de métricas y decisiones. |
| Entorno y versión | Condición detectada en frontend `531996f` y volumen real del 21/10/2026. Reproducción roja `f155cfc1616c8edeacd533241c5dc2858745734a`; corrección verde `3bfe15688a72360b336b7d8732867c6991a1d42e`, Ubuntu 24.04, SDK real con transporte HTTP sintético. |
| Responsable | Axel Azcune (`AxAzc`). |
| Requisito | R-DAT-01: los listados y agregados deben representar la cartera autorizada completa. |
| Caso | **SUP-DATA-01** para detección; **DAT-01–08** para aceptación/regresión en ambas rutas y relaciones. DAT-09–14 complementan validación del lector. |
| Precondición / entrada | Cartera con **56.286 deudas** y **3.007 relaciones objeto–persona**. |
| Resultado esperado | Lectura completa mediante paginación de base o consultas agregadas que cubran todo el conjunto autorizado. |
| Resultado obtenido antes | `.select('*').limit(3000)` sin iteración. DAT-06: recupera 1.000/3.507 o 3.000/3.507 según el máximo del servidor, en ambas rutas. |
| Resultado obtenido después | DAT-06: **3.507/3.507**, cero omitidas y duplicadas en las cuatro variantes. Límites, errores intermedios y agregados de ambas rutas aprobados. |
| Fuente | `front/lib/data/raw-debtor-loader.ts` y `front/lib/services/person-data-service.ts`. |
| Evidencia | Conteos reales en `evidencias/supabase-2026-10-21.json`; reproducción/corrección en [ficha E03](REGISTRO_EJECUCION_E03.md), [comparación](evidencias/e03/comparacion-dat-06.json) y [aserciones rojas](evidencias/e03/aserciones-red.json). |
| Corrección / commit | Lector común con orden `id`, filtro `gt`, máximo 1.000 por request y terminación por página vacía, sin límite total; commit `3bfe15688a72360b336b7d8732867c6991a1d42e`. Descarta tablas parciales si fallan y conserva advertencias. |
| Regresión / verde | [Rojo real](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39672114249) con cuatro fallos; [verde](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39673351642) con los mismos casos aprobados, 42 pruebas nuevas, 136 de producto aprobadas y una externa omitida. 28/28 líneas ejecutables nuevas de E03 cubiertas. |

Pasos de reproducción de la condición:

1. Consultar el conteo exacto de `debt` y `debtor_person` mediante el SQL de inspección.
2. Revisar `TABLE_LIMIT` y la consulta de ambos loaders.
3. Verificar que no se solicita una página posterior ni se comprueba truncamiento.
4. Comparar 56.286 con 3.000 y 3.007 con 3.000.

La condición de truncamiento quedó reproducida y corregida con un total conocido. No se afirmó una cifra concreta de deuda errónea en la interfaz autenticada ni que el límite efectivo del servidor sea exactamente 3.000. El bloque de aceptación del rojo permanece intacto en el verde. La fixture usa el SDK instalado y sustituye solo HTTP; no se modificaron datos ni políticas reales.

Criterios de cierre:

- Recuperación completa y sin duplicados de un conjunto de más de una página, con orden estable.
- Manejo correcto de lista vacía, última página exacta/parcial y error en una página intermedia.
- Totales del dashboard coherentes con los registros autorizados completos.
- Prueba fallida sobre el comportamiento anterior y aprobada después de la corrección; conservar regresión y cobertura de código nuevo.

**Criterios anteriores satisfechos en el alcance automatizado de E03:** ambas rutas, páginas vacías/exactas/parciales, servidor inferior al límite solicitado, errores, orden/unicidad y agregados con relaciones de varias páginas. Se mantiene la regresión en CI. El recorrido no garantiza snapshot transaccional entre requests ni rendimiento para toda la cartera; integración real, despliegue y cargas corresponden a E06–E08. E04 implementó y comprobó el gate sobre la base fija del TP.

## Observaciones de calidad incorporadas en E01

**Tickets E05:** [OBS-DEP-001 #3](https://github.com/ImaDecara/Tesis-EQUITAS/issues/3), abierto con prioridad P1 antes del vencimiento; [OBS-COB-001 #4](https://github.com/ImaDecara/Tesis-EQUITAS/issues/4), cerrado con validación E04. Los [contratos #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) están aprobados; no cierran el riesgo temporal de dependencias.

| ID | Situación comprobada | Severidad / responsable | Tratamiento y criterio de cierre |
| --- | --- | --- | --- |
| **OBS-DEP-001** | Cinco paquetes de desarrollo afectados por una misma cadena del linter: `eslint-config-next` → plugin Next → `fast-glob` → `micromatch` → `braces` 3.0.3. Aviso GHSA-vfj7-8cjw-p6xm sin parche publicado al verificar. Auditoría completa devuelve 1; productiva, 0. | Alta según el aviso. Axel Azcune. **Abierta, con excepción temporal documentada para el TP**. | Mantener reportes y configuración del linter bajo control, runner acotado y revisión en E02/E11, antes del 26/10/2026 o al publicarse corrección. Cerrar únicamente tras retirar la cadena o actualizar a versión corregida compatible y aprobar lint/regresión. No es un bug funcional corregido para R14. |
| **OBS-COB-001** | E01/E02: 586/1.275 = 45,96 %; E03: 742/1.280 = 57,96 %. E04: **791/1.280, Vitest 61,79 %**, mismo alcance de 55 archivos. | Alta para cumplimiento; responsable Axel Azcune. **Cerrada y validada en E04**, no era por sí sola un defecto funcional. | 26 pruebas nuevas; gate existente >=60 % y nuevo >=80 % por módulo contra base fija, [CI normal aprobado](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195) y [ensayo de bloqueo](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574162). Mantener controles; reabrir si dejan de cumplir. |

Evidencia común: [REGISTRO_EJECUCION_E01.md](REGISTRO_EJECUCION_E01.md), [resumen E01](evidencias/e01/resumen-2026-10-21.json) y auditorías en la misma carpeta. Las tres excepciones de Ruff y los avisos de mantenimiento se detallan en la ficha E01; no se convierten en bugs críticos de negocio por el nivel `error` del linter.

**Seguimiento E02:** ambos registros permanecen abiertos. OBS-DEP-001 se volvió a verificar en Linux y tiene una [política versionada](quality/npm-audit-policy.json) que conserva las salidas crudas y rechaza cambios o vencimiento; no corrige los cinco avisos. OBS-COB-001 reproduce 45,96 % en CI y sigue bloqueando cerrar E04. [CI normal](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39669312471) y [ficha E02](REGISTRO_EJECUCION_E02.md). El fallo controlado de CI no cierra DEF-DAT-001 ni DEF-SUP-001.

**Seguimiento E03:** OBS-COB-001 mejora a **742/1.280 = 57,96 %** de sentencias frontend sobre 55 archivos, todavía inferior a 60 %; permanece abierta. Las 42 pruebas nuevas cubren la lectura completa y sus contratos. OBS-DEP-001 conserva cinco altos de desarrollo y la misma excepción temporal; DEF-SUP-001 sigue sin corrección. El [CI verde de E03](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39673351642) no acredita los gates completos ni la autorización real.

**Seguimiento E04:** OBS-COB-001 cerrada con [evidencia](REGISTRO_EJECUCION_E04.md): 61,79 % frontend; nuevo frontend 28/28 y backend 15/17 contra la base fija. Gates normales aprobados y ensayo crítico sintético bloqueado. Las pruebas Auth son aisladas; **DEF-SUP-001 sigue abierto**. OBS-DEP-001 conserva cinco altos de desarrollo y el vencimiento 26/10/2026; no se prorrogó. Esta actualización prevalece sobre el estado abierto de cobertura de E01–E03.

## Trazabilidad actual

E05 formaliza los estados, tickets y enlaces recíprocos en [TRAZABILIDAD_CALIDAD.md](TRAZABILIDAD_CALIDAD.md). Los criterios de detección/cierre y reportes anteriores se conservan. Una aceptación temporal no cierra OBS-DEP-001 y un aprobado aislado no cierra DEF-SUP-001.

| Requisito | Caso | Evidencia / resultado | Defecto | Corrección y regresión |
| --- | --- | --- | --- | --- |
| R-SEG-01, impedir acceso sin pertenencia | SUP-RLS-02 | Lectura SQL por rol: **no cumple**. | DEF-SUP-001 | Pendientes. |
| R-SEG-02, impedir lectura anónima | SUP-RLS-01 | Cero filas en cuatro tablas consultadas: **cumple en ese alcance**. | Ninguno por ese caso. | Mantener como regresión. |
| R-DAT-01, cartera completa | SUP-DATA-01 → DAT-01–08; DAT-09–14 complementarios | Cuatro DAT-06 fallan antes y recuperan 3.507/3.507 después. Límites, errores y agregados aprobados. | DEF-DAT-001 | `3bfe156…`, [rojo](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39672114249) / [verde](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39673351642). Corregido/validado en regresión aislada; integración de aplicación pendiente. |
| R-INT-01, integridad de carga existente | SUP-INT-01 y agregados de revisión | Sin duplicados, huérfanos ni discrepancias seleccionadas: **cumple en ese alcance**. | Ninguno por esos casos. | No sustituye reejecución ETL real. |
| R09 / dependencias | Auditorías npm completa y productiva E01 | 0 críticos; cinco altos de desarrollo pendientes, productivas sin avisos. | OBS-DEP-001 | Excepción temporal revisable; corrección pendiente. |
| R07 / cobertura existente frontend | Vitest 4.1.12, 55 archivos | **791/1.280, Vitest 61,79 %; cumple 60 %**. | OBS-COB-001 | Cerrada E04; gate automático contra regresiones. |

Los IDs describen esta revisión; no aumentan el recuento de las suites Vitest/Pytest ni se atribuyen a Jira.
