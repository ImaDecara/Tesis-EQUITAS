export type {
  ChartBucket,
  DashboardData,
  DataWarning,
  DebtorContactItem,
  DebtorDebtItem,
  DebtorDetailData,
  DebtorListItem,
  DebtorPersonItem,
  DebtorPriorityLevel,
  PeopleDashboardSummary,
  PersonIndividualRiskLevel,
  PersonListItem,
  RecommendationKind,
  DebtorProfileSummary,
  RawDebtorDataBundle,
  RawPersonDataBundle,
  RawRow,
  RiskLevel,
} from '@/types/equitas-domain'

// Fachada de compatibilidad: mantiene estables las importaciones viejas durante la refactorizacion.
export { getDashboardDataFromService as getDashboardData } from '@/lib/services/dashboard-data-service'
export {
  getDebtorDetailDataFromService as getDebtorDetailData,
  getDebtorsDataFromService as getDebtorsData,
} from '@/lib/services/debtor-data-service'
export { getPeopleDataFromService as getPeopleData } from '@/lib/services/person-data-service'
