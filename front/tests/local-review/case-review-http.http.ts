import { beforeAll, describe, expect, it } from 'vitest'

import type { ReviewAccount } from './config'
import { actionIds, cookieFor, post, READY_CHECKLIST, registerBatch, reviews, sql } from './http-support'

// ALIGN-020. Las acciones por HTTP real contra `next start`: compiladas, con proxy, cookies y CSRF de Next.
let ids: ReturnType<typeof actionIds>
const session: Partial<Record<ReviewAccount, string>> = {}
const blind = (debtorId: string, overrides: Record<string, unknown> = {}) => ({
  debtorId, decision: 'ACEPTA', expected: { asOf: '2026-10-30', rulesVersion: '1.0.0', inputsHash: 'a'.repeat(64) }, ...overrides,
})

beforeAll(async () => {
  ids = actionIds()
  const validated = await registerBatch('VALIDADO', '2026-10-30')
  await registerBatch('PUBLICADO', '2026-10-30', validated)
  for (const label of ['operador', 'supervisor', 'importador', 'consulta'] as const) session[label] = await cookieFor(label)
})

describe('ALIGN-020 por HTTP', () => {
  it('existen dos acciones compiladas y son distintas', () => {
    expect(ids.record).not.toBe(ids.approve)
  })

  it('sin sesion: el proxy redirige y nada se escribe', async () => {
    const { status, location } = await post(ids.record, blind('920001'))
    expect(status).toBe(307)
    expect(location).toBe('/login?next=%2Falign020-probe')
    expect(reviews('920001')).toBe(0)
  })

  it('un origen ajeno con sesion valida no llega a la accion', async () => {
    const { result } = await post(ids.record, blind('920001'), { cookie: session.operador, origin: 'https://otro.example' })
    expect(result?.ok).not.toBe(true)
    expect(reviews('920001')).toBe(0)
  })

  it.each<[string, ReviewAccount, string]>([
    ['consulta', 'consulta', 'ROLE_FORBIDDEN'],
    ['supervisor', 'supervisor', 'ROLE_FORBIDDEN'],
    ['tp_operator de E06', 'importador', 'ROLE_FORBIDDEN'],
  ])('%s no registra', async (_name, label, code) => {
    const { result } = await post(ids.record, blind('920001'), { cookie: session[label] })
    expect(result).toMatchObject({ ok: false, code })
    expect(reviews('920001')).toBe(0)
  })

  it('cookie de otro municipio y objeto ajeno: rechazados', async () => {
    const forged = await cookieFor('operador', '920002')
    await expect(post(ids.record, blind('920001'), { cookie: forged })).resolves.toMatchObject({ result: { ok: false, code: 'TENANT_ACCESS_NOT_FOUND' } })
    await expect(post(ids.record, blind('920002'), { cookie: session.operador })).resolves.toMatchObject({ result: { ok: false, code: 'OBJECT_NOT_IN_TENANT' } })
    expect(reviews('920001') + reviews('920002')).toBe(0)
  })

  it('campos falsificados y motivo faltante: rechazados', async () => {
    for (const forged of [{ tenant: '920002' }, { reviewer: '920003' }, { inputsHash: 'f'.repeat(64) }]) {
      const { result } = await post(ids.record, blind('920001', forged), { cookie: session.operador })
      expect(result).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    }
    const { result } = await post(ids.record, blind('920001', { decision: 'RECHAZA' }), { cookie: session.operador })
    expect(result).toMatchObject({ ok: false, code: 'REASON_REQUIRED' })
    expect(reviews('920001')).toBe(0)
  })

  it('sin confirmar a ciegas: un hash ajeno no escribe; con lo vigente, cinco envios crean una fila', async () => {
    const stale = await post(ids.record, blind('920001'), { cookie: session.operador })
    expect(stale.result).toMatchObject({ ok: false, code: 'SUGGESTION_OUTDATED' })
    expect(reviews('920001')).toBe(0)
    const current = stale.result!.current as { asOf: string; rulesVersion: string; inputsHash: string; suggestedIntervention: string }
    const input = { debtorId: '920001', decision: 'ACEPTA', expected: { asOf: current.asOf, rulesVersion: current.rulesVersion, inputsHash: current.inputsHash } }
    const replies = await Promise.all(Array.from({ length: 5 }, () => post(ids.record, input, { cookie: session.operador })))
    expect(replies.every(reply => reply.status === 200 && reply.result?.ok === true)).toBe(true)
    expect(replies.filter(reply => reply.result?.created === true)).toHaveLength(1)
    expect(reviews('920001')).toBe(1)
    expect(sql('select inputs_hash, rules_version, reviewer, reviewer_role from public.case_review where debtor = 920001')).toBe(`${current.inputsHash}|${current.rulesVersion}|920002|operador`)
  })

  it('propuesta intensa: operador no aprueba; supervisor aprueba una sola vez', async () => {
    const stale = await post(ids.record, blind('920012'), { cookie: session.operador })
    const current = stale.result!.current as { asOf: string; rulesVersion: string; inputsHash: string }
    const proposal = await post(ids.record, {
      debtorId: '920012', decision: 'MODIFICA', decidedIntervention: 'INTIMACION_ADMINISTRATIVA', decidedIntensity: 3, reasonCode: 'MOTIVO_SINTETICO', checklist: READY_CHECKLIST,
      expected: { asOf: current.asOf, rulesVersion: current.rulesVersion, inputsHash: current.inputsHash },
    }, { cookie: session.operador })
    expect(proposal.result).toMatchObject({ ok: true, created: true, status: 'PENDIENTE_SUPERVISOR' })
    const approval = { caseReviewId: proposal.result!.reviewId, decision: 'APRUEBA', checklist: READY_CHECKLIST }
    await expect(post(ids.approve, approval, { cookie: session.operador })).resolves.toMatchObject({ result: { ok: false, code: 'ROLE_FORBIDDEN' } })
    const replies = await Promise.all([1, 2, 3].map(() => post(ids.approve, approval, { cookie: session.supervisor })))
    expect(replies.filter(reply => reply.result?.ok === true && reply.result?.created === true)).toHaveLength(1)
    expect(Number(sql(`select count(*) from public.case_review_approval where case_review = ${proposal.result!.reviewId}`))).toBe(1)
  })
})
