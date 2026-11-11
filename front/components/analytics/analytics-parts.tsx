import type { ReactNode } from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableScrollHint } from '@/components/ui/table'
import { formatNumber } from '@/lib/data-presence'
import { cn, formatCurrency } from '@/lib/utils'

// Piezas compartidas de la pantalla de analítica. Solo presentan lo que trae el contrato
// (`lib/ml/contract.ts`): no calculan nada y nunca reciben datos de un caso.

/** Decimales con coma; sin dato, «No disponible». */
export function decimal(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'No disponible'
  return value.toLocaleString('es-AR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** Proporción de 0 a 1 como porcentaje entero. */
export function share(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? 'No disponible' : `${Math.round(value * 100)}%`
}

/** Un valor en la unidad original de la variable. */
export function inUnit(value: number, unit: 'ARS' | 'DAYS' | 'COUNT'): string {
  if (unit === 'ARS') return formatCurrency(value)
  const rounded = Math.round(value * 10) / 10
  return unit === 'DAYS' ? `${formatNumber(rounded)} días` : formatNumber(rounded)
}

export function Section({ title, children, id, className }: { title: string; children: ReactNode; id?: string; className?: string }) {
  return (
    <Card className={cn('border-[#d2dceb]', className)} data-analytics-section={id}>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm text-slate-700">{children}</CardContent>
    </Card>
  )
}

/** Tabla simple: encabezados y filas ya formateadas. `numeric` alinea a la derecha esas columnas. */
export function SimpleTable({ headers, rows, numeric = [], caption }: {
  headers: readonly string[]; rows: readonly (readonly ReactNode[])[]; numeric?: readonly number[]; caption?: string
}) {
  // Hasta tres columnas entran a 390 px; las más anchas se desplazan dentro de su marco y lo avisan.
  const wide = headers.length >= 4
  return (
    <div className="overflow-x-auto">
      {wide && <TableScrollHint />}
      <Table className={wide ? 'min-w-[32rem]' : undefined}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <TableHeader>
          <TableRow>{headers.map((header, index) => <TableHead key={header} className={numeric.includes(index) ? 'text-right' : undefined}>{header}</TableHead>)}</TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, rowIndex) => (
            <TableRow key={rowIndex}>
              {row.map((cell, index) => <TableCell key={index} className={cn('align-top', numeric.includes(index) && 'text-right')}>{cell}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function Facts({ items }: { items: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-slate-600">{label}</dt>
          <dd className="font-medium break-words text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Limitations({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <h3 className="font-semibold text-slate-900">Limitaciones</h3>
      <ul className="mt-1 list-disc space-y-1 pl-5">{items.map(item => <li key={item}>{item}</li>)}</ul>
    </div>
  )
}

export function Notice({ tone, children, state }: { tone: 'info' | 'warning' | 'error'; children: ReactNode; state?: string }) {
  const tones = { info: 'border-[#cfdaea] bg-[#edf2f9]', warning: 'border-[#e7d2ae] bg-[#fbf7ec]', error: 'border-[#e5c0c0] bg-[#fbefef]' }
  return <div role="status" data-analytics-notice={state} className={cn('rounded-md border p-3 text-sm text-slate-800', tones[tone])}>{children}</div>
}

export function SectionLoading({ text }: { text: string }) {
  return (
    <div role="status" aria-live="polite" data-analytics-loading className="rounded-lg border border-dashed border-[#cfdaea] bg-white/70 p-4 text-sm text-slate-600">
      {text}
    </div>
  )
}
