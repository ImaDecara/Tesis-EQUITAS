# Protocolo pre-registrado del mundo sintético compartido y del experimento de ML y clustering (v1)

> **Borrador — pendiente de aprobación (ALIGN-048, compuerta antes de cerrar).** Ninguna corrida de ALIGN-036, 062 o 063 puede empezar hasta que el usuario y/o los directores aprueben y fechen este protocolo y la especificación del mundo sintético (§15). Este documento no contiene resultados: ningún experimento se corrió.

| Campo | Valor |
|---|---|
| Ticket | ALIGN-048, plan `2026-10-28-v2` (M8). Objetivos 3 y 8; requisito R35 (propuesto) |
| Versión | v1 (borrador del 29/10/2026) |
| Especificación | `contracts/synthetic-world.v1.json`, versión `1.0.0`, estado `BORRADOR_PENDIENTE_APROBACION` |
| sha256 de la especificación | `9278c16d3b2c0515d7126c3c440fd28984f1d32af721436b50a603f9c5154d5e` (canónico: §3.8) |
| Rótulo obligatorio | **Factibilidad experimental con datos sintéticos; no es desempeño predictivo real** `[T02.R04]` |
| Consumidores | ALIGN-061 (generador y tablas), 062 (propensión), 063 (clustering), 064 (pantalla), 035/036 (simulación), 070 (verificación) |
| Fuentes | Ticket ALIGN-048; plan v2 §7.7 y §7.10; DECISIONS D-26 y D-31 y revisión v2 (A-1, A-9, B-2 a B-5); decisiones del usuario del 29/10 (ALIGN-002, 003, 004); [contrato de dominio][contrato]; [reglas v1][reglas]; síntesis de tesis |
| Datos personales | Ninguno. Ningún dato real; solo la cartera sintética de ALIGN-023 |

## 1. Para qué sirve y qué no puede mostrar

La cartera real no tiene historial de pagos ni de gestiones. Entrenar un modelo con el propio puntaje validaría las reglas consigo mismas `[P0270]`, y con datos sintéticos solo se acredita **factibilidad** `[T02.R04]`. Este protocolo fija **antes de correr** qué se entrena, con qué datos, cómo se evalúa, qué se publica y qué se puede concluir, para que el experimento no "gane por construcción" sin decirlo ni se lea como desempeño real (revisión v2 de B, punto 2).

- **Qué decisión mejora:** qué se entrena, con qué datos, cómo se evalúa y qué se puede concluir.
- **Qué prueba el experimento:** que el circuito completo funciona con datos sintéticos (generación, registro de acciones, partición temporal, entrenamiento, métricas, auditoría y publicación); que los controles detectan una fuga (escenario nulo); que el método recupera una relación predictiva cuando el generador la pone y falla de forma visible cuando no (escenario mal especificado); cuánto pesa el sesgo de selección de las reglas (submuestra aleatoria); y si los segmentos agregan algo a las colas de reglas.
- **Qué no prueba:** nada sobre contribuyentes reales (§10).
- **Sin efecto en decisiones:** propensión y segmentos nunca deciden prioridad ni intensidad (§12). La escala de intensidad es la aprobada en ALIGN-003 (0–4, intensa ≥ 3 con aprobación de supervisor; el sistema sugiere a lo sumo 2).

## 2. Un único mundo sintético (D-31)

La simulación y la analítica leen **el mismo** mundo: misma población, mismos latentes, mismo escenario social, mismos segmentos plantados y mismo comportamiento de pago. Lo especifica `contracts/synthetic-world.v1.json`; ALIGN-061 lo implementa y verifica el hash (§3.8). Así la tesis no informa el AUC de un mundo y el efecto de una política de otro (revisión v2 de B, punto 3).

| Quién | Qué toma del mundo | Qué agrega por su cuenta |
|---|---|---|
| ALIGN-061 | Todo | Generador con semilla, tablas `action_log` y `payment_event`, observaciones con campos temporales |
| ALIGN-062 / 063 | Historial analítico, observaciones, escenarios; escenario social **solo para evaluar equidad** | Modelos y métricas de §6 y §7 |
| ALIGN-035 / 036 | Población, latentes, escenario social y modelo de pago | Sus políticas (U, P0, P1, P2), capacidad, costos (ALIGN-034) y estimandos. **Nunca** lee puntajes de ML |

