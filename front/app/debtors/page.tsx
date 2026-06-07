import Link from 'next/link'
import { Eye, Filter, SlidersHorizontal } from 'lucide-react'

import { ContactAvailabilityBadge } from '@/components/debtors/contact-availability-badge'
import { DebtorsFiltersForm } from '@/components/debtors/debtors-filters-form'
import { DataWarnings } from '@/components/equitas/data-warnings'
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
import { cn, formatCurrency } from '@/lib/utils'
import type { DebtorListItem } from '@/types/equitas-domain'

const RECOMMENDATION_BADGE: Record<string, 'danger' | 'warning' | 'info' | 'success'> = {
  'Llamado prioritario': 'danger',
  'Mensaje recordatorio': 'warning',
  'Plan de pago / revision humana': 'info',
  'Seguimiento posterior': 'success',
}

const DEFAULT_PAGE_SIZE = 10
const PAGE_SIZE_OPTIONS = [10, 20] as const

type DebtorFilters = {
  q: string
  risk: string
  status: string
  type: string
  contact: string
  personId: string
}

// Traduce la prioridad operacional a un bloque visual rapido para lectura en mesa de gestion.
function getPriorityVisual(priorityLevel: string) {
  if (priorityLevel === 'ALTA') {
    return {
      wrapper: 'border-[#e5c0c0] bg-[#fbefef]',
      badge: 'bg-[#9d3d3d] text-white',
      accent: 'border-[#9d3d3d]',
    }
  }

  if (priorityLevel === 'MEDIA') {
    return {
      wrapper: 'border-[#e7d2ae] bg-[#f9f3e4]',
      badge: 'bg-[#8a6f2a] text-white',
      accent: 'border-[#8a6f2a]',
    }
  }

  return {
    wrapper: 'border-[#cfe1d8] bg-[#edf6f1]',
    badge: 'bg-[#2d6a4f] text-white',
    accent: 'border-[#2d6a4f]',
  }
}

function normalizeText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function applyDebtorFilters(debtors: DebtorListItem[], filters: DebtorFilters) {
  const normalizedQuery = normalizeText(filters.q)

  return debtors.filter((debtor) => {
    const matchesQuery =
      !normalizedQuery ||
      normalizeText(debtor.identifier).includes(normalizedQuery) ||
      normalizeText(debtor.description).includes(normalizedQuery) ||
      debtor.peopleNames.some((name) => normalizeText(name).includes(normalizedQuery))
    const matchesRisk = !filters.risk || debtor.risk === filters.risk
    const matchesStatus = !filters.status || debtor.status === filters.status
    const matchesType = !filters.type || debtor.type === filters.type
    const matchesContact =
      !filters.contact ||
      (filters.contact === 'with' && debtor.hasContact) ||
      (filters.contact === 'without' && !debtor.hasContact)
    const matchesPerson = !filters.personId || debtor.peopleIds.includes(filters.personId)

    return (
      matchesQuery &&
      matchesRisk &&
      matchesStatus &&
      matchesType &&
      matchesContact &&
      matchesPerson
    )
  })
}

function parsePositiveInteger(value: string | undefined) {
  const parsedValue = Number(value)

  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : null
}

function isPageSizeOption(value: number | null): value is (typeof PAGE_SIZE_OPTIONS)[number] {
  return value !== null && PAGE_SIZE_OPTIONS.some((option) => option === value)
}

function buildDebtorsHref(filters: DebtorFilters, page: number, pageSize: number) {
  const params = new URLSearchParams()

  if (filters.q) params.set('q', filters.q)
  if (filters.risk) params.set('risk', filters.risk)
  if (filters.status) params.set('status', filters.status)
  if (filters.type) params.set('type', filters.type)
  if (filters.contact) params.set('contact', filters.contact)
  if (filters.personId) params.set('personId', filters.personId)
  if (page > 1) params.set('page', String(page))
  if (pageSize !== DEFAULT_PAGE_SIZE) params.set('pageSize', String(pageSize))

  const queryString = params.toString()

  return queryString ? `/debtors?${queryString}` : '/debtors'
}

