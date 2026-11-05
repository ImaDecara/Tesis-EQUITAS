import { RAW_DEBTOR_TABLE_LOAD_ORDER } from '@/lib/data/table-names'
import { createTenantReader } from '@/lib/server/dal'
import { resolvePortfolioCutoff, unavailablePortfolioCutoff } from '@/lib/server/portfolio-cutoff'
import type { DataWarning, RawDebtorDataBundle } from '@/types/equitas-domain'

// Punto de entrada de datos crudos para objetos de deuda.
export async function loadRawDebtorData(): Promise<RawDebtorDataBundle> {
  const reader = await createTenantReader()
  const initial = await reader.readImportBatches()
  const before = resolvePortfolioCutoff(initial.rows, initial.warning)
  const results = await Promise.all(
    RAW_DEBTOR_TABLE_LOAD_ORDER.map((table) => reader.readTable(table))
  )
  const final = await reader.readImportBatches()
  const after = resolvePortfolioCutoff(final.rows, final.warning)
  // Detecta una importación intercalada, incluso con la misma fecha as_of.
  // No es una transacción MVCC entre peticiones; las escrituras de revisión
  // mantienen su verificación transaccional de corte en la base.
  const cutoff = before.warning ? before : after.warning ? after : before.key === after.key ? after : unavailablePortfolioCutoff('CUTOFF_CHANGED')
  const warnings = results
    .map((result) => result.warning)
    .filter((warning): warning is DataWarning => Boolean(warning))
  if (cutoff.warning) warnings.push(cutoff.warning)

  return {
    ...(cutoff.batch ? { batch: cutoff.batch } : {}),
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
