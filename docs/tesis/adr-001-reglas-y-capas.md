# ADR-001: Dónde viven las reglas de decisión y qué hace cada capa

| Campo | Valor |
|---|---|
| Ticket | ALIGN-013, plan `2026-10-28-v2` (M1) |
| Estado | **Aceptada (provisional)**: pendiente de la revisión independiente de otro proveedor exigida por el ticket |
| Fecha | 29/10/2026 |
| Decisiones del plan | D-01 (conservar Next.js, Supabase y ETL Python), D-03 (reglas en JSON versionado, núcleo TS y paridad Python; vista SQL como evolución), D-23 (FastAPI interna autenticada para la importación, la amplía ALIGN-052) |
| Código descrito | `c17a1bf83bc71fc63dc720d6b2d2be90d5e65b4f` (las citas `archivo:línea` refieren a ese commit) |
| Documentos relacionados | [Contrato de dominio v1](contrato-dominio-v1.md) (ALIGN-007), [reglas de decisión v1](reglas-decision-v1.md) y [`decision-rules.v1.json`](../../contracts/decision-rules.v1.json) (ALIGN-008), [catálogo de indicadores](catalogo-indicadores-v1.md), [ejecución segura del ETL](../../back/ETL/README.md) (ALIGN-025) |
| Exclusión | No reescribe la arquitectura ni mueve código: registra la decisión y las obligaciones que asumen otros tickets |

## 1. Contexto: la arquitectura real

La tesis describe EQUITAS como un sistema de apoyo a la decisión que combina diálogo, datos y modelos `[P0211]`. El código en `c17a1bf` tiene estas capas:

| Capa | Qué hay hoy | Evidencia |
|---|---|---|
| Ingesta | ETL por línea de comandos: lee los TSV de cabecera y detalle, transforma, calcula perfiles y carga por la API REST de Supabase con la clave de servicio. Por defecto solo revisa el lote (sin credenciales); `--execute` exige un destino local o de testing en loopback y rechaza siempre el proyecto original | `back/ETL/run_etl.py`, `back/ETL/extract.py`, `back/ETL/transform.py`, `back/ETL/load.py`, `back/ETL/config.py:50-107`, [README del ETL](../../back/ETL/README.md) |
| Validación | **Parcial**: el ETL omite filas sin clave numérica y convierte importes o fechas ilegibles en 0 o nulo. No hay validador del contrato de origen | `back/ETL/run_etl.py:175-185`, `311-323`, `back/ETL/transform.py:142-177`; contrato §10; ALIGN-024 |
| Base | Supabase (Postgres) con RLS por membresía activa; la Data API devuelve como máximo 1000 filas por consulta | `supabase/migrations/20261021220156_equitas_testing_schema.sql`, `supabase/migrations/20261021221030_active_membership_rls.sql`, `supabase/config.toml:9` |
| Autenticación | Supabase Auth con email y contraseña desde el navegador; la sesión viaja en cookies y los Server Components leen con la clave publicable más la sesión del usuario, de modo que RLS se aplica | `front/lib/services/auth-service.ts:170-205`, `front/lib/supabase-server.ts`, `front/components/auth/auth-guard.tsx` |
| Lectura y cálculo web | Next.js (App Router): un cargador de servidor lee las tablas paginando por `id` y los mapeadores calculan en cada consulta los indicadores heredados (riesgo, recomendación, puntaje 0–172) | `front/lib/data/raw-debtor-loader.ts`, `front/lib/data/paginated-table-reader.ts:46`, `front/lib/mappers/*`, [catálogo](catalogo-indicadores-v1.md) |
| Pantallas y reportes | Tablero, listados, ficha y vistas analíticas, solo lectura. No hay exportación de reportes desde la web | `front/app/**/page.tsx`; ALIGN-028 agrega los CSV |
| Reglas | **Tres fórmulas incompatibles**: índice heredado del ETL (persistido), puntaje y recomendación del frontend (por consulta) y puntaje y grupos del servicio Python. Las reglas v1 están integradas como especificación, pero ningún código las consume todavía | Contrato PR08, FO10–FO14, PY01–PY03 y §10; `contracts/decision-rules.v1.json`; ALIGN-009 y ALIGN-015 pendientes |
| FastAPI | Cuatro rutas GET (`/health`, `/case-groups/definitions`, `/case-groups/summary`, `/case-groups`) **sin autenticación**, con CORS para `localhost:3000` con credenciales y todos los métodos. El servicio de scoring usa el cliente con **clave de servicio** (ignora RLS y no filtra por municipio) y lee los perfiles sin paginar. **Ningún archivo de `front/` la llama** | `back/api/main.py:12-65`, `back/services/scoring_service.py:4`, `287-345` |

