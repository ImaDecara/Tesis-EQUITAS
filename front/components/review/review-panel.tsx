import { DebtsTable } from '@/components/debtors/debts-table'
import { ReviewApprovalForm } from '@/components/review/review-approval-form'
import { ReviewDecisionForm } from '@/components/review/review-decision-form'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatNumber, formatWithUnit, missingSummary, readingFailed } from '@/lib/data-presence'
import { CASE_REVIEW_STATUS_LABELS, INTENSE_FROM, type CaseReviewSnapshot } from '@/lib/domain/case-review-contract'
import type { InterventionCode } from '@/lib/domain/decision-rules-v1'
import type { CaseReviewApprovalEntry, CaseReviewHistoryEntry, CaseReviewScreen } from '@/lib/domain/case-review-history'
import {
  APPROVAL_LABELS,
  CHECKBOX_LABELS,
  DECISION_LABELS,
  flagLabel,
  HOUSEHOLD_LABELS,
  readExplanation,
  reasonLabel,
  reviewActionLabel,
  type ExplanationView,
} from '@/lib/domain/case-review-form'
import { INTERVENTION_LABELS } from '@/lib/services/debtor-recommendation-generator'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import type { DataWarning, DebtorDetailData, DebtorListItem } from '@/types/equitas-domain'

type ReadyScreen = Extract<CaseReviewScreen, { kind: 'ready' }>

const interventionLabel = (code: string) => INTERVENTION_LABELS[code as InterventionCode] ?? code
const FACTOR_LABELS: Readonly<Record<string, string>> = {
  monto_actualizado_ars: 'Monto actualizado',
  dias_atraso_maximo: 'Atraso máximo',
  cantidad_vencidas: 'Obligaciones vencidas',
}
const ROLE_LABELS: Readonly<Record<string, string>> = { operador: 'Operador', supervisor: 'Supervisor' }

function severityText({ severity }: ExplanationView) {
  if (severity.value === null) return 'No disponible'
  return `${severity.state === 'PARCIAL' ? 'al menos ' : ''}${formatNumber(severity.value)} puntos de 0 a 100`
}

