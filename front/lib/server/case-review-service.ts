import 'server-only'

import { createHash } from 'node:crypto'
import { unstable_rethrow } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'

import { databaseId } from '@/lib/auth/tenant-access'
import { loadAllTableRows } from '@/lib/data/paginated-table-reader'
import {
  caseReviewFailure,
  INTENSE_FROM,
  parseApproveCaseDecisionInput,
  parseRecordCaseDecisionInput,
  type ApproveCaseDecisionInput,
  type ApproveCaseDecisionResult,
  type CaseReviewErrorCode,
  type CaseReviewFailure,
  type CaseReviewSnapshotResult,
  type ExpectedSuggestion,
  type RecordCaseDecisionInput,
  type RecordCaseDecisionResult,
  type SnapshotChange,
} from '@/lib/domain/case-review-contract'
import { computeCaseReviewSnapshot, type ComputedSnapshot } from '@/lib/server/case-review-snapshot'
import { createCaseReviewWriter } from '@/lib/server/case-review-writer'
import { DataAccessError, requireTenantAccess, type DalContext } from '@/lib/server/dal'

// ALIGN-020. Verifica con la sesión (DAL), recalcula en servidor y escribe solo por las
// funciones de ALIGN-018 con la credencial server-only. Devuelve códigos, nunca excepciones:
// Next oculta los mensajes de error en producción y la pantalla necesita saber qué pasó.

async function failClosed<T>(run: () => Promise<T | CaseReviewFailure>, unexpected: CaseReviewErrorCode = 'WRITE_UNAVAILABLE'): Promise<T | CaseReviewFailure> {
  try {
    return await run()
  } catch (error) {
    // Los errores de control de Next (por ejemplo, al detectar uso dinámico) no son fallas.
    unstable_rethrow(error)
    return caseReviewFailure(error instanceof DataAccessError ? error.code : unexpected)
  }
}

function changesBetween(expected: ExpectedSuggestion, current: ComputedSnapshot): SnapshotChange[] {
  const changes: SnapshotChange[] = []
  if (expected.inputsHash !== current.inputsHash) changes.push('INSUMOS')
  if (expected.rulesVersion !== current.rulesVersion) changes.push('VERSION')
  if (expected.asOf !== current.asOf) changes.push('CORTE')
  return changes
}

function outdated(changed: SnapshotChange[], current: ComputedSnapshot, currentReviewId: string | null): CaseReviewFailure {
  return { ...caseReviewFailure('SUGGESTION_OUTDATED'), changed, current: { ...current, currentReviewId } }
}

type ChainRow = { id: string; supersedes: string | null; idempotencyKey: unknown }

// `case_review` y `case_review_approval`: columnas explícitas (reason_text queda afuera).
async function readChain(supabase: SupabaseClient, table: string, filters: readonly (readonly [string, string])[]): Promise<ChainRow[] | null> {
  const result = await loadAllTableRows(table, supabase, { select: 'id,supersedes,idempotency_key', filters })
  if (result.warning) return null
  return result.rows.map(row => ({ id: String(row.id), supersedes: databaseId(row.supersedes), idempotencyKey: row.idempotency_key }))
}

// Vigente = la que ninguna otra reemplaza. Por esta vía la cadena es lineal; si otra
// carga dejó dos, manda la más nueva. Las filas llegan ordenadas por id.
function currentOf(chain: readonly ChainRow[]): string | null {
  const replaced = new Set(chain.map(row => row.supersedes))
  return chain.filter(row => !replaced.has(row.id)).at(-1)?.id ?? null
}

