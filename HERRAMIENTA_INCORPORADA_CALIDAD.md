# Herramienta de cargas — proceso de cinco pasos

**Inicio de evaluación:** 23/10/2026, antes de la PoC de E08. Responsable: Axel Azcune. **Estado:** requisitos y criterios definidos; PoC, puntuación final y adopción pendientes de ejecución. Este documento inicia R22 en E09 durante E08; no cierra el resto de E09.

## 1. Requisitos

Generar usuarios concurrentes y fases temporales, validar JSON funcional, fijar SLO y propagar fallo a CI, conservar percentiles/serie temporal/reportes aun con fallos, ejecutar localmente y en Ubuntu Actions y fijar una versión reproducible sin contratar servicios cloud. La prueba debe operar sobre la lógica de EQUITAS y datos aislados. Se busca una configuración pequeña que el equipo pueda explicar y mantener.

## 2. Alternativas investigadas

| Alternativa | Evidencia primaria y adecuación inicial |
| --- | --- |
| k6 | [Executors](https://grafana.com/docs/k6/latest/using-k6/scenarios/), [thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/), [JSON](https://grafana.com/docs/k6/latest/results-output/real-time/json/) y [HTML autónomo](https://grafana.com/docs/k6/latest/results-output/web-dashboard/). Scripts JavaScript y binario independiente. Candidato a PoC: [2.3.0](https://github.com/grafana/k6/releases/tag/v2.3.0), publicada 21/09/2026; descarga y hash verificados contra assets oficiales. |
| Locust | [Ejecución headless y código de salida](https://docs.locust.io/en/stable/running-without-web-ui.html). Python encaja con backend; requiere un entorno adicional de dependencias para cargas y su configuración. No se ejecutó aún. |
| Apache JMeter | [Manual CLI y reportes](https://jmeter.apache.org/usermanual/get-started.html). Alternativa con planes, aserciones y HTML; introduce JVM/JMX a un repositorio que hoy usa Python/JavaScript. No se ejecutó aún. |

Las tres alternativas admiten ejecución local sin contratar un servicio de cargas. Las ventajas estimadas no se presentan como tiempos de trabajo medidos ni como benchmarks comparativos.

## 3. Prueba de concepto prevista

Ejecutar 20 s con un usuario sobre las tres operaciones de la API aislada, usando el mismo dataset/oráculo previsto para E08. Conservar comando, versión/hash de herramienta, SHA de producto, respuesta funcional, muestras, percentiles, reporte HTML y dificultades encontradas. Una PoC aprobada no sustituye estrés ni diez minutos de sostenido. Resultado: **pendiente**.

## 4. Matriz de decisión — criterios previos

Escala 1–5; resultado ponderado = suma(peso × puntuación)/100. Los pesos se fijan antes de la PoC; las puntuaciones se completarán después con su fundamento y con la distinción entre ejecución real y evaluación documental.

| Criterio | Peso | k6 | Locust | JMeter |
| --- | ---: | ---: | ---: | ---: |
| Encaje con stack y CI | 20 % | Pendiente | Pendiente | Pendiente |
| Reproducibilidad/versionado | 20 % | Pendiente | Pendiente | Pendiente |
| Reportes y series | 20 % | Pendiente | Pendiente | Pendiente |
| Validación funcional y umbrales | 20 % | Pendiente | Pendiente | Pendiente |
| Simplicidad de adopción/mantenimiento | 10 % | Pendiente | Pendiente | Pendiente |
| Costo de ejecución local | 10 % | Pendiente | Pendiente | Pendiente |
| Total | **100 %** | Pendiente | Pendiente | Pendiente |

## 5. Adopción incremental prevista

Primero PoC local; luego mismo escenario funcional con duración/usuarios completos; después jobs de CI con evidencia nueva y umbrales versionados; finalmente comandos de repetición, análisis y mantenimiento. No se cambiará una herramienta existente por cantidad ni se presentará esta evaluación como una decisión tomada en una fecha anterior.
