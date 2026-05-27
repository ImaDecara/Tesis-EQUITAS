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
          <CardHeader>
            <CardTitle>Listado operativo</CardTitle>
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
                {filteredDebtors.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-slate-500">
                      No hay objetos que cumplan los filtros actuales.
                    </TableCell>
                  </TableRow>
                )}

                {filteredDebtors.map((debtor) => {
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
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
