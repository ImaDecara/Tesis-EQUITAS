# E08 — Plan previo de estrés y esfuerzo sostenido

**Fecha:** 23/10/2026. **Responsable:** Axel Azcune (`AxAzc`). **Estado:** criterios previos conservados; ambas campañas completadas y aprobadas. El primer commit de criterios es `09f040b`; [resultados y límites](REGISTRO_EJECUCION_E08.md). Entrada: E07 cerrada en `909366f`. Requisitos R11, R17, R20, R21 y R25.

## Componente y límites

Se mide la API FastAPI existente: `GET /case-groups` y `GET /case-groups/summary`. Cada solicitud ejecuta construcción de casos, cálculo de prioridad/tags/grupo, ordenamiento, filtros/paginación o resumen y serialización HTTP productivos. No se responde con JSON fijo ni se usa `/health` como operación de carga.

La fuente externa se reemplaza únicamente en el proceso de ensayo por un conector de lectura en memoria. Se conservan los handlers y servicios productivos. El módulo de configuración externo se sustituye antes de importar la aplicación para evitar leer credenciales locales o inicializar una conexión real. No se envía carga a Supabase, Vercel ni a la cartera original. La web actual no consume esta API: los resultados no son una medición del dashboard desplegado ni de Auth/RLS, red cloud, límites del Data API o almacenamiento.

## Datos y mezcla

La especificación `quality/load/policy.json`, versión **e08-v1**, es la fuente de criterios. Dataset determinista **e08-fixture-v1**: 3.600 perfiles activos y 3.600 objetos, seis patrones intercalados por ID y 600 perfiles por grupo. Cada perfil representa 20 deudas agregadas: **72.000 deudas representadas**, no 72.000 filas de deuda consultadas por estos endpoints.

Se validan tres operaciones: listado de 25 casos (50 %), filtro de riesgo high con offset 50 y límite 25 (20 %) y resumen de los 3.600 casos (30 %). Se comprueban status, totales, tamaño/IDs/orden de página, prioridad/grupo/riesgo de sus elementos y conteos del resumen contra un oráculo independiente, definido por los seis patrones. La selección cíclica de operaciones aproxima esa mezcla y se reportan las cantidades efectivas.

## Carga, aceptación y parada

| Escenario | Configuración fijada | Evaluación |
| --- | --- | --- |
| PoC de herramienta | 1 usuario, 20 s; sin reclamar capacidad. | Las tres operaciones deben producir contenido válido y reportes. |
| Calentamiento | 1 usuario, 30 s antes de cada campaña completa. | Contenido válido; excluido de percentiles/SLO principales. |
| Estrés progresivo | 1, 5, 10, 20 y 40 usuarios; 60 s estables en cada escalón. | Objetivo 10 usuarios; registrar degradación y límite observado por escalón. |
| Sostenido | 10 usuarios durante 600 s tras calentamiento. | Mismos umbrales de operación, integridad funcional y serie temporal. |

Se usan escenarios constant-vus secuenciales, con 10 s de drenaje entre fases para no mezclar escalones. Cada usuario hace una solicitud por iteración y espera 100 ms; el modelo es cerrado, no una tasa de llegada fija. Timeout HTTP de 5 s, un worker Uvicorn, loop asyncio, protocolo h11 y puerto local asignado por el runner. No se cambia el número de workers entre escalones.

En las fases de hasta 10 usuarios y en sostenido: **p95 <= 2.000 ms**, errores inesperados **<= 1 %**, **cero respuestas HTTP 200 con contenido incorrecto**, al menos 50 solicitudes por fase y diez por operación. Se evalúa el agregado y cada operación para evitar ocultar una ruta lenta. Son objetivos técnicos del ensayo para este prototipo/runner; no un SLA municipal ni una estimación de usuarios reales.

Por encima de diez usuarios, superar el SLO se interpreta como degradación observada; no se modifica el objetivo después de medir. Si no se supera, se informa que no se alcanzó el límite del SLO hasta la carga ensayada. El throughput puede estabilizarse antes: se distingue ese indicio de saturación del incumplimiento de latencia/error.

Parada controlada: errores acumulados > 20 % tras 30 s; contenido incorrecto; RSS de servidor/generador > 1.024 MiB; salida cruda > 512 MiB; proceso caído o deadline total excedido en 120 s. Se conserva lo medido, causa y salida distinta de cero. No se convierte una campaña incompleta en aprobación ni se amplían presupuestos para ocultar un fallo.

## Entorno, métricas y evidencia

La aceptación proviene de campañas nuevas ejecutadas en GitHub Actions Ubuntu 24.04. El manifiesto registra SHA, política/dataset/hashes, comandos, versiones, host/CPU/memoria, kernel, workers, tiempos reales y códigos de salida. Servidor y generador comparten runner: se declara la posible contención; no se generaliza a otro hardware.

Se conservan p50/p95/p99, cantidades, errores, mezcla real, solicitudes/s y serie temporal de diez segundos, además de CPU/RSS de ambos procesos cada dos segundos cuando `/proc` está disponible. La PoC Windows puede declarar recursos no medidos. No se afirmará ausencia de fugas por observar diez minutos ni se medirá una red externa inexistente.

El pipeline verifica primero el CI del mismo SHA y ejecuta estrés/sostenido en jobs aislados. Es un flujo de validación de carga de release/manual y de la rama E08, no una carga automática en cada PR. Los reportes se generan en los jobs y se publican aunque haya fallos; no se suben como sustituto los de la PoC local. Los comandos concretos se documentarán junto con su implementación comprobada.

## Herramienta y control de cambios

k6 **2.3.0** es el candidato para la PoC, con binarios oficiales fijados por SHA-256 en la política. Antes de adoptarlo se completará la evaluación iniciada en [HERRAMIENTA_INCORPORADA_CALIDAD.md](HERRAMIENTA_INCORPORADA_CALIDAD.md). El commit de este plan y política identifica el criterio previo. Si se modifica el diseño tras un fallo, se conserva la versión anterior y se justifica un nuevo ensayo; no se reescribe el esperado de una ejecución pasada.
