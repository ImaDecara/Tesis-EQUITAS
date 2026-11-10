# Propuesta mínima de base para registrar decisiones y obtener reportes

**No se aplicó en ninguna base remota.** Es una propuesta para quien custodia la base original. Se aplicó, se verificó, se repitió y se revirtió **solo en el espejo local** (`equitas-n7-espejo`).

## Tres piezas, en orden y separadas

| Pieza | Archivo | Es aditiva | Qué habilita |
|---|---|---|---|
| 1. Paquete mínimo | `database/espejo/paquete-minimo.sql` | Sí, salvo una restricción única sobre `debtor` | Que la aplicación pueda abrir casos dejando registro, registrar y aprobar decisiones y entregar reportes. |
| 2. Registro de la cartera ya cargada | `database/espejo/cartera-heredada.sql` | Sí | Que las decisiones tengan una cartera fechada a la que atarse. Requiere que una persona responsable declare la fecha. |
| 3. Políticas de lectura | `database/espejo/politicas-lectura.sql` | **No** | Que cada cuenta lea solo su municipio por la Data API. Puede diferirse; se decide aparte. |

Lo que **no** está en ninguna de las tres: la maquinaria para cargar archivos, que altera tablas existentes. Está enumerada en [carga-desplegada-requisitos.md](carga-desplegada-requisitos.md).

Sin la pieza 1 la aplicación funciona en **nivel base**: muestra la cartera y no escribe nada. Con la pieza 1 pero sin la 2, la aplicación ve el módulo instalado y ningún lote: muestra «sin cartera cargada». Las piezas 1 y 2 van juntas.

## 1. Paquete mínimo

Lo genera `scripts/espejo/generar_paquete.py` leyendo las definiciones vigentes de una base local con todas las migraciones del repositorio, para no copiar a mano un cuerpo viejo. Los cuerpos de las nueve funciones instaladas en el espejo son idénticos (misma huella) a los de esa base.

| Objeto | Finalidad | Impacto | Cómo se comprueba |
|---|---|---|---|
| Rol `equitas_write_definer` | Dueño de las funciones que escriben. | Rol nuevo, sin inicio de sesión, con BYPASSRLS; solo lee cinco columnas de identidad de tablas existentes. Nadie puede asumirlo salvo `postgres`. | `select rolcanlogin, rolbypassrls from pg_roles where rolname = 'equitas_write_definer';` → `f, t` |
| Rol `equitas_review_server` | Rol con que el servidor de la aplicación llama a las funciones. | Rol nuevo, sin inicio de sesión, sin permisos sobre tablas. `authenticator` puede asumirlo. | `select has_table_privilege('equitas_review_server', 'public.case_review', 'select');` → `f` |
| Restricción `debtor_tenant_id_key` | Que una decisión no pueda apuntar a un caso de otro municipio. | **Único cambio sobre una tabla existente.** Agrega un índice único sobre `debtor(tenant, id)`; no cambia filas ni columnas. Bloqueo exclusivo breve. | Restricciones de las tablas existentes: 71 → 72. |
| Tipo `case_review_checklist` | Forma de la lista de control: casillas y códigos, sin texto sobre el hogar. | Tipo nuevo. | `select '{"canal_valido": true}'::public.case_review_checklist;` |
| Tabla `import_batch` | A qué cartera fechada corresponde cada decisión. | Nueva, vacía, solo se agrega. | 0 filas al instalar. |
| Tabla `case_review` | Decisión de una persona sobre un caso. | Nueva, vacía. El motivo libre no es legible por la Data API. | 0 filas al instalar. |
| Tabla `case_review_approval` | Aprobación u objeción por otra persona. | Nueva, vacía. | 0 filas al instalar. |
| Tabla `access_audit` | Registro de aperturas y descargas. | Nueva, vacía, sin claves foráneas. Crece con el uso. | 0 filas al instalar. |
| `equitas_append_only` | Rechaza UPDATE, DELETE y TRUNCATE en las cuatro tablas. | Solo sobre tablas nuevas. | Un `update` sobre `import_batch` falla con `APPEND_ONLY`. |
| `equitas_role_allows` | Tabla de permisos de la base. | Función pura. | `('ADMIN','DECISION_RECORD')` → `t`; `('USER', …)` → `f`. |
| `equitas_member_role` | Rol de la membresía activa. | Solo lee. | A través de las funciones que escriben. |
| `equitas_current_cutoff`, `equitas_verify_cutoff` | Lote vigente y verificación de que la decisión se toma sobre él. | Solo leen. | Una decisión con otra fecha falla con `CUTOFF_CHANGED`. |
| `record_case_review` | Única vía para registrar una decisión. | Inserta en `case_review`. | Desde la aplicación, con una cuenta ADMIN. |
| `record_case_review_approval` | Única vía para aprobar; rechaza a quien propuso. | Inserta en `case_review_approval`. | Quien propuso recibe `APPROVER_IS_PROPONENT`. |
| `read_case_review_reason_text` | Lectura del motivo libre para el rol que lo permite. | Solo lee. | Con USER falla con `ROLE_NOT_ALLOWED`. |
| `record_access_audit` | Única vía para escribir el registro de accesos. | Inserta en `access_audit`. | Abrir un caso deja una fila `CASE_OPEN`. |

