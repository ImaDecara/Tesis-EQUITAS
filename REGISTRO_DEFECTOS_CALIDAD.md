# EQUITAS — Registro de defectos de calidad

Registro versionado iniciado el **21/10/2026**. No es una exportación de Jira ni demuestra que se hayan creado tickets externos. Los defectos permanecen abiertos; no hay una corrección o ejecución verde que se pueda declarar todavía.

## DEF-SUP-001 — El rol autenticado lee cartera sin pertenencia al tenant

| Campo | Valor |
| --- | --- |
| Estado | **Abierto, reproducido**. |
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
| Corrección / commit | Pendiente; no se alteraron políticas. |
| Regresión / verde | Pendiente. |

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

## DEF-DAT-001 — La lectura de datos se trunca antes de paginar la interfaz

| Campo | Valor |
| --- | --- |
| Estado | **Abierto, condición confirmada por código y volumen real**. |
| Severidad / prioridad | **Alta**, propuesta técnica por posible incompletitud de métricas y decisiones. |
| Entorno y versión | Frontend `531996f`; Supabase conectado, volumen observado el 21/10/2026. |
| Responsable | Axel Azcune (`AxAzc`). |
| Requisito | R-DAT-01: los listados y agregados deben representar la cartera autorizada completa. |
| Caso | **SUP-DATA-01**: comparar COUNT(*) con el límite y estrategia de los loaders. |
| Precondición / entrada | Cartera con **56.286 deudas** y **3.007 relaciones objeto–persona**. |
| Resultado esperado | Lectura completa mediante paginación de base o consultas agregadas que cubran todo el conjunto autorizado. |
| Resultado obtenido | `.select('*').limit(3000)` sin iteración de páginas; el conjunto devuelto no puede incluir todas las filas. |
| Fuente | `front/lib/data/raw-debtor-loader.ts` y `front/lib/services/person-data-service.ts`. |
| Evidencia | Conteos exactos de `evidencias/supabase-2026-10-21.json`; funciones `loadRawTableRows` inspeccionadas en el grafo y la fuente. |
| Corrección / commit | Pendiente. |
| Regresión / verde | Pendiente; falta un caso automatizado con datos que excedan el tamaño de página. |

Pasos de reproducción de la condición:

1. Consultar el conteo exacto de `debt` y `debtor_person` mediante el SQL de inspección.
2. Revisar `TABLE_LIMIT` y la consulta de ambos loaders.
3. Verificar que no se solicita una página posterior ni se comprueba truncamiento.
4. Comparar 56.286 con 3.000 y 3.007 con 3.000.

La condición de truncamiento está demostrada. No se afirmó una cifra concreta de deuda errónea en la interfaz autenticada ni que el límite efectivo del servidor sea exactamente 3.000. El criterio debe probarse con una fixture de más de una página y un total conocido.

Criterios de cierre:

- Recuperación completa y sin duplicados de un conjunto de más de una página, con orden estable.
- Manejo correcto de lista vacía, última página exacta/parcial y error en una página intermedia.
- Totales del dashboard coherentes con los registros autorizados completos.
- Prueba fallida sobre el comportamiento anterior y aprobada después de la corrección; conservar regresión y cobertura de código nuevo.

## Trazabilidad actual

| Requisito | Caso | Evidencia / resultado | Defecto | Corrección y regresión |
| --- | --- | --- | --- | --- |
| R-SEG-01, impedir acceso sin pertenencia | SUP-RLS-02 | Lectura SQL por rol: **no cumple**. | DEF-SUP-001 | Pendientes. |
| R-SEG-02, impedir lectura anónima | SUP-RLS-01 | Cero filas en cuatro tablas consultadas: **cumple en ese alcance**. | Ninguno por ese caso. | Mantener como regresión. |
| R-DAT-01, cartera completa | SUP-DATA-01 | Volumen supera lectura máxima: **no cumple**. | DEF-DAT-001 | Pendientes. |
| R-INT-01, integridad de carga existente | SUP-INT-01 y agregados de revisión | Sin duplicados, huérfanos ni discrepancias seleccionadas: **cumple en ese alcance**. | Ninguno por esos casos. | No sustituye reejecución ETL real. |

Los IDs describen esta revisión; no aumentan el recuento de las suites Vitest/Pytest ni se atribuyen a Jira.
