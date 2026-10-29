import { aggregateData, compareNullable, metric, observed, readingFailed, unavailable } from '@/lib/data-presence'
import type { DashboardData, DataWarning, DebtorListItem, NumericData } from '@/types/equitas-domain'

type DashboardMapperInput = {
  debtors: DebtorListItem[]
  debtStatusBuckets: Map<string, number>
  warnings?: DataWarning[]
}

function buildTopDebtChart(debtors: DebtorListItem[]) {
  return debtors.filter((debtor): debtor is DebtorListItem & { totalDebt: number } => debtor.totalDebt !== null)
    .sort((a, b) => compareNullable(a.totalDebt, b.totalDebt))
    .slice(0, 5)
    .map((debtor) => ({
      label: debtor.identifier,
      value: debtor.totalDebt,
    }))
}

// Convierte el universo de objetos de deuda en indicadores accionables de gestion diaria.
export function mapDashboardMetricsFromDebtorObjects({
  debtors,
  debtStatusBuckets,
  warnings = [],
}: DashboardMapperInput): DashboardData {
  const byDebtorTypeMap = new Map<string, number>()
  const byRiskMap = new Map<string, number>([
    ['ALTO', 0],
    ['MEDIO', 0],
    ['BAJO', 0],
  ])
  const byRecommendationMap = new Map<string, number>([
    ['Llamado prioritario', 0],
    ['Mensaje recordatorio', 0],
    ['Plan de pago / revision humana', 0],
    ['Seguimiento posterior', 0],
  ])

  for (const debtor of debtors) {
    byDebtorTypeMap.set(debtor.type, (byDebtorTypeMap.get(debtor.type) ?? 0) + 1)
    byRiskMap.set(debtor.risk ?? 'No disponible', (byRiskMap.get(debtor.risk ?? 'No disponible') ?? 0) + 1)
    byRecommendationMap.set(
      debtor.recommendationType,
      (byRecommendationMap.get(debtor.recommendationType) ?? 0) + 1
    )
  }

  const sortedByPriority = [...debtors].sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) {
      return compareNullable(a.priorityScore, b.priorityScore)
    }

    if (b.totalDebt !== a.totalDebt) {
      return compareNullable(a.totalDebt, b.totalDebt)
    }

    return compareNullable(a.maxDaysOverdue, b.maxDaysOverdue)
  })

  const sortedByDebt = [...debtors].sort((a, b) => compareNullable(a.totalDebt, b.totalDebt))

  const topPriorityDebtors = sortedByPriority.slice(0, 5).map((item) => ({
    id: item.id,
    identifier: item.identifier,
    type: item.type,
    totalDebt: item.totalDebt,
    overdueDays: item.maxDaysOverdue,
    risk: item.risk,
    riskScore: item.riskScore,
    hasContact: item.hasContact,
    recommendationType: item.recommendationType,
    priorityScore: item.priorityScore,
    priorityLevel: item.priorityLevel,
  }))

  const topDebtDebtors = sortedByDebt.slice(0, 5).map((item) => ({
    id: item.id,
    identifier: item.identifier,
    type: item.type,
    totalDebt: item.totalDebt,
    overdueDays: item.maxDaysOverdue,
    risk: item.risk,
    riskScore: item.riskScore,
    recommendationType: item.recommendationType,
  }))

  const withoutContactDebtors = sortedByPriority
    .filter((item) => item.hasContact === false)
    .slice(0, 5)
    .map((item) => ({
      id: item.id,
      identifier: item.identifier,
      type: item.type,
      totalDebt: item.totalDebt,
      overdueDays: item.maxDaysOverdue,
      risk: item.risk,
      riskScore: item.riskScore,
    }))

  // Panel ejecutivo: define casos criticos con riesgo extremo o urgencia operativa de hoy.
  const criticalDebtors = debtors.filter(
    (debtor) =>
      debtor.riskScore !== null && debtor.riskScore > 90 ||
      debtor.isUrgentRecommendation ||
      (debtor.overdueDebt !== null && debtor.overdueDebt > 0 && debtor.hasContact === false)
  )
  const failed = (...tables: string[]) => readingFailed(warnings, 'debtor', ...tables)
  const count = (key: keyof DebtorListItem & string, predicate: (debtor: DebtorListItem) => boolean, ...tables: string[]) =>
    aggregateData(debtors.map(debtor => {
      const input = metric(debtor, key)
      // El universo del KPI son objetos: cada objeto incompleto cuenta una vez por estado.
      const missing = Object.fromEntries(Object.entries(input.missing).filter(([, value]) => value > 0).map(([state]) => [state, 1]))
      return { ...(input.value === null ? input : observed(predicate(debtor) ? 1 : 0)), missing }
    }), 'sum', failed(...tables))
  const metrics: Record<string, NumericData> = {
    totalDebtors: failed() ? unavailable() : observed(debtors.length),
    totalDebt: aggregateData(debtors.map(debtor => metric(debtor, 'totalDebt')), 'sum', failed('debt', 'debtor_profile')),
    overdueCases: count('overdueDebt', debtor => debtor.overdueDebt !== null && debtor.overdueDebt > 0, 'debt', 'debt_status', 'debtor_profile'),
    withContactCases: count('contactCount', debtor => debtor.hasContact === true, 'debtor_contact', 'debtor_person'),
    withoutContactCases: count('contactCount', debtor => debtor.hasContact === false, 'debtor_contact', 'debtor_person'),
    priorityCases: count('priorityScore', debtor => debtor.priorityLevel === 'ALTA', 'debt', 'debt_status', 'debtor_profile', 'debtor_contact', 'debtor_person'),
    urgentRecommendationCases: count('priorityScore', debtor => debtor.isUrgentRecommendation, 'debt', 'debt_status', 'debtor_profile', 'debtor_contact', 'debtor_person'),
    criticalCasesToday: count('priorityScore', debtor => criticalDebtors.includes(debtor), 'debt', 'debt_status', 'debtor_profile', 'debtor_contact', 'debtor_person'),
    riskAboveNinetyCases: count('riskScore', debtor => debtor.riskScore !== null && debtor.riskScore > 90, 'debtor_profile'),
    criticalDebtTotal: aggregateData(debtors.map(debtor => debtor.riskScore === null ? metric(debtor, 'riskScore') : debtor.riskScore > 90 ? metric(debtor, 'totalDebt') : observed(0)), 'sum', failed('debt', 'debtor_profile')),
  }

  return {
    metrics,
    totalDebtors: metrics.totalDebtors.value,
    totalDebt: metrics.totalDebt.value,
    overdueCases: metrics.overdueCases.value,
    withContactCases: metrics.withContactCases.value,
    withoutContactCases: metrics.withoutContactCases.value,
    priorityCases: metrics.priorityCases.value,
    urgentRecommendationCases: metrics.urgentRecommendationCases.value,
    criticalCasesToday: metrics.criticalCasesToday.value,
    riskAboveNinetyCases: metrics.riskAboveNinetyCases.value,
    criticalDebtTotal: metrics.criticalDebtTotal.value,
    byDebtStatus: failed('debt', 'debt_status') ? [] : Array.from(debtStatusBuckets.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value),
    byDebtorType: failed('debtor_type') ? [] : Array.from(byDebtorTypeMap.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value),
    byRisk: failed('debtor_profile') ? [] : Array.from(byRiskMap.entries())
      .filter(([label]) => label === 'No disponible' || !debtors.length || debtors.some(debtor => debtor.risk !== null))
      .map(([label, value]) => ({ label, value })),
    byRecommendation: metrics.priorityCases.value === null ? [] : Array.from(byRecommendationMap.entries()).map(([label, value]) => ({
      label,
      value,
    })),
    topDebtChart: buildTopDebtChart(debtors),
    topDebtors: topDebtDebtors.map((item) => ({
      id: item.id,
      identifier: item.identifier,
      type: item.type,
      totalDebt: item.totalDebt,
      risk: item.risk,
      riskScore: item.riskScore,
    })),
    topPriorityDebtors: topPriorityDebtors.filter(debtor => debtor.priorityScore !== null),
    withoutContactDebtors,
    topDebtDebtors,
  }
}
