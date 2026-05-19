import { hasSupabaseCredentials, supabase } from '@/lib/supabase'
import {
  RAW_DEBTOR_TABLE_LOAD_ORDER,
  type RawDebtorTableName,
} from '@/lib/data/table-names'
import type { DataWarning, RawDebtorDataBundle, RawRow } from '@/types/equitas-domain'

const TABLE_LIMIT = 3000

// Convierte un error de Supabase en una alerta uniforme para la interfaz.
function buildDataWarningFromSupabaseError(
  table: string,
  error: { message: string; code?: string | null }
): DataWarning {
  const message = error.message || 'Error desconocido al leer datos'
  const loweredMessage = message.toLowerCase()
  const code = error.code ?? undefined
  const needsSelectPolicy =
    code === '42501' ||
    loweredMessage.includes('permission denied') ||
    loweredMessage.includes('row-level security') ||
    loweredMessage.includes('rls')

  return {
    table,
    message,
    code,
    needsSelectPolicy,
  }
}

// Lee una tabla en crudo y nunca rompe: devuelve filas o alerta.
async function loadRawTableRows(table: RawDebtorTableName) {
  if (!supabase || !hasSupabaseCredentials) {
    return {
      rows: [] as RawRow[],
      warning: {
        table,
        message:
          'Credenciales de Supabase no configuradas (NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).',
        needsSelectPolicy: false,
      } satisfies DataWarning,
    }
  }

  const response = await supabase.from(table).select('*').limit(TABLE_LIMIT)

  if (response.error) {
    return {
      rows: [] as RawRow[],
      warning: buildDataWarningFromSupabaseError(table, response.error),
    }
  }

  return {
    rows: (response.data ?? []) as RawRow[],
    warning: null,
  }
}

// Punto de entrada de datos crudos para objetos de deuda.
export async function loadRawDebtorData(): Promise<RawDebtorDataBundle> {
  const results = await Promise.all(
    RAW_DEBTOR_TABLE_LOAD_ORDER.map((table) => loadRawTableRows(table))
  )
  const warnings = results
    .map((result) => result.warning)
    .filter((warning): warning is DataWarning => Boolean(warning))

  return {
    debtors: results[0]?.rows ?? [],
    debtorTypes: results[1]?.rows ?? [],
    debts: results[2]?.rows ?? [],
    debtStatuses: results[3]?.rows ?? [],
    debtorPeople: results[4]?.rows ?? [],
    people: results[5]?.rows ?? [],
    debtorContacts: results[6]?.rows ?? [],
    debtorProfiles: results[7]?.rows ?? [],
    warnings,
  }
}
