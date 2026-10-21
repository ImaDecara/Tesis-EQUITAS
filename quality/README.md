# CI y quality gates del TP de Calidad — E02/E04

## Gates E04

El job **Quality gates y resumen** ejecuta el evaluador [gates.py](gates.py) y devuelve salida 1 cuando falla cualquier condición. Conserva `gate.json`, `summary.json` y `summary.md` aun en rojo. Los [criterios previos](../CASOS_E04_GATES.md) y la [política versionada](gate-policy.json) definen la evaluación.

| Control | Criterio bloqueante |
| --- | --- |
| Controles y pruebas | Todos los controles obligatorios aprobados; JUnit/Vitest coherentes. |
| Existente | Sentencias >= 60 % en frontend y backend, evaluados por separado. |
| Nuevo | Líneas ejecutables nuevas/cambiadas >= 80 % por módulo contra la base fija. |
| Duplicación | Líneas duplicadas <= 5 % en el alcance conjunto de jscpd. |
| Críticos | Cero hallazgos de reglas clasificadas como críticas por el proyecto. |
| Análisis | Cero errores/advertencias ESLint y hallazgos Ruff no aceptados; también se analiza `quality/` por separado. |
| Dependencias | Política de auditoría E02 aprobada, sin críticos ni avisos productivos. |
| Evidencia | Base resoluble/ancestral, procedencia correcta y reportes completos/válidos, sin mezclar runs/intentos. |

La base fija es `531996f51243dc3d4c5a607338e2f35e32313f6b`. El checkout del job resumen descarga toda la historia. `git diff --no-ext-diff --no-renames --unified=0 BASE HEAD` obtiene las líneas añadidas/cambiadas; se intersectan con las líneas ejecutables `DA` de LCOV y con `executed_lines ∪ missing_lines` de coverage.py. Los archivos nuevos entran completos; los eliminados no suman; un renombre se evalúa como eliminación/alta completa. Se normalizan separadores y prefijos de rutas Windows/Linux. Si un módulo no tiene líneas nuevas ejecutables se informa 0 y porcentaje nulo («no aplica»), exigiendo igualmente reportes válidos. El desglose por archivo explica el total; el umbral se decide por módulo.

Se conservan los alcances: `front/app`, `front/components`, `front/lib` (TS/TSX salvo `.d.ts`) y `back/ETL`, `back/api`, `back/services` (Python). Se cotejan los archivos reportados con el inventario Git, se validan totales por archivo y se exige coherencia entre LCOV/JSON y reportes de pruebas. No se retiran archivos sin cobertura. `front/proxy.ts` sigue fuera del alcance heredado, declarado desde E00. Los scripts/tests de infraestructura no se suman al denominador del producto.

Se comparan **conteos sin redondear** mediante productos cruzados; 79,99 % nuevo falla, 80 % aprueba, 5 % de duplicación aprueba y un valor mayor falla aunque se muestre redondeado como 5,00 %. Vitest trunca algunos porcentajes a dos decimales; `gate.json` conserva el cociente calculado desde los conteos.

### Clasificación de bugs críticos

Ruff no asigna una severidad crítica nativa a cada regla. La política del proyecto clasifica como críticas `F821`, `F822`, `F823` e `invalid-syntax`; ESLint clasifica `constructor-super`, `no-unreachable`, `no-unsafe-finally` y errores fatales de parsing. Las tres reglas ESLint quedan activas explícitamente. Los otros hallazgos no aceptados también bloquean análisis, sin etiquetarlos todos como críticos.

