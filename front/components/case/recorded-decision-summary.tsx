import { Badge } from '@/components/ui/badge'
import { recordedDecisionText, whoText } from '@/components/case/case-explanation'
import { RECORDED_STATUS_LABELS, staleExplanation, type RecordedDecision, type RecordedStatus } from '@/lib/domain/recorded-decision'
import { UNAVAILABLE_ON_THIS_DATABASE } from '@/lib/domain/database-level-text'
import { roleLabel } from '@/lib/domain/role-labels'
import { formatDate, formatDateTime } from '@/lib/utils'

// Noche 7. La decisión registrada del caso, en el encabezado de la ficha. Sale de
// `loadRecordedDecisions()`, que ya resolvió `mine` y `stale`: acá solo se presenta.

type Basis = { asOf: string | null; rulesVersion: string }

export type RecordedDecisionView =
  | Readonly<{ kind: 'unavailable' }>
  | Readonly<{ kind: 'forbidden' }>
  | Readonly<{ kind: 'no-module' }>
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'recorded'; decision: RecordedDecision; current: Basis }>

type RecordedDecisionsResult =
  | { ok: true; current: Basis; byDebtor: ReadonlyMap<string, RecordedDecision> }
  | { ok: false; reason: 'FORBIDDEN' | 'UNAVAILABLE' | 'NO_MODULE' }

export function recordedDecisionView(result: RecordedDecisionsResult, debtorId: string): RecordedDecisionView {
  if (!result.ok) return result.reason === 'NO_MODULE' ? { kind: 'no-module' } : result.reason === 'FORBIDDEN' ? { kind: 'forbidden' } : { kind: 'unavailable' }
  const decision = result.byDebtor.get(debtorId)
  return decision ? { kind: 'recorded', decision, current: result.current } : { kind: 'none' }
}

export const STATUS_VARIANT: Readonly<Record<RecordedStatus, 'info' | 'warning' | 'success' | 'danger'>> = {
  REGISTRADA: 'info',
  PENDIENTE_APROBACION: 'warning',
  APROBADA: 'success',
  OBJETADA: 'danger',
}

export function RecordedDecisionSummary({ view }: { view: RecordedDecisionView }) {
  if (view.kind === 'unavailable') {
    return (
      <div role="status" className="space-y-1">
        <p className="font-medium text-amber-900">No se pudo leer la decisión registrada.</p>
        <p className="text-xs text-slate-600">Esto no significa que no haya una: recargá la página en unos minutos.</p>
      </div>
    )
  }
  if (view.kind === 'forbidden') return <p className="text-sm text-slate-700">Tu cuenta no puede ver las decisiones registradas.</p>
  if (view.kind === 'no-module') return <p className="text-sm text-slate-700">{UNAVAILABLE_ON_THIS_DATABASE}: no tiene el módulo de decisiones.</p>
  if (view.kind === 'none') return <p className="text-sm text-slate-700">Todavía no hay una decisión registrada.</p>
  const { decision, current } = view
  return (
    <div className="space-y-2" data-recorded-decision={decision.stale ? 'stale' : 'current'}>
      <p className="font-medium break-words text-slate-900">
        {recordedDecisionText(decision.decision, decision.decidedIntervention, decision.decidedIntensity)}
      </p>
      <p className="text-xs text-slate-600">
        Registrada por {whoText(decision.mine)} ({roleLabel(decision.reviewerRole)}) el {formatDateTime(decision.decidedAt)}
      </p>
      <Badge variant={STATUS_VARIANT[decision.status]}>{RECORDED_STATUS_LABELS[decision.status]}</Badge>
      {decision.stale && (
        <p role="status" className="text-sm font-medium text-amber-900">{staleExplanation(decision, current, formatDate)}</p>
      )}
    </div>
  )
}
