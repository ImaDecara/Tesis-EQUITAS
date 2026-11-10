import Link from 'next/link'

import { DataWarnings } from '@/components/equitas/data-warnings'
import { PaginationControls, PaginationSummary } from '@/components/equitas/pagination-controls'
import { AppShell } from '@/components/layout/app-shell'
import { LegacyIndexPanel, legacyIndexState } from '@/components/people/legacy-index-panel'
import { PeopleFiltersForm } from '@/components/people/people-filters-form'
import { PersonRiskBadge } from '@/components/people/person-risk-badge'
import { EmptyFilterState, emptyPortfolioScreen, PageHeading } from '@/components/portfolio/portfolio-state'
import { countLabel, isEmptyLegacyIndexWarning, missingLines } from '@/components/portfolio/portfolio-text'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatNumber, readingFailed } from '@/lib/data-presence'
import { getPeopleData } from '@/lib/equitas-data'
import { normalizeText } from '@/lib/equitas-view-selectors'
import { summarizePeople } from '@/lib/mappers/person-risk-mapper'
import { paginateItems } from '@/lib/pagination'
import { formatCurrency } from '@/lib/utils'
import type { PersonListItem } from '@/types/equitas-domain'

const TITLE = 'Personas'
type PeopleFilters = { q: string; risk: string }

function applyPeopleFilters(people: PersonListItem[], filters: PeopleFilters) {
  const query = normalizeText(filters.q)
  return people.filter(person =>
    (!query || normalizeText(person.name).includes(query) || normalizeText(person.document).includes(query)) &&
    (!filters.risk || person.individualRisk === filters.risk))
}

