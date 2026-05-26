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
}

const BAR_COLORS = ['#0f2f57', '#174774', '#8a6f2a', '#436584', '#8ea6be']
const PIE_COLORS = ['#a13c3c', '#8a6f2a', '#2d6a4f', '#3e5f8a', '#69829f']

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

export function BarDistributionChart({ title, data }: ChartProps) {
  const isReady = useChartReady()
  const rows = data.length > 0 ? data : [{ label: 'Sin datos', value: 0 }]

  if (!isReady) {
    return <ChartSkeleton title={title} />
  }

  return (
    <Card className="border-slate-200/90 bg-white">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: '#334155' }}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: '#334155' }}
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

export function RiskDonutChart({ title, data }: ChartProps) {
  const isReady = useChartReady()
  const rows = data.length > 0 ? data : [{ label: 'Sin datos', value: 1 }]

  if (!isReady) {
    return <ChartSkeleton title={title} />
  }

  return (
    <Card className="border-slate-200/90 bg-white">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="h-72">
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
      </CardContent>
    </Card>
  )
}

export function TopDebtHorizontalChart({ title, data }: ChartProps) {
  const isReady = useChartReady()
  const rows = data.length > 0 ? data : [{ label: 'Sin datos', value: 0 }]

  if (!isReady) {
    return <ChartSkeleton title={title} />
  }

  return (
    <Card className="border-slate-200/90 bg-white">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="h-72">
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
