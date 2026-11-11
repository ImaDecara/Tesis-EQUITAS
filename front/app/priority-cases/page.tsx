import Link from 'next/link'
import { Download, ListChecks, Search, SlidersHorizontal } from 'lucide-react'

import { ContactAvailabilityBadge } from '@/components/debtors/contact-availability-badge'
import { DataWarnings } from '@/components/equitas/data-warnings'
import { PaginationControls, PaginationSummary } from '@/components/equitas/pagination-controls'
import { AppShell } from '@/components/layout/app-shell'
import { decisionsAvailable, DecisionColumnCell, DecisionColumnHead, DecisionsNotice, PriorityScoreBadge } from '@/components/portfolio/case-cells'
import { EmptyFilterState, emptyPortfolioScreen, PageHeading } from '@/components/portfolio/portfolio-state'
import { casesLabel, daysLabel, filterLine, filterNotes, GROUP_CRITERIA, SCORE_LABEL, SCORE_NOTE } from '@/components/portfolio/portfolio-text'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableScrollHint } from '@/components/ui/table'
import { withMaturityMetrics } from '@/lib/analytics'
import { readingFailed } from '@/lib/data-presence'
import { getDebtorsData } from '@/lib/equitas-data'
import { buildRecommendationSummary, getPriorityCases, queueParam, selectQueueGroup } from '@/lib/equitas-view-selectors'
import { paginateItems } from '@/lib/pagination'
import { filterPortfolio, normalizePortfolioSearchParams, portfolioHref, type RawPortfolioSearchParams } from '@/lib/portfolio-filters'
import { loadRecordedDecisions } from '@/lib/server/recorded-decisions'
import { queueReportLink } from '@/lib/server/report-links'
import { formatCurrency } from '@/lib/utils'

const TITLE = 'Grupos de trabajo'
const FILTER_KEYS = ['q', 'risk', 'contact', 'type', 'minAmount', 'status', 'personId'] as const
type ScreenFilters = Record<(typeof FILTER_KEYS)[number], string>
const EMPTY_FILTERS = Object.fromEntries(FILTER_KEYS.map(key => [key, ''])) as ScreenFilters
const INPUT = 'h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none'

function buildPriorityHref(filters: ScreenFilters, queue: string, page: number, pageSize: number) {
  return portfolioHref('/priority-cases', filters, { queue, page: page > 1 ? String(page) : '', pageSize: pageSize !== 10 ? String(pageSize) : '' })
}

