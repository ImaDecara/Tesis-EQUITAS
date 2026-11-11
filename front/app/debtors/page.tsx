import Link from 'next/link'
import { SlidersHorizontal } from 'lucide-react'

import { ContactAvailabilityBadge } from '@/components/debtors/contact-availability-badge'
import { DebtorsFiltersForm } from '@/components/debtors/debtors-filters-form'
import { DataWarnings } from '@/components/equitas/data-warnings'
import { PaginationControls, PaginationSummary } from '@/components/equitas/pagination-controls'
import { AppShell } from '@/components/layout/app-shell'
import { DecisionColumnCell, DecisionColumnHead, DecisionsNotice, PriorityScoreBadge } from '@/components/portfolio/case-cells'
import { EmptyFilterState, emptyPortfolioScreen, PageHeading } from '@/components/portfolio/portfolio-state'
import { bandLabel, casesLabel, filterLine, filterNotes, SCORE_LABEL, SCORE_NOTE } from '@/components/portfolio/portfolio-text'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableScrollHint } from '@/components/ui/table'
import { readingFailed } from '@/lib/data-presence'
import { getDebtorsData } from '@/lib/equitas-data'
import { paginateItems } from '@/lib/pagination'
import { filterPortfolio, normalizePortfolioSearchParams, portfolioHref, type RawPortfolioSearchParams } from '@/lib/portfolio-filters'
import { loadRecordedDecisions } from '@/lib/server/recorded-decisions'
import { formatCurrency } from '@/lib/utils'

const TITLE = 'Casos'
const FILTER_KEYS = ['q', 'risk', 'status', 'type', 'contact', 'personId', 'minAmount', 'queue'] as const
type DebtorFilters = Record<(typeof FILTER_KEYS)[number], string>

