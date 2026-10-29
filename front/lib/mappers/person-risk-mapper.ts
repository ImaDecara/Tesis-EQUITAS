import {
  parseBooleanFromUnknown,
  rowHasCandidateKey,
  selectTextFromRow,
  selectValueFromRow,
  stringifyUnknownValue,
} from '@/lib/parsers/generic-value-selector'
import { aggregateData, compareNullable, currentAmount, metric, observed, readingFailed, selectNumericData, unavailable } from '@/lib/data-presence'
import { clampRiskScore, mapRiskLevel } from '@/lib/services/debtor-risk-calculator'
import type {
  DataWarning,
  NumericData,
  PeopleDashboardSummary,
  PersonIndividualRiskLevel,
  PersonListItem,
  RawPersonDataBundle,
} from '@/types/equitas-domain'

function clampRiskValue(value: number) {
  return clampRiskScore(value)
}

// Convierte risk_value individual (escala 0-100) al nivel cualitativo de negocio.
export function mapRiskValueToIndividualRiskLevel(
  riskValue: number
): PersonIndividualRiskLevel {
  return mapRiskLevel(riskValue)
}

function buildPeopleDashboardSummary(people: PersonListItem[], warnings: DataWarning[]): PeopleDashboardSummary {
  const lowRiskCount = people.filter((person) => person.individualRisk === 'BAJO').length
  const mediumRiskCount = people.filter((person) => person.individualRisk === 'MEDIO').length
  const highRiskCount = people.filter((person) => person.individualRisk === 'ALTO').length
  const withoutContactCount = people.filter((person) => person.hasContact === false).length

  const failed = readingFailed(warnings, 'person')
  const riskFailed = failed || readingFailed(warnings, 'debtor_profile_detail')
  const contactFailed = failed || readingFailed(warnings, 'debtor_contact')
  const riskValues = people.map(person => metric(person, 'riskValue'))
  const riskCount = (count: number) => aggregateData(riskValues.map(value => value.value === null ? value : observed(0)), 'sum', riskFailed).value === null ? null : count
  return {
    metrics: {
      riskValue: aggregateData(riskValues, 'max', riskFailed),
      totalPeople: failed ? unavailable() : observed(people.length),
      withoutContactCount: contactFailed ? unavailable() : observed(withoutContactCount),
    },
    totalPeople: failed ? null : people.length,
    lowRiskCount: riskCount(lowRiskCount),
    mediumRiskCount: riskCount(mediumRiskCount),
    highRiskCount: riskCount(highRiskCount),
    withoutContactCount: contactFailed ? null : withoutContactCount,
    individualRiskDistribution: riskFailed ? [] : [
      { label: 'Bajo', value: lowRiskCount },
      { label: 'Medio', value: mediumRiskCount },
      { label: 'Alto', value: highRiskCount },
      { label: 'No disponible', value: people.filter(person => person.riskValue === null).length },
    ],
    topPeopleByRiskValue: people.filter(person => person.riskValue !== null)
      .sort((a, b) => {
        if (b.riskValue !== a.riskValue) {
          return compareNullable(a.riskValue, b.riskValue)
        }

        if (b.totalDebtAssociated !== a.totalDebtAssociated) {
          return compareNullable(a.totalDebtAssociated, b.totalDebtAssociated)
        }

        return a.name.localeCompare(b.name)
      })
      .slice(0, 5)
      .map((person) => ({
        id: person.id,
        name: person.name,
        document: person.document,
        riskValue: person.riskValue,
        individualRisk: person.individualRisk,
        debtorsCount: person.debtorsCount,
        hasContact: person.hasContact,
      })),
  }
}

