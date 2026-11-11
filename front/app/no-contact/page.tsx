import Link from 'next/link'
import { AlertCircle, Percent, ShieldAlert, WalletCards } from 'lucide-react'

import { MetricCard } from '@/components/dashboard/metric-card'
import { DataWarnings } from '@/components/equitas/data-warnings'
import { PaginationControls, PaginationSummary } from '@/components/equitas/pagination-controls'
import { AppShell } from '@/components/layout/app-shell'
import { DecisionColumnCell, DecisionColumnHead, DecisionsNotice, PriorityScoreBadge } from '@/components/portfolio/case-cells'
import { EmptyFilterState, emptyPortfolioScreen, PageHeading } from '@/components/portfolio/portfolio-state'
import { daysLabel, filterLine, filterNotes, missingLines, SCORE_LABEL } from '@/components/portfolio/portfolio-text'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableScrollHint } from '@/components/ui/table'
import { coverageText, sumMoney, withMaturityMetrics } from '@/lib/analytics'
import { aggregateData, formatNumber, formatPercentage, metric, observed, percentageData, readingFailed } from '@/lib/data-presence'
import { getDebtorsData } from '@/lib/equitas-data'
import { getNoContactCases } from '@/lib/equitas-view-selectors'
import { paginateItems } from '@/lib/pagination'
import { filterPortfolio, normalizePortfolioSearchParams, portfolioHref, type RawPortfolioSearchParams } from '@/lib/portfolio-filters'
import { loadRecordedDecisions } from '@/lib/server/recorded-decisions'
import { formatCurrency } from '@/lib/utils'

const TITLE = 'Casos sin contacto'

