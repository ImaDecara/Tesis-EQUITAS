import type { RiskLevel } from '@/types/equitas-domain'

const MIN_RISK_SCORE = 0
const MAX_RISK_SCORE = 100

export function clampRiskScore(score: number) {
  if (!Number.isFinite(score)) {
    return MIN_RISK_SCORE
  }

  return Math.min(Math.max(score, MIN_RISK_SCORE), MAX_RISK_SCORE)
}

// mapRiskLevel(score) normaliza cualquier score a la escala de riesgo oficial 0-100:
// 0-39 => BAJO | 40-69 => MEDIO | 70-100 => ALTO.
// Se usa tanto para riesgo de objeto (socioeconomic_risk_level) como para riesgo individual.
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

function parseRiskScaleValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clampRiskScore(value)
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  if (!trimmed) {
    return null
  }

  const numeric = Number(trimmed.replace(',', '.'))

  if (!Number.isFinite(numeric)) {
    return null
  }

  return clampRiskScore(numeric)
}

function getScoreFromRiskLabel(label: string) {
  if (label.includes('alto') || label === 'high') {
    return 85
  }

  if (label.includes('medio') || label === 'medium') {
    return 55
  }

  if (label.includes('bajo') || label === 'low') {
    return 25
  }

  return null
}

type DebtorRiskAssessmentInput = {
  providedRisk: unknown
  totalDebt: number
  overdueDebt: number
  hasContact: boolean
  maxDaysOverdue?: number
}

type DebtorRiskAssessmentResult = {
  risk: RiskLevel
  riskScore: number
}

// Clasifica el riesgo operativo del objeto y retorna etiqueta + score en la escala 0-100.
export function calculateDebtorRiskAssessment({
  providedRisk,
  totalDebt,
  overdueDebt,
  hasContact,
  maxDaysOverdue = 0,
}: DebtorRiskAssessmentInput): DebtorRiskAssessmentResult {
  const normalized =
    typeof providedRisk === 'string' ? providedRisk.trim().toLowerCase() : ''
  const scaleValue = parseRiskScaleValue(providedRisk)

  // Si el perfil ya trae score 0-100 (socioeconomic_risk_level), se usa como fuente principal.
  if (scaleValue !== null) {
    return {
      risk: mapRiskLevel(scaleValue),
      riskScore: scaleValue,
    }
  }

  const labelScore = getScoreFromRiskLabel(normalized)
  if (labelScore !== null) {
    return {
      risk: mapRiskLevel(labelScore),
      riskScore: labelScore,
    }
  }

  // Fallback: si no llega socioeconomic_risk_level, se estima score por senales operativas.
  if (overdueDebt > 0 && (totalDebt >= 800000 || maxDaysOverdue >= 90)) {
    const inferredScore = 78
    return {
      risk: mapRiskLevel(inferredScore),
      riskScore: inferredScore,
    }
  }

  if (overdueDebt > 0 || totalDebt >= 350000 || maxDaysOverdue >= 30 || !hasContact) {
    const inferredScore = 55
    return {
      risk: mapRiskLevel(inferredScore),
      riskScore: inferredScore,
    }
  }

  const inferredScore = 25
  return {
    risk: mapRiskLevel(inferredScore),
    riskScore: inferredScore,
  }
}

// Compatibilidad temporal con llamados previos que esperan solo la etiqueta de riesgo.
export function calculateDebtorRiskLevel(
  providedRisk: unknown,
  totalDebt: number,
  overdueDebt: number,
  hasContact: boolean,
  maxDaysOverdue = 0
): RiskLevel {
  return calculateDebtorRiskAssessment({
    providedRisk,
    totalDebt,
    overdueDebt,
    hasContact,
    maxDaysOverdue,
  }).risk
}
