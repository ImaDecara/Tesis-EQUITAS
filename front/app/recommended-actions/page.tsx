import Link from 'next/link'
import { ClipboardCheck } from 'lucide-react'

import { MetricCard } from '@/components/dashboard/metric-card'
import { DataWarnings } from '@/components/equitas/data-warnings'
import { AppShell } from '@/components/layout/app-shell'
import { emptyPortfolioScreen, PageHeading } from '@/components/portfolio/portfolio-state'
import { casesLabel, countLabel, filterLine, filterNotes, missingText, SCORE_LABEL } from '@/components/portfolio/portfolio-text'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatNumber, formatWithUnit, readingFailed } from '@/lib/data-presence'
import { getDebtorsData } from '@/lib/equitas-data'
import { buildQueueReconciliation, buildRecommendationSummary, RECOMMENDATION_BADGE_VARIANT } from '@/lib/equitas-view-selectors'
import { filterPortfolio, normalizePortfolioSearchParams, portfolioHref, type RawPortfolioSearchParams } from '@/lib/portfolio-filters'
import { formatCurrency } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const TITLE = 'Acciones recomendadas'
const TONE: Record<string, 'danger' | 'primary' | 'warning' | 'success' | 'accent'> = {
  'Revisión jurídica': 'danger', 'Contacto y plan': 'warning', 'Mejorar datos': 'primary', Recordatorio: 'accent', Seguimiento: 'success',
}
const UNREAD = 'No disponible: no se pudieron leer los datos.'

