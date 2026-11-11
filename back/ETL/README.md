# Ejecución segura y publicación atómica del ETL — ALIGN-025/026/027/031/032

ALIGN-025 aplica la separación de entornos del plan EQUITAS 2026-10-28-v2, §7.6, y reduce los datos
expuestos por el ejecutor (objetivos 1 y 7 de la tesis; minimización según
`SOURCES/TESIS-SINTESIS.md`, §6, referencias `[P0235]`–`[P0240]`). ALIGN-026 hace que el lote cargado signifique
lo que dice el origen a una fecha de corte declarada (objetivos 1 y 2; `[P0140]`, `[P0228]`). El significado
de cada campo está en [`contrato-dominio-v1.md` §14](../../docs/tesis/contrato-dominio-v1.md) y el del
archivo, en [`contrato-origen-v1.md` §9](../../docs/tesis/contrato-origen-v1.md).

## Revisar un lote sin credenciales

Desde `back/`, con el entorno de dependencias fijadas preparado:

```sh
# Solo conteos de los archivos. No valida ni autoriza cargar.
.venv/bin/python -m ETL.run_etl --folder fixture_sintetica

# Valida contra el contrato y muestra el resultado del lote. Sale con 1 si queda BLOQUEADO.
.venv/bin/python -m ETL.run_etl --folder fixture_sintetica --cut-off 2026-09-30 --mapping perfil.json
```

`--folder` es una carpeta de `data/input/` o una ruta absoluta; contiene `cabecera` y `detalle` con la extensión
que declara el perfil (`.tsv` o `.csv`). No carga `.env`, no exige URL ni clave y no crea un cliente Supabase.
Importar `ETL.config` o `ETL.run_etl` tampoco carga `.env` ni crea el cliente. El resumen del ejecutor no incluye
ejemplos de personas, objetos o deudas. `--limit-objects` y `--priority-tipo-ingreso` solo sirven para la vista
de conteos: con `--cut-off` o `--execute` se rechazan (`PARTIAL_LOAD_REJECTED`), porque un subconjunto no es el
lote validado y sus hashes y conteos no lo describirían.

## Ejecutar una carga autorizada en la base local

Precondición: `db reset`, `etl-compat-catalogs.sql` y `etl-import-actor.sql`
(ver [`SUPABASE_TESTING_CALIDAD.md`](../../SUPABASE_TESTING_CALIDAD.md)).

```sh
export EQUITAS_TARGET_ENV=local
export SUPABASE_URL=http://127.0.0.1:54321
# Desde /tmp/equitas-local-db/supabase-local.env, sin imprimirlas: clave de servicio (lectura de catálogos) y clave anon (apikey).
export SUPABASE_SERVICE_ROLE_KEY=...   SUPABASE_ANON_KEY=...
# JWT de equitas_import_server (database/testing/case_review_local.py mint-jwt) y el id que imprime etl-import-actor.sql.
export EQUITAS_IMPORT_SERVER_JWT=...   EQUITAS_IMPORT_ACTOR_USER=...
.venv/bin/python -m ETL.run_etl --folder <lote> --execute --cut-off 2026-09-30 [--mapping perfil.json]
```

Sin `--mapping` solo se admite una carpeta con `manifest.json` de fixture sintética: sin manifiesto, `JSON_NO_LEIBLE`;
con otro manifiesto, `MAPEO_REQUERIDO`.
Con ese manifiesto o con un perfil, `--cut-off` debe coincidir con la fecha que declaran.

`--execute` valida el destino, el corte y las credenciales **antes de leer el lote**. Después:

1. Calcula el SHA-256 de los archivos, del mapeo y del contrato, lee y valida con `ETL.validate_source`.
2. **Lote bloqueado o ilegible:** registra `FALLIDO` en `import_batch`, no escribe ninguna fila de cartera y sale con 1
   (`BATCH_BLOCKED` o el código de la estructura). Un lote de `sintetico-v1` completo termina siempre así, a propósito.
