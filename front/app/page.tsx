import Link from 'next/link'
import { CircleDollarSign, FileDown, FileWarning, PhoneOff, ShieldAlert, WalletCards } from 'lucide-react'

import { BarDistributionChart, RiskDonutChart, TopDebtHorizontalChart } from '@/components/dashboard/chart-cards'
import { MetricCard } from '@/components/dashboard/metric-card'
import { DataWarnings } from '@/components/equitas/data-warnings'
import { AppShell } from '@/components/layout/app-shell'
import { emptyPortfolioScreen, PageHeading } from '@/components/portfolio/portfolio-state'
import { bandLabel, casesLabel, daysLabel, filterLine, GROUP_CRITERIA, isEmptyLegacyIndexWarning, missingLines, SCORE_LABEL, SCORE_NOTE, SCORE_RECIPE, scoreText, scoreView } from '@/components/portfolio/portfolio-text'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatNumber, formatPercentage, percentageData } from '@/lib/data-presence'
import { getDashboardData } from '@/lib/equitas-data'
import { RECOMMENDATION_KINDS } from '@/lib/equitas-view-selectors'
import { normalizePortfolioSearchParams, portfolioHref, type RawPortfolioSearchParams } from '@/lib/portfolio-filters'
import { cn, formatCurrency } from '@/lib/utils'
import type { NumericData } from '@/types/equitas-domain'

export const dynamic = 'force-dynamic'

const TITLE = 'Tablero'
const BAR_COLOR: Record<string, string> = {
  'Revisión jurídica': 'bg-[#9d3d3d]', 'Contacto y plan': 'bg-[#8a6f2a]', 'Mejorar datos': 'bg-[#163a63]',
  Recordatorio: 'bg-[#436584]', Seguimiento: 'bg-[#2d6a4f]',
}
// Un porcentaje sin base no se escribe «No aplica de los casos».
const shareText = (share: NumericData) => share.value !== null ? `${formatPercentage(share)} de los casos.`
  : share.presence === 'NO_APLICA' ? 'Sin casos en la selección.' : 'Porcentaje no disponible.'
const isFiltered = (filters: Record<string, string | undefined>) => Object.entries(filters).some(([key, value]) => key !== 'page' && key !== 'pageSize' && Boolean(value))

