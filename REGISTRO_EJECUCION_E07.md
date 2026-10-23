# E07 — Despliegue y smoke de navegador

**Fecha de cierre:** 23/10/2026. **Responsable:** Axel Azcune (`AxAzc`). **Estado:** completada; 17/17 controles del roadmap.

Entrada E06: `6ae18c24296f74a39e739d9fccc0ed67fb5d80c8`. Implementación inicial: `4906c9b`. Versión aceptada: **`a6497a73b226f9d27abb4e9080d5540503d95539`**. Requisitos R17–R19, R24 y R25, en el alcance de Preview de testing.

## Resultado verificable

| Elemento | Resultado |
| --- | --- |
| Proyecto y entorno | Vercel `tesis-equitas`, equipo Equitas; Preview de `quality/tp-testing`. |
| Nueva URL inmutable | [https://tesis-equitas-dvj0xf5e3-equitas.vercel.app](https://tesis-equitas-dvj0xf5e3-equitas.vercel.app) |
| Versión | `a6497a73b226f9d27abb4e9080d5540503d95539` tanto en CI, build-info como smoke. |
| CI obligatorio | [Ejecución 39955381596](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39955381596), cuatro jobs aprobados. |
| Smoke automático | [Ejecución 39955572523](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39955572523), disparada por workflow_run tras CI de testing. |
| Producto | 107 frontend + 61 backend + 12 Supabase real + un recorrido de navegador = **181 aprobadas**, cero fallidas/omitidas. |
| Infraestructura | **55 aprobadas**, separadas del producto; siete de selección/procedencia. |
| Navegador | Playwright 1.64.1 y Chromium; cinco comprobaciones; cero errores JavaScript/console registrados. |

La URL conserva la protección de Vercel. Para abrirla interactivamente puede requerir una cuenta autorizada; Actions usa el secreto de automatización, sin desactivar la protección.

## Configuración y funcionamiento

Se verificó acceso administrativo al proyecto mediante la conexión Vercel. Se agregaron `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` únicamente para Preview de `quality/tp-testing`, apuntando a `iylwghgvtydpmwidojdo`. Se creó el bypass del proyecto y se guardó como `VERCEL_AUTOMATION_BYPASS_SECRET` en Actions. Se habilitaron las variables de sistema para identificar SHA, rama y entorno. [Procedimiento reproducible](CONFIGURACION_VERCEL_E07.md).

La integración Git de Vercel genera el Preview al publicar esa rama. El workflow `.github/workflows/preview-smoke.yml` espera el CI y exige repositorio, evento, rama, SHA y workflow correctos; consulta el deployment de Vercel y valida su URL. `/api/build-info` confirma SHA, rama, entorno preview y Supabase de testing antes de iniciar sesión. No se reutiliza una URL anterior para acreditar un nuevo commit.

El tiempo máximo de selección es 600 s; disponibilidad 120 s; aserciones 30 s; recorrido 180 s; job 20 min. La integración real E06 es obligatoria en la rama de testing. Un CI fallido, un destino incoherente o un smoke fallido propagan salida distinta de cero.

## Aceptación y obtenido

1. **Disponibilidad:** build-info disponible para el SHA exacto, rama declarada y Supabase aislado.
2. **Acceso:** login HTTP real de la cuenta sintética A; dashboard autenticado resuelto.
3. **Datos:** deuda total ARS 1.250 y ausencia de B.
4. **Navegación/interacción:** TP-A; filtro E07-NO-EXISTE muestra vacío; limpiar restaura el objeto. La URL `/people` y el título Personas / Deudores se resuelven; la tabla operativa contiene persona A e importe 1.250; B ausente.
5. **Salida:** logout y nueva visita a `/debtors` redirigida a `/login?next=…`, formulario visible y cartera ausente.

Las cinco comprobaciones aprobaron. SMOKE-01 cuenta como **un recorrido**, no cinco tests. [JSON](evidencias/e07/smoke.json), [JUnit](evidencias/e07/smoke.xml), [resumen](evidencias/e07/summary.md), [deployment](evidencias/e07/deployment.json). Capturas: [dashboard](evidencias/e07/dashboard.png), [objetos](evidencias/e07/objetos-filtro-restaurado.png), [personas](evidencias/e07/personas.png), [logout](evidencias/e07/logout-protegido.png). Las imágenes se revisaron visualmente y contienen datos sintéticos. El panel ilustrativo del login conserva cifras estáticas del diseño; no son mediciones de las fixtures.

## Hallazgo y corrección del ensayo

El primer runner aprobado (`4906c9b`, CI 39953038356 / smoke 39953222752) podía validar el nombre de la persona en la tabla de objetos antes de terminar la navegación. La captura permitió detectarlo. Se conserva el [primer ensayo con su limitación](evidencias/e07/primer-ensayo-4906c9b/ALCANCE.md), sin usarlo como cierre de navegación.

Se exigieron URL y título de personas (`348f446`). Un [diagnóstico manual](evidencias/e07/diagnostico-selector/ALCANCE.md) llegó a la página y falló porque dos tablas contienen el mismo nombre; el runner devolvió 1 y conservó JSON/JUnit/captura. Se acotó a la tabla de Deuda total asociada y se verificó el importe (`0e4e84a`). El nuevo pipeline aprobó ese criterio. Son correcciones de sincronización/selector del ensayo; no se presentan como defectos funcionales del producto ni como el rojo/verde real de R18.

## Métricas y límites

Frontend: 794/1.283 sentencias, 61,88 % informado por Vitest; backend: 1.254/1.471, 85,25 %. Gates aprobados contra base fija `531996f51243dc3d4c5a607338e2f35e32313f6b`; duplicación 427/11.159 líneas, 3,83 %. Cinco altos dev de OBS-DEP-001 conservan la excepción exacta y el vencimiento 26/10/2026; cero hallazgos productivos en npm audit. No se cambió el alcance de cobertura.

Código nuevo instrumentado contra esa base: frontend 36/36 líneas y backend 15/17. La nueva propiedad JSX `key` no agrega una línea ejecutable en el diff de cobertura informado; su efecto se verifica con la regresión de navegador de DEF-UI-001. Añadir una aserción al recorrido no aumenta la cantidad de tests: SMOKE-01 sigue siendo uno.

E07 cubre el flujo declarado de Preview de testing con fixtures mínimas. No acredita todas las rutas, un ensayo de capacidad, la cartera real o la corrección de RLS del original. DEF-SUP-001 original y OBS-DEP-001 siguen abiertos. E08 y el cierre académico continúan pendientes.

## Repetición y recuperación

Con Python/Node/npm fijados, dependencias preparadas, Chromium instalado y secretos externos configurados: desde `front`, ejecutar `npm run test:smoke -- --deployment ../.quality/preview/deployment.json --output ../.quality/smoke-repeticion`. El directorio debe ser nuevo. El manifiesto procede de `quality/wait_preview.py` con el SHA y el ID del CI de testing; no editarlo para acreditar una versión distinta. `SUPABASE_TEST_CONFIG` puede suministrarse por entorno o `--config-file` local ignorado; el bypass se entrega por entorno.

Para el flujo automático: publicar un commit revisado en `quality/tp-testing`; el CI obligatorio, Vercel y el workflow posterior generan sus propios reportes. No es necesario lanzar el smoke manualmente. Los artefactos se conservan 30 días y los reportes/capturas sanitizados de este corte quedan versionados.

Ante fallo: conservar reporte; revisar primero procedencia/configuración y después el error funcional; corregir en un commit identificado y generar un nuevo Preview con CI y smoke. No promover un Preview fallido. Recuperar un candidato anterior requiere volver a probarlo con su SHA declarado; un rollback manual de Production no fue ensayado en E07. El bypass solo se adjunta al origen Vercel; se bloquea otro proyecto Supabase; no se generan HAR, videos ni trazas de red con sesiones.

## DEF-UI-001 — Limpiar conserva el texto de búsqueda

**Ticket:** [#11](https://github.com/ImaDecara/Tesis-EQUITAS/issues/11), cerrado tras regresión E07. **Severidad:** baja; prioridad P2. Responsable: Axel Azcune. Caso SMOKE-01, requisitos R13/R14/R19.

En `/debtors`, aplicar `E07-NO-EXISTE` y pulsar Limpiar. Esperado: URL sin filtros, TP-A restaurado y campo vacío. Obtenido en la aplicación `0e4e84a`: URL/listado correctos pero valor efectivo del input todavía `E07-NO-EXISTE`, incluso tras 30 s. [Rojo funcional](evidencias/e07/filtro-red/smoke.json), captura y JUnit conservados; ejecución manual, no workflow rojo.

Causa: el formulario usa `defaultValue` y la navegación conserva la instancia editada. `a6497a7` asigna una key basada en los filtros normalizados para reconstruir el formulario cuando cambian; [patrón de reinicio de estado de React](https://react.dev/learn/preserving-and-resetting-state#resetting-a-form-with-a-key). La aserción `toHaveValue('')` se mantiene como regresión. [Verde automático](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39955572523) sobre el nuevo Preview con el mismo dataset y valor de búsqueda. [Comparación](evidencias/e07/filtro-rojo-verde.json). Se valida el flujo de objetos; no se declara una revisión de todos los formularios del producto.
