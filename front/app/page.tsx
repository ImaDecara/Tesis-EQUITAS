import Link from 'next/link'
import {
  CircleDollarSign,
  ContactRound,
  Eye,
  FileWarning,
  ShieldAlert,
  Users,
} from 'lucide-react'

import { MetricCard } from '@/components/dashboard/metric-card'
import {
  BarDistributionChart,
  RiskDonutChart,
} from '@/components/dashboard/chart-cards'
import { DataWarnings } from '@/components/equitas/data-warnings'
import { RiskBadge } from '@/components/equitas/risk-badge'
import { AppShell } from '@/components/layout/app-shell'
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
import { formatCurrency } from '@/lib/utils'

export default async function HomePage() {
  const { dashboard, warnings } = await getDashboardData()

  return (
    <AppShell>
      <section className="mb-7 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Dashboard general
          </h1>
          <p className="text-sm text-slate-600">
            Seguimiento operativo de recupero por objeto de deuda.
          </p>
        </div>
      </section>

      <div className="space-y-6">
        <DataWarnings warnings={warnings} />

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label="Total objetos"
            value={dashboard.totalDebtors.toLocaleString('es-AR')}
            hint="Debtors activos en el alcance visible"
            icon={Users}
            tone="emerald"
          />
          <MetricCard
            label="Deuda total"
            value={formatCurrency(dashboard.totalDebt)}
            hint="Monto consolidado actualizado"
            icon={CircleDollarSign}
            tone="sky"
          />
          <MetricCard
            label="Casos vencidos"
            value={dashboard.overdueCases.toLocaleString('es-AR')}
            hint="Objetos con al menos una deuda vencida"
            icon={FileWarning}
            tone="amber"
          />
          <MetricCard
            label="Con contacto"
            value={dashboard.withContactCases.toLocaleString('es-AR')}
            hint="Casos con contacto utilizable"
            icon={ContactRound}
            tone="indigo"
          />
          <MetricCard
            label="Prioritarios"
            value={dashboard.priorityCases.toLocaleString('es-AR')}
            hint="Casos de riesgo alto"
            icon={ShieldAlert}
            tone="rose"
          />
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <BarDistributionChart
            title="Deuda por estado"
            data={dashboard.byDebtStatus}
          />
          <BarDistributionChart
            title="Objetos por tipo"
            data={dashboard.byDebtorType}
          />
          <RiskDonutChart title="Distribución de riesgo" data={dashboard.byRisk} />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Top 5 objetos con mayor deuda</CardTitle>
            <CardDescription>Priorización sugerida para gestión intensiva</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Identificador</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Riesgo</TableHead>
                  <TableHead className="text-right">Deuda total</TableHead>
                  <TableHead className="text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dashboard.topDebtors.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-slate-500">
                      No hay datos visibles para priorización.
                    </TableCell>
                  </TableRow>
                )}
                {dashboard.topDebtors.map((debtor) => (
                  <TableRow key={debtor.id}>
                    <TableCell className="font-medium text-slate-900">
                      {debtor.identifier}
                    </TableCell>
                    <TableCell>{debtor.type}</TableCell>
                    <TableCell>
                      <RiskBadge risk={debtor.risk} />
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(debtor.totalDebt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/debtors/${encodeURIComponent(debtor.id)}`}
                        className={buttonVariants({ size: 'sm' })}
                      >
                        <Eye className="size-3.5" />
                        Ver detalle
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
