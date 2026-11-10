import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import smallCases from '../../../contracts/portfolio-small-cases.v1.json'

const { getDebtorDetailData, loadCaseReviewScreen, loadRecordedDecisions, loadViewerContext, auditCaseOpen } = vi.hoisted(() => ({
  getDebtorDetailData: vi.fn(), loadCaseReviewScreen: vi.fn(), loadRecordedDecisions: vi.fn(), loadViewerContext: vi.fn(), auditCaseOpen: vi.fn(),
}))
vi.mock('@/lib/equitas-data', () => ({ getDebtorDetailData }))
vi.mock('@/lib/server/case-review-screen', () => ({ loadCaseReviewScreen }))
vi.mock('@/lib/server/recorded-decisions', () => ({ loadRecordedDecisions }))
vi.mock('@/lib/server/viewer-context', () => ({ loadViewerContext }))
vi.mock('@/lib/server/audit', () => ({ auditCaseOpen }))
vi.mock('@/app/debtors/[debtorId]/actions', () => ({ recordCaseDecision: vi.fn(), approveCaseDecision: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }), usePathname: () => '/debtors/1', notFound: () => { throw new Error('notFound') } }))
vi.mock('next/image', () => ({ default: () => null }))
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children }))

import DebtorDetailPage from '@/app/debtors/[debtorId]/page'
import { breakdownTotal, explanationOfDecision, joinList, recordedDecisionText, splitFlags } from '@/components/case/case-explanation'
import { recordedDecisionView } from '@/components/case/recorded-decision-summary'
import { overdueStatus } from '@/components/debtors/debts-table'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { buildDebtorDetail } from '@/tests/helpers/equitas-fixtures'
import {
  decisionInput, decisionsWith, evaluatedDecision, markupOf, panelOf, readyScreen, recordedDecision, textOf,
} from '@/tests/helpers/case-page'
import type { DataWarning, DebtorDetailData, RawDebtorDataBundle } from '@/types/equitas-domain'

// Noche 7. Lo que una persona entiende al abrir un caso, sin cambiar de pestaña: encabezado
// (puntaje, grupo, recomendación automática y decisión registrada) y la pestaña «Resumen».

async function open(detail: DebtorDetailData | null = buildDebtorDetail(), warnings: DataWarning[] = []) {
  getDebtorDetailData.mockResolvedValue({ detail, warnings })
  const page = await DebtorDetailPage({ params: Promise.resolve({ debtorId: '1' }), searchParams: Promise.resolve({}) })
  const whole = textOf(markupOf(page))
  const header = whole.slice(0, whole.indexOf('Resumen Obligaciones'))
  return { page, whole, header, summary: panelOf(page, 'summary').text, debts: panelOf(page, 'debts').text }
}

const withDecision = (decision = evaluatedDecision(), patch: Partial<DebtorDetailData['debtor']> = {}) => {
  const detail = buildDebtorDetail()
  detail.debtor = { ...detail.debtor, decision, decisionInput: decisionInput(), priorityScore: decision.prioridad.valor, priorityLevel: decision.severidad.banda as never, decisionAsOf: { estado: 'OBSERVADO', valor: '2026-09-30' }, decisionAsOfSource: 'MANIFIESTO_LOTE', rulesVersion: '1.1.0', ...patch }
  return detail
}

beforeEach(() => {
  vi.clearAllMocks()
  loadCaseReviewScreen.mockResolvedValue(readyScreen())
  loadRecordedDecisions.mockResolvedValue(decisionsWith())
  loadViewerContext.mockResolvedValue(null)
  auditCaseOpen.mockResolvedValue(undefined)
})