export default async function RecommendedActionsPage({ searchParams }: { searchParams?: Promise<RawPortfolioSearchParams> } = {}) {
  const empty = await emptyPortfolioScreen(TITLE)
  if (empty) return empty
  const source = await getDebtorsData()
  const filters = normalizePortfolioSearchParams(await searchParams ?? {})
  const active = Object.values(filters).some(Boolean)
  const { items: debtors, warnings, failed } = filterPortfolio(source.debtors, filters, source.warnings)
  // El grupo «No disponible» (casos sin evaluar) solo se muestra si tiene casos o si no se pudo contar.
  const summary = buildRecommendationSummary(debtors, warnings).filter(group => group.interventionCode !== null || group.count !== 0)
  const reconciliation = buildQueueReconciliation(debtors, warnings)
  const unevaluated = summary.find(group => group.interventionCode === null)?.count ?? null
  const outsideDetail = reconciliation.outsideObjects === null ? null
    : `${countLabel(reconciliation.outsideObjects, 'caso', 'casos')} · ${countLabel(reconciliation.outsideObligations!, 'obligación', 'obligaciones')}`
  const reconciliationRows: { label: string; value: string; detail?: string | null }[] = [
    { label: 'Suma de los grupos', value: formatCurrency(reconciliation.queueTotal.value), detail: missingText('Faltantes', reconciliation.queueTotal) },
    { label: 'Total registrado', value: formatCurrency(reconciliation.dashboardTotal.value), detail: missingText('Faltantes', reconciliation.dashboardTotal) },
    { label: 'Diferencia', value: formatCurrency(reconciliation.difference.value) },
    { label: 'Obligaciones pagadas', value: formatCurrency(reconciliation.paidAmount.value), detail: reconciliation.paidObligations === null ? null : countLabel(reconciliation.paidObligations, 'obligación', 'obligaciones') },
    { label: 'Sin vencimiento evaluable', value: formatCurrency(reconciliation.outsideAmount.value), detail: outsideDetail },
    { label: 'Resto de la diferencia', value: formatCurrency(reconciliation.otherDifference.value) },
  ]

  return (
    <AppShell>
      <PageHeading title={TITLE} description="La recomendación automática que calcula el sistema por reglas para cada grupo de trabajo. La decisión sobre cada caso la registra una persona en la ficha del caso." />

      <div className="space-y-5">
        <DataWarnings warnings={source.warnings} />
        {filterNotes(warnings, source.warnings).map(note => <p key={note.message} role="status" className="text-sm text-amber-800">{note.message}</p>)}
        {active && <p className="text-sm text-slate-700">{filterLine(failed ? null : debtors.length, readingFailed(source.warnings, 'debtor') ? null : source.debtors.length)}</p>}

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {summary.map(group => (
            <MetricCard key={group.recommendation} label={group.recommendation} value={formatNumber(group.count)}
              hint={`Deuda pendiente evaluable: ${formatCurrency(group.debtAssociated)}. ${group.coverage.totalDebt}`}
              icon={ClipboardCheck} tone={TONE[group.recommendation] ?? 'primary'} />
          ))}
        </section>

        <Card className="border-[#d2dceb]">
          <CardHeader>
            <CardTitle>Resumen por grupo de trabajo</CardTitle>
            <CardDescription>
              Cada grupo se ordena por su propio {SCORE_LABEL.toLowerCase()}; hasta 3 casos destacados. «Al menos» indica que faltan datos de alguna obligación.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Grupo</TableHead>
                  <TableHead className="text-right">Casos</TableHead>
                  <TableHead className="text-right">Deuda pendiente evaluable</TableHead>
                  <TableHead className="hidden text-right md:table-cell">{SCORE_LABEL} promedio</TableHead>
                  <TableHead className="hidden md:table-cell">Casos destacados</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.map(group => (
                  <TableRow key={group.recommendation}>
                    <TableCell>
                      {group.count === null
                        ? <Badge variant={RECOMMENDATION_BADGE_VARIANT[group.recommendation]}>{group.recommendation}</Badge>
                        : <Link href={portfolioHref('/priority-cases', filters, { queue: group.interventionCode ?? 'SIN_COLA', page: '' })} className="font-medium text-[#163a63] underline">{group.recommendation}</Link>}
                    </TableCell>
                    <TableCell className="text-right">{formatNumber(group.count)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(group.debtAssociated)}<p className="text-xs">{group.coverage.totalDebt}</p></TableCell>
                    <TableCell className="hidden text-right md:table-cell">
                      {group.metrics.riskScore.presence === 'NO_APLICA' ? 'No aplica' : formatWithUnit(group.averageRisk, 'de 100', 1)}<p className="text-xs">{group.coverage.riskScore}</p>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex max-w-[420px] flex-wrap gap-2">
                        {group.highlightedCases.length === 0 && <span className="text-sm text-slate-500">{group.count === null ? UNREAD : 'Sin casos'}</span>}
                        {group.highlightedCases.map(debtor => (
                          <Link key={debtor.id} href={portfolioHref(`/debtors/${encodeURIComponent(debtor.id)}`, filters)}
                            className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-[#163a63] hover:bg-[#edf2f9]">{debtor.identifier}</Link>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <details className="rounded-lg border border-[#d2dceb] bg-white p-4 text-sm text-slate-700" data-reconciliation>
          <summary className="cursor-pointer font-semibold text-[#163a63]">Por qué la suma de los grupos no coincide con el total registrado</summary>
          <p className="mt-2">
            Cada grupo suma la deuda pendiente evaluable de sus casos: obligaciones no pagadas con importe y vencimiento válidos,
            vencidas o no. El total registrado suma todas las obligaciones, cualquiera sea su estado.
          </p>
          <dl className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            {reconciliationRows.map(row => (
              <div key={row.label}>
                <dt className="text-xs font-medium text-slate-600">{row.label}</dt>
                <dd className="text-lg font-semibold text-[#163a63]">{row.value}</dd>
                {row.detail && <dd className="text-xs text-slate-600">{row.detail}</dd>}
              </div>
            ))}
          </dl>
          {reconciliation.outsideWithoutAmount !== null && reconciliation.outsideWithoutAmount > 0 && (
            <p role="status" className="mt-2 text-amber-800">
              {countLabel(reconciliation.outsideWithoutAmount, 'obligación', 'obligaciones')} sin importe informado: no se suman como 0 y el importe sin vencimiento evaluable es parcial.
            </p>
          )}
          {reconciliation.outsideObjects === null && (
            <p role="status" className="mt-2 text-amber-800">No se puede establecer qué queda fuera de los grupos: no se pudieron leer los datos necesarios.</p>
          )}
          <p className="mt-2 text-xs text-slate-600">El resto de la diferencia viene de importes negativos{unevaluated ? ` y de ${casesLabel(unevaluated)} sin evaluar` : ''}.</p>
        </details>
      </div>
    </AppShell>
  )
}
