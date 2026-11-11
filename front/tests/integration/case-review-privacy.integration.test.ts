import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase-config', () => ({ hasSupabaseCredentials: true }))

import { computeCaseReviewSnapshot } from '@/lib/server/case-review-snapshot'
import { createPaginatedSupabase } from '../fixtures/paginated-supabase'

function fixture(options: Parameters<typeof createPaginatedSupabase>[1] = {}) {
  return createPaginatedSupabase({
    debtor: [{ id: 99, tenant: 7 }, { id: 100, tenant: 7 }, { id: 199, tenant: 8 }],
    import_batch: [{ id: 1, tenant: 7, status: 'PUBLICADO', as_of: '2026-10-30', supersedes: null }],
    debt: [{ id: 1, debtor: 100, current_amount: 100, due_date: '2026-09-01', __scope: { tenant: 7 } }],
  }, { enforceFilters: true, ...options })
}

describe('privacidad: objeto recibido de la accion se resuelve dentro del municipio', () => {
  it.each(['880020050000013', '199', '0100', '0', '100otro'])('rechaza %j sin enviarlo a PostgREST', async input => {
    const { client, requests } = fixture({ serverMaxRows: 1 })
    expect(await computeCaseReviewSnapshot(client, '7', input)).toEqual({ ok: false, code: 'OBJECT_NOT_IN_TENANT' })
    expect(requests.every(request => Object.values(request.filters).every(value => value !== `eq.${input}`))).toBe(true)
    expect(requests.every(request => request.table === 'debtor' && request.filters.tenant === 'eq.7')).toBe(true)
  })

  it('pagina la cartera del municipio, luego filtra relaciones por el id canonico verificado', async () => {
    const { client, requests } = fixture({ serverMaxRows: 1 })
    expect(await computeCaseReviewSnapshot(client, '7', '100')).toMatchObject({ ok: true, value: { debtorId: '100' } })
    const objectReads = requests.filter(request => request.table === 'debtor')
    expect(objectReads).toHaveLength(3)
    expect(objectReads.every(request => request.filters.id === undefined && request.filters.tenant === 'eq.7')).toBe(true)
    const debts = requests.filter(request => request.table === 'debt')
    expect(debts.length).toBeGreaterThan(0)
    expect(debts.every(request => request.filters.debtor === 'eq.100' && request.filters['__scope.tenant'] === 'eq.7')).toBe(true)
  })

  it('un fallo de pagina posterior no permite calcular con un prefijo de la cartera', async () => {
    const { client, requests } = fixture({ serverMaxRows: 1, fail: request => request.table === 'debtor' && request.after !== null ? { code: '42501', message: 'synthetic' } : null })
    expect(await computeCaseReviewSnapshot(client, '7', '99')).toEqual({ ok: false, code: 'SUGGESTION_UNAVAILABLE' })
    expect(requests.every(request => request.table === 'debtor')).toBe(true)
  })
})
