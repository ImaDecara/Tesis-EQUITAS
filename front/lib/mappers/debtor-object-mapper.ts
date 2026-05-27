import {
  calculateDaysSinceDate,
  resolveDebtStatusFromDueDate,
} from '@/lib/parsers/date-value-parser'
import {
  parseBooleanFromUnknown,
  rowHasCandidateKey,
  selectTextFromRow,
  selectValueFromRow,
  stringifyUnknownValue,
} from '@/lib/parsers/generic-value-selector'
import { selectNumericValueFromRow } from '@/lib/parsers/numeric-value-parser'
import { generateDebtorRecommendation } from '@/lib/services/debtor-recommendation-generator'
import { calculateDebtorRiskAssessment } from '@/lib/services/debtor-risk-calculator'
import type {
  DebtorContactItem,
  DebtorDebtItem,
  DebtorListItem,
  DebtorPersonItem,
  DebtorPersonRelation,
  DebtorPriorityLevel,
  MappedDebtorObjects,
  RawDebtorDataBundle,
  RawRow,
  RiskLevel,
} from '@/types/equitas-domain'

function mapLabelById(rows: RawRow[], idCandidates: string[], labelCandidates: string[]) {
  const result = new Map<string, string>()

  for (const row of rows) {
    const id = stringifyUnknownValue(selectValueFromRow(row, idCandidates))

    if (!id) {
      continue
    }

    const label =
      selectTextFromRow(row, labelCandidates) ||
      selectTextFromRow(row, ['name', 'description', 'status', 'code']) ||
      id

    result.set(id, label)
  }

  return result
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

function isDebtOverdue(debt: DebtorDebtItem) {
  const normalizedStatus = debt.status.trim().toLowerCase()

  if (
    normalizedStatus.includes('venc') ||
    normalizedStatus.includes('mora') ||
    normalizedStatus.includes('atras')
  ) {
    return true
  }

  return resolveDebtStatusFromDueDate(debt.dueDate) === 'Vencida'
}

function inferContactChannel(contact: RawRow, value: string) {
  const explicitChannel = selectTextFromRow(contact, [
    'channel',
    'contact_channel',
    'kind',
    'type',
    'contact_type',
  ])

  if (explicitChannel) {
    return explicitChannel
  }

  if (value.includes('@')) {
    return 'Email'
  }

  return 'Telefono'
}

function toPriorityLevel(score: number): DebtorPriorityLevel {
  if (score >= 105) {
    return 'ALTA'
  }

  if (score >= 70) {
    return 'MEDIA'
  }

  return 'BAJA'
}

// El puntaje de prioridad combina severidad financiera y factibilidad de accion de cobranza.
function calculatePriorityScore({
  totalDebt,
  overdueDays,
  risk,
  hasContact,
  recommendationType,
}: {
  totalDebt: number
  overdueDays: number
  risk: RiskLevel
  hasContact: boolean
  recommendationType: string
}) {
  const debtScore = Math.min(totalDebt / 250000, 4) * 18
  const overdueScore = Math.min(overdueDays / 30, 4) * 10
  const riskScore = risk === 'ALTO' ? 30 : risk === 'MEDIO' ? 18 : 8
  const contactScore = hasContact ? 10 : -6
  const recommendationScore =
    recommendationType === 'Llamado prioritario'
      ? 20
      : recommendationType === 'Plan de pago / revision humana'
        ? 14
        : recommendationType === 'Mensaje recordatorio'
          ? 9
          : 4

  return Math.max(Math.round(debtScore + overdueScore + riskScore + contactScore + recommendationScore), 0)
}

// Mapeador principal: transforma filas crudas en objetos listos para dashboard, listado y detalle.
export function mapDebtorObjectsFromRawData(raw: RawDebtorDataBundle): MappedDebtorObjects {
  const debtorTypeLabels = mapLabelById(
    raw.debtorTypes,
    ['id', 'debtor_type_id', 'type_id'],
    ['value', 'name', 'description', 'label', 'code']
  )
  const debtStatusLabels = mapLabelById(
    raw.debtStatuses,
    ['id', 'debt_status_id', 'status_id'],
    ['value', 'name', 'description', 'label', 'status']
  )

  const peopleById = new Map<string, RawRow>()
  for (const person of raw.people) {
    const personId = stringifyUnknownValue(selectValueFromRow(person, ['id', 'person_id']))

    if (personId) {
      peopleById.set(personId, person)
    }
  }

  const debtsByDebtor = new Map<string, DebtorDebtItem[]>()
  for (const debt of raw.debts) {
    const debtorId = stringifyUnknownValue(
      selectValueFromRow(debt, ['debtor_id', 'id_debtor', 'debtorid', 'debtor'])
    )

    if (!debtorId) {
      continue
    }

    const originalAmount = selectNumericValueFromRow(debt, [
      'original_amount',
      'amount_original',
      'capital_amount',
      'amount',
      'monto_original',
    ])
    const updatedAmount =
      selectNumericValueFromRow(debt, [
        'updated_amount',
        'amount_updated',
        'total_amount',
        'amount_due',
        'monto_actualizado',
      ]) || originalAmount
    const dueDate =
      selectTextFromRow(debt, ['due_date', 'expiration_date', 'vencimiento', 'maturity_date']) ||
      null
    const debtStatusId = stringifyUnknownValue(
      selectValueFromRow(debt, ['debt_status_id', 'status_id', 'debt_status'])
    )
    const status =
      debtStatusLabels.get(debtStatusId) ||
      selectTextFromRow(debt, ['status', 'state']) ||
      resolveDebtStatusFromDueDate(dueDate)

    const debtItem: DebtorDebtItem = {
      id:
        stringifyUnknownValue(selectValueFromRow(debt, ['id', 'debt_id'])) ||
        `${debtorId}-${(debtsByDebtor.get(debtorId)?.length ?? 0) + 1}`,
      originalAmount,
      updatedAmount,
      dueDate,
      period:
        selectTextFromRow(debt, [
          'period',
          'fiscal_period',
          'billing_period',
          'year_month',
        ]) || 'Sin periodo',
      status,
    }

    const current = debtsByDebtor.get(debtorId) ?? []
    current.push(debtItem)
    debtsByDebtor.set(debtorId, current)
  }

  const personRelationsByDebtor = new Map<string, DebtorPersonRelation[]>()
  for (const relation of raw.debtorPeople) {
    const debtorId = stringifyUnknownValue(
      selectValueFromRow(relation, ['debtor_id', 'id_debtor', 'debtorid', 'debtor'])
    )
    const personId = stringifyUnknownValue(
      selectValueFromRow(relation, ['person_id', 'id_person', 'person'])
    )

    if (!debtorId || !personId) {
      continue
    }

    const relationHasActive = rowHasCandidateKey(relation, [
      'active',
      'is_active',
      'enabled',
      'valid',
    ])
    const relationIsActive = relationHasActive
      ? parseBooleanFromUnknown(
          selectValueFromRow(relation, ['active', 'is_active', 'enabled', 'valid'])
        )
      : true

    if (!relationIsActive) {
      continue
    }

    const current = personRelationsByDebtor.get(debtorId) ?? []
    current.push({
      personId,
      priority:
        selectTextFromRow(relation, ['priority', 'priority_level', 'order']) || 'Media',
      relation:
        selectTextFromRow(relation, [
          'relation',
          'relationship',
          'person_role',
          'role',
          'link_type',
        ]) || 'No especificada',
    })
    personRelationsByDebtor.set(debtorId, current)
  }

  const contactsByPerson = new Map<string, DebtorContactItem[]>()
  for (const contact of raw.debtorContacts) {
    const personId = stringifyUnknownValue(
      selectValueFromRow(contact, ['person', 'person_id', 'id_person'])
    )

    if (!personId) {
      continue
    }

    const value = selectTextFromRow(contact, [
      'value',
      'contact_value',
      'contact',
      'phone',
      'email',
      'phone_number',
      'mobile',
      'whatsapp',
    ]).trim()

    if (!value) {
      continue
    }

    const hasActiveColumn = rowHasCandidateKey(contact, [
      'active',
      'is_active',
      'is_available',
      'available',
      'valid',
    ])
    const isActive = hasActiveColumn
      ? parseBooleanFromUnknown(
          selectValueFromRow(contact, [
            'active',
            'is_active',
            'is_available',
            'available',
            'valid',
          ])
        )
      : true

    const contactItem: DebtorContactItem = {
      id:
        stringifyUnknownValue(selectValueFromRow(contact, ['id', 'contact_id'])) ||
        `${personId}-${contactsByPerson.get(personId)?.length ?? 0}`,
      personId,
      personName: '',
      channel: inferContactChannel(contact, value),
      value,
      isActive,
    }

    const current = contactsByPerson.get(personId) ?? []
    const duplicate = current.some(
      (item) =>
        item.value.toLowerCase() === contactItem.value.toLowerCase() &&
        item.channel.toLowerCase() === contactItem.channel.toLowerCase() &&
        item.isActive === contactItem.isActive
    )

    if (!duplicate) {
      current.push(contactItem)
      contactsByPerson.set(personId, current)
    }
  }

  const peopleByDebtor = new Map<string, DebtorPersonItem[]>()
  const contactsByDebtor = new Map<string, DebtorContactItem[]>()
  const contactCountByDebtor = new Map<string, number>()

  // Este cruce materializa la cadena debtor -> debtor_person -> person -> debtor_contact.
  for (const [debtorId, relations] of personRelationsByDebtor.entries()) {
    const currentPeople: DebtorPersonItem[] = []
    const currentContacts: DebtorContactItem[] = []
    const personsWithActiveContact = new Set<string>()

    for (const relation of relations) {
      const personRow = peopleById.get(relation.personId)
      const firstName = personRow ? selectTextFromRow(personRow, ['first_name', 'name']) : ''
      const lastName = personRow ? selectTextFromRow(personRow, ['last_name', 'surname']) : ''
      const fullName =
        (personRow && selectTextFromRow(personRow, ['full_name', 'display_name'])) ||
        `${firstName} ${lastName}`.trim() ||
        `Persona ${relation.personId}`
      const document =
        (personRow &&
          selectTextFromRow(personRow, ['document_number', 'document', 'dni', 'tax_id'])) ||
        'Sin documento'
      const personContacts = (contactsByPerson.get(relation.personId) ?? []).map((item) => ({
        ...item,
        personName: fullName,
      }))
      const activeValues = personContacts.filter((item) => item.isActive).map((item) => item.value)
      const contactSummary = activeValues.length > 0 ? activeValues.join(' | ') : 'Sin contacto'

      if (activeValues.length > 0) {
        personsWithActiveContact.add(relation.personId)
      }

      currentContacts.push(...personContacts)
      currentPeople.push({
        id: relation.personId,
        name: fullName,
        document,
        priority: relation.priority,
        contact: contactSummary,
        relation: relation.relation,
      })
    }

    peopleByDebtor.set(debtorId, currentPeople)
    contactsByDebtor.set(debtorId, currentContacts)
    contactCountByDebtor.set(debtorId, personsWithActiveContact.size)
  }

  if (process.env.NODE_ENV !== 'production') {
    // Log temporal para validar las relaciones de contacto cuando cambia el schema de datos.
    console.log('[EQUITAS contact debug]', {
      debtorPersonRows: raw.debtorPeople.length,
      debtorContactRows: raw.debtorContacts.length,
      mappedDebtorsWithContacts: contactCountByDebtor.size,
    })
  }

  const profileByDebtor = new Map<string, RawRow>()
  for (const profile of raw.debtorProfiles) {
    const debtorId = stringifyUnknownValue(
      selectValueFromRow(profile, ['debtor_id', 'id_debtor', 'debtorid', 'debtor'])
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
  for (const debtorRow of raw.debtors) {
    const id = stringifyUnknownValue(
      selectValueFromRow(debtorRow, ['id', 'debtor_id', 'debtorid'])
    )

    if (!id) {
      continue
    }

    const debts = debtsByDebtor.get(id) ?? []
    const people = peopleByDebtor.get(id) ?? []
    const contacts = contactsByDebtor.get(id) ?? []
    const activeContacts = contacts.filter((item) => item.isActive)
    const profile = profileByDebtor.get(id)

    const profileContactCount = selectNumericValueFromRow(profile ?? {}, [
      'available_contact_count',
      'available_contacts_count',
      'contact_available_count',
    ])
    const relationContactCount = contactCountByDebtor.get(id) ?? 0
    const contactCount = Math.max(profileContactCount, relationContactCount, activeContacts.length)
    const hasContact = contactCount > 0

    const totalDebt =
      selectNumericValueFromRow(profile ?? {}, [
        'total_debt_amount',
        'total_debt',
        'debt_total',
        'amount_total',
      ]) || debts.reduce((acc, debt) => acc + debt.updatedAmount, 0)

    const overdueDebts = debts.filter((debt) => isDebtOverdue(debt))
    const overdueDebt =
      selectNumericValueFromRow(profile ?? {}, [
        'overdue_debt_amount',
        'overdue_debt',
        'debt_overdue',
      ]) || overdueDebts.reduce((acc, debt) => acc + debt.updatedAmount, 0)
    const maxDaysOverdue = overdueDebts.reduce((acc, debt) => {
      const overdueDays = calculateDaysSinceDate(debt.dueDate)
      return Math.max(acc, overdueDays)
    }, 0)

    const riskAssessment = calculateDebtorRiskAssessment({
      providedRisk: selectValueFromRow(profile ?? {}, [
        'socioeconomic_risk_level',
        'risk_level',
        'risk',
        'risk_segment',
      ]),
      totalDebt,
      overdueDebt,
      hasContact,
      maxDaysOverdue,
    })
    const risk = riskAssessment.risk

    const recommendationResult = generateDebtorRecommendation({
      risk,
      hasContact,
      overdueDebt,
      totalDebt,
      overdueDays: maxDaysOverdue,
    })
    const priorityScore = calculatePriorityScore({
      totalDebt,
      overdueDays: maxDaysOverdue,
      risk,
      hasContact,
      recommendationType: recommendationResult.type,
    })
    const priorityLevel = toPriorityLevel(priorityScore)

    const debtorTypeId = stringifyUnknownValue(
      selectValueFromRow(debtorRow, ['debtor_type_id', 'type_id', 'type'])
    )
    const type =
      debtorTypeLabels.get(debtorTypeId) ||
      selectTextFromRow(debtorRow, ['value']) ||
      selectTextFromRow(debtorRow, ['debtor_type', 'type_name']) ||
      'Sin tipo'
    const identifier =
      selectTextFromRow(debtorRow, [
        'identifier',
        'code',
        'account_number',
        'domain',
        'external_id',
        'name',
      ]) || `OBJ-${id}`
    const description =
      selectTextFromRow(debtorRow, ['description', 'title', 'detail']) ||
      `Objeto de deuda ${identifier}`
    const statusByDebts = debts
      .map((debt) => normalizeStatusLabel(debt.status))
      .filter(Boolean)
      .at(0)
    const statusById = debtStatusLabels.get(
      selectTextFromRow(debtorRow, ['status', 'state'])
    )
    const statusFromDebtor = normalizeStatusLabel(
      selectTextFromRow(debtorRow, ['status_text', 'status', 'state'])
    )
    const status =
      statusByDebts || statusById || statusFromDebtor || (overdueDebt > 0 ? 'Vencido' : 'En gestion')

    debtors.push({
      id,
      identifier,
      type,
      description,
      status,
      totalDebt,
      overdueDebt,
      peopleCount: people.length,
      peopleIds: people.map((person) => person.id),
      peopleNames: people.map((person) => person.name),
      hasContact,
      contactCount,
      risk,
      riskScore: riskAssessment.riskScore,
      debtCount: debts.length,
      overdueDebtsCount: overdueDebts.length,
      maxDaysOverdue,
      priorityScore,
      priorityLevel,
      recommendation: recommendationResult.summary,
      recommendationType: recommendationResult.type,
      recommendationReason: recommendationResult.reason,
      isUrgentRecommendation: recommendationResult.isUrgent,
    })
  }

  return {
    debtors,
    debtsByDebtor,
    peopleByDebtor,
    contactsByDebtor,
    debtStatusBuckets,
    warnings: raw.warnings,
  }
}
