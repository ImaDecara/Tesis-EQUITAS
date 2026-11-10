import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { isPaidObligation } from '@/lib/domain/decision-rules-v1'
import { objectTotals } from '@/lib/domain/portfolio-totals'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { DebtorDebtItem } from '@/types/equitas-domain'

type Overdue = { label: string; variant: 'danger' | 'success' | 'neutral' }

// Si la obligación cuenta como vencida, con la misma definición que los totales del caso
// (`objectTotals`, plan de entrega §9.3): la tabla no tiene una regla propia.
export function overdueStatus(debt: DebtorDebtItem, asOf: string | null, statusesFailed: boolean): Overdue {
  const obligation = debt.ruleInput
  if (!obligation || statusesFailed) return { label: 'No disponible', variant: 'neutral' }
  if (isPaidObligation(obligation)) return { label: 'No: está pagada', variant: 'success' }
  if (asOf === null) return { label: 'No disponible', variant: 'neutral' }
  const count = objectTotals([obligation], { asOf }).overdueCount
  if (Object.keys(count.missing).length > 0 || count.value === null) return { label: 'No se sabe: falta el importe o el vencimiento', variant: 'neutral' }
  return count.value > 0 ? { label: 'Sí', variant: 'danger' } : { label: 'No', variant: 'success' }
}

// Una lectura fallida no se presenta como "sin obligaciones".
export function DebtsTable({ debts, readFailed, asOf, statusesFailed = false }: {
  debts: DebtorDebtItem[]
  readFailed: boolean
  asOf: string | null
  statusesFailed?: boolean
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Estado</TableHead>
          <TableHead>Importe actualizado</TableHead>
          <TableHead>Importe original</TableHead>
          <TableHead>Vencimiento</TableHead>
          <TableHead>¿Cuenta como vencida?</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {debts.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-slate-500">
              {readFailed ? 'No disponible: no se pudo leer la lista de obligaciones.' : 'Este caso no tiene obligaciones cargadas.'}
            </TableCell>
          </TableRow>
        )}
        {debts.map((debt) => {
          const overdue = overdueStatus(debt, asOf, statusesFailed)
          return (
            <TableRow key={debt.id}>
              <TableCell>
                <Badge variant="neutral">{debt.status === 'UNKNOWN' ? 'Sin estado informado' : debt.status}</Badge>
              </TableCell>
              <TableCell>{formatCurrency(debt.updatedAmount)}</TableCell>
              <TableCell>{formatCurrency(debt.originalAmount)}</TableCell>
              <TableCell>{formatDate(debt.dueDate)}</TableCell>
              <TableCell>
                <Badge variant={overdue.variant}>{overdue.label}</Badge>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
