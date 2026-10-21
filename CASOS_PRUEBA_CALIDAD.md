# Casos de prueba, técnicas y resultados — EQUITAS

**Formalización E05, 21/10/2026. Responsable:** Axel Azcune (`AxAzc`). Los criterios y resultados de E03/E04 conservan sus versiones originales; documentarlos aquí no crea nuevas ejecuciones.

El catálogo contiene **49 IDs de caso/familia seleccionados**, con variantes parametrizadas. No equivale a 49 pruebas nuevas. El [inventario completo](calidad/inventario-pruebas.json) conserva **162 aprobadas, 0 fallidas y 1 omitida** de producto y **41 de infraestructura por separado**, extraídas de los reportes E04. Los casos DAT/FIXTURE, AUTH y REC representan 68 variantes aprobadas de esas suites; el resto de la línea base permanece en el inventario y sus fuentes.

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

Esta tabla está ejecutada con dobles. No demuestra políticas de la base real. SUP-RLS-02 conserva un fallo SQL y la integración HTTP sigue pendiente E06.

## Catálogo y fichas

| ID | Objetivo | Estado | Grupo de seguimiento |
| --- | --- | --- | --- |
| [DAT-01](#dat-01) | Tabla vacía | aprobado | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) |
| [DAT-02](#dat-02) | Página parcial | aprobado | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) |
| [DAT-03](#dat-03) | Una página exacta | aprobado | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) |
| [DAT-04](#dat-04) | Dos páginas con última parcial | aprobado | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) |
| [DAT-05](#dat-05) | Múltiplo exacto | aprobado | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) |
| [DAT-06](#dat-06) | Recuperar más de 3.000 filas en ambas rutas | aprobado | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) |
| [DAT-07](#dat-07) | Evitar éxito con tablas parciales | aprobado | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) |
| [DAT-08](#dat-08) | Preservar agregados y relaciones entre páginas | aprobado | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) |
| [DAT-09](#dat-09) | Sin cliente/credenciales | aprobado | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) |
| [DAT-10](#dat-10) | Cursor bigint preciso | aprobado | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) |
| [DAT-11](#dat-11) | ID inválido | aprobado | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) |
| [DAT-12](#dat-12) | Cursor/orden/duplicados inválidos | aprobado | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) |
| [DAT-13](#dat-13) | Respuesta no array | aprobado | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) |
| [DAT-14](#dat-14) | Contrato de advertencias | aprobado | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) |
| [FIXTURE-01](#fixture-01) | Verificar el doble HTTP del SDK | aprobado | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) |
| [AUTH-01](#auth-01) | Configuración ausente | aprobado | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) |
| [AUTH-02](#auth-02) | Contrato de login | aprobado | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) |
| [AUTH-03](#auth-03) | Cierre de sesión | aprobado | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) |
| [AUTH-04](#auth-04) | Mensajes de usuario | aprobado | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) |
| [AUTH-05](#auth-05) | Sesión ausente o inválida | aprobado | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) |
| [AUTH-06](#auth-06) | Contexto autorizado aislado | aprobado | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) |
| [AUTH-07](#auth-07) | Sin pertenencia activa | aprobado | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) |
| [AUTH-08](#auth-08) | Error de consulta de pertenencia | aprobado | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) |
| [AUTH-09](#auth-09) | ID de usuario vacío | aprobado | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) |
| [REC-01](#rec-01) | Aplicar decisiones y precedencia de recomendaciones | aprobado | [CAS-REC #7](https://github.com/ImaDecara/Tesis-EQUITAS/issues/7) |
| [GATE-01](#gate-01) | Cobertura existente | aprobado | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) |
| [GATE-02](#gate-02) | Cobertura nueva | aprobado | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) |
| [GATE-03](#gate-03) | Duplicación | aprobado | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) |
| [GATE-04](#gate-04) | Crítico versus estilo | aprobado | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) |
| [GATE-05](#gate-05) | Reportes inválidos | aprobado | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) |
| [GATE-06](#gate-06) | Base y procedencia | aprobado | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) |
| [GATE-07](#gate-07) | Sin código nuevo | aprobado | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) |
| [GATE-08](#gate-08) | Mapeo de diff y rutas | aprobado | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) |
| [GATE-09](#gate-09) | Propagación de fallos | aprobado | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) |
| [GATE-10](#gate-10) | Ensayo remoto controlado | aprobado | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) |
| [COB-01](#cob-01) | Cerrar insuficiencia de cobertura | aprobado | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) |
| [AUD-01](#aud-01) | Evaluar la excepción revisada de desarrollo | aprobado | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) |
| [AUD-PROD-01](#aud-prod-01) | Exigir dependencias productivas sin avisos | aprobado | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) |
| [SUP-RLS-01](#sup-rls-01) | Denegar lectura anónima en controles SQL | aprobado en alcance SQL | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) |
| [SUP-RLS-02](#sup-rls-02) | Denegar cartera sin pertenencia | fallido en alcance SQL; HTTP pendiente E06 | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) |
| [SUP-DATA-01](#sup-data-01) | Detectar riesgo de truncamiento | detección histórica; corregido en regresión aislada | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) |
| [SUP-INT-01](#sup-int-01) | Inspeccionar integridad seleccionada | aprobado en alcance SQL | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) |
| [SUP-AUTH-01](#sup-auth-01) | Autenticar y recuperar contexto real de testing | omitido; implementación E06 parcial | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) |
| [SUP-AUTH-02](#sup-auth-02) | Credenciales inválidas | pendiente | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) |
| [SUP-AUTH-03](#sup-auth-03) | Logout real | pendiente | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) |
| [SUP-DATA-02](#sup-data-02) | Lectura positiva por tenant | pendiente | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) |
| [SUP-RLS-03](#sup-rls-03) | A no accede a B | pendiente | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) |
| [SUP-RLS-04](#sup-rls-04) | B no accede a A | pendiente | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) |
| [SUP-RLS-05](#sup-rls-05) | Pertenencia inactiva | pendiente | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) |

## Contexto DAT

**Nivel:** Integración aislada y unidad del lector. **Requisitos:** R-DAT-01, R05, R06, R13, R14. **Responsable:** Axel Azcune.

**Precondiciones:** Dependencias E01 preparadas; SDK real con transporte HTTP sintético, sin credenciales reales; tablas estables durante la lectura.

**Comando/procedimiento:** `cd front; npm exec --no -- vitest run tests/integration/complete-data.integration.test.ts tests/unit/paginated-table-reader.test.ts`.

**Código:** [complete-data.integration.test.ts](front/tests/integration/complete-data.integration.test.ts), [paginated-table-reader.test.ts](front/tests/unit/paginated-table-reader.test.ts).

**Evidencia:** [comparacion-dat-06.json](evidencias/e03/comparacion-dat-06.json), [aserciones-red.json](evidencias/e03/aserciones-red.json), [resumen-ci-normal.json](evidencias/e04/resumen-ci-normal.json).

<a id="dat-01"></a>
### DAT-01 — Tabla vacía

**Estado:** aprobado. **Técnicas:** equivalencias, valores límite, regresión.

**Entrada:** Ambas rutas; N=0, máximo efectivo 1.000; IDs con huecos.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `DAT-01`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** 0 filas, IDs esperados ordenados y únicos, sin advertencias; 1 consultas a tabla principal, incluida vacía final.

**Obtenido:** Ambas rutas cumplen N=0, sin omisiones/duplicados y con 1 consultas.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes del reporte:** 2; nombres completos y estados en el JSON del catálogo.

<a id="dat-02"></a>
### DAT-02 — Página parcial

**Estado:** aprobado. **Técnicas:** equivalencias, valores límite, regresión.

**Entrada:** Ambas rutas; N=7, máximo efectivo 1.000; IDs con huecos.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `DAT-02`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** 7 filas, IDs esperados ordenados y únicos, sin advertencias; 2 consultas a tabla principal, incluida vacía final.

**Obtenido:** Ambas rutas cumplen N=7, sin omisiones/duplicados y con 2 consultas.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes del reporte:** 2; nombres completos y estados en el JSON del catálogo.

<a id="dat-03"></a>
### DAT-03 — Una página exacta

**Estado:** aprobado. **Técnicas:** equivalencias, valores límite, regresión.

**Entrada:** Ambas rutas; N=1000, máximo efectivo 1.000; IDs con huecos.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `DAT-03`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** 1000 filas, IDs esperados ordenados y únicos, sin advertencias; 2 consultas a tabla principal, incluida vacía final.

**Obtenido:** Ambas rutas cumplen N=1000, sin omisiones/duplicados y con 2 consultas.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes del reporte:** 2; nombres completos y estados en el JSON del catálogo.

<a id="dat-04"></a>
### DAT-04 — Dos páginas con última parcial

**Estado:** aprobado. **Técnicas:** equivalencias, valores límite, regresión.

**Entrada:** Ambas rutas; N=1001, máximo efectivo 1.000; IDs con huecos.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `DAT-04`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** 1001 filas, IDs esperados ordenados y únicos, sin advertencias; 3 consultas a tabla principal, incluida vacía final.

**Obtenido:** Ambas rutas cumplen N=1001, sin omisiones/duplicados y con 3 consultas.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes del reporte:** 2; nombres completos y estados en el JSON del catálogo.

<a id="dat-05"></a>
### DAT-05 — Múltiplo exacto

**Estado:** aprobado. **Técnicas:** equivalencias, valores límite, regresión.

**Entrada:** Ambas rutas; N=2000, máximo efectivo 1.000; IDs con huecos.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `DAT-05`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** 2000 filas, IDs esperados ordenados y únicos, sin advertencias; 3 consultas a tabla principal, incluida vacía final.

**Obtenido:** Ambas rutas cumplen N=2000, sin omisiones/duplicados y con 3 consultas.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes del reporte:** 2; nombres completos y estados en el JSON del catálogo.

<a id="dat-06"></a>
### DAT-06 — Recuperar más de 3.000 filas en ambas rutas

**Estado:** aprobado. **Técnicas:** equivalencias, límite superior histórico, regresión.

**Entrada:** 3.507 filas; IDs 3*(índice+1), orden físico inverso; servidor máximo 1.000/3.000 y variante 137.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `DAT-06`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** 3.507 recuperadas, 0 omitidas y 0 duplicadas; orden estable. Con máximo 137, 27 requests a tabla principal.

**Obtenido:** Seis variantes aprobadas. Antes: 1.000/3.507 o 3.000/3.507 en cuatro variantes; después 3.507/3.507 en todas.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes del reporte:** 6; nombres completos y estados en el JSON del catálogo.

<a id="dat-07"></a>
### DAT-07 — Evitar éxito con tablas parciales

**Estado:** aprobado. **Técnicas:** equivalencias inválidas, pruebas negativas, regresión.

**Entrada:** Fallo API/permisos/transporte después de página válida; excepciones del cliente.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `DAT-07`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** Descartar filas de tabla afectada, devolver advertencia, mantener tablas independientes y terminar.

**Obtenido:** Cinco variantes aprobadas: debtors independientes preservados, debts/detalles parciales descartados; error de red informado.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes del reporte:** 5; nombres completos y estados en el JSON del catálogo.

<a id="dat-08"></a>
### DAT-08 — Preservar agregados y relaciones entre páginas

**Estado:** aprobado. **Técnicas:** integración de relaciones, regresión.

**Entrada:** 3.507 deudas de importe 2, personas, contactos y relaciones; riesgo 99 en persona 10521 de última página.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `DAT-08`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** Deuda 7.014 y conteos 3.507; última persona con riesgo 99/contacto y deuda asociada 7.014; un riesgo alto, cero sin contacto.

**Obtenido:** Dos variantes aprobadas con esos valores exactos.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes del reporte:** 2; nombres completos y estados en el JSON del catálogo.

<a id="dat-09"></a>
### DAT-09 — Sin cliente/credenciales

**Estado:** aprobado. **Técnicas:** equivalencias, validación de entradas, pruebas negativas.

**Entrada:** Cliente null o credenciales deshabilitadas.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `DAT-09`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** 0 filas, advertencia de configuración, ninguna consulta.

**Obtenido:** Aprobado: 0 filas, advertencia de configuración, ninguna consulta. Verificado en 2 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes del reporte:** 2; nombres completos y estados en el JSON del catálogo.

<a id="dat-10"></a>
### DAT-10 — Cursor bigint preciso

**Estado:** aprobado. **Técnicas:** equivalencias, validación de entradas, pruebas negativas.

**Entrada:** IDs en texto 9007199254740993 y 9007199254740994.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `DAT-10`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** Preservar ambos IDs y filtros gt exactos sin pérdida de precisión.

**Obtenido:** Aprobado: Preservar ambos IDs y filtros gt exactos sin pérdida de precisión. Verificado en 1 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes del reporte:** 1; nombres completos y estados en el JSON del catálogo.

<a id="dat-11"></a>
### DAT-11 — ID inválido

**Estado:** aprobado. **Técnicas:** equivalencias, validación de entradas, pruebas negativas.

**Entrada:** undefined/null/true/texto inválido/1.5/entero no seguro.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `DAT-11`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** 0 filas y DATA_PAGINATION_INVALID; detener en primer request.

**Obtenido:** Aprobado: 0 filas y DATA_PAGINATION_INVALID; detener en primer request. Verificado en 6 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes del reporte:** 6; nombres completos y estados en el JSON del catálogo.

<a id="dat-12"></a>
### DAT-12 — Cursor/orden/duplicados inválidos

**Estado:** aprobado. **Técnicas:** equivalencias, validación de entradas, pruebas negativas.

**Entrada:** Cursor repetido, filas desordenadas o duplicadas.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `DAT-12`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** 0 filas y DATA_PAGINATION_INVALID; como máximo dos consultas.

**Obtenido:** Aprobado: 0 filas y DATA_PAGINATION_INVALID; como máximo dos consultas. Verificado en 3 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes del reporte:** 3; nombres completos y estados en el JSON del catálogo.

<a id="dat-13"></a>
### DAT-13 — Respuesta no array

**Estado:** aprobado. **Técnicas:** equivalencias, validación de entradas, pruebas negativas.

**Entrada:** Objeto {id:1} como página.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `DAT-13`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** 0 filas y advertencia DATA_PAGINATION_INVALID.

**Obtenido:** Aprobado: 0 filas y advertencia DATA_PAGINATION_INVALID. Verificado en 1 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes del reporte:** 1; nombres completos y estados en el JSON del catálogo.

<a id="dat-14"></a>
### DAT-14 — Contrato de advertencias

**Estado:** aprobado. **Técnicas:** equivalencias, validación de entradas, pruebas negativas.

**Entrada:** 42501 y mensajes permission denied/row-level security/RLS; mensaje vacío y código null.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `DAT-14`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** needsSelectPolicy=true en cuatro variantes de permisos; false con error vacío, mensaje desconocido y código omitido.

**Obtenido:** Aprobado: needsSelectPolicy=true en cuatro variantes de permisos; false con error vacío, mensaje desconocido y código omitido. Verificado en 5 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes del reporte:** 5; nombres completos y estados en el JSON del catálogo.

<a id="fixture-01"></a>
### FIXTURE-01 — Verificar el doble HTTP del SDK

**Estado:** aprobado. **Técnicas:** control del doble.

**Entrada:** 8 IDs invertidos; servidor máximo 3; limit 3000 y consulta ordenada gt 9 limit 3.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `FIXTURE-01`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** IDs [24,21,18] y [12,15,18]; segunda consulta order=id.asc, after=9, limit=3.

**Obtenido:** Ambas respuestas y parámetros exactos comprobados.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes del reporte:** 1; nombres completos y estados en el JSON del catálogo.

## Contexto AUTH

**Nivel:** Unidad / contrato aislado Auth y pertenencia. **Requisitos:** R-SEG-01, R05, R06. **Responsable:** Axel Azcune.

**Precondiciones:** Cliente browser sustituido por doble; respuestas de Auth/user/tenant_user sintéticas; sin consultas al servicio real.

**Comando/procedimiento:** `cd front; npm exec --no -- vitest run tests/unit/auth-service.test.ts`.

**Código:** [auth-service.test.ts](front/tests/unit/auth-service.test.ts).

**Evidencia:** [resumen-ci-normal.json](evidencias/e04/resumen-ci-normal.json).

<a id="auth-01"></a>
### AUTH-01 — Configuración ausente

**Estado:** aprobado. **Técnicas:** equivalencias, tabla de decisión, pruebas negativas.

**Entrada:** Cliente browser null.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `AUTH-01`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** No autoriza; SUPABASE_NOT_CONFIGURED; getUser null, login error de configuración, logout sin error.

**Obtenido:** Aprobado: No autoriza; SUPABASE_NOT_CONFIGURED; getUser null, login error de configuración, logout sin error. Verificado en 1 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes del reporte:** 1; nombres completos y estados en el JSON del catálogo.

<a id="auth-02"></a>
### AUTH-02 — Contrato de login

**Estado:** aprobado. **Técnicas:** equivalencias, tabla de decisión, pruebas negativas.

**Entrada:** Email/password sintéticos; respuesta sin error o Invalid login credentials.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `AUTH-02`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** Transmitir ambos valores al SDK y conservar exactamente error=null o el objeto de error recibido.

**Obtenido:** Aprobado: Transmitir ambos valores al SDK y conservar exactamente error=null o el objeto de error recibido. Verificado en 2 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes del reporte:** 2; nombres completos y estados en el JSON del catálogo.

<a id="auth-03"></a>
### AUTH-03 — Cierre de sesión

**Estado:** aprobado. **Técnicas:** equivalencias, tabla de decisión, pruebas negativas.

**Entrada:** Cliente configurado.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `AUTH-03`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** Invocar signOut exactamente una vez.

**Obtenido:** Aprobado: Invocar signOut exactamente una vez. Verificado en 1 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes del reporte:** 1; nombres completos y estados en el JSON del catálogo.

<a id="auth-04"></a>
### AUTH-04 — Mensajes de usuario

**Estado:** aprobado. **Técnicas:** equivalencias, tabla de decisión, pruebas negativas.

**Entrada:** Error null, credenciales inválidas en dos formas, email no confirmado y servicio no disponible.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `AUTH-04`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** Mensajes No se pudo iniciar sesion / Email o password incorrectos / El email aun no fue confirmado / texto original del error.

**Obtenido:** Aprobado: Mensajes No se pudo iniciar sesion / Email o password incorrectos / El email aun no fue confirmado / texto original del error. Verificado en 5 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes del reporte:** 5; nombres completos y estados en el JSON del catálogo.

<a id="auth-05"></a>
### AUTH-05 — Sesión ausente o inválida

**Estado:** aprobado. **Técnicas:** equivalencias, tabla de decisión, pruebas negativas.

**Entrada:** Auth devuelve usuario null o error expired con usuario presente.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `AUTH-05`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** isAuthorized=false, requiresLogin=true, AUTH_REQUIRED y ninguna consulta a tablas.

**Obtenido:** Aprobado: isAuthorized=false, requiresLogin=true, AUTH_REQUIRED y ninguna consulta a tablas. Verificado en 2 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes del reporte:** 2; nombres completos y estados en el JSON del catálogo.

<a id="auth-06"></a>
### AUTH-06 — Contexto autorizado aislado

**Estado:** aprobado. **Técnicas:** equivalencias, tabla de decisión, pruebas negativas.

**Entrada:** Auth id auth-test; app id texto 42; pertenencia tenant 7 y role operator.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `AUTH-06`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** Contexto auth-test/42/7/operator; filtro auth_user=auth-test; pertenencia user=42 y status=true.

**Obtenido:** Aprobado: Contexto auth-test/42/7/operator; filtro auth_user=auth-test; pertenencia user=42 y status=true. Verificado en 1 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes del reporte:** 1; nombres completos y estados en el JSON del catálogo.

<a id="auth-07"></a>
### AUTH-07 — Sin pertenencia activa

**Estado:** aprobado. **Técnicas:** equivalencias, tabla de decisión, pruebas negativas.

**Entrada:** Búsqueda activa vacía; fallback vacío / status=false / error 42501.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `AUTH-07`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** TENANT_ACCESS_NOT_FOUND / TENANT_ACCESS_INACTIVE / DATABASE_ERROR; sin contexto; fallback user=42 limit=20.

**Obtenido:** Aprobado: TENANT_ACCESS_NOT_FOUND / TENANT_ACCESS_INACTIVE / DATABASE_ERROR; sin contexto; fallback user=42 limit=20. Verificado en 3 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes del reporte:** 3; nombres completos y estados en el JSON del catálogo.

<a id="auth-08"></a>
### AUTH-08 — Error de consulta de pertenencia

**Estado:** aprobado. **Técnicas:** equivalencias, tabla de decisión, pruebas negativas.

**Entrada:** Usuario de aplicación 42; búsqueda de pertenencia con permission denied.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `AUTH-08`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** DATABASE_ERROR, acceso denegado; exactamente dos consultas, sin fallback adicional.

**Obtenido:** Aprobado: DATABASE_ERROR, acceso denegado; exactamente dos consultas, sin fallback adicional. Verificado en 1 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes del reporte:** 1; nombres completos y estados en el JSON del catálogo.

<a id="auth-09"></a>
### AUTH-09 — ID de usuario vacío

**Estado:** aprobado. **Técnicas:** equivalencias, tabla de decisión, pruebas negativas.

**Entrada:** Fila {}, id=null o id="".

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `AUTH-09`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** APP_USER_NOT_FOUND; una sola consulta, sin buscar pertenencias.

**Obtenido:** Aprobado: APP_USER_NOT_FOUND; una sola consulta, sin buscar pertenencias. Verificado en 3 variantes del reporte.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes del reporte:** 3; nombres completos y estados en el JSON del catálogo.

## Contexto REC

**Nivel:** Unidad de reglas de recomendación. **Requisitos:** R-FUN-01, R05, R06. **Responsable:** Axel Azcune.

**Precondiciones:** Reglas existentes sin modificar; entradas de deuda/riesgo sintéticas.

**Comando/procedimiento:** `cd front; npm exec --no -- vitest run tests/unit/recommendation-decisions.test.ts`.

**Código:** [recommendation-decisions.test.ts](front/tests/unit/recommendation-decisions.test.ts).

**Evidencia:** [resumen-ci-normal.json](evidencias/e04/resumen-ci-normal.json).

<a id="rec-01"></a>
### REC-01 — Aplicar decisiones y precedencia de recomendaciones

**Estado:** aprobado. **Técnicas:** tabla de decisión, valores límite, equivalencias.

**Entrada:** Siete combinaciones: ALTO con/sin contacto; mora 59/60; saldo 349.999/350.000; deuda cero.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `REC-01`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** Tipos y urgencia de la tabla de decisión de CASOS_PRUEBA_CALIDAD.md; riesgo alto prevalece.

**Obtenido:** 7/7 variantes aprobadas: llamado o revisión urgente según riesgo/contacto, revisión a 60 días, recordatorio a 59 o saldo 350.000, seguimiento con saldo inferior sin mora.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

**Variantes del reporte:** 7; nombres completos y estados en el JSON del catálogo.

## Contexto GATE

**Nivel:** Infraestructura de calidad; unidad, contratos y ensayo CI. **Requisitos:** R07, R08, R09, R10, R17. **Responsable:** Axel Azcune.

**Precondiciones:** Reportes controlados; base fija 531996f51243dc3d4c5a607338e2f35e32313f6b; umbrales 60/80/5 sin modificar.

**Comando/procedimiento:** `python -m unittest discover -s quality/tests -v`.

**Código:** [test_gates.py](quality/tests/test_gates.py), [test_ci.py](quality/tests/test_ci.py).

**Evidencia:** [gate-normal.json](evidencias/e04/gate-normal.json), [gate-critical-probe.json](evidencias/e04/gate-critical-probe.json), [ensayo-critico.json](evidencias/e04/ensayo-critico.json).

<a id="gate-01"></a>
### GATE-01 — Cobertura existente

**Estado:** aprobado. **Técnicas:** valores límite, contratos de infraestructura, pruebas negativas.

**Entrada:** 5.999/10.000 y 6.000/10.000 sentencias.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `test_existing_coverage_5999_fails_and_60_passes`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** 59,99 % falla; 60 % pasa.

**Obtenido:** Contrato aprobado: 59,99 % falla; 60 % pasa. Los métodos indicados están aprobados en el log de infraestructura.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

<a id="gate-02"></a>
### GATE-02 — Cobertura nueva

**Estado:** aprobado. **Técnicas:** valores límite, contratos de infraestructura, pruebas negativas.

**Entrada:** 7.999/10.000 y 8.000/10.000 líneas; diff contra base fija.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `test_new_coverage_7999_fails_and_80_passes; test_new_lines_below_80_block_whole_evaluation`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** 79,99 % falla; 80 % pasa; módulo insuficiente bloquea evaluación.

**Obtenido:** Contrato aprobado: 79,99 % falla; 80 % pasa; módulo insuficiente bloquea evaluación. Los métodos indicados están aprobados en el log de infraestructura.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

<a id="gate-03"></a>
### GATE-03 — Duplicación

**Estado:** aprobado. **Técnicas:** valores límite, contratos de infraestructura, pruebas negativas.

**Entrada:** 500/10.000, 501/10.000 y 50.001/1.000.000 líneas duplicadas.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `test_duplication_5_passes_501_fails_without_rounding`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** 5 % pasa; 5,01 % y 5,0001 % fallan sin redondear.

**Obtenido:** Contrato aprobado: 5 % pasa; 5,01 % y 5,0001 % fallan sin redondear. Los métodos indicados están aprobados en el log de infraestructura.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

<a id="gate-04"></a>
### GATE-04 — Crítico versus estilo

**Estado:** aprobado. **Técnicas:** valores límite, contratos de infraestructura, pruebas negativas.

**Entrada:** F821, I001, no-unsafe-finally y parsing fatal.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `test_critical_and_noncritical_rules_remain_separate; test_eslint_selected_rule_and_parse_error_are_critical`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** Crítico bloquea como crítico; estilo bloquea análisis, con lista de críticos vacía.

**Obtenido:** Contrato aprobado: Crítico bloquea como crítico; estilo bloquea análisis, con lista de críticos vacía. Los métodos indicados están aprobados en el log de infraestructura.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

<a id="gate-05"></a>
### GATE-05 — Reportes inválidos

**Estado:** aprobado. **Técnicas:** valores límite, contratos de infraestructura, pruebas negativas.

**Entrada:** JSON roto/null/lista, ausencia de LCOV/JSON/lint, JUnit roto y conteos discrepantes.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `test_missing_required_reports_never_pass; test_json_and_counts_corruption_preserve_a_failure_explanation; test_test_reports_are_required_and_must_agree`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** Evaluación fallida y explicación conservada, nunca aprobación por ausencia.

**Obtenido:** Contrato aprobado: Evaluación fallida y explicación conservada, nunca aprobación por ausencia. Los métodos indicados están aprobados en el log de infraestructura.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

<a id="gate-06"></a>
### GATE-06 — Base y procedencia

**Estado:** aprobado. **Técnicas:** valores límite, contratos de infraestructura, pruebas negativas.

**Entrada:** Base no resoluble/cambiada a HEAD; SHA/run/intento incorrectos; manifiesto duplicado.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `test_absent_base_cannot_silently_become_head; test_wrong_sha_run_attempt_and_duplicate_manifest_are_rejected`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** Rechazar sin vaciar el diff ni mezclar ejecuciones.

**Obtenido:** Contrato aprobado: Rechazar sin vaciar el diff ni mezclar ejecuciones. Los métodos indicados están aprobados en el log de infraestructura.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

<a id="gate-07"></a>
### GATE-07 — Sin código nuevo

**Estado:** aprobado. **Técnicas:** valores límite, contratos de infraestructura, pruebas negativas.

**Entrada:** Diff vacío con reportes válidos, y repetición con reporte backend eliminado.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `test_no_new_lines_has_null_percentage_not_invented_100; test_no_diff_does_not_hide_missing_reports`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** 0 líneas, pct=null, no aplica; reporte ausente sigue bloqueando.

**Obtenido:** Contrato aprobado: 0 líneas, pct=null, no aplica; reporte ausente sigue bloqueando. Los métodos indicados están aprobados en el log de infraestructura.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

<a id="gate-08"></a>
### GATE-08 — Mapeo de diff y rutas

**Estado:** aprobado. **Técnicas:** valores límite, contratos de infraestructura, pruebas negativas.

**Entrada:** Renombre real en Git temporal con espacio en nombre; borrados; rutas Windows/Linux.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `test_real_git_rename_is_a_complete_new_file_with_no_renames; test_deleted_lines_do_not_enter_new_denominator; test_windows_linux_and_relative_paths_are_equivalent`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** Alta completa del nuevo archivo, sin líneas borradas; normalización equivalente.

**Obtenido:** Contrato aprobado: Alta completa del nuevo archivo, sin líneas borradas; normalización equivalente. Los métodos indicados están aprobados en el log de infraestructura.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

<a id="gate-09"></a>
### GATE-09 — Propagación de fallos

**Estado:** aprobado. **Técnicas:** valores límite, contratos de infraestructura, pruebas negativas.

**Entrada:** Build con salida 7/control ausente; evaluador fallido y manifiesto inválido.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `test_failed_build_and_missing_control_block; test_gate_failure_reaches_summary_exit_and_report; test_invalid_manifest_preserves_failure_report`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** No aprobación global; salida 1 y gate/summary persistidos.

**Obtenido:** Contrato aprobado: No aprobación global; salida 1 y gate/summary persistidos. Los métodos indicados están aprobados en el log de infraestructura.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

<a id="gate-10"></a>
### GATE-10 — Ensayo remoto controlado

**Estado:** aprobado. **Técnicas:** valores límite, contratos de infraestructura, pruebas negativas.

**Entrada:** Mismo SHA c95a9ab: push normal frente a workflow_dispatch con crítico sintético F821 en reporte.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `test_controlled_probe_retains_original_and_blocks_critical_gate; test_probe_is_restricted_to_manual_opt_in`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** Normal aprobado; ensayo con suites aprobadas pero job resumen fallido, ocho gates pasan y dos bloquean.

**Obtenido:** Contrato aprobado: Normal aprobado; ensayo con suites aprobadas pero job resumen fallido, ocho gates pasan y dos bloquean. Los métodos indicados están aprobados en el log de infraestructura.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

## Contexto COB

**Nivel:** Medición de cobertura y gate CI. **Requisitos:** R07, R08. **Responsable:** Axel Azcune.

**Precondiciones:** Mismo alcance de 55 archivos frontend y método Vitest/V8 4.1.12; ampliación de pruebas E04.

**Comando/procedimiento:** `python quality/ci.py run frontend --output .quality/nueva-ejecucion/frontend; python quality/ci.py run backend --output .quality/nueva-ejecucion/backend; python quality/ci.py summary --artifacts .quality/nueva-ejecucion --output .quality/nuevo-resumen`.

**Código:** [gates.py](quality/gates.py), [auth-service.test.ts](front/tests/unit/auth-service.test.ts), [recommendation-decisions.test.ts](front/tests/unit/recommendation-decisions.test.ts).

**Evidencia:** [gate-normal.json](evidencias/e04/gate-normal.json).

<a id="cob-01"></a>
### COB-01 — Cerrar insuficiencia de cobertura

**Estado:** aprobado. **Técnicas:** cobertura, regresión del control.

**Entrada:** 26 pruebas adicionales; mismo denominador de 1.280 sentencias.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `COB-01`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** Sentencias >=60 % y gate nuevo >=80 % por módulo, sin reducir alcance.

**Obtenido:** 791/1.280, Vitest 61,79 %; nuevo frontend 28/28 y backend 15/17.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

## Contexto AUD

**Nivel:** Control de dependencias y contratos de política. **Requisitos:** R09, R17. **Responsable:** Axel Azcune.

**Precondiciones:** Lockfile y política E02; excepción OBS-DEP-001 vigente únicamente para la cadena exacta, sin prórroga.

**Comando/procedimiento:** `python quality/ci.py run frontend --output .quality/nueva-auditoria/frontend`.

**Código:** [audit_policy.py](quality/audit_policy.py), [test_ci.py](quality/tests/test_ci.py), [npm-audit-policy.json](quality/npm-audit-policy.json).

**Evidencia:** [resumen-ci-normal.json](evidencias/e04/resumen-ci-normal.json).

<a id="aud-01"></a>
### AUD-01 — Evaluar la excepción revisada de desarrollo

**Estado:** aprobado. **Técnicas:** equivalencias, política temporal.

**Entrada:** Cadena de cinco altos de desarrollo exacta; auditoría completa salida cruda 1.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `AUD-01`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** Mantener los cinco avisos visibles y aceptación solo según política vigente; variaciones o vencimiento bloquean.

**Obtenido:** 5 altos dev, 0 críticos; salida cruda 1 y accepted=true. OBS-DEP-001 permanece abierta.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

<a id="aud-prod-01"></a>
### AUD-PROD-01 — Exigir dependencias productivas sin avisos

**Estado:** aprobado. **Técnicas:** control de dependencias.

**Entrada:** Auditoría npm --omit=dev.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `AUD-PROD-01`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** 0 avisos y salida cruda 0.

**Obtenido:** 0 avisos productivos y salida 0.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

## Contexto SQL

**Nivel:** Inspección SQL real READ ONLY con ROLLBACK; sin Auth HTTP. **Requisitos:** R-SEG-01, R-SEG-02, R-INT-01, R-DAT-01. **Responsable:** Axel Azcune.

**Precondiciones:** Snapshot de inspección del proyecto conectado el 21/10; conexión administrativa autorizada, sin escrituras.

**Comando/procedimiento:** `Procedimiento SQL seleccionado en database/verificacion_supabase_solo_lectura.sql; no ejecutar cargas ni modificaciones.`.

**Código:** [verificacion_supabase_solo_lectura.sql](database/verificacion_supabase_solo_lectura.sql).

**Evidencia:** [supabase-2026-10-21.json](evidencias/supabase-2026-10-21.json), [REVISION_SUPABASE.md](REVISION_SUPABASE.md).

<a id="sup-rls-01"></a>
### SUP-RLS-01 — Denegar lectura anónima en controles SQL

**Estado:** aprobado en alcance SQL. **Técnicas:** partición de rol, inspección SQL.

**Entrada:** Rol anon en debtor, debt, person y public.user.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `SUP-RLS-01`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** 0 filas visibles en las cuatro tablas.

**Obtenido:** 0 objetos, 0 deudas, 0 personas y 0 usuarios.

**Fecha/versión/entorno:** 2026-10-21T18:49:43Z; `531996f51243dc3d4c5a607338e2f35e32313f6b (cliente inspeccionado); estado remoto según snapshot`; Supabase conectado, transacción SQL administrativa READ ONLY con ROLLBACK.

<a id="sup-rls-02"></a>
### SUP-RLS-02 — Denegar cartera sin pertenencia

**Estado:** fallido en alcance SQL; HTTP pendiente E06. **Técnicas:** partición de autorización, inspección SQL.

**Entrada:** Rol authenticated, identidad sintética sin usuario/pertenencia coincidentes.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `SUP-RLS-02`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** 0 filas de negocio visibles.

**Obtenido:** 2.933 objetos, 56.286 deudas y 2.493 personas visibles; 0 usuarios coincidentes y 0 pertenencias activas.

**Fecha/versión/entorno:** 2026-10-21T18:49:43Z; `531996f51243dc3d4c5a607338e2f35e32313f6b (cliente inspeccionado); estado remoto según snapshot`; Supabase conectado, transacción SQL administrativa READ ONLY con ROLLBACK.

<a id="sup-data-01"></a>
### SUP-DATA-01 — Detectar riesgo de truncamiento

**Estado:** detección histórica; corregido en regresión aislada. **Técnicas:** inspección de volumen y código.

**Entrada:** Volumen 56.286 deudas y 3.007 relaciones; loaders originales con una consulta limit 3000.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `SUP-DATA-01`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** El acceso de aplicación debe cubrir el conjunto autorizado completo.

**Obtenido:** La estrategia original no cubre ese volumen; condición detectada. Corrección aislada E03 vinculada a DAT-06.

**Fecha/versión/entorno:** 2026-10-21T18:49:43Z; `531996f51243dc3d4c5a607338e2f35e32313f6b (cliente inspeccionado); estado remoto según snapshot`; Supabase conectado, transacción SQL administrativa READ ONLY con ROLLBACK.

<a id="sup-int-01"></a>
### SUP-INT-01 — Inspeccionar integridad seleccionada

**Estado:** aprobado en alcance SQL. **Técnicas:** integridad de datos, inspección SQL.

**Entrada:** Conteos, claves, huérfanos y agregados del snapshot observado.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `SUP-INT-01`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** Sin duplicados/huérfanos/discrepancias en los controles seleccionados.

**Obtenido:** Sin anomalías seleccionadas en la inspección; no se reejecutó ETL ni se probó idempotencia real.

**Fecha/versión/entorno:** 2026-10-21T18:49:43Z; `531996f51243dc3d4c5a607338e2f35e32313f6b (cliente inspeccionado); estado remoto según snapshot`; Supabase conectado, transacción SQL administrativa READ ONLY con ROLLBACK.

## Contexto EXT

**Nivel:** Integración real de aplicación, pendiente E06. **Requisitos:** R16, R-SEG-01. **Responsable:** Axel Azcune.

**Precondiciones:** Requiere entorno de testing aislado, cuentas, dos tenants y fixtures conocidas; esa preparación aún no está validada.

**Comando/procedimiento:** `Pendiente E06: preparar ejecución obligatoria con Auth/Data API reales y falla por secretos ausentes. No usar la omisión actual como aprobación.`.

**Código:** [supabase-testing.integration.test.ts](front/tests/integration/supabase-testing.integration.test.ts), [ROADMAP_TP_CALIDAD_SOFTWARE.md](ROADMAP_TP_CALIDAD_SOFTWARE.md).

**Evidencia:** [resumen-ci-normal.json](evidencias/e04/resumen-ci-normal.json).

<a id="sup-auth-01"></a>
### SUP-AUTH-01 — Autenticar y recuperar contexto real de testing

**Estado:** omitido; implementación E06 parcial. **Técnicas:** integración externa.

**Entrada:** Testing exclusivo y credenciales configuradas; contrato E06 de usuario/contexto/datos conocidos.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `integracion real opcional con Supabase de testing`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** Auth válido, contexto esperado y filas conocidas del tenant; ampliar la prueba preparada para exigir esos datos antes del cierre.

**Obtenido:** Omitido en CI: requiere habilitación y credenciales de testing; la preparación existente solo verifica Auth y array de debtor, sin validar cartera conocida.

**Fecha/versión/entorno:** 2026-10-21; `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`; GitHub Actions Ubuntu 24.04, aislado.

**Ejecución:** [run de referencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195).

<a id="sup-auth-02"></a>
### SUP-AUTH-02 — Credenciales inválidas

**Estado:** pendiente. **Técnicas:** particiones de autorización, integración externa.

**Entrada:** Cuenta/clave inválidas en testing.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `SUP-AUTH-02`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** Rechazo de login y acceso no autorizado.

**Obtenido:** Sin ejecutar; implementación/provisionamiento pendientes E06.

**Fecha/versión/entorno:** sin ejecución; `pendiente`; testing pendiente E06.

<a id="sup-auth-03"></a>
### SUP-AUTH-03 — Logout real

**Estado:** pendiente. **Técnicas:** particiones de autorización, integración externa.

**Entrada:** Sesión válida de testing y cierre.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `SUP-AUTH-03`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** Sesión finalizada; siguiente acceso protegido denegado.

**Obtenido:** Sin ejecutar; implementación/provisionamiento pendientes E06.

**Fecha/versión/entorno:** sin ejecución; `pendiente`; testing pendiente E06.

<a id="sup-data-02"></a>
### SUP-DATA-02 — Lectura positiva por tenant

**Estado:** pendiente. **Técnicas:** particiones de autorización, integración externa.

**Entrada:** Usuario A activo y fixtures conocidas A/B.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `SUP-DATA-02`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** Recuperar todas las filas conocidas de A y cero filas de B.

**Obtenido:** Sin ejecutar; implementación/provisionamiento pendientes E06.

**Fecha/versión/entorno:** sin ejecución; `pendiente`; testing pendiente E06.

<a id="sup-rls-03"></a>
### SUP-RLS-03 — A no accede a B

**Estado:** pendiente. **Técnicas:** particiones de autorización, integración externa.

**Entrada:** Sesión normal A; consulta filas conocidas B.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `SUP-RLS-03`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** Cero filas de B en tablas y relaciones seleccionadas.

**Obtenido:** Sin ejecutar; implementación/provisionamiento pendientes E06.

**Fecha/versión/entorno:** sin ejecución; `pendiente`; testing pendiente E06.

<a id="sup-rls-04"></a>
### SUP-RLS-04 — B no accede a A

**Estado:** pendiente. **Técnicas:** particiones de autorización, integración externa.

**Entrada:** Sesión normal B; consulta filas conocidas A.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `SUP-RLS-04`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** Cero filas de A en tablas y relaciones seleccionadas.

**Obtenido:** Sin ejecutar; implementación/provisionamiento pendientes E06.

**Fecha/versión/entorno:** sin ejecución; `pendiente`; testing pendiente E06.

<a id="sup-rls-05"></a>
### SUP-RLS-05 — Pertenencia inactiva

**Estado:** pendiente. **Técnicas:** particiones de autorización, integración externa.

**Entrada:** Usuario de testing con pertenencia inactiva.

**Pasos:** preparar la entrada del contexto; ejecutar su comando/procedimiento con selector `SUP-RLS-05`; comparar cada variante con el esperado y conservar reporte. Para pendientes, implementar/provisionar primero; este texto no ejecuta la prueba.

**Esperado:** Cero filas de negocio y acceso denegado.

**Obtenido:** Sin ejecutar; implementación/provisionamiento pendientes E06.

**Fecha/versión/entorno:** sin ejecución; `pendiente`; testing pendiente E06.

Los tickets reales y enlaces inversos se consultan en la [matriz](TRAZABILIDAD_CALIDAD.md). El catálogo no convierte casos omitidos/pendientes en aprobados ni resultados SQL históricos en una nueva ejecución HTTP.

La inspección SUP-INT-01 conserva conteos en el bloque SQL versionado y resultados de integridad adicionales en el snapshot. No se presenta como un script completo de reejecución del ETL; E06 debe guardar las consultas completas de su nueva verificación.