describe('encabezado: decisión registrada', () => {
  it('vigente: acción, quién, cuándo (hora local) y estado', async () => {
    loadRecordedDecisions.mockResolvedValue(decisionsWith(recordedDecision()))
    const { page, header } = await open(withDecision())
    expect(markupOf(page)).toContain('data-recorded-decision="current"')
    expect(header).toContain('Decisión registrada')
    expect(header).toContain('Recomendación aceptada: Recordatorio (intensidad 1)')
    expect(header).toContain('Registrada por vos (Administrador) el 1/11/2026, 22:30')
    expect(header).not.toContain('Registrada sobre datos anteriores')
  })

  it('de otra persona, pendiente de aprobación', async () => {
    loadRecordedDecisions.mockResolvedValue(decisionsWith(recordedDecision({ mine: false, decision: 'MODIFICA', decidedIntervention: 'INTIMACION_ADMINISTRATIVA', decidedIntensity: 3, status: 'PENDIENTE_APROBACION' })))
    const { header } = await open(withDecision())
    expect(header).toContain('Acción modificada: Intimación administrativa formal (intensidad 3, requiere aprobación)')
    expect(header).toContain('Registrada por otra persona (Administrador)')
    expect(header).toContain('Propuesta pendiente de aprobación')
  })

  it('sin decisión lo dice', async () => {
    const { header } = await open(withDecision())
    expect(header).toContain('Todavía no hay una decisión registrada')
  })

  it('sobre datos anteriores: nunca como vigente, con la explicación', async () => {
    loadRecordedDecisions.mockResolvedValue({ ...decisionsWith(recordedDecision({ asOf: '2026-09-30', stale: true })), current: { asOf: '2026-10-31', rulesVersion: '1.1.0' } })
    const { page, header } = await open(withDecision())
    expect(header).toContain('Registrada sobre datos anteriores: se registró con la cartera al 30/9/2026 y la vigente es al 31/10/2026. Conviene revisar el caso de nuevo.')
    expect(markupOf(page)).toContain('data-recorded-decision="stale"')
  })

  it('ilegible: no se confunde con «sin decisión»', async () => {
    loadRecordedDecisions.mockResolvedValue({ ok: false, reason: 'UNAVAILABLE' })
    const { header } = await open(withDecision())
    expect(header).toContain('No se pudo leer la decisión registrada')
    expect(header).not.toContain('Todavía no hay una decisión registrada')
  })

  it('la vista se arma solo con la decisión de este caso', () => {
    const decisions = decisionsWith(recordedDecision({ debtorId: '2' }))
    expect(recordedDecisionView(decisions, '1')).toEqual({ kind: 'none' })
    expect(recordedDecisionView(decisions, '2')).toMatchObject({ kind: 'recorded', decision: { debtorId: '2' } })
    expect(recordedDecisionView({ ok: false, reason: 'FORBIDDEN' }, '1')).toEqual({ kind: 'forbidden' })
  })
})

