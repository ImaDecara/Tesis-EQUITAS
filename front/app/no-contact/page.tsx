import { PortfolioScope } from '@/components/equitas/portfolio-scope'
import { coverageText, portfolioContext, sumMoney } from '@/lib/analytics'
import { filterPortfolio, portfolioHref, type PortfolioSearchParams } from '@/lib/portfolio-filters'
import { formatNumber, formatWithUnit, aggregateData, metric, missingSummary, observed, percentageData, formatPercentage, readingFailed } from '@/lib/data-presence'
import Link from 'next/link'
import { AlertCircle, CircleDollarSign, Eye, Percent, ShieldAlert } from 'lucide-react'

import { MetricCard } from '@/components/dashboard/metric-card'
import { DataWarnings } from '@/components/equitas/data-warnings'
import { PaginationControls, PaginationSummary } from '@/components/equitas/pagination-controls'
import { RiskBadge } from '@/components/equitas/risk-badge'
import { AppShell } from '@/components/layout/app-shell'
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
import { getNoContactCases } from '@/lib/equitas-view-selectors'
import { paginateItems } from '@/lib/pagination'
import { formatCurrency } from '@/lib/utils'

export default async function NoContactPage({
  searchParams,
}: {
  searchParams: Promise<PortfolioSearchParams>
}) {
  const source = await getDebtorsData()
  const resolvedSearchParams = await searchParams
  const filters = { ...resolvedSearchParams, page: undefined, pageSize: undefined }
  const { items: debtors, warnings } = filterPortfolio(source.debtors, filters, source.warnings)
  const buildNoContactHref = (page: number, pageSize: number) => portfolioHref('/no-contact', filters, { page: String(page), pageSize: String(pageSize) })
  const noContactCases = getNoContactCases(debtors)
  const associatedDebt = sumMoney(noContactCases.map(debtor => metric(debtor, 'totalDebt')), readingFailed(warnings, 'debtor', 'debt', 'debtor_profile', 'debtor_contact', 'debtor_person')).value
  const contactsFailed = readingFailed(warnings, 'debtor', 'debtor_contact', 'debtor_person')
  const highRiskMetric = aggregateData(noContactCases.map(debtor => debtor.risk === null ? metric(debtor, 'riskScore') : observed(debtor.risk === 'ALTO' ? 1 : 0)), 'sum', contactsFailed || readingFailed(warnings, 'debt', 'debtor_person'))
  const highRiskNoContact = highRiskMetric.value
  const totalShare =
    percentageData(readingFailed(warnings, 'debtor', 'debtor_contact', 'debtor_person') ? null : noContactCases.length, debtors.length)
  const pagination = paginateItems(
    noContactCases,
    resolvedSearchParams.page,
    resolvedSearchParams.pageSize
  )

  return (
    <AppShell>
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-[#163a63]">
          Casos sin contacto
        </h1>
        <p className="text-sm text-slate-600">
          Casos bloqueados por falta de canal activo para gestion directa.
        </p>
      </section>

      <div className="space-y-6">
        <DataWarnings warnings={warnings} />
        <PortfolioScope context={portfolioContext(source.debtors, source.warnings, source.batch)} filters={filters} />
        <p className="text-xs text-slate-600">{missingSummary({ riskScore: highRiskMetric })}</p>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Total sin contacto"
            value={formatNumber(contactsFailed ? null : noContactCases.length)}
            hint={`Objetos sin contacto cargado. ${coverageText(debtors.map(item => metric(item, 'contactCount')), contactsFailed)}`}
            icon={AlertCircle}
            tone="warning"
          />
          <MetricCard
            label="Deuda asociada"
            value={formatCurrency(associatedDebt)}
            hint={`ARS históricos de los objetos sin contacto. ${coverageText(noContactCases.map(item => metric(item, 'totalDebt')), contactsFailed || readingFailed(warnings, 'debt', 'debtor_profile'))}`}
            icon={CircleDollarSign}
            tone="primary"
          />
          <MetricCard
            label="Severidad alta sin contacto"
            value={formatNumber(highRiskNoContact)}
            hint={`Desde 70 puntos. ${coverageText(noContactCases.map(item => metric(item, 'riskScore')), contactsFailed || readingFailed(warnings, 'debt', 'debtor_person'))}`}
            icon={ShieldAlert}
            tone="danger"
          />
          <MetricCard
            label="Sobre el total"
            value={`${formatPercentage(totalShare)}`}
            hint={`Denominador: ${formatWithUnit(contactsFailed ? null : debtors.length, 'objetos filtrados')}, incluidos los sin dato de contacto.`}
            icon={Percent}
            tone="accent"
          />
        </section>

        <Card className="border-[#d2dceb] bg-[#f8f2e3]">
          <CardContent className="p-4 text-sm text-[#5f4a19]">
            Estos casos requieren validacion o enriquecimiento de datos antes de iniciar gestion
            directa.
          </CardContent>
        </Card>

        <Card className="border-[#d2dceb]">
          <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between md:space-y-0">
            <div>
              <CardTitle>Listado de casos sin contacto</CardTitle>
              <CardDescription>Orden de cola: prioridad, monto evaluable, vencimiento e identificador interno. Las prioridades de colas distintas no se comparan.</CardDescription>
              {!contactsFailed && <PaginationSummary
                currentStart={pagination.currentStart}
                currentEnd={pagination.currentEnd}
                totalItems={noContactCases.length}
                itemLabel="casos"
                pageSize={pagination.pageSize}
                buildHref={buildNoContactHref}
              />}
            </div>
          </CardHeader>
          <CardContent>
            <Table className="min-w-[1080px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Objeto</TableHead>
                  <TableHead>Personas asociadas</TableHead>
                  <TableHead>Severidad (puntos de 0 a 100)</TableHead>
                  <TableHead className="text-right">Deuda</TableHead>
                  <TableHead className="text-right">Atraso</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead className="text-right">Accion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagination.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-slate-500">
                      {contactsFailed ? 'No disponible: lectura incompleta de objetos o contactos.' : 'No hay casos sin contacto.'}
                    </TableCell>
                  </TableRow>
                )}
                {pagination.items.map((debtor) => (
                  <TableRow key={debtor.id}>
                    <TableCell>
                      <div className="font-medium text-slate-900">{debtor.identifier}</div>
                      <p className="text-xs text-slate-500">{debtor.type}</p>
                    </TableCell>
                    <TableCell>
                      <p className="max-w-[260px] truncate text-sm text-slate-700">
                        {debtor.peopleNames.length > 0
                          ? debtor.peopleNames.join(', ')
                          : readingFailed(warnings, 'person', 'debtor_person') ? 'No disponible: lectura de personas fallida.' : 'Sin personas informadas'}
                      </p>
                    </TableCell>
                    <TableCell>
                      <RiskBadge risk={debtor.risk} score={debtor.riskScore} />
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(debtor.totalDebt)}</TableCell>
                    <TableCell className="text-right">{formatWithUnit(debtor.maxDaysOverdue, 'dias')}</TableCell>
                    <TableCell>Sin telefono/email activo</TableCell>
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
            {!contactsFailed && <PaginationControls
              currentPage={pagination.currentPage}
              totalPages={pagination.totalPages}
              pageSize={pagination.pageSize}
              currentStart={pagination.currentStart}
              currentEnd={pagination.currentEnd}
              totalItems={noContactCases.length}
              itemLabel="casos"
              buildHref={buildNoContactHref}
            />}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