El problema que resuelve este ADR: una misma cartera recibe tres prioridades distintas, la falta de contacto suma severidad en unas y resta en otra (contrato §10), y la tesis podría describir una API que la aplicación no usa.

## 2. Decisión requerida

1. **Dónde se evalúan las reglas v1** (severidad, banderas, vulnerabilidad, intervención, prioridad y explicación) para que pantallas, reportes, servicio Python y simulación produzcan el mismo resultado con los mismos datos, corte y versión.
2. **Qué papel tiene FastAPI** y en qué condiciones puede desplegarse.
3. **Qué pasa con el scoring operativo Python** existente.

Restricciones: no reescribir la arquitectura (D-01); no modificar el proyecto original sin aprobación (plan v2 §7.6); los casos golden de ALIGN-008 son el oráculo; `as_of` sigue `NO_INTEGRADO`; las explicaciones deben ser fieles a la regla aplicada `[P0221]` y cada recomendación debe poder reconstruirse con sus datos y criterios `[P0113]`.

## 3. Opciones consideradas

### 3.1 Opción A: reglas en TypeScript leídas de un JSON compartido (elegida)

Un núcleo de funciones puras en TypeScript (ALIGN-009) lee `contracts/decision-rules.v1.json` y se evalúa en el servidor de Next sobre datos leídos con la sesión del usuario. Python implementa las mismas reglas desde el mismo JSON (ALIGN-015). Ambas implementaciones deben reproducir los 43 casos golden, los 14 pares contrafactuales y los 5 ordenamientos.

- **A favor:** no exige migrar ninguna base; los umbrales viven en un único archivo versionado; las funciones puras se prueban sin red ni base; la evaluación ocurre donde ya se leen los datos con RLS; revertir es revertir commits.
- **En contra:** dos implementaciones pueden divergir; la evaluación se repite en cada consulta; un consumidor que lea la base directamente (Data API, SQL) no obtiene la prioridad v1.
- **Mitigación:** los mismos golden en las dos suites (criterio de ALIGN-015: "golden idénticos en TS y Python"); cada resultado declara la versión de reglas y el corte; un cambio de parámetros crea una versión nueva con sus golden (reglas v1 §15).

### 3.2 Opción B: vista o función SQL (evolución)

Las reglas se implementan como vista o función de Postgres y cualquier cliente lee la prioridad ya calculada.

- **A favor:** un único lugar de cálculo para web, reportes, Python y lecturas directas; filtrar y ordenar por prioridad en la base.
- **En contra hoy:** para que valga en el proyecto real hay que **migrar el original**, lo que requiere aprobación humana y la remediación de ALIGN-045/046; el corte `as_of` todavía no existe como dato; las pruebas golden habría que repetirlas en SQL; la explicación contrastiva en SQL es frágil.
- **Condiciones para adoptarla:** migraciones del original autorizadas, `as_of` integrado por lote (ALIGN-024/032), reglas v1 aprobadas y estables, y los mismos golden pasando en la base. Se adopta con un ADR nuevo; las implementaciones TS y Python pasan a verificar contra la vista.

### 3.3 Opción C: FastAPI como fuente de reglas (descartada ahora)

La web consulta la prioridad a la API Python.

- **En contra:** la API no tiene autenticación y su servicio usa la clave de servicio (expondría la cartera de todos los municipios a quien llegue al puerto); hoy nadie la consume; agrega un servicio a desplegar y un salto de red en cada pantalla, contra D-01; la disponibilidad de la web pasaría a depender de un segundo proceso.
- **Qué la cambiaría:** la decisión de desplegar FastAPI con autenticación en todas sus rutas (D-03). Aun entonces, la web no la usaría para reglas mientras la opción A pase los golden.

### 3.4 Comparación

| Criterio | A: TS + JSON | B: vista/función SQL | C: FastAPI como fuente |
|---|---|---|---|
| Modifica el proyecto original | No | **Sí** (migración) | No |
| Respeta RLS en la lectura | Sí (sesión del usuario) | Sí, si la vista es `security_invoker` | **No** hoy (clave de servicio) |
| Autenticación necesaria nueva | No | No | **Sí** (ALIGN-052) |
| Paridad verificable con golden | Sí (TS y Python) | Sí, con pruebas en la base | Sí (Python) |
| Servicios a desplegar | Ninguno nuevo | Ninguno nuevo | Uno más |
| Disponible para lecturas directas por SQL | No | Sí | No |
| Reversión | Revertir commits | Migración inversa | Revertir commits y despliegue |

## 4. Decisión

