import { sumMoney, metric, unavailable } from '@/lib/data-presence'
import { RULES_VERSION } from '@/lib/domain/decision-rules-v1'
import { buildDebtAgingSummary, getPriorityCases, matchesDebtorSearch } from '@/lib/equitas-view-selectors'
import { serializeCsv, type CsvValue } from '@/lib/reports/csv'
import { absentState, definitionsLink, describeFilters, META_COLUMNS, numericCell, portfolioCutoff, readParams, ReportFilterError } from '@/lib/reports/report-format'
import type { DataPresence, DebtorListItem, NumericData } from '@/types/equitas-domain'

// ALIGN-028. Cola de trabajo: las mismas filas, el mismo orden y los mismos filtros de
// /priority-cases, completas. Sin personas, contactos ni descripcion, para ningun rol.
// El identificador de origen es texto libre: solo lo reciben quienes gestionan (permiso en la DAL).
const COLUMNS = [
  ...META_COLUMNS,
  'posicion', 'objeto_id', 'identificador', 'tipo', 'intervencion_codigo', 'intervencion', 'intensidad', 'revision_requerida',
  'severidad_puntos', 'severidad_banda', 'severidad_estado', 'prioridad_puntos',
  'deuda_total_ars', 'deuda_vencida_ars', 'monto_evaluable_ars', 'dias_atraso_max',
  'obligaciones', 'contactos_disponibles', 'con_contacto', 'banderas', 'fecha_calculo_usada', 'objetos', 'faltantes',
] as const
type Column = (typeof COLUMNS)[number]

const RISKS = ['ALTO', 'MEDIO', 'BAJO'] as const
const CONTACTS = ['with', 'without'] as const
const MAX_FILTER_LENGTH = 200
const NOT_APPLICABLE = 'NO_APLICA'
const MISSING_IN_SOURCE = 'NO_INFORMADO_EN_ORIGEN'
const OMITTED_BY_ROLE = 'OMITIDO_POR_ROL'
const VALUE_NOT_CATALOGUED = 'VALOR_NO_CATALOGADO'

export type QueueAccess = { showIdentifier: boolean }

export type QueueFilters = { q?: string; risk?: string; contact?: string; type?: string; minAmount?: string }

export function parseQueueFilters(params: URLSearchParams): QueueFilters {
  const filters = readParams(params, ['q', 'risk', 'contact', 'type', 'minAmount'], ['page', 'pageSize'])
  for (const [name, value] of Object.entries(filters)) {
    if (value.length > MAX_FILTER_LENGTH) throw new ReportFilterError(name)
  }
  if (filters.risk && !(RISKS as readonly string[]).includes(filters.risk)) throw new ReportFilterError('risk')
  if (filters.contact && !(CONTACTS as readonly string[]).includes(filters.contact)) throw new ReportFilterError('contact')
  if (filters.minAmount && !Number.isFinite(Number(filters.minAmount))) throw new ReportFilterError('minAmount')
  return filters
}

// Misma condicion que la pantalla (`app/priority-cases/page.tsx`). La prueba de conciliacion
// llama a esa pagina con los mismos filtros, asi una diferencia no pasa desapercibida.
export function filterQueueCases(debtors: DebtorListItem[], filters: QueueFilters) {
  const minAmount = Number(filters.minAmount)
  return getPriorityCases(debtors).filter(debtor =>
    (!filters.risk || debtor.risk === filters.risk) &&
    (!filters.contact || (filters.contact === 'with' ? debtor.hasContact === true : debtor.hasContact === false)) &&
    (!filters.type || debtor.type === filters.type) &&
    (!filters.minAmount || (debtor.totalDebt !== null && debtor.totalDebt >= minAmount)) &&
    matchesDebtorSearch(debtor, filters.q ?? ''))
}

// Lo que escribio la persona puede ser un nombre: filtra, pero no queda en el archivo. Un tipo
// solo se copia si es una etiqueta del catalogo leido; `risk` y `contact` ya son listas cerradas.
function filtersLabel({ q, type, ...exact }: QueueFilters, universe: readonly DebtorListItem[]) {
  return describeFilters({
    ...exact,
    q: q ? 'TEXTO_OMITIDO' : undefined,
    type: type && (universe.some(debtor => debtor.type === type) ? type : VALUE_NOT_CATALOGUED),
  })
}

// Igual que el monto de cola de `buildRecommendationSummary` (KPI-V1-05).
function evaluableAmount(debtor: DebtorListItem): NumericData {
  const presence = metric(debtor, 'priorityScore')
  return debtor.decision
    ? { ...presence, value: debtor.decision.severidad.monto_actualizado_ars }
    : unavailable(absentState(presence.presence))
}

function missingLabel(entries: Readonly<Record<string, NumericData>>) {
  const parts = Object.entries(entries).flatMap(([column, data]) =>
    (Object.entries(data.missing) as [DataPresence, number][]).map(([state, count]) => `${column}:${state}=${count}`))
  return parts.length ? parts.join('|') : 'NINGUNO'
}

