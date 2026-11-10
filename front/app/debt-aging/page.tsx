import Link from 'next/link'
import { CalendarClock, CircleDollarSign, FileWarning, WalletCards } from 'lucide-react'

import { BarDistributionChart, TopDebtHorizontalChart } from '@/components/dashboard/chart-cards'
import { MetricCard } from '@/components/dashboard/metric-card'
import { DataWarnings } from '@/components/equitas/data-warnings'
import { PaginationControls, PaginationSummary } from '@/components/equitas/pagination-controls'
import { AppShell } from '@/components/layout/app-shell'
import { emptyPortfolioScreen, PageHeading } from '@/components/portfolio/portfolio-state'
import { daysLabel, filterLine, filterNotes, missingLines } from '@/components/portfolio/portfolio-text'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { compareObjectIds, coverageText } from '@/lib/analytics'
import { compareNullable, metric, readingFailed } from '@/lib/data-presence'
import { getDebtorsData } from '@/lib/equitas-data'
import { buildDebtAgingSummary, buildRecommendationSummary } from '@/lib/equitas-view-selectors'
import { paginateItems } from '@/lib/pagination'
import { filterPortfolio, normalizePortfolioSearchParams, portfolioHref, type RawPortfolioSearchParams } from '@/lib/portfolio-filters'
import { formatCurrency } from '@/lib/utils'
import type { DebtorListItem } from '@/types/equitas-domain'

const TITLE = 'Deuda y mora'
const AGING_LABELS: Record<string, string> = { '1-30 dias': '1 a 30 días', '31-90 dias': '31 a 90 días', '+90 dias': 'Más de 90 días' }

