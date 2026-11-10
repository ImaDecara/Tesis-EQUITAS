# Qué haría falta para cargar CSV en una aplicación publicada y en la base de producción

**Nada de esto está implementado ni se dio por resuelto.** Hoy la carga funciona únicamente en el entorno local: navegador → aplicación en `127.0.0.1` → servicio de importación en la misma máquina → base local. Esta lista enumera lo pendiente para que se pueda decidir; cada punto necesita una decisión de una persona.

## 1. Dónde correría el servicio de importación y cómo lo alcanzaría la aplicación

| Hoy | Qué habría que resolver |
|---|---|
| El servicio es una API en Python (`back/api`, FastAPI) que corre en la misma máquina que la aplicación. | Vercel ejecuta la aplicación web, no un proceso de Python de larga duración con disco temporal y un proceso hijo sin credenciales. Hace falta un lugar donde corra (un servidor o contenedor propio) y quién lo opera. |
| La aplicación solo reenvía a una dirección de la misma máquina: `EQUITAS_IMPORT_API_URL` debe ser `127.0.0.1`, `localhost` o `[::1]`; cualquier otra no se usa (`front/lib/server/imports-forward.ts`). | Definir la red entre la aplicación publicada y el servicio: dirección, cifrado, y cómo se autentica la aplicación ante el servicio. Cambiar esa lista cerrada es una decisión de seguridad, no un ajuste. |
| El servicio verifica la sesión de la persona y que la solicitud venga de la aplicación (origen), y la aplicación le reenvía el token de esa sesión. | Mantener esas comprobaciones con un origen público y con el proyecto de autenticación de producción. |
| El servicio guarda los archivos recibidos en una carpeta temporal privada y los borra. | Dónde viven esos archivos, por cuánto tiempo y quién puede leerlos: son datos de contribuyentes. |
| El cargador **rechaza a propósito** cualquier destino que no sea local o de pruebas, y cualquier referencia al proyecto original (`back/ETL/config.py`, `TARGET_ORIGINAL_FORBIDDEN`). Esta guarda no se tocó. | Habilitar producción como destino es una decisión explícita de una persona responsable, con su propio procedimiento. No es una variable de entorno. |

## 2. Límites de tamaño

| Límite de hoy (local) | Valor |
|---|---|
| Tamaño por archivo | 25 MB |
| Filas por archivo | 300.000 |
| Columnas | 60 |
| Registros entre personas y objetos por lote | 200.000 |
| Tiempo de procesamiento | 180 segundos |

A contrastar en el entorno publicado, sin verificar esta noche:

- El cuerpo máximo de una solicitud a una función de Vercel es mucho menor que 25 MB (su documentación pública indica 4,5 MB). Un archivo real no pasaría por la aplicación tal como hoy: haría falta subirlo directo al servicio o a un almacenamiento, con un permiso de un solo uso.
- El tiempo máximo de ejecución de una función, frente a los 180 segundos de procesamiento más la publicación.
- La Data API corta las funciones de base a los 60 segundos para el rol de importación y espera hasta 8 segundos por un bloqueo (así está configurado ese rol). La publicación de una cartera a escala real hay que medirla contra ese límite antes de dar nada por resuelto.
- Next recorta en silencio a 10 MB los cuerpos que pasan por `proxy.ts`: la ruta de carga está fuera de ese filtro, y tiene que seguir estándolo.

## 3. La credencial de importación

- El servicio llama a la base con el rol `equitas_import_server`: un JWT de corta vida firmado con el secreto del proyecto local (HS256). El script del entorno lo genera y lo renueva; vence a las 72 horas.
- En un proyecto alojado hay que resolver: con qué clave se firma (secreto compartido o claves asimétricas del proyecto, que no se sabe cuál usa), dónde se guarda, quién la rota y cómo se revoca. Esa credencial puede publicar una cartera entera.
- Lo mismo vale, con menos alcance, para `equitas_review_server`, la credencial con que la aplicación registra decisiones y accesos. El paquete mínimo crea el rol; emitir su credencial en producción es un paso aparte.

## 4. Lo que la base de destino necesitaría

Además del paquete mínimo de decisiones ([espejo-paquete-minimo.md](espejo-paquete-minimo.md)), la carga exige todo lo siguiente. Sale de las migraciones del repositorio, que hoy solo se aplicaron a bases locales.

### 4.1 Tablas, esquema y funciones de publicación (objetos nuevos)

- Roles `equitas_import_definer` (dueño, con BYPASSRLS) y `equitas_import_server`, este último con tiempo máximo de sentencia de 60 s y de espera de bloqueo de 8 s.
- Esquema privado `equitas_import_private`, con las tablas de versión por objeto y por persona (`object_version`, `person_version`) y sus funciones.
- Tablas `import_publication` e `import_row_staging` (el lote en preparación), y `import_preview` e `import_preview_row_staging`.
- Funciones `stage_import_batch`, `publish_import_batch`, `settle_import_batch`, `read_import_receipt`, `record_import_batch`, `recompute_debtor_profiles`, las de vista previa y las de limpieza.
- Un disparador sobre `import_batch` que impide registrar por fuera de una publicación atómica.
- La extensión `pg_cron` y dos tareas por minuto que limpian lotes en preparación vencidos. Hay que confirmar que el plan del proyecto la permite.

