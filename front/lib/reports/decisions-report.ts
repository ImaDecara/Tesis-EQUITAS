import { serializeCsv, type CsvValue } from '@/lib/reports/csv'
import { definitionsLink, describeFilters, META_COLUMNS } from '@/lib/reports/report-format'
import { cutoffSpan, filterReviewEvents, parseReviewFilters, versionSet, type ReviewEvent, type ReviewFilters } from '@/lib/reports/review-ledger'

// ALIGN-028. Rendicion de lo decidido: fecha, rol, decision y codigo de motivo.
// El texto libre y la identidad de quien decidio no se leen (ver `review-report-reader`), y
// los codigos editables llegan ya controlados desde `buildReviewLedger`.
const COLUMNS = [
  ...META_COLUMNS,
  'decision_id', 'objeto_id', 'fecha', 'rol', 'decision', 'codigo_motivo',
  'intervencion_sugerida', 'intensidad_sugerida', 'intervencion_decidida', 'intensidad_decidida',
  'reemplaza_a', 'vigente', 'aprobacion', 'decisiones', 'vigentes',
] as const
type Column = (typeof COLUMNS)[number]

const NOT_APPLICABLE = 'NO_APLICA'

export const parseDecisionFilters = (params: URLSearchParams) => parseReviewFilters(params)

function detailRow(event: ReviewEvent, filtros: string, generatedAt: string, definiciones: string): Record<Column, CsvValue> {
  return {
    fecha_corte: event.cutoff,
    version_reglas: event.rulesVersion,
    filtros,
    generado_en: generatedAt,
    definiciones,
    tipo_fila: 'DETALLE',
    decision_id: event.id,
    objeto_id: event.objectId,
    fecha: event.decidedAt,
    rol: event.role,
    decision: event.decision,
    codigo_motivo: event.reasonCode ?? NOT_APPLICABLE,
    intervencion_sugerida: event.suggestedIntervention,
    intensidad_sugerida: event.suggestedIntensity ?? 'NO_INTEGRADO',
    // Contrato §13: nulo es "sin intervencion decidida", nunca intensidad 0.
    intervencion_decidida: event.decidedIntervention ?? NOT_APPLICABLE,
    intensidad_decidida: event.decidedIntensity ?? NOT_APPLICABLE,
    reemplaza_a: event.supersedes ?? NOT_APPLICABLE,
    vigente: event.current,
    aprobacion: event.approval,
    decisiones: 1,
    vigentes: event.current ? 1 : 0,
  }
}

export function buildDecisionsReport(ledger: readonly ReviewEvent[], filters: ReviewFilters, generatedAt: string) {
  const events = filterReviewEvents(ledger, filters)
  const filtros = describeFilters(filters)
  const definiciones = definitionsLink('reporte-decisiones')
  const total: Record<Column, CsvValue> = {
    fecha_corte: cutoffSpan(events),
    version_reglas: versionSet(events),
    filtros,
    generado_en: generatedAt,
    definiciones,
    tipo_fila: 'TOTAL',
    decision_id: NOT_APPLICABLE, objeto_id: NOT_APPLICABLE, fecha: NOT_APPLICABLE, rol: NOT_APPLICABLE,
    decision: NOT_APPLICABLE, codigo_motivo: NOT_APPLICABLE,
    intervencion_sugerida: NOT_APPLICABLE, intensidad_sugerida: NOT_APPLICABLE,
    intervencion_decidida: NOT_APPLICABLE, intensidad_decidida: NOT_APPLICABLE,
    reemplaza_a: NOT_APPLICABLE, vigente: NOT_APPLICABLE, aprobacion: NOT_APPLICABLE,
    decisiones: events.length,
    vigentes: events.filter(event => event.current).length,
  }
  return serializeCsv(COLUMNS, [...events.map(event => detailRow(event, filtros, generatedAt, definiciones)), total])
}
