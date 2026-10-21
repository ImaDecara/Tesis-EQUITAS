# E01 — Reproducibilidad, dependencias y análisis estático

**Fecha:** 21/10/2026. **Responsable:** Axel Azcune (`AxAzc`). **Estado:** completada en su alcance.

E00 quedó cerrada y publicada en `a96b48281b1782c71cbc9f48407cf1dcc19dd52b`, versión de entrada a esta etapa. La base de producto para la evaluación del TP continúa siendo `531996f51243dc3d4c5a607338e2f35e32313f6b`.

E01 deja una instalación comprobada desde cero, dependencias controladas, análisis con tratamiento explícito y una regresión aprobada. **Esto no habilita todavía la entrega:** faltan CI, gates, correcciones funcionales, integración real, smoke, cargas y el informe final. La nueva medición frontend queda por debajo de la meta de cobertura y requiere trabajo antes de cerrar E04.

## 1. Cambios realizados y motivo

| Cambio | Motivo y alcance |
| --- | --- |
| Node 22.23.2 en `.nvmrc`; npm 11.21.1 en `front/package.json`. | Identificar herramientas de reproducción. npm se ejecutó mediante `npx`, sin modificar la instalación global. |
| Next y `eslint-config-next` 16.2.6 → 16.4.2. | Corregir vulnerabilidades y mantener alineada la configuración del framework. |
| Vitest y su proveedor V8 3.2.4 → 4.1.12; Vite 7.3.7 explícito. | Corregir avisos del runner/mocker y eliminar la dependencia de Tinypool presente en la versión anterior. Se eligió una versión corregida de la serie 4; no se requiere migrar a la serie 5 para esta etapa. |
| Supabase JS 2.105.4 y SSR 0.10.3 fijados sin rangos. | Conservar las versiones existentes con instalación controlada. No se modificaron llamadas, políticas ni datos remotos. |
| Lockfile frontend regenerado y verificado con `npm ci`. | Conservar versiones transitivas e integridad. No se ejecutó `npm audit fix --force`. |
| Python 3.12.14 en `back/.python-version`; dependencias directas y de pruebas exactas. | Evitar resolver versiones desconocidas en cada instalación. |
| `back/constraints.txt`. | Fijar las transitivas observadas y verificadas; añadir `uvloop==0.23.0` condicionado para CPython fuera de Windows, usado por el extra de Uvicorn en Linux. Un constraint limita versiones: no instala por sí solo paquetes de otra plataforma. |
| `back/ruff.toml`. | Exigir Ruff 0.17.1 y resolver imports propios de forma estable desde `back` o desde la raíz. Se conservaron las **407 reglas habilitadas** de la línea base. |
| Limpieza de ocho archivos Python. | Orden de imports, imports sin uso, cálculo local sin consumo, conversión redundante, alias UTC, comprensión de conjunto y pertenencia a diccionario. No se cambiaron reglas de riesgo, endpoints ni contratos del ETL. |
| Migración mínima de `vitest.config.ts`. | Retirar `coverage.all`, eliminado en Vitest 4. Se mantuvo `coverage.include`, que incluye también los archivos no ejecutados dentro del alcance declarado. |

Las instrucciones locales y las guías oficiales se consultaron antes de la actualización. No se introdujeron cambios de funcionalidad frontend, nuevas pruebas ni cambios del caso de paginación reservado para E03.

## 2. Resultado comprobado

| Control | Antes de E01 | Después de E01 |
| --- | --- | --- |
| Vitest | 33 aprobadas, 1 omitida. | **33 aprobadas, 0 fallidas, 1 omitida**. |
| Pytest | 61 aprobadas. | **61 aprobadas, 0 fallidas**, en un entorno nuevo. |
| Total | 94 aprobadas, 1 omitida. | **94 aprobadas, 0 fallidas, 1 omitida**. |
| Build / TypeScript | Aprobado con Next 16.2.6. | **Aprobado con Next 16.4.2**. |
| ESLint | 0 errores y advertencias. | **0 errores, 0 advertencias**, 70 archivos. |
| Ruff | 19 hallazgos, salida 1. | **16 tratados mediante corrección y 3 excepciones locales justificadas**; salida normal 0. Sin las excepciones: 3 TRY004, salida 1. |
| Auditoría npm completa | 19: 4 críticos, 12 altos, 2 moderados, 1 bajo. | **5 altos, 0 críticos**, todos de desarrollo y derivados de un mismo aviso sin parche. La auditoría completa sigue devolviendo 1. |
| Auditoría npm productiva | Sin separación en la tabla inicial. | **0 vulnerabilidades informadas**, salida 0. No demuestra ausencia absoluta de vulnerabilidades. |
| `pip check` | Dependencias compatibles. | **Sin dependencias incompatibles** en el entorno nuevo. No es una auditoría de vulnerabilidades Python. |
| Duplicación por líneas | 474 / 11.188 = 4,24 %, 38 clones; jscpd 5.4.1. | **474 / 11.182 = 4,24 %**, 38 clones; jscpd 5.4.2. Mismo alcance y parámetros. |
| Complejidad máxima reportada por jscpd | CX 119, `transform.py`. | CX **118**, mismo archivo; mapper 109, scoring 98 y load 97. No sustituye una evaluación de mantenibilidad. |

