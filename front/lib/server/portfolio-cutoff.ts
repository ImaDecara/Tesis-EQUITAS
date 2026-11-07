import 'server-only'

import { databaseId } from '@/lib/auth/tenant-access'
import { selectCurrentCutoff, type BatchEvent } from '@/lib/server/case-review-snapshot'
import { isCalendarDate } from '@/lib/reports/report-format'
import type { DataWarning, RawDebtorDataBundle, RawRow } from '@/types/equitas-domain'

type Cutoff = { batch?: RawDebtorDataBundle['batch']; key: string; warning?: DataWarning }
const statuses = new Set(['RECIBIDO', 'VALIDADO', 'CONFIRMADO', 'PUBLICADO', 'FALLIDO', 'DESCARTADO', 'REQUIERE_NUEVO_PREVIEW'])

export function unavailablePortfolioCutoff(code = 'CUTOFF_NOT_AVAILABLE'): Cutoff {
  return {
    // Presencia explícita sin fecha: el adaptador no puede recurrir al reloj.
    batch: { as_of: null }, key: code,
    warning: { table: 'import_batch', code, message: 'Corte no disponible: publicación incompleta, inválida o lectura fallida. Actualice para volver a consultar.', needsSelectPolicy: false },
  }
}

// Misma selección vigente que revisión y equitas_current_cutoff. Se valida la
// cadena antes de seleccionarla: un evento desconocido no habilita un corte viejo.
export function resolvePortfolioCutoff(rows: RawRow[], warning: DataWarning | null): Cutoff {
  if (warning) return { ...unavailablePortfolioCutoff(), warning }
  const ids = new Set(rows.map(row => databaseId(row.id)))
  if (rows.some(row => !databaseId(row.id) || !statuses.has(String(row.status)) ||
    (row.supersedes !== null && (!databaseId(row.supersedes) || !ids.has(databaseId(row.supersedes)) || BigInt(String(row.supersedes)) >= BigInt(String(row.id)))))) {
    return unavailablePortfolioCutoff('CUTOFF_INVALID')
  }
  const selected = selectCurrentCutoff(rows as BatchEvent[])
  if (!selected) {
    const mayHaveWritten = rows.some(row => row.status === 'PUBLICADO' || ((row as BatchEvent).counts?.publicacion_atomica !== 1 &&
      (['VALIDADO', 'CONFIRMADO'].includes(String(row.status)) || (row.status === 'FALLIDO' && row.supersedes !== null))))
    return mayHaveWritten ? unavailablePortfolioCutoff() : { key: 'NO_INTEGRADO' }
  }
  if (!isCalendarDate(selected.as_of) || selected.as_of.startsWith('0000')) return unavailablePortfolioCutoff('CUTOFF_INVALID')
  const batch = { as_of: selected.as_of, source_updated_at: typeof selected.source_updated_at === 'string' ? selected.source_updated_at : null }
  return { batch, key: JSON.stringify([databaseId(selected.id), batch]) }
}
