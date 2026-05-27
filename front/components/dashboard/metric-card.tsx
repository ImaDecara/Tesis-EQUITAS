import type { ComponentType } from 'react'

import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type MetricCardProps = {
  label: string
  value: string
  hint: string
  icon: ComponentType<{ className?: string }>
  tone?: 'primary' | 'accent' | 'warning' | 'danger' | 'success' | 'critical'
}

const toneMap: Record<
  NonNullable<MetricCardProps['tone']>,
  { gradient: string; border: string; icon: string; label: string }
> = {
  primary: {
    gradient: 'from-[#e7edf7] to-white',
    border: 'border-[#cfdaea]',
    icon: 'text-[#163a63]',
    label: 'text-[#1e436f]',
  },
  accent: {
    gradient: 'from-[#edf2f9] to-white',
    border: 'border-[#cfdaea]',
    icon: 'text-[#163a63]',
    label: 'text-[#1e436f]',
  },
  warning: {
    gradient: 'from-[#f6efdc] to-white',
    border: 'border-[#ead8b0]',
    icon: 'text-[#8a6f2a]',
    label: 'text-[#7e6322]',
  },
  danger: {
    gradient: 'from-[#f9ecec] to-white',
    border: 'border-[#efd2d2]',
    icon: 'text-[#a64848]',
    label: 'text-[#8f3939]',
  },
  critical: {
    gradient: 'from-[#f3e2e2] to-white',
    border: 'border-[#e7c0c0]',
    icon: 'text-[#973b3b]',
    label: 'text-[#8a2f2f]',
  },
  success: {
    gradient: 'from-[#e7f1eb] to-white',
    border: 'border-[#cfe1d8]',
    icon: 'text-[#2d6a4f]',
    label: 'text-[#255a43]',
  },
}

// Envoltorio visual para tarjetas KPI usadas en el encabezado del tablero.
export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'primary',
}: MetricCardProps) {
  const toneStyles = toneMap[tone]

  return (
    <Card
      className={cn(
        'overflow-hidden bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md',
        toneStyles.border
      )}
    >
      <CardHeader className="relative pb-3">
        <div
          className={cn(
            'pointer-events-none absolute inset-0 bg-gradient-to-br opacity-85',
            toneStyles.gradient
          )}
        />
        <div className="relative flex items-start justify-between">
          <p className={cn('text-xs font-semibold tracking-wide uppercase', toneStyles.label)}>
            {label}
          </p>
          <span className="rounded-lg bg-white p-2 shadow-sm ring-1 ring-slate-200/80">
            <Icon className={cn('size-5', toneStyles.icon)} />
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
