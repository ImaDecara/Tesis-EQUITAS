import type { ReactNode } from 'react'
import Link from 'next/link'

import {
  BAND_LABELS,
  breakdownTotal,
  COVERAGE_LABELS,
  explanationOfDecision,
  FACTOR_LABELS,
  joinList,
  scoreText,
  splitFlags,
} from '@/components/case/case-explanation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatNumber, formatWithUnit, metric } from '@/lib/data-presence'
import { flagLabel, type ExplanationFactor } from '@/lib/domain/case-review-form'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { DebtorListItem, NumericData } from '@/types/equitas-domain'

// Noche 7. Pestaña «Resumen» de la ficha: por qué el caso tiene esa prioridad (desglose y regla
// aplicada) y sus totales con las definiciones únicas (plan de entrega §9.3). Todo sale del DTO
// del caso; nada se recalcula acá.

const plural = (count: number, one: string, many: string) => `${formatNumber(count)} ${count === 1 ? one : many}`

// Sin obligaciones vencidas el atraso no aplica: un cero se leería como «al día con atraso medido».
function factorInput(item: ExplanationFactor, factors: readonly ExplanationFactor[]): string {
  if (item.factor === 'monto_actualizado_ars') return formatCurrency(item.input)
  if (item.factor !== 'dias_atraso_maximo') return formatNumber(item.input)
  const overdue = factors.find(factor => factor.factor === 'cantidad_vencidas')?.input
  return overdue === 0 ? 'No aplica: no hay obligaciones vencidas' : formatWithUnit(item.input, 'días')
}

const pointsText = (points: number | null, maximum: number | null) =>
  points === null ? 'No disponible' : `${formatNumber(points)} de ${formatNumber(maximum)} puntos`

function Row({ label, value, help }: { label: string; value: ReactNode; help?: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-slate-100 py-2 last:border-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="min-w-0 text-sm text-slate-700">
        <span className="font-medium text-slate-900">{label}</span>
        {help && <span className="block text-xs text-slate-600">{help}</span>}
      </dt>
      <dd className="text-sm font-semibold break-words text-slate-900 sm:text-right">{value}</dd>
    </div>
  )
}

