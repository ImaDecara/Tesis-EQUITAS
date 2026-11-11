import type { Decision } from '@/lib/domain/decision-rules-v1'
import type { RiskLevel } from '@/types/equitas-domain'

const MIN_RISK_SCORE = 0
const MAX_RISK_SCORE = 100

export function clampRiskScore(score: number) {
  if (!Number.isFinite(score)) {
    return MIN_RISK_SCORE
  }

  return Math.min(Math.max(score, MIN_RISK_SCORE), MAX_RISK_SCORE)
}

// Compatibilidad del índice heredado de PERSONAS, en puntos (no porcentaje):
// 0-39 => BAJO | 40-69 => MEDIO | 70-100 => ALTO.
// Los objetos usan exclusivamente la severidad calculada por reglas v1 abajo.
export function mapRiskLevel(score: number): RiskLevel {
  const normalizedScore = clampRiskScore(score)

  if (normalizedScore >= 70) {
    return 'ALTO'
  }

  if (normalizedScore >= 40) {
    return 'MEDIO'
  }

  return 'BAJO'
}

// Alias transitorios del DTO: conserva los nombres para las pantallas de ALIGN-012.
// No acepta un perfil, contacto ni etiquetas que puedan inventar una severidad.
export function calculateDebtorRiskAssessment(decision: Decision | null): {
  risk: RiskLevel | null; riskScore: number | null
} {
  const levels: Record<string, RiskLevel> = { ALTA: 'ALTO', MEDIA: 'MEDIO', BAJA: 'BAJO' }
  return {
    risk: decision ? levels[decision.severidad.banda] ?? null : null,
    riskScore: decision?.severidad.valor ?? null,
  }
}