Migraciones: `20261105201716`, `20261105213408`, `20261107061833`, `20261107110911`, `20261107151854`, `20261110100000`, `20261110110000`.

### 4.2 Cambios sobre tablas EXISTENTES

Esto es lo que más cuidado pide, porque toca la cartera ya cargada.

| Cambio | Tablas | Migración | Riesgo sobre lo existente |
|---|---|---|---|
| Identidad en la columna `id`, con la secuencia arrancando por encima del máximo actual | `address`, `city`, `data_source`, `debt`, `debtor`, `debtor_contact`, `debtor_person`, `debtor_profile`, `debtor_profile_detail`, `person`, `province`, `tenant`, `tenant_user`, `user` (14) | `20261030090000` | No se sabe si producción ya tiene identidad en esos `id`. Si la tiene, este paso falla; si no, cambia cómo se asignan los `id` nuevos. |
| `debt.updated_amount` se **borra y se vuelve a crear** como columna generada a partir de `current_amount` | `debt` | `20261030090000` | Reescribe la tabla y descarta los valores guardados en esa columna. No se sabe si en producción ya es generada. Hay que mirarlo antes. |
| Columnas que dejan de ser obligatorias | `debtor_profile` (ocho columnas), `debtor_profile_detail.risk_value`, `debtor.status` | `20261102100000` | Cambia el contrato de lectura para cualquier otro cliente de esas tablas: aparecen nulos donde antes había 0. |
| Columna nueva `debt_state_not_observed_count` y su restricción | `debtor_profile` | `20261102100000` | Aditivo. |
| Restricción única `debtor(tenant, id)` | `debtor` | `20261030100000` | La misma del paquete mínimo. |
| Disparador de versión en cada inserción, modificación o borrado | `person`, `debtor`, `debtor_person`, `debt`, `province`, `city`, `address`, `debtor_contact`, `debtor_profile`, `debtor_profile_detail` (10) | `20261105201716` | Toda escritura sobre la cartera, también la de otros clientes, pasa a ejecutar código de este proyecto. |
| Políticas de lectura por membresía | las 23 | `20261021221030` | No aditivo. Ver el anexo del paquete. |

### 4.3 Catálogo de estados

| | Estados |
|---|---|
| El cargador de esta entrega espera | Los ocho de `main` **más `SUSPENDED`** (nueve), y los resuelve por clave. |
| `main` declara | Ocho: ACTIVE, OVERDUE, PAYMENT_PLAN, JUDICIAL, CERTIFICATE_ACTIVE, PAID, CANCELLED, UNKNOWN. Solo asigna tres, por fecha. |
| Producción tiene | **Sin observar.** |

Si el catálogo de producción no tiene `SUSPENDED`, una carga con una obligación suspendida se rechaza por catálogo incompleto (la pantalla lo informa así; no es un error del archivo). Agregar una fila a ese catálogo es una decisión del municipio: qué significa «suspendida» y cómo se computa no está definido en ningún documento ni código.

## 5. Qué pasaría con la cartera ya cargada en producción

- **Cada carga representa la cartera completa.** Un lote al que le falte un objeto, una obligación o un titular que ya estaba cargado se rechaza entero (política «rechazar ausentes»). La primera carga sobre producción tendría que traer todo lo que ya está, con las mismas claves.
- **Las claves naturales tienen que coincidir.** El cargador reconoce un objeto por municipio, tipo e identificador externo, y una obligación por objeto e identificador externo. Si la cartera actual se cargó con otras claves o con otro formato de archivo, la carga no la reconocería como la misma: o la rechaza por ausentes o duplica. Hay que comparar antes, en solo lectura.
- **Las versiones por objeto arrancan vacías.** La publicación lleva una versión por objeto y por persona en tablas que hoy no existen. Cómo se comporta la primera carga sobre una cartera que no pasó por ellas no se probó: hay que ensayarlo sobre una copia.
- **El recálculo de perfiles reclasifica.** Al publicar, `recompute_debtor_profiles` vuelve a marcar las obligaciones como vigentes o vencidas según la fecha de corte del lote y recalcula el perfil de cada objeto con la definición nueva (las pagadas no cuentan). Los perfiles de producción cambiarían de valor aunque los datos de origen no cambien.
- **El formato de archivo.** Solo se lee el formato de los archivos de ejemplo. Los archivos reales del municipio necesitan su propio mapeo, que no existe.

## 6. En una línea

Para decisiones y reportes alcanza con una propuesta chica y reversible (el paquete mínimo y el registro de la cartera). Para cargar archivos hace falta cambiar tablas que hoy tienen datos, operar un servicio nuevo y emitir una credencial que puede reemplazar la cartera: es un proyecto aparte, con su propia validación sobre una copia de los datos reales.
