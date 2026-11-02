# ALIGN-019: prueba directa local

El 30/10 el orquestador autorizó el uso exclusivo temporal del stack mediante lock.
Los resultados definitivos y los gates (`evidence-ciclo1.json`, `criterios-ciclo1.md`)
están en `execution/evidence/ALIGN-019/` del paquete externo del plan.
Esta suite es independiente de Vitest: usa Auth, REST y HTTP HTML/RSC reales.
No se omite si falta configuración: falla antes de arrancar Next o crear clientes.
No inicia, detiene ni resetea Supabase. No se agrega a los gates sin base.

Procedimiento autorizado (solo cuando el stack esté disponible):

1. Ejecutar `umask 077` y tomar `mkdir /tmp/equitas-local-db/lock`. Si falla, esperar
   un minuto en primer plano y reintentar. Seguir `docs/tesis/entorno-aislado.md`;
   desde este worktree, `npx --yes supabase@2.108.0 db reset --local --version
   20261021220156` prepara la primera migración (`USING(true)`). Nunca usar remoto.
   Instalar desde el comienzo un `finally`/trap que restaure el esquema y libere
   el lock incluso si una prueba falla.
2. Provisionar cinco cuentas Auth sintéticas `a`, `b`, `none`, `inactive`, `multi`,
   todas con email `@example.test`, usando el procedimiento e06 autorizado de
   `database/testing/create-auth-fixtures.sql` y añadiendo `multi` a su array de
   etiquetas en una copia temporal. PostgreSQL genera las contraseñas aleatorias;
   capturar su salida exclusivamente en memoria o un archivo privado en `/tmp`.
   Guardar sus credenciales y clave **publicable o anon** en un JSON privado
   `/tmp/equitas-align019/config.json`, modo 0600 y carpeta 0700. No usar service role.
   Formato: `{ "supabaseUrl": "http://127.0.0.1:54321", "publishableKey": "…",
   "accounts": { "a": { "email": "…@example.test", "password": "…" }, … } }`.
3. Aplicar `fixture.sql` mediante el `psql` del contenedor local, con `ON_ERROR_STOP=1`
   y las cinco variables `auth_a`, `auth_b`, `auth_none`, `auth_inactive`, `auth_multi`
   (los UUID verificados de esas cuentas). Requiere base vacía; no es idempotente.
   No aplicar desde una conexión remota ni reutilizar datos de otro ticket.
4. Desde `front/`, ejecutar:

   ```sh
   EQUITAS_DAL_LOCAL_CONFIG=/tmp/equitas-align019/config.json npm exec --no -- playwright test --config playwright.dal.config.ts
   ```

   Playwright compila y arranca Next en modo producción exclusivamente en
   `127.0.0.1:31019` y lo cierra al terminar.
   El SDK usa la clave publicable y las sesiones ordinarias; no hay mocks ni cookies
   inventadas. No se guardan storage state, trazas, capturas ni tokens en reportes.
   La primera prueba exige que REST entregue ambos objetos al usuario sin membresía:
   acredita que la política permisiva está presente y evita un falso verde por RLS.
5. Ejecutar también `npm run test:integration`.
   Ese comando existente sigue siendo la suite simulada; la prueba real es la del
   paso anterior. `test:coverage` incluye las integraciones simuladas, sin base.
6. Antes de liberar, ejecutar `npx --yes supabase@2.108.0 db reset --local` desde este
   worktree (las tres migraciones). Eliminar credenciales temporales, ejecutar
   `rmdir /tmp/equitas-local-db/lock` y conservar solo evidencia depurada. No usar
   `stop`; no imprimir las claves de `supabase-local.env`.

Cobertura escrita: nueve rutas, HTML y RSC sin JavaScript. El anónimo recibe 307 a
`/login?next=<ruta>`; sin membresía, usuario inactivo y membresías múltiples sin
selección reciben 200 con denegación y sin cartera. Controles positivos A/B con
detalle propio, contactos y riesgo de una persona compartida; selección explícita
A/B; cookie de tenant ajeno; detalle ajeno; personas separadas por municipio;
`next` y cabeceras que intentan llevar a otro host.
Los controles positivos rechazan también los avisos de error de lectura, para
evitar que un join PostgREST roto produzca un verde con datos parciales.
