import { databaseId } from '@/lib/auth/tenant-access'
import { RAW_DEBTOR_TABLE_LOAD_ORDER } from '@/lib/data/table-names'
import { createTenantReader } from '@/lib/server/dal'
import { levelAfter } from '@/lib/server/database-level'
import { resolvePortfolioCutoff, unavailablePortfolioCutoff } from '@/lib/server/portfolio-cutoff'
import type { DataWarning, RawDebtorDataBundle } from '@/types/equitas-domain'

type Reader = Awaited<ReturnType<typeof createTenantReader>>
type Read = Awaited<ReturnType<Reader['readTable']>>

// Lee la cartera entre dos lecturas del corte: detecta una importación intercalada, incluso con la misma fecha.
async function withCutoff(reader: Reader, readPortfolio: () => Promise<Read[]>) {
  const initial = await reader.readImportBatches()
  // Noche 7 (encargo 10.2): una base sin el módulo no registra fecha de corte. No es una lectura fallida:
  // la cartera se calcula con la fecha del día (el adaptador ya tiene ese camino) y la pantalla lo dice.
  const base = await levelAfter(initial.warning) === 'BASE'
  const before = base ? { key: 'SIN_FECHA_REGISTRADA' } : resolvePortfolioCutoff(initial.rows, initial.warning)
  const results = await readPortfolio()
  let cutoff: ReturnType<typeof resolvePortfolioCutoff> = before
  if (!base) {
    const final = await reader.readImportBatches()
    const after = resolvePortfolioCutoff(final.rows, final.warning)
    // No es una transacción MVCC entre peticiones; las escrituras de revisión
    // mantienen su verificación transaccional de corte en la base.
    cutoff = before.warning ? before : after.warning ? after : before.key === after.key ? after : unavailablePortfolioCutoff('CUTOFF_CHANGED')
  }
  const warnings = results
    .map((result) => result.warning)
    .filter((warning): warning is DataWarning => Boolean(warning))
  if (cutoff.warning) warnings.push(cutoff.warning)
  return { cutoff, results, warnings }
}

function bundle({ cutoff, results, warnings }: Awaited<ReturnType<typeof withCutoff>>): RawDebtorDataBundle {
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

/**
 * Punto de entrada de datos crudos para objetos de deuda.
 *
 * Con `debtorId` devuelve los datos de ESE caso (noche 7, encargo 10.6): la ficha ya no lee toda la cartera.
 * Primero se leen los casos del municipio y se busca ahí el pedido: el identificador de la URL nunca filtra
 * una consulta. Con la fila encontrada, las obligaciones, personas, contactos y perfil se leen solo para ese
 * caso, con los mismos alcances que la lectura completa. Si el caso no está en el municipio no se lee nada más.
 */
export async function loadRawDebtorData(debtorId?: string): Promise<RawDebtorDataBundle> {
  const reader = await createTenantReader()
  if (debtorId === undefined) {
    return bundle(await withCutoff(reader, () => Promise.all(RAW_DEBTOR_TABLE_LOAD_ORDER.map((table) => reader.readTable(table)))))
  }
  return bundle(await withCutoff(reader, async () => {
    const debtors = await reader.readTable('debtor')
    const row = debtors.rows.find(candidate => databaseId(candidate.id) === debtorId)
    const canonicalId = databaseId(row?.id)
    if (debtors.warning || !row || !canonicalId) return [debtors]
    const rest = await Promise.all(RAW_DEBTOR_TABLE_LOAD_ORDER.slice(1).map((table) => reader.readTable(table, canonicalId)))
    return [{ rows: [row], warning: null }, ...rest]
  }))
}
