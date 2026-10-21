# E04 — Quality gates completos y comprobados

**Fecha:** 21/10/2026. **Responsable:** Axel Azcune (`AxAzc`). **Estado:** completada en su alcance.

Entrada: E03 cerrada en `085c4759b03812451616cfc5cbf8d3507b4b1b2f`. Implementación: **`c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`**, rama `quality/e04-gates`. Requisitos R07–R10/R17. Base fija de evaluación: **`531996f51243dc3d4c5a607338e2f35e32313f6b`**.

E04 incorpora los gates al pipeline, alcanza el mínimo de cobertura frontend mediante nuevas pruebas y demuestra que un hallazgo crítico bloquea CI. **OBS-COB-001 queda cerrada.** Las obligaciones de integración real, autorización RLS, despliegue/smoke, cargas y cierre del informe/PDF siguen pendientes en sus etapas.

## 1. Ejecuciones remotas verificadas

| Ejecución | Propósito / disparador | Resultado | Pruebas de producto | Infraestructura |
| --- | --- | --- | --- | --- |
| [39677574195](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195) | Normal, `push`, sin inyecciones. | **Success**, tres jobs aprobados y diez controles del gate aprobados. | **162 aprobadas, 0 fallidas, 1 omitida**. | **41 aprobadas**, lint sin hallazgos. |
| [39677574162](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574162) | `workflow_dispatch`, `verify_gate_failure=true`. Ensayo controlado del evaluador. | **Failure**: frontend/backend aprobados; **Quality gates y resumen fallido**. | **162 aprobadas, 0 fallidas, 1 omitida**; no se provoca un fallo de suite. | **41 aprobadas**, lint sin hallazgos. |

Ambas usan el mismo commit de implementación y Ubuntu 24.04, con instalaciones nuevas y las versiones de E01/E02. Se mantienen Node 22.23.2/npm 11.21.1, CPython 3.12.14 y los lockfiles/constraints. La omisión externa es la prueba de Supabase de testing reservada a E06. No se suma infraestructura al total del producto.

La segunda ejecución añade un **diagnóstico sintético F821 a la copia descargada del reporte Ruff** antes de evaluarla. Conserva el reporte original, el modificado, hashes y una declaración explícita del ensayo. No modifica fuentes ni los artefactos originales de los componentes. Comprueba el bloqueo del mecanismo; la evidencia del **defecto funcional real** sigue siendo el rojo/verde de [E03](REGISTRO_EJECUCION_E03.md).

## 2. Implementación y efecto en el pipeline

| Archivo | Función y resultado |
| --- | --- |
| [quality/gate-policy.json](quality/gate-policy.json) | Versiona la base fija, 60 % de sentencias, 80 % nuevo, 5 % de duplicación, alcance y reglas críticas. |
| [quality/gates.py](quality/gates.py) | Lee reportes originales, valida procedencia/contenido, calcula métricas por módulo y emite decisión con numeradores/denominadores y líneas nuevas. |
| [quality/ci.py](quality/ci.py) | Integra el gate al resumen, conserva `gate.json` aun al fallar y propaga salida 1. Añade lint de infraestructura separado del producto. |
| [quality/gate_probe.py](quality/gate_probe.py) | Ensayo explícito y restringido al disparador manual; conserva el antes/después del reporte y sus hashes. |
| [.github/workflows/quality-ci.yml](.github/workflows/quality-ci.yml) | Ejecuta los gates en el job resumen, obtiene historia completa y permite el ensayo manual. Mantiene artefactos ante fallos. |
| [quality/tests/test_gates.py](quality/tests/test_gates.py) y [test_ci.py](quality/tests/test_ci.py) | Límites, reportes corruptos/ausentes, base/rutas/diff y propagación de fallo; 27 pruebas de infraestructura nuevas. |
| [front/eslint.config.mjs](front/eslint.config.mjs) | Activa explícitamente las tres reglas ESLint seleccionadas como críticas. |
| [auth-service.test.ts](front/tests/unit/auth-service.test.ts) y [recommendation-decisions.test.ts](front/tests/unit/recommendation-decisions.test.ts) | 26 pruebas adicionales sobre comportamiento existente: 19 Auth y 7 de recomendaciones. |

El flujo queda: **build/suites/análisis → artefactos originales de ambos módulos → validación y gates → resumen/estado de CI**. Un valor insuficiente, un crítico, un control fallido o una evidencia requerida inválida produce salida 1 del resumen y workflow fallido. El gate no se limita a escribir umbrales en documentación.

Se mantienen las acciones y runtimes fijados, permisos de lectura, ausencia de secretos de la cartera real y subida con `always()`. El checkout del resumen usa `fetch-depth: 0` para resolver la base. Las pruebas y el lint del evaluador también corren automáticamente en el job backend; se informan aparte del producto.

## 3. Resultados y cierre de cobertura

