import { RULES_VERSION } from '@/lib/domain/decision-rules-v1'
import { isStale } from '@/lib/domain/recorded-decision'
import { serializeCsv, type CsvValue } from '@/lib/reports/csv'
import { actionText, approvalText, decisionText, reasonText, roleText } from '@/lib/reports/report-labels'
import { caseIdentifier, currentMeta, definitionsLink, describeFilters, META_COLUMNS, UNKNOWN_PORTFOLIO, type PortfolioReference } from '@/lib/reports/report-format'
import { cutoffSpan, filterReviewEvents, parseReviewFilters, versionSet, type ReviewEvent, type ReviewFilters } from '@/lib/reports/review-ledger'

// ALIGN-028. Rendicion de lo decidido: fecha, rol, decision y codigo de motivo.
// El texto libre y la identidad de quien decidio no se leen (ver `review-report-reader`), y
// los codigos editables llegan ya controlados desde `buildReviewLedger`.
// Noche 7 (H14): el caso se identifica como en los listados y cada codigo lleva su rotulo de pantalla.
const COLUMNS = [
  ...META_COLUMNS,
  'decision_id', 'objeto_id', 'identificador', 'fecha', 'rol', 'rol_rotulo', 'decision', 'decision_rotulo',
  'codigo_motivo', 'motivo_rotulo', 'intervencion_sugerida', 'intensidad_sugerida', 'accion_sugerida',
  'intervencion_decidida', 'intensidad_decidida', 'accion_decidida',
  'reemplaza_a', 'vigente', 'aprobacion', 'aprobacion_rotulo', 'datos_anteriores', 'decisiones', 'vigentes',
] as const
type Column = (typeof COLUMNS)[number]

const NOT_APPLICABLE = 'NO_APLICA'

export const parseDecisionFilters = (params: URLSearchParams) => parseReviewFilters(params)

type Shared = Pick<Record<Column, CsvValue>, 'fecha_cartera' | 'version_reglas_vigente' | 'filtros' | 'generado_en' | 'definiciones'>

function detailRow(event: ReviewEvent, shared: Shared, reference: PortfolioReference): Record<Column, CsvValue> {
  return {
    ...shared,
    fecha_corte: event.cutoff,
    version_reglas: event.rulesVersion,
    tipo_fila: 'DETALLE',
    decision_id: event.id,
    objeto_id: event.objectId,
    identificador: caseIdentifier(reference, event.objectId),
    fecha: event.decidedAt,
    rol: event.role,
    rol_rotulo: roleText(event.role),
    decision: event.decision,
    decision_rotulo: decisionText(event.decision),
    codigo_motivo: event.reasonCode ?? NOT_APPLICABLE,
    motivo_rotulo: reasonText(event.reasonCode),
    intervencion_sugerida: event.suggestedIntervention,
    intensidad_sugerida: event.suggestedIntensity ?? 'NO_INTEGRADO',
    accion_sugerida: actionText(event.suggestedIntervention, event.suggestedIntensity),
    // Contrato §13: nulo es "sin intervencion decidida", nunca intensidad 0.
    intervencion_decidida: event.decidedIntervention ?? NOT_APPLICABLE,
    intensidad_decidida: event.decidedIntensity ?? NOT_APPLICABLE,
    accion_decidida: actionText(event.decidedIntervention, event.decidedIntensity),
    reemplaza_a: event.supersedes ?? NOT_APPLICABLE,
    vigente: event.current,
    aprobacion: event.approval,
    aprobacion_rotulo: approvalText(event.approval),
    // La misma regla que la ficha, los listados y Pendientes («Registrada sobre datos anteriores»).
    datos_anteriores: isStale({ asOf: event.cutoff, rulesVersion: event.rulesVersion }, { asOf: reference.currentAsOf, rulesVersion: RULES_VERSION }),
    decisiones: 1,
    vigentes: event.current ? 1 : 0,
  }
}

export function buildDecisionsReport(ledger: readonly ReviewEvent[], filters: ReviewFilters, generatedAt: string, reference: PortfolioReference = UNKNOWN_PORTFOLIO) {
  const events = filterReviewEvents(ledger, filters)
  const shared: Shared = { ...currentMeta(reference), filtros: describeFilters(filters), generado_en: generatedAt, definiciones: definitionsLink('reporte-decisiones') }
  const total: Record<Column, CsvValue> = {
    ...shared,
    fecha_corte: cutoffSpan(events),
    version_reglas: versionSet(events),
    tipo_fila: 'TOTAL',
    decision_id: NOT_APPLICABLE, objeto_id: NOT_APPLICABLE, identificador: NOT_APPLICABLE, fecha: NOT_APPLICABLE,
    rol: NOT_APPLICABLE, rol_rotulo: NOT_APPLICABLE, decision: NOT_APPLICABLE, decision_rotulo: NOT_APPLICABLE,
    codigo_motivo: NOT_APPLICABLE, motivo_rotulo: NOT_APPLICABLE,
    intervencion_sugerida: NOT_APPLICABLE, intensidad_sugerida: NOT_APPLICABLE, accion_sugerida: NOT_APPLICABLE,
    intervencion_decidida: NOT_APPLICABLE, intensidad_decidida: NOT_APPLICABLE, accion_decidida: NOT_APPLICABLE,
    reemplaza_a: NOT_APPLICABLE, vigente: NOT_APPLICABLE, aprobacion: NOT_APPLICABLE, aprobacion_rotulo: NOT_APPLICABLE,
    datos_anteriores: NOT_APPLICABLE,
    decisiones: events.length,
    vigentes: events.filter(event => event.current).length,
  }
  return serializeCsv(COLUMNS, [...events.map(event => detailRow(event, shared, reference)), total])
}
