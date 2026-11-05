# Reglas de decisión v1: severidad, banderas, intervención, prioridad y explicación

| Campo | Valor |
|---|---|
| Ticket | ALIGN-008, plan `2026-10-28-v2` (M1) |
| Versión | `1.0.0`, **provisional**: pendiente de aprobación humana de la política antes de cualquier uso municipal |
| Parámetros | `contracts/decision-rules.v1.json` (fuente única de umbrales, bandas, reglas y textos) |
| Casos golden | `contracts/decision-rules.v1.golden.json` (43 casos sintéticos, 14 pares contrafactuales, 5 ordenamientos por cola) |
| Contrato de dominio | `docs/tesis/contrato-dominio-v1.md` (ALIGN-007): nombres, estados de presencia (`DataPresence`) y corte `as_of` |
| Escala de intensidad | Aprobada por el usuario en ALIGN-003 el 2026-10-30T00:15Z: 0–4, intensa ≥3, máximo automático 2; rige solo con datos sintéticos |
| Consumidores | ALIGN-009 (núcleo TypeScript), ALIGN-015 (servicio Python), ALIGN-010/021 (pantallas y colas), ALIGN-013 (catálogo), ALIGN-035/036 (simulación) |
| Datos personales | Ninguno. Los casos golden usan identificadores `SINT-*` |

## 1. Qué es y qué no es

Las reglas v1 reemplazan las tres fórmulas incompatibles del código actual (ETL, Python y frontend), donde la falta de contacto **sumaba** riesgo o prioridad (+15 en el ETL, +10 en Python) y a la vez la **restaba** en el puntaje del frontend (−6, escala 0–172) (contrato §10). Separan siete dimensiones que antes estaban mezcladas en un único número:

1. **Severidad** 0–100 del objeto a la fecha de corte (monto actualizado, antigüedad máxima y cantidad de vencidas).
2. **Banderas de calidad** de datos.
3. **Vulnerabilidad**, que en la cartera real es `NO_INFORMADA`.
4. **Intervención e intensidad** sugeridas, con canal requerido.
5. **Prioridad operativa** 0–100 dentro de cada cola, con desempates deterministas.
6. **Explicación** por factores, con una frase contrastiva.
7. **Mensajes borrador** sujetos a validación jurídica, sin envío.

**Naturaleza del puntaje.** La severidad y la prioridad son puntajes **heurísticos** construidos con reglas explícitas y bandas fijas. Son puntos de 0 a 100, no porcentajes, y **no es una probabilidad** de pago, de recupero ni de ningún otro evento: no están calibrados contra resultados y la cartera no tiene historial de pagos ni de gestiones que lo permita `[P0105]`, `[P0108]`.

**Lo que ninguna regla deduce.** Ninguna regla deduce ni sugiere **pobreza** o situación social del hogar, **voluntad** o capacidad de pago, **exigibilidad** de la deuda ni **prescripción**. "Vencida a la fecha de corte" es un hecho de calendario (el vencimiento es anterior al corte), no una afirmación sobre el estado jurídico. La bandera `VERIFICAR_PRESCRIPCION` solo pide que una persona competente verifique; nunca afirma que la deuda esté prescripta.

**Exclusiones.** Sin probabilidades, sin aprendizaje automático, y ni el domicilio ni el tipo de persona son factores de severidad, intervención o prioridad. El contacto, la cantidad de personas, el porcentaje declarado y la vulnerabilidad tampoco son factores de severidad ni de prioridad (§4, §8). El contacto y la vulnerabilidad sí intervienen en la sugerencia de intervención: la falta de contacto lleva a `MEJORAR_DATOS` (R1) y un indicio de vulnerabilidad solo puede bajar la intensidad y exigir revisión (M1) (§7).

## 2. Entrada: un objeto tributario a una fecha de corte

La unidad es el **objeto tributario** (contrato §2). Cada dato llega como `{"estado": <DataPresence>, "valor": <valor o null>}`: solo un valor `OBSERVADO` entra en una regla, y ningún otro estado se interpreta como 0 (contrato §4).

| Campo de entrada | Variable del contrato | Uso en las reglas |
|---|---|---|
| `id` | OB01 (clave interna) | Solo último desempate |
| `as_of` | L03 | Corte obligatorio. Sin corte no se evalúa: el llamador muestra "no disponible" o usa la fecha de cálculo con aviso (ALIGN-010). Hoy `as_of` es `NO_INTEGRADO` (contrato §5) |
| `source_updated_at` | L05 | Solo bandera `FECHAS_INCONSISTENTES` |
| `obligaciones[].id` | DE00 | Identificación |
| `obligaciones[].current_amount` | DE05 (`updated_amount` idéntico, DE06) | Monto actualizado del objeto (severidad y desempate) y "vencida al corte" |
| `obligaciones[].due_date` | DE07 | Vencida al corte, antigüedad, prescripción |
| `obligaciones[].estado_origen` | DE10 (estado de origen `NOTD_ESTA_id`/`NOTD_SITU_id`) | Solo bandera; v1 no interpreta sus valores |
| `obligaciones[].periodo_fiscal` | DE02 (período real, hoy `NO_INTEGRADO`) | Solo bandera |
| `contactos_activos` | FO08 unificado (ALIGN-011); validez AU05 `NO_INTEGRADO` | Canal disponible y bandera |
| `personas[].tipo` | PE04 | Solo bandera |
| `personas[].porcentaje_declarado` | RE01 | Solo bandera |
| `vulnerabilidad` | AU01 | Solo puede bajar intensidad o exigir revisión |

