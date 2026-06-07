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
  const highRiskShare =
    dashboard.totalDebtors > 0
      ? Math.round(((riskMap.get('ALTO') ?? 0) / dashboard.totalDebtors) * 100)
      : 0
  const topDebtConcentration =
    dashboard.totalDebt > 0
      ? Math.round(
          (dashboard.topDebtDebtors.reduce((sum, debtor) => sum + debtor.totalDebt, 0) /
            dashboard.totalDebt) *
            100
        )
      : 0
  const dominantRecommendation =
    dashboard.byRecommendation.length > 0
      ? [...dashboard.byRecommendation].sort((a, b) => b.value - a.value)[0]
      : null

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

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
          <MetricCard
            label="Objetos prioritarios"
            value={dashboard.priorityCases.toLocaleString('es-AR')}
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
            value={dashboard.overdueCases.toLocaleString('es-AR')}
            hint="Al menos una deuda vencida"
            icon={FileWarning}
            tone="danger"
          />
          <MetricCard
            label="Casos sin contacto"
            value={dashboard.withoutContactCases.toLocaleString('es-AR')}
            hint="Sin email/telefono activo"
            icon={AlertCircle}
            tone="warning"
          />
          <MetricCard
            label="Recomendacion urgente"
            value={dashboard.urgentRecommendationCases.toLocaleString('es-AR')}
            hint="Intervencion en el dia"
            icon={Clock3}
            tone="danger"
          />
          <MetricCard
            label="Con contacto"
            value={dashboard.withContactCases.toLocaleString('es-AR')}
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
            <p>
              <span className="font-semibold text-slate-900">{highRiskShare}%</span> de los objetos
              estan en riesgo alto.
            </p>
            <p>
              Los 5 objetos con mayor deuda concentran{' '}
              <span className="font-semibold text-slate-900">{topDebtConcentration}%</span> del
              saldo total.
            </p>
            <p>
              Hay{' '}
              <span className="font-semibold text-slate-900">
                {dashboard.withoutContactCases.toLocaleString('es-AR')}
              </span>{' '}
              casos bloqueados por falta de contacto.
            </p>
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
                          {debtor.type} · Score {debtor.priorityScore}
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
                      <TableCell className="text-right">{debtor.overdueDays} dias</TableCell>
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
                const count = bucket?.value ?? 0
                const percentage =
                  dashboard.totalDebtors > 0 ? Math.round((count / dashboard.totalDebtors) * 100) : 0

                return (
                  <div key={recommendation} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <Badge variant={RECOMMENDATION_BADGE_VARIANT[recommendation]}>
                        {recommendation}
                      </Badge>
                      <span className="text-xs font-semibold text-slate-700">
                        {count.toLocaleString('es-AR')} casos ({percentage}%)
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
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                )
              })}
              <p className="text-xs text-slate-700">
                {dominantRecommendation
                  ? `"${dominantRecommendation.label}" concentra ${Math.round(
                      (dominantRecommendation.value / Math.max(dashboard.totalDebtors, 1)) * 100
                    )}% de los objetos actuales.`
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
