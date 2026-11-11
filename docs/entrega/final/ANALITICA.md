# Analítica de la entrega final

El usuario autorizó este **alcance reducido el 11/11/2026**. El protocolo `docs/tesis/protocolo-analitica-v1.md` y `contracts/synthetic-world.v1.json` siguen como borradores pendientes de aprobación íntegra. Esta entrega no completa sus experimentos, réplicas, auditorías ni tickets; tampoco atribuye aprobaciones a otras personas.

**Sobre la cartera real NO se ejecutó la comparación.** Por decisión del usuario no habrá sesión contra la base original durante esta entrega. No hay cifras, k, siluetas, perfiles ni parámetros derivados de la cartera real en estos archivos. La referencia sklearn se comprobó sobre la tabla sintética versionada y el perfil sintético a escala. En la demo local se comprobó de punta a punta el acceso, el mismo mapeador y la coincidencia del estado `INSUFFICIENT_DATA`; sus 16 casos utilizables no permiten validar una partición.

## Clustering descriptivo

Unidad: objeto tributario/caso. Se toman medidas del mapeador existente, sin recalcular importes o reglas:

| Variable | Motivo |
|---|---|
| Deuda vencida, ARS | Volumen económico vencido del caso. |
| Atraso máximo, días | Antigüedad del atraso. |
| Cantidad de obligaciones registradas | Extensión del caso; incluye todas las obligaciones registradas, también pagadas. |

Población: casos con deuda vencida positiva y las tres medidas completas. Exclusiones mutuamente excluyentes, en este orden: importe ausente/inválido/parcial; sin deuda vencida positiva; atraso ausente/inválido/parcial; cantidad ausente/no entera/no positiva. Se informa cada conteo, incluidos los ceros. No se imputan faltantes. No entran identidad, documentos, domicilios, contactos, tipo de persona, vulnerabilidad, atributos sensibles, identificadores ni salidas de reglas. Los grupos de trabajo se cruzan **después** del ajuste; nunca son variables, etiquetas ni objetivos del modelo.

Preprocesamiento: recorte superior p99 por variable (cuantil lineal), `log1p`, centrado y escala por desvío poblacional. Varianza cero: escala 1. Orden canónico lexicográfico por las tres variables. K-means Lloyd, semilla 20261111, un inicio por k, máximo 150 iteraciones y parada por asignaciones idénticas. Primer centro mediante LCG de 32 bits (`1664525*s+1013904223`); siguientes por máxima distancia al centro más cercano, con desempate por orden. sklearn 1.9.1 usa exactamente esos centros, `n_init=1`, `tol=0`, `algorithm='lloyd'`.

Se comparan **k=2…6**. Cada grupo debe tener al menos `max(5, techo(0,05*n))` casos. Gana la mayor silueta; diferencias de hasta 1e-10 se resuelven por el menor k. La silueta se calcula dentro de una submuestra determinística de hasta 384 casos, con distancia euclídea. Es una estimación sobre esa submuestra, no la silueta exacta de toda la cartera.

Separación: silueta <0,25 **débil**, 0,25–<0,50 moderada, ≥0,50 fuerte. Una separación débil no invalida automáticamente el ajuste y se informa como débil. Estabilidad: cinco submuestras del 80% sin reemplazo, reajustando preprocesamiento y centros en cada una; se predice toda la población y se compara con la referencia mediante ARI. Mediana <0,60 inestable, 0,60–<0,75 intermedia, ≥0,75 estable. Una remuestra degenerada cuenta como ARI 0. Los perfiles muestran tamaño, proporción y p25/mediana/p75 **sin transformar**, en las unidades originales. Se numeran por mediana de deuda ascendente, sin rótulos sociales.

Menos de 30 casos utilizables: `INSUFFICIENT_DATA`. Variables constantes o ningún candidato admisible: `DEGENERATE`. Lectura incompleta, advertencias, falta de acceso, error o límite de recursos: `UNAVAILABLE`; nunca grupos parciales. Las firmas de `loadClusteringForViewer()` y `loadSupervisedExperiment()` se conservaron. **No se agregó, quitó ni renombró ningún campo del contrato.**

## Servicio y costo

Al abrir analítica, `front/lib/ml/server.ts` exige la sesión y membresía municipal mediante la DAL, carga el contexto, lee la cartera completa con el cargador existente y usa su mapeador. No escribe en Supabase ni registra casos. No se importa desde el tablero ni desde el camino de decisión. Python no corre en la aplicación publicada.

El ajuste TS se memoiza en memoria del proceso por municipio y SHA-256 de la matriz canónica: TTL 15 minutos, máximo 16 municipios. Cada pedido **vuelve a autorizar y leer**, verifica la huella y reconstruye el cruce de reglas. Al reutilizarlo mantiene `computedAt` y lo dice en `freshness.detail`; el estado sigue siendo `CURRENT`, porque la cartera se volvió a leer en ese pedido y el cálculo es determinístico: con la misma huella, recalcular daría lo mismo. `STALE` queda en el contrato para un resultado que no corresponda a la lectura del pedido, cosa que esta versión no produce. No se guardan casos ni identidades en esa caché. En otra instancia o después de un arranque en frío se recalcula. Nunca se usa caché pública de Next ni un asset público con resultados de la cartera.

