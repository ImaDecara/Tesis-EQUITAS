import 'server-only'

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import { loadAllTableRows } from '@/lib/data/paginated-table-reader'
import { databaseId } from '@/lib/auth/tenant-access'
import { RULES_VERSION, type Decision, type DecisionInput } from '@/lib/domain/decision-rules-v1'
import type { CaseReviewErrorCode, CaseReviewSnapshot } from '@/lib/domain/case-review-contract'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { debtorReadScope, type DebtorScopedTable } from '@/lib/server/tenant-read-scope'
import type { RawRow } from '@/types/equitas-domain'

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const byText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0

// SHA-256 de lo que evaluaron las reglas. Excluye la versión, que se compara aparte, y
// no depende del orden de lectura: `personas` no tiene id, así que ordena por contenido.
export function computeInputsHash(input: DecisionInput): string {
  const canonical = canonicalJson({
    ...input,
    obligaciones: [...input.obligaciones].sort((left, right) => byText(left.id, right.id)),
    personas: input.personas.map(person => canonicalJson(person)).sort(byText).map(text => JSON.parse(text)),
  })
  return createHash('sha256').update(canonical).digest('hex')
}

export type BatchEvent = { id: unknown; as_of: unknown; source_updated_at: unknown; status: unknown; supersedes: unknown }

// Evento vigente de un lote = ninguno lo reemplaza. El corte es el del último PUBLICADO.
// VALIDADO o CONFIRMADO pueden estar escribiendo, y FALLIDO tras uno de ellos pudo dejar
// escrituras parciales (ETL, ALIGN-026): la cartera ya no corresponde al corte anterior.
// Un FALLIDO sin antecedente, RECIBIDO y los descartes no tocaron la cartera.
export function selectCurrentCutoff(events: readonly BatchEvent[]): BatchEvent | null {
  const replaced = new Set(events.map(event => databaseId(event.supersedes)))
  const heads = events
    .filter(event => !replaced.has(databaseId(event.id)))
    .sort((left, right) => (BigInt(String(left.id)) < BigInt(String(right.id)) ? 1 : -1))
  for (const event of heads) {
    if (event.status === 'PUBLICADO') return event
    if (event.status === 'VALIDADO' || event.status === 'CONFIRMADO') return null
    if (event.status === 'FALLIDO' && event.supersedes !== null) return null
  }
  return null
}

// Sin nombres ni contactos: la decisión solo lleva códigos, puntos y la frase del contrato.
function explanationOf(decision: Decision): Record<string, unknown> {
  const { valor, banda, estado, obligaciones_no_evaluables } = decision.severidad
  return {
    regla: decision.intervencion.regla,
    modificador: decision.intervencion.modificador,
    banderas: decision.banderas,
    severidad: { valor, banda, estado, obligaciones_no_evaluables },
    revision: decision.revision,
    factores: decision.explicacion.factores,
    frase_contrastiva: decision.explicacion.frase_contrastiva,
  }
}

export type ComputedSnapshot = Omit<CaseReviewSnapshot, 'currentReviewId'>
type SnapshotResult = { ok: true; value: ComputedSnapshot } | { ok: false; code: CaseReviewErrorCode }

// Recalcula con la sesión del usuario y por objeto: las mismas reglas, el mismo adaptador
// y los mismos alcances de RLS que la pantalla. Cualquier lectura fallida detiene el
// cálculo: no hay decisión registrable sobre datos parciales.
export async function computeCaseReviewSnapshot(supabase: SupabaseClient, tenantId: string, debtorId: string): Promise<SnapshotResult> {
  const read = (table: DebtorScopedTable) => loadAllTableRows(table, supabase, debtorReadScope(table, tenantId, debtorId))
  const debtors = await read('debtor')
  if (debtors.warning) return { ok: false, code: 'SUGGESTION_UNAVAILABLE' }
  if (debtors.rows.length === 0) return { ok: false, code: 'OBJECT_NOT_IN_TENANT' }

  const batches = await loadAllTableRows('import_batch', supabase, {
    select: 'id,as_of,source_updated_at,status,supersedes', filters: [['tenant', tenantId]],
  })
  if (batches.warning) return { ok: false, code: 'SUGGESTION_UNAVAILABLE' }
  const cutoff = selectCurrentCutoff(batches.rows as unknown as BatchEvent[])
  if (!cutoff) return { ok: false, code: 'CUTOFF_NOT_AVAILABLE' }

  const [debts, debtorPeople, people, debtorContacts] = await Promise.all([
    read('debt'), read('debtor_person'), read('person'), read('debtor_contact'),
  ])
  if (debts.warning || debtorPeople.warning || people.warning || debtorContacts.warning) return { ok: false, code: 'SUGGESTION_UNAVAILABLE' }

  const mapped = mapDebtorObjectsFromRawData({
    batch: { as_of: cutoff.as_of as string | null, source_updated_at: cutoff.source_updated_at as string | null },
    debtors: debtors.rows,
    debts: debts.rows,
    debtorPeople: debtorPeople.rows,
    people: people.rows,
    debtorContacts: debtorContacts.rows,
    // La decisión no los usa: leerlos solo agregaría formas de fallar.
    debtorTypes: [] as RawRow[],
    debtStatuses: [] as RawRow[],
    debtorProfiles: [] as RawRow[],
    warnings: [],
  })
  const item = mapped.debtors.find(debtor => debtor.id === debtorId)
  const asOf = item?.decisionAsOf?.valor
  if (!item?.decision || !item.decisionInput || !asOf) return { ok: false, code: 'SUGGESTION_UNAVAILABLE' }
  return {
    ok: true,
    value: {
      debtorId,
      asOf,
      rulesVersion: RULES_VERSION,
      inputsHash: computeInputsHash(item.decisionInput),
      suggestedIntervention: item.decision.intervencion.codigo,
      suggestedIntensity: item.decision.intervencion.intensidad,
      explanation: explanationOf(item.decision),
    },
  }
}
