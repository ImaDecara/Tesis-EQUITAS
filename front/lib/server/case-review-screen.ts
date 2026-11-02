import 'server-only'

import { unstable_rethrow } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'

import { databaseId } from '@/lib/auth/tenant-access'
import { loadAllTableRows } from '@/lib/data/paginated-table-reader'
import {
  CASE_REVIEW_MESSAGES,
  INTENSE_FROM,
  type ApprovalDecision,
  type CaseReviewChecklist,
  type CaseReviewDecision,
  type CaseReviewSnapshot,
} from '@/lib/domain/case-review-contract'
import type {
  CaseReviewApprovalEntry,
  CaseReviewHistoryEntry,
  CaseReviewHistoryResult,
  CaseReviewScreen,
  ReasonTextView,
} from '@/lib/domain/case-review-history'
import { currentOf, getCaseReviewSnapshot } from '@/lib/server/case-review-service'
import { createCaseReviewWriter } from '@/lib/server/case-review-writer'
import { DataAccessError, requireTenantAccess, roleHasPermission, type DalContext } from '@/lib/server/dal'
import type { RawRow } from '@/types/equitas-domain'

// ALIGN-021. Qué ve cada rol en la pestaña "Revisión". La pantalla no decide permisos: los
// deriva de la tabla de la DAL, y la acción y la base los vuelven a comprobar al escribir.
// `reason_text` no se pide nunca en estas lecturas: solo sale de `read_case_review_reason_text`.

const REVIEW_COLUMNS = 'id,decision,rules_version,as_of,inputs_hash,suggested_intervention,suggested_intensity,decided_intervention,decided_intensity,reason_code,checklist,reviewer_role,created_at,supersedes'
const APPROVAL_COLUMNS = 'id,case_review,decision,reason_code,approver_role,created_at,supersedes'
const RESTRICTED_MESSAGE = 'Tu rol permite leer la cartera, pero no las revisiones de este caso.'
const HISTORY_UNAVAILABLE = 'Historial no disponible: no se pudo leer. Esto no significa que no haya decisiones.'

const asChain = (rows: readonly RawRow[]) => rows.map(row => ({ id: String(row.id), supersedes: databaseId(row.supersedes) }))
const newestFirst = <T>(rows: readonly T[]) => [...rows].reverse()

function approvalEntries(rows: readonly RawRow[]): { entries: CaseReviewApprovalEntry[]; currentId: string | null } {
  const currentId = currentOf(asChain(rows))
  const entries = rows.map(row => ({
    id: String(row.id),
    decision: row.decision as ApprovalDecision,
    reasonCode: (row.reason_code as string | null) ?? null,
    approverRole: String(row.approver_role),
    createdAt: String(row.created_at),
    isCurrent: String(row.id) === currentId,
  }))
  return { entries: newestFirst(entries), currentId }
}

function statusOf(intensity: number | null, approvals: readonly CaseReviewApprovalEntry[]): CaseReviewHistoryEntry['status'] {
  if ((intensity ?? 0) < INTENSE_FROM) return 'REGISTRADA'
  const current = approvals.find(item => item.isCurrent)
  if (!current) return 'PENDIENTE_SUPERVISOR'
  return current.decision === 'APRUEBA' ? 'APROBADA' : 'OBJETADA'
}

// Lectura explícita y por decisión: una falla deja el resto del historial a la vista.
async function readReasonText(context: DalContext, row: RawRow, allowed: boolean): Promise<ReasonTextView> {
  if (!allowed) return { state: 'HIDDEN' }
  if (row.reason_code === null || row.reason_code === undefined) return { state: 'NONE' }
  const writer = createCaseReviewWriter()
  if (!writer) return { state: 'UNAVAILABLE' }
  try {
    const { data, error } = await writer.rpc('read_case_review_reason_text', {
      p_actor_user: context.appUserId, p_tenant: context.tenantId, p_case_review: String(row.id),
    })
    if (error) return { state: 'UNAVAILABLE' }
    return typeof data === 'string' ? { state: 'VISIBLE', text: data } : { state: 'NONE' }
  } catch {
    return { state: 'UNAVAILABLE' }
  }
}

