import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { mapDashboardMetricsFromDebtorObjects } from '@/lib/mappers/dashboard-metrics-mapper'
import { buildDebtAgingSummary, buildRecommendationSummary } from '@/lib/equitas-view-selectors'
import { filterPortfolio, type PortfolioFilters } from '@/lib/portfolio-filters'
import type { RawDebtorDataBundle } from '@/types/equitas-domain'

function portfolio(): RawDebtorDataBundle {
  // Reglas 1.1.0: una de cada 11 obligaciones está pagada (clave PAID) y el perfil persistido no es fuente de totales.
  const raw: RawDebtorDataBundle = { batch: { as_of: '2026-09-30' }, debtors: [], debts: [], debtStatuses: [{ id: 1, key: 'ACTIVE', value: 'Vigente' }, { id: 6, key: 'PAID', value: 'Pagada' }], debtorTypes: [{ id: 1, value: 'Agua' }, { id: 2, value: 'Inmueble' }], people: [], debtorPeople: [], debtorContacts: [], debtorProfiles: [], warnings: [] }
  const amounts = [0, 0.01, 49999.99, 50000, 200000, 500000, 1000000, null]
  const due = ['2026-10-01', '2026-09-30', '2026-09-29', '2026-08-31', '2026-07-01', '2026-04-02', '2025-09-29', '2024-09-29', '2020-01-01', null]
  for (let index = 1; index <= 3507; index++) {
    const id = index * 3
    raw.debtors.push({ id, identifier: `SINTETICO-${String(index).padStart(4, '0')}`, type: index % 2 + 1 })
    raw.people.push({ id, full_name: `SINTETICO-${index}`, type: 'FISICA' })
    raw.debtorPeople.push({ id, debtor: id, person: id, priority: 100, active: true })
    if (index % 7) raw.debtorContacts.push({ id, person: id, type: 1, value: `s${index}@example.test`, active: true })
    for (let item = 0; item <= index % 13; item++) raw.debts.push({ id: `${id}-${item}`, debtor: id, current_amount: amounts[(index + item) % amounts.length], due_date: due[(index + item) % due.length], status: (index + item) % 11 ? 1 : 6 })
    if (index % 19 === 0) raw.debtorProfiles.push({ debtor: id, total_debt_amount: 123.45 })
  }
  // La lectura física no define desempates.
  raw.debtors.reverse(); raw.debts.reverse()
  return raw
}
const raw = portfolio()
const objects = mapDebtorObjectsFromRawData(raw, { computedAt: '2026-11-05T00:00:00.000Z' })
const buckets = (rows: { label: string; value: number }[]) => Object.fromEntries(rows.filter(row => row.value).map(row => [row.label, row.value]))

describe('ALIGN-014: consultas SQLite independientes sobre 3507 objetos', () => {
  it.each<PortfolioFilters>([{}, { type: 'Agua' }, { risk: 'ALTO', contact: 'with' }, { minAmount: '500000', type: 'Inmueble' }, { q: 'SINTETICO-035' }, { q: 'INEXISTENTE' }])('mismo corte y filtros %j: totales, distribuciones y todos los órdenes', filters => {
    const expected = JSON.parse(execFileSync('python3', [fileURLToPath(new URL('../fixtures/analytics-reference.py', import.meta.url))], { input: JSON.stringify({ raw, filters }), maxBuffer: 8 * 1024 * 1024, timeout: 30000 }).toString())
    const selection = filterPortfolio(objects.debtors, filters)
    const dashboard = mapDashboardMetricsFromDebtorObjects({ ...objects, debtors: selection.items, warnings: selection.warnings })
    const aging = buildDebtAgingSummary(selection.items, selection.warnings)
    const groups = buildRecommendationSummary(selection.items, selection.warnings)
    expect(dashboard.totalDebtors).toBe(expected.count)
    expect(dashboard.totalDebt).toBe(expected.totalDebt)
    expect(dashboard.overdueCases).toBe(expected.overdueCases)
    expect(dashboard.priorityCases).toBe(expected.high)
    expect(dashboard.withContactCases).toBe(expected.withContact)
    expect(dashboard.withoutContactCases).toBe(expected.withoutContact)
    expect(aging.overdueDebt).toBe(expected.overdueDebt)
    expect(aging.averageOverdueDays).toBe(expected.averageOverdueDays)
    expect(buckets(dashboard.byRisk)).toEqual(expected.byRisk)
    expect(buckets(dashboard.byDebtorType)).toEqual(expected.byType)
    expect(buckets(aging.agingDistribution)).toEqual(expected.aging)
    expect(aging.topDebtCases.map(item => item.id)).toEqual(expected.topDebtIds)
    expect(dashboard.topDebtDebtors.map(item => item.id)).toEqual(expected.topDebtIds.slice(0, 5))
    for (const group of groups.filter(item => item.interventionCode)) {
      const reference = expected.queues[group.interventionCode!] ?? { count: 0, amount: 0, mean: null }
      expect(group.count).toBe(reference.count)
      expect(group.debtAssociated).toBe(reference.amount)
      expect(group.averageRisk).toBe(reference.mean)
      expect(group.cases.map(item => item.id)).toEqual(expected.queueOrder[group.interventionCode!] ?? [])
      expect(dashboard.queuePreviews?.find(item => item.code === group.interventionCode)?.cases.map(item => item.id)).toEqual((expected.queueOrder[group.interventionCode!] ?? []).slice(0, 3))
    }
    console.info('ALIGN014_REFERENCE', JSON.stringify({ objects: raw.debtors.length, selected: expected.count, cutoff: raw.batch!.as_of, filters, status: 'matched' }))
  })
})
