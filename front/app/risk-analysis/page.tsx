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

export default async function RiskAnalysisPage() {
  const [{ debtors, warnings: debtorWarnings }, { people, peopleDashboard, warnings: peopleWarnings }] =
    await Promise.all([getDebtorsData(), getPeopleData()])
  const warnings = [...debtorWarnings, ...peopleWarnings]
  const objectRiskDistribution = ['ALTO', 'MEDIO', 'BAJO'].map((risk) => ({
    label: risk,
    value: debtors.filter((debtor) => debtor.risk === risk).length,
  }))
  const highRiskCases = getHighRiskCases(debtors)
  const highIndividualRiskPeople = getHighIndividualRiskPeople(people)

  return (
    <AppShell>
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-[#163a63]">
          Analisis de riesgo
        </h1>
        <p className="text-sm text-slate-600">
          El riesgo del objeto representa la criticidad del caso. El riesgo individual representa
          la criticidad de cada persona asociada.
        </p>
      </section>

      <div className="space-y-6">
        <DataWarnings warnings={warnings} />

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Card className="border-[#d2dceb]">
            <CardHeader>
              <CardTitle>Riesgo del objeto</CardTitle>
              <CardDescription>Basado en la criticidad consolidada del caso.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-start justify-between gap-3 rounded-lg border border-[#efd2d2] bg-[#fbefef] p-4">
                <div>
                  <p className="text-xs font-semibold uppercase text-[#8f3434]">
                    Objetos con riesgo &gt; 90
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">
                    {highRiskCases.length.toLocaleString('es-AR')}
                  </p>
                  <p className="text-xs text-slate-600">Criticidad extrema del caso</p>
                </div>
                <ShieldAlert className="size-5 text-[#9d3d3d]" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-[#d2dceb]">
            <CardHeader>
              <CardTitle>Riesgo individual</CardTitle>
              <CardDescription>Basado en el puntaje individual de cada persona.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-start justify-between gap-3 rounded-lg border border-[#e7d2ae] bg-[#f9f3e4] p-4">
                <div>
                  <p className="text-xs font-semibold uppercase text-[#6f561e]">
                    Personas con puntaje alto
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">
                    {highIndividualRiskPeople.length.toLocaleString('es-AR')}
                  </p>
                  <p className="text-xs text-slate-600">Puntaje individual desde 70</p>
                </div>
                <UsersRound className="size-5 text-[#8a6f2a]" />
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <RiskDonutChart title="Distribucion de objetos por riesgo" data={objectRiskDistribution} />
          <RiskDonutChart
            title="Distribucion de personas por riesgo individual"
            data={peopleDashboard.individualRiskDistribution}
          />
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card className="border-[#d2dceb]">
            <CardHeader>
              <CardTitle>Objetos con riesgo mayor a 90</CardTitle>
              <CardDescription>Casos con score de riesgo extremo.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Objeto</TableHead>
                    <TableHead>Riesgo</TableHead>
                    <TableHead className="text-right">Deuda</TableHead>
                    <TableHead className="text-right">Accion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {highRiskCases.slice(0, 10).map((debtor) => (
                    <TableRow key={debtor.id}>
                      <TableCell>
                        <div className="font-medium text-slate-900">{debtor.identifier}</div>
                        <p className="text-xs text-slate-500">{debtor.type}</p>
                      </TableCell>
                      <TableCell>
                        <RiskBadge risk={debtor.risk} score={debtor.riskScore} />
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(debtor.totalDebt)}</TableCell>
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
            </CardContent>
          </Card>

          <Card className="border-[#d2dceb]">
            <CardHeader>
              <CardTitle>Personas con puntaje alto</CardTitle>
              <CardDescription>Personas con puntaje individual desde 70.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Persona</TableHead>
                    <TableHead>Riesgo individual</TableHead>
                    <TableHead className="text-right">Puntaje</TableHead>
                    <TableHead className="text-right">Objetos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {highIndividualRiskPeople.slice(0, 10).map((person) => (
                    <TableRow key={person.id}>
                      <TableCell>
                        <div className="font-medium text-slate-900">{person.name}</div>
                        <p className="text-xs text-slate-500">{person.document}</p>
                      </TableCell>
                      <TableCell>
                        <PersonRiskBadge risk={person.individualRisk} score={person.riskValue} />
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
      </div>
    </AppShell>
  )
}
