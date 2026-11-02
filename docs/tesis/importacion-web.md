# Importación web: API interna de lotes (ALIGN-052)

Cómo una persona autorizada del municipio entrega un lote sin intervención técnica y sin abrir una puerta nueva a los datos `[P0189]`, `[T02.R02]`. Reglas de autenticación, roles y credenciales: [`back/api/README.md`](../../back/api/README.md). Decisión de arquitectura: [ADR-001](adr-001-reglas-y-capas.md) §5.1.

> Esta sección cubre recibir, consultar y descartar. El lote llega a `RECIBIDO` y el archivo no se interpreta. Mapeo (ALIGN-056), preview (ALIGN-054) y confirmación (ALIGN-057) agregan sus rutas a `back/api/imports.py` y a la lista cerrada de `front/lib/server/imports-forward.ts`.

## Camino de una solicitud

```text
Navegador ── cookie de sesión ──> Route Handler de Next ── Bearer + flujo ──> FastAPI ── token del usuario (RLS) ──> Supabase local
                                  front/app/api/imports/*                     127.0.0.1    └─ equitas_import_server: record_import_batch
```

- **El navegador nunca llama a FastAPI.** La URL interna está en `EQUITAS_IMPORT_API_URL`, sin prefijo público, y solo la lee un módulo `server-only`. Esta versión solo admite loopback.
- **Qué pasa y qué vuelve.** El Route Handler reenvía una lista cerrada de rutas, sin la consulta ni las cookies. Al navegador vuelven el código y un cuerpo JSON. Una redirección o una respuesta que no sea JSON se convierte en `502`, y un servicio caído en `503`, sin citar la URL.
- **Origen.** Una escritura exige un `Origin` igual al de la aplicación: esquema, host y puerto, tal como lo serializa un navegador. Si viene, además, `Sec-Fetch-Site: same-origin`. Si no, `403 ORIGIN_NOT_ALLOWED`.
- **La autoridad es FastAPI.** El Route Handler solo extrae el token de la sesión y la renueva si venció. Una cookie falsificada termina en `401` en FastAPI.

### `/api/imports` queda fuera del proxy de Next

Con `proxy.ts` en el camino, Next retiene el cuerpo en memoria y lo **corta en 10 MB sin ningún error** (`proxyClientMaxBodySize`, en `node_modules/next/dist/docs/`). Un lote de hasta 25 MB por archivo llegaría truncado. Por eso el matcher de `front/proxy.ts` excluye esta ruta. Reinyectado el defecto, el lector rechaza el cuerpo cortado con `MULTIPART_INVALIDO`: nunca se acepta un lote truncado. Fuera del proxy, una sesión ausente recibe un `401` en JSON y no una redirección a `/login`.

## Contrato

| Ruta | Cuerpo | Respuesta |
|---|---|---|
| `POST /imports` | `multipart/form-data`: `as_of` y `cabecera` + `detalle`, o `libro`; `source_updated_at` opcional. Encabezado **obligatorio** `Idempotency-Key` (UUID) | `201` nuevo, `200` repetición |
| `GET /imports/{id}` | — | `200` con el evento vigente |
| `POST /imports/{id}/discard` | — | `200` con el evento `DESCARTADO` |

La respuesta lleva `id` (evento vigente), `root_id` (lote), `tenant`, `status`, `source`, `file_hashes`, `as_of`, `source_updated_at`, `rules_version`, `counts`, `created_by_role`, `created_at`, `copy_available` y `copy_expires_at`. No lleva `created_by`, la clave de idempotencia ni rutas o nombres de archivo. `{id}` puede ser cualquier evento de la cadena.

| Código | Motivo |
|---|---|
| `413 LIMITE_ARCHIVO_EXCEDIDO` | Más de 25 000 000 bytes por archivo (`limites.bytes` de `contracts/source-contract.v1.json`) o más de 51 048 576 bytes por solicitud. Se corta al pasar el límite, sin leer el resto |
| `415 MULTIPART_REQUERIDO` | Otro tipo de contenido o un límite multipart inválido |
| `408 UPLOAD_TIEMPO_EXCEDIDO` | La recepción tardó más de 300 s |
| `422` | `AS_OF_INVALIDO`, `SOURCE_UPDATED_AT_INVALIDO`, `ARCHIVOS_REQUERIDOS`, `ARCHIVO_VACIO`, `ARCHIVO_NO_ESPERADO`, `ARCHIVO_DUPLICADO`, `CAMPO_DUPLICADO`, `CAMPO_NO_ESPERADO`, `CAMPO_EXCEDE_LIMITE`, `MULTIPART_INVALIDO`, `MULTIPART_DEMASIADAS_PARTES`, `IDEMPOTENCY_KEY_REQUERIDA`, `IDEMPOTENCY_KEY_INVALIDA` |
| `404 BATCH_NOT_FOUND` | Lote inexistente o de otro municipio: mismo cuerpo |
| `409` | `IDEMPOTENCY_KEY_CONFLICT`, `BATCH_NOT_DISCARDABLE`, `BATCH_ALREADY_SUPERSEDED` |
| `503` | `READ_INCOMPLETE`, `BATCH_WRITE_FAILED`, `IMPORT_WRITER_NOT_CONFIGURED`, `ALMACEN_TEMPORAL_INSEGURO`, `ALMACEN_TEMPORAL_NO_DISPONIBLE` |

