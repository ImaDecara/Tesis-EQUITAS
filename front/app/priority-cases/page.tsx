import { formatWithUnit, readingFailed } from '@/lib/data-presence'
import Link from 'next/link'
import { Filter, ListChecks, Search, SlidersHorizontal } from 'lucide-react'

import { ContactAvailabilityBadge } from '@/components/debtors/contact-availability-badge'
import { DataWarnings } from '@/components/equitas/data-warnings'
import { PaginationControls, PaginationSummary } from '@/components/equitas/pagination-controls'
import { RiskBadge } from '@/components/equitas/risk-badge'
import { AppShell } from '@/components/layout/app-shell'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  buildRecommendationSummary,
  getPriorityCases,
  matchesDebtorSearch,
  queueParam,
  RECOMMENDATION_BADGE_VARIANT,
  selectQueueGroup,
} from '@/lib/equitas-view-selectors'
import { paginateItems } from '@/lib/pagination'
import { formatCurrency } from '@/lib/utils'

type PrioritySearchParams = {
  q?: string
  risk?: string
  contact?: string
  type?: string
  minAmount?: string
  queue?: string
  page?: string
  pageSize?: string
}

function buildPriorityHref(filters: Omit<Required<Omit<PrioritySearchParams, 'page' | 'pageSize'>>, 'queue'>, queue: string, page: number, pageSize: number) {
  const params = new URLSearchParams()

  if (filters.q) params.set('q', filters.q)
  if (filters.risk) params.set('risk', filters.risk)
  if (filters.contact) params.set('contact', filters.contact)
  if (filters.type) params.set('type', filters.type)
  if (filters.minAmount) params.set('minAmount', filters.minAmount)
  if (queue) params.set('queue', queue)
  if (page > 1) params.set('page', String(page))
  if (pageSize !== 10) params.set('pageSize', String(pageSize))

  const queryString = params.toString()

  return queryString ? `/priority-cases?${queryString}` : '/priority-cases'
}

