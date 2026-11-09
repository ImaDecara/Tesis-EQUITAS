# Cuentas sintéticas y variables — demo local V1

## Dónde están las contraseñas

Nunca en Git ni en esta documentación. `init` las genera al crear cada cuenta y las guarda en la carpeta
privada de la demo:

- `~/.equitas-demo/cuentas.txt` — tabla legible (cuenta, correo, contraseña, rol y municipio).
- `~/.equitas-demo/cuentas.json` — lo mismo para el recorrido automatizado.

La carpeta tiene modo 0700 y los archivos 0600. Se puede cambiar con la variable `EQUITAS_DEMO_HOME`
(no puede estar dentro del repositorio). Para verlas: `cat ~/.equitas-demo/cuentas.txt`. Si se perdieron:
`init --rotar-claves` genera contraseñas nuevas para las mismas cuentas.

Cada persona que reproduzca la demo obtiene **sus propias** contraseñas locales: no se comparten.

## Cuentas

| Cuenta | Correo | Rol y municipio | Para comprobar |
|---|---|---|---|
| `consulta` | `demo-consulta@example.test` | consulta, Municipio sintético ETL (1) | tablero, filtros, colas, ficha; ve 3 CSV |
| `operador` | `demo-operador@example.test` | operador, municipio 1 | registra decisiones; no aprueba |
| `supervisor` | `demo-supervisor@example.test` | supervisor, municipio 1 | aprueba con lista de control; ve los 5 CSV |
| `importador` | `demo-importador@example.test` | importador, municipio 1 | no lee cartera ni decide; los CSV le responden 403 |
| `ajeno` | `demo-ajeno@example.test` | consulta, Municipio sintético B (demo N6) | otro municipio: no ve la cartera del 1 |
| `sin-membresia` | `demo-sin-membresia@example.test` | ninguno | sin membresía: no obtiene cartera |

El ETL usa además la cuenta de máquina `importador-etl@example.invalid` (rol `importador_sistema`, sin
acceso web), creada por `database/testing/etl-import-actor.sql`.

El municipio B solo sirve para la identidad ajena: el ETL actual publica únicamente en el municipio 1,
así que B no tiene cartera. Esto **no** certifica una operación con varios municipios reales.

## Variables por proceso

`start` las arma en el momento y las pasa al proceso; no hay que crear `.env`. La tabla sirve para
desarrollo manual y para configurar otro entorno. Ejemplo sin secretos: [`front/.env.example`](../../../front/.env.example).

| Proceso | Variable | Origen local | ¿Secreta? |
|---|---|---|---|
| Next (compilación y servidor) | `NEXT_PUBLIC_SUPABASE_URL` | `API_URL` de `supabase status -o env` (`http://127.0.0.1:54321`) | No (pública, queda en el bundle) |
| Next (compilación y servidor) | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `PUBLISHABLE_KEY` | No (clave publicable) |
| Next (solo servidor) | `EQUITAS_REVIEW_SERVER_JWT` | emitido por `start` con `JWT_SECRET` local, rol `equitas_review_server` | **Sí** |
| Next (opcional) | `QUALITY_SOURCE_SHA` | `git rev-parse HEAD`, para `/api/build-info` | No |
| ETL (`init`) | `EQUITAS_TARGET_ENV=local`, `SUPABASE_URL` | stack local | No |
| ETL (`init`) | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` | `supabase status -o env` | **Sí** (la de servicio) |
| ETL (`init`) | `EQUITAS_IMPORT_SERVER_JWT` | emitido por `init`, 1 h, rol `equitas_import_server` | **Sí** |
| ETL (`init`) | `EQUITAS_IMPORT_ACTOR_USER` | id que imprime `etl-import-actor.sql` | No |

Reglas:

- Ninguna clave de servidor lleva prefijo `NEXT_PUBLIC_`. `SERVICE_ROLE_KEY` y `JWT_SECRET` nunca van a la app.
- Las claves locales de Supabase son deterministas para la CLI 2.108.0 y solo sirven para este stack; igual
  se tratan como secretos: viven en `~/.equitas-demo/supabase-local.env` (0600) y no se imprimen.
- La app rechaza un JWT de servidor de otro rol (por ejemplo `service_role`).
- Los JWT se firman con el mecanismo existente `database/testing/case_review_local.py` (`sign_jwt`,
  `server_claims`), con vencimiento.

## Archivos privados que deja la demo

| Archivo | Contenido |
|---|---|
| `supabase-local.env` | claves locales de Supabase (se regenera en cada comando) |
| `cuentas.txt`, `cuentas.json` | contraseñas de las cuentas demo |
| `estado-init.json` | resultado del último `init` (conteos, lotes, recursos ajenos conservados), sin secretos |
| `run/next.json`, `run/next.log` | proceso de la app y su log |
| `logs/`, `validacion/` | logs privados del ETL, de la CLI y de `next build`, guardados **saneados** (sin claves, JWT ni contraseñas; un error de `psql` conserva solo sus líneas ERROR/DETAIL sin literales); reporte del validador |

Para borrar todo lo privado de la demo: detener (`stop --stack`) y eliminar la carpeta `~/.equitas-demo`.
Eso no borra la base ([INICIALIZACION.md §5](INICIALIZACION.md#5-empezar-de-cero-no-hay-recreación-automática)).
