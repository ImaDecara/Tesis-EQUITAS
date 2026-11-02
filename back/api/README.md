# FastAPI interna — importación y reglas v1 (ALIGN-015, ALIGN-052)

Servicio **interno**: escucha en `127.0.0.1` y el navegador nunca lo llama. La web
entra por el Route Handler de Next `front/app/api/imports/*`, que reenvía de servidor
a servidor con el token de la sesión. El despliegue público es otro ticket (ALIGN-050)
y pasa por la campaña de ALIGN-059. El contrato de lotes y la decisión de arquitectura
están en [`importacion-web.md`](../../docs/tesis/importacion-web.md) y en
[ADR-001](../../docs/tesis/adr-001-reglas-y-capas.md) §5.1.

## Autenticación y permisos

**Todas las rutas** exigen `Authorization: Bearer <token de sesión>`, también `/health`.
No se publica `/docs` ni `/openapi.json`, no hay CORS y solo se aceptan encabezados
`Host` de loopback. Dos comprobaciones por solicitud, sin secretos de firma compartidos:

1. Firma y claims contra la clave pública del emisor (`/auth/v1/.well-known/jwks.json`):
   algoritmo permitido `ES256`, emisor `<SUPABASE_URL>/auth/v1`, audiencia y rol
   `authenticated`, expiración y sujeto UUID. HS256 se rechaza aunque PostgREST lo acepte.
2. Sesión viva en Auth (`/auth/v1/user`): al cerrar sesión el token deja de valer aunque
   no haya vencido. Si Auth no responde es `503 AUTH_UNAVAILABLE`, no un cierre de sesión.

Membresía y rol se leen en cada solicitud con el token del usuario, bajo RLS: una
revocación rige en la solicitud siguiente. **Cualquier municipio que mande el cliente se
ignora**, en cuerpo, consulta, encabezado o cookie.

| Ruta | Roles | Sin permiso |
|---|---|---|
| `GET /health` | Cualquier sesión válida; no lee datos | 401 |
| `GET /case-groups`, `/summary`, `/definitions` | `consulta`, `operador`, `supervisor` | 403 |
| `POST /imports`, `GET /imports/{id}`, `POST /imports/{id}/discard` | `importador` | 403; lote ajeno o inexistente, 404 |

| Código | Significado |
|---|---|
| `401 AUTH_REQUIRED` | Token ausente, vencido, de otro emisor o algoritmo, o sesión cerrada. Mismo cuerpo siempre |
| `403 MEMBERSHIP_REQUIRED` | Sin membresía activa, usuario o municipio inactivos |
| `403 ROLE_FORBIDDEN` | El rol no permite la operación |
| `409 TENANT_SELECTION_REQUIRED` | Dos membresías activas: esta versión no recibe selección (ver `importacion-web.md`) |
| `503 AUTH_UNAVAILABLE`, `CONTEXT_UNAVAILABLE`, `API_NOT_CONFIGURED` | Falla cerrada; sin datos |

`importador_sistema` es una credencial de máquina sin sesión de Auth: entra por ALIGN-060,
no por esta verificación. `importador` no lee la cartera, igual que `portfolio:read` de la
DAL de ALIGN-019. La compatibilidad `tp_operator` de E06 no existe en esta API.

## Lecturas y credenciales

No hay cliente global ni respaldo en la clave de servicio general: el módulo no la lee, y
`SUPABASE_PUBLISHABLE_KEY` se rechaza si es una clave secreta o de `service_role`.

| Lectura | Credencial | Permiso |
|---|---|---|
| `user`, `tenant_user`, `tenant`, `role` (contexto) | Token del usuario | RLS de `20261021221030_active_membership_rls.sql` |
| `debtor` filtrado por `tenant`; `debt`, `debtor_profile`, `debtor_person`, `person`, `debtor_contact` por ids de esos objetos; `person_type` | Token del usuario | RLS más el filtro: con dos membresías RLS muestra ambos municipios |
| `import_batch` filtrado por `tenant` | Token del usuario | `member_read_import_batch` más el filtro |
| `record_import_batch` | JWT dedicado `equitas_import_server` (`EQUITAS_IMPORT_SERVER_JWT`) | Solo `EXECUTE` de esa función; no lee ni escribe tablas. Otro `role` se rechaza |

## Ejecución local