Si la lectura de las obligaciones de un objeto falla (`DataWarning`), el llamador no evalúa ese objeto y lo muestra como "no disponible" (contrato §4.1, regla 6): un objeto no leído no es un objeto sin deuda.

Aritmética común a TypeScript y Python: fechas ISO 8601 sin hora y días calendario `as_of − due_date` calculados en UTC; importes con hasta 2 decimales, sumados y comparados en **centavos enteros**; identificadores comparados por punto de código.

## 3. Evaluabilidad y "vencida a la fecha de corte"

- Una obligación es **evaluable** si su `current_amount` es `OBSERVADO` y ≥ 0, y su `due_date` es `OBSERVADO` y no anterior a `1970-01-01` (fecha mínima plausible; una fecha anterior, como un centinela `1900-01-01`, es contradictoria). Motivos de no evaluable: `IMPORTE_NO_OBSERVADO`, `IMPORTE_NEGATIVO`, `VENCIMIENTO_NO_OBSERVADO`, `VENCIMIENTO_INCONSISTENTE`.
- Una obligación está **vencida a la fecha de corte** si es evaluable, su importe es > 0 y `due_date < as_of` (estrictamente: la que vence el mismo día del corte todavía no está vencida). Una obligación con importe 0 observado conserva su cero y no está en mora.
- **Estado de la severidad:**
  - `COMPLETA`: todas las obligaciones leídas son evaluables (incluye el objeto sin obligaciones, cero derivado legítimo).
  - `PARCIAL`: hay al menos una evaluable y al menos una no evaluable. El valor, los insumos y la banda se calculan solo con las evaluables y son un **mínimo** ("al menos n"): no descartan una banda superior ni deuda vencida entre las no evaluables. Los faltantes no se suman como 0 y exigen revisión humana (`SEVERIDAD_PARCIAL`).
- **Qué no se pudo evaluar.** `severidad.motivos_no_evaluables` lista, por motivo y **estado de presencia** del dato (contrato §4), cuántas obligaciones no se evaluaron: por ejemplo, `importe INVALIDO: 1` o `vencimiento NO_INFORMADO_EN_ORIGEN: 1` (un importe negativo o un vencimiento anterior a `1970-01-01` figuran como `OBSERVADO` contradictorio). Una obligación puede tener dos motivos. Las explicaciones `PARCIAL` y `NO_DISPONIBLE` citan este detalle (§9).
  - `NO_DISPONIBLE`: hay obligaciones pero ninguna es evaluable. Severidad, insumos, puntos y prioridad son `null`, nunca 0.

## 4. Dimensión 1: severidad (0–100)

Insumos, todos **a la fecha de corte**:

- `monto_actualizado_ars`: **monto actualizado del objeto**, Σ `current_amount` de sus obligaciones evaluables, vencidas o no (contrato §3 regla 1; es la deuda total PR01/FO01, no la deuda vencida PR02/FO02).
- `dias_atraso_maximo`: máximo de `as_of − due_date` entre las vencidas al corte (`NO_APLICA` si no hay vencidas: aporta 0 puntos porque no hay mora, no porque falte un dato).
- `cantidad_vencidas`: cantidad de obligaciones vencidas al corte.

Cada factor suma los puntos de la última banda cuyo límite inferior ("desde") es menor o igual que el insumo. Las bandas son **absolutas**: no dependen del promedio ni de ningún otro valor del lote (a diferencia del índice heredado PR08).

**Sin vencidas al corte, severidad 0** (`regla_sin_vencidas`): si `cantidad_vencidas = 0`, los tres factores aportan 0. El monto actualizado del objeto se informa igual como insumo, pero un objeto al día no es severo (G06, G43). Con al menos una vencida, el monto actualizado puntúa completo, incluidas las obligaciones que todavía no vencieron (G39: 510 000 ARS → 40 puntos).

| Factor | Bandas (desde → puntos) | Máximo |
|---|---|---|
| `monto_actualizado_ars` (ARS) | 0 → 0 · 0,01 → 10 · 50 000 → 20 · 200 000 → 30 · 500 000 → 40 · 1 000 000 → 50 | 50 |
| `dias_atraso_maximo` (días) | sin vencidas → 0 · 1 → 5 · 31 → 10 · 91 → 15 · 181 → 20 · 366 → 25 · 731 → 30 | 30 |
| `cantidad_vencidas` | 0 → 0 · 1 → 5 · 3 → 10 · 6 → 15 · 12 → 20 | 20 |

