import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'

import { RiskDonutChart } from '@/components/dashboard/chart-cards'
import { DataWarnings } from '@/components/equitas/data-warnings'
import { AppShell } from '@/components/layout/app-shell'
import { LegacyIndexPanel } from '@/components/people/legacy-index-panel'
import { PriorityScoreBadge } from '@/components/portfolio/case-cells'
import { emptyPortfolioScreen, PageHeading } from '@/components/portfolio/portfolio-state'
import { bandLabel, casesLabel, filterLine, filterNotes, isEmptyLegacyIndexWarning, missingLines, SCORE_LABEL, SCORE_NOTE, SCORE_RECIPE } from '@/components/portfolio/portfolio-text'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableScrollHint } from '@/components/ui/table'
import { formatNumber, readingFailed } from '@/lib/data-presence'
import { getDebtorsData, getPeopleData } from '@/lib/equitas-data'
import { getHighRiskCases } from '@/lib/equitas-view-selectors'
import { mapDashboardMetricsFromDebtorObjects } from '@/lib/mappers/dashboard-metrics-mapper'
import { filterPortfolio, normalizePortfolioSearchParams, portfolioHref, type RawPortfolioSearchParams } from '@/lib/portfolio-filters'
import { formatCurrency } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const TITLE = SCORE_LABEL

export default async function RiskAnalysisPage({ searchParams }: { searchParams?: Promise<RawPortfolioSearchParams> } = {}) {
  const empty = await emptyPortfolioScreen(TITLE)
  if (empty) return empty
  const [source, { people, peopleDashboard, warnings: peopleWarnings }] = await Promise.all([getDebtorsData(), getPeopleData()])
  const filters = normalizePortfolioSearchParams(await searchParams ?? {})
  const active = Object.values(filters).some(Boolean)
  const { items: debtors, warnings: debtorWarnings, failed } = filterPortfolio(source.debtors, filters, source.warnings)
  const objectDashboard = mapDashboardMetricsFromDebtorObjects({ debtors, debtStatusBuckets: new Map(), warnings: debtorWarnings })
  const objectRiskDistribution = objectDashboard.byRisk.filter(item => item.label !== 'No disponible').map(item => ({ label: bandLabel(item.label), value: item.value }))
  const withoutScore = objectDashboard.byRisk.find(item => item.label === 'No disponible')?.value ?? 0
  const highRiskCases = getHighRiskCases(debtors)
  // El aviso «sin filas» del índice anterior no es un error de lectura: el panel lo explica aparte.
  const readWarnings = [...source.warnings, ...peopleWarnings.filter(warning => !isEmptyLegacyIndexWarning(warning))]
  const missing = missingLines([[SCORE_LABEL, objectDashboard.metrics?.priorityCases], ['Casos con puntaje mayor a 90', objectDashboard.metrics?.riskAboveNinetyCases]])

  return (
    <AppShell>
      <PageHeading title={TITLE} description={`${SCORE_NOTE} ${SCORE_RECIPE}`} />

      <div className="space-y-5">
        <DataWarnings warnings={readWarnings} />
        {filterNotes(debtorWarnings, source.warnings).map(note => <p key={note.message} role="status" className="text-sm text-amber-800">{note.message}</p>)}
        {active && <p className="text-sm text-slate-700">{filterLine(failed ? null : debtors.length, readingFailed(source.warnings, 'debtor') ? null : source.debtors.length)}</p>}
        {missing && <p className="text-xs text-slate-600">Datos faltantes que afectan los cálculos. {missing}.</p>}

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card className="border-[#d2dceb]">
            <CardHeader>
              <CardTitle>Casos en banda alta</CardTitle>
              <CardDescription>{SCORE_LABEL} desde 70 hasta 100, inclusive.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-start justify-between gap-3 rounded-lg border border-[#efd2d2] bg-[#fbefef] p-4">
                <div>
                  <p className="text-2xl font-semibold text-slate-900">{formatNumber(objectDashboard.priorityCases)}</p>
                  <p className="text-xs text-slate-600">{objectDashboard.coverage?.highSeverityCases}</p>
                </div>
                <ShieldAlert className="size-5 text-[#9d3d3d]" aria-hidden />
              </div>
            </CardContent>
          </Card>
          {objectRiskDistribution.some(item => item.value > 0)
            ? <RiskDonutChart title="Casos por banda" data={objectRiskDistribution} size="compact" />
            : objectDashboard.priorityCases === null && <RiskDonutChart title="Casos por banda" data={[]} emptyMessage="No disponible: no se pudo calcular el puntaje de los casos." />}
        </section>
        {withoutScore > 0 && <p className="text-xs text-slate-600">{casesLabel(withoutScore)} sin {SCORE_LABEL.toLowerCase()} calculado: no entran en el gráfico.</p>}

        <Card className="border-[#d2dceb]">
          <CardHeader>
            <CardTitle>Casos en banda alta (hasta 10)</CardTitle>
            <CardDescription>En el orden de su grupo de trabajo, no por un ranking entre grupos.</CardDescription>
          </CardHeader>
          <CardContent>
            <TableScrollHint />
            <Table className="table-fixed min-w-[30rem] md:min-w-[36rem]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[34%] md:w-[26%]">Identificador</TableHead>
                  <TableHead className="hidden w-[24%] md:table-cell">Grupo de trabajo</TableHead>
                  <TableHead className="w-[33%] md:w-[24%]">{SCORE_LABEL}</TableHead>
                  <TableHead className="w-[33%] text-right md:w-[26%]">Deuda pendiente</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {highRiskCases.length === 0 && (
                  <TableRow><TableCell colSpan={4}>{objectDashboard.priorityCases === null ? 'No disponible: no se pudo calcular el puntaje de los casos.' : 'No hay casos en banda alta.'}</TableCell></TableRow>
                )}
                {highRiskCases.slice(0, 10).map(debtor => (
                  <TableRow key={debtor.id}>
                    <TableCell className="align-top">
                      <Link href={portfolioHref(`/debtors/${encodeURIComponent(debtor.id)}`, filters)} className="font-medium break-words text-[#163a63] underline">{debtor.identifier}</Link>
                      <p className="text-xs text-slate-500">{debtor.type}</p>
                    </TableCell>
                    <TableCell className="hidden align-top md:table-cell">{debtor.recommendationType}</TableCell>
                    <TableCell className="align-top"><PriorityScoreBadge debtor={debtor} /></TableCell>
                    <TableCell className="text-right align-top">{formatCurrency(debtor.pendingDebt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <LegacyIndexPanel people={people} summary={peopleDashboard} warnings={peopleWarnings} />
      </div>
    </AppShell>
  )
}