```sh
python3 -I database/testing/case_review_local.py mint-jwt --role equitas_import_server --hours 12
cd back
EQUITAS_TARGET_ENV=local SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_PUBLISHABLE_KEY=<clave publicable local> \
EQUITAS_IMPORT_SERVER_JWT="$(cat /tmp/equitas-local-db/equitas_import_server.jwt)" \
EQUITAS_IMPORT_TMP_DIR=<directorio privado, fuera del repositorio> \
.venv/bin/python -m uvicorn api.main:app --host 127.0.0.1 --port <puerto alto>
```

`SUPABASE_URL` debe coincidir con el emisor de los tokens. `validate_execution_target`
(ALIGN-025) corre en cada solicitud y solo admite loopback. Next necesita, sin prefijo
`NEXT_PUBLIC_`, `EQUITAS_IMPORT_API_URL=http://127.0.0.1:<puerto>`.

`EQUITAS_IMPORT_PURGE_SECONDS` fija cada cuánto se purga el temporal: de 1 a 3600, 900 por
defecto. Un valor inválido no alarga la retención: rige el valor por defecto.

**Los registros no llevan datos del cliente, con o sin sesión** (`api/log_guard.py`). Uvicorn
imprime lo que recibe antes de que la API decida nada, así que se filtra por lista cerrada:

| Fuente | Qué queda |
|---|---|
| Acceso (`uvicorn.access`) | Forma de la ruta: los segmentos fijos, y `<x>` en lugar de cualquier otro, también los numéricos. Sin consulta. Método solo si es uno conocido. La dirección es `-`, porque uvicorn la toma de `X-Forwarded-For` cuando la conexión viene de loopback |
| Servidor (`uvicorn.error`) | Ciclo de vida. Un error deja solo la clase de la excepción. Handshakes WebSocket y líneas de depuración se descartan |
| Nivel `trace` (`uvicorn.asgi`) | Nada: imprimiría el scope de cada solicitud |
| Aplicación (`equitas.api`) | Códigos y números del servidor: `IMPORT_RECIBIDO lote=…`, `AUTH_RECHAZADO motivo=…`, `PURGA_FALLIDA clase=…` |

Un identificador interno que haga falta registrar sale del evento autorizado, nunca de la ruta
recibida. Una ruta nueva debe sumar sus segmentos fijos a `LOGGABLE_SEGMENTS`; si no, se ve
como `<x>`. Esto cubre los registros de este proceso: los de Kong y PostgREST en el stack local
tienen sus propias reglas.

## Reglas y corte

`services.decision_rules_v1.evaluate(entrada)` es puro: lee los parámetros y
textos de `contracts/decision-rules.v1.json` y devuelve exactamente la estructura
del golden compartido. No usa Supabase, el reloj ni los demás objetos del lote.
La simulación puede importar ese núcleo directamente. El llamador conserva
`RULES_VERSION`, el id y `as_of` junto a cada decisión.

Las rutas de scoring exigen `as_of=YYYY-MM-DD`. Un corte ausente o inválido
produce HTTP 422 antes de consultar datos. No se sustituye por la fecha de hoy.
La respuesta declara `version_reglas`, `as_of` y, por caso, la procedencia del
corte: declarado por el llamador; el corte municipal sigue no integrado.

| Ruta GET | Resultado |
|---|---|
| `/health` | Estado del proceso; no consulta datos |
| `/case-groups/definitions` | Intervenciones y colas del JSON v1 |
| `/case-groups?as_of=2026-09-30` | Casos con decisión v1 completa y metadatos |
| `/case-groups/summary?as_of=2026-09-30` | Conteos de colas, bandas de severidad y contacto |

Filtros: `group_key` (código de intervención), `severity_band` (`BAJA`, `MEDIA`,
`ALTA`, `NO_DISPONIBLE`), `tag` (bandera v1) y `search` (referencias del objeto).
`limit` admite 1–500 y `offset` es no negativo. La paginación de la respuesta
se aplica **después** de completar, evaluar, agrupar y ordenar la cartera.

Las colas se concatenan en el orden declarado por `intervenciones` en el JSON;
no se comparan prioridades entre colas. Dentro de cada cola se usa prioridad
descendente, monto descendente, vencimiento más antiguo ascendente e id textual
por punto de código; los nulos van al final. La severidad no disponible se cuenta
en su propia banda y conserva prioridad null, nunca cero.

## Lectura y adaptación del esquema