function FactList({ facts }: { facts: readonly (readonly [string, string])[] }) {
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {facts.map(([label, value]) => (
        <div key={label} className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <dt className="text-xs font-semibold text-slate-600">{label}</dt>
          <dd className="text-base font-semibold text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function factsAtCutoff(view: ExplanationView): (readonly [string, string])[] {
  const input = (factor: string) => view.factors.find(item => item.factor === factor)?.input ?? null
  const overdue = input('cantidad_vencidas')
  return [
    ['Monto actualizado al corte', formatCurrency(input('monto_actualizado_ars'))],
    ['Obligaciones vencidas al corte', formatNumber(overdue)],
    // Sin vencidas el atraso no aplica: un cero se leería como "al día con atraso medido".
    ['Atraso máximo al corte', overdue === 0 ? 'No aplica' : formatWithUnit(input('dias_atraso_maximo'), 'dias')],
    ['Obligaciones no evaluables', formatNumber(view.severity.notEvaluable)],
  ]
}

function ReviewFacts({ detail, warnings, snapshot, view }: { detail: DebtorDetailData; warnings: DataWarning[]; snapshot: CaseReviewSnapshot | null; view: ExplanationView | null }) {
  const { debtor, debts } = detail
  const missing = missingSummary(debtor.metrics)
  const facts = view ? factsAtCutoff(view) : [
    ['Total registrado', formatCurrency(debtor.totalDebt)] as const,
    ['Deuda vencida', formatCurrency(debtor.overdueDebt)] as const,
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle>Hechos del caso</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-slate-700">
        <p className="font-medium text-slate-900">{snapshot ? `Corte: ${formatDate(snapshot.asOf)}` : 'Corte: no disponible'}</p>
        {!snapshot && <p className="text-xs text-slate-600">{debtor.temporalProvenance}</p>}
        <p className="font-medium text-slate-900">Vulnerabilidad: no informada</p>
        <FactList facts={facts} />
        <div>
          <h3 className="font-semibold text-slate-900">Banderas</h3>
          {!view && <p>No disponible sin un corte vigente.</p>}
          {view && view.flags.length === 0 && <p>Sin banderas.</p>}
          {view && view.flags.length > 0 && (
            <ul className="list-disc pl-5">{view.flags.map(flag => <li key={flag}>{flagLabel(flag)}</li>)}</ul>
          )}
        </div>
        <div>
          <h3 className="font-semibold text-slate-900">Faltantes</h3>
          <p>{missing || 'Sin faltantes informados en los importes y la severidad.'}</p>
        </div>
        <div>
          <h3 className="mb-1 font-semibold text-slate-900">Obligaciones</h3>
          <DebtsTable debts={debts} readFailed={readingFailed(warnings, 'debtor', 'debt')} />
        </div>
      </CardContent>
    </Card>
  )
}

function ReviewSuggestion({ debtor, snapshot, view }: { debtor: DebtorListItem; snapshot: CaseReviewSnapshot; view: ExplanationView }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sugerencia del sistema</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-slate-700">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info">{interventionLabel(snapshot.suggestedIntervention)}</Badge>
          <Badge variant="neutral">Intensidad {snapshot.suggestedIntensity}</Badge>
          <Badge variant="neutral">Reglas v{snapshot.rulesVersion}</Badge>
          <Badge variant="neutral">Corte: {formatDate(snapshot.asOf)}</Badge>
        </div>
        <p className="text-slate-900">{view.phrase ?? 'Explicación no disponible.'}</p>
        {view.reviewRequired && <p className="font-medium text-amber-900">Requiere revisión caso por caso: no admite gestión masiva.</p>}
        <FactList facts={[
          ['Severidad del objeto (v1)', severityText(view)],
          ...view.factors.map(item => [
            FACTOR_LABELS[item.factor] ?? item.factor,
            item.points === null ? 'No disponible' : `${formatNumber(item.points)} de ${formatNumber(item.maximum)} puntos`,
          ] as const),
        ]} />
        {debtor.decisionAsOfSource === 'FECHA_CALCULO' && (
          <p className="text-xs text-slate-600">
            Las demás pestañas usan la fecha de cálculo del {formatDate(debtor.decisionAsOf?.valor)}; esta sugerencia usa el corte publicado.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function ChecklistSummary({ checklist }: { checklist: CaseReviewHistoryEntry['checklist'] }) {
  const { situacion_hogar: household } = checklist
  const confirmed = (Object.keys(CHECKBOX_LABELS) as (keyof typeof CHECKBOX_LABELS)[]).filter(key => checklist[key] === true)
  if (!household && confirmed.length === 0) return null
  return (
    <div>
      <p className="font-medium text-slate-900">Lista de control</p>
      <ul className="list-disc pl-5">
        {household && <li>Situación del hogar: {HOUSEHOLD_LABELS[household].toLowerCase()}</li>}
        {confirmed.map(key => <li key={key}>{CHECKBOX_LABELS[key]}</li>)}
      </ul>
    </div>
  )
}

function ReasonText({ entry }: { entry: CaseReviewHistoryEntry }) {
  const { reasonText } = entry
  if (reasonText.state === 'VISIBLE') return <p className="whitespace-pre-wrap break-words">Detalle: {reasonText.text}</p>
  if (reasonText.state === 'HIDDEN') return <p className="text-xs text-slate-600">El detalle, si lo hay, solo lo ven quien decide y quien supervisa.</p>
  return reasonText.state === 'UNAVAILABLE' ? <p className="text-xs text-slate-600">Detalle no disponible: no se pudo leer.</p> : null
}

function ApprovalLine({ approval }: { approval: CaseReviewApprovalEntry }) {
  const reason = reasonLabel(approval.reasonCode)
  return (
    <li>
      {formatDateTime(approval.createdAt)} · {ROLE_LABELS[approval.approverRole] ?? approval.approverRole} · {APPROVAL_LABELS[approval.decision]}
      {reason && ` · Motivo: ${reason}`}
      {!approval.isCurrent && ' · Reemplazada'}
    </li>
  )
}

function HistoryItem({ entry, screen }: { entry: CaseReviewHistoryEntry; screen: ReadyScreen }) {
  const reason = reasonLabel(entry.reasonCode)
  const proposalOpen = entry.isCurrent && (entry.decidedIntensity ?? 0) >= INTENSE_FROM
  return (
    <li className="space-y-2 rounded-md border border-slate-200 p-3 text-sm text-slate-700">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-900">{DECISION_LABELS[entry.decision]}</span>
        <Badge variant={entry.status === 'PENDIENTE_SUPERVISOR' ? 'warning' : entry.status === 'OBJETADA' ? 'danger' : 'success'}>{CASE_REVIEW_STATUS_LABELS[entry.status]}</Badge>
        <Badge variant="neutral">{entry.isCurrent ? 'Vigente' : 'Reemplazada por una decisión posterior'}</Badge>
      </div>
      <p>{formatDateTime(entry.createdAt)} · {ROLE_LABELS[entry.reviewerRole] ?? entry.reviewerRole}</p>
      <p>Sugerencia de ese momento: {reviewActionLabel(entry.suggestedIntervention, entry.suggestedIntensity)}</p>
      {entry.decidedIntervention !== null && entry.decidedIntensity !== null && (
        <p>Acción: {reviewActionLabel(entry.decidedIntervention, entry.decidedIntensity)}</p>
      )}
      {reason && <p>Motivo: {reason}</p>}
      <ReasonText entry={entry} />
      <ChecklistSummary checklist={entry.checklist} />
      <p>Corte: {formatDate(entry.asOf)} · Reglas v{entry.rulesVersion}</p>
      {entry.isCurrent && entry.basisChanged && <p className="font-medium text-amber-900">Los datos o las reglas cambiaron desde esta decisión.</p>}
      {entry.approvals.length > 0 && (
        <div>
          <p className="font-medium text-slate-900">Respuestas de supervisión</p>
          <ul className="list-disc pl-5">{entry.approvals.map(approval => <ApprovalLine key={approval.id} approval={approval} />)}</ul>
        </div>
      )}
      {proposalOpen && screen.capabilities.canApprove && (
        <div className="border-t border-slate-200 pt-3">
          <ReviewApprovalForm caseReviewId={entry.id} supersedes={entry.currentApprovalId} approveBlocked={!screen.snapshot.ok} />
        </div>
      )}
    </li>
  )
}

function ReviewHistory({ screen }: { screen: ReadyScreen }) {
  const { history } = screen
  return (
    <Card>
      <CardHeader>
        <CardTitle>Historial de decisiones</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-slate-700">
        {!history.ok && <p role="status" className="text-amber-900">{history.message}</p>}
        {history.ok && history.entries.length === 0 && <p>Todavía no hay decisiones registradas para este objeto.</p>}
        {history.ok && history.entries.length > 0 && (
          <ol className="space-y-3">{history.entries.map(entry => <HistoryItem key={entry.id} entry={entry} screen={screen} />)}</ol>
        )}
      </CardContent>
    </Card>
  )
}

// La ficha usa la fecha de cálculo y la revisión, el corte publicado: nunca se presentan como si
// fueran lo mismo. La cabecera dice "corte no integrado" solo sobre el cálculo de la ficha.
export function reviewDifferenceNotice(debtor: DebtorListItem, screen: CaseReviewScreen): string | null {
  if (screen.kind !== 'ready' || !screen.snapshot.ok) return null
  const { snapshot } = screen.snapshot
  const cutoff = formatDate(snapshot.asOf)
  const intervention = debtor.decision?.intervencion
  if (intervention && (intervention.codigo !== snapshot.suggestedIntervention || intervention.intensidad !== snapshot.suggestedIntensity)) {
    return `La sugerencia a revisar usa el corte publicado del ${cutoff} y difiere de la recomendación de esta ficha (${interventionLabel(intervention.codigo)}), calculada con otra fecha. Para decidir vale la de la pestaña Revisión.`
  }
  return debtor.decisionAsOfSource === 'FECHA_CALCULO'
    ? `Hay un corte publicado del ${cutoff}: la pestaña Revisión lo usa, y el resto de esta ficha usa la fecha de cálculo.`
    : null
}

// El orden es la decisión de diseño: hechos, sugerencia, decisión e historial `[P0219]`.
export function ReviewPanel({ screen, detail, warnings }: { screen: CaseReviewScreen; detail: DebtorDetailData; warnings: DataWarning[] }) {
  if (screen.kind !== 'ready') {
    return <p role="status" className="text-sm text-slate-700">{screen.message}</p>
  }
  const snapshot = screen.snapshot.ok ? screen.snapshot.snapshot : null
  const view = snapshot ? readExplanation(snapshot.explanation) : null
  return (
    <div className="space-y-4">
      <ReviewFacts detail={detail} warnings={warnings} snapshot={snapshot} view={view} />
      {snapshot && view ? (
        <ReviewSuggestion debtor={detail.debtor} snapshot={snapshot} view={view} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Sugerencia no disponible</CardTitle>
          </CardHeader>
          <CardContent>
            <p role="status" className="text-sm text-slate-700">{!screen.snapshot.ok && screen.snapshot.message}</p>
          </CardContent>
        </Card>
      )}
      {snapshot && screen.capabilities.canRecord && (
        <Card>
          <CardContent className="pt-6">
            <ReviewDecisionForm snapshot={snapshot} />
          </CardContent>
        </Card>
      )}
      {!screen.capabilities.canRecord && !screen.capabilities.canApprove && (
        <p className="text-sm text-slate-700">Solo lectura: tu rol no registra decisiones.</p>
      )}
      <ReviewHistory screen={screen} />
    </div>
  )
}