Severidad = suma de los tres factores (entero 0–100). Bandas: **BAJA** 0–39, **MEDIA** 40–69, **ALTA** 70–100; `NO_DISPONIBLE` si no hay valor.

**La severidad no usa** contacto, personas ni su cantidad, porcentaje declarado, tipo de persona, domicilio, vulnerabilidad, estado de origen ni valores del lote. Quitar el contacto no cambia la severidad (pares G01/G17, G02/G18, G19/G21).

Los montos son valores por defecto provisionales en ARS de la fecha de corte; recalibrarlos por municipio o por inflación exige una versión nueva.

## 5. Dimensión 2: banderas de calidad

Las banderas informan; **no suman severidad ni prioridad**. Se listan en este orden canónico:

| Código | Se activa cuando | Nota |
|---|---|---|
| `SIN_CONTACTO_ACTIVO` | `contactos_activos` no es `OBSERVADO` con valor ≥ 1 (cero observado o lectura no disponible) | Contacto cargado ≠ verificado (AU05). Lleva a `MEJORAR_DATOS` (R1), no a más severidad |
| `PORCENTAJES_NO_SUMAN_100` | Hay personas y algún porcentaje declarado no es `OBSERVADO`, o \|Σ − 100\| > 0,01 | Nunca se normaliza. Sin personas: `NO_APLICA`, sin bandera. Un 0 observado es válido |
| `ESTADO_ORIGEN_NO_INFORMADO` | Alguna obligación sin estado de origen `OBSERVADO` | Hoy todas: el estado es inferido (DE10) |
| `PERIODO_NO_INFORMADO` | Alguna obligación sin período fiscal `OBSERVADO` | Hoy todas: `debt.period` copia `DEUD_id` (DE02) |
| `FECHAS_INCONSISTENTES` | `source_updated_at` posterior a `as_of`, o algún vencimiento anterior a `1970-01-01` | La obligación con vencimiento implausible queda no evaluable |
| `TIPO_PERSONA_DESCONOCIDO` | Alguna persona con tipo no `OBSERVADO` o `UNKNOWN` | Nunca es factor (pares G01/G36, G01/G37) |
| `VERIFICAR_PRESCRIPCION` | Alguna vencida con atraso ≥ 1825 días a la fecha de corte | **Parámetro operativo de alerta**, no plazo legal; lo fija el área jurídica. Nunca afirma prescripción |

## 6. Dimensión 3: vulnerabilidad

| Entrada | Salida | Efecto |
|---|---|---|
| Cualquier estado distinto de `OBSERVADO` (en la cartera real, `NO_INFORMADO_EN_ORIGEN`) | `NO_INFORMADA` ("Vulnerabilidad: no informada") | Ninguno. La ausencia no se interpreta como "vulnerable" ni como "no vulnerable" |
| `OBSERVADO` = `SIN_INDICIO` (solo sintético) | `SIN_INDICIO` | Ninguno: nunca sube la intensidad |
| `OBSERVADO` = `INDICIO_VULNERABILIDAD` (solo sintético) | `INDICIO_VULNERABILIDAD` | Modificador **M1**: tope de intensidad automática 1 y revisión humana obligatoria |

Efectos permitidos: bajar la intensidad o exigir revisión; nunca subirla `[P0156]`. Prohibido inferir vulnerabilidad de la deuda, el domicilio, el tipo de persona, el documento o la falta de contacto (contrato AU01). Los valores observados existen solo en casos sintéticos para probar la propiedad; en la simulación, el escenario social sirve para medir equidad y no es entrada de las reglas (plan v2 §7.10).

## 7. Dimensión 4: intervención e intensidad

**Escala de intensidad (valor por defecto provisional, pendiente de ALIGN-003):** 0 = mejorar o verificar datos, sin contacto con el contribuyente; 1 = comunicación informativa o recordatorio por un canal disponible; 2 = contacto personal con ofrecimiento de plan o asistencia; 3 = intimación administrativa formal; 4 = derivación a procuración o vía judicial. **Intensa = ≥ 3.** El sistema **nunca sugiere 3 ni 4** (máximo automático 2): solo una persona puede proponerlas, con aprobación de supervisor y la lista de control de ALIGN-003.

Tabla de decisión: se aplica la **primera** regla que se cumple y luego el modificador M1.

| Regla | Condición | Intervención (cola) | Intensidad | Canal requerido |
|---|---|---|---|---|
| R1 | `SIN_CONTACTO_ACTIVO` | `MEJORAR_DATOS` (Mejorar datos) | 0 | No |
| R2 | Severidad `NO_DISPONIBLE` | `MEJORAR_DATOS` (Mejorar datos) | 0 | No |
| R3 | `VERIFICAR_PRESCRIPCION` | `REVISION_JURIDICA` (Revisión jurídica) | 0 | No |
| R4 | Banda ALTA | `CONTACTO_PERSONAL_Y_PLAN` (Contacto y plan) | 2 | Sí |
| R5 | Banda MEDIA | `RECORDATORIO_INFORMATIVO` (Recordatorio) | 1 | Sí |
| R6 | Banda BAJA y severidad > 0 | `SEGUIMIENTO` (Seguimiento) | 1 | Sí |
| R7 | Severidad = 0 | `SEGUIMIENTO` (Seguimiento) | 0 | No |
| M1 | Vulnerabilidad `INDICIO_VULNERABILIDAD` | Si la regla fue R4 → `RECORDATORIO_INFORMATIVO`; en otro caso, sin cambio | min(intensidad, 1) | Según la intervención resultante |

