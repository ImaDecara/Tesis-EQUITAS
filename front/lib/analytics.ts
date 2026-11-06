import rules from '../../contracts/decision-rules.v1.json'
import { formatNumber, metric, observed, readingFailed, sumMoney, unavailable } from '@/lib/data-presence'
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
  if (readingFailed(warnings, 'import_batch')) return 'Corte no disponible: publicación incompleta, inválida o lectura fallida. Las decisiones al corte no están disponibles; los saldos históricos pueden provenir del perfil persistido y no tienen corte de origen integrado.'
  const dates = batch ? [batch.as_of].filter(Boolean) : [...new Set(debtors.map(item => item.decisionAsOf?.valor).filter(Boolean))].sort()
  const unknown = batch ? !batch.as_of : debtors.some(item => item.decisionAsOf?.estado !== 'OBSERVADO')
  const clock = !batch && debtors.some(item => item.decisionAsOfSource === 'FECHA_CALCULO')
  const cutoff = dates.length ? `${clock ? 'Fecha de cálculo usada (Córdoba)' : 'Corte del manifiesto'}: ${dates.join(', ')}.` : 'Corte no disponible.'
  return `${cutoff}${clock ? ' Corte de origen no informado (corte no integrado).' : ''}${unknown ? ' Hay objetos sin corte evaluable.' : ''} Saldos históricos: corte de origen no integrado; pueden provenir del perfil persistido. Las cifras se calculan antes de paginar.`
}

// La mora analítica usa las mismas obligaciones evaluables de v1, nunca el estado
// de catálogo ni el monto vencido persistido. No vuelve a ejecutar las reglas.
export function maturityMetrics(debtor: DebtorListItem) {
  const severity = debtor.decision?.severidad
  if (!severity || !debtor.decisionInput || severity.estado === 'NO_DISPONIBLE') {
    const source = metric(debtor, 'priorityScore')
    const missing = source.value === null ? source : unavailable()
    return { overdueDebt: missing, maxDaysOverdue: missing, overdueCases: missing }
  }
  const values = debtor.decisionInput.obligaciones.map(item => {
    const amount = item.current_amount; const due = item.due_date
    if (amount.estado !== 'OBSERVADO') return unavailable(amount.estado)
    if (due.estado !== 'OBSERVADO') return unavailable(due.estado)
    if (amount.valor < 0 || due.valor < rules.evaluabilidad.fecha_minima_plausible) return unavailable('INVALIDO')
    return observed(amount.valor > 0 && due.valor < debtor.decisionInput!.as_of ? amount.valor : 0)
  })
  const overdueDebt = sumMoney(values)
  const maxDaysOverdue = severity.dias_atraso_maximo === null
    ? severity.estado === 'PARCIAL' ? { ...unavailable(), missing: overdueDebt.missing } : { value: null, presence: 'NO_APLICA' as const, missing: {} }
    : { ...observed(severity.dias_atraso_maximo), missing: overdueDebt.missing }
  return {
    overdueDebt,
    maxDaysOverdue,
    overdueCases: { ...observed(severity.cantidad_vencidas! > 0 ? 1 : 0), missing: overdueDebt.missing },
  }
}

// Proyección para las vistas: conserva el saldo y el estado históricos, pero
// muestra la misma mora al corte que la analítica y el CSV. No muta el DTO de origen.
export function withMaturityMetrics(debtor: DebtorListItem) {
  const maturity = maturityMetrics(debtor)
  return { ...debtor, overdueDebt: maturity.overdueDebt.value, maxDaysOverdue: maturity.maxDaysOverdue.value,
    metrics: { ...debtor.metrics, ...maturity } }
}

export function compareObjectIds(a: Pick<DebtorListItem, 'id'>, b: Pick<DebtorListItem, 'id'>) {
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1
}