## 3. Especificación del mundo (resumen de `contracts/synthetic-world.v1.json`)

Los valores numéricos son **supuestos declarados**, no mediciones. Cambiar cualquiera crea una versión nueva antes de ver resultados.

### 3.1 Población y tiempo

- **Población:** la cartera sintética de ALIGN-023, perfil `escala` (2933 objetos y 56 286 obligaciones), versión `sintetico-v1`, semilla 20261028, municipio sintético A, objetos aceptados por su oráculo (`cartera_base`). ALIGN-023 está en revisión: se cita su diseño (`TICKETS/ALIGN-023.md`), no su código. Cada mundo registra el sha256 del `manifest.json` de la cartera; si la cartera integrada declara otra fecha de corte, otro perfil u otra semilla, el generador se detiene (`CARTERA_BASE_DISTINTA`).
- **Tiempo:** 24 ciclos mensuales desde T0 = día siguiente al corte de la cartera (2026-10-01 con el corte esperado 2026-09-30); `c_m` = primer día del mes m y `T_final` = `c_25`. Los eventos tienen fecha dentro de su mes y toda comparación temporal usa fechas.
- **Simplificaciones v1:** no aparecen obligaciones nuevas (se trabaja el stock de la cartera) y el canal utilizable de cada objeto no cambia.

### 3.2 Latentes (nunca observables)

Capacidad latente `u_i ~ Normal(0, 1)` y, solo en el escenario mal especificado, un shock mensual persistente `e_i(m)` AR(1). Solo los lee el generador.

### 3.3 Escenario social (solo para evaluar equidad)

- `vulnerable_sintetico` con prevalencia 20 % y asociación **declarada** con la falta de canal utilizable (+0,8 en logit), con el tipo AGUA (+0,4) y con menor capacidad latente (−0,5). La asociación existe para que la auditoría de proxy tenga algo que detectar; no informa sobre hogares reales.
- `grupo_sintetico` G1–G3 uniforme e independiente de todo: **grupo placebo** (control negativo de las métricas de equidad).
- Usos permitidos: equidad en 062/063 (después de calcular puntajes o segmentos), métricas de equidad y carga de 036 y entrada de la política P1 de ALIGN-035 dentro del simulador. Prohibido como entrada de un modelo, de un clustering o de las reglas del historial, y prohibido unirlo a la base o a la pantalla.

### 3.4 Segmentos plantados

S1 (responde a recordatorio), S2 (responde a contacto con plan; regulariza más), S3 (pagos parciales espontáneos frecuentes) y S4 (respuesta baja), con probabilidades 30/25/20/25 %, independientes de los observables. Se nombran por su comportamiento sintético, nunca con rótulos sociales. Sirven **solo** para el chequeo de cordura del clustering (revisión v2 de B, punto 4).

### 3.5 Comportamiento de pago

Riesgo mensual logístico por objeto con saldo vencido: `logit h = theta0 + theta_segmento + Σ beta·x + gamma·u + eta·vulnerable + e + efecto_accion`. Las `x` son el saldo, el atraso máximo y la cantidad de obligaciones (logaritmo estandarizado con la población en T0), la frecuencia de pagos de 6 meses y un pago en los últimos 90 días. Una gestión de intensidad `a` suma `tau[segmento][a]` durante su mes y los dos siguientes, reducido a la mitad para objetos vulnerables. Un evento puede ser `PAGO_TOTAL`, `PAGO_PARCIAL` (10–60 % del saldo, imputado a la obligación más antigua) o `REGULARIZACION` (adhesión a plan, solo con gestión de intensidad 2 vigente). En el escenario principal, más deuda y más atraso **bajan** la propensión: es un supuesto, y por eso se espera que la severidad cruda tenga AUC < 0,5 (H-P6).

### 3.6 Historial analítico: acciones elegidas por las reglas y submuestra aleatoria `[P0270]`

