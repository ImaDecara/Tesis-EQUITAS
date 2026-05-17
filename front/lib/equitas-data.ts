import { hasSupabaseCredentials, supabase } from '@/lib/supabase'

type RawRow = Record<string, unknown>

type RiskLevel = 'ALTO' | 'MEDIO' | 'BAJO'

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

type DebtorPersonRelation = {
  personId: string
  priority: string
}

type BaseData = {
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

const TABLE_LIMIT = 3000

const REQUIRED_TABLES = [
  'debtor',
  'debtor_type',
  'debt',
  'debt_status',
  'debtor_person',
  'person',
  'debtor_contact',
  'debtor_profile',
] as const

// Si alguna de estas tablas falla por RLS (42501 / permission denied),
// se necesita una policy SELECT para el rol que consume este frontend.

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function findMatchingKey(row: RawRow, candidates: string[]) {
  for (const candidate of candidates) {
    if (candidate in row) {
      return candidate
    }
  }

  const candidateSet = new Set(candidates.map((candidate) => normalizeKey(candidate)))

  for (const key of Object.keys(row)) {
    if (candidateSet.has(normalizeKey(key))) {
      return key
    }
  }

  return null
}

function pickValue(row: RawRow, candidates: string[]) {
  const key = findMatchingKey(row, candidates)

  if (!key) {
    return undefined
  }

  return row[key]
}

function toText(value: unknown) {
  if (value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'string') {
    return value.trim()
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return ''
}

function pickText(row: RawRow, candidates: string[]) {
  return toText(pickValue(row, candidates))
}

function toNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const normalized = value.replace(',', '.').replace(/[^0-9.-]/g, '')
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

function pickNumber(row: RawRow, candidates: string[]) {
  return toNumber(pickValue(row, candidates))
}

function readBoolean(value: unknown) {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    return value > 0
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return ['true', 't', '1', 'yes', 'y', 'si', 'activo'].includes(normalized)
  }

  return false
}

function readDate(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function resolveDebtStatusFromDate(dueDate: string | null) {
  const parsed = readDate(dueDate)

  if (!parsed) {
    return 'Sin estado'
  }

  return parsed < new Date() ? 'Vencida' : 'Vigente'
}

function toWarning(table: string, error: { message: string; code?: string | null }): DataWarning {
  const message = error.message || 'Error desconocido al leer datos'
  const loweredMessage = message.toLowerCase()
  const code = error.code ?? undefined
  const needsSelectPolicy =
    code === '42501' ||
    loweredMessage.includes('permission denied') ||
    loweredMessage.includes('row-level security') ||
    loweredMessage.includes('rls')

  return {
    table,
    message,
    code,
    needsSelectPolicy,
  }
}

async function loadTable(table: (typeof REQUIRED_TABLES)[number]) {
  if (!supabase || !hasSupabaseCredentials) {
    return {
      rows: [] as RawRow[],
      warning: {
        table,
        message:
          'Credenciales de Supabase no configuradas (NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).',
        needsSelectPolicy: false,
      } satisfies DataWarning,
    }
  }

  const response = await supabase.from(table).select('*').limit(TABLE_LIMIT)

  if (response.error) {
    return {
      rows: [] as RawRow[],
      warning: toWarning(table, response.error),
    }
  }

  return {
    rows: (response.data ?? []) as RawRow[],
    warning: null,
  }
}

async function loadBaseData(): Promise<BaseData> {
  const results = await Promise.all(REQUIRED_TABLES.map((table) => loadTable(table)))
  const warnings = results
    .map((result) => result.warning)
    .filter((warning): warning is DataWarning => Boolean(warning))

  return {
    debtors: results[0]?.rows ?? [],
    debtorTypes: results[1]?.rows ?? [],
    debts: results[2]?.rows ?? [],
    debtStatuses: results[3]?.rows ?? [],
    debtorPeople: results[4]?.rows ?? [],
    people: results[5]?.rows ?? [],
    debtorContacts: results[6]?.rows ?? [],
    debtorProfiles: results[7]?.rows ?? [],
    warnings,
  }
}

function resolveRiskLevel(
  providedRisk: string,
  totalDebt: number,
  overdueDebt: number,
  hasContact: boolean
): RiskLevel {
  const normalized = providedRisk.trim().toLowerCase()

  if (normalized.includes('alto') || normalized === 'high') {
    return 'ALTO'
  }

  if (normalized.includes('medio') || normalized === 'medium') {
    return 'MEDIO'
  }

  if (normalized.includes('bajo') || normalized === 'low') {
    return 'BAJO'
  }

  if (overdueDebt > 0 && totalDebt >= 800000) {
    return 'ALTO'
  }

  if (overdueDebt > 0 || totalDebt >= 350000 || !hasContact) {
    return 'MEDIO'
  }

  return 'BAJO'
}

function resolveRecommendation(
  risk: RiskLevel,
  hasContact: boolean,
  overdueDebt: number
) {
  if (risk === 'ALTO' && hasContact) {
    return 'Contacto inmediato multicanal + propuesta de regularizacion'
  }

  if (risk === 'ALTO') {
    return 'Busqueda de contacto prioritaria y derivacion a gestion intensiva'
  }

  if (risk === 'MEDIO' && overdueDebt > 0) {
    return 'Recordatorio de deuda vencida y plan de pago asistido'
  }

  if (!hasContact) {
    return 'Completar datos de contacto y enviar notificacion preventiva'
  }

  return 'Seguimiento preventivo con campaña de cumplimiento'
}

function hasActiveFlag(row: RawRow, candidates: string[]) {
  return Boolean(findMatchingKey(row, candidates))
}

function normalizeStatusLabel(value: string) {
  const trimmed = value.trim()

  if (!trimmed) {
    return ''
  }

  const normalized = trimmed.toLowerCase()

  if (['true', 't', '1'].includes(normalized)) {
    return 'Activo'
  }

  if (['false', 'f', '0'].includes(normalized)) {
    return 'Inactivo'
  }

  if (/^[0-9]+$/.test(trimmed)) {
    return ''
  }

  return trimmed
}

function mapLabelById(rows: RawRow[], idCandidates: string[], labelCandidates: string[]) {
  const result = new Map<string, string>()

  for (const row of rows) {
    const id = toText(pickValue(row, idCandidates))

    if (!id) {
      continue
    }

    const label =
      pickText(row, labelCandidates) ||
      pickText(row, ['name', 'description', 'status', 'code']) ||
      id

    result.set(id, label)
  }

  return result
}

function daysFromDate(value: string | null) {
  const parsed = readDate(value)

  if (!parsed) {
    return 0
  }

  const diffMs = Date.now() - parsed.getTime()
  return Math.max(Math.floor(diffMs / (1000 * 60 * 60 * 24)), 0)
}

function buildFromBaseData(base: BaseData) {
  const debtorTypeLabels = mapLabelById(
    base.debtorTypes,
    ['id', 'debtor_type_id', 'type_id'],
    ['value', 'name', 'description', 'label', 'code']
  )
  const debtStatusLabels = mapLabelById(
    base.debtStatuses,
    ['id', 'debt_status_id', 'status_id'],
    ['value', 'name', 'description', 'label', 'status']
  )

  const peopleById = new Map<string, RawRow>()
  for (const person of base.people) {
    const personId = toText(pickValue(person, ['id', 'person_id']))

    if (personId) {
      peopleById.set(personId, person)
    }
  }

  const debtsByDebtor = new Map<string, DebtorDebtItem[]>()

  for (const debt of base.debts) {
    const debtorId = toText(
      pickValue(debt, ['debtor_id', 'id_debtor', 'debtorid', 'debtor'])
    )

    if (!debtorId) {
      continue
    }

    const originalAmount = pickNumber(debt, [
      'original_amount',
      'amount_original',
      'capital_amount',
      'amount',
      'monto_original',
    ])

    const updatedAmount =
      pickNumber(debt, [
        'updated_amount',
        'amount_updated',
        'total_amount',
        'amount_due',
        'monto_actualizado',
      ]) || originalAmount

    const dueDate =
      pickText(debt, ['due_date', 'expiration_date', 'vencimiento', 'maturity_date']) ||
      null

    const debtStatusId = toText(
      pickValue(debt, ['debt_status_id', 'status_id', 'debt_status'])
    )

    const status =
      debtStatusLabels.get(debtStatusId) ||
      pickText(debt, ['status', 'state']) ||
      resolveDebtStatusFromDate(dueDate)

    const debtItem: DebtorDebtItem = {
      id:
        toText(pickValue(debt, ['id', 'debt_id'])) ||
        `${debtorId}-${(debtsByDebtor.get(debtorId)?.length ?? 0) + 1}`,
      originalAmount,
      updatedAmount,
      dueDate,
      period:
        pickText(debt, ['period', 'fiscal_period', 'billing_period', 'year_month']) ||
        'Sin periodo',
      status,
    }

    const current = debtsByDebtor.get(debtorId) ?? []
    current.push(debtItem)
    debtsByDebtor.set(debtorId, current)
  }

  const personRelationsByDebtor = new Map<string, DebtorPersonRelation[]>()

  for (const relation of base.debtorPeople) {
    const debtorId = toText(
      pickValue(relation, ['debtor_id', 'id_debtor', 'debtorid', 'debtor'])
    )
    const personId = toText(pickValue(relation, ['person_id', 'id_person', 'person']))

    if (!debtorId || !personId) {
      continue
    }

    const relationHasActive = hasActiveFlag(relation, [
      'active',
      'is_active',
      'enabled',
      'valid',
    ])
    const relationIsActive = relationHasActive
      ? readBoolean(pickValue(relation, ['active', 'is_active', 'enabled', 'valid']))
      : true

    if (!relationIsActive) {
      continue
    }

    const current = personRelationsByDebtor.get(debtorId) ?? []
    current.push({
      personId,
      priority: pickText(relation, ['priority', 'priority_level', 'order']) || 'Media',
    })
    personRelationsByDebtor.set(debtorId, current)
  }

  const contactValuesByPerson = new Map<string, string[]>()

  for (const contact of base.debtorContacts) {
    const personId = toText(pickValue(contact, ['person', 'person_id', 'id_person']))

    if (!personId) {
      continue
    }

    const rawValue = pickText(contact, [
      'value',
      'contact_value',
      'contact',
      'phone',
      'email',
      'phone_number',
      'mobile',
      'whatsapp',
    ]).trim()

    if (!rawValue) {
      continue
    }

    const contactHasActive = hasActiveFlag(contact, [
      'active',
      'is_active',
      'is_available',
      'available',
      'valid',
    ])
    const contactIsActive = contactHasActive
      ? readBoolean(
          pickValue(contact, ['active', 'is_active', 'is_available', 'available', 'valid'])
        )
      : true

    if (!contactIsActive) {
      continue
    }

    const current = contactValuesByPerson.get(personId) ?? []
    if (!current.includes(rawValue)) {
      current.push(rawValue)
      contactValuesByPerson.set(personId, current)
    }
  }

  const peopleByDebtor = new Map<string, DebtorPersonItem[]>()
  const contactCountByDebtor = new Map<string, number>()

  for (const [debtorId, relations] of personRelationsByDebtor.entries()) {
    const currentPeople: DebtorPersonItem[] = []
    const personsWithContact = new Set<string>()

    for (const relation of relations) {
      const personRow = peopleById.get(relation.personId)
      const firstName = personRow ? pickText(personRow, ['first_name', 'name']) : ''
      const lastName = personRow ? pickText(personRow, ['last_name', 'surname']) : ''
      const fullName =
        (personRow && pickText(personRow, ['full_name', 'display_name'])) ||
        `${firstName} ${lastName}`.trim() ||
        `Persona ${relation.personId}`
      const document =
        (personRow &&
          pickText(personRow, ['document_number', 'document', 'dni', 'tax_id'])) ||
        'Sin documento'
      const contactValues = contactValuesByPerson.get(relation.personId) ?? []
      const contact = contactValues.length > 0 ? contactValues.join(' | ') : 'Sin contacto'

      if (contactValues.length > 0) {
        personsWithContact.add(relation.personId)
      }

      currentPeople.push({
        id: relation.personId,
        name: fullName,
        document,
        priority: relation.priority,
        contact,
      })
    }

    peopleByDebtor.set(debtorId, currentPeople)
    contactCountByDebtor.set(debtorId, personsWithContact.size)
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log('[EQUITAS contact debug]', {
      debtorPersonRows: base.debtorPeople.length,
      debtorContactRows: base.debtorContacts.length,
      mappedDebtorsWithContacts: contactCountByDebtor.size,
    })
  }

  const profileByDebtor = new Map<string, RawRow>()

  for (const profile of base.debtorProfiles) {
    const debtorId = toText(
      pickValue(profile, ['debtor_id', 'id_debtor', 'debtorid', 'debtor'])
    )

    if (debtorId) {
      profileByDebtor.set(debtorId, profile)
    }
  }

  const debtStatusBuckets = new Map<string, number>()

  for (const debtEntries of debtsByDebtor.values()) {
    for (const debt of debtEntries) {
      debtStatusBuckets.set(debt.status, (debtStatusBuckets.get(debt.status) ?? 0) + 1)
    }
  }

  const debtors: DebtorListItem[] = []

  for (const debtorRow of base.debtors) {
    const id = toText(pickValue(debtorRow, ['id', 'debtor_id', 'debtorid']))

    if (!id) {
      continue
    }

    const debts = debtsByDebtor.get(id) ?? []
    const people = peopleByDebtor.get(id) ?? []
    const profile = profileByDebtor.get(id)
    const profileContactCount = pickNumber(profile ?? {}, [
      'available_contact_count',
      'available_contacts_count',
      'contact_available_count',
    ])
    const relationContactCount = contactCountByDebtor.get(id) ?? 0
    const contactCount = Math.max(profileContactCount, relationContactCount)
    const hasContact =
      profileContactCount > 0 ||
      relationContactCount > 0 ||
      people.some((person) => person.contact !== 'Sin contacto')
    const totalDebt =
      pickNumber(profile ?? {}, [
        'total_debt_amount',
        'total_debt',
        'debt_total',
        'amount_total',
      ]) ||
      debts.reduce((acc, debt) => acc + debt.updatedAmount, 0)
    const overdueDebt =
      pickNumber(profile ?? {}, [
        'overdue_debt_amount',
        'overdue_debt',
        'debt_overdue',
      ]) ||
      debts
        .filter((debt) => resolveDebtStatusFromDate(debt.dueDate) === 'Vencida')
        .reduce((acc, debt) => acc + debt.updatedAmount, 0)

    const risk = resolveRiskLevel(
      pickText(profile ?? {}, [
        'risk_level',
        'risk',
        'risk_segment',
        'socioeconomic_risk_level',
      ]),
      totalDebt,
      overdueDebt,
      hasContact
    )

    const debtorTypeId = toText(
      pickValue(debtorRow, ['debtor_type_id', 'type_id', 'type'])
    )
    const type =
      debtorTypeLabels.get(debtorTypeId) ||
      pickText(debtorRow, ['value']) ||
      pickText(debtorRow, ['debtor_type', 'type_name']) ||
      'Sin tipo'

    const identifier =
      pickText(debtorRow, [
        'identifier',
        'code',
        'account_number',
        'domain',
        'external_id',
        'name',
      ]) || `OBJ-${id}`

    const description =
      pickText(debtorRow, ['description', 'title', 'detail']) ||
      `Objeto de deuda ${identifier}`

    const statusByDebts = debts
      .map((debt) => normalizeStatusLabel(debt.status))
      .filter(Boolean)
      .at(0)
    const statusById = debtStatusLabels.get(pickText(debtorRow, ['status', 'state']))
    const statusFromDebtor = normalizeStatusLabel(
      pickText(debtorRow, ['status_text', 'status', 'state'])
    )
    const status =
      statusByDebts ||
      statusById ||
      statusFromDebtor ||
      (overdueDebt > 0 ? 'Vencido' : 'En gestión')

    debtors.push({
      id,
      identifier,
      type,
      description,
      status,
      totalDebt,
      overdueDebt,
      peopleCount: people.length,
      peopleNames: people.map((person) => person.name),
      hasContact,
      contactCount,
      risk,
      recommendation: resolveRecommendation(risk, hasContact, overdueDebt),
    })
  }

  const byDebtorTypeMap = new Map<string, number>()
  const byRiskMap = new Map<string, number>()

  for (const debtor of debtors) {
    byDebtorTypeMap.set(debtor.type, (byDebtorTypeMap.get(debtor.type) ?? 0) + 1)
    byRiskMap.set(debtor.risk, (byRiskMap.get(debtor.risk) ?? 0) + 1)
  }

  const dashboard: DashboardData = {
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
    topDebtors: [...debtors]
      .sort((a, b) => b.totalDebt - a.totalDebt)
      .slice(0, 5)
      .map((item) => ({
        id: item.id,
        identifier: item.identifier,
        type: item.type,
        totalDebt: item.totalDebt,
        risk: item.risk,
      })),
  }

  return {
    debtors,
    dashboard,
    warnings: base.warnings,
    getDetail(debtorId: string): DebtorDetailData | null {
      const debtor = debtors.find((item) => item.id === debtorId)

      if (!debtor) {
        return null
      }

      const debts = debtsByDebtor.get(debtorId) ?? []
      const people = peopleByDebtor.get(debtorId) ?? []
      const oldestDebt = debts
        .map((debt) => debt.dueDate)
        .filter((dueDate): dueDate is string => Boolean(dueDate))
        .sort()[0] ?? null

      return {
        debtor,
        people,
        debts,
        profile: {
          totalDebt: debtor.totalDebt,
          overdueDebt: debtor.overdueDebt,
          antiquityDays: daysFromDate(oldestDebt),
          associatedPeople: debtor.peopleCount,
          availableContacts: debtor.contactCount,
          risk: debtor.risk,
        },
      }
    },
  }
}

export async function getDashboardData() {
  const base = await loadBaseData()
  const composed = buildFromBaseData(base)

  return {
    dashboard: composed.dashboard,
    warnings: composed.warnings,
  }
}

export async function getDebtorsData() {
  const base = await loadBaseData()
  const composed = buildFromBaseData(base)

  return {
    debtors: composed.debtors,
    warnings: composed.warnings,
  }
}

export async function getDebtorDetailData(debtorId: string) {
  const base = await loadBaseData()
  const composed = buildFromBaseData(base)
  const detail = composed.getDetail(debtorId)

  return {
    detail,
    warnings: composed.warnings,
  }
}
