import { moneyData } from '@/lib/analytics'
import {
  parseBooleanFromUnknown,
  rowHasCandidateKey,
  selectTextFromRow,
  selectValueFromRow,
  stringifyUnknownValue,
} from '@/lib/parsers/generic-value-selector'
import { aggregateData, observed, readingFailed, selectNumericData, unavailable } from '@/lib/data-presence'
import { generateDebtorRecommendation } from '@/lib/services/debtor-recommendation-generator'
import { calculateDebtorRiskAssessment } from '@/lib/services/debtor-risk-calculator'
import { evaluateDecisionRulesV1, RULES_VERSION, type DecisionInput, type RuleDatum } from '@/lib/domain/decision-rules-v1'
import { objectTotals } from '@/lib/domain/portfolio-totals'
import type {
  DataPresence,
  DebtorContactItem,
  DebtorDebtItem,
  DebtorListItem,
  DebtorPersonItem,
  DebtorPersonRelation,
  DebtorPriorityLevel,
  DecisionDataIssue,
  NumericData,
  MappedDebtorObjects,
  RawDebtorDataBundle,
  RawRow,
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

// Identidad del canal en origen: una etiqueta faltante no puede unir contactos distintos.
function contactChannelKey(contact: RawRow) {
  return selectTextFromRow(contact, ['channel', 'contact_channel', 'kind']) ||
    selectTextFromRow(contact, ['type', 'contact_type'])
}

// Un ID nunca llega a pantalla: se resuelve por catálogo o queda "No disponible".
// La inferencia por `@` (derivada, no observada) solo aplica si el contacto no trae tipo.
function contactChannelLabel(key: string, value: string, labels: Map<string, string>) {
  if (!key) return value.includes('@') ? 'Email' : 'Telefono'
  return /^[0-9]+$/.test(key) ? labels.get(key) ?? 'No disponible' : key
}

function ruleNumber(data: NumericData): RuleDatum<number> {
  return data.presence === 'OBSERVADO' && data.value !== null
    ? { estado: 'OBSERVADO', valor: data.value }
    : { estado: data.presence === 'OBSERVADO' ? 'INVALIDO' : data.presence, valor: null }
}

function recordMissing<T>(field: string, datum: RuleDatum<T>, issues: DecisionDataIssue[], reason: string) {
  if (datum.estado !== 'OBSERVADO') issues.push({ field, presence: datum.estado, reason })
  return datum
}

function ruleDate(value: unknown, field: string, issues: DecisionDataIssue[], absent: 'NO_INTEGRADO' | 'NO_INFORMADO_EN_ORIGEN' = 'NO_INFORMADO_EN_ORIGEN'): RuleDatum<string> {
  const text = typeof value === 'string' ? value.trim() : ''
  if (value == null || (typeof value === 'string' && !text)) {
    return recordMissing<string>(field, { estado: absent, valor: null }, issues, 'FECHA_AUSENTE')
  }
  const date = new Date(`${text}T00:00:00.000Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || text.startsWith('0000') ||
      !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    return recordMissing<string>(field, { estado: 'INVALIDO', valor: null }, issues, 'FECHA_INVALIDA')
  }
  return { estado: 'OBSERVADO', valor: text }
}

// Clave de debt_status para las reglas 1.1.0 (solo PAID excluye). La etiqueta nunca la sustituye:
// un estado observado sin clave queda NO_INTEGRADO y se computa como no pagado.
function catalogDatum(presence: DataPresence, key: string | undefined): RuleDatum<string> {
  if (presence === 'OBSERVADO') return key ? { estado: 'OBSERVADO', valor: key } : { estado: 'NO_INTEGRADO', valor: null }
  return { estado: presence, valor: null }
}

// Presencia de la clave para las reglas. Con clave en el catálogo decide la clave, sin pasar por el rótulo ni
// normalizarla (igual que el perfil SQL): UNKNOWN → no informado; cualquier otra → observada. Sin clave rige la
// presencia del estado visible. En todos los casos que no son `PAID` observado la obligación se computa como
// NO pagada, por importe y vencimiento; un catálogo ilegible (NO_INTEGRADO) impide evaluar el caso.
function catalogKeyPresence(catalogFailed: boolean, key: string | undefined, labelPresence: DataPresence): DataPresence {
  if (catalogFailed) return 'NO_INTEGRADO'
  if (key === undefined) return labelPresence
  return key.toUpperCase() === 'UNKNOWN' ? 'NO_INFORMADO_EN_ORIGEN' : 'OBSERVADO'
}

// Solo campos de origen explícitos: status y period heredados NO los sustituyen.
function sourceDatum(row: RawRow, key: string): RuleDatum<string | number> {
  const value = selectValueFromRow(row, [key])
  if (value === undefined) return { estado: 'NO_INTEGRADO', valor: null }
  if (value === null || value === '') return { estado: 'NO_INFORMADO_EN_ORIGEN', valor: null }
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) {
    return { estado: 'OBSERVADO', valor: value }
  }
  return { estado: 'INVALIDO', valor: null }
}

function rulePersonType(row: RawRow | undefined): DecisionInput['personas'][number]['tipo'] {
  const value = row && selectValueFromRow(row, ['type', 'person_type'])
  if (value === 'FISICA' || value === 'JURIDICA' || value === 'UNKNOWN') return { estado: 'OBSERVADO', valor: value }
  // El lector no trae person_type: no se interpreta una FK ni se infiere por CUIT.
  return { estado: value == null ? 'NO_INFORMADO_EN_ORIGEN' : 'NO_INTEGRADO', valor: null }
}

function decisionMetric(input: DecisionInput | null, value: number | null, issues: DecisionDataIssue[]): NumericData {
  if (!input) {
    if (issues.some(issue => issue.reason === 'LECTURA_FALLIDA')) return unavailable('NO_INTEGRADO')
    return unavailable(issues.some(issue => issue.presence === 'INVALIDO') ? 'INVALIDO' : 'NO_INTEGRADO', 'DECISION_NO_EVALUABLE')
  }
  const missing = input.obligaciones.flatMap(item => [item.current_amount, item.due_date])
    .flatMap(item => item.estado !== 'OBSERVADO' ? [unavailable(item.estado)]
      : typeof item.valor === 'number' ? item.valor < 0 ? [unavailable('INVALIDO')] : []
      : item.valor < '1970-01-01' ? [unavailable('INVALIDO')] : [])
  const data = aggregateData(missing, 'max')
  return value === null ? missing.length ? data : unavailable('INVALIDO', 'OBLIGACIONES_NO_EVALUABLES')
    : { ...observed(value), missing: data.missing }
}

// Mapeador principal: transforma filas crudas en objetos listos para dashboard, listado y detalle.
export function mapDebtorObjectsFromRawData(
  raw: RawDebtorDataBundle,
  options: { computedAt?: string } = {}
): MappedDebtorObjects {
  // Se captura el reloj una sola vez por lectura; con computedAt y manifiesto es reproducible.
  const decisionComputedAt = options.computedAt ?? new Date().toISOString()
  if (!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(decisionComputedAt) || !Number.isFinite(Date.parse(decisionComputedAt))) {
    throw new RangeError('computedAt debe ser una fecha-hora UTC válida')
  }
  const contextIssues: DecisionDataIssue[] = []
  const decisionAsOfSource = raw.batch ? 'MANIFIESTO_LOTE' : 'FECHA_CALCULO'
  const decisionAsOf = ruleDate(raw.batch ? raw.batch.as_of : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Cordoba', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(decisionComputedAt)), 'as_of', contextIssues)
  const sourceUpdatedAt = ruleDate(raw.batch?.source_updated_at, 'source_updated_at', contextIssues, 'NO_INTEGRADO')

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
  const debtStatusCatalog = new Map<string, { key: string; label: string }>()
  for (const row of raw.debtStatuses) {
    const id = stringifyUnknownValue(selectValueFromRow(row, ['id', 'debt_status_id', 'status_id']))
    const label = debtStatusLabels.get(id)
    if (label) debtStatusCatalog.set(id, { key: selectTextFromRow(row, ['key']), label })
  }
  // Clave del catálogo para las reglas (solo `PAID` excluye). Es independiente del rótulo y no se normaliza:
  // una fila sin rótulo visible, o con un rótulo numérico, sigue teniendo su clave, igual que en el perfil SQL.
  const debtStatusKeys = new Map<string, string>()
  for (const row of raw.debtStatuses) {
    const id = stringifyUnknownValue(selectValueFromRow(row, ['id', 'debt_status_id', 'status_id']))
    if (id && typeof row.key === 'string' && row.key !== '') debtStatusKeys.set(id, row.key)
  }

  const peopleById = new Map<string, RawRow>()
  for (const person of raw.people) {
    const personId = stringifyUnknownValue(selectValueFromRow(person, ['id', 'person_id']))

    if (personId) {
      peopleById.set(personId, person)
    }
  }

  const debtsByDebtor = new Map<string, DebtorDebtItem[]>()
  const catalogFailed = readingFailed(raw.warnings, 'debt_status')
  for (const debt of raw.debts) {
    const debtorId = stringifyUnknownValue(
      selectValueFromRow(debt, ['debtor_id', 'id_debtor', 'debtorid', 'debtor'])
    )

    if (!debtorId) {
      continue
    }

    const original = moneyData(selectValueFromRow(debt, ['original_amount', 'amount_original', 'capital_amount', 'amount', 'monto_original']))
    const updated = Object.hasOwn(debt, 'current_amount') ? moneyData(debt.current_amount) : unavailable('NO_INTEGRADO')
    const originalAmount = original.value
    const updatedAmount = updated.value
    const decisionIssues: DecisionDataIssue[] = []
    const dueDatum = ruleDate(selectValueFromRow(debt, ['due_date', 'expiration_date', 'vencimiento', 'maturity_date']), 'due_date', decisionIssues)
    const dueDate = dueDatum.valor
    const amountDatum = recordMissing('current_amount', ruleNumber(updated), decisionIssues, updated.reason ?? 'IMPORTE_AUSENTE')
    const debtStatusId = stringifyUnknownValue(selectValueFromRow(debt, ['status', 'debt_status_id', 'status_id', 'debt_status']))
    const catalogStatus = debtStatusCatalog.get(debtStatusId)
    const status = catalogFailed ? 'No disponible' : catalogStatus?.label ?? 'UNKNOWN'
    const statusUnknown = (catalogStatus?.key || status).toUpperCase() === 'UNKNOWN'
    const statusPresence = catalogFailed ? 'NO_INTEGRADO' : catalogStatus
      ? statusUnknown ? 'NO_INFORMADO_EN_ORIGEN' : 'OBSERVADO' : debtStatusId ? 'INVALIDO' : 'NO_INFORMADO_EN_ORIGEN'

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
    debtItem.ruleInput = {
      id: debtItem.id,
      current_amount: amountDatum,
      due_date: dueDatum,
      estado_origen: recordMissing('estado_origen', sourceDatum(debt, 'estado_origen'), decisionIssues, 'ESTADO_ORIGEN_NO_EVALUABLE'),
      periodo_fiscal: recordMissing('periodo_fiscal', sourceDatum(debt, 'periodo_fiscal'), decisionIssues, 'PERIODO_FISCAL_NO_EVALUABLE'),
      estado_catalogo: catalogDatum(catalogKeyPresence(catalogFailed, debtStatusKeys.get(debtStatusId), statusPresence), debtStatusKeys.get(debtStatusId)),
    }
    debtItem.decisionIssues = decisionIssues.map(issue => ({ ...issue, entityId: debtItem.id }))

    const current = debtsByDebtor.get(debtorId) ?? []
    current.push(debtItem)
    debtsByDebtor.set(debtorId, current)
  }

  const personRelationsByDebtor = new Map<string, (DebtorPersonRelation & { percentage: NumericData })[]>()
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
      percentage: selectNumericData(relation, ['priority', 'priority_level', 'order']),
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

  const contactTypeLabels = mapLabelById(
    raw.contactTypes ?? [],
    ['id', 'contact_type_id', 'type_id'],
    ['value', 'name', 'description', 'label']
  )
  const contactsByPerson = new Map<string, DebtorContactItem[]>()
  const seenContacts = new Set<string>()
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

    const channelKey = contactChannelKey(contact)
    const contactItem: DebtorContactItem = {
      id:
        stringifyUnknownValue(selectValueFromRow(contact, ['id', 'contact_id'])) ||
        `${personId}-${contactsByPerson.get(personId)?.length ?? 0}`,
      personId,
      personName: '',
      channel: contactChannelLabel(channelKey, value, contactTypeLabels),
      value,
      isActive,
    }

    // Compara el canal de origen, no su etiqueta: leer o no el catálogo no cambia el conteo de contactos.
    const identity = JSON.stringify([personId, value.toLowerCase(), (channelKey || contactItem.channel).toLowerCase(), isActive])

    if (!seenContacts.has(identity)) {
      seenContacts.add(identity)
      contactsByPerson.set(personId, [...(contactsByPerson.get(personId) ?? []), contactItem])
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
    const peopleFailed = readingFailed(raw.warnings, 'debtor_person')
    const contactsFailed = readingFailed(raw.warnings, 'debtor_contact', 'debtor_person')
    const contactMetric = contactsFailed ? unavailable() : observed(contactCountByDebtor.get(id) ?? 0)
    const contactCount = contactMetric.value
    const hasContact = contactCount === null ? null : contactCount > 0
    const debtFailed = readingFailed(raw.warnings, 'debt', 'debtor')
    const profileFailed = readingFailed(raw.warnings, 'debtor_profile')
    // Una sola definición de totales y mora (portfolio-totals), la misma de las reglas: por calendario sobre
    // las no pagadas. Ni la clave OVERDUE, ni el rótulo, ni los importes persistidos del perfil la deciden.
    const totals = objectTotals(debts.map(debt => debt.ruleInput!), { asOf: decisionAsOf.valor, debtsFailed: debtFailed, statusesFailed: catalogFailed })
    const totalDebt = totals.registeredTotal.value
    const overdueDebt = totals.overdueDebt.value
    const maxDaysOverdue = totals.maxDaysOverdue.value
    const decisionIssues = [...contextIssues, ...debts.flatMap(debt => debt.decisionIssues ?? [])]
    if (debtFailed) decisionIssues.push({ field: 'obligaciones', presence: 'NO_INTEGRADO', reason: 'LECTURA_FALLIDA' })
    // Sin catálogo de estados no se sabe qué está pagado: la lectura fallida nunca se vuelve «no pagada».
    if (catalogFailed) decisionIssues.push({ field: 'estado_catalogo', presence: 'NO_INTEGRADO', reason: 'LECTURA_FALLIDA' })
    if (peopleFailed) decisionIssues.push({ field: 'personas', presence: 'NO_INTEGRADO', reason: 'LECTURA_FALLIDA' })
    if (contactsFailed) decisionIssues.push({ field: 'contactos_activos', presence: 'NO_INTEGRADO', reason: 'LECTURA_FALLIDA' })
    const relations = personRelationsByDebtor.get(id) ?? []
    const input: DecisionInput | null = debtFailed || catalogFailed || peopleFailed || decisionAsOf.valor === null ? null : {
      id, as_of: decisionAsOf.valor, source_updated_at: sourceUpdatedAt,
      obligaciones: debts.map(debt => debt.ruleInput!),
      contactos_activos: ruleNumber(contactMetric),
      personas: people.map(person => {
        const relation = relations.find(item => item.personId === person.id)!
        const percentage = relation.percentage
        return {
          tipo: readingFailed(raw.warnings, 'person') ? { estado: 'NO_INTEGRADO', valor: null } : rulePersonType(peopleById.get(person.id)),
          porcentaje_declarado: recordMissing('porcentaje_declarado', ruleNumber(percentage), decisionIssues, percentage.reason ?? 'PORCENTAJE_AUSENTE'),
        }
      }),
      // No existe fuente social integrada; nunca se infiere de deuda o contactos.
      vulnerabilidad: { estado: 'NO_INFORMADO_EN_ORIGEN', valor: null },
    }
    let decision = null
    if (input) {
      try {
        decision = evaluateDecisionRulesV1(input)
      } catch (error) {
        if (!(error instanceof RangeError || error instanceof TypeError)) throw error
        decisionIssues.push({ field: 'decision', presence: 'INVALIDO', reason: 'ENTRADA_FUERA_DE_CONTRATO' })
      }
    }
    const { risk, riskScore } = calculateDebtorRiskAssessment(decision)
    const recommendationResult = generateDebtorRecommendation(decision)
    const priorityScore = decision?.prioridad.valor ?? null
    const priorityLevel = priorityScore === null ? null : decision!.severidad.banda as DebtorPriorityLevel
    const priorityMetric = decisionMetric(decision ? input : null, priorityScore, decisionIssues)
    const rawComputedAt = selectTextFromRow(profile ?? {}, ['profile_generated_at']) || null
    const computedAt = !profileFailed && rawComputedAt && Number.isFinite(Date.parse(rawComputedAt)) ? rawComputedAt : null
    const decisionTime = decisionAsOfSource === 'MANIFIESTO_LOTE'
      ? `Corte del manifiesto: ${decisionAsOf.valor ?? 'no disponible'}`
      : `Fecha de cálculo usada: ${decisionAsOf.valor}; corte de origen no informado (corte no integrado)`
    const overdueCount = decision?.severidad.cantidad_vencidas ?? 0
    const overdueDateLabel = decisionAsOfSource === 'FECHA_CALCULO' ? 'fecha de cálculo usada' : 'fecha de corte'
    const overdueReason = overdueCount > 0
      ? ` ${decision?.severidad.estado === 'PARCIAL' ? 'Al menos ' : ''}${overdueCount} ${overdueCount === 1 ? 'obligación vencida' : 'obligaciones vencidas'} a la ${overdueDateLabel} ${decisionAsOf.valor}.`
      : ''
    const contactReason = contactsFailed ? ' Lectura de contactos no disponible: no se pudo verificar si hay contacto cargado.' : ''
    const temporalProvenance = `${decisionTime}; reglas v${RULES_VERSION}; decisión calculada el ${decisionComputedAt}. Importes del perfil: ${computedAt ?? 'momento de cálculo desconocido'}; estado del catálogo persistido: momento de cálculo desconocido.`

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
      pendingDebt: totals.pendingDebt.value,
      overdueDebt,
      metrics: {
        totalDebt: totals.registeredTotal, pendingDebt: totals.pendingDebt, overdueDebt: totals.overdueDebt,
        overdueDebtsCount: totals.overdueCount, contactCount: contactMetric, riskScore: priorityMetric,
        maxDaysOverdue: totals.maxDaysOverdue, priorityScore: priorityMetric,
      },
      decision,
      decisionInput: input,
      decisionAsOf,
      decisionAsOfSource,
      decisionComputedAt,
      rulesVersion: RULES_VERSION,
      decisionIssues,
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
      overdueDebtsCount: totals.overdueCount.value,
      maxDaysOverdue,
      priorityScore,
      priorityLevel,
      recommendation: recommendationResult.summary,
      recommendationType: recommendationResult.type,
      recommendationReason: `${recommendationResult.reason}${overdueReason}${contactReason} ${decisionTime}; reglas v${RULES_VERSION}.`,
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
