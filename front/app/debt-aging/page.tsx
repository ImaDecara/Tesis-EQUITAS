import { PortfolioScope } from '@/components/equitas/portfolio-scope'
import { compareObjectIds, portfolioContext } from '@/lib/analytics'
import { filterPortfolio, portfolioHref, normalizePortfolioSearchParams, type RawPortfolioSearchParams } from '@/lib/portfolio-filters'
import { compareNullable, formatWithUnit, missingSummary, readingFailed } from '@/lib/data-presence'
import Link from 'next/link'
import { CalendarClock, CircleDollarSign, Eye, FileWarning } from 'lucide-react'

import {
  BarDistributionChart,
  TopDebtHorizontalChart,
} from '@/components/dashboard/chart-cards'
import { MetricCard } from '@/components/dashboard/metric-card'
import { DataWarnings } from '@/components/equitas/data-warnings'
import { PaginationControls, PaginationSummary } from '@/components/equitas/pagination-controls'
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
import { buildDebtAgingSummary, buildRecommendationSummary } from '@/lib/equitas-view-selectors'
import { paginateItems } from '@/lib/pagination'
import { formatCurrency } from '@/lib/utils'

export default async function DebtAgingPage({
  searchParams,
}: {
  searchParams: Promise<RawPortfolioSearchParams>
}) {
  const source = await getDebtorsData()
  const resolvedSearchParams = normalizePortfolioSearchParams(await searchParams)
  const filters = { ...resolvedSearchParams, page: undefined, pageSize: undefined }
  const { items: debtors, warnings, failed: selectionFailed } = filterPortfolio(source.debtors, filters, source.warnings)
  const buildDebtAgingHref = (page: number, pageSize: number) => portfolioHref('/debt-aging', filters, { page: String(page), pageSize: String(pageSize) })
  const summary = buildDebtAgingSummary(debtors, warnings)
  const queueSummary = buildRecommendationSummary(debtors, warnings)
  const debtByQueueChart = queueSummary.flatMap(group => group.interventionCode && group.debtAssociated !== null ? [{ label: group.recommendation, value: group.debtAssociated }] : [])
  const chartEmpty = warnings.length ? 'No disponible: lectura incompleta; consulte los avisos y la cobertura.' : debtors.length === 0 ? 'No hay objetos en la selección.' : 'No hay valores observados para graficar; consulte la cobertura.'
  const topDebtChart = summary.topDebtCases.flatMap((debtor) => debtor.totalDebt === null ? [] : [{
    label: debtor.identifier,
    value: debtor.totalDebt,
  }])
  const sortedDebtors = [...summary.cases].sort((a, b) => {
    if (b.overdueDebt !== a.overdueDebt) {
      return compareNullable(a.overdueDebt, b.overdueDebt)
    }

    return compareNullable(a.maxDaysOverdue, b.maxDaysOverdue) || compareObjectIds(a, b)
  })
  const pagination = paginateItems(
    sortedDebtors,
    resolvedSearchParams.page,
    resolvedSearchParams.pageSize
  )

  return (
    <AppShell>
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-[#163a63]">Deuda y mora</h1>
        <p className="text-sm text-slate-600">
          Analisis economico y antiguedad de la deuda municipal.
        </p>
      </section>

      <div className="space-y-6">
        <DataWarnings warnings={warnings} />
        <PortfolioScope context={portfolioContext(source.debtors, source.warnings, source.batch)} filters={filters} />
        <p className="text-xs text-slate-600">{missingSummary(summary.metrics)}</p>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <MetricCard
            label="Deuda total"
            value={formatCurrency(readingFailed(warnings, 'debtor', 'debt', 'debtor_profile') ? null : summary.totalDebt)}
            hint={`ARS de saldo histórico. ${summary.coverage.totalDebt}`}
            icon={CircleDollarSign}
            tone="primary"
          />
          <MetricCard
            label="Deuda vencida"
            value={formatCurrency(summary.overdueDebt)}
            hint={`ARS evaluables vencidos a la fecha declarada. ${summary.coverage.overdueDebt}`}
            icon={FileWarning}
            tone="danger"
          />
          <MetricCard
            label="Promedio de atraso"
            value={summary.metrics.averageOverdueDays.presence === 'NO_APLICA' ? 'No aplica' : formatWithUnit(summary.averageOverdueDays, 'dias')}
            hint={`Media del máximo por objeto con mora evaluable; parciales son mínimos. ${summary.coverage.averageOverdueDays}`}
            icon={CalendarClock}
            tone="warning"
          />
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <BarDistributionChart emptyMessage={chartEmpty} title="Monto evaluable por intervención (ARS)" data={debtByQueueChart} size="compact" />
          <TopDebtHorizontalChart emptyMessage={chartEmpty} title="Top deuda por objeto" data={topDebtChart} size="compact" />
          <BarDistributionChart emptyMessage={chartEmpty}
            title="Distribucion por atraso"
            data={summary.agingDistribution}
            size="compact"
          />
        </section>

        <Card className="border-[#d2dceb]">
          <CardHeader>
            <CardTitle>Top 10 mayor deuda</CardTitle>
            <CardDescription>Objetos con saldo histórico observado, en ARS. Desempate por identificador interno; no es orden de gestión.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table className="min-w-[820px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Objeto</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Deuda total</TableHead>
                  <TableHead className="text-right">Deuda vencida</TableHead>
                  <TableHead className="text-right">Atraso</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.topDebtCases.length === 0 && <TableRow><TableCell colSpan={5}>{summary.totalDebt === null ? 'No disponible: no hay importes observados o la lectura falló.' : 'Sin objetos con saldo observado.'}</TableCell></TableRow>}
                {summary.topDebtCases.map((debtor) => (
                  <TableRow key={debtor.id}>
                    <TableCell className="font-medium text-slate-900">{debtor.identifier}</TableCell>
                    <TableCell>{debtor.type}</TableCell>
                    <TableCell className="text-right">{formatCurrency(debtor.totalDebt)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(debtor.overdueDebt)}</TableCell>
                    <TableCell className="text-right">{formatWithUnit(debtor.maxDaysOverdue, 'dias')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-[#d2dceb]">
          <CardHeader>
            <CardTitle>Listado economico</CardTitle>
            <CardDescription>Objetos ordenados por deuda vencida y atraso.</CardDescription>
            {!selectionFailed && <PaginationSummary
              currentStart={pagination.currentStart}
              currentEnd={pagination.currentEnd}
              totalItems={sortedDebtors.length}
              itemLabel="objetos"
              pageSize={pagination.pageSize}
              buildHref={buildDebtAgingHref}
            />}
          </CardHeader>
          <CardContent>
            <Table className="min-w-[980px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Objeto</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Deuda total</TableHead>
                  <TableHead className="text-right">Deuda vencida</TableHead>
                  <TableHead className="text-right">Dias de atraso</TableHead>
                  <TableHead>Estado de catálogo</TableHead>
                  <TableHead className="text-right">Accion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagination.items.length === 0 && <TableRow><TableCell colSpan={7}>{selectionFailed ? 'No disponible: lectura incompleta.' : 'No hay objetos que coincidan con los filtros.'}</TableCell></TableRow>}
                {pagination.items.map((debtor) => (
                  <TableRow key={debtor.id}>
                    <TableCell className="font-medium text-slate-900">{debtor.identifier}</TableCell>
                    <TableCell>{debtor.type}</TableCell>
                    <TableCell className="text-right">{formatCurrency(debtor.totalDebt)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(debtor.overdueDebt)}</TableCell>
                    <TableCell className="text-right">{formatWithUnit(debtor.maxDaysOverdue, 'dias')}</TableCell>
                    <TableCell>
                      <Badge variant={debtor.overdueDebt !== null && debtor.overdueDebt > 0 ? 'danger' : 'neutral'}>
                        {debtor.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={portfolioHref(`/debtors/${encodeURIComponent(debtor.id)}`, filters)}
                        className={buttonVariants({ variant: 'default', size: 'sm' })}
                      >
                        <Eye className="size-3.5" />
                        Detalle
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!selectionFailed && <PaginationControls
              currentPage={pagination.currentPage}
              totalPages={pagination.totalPages}
              pageSize={pagination.pageSize}
              currentStart={pagination.currentStart}
              currentEnd={pagination.currentEnd}
              totalItems={sortedDebtors.length}
              itemLabel="objetos"
              buildHref={buildDebtAgingHref}
            />}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
