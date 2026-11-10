# Casos chicos de la cartera (reglas 1.1.0)

Datos: `contracts/portfolio-small-cases.v1.json` (sintéticos). Fecha de la cartera: **2026-09-30**.
Resultados calculados a mano. Las pruebas los afirman con los mismos números en el motor de reglas
(TypeScript y Python), `analytics.ts`, el mapeo de objetos y del tablero, los reportes de cola y de calidad,
`scoring_service` y el oráculo del perfil (`build_debtor_profile_payload`, mismo cálculo que la migración
`20261110120000_debtor_profile_rules_1_1.sql`). Cada caso repite la entrada de SINT-P01..P10 del golden 1.1.0.

Definiciones: [reglas-decision-v1.1.md](reglas-decision-v1.1.md). Puntaje = monto (hasta 50) + atraso máximo
(hasta 30) + cantidad de vencidas (hasta 20); sin vencidas el puntaje es 0. Bandas: MEDIA desde 40, ALTA desde 70.
«(+1 faltante)» indica una obligación cuyo dato falta en esa suma: no se cuenta como cero.

| Caso | Obligaciones | Total registrado | Deuda pendiente | Vencidas | Importe vencido | Atraso máximo | Puntaje | Grupo | Regla |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
| CHICO-01 Solo pagadas | pagada $ 30.000 (01/03/2026); pagada $ 12.500 sin vencimiento | $ 42.500 | $ 0 | 0 | $ 0 | no aplica | 0 | Seguimiento | R7 |
| CHICO-02 DEMO6-6-60012 | pagada $ 48.000 (10/10/2025); suspendida $ 47.150 (10/01/2026); vencida $ 46.200 (10/04/2026) | $ 141.350 | $ 93.350 | 2 | $ 93.350 | 263 días | 45 = 20 + 20 + 5 (MEDIA) | Recordatorio | R5 |
| CHICO-03 Vencida con importe cero | «Vencida» $ 0 (01/05/2026) | $ 0 | $ 0 | 0 | $ 0 | no aplica | 0 | Seguimiento | R7 |
| CHICO-04 Vence después de la fecha | $ 80.000 (15/10/2026); $ 20.000 (30/09/2026) | $ 100.000 | $ 100.000 | 0 | $ 0 | no aplica | 0 | Seguimiento | R7 |
| CHICO-05 Sin vencimiento | vencida $ 60.000 (01/02/2026); desconocida $ 25.000 sin vencimiento | $ 85.000 | $ 85.000 | al menos 1 | $ 60.000 (+1 faltante) | 241 días | al menos 45 = 20 + 20 + 5 (MEDIA) | Recordatorio | R5 |
| CHICO-06 Sin importe | vencida sin importe (15/03/2026); $ 10.000 (30/11/2026) | $ 10.000 (+1 faltante) | $ 10.000 (+1 faltante) | al menos 0 | $ 0 (+1 faltante) | no disponible | al menos 0 | Seguimiento | R7 |
| CHICO-07 Dos titulares | vencida $ 250.000 (01/12/2025); $ 30.000 (31/10/2026); titulares 50 % y 50 % | $ 280.000 | $ 280.000 | 1 | $ 250.000 | 303 días | 55 = 30 + 20 + 5 (MEDIA) | Recordatorio | R5 |
| CHICO-08 Estado no reconocido o ausente | estado fuera del catálogo $ 40.000 (30/06/2026); sin estado $ 15.000 (31/08/2026) | $ 55.000 | $ 55.000 | 2 | $ 55.000 | 92 días | 40 = 20 + 15 + 5 (MEDIA) | Recordatorio | R5 |
| CHICO-09 Pagada sin importe | pagada sin importe ni vencimiento; vencida $ 70.000 (30/09/2025) | $ 70.000 (+1 faltante) | $ 70.000 | 1 | $ 70.000 | 365 días | 45 = 20 + 20 + 5 (MEDIA) | Recordatorio | R5 |
| CHICO-10 Solo pagadas, sin contacto | pagada $ 5.000 (31/01/2026) | $ 5.000 | $ 0 | 0 | $ 0 | no aplica | 0 | Mejorar datos | R1 |
| **Tablero (10 objetos)** | 19 obligaciones | **$ 788.850** (+2 faltantes) | **$ 693.350** (+1 faltante) | 5 objetos con vencidas (+2 con faltantes) | **$ 528.350** (+2 faltantes) | — | — | 5 Recordatorio · 4 Seguimiento · 1 Mejorar datos | — |

## Explicación por caso

- **CHICO-01.** Las pagadas suman al total registrado pero no a la deuda pendiente ni a la vencida; la pagada sin vencimiento no vuelve parcial el cálculo. Sin mora el puntaje es 0 y, con contacto, se sugiere seguimiento sin contacto (R7).
- **CHICO-02.** 48.000 + 47.150 + 46.200 = 141.350; sin la pagada quedan 93.350. La suspendida se computa como antes por importe y vencimiento: 30/09/2026 − 10/01/2026 = 263 días. 93.350 ≥ 50.000 (20 puntos), 263 ≥ 181 (20) y 2 vencidas (5): 45. Con 1.0.0 la pagada contaba como vencida y daba 50.
- **CHICO-03.** El rótulo del catálogo dice «Vencida», pero con importe 0 la obligación no cuenta como vencida: el conteo usa importe y calendario, no el rótulo, que se sigue mostrando en el desglose por estado.
- **CHICO-04.** La comparación con la fecha de la cartera es estricta: lo que vence el 30/09/2026 o después no está vencido. Sin vencidas el monto no puntúa (regla sin vencidas).
- **CHICO-05.** La obligación sin vencimiento no se sabe si está vencida: no se cuenta como cero ni como vencida. El puntaje es un mínimo (severidad parcial) y la sugerencia pide revisión humana.
- **CHICO-06.** El importe faltante no se suma como cero en ningún total; sin vencidas conocidas el atraso queda no disponible y el perfil guarda la deuda vencida como nula, no como cero.
- **CHICO-07.** La unidad es el objeto: sus obligaciones se suman una sola vez aunque tenga dos titulares. 280.000 ≥ 200.000 (30), 303 días (20), 1 vencida (5): 55.
- **CHICO-08.** Ni un estado fuera del catálogo ni la falta de estado convierten la obligación en pagada: se computa por importe y vencimiento. 92 ≥ 91 días da 15 puntos y el total, 40, queda justo en el umbral MEDIA.
- **CHICO-09.** La deuda pendiente es una suma directa de lo no pagado: la pagada sin importe deja un faltante en el total registrado, no en la deuda pendiente, y no vuelve parcial la severidad. 365 días todavía está en la banda de 181 a 365 (20 puntos).
- **CHICO-10.** Igual que CHICO-01 pero sin contacto activo: la falta de contacto lleva a mejorar datos (R1) sin cambiar el puntaje.

## Perfil persistido (`debtor_profile`)

Mismos casos en el oráculo del perfil y en la migración 1.1.0: `total_debt_amount` es el total registrado;
`overdue_debt_amount`, `overdue_debt_count`, `oldest_debt_days` y `average_debt_age_days` salen del calendario
sobre las no pagadas. CHICO-02: 141350.00 / 93350.00 / 2 / 263 / 218. CHICO-06: 10000.00 / nulo / nulo (hay una
no pagada no evaluable y ninguna vencida conocida). Los demás valores están en el campo `perfil` de cada caso del
JSON.
