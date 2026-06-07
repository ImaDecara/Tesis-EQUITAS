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
import { buildDebtAgingSummary } from '@/lib/equitas-view-selectors'
import { paginateItems } from '@/lib/pagination'
import { formatCurrency } from '@/lib/utils'

type DebtAgingSearchParams = {
  page?: string
  pageSize?: string
}

function buildDebtAgingHref(page: number, pageSize: number) {
  const params = new URLSearchParams()

  if (page > 1) params.set('page', String(page))
  if (pageSize !== 10) params.set('pageSize', String(pageSize))

  const queryString = params.toString()

  return queryString ? `/debt-aging?${queryString}` : '/debt-aging'
}

export default async function DebtAgingPage({
  searchParams,
}: {
  searchParams: Promise<DebtAgingSearchParams>
}) {
  const { debtors, warnings } = await getDebtorsData()
  const resolvedSearchParams = await searchParams
  const summary = buildDebtAgingSummary(debtors)
  const debtByStatus = [...debtors]
    .reduce((map, debtor) => {
      map.set(debtor.status, (map.get(debtor.status) ?? 0) + debtor.totalDebt)

      return map
    }, new Map<string, number>())
  const debtByStatusChart = Array.from(debtByStatus.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
  const topDebtChart = summary.topDebtCases.map((debtor) => ({
    label: debtor.identifier,
    value: debtor.totalDebt,
  }))
  const sortedDebtors = [...debtors].sort((a, b) => {
    if (b.overdueDebt !== a.overdueDebt) {
      return b.overdueDebt - a.overdueDebt
    }

    return b.maxDaysOverdue - a.maxDaysOverdue
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

        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <MetricCard
            label="Deuda total"
            value={formatCurrency(summary.totalDebt)}
            hint="Saldo consolidado"
            icon={CircleDollarSign}
            tone="primary"
          />
          <MetricCard
            label="Deuda vencida"
            value={formatCurrency(summary.overdueDebt)}
            hint="Saldo con vencimiento registrado"
            icon={FileWarning}
            tone="danger"
          />
          <MetricCard
            label="Promedio de atraso"
            value={`${summary.averageOverdueDays.toLocaleString('es-AR')} dias`}
            hint="Sobre objetos con mora"
            icon={CalendarClock}
            tone="warning"
          />
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <BarDistributionChart title="Deuda por estado" data={debtByStatusChart} size="compact" />
          <TopDebtHorizontalChart title="Top deuda por objeto" data={topDebtChart} size="compact" />
          <BarDistributionChart
            title="Distribucion por atraso"
            data={summary.agingDistribution}
            size="compact"
          />
        </section>

        <Card className="border-[#d2dceb]">
          <CardHeader>
            <CardTitle>Top 10 mayor deuda</CardTitle>
            <CardDescription>Objetos con mayor saldo total asociado.</CardDescription>
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
                {summary.topDebtCases.map((debtor) => (
                  <TableRow key={debtor.id}>
                    <TableCell className="font-medium text-slate-900">{debtor.identifier}</TableCell>
                    <TableCell>{debtor.type}</TableCell>
                    <TableCell className="text-right">{formatCurrency(debtor.totalDebt)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(debtor.overdueDebt)}</TableCell>
                    <TableCell className="text-right">{debtor.maxDaysOverdue} dias</TableCell>
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
            <PaginationSummary
              currentStart={pagination.currentStart}
              currentEnd={pagination.currentEnd}
              totalItems={sortedDebtors.length}
              itemLabel="objetos"
              pageSize={pagination.pageSize}
              buildHref={buildDebtAgingHref}
            />
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
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Accion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagination.items.map((debtor) => (
                  <TableRow key={debtor.id}>
                    <TableCell className="font-medium text-slate-900">{debtor.identifier}</TableCell>
                    <TableCell>{debtor.type}</TableCell>
                    <TableCell className="text-right">{formatCurrency(debtor.totalDebt)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(debtor.overdueDebt)}</TableCell>
                    <TableCell className="text-right">{debtor.maxDaysOverdue} dias</TableCell>
                    <TableCell>
                      <Badge variant={debtor.overdueDebt > 0 ? 'danger' : 'neutral'}>
                        {debtor.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/debtors/${encodeURIComponent(debtor.id)}`}
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
            <PaginationControls
              currentPage={pagination.currentPage}
              totalPages={pagination.totalPages}
              pageSize={pagination.pageSize}
              currentStart={pagination.currentStart}
              currentEnd={pagination.currentEnd}
              totalItems={sortedDebtors.length}
              itemLabel="objetos"
              buildHref={buildDebtAgingHref}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