La única prueba omitida sigue siendo Auth contra Supabase de testing por falta de configuración del entorno de E06. Se mantiene una advertencia de Starlette/TestClient sobre el uso de `httpx`; no se ocultó mediante filtros.

## 3. Cobertura: cambio de medición y obligación pendiente

| Métrica | Línea base | Nueva medición |
| --- | --- | --- |
| Frontend, sentencias | 3.372 / 5.580 = 60,43 %. | **586 / 1.275 = 45,96 %**. |
| Frontend, ramas | 292 / 472 = 61,86 %. | **415 / 1.055 = 39,34 %** aproximadamente; la consola trunca a 39,33 %. |
| Frontend, funciones | 74 / 135 = 54,81 %. | **153 / 326 = 46,93 %**. |
| Backend, sentencias | 1.255 / 1.472 = 85,26 %. | **1.254 / 1.471 = 85,25 %**. |
| Backend, ramas | 339 / 498 = 68,07 %. | **339 / 498 = 68,07 %**. |
| Backend, combinada | 80,91 %, redondeada a 81 %. | **80,90 %**, redondeada a 81 %. |

Vitest 4 utiliza un mapeo V8 basado en AST que cambia los elementos contabilizados. La comparación de nombres confirmó **los mismos 54 archivos** en ambos reportes. Se conservaron `app/`, `components/` y `lib/`, la exclusión de `.d.ts` y la ausencia histórica de `proxy.ts` en ese alcance. No se retiraron pantallas ni archivos sin cobertura para mejorar el porcentaje.

Los porcentajes de ambos métodos no forman una serie homogénea de mejora o deterioro del producto. La regresión mantiene las mismas aserciones aprobadas; la nueva herramienta expone una insuficiencia de cobertura que debe atenderse. **La cifra vigente para los siguientes gates es 45,96 %; R07 frontend no cumple hoy el 60 %.** Se registra **OBS-COB-001**, a resolver con pruebas significativas antes del cierre de E04. No se vuelve al runner vulnerable ni se usa el resultado histórico para aprobar el gate actual.

En backend se retiró un cálculo de monto original que no se usaba ni se devolvía; el reporte cuenta una sentencia cubierta menos. La pequeña variación no representa una regresión de pruebas.

## 4. Triage de Ruff

La severidad de esta tabla es una valoración técnica interna. El campo `severity=error` de la salida Ruff no equivale a severidad crítica de negocio.

| Regla | Cantidad inicial | Severidad interna / tipo | Tratamiento |
| --- | --- | --- | --- |
| I001 | 8 | Baja; organización de imports. | Ordenados los ocho bloques; regresión completa aprobada. |
| F401 | 2 | Baja; imports sin uso en preview. | Eliminados `build_address_payload` y `build_city_payload` de los imports de preview. No se eliminaron sus funciones. |
| F841 | 1 | Media; cálculo local sin consumo en perfil. | Revisado el payload y retirado el cálculo de `original_debt_amount` y su lista auxiliar. El contrato utiliza monto actual y vencido; no se agregó una columna a la base. |
| C401 | 1 | Baja; construcción redundante. | Comprensión de conjunto equivalente, conservando conversión a entero y filtrado previo. |
| UP035 | 1 | Baja; import moderno. | `Callable` desde `collections.abc`. |
| RUF046 | 1 | Baja; conversión redundante. | `round` sin argumento de precisión ya devuelve un entero. |
| UP017 | 1 | Baja; alias equivalente. | `datetime.UTC`; CPython 3.12 soporta ese alias. |
| SIM118 | 1 | Baja; pertenencia a diccionario. | Iteración directa del diccionario. |
| TRY004 | 3 | Baja; convención de excepciones frente a contrato externo. | **Excepciones locales aceptadas**, detalladas debajo. No hay exclusión global de la regla. |
| **Total** | **19** | **1 media, 18 bajas**. | **16 corregidos, 3 aceptados; 0 críticos detectados por este triage**. |