1. **Fuente única de parámetros:** `contracts/decision-rules.v1.json`. Ningún umbral, banda, regla o texto de explicación se escribe dentro del código de TypeScript ni de Python.
2. **Evaluación en TypeScript (opción A):** el núcleo de ALIGN-009 se ejecuta en el servidor de Next, sobre los datos que el DAL de servidor (ALIGN-019) lee con la sesión del usuario. Pantallas y colas (ALIGN-010/021) y reportes CSV (ALIGN-028) consumen ese resultado; ningún componente de cliente recalcula reglas.
3. **Paridad Python:** `back/services/decision_rules_v1.py` (ALIGN-015) lee el mismo JSON y pasa los mismos golden. Lo usan la simulación (ALIGN-036) y el servicio interno.
4. **Vista o función SQL:** evolución, con las condiciones de §3.2. No se implementa en este plan.
5. **FastAPI no es fuente de reglas para la web.** La web no la consume para mostrar prioridades.
6. **FastAPI es un servicio interno y no se despliega sin autenticación.** Hasta que ALIGN-052 esté integrado, solo puede ejecutarse en `localhost` contra la base local con datos sintéticos. Para ejecutarse fuera de esa máquina debe cumplir, todas a la vez:
   - verificación de token en **todas** las rutas (algoritmo, emisor, audiencia y expiración) y contexto de municipio y rol resuelto en el servidor (ALIGN-052);
   - ninguna lectura con la clave de servicio general: cliente por solicitud con el contexto del usuario o lecturas acotadas al municipio autorizado (ALIGN-052);
   - CORS cerrado y el navegador sin acceso directo: la web llama servidor a servidor desde un Route Handler (D-23);
   - escucha solo en `localhost` o red interna; un despliegue público es otro ticket (ALIGN-050) y requiere la campaña de seguridad de ALIGN-059.
   Con ALIGN-052, FastAPI pasa a ser también el **servicio interno de importación**; ese ticket amplía este ADR.
7. **Destino del scoring operativo Python: alinear a v1 y archivar la fórmula v0.** En ALIGN-015, las rutas `/case-groups*` dejan de calcular con `classify_risk_band`, `calculate_priority_score`, `build_case_tags` y `assign_case_group` (contrato PY01–PY03) y pasan a agrupar por **intervención v1** (la cola) y a ordenar por **prioridad v1** con `decision_rules_v1.py`, leyendo la cartera completa (paginación por `id`). La fórmula v0 no queda como alternativa activa: se retira del camino operativo y su descripción queda en el contrato (PY01–PY03) y en el historial de git.
   - **Por qué alinear y no archivar todo:** ALIGN-015 pide que "API y simulación usen la misma regla" y ALIGN-052 asegura las rutas de scoring con contexto de usuario; retirarlas dejaría a ese ticket sin objeto.
   - **Cuándo se archiva por completo:** si ALIGN-052 se difiere o si ALIGN-015 muestra que la alineación excede su alcance, las rutas `/case-groups*` se retiran y la agrupación operativa queda solo en las colas de la web (ALIGN-010/021). El cambio se registra como versión nueva de este ADR.
   - Mientras ninguna de las dos cosas ocurra, el scoring v0 es **heredado y no operativo**: ninguna pantalla, reporte ni simulación lo usa.

## 5. Flujo real y capas

Trazo continuo: existe en `c17a1bf` y sigue igual en la integración con ALIGN-011 (`ab4c5b3`), que no modificó los archivos citados en este ADR. Trazo discontinuo: lo agrega el ticket indicado. El diagrama del plan (§4) muestra además la importación web, la analítica experimental y el chat, que no cambian esta decisión.