| Medida | E03 | E04 normal |
| --- | --- | --- |
| Pruebas frontend | 75 aprobadas, 1 omitida | **101 aprobadas, 1 omitida**. |
| Pruebas backend | 61 aprobadas | **61 aprobadas**. |
| Infraestructura | 14 aprobadas | **41 aprobadas**: 14 previas + 27 nuevas. |
| Sentencias frontend | 742 / 1.280; Vitest 57,96 % | **791 / 1.280; Vitest 61,79 %**. Cumple 60 %. |
| Líneas frontend | 694 / 1.206; 57,54 % | **743 / 1.206; 61,60 %**. |
| Ramas frontend | 504 / 1.056; 47,72 % | **554 / 1.056; 52,46 %**. Complementaria, sin umbral de ramas inventado. |
| Sentencias backend | 1.254 / 1.471; 85,25 % | **1.254 / 1.471; 85,25 %**. Cumple 60 %. |
| Nuevo frontend contra base fija | Medición incremental E03: 28 / 28 | **28 / 28 = 100 %** contra la base fija del TP. |
| Nuevo backend contra base fija | Sin gate completo aún | **15 / 17 = 88,235294… %**. Cumple 80 %. |
| Duplicación | 427 / 11.143; 3,83 % | **427 / 11.143 = 3,832002… %**, 36 clones. Cumple <= 5 %. |
| ESLint / Ruff producto | Sin hallazgos no aceptados | **Sin hallazgos no aceptados**, al igual que Ruff de infraestructura. |
| Críticos del clasificador | Sin gate completo aún | **0** en ejecución normal; **1 sintético** en el ensayo, que bloqueó. |

Se conserva el alcance frontend de **55 archivos**: `app`, `components`, `lib` con TS/TSX salvo declaraciones. Backend mantiene `ETL`, `api` y `services`. No se excluyeron archivos para aprobar ni se modificó código productivo de negocio en E04. La ampliación suma **49 sentencias frontend cubiertas**, manteniendo el denominador 1.280.

Vitest informa 61,79 % al truncar el cociente 791/1.280 = **61,796875 %**. El gate calcula desde conteos y compara productos cruzados, sin redondear antes de decidir. Los porcentajes del cuadro identifican el formato de origen; los JSON conservan los conteos y cocientes exactos que correspondan.

Las nuevas pruebas Auth verifican ausencia de configuración, login/logout, traducción de errores, sesión ausente/inválida, usuario validado, pertenencia inexistente/inactiva, errores de consulta e IDs vacíos. Se comprueban los filtros `auth_user`, `user` y `status=true`, con denegación explícita. Usan dobles; **no validan RLS remoto ni completan la integración real**.

La tabla ejecutada de recomendaciones verifica precedencia del riesgo alto, disponibilidad de contacto, mora 59/60 días y saldo 349.999/350.000, con tipo y urgencia esperados. No se escribieron pruebas que solo importan archivos para subir cobertura.

## 4. Base, código nuevo y validez de los reportes

La base fija es la del producto revisado en E00, no el último commit ni una referencia móvil. El gate rechaza cambiarla a HEAD, no poder resolverla o no encontrarla como antecesora. Los push y PR se evalúan contra la misma base; no se agrega una medición alternativa por merge-base de PR en esta etapa.

Para cada módulo se obtiene el diff con `--no-renames --unified=0`, se toman líneas añadidas/cambiadas y se intersectan con las líneas ejecutables actuales: `DA` en LCOV para frontend y `executed_lines ∪ missing_lines` en coverage.py para backend. Las eliminadas no cuentan; los archivos nuevos entran completos; un renombre es eliminación/alta completa. Rutas Windows/Linux se normalizan. Si no hay líneas nuevas ejecutables se informa «no aplica», 0 y porcentaje nulo, conservando la exigencia de reportes válidos.

Frontend mantiene las **26 líneas ejecutables del lector E03 y una llamada nueva en cada loader**. Backend incluye 17 líneas cambiadas en E01 respecto a la base fija, entre ellas imports reordenados y ajustes Ruff; 15 están cubiertas. Las dos no cubiertas son las respuestas inválidas de `bulk_insert_rows` y `fetch_existing_debts_by_key`, líneas 233 y 314 de `back/ETL/load.py`. El desglose se conserva; el umbral se decide por módulo y no por cada archivo aislado. No se altera la base para ocultarlas.

Además de la procedencia SHA/run/intento, se validan:

- Presencia y unicidad de los dos manifiestos, controles requeridos y salidas.
- JUnit legible/coherente en ambos módulos y conteos JSON de Vitest coincidentes.
- Inventario de cobertura igual al alcance de archivos de producto versionados en Git.
- LCOV completo y sin registros/líneas duplicadas; concordancia con líneas del JSON frontend.
- Totales de sentencias por archivo y globales coherentes; enteros válidos, sin denominadores negativos, vacíos inválidos ni valores cubiertos mayores al total.
- Hallazgos ESLint/Ruff y auditorías de dependencias con formato válido.

`gate.json` conserva base, HEAD, hash de política/diff, decisión por control, conteos y líneas por archivo. [Gate normal original](evidencias/e04/gate-normal.json) y [gate del ensayo](evidencias/e04/gate-critical-probe.json).

## 5. Críticos y ensayo de bloqueo

