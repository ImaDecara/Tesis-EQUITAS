# Reglas de decisión 1.1.0: las obligaciones pagadas

Contrato: `contracts/decision-rules.v1.1.json` · Casos de referencia: `contracts/decision-rules.v1.1.golden.json` ·
Casos chicos: `contracts/portfolio-small-cases.v1.json` y [casos-chicos-v1.md](casos-chicos-v1.md) ·
Versión anterior: [reglas-decision-v1.md](reglas-decision-v1.md) (1.0.0, sin cambios).

## Qué cambia respecto de 1.0.0

Una única corrección. Una obligación cuyo estado de catálogo (`debt.status` → `debt_status.key`) es
exactamente `PAID` queda fuera del cálculo:

- no suma a la deuda pendiente ni al monto que puntúa (`severidad.monto_actualizado_ars`);
- no es vencida y no aporta atraso ni cantidad de vencidas;
- no cuenta como «no evaluable» aunque le falte el importe o el vencimiento, ni levanta
  `FECHAS_INCONSISTENTES` ni las demás banderas de obligación;
- no entra en «obligaciones leídas» del texto explicativo. Se informa aparte cuántas se excluyeron
  (`severidad.obligaciones_pagadas`).

Un objeto con solo obligaciones pagadas se evalúa como un objeto sin obligaciones: puntaje 0, estado
COMPLETA, banda BAJA; regla R7 (seguimiento sin contacto) si tiene un contacto activo y R1 (mejorar datos)
si no lo tiene.

La misma definición rige en toda pantalla, reporte y cálculo (`front/lib/domain/portfolio-totals.ts`,
`back/services/decision_rules_v1.py`, `back/ETL/transform.py` y la migración
`supabase/migrations/20261110120000_debtor_profile_rules_1_1.sql`):

| Concepto | Definición |
|---|---|
| Total registrado | Importe de todas las obligaciones, cualquiera sea su estado. |
| Deuda pendiente | Suma directa de las obligaciones no pagadas. No es una resta: una pagada sin importe no la afecta. |
| Deuda vencida | Obligaciones pendientes con importe mayor que cero y vencimiento anterior a la fecha de la cartera. |

La clave `OVERDUE` y el rótulo «Vencida» del catálogo ya no deciden la mora en ninguna vista: se decide por
importe y calendario, igual que en las reglas. El rótulo se sigue mostrando como desglose informativo.

## Por qué

Decisión del usuario del 2026-11-10 (plan de entrega, noche 7, §9.2 y D4): una deuda pagada no es deuda
pendiente, no está vencida y no debe priorizar un caso. Es un cambio respecto de 1.0.0 y del cargador de
`main`, que no excluye ningún estado. Por la política de cambios del contrato es una versión nueva, con su
propio archivo y sus casos de referencia; 1.0.0 no se editó.

## Qué no cambia

- Parámetros, bandas, umbrales, reglas R1–R7, modificador M1, textos y mensajes: idénticos a 1.0.0.
- Suspendidas, plan de pago, judicial, certificado activo y canceladas se computan exactamente como antes,
  por importe y vencimiento. No hay regla nueva para ningún otro estado; ningún estado se renombra y
  ninguna obligación se reclasifica.
- Un estado ausente, no informado o no reconocido se computa por importe y vencimiento: nunca se trata como
  pagado. Si el catálogo `debt_status` no se pudo leer, el objeto no se evalúa (decisión no disponible): un
  error de lectura nunca se convierte en «no pagada» ni en cero.
- Las decisiones ya registradas conservan la versión con la que se tomaron. El mismo evaluador reproduce el
  golden 1.0.0 con el contrato 1.0.0 y el 1.1.0 con el 1.1.0; la versión activa es una sola constante por
  lenguaje (`RULES_VERSION = '1.1.0'` en TypeScript y Python, con una prueba que exige que coincidan).
- El hash de insumos de una decisión incluye el estado de catálogo: pagar una obligación cambia la base de la
  sugerencia y una decisión anterior se muestra como tomada sobre datos anteriores.

## Incertidumbre sobre los estados de producción

Según la evidencia del 2026-11-09 (`estados-de-obligacion-evidencia-2026-11-09.md` del plan de entrega):

1. No se observó el catálogo actual de producción: no se sabe si existe allí la clave `PAID` ni otras.
2. No se sabe qué estados tienen hoy las obligaciones de producción; el cargador de `main` solo asigna
   vigente, vencida o desconocida, de modo que hoy no habría pagadas que excluir.
3. Nadie definió cómo se computa una obligación suspendida, en plan de pago, judicial, con certificado o
   cancelada: por eso no se les aplica ninguna regla nueva.

Quién define cómo se computa cada estado es una decisión municipal pendiente.

## Naturaleza

Son reglas determinísticas y explícitas: el mismo dato da siempre el mismo resultado y cada punto se explica.
El puntaje de 0 a 100 ordena el trabajo dentro de una cola; no es una probabilidad de pago, de recupero ni de
ningún otro evento, y no se calibró con datos.
