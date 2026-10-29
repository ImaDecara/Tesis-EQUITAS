import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RiskBadge } from '@/components/equitas/risk-badge'
import { PersonRiskBadge } from '@/components/people/person-risk-badge'
import { ContactAvailabilityBadge } from '@/components/debtors/contact-availability-badge'
import { BarDistributionChart, RiskDonutChart, TopDebtHorizontalChart } from '@/components/charts/debtor-dashboard-charts'

describe('representación de datos no disponibles', () => {
  it('muestra riesgo desconocido sin asignar banda baja', () => {
    for (const Component of [RiskBadge, PersonRiskBadge]) {
      const unknown = renderToStaticMarkup(createElement(Component, { risk: null, score: null }))
      expect(unknown).toContain('No disponible')
      expect(unknown).not.toContain('Bajo')
      expect(renderToStaticMarkup(createElement(Component, { risk: 'BAJO', score: 0 }))).toContain('Bajo (0)')
      expect(renderToStaticMarkup(createElement(Component, { risk: 'ALTO', score: 95 }))).toContain('Alto (95)')
      expect(renderToStaticMarkup(createElement(Component, { risk: 'MEDIO', score: null }))).toContain('Medio')
    }
  })
  it('distingue lectura de contacto fallida de contacto ausente y presente', () => {
    expect(renderToStaticMarkup(createElement(ContactAvailabilityBadge, { hasContact: null }))).toContain('No disponible')
    expect(renderToStaticMarkup(createElement(ContactAvailabilityBadge, { hasContact: false }))).toContain('Faltante')
    expect(renderToStaticMarkup(createElement(ContactAvailabilityBadge, { hasContact: true }))).toContain('Disponible')
  })
  it('no fabrica una barra cero ni un anillo 100 % para una serie vacía', () => {
    for (const Component of [BarDistributionChart, RiskDonutChart, TopDebtHorizontalChart]) {
      const html = renderToStaticMarkup(createElement(Component, { title: 'Serie sintética', data: [] }))
      expect(html).toContain('Sin datos disponibles')
      expect(html).not.toContain('100')
      expect(html).not.toContain('recharts')
      const populated = renderToStaticMarkup(createElement(Component, { title: 'Serie sintética', data: [{ label: 'Observado', value: 10 }] }))
      expect(populated).toContain('Serie sintética')
      expect(populated).not.toContain('Sin datos disponibles')
    }
    expect(renderToStaticMarkup(createElement(RiskDonutChart, { title: 'Vacío', data: [{ label: 'Bajo', value: 0 }] }))).toContain('Sin datos disponibles')
  })
})
