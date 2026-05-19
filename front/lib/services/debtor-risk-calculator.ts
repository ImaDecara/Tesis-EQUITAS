import type { RiskLevel } from '@/types/equitas-domain'

// Regla de negocio para clasificar riesgo del objeto de deuda.
export function calculateDebtorRiskLevel(
  providedRisk: string,
  totalDebt: number,
  overdueDebt: number,
  hasContact: boolean
): RiskLevel {
  const normalized = providedRisk.trim().toLowerCase()

  if (normalized.includes('alto') || normalized === 'high') {
    return 'ALTO'
  }

  if (normalized.includes('medio') || normalized === 'medium') {
    return 'MEDIO'
  }

  if (normalized.includes('bajo') || normalized === 'low') {
    return 'BAJO'
  }

  if (overdueDebt > 0 && totalDebt >= 800000) {
    return 'ALTO'
  }

  if (overdueDebt > 0 || totalDebt >= 350000 || !hasContact) {
    return 'MEDIO'
  }

  return 'BAJO'
}
