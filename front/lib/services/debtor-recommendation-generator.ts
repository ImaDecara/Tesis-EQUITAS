import type { RecommendationKind, RiskLevel } from '@/types/equitas-domain'

export type DebtorRecommendationResult = {
  type: RecommendationKind
  summary: string
  reason: string
  isUrgent: boolean
}

type RecommendationInput = {
  risk: RiskLevel
  hasContact: boolean
  overdueDebt: number
  totalDebt: number
  overdueDays: number
}

// Traduce senales operativas en una accion concreta y entendible para el gestor municipal.
export function generateDebtorRecommendation({
  risk,
  hasContact,
  overdueDebt,
  totalDebt,
  overdueDays,
}: RecommendationInput): DebtorRecommendationResult {
  if (risk === 'ALTO' && hasContact) {
    return {
      type: 'Llamado prioritario',
      summary: 'Llamado prioritario',
      reason:
        'Presenta riesgo alto y cuenta con contacto disponible, por lo que conviene gestionar en el dia.',
      isUrgent: true,
    }
  }

  if (risk === 'ALTO' && !hasContact) {
    return {
      type: 'Plan de pago / revision humana',
      summary: 'Plan de pago / revision humana',
      reason:
        'Tiene riesgo alto sin canal de contacto activo. Requiere intervencion humana para localizar y definir estrategia.',
      isUrgent: true,
    }
  }

  if (overdueDebt > 0 && overdueDays >= 60) {
    return {
      type: 'Plan de pago / revision humana',
      summary: 'Plan de pago / revision humana',
      reason:
        'Acumula mora prolongada y necesita evaluacion de plan de pago o escalamiento de cobranza.',
      isUrgent: true,
    }
  }

  if (overdueDebt > 0 || totalDebt >= 350000) {
    return {
      type: 'Mensaje recordatorio',
      summary: 'Mensaje recordatorio',
      reason:
        'Cuenta con deuda exigible o saldo relevante, por lo que corresponde recordatorio formal con seguimiento.',
      isUrgent: false,
    }
  }

  return {
    type: 'Seguimiento posterior',
    summary: 'Seguimiento posterior',
    reason:
      'No presenta senales criticas inmediatas. Se recomienda monitoreo periodico y contacto preventivo.',
    isUrgent: false,
  }
}
