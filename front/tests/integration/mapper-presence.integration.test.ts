import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPresencePeopleData, buildPresenceRawData } from '@/tests/helpers/equitas-fixtures'
import { createPaginatedSupabase } from '../fixtures/paginated-supabase'

const { clientMock } = vi.hoisted(() => ({ clientMock: vi.fn() }))
vi.mock('@/lib/supabase-config', () => ({ hasSupabaseCredentials: true }))
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient: clientMock }))

import { getDashboardDataFromService } from '@/lib/services/dashboard-data-service'
import { getDebtorDetailDataFromService, getDebtorsDataFromService } from '@/lib/services/debtor-data-service'

function tables() {
  const raw = buildPresenceRawData()
  return {
    debtor: raw.debtors, debtor_type: raw.debtorTypes, debt: raw.debts,
    debt_status: raw.debtStatuses, debtor_person: raw.debtorPeople,
    person: raw.people, debtor_contact: raw.debtorContacts,
    debtor_profile: [{ id: 501, debtor: 901, total_debt_amount: 0, overdue_debt_amount: 0,
      socioeconomic_risk_level: 0, available_contact_count: 99, profile_generated_at: '2026-09-30T10:00:00Z' }],
    debtor_profile_detail: buildPresencePeopleData().debtorProfilesDetail.map((row, index) => ({ ...row, id: 401 + index })),
  }
}

describe('ALIGN-011: servicios completos con transporte simulado, sin acceso externo', () => {
  beforeEach(() => vi.clearAllMocks())

  it('conserva cero, catálogo, contactos y fecha persistida hasta el detalle', async () => {
    const { client } = createPaginatedSupabase(tables())
    clientMock.mockResolvedValue(client)
    const { detail, warnings } = await getDebtorDetailDataFromService('901')
    expect(warnings).toEqual([])
    expect(detail?.debts[0]).toMatchObject({ updatedAmount: 0, status: 'OVERDUE' })
    expect(detail?.debtor).toMatchObject({ totalDebt: 0, riskScore: 0, computedAt: '2026-09-30T10:00:00Z' })
    expect(detail?.profile.availableContacts).toBe(2)
    expect(detail?.profile.totalDebt).toBe(0)
    expect(detail?.profile.antiquityDays).toBeGreaterThan(0)
    expect((await getDebtorDetailDataFromService('inexistente')).detail).toBeNull()
    expect((await getDebtorsDataFromService()).debtors).toHaveLength(1)
  })

  it('propaga un error de debt desde el lector hasta el KPI y conserva conteos independientes', async () => {
    const { client } = createPaginatedSupabase(tables(), {
      fail: request => request.table === 'debt' ? { message: 'Fallo sintético', code: '57014' } : null,
    })
    clientMock.mockResolvedValue(client)
    const result = await getDashboardDataFromService()
    expect(result.dashboard.totalDebt).toBeNull()
    expect(result.dashboard.overdueCases).toBeNull()
    expect(result.dashboard.totalDebtors).toBe(1)
    expect(result.dashboard.withContactCases).toBe(1)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].table).toBe('debt')
    const detail = await getDebtorDetailDataFromService('901')
    expect(detail.detail?.profile.antiquityDays).toBeNull()
    expect(detail.detail?.profile.debtCount).toBeNull()
  })

  it('no transforma una ausencia de detalle en banda baja al cargar el dashboard', async () => {
    const rows = tables()
    rows.debtor_profile_detail = []
    clientMock.mockResolvedValue(createPaginatedSupabase(rows).client)
    const result = await getDashboardDataFromService()
    expect(result.peopleDashboard.lowRiskCount).toBeNull()
    expect(result.peopleDashboard.totalPeople).toBe(2)
    expect(result.peopleDashboard.topPeopleByRiskValue).toEqual([])
    expect(result.warnings.some(warning => warning.table === 'debtor_profile_detail')).toBe(true)
  })
})