function identifierCell(debtor: DebtorListItem, access: QueueAccess) {
  if (!access.showIdentifier) return OMITTED_BY_ROLE
  return debtor.identifier === `OBJ-${debtor.id}` ? MISSING_IN_SOURCE : debtor.identifier
}

function rowValues(debtor: DebtorListItem, position: number, access: QueueAccess) {
  const decision = debtor.decision
  const state = absentState(metric(debtor, 'priorityScore').presence)
  const amounts = { deuda_total_ars: metric(debtor, 'totalDebt'), deuda_vencida_ars: metric(debtor, 'overdueDebt'), monto_evaluable_ars: evaluableAmount(debtor) }
  return {
    tipo_fila: 'DETALLE',
    posicion: position,
    objeto_id: debtor.id,
    // Contrato OB03 y OB04: el mapeador conserva rotulos de respaldo; el archivo declara la ausencia.
    identificador: identifierCell(debtor, access),
    tipo: debtor.type === 'Sin tipo' ? MISSING_IN_SOURCE : debtor.type,
    intervencion_codigo: decision?.intervencion.codigo ?? state,
    intervencion: decision ? debtor.recommendationType : state,
    intensidad: decision?.intervencion.intensidad ?? state,
    revision_requerida: decision ? debtor.isUrgentRecommendation : state,
    severidad_puntos: numericCell(metric(debtor, 'riskScore')),
    severidad_banda: decision?.severidad.banda ?? state,
    severidad_estado: decision?.severidad.estado ?? state,
    prioridad_puntos: numericCell(metric(debtor, 'priorityScore')),
    deuda_total_ars: numericCell(amounts.deuda_total_ars),
    deuda_vencida_ars: numericCell(amounts.deuda_vencida_ars),
    monto_evaluable_ars: numericCell(amounts.monto_evaluable_ars),
    dias_atraso_max: numericCell(metric(debtor, 'maxDaysOverdue')),
    obligaciones: debtor.debtCount ?? 'NO_INTEGRADO',
    contactos_disponibles: numericCell(metric(debtor, 'contactCount')),
    con_contacto: debtor.hasContact ?? 'NO_INTEGRADO',
    banderas: decision ? decision.banderas.join('|') || 'SIN_BANDERAS' : state,
    objetos: 1,
    faltantes: missingLabel(amounts),
  } satisfies Partial<Record<Column, CsvValue>>
}

// Sin indicar el acceso, el identificador no sale.
export function buildQueueReport(universe: DebtorListItem[], filters: QueueFilters, generatedAt: string, access: QueueAccess = { showIdentifier: false }) {
  const cases = filterQueueCases(universe, filters)
  const { fechaCorte, fechaCalculoUsada } = portfolioCutoff(universe)
  const meta = {
    fecha_corte: fechaCorte,
    version_reglas: RULES_VERSION,
    filtros: filtersLabel(filters, universe),
    generado_en: generatedAt,
    definiciones: definitionsLink('reporte-cola'),
    fecha_calculo_usada: fechaCalculoUsada,
  }
  // Los totales salen del selector de /debt-aging: la misma suma con los mismos faltantes.
  const { metrics, cases: analyticalCases } = buildDebtAgingSummary(cases)
  const evaluable = sumMoney(cases.map(evaluableAmount))
  const total: Record<Column, CsvValue> = {
    ...meta,
    tipo_fila: 'TOTAL',
    posicion: NOT_APPLICABLE, objeto_id: NOT_APPLICABLE, identificador: NOT_APPLICABLE, tipo: NOT_APPLICABLE,
    intervencion_codigo: NOT_APPLICABLE, intervencion: NOT_APPLICABLE, intensidad: NOT_APPLICABLE, revision_requerida: NOT_APPLICABLE,
    severidad_puntos: NOT_APPLICABLE, severidad_banda: NOT_APPLICABLE, severidad_estado: NOT_APPLICABLE, prioridad_puntos: NOT_APPLICABLE,
    deuda_total_ars: numericCell(metrics.totalDebt),
    deuda_vencida_ars: numericCell(metrics.overdueDebt),
    monto_evaluable_ars: numericCell(evaluable),
    dias_atraso_max: NOT_APPLICABLE,
    obligaciones: cases.reduce((sum, debtor) => sum + (debtor.debtCount ?? 0), 0),
    // Una persona con varios objetos contaria sus contactos varias veces: no se suman.
    contactos_disponibles: NOT_APPLICABLE, con_contacto: NOT_APPLICABLE, banderas: NOT_APPLICABLE,
    objetos: cases.length,
    faltantes: missingLabel({ deuda_total_ars: metrics.totalDebt, deuda_vencida_ars: metrics.overdueDebt, monto_evaluable_ars: evaluable }),
  }
  return serializeCsv(COLUMNS, [...analyticalCases.map((debtor, index) => ({ ...meta, ...rowValues(debtor, index + 1, access) })), total])
}