export default async function DebtorsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string
    risk?: string
    status?: string
    type?: string
    contact?: string
    personId?: string
    page?: string
    pageSize?: string
  }>
}) {
  const { debtors, warnings } = await getDebtorsData()
  const resolvedSearchParams = await searchParams

  const filters: DebtorFilters = {
    q: resolvedSearchParams.q?.trim() ?? '',
    risk: resolvedSearchParams.risk?.trim() ?? '',
    status: resolvedSearchParams.status?.trim() ?? '',
    type: resolvedSearchParams.type?.trim() ?? '',
    contact: resolvedSearchParams.contact?.trim() ?? '',
    personId: resolvedSearchParams.personId?.trim() ?? '',
  }

  const filteredDebtors = applyDebtorFilters(debtors, filters)
  const parsedPageSize = parsePositiveInteger(resolvedSearchParams.pageSize)
  const pageSize = isPageSizeOption(parsedPageSize) ? parsedPageSize : DEFAULT_PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(filteredDebtors.length / pageSize))
  const parsedPage = parsePositiveInteger(resolvedSearchParams.page)
  const currentPage = Math.min(parsedPage ?? 1, totalPages)
  const startIndex = (currentPage - 1) * pageSize
  const paginatedDebtors = filteredDebtors.slice(startIndex, startIndex + pageSize)
  const currentStart = filteredDebtors.length === 0 ? 0 : startIndex + 1
  const currentEnd = Math.min(startIndex + pageSize, filteredDebtors.length)
  const hasPreviousPage = currentPage > 1
  const hasNextPage = currentPage < totalPages
  const riskOptions = ['ALTO', 'MEDIO', 'BAJO']
  const statusOptions = [...new Set(debtors.map((debtor) => debtor.status))].sort()
  const typeOptions = [...new Set(debtors.map((debtor) => debtor.type))].sort()
  const hasActiveFilters = Boolean(
    filters.q ||
      filters.risk ||
      filters.status ||
      filters.type ||
      filters.contact ||
      filters.personId
  )

  return (
    <AppShell>
      <section className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#163a63]">
            Objetos de deuda
          </h1>
          <p className="text-sm text-slate-600">
            Vista operativa para clasificar riesgo y priorizar gestion.
          </p>
        </div>

        <Badge variant="info" className="w-fit">
          <Filter className="mr-1 size-3.5" />
          {filteredDebtors.length.toLocaleString('es-AR')} /{' '}
          {debtors.length.toLocaleString('es-AR')} registros
        </Badge>
      </section>

      <div className="space-y-6">
        <DataWarnings warnings={warnings} />

        <Card className="border-[#d2dceb]">
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-2">
              <SlidersHorizontal className="size-4 text-[#163a63]" />
              Filtros de gestion
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DebtorsFiltersForm
              initialValues={filters}
              riskOptions={riskOptions}
              statusOptions={statusOptions}
              typeOptions={typeOptions}
            />

            {hasActiveFilters && (
              <div className="mt-3 flex flex-wrap gap-2">
                {filters.q && <Badge variant="neutral">Busqueda: {filters.q}</Badge>}
                {filters.risk && <Badge variant="neutral">Riesgo: {filters.risk}</Badge>}
                {filters.status && <Badge variant="neutral">Estado: {filters.status}</Badge>}
                {filters.type && <Badge variant="neutral">Tipo: {filters.type}</Badge>}
                {filters.contact && (
                  <Badge variant="neutral">
                    Contacto: {filters.contact === 'with' ? 'Disponible' : 'Faltante'}
                  </Badge>
                )}
                {filters.personId && (
                  <Badge variant="neutral">Persona vinculada: {filters.personId}</Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-[#d2dceb]">
          <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between md:space-y-0">
            <div>
              <CardTitle>Listado operativo</CardTitle>
              <p className="mt-2 text-sm text-slate-600">
                Mostrando {currentStart.toLocaleString('es-AR')}-
                {currentEnd.toLocaleString('es-AR')} de{' '}
                {filteredDebtors.length.toLocaleString('es-AR')} registros.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span className="font-semibold text-slate-700">Ver</span>
              {PAGE_SIZE_OPTIONS.map((option) => (
                <Link
                  key={option}
                  href={buildDebtorsHref(filters, 1, option)}
                  aria-current={pageSize === option ? 'page' : undefined}
                  className={cn(
                    buttonVariants({
                      variant: pageSize === option ? 'default' : 'outline',
                      size: 'sm',
                    }),
                    'h-7 px-2.5'
                  )}
                >
                  {option}
                </Link>
              ))}
              <span>por pagina</span>
            </div>
          </CardHeader>
          <CardContent>
            <Table className="min-w-[1180px] table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Identificador</TableHead>
                  <TableHead className="w-[95px]">Tipo</TableHead>
                  <TableHead className="w-[210px]">Descripcion</TableHead>
                  <TableHead className="w-[130px] text-right">Deuda total</TableHead>
                  <TableHead className="w-[120px]">Estado</TableHead>
                  <TableHead className="w-[190px]">Personas</TableHead>
                  <TableHead className="w-[120px]">Contacto</TableHead>
                  <TableHead className="w-[120px]">Riesgo</TableHead>
                  <TableHead className="w-[210px]">Recomendacion</TableHead>
                  <TableHead className="w-[95px] text-right">Detalle</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedDebtors.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-slate-500">
                      No hay objetos que cumplan los filtros actuales.
                    </TableCell>
                  </TableRow>
                )}

                {paginatedDebtors.map((debtor) => {
                  const detailHref = `/debtors/${encodeURIComponent(debtor.id)}`
                  const priorityVisual = getPriorityVisual(debtor.priorityLevel)
                  const linkClassName =
                    'block min-w-0 px-3 py-2.5 text-slate-700 transition-colors group-hover:text-slate-900'

                  return (
                    <TableRow key={debtor.id} className="group cursor-pointer hover:bg-[#eef3fa]">
                      <TableCell className="p-0">
                        <Link
                          href={detailHref}
                          className={cn(linkClassName, 'font-medium text-slate-900')}
                        >
                          {debtor.identifier}
                          <div
                            className={cn(
                              'mt-2 inline-flex max-w-full items-center gap-2 rounded-md border px-2 py-1',
                              priorityVisual.wrapper
                            )}
                          >
                            <span
                              className={cn(
                                'inline-flex rounded-full border-l-4 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
                                priorityVisual.badge,
                                priorityVisual.accent
                              )}
                            >
                              Prioridad {debtor.priorityLevel}
                            </span>
                            <span className="text-xs text-slate-700">Score {debtor.priorityScore}</span>
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell className="p-0">
                        <Link href={detailHref} className={linkClassName}>
                          {debtor.type}
                        </Link>
                      </TableCell>
                      <TableCell className="p-0">
                        <Link
                          href={detailHref}
                          className={cn(linkClassName, 'truncate')}
                          title={debtor.description}
                        >
                          {debtor.description}
                        </Link>
                      </TableCell>
                      <TableCell className="p-0 text-right">
                        <Link href={detailHref} className={cn(linkClassName, 'text-right')}>
                          {formatCurrency(debtor.totalDebt)}
                        </Link>
                      </TableCell>
                      <TableCell className="p-0">
                        <Link href={detailHref} className={linkClassName}>
                          <Badge variant="neutral">{debtor.status}</Badge>
                        </Link>
                      </TableCell>
                      <TableCell className="p-0">
                        <Link href={detailHref} className={linkClassName}>
                          <p className="text-sm font-medium text-slate-800">{debtor.peopleCount}</p>
                          {debtor.peopleNames.length > 0 && (
                            <p
                              className="max-w-[170px] truncate text-xs text-slate-600"
                              title={debtor.peopleNames.join(', ')}
                            >
                              {debtor.peopleNames.join(', ')}
                            </p>
                          )}
                        </Link>
                      </TableCell>
                      <TableCell className="p-0">
                        <Link href={detailHref} className={linkClassName}>
                          <ContactAvailabilityBadge hasContact={debtor.hasContact} />
                        </Link>
                      </TableCell>
                      <TableCell className="p-0">
                        <Link href={detailHref} className={linkClassName}>
                          <RiskBadge risk={debtor.risk} score={debtor.riskScore} />
                        </Link>
                      </TableCell>
                      <TableCell className="p-0">
                        <Link href={detailHref} className={linkClassName}>
                          <Badge
                            variant={RECOMMENDATION_BADGE[debtor.recommendationType] ?? 'neutral'}
                            className="mb-1 max-w-full overflow-hidden text-ellipsis whitespace-nowrap"
                            title={debtor.recommendationType}
                          >
                            {debtor.recommendationType}
                          </Badge>
                          <p className="truncate text-xs text-slate-600" title={debtor.recommendationReason}>
                            {debtor.recommendationReason}
                          </p>
                        </Link>
                      </TableCell>
                      <TableCell className="p-0 text-right">
                        <div className="px-3 py-2.5 text-right">
                          <Link
                            href={detailHref}
                            className={cn(
                              buttonVariants({ variant: 'default', size: 'sm' }),
                              'h-7 gap-1 px-2.5 text-[11px] font-semibold shadow-sm hover:shadow'
                            )}
                          >
                            <Eye className="size-3" />
                            Detalle
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            {filteredDebtors.length > 0 && (
              <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
                <p>
                  Pagina {currentPage.toLocaleString('es-AR')} de{' '}
                  {totalPages.toLocaleString('es-AR')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {hasPreviousPage ? (
                    <Link
                      href={buildDebtorsHref(filters, currentPage - 1, pageSize)}
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    >
                      Anterior
                    </Link>
                  ) : (
                    <span
                      className={cn(
                        buttonVariants({ variant: 'outline', size: 'sm' }),
                        'pointer-events-none opacity-50'
                      )}
                      aria-disabled
                    >
                      Anterior
                    </span>
                  )}
                  {hasNextPage ? (
                    <Link
                      href={buildDebtorsHref(filters, currentPage + 1, pageSize)}
                      className={buttonVariants({ variant: 'default', size: 'sm' })}
                    >
                      Ver mas
                    </Link>
                  ) : (
                    <span
                      className={cn(
                        buttonVariants({ variant: 'default', size: 'sm' }),
                        'pointer-events-none opacity-50'
                      )}
                      aria-disabled
                    >
                      Ver mas
                    </span>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
