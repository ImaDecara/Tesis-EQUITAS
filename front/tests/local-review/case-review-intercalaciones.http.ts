import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { actionIds, approvals, cookieFor, holdAdvisoryLock, post, READY_CHECKLIST, registerBatch, reviews, sql, TENANT_A, untilFunctionWaits, untilImportWaits } from './http-support'

// ALIGN-020, ciclo 1. Las intercalaciones de la revision (B1), por HTTP contra `next start`, sin simular nada de la aplicacion.
// Una sesion SQL retiene el bloqueo: la accion ya recalculo y su RPC espera; en ese momento se importa. Sin pausas arbitrarias.
const debtorLock = (debtor: string) => `case_review:${TENANT_A}:${debtor}`
const importLock = `import_batch:${TENANT_A}`

let ids: ReturnType<typeof actionIds>
let operador = ''
let supervisor = ''
let cutoffDay = 1
const nextCutoff = () => `2026-12-${String(cutoffDay++).padStart(2, '0')}`
const openLocks: { release: () => Promise<void> }[] = []

async function hold(key: string, also: string[] = [], mode: 'exclusive' | 'shared' = 'exclusive') {
  const lock = await holdAdvisoryLock(key, also, mode)
  openLocks.push(lock)
  return { release: async () => { openLocks.splice(openLocks.indexOf(lock), 1); await lock.release() } }
}

async function publishNewCutoff() {
  const asOf = nextCutoff()
  const validated = await registerBatch('VALIDADO', asOf)
  await registerBatch('PUBLICADO', asOf, validated)
  return asOf
}

// Lo que la pantalla tendria a la vista: se pide con un hash ajeno, y la accion responde con lo vigente sin escribir.
async function screenFor(debtorId: string) {
  const { result } = await post(ids.record, { debtorId, decision: 'ACEPTA', expected: { asOf: '2020-01-01', rulesVersion: '1.0.0', inputsHash: 'a'.repeat(64) } }, { cookie: operador })
  expect(result, 'vista vigente').toMatchObject({ ok: false, code: 'SUGGESTION_OUTDATED' })
  const current = result!.current as { asOf: string; rulesVersion: string; inputsHash: string; currentReviewId: string | null }
  return { expected: { asOf: current.asOf, rulesVersion: current.rulesVersion, inputsHash: current.inputsHash }, supersedes: current.currentReviewId }
}

async function proposalFor(debtorId: string) {
  const { result } = await post(ids.record, {
    debtorId, decision: 'MODIFICA', decidedIntervention: 'INTIMACION_ADMINISTRATIVA', decidedIntensity: 3, reasonCode: 'MOTIVO_SINTETICO', checklist: READY_CHECKLIST, ...await screenFor(debtorId),
  }, { cookie: operador })
  expect(result, 'propuesta').toMatchObject({ ok: true, status: 'PENDIENTE_SUPERVISOR' })
  return result!.reviewId as string
}

beforeAll(async () => {
  ids = actionIds()
  operador = await cookieFor('operador')
  supervisor = await cookieFor('supervisor')
  await publishNewCutoff()
})

afterEach(async () => {
  // Si una prueba falla con el bloqueo tomado o un lote abierto, el resto no queda colgado ni arrastra el fallo.
  for (const lock of openLocks.splice(0)) await lock.release()
  await publishNewCutoff()
})

describe('registro con una importacion en el medio', () => {
  it('se publica otro lote y cambia un importe mientras la RPC espera: rechazado y sin fila', async () => {
    const debtorId = '920016'
    const input = { debtorId, decision: 'ACEPTA', ...await screenFor(debtorId) }
    const lock = await hold(debtorLock(debtorId))
    const pending = post(ids.record, input, { cookie: operador })
    await untilFunctionWaits()
    const asOf = nextCutoff()
    const validated = await registerBatch('VALIDADO', asOf)
    sql(`update public.debt set current_amount = current_amount + 11111 where id = ${debtorId}`)
    await registerBatch('PUBLICADO', asOf, validated)
    await lock.release()
    const { result } = await pending
    expect(result, 'no confirma con el corte anterior').toMatchObject({ ok: false, code: 'SUGGESTION_OUTDATED', current: { asOf } })
    expect(result?.changed).toEqual(expect.arrayContaining(['INSUMOS', 'CORTE']))
    expect(reviews(debtorId)).toBe(0)

    // Con lo vigente vuelve a pasar: el rechazo no deja el caso trabado.
    const fresh = await post(ids.record, { debtorId, decision: 'ACEPTA', ...await screenFor(debtorId) }, { cookie: operador })
    expect(fresh.result).toMatchObject({ ok: true, created: true, asOf })
    expect(sql(`select as_of, inputs_hash from public.case_review where debtor = ${debtorId}`)).toBe(`${asOf}|${fresh.result!.inputsHash}`)
  })

  it('la RPC espera el bloqueo de lotes mientras otro proceso registra VALIDADO sin confirmar: rechazado y sin fila', async () => {
    const debtorId = '920021'
    const input = { debtorId, decision: 'ACEPTA', ...await screenFor(debtorId) }
    const lock = await hold(importLock, [
      `insert into public.import_batch(tenant, source, file_hashes, as_of, rules_version, status, created_by, created_by_role, idempotency_key) values (${TENANT_A}, 'ETL_CLI', jsonb_build_object('cabecera', repeat('b', 64)), '2026-12-28', '1.0.0', 'VALIDADO', 920009, 'importador_sistema', gen_random_uuid());`,
    ])
    const pending = post(ids.record, input, { cookie: operador })
    await untilFunctionWaits()
    await lock.release()
    const { result } = await pending
    expect(result).toMatchObject({ ok: false, code: 'CUTOFF_NOT_AVAILABLE' })
    expect(reviews(debtorId)).toBe(0)
    const open = Number(sql(`select max(id) from public.import_batch where tenant = ${TENANT_A} and status = 'VALIDADO'`))
    await registerBatch('PUBLICADO', '2026-12-28', open)
  })
})

