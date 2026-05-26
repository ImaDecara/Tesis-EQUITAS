import { loadRawDebtorData } from '@/lib/data/raw-debtor-loader'
import { mapDashboardMetricsFromDebtorObjects } from '@/lib/mappers/dashboard-metrics-mapper'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { getPeopleDashboardDataFromService } from '@/lib/services/person-data-service'

// Caso de uso del tablero: carga crudo, mapea dominio y devuelve metricas.
export async function getDashboardDataFromService() {
  const rawData = await loadRawDebtorData()
  const mapped = mapDebtorObjectsFromRawData(rawData)
  const dashboard = mapDashboardMetricsFromDebtorObjects({
    debtors: mapped.debtors,
    debtStatusBuckets: mapped.debtStatusBuckets,
  })
  const { peopleDashboard, warnings: peopleWarnings } =
    await getPeopleDashboardDataFromService()
  const warningMap = new Map<string, (typeof mapped.warnings)[number]>()

  for (const warning of [...mapped.warnings, ...peopleWarnings]) {
    warningMap.set(`${warning.table}::${warning.message}`, warning)
  }

  return {
    dashboard,
    peopleDashboard,
    warnings: Array.from(warningMap.values()),
  }
}
