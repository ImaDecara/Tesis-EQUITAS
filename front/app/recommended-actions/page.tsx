import { PortfolioScope } from '@/components/equitas/portfolio-scope'
import { portfolioContext } from '@/lib/analytics'
import { filterPortfolio, portfolioHref, type PortfolioSearchParams } from '@/lib/portfolio-filters'
import { formatNumber, formatWithUnit, missingSummary } from '@/lib/data-presence'
import Link from 'next/link'
import { ClipboardCheck, Eye } from 'lucide-react'

import { MetricCard } from '@/components/dashboard/metric-card'
import { DataWarnings } from '@/components/equitas/data-warnings'
import { AppShell } from '@/components/layout/app-shell'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getDebtorsData } from '@/lib/equitas-data'
import {
  buildQueueReconciliation,
  buildRecommendationSummary,
  RECOMMENDATION_BADGE_VARIANT,
  RECOMMENDATION_KINDS,
} from '@/lib/equitas-view-selectors'
import { formatCurrency } from '@/lib/utils'

export const dynamic = 'force-dynamic'

function countLabel(count: number, singular: string, plural: string) {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`
}

export default async function RecommendedActionsPage({ searchParams }: { searchParams?: Promise<PortfolioSearchParams> } = {}) {
  const source = await getDebtorsData()
  const filters = await searchParams ?? {}
  const { items: debtors, warnings } = filterPortfolio(source.debtors, filters, source.warnings)
  const summary = buildRecommendationSummary(debtors, warnings)
  const reconciliation = buildQueueReconciliation(debtors, warnings)
  const queueMissing = missingSummary({ totalDebtAssociated: reconciliation.queueTotal })
  const totalMissing = missingSummary({ totalDebt: reconciliation.dashboardTotal })
  const outsideDetail = reconciliation.outsideObjects === null ? null
    : `${countLabel(reconciliation.outsideObjects, 'objeto', 'objetos')} · ${countLabel(reconciliation.outsideObligations!, 'obligación', 'obligaciones')}`
  const reconciliationRows: { label: string; value: string; detail?: string | null }[] = [
    { label: 'Suma de las colas', value: formatCurrency(reconciliation.queueTotal.value), detail: queueMissing && `Faltantes: ${queueMissing}` },
    { label: 'Deuda total del tablero', value: formatCurrency(reconciliation.dashboardTotal.value), detail: totalMissing && `Faltantes: ${totalMissing}` },
    { label: 'Diferencia con el tablero', value: formatCurrency(reconciliation.difference.value) },
    { label: 'Importe sin vencimiento evaluable', value: formatCurrency(reconciliation.outsideAmount.value), detail: outsideDetail },
    { label: 'Resto de la diferencia', value: formatCurrency(reconciliation.otherDifference.value) },
  ]

  return (
    <AppShell>
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-[#163a63]">
          Acciones recomendadas
        </h1>
        <p className="text-sm text-slate-600">
          Estrategia de gestion agrupada por recomendacion operativa.
        </p>
      </section>

      <div className="space-y-6">
        <DataWarnings warnings={warnings} />
        <PortfolioScope context={portfolioContext(source.debtors, source.warnings)} filters={filters} />
        <p className="text-xs text-slate-600">{summary.map(group => missingSummary(group.metrics)).filter(Boolean).join("; ")}</p>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {RECOMMENDATION_KINDS.map((recommendation) => {
            const item = summary.find((group) => group.recommendation === recommendation)

            return (
              <MetricCard
                key={recommendation}
                label={recommendation}
                value={formatNumber(item?.count ?? null)}
                hint={`ARS evaluables: ${formatCurrency(item?.debtAssociated ?? null)}. ${item?.coverage.totalDebt ?? ""}`}
                icon={ClipboardCheck}
                tone={
                  recommendation === 'Llamado prioritario'
                    ? 'danger'
                    : recommendation === 'Plan de pago / revision humana'
                      ? 'primary'
                      : recommendation === 'Mensaje recordatorio'
                        ? 'warning'
                        : 'success'
                }
              />
            )
          })}
        </section>

        <Card className="border-[#d2dceb]">
          <CardHeader>
            <CardTitle>Qué suma el monto de cada cola</CardTitle>
            <CardDescription>
              Cada cola suma el importe actual de las obligaciones evaluables de sus objetos: importe
              observado y no negativo, con vencimiento válido, vencidas o no. Cada objeto cuenta una vez y
              no se usan los importes del perfil.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-700">
            <dl className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
              {reconciliationRows.map(row => (
                <div key={row.label}>
                  <dt className="text-xs font-medium text-slate-600">{row.label}</dt>
                  <dd className="text-lg font-semibold text-[#163a63]">{row.value}</dd>
                  {row.detail && <dd className="text-xs text-slate-600">{row.detail}</dd>}
                </div>
              ))}
            </dl>
            {reconciliation.outsideWithoutAmount !== null && reconciliation.outsideWithoutAmount > 0 && (
              <p role="status" className="text-amber-800">
                {reconciliation.outsideWithoutAmount === 1
                  ? '1 de esas obligaciones no tiene importe observado: '
                  : `${formatNumber(reconciliation.outsideWithoutAmount)} de esas obligaciones no tienen importe observado: `}
                no se suma como 0 y el importe sin vencimiento evaluable es parcial.
              </p>
            )}
            {reconciliation.outsideObjects === null && (
              <p role="status" className="text-amber-800">
                No se puede establecer qué queda fuera de las colas: no se pudieron leer los datos
                necesarios. Revise los avisos de lectura.
              </p>
            )}
            <p>
              Por qué no coincide con el tablero: el tablero suma el total de cada objeto (el del perfil
              persistido o, si no hay, todas sus obligaciones con importe, tengan o no vencimiento). Las
              colas dejan fuera el importe de las obligaciones sin vencimiento evaluable. El resto de la
              diferencia viene de totales del perfil distintos de la suma de obligaciones, importes
              negativos y objetos sin decisión.
            </p>
          </CardContent>
        </Card>

        <Card className="border-[#d2dceb]">
          <CardHeader>
            <CardTitle>Resumen por recomendacion</CardTitle>
            <CardDescription>
              Cada cola se ordena por su propia prioridad; hasta 3 casos destacados. Severidad parcial significa un mínimo. No se comparan prioridades entre colas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table className="min-w-[1120px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Intervención</TableHead>
                  <TableHead className="text-right">Cantidad de casos</TableHead>
                  <TableHead className="text-right">Monto evaluable (ARS)</TableHead>
                  <TableHead className="text-right">Severidad media (puntos de 0 a 100)</TableHead>
                  <TableHead>Casos destacados</TableHead>
                  <TableHead className="text-right">Accion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.map((group) => {

                  return (
                    <TableRow key={group.recommendation}>
                      <TableCell>
                        <Badge variant={RECOMMENDATION_BADGE_VARIANT[group.recommendation]}>
                          {group.recommendation}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatNumber(group.count)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(group.debtAssociated)}<p className="text-xs">{group.coverage.totalDebt}</p>
                      </TableCell>
                      <TableCell className="text-right">
                        {group.metrics.riskScore.presence === 'NO_APLICA' ? 'No aplica' : formatWithUnit(group.averageRisk, '/ 100', 1)}<p className="text-xs">{group.coverage.riskScore}</p>
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-[420px] flex-wrap gap-2">
                          {group.highlightedCases.length === 0 && (
                            <span className="text-sm text-slate-500">{group.count === null ? 'No disponible: lectura incompleta.' : 'Sin casos'}</span>
                          )}
                          {group.highlightedCases.map((debtor) => (
                            <Link
                              key={debtor.id}
                              href={portfolioHref(`/debtors/${encodeURIComponent(debtor.id)}`, filters)}
                              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-[#163a63] hover:bg-[#edf2f9]"
                            >
                              {debtor.identifier}
                            </Link>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {group.count !== null ? (
                          <Link
                            href={portfolioHref('/priority-cases', filters, { queue: group.interventionCode ?? 'SIN_COLA', page: '' })}
                            className={buttonVariants({ variant: 'default', size: 'sm' })}
                          >
                            <Eye className="size-3.5" />
                            Ver casos
                          </Link>
                        ) : (
                          <span className="text-sm text-slate-400">{group.count === null ? 'No disponible: lectura incompleta.' : 'Sin casos'}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
