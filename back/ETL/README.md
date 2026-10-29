# Ejecución segura del ETL — ALIGN-025

Este cambio conserva las transformaciones, los catálogos, los perfiles y la
deduplicación existentes. La corrección de su semántica corresponde a ALIGN-026.
Aplica la separación de entornos del plan EQUITAS 2026-10-28-v2, §7.6, y reduce
los datos expuestos por el ejecutor (objetivos 1 y 7 de la tesis; minimización
según `SOURCES/TESIS-SINTESIS.md`, §6, referencias `[P0235]`–`[P0240]`).

## Revisar un lote sin credenciales

Desde `back/`, con el entorno de dependencias fijadas preparado:

```sh
.venv/bin/python -m ETL.run_etl --folder fixture_sintetica
```

Lee `data/input/fixture_sintetica/cabecera.tsv` y `detalle.tsv`, y muestra conteos.
No carga `.env`, no exige URL ni clave y no crea un cliente Supabase. Importar
`ETL.config` o `ETL.run_etl` tampoco carga `.env` ni crea el cliente.
El resumen del ejecutor ya no incluye ejemplos de personas, objetos o deudas.
Se mantienen `--limit-objects` y `--priority-tipo-ingreso`.

## Ejecutar una carga autorizada en la base local

```sh
export EQUITAS_TARGET_ENV=local
export SUPABASE_URL=http://127.0.0.1:54321
# Configurar SUPABASE_SERVICE_ROLE_KEY con la clave del entorno local autorizado.
.venv/bin/python -m ETL.run_etl --folder fixture_sintetica --execute
```

`--execute` valida el destino **antes de leer el lote**. La configuración se lee
del entorno y, solo al ejecutar, de `back/.env` (sin reemplazar variables ya
definidas). `SUPABASE_KEY` sigue disponible como alternativa a
`SUPABASE_SERVICE_ROLE_KEY`. No registrar ni versionar esas claves.

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

`fila` es la posición desde 1 dentro del DataFrame procesado de cabecera o detalle,
después del límite/filtro existente; no es una promesa de línea física del TSV.
`fila=0` indica configuración, lote, perfil agregado o una llamada aislada al
loader sin contexto de fila. La clave del contexto se resume con BLAKE2b de
96 bits y una clave aleatoria por proceso: permite correlación durante la
ejecución, sin conservar un hash estable entre ejecuciones. Sin contexto se usa
el hash del valor ausente. No es un identificador persistente ni una garantía
de anonimización de archivos de origen.

Códigos principales: `TARGET_ORIGINAL_FORBIDDEN`, `TARGET_ENV_INVALID`,
`TARGET_URL_INVALID`, `TARGET_HOST_FORBIDDEN`, `SUPABASE_KEY_MISSING`,
`PERSON_EXTERNAL_ID_MISSING`, `DEBTOR_EXTERNAL_ID_MISSING`,
`DETAIL_ACCOUNT_MISSING`, `DETAIL_DEBTOR_MISSING`, `SUPABASE_RETRY`,
`SUPABASE_RETRY_EXHAUSTED`, `SUPABASE_OPERATION_FAILED` y `ETL_FAILED`.
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

`tests/test_etl_guard.py` usa TSV, credenciales y centinelas evidentemente ficticios,
clientes simulados y bloqueo de HTTP. Verifica importación pura, dry-run real sin
credenciales, guardias antes de extraer/crear cliente, revalidación de la caché,
carga simulada y salida/errores sin nombre, documento, email ni teléfono.
Estas pruebas no acreditan una carga contra una base real (ALIGN-027) ni una
revisión independiente de otro proveedor.