- Se leen todos los objetos `debtor` del municipio, incluso sin perfil persistido. Los perfiles
  activos solo aportan su id de referencia; si hay varios, se referencia el id
  mayor. Sus totales, riesgo, antigüedad y contactos v0 no intervienen en v1.
- Todas las lecturas usan orden ascendente por `id`, `id > cursor` y límite
  solicitado 1000. Se continúa hasta una página vacía, incluso si el servidor
  devuelve menos filas. Los filtros de ids se dividen en lotes de 200 y se
  paginan también. Un cursor repetido, desordenado o inválido es un error.
- `debt.current_amount` y `due_date` alimentan las reglas al corte declarado.
  El adaptador distingue ausencia, campo no integrado y dato inválido; conserva
  el cero observado. Solo acepta `updated_amount` como alias cuando la columna
  `current_amount` no existe; nunca usa capital como respaldo. Las consultas
  del esquema vigente seleccionan `current_amount`.
- Contactos: relaciones activas, contactos activos y valor no vacío; se deduplica
  por persona, canal y valor sin distinguir mayúsculas. Contacto cargado no
  significa validado. No se usa el conteo persistido de perfiles.
- Los porcentajes declarados se conservan sin normalizar. El tipo se resuelve
  por claves explícitas de catálogo (`FISICA`/`INDIVIDUAL`,
  `JURIDICA`/`LEGAL_PERSON`, `UNKNOWN`); claves no homologadas son `INVALIDO` y
  solo activan una bandera. No se consulta nombre, documento ni domicilio.
- `period`, `status` e `issue_date` heredados no se presentan como período
  fiscal, estado de origen ni actualización de lote: esas entradas son
  `NO_INTEGRADO`. Vulnerabilidad permanece `NO_INFORMADO_EN_ORIGEN`.
- Una lectura fallida invalida la solicitud: HTTP 503 `READ_INCOMPLETE` y nombre
  de tabla, sin payload remoto ni resultados parciales. No se trata como una
  cartera vacía ni como ausencia de deuda/contacto.

La paginación por cursor necesita un lote estable; no crea un snapshot
transaccional entre consultas. La aprobación municipal de la política v1 y la
integración del corte y los catálogos de origen siguen pendientes de sus tickets.
El ETL heredado pudo persistir inválidos como cero: este servicio no puede
reconstruir la ausencia que ya se perdió en origen (ALIGN-024/026).

## Incompatibilidad deliberada con v0

Se retiraron `classify_risk_band`, `calculate_priority_score`, `build_case_tags`
y `assign_case_group` del servicio. Su archivo histórico es
`back/services/scoring_service.py` en `b5bc9ab7db990000b68232f4f7e86386ed7684e9`
y su descripción está en PY01–PY03 del contrato. No existe un selector de
fórmula v0 en ejecución. `risk_band` se reemplaza por `severity_band`; no se
devuelve `socioeconomic_risk_level` ni se imprime un porcentaje de riesgo.

Las cargas E08/E11 y sus fixtures pertenecen a sus SHA históricos, no validan
este contrato HTTP ni estas lecturas. Repetirlas exige una fixture v1 y una
nueva campaña; [nota de rendimiento](../../RENDIMIENTO_CALIDAD.md).

## Verificación sin red

Desde `back/`, con las dependencias fijadas:

```sh
.venv/bin/python -m pytest --cov
.venv/bin/python -m ruff check ETL api services
```

Los golden, contrafactuales, ordenamientos y pruebas de paginación son sintéticos.
Las pruebas inyectan clientes falsos: no necesitan credenciales ni bases remotas.
La CLI requiere un corte explícito y una sesión (`EQUITAS_SESSION_TOKEN=<token> python -m
services.scoring_service --as-of YYYY-MM-DD`): resuelve el municipio igual que la API, exige
un rol de lectura y muestra solo conteos. Sin sesión termina con el código, sin leer nada.

## Verificación contra el stack local

Con el turno de la base y después de `db reset --local`, desde `back/`:

```sh
.venv/bin/python -m pytest tests_real -q
```

`tests_real/` queda fuera de `testpaths`. Tiene su propio `conftest.py`: solo acepta
loopback, exige el lock, siembra las fixtures, levanta `uvicorn` con un entorno armado desde
cero, sin clave general, y `next build` + `next start`. Deja filas: al terminar corresponde
otro `db reset`. ALIGN-027 parte de este `conftest.py`.
