import { RECORDED_DECISION_LABELS, reasonLabel, reviewActionLabel } from '@/lib/domain/case-review-form'
import type { CaseReviewDecision } from '@/lib/domain/case-review-contract'
import { RECORDED_STATUS_LABELS } from '@/lib/domain/recorded-decision'
import { roleLabel } from '@/lib/domain/role-labels'
import { NOT_CATALOGUED } from '@/lib/reports/report-codes'
import type { ApprovalState } from '@/lib/reports/review-ledger'

// Noche 7 (H14). Rótulo en español junto a cada código de los reportes: los MISMOS textos de la
// pantalla (ficha, listados y Pendientes), sin duplicarlos. Un código fuera de lista no se copia.
const UNCATALOGUED_LABEL = 'Código no catalogado'
const NOT_INFORMED_LABEL = 'No informado'

export function decisionText(code: string) {
  return Object.hasOwn(RECORDED_DECISION_LABELS, code) ? RECORDED_DECISION_LABELS[code as CaseReviewDecision] : UNCATALOGUED_LABEL
}

// Intervención e intensidad juntas, como en el formulario de la ficha. Sin intervención: no hay acción.
export function actionText(intervention: string | null, intensity: number | null) {
  if (intervention === null) return 'Sin acción decidida'
  if (intervention === NOT_CATALOGUED) return UNCATALOGUED_LABEL
  if (intervention === 'NO_INTEGRADO' || intensity === null) return NOT_INFORMED_LABEL
  return reviewActionLabel(intervention, intensity)
}

export function reasonText(code: string | null) {
  if (code === null) return 'Sin motivo'
  return code === NOT_CATALOGUED ? UNCATALOGUED_LABEL : reasonLabel(code) ?? UNCATALOGUED_LABEL
}

// Un rol histórico se ve «operador (rol anterior)», igual que en el historial de la ficha.
export function roleText(code: string) {
  if (code === NOT_CATALOGUED) return 'Rol no catalogado'
  return code === 'NO_INTEGRADO' ? NOT_INFORMED_LABEL : roleLabel(code)
}

const APPROVAL_TEXT: Readonly<Record<ApprovalState, string>> = {
  NO_REQUERIDA: RECORDED_STATUS_LABELS.REGISTRADA,
  PENDIENTE: RECORDED_STATUS_LABELS.PENDIENTE_APROBACION,
  APRUEBA: RECORDED_STATUS_LABELS.APROBADA,
  OBJETA: RECORDED_STATUS_LABELS.OBJETADA,
  REEMPLAZADA: 'Propuesta reemplazada por una decisión posterior',
}
export const approvalText = (state: ApprovalState) => APPROVAL_TEXT[state]

// Lista cerrada de `access_audit.action` (contrato de dominio §15).
export const AUDIT_ACTION_TEXT: Readonly<Record<string, string>> = {
  CASE_OPEN: 'Apertura de un caso',
  REPORT_EXPORT: 'Descarga de un reporte',
  // El resultado de la carga está en el lote, no en este registro.
  IMPORT_CONFIRM: 'Confirmación de carga solicitada',
  ANALYTICS_VIEW: 'Consulta de una pantalla de análisis',
  CHANNEL_LINK: 'Vínculo con un canal de contacto',
}
export const auditActionText = (code: string) => AUDIT_ACTION_TEXT[code] ?? UNCATALOGUED_LABEL