export default async function NoContactPage({ searchParams }: { searchParams: Promise<RawPortfolioSearchParams> }) {
  const empty = await emptyPortfolioScreen(TITLE)
  if (empty) return empty
  const [source, decisions] = await Promise.all([getDebtorsData(), loadRecordedDecisions()])
  const params = normalizePortfolioSearchParams(await searchParams)
  const filters = { ...params, page: undefined, pageSize: undefined }
  const active = Object.values(filters).some(Boolean)
  const { items: debtors, warnings, failed } = filterPortfolio(source.debtors, filters, source.warnings)
  const buildHref = (page: number, pageSize: number) => portfolioHref('/no-contact', filters, { page: String(page), pageSize: String(pageSize) })
  const noContactCases = getNoContactCases(debtors).map(withMaturityMetrics)
  const contactsFailed = readingFailed(warnings, 'debtor', 'debtor_contact', 'debtor_person')
  const pendingMetric = sumMoney(noContactCases.map(debtor => metric(debtor, 'pendingDebt')), contactsFailed || readingFailed(warnings, 'debt', 'debt_status'))
  const highRiskNoContact = aggregateData(noContactCases.map(debtor => debtor.risk === null ? metric(debtor, 'riskScore') : observed(debtor.risk === 'ALTO' ? 1 : 0)), 'sum', contactsFailed || readingFailed(warnings, 'debt', 'debtor_person'))
  const totalShare = percentageData(contactsFailed ? null : noContactCases.length, debtors.length)
  const pagination = paginateItems(noContactCases, params.page, params.pageSize)
  const missing = missingLines([['Deuda pendiente', pendingMetric], [SCORE_LABEL, highRiskNoContact]])

  return (
    <AppShell>
      <PageHeading title={TITLE} description="Casos sin un contacto activo cargado: antes de gestionarlos hay que conseguir o validar un teléfono o correo." />

      <div className="space-y-5">
        <DataWarnings warnings={source.warnings} />
        {filterNotes(warnings, source.warnings).map(note => <p key={note.message} role="status" className="text-sm text-amber-800">{note.message}</p>)}
        {active && <p className="text-sm text-slate-700">{filterLine(failed ? null : debtors.length, readingFailed(source.warnings, 'debtor') ? null : source.debtors.length)}</p>}
        {missing && <p className="text-xs text-slate-600">Datos faltantes que afectan los cálculos. {missing}.</p>}

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Total sin contacto" value={formatNumber(contactsFailed ? null : noContactCases.length)}
            hint={`Casos sin contacto activo cargado. ${coverageText(debtors.map(item => metric(item, 'contactCount')), contactsFailed, 'casos')}`} icon={AlertCircle} tone="warning" />
          <MetricCard label="Deuda pendiente sin contacto" value={formatCurrency(pendingMetric.value)}
            hint={`Total registrado sin las obligaciones pagadas, de estos casos. ${coverageText(noContactCases.map(item => metric(item, 'pendingDebt')), contactsFailed, 'casos')}`} icon={WalletCards} tone="primary" />
          <MetricCard label="Con puntaje alto" value={formatNumber(highRiskNoContact.value)}
            hint={`${SCORE_LABEL} desde 70. ${coverageText(noContactCases.map(item => metric(item, 'riskScore')), contactsFailed || readingFailed(warnings, 'debt', 'debtor_person'), 'casos')}`} icon={ShieldAlert} tone="danger" />
          <MetricCard label="Sobre el total" value={formatPercentage(totalShare)}
            hint={`Sobre ${contactsFailed ? 'los casos' : `los ${formatNumber(debtors.length)} casos`}${active ? ' que cumplen los filtros' : ' de la cartera'}, incluidos los que no tienen dato de contacto.`} icon={Percent} tone="accent" />
        </section>

        <Card className="border-[#d2dceb]">
          <CardHeader className="space-y-2">
            <CardTitle>Listado</CardTitle>
            <CardDescription>En el orden de su grupo de trabajo; los puntajes de grupos distintos no se comparan.</CardDescription>
            {!contactsFailed && (
              <PaginationSummary currentStart={pagination.currentStart} currentEnd={pagination.currentEnd} totalItems={noContactCases.length}
                itemLabel={['caso', 'casos']} pageSize={pagination.pageSize} buildHref={buildHref} />
            )}
            <DecisionsNotice decisions={decisions} />
          </CardHeader>
          <CardContent>
            <TableScrollHint />
            <Table className="table-fixed min-w-[36rem] md:min-w-[48rem]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[28%] md:w-[18%]">Identificador</TableHead>
                  <TableHead className="hidden w-[20%] md:table-cell">Personas vinculadas</TableHead>
                  <TableHead className="w-[24%] md:w-[13%]">{SCORE_LABEL}</TableHead>
                  <TableHead className="w-[22%] text-right md:w-[13%]">Deuda pendiente</TableHead>
                  <TableHead className="hidden w-[11%] text-right md:table-cell">Atraso máximo</TableHead>
                  <DecisionColumnHead decisions={decisions} className="w-[26%] md:w-[25%]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagination.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-slate-500">
                      {contactsFailed
                        ? 'No disponible: no se pudieron leer los casos o sus contactos.'
                        : active ? <EmptyFilterState clearHref="/no-contact" /> : 'Todos los casos tienen un contacto cargado.'}
                    </TableCell>
                  </TableRow>
                )}
                {pagination.items.map(debtor => (
                  <TableRow key={debtor.id}>
                    <TableCell className="align-top">
                      <Link href={portfolioHref(`/debtors/${encodeURIComponent(debtor.id)}`, filters)} className="font-medium break-words text-[#163a63] underline">{debtor.identifier}</Link>
                      <p className="text-xs text-slate-500">{debtor.type}</p>
                    </TableCell>
                    <TableCell className="hidden align-top md:table-cell">
                      <p className="truncate text-sm text-slate-700">
                        {debtor.peopleNames.length > 0
                          ? debtor.peopleNames.join(', ')
                          : readingFailed(warnings, 'person', 'debtor_person') ? 'No disponible: no se pudieron leer las personas.' : 'Sin personas vinculadas'}
                      </p>
                    </TableCell>
                    <TableCell className="align-top"><PriorityScoreBadge debtor={debtor} /></TableCell>
                    <TableCell className="text-right align-top">{formatCurrency(debtor.pendingDebt)}</TableCell>
                    <TableCell className="hidden text-right align-top md:table-cell">{daysLabel(debtor.maxDaysOverdue)}</TableCell>
                    <TableCell className="align-top"><DecisionColumnCell decisions={decisions} debtorId={debtor.id} href={portfolioHref(`/debtors/${encodeURIComponent(debtor.id)}`, filters)} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!contactsFailed && (
              <PaginationControls currentPage={pagination.currentPage} totalPages={pagination.totalPages} pageSize={pagination.pageSize}
                currentStart={pagination.currentStart} currentEnd={pagination.currentEnd} totalItems={noContactCases.length}
                itemLabel={['caso', 'casos']} buildHref={buildHref} />
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