describe('aprobacion con una importacion en el medio', () => {
  it('empieza un lote VALIDADO y cambia un importe mientras la RPC espera: rechazada y sin fila', async () => {
    const debtorId = '920017'
    const reviewId = await proposalFor(debtorId)
    const lock = await hold(debtorLock(debtorId))
    const pending = post(ids.approve, { caseReviewId: reviewId, decision: 'APRUEBA', checklist: READY_CHECKLIST }, { cookie: supervisor })
    await untilFunctionWaits()
    const asOf = nextCutoff()
    const validated = await registerBatch('VALIDADO', asOf)
    sql(`update public.debt set current_amount = current_amount + 22222 where id = ${debtorId}`)
    await lock.release()
    const { result } = await pending
    expect(result, 'no aprueba sin corte vigente').toMatchObject({ ok: false, code: 'CUTOFF_NOT_AVAILABLE' })
    expect(approvals(reviewId)).toBe(0)
    await registerBatch('PUBLICADO', asOf, validated)

    // Ya publicado, la propuesta sigue vieja: tampoco se aprueba.
    const later = await post(ids.approve, { caseReviewId: reviewId, decision: 'APRUEBA', checklist: READY_CHECKLIST }, { cookie: supervisor })
    expect(later.result).toMatchObject({ ok: false, code: 'SUGGESTION_OUTDATED' })
    expect(approvals(reviewId)).toBe(0)
  })

  it('la RPC espera el bloqueo de lotes mientras otro proceso publica sin confirmar: rechazada y sin fila', async () => {
    const debtorId = '920022'
    const reviewId = await proposalFor(debtorId)
    const lock = await hold(importLock, [
      `insert into public.import_batch(tenant, source, file_hashes, as_of, rules_version, status, created_by, created_by_role, idempotency_key) values (${TENANT_A}, 'ETL_CLI', jsonb_build_object('cabecera', repeat('b', 64)), '2026-12-29', '1.0.0', 'PUBLICADO', 920009, 'importador_sistema', gen_random_uuid());`,
    ])
    const pending = post(ids.approve, { caseReviewId: reviewId, decision: 'APRUEBA', checklist: READY_CHECKLIST }, { cookie: supervisor })
    await untilFunctionWaits()
    await lock.release()
    const { result } = await pending
    expect(result).toMatchObject({ ok: false, code: 'SUGGESTION_OUTDATED' })
    expect(approvals(reviewId)).toBe(0)
  })

  it('OBJETA con un lote VALIDADO en el medio entra: frena la propuesta, no confirma nada', async () => {
    const debtorId = '920023'
    const reviewId = await proposalFor(debtorId)
    const lock = await hold(debtorLock(debtorId))
    const pending = post(ids.approve, { caseReviewId: reviewId, decision: 'OBJETA', reasonCode: 'MOTIVO_SINTETICO' }, { cookie: supervisor })
    await untilFunctionWaits()
    const asOf = nextCutoff()
    const validated = await registerBatch('VALIDADO', asOf)
    await lock.release()
    const { result } = await pending
    expect(result).toMatchObject({ ok: true, created: true, status: 'OBJETADA' })
    expect(approvals(reviewId)).toBe(1)
    await registerBatch('PUBLICADO', asOf, validated)
  })
})

describe('sin importacion en el medio', () => {
  it('la RPC espera y nada cambia: pasa como antes', async () => {
    const debtorId = '920018'
    const input = { debtorId, decision: 'ACEPTA', ...await screenFor(debtorId) }
    const lock = await hold(debtorLock(debtorId))
    const pending = post(ids.record, input, { cookie: operador })
    await untilFunctionWaits()
    await lock.release()
    const { result } = await pending
    expect(result).toMatchObject({ ok: true, created: true, status: 'REGISTRADA', asOf: input.expected.asOf, inputsHash: input.expected.inputsHash })
    expect(reviews(debtorId)).toBe(1)
  })

  it('doble envio mientras la RPC espera: una sola fila', async () => {
    const debtorId = '920019'
    const input = { debtorId, decision: 'ACEPTA', ...await screenFor(debtorId) }
    const lock = await hold(debtorLock(debtorId))
    const pending = [1, 2, 3, 4, 5].map(() => post(ids.record, input, { cookie: operador }))
    await untilFunctionWaits(5)
    await lock.release()
    const replies = await Promise.all(pending)
    expect(replies.every(reply => reply.result?.ok === true)).toBe(true)
    expect(replies.filter(reply => reply.result?.created === true)).toHaveLength(1)
    expect(reviews(debtorId)).toBe(1)
  })

  it('una escritura de revision en curso, con el bloqueo compartido, hace esperar a la importacion', async () => {
    const lock = await hold(importLock, [], 'shared')
    let done = false
    const pending = registerBatch('RECIBIDO', '2026-12-30').then(id => { done = true; return id })
    await untilImportWaits()
    expect(done, 'la funcion de lotes respeta el bloqueo').toBe(false)
    await lock.release()
    await expect(pending).resolves.toBeGreaterThan(0)
  })
})