3. **Staging y validación:** `stage_import_batch` recibe exclusivamente filas normalizadas aceptadas. En la base
   calcula ausentes, guarda versiones y una revisión congelada; agrega `RECIBIDO → VALIDADO` sin escribir cartera.
   `rechazar` ante un objeto, obligación o relación faltante termina en `RECIBIDO → FALLIDO`, con `counts.faltantes`.
4. **Publicación:** la CLI llama a `publish_import_batch`. Bajo el bloqueo del tenant compara identidad, revisión,
   checksum del staging y todas las versiones. Si cambiaron, registra `REQUIERE_NUEVO_PREVIEW`, sin publicar.
   Si coinciden, una sola transacción escribe personas/domicilios/contactos, objetos/relaciones/deudas, bajas explícitas,
   `recompute_debtor_profiles`, detalles de perfiles, el recibo durable y `CONFIRMADO → PUBLICADO`.
   Ninguna conexión puede ver deudas nuevas sin sus perfiles o sin `PUBLICADO`. No se afirma atomicidad entre llamadas REST.
5. **Fallo:** la publicación completa revierte. Después, `settle_import_batch` espera el mismo bloqueo, consulta el resultado
   y registra `FALLIDO` en otra transacción, solo si no se publicó. Se eliminan staging y el documento normalizado.
   Si tampoco se puede consultar/cerrar el resultado, se conserva el error original y se informa `PUBLISH_OUTCOME_UNKNOWN`.
6. **Doble confirmación o respuesta perdida después del commit:** la repetición devuelve el recibo persistido. No agrega
   eventos, no reescribe filas ni recalcula perfiles. Conteos, montos y reclasificaciones son los originales, incluso si
   hubo otra importación después. En particular, **los conteos impresos no representan escrituras nuevas del reintento**.

Los importes se comparan en PostgreSQL con los tipos `numeric` de las tablas, sin una conversión intermedia a `float`.
Los helpers antiguos de lectura siguen paginando y leyendo importes como texto; `--execute` publica exclusivamente por la
nueva función SQL, sin una alternativa de escrituras REST por fila.

### Presupuesto de la publicación y volumen municipal

La migración fija `statement_timeout=60s` y `lock_timeout=8s` solo para
`equitas_import_server`, y notifica a PostgREST para recargar la configuración.
El rol también lo usan la API 052 (cliente de 10 s) y `record_import_batch` legacy
(15 s con reintentos). Una vez adquirida la conexión, una espera de lock se corta
a los 8 s, antes de esos clientes. La adquisición de conexión al pool puede sumar
hasta 10 s previos: un 503 de la API 052 no demuestra que no se registró el evento.
Se debe reintentar con la **misma `Idempotency-Key`**, que recupera el recibo sin duplicar.
El cliente de
publicación mantiene `RPC_TIMEOUT=120s` para transporte y recuperación; no extiende
el corte de 60 s del gateway local ni el máximo de 60 s de la API de Supabase alojado.
No se amplían los límites de `authenticator`, de los lectores ni del rol de revisión.
Estos son límites por llamada; no se desactiva el timeout ni se divide la publicación
en transacciones parciales. `lock_timeout` rige por adquisición; cada espera también
consume el presupuesto de la sentencia. Una respuesta perdida o un corte del gateway
no prueba que no hubo commit: la recuperación consulta el recibo durable con la misma
identidad, según el procedimiento de abajo.

Las búsquedas de filas por claves no nulas usan igualdad e índices. Las claves nulas
se buscan con `IS NULL`, y la comparación de valores sigue usando `IS NOT DISTINCT
FROM` para evitar reescrituras. Los triggers resuelven las claves de objetos afectados
antes de leer `debtor`; no recorren toda esa tabla por cada obligación. Se conservan
los mismos bloqueos, versiones, checksum canónico, cuarentena y transacción única.