// La clave nace del antecedente, no del contenido ni del navegador: para cada decisión
// vigente solo cabe una sucesora. La función de ALIGN-018 compara bajo su bloqueo: mismo
// contenido → devuelve la fila (doble envío); otro contenido → IDEMPOTENCY_KEY_CONFLICT.
// Así dos envíos distintos y simultáneos tampoco abren dos cadenas sobre un objeto.
function deriveIdempotencyKey(...parts: readonly (string | null)[]): string {
  const hex = createHash('sha256').update(JSON.stringify(['equitas/idempotency/v1', ...parts])).digest('hex')
  const variant = ((parseInt(hex[16], 16) & 3) | 8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

const FUNCTION_REJECTIONS: Readonly<Record<string, CaseReviewErrorCode>> = {
  ACTOR_NOT_ACTIVE_MEMBER: 'ACTOR_NOT_ACTIVE_MEMBER',
  ROLE_NOT_ALLOWED: 'ROLE_FORBIDDEN',
  OBJECT_NOT_IN_TENANT: 'OBJECT_NOT_IN_TENANT',
  REVIEW_NOT_IN_TENANT: 'REVIEW_NOT_IN_TENANT',
  SUPERSEDES_NOT_FOUND: 'SUPERSEDES_NOT_FOUND',
  SUPERSEDES_CHAIN_INVALID: 'SUPERSEDES_CHAIN_INVALID',
  APPROVER_IS_PROPONENT: 'APPROVER_IS_PROPONENT',
  APPROVAL_NOT_REQUIRED: 'APPROVAL_NOT_REQUIRED',
  REVIEW_SUPERSEDED: 'REVIEW_SUPERSEDED',
  'INVALID_CASE_REVIEW:case_review_reason_text_not_blank': 'REASON_TEXT_BLANK',
  'INVALID_CASE_REVIEW:case_review_reason_text_length': 'REASON_TEXT_TOO_LONG',
  'INVALID_CASE_REVIEW:case_review_reason_text_requires_code': 'REASON_REQUIRED',
  'INVALID_CASE_REVIEW:case_review_decision_requires_reason': 'REASON_REQUIRED',
  'INVALID_CASE_REVIEW:case_review_intense_requires_checklist': 'CHECKLIST_REQUIRED',
  'INVALID_CASE_REVIEW:case_review_checklist_shape': 'CHECKLIST_INVALID',
  'INVALID_CASE_REVIEW:case_review_modifica_changes_suggestion': 'MODIFICA_WITHOUT_CHANGE',
  'INVALID_CASE_REVIEW:case_review_supersedes_key': 'REVIEW_CONFLICT',
  'INVALID_CASE_REVIEW:case_review_supersedes_anterior': 'SUPERSEDES_NOT_FOUND',
  'INVALID_CASE_REVIEW:case_review_supersedes_fkey': 'SUPERSEDES_NOT_FOUND',
  'INVALID_CASE_REVIEW_APPROVAL:case_review_approval_single_head': 'APPROVAL_CONFLICT',
  'INVALID_CASE_REVIEW_APPROVAL:case_review_approval_supersedes_key': 'APPROVAL_CONFLICT',
  'INVALID_CASE_REVIEW_APPROVAL:case_review_approval_requires_checklist': 'CHECKLIST_REQUIRED',
  'INVALID_CASE_REVIEW_APPROVAL:case_review_approval_objection_requires_reason': 'REASON_REQUIRED',
  'INVALID_CASE_REVIEW_APPROVAL:case_review_checklist_shape': 'CHECKLIST_INVALID',
}

// El mensaje de la función es estable y sin valores, pero se traduce igual: lo que no
// esté en la tabla no sale. Una falla que no sea un rechazo de negocio es de infraestructura.
function functionFailure(error: { message?: string; code?: string }, keyConflict: CaseReviewErrorCode): CaseReviewFailure {
  const message = error.message ?? ''
  if (message === 'IDEMPOTENCY_KEY_CONFLICT') return caseReviewFailure(keyConflict)
  if (Object.hasOwn(FUNCTION_REJECTIONS, message)) return caseReviewFailure(FUNCTION_REJECTIONS[message])
  return caseReviewFailure(error.code === 'P0001' ? 'WRITE_REJECTED' : 'WRITE_UNAVAILABLE')
}

export async function getCaseReviewSnapshot(rawDebtorId: string): Promise<CaseReviewSnapshotResult> {
  return failClosed(async () => {
    const { supabase, context } = await requireTenantAccess()
    const debtorId = databaseId(rawDebtorId)
    if (!debtorId) return caseReviewFailure('INVALID_INPUT')
    const computed = await computeCaseReviewSnapshot(supabase, context.tenantId, debtorId)
    if (!computed.ok) return caseReviewFailure(computed.code)
    const chain = await readChain(supabase, 'case_review', [['tenant', context.tenantId], ['debtor', debtorId]])
    if (!chain) return caseReviewFailure('SUGGESTION_UNAVAILABLE')
    return { ok: true, snapshot: { ...computed.value, currentReviewId: currentOf(chain) } } as const
  }, 'SUGGESTION_UNAVAILABLE')
}

async function insertDecision(context: DalContext, input: RecordCaseDecisionInput, snapshot: ComputedSnapshot, idempotencyKey: string): Promise<RecordCaseDecisionResult> {
  const writer = createCaseReviewWriter()
  if (!writer) return caseReviewFailure('WRITE_NOT_CONFIGURED')
  const decided = input.decision === 'ACEPTA'
    ? { intervention: snapshot.suggestedIntervention, intensity: snapshot.suggestedIntensity }
    : input.decided
  const { data, error } = await writer.rpc('record_case_review', {
    p_reviewer_user: context.appUserId,
    p_tenant: context.tenantId,
    p_debtor: input.debtorId,
    p_rules_version: snapshot.rulesVersion,
    p_as_of: snapshot.asOf,
    p_inputs_hash: snapshot.inputsHash,
    p_suggested_intervention: snapshot.suggestedIntervention,
    p_suggested_intensity: snapshot.suggestedIntensity,
    p_explanation: snapshot.explanation,
    p_decision: input.decision,
    p_idempotency_key: idempotencyKey,
    p_decided_intervention: decided?.intervention ?? null,
    p_decided_intensity: decided?.intensity ?? null,
    p_reason_code: input.reasonCode,
    p_reason_text: input.reasonText,
    p_checklist: input.checklist,
    p_supersedes: input.supersedes,
  })
  if (error) return functionFailure(error, 'REVIEW_CONFLICT')
  const reviewId = databaseId(data?.review_id)
  if (!reviewId || typeof data.created !== 'boolean' || typeof data.pending_supervisor !== 'boolean') {
    return caseReviewFailure('WRITE_UNAVAILABLE')
  }
  return {
    ok: true,
    reviewId,
    debtorId: input.debtorId,
    created: data.created,
    status: data.pending_supervisor ? 'PENDIENTE_SUPERVISOR' : 'REGISTRADA',
    asOf: snapshot.asOf,
    rulesVersion: snapshot.rulesVersion,
    inputsHash: snapshot.inputsHash,
    suggestedIntervention: snapshot.suggestedIntervention,
    suggestedIntensity: snapshot.suggestedIntensity,
  }
}

export async function recordCaseDecisionInSession(raw: unknown): Promise<RecordCaseDecisionResult> {
  return failClosed<RecordCaseDecisionResult>(async () => {
    const { supabase, context } = await requireTenantAccess({ permission: 'decision:record' })
    const parsed = parseRecordCaseDecisionInput(raw)
    if (!parsed.ok) return caseReviewFailure(parsed.code)
    const input = parsed.value

    const computed = await computeCaseReviewSnapshot(supabase, context.tenantId, input.debtorId)
    if (!computed.ok) return caseReviewFailure(computed.code)
    const snapshot = computed.value
    const chain = await readChain(supabase, 'case_review', [['tenant', context.tenantId], ['debtor', input.debtorId]])
    if (!chain) return caseReviewFailure('SUGGESTION_UNAVAILABLE')

    const changes = changesBetween(input.expected, snapshot)
    if (changes.length > 0) return outdated(changes, snapshot, currentOf(chain))
    if (input.decision === 'MODIFICA' && input.decided?.intervention === snapshot.suggestedIntervention &&
        input.decided.intensity === snapshot.suggestedIntensity) {
      return caseReviewFailure('MODIFICA_WITHOUT_CHANGE')
    }

    const idempotencyKey = deriveIdempotencyKey('case_review', context.tenantId, input.debtorId, input.supersedes)
    // Si esa clave ya existe decide la función (doble envío o conflicto), sin importar qué rige hoy.
    const alreadySent = chain.some(row => row.idempotencyKey === idempotencyKey)
    if (!alreadySent && currentOf(chain) !== input.supersedes) return caseReviewFailure('REVIEW_CONFLICT')
    return insertDecision(context, input, snapshot, idempotencyKey)
  })
}

async function insertApproval(context: DalContext, input: ApproveCaseDecisionInput, debtorId: string, idempotencyKey: string): Promise<ApproveCaseDecisionResult> {
  const writer = createCaseReviewWriter()
  if (!writer) return caseReviewFailure('WRITE_NOT_CONFIGURED')
  const { data, error } = await writer.rpc('record_case_review_approval', {
    p_approver_user: context.appUserId,
    p_tenant: context.tenantId,
    p_case_review: input.caseReviewId,
    p_decision: input.decision,
    p_idempotency_key: idempotencyKey,
    p_reason_code: input.reasonCode,
    p_checklist: input.checklist,
    p_supersedes: input.supersedes,
  })
  if (error) return functionFailure(error, 'APPROVAL_CONFLICT')
  const approvalId = databaseId(data?.approval_id)
  if (!approvalId || typeof data.created !== 'boolean') return caseReviewFailure('WRITE_UNAVAILABLE')
  return {
    ok: true,
    approvalId,
    caseReviewId: input.caseReviewId,
    debtorId,
    created: data.created,
    status: input.decision === 'APRUEBA' ? 'APROBADA' : 'OBJETADA',
  }
}

export async function approveCaseDecisionInSession(raw: unknown): Promise<ApproveCaseDecisionResult> {
  return failClosed<ApproveCaseDecisionResult>(async () => {
    const { supabase, context } = await requireTenantAccess({ permission: 'decision:approve' })
    const parsed = parseApproveCaseDecisionInput(raw)
    if (!parsed.ok) return caseReviewFailure(parsed.code)
    const input = parsed.value

    const stored = await loadAllTableRows('case_review', supabase, {
      select: 'id,debtor,rules_version,as_of,inputs_hash,decided_intensity',
      filters: [['tenant', context.tenantId], ['id', input.caseReviewId]],
    })
    if (stored.warning) return caseReviewFailure('SUGGESTION_UNAVAILABLE')
    const review = stored.rows[0]
    const debtorId = databaseId(review?.debtor)
    if (!review || !debtorId) return caseReviewFailure('REVIEW_NOT_IN_TENANT')
    if (Number(review.decided_intensity ?? 0) < INTENSE_FROM) return caseReviewFailure('APPROVAL_NOT_REQUIRED')

    const [chain, approvals] = await Promise.all([
      readChain(supabase, 'case_review', [['tenant', context.tenantId], ['debtor', debtorId]]),
      readChain(supabase, 'case_review_approval', [['tenant', context.tenantId], ['case_review', input.caseReviewId]]),
    ])
    if (!chain || !approvals) return caseReviewFailure('SUGGESTION_UNAVAILABLE')

    // Una objeción frena la propuesta y no confirma nada: sigue disponible aunque los
    // datos cambien o falte el corte, para poder cerrarla. Aprobar exige que sean los mismos.
    if (input.decision === 'APRUEBA') {
      const computed = await computeCaseReviewSnapshot(supabase, context.tenantId, debtorId)
      if (!computed.ok) return caseReviewFailure(computed.code)
      const changes = changesBetween({
        asOf: String(review.as_of), rulesVersion: String(review.rules_version), inputsHash: String(review.inputs_hash),
      }, computed.value)
      if (changes.length > 0) return outdated(changes, computed.value, currentOf(chain))
    }

    const idempotencyKey = deriveIdempotencyKey('case_review_approval', context.tenantId, input.caseReviewId, input.supersedes)
    if (!approvals.some(row => row.idempotencyKey === idempotencyKey)) {
      if (currentOf(chain) !== input.caseReviewId) return caseReviewFailure('REVIEW_SUPERSEDED')
      if (currentOf(approvals) !== input.supersedes) return caseReviewFailure('APPROVAL_CONFLICT')
    }
    return insertApproval(context, input, debtorId, idempotencyKey)
  })
}
