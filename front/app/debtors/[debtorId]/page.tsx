import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { DataWarnings } from '@/components/equitas/data-warnings'
import { RiskBadge } from '@/components/equitas/risk-badge'
import { AppShell } from '@/components/layout/app-shell'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getDebtorDetailData } from '@/lib/equitas-data'
import { formatCurrency, formatDate } from '@/lib/utils'

export default async function DebtorDetailPage({
  params,
}: {
  params: Promise<{ debtorId: string }>
}) {
  const { debtorId } = await params
  const { detail, warnings } = await getDebtorDetailData(debtorId)

  if (!detail) {
    notFound()
  }

  const { debtor, debts, people, profile } = detail

  return (
    <AppShell>
      <section className="mb-6 space-y-3">
        <Link
          href="/debtors"
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="size-3.5" />
          Volver al listado
        </Link>

        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {debtor.identifier}
            </h1>
            <p className="text-sm text-slate-600">{debtor.description}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">{debtor.type}</Badge>
            <Badge variant="info">{debtor.status}</Badge>
            <RiskBadge risk={debtor.risk} />
          </div>
        </div>
      </section>

      <div className="space-y-6">
        <DataWarnings warnings={warnings} />

        <Tabs defaultValue="summary">
          <TabsList>
            <TabsTrigger value="summary">Resumen</TabsTrigger>
            <TabsTrigger value="people">Personas</TabsTrigger>
            <TabsTrigger value="debts">Deudas</TabsTrigger>
            <TabsTrigger value="risk">Perfil/Riesgo</TabsTrigger>
          </TabsList>

          <TabsContent value="summary">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Resumen del objeto</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-slate-700">
                  <p>
                    <span className="font-medium text-slate-900">Identificador:</span>{' '}
                    {debtor.identifier}
                  </p>
                  <p>
                    <span className="font-medium text-slate-900">Tipo:</span> {debtor.type}
                  </p>
                  <p>
                    <span className="font-medium text-slate-900">Deuda total:</span>{' '}
                    {formatCurrency(debtor.totalDebt)}
                  </p>
                  <p>
                    <span className="font-medium text-slate-900">Deuda vencida:</span>{' '}
                    {formatCurrency(debtor.overdueDebt)}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Recomendación (hardcodeada)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-slate-700">
                  <p>{debtor.recommendation}</p>
                  <p>
                    Contacto disponible:{' '}
                    {debtor.hasContact ? (
                      <span className="font-medium text-emerald-700">Sí</span>
                    ) : (
                      <span className="font-medium text-amber-700">No</span>
                    )}
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="people">
            <Card>
              <CardHeader>
                <CardTitle>Personas asociadas</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Documento</TableHead>
                      <TableHead>Prioridad</TableHead>
                      <TableHead>Contacto</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {people.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-slate-500">
                          Sin personas asociadas visibles.
                        </TableCell>
                      </TableRow>
                    )}
                    {people.map((person) => (
                      <TableRow key={person.id}>
                        <TableCell className="font-medium text-slate-900">
                          {person.name}
                        </TableCell>
                        <TableCell>{person.document}</TableCell>
                        <TableCell>{person.priority}</TableCell>
                        <TableCell>{person.contact}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="debts">
            <Card>
              <CardHeader>
                <CardTitle>Deudas asociadas</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Monto original</TableHead>
                      <TableHead>Monto actualizado</TableHead>
                      <TableHead>Vencimiento</TableHead>
                      <TableHead>Período</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {debts.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-slate-500">
                          Sin deudas visibles.
                        </TableCell>
                      </TableRow>
                    )}
                    {debts.map((debt) => (
                      <TableRow key={debt.id}>
                        <TableCell>{formatCurrency(debt.originalAmount)}</TableCell>
                        <TableCell>{formatCurrency(debt.updatedAmount)}</TableCell>
                        <TableCell>{formatDate(debt.dueDate)}</TableCell>
                        <TableCell>{debt.period}</TableCell>
                        <TableCell>
                          <Badge variant="neutral">{debt.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="risk">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Deuda total</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold text-slate-900">
                  {formatCurrency(profile.totalDebt)}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Deuda vencida</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold text-slate-900">
                  {formatCurrency(profile.overdueDebt)}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Antigüedad</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold text-slate-900">
                  {profile.antiquityDays} días
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Personas asociadas</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold text-slate-900">
                  {profile.associatedPeople}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Contactos disponibles</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold text-slate-900">
                  {profile.availableContacts}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Nivel de riesgo</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold text-slate-900">
                  <RiskBadge risk={profile.risk} />
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  )
}

