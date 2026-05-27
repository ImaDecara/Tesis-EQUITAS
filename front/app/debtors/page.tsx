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
import { formatCurrency } from '@/lib/utils'
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Identificador</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Descripcion</TableHead>
                  <TableHead className="text-right">Deuda total</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Personas</TableHead>
                  <TableHead>Contacto</TableHead>
                  <TableHead>Riesgo</TableHead>
                  <TableHead>Recomendacion</TableHead>
                  <TableHead className="text-right">Detalle</TableHead>
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

                {filteredDebtors.map((debtor) => (
                  <TableRow key={debtor.id}>
                    <TableCell className="font-medium text-slate-900">
                      {debtor.identifier}
                      <p className="mt-1 text-xs font-semibold text-[#163a63]">
                        Prioridad {debtor.priorityLevel} (score {debtor.priorityScore})
                      </p>
                    </TableCell>
                    <TableCell>{debtor.type}</TableCell>
                    <TableCell className="max-w-[260px] truncate">{debtor.description}</TableCell>
                    <TableCell className="text-right">{formatCurrency(debtor.totalDebt)}</TableCell>
                    <TableCell>
                      <Badge variant="neutral">{debtor.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {debtor.peopleCount}
                      {debtor.peopleNames.length > 0 && (
                        <p className="max-w-[200px] truncate text-xs text-slate-500">
                          {debtor.peopleNames.join(', ')}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <ContactAvailabilityBadge hasContact={debtor.hasContact} />
                    </TableCell>
                    <TableCell>
                      <RiskBadge risk={debtor.risk} />
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      <Badge
                        variant={RECOMMENDATION_BADGE[debtor.recommendationType] ?? 'neutral'}
                        className="mb-1"
                      >
                        {debtor.recommendationType}
                      </Badge>
                      <p className="truncate text-xs text-slate-600">{debtor.recommendationReason}</p>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/debtors/${encodeURIComponent(debtor.id)}`}
                        className={buttonVariants({ variant: 'default', size: 'sm' })}
                      >
                        <Eye className="size-3.5" />
                        Ver detalle
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