Tope: **10.000 casos totales antes de mapear y 10.000 filas en el motor**. Por encima devuelve `UNAVAILABLE`. El ajuste tiene un presupuesto de **1.500 ms**, comprobado cooperativamente en inicialización, iteraciones, asignaciones, silueta, remuestras y al finalizar. Si se agota, descarta todo el resultado y no lo cachea. No es un temporizador de interrupción dura de JavaScript; puede excederse por el costo de un paso entre controles. El límite no incluye espera de red ni el mapeo previo: esos tiempos se informan aparte y dependen del cargador compartido. No se midió Vercel ni se configuraron sus límites de ejecución.

Medición local, Node 22.23.2, Apple Silicon, una corrida por conjunto; los tiempos no son garantías de producción:

| Fuente exclusivamente sintética | Casos / incluidos | Resultado | Cálculo TS | Lectura o generación / mapeo |
|---|---:|---|---:|---:|
| Demo local N7, lectura con sesión | 19 / 16 | `INSUFFICIENT_DATA`; tres sin deuda vencida | 0,23 ms | 102,74 / 4,64 ms |
| Generador `escala`, 56.286 obligaciones | 2.933 / 2.929 | k=2; silueta 0,624094; ARI 0,993535; tamaños 546/2.383 | 56,04 ms | 1.237,86 / 402,62 ms |
| Tabla ampliada desde `escala`, con perturbaciones y semilla | 10.000 / 10.000 | k=2; silueta 0,553724; ARI 0,997753; tamaños 2.122/7.878 | 190,54 ms | 1.759,19 / 491,17 ms |

En escala se excluyeron dos importes incompletos y dos casos sin deuda vencida. En ambas tablas grandes: ARI TS/sklearn=1, mismo k y candidatos admisibles; diferencias de silueta ≤2,23e-16 y de estabilidad 0. La tabla versionada `front/tests/fixtures/ml/parity.v1.json` tiene **135 filas**, k=3, silueta **0,9335256940003055**, estabilidad **1**, tamaños **45/45/45**. Es una tabla deliberadamente separada; no representa una medición municipal.

## Experimento supervisado

**Experimento con datos sintéticos; no predice pagos reales de La Falda**.

Se ejecutó un generador reducido, semilla 20261111: 6.300 objetos sintéticos distintos, una observación por objeto, cohortes mensuales independientes. Se reutilizan del protocolo las medidas de deuda, historia de pagos de 180 días, ventana futura de 90 días, rezago de registro de 10 días y embargo temporal. La señal negativa de deuda/atraso y positiva de pagos previos es un **supuesto explícito del generador**, no un hallazgo real.

Objetivo: algún pago en `(instante, instante+90 días]`; etiqueta disponible a los 100 días. Variables: las tres medidas del caso, cantidad de pagos anteriores en 180 días y presencia de un pago anterior en 90 días. La instantánea es previa y los eventos de variables son estrictamente anteriores al instante. No se usa el puntaje municipal. Entrenamiento enero–diciembre 2024 (3.600 observaciones, 1.678 positivas), embargo enero–marzo 2025 (900, 426), evaluación abril–septiembre 2025 (1.800, 858). Las etiquetas de entrenamiento maduran antes del corte 2025-04-01; la evaluación completa madura antes del 2025-12-10.

Pipeline ajustado solo con entrenamiento: `log1p → StandardScaler → LogisticRegression(C=1, L2)`. Baselines: tasa de entrenamiento y tasa según pago previo en 90 días, con suavizado de Laplace. La comparación principal es log-loss; no se eligieron hiperparámetros mirando evaluación. AUC-PR significa `average_precision_score`.

| Modelo / control | AUC-ROC | AUC-PR | Brier | Log-loss |
|---|---:|---:|---:|---:|
| Tasa base | 0,500000 | 0,476667 | 0,249567 | 0,692282 |
| Heurística de pago reciente | 0,633272 | 0,557488 | 0,230723 | 0,653853 |
| Regresión logística | 0,805109 | 0,794962 | 0,179968 | 0,537892 |
| Control sin señal, probabilidad constante 0,4 | 0,516624 | 0,419120 | 0,240277 | 0,673592 |
| Etiquetas mezcladas por separado en train/test | 0,519331 | 0,481999 | 0,249613 | 0,692377 |

La logística supera al mejor baseline por log-loss **en esta evaluación sintética**. Los controles pasan el criterio previamente fijado `|AUC−0,5| ≤ 3,29*sqrt((n1+n0+1)/(12*n1*n0))`: márgenes 0,045697 y 0,044833. Esto no demuestra ausencia universal de fuga; lo complementan las pruebas de fechas, embargo, independencia de objetos y ajuste del preprocesamiento exclusivamente en entrenamiento. Los resultados se publican aun si el modelo o un control no favorece la hipótesis.

