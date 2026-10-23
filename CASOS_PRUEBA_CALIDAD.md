# Casos de prueba, técnicas y resultados — EQUITAS

**Actualización E08, 23/10/2026:** estrés progresivo y sostenido completados en [pipeline](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39960952025), SHA `f6f83f9a3172fc2e42912305a181057130d9577b`, después del [CI del mismo commit](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39960952039). Se midió la API FastAPI con lógica productiva y conector sintético local: 3.600 perfiles/objetos y 72.000 deudas representadas. Ambas campañas aprobaron sus criterios previos; E08 tiene 24/24 controles. Corte acumulado: **168 aisladas + 12 externas + un smoke + dos cargas = 183 pruebas/campañas de producto**, con **66 controles de infraestructura aparte**, cero fallidas/omitidas en ese corte. Los requests no se cuentan como tests. [Ficha E08](REGISTRO_EJECUCION_E08.md), [comandos/alcance](RENDIMIENTO_CALIDAD.md), [resultados](evidencias/e08/resultados.json), [CAS-PERF #12](https://github.com/ImaDecara/Tesis-EQUITAS/issues/12). La capacidad de Vercel/Supabase/web no fue ensayada por estas cargas. E09 tiene la herramienta documentada y conserva sus demás pendientes; siguen abiertos DEF-SUP-001 original y OBS-DEP-001. Esta nota prevalece sobre estados históricos de cargas pendientes.

**Actualización E07, 23/10/2026:** etapa cerrada en Preview de `quality/tp-testing`, SHA `a6497a73b226f9d27abb4e9080d5540503d95539`. [CI](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39955381596) aprobado y [smoke automático](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39955572523) aprobado sobre el mismo commit y Supabase testing: **168 pruebas aisladas + 12 HTTP reales + 1 recorrido de navegador = 181 de producto**, cero fallidas/omitidas; **55 controles de infraestructura aparte**. El recorrido contiene cinco comprobaciones y valida realmente `/people`, su título y el listado operativo. [Ficha y límites](REGISTRO_EJECUCION_E07.md), [deployment](evidencias/e07/deployment.json), [reporte](evidencias/e07/smoke.json) y [CAS-SMOKE #10](https://github.com/ImaDecara/Tesis-EQUITAS/issues/10). E00–E07 completadas en sus alcances; sigue E08. DEF-SUP-001 permanece abierto en el original y OBS-DEP-001 conserva su vencimiento 26/10/2026. Esta actualización prevalece sobre los estados históricos de despliegue pendiente.

**Formalización E05, 21/10/2026. Responsable:** Axel Azcune (`AxAzc`). Los criterios y resultados de E03/E04 conservan sus versiones originales; documentarlos aquí no crea nuevas ejecuciones.

El catálogo contiene **56 IDs de caso/familia seleccionados**, con variantes parametrizadas. No equivale a 50 pruebas nuevas. El [inventario completo](calidad/inventario-pruebas.json) conserva **183 aprobadas, 0 fallidas y 0 omitidas** en el corte de producto: 168 aisladas, 12 HTTP reales, un recorrido de navegador y dos campañas de carga; **66 de infraestructura por separado**. Cada clase conserva sus reportes y versiones. El inventario E06 se conserva como histórico. Los casos DAT/FIXTURE, AUTH y REC representan 69 variantes aisladas aprobadas de esas suites; el resto de la línea base permanece en el inventario y sus fuentes.

Las fichas utilizan los campos de la [plantilla](.github/ISSUE_TEMPLATE/caso_prueba.md). En el [JSON](calidad/casos-prueba.json), cada ficha hereda el contexto de su grupo; los campos propios tienen precedencia. [Seguimiento y estados](GESTION_CALIDAD.md) y [matriz de trazabilidad](TRAZABILIDAD_CALIDAD.md).

## Equivalencias y valores límite realmente ejecutados

| Grupo | Particiones / límites | Resultado comprobado y fuente |
| --- | --- | --- |
| DAT-01–06 | Vacío; parcial; exacto; última parcial; múltiplo; más de 3.000. N=0/7/1.000/1.001/2.000/3.507; máximo servidor 1.000/3.000/137. | Completitud y fin de lectura en ambas rutas. DAT-06 conserva rojo antes y verde después. |
| DAT-07, 09–14 | Configuración ausente, errores API/transporte, ID inválido, bigint en texto, cursor repetido/desordenado, respuesta no array. | Cero filas parciales expuestas y advertencias/terminación según contrato. Los enteros grandes en texto preservan precisión. |
| AUTH-01–09 | Cliente no configurado; Auth ausente/inválido/válido; usuario de aplicación vacío/válido; pertenencia activa/inactiva/ausente/error. | Rechazo o contexto exacto, sin consultas adicionales indebidas. Alcance con dobles. |
| REC-01 | Riesgo alto y contacto; mora 59/60 días; saldo 349.999/350.000; sin deuda. | Siete decisiones exactas y urgencia en la tabla siguiente. |
| GATE-01–03 | 59,99/60 % existente; 79,99/80 % nuevo; 5/5,01 % duplicación y 5,0001 % que no debe ocultarse al redondear. | Rechazo/aprobación en los límites; 5 % duplicación pasa y cualquier exceso falla. |

Estos son valores probados; no se declara exhaustividad ni cobertura MC/DC. Sentencias y ramas se informan con sus denominadores en E04. Los resultados SQL se separan de Auth/HTTP real.

## Tabla de decisión ejecutada: recomendaciones REC-01

Fuente: [prueba parametrizada](front/tests/unit/recommendation-decisions.test.ts), commit `c95a9ab…`, [CI E04](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195). Las siete filas aprobaron.

| Fila | Riesgo | Contacto | Deuda vencida | Deuda total | Días | Recomendación esperada y obtenida | Urgente |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| D1 | ALTO | Sí | 1 | 400.000 | 90 | Llamado prioritario | Sí |
| D2 | ALTO | No | 0 | 0 | 0 | Plan de pago / revisión humana | Sí |
| D3 | MEDIO | Sí | 1 | 1 | 60 | Plan de pago / revisión humana | Sí |
| D4 | MEDIO | Sí | 1 | 1 | 59 | Mensaje recordatorio | No |
| D5 | BAJO | Sí | 0 | 350.000 | 60 | Mensaje recordatorio | No |
| D6 | BAJO | No | 0 | 349.999 | 90 | Seguimiento posterior | No |
| D7 | BAJO | Sí | 0 | 0 | 0 | Seguimiento posterior | No |

D1 comprueba precedencia del riesgo alto sobre la mora prolongada; D3/D4 y D5/D6 ejercitan los límites. Las descripciones de entradas no sustituyen el resultado: se verifican tipo, resumen y urgencia.

## Tabla de decisión ejecutada: acceso de aplicación aislado

| Auth válido | Usuario vinculado | Búsqueda activa | Fallback | Esperado y obtenido | Caso |
| --- | --- | --- | --- | --- | --- |
| No | No consulta | No consulta | No consulta | AUTH_REQUIRED; requiresLogin=true; no consulta tablas | AUTH-05 |
| Sí | ID vacío | No consulta | No consulta | APP_USER_NOT_FOUND | AUTH-09 |
| Sí | ID 42 | Fila tenant 7/operator | No consulta | Contexto auth-test/42/7/operator; autorizado en el doble | AUTH-06 |
| Sí | ID 42 | Vacía | Vacío | TENANT_ACCESS_NOT_FOUND; sin contexto | AUTH-07 |
| Sí | ID 42 | Vacía | Status false | TENANT_ACCESS_INACTIVE; sin contexto | AUTH-07 |
| Sí | ID 42 | Vacía | Error 42501 | DATABASE_ERROR; sin contexto | AUTH-07 |
| Sí | ID 42 | Error | No consulta | DATABASE_ERROR; exactamente dos consultas | AUTH-08 |

Esta tabla está ejecutada con dobles. No demuestra políticas de la base real. E06 agrega Auth/Data API reales y conserva por separado el fallo SQL original y el rojo/verde HTTP de testing.

## Decisión de autorización comprobada en Supabase real

| Identidad | Membresía | Negocio | Contexto |
| --- | --- | --- | --- |
| A / B | Activa en su tenant | Solo sus filas conocidas | app/tenant/rol exactos |
| Anónimo | Ninguna | Cero en 23 tablas | Sin sesión |
| none | Ninguna | Cero negocio/tenant/catálogos | TENANT_ACCESS_NOT_FOUND |
| inactive | Inactiva | Cero negocio/tenant/catálogos | TENANT_ACCESS_INACTIVE |

[CI E06 real](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39686380481), `4bb783f1a34c25e9003ee6ece66825668b1c1106`. 12 variantes aprobadas sin omisiones. [Procedimiento y límites](SUPABASE_TESTING_CALIDAD.md). Los campos `historial_E05` del catálogo conservan resultados anteriores y su contexto.


## Catálogo y fichas

| ID | Objetivo | Estado | Grupo |
| --- | --- | --- | --- |
| [DAT-01](#dat-01) | Tabla vacía | aprobado | CAS-DAT |
| [DAT-02](#dat-02) | Página parcial | aprobado | CAS-DAT |
| [DAT-03](#dat-03) | Una página exacta | aprobado | CAS-DAT |
| [DAT-04](#dat-04) | Dos páginas con última parcial | aprobado | CAS-DAT |
| [DAT-05](#dat-05) | Múltiplo exacto | aprobado | CAS-DAT |
| [DAT-06](#dat-06) | Recuperar más de 3.000 filas en ambas rutas | aprobado | CAS-DAT |
| [DAT-07](#dat-07) | Evitar éxito con tablas parciales | aprobado | CAS-DAT |
| [DAT-08](#dat-08) | Preservar agregados y relaciones entre páginas | aprobado | CAS-DAT |
| [DAT-09](#dat-09) | Sin cliente/credenciales | aprobado | CAS-DAT |
| [DAT-10](#dat-10) | Cursor bigint preciso | aprobado | CAS-DAT |
| [DAT-11](#dat-11) | ID inválido | aprobado | CAS-DAT |
| [DAT-12](#dat-12) | Cursor/orden/duplicados inválidos | aprobado | CAS-DAT |
| [DAT-13](#dat-13) | Respuesta no array | aprobado | CAS-DAT |
| [DAT-14](#dat-14) | Contrato de advertencias | aprobado | CAS-DAT |
| [FIXTURE-01](#fixture-01) | Verificar el doble HTTP del SDK | aprobado | CAS-DAT |
| [AUTH-01](#auth-01) | Configuración ausente | aprobado | CAS-AUTH |
| [AUTH-02](#auth-02) | Contrato de login | aprobado | CAS-AUTH |
| [AUTH-03](#auth-03) | Cierre de sesión | aprobado | CAS-AUTH |
| [AUTH-04](#auth-04) | Mensajes de usuario | aprobado | CAS-AUTH |
| [AUTH-05](#auth-05) | Sesión ausente o inválida | aprobado | CAS-AUTH |
| [AUTH-06](#auth-06) | Contexto autorizado aislado | aprobado | CAS-AUTH |
| [AUTH-07](#auth-07) | Sin pertenencia activa | aprobado | CAS-AUTH |
| [AUTH-08](#auth-08) | Error de consulta de pertenencia | aprobado | CAS-AUTH |
| [AUTH-09](#auth-09) | ID de usuario vacío | aprobado | CAS-AUTH |
| [REC-01](#rec-01) | Aplicar decisiones y precedencia de recomendaciones | aprobado | CAS-REC |
| [GATE-01](#gate-01) | Cobertura existente | aprobado | CAS-GATE |
| [GATE-02](#gate-02) | Cobertura nueva | aprobado | CAS-GATE |
| [GATE-03](#gate-03) | Duplicación | aprobado | CAS-GATE |
| [GATE-04](#gate-04) | Crítico versus estilo | aprobado | CAS-GATE |
| [GATE-05](#gate-05) | Reportes inválidos | aprobado | CAS-GATE |
| [GATE-06](#gate-06) | Base y procedencia | aprobado | CAS-GATE |
| [GATE-07](#gate-07) | Sin código nuevo | aprobado | CAS-GATE |
| [GATE-08](#gate-08) | Mapeo de diff y rutas | aprobado | CAS-GATE |
| [GATE-09](#gate-09) | Propagación de fallos | aprobado | CAS-GATE |
| [GATE-10](#gate-10) | Ensayo remoto controlado | aprobado | CAS-GATE |
| [COB-01](#cob-01) | Cerrar insuficiencia de cobertura | aprobado | CAS-GATE |
| [AUD-01](#aud-01) | Evaluar la excepción revisada de desarrollo | aprobado | CAS-GATE |
| [AUD-PROD-01](#aud-prod-01) | Exigir dependencias productivas sin avisos | aprobado | CAS-GATE |
| [SUP-RLS-01](#sup-rls-01) | Denegar lectura anónima en controles SQL | aprobado HTTP en testing | CAS-EXT |
| [SUP-RLS-02](#sup-rls-02) | Denegar cartera sin pertenencia | aprobado HTTP en testing | CAS-EXT |
| [SUP-DATA-01](#sup-data-01) | Detectar riesgo de truncamiento | detección histórica; corregido en regresión aislada | CAS-EXT |
| [SUP-INT-01](#sup-int-01) | Inspeccionar integridad seleccionada | aprobado en alcance SQL | CAS-EXT |
| [SUP-AUTH-01](#sup-auth-01) | Autenticar y recuperar contexto real de testing | aprobado HTTP en testing | CAS-EXT |
| [SUP-AUTH-02](#sup-auth-02) | Credenciales inválidas | aprobado HTTP en testing | CAS-EXT |
| [SUP-AUTH-03](#sup-auth-03) | Logout real | aprobado HTTP en testing | CAS-EXT |
| [SUP-DATA-02](#sup-data-02) | Lectura positiva por tenant | aprobado HTTP en testing | CAS-EXT |
| [SUP-RLS-03](#sup-rls-03) | A no accede a B | aprobado HTTP en testing | CAS-EXT |
| [SUP-RLS-04](#sup-rls-04) | B no accede a A | aprobado HTTP en testing | CAS-EXT |
| [SUP-RLS-05](#sup-rls-05) | Pertenencia inactiva | aprobado HTTP en testing | CAS-EXT |
| [SUP-WRITE-01](#sup-write-01) | Denegar escrituras desde cliente normal | aprobado HTTP en testing | CAS-EXT |

## Contexto DAT

**Nivel:** Integración aislada y unidad del lector. **Requisitos:** R-DAT-01, R05, R06, R13, R14.

**Precondiciones:** Dependencias E01 preparadas; SDK real con transporte HTTP sintético, sin credenciales reales; tablas estables durante la lectura.

**Comando:** `cd front; npm exec --no -- vitest run tests/integration/complete-data.integration.test.ts tests/unit/paginated-table-reader.test.ts`.

**Código:** [complete-data.integration.test.ts](front/tests/integration/complete-data.integration.test.ts), [paginated-table-reader.test.ts](front/tests/unit/paginated-table-reader.test.ts).

**Evidencia:** [comparacion-dat-06.json](evidencias/e03/comparacion-dat-06.json), [aserciones-red.json](evidencias/e03/aserciones-red.json), [resumen-ci-normal.json](evidencias/e04/resumen-ci-normal.json).

<a id="dat-01"></a>
### DAT-01 — Tabla vacía

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** equivalencias, valores límite, regresión.

**Entrada:** Ambas rutas; N=0, máximo efectivo 1.000; IDs con huecos.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `DAT-01`.

**Esperado:** 0 filas, IDs esperados ordenados y únicos, sin advertencias; 1 consultas a tabla principal, incluida vacía final.

**Obtenido:** Ambas rutas cumplen N=0, sin omisiones/duplicados y con 1 consultas.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes reportadas:** 2; nombres completos y estados en el JSON.

<a id="dat-02"></a>
### DAT-02 — Página parcial

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** equivalencias, valores límite, regresión.

**Entrada:** Ambas rutas; N=7, máximo efectivo 1.000; IDs con huecos.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `DAT-02`.

**Esperado:** 7 filas, IDs esperados ordenados y únicos, sin advertencias; 2 consultas a tabla principal, incluida vacía final.

**Obtenido:** Ambas rutas cumplen N=7, sin omisiones/duplicados y con 2 consultas.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes reportadas:** 2; nombres completos y estados en el JSON.

<a id="dat-03"></a>
### DAT-03 — Una página exacta

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** equivalencias, valores límite, regresión.

**Entrada:** Ambas rutas; N=1000, máximo efectivo 1.000; IDs con huecos.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `DAT-03`.

**Esperado:** 1000 filas, IDs esperados ordenados y únicos, sin advertencias; 2 consultas a tabla principal, incluida vacía final.

**Obtenido:** Ambas rutas cumplen N=1000, sin omisiones/duplicados y con 2 consultas.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes reportadas:** 2; nombres completos y estados en el JSON.

<a id="dat-04"></a>
### DAT-04 — Dos páginas con última parcial

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** equivalencias, valores límite, regresión.

**Entrada:** Ambas rutas; N=1001, máximo efectivo 1.000; IDs con huecos.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `DAT-04`.

**Esperado:** 1001 filas, IDs esperados ordenados y únicos, sin advertencias; 3 consultas a tabla principal, incluida vacía final.

**Obtenido:** Ambas rutas cumplen N=1001, sin omisiones/duplicados y con 3 consultas.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes reportadas:** 2; nombres completos y estados en el JSON.

<a id="dat-05"></a>
### DAT-05 — Múltiplo exacto

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** equivalencias, valores límite, regresión.

**Entrada:** Ambas rutas; N=2000, máximo efectivo 1.000; IDs con huecos.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `DAT-05`.

**Esperado:** 2000 filas, IDs esperados ordenados y únicos, sin advertencias; 3 consultas a tabla principal, incluida vacía final.

**Obtenido:** Ambas rutas cumplen N=2000, sin omisiones/duplicados y con 3 consultas.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes reportadas:** 2; nombres completos y estados en el JSON.

<a id="dat-06"></a>
### DAT-06 — Recuperar más de 3.000 filas en ambas rutas

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** equivalencias, límite superior histórico, regresión.

**Entrada:** 3.507 filas; IDs 3*(índice+1), orden físico inverso; servidor máximo 1.000/3.000 y variante 137.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `DAT-06`.

**Esperado:** 3.507 recuperadas, 0 omitidas y 0 duplicadas; orden estable. Con máximo 137, 27 requests a tabla principal.

**Obtenido:** Seis variantes aprobadas. Antes: 1.000/3.507 o 3.000/3.507 en cuatro variantes; después 3.507/3.507 en todas.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes reportadas:** 6; nombres completos y estados en el JSON.

<a id="dat-07"></a>
### DAT-07 — Evitar éxito con tablas parciales

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** equivalencias inválidas, pruebas negativas, regresión.

**Entrada:** Fallo API/permisos/transporte después de página válida; excepciones del cliente.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `DAT-07`.

**Esperado:** Descartar filas de tabla afectada, devolver advertencia, mantener tablas independientes y terminar.

**Obtenido:** Cinco variantes aprobadas: debtors independientes preservados, debts/detalles parciales descartados; error de red informado.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes reportadas:** 5; nombres completos y estados en el JSON.

<a id="dat-08"></a>
### DAT-08 — Preservar agregados y relaciones entre páginas

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** integración de relaciones, regresión.

**Entrada:** 3.507 deudas de importe 2, personas, contactos y relaciones; riesgo 99 en persona 10521 de última página.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `DAT-08`.

**Esperado:** Deuda 7.014 y conteos 3.507; última persona con riesgo 99/contacto y deuda asociada 7.014; un riesgo alto, cero sin contacto.

**Obtenido:** Dos variantes aprobadas con esos valores exactos.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes reportadas:** 2; nombres completos y estados en el JSON.

<a id="dat-09"></a>
### DAT-09 — Sin cliente/credenciales

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** equivalencias, validación de entradas, pruebas negativas.

**Entrada:** Cliente null o credenciales deshabilitadas.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `DAT-09`.

**Esperado:** 0 filas, advertencia de configuración, ninguna consulta.

**Obtenido:** Aprobado: 0 filas, advertencia de configuración, ninguna consulta. Verificado en 2 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes reportadas:** 2; nombres completos y estados en el JSON.

<a id="dat-10"></a>
### DAT-10 — Cursor bigint preciso

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** equivalencias, validación de entradas, pruebas negativas.

**Entrada:** IDs en texto 9007199254740993 y 9007199254740994.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `DAT-10`.

**Esperado:** Preservar ambos IDs y filtros gt exactos sin pérdida de precisión.

**Obtenido:** Aprobado: Preservar ambos IDs y filtros gt exactos sin pérdida de precisión. Verificado en 1 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes reportadas:** 1; nombres completos y estados en el JSON.

<a id="dat-11"></a>
### DAT-11 — ID inválido

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** equivalencias, validación de entradas, pruebas negativas.

**Entrada:** undefined/null/true/texto inválido/1.5/entero no seguro.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `DAT-11`.

**Esperado:** 0 filas y DATA_PAGINATION_INVALID; detener en primer request.

**Obtenido:** Aprobado: 0 filas y DATA_PAGINATION_INVALID; detener en primer request. Verificado en 6 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes reportadas:** 6; nombres completos y estados en el JSON.

<a id="dat-12"></a>
### DAT-12 — Cursor/orden/duplicados inválidos

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** equivalencias, validación de entradas, pruebas negativas.

**Entrada:** Cursor repetido, filas desordenadas o duplicadas.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `DAT-12`.

**Esperado:** 0 filas y DATA_PAGINATION_INVALID; como máximo dos consultas.

**Obtenido:** Aprobado: 0 filas y DATA_PAGINATION_INVALID; como máximo dos consultas. Verificado en 3 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes reportadas:** 3; nombres completos y estados en el JSON.

<a id="dat-13"></a>
### DAT-13 — Respuesta no array

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** equivalencias, validación de entradas, pruebas negativas.

**Entrada:** Objeto {id:1} como página.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `DAT-13`.

**Esperado:** 0 filas y advertencia DATA_PAGINATION_INVALID.

**Obtenido:** Aprobado: 0 filas y advertencia DATA_PAGINATION_INVALID. Verificado en 1 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes reportadas:** 1; nombres completos y estados en el JSON.

<a id="dat-14"></a>
### DAT-14 — Contrato de advertencias

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** equivalencias, validación de entradas, pruebas negativas.

**Entrada:** 42501 y mensajes permission denied/row-level security/RLS; mensaje vacío y código null.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `DAT-14`.

**Esperado:** needsSelectPolicy=true en cuatro variantes de permisos; false con error vacío, mensaje desconocido y código omitido.

**Obtenido:** Aprobado: needsSelectPolicy=true en cuatro variantes de permisos; false con error vacío, mensaje desconocido y código omitido. Verificado en 5 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes reportadas:** 5; nombres completos y estados en el JSON.

<a id="fixture-01"></a>
### FIXTURE-01 — Verificar el doble HTTP del SDK

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** control del doble.

**Entrada:** 8 IDs invertidos; servidor máximo 3; limit 3000 y consulta ordenada gt 9 limit 3.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `FIXTURE-01`.

**Esperado:** IDs [24,21,18] y [12,15,18]; segunda consulta order=id.asc, after=9, limit=3.

**Obtenido:** Ambas respuestas y parámetros exactos comprobados.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes reportadas:** 1; nombres completos y estados en el JSON.

## Contexto AUTH

**Nivel:** Unidad / contrato aislado Auth y pertenencia. **Requisitos:** R-SEG-01, R05, R06.

**Precondiciones:** Cliente browser sustituido por doble; respuestas de Auth/user/tenant_user sintéticas; sin consultas al servicio real.

**Comando:** `cd front; npm exec --no -- vitest run tests/unit/auth-service.test.ts`.

**Código:** [auth-service.test.ts](front/tests/unit/auth-service.test.ts).

**Evidencia:** [resumen-ci-normal.json](evidencias/e04/resumen-ci-normal.json).

<a id="auth-01"></a>
### AUTH-01 — Configuración ausente

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** equivalencias, tabla de decisión, pruebas negativas.

**Entrada:** Cliente browser null.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `AUTH-01`.

**Esperado:** No autoriza; SUPABASE_NOT_CONFIGURED; getUser null, login error de configuración, logout sin error.

**Obtenido:** Aprobado: No autoriza; SUPABASE_NOT_CONFIGURED; getUser null, login error de configuración, logout sin error. Verificado en 1 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes reportadas:** 1; nombres completos y estados en el JSON.

<a id="auth-02"></a>
### AUTH-02 — Contrato de login

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** equivalencias, tabla de decisión, pruebas negativas.

**Entrada:** Email/password sintéticos; respuesta sin error o Invalid login credentials.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `AUTH-02`.

**Esperado:** Transmitir ambos valores al SDK y conservar exactamente error=null o el objeto de error recibido.

**Obtenido:** Aprobado: Transmitir ambos valores al SDK y conservar exactamente error=null o el objeto de error recibido. Verificado en 2 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes reportadas:** 2; nombres completos y estados en el JSON.

<a id="auth-03"></a>
### AUTH-03 — Cierre de sesión

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** equivalencias, tabla de decisión, pruebas negativas.

**Entrada:** Cliente configurado.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `AUTH-03`.

**Esperado:** Invocar signOut exactamente una vez.

**Obtenido:** Aprobado: Invocar signOut exactamente una vez. Verificado en 1 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes reportadas:** 1; nombres completos y estados en el JSON.

<a id="auth-04"></a>
### AUTH-04 — Mensajes de usuario

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** equivalencias, tabla de decisión, pruebas negativas.

**Entrada:** Error null, credenciales inválidas en dos formas, email no confirmado y servicio no disponible.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `AUTH-04`.

**Esperado:** Mensajes No se pudo iniciar sesion / Email o password incorrectos / El email aun no fue confirmado / texto original del error.

**Obtenido:** Aprobado: Mensajes No se pudo iniciar sesion / Email o password incorrectos / El email aun no fue confirmado / texto original del error. Verificado en 5 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes reportadas:** 5; nombres completos y estados en el JSON.

<a id="auth-05"></a>
### AUTH-05 — Sesión ausente o inválida

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** equivalencias, tabla de decisión, pruebas negativas.

**Entrada:** Auth devuelve usuario null o error expired con usuario presente.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `AUTH-05`.

**Esperado:** isAuthorized=false, requiresLogin=true, AUTH_REQUIRED y ninguna consulta a tablas.

**Obtenido:** Aprobado: isAuthorized=false, requiresLogin=true, AUTH_REQUIRED y ninguna consulta a tablas. Verificado en 2 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes reportadas:** 2; nombres completos y estados en el JSON.

<a id="auth-06"></a>
### AUTH-06 — Contexto autorizado aislado

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** equivalencias, tabla de decisión, pruebas negativas.

**Entrada:** Contexto autorizado con cliente habitual y con cliente inyectado que conserva la sesion.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `AUTH-06`.

**Esperado:** Contextos auth-test/42/7/operator y auth-test/42/7/1 segun variante; cliente inyectado sin llamar al factory.

**Obtenido:** Aprobadas ambas variantes, con filtros y cliente preservados.

**Fecha/versión/entorno:** 2026-10-21; `4bb783f1a34c25e9003ee6ece66825668b1c1106`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39686380481).

**Variantes reportadas:** 2; nombres completos y estados en el JSON.

**Historia conservada:** ficha y contexto anteriores en `historial_E05` del JSON; el resultado HTTP actual no reescribe el estado del proyecto original.

<a id="auth-07"></a>
### AUTH-07 — Sin pertenencia activa

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** equivalencias, tabla de decisión, pruebas negativas.

**Entrada:** Búsqueda activa vacía; fallback vacío / status=false / error 42501.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `AUTH-07`.

**Esperado:** TENANT_ACCESS_NOT_FOUND / TENANT_ACCESS_INACTIVE / DATABASE_ERROR; sin contexto; fallback user=42 limit=20.

**Obtenido:** Aprobado: TENANT_ACCESS_NOT_FOUND / TENANT_ACCESS_INACTIVE / DATABASE_ERROR; sin contexto; fallback user=42 limit=20. Verificado en 3 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes reportadas:** 3; nombres completos y estados en el JSON.

<a id="auth-08"></a>
### AUTH-08 — Error de consulta de pertenencia

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** equivalencias, tabla de decisión, pruebas negativas.

**Entrada:** Usuario de aplicación 42; búsqueda de pertenencia con permission denied.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `AUTH-08`.

**Esperado:** DATABASE_ERROR, acceso denegado; exactamente dos consultas, sin fallback adicional.

**Obtenido:** Aprobado: DATABASE_ERROR, acceso denegado; exactamente dos consultas, sin fallback adicional. Verificado en 1 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes reportadas:** 1; nombres completos y estados en el JSON.

<a id="auth-09"></a>
### AUTH-09 — ID de usuario vacío

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** equivalencias, tabla de decisión, pruebas negativas.

**Entrada:** Fila {}, id=null o id="".

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `AUTH-09`.

**Esperado:** APP_USER_NOT_FOUND; una sola consulta, sin buscar pertenencias.

**Obtenido:** Aprobado: APP_USER_NOT_FOUND; una sola consulta, sin buscar pertenencias. Verificado en 3 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes reportadas:** 3; nombres completos y estados en el JSON.

## Contexto REC

**Nivel:** Unidad de reglas de recomendación. **Requisitos:** R-FUN-01, R05, R06.

**Precondiciones:** Reglas existentes sin modificar; entradas de deuda/riesgo sintéticas.

**Comando:** `cd front; npm exec --no -- vitest run tests/unit/recommendation-decisions.test.ts`.

**Código:** [recommendation-decisions.test.ts](front/tests/unit/recommendation-decisions.test.ts).

**Evidencia:** [resumen-ci-normal.json](evidencias/e04/resumen-ci-normal.json).

<a id="rec-01"></a>
### REC-01 — Aplicar decisiones y precedencia de recomendaciones

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** tabla de decisión, valores límite, equivalencias.

**Entrada:** Siete combinaciones: ALTO con/sin contacto; mora 59/60; saldo 349.999/350.000; deuda cero.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `REC-01`.

**Esperado:** Tipos y urgencia de la tabla de decisión de CASOS_PRUEBA_CALIDAD.md; riesgo alto prevalece.

**Obtenido:** 7/7 variantes aprobadas: llamado o revisión urgente según riesgo/contacto, revisión a 60 días, recordatorio a 59 o saldo 350.000, seguimiento con saldo inferior sin mora.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes reportadas:** 7; nombres completos y estados en el JSON.

## Contexto GATE

**Nivel:** Infraestructura de calidad; unidad, contratos y ensayo CI. **Requisitos:** R07, R08, R09, R10, R17.

**Precondiciones:** Reportes controlados; base fija 531996f51243dc3d4c5a607338e2f35e32313f6b; umbrales 60/80/5 sin modificar.

**Comando:** `python -m unittest discover -s quality/tests -v`.

**Código:** [test_gates.py](quality/tests/test_gates.py), [test_ci.py](quality/tests/test_ci.py).

**Evidencia:** [gate-normal.json](evidencias/e04/gate-normal.json), [gate-critical-probe.json](evidencias/e04/gate-critical-probe.json), [ensayo-critico.json](evidencias/e04/ensayo-critico.json).

<a id="gate-01"></a>
### GATE-01 — Cobertura existente

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** valores límite, contratos de infraestructura, pruebas negativas.

**Entrada:** 5.999/10.000 y 6.000/10.000 sentencias.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `test_existing_coverage_5999_fails_and_60_passes`.

**Esperado:** 59,99 % falla; 60 % pasa.

**Obtenido:** Contrato aprobado: 59,99 % falla; 60 % pasa. Los métodos indicados están aprobados en el log de infraestructura.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

<a id="gate-02"></a>
### GATE-02 — Cobertura nueva

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** valores límite, contratos de infraestructura, pruebas negativas.

**Entrada:** 7.999/10.000 y 8.000/10.000 líneas; diff contra base fija.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `test_new_coverage_7999_fails_and_80_passes; test_new_lines_below_80_block_whole_evaluation`.

**Esperado:** 79,99 % falla; 80 % pasa; módulo insuficiente bloquea evaluación.

**Obtenido:** Contrato aprobado: 79,99 % falla; 80 % pasa; módulo insuficiente bloquea evaluación. Los métodos indicados están aprobados en el log de infraestructura.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

<a id="gate-03"></a>
### GATE-03 — Duplicación

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** valores límite, contratos de infraestructura, pruebas negativas.

**Entrada:** 500/10.000, 501/10.000 y 50.001/1.000.000 líneas duplicadas.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `test_duplication_5_passes_501_fails_without_rounding`.

**Esperado:** 5 % pasa; 5,01 % y 5,0001 % fallan sin redondear.

**Obtenido:** Contrato aprobado: 5 % pasa; 5,01 % y 5,0001 % fallan sin redondear. Los métodos indicados están aprobados en el log de infraestructura.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

<a id="gate-04"></a>
### GATE-04 — Crítico versus estilo

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** valores límite, contratos de infraestructura, pruebas negativas.

**Entrada:** F821, I001, no-unsafe-finally y parsing fatal.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `test_critical_and_noncritical_rules_remain_separate; test_eslint_selected_rule_and_parse_error_are_critical`.

**Esperado:** Crítico bloquea como crítico; estilo bloquea análisis, con lista de críticos vacía.

**Obtenido:** Contrato aprobado: Crítico bloquea como crítico; estilo bloquea análisis, con lista de críticos vacía. Los métodos indicados están aprobados en el log de infraestructura.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

<a id="gate-05"></a>
### GATE-05 — Reportes inválidos

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** valores límite, contratos de infraestructura, pruebas negativas.

**Entrada:** JSON roto/null/lista, ausencia de LCOV/JSON/lint, JUnit roto y conteos discrepantes.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `test_missing_required_reports_never_pass; test_json_and_counts_corruption_preserve_a_failure_explanation; test_test_reports_are_required_and_must_agree`.

**Esperado:** Evaluación fallida y explicación conservada, nunca aprobación por ausencia.

**Obtenido:** Contrato aprobado: Evaluación fallida y explicación conservada, nunca aprobación por ausencia. Los métodos indicados están aprobados en el log de infraestructura.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

<a id="gate-06"></a>
### GATE-06 — Base y procedencia

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** valores límite, contratos de infraestructura, pruebas negativas.

**Entrada:** Base no resoluble/cambiada a HEAD; SHA/run/intento incorrectos; manifiesto duplicado.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `test_absent_base_cannot_silently_become_head; test_wrong_sha_run_attempt_and_duplicate_manifest_are_rejected`.

**Esperado:** Rechazar sin vaciar el diff ni mezclar ejecuciones.

**Obtenido:** Contrato aprobado: Rechazar sin vaciar el diff ni mezclar ejecuciones. Los métodos indicados están aprobados en el log de infraestructura.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

<a id="gate-07"></a>
### GATE-07 — Sin código nuevo

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** valores límite, contratos de infraestructura, pruebas negativas.

**Entrada:** Diff vacío con reportes válidos, y repetición con reporte backend eliminado.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `test_no_new_lines_has_null_percentage_not_invented_100; test_no_diff_does_not_hide_missing_reports`.

**Esperado:** 0 líneas, pct=null, no aplica; reporte ausente sigue bloqueando.

**Obtenido:** Contrato aprobado: 0 líneas, pct=null, no aplica; reporte ausente sigue bloqueando. Los métodos indicados están aprobados en el log de infraestructura.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

<a id="gate-08"></a>
### GATE-08 — Mapeo de diff y rutas

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** valores límite, contratos de infraestructura, pruebas negativas.

**Entrada:** Renombre real en Git temporal con espacio en nombre; borrados; rutas Windows/Linux.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `test_real_git_rename_is_a_complete_new_file_with_no_renames; test_deleted_lines_do_not_enter_new_denominator; test_windows_linux_and_relative_paths_are_equivalent`.

**Esperado:** Alta completa del nuevo archivo, sin líneas borradas; normalización equivalente.

**Obtenido:** Contrato aprobado: Alta completa del nuevo archivo, sin líneas borradas; normalización equivalente. Los métodos indicados están aprobados en el log de infraestructura.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

<a id="gate-09"></a>
### GATE-09 — Propagación de fallos

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** valores límite, contratos de infraestructura, pruebas negativas.

**Entrada:** Build con salida 7/control ausente; evaluador fallido y manifiesto inválido.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `test_failed_build_and_missing_control_block; test_gate_failure_reaches_summary_exit_and_report; test_invalid_manifest_preserves_failure_report`.

**Esperado:** No aprobación global; salida 1 y gate/summary persistidos.

**Obtenido:** Contrato aprobado: No aprobación global; salida 1 y gate/summary persistidos. Los métodos indicados están aprobados en el log de infraestructura.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

<a id="gate-10"></a>
### GATE-10 — Ensayo remoto controlado

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** valores límite, contratos de infraestructura, pruebas negativas.

**Entrada:** Mismo SHA c95a9ab: push normal frente a workflow_dispatch con crítico sintético F821 en reporte.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `test_controlled_probe_retains_original_and_blocks_critical_gate; test_probe_is_restricted_to_manual_opt_in`.

**Esperado:** Normal aprobado; ensayo con suites aprobadas pero job resumen fallido, ocho gates pasan y dos bloquean.

**Obtenido:** Contrato aprobado: Normal aprobado; ensayo con suites aprobadas pero job resumen fallido, ocho gates pasan y dos bloquean. Los métodos indicados están aprobados en el log de infraestructura.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

## Contexto COB

**Nivel:** Medición de cobertura y gate CI. **Requisitos:** R07, R08.

**Precondiciones:** Mismo alcance de 55 archivos frontend y método Vitest/V8 4.1.12; ampliación de pruebas E04.

**Comando:** `python quality/ci.py run frontend --output .quality/nueva-ejecucion/frontend; python quality/ci.py run backend --output .quality/nueva-ejecucion/backend; python quality/ci.py summary --artifacts .quality/nueva-ejecucion --output .quality/nuevo-resumen`.

**Código:** [gates.py](quality/gates.py), [auth-service.test.ts](front/tests/unit/auth-service.test.ts), [recommendation-decisions.test.ts](front/tests/unit/recommendation-decisions.test.ts).

**Evidencia:** [gate-normal.json](evidencias/e04/gate-normal.json).

<a id="cob-01"></a>
### COB-01 — Cerrar insuficiencia de cobertura

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** cobertura, regresión del control.

**Entrada:** 26 pruebas adicionales; mismo denominador de 1.280 sentencias.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `COB-01`.

**Esperado:** Sentencias >=60 % y gate nuevo >=80 % por módulo, sin reducir alcance.

**Obtenido:** 791/1.280, Vitest 61,79 %; nuevo frontend 28/28 y backend 15/17.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

## Contexto AUD

**Nivel:** Control de dependencias y contratos de política. **Requisitos:** R09, R17.

**Precondiciones:** Lockfile y política E02; excepción OBS-DEP-001 vigente únicamente para la cadena exacta, sin prórroga.

**Comando:** `python quality/ci.py run frontend --output .quality/nueva-auditoria/frontend`.

**Código:** [audit_policy.py](quality/audit_policy.py), [test_ci.py](quality/tests/test_ci.py), [npm-audit-policy.json](quality/npm-audit-policy.json).

**Evidencia:** [resumen-ci-normal.json](evidencias/e04/resumen-ci-normal.json).

<a id="aud-01"></a>
### AUD-01 — Evaluar la excepción revisada de desarrollo

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** equivalencias, política temporal.

**Entrada:** Cadena de cinco altos de desarrollo exacta; auditoría completa salida cruda 1.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `AUD-01`.

**Esperado:** Mantener los cinco avisos visibles y aceptación solo según política vigente; variaciones o vencimiento bloquean.

**Obtenido:** 5 altos dev, 0 críticos; salida cruda 1 y accepted=true. OBS-DEP-001 permanece abierta.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

<a id="aud-prod-01"></a>
### AUD-PROD-01 — Exigir dependencias productivas sin avisos

**Estado:** aprobado. **Responsable:** Axel Azcune. **Técnicas:** control de dependencias.

**Entrada:** Auditoría npm --omit=dev.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `AUD-PROD-01`.

**Esperado:** 0 avisos y salida cruda 0.

**Obtenido:** 0 avisos productivos y salida 0.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

## Contexto SQL

**Nivel:** Inspección SQL real READ ONLY con ROLLBACK; sin Auth HTTP. **Requisitos:** R-SEG-01, R-SEG-02, R-INT-01, R-DAT-01.

**Precondiciones:** Snapshot de inspección del proyecto conectado el 21/10; conexión administrativa autorizada, sin escrituras.

**Comando:** `Procedimiento SQL seleccionado en database/verificacion_supabase_solo_lectura.sql; no ejecutar cargas ni modificaciones.`.

**Código:** [verificacion_supabase_solo_lectura.sql](database/verificacion_supabase_solo_lectura.sql).

**Evidencia:** [supabase-2026-10-21.json](evidencias/supabase-2026-10-21.json), [REVISION_SUPABASE.md](REVISION_SUPABASE.md).

<a id="sup-data-01"></a>
### SUP-DATA-01 — Detectar riesgo de truncamiento

**Estado:** detección histórica; corregido en regresión aislada. **Responsable:** Axel Azcune. **Técnicas:** inspección de volumen y código.

**Entrada:** Volumen 56.286 deudas y 3.007 relaciones; loaders originales con una consulta limit 3000.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `SUP-DATA-01`.

**Esperado:** El acceso de aplicación debe cubrir el conjunto autorizado completo.

**Obtenido:** La estrategia original no cubre ese volumen; condición detectada. Corrección aislada E03 vinculada a DAT-06.

**Fecha/versión/entorno:** 2026-10-21T18:49:43Z; `531996f51243dc3d4c5a607338e2f35e32313f6b (cliente inspeccionado); estado remoto según snapshot`; Supabase conectado, transacción SQL administrativa READ ONLY con ROLLBACK.

<a id="sup-int-01"></a>
### SUP-INT-01 — Inspeccionar integridad seleccionada

**Estado:** aprobado en alcance SQL. **Responsable:** Axel Azcune. **Técnicas:** integridad de datos, inspección SQL.

**Entrada:** Conteos, claves, huérfanos y agregados del snapshot observado.

**Pasos:** Preparar la entrada indicada según las precondiciones del contexto. Ejecutar el comando/procedimiento del contexto y seleccionar el caso indicado. Comparar cada variante con el esperado; conservar salida, fecha, entorno y SHA. Selector: `SUP-INT-01`.

**Esperado:** Sin duplicados/huérfanos/discrepancias en los controles seleccionados.

**Obtenido:** Sin anomalías seleccionadas en la inspección; no se reejecutó ETL ni se probó idempotencia real.

**Fecha/versión/entorno:** 2026-10-21T18:49:43Z; `531996f51243dc3d4c5a607338e2f35e32313f6b (cliente inspeccionado); estado remoto según snapshot`; Supabase conectado, transacción SQL administrativa READ ONLY con ROLLBACK.

## Contexto EXT

**Nivel:** Integracion real Auth/Data API con cliente productivo. **Requisitos:** R06, R13, R14, R16, R17, R-SEG-01, R-SEG-02.

**Precondiciones:** EQUITAS-TP-TESTING iylwghgvtydpmwidojdo con migraciones y fixtures e06-v1; cuatro cuentas reales; clave publicable y secreto SUPABASE_TEST_CONFIG. Sin reemplazos de modulos/HTTP.

**Comando:** `python quality/supabase_integration.py --config-file .quality/e06/credentials.json --output .quality/e06/nueva-ejecucion`.

**Código:** [supabase.integration.test.ts](front/tests/external/supabase.integration.test.ts), [supabase_integration.py](quality/supabase_integration.py), [supabase-testing.json](quality/supabase-testing.json).

**Evidencia:** [supabase-ci.json](evidencias/e06/supabase-ci.json), [red-green.json](evidencias/e06/red-green.json), [ci-main.json](evidencias/e06/ci-main.json).

<a id="sup-rls-01"></a>
### SUP-RLS-01 — Denegar lectura anónima en controles SQL

**Estado:** aprobado HTTP en testing. **Responsable:** Axel Azcune. **Técnicas:** particion de autorizacion, integracion externa real.

**Entrada:** Cliente con clave publicable y sin sesion.

**Pasos:** Preparar las fixtures y el secreto segun SUPABASE_TESTING_CALIDAD.md. Iniciar sesion por Supabase Auth HTTP con la identidad indicada, salvo el caso anonimo. Ejecutar las consultas/operaciones del selector con clave publicable y el JWT normal. Comparar filas, contexto o codigo de error exactos; cerrar las sesiones y conservar JUnit/JSON. Selector: `SUP-RLS-01`.

**Esperado:** Cero filas en las 23 tablas.

**Obtenido:** Aprobado en testing: Cero filas en las 23 tablas.

**Fecha/versión/entorno:** 2026-10-21; `4bb783f1a34c25e9003ee6ece66825668b1c1106`; GitHub Actions Ubuntu 24.04 → Supabase cloud iylwghgvtydpmwidojdo.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39686380481).

**Variantes reportadas:** 1; nombres completos y estados en el JSON.

**Historia conservada:** ficha y contexto anteriores en `historial_E05` del JSON; el resultado HTTP actual no reescribe el estado del proyecto original.

<a id="sup-rls-02"></a>
### SUP-RLS-02 — Denegar cartera sin pertenencia

**Estado:** aprobado HTTP en testing. **Responsable:** Axel Azcune. **Técnicas:** particion de autorizacion, integracion externa real.

**Entrada:** Cuenta Auth none y usuario app 910003, sin membresia.

**Pasos:** Preparar las fixtures y el secreto segun SUPABASE_TESTING_CALIDAD.md. Iniciar sesion por Supabase Auth HTTP con la identidad indicada, salvo el caso anonimo. Ejecutar las consultas/operaciones del selector con clave publicable y el JWT normal. Comparar filas, contexto o codigo de error exactos; cerrar las sesiones y conservar JUnit/JSON. Selector: `SUP-RLS-02`.

**Esperado:** TENANT_ACCESS_NOT_FOUND; cero negocio/tenant/catalogos, solo usuario propio y ninguna membresia.

**Obtenido:** Aprobado en testing: TENANT_ACCESS_NOT_FOUND; cero negocio/tenant/catalogos, solo usuario propio y ninguna membresia.

**Fecha/versión/entorno:** 2026-10-21; `4bb783f1a34c25e9003ee6ece66825668b1c1106`; GitHub Actions Ubuntu 24.04 → Supabase cloud iylwghgvtydpmwidojdo.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39686380481).

**Variantes reportadas:** 1; nombres completos y estados en el JSON.

**Historia conservada:** ficha y contexto anteriores en `historial_E05` del JSON; el resultado HTTP actual no reescribe el estado del proyecto original.

<a id="sup-auth-01"></a>
### SUP-AUTH-01 — Autenticar y recuperar contexto real de testing

**Estado:** aprobado HTTP en testing. **Responsable:** Axel Azcune. **Técnicas:** integración externa.

**Entrada:** Credenciales A y B; usuarios app 910001/910002; tenant A/B; rol 910001.

**Pasos:** Preparar las fixtures y el secreto segun SUPABASE_TESTING_CALIDAD.md. Iniciar sesion por Supabase Auth HTTP con la identidad indicada, salvo el caso anonimo. Ejecutar las consultas/operaciones del selector con clave publicable y el JWT normal. Comparar filas, contexto o codigo de error exactos; cerrar las sesiones y conservar JUnit/JSON. Selector: `SUP-AUTH-01`.

**Esperado:** Auth valido y contexto exacto auth UUID/app ID/tenant ID/rol; cada usuario ve solo su usuario y membresia propios.

**Obtenido:** Aprobado en testing: Auth valido y contexto exacto auth UUID/app ID/tenant ID/rol; cada usuario ve solo su usuario y membresia propios.

**Fecha/versión/entorno:** 2026-10-21; `4bb783f1a34c25e9003ee6ece66825668b1c1106`; GitHub Actions Ubuntu 24.04 → Supabase cloud iylwghgvtydpmwidojdo.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39686380481).

**Variantes reportadas:** 2; nombres completos y estados en el JSON.

**Historia conservada:** ficha y contexto anteriores en `historial_E05` del JSON; el resultado HTTP actual no reescribe el estado del proyecto original.

<a id="sup-auth-02"></a>
### SUP-AUTH-02 — Credenciales inválidas

**Estado:** aprobado HTTP en testing. **Responsable:** Axel Azcune. **Técnicas:** particiones de autorización, integración externa.

**Entrada:** Email A y password incorrecto.

**Pasos:** Preparar las fixtures y el secreto segun SUPABASE_TESTING_CALIDAD.md. Iniciar sesion por Supabase Auth HTTP con la identidad indicada, salvo el caso anonimo. Ejecutar las consultas/operaciones del selector con clave publicable y el JWT normal. Comparar filas, contexto o codigo de error exactos; cerrar las sesiones y conservar JUnit/JSON. Selector: `SUP-AUTH-02`.

**Esperado:** invalid_credentials; session=null; cero negocio/tenant/catalogos.

**Obtenido:** Aprobado en testing: invalid_credentials; session=null; cero negocio/tenant/catalogos.

**Fecha/versión/entorno:** 2026-10-21; `4bb783f1a34c25e9003ee6ece66825668b1c1106`; GitHub Actions Ubuntu 24.04 → Supabase cloud iylwghgvtydpmwidojdo.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39686380481).

**Variantes reportadas:** 1; nombres completos y estados en el JSON.

**Historia conservada:** ficha y contexto anteriores en `historial_E05` del JSON; el resultado HTTP actual no reescribe el estado del proyecto original.

<a id="sup-auth-03"></a>
### SUP-AUTH-03 — Logout real

**Estado:** aprobado HTTP en testing. **Responsable:** Axel Azcune. **Técnicas:** particiones de autorización, integración externa.

**Entrada:** Login A, lectura positiva, signOut y nueva lectura con el mismo cliente.

**Pasos:** Preparar las fixtures y el secreto segun SUPABASE_TESTING_CALIDAD.md. Iniciar sesion por Supabase Auth HTTP con la identidad indicada, salvo el caso anonimo. Ejecutar las consultas/operaciones del selector con clave publicable y el JWT normal. Comparar filas, contexto o codigo de error exactos; cerrar las sesiones y conservar JUnit/JSON. Selector: `SUP-AUTH-03`.

**Esperado:** Sesion y usuario del cliente nulos; nueva lectura como anonimo devuelve cero negocio/tenant/catalogos. No prueba JWT copiados.

**Obtenido:** Aprobado en testing: Sesion y usuario del cliente nulos; nueva lectura como anonimo devuelve cero negocio/tenant/catalogos. No prueba JWT copiados.

**Fecha/versión/entorno:** 2026-10-21; `4bb783f1a34c25e9003ee6ece66825668b1c1106`; GitHub Actions Ubuntu 24.04 → Supabase cloud iylwghgvtydpmwidojdo.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39686380481).

**Variantes reportadas:** 1; nombres completos y estados en el JSON.

**Historia conservada:** ficha y contexto anteriores en `historial_E05` del JSON; el resultado HTTP actual no reescribe el estado del proyecto original.

<a id="sup-data-02"></a>
### SUP-DATA-02 — Lectura positiva por tenant

**Estado:** aprobado HTTP en testing. **Responsable:** Axel Azcune. **Técnicas:** particiones de autorización, integración externa.

**Entrada:** Cartera sintetica A/B, IDs 910001/910002; montos 1250/2500 y riesgos 20/80.

**Pasos:** Preparar las fixtures y el secreto segun SUPABASE_TESTING_CALIDAD.md. Iniciar sesion por Supabase Auth HTTP con la identidad indicada, salvo el caso anonimo. Ejecutar las consultas/operaciones del selector con clave publicable y el JWT normal. Comparar filas, contexto o codigo de error exactos; cerrar las sesiones y conservar JUnit/JSON. Selector: `SUP-DATA-02`.

**Esperado:** Una fila propia por cada una de nueve tablas de negocio; montos y riesgos exactos; los once catalogos comparten la fila 910001.

**Obtenido:** Aprobado en testing: Una fila propia por cada una de nueve tablas de negocio; montos y riesgos exactos; los once catalogos comparten la fila 910001.

**Fecha/versión/entorno:** 2026-10-21; `4bb783f1a34c25e9003ee6ece66825668b1c1106`; GitHub Actions Ubuntu 24.04 → Supabase cloud iylwghgvtydpmwidojdo.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39686380481).

**Variantes reportadas:** 2; nombres completos y estados en el JSON.

**Historia conservada:** ficha y contexto anteriores en `historial_E05` del JSON; el resultado HTTP actual no reescribe el estado del proyecto original.

<a id="sup-rls-03"></a>
### SUP-RLS-03 — A no accede a B

**Estado:** aprobado HTTP en testing. **Responsable:** Axel Azcune. **Técnicas:** particion de autorizacion, integracion externa real.

**Entrada:** Login A; filtros explicitos por ID 910002 de B.

**Pasos:** Preparar las fixtures y el secreto segun SUPABASE_TESTING_CALIDAD.md. Iniciar sesion por Supabase Auth HTTP con la identidad indicada, salvo el caso anonimo. Ejecutar las consultas/operaciones del selector con clave publicable y el JWT normal. Comparar filas, contexto o codigo de error exactos; cerrar las sesiones y conservar JUnit/JSON. Selector: `SUP-RLS-03`.

**Esperado:** Cero filas B en nueve tablas de negocio; solo tenant A.

**Obtenido:** Aprobado en testing: Cero filas B en nueve tablas de negocio; solo tenant A.

**Fecha/versión/entorno:** 2026-10-21; `4bb783f1a34c25e9003ee6ece66825668b1c1106`; GitHub Actions Ubuntu 24.04 → Supabase cloud iylwghgvtydpmwidojdo.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39686380481).

**Variantes reportadas:** 1; nombres completos y estados en el JSON.

**Historia conservada:** ficha y contexto anteriores en `historial_E05` del JSON; el resultado HTTP actual no reescribe el estado del proyecto original.

<a id="sup-rls-04"></a>
### SUP-RLS-04 — B no accede a A

**Estado:** aprobado HTTP en testing. **Responsable:** Axel Azcune. **Técnicas:** particion de autorizacion, integracion externa real.

**Entrada:** Login B; filtros explicitos por ID 910001 de A.

**Pasos:** Preparar las fixtures y el secreto segun SUPABASE_TESTING_CALIDAD.md. Iniciar sesion por Supabase Auth HTTP con la identidad indicada, salvo el caso anonimo. Ejecutar las consultas/operaciones del selector con clave publicable y el JWT normal. Comparar filas, contexto o codigo de error exactos; cerrar las sesiones y conservar JUnit/JSON. Selector: `SUP-RLS-04`.

**Esperado:** Cero filas A en nueve tablas de negocio; solo tenant B.

**Obtenido:** Aprobado en testing: Cero filas A en nueve tablas de negocio; solo tenant B.

**Fecha/versión/entorno:** 2026-10-21; `4bb783f1a34c25e9003ee6ece66825668b1c1106`; GitHub Actions Ubuntu 24.04 → Supabase cloud iylwghgvtydpmwidojdo.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39686380481).

**Variantes reportadas:** 1; nombres completos y estados en el JSON.

**Historia conservada:** ficha y contexto anteriores en `historial_E05` del JSON; el resultado HTTP actual no reescribe el estado del proyecto original.

<a id="sup-rls-05"></a>
### SUP-RLS-05 — Pertenencia inactiva

**Estado:** aprobado HTTP en testing. **Responsable:** Axel Azcune. **Técnicas:** particion de autorizacion, integracion externa real.

**Entrada:** Login inactive; app 910004 con membresia status=false en A.

**Pasos:** Preparar las fixtures y el secreto segun SUPABASE_TESTING_CALIDAD.md. Iniciar sesion por Supabase Auth HTTP con la identidad indicada, salvo el caso anonimo. Ejecutar las consultas/operaciones del selector con clave publicable y el JWT normal. Comparar filas, contexto o codigo de error exactos; cerrar las sesiones y conservar JUnit/JSON. Selector: `SUP-RLS-05`.

**Esperado:** TENANT_ACCESS_INACTIVE; cero negocio/tenant/catalogos; usuario y membresia propios visibles para diagnostico.

**Obtenido:** Aprobado en testing: TENANT_ACCESS_INACTIVE; cero negocio/tenant/catalogos; usuario y membresia propios visibles para diagnostico.

**Fecha/versión/entorno:** 2026-10-21; `4bb783f1a34c25e9003ee6ece66825668b1c1106`; GitHub Actions Ubuntu 24.04 → Supabase cloud iylwghgvtydpmwidojdo.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39686380481).

**Variantes reportadas:** 1; nombres completos y estados en el JSON.

**Historia conservada:** ficha y contexto anteriores en `historial_E05` del JSON; el resultado HTTP actual no reescribe el estado del proyecto original.

<a id="sup-write-01"></a>
### SUP-WRITE-01 — Denegar escrituras desde cliente normal

**Estado:** aprobado HTTP en testing. **Responsable:** Axel Azcune. **Técnicas:** particion por operacion, integracion externa.

**Entrada:** Login A; INSERT de fixture 919999, UPDATE y DELETE sobre objeto A.

**Pasos:** Preparar las fixtures y el secreto segun SUPABASE_TESTING_CALIDAD.md. Iniciar sesion por Supabase Auth HTTP con la identidad indicada, salvo el caso anonimo. Ejecutar las consultas/operaciones del selector con clave publicable y el JWT normal. Comparar filas, contexto o codigo de error exactos; cerrar las sesiones y conservar JUnit/JSON. Selector: `SUP-WRITE-01`.

**Esperado:** Las tres operaciones devuelven 42501; IDs y descripcion originales del objeto A conservados.

**Obtenido:** Aprobado en testing: Las tres operaciones devuelven 42501; IDs y descripcion originales del objeto A conservados.

**Fecha/versión/entorno:** 2026-10-21; `4bb783f1a34c25e9003ee6ece66825668b1c1106`; GitHub Actions Ubuntu 24.04 → Supabase cloud iylwghgvtydpmwidojdo.

**Ejecución:** [CI de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39686380481).

**Variantes reportadas:** 1; nombres completos y estados en el JSON.

La [matriz](TRAZABILIDAD_CALIDAD.md) enlaza los resultados con Issues. DEF-SUP-001 permanece abierto para el proyecto original; está corregido en testing.

## Casos incorporados en E07

### DEP-01

**Objetivo:** Metadata de despliegue pública, exacta y sin caché. **Nivel:** Unidad. **Issue:** [CAS-SMOKE #10](https://github.com/ImaDecara/Tesis-EQUITAS/issues/10).

**Entrada:** SHA/branch/entorno de Vercel; URL Supabase válida, vacía, inválida o ajena; fallback local.

**Esperado:** JSON contiene solo sourceSha/sourceBranch/environment/supabaseProjectRef; sin claves y Cache-Control no-store.

**Obtenido:** 5/5 variantes aprobadas; SHA `a6497a73b226f9d27abb4e9080d5540503d95539`. [Ejecución](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39955381596), [evidencia](evidencias/e07/resumen-ci.json). DEP-02 cuenta como infraestructura; SMOKE-01 es un recorrido con cinco comprobaciones.

**Comando:** `cd front; npm exec --no -- vitest run tests/unit/build-info.test.ts`. Campos y variantes exactas en el catálogo JSON.

### DEP-02

**Objetivo:** Seleccionar únicamente el preview confiable del mismo SHA y rama. **Nivel:** Infraestructura. **Issue:** [CAS-SMOKE #10](https://github.com/ImaDecara/Tesis-EQUITAS/issues/10).

**Entrada:** Deployments listos/pendientes/fallidos; origen propio/ajeno; CI y build-info válidos o incoherentes.

**Esperado:** Solo se acepta Preview de Vercel, rama quality/tp-testing, SHA/repositorio/evento/entorno y Supabase esperados; errores y URLs ajenas se rechazan.

**Obtenido:** 7/7 variantes aprobadas; SHA `a6497a73b226f9d27abb4e9080d5540503d95539`. [Ejecución](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39955381596), [evidencia](evidencias/e07/resumen-ci.json). DEP-02 cuenta como infraestructura; SMOKE-01 es un recorrido con cinco comprobaciones.

**Comando:** `python -m unittest discover -s quality/tests -p test_preview.py -v`. Campos y variantes exactas en el catálogo JSON.

### SMOKE-01

**Objetivo:** Recorrido autenticado del preview con datos conocidos. **Nivel:** Sistema / navegador / integración real. **Issue:** [CAS-SMOKE #10](https://github.com/ImaDecara/Tesis-EQUITAS/issues/10).

**Entrada:** Preview nuevo; cuenta sintética A; TP-A; persona A; deuda ARS 1250; filtro E07-NO-EXISTE.

**Esperado:** Cinco comprobaciones: disponibilidad/procedencia; login; dashboard 1250 y B ausente; filtro vacío/limpieza y /people con título, persona e importe; logout y acceso protegido denegado.

**Obtenido:** 1/1 variantes aprobadas; SHA `a6497a73b226f9d27abb4e9080d5540503d95539`. [Ejecución](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39955572523), [evidencia](evidencias/e07/smoke.json). DEP-02 cuenta como infraestructura; SMOKE-01 es un recorrido con cinco comprobaciones.

**Comando:** `cd front; npm run test:smoke -- --deployment ../.quality/preview/deployment.json --output ../.quality/smoke-repeticion`. Campos y variantes exactas en el catálogo JSON.

### PERF-01

**Objetivo:** Estrés progresivo de la API de scoring. **Entrada:** 1/5/10/20/40 usuarios, 60 s por escalón; warmup 30 s y drenajes 10 s.

**Esperado:** Hasta diez usuarios: p95 <=2000 ms, errores <=1 %, cero contenido incorrecto, mínimos de muestras. Por encima del objetivo se informa degradación sin alterar el SLO.

**Obtenido:** 1/1 aprobadas en su alcance; [reporte](evidencias/e08/stress/run.json), [CAS-PERF #12](https://github.com/ImaDecara/Tesis-EQUITAS/issues/12). SHA `f6f83f9a3172fc2e42912305a181057130d9577b`. Detalles, pasos y comandos en el catálogo estructurado y la ficha E08. PERF-INFRA cuenta por separado; las solicitudes de carga no son tests individuales.

### PERF-02

**Objetivo:** Esfuerzo sostenido de la API de scoring. **Entrada:** Diez usuarios durante 600 s tras 30 s de warmup.

**Esperado:** Mismos SLO por operación y agregado; fase completa y serie temporal/recursos conservados.

**Obtenido:** 1/1 aprobadas en su alcance; [reporte](evidencias/e08/soak/run.json), [CAS-PERF #12](https://github.com/ImaDecara/Tesis-EQUITAS/issues/12). SHA `f6f83f9a3172fc2e42912305a181057130d9577b`. Detalles, pasos y comandos en el catálogo estructurado y la ficha E08. PERF-INFRA cuenta por separado; las solicitudes de carga no son tests individuales.

### PERF-INFRA

**Objetivo:** Evitar cargas con CI/evidencia incoherentes. **Entrada:** Fixture/protocolo, CI ajeno, tiempos cortos, contenido/errores, percentiles y salida corrupta o interrumpida.

**Esperado:** La evidencia inválida/incompleta o de CI ajeno se rechaza; solo la campaña completa que satisface criterios pasa.

**Obtenido:** 11/11 aprobadas en su alcance; [reporte](evidencias/e08/ci-summary.json), [CAS-PERF #12](https://github.com/ImaDecara/Tesis-EQUITAS/issues/12). SHA `f6f83f9a3172fc2e42912305a181057130d9577b`. Detalles, pasos y comandos en el catálogo estructurado y la ficha E08. PERF-INFRA cuenta por separado; las solicitudes de carga no son tests individuales.
