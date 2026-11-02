import type {
  ApprovalDecision,
  CaseReviewChecklist,
  CaseReviewDecision,
  CaseReviewSnapshotResult,
  CASE_REVIEW_STATUS_LABELS,
} from '@/lib/domain/case-review-contract'

// ALIGN-021. Lo que la pestaña "Revisión" recibe del servidor. Sin datos personales: ni
// nombres ni identificadores de usuario, solo el rol con que se decidió.

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
