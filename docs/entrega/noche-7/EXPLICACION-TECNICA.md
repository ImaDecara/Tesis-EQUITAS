# EQUITAS — explicación técnica (noche 7)

Material de apoyo para la presentación y la tesis. Describe lo que está implementado en la rama `delivery/noche-7-entrega`; cada afirmación enlaza al código o a la evidencia que la respalda. Lo que todavía no existe está rotulado **Previsto**. No es una tesis terminada y no afirma validaciones académicas ni resultados de impacto: no los hay.

Todo lo que sigue se probó en un **entorno local con datos sintéticos**. No se probó contra la base de producción ni en una aplicación publicada.

## 1. Qué hace el sistema, en una frase

A partir de dos archivos CSV con la cartera de un municipio, EQUITAS ordena los objetos tributarios con deuda en cinco grupos de trabajo mediante reglas explícitas, recomienda una acción para cada uno, permite que una persona registre qué decidió hacer, y entrega reportes de todo eso.

## 2. Flujo de datos: del CSV al reporte

```
Navegador ──(1)──▶ Aplicación web (Next.js)
                       │ (2) reenvío de servidor a servidor, con la sesión de la persona
                       ▼
             Servicio de importación (FastAPI, solo en la misma máquina)
                       │ (3) lectura + validación + transformación, en un proceso sin credenciales
                       │ (4) publicación atómica en la base (todo o nada)
                       ▼
                 Base de datos (PostgreSQL / Supabase local)
        persona · objeto · obligación · contacto · lote con su fecha de cartera · perfil por objeto
                       │
                       ▼ (5) cada pantalla y cada reporte leen la cartera del municipio y calculan al leer:
             puntaje 0–100 · banda · grupo de trabajo · recomendación automática   (reglas 1.1.0)
                       │
                       ▼ (6) decisión registrada por una persona  ──▶  aprobación de OTRA persona (intensidad 3 o 4)
                       │
                       ▼ (7) cinco reportes CSV; cada descarga y cada apertura de caso queda registrada
```

| Paso | Qué ocurre | Dónde está |
|---|---|---|
| 1 | La persona elige los dos archivos en el selector y la fecha de corte. La pantalla reconoce cuál es cabecera y cuál detalle por sus columnas obligatorias, no por el nombre. | `front/app/import/page.tsx`, `front/components/import/import-form.tsx`, `front/lib/domain/import-upload.ts` |
| 2 | El navegador nunca habla con el servicio de importación: la aplicación reenvía el cuerpo con el token de la sesión, solo a una dirección de la misma máquina y solo a una lista cerrada de rutas. | `front/lib/server/imports-forward.ts` |
| 3 | Lectura según un perfil de formato; validación con alertas, cuarentena por objeto y bloqueo del lote; transformación. Corre en un proceso hijo sin credenciales y con límites de tiempo y memoria. | `back/ETL/extract.py`, `back/ETL/validate_source.py`, `back/ETL/transform.py`, `back/services/import_preview_process.py`, perfil `contracts/source-mapping.sintetico-csv.v1.json`, contrato `contracts/source-contract.v1.json` |
| 4 | Publicación en una sola transacción: o entra el lote completo con su fecha, o no cambia nada. Repetir el mismo lote no duplica. | `back/api/import_load.py`; funciones `stage_import_batch`, `publish_import_batch`, `settle_import_batch` en `supabase/migrations/20261105201716_import_batch_staging.sql` |
| 5 | Puntaje, banda, grupo y recomendación **no se guardan**: se calculan al leer con las reglas vigentes. | `front/lib/domain/decision-rules-v1.ts`, `front/lib/domain/portfolio-totals.ts`, `front/lib/mappers/debtor-object-mapper.ts` |
| 6 | La decisión queda atada a la cartera y a la versión de reglas con que se tomó. | `front/lib/server/case-review-service.ts`; funciones `record_case_review` y `record_case_review_approval` en `supabase/migrations/20261110100000_admin_user_access.sql` |
| 7 | Reportes de cola, calidad de datos, decisiones, supervisión y accesos. Sin registro de auditoría no se entrega el archivo. | `front/lib/reports/`, `front/app/api/reports/`, `front/lib/server/report-response.ts`, `front/lib/server/audit.ts` |

El mismo paso 3–4 lo ejecuta la herramienta de terminal de desarrollo (`back/ETL/run_etl.py`). La carga desde la aplicación reutiliza esas mismas funciones; no es un segundo sistema de importación.

## 3. Modelo de datos

