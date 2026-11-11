# Despliegue y reversión

Análisis de código del 11/11/2026. Referencia estable anterior: `main = origin/main = 36f35b4`, publicada en `https://tesis-equitas.vercel.app`. Esta implementación no hizo push, merge, PR, despliegue ni cambios de base.

## Efectos de cada push

| Evento | GitHub Actions | Integración Git de Vercel |
| --- | --- | --- |
| Push a `delivery/entrega-final` | Frontend, backend y resumen/gates. El job Supabase no corre. | Preview de esa rama. |
| PR hacia `main` | Frontend, backend y resumen/gates. El job Supabase no corre en el evento PR. | Preview asociado a la rama, según la integración. |
| Push a `main` | Frontend, backend, **Supabase real obligatorio** y resumen que exige ese resultado. | Production. |
| Push a `quality/tp-testing` | También Supabase real; luego `preview-smoke.yml`, que exige CI correcto y SHA exacto. | Preview con las variables específicas de testing conocidas para esa rama. |

`workflow_dispatch` de calidad también exige Supabase en `main` y `quality/tp-testing`. `load-tests.yml` corre por push solamente en `quality/e08-rendimiento` con sus rutas declaradas, o manualmente: usa una API aislada local, no Supabase remoto. No hay pasos que apliquen migraciones o seeds remotos en estos workflows. El smoke incluye login/logout de testing.

Vercel despliega por su integración Git, **independientemente de que CI haya terminado o aprobado**. No hay protección de rama ni ruleset que imponga ese orden según la comprobación aportada por coordinación. No confundir el gate del smoke con una barrera del despliegue Production.

## El job Supabase no es de solo lectura

`quality/supabase_integration.py` ejecuta las 12 variantes de `front/tests/external/supabase.integration.test.ts` usando `SUPABASE_TEST_CONFIG`. La URL está restringida al proyecto de testing `iylwghgvtydpmwidojdo`, con clave publicable y usuarios ordinarios. **SUP-WRITE-01 emite INSERT, UPDATE y DELETE contra `debtor` y espera `42501`.** Son intentos de escritura remota aunque las políticas los rechacen. También hay login, login negativo y logout de Auth. Si los permisos de testing cambiaran, esas operaciones podrían escribir.

No se ejecutó ese job ni se tocó testing en esta tarea. No se lo desactivó, omitió ni cambió para ocultar esos efectos. Por lo tanto, un push a `main` tiene este efecto adicional que coordinación debe resolver con la autorización correspondiente antes de hacerlo; no cumple una prohibición absoluta de intentos de escritura en testing.

Revisión estática de compatibilidad: `validateAuthUserTenantAccess` sigue exportado y delega en `resolveTenantAccess`; conserva el formato de contexto y el rol sintético `tp_operator` de E06, solo para lectura. `loadAllTableRows(table, sdk)` conserva el camino por cursor, sin alcance opcional; la nueva paginación solo se activa explícitamente desde la DAL municipal. No se encontró una incompatibilidad de firmas/comportamiento que obligue a modificar el job. **Esto no demuestra que sus 12 pruebas vayan a pasar:** depende del secreto, fixtures, permisos y servicio remoto. Tampoco se ejecutó el mismo archivo contra el espejo: su setup rechaza otra URL y los fixtures E06 no son los del espejo; no se debilitó esa guarda.

## Configuración Vercel y verificación

Configuración necesaria para esta entrega:

