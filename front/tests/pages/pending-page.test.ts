import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ viewer: vi.fn(), decisions: vi.fn(), debtors: vi.fn() }))
vi.mock('@/lib/server/viewer-context', () => ({ loadViewerContext: session.viewer }))
vi.mock('@/lib/server/recorded-decisions', () => ({ loadRecordedDecisions: session.decisions }))
vi.mock('@/lib/equitas-data', () => ({ getDebtorsData: session.debtors }))
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children }))

import PendingPage from '@/app/pending/page'
import { PENDING_LABELS } from '@/lib/domain/recorded-decision'
import { decisionsFixture, markupOf, recordedDecision, renderedText, viewerFixture } from '@/tests/helpers/viewer-fixtures'

// Noche 7. «Pendientes»: los casos que esperan algo de quien mira, agrupados por lo que tiene que hacer.

const INTENSE = { decision: 'MODIFICA', decidedIntervention: 'INTIMACION_ADMINISTRATIVA', decidedIntensity: 3, status: 'PENDIENTE_APROBACION' } as const
const DEBTORS = [
  { id: '101', identifier: 'OBJ-AJENA' }, { id: '102', identifier: 'OBJ-PROPIA' }, { id: '103', identifier: 'OBJ-OBJETADA' },
  { id: '104', identifier: 'OBJ-ANTERIOR' }, { id: '105', identifier: 'OBJ-REEMPLAZADA' }, { id: '106', identifier: 'OBJ-COMPLETA' },
]

async function page() {
  const node = await PendingPage()
  return { markup: markupOf(node), text: renderedText(node) }
}
const section = (markup: string, kind: string) => markup.match(new RegExp(`<div[^>]*data-pending-section="${kind}"[\\s\\S]*?</table>`))?.[0] ?? ''

beforeEach(() => {
  vi.clearAllMocks()
  session.viewer.mockResolvedValue(viewerFixture('ADMIN'))
  session.debtors.mockResolvedValue({ debtors: DEBTORS, warnings: [] })
  session.decisions.mockResolvedValue(decisionsFixture([
    recordedDecision('101', { ...INTENSE, mine: false, participated: false }),
    recordedDecision('102', { ...INTENSE, mine: true, participated: true }),
    recordedDecision('103', { ...INTENSE, status: 'OBJETADA', mine: true, participated: true }),
    recordedDecision('104', { ...INTENSE, mine: false, participated: false, stale: true, asOf: '2026-08-31' }),
    recordedDecision('105', { ...INTENSE, mine: false, participated: true }),
    // Intensidad 1, propia y al día: completa al registrarse, no espera nada.
    recordedDecision('106'),
  ]))
})

