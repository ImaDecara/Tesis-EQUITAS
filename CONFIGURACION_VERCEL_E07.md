# E07 — Configuración manual de Vercel

**Estado 23/10/2026:** configuración aplicada y verificada mediante la conexión administrativa de Vercel. Las dos variables están limitadas a Preview/`quality/tp-testing`, el secreto de automatización está guardado en GitHub y el nuevo smoke automático aprobó. Esta guía queda como procedimiento de reproducción; no hay configuración manual pendiente de E07. [Evidencia](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39955572523).

Proyecto existente: **tesis-equitas**, equipo/namespace **equitas**. La rama de testing es **`quality/tp-testing`**. Su preview debe usar el Supabase aislado `iylwghgvtydpmwidojdo`.

## 1. Variables del preview de testing

1. Abrir [Vercel Dashboard](https://vercel.com/dashboard), entrar al equipo que contiene el proyecto y abrir **tesis-equitas**.
2. Entrar en **Settings → Environment Variables**.
3. Añadir las siguientes dos variables. Seleccionar únicamente el entorno **Preview** y la opción de rama específica **`quality/tp-testing`**. Las variables específicas de rama prevalecen sobre las generales de Preview con igual nombre.

| Nombre | Valor |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://iylwghgvtydpmwidojdo.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | La clave `sb_publishable_…` del testing, disponible en el archivo local indicado abajo. |

El archivo local ignorado **`.quality/e07/vercel-preview-public.env`** contiene ambas líneas completas para copiarlas o importarlas. Contiene configuración pública del frontend; no incluye contraseñas de usuarios ni clave administrativa. No se versiona ni se adjunta a las evidencias.

4. Guardar las variables. Si Vercel propone aplicarlas también a Production/Development, dejar el alcance únicamente en **Preview → `quality/tp-testing`**. El proyecto original de Supabase y el resto de los entornos conservan su configuración.
5. Si la lista de ramas todavía no muestra `quality/tp-testing`, actualizarla después de publicar esa rama en GitHub. No elegir `main` para sustituirla.

## 2. Permitir la automatización del preview protegido

Los previews existentes muestran la pantalla de autenticación de Vercel. El navegador de CI necesita el mecanismo **Protection Bypass for Automation**, que está disponible en todos los planes según la documentación consultada. No hace falta desactivar la protección del proyecto ni contratar un plan.

1. En el mismo proyecto abrir **Settings → Deployment Protection**.
2. Buscar **Protection Bypass for Automation**.
3. Crear un secreto para estas pruebas, por ejemplo con nombre descriptivo `TP calidad smoke`.
4. Copiar su valor y abrir [GitHub → Settings → Secrets and variables → Actions](https://github.com/ImaDecara/Tesis-EQUITAS/settings/secrets/actions).
5. Crear **New repository secret** con nombre exacto **`VERCEL_AUTOMATION_BYPASS_SECRET`** y pegar allí el valor generado por Vercel.

El secreto `SUPABASE_TEST_CONFIG` de E06 ya está configurado en GitHub: no hay que reemplazarlo ni ponerlo en Vercel. Sus contraseñas se usan exclusivamente en la ejecución del navegador.

No compartir el valor del bypass por chat, capturas o Issues. El workflow lo utiliza como header únicamente hacia el origen del preview; no lo envía a Supabase. No se generan HAR ni trazas de red con cookies/JWT; se conservan capturas y reportes sanitizados.

## 3. Versión y nuevo despliegue

1. Comprobar que Vercel expone sus variables de sistema, en particular **`VERCEL_GIT_COMMIT_SHA`**, **`VERCEL_GIT_COMMIT_REF`** y **`VERCEL_ENV`**. Si aparece **Automatically expose System Environment Variables**, debe estar habilitado. No escribir manualmente un SHA fijo como variable.
2. Avisar cuando estén guardadas las dos variables de Preview y el secreto de GitHub. El flujo publica la versión candidata en `quality/tp-testing` y genera un **nuevo** despliegue con esa configuración.
3. No utilizar una URL anterior como evidencia del cambio de variables: los cambios se aplican a despliegues nuevos.

El pipeline exige que `/api/build-info` devuelva el SHA esperado, `environment=preview` y la referencia de Supabase testing. Si algo no coincide, falla antes de enviar las credenciales de login.

## Qué se ejecuta automáticamente

1. CI de `quality/tp-testing`: build, pruebas, análisis, gates e integración Supabase real obligatoria.
2. El workflow posterior verifica el mismo SHA y espera la URL inmutable del deployment Preview emitido por `vercel[bot]`.
3. El navegador comprueba login, deuda de ARS 1.250, objeto/persona A conocidos, ausencia de B, filtro y limpieza, y logout con nuevo acceso protegido denegado.
4. Se conservan `deployment.json`, `smoke.json`, JUnit, resumen y capturas. Un fallo deja el workflow en rojo.

Esto prepara la ejecución de E07. La etapa solo se cierra después de comprobar el preview nuevo y el smoke automático en CI; una prueba local no sustituye esa evidencia.

Referencias: [variables por rama](https://vercel.com/docs/environment-variables), [bypass para automatización](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation), [variables de sistema](https://vercel.com/docs/environment-variables/system-environment-variables).
