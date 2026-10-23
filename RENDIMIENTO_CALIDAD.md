# Ejecutar y revisar las cargas de E08

**Actualización E11, 23/10/2026:** validación técnica integral aprobada sobre `5b62c14`: cuatro jobs obligatorios, 180 pruebas de producto, nuevo Preview/smoke y dos cargas del mismo SHA; acumulado **183**, con **66 controles de infraestructura aparte**. [Manifiesto portable](evidencias/e11/validacion-integral.json), [ficha](REGISTRO_EJECUCION_E11.md), [guion y repaso individual](entrega/GUION_DEMOSTRACION.md). Auditorías completas/productivas actuales **0/0**, sin excepción utilizada; OBS-DEP-001 cerrado por retiro oficial del aviso, conservando la historia. DEF-SUP-001 original sigue abierto. **E11 no está completamente cerrada: falta confirmar preparación individual, ensayo oral y datos del equipo.** Esta nota prevalece sobre estados históricos anteriores.

El [plan previo](PLAN_RENDIMIENTO_E08.md) y `quality/load/policy.json` fijan carga, datos, SLO y parada. La [evaluación de herramienta](HERRAMIENTA_INCORPORADA_CALIDAD.md) conserva requisitos, alternativas, PoC, matriz y adopción. Se ensaya la API FastAPI con procesamiento real y fuente sintética, sin enviar carga a cloud ni leer credenciales de la cartera original.

## Preparación

Usar CPython 3.12.14 y las dependencias/constraints del repositorio. En Linux, por ejemplo desde la raíz:

```bash
python -m venv .quality/load-venv
.quality/load-venv/bin/python -m pip install pip==25.0.1
.quality/load-venv/bin/python -m pip install -r back/requirements-dev.txt
.quality/load-venv/bin/python -m pip check
python quality/load/install.py
```

El instalador descarga k6 2.3.0 oficial y verifica el SHA-256 fijado antes de extraer únicamente su ejecutable. En Windows puede usarse el entorno `back/.venv/Scripts/python.exe` ya preparado; los comandos de instalación usan el mismo script. No se necesita Docker, un servicio cloud de cargas ni configurar secretos.

## Un comando por escenario

```bash
.quality/load-venv/bin/python quality/load/run.py stress --output .quality/e08/stress-repeticion
.quality/load-venv/bin/python quality/load/run.py soak --output .quality/e08/soak-repeticion
```

Para repetir únicamente la PoC: `.quality/load-venv/bin/python quality/load/run.py poc --output .quality/e08/poc-repeticion`. En Windows sustituir el intérprete por `back/.venv/Scripts/python.exe`. Un directorio con `run.json` previo se rechaza para no borrar evidencia. El comando inicia su propio servidor en 127.0.0.1 y un puerto libre; verifica PID, SHA y hash del dataset; ejecuta k6 y cierra ambos procesos. No acepta una URL remota arbitraria.

Las campañas completas incorporan calentamiento y drenajes: el cronograma dura 380 s para estrés y 640 s para sostenido, más el cierre de solicitudes en curso (hasta 10 s) y la preparación del proceso. Los tiempos reales quedan en `run.json`. No se acortan las duraciones para el corte de aceptación. El modelo cerrado incorpora 100 ms de pausa por usuario; no representa una tasa de llegada fija ni una estimación de ciudadanos conectados.

## Pipeline

`.github/workflows/load-tests.yml` se ejecuta con cambios de los scripts en `quality/e08-rendimiento`, y ofrece `workflow_dispatch` para repetir el release. Después de publicarlo en main, `gh workflow run load-tests.yml --ref main --repo ImaDecara/Tesis-EQUITAS` inicia ambas campañas nuevas. No se ejecuta automáticamente una carga larga por cada PR.

Primero exige CI de calidad correcto del mismo SHA, rama, workflow y repositorio. Luego crea dos entornos Ubuntu 24.04 nuevos, instala las dependencias y k6 fijados y genera evidencia propia. `fail-fast: false` permite conservar el resultado de una campaña aunque falle la otra. El código de salida se propaga al job y el artefacto se publica con `if: always()`; un bloqueo previo deja las cargas sin ejecutar y no se interpreta como aprobación.

## Reportes y lectura

Cada salida contiene:

- `run.json`: resultado, SHA, estado del árbol, hashes de política/dataset/código, runtime/hardware, comandos, fases, errores, recursos y tiempos reales.
- `policy.json`, `oracle.json`, `dataset.json.gz`: entrada y esperado reproducibles. Hay 3.600 objetos/perfiles; 72.000 deudas representadas por agregados, no filas de deuda consultadas.
- `summary.md`, `tests.xml`: resumen humano y un caso JUnit por campaña.
- `series.json` y `series.csv`: muestras agrupadas en ventanas nominales de diez segundos; se identifican las ventanas de borde posiblemente parciales.
- `resources.csv`: CPU y RSS de servidor/generador cada dos segundos en Linux. CPU usa 100 % por núcleo; el primer delta no tiene porcentaje. En Windows se declara explícitamente que esta instrumentación no midió recursos.
- `samples.ndjson.gz`, `k6-summary.json`, `k6.log`, `server.log`: muestras crudas y diagnóstico. Los percentiles del evaluador se calculan sobre las muestras sin redondear.
- `report.html`: reporte autónomo de k6 con gráficas temporales; no requiere contratar Grafana Cloud. Sus gráficas globales pueden incluir warmup; los SLO principales del JSON/resumen lo separan por fase.

Los artefactos `load-stress-ID-INTENTO`, `load-soak-ID-INTENTO` y `load-ci-ID-INTENTO` se conservan 30 días. Los reportes portables del corte aceptado están en `evidencias/e08/`, incluidos HTML y muestras de operaciones comprimidas para auditar percentiles. Los de la PoC no sustituyen los del pipeline. [Ejecución y análisis](REGISTRO_EJECUCION_E08.md).

## Interpretación y recuperación

Leer primero completitud, códigos de salida, errores y SLO por operación; luego percentiles, throughput, mezcla efectiva y recursos. El agregado puede ocultar una operación lenta, por eso el objetivo hasta diez usuarios se evalúa también en listado, filtro y resumen. El estrés por encima del objetivo informa degradación o límite no alcanzado; una parada/incompletitud nunca se transforma en verde.

Si falla: conservar artefacto y causa, distinguir código/contenido, SLO, recursos o preparación del entorno; corregir de forma identificada y repetir con política/dataset comparables. No elevar el umbral después de medir para aprobar. Los diez minutos permiten observar comportamiento sostenido del ensayo, no demostrar ausencia de fugas durante días. Servidor y generador comparten runner; los dos jobs pueden tener hardware diferente. No se extrapola capacidad a Supabase, al dashboard desplegado o a otro número de workers.

## Repetición final E11

Misma política/dataset, fuente 5b62c14, pipeline 40032355979. Estrés: 5312 solicitudes principales; p95 a 10 VU 501,80 ms. Sostenido: 15149 solicitudes principales, p95 360,06 ms y 600 s. Cero errores inesperados/diferencias de contenido. A 40 VU exploratorios p95 2216,71 ms supera 2000; primer escalón observado fuera del objetivo, conservado explícitamente. El objetivo obligatorio hasta 10 VU aprobó. No se atribuye la diferencia con E08 a una optimización: el producto no cambió y los runners tienen CPU distintas. [Reportes, fases y recursos](evidencias/e11/resultados-cargas.json). La repetición no aumenta el inventario de 183 pruebas/campañas.
