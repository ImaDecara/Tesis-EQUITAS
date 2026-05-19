export type {
  ChartBucket,
  DashboardData,
  DataWarning,
  DebtorDebtItem,
  DebtorDetailData,
  DebtorListItem,
  DebtorPersonItem,
  DebtorProfileSummary,
  RawDebtorDataBundle,
  RawRow,
  RiskLevel,
} from '@/types/equitas-domain'

// Fachada de compatibilidad: mantiene estables las importaciones viejas durante la refactorizacion.
export { getDashboardDataFromService as getDashboardData } from '@/lib/services/dashboard-data-service'
export {
  getDebtorDetailDataFromService as getDebtorDetailData,
  getDebtorsDataFromService as getDebtorsData,
} from '@/lib/services/debtor-data-service'