| Elemento | Valor |
|---|---|
| Reglas | `contracts/decision-rules.v1.json` 1.0.0, implementación Python de ALIGN-015, `as_of = c_m`, vulnerabilidad `NO_INFORMADO_EN_ORIGEN` |
| Capacidad | 12 % de la población en gestiones (intensidad ≥ 1) por mes |
| Elegibles | Saldo > 0, no regularizado, canal utilizable y sin gestión en los dos ciclos anteriores (las ventanas de 90 días de un objeto no se superponen) |
| Brazo aleatorio | 25 % de la capacidad, objetos al azar entre los elegibles, intensidad al azar 1 o 2; se registra la probabilidad de asignación |
| Brazo de reglas | Resto de la capacidad: sugerencias v1 de intensidad ≥ 1, por intensidad y luego por el orden de prioridad de las reglas |
| Intensidad 0 | Se registra sin consumir capacidad ni generar observaciones |
| Intensidades 3–4 | No ocurren en el historial (el sistema nunca las sugiere); las decisiones humanas intensas las modela ALIGN-035 |
| Revisión humana | Supuesto v1: la sugerencia se ejecuta sin modificación |

### 3.7 Escenarios

| Escenario | Qué cambia | Para qué |
|---|---|---|
| `PRINCIPAL` | Pago dependiente de observables, latente, vulnerabilidad, segmento y gestión | Recuperar una relación predictiva conocida |
| `NULO` | Pago independiente de todo (riesgo mensual constante, sin efecto de gestión) | AUC esperado 0,5 con intervalo declarado; salirse se trata como **fuga** |
| `MAL_ESPECIFICADO` | Señal observable a un cuarto, latente fuerte, shock mensual persistente, respuesta a la gestión que depende del latente, segmentos débiles | Mostrar qué pasa cuando los impulsores no se observan |

Con la misma semilla los tres escenarios comparten latentes, escenario social, segmentos, días y asignaciones (números aleatorios comunes). Semilla principal 20261029; 20 réplicas (semilla + k); corrida independiente de utilidad con 20262029. ALIGN-035 puede variar parámetros de `PRINCIPAL` para su sensibilidad registrando el hash y los cambios.

### 3.8 Versión, hash y control de entrada

- **Hash canónico:** sha256 de `json.dumps(especificación sin estado, aprobacion ni integridad, sort_keys=True, separators=(',', ':'), ensure_ascii=False)` en UTF-8. Aprobar (cambiar `estado` y completar `aprobacion`) no cambia el hash; cualquier otro cambio sí. La prueba `quality/tests/test_synthetic_world_contract.py` recalcula el hash y exige que este documento lo cite.
- **Control de entrada (A-1, D-31):** toda corrida de 061, 062, 063, 036 y toda vista de 064 exige un manifiesto de clase `S` con el hash aprobado, la especificación en estado `APROBADO`, el hash de la cartera base, la semilla y el escenario. Si falta algo se rechaza con `SIN_MANIFIESTO_SINTETICO`, `ESPECIFICACION_NO_APROBADA`, `HASH_DE_ESPECIFICACION_DISTINTO`, `CARTERA_BASE_DISTINTA` o `VINCULO_CON_OTRA_CARTERA`.

## 4. Unidad, variable objetivo y temporalidad

- **Unidad de análisis:** el **objeto** tributario ([contrato §2][contrato]). Una observación es una gestión registrada de intensidad 1 o 2 de un objeto en un ciclo.
- **Variable objetivo** `pago_o_regularizacion_90d`: 1 si en los **90 días posteriores a la gestión** hay un pago total, una regularización o pagos parciales que suman al menos el **20 %** del saldo vencido en el instante de predicción. Es **propensión ante una gestión** `[P0106]`, no el efecto causal de la gestión `[P0263]`.
- **Campos temporales de cada observación** (revisión v2 de A, punto 9): instante de predicción (`c_m`, antes de la gestión), fin de ventana (+90 días) y disponibilidad de la etiqueta (+10 días de rezago de registro).
- **Reglas:** las variables usan solo eventos con fecha **estrictamente anterior** al instante; se entrena solo con etiquetas **maduras** al corte de entrenamiento; las ventanas no maduras al final del historial son **censuradas**, se excluyen y se cuentan.

