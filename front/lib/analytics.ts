import { formatNumber, metric, observed, readingFailed, unavailable } from '@/lib/data-presence'
import type { DataWarning, DebtorListItem, NumericData, RawDebtorDataBundle } from '@/types/equitas-domain'

export { moneyData, sumMoney } from '@/lib/data-presence'

export function coverageText(values: NumericData[], failed = false, unit = 'objetos') {
  if (failed) return 'Cobertura no disponible: lectura fallida o selección incompleta.'
  const count = values.filter(item => item.value !== null).length
  const partial = values.filter(item => item.value !== null && Object.values(item.missing).some(value => value! > 0)).length
  return `${formatNumber(count)} de ${formatNumber(values.length)} ${unit} con dato${partial ? `; ${formatNumber(partial)} parciales` : ''}.`
}

export function portfolioContext(debtors: DebtorListItem[], warnings: DataWarning[] = [], batch?: RawDebtorDataBundle['batch']) {
  if (readingFailed(warnings, 'debtor')) return 'Población y corte no disponibles: lectura fallida de objetos.'
  if (readingFailed(warnings, 'import_batch')) return 'Corte no disponible: publicación incompleta, inválida o lectura fallida. Las decisiones al corte no están disponibles; los saldos se suman de las obligaciones leídas y no tienen corte de origen integrado.'
  const dates = batch ? [batch.as_of].filter(Boolean) : [...new Set(debtors.map(item => item.decisionAsOf?.valor).filter(Boolean))].sort()
  const unknown = batch ? !batch.as_of : debtors.some(item => item.decisionAsOf?.estado !== 'OBSERVADO')
  const clock = !batch && debtors.some(item => item.decisionAsOfSource === 'FECHA_CALCULO')
  const cutoff = dates.length ? `${clock ? 'Fecha de cálculo usada (Córdoba)' : 'Corte del manifiesto'}: ${dates.join(', ')}.` : 'Corte no disponible.'
  return `${cutoff}${clock ? ' Corte de origen no informado (corte no integrado).' : ''}${unknown ? ' Hay objetos sin corte evaluable.' : ''} Total registrado, deuda pendiente y vencida: suma de las obligaciones leídas (las pagadas no son deuda pendiente). Las cifras se calculan antes de paginar.`
}

// La mora analítica es la de portfolio-totals, ya calculada por el mapeador con las mismas
// obligaciones y la misma definición de las reglas (calendario y no pagada). No la recalcula ni
// usa el estado de catálogo ni el monto vencido persistido. Un DTO sin esos totales (forma anterior)
// no reconstruye una mora: queda no disponible.
export function maturityMetrics(debtor: DebtorListItem) {
  const { overdueDebt, maxDaysOverdue, overdueDebtsCount: count } = debtor.metrics ?? {}
  if (!overdueDebt || !maxDaysOverdue || !count) {
    const source = metric(debtor, 'priorityScore')
    const missing = source.value === null ? source : unavailable()
    return { overdueDebt: missing, maxDaysOverdue: missing, overdueCases: missing }
  }
  return {
    overdueDebt,
    maxDaysOverdue,
    overdueCases: count.value === null ? count : { ...observed(count.value > 0 ? 1 : 0), missing: count.missing },
  }
}

// Proyección para las vistas: conserva el saldo y el estado históricos, pero
// muestra la misma mora al corte que la analítica y el CSV. No muta el DTO de origen.
export function withMaturityMetrics(debtor: DebtorListItem) {
  const { overdueDebt, maxDaysOverdue } = maturityMetrics(debtor)
  return { ...debtor, overdueDebt: overdueDebt.value, maxDaysOverdue: maxDaysOverdue.value,
    metrics: { ...debtor.metrics, overdueDebt, maxDaysOverdue } }
}

export function compareObjectIds(a: Pick<DebtorListItem, 'id'>, b: Pick<DebtorListItem, 'id'>) {
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1
}