- **Un lote son dos archivos lógicos:** `cabecera` y `detalle`, o un `libro` con dos hojas. El tipo real lo decide el lector al leer, no esta ruta.
- **Los campos que no son del lote se ignoran**, también `tenant`, hasta 1024 bytes cada uno. Un archivo con otro nombre de campo se rechaza.
- **`as_of` es un hecho del lote, no del perfil** (R3 de ALIGN-030). Lo declara cada envío y no se reemplaza por la fecha de hoy.
- **Idempotencia.** La clave es obligatoria y se genera una por lote: el mismo envío se reintenta con la misma. Con el mismo contenido devuelve el mismo lote; con otro contenido, o de otra persona, `409`.
- **Fila y copia no se contradicen.** El destino se prepara antes de registrar: si no sirve, `503` y sin fila. Una vez registrada la fila, no se anuncia éxito hasta verificar una copia completa con los hashes declarados; si no se pudo guardar, `503 ALMACEN_TEMPORAL_NO_DISPONIBLE`. Ese envío se reintenta con la misma clave y restaura la copia. Lo mismo vale si la respuesta se perdió, si la copia venció o si quedó dañada, siempre que el lote siga abierto (`RECIBIDO`, `VALIDADO`, `REQUIERE_NUEVO_PREVIEW`). Un lote cerrado no recupera su copia: el reintento devuelve su estado actual. `copy_available` sale del disco, no de la fila: el `GET` comprueba clases y tamaño total sin leer los archivos.
- **Estados.** `import_batch` es append-only: un cambio de estado es una fila que reemplaza a la anterior. Se puede descartar en `RECIBIDO`, `VALIDADO` y `REQUIERE_NUEVO_PREVIEW`. `CONFIRMADO`, `PUBLICADO` y `FALLIDO` dan `409`. ALIGN-032 define las transiciones y puede afinar esta lista. Descartar dos veces da el mismo evento, también en simultáneo: la clave es derivada.

## Por qué un lector multipart propio

`python-multipart` no está entre las dependencias fijadas, así que `Request.form()` no se puede usar, y además arma cada parte antes de entregarla. `back/api/multipart.py` emite los bytes a medida que llegan y solo acepta lo que produce un navegador: sin preámbulo, sin codificación de transferencia, con cierre obligatorio. Los errores son códigos: no citan la entrada. Si más adelante se fija esa dependencia, este módulo se puede reemplazar sin cambiar el contrato.

## Temporal privado

`back/api/upload_store.py`. Directorios `0700` y archivos `0600`, fuera del repositorio (`EQUITAS_IMPORT_TMP_DIR`). Rechaza una raíz compartida, ajena o que sea un enlace simbólico.

```text
<raíz>/incoming/<token de 128 bits>/<clase>   mientras se recibe
<raíz>/lotes/<tenant>/<root_id>/<clase>       desde que el lote queda registrado
```

Ninguna ruta se arma con datos del cliente y el nombre del archivo no se guarda. Un error, un corte de conexión o un tiempo excedido no dejan nada. El descarte borra la copia.

**Retención: 24 h, sin depender de que alguien suba o descarte.**

- Una copia vencida **no se entrega**: `UploadStore.files` y `verify` la tratan como ausente desde el segundo 86 400 y la borran.
- Los bytes se retiran solos: `purge_expired` corre al arrancar el proceso, para lo que venció con el proceso detenido, y después cada `EQUITAS_IMPORT_PURGE_SECONDS` (900 por defecto, 3600 como máximo). También en cada recepción y en cada descarte. Mientras el proceso corre, un archivo vencido queda en disco como mucho ese intervalo más.
- Si una purga falla, queda `PURGA_FALLIDA clase=…` o `PURGA_INCOMPLETA pendientes=…` en el registro, sin rutas, y la siguiente vuelve a intentar. Lo que no se pudo borrar sigue sin entregarse.
- **Límite:** con el proceso detenido nada purga hasta el próximo arranque. Es la condición de esta versión local; un despliegue (ALIGN-050) debe decidir si además hace falta una tarea externa.

**Para quien lea el archivo (ALIGN-054, 056).** `UploadStore.files(tenant, root_id)` devuelve las rutas de la copia vigente y `verify(tenant, root_id, file_hashes)` comprueba el contenido antes de confiar en él. Si no están, se perdió o venció: hay que pedir que se reenvíe con la misma clave. Cuando ALIGN-053 esté integrado, el lector corre **en un proceso aparte, con tope de memoria y de tiempo**, y hay que decidir si este almacén se unifica con `PrivateUploadStore`, que resuelve lo mismo por token.

## Lo que esta versión no hace

- **Usuario con dos membresías activas:** recibe `409 TENANT_SELECTION_REQUIRED`, sin filas. El ticket pide ignorar cualquier municipio enviado por el cliente, así que no se usa la cookie de selección de la web. Si esas personas deben importar o leer por esta API, hace falta una decisión expresa sobre cómo llega la selección.
- **`importador_sistema`:** credencial de máquina, por ALIGN-060.
- **Cuota por municipio:** un importador autorizado puede ocupar disco hasta que venza el TTL. Lo cubre la campaña de tamaño y tiempo de ALIGN-059.
- **Despliegue fuera de loopback:** ALIGN-050. El origen se compara entero contra el esquema con que Next recibió la solicitud y el `Host`. Detrás de otro proxy hay que fijar el origen confiable de la aplicación y revisar `X-Forwarded-*`.
