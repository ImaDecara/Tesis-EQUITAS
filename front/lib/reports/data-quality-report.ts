import contract from '../../../contracts/decision-rules.v1.json'
import { withMaturityMetrics } from '@/lib/analytics'
import { metric } from '@/lib/data-presence'
import { RULES_VERSION } from '@/lib/domain/decision-rules-v1'
import { serializeCsv } from '@/lib/reports/csv'
import { AGGREGATE_COLUMNS, definitionsLink, NO_FILTERS, portfolioCutoff, readParams, shareRow, tally, totalRow, type ReportMeta } from '@/lib/reports/report-format'
import { DATA_PRESENCE_STATES, type DebtorListItem, type NumericData, type RawDebtorDataBundle } from '@/types/equitas-domain'

// ALIGN-028. Cuantas filas de cada indicador tienen el dato, por estado (contrato §4).
// Solo conteos y codigos: `decisionIssues` lleva ids de obligacion, que no se copian.
export function parseDataQualityFilters(params: URLSearchParams) {
  readParams(params, [])
}

const PARTIAL = 'OBSERVADO_PARCIAL'
const PRESENCE_CATEGORIES = [PARTIAL, ...DATA_PRESENCE_STATES]
const SEVERITY_STATES = ['COMPLETA', 'PARCIAL', 'NO_DISPONIBLE', 'SIN_DECISION']
const PRESENCE_INDICATORS: [string, keyof DebtorListItem & string][] = [
  ['presencia_deuda_total', 'totalDebt'],
  ['presencia_deuda_vencida', 'overdueDebt'],
  ['presencia_contactos', 'contactCount'],
  ['presencia_atraso', 'maxDaysOverdue'],
  ['presencia_severidad', 'riskScore'],
]

// Una suma con un importe ilegible tiene valor, pero no es la cifra completa.
function presenceCategory(data: NumericData) {
  return data.value !== null && Object.keys(data.missing).length ? PARTIAL : data.presence
}

export function buildDataQualityReport(debtors: readonly DebtorListItem[], generatedAt: string, batch?: RawDebtorDataBundle['batch']) {
  const objects = debtors.length
  const analytical = debtors.map(withMaturityMetrics)
  const decisions = debtors.flatMap(debtor => debtor.decision ? [debtor.decision] : [])
  const unevaluable = decisions.flatMap(decision => decision.severidad.motivos_no_evaluables)
  const issues = debtors.flatMap(debtor => debtor.decisionIssues ?? [])
  const { fechaCorte } = portfolioCutoff(debtors, batch)
  const meta: ReportMeta = {
    fecha_corte: fechaCorte,
    version_reglas: RULES_VERSION,
    filtros: NO_FILTERS,
    generado_en: generatedAt,
    definiciones: definitionsLink('reporte-calidad'),
  }
  const rows = [
    totalRow(meta, 'objetos_leidos', objects, 'objetos'),
    ...PRESENCE_INDICATORS.flatMap(([indicator, key]) => {
      const categories = analytical.map(debtor => presenceCategory(metric(debtor, key)))
      return PRESENCE_CATEGORIES.map(category =>
        shareRow(meta, indicator, category, categories.filter(item => item === category).length, objects, 'objetos'))
    }),
    totalRow(meta, 'obligaciones_leidas', debtors.reduce((sum, debtor) => sum + (debtor.debtCount ?? 0), 0), 'obligaciones'),
    totalRow(meta, 'obligaciones_no_evaluables', decisions.reduce((sum, decision) => sum + decision.severidad.obligaciones_no_evaluables, 0), 'obligaciones'),
    ...tally(unevaluable.map(item => [`${item.motivo}:${item.estado}`, item.cantidad])).map(([category, count]) =>
      totalRow(meta, 'obligaciones_no_evaluables', count, 'obligaciones', category)),
    totalRow(meta, 'incidencias_decision', issues.length, 'incidencias'),
    ...tally(issues.map(issue => [`${issue.field}:${issue.presence}:${issue.reason}`, 1])).map(([category, count]) =>
      totalRow(meta, 'incidencias_decision', count, 'incidencias', category)),
    ...SEVERITY_STATES.map(state => {
      const count = state === 'SIN_DECISION' ? objects - decisions.length : decisions.filter(decision => decision.severidad.estado === state).length
      return shareRow(meta, 'severidad_estado', state, count, objects, 'objetos')
    }),
    ...contract.banderas.orden.map(flag =>
      shareRow(meta, 'banderas', flag, decisions.filter(decision => (decision.banderas as string[]).includes(flag)).length, decisions.length, 'objetos')),
    shareRow(meta, 'objetos_sin_contacto', 'TOTAL', debtors.filter(debtor => debtor.hasContact === false).length, objects, 'objetos'),
  ]
  return serializeCsv(AGGREGATE_COLUMNS, rows)
}
