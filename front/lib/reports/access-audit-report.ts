import { serializeCsv, type CsvValue } from '@/lib/reports/csv'
import { definitionsLink, describeFilters, isCalendarDate, META_COLUMNS, readParams, ReportFilterError } from '@/lib/reports/report-format'

// ALIGN-069. Reporte de accesos para supervisor: una fila por registro de `access_audit`, tal como
// esta guardado. Solo identificadores internos y codigos: sin nombres, correos ni documentos.
const COLUMNS = [...META_COLUMNS, 'registro_id', 'fecha', 'accion', 'objetivo', 'actor_id', 'rol_actor', 'registros'] as const
type Column = (typeof COLUMNS)[number]

const NOT_APPLICABLE = 'NO_APLICA'
const FILTERS = ['desde', 'hasta', 'accion', 'actor'] as const
const ACTIONS = ['CASE_OPEN', 'REPORT_EXPORT', 'IMPORT_CONFIRM', 'ANALYTICS_VIEW', 'CHANNEL_LINK']

export type AccessAuditFilters = Partial<Record<(typeof FILTERS)[number], string>>
export type AccessAuditRow = {
  id: string | number
  actor: string | number
  actor_role: string
  action: string
  target: string
  created_at: string
}

export function parseAccessAuditFilters(params: URLSearchParams): AccessAuditFilters {
  const filters = readParams(params, FILTERS)
  for (const name of ['desde', 'hasta'] as const) {
    if (filters[name] && !isCalendarDate(filters[name])) throw new ReportFilterError(name)
  }
  if (filters.desde && filters.hasta && filters.desde > filters.hasta) throw new ReportFilterError('desde')
  if (filters.accion && !ACTIONS.includes(filters.accion)) throw new ReportFilterError('accion')
  if (filters.actor && !/^[1-9]\d{0,17}$/.test(filters.actor)) throw new ReportFilterError('actor')
  return filters
}

// `desde` y `hasta` comparan el dia UTC del registro, inclusive. Se pasa a UTC: el formato
// de la base depende de la zona de la conexion.
const utcDay = (timestamp: string) => new Date(timestamp).toISOString().slice(0, 10)

export function buildAccessAuditReport(records: readonly AccessAuditRow[], filters: AccessAuditFilters, generatedAt: string) {
  const selected = records.filter(record => {
    const day = utcDay(record.created_at)
    return (!filters.desde || day >= filters.desde) &&
      (!filters.hasta || day <= filters.hasta) &&
      (!filters.accion || record.action === filters.accion) &&
      (!filters.actor || String(record.actor) === filters.actor)
  })
  const shared = {
    fecha_corte: NOT_APPLICABLE,
    version_reglas: NOT_APPLICABLE,
    filtros: describeFilters(filters),
    generado_en: generatedAt,
    definiciones: definitionsLink('reporte-accesos'),
  }
  const rows: Record<Column, CsvValue>[] = selected.map(record => ({
    ...shared,
    tipo_fila: 'DETALLE',
    registro_id: String(record.id),
    fecha: new Date(record.created_at).toISOString(),
    accion: record.action,
    objetivo: record.target,
    actor_id: String(record.actor),
    rol_actor: record.actor_role,
    registros: 1,
  }))
  rows.push({
    ...shared,
    tipo_fila: 'TOTAL',
    registro_id: NOT_APPLICABLE,
    fecha: NOT_APPLICABLE,
    accion: NOT_APPLICABLE,
    objetivo: NOT_APPLICABLE,
    actor_id: NOT_APPLICABLE,
    rol_actor: NOT_APPLICABLE,
    registros: selected.length,
  })
  return serializeCsv(COLUMNS, rows)
}
