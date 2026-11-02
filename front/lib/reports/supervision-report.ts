import { serializeCsv, type CsvValue } from '@/lib/reports/csv'
import { NOT_CATALOGUED } from '@/lib/reports/report-codes'
import { AGGREGATE_COLUMNS, definitionsLink, describeFilters, shareRow, tally, totalRow, type AggregateColumn, type ReportMeta } from '@/lib/reports/report-format'
import { APPROVAL_DECISIONS, cutoffSpan, filterReviewEvents, parseReviewFilters, REVIEW_DECISIONS, versionSet, type ReviewEvent, type ReviewFilters } from '@/lib/reports/review-ledger'

// ALIGN-028. Solo conteos por codigo de lista cerrada: sin objetos, personas ni identidad de quien decidio.
export const parseSupervisionFilters = (params: URLSearchParams) => parseReviewFilters(params, ['desde', 'hasta', 'corte'])

const NO_CODE = 'SIN_CODIGO'

// Dos decimales. Sin base no hay porcentaje: NO_APLICA, nunca 0 (contrato §4.1 regla 5).
function discrepancyRow(meta: ReportMeta, numerator: number, denominator: number): Record<AggregateColumn, CsvValue> {
  const value = denominator > 0 ? Math.round(10000 * numerator / denominator) / 100 : 'NO_APLICA'
  return {
    ...meta, tipo_fila: 'AGREGADO', indicador: 'porcentaje_discrepancia', categoria: 'TOTAL', valor: value,
    numerador: numerator, denominador: denominator, unidad: '%', estado: denominator > 0 ? 'OBSERVADO' : 'NO_APLICA',
  }
}

export function buildSupervisionReport(ledger: readonly ReviewEvent[], filters: ReviewFilters, generatedAt: string) {
  const events = filterReviewEvents(ledger, filters)
  const current = events.filter(event => event.current)
  const required = current.filter(event => event.requiresApproval)
  const objected = current.filter(event => event.approval === 'OBJETA')
  const uncatalogued = current.filter(event => event.decision === NOT_CATALOGUED).length
  const meta: ReportMeta = {
    fecha_corte: cutoffSpan(events),
    version_reglas: versionSet(events),
    filtros: describeFilters(filters),
    generado_en: generatedAt,
    definiciones: definitionsLink('reporte-supervision'),
  }
  const rows = [
    totalRow(meta, 'decisiones_vigentes', current.length, 'decisiones'),
    totalRow(meta, 'eventos_reemplazados', events.length - current.length, 'eventos'),
    ...REVIEW_DECISIONS.map(decision =>
      shareRow(meta, 'decisiones_por_tipo', decision, current.filter(event => event.decision === decision).length, current.length, 'decisiones')),
    // La base no lo admite hoy. Si aparece se cuenta, para que el desglose siga sumando el total.
    ...(uncatalogued ? [shareRow(meta, 'decisiones_por_tipo', NOT_CATALOGUED, uncatalogued, current.length, 'decisiones')] : []),
    discrepancyRow(meta, current.filter(event => event.decision !== 'ACEPTA').length, current.length),
    ...tally(current.map(event => [event.reasonCode ?? NO_CODE, 1])).map(([code, count]) =>
      shareRow(meta, 'motivos_decision', code, count, current.length, 'decisiones')),
    totalRow(meta, 'aprobacion_requerida', required.length, 'decisiones'),
    shareRow(meta, 'pendientes_aprobacion', 'TOTAL', required.filter(event => event.approval === 'PENDIENTE').length, required.length, 'decisiones'),
    ...APPROVAL_DECISIONS.map(decision =>
      shareRow(meta, 'aprobaciones_vigentes', decision, required.filter(event => event.approval === decision).length, required.length, 'decisiones')),
    ...tally(objected.map(event => [event.objectionCode ?? NO_CODE, 1])).map(([code, count]) =>
      shareRow(meta, 'motivos_objecion', code, count, objected.length, 'decisiones')),
  ]
  return serializeCsv(AGGREGATE_COLUMNS, rows)
}
