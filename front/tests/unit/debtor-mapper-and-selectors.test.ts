import { describe, expect, it } from 'vitest'

import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import {
  buildDebtAgingSummary,
  getNoContactCases,
  sortByOperationalPriority,
} from '@/lib/equitas-view-selectors'
import type { DebtorListItem, RawDebtorDataBundle } from '@/types/equitas-domain'

function buildRawData(): RawDebtorDataBundle {
  return {
    debtors: [{ id: 1, external_id: 1001, type: 6, identifier: 'AG-1001', status: true }],
    debtorTypes: [{ id: 6, value: 'Agua' }],
    debts: [
      {
        id: 10,
        debtor: 1,
        original_amount: '900000',
        current_amount: '1000000',
        due_date: '2000-01-01',
        debt_status: 2,
        period: '2024-01',
      },
    ],
    debtStatuses: [{ id: 2, value: 'Vencida' }],
    debtorPeople: [{ debtor: 1, person: 50, active: true, role: 'Responsable' }],
    people: [{ id: 50, full_name: 'Ana Perez', document_number: '20123456789' }],
    debtorContacts: [{ id: 70, person: 50, type: 1, value: '3415550000', active: true }],
    debtorProfiles: [
      {
        debtor: 1,
        total_debt_amount: '1000000',
        overdue_debt_amount: '1000000',
        available_contact_count: 1,
        socioeconomic_risk_level: 95,
      },
    ],
    warnings: [],
  }
}

function buildDebtor(overrides: Partial<DebtorListItem>): DebtorListItem {
  return {
    id: '1',
    identifier: 'OBJ-1',
    type: 'Agua',
    description: 'Objeto de prueba',
    status: 'Vencida',
    totalDebt: 100,
    overdueDebt: 100,
    peopleCount: 1,
    peopleIds: ['50'],
    peopleNames: ['Ana Perez'],
    hasContact: true,
    contactCount: 1,
    risk: 'ALTO',
    riskScore: 90,
    debtCount: 1,
    overdueDebtsCount: 1,
    maxDaysOverdue: 120,
    priorityScore: 100,
    priorityLevel: 'MEDIA',
    recommendation: 'Llamado prioritario',
    recommendationType: 'Llamado prioritario',
    recommendationReason: 'Prueba',
    isUrgentRecommendation: true,
    ...overrides,
  }
}

describe('mapeador de objetos de deuda', () => {
  it('materializa relaciones, mora, riesgo y prioridad desde filas crudas', () => {
    const mapped = mapDebtorObjectsFromRawData(buildRawData())

    expect(mapped.debtors).toHaveLength(1)
    expect(mapped.debtors[0]).toMatchObject({
      identifier: 'AG-1001',
      type: 'Agua',
      totalDebt: 1000000,
      overdueDebt: 1000000,
      hasContact: true,
      contactCount: 1,
      risk: 'ALTO',
      riskScore: 95,
      priorityLevel: 'ALTA',
      priorityScore: 172,
      recommendationType: 'Llamado prioritario',
    })
    expect(mapped.peopleByDebtor.get('1')?.[0]?.name).toBe('Ana Perez')
    expect(mapped.contactsByDebtor.get('1')?.[0]?.isActive).toBe(true)
  })
})

describe('selectores operativos', () => {
  it('ordena casos por prioridad y conserva los casos sin contacto', () => {
    const debtors = [
      buildDebtor({ id: 'low', priorityScore: 80, hasContact: false }),
      buildDebtor({ id: 'high', priorityScore: 150, hasContact: false }),
      buildDebtor({ id: 'middle', priorityScore: 110, hasContact: true }),
    ]

    const sorted = sortByOperationalPriority(debtors)
    const noContact = getNoContactCases(debtors)

    expect(sorted.map((debtor) => debtor.id)).toEqual(['high', 'middle', 'low'])
    expect(noContact.map((debtor) => debtor.id)).toEqual(['high', 'low'])
  })

  it('resume deuda y distribuye atrasos en sus bandas', () => {
    const debtors = [
      buildDebtor({ id: 'without-delay', totalDebt: 50, overdueDebt: 0, maxDaysOverdue: 0 }),
      buildDebtor({ id: 'short-delay', totalDebt: 100, overdueDebt: 25, maxDaysOverdue: 30 }),
      buildDebtor({ id: 'long-delay', totalDebt: 200, overdueDebt: 150, maxDaysOverdue: 120 }),
    ]

    const summary = buildDebtAgingSummary(debtors)

    expect(summary.totalDebt).toBe(350)
    expect(summary.overdueDebt).toBe(175)
    expect(summary.averageOverdueDays).toBe(75)
    expect(summary.agingDistribution).toEqual([
      { label: 'Sin atraso', value: 1 },
      { label: '1-30 dias', value: 1 },
      { label: '31-90 dias', value: 0 },
      { label: '+90 dias', value: 1 },
    ])
  })
})
