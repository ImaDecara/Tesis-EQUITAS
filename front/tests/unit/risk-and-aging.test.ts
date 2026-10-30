import { describe, expect, it } from 'vitest'
import golden from '../../../contracts/decision-rules.v1.golden.json'
import type { Decision } from '@/lib/domain/decision-rules-v1'

import {
  calculateDaysSinceDate,
  resolveDebtStatusFromDueDate,
} from '@/lib/parsers/date-value-parser'
import {
  calculateDebtorRiskAssessment,
  mapRiskLevel,
} from '@/lib/services/debtor-risk-calculator'

describe('bandas heredadas de personas y alias de severidad v1 de objetos', () => {
  it('conserva los límites del índice heredado de personas', () => {
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

  it.each(golden.casos)('$id: el alias del objeto coincide con la severidad, sin perfil ni inferencia', sample => {
    const decision = sample.esperado as Decision
    const assessment = calculateDebtorRiskAssessment(decision)
    expect(assessment.riskScore).toBe(decision.severidad.valor)
    expect(assessment.risk).toBe(({ ALTA: 'ALTO', MEDIA: 'MEDIO', BAJA: 'BAJO', NO_DISPONIBLE: null } as Record<string, string | null>)[decision.severidad.banda])
  })

  it('sin evaluación no inventa un riesgo medio ni cero', () => {
    expect(calculateDebtorRiskAssessment(null)).toEqual({ risk: null, riskScore: null })
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
