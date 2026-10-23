# Pruebas unitarias - TP Integrador de Calidad de Software

**Actualización E08, 23/10/2026:** estrés progresivo y sostenido completados en [pipeline](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39960952025), SHA `f6f83f9a3172fc2e42912305a181057130d9577b`, después del [CI del mismo commit](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39960952039). Se midió la API FastAPI con lógica productiva y conector sintético local: 3.600 perfiles/objetos y 72.000 deudas representadas. Ambas campañas aprobaron sus criterios previos; E08 tiene 24/24 controles. Corte acumulado: **168 aisladas + 12 externas + un smoke + dos cargas = 183 pruebas/campañas de producto**, con **66 controles de infraestructura aparte**, cero fallidas/omitidas en ese corte. Los requests no se cuentan como tests. [Ficha E08](REGISTRO_EJECUCION_E08.md), [comandos/alcance](RENDIMIENTO_CALIDAD.md), [resultados](evidencias/e08/resultados.json), [CAS-PERF #12](https://github.com/ImaDecara/Tesis-EQUITAS/issues/12). La capacidad de Vercel/Supabase/web no fue ensayada por estas cargas. E09 tiene la herramienta documentada y conserva sus demás pendientes; siguen abiertos DEF-SUP-001 original y OBS-DEP-001. Esta nota prevalece sobre estados históricos de cargas pendientes.

**Actualización E07, 23/10/2026:** etapa cerrada en Preview de `quality/tp-testing`, SHA `a6497a73b226f9d27abb4e9080d5540503d95539`. [CI](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39955381596) aprobado y [smoke automático](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39955572523) aprobado sobre el mismo commit y Supabase testing: **168 pruebas aisladas + 12 HTTP reales + 1 recorrido de navegador = 181 de producto**, cero fallidas/omitidas; **55 controles de infraestructura aparte**. El recorrido contiene cinco comprobaciones y valida realmente `/people`, su título y el listado operativo. [Ficha y límites](REGISTRO_EJECUCION_E07.md), [deployment](evidencias/e07/deployment.json), [reporte](evidencias/e07/smoke.json) y [CAS-SMOKE #10](https://github.com/ImaDecara/Tesis-EQUITAS/issues/10). E00–E07 completadas en sus alcances; sigue E08. DEF-SUP-001 permanece abierto en el original y OBS-DEP-001 conserva su vencimiento 26/10/2026. Esta actualización prevalece sobre los estados históricos de despliegue pendiente.

> **Formalización E05:** [catálogo](CASOS_PRUEBA_CALIDAD.md) con entradas, pasos, esperado/obtenido, equivalencias/límites y tablas de decisión ejecutadas; [matriz](TRAZABILIDAD_CALIDAD.md) y [tickets reales](REGISTRO_EJECUCION_E05.md). El [inventario](calidad/inventario-pruebas.json) conserva los resultados de las suites E04: documentarlos no aumenta su recuento.

> **Actualización E04, 21/10/2026:** gates implementados en `c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44`. [CI normal aprobado](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195) y [ensayo crítico controlado bloqueado](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574162), ambos con 162 pruebas de producto aprobadas, cero fallidas y una externa omitida; otras 41 de infraestructura aprobadas. Frontend **791/1.280 sentencias, 61,79 % informado por Vitest**, sobre el mismo alcance de 55 archivos. Nuevo frontend **28/28**, nuevo backend **15/17 (88,24 %)** contra la base fija `531996f…`; duplicación **3,83 %**. **OBS-COB-001 cerrada**. El gate rechaza insuficiencia, críticos y evidencia inválida; la inyección sintética demuestra el mecanismo y el defecto real conserva su evidencia E03. Ver [ficha E04](REGISTRO_EJECUCION_E04.md), [casos](CASOS_E04_GATES.md) y [evidencias](evidencias/e04/ejecuciones-2026-10-21.json). Esta actualización prevalece sobre los estados históricos de cobertura/gates pendientes. DEF-SUP-001 y OBS-DEP-001 siguen abiertos; integración real, despliegue/smoke, cargas y cierre final permanecen pendientes.

> **Actualización E03, 21/10/2026:** las secciones siguientes conservan antecedentes de la suite inicial. Con Vitest/V8 4.1.12, E03 agrega 42 pruebas de lectura completa y contratos: total vigente 75 frontend y 61 backend aprobadas, una externa omitida; 14 de infraestructura por separado. Sentencias frontend 742/1.280 = 57,96 %, backend 1.254/1.471 = 85,25 %. El mínimo global frontend sigue pendiente E04. Pruebas, cobertura nueva, comandos y rojo/verde están en [REGISTRO_EJECUCION_E03.md](REGISTRO_EJECUCION_E03.md), que prevalece para los resultados actuales.

## Alcance inicial

EQUITAS se evalua como Nivel 2: un prototipo parcial con frontend Next.js, ETL Python e integracion con Supabase. Esta etapa incorpora pruebas unitarias sin conectarse a Supabase ni ejecutar cargas reales.

## Herramientas

- Frontend: Vitest 3 con proveedor de cobertura V8 y `vite-tsconfig-paths`.
- Backend/ETL: Pytest 8 y `pytest-cov`.
- Cobertura: HTML, JSON y salida de consola para el frontend; terminal y HTML para el backend.

## Archivos de prueba

- `front/tests/unit/pagination.test.ts`: tamanos, paginas invalidas, limites y listado vacio.
- `front/tests/unit/risk-and-aging.test.ts`: bandas de riesgo, entradas invalidas, vencimientos y antiguedad.
- `front/tests/unit/debtor-mapper-and-selectors.test.ts`: mapeo de objetos, prioridad, contacto y resumen de mora.
- `back/tests/test_extract.py`: TSV sinteticos y limite de objetos.
- `back/tests/test_transform.py`: normalizacion, payloads, riesgo, perfil individual y deduplicacion del resumen.
- `back/tests/test_load_unit.py`: clave de deuda, comparacion de payloads y carga bulk simulada.

## Aislamiento de datos

`back/tests/conftest.py` establece URL y clave de prueba antes de importar el ETL. Las pruebas no invocan metodos HTTP de Supabase: las operaciones de carga se reemplazan por doubles mediante `monkeypatch`.

## Comandos

Desde `front`:

```powershell
npm run test
npm run test:coverage
```

Desde `back`:

```powershell
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m pytest --cov --cov-report=term-missing --cov-report=html
```

## Resultados y cobertura inicial

Ejecucion realizada el 16 de octubre de 2026:

| Suite | Comando de validacion | Pruebas aprobadas | Pruebas fallidas |
| --- | --- | ---: | ---: |
| Frontend | `npm run test:coverage` | 14 | 0 |
| Backend / ETL | `python -m pytest --cov --cov-report=term-missing --cov-report=html` | 13 | 0 |
| Total | Ambos comandos | 27 | 0 |

La medicion cubre todo el codigo productivo configurado; no se excluyeron modulos para elevar artificialmente los resultados.

| Area | Alcance medido | Sentencias | Ramas | Funciones | Lineas |
| --- | --- | ---: | ---: | ---: | ---: |
| Frontend | `app/`, `components/` y `lib/` | 12,03 % | 58,64 % | 60,71 % | 12,03 % |
| Backend / ETL | `ETL/`, `api/` y `services/` | 26,83 % (395/1472) | 17,27 % (86/498) | No informado por Coverage.py | 24,42 % combinado |

El objetivo del Nivel 2 (60 % de cobertura sobre codigo existente) queda como meta posterior. Los primeros modulos que conviene ampliar son las rutas y componentes del frontend, `ETL/run_etl.py`, `ETL/load.py`, `ETL/export_preview.py`, `ETL/inspect.py`, `api/main.py` y `services/scoring.py`.

Los reportes locales se generan en `front/coverage/` y `back/htmlcov/`; se ignoran en Git porque son artefactos reproducibles.

## Problemas detectados durante el relevamiento

- Las lecturas del frontend limitan cada tabla a 3.000 filas, por lo que paneles y listados pueden quedar incompletos para carteras mayores.
- No hay pruebas, cobertura ni CI previos.
- El esquema, las migraciones y las politicas RLS no estan versionados en el repositorio.
- La cobertura inicial aun es menor a la meta futura del Nivel 2, principalmente porque las pantallas, servicios de integracion y orquestacion ETL todavia no tienen pruebas automatizadas.
- `npm install` informa 19 vulnerabilidades en dependencias transitivas (1 baja, 2 moderadas, 12 altas y 4 criticas). No se aplicaron actualizaciones automaticas durante esta etapa de pruebas.
- No se detectaron fallas funcionales en las 27 pruebas unitarias incorporadas; las pruebas no cubren conectividad real con Supabase ni cargas ETL reales por diseno.

## Actualización de cobertura y regresión

Ejecución ampliada realizada el 16 de octubre de 2026, sin reducir el alcance de código medido:

| Suite | Aprobadas | Fallidas | Omitidas | Cobertura de sentencias |
| --- | ---: | ---: | ---: | ---: |
| Frontend | 33 | 0 | 1 | 60,43 % |
| Backend / ETL / API | 61 | 0 | 0 | 85,26 % (1255/1472) |
| Total | 94 | 0 | 1 | — |

Se añadieron pruebas para pantallas principales con datos simulados, carga extendida, scoring, endpoints FastAPI, exportación e inspección TSV. El frontend mantiene 61,86 % de ramas y el backend 68,07 % de ramas. Por lo tanto, el objetivo de 60 % de sentencias del Nivel 2 se cumple de manera independiente en ambos módulos. El detalle consolidado y la trazabilidad están en `INFORME_TP_CALIDAD_SOFTWARE.md`.