Las tres excepciones están únicamente en `get_first_response_row`, `bulk_insert_rows` y `fetch_existing_debts_by_key`, dentro de `back/ETL/load.py`. Validan respuestas remotas inválidas: se conserva `RuntimeError`, usado por el contrato de fallos de operación y por la prueba existente de respuesta inválida. Convertirlo en `TypeError` cambiaría el comportamiento observable por una preferencia de estilo. Cada línea tiene comentario y `# noqa: TRY004`; el reporte ejecutado con `--ignore-noqa` conserva y permite auditar las tres observaciones.

Responsable de estas decisiones: Axel Azcune. Revisarlas si se cambia el contrato del cargador. El ensayo de Ruff con `--fix` se limitó a correcciones seguras; los cambios de cálculo y comprensión se revisaron manualmente. No se usó `--unsafe-fixes`.

## 5. Auditoría de dependencias y riesgo residual

Los JSON conservan los 19 paquetes afectados iniciales y los cinco actuales, con rutas, avisos y versiones. «Paquetes afectados» no equivale al número de CVE ni a defectos funcionales diferentes.

| Grupo inicial | Paquetes | Tratamiento y situación actual |
| --- | --- | --- |
| Framework productivo, crítico y altos | `next`, `postcss`, `sharp`. | Next 16.4.2 y transitivas corregidas en el nuevo lock. Auditoría productiva final sin avisos. No se afirmó explotación de cada aviso en esta aplicación. |
| Herramientas de pruebas, críticos y moderado | `vitest`, `@vitest/coverage-v8`, `tinypool`, `@vitest/mocker`. | Vitest/V8 4.1.12; Tinypool ya no está en el árbol. Suites y reporte de cobertura comprobados. |
| Otras transitivas, bajo/moderados/altos | `@babel/core`, `baseline-browser-mapping`, `brace-expansion`, `browserslist`, `js-yaml`, `nanoid`, `source-map-js`. | Resueltas versiones corregidas compatibles al regenerar el lock. Ya no aparecen en la auditoría final. |
| Linter de desarrollo, altos | `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces`. | **Permanecen cinco paquetes afectados por una misma cadena**: GHSA-vfj7-8cjw-p6xm. `braces` 3.0.3 no tiene parche publicado al verificar. npm propone bajar `eslint-config-next` a 14.2.35; se conserva la configuración compatible con Next 16 y se registra la excepción temporal. |

**OBS-DEP-001:** severidad alta según el aviso; permanece abierta, con tratamiento temporal para el alcance del TP. El riesgo es denegación de servicio al procesar patrones de llaves profundamente anidados. La cadena observada pertenece al linter de desarrollo y no aparece en la auditoría `--omit=dev`; los patrones del análisis están bajo control del repositorio. Esta evaluación no rebaja la severidad del proveedor ni declara corregido el problema.

Responsable: Axel Azcune. Revisión obligatoria en E02 y E11, y antes del 26/10/2026 o ante una versión corregida, lo que ocurra primero. Mantener logs/reportes, no aceptar patrones externos en el linter, ejecutar CI en runners acotados y revisar cualquier cambio de la cadena. Un aviso nuevo, productivo o crítico requiere nuevo triage. **La auditoría completa conserva su salida 1**; E04 deberá aplicar una política explícita y procesable, no ignorar su código de salida.

Avisos de mantenimiento separados: ESLint 9.39.5 está fuera de mantenimiento y `tsconfck` 3.1.6 está abandonado. Se conservan en este corte reproducible porque `eslint-plugin-react` 7.37.5 declara compatibilidad hasta ESLint 9; una actualización coordinada de estas herramientas queda registrada como mantenimiento, con revisión en E11. npm 11 también avisa de scripts de instalación de `esbuild` y `unrs-resolver` sin política `allowScripts` declarada; la instalación y los controles finalizaron correctamente. No se convirtió ese aviso en un fallo funcional ni se amplió una autorización global de scripts.

