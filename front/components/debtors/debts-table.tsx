import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { DebtorDebtItem } from '@/types/equitas-domain'

// Una lectura fallida no se presenta como "sin deudas".
export function DebtsTable({ debts, readFailed }: { debts: DebtorDebtItem[]; readFailed: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Monto original</TableHead>
          <TableHead>Monto actualizado</TableHead>
          <TableHead>ID externo de la obligación</TableHead>
          <TableHead>Vencimiento</TableHead>
          <TableHead>Estado</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {debts.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-slate-500">
              {readFailed ? 'No disponible: no se pudo leer la lista de obligaciones.' : 'Sin deudas visibles.'}
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
  )
}
