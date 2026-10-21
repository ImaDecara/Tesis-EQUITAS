# E07 — Despliegue y smoke de navegador

**Fecha:** 21/10/2026. **Responsable:** Axel Azcune (`AxAzc`). **Estado:** implementación en validación; pendiente de configuración manual de Vercel y ejecución del preview en CI.

Entrada: E06 cerrada en `6ae18c24296f74a39e739d9fccc0ed67fb5d80c8`. Rama de trabajo: `quality/e07-deploy-smoke`. Rama persistente de previews: `quality/tp-testing`. Requisitos R17–R19, R24 y R25.

## Hosting comprobado y alcance

GitHub registra despliegues del proyecto Vercel **tesis-equitas**, namespace **equitas**, creados por `vercel[bot]`. Se comprobaron deployments Production y Preview con URLs inmutables y SHA. Los previews existentes requieren autenticación de Vercel.

El flujo E07 se limita a **Preview de `quality/tp-testing`**, asociado al Supabase de testing `iylwghgvtydpmwidojdo`. El original de Supabase conserva su estado y DEF-SUP-001 abierto. Las variables específicas de rama y el secreto de automatización requieren configuración manual, detallada en [la guía](CONFIGURACION_VERCEL_E07.md).

## Implementación

- `/api/build-info` devuelve únicamente SHA de Vercel, entorno y referencia pública de Supabase; sin claves ni sesiones y con `Cache-Control: no-store`. Tiene cinco pruebas unitarias.
- `quality/wait_preview.py` verifica CI aprobado, SHA, rama, evento y repositorio; selecciona exclusivamente un Preview del mismo SHA emitido por Vercel. Rechaza URL ajena, Production, despliegue fallido y versión anterior.
- `.github/workflows/preview-smoke.yml` se activa al terminar el CI de la rama de testing, espera el despliegue y ejecuta el navegador contra su URL inmutable.
- La integración Supabase real de E06 pasa a ser obligatoria también en `quality/tp-testing`.
- Playwright **1.64.1** queda fijado con lockfile. Chromium ejecuta un recorrido SMOKE-01 con cinco comprobaciones; no se cuentan sus pasos como cinco tests independientes.

## Criterios fijados antes de ejecutar

| Comprobación | Esperado |
| --- | --- |
| Disponibilidad y procedencia | Preview listo para el SHA exacto; `/api/build-info` confirma ese SHA, entorno preview y Supabase testing. |
| Acceso | Login real de la cuenta sintética A y dashboard resuelto. |
| Dashboard | Deuda total ARS 1.250 y ausencia del identificador B; sin error visible de datos/JavaScript. |
| Navegación e interacción | Objeto TP-A y persona A visibles; filtro `E07-NO-EXISTE` deja cero resultados; limpiar recupera el objeto. B ausente. |
| Salida | Logout, formulario de login y nuevo acceso a `/debtors` redirigido a login sin mostrar cartera. Se admite el parámetro `next` agregado por AuthGuard. |

Timeouts: hasta 600 s para obtener el deployment, 120 s para disponibilidad, 30 s por aserción y 180 s para el recorrido de navegador. La URL se valida antes del login; el navegador bloquea solicitudes a otro proyecto Supabase. El bypass se entrega únicamente al origen Vercel evaluado.

## Validación local realizada

El smoke completo pasó localmente con build productivo y Supabase cloud de testing: **un recorrido aprobado y cinco comprobaciones**, sin omisiones. Se verificaron dashboard, datos A, filtro/limpieza, persona y logout. La ejecución local se identifica expresamente como `local_preflight` sobre el árbol de implementación basado en E06; **no acredita un despliegue nuevo**.

Durante la preparación se corrigieron el uso del timeout de Playwright, el selector accesible del enlace que incluye la prioridad y la aceptación de `/login?next=…` al salir. Los valores esperados de datos no se cambiaron. Estas correcciones pertenecen al ensayo, no se presentan como defectos nuevos del producto.

Regresión local frontend: **107 pruebas aprobadas**, cero fallidas/omitidas; build, lint, auditoría y duplicación aprobados. Cobertura: **794/1.283 sentencias**, 61,88 % informado por Vitest. Las 54 pruebas de infraestructura pasan; las seis nuevas comprueban la selección del preview y la procedencia de CI. La auditoría mantiene los cinco altos dev de OBS-DEP-001 con el vencimiento original, sin hallazgos productivos.

## Evidencia y condición de cierre pendiente

El runner conserva JSON, JUnit, resumen y capturas de datos sintéticos. No genera HAR ni trazas de red con credenciales. Tanto la selección fallida del deployment como el smoke fallido propagan salida distinta de cero y conservan diagnóstico.

Para cerrar E07 faltan: guardar las variables de Preview de la rama y el bypass de GitHub; publicar el candidato aprobado en `quality/tp-testing`; comprobar el nuevo deployment y el smoke automático; incorporar URL, SHA y reportes reales a esta ficha, al catálogo y al roadmap. La etapa permanece abierta hasta esa comprobación.

Recuperación: conservar el artefacto fallido; corregir configuración o código en una versión identificada; repetir CI y generar un preview nuevo. La rama de testing evita promover automáticamente un resultado fallido a Production. Un rollback manual de Vercel no se declara probado por este procedimiento.
