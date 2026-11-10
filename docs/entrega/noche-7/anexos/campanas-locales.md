# Campañas contra una base real local (noche 7)

Qué se ejecutó, sobre qué commit, en qué entorno y con qué resultado. Sin contraseñas ni claves: quedan en la carpeta privada del proyecto de campañas (`~/.equitas-n7-campanas`, modo 0700), fuera de Git.

## Entorno

- **Commit probado:** `b086a72ae7a459ba8e9c9a135e4a1124f1b3356d` (rama `delivery/noche-7-entrega`). La aplicación se compiló con `next build` desde una copia `git archive HEAD` (lo confirmado, no el árbol de trabajo) y `/api/build-info` devolvió ese SHA, `environment = local` y ningún proyecto remoto.
- **Base:** proyecto Supabase local propio y descartable `equitas-n7-campanas` (API 57321, base 57322), recreado desde cero al empezar cada campaña y cada tanda (`supabase stop --no-backup` + `start`), con las 16 migraciones del commit.
- **Aplicación:** `next start` en `127.0.0.1:3170`, desde la copia.
- **Herramientas de campaña:** las de este encargo, todavía sin confirmar en el árbol de trabajo. Cada resultado guarda la huella de su estado (`tools_diff_sha256`, en la corrida final `94398586055209e6…`).
- **Remoto:** ningún contacto. Las demás bases locales (`equitas-tp-testing`, `equitas-n7-local`, `equitas-n7-espejo`) no se tocaron y el script se niega a operar sobre ellas.
- **Comando:** `back/.venv/bin/python scripts/campanas/equitas_campanas.py todas`. Hay un comando por campaña: `reportes`, `e06`, `decisiones`, `revision`, `importacion [--tandas …]`, `control-etl` y `detener`. Al terminar se detienen Next y el proyecto.

## Corridas posteriores, sobre los commits finales

Después de la corrida de abajo se corrigieron los dos hallazgos que dejó (la cartera oculta sin lote publicado y las nueve fallas del cargador) y se volvió a correr:

| Corrida | Commit | Resultado |
| --- | --- | --- |
| Todas las campañas (`equitas_campanas.py todas`) | `aa4884a` | Reportes 1235 comprobaciones y 0 fallas; E06 12 de 12; SMOKE-01 5 de 5 **con las fixtures intactas**; decisiones 393 y 161 sin fallas, 55 del ejecutor; revisión 75 de 75; importación 272 pruebas y 0 fallas (cargador y publicación: 92 de 92) |
| Reportes y E06/SMOKE-01, después de las correcciones posteriores a la prueba final | `1923260` | Reportes 1235 comprobaciones y 0 fallas, 118 solicitudes; E06 12 de 12; SMOKE-01 5 de 5 |

Evidencia: `20261110T183246Z-reportes`, `…183335Z-e06`, `…183413Z-decisiones`, `…183443Z-revision`, `…183541Z-importacion`, `20261110T195317Z-reportes` y `…195409Z-e06`.

## Resultados (primera corrida completa, 10/11/2026, sobre `b086a72`)

| Campaña | Resultado |
| --- | --- |
| 1. Reportes por HTTP (028), **obligatoria** | **1235 comprobaciones, 0 fallas**, 118 solicitudes. Sin las cuatro fallas viejas |
| 2. E06, adaptación local declarada | **12 de 12 pruebas, 0 fallas, 0 omitidas** |
| 2. SMOKE-01 con las fixtures E06 intactas | **Falla** (2 de 5 comprobaciones): hallazgo del producto, ver abajo |
| 2. SMOKE-01, variante diagnóstica con un lote publicado | 5 de 5 comprobaciones aprobadas, sin errores de consola |
| 3. Decisiones: `case-review-checks.sql` | **393 casos, 0 fallas** (48 traducidos o nuevos, marcados «N7:») |
| 3. Decisiones: `case-review-verify.sql` | 45 filas; los 35 esperados documentados coinciden (0 distintos) |
| 3. Decisiones: `case_review_local.py http-check` | **161 casos, 0 fallas** |
| 3. Decisiones: `test_review_integration.py` (runner) | 55 pruebas, todas en verde |
| 4. Revisión por HTTP (022) | **75 de 75 aprobados, 0 fallidos, 0 omitidos**; el validador dio APROBADO |
| 5. Importación: carga directa `POST /imports/load` (nueva) | **7 de 7** |
| 5. Importación: `test_imports_api.py` | **93 de 93** |
| 5. Importación: `test_next_route.py` | **26 de 26** |
| 5. Importación: `test_etl_v1_load.py` + `test_import_publish.py` | 80 de 89 en esa corrida, con 9 fallas en `test_etl_v1_load.py`. **Resueltas después: 92 de 92** (ver abajo) |
| 5. Importación: `test_import_stage_retry.py` | 3 de 3 |
| 5. Importación: `test_prevalidate.py` | 49 de 49 |
| 5. Importación: `test_import_lock_budget.py` | 2 de 2 |

