import {
  parseBooleanFromUnknown,
  rowHasCandidateKey,
  selectTextFromRow,
  selectValueFromRow,
  stringifyUnknownValue,
} from '@/lib/parsers/generic-value-selector'
import { aggregateData, currentAmount, daysSinceData, metric, observed, readingFailed, selectNumericData, unavailable } from '@/lib/data-presence'
import { generateDebtorRecommendation } from '@/lib/services/debtor-recommendation-generator'
import { clampRiskScore, mapRiskLevel } from '@/lib/services/debtor-risk-calculator'
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
      selectTextFromRow(row, ['name', 'description', 'status', 'code'])

    if (!label || /^[0-9]+$/.test(label)) continue

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

  return normalizedStatus === 'overdue'

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

    const original = selectNumericData(debt, ['original_amount', 'amount_original', 'capital_amount', 'amount', 'monto_original'])
    const updated = currentAmount(debt)
    const originalAmount = original.value
    const updatedAmount = updated.value
    const dueDate = selectTextFromRow(debt, ['due_date', 'expiration_date', 'vencimiento', 'maturity_date']) || null
    const debtStatusId = stringifyUnknownValue(selectValueFromRow(debt, ['status', 'debt_status_id', 'status_id', 'debt_status']))
    const catalogFailed = readingFailed(raw.warnings, 'debt_status')
    const status = catalogFailed ? 'No disponible' : debtStatusLabels.get(debtStatusId) ?? 'UNKNOWN'
    const statusPresence = catalogFailed ? 'NO_INTEGRADO' : debtStatusLabels.has(debtStatusId)
      ? status.toUpperCase() === 'UNKNOWN' ? 'NO_INFORMADO_EN_ORIGEN' : 'OBSERVADO' : debtStatusId ? 'INVALIDO' : 'NO_INFORMADO_EN_ORIGEN'

    const debtItem: DebtorDebtItem = {
      id:
        stringifyUnknownValue(selectValueFromRow(debt, ['id', 'debt_id'])) ||
        `${debtorId}-${(debtsByDebtor.get(debtorId)?.length ?? 0) + 1}`,
      originalAmount,
      updatedAmount,
      metrics: { originalAmount: original, updatedAmount: updated },
      statusPresence,
      dueDate,
      period:
        selectTextFromRow(debt, [
          'period',
          'fiscal_period',
          'billing_period',
          'year_month',
        ]) || 'No informado',
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
        selectTextFromRow(relation, ['priority', 'priority_level', 'order']) || 'No informado',
      relation:
        selectTextFromRow(relation, [
          'relation',
          'relationship',
          'person_role',
          'role',
          'link_type',
        ]) || 'No informado',
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
    const seenPeople = new Set<string>()

    for (const relation of relations) {
      if (seenPeople.has(relation.personId)) continue
      seenPeople.add(relation.personId)
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
    contactCountByDebtor.set(debtorId, currentContacts.filter(contact => contact.isActive).length)
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
    const profile = profileByDebtor.get(id)
    const contactsFailed = readingFailed(raw.warnings, 'debtor_contact', 'debtor_person')
    const contactMetric = contactsFailed ? unavailable() : observed(contactCountByDebtor.get(id) ?? 0)
    const contactCount = contactMetric.value
    const hasContact = contactCount === null ? null : contactCount > 0
    const debtFailed = readingFailed(raw.warnings, 'debt', 'debtor')
    const profileFailed = readingFailed(raw.warnings, 'debtor_profile')
    const overdueDebts = debts.filter(isDebtOverdue)
    const totalFromProfile = selectNumericData(profile ?? {}, ['total_debt_amount', 'total_debt', 'debt_total', 'amount_total'])
    const overdueFromProfile = selectNumericData(profile ?? {}, ['overdue_debt_amount', 'overdue_debt', 'debt_overdue'])
    const totalMetric = debtFailed || profileFailed ? unavailable()
      : totalFromProfile.presence === 'NO_INFORMADO_EN_ORIGEN'
        ? aggregateData(debts.map(debt => metric(debt, 'updatedAmount'))) : totalFromProfile
    const statusIncomplete = debts.some(debt => debt.statusPresence !== 'OBSERVADO')
    const overdueMetric = debtFailed || profileFailed ? unavailable()
      : overdueFromProfile.presence === 'NO_INFORMADO_EN_ORIGEN'
        ? aggregateData(overdueDebts.map(debt => metric(debt, 'updatedAmount')), 'sum', statusIncomplete)
        : overdueFromProfile
    const totalDebt = totalMetric.value
    const overdueDebt = overdueMetric.value
    const overdueDaysMetric = aggregateData(overdueDebts.map(debt => daysSinceData(debt.dueDate)), 'max', debtFailed || statusIncomplete)
    const maxDaysOverdue = overdueDaysMetric.value
    const providedRisk = selectNumericData(profile ?? {}, ['socioeconomic_risk_level', 'risk_level', 'risk', 'risk_segment'])
    // El perfil ausente se registra como faltante; las fórmulas heredadas se conservan para datos observados.
    const riskMetric = profileFailed || !profile ? unavailable() : providedRisk
    const riskScore = riskMetric.value === null ? null : clampRiskScore(riskMetric.value)
    const risk = riskScore === null ? null : mapRiskLevel(riskScore)
    const recommendationResult = risk !== null && totalDebt !== null && overdueDebt !== null && hasContact !== null && (maxDaysOverdue !== null || overdueDaysMetric.presence === 'NO_APLICA')
      ? generateDebtorRecommendation({ risk, hasContact, overdueDebt, totalDebt, overdueDays: maxDaysOverdue ?? 0 })
      : { type: 'No disponible' as const, summary: 'No disponible', reason: 'Insumos no disponibles', isUrgent: false }
    const priorityScore = risk !== null && totalDebt !== null && overdueDebt !== null && hasContact !== null && (maxDaysOverdue !== null || overdueDaysMetric.presence === 'NO_APLICA')
      ? calculatePriorityScore({ totalDebt, overdueDays: maxDaysOverdue ?? 0, risk, hasContact, recommendationType: recommendationResult.type }) : null
    const priorityLevel = priorityScore === null ? null : toPriorityLevel(priorityScore)
    const priorityMetric = priorityScore === null
      ? aggregateData([totalMetric, overdueMetric, contactMetric, riskMetric, overdueDaysMetric].filter(item => item.value === null && item.presence !== 'NO_APLICA'), 'max')
      : observed(priorityScore)
    const rawComputedAt = selectTextFromRow(profile ?? {}, ['profile_generated_at']) || null
    const computedAt = !profileFailed && rawComputedAt && Number.isFinite(Date.parse(rawComputedAt)) ? rawComputedAt : null
    const temporalProvenance = profile
      ? `Calculado ${computedAt ? 'el ' + computedAt : 'en momento de cálculo desconocido'} (componente persistido); al día de la consulta (antigüedad recalculada); estado del catálogo persistido: momento de cálculo desconocido; corte no integrado`
      : 'Calculado al día de la consulta (importes y antigüedad); perfil no integrado; estado del catálogo persistido: momento de cálculo desconocido; corte no integrado'

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
      statusByDebts || statusById || statusFromDebtor || 'No informado'

    debtors.push({
      id,
      identifier,
      type,
      description,
      status,
      totalDebt,
      overdueDebt,
      metrics: { totalDebt: totalMetric, overdueDebt: overdueMetric, contactCount: contactMetric, riskScore: riskScore === null ? riskMetric : observed(riskScore), maxDaysOverdue: overdueDaysMetric, priorityScore: priorityMetric },
      computedAt,
      temporalProvenance,
      peopleCount: readingFailed(raw.warnings, 'debtor_person', 'person') ? null : people.length,
      peopleIds: people.map((person) => person.id),
      peopleNames: people.map((person) => person.name),
      hasContact,
      contactCount,
      risk,
      riskScore,
      debtCount: debtFailed ? null : debts.length,
      overdueDebtsCount: debtFailed || statusIncomplete ? null : overdueDebts.length,
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
