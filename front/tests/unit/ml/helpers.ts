import type { DebtorListItem, RawDebtorDataBundle } from '@/types/equitas-domain'
import { observed } from '@/lib/data-presence'
import fixture from '../../fixtures/ml/parity.v1.json'
export const cases = () => fixture.rows.map(([amount, days, count]) => ({
  metrics: { overdueDebt: observed(amount), maxDaysOverdue: observed(days) }, debtCount: count,
  recommendationType: 'Seguimiento',
} as unknown as DebtorListItem))
export const raw = (): RawDebtorDataBundle => ({
  batch: { as_of: '2026-09-30' },
  debtors: fixture.rows.map((_, i) => ({ id: i + 1 })), debtorTypes: [],
  debts: fixture.rows.map(([amount, days], i) => ({ id: i + 1, debtor: i + 1, current_amount: amount,
    original_amount: amount, due_date: new Date(Date.parse('2026-09-30') - days * 86400000).toISOString().slice(0, 10), status: 1 })),
  debtStatuses: [{ id: 1, key: 'OVERDUE', value: 'Vencida' }], debtorPeople: [], people: [], debtorContacts: [], debtorProfiles: [], warnings: [],
})
