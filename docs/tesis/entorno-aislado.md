# Entorno de base de datos aislado y reproducible (Supabase local)

| Campo | Valor |
|---|---|
| Ticket | ALIGN-016, plan `2026-10-28-v2` (M2) |
| Estado | Verificado en la máquina del equipo (macOS arm64, Docker Desktop) el 29/10/2026; pendiente de la revisión independiente de otro proveedor exigida por el ticket |
| Versión fijada de la CLI | **Supabase CLI `2.108.0`** (`npx --yes supabase@2.108.0 …`), la misma con la que E06 creó las migraciones |
| Configuración usada | [`supabase/config.toml`](../../supabase/config.toml) y las migraciones de [`supabase/migrations/`](../../supabase/migrations/) |
| Documentos relacionados | [Supabase de testing y autorización (E06)](../../SUPABASE_TESTING_CALIDAD.md), [ejecución segura del ETL](../../back/ETL/README.md) (ALIGN-025), [ADR-001](adr-001-reglas-y-capas.md) |
| Procedimiento de carga | [§8, carga V1 verificada](#8-carga-v1-verificada-align-027) (ALIGN-027) |
| Exclusiones | No toca el proyecto original ni el de testing; no modifica fixtures e06 ni migraciones |

## 1. Para qué sirve

El plan (§7.6, separación de entornos) exige una base **local** para todo cambio de
esquema, cuenta sintética, política RLS de ensayo, carga ETL o importación web
(M2–M4 y M7–M9). Este procedimiento la levanta con Docker y la Supabase CLI, y la
reconstruye desde vacío con las migraciones versionadas. Solo admite **datos
sintéticos** (`[P0250]`).

El proyecto testing compartido `iylwghgvtydpmwidojdo` **no sustituye** a esta base:
no admite `db reset` ni políticas permisivas de ensayo sin afectar la campaña E06.
El proyecto original `folyslqzqvnpolexcxjo` nunca se configura en un worktree.

## 2. Versiones fijadas

| Componente | Versión |
|---|---|
| Supabase CLI | `2.108.0` (paquete npm `supabase@2.108.0`, binario `@supabase/cli-darwin-arm64`) |
| Docker | Docker Desktop, cliente y servidor 29.1.5 |
| Node / npm | 22.23.2 / 11.21.1 (pines de E01) |
| PostgreSQL | `public.ecr.aws/supabase/postgres:17.6.1.139` (PostgreSQL 17.6), elegida por la CLI según `major_version = 17` |
| API y Auth | `postgrest:v14.13`, `gotrue:v2.191.0`, `kong:2.8.1` |
| Otros servicios | `storage-api:v1.61.3`, `realtime:v2.108.0`, `postgres-meta:v0.96.6`, `studio:2026.06.22-sha-2207d7f`, `edge-runtime:v1.74.2`, `logflare:1.45.4`, `vector:0.53.0-alpine`, `mailpit:v1.30.2`, `imgproxy:v3.8.0` (todas de `public.ecr.aws/supabase/`) |

La CLI trae fijas estas imágenes: la versión de la CLI determina todo el stack.

Reglas:

- Usar **siempre** `npx --yes supabase@2.108.0`. No usar `npx supabase` sin versión,
  `supabase@latest` ni una CLI global. La CLI avisa que existe una versión nueva; no
  se actualiza: otra versión elige otras imágenes y otra versión menor de PostgreSQL.
- Cambiar de versión es una decisión del equipo: nuevo ticket o aprobación, repetir
  este procedimiento y actualizar esta tabla.
- En los comandos se exportan `DO_NOT_TRACK=1` y `SUPABASE_TELEMETRY_DISABLED=1`
  (variables que el binario reconoce). No se ejecutó `supabase telemetry disable`
  porque cambia la configuración del usuario fuera del repositorio.

## 3. Procedimiento

Todos los comandos se ejecutan desde la **raíz del worktree** (donde está `supabase/`).
En la máquina del equipo, npm 11.21.1 está en
`/Users/jirustaroure/.t3/tools/equitas-npm-11.21.1/bin`.

### 3.1 Precondiciones

```sh
export PATH=/Users/jirustaroure/.t3/tools/equitas-npm-11.21.1/bin:$PATH
export DO_NOT_TRACK=1 SUPABASE_TELEMETRY_DISABLED=1
(
  docker info >/dev/null 2>&1 || { echo "DETENERSE: Docker no responde"; exit 1; }
  [ ! -e supabase/.temp/project-ref ] || { echo "DETENERSE: el worktree está vinculado a un proyecto remoto"; exit 1; }
  if env | grep -q -i -E 'folyslqzqvnpolexcxjo|iylwghgvtydpmwidojdo'; then
    echo "DETENERSE: hay variables con referencias a proyectos remotos (no se muestran valores)"
    exit 1
  fi
  echo "Precondiciones OK"
)
```

El bloque corre en un subshell: ante un fallo imprime un mensaje fijo, sale con
código 1 y no cierra la terminal. **Nunca imprime ni interpola valores de
variables**: la búsqueda usa `grep -q`, que solo informa si hubo coincidencia. No
reemplazarlo por `env | grep …` sin `-q`, que mostraría la línea completa, por ejemplo
una cadena de conexión con contraseña. Para saber qué variables limpiar, listar solo
sus **nombres**:

```sh
python3 -I -c 'import os, re; r = re.compile("folyslqzqvnpolexcxjo|iylwghgvtydpmwidojdo", re.I); print(" ".join(sorted(k for k, v in os.environ.items() if r.search(k) or r.search(v))) or "ninguna")'
```

1. Docker Desktop iniciado. La primera vez se descargan 13 imágenes, que ocupan
   unos 9,3 GB según `docker images`.
2. El worktree no está vinculado a ningún proyecto remoto. Nunca ejecutar
   `supabase link`, `login`, `db push`, ni opciones `--linked` o `--db-url` hacia un
   host remoto.
3. Ninguna variable del entorno nombra el original ni el testing. Si el bloque dice
   `DETENERSE`, no continuar: limpiar esas variables (`unset NOMBRE`) y repetirlo.
4. Puertos 54320–54329 libres (`supabase/config.toml`).

### 3.2 Levantar el stack

```sh
mkdir -p /tmp/equitas-local-db && chmod 700 /tmp/equitas-local-db
(umask 077; npx --yes supabase@2.108.0 start > /tmp/equitas-local-db/start.log 2>&1)
```

- La salida incluye las claves: se redirige a un archivo fuera del repositorio,
  creado con `umask 077` (modo 0600) dentro de una carpeta 0700. `mkdir -m` no cambia
  el modo de una carpeta que ya existe; por eso se usa `chmod 700`. No pegar la salida
  en issues, logs de evidencia ni conversaciones.
- **Regla para toda captura de `start` o `status`** (también los logs de evidencia
  de un ticket): crearla con `umask 077`, guardarla solo en `/tmp/equitas-local-db/`,
  copiar a la evidencia únicamente una versión depurada (claves como `<REDACTADO>`) y
  borrar la captura cruda cuando ya no haga falta. Comprobar los permisos sin mostrar
  contenido (§3.5).
- `start` ya aplica las migraciones sobre una base nueva. `imgproxy` y `pooler`
  quedan detenidos por la configuración por defecto; no se usan.
- Si la descarga falla con `error from registry: Rate exceeded` (límite de
  `public.ecr.aws`), volver a ejecutar `start` después de unos minutos: reutiliza las
  capas ya descargadas. Así ocurrió el 29/10 (§7).

### 3.3 Reconstruir la base desde vacío

```sh
npx --yes supabase@2.108.0 db reset
```

Borra la base local, la recrea y aplica **en orden** todas las migraciones de
`supabase/migrations/`; el orden lo da el timestamp del nombre de cada archivo.
La primera, `20261021220156_equitas_testing_schema.sql`, exige `public` vacío. Qué
agrega cada una está en [`SUPABASE_TESTING_CALIDAD.md`](../../SUPABASE_TESTING_CALIDAD.md).

El seed está deshabilitado (`[db.seed] enabled = false`): la base queda **sin filas** y
sin usuarios de Auth. Las cuentas y datos sintéticos los crea cada ticket (por
ejemplo, ALIGN-018 con `database/testing/case-review-*.sql`) y desaparecen con el
siguiente `db reset`. Un segundo `db reset` da el mismo resultado: esa es la prueba
de reproducibilidad.

Para ensayar solo la primera migración (23 políticas `USING(true)` que reproducen el
original, como pide ALIGN-019):

```sh
npx --yes supabase@2.108.0 db reset --version 20261021220156
```

Ese estado es transitorio: al terminar, volver a `db reset` sin `--version`.

### 3.4 Verificar

```sh
npx --yes supabase@2.108.0 migration list --local                                # una fila por archivo de supabase/migrations/
docker exec supabase_db_equitas-tp-testing psql -U postgres -d postgres -Atc \
  "select count(*) from pg_tables where schemaname='public' and not rowsecurity;" # 0
docker exec supabase_db_equitas-tp-testing psql -U postgres -d postgres -Atc \
  "select count(*) from pg_policies where schemaname='public' and qual='true';"   # 0
```

- Estos esperados no cambian al sumar migraciones. Los conteos detallados por ticket
  están en `database/testing/etl-compat-verify.sql` y `case-review-verify.sql`, con
  sus esperados en [`SUPABASE_TESTING_CALIDAD.md`](../../SUPABASE_TESTING_CALIDAD.md).
- `psql` no está instalado en la máquina; se usa el del contenedor.
- `migration list` siempre con `--local`. Con `--local`, la columna "Remote" muestra
  las versiones registradas en la base local, no en la nube.

### 3.5 Claves locales (deterministas y fuera del repositorio)

Con la misma versión de la CLI y el mismo `config.toml`, cada `start` produce **las
mismas** claves (`ANON_KEY`, `PUBLISHABLE_KEY`, `SECRET_KEY`, `SERVICE_ROLE_KEY`,
`JWT_SECRET` y las de S3). Se comprobó después de cada `db reset` y de un ciclo
`stop`/`start` (§7). Por eso no se guardan: se regeneran cuando hacen falta, en un
archivo fuera del repositorio con permisos restringidos.

```sh
mkdir -p /tmp/equitas-local-db && chmod 700 /tmp/equitas-local-db
(umask 077; npx --yes supabase@2.108.0 status -o env > /tmp/equitas-local-db/supabase-local.env)
```

Verificar los permisos sin mostrar contenido (solo modos y nombres):

```sh
ls -ld /tmp/equitas-local-db && ls -l /tmp/equitas-local-db   # esperado: drwx------ y -rw------- en cada archivo
find /tmp/equitas-local-db \( -perm -g=r -o -perm -o=r -o -perm -g=w -o -perm -o=w \) -print   # esperado: sin salida
```

Si `find` lista algo, corregirlo con `chmod -R go-rwx /tmp/equitas-local-db` antes
de seguir.

- Ruta acordada: `/tmp/equitas-local-db/supabase-local.env`. Nunca dentro de un
  worktree (tampoco en `.quality/`, `back/.env` ni `front/.env.local`). No hacer
  copias de este archivo; si un script necesita las claves, que lo lea de esta ruta.
- La CLI advierte que son claves por defecto compartidas: sirven solo para esta base
  local. Aun así se tratan como secretos: no se copian a evidencia, commits,
  documentos ni respuestas. En la evidencia figuran como `<REDACTADO>`.
- Para pruebas de aplicación y de RLS se usa la clave publicable o `anon`. La de
  servicio solo para cargas locales del ETL (`EQUITAS_TARGET_ENV=local`, ver §4) y
  siempre contra `http://127.0.0.1:54321`.
- Las escrituras de revisión y de lote usan un JWT propio de los roles de servidor
  de ALIGN-018, no la clave de servicio. Se emite con
  `database/testing/case_review_local.py mint-jwt` en esta misma carpeta y con el mismo
  trato. Las contraseñas de las cuentas sintéticas tampoco salen de ella
  (`case-review-credentials.psv`).

Servicios locales: API `http://127.0.0.1:54321` (REST `/rest/v1`, Auth `/auth/v1`),
base `127.0.0.1:54322`, Studio `http://127.0.0.1:54323`, Mailpit
`http://127.0.0.1:54324`, analytics `54327`.

### 3.6 Detener y revertir

```sh
npx --yes supabase@2.108.0 stop              # detiene los contenedores y conserva los volúmenes
npx --yes supabase@2.108.0 stop --no-backup  # reversión del ticket: además borra los volúmenes locales
```

Las imágenes descargadas quedan en Docker; borrarlas no forma parte de la reversión.

## 4. Allowlist de destinos

Contrato común para la guardia del ETL (ALIGN-025), los runners de campañas
(ALIGN-022) y las pruebas reales (ALIGN-017/018/019/027):

| Destino | Quién puede usarlo | Condición |
|---|---|---|
| `localhost`, `127.0.0.1`, `::1` (este stack) | ETL con `--execute`, `back/tests_real`, campañas y runners de los tickets del plan | **Permitido**, solo con datos sintéticos |
| Testing `iylwghgvtydpmwidojdo` | Solo la campaña existente de 12 casos (`quality/supabase_integration.py`, que exige exactamente esa URL) | **Solo con aprobación** expresa en `APPROVAL.json` para esa ejecución. Nunca `db reset`, migraciones, políticas de ensayo ni datos reales. No es destino del ETL ni de campañas nuevas |
| Original `folyslqzqvnpolexcxjo` | Ningún agente ni prueba | **Nunca se configura**. Las guardias lo rechazan aunque aparezca en una variable auxiliar |
| Cualquier otro host | — | Rechazado |

Coherencia con lo implementado (comprobado, §7):

- La guardia del ETL ([`back/ETL/config.py`](../../back/ETL/config.py)) acepta solo
  hosts loopback exactos (`ALLOWED_TARGET_HOSTS`), exige `EQUITAS_TARGET_ENV=local` o
  `testing` y rechaza el original (`TARGET_ORIGINAL_FORBIDDEN`). `testing` es solo una
  etiqueta en loopback: la guardia **no** habilita el proyecto testing remoto
  (`TARGET_HOST_FORBIDDEN`), más estricta que esta tabla.
- Para cargar en este stack: `EQUITAS_TARGET_ENV=local`,
  `SUPABASE_URL=http://127.0.0.1:54321`, la clave de servicio y la clave `anon` leídas de
  `/tmp/equitas-local-db/supabase-local.env`, el JWT de `equitas_import_server` y el actor
  de `etl-import-actor.sql`, con `--execute --cut-off <fecha>` (ver el
  [README del ETL](../../back/ETL/README.md), ALIGN-026).
- Un runner nuevo valida el destino **antes** de la primera solicitud y con la misma
  regla: host exacto de la lista, sin credenciales en la URL, y rechazo del original en
  cualquier valor de configuración.
  `database/testing/case_review_local.py` (ALIGN-018) la aplica y rechaza cualquier
  valor de configuración que nombre un proyecto remoto.

## 5. Uso compartido entre tickets

- Hay **un solo stack por máquina** para este repositorio: `project_id =
  "equitas-tp-testing"` da nombre a los contenedores (`supabase_*_equitas-tp-testing`)
  y los puertos son fijos. Los tickets que lo usan (carril B: ALIGN-017, 018 y 019)
  trabajan **de a uno**.
- `db reset` aplica las migraciones del worktree desde el que se ejecuta. El estado
  de la base es el del último `db reset`: cada ticket ejecuta `db reset` desde su
  propio worktree antes de probar, y al terminar lo vuelve a ejecutar.
- Si el stack ya está levantado, no hace falta detenerlo: basta `db reset` desde el
  worktree que corresponde.
- Con `enable_signup = false` no hay registro público (Auth responde 422). Mailpit
  captura los correos de Auth y no los envía afuera.

## 6. Riesgos y límites

- **Exposición en la red local.** La CLI publica los puertos en `0.0.0.0`: otros
  equipos de la misma red pueden alcanzar la API, la base y Studio (sin autenticación)
  con claves por defecto conocidas. Por eso esta base solo contiene datos sintéticos.
  Detener el stack (`stop`) cuando no se usa o en redes que no son de confianza.
- PostgreSQL 17.6 local frente a 17.11 en testing. El gateway local (Kong) y la
  configuración de Auth tampoco son idénticos a los de la nube. La base sirve para RLS,
  grants, migraciones y escrituras. No reemplaza la campaña e06 ni certifica una
  migración del original.
- No hay Security/Performance Advisors locales.
- Verificado solo en macOS arm64 con Docker Desktop.
- No se pudo confirmar desde la CLI que las variables de telemetría la desactiven:
  `telemetry status` informa la preferencia del usuario.

## 7. Ejecución verificada (29–30/10/2026)

La evidencia depurada está en `execution/evidence/ALIGN-016/`, dentro del paquete del
plan (fuera de git). Hay un log por comando y las claves figuran como `<REDACTADO>`.

| Paso | Resultado |
|---|---|
| `docker version` | 29.1.5 / 29.1.5, Docker Desktop aarch64 |
| `npx --yes supabase@2.108.0 --version` | `2.108.0` |
| `start`, primer intento | Interrumpido por una caída de internet; `postgrest` había recibido `Rate exceeded` de `public.ecr.aws` |
| `start`, segundo intento | exit 0; mismo registro, sin errores; aplica las dos migraciones |
| `db reset` (1.º y 2.º) | exit 0; verificaciones idénticas: 23 tablas, 23 con RLS, 23 políticas `member_read_*`, 0 `USING(true)`, 0 políticas o grants de escritura para `anon`/`authenticated`, 14 índices, 2 migraciones registradas, 0 filas, 0 usuarios de Auth |
| `db reset --version 20261021220156` | exit 0; 23 políticas `USING(true)`, 1 migración; luego `db reset` final restaura el estado completo |
| Claves tras cada `db reset` y tras `stop`/`start` | Iguales a la primera captura (comparación sin registrar valores) |
| API local con la clave `anon` | Auth 200; `GET` de `tenant`, `debtor`, `debt`, `person` y `role` devuelve `[]`; `POST` rechazado con `42501`; signup 422 |
| Guardia del ETL frente a la allowlist | 6/6: loopback aceptado; testing remoto `TARGET_HOST_FORBIDDEN`; original `TARGET_ORIGINAL_FORBIDDEN`; sin `EQUITAS_TARGET_ENV`, `TARGET_ENV_INVALID` |
| Revisión independiente, ciclo 1 (30/10) | La precondición del §3.1, probada literal con una variable ficticia, sale con 1 y no muestra el valor. Se borraron las capturas crudas con claves; queda solo `/tmp/equitas-local-db/supabase-local.env` (carpeta 0700, archivo 0600, verificado sin mostrar contenido) |

## 8. Carga V1 verificada (ALIGN-027)

Primer ensayo del ETL contra una base reproducible: comprueba que el archivo aprobado es el que produce los objetos y
perfiles que se publican. Solo este stack, solo datos sintéticos, comandos desde la raíz del worktree salvo que se
indique otra cosa.

### 8.1 Preparar la base y cargar un lote a mano

```sh
npx --yes supabase@2.108.0 db reset --local
docker exec -i supabase_db_equitas-tp-testing psql -q -U postgres -d postgres -v ON_ERROR_STOP=1 < database/testing/etl-compat-catalogs.sql
docker exec -i supabase_db_equitas-tp-testing psql -q -At -U postgres -d postgres -v ON_ERROR_STOP=1 < database/testing/etl-import-actor.sql   # imprime el id del actor
back/.venv/bin/python -I database/testing/case_review_local.py mint-jwt --role equitas_import_server --hours 6
```

Después, desde `back/`, con el entorno que indica el [README del ETL](../../back/ETL/README.md) (`EQUITAS_TARGET_ENV=local`,
`SUPABASE_URL`, las claves leídas de `/tmp/equitas-local-db/supabase-local.env` sin imprimirlas, el JWT y el actor):

```sh
.venv/bin/python -m ETL.validate_source --folder <lote> --contract ../contracts/source-contract.v1.json --cut-off 2026-09-30 --output <dir>
.venv/bin/python -m ETL.run_etl --folder <lote> --execute --cut-off 2026-09-30 [--mapping perfil.json]
```

`validate_source` no necesita credenciales ni base. Sale con 0 si el lote queda `VALIDADO` y con 1 si queda `BLOQUEADO`.
Justo después de `db reset` Auth puede responder 200 y la Data API `PGRST002` (503): esperar a que
`GET /rest/v1/debtor?select=id&limit=1` dé 200 antes de cargar.

### 8.2 Correr la campaña

Fuera de `testpaths`: `python -m pytest` aislado no la recoge y sigue sin red ni secretos. Se corre con un comando
explícito, con el turno de la base tomado y recién después de `db reset --local`. La prueba carga los catálogos y el
actor, y emite el JWT:

```sh
cd back && .venv/bin/python -m pytest tests_real/test_etl_v1_load.py -q
```

Con `EQUITAS_V1_EVIDENCE=<ruta>` escribe además la evidencia JSON: hash del dataset, corte, versión de contrato, SHA,
entorno y un resumen por paso, sin filas ni claves. Exige la base vacía y al terminar vacía las tablas, porque sus semillas
chocan con las de `test_imports_api.py` (ALIGN-052), que corre después en la misma sesión. La reversión es `db reset`.
`tests_real/conftest.py` no fuerza variables ficticias y detiene la sesión si el destino no es loopback, si un valor de
configuración nombra un proyecto remoto o si falta el turno.

### 8.3 Qué comprueba

| Paso | Resultado esperado |
|---|---|
| `sintetico-v1` completo sobre la base vacía | Siempre `BLOQUEADO`, a propósito: salida 1, `BATCH_BLOCKED`, 0 filas de cartera, un evento `FALLIDO` con los hashes y los conteos de `expected.json` |
| Validar el lote derivado y cargar **esos mismos archivos** | `VALIDADO` → `PUBLICADO`. Todas las filas de cartera se escribieron después de confirmar `VALIDADO` y antes de `PUBLICADO` (por `xmin`) |
| Conciliar con `expected.json` | Conteos y montos por tipo de objeto idénticos al oráculo y por tributo idénticos al archivo; aceptadas + rechazadas = leídas; perfil = Σ deudas por objeto (±0,01); `counts.estados_al_corte` = estados de `debt` |
| Recargar el mismo lote | 0 insertados, 0 actualizados, y ninguna fila reescrita en la base (`xmin` igual), conteos y montos sin cambio |
| Reimportar el lote completo con una obligación modificada | Cambian exactamente esa fila de `debt` y el perfil de su objeto, también su `profile_generated_at`. Nada más |
| Archivo rechazado: bloqueado, sin una columna, ilegible, o parcial | Salida 1, ninguna fila reescrita, un evento `FALLIDO` sin antecedente |
| Falla durante la carga, o rechazo de `PUBLICADO` después de escribir | `VALIDADO` → `FALLIDO` con antecedente y el código original. Ningún lote queda sin cerrar |
| Corrección de un centavo en un importe de 100 billones o más | Se actualiza: exactamente la obligación y el perfil. La recarga da 0 y 0 |

**El mismo archivo validado.** `sintetico-v1` completo nunca publica, por diseño: trae más cuarentena que el umbral del
contrato y detalle sin cabecera. El lote que se carga es su derivado `VALIDADO` más grande que admite el umbral: los 31
objetos aceptados por el oráculo más un caso en cuarentena (`derive_lot`, `back/tests/oracle_lots.py`, que no importa el
ETL). Sus líneas son las de la fixture, sin alterar. Lo que se exige es que el SHA-256 de `cabecera` y `detalle` calculado
al validar sea el que quede en `import_batch.file_hashes` en `VALIDADO` y en `PUBLICADO`.

### 8.4 Reglas de la carga que esto fija

- **Una escritura sin cambios no se hace.** Si la fila ya tiene esos valores no se envía el `UPDATE`. El evento `PUBLICADO`
  guarda `filas_insertadas`, `filas_actualizadas`, `filas_sin_cambios` y el detalle por tabla en `escrituras`.
- **`profile_generated_at` no distingue un perfil de otro.** Si una recarga obtiene los mismos valores, se conserva: sigue
  siendo el momento del cálculo que los produjo. Cambia solo cuando cambia el perfil.
- **Una persona se escribe una vez por carga**, con los datos de su última fila, y su dirección con la última fila que tenga
  domicilio. Sin esto, una persona con datos distintos en dos objetos iría y volvería en cada recarga.
- **Una localidad sin código postal reutiliza la existente** y no le borra el suyo.
- **V1 solo admite el lote completo.** Antes de registrar `VALIDADO` se lee lo publicado del municipio. Si el archivo ya no
  trae un objeto, una obligación de un objeto aceptado o una relación persona–objeto, es un delta o una baja: `FALLIDO` sin
  antecedente, `PARTIAL_LOAD_REJECTED`, y `counts.faltantes` dice cuántos. Un objeto en cuarentena sí viene en el archivo:
  conserva su estado previo y no se compara. `--limit-objects` y `--priority-tipo-ingreso` se rechazan antes de leer.

### 8.5 Límites

R05, R13 y R28 quedan **parciales**, no cerrados:

- **ALIGN-031:** política de bajas y delta. También la de contactos y direcciones que dejan de venir: hoy un contacto
  ausente queda en `debtor_contact` como estaba, sin desactivarse, y no bloquea el lote. Paginación de
  `fetch_existing_debts_by_key` y `recompute_debtor_profiles`.
- **ALIGN-032:** transacción, recuperación, concurrencia y clave de idempotencia por lote. Hoy una falla a mitad de carga
  no revierte lo ya escrito, y cada ejecución agrega su propia cadena de eventos, también una recarga sin cambios. Si
  `PUBLICADO` tiene resultado incierto (respuesta perdida, 5xx, 200 ilegible), la CLI imprime `PUBLISH_OUTCOME_UNKNOWN`, sale
  con 1 y `VALIDADO` queda sin desenlace. Lo mismo si la base rechaza también el `FALLIDO`, por ejemplo con el actor revocado
  durante la carga (`IMPORT_BATCH_FAILURE_NOT_RECORDED`). Un proceso muerto sin aviso tampoco cierra el lote.
- **Exactitud de importes:** la carga compara los importes de `debt` y del perfil como texto, así que es exacta en todo el
  rango que admite el validador (hasta 9.999.999.999.999.999,99; más allá, `IMPORTE_FUERA_DE_RANGO`). Quien lea esas columnas
  como número no lo es: los mapeadores del frontend y la Data API sin `::text` pierden centavos desde unos 100 billones. No es
  un importe municipal plausible y no se certifica ese rango en pantalla; queda como límite conocido de la lectura, sin
  ticket asignado.
- `person.external_id` es único global: el municipio B exige `--mapping` y una base recién reconstruida, y la CLI usa el
  tenant 1 fijo. Un primer lote sobre una base vacía no tiene contra qué compararse: su completitud no se puede comprobar.
