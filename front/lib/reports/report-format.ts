import type { CsvValue } from '@/lib/reports/csv'
import type { DataPresence, DataWarning, DebtorListItem, NumericData, RawDebtorDataBundle } from '@/types/equitas-domain'

// ALIGN-028. Columnas y reglas comunes a los cuatro reportes.
export const META_COLUMNS = ['fecha_corte', 'version_reglas', 'filtros', 'generado_en', 'definiciones', 'tipo_fila'] as const
export const AGGREGATE_COLUMNS = [...META_COLUMNS, 'indicador', 'categoria', 'valor', 'numerador', 'denominador', 'unidad', 'estado'] as const
export type AggregateColumn = (typeof AGGREGATE_COLUMNS)[number]
export type ReportMeta = Pick<Record<(typeof META_COLUMNS)[number], string>, 'fecha_corte' | 'version_reglas' | 'filtros' | 'generado_en' | 'definiciones'>

// Sin sitio publico de documentacion: ruta del repositorio mas el ancla estable del catalogo.
export const definitionsLink = (anchor: string) => `docs/tesis/catalogo-indicadores-v1.md#${anchor}`
export const NO_FILTERS = 'SIN_FILTROS'

export class ReportFilterError extends Error {
  constructor(readonly param: string) {
    super(`Filtro invalido: ${param}`)
    this.name = 'ReportFilterError'
  }
}

export class ReportReadError extends Error {
  constructor(readonly tables: readonly string[]) {
    super('No se pudieron leer los datos del reporte')
    this.name = 'ReportReadError'
  }
}

// Contrato §4.1 regla 6: con una lectura fallida el universo no se conoce y no hay archivo.
export function assertReadsComplete(warnings: readonly DataWarning[]) {
  if (warnings.length) throw new ReportReadError([...new Set(warnings.map(warning => warning.table))])
}

// Un parametro desconocido se rechaza: un filtro mal escrito no debe exportar todo sin avisar.
// `ignored` son los de paginacion de la pantalla: el reporte siempre es completo.
export function readParams<Name extends string>(params: URLSearchParams, allowed: readonly Name[], ignored: readonly string[] = []) {
  const known = new Set<string>([...allowed, ...ignored])
  const values: Partial<Record<Name, string>> = {}
  for (const name of new Set(params.keys())) {
    if (!known.has(name) || params.getAll(name).length !== 1) throw new ReportFilterError(name)
  }
  for (const name of allowed) {
    const value = params.get(name)?.trim()
    if (value) values[name] = value
  }
  return values
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function describeFilters(filters: Readonly<Record<string, string | undefined>>) {
  const parts = Object.entries(filters).flatMap(([name, value]) => value ? [`${name}=${value}`] : [])
  return parts.length ? parts.sort().join('|') : NO_FILTERS
}

// Contrato §4: el valor o, si falta, su estado. Nunca 0 ni una celda vacia.
export function numericCell(data: NumericData): CsvValue {
  return data.value ?? absentState(data.presence)
}

export function absentState(presence: DataPresence): Exclude<DataPresence, 'OBSERVADO'> {
  return presence === 'OBSERVADO' ? 'NO_INTEGRADO' : presence
}

// El corte no se toma del reloj. Sin manifiesto (`as_of` no integrado, contrato §5) las reglas
// usan la fecha de calculo, que se informa aparte y rotulada, como en la pantalla.
export function portfolioCutoff(universe: readonly DebtorListItem[], batch?: RawDebtorDataBundle['batch']) {
  if (batch) return { fechaCorte: batch.as_of ?? 'NO_INFORMADO_EN_ORIGEN', fechaCalculoUsada: 'NO_APLICA' }
  const sample = universe[0]
  if (sample?.decisionAsOfSource !== 'MANIFIESTO_LOTE' || !sample.decisionAsOf) {
    return { fechaCorte: 'NO_INTEGRADO', fechaCalculoUsada: sample?.decisionAsOf?.valor ?? 'NO_APLICA' }
  }
  return {
    fechaCorte: sample.decisionAsOf.valor ?? absentState(sample.decisionAsOf.estado),
    fechaCalculoUsada: 'NO_APLICA',
  }
}

// Cantidad por clave, en orden estable: el mismo archivo para los mismos datos.
export function tally(entries: readonly (readonly [string, number])[]) {
  const counts = new Map<string, number>()
  for (const [key, count] of entries) counts.set(key, (counts.get(key) ?? 0) + count)
  return [...counts].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
}

export function totalRow(meta: ReportMeta, indicador: string, valor: number, unidad: string, categoria = 'TOTAL'): Record<AggregateColumn, CsvValue> {
  return { ...meta, tipo_fila: 'AGREGADO', indicador, categoria, valor, numerador: 'NO_APLICA', denominador: 'NO_APLICA', unidad, estado: 'OBSERVADO' }
}

export function shareRow(meta: ReportMeta, indicador: string, categoria: string, valor: number, denominador: number, unidad: string): Record<AggregateColumn, CsvValue> {
  return { ...meta, tipo_fila: 'AGREGADO', indicador, categoria, valor, numerador: valor, denominador, unidad, estado: 'OBSERVADO' }
}