| Meses (instante de predicción) | Uso | Motivo |
|---|---|---|
| 1–6 | Calentamiento | Hay gestiones y pagos, pero sin observaciones: garantiza 6 meses de historia para la frecuencia |
| 7–14 | Entrenamiento | Etiqueta disponible antes del corte `c_18` |
| 15–17 | Embargo | La etiqueta madura después del corte: ni entrenamiento ni prueba |
| 18–21 | Prueba | Etiqueta disponible antes de `T_final` |
| 22–24 | Censurado | La etiqueta no madura dentro del historial |

Dentro del entrenamiento, un **pliegue reservado** del 20 % de los objetos (agrupado por objeto) se usa solo para el mapeo isotónico del baseline de severidad y para la auditoría de proxy. La prueba verifica la madurez con fechas reales para cualquier mes de inicio.

## 5. Variables

La lista es **cerrada**: lo que no figura está prohibido. Rige igual para propensión y clustering.

| Clase | Variables |
|---|---|
| **Permitidas** | Monto (saldo vencido), atraso máximo, cantidad de obligaciones con saldo, recencia del último pago (`NO_INFORMADO` si no hubo pagos, nunca 0) y frecuencia de pagos en 6 meses |
| **Solo con auditoría de proxy** | Tipo de objeto; contactabilidad (cantidad de canales utilizables; "sin canal", que en propensión es constante y se excluye); banderas de calidad v1 `PORCENTAJES_NO_SUMAN_100`, `ESTADO_ORIGEN_NO_INFORMADO`, `PERIODO_NO_INFORMADO`, `FECHAS_INCONSISTENTES` |
| **Prohibidas** | Vulnerabilidad y grupo sintéticos, segmentos y latentes; datos sociales; identidad; tipo de persona (incluida `TIPO_PERSONA_DESCONOCIDO`); domicilio; valores de contacto; porcentaje declarado y rol; **salidas de las reglas** (severidad, prioridad, cola, intensidad sugerida, `VERIFICAR_PRESCRIPCION`) `[P0270]`; intensidad, brazo y probabilidad de la gestión; tiempo calendario; cualquier proxy no auditado `[P0273]`–`[P0274]` |

**Auditoría de proxy** (revisión v2 de B, punto 5). Se hace una sola vez, en la semilla principal de `PRINCIPAL`, con el período de entrenamiento y antes de mirar la prueba; la decisión rige para todas las réplicas y escenarios. Una variable entra solo si pasa las tres pruebas; la tabla se publica completa.

| Prueba | Propensión | Clustering |
|---|---|---|
| Asociación con la vulnerabilidad sintética | V de Cramér ≤ 0,10 | Igual |
| Disparidad por grupo | Agregarla no aumenta en más de 0,01 la brecha de puntaje medio entre vulnerables y no vulnerables (pliegue reservado) | Agregarla no aumenta en más de 0,05 la diferencia máxima de proporción de vulnerables entre segmentos |
| Contrafactual | Cambiar solo esa variable mueve el puntaje ≤ 0,05 en el percentil 95 y ≤ 0,02 en la mediana | Cambiar solo esa variable cambia de segmento a ≤ 5 % de los objetos |

## 6. Experimento de propensión (ALIGN-062)

| Elemento | Pre-registro |
|---|---|
| Baselines | Tasa base; **severidad v1**: discriminación con el valor crudo y calibración **solo** con un mapeo isotónico ajustado en el pliegue reservado (dirección por el signo de Spearman en ese pliegue); regresión logística L2 (C = 1, estandarizada) |
| Modelo | `HistGradientBoostingClassifier` con hiperparámetros **fijos** (tasa 0,05, 300 iteraciones, 15 hojas, mínimo 40 por hoja, L2 = 1, sin parada temprana) y semilla del flujo `modelos`. Sin búsqueda de hiperparámetros |
| Métricas | AUC-ROC, AUC-PR, Brier y calibración (intercepto y pendiente de recalibración, ECE con 10 bins de igual frecuencia, diagrama de confiabilidad) |
| Poblaciones | Total, **submuestra aleatoria** y brazo de reglas, en la partición de prueba |
| Incertidumbre | IC 95 % por bootstrap por objeto (1000 remuestras) y distribución sobre 20 réplicas |
| Escenario nulo | Para severidad, regresión y HGB, en total y aleatoria: AUC dentro de `0,5 ± 3,29 · sqrt((n1 + n0 + 1) / (12 · n1 · n0))`. Fuera del intervalo, la corrida se marca `FUGA_SOSPECHADA` |
| Equidad | Por vulnerabilidad sintética y grupo placebo, en total y aleatoria: tasa observada, puntaje medio, calibración global, AUC dentro del grupo y participación **hipotética** en el 20 % de mayor puntaje. Valores absolutos y diferencias; 0/0 = no informativo |
| Salida | Model card `docs/tesis/model-card-propension-v1.md` con el rótulo; artefacto con hash de datos, versión, semilla y escenario; puntajes por corrida en `analytics_score` |

