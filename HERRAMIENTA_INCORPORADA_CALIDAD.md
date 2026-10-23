# Herramienta de cargas — proceso de cinco pasos

**Inicio de evaluación:** 23/10/2026, antes de la PoC de E08. Responsable: Axel Azcune. **Estado:** cinco pasos completados; PoC local y adopción con dos campañas nuevas de CI comprobadas. Este documento inicia R22 en E09 durante E08; no cierra el resto de E09.

## 1. Requisitos

Generar usuarios concurrentes y fases temporales, validar JSON funcional, fijar SLO y propagar fallo a CI, conservar percentiles/serie temporal/reportes aun con fallos, ejecutar localmente y en Ubuntu Actions y fijar una versión reproducible sin contratar servicios cloud. La prueba debe operar sobre la lógica de EQUITAS y datos aislados. Se busca una configuración pequeña que el equipo pueda explicar y mantener.

## 2. Alternativas investigadas

| Alternativa | Evidencia primaria y adecuación inicial |
| --- | --- |
| k6 | [Executors](https://grafana.com/docs/k6/latest/using-k6/scenarios/), [thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/), [JSON](https://grafana.com/docs/k6/latest/results-output/real-time/json/) y [HTML autónomo](https://grafana.com/docs/k6/latest/results-output/web-dashboard/). Scripts JavaScript y binario independiente. Candidato a PoC: [2.3.0](https://github.com/grafana/k6/releases/tag/v2.3.0), publicada 21/09/2026; descarga y hash verificados contra assets oficiales. |
| Locust | [Ejecución headless y código de salida](https://docs.locust.io/en/stable/running-without-web-ui.html). Python encaja con backend; requiere un entorno adicional de dependencias para cargas y su configuración. No se ejecutó aún. |
| Apache JMeter | [Manual CLI y reportes](https://jmeter.apache.org/usermanual/get-started.html). Alternativa con planes, aserciones y HTML; introduce JVM/JMX a un repositorio que hoy usa Python/JavaScript. No se ejecutó aún. |

Las tres alternativas admiten ejecución local sin contratar un servicio de cargas. Las ventajas estimadas no se presentan como tiempos de trabajo medidos ni como benchmarks comparativos.

## 3. Prueba de concepto: diseño previo y resultado

Ejecutar 20 s con un usuario sobre las tres operaciones de la API aislada, usando el mismo dataset/oráculo previsto para E08. Conservar comando, versión/hash de herramienta, SHA de producto, respuesta funcional, muestras, percentiles, reporte HTML y dificultades encontradas. Una PoC aprobada no sustituye estrés ni diez minutos de sostenido. Resultado: **aprobado** en `de29fd024ad11375b6da9271a07214d4e50ada4c`, Windows, CPython 3.12.14 y k6 2.3.0. 20 s configurados, 20,151 s informados por k6 y 22 s de proceso observados por el monitor de 2 s; 148 solicitudes (74 listado, 30 filtro, 44 resumen), cero errores/mismatches; p50 32,09 ms, p95 48,46 ms y p99 53,33 ms. No se midió CPU/RSS en Windows. [Reportes y manifiesto](evidencias/e08/poc/run.json). No se usa este resultado como capacidad del producto ni como reporte generado por CI.

Comando real: `back/.venv/Scripts/python.exe quality/load/run.py poc --output .quality/e08/poc-02`. El binario oficial se instaló con `python quality/load/install.py`, verificando SHA-256. La primera preparación se detuvo con cero muestras por el PID del redirector de Python venv en Windows; se conserva en `evidencias/e08/poc-arranque-detenido/`. Se corrigió el lanzador para identificar/cerrar el proceso directo usando los paquetes del mismo venv. No se relajó la carga, el contenido esperado ni un umbral.

## 4. Matriz de decisión — criterios previos

Escala 1–5; resultado ponderado = suma(peso × puntuación)/100. Los pesos se fijan antes de la PoC; las puntuaciones siguientes se completaron después con su fundamento y con la distinción entre ejecución real y evaluación documental.

| Criterio | Peso | k6 | Locust | JMeter |
| --- | ---: | ---: | ---: | ---: |
| Encaje con stack y CI | 20 % | 4 | 5 | 3 |
| Reproducibilidad/versionado | 20 % | 5 | 3 | 3 |
| Reportes y series | 20 % | 5 | 4 | 5 |
| Validación funcional y umbrales | 20 % | 5 | 5 | 4 |
| Simplicidad de adopción/mantenimiento | 10 % | 4 | 4 | 2 |
| Costo de ejecución local | 10 % | 5 | 5 | 5 |
| Total ponderado / 5 | **100 %** | **4,70** | **4,30** | **3,70** |

## 5. Adopción incremental aplicada

Primero PoC local; luego mismo escenario funcional con duración/usuarios completos; después jobs de CI con evidencia nueva y umbrales versionados; finalmente comandos de repetición, análisis y mantenimiento. No se cambiará una herramienta existente por cantidad ni se presentará esta evaluación como una decisión tomada en una fecha anterior.

### Fundamento de la puntuación y decisión

Se adopta k6. Su PoC confirmó validación de las tres operaciones, JSON crudo, umbrales y exportación HTML autónoma; el binario fijado evita agregar dependencias de carga al lock Python del producto. El encaje no recibe 5 porque introduce un ejecutable y usa JavaScript para un componente Python. La corrección del lanzador Windows fue una dificultad del entorno compartida con otras herramientas de ese servidor, y queda registrada.

Las puntuaciones de Locust y JMeter son una evaluación documental, no una PoC comparativa. Locust encaja directamente con Python (5), pero habría que resolver/pinar otro conjunto de dependencias (3 en reproducibilidad relativa a este repositorio); ofrece estadísticas y control de salida, con más construcción del informe elegido (4). JMeter ofrece reportes completos (5), pero requiere JVM/JMX y un proceso distinto al stack actual (3 en encaje y 2 en simplicidad). Las tres opciones reciben 5 en costo para ejecución local sin contratar cloud. Los valores son juicio del equipo con los pesos previamente versionados, no medidas de superioridad absoluta ni estimaciones de licencia/esfuerzo verificadas.

La adopción continúa con `.github/workflows/load-tests.yml`: primero CI del mismo SHA y luego dos campañas en runners nuevos con reportes propios. El comando local separa `stress` y `soak`. La conclusión final de adopción CI se añadirá cuando esas campañas terminen; los resultados de la PoC no se presentarán como campañas completas.

### Adopción CI comprobada

[Ejecución 39960952025](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39960952025) completó estrés y sostenido después del CI correcto `f6f83f9a3172fc2e42912305a181057130d9577b`. Ambos jobs produjeron muestras nuevas, JSON/JUnit/serie/recursos y HTML. Se completa la adopción incremental prevista; no se ejecutó PoC de las alternativas. Esto cubre R22 y la sección de herramienta de E09, no sus demás pendientes.
