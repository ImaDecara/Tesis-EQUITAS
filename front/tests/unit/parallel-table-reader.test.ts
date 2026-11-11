import { createClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase-config', () => ({ hasSupabaseCredentials: true }))
import { loadAllTableRows } from '@/lib/data/paginated-table-reader'

const scope = { select: 'id,debtor,__scope:debtor!inner(tenant)', filters: [['__scope.tenant', '7']] as const, parallel: true }
type Page = { body: unknown; count?: number; status?: number }
function fixture(page: (offset: number) => Page, delay = false) {
  const calls: URL[] = []
  let running = 0
  let maximum = 0
  const client = createClient('https://parallel.example.test', 'synthetic-public-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      const url = new URL(String(input))
      calls.push(url); running += 1; maximum = Math.max(maximum, running)
      const offset = Number(url.searchParams.get('offset') ?? '0')
      const result = page(offset)
      if (delay) await new Promise(resolve => setTimeout(resolve, 2 + (offset % 3)))
      running -= 1
      return new Response(JSON.stringify(result.body), { status: result.status ?? 200,
        headers: { 'Content-Type': 'application/json', ...(result.count === undefined ? {} : { 'Content-Range': `0-1/${result.count}` }) } })
    } },
  })
  return { client, calls, maximum: () => maximum }
}

describe('páginas municipales en grupos de hasta cuatro', () => {
  it('conserva filtros, columnas, orden bigint y el límite efectivo del servidor en todas las páginas', async () => {
    const all = Array.from({ length: 23 }, (_, index) => ({ id: String(BigInt('9007199254740993') + BigInt(index)), debtor: '1', __scope: { tenant: 7 } }))
    const { client, calls, maximum } = fixture(offset => ({ body: all.slice(offset, offset + 2), count: all.length }), true)
    const result = await loadAllTableRows('debt', client, scope)
    expect(result.warning).toBeNull()
    expect(result.rows.map(row => row.id)).toEqual(all.map(row => row.id))
    expect(result.rows.every(row => !Object.hasOwn(row, '__scope'))).toBe(true)
    expect(calls).toHaveLength(12)
    expect(maximum()).toBe(4)
    expect(calls.map(url => Number(url.searchParams.get('offset'))).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, index) => index * 2))
    for (const url of calls) {
      expect(url.searchParams.get('__scope.tenant')).toBe('eq.7')
      expect(url.searchParams.get('select')).toBe(scope.select)
      expect(url.searchParams.get('order')).toBe('id.asc')
    }
  })

  it('cero filas y conteo cero termina en la primera página, sin pedir rangos fuera del total', async () => {
    const { client, calls } = fixture(() => ({ body: [], count: 0 }))
    expect(await loadAllTableRows('debt', client, scope)).toEqual({ rows: [], warning: null })
    expect(calls).toHaveLength(1)
  })

  it.each([0, 2, 8])('un error HTTP en el offset %i descarta todas las filas, incluidas las páginas correctas', async failedOffset => {
    const { client } = fixture(offset => offset === failedOffset
      ? { body: { code: '42501', message: 'permission denied' }, status: 403 }
      : { body: [{ id: offset + 1 }, { id: offset + 2 }], count: 10 })
    const result = await loadAllTableRows('debt', client, scope)
    expect(result.rows).toEqual([])
    expect(result.warning).toMatchObject({ code: '42501', needsSelectPolicy: true })
  })

  it.each([
    ['respuesta inválida inicial', () => ({ body: {}, count: 10 })],
    ['cero filas con total positivo', () => ({ body: [], count: 10 })],
    ['total menor que la primera página', () => ({ body: [{ id: 1 }, { id: 2 }], count: 1 })],
    ['total que cambió', (offset: number) => ({ body: [{ id: offset + 1 }, { id: offset + 2 }], count: offset ? 12 : 10 })],
    ['página incompleta', (offset: number) => ({ body: offset ? [{ id: 3 }] : [{ id: 1 }, { id: 2 }], count: 10 })],
    ['página no válida', (offset: number) => ({ body: offset ? null : [{ id: 1 }, { id: 2 }], count: 10 })],
    ['ids duplicados entre páginas', () => ({ body: [{ id: 1 }, { id: 2 }], count: 10 })],
    ['id ilegible', () => ({ body: [{ id: 'bad' }], count: 1 })],
  ] satisfies [string, (offset: number) => Page][])('%s: nunca entrega una cartera parcial', async (_, page) => {
    const { client } = fixture(page)
    expect(await loadAllTableRows('debt', client, scope)).toMatchObject({ rows: [], warning: { code: 'DATA_PAGINATION_INVALID' } })
  })

  it('sin conteo exacto conserva el lector por cursor', async () => {
    let iteration = 0
    const { client } = fixture(() => ({ body: iteration++ < 2 ? [{ id: 1 }] : [] }))
    expect(await loadAllTableRows('debt', client, scope)).toEqual({ rows: [{ id: 1 }], warning: null })
  })
})
