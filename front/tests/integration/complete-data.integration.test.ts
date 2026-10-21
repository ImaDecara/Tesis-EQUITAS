import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createServerSupabaseClientMock } = vi.hoisted(() => ({
  createServerSupabaseClientMock: vi.fn(),
}))

vi.mock('@/lib/supabase-config', () => ({ hasSupabaseCredentials: true }))
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient: createServerSupabaseClientMock }))

import { loadRawDebtorData } from '@/lib/data/raw-debtor-loader'
import { getPeopleDataFromService } from '@/lib/services/person-data-service'
import type { RawRow } from '@/types/equitas-domain'
import { createPaginatedSupabase, primaryRows } from '../fixtures/paginated-supabase'

type Route = 'objetos' | 'personas'

function dataset(route: Route, count: number): { rows: RawRow[]; tables: Record<string, RawRow[]> } {
  const rows = primaryRows(count)
  return {
    rows,
    tables: route === 'objetos'
      ? { debtor: [...rows].reverse() }
      : {
          person: [...rows].reverse(),
          debtor_profile_detail: rows.map((row) => ({ id: row.id, person: row.id, risk_value: 10 })),
        },
  }
}

async function readRoute(route: Route) {
  if (route === 'objetos') {
    const result = await loadRawDebtorData()
    return { ids: result.debtors.map((row) => String(row.id)), warnings: result.warnings }
  }
  const result = await getPeopleDataFromService()
  return { ids: result.people.map((row) => row.id), warnings: result.warnings }
}

describe('R-DAT-01 / DEF-DAT-001: recuperacion completa antes de paginar la interfaz', () => {
  beforeEach(() => vi.clearAllMocks())

  it('FIXTURE-01: el SDK aplica limite de servidor, orden y cursor sobre HTTP simulado', async () => {
    const { client, requests } = createPaginatedSupabase({ debtor: primaryRows(8).reverse() }, { serverMaxRows: 3 })
    const limited = await client.from('debtor').select('*').limit(3000)
    const next = await client.from('debtor').select('*').order('id').gt('id', 9).limit(3)

    expect(limited.error).toBeNull()
    expect(limited.data?.map((row) => row.id)).toEqual([24, 21, 18])
    expect(next.error).toBeNull()
    expect(next.data?.map((row) => row.id)).toEqual([12, 15, 18])
    expect(requests[1]).toMatchObject({ order: 'id.asc', after: '9', limit: 3 })
  })

  for (const route of ['objetos', 'personas'] as const) {
    it.each([1000, 3000])(`DAT-06 / ${route}: recupera 3507 filas con limite efectivo %i`, async (serverMaxRows) => {
      // Arrange: conjunto completo conocido, IDs no consecutivos y orden fisico inverso.
      const { rows, tables } = dataset(route, 3507)
      const { client, requests } = createPaginatedSupabase(tables, { serverMaxRows })
      createServerSupabaseClientMock.mockResolvedValue(client)

      // Act: entrada productiva, sin sustituir el loader ni el mapper.
      const result = await readRoute(route)

      // Assert: completitud y unicidad contra el oraculo sintetico, no contra el limite pedido.
      const actual = new Set(result.ids)
      const measurement = {
        route, serverMaxRows, expected: rows.length, received: result.ids.length,
        missing: rows.filter((row) => !actual.has(String(row.id))).length,
        duplicates: result.ids.length - actual.size,
      }
      console.info('E03_DAT_06 ' + JSON.stringify(measurement))
      expect(measurement).toEqual({ route, serverMaxRows, expected: 3507, received: 3507, missing: 0, duplicates: 0 })
      expect(result.ids).toEqual(rows.map((row) => String(row.id)))
      expect(result.warnings).toEqual([])
      expect(requests.filter((request) => request.table === (route === 'objetos' ? 'debtor' : 'person'))
        .every((request) => request.order === 'id.asc')).toBe(true)
    })
  }
})