export default async function PriorityCasesPage({
  searchParams,
}: {
  searchParams: Promise<PrioritySearchParams>
}) {
  const { debtors, warnings } = await getDebtorsData()
  const resolvedSearchParams = await searchParams
  const filters = {
    q: resolvedSearchParams.q?.trim() ?? '',
    risk: resolvedSearchParams.risk?.trim() ?? '',
    contact: resolvedSearchParams.contact?.trim() ?? '',
    type: resolvedSearchParams.type?.trim() ?? '',
    minAmount: resolvedSearchParams.minAmount?.trim() ?? '',
  }
  const minAmount = Number(filters.minAmount)
  const typeOptions = [...new Set(debtors.map((debtor) => debtor.type))].sort()
  const matchesFilters = (debtor: (typeof debtors)[number]) => {
    const matchesRisk = !filters.risk || debtor.risk === filters.risk
    const matchesContact =
      !filters.contact ||
      (filters.contact === 'with' && debtor.hasContact) ||
      (filters.contact === 'without' && debtor.hasContact === false)
    const matchesType = !filters.type || debtor.type === filters.type
    const matchesAmount =
      !filters.minAmount || (Number.isFinite(minAmount) && debtor.totalDebt !== null && debtor.totalDebt >= minAmount)

    return (
      matchesDebtorSearch(debtor, filters.q) &&
      matchesRisk &&
      matchesContact &&
      matchesType &&
      matchesAmount
    )
  }
  const filteredCases = getPriorityCases(debtors).filter(matchesFilters)
  // Cada cola es una intervención y se ordena por su prioridad: entre colas no se compara.
  // La pertenencia se calcula sobre toda la cartera, no sobre lo que dejó el filtro.
  const queues = buildRecommendationSummary(debtors, warnings).map(group => {
    const cases = group.cases.filter(matchesFilters)
    return { ...group, cases, count: group.count === null ? null : cases.length }
  })
  const selectedQueue = selectQueueGroup(queues, resolvedSearchParams.queue)
  const selectedQueueParam = queueParam(selectedQueue)
  const pagination = paginateItems(
    selectedQueue.cases,
    resolvedSearchParams.page,
    resolvedSearchParams.pageSize
  )

  return (
    <AppShell>
      <section className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#163a63]">
            Casos prioritarios
          </h1>
          <p className="text-sm text-slate-600">
            Colas por intervención: cada una se ordena por su propia prioridad.
          </p>
        </div>
        <Badge variant="info" className="w-fit">
          <Filter className="mr-1 size-3.5" />
          {formatWithUnit(readingFailed(warnings, 'debtor', 'debt', 'debtor_profile', 'debtor_person', 'debtor_contact', 'person', 'debt_status', 'debtor_type') ? null : filteredCases.length, 'casos')}
        </Badge>
      </section>

      <div className="space-y-6">
        <DataWarnings warnings={warnings} />
        {filters.minAmount && !Number.isFinite(minAmount) && <p role="alert">Monto mínimo inválido</p>}

        <Card className="border-[#d2dceb]">
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-2">
              <SlidersHorizontal className="size-4 text-[#163a63]" />
              Filtros operativos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form method="get" className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
              <input type="hidden" name="queue" value={selectedQueueParam} />
              <div className="xl:col-span-2">
                <label htmlFor="q" className="mb-1 block text-xs font-semibold text-slate-600">
                  Buscar por objeto o persona
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" />
                  <input
                    id="q"
                    name="q"
                    defaultValue={filters.q}
                    placeholder="Ej: 160... o Perez"
                    className="h-9 w-full rounded-md border border-slate-300 bg-white pr-3 pl-8 text-sm text-slate-900 outline-none ring-[#163a63]/20 transition focus:ring-4"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="risk" className="mb-1 block text-xs font-semibold text-slate-600">Riesgo</label>
                <select
                  id="risk"
                  name="risk"
                  defaultValue={filters.risk}
                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none"
                >
                  <option value="">Todos</option>
                  <option value="ALTO">Alto</option>
                  <option value="MEDIO">Medio</option>
                  <option value="BAJO">Bajo</option>
                </select>
              </div>
              <div>
                <label htmlFor="contact" className="mb-1 block text-xs font-semibold text-slate-600">Contacto</label>
                <select
                  id="contact"
                  name="contact"
                  defaultValue={filters.contact}
                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none"
                >
                  <option value="">Todos</option>
                  <option value="with">Disponible</option>
                  <option value="without">Faltante</option>
                </select>
              </div>
              <div>
                <label htmlFor="type" className="mb-1 block text-xs font-semibold text-slate-600">Tipo</label>
                <select
                  id="type"
                  name="type"
                  defaultValue={filters.type}
                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none"
                >
                  <option value="">Todos</option>
                  {typeOptions.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="minAmount" className="mb-1 block text-xs font-semibold text-slate-600">
                  Monto minimo
                </label>
                <input
                  id="minAmount"
                  name="minAmount"
                  type="number"
                  min="0"
                  defaultValue={filters.minAmount}
                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none"
                />
              </div>
              <div className="flex items-end gap-2 xl:col-span-6">
                <button type="submit" className={buttonVariants({ variant: 'default' })}>
                  Aplicar filtros
                </button>
                <Link href={`/priority-cases?queue=${selectedQueueParam}`} className={buttonVariants({ variant: 'outline' })}>
                  Limpiar
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>

        <nav aria-label="Colas por intervención">
          <ul className="flex flex-wrap gap-2">
            {queues.filter(group => group.interventionCode !== null ? true : group.cases.length > 0).map(group => (
              <li key={queueParam(group)}>
                <Link
                  href={buildPriorityHref(filters, queueParam(group), 1, pagination.pageSize)}
                  data-queue={queueParam(group)}
                  aria-current={group === selectedQueue ? 'page' : undefined}
                  className={buttonVariants({ variant: group === selectedQueue ? 'default' : 'outline', size: 'sm' })}
                >
                  <ListChecks className="size-3.5" />
                  {group.recommendation}
                  <span className="font-normal">{formatWithUnit(group.count, 'casos')}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <Card className="border-[#d2dceb]">
          <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between md:space-y-0">
            <div>
              <CardTitle>Cola: {selectedQueue.recommendation}</CardTitle>
              <p className="text-xs text-slate-600">Orden dentro de esta cola. Las prioridades de colas distintas no se comparan.</p>
              {selectedQueue.count !== null && (
                <PaginationSummary
                  currentStart={pagination.currentStart}
                  currentEnd={pagination.currentEnd}
                  totalItems={selectedQueue.cases.length}
                  itemLabel="casos"
                  pageSize={pagination.pageSize}
                  buildHref={(page, pageSize) => buildPriorityHref(filters, selectedQueueParam, page, pageSize)}
                />
              )}
            </div>
          </CardHeader>
          <CardContent>
            <Table className="min-w-[1180px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Objeto</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Riesgo</TableHead>
                  <TableHead>Score / prioridad</TableHead>
                  <TableHead className="text-right">Atraso</TableHead>
                  <TableHead className="text-right">Deuda total</TableHead>
                  <TableHead>Contacto</TableHead>
                  <TableHead>Recomendacion</TableHead>
                  <TableHead className="text-right">Accion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagination.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-slate-500">
                      {selectedQueue.count === null
                        ? 'No disponible: no se pudo determinar qué casos hay en esta cola.'
                        : 'No hay casos que coincidan con los filtros.'}
                    </TableCell>
                  </TableRow>
                )}
                {pagination.items.map((debtor) => (
                  <TableRow key={debtor.id}>
                    <TableCell>
                      <div className="font-medium text-slate-900">{debtor.identifier}</div>
                      {debtor.peopleNames.length > 0 && (
                        <p className="max-w-[220px] truncate text-xs text-slate-500">
                          {debtor.peopleNames.join(', ')}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>{debtor.type}</TableCell>
                    <TableCell>
                      <RiskBadge risk={debtor.risk} score={debtor.riskScore} />
                    </TableCell>
                    <TableCell>
                      <Badge variant={debtor.priorityLevel === 'ALTA' ? 'danger' : 'warning'}>
                        {formatWithUnit(debtor.priorityScore, `/ ${debtor.priorityLevel}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{formatWithUnit(debtor.maxDaysOverdue, 'dias')}</TableCell>
                    <TableCell className="text-right">{formatCurrency(debtor.totalDebt)}</TableCell>
                    <TableCell>
                      <ContactAvailabilityBadge hasContact={debtor.hasContact} />
                    </TableCell>
                    <TableCell>
                      <Badge variant={RECOMMENDATION_BADGE_VARIANT[debtor.recommendationType]}>
                        {debtor.recommendationType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/debtors/${encodeURIComponent(debtor.id)}?tab=revision`}
                        className={buttonVariants({ variant: 'default', size: 'sm' })}
                      >
                        Abrir revisión
                        <span className="sr-only"> {debtor.identifier}</span>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {selectedQueue.count !== null && (
              <PaginationControls
                currentPage={pagination.currentPage}
                totalPages={pagination.totalPages}
                pageSize={pagination.pageSize}
                currentStart={pagination.currentStart}
                currentEnd={pagination.currentEnd}
                totalItems={selectedQueue.cases.length}
                itemLabel="casos"
                buildHref={(page, pageSize) => buildPriorityHref(filters, selectedQueueParam, page, pageSize)}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