Antes de la corrida final, las mismas campañas ya se habían ejecutado sobre commits anteriores de la rama, con estos resultados: reportes 1235/0 en `374c777`; decisiones 393/0 y 161/0 en `b374d33`; revisión 75/75 en `c5c83dc`; importación con los mismos conteos en `c5c83dc`.

### 1. Reportes (028)

- Las cuatro fallas viejas de la noche 6 (908 de 912) ya no aparecen. `fecha_corte` y `fecha_cartera` toman la fecha del lote publicado (`2026-10-15`) y `fecha_calculo_usada` vale `NO_APLICA`. Con `?risk=ALTO` la pantalla muestra «No disponible», así que el CSV responde 422 `SELECCION_INCOMPLETA` (comprobado en la respuesta).
- Supuestos de quien rehízo los reportes, todos comprobados:
  - (a) Las cuentas de fixture admiten `update tenant_user.role`, y `role_name_key` existe.
  - (b) El extractor de `data-total` encuentra el contador en las 8 consultas («8 casos», «2 casos», «No disponible», …).
  - (c) La cantidad de obligaciones del reporte incluye las pagadas: «cola obligaciones = SQL» compara contra `count(*)` de todas las deudas.
- Cambios a la campaña al ejecutarla:
  - `run-http.mjs` acepta el destino local propio (`EQUITAS_LOCAL_DIR`, `EQUITAS_LOCAL_API_URL`). Antes estaba fijado a `/tmp/equitas-local-db` y al puerto 54321, que son de la demo de la noche 6.
  - La cuenta `importador` pasa a ser ADMIN, como pide el encargo: `verify_reports.py` espera los cinco reportes para esa cuenta, donde antes esperaba 403 en todo.

### 2. E06 y SMOKE-01: adaptación local declarada (encargo 10.7)

Corren los mismos 12 casos de `front/tests/external` (los que ejecuta `quality/supabase_integration.py`) y SMOKE-01, en una carpeta temporal. Los archivos de prueba de E06 y la política se tomaron tal cual de `HEAD`. La copia temporal de `quality/supabase-testing.json` solo cambia `url` y `project_ref` hacia el proyecto propio. `quality/supabase_integration.py`, `quality/supabase-testing.json` y `database/testing/fixtures.sql` no se modificaron. **Esta comprobación no reemplaza la campaña remota.**

