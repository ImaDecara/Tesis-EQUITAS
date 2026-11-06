import { amountInCents } from '@/lib/domain/decision-rules-v1'
import { findMatchingRowKey, selectValueFromRow } from '@/lib/parsers/generic-value-selector'
import type { DataPresence, DataWarning, NumericData, PresenceMetrics, RawRow } from '@/types/equitas-domain'

export function observed(value: number): NumericData {
  return { value: value === 0 ? 0 : value, presence: 'OBSERVADO', missing: {} }
}

export function unavailable(presence: DataPresence = 'NO_INTEGRADO', reason = 'VALOR_INVALIDO'): NumericData {
  return { value: null, presence, missing: { [presence]: 1 }, ...(presence === 'INVALIDO' ? { reason } : {}) }
}

// No elimina letras ni símbolos: un importe ilegible nunca se transforma en cero.
export function numericData(value: unknown): NumericData {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
    return unavailable('NO_INFORMADO_EN_ORIGEN')
  }
  if (typeof value !== 'number' && typeof value !== 'string') return unavailable('INVALIDO', 'NUMERO_INVALIDO')
  if (typeof value === 'string' && !/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(value.trim())) return unavailable('INVALIDO', 'NUMERO_INVALIDO')
  const parsed = typeof value === 'number' ? value : Number(value.trim().replace(',', '.'))
  return Number.isFinite(parsed) ? observed(parsed) : unavailable('INVALIDO', 'NUMERO_INVALIDO')
}

// Number solo es válido si conserva exactamente los centavos recibidos.
export function moneyData(raw: unknown): NumericData {
  const data = numericData(raw)
  if (data.value === null) return data
  try {
    const cents = amountInCents(data.value)
    if (typeof raw === 'string') {
      const match = /^([+-]?)(\d*)(?:[.,](\d*))?$/.exec(raw.trim())!
      const decimals = match[3] ?? ''
      if (decimals.slice(2).replace(/0/g, '')) throw new RangeError()
      const exact = (BigInt(match[2] || '0') * BigInt(100) + BigInt(decimals.slice(0, 2).padEnd(2, '0'))) * (match[1] === '-' ? -BigInt(1) : BigInt(1))
      if (exact !== BigInt(cents)) throw new RangeError()
    }
    return data
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    return unavailable('INVALIDO', 'IMPORTE_NO_EXPRESABLE_EN_CENTAVOS_SEGUROS')
  }
}

export function sumMoney(values: NumericData[], failed = false): NumericData {
  const result = aggregateData(values, 'sum', failed)
  if (result.value === null) return result
  try {
    const cents = values.reduce((sum, item) => sum + (item.value === null ? BigInt(0) : BigInt(amountInCents(item.value))), BigInt(0))
    if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < -BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError()
    const value = Number(cents) / 100
    if (BigInt(amountInCents(value)) !== cents) throw new RangeError()
    return { ...result, value }
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    return { ...unavailable('INVALIDO', 'SUMA_FUERA_DE_RANGO_SEGURO'), missing: { ...result.missing, INVALIDO: (result.missing.INVALIDO ?? 0) + 1 } }
  }
}

export function selectNumericData(row: RawRow, candidates: string[]) {
  return numericData(selectValueFromRow(row, candidates))
}

export function currentAmount(row: RawRow) {
  const currentKey = findMatchingRowKey(row, ['current_amount'])
  return currentKey === null ? moneyData(selectValueFromRow(row, ['updated_amount', 'amount_updated',
    'total_amount', 'amount_due', 'monto_actualizado'])) : moneyData(row[currentKey])
}

export function readingFailed(warnings: DataWarning[], ...tables: string[]) {
  return warnings.some(warning => tables.includes(warning.table))
}

