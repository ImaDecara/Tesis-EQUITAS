# E03 — Lectura completa y defecto real con rojo/verde

**Fecha:** 21/10/2026. **Responsable:** Axel Azcune (`AxAzc`). **Estado:** completada en su alcance.

Entrada: E02 cerrada en `00bc9971a6b1a5a396c0b1624eab74735d9089d2`. Requisito **R-DAT-01**, defecto **DEF-DAT-001**. Rama de evidencia: `quality/e03-lectura-completa`.

Se corrigió el truncamiento de las lecturas de objetos y personas, se conservaron pruebas fallidas sobre el código anterior y se verificó la corrección en CI. El caso de aceptación exige recuperar **3.507 filas, sin omisiones ni duplicados**, en ambas rutas. E03 aporta la evidencia funcional rojo/verde del TP; el cierre integral de la entrega sigue sujeto a E04–E11.

## 1. Versiones y ejecuciones comprobadas

| Momento | Commit | Ejecución y resultado | Pruebas de producto |
| --- | --- | --- | --- |
| Rojo: pruebas nuevas sobre producto anterior | `f155cfc1616c8edeacd533241c5dc2858745734a` | [39672114249](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39672114249), **failure**. Frontend y resumen fallaron; backend aprobó. | **95 aprobadas, 4 fallidas, 1 omitida**. |
| Verde: producto corregido y regresión ampliada | `3bfe15688a72360b336b7d8732867c6991a1d42e` | [39673351642](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39673351642), **success**. Los tres jobs aprobaron. | **136 aprobadas, 0 fallidas, 1 omitida**: 75 frontend y 61 backend. |

Las **14 pruebas de infraestructura** aprobaron en ambas ejecuciones y se informan por separado. La prueba omitida requiere Supabase de testing: permanece pendiente para E06. Las dos ejecuciones usaron `push`, Ubuntu 24.04 y `verify_failure=false`; no se inyectó un fallo artificial.

El commit rojo no modifica `front/lib`. Primero se publicaron los [criterios de aceptación](CASOS_E03_LECTURA_COMPLETA.md), la fixture HTTP y las cuatro variantes DAT-06, conservando el producto defectuoso. La prueba FIXTURE-01 aprobó y verificó límite, orden y cursor con el SDK real; las cuatro fallaron específicamente por filas ausentes. Instalación, build, lint y restantes controles independientes aprobaron también en el rojo.

El bloque `describe` original de aceptación se conserva sin cambios en el verde, con SHA-256 `90a42c73c1deb3a6928434d30ed6f4ecc58d7a24636164eff268c9e7491a378d`. Se agregaron casos adicionales y se actualizaron dobles antiguos para soportar consultas paginadas, manteniendo sus aserciones de datos/advertencias. El detalle de cada fallo está en [aserciones-red.json](evidencias/e03/aserciones-red.json).

## 2. Problema y corrección productiva

Ambos loaders ejecutaban una única consulta `.select('*').limit(3000)`. El servidor puede imponer un máximo inferior al solicitado, por lo que ni siquiera estaba garantizada la recuperación de las primeras 3.000 filas. El volumen real observado —56.286 deudas y 3.007 relaciones objeto–persona— supera ese límite. La paginación visual posterior solo recorría lo ya descargado.

Se incorporó [paginated-table-reader.ts](front/lib/data/paginated-table-reader.ts), usado por [raw-debtor-loader.ts](front/lib/data/raw-debtor-loader.ts) y [person-data-service.ts](front/lib/services/person-data-service.ts):