- Root Directory `front`, preset Next.js, build `npm run build`, salida predeterminada `.next` y dependencias del lockfile (`npm ci`). El CI fija npm `11.21.1`.
- Incluir archivos externos al Root Directory: los imports a `../contracts` requieren el checkout completo. `turbopack.root` ya apunta al padre. Copiar solamente `front/` no reproduce el build.
- Node `22.x` en el proyecto. El repo/local fija `22.23.2`; Vercel administra los parches de la versión mayor, así que no se puede prometer ese parche exacto en el proveedor.
- Production: `NEXT_PUBLIC_SUPABASE_URL=https://folyslqzqvnpolexcxjo.supabase.co` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` del mismo proyecto, disponibles al compilar y ejecutar. No se necesita JWT de servidor, importador, service_role ni `EQUITAS_ORIGINAL_BUILD`.
- Metadatos de sistema Vercel disponibles para `/api/build-info`: `VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA` y `VERCEL_GIT_COMMIT_REF`.

Las variables públicas quedan incorporadas en el bundle: cambiarlas requiere un nuevo build. La compilación local con solo las dos variables públicas funcionó contra el espejo y contra la original hasta ingreso. Se conservó `contracts/` junto a `front/`; no se probó el entorno remoto de Vercel ni se inspeccionó su panel. No se propone un cambio obligatorio de configuración si ya cumple esta lista, pero **no está comprobado que cada ajuste actual la cumpla**. Documentación del proveedor: [raíz y build](https://vercel.com/docs/builds/configure-a-build), [versiones de Node](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), [integración Git](https://vercel.com/docs/git).

La base de un Preview de `delivery/entrega-final` es **desconocida**. La excepción de variables para `quality/tp-testing` no permite deducirla. Antes de ingresar credenciales:

```sh
curl --fail --silent --show-error https://URL-DEL-DESPLIEGUE/api/build-info
```

Compará `sourceSha` con el commit enviado, `environment` con `preview` o `production`, y `supabaseProjectRef` con el destino autorizado. Un 401 de protección del Preview no confirma nada. Para Production, verificá la URL pública anterior y ref `folyslqzqvnpolexcxjo`. No hagas login hasta que esos tres campos coincidan. No uses la fecha de compilación ni el alias de rama como prueba del SHA.

## Reversión sin tocar la base

No se ejecutó ninguna reversión. Guardá antes de publicar el SHA completo de entrega y el identificador/URL inmutable del despliegue estable de `36f35b4`; aquí solo está comprobado su alias público anterior.

Si la integración se hace con un commit de merge, desde una rama limpia actualizada de `main`, `git revert -m 1 SHA_DEL_MERGE` crea la reversión normal. Revisá y publicá ese commit mediante el flujo autorizado. No reviertas migraciones en Supabase.

Para el avance directo previsto, hay numerosos merges históricos dentro del rango: **no ejecutes `git revert 36f35b4..HEAD` a ciegas**. Si aún no hubo cambios posteriores que conservar, esta reversión del árbol completo produce un commit nuevo y revisable:

```sh
git fetch origin
git switch -c revert/entrega-final origin/main
git status --porcelain
# Continuar solo con árbol limpio y entrega identificada como HEAD.
git restore --source=36f35b4 --staged --worktree -- .
git diff --cached --exit-code 36f35b4
git diff --cached --stat
git commit -m "revert: restore stable application before final delivery"
```

La comparación contra `36f35b4` debe salir 0: el árbol preparado es idéntico al estable. La revisión y el push posterior quedan a cargo de quien integra; no se usa force-push ni reset remoto. Este nuevo commit dispara los workflows/deploys correspondientes al publicarlo: revisá también los efectos de CI de la versión restaurada. Si existen cambios posteriores, prepará una reversión selectiva revisada en vez de restaurar todo el árbol. `/api/build-info` mostrará el **SHA nuevo de reversión**, no `36f35b4`, aunque su contenido sea el mismo.

Con acceso al proveedor, elegí el despliegue estable comprobado y usá Rollback en Vercel, o `vercel rollback URL_O_ID_DEL_DESPLIEGUE`. La [reversión de Vercel](https://vercel.com/docs/deployments/rollback-production-deployment) mueve el tráfico a un despliegue existente sin recompilar ni modificar Supabase; su disponibilidad depende del plan/permisos. Verificá luego SHA y ref por `/api/build-info` y revertí también Git para que el siguiente push no vuelva a publicar la candidata. No hubo CLI/token del proveedor disponible en esta tarea.

## Barrido previo a publicar

Se revisó heurísticamente el contenido completo de los archivos distintos entre `main` y esta rama: claves/JWT, contraseñas literales, correos y rutas privadas, sin copiar valores a los reportes. Los candidatos de claves/JWT quedaron en fixtures de pruebas (`back/tests/fake_supabase_http.py:48`, `back/tests/test_demo_local.py:268,270`, `front/tests/unit/dal-entrypoints.test.ts:98`); no se identificó un secreto operativo. Los correos de contratos/documentación son ejemplos declarados, algunos con dominios reales: su carácter ficticio no permite certificar que nunca coincidan con una persona real.

Se reemplazó una ruta personal fija en `scripts/campanas/equitas_campanas.py` por `Path.home()`. Quedan rutas personales documentadas en `docs/tesis/entorno-aislado.md:53,58`, fuera de la propiedad de este implementador: coordinación debe normalizarlas. Los ejemplos de correo de `contracts/channel-flow.v1.json:291,292,333,334,335,346,347,371,372,373,374,378,442` y `docs/tesis/canal-deudor-diseno.md:256,300,301,336,337,338,356,357` requieren criterio de sus dueños si se decide restringirlos a dominios reservados. No se tocaron contratos. El barrido no certifica ausencia de datos personales en imágenes/binarios ni reemplaza una revisión humana de toda la entrega.
