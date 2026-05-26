import type { RiskLevel } from '@/types/equitas-domain'

function parseRiskScaleValue(value: string) {
  const trimmed = value.trim()

  if (!trimmed) {
    return null
  }

  const numeric = Number(trimmed.replace(',', '.'))
  if (!Number.isFinite(numeric)) {
    return null
  }

  return Math.min(Math.max(numeric, 0), 5)
}

// Clasifica el riesgo operativo del objeto segun mora, monto y capacidad real de contacto.
export function calculateDebtorRiskLevel(
  providedRisk: string,
  totalDebt: number,
  overdueDebt: number,
  hasContact: boolean,
  maxDaysOverdue = 0
): RiskLevel {
  const normalized = providedRisk.trim().toLowerCase()
  const scaleValue = parseRiskScaleValue(providedRisk)

  // Si el perfil ya trae escala 1-5 (socioeconomic_risk_level), se usa como fuente principal.
  if (scaleValue !== null) {
    if (scaleValue >= 5) {
      return 'ALTO'
    }

    if (scaleValue >= 3) {
      return 'MEDIO'
    }

    if (scaleValue >= 1) {
      return 'BAJO'
    }
  }

  if (normalized.includes('alto') || normalized === 'high') {
    return 'ALTO'
  }

  if (normalized.includes('medio') || normalized === 'medium') {
    return 'MEDIO'
  }

  if (normalized.includes('bajo') || normalized === 'low') {
    return 'BAJO'
  }

  // Cuando no viene riesgo desde la base, la regla interna prioriza antiguedad de mora + monto.
  if (overdueDebt > 0 && (totalDebt >= 800000 || maxDaysOverdue >= 90)) {
    return 'ALTO'
  }

  // Si no hay contacto disponible, el recupero se vuelve mas costoso y sube el riesgo operativo.
  if (overdueDebt > 0 || totalDebt >= 350000 || maxDaysOverdue >= 30 || !hasContact) {
    return 'MEDIO'
  }

  return 'BAJO'
}