- SMOKE-01 (`front/tests/smoke/deployed-smoke.mjs`) se actualizó a los textos actuales: Tablero, Casos, Personas, Correo, Contraseña, «Iniciar sesión», «Cerrar sesión», «No se pudieron leer algunos datos» y «No hay casos que cumplan los filtros elegidos.». Siguen siendo las mismas cinco comprobaciones. También se acotaron dos localizadores que hoy encuentran dos elementos: `.first()` en «Total registrado» y `level: 1` en el encabezado «Personas».
- **Hallazgo del producto, corregido después de esta corrida.** Una cartera que existe sin ningún lote publicado ya no se oculta: se muestra con la fecha del día y la línea de contexto lo dice («Sin fecha de cartera registrada…»). «Sin cartera cargada» queda solo para el municipio que no tiene ningún caso (`front/lib/server/viewer-context.ts`, `portfolioWithoutBatch`; pruebas en `front/tests/integration/base-level.integration.test.ts`). Descripción original: Con las fixtures E06 intactas hay un objeto y una deuda de $ 1.250 en «TP E06 A», pero ningún lote `PUBLICADO`. La aplicación muestra «Tu municipio todavía no tiene una cartera cargada» y oculta esos datos. La causa está en `front/lib/server/viewer-context.ts:69-70`: sin lote publicado vigente, el estado de la cartera es `EMPTY`, y `NoPortfolioCard` reemplaza el tablero y los listados. La captura está en la evidencia privada (`…-e06/smoke01/failure.png`). La variante con un único lote `PUBLICADO` sintético pasa las 5 comprobaciones, así que el resto del recorrido funciona.
  - Por qué importa: según el encargo (4.1), ADMIN y USER deben leer lo mismo que en `main`, y en `main` esos datos se ven. Una base con cartera cargada por otra vía (como la original, sin `import_batch`) se mostraría vacía. **Decisión pendiente:** mostrar la cartera existente sin lote publicado o declarar este comportamiento.

### 3. Decisiones (SQL y HTTP)

`case-review-fixtures.sql` define el catálogo como `920001 USER`, `920002 ADMIN` y `920005 importador_sistema`. Las etiquetas de las cuentas se conservan como nombres:

| Cuenta | Rol |
| --- | --- |
| consulta | USER |
| operador, supervisor, importador | ADMIN |
| inactivo | ADMIN, con la membresía inactiva |
| otro-operador, otro-supervisor | ADMIN en el municipio B |

Así quien propone y quien aprueba son dos cuentas ADMIN distintas. `APPROVER_IS_PROPONENT` se conserva y se refuerza: quien propuso no aprueba ni objeta, tampoco una versión posterior de su propuesta (toda la cadena de reemplazos), y otra cuenta ADMIN fuera de la cadena sí aprueba. Además, los nombres de rol anteriores (`consulta`, `operador`, `supervisor`, `importador`) y las variantes `admin`, `Admin` y `ADMIN ` no registran, no aprueban, no leen el motivo y no importan.

### 4. Revisión por HTTP (022)

Se corrió con el runner `database/testing/review_integration.py`, sobre una copia compilada con la sonda de ALIGN-020 (solo en la copia, nunca en `front/app`). Dos adaptaciones, declaradas:

1. Los archivos de campaña de este encargo, todavía sin confirmar, se superponen a la copia de `HEAD`. Sus huellas quedan en `results.json`.
2. El runner exige un árbol limpio. En la copia, un `git` mínimo responde el SHA real y un estado vacío.

Cuando estos archivos se confirmen, conviene repetir la 022 con el árbol limpio real.

### 5. Importación contra base real

- Nueva prueba: `back/tests_real/test_import_load_real.py`, con su semilla `load-fixtures.sql` (un municipio sin cartera, una cuenta ADMIN y una USER, cada una con una sola membresía). Comprueba:
  - USER recibe 403 y nada cambia.
  - El lote 1 queda `PUBLICADO`, con 19 objetos y $ 11.856.000 de total registrado, como dice el manifiesto.
  - El mismo lote otra vez da `YA_CARGADO`, sin eventos nuevos.
  - El lote 2 da `RECHAZADO` y la fecha sigue siendo 30/09.
  - Dos envíos simultáneos del lote 3 publican un solo lote.
  - Un intento cerrado (falla sintética al publicar, con un trigger temporal de la prueba) da `REQUIERE_CONFIRMACION` con su revisión; el reintento con esa revisión da `PUBLICADO`.
  - USER vuelve a recibir 403.
  - Una vez publicada la primera cartera, `equitas_current_cutoff` no queda nula en ningún paso.
