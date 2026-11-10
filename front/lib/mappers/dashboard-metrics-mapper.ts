import { aggregateData, compareNullable, metric, observed, readingFailed, unavailable } from '@/lib/data-presence'
import { compareObjectIds, coverageText, maturityMetrics, portfolioContext, sumMoney } from '@/lib/analytics'
import { buildRecommendationSummary, getNoContactCases } from '@/lib/equitas-view-selectors'
import type { DashboardData, DataWarning, DebtorListItem, NumericData } from '@/types/equitas-domain'

type DashboardMapperInput = { debtors: DebtorListItem[]; debtStatusBuckets: Map<string, number>; warnings?: DataWarning[] }

export function mapDashboardMetricsFromDebtorObjects({ debtors, debtStatusBuckets, warnings = [] }: DashboardMapperInput): DashboardData {
  const failed = (...tables: string[]) => readingFailed(warnings, 'debtor', ...tables)
  // Sin el catálogo de estados no se sabe qué está pagado: no hay decisión ni deuda pendiente o vencida.
  const severityFailed = failed('debt', 'debt_status', 'debtor_person')
  // Total registrado, deuda pendiente y vencida salen de las obligaciones (portfolio-totals), no del perfil.
  const moneyFailed = failed('debt')
  const pendingFailed = failed('debt', 'debt_status')
  const contactsFailed = failed('debtor_contact', 'debtor_person')
  const queues = buildRecommendationSummary(debtors, warnings)
  const coverage: Record<string, string> = {}
  const count = (key: keyof DebtorListItem & string, predicate: (item: DebtorListItem) => boolean, blocked: boolean) => {
    const values = debtors.map(item => {
      const data = metric(item, key)
      const missing = Object.fromEntries(Object.entries(data.missing).filter(([, n]) => n > 0).map(([state]) => [state, 1]))
      return { ...(data.value === null ? data : observed(predicate(item) ? 1 : 0)), missing }
    })
    return aggregateData(values, 'sum', blocked)
  }
  const severity = debtors.map(item => metric(item, 'riskScore'))
  const amounts = debtors.map(item => metric(item, 'totalDebt'))
  const pending = debtors.map(item => metric(item, 'pendingDebt'))
  const contacts = debtors.map(item => metric(item, 'contactCount'))
  const maturity = debtors.map(maturityMetrics)
  const reviews = debtors.map(item => item.decision ? { ...observed(item.isUrgentRecommendation ? 1 : 0), missing: Object.fromEntries(Object.keys(metric(item, 'priorityScore').missing).map(state => [state, 1])) } : metric(item, 'priorityScore'))
  const high = count('riskScore', item => item.risk === 'ALTO', severityFailed)
  const metrics: Record<string, NumericData> = {
    totalDebtors: failed() ? unavailable() : observed(debtors.length),
    totalDebt: sumMoney(amounts, moneyFailed),
    pendingDebt: sumMoney(pending, pendingFailed),
    overdueDebt: sumMoney(maturity.map(item => item.overdueDebt), pendingFailed),
    overdueCases: aggregateData(maturity.map(item => ({ ...item.overdueCases, missing: Object.fromEntries(Object.keys(item.overdueCases.missing).map(key => [key, 1])) })), 'sum', severityFailed),
    withContactCases: count('contactCount', item => item.hasContact === true, contactsFailed),
    withoutContactCases: count('contactCount', item => item.hasContact === false, contactsFailed),
    priorityCases: high,
    highSeverityCases: high,
    urgentRecommendationCases: aggregateData(reviews, 'sum', failed('debt', 'debtor_person', 'debtor_contact')),
    // Compatibilidad: críticos se redefine por una sola población, banda alta v1.
    criticalCasesToday: high,
    riskAboveNinetyCases: count('riskScore', item => item.riskScore! > 90, severityFailed),
    criticalDebtTotal: sumMoney(debtors.map(item => item.riskScore === null ? metric(item, 'riskScore') : item.risk === 'ALTO' ? metric(item, 'totalDebt') : observed(0)), severityFailed || moneyFailed),
  }
  coverage.totalDebt = coverageText(amounts, moneyFailed)
  coverage.pendingDebt = coverageText(pending, pendingFailed)
  coverage.overdueDebt = coverageText(maturity.map(item => item.overdueDebt), pendingFailed)
  coverage.priorityCases = coverageText(severity, severityFailed)
  coverage.highSeverityCases = coverage.priorityCases
  coverage.overdueCases = coverageText(maturity.map(item => item.overdueCases), severityFailed)
  coverage.withContactCases = coverage.withoutContactCases = coverageText(contacts, contactsFailed)
  coverage.urgentRecommendationCases = coverageText(reviews, failed('debt', 'debtor_person', 'debtor_contact'))
  const topDebt = moneyFailed ? [] : [...debtors].filter(item => item.totalDebt !== null)
    .sort((a, b) => compareNullable(a.totalDebt, b.totalDebt) || compareObjectIds(a, b)).slice(0, 5)
  const byType = new Map<string, number>()
  const byRisk = new Map<string, number>([['ALTO', 0], ['MEDIO', 0], ['BAJO', 0]])
  for (const item of debtors) {
    byType.set(item.type, (byType.get(item.type) ?? 0) + 1)
    byRisk.set(item.risk ?? 'No disponible', (byRisk.get(item.risk ?? 'No disponible') ?? 0) + 1)
  }
  return {
    metrics, coverage, context: portfolioContext(debtors, warnings),
    queuePreviews: queues.map(group => ({ code: group.interventionCode, label: group.recommendation, count: group.count, cases: group.highlightedCases })),
    totalDebtors: metrics.totalDebtors.value, totalDebt: metrics.totalDebt.value,
    pendingDebt: metrics.pendingDebt.value, overdueDebt: metrics.overdueDebt.value,
    overdueCases: metrics.overdueCases.value, withContactCases: metrics.withContactCases.value,
    withoutContactCases: metrics.withoutContactCases.value, priorityCases: metrics.priorityCases.value,
    urgentRecommendationCases: metrics.urgentRecommendationCases.value,
    criticalCasesToday: metrics.criticalCasesToday.value, riskAboveNinetyCases: metrics.riskAboveNinetyCases.value,
    criticalDebtTotal: metrics.criticalDebtTotal.value,
    byDebtStatus: failed('debt', 'debt_status') ? [] : Array.from(debtStatusBuckets, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    byDebtorType: failed('debtor_type') ? [] : Array.from(byType, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)),
    byRisk: severityFailed ? [] : Array.from(byRisk).filter(([label]) => label === 'No disponible' || !debtors.length || severity.some(item => item.value !== null)).map(([label, value]) => ({ label, value })),
    byRecommendation: queues.flatMap(group => group.count === null ? [] : [{ label: group.recommendation, value: group.count }]),
    topDebtChart: topDebt.map(item => ({ label: item.identifier, value: item.totalDebt! })),
    topDebtors: topDebt,
    // No se publica un ranking global de prioridad entre intervenciones.
    topPriorityDebtors: [],
    withoutContactDebtors: contactsFailed ? [] : getNoContactCases(debtors).slice(0, 5).map(item => ({ ...item, overdueDays: maturityMetrics(item).maxDaysOverdue.value })),
    topDebtDebtors: topDebt.map(item => ({ ...item, overdueDays: maturityMetrics(item).maxDaysOverdue.value })),
  }
}