describe('encabezado y resumen: prioridad', () => {
  it('puntaje con banda, aclaración, grupo y recomendación automática rotulada', async () => {
    const decision = evaluatedDecision()
    const { header } = await open(withDecision(decision))
    expect(header).toMatch(new RegExp(`Puntaje de prioridad ${decision.prioridad.valor} de 100 Banda Media`))
    expect(header).toContain('Por reglas, no es una probabilidad de pago.')
    expect(header).toContain('Grupo de trabajo Recordatorio')
    expect(header).toContain('Recomendación automática Recordatorio (intensidad 1)')
  })

  it('el desglose suma el puntaje mostrado y la regla aplicada está a la vista', async () => {
    const decision = evaluatedDecision()
    const { summary } = await open(withDecision(decision))
    const view = explanationOfDecision(decision)
    expect(breakdownTotal(view)).toBe(decision.prioridad.valor)
    expect(summary).toContain(`Total ${decision.prioridad.valor} de 100 puntos`)
    expect(summary).toMatch(/Importe pendiente \$\s*93\.350 20 de 50 puntos/)
    expect(summary).toMatch(/Atraso máximo 263 días 20 de 30 puntos/)
    expect(summary).toMatch(/Obligaciones vencidas 1 5 de 20 puntos/)
    expect(summary).toContain(`Regla aplicada ${decision.explicacion.frase_contrastiva}`)
  })

  it('un puntaje parcial es un mínimo', async () => {
    const input = decisionInput({ obligaciones: [...decisionInput().obligaciones, { ...decisionInput().obligaciones[0], id: 'd2', current_amount: { estado: 'NO_INFORMADO_EN_ORIGEN', valor: null } }] })
    const decision = evaluatedDecision(undefined, input)
    expect(decision.severidad.estado).toBe('PARCIAL')
    const { header, summary } = await open(withDecision(decision, { decisionInput: input }))
    expect(header).toContain(`al menos ${decision.prioridad.valor} de 100`)
    expect(summary).toContain('Es un mínimo: 1 obligación no tiene importe o vencimiento evaluables.')
  })

  it('sin decisión por lectura fallida: no disponible y lo explica, nunca cero', async () => {
    const detail = buildDebtorDetail()
    detail.debtor = { ...detail.debtor, decision: null, priorityScore: null, priorityLevel: null, decisionIssues: [{ field: 'debt', presence: 'NO_INTEGRADO', reason: 'LECTURA_FALLIDA' }] }
    const { header, summary } = await open(detail)
    expect(header).toContain('Puntaje de prioridad No disponible')
    expect(header).toContain('No se pudieron leer los datos necesarios para evaluar este caso')
    expect(summary).toContain('No se pudo calcular el puntaje: no se pudieron leer los datos')
    expect(header).not.toMatch(/Puntaje de prioridad 0/)
  })

  it('H07: los avisos que no integra la carga van en una sola nota de cobertura', async () => {
    const { summary } = await open(withDecision())
    expect(summary).toContain('Nota de cobertura: esta versión no integra el estado de origen de las obligaciones, el período fiscal y el tipo de persona de la cartera cargada.')
    expect(summary).not.toContain('Avisos de este caso')
    expect(summary).not.toContain('Período fiscal no informado')
  })

  it('H07: si al caso le falta un dato que la carga sí trae, es un aviso del caso', () => {
    const input = decisionInput({ personas: [{ tipo: { estado: 'NO_INFORMADO_EN_ORIGEN', valor: null }, porcentaje_declarado: { estado: 'OBSERVADO', valor: 100 } }] })
    expect(splitFlags(['TIPO_PERSONA_DESCONOCIDO', 'PERIODO_NO_INFORMADO', 'SIN_CONTACTO_ACTIVO'], input)).toEqual({
      caseFlags: ['TIPO_PERSONA_DESCONOCIDO', 'SIN_CONTACTO_ACTIVO'], coverage: ['PERIODO_NO_INFORMADO'],
    })
    expect(splitFlags(['PERIODO_NO_INFORMADO'], null)).toEqual({ caseFlags: ['PERIODO_NO_INFORMADO'], coverage: [] })
    expect(joinList(['a'])).toBe('a')
    expect(recordedDecisionText('POSPONE', null, null)).toBe('Decisión pospuesta')
  })

  it('sin obligaciones vencidas el atraso no aplica (no es cero ni «no disponible»)', async () => {
    const input = decisionInput({ obligaciones: [{ ...decisionInput().obligaciones[0], due_date: { estado: 'OBSERVADO', valor: '2026-12-10' } }] })
    const decision = evaluatedDecision(undefined, input)
    const { summary } = await open(withDecision(decision, { decisionInput: input, overdueDebtsCount: 0, overdueDebt: 0, maxDaysOverdue: null, metrics: { overdueDebt: { value: 0, presence: 'OBSERVADO', missing: {} }, overdueDebtsCount: { value: 0, presence: 'OBSERVADO', missing: {} }, maxDaysOverdue: { value: null, presence: 'NO_APLICA', missing: {} } } }))
    expect(summary).toContain('Atraso máximo No aplica: no hay obligaciones vencidas 0 de 30 puntos')
    expect(summary).toContain('Deuda vencida Pendientes con importe mayor que cero y vencimiento anterior a la fecha de la cartera. Sin obligaciones vencidas')
  })

  it('sin fecha de cartera evaluable el detalle técnico lo dice', async () => {
    const { summary } = await open(withDecision(evaluatedDecision(), { decisionAsOf: { estado: 'NO_INFORMADO_EN_ORIGEN', valor: null } }))
    expect(summary).toContain('Sin fecha de cartera evaluable · reglas 1.1.0')
  })

  it('sin códigos internos ni fechas técnicas crudas; el detalle técnico va plegado', async () => {
    const detail = withDecision(evaluatedDecision(), { temporalProvenance: 'Corte del manifiesto: 2026-09-30; decisión calculada el 2026-11-10T05:38:34.001Z.' })
    const { page, whole } = await open(detail)
    expect(whole).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
    expect(whole).not.toMatch(/NO_INFORMADO|NO_INTEGRADO|Índice heredado|manifiesto|Severidad del objeto/)
    expect(markupOf(page)).toMatch(/<details[^>]*><summary[^>]*>Detalle técnico<\/summary><p[^>]*>Cartera al 30\/9\/2026 · reglas 1\.1\.0/)
  })
})

// Caso chico de referencia (contracts/portfolio-small-cases.v1.json, CHICO-02), pasado por el
// mapeo real: la ficha muestra los números calculados a mano.
function referenceCase(): DebtorDetailData {
  const item = smallCases.casos.find(entry => entry.objeto.identificador === 'DEMO6-6-60012')!
  const holder = item.titulares[0]
  const raw: RawDebtorDataBundle = {
    batch: { as_of: smallCases.fecha_cartera },
    debtors: [{ id: item.objeto.id, identifier: item.objeto.identificador, type: 1 }],
    debtorTypes: [{ id: 1, value: 'Objeto sintético' }],
    debts: item.obligaciones.map(debt => ({ id: debt.id, debtor: item.objeto.id, current_amount: debt.importe, due_date: debt.vencimiento, status: debt.estado_id })),
    debtStatuses: smallCases.catalogo_debt_status,
    debtorPeople: [{ id: holder.id, debtor: item.objeto.id, person: holder.id, priority: holder.porcentaje, active: true }],
    people: [{ id: holder.id, full_name: 'Titular sintético', type: 'FISICA' }],
    debtorContacts: holder.contactos.map(contact => ({ id: contact.id, person: holder.id, type: 1, value: contact.valor, active: true })),
    debtorProfiles: [],
    warnings: [],
  }
  const mapped = mapDebtorObjectsFromRawData(raw, { computedAt: '2026-11-10T12:00:00.000Z' })
  const detail = buildDebtorDetail()
  return { ...detail, debtor: mapped.debtors[0], debts: mapped.debtsByDebtor.get(String(item.objeto.id)) ?? [] }
}

