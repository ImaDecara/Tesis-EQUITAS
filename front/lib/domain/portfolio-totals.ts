import { aggregateData, observed, sumMoney, unavailable } from '@/lib/data-presence'
import { ACTIVE_RULES, isPaidObligation, type DecisionObligation, type RulesContract } from '@/lib/domain/decision-rules-v1'
import type { NumericData } from '@/types/equitas-domain'

// Definiciones únicas de la cartera (plan de entrega §9.3), iguales en toda pantalla y reporte:
// - Total registrado: importe de todas las obligaciones, cualquiera sea su estado.
// - Deuda pendiente: suma directa de las obligaciones NO pagadas (nunca total − pagadas: una
//   pagada sin importe no la contamina).
// - Deuda vencida: obligaciones pendientes con importe > 0 y vencimiento anterior al corte.
// «Pagada» es la definición de las reglas activas (isPaidObligation). La mora sale por calendario,
// igual que en evaluateSeverity: el rótulo o la clave OVERDUE del catálogo no cuentan.
// Un dato faltante nunca es cero: queda en `missing` (contrato de dominio §4).

export type ObjectTotals = {
  registeredTotal: NumericData
  pendingDebt: NumericData
  overdueDebt: NumericData
  overdueCount: NumericData
  maxDaysOverdue: NumericData
}

export type TotalsReads = {
  // Corte de la decisión (manifiesto o fecha de cálculo); null si no hay uno evaluable.
  asOf: string | null
  // Lectura fallida de obligaciones: nada es calculable.
  debtsFailed?: boolean
  // Lectura fallida del catálogo debt_status: no se sabe qué está pagado.
  statusesFailed?: boolean
}

const DAY = 86_400_000

function amountData(obligation: DecisionObligation): NumericData {
  const amount = obligation.current_amount
  return amount.estado === 'OBSERVADO' ? observed(amount.valor) : unavailable(amount.estado)
}

export function totalsUnavailable(): ObjectTotals {
  const missing = unavailable()
  return { registeredTotal: missing, pendingDebt: missing, overdueDebt: missing, overdueCount: missing, maxDaysOverdue: missing }
}

/** Totales de un objeto a partir de sus obligaciones normalizadas (las mismas que evalúan las reglas). */
export function objectTotals(
  obligations: readonly DecisionObligation[], reads: TotalsReads, contract: RulesContract = ACTIVE_RULES
): ObjectTotals {
  if (reads.debtsFailed) return totalsUnavailable()
  const registeredTotal = sumMoney(obligations.map(amountData))
  if (reads.statusesFailed) return { ...totalsUnavailable(), registeredTotal }
  const pending = obligations.filter(obligation => !isPaidObligation(obligation, contract))
  const pendingDebt = sumMoney(pending.map(amountData))
  if (reads.asOf === null) return { ...totalsUnavailable(), registeredTotal, pendingDebt }
  const cutoff = Date.parse(`${reads.asOf}T00:00:00.000Z`)
  const minimum = contract.evaluabilidad.fecha_minima_plausible
  const days: number[] = []
  const values = pending.map(obligation => {
    const amount = obligation.current_amount
    const due = obligation.due_date
    if (amount.estado !== 'OBSERVADO') return unavailable(amount.estado)
    if (due.estado !== 'OBSERVADO') return unavailable(due.estado)
    if (amount.valor < 0 || due.valor < minimum) return unavailable('INVALIDO')
    if (!(amount.valor > 0 && due.valor < reads.asOf!)) return observed(0)
    days.push(Math.round((cutoff - Date.parse(`${due.valor}T00:00:00.000Z`)) / DAY))
    return observed(amount.valor)
  })
  const overdueDebt = sumMoney(values)
  const missing = overdueDebt.missing
  const maxDaysOverdue: NumericData = days.length
    ? { ...observed(Math.max(...days)), missing }
    : Object.keys(missing).length
      ? aggregateData(values.filter(value => value.value === null), 'max')
      : { value: null, presence: 'NO_APLICA', missing: {} }
  return {
    registeredTotal,
    pendingDebt,
    overdueDebt,
    overdueCount: { ...observed(days.length), missing },
    maxDaysOverdue,
  }
}