La [política](quality/gate-policy.json) clasifica como críticas ciertas reglas del analizador; Ruff no posee esa severidad nativa. ESLint: `constructor-super`, `no-unreachable`, `no-unsafe-finally` y errores fatales de parsing. Ruff: `F821`, `F822`, `F823`, `invalid-syntax`. Son fallos estructurales/de ejecución seleccionados por el proyecto. Los restantes errores/advertencias no aceptados también bloquean el control de análisis, sin llamarlos todos críticos.

En el ensayo remoto:

1. Ambos módulos instalaron, compilaron cuando correspondía y aprobaron suites/análisis originales.
2. El job resumen descargó los artefactos del mismo SHA/run/intento.
3. El input manual añadió un diagnóstico sintético F821 al reporte de trabajo, conservando el original vacío y el modificado.
4. El gate informó **un crítico**, fallaron `critical_bugs` y `static_analysis`; los otros ocho controles aprobaron.
5. La salida 1 se propagó al job resumen y al workflow. Se conservaron los tres artefactos y el reporte del ensayo.

El [registro del ensayo](evidencias/e04/ensayo-critico.json) conserva hashes, diagnóstico y 162 aprobadas/0 fallidas/1 omitida. El Ruff original del artefacto backend sigue vacío. No se describe como un defecto real de EQUITAS ni reemplaza el rojo/verde de E03.

La auditoría npm es un control separado: conserva cinco altos de desarrollo conocidos, cero críticos y cero avisos productivos; salidas crudas completa/productiva **1 / 0**. **OBS-DEP-001 sigue abierta**, con excepción exacta y vencimiento el 26/10/2026. No se extendió ni ocultó su riesgo. Cero críticos del analizador tampoco cierra DEF-SUP-001.

## 6. Pruebas del evaluador y reproducción

Los [criterios GATE-01–10 y COB-01](CASOS_E04_GATES.md) quedaron implementados y verificados. La suite de infraestructura cubre 59,99/60 % existente, 79,99/80 % nuevo, 5/5,01 % duplicación y exceso oculto por redondeo, crítico frente a estilo, datos corruptos, reportes ausentes, denominadores, base/identidad incorrectas, cero líneas nuevas, archivos eliminados/renombrados, rutas de ambos sistemas y propagación de salida. La prueba de renombre usa un repositorio Git temporal real. El lint de `quality/` y actionlint también aprobaron localmente.

Con el entorno de [REPRODUCIBILIDAD_CALIDAD.md](REPRODUCIBILIDAD_CALIDAD.md) preparado, desde la raíz:

```bash
python -m unittest discover -s quality/tests -v
python quality/ci.py run frontend --output .quality/verificacion-e04/frontend
python quality/ci.py run backend --output .quality/verificacion-e04/backend
python quality/ci.py summary --artifacts .quality/verificacion-e04 --output .quality/resumen-e04
# Solo el evaluador, reutilizando reportes del HEAD actual:
python quality/gates.py --artifacts .quality/verificacion-e04 --output .quality/gates-e04
```

Los directorios de los componentes deben estar vacíos. Repetir con otra carpeta evita reportes viejos. Para instalación nueva usar `--install` en un checkout/entorno apropiado. No mezclar reportes de otro SHA; el gate los rechaza. Los ensayos remotos se ejecutan con los comandos de [quality/README.md](quality/README.md).

## 7. Evidencia y conclusión de la etapa

Se descargaron y verificaron **seis ZIP** por SHA-256; se parsearon JSON/XML y se comprobaron índices HTML y 55 registros LCOV en cada ejecución. Los originales quedan en `.quality/e04/normal-artifacts/` y `.quality/e04/critical-probe-artifacts/`, fuera de Git. Los artefactos remotos vencen el **20/11/2026**; preservar los ZIP antes de esa fecha.

Versionados: [manifiesto, hashes y metadatos](evidencias/e04/ejecuciones-2026-10-21.json), [resumen normal](evidencias/e04/resumen-ci-normal.json), [resumen del ensayo](evidencias/e04/resumen-ci-critical-probe.json), ambos gates y el registro de inyección. Los reportes copiados provienen de GitHub, no de una reconstrucción local. La verificación local previa usó el árbol de trabajo antes de crear el commit; los artefactos remotos identifican el código versionado exacto.

**Se satisfacen los 16 controles de E04 del roadmap:** cobertura existente, cobertura nueva de ambos módulos contra base fija, duplicación, críticos, validez de evidencia, pruebas de límites, bloqueo real y CI normal aprobado. **OBS-COB-001 queda cerrada** con evidencia reproducible y control automático que detectará una caída posterior.

El clasificador es acotado y el alcance heredado excluye `front/proxy.ts`; no se afirma ausencia total de defectos ni preparación productiva completa. `release_approved=false` sigue siendo correcto: integración real, autorización RLS, despliegue/smoke, cargas e informe final requieren sus propias verificaciones. **Siguiente etapa: E05, formalizar casos, tickets y trazabilidad**, conservando los IDs y ejecuciones obtenidos.