El ensayo de escala utiliza 2924 objetos aceptados y 56273 obligaciones del generador
versionado: primera publicación, repetición de los mismos archivos y reentrega con
otros bytes pero idénticos valores. Exige carga por la CLI/Data API real y compara
las huellas de todas las tablas de cartera, incluyendo `xmin`, en las repeticiones.
No garantiza ese tiempo para cualquier hardware o para el máximo contractual de filas.
En la revisión local, con carga baja, publicar tomó unos 24 s de servidor; la
reentrega tomó 11,5 s de stage y 14,4 s de publicación. No son un SLA ni permiten
subir el límite de la API por encima de 60 s si el volumen o la carga lo superan.

El bloqueo global de localidades y el del tenant siguen serializando escrituras.
Otra importación que espera un lock se rechaza a los 8 s; el guardado de una revisión
del mismo municipio también puede fallar a los 8 s mientras se publica. Debe mostrarse
el fallo y reintentarse después, conservando la identidad de la operación. Las esperas
ocupan conexiones del pool de PostgREST hasta su cancelación: acotarlas evita retenerlas
55 s, pero no garantiza disponibilidad con cualquier concurrencia. La regresión real
ejercita la API 052 bloqueada (503 sin evento tardío), doce escrituras en espera y una
lectura ajena. No elimina los límites del pool ni implementa el flujo web de 057.

Si stage aborta por espera de lock, deadlock o cancelación de sentencia, devuelve
`IMPORT_RETRY_REQUIRED`: no significa que el archivo sea inválido. Se revierte el
stage y se reintenta la misma entrada después de resolver la contención o carga;
no se repite dentro de la transacción ni se aumenta el presupuesto automáticamente.
Dos confirmaciones concurrentes a escala publican una sola vez, pero el segundo
llamador puede agotar su espera antes de que termine la primera y recibir
`IMPORT_PUBLICATION_FAILED` con `PUBLISH_OUTCOME_UNKNOWN`. Tras terminar la primera,
repetir la misma identidad recupera su recibo, conteos y montos originales. Si la
publicación revirtió y el cierre posterior registró `FALLIDO`, se necesita
`--revalidate <revision-anterior>`; un resultado desconocido nunca se declara éxito.