export default async function HomePage({ searchParams }: { searchParams?: Promise<RawPortfolioSearchParams> } = {}) {
  const empty = await emptyPortfolioScreen(TITLE)
  if (empty) return empty
  const filters = normalizePortfolioSearchParams(await searchParams ?? {})
  const { dashboard, warnings: readWarnings } = await getDashboardData(filters)
  // Que la cartera no traiga el índice anterior por persona no es un error de lectura: el tablero no lo muestra.
  const warnings = readWarnings.filter(warning => !isEmptyLegacyIndexWarning(warning))
  const metrics = dashboard.metrics ?? {}
  const total = dashboard.totalDebtors
  const highRiskShare = percentageData(dashboard.priorityCases, total)
  // Un grupo vacío sin caso «No disponible» no se muestra: solo aparece si hay casos sin evaluar.
  const groups = RECOMMENDATION_KINDS.map(label => ({
    label,
    count: dashboard.byRecommendation.find(item => item.label === label)?.value ?? null,
    preview: dashboard.queuePreviews?.find(item => item.label === label),
  })).filter(group => group.label !== 'No disponible' || (group.count ?? 0) > 0)
  // Gráficos opcionales: se retiran si el dato no existe para ningún caso; un error de lectura se dice.
  const scoreBuckets = dashboard.byRisk.filter(item => item.label !== 'No disponible').map(item => ({ label: bandLabel(item.label), value: item.value }))
  const withoutScore = dashboard.byRisk.find(item => item.label === 'No disponible')?.value ?? 0
  const readFailed = warnings.length > 0
  const unavailableChart = 'No disponible: no se pudieron leer los datos necesarios.'
  const missing = missingLines([
    ['Total registrado', metrics.totalDebt], ['Deuda pendiente', metrics.pendingDebt], ['Deuda vencida', metrics.overdueDebt],
    ['Casos con deuda vencida', metrics.overdueCases], ['Puntaje de prioridad', metrics.priorityCases], ['Contacto', metrics.withoutContactCases],
  ])

  return (
    <AppShell>
      <PageHeading title={TITLE} description="Resumen de la cartera del municipio para decidir qué casos trabajar." />

      <div className="space-y-5">
        <DataWarnings warnings={warnings} />
        {isFiltered(filters) && <p className="text-sm text-slate-700">{filterLine(total)}</p>}
        {missing && <p className="text-xs text-slate-600">Datos faltantes que afectan los cálculos. {missing}.</p>}

        <section aria-label="Totales de la cartera" className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <MetricCard label="Total registrado" value={formatCurrency(dashboard.totalDebt)}
            hint={`Todas las obligaciones, cualquiera sea su estado. ${dashboard.coverage?.totalDebt ?? ''}`} icon={CircleDollarSign} tone="primary" />
          <MetricCard label="Deuda pendiente" value={formatCurrency(dashboard.pendingDebt)}
            hint={`Total registrado sin las obligaciones pagadas. ${dashboard.coverage?.pendingDebt ?? ''}`} icon={WalletCards} tone="accent" />
          <MetricCard label="Deuda vencida" value={formatCurrency(dashboard.overdueDebt)}
            hint={`Deuda pendiente con vencimiento anterior a la fecha de la cartera. ${dashboard.coverage?.overdueDebt ?? ''}`} icon={FileWarning} tone="danger" />
          <MetricCard label="Casos con deuda vencida" value={formatNumber(dashboard.overdueCases)}
            hint={`Al menos una obligación pendiente vencida. ${dashboard.coverage?.overdueCases ?? ''}`} icon={FileWarning} tone="warning" />
          <MetricCard label="Casos con puntaje alto" value={formatNumber(dashboard.priorityCases)}
            hint={`${SCORE_LABEL} desde 70. ${shareText(highRiskShare)} ${dashboard.coverage?.priorityCases ?? ''}`} icon={ShieldAlert} tone="critical" />
          <MetricCard label="Casos sin contacto" value={formatNumber(dashboard.withoutContactCases)}
            hint={`Sin un contacto activo cargado. ${dashboard.coverage?.withoutContactCases ?? ''}`} icon={PhoneOff} tone="warning" />
        </section>

        <details className="rounded-lg border border-[#d2dceb] bg-white p-4 text-sm text-slate-700" data-definitions>
          <summary className="cursor-pointer font-semibold text-[#163a63]">¿Qué significan estas cifras?</summary>
          <dl className="mt-3 space-y-2">
            <div><dt className="font-medium">Total registrado</dt><dd>El importe de todas las obligaciones de la cartera, cualquiera sea su estado.</dd></div>
            <div><dt className="font-medium">Deuda pendiente</dt><dd>El total registrado sin las obligaciones pagadas.</dd></div>
            <div><dt className="font-medium">Deuda vencida</dt><dd>Las obligaciones pendientes con importe mayor que cero y vencimiento anterior a la fecha de la cartera.</dd></div>
            <div><dt className="font-medium">{SCORE_LABEL}</dt><dd>{SCORE_NOTE} {SCORE_RECIPE}</dd></div>
            <div><dt className="font-medium">Caso</dt><dd>Un objeto tributario (un inmueble, un rodado, una conexión), no una persona.</dd></div>
          </dl>
          {dashboard.byDebtStatus.length > 0 && (
            <p className="mt-3 text-xs text-slate-600">
              Obligaciones por estado (informativo, no cambia ningún cálculo): {dashboard.byDebtStatus.map(item => `${item.label} ${formatNumber(item.value)}`).join(' · ')}.
            </p>
          )}
          <p className="mt-3"><Link href="/help" className="font-medium text-[#163a63] underline">Ver la ayuda completa</Link></p>
        </details>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card className="border-[#d2dceb]">
            <CardHeader>
              <CardTitle>Grupos de trabajo</CardTitle>
              <CardDescription>
                Cada caso está en un solo grupo, por reglas. Dentro de cada grupo los casos se ordenan por su {SCORE_LABEL.toLowerCase()}; entre grupos no se compara.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {groups.map(group => {
                const percentage = percentageData(group.count, total)
                return (
                  <section key={group.label} data-group={group.label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link href={portfolioHref('/priority-cases', filters, { queue: group.preview?.code ?? 'SIN_COLA', page: '' })} className="font-semibold text-[#163a63] underline">{group.label}</Link>
                      <span className="text-xs font-semibold text-slate-700">{group.count === null ? formatNumber(null) : `${casesLabel(group.count)} (${formatPercentage(percentage)})`}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200" aria-hidden>
                      <div className={cn('h-full rounded-full', BAR_COLOR[group.label] ?? 'bg-slate-500')} style={{ width: percentage.value === null ? undefined : `${percentage.value}%` }} />
                    </div>
                    {group.preview && group.preview.cases.length > 0 && (
                      <ul className="mt-2 space-y-1 text-sm">
                        {group.preview.cases.map(debtor => (
                          <li key={debtor.id}>
                            <Link href={portfolioHref(`/debtors/${encodeURIComponent(debtor.id)}`, filters)} className="font-medium underline">{debtor.identifier}</Link>
                            {' · '}{scoreView(debtor).text}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )
              })}
              <details className="text-xs text-slate-600">
                <summary className="cursor-pointer">Cómo se arma cada grupo</summary>
                <ol className="mt-2 list-decimal space-y-1 pl-5">
                  {GROUP_CRITERIA.map(item => <li key={item.rule}>Si {item.rule}: {item.group}.</li>)}
                </ol>
                <p className="mt-1">Gana la primera regla que se cumple. No es clustering ni aprendizaje automático.</p>
              </details>
            </CardContent>
          </Card>

          <Card className="border-[#d2dceb]">
            <CardHeader className="gap-2 md:flex-row md:items-center md:justify-between md:space-y-0">
              <div>
                <CardTitle>Casos sin contacto</CardTitle>
                <CardDescription>Hasta 5, en el orden de su grupo de trabajo. Contacto cargado, no verificado.</CardDescription>
              </div>
              <Link href={portfolioHref('/no-contact', filters)} className={buttonVariants({ variant: 'outline', size: 'sm' })}>Ver todos</Link>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Caso</TableHead>
                    <TableHead>{SCORE_LABEL}</TableHead>
                    <TableHead className="text-right">Atraso máximo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.withoutContactDebtors.length === 0 && (
                    <TableRow><TableCell colSpan={3}>{dashboard.withoutContactCases === null ? 'No disponible: no se pudieron leer los contactos.' : 'Todos los casos tienen un contacto cargado.'}</TableCell></TableRow>
                  )}
                  {dashboard.withoutContactDebtors.map(debtor => (
                    <TableRow key={debtor.id}>
                      <TableCell>
                        <Link href={portfolioHref(`/debtors/${encodeURIComponent(debtor.id)}`, filters)} className="font-medium text-[#163a63] underline">{debtor.identifier}</Link>
                        <p className="text-xs text-slate-500">{debtor.type}</p>
                      </TableCell>
                      <TableCell>{scoreText(debtor.riskScore, debtor.risk).text}</TableCell>
                      <TableCell className="text-right">{daysLabel(debtor.overdueDays)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {scoreBuckets.some(item => item.value > 0)
            ? <RiskDonutChart title={`Casos por banda de ${SCORE_LABEL.toLowerCase()}`} data={scoreBuckets} legendLayout="bottom" size="compact" />
            : readFailed && <RiskDonutChart title={`Casos por banda de ${SCORE_LABEL.toLowerCase()}`} data={[]} emptyMessage={unavailableChart} />}
          <BarDistributionChart emptyMessage={readFailed ? unavailableChart : 'No hay casos en la selección.'} title="Casos por tipo" data={dashboard.byDebtorType} size="compact" />
          <TopDebtHorizontalChart emptyMessage={readFailed ? unavailableChart : 'No hay importes registrados.'} title="Casos con mayor total registrado" data={dashboard.topDebtChart} size="compact" />
        </section>
        {withoutScore > 0 && <p className="text-xs text-slate-600">{casesLabel(withoutScore)} sin {SCORE_LABEL.toLowerCase()} calculado: no entran en el gráfico de bandas.</p>}

        <p>
          <Link href="/reports" className={buttonVariants({ variant: 'outline', size: 'sm' })}><FileDown className="size-3.5" />Ver reportes</Link>
        </p>
      </div>
    </AppShell>
  )
}