export default async function DebtAgingPage({ searchParams }: { searchParams: Promise<RawPortfolioSearchParams> }) {
  const empty = await emptyPortfolioScreen(TITLE)
  if (empty) return empty
  const source = await getDebtorsData()
  const params = normalizePortfolioSearchParams(await searchParams)
  const filters = { ...params, page: undefined, pageSize: undefined }
  const active = Object.values(filters).some(Boolean)
  const { items: debtors, warnings, failed: selectionFailed } = filterPortfolio(source.debtors, filters, source.warnings)
  const buildHref = (page: number, pageSize: number) => portfolioHref('/debt-aging', filters, { page: String(page), pageSize: String(pageSize) })
  const summary = buildDebtAgingSummary(debtors, warnings)
  const pendingCoverage = coverageText(debtors.map(item => metric(item, 'pendingDebt')), readingFailed(warnings, 'debtor', 'debt', 'debt_status'), 'casos')
  const debtByQueueChart = buildRecommendationSummary(debtors, warnings)
    .flatMap(group => group.interventionCode && group.debtAssociated !== null ? [{ label: group.recommendation, value: group.debtAssociated }] : [])
  const readFailed = warnings.length > 0
  const chartEmpty = readFailed ? 'No disponible: no se pudieron leer los datos necesarios.' : debtors.length === 0 ? 'No hay casos en la selección.' : 'No hay importes para graficar.'
  const topDebtChart = summary.topDebtCases.flatMap(debtor => debtor.totalDebt === null ? [] : [{ label: debtor.identifier, value: debtor.totalDebt }])
  const agingChart = summary.agingDistribution.map(item => ({ label: AGING_LABELS[item.label] ?? item.label, value: item.value }))
  const sortedDebtors = [...summary.cases].sort((a, b) =>
    a.overdueDebt !== b.overdueDebt ? compareNullable(a.overdueDebt, b.overdueDebt) : compareNullable(a.maxDaysOverdue, b.maxDaysOverdue) || compareObjectIds(a, b))
  const pagination = paginateItems(sortedDebtors, params.page, params.pageSize)
  const missing = missingLines([['Total registrado', summary.metrics.totalDebt], ['Deuda pendiente', summary.metrics.pendingDebt], ['Deuda vencida', summary.metrics.overdueDebt]])
  // Filas de las dos tablas: una llamada, no un componente, para que la tabla quede en el árbol de la página.
  const rows = (cases: DebtorListItem[]) => cases.map(debtor => (
    <TableRow key={debtor.id}>
      <TableCell className="align-top">
        <Link href={portfolioHref(`/debtors/${encodeURIComponent(debtor.id)}`, filters)} className="font-medium break-words text-[#163a63] underline">{debtor.identifier}</Link>
        <p className="text-xs text-slate-500 md:hidden">{debtor.type}</p>
      </TableCell>
      <TableCell className="hidden align-top md:table-cell">{debtor.type}</TableCell>
      <TableCell className="hidden text-right align-top md:table-cell">{formatCurrency(debtor.totalDebt)}</TableCell>
      <TableCell className="text-right align-top">{formatCurrency(debtor.pendingDebt)}</TableCell>
      <TableCell className="text-right align-top">{formatCurrency(debtor.overdueDebt)}</TableCell>
      <TableCell className="hidden text-right align-top md:table-cell">{daysLabel(debtor.maxDaysOverdue)}</TableCell>
    </TableRow>
  ))
  const header = (
    <TableHeader>
      <TableRow>
        <TableHead className="w-[34%] md:w-[22%]">Identificador</TableHead>
        <TableHead className="hidden w-[14%] md:table-cell">Tipo</TableHead>
        <TableHead className="hidden w-[16%] text-right md:table-cell">Total registrado</TableHead>
        <TableHead className="w-[33%] text-right md:w-[16%]">Deuda pendiente</TableHead>
        <TableHead className="w-[33%] text-right md:w-[16%]">Deuda vencida</TableHead>
        <TableHead className="hidden w-[16%] text-right md:table-cell">Atraso máximo</TableHead>
      </TableRow>
    </TableHeader>
  )

  return (
    <AppShell>
      <PageHeading title={TITLE} description="Importes de la cartera y antigüedad de la deuda vencida, con las mismas definiciones que el tablero." />

      <div className="space-y-5">
        <DataWarnings warnings={source.warnings} />
        {filterNotes(warnings, source.warnings).map(note => <p key={note.message} role="status" className="text-sm text-amber-800">{note.message}</p>)}
        {active && <p className="text-sm text-slate-700">{filterLine(selectionFailed ? null : debtors.length, readingFailed(source.warnings, 'debtor') ? null : source.debtors.length)}</p>}
        {missing && <p className="text-xs text-slate-600">Datos faltantes que afectan los cálculos. {missing}.</p>}

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Total registrado" value={formatCurrency(summary.totalDebt)}
            hint={`Todas las obligaciones, cualquiera sea su estado. ${summary.coverage.totalDebt}`} icon={CircleDollarSign} tone="primary" />
          <MetricCard label="Deuda pendiente" value={formatCurrency(summary.metrics.pendingDebt.value)}
            hint={`Total registrado sin las obligaciones pagadas. ${pendingCoverage}`} icon={WalletCards} tone="accent" />
          <MetricCard label="Deuda vencida" value={formatCurrency(summary.overdueDebt)}
            hint={`Deuda pendiente con vencimiento anterior a la fecha de la cartera. ${summary.coverage.overdueDebt}`} icon={FileWarning} tone="danger" />
          <MetricCard label="Promedio de atraso" value={summary.metrics.averageOverdueDays.presence === 'NO_APLICA' ? 'No aplica' : daysLabel(summary.averageOverdueDays)}
            hint={`Promedio del atraso máximo de cada caso con deuda vencida. ${summary.coverage.averageOverdueDays}`} icon={CalendarClock} tone="warning" />
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <BarDistributionChart emptyMessage={chartEmpty} title="Deuda pendiente evaluable por grupo de trabajo" data={debtByQueueChart} size="compact" />
          <TopDebtHorizontalChart emptyMessage={chartEmpty} title="Casos con mayor total registrado" data={topDebtChart} size="compact" />
          <BarDistributionChart emptyMessage={chartEmpty} title="Casos por atraso máximo" data={agingChart} size="compact" />
        </section>

        <Card className="border-[#d2dceb]">
          <CardHeader>
            <CardTitle>Los 10 casos con mayor total registrado</CardTitle>
            <CardDescription>Ordenados por total registrado; no es un orden de gestión.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table className="table-fixed">
              {header}
              <TableBody>
                {summary.topDebtCases.length === 0 && (
                  <TableRow><TableCell colSpan={6}>{summary.totalDebt === null ? 'No disponible: no se pudieron leer los importes.' : 'No hay casos con importes registrados.'}</TableCell></TableRow>
                )}
                {rows(summary.topDebtCases)}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-[#d2dceb]">
          <CardHeader className="space-y-2">
            <CardTitle>Casos por deuda vencida</CardTitle>
            <CardDescription>Ordenados por deuda vencida y, a igual importe, por atraso máximo.</CardDescription>
            {!selectionFailed && (
              <PaginationSummary currentStart={pagination.currentStart} currentEnd={pagination.currentEnd} totalItems={sortedDebtors.length}
                itemLabel={['caso', 'casos']} pageSize={pagination.pageSize} buildHref={buildHref} />
            )}
          </CardHeader>
          <CardContent>
            <Table className="table-fixed">
              {header}
              <TableBody>
                {pagination.items.length === 0 && (
                  <TableRow><TableCell colSpan={6}>{selectionFailed ? 'No disponible: no se pudieron leer los datos.' : active ? 'No hay casos que cumplan los filtros elegidos.' : 'La cartera no tiene casos.'}</TableCell></TableRow>
                )}
                {rows(pagination.items)}
              </TableBody>
            </Table>
            {!selectionFailed && (
              <PaginationControls currentPage={pagination.currentPage} totalPages={pagination.totalPages} pageSize={pagination.pageSize}
                currentStart={pagination.currentStart} currentEnd={pagination.currentEnd} totalItems={sortedDebtors.length}
                itemLabel={['caso', 'casos']} buildHref={buildHref} />
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