Revisión humana obligatoria (`requiere_revision_humana = true`, revisión caso por caso, sin gestión masiva) con motivos `INDICIO_VULNERABILIDAD` (M1) o `SEVERIDAD_PARCIAL` (§3).

## 8. Dimensión 5: prioridad operativa

- Escala 0–100 **dentro de cada cola** (la cola es la intervención). Las prioridades de colas distintas no se comparan.
- En v1, la prioridad es igual a la severidad del objeto; es `null` si la severidad es `NO_DISPONIBLE`. Esos casos se muestran al final de su cola y contados aparte, nunca como prioridad 0 (contrato §4.1, regla 3).
- Orden determinista: prioridad descendente (null al final) → `monto_actualizado_ars` (monto actualizado del objeto) descendente → vencimiento más antiguo ascendente (menor `due_date` entre las vencidas; null al final) → `id` ascendente por punto de código. Mismos datos, corte y versión producen el mismo orden.

## 9. Dimensión 6: explicación

Cada resultado incluye los tres factores de severidad (insumo, puntos y máximo) y una **frase contrastiva** ("se sugiere X y no Y porque…"), una por regla (R1–R7) y otra para M1 cuando baja la intensidad de R4. La severidad se escribe como el número (`COMPLETA`), "al menos n" (`PARCIAL`) o "no disponible" (`NO_DISPONIBLE`).

- Severidad `COMPLETA` o `NO_DISPONIBLE`: `explicacion.frases_contrastivas`. La de R2 cita qué no se pudo evaluar.
- Severidad `PARCIAL`: `explicacion.frases_contrastivas_parcial` seguida de `explicacion.complemento_parcial`. Describen el **mínimo** y su universo (las obligaciones evaluables), dicen qué no se pudo evaluar (cantidad, dato y estado de presencia) y que la severidad puede ser mayor. Nunca afirman que la severidad esté debajo de un umbral ni que no haya deuda vencida, porque los datos no lo permiten concluir.

Ejemplos:

- R4: "Se sugiere contacto personal con ofrecimiento de plan o asistencia y no un recordatorio informativo porque la severidad (75) alcanza el umbral de 70."
- R1: "Se sugiere mejorar los datos de contacto y no una gestión con el contribuyente porque el objeto no tiene un contacto activo cargado; la falta de contacto no modifica la severidad (75)."
- R3: "Se sugiere revisión jurídica y no una gestión de cobro porque al menos una obligación vencida tiene 1825 días o más de atraso a la fecha de corte; esta alerta no afirma que la deuda esté prescripta."
- R5 con severidad `PARCIAL` (G27): "Se sugiere un recordatorio informativo y no contacto personal con plan porque la severidad mínima calculada con las obligaciones evaluables (al menos 55) alcanza 40; con los datos disponibles no puede determinarse si alcanza 70. No se pudo evaluar todo el objeto (obligaciones no evaluables: 1 de 4; importe INVALIDO: 1): esas obligaciones no se cuentan como cero, la severidad puede ser mayor que este mínimo y la sugerencia requiere revisión humana."
- R7 con severidad `PARCIAL` (G42): "Se sugiere seguimiento sin contacto y no una comunicación porque ninguna obligación evaluable está vencida con importe positivo a la fecha de corte; con los datos disponibles no puede determinarse si alguna obligación no evaluable lo está. No se pudo evaluar todo el objeto (…)".

Las pantallas agregan las banderas, la vulnerabilidad ("no informada") y el corte; la frase no las reemplaza.

## 10. Dimensión 7: mensajes borrador

Estado `BORRADOR_SUJETO_A_VALIDACION_JURIDICA`. **EQUITAS no envía mensajes**: la persona operadora decide si usa el texto y por qué canal, fuera del sistema. Marcadores permitidos: `{tipo_objeto}`, `{identificador_objeto}`, `{fecha_corte}` (sin nombres, documentos, importes ni datos del hogar). Los textos no contienen amenazas ni términos como intimación, embargo, juicio, prescripción, vulnerabilidad, riesgo, puntaje o probabilidad.

| Intervención | Plantilla |
|---|---|
| `CONTACTO_PERSONAL_Y_PLAN` | `MSG-CONTACTO-PLAN-v1` |
| `RECORDATORIO_INFORMATIVO` | `MSG-RECORDATORIO-v1` |
| `SEGUIMIENTO` con intensidad 1 | `MSG-SEGUIMIENTO-v1` |
| `MEJORAR_DATOS`, `REVISION_JURIDICA`, `SEGUIMIENTO` con intensidad 0 | Sin mensaje (no hay contacto con el contribuyente) |

