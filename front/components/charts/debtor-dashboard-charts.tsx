'use client'

import { useSyncExternalStore } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { type ChartBucket } from '@/types/equitas-domain'

type ChartProps = {
  title: string
  data: ChartBucket[]
  legendLayout?: 'side' | 'bottom'
  size?: 'default' | 'compact'
}

const BAR_COLORS = ['#0f2f57', '#174774', '#8a6f2a', '#436584', '#8ea6be']
const PIE_COLORS = ['#a13c3c', '#8a6f2a', '#2d6a4f', '#3e5f8a', '#69829f']
const compactNumberFormatter = new Intl.NumberFormat('es-AR', {
  notation: 'compact',
  compactDisplay: 'short',
  maximumFractionDigits: 1,
})

function formatAxisNumber(value: number) {
  return Math.abs(value) >= 10000
    ? compactNumberFormatter.format(value)
    : value.toLocaleString('es-AR')
}

function useChartReady() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
}

function ChartSkeleton({ title }: { title: string }) {
  return (
    <Card className="border-slate-200/90 bg-white">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="h-72">
        <div className="h-full animate-pulse rounded-lg bg-slate-100" />
      </CardContent>
    </Card>
  )
}

export function BarDistributionChart({
  title,
  data,
  size = 'default',
}: ChartProps) {
  const isReady = useChartReady()
  const rows = data.length > 0 ? data : [{ label: 'Sin datos', value: 0 }]
  const contentHeightClass = size === 'compact' ? 'h-56' : 'h-72'
  const maxValue = Math.max(...rows.map((row) => row.value), 0)
  const yAxisWidth = maxValue >= 10000 ? 58 : 34

  if (!isReady) {
    return <ChartSkeleton title={title} />
  }

  return (
    <Card className="border-slate-200/90 bg-white">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className={contentHeightClass}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: '#334155' }}
            />
            <YAxis
              allowDecimals={false}
              width={yAxisWidth}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: '#334155' }}
              tickFormatter={(value) => formatAxisNumber(Number(value))}
            />
            <Tooltip
              cursor={{ fill: '#e2e8f0' }}
              contentStyle={{ borderRadius: 10, borderColor: '#cbd5e1' }}
            />
            <Bar dataKey="value" radius={[8, 8, 0, 0]}>
              {rows.map((row, index) => (
                <Cell key={`${row.label}-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

export function RiskDonutChart({
  title,
  data,
  legendLayout = 'side',
  size = 'default',
}: ChartProps) {
  const isReady = useChartReady()
  const rows = data.length > 0 ? data : [{ label: 'Sin datos', value: 1 }]
  const total = rows.reduce((acc, row) => acc + row.value, 0)
  const isBottomLegend = legendLayout === 'bottom'
  const isCompact = size === 'compact'

  if (!isReady) {
    return <ChartSkeleton title={title} />
  }

  return (
    <Card className="border-slate-200/90 bg-white">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent
        className={
          isBottomLegend
            ? 'space-y-4'
            : `grid items-center gap-4 ${isCompact ? 'lg:grid-cols-[minmax(0,1fr)_180px]' : 'lg:grid-cols-[minmax(0,1.2fr)_220px]'}`
        }
      >
        <div className={isBottomLegend ? 'h-52' : isCompact ? 'h-56' : 'h-72'}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={rows}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={95}
                paddingAngle={4}
              >
                {rows.map((row, index) => (
                  <Cell key={`${row.label}-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: 10, borderColor: '#cbd5e1' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className={isBottomLegend ? 'grid grid-cols-1 gap-2' : isCompact ? 'space-y-2' : 'space-y-3'}>
          {rows.map((row, index) => {
            const color = PIE_COLORS[index % PIE_COLORS.length]
            const percentage = total > 0 ? (row.value / total) * 100 : 0

            return (
              <div
                key={`${row.label}-${index}-legend`}
                className={
                  isBottomLegend
                    ? 'flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2'
                    : isCompact
                      ? 'rounded-lg border border-slate-200 bg-slate-50 px-3 py-2'
                      : 'rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5'
                }
              >
                <div className="flex items-center gap-2">
                  <span
                    className="size-3 rounded-full"
                    style={{ backgroundColor: color }}
                    aria-hidden
                  />
                  <p className="text-sm font-semibold text-slate-800">{row.label}</p>
                </div>
                <div
                  className={
                    isBottomLegend
                      ? 'flex items-baseline gap-3'
                      : 'mt-2 flex items-baseline justify-between gap-3'
                  }
                >
                  <p className="text-lg font-semibold text-slate-900">
                    {row.value.toLocaleString('es-AR')}
                  </p>
                  <p className="text-xs font-medium text-slate-500">
                    {percentage.toFixed(1)}%
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

export function TopDebtHorizontalChart({
  title,
  data,
  size = 'default',
}: ChartProps) {
  const isReady = useChartReady()
  const rows = data.length > 0 ? data : [{ label: 'Sin datos', value: 0 }]
  const contentHeightClass = size === 'compact' ? 'h-56' : 'h-72'

  if (!isReady) {
    return <ChartSkeleton title={title} />
  }

  return (
    <Card className="border-slate-200/90 bg-white">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className={contentHeightClass}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ top: 8, right: 20, left: 12, bottom: 8 }}
          >
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: '#334155' }}
              tickFormatter={(value) =>
                new Intl.NumberFormat('es-AR', {
                  notation: 'compact',
                  compactDisplay: 'short',
                }).format(Number(value))
              }
            />
            <YAxis
              type="category"
              dataKey="label"
              width={120}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: '#334155' }}
            />
            <Tooltip
              formatter={(value) => formatCurrency(Number(value))}
              contentStyle={{ borderRadius: 10, borderColor: '#cbd5e1' }}
            />
            <Bar dataKey="value" radius={[0, 8, 8, 0]} fill="#0f2f57" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
