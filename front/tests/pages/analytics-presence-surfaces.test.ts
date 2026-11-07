import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPresenceRawData } from '@/tests/helpers/equitas-fixtures'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { getDebtorDetailDataFromService } from '@/lib/services/debtor-data-service'
import { buildDataQualityReport } from '@/lib/reports/data-quality-report'
import { caseReviewFailure } from '@/lib/domain/case-review-contract'
import { parseCsvBytes } from '@/tests/helpers/independent-csv-parser'
import type { RawDebtorDataBundle } from '@/types/equitas-domain'

const api = vi.hoisted(() => ({ detail: vi.fn(), raw: vi.fn(), screen: vi.fn() }))
vi.mock('@/lib/equitas-data', () => ({ getDebtorDetailData: api.detail }))
vi.mock('@/lib/data/raw-debtor-loader', () => ({ loadRawDebtorData: api.raw }))
vi.mock('@/lib/server/contact-type-catalog', () => ({ loadContactTypeCatalog: async () => ({ rows: [], warning: null }) }))
vi.mock('@/lib/server/case-review-screen', () => ({ loadCaseReviewScreen: api.screen }))
vi.mock('@/lib/server/audit', () => ({ auditCaseOpen: async () => undefined }))
vi.mock('next/navigation', () => ({ usePathname: () => '/debtors', useRouter: () => ({ replace: vi.fn() }), notFound: () => { throw new Error('notFound') } }))
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children }))

import DebtorDetailPage from '@/app/debtors/[debtorId]/page'

function fixture() {
  const raw = buildPresenceRawData()
  raw.batch = { as_of: '2026-10-31' }
  Object.assign(raw.debts[0], { current_amount: 310000, updated_amount: 310000, due_date: '2026-05-01', status: 3 })
  raw.debtorProfiles = [{ debtor: 901, total_debt_amount: 310000, overdue_debt_amount: 0 }]
  return raw
}

async function renderDetail(raw: RawDebtorDataBundle) {
  api.raw.mockResolvedValue(raw)
  const source = await getDebtorDetailDataFromService('901')
  const before = JSON.stringify(source)
  api.detail.mockResolvedValue(source)
  // Se ejecutan ReviewPanel y sus componentes, incluido el contenido keepMounted.
  const page = await DebtorDetailPage({ params: Promise.resolve({ debtorId: '901' }) })
  const markup = renderToStaticMarkup(createElement(Fragment, null, page))
  expect(JSON.stringify(source)).toBe(before)
  const text = markup.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|\u00a0/g, ' ').replace(/\s+/g, ' ')
  const start = text.indexOf('Hechos del caso')
  expect(start).toBeGreaterThan(-1)
  return { text, review: text.slice(start, text.indexOf('Banderas', start)) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-06T12:00:00Z'))
})
afterEach(() => { vi.useRealTimers() })

describe('MEN-3: panel real de Revisión sin snapshot', () => {
  it.each(['consulta', 'operador'])('%s conserva la mora de la ficha calculada y no la histórica', async role => {
    api.screen.mockResolvedValue({ kind: 'ready', capabilities: { canRecord: role === 'operador', canApprove: false, canReadReasonText: false }, snapshot: caseReviewFailure('CUTOFF_NOT_AVAILABLE'), history: { ok: true, entries: [] } })
    const raw = fixture(); delete raw.batch
    const { text, review } = await renderDetail(raw)
    expect(text).toContain('Deuda vencida al corte: $ 310.000')
    expect(review).toContain('Deuda vencida $ 310.000')
    expect(review).toContain('Corte: no disponible')
    expect(text).toContain('189 dias')
  })

  it.each(['CUTOFF_NOT_AVAILABLE', 'SUGGESTION_UNAVAILABLE'] as const)('%s no presenta saldo histórico como mora evaluable', async code => {
    api.screen.mockResolvedValue({ kind: 'ready', capabilities: { canRecord: true, canApprove: true, canReadReasonText: true }, snapshot: caseReviewFailure(code), history: { ok: true, entries: [] } })
    const raw = fixture(); raw.batch = { as_of: null }
    raw.debtorProfiles[0].overdue_debt_amount = 310000
    raw.warnings = [{ table: 'import_batch', code, message: 'Corte no disponible', needsSelectPolicy: false }]
    const { text, review } = await renderDetail(raw)
    expect(text).toContain('Deuda vencida al corte: No disponible')
    expect(review).toContain('Deuda vencida No disponible')
    expect(review).not.toContain('Deuda vencida $')
    expect(text).not.toContain('Casos vencidos:')
  })
})

describe('MEN-3: presencia de KPI-02/03 en CSV de calidad, oráculo manual', () => {
  const cases = [
    ['vencida con catálogo PAID', '2026-05-01', false, 'OBSERVADO', 'OBSERVADO'],
    ['vencimiento ausente', null, false, 'NO_INFORMADO_EN_ORIGEN', 'NO_INFORMADO_EN_ORIGEN'],
    ['parcial con otra obligación sin fecha', '2026-05-01', true, 'OBSERVADO_PARCIAL', 'OBSERVADO_PARCIAL'],
    ['vigente por calendario', '2027-01-01', false, 'OBSERVADO', 'NO_APLICA'],
  ] as const
  it.each(cases)('%s', (_name, due, partial, overdueState, daysState) => {
    const raw = fixture(); raw.debts[0].due_date = due
    if (due === null) { raw.debts[0].status = 2; raw.debtorProfiles[0].overdue_debt_amount = 310000 }
    if (partial) raw.debts.push({ ...raw.debts[0], id: 802, current_amount: 50000, due_date: null })
    const { debtors } = mapDebtorObjectsFromRawData(raw)
    const before = JSON.stringify(debtors)
    const csv = parseCsvBytes(new TextEncoder().encode(buildDataQualityReport(debtors, '2026-11-06T12:00:00Z', raw.batch)))
    for (const [indicator, state] of [['presencia_deuda_vencida', overdueState], ['presencia_atraso', daysState]]) {
      const rows = csv.rows.filter(row => row.indicador === indicator)
      expect(rows.filter(row => row.valor !== '0').map(row => [row.categoria, row.valor, row.denominador])).toEqual([[state, '1', '1']])
      expect(rows.reduce((total, row) => total + Number(row.valor), 0)).toBe(1)
    }
    expect(JSON.stringify(debtors)).toBe(before)
  })
})
