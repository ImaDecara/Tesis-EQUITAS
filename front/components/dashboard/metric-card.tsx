import type { ComponentType } from 'react'

import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type MetricCardProps = {
  label: string
  value: string
  hint: string
  icon: ComponentType<{ className?: string }>
  tone?: 'primary' | 'accent' | 'warning' | 'danger' | 'success'
}

const toneMap: Record<NonNullable<MetricCardProps['tone']>, string> = {
  primary: 'from-[#e6edf6] to-white text-[#163a63]',
  accent: 'from-[#f4ecd6] to-white text-[#8a6f2a]',
  warning: 'from-[#f6efdc] to-white text-[#8a6f2a]',
  danger: 'from-[#f8e7e7] to-white text-[#9d3d3d]',
  success: 'from-[#e8f3ed] to-white text-[#2d6a4f]',
}

// Envoltorio visual para tarjetas KPI usadas en el encabezado del tablero.
export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'primary',
}: MetricCardProps) {
  return (
    <Card className="overflow-hidden border-slate-200/90 bg-white shadow-sm">
      <CardHeader className="relative pb-3">
        <div
          className={cn(
            'pointer-events-none absolute inset-0 bg-gradient-to-br opacity-85',
            toneMap[tone]
          )}
        />
        <div className="relative flex items-start justify-between">
          <p className="text-xs font-semibold tracking-wide text-slate-700 uppercase">
            {label}
          </p>
          <span className="rounded-lg bg-white p-2 shadow-sm ring-1 ring-slate-200">
            <Icon className="size-4" />
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-1 pt-0">
        <p className="text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
        <p className="text-xs text-slate-500">{hint}</p>
      </CardContent>
    </Card>
  )
}
