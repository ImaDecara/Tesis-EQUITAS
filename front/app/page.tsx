import { aggregateData, formatNumber, formatPercentage, formatWithUnit, numericData, missingSummary, percentageData } from '@/lib/data-presence'
import Link from 'next/link'
import {
  AlertCircle,
  CircleDollarSign,
  Clock3,
  ContactRound,
  FileWarning,
  ShieldAlert,
} from 'lucide-react'

import {
  BarDistributionChart,
  RiskDonutChart,
  TopDebtHorizontalChart,
} from '@/components/dashboard/chart-cards'
import { MetricCard } from '@/components/dashboard/metric-card'
import { DataWarnings } from '@/components/equitas/data-warnings'
import { RiskBadge } from '@/components/equitas/risk-badge'
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
import { getDashboardData } from '@/lib/equitas-data'
import {
  RECOMMENDATION_BADGE_VARIANT,
  RECOMMENDATION_KINDS,
} from '@/lib/equitas-view-selectors'
import { cn, formatCurrency } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const { dashboard, warnings } = await getDashboardData()
  const riskMap = new Map(dashboard.byRisk.map((item) => [item.label, item.value]))
  const highRiskShare = percentageData(dashboard.byRisk.length && dashboard.metrics?.riskAboveNinetyCases.value !== null ? riskMap.get('ALTO') ?? 0 : null, dashboard.totalDebtors)
  const topDebtConcentration = percentageData(aggregateData(dashboard.topDebtDebtors.map(debtor => numericData(debtor.totalDebt))).value, dashboard.totalDebt)
  const availableRecommendations = dashboard.byRecommendation.filter(item => item.label !== 'No disponible')
  const dominantRecommendation = dashboard.totalDebtors !== null && dashboard.totalDebtors > 0
    ? availableRecommendations.sort((a, b) => b.value - a.value)[0] : null
  const dominantTies = availableRecommendations.filter(item => item.value === dominantRecommendation?.value)

  return (
    <AppShell>
      <section className="mb-5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#163a63]">
            Dashboard ejecutivo
          </h1>
          <p className="text-sm text-slate-600">
            Resumen municipal para decidir prioridades de gestion diaria.
          </p>
        </div>
      </section>

      <div className="space-y-5">
        <DataWarnings warnings={warnings} />
        <p className="text-xs text-slate-600">{missingSummary(dashboard.metrics)}</p>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
          <MetricCard
            label="Objetos prioritarios"
            value={formatNumber(dashboard.priorityCases)}
            hint="Casos con prioridad alta"
            icon={ShieldAlert}
            tone="critical"
          />
          <MetricCard
            label="Deuda total"
            value={formatCurrency(dashboard.totalDebt)}
            hint="Saldo consolidado"
            icon={CircleDollarSign}
            tone="primary"
          />
          <MetricCard
            label="Casos vencidos"
            value={formatNumber(dashboard.overdueCases)}
            hint="Al menos una deuda vencida"
            icon={FileWarning}
            tone="danger"
          />
          <MetricCard
            label="Casos sin contacto"
            value={formatNumber(dashboard.withoutContactCases)}
            hint="Sin email/telefono activo"
            icon={AlertCircle}
            tone="warning"
          />
          <MetricCard
            label="Recomendacion urgente"
            value={formatNumber(dashboard.urgentRecommendationCases)}
            hint="Intervencion en el dia"
            icon={Clock3}
            tone="danger"
          />
          <MetricCard
            label="Con contacto"
            value={formatNumber(dashboard.withContactCases)}
            hint="Gestion directa posible"
            icon={ContactRound}
            tone="success"
          />
        </section>

        <Card className="border-[#d2dceb]">
          <CardHeader>
            <CardTitle>Resumen operativo del dia</CardTitle>
            <CardDescription>Lectura rapida para orientar la mesa de gestion.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 text-sm text-slate-700 md:grid-cols-3">
            {highRiskShare.value === null ? (
              <p>Objetos en riesgo alto: <span className="font-semibold text-slate-900">{formatPercentage(highRiskShare)}</span></p>
            ) : (
              <p>
                <span className="font-semibold text-slate-900">{formatPercentage(highRiskShare)}</span> de los objetos
                estan en riesgo alto.
              </p>
            )}
            {topDebtConcentration.value === null ? (
              <p>Concentración de los 5 objetos con mayor deuda: <span className="font-semibold text-slate-900">{formatPercentage(topDebtConcentration)}</span></p>
            ) : (
              <p>
                Los 5 objetos con mayor deuda concentran{' '}
                <span className="font-semibold text-slate-900">{formatPercentage(topDebtConcentration)}</span> del
                saldo total.
              </p>
            )}
            {dashboard.withoutContactCases === null ? (
              <p>Casos bloqueados por falta de contacto: <span className="font-semibold text-slate-900">{formatNumber(null)}</span></p>
            ) : (
              <p>
                Hay{' '}
                <span className="font-semibold text-slate-900">
                  {formatNumber(dashboard.withoutContactCases)}
                </span>{' '}
                casos bloqueados por falta de contacto.
              </p>
            )}
          </CardContent>
        </Card>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card className="border-[#d2dceb]">
            <CardHeader className="gap-2 md:flex-row md:items-center md:justify-between md:space-y-0">
              <div>
                <CardTitle>A quien gestionar primero</CardTitle>
                <CardDescription>Top 5 operativo por prioridad, deuda y riesgo.</CardDescription>
              </div>
              <Link href="/priority-cases" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Ver ranking
              </Link>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Objeto</TableHead>
                    <TableHead>Riesgo</TableHead>
                    <TableHead className="text-right">Deuda</TableHead>
                    <TableHead>Recomendacion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.topPriorityDebtors.map((debtor) => (
                    <TableRow key={debtor.id}>
                      <TableCell>
                        <div className="font-medium text-slate-900">{debtor.identifier}</div>
                        <p className="text-xs text-slate-500">
                          {debtor.type} · Score {formatNumber(debtor.priorityScore)}
                        </p>
                      </TableCell>
                      <TableCell>
                        <RiskBadge risk={debtor.risk} score={debtor.riskScore} />
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(debtor.totalDebt)}</TableCell>
                      <TableCell>
                        <Badge variant={RECOMMENDATION_BADGE_VARIANT[debtor.recommendationType]}>
                          {debtor.recommendationType}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="border-[#d2dceb]">
            <CardHeader className="gap-2 md:flex-row md:items-center md:justify-between md:space-y-0">
              <div>
                <CardTitle>Casos sin contacto</CardTitle>
                <CardDescription>Top 5 con gestion directa bloqueada.</CardDescription>
              </div>
              <Link href="/no-contact" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Ver casos
              </Link>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Objeto</TableHead>
                    <TableHead>Riesgo</TableHead>
                    <TableHead className="text-right">Atraso</TableHead>
                    <TableHead className="text-right">Deuda</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.withoutContactDebtors.map((debtor) => (
                    <TableRow key={debtor.id}>
                      <TableCell>
                        <div className="font-medium text-slate-900">{debtor.identifier}</div>
                        <p className="text-xs text-slate-500">{debtor.type}</p>
                      </TableCell>
                      <TableCell>
                        <RiskBadge risk={debtor.risk} score={debtor.riskScore} />
                      </TableCell>
                      <TableCell className="text-right">{formatWithUnit(debtor.overdueDays, 'dias')}</TableCell>
                      <TableCell className="text-right">{formatCurrency(debtor.totalDebt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <Card className="border-[#d2dceb]">
            <CardHeader className="gap-2 md:flex-row md:items-center md:justify-between md:space-y-0">
              <div>
                <CardTitle>Recomendaciones sugeridas</CardTitle>
                <CardDescription>Distribucion resumida de acciones operativas.</CardDescription>
              </div>
              <Link
                href="/recommended-actions"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                Ver acciones
              </Link>
            </CardHeader>
            <CardContent className="space-y-3">
              {RECOMMENDATION_KINDS.map((recommendation) => {
                const bucket = dashboard.byRecommendation.find((item) => item.label === recommendation)
                const count = bucket?.value ?? null
                const percentage = percentageData(count, dashboard.totalDebtors)

                return (
                  <div key={recommendation} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <Badge variant={RECOMMENDATION_BADGE_VARIANT[recommendation]}>
                        {recommendation}
                      </Badge>
                      <span className="text-xs font-semibold text-slate-700">
                        {count === null ? formatNumber(null) : `${formatNumber(count)} casos (${formatPercentage(percentage)})`}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          recommendation === 'Llamado prioritario' && 'bg-[#9d3d3d]',
                          recommendation === 'Mensaje recordatorio' && 'bg-[#8a6f2a]',
                          recommendation === 'Plan de pago / revision humana' && 'bg-[#163a63]',
                          recommendation === 'Seguimiento posterior' && 'bg-[#2d6a4f]'
                        )}
                        style={{ width: percentage.value === null ? undefined : `${percentage.value}%` }}
                      />
                    </div>
                  </div>
                )
              })}
              <p className="text-xs text-slate-700">
                {dominantRecommendation
                  ? `${dominantTies.length > 1 ? 'Empate: ' + dominantTies.map(item => item.label).join(', ') : '"' + dominantRecommendation.label + '"'} concentra ${formatPercentage(percentageData(dominantRecommendation.value, dashboard.totalDebtors))} de los objetos actuales.`
                  : 'Sin datos suficientes para consolidar recomendacion dominante.'}
              </p>
            </CardContent>
          </Card>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <RiskDonutChart
              title="Distribucion por riesgo"
              data={dashboard.byRisk}
              legendLayout="side"
              size="compact"
            />
            <BarDistributionChart
              title="Objetos por tipo"
              data={dashboard.byDebtorType}
              size="compact"
            />
            <TopDebtHorizontalChart title="Top de deuda" data={dashboard.topDebtChart} size="compact" />
          </section>
        </section>
      </div>
    </AppShell>
  )
}