// El orden de faltantes sigue §4. Se conservan los conteos aun en sumas parciales.
const missingOrder: DataPresence[] = ['NO_APLICA', 'NO_INTEGRADO', 'NO_INFORMADO_EN_ORIGEN', 'INVALIDO']
export function aggregateData(values: NumericData[], kind: 'sum' | 'mean' | 'max' = 'sum', failed = false): NumericData {
  if (failed) return { value: null, presence: 'NO_INTEGRADO', missing: {} }
  const missing: NumericData['missing'] = {}
  for (const item of values) {
    for (const [state, count] of Object.entries(item.missing)) {
      const key = state as DataPresence
      missing[key] = (missing[key] ?? 0) + count
    }
  }
  const numbers = values.flatMap(item => item.value === null ? [] : [item.value])
  if (!numbers.length) {
    if (!values.length) return kind === 'sum' ? observed(0) : { value: null, presence: 'NO_APLICA', missing: {} }
    return { value: null, presence: missingOrder.find(state => missing[state]) ?? 'NO_INTEGRADO', missing }
  }
  const sum = numbers.reduce((a, b) => a + b, 0)
  const value = kind === 'max' ? numbers.reduce((a, b) => Math.max(a, b)) : kind === 'mean' ? sum / numbers.length : sum
  return { value, presence: 'OBSERVADO', missing }
}

export function metric<T extends PresenceMetrics>(item: T, key: keyof T & string): NumericData {
  return item.metrics?.[key] ?? numericData(item[key])
}

export function daysSinceData(value: string | null, now = Date.now()): NumericData {
  if (!value) return unavailable('NO_INFORMADO_EN_ORIGEN')
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) ||
      new Date(timestamp).toISOString().slice(0, 10) !== value.slice(0, 10)) return unavailable('INVALIDO', 'FECHA_INVALIDA')
  return observed(Math.max(0, Math.floor((now - timestamp) / 86400000)))
}

export function compareNullable(a: number | null, b: number | null) {
  if (a === null) return b === null ? 0 : 1
  if (b === null) return -1
  return b - a
}

export function formatNumber(value: number | null, digits?: number) {
  if (value === null || !Number.isFinite(value)) return 'No disponible'
  return digits === undefined ? value.toLocaleString('es-AR') : value.toFixed(digits)
}

// La unidad acompaña solo a un valor: sin dato no queda "No disponible dias".
export function formatWithUnit(value: number | null, unit: string, digits?: number) {
  const text = formatNumber(value, digits)
  return value === null || !Number.isFinite(value) ? text : `${text} ${unit}`
}

// "n / N unidad": con ambos faltantes no se repite "No disponible" ni queda la unidad suelta.
export function formatCountOfTotal(part: number | null, total: number | null, unit: string) {
  if (part === null && total === null) return formatNumber(null)
  return `${formatNumber(part)} / ${formatWithUnit(total, unit)}`
}

export function percentageData(numerator: number | null, denominator: number | null) {
  if (numerator === null || denominator === null) return unavailable()
  return denominator > 0 ? observed(Math.round(100 * numerator / denominator)) : { value: null, presence: 'NO_APLICA' as const, missing: {} }
}

export function formatPercentage(data: NumericData) {
  return data.value === null ? data.presence === 'NO_APLICA' ? 'No aplica' : 'No disponible' : `${data.value}%`
}

export function missingSummary(metrics?: Record<string, NumericData>) {
  const labels: Record<string, string> = {
    totalDebt: 'Deuda total', overdueDebt: 'Deuda vencida', totalDebtAssociated: 'Deuda asociada',
    highSeverityCases: 'Severidad alta', riskValue: 'Puntaje', riskScore: 'Severidad', averageRiskValue: 'Promedio del índice heredado',
    totalDebtors: 'Objetos', overdueCases: 'Casos vencidos', withContactCases: 'Con contacto',
    withoutContactCases: 'Sin contacto', priorityCases: 'Prioridad', urgentRecommendationCases: 'Revisión requerida',
    criticalCasesToday: 'Casos críticos', riskAboveNinetyCases: 'Objetos con severidad mayor a 90 puntos', criticalDebtTotal: 'Deuda crítica',
    contactCount: 'Contactos', maxDaysOverdue: 'Atraso', averageOverdueDays: 'Promedio de atraso',
  }
  return Object.entries(metrics ?? {}).flatMap(([name, data]) =>
    Object.entries(data.missing).map(([state, count]) => `${labels[name] ?? 'Dato'}: ${count} ${state}`)
  ).join('; ')
}
