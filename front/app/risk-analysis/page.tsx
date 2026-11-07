import { PortfolioScope } from '@/components/equitas/portfolio-scope'
import { coverageText, portfolioContext } from '@/lib/analytics'
import { filterPortfolio, portfolioHref, normalizePortfolioSearchParams, type RawPortfolioSearchParams } from '@/lib/portfolio-filters'
import { mapDashboardMetricsFromDebtorObjects } from '@/lib/mappers/dashboard-metrics-mapper'
import { formatNumber, metric, missingSummary, readingFailed } from '@/lib/data-presence'
import Link from 'next/link'
import { Eye, ShieldAlert, UsersRound } from 'lucide-react'

import { RiskDonutChart } from '@/components/dashboard/chart-cards'
import { DataWarnings } from '@/components/equitas/data-warnings'
import { RiskBadge } from '@/components/equitas/risk-badge'
import { AppShell } from '@/components/layout/app-shell'
import { PersonRiskBadge } from '@/components/people/person-risk-badge'
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
import { getDebtorsData, getPeopleData } from '@/lib/equitas-data'
import { getHighIndividualRiskPeople, getHighRiskCases } from '@/lib/equitas-view-selectors'
import { formatCurrency } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function RiskAnalysisPage({ searchParams }: { searchParams?: Promise<RawPortfolioSearchParams> } = {}) {
  const [source, { people, peopleDashboard, warnings: peopleWarnings }] =
    await Promise.all([getDebtorsData(), getPeopleData()])
  const filters = normalizePortfolioSearchParams(await searchParams ?? {})
  const { items: debtors, warnings: debtorWarnings } = filterPortfolio(source.debtors, filters, source.warnings)
  const warnings = [...debtorWarnings, ...peopleWarnings]
  const objectDashboard = mapDashboardMetricsFromDebtorObjects({ debtors, debtStatusBuckets: new Map(), warnings: debtorWarnings })
  const objectRiskDistribution = objectDashboard.byRisk
  const highRiskCases = getHighRiskCases(debtors)
  const highIndividualRiskPeople = getHighIndividualRiskPeople(people)

  const chartEmpty = 'No hay valores observados para graficar; consulte los avisos y la cobertura.'

  return (
    <AppShell>
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-[#163a63]">
          Análisis de severidad
        </h1>
        <p className="text-sm text-slate-600">
          La severidad v1 describe el objeto. Para personas se muestra la máxima severidad
          entre sus objetos vinculados según el índice heredado por persona. Son puntos de 0 a 100;
          no son porcentajes ni probabilidades de pago.
        </p>
      </section>

      <div className="space-y-6">
        <DataWarnings warnings={warnings} />
        <PortfolioScope context={portfolioContext(source.debtors, source.warnings, source.batch)} filters={filters} />
        <p className="text-xs text-slate-600">Panel de personas: universo completo de personas leídas, independiente de los filtros de objetos; corte del índice heredado no informado.</p>
        <p className="text-xs text-slate-600">{missingSummary(objectDashboard.metrics)} {missingSummary(peopleDashboard.metrics)}</p>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Card className="border-[#d2dceb]">
            <CardHeader>
              <CardTitle>Severidad del objeto (v1)</CardTitle>
              <CardDescription>Puntaje heurístico del objeto según las reglas v1.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-start justify-between gap-3 rounded-lg border border-[#efd2d2] bg-[#fbefef] p-4">
                <div>
                  <p className="text-xs font-semibold uppercase text-[#8f3434]">
                    Objetos en banda alta, desde 70 puntos
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">
                    {formatNumber(objectDashboard.priorityCases)}
                  </p>
                  <p className="text-xs text-slate-600">Conteo desde 70 hasta 100 puntos, inclusive. {objectDashboard.coverage?.highSeverityCases}</p>
                </div>
                <ShieldAlert className="size-5 text-[#9d3d3d]" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-[#d2dceb]">
            <CardHeader>
              <CardTitle>Máxima severidad heredada</CardTitle>
              <CardDescription>Máximo del índice heredado por persona entre sus objetos vinculados.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-start justify-between gap-3 rounded-lg border border-[#e7d2ae] bg-[#f9f3e4] p-4">
                <div>
                  <p className="text-xs font-semibold uppercase text-[#6f561e]">
                    Personas con severidad heredada alta
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">
                    {formatNumber(peopleDashboard.highRiskCount)}
                  </p>
                  <p className="text-xs text-slate-600">Índice heredado desde 70 puntos. {coverageText(people.map(item => metric(item, 'riskValue')), readingFailed(peopleWarnings, 'person', 'debtor_profile_detail'), 'personas')}</p>
                </div>
                <UsersRound className="size-5 text-[#8a6f2a]" />
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <RiskDonutChart emptyMessage={chartEmpty} title="Distribución de objetos por severidad v1" data={objectRiskDistribution} />
          <RiskDonutChart emptyMessage={chartEmpty}
            title="Distribución de personas por máxima severidad heredada"
            data={peopleDashboard.individualRiskDistribution}
          />
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card className="border-[#d2dceb]">
            <CardHeader>
              <CardTitle>Objetos en banda alta, desde 70 puntos</CardTitle>
              <CardDescription>Hasta 10 objetos con severidad de 70 a 100 puntos; incluye 70 y 90. Primeros 10 agrupados por cola, no por severidad global. Las prioridades de colas distintas no se comparan.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Objeto</TableHead>
                    <TableHead>Severidad (puntos de 0 a 100)</TableHead>
                    <TableHead className="text-right">Deuda</TableHead>
                    <TableHead className="text-right">Accion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {highRiskCases.length === 0 && <TableRow><TableCell colSpan={4}>{objectDashboard.priorityCases === null ? 'No disponible: severidad no evaluable o lectura incompleta.' : 'No hay objetos en banda alta.'}</TableCell></TableRow>}
                  {highRiskCases.slice(0, 10).map((debtor) => (
                    <TableRow key={debtor.id}>
                      <TableCell>
                        <div className="font-medium text-slate-900">{debtor.identifier}</div>
                        <p className="text-xs text-slate-500">{debtor.type} · {debtor.recommendationType}</p>
                      </TableCell>
                      <TableCell>
                        <RiskBadge risk={debtor.risk} score={debtor.riskScore} />
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(debtor.totalDebt)}</TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={portfolioHref(`/debtors/${encodeURIComponent(debtor.id)}`, filters)}
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
            </CardContent>
          </Card>

          <Card className="border-[#d2dceb]">
            <CardHeader>
              <CardTitle>Personas con severidad heredada alta</CardTitle>
              <CardDescription>Hasta 10 personas con índice heredado máximo desde 70 puntos entre sus objetos.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Persona</TableHead>
                    <TableHead>Máxima severidad heredada</TableHead>
                    <TableHead className="text-right">Puntaje (puntos de 0 a 100)</TableHead>
                    <TableHead className="text-right">Objetos vinculados</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {highIndividualRiskPeople.length === 0 && <TableRow><TableCell colSpan={4}>{peopleDashboard.highRiskCount === null ? 'No disponible: índice heredado no integrado o lectura incompleta.' : 'No hay personas en banda alta.'}</TableCell></TableRow>}
                  {highIndividualRiskPeople.slice(0, 10).map((person) => (
                    <TableRow key={person.id}>
                      <TableCell>
                        <div className="font-medium text-slate-900">{person.name}</div>
                        <p className="text-xs text-slate-500">{person.document}</p>
                      </TableCell>
                      <TableCell>
                        <PersonRiskBadge risk={person.individualRisk} score={person.riskValue} />
                      </TableCell>
                      <TableCell className="text-right">{formatNumber(person.riskValue, 2)}</TableCell>
                      <TableCell className="text-right">{formatNumber(person.debtorsCount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      </div>
    </AppShell>
  )
}