**Diferencias declaradas con el esquema local del repositorio.**

- Allí las políticas de lectura de `import_batch`, `case_review` y `case_review_approval` delegan en la política de `tenant`. En una base cuyas políticas siguen abiertas, delegar dejaría las decisiones legibles por cualquier usuario autenticado. El paquete comprueba la membresía activa de forma explícita. Con las políticas de membresía instaladas, las dos formas dan lo mismo.
- El paquete **no otorga nada a `anon` ni a `service_role`** sobre las tablas nuevas. El esquema local sí les otorga lectura (sin política, ven cero filas); la aplicación no lee con ninguno de los dos.

**Dos límites que el paquete no resuelve solo, mientras las políticas de lectura sigan abiertas:**

- **Quién es ADMIN depende de las tablas de membresía.** Las funciones confían en `tenant_user`, `user`, `role` y `tenant`. La foto de octubre muestra que `authenticated` tiene permiso de escritura sobre ellas y que lo único que lo frena es que RLS está activo sin ninguna política de escritura. Si eso cambió, una persona podría darse el rol ADMIN y aprobar su propia propuesta con otra cuenta. Por eso el paquete **se niega a instalarse** (`PAQUETE_BASE_INSEGURA`) si alguna de esas cuatro tablas tiene RLS apagado o una política de escritura para roles de cliente, y el script de verificación lo muestra. `politicas-lectura.sql` retira además esos permisos.
- **Los identificadores de quien decidió son legibles por cualquier miembro.** `reviewer`, `approver` y `created_by` son números de usuario; la aplicación solo muestra «vos» u «otra persona». Pero con la tabla `user` abierta a cualquier usuario autenticado, quien consulte la Data API directamente puede traducir ese número a un nombre. Queda así hasta aplicar las políticas de lectura.

### Evidencia en el espejo

`paquete-minimo-verificar.sql` es de solo lectura y se corre antes y después.

| Paso | Resultado |
|---|---|
| Antes | 4 tablas «no existe», 9 funciones «no existe», 2 roles inexistentes. Tablas existentes: 23 tablas, 146 columnas, 71 restricciones, 23 políticas, 45 índices. |
| Aplicar | Sin errores, en una transacción. La comprobación de cierre del propio script pasa. |
| Después | 4 tablas con 0 filas, RLS activo, 1 política y 2 disparadores cada una. 9 funciones con `search_path` vacío; ninguna ejecutable por `anon` ni `service_role`. Tablas existentes: mismas 146 columnas (misma huella), **72** restricciones, mismas 23 políticas (misma huella), **46** índices. Cartera: mismos conteos. |
| Segunda corrida | Sin errores y **sin ninguna diferencia** en la verificación. |
| Reversa | La verificación vuelve a ser idéntica a la de «antes» y `verificar-esquema` vuelve a coincidir con la foto de octubre. |
| Reaplicación | Sin errores. |
| Base con las tablas de membresía escribibles (una política de escritura para `authenticated`, o RLS apagado en `role`) | El paquete se niega con `PAQUETE_BASE_INSEGURA` y no instala nada. |
| Reversa con una fila en el módulo | Se niega sin confirmación, con «si» y con otro número; con el número exacto (1) revierte, y la verificación vuelve a ser idéntica a la de «antes». |
| Restricción de `debtor` que ya existía antes del paquete | La reversa no la quita. |

La reversa (`paquete-minimo-revertir.sql`) bloquea las cuatro tablas, cuenta sus filas y **se niega** a seguir si hay alguna, salvo que se confirme en la misma sesión con el número exacto de filas que informó (`set equitas.confirmar_borrado = '<cantidad>';`). La confirmación se limpia al terminar. Borrar decisiones es irreversible. La restricción única de `debtor` se quita solo si la creó el paquete: al crearla queda marcada, y una que ya existía no se toca.

El script termina con `notify pgrst, 'reload schema'`. Sin eso la Data API puede seguir respondiendo que las tablas no existen, y mientras tanto la aplicación se comportaría como en nivel base: abriría casos sin dejar registro. En un proyecto alojado la foto de octubre muestra un disparador de evento que hace esa recarga solo; el aviso explícito no depende de él.

**Último paso de la instalación, obligatorio:** pedir `GET <url del proyecto>/rest/v1/access_audit?select=id&limit=0` con la clave pública. Sin sesión tiene que responder 401 con el código `42501` (permiso denegado: la tabla ya es conocida); con la sesión de una cuenta, 200. Si responde 404 con `PGRST205`, la Data API todavía no sirve el módulo: repetir el `notify` y volver a probar antes de usar la aplicación. En el espejo respondió 401 sin sesión y 200 con una sesión ADMIN, enseguida después de instalar. Además, cada apertura de caso sin registro deja una línea en el registro del servidor de la aplicación (`Apertura sin registro: NIVEL_BASE`): si aparece después de instalar el paquete, la Data API todavía no lo sirve.

