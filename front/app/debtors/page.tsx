import Link from 'next/link'
import { Eye, Filter } from 'lucide-react'

import { DataWarnings } from '@/components/equitas/data-warnings'
import { ContactAvailabilityBadge } from '@/components/debtors/contact-availability-badge'
import { RiskBadge } from '@/components/equitas/risk-badge'
import { AppShell } from '@/components/layout/app-shell'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getDebtorsData } from '@/lib/equitas-data'
import { formatCurrency } from '@/lib/utils'

// Pantalla de listado de objetos de deuda: vista operativa centrada en tabla.
export default async function DebtorsPage() {
  const { debtors, warnings } = await getDebtorsData()

  return (
    <AppShell>
      <section className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Listado de objetos de deuda
          </h1>
          <p className="text-sm text-slate-600">
            Vista operativa para priorizar gestión de recupero.
          </p>
        </div>

        <Badge variant="neutral" className="w-fit">
          <Filter className="mr-1 size-3.5" />
          {debtors.length.toLocaleString('es-AR')} registros
        </Badge>
      </section>

      <div className="space-y-6">
        <DataWarnings warnings={warnings} />

        <Card>
          <CardHeader>
            <CardTitle>Objetos de deuda</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Identificador</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="text-right">Deuda total</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Personas asociadas</TableHead>
                  <TableHead>Contacto</TableHead>
                  <TableHead>Riesgo</TableHead>
                  <TableHead>Recomendación</TableHead>
                  <TableHead className="text-right">Detalle</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {debtors.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-slate-500">
                      No hay debtors visibles con el rol actual.
                    </TableCell>
                  </TableRow>
                )}

                {debtors.map((debtor) => (
                  <TableRow key={debtor.id}>
                    <TableCell className="font-medium text-slate-900">
                      {debtor.identifier}
                    </TableCell>
                    <TableCell>{debtor.type}</TableCell>
                    <TableCell className="max-w-[260px] truncate">
                      {debtor.description}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(debtor.totalDebt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="neutral">{debtor.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {debtor.peopleCount}
                      {debtor.peopleNames.length > 0 && (
                        <p className="max-w-[200px] truncate text-xs text-slate-500">
                          {debtor.peopleNames.join(', ')}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <ContactAvailabilityBadge hasContact={debtor.hasContact} />
                    </TableCell>
                    <TableCell>
                      <RiskBadge risk={debtor.risk} />
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate text-xs text-slate-600">
                      {debtor.recommendation}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/debtors/${encodeURIComponent(debtor.id)}`}
                        className={buttonVariants({ variant: 'default', size: 'sm' })}
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