- `test_next_route.py` compila su propia copia (`EQUITAS_E2E_FRONT`) con Turbopack (`EQUITAS_E2E_WEBPACK=0`). **Observación:** la compilación con `--webpack` (la que usaba el fixture) falla en el chequeo de tipos de `.next/types` en `/`, `/recommended-actions` y `/risk-analysis` (TS2344, `searchParams` opcional no satisface `PageProps`). El build por defecto (Turbopack), que es el que se entrega, compila sin errores.
- **Las 9 fallas de `test_etl_v1_load.py`, resueltas.** Seis pruebas esperaban las reglas 1.0.0 (la mora decidida por la clave `OVERDUE` y el subtotal anulado por un estado no observado). Con las reglas 1.1.0 la mora es por calendario sobre las no pagadas, y el subtotal lo anula solo una obligación no evaluable. Esas seis expectativas se actualizaron a 1.1.0, con el cálculo a la vista en cada una, y se agregaron tres casos (sin estado pero evaluable, pagadas fuera del cálculo, vencida de importe cero). Las otras tres fallaban **en cascada**: una de las primeras se cortaba antes de restaurar el lote original y dejaba la base modificada para las siguientes; no eran un defecto del producto. Nueva corrida de la tanda contra la base real, el 10/11/2026 sobre `dea5bb6` más estos cambios: **92 de 92, 0 fallas** (`~/.equitas-n7-campanas/evidencia/20261110T182732Z-importacion/`). Lo que sigue es el análisis original, que se conserva.
- **Análisis original de las 9 fallas (ALIGN-027).** No son de roles: todas tratan el perfil persistido. El mismo archivo de pruebas, que no cambió desde `f0fb8f8`, da 52 de 53 sobre `f0fb8f8` (control negativo `control-etl`; la única falla es propia del control: la copia no es un repositorio git). Las fallas aparecen con las reglas 1.1.0: la migración `20261110120000_debtor_profile_rules_1_1` calcula la mora por calendario sobre las no pagadas, la clave `OVERDUE` ya no decide, y la regla del nulo pasa del «estado no observado» a la «obligación no evaluable». `back/tests/oracle_lots.py` ya se migró a 1.1.0; estas expectativas en línea, no.
  - Expectativas 1.0.0 explícitas (6 pruebas):
    - `test_el_perfil_de_cada_objeto_es_la_suma_de_sus_deudas` (`:451`)
    - `test_con_estados_faltantes_y_sin_vencidas…` («Regla 2 de §4.1»)
    - `test_cada_regla_del_perfil…[faltantes-sin-vencidas-nulos]` y `…[faltantes-con-vencidas-subtotal]`
    - `test_un_estado_nulo_tampoco_esta_observado…`
    - `test_reclasificacion_sql_respeta_estados_faltantes…`
  - Duda, sin cerrar (3 pruebas): `test_carga_parcial_no_altera_perfiles_ajenos` (`:833`, deudas `[1,2,3]` reescritas donde se esperaba `[1]`), `test_dar_de_baja_una_relacion…` (`:871`, perfil `1` y deuda `1` de más) y `test_un_contacto_ausente…` (`:911`, persona, perfil y detalle reescritos sin baja pedida). Pueden ser el recálculo previsto de 1.1.0, una reescritura innecesaria del producto, o un arrastre de las fallas anteriores (las pruebas corren en orden). No las corregí ni ajusté sus expectativas.

## Aserciones traducidas a la matriz vigente

Ninguna aserción de seguridad se quitó. Donde la distinción ya no existe, se prueba la regla vigente y, además, que el nombre de rol anterior ya no otorga nada.

