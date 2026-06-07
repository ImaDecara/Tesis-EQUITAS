import Link from 'next/link'
import { ClipboardCheck, Eye } from 'lucide-react'

import { MetricCard } from '@/components/dashboard/metric-card'
import { DataWarnings } from '@/components/equitas/data-warnings'
import { AppShell } from '@/components/layout/app-shell'
import { Badge } from '@/components/ui/badge'
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
import {
  buildRecommendationSummary,
  RECOMMENDATION_BADGE_VARIANT,
  RECOMMENDATION_KINDS,
} from '@/lib/equitas-view-selectors'
import { formatCurrency } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function RecommendedActionsPage() {
  const { debtors, warnings } = await getDebtorsData()
  const summary = buildRecommendationSummary(debtors)

  return (
    <AppShell>
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-[#163a63]">
          Acciones recomendadas
        </h1>
        <p className="text-sm text-slate-600">
          Estrategia de gestion agrupada por recomendacion operativa.
        </p>
      </section>

      <div className="space-y-6">
        <DataWarnings warnings={warnings} />

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {RECOMMENDATION_KINDS.map((recommendation) => {
            const item = summary.find((group) => group.recommendation === recommendation)

            return (
              <MetricCard
                key={recommendation}
                label={recommendation}
                value={(item?.count ?? 0).toLocaleString('es-AR')}
                hint={formatCurrency(item?.debtAssociated ?? 0)}
                icon={ClipboardCheck}
                tone={
                  recommendation === 'Llamado prioritario'
                    ? 'danger'
                    : recommendation === 'Plan de pago / revision humana'
                      ? 'primary'
                      : recommendation === 'Mensaje recordatorio'
                        ? 'warning'
                        : 'success'
                }
              />
            )
          })}
        </section>

        <Card className="border-[#d2dceb]">
          <CardHeader>
            <CardTitle>Resumen por recomendacion</CardTitle>
            <CardDescription>
              Mantiene las recomendaciones operativas actuales y sus casos destacados.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table className="min-w-[1120px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Recomendacion</TableHead>
                  <TableHead className="text-right">Cantidad de casos</TableHead>
                  <TableHead className="text-right">Deuda asociada</TableHead>
                  <TableHead className="text-right">Riesgo promedio</TableHead>
                  <TableHead>Casos destacados</TableHead>
                  <TableHead className="text-right">Accion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.map((group) => {
                  const primaryCase = group.highlightedCases[0]

                  return (
                    <TableRow key={group.recommendation}>
                      <TableCell>
                        <Badge variant={RECOMMENDATION_BADGE_VARIANT[group.recommendation]}>
                          {group.recommendation}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {group.count.toLocaleString('es-AR')}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(group.debtAssociated)}
                      </TableCell>
                      <TableCell className="text-right">
                        {group.averageRisk.toFixed(1)} / 100
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-[420px] flex-wrap gap-2">
                          {group.highlightedCases.length === 0 && (
                            <span className="text-sm text-slate-500">Sin casos</span>
                          )}
                          {group.highlightedCases.map((debtor) => (
                            <Link
                              key={debtor.id}
                              href={`/debtors/${encodeURIComponent(debtor.id)}`}
                              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-[#163a63] hover:bg-[#edf2f9]"
                            >
                              {debtor.identifier}
                            </Link>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {primaryCase ? (
                          <Link
                            href={`/debtors/${encodeURIComponent(primaryCase.id)}`}
                            className={buttonVariants({ variant: 'default', size: 'sm' })}
                          >
                            <Eye className="size-3.5" />
                            Ver casos
                          </Link>
                        ) : (
                          <span className="text-sm text-slate-400">Sin casos</span>
                        )}
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
