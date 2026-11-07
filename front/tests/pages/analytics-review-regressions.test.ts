import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPresenceRawData, buildPresencePeopleData } from '@/tests/helpers/equitas-fixtures'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { mapPeopleFromRawData } from '@/lib/mappers/person-risk-mapper'
import { mapDashboardMetricsFromDebtorObjects } from '@/lib/mappers/dashboard-metrics-mapper'
import { getDebtorDetailDataFromService } from '@/lib/services/debtor-data-service'
import { filterPortfolio, portfolioHref } from '@/lib/portfolio-filters'
import { buildQueueReport } from '@/lib/reports/queue-report'
import { csvCents, parseCsvBytes } from '@/tests/helpers/independent-csv-parser'
import { textFromReactTree } from '@/tests/helpers/react-tree'
import type { RawDebtorDataBundle } from '@/types/equitas-domain'

const api = vi.hoisted(() => ({ getDebtorsData: vi.fn(), getPeopleData: vi.fn(), getDashboardData: vi.fn(), getDebtorDetailData: vi.fn(), loadRawDebtorData: vi.fn() }))
vi.mock('@/lib/equitas-data', () => api)
vi.mock('@/lib/data/raw-debtor-loader', () => ({ loadRawDebtorData: api.loadRawDebtorData }))
vi.mock('@/lib/server/contact-type-catalog', () => ({ loadContactTypeCatalog: async () => ({ rows: [], warning: null }) }))
vi.mock('@/lib/server/case-review-screen', () => ({ loadCaseReviewScreen: async () => ({ kind: 'restricted', message: 'Fuera de esta prueba' }) }))
vi.mock('@/lib/server/audit', () => ({ auditCaseOpen: async () => undefined }))
vi.mock('next/navigation', () => ({ usePathname: () => '/debtors', useRouter: () => ({ replace: vi.fn() }), notFound: () => { throw new Error('notFound') } }))
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children }))

import HomePage from '@/app/page'
import RiskAnalysisPage from '@/app/risk-analysis/page'
import DebtAgingPage from '@/app/debt-aging/page'
import NoContactPage from '@/app/no-contact/page'
import RecommendedActionsPage from '@/app/recommended-actions/page'
import DebtorsPage from '@/app/debtors/page'
import PriorityCasesPage from '@/app/priority-cases/page'
import DebtorDetailPage from '@/app/debtors/[debtorId]/page'

const pages = [['/', HomePage], ['/risk-analysis', RiskAnalysisPage], ['/debt-aging', DebtAgingPage], ['/no-contact', NoContactPage], ['/recommended-actions', RecommendedActionsPage], ['/debtors', DebtorsPage], ['/priority-cases', PriorityCasesPage]] as const
const html = (node: ReactNode) => renderToStaticMarkup(createElement(Fragment, null, node))
const text = (node: ReactNode) => textFromReactTree(node).replace(/\s+/g, ' ')

function fixture() {
  const raw = buildPresenceRawData()
  raw.batch = { as_of: '2026-10-31' }
  raw.debtors[0].identifier = 'TP-MORA-901'
  Object.assign(raw.debts[0], { current_amount: 310000, updated_amount: 310000, due_date: '2026-05-01', status: 3 })
  raw.debtorProfiles = [{ debtor: 901, total_debt_amount: 310000, overdue_debt_amount: 0 }]
  raw.debtorContacts = []
  raw.debtStatuses.push({ id: 4, key: 'ACTIVE', value: 'Vigente' })
  return raw
}

async function configure(raw: RawDebtorDataBundle = fixture()) {
  const mapped = mapDebtorObjectsFromRawData(raw)
  api.getDebtorsData.mockResolvedValue({ ...mapped, batch: raw.batch })
  api.getDashboardData.mockImplementation(async filters => {
    const selection = filterPortfolio(mapped.debtors, filters, raw.warnings)
    return { dashboard: mapDashboardMetricsFromDebtorObjects({ ...mapped, debtors: selection.items, warnings: selection.warnings }), warnings: selection.warnings }
  })
  const people = mapPeopleFromRawData(buildPresencePeopleData())
  api.getPeopleData.mockResolvedValue({ people: people.people, peopleDashboard: people.dashboard, warnings: [] })
  api.loadRawDebtorData.mockResolvedValue(raw)
  api.getDebtorDetailData.mockResolvedValue(await getDebtorDetailDataFromService('901'))
  return mapped
}

