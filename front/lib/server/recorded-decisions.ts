import 'server-only'

import { cache } from 'react'

import { databaseId } from '@/lib/auth/tenant-access'
import { loadAllTableRows } from '@/lib/data/paginated-table-reader'
import { RULES_VERSION } from '@/lib/domain/decision-rules-v1'
import { isStale, recordedStatus, type RecordedDecision } from '@/lib/domain/recorded-decision'
import { DataAccessError, requireTenantAccess } from '@/lib/server/dal'
import { loadDatabaseLevel } from '@/lib/server/database-level'
import { resolvePortfolioCutoff } from '@/lib/server/portfolio-cutoff'
import type { RawRow } from '@/types/equitas-domain'

// Noche 7. Decisión vigente de cada caso del municipio, para mostrarla en el encabezado de la ficha,
// en los listados y en Pendientes. Lee con la sesión (permiso `review:read`): sin texto libre y sin
// identidades ajenas. De `reviewer` solo sale un booleano: si quien mira es quien la registró.

const REVIEW_COLUMNS = 'id,debtor,rules_version,as_of,suggested_intervention,suggested_intensity,decision,decided_intervention,decided_intensity,reviewer,reviewer_role,created_at,supersedes'
const APPROVAL_COLUMNS = 'id,case_review,decision,created_at,supersedes'
const BATCH_COLUMNS = 'id,as_of,source_updated_at,status,supersedes,publicacion_atomica:counts->publicacion_atomica'

export type RecordedDecisions =
  | { ok: true; current: { asOf: string | null; rulesVersion: string }; byDebtor: ReadonlyMap<string, RecordedDecision> }
  // FORBIDDEN: el rol no lee decisiones. UNAVAILABLE: no se pudo leer; nunca significa «sin decisiones».
  // NO_MODULE: la base no tiene el módulo de decisiones (encargo 10.2): no hay nada que leer.
  | { ok: false; reason: 'FORBIDDEN' | 'UNAVAILABLE' | 'NO_MODULE' }

function heads(rows: readonly RawRow[]): RawRow[] {
  const replaced = new Set(rows.map(row => databaseId(row.supersedes)).filter(Boolean))
  return rows.filter(row => !replaced.has(databaseId(row.id)))
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

export function buildRecordedDecisions(reviews: readonly RawRow[], approvals: readonly RawRow[], viewerUserId: string,
  current: { asOf: string | null; rulesVersion: string }): Map<string, RecordedDecision> {
  const approvalByReview = new Map(heads(approvals).map(row => [databaseId(row.case_review), row.decision]))
  const byId = new Map(reviews.map(row => [databaseId(row.id), row]))
  // Misma regla que `record_case_review_approval`: se recorre la cadena hacia atrás (los ids bajan en cada paso).
  const participatedIn = (row: RawRow) => {
    for (let current: RawRow | undefined = row, steps = 0; current && steps <= reviews.length; steps += 1) {
      if (databaseId(current.reviewer) === viewerUserId) return true
      const previous = databaseId(current.supersedes)
      current = previous && BigInt(previous) < BigInt(String(current.id)) ? byId.get(previous) : undefined
    }
    return false
  }
  const byDebtor = new Map<string, RecordedDecision>()
  // Vigente por caso = la que ninguna otra reemplaza; si hubiera más de una cadena, la más nueva.
  for (const row of heads(reviews).sort((left, right) => (BigInt(String(left.id)) < BigInt(String(right.id)) ? -1 : 1))) {
    const debtorId = databaseId(row.debtor)
    const reviewId = databaseId(row.id)
    if (!debtorId || !reviewId) continue
    const approval = approvalByReview.get(reviewId)
    const decidedIntensity = integer(row.decided_intensity)
    const basis = { asOf: String(row.as_of), rulesVersion: String(row.rules_version) }
    byDebtor.set(debtorId, {
      debtorId, reviewId,
      decision: String(row.decision),
      decidedIntervention: typeof row.decided_intervention === 'string' ? row.decided_intervention : null,
      decidedIntensity,
      suggestedIntervention: String(row.suggested_intervention),
      suggestedIntensity: integer(row.suggested_intensity),
      status: recordedStatus(decidedIntensity, approval === 'APRUEBA' || approval === 'OBJETA' ? approval : null),
      decidedAt: String(row.created_at),
      ...basis,
      reviewerRole: String(row.reviewer_role),
      mine: databaseId(row.reviewer) === viewerUserId,
      participated: participatedIn(row),
      stale: isStale(basis, current),
    })
  }
  return byDebtor
}

async function readRecordedDecisions(): Promise<RecordedDecisions> {
  try {
    const { supabase, context } = await requireTenantAccess({ permission: 'review:read' })
    const filters = [['tenant', context.tenantId]] as const
    const [reviews, approvals, batches] = await Promise.all([
      loadAllTableRows('case_review', supabase, { select: REVIEW_COLUMNS, filters }),
      loadAllTableRows('case_review_approval', supabase, { select: APPROVAL_COLUMNS, filters }),
      loadAllTableRows('import_batch', supabase, { select: BATCH_COLUMNS, filters }),
    ])
    if (await loadDatabaseLevel() === 'BASE') return { ok: false, reason: 'NO_MODULE' }
    if (reviews.warning || approvals.warning || batches.warning) return { ok: false, reason: 'UNAVAILABLE' }
    const cutoff = resolvePortfolioCutoff(
      batches.rows.map(({ publicacion_atomica, ...row }) => ({ ...row, counts: { publicacion_atomica } })), batches.warning)
    if (cutoff.warning) return { ok: false, reason: 'UNAVAILABLE' }
    const current = { asOf: cutoff.warning ? null : cutoff.batch?.as_of ?? null, rulesVersion: RULES_VERSION }
    return { ok: true, current, byDebtor: buildRecordedDecisions(reviews.rows, approvals.rows, context.appUserId, current) }
  } catch (error) {
    return { ok: false, reason: error instanceof DataAccessError && error.code === 'ROLE_FORBIDDEN' ? 'FORBIDDEN' : 'UNAVAILABLE' }
  }
}

// Una lectura por solicitud, aunque la pidan el listado, el encabezado y Pendientes.
export const loadRecordedDecisions = cache(readRecordedDecisions)
