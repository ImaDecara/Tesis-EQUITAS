# ALIGN-022: campaña real de autorización del registro de decisiones

Demuestra contra la base local que el registro de decisiones no se puede falsear ni leer entre municipios: Auth, RLS, PostgREST, las funciones de ALIGN-018 y ALIGN-020, y las acciones compiladas por HTTP contra `next start`, sin simular nada. Verifica cada denegación contra la base con `psql`: ninguna fila nueva en ninguna de las tres tablas.

Está separada de la campaña de 12 casos de E06, que no cambia y sigue reservada al proyecto de pruebas. No entra en las suites aisladas (`tests/external-review/**` está en el `exclude` de `vitest.config.ts`) ni en los gates: necesita el stack y un turno. Sin configuración falla, no se omite.

| Archivo | Qué hace |
| --- | --- |
| `case-review.integration.test.ts` | Los casos. Cada `it` lleva un ID del inventario |
| `support.ts` | Data API, cuerpos de las funciones, cortes, JWT sintéticos y comprobación de "ninguna fila nueva" |
| `fixture.sql` | Una cuenta con rol `importador` real y actores de usuario inactivo, municipio inactivo y proponente. `local-review/fixture.sql` deja a la cuenta `importador` con rol `tp_operator`: esa cuenta es la que prueba esa compatibilidad |
| `../../vitest.review.config.ts` | Configuración propia: sin `only`, sin reintentos, en serie. Exige la configuración local antes de cargar |
| `../../../database/testing/review_integration.py` | Runner y validador. Pruebas en `test_review_integration.py` |

Reutiliza `tests/local-review/` de ALIGN-020 (`config.ts`, `http-support.ts`, `fixture.sql`, `prepare-config.mjs`, `probe/`) sin cambiarlo.

## Por qué el runner vive en `database/testing/`

El ticket lo ubica en `quality/`. El usuario decidió el 02/11/2026 que no se modifica `quality/`, así que se quedó en `database/testing/`, con el mismo alcance y la misma aceptación. `quality/supabase-testing.json` solo se lee, para saber qué destinos rechazar.

## Procedimiento

Con `PATH` en npm 11.21.1 y el stack de `docs/tesis/entorno-aislado.md`. Desde la raíz del worktree, con `T=/tmp/<directorio propio>` en modo 0700:

1. `umask 077` y `mkdir /tmp/equitas-local-db/lock`. Si falla, esperar y reintentar. Liberar con `rmdir` también si algo falla.
2. Sembrar. Después del `db reset`, esperar 200 en `/auth/v1/health` y en `/rest/v1/role?select=id&limit=1` con la clave publicable. La campaña exige una base recién sembrada (`REV-ENV-01`):

   ```sh
   npx --yes supabase@2.108.0 db reset --local
   P() { docker exec -i supabase_db_equitas-tp-testing psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
   P -q -At -F '|' < database/testing/case-review-auth-fixtures.sql > $T/credentials.psv
   P -q < database/testing/case-review-fixtures.sql
   P -q < front/tests/local-review/fixture.sql
   P -q -At -F '|' < front/tests/external-review/fixture.sql >> $T/credentials.psv
   python3 -I database/testing/case_review_local.py mint-jwt --role equitas_review_server --hours 12
   python3 -I database/testing/case_review_local.py mint-jwt --role equitas_import_server --hours 12
   (cd front && node tests/local-review/prepare-config.mjs $T/credentials.psv $T/config.json)
   ```