La clasificación prioriza fallos estructurales/de ejecución: por ejemplo, [F821](https://docs.astral.sh/ruff/rules/undefined-name/) identifica nombres no definidos y [F823](https://docs.astral.sh/ruff/rules/undefined-local/) variables locales usadas antes de asignarse. [no-unsafe-finally](https://eslint.org/docs/latest/rules/no-unsafe-finally) detecta alteraciones del flujo desde `finally`. Es una política acotada: cero hallazgos no significa ausencia de defectos funcionales ni certifica RLS. DEF-SUP-001 permanece abierto para E06. Vulnerabilidades npm y defectos de negocio conservan sus registros y tratamiento propios.

### Ensayo remoto del gate

El input manual `verify_gate_failure=true` mantiene las suites normales y añade un diagnóstico **sintético F821 al reporte descargado** antes de evaluarlo. No modifica fuentes ni los artefactos originales de frontend/backend. El artefacto del resumen guarda `ruff-before-probe.json`, `ruff-after-probe.json`, `gate-probe.json` con hashes, y el gate fallido. El job resumen debe fallar aun con ambos componentes aprobados.

```bash
gh workflow run quality-ci.yml --repo ImaDecara/Tesis-EQUITAS --ref main -f verify_gate_failure=true
```

Usar solo para verificar el mecanismo y registrar el resultado como ensayo controlado. El defecto real rojo/verde sigue siendo E03. El input anterior `verify_failure=true` conserva el ensayo E02 de una prueba fallida; por defecto ambos inputs son falsos. Las pruebas automatizadas del evaluador cubren los límites, datos incompletos y la propagación del fallo.

Un resultado verde de estos gates **no aprueba una entrega/despliegue integral**: `release_approved=false` sigue indicando que faltan integración real, despliegue/smoke, cargas y cierre final del TP.

## Antecedentes del pipeline base

Workflow: [quality-ci.yml](../.github/workflows/quality-ci.yml). Se ejecuta en push, pull request hacia `main` y manualmente. **E02 comprobada:** [ejecución normal aprobada](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39669312471) y [fallo controlado propagado](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39669377493). Consultar [la ficha E02](../REGISTRO_EJECUCION_E02.md) y [sus evidencias](../evidencias/e02/ejecuciones-2026-10-21.json).

## Controles y resultados

- **Frontend:** Node 22.23.2/npm 11.21.1; `npm ci`, verificación del árbol, Vitest/V8 con JSON/JUnit/LCOV/HTML, ESLint JSON, build/TypeScript, duplicación, complejidad y auditorías npm completa/productiva.
- **Backend:** CPython 3.12.14, venv nuevo, pip 25.0.1, requisitos y constraints E01; pruebas y lint de infraestructura, `pip freeze`, `pip check`, Pytest con JUnit/cobertura JSON/XML/HTML y Ruff JSON. Infraestructura y producto tienen reportes separados.
- **Resumen:** descarga los artefactos de ambos jobs, comprueba SHA/run/intento, reúne estados, pruebas, métricas y versiones, y publica JSON/Markdown en el resumen de Actions. Un job fallido o un reporte requerido ausente/inválido bloquea el resumen.

`ci.py` ejecuta los controles desde `front` o `back`, conserva el código de salida de cada proceso y continúa los controles independientes para recoger sus reportes. Al finalizar devuelve 1 si alguno falló o falta evidencia requerida. No se usa `continue-on-error`, `|| true` ni una copia manual de reportes históricos.

Los artefactos `ci-frontend-<run>-<attempt>`, `ci-backend-<run>-<attempt>` y `ci-summary-<run>-<attempt>` se conservan **30 días**. La subida se ejecuta con `always()`, incluyendo las ejecuciones fallidas. Si una preparación impide producir un reporte, su ausencia queda como fallo; no se publica una aprobación vacía. Descargar los artefactos antes de su vencimiento para conservar la entrega. Para reintentar, ejecutar el workflow completo: se rechazan mezclas de artefactos de intentos distintos.

## Seguridad y límites del alcance

Los jobs utilizan permisos de lectura, acciones oficiales fijadas por SHA, `persist-credentials: false`, runners Ubuntu 24.04 y tiempos máximos de 20/15/5 minutos. Las caches de descarga se asocian al lockfile frontend o a requisitos/constraints backend; se instalan dependencias desde cero, no se restaura un venv usado.

No se incorporan secretos de Supabase. La integración real existente queda visiblemente omitida mediante `SUPABASE_TEST_ENABLED=false`; las pruebas aisladas usan respuestas sintéticas. E06 deberá agregar un job de integración con testing y credenciales propias, sin permitir que su ausencia apruebe la entrega. No usar `pull_request_target` para ejecutar código de terceros con secretos.

**Un CI aprobado no acredita la entrega integral.** Los gates E04 anteriores evalúan cobertura existente/nueva, duplicación, críticos y reportes. Despliegue, smoke, cargas e integración externa corresponden a etapas posteriores. Las pruebas de infraestructura se informan aparte del producto; las 94 pruebas son la línea base histórica E00–E02, no el total vigente después de ampliar suites.

## Auditoría y excepción temporal

[npm-audit-policy.json](npm-audit-policy.json) formaliza OBS-DEP-001: los cinco paquetes/versiones/rutas revisados deben ser exclusivamente de desarrollo y derivar del aviso GHSA-vfj7-8cjw-p6xm. No se permiten avisos productivos. Se rechazan nuevos paquetes, versiones/rutas diferentes, avisos distintos, críticos, errores de red, JSON inválido o resultados incongruentes.

La auditoría completa conserva su salida cruda 1 y la productiva 0 en el reporte de decisión. El control automatizado evalúa esa excepción conocida y puede devolver 0 con el riesgo explícito. **Los cinco avisos siguen abiertos.** La excepción vence el **26/10/2026**; desde ese día bloquea mientras existan avisos sin una decisión revisada. No extenderla sin volver a investigar, probar y documentar. Responsable: Axel Azcune.

## Reproducción local

Preparar las herramientas según [REPRODUCIBILIDAD_CALIDAD.md](../REPRODUCIBILIDAD_CALIDAD.md). Con Python y npm de las versiones declaradas en PATH, desde la raíz:

```bash
python quality/ci.py run frontend --output .quality/local-ci/frontend
python quality/ci.py run backend --output .quality/local-ci/backend
python quality/ci.py summary --artifacts .quality/local-ci --output .quality/local-ci-summary
# Evaluar solamente los gates sobre reportes existentes del HEAD actual.
python quality/gates.py --artifacts .quality/local-ci --output .quality/local-gates
```

Sin `--install` se usan las dependencias ya instaladas. Con `--install`, frontend ejecuta `npm ci` y backend prepara el entorno e instala las dependencias; usar un checkout/venv apropiado para una instalación nueva. Cada directorio de reportes debe estar vacío: el script rechaza reportes previos para impedir mezclas de versiones. Elegir otra carpeta al repetir.

En Windows utilizar el ejecutable de CPython preparado si `python` apunta a otro intérprete. El script conserva Unicode aun con salida redirigida. Estos comandos no ejecutan despliegues ni cargas sobre la base real.

Las pruebas del mecanismo se ejecutan con:

```bash
python -m unittest discover -s quality/tests -v
```

## Verificar que una prueba fallida bloquea

Una ejecución manual puede activarse con `verify_failure=true`. Solo en `workflow_dispatch`, el runner crea una prueba temporal identificada como **E02: ensayo controlado de propagación de fallo**, que espera deliberadamente un resultado distinto. Vitest debe fallar; el job frontend y el resumen deben fallar; los tres artefactos deben conservarse, incluida cobertura con `reportOnFailure`.

```bash
gh workflow run quality-ci.yml --repo ImaDecara/Tesis-EQUITAS --ref main -f verify_failure=true
```

La prueba temporal solo existe en el checkout del runner; no modifica el producto ni se publica en Git. **No demuestra el defecto real, su corrección ni el requisito rojo/verde de E03.** Con el valor por defecto `false`, no se genera. El informe del ensayo debe indicar su propósito y resultado esperado fallido.

Consultar y descargar una ejecución concreta:

```bash
gh run list --repo ImaDecara/Tesis-EQUITAS --workflow quality-ci.yml
gh run view <RUN_ID> --repo ImaDecara/Tesis-EQUITAS
gh run download <RUN_ID> --repo ImaDecara/Tesis-EQUITAS --dir .quality/descarga-<RUN_ID>
```

Cada artefacto contiene logs y resultados propios. Las URLs/SHA y comprobaciones reales de E02 están conservadas en la ficha de cierre y su evidencia versionada. Se descargaron y verificaron los seis ZIP de las dos ejecuciones, incluidos JSON, XML, LCOV y HTML con sus recursos.
