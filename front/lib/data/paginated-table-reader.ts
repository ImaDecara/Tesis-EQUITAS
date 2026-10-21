import type { SupabaseClient } from '@supabase/supabase-js'

import { hasSupabaseCredentials } from '@/lib/supabase-config'
import type { DataWarning, RawRow } from '@/types/equitas-domain'

const PAGE_SIZE = 1000
type RowId = string | number
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
export async function loadAllTableRows(table: string, supabase: SupabaseClient | null): Promise<ReadResult> {
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
    while (true) {
      let query = supabase.from(table).select('*').order('id', { ascending: true }).limit(PAGE_SIZE)
      if (cursor !== null) query = query.gt('id', cursor)
      const response = await query
      if (response.error) return failedRead(table, response.error)

      const page = response.data ?? []
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
      rows.push(...page)
    }
  } catch (error) {
    return failedRead(table, { message: error instanceof Error ? error.message : 'Error desconocido al leer datos' })
  }
}
