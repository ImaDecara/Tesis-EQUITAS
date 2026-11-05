# ALIGN-069: prueba real de la auditoría

Las pruebas con transporte simulado están en `tests/integration/access-audit.integration.test.ts` y corren con los gates. Esta carpeta prueba lo mismo con `next start`, Auth, RLS y PostgREST reales. No entra en los gates porque necesita el stack y un turno. Solo acepta `127.0.0.1`.

`run-audit.mjs` cubre: un registro por ficha entregada (HTML, RSC y clic en Chromium), ninguno en prefetch, listado ni denegaciones; un registro por exportación GET y ninguno por HEAD en los cinco reportes, conservando los rechazos sin sesión o permiso; el reporte contra la tabla, fila por fila; lectura por municipio y por rol; escritura, edición y borrado directos rechazados por la Data API y por el dueño de la tabla; validación e idempotencia de la función; lote `VALIDADO`, analítica y canal (057, 064, 066); la limitación declarada de las lecturas directas, y la falla cerrada con la aplicación sin credencial. HEAD no necesita la credencial de escritura porque solo devuelve metadatos después de autorizar, sin leer ni entregar el CSV.

HEAD a una ficha termina en el proxy con 405 y `Allow: GET`, antes del render que registra la apertura; una sesión ausente conserva el 307 a login. Se prueba con consulta, operador y supervisor, HTML, RSC, prefetch y la pestaña de revisión, además de los controles de objeto ajeno, inexistente, importador y listado. Todos los casos HEAD, incluidos los cinco reportes, comparan el conteo inmediato y el posterior a una espera de dos segundos: Next puede terminar la respuesta HEAD antes de completar el render, por lo que contar solo al recibirla daba un falso negativo. Los GET de ficha y reporte siguen como controles positivos de un solo registro.

## Procedimiento

Con `PATH` en npm 11.21.1 y el stack de `docs/tesis/entorno-aislado.md` levantado, desde la raíz del worktree:

1. Compilar sin el turno, desde `front/`, con `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` locales: `npm run build`.
2. `umask 077` y `mkdir /tmp/equitas-local-db/lock`. Si falla, esperar y reintentar. Liberar con `rmdir` también si algo falla.
3. `npx --yes supabase@2.108.0 db reset --local`. Esperar 200 en `/auth/v1/health` y en `/rest/v1/role?select=id&limit=1` con la clave publicable.
4. Cargar las cuentas y los datos, en este orden (`create-auth-fixtures.sql` exige Auth vacío), y emitir las credenciales de servidor:

   ```sh
   P() { docker exec -i supabase_db_equitas-tp-testing psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
   mkdir /tmp/align069-local
   P -q -At -F '|' < database/testing/create-auth-fixtures.sql | awk -F'|' '{print "tp-e06-" $1 "|" $3 "|" $4}' > /tmp/align069-local/credentials.psv
   P -q < database/testing/fixtures.sql
   P -q -At -F '|' < database/testing/case-review-auth-fixtures.sql >> /tmp/align069-local/credentials.psv
   P -q < database/testing/case-review-fixtures.sql
   P -q < front/tests/local-reports/fixture.sql
   python3 -I database/testing/case_review_local.py mint-jwt --role equitas_review_server --hours 12
   python3 -I database/testing/case_review_local.py mint-jwt --role equitas_import_server --hours 12
   ```

5. Desde `front/`, levantar dos `next start` en puertos propios, con las mismas variables: uno con `EQUITAS_REVIEW_SERVER_JWT` y otro **sin** ella, para la falla cerrada. Ejecutar:

   ```sh
   node tests/local-audit/run-audit.mjs /tmp/align069-local/credentials.psv http://127.0.0.1:31069 http://127.0.0.1:31070 /tmp/align069-local/resultado.json
   ```

   Termina en `FALLAS|0` y sale con error si un caso falla.

6. Detener los servidores y `rmdir /tmp/equitas-local-db/lock`. Las contraseñas y los JWT no salen de `/tmp`.
