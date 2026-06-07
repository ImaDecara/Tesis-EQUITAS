import Link from 'next/link'
import { Eye, Filter, Search, SlidersHorizontal } from 'lucide-react'

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
  getPriorityCases,
  matchesDebtorSearch,
  RECOMMENDATION_BADGE_VARIANT,
} from '@/lib/equitas-view-selectors'
import { paginateItems } from '@/lib/pagination'
import { formatCurrency } from '@/lib/utils'

type PrioritySearchParams = {
  q?: string
  risk?: string
  contact?: string
  type?: string
  minAmount?: string
  page?: string
  pageSize?: string
}

function buildPriorityHref(filters: Required<Omit<PrioritySearchParams, 'page' | 'pageSize'>>, page: number, pageSize: number) {
  const params = new URLSearchParams()

  if (filters.q) params.set('q', filters.q)
  if (filters.risk) params.set('risk', filters.risk)
  if (filters.contact) params.set('contact', filters.contact)
  if (filters.type) params.set('type', filters.type)
  if (filters.minAmount) params.set('minAmount', filters.minAmount)
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
  const filteredCases = getPriorityCases(debtors).filter((debtor) => {
    const matchesRisk = !filters.risk || debtor.risk === filters.risk
    const matchesContact =
      !filters.contact ||
      (filters.contact === 'with' && debtor.hasContact) ||
      (filters.contact === 'without' && !debtor.hasContact)
    const matchesType = !filters.type || debtor.type === filters.type
    const matchesAmount =
      !filters.minAmount || (!Number.isNaN(minAmount) && debtor.totalDebt >= minAmount)

    return (
      matchesDebtorSearch(debtor, filters.q) &&
      matchesRisk &&
      matchesContact &&
      matchesType &&
      matchesAmount
    )
  })
  const pagination = paginateItems(
    filteredCases,
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
            Ranking operativo completo para decidir que gestionar primero.
          </p>
        </div>
        <Badge variant="info" className="w-fit">
          <Filter className="mr-1 size-3.5" />
          {filteredCases.length.toLocaleString('es-AR')} casos
        </Badge>
      </section>

      <div className="space-y-6">
        <DataWarnings warnings={warnings} />

        <Card className="border-[#d2dceb]">
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-2">
              <SlidersHorizontal className="size-4 text-[#163a63]" />
              Filtros operativos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form method="get" className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
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
                <label className="mb-1 block text-xs font-semibold text-slate-600">Riesgo</label>
                <select
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
                <label className="mb-1 block text-xs font-semibold text-slate-600">Contacto</label>
                <select
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
                <label className="mb-1 block text-xs font-semibold text-slate-600">Tipo</label>
                <select
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
                <Link href="/priority-cases" className={buttonVariants({ variant: 'outline' })}>
                  Limpiar
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="border-[#d2dceb]">
          <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between md:space-y-0">
            <div>
              <CardTitle>Ranking operativo</CardTitle>
              <PaginationSummary
                currentStart={pagination.currentStart}
                currentEnd={pagination.currentEnd}
                totalItems={filteredCases.length}
                itemLabel="casos"
                pageSize={pagination.pageSize}
                buildHref={(page, pageSize) => buildPriorityHref(filters, page, pageSize)}
              />
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
                      No hay casos que coincidan con los filtros.
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
                        {debtor.priorityScore} / {debtor.priorityLevel}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{debtor.maxDaysOverdue} dias</TableCell>
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
              totalItems={filteredCases.length}
              itemLabel="casos"
              buildHref={(page, pageSize) => buildPriorityHref(filters, page, pageSize)}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
