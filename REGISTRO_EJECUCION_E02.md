# E02 — Pipeline base con pruebas y reportes

**Fecha:** 21/10/2026. **Responsable:** Axel Azcune (`AxAzc`). **Estado:** completada en su alcance.

Entrada: E01 publicada en `eac6fe647037dc1268540621fb7228c589d3fcc1`. Implementación del pipeline publicada en **`5cfcc773a39fdaa7d5859744c430fd6b790c34d7`**. Las dos ejecuciones principales de esta ficha utilizaron ese mismo SHA.

E02 deja un workflow ejecutado realmente en GitHub, instalación Linux comprobada, controles de frontend/backend, reportes automáticos y evidencia de que una prueba fallida bloquea CI. **No acredita todavía la entrega integral:** siguen pendientes E03/E04, integración real, despliegue, smoke, cargas y cierre del informe.

## 1. Ejecuciones remotas comprobadas

| Ejecución | Disparador y propósito | Resultado real | Pruebas de producto | Artefactos |
| --- | --- | --- | --- | --- |
| [39669312471](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39669312471) | `push`; regresión normal e instalación nueva Linux. | **Success**, los tres jobs aprobaron. | **94 aprobadas, 0 fallidas, 1 omitida**. | Frontend, backend y resumen; descargados y verificados. |
| [39669377493](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39669377493) | `workflow_dispatch`, `verify_failure=true`; ensayo de propagación de fallo. | **Failure**, frontend y resumen fallaron; backend aprobó. | **94 aprobadas, 1 fallida controlada, 1 omitida**. | Los mismos tres artefactos se conservaron pese al fallo, incluidos cobertura y JUnit. |

Además, las **14 pruebas de infraestructura** aprobaron en ambas ejecuciones. Se informan aparte: no se suman a las 94 pruebas de producto ni se cuentan dos veces como casos nuevos por haber sido repetidas.

La ejecución normal duró aproximadamente **89 segundos** entre creación y finalización; el ensayo, **80 segundos**. Estos tiempos son una observación inicial de proceso sobre runners hospedados. No constituyen una prueba de rendimiento de EQUITAS ni una mejora comparable con otro hardware. Los timestamps y estados exactos están en la evidencia JSON.

El push disparó CI sin lanzamiento manual. El segundo ensayo comprobó además el disparador manual. El evento `pull_request` hacia `main` está configurado y validado estáticamente; no se abrió una PR adicional para esta etapa.

## 2. Implementación y propósito

| Archivo | Función |
| --- | --- |
| [.github/workflows/quality-ci.yml](.github/workflows/quality-ci.yml) | Orquestar jobs, versiones, cache, permisos, límites de tiempo y artefactos en GitHub Actions. |
| [quality/ci.py](quality/ci.py) | Ejecutar cada control, conservar su salida y código real, recoger métricas y validar los reportes del mismo SHA/run/intento. |
| [quality/audit_policy.py](quality/audit_policy.py) | Ejecutar las auditorías completa/productiva y evaluar únicamente la excepción temporal revisada en E01. |
| [quality/npm-audit-policy.json](quality/npm-audit-policy.json) | Definir paquetes, rutas, versiones, aviso, responsable y vencimiento de OBS-DEP-001. |
| [quality/tests/test_ci.py](quality/tests/test_ci.py) | Comprobar fallos, reportes ausentes, mezcla de versiones, omisiones visibles y límites de la excepción de dependencias. |
| [front/vitest.config.ts](front/vitest.config.ts) | Añadir JSON summary y LCOV a los reportes de cobertura existentes, conservando el alcance. |
| [quality/README.md](quality/README.md) | Explicar operación, reproducción, artefactos y ensayo de fallo. |

No se cambió código productivo de consultas, scoring, ETL o autorización. El defecto de lectura completa sigue reservado para E03 y el de RLS para E06.

## 3. Jobs, versiones y aislamiento

| Job | Preparación y controles | Límite |
| --- | --- | --- |
| Frontend | Ubuntu 24.04; Node 22.23.2/npm 11.21.1; `npm ci`, árbol de dependencias, Vitest con cobertura, ESLint, build/TypeScript, duplicación, complejidad y auditoría. | 20 minutos. |
| Backend | Ubuntu 24.04; CPython 3.12.14; venv nuevo, pip 25.0.1, requisitos/constraints, infraestructura, freeze, compatibilidad, Pytest con cobertura y Ruff. | 15 minutos. |
| Resumen | Siempre después de ambos jobs; descarga artefactos, valida procedencia, publica resultados y propaga fallos. | 5 minutos. |

