# Registro de ejecución — E11

**Fecha:** 23/10/2026. **Responsable:** Axel Azcune (`AxAzc`). **Estado:** validación técnica aprobada; **27/30 controles del roadmap**. El usuario confirmó que todavía falta el repaso del equipo. No se cierra E11 ni se declara realizada la defensa/entrega académica.

## Versión y ejecución integral

Candidato de aplicación: **5b62c14c8186b1ea79c4d4c2aa7dfb8acbb26198**. E00–E10 estaban completas al comenzar. Se alineó por fast-forward `quality/tp-testing` con el candidato ya publicado en main. El push produjo un **nuevo Preview Vercel**, conservando el entorno Supabase aislado y la protección del deployment.

| Verificación | Ejecución / resultado |
| --- | --- |
| CI main del candidato | [39976881137](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39976881137), cuatro jobs aprobados. |
| CI nuevo de testing | [40032393112](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/40032393112), cuatro jobs aprobados, integración real obligatoria. |
| Preview nuevo y smoke | [40032558356](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/40032558356), misma versión y CI de testing vinculado; cinco comprobaciones aprobadas dentro de una campaña. |
| Cargas nuevas desde pipeline | [40032355979](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/40032355979): preflight y dos campañas aprobados, mismo SHA; política/dataset E08 sin cambios. |
| Controlador integral local | [Ejecución](evidencias/e11/ejecucion-controlador.json) aprobada: valida procedencia/jobs, descarga artefactos y verifica build-info/Supabase/CI del smoke. Se retomaron los cuatro runs ya iniciados, sin duplicarlos. |

CI usa checkouts nuevos de Actions, Ubuntu 24.04, Node 22.23.2, npm 11.21.1 y Python 3.12.14. Frontend instala con npm ci; backend y cargas crean venv nuevo, fijan pip e instalan requisitos/constraints. Los caches de descarga no sustituyen estas instalaciones. Los reportes conservan comandos, salidas, versiones y códigos de retorno. No se borró ni reemplazó el entorno local del usuario.

Los jobs obligatorios no están omitidos. Las opciones de inyección manual del CI no se activaron; sus pasos condicionales omitidos no son pruebas de producto omitidas. `release_approved:false` se conserva en el resumen como restricción de aprobación productiva; el gate técnico está aprobado y no se convierte ese campo en una autorización de producción.

Los cambios de cierre E11 agregan documentación, evidencia, controlador y PDF. Los árboles Git de `front`, `back`, `quality` y `.github/workflows` se conservan en el manifiesto para demostrar que la aplicación y harness probados son los mismos; el controlador local vive en `entrega/`. El commit de publicación documental es posterior al candidato, sin atribuirle otro deployment o cargas.

## Resultados y métricas

