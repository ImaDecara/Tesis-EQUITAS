import { describe, expect, it } from 'vitest'
import { aggregateData, compareNullable, currentAmount, daysSinceData, formatCountOfTotal, formatNumber, formatPercentage,
  formatWithUnit, missingSummary, numericData, observed, percentageData, unavailable } from '@/lib/data-presence'
import { formatCurrency } from '@/lib/utils'

describe('reglas de presencia y agregación del contrato §4.1', () => {
  it.each([0, '0', '0,00', '-0', '+0.0'])('conserva el cero %s', value => {
    expect(numericData(value)).toMatchObject({ value: 0, presence: 'OBSERVADO' })
  })
  it.each(['abc', '12abc', '1.2.3', NaN, Infinity, {}, true, '0x10'])('rechaza un número inválido %s', value => {
    expect(numericData(value)).toMatchObject({ value: null, presence: 'INVALIDO' })
  })
  it.each([undefined, null, '', '  '])('distingue el faltante %s', value => {
    expect(numericData(value)).toMatchObject({ value: null, presence: 'NO_INFORMADO_EN_ORIGEN' })
  })
  it('no retrocede desde un importe actual nulo a otro alias presente', () => {
    expect(currentAmount({ current_amount: null, updated_amount: 25, original_amount: 40 }).value).toBeNull()
    expect(numericData('-12,50').value).toBe(-12.5)
    expect(currentAmount({ currentAmount: 0, updated_amount: 25 }).value).toBe(0)
    expect(numericData('abc').reason).toBe('NUMERO_INVALIDO')
  })
  it('distingue vacío, faltantes, mezcla, parcial y lectura fallida', () => {
    expect(aggregateData([])).toEqual(observed(0))
    expect(aggregateData([], 'mean')).toMatchObject({ value: null, presence: 'NO_APLICA' })
    expect(aggregateData([unavailable('INVALIDO')])).toMatchObject({ value: null, presence: 'INVALIDO' })
    expect(aggregateData([unavailable('INVALIDO'), unavailable()])).toMatchObject({ value: null, presence: 'NO_INTEGRADO', missing: { INVALIDO: 1, NO_INTEGRADO: 1 } })
    expect(aggregateData([observed(0), unavailable('INVALIDO')])).toMatchObject({ value: 0, missing: { INVALIDO: 1 } })
    expect(aggregateData([observed(8), observed(4)], 'mean').value).toBe(6)
    expect(aggregateData([observed(8), observed(4)], 'max').value).toBe(8)
    expect(aggregateData([observed(8)], 'sum', true)).toMatchObject({ value: null, presence: 'NO_INTEGRADO' })
  })
  it('ordena faltantes al final y formatea los estados sin cero artificial', () => {
    expect([null, 0, 10, null, 2].sort(compareNullable)).toEqual([10, 2, 0, null, null])
    expect(formatNumber(null)).toBe('No disponible')
    expect(formatNumber(0, 2)).toBe('0.00')
    expect(formatCurrency(null)).toBe('No disponible')
    expect(formatCurrency(NaN)).toBe('No disponible')
    expect(formatCurrency(0)).toContain('0')
    expect(formatPercentage(percentageData(1, 0))).toBe('No aplica')
    expect(formatPercentage(percentageData(null, 10))).toBe('No disponible')
    expect(formatPercentage(percentageData(0, 10))).toBe('0%')
    expect(missingSummary({ totalDebt: unavailable('INVALIDO') })).toContain('Total registrado: 1 INVALIDO')
    expect(missingSummary({ pendingDebt: unavailable('INVALIDO') })).toContain('Deuda pendiente: 1 INVALIDO')
    expect(missingSummary()).toBe('')
  })
  it('la unidad acompaña solo a un valor', () => {
    expect(formatWithUnit(0, 'dias')).toBe('0 dias')
    expect(formatWithUnit(1500, 'dias')).toBe('1.500 dias')
    expect(formatWithUnit(17.5, '/ 100', 1)).toBe('17.5 / 100')
    expect(formatWithUnit(null, 'dias')).toBe('No disponible')
    expect(formatWithUnit(NaN, 'dias')).toBe('No disponible')
    expect(formatCountOfTotal(1, 2, 'registros')).toBe('1 / 2 registros')
    expect(formatCountOfTotal(null, 2, 'registros')).toBe('No disponible / 2 registros')
    expect(formatCountOfTotal(1, null, 'registros')).toBe('1 / No disponible')
    expect(formatCountOfTotal(null, null, 'registros')).toBe('No disponible')
  })
  it('valida vencimientos antes de calcular días', () => {
    expect(daysSinceData(null).presence).toBe('NO_INFORMADO_EN_ORIGEN')
    expect(daysSinceData('ilegible').presence).toBe('INVALIDO')
    expect(daysSinceData('2024-02-31').presence).toBe('INVALIDO')
    expect(daysSinceData('2024-01-01', Date.parse('2024-01-03')).value).toBe(2)
    expect(daysSinceData('2999-01-01').value).toBe(0)
  })
})