describe('Pendientes para una cuenta ADMIN', () => {
  it('propuesta de otra persona: «Para aprobar u objetar», con enlace a la pestaña Decisión', async () => {
    const { markup, text } = await page()
    const approve = section(markup, 'APPROVE')
    expect(approve).toContain(`${PENDING_LABELS.APPROVE.title} (1)`)
    expect(approve).toMatch(/<a [^>]*href="\/debtors\/101\?tab=revision"[^>]*>OBJ-AJENA<\/a>/)
    expect(approve).toContain('Propuesta pendiente de aprobación')
    expect(approve).toContain('por otra persona')
    expect(text).toContain(PENDING_LABELS.APPROVE.help)
  })

  it('propuesta propia o en la que participó: en espera, y explica que no puede autoaprobarla', async () => {
    const { markup } = await page()
    const waiting = section(markup, 'WAITING_OTHER')
    expect(waiting).toContain(`${PENDING_LABELS.WAITING_OTHER.title} (2)`)
    expect(waiting).toContain('No podés aprobar una propuesta en la que participaste')
    expect(waiting).toContain('OBJ-PROPIA')
    expect(waiting).toContain('por vos')
    // A registró, B reemplazó: a A no se le ofrece aprobar la versión de B.
    expect(waiting).toContain('OBJ-REEMPLAZADA')
    expect(waiting).toContain('por otra persona, sobre una versión tuya')
    expect(section(markup, 'APPROVE')).not.toContain('OBJ-REEMPLAZADA')
  })

  it('propuesta propia objetada y propuesta ajena sobre datos anteriores', async () => {
    const { markup } = await page()
    expect(section(markup, 'OBJECTED')).toContain('OBJ-OBJETADA')
    expect(section(markup, 'OBJECTED')).toContain('Propuesta objetada')
    const old = section(markup, 'OBJECT_ONLY')
    expect(old).toContain('OBJ-ANTERIOR')
    expect(old).toContain('Registrada sobre datos anteriores')
    expect(old).toContain('al 31/8/2026')
    expect(section(markup, 'APPROVE')).not.toContain('OBJ-ANTERIOR')
  })

  it('las secciones siguen el orden acordado y un caso completo no aparece', async () => {
    const { markup, text } = await page()
    const order = [...markup.matchAll(/data-pending-section="([A-Z_]+)"/g)].map(match => match[1])
    expect(order).toEqual(['APPROVE', 'OBJECTED', 'WAITING_OTHER', 'OBJECT_ONLY'])
    expect(text).not.toContain('OBJ-COMPLETA')
    expect(text).not.toContain('No tenés nada pendiente')
    expect(markup).toContain('Intimación')
  })

  it('un caso que no está en la cartera leída se nombra por su número, sin inventar identificador', async () => {
    session.debtors.mockResolvedValue({ debtors: [], warnings: [] })
    expect((await page()).text).toContain('Caso 101')
  })

  it('sin pendientes lo dice y explica cuándo hace falta una aprobación', async () => {
    session.decisions.mockResolvedValue(decisionsFixture([recordedDecision('106')]))
    const { markup, text } = await page()
    expect(text).toContain('No tenés nada pendiente')
    expect(text).toContain('solo las de intensidad 3 o 4 necesitan que otra persona las apruebe')
    expect(markup).not.toContain('data-pending-section')
  })

  it('decisión propia sobre datos anteriores: para revisar', async () => {
    session.decisions.mockResolvedValue(decisionsFixture([recordedDecision('106', { stale: true })]))
    expect(section((await page()).markup, 'REVIEW_AGAIN')).toContain('OBJ-COMPLETA')
  })
})

describe('Pendientes: otros estados', () => {
  it('USER: explica que registrar y aprobar requieren ADMIN y no lista propuestas', async () => {
    session.viewer.mockResolvedValue(viewerFixture('USER'))
    const { markup, text } = await page()
    expect(text).toContain('Tu cuenta no tiene tareas pendientes')
    expect(text).toContain('requieren una cuenta con rol ADMIN. Tu cuenta es Usuario')
    expect(markup).toContain('href="/debtors"')
    expect(markup).not.toContain('data-pending-section')
    expect(text).not.toContain('No tenés nada pendiente')
  })

  it('lectura fallida: lo dice y nunca afirma «sin pendientes»', async () => {
    session.decisions.mockResolvedValue({ ok: false, reason: 'UNAVAILABLE' })
    const { markup, text } = await page()
    expect(text).toContain('No se pudieron leer las decisiones')
    expect(text).toContain('Esto no significa que no haya pendientes.')
    expect(text).not.toContain('No tenés nada pendiente')
    expect(markup).not.toContain('data-pending-section')
  })

  it('sin permiso de lectura no se presenta como una falla ni como «sin pendientes»', async () => {
    session.viewer.mockResolvedValue(viewerFixture('USER'))
    session.decisions.mockResolvedValue({ ok: false, reason: 'FORBIDDEN' })
    const { text } = await page()
    expect(text).not.toContain('No se pudieron leer las decisiones')
    expect(text).not.toContain('No tenés nada pendiente')
  })
})