- **Unidad de análisis: el objeto tributario** (un inmueble, un rodado, una conexión de agua), no la persona. Un objeto puede tener varios titulares y una persona varios objetos; ningún importe se suma dos veces por eso (caso «dos titulares» en `docs/tesis/casos-chicos-v1.md`).
- **Tablas de cartera** (las 23 que ya existían en la base original): objetos, obligaciones, personas, relación objeto–persona, contactos, perfil por objeto y catálogos. Esquema base: `supabase/migrations/20261021220156_equitas_testing_schema.sql`.
- **Tablas que agregó este proyecto** (no existen en la base de producción): `import_batch` (cada carga, con su fecha de cartera, huellas de los archivos y conteos), `case_review` (decisiones), `case_review_approval` (aprobaciones u objeciones) y `access_audit` (registro de aperturas, descargas y cargas). Las cuatro son de solo agregado: una corrección es un registro nuevo que reemplaza al anterior, nunca una edición. `supabase/migrations/20261030100000_case_review.sql`, `20261102170000_access_audit.sql`.
- **Fecha de la cartera**: es la fecha de corte del último lote publicado del municipio. Con ella se decide qué obligación está vencida. `supabase/migrations/20261105201716_import_batch_staging.sql` (`equitas_current_cutoff`), `front/lib/server/portfolio-cutoff.ts`.

## 4. Totales: tres definiciones, las mismas en toda pantalla y todo reporte

| Total | Definición |
|---|---|
| **Total registrado** | Importe de todas las obligaciones de la cartera, cualquiera sea su estado. |
| **Deuda pendiente** | Suma de las obligaciones no pagadas. |
| **Deuda vencida** | Obligaciones pendientes con importe mayor que cero y vencimiento anterior a la fecha de la cartera. |

Un solo módulo las calcula para la web (`front/lib/domain/portfolio-totals.ts`); el perfil guardado en la base usa la misma definición (`supabase/migrations/20261110120000_debtor_profile_rules_1_1.sql`) y el servicio en Python también (`back/services/decision_rules_v1.py`, `back/ETL/transform.py`). Diez casos chicos con el resultado calculado a mano se afirman en cada uno de esos consumidores: `contracts/portfolio-small-cases.v1.json`, `docs/tesis/casos-chicos-v1.md`.

**Estados de las obligaciones.** La única regla que distingue un estado es la de las **pagadas**: no cuentan como deuda pendiente, ni como vencidas, ni en el puntaje (decisión del 10/11/2026; reglas 1.1.0). Las suspendidas, en plan de pago, judiciales, con certificado o canceladas se computan por importe y vencimiento, igual que antes: **no hay ninguna regla definida para ellas**, y no se inventó una a partir del nombre. Tampoco se pudo observar qué estados tienen hoy las obligaciones de producción. Ver §9.

## 5. Segmentación: cinco grupos por reglas determinísticas

No es *clustering* ni aprendizaje automático. Son reglas explícitas, aplicadas en orden; gana la primera que se cumple:

| Orden | Condición | Grupo de trabajo |
|---|---|---|
| 1 | El objeto no tiene ningún contacto activo | Mejorar datos |
| 2 | El puntaje no se puede calcular (faltan importe y vencimiento) | Mejorar datos |
| 3 | Alguna obligación vencida tiene 1.825 días o más de atraso | Revisión jurídica |
| 4 | Banda alta | Contacto y plan |
| 5 | Banda media | Recordatorio |
| 6 | Banda baja con puntaje mayor que cero | Seguimiento |
| 7 | Puntaje cero (sin deuda vencida) | Seguimiento, sin contacto |

Contrato versionado de las reglas: `contracts/decision-rules.v1.1.json` (versión 1.1.0) y sus 54 casos de referencia `contracts/decision-rules.v1.1.golden.json`. La versión 1.0.0 se conserva sin editar (`contracts/decision-rules.v1.json`). Hay una implementación en TypeScript y otra en Python; cada una reproduce los casos de referencia de las dos versiones (`front/tests/unit/decision-rules-v1.test.ts`, `back/tests/test_decision_rules_v1.py`). Qué cambió entre versiones y por qué: `docs/tesis/reglas-decision-v1.1.md`.

El umbral de 1.825 días es un parámetro de alerta provisional: no representa ni presume un plazo legal de prescripción.

## 6. Puntaje de prioridad

Heurístico, de 0 a 100, por objeto. **No es una probabilidad de pago** ni de recupero, y no usa datos de la persona (ni tipo, ni domicilio, ni contacto).

| Factor | Máximo | Cómo puntúa |
|---|---|---|
| Deuda pendiente del objeto | 50 | Por tramos de importe |
| Atraso máximo entre las vencidas | 30 | Por tramos de días |
| Cantidad de obligaciones vencidas | 20 | Por tramos de cantidad |

Bandas: **alta** desde 70, **media** de 40 a 69, **baja** por debajo de 40. Si no hay ninguna obligación vencida, el puntaje es 0. Los tramos están en el contrato de reglas (sección `severidad.factores`), y la ficha de cada caso muestra el desglose, que suma el puntaje mostrado.

Ejemplo verificable a mano (cartera al 30/09/2026), caso `DEMO6-6-60012`: una pagada de $ 48.000, una suspendida de $ 47.150 vencida el 10/01/2026 y una vencida de $ 46.200 vencida el 10/04/2026 → total registrado $ 141.350; deuda pendiente $ 93.350; dos vencidas por $ 93.350; 263 días de atraso máximo; puntaje 20 + 20 + 5 = 45, banda media, grupo Recordatorio.

Pesos, tramos y umbrales son valores por defecto **provisionales**: no tienen validación municipal ni académica.