async function loadHistory(supabase: SupabaseClient, context: DalContext, rawDebtorId: string, snapshot: CaseReviewSnapshot | null, canReadReasonText: boolean): Promise<CaseReviewHistoryResult> {
  const debtorId = databaseId(rawDebtorId)
  if (!debtorId) return { ok: false, message: HISTORY_UNAVAILABLE }
  const reviews = await loadAllTableRows('case_review', supabase, { select: REVIEW_COLUMNS, filters: [['tenant', context.tenantId], ['debtor', debtorId]] })
  if (reviews.warning) return { ok: false, message: HISTORY_UNAVAILABLE }

  const currentId = currentOf(asChain(reviews.rows))
  const entries = await Promise.all(reviews.rows.map(async (row): Promise<CaseReviewHistoryEntry | null> => {
    const id = String(row.id)
    const intensity = row.decided_intensity === null || row.decided_intensity === undefined ? null : Number(row.decided_intensity)
    // Sin esta lectura no se puede afirmar "pendiente": todo el historial queda no disponible.
    const approvals = (intensity ?? 0) < INTENSE_FROM ? null : await loadAllTableRows('case_review_approval', supabase, {
      select: APPROVAL_COLUMNS, filters: [['tenant', context.tenantId], ['case_review', id]],
    })
    if (approvals?.warning) return null
    const { entries: answers, currentId: currentApprovalId } = approvalEntries(approvals?.rows ?? [])
    return {
      id,
      decision: row.decision as CaseReviewDecision,
      suggestedIntervention: String(row.suggested_intervention),
      suggestedIntensity: Number(row.suggested_intensity),
      decidedIntervention: (row.decided_intervention as string | null) ?? null,
      decidedIntensity: intensity,
      reasonCode: (row.reason_code as string | null) ?? null,
      reasonText: await readReasonText(context, row, canReadReasonText),
      checklist: (row.checklist ?? {}) as CaseReviewChecklist,
      reviewerRole: String(row.reviewer_role),
      createdAt: String(row.created_at),
      asOf: String(row.as_of),
      rulesVersion: String(row.rules_version),
      isCurrent: id === currentId,
      status: statusOf(intensity, answers),
      approvals: answers,
      currentApprovalId,
      basisChanged: snapshot !== null && (row.inputs_hash !== snapshot.inputsHash || row.rules_version !== snapshot.rulesVersion || row.as_of !== snapshot.asOf),
    }
  }))
  if (entries.includes(null)) return { ok: false, message: HISTORY_UNAVAILABLE }
  return { ok: true, entries: newestFirst(entries as CaseReviewHistoryEntry[]) }
}

export async function loadCaseReviewScreen(debtorId: string): Promise<CaseReviewScreen> {
  try {
    const { supabase, context } = await requireTenantAccess({ permission: 'review:read' })
    const canRecord = roleHasPermission(context.roleName, 'decision:record')
    const canApprove = roleHasPermission(context.roleName, 'decision:approve')
    const canReadReasonText = canRecord || canApprove
    const snapshot = await getCaseReviewSnapshot(debtorId)
    const history = await loadHistory(supabase, context, debtorId, snapshot.ok ? snapshot.snapshot : null, canReadReasonText)
    return { kind: 'ready', capabilities: { canRecord, canApprove, canReadReasonText }, snapshot, history }
  } catch (error) {
    unstable_rethrow(error)
    if (error instanceof DataAccessError && error.code === 'ROLE_FORBIDDEN') return { kind: 'restricted', message: RESTRICTED_MESSAGE }
    const message = error instanceof DataAccessError && error.code in CASE_REVIEW_MESSAGES
      ? CASE_REVIEW_MESSAGES[error.code]
      : CASE_REVIEW_MESSAGES.SUGGESTION_UNAVAILABLE
    return { kind: 'unavailable', message }
  }
}