```mermaid
flowchart LR
  subgraph Ingesta
    TSV["TSV cabecera y detalle"] --> PRE["Solo con execute: guardia de destino ALIGN-025<br/>antes de extraer; solo local o testing en loopback<br/>original rechazado"]
    PRE --> EXT["ETL CLI: extract.py"]
    EXT --> VAL["Validación<br/>hoy parcial en transform.py<br/>contrato de origen: ALIGN-024"]
    VAL --> DRY["Modo por defecto: dry-run<br/>resumen, sin escritura"]
    VAL -->|modo execute| GUARD["Revalidación del destino<br/>al crear el cliente"]
    GUARD --> LOAD["load.py<br/>REST con clave de servicio"]
  end
  LOAD --> DB[("Supabase Postgres<br/>RLS por membresía")]
  AUTH["Supabase Auth<br/>email y contraseña"]
  NAV["Navegador"] -->|inicio de sesión| AUTH
  AUTH -->|sesión en cookies| DAL
  DB -->|lectura con la sesión del usuario| DAL["Lectura de servidor Next<br/>paginada por id<br/>DAL: ALIGN-019"]
  DAL --> MAP["Mapeadores<br/>indicadores heredados<br/>ver catálogo"]
  MAP --> UI["Pantallas<br/>tablero, listados, ficha"]
  NAV --> UI
  JSON["contracts/decision-rules.v1.json<br/>+ casos golden"]
  JSON -.-> TSR["Núcleo TS reglas v1<br/>ALIGN-009"]
  DAL -.-> TSR
  TSR -.->|colas e intervención ALIGN-010/021| UI
  TSR -.-> CSV["Reportes CSV<br/>ALIGN-028"]
  JSON -.-> PYR["Reglas Python v1<br/>ALIGN-015"]
  PYR -.-> SIM["Simulación<br/>ALIGN-036"]
  subgraph Interno["FastAPI interna: no desplegable sin autenticación"]
    API["back/api/main.py<br/>sin autenticación, no consumida"]
    SCO["scoring_service v0<br/>PY01-PY03, heredado"]
    API --> SCO
  end
  SCO -->|clave de servicio, sin RLS| DB
  PYR -.->|reemplaza la fórmula v0, ALIGN-015| SCO
  AUTH -.->|token verificado en todas las rutas, ALIGN-052| API
  classDef plan stroke-dasharray: 5 5
  class TSR,CSV,PYR,SIM plan
```

| Capa | Responsabilidad | No hace |
|---|---|---|
| ETL y validación | Leer el lote, validar contra el contrato de origen, cargar en el destino permitido | Calcular la prioridad v1 ni escribir en el original |
| Supabase | Guardar los datos y aplicar RLS por membresía | Calcular reglas (hasta la evolución de §3.2) |
| Auth | Identificar al usuario y su sesión | Decidir permisos de negocio en el navegador |
| Servidor Next (DAL y núcleo TS) | Leer con la sesión, evaluar reglas v1 y armar pantallas y reportes | Leer con la clave de servicio ni recalcular reglas en el cliente |
| FastAPI interna | Scoring alineado a v1 e importación (ALIGN-052), solo servidor a servidor | Servir reglas a la web ni exponerse sin autenticación |
| Python por lotes | Simulación con las mismas reglas | Modificar prioridades de la web |

### 5.1 FastAPI como servicio interno de importación (ALIGN-052)

Esta sección amplía §4.6, como ese punto anticipaba. Con ALIGN-052 integrado, FastAPI es el **servicio interno de importación** y cumple las condiciones de §4.6 para `localhost`; sigue sin ser fuente de reglas para la web (§4.5).

- **Camino.** El navegador llama al Route Handler `front/app/api/imports/*`, que reenvía de servidor a servidor con el token de la sesión. La URL interna no llega al navegador, no hay CORS y FastAPI solo admite `Host` de loopback.
- **Autenticación.** Todas las rutas verifican el token con la clave pública del emisor (`ES256`, emisor, audiencia, expiración) y la sesión contra Auth. No se comparte ningún secreto de firma.
- **Contexto.** Membresía activa y rol se resuelven en cada solicitud con el token del usuario. Lo que envía el cliente se ignora. Un usuario con dos membresías recibe `409`: selección pendiente de decisión ([`importacion-web.md`](importacion-web.md)).
- **Datos.** `back/services/scoring_service.py` deja de tener un cliente global: recibe el de la solicitud y filtra por el municipio resuelto. No hay respaldo en la clave de servicio general. La CLI del ETL (`run_etl --execute`) sigue siendo el único uso de esa clave, solo contra loopback (ALIGN-025).
- **Escritura.** `record_import_batch` con la credencial dedicada `equitas_import_server`.
- **Next y el proxy.** La ruta queda fuera del matcher de `proxy.ts`, porque el proxy corta los cuerpos en 10 MB sin avisar. Su autoridad es FastAPI: el Route Handler no consulta la DAL de ALIGN-019, y solo extrae el token.
- **Límites.** Rutas de lote solo para `importador`; un lote ajeno da `404`, igual que uno inexistente. Mapeo, preview y confirmación los agregan sus tickets.
- **Temporal privado.** Una fila no anuncia una copia que no existe: se reintenta con la misma clave y se restaura mientras el lote siga abierto. Las 24 h rigen sin depender de otras solicitudes: la API purga al arrancar y periódicamente, y no entrega lo vencido.
- **Concurrencia.** Instalar, retirar y cerrar un lote ocurren bajo una exclusión por lote, entre hilos y procesos; nada se borra por el nombre del lote, sino por la generación movida a un nombre privado.
- **Registros.** Lo que uvicorn imprime de una solicitud se filtra por lista cerrada, con o sin sesión, y ninguna consulta de esta API lleva un valor del cliente en su URL: ni siquiera uno numérico llega a los registros del proceso ni a los de Kong.

