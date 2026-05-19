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
import { type ChartBucket } from '@/types/equitas-domain'

type ChartProps = {
  title: string
  data: ChartBucket[]
}

const BAR_COLORS = ['#0f766e', '#0284c7', '#4f46e5', '#d97706', '#db2777']
const PIE_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6']

function useChartReady() {
  // Evita desajustes servidor/cliente en el calculo de tamano del grafico adaptable.
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
}

export function BarDistributionChart({ title, data }: ChartProps) {
  const isReady = useChartReady()
  const rows = data.length > 0 ? data : [{ label: 'Sin datos', value: 0 }]

  // El esqueleto mantiene estable el diseno mientras monta el grafico en cliente.
  if (!isReady) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          <div className="h-full animate-pulse rounded-lg bg-slate-100" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12 }}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12 }}
            />
            <Tooltip
              cursor={{ fill: '#e2e8f0' }}
              contentStyle={{ borderRadius: 10, borderColor: '#cbd5e1' }}
            />
            <Bar dataKey="value" radius={[8, 8, 0, 0]}>
              {rows.map((row, index) => (
                <Cell key={row.label} fill={BAR_COLORS[index % BAR_COLORS.length]} />
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

  // El esqueleto mantiene estable el diseno mientras monta el grafico en cliente.
  if (!isReady) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          <div className="h-full animate-pulse rounded-lg bg-slate-100" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
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
                <Cell key={row.label} fill={PIE_COLORS[index % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ borderRadius: 10, borderColor: '#cbd5e1' }} />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
