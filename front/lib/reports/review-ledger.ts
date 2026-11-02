import { databaseId } from '@/lib/auth/tenant-access'
import { isCalendarDate, readParams, ReportFilterError } from '@/lib/reports/report-format'
import type { RawRow } from '@/types/equitas-domain'

// ALIGN-028. Decisiones y supervision leen el mismo libro, para que sus cifras coincidan.
export const REVIEW_DECISIONS = ['ACEPTA', 'MODIFICA', 'RECHAZA', 'POSPONE', 'DERIVA'] as const
export const APPROVAL_DECISIONS = ['APRUEBA', 'OBJETA'] as const
// ALIGN-003: desde intensidad 3 la decision necesita aprobacion de supervisor.
const INTENSE_FROM = 3

export type ApprovalState = 'NO_REQUERIDA' | 'PENDIENTE' | 'REEMPLAZADA' | (typeof APPROVAL_DECISIONS)[number]

export type ReviewEvent = {
  id: string
  objectId: string
  decidedAt: string
  role: string
  decision: string
  reasonCode: string | null
  suggestedIntervention: string
  suggestedIntensity: number | null
  decidedIntervention: string | null
  decidedIntensity: number | null
  supersedes: string | null
  rulesVersion: string
  cutoff: string
  current: boolean
  requiresApproval: boolean
  approval: ApprovalState
  objectionCode: string | null
}

export type ReviewFilters = { desde?: string; hasta?: string; corte?: string; decision?: string; vigente?: string }

function text(value: unknown) {
  return typeof value === 'string' && value ? value : null
}

function integer(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

// La fecha que devuelve la base puede traer otro huso: se escribe siempre en UTC.
function utcInstant(value: unknown) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(time) ? new Date(time).toISOString() : 'INVALIDO'
}

// El evento vigente es el que ningun otro reemplaza (contrato §13).
function currentRows(rows: readonly RawRow[]) {
  const replaced = new Set(rows.map(row => databaseId(row.supersedes)).filter(Boolean))
  return rows.filter(row => !replaced.has(databaseId(row.id)))
}

export function buildReviewLedger(reviews: readonly RawRow[], approvals: readonly RawRow[]): ReviewEvent[] {
  const currentReviewIds = new Set(currentRows(reviews).map(row => databaseId(row.id)))
  const approvalByReview = new Map(currentRows(approvals).map(row => [databaseId(row.case_review), row]))
  return reviews.map(row => {
    const id = String(row.id)
    const current = currentReviewIds.has(databaseId(row.id))
    const decidedIntensity = integer(row.decided_intensity)
    const requiresApproval = decidedIntensity !== null && decidedIntensity >= INTENSE_FROM
    const approval = approvalByReview.get(databaseId(row.id))
    const approvalDecision = APPROVAL_DECISIONS.find(decision => decision === approval?.decision)
    const state: ApprovalState = !requiresApproval ? 'NO_REQUERIDA' : approvalDecision ?? (current ? 'PENDIENTE' : 'REEMPLAZADA')
    return {
      id,
      objectId: databaseId(row.debtor) ?? 'NO_INTEGRADO',
      decidedAt: utcInstant(row.created_at),
      role: text(row.reviewer_role) ?? 'NO_INTEGRADO',
      decision: text(row.decision) ?? 'NO_INTEGRADO',
      reasonCode: text(row.reason_code),
      suggestedIntervention: text(row.suggested_intervention) ?? 'NO_INTEGRADO',
      suggestedIntensity: integer(row.suggested_intensity),
      decidedIntervention: text(row.decided_intervention),
      decidedIntensity,
      supersedes: databaseId(row.supersedes),
      rulesVersion: text(row.rules_version) ?? 'NO_INTEGRADO',
      cutoff: isCalendarDate(row.as_of) ? row.as_of : 'INVALIDO',
      current,
      requiresApproval,
      approval: state,
      objectionCode: approvalDecision === 'OBJETA' ? text(approval?.reason_code) : null,
    }
  })
}

const REVIEW_FILTERS = ['desde', 'hasta', 'corte', 'decision', 'vigente'] as const

export function parseReviewFilters(params: URLSearchParams, allowed: readonly (typeof REVIEW_FILTERS)[number][] = REVIEW_FILTERS): ReviewFilters {
  const filters = readParams(params, allowed)
  for (const name of ['desde', 'hasta', 'corte'] as const) {
    if (filters[name] && !isCalendarDate(filters[name])) throw new ReportFilterError(name)
  }
  if (filters.desde && filters.hasta && filters.desde > filters.hasta) throw new ReportFilterError('desde')
  if (filters.decision && !(REVIEW_DECISIONS as readonly string[]).includes(filters.decision)) throw new ReportFilterError('decision')
  if (filters.vigente && !['si', 'no'].includes(filters.vigente)) throw new ReportFilterError('vigente')
  return filters
}

// `desde` y `hasta` comparan el dia UTC de la decision, inclusive.
export function filterReviewEvents(events: readonly ReviewEvent[], filters: ReviewFilters) {
  return events.filter(event => {
    const day = event.decidedAt.slice(0, 10)
    return (!filters.desde || day >= filters.desde) &&
      (!filters.hasta || day <= filters.hasta) &&
      (!filters.corte || event.cutoff === filters.corte) &&
      (!filters.decision || event.decision === filters.decision) &&
      (!filters.vigente || event.current === (filters.vigente === 'si'))
  })
}

// Un resumen de varias filas declara el intervalo de cortes y las versiones que mezcla.
export function cutoffSpan(events: readonly ReviewEvent[]) {
  const cutoffs = [...new Set(events.map(event => event.cutoff))].sort()
  if (!cutoffs.length) return 'NO_APLICA'
  return cutoffs.length === 1 ? cutoffs[0] : `${cutoffs[0]}/${cutoffs[cutoffs.length - 1]}`
}

export function versionSet(events: readonly ReviewEvent[]) {
  const versions = [...new Set(events.map(event => event.rulesVersion))].sort()
  return versions.length ? versions.join('|') : 'NO_APLICA'
}
