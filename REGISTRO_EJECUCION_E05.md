# E05 — Casos, defectos y trazabilidad formalizados

**Fecha:** 21/10/2026. **Responsable:** Axel Azcune (`AxAzc`). **Estado:** completada en su alcance.

Entrada: E04 cerrada en `930f807e3d6c8d12c6e8a25f84e4d21a4c105755`. Rama de trabajo: `quality/e05-trazabilidad`. Requisitos R03, R05, R06, R12–R14 y R24. Soporte elegido y utilizado: **GitHub Issues y registro versionado**.

E05 conecta los casos y resultados ya obtenidos con tickets reales, completa sus fichas, documenta técnicas ejecutadas y conserva aportes verificables de los integrantes. La formalización no inventa nuevas pruebas, no refecha la aceptación previa de E03/E04 y no convierte pendientes de integración en resultados aprobados.

## 1. Seguimiento real y estados verificados

La búsqueda inicial y el inventario directo de Issues no devolvieron registros del repositorio. Se crearon nueve tickets con cuerpos completos, responsable y enlaces recíprocos; los estados finales y la asignación se consultaron también mediante el plugin de GitHub.

| Ticket | Estado GitHub | Resultado / alcance |
| --- | --- | --- |
| [DEF-SUP-001 #1](https://github.com/ImaDecara/Tesis-EQUITAS/issues/1) | **Open** | Reproducido SQL; corrección y validación real por roles/tenants pendientes E06. |
| [DEF-DAT-001 #2](https://github.com/ImaDecara/Tesis-EQUITAS/issues/2) | **Closed / completed** | Corrección y regresión aislada de ambas rutas/relaciones aprobadas E03. Validación en entorno de aplicación/despliegue sigue en E06/E07. |
| [OBS-DEP-001 #3](https://github.com/ImaDecara/Tesis-EQUITAS/issues/3) | **Open** | Cinco altos de desarrollo; excepción exacta con vencimiento 26/10/2026, sin prórroga. |
| [OBS-COB-001 #4](https://github.com/ImaDecara/Tesis-EQUITAS/issues/4) | **Closed / completed** | Mínimo de cobertura y gates comprobados E04, con regresión automatizada. |
| [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | **Closed / completed** | DAT-01–14 y FIXTURE-01, 42 variantes aprobadas y rojo/verde conservado. |
| [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) | **Closed / completed** | AUTH-01–09, 19 variantes aprobadas con dobles; no certifican RLS remoto. |
| [CAS-REC #7](https://github.com/ImaDecara/Tesis-EQUITAS/issues/7) | **Closed / completed** | REC-01, siete decisiones y límites aprobados. |
| [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | **Closed / completed** | Contratos/mediciones y ensayo crítico esperable comprobados. OBS-DEP-001 conserva su ticket abierto. |
| [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | **Open** | Campaña de integración real pendiente; separa inspección SQL, omisión y futuros casos HTTP. |

**Balance:** nueve registros, seis cerrados y tres abiertos; todos asignados a `AxAzc`. No se crearon tickets duplicados al completar cuerpos/comandos. La fecha de alta corresponde a E05; cada ticket identifica sus fechas, versiones y evidencias anteriores.

El plugin permitió lectura, pero la operación de escritura devolvió HTTP 403 por permisos de la integración. Se utilizaron la CLI autenticada y archivos JSON estructurados para altas/actualizaciones; después se comprobó la lectura de los nueve tickets desde el plugin. [Inventario previo](evidencias/e05/issues-antes.json), [snapshot completo con hashes](evidencias/e05/seguimiento-2026-10-21.json) y [verificación posterior](evidencias/e05/verificacion-issues.json).

## 2. Plantillas, catálogo e inventario

| Entregable | Contenido |
| --- | --- |
| [Plantilla de caso](.github/ISSUE_TEMPLATE/caso_prueba.md) | ID/requisito, objetivo, nivel/técnica, responsable/estado, precondiciones, entrada, pasos, esperado/obtenido, fecha, versión/entorno y evidencia. |
| [Plantilla de defecto/observación](.github/ISSUE_TEMPLATE/defecto_calidad.md) | Tipo, caso de origen, severidad/prioridad justificadas, versión, reproducción, esperado/obtenido, causa, corrección, validación, regresión y alcance de cierre. |
| [Gestión](GESTION_CALIDAD.md) | Uso de GitHub Issues, fuentes de verdad, estados, cierre/reapertura, tratamiento de riesgo y mantenimiento. |
| [Catálogo legible](CASOS_PRUEBA_CALIDAD.md) y [JSON](calidad/casos-prueba.json) | 49 IDs seleccionados, variantes, comandos/procedimientos, técnicas y resultados. Cada ficha combina su contexto común con campos propios. |
| [Inventario completo](calidad/inventario-pruebas.json) | Nombres y estados de los 163 resultados de producto y las 41 pruebas de infraestructura del run E04; archivos fuente y enlaces de los 68 resultados gestionados DAT/AUTH/REC. |
| [Matriz](TRAZABILIDAD_CALIDAD.md) | Trazabilidad principal y por cada caso, números/URLs reales, estado, corrección, evidencia y siguiente acción. |
| [Aportes](APORTES_TP_CALIDAD.md) | Autores, SHAs, mensajes reales y archivos de siete commits seleccionados de los tres integrantes. |

Los **49 IDs no equivalen a 49 pruebas nuevas**. Se agrupan variantes parametrizadas y observaciones de distintos niveles. La distribución del catálogo es: **38 aprobados** en su criterio de control, **2 aprobados en alcance SQL**, **1 fallo SQL con HTTP pendiente**, **1 detección histórica corregida en regresión aislada**, **1 integración omitida/parcial** y **6 casos pendientes** de E06.

Los DAT/FIXTURE, AUTH y REC documentan 68 variantes de las suites existentes. La línea base restante se conserva en el inventario, con su nombre y archivo reales. Los GATE/AUD no se suman al total de producto: son contratos/controles de infraestructura. Una prueba negativa puede aprobar cuando rechaza correctamente la entrada; SUP-RLS-02 está fallida porque debía devolver cero filas y mostró cartera sin pertenencia.

## 3. Técnicas y resultados concretos

Se documentaron particiones realmente utilizadas: conjunto vacío/parcial/exacto/múltiplo/grande, máximo de servidor inferior al pedido, errores intermedios, credenciales/configuración ausentes, IDs/cursor inválidos, sesión y pertenencia activa/inactiva/ausente. Los límites incluyen N=0/7/1.000/1.001/2.000/3.507; mora 59/60; saldo 349.999/350.000; gates 59,99/60 %, 79,99/80 % y duplicación 5/5,01 %.

La tabla REC-01 conserva sus **siete filas** con tipo y urgencia esperados/obtenidos. La tabla Auth muestra rechazo o contexto exacto para sesión/usuario/pertenencia, ejecutada con dobles. Las fichas enlazan al selector y a las variantes del reporte; no usan «aplicar la regla definida» como resultado esperado.

Evidencia de origen: commit `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`, [run E04 aprobado](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195), JSON/JUnit y log de infraestructura descargados y verificados en E04. La inspección SQL conserva su fecha 21/10/2026 18:49:43 UTC y el snapshot remoto, sin atribuirle un JWT o recorrido HTTP.

SUP-INT-01 conserva conteos en el SQL versionado y resultados de integridad adicionales en el snapshot. No constituye una reejecución del ETL ni un script completo de todas las consultas complementarias; E06 debe conservar las consultas de su nueva validación. El caso HTTP preparado permanece omitido y parcial, porque todavía no exige cartera/contexto conocidos en su implementación existente.

## 4. Cierres y pendientes trazables

La cadena **R-DAT-01 → DAT-06 → CAS-DAT #5 → DEF-DAT-001 #2 → `3bfe156…` → rojo/verde E03 → regresión E04** conserva exactamente las aserciones iniciales. El cierre del defecto corresponde a código/regresión aislada de ambas rutas y relaciones; la campaña externa permanece abierta para validar la aplicación real.

La cadena de cobertura **R07/R08 → COB-01/GATE → CAS-GATE #8 → OBS-COB-001 #4 → `c95a9ab…` → gate normal/ensayo E04** conserva numeradores, denominadores y base fija. La aceptación temporal de dependencias tiene su registro abierto aparte, incluso cuando los contratos del evaluador aprueban.

**DEF-SUP-001 #1** conserva el fallo por rol SQL y la siguiente acción de E06: testing aislado, dos tenants, pertenencia activa, consultas con cliente normal y regresión de los datos relacionados. **OBS-DEP-001 #3** conserva cinco avisos y el vencimiento. **CAS-EXT #9** mantiene abierta la integración Auth/Data API con casos omitidos o sin ejecutar. El estado cerrado de una campaña aislada no cierra estos pendientes.

Los aportes se documentan a partir del autor registrado en Git y archivos realmente cambiados: Ignacio Magoia, checkpoint recibido y frontend/suites; Imanol Decara, ETL/backend; Axel, cierre y controles de calidad E00–E04. No se infieren porcentajes de esfuerzo ni actividades futuras por el número de commits.

## 5. Verificación y conclusión

La [revisión E05](evidencias/e05/validacion-registros.json) comprobó campos obligatorios, IDs únicos, fuentes existentes, 68 variantes contra el reporte original, estados/cuerpos/hashes de Issues, enlaces locales/anchors, aportes Git y consistencia de los cierres. El front matter de ambas plantillas se parseó como YAML válido. Los JSON de inventario no modifican las cifras de las suites: **162 aprobadas, cero fallidas y una omitida de producto; 41 de infraestructura por separado**, como referencia técnica E04.

E05 incorpora documentación, metadatos y plantillas de Issues. No cambia código de producto, pruebas, dependencias, workflows ni configuración remota. Los comandos técnicos y sus umbrales siguen vigentes; el push de cierre ejecuta nuevamente el pipeline normal con los gates existentes.

**Se satisfacen los 15 controles de E05**: soporte efectivamente usado, plantillas aplicadas, casos/defectos completos, técnicas ejecutadas, estados, regresión, aportes y navegación de trazabilidad. **Siguiente etapa: E06**, preparar Supabase aislado de testing y tratar autorización/integración real con los casos y pendientes registrados. El PDF final y la defensa continúan en E10/E11.