1. Solicita hasta **1.000 filas por request**, ordenadas por `id` ascendente.
2. Continúa con `id > último_id` hasta recibir una página vacía. Los huecos en los IDs no afectan el recorrido. Una página corta no se interpreta como fin, porque puede corresponder a un límite inferior del servidor.
3. Valida claves enteras y crecimiento estricto del cursor. Soporta bigint recibido como texto sin convertirlo a un número impreciso. Una clave inválida, orden incorrecto, duplicado o cursor repetido produce advertencia y detiene la tabla.
4. Acumula todas las filas de la tabla sin un límite total fijo. Conserva el mismo cliente, sesión y políticas RLS en todas las consultas.
5. Ante error de API o transporte descarta el conjunto parcial de la tabla afectada y devuelve su advertencia. Las demás tablas mantienen sus resultados independientes. Se conserva el contrato `rows + warning` y la identificación de errores de permisos.

El tamaño 1.000 controla cada request; no recorta la cartera total. Las nueve tablas involucradas tienen PK bigint `id` no nula en el [snapshot observado](database/schema-observado-2026-10-21.json). Se mantienen las ocho tablas de objetos y las seis de personas, con sus relaciones y mappers existentes. La implementación compartida también elimina código duplicado de manejo de errores y configuración.

Fuentes oficiales consultadas: [orden estable al paginar](https://supabase.com/docs/reference/javascript/using-modifiers-range), [filtro gt](https://supabase.com/docs/reference/javascript/using-filters-gt), [límite](https://supabase.com/docs/reference/javascript/using-modifiers-limit) y [changelog](https://supabase.com/changelog). Se mantienen las versiones fijadas en E01.

## 3. Comparación con el mismo conjunto conocido

El dataset sintético tiene 3.507 filas, IDs `3 × (índice + 1)` y orden físico inverso. La expectativa se calcula desde ese conjunto completo, sin usar como resultado esperado el límite pedido por el cliente.

| Ruta | Máximo del servidor | Recuperadas antes | Omitidas antes | Recuperadas después | Omitidas después | Duplicadas antes/después |
| --- | --- | --- | --- | --- | --- | --- |
| Objetos | 1.000 | 1.000 | 2.507 | **3.507** | **0** | 0 / 0 |
| Objetos | 3.000 | 3.000 | 507 | **3.507** | **0** | 0 / 0 |
| Personas | 1.000 | 1.000 | 2.507 | **3.507** | **0** | 0 / 0 |
| Personas | 3.000 | 3.000 | 507 | **3.507** | **0** | 0 / 0 |

**Completitud = recuperadas / esperadas × 100**: pasa de 28,51 % o 85,54 %, según el límite efectivo, a **100 %**. **Omisiones = IDs esperados ausentes**: pasan de 2.507 o 507 a **0**. Las cuatro variantes conservan cero duplicados. Los valores provienen de los logs `E03_DAT_06` de ambos artefactos, conservados en [comparacion-dat-06.json](evidencias/e03/comparacion-dat-06.json).

No se atribuyen esas cifras a una sesión de la interfaz real: son resultados reproducibles de un conjunto sintético. Los conteos reales solo justificaron la relevancia del defecto.

## 4. Casos implementados y alcance de la regresión

Se agregaron **42 pruebas frontend**: 22 en [complete-data.integration.test.ts](front/tests/integration/complete-data.integration.test.ts) y 20 en [paginated-table-reader.test.ts](front/tests/unit/paginated-table-reader.test.ts). El total frontend pasó de 33 a 75 aprobadas y conserva una omitida externa. Los IDs agrupan variantes; no equivalen uno a uno a la cantidad de pruebas parametrizadas.

| Casos | Qué se ejecutó y verificó |
| --- | --- |
| FIXTURE-01 | SDK Supabase real y transporte HTTP sustituido. Verifica que las consultas generan límite, orden y cursor esperados. |
| DAT-01–05 | Ambas rutas con 0, 7, 1.000, 1.001 y 2.000 filas. Completitud, orden, unicidad y fin: `ceil(N / 1000) + 1` consultas a la tabla principal, incluida la consulta vacía final. |
| DAT-06 | Las cuatro combinaciones del rojo/verde anterior, sin cambiar sus expectativas. |
| DAT-06-L | Ambas rutas con máximo de **137** filas del servidor y 3.507 esperadas: recupera todas y termina tras 27 consultas a la tabla principal. |
| DAT-07 / DAT-07-T / DAT-07-C | Errores de permisos, de API y de transporte después de una página válida; excepciones del cliente. Descarta filas parciales, informa la causa y conserva tablas independientes. Los reintentos GET del SDK se ejecutan con reloj simulado en el caso de transporte. |
| DAT-08 objetos | 3.507 deudas de importe original 2 y 3.507 personas, relaciones y contactos. Dashboard y objeto obtienen **7.014** de deuda y los conteos completos. |
| DAT-08 personas | Recupera 3.507 personas. La última página aporta persona `10521`, riesgo 99, contacto activo y deuda asociada 7.014; tablero con un riesgo alto y cero personas sin contacto. |
| DAT-09–14 | Sin cliente/credenciales, bigint en texto, claves inválidas, cursor no creciente, página inválida y contrato de advertencias/RLS. |

La fixture sustituye únicamente `fetch`, sobre respuestas HTTP sintéticas; las consultas las construye `@supabase/supabase-js` instalado. No se sustituye el lector productivo ni el mapper bajo verificación. La prueba antigua del loader usa ahora esa fixture: conserva sus resultados esperados y cuenta diez requests en el caso con dos tablas no vacías, debido a las consultas terminales adicionales.

## 5. Build, análisis y cobertura

Antes del push se ejecutó el runner frontend local en Windows y aprobó sus siete controles: dependencias, pruebas, lint, build/TypeScript, duplicación, complejidad y auditoría con la política vigente. Esa medición se hizo con cambios aún sin commit; el manifiesto identifica ese contexto. El CI verde posterior verifica el SHA exacto de la corrección y las instalaciones nuevas Linux de ambos módulos.

| Medida | E02, antes de E03 | Verde de E03 |
| --- | --- | --- |
| Sentencias frontend | 586 / 1.275 = 45,96 % | **742 / 1.280 = 57,96 %**, todavía menor a 60 %. |
| Ramas frontend | 415 / 1.055 = 39,33 % | **504 / 1.056 = 47,72 %**. |
| Líneas frontend | 548 / 1.204 = 45,51 % | **694 / 1.206 = 57,54 %**. |
| Sentencias backend | 1.254 / 1.471 = 85,25 % | **1.254 / 1.471 = 85,25 %**. |
| Duplicación por líneas | 474 / 11.182 = 4,24 %, 38 clones | **427 / 11.143 = 3,83 %, 36 clones**. |
| ESLint / Ruff | 0 hallazgos no aceptados | 0 errores/advertencias frontend y 0 hallazgos backend no aceptados. Se conservan excepciones locales E01. |
| Auditoría npm | Cinco altos de desarrollo abiertos | Misma cadena: cinco altos, cero críticos; productivas sin avisos. Salidas crudas 1 / 0; OBS-DEP-001 sigue abierta. |

El alcance frontend mantiene `app`, `components` y `lib`: pasa de 54 a **55 archivos** al incorporar el lector. La mejora de cobertura global no es una comparación con las cifras históricas de Vitest 3. La duplicación se mide con los mismos criterios de jscpd y el alcance frontend/backend de E02; se informa el denominador cambiado.

El lector nuevo obtiene **29/29 sentencias, 26/26 líneas y 3/3 funciones**, todas al 100 %; **32/33 ramas = 96,96 %**. La rama no cubierta es el valor alternativo de `response.data ?? []` cuando no hay datos ni error; los casos de tabla vacía sí pasan con array vacío. Se informa como límite de la medición.

La intersección de líneas agregadas/cambiadas por E03 con las líneas ejecutables `DA` de LCOV da **28/28 cubiertas = 100 %**: 26 del lector y una nueva llamada en cada loader. Se usó `git diff --no-renames --unified=0 00bc997… 3bfe156… -- front/lib`; líneas eliminadas, imports y líneas sin entrada ejecutable LCOV no integran ese denominador. El [detalle por archivo](evidencias/e03/cobertura-incremental.json) conserva líneas, numeradores y base.

Esta medición incremental documenta E03. **E04 aún debe implementar y probar el gate automático**, usando como base fija del TP `531996f51243dc3d4c5a607338e2f35e32313f6b`, con cobertura nueva de ambos módulos, duplicación, críticos y rechazo de reportes inválidos. **OBS-COB-001 continúa abierta**: el frontend está a 57,96 %, por debajo del 60 %. El resumen de CI conserva `release_approved=false`.

## 6. Evidencias conservadas y reproducción

- [Manifiesto de ejecuciones, versiones, controles, hashes y artefactos](evidencias/e03/ejecuciones-2026-10-21.json).
- [Resumen original rojo](evidencias/e03/resumen-ci-red.json) y [resumen original verde](evidencias/e03/resumen-ci-green.json).
- [Comparación DAT-06](evidencias/e03/comparacion-dat-06.json), [aserciones fallidas originales](evidencias/e03/aserciones-red.json) y [ausencia de fallos en verde](evidencias/e03/aserciones-green.json).
- [Cobertura incremental y ramas del lector](evidencias/e03/cobertura-incremental.json).

Se descargaron los **seis ZIP**, tres por ejecución. Sus SHA-256 coinciden con los digests de GitHub. Se parsearon los reportes JSON/XML, se comprobaron los índices HTML y los registros LCOV: 54 archivos en rojo y 55 en verde. Los ZIP y reportes completos quedan en `.quality/e03/red-artifacts/` y `.quality/e03/green-artifacts/`, directorios ignorados. Los resúmenes anteriores sí están versionados. Los artefactos remotos vencen el **20/11/2026**, según sus timestamps exactos del manifiesto; conservar los originales antes del vencimiento.

Desde `front`, con el entorno de [REPRODUCIBILIDAD_CALIDAD.md](REPRODUCIBILIDAD_CALIDAD.md) preparado:

```powershell
# Regresión específica de E03: 42 pruebas.
npx --yes --package=npm@11.21.1 npm exec --no -- vitest run tests/integration/complete-data.integration.test.ts tests/unit/paginated-table-reader.test.ts

# Suite completa con cobertura; conserva la omisión externa hasta E06.
npx --yes --package=npm@11.21.1 npm run test:coverage
```

Para observar el rojo sin alterar la versión actual, consultar su ejecución o preparar un checkout separado del commit `f155cfc…` e instalar con su lockfile. Los cuatro DAT-06 deben fallar por la cantidad de filas. No es necesario revertir la corrección en `main`. El workflow de CI se dispara con push y produce todos los reportes definidos en E02.

## 7. Cierre y continuidad

**DEF-DAT-001 queda corregido y validado mediante regresión automatizada aislada en ambas rutas y sus relaciones.** Se mantienen pruebas que lo volverán a detectar. No se cambió Supabase, no se desplegó esta corrección ni se comprobaron importes de una sesión real en esta etapa. Su validación en el entorno de aplicación sigue dentro de E06/E07.

Las lecturas de varias páginas no forman una transacción de snapshot: con datos cambiando durante el recorrido puede ser necesario refrescar o adoptar un mecanismo transaccional. Las filas se materializan en memoria; no se afirma una mejora de latencia ni capacidad de carga. E08 evaluará rendimiento según su escenario.

Se completaron los **27 controles de E03** del roadmap: aceptación previa, rojo real, corrección de ambas rutas, límites/negativos, regresión, cobertura, comparación y evidencia. **DEF-SUP-001, OBS-DEP-001 y OBS-COB-001 siguen abiertos**. La siguiente etapa habilitada es **E04: ampliar pruebas hasta el mínimo y construir/verificar los quality gates completos**. El informe académico final y PDF se consolidan en E10.
