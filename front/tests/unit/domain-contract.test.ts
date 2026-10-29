import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DATA_PRESENCE_STATES,
  type DashboardData,
  type DebtorContactItem,
  type DebtorDebtItem,
  type DebtorListItem,
  type DebtorPersonItem,
  type DebtorPersonRelation,
  type DebtorProfileSummary,
  type PeopleDashboardSummary,
  type PersonListItem,
} from '@/types/equitas-domain'

const contract = readFileSync(
  new URL('../../../docs/tesis/contrato-dominio-v1.md', import.meta.url),
  'utf8'
)

function section(number: number) {
  const start = contract.indexOf(`\n## ${number}. `)
  const end = contract.indexOf(`\n## ${number + 1}. `, start + 1)
  expect(start, `seccion ${number} del contrato`).toBeGreaterThan(-1)
  return contract.slice(start, end === -1 ? undefined : end)
}

function fields<T>(dto: string, keys: Record<keyof T, true>) {
  return Object.keys(keys).map((key) => `${dto}.${key}`)
}

// Record<keyof T, true> obliga a listar cada campo: un campo nuevo sin entrada rompe el chequeo de tipos.
const visibleFields = [
  ...fields<DebtorListItem>('DebtorListItem', {
    id: true, identifier: true, type: true, description: true, status: true, totalDebt: true,
    overdueDebt: true, peopleCount: true, peopleIds: true, peopleNames: true, hasContact: true,
    contactCount: true, risk: true, riskScore: true, debtCount: true, overdueDebtsCount: true,
    maxDaysOverdue: true, priorityScore: true, priorityLevel: true, recommendation: true,
    recommendationType: true, recommendationReason: true, isUrgentRecommendation: true,
  }),
  ...fields<DebtorPersonItem>('DebtorPersonItem', {
    id: true, name: true, document: true, priority: true, contact: true, relation: true,
  }),
  ...fields<DebtorPersonRelation>('DebtorPersonRelation', {
    personId: true, priority: true, relation: true,
  }),
  ...fields<DebtorContactItem>('DebtorContactItem', {
    id: true, personId: true, personName: true, channel: true, value: true, isActive: true,
  }),
  ...fields<DebtorDebtItem>('DebtorDebtItem', {
    id: true, originalAmount: true, updatedAmount: true, dueDate: true, period: true, status: true,
  }),
  ...fields<DebtorProfileSummary>('DebtorProfileSummary', {
    totalDebt: true, overdueDebt: true, debtCount: true, antiquityDays: true, associatedPeople: true,
    availableContacts: true, risk: true, riskScore: true, socioeconomicLevel: true,
  }),
  ...fields<PersonListItem>('PersonListItem', {
    id: true, name: true, document: true, individualRisk: true, riskValue: true, debtorsCount: true,
    hasContact: true, totalDebtAssociated: true, debtorIds: true, debtorIdentifiers: true,
  }),
  ...fields<DashboardData>('DashboardData', {
    totalDebtors: true, totalDebt: true, overdueCases: true, withContactCases: true,
    withoutContactCases: true, priorityCases: true, urgentRecommendationCases: true,
    criticalCasesToday: true, riskAboveNinetyCases: true, criticalDebtTotal: true,
    byDebtStatus: true, byDebtorType: true, byRisk: true, byRecommendation: true,
    topDebtChart: true, topDebtors: true, topPriorityDebtors: true, withoutContactDebtors: true,
    topDebtDebtors: true,
  }),
  ...fields<PeopleDashboardSummary>('PeopleDashboardSummary', {
    totalPeople: true, lowRiskCount: true, mediumRiskCount: true, highRiskCount: true,
    withoutContactCount: true, individualRiskDistribution: true, topPeopleByRiskValue: true,
  }),
]

// Columnas que hoy alimentan reglas del ETL, del servicio Python o de los mapeadores.
const ruleColumns = [
  'debt.external_id', 'debt.period', 'debt.type', 'debt.original_amount', 'debt.current_amount',
  'debt.updated_amount', 'debt.due_date', 'debt.issue_date', 'debt.last_collection_date',
  'debt.status', 'debtor.status', 'debtor.type', 'debtor_person.priority', 'debtor_person.role',
  'debtor_person.active', 'debtor_contact.value', 'debtor_contact.type', 'debtor_contact.active',
  'person.type', 'person.document_number', 'debtor_profile.total_debt_amount',
  'debtor_profile.overdue_debt_amount', 'debtor_profile.debt_count',
  'debtor_profile.overdue_debt_count', 'debtor_profile.oldest_debt_days',
  'debtor_profile.average_debt_age_days', 'debtor_profile.active_person_count',
  'debtor_profile.available_contact_count', 'debtor_profile.previous_contact_count',
  'debtor_profile.previous_response_count', 'debtor_profile.socioeconomic_risk_level',
  'debtor_profile.profile_generated_at', 'debtor_profile_detail.risk_value',
]

describe('ALIGN-007: contrato de dominio v1', () => {
  it('documenta exactamente los estados de presencia del tipo DataPresence', () => {
    const documented = [...section(4).matchAll(/^\| `([A-Z_]+)` \|/gm)].map((match) => match[1])

    expect(documented).toEqual([...DATA_PRESENCE_STATES])
  })

  it('representa todo estado distinto de OBSERVADO como null, nunca como 0', () => {
    const rows = section(4)
      .split('\n')
      .filter((row) => /^\| `[A-Z_]+` \|/.test(row))

    for (const row of rows.filter((item) => !item.startsWith('| `OBSERVADO`'))) {
      const representation = row.split(' | ')[2]
      expect(representation, row).toContain('valor `null`')
      expect(representation, row).not.toMatch(/\b0\b/)
    }
  })

  it('tiene una entrada de diccionario por cada campo visible y cada columna usada en reglas', () => {
    const dictionary = section(7)
    const missing = [...visibleFields, ...ruleColumns].filter(
      (name) => !dictionary.includes(`\`${name}\``)
    )

    expect(missing).toEqual([])
  })

  it('fija el significado de los nombres heredados sin renombrar columnas', () => {
    const legacyMap = section(8)

    for (const name of [
      'socioeconomic_risk_level',
      'debtor_person.priority',
      'debt.period',
      'debt.issue_date',
      'debt.last_collection_date',
      'previous_*_count',
      'debt.status',
    ]) {
      expect(legacyMap, name).toContain(`\`${name}\``)
    }
  })
})
