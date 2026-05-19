import { loadRawDebtorData } from '@/lib/data/raw-debtor-loader'
import { mapDashboardMetricsFromDebtorObjects } from '@/lib/mappers/dashboard-metrics-mapper'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'

// Caso de uso del tablero: carga crudo, mapea dominio y devuelve metricas.
export async function getDashboardDataFromService() {
  const rawData = await loadRawDebtorData()
  const mapped = mapDebtorObjectsFromRawData(rawData)
  const dashboard = mapDashboardMetricsFromDebtorObjects({
    debtors: mapped.debtors,
    debtStatusBuckets: mapped.debtStatusBuckets,
  })

  return {
    dashboard,
    warnings: mapped.warnings,
  }
}