La métrica de la submuestra aleatoria es la que no depende de quién eligieron las reglas; la del total y la del brazo de reglas muestran el sesgo de selección.

## 7. Experimento de clustering (ALIGN-063)

| Elemento | Pre-registro |
|---|---|
| Población | Objetos con saldo vencido en `c_18`, incluidos los que no tienen canal |
| Variables | Las permitidas y las admitidas por la auditoría de clustering, con `ln(1 + x)` y estandarización |
| Métodos | k-means (20 inicios) y, como contraste, mezcla gaussiana con covarianza completa; se informa el ARI entre ambos |
| k | Entre 3 y 8. Entre los k cuyo segmento más chico tiene al menos 5 % de los objetos, el de mayor silueta; diferencias < 0,01 se desempatan por Davies–Bouldin y luego por el menor k. Silueta y Davies–Bouldin se publican para todos los k |
| Estabilidad | 100 remuestras bootstrap; mediana del ARI con la referencia: ≥ 0,75 estable, < 0,60 inestable |
| Chequeo de cordura (no criterio de éxito) | ARI con los segmentos plantados: se aprueba si el de `PRINCIPAL` supera al de `NULO` en al menos 0,05, el de `NULO` está en ±0,05 y el de `PRINCIPAL` no supera 0,95 (más alto se investiga como fuga de la etiqueta plantada) |
| Perfil | Tamaño y medianas por segmento; tabla de contingencia con las colas v1 |
| Utilidad operativa `[T02.R04]`, `[P0261]` | En una **corrida independiente** (otra semilla del mismo mundo, con el escalador y los centroides ya ajustados): U1, los segmentos reducen al menos 2 % la log-loss de la etiqueta respecto de las colas solas, con IC que excluye 0; U2, la respuesta a la intensidad asignada al azar (1 frente a 2) difiere entre segmentos más allá de las colas (razón de verosimilitud, p < 0,05). **Positiva** si se cumple U1 o U2 y los segmentos no son redundantes con las colas (V de Cramér ≤ 0,80); **negativa** en otro caso |
| Salida | `segment_assignment` por corrida y `docs/tesis/clustering-v1.md` con el rótulo; segmentos numerados, nunca con rótulos sociales |

## 8. Criterios de éxito y de abandono, fijados antes de correr

**Factibilidad lograda** si se cumplen todos:

| ID | Criterio |
|---|---|
| F1 | Reproducibilidad: misma especificación, semilla y escenario → mismos hashes de datos y artefactos y mismas métricas |
| F2 | Controles temporales: ninguna variable con eventos en o después del instante; ninguna etiqueta inmadura en entrenamiento (pruebas alrededor del corte y del final del historial) |
| F3 | Escenario nulo: todas las AUC dentro del intervalo, en la corrida principal y en las 20 réplicas |
| F4 | Publicación completa de métricas, baselines, poblaciones, escenarios, réplicas, auditoría y, en clustering, todos los k, estabilidad, cordura y utilidad |
| F5 | Rótulos, control de entrada y ausencia de variables prohibidas verificados por prueba |
| F6 | Clustering: chequeo de cordura aprobado; estabilidad y utilidad se informan pero no condicionan la factibilidad |

**Hipótesis con predicción registrada** (no son criterios de éxito; se publican con cualquier resultado):

