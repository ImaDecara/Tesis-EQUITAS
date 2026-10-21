import { createClient } from '@supabase/supabase-js'

import type { RawRow } from '@/types/equitas-domain'

export type DataRequest = {
  table: string
  limit: number
  offset: number
  order: string | null
  after: string | null
}

type Options = {
  serverMaxRows?: number
  fail?: (request: DataRequest) => { message: string; code?: string | null } | null
}

// El SDK real construye las consultas; solo se sustituye el transporte HTTP.
export function createPaginatedSupabase(
  tables: Record<string, RawRow[]>,
  { serverMaxRows = 1000, fail }: Options = {}
) {
  const requests: DataRequest[] = []
  const fetchRows: typeof fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const request: DataRequest = {
      table: url.pathname.split('/').at(-1)!,
      limit: Number(url.searchParams.get('limit') ?? serverMaxRows),
      offset: Number(url.searchParams.get('offset') ?? 0),
      order: url.searchParams.get('order'),
      after: url.searchParams.get('id')?.replace(/^gt\./, '') ?? null,
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
    if (request.order === 'id.asc') {
      rows.sort((a, b) => Number(a.id) - Number(b.id))
    }
    if (request.after !== null) {
      rows = rows.filter((row) => Number(row.id) > Number(request.after))
    }
    rows = rows.slice(request.offset, request.offset + Math.min(request.limit, serverMaxRows))
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
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
