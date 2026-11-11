import type { ReactNode } from 'react'

import { recordedDecisionText, whoText } from '@/components/case/case-explanation'
import { ReviewApprovalForm } from '@/components/review/review-approval-form'
import { ReviewDecisionForm } from '@/components/review/review-decision-form'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CASE_REVIEW_STATUS_LABELS, INTENSE_FROM, type CaseReviewSnapshot } from '@/lib/domain/case-review-contract'
import type { InterventionCode } from '@/lib/domain/decision-rules-v1'
import type { CaseReviewApprovalEntry, CaseReviewHistoryEntry, CaseReviewScreen } from '@/lib/domain/case-review-history'
import {
  CHECKBOX_LABELS,
  HOUSEHOLD_LABELS,
  readExplanation,
  reasonLabel,
  reviewActionLabel,
} from '@/lib/domain/case-review-form'
import { isStale, staleExplanation } from '@/lib/domain/recorded-decision'
import { roleLabel } from '@/lib/domain/role-labels'
import { INTERVENTION_LABELS } from '@/lib/services/debtor-recommendation-generator'
import { formatDate, formatDateTime } from '@/lib/utils'
import type { DebtorListItem } from '@/types/equitas-domain'

type ReadyScreen = Extract<CaseReviewScreen, { kind: 'ready' }>

const interventionLabel = (code: string) => INTERVENTION_LABELS[code as InterventionCode] ?? code

export const READ_ONLY_MESSAGE = 'Tu cuenta puede ver la decisión registrada y su estado. Registrar una decisión requiere una cuenta ADMIN.'
export const OWN_PROPOSAL_MESSAGE = 'Esta propuesta la registraste vos: la tiene que aprobar otra persona con rol ADMIN. Si en tu municipio no hay otra cuenta ADMIN, queda pendiente.'
export const PARTICIPATED_MESSAGE = 'Participaste de esta propuesta: la tiene que aprobar otra persona con rol ADMIN que no haya intervenido.'
const NO_CUTOFF_MESSAGE = 'Hoy no hay una cartera vigente (quizá hay una carga en curso): no se puede aprobar.'

const STATUS_VARIANT: Readonly<Record<CaseReviewHistoryEntry['status'], 'info' | 'warning' | 'success' | 'danger'>> = {
  REGISTRADA: 'info', PENDIENTE_SUPERVISOR: 'warning', APROBADA: 'success', OBJETADA: 'danger',
}

// La recomendación que se decide es la de la instantánea: la cartera vigente y las reglas activas.
function ReviewSuggestion({ snapshot }: { snapshot: CaseReviewSnapshot }) {
  const view = readExplanation(snapshot.explanation)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recomendación automática a revisar</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-slate-700">
        <p className="text-base font-semibold text-slate-900">{reviewActionLabel(snapshot.suggestedIntervention, snapshot.suggestedIntensity)}</p>
        <p>{view.phrase ?? 'Explicación no disponible.'}</p>
        {view.reviewRequired && <p className="font-medium text-amber-900">Requiere revisión caso por caso: no admite gestión masiva.</p>}
        <p className="text-xs text-slate-600">Cartera al {formatDate(snapshot.asOf)} · reglas {snapshot.rulesVersion}</p>
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
  if (reasonText.state === 'HIDDEN') return <p className="text-xs text-slate-600">El detalle escrito, si lo hay, solo lo ven las cuentas con rol ADMIN.</p>
  return reasonText.state === 'UNAVAILABLE' ? <p className="text-xs text-slate-600">Detalle no disponible: no se pudo leer.</p> : null
}

// En pasado: lo que pasó con la propuesta, no el verbo del botón.
function ApprovalLine({ approval }: { approval: CaseReviewApprovalEntry }) {
  const reason = reasonLabel(approval.reasonCode)
  const verb = approval.decision === 'APRUEBA' ? 'Aprobada' : 'Objetada'
  return (
    <li>
      {verb} por {whoText(approval.mine)} ({roleLabel(approval.approverRole)}) el {formatDateTime(approval.createdAt)}
      {reason && `; motivo: ${reason}`}
      {!approval.isCurrent && ' · reemplazada por una respuesta posterior'}
    </li>
  )
}

type Basis = { asOf: string; rulesVersion: string } | null

function approveBlockedReason(entry: CaseReviewHistoryEntry, basis: Basis): string | null {
  if (!basis) return NO_CUTOFF_MESSAGE
  return isStale(entry, basis) ? `${staleExplanation(entry, basis, formatDate)} Ya no se puede aprobar.` : null
}

// Quién puede responder una propuesta se decide por identidad, con la misma regla que la base:
// nadie que haya registrado esta versión o una anterior de su cadena.
function ApprovalArea({ entry, screen, basis }: { entry: CaseReviewHistoryEntry; screen: ReadyScreen; basis: Basis }) {
  const pending = entry.status === 'PENDIENTE_SUPERVISOR'
  if (!screen.capabilities.canApprove) {
    return pending ? <p className="text-sm text-slate-700">Espera la aprobación de otra persona con rol ADMIN.</p> : null
  }
  if (entry.mine || entry.participated) {
    return <p role="status" className="text-sm font-medium text-slate-800">{entry.mine ? OWN_PROPOSAL_MESSAGE : PARTICIPATED_MESSAGE}</p>
  }
  const form = <ReviewApprovalForm caseReviewId={entry.id} supersedes={entry.currentApprovalId} blockedReason={approveBlockedReason(entry, basis)} />
  if (pending) return form
  return (
    <details>
      <summary className="inline-flex h-9 cursor-pointer items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-[#163a63] hover:bg-slate-50">
        Cambiar respuesta
      </summary>
      <div className="mt-3">{form}</div>
    </details>
  )
}