La configuración por rol y su aplicación en REST están descritas en
[Supabase: Timeouts](https://supabase.com/docs/guides/database/postgres/timeouts) y
[PostgREST: Transactions](https://docs.postgrest.org/en/v12/references/transactions.html).

### Identidad, revisión y recuperación

La clave SHA-256 incluye hashes de los archivos, hash **canónico del mapeo efectivo**, versión y hash del contrato,
parámetros efectivos (corte, política de ausentes, límites de rechazos, versión de reglas) y tenant. El mapeo normaliza
alias de identidad y defaults; ni su etiqueta `version`, ni el orden de claves JSON cambian su identidad. Las secuencias
de transformaciones conservan orden. Existe `UNIQUE (tenant, idempotency_key)` en `import_publication`.

El identificador estable es `batch_id` (el primer evento de la cadena); `published_event_id` identifica el evento final.
La revisión liga identidad, filas normalizadas, versiones y generación. Confirmar nunca vuelve a enviar filas o mapeo.
Mutar el mapeo efectivo después de validar invalida la confirmación. Reenviar filas distintas bajo la misma identidad
produce `IMPORT_REVISION_CONFLICT`; no reemplaza el snapshot silenciosamente.

La CLI imprime `Referencia del lote: <id> revision=<sha256>` antes de publicar. Ante `FALLIDO`, `DESCARTADO` o
`REQUIERE_NUEVO_PREVIEW`, después de resolver la causa se puede revalidar explícitamente la misma entrada:

```sh
.venv/bin/python -m ETL.run_etl --folder <lote> --execute --cut-off 2026-09-30 \
  --ausentes conservar --revalidate <revision-anterior>
```

Esto relee y valida los archivos, conserva identidad/lote y genera una revisión con versiones nuevas. No modifica una
publicación terminada: `PUBLICADO` siempre devuelve su recibo original. Para aplicar nuevamente valores de una entrega
anterior después de otra corrección se necesita una **nueva entrega de origen**. Repetir el archivo original no deshace la
corrección. No hay un nonce o bandera que evada la idempotencia.

Los consumidores internos usan `ETL.publication.stage_batch`, `publish_batch` y `settle_batch`; la CLI usa esas mismas
funciones. El servicio debe conservar la referencia recibida. Si pierde también su registro de referencia, un administrador
local puede consultar `import_publication` por tenant e identidad; no debe editar staging, estados o revisiones a mano.
Los borrados, cambios y recreaciones de deudas, objetos, relaciones, personas, contactos, domicilios y perfiles invalidan
versiones automáticamente. La validación incluye todo el tenant para comparar ausentes. Es una invalidación conservadora:
un lote sobre otro objeto del mismo tenant también puede exigir revalidación. Personas y localidades compartidas usan
bloqueos adicionales ordenados; actualmente las publicaciones se serializan también por localidades. Una persona vinculada
a otro tenant se rechaza (`SHARED_PERSON_OTHER_TENANT`) antes de cualquier escritura de cartera.

### Retención y permisos

Staging y el documento con filas se vacían al pasar a `PUBLICADO`, `FALLIDO` o `DESCARTADO`. La expiración es de 24 horas
por revisión. La base rechaza confirmar una revisión vencida y el job `equitas-import-staging-ttl` de `pg_cron` purga
abandonados cada minuto, incluso sin nuevas cargas (latencia del scheduler hasta un minuto). El job tiene timeout de 45 s.
`purge_import_staging()` usa siempre el reloj de la base; no recibe un reloj elegido por el cliente. El helper con reloj
controlado es privado y solo se usa administrativamente en los ensayos locales.

`import_row_staging`, `import_publication` y las tablas de versiones tienen RLS y ACL cerradas. `anon`, `authenticated`,
`service_role` y `equitas_review_server` no pueden publicar ni escribir staging. Solo `equitas_import_server` ejecuta
staging/publicación/cierre, con actor activo y rol `importador` o `importador_sistema` del tenant indicado. El definidor es
`NOLOGIN`, no asumible por `authenticator`, con `search_path=''` y permisos concretos. El mantenimiento sin parámetros de
reloj también está concedido a `postgres` para el job local; no le concede publicar ni editar staging.

Se conserva el historial append-only de `import_batch`. Los eventos atómicos llevan `counts.publicacion_atomica=1`;
las referencias de raíz/cabeza se validan inmediatamente por existencia y tenant, sin interceptar el rechazo histórico
`APPEND_ONLY` de `TRUNCATE` con una FK entrante. El historial tampoco admite update ni delete.
La función legacy no puede crear esa marca ni prolongar una cadena atómica. El selector del corte vigente conserva el
último `PUBLICADO` durante staging o rollback de 032, manteniendo la protección anterior para cargas legacy parciales.
Las vistas y los CSV leen exclusivamente la marca JSON numérica mediante la DAL
del municipio y aplican la misma regla. Antes de la primera publicación atómica
siguen declarando `NO_INTEGRADO`, con fecha de cálculo separada; una carga legacy
que pudo escribir parcialmente sigue dejando el corte no disponible.
No se modifica la auditoría de accesos ni se implementa ALIGN-057.

### Política de ausentes

Antes de registrar `VALIDADO`, sin escribir cartera, se compara lo publicado con el archivo. Lo que dejó de venir se informa
siempre: en la salida (`Ausentes del archivo`) y en `counts.ausentes` de `VALIDADO` y `PUBLICADO`, solo con conteos. Una
relación o un contacto ya inactivos no cuentan como ausentes.

| `--ausentes` | Objeto ausente | Obligación ausente | Relación ausente | Contacto ausente |
|---|---|---|---|---|
| `rechazar` (por defecto) | `FALLIDO`, sin escribir | `FALLIDO`, sin escribir | `FALLIDO`, sin escribir | Se informa, sigue activo y contando |
| `conservar` (delta) | No se toca | Se conserva y cuenta | Sigue activa y contando | Sigue activo y contando |
| `dar-de-baja` (delta con bajas) | No se toca | Se conserva y cuenta | `active=false`, también su detalle de perfil | `active=false` |

- **Nada se desactiva sin pedirlo** y nada se borra. Lo dado de baja queda en `counts.bajas_relaciones` y
  `counts.bajas_contactos`. Si vuelve a venir en una nueva entrega, se reactiva. Las bajas solo alcanzan a objetos aceptados de este archivo.
- **Una obligación ausente nunca se da de baja:** el archivo no dice que se pagó y `debt` no tiene baja. Sigue sumando en el
  perfil. Un municipio que entrega solo deudas vivas puede recargar con `conservar`, pero el total de ese objeto incluye lo que
  dejó de venir, y `counts.ausentes.obligaciones` dice cuánto. Es un límite declarado: darlas de baja exige un cambio de esquema
  y de lecturas.
- **Conservar una obligación no congela su estado temporal.** En un objeto aceptado, una pendiente vence solo si su fecha
  es anterior al corte; al retroceder el corte puede volver a vigente. Los demás estados, los desconocidos y los nulos se
  conservan; sin fecha no se infiere un cambio. La RPC devuelve `deudas_reclasificadas`, incluido en
  `counts.escrituras.debt.actualizadas` y `counts.filas_actualizadas`. `counts.deudas_actualizadas` sigue contando solo
  las filas recibidas en el archivo. Repetir el mismo corte no vuelve a escribirlas. El estado y el perfil se actualizan
  en la misma transacción que el resto de la carga y `PUBLICADO`. Repetir devuelve el conteo original durable; no lo sustituye por cero.
- **Un contacto se compara por persona**, porque es de la persona y no del objeto: si lo trae en cualquiera de sus filas
  aceptadas, sigue viniendo. No se compara sin la columna de ese tipo en el archivo, ni para una persona con alguna cabecera no
  aceptada: en esos casos no hubo observación.
- **Un objeto en cuarentena** viene en el archivo: conserva su estado previo y no se compara.
- **Un perfil ajeno no se recalcula.** Si una persona está en un objeto del archivo y en otro ausente, y cambian sus contactos,
  `available_contact_count` del objeto ausente se actualiza cuando ese objeto vuelve a venir.

En el perfil, una ausencia queda nula y no en cero: sin vencidas observadas y con estados faltantes no hay importe
vencido, y `debt_state_not_observed_count` declara cuántas obligaciones no tienen estado. Ver el
[contrato de dominio §14](../../docs/tesis/contrato-dominio-v1.md). `etl_semantic_local.py` lo verifica contra la base.

Los objetos en cuarentena no se escriben: conservan el estado previo que tuvieran. Su cantidad está en `import_batch.counts`. El recibo interno `object_cutoffs` conserva el último corte aplicado a cada
objeto: los ausentes y cuarentenados no avanzan aunque cambie el corte global (O4 de 031). En objetos anteriores a 032,
un corte no reconstruible se declara nulo, nunca se inventa a partir del global.

**Límite de 054:** consumir revisión/versiones y `object_cutoffs`, distinguir objetos recalculados de conservados y construir
su preview sin llamar a `recompute_debtor_profiles`, que también escribe `debt.status`. 032 no implementa pantallas, preview
UI ni confirmación web de 054/056. El cliente no debe atribuir al corte global un recálculo de los objetos conservados.

Los eventos de `import_batch` usan **solo** `EQUITAS_IMPORT_SERVER_JWT` y la clave `anon` como `apikey`, nunca la clave
general, que no tiene permiso sobre la función. La cartera la escribe el definidor de publicación dentro de la transacción; la clave de servicio se usa solo para leer catálogos antes de staging.
La configuración se lee del entorno y, solo al ejecutar, de `back/.env` (sin reemplazar variables ya definidas).
`SUPABASE_KEY` sigue disponible como alternativa a `SUPABASE_SERVICE_ROLE_KEY`. No registrar ni versionar esas claves.

Condiciones obligatorias:

- `EQUITAS_TARGET_ENV` debe ser exactamente `local` o `testing`.
- La URL debe usar HTTP/HTTPS, con host exacto `localhost`, `127.0.0.1` o `::1`.
  Se admite puerto válido y una barra final. Se rechazan credenciales en la URL,
  rutas, query, fragmentos, espacios internos y hosts parecidos o alternativos.
- La allowlist es fija. La lectura acotada de §7.6 permite `testing` únicamente
  como etiqueta de un entorno de pruebas en loopback; no habilita proyectos
  remotos. El testing compartido `iylwghgvtydpmwidojdo` queda fuera de la lista.
- El original `folyslqzqvnpolexcxjo` se rechaza siempre. Se comprueban la URL y
  todos los valores de configuración con prefijo `SUPABASE_` o `EQUITAS_`, incluidas
  referencias auxiliares. Se normalizan mayúsculas, Unicode, espacios/separadores
  y escapes URL anidados. Una referencia alternativa o una variable que pretenda
  permitir el original no constituye una excepción.

El objeto compartido `config.supabase` conserva su interfaz perezosa: el primer
acceso crea el cliente y cada acceso revalida el destino antes de reutilizarlo.
Esto también alcanza a quienes importan ese cliente, incluido el servicio de
scoring; deben configurar el mismo destino local permitido. No se cambian las
consultas ni las reglas del servicio.

## Diagnósticos y errores

Los rechazos y errores del ejecutor identifican `fila`, `clave_hash` y `codigo`.
Por ejemplo: `fila=3 clave_hash=<24 hexadecimales> codigo=DETAIL_ACCOUNT_MISSING`.
No contienen filas, payloads, claves de negocio en claro ni mensajes del proveedor.
El comando termina con código 1 ante un error y no imprime su traceback original.

Las llamadas atómicas informan `fila=0`: son operaciones de lote y no exponen la fila SQL que falló. Los helpers de diagnóstico
pueden conservar la línea física de una cabecera. `fila=0` también indica configuración, lote,
perfil agregado o una llamada aislada al loader sin contexto de fila. La clave del contexto se resume con BLAKE2b de
96 bits y una clave aleatoria por proceso: permite correlación durante la
ejecución, sin conservar un hash estable entre ejecuciones. Sin contexto se usa
el hash del valor ausente. No es un identificador persistente ni una garantía
de anonimización de archivos de origen.

Códigos principales: `TARGET_ORIGINAL_FORBIDDEN`, `TARGET_ENV_INVALID`,
`TARGET_URL_INVALID`, `TARGET_HOST_FORBIDDEN`, `SUPABASE_KEY_MISSING`,
`CUT_OFF_REQUIRED`, `PARTIAL_LOAD_REJECTED`, `ABSENT_POLICY_INVALID`, `PROFILE_RECOMPUTE_RESPONSE_INVALID`, `IMPORT_CREDENTIAL_MISSING`, `IMPORT_ACTOR_INVALID`,
`IMPORT_REVISION_CONFLICT`, `IMPORT_REVALIDATION_REQUIRED`, `REQUIERE_NUEVO_PREVIEW`, `IMPORT_PUBLICATION_FAILED`,
`SHARED_PERSON_OTHER_TENANT`, `BATCH_BLOCKED`, `SOURCE_CHANGED_DURING_READ`, `CATALOG_KEY_MISSING`, `IMPORT_BATCH_REJECTED`, `PUBLISH_OUTCOME_UNKNOWN`,
`SUPABASE_RETRY`, `SUPABASE_RETRY_EXHAUSTED`, `SUPABASE_OPERATION_FAILED` y `ETL_FAILED`, además de los códigos
del contrato de origen (`CORTE_INVALIDO`, `MAPEO_REQUERIDO`, `COLUMNA_OBLIGATORIA_AUSENTE`…) y los estables de
`record_import_batch` (`ROLE_NOT_ALLOWED`, `ACTOR_NOT_ACTIVE_MEMBER`, `INVALID_IMPORT_BATCH:<restricción>`…).
Los errores de estructura/respuesta tienen códigos específicos en `load.py`.
Se conserva el número y las demoras de reintento de errores transitorios.

Esta protección cubre `ETL.run_etl` y los diagnósticos del loader. Los comandos
independientes de inspección/exportación y `ETL.transform` conservan su uso previo
y sus vistas de datos; no forman parte de la salida segura del ejecutor.

## Verificación aislada

```sh
.venv/bin/python -m pytest --cov
.venv/bin/python -m ruff check ETL api services
```

`tests/test_etl_guard.py` usa TSV, credenciales y centinelas evidentemente ficticios, clientes simulados y bloqueo de
HTTP. Verifica importación pura, dry-run real sin credenciales, guardias antes de extraer/crear cliente, revalidación
de la caché y salida/errores sin nombre, documento, email ni teléfono.

`tests/test_etl_semantic.py` recorre archivo → base simulada → perfil contra el oráculo independiente (`expected.json`),
con IDs de catálogo que no coinciden con los códigos del lote. `tests/oracle_lots.py` deriva lotes de la fixture, sin
importar el ETL: `sintetico-v1` completo siempre queda bloqueado y la derivación permite ejercitar uno VALIDADO.
La misma comparación se repite contra la base local, con la CLI real, sin credenciales en argumentos:

```sh
back/.venv/bin/python database/testing/etl_semantic_local.py sintetico    # desde la raíz, con el stack y las semillas
```

La campaña de carga V1 (ALIGN-027) corre las CLI reales contra la base local con su propio comando, fuera de `testpaths`:
validar, cargar, conciliar, recargar, reimportar con una obligación modificada y rechazar. Procedimiento y resultado
esperado en [`entorno-aislado.md` §8](../../docs/tesis/entorno-aislado.md#8-carga-v1-verificada-align-027):

```sh
.venv/bin/python -m pytest tests_real/test_etl_v1_load.py -q   # con el turno de la base, después de db reset --local
```

Ninguna de estas pruebas reemplaza la revisión independiente.

La suite nueva `tests_real/test_import_publish.py` exige su propio reset y turno de base, igual que 027; la tanda de API/Next
usa otras semillas y requiere otro reset. El conjunto completo se ejecuta en tandas separadas, sin omitir archivos:

```sh
.venv/bin/python -m pytest tests_real/test_import_publish.py -q
# Nuevo reset local + esperar Auth y REST 200.
.venv/bin/python -m pytest tests_real/test_etl_v1_load.py -q
# Nuevo reset local + esperar Auth y REST 200.
.venv/bin/python -m pytest tests_real/test_imports_api.py tests_real/test_next_route.py -q
# Nuevo reset local + esperar Auth y REST 200.
.venv/bin/python -m pytest tests_real/test_import_publish_scale.py -q --tb=short --assert=plain
```

En otra tanda, con reset local propio, verificar el presupuesto de locks del rol
compartido por la API 052 y la CLI. Usa Auth, API y PostgREST reales, sin modificar
los límites de la migración durante el ensayo:

```sh
.venv/bin/python -m pytest tests_real/test_import_lock_budget.py -q --tb=short --assert=plain
```

El arnés toma el lock atómico de `/tmp/equitas-local-db/lock`, mantiene JWT en memoria/temporales privados, registra SHA y
hash del diff y limpia únicamente procesos y temporales propios. Los fallos se inyectan con triggers temporales de prueba
o un proxy HTTP local que pierde una respuesta ya confirmada, sin interruptores de fallo en producción. La campaña 027
conserva oráculos y comprobaciones por `xmin`; sus conteos de repetición ahora son el recibo original y las restauraciones
usan nuevas entregas explícitas. Ver la migración `20261105201716_import_batch_staging.sql`.
