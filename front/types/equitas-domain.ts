import type { Decision, DecisionInput, DecisionObligation, RuleDatum } from '@/lib/domain/decision-rules-v1'

export type RawRow = Record<string, unknown>

// Estados de presencia del contrato de dominio v1 (docs/tesis/contrato-dominio-v1.md §4).
// Un dato que no esta OBSERVADO se representa como null junto a su estado: nunca como 0.
export const DATA_PRESENCE_STATES = [
  'OBSERVADO',
  'NO_INFORMADO_EN_ORIGEN',
  'NO_INTEGRADO',
  'INVALIDO',
  'NO_APLICA',
] as const

export type DataPresence = (typeof DATA_PRESENCE_STATES)[number]

export type NumericData = {
  value: number | null
  presence: DataPresence
  missing: Partial<Record<DataPresence, number>>
  reason?: string
}

export type PresenceMetrics = { metrics?: Record<string, NumericData> }

export type RiskLevel = 'ALTO' | 'MEDIO' | 'BAJO'
export type DebtorPriorityLevel = 'ALTA' | 'MEDIA' | 'BAJA'

export type RecommendationKind =
  | 'Mejorar datos'
  | 'Revisión jurídica'
  | 'Contacto y plan'
  | 'Recordatorio'
  | 'Seguimiento'
  // Etiquetas de DTO anteriores; el adaptador v1 ya no las genera.
  | 'Llamado prioritario'
  | 'Mensaje recordatorio'
  | 'Plan de pago / revision humana'
  | 'Seguimiento posterior'
  | 'No disponible'

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

export type DashboardData = PresenceMetrics & {
  coverage?: Record<string, string>
  context?: string
  queuePreviews?: Array<{ code: string | null; label: RecommendationKind; count: number | null; cases: DebtorListItem[] }>
  totalDebtors: number | null
  totalDebt: number | null
  overdueCases: number | null
  withContactCases: number | null
  withoutContactCases: number | null
  priorityCases: number | null
  urgentRecommendationCases: number | null
  criticalCasesToday: number | null
  riskAboveNinetyCases: number | null
  criticalDebtTotal: number | null
  byDebtStatus: ChartBucket[]
  byDebtorType: ChartBucket[]
  byRisk: ChartBucket[]
  byRecommendation: ChartBucket[]
  topDebtChart: ChartBucket[]
  topDebtors: Array<{
    id: string
    identifier: string
    type: string
    totalDebt: number | null
    risk: RiskLevel | null
    riskScore: number | null
  }>
  topPriorityDebtors: Array<{
    id: string
    identifier: string
    type: string
    totalDebt: number | null
    overdueDays: number | null
    risk: RiskLevel | null
    riskScore: number | null
    hasContact: boolean | null
    recommendationType: RecommendationKind
    priorityScore: number | null
    priorityLevel: DebtorPriorityLevel | null
  }>
  withoutContactDebtors: Array<{
    id: string
    identifier: string
    type: string
    totalDebt: number | null
    overdueDays: number | null
    risk: RiskLevel | null
    riskScore: number | null
  }>
  topDebtDebtors: Array<{
    id: string
    identifier: string
    type: string
    totalDebt: number | null
    overdueDays: number | null
    risk: RiskLevel | null
    riskScore: number | null
    recommendationType: RecommendationKind
  }>
}

export type DebtorListItem = PresenceMetrics & {
  // Dimensiones v1. Opcionales únicamente para compatibilidad con consumidores
  // del DTO anterior; el mapper siempre las entrega, incluso si no pudo evaluar.
  decision?: Decision | null
  decisionInput?: DecisionInput | null
  decisionAsOf?: RuleDatum<string>
  decisionAsOfSource?: 'MANIFIESTO_LOTE' | 'FECHA_CALCULO'
  decisionComputedAt?: string
  rulesVersion?: string
  decisionIssues?: DecisionDataIssue[]
  computedAt?: string | null
  temporalProvenance?: string

  id: string
  identifier: string
  type: string
  description: string
  status: string
  totalDebt: number | null
  overdueDebt: number | null
  peopleCount: number | null
  peopleIds: string[]
  peopleNames: string[]
  hasContact: boolean | null
  contactCount: number | null
  /** @deprecated Alias de decision.severidad; no representa riesgo social. */
  risk: RiskLevel | null
  riskScore: number | null
  debtCount: number | null
  overdueDebtsCount: number | null
  maxDaysOverdue: number | null
  priorityScore: number | null
  priorityLevel: DebtorPriorityLevel | null
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

export type DebtorDebtItem = PresenceMetrics & {
  ruleInput?: DecisionObligation
  decisionIssues?: DecisionDataIssue[]
  id: string
  originalAmount: number | null
  updatedAmount: number | null
  dueDate: string | null
  period: string
  status: string
  statusPresence?: DataPresence
}

export type DebtorProfileSummary = PresenceMetrics & {
  totalDebt: number | null
  overdueDebt: number | null
  debtCount: number | null
  antiquityDays: number | null
  associatedPeople: number | null
  availableContacts: number | null
  risk: RiskLevel | null
  riskScore: number | null
  socioeconomicLevel: string
}

export type DebtorDetailData = {
  debtor: DebtorListItem
  people: DebtorPersonItem[]
  contacts: DebtorContactItem[]
  debts: DebtorDebtItem[]
  profile: DebtorProfileSummary
}

export type PersonListItem = PresenceMetrics & {
  debtExposure: Array<{ debtorId: string; amount: NumericData }>
  exposureLabel: 'Exposición asociada (no aditiva)'

  id: string
  name: string
  document: string
  individualRisk: PersonIndividualRiskLevel | null
  riskValue: number | null
  debtorsCount: number | null
  hasContact: boolean | null
  totalDebtAssociated: number | null
  debtorIds: string[]
  debtorIdentifiers: string[]
}

export type PeopleDashboardSummary = PresenceMetrics & {
  totalPeople: number | null
  lowRiskCount: number | null
  mediumRiskCount: number | null
  highRiskCount: number | null
  withoutContactCount: number | null
  individualRiskDistribution: ChartBucket[]
  topPeopleByRiskValue: Array<{
    id: string
    name: string
    document: string
    riskValue: number | null
    individualRisk: PersonIndividualRiskLevel | null
    debtorsCount: number | null
    hasContact: boolean | null
  }>
}

export type DebtorPersonRelation = {
  personId: string
  priority: string
  relation: string
}

export type RawDebtorDataBundle = {
  // Punto de integración del manifiesto. El lector actual no aporta este dato.
  batch?: { as_of: string | null; source_updated_at?: string | null }
  debtors: RawRow[]
  debtorTypes: RawRow[]
  debts: RawRow[]
  debtStatuses: RawRow[]
  debtorPeople: RawRow[]
  people: RawRow[]
  debtorContacts: RawRow[]
  debtorProfiles: RawRow[]
  // Solo lo aporta el detalle, único lugar donde se muestra el canal de un contacto.
  contactTypes?: RawRow[]
  warnings: DataWarning[]
}

export type DecisionDataIssue = {
  field: string
  entityId?: string
  presence: Exclude<DataPresence, 'OBSERVADO'>
  reason: string
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
