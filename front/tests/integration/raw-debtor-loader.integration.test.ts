import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createServerSupabaseClientMock } = vi.hoisted(() => ({
  createServerSupabaseClientMock: vi.fn(),
}))

vi.mock('@/lib/supabase-config', () => ({
  hasSupabaseCredentials: true,
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient: createServerSupabaseClientMock,
}))

import { loadRawDebtorData } from '@/lib/data/raw-debtor-loader'

type SupabaseQueryResult = {
  data: unknown
  error: { message: string; code?: string | null } | null
}

function buildSupabaseClient(results: Record<string, SupabaseQueryResult>) {
  const from = vi.fn((table: string) => {
    const result = results[table] ?? { data: [], error: null }

    return {
      select: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(result),
      })),
    }
  })

  return { from }
}

describe('integracion simulada de lectura de objetos de deuda', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('integra filas validas de todas las consultas requeridas', async () => {
    const client = buildSupabaseClient({
      debtor: { data: [{ id: 1, external_id: 1001 }], error: null },
      debt: { data: [{ id: 11, debtor: 1 }], error: null },
    })
    createServerSupabaseClientMock.mockResolvedValue(client)

    const result = await loadRawDebtorData()

    expect(result.debtors).toEqual([{ id: 1, external_id: 1001 }])
    expect(result.debts).toEqual([{ id: 11, debtor: 1 }])
    expect(result.debtorTypes).toEqual([])
    expect(result.warnings).toEqual([])
    expect(client.from).toHaveBeenCalledTimes(8)
  })

  it('acepta respuestas vacias como listados validos sin alerta', async () => {
    const client = buildSupabaseClient({})
    createServerSupabaseClientMock.mockResolvedValue(client)

    const result = await loadRawDebtorData()

    expect(result.debtors).toEqual([])
    expect(result.debts).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('convierte un error de conexion informado por Supabase en una alerta', async () => {
    const client = buildSupabaseClient({
      debt: {
        data: null,
        error: { message: 'FetchError: network connection failed' },
      },
    })
    createServerSupabaseClientMock.mockResolvedValue(client)

    const result = await loadRawDebtorData()

    expect(result.debts).toEqual([])
    expect(result.warnings).toContainEqual({
      table: 'debt',
      message: 'FetchError: network connection failed',
      code: undefined,
      needsSelectPolicy: false,
    })
  })

  it('identifica una denegacion por RLS para solicitar policy SELECT', async () => {
    const client = buildSupabaseClient({
      debtor_profile: {
        data: null,
        error: {
          code: '42501',
          message: 'new row violates row-level security policy',
        },
      },
    })
    createServerSupabaseClientMock.mockResolvedValue(client)

    const result = await loadRawDebtorData()

    expect(result.debtorProfiles).toEqual([])
    expect(result.warnings).toContainEqual({
      table: 'debtor_profile',
      code: '42501',
      message: 'new row violates row-level security policy',
      needsSelectPolicy: true,
    })
  })
})
