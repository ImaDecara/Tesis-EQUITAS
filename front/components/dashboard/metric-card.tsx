import type { ComponentType } from 'react'

import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type MetricCardProps = {
  label: string
  value: string
  hint: string
  icon: ComponentType<{ className?: string }>
  tone?: 'emerald' | 'sky' | 'amber' | 'rose' | 'indigo'
}

const toneMap: Record<NonNullable<MetricCardProps['tone']>, string> = {
  emerald: 'from-emerald-100 to-white text-emerald-700',
  sky: 'from-sky-100 to-white text-sky-700',
  amber: 'from-amber-100 to-white text-amber-700',
  rose: 'from-rose-100 to-white text-rose-700',
  indigo: 'from-indigo-100 to-white text-indigo-700',
}

export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'emerald',
}: MetricCardProps) {
  return (
    <Card className="overflow-hidden border-slate-200/80">
      <CardHeader className="relative pb-3">
        <div
          className={cn(
            'pointer-events-none absolute inset-0 bg-gradient-to-br opacity-75',
            toneMap[tone]
          )}
        />
        <div className="relative flex items-start justify-between">
          <p className="text-xs font-semibold tracking-wide text-slate-600 uppercase">
            {label}
          </p>
          <span className="rounded-lg bg-white/80 p-2 shadow-sm ring-1 ring-slate-200">
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