| ID | Hipótesis | Predicción |
|---|---|---|
| H-P1 | En `PRINCIPAL`, en la submuestra aleatoria, el mejor modelo supera a la severidad calibrada y a la tasa base (AUC +0,02 en promedio y positiva en ≥ 16 de 20 réplicas) | Se cumple **por construcción** del generador |
| H-P2 | La calibración difiere entre el brazo de reglas y la submuestra aleatoria | Pendiente de recalibración ≠ 1 en el brazo de reglas |
| H-P3 | En `MAL_ESPECIFICADO`, AUC menor que en `PRINCIPAL` | AUC entre 0,52 y 0,65 |
| H-P4 | El puntaje medio difiere entre vulnerables y no vulnerables aunque la vulnerabilidad no sea entrada `[P0273]`–`[P0274]`; el placebo no difiere | Brecha ≠ 0; placebo ≤ 0,01 (> 0,02 se investiga) |
| H-P5 | HGB y regresión logística empatan (±0,02) porque el generador es aditivo en logit | HGB > LR + 0,05 se investiga como fuga |
| H-P6 | La severidad cruda tiene AUC < 0,5 | Severidad mide urgencia, no probabilidad de pago |
| H-C1 | El chequeo de cordura se aprueba | Sí |
| H-C2 | Utilidad operativa | Confianza baja: U1 débilmente positiva y U2 negativa (S1 y S2 solo difieren en la respuesta, que no se observa antes de la gestión) |

Confirmar una predicción hecha por construcción solo muestra que el método recupera lo que el generador puso.

**Abandono** (abandonar no es ocultar: se publica qué se corrió, qué no y por qué):

| ID | Condición | Consecuencia |
|---|---|---|
| A1 | `scikit-learn` sin autorización | 062 y 063 no se ejecutan ni se implementan con otra biblioteca; quedan pendientes |
| A2 | `FUGA_SOSPECHADA` sin resolver tras dos ciclos de corrección | Propensión no concluyente por fuga; ninguna métrica de `PRINCIPAL` se publica como válida |
| A3 | Menos de 50 positivos o 50 negativos en la prueba aleatoria de la corrida principal (verificado con conteos, antes de entrenar) | Una única enmienda registrada de capacidad o fracción aleatoria; si persiste, la aleatoria se informa solo agregada sobre réplicas y, con menos de 200 positivos agregados, como no concluyente |
| A4 | Indicio de datos reales | Se detiene, se registra el incidente y no se publica nada de esa corrida |
| A5 | Cartera base o hash distintos de la especificación | Se detiene; hace falta una versión nueva |
| A6 | Camino de puntajes o segmentos hacia prioridad, intensidad, colas o revisión | La pantalla experimental se desactiva hasta corregirlo |

## 9. Rótulos obligatorios

| Dónde | Texto exacto |
|---|---|
| Model card, informe de clustering, tesis (ALIGN-051) y toda cifra de 062/063 | **Factibilidad experimental con datos sintéticos; no es desempeño predictivo real** |
| Pantalla experimental (ALIGN-064), banner permanente | **Experimental: datos sintéticos, no usar para decidir** |
| Resultados de simulación (ALIGN-036/051) | **Evaluación artificial; no acredita impacto municipal real** |

## 10. Qué no puede concluirse con datos sintéticos

Con este mundo no puede concluirse nada sobre (plan v2 §7.7; `[P0250]`, `[P0251]`): probabilidad de pago o recuperabilidad **reales**; respuesta real a canales o a gestiones; efecto incremental real de una acción `[P0263]`; vulnerabilidad o situación de hogares; equidad real; estado jurídico; validez de contactos; utilidad para usuarios reales; impacto en recaudación. En particular:

- Un AUC alto en `PRINCIPAL` mide la capacidad del circuito de recuperar lo que el generador puso; no dice que un modelo supere a las reglas en un municipio.
- Las disparidades por grupo reflejan el escenario social **supuesto**; no son una medición de sesgo sobre personas.
- Los segmentos encontrados reflejan los plantados y la estructura de la cartera sintética; no son tipologías de contribuyentes.
- El contraste de intensidades en la submuestra aleatoria es causal **dentro del mundo** y solo bajo sus supuestos.

## 11. Publicación aunque el modelo pierda

