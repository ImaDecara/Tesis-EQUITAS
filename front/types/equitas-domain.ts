export type RawRow = Record<string, unknown>

export type RiskLevel = 'ALTO' | 'MEDIO' | 'BAJO'
export type DebtorPriorityLevel = 'ALTA' | 'MEDIA' | 'BAJA'

export type RecommendationKind =
  | 'Llamado prioritario'
  | 'Mensaje recordatorio'
  | 'Plan de pago / revision humana'
  | 'Seguimiento posterior'

export type PersonIndividualRiskLevel = 'ALTO' | 'MEDIO' | 'BAJO'

export type DataWarning = {
  table: string
  message: string
  code?: string
  needsSelectPolicy: boolean
}

export type ChartBucket = {
  label: string
  value: number
}

export type DashboardData = {
  totalDebtors: number
  totalDebt: number
  overdueCases: number
  withContactCases: number
  withoutContactCases: number
  priorityCases: number
  urgentRecommendationCases: number
  byDebtStatus: ChartBucket[]
  byDebtorType: ChartBucket[]
  byRisk: ChartBucket[]
  byRecommendation: ChartBucket[]
  topDebtChart: ChartBucket[]
  topDebtors: Array<{
    id: string
    identifier: string
    type: string
    totalDebt: number
    risk: RiskLevel
  }>
  topPriorityDebtors: Array<{
    id: string
    identifier: string
    type: string
    totalDebt: number
    overdueDays: number
    risk: RiskLevel
    hasContact: boolean
    recommendationType: RecommendationKind
    priorityScore: number
    priorityLevel: DebtorPriorityLevel
  }>
  withoutContactDebtors: Array<{
    id: string
    identifier: string
    type: string
    totalDebt: number
    overdueDays: number
    risk: RiskLevel
  }>
  topDebtDebtors: Array<{
    id: string
    identifier: string
    type: string
    totalDebt: number
    overdueDays: number
    risk: RiskLevel
    recommendationType: RecommendationKind
  }>
}

export type DebtorListItem = {
  id: string
  identifier: string
  type: string
  description: string
  status: string
  totalDebt: number
  overdueDebt: number
  peopleCount: number
  peopleIds: string[]
  peopleNames: string[]
  hasContact: boolean
  contactCount: number
  risk: RiskLevel
  debtCount: number
  overdueDebtsCount: number
  maxDaysOverdue: number
  priorityScore: number
  priorityLevel: DebtorPriorityLevel
  recommendation: string
  recommendationType: RecommendationKind
  recommendationReason: string
  isUrgentRecommendation: boolean
}

export type DebtorPersonItem = {
  id: string
  name: string
  document: string
  priority: string
  contact: string
  relation: string
}

export type DebtorContactItem = {
  id: string
  personId: string
  personName: string
  channel: string
  value: string
  isActive: boolean
}

export type DebtorDebtItem = {
  id: string
  originalAmount: number
  updatedAmount: number
  dueDate: string | null
  period: string
  status: string
}

export type DebtorProfileSummary = {
  totalDebt: number
  overdueDebt: number
  debtCount: number
  antiquityDays: number
  associatedPeople: number
  availableContacts: number
  risk: RiskLevel
  socioeconomicLevel: string
}

export type DebtorDetailData = {
  debtor: DebtorListItem
  people: DebtorPersonItem[]
  contacts: DebtorContactItem[]
  debts: DebtorDebtItem[]
  profile: DebtorProfileSummary
}

export type PersonListItem = {
  id: string
  name: string
  document: string
  individualRisk: PersonIndividualRiskLevel
  riskValue: number
  debtorsCount: number
  hasContact: boolean
  totalDebtAssociated: number
  debtorIds: string[]
  debtorIdentifiers: string[]
}

export type PeopleDashboardSummary = {
  totalPeople: number
  lowRiskCount: number
  mediumRiskCount: number
  highRiskCount: number
  withoutContactCount: number
  individualRiskDistribution: ChartBucket[]
  topPeopleByRiskValue: Array<{
    id: string
    name: string
    document: string
    riskValue: number
    individualRisk: PersonIndividualRiskLevel
    debtorsCount: number
    hasContact: boolean
  }>
}

export type DebtorPersonRelation = {
  personId: string
  priority: string
  relation: string
}

export type RawDebtorDataBundle = {
  debtors: RawRow[]
  debtorTypes: RawRow[]
  debts: RawRow[]
  debtStatuses: RawRow[]
  debtorPeople: RawRow[]
  people: RawRow[]
  debtorContacts: RawRow[]
  debtorProfiles: RawRow[]
  warnings: DataWarning[]
}

export type RawPersonDataBundle = {
  people: RawRow[]
  debtorProfilesDetail: RawRow[]
  debtorPeople: RawRow[]
  debtorContacts: RawRow[]
  debts: RawRow[]
  debtors: RawRow[]
  warnings: DataWarning[]
}

export type MappedDebtorObjects = {
  debtors: DebtorListItem[]
  debtsByDebtor: Map<string, DebtorDebtItem[]>
  peopleByDebtor: Map<string, DebtorPersonItem[]>
  contactsByDebtor: Map<string, DebtorContactItem[]>
  debtStatusBuckets: Map<string, number>
  warnings: DataWarning[]
}
