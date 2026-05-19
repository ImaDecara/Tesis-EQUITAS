import type { RiskLevel } from '@/types/equitas-domain'

// Genera la recomendacion hardcodeada segun riesgo/contacto/mora.
export function generateDebtorRecommendation(
  risk: RiskLevel,
  hasContact: boolean,
  overdueDebt: number
) {
  if (risk === 'ALTO' && hasContact) {
    return 'Contacto inmediato multicanal + propuesta de regularizacion'
  }

  if (risk === 'ALTO') {
    return 'Busqueda de contacto prioritaria y derivacion a gestion intensiva'
  }

  if (risk === 'MEDIO' && overdueDebt > 0) {
    return 'Recordatorio de deuda vencida y plan de pago asistido'
  }

  if (!hasContact) {
    return 'Completar datos de contacto y enviar notificacion preventiva'
  }

  return 'Seguimiento preventivo con campana de cumplimiento'
}
