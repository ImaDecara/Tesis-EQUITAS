import type { ReactNode } from 'react'
import Link from 'next/link'

import { AppShell } from '@/components/layout/app-shell'
import { ModuleUnavailableCard } from '@/components/portfolio/portfolio-state'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { reviewActionLabel } from '@/lib/domain/case-review-form'
import {
  PENDING_LABELS,
  PENDING_ORDER,
  pendingKind,
  RECORDED_STATUS_LABELS,
  STALE_LABEL,
  type PendingKind,
  type RecordedDecision,
} from '@/lib/domain/recorded-decision'
import { getDebtorsData } from '@/lib/equitas-data'
import { loadRecordedDecisions } from '@/lib/server/recorded-decisions'
import { moduleAvailable } from '@/lib/domain/database-level-text'
import { loadViewerContext } from '@/lib/server/viewer-context'
import { formatDate, formatDateTime } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type PendingRow = { decision: RecordedDecision; identifier: string }

function actionLabel(decision: RecordedDecision): string {
  return decision.decidedIntervention !== null && decision.decidedIntensity !== null
    ? reviewActionLabel(decision.decidedIntervention, decision.decidedIntensity)
    : 'Sin acción decidida'
}

function PendingSection({ kind, rows }: { kind: PendingKind; rows: PendingRow[] }) {
  const labels = PENDING_LABELS[kind]
  return (
    <Card data-pending-section={kind}>
      <CardHeader>
        <CardTitle>{labels.title} ({rows.length})</CardTitle>
        <CardDescription>{labels.help}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Caso</TableHead>
              <TableHead>Acción decidida</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Registrada</TableHead>
              <TableHead>Cartera</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ decision, identifier }) => (
              <TableRow key={decision.reviewId}>
                <TableCell>
                  <Link href={`/debtors/${decision.debtorId}?tab=revision`} className="font-medium text-[#163a63] underline">{identifier}</Link>
                </TableCell>
                <TableCell>{actionLabel(decision)}</TableCell>
                <TableCell>
                  {RECORDED_STATUS_LABELS[decision.status]}
                  {decision.stale && <Badge variant="warning" className="ml-2">{STALE_LABEL}</Badge>}
                </TableCell>
                <TableCell>{formatDateTime(decision.decidedAt)} · {decision.mine ? 'por vos' : decision.participated ? 'por otra persona, sobre una versión tuya' : 'por otra persona'}</TableCell>
                <TableCell>al {formatDate(decision.asOf)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card data-pending-notice>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm text-slate-800">{children}</CardContent>
    </Card>
  )
}

export default async function PendingPage() {
  const [viewer, decisions, portfolio] = await Promise.all([loadViewerContext(), loadRecordedDecisions(), getDebtorsData()])
  const capabilities = { canRecord: viewer?.capabilities.canRecordDecision ?? false, canApprove: viewer?.capabilities.canApprove ?? false }
  const identifiers = new Map(portfolio.debtors.map(debtor => [debtor.id, debtor.identifier]))
  const groups = new Map<PendingKind, PendingRow[]>()
  if (decisions.ok) {
    for (const decision of decisions.byDebtor.values()) {
      const kind = pendingKind(decision, capabilities)
      if (kind) groups.set(kind, [...(groups.get(kind) ?? []), { decision, identifier: identifiers.get(decision.debtorId) ?? `Caso ${decision.debtorId}` }])
    }
  }
  const total = [...groups.values()].reduce((sum, rows) => sum + rows.length, 0)

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-[#163a63]">Pendientes</h1>
          <p className="text-sm text-slate-700">Los casos que esperan algo de vos: propuestas para aprobar u objetar, tus propuestas en espera y decisiones tuyas que conviene revisar.</p>
        </header>

        {viewer && !moduleAvailable(viewer) && <ModuleUnavailableCard what="Pendientes" />}

        {!decisions.ok && decisions.reason === 'UNAVAILABLE' && (
          <Notice title="No se pudieron leer las decisiones">
            <p>Esto no significa que no haya pendientes. Recargá la página; si sigue igual, avisá a quien administra el sistema.</p>
          </Notice>
        )}

        {viewer && moduleAvailable(viewer) && !capabilities.canRecord && !capabilities.canApprove && (
          <Notice title="Tu cuenta no tiene tareas pendientes">
            <p>Registrar una decisión sobre un caso y aprobar la propuesta de otra persona requieren una cuenta con rol ADMIN. Tu cuenta es {viewer.roleLabel}: podés ver la decisión registrada de cada caso y su estado en <Link href="/debtors" className="underline">Casos</Link>.</p>
          </Notice>
        )}

        {decisions.ok && (capabilities.canRecord || capabilities.canApprove) && total === 0 && (
          <Notice title="No tenés nada pendiente">
            <p>No hay propuestas esperando tu respuesta ni decisiones tuyas para revisar. Las decisiones de intensidad 0 a 2 quedan completas al registrarse; solo las de intensidad 3 o 4 necesitan que otra persona las apruebe.</p>
          </Notice>
        )}

        {PENDING_ORDER.map(kind => groups.has(kind) && <PendingSection key={kind} kind={kind} rows={groups.get(kind)!} />)}
      </div>
    </AppShell>
  )
}
