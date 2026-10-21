import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const credentials = vi.hoisted(() => ({ enabled: true }))
vi.mock('@/lib/supabase-config', () => ({ get hasSupabaseCredentials() { return credentials.enabled } }))

import { loadAllTableRows } from '@/lib/data/paginated-table-reader'

function httpPages(pages: unknown[], error?: { message: string; code?: string | null }) {
  const urls: URL[] = []
  const remaining = [...pages]
  const client = createClient('https://pagination.example.test', 'synthetic-publishable-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input) => {
      urls.push(new URL(String(input)))
      return new Response(JSON.stringify(error ?? remaining.shift() ?? []), {
        status: error ? 400 : 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } },
  })
  return { client, urls }
}

describe('R-DAT-01 / lector paginado: validacion y fallos seguros', () => {
  beforeEach(() => { credentials.enabled = true })

  it('DAT-09: no consulta sin cliente configurado', async () => {
    const result = await loadAllTableRows('debt', null)
    expect(result.rows).toEqual([])
    expect(result.warning).toMatchObject({ table: 'debt', needsSelectPolicy: false })
    expect(result.warning?.message).toContain('Credenciales')
  })

  it('DAT-09-C: no consulta con credenciales deshabilitadas', async () => {
    credentials.enabled = false
    const { client, urls } = httpPages([])
    const result = await loadAllTableRows('debt', client)
    expect(result.rows).toEqual([])
    expect(result.warning?.needsSelectPolicy).toBe(false)
    expect(urls).toEqual([])
  })

  it('DAT-10: preserva cursores bigint representados como texto sin perder precision', async () => {
    const first = '9007199254740993'
    const second = '9007199254740994'
    const { client, urls } = httpPages([[{ id: first }], [{ id: second }], []])

    const result = await loadAllTableRows('debt', client)

    expect(result).toEqual({ rows: [{ id: first }, { id: second }], warning: null })
    expect(urls[1].searchParams.get('id')).toBe(`gt.${first}`)
    expect(urls[2].searchParams.get('id')).toBe(`gt.${second}`)
  })

  it.each([undefined, null, true, 'invalid', 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'DAT-11: rechaza clave id invalida %s sin publicar filas parciales', async (id) => {
      const { client, urls } = httpPages([[{ id }]])
      const result = await loadAllTableRows('debt', client)
      expect(result.rows).toEqual([])
      expect(result.warning).toMatchObject({ table: 'debt', code: 'DATA_PAGINATION_INVALID', needsSelectPolicy: false })
      expect(urls).toHaveLength(1)
    }
  )

  it.each([
    [[{ id: 1 }], [{ id: 1 }]],
    [[{ id: 2 }, { id: 1 }]],
    [[{ id: 1 }, { id: 1 }]],
  ])('DAT-12: detiene un cursor repetido, filas desordenadas o duplicadas', async (...pages) => {
    const { client, urls } = httpPages(pages)
    const result = await loadAllTableRows('debt', client)
    expect(result.rows).toEqual([])
    expect(result.warning?.code).toBe('DATA_PAGINATION_INVALID')
    expect(urls.length).toBeLessThanOrEqual(2)
  })

  it('DAT-13: rechaza una pagina que no sea un array', async () => {
    const { client } = httpPages([{ id: 1 }])
    const result = await loadAllTableRows('debt', client)
    expect(result.rows).toEqual([])
    expect(result.warning?.code).toBe('DATA_PAGINATION_INVALID')
  })

  it.each([
    [{ message: 'denied', code: '42501' }, true],
    [{ message: 'permission denied' }, true],
    [{ message: 'row-level security rejected' }, true],
    [{ message: 'RLS rejected' }, true],
    [{ message: '', code: null }, false],
  ] as const)('DAT-14: conserva el contrato de advertencia %j', async (error, needsSelectPolicy) => {
    const { client } = httpPages([], error)
    const result = await loadAllTableRows('debt', client)
    expect(result.rows).toEqual([])
    expect(result.warning).toMatchObject({ table: 'debt', needsSelectPolicy })
    expect(result.warning?.message).toBe(error.message || 'Error desconocido al leer datos')
  })

  it.each([new Error('connection interrupted'), 'opaque rejection'])('DAT-07-C: convierte una excepcion del cliente en alerta', async (error) => {
    const client = { from: () => { throw error } } as unknown as SupabaseClient
    const result = await loadAllTableRows('debt', client)
    expect(result.rows).toEqual([])
    expect(result.warning).toMatchObject({ table: 'debt', needsSelectPolicy: false })
    expect(result.warning?.message).toBe(error instanceof Error ? error.message : 'Error desconocido al leer datos')
  })
})