3. Compilar el commit con la sonda de ALIGN-020 y retirarla: ninguna página importa todavía las acciones, y el runner exige un árbol limpio. Con el commit ya confirmado, desde `front/`, copiar `tests/local-review/probe/*` a `app/align020-probe/`, ejecutar `npm run build` con `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y `QUALITY_SOURCE_SHA=$(git rev-parse HEAD)`, y borrar `app/align020-probe/`.
4. Levantar el servidor, con las mismas variables más `EQUITAS_REVIEW_SERVER_JWT` y un puerto alto propio: `npx next start --hostname 127.0.0.1 --port <puerto>`.
5. Correr la campaña desde la raíz. El directorio de salida debe ser nuevo:

   ```sh
   back/.venv/bin/python database/testing/review_integration.py run --output $T/salida --config-file $T/config.json --http-base http://127.0.0.1:<puerto>
   ```

6. Detener el servidor, compilar de nuevo sin la sonda si se va a seguir trabajando en el worktree, y `rmdir /tmp/equitas-local-db/lock`. Borrar `$T`.

Para aislar un caso, desde `front/`: `EQUITAS_REVIEW_LOCAL_CONFIG=$T/config.json EQUITAS_REVIEW_HTTP_BASE=http://127.0.0.1:<puerto> npx vitest run --config vitest.review.config.ts -t REV-FN-04`. Eso no es una ejecución de la campaña: los demás casos quedan omitidos y el validador la rechazaría.

Para volver a validar un reporte sin ejecutar nada: `back/.venv/bin/python database/testing/review_integration.py validate --report $T/salida/review.json --sha <sha>`.

## Qué exige el runner

**Antes de la primera solicitud.** Rechaza, sin repetir el valor en el mensaje:

- El proyecto original y el de testing, por URL o por `project_ref`, en cualquier valor de la configuración o en cualquier variable de entorno.
- Cualquier `supabase.co`, cualquier `project_ref` declarado y cualquier destino que no sea `http` en `localhost`, `127.0.0.1` o `::1`, con puerto, sin usuario, ruta ni consulta.
- Una clave administrativa, un JWT de otro rol o una cuenta que no sea `@example.test`.
- Un servidor de otro commit o que apunte a un proyecto remoto, según `/api/build-info`.

**Al terminar.** Aprueba solo si se cumple todo esto, y si no informa todo lo que falló:

- Inventario exacto: cada ID una vez, ninguno de más.
- Cada caso `passed`, con conteos de N aprobadas, 0 fallidas y 0 omitidas. Vitest sale con 0 cuando un caso falta o se omite: por eso el validador no confía en su código de salida.
- SHA completo, árbol limpio, servidor del mismo commit y el hash del archivo de pruebas.

**Salida.** `review.json` y `review.xml` (JUnit, con el SHA y el entorno en `properties`; un caso faltante aparece como fallido), `summary.md`, y los `tests.json`, `tests.xml` y `tests.log` de Vitest. Todas pasan por una limpieza de claves y referencias prohibidas, porque un fallo de Vitest puede citar lo que comparó.

## Casos

| Lo pedido | Casos |
| --- | --- |
| Operador inserta en su municipio | `REV-FN-01` por la función, `REV-ACT-01` por la acción |
| Otro municipio, sin membresía, membresía inactiva, `consulta`, `anon` | `REV-FN-02` a `REV-FN-07`, `REV-FN-09`, `REV-API-01`, `REV-API-12`, `REV-ACT-04`, `REV-ACT-05`, `REV-ACT-06` |
| Update y delete | `REV-API-02`, `REV-API-03`, `REV-API-10` |
| Operador aprobando 3 o más | `REV-APR-01`, `REV-ACT-02` |
| Supervisor aprueba | `REV-APR-02`, `REV-ACT-02` |
| Operador legítimo con sugerencia, hash o versión falsificados, directo por la Data API | `REV-API-04`, `REV-API-05`, `REV-API-06`, `REV-API-07`. El rechazo tiene que ser `42501` por falta de privilegio, no una regla de datos |
| Recorrido por la acción de servidor | `REV-ACT-01`, `REV-ACT-02`, `REV-ACT-03` |
| Supervisor importando | `REV-IMP-01` |
| Autorreferencia en `supersedes` | `REV-SUP-01` a `REV-SUP-04` |
| JWT con rol definidor | `REV-JWT-01` |
| Omitir `p_cutoff_batch` (`PGRST202`) y corte viejo (`CUTOFF_CHANGED`) | `REV-CUT-01`, `REV-CUT-02`; variantes en `REV-CUT-03` a `REV-CUT-06` |
| `tp_operator` sin escrituras | `REV-TP-01` a `REV-TP-03` |
| `importador` e `importador_sistema` (ALIGN-003) | `REV-IMP-02` a `REV-IMP-09`, `REV-APR-03` |
| No leerse entre municipios | `REV-READ-01` a `REV-READ-06` |

