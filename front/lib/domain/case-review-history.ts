import type {
  ApprovalDecision,
  CaseReviewChecklist,
  CaseReviewDecision,
  CaseReviewSnapshotResult,
  CASE_REVIEW_STATUS_LABELS,
} from '@/lib/domain/case-review-contract'

// ALIGN-021. Lo que la pestaña «Decisión» recibe del servidor. Sin datos personales: ni
// nombres ni identificadores de usuario, solo el rol con que se decidió y, por identidad, si
// quien mira es quien registró o respondió (un booleano calculado en el servidor).

export type ReasonTextView =
  | Readonly<{ state: 'VISIBLE'; text: string }>
  | Readonly<{ state: 'NONE' | 'HIDDEN' | 'UNAVAILABLE' }>

export type CaseReviewApprovalEntry = Readonly<{
  id: string
  decision: ApprovalDecision
  reasonCode: string | null
  approverRole: string
  createdAt: string
  isCurrent: boolean
  // La respuesta la registró quien está mirando.
  mine: boolean
}>

export type CaseReviewHistoryEntry = Readonly<{
  id: string
  decision: CaseReviewDecision
  suggestedIntervention: string
  suggestedIntensity: number
  decidedIntervention: string | null
  decidedIntensity: number | null
  reasonCode: string | null
  reasonText: ReasonTextView
  checklist: CaseReviewChecklist
  reviewerRole: string
  createdAt: string
  // Quien mira registró ESTA versión.
  mine: boolean
  // Quien mira registró esta versión o una anterior de su cadena de reemplazos: la base no le deja
  // aprobarla ni objetarla (APPROVER_IS_PROPONENT recorre toda la cadena).
  participated: boolean
  asOf: string
  rulesVersion: string
  isCurrent: boolean
  status: keyof typeof CASE_REVIEW_STATUS_LABELS
  approvals: readonly CaseReviewApprovalEntry[]
  currentApprovalId: string | null
  basisChanged: boolean
}>

export type CaseReviewHistoryResult =
  | Readonly<{ ok: true; entries: readonly CaseReviewHistoryEntry[] }>
  | Readonly<{ ok: false; message: string }>

export type CaseReviewCapabilities = Readonly<{ canRecord: boolean; canApprove: boolean; canReadReasonText: boolean }>

export type CaseReviewScreen =
  | Readonly<{ kind: 'restricted' | 'unavailable'; message: string }>
  | Readonly<{ kind: 'ready'; capabilities: CaseReviewCapabilities; snapshot: CaseReviewSnapshotResult; history: CaseReviewHistoryResult }>

export type ChainLink = Readonly<{ id: string; supersedes: string | null; mine: boolean }>

// Misma regla que `record_case_review_approval`: desde cada versión se recorre `supersedes` hacia
// las anteriores (los identificadores bajan en cada paso, así un ciclo no se recorre dos veces).
export function chainParticipation(links: readonly ChainLink[]): ReadonlyMap<string, boolean> {
  const byId = new Map(links.map(link => [link.id, link]))
  const result = new Map<string, boolean>()
  for (const link of links) {
    let step: ChainLink | undefined = link
    let participated = false
    while (step && !participated) {
      participated = step.mine
      const previous: ChainLink | undefined = step.supersedes === null ? undefined : byId.get(step.supersedes)
      step = previous && BigInt(previous.id) < BigInt(step.id) ? previous : undefined
    }
    result.set(link.id, participated)
  }
  return result
}
