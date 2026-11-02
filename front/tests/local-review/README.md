# ALIGN-020: prueba real de las acciones de revisión

Las pruebas con cliente simulado están en `tests/integration/case-review-actions.integration.test.ts` y corren con los gates. Esta carpeta demuestra lo mismo contra la base local, con Auth, RLS, PostgREST y las funciones de ALIGN-018 reales. No entra en los gates porque necesita el stack y un turno. No se omite si falta configuración: falla antes de crear clientes, y solo acepta `http://127.0.0.1:54321`.

| Archivo | Qué hace |
| --- | --- |
| `fixture.sql` | Cartera sintética sobre las semillas de ALIGN-018: importes, personas compartidas, una relación inactiva, una cuenta `tp_operator` y una con dos membresías |
| `case-review-actions.local.ts` | Llama a las acciones con sesiones reales. Solo simula `next/headers` y `next/cache`. Verifica las filas con `psql` |
| `case-review-http.http.ts` | POST reales a `next start`: proxy, CSRF de Next, cookies y concurrencia |
| `probe/` | Página temporal que importa las acciones. **No se commitea en `app/`**: sin una página que las importe, Next no las compila y buscar en `.next/static` no probaría nada |
| `scan-client-bundle.mjs` | Busca la credencial en `.next/static` y publica solo conteos. Con `--expect-actions` exige los controles positivos |

## Procedimiento

Con `PATH` en npm 11.21.1 y el stack de `docs/tesis/entorno-aislado.md` levantado. Desde la raíz del worktree, salvo donde se indica:

1. `umask 077` y `mkdir /tmp/equitas-local-db/lock`. Si falla, esperar y reintentar. Liberar el turno con `rmdir` también si algo falla.
2. Preparar la base. Después del `db reset`, esperar 200 en `/auth/v1/health` y en `/rest/v1/role?select=id&limit=1` con la clave publicable (PostgREST puede dar 503 unos segundos).

   ```sh
   npx --yes supabase@2.108.0 db reset --local
   P() { docker exec -i supabase_db_equitas-tp-testing psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
   P -q -At -F '|' < database/testing/case-review-auth-fixtures.sql > /tmp/align020/credentials.psv
   P -q < database/testing/case-review-fixtures.sql
   P -q < front/tests/local-review/fixture.sql
   python3 -I database/testing/case_review_local.py mint-jwt --role equitas_review_server --hours 12
   python3 -I database/testing/case_review_local.py mint-jwt --role equitas_import_server --hours 12
   (cd front && node tests/local-review/prepare-config.mjs /tmp/align020/credentials.psv /tmp/align020/config.json)
   ```

3. Prueba con sesiones reales, desde `front/`:

   ```sh
   EQUITAS_REVIEW_LOCAL_CONFIG=/tmp/align020/config.json npx vitest run --config vitest.local-review.config.ts
   ```

4. Prueba por HTTP y bundle: repetir el paso 2, porque la suite exige una base recién sembrada. Desde `front/`, copiar `tests/local-review/probe/*` a `app/align020-probe/` y compilar con `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y `EQUITAS_REVIEW_SERVER_JWT` definidas, para que un inlining indebido aparezca en la búsqueda:

   ```sh
   npm run build
   EQUITAS_REVIEW_LOCAL_CONFIG=/tmp/align020/config.json node tests/local-review/scan-client-bundle.mjs --expect-actions
   npx next start --hostname 127.0.0.1 --port 31020 &
   EQUITAS_REVIEW_SUITE=http EQUITAS_REVIEW_HTTP_BASE=http://127.0.0.1:31020 EQUITAS_REVIEW_LOCAL_CONFIG=/tmp/align020/config.json npx vitest run --config vitest.local-review.config.ts
   ```

5. Detener `next start`, borrar `app/align020-probe/`, compilar de nuevo, `db reset --local` si corresponde y `rmdir /tmp/equitas-local-db/lock`. Borrar `/tmp/align020`.

## Para ALIGN-022

La campaña separada reutiliza `fixture.sql` y este recorrido para el caso "recorrido autorizado por la acción de servidor". El nombre de cada acción y su ID están en `.next/server/server-reference-manifest.json` (`exportedName`). El cuerpo del POST es `JSON.stringify([entrada])`, con `Next-Action: <id>` y `Accept: text/x-component`, y el resultado es la fila `1:` de la respuesta Flight.
