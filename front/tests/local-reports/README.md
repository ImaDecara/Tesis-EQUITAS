# ALIGN-028: prueba real de los reportes CSV

Las pruebas con transporte simulado están en `tests/integration/reports.integration.test.ts` y corren con los gates. Esta carpeta prueba lo mismo con `next start`, Auth, RLS y PostgREST reales. No entra en los gates porque necesita el stack y un turno. Solo acepta `127.0.0.1`.

| Archivo | Qué hace |
| --- | --- |
| `fixture.sql` | Cartera y revisiones sintéticas sobre las semillas de ALIGN-018, con celdas hostiles y un segundo municipio marcado |
| `expected.sql` | Calcula con SQL, sin la aplicación, lo que deben decir los reportes |
| `run-http.mjs` | Inicia sesiones reales y guarda cada respuesta, también las de las pantallas |
| `verify_reports.py` | Compara con el módulo `csv` de Python: autorización, formato, conciliación con SQL y con las pantallas, ausencia de datos personales y de otro municipio |

## Procedimiento

Con `PATH` en npm 11.21.1 y el stack de `docs/tesis/entorno-aislado.md` levantado, desde la raíz del worktree:

1. Compilar sin el turno, desde `front/`, con `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` locales: `npm run build`.
2. `umask 077` y `mkdir /tmp/equitas-local-db/lock`. Si falla, esperar y reintentar. Liberar con `rmdir` también si algo falla.
3. `npx --yes supabase@2.108.0 db reset --local`. Esperar 200 en `/auth/v1/health` y en `/rest/v1/role?select=id&limit=1` con la clave publicable.
4. Cargar las cuentas y los datos, en este orden (`create-auth-fixtures.sql` exige Auth vacío):

   ```sh
   P() { docker exec -i supabase_db_equitas-tp-testing psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
   mkdir /tmp/align028
   P -q -At -F '|' < database/testing/create-auth-fixtures.sql | awk -F'|' '{print "tp-e06-" $1 "|" $3 "|" $4}' > /tmp/align028/credentials.psv
   P -q < database/testing/fixtures.sql
   P -q -At -F '|' < database/testing/case-review-auth-fixtures.sql >> /tmp/align028/credentials.psv
   P -q < database/testing/case-review-fixtures.sql
   P -q < front/tests/local-reports/fixture.sql
   P -q -At < front/tests/local-reports/expected.sql > /tmp/align028/expected.json
   ```

5. Desde `front/`, levantar `next start` en un puerto propio, con las mismas variables, y ejecutar:

   ```sh
   node tests/local-reports/run-http.mjs /tmp/align028/credentials.psv http://127.0.0.1:31028 /tmp/align028/http
   python3 -I tests/local-reports/verify_reports.py /tmp/align028/http /tmp/align028/expected.json
   ```

6. Detener el servidor y `rmdir /tmp/equitas-local-db/lock`. Las contraseñas no salen de `/tmp` y no se publican.
