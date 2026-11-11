import type { SupabaseClient } from '@supabase/supabase-js'

import { hasSupabaseCredentials } from '@/lib/supabase-config'
import type { DataWarning, RawRow } from '@/types/equitas-domain'

const PAGE_SIZE = 1000
type RowId = string | number
export type TableReadScope = { select: string; filters: readonly (readonly [string, string | boolean])[]; parallel?: boolean }
type ReadResult = { rows: RawRow[]; warning: DataWarning | null }

function failedRead(table: string, error: { message: string; code?: string | null }): ReadResult {
  const message = error.message || 'Error desconocido al leer datos'
  const loweredMessage = message.toLowerCase()
  return {
    rows: [],
    warning: {
      table, message, code: error.code ?? undefined,
      needsSelectPolicy: error.code === '42501' || loweredMessage.includes('permission denied') ||
        loweredMessage.includes('row-level security') || loweredMessage.includes('rls'),
    },
  }
}

function validId(id: unknown): id is RowId {
  return typeof id === 'number'
    ? Number.isSafeInteger(id)
    : typeof id === 'string' && /^-?\d+$/.test(id)
}

// Las tablas de estas rutas tienen PK bigint id. Cada request conserva la sesion/RLS.
export async function loadAllTableRows(table: string, supabase: SupabaseClient | null, scope?: TableReadScope): Promise<ReadResult> {
  if (!supabase || !hasSupabaseCredentials) {
    return {
      rows: [],
      warning: {
        table,
        message: 'Credenciales de Supabase no configuradas (NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).',
        needsSelectPolicy: false,
      },
    }
  }

  const rows: RawRow[] = []
  let cursor: RowId | null = null
  try {
    if (scope?.parallel) return await readParallelPages(table, supabase, scope)
    while (true) {
      let query = supabase.from(table).select(scope?.select ?? '*').order('id', { ascending: true }).limit(PAGE_SIZE)
      for (const [column, value] of scope?.filters ?? []) query = query.eq(column, value)
      if (cursor !== null) query = query.gt('id', cursor)
      const response = await query
      if (response.error) return failedRead(table, response.error)

      const page: unknown = response.data
      if (!Array.isArray(page)) {
        return failedRead(table, { message: 'Respuesta de pagina invalida.', code: 'DATA_PAGINATION_INVALID' })
      }
      // Una pagina corta puede ser un limite del servidor: solo una vacia marca el final.
      if (page.length === 0) return { rows, warning: null }

      for (const row of page) {
        const id: unknown = row?.id
        if (!validId(id) || (cursor !== null && BigInt(id) <= BigInt(cursor))) {
          return failedRead(table, {
            message: 'La lectura paginada no tiene una clave id valida y estrictamente creciente.',
            code: 'DATA_PAGINATION_INVALID',
          })
        }
        cursor = id
      }
      rows.push(...page.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('__')))))
    }
  } catch (error) {
    return failedRead(table, { message: error instanceof Error ? error.message : 'Error desconocido al leer datos' })
  }
}

// Solo para lecturas municipales voluminosas. La primera página informa el total y el
// tamaño efectivo (PostgREST puede imponer un máximo menor a 1000). Se leen hasta cuatro
// páginas juntas, siempre con las mismas columnas/filtros/sesión. No hay caché compartida.
async function readParallelPages(table: string, supabase: SupabaseClient, scope: TableReadScope): Promise<ReadResult> {
  const read = (offset: number, size: number) => {
    let query = supabase.from(table).select(scope.select, { count: 'exact' }).order('id', { ascending: true }).range(offset, offset + size - 1)
    for (const [column, value] of scope.filters) query = query.eq(column, value)
    return query
  }
  const invalid = () => failedRead(table, { message: 'La cartera cambió o la paginación está incompleta. Recargá la página.', code: 'DATA_PAGINATION_INVALID' })
  const first = await read(0, PAGE_SIZE)
  if (first.error) return failedRead(table, first.error)
  if (!Array.isArray(first.data)) return invalid()
  // Sin conteo exacto no se adivinan offsets: se conserva el lector por cursor.
  if (first.count === null) return loadAllTableRows(table, supabase, { ...scope, parallel: false })
  const total = first.count
  const size = first.data.length
  if (!Number.isSafeInteger(total) || total < size || (size === 0 && total !== 0)) return invalid()
  const pages = [first.data as unknown as RawRow[]]
  for (let offset = size; offset < total; offset += size * 4) {
    const offsets = Array.from({ length: Math.min(4, Math.ceil((total - offset) / size)) }, (_, index) => offset + index * size)
    const batch = await Promise.all(offsets.map(start => read(start, size)))
    for (let index = 0; index < batch.length; index += 1) {
      const page = batch[index]
      if (page.error) return failedRead(table, page.error)
      if (page.count !== total || !Array.isArray(page.data) || page.data.length !== Math.min(size, total - offsets[index])) return invalid()
      pages.push(page.data as unknown as RawRow[])
    }
  }
  let previous: RowId | null = null
  const rows: RawRow[] = []
  for (const page of pages) for (const row of page) {
    if (!validId(row?.id) || (previous !== null && BigInt(row.id) <= BigInt(previous))) return invalid()
    previous = row.id
    rows.push(Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('__'))))
  }
  return { rows, warning: null }
}
