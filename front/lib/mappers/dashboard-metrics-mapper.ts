import type { DashboardData, DebtorListItem } from '@/types/equitas-domain'

type DashboardMapperInput = {
  debtors: DebtorListItem[]
  debtStatusBuckets: Map<string, number>
}

function buildTopDebtChart(debtors: DebtorListItem[]) {
  return [...debtors]
    .sort((a, b) => b.totalDebt - a.totalDebt)
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
    byRiskMap.set(debtor.risk, (byRiskMap.get(debtor.risk) ?? 0) + 1)
    byRecommendationMap.set(
      debtor.recommendationType,
      (byRecommendationMap.get(debtor.recommendationType) ?? 0) + 1
    )
  }

  const sortedByPriority = [...debtors].sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) {
      return b.priorityScore - a.priorityScore
    }

    if (b.totalDebt !== a.totalDebt) {
      return b.totalDebt - a.totalDebt
    }

    return b.maxDaysOverdue - a.maxDaysOverdue
  })

  const sortedByDebt = [...debtors].sort((a, b) => b.totalDebt - a.totalDebt)

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
    .filter((item) => !item.hasContact)
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
      debtor.riskScore > 90 ||
      debtor.isUrgentRecommendation ||
      (debtor.overdueDebt > 0 && !debtor.hasContact)
  )
  const riskAboveNinetyCases = debtors.filter((debtor) => debtor.riskScore > 90).length
  const criticalDebtTotal = debtors
    .filter((debtor) => debtor.riskScore > 90)
    .reduce((acc, debtor) => acc + debtor.totalDebt, 0)

  return {
    totalDebtors: debtors.length,
    totalDebt: debtors.reduce((acc, debtor) => acc + debtor.totalDebt, 0),
    overdueCases: debtors.filter((debtor) => debtor.overdueDebt > 0).length,
    withContactCases: debtors.filter((debtor) => debtor.hasContact).length,
    withoutContactCases: debtors.filter((debtor) => !debtor.hasContact).length,
    priorityCases: debtors.filter((debtor) => debtor.priorityLevel === 'ALTA').length,
    urgentRecommendationCases: debtors.filter((debtor) => debtor.isUrgentRecommendation).length,
    criticalCasesToday: criticalDebtors.length,
    riskAboveNinetyCases,
    criticalDebtTotal,
    byDebtStatus: Array.from(debtStatusBuckets.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value),
    byDebtorType: Array.from(byDebtorTypeMap.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value),
    byRisk: Array.from(byRiskMap.entries()).map(([label, value]) => ({ label, value })),
    byRecommendation: Array.from(byRecommendationMap.entries()).map(([label, value]) => ({
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
    topPriorityDebtors,
    withoutContactDebtors,
    topDebtDebtors,
  }
}
