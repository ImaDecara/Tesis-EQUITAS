import Link from 'next/link'
import { AlertCircle, CircleDollarSign, Eye, Percent, ShieldAlert } from 'lucide-react'

import { MetricCard } from '@/components/dashboard/metric-card'
import { DataWarnings } from '@/components/equitas/data-warnings'
import { PaginationControls, PaginationSummary } from '@/components/equitas/pagination-controls'
import { RiskBadge } from '@/components/equitas/risk-badge'
import { AppShell } from '@/components/layout/app-shell'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getDebtorsData } from '@/lib/equitas-data'
import { getNoContactCases } from '@/lib/equitas-view-selectors'
import { paginateItems } from '@/lib/pagination'
import { formatCurrency } from '@/lib/utils'

type NoContactSearchParams = {
  page?: string
  pageSize?: string
}

function buildNoContactHref(page: number, pageSize: number) {
  const params = new URLSearchParams()

  if (page > 1) params.set('page', String(page))
  if (pageSize !== 10) params.set('pageSize', String(pageSize))

  const queryString = params.toString()

  return queryString ? `/no-contact?${queryString}` : '/no-contact'
}

export default async function NoContactPage({
  searchParams,
}: {
  searchParams: Promise<NoContactSearchParams>
}) {
  const { debtors, warnings } = await getDebtorsData()
  const resolvedSearchParams = await searchParams
  const noContactCases = getNoContactCases(debtors)
  const associatedDebt = noContactCases.reduce((acc, debtor) => acc + debtor.totalDebt, 0)
  const highRiskNoContact = noContactCases.filter((debtor) => debtor.risk === 'ALTO').length
  const totalShare =
    debtors.length > 0 ? Math.round((noContactCases.length / debtors.length) * 100) : 0
  const pagination = paginateItems(
    noContactCases,
    resolvedSearchParams.page,
    resolvedSearchParams.pageSize
  )

  return (
    <AppShell>
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-[#163a63]">
          Casos sin contacto
        </h1>
        <p className="text-sm text-slate-600">
          Casos bloqueados por falta de canal activo para gestion directa.
        </p>
      </section>

      <div className="space-y-6">
        <DataWarnings warnings={warnings} />

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Total sin contacto"
            value={noContactCases.length.toLocaleString('es-AR')}
            hint="Objetos sin canal activo"
            icon={AlertCircle}
            tone="warning"
          />
          <MetricCard
            label="Deuda asociada"
            value={formatCurrency(associatedDebt)}
            hint="Saldo de casos bloqueados"
            icon={CircleDollarSign}
            tone="primary"
          />
          <MetricCard
            label="Riesgo alto sin contacto"
            value={highRiskNoContact.toLocaleString('es-AR')}
            hint="Criticos sin canal directo"
            icon={ShieldAlert}
            tone="danger"
          />
          <MetricCard
            label="Sobre el total"
            value={`${totalShare}%`}
            hint="Participacion del universo"
            icon={Percent}
            tone="accent"
          />
        </section>

        <Card className="border-[#d2dceb] bg-[#f8f2e3]">
          <CardContent className="p-4 text-sm text-[#5f4a19]">
            Estos casos requieren validacion o enriquecimiento de datos antes de iniciar gestion
            directa.
          </CardContent>
        </Card>

        <Card className="border-[#d2dceb]">
          <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between md:space-y-0">
            <div>
              <CardTitle>Listado de casos sin contacto</CardTitle>
              <CardDescription>Priorizado por score, riesgo, deuda y atraso.</CardDescription>
              <PaginationSummary
                currentStart={pagination.currentStart}
                currentEnd={pagination.currentEnd}
                totalItems={noContactCases.length}
                itemLabel="casos"
                pageSize={pagination.pageSize}
                buildHref={buildNoContactHref}
              />
            </div>
          </CardHeader>
          <CardContent>
            <Table className="min-w-[1080px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Objeto</TableHead>
                  <TableHead>Personas asociadas</TableHead>
                  <TableHead>Riesgo</TableHead>
                  <TableHead className="text-right">Deuda</TableHead>
                  <TableHead className="text-right">Atraso</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead className="text-right">Accion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagination.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-slate-500">
                      No hay casos sin contacto.
                    </TableCell>
                  </TableRow>
                )}
                {pagination.items.map((debtor) => (
                  <TableRow key={debtor.id}>
                    <TableCell>
                      <div className="font-medium text-slate-900">{debtor.identifier}</div>
                      <p className="text-xs text-slate-500">{debtor.type}</p>
                    </TableCell>
                    <TableCell>
                      <p className="max-w-[260px] truncate text-sm text-slate-700">
                        {debtor.peopleNames.length > 0
                          ? debtor.peopleNames.join(', ')
                          : 'Sin personas informadas'}
                      </p>
                    </TableCell>
                    <TableCell>
                      <RiskBadge risk={debtor.risk} score={debtor.riskScore} />
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(debtor.totalDebt)}</TableCell>
                    <TableCell className="text-right">{debtor.maxDaysOverdue} dias</TableCell>
                    <TableCell>Sin telefono/email activo</TableCell>
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
              totalItems={noContactCases.length}
              itemLabel="casos"
              buildHref={buildNoContactHref}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