Las cinco acciones oficiales están fijadas por SHA de commit verificado, no únicamente por un tag móvil. Las versiones consultadas fueron checkout 7.0.1, setup-node 7.1.0, setup-python 7.0.0, upload-artifact 7.0.2 y download-artifact 8.0.2; los SHA están en el workflow y en la evidencia.

La cache frontend depende de `front/package-lock.json`; la backend, de los dos archivos de requisitos y `constraints.txt`. Se guardan descargas para acelerar la preparación, no un `node_modules` o venv usado que sustituya la instalación nueva. `npm ci` mantuvo el lockfile intacto.

Se utilizan permisos de lectura y `persist-credentials: false`. No hay secretos de Supabase ni escrituras en la base real. Las pruebas aisladas usan respuestas sintéticas. `SUPABASE_TEST_ENABLED=false` mantiene el caso externo visiblemente omitido, sin confundirlo con integración aprobada. E06 deberá crear su ejecución obligatoria con testing y credenciales propias.

Los artefactos tienen nombres únicos por run/intento y **30 días de retención**. Los de estas dos ejecuciones vencen el **20/11/2026**, a las horas exactas indicadas en el JSON. Descargar y preservar los originales antes de su vencimiento. Para repetir una ejecución, lanzar el workflow completo; el resumen rechaza mezclar artefactos de intentos diferentes.

## 4. Resultados normales en Linux

| Control | Resultado remoto |
| --- | --- |
| Instalación frontend | `npm ci`, salida 0 y lock sin cambios. Node/npm efectivos coinciden con E01. |
| Instalación backend | Venv nuevo con CPython 3.12.14; requisitos/constraints instalados y `pip check` aprobado. **`uvloop==0.23.0` comprobado** en el freeze Linux. |
| Vitest | 33 aprobadas, 0 fallidas, 1 omitida. |
| Pytest | 61 aprobadas, 0 fallidas. Se conserva la advertencia de Starlette/TestClient. |
| Infraestructura | 14 aprobadas. Incluyen rechazo de crítico/aviso/versiones desconocidos, expiración, fallos de proceso y reportes ausentes o de otro SHA. |
| Build / TypeScript | Aprobados con Next 16.4.2; descarga de fuentes disponible en el runner. |
| ESLint | 70 archivos, 0 errores y 0 advertencias. |
| Ruff backend | 0 hallazgos no aceptados, con las tres excepciones locales TRY004 documentadas en E01. |
| Cobertura frontend | **586 / 1.275 = 45,96 %** de sentencias; 415 / 1.055 ramas, consola 39,33 %. **No cumple todavía el 60 %**. |
| Cobertura backend | **1.254 / 1.471 = 85,25 %** de sentencias; **339 / 498 = 68,07 %** de ramas. Combinada 80,90 %. |
| Duplicación | **474 / 11.182 = 4,24 %**, 38 clones y 62 archivos. |
| Auditoría completa | Cinco altos de desarrollo, cero críticos; salida cruda **1**. |
| Auditoría productiva | Cero avisos informados; salida cruda **0**. |

Los resultados de producto reproducen los observados en Windows al cierre de E01. La instalación condicional Linux quedó comprobada, no solo propuesta.

**OBS-DEP-001 continúa abierta.** La política automatizada acepta temporalmente la cadena revisada, conserva las salidas crudas y bloquea si cambia el paquete, ruta, versión, aviso o alcance, aparece un crítico/productivo, falla la consulta, falta un reporte o llega el **26/10/2026**. Se volvió a revisar la auditoría en E02: sigue siendo la misma cadena sin parche compatible. La decisión de aceptar la excepción no equivale a corregir las vulnerabilidades.

**OBS-COB-001 continúa abierta.** El pipeline muestra 45,96 % y `release_approved=false`. E04 debe ampliar pruebas significativas hasta al menos 60 %, medir el 80 % del código nuevo y aplicar los demás gates completos. No se usa el porcentaje histórico para aprobar la cobertura actual ni se afirma que estos umbrales ya estén protegidos por E02.