Contrato, códigos y temporal privado: [`importacion-web.md`](importacion-web.md). Ejecución y permisos de lectura: [`back/api/README.md`](../../back/api/README.md).

## 6. Consecuencias y obligaciones

| Ticket | Obligación que deriva de este ADR |
|---|---|
| ALIGN-009 | Núcleo TS puro que lee el JSON y pasa todos los golden |
| ALIGN-010, 021 | Pantallas y colas consumen el núcleo TS; muestran versión de reglas y corte (o su sustituto rotulado) |
| ALIGN-014 | Las cifras del tablero siguen el [catálogo](catalogo-indicadores-v1.md); los indicadores heredados que se reemplazan por dimensiones v1 se agregan como entradas nuevas |
| ALIGN-015 | Paridad Python con los mismos golden; scoring alineado a v1 (§4.7); lectura completa paginada; FastAPI documentada como interna |
| ALIGN-019, 028 | El DAL de servidor es el único camino de lectura para pantallas y reportes |
| ALIGN-052 | Autenticación en todas las rutas, sin clave de servicio general; amplía este ADR con la importación interna |
| ALIGN-050, 059 | Cualquier despliegue de FastAPI fuera de la máquina local pasa por ellos |

Consecuencias aceptadas:

- Mientras ALIGN-009 y ALIGN-010 no estén integrados, las pantallas siguen mostrando los indicadores heredados del [catálogo](catalogo-indicadores-v1.md) y la tesis debe describirlos como tales.
- Las lecturas directas por la Data API no obtienen la prioridad v1 ni quedan auditadas (D-34); forzar un camino único es evolución.
- La paridad depende de que los golden cubran los casos de borde; un caso nuevo se agrega a las dos suites a la vez.

## 7. Control de versiones

| Versión | Fecha | Cambio |
|---|---|---|
| 1 | 29/10/2026 | Versión inicial (ALIGN-013). Provisional hasta la revisión independiente. ALIGN-052 la amplía con la importación interna |
| 1 (corrección 1) | 29/10/2026 | Revisión independiente: el diagrama muestra la guardia de `--execute` antes de extraer (`back/ETL/run_etl.py:69-72`), el final del dry-run sin escritura (`:113-118`) y la revalidación del destino al crear el cliente |
| 1 (implementación Python) | 29/10/2026 | ALIGN-015 implementa §4.3 y §4.7 sin cambiar la decisión: núcleo JSON v1, paginación por id y retiro de la fórmula v0 del servicio. Detalle en §8 |

## 8. Implementación Python — ALIGN-015

El diagnóstico y el diagrama de §1/§5 conservan el estado histórico del SHA
citado. En ALIGN-015, `back/services/decision_rules_v1.py` consume el JSON v1 y
reproduce los objetos completos, pares y ordenamientos del golden compartido.
`scoring_service.py` agrupa por intervención y ordena dentro de cada cola por
prioridad v1. Retira las cuatro funciones v0 de §4.7; su descripción permanece
en el contrato PY01–PY03 y el código, en git (BASE `b5bc9ab7`).

La lectura usa cursor por `id` hasta página vacía en perfiles, objetos y las
tablas que alimentan la decisión. El universo son todos los objetos, incluidos
los que no tienen perfil persistido. Las obligaciones y contactos originales,
no los agregados del perfil, alimentan el adaptador del contrato. Los errores
de lectura abortan la solicitud con HTTP 503, sin evaluar prefijos ni convertir
un fallo en un cero.

Las rutas de scoring requieren corte `as_of` declarado; responden con su
procedencia y la versión de reglas. El corte municipal sigue no integrado.
`severity_band` reemplaza el nombre v0 `risk_band`. No se modificó el frontend
ni se desplegó FastAPI: siguen vigentes todas las restricciones de §4.5/§4.6.
La paridad ejecutada aquí es Python contra el oráculo congelado; ejecutar la
suite TS corresponde a la integración de ALIGN-009.

El [README interno de la API](../../back/api/README.md) detalla contrato HTTP,
adaptación de faltantes, restricciones y reproducibilidad. Los resultados de
rendimiento E08/E11 no se extrapolan a esta versión: véase la nota en
[`RENDIMIENTO_CALIDAD.md`](../../RENDIMIENTO_CALIDAD.md).

## 9. Frontera de autorización de lecturas (ALIGN-019, 30/10/2026)

Las pantallas de servidor ya no dependen del `AuthGuard` de navegador para impedir
la lectura. `front/lib/server/dal.ts` usa `auth.getUser()` con el cliente de sesión,
resuelve el usuario de aplicación por `auth_user`, exige `user.status = ACTIVE`,
una membresía `tenant_user.status = true`, municipio activo y rol aprobado en el
catálogo `role.name`. No acepta roles enviados por el navegador ni equivalencias
implícitas (`admin`, `operator` o un ID de rol no conceden permisos). El catálogo es
una precondición de despliegue; ver «Precondición de despliegue» más abajo.