- **`database/testing/case-review-checks.sql`.** «supervisor/importador no registran» pasa a «ADMIN registra» (`:215-217`). «operador no aprueba» pasa a `APPROVER_IS_PROPONENT` (`:308-322`). La cadena de reemplazos queda reforzada (`:330-332`). «supervisor/operador no importan» pasa a «ADMIN importa; USER no» (`:373-390`). La membresía por municipio no se hereda (`:379-387`). «importador no lee el motivo» pasa a «ADMIN lo lee» (`:465-466`). Bloque nuevo de nombres anteriores (`:474-479`). Ciclo con proponente ADMIN (`:661`). Rol fijado por el servidor: `ADMIN` en lugar de `operador` o `supervisor`.
- **`database/testing/case_review_local.py`.** El operador que aprueba lo suyo recibe `APPROVER_IS_PROPONENT` (`:281`). USER no aprueba ni lee el motivo. «supervisor/operador sin permiso de importación» pasa a USER, y las cuentas ADMIN registran (`:344-349`). Los lotes esperados pasan de 7 a 9 (`:361`).
- **`front/tests/external-review/case-review.integration.test.ts`** (mismos 75 identificadores): REV-ENV-01 (también exige la migración `20261110100000` y los roles ADMIN, USER, importador_sistema y tp_operator), REV-FN-01, REV-FN-08 (`:155`), REV-APR-01 (`:314`), REV-APR-02, REV-APR-03 (`:329`), REV-APR-07 (`:369`, cadena), REV-IMP-01 (`:549`), REV-IMP-02, REV-IMP-04 (`:575`), REV-IMP-05 (`:591`), REV-IMP-07 (`:611`), REV-ACT-01, REV-ACT-02 (`:760`, el operador recibe `APPROVER_IS_PROPONENT` en lugar de `ROLE_FORBIDDEN`) y REV-ACT-04 (`:781`, la cuenta supervisor pasa el permiso).
- **`back/tests_real/test_imports_api.py`.** El 403 sin rol lo recibe solo `consulta` (`:219`). Nuevas: `test_previous_role_names_do_not_import_or_read` (`:234`) y `test_admin_accounts_import` (`:252`). Rol `ADMIN` y versión de reglas vigente `1.1.0` en el lote recibido (`:287`; antes `importador` y `1.0.0`). **`test_importer_does_not_read_the_portfolio` pasa a `test_importer_reads_the_portfolio`** (`:385`, 200, solo su municipio).
- **`back/tests_real/test_prevalidate.py`.** El 403 por rol pasa de `operador` a `consulta` (`:157`).
- **`back/tests_real/test_next_route.py`.** El 403 sin rol queda solo para `consulta` (`:115`).
- **`back/tests_real/test_import_publish.py`.** Los roles que crea pasan a ADMIN y USER (`:435`): `operador` = USER sigue recibiendo `ROLE_NOT_ALLOWED`.
- **`front/tests/local-reports/verify_reports.py`.** `importador` recibe los cinco reportes.

## Lo que no se ejecutó

- `tests_real/test_import_publish_scale.py` y `tests_real/test_prevalidate_scale.py` (tanda `escala`, de larga duración). Se pueden correr con `importacion --tandas escala`.
- Punto 6, por falta de margen. Esto es lo que habría que cambiar:
  - `front/tests/local-dal/fixture.sql:11` (roles `consulta` y `supervisor`) y `local-dal/config.ts:16,24` (`/tmp` y puerto 54321 fijos).
  - `front/tests/local-audit/run-audit.mjs:12-36`: destino, contenedor `equitas-tp-testing` fijo y 59 menciones de roles anteriores.
  - `front/tests/smoke/thesis-flow/prepare.py:20-21,87-95` y `thesis-flow/contracts.mjs:25`: destino y contenedor fijos.
  - Textos viejos en `analytics-a11y.mjs:37-44`, `demo-local-walkthrough.mjs` (83 menciones de roles; «Iniciar sesion», «Dashboard ejecutivo», «Objetos de deuda») y `review-a11y.mjs` (56), y roles en `thesis-flow-smoke.mjs` (21).
  - `n7-local-walkthrough.mjs` es del coordinador: no se tocó ni se ejecutó.
- La 022 con el árbol limpio real (ver la sección 4) y la campaña remota E06, que no es trabajo de esta noche.

## Evidencia

En `~/.equitas-n7-campanas/evidencia/<fecha>-<campaña>/` (privada, 0700). Hay un `results.json` por campaña con el SHA, la huella de las herramientas, cada comando y su código de salida, y los conteos, más los registros saneados de cada paso. Las respuestas HTTP, las credenciales y los volcados de psql quedan en el subdirectorio `privado/`. Corrida final: `20261110T143030Z-reportes`, `…143115Z-e06`, `…143219Z-decisiones`, `…143249Z-revision` y `…143346Z-importacion`. Control negativo: `20261110T142728Z-control-etl`.
