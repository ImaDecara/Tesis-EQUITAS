import { PortfolioScope } from '@/components/equitas/portfolio-scope'
import { portfolioHref, normalizePortfolioSearchParams, type RawPortfolioSearchParams } from '@/lib/portfolio-filters'
import { sumMoney, formatNumber, formatPercentage, formatWithUnit, numericData, missingSummary, percentageData } from '@/lib/data-presence'
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
import { ReportDownloads } from '@/components/equitas/report-downloads'
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
import { availableReportLinks } from '@/lib/server/report-links'
import {
  RECOMMENDATION_BADGE_VARIANT,
  RECOMMENDATION_KINDS,
} from '@/lib/equitas-view-selectors'
import { cn, formatCurrency } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function HomePage({ searchParams }: { searchParams?: Promise<RawPortfolioSearchParams> } = {}) {
  const filters = normalizePortfolioSearchParams(await searchParams ?? {})
  const [{ dashboard, warnings }, reportLinks] = await Promise.all([getDashboardData(filters), availableReportLinks()])
  const riskMap = new Map(dashboard.byRisk.map((item) => [item.label, item.value]))
  const highRiskShare = percentageData(dashboard.byRisk.length && dashboard.metrics?.highSeverityCases?.value !== null ? riskMap.get('ALTO') ?? 0 : null, dashboard.totalDebtors)
  const chartEmpty = warnings.length ? 'No disponible: lectura incompleta; consulte los avisos y la cobertura.' : dashboard.totalDebtors === 0 ? 'No hay objetos en la selección.' : 'No hay valores observados para graficar; consulte la cobertura.'
  const topDebtConcentration = percentageData(sumMoney(dashboard.topDebtDebtors.map(debtor => numericData(debtor.totalDebt))).value, dashboard.totalDebt)
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
        <PortfolioScope context={dashboard.context} filters={filters} />
        <p className="text-xs text-slate-600">{missingSummary(dashboard.metrics)}</p>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
          <MetricCard
            label="Objetos con severidad alta"
            value={formatNumber(dashboard.priorityCases)}
            hint={`Desde 70 puntos; ${dashboard.coverage?.priorityCases ?? "cobertura no disponible"}`}
            icon={ShieldAlert}
            tone="critical"
          />
          <MetricCard
            label="Total registrado"
            value={formatCurrency(dashboard.totalDebt)}
            hint={`ARS; todas las obligaciones, cualquiera sea su estado. ${dashboard.coverage?.totalDebt ?? ""}`}
            icon={CircleDollarSign}
            tone="primary"
          />
          <MetricCard
            label="Casos vencidos"
            value={formatNumber(dashboard.overdueCases)}
            hint={`Al menos una obligación evaluable vencida. ${dashboard.coverage?.overdueCases ?? ""}`}
            icon={FileWarning}
            tone="danger"
          />
          <MetricCard
            label="Casos sin contacto"
            value={formatNumber(dashboard.withoutContactCases)}
            hint={`Sin contacto cargado activo. ${dashboard.coverage?.withoutContactCases ?? ""}`}
            icon={AlertCircle}
            tone="warning"
          />
          <MetricCard
            label="Revisión requerida"
            value={formatNumber(dashboard.urgentRecommendationCases)}
            hint={`Revisión humana o jurídica; no es urgencia. ${dashboard.coverage?.urgentRecommendationCases ?? ""}`}
            icon={Clock3}
            tone="danger"
          />
          <MetricCard
            label="Con contacto"
            value={formatNumber(dashboard.withContactCases)}
            hint={`Contacto cargado, no verificado. ${dashboard.coverage?.withContactCases ?? ""}`}
            icon={ContactRound}
            tone="success"
          />
        </section>

        <ReportDownloads links={reportLinks} />

        <Card className="border-[#d2dceb]">
          <CardHeader>
            <CardTitle>Resumen operativo del dia</CardTitle>
            <CardDescription>Lectura rapida para orientar la mesa de gestion.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 text-sm text-slate-700 md:grid-cols-3">
            {highRiskShare.value === null ? (
              <p>Objetos con severidad alta: <span className="font-semibold text-slate-900">{formatPercentage(highRiskShare)}</span></p>
            ) : (
              <p>
                <span className="font-semibold text-slate-900">{formatPercentage(highRiskShare)}</span> de los objetos
                tienen severidad alta. La base incluye los objetos sin puntaje.
              </p>
            )}
            {topDebtConcentration.value === null ? (
              <p>Concentración de los 5 objetos con mayor deuda: <span className="font-semibold text-slate-900">{formatPercentage(topDebtConcentration)}</span></p>
            ) : (
              <p>
                Los 5 objetos con mayor deuda concentran{' '}
                <span className="font-semibold text-slate-900">{formatPercentage(topDebtConcentration)}</span> del
                saldo observado (puede ser parcial).
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
            <CardHeader>
              <CardTitle>Primeros casos de cada cola</CardTitle>
              <CardDescription>Hasta 3 por intervención; las prioridades de colas distintas no se comparan.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(dashboard.queuePreviews ?? []).map(group => (
                <section key={group.label}>
                  <Link href={portfolioHref('/priority-cases', filters, { queue: group.code ?? 'SIN_COLA', page: '' })} className="font-semibold underline">{group.label}</Link>
                  <p>{formatWithUnit(group.count, 'objetos')}</p>
                  {group.cases.length === 0 && <p>{group.count === null ? 'No disponible: pertenencia a la cola desconocida.' : 'Sin casos en esta cola.'}</p>}
                  <ul>{group.cases.map(debtor => <li key={debtor.id}>
                    <Link href={portfolioHref(`/debtors/${encodeURIComponent(debtor.id)}`, filters)} className="underline">{debtor.identifier}</Link>
                    {' · '}{formatWithUnit(debtor.priorityScore, 'puntos de 0 a 100')}{debtor.decision?.severidad.estado === 'PARCIAL' ? ' (mínimo parcial)' : ''}
                  </li>)}</ul>
                </section>
              ))}
            </CardContent>
          </Card>

          <Card className="border-[#d2dceb]">
            <CardHeader className="gap-2 md:flex-row md:items-center md:justify-between md:space-y-0">
              <div>
                <CardTitle>Casos sin contacto</CardTitle>
                <CardDescription>Hasta 5 sin contacto cargado, en orden de cola. Contacto no verificado.</CardDescription>
              </div>
              <Link href={portfolioHref('/no-contact', filters)} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Ver casos
              </Link>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Objeto</TableHead>
                    <TableHead>Severidad (puntos)</TableHead>
                    <TableHead className="text-right">Atraso</TableHead>
                    <TableHead className="text-right">Deuda</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.withoutContactDebtors.length === 0 && <TableRow><TableCell colSpan={4}>{dashboard.withoutContactCases === null ? 'No disponible: lectura incompleta.' : 'Sin casos sin contacto.'}</TableCell></TableRow>}
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
                <CardDescription>Objetos por intervención; denominador: todos los objetos filtrados, incluso sin cola conocida. Las barras no representan prioridad.</CardDescription>
              </div>
              <Link
                href={portfolioHref('/recommended-actions', filters)}
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
                          recommendation === 'Revisión jurídica' && 'bg-[#9d3d3d]',
                          recommendation === 'Contacto y plan' && 'bg-[#8a6f2a]',
                          recommendation === 'Mejorar datos' && 'bg-[#163a63]',
                          recommendation === 'Seguimiento' && 'bg-[#2d6a4f]'
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
            <RiskDonutChart emptyMessage={chartEmpty}
              title="Distribución por severidad v1"
              data={dashboard.byRisk}
              legendLayout="side"
              size="compact"
            />
            <BarDistributionChart emptyMessage={chartEmpty}
              title="Objetos por tipo"
              data={dashboard.byDebtorType}
              size="compact"
            />
            <TopDebtHorizontalChart emptyMessage={chartEmpty} title="Top de deuda" data={dashboard.topDebtChart} size="compact" />
          </section>
        </section>
      </div>
    </AppShell>
  )
}