// Arma el universo de personas con riesgo individual y vinculos reales contra objetos de deuda.
export function mapPeopleFromRawData(raw: RawPersonDataBundle): {
  people: PersonListItem[]
  dashboard: PeopleDashboardSummary
} {
  const debtorIdentifierById = new Map<string, string>()
  for (const debtorRow of raw.debtors) {
    const debtorId = stringifyUnknownValue(
      selectValueFromRow(debtorRow, ['id', 'debtor_id', 'debtorid'])
    )

    if (!debtorId) {
      continue
    }

    const identifier =
      selectTextFromRow(debtorRow, [
        'identifier',
        'code',
        'account_number',
        'domain',
        'external_id',
        'name',
      ]) || `OBJ-${debtorId}`

    debtorIdentifierById.set(debtorId, identifier)
  }

  const debtAmountsByDebtor = new Map<string, NumericData[]>()
  for (const debtRow of raw.debts) {
    const debtorId = stringifyUnknownValue(selectValueFromRow(debtRow, ['debtor_id', 'id_debtor', 'debtorid', 'debtor']))
    if (!debtorId) continue
    const amounts = debtAmountsByDebtor.get(debtorId) ?? []
    amounts.push(currentAmount(debtRow))
    debtAmountsByDebtor.set(debtorId, amounts)
  }
  const riskValuesByPerson = new Map<string, NumericData[]>()
  for (const detailRow of raw.debtorProfilesDetail) {
    const personId = stringifyUnknownValue(selectValueFromRow(detailRow, ['person', 'person_id', 'id_person']))
    if (!personId) continue
    const values = riskValuesByPerson.get(personId) ?? []
    const value = selectNumericData(detailRow, ['risk_value', 'risk', 'value', 'score'])
    values.push(value.value === null ? value : observed(clampRiskValue(value.value)))
    riskValuesByPerson.set(personId, values)
  }

  const debtorIdsByPerson = new Map<string, Set<string>>()
  for (const relationRow of raw.debtorPeople) {
    const debtorId = stringifyUnknownValue(
      selectValueFromRow(relationRow, ['debtor_id', 'id_debtor', 'debtorid', 'debtor'])
    )
    const personId = stringifyUnknownValue(
      selectValueFromRow(relationRow, ['person_id', 'id_person', 'person'])
    )

    if (!debtorId || !personId) {
      continue
    }

    const hasActiveColumn = rowHasCandidateKey(relationRow, [
      'active',
      'is_active',
      'enabled',
      'valid',
    ])
    const relationIsActive = hasActiveColumn
      ? parseBooleanFromUnknown(
          selectValueFromRow(relationRow, ['active', 'is_active', 'enabled', 'valid'])
        )
      : true

    if (!relationIsActive) {
      continue
    }

    const current = debtorIdsByPerson.get(personId) ?? new Set<string>()
    current.add(debtorId)
    debtorIdsByPerson.set(personId, current)
  }

  const hasContactByPerson = new Map<string, boolean>()
  for (const contactRow of raw.debtorContacts) {
    const personId = stringifyUnknownValue(
      selectValueFromRow(contactRow, ['person', 'person_id', 'id_person'])
    )

    if (!personId) {
      continue
    }

    const value = selectTextFromRow(contactRow, [
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

    const hasActiveColumn = rowHasCandidateKey(contactRow, [
      'active',
      'is_active',
      'is_available',
      'available',
      'valid',
    ])
    const contactIsActive = hasActiveColumn
      ? parseBooleanFromUnknown(
          selectValueFromRow(contactRow, [
            'active',
            'is_active',
            'is_available',
            'available',
            'valid',
          ])
        )
      : true

    if (contactIsActive) {
      hasContactByPerson.set(personId, true)
    }
  }

  const people: PersonListItem[] = []
  for (const personRow of raw.people) {
    const personId = stringifyUnknownValue(selectValueFromRow(personRow, ['id', 'person_id']))

    if (!personId) {
      continue
    }

    const firstName = selectTextFromRow(personRow, ['first_name', 'name'])
    const lastName = selectTextFromRow(personRow, ['last_name', 'surname'])
    const fullName =
      selectTextFromRow(personRow, ['full_name', 'display_name']) ||
      `${firstName} ${lastName}`.trim() ||
      `Persona ${personId}`
    const document =
      selectTextFromRow(personRow, ['document_number', 'document', 'dni', 'tax_id']) ||
      'Sin documento'
    const riskMetric = aggregateData(riskValuesByPerson.get(personId) ?? [unavailable()], 'max', readingFailed(raw.warnings, 'debtor_profile_detail', 'person'))
    const riskValue = riskMetric.value
    const individualRisk = riskValue === null ? null : mapRiskValueToIndividualRiskLevel(riskValue)
    const debtorIds = Array.from(debtorIdsByPerson.get(personId) ?? new Set<string>())
    const debtorIdentifiers = debtorIds.map(
      (debtorId) => debtorIdentifierById.get(debtorId) ?? `OBJ-${debtorId}`
    )
    const exposureFailed = readingFailed(raw.warnings, 'debt', 'debtor', 'debtor_person', 'person')
    const debtExposure = debtorIds.map(debtorId => ({ debtorId,
      amount: aggregateData(debtAmountsByDebtor.get(debtorId) ?? [], 'sum', exposureFailed) }))
    const exposureMetric = aggregateData(debtExposure.map(item => item.amount), 'sum', exposureFailed)
    const totalDebtAssociated = exposureMetric.value

    people.push({
      id: personId,
      name: fullName,
      document,
      individualRisk,
      riskValue,
      debtorsCount: readingFailed(raw.warnings, 'debtor_person', 'debtor') ? null : debtorIds.length,
      hasContact: readingFailed(raw.warnings, 'debtor_contact', 'person') ? null : hasContactByPerson.get(personId) ?? false,
      totalDebtAssociated,
      debtExposure,
      exposureLabel: 'Exposición asociada (no aditiva)',
      metrics: { riskValue: riskMetric, totalDebtAssociated: exposureMetric },
      debtorIds,
      debtorIdentifiers,
    })
  }

  people.sort((a, b) => {
    if (b.riskValue !== a.riskValue) {
      return compareNullable(a.riskValue, b.riskValue)
    }

    if (b.totalDebtAssociated !== a.totalDebtAssociated) {
      return compareNullable(a.totalDebtAssociated, b.totalDebtAssociated)
    }

    return a.name.localeCompare(b.name)
  })

  return {
    people,
    dashboard: buildPeopleDashboardSummary(people, raw.warnings),
  }
}

// Unión de objetos de las personas filtradas, antes de paginar. Nunca suma exposiciones.
export function summarizePeople(people: PersonListItem[], warnings: DataWarning[] = [], filterReadFailed = false) {
  const objects = new Map<string, NumericData>()
  for (const person of people) {
    for (const exposure of person.debtExposure) objects.set(exposure.debtorId, exposure.amount)
  }
  const failed = filterReadFailed || readingFailed(warnings, 'person', 'debtor_person', 'debtor', 'debt')
  return {
    totalDebtAssociated: aggregateData([...objects.values()], 'sum', failed),
    averageRiskValue: aggregateData(people.map(person => metric(person, 'riskValue')), 'mean', readingFailed(warnings, 'person', 'debtor_profile_detail')),
  }
}