## 11. Cobertura de la tabla: límites, ceros, faltantes y contradicciones

| Situación | Tratamiento | Casos golden |
|---|---|---|
| Límites de banda de severidad | 35 BAJA / 40 MEDIA / 65 MEDIA / 70 ALTA / 100 máximo | G11, G07, G12, G13, G16 |
| Límites de factores | 49 999,99 vs 50 000,00 ARS; 30 vs 31 días; 11 vs 12 vencidas | G08–G10, G11, G14, G15 |
| Vencimiento igual al corte / un día antes / posterior | No vencida (sin vencidas: severidad 0) / 1 día / suma al monto actualizado, no a antigüedad ni cantidad | G06, G07, G39 |
| Objeto al día con monto alto | Monto actualizado informado; sin vencidas al corte, severidad 0 | G43 |
| Umbral de alerta de prescripción | 1825 días activa, 1824 no | G19, G20 |
| Objeto sin obligaciones | Cero derivado, `SEGUIMIENTO` intensidad 0 | G04 |
| Importe 0 observado | Cero real, no es mora ni dispara la alerta | G05 |
| Porcentaje 0 observado | Válido (100 + 0 = 100) | G34 |
| Cero contactos observados / lectura de contactos no disponible | `SIN_CONTACTO_ACTIVO`, severidad sin cambio | G17, G18 |
| Importe `INVALIDO` en parte de las obligaciones | Severidad `PARCIAL` ("al menos"), revisión; la frase no descarta la banda ALTA y nombra el importe `INVALIDO` | G27 |
| Parcial sin vencidas entre las evaluables | Mínimo 0, `SEGUIMIENTO` intensidad 0 con revisión; la frase no afirma que no haya deuda vencida | G42 |
| Ninguna obligación evaluable (`INVALIDO`, `NO_INTEGRADO`, `NO_INFORMADO_EN_ORIGEN`) | `NO_DISPONIBLE`, prioridad null, `MEJORAR_DATOS` (R2) | G28, G29 |
| Porcentaje no informado / sin personas | Bandera / `NO_APLICA` sin bandera | G35, G40 |
| Tipo de persona `UNKNOWN` | Solo bandera | G36 |
| Vencimiento centinela `1900-01-01` | No evaluable + `FECHAS_INCONSISTENTES`; severidad `PARCIAL` | G30 |
| Actualización de origen posterior al corte | `FECHAS_INCONSISTENTES`, sin cambio de severidad | G31 |
| Importe negativo observado | No evaluable, no resta severidad; severidad `PARCIAL` | G32 |
| Porcentajes 60 + 30 | `PORCENTAJES_NO_SUMAN_100`, sin normalizar | G33 |
| Prescripción y sin contacto a la vez | R1 precede a R3; ambas banderas visibles | G21 |
| Estado de origen y período observados | Sin banderas de origen | G38 |

## 12. Casos golden y propiedades verificables

`contracts/decision-rules.v1.golden.json` contiene **43 casos** sintéticos (`SINT-G01`…`SINT-G43`). Cada caso tiene `entrada` y el objeto `esperado` completo (severidad con insumos, banderas, vulnerabilidad, intervención, revisión, prioridad, explicación con la frase exacta y mensaje). ALIGN-009 (TypeScript) y ALIGN-015 (Python) deben reproducir **cada objeto esperado completo**, además de:

- **Pares contrafactuales** (14): `contactos_activos` (severidad y prioridad iguales), `vulnerabilidad` (la intensidad de la variante nunca supera la de la base; severidad y prioridad iguales), `personas` y `source_updated_at` (solo cambian las banderas). Cada par difiere únicamente en el campo declarado.
- **Ordenamientos** (5): el orden esperado de todos los casos de cada cola.
- **Invariantes**: ninguna intensidad automática supera 2; la prioridad es null solo con severidad `NO_DISPONIBLE`; ninguna intervención con intensidad ≥ 1 se sugiere sin canal; sin vencidas al corte la severidad es 0; completar con valores evaluables las obligaciones no evaluables de un caso `PARCIAL` nunca baja su severidad ni su banda (el valor parcial es un mínimo).

El oráculo de decisión de cada caso se escribió a mano y se contrastó con un evaluador de referencia de un solo uso, fuera del repositorio (evidencia de ALIGN-008).

## 13. Decisiones de interpretación (lectura más acotada)

