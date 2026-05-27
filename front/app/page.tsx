import Link from 'next/link'
import {
  AlertCircle,
  CircleDollarSign,
  Clock3,
  ContactRound,
  FileWarning,
  ShieldAlert,
  Users,
} from 'lucide-react'

import { MetricCard } from '@/components/dashboard/metric-card'
import {
  BarDistributionChart,
  RiskDonutChart,
  TopDebtHorizontalChart,
} from '@/components/dashboard/chart-cards'
import { DataWarnings } from '@/components/equitas/data-warnings'
import { RiskBadge } from '@/components/equitas/risk-badge'
import { AppShell } from '@/components/layout/app-shell'
import { PersonRiskBadge } from '@/components/people/person-risk-badge'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getDashboardData } from '@/lib/equitas-data'
import { cn, formatCurrency } from '@/lib/utils'

const RECOMMENDATION_COLOR: Record<string, string> = {
  'Llamado prioritario': 'danger',
  'Mensaje recordatorio': 'warning',
  'Plan de pago / revision humana': 'info',
  'Seguimiento posterior': 'success',
}

export default async function HomePage() {
  const { dashboard, peopleDashboard, warnings } = await getDashboardData()
  const riskMap = new Map(dashboard.byRisk.map((item) => [item.label, item.value]))
  const highRiskCount = riskMap.get('ALTO') ?? 0
  const highRiskShare =
    dashboard.totalDebtors > 0
      ? Math.round((highRiskCount / dashboard.totalDebtors) * 100)
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
  const peopleHighRiskShare =
    peopleDashboard.totalPeople > 0
      ? Math.round((peopleDashboard.highRiskCount / peopleDashboard.totalPeople) * 100)
      : 0
  const executiveCards = [
    {
      label: 'Casos criticos hoy',
      value: dashboard.criticalCasesToday.toLocaleString('es-AR'),
      hint: 'Riesgo extremo, urgentes o sin contacto',
      icon: Clock3,
      tone: 'text-[#8a2f2f] border-[#e6c7c7] bg-[#f9efef]',
    },
    {
      label: 'Personas sin contacto',
      value: peopleDashboard.withoutContactCount.toLocaleString('es-AR'),
      hint: 'Sin telefono o email activo',
      icon: Users,
      tone: 'text-[#8a6f2a] border-[#ead8b0] bg-[#f8f2e3]',
    },
    {
      label: 'Objetos con riesgo > 90',
      value: dashboard.riskAboveNinetyCases.toLocaleString('es-AR'),
      hint: 'Escala de riesgo 0-100',
      icon: ShieldAlert,
      tone: 'text-[#9d3d3d] border-[#efd2d2] bg-[#f9eeee]',
    },
    {
      label: 'Deuda acumulada critica',
      value: formatCurrency(dashboard.criticalDebtTotal),
      hint: 'Suma de objetos con riesgo mayor a 90',
      icon: CircleDollarSign,
      tone: 'text-[#163a63] border-[#cfdaea] bg-[#edf2f9]',
    },
  ] as const

  return (
    <AppShell>
      <section className="mb-5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#163a63]">
            Dashboard operativo
          </h1>
          <p className="text-sm text-slate-600">
            Priorizacion inteligente de gestion para recupero municipal.
          </p>
        </div>
      </section>

      <div className="space-y-5">
        <DataWarnings warnings={warnings} />

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {executiveCards.map((card) => {
            const Icon = card.icon

            return (
              <Card
                key={card.label}
                className={cn(
                  'border shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md',
                  card.tone
                )}
              >
                <CardContent className="flex items-start justify-between gap-3 p-4">
                  <div>
                    <p className="text-[11px] font-semibold tracking-wide uppercase text-slate-600">
                      {card.label}
                    </p>
                    <p className="mt-1 text-xl font-semibold text-slate-900">{card.value}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{card.hint}</p>
                  </div>
                  <span className="rounded-lg bg-white/90 p-2 shadow-sm ring-1 ring-slate-200/80">
                    <Icon className="size-5" />
                  </span>
                </CardContent>
              </Card>
            )
          })}
        </section>

        <Card className="border-[#d2dceb] bg-white shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-[#163a63]">Resumen operativo del dia</CardTitle>
            <CardDescription>
              Vista ejecutiva para definir en que casos conviene gestionar primero.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
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
          </CardContent>
          <CardContent className="border-t border-[#e4e9f2] pt-3">
            <div className="grid grid-cols-1 gap-2 text-xs text-slate-700 md:grid-cols-2 xl:grid-cols-3">
              <p>
                <span className="font-semibold text-slate-900">{highRiskShare}%</span> de los
                objetos estan en riesgo alto.
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
                casos con bloqueo de gestion por falta de contacto.
              </p>
            </div>
          </CardContent>
        </Card>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card className="border-[#d2dceb]">
            <CardHeader>
              <CardTitle>A quien gestionar primero</CardTitle>
              <CardDescription>
                Top 5 por deuda, mora, riesgo, contacto y recomendacion.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Objeto</TableHead>
                    <TableHead>Riesgo</TableHead>
                    <TableHead className="text-right">Atraso</TableHead>
                    <TableHead className="text-right">Deuda</TableHead>
                    <TableHead>Contacto</TableHead>
                    <TableHead>Recomendacion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.topPriorityDebtors.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-slate-500">
                        No hay datos para priorizacion.
                      </TableCell>
                    </TableRow>
                  )}
                  {dashboard.topPriorityDebtors.map((debtor) => (
                    <TableRow key={debtor.id}>
                      <TableCell>
                        <div className="font-medium text-slate-900">{debtor.identifier}</div>
                        <p className="text-xs text-slate-500">{debtor.type}</p>
                        <p className="text-xs font-semibold text-[#163a63]">
                          Score: {debtor.priorityScore} ({debtor.priorityLevel})
                        </p>
                      </TableCell>
                      <TableCell>
                        <RiskBadge risk={debtor.risk} score={debtor.riskScore} />
                      </TableCell>
                      <TableCell className="text-right">{debtor.overdueDays} dias</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(debtor.totalDebt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={debtor.hasContact ? 'success' : 'warning'}>
                          {debtor.hasContact ? 'Disponible' : 'Faltante'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge
                          variant={
                            (RECOMMENDATION_COLOR[debtor.recommendationType] as
                              | 'danger'
                              | 'warning'
                              | 'info'
                              | 'success') ?? 'neutral'
                          }
                        >
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
            <CardHeader>
              <CardTitle>Casos sin contacto</CardTitle>
              <CardDescription>
                Objetos que hoy bloquean gestion directa por falta de canal activo.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Objeto</TableHead>
                    <TableHead>Riesgo</TableHead>
                    <TableHead className="text-right">Atraso</TableHead>
                    <TableHead className="text-right">Deuda</TableHead>
                    <TableHead className="text-right">Accion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.withoutContactDebtors.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-slate-500">
                        No hay casos sin contacto en el conjunto actual.
                      </TableCell>
                    </TableRow>
                  )}
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
                      <TableCell className="text-right">
                        {formatCurrency(debtor.totalDebt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/debtors/${encodeURIComponent(debtor.id)}`}
                          className={buttonVariants({ variant: 'outline', size: 'sm' })}
                        >
                          Ver
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card className="border-[#d2dceb]">
            <CardHeader>
              <CardTitle>Mayor deuda acumulada</CardTitle>
              <CardDescription>Top 5 por monto actualizado.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Objeto</TableHead>
                    <TableHead>Riesgo</TableHead>
                    <TableHead>Recomendacion</TableHead>
                    <TableHead className="text-right">Deuda total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.topDebtDebtors.map((debtor) => (
                    <TableRow key={debtor.id}>
                      <TableCell>
                        <div className="font-medium text-slate-900">{debtor.identifier}</div>
                        <p className="text-xs text-slate-500">{debtor.type}</p>
                      </TableCell>
                      <TableCell>
                        <RiskBadge risk={debtor.risk} score={debtor.riskScore} />
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            (RECOMMENDATION_COLOR[debtor.recommendationType] as
                              | 'danger'
                              | 'warning'
                              | 'info'
                              | 'success') ?? 'neutral'
                          }
                        >
                          {debtor.recommendationType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(debtor.totalDebt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="border-[#d2dceb]">
            <CardHeader>
              <CardTitle>Recomendaciones sugeridas</CardTitle>
              <CardDescription>Distribucion de accion operativa recomendada.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {dashboard.byRecommendation.map((bucket) => {
                const percentage =
                  dashboard.totalDebtors > 0
                    ? Math.round((bucket.value / dashboard.totalDebtors) * 100)
                    : 0

                return (
                  <div
                    key={bucket.label}
                    className="rounded-lg border border-slate-200 bg-slate-50/70 p-3"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <Badge
                        variant={
                          (RECOMMENDATION_COLOR[bucket.label] as
                            | 'danger'
                            | 'warning'
                            | 'info'
                            | 'success') ?? 'neutral'
                        }
                      >
                        {bucket.label}
                      </Badge>
                      <span className="text-xs font-semibold text-slate-700">
                        {bucket.value} casos ({percentage}%)
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          bucket.label === 'Llamado prioritario' && 'bg-[#9d3d3d]',
                          bucket.label === 'Mensaje recordatorio' && 'bg-[#8a6f2a]',
                          bucket.label === 'Plan de pago / revision humana' && 'bg-[#163a63]',
                          bucket.label === 'Seguimiento posterior' && 'bg-[#2d6a4f]'
                        )}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </CardContent>
            <CardContent className="pt-0">
              <p className="text-xs text-slate-700">
                {dominantRecommendation
                  ? `Insight: "${dominantRecommendation.label}" concentra ${Math.round(
                      (dominantRecommendation.value / Math.max(dashboard.totalDebtors, 1)) * 100
                    )}% de los objetos actuales.`
                  : 'Insight: sin datos suficientes para consolidar recomendacion dominante.'}
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-4">
          <BarDistributionChart title="Deuda por estado" data={dashboard.byDebtStatus} />
          <BarDistributionChart title="Objetos por tipo" data={dashboard.byDebtorType} />
          <RiskDonutChart title="Distribucion por riesgo" data={dashboard.byRisk} />
          <TopDebtHorizontalChart title="Top de deuda" data={dashboard.topDebtChart} />
        </section>

        <Card className="border-[#d2dceb]">
          <CardContent className="grid grid-cols-1 gap-2 py-4 text-xs text-slate-700 md:grid-cols-2">
            <p>
              Prioridad operativa:{' '}
              <span className="font-semibold text-slate-900">
                {dashboard.priorityCases.toLocaleString('es-AR')}
              </span>{' '}
              objetos en nivel ALTA.
            </p>
            <p>
              Lectura personas: riesgo alto individual en{' '}
              <span className="font-semibold text-slate-900">{peopleHighRiskShare}%</span> del
              padron visible.
            </p>
          </CardContent>
        </Card>

        <Card className="border-[#d2dceb]">
          <CardHeader>
            <CardTitle>Distribucion por riesgo</CardTitle>
            <CardDescription>
              Lectura rapida para dimensionar severidad y carga de gestion.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Alto</p>
              <p className="mt-2 text-2xl font-semibold text-rose-800">
                {(riskMap.get('ALTO') ?? 0).toLocaleString('es-AR')}
              </p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Medio</p>
              <p className="mt-2 text-2xl font-semibold text-amber-800">
                {(riskMap.get('MEDIO') ?? 0).toLocaleString('es-AR')}
              </p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Bajo</p>
              <p className="mt-2 text-2xl font-semibold text-emerald-800">
                {(riskMap.get('BAJO') ?? 0).toLocaleString('es-AR')}
              </p>
            </div>
          </CardContent>
        </Card>

        <section className="space-y-4">
          <Card className="border-[#d2dceb]">
            <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>Riesgo individual de personas</CardTitle>
                <CardDescription>
                  Seccion paralela basada en debtor_profile_detail.risk_value (0 a 100).
                </CardDescription>
              </div>
              <Link href="/people" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Ver Personas / Deudores
              </Link>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Riesgo bajo"
                value={peopleDashboard.lowRiskCount.toLocaleString('es-AR')}
                hint="Personas con risk_value entre 0 y 39"
                icon={Users}
                tone="success"
              />
              <MetricCard
                label="Riesgo medio"
                value={peopleDashboard.mediumRiskCount.toLocaleString('es-AR')}
                hint="Personas con risk_value entre 40 y 69"
                icon={Users}
                tone="warning"
              />
              <MetricCard
                label="Riesgo alto"
                value={peopleDashboard.highRiskCount.toLocaleString('es-AR')}
                hint="Personas con risk_value entre 70 y 100"
                icon={Users}
                tone="danger"
              />
              <MetricCard
                label="Sin contacto"
                value={peopleDashboard.withoutContactCount.toLocaleString('es-AR')}
                hint="Sin telefono/email activo"
                icon={AlertCircle}
                tone="accent"
              />
            </CardContent>
          </Card>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <RiskDonutChart
              title="Distribucion de riesgo individual"
              data={peopleDashboard.individualRiskDistribution}
            />

            <Card className="border-[#d2dceb]">
              <CardHeader>
                <CardTitle>Top 5 personas con mayor risk_value</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Persona</TableHead>
                      <TableHead>Riesgo</TableHead>
                      <TableHead className="text-right">risk_value</TableHead>
                      <TableHead className="text-right">Objetos</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {peopleDashboard.topPeopleByRiskValue.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-slate-500">
                          Sin personas visibles para el resumen individual.
                        </TableCell>
                      </TableRow>
                    )}
                    {peopleDashboard.topPeopleByRiskValue.map((person) => (
                      <TableRow key={person.id}>
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
        </section>

        <div className="flex justify-end">
          <Link href="/debtors" className={buttonVariants({ size: 'lg' })}>
            <Users className="size-4" />
            Ver listado completo
          </Link>
        </div>
      </div>
    </AppShell>
  )
}
