# Registro de ejecución E00 — Alcance, plan y checkpoint

Fecha: **21/10/2026**. Responsable: **Axel Azcune (`AxAzc`)**. Estado: **Completada**.

## 1. Objetivo y contexto inicial

Formalizar el avance recibido, conservar una línea base identificada y dejar definidos alcance, criterios, entornos, responsables y soporte de seguimiento antes de continuar la implementación del TP.

El producto validado permanece en la referencia `531996f51243dc3d4c5a607338e2f35e32313f6b`. Antes de comenzar E00 se publicó el checkpoint documental **`d4e61644298b18f790a9effb3b8a38472f988698`** en `origin/main`.

La rama de trabajo se mantuvo en `main`. No se creó una rama adicional. El árbol de trabajo estaba limpio después del primer push; los cambios de E00 son documentación y configuración de exclusión de cachés regenerables.

## 2. Trabajo realizado

- Se creó [PLAN_PRUEBAS_CALIDAD.md](PLAN_PRUEBAS_CALIDAD.md) como referencia vigente para alcance, objetivos medibles, niveles, criterios de entrada/salida, entornos, técnicas, riesgos y contingencia.
- Se definió continuidad nominal a cargo de Axel Azcune y se asignaron los dos defectos abiertos a esa responsabilidad.
- Se eligió **GitHub Issues**, acompañado por el registro Markdown. Se comprobó que el repositorio tiene Issues habilitado y que la cuenta conectada tiene permisos de escritura/triage.
- Se documentó que las altas de tickets y plantillas corresponden a E05; no se atribuyen tickets a Jira ni a GitHub que todavía no se hayan creado.
- Se conservaron las métricas y las evidencias del 21/10 como históricas, sin presentarlas como nuevas mediciones de E00.
- Se actualizó el roadmap con el checklist de E00, su cierre y el siguiente paso E01/E02.
- Se vinculó el plan desde el informe técnico y se completaron los nombres de integrantes con los datos del informe recibido; legajos y docente permanecen pendientes para el cierre académico.
- Se excluyeron explícitamente las cachés locales de Pytest y Ruff del seguimiento de Git. Los reportes regenerables y el contexto local conservan su exclusión.

## 3. Verificaciones de cierre

| Control | Criterio | Resultado |
| --- | --- | --- |
| Checkpoint previo | Primer commit publicado antes de la formalización. | `d4e6164` publicado en `main`; referencia local/remota coincidente al iniciar E00. |
| Código del producto | Sin cambios en frontend/backend respecto de la base revisada. | Diferencia vacía en los árboles `front`/`back` y lockfile raíz. |
| Alcance | Nivel 2, primer MVP y límites explícitos. | Definido en el plan; no se agregan requisitos de completar toda la tesis. |
| Criterios | Entrada/salida, 60 % existente, 80 % nuevo, duplicación y controles finales. | Definidos; los gates siguen pendientes de implementación E04. |
| Entornos | Separación de local, CI, Supabase observado, testing, despliegue y cargas. | Estado y propósito documentados, sin inventar un entorno disponible. |
| Responsables | Continuidad y defectos con identificación nominal. | Axel Azcune, cuenta `AxAzc`. |
| Seguimiento | Herramienta identificada y accesible. | GitHub Issues habilitado; registro portable y altas previstas en E05. |
| Evidencias | Métricas de partida conservadas y contexto de versión explícito. | 94 aprobadas/1 omitida de la validación original; sin reetiquetarlas como ejecución nueva. |
| Integridad documental | Referencias locales, JSON y cobertura de tareas E00 coherentes. | Controles estructurados conservados en la evidencia de etapa. |

E00 no cambia código productivo ni configuración externa. Por ese alcance no se reejecutaron las suites, build o consultas de Supabase: la evidencia funcional continúa siendo la validación previa del mismo producto. Los controles nuevos de esta etapa son de integridad y consistencia documental y de Git.

## 4. Evidencia y reproducción de verificaciones

La evidencia estructurada está en [e00-consolidacion-2026-10-21.json](evidencias/e00-consolidacion-2026-10-21.json). Registra versiones de referencia, soporte de seguimiento, verificaciones y archivos afectados.

Comprobaciones principales de Git:

```powershell
git status --short
git rev-parse HEAD
git rev-parse origin/main
git diff --name-only 531996f51243dc3d4c5a607338e2f35e32313f6b HEAD -- front back package-lock.json
git -c core.whitespace=-blank-at-eol diff --check
```

La opción de whitespace permite los saltos de línea Markdown intencionales. Los vínculos locales y la estructura de evidencia también se verificaron antes de publicar.

El commit que incorpora este registro identifica el cierre documental; puede consultarse con:

```powershell
git log -1 --format='%H %s' -- REGISTRO_EJECUCION_E00.md
```

## 5. Pendientes y siguiente etapa

No hay un bloqueo de formalización E00. Permanecen pendientes las obligaciones de las siguientes etapas: reproducibilidad/triage, pipeline, correcciones y regresiones, gates, integración de aplicación, smoke, cargas y cierre del informe.

DEF-DAT-001 y DEF-SUP-001 siguen **abiertos**. Elegir responsables y soporte no equivale a corregirlos.

Las etapas **E01 y E02** quedan habilitadas con el plan y checkpoint definidos. La siguiente ejecución debe preparar reproducibilidad y el pipeline base, conservando evidencia para el defecto rojo/verde de E03.