- Se publican **todos** los resultados pre-registrados: cada escenario, modelo, baseline, población, métrica y réplica, la auditoría de proxy y las corridas abandonadas o con fuga.
- Si el modelo no supera a los baselines, se dice en el primer párrafo de la model card; la utilidad negativa del clustering se publica igual.
- Lo no pre-registrado se rotula "exploratorio, no pre-registrado" y no se usa para concluir.
- Una **enmienda** es una versión nueva con fecha, motivo y aprobación; se publican los resultados con y sin ella. Antes de ver resultados, un cambio es simplemente una versión nueva.
- Destinos: `docs/tesis/model-card-propension-v1.md`, `docs/tesis/clustering-v1.md` y la tesis vía ALIGN-051, siempre con el rótulo.

## 12. Sin efecto en decisiones

- Puntajes y segmentos **nunca** modifican severidad, banderas, prioridad, cola, intensidad, explicación, mensajes ni revisión humana.
- **Sin marcas por caso** en detalle, revisión ni colas; solo vistas agregadas en la pantalla experimental, para no anclar al revisor `[P0219]` (revisión v2 de B, punto 6).
- Los puntajes de ML **nunca** alimentan las políticas simuladas de ALIGN-036.
- Lo verifican ALIGN-064 (prioridad e intensidad idénticas con y sin analítica; E2E sin marcas) y ALIGN-070.

## 13. Datos reales: prohibidos ahora; condiciones futuras

El usuario decidió el 29/10 que no se usa ningún dato real (ALIGN-004). **Solo se usa la cartera sintética identificada por manifiesto**, y ninguna autorización de ALIGN-004 habilita por sí sola datos reales: hacerlo exigiría otra versión del plan. Condiciones de entrada para esa versión: protocolo nuevo aprobado antes de ver los datos; historial suficiente de acciones y pagos (al menos 24 meses) con fechas por objeto; registro de acciones con su probabilidad de asignación; submuestra con asignación aleatoria conocida `[P0270]`; autorización del custodio y de la finalidad (ALIGN-004); análisis de impacto (ALIGN-042).

## 14. Qué debe verificar cada consumidor

| Ticket | Debe verificar |
|---|---|
| ALIGN-061 | Hash de la especificación igual al aprobado; misma semilla → mismo mundo; cartera base con la fecha de corte esperada; campos temporales en cada observación; recencia y frecuencia sin eventos posteriores al instante; escenario social en archivo de lectura restringida |
| ALIGN-062 | Control de entrada; partición y madurez de §4; intervalo nulo; métricas en total y aleatoria; auditoría de proxy; publicación aunque pierda |
| ALIGN-063 | Control de entrada; regla de k; estabilidad; cordura; utilidad en corrida independiente; publicación aunque sea negativa |
| ALIGN-064 | Rótulo de pantalla; solo vistas agregadas; nada sin manifiesto válido |
| ALIGN-035/036 | Mismo hash; escenario social solo para equidad, carga y P1; puntajes de ML nunca como entrada |
| ALIGN-070 | Reproducibilidad, rótulos y ausencia de efecto en decisiones |

## 15. Aprobación y control de versiones

**Cómo se aprueba.** El usuario y/o los directores responden las preguntas del resumen de aprobación (evidencia de ALIGN-048 en el paquete del plan). Si piden cambios, se hace un borrador nuevo (con otro hash) y se vuelve a revisar. Al aprobar, en un solo commit: `estado` pasa a `APROBADO`, se completa `aprobacion` (fecha, quién, referencia y sha256 de este documento tal como se aprobó) en la especificación —el hash de la especificación no cambia— y se actualizan el aviso inicial y esta tabla. La prueba exige que una especificación `APROBADO` tenga esos datos y que un borrador no los tenga.

| Fecha | Quién | Referencia | sha256 de la especificación | sha256 del protocolo aprobado | Cambios pedidos |
|---|---|---|---|---|---|
| — | Pendiente | — | `9278c16d3b2c0515d7126c3c440fd28984f1d32af721436b50a603f9c5154d5e` (borrador) | — | — |

| Versión | Fecha | Cambio |
|---|---|---|
| v1 (borrador) | 29/10/2026 | Versión inicial (ALIGN-048): mundo único, unidad, objetivo, temporalidad, escenarios, variables, auditoría de proxy, plan de análisis, criterios, rótulos, límites y publicación. Pendiente de revisión de otro proveedor y de aprobación humana |

[contrato]: contrato-dominio-v1.md
[reglas]: reglas-decision-v1.md