function buildPeopleHref(filters: PeopleFilters, page: number, pageSize: number) {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.risk) params.set('risk', filters.risk)
  if (page > 1) params.set('page', String(page))
  if (pageSize !== 10) params.set('pageSize', String(pageSize))
  return params.size ? `/people?${params}` : '/people'
}

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ q?: string; risk?: string; page?: string; pageSize?: string }> }) {
  const empty = await emptyPortfolioScreen(TITLE)
  if (empty) return empty
  const { people, peopleDashboard, warnings } = await getPeopleData()
  const params = await searchParams
  const legacy = legacyIndexState(people, warnings)
  // Sin índice anterior para nadie, el filtro por índice no tiene sentido y se ignora. Si la lectura
  // falló se conserva: la selección queda «No disponible», nunca se muestra a todas las personas.
  const filters: PeopleFilters = { q: params.q?.trim() ?? '', risk: legacy === 'ABSENT' ? '' : params.risk?.trim() ?? '' }
  const readWarnings = warnings.filter(warning => !isEmptyLegacyIndexWarning(warning))
  const filterReadFailed = readingFailed(warnings, 'person') || (Boolean(filters.risk) && readingFailed(readWarnings, 'debtor_profile_detail'))
  const filteredPeople = applyPeopleFilters(people, filters)
  const pagination = paginateItems(filteredPeople, params.page, params.pageSize)
  const summary = summarizePeople(filteredPeople, warnings, filterReadFailed)
  const active = Boolean(filters.q || filters.risk)
  const withContactCount = filterReadFailed || readingFailed(warnings, 'person', 'debtor_contact') ? null : filteredPeople.filter(person => person.hasContact === true).length
  const buildHref = (page: number, pageSize: number) => buildPeopleHref(filters, page, pageSize)
  const missing = missingLines([['Total registrado asociado', summary.totalDebtAssociated]])

  return (
    <AppShell>
      <PageHeading title={TITLE} description="Personas vinculadas a los casos, con sus casos y la deuda de esos casos. Un caso compartido aparece completo en cada persona: los importes no se suman entre personas." />

      <div className="space-y-5">
        <DataWarnings warnings={readWarnings} />
        {active && <p className="text-sm text-slate-700">{filterReadFailed ? 'No se puede determinar cuántas personas cumplen los filtros: falta leer algunos datos.' : `Mostrando ${formatNumber(filteredPeople.length)} de ${countLabel(peopleDashboard.totalPeople, 'persona', 'personas')} según los filtros.`}</p>}
        {missing && <p className="text-xs text-slate-600">Datos faltantes que afectan los cálculos. {missing}.</p>}

        <Card className="border-[#d2dceb]">
          <CardHeader><CardTitle>Filtros</CardTitle></CardHeader>
          <CardContent><PeopleFiltersForm initialValues={filters} showLegacyIndex={legacy !== 'ABSENT'} /></CardContent>
        </Card>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Card className="border-[#d2dceb] shadow-sm">
            <CardHeader className="pb-1"><CardTitle className="text-sm">Personas</CardTitle></CardHeader>
            <CardContent className="pb-4 text-2xl font-semibold text-[#163a63]">{formatNumber(filterReadFailed ? null : filteredPeople.length)}</CardContent>
          </Card>
          <Card className="border-[#efd9b7] bg-[#f8f2e3] shadow-sm">
            <CardHeader className="pb-1"><CardTitle className="text-sm">Sin contacto</CardTitle></CardHeader>
            <CardContent className="space-y-0.5 pb-4">
              <p className="text-2xl font-semibold text-[#8a6f2a]">{formatNumber(peopleDashboard.withoutContactCount)}</p>
              <p className="text-xs text-slate-600">Con contacto: {formatNumber(withContactCount)}</p>
            </CardContent>
          </Card>
          <Card className="border-[#cfdaea] bg-[#edf2f9] shadow-sm">
            <CardHeader className="pb-1"><CardTitle className="text-sm">Total registrado asociado</CardTitle></CardHeader>
            <CardContent className="space-y-0.5 pb-4">
              <p className="text-lg font-semibold text-[#163a63]">{formatCurrency(summary.totalDebtAssociated.value)}</p>
              <p className="text-xs text-slate-600">De los casos de estas personas. Cada caso se cuenta una vez, aunque tenga varias personas.</p>
            </CardContent>
          </Card>
        </section>

        <Card className="border-[#d2dceb]">
          <CardHeader className="space-y-2">
            <CardTitle>Listado de personas</CardTitle>
            {!filterReadFailed && (
              <PaginationSummary currentStart={pagination.currentStart} currentEnd={pagination.currentEnd} totalItems={filteredPeople.length}
                itemLabel={['persona', 'personas']} pageSize={pagination.pageSize} buildHref={buildHref} />
            )}
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Persona</TableHead>
                  <TableHead>Casos vinculados</TableHead>
                  <TableHead className="hidden md:table-cell">Contacto</TableHead>
                  <TableHead className="text-right">Total registrado asociado</TableHead>
                  {legacy === 'PRESENT' && <TableHead className="hidden md:table-cell">Índice anterior</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagination.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-slate-500">
                      {filterReadFailed ? 'No disponible: no se pudieron leer las personas.' : active ? <EmptyFilterState clearHref="/people" what="personas" /> : 'La cartera no tiene personas vinculadas.'}
                    </TableCell>
                  </TableRow>
                )}
                {pagination.items.map(person => (
                  <TableRow key={person.id}>
                    <TableCell className="align-top">
                      <div className="font-medium text-slate-900">{person.name}</div>
                      <p className="text-xs text-slate-500">{person.document}</p>
                    </TableCell>
                    <TableCell className="align-top">
                      <p className="text-sm">{countLabel(person.debtorsCount, 'caso', 'casos')}</p>
                      <p className="flex flex-wrap gap-x-2 text-xs">
                        {person.debtorIds.slice(0, 3).map((id, index) => (
                          <Link key={id} href={`/debtors/${encodeURIComponent(id)}`} className="text-[#163a63] underline">{person.debtorIdentifiers[index] ?? id}</Link>
                        ))}
                        {person.debtorIds.length > 3 && <Link href={`/debtors?personId=${encodeURIComponent(person.id)}`} className="text-[#163a63] underline">Ver todos</Link>}
                      </p>
                    </TableCell>
                    <TableCell className="hidden align-top md:table-cell">
                      <Badge variant={person.hasContact ? 'success' : person.hasContact === null ? 'neutral' : 'warning'}>
                        {person.hasContact === null ? 'No disponible' : person.hasContact ? 'Disponible' : 'Faltante'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right align-top">
                      {formatCurrency(person.totalDebtAssociated)}
                      <span className="block text-xs text-slate-500">{person.exposureLabel}</span>
                    </TableCell>
                    {legacy === 'PRESENT' && <TableCell className="hidden align-top md:table-cell"><PersonRiskBadge risk={person.individualRisk} score={person.riskValue} /></TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!filterReadFailed && (
              <PaginationControls currentPage={pagination.currentPage} totalPages={pagination.totalPages} pageSize={pagination.pageSize}
                currentStart={pagination.currentStart} currentEnd={pagination.currentEnd} totalItems={filteredPeople.length}
                itemLabel={['persona', 'personas']} buildHref={buildHref} />
            )}
          </CardContent>
        </Card>

        <LegacyIndexPanel people={people} summary={peopleDashboard} warnings={warnings} />
      </div>
    </AppShell>
  )
}