| # | Ambigüedad del ticket | Decisión v1 |
|---|---|---|
| D1 | "Monto actualizado del objeto … a la fecha de corte" y objetos al día | El insumo es el **monto actualizado del objeto** (Σ `current_amount` de sus obligaciones evaluables, contrato §3), también en el desempate. Para que un objeto al día no sea severo no se cambia esa variable: se usa la cantidad de vencidas al corte, que el ticket ya prevé (`regla_sin_vencidas`: con 0 vencidas, los tres factores aportan 0). Corrige la versión revisada en `e009951`, que usaba solo el monto vencido (revisión ALIGN-008, hallazgo 1) |
| D2 | Cómo se cuenta una obligación vencida con importe 0 | No está en mora: conserva su cero y no suma cantidad ni antigüedad |
| D3 | Orden entre "sin contacto" y `VERIFICAR_PRESCRIPCION` | Se respeta el orden del ticket: R1 antes que R3; la bandera de prescripción sigue visible |
| D4 | Severidad no calculable (todas las obligaciones no evaluables) | `MEJORAR_DATOS` (R2), coherente con el nivel 0 de ALIGN-003 ("mejorar o verificar datos") |
| D5 | Efecto de la vulnerabilidad `NO_INFORMADA` | Ninguno (ni baja ni sube); el efecto M1 solo se aplica a un indicio observado, que hoy solo existe en sintéticos |
| D6 | Efecto de un indicio de vulnerabilidad | Las dos salidas permitidas a la vez: tope de intensidad 1 y revisión humana |
| D7 | Fórmula de prioridad operativa | Igual a la severidad dentro de cada cola; no se agregan factores que el ticket excluye de la severidad |
| D8 | Umbral de `VERIFICAR_PRESCRIPCION` | 1825 días como parámetro operativo de alerta por defecto; no es un plazo legal y lo fija el área jurídica |
| D9 | Valores del estado de origen | v1 solo usa su presencia (bandera); interpretar el catálogo exige homologación (ALIGN-004/ALIGN-024) y una versión nueva |
| D10 | Fechas contradictorias | Actualización de origen posterior al corte y vencimientos anteriores a `1970-01-01`; un vencimiento implausible deja la obligación no evaluable |
| D11 | Porcentaje declarado faltante | Activa `PORCENTAJES_NO_SUMAN_100` porque la suma no puede verificarse; nunca se completa ni se normaliza |
| D12 | Corte ausente | Las reglas no evalúan sin `as_of`; el rótulo de sustitución lo decide ALIGN-010 |
| D13 | Sugerencia y explicación con severidad `PARCIAL` | Se conserva la sugerencia provisional calculada con el mínimo, con revisión humana obligatoria. La frase describe el mínimo y su universo, dice qué no se pudo evaluar (dato y estado de presencia) y que la severidad puede ser mayor; nunca afirma un límite superior ni ausencia de deuda (revisión ALIGN-008, hallazgo 2) |

## 14. Limitaciones y aprobación humana

- Política **provisional**: requiere aprobación humana antes de cualquier uso municipal; el umbral de `VERIFICAR_PRESCRIPCION` lo fija el área jurídica. La escala de intensidad es el valor por defecto pendiente de ALIGN-003.
- Las bandas de monto, antigüedad y cantidad no están calibradas con datos reales ni con resultados de gestión; con esta cartera no pueden evaluarse recuperabilidad, respuesta a canales ni efecto de las acciones (plan v2 §7.7).
- "Contacto activo" significa contacto cargado con valor, no verificado ni con consentimiento (AU05).
- Mientras `as_of` sea `NO_INTEGRADO`, los consumidores deben rotular la fecha que usen como corte (contrato §5.1).

## 15. Control de versiones

| Versión | Fecha | Cambio |
|---|---|---|
| 1.0.0 | 29/10/2026 | Versión inicial (ALIGN-008). Provisional hasta la aprobación de la política, de ALIGN-003 y del umbral jurídico. Cualquier cambio de parámetros, reglas o textos crea una versión nueva con sus propios casos golden; esta versión no se edita en silencio |
| 1.0.0 (corrección de revisión 1) | 29/10/2026 | Antes de su primera integración y sin consumidores, la versión inicial incorpora los cambios pedidos por la revisión independiente: monto actualizado del objeto como insumo (D1), explicaciones parciales sin afirmaciones no justificadas y detalle de no evaluables (D13), casos G42 y G43. El borrador revisado (`e009951`) no se usó en ninguna integración |

## 16. Implementación TypeScript — ALIGN-009

El [núcleo puro TypeScript](../../front/lib/domain/decision-rules-v1.ts) importa
estáticamente el JSON v1. `evaluateDecisionRulesV1(input)` recibe un
`DecisionInput` con corte `as_of` obligatorio y devuelve el objeto completo del
golden, con la misma estructura que el [motor Python](../../back/services/decision_rules_v1.py).
No lee fuentes externas, no usa el reloj del sistema y no modifica la entrada.
Bandas, puntos, orden de reglas, intensidades, umbrales, mensajes y textos se
obtienen del JSON; la semántica de las condiciones y del modificador M1 se
implementa según §3–9. No cambia la política ni su versión.

También expone `evaluateSeverity`, `evaluateFlags`, `suggestIntervention`,
`calculatePriority` y `explainDecision`. `comparePriority` compara pares
`{ id, decision }` únicamente dentro de la misma cola (rechaza colas distintas),
con los desempates de §8 y los valores null al final. La
[suite TypeScript](../../front/tests/unit/decision-rules-v1.test.ts) verifica los
43 objetos completos, 14 pares, 5 ordenamientos, límites, presencia y determinismo.