## 2. Registro de la cartera ya cargada

`import_batch` exige huella SHA-256, origen, versión de reglas, responsable y fecha. Una cartera cargada antes de que existiera esa tabla no tiene archivo ni fecha de corte registrada, y no se inventan.

`public.register_inherited_portfolio(persona, municipio, fecha_declarada, versión_de_reglas)`:

- Se ejecuta **una sola vez por municipio** y solo si no tiene ningún lote.
- Registra un lote de origen `CARTERA_HEREDADA`, en estado publicado.
- La **huella y los conteos los calcula la función** sobre el contenido real en ese momento (objetos, obligaciones y vínculos; sin nombres, documentos ni contactos). La clave de la huella se llama `contenido_al_registrar`: no pretende ser la huella de un archivo.
- La **fecha de corte la declara** una persona con rol ADMIN y membresía activa en el municipio, y queda marcada como declarada (`fecha_declarada`). La aplicación la muestra como «fecha declarada».
- Solo la ejecuta quien administra la base: no está expuesta a la aplicación ni a la Data API. Por eso el responsable que queda guardado es una **atribución declarada** por quien la ejecuta, no un actor autenticado: la función comprueba que esa persona exista y sea ADMIN activa del municipio.
- «Fecha futura» se mide con el día del municipio (Córdoba), no con el de la base. Un índice único impide un segundo lote heredado en el mismo municipio aunque dos ejecuciones se crucen.

Comprobado en el espejo con `cartera-heredada-probar.sql` (todo en una transacción que termina en `rollback`):

| Caso | Resultado |
|---|---|
| Cuenta USER | `ROLE_NOT_ALLOWED` |
| Membresía inactiva; persona de otro municipio | `ACTOR_NOT_ACTIVE_MEMBER` |
| Fecha futura; fecha ausente | `DECLARED_DATE_INVALID` |
| Municipio sin cartera | `PORTFOLIO_EMPTY` |
| Registro válido | Se inserta: cumple todas las restricciones reales de la tabla. Conteos iguales a los de la cartera. |
| Segunda ejecución; otra fecha con un lote previo | `PORTFOLIO_ALREADY_REGISTERED` |
| Modificar el lote | `APPEND_ONLY` |
| Función de corte de la base | Selecciona ese lote. Una decisión con otra fecha falla con `CUTOFF_CHANGED`. |
| Ejecutable por `anon`, `authenticated`, `service_role`, `equitas_review_server` | No. |

**Decisión que queda para una persona:** qué fecha declarar. Es la fecha a la que corresponden los importes y estados cargados; con ella se calcula qué está vencido. No se puede corregir después: el lote no se modifica.

## 3. Políticas de lectura (no aditivo, aparte)

`politicas-lectura.sql` elimina las 23 políticas abiertas, crea las de membresía activa del repositorio, retira de `authenticated` los permisos de INSERT, UPDATE y DELETE y agrega los índices que esas políticas usan. `politicas-lectura-revertir.sql` vuelve atrás.

Comprobado en el espejo a escala, **por la Data API real y con la sesión de cada cuenta** (`equitas_espejo.py probar-lectura`). Filas visibles:

| Cuenta | Antes: objetos / obligaciones / personas | Después: objetos / obligaciones / personas |
|---|---|---|
| Anónimo | 0 / 0 / 0 | 0 / 0 / 0 |
| ADMIN del municipio | 2.900 / 55.684 / 2.900 | 2.900 / 55.684 / 2.900 |
| USER del municipio | 2.900 / 55.684 / 2.900 | 2.900 / 55.684 / 2.900 |
| USER de otro municipio | **2.900 / 55.684 / 2.900** | 0 / 0 / 0 |
| Sin membresía | **2.900 / 55.684 / 2.900** | 0 / 0 / 0 |
| Membresía inactiva | **2.900 / 55.684 / 2.900** | 0 / 0 / 0 |

Con una membresía activa los conteos son los mismos antes y después. Como `main` y la candidata leen esas tablas por la misma Data API con la sesión de la persona, los dos leen lo mismo; **no se ejecutó la aplicación de `main` contra el espejo**.

Las tres últimas filas de «antes» son el motivo del cambio: con las políticas de la foto, cualquier cuenta autenticada lee toda la cartera de todos los municipios por la Data API, aunque la aplicación no se lo muestre.

**No se puede comprobar en local:** si las políticas de producción siguen siendo las de la foto; cuántas cuentas reales quedarían sin lectura (el script `politicas-lectura-verificar.sql` las cuenta, sin nombres ni correos); si hay otros clientes que lean o escriban con la sesión de una persona; y el tiempo real de los bloqueos con datos y carga reales.
