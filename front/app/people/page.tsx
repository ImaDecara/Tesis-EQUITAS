import Link from 'next/link'
import { Filter, UsersRound } from 'lucide-react'

import { RiskDonutChart } from '@/components/dashboard/chart-cards'
import { DataWarnings } from '@/components/equitas/data-warnings'
import { AppShell } from '@/components/layout/app-shell'
import { PeopleFiltersForm } from '@/components/people/people-filters-form'
import { PersonRiskBadge } from '@/components/people/person-risk-badge'
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
import { getPeopleData } from '@/lib/equitas-data'
import { cn, formatCurrency } from '@/lib/utils'
import type { PersonListItem } from '@/types/equitas-domain'

const DEFAULT_PAGE_SIZE = 10
const PAGE_SIZE_OPTIONS = [10, 20] as const

type PeopleFilters = {
  q: string
  risk: string
}

function normalizeText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function applyPeopleFilters(people: PersonListItem[], filters: PeopleFilters) {
  const normalizedQuery = normalizeText(filters.q)

  return people.filter((person) => {
    const matchesQuery =
      !normalizedQuery ||
      normalizeText(person.name).includes(normalizedQuery) ||
      normalizeText(person.document).includes(normalizedQuery)
    const matchesRisk = !filters.risk || person.individualRisk === filters.risk

    return matchesQuery && matchesRisk
  })
}

function parsePositiveInteger(value: string | undefined) {
  const parsedValue = Number(value)

  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : null
}

function isPageSizeOption(value: number | null): value is (typeof PAGE_SIZE_OPTIONS)[number] {
  return value !== null && PAGE_SIZE_OPTIONS.some((option) => option === value)
}

