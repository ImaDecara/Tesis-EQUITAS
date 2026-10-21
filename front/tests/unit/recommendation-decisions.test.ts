import { describe, expect, it } from 'vitest'
import { generateDebtorRecommendation } from '@/lib/services/debtor-recommendation-generator'

describe('R-FUN-01 / E04: tabla de decision de recomendaciones', () => {
  it.each([
    ['alto con contacto prevalece sobre mora', 'ALTO', true, 1, 400000, 90, 'Llamado prioritario', true],
    ['alto sin contacto requiere revision', 'ALTO', false, 0, 0, 0, 'Plan de pago / revision humana', true],
    ['mora de 60 dias', 'MEDIO', true, 1, 1, 60, 'Plan de pago / revision humana', true],
    ['mora de 59 dias', 'MEDIO', true, 1, 1, 59, 'Mensaje recordatorio', false],
    ['sin mora, saldo justo en limite', 'BAJO', true, 0, 350000, 60, 'Mensaje recordatorio', false],
    ['sin mora, saldo debajo del limite', 'BAJO', false, 0, 349999, 90, 'Seguimiento posterior', false],
    ['sin deuda', 'BAJO', true, 0, 0, 0, 'Seguimiento posterior', false],
  ] as const)('REC-01: %s', (_case, risk, hasContact, overdueDebt, totalDebt, overdueDays, type, isUrgent) => {
    const result = generateDebtorRecommendation({ risk, hasContact, overdueDebt, totalDebt, overdueDays })
    expect(result).toMatchObject({ type, summary: type, isUrgent })
    expect(result.reason.length).toBeGreaterThan(0)
  })
})