function HistoryItem({ entry, screen, basis }: { entry: CaseReviewHistoryEntry; screen: ReadyScreen; basis: Basis }) {
  const reason = reasonLabel(entry.reasonCode)
  const proposalOpen = entry.isCurrent && (entry.decidedIntensity ?? 0) >= INTENSE_FROM
  const stale = basis !== null && isStale(entry, basis)
  return (
    <li className="space-y-2 rounded-md border border-slate-200 p-3 text-sm text-slate-700">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold break-words text-slate-900">{recordedDecisionText(entry.decision, entry.decidedIntervention, entry.decidedIntensity)}</span>
        <Badge variant={STATUS_VARIANT[entry.status]}>{CASE_REVIEW_STATUS_LABELS[entry.status]}</Badge>
        {!entry.isCurrent && <Badge variant="neutral">Reemplazada por una decisión posterior</Badge>}
      </div>
      <p>Registrada por {whoText(entry.mine)} ({roleLabel(entry.reviewerRole)}) el {formatDateTime(entry.createdAt)}</p>
      <p>Recomendación automática de ese momento: {reviewActionLabel(entry.suggestedIntervention, entry.suggestedIntensity)}</p>
      {reason && <p>Motivo: {reason}</p>}
      <ReasonText entry={entry} />
      <ChecklistSummary checklist={entry.checklist} />
      <p className="text-xs text-slate-600">Cartera al {formatDate(entry.asOf)} · reglas {entry.rulesVersion}</p>
      {entry.isCurrent && stale && <p className="font-medium text-amber-900">{staleExplanation(entry, basis, formatDate)}</p>}
      {entry.isCurrent && !stale && entry.basisChanged && <p className="font-medium text-amber-900">Los datos del caso cambiaron desde esta decisión. Conviene revisarla.</p>}
      {entry.approvals.length > 0 && (
        <div>
          <p className="font-medium text-slate-900">Respuestas a la propuesta</p>
          <ul className="list-disc pl-5">{entry.approvals.map(approval => <ApprovalLine key={approval.id} approval={approval} />)}</ul>
        </div>
      )}
      {proposalOpen && (
        <div className="border-t border-slate-200 pt-3">
          <ApprovalArea entry={entry} screen={screen} basis={basis} />
        </div>
      )}
    </li>
  )
}

function ReviewHistory({ screen, basis }: { screen: ReadyScreen; basis: Basis }) {
  const { history } = screen
  return (
    <Card>
      <CardHeader>
        <CardTitle>Historial de decisiones</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-slate-700">
        {!history.ok && <p role="status" className="text-amber-900">{history.message}</p>}
        {history.ok && history.entries.length === 0 && <p>Todavía no hay decisiones registradas para este caso.</p>}
        {history.ok && history.entries.length > 0 && (
          <ol className="space-y-3">{history.entries.map(entry => <HistoryItem key={entry.id} entry={entry} screen={screen} basis={basis} />)}</ol>
        )}
      </CardContent>
    </Card>
  )
}

// El encabezado y el resumen usan la decisión calculada con los datos del caso; la pestaña
// «Decisión», la instantánea de la cartera vigente. Si no coinciden, se dice: nunca se presentan
// como si fueran lo mismo.
export function reviewDifferenceNotice(debtor: DebtorListItem, screen: CaseReviewScreen): string | null {
  if (screen.kind !== 'ready' || !screen.snapshot.ok) return null
  const { snapshot } = screen.snapshot
  const cutoff = formatDate(snapshot.asOf)
  const intervention = debtor.decision?.intervencion
  if (intervention && (intervention.codigo !== snapshot.suggestedIntervention || intervention.intensidad !== snapshot.suggestedIntensity)) {
    return `La recomendación a revisar en la pestaña Decisión usa la cartera al ${cutoff} y no coincide con la del encabezado (${interventionLabel(intervention.codigo)}), calculada con otra fecha. Para decidir vale la de la pestaña Decisión.`
  }
  return debtor.decisionAsOfSource === 'FECHA_CALCULO'
    ? `El encabezado y el resumen usan la fecha de cálculo del ${formatDate(debtor.decisionAsOf?.valor)}; la pestaña Decisión usa la cartera al ${cutoff}.`
    : null
}

function Notice({ children }: { children: ReactNode }) {
  return <p role="status" className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{children}</p>
}

// El orden es la decisión de diseño: recomendación, decisión e historial `[P0219]`. Los hechos
// del caso (puntaje, desglose y totales) están en el encabezado y en «Resumen».
export function ReviewPanel({ screen }: { screen: CaseReviewScreen }) {
  if (screen.kind !== 'ready') return <Notice>{screen.message}</Notice>
  const snapshot = screen.snapshot.ok ? screen.snapshot.snapshot : null
  const basis = snapshot ? { asOf: snapshot.asOf, rulesVersion: snapshot.rulesVersion } : null
  return (
    <div className="space-y-4">
      {snapshot ? (
        <ReviewSuggestion snapshot={snapshot} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Recomendación automática no disponible</CardTitle>
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
      {!screen.capabilities.canRecord && <Notice>{READ_ONLY_MESSAGE}</Notice>}
      <ReviewHistory screen={screen} basis={basis} />
    </div>
  )
}
