import { filterPortfolio, type PortfolioFilters } from '@/lib/portfolio-filters'
import { portfolioContext } from '@/lib/analytics'
import { loadRawDebtorData } from '@/lib/data/raw-debtor-loader'
import { mapDashboardMetricsFromDebtorObjects } from '@/lib/mappers/dashboard-metrics-mapper'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { getPeopleDashboardDataFromService } from '@/lib/services/person-data-service'

// Caso de uso del tablero: carga crudo, mapea dominio y devuelve metricas.
export async function getDashboardDataFromService(filters: PortfolioFilters = {}) {
  const rawData = await loadRawDebtorData()
  const mapped = mapDebtorObjectsFromRawData(rawData)
  const selection = filterPortfolio(mapped.debtors, filters, mapped.warnings)
  const debtStatusBuckets = new Map<string, number>()
  for (const item of selection.items) for (const debt of mapped.debtsByDebtor.get(item.id) ?? []) {
    debtStatusBuckets.set(debt.status, (debtStatusBuckets.get(debt.status) ?? 0) + 1)
  }
  const dashboard = mapDashboardMetricsFromDebtorObjects({
    debtors: selection.items,
    debtStatusBuckets,
    warnings: selection.warnings,
  })
  dashboard.context = portfolioContext(mapped.debtors, mapped.warnings)
  const { peopleDashboard, warnings: peopleWarnings } =
    await getPeopleDashboardDataFromService()
  const warningMap = new Map<string, (typeof mapped.warnings)[number]>()

  for (const warning of [...selection.warnings, ...peopleWarnings]) {
    warningMap.set(`${warning.table}::${warning.message}`, warning)
  }

  return {
    dashboard,
    peopleDashboard,
    warnings: Array.from(warningMap.values()),
  }
}