- **107 frontend + 61 backend + 12 HTTP reales = 180** pruebas de producto en el CI obligatorio, cero fallidas y cero omitidas.
- **66 controles de infraestructura** aparte. Una campaña browser y dos campañas de rendimiento llevan el conjunto revalidado a **183**, sin contar requests o repeticiones como casos nuevos.
- Frontend: sentencias **794/1283=61,8862 %**, ramas **566/1068=52,9963 %**. Backend: sentencias **1254/1471=85,2481 %**, ramas **339/498=68,0723 %**. La combinada backend **1593/1969=80,9040 %** es otra medida.
- Código nuevo contra base fija `531996f51243dc3d4c5a607338e2f35e32313f6b`: front **36/36=100 %**, back **15/17=88,2353 %**. Duplicación: **427/11159=3,8265 %** por líneas. Diez comprobaciones del gate aprobadas.
- Supabase testing: **12/12 HTTP**, Auth/Data API y funciones productivas; inspección complementaria de catálogos **23/23 tablas con RLS y cero SELECT USING true**. La inspección administrativa no reemplaza los negativos HTTP. Original sin modificar.
- Preview [tesis-equitas-lilpc7spm-equitas.vercel.app](https://tesis-equitas-lilpc7spm-equitas.vercel.app), Vercel `dpl_BwPUjxbMmHftGxAkbWdfWAtcYjNy`, commit/branch/entorno/proyecto verificados. Login A, dashboard 1250 sin B, Objetos/Personas, filtro y logout aprobados; cero errores de consola/página.

### Estrés y sostenido nuevos

| Campaña/fase | VU | Requests principales | p95 ms | Resultado |
| --- | ---: | ---: | ---: | --- |
| Estrés | 1 | 419 | 55,44 | Objetivo aprobado. |
| Estrés | 5 | 1075 | 220,42 | Objetivo aprobado. |
| Estrés | 10 | 1262 | 501,80 | Objetivo aprobado. |
| Estrés | 20 | 1292 | 1041,74 | Exploratorio, dentro de 2000 ms. |
| Estrés | 40 | 1264 | 2216,71 | Exploratorio, supera 2000 ms; primer escalón observado fuera de objetivo. |
| Sostenido 600 s | 10 | 15149 | 360,06 | Objetivo aprobado. |

Estrés **5312** y sostenido **15149** solicitudes principales: **20461**, sin errores inesperados ni diferencias de contenido. El objetivo obligatorio estaba fijado **hasta 10 VU** antes de ejecutar; 20/40 son exploratorios. Se conserva el resultado de 40 VU fuera del umbral, sin relajar la política ni presentarlo como aprobado respecto a ese umbral. El throughput se estanca alrededor de 21 requests/s entre 10 y 40 VU mientras crece la latencia: sugiere saturación de procesamiento/colas bajo ese entorno; no identifica una capacidad máxima universal.

El servidor procesa FastAPI real con conector sintético local, 3600 perfiles y 72000 deudas representadas por agregados. No mide capacidad de Supabase ni de la web/cloud. Los runners difieren: estrés AMD EPYC 7763, sostenido Intel Xeon Platinum 8573C, cuatro CPUs lógicas; por eso no se interpreta la diferencia con E08 como mejora/regresión del producto. RSS máximo muestreado del servidor: **248,59 MiB** estrés y **117,70 MiB** sostenido, bajo el presupuesto de 1024 MiB. Diez minutos no prueban ausencia de fugas.

## Revisión de pendientes y trazabilidad

**OBS-DEP-001 #3 cerrado por retiro oficial del aviso.** GitHub retiró GHSA-vfj7-8cjw-p6xm el 23/10/2026 a las 12:53:02 UTC. El mismo lockfile produce auditorías completas/productivas **0/0**, códigos **0/0**, `exception:null`. No se cambió un paquete ni se prorrogó la excepción. Los cinco altos anteriores se conservan como historia; el gate sigue rechazando avisos nuevos. [Aviso](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [metadata portable](evidencias/e11/advisory-retirado.json), [auditorías](evidencias/e11/audit-all.json), [ticket](https://github.com/ImaDecara/Tesis-EQUITAS/issues/3).

Seguimiento: **12 tickets, 11 cerrados, 1 abierto**. **DEF-SUP-001 #1 original permanece abierto** y no se extrapola la corrección testing. Persisten límites de aceptación municipal, accesibilidad completa, pentest integral, recarga real completa/backup restore y capacidad cloud. No se presenta el MVP como listo para producción.

El rojo real [39672114249](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39672114249) conserva sus cuatro fallos DAT-06; el verde [39673351642](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39673351642) conserva las aserciones y corrige la lectura 3507/3507. Son SHAs anteriores relacionados por historial; la repetición actual no sustituye ni reescribe ese contraste.

## Evidencia, informe y demostración

[Manifiesto integral](evidencias/e11/validacion-integral.json), reportes JSON/JUnit, HTML de rendimiento, series/recursos CSV y muestras de operaciones comprimidas quedan versionados. Se verificaron los **ocho ZIP oficiales** del CI, smoke y cargas contra SHA-256 de GitHub. Los ZIP/logs completos de Actions expiran a los 30 días; los datos portables no dependen de esa retención. [Artefactos CI](evidencias/e11/artefactos-ci.json), [campañas](evidencias/e11/artefactos-campanas.json).

El [PDF](entrega/INFORME_ACADEMICO_CALIDAD.pdf) actualizado tiene **29 páginas**, todas renderizadas e inspeccionadas a resolución original; su fuente se reconcilia con E11, conservando captura E07/gráfico E08 como historia explícita y agregando resultados nuevos, cierre por aviso retirado y límites de 40 VU. SHA-256: `c065e6a30626200ecd12ab150febf9d9bacdaad74706664ea7e8a57e2fa2da6d`. La réplica binaria y los tres SVG tienen hashes idénticos bajo el mismo runtime/fuentes. La validación documental aprobó **45 comprobaciones**, **263 enlaces locales** y **121 enlaces HTTPS del PDF**; las muestras crudas reprodujeron conteos y p95 de cada fase. Generación, reproducción y revisión visual quedan en `evidencias/e11/`. Los snapshots E00–E10 no se sobrescriben para simular una ejecución nueva.

El [guion de defensa](entrega/GUION_DEMOSTRACION.md) contiene recorrido, resultados esperados, tiempos, preguntas/respuestas, un comando de repetición integral y contingencias. El smoke nuevo acredita el ensayo técnico sobre testing; **no acredita un ensayo oral realizado por los integrantes**. Aportes individuales registrados con Git; no se atribuye trabajo nuevo a otros integrantes sin evidencia ni se inventan horas/porcentajes.

## Tres controles pendientes para cerrar E11

1. Cada integrante repasa y puede explicar AAA, cálculo de cobertura, gate, rojo/verde y límites de RLS/cargas.
2. Confirmar aportes y datos de entrega del equipo; los tres nombres, carrera, universidad y fecha prevista disponibles se conservaron.
3. Ensayar la exposición oral, comprobar acceso a los enlaces con las cuentas del equipo y confirmar el reparto de bloques. Después presentar en el canal de la cátedra.

El usuario confirmó **«Todavía falta el repaso del equipo»** durante E11. Las casillas humanas del roadmap y del guion permanecen abiertas. No hace falta volver a implementar las etapas técnicas; el siguiente paso es usar el material y completar ese repaso/confirmación.