El JSON versionado se valida en ejecución contra el contrato; una forma inválida produce `UNAVAILABLE`. No se guarda un modelo ni se aplica a casos reales. Se omiten las 20 réplicas, bootstrap de 1.000 muestras, simulación causal, escenarios adicionales y auditoría de equidad completa del protocolo original.

`realHistory.suitable=false` se basa **solo en el esquema versionado y el anexo de N7**, no en una inspección actual de producción: obligaciones/estados actuales y `last_collection_date` no acreditan eventos históricos de pago con importes ni instantáneas disponibles al instante de predicción. Haría falta un historial prospectivo fechado y auditable para validar después. No se afirma que no existan otras fuentes municipales.

## Reproducción y verificaciones

Python 3.12.14; dependencias offline fijadas en `back/requirements-analytics.txt`, incluido `narwhals` requerido por sklearn 1.9.1. `requirements-dev.txt` las instala; `requirements.txt` del servicio no cambia. NumPy 2.5.4 ya estaba fijado por el servicio vía pandas. La referencia limita sklearn a un hilo.

Desde la raíz:

```sh
uv venv --python 3.12.14 back/.venv
uv pip install --python back/.venv/bin/python -r back/requirements-dev.txt pip==25.0.1
PYTHONPATH=back back/.venv/bin/python -m analytics.clustering
PYTHONPATH=back back/.venv/bin/python -m analytics.supervised
(cd back && .venv/bin/python -m pytest tests/test_analytics.py -q)
(cd front && npm exec -- vitest run tests/unit/ml)
(cd front && npm exec -- tsc --noEmit)
node scripts/analitica/run.mjs --benchmark
node scripts/analitica/run.mjs --benchmark --benchmark-cases 10000
node scripts/analitica/run.mjs --env ~/.equitas-n7/supabase-local.env --account ~/.equitas-n7/cuentas.json --account-key admin-a
```

El comparador importa **el mismo** `raw-debtor-loader`, `mapDebtorObjectsFromRawData`, `prepareCases` y motor TS; su adaptador CLI comparte el resolvedor de acceso, alcances municipales y lector paginado. Python recibe únicamente la matriz por stdin, sin duplicar definiciones monetarias. Solo se permiten login POST `/auth/v1/token?grant_type=password` y GET/HEAD de tablas REST; se bloquean RPC, Storage, escrituras y redirecciones. La demo no se modifica. Reporte sin filas ni identidades, en `~/.equitas-original/analitica/`, directorio 0700 y archivo 0600. El nombre `original` es la ubicación privada acordada, no una afirmación sobre el origen de los datos.

**Comando futuro para quien tenga cuenta; no ejecutado sobre la base original en esta entrega:**

```sh
node scripts/analitica/run.mjs --env ~/.equitas-original/app.env --account ~/.equitas-original/cuenta.json
```

El `.env` contiene `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; el JSON privado, `{"email":"…","password":"…"}`. Si la cuenta tiene varios municipios, agregar `--tenant ID` (el resolvedor vuelve a verificar su membresía). No usar claves secretas ni `service_role`. No subir reportes reales a Git, aunque solo tengan agregados.

Las pruebas de analítica entran en las suites normales de CI: paridad, determinismo, límites, estados, caché, acceso revocado, lectura incompleta, variables prohibidas, identidad de prioridades/recomendaciones/intensidades/mensajes y de estados de aprobación/pendientes/huellas con y sin analítica. También verifican que ningún módulo de dominio, mapeadores, servicios o servidor de decisiones importe ML. Python regenera el fixture y el artefacto (excepto `generatedAt`), comprueba embargo, disponibilidad de etiquetas, límites temporales y preprocesamiento sin evaluación.

Cambios mínimos fuera de la propiedad de analítica, sin bajar umbrales ni quitar controles:

- `quality/ci.py`: sumar `back/analytics` al alcance compartido de duplicación/complejidad; conservar ETL/API/services y agregar analytics en cobertura explícita y Ruff.
- `quality/gate-policy.json`: agregar `back/analytics/` al inventario de producto medido.
- `quality/gates.py`: incluir `back/analytics` en el diff de líneas nuevas contra la misma base fija.

Controles completos (usar directorios de salida vacíos y Node/npm fijados por el repo):

```sh
python quality/ci.py run frontend --output .quality/analitica-final/frontend
python quality/ci.py run backend --install --output .quality/analitica-final/backend
python quality/gates.py --artifacts .quality/analitica-final --output .quality/analitica-final/gates
```

Hay que leer `gate.json`; no alcanza el código de salida de `gates.sh`. Estos controles locales no acreditan despliegue, integración remota ni rendimiento de Vercel. No se hizo push, merge, PR ni despliegue desde esta rama.