export default async function PriorityCasesPage({ searchParams }: { searchParams: Promise<RawPortfolioSearchParams> }) {
  const empty = await emptyPortfolioScreen(TITLE)
  if (empty) return empty
  const [{ debtors: sourceDebtors, warnings }, decisions] = await Promise.all([getDebtorsData(), loadRecordedDecisions()])
  const debtors = sourceDebtors.map(withMaturityMetrics)
  const params = normalizePortfolioSearchParams(await searchParams)
  const filters = Object.fromEntries(FILTER_KEYS.map(key => [key, params[key]?.trim() ?? ''])) as ScreenFilters
  const active = FILTER_KEYS.some(key => filters[key])
  const typeOptions = [...new Set(debtors.map(debtor => debtor.type))].sort()
  const selection = filterPortfolio(debtors, filters, warnings)
  const selectedIds = new Set(selection.items.map(item => item.id))
  const filteredCases = getPriorityCases(debtors).filter(debtor => selectedIds.has(debtor.id))
  // Cada grupo es una intervención y se ordena por su propio puntaje: entre grupos no se compara.
  // La pertenencia se calcula sobre toda la cartera, no sobre lo que dejó el filtro.
  const queues = buildRecommendationSummary(debtors, selection.warnings).map(group => {
    const cases = group.cases.filter(debtor => selectedIds.has(debtor.id))
    return { ...group, cases, count: group.count === null ? null : cases.length }
  })
  // El grupo «No disponible» (casos sin evaluar) solo aparece si tiene casos.
  const visibleQueues = queues.filter(group => group.interventionCode !== null || group.cases.length > 0)
  const selectedQueue = selectQueueGroup(queues, params.queue)
  const selectedQueueParam = queueParam(selectedQueue)
  // Solo un grupo elegido a propósito acompaña a los filtros; el de la primera carga no,
  // para que buscar un caso de otro grupo lo encuentre.
  const chosenQueue = selectedQueueParam === params.queue ? selectedQueueParam : ''
  const criteria = GROUP_CRITERIA.filter(item => item.group === selectedQueue.recommendation)
  const queueCsv = queueReportLink(filters, { selectionAvailable: !selection.failed })
  const pagination = paginateItems(selectedQueue.cases, params.page, params.pageSize)
  const pageHref = (page: number, pageSize: number) => buildPriorityHref(filters, selectedQueueParam, page, pageSize)

  return (
    <AppShell>
      <PageHeading title={TITLE} description={`Cada caso está en un solo grupo según reglas fijas. Dentro de cada grupo se ordena por ${SCORE_LABEL.toLowerCase()}. ${SCORE_LABEL}: ${SCORE_NOTE.toLowerCase()}`} />
      <p className="mb-4 text-sm font-medium text-slate-700" data-total>{selection.failed ? 'No disponible' : casesLabel(filteredCases.length)}</p>

      <div className="space-y-5">
        <DataWarnings warnings={warnings} />
        {filterNotes(selection.warnings, warnings).map(note => <p key={note.message} role="status" className="text-sm text-amber-800">{note.message}</p>)}
        {active && <p className="text-sm text-slate-700">{filterLine(selection.failed ? null : filteredCases.length, readingFailed(warnings, 'debtor') ? null : debtors.length)}</p>}

        <details className="rounded-lg border border-[#d2dceb] bg-white p-4 text-sm text-slate-700" open data-group-criteria>
          <summary className="cursor-pointer font-semibold text-[#163a63]">Cómo se arma cada grupo</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            {GROUP_CRITERIA.map(item => <li key={item.rule}>Si {item.rule}: <span className="font-medium">{item.group}</span>.</li>)}
          </ol>
          <p className="mt-2 text-xs text-slate-600">
            Las reglas se aplican en ese orden y gana la primera que se cumple. La unidad es el caso (el objeto tributario), no la persona.
            No es clustering ni aprendizaje automático. <Link href="/help" className="underline">Más en la ayuda</Link>.
          </p>
        </details>

        <Card className="border-[#d2dceb]">
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-2">
              <SlidersHorizontal className="size-4 text-[#163a63]" />
              Filtros
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form method="get" className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
              {filters.status && <input type="hidden" name="status" value={filters.status} />}
              {filters.personId && <input type="hidden" name="personId" value={filters.personId} />}
              {chosenQueue && <input type="hidden" name="queue" value={chosenQueue} />}
              <div className="xl:col-span-2">
                <label htmlFor="q" className="mb-1 block text-xs font-semibold text-slate-600">Buscar por identificador o persona</label>
                <div className="relative">
                  <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" />
                  <input id="q" name="q" defaultValue={filters.q} placeholder="Ej.: 160... o Pérez"
                    className="h-9 w-full rounded-md border border-slate-300 bg-white pr-3 pl-8 text-sm text-slate-900 outline-none ring-[#163a63]/20 transition focus:ring-4" />
                </div>
              </div>
              <div>
                <label htmlFor="risk" className="mb-1 block text-xs font-semibold text-slate-600">{SCORE_LABEL}</label>
                <select id="risk" name="risk" defaultValue={filters.risk} className={INPUT}>
                  <option value="">Todos</option>
                  <option value="ALTO">Alta (70 a 100)</option>
                  <option value="MEDIO">Media (40 a 69)</option>
                  <option value="BAJO">Baja (0 a 39)</option>
                </select>
              </div>
              <div>
                <label htmlFor="contact" className="mb-1 block text-xs font-semibold text-slate-600">Contacto</label>
                <select id="contact" name="contact" defaultValue={filters.contact} className={INPUT}>
                  <option value="">Todos</option>
                  <option value="with">Disponible</option>
                  <option value="without">Faltante</option>
                </select>
              </div>
              <div>
                <label htmlFor="type" className="mb-1 block text-xs font-semibold text-slate-600">Tipo</label>
                <select id="type" name="type" defaultValue={filters.type} className={INPUT}>
                  <option value="">Todos</option>
                  {typeOptions.map(type => <option key={type} value={type}>{type}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="minAmount" className="mb-1 block text-xs font-semibold text-slate-600">Total registrado mínimo</label>
                <input id="minAmount" name="minAmount" type="number" min="0" defaultValue={filters.minAmount} className={INPUT} />
              </div>
              <div className="flex flex-wrap items-end gap-2 md:col-span-2 xl:col-span-6">
                <button type="submit" className={buttonVariants({ variant: 'default' })}>Aplicar filtros</button>
                <Link href={buildPriorityHref(EMPTY_FILTERS, chosenQueue, 1, 10)} className={buttonVariants({ variant: 'outline' })}>Limpiar</Link>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-1 text-xs text-slate-600 md:flex-row md:items-center md:gap-3" data-queue-csv>
          {queueCsv.available ? (
            <>
              <a href={queueCsv.href} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                <Download className="size-3.5" />
                Descargar CSV de los grupos con estos filtros
              </a>
              <span>
                Incluye todos los grupos, no solo el elegido, y la descarga queda registrada.
                {queueCsv.screenOnlyFilters.length > 0 && ` El CSV no aplica el filtro de ${queueCsv.screenOnlyFilters.join(' ni el de ')}.`}
              </span>
            </>
          ) : (
            <span role="status">{queueCsv.reason}</span>
          )}
        </div>

        <nav aria-label="Grupos de trabajo">
          <ul className="flex flex-wrap gap-2">
            {visibleQueues.map(group => (
              <li key={queueParam(group)}>
                <Link href={buildPriorityHref(filters, queueParam(group), 1, pagination.pageSize)} data-queue={queueParam(group)}
                  aria-current={group === selectedQueue ? 'page' : undefined}
                  className={buttonVariants({ variant: group === selectedQueue ? 'default' : 'outline', size: 'sm' })}>
                  <ListChecks className="size-3.5" />
                  {group.recommendation}
                  <span className="font-normal">{casesLabel(group.count)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <Card className="border-[#d2dceb]">
          <CardHeader className="space-y-2">
            <CardTitle>Grupo: {selectedQueue.recommendation}</CardTitle>
            <p className="text-xs text-slate-600">
              {criteria.length ? `Entran los casos que no cumplen una regla anterior y en los que ${criteria.map(item => item.rule).join(', o ')}. ` : 'Casos que no se pudieron evaluar porque falta leer datos o la fecha de la cartera no es válida. '}
              Orden dentro de este grupo; los puntajes de grupos distintos no se comparan.
            </p>
            {selectedQueue.count !== null && (
              <PaginationSummary currentStart={pagination.currentStart} currentEnd={pagination.currentEnd} totalItems={selectedQueue.cases.length}
                itemLabel={['caso', 'casos']} pageSize={pagination.pageSize} buildHref={pageHref} />
            )}
            <DecisionsNotice decisions={decisions} />
          </CardHeader>
          <CardContent>
            <TableScrollHint />
            <Table className="table-fixed min-w-[36rem] md:min-w-[56rem]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[28%] md:w-[18%]">Identificador</TableHead>
                  <TableHead className="hidden w-[9%] md:table-cell">Tipo</TableHead>
                  <TableHead className="w-[24%] md:w-[12%]">{SCORE_LABEL}</TableHead>
                  <TableHead className="hidden w-[9%] text-right md:table-cell">Atraso máximo</TableHead>
                  <TableHead className="w-[22%] text-right md:w-[11%]">Deuda pendiente</TableHead>
                  <TableHead className="hidden w-[11%] text-right md:table-cell">Deuda vencida</TableHead>
                  <TableHead className="hidden w-[10%] md:table-cell">Contacto</TableHead>
                  <DecisionColumnHead decisions={decisions} className="w-[26%] md:w-[20%]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagination.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-slate-500">
                      {selectedQueue.count === null
                        ? 'No disponible: no se pudo determinar qué casos hay en este grupo.'
                        : active ? <EmptyFilterState clearHref={buildPriorityHref(EMPTY_FILTERS, chosenQueue, 1, 10)} /> : 'Este grupo no tiene casos.'}
                    </TableCell>
                  </TableRow>
                )}
                {pagination.items.map(debtor => {
                  // Sin el módulo de decisiones la pestaña «Decisión» no tiene nada que hacer: se abre el resumen.
                  const caseHref = portfolioHref(`/debtors/${encodeURIComponent(debtor.id)}`, { ...filters, queue: selectedQueueParam })
                  const detailHref = decisionsAvailable(decisions) ? `${caseHref}&tab=revision` : caseHref
                  return (
                  <TableRow key={debtor.id}>
                    <TableCell className="align-top">
                      <Link href={detailHref} className="font-medium break-words text-[#163a63] underline">{debtor.identifier}</Link>
                      <p className="text-xs text-slate-500 md:hidden">{debtor.type}</p>
                      {debtor.peopleNames.length > 0 && <p className="truncate text-xs text-slate-500" title={debtor.peopleNames.join(', ')}>{debtor.peopleNames.join(', ')}</p>}
                    </TableCell>
                    <TableCell className="hidden align-top md:table-cell">{debtor.type}</TableCell>
                    <TableCell className="align-top"><PriorityScoreBadge debtor={debtor} /></TableCell>
                    <TableCell className="hidden text-right align-top md:table-cell">{daysLabel(debtor.maxDaysOverdue)}</TableCell>
                    <TableCell className="text-right align-top">{formatCurrency(debtor.pendingDebt)}</TableCell>
                    <TableCell className="hidden text-right align-top md:table-cell">{formatCurrency(debtor.overdueDebt)}</TableCell>
                    <TableCell className="hidden align-top md:table-cell"><ContactAvailabilityBadge hasContact={debtor.hasContact} /></TableCell>
                    <TableCell className="align-top"><DecisionColumnCell decisions={decisions} debtorId={debtor.id} href={detailHref} /></TableCell>
                  </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            {selectedQueue.count !== null && (
              <PaginationControls currentPage={pagination.currentPage} totalPages={pagination.totalPages} pageSize={pagination.pageSize}
                currentStart={pagination.currentStart} currentEnd={pagination.currentEnd} totalItems={selectedQueue.cases.length}
                itemLabel={['caso', 'casos']} buildHref={pageHref} />
            )}
          </CardContent>
        </Card>
        {selectedQueue.recommendation === 'Revisión jurídica' && <Badge variant="warning">La alerta de atraso no afirma que la deuda esté prescripta.</Badge>}
      </div>
    </AppShell>
  )
}