Otros, del mismo tipo: claves de idempotencia que no reescriben (`REV-FN-11`, `REV-APR-08`, `REV-IMP-09`), intensidad 3 sugerida o sin lista de control (`REV-FN-12`), parámetros que no existen (`REV-FN-10`), usuario o municipio inactivo (`REV-FN-06`), proponente que después es supervisor (`REV-APR-07`), `service_role` (`REV-API-11`), credenciales cruzadas y auxiliares (`REV-JWT-02` a `REV-JWT-07`), origen ajeno (`REV-ACT-07`).

**Una decisión de lectura de los casos.** "Operador inserta en su tenant (OK)" es por la función de servidor o por la acción, porque directo por la Data API no tiene privilegio. El caso de operador legítimo del ticket exige justamente ese rechazo.

## Qué no cubre

- La campaña no reproduce las intercalaciones de importación: están en `tests/local-review/case-review-intercalaciones.http.ts`.
- No corre contra el proyecto de pruebas ni el original: esos destinos están prohibidos.
- `importador_sistema` no tiene pantallas porque no tiene cuenta de Auth (`REV-IMP-08`). El rechazo de la DAL para ese rol está en `tests/integration/server-dal.integration.test.ts`.
- Una cuenta con membresía en dos municipios lee los dos por la Data API, porque es miembro de ambos. Las pantallas se limitan al municipio elegido.
- Quien tenga el secreto JWT del proyecto puede firmar `service_role` o una credencial de servidor. La campaña prueba lo que esa credencial puede hacer, no protege el secreto.

## Ejecución verificada (02/11/2026)

Sobre la base local recién sembrada y `next start` del mismo commit: 75 de 75 aprobadas, 0 fallidas, 0 omitidas. La evidencia depurada está en `execution/evidence/ALIGN-022/` del paquete del plan, fuera de git.

Defectos reinyectados, ninguno aceptado:

- **Campaña y destino, 9 rechazados:** falta un caso, un caso omitido, un caso `todo`, URL del original y de testing, `project_ref` del original y de testing, referencia en una variable auxiliar y `http-base` remota. En los tres primeros Vitest sale con 0 y es el validador el que rechaza. En los seis de destino Vitest no llega a lanzarse.
- **Autorización en la base, 14 detectados:** inserción directa, update y delete de clientes, sin trigger append-only, operador que aprueba, supervisor que importa, `tp_operator` que registra, definidor asumible, RLS de lectura abierta, función con la sesión, motivo legible, corte sin verificar, autorreferencia sin verificar, membresía inactiva válida y `service_role` que escribe.
- **Aplicación, 2 detectados:** `tp_operator` con `decision:record` en la DAL y acción que acepta campos extra.

## Para reutilizar el runner

`database/testing/review_integration.py` es parametrizable: otra campaña agrega un `Campaign` a `CAMPAIGNS` (archivo de pruebas, configuración de Vitest, inventario exacto) y se elige con `--campaign`. Conserva los rechazos de destino, el inventario y la salida. Su configuración de Vitest debe tener `allowOnly: false` y `retry: 0`, y su carpeta tiene que entrar en el `exclude` de `vitest.config.ts`. Si la campaña no usa las cuentas de la revisión, hay que hacer `REQUIRED_ACCOUNTS` parte de `Campaign`. `test_review_integration.py` tiene las pruebas de código que atan el inventario al archivo de pruebas: conviene parametrizarlas igual.
