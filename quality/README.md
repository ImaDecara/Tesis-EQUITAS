# CI base del TP de Calidad — E02

Workflow: [quality-ci.yml](../.github/workflows/quality-ci.yml). Se ejecuta en push, pull request hacia `main` y manualmente. El corte inicial está en comprobación remota; la ficha de ejecución documentará las URLs y resultados antes de cerrar E02.

## Controles y resultados

- **Frontend:** Node 22.23.2/npm 11.21.1; `npm ci`, verificación del árbol, Vitest/V8 con JSON/JUnit/LCOV/HTML, ESLint JSON, build/TypeScript, duplicación, complejidad y auditorías npm completa/productiva.
- **Backend:** CPython 3.12.14, venv nuevo, pip 25.0.1, requisitos y constraints E01; pruebas de infraestructura, `pip freeze`, `pip check`, Pytest con JUnit/cobertura JSON/XML/HTML y Ruff JSON.
- **Resumen:** descarga los artefactos de ambos jobs, comprueba SHA/run/intento, reúne estados, pruebas, métricas y versiones, y publica JSON/Markdown en el resumen de Actions. Un job fallido o un reporte requerido ausente/inválido bloquea el resumen.

`ci.py` ejecuta los controles desde `front` o `back`, conserva el código de salida de cada proceso y continúa los controles independientes para recoger sus reportes. Al finalizar devuelve 1 si alguno falló o falta evidencia requerida. No se usa `continue-on-error`, `|| true` ni una copia manual de reportes históricos.

Los artefactos `ci-frontend-<run>-<attempt>`, `ci-backend-<run>-<attempt>` y `ci-summary-<run>-<attempt>` se conservan **30 días**. La subida se ejecuta con `always()`, incluyendo las ejecuciones fallidas. Si una preparación impide producir un reporte, su ausencia queda como fallo; no se publica una aprobación vacía. Descargar los artefactos antes de su vencimiento para conservar la entrega.

## Seguridad y límites del alcance

Los jobs utilizan permisos de lectura, acciones oficiales fijadas por SHA, `persist-credentials: false`, runners Ubuntu 24.04 y tiempos máximos de 20/15/5 minutos. Las caches de descarga se asocian al lockfile frontend o a requisitos/constraints backend; se instalan dependencias desde cero, no se restaura un venv usado.

No se incorporan secretos de Supabase. La integración real existente queda visiblemente omitida mediante `SUPABASE_TEST_ENABLED=false`; las pruebas aisladas usan respuestas sintéticas. E06 deberá agregar un job de integración con testing y credenciales propias, sin permitir que su ausencia apruebe la entrega. No usar `pull_request_target` para ejecutar código de terceros con secretos.

**Un CI base aprobado no acredita la entrega integral.** La cobertura frontend vigente sigue por debajo del 60 % (OBS-COB-001). Los gates completos de cobertura existente/nueva, duplicación y bugs críticos se implementan y prueban en E04. Despliegue, smoke, cargas e integración externa corresponden a etapas posteriores. Las pruebas de infraestructura se informan aparte de las 94 pruebas de producto de la línea base.

## Auditoría y excepción temporal

[npm-audit-policy.json](npm-audit-policy.json) formaliza OBS-DEP-001: los cinco paquetes/versiones/rutas revisados deben ser exclusivamente de desarrollo y derivar del aviso GHSA-vfj7-8cjw-p6xm. No se permiten avisos productivos. Se rechazan nuevos paquetes, versiones/rutas diferentes, avisos distintos, críticos, errores de red, JSON inválido o resultados incongruentes.

La auditoría completa conserva su salida cruda 1 y la productiva 0 en el reporte de decisión. El control automatizado evalúa esa excepción conocida y puede devolver 0 con el riesgo explícito. **Los cinco avisos siguen abiertos.** La excepción vence el **26/10/2026**; desde ese día bloquea mientras existan avisos sin una decisión revisada. No extenderla sin volver a investigar, probar y documentar. Responsable: Axel Azcune.

## Reproducción local

Preparar las herramientas según [REPRODUCIBILIDAD_CALIDAD.md](../REPRODUCIBILIDAD_CALIDAD.md). Con Python y npm de las versiones declaradas en PATH, desde la raíz:

```bash
python quality/ci.py run frontend --output .quality/local-ci/frontend
python quality/ci.py run backend --output .quality/local-ci/backend
python quality/ci.py summary --artifacts .quality/local-ci --output .quality/local-ci-summary
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

Cada artefacto contiene logs y resultados propios. Las URLs/SHA y comprobaciones reales de E02 se conservarán en la ficha de cierre y su evidencia versionada.