Sin selección se exige exactamente una membresía activa. Con varias, se devuelve
`TENANT_SELECTION_REQUIRED`; el llamador puede indicar `tenantId` o la cookie
`equitas_tenant_id`. Esa selección es entrada no confiable: se vuelve a comprobar
contra las membresías del usuario en cada entrada, y nunca concede acceso sola.
El conteo exacto evita que un límite de filas oculte una segunda membresía.
La selección no se agrega como filtro a PostgREST: primero se leen, con la sesión
y el ID de usuario resuelto, todas sus membresías visibles, paginadas por `id`
hasta una página vacía. La comparación con la cookie ocurre en memoria. Solo
después de comprobar la membresía activa se usan los IDs canónicos de municipio
y rol devueltos por la base. Una página fallida invalida toda la resolución;
una página corta no se interpreta como fin. Sin cookie se conserva la consulta
limitada con conteo exacto. El motivo y los límites de privacidad están en
[la nota de la frontera DAL](privacidad-frontera-dal.md).
El ingreso deriva a `/select-tenant` cuando hace falta elegir. Esa pantalla carga
las membresías propias paginadas, sin opción preseleccionada; vuelve a validar la
elección antes de guardar la cookie. Ingresar o salir borra la selección anterior.

`requireTenantAccess({ permission, tenantId? })` devuelve contexto y cliente de
sesión **solo dentro del servidor**. Lectura de cartera: `consulta`, `operador`,
`supervisor`; registro de decisiones: `operador`; aprobación y supervisión:
`supervisor`; importación: `importador`. Coincide con ALIGN-003 y con las funciones
de ALIGN-018: quien sea supervisor e importe necesita además una membresía
`importador`. `importador_sistema` no tiene acceso web. Estos permisos no
implementan escrituras. ALIGN-028 agrega `decision:read` (`consulta`, `operador`,
`supervisor`) para leer decisiones sin texto libre ni identidades, y
`report:object-identifier` (`operador`, `supervisor`), que no abre ninguna lectura: decide
quién recibe en la cola el identificador de origen, que es texto libre.
ALIGN-021 agrega `review:read`, lectura de decisiones para
`consulta`, `operador` y `supervisor`: la compatibilidad E06 no lo tiene. La pestaña
"Revisión" deriva de esta misma tabla qué formulario ofrece (`roleHasPermission`), y
la acción lo vuelve a comprobar.

Las capacidades se deciden por el nombre del rol, solo en la DAL. El resultado de
`validateAuthUserTenantAccess`, que usan el navegador y `SUP-AUTH-01`, lleva en
`context.role` el **ID** del rol en texto, sin campos adicionales. El contexto de la
DAL separa `roleId` y `roleName`, sin un campo `role`, para que nadie lea uno por otro.

`createTenantReader()` es la entrada de los cargadores de objetos y personas.
Cada consulta de negocio lleva el filtro del municipio autorizado, directamente o
por relaciones `!inner`, incluidas todas las páginas de una lectura paginada. Los
alias de relación se eliminan de las filas antes de mapearlas. Solo los catálogos
compartidos carecen de filtro de municipio; también requieren autorización previa.
RLS sigue siendo una segunda barrera, necesaria para las lecturas directas por la
Data API. La DAL no reemplaza RLS ni audita accesos directos a PostgREST.

El recálculo de decisiones (`case-review-snapshot.ts`) tampoco envía el `debtorId`
del formulario como filtro antes de verificarlo. Lee los objetos del municipio
autorizado, paginados hasta una respuesta vacía, busca el recibido en memoria
y solo entonces usa el ID canónico para acotar deudas, personas y contactos.
Una lectura incompleta detiene el recálculo. Conserva la verificación del corte,
la sesión y RLS. Este paso cuesta O(N) objetos del municipio por recálculo;
no acredita rendimiento a escala municipal.

Una denegación produce `DataAccessError`, sin cartera ni métricas. Los errores de
consulta conservan `DataWarning`: los indicadores dicen «No disponible» y hay aviso,
sin convertir el fallo en un cero (ALIGN-011/012, contrato §4.1.6). ALIGN-014 cubre
el traspaso de listas y detalle: una lectura fallida muestra aviso de no
disponibilidad, sin texto de vacío ni paginación 0–0; `debtor` fallido no devuelve
404. Solo una lectura correcta sin objeto produce «no encontrado». La analítica
mantiene cobertura y población seleccionada antes de paginar. Las proyecciones
excluyen `person.birth_date` y `debtor_profile_detail.reason`, y leen importes
como texto para validar los centavos sin pérdida de precisión. Se conservan las
uniones y filtros de alcance. No hay caché de autorización entre solicitudes,
clave de servicio ni secretos nuevos.

