import { Badge } from '@/components/ui/badge'
import { scoreView } from '@/components/portfolio/portfolio-text'
import { reviewActionLabel } from '@/lib/domain/case-review-form'
import { RECORDED_STATUS_LABELS, STALE_LABEL, type RecordedDecision } from '@/lib/domain/recorded-decision'
import type { RecordedDecisions } from '@/lib/server/recorded-decisions'
import { formatDateTime } from '@/lib/utils'
import type { DebtorListItem } from '@/types/equitas-domain'

// Noche 7. Celdas que se repiten en el listado de casos, los grupos de trabajo y los casos sin
// contacto: el puntaje de prioridad (un solo concepto) y la decisión registrada con su estado.

const BAND_VARIANT = { ALTA: 'danger', MEDIA: 'warning', BAJA: 'success' } as const

export function PriorityScoreBadge({ debtor }: { debtor: Pick<DebtorListItem, 'decision'> }) {
  const view = scoreView(debtor)
  return <Badge variant={view.band ? BAND_VARIANT[view.band] : 'neutral'} className="whitespace-normal text-left" data-score>{view.text}</Badge>
}

export type DecisionView =
  | { kind: 'NONE' }
  | { kind: 'UNAVAILABLE' }
  | { kind: 'RECORDED'; status: string; action: string; when: string; stale: boolean }

function actionLabel(decision: RecordedDecision) {
  return decision.decidedIntervention !== null && decision.decidedIntensity !== null
    ? reviewActionLabel(decision.decidedIntervention, decision.decidedIntensity)
    : 'Sin acción decidida'
}

/** Qué se muestra de la decisión registrada de un caso. Una lectura fallida nunca es «sin decisión». */
export function decisionView(decisions: RecordedDecisions, debtorId: string): DecisionView {
  if (!decisions.ok) return { kind: 'UNAVAILABLE' }
  const decision = decisions.byDebtor.get(debtorId)
  if (!decision) return { kind: 'NONE' }
  return { kind: 'RECORDED', status: RECORDED_STATUS_LABELS[decision.status], action: actionLabel(decision), when: formatDateTime(decision.decidedAt), stale: decision.stale }
}

export function RecordedDecisionCell({ decisions, debtorId }: { decisions: RecordedDecisions; debtorId: string }) {
  const view = decisionView(decisions, debtorId)
  if (view.kind === 'NONE') return <span data-decision="none" aria-label="Sin decisión registrada">—</span>
  if (view.kind === 'UNAVAILABLE') return <span data-decision="unavailable" className="text-slate-500">No disponible</span>
  return (
    <div data-decision="recorded" className="space-y-0.5">
      <p className="font-medium text-slate-900">{view.status}</p>
      <p className="text-xs text-slate-600">{view.action} · {view.when}</p>
      {view.stale && <Badge variant="warning" className="whitespace-normal">{STALE_LABEL}</Badge>}
    </div>
  )
}

/** Una sola nota cuando la columna de decisiones no se pudo leer o el rol no las ve. */
export function DecisionsNotice({ decisions }: { decisions: RecordedDecisions }) {
  if (decisions.ok) return null
  return (
    <p role="status" data-decisions-notice={decisions.reason} className="text-sm text-amber-800">
      {decisions.reason === 'FORBIDDEN'
        ? 'Tu cuenta no puede ver las decisiones registradas: la columna «Decisión registrada» muestra «No disponible».'
        : 'No se pudieron leer las decisiones registradas: la columna «Decisión registrada» muestra «No disponible». Recargá la página; esto no significa que no haya decisiones.'}
    </p>
  )
}
