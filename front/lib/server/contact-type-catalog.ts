import { loadAllTableRows } from '@/lib/data/paginated-table-reader'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import type { DataWarning, RawRow } from '@/types/equitas-domain'

const CONTACT_TYPE_TABLE = 'contact_type'

// Catálogo compartido que solo necesita el detalle. Se lee después de la lectura
// autorizada de la cartera, con la sesión de la solicitud y sus políticas RLS.
// Una falla queda como aviso: el canal se muestra "No disponible", sin romper la ficha.
export async function loadContactTypeCatalog(): Promise<{ rows: RawRow[]; warning: DataWarning | null }> {
  try {
    return await loadAllTableRows(CONTACT_TYPE_TABLE, await createServerSupabaseClient())
  } catch (error) {
    return {
      rows: [],
      warning: {
        table: CONTACT_TYPE_TABLE,
        message: error instanceof Error ? error.message : 'Error desconocido al leer datos',
        needsSelectPolicy: false,
      },
    }
  }
}