## 5. Demostración real del bloqueo ante una prueba fallida

El ensayo manual creó una única prueba temporal en el checkout del runner:

```text
E02: ensayo controlado de propagacion de fallo
expected 1 to be 2 // Object.is equality
```

Se verificó lo siguiente en los reportes descargados:

1. Vitest ejecutó las 33 pruebas frontend aprobadas existentes, la prueba omitida externa y la nueva prueba controlada, que falló.
2. `tests.exit.json` conservó **exit_code=1** y JUnit conservó el nombre y la aserción fallida.
3. Los controles independientes posteriores produjeron sus reportes; su aprobación no reemplazó el resultado fallido de la suite.
4. El job frontend terminó en **failure**.
5. El job backend terminó en **success**, con sus 61 pruebas aprobadas y reportes propios.
6. El resumen recibió el fallo, conservó 94 aprobadas/1 fallida/1 omitida y terminó en **failure**.
7. Los artefactos frontend, backend y resumen pudieron descargarse y verificar su SHA-256. La cobertura también se produjo en la ejecución fallida.

La prueba temporal no se incorporó al código del producto ni quedó en `main`. **Este ensayo verifica el mecanismo de CI. No cumple por sí mismo R14 ni sustituye el defecto real rojo/verde de E03.** La ejecución normal usa `verify_failure=false` y no genera esa prueba.

## 6. Artefactos y comprobaciones de lectura

Se descargaron **seis ZIP**, tres por ejecución, mediante el plugin de GitHub. Sus hashes coincidieron con los digests publicados por GitHub. Se abrieron/parsearon los JSON y XML, se comprobaron los índices HTML y sus recursos CSS/JS, y se verificó que LCOV incluya **54 registros de archivos frontend**.

| Artefacto | Contenido principal |
| --- | --- |
| Frontend | Manifest `component.json`, runtimes, logs/salidas por control, tests JSON/JUnit, cobertura JSON/summary/LCOV/HTML, ESLint JSON, build log, duplicación/complejidad y auditorías con decisión. |
| Backend | Manifest, instalación/freeze/compatibilidad, log de infraestructura, Pytest JUnit, cobertura JSON/XML/HTML y Ruff JSON. |
| Resumen | `summary.json` y `summary.md`, con SHA, run/intento, estados, aprobadas/fallidas/omitidas, métricas, versiones y pendientes. |

Evidencia publicable y conservada en Git:

- [Metadata, hashes y comprobaciones de ambas ejecuciones](evidencias/e02/ejecuciones-2026-10-21.json).
- [Resumen original de la ejecución aprobada](evidencias/e02/resumen-ci-aprobado.json).
- [Resumen original del fallo controlado](evidencias/e02/resumen-ci-fallo-controlado.json).
- [Nombre y aserción de la prueba fallida](evidencias/e02/asercion-fallo-controlado.json).

Los ZIP completos y sus extracciones quedan localmente en `.quality/e02/downloaded/`. No se copiaron reportes de la auditoría inicial para presentarlos como resultados de GitHub. Los JSON de resumen son copias del contenido de los artefactos de cada ejecución.

## 7. Validación local y siguiente etapa

Antes de publicar se ejecutaron el flujo completo local, las 14 pruebas de infraestructura, Ruff sobre `quality/` y **actionlint 1.7.12** para validar sintaxis/expresiones del workflow. Se corrigió una incidencia de codificación de logs Unicode en Windows y se verificó nuevamente el flujo frontend; no se usó como defecto funcional del TP.

Las 19 casillas operativas de E02 se cierran con estas ejecuciones y evidencias. El commit de publicación de esta ficha se obtiene sin autorreferencias mediante:

```powershell
git log -1 --format='%H %s' -- REGISTRO_EJECUCION_E02.md
```

**Siguiente etapa: E03**, implementar casos de lectura completa con más de una página y más de 3.000 filas, conservar el rojo real de DEF-DAT-001 en CI, corregir ambas rutas afectadas y conservar el verde. El pipeline ya permite producir y descargar esa evidencia. E04 continuará con ampliación de cobertura y gates; E06, con testing y autorización real. El informe final/PDF sigue pendiente de las etapas de cierre.