beforeEach(async () => { vi.clearAllMocks(); await configure() })

describe('ALIGN-014 MEN-2: parámetros repetidos', () => {
  it.each(pages)('%s usa el primer valor como URLSearchParams.get y conserva navegación', async (_path, page) => {
    const first = { q: 'TP-MORA', type: 'AGUA', page: '1', pageSize: '10' }
    const repeated = { q: ['TP-MORA', 'NO-COINCIDE'], type: ['AGUA', 'NO-COINCIDE'], page: ['1', '2'], pageSize: ['10', '20'] }
    const expected = html(await page({ searchParams: Promise.resolve(first) }))
    expect(html(await page({ searchParams: Promise.resolve(repeated) }))).toBe(expected)
  })

  it('normaliza también los puntos de entrada de filtrado y enlaces, sin unir valores', async () => {
    const mapped = await configure()
    const repeated = { q: ['TP-MORA', 'NO-COINCIDE'], contact: ['without', 'with'], minAmount: ['310000', '999999'], queue: [] }
    expect(filterPortfolio(mapped.debtors, repeated).items.map(item => item.id)).toEqual(['901'])
    const href = new URL(portfolioHref('/debtors', repeated, { page: ['2', '3'] }), 'http://test.local')
    expect(Object.fromEntries(href.searchParams)).toEqual({ q: 'TP-MORA', contact: 'without', minAmount: '310000', page: '2' })
  })

  it('el detalle normaliza filtros y pestaña antes de construir el regreso', async () => {
    const ordinary = await DebtorDetailPage({ params: Promise.resolve({ debtorId: '901' }), searchParams: Promise.resolve({ q: 'TP-MORA', tab: 'summary' }) })
    const repeated = await DebtorDetailPage({ params: Promise.resolve({ debtorId: '901' }), searchParams: Promise.resolve({ q: ['TP-MORA', 'NO-COINCIDE'], tab: ['summary', 'revision'] }) })
    expect(html(repeated)).toBe(html(ordinary))
  })
})

describe('ALIGN-014 MEN-3: mora al mismo corte en ficha, listados y CSV', () => {
  it.each([3, 2, 8, 4])('no sustituye calendario por el estado histórico %s ni por el perfil con cero', async status => {
    const raw = fixture(); raw.debts[0].status = status
    const mapped = await configure(raw)
    const csv = parseCsvBytes(new TextEncoder().encode(buildQueueReport(mapped.debtors, {}, '2026-11-06T00:00:00Z', { showIdentifier: true }, raw.batch)))
    const row = csv.rows.find(item => item.tipo_fila === 'DETALLE')!
    // Oráculo manual: 31/10 - 1/5 = 183 días; un importe positivo de 310.000.
    expect(csvCents(row.deuda_vencida_ars)).toBe(31000000)
    expect(row.dias_atraso_max).toBe('183')
    for (const page of [DebtAgingPage, PriorityCasesPage, NoContactPage]) {
      expect(text(await page({ searchParams: Promise.resolve({}) }))).toContain('183 dias')
    }
    const detail = text(await DebtorDetailPage({ params: Promise.resolve({ debtorId: '901' }) }))
    expect(detail).toMatch(/Deuda vencida(?: al corte)?: \$\s?310\.000/)
    expect(detail).toContain('183 dias')
    expect(detail).not.toMatch(/Deuda vencida(?: al corte)?\s*:?[\s]*\$\s?0(?:\s|,)/)
    expect(detail).toContain('1 obligación vencida')
  })

  it('si el corte no es evaluable no muestra mora histórica como si fuera actual', async () => {
    const raw = fixture(); raw.batch = { as_of: null }
    raw.debtorProfiles[0].overdue_debt_amount = 310000
    await configure(raw)
    const detail = text(await DebtorDetailPage({ params: Promise.resolve({ debtorId: '901' }) }))
    expect(detail).toMatch(/Deuda vencida(?: al corte)?: No disponible/)
    expect(detail).not.toContain('183 dias')
  })
})
