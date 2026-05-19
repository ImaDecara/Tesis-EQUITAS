export type RawRow = Record<string, unknown>

export type RiskLevel = 'ALTO' | 'MEDIO' | 'BAJO'

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
  priorityCases: number
  byDebtStatus: ChartBucket[]
  byDebtorType: ChartBucket[]
  byRisk: ChartBucket[]
  topDebtors: Array<{
    id: string
    identifier: string
    type: string
    totalDebt: number
    risk: RiskLevel
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
  peopleNames: string[]
  hasContact: boolean
  contactCount: number
  risk: RiskLevel
  recommendation: string
}

export type DebtorPersonItem = {
  id: string
  name: string
  document: string
  priority: string
  contact: string
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
  antiquityDays: number
  associatedPeople: number
  availableContacts: number
  risk: RiskLevel
}

export type DebtorDetailData = {
  debtor: DebtorListItem
  people: DebtorPersonItem[]
  debts: DebtorDebtItem[]
  profile: DebtorProfileSummary
}

export type DebtorPersonRelation = {
  personId: string
  priority: string
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

export type MappedDebtorObjects = {
  debtors: DebtorListItem[]
  debtsByDebtor: Map<string, DebtorDebtItem[]>
  peopleByDebtor: Map<string, DebtorPersonItem[]>
  debtStatusBuckets: Map<string, number>
  warnings: DataWarning[]
}
