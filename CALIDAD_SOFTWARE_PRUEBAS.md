# Pruebas unitarias - TP Integrador de Calidad de Software

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
