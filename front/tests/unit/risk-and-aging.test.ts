import { describe, expect, it } from 'vitest'

import {
  calculateDaysSinceDate,
  resolveDebtStatusFromDueDate,
} from '@/lib/parsers/date-value-parser'
import {
  calculateDebtorRiskAssessment,
  mapRiskLevel,
} from '@/lib/services/debtor-risk-calculator'

describe('clasificacion de riesgo', () => {
  it('clasifica los limites de la escala oficial de riesgo', () => {
    const results = [
      mapRiskLevel(0),
      mapRiskLevel(39),
      mapRiskLevel(40),
      mapRiskLevel(69),
      mapRiskLevel(70),
      mapRiskLevel(100),
    ]

    expect(results).toEqual(['BAJO', 'BAJO', 'MEDIO', 'MEDIO', 'ALTO', 'ALTO'])
  })

  it('limita valores no validos y fuera de escala', () => {
    const results = [mapRiskLevel(Number.NaN), mapRiskLevel(-15), mapRiskLevel(250)]

    expect(results).toEqual(['BAJO', 'BAJO', 'ALTO'])
  })

  it('prioriza un puntaje informado por el perfil', () => {
    const assessment = calculateDebtorRiskAssessment({
      providedRisk: '71',
      totalDebt: 10,
      overdueDebt: 0,
      hasContact: true,
    })

    expect(assessment).toEqual({ risk: 'ALTO', riskScore: 71 })
  })

  it('estima riesgo medio cuando no hay perfil y faltan contactos', () => {
    const assessment = calculateDebtorRiskAssessment({
      providedRisk: null,
      totalDebt: 50,
      overdueDebt: 0,
      hasContact: false,
      maxDaysOverdue: 0,
    })

    expect(assessment).toEqual({ risk: 'MEDIO', riskScore: 55 })
  })
})

describe('calculo de mora', () => {
  it('identifica vencimientos pasados y futuros', () => {
    const overdueStatus = resolveDebtStatusFromDueDate('2000-01-01')
    const currentStatus = resolveDebtStatusFromDueDate('2999-01-01')

    expect(overdueStatus).toBe('Vencida')
    expect(currentStatus).toBe('Vigente')
  })

  it('maneja fechas invalidas y evita antiguedad negativa', () => {
    const invalidStatus = resolveDebtStatusFromDueDate('fecha-invalida')
    const futureDays = calculateDaysSinceDate('2999-01-01')
    const invalidDays = calculateDaysSinceDate(null)

    expect(invalidStatus).toBe('Sin estado')
    expect(futureDays).toBe(0)
    expect(invalidDays).toBe(0)
  })
})
