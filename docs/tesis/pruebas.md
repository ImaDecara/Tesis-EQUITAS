# Recorrido vertical V1 — ALIGN-029

`front/tests/smoke/thesis-flow-smoke.mjs` recorre Chromium contra **`next start` y Supabase local**. No usa respuestas simuladas ni páginas de sonda. SMOKE-01 y las doce pruebas E06 permanecen intactas y se ejecutan por separado. Solo acredita un recorrido técnico con datos sintéticos: **no demuestra utilidad municipal, aceptación ni impacto**. El catálogo de motivos y las reglas conservan sus límites y aprobaciones vigentes.

La fixture nueva parte del molde sintético `base-valido` de ALIGN-023; genera dos objetos `FLOW029-A/B`, cada uno con tres obligaciones de ARS 300.000, vencidas el 01/01/2024, y un contacto sintético cargado. Corte: 30/09/2026; total: ARS 1.800.000. Conforme a reglas 1.0.0, cada objeto suma 80 puntos (40 por importe, 30 por atraso, 10 por cantidad), por lo que pertenece a «Contacto y plan». No es un conjunto representativo del municipio. No se insertan perfiles ni eventos `VALIDADO`/`PUBLICADO` a mano: ambos proceden de `ETL.run_etl` después de ejecutar `ETL.validate_source`.

## Preparación y ejecución local

Requiere Node/npm fijados en `front/package.json`, dependencias por worktree (`npm ci --no-audit --no-fund`), Chromium de Playwright fijado y `back/.venv` con `requirements-dev.txt`/`constraints.txt`. La CLI autorizada es Supabase 2.108.0. Consultar también [entorno aislado](entorno-aislado.md).

1. Crear un directorio propio `/tmp/<nombre>` con modo 0700. Adquirir atómicamente `/tmp/equitas-local-db/lock` mediante `mkdir`. Escribir `owner.json` con `ticket: "ALIGN-029"`, hilo, PID del proceso propietario, fecha UTC, `nonce` único e `inode` del directorio. Si está ocupado, no retirarlo; esperar como máximo 900 s. Mantener ese propietario vivo durante toda la tanda.
2. Descubrir flags con `npx --yes supabase@2.108.0 db reset --help`; ejecutar `db reset --local` desde el worktree. No detener el stack. Esperar **Auth 200 y REST 200** usando las claves de `/tmp/equitas-local-db/supabase-local.env` sin imprimirlas. Solo se admite `http://127.0.0.1:54321`.
3. Con el cambio ya commiteado, ejecutar desde la raíz:

   ```sh
   back/.venv/bin/python front/tests/smoke/thesis-flow/prepare.py --private-dir /tmp/<nombre> --output <carga-nueva> --lock-owner <nonce>
   ```

   Crea `flow-config.json` privado (0600), dataset, reporte original del validador y `load.json` con comandos, códigos de salida, fecha, SHA, hashes del dataset/perfil/reglas, eventos reales y conciliación independiente. El validador se ejecuta sin credenciales; la carga usa la credencial de máquina en su entorno. Los logs crudos permanecen privados.
4. Compilar en `front/` con `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EQUITAS_REVIEW_SERVER_JWT` y `QUALITY_SOURCE_SHA` del commit. Leer las claves del archivo privado, sin argumentos ni salida de consola. Ejecutar `npm run build`, luego `npm run start -- --hostname 127.0.0.1 --port <puerto-alto-propio>` en un grupo propio, registrando PID/PGID. Esperar `/api/build-info`: SHA exacto, entorno local y referencia de proyecto nula. La referencia nula por sí sola no prueba loopback: el smoke también exige configuración local y bloquea cualquier solicitud de navegador fuera de los dos orígenes locales.
5. Con el mismo entorno, desde `front/`:

   ```sh
   npm run test:thesis-flow -- --base-url http://127.0.0.1:<puerto> --config-file /tmp/<nombre>/flow-config.json --load-evidence <carga-nueva> --output <recorrido-nuevo>
   ```

   Exige árbol limpio y antecedentes del mismo SHA. Produce `thesis-flow.json`, JUnit `thesis-flow.xml`, CSV y capturas posteriores al login, sin credenciales. No sobrescribe salidas anteriores. Cada uno de los 15 controles debe pasar; los no alcanzados son fallidos, nunca omitidos. Límite interno del navegador: 600 s; envolver cada comando y sus descendientes con un máximo de 1800 s.

   Un fallo del CSV se conserva como fallido y mantiene exit 1, pero permite ejecutar logout y vencimiento, que son independientes. El archivo recibido se guarda antes de validarlo, junto con sus metadatos y totales observados, para reproducir discrepancias sin fabricar un CSV corregido.
6. En `finally`, detener exclusivamente el PGID propio, esperar su salida y liberar solo el `owner.json`/directorio cuyo nonce, contenido e inode coincidan. No borrar locks ajenos ni detener contenedores. El siguiente usuario de la base debe resetearla: quedan únicamente los datos sintéticos declarados. Eliminar la configuración y logs privados cuando se haya conservado evidencia depurada.

## Comprobaciones

El recorrido exige: login operador; selección de cola y acceso al detalle; hechos antes de sugerencia, vulnerabilidad no informada, explicación, severidad y corte; rechazo sin motivo y sin checklist **sin POST ni filas nuevas**; `MODIFICA` de intensidad 3 con motivo; persistencia tras recarga; segundo login con `auth_user` diferente; rechazo de aprobación sin checklist; aprobación y persistencia, con actores distintos verificados en SQL; CSV con corte, reglas, filtros, definiciones y totales conciliados con la carga; filtro CSV desconocido rechazado; logout y acceso directo a cartera/CSV denegado para ambas identidades; sesión vencida; cero errores JavaScript o de consola.

El vencimiento usa una sesión obtenida mediante login real. Revoca el refresh mediante Auth real, firma en el setup un JWT de esa identidad con vida de dos segundos usando **solo el secreto local**, espera que expire y presenta esa cookie a las rutas reales. Repone la cookie vencida antes de cada solicitud, para que la primera denegación no convierta las siguientes en casos meramente anónimos. No simula respuestas ni espera una hora. Comprueba el rechazo al vencer sin renovación disponible; no acredita la renovación automática ni un proveedor remoto.

Los controles del propio lector se ejecutan con `node --test tests/smoke/thesis-flow/contracts.test.mjs`. Para probar sensibilidad, sobre copias temporales de evidencia real se alteran SHA, dataset, reporte de validación, reglas o cadena de eventos, y se exige rechazo de `loadEvidence`; también se quitan filas o se alteran importes/metadatos del CSV y se exige rechazo de `assertCsv`. Estas pruebas negativas no son corridas del producto ni reemplazan el recorrido real.

Además de los gates oficiales sobre el commit entregado, correr la campaña original de ALIGN-022 con `database/testing/review_integration.py run` y `validate --sha <SHA>`, y E06/SMOKE-01 con la adaptación local temporal documentada en la evidencia de ALIGN-019. Cada campaña requiere su propio reset/fixture. Si 022 requiere la sonda temporal de ALIGN-020, compilarla solo para esa campaña, retirarla antes de verificar árbol limpio y reconstruir sin sonda al terminar. No es parte del smoke vertical ni una ruta permanente.