## 6. Instalación nueva y problemas de preparación tratados

1. Se creó un entorno CPython 3.12.14 vacío y se instaló `back/requirements-dev.txt`, que incorpora los requisitos productivos y sus constraints. Los paquetes instalados coincidieron con los pins de la línea base; `pip check` y las 61 pruebas aprobaron.
2. npm 10.9.8 falló con `Cannot read properties of null (reading 'edgesOut')` al resolver los peers de Vitest. El fallo también apareció con un árbol limpio. Se actualizó la herramienta de reproducción a npm 11.21.1; no se desactivó la comprobación de peers.
3. Se regeneró el lock y se instaló `front` sin su `node_modules` anterior mediante `npm ci` de npm 11.21.1. La instalación final terminó con salida 0; el SHA-256 del lock no cambió: `e55c95b363b8be552f0eabdb363c5902f6b0fd84eb8edba9fd134b163fbe809b`.
4. `npm ls --all` terminó con salida 0; no se encontraron dependencias inválidas o faltantes. Se ejecutaron suites, análisis, build y métricas sobre ese árbol.

Una evaluación intermedia con npm 12 encontró una política nueva de descargas por URL; no forma parte de la configuración elegida. La herramienta final y comprobada es **npm 11.21.1**.

La instalación y ejecución nuevas están comprobadas en **Windows x64**. El archivo contempla la dependencia condicional de Uvicorn en Linux, pero **la ejecución Linux todavía debe verificarse en E02**. No se presenta una descarga o una resolución como una prueba de ejecución en otro sistema.

El build conserva `next/font/google` para Geist: requiere acceso HTTPS a Google Fonts durante la compilación; después sirve las fuentes desde la aplicación. El runner de CI necesita esa conectividad. Un fallo de red debe conservar su salida y diagnosticarse; no cuenta como la regresión funcional rojo/verde exigida por la consigna.

## 7. Reproducción y evidencias

Seguir [REPRODUCIBILIDAD_CALIDAD.md](REPRODUCIBILIDAD_CALIDAD.md). La evidencia publicable está en [evidencias/e01/resumen-2026-10-21.json](evidencias/e01/resumen-2026-10-21.json), junto con auditorías completas y reportes Ruff antes, después y de excepciones.

Los logs completos, XML de pruebas, cobertura por archivo, reportes HTML y reportes de jscpd de esta ejecución quedan localmente en `.quality/e01/`, `front/coverage/`, `back/htmlcov/` y `.quality/jscpd/`. E02 incorporará exportación y retención de artefactos por pipeline. Los JSON publicables no contienen filas de la cartera, contraseñas ni rutas privadas del intérprete.

Para conocer el commit que publica este cierre sin autorreferencias de SHA:

```powershell
git log -1 --format='%H %s' -- REGISTRO_EJECUCION_E01.md
```

## 8. Salida y siguiente etapa

E01 tiene instalación nueva comprobada, versiones conocidas, regresión/build aprobados y tratamiento de los controles fallidos. Se conservaron sus limitaciones: auditoría de desarrollo con cinco altos, integración real omitida y cobertura frontend insuficiente bajo el nuevo método.

**Siguiente etapa: E02**, crear y ejecutar el pipeline base con reportes y versión de Linux comprobada. Debe mostrar la cobertura real y el riesgo residual. **E04 no puede cerrarse mientras OBS-COB-001 siga abierta**; antes será necesario ampliar pruebas significativas hasta superar el 60 % frontend y comprobar el 80 % de código nuevo. DEF-DAT-001 y DEF-SUP-001 continúan abiertos para sus etapas E03/E06.

## Fuentes técnicas consultadas

- [Migración y cobertura de Vitest 4](https://v4.vitest.dev/guide/migration.html): mapeo AST, retirada de `coverage.all` y de Tinypool.
- [Actualización de Next.js 16](https://nextjs.org/docs/app/guides/upgrading/version-16), además de la documentación incluida en el paquete instalado.
- [Configuración de Ruff](https://docs.astral.sh/ruff/settings/): versión requerida, imports y excepciones locales.
- [Instalaciones repetibles con pip](https://pip.pypa.io/en/stable/topics/repeatable-installs/): versiones directas y transitivas fijadas.
- [Aviso GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): versiones afectadas y ausencia de parche.
- [Soporte de versiones de ESLint](https://eslint.org/version-support/): situación de la serie 9.
