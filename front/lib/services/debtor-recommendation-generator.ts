import contract from '../../../contracts/decision-rules.v1.json'
import type { Decision, InterventionCode } from '@/lib/domain/decision-rules-v1'
import type { RecommendationKind } from '@/types/equitas-domain'

export const INTERVENTION_CODES = Object.keys(contract.intervenciones) as InterventionCode[]
export const INTERVENTION_LABELS = Object.fromEntries(INTERVENTION_CODES.map(code =>
  [code, contract.intervenciones[code].cola]
)) as Record<InterventionCode, RecommendationKind>

export type DebtorRecommendationResult = {
  type: RecommendationKind
  summary: string
  reason: string
  isUrgent: boolean
}

/** Presenta la decisión ya evaluada; no vuelve a calcular puntos ni usa perfiles. */
export function generateDebtorRecommendation(decision: Decision | null): DebtorRecommendationResult {
  if (!decision) return {
    type: 'No disponible', summary: 'No disponible',
    reason: 'No se pudo evaluar: lectura incompleta o fecha de corte inválida.', isUrgent: false,
  }
  const type = INTERVENTION_LABELS[decision.intervencion.codigo]
  const review = decision.revision.requiere_revision_humana || decision.intervencion.codigo === 'REVISION_JURIDICA'
  return {
    type,
    summary: type,
    reason: `${decision.explicacion.frase_contrastiva}${review ? ' Evaluar con supervisor antes de gestionar.' : ''}`,
    // Compatibilidad con el DTO previo: señala revisión, nunca urgencia legal.
    isUrgent: review,
  }
}