Para ALIGN-010: adaptar las lecturas al tipo `RuleDatum<T>`, que reutiliza
`DataPresence`, y conservar `id`, `as_of` y `RULES_VERSION` junto al resultado.
Un error de lectura de obligaciones no debe convertirse en `[]`; el adaptador
debe detener la evaluación. Los valores mal formados se rechazan: el adaptador
declara `INVALIDO` con valor null. Los importes y sus sumas deben caber en
centavos enteros seguros de JavaScript; un desbordamiento se rechaza en lugar
de redondear silenciosamente. Desde ALIGN-010, `amountInCents` deriva los centavos
de `String(value)` con aritmética decimal entera: una fracción de centavo (por
ejemplo, `1.005`) produce `RangeError`, incluso si otro dato de la obligación
no es evaluable. El adaptador la declara `INVALIDO` con motivo antes de evaluar.
`[0.29, 49999.71]` suma exactamente 50 000 ARS y aporta 20 puntos de monto.
La ausencia del corte municipal se rotula en el
consumidor según el contrato §5.1; este núcleo no inventa un corte.

**Resolución de módulos en Next (ALIGN-010).** Turbopack no resuelve archivos
fuera de su raíz. `front/next.config.ts` usa
`turbopack.root: path.join(__dirname, '..')` para importar el único JSON de
`contracts/` también desde las páginas existentes a través del mapper. No se
copia el contrato a `front/`. El despliegue debe incluir esa raíz del repositorio.
La suite fija `America/New_York` y restaura el huso para probar los cambios de
horario de verano; cubre actualización de origen igual al corte, ausente y
posterior. Los 43 casos, 14 pares y 5 ordenamientos golden siguen intactos.

La instrucción de ejecución de ALIGN-009 confirma la aprobación de la escala
0–4 por el usuario en ALIGN-003 (29/10/2026): intensa desde 3, máximo automático
2. Las menciones a aprobación pendiente de la escala en §7/§14 y en los
metadatos del JSON describen el estado de su especificación congelada; esta
implementación no modifica ese archivo. La aprobación de la política completa
y del umbral jurídico sigue siendo una condición separada.

## 17. Adaptador web — ALIGN-010

El [mapper de objetos](../../front/lib/mappers/debtor-object-mapper.ts) construye
`DecisionInput` con las obligaciones leídas, los contactos activos con valor de
las personas con relación activa y sus porcentajes declarados. Evalúa una vez
el núcleo y entrega `decision`, `decisionInput`, `rulesVersion`, `decisionAsOf`,
`decisionAsOfSource`, `decisionComputedAt` y `decisionIssues`. Los estados se
conservan: un dato mal formado lleva null, `INVALIDO` y motivo; uno ausente
nunca se completa con capital, un alias de importe presente ni un perfil.
El adaptador lee exclusivamente `current_amount`: clave ausente →
`NO_INTEGRADO`; clave presente con null, undefined o vacío →
`NO_INFORMADO_EN_ORIGEN`. No cambia el selector general de importes de otros
consumidores.
Una lectura fallida de `debt`/`debtor` impide construir la entrada/evaluar. Una
lista vacía leída correctamente permite el cero derivado de v1.
Si falla `debtor_person`, se registra `personas: NO_INTEGRADO: LECTURA_FALLIDA`
en `decisionIssues`. Las banderas de tipo de persona y porcentajes no son
evaluables: el núcleo requiere una lista completa y no admite una lista de
presencia desconocida. Por eso `decisionInput` y `decision` quedan null, sin
enviar `[]` como si no hubiera personas; `peopleCount` y prioridad también
quedan null. Una lectura correcta sin relaciones sí permite `personas: []`.

`RawDebtorDataBundle.batch` es el punto de entrada opcional del manifiesto
(`as_of` y `source_updated_at`); el lector actual todavía no lo integra. Sin
manifiesto se usa la fecha del calendario de Córdoba (`America/Argentina/Cordoba`) del instante UTC de cálculo capturado una sola vez, con el aviso
**“Fecha de cálculo usada: …; corte de origen no informado (corte no integrado)”**.
No se presenta como corte certificado. Con un manifiesto presente pero inválido
o sin fecha, la decisión es no disponible, sin sustitución silenciosa. El segundo
argumento del mapper permite inyectar `computedAt` para reproducir la consulta.
La fecha persistida del perfil sigue en `computedAt`; no se confunde con
`decisionComputedAt`. La versión y la fecha usada acompañan el motivo visible.

Las acciones de revisión (ALIGN-020) sí completan `batch` con el último evento
`PUBLICADO` de `import_batch`, y sin ese corte no registran: no usan la fecha de
cálculo. Hasta que ALIGN-021 lea la sugerencia con `getCaseReviewSnapshot`, los
listados pueden mostrar un motivo calculado con otra fecha que la de la decisión.

