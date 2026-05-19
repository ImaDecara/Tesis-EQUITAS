import type { DashboardData, DebtorListItem, RiskLevel } from '@/types/equitas-domain'

type DashboardMapperInput = {
  debtors: DebtorListItem[]
  debtStatusBuckets: Map<string, number>
}

// Arma KPIs y conjuntos de datos para graficos desde objetos de deuda ya mapeados.
export function mapDashboardMetricsFromDebtorObjects({
  debtors,
  debtStatusBuckets,
}: DashboardMapperInput): DashboardData {
  const byDebtorTypeMap = new Map<string, number>()
  const byRiskMap = new Map<string, number>()

  for (const debtor of debtors) {
    byDebtorTypeMap.set(debtor.type, (byDebtorTypeMap.get(debtor.type) ?? 0) + 1)
    byRiskMap.set(debtor.risk, (byRiskMap.get(debtor.risk) ?? 0) + 1)
  }

  return {
    totalDebtors: debtors.length,
    totalDebt: debtors.reduce((acc, debtor) => acc + debtor.totalDebt, 0),
    overdueCases: debtors.filter((debtor) => debtor.overdueDebt > 0).length,
    withContactCases: debtors.filter((debtor) => debtor.hasContact).length,
    priorityCases: debtors.filter((debtor) => debtor.risk === 'ALTO').length,
    byDebtStatus: Array.from(debtStatusBuckets.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value),
    byDebtorType: Array.from(byDebtorTypeMap.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value),
    byRisk: Array.from(byRiskMap.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value),
    // Tabla de prioridad operativa: primero la mayor deuda.
    topDebtors: [...debtors]
      .sort((a, b) => b.totalDebt - a.totalDebt)
      .slice(0, 5)
      .map((item) => ({
        id: item.id,
        identifier: item.identifier,
        type: item.type,
        totalDebt: item.totalDebt,
        risk: item.risk as RiskLevel,
      })),
  }
}
