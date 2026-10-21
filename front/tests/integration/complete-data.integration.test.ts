import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createServerSupabaseClientMock } = vi.hoisted(() => ({
  createServerSupabaseClientMock: vi.fn(),
}))

vi.mock('@/lib/supabase-config', () => ({ hasSupabaseCredentials: true }))
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient: createServerSupabaseClientMock }))

import { loadRawDebtorData } from '@/lib/data/raw-debtor-loader'
import { mapDashboardMetricsFromDebtorObjects } from '@/lib/mappers/dashboard-metrics-mapper'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
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

describe('R-DAT-01: limites, fallos y relaciones de la lectura completa', () => {
  beforeEach(() => vi.clearAllMocks())

  for (const route of ['objetos', 'personas'] as const) {
    it.each([
      ['DAT-01', 0], ['DAT-02', 7], ['DAT-03', 1000], ['DAT-04', 1001], ['DAT-05', 2000],
    ] as const)(`%s / ${route}: %i filas, con pagina efectiva de 1000`, async (_caseId, count) => {
      const { rows, tables } = dataset(route, count)
      const { client, requests } = createPaginatedSupabase(tables)
      createServerSupabaseClientMock.mockResolvedValue(client)

      const result = await readRoute(route)

      expect(result.ids).toEqual(rows.map((row) => String(row.id)))
      expect(new Set(result.ids).size).toBe(count)
      expect(result.warnings).toEqual([])
      const calls = requests.filter((request) => request.table === (route === 'objetos' ? 'debtor' : 'person'))
      expect(calls).toHaveLength(Math.ceil(count / 1000) + 1)
      expect(calls.every((call) => call.order === 'id.asc')).toBe(true)
    })

    it(`DAT-06-L / ${route}: continua si el servidor devuelve solo 137 filas por consulta`, async () => {
      const { rows, tables } = dataset(route, 3507)
      const { client, requests } = createPaginatedSupabase(tables, { serverMaxRows: 137 })
      createServerSupabaseClientMock.mockResolvedValue(client)

      const result = await readRoute(route)

      expect(result.ids).toEqual(rows.map((row) => String(row.id)))
      expect(result.warnings).toEqual([])
      expect(requests.filter((request) => request.table === (route === 'objetos' ? 'debtor' : 'person')))
        .toHaveLength(Math.ceil(3507 / 137) + 1)
    })
  }

  it('DAT-07 / objetos: descarta la tabla parcial ante un error RLS en la segunda pagina', async () => {
    const { client, requests } = createPaginatedSupabase({
      debtor: [{ id: 1, external_id: 'OBJ-E03' }],
      debt: primaryRows(1200).map((row) => ({ ...row, debtor: 1, original_amount: 2 })),
    }, { fail: (request) => request.table === 'debt' && request.after !== null
      ? { message: 'permission denied for debt', code: '42501' } : null })
    createServerSupabaseClientMock.mockResolvedValue(client)

    const result = await loadRawDebtorData()

    expect(result.debts).toEqual([])
    expect(result.debtors).toEqual([{ id: 1, external_id: 'OBJ-E03' }])
    expect(result.warnings).toEqual([{ table: 'debt', message: 'permission denied for debt', code: '42501', needsSelectPolicy: true }])
    expect(requests.filter((request) => request.table === 'debt')).toHaveLength(2)
  })

  it('DAT-07 / personas: alerta y descarta detalles parciales sin perder personas completas', async () => {
    const { client } = createPaginatedSupabase({
      person: [{ id: 1, first_name: 'Persona sintetica' }],
      debtor_profile_detail: primaryRows(1200).map((row) => ({ ...row, person: 1, risk_value: 99 })),
    }, { fail: (request) => request.table === 'debtor_profile_detail' && request.after !== null
      ? { message: 'second page unavailable', code: '57014' } : null })
    createServerSupabaseClientMock.mockResolvedValue(client)

    const result = await getPeopleDataFromService()

    expect(result.people).toHaveLength(1)
    expect(result.people[0]).toMatchObject({ id: '1', riskValue: 0 })
    expect(result.warnings).toEqual([{ table: 'debtor_profile_detail', message: 'second page unavailable', code: '57014', needsSelectPolicy: false }])
  })

  it('DAT-07-T: un fallo de transporte posterior no expone el prefijo como tabla completa', async () => {
    // El SDK reintenta GET: avanzar su reloj conserva esos reintentos sin espera real.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const { client } = createPaginatedSupabase({ debtor: primaryRows(1200) }, {
        fail: (request) => {
          if (request.table === 'debtor' && request.after !== null) throw new TypeError('network disconnected')
          return null
        },
      })
      createServerSupabaseClientMock.mockResolvedValue(client)

      const pending = loadRawDebtorData()
      await vi.runAllTimersAsync()
      const result = await pending

      expect(result.debtors).toEqual([])
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toMatchObject({ table: 'debtor', needsSelectPolicy: false })
      expect(result.warnings[0].message).toContain('network disconnected')
    } finally {
      vi.useRealTimers()
    }
  })

  function relatedTables() {
    const rows = primaryRows(3507)
    return {
      debtor: [{ id: 1, external_id: 'OBJ-E03', type: 1 }],
      debtor_type: [{ id: 1, value: 'Agua' }],
      debt_status: [{ id: 1, value: 'Vigente' }],
      debt: rows.map((row) => ({ id: row.id, debtor: 1, original_amount: 2, debt_status: 1, due_date: '2099-01-01' })),
      person: rows,
      debtor_person: rows.map((row) => ({ id: row.id, debtor: 1, person: row.id, active: true })),
      debtor_contact: rows.map((row) => ({ id: row.id, person: row.id, value: `persona-${row.id}@example.test`, active: true })),
      debtor_profile: [{ id: 1, debtor: 1, socioeconomic_risk_level: 90 }],
      debtor_profile_detail: rows.map((row, index) => ({ id: row.id, person: row.id, risk_value: index === 3506 ? 99 : 25 })),
    }
  }

  it('DAT-08 / objetos: el dashboard y las relaciones incluyen deudas/personas de paginas posteriores', async () => {
    const { client } = createPaginatedSupabase(relatedTables())
    createServerSupabaseClientMock.mockResolvedValue(client)

    const raw = await loadRawDebtorData()
    const mapped = mapDebtorObjectsFromRawData(raw)
    const dashboard = mapDashboardMetricsFromDebtorObjects(mapped)

    expect(raw.warnings).toEqual([])
    expect(raw.debts).toHaveLength(3507)
    expect(mapped.debtsByDebtor.get('1')).toHaveLength(3507)
    expect(mapped.peopleByDebtor.get('1')).toHaveLength(3507)
    expect(mapped.contactsByDebtor.get('1')).toHaveLength(3507)
    expect(mapped.debtors[0]).toMatchObject({ debtCount: 3507, peopleCount: 3507, contactCount: 3507, totalDebt: 7014 })
    expect(dashboard.totalDebtors).toBe(1)
    expect(dashboard.totalDebt).toBe(7014)
  })

  it('DAT-08 / personas: materializa riesgo, contacto y deuda de la persona de la ultima pagina', async () => {
    const { client } = createPaginatedSupabase(relatedTables())
    createServerSupabaseClientMock.mockResolvedValue(client)

    const result = await getPeopleDataFromService()

    expect(result.warnings).toEqual([])
    expect(result.people).toHaveLength(3507)
    expect(result.peopleDashboard.totalPeople).toBe(3507)
    expect(result.peopleDashboard.highRiskCount).toBe(1)
    expect(result.peopleDashboard.withoutContactCount).toBe(0)
    expect(result.people[0]).toMatchObject({ id: '10521', riskValue: 99, hasContact: true, debtorsCount: 1, totalDebtAssociated: 7014, debtorIdentifiers: ['OBJ-E03'] })
  })
})
