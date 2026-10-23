# E08 — Estrés y esfuerzo sostenido de la API

**Cierre:** 23/10/2026. Responsable: Axel Azcune. **Estado:** completada, 24/24 controles. [CI](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39960952039), [campañas](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39960952025), SHA `f6f83f9a3172fc2e42912305a181057130d9577b`.

## Qué se midió

FastAPI `/case-groups` y `/case-groups/summary` con handlers/scoring/joins por ID/filtros/orden/paginación/serialización productivos y un conector sintético local. Dataset: 3.600 perfiles/objetos y 72.000 deudas representadas en agregados, seis grupos conocidos de 600. Sin carga externa ni credenciales reales. No equivale a medir dashboard, Auth/RLS, Data API, red cloud o persistencia.

## Criterio anterior a la ejecución

Plan y política e08-v1 publicados en `09f040b`. Warmup 30 s, escalones 1/5/10/20/40 de 60 s y sostenido de diez usuarios por 600 s; drenajes 10 s. Objetivo hasta diez usuarios: p95 <= 2.000 ms y errores <= 1 %, agregado y por operación, cero contenido incorrecto y mínimos de muestras. Se preservaron esos valores. [Plan](PLAN_RENDIMIENTO_E08.md), [reproducción y parada](RENDIMIENTO_CALIDAD.md).

## Resultados observados

| Campaña/fase | Usuarios | Solicitudes | p50 ms | p95 ms | p99 ms | Errores | req/s | SLO exigido |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| stress/stress_1 | 1 | 447 | 30.29 | 47.20 | 50.90 | 0 | 7.45 | True |
| stress/stress_5 | 5 | 1225 | 152.88 | 174.14 | 180.63 | 0 | 20.42 | True |
| stress/stress_10 | 10 | 1486 | 327.76 | 389.46 | 424.04 | 0 | 24.77 | True |
| stress/stress_20 | 20 | 1641 | 683.48 | 794.16 | 824.43 | 0 | 27.35 | False |
| stress/stress_40 | 40 | 1609 | 1471.78 | 1647.00 | 1674.56 | 0 | 26.82 | False |
| soak/soak | 10 | 12160 | 419.48 | 532.58 | 598.35 | 0 | 20.27 | True |

**No se alcanzó incumplimiento del SLO hasta 40 usuarios ensayados**. Esto no demuestra capacidad ilimitada; el throughput y la CPU se interpretan junto con la latencia.

El throughput sube de 7,45 req/s a un usuario a 27,35 a veinte, y se mantiene en 26,82 a cuarenta, mientras p95 pasa de 794,16 a 1.647,00 ms entre esos dos escalones. Junto con CPU de servidor próxima a un núcleo ocupado, esto sugiere saturación de procesamiento/colas del worker antes de incumplir el SLO; no demuestra un límite exacto ni capacidad del servicio cloud. El generador alcanzó un máximo muestreado de 7,00 % de un núcleo en estrés, frente a 104,48 % del servidor.

En sostenido, la mediana de RSS del servidor fue 105,69 MiB en el primer minuto de la fase y 110,78 MiB en el último; máximo muestreado 115,57 MiB. Hubo un aumento observado de 5,09 MiB, por debajo del presupuesto de parada. No se concluye ausencia de fugas ni se identifica ese aumento por sí solo como una fuga. Los modelos de CPU de los dos runners son distintos: comparar 389 ms de estrés con 533 ms de sostenido no demuestra una degradación causada por la duración.

La fase sostenida completó sus 600 s y todas las operaciones cumplieron el criterio previo. Los percentiles son descriptivos de las muestras observadas, sin garantía estadística para otras cargas. Los requests no son tests: se registran dos campañas no funcionales.

**stress:** k6 informó 380.561 s totales incluyendo warmup/drenajes; el monitor observó 382.076 s de proceso. Servidor: RSS máximo muestreado 265.89 MiB; CPU máxima muestreada 104.48 % de un núcleo. CPU: AMD EPYC 9V74 80-Core Processor; 4 CPUs lógicas observadas.

**soak:** k6 informó 640.296 s totales incluyendo warmup/drenajes; el monitor observó 642.148 s de proceso. Servidor: RSS máximo muestreado 115.57 MiB; CPU máxima muestreada 102.48 % de un núcleo. CPU: AMD EPYC 7763 64-Core Processor; 4 CPUs lógicas observadas.

Los jobs usan runners independientes y servidor/generador comparten cada runner. Un worker Uvicorn, asyncio/h11 y límite de threadpool observado en metadata; no se compara con otro número de workers. Las series de diez segundos y recursos cada dos segundos permiten revisar evolución; los máximos son muestreados y no garantizan capturar todo pico. Diez minutos sin fallos no prueban ausencia de fugas durante días. Los datos uniformes y seis patrones no representan toda distribución de cartera real.

## Preparación, dificultades y trazabilidad

La PoC de herramienta aprobó en Windows con 148 solicitudes válidas. El primer arranque se detuvo con cero muestras por el guard de proceso y se corrigió el lanzador. El primer CI posterior bloqueó por imports I001 y las cargas quedaron omitidas por dependencia; se corrigió sin relajar umbrales. Esos ensayos de preparación se conservan y no se presentan como fallos funcionales de rendimiento. [Herramienta con cinco pasos](HERRAMIENTA_INCORPORADA_CALIDAD.md), [bloqueo](evidencias/e08/blocked-ci.json) y [CAS-PERF #12](https://github.com/ImaDecara/Tesis-EQUITAS/issues/12).

Los once controles nuevos de infraestructura pasaron; el CI aislado mantiene 107 frontend y 61 backend, con 66 controles de infraestructura totales. El producto no cambió respecto del cierre E07: las coberturas/gates mantienen sus alcances; integración externa y smoke conservan sus fuentes/fechas. El corte acumulado es 183 pruebas/campañas de producto, separando 168 aisladas, doce externas, un smoke y dos cargas. No se atribuye todo ese número al único workflow de cargas.

## Evidencia y repetición

[Resultados portables](evidencias/e08/resultados.json), [estrés](evidencias/e08/stress/run.json), [sostenido](evidencias/e08/soak/run.json), sus JUnit, series, recursos, inputs y HTML quedan versionados. Se conservaron también las muestras originales de latencia/contenido en `operation-samples.ndjson.gz` para auditar percentiles; las muestras completas de k6 y logs permanecen en los artefactos de 30 días, con digest SHA-256 registrado. Los datos son sintéticos y no incluyen claves ni sesiones.

[Comandos completos](RENDIMIENTO_CALIDAD.md): con el venv preparado, `python quality/load/run.py stress --output .quality/e08/stress-repeticion` y `python quality/load/run.py soak --output .quality/e08/soak-repeticion`. El flujo manual publicado permite repetir ambas campañas con `gh workflow run load-tests.yml --ref main --repo ImaDecara/Tesis-EQUITAS`. Un fallo propaga salida no cero y conserva evidencia. No se ejecutan cargas largas en cada PR.

E08 queda cerrada en el componente y entorno declarados. E09 conserva métricas/ISO/riesgos/principios y mapa de pruebas por consolidar; R22/herramienta ya tiene evidencia de adopción. DEF-SUP-001 original y OBS-DEP-001 permanecen abiertos.
