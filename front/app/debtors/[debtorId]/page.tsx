import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { notFound } from 'next/navigation'

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

const RECOMMENDATION_BADGE: Record<string, 'danger' | 'warning' | 'info' | 'success'> = {
  'Llamado prioritario': 'danger',
  'Mensaje recordatorio': 'warning',
  'Plan de pago / revision humana': 'info',
  'Seguimiento posterior': 'success',
}

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

  const { debtor, debts, people, contacts, profile } = detail

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
            <h1 className="text-2xl font-semibold tracking-tight text-[#163a63]">
              {debtor.identifier}
            </h1>
            <p className="text-sm text-slate-600">{debtor.description}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">{debtor.type}</Badge>
            <Badge variant="info">{debtor.status}</Badge>
            <RiskBadge risk={debtor.risk} score={debtor.riskScore} />
          </div>
        </div>
      </section>

      <div className="space-y-5">
        <DataWarnings warnings={warnings} />

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
          <Card className="border-[#efd2d2] bg-[#fbefef] shadow-sm">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs uppercase tracking-wide text-slate-600">Riesgo</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <RiskBadge risk={debtor.risk} score={debtor.riskScore} />
            </CardContent>
          </Card>
          <Card className="border-[#cfdaea] bg-[#edf2f9] shadow-sm">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs uppercase tracking-wide text-slate-600">Deuda total</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-lg font-semibold text-[#163a63]">
              {formatCurrency(debtor.totalDebt)}
            </CardContent>
          </Card>
          <Card className="border-[#d9dfe7] bg-[#f7f9fc] shadow-sm">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs uppercase tracking-wide text-slate-600">Estado</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Badge variant="neutral">{debtor.status}</Badge>
            </CardContent>
          </Card>
          <Card className="border-[#ead8b0] bg-[#f9f3e4] shadow-sm">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs uppercase tracking-wide text-slate-600">Contacto</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Badge variant={debtor.hasContact ? 'success' : 'warning'}>
                {debtor.hasContact ? 'Disponible' : 'Faltante'}
              </Badge>
            </CardContent>
          </Card>
          <Card className="border-[#d2dceb] bg-white shadow-sm xl:col-span-2">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs uppercase tracking-wide text-slate-600">
                Recomendacion
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 pt-0">
              <Badge variant={RECOMMENDATION_BADGE[debtor.recommendationType] ?? 'neutral'}>
                {debtor.recommendationType}
              </Badge>
              <p className="text-xs text-slate-600">
                {debtor.peopleCount} persona(s) asociada(s)
              </p>
            </CardContent>
          </Card>
        </section>

        <Tabs defaultValue="summary">
          <TabsList>
            <TabsTrigger value="summary">Resumen</TabsTrigger>
            <TabsTrigger value="people">Personas asociadas</TabsTrigger>
            <TabsTrigger value="contacts">Contactos</TabsTrigger>
            <TabsTrigger value="debts">Deudas</TabsTrigger>
            <TabsTrigger value="risk">Perfil/Riesgo</TabsTrigger>
            <TabsTrigger value="recommendation">Recomendacion</TabsTrigger>
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
                    <span className="font-medium text-slate-900">Tipo de objeto:</span>{' '}
                    {debtor.type}
                  </p>
                  <p>
                    <span className="font-medium text-slate-900">Descripcion:</span>{' '}
                    {debtor.description}
                  </p>
                  <p>
                    <span className="font-medium text-slate-900">Deuda total:</span>{' '}
                    {formatCurrency(debtor.totalDebt)}
                  </p>
                  <p>
                    <span className="font-medium text-slate-900">Deuda vencida:</span>{' '}
                    {formatCurrency(debtor.overdueDebt)}
                  </p>
                  <p>
                    <span className="font-medium text-slate-900">Dias de atraso:</span>{' '}
                    {debtor.maxDaysOverdue} dias
                  </p>
                  <p>
                    <span className="font-medium text-slate-900">Estado:</span> {debtor.status}
                  </p>
                  <p>
                    <span className="font-medium text-slate-900">Prioridad:</span>{' '}
                    {debtor.priorityLevel} (score {debtor.priorityScore})
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Recomendacion actual</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-slate-700">
                  <Badge variant={RECOMMENDATION_BADGE[debtor.recommendationType] ?? 'neutral'}>
                    {debtor.recommendationType}
                  </Badge>
                  <p className="font-medium text-slate-900">{debtor.recommendation}</p>
                  <p>{debtor.recommendationReason}</p>
                  <p>
                    Contacto disponible:{' '}
                    {debtor.hasContact ? (
                      <span className="font-medium text-emerald-700">Si</span>
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
                      <TableHead>Prioridad de contacto</TableHead>
                      <TableHead>Relacion</TableHead>
                      <TableHead>Contacto</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {people.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-slate-500">
                          Sin personas asociadas visibles.
                        </TableCell>
                      </TableRow>
                    )}
                    {people.map((person) => (
                      <TableRow key={person.id}>
                        <TableCell className="font-medium text-slate-900">{person.name}</TableCell>
                        <TableCell>{person.document}</TableCell>
                        <TableCell>{person.priority}</TableCell>
                        <TableCell>{person.relation}</TableCell>
                        <TableCell>{person.contact}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="contacts">
            <Card>
              <CardHeader>
                <CardTitle>Contactos de personas asociadas</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Persona</TableHead>
                      <TableHead>Canal</TableHead>
                      <TableHead>Valor</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contacts.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-slate-500">
                          Sin contactos registrados para este objeto.
                        </TableCell>
                      </TableRow>
                    )}
                    {contacts.map((contact) => (
                      <TableRow key={`${contact.personId}-${contact.id}-${contact.value}`}>
                        <TableCell className="font-medium text-slate-900">
                          {contact.personName || `Persona ${contact.personId}`}
                        </TableCell>
                        <TableCell>{contact.channel}</TableCell>
                        <TableCell>{contact.value}</TableCell>
                        <TableCell>
                          <Badge variant={contact.isActive ? 'success' : 'warning'}>
                            {contact.isActive ? 'Activo' : 'Inactivo'}
                          </Badge>
                        </TableCell>
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
                      <TableHead>Periodo</TableHead>
                      <TableHead>Vencimiento</TableHead>
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
                        <TableCell>{debt.period}</TableCell>
                        <TableCell>{formatDate(debt.dueDate)}</TableCell>
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
                  <CardTitle className="text-sm">Cantidad de deudas</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold text-slate-900">
                  {profile.debtCount}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Antiguedad</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold text-slate-900">
                  {profile.antiquityDays} dias
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
                  <CardTitle className="text-sm">Nivel socioeconomico / riesgo</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-slate-900">
                  <RiskBadge risk={profile.risk} score={profile.riskScore} />
                  <p className="text-sm text-slate-600">{profile.socioeconomicLevel}</p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="recommendation">
            <Card>
              <CardHeader>
                <CardTitle>Recomendacion sugerida</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-700">
                <Badge variant={RECOMMENDATION_BADGE[debtor.recommendationType] ?? 'neutral'}>
                  {debtor.recommendationType}
                </Badge>
                <p className="text-base font-semibold text-slate-900">{debtor.recommendation}</p>
                <p>{debtor.recommendationReason}</p>
                <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  Ejemplo de lectura operativa: {debtor.recommendation} porque el caso combina{' '}
                  {formatCurrency(debtor.totalDebt)} de deuda total, {debtor.maxDaysOverdue} dias
                  de atraso y contacto {debtor.hasContact ? 'disponible' : 'faltante'}.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  )
}