## 7. Recomendación, decisión y aprobación: tres cosas distintas

| | Quién | Qué es |
|---|---|---|
| **Recomendación automática** | El sistema | Una acción sugerida con intensidad de 0 a 4 y la explicación de por qué esa y no otra. El sistema nunca sugiere más de 2. |
| **Decisión registrada** | Una persona con rol ADMIN | Aceptar, modificar, rechazar, posponer o derivar, con motivo y lista de control. Queda atada a la fecha de cartera y a la versión de reglas con que se tomó. |
| **Aprobación** | **Otra** persona con rol ADMIN | Solo para acciones de intensidad 3 o 4, que quedan como propuesta hasta que otra persona las aprueba. |

- Una decisión de intensidad 0 a 2 queda completa al registrarse.
- La separación entre quien propone y quien aprueba es **por identidad**: la base rechaza a quien registró cualquier versión de esa propuesta (`APPROVER_IS_PROPONENT` en `record_case_review_approval`). En un municipio con una sola cuenta ADMIN, una propuesta de intensidad 3 o 4 queda pendiente, y la aplicación lo dice.
- Cuando después se carga una cartera con otra fecha, o cambian las reglas, la decisión se muestra como **«Registrada sobre datos anteriores»** y no como vigente (`front/lib/domain/recorded-decision.ts`).
- La escala de intensidad y los costos de las acciones son provisionales y solo están habilitados para datos sintéticos (lo declara el propio contrato: `contracts/decision-rules.v1.1.json`, `contracts/action-costs.v1.json`).

## 8. Acceso

- **Quién entra**: quien tiene sesión válida, un usuario de aplicación activo y una membresía activa en un municipio activo. Cada persona ve solo su municipio. Es el comportamiento de la versión publicada hoy (`main`).
- **Roles**: los del catálogo de la base original, `ADMIN` y `USER`, comparados de forma exacta. Leer la cartera (tablero, listados, ficha, personas) no depende de cuál de los dos sea.
- **Funciones que `main` no tiene** y por eso necesitan permiso. Valor adoptado, el más conservador:

| Función nueva | Quién |
|---|---|
| Cargar CSV | ADMIN |
| Registrar una decisión sobre un caso | ADMIN |
| Aprobar la propuesta de otra persona | ADMIN (y distinta de quien la registró) |
| Reportes de supervisión y de accesos | ADMIN |
| Exportar lo que ya se ve en pantalla (cola, calidad de datos, decisiones) | Cualquier miembro activo |
| Ver la decisión registrada de un caso y su estado | Cualquier miembro activo |

- El permiso de cada función vive en **un lugar por capa**: `front/lib/server/dal.ts` (`PERMISSIONS`), `back/api/auth.py` (`PERMISSIONS`) y la función `public.equitas_role_allows` de la base (`supabase/migrations/20261110100000_admin_user_access.sql`). Una prueba compara las tres tablas (`quality/tests/test_n7_access_parity.py`).
- **Diferencia deliberada respecto de `main`**: una cuenta cuyo rol no es ADMIN ni USER no entra y recibe un mensaje con el próximo paso. En `main` entraría, porque allí el rol no se mira.

## 9. Límites e incertidumbres

- **Datos sintéticos.** Toda la cartera usada es inventada. Ningún resultado describe a un municipio real.
- **Estados de las obligaciones en producción: sin observar.** No se sabe qué estados existen hoy en el catálogo de producción, cuáles tienen sus obligaciones, ni quién define cómo se computa cada uno. El cargador de `main` solo asigna tres (vigente, vencida, desconocida) por fecha de vencimiento; «Suspendida» la agregó este proyecto a su catálogo local porque el formato de origen la distingue. Evidencia: `PlanToFinish/DeliveryPlan/2026-10-28-v2/execution/evidence/revision-fable-ux/estados-de-obligacion-evidencia-2026-11-09.md`.
- **Reglas, pesos, umbrales, escala de intensidad y costos: provisionales**, sin validación municipal ni académica.
- **La carga de CSV funciona solo en local.** Depende de un servicio que corre en la misma máquina y de una base local; el cargador rechaza por diseño cualquier otro destino (`back/ETL/config.py`). Qué haría falta para una aplicación publicada: `REQUISITOS-PENDIENTES.md`.
- **Formato de carga**: solo el CSV del perfil sintético. **Previsto**: Excel/XLSX y perfiles de otros municipios.
- **Sin canal con el contribuyente**: EQUITAS no envía mensajes. **Previsto.**
- **Sin prueba de usabilidad con personas** y sin campaña remota contra una base alojada.

## 10. Pruebas

El detalle de qué se ejecutó, sobre qué commit, en qué entorno y con qué resultado está en `RESUMEN.md` (tabla de pruebas). En resumen, hay cuatro capas: pruebas unitarias y de integración con dobles (frontend y backend, entran en los *gates* del repositorio); casos de referencia de las reglas y casos chicos de cálculo; sondas contra la base local real (migraciones, permisos, carga); y el recorrido en navegador real sobre el entorno local.
