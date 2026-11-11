import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getDebtorDetailData: vi.fn(), loadCaseReviewScreen: vi.fn(), loadRecordedDecisions: vi.fn(), loadViewerContext: vi.fn(), auditCaseOpen: vi.fn(),
  recordCaseDecision: vi.fn(), approveCaseDecision: vi.fn(),
}))
vi.mock('@/lib/equitas-data', () => ({ getDebtorDetailData: mocks.getDebtorDetailData }))
vi.mock('@/lib/server/case-review-screen', () => ({ loadCaseReviewScreen: mocks.loadCaseReviewScreen }))
vi.mock('@/lib/server/recorded-decisions', () => ({ loadRecordedDecisions: mocks.loadRecordedDecisions }))
vi.mock('@/lib/server/viewer-context', () => ({ loadViewerContext: mocks.loadViewerContext }))
vi.mock('@/lib/server/audit', () => ({ auditCaseOpen: mocks.auditCaseOpen }))
vi.mock('@/app/debtors/[debtorId]/actions', () => ({ recordCaseDecision: mocks.recordCaseDecision, approveCaseDecision: mocks.approveCaseDecision }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }), usePathname: () => '/debtors/1', notFound: () => { throw new Error('notFound') } }))
vi.mock('next/image', () => ({ default: () => null }))
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children }))

import DebtorDetailPage from '@/app/debtors/[debtorId]/page'
import { WhatsAppDraftPanel } from '@/components/case/whatsapp-draft-panel'
import { buildDebtorDetail } from '@/tests/helpers/equitas-fixtures'
import { decisionInput, decisionsWith, evaluatedDecision, markupOf, nodesOfType, readyScreen, textOf } from '@/tests/helpers/case-page'
import type { DraftContext } from '@/lib/whatsapp/draft'
import type { DataWarning, DebtorDetailData } from '@/types/equitas-domain'

// La ficha con la síntesis económica y el contacto principal arriba (como en main) y el panel
// «Preparar mensaje», también en una base sin el módulo de decisiones (nivel BASE).

const NO_MODULE = { ok: false as const, reason: 'NO_MODULE' as const }

function detail(patch: Partial<DebtorDetailData['debtor']> = {}) {
  const value = buildDebtorDetail()
  const decision = evaluatedDecision()
  value.debtor = { ...value.debtor, decision, decisionInput: decisionInput(), priorityScore: decision.prioridad.valor, decisionAsOf: { estado: 'OBSERVADO', valor: '2026-09-30' }, decisionAsOfSource: 'MANIFIESTO_LOTE', rulesVersion: '1.1.0', ...patch }
  return value
}

async function open(value: DebtorDetailData = detail(), warnings: DataWarning[] = [], search: Record<string, string> = {}) {
  mocks.getDebtorDetailData.mockResolvedValue({ detail: value, warnings })
  const page = await DebtorDetailPage({ params: Promise.resolve({ debtorId: '1' }), searchParams: Promise.resolve(search) })
  const markup = markupOf(page)
  const draft = (nodesOfType(page, WhatsAppDraftPanel)[0]?.props as unknown as { context: DraftContext }).context
  return { page, markup, text: textOf(markup), draft }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.loadCaseReviewScreen.mockResolvedValue(readyScreen())
  mocks.loadRecordedDecisions.mockResolvedValue(decisionsWith())
  mocks.loadViewerContext.mockResolvedValue(null)
  mocks.auditCaseOpen.mockResolvedValue(undefined)
})

describe('síntesis del caso', () => {
  it('deuda pendiente, vencida, atraso y contacto principal arriba de las pestañas, con enlace a contactos', async () => {
    const { markup, text } = await open(detail(), [], { q: 'OBJ' })
    const snapshot = textOf(markup.match(/<section aria-label="Síntesis del caso"[\s\S]*?<\/section>/)?.[0] ?? '')
    expect(snapshot).toMatch(/^Deuda pendiente .+ Deuda vencida .+ Atraso máximo .+ Contacto principal Telefono · 3415550000 Ver personas y contactos$/)
    expect(markup).toMatch(/href="\/debtors\/1\?q=OBJ&amp;tab=personas"/)
    expect(text.indexOf('Síntesis')).toBeLessThan(0)
    expect(text.indexOf('Contacto principal')).toBeLessThan(text.indexOf('Resumen Obligaciones'))
  })

  it('contactos ilegibles: no dice «sin contacto»; varios activos: cuántos más hay', async () => {
    const failed = await open(detail(), [{ table: 'debtor_contact', message: 'falló', needsSelectPolicy: false }])
    expect(failed.text).toContain('Contacto principal No disponible: no se pudieron leer los contactos')
    expect(failed.draft.contactsReadFailed).toBe(true)
    const many = detail()
    many.contacts = [...many.contacts, { ...many.contacts[0], id: 'contact-2', value: '3415550001' }, { ...many.contacts[0], id: 'contact-3', value: '3415550002', isActive: false }]
    expect((await open(many)).text).toContain('Ver 1 contacto más')
    const none = detail()
    none.contacts = []
    expect((await open(none)).text).toContain('Contacto principal Sin contacto activo cargado')
  })

  it('el enlace a contactos abre esa pestaña', async () => {
    const { markup } = await open(detail(), [], { tab: 'personas' })
    expect(markup).toMatch(/aria-selected="true"[^>]*>Personas y contactos/)
  })
})

describe('«Preparar mensaje» en la ficha', () => {
  it('con decisiones: el panel recibe la recomendación y la fecha de corte del caso', async () => {
    const { text, draft } = await open()
    expect(text).toContain('Preparar mensaje')
    expect(draft.basis.source).toBe('RECOMMENDATION')
    expect(draft.templateId).toBe('MSG-RECORDATORIO-v1')
    expect(draft.initialText).toContain('al 30/9/2026')
    expect(draft.recipients).toHaveLength(1)
  })

  it('nivel BASE: sin decisiones ni escrituras; sin fecha de corte acreditada, no se inventa la fecha', async () => {
    mocks.loadRecordedDecisions.mockResolvedValue(NO_MODULE)
    const { text, draft } = await open(detail({ decisionAsOfSource: 'FECHA_CALCULO', decisionAsOf: { estado: 'OBSERVADO', valor: '2026-11-11' } }))
    expect(draft.moduleMissing).toBe(true)
    expect(draft.portfolioAsOf).toBeNull()
    expect(draft.initialText).toContain('[fecha de los registros]')
    expect(draft.basis.note).toContain('no registra ninguna decisión ni aprobación')
    expect(mocks.loadCaseReviewScreen).not.toHaveBeenCalled()
    expect(mocks.recordCaseDecision).not.toHaveBeenCalled()
    expect(mocks.approveCaseDecision).not.toHaveBeenCalled()
    expect(text).toContain('No disponible en esta base')
  })

  it('caso sin recomendación evaluable: el panel lo explica en lugar de armar un texto', async () => {
    const { draft } = await open(detail({ decision: undefined, priorityScore: null }))
    expect(draft.caseImpediments.map(item => item.code)).toEqual(['NO_RECOMMENDATION'])
    expect(draft.initialText).toBe('')
  })
})