**Sin sesión** (cookie ausente o rechazada por Auth), `front/proxy.ts` responde 307 a
`/login?next=<ruta>` en HTML y RSC, antes del streaming. Solo `/login`,
`/select-tenant` y `/api/build-info` quedan fuera, por ruta exacta. Es una comprobación
optimista: la DAL sigue siendo la autoridad y no depende de ella. `next` lleva solo
la ruta, sin consulta, y `safeNextPath` lo valida al crearlo y en `/login`, de modo que
no puede llevar a otro host. Si Auth no responde (red, 5xx, 429 o respuesta
ilegible) no se puede saber si hay sesión: el proxy deja seguir la solicitud y la DAL
falla cerrada con `AUTH_UNAVAILABLE`, sin mandar a nadie a ingresar.

**Con sesión, la denegación es siempre HTTP 200**, en HTML y RSC. `app/loading.tsx`
inicia el streaming antes de que corra la DAL, así que el error llega al límite
`app/error.tsx` como registro Flight con digest, sin el mensaje, sin cartera y con
un `Cache-Control` que incluye `private` y `no-store`. Por eso el estado HTTP no sirve como señal de
monitoreo: hay que mirar el contenido. Esa pantalla ofrece «Intentar nuevamente», que
recarga el documento, y «Cerrar sesión», la salida de quien tiene sesión válida y no
puede leer cartera, como `importador`. Los futuros Route Handlers deben traducir
`error.status` a un estado HTTP explícito (401/403/409/503), sin serializar el
cliente de sesión. Un anónimo recibe antes el 307 del proxy; si ALIGN-028 necesita
responderle 401, debe exceptuar esa ruta en `proxy.ts` y seguir autorizando en el handler.

**Excepción de compatibilidad: `tp_operator` (campaña E06).**
`E06_READ_ONLY_COMPAT_ROLE` (`front/lib/auth/tenant-access.ts`) admite ese nombre con
una sola capacidad, `portfolio:read`, igual que `consulta`. **No es un rol aprobado por
ALIGN-003:** está fuera de `WEB_ROLES`, no aparece en el selector ni en la interfaz
y no depende del entorno.

- *Por qué existe.* Es el rol de las cuentas sintéticas de `database/testing/fixtures.sql`.
  Sin esta excepción, esas cuentas no entran y fallan `test:supabase`, obligatoria en
  `main` y `quality/tp-testing`, y SMOKE-01. El plan congelado prohíbe modificar esa
  fixture, la campaña de 12 casos y SMOKE-01 (ALIGN-016, ALIGN-022, `TEST-PLAN.md`), y
  cambiarla exigiría además un paso humano sobre el proyecto de pruebas.
- *Qué no amplía.* Antes de ALIGN-019 ninguna capa miraba el nombre del rol: estas cuentas
  ya entraban y leían lo que RLS les permitiera. Ahora leen por la DAL, filtradas por su
  municipio. No registran, aprueban, supervisan ni importan: la DAL lo deniega y
  las funciones de ALIGN-018 tampoco aceptan ese nombre. No cambia la Data API.
- *Riesgo que queda.* Sin interruptor por entorno, una fila `role.name = 'tp_operator'`
  en cualquier base da lectura de cartera a sus miembros, en su municipio.
- *Cómo se retira.* Cuando un ticket autorizado pase la campaña E06 a un rol aprobado
  (fixture, `cleanup.sql`, fila del proyecto de pruebas), se borran
  `E06_READ_ONLY_COMPAT_ROLE`, `ResolvedRoleName` y su entrada en `portfolio:read`, y su
  fila en las pruebas de permisos. No requiere migración de datos.

**Precondición de despliegue: el catálogo `role.name`.** La DAL compara el nombre
exacto y ninguna migración carga los roles aprobados. En el proyecto original se
desconoce el contenido de `role`, porque el repositorio solo tiene el esquema. Antes
de apuntar esta versión a una base hay que mapear sus roles a `consulta`, `operador`,
`supervisor` e `importador`, y comprobar que no exista `tp_operator`. Sin ese mapeo
el bloqueo es total: toda cuenta recibe `ROLE_FORBIDDEN`, sin datos.

