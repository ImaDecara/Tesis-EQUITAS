import { resolveDebtStatusFromDueDate } from '@/lib/parsers/date-value-parser'
import {
  parseBooleanFromUnknown,
  rowHasCandidateKey,
  selectTextFromRow,
  selectValueFromRow,
  stringifyUnknownValue,
} from '@/lib/parsers/generic-value-selector'
import { selectNumericValueFromRow } from '@/lib/parsers/numeric-value-parser'
import { generateDebtorRecommendation } from '@/lib/services/debtor-recommendation-generator'
import { calculateDebtorRiskLevel } from '@/lib/services/debtor-risk-calculator'
import type {
  DebtorDebtItem,
  DebtorListItem,
  DebtorPersonItem,
  DebtorPersonRelation,
  MappedDebtorObjects,
  RawDebtorDataBundle,
  RawRow,
} from '@/types/equitas-domain'

// Resuelve etiquetas de catalogos (tipo/estado) usando ids con nombres variables.
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

// Mapeador principal: transforma datos crudos en objetos de dominio listos para la interfaz.
export function mapDebtorObjectsFromRawData(raw: RawDebtorDataBundle): MappedDebtorObjects {
  // Busquedas de catalogos: traduce ids a etiquetas legibles cuando existen.
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
  // Construye lineas de deuda agrupadas por id del objeto de deuda.
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
  // Carga relaciones activas entre objeto de deuda y persona.
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
    })
    personRelationsByDebtor.set(debtorId, current)
  }

  const contactValuesByPerson = new Map<string, string[]>()
  // Carga contactos activos y no vacios, indexados por persona.
  for (const contact of raw.debtorContacts) {
    const personId = stringifyUnknownValue(
      selectValueFromRow(contact, ['person', 'person_id', 'id_person'])
    )

    if (!personId) {
      continue
    }

    const rawValue = selectTextFromRow(contact, [
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

    const contactHasActive = rowHasCandidateKey(contact, [
      'active',
      'is_active',
      'is_available',
      'available',
      'valid',
    ])
    const contactIsActive = contactHasActive
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
  // Cruza objeto de deuda -> persona -> contacto para filas de personas y conteo de disponibilidad.

  for (const [debtorId, relations] of personRelationsByDebtor.entries()) {
    const currentPeople: DebtorPersonItem[] = []
    const personsWithContact = new Set<string>()

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
    // Depuracion temporal para validar el cruce debtor_person -> debtor_contact.
    console.log('[EQUITAS contact debug]', {
      debtorPersonRows: raw.debtorPeople.length,
      debtorContactRows: raw.debtorContacts.length,
      mappedDebtorsWithContacts: contactCountByDebtor.size,
    })
  }

  const profileByDebtor = new Map<string, RawRow>()
  // Filas de perfil son opcionales, pero mejoran agregados de deuda/contacto/riesgo.
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
  // Ensamble final de objetos de dominio para listado/detalle/tablero.
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
    const profileContactCount = selectNumericValueFromRow(profile ?? {}, [
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
      selectNumericValueFromRow(profile ?? {}, [
        'total_debt_amount',
        'total_debt',
        'debt_total',
        'amount_total',
      ]) || debts.reduce((acc, debt) => acc + debt.updatedAmount, 0)
    const overdueDebt =
      selectNumericValueFromRow(profile ?? {}, [
        'overdue_debt_amount',
        'overdue_debt',
        'debt_overdue',
      ]) ||
      debts
        .filter((debt) => resolveDebtStatusFromDueDate(debt.dueDate) === 'Vencida')
        .reduce((acc, debt) => acc + debt.updatedAmount, 0)

    const risk = calculateDebtorRiskLevel(
      selectTextFromRow(profile ?? {}, [
        'risk_level',
        'risk',
        'risk_segment',
        'socioeconomic_risk_level',
      ]),
      totalDebt,
      overdueDebt,
      hasContact
    )

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
      peopleNames: people.map((person) => person.name),
      hasContact,
      contactCount,
      risk,
      recommendation: generateDebtorRecommendation(risk, hasContact, overdueDebt),
    })
  }

  return {
    debtors,
    debtsByDebtor,
    peopleByDebtor,
    debtStatusBuckets,
    warnings: raw.warnings,
  }
}
