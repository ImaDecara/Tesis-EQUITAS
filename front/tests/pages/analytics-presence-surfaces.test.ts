import type { ReactNode } from 'react'
import { markupOf, panelOf, textOf } from '@/tests/helpers/case-page'
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
  // Se ejecutan los componentes de la ficha, incluido el panel de Decisión (keepMounted).
  const page = await DebtorDetailPage({ params: Promise.resolve({ debtorId: '901' }) })
  const text = textOf(markupOf(page)).replace(/\u00a0/g, ' ')
  expect(JSON.stringify(source)).toBe(before)
  // Noche 7: los hechos del caso (totales y atraso) están en «Resumen»; la pestaña Decisión ya no los repite.
  const summary = panelOf(page, 'summary').text.replace(/\u00a0/g, ' ')
  const review = panelOf(page, 'review').text.replace(/\u00a0/g, ' ')
  expect(summary).toContain('Totales del caso')
  return { text, summary, review }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-06T12:00:00Z'))
})
afterEach(() => { vi.useRealTimers() })

describe('MEN-3: panel real de Revisión sin snapshot', () => {
  const screenFor = (role: 'ADMIN' | 'USER') => ({ kind: 'ready', capabilities: { canRecord: role === 'ADMIN', canApprove: role === 'ADMIN', canReadReasonText: role === 'ADMIN' }, snapshot: caseReviewFailure('CUTOFF_NOT_AVAILABLE'), history: { ok: true, entries: [] } })

  it.each(['USER', 'ADMIN'] as const)('%s conserva la mora de la ficha calculada y no la histórica', async role => {
    api.screen.mockResolvedValue(screenFor(role))
    // Estado OVERDUE: la mora calculada (310 000) no es la del perfil persistido (0).
    const raw = fixture(); delete raw.batch; raw.debts[0].status = 2
    const { summary, review } = await renderDetail(raw)
    expect(summary).toContain('Deuda vencida Pendientes con importe mayor que cero y vencimiento anterior a la fecha de la cartera. 1 obligación por $ 310.000')
    expect(summary).toContain('Atraso máximo 189 días')
    expect(summary).not.toContain('$ 0')
    // La pestaña Decisión ya no repite los hechos: dice que sin cartera vigente no hay recomendación a revisar.
    expect(review).toContain('Recomendación automática no disponible')
    expect(review).not.toContain('Deuda vencida')
  })

  it.each(['USER', 'ADMIN'] as const)('%s: reglas 1.1.0, la obligación pagada no es mora aunque su vencimiento pasó', async role => {
    api.screen.mockResolvedValue(screenFor(role))
    const raw = fixture(); delete raw.batch
    const { summary, review } = await renderDetail(raw)
    expect(summary).toContain('Total registrado Todas las obligaciones, cualquiera sea su estado. $ 310.000')
    expect(summary).toContain('Deuda pendiente El total registrado sin las obligaciones pagadas. $ 0')
    expect(summary).toContain('Deuda vencida Pendientes con importe mayor que cero y vencimiento anterior a la fecha de la cartera. Sin obligaciones vencidas')
    expect(summary).toContain('Atraso máximo No aplica: no hay obligaciones vencidas')
    expect(review).not.toContain('Deuda vencida')
    expect(mapDebtorObjectsFromRawData(raw).debtors[0].metrics?.maxDaysOverdue.presence).toBe('NO_APLICA')
  })

  it.each(['CUTOFF_NOT_AVAILABLE', 'SUGGESTION_UNAVAILABLE'] as const)('%s no presenta saldo histórico como mora evaluable', async code => {
    api.screen.mockResolvedValue({ kind: 'ready', capabilities: { canRecord: true, canApprove: true, canReadReasonText: true }, snapshot: caseReviewFailure(code), history: { ok: true, entries: [] } })
    const raw = fixture(); raw.batch = { as_of: null }
    raw.debtorProfiles[0].overdue_debt_amount = 310000
    raw.warnings = [{ table: 'import_batch', code, message: 'Corte no disponible', needsSelectPolicy: false }]
    const { text, summary, review } = await renderDetail(raw)
    expect(summary).toContain('Deuda vencida Pendientes con importe mayor que cero y vencimiento anterior a la fecha de la cartera. No disponible')
    expect(summary).not.toContain('obligación por $')
    expect(review).toContain('Recomendación automática no disponible')
    expect(review).not.toContain('Deuda vencida $')
    expect(text).not.toContain('Casos vencidos:')
  })
})

describe('MEN-3: presencia de KPI-02/03 en CSV de calidad, oráculo manual', () => {
  // Columna de estado: 2 = OVERDUE, 3 = PAID. Reglas 1.1.0: la pagada sale de la mora (cero completo, sin atraso).
  const cases = [
    ['vencida no pagada', '2026-05-01', 2, false, 'OBSERVADO', 'OBSERVADO'],
    ['vencimiento pasado con catálogo PAID', '2026-05-01', 3, false, 'OBSERVADO', 'NO_APLICA'],
    ['vencimiento ausente', null, 2, false, 'NO_INFORMADO_EN_ORIGEN', 'NO_INFORMADO_EN_ORIGEN'],
    ['parcial con otra obligación sin fecha', '2026-05-01', 2, true, 'OBSERVADO_PARCIAL', 'OBSERVADO_PARCIAL'],
    ['vigente por calendario', '2027-01-01', 3, false, 'OBSERVADO', 'NO_APLICA'],
  ] as const
  it.each(cases)('%s', (_name, due, status, partial, overdueState, daysState) => {
    const raw = fixture(); raw.debts[0].due_date = due; raw.debts[0].status = status
    if (due === null) raw.debtorProfiles[0].overdue_debt_amount = 310000
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