Los campos `estado_origen` y `periodo_fiscal` solo se consideran integrados si
llegan explícitamente. `debt.status` sigue siendo el catálogo persistido;
`debt.period` no se interpreta como período fiscal, ni `issue_date`/
`last_collection_date` como actualización de origen. Las FK numéricas de tipo
de persona no se interpretan sin su catálogo. La vulnerabilidad permanece
`NO_INFORMADO_EN_ORIGEN`; este adaptador no ofrece un canal para inferirla.

`risk`/`riskScore` del DTO de **objetos** son alias transitorios de banda y
severidad v1, para que las pantallas existentes consuman la misma decisión.
El perfil `socioeconomic_risk_level` y las fórmulas anteriores ya no intervienen.
`priorityScore` = severidad (0–100 o null), `priorityLevel` = banda v1; la falta
de contacto cambia la bandera, la intervención/cola y su explicación, **no**
los puntos. `isUrgentRecommendation` queda como alias de necesidad de revisión
humana o jurídica, no como urgencia legal. El presentador usa las etiquetas y
explicaciones del JSON y agrega “Evaluar con supervisor antes de gestionar”
cuando hay revisión. No afirma exigibilidad ni propone escalamiento.
Cuando hay obligaciones vencidas evaluables, el adaptador añade al motivo
“N obligación(es) vencida(s) a la fecha de corte AAAA-MM-DD”, con concordancia
singular/plural y la fecha del manifiesto, aunque se calcule otro día. Si no hay
manifiesto dice “a la fecha de cálculo usada”; si la severidad es PARCIAL,
antepone “Al menos” porque la cantidad es un mínimo; una decisión completa no lleva ese prefijo en el conteo. Ante lectura fallida de
contactos añade “Lectura de contactos no disponible: no se pudo verificar si
hay contacto cargado.” No modifica las frases del JSON congelado.

Los [selectores](../../front/lib/equitas-view-selectors.ts) crean las cinco colas
por código de intervención. El orden de presentación es el del catálogo del
JSON, sin comparar prioridades entre colas; dentro de cada una se usa
`comparePriority`. Los objetos sin evaluación tienen un grupo separado **No
disponible**, ordenado por id. En un universo leído, `count = cases.length`,
los destacados son los primeros tres de esa misma lista y los agregados toman
el monto evaluable y la severidad de la decisión, con desglose de faltantes.
Si falla `debtor`, todos los conteos y agregados son null y las listas quedan
vacías. Si falla `debt`, `debtor_contact` o `debtor_person`, o hay objetos pero
ninguno tiene decisión (por ejemplo, corte inválido), la pertenencia a las cinco
colas es desconocida: conteos, sumas y promedios son null/`NO_INTEGRADO`, nunca
0 derivado ni `NO_APLICA`, y sus listas quedan vacías. El grupo **No disponible**
conserva todos los objetos conocidos con `count = cases.length`, aun si tienen
decisión individual pero la lectura de contactos impide conocer la cola.
Sin falla de lectura y con al menos una decisión, los objetos evaluados siguen
en sus colas, conservando mínimos parciales y faltantes; los bloqueados se
cuentan aparte (§4.1, regla 3 del contrato). `person`, `debtor_profile` y
`debt_status` no determinan disponibilidad de las colas. Un universo leído
correctamente sin objetos sí permite conteos/sumas 0 y promedios `NO_APLICA`.
La banda alta se obtiene del núcleo, inclusive desde 70 puntos.

La [adenda del catálogo](catalogo-indicadores-v1.md#16-adenda-align-010-colas-y-dimensiones-v1)
define unidades, poblaciones y límites. ALIGN-012 actualiza los rótulos heredados
“riesgo”, “riesgo >90” y “Score” en el detalle, `/people`, `/risk-analysis` y el
ingreso, y “urgente” en la línea de faltantes. Los de `/`, `/debtors`,
`/no-contact`, `/priority-cases` y `/recommended-actions` se traspasan a ALIGN-014,
que además conserva la responsabilidad de reemplazar los agregados y el orden
global del tablero y los indicadores de mora basados en perfil/catálogo. ALIGN-010 inicializa los
conteos del tablero desde las cinco etiquetas v1 y “No disponible”: una cola
vacía leída tiene 0; la misma condición de colas desconocidas del resumen
produce `byRecommendation: []`. Una decisión R2 sin puntaje sí permite contar
su cola; no se usa la disponibilidad de `priorityCases` como condición.
Los demás agregados del tablero no se modifican aquí.
Los campos financieros históricos se mantienen separados y
no alimentan las decisiones ni las sumas de las colas v1.

**Seguimiento Python (MENOR-2 de ALIGN-009):** el motor Python todavía redondea
fracciones de centavo. Su responsable debe aplicar el mismo rechazo decimal
antes de evaluar; no se modificó backend/ETL en ALIGN-010. La paridad exigida
para entradas válidas se conserva mediante los golden compartidos sin cambios.