function buildPeopleHref(filters: PeopleFilters, page: number, pageSize: number) {
  const params = new URLSearchParams()

  if (filters.q) params.set('q', filters.q)
  if (filters.risk) params.set('risk', filters.risk)
  if (page > 1) params.set('page', String(page))
  if (pageSize !== DEFAULT_PAGE_SIZE) params.set('pageSize', String(pageSize))

  const queryString = params.toString()

  return queryString ? `/people?${queryString}` : '/people'
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string
    risk?: string
    page?: string
    pageSize?: string
  }>
}) {
  const { people, peopleDashboard, warnings } = await getPeopleData()
  const resolvedSearchParams = await searchParams
  const filters: PeopleFilters = {
    q: resolvedSearchParams.q?.trim() ?? '',
    risk: resolvedSearchParams.risk?.trim() ?? '',
  }
  const filteredPeople = applyPeopleFilters(people, filters)
  const parsedPageSize = parsePositiveInteger(resolvedSearchParams.pageSize)
  const pageSize = isPageSizeOption(parsedPageSize) ? parsedPageSize : DEFAULT_PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(filteredPeople.length / pageSize))
  const parsedPage = parsePositiveInteger(resolvedSearchParams.page)
  const currentPage = Math.min(parsedPage ?? 1, totalPages)
  const startIndex = (currentPage - 1) * pageSize
  const paginatedPeople = filteredPeople.slice(startIndex, startIndex + pageSize)
  const currentStart = filteredPeople.length === 0 ? 0 : startIndex + 1
  const currentEnd = Math.min(startIndex + pageSize, filteredPeople.length)
  const hasPreviousPage = currentPage > 1
  const hasNextPage = currentPage < totalPages
  const totalDebtAssociated = filteredPeople.reduce(
    (acc, person) => acc + person.totalDebtAssociated,
    0
  )
  const averageRiskValue =
    filteredPeople.length > 0
      ? filteredPeople.reduce((acc, person) => acc + person.riskValue, 0) / filteredPeople.length
      : 0
  const withContactCount = filteredPeople.filter((person) => person.hasContact).length

  return (
    <AppShell>
      <section className="mb-5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#163a63]">
            Personas / Deudores
          </h1>
          <p className="text-sm text-slate-600">
            Seguimiento individual con puntaje de riesgo de 0 a 100.
          </p>
        </div>

        <Badge variant="info" className="w-fit">
          <Filter className="mr-1 size-3.5" />
          {filteredPeople.length.toLocaleString('es-AR')} /{' '}
          {people.length.toLocaleString('es-AR')} personas
        </Badge>
      </section>

      <div className="space-y-5">
        <DataWarnings warnings={warnings} />

        <Card className="border-[#d2dceb]">
          <CardHeader>
            <CardTitle>Filtros</CardTitle>
          </CardHeader>
          <CardContent>
            <PeopleFiltersForm initialValues={filters} />
          </CardContent>
        </Card>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Card className="border-[#cfe1d8] bg-[#edf6f1] shadow-sm">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm">Riesgo bajo</CardTitle>
            </CardHeader>
            <CardContent className="pb-4 text-2xl font-semibold text-emerald-700">
              {peopleDashboard.lowRiskCount.toLocaleString('es-AR')}
            </CardContent>
          </Card>
          <Card className="border-[#ead8b0] bg-[#f9f3e4] shadow-sm">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm">Riesgo medio</CardTitle>
            </CardHeader>
            <CardContent className="pb-4 text-2xl font-semibold text-amber-700">
              {peopleDashboard.mediumRiskCount.toLocaleString('es-AR')}
            </CardContent>
          </Card>
          <Card className="border-[#efd2d2] bg-[#fbefef] shadow-sm">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm">Riesgo alto</CardTitle>
            </CardHeader>
            <CardContent className="pb-4 text-2xl font-semibold text-rose-700">
              {peopleDashboard.highRiskCount.toLocaleString('es-AR')}
            </CardContent>
          </Card>
          <Card className="border-[#efd9b7] bg-[#f8f2e3] shadow-sm">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm">Sin contacto</CardTitle>
            </CardHeader>
            <CardContent className="space-y-0.5 pb-4">
              <p className="text-2xl font-semibold text-[#8a6f2a]">
                {peopleDashboard.withoutContactCount.toLocaleString('es-AR')}
              </p>
              <p className="text-xs text-slate-600">
                Con contacto: {withContactCount.toLocaleString('es-AR')}
              </p>
            </CardContent>
          </Card>
          <Card className="border-[#cfdaea] bg-[#edf2f9] shadow-sm">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm">Deuda asociada</CardTitle>
            </CardHeader>
            <CardContent className="space-y-0.5 pb-4">
              <p className="text-lg font-semibold text-[#163a63]">
                {formatCurrency(totalDebtAssociated)}
              </p>
              <p className="text-xs text-slate-600">
                Riesgo promedio {averageRiskValue.toFixed(1)} / 100
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <RiskDonutChart
            title="Distribucion de riesgo individual"
            data={peopleDashboard.individualRiskDistribution}
          />

          <Card className="border-[#d2dceb]">
            <CardHeader>
              <CardTitle>Top 5 personas con mayor riesgo</CardTitle>
            </CardHeader>
            <CardContent>
              <Table className="min-w-[680px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Persona</TableHead>
                    <TableHead>Riesgo</TableHead>
                    <TableHead className="text-right">Puntaje</TableHead>
                    <TableHead className="text-right">Objetos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {peopleDashboard.topPeopleByRiskValue.map((person) => (
                    <TableRow key={person.id} className="hover:bg-[#eef3fa]">
                      <TableCell>
                        <div className="font-medium text-slate-900">{person.name}</div>
                        <p className="text-xs text-slate-500">{person.document}</p>
                      </TableCell>
                      <TableCell>
                        <PersonRiskBadge
                          risk={person.individualRisk}
                          score={person.riskValue}
                        />
                      </TableCell>
                      <TableCell className="text-right">{person.riskValue.toFixed(2)}</TableCell>
                      <TableCell className="text-right">{person.debtorsCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>

        <Card className="border-[#d2dceb]">
          <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between md:space-y-0">
            <div>
              <CardTitle>Listado de personas</CardTitle>
              <p className="mt-2 text-sm text-slate-600">
                Mostrando {currentStart.toLocaleString('es-AR')}-
                {currentEnd.toLocaleString('es-AR')} de{' '}
                {filteredPeople.length.toLocaleString('es-AR')} personas.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span className="font-semibold text-slate-700">Ver</span>
              {PAGE_SIZE_OPTIONS.map((option) => (
                <Link
                  key={option}
                  href={buildPeopleHref(filters, 1, option)}
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
            <Table className="min-w-[980px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Documento</TableHead>
                  <TableHead>Riesgo individual</TableHead>
                  <TableHead className="text-right">Puntaje</TableHead>
                  <TableHead className="text-right">Objetos asociados</TableHead>
                  <TableHead>Contacto disponible</TableHead>
                  <TableHead className="text-right">Deuda total asociada</TableHead>
                  <TableHead className="text-right">Accion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedPeople.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-slate-500">
                      No hay personas que coincidan con los filtros.
                    </TableCell>
                  </TableRow>
                )}

                {paginatedPeople.map((person) => (
                  <TableRow key={person.id} className="hover:bg-[#eef3fa]">
                    <TableCell className="font-medium text-slate-900">{person.name}</TableCell>
                    <TableCell>{person.document}</TableCell>
                    <TableCell>
                      <PersonRiskBadge
                        risk={person.individualRisk}
                        score={person.riskValue}
                      />
                    </TableCell>
                    <TableCell className="text-right">{person.riskValue.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{person.debtorsCount}</TableCell>
                    <TableCell>
                      <Badge variant={person.hasContact ? 'success' : 'warning'}>
                        {person.hasContact ? 'Disponible' : 'Faltante'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(person.totalDebtAssociated)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/debtors?personId=${encodeURIComponent(person.id)}`}
                        className={buttonVariants({ variant: 'default', size: 'sm' })}
                      >
                        <UsersRound className="size-3.5" />
                        Ver objetos
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filteredPeople.length > 0 && (
              <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
                <p>
                  Pagina {currentPage.toLocaleString('es-AR')} de{' '}
                  {totalPages.toLocaleString('es-AR')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {hasPreviousPage ? (
                    <Link
                      href={buildPeopleHref(filters, currentPage - 1, pageSize)}
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
                      href={buildPeopleHref(filters, currentPage + 1, pageSize)}
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
