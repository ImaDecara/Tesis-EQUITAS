import { loadAllTableRows } from '@/lib/data/paginated-table-reader'
import { RAW_DEBTOR_TABLE_LOAD_ORDER } from '@/lib/data/table-names'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import type { DataWarning, RawDebtorDataBundle } from '@/types/equitas-domain'

// Punto de entrada de datos crudos para objetos de deuda.
export async function loadRawDebtorData(): Promise<RawDebtorDataBundle> {
  const supabase = await createServerSupabaseClient()
  const results = await Promise.all(
    RAW_DEBTOR_TABLE_LOAD_ORDER.map((table) => loadAllTableRows(table, supabase))
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
