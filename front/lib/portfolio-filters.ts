import { readingFailed } from '@/lib/data-presence'
import { matchesDebtorSearch, NO_QUEUE_PARAM, recommendationQueuesUnknown } from '@/lib/equitas-view-selectors'
import type { DataWarning, DebtorListItem } from '@/types/equitas-domain'

export type PortfolioFilters = { q?: string; risk?: string; type?: string; contact?: string; minAmount?: string; status?: string; personId?: string; queue?: string }
export type PortfolioSearchParams = PortfolioFilters & { page?: string; pageSize?: string }
export type RawPortfolioSearchParams = { [K in keyof PortfolioSearchParams]: string | string[] }
const filterKeys = ['q', 'risk', 'type', 'contact', 'minAmount', 'status', 'personId', 'queue'] as const

// Next entrega un array cuando se repite una clave. Coincide con URLSearchParams.get:
// el primer valor define el filtro, la paginación y los enlaces de regreso.
export function normalizePortfolioSearchParams(params: RawPortfolioSearchParams = {}): PortfolioSearchParams {
  const result: PortfolioSearchParams = {}
  for (const key of [...filterKeys, 'page', 'pageSize'] as const) {
    const value = params[key]
    if (value !== undefined) result[key] = (Array.isArray(value) ? value[0] : value)?.trim()
  }
  return result
}

export function portfolioHref(path: string, filters: RawPortfolioSearchParams, overrides: RawPortfolioSearchParams = {}) {
  const params = new URLSearchParams()
  const values = normalizePortfolioSearchParams({ ...filters, ...overrides })
  for (const key of [...filterKeys, 'page', 'pageSize'] as const) if (values[key]?.trim()) params.set(key, values[key]!.trim())
  return params.size ? `${path}?${params}` : path
}

export function filterPortfolio(debtors: DebtorListItem[], rawFilters: RawPortfolioSearchParams = {}, warnings: DataWarning[] = []) {
  const filters = normalizePortfolioSearchParams(rawFilters)
  const amount = Number(filters.minAmount)
  const invalid = Boolean(filters.minAmount && (!Number.isFinite(amount) || amount < 0))
  const failed = readingFailed(warnings, 'debtor', 'import_batch') ||
    Boolean(filters.q && readingFailed(warnings, 'person', 'debtor_person')) ||
    Boolean(filters.personId && readingFailed(warnings, 'debtor_person')) ||
    Boolean(filters.risk && readingFailed(warnings, 'debt', 'debtor_person')) ||
    Boolean(filters.type && readingFailed(warnings, 'debtor_type')) ||
    Boolean(filters.contact && readingFailed(warnings, 'debtor_contact', 'debtor_person')) ||
    Boolean(filters.status && readingFailed(warnings, 'debt', 'debt_status')) ||
    Boolean(filters.minAmount && readingFailed(warnings, 'debt', 'debtor_profile')) ||
    Boolean(filters.queue && filters.queue !== NO_QUEUE_PARAM && recommendationQueuesUnknown(debtors, warnings))
  const items = debtors.filter(item => !invalid && matchesDebtorSearch(item, filters.q ?? '') &&
    (!filters.risk || item.risk === filters.risk) && (!filters.type || item.type === filters.type) &&
    (!filters.status || item.status === filters.status) && (!filters.personId || item.peopleIds.includes(filters.personId)) &&
    (!filters.contact || (filters.contact === 'with' && item.hasContact === true) || (filters.contact === 'without' && item.hasContact === false)) &&
    (!filters.minAmount || (item.totalDebt !== null && item.totalDebt >= amount)) &&
    (!filters.queue || (filters.queue === NO_QUEUE_PARAM ? !item.decision || recommendationQueuesUnknown(debtors, warnings) : item.decision?.intervencion.codigo === filters.queue)))
  const unknown = debtors.filter(item => (filters.risk && item.risk === null) || (filters.contact && item.hasContact === null) || (filters.minAmount && item.totalDebt === null)).length
  const incompleteEmpty = items.length === 0 && unknown > 0
  // An incomplete filter cannot define an empty population for an aggregate.
  const scopedWarnings = failed || invalid || incompleteEmpty ? [...warnings, { table: 'debtor', message: invalid ? 'Monto mínimo inválido: revise el filtro.' : 'Selección incompleta: faltan datos para evaluar los filtros.', needsSelectPolicy: false }] : unknown ? [...warnings, { table: 'portfolio_filter', message: `${unknown} objetos sin dato para evaluar los filtros; se muestran solo coincidencias observadas.`, needsSelectPolicy: false }] : warnings
  return { items, warnings: scopedWarnings, failed: failed || invalid || incompleteEmpty, invalid }
}
