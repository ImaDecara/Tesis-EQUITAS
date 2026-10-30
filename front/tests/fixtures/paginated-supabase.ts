import { vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'

import type { RawRow } from '@/types/equitas-domain'

export type DataRequest = {
  table: string
  limit: number
  offset: number
  order: string | null
  after: string | null
  select: string | null
  filters: Record<string, string>
}

type Options = {
  serverMaxRows?: number
  enforceFilters?: boolean
  fail?: (request: DataRequest) => { message: string; code?: string | null } | null
}

// El SDK real construye las consultas; solo se sustituye el transporte HTTP.
export function createPaginatedSupabase(
  tables: Record<string, RawRow[]>,
  { serverMaxRows = 1000, fail, enforceFilters = false }: Options = {}
) {
  const requests: DataRequest[] = []
  const fetchRows: typeof fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const request: DataRequest = {
      table: url.pathname.split('/').at(-1)!,
      limit: Number(url.searchParams.get('limit') ?? serverMaxRows),
      offset: Number(url.searchParams.get('offset') ?? 0),
      order: url.searchParams.get('order'),
      after: url.searchParams.get('id')?.startsWith('gt.') ? url.searchParams.get('id')!.slice(3) : null,
      select: url.searchParams.get('select'),
      filters: Object.fromEntries([...url.searchParams].filter(([, value]) => value.startsWith('eq.'))),
    }
    requests.push(request)
    const error = fail?.(request)
    if (error) {
      return new Response(JSON.stringify(error), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    let rows = [...(tables[request.table] ?? [])]
    if (enforceFilters || ['user', 'tenant_user', 'tenant', 'role'].includes(request.table)) {
      const matches = (value: unknown, path: string[], expected: string): boolean => {
        if (Array.isArray(value)) return value.some(item => matches(item, path, expected))
        if (!path.length) return String(value) === expected
        return !!value && typeof value === 'object' && matches((value as RawRow)[path[0]], path.slice(1), expected)
      }
      rows = rows.filter(row => Object.entries(request.filters).every(([path, value]) => matches(row, path.split('.'), value.slice(3))))
    }
    if (request.order === 'id.asc') {
      rows.sort((a, b) => Number(a.id) - Number(b.id))
    }
    if (request.after !== null) {
      rows = rows.filter((row) => Number(row.id) > Number(request.after))
    }
    const count = rows.length
    rows = rows.slice(request.offset, request.offset + Math.min(request.limit, serverMaxRows))
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Content-Range': `0-${Math.max(0, rows.length - 1)}/${count}` },
    })
  }

  return {
    client: createClient('https://pagination.example.test', 'synthetic-publishable-key', {
      global: { fetch: fetchRows },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }),
    requests,
  }
}

export function primaryRows(count: number): RawRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: (index + 1) * 3,
    first_name: `Persona ${String(index + 1).padStart(5, '0')}`,
    external_id: index + 1,
  }))
}

// Identidad sintetica explicita para las pruebas existentes de paginacion/mapeo.
// Se ejecuta el validador real: solo Auth y el transporte REST estan simulados.
export function createAuthorizedPaginatedSupabase(tables: Record<string, RawRow[]>, options: Options = {}) {
  const fixture = createPaginatedSupabase({
    user: [{ id: 42, auth_user: 'auth-test', status: 'ACTIVE' }],
    tenant_user: [{ id: 1, user: 42, tenant: 7, role: 3, status: true }],
    tenant: [{ id: 7, status: 'ACTIVE' }], role: [{ id: 3, name: 'consulta' }],
    ...tables,
  }, options)
  vi.spyOn(fixture.client.auth, 'getUser').mockResolvedValue({ data: { user: { id: 'auth-test' } }, error: null } as never)
  return fixture
}