export default async function DebtorsPage({ searchParams }: { searchParams: Promise<RawPortfolioSearchParams> }) {
  const empty = await emptyPortfolioScreen(TITLE)
  if (empty) return empty
  const [{ debtors, warnings }, decisions] = await Promise.all([getDebtorsData(), loadRecordedDecisions()])
  const params = normalizePortfolioSearchParams(await searchParams)
  const filters = Object.fromEntries(FILTER_KEYS.map(key => [key, params[key]?.trim() ?? ''])) as DebtorFilters
  const selection = filterPortfolio(debtors, filters, warnings)
  const filteredDebtors = selection.items
  const pagination = paginateItems(filteredDebtors, params.page, params.pageSize)
  const buildHref = (page: number, pageSize: number) => portfolioHref('/debtors', filters, { page: String(page), pageSize: String(pageSize) })
  const active = FILTER_KEYS.some(key => filters[key])
  const universeFailed = readingFailed(warnings, 'debtor')
  const notEvaluated = filteredDebtors.filter(item => !item.decision).length
  const linked = filters.personId ? debtors.find(item => item.peopleIds.includes(filters.personId)) : undefined
  const personName = linked?.peopleNames[linked.peopleIds.indexOf(filters.personId)]
  const statusOptions = [...new Set(debtors.map(debtor => debtor.status))].sort()
  const typeOptions = [...new Set(debtors.map(debtor => debtor.type))].sort()

  return (
    <AppShell>
      <PageHeading title={TITLE} description={`Cada caso es un objeto tributario (un inmueble, un rodado, una conexión), no una persona. ${SCORE_LABEL}: ${SCORE_NOTE.toLowerCase()}`} />

      <div className="space-y-5">
        <DataWarnings warnings={warnings} />
        {filterNotes(selection.warnings, warnings).map(note => <p key={note.message} role="status" className="text-sm text-amber-800">{note.message}</p>)}

        <Card className="border-[#d2dceb]">
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-2">
              <SlidersHorizontal className="size-4 text-[#163a63]" />
              Filtros
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DebtorsFiltersForm key={JSON.stringify(filters)} initialValues={filters} riskOptions={['ALTO', 'MEDIO', 'BAJO']} statusOptions={statusOptions} typeOptions={typeOptions} />
            {active && (
              <div className="mt-3 flex flex-wrap gap-2" aria-label="Filtros activos">
                {filters.q && <Badge variant="neutral">Búsqueda: {filters.q}</Badge>}
                {filters.risk && <Badge variant="neutral">{SCORE_LABEL}: {bandLabel(filters.risk)}</Badge>}
                {filters.status && <Badge variant="neutral">Estado: {filters.status}</Badge>}
                {filters.type && <Badge variant="neutral">Tipo: {filters.type}</Badge>}
                {filters.contact && <Badge variant="neutral">Contacto: {filters.contact === 'with' ? 'Disponible' : 'Faltante'}</Badge>}
                {filters.personId && <Badge variant="neutral">Persona vinculada: {personName ?? 'seleccionada desde Personas'}</Badge>}
                {filters.minAmount && <Badge variant="neutral">Total registrado desde: {filters.minAmount}</Badge>}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-[#d2dceb]">
          <CardHeader className="space-y-2">
            <CardTitle>Listado de casos</CardTitle>
            {active && <p className="text-sm text-slate-700">{filterLine(selection.failed ? null : filteredDebtors.length, universeFailed ? null : debtors.length)}</p>}
            {!selection.failed && (
              <PaginationSummary currentStart={pagination.currentStart} currentEnd={pagination.currentEnd} totalItems={filteredDebtors.length}
                itemLabel={['caso', 'casos']} pageSize={pagination.pageSize} buildHref={buildHref} />
            )}
            {notEvaluated > 0 && !universeFailed && (
              <p className="text-xs text-slate-600">{casesLabel(notEvaluated)} sin grupo ni puntaje: no se pudieron evaluar porque falta leer datos o la fecha de la cartera no es válida.</p>
            )}
            <DecisionsNotice decisions={decisions} />
          </CardHeader>
          <CardContent>
            <TableScrollHint />
            <Table className="table-fixed min-w-[36rem] md:min-w-[56rem]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[26%] md:w-[16%]">Identificador</TableHead>
                  <TableHead className="hidden w-[9%] md:table-cell">Tipo</TableHead>
                  <TableHead className="hidden w-[12%] md:table-cell">Grupo de trabajo</TableHead>
                  <TableHead className="w-[24%] md:w-[11%]">{SCORE_LABEL}</TableHead>
                  <TableHead className="w-[24%] text-right md:w-[11%]">Deuda pendiente</TableHead>
                  <TableHead className="hidden w-[11%] text-right md:table-cell">Deuda vencida</TableHead>
                  <TableHead className="hidden w-[10%] md:table-cell">Contacto</TableHead>
                  <DecisionColumnHead decisions={decisions} className="w-[26%] md:w-[20%]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagination.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-slate-500">
                      {selection.failed
                        ? 'No disponible: no se pudieron leer los datos para armar el listado o el filtro no es válido.'
                        : active ? <EmptyFilterState clearHref="/debtors" /> : 'La cartera no tiene casos.'}
                    </TableCell>
                  </TableRow>
                )}
                {pagination.items.map(debtor => {
                  const detailHref = portfolioHref(`/debtors/${encodeURIComponent(debtor.id)}`, { ...filters, page: String(pagination.currentPage), pageSize: String(pagination.pageSize) })
                  return (
                  <TableRow key={debtor.id}>
                    <TableCell className="align-top">
                      <Link href={detailHref} className="font-medium break-words text-[#163a63] underline">{debtor.identifier}</Link>
                      <p className="text-xs text-slate-500 md:hidden">{debtor.type}</p>
                      {debtor.peopleNames.length > 0 && <p className="truncate text-xs text-slate-500" title={debtor.peopleNames.join(', ')}>{debtor.peopleNames.join(', ')}</p>}
                    </TableCell>
                    <TableCell className="hidden align-top md:table-cell">{debtor.type}</TableCell>
                    <TableCell className="hidden align-top md:table-cell">{debtor.decision ? debtor.recommendationType : 'No disponible'}</TableCell>
                    <TableCell className="align-top"><PriorityScoreBadge debtor={debtor} /></TableCell>
                    <TableCell className="text-right align-top">{formatCurrency(debtor.pendingDebt)}</TableCell>
                    <TableCell className="hidden text-right align-top md:table-cell">{formatCurrency(debtor.overdueDebt)}</TableCell>
                    <TableCell className="hidden align-top md:table-cell"><ContactAvailabilityBadge hasContact={debtor.hasContact} /></TableCell>
                    <TableCell className="align-top"><DecisionColumnCell decisions={decisions} debtorId={debtor.id} detailHref={detailHref} /></TableCell>
                  </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            {!selection.failed && (
              <PaginationControls currentPage={pagination.currentPage} totalPages={pagination.totalPages} pageSize={pagination.pageSize}
                currentStart={pagination.currentStart} currentEnd={pagination.currentEnd} totalItems={filteredDebtors.length}
                itemLabel={['caso', 'casos']} buildHref={buildHref} />
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
