# Ejecución segura y semántica del ETL — ALIGN-025 y ALIGN-026

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
# Desde /tmp/equitas-local-db/supabase-local.env, sin imprimirlas: clave de servicio (cartera) y clave anon (apikey).
export SUPABASE_SERVICE_ROLE_KEY=...   SUPABASE_ANON_KEY=...
# JWT de equitas_import_server (database/testing/case_review_local.py mint-jwt) y el id que imprime etl-import-actor.sql.
export EQUITAS_IMPORT_SERVER_JWT=...   EQUITAS_IMPORT_ACTOR_USER=...
.venv/bin/python -m ETL.run_etl --folder <lote> --execute --cut-off 2026-09-30 [--mapping perfil.json]
```

Sin `--mapping` solo se admite una carpeta con `manifest.json` de fixture sintética (`MAPEO_REQUERIDO` si no).
Con ese manifiesto o con un perfil, `--cut-off` debe coincidir con la fecha que declaran.

`--execute` valida el destino, el corte y las credenciales **antes de leer el lote**. Después:

1. Calcula el SHA-256 de los archivos, del mapeo y del contrato, lee y valida con `ETL.validate_source`.
2. **Lote bloqueado o ilegible:** registra `FALLIDO` en `import_batch`, no escribe ninguna fila de cartera y sale con 1
   (`BATCH_BLOCKED` o el código de la estructura). Un lote de `sintetico-v1` completo termina siempre así, a propósito.
3. **Lote validado:** resuelve todas las claves de catálogo (`CATALOG_KEY_MISSING` detiene antes de escribir), registra
   `VALIDADO`, carga solo las filas aceptadas y cierra con `PUBLICADO`, que reemplaza al evento anterior.
4. **Falla durante la carga:** registra `FALLIDO`. Las escrituras por la Data API no son una transacción: lo ya escrito
   no se revierte. La publicación atómica, la recuperación y la clave de idempotencia por lote son de ALIGN-032;
   hoy cada ejecución agrega su propia cadena de eventos.

Los objetos en cuarentena no se escriben: conservan el estado previo que tuvieran. La marca de actualización
pendiente, sin columna donde guardarla, queda para ALIGN-032/054; su cantidad está en `import_batch.counts`.

Los eventos de `import_batch` usan **solo** `EQUITAS_IMPORT_SERVER_JWT` y la clave `anon` como `apikey`, nunca la clave
general, que no tiene permiso sobre la función. La cartera se sigue escribiendo con la clave de servicio local.
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

`fila` es la línea física de la cabecera del objeto que se está cargando. `fila=0` indica configuración, lote,
perfil agregado o una llamada aislada al loader sin contexto de fila. La clave del contexto se resume con BLAKE2b de
96 bits y una clave aleatoria por proceso: permite correlación durante la
ejecución, sin conservar un hash estable entre ejecuciones. Sin contexto se usa
el hash del valor ausente. No es un identificador persistente ni una garantía
de anonimización de archivos de origen.

Códigos principales: `TARGET_ORIGINAL_FORBIDDEN`, `TARGET_ENV_INVALID`,
`TARGET_URL_INVALID`, `TARGET_HOST_FORBIDDEN`, `SUPABASE_KEY_MISSING`,
`CUT_OFF_REQUIRED`, `PARTIAL_LOAD_REJECTED`, `IMPORT_CREDENTIAL_MISSING`, `IMPORT_ACTOR_INVALID`,
`BATCH_BLOCKED`, `SOURCE_CHANGED_DURING_READ`, `CATALOG_KEY_MISSING`, `IMPORT_BATCH_REJECTED`,
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

Estas pruebas no reemplazan la campaña de carga V1 (`back/tests_real`, ALIGN-027) ni la revisión independiente.