describe('caso de referencia DEMO6-6-60012, cartera al 30/09/2026', () => {
  it('encabezado: 45 de 100, banda Media, grupo Recordatorio', async () => {
    const { header } = await open(referenceCase())
    expect(header).toContain('DEMO6-6-60012')
    expect(header).toContain('Puntaje de prioridad 45 de 100 Banda Media')
    expect(header).toContain('Grupo de trabajo Recordatorio')
  })

  it('totales: registrado $ 141.350, pendiente $ 93.350, 2 vencidas por $ 93.350, 263 días', async () => {
    const { summary } = await open(referenceCase())
    expect(summary).toMatch(/Total registrado Todas las obligaciones, cualquiera sea su estado\. \$\s*141\.350/)
    expect(summary).toMatch(/Deuda pendiente El total registrado sin las obligaciones pagadas\. \$\s*93\.350/)
    expect(summary).toMatch(/Deuda vencida .* 2 obligaciones por \$\s*93\.350/)
    expect(summary).toContain('Atraso máximo 263 días')
    expect(summary).toContain('este caso tiene 1 pagada')
    expect(summary).toContain('Total 45 de 100 puntos')
    expect(summary).not.toMatch(/deuda total/i)
  })

  it('obligaciones: la pagada se ve pagada y no cuenta como vencida; la suspendida se computa como antes', async () => {
    const detail = referenceCase()
    const { debts } = await open(detail)
    expect(debts).toMatch(/Pagada \$\s*48\.000 .*10\/10\/2025 No: está pagada/)
    expect(debts).toMatch(/Suspendida \$\s*47\.150 .*10\/1\/2026 Sí/)
    expect(detail.debts.map(debt => overdueStatus(debt, '2026-09-30', false).label)).toEqual(['No: está pagada', 'Sí', 'Sí'])
    expect(overdueStatus(detail.debts[1], null, false).label).toBe('No disponible')
    expect(overdueStatus(detail.debts[1], '2026-09-30', true).label).toBe('No disponible')
    expect(overdueStatus(detail.debts[1], '2025-01-01', false).label).toBe('No')
  })
})

describe('estados de la ficha', () => {
  it('error de lectura: mensaje claro con qué hacer, sin consultar la revisión', async () => {
    getDebtorDetailData.mockResolvedValue({ detail: null, warnings: [{ table: 'debtor', message: 'x', needsSelectPolicy: false }] })
    const whole = textOf(markupOf(await DebtorDetailPage({ params: Promise.resolve({ debtorId: '1' }) })))
    expect(whole).toContain('No se pudo leer este caso')
    expect(whole).toContain('Recargá la página en unos minutos')
    expect(whole).not.toContain('Datos no disponibles')
    expect(loadCaseReviewScreen).not.toHaveBeenCalled()
  })

  it('municipio sin cartera: invita a cargar un CSV solo a quien puede', async () => {
    getDebtorDetailData.mockResolvedValue({ detail: null, warnings: [] })
    loadViewerContext.mockResolvedValue({ portfolio: { kind: 'EMPTY' }, capabilities: { canImport: true } })
    const admin = markupOf(await DebtorDetailPage({ params: Promise.resolve({ debtorId: '1' }) }))
    expect(textOf(admin)).toContain('Tu municipio todavía no tiene una cartera cargada')
    expect(admin).toMatch(/<a[^>]*href="\/import"[^>]*>Cargar CSV<\/a>/)
    loadViewerContext.mockResolvedValue({ portfolio: { kind: 'EMPTY' }, capabilities: { canImport: false } })
    const user = markupOf(await DebtorDetailPage({ params: Promise.resolve({ debtorId: '1' }) }))
    expect(user).not.toContain('href="/import"')
    expect(textOf(user)).toContain('Cargar la cartera requiere una cuenta con rol ADMIN.')
  })

  it('con cartera cargada, un caso inexistente es 404', async () => {
    getDebtorDetailData.mockResolvedValue({ detail: null, warnings: [] })
    loadViewerContext.mockResolvedValue({ portfolio: { kind: 'LOADED', asOf: '2026-09-30' }, capabilities: { canImport: true } })
    await expect(DebtorDetailPage({ params: Promise.resolve({ debtorId: '1' }) })).rejects.toThrow('notFound')
  })

  it('la auditoría de apertura se registra y, si falla, la ficha no se entrega', async () => {
    await open(withDecision())
    expect(auditCaseOpen).toHaveBeenCalledExactlyOnceWith('1')
    auditCaseOpen.mockRejectedValueOnce(new Error('audit'))
    await expect(open(withDecision())).rejects.toThrow('audit')
  })
})