export function PriorityBreakdown({ debtor, readFailed }: { debtor: DebtorListItem; readFailed: boolean }) {
  const { decision } = debtor
  if (!decision) {
    return (
      <Card>
        <CardHeader><CardTitle>Por qué tiene esta prioridad</CardTitle></CardHeader>
        <CardContent>
          <p role="status" className="text-sm text-amber-900">
            {readFailed
              ? 'No se pudo calcular el puntaje: no se pudieron leer los datos necesarios para evaluar este caso. Recargá la página en unos minutos; si sigue igual, avisá a quien administra el sistema.'
              : 'No se pudo calcular el puntaje: los datos del caso no alcanzan para evaluarlo.'}
          </p>
        </CardContent>
      </Card>
    )
  }
  const view = explanationOfDecision(decision)
  const total = breakdownTotal(view)
  const { caseFlags, coverage } = splitFlags(view.flags, debtor.decisionInput)
  const band = view.severity.band ? BAND_LABELS[view.severity.band] : undefined
  return (
    <Card data-case-section="priority">
      <CardHeader><CardTitle>Por qué tiene esta prioridad</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm text-slate-700">
        <p>
          Puntaje de prioridad: <span className="font-semibold text-slate-900">{scoreText(view.severity.value, view.severity.state)}{view.severity.value !== null && ' de 100'}</span>
          {view.severity.value !== null && band && <> (banda {band.toLowerCase()})</>}. Se suma por reglas con tres factores; no es una probabilidad de pago.
        </p>
        <dl aria-label="Desglose del puntaje">
          {view.factors.map(item => (
            <Row key={item.factor} label={FACTOR_LABELS[item.factor] ?? item.factor} help={factorInput(item, view.factors)} value={pointsText(item.points, item.maximum)} />
          ))}
          <Row label="Total" value={total === null ? 'No disponible' : `${formatNumber(total)} de 100 puntos`} />
        </dl>
        {view.severity.state === 'PARCIAL' && (
          <p className="text-xs text-slate-600">
            Es un mínimo: {plural(view.severity.notEvaluable ?? 0, 'obligación no tiene', 'obligaciones no tienen')} importe o vencimiento evaluables.
          </p>
        )}
        <div>
          <h4 className="font-semibold text-slate-900">Regla aplicada</h4>
          <p data-case-rule>{view.phrase ?? 'No disponible.'}</p>
          {view.reviewRequired && <p className="mt-1 font-medium text-amber-900">Requiere revisión caso por caso: no admite gestión masiva.</p>}
        </div>
        {caseFlags.length > 0 && (
          <div>
            <h4 className="font-semibold text-slate-900">Avisos de este caso</h4>
            <ul className="list-disc pl-5">{caseFlags.map(flag => <li key={flag}>{flagLabel(flag)}</li>)}</ul>
          </div>
        )}
        {coverage.length > 0 && (
          <p className="text-xs text-slate-600" data-coverage-note>
            Nota de cobertura: las reglas de esta versión no usan {joinList(coverage.map(flag => COVERAGE_LABELS[flag]))}.
            No cambia el puntaje ni la recomendación.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

const missingCount = (data: NumericData) => Object.values(data.missing).reduce<number>((sum, count) => sum + (count ?? 0), 0)

function amountWithMissing(data: NumericData): string {
  const missing = missingCount(data)
  const amount = formatCurrency(data.value)
  return data.value !== null && missing > 0 ? `al menos ${amount} (${plural(missing, 'obligación sin dato', 'obligaciones sin dato')})` : amount
}

function overdueText(debtor: DebtorListItem): string {
  const amount = metric(debtor, 'overdueDebt')
  const count = debtor.overdueDebtsCount
  if (amount.value === null || count === null) return 'No disponible'
  if (count === 0) return 'Sin obligaciones vencidas'
  return `${plural(count, 'obligación', 'obligaciones')} por ${amountWithMissing(amount)}`
}

function maxDaysText(debtor: DebtorListItem): string {
  const days = metric(debtor, 'maxDaysOverdue')
  if (days.value === null) return days.presence === 'NO_APLICA' ? 'No aplica: no hay obligaciones vencidas' : 'No disponible'
  return formatWithUnit(days.value, 'días')
}

export function CaseTotals({ debtor }: { debtor: DebtorListItem }) {
  const paid = debtor.decision?.severidad.obligaciones_pagadas ?? 0
  return (
    <Card data-case-section="totals">
      <CardHeader><CardTitle>Totales del caso</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm text-slate-700">
        <dl>
          <Row label="Total registrado" help="Todas las obligaciones, cualquiera sea su estado." value={amountWithMissing(metric(debtor, 'totalDebt'))} />
          <Row label="Deuda pendiente" help="El total registrado sin las obligaciones pagadas." value={amountWithMissing(metric(debtor, 'pendingDebt'))} />
          <Row label="Deuda vencida" help="Pendientes con importe mayor que cero y vencimiento anterior a la fecha de la cartera." value={overdueText(debtor)} />
          <Row label="Atraso máximo" value={maxDaysText(debtor)} />
          <Row label="Contacto activo cargado" value={debtor.hasContact === null ? 'No disponible' : debtor.hasContact ? 'Sí' : 'No'} />
        </dl>
        <p className="text-xs text-slate-600">
          Las obligaciones pagadas no cuentan como pendientes ni vencidas
          {paid > 0 ? `: este caso tiene ${plural(paid, 'pagada', 'pagadas')}.` : '.'}
        </p>
      </CardContent>
    </Card>
  )
}

function SnapshotItem({ label, children, tone }: { label: string; children: ReactNode; tone?: 'danger' }) {
  return (
    <div className="min-w-0 rounded-lg border border-[#d2dceb] bg-white px-3 py-2 shadow-sm">
      <dt className="text-xs text-slate-600">{label}</dt>
      <dd className={tone === 'danger' ? 'text-base font-semibold break-words text-[#8f3434]' : 'text-base font-semibold break-words text-slate-900'}>{children}</dd>
    </div>
  )
}

/** Síntesis económica y contacto principal, arriba de las pestañas (como en main), con las definiciones de N7. */
export function CaseSnapshot({ debtor, contact, contactsHref }: {
  debtor: DebtorListItem
  contact: { state: 'unavailable' } | { state: 'none' } | { state: 'found'; channel: string; value: string; more: number }
  contactsHref: string
}) {
  return (
    <section aria-label="Síntesis del caso" data-case-section="snapshot">
      <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <SnapshotItem label="Deuda pendiente">{amountWithMissing(metric(debtor, 'pendingDebt'))}</SnapshotItem>
        <SnapshotItem label="Deuda vencida" tone="danger">{overdueText(debtor)}</SnapshotItem>
        <SnapshotItem label="Atraso máximo">{maxDaysText(debtor)}</SnapshotItem>
        <SnapshotItem label="Contacto principal">
          {contact.state === 'unavailable' ? 'No disponible: no se pudieron leer los contactos'
            : contact.state === 'none' ? 'Sin contacto activo cargado'
            : <span className="font-medium" data-main-contact>{contact.channel} · <span className="break-all">{contact.value}</span></span>}
          <Link href={contactsHref} className="mt-0.5 block text-xs font-normal text-[#163a63] underline">
            {contact.state === 'found' && contact.more > 0 ? `Ver ${plural(contact.more, 'contacto más', 'contactos más')}` : 'Ver personas y contactos'}
          </Link>
        </SnapshotItem>
      </dl>
    </section>
  )
}

// Las fechas técnicas van plegadas y en formato local (H13).
export function TechnicalDetail({ debtor }: { debtor: DebtorListItem }) {
  const day = debtor.decisionAsOf?.valor ?? null
  const basis = day === null ? 'Sin fecha de cartera evaluable'
    : debtor.decisionAsOfSource === 'MANIFIESTO_LOTE' ? `Cartera al ${formatDate(day)}` : `Sin cartera cargada: cifras calculadas al ${formatDate(day)}`
  return (
    <details className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">
      <summary className="cursor-pointer font-medium text-slate-900">Detalle técnico</summary>
      <p className="mt-2">{basis} · reglas {debtor.rulesVersion ?? 'no disponibles'}</p>
      <p>Vulnerabilidad: no informada (no se usa en esta versión).</p>
    </details>
  )
}