Puntos cubiertos: tablero `/`, objetos `/debtors`, detalle `/debtors/[debtorId]`,
personas `/people`, colas `/priority-cases`, sin contacto `/no-contact`, mora
`/debt-aging`, riesgo `/risk-analysis`, acciones recomendadas `/recommended-actions`.
Las Server Actions de ALIGN-020 ya autorizan dentro de cada entrada. Las futuras lecturas
de revisión (021) y rutas CSV (028) deben autorizar **dentro de cada entrada** y extender
el lector con filtros de tenant para tablas nuevas. La auditoría de apertura de detalle y exportación (069) debe
insertarse después de autorizar y antes de entregar el DTO, sin datos personales.

**Reportes CSV (ALIGN-028).** `front/app/api/reports/*/route.ts` autorizan dentro de cada
entrada, antes de validar filtros o leer (`csvReportResponse`, `front/lib/server/report-response.ts`):
`DataAccessError.status` pasa a 401, 403, 409 o 503 con el código y sin datos. La cola y la
calidad usan `portfolio:read` y el mismo lector de cartera que las pantallas; decisiones usa
`decision:read` y supervisión, `supervision:read`. `tp_operator` no entra a estas dos: solo lee
cartera. `case_review` y `case_review_approval` se leen con columnas explícitas y filtro de
municipio, por `front/lib/server/review-report-reader.ts`; `tenantReadScope` no se abrió a esas
tablas para que un cargador de cartera no las alcance. **El anónimo sigue recibiendo el 307 del
proxy:** se conservó porque un enlace de descarga abierto desde el navegador vuelve al reporte
después de ingresar. Un cliente que siga la redirección recibe HTML, no un CSV. El 401 del handler
cubre la sesión que vence entre el proxy y la DAL. Con cualquier `DataWarning` el reporte
responde 503 sin archivo: el CSV viaja fuera de la aplicación, donde el aviso de lectura no se ve.
Un código editable (`reason_code`, intervenciones, rol) solo se exporta si está en una lista
cerrada (`front/lib/reports/report-codes.ts`): la base exige formato, no significado, y un formato
válido puede llevar un nombre. Formato y columnas: [catálogo, reportes CSV](catalogo-indicadores-v1.md#reportes-csv).

Validación del 30/10: pruebas negativas y positivas con Auth/REST simulados y ocho
pruebas directas HTML/RSC sobre Supabase local con `USING(true)`, tanto con Next dev
como con compilación de producción. La precondición verifica que REST entrega
ambas carteras al usuario sin membresía; la DAL deniega esa misma identidad en las
nueve rutas. Los controles positivos comprueban separación A/B, detalle ajeno,
personas y selección explícita, sin avisos de consulta fallida. Se restauraron las
tres migraciones antes de liberar el lock. Evidencia depurada: paquete del plan,
`execution/evidence/ALIGN-019/`.

Validación del 31/10, ciclo de corrección 1. La revisión independiente pidió cambios
por dos regresiones sin fuga: la fixture E06 quedaba sin acceso y sin sesión no se
llegaba a `/login`. Con la fixture E06 sin tocar, `test:supabase` da 12/12 y SMOKE-01
5/5, igual que la base; corrieron en copias locales, sin ningún proyecto remoto. Sobre
`USING(true)` pasan los diez casos directos en HTML y RSC. El barrido adicional de
contextos quedó no concluyente por la carga de la máquina: sin hallazgos, pero con
sesión no llegó a medir. Con la cuenta E06 se comprobó que solo lee: la DAL deniega
los demás permisos, la Data API con RLS rechaza sus escrituras y las funciones de
ALIGN-018 responden `ROLE_NOT_ALLOWED`. Falta la re-revisión independiente.

Validación del 02/11, con la máquina libre y sobre `f547bba`. `test:supabase` da 12/12
y SMOKE-01 5/5. El barrido de contextos reemplaza al no concluyente del 31/10: aprobado,
con 1.140 solicitudes en 29 contextos, sin hallazgos y sin contextos sin medir; antes,
un mutante de la DAL comprobó que la sonda puede fallar. En los gates, el único control
en falla es `audit`, por el aviso GHSA-g3hv-75wg-m249 (solo desarrollo, 0 hallazgos en
producción), desvío declarado que autorizó el usuario. Falta la re-revisión
independiente.

ALIGN-014 integra el corte publicado para las lecturas de cartera mediante `createTenantReader.readImportBatches`: misma sesión y contexto municipal, proyección mínima y paginación completa. No cambia resolución de identidad, membresía, tabla de permisos ni filtros de objeto. `portfolio-cutoff.ts` reutiliza `selectCurrentCutoff` de revisión sin modificar su archivo; valida eventos y compara publicación antes/después de leer cartera. Un corte incierto bloquea cálculo y exportación. La lectura HTTP no promete un snapshot MVCC; revisión conserva la verificación transaccional de la base.
