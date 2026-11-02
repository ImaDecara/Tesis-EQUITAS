import { createHash, createHmac } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServerClient } from '@supabase/ssr'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const { jar } = vi.hoisted(() => ({ jar: { cookies: new Map<string, string>() } }))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined),
    getAll: () => [...jar.cookies].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => { jar.cookies.set(name, value) },
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { approveCaseDecision, recordCaseDecision } from '@/app/debtors/[debtorId]/actions'
import { RULES_VERSION } from '@/lib/domain/decision-rules-v1'
import { loadRawDebtorData } from '@/lib/data/raw-debtor-loader'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { computeInputsHash } from '@/lib/server/case-review-snapshot'
import { getCaseReviewSnapshot } from '@/lib/server/case-review-service'
import { readLocalReviewConfig, type ReviewAccount } from './config'

const config = readLocalReviewConfig()
const CONTAINER = 'supabase_db_equitas-tp-testing'
const TENANT_A = '920001'
const TENANT_B = '920002'
const SYSTEM_USER = 920009
const OPERADOR = '920002'
const SUPERVISOR = '920003'
const READY_CHECKLIST = { situacion_hogar: 'NO_DISPONIBLE', estado_juridico_verificado: true, canal_valido: true, alternativa_asistida_ofrecida: true }
const INTENSE = { decision: 'MODIFICA', decidedIntervention: 'INTIMACION_ADMINISTRATIVA', decidedIntensity: 3, reasonCode: 'MOTIVO_SINTETICO', checklist: READY_CHECKLIST }

function sql(statement: string): string {
  return execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8' }).trim()
}
const count = (table: string, where: string) => Number(sql(`select count(*) from public.${table} where ${where}`))
const reviewsOf = (debtor: string) => count('case_review', `debtor = ${debtor}`)

const sessions = new Map<ReviewAccount, Map<string, string>>()
async function login(label: ReviewAccount) {
  const cookies = new Map<string, string>()
  const client = createServerClient(config.supabaseUrl, config.publishableKey, {
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: values => { for (const { name, value } of values) cookies.set(name, value) },
    },
  })
  const { error } = await client.auth.signInWithPassword(config.accounts[label])
  expect(error?.code ?? null, `login ${label}`).toBeNull()
  sessions.set(label, cookies)
}

// Una sesion por solicitud, como en Next: la cookie de municipio la manda el navegador.
function actAs(label: ReviewAccount | null, tenantCookie?: string) {
  jar.cookies = new Map(label ? sessions.get(label) : [])
  if (tenantCookie) jar.cookies.set('equitas_tenant_id', tenantCookie)
}

async function restCall(path: string, token: string, body: unknown, method = 'POST') {
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    method,
    headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json().catch(() => null) as Record<string, unknown> | null }
}

let batchSeq = 0
async function publishBatch(tenant: string, asOf: string, status: 'VALIDADO' | 'PUBLICADO' | 'FALLIDO' = 'PUBLICADO', supersedes: number | null = null) {
  batchSeq += 1
  const { status: http, body } = await restCall('/rest/v1/rpc/record_import_batch', config.importJwt, {
    p_actor_user: SYSTEM_USER, p_tenant: Number(tenant), p_source: 'ETL_CLI', p_file_hashes: { cabecera: 'b'.repeat(64) }, p_as_of: asOf,
    p_rules_version: RULES_VERSION, p_status: status, p_idempotency_key: `00000000-0000-4000-8000-${String(batchSeq).padStart(12, '0')}`,
    p_counts: { filas: 1 }, p_source_updated_at: '2026-10-29', p_supersedes: supersedes,
  })
  expect(http, 'lote registrado').toBe(200)
  return Number(body?.batch_id)
}

async function shown(debtor: string) {
  const snapshot = await getCaseReviewSnapshot(debtor)
  if (!snapshot.ok) throw new Error(`Sin instantanea para ${debtor}: ${snapshot.code}`)
  return snapshot.snapshot
}

async function inputFor(debtor: string, overrides: Record<string, unknown> = {}) {
  const screen = await shown(debtor)
  return {
    debtorId: debtor, decision: 'ACEPTA', supersedes: screen.currentReviewId,
    expected: { asOf: screen.asOf, rulesVersion: screen.rulesVersion, inputsHash: screen.inputsHash },
    ...overrides,
  }
}

beforeAll(async () => {
  for (const label of ['consulta', 'operador', 'supervisor', 'importador', 'sin-membresia', 'inactivo', 'otro-operador', 'otro-supervisor'] as const) await login(label)
})

describe('precondiciones reales', () => {
  it('la base esta recien sembrada y la Data API rechaza escribir directo a un operador con sesion', async () => {
    expect(count('case_review', 'true')).toBe(0)
    expect(count('import_batch', 'true')).toBe(0)
    const token = JSON.parse(Buffer.from((sessions.get('operador')!.values().next().value as string).replace(/^base64-/, ''), 'base64url').toString('utf8')).access_token as string
    const forged = { tenant: 920001, debtor: 920001, rules_version: '9.9.9', as_of: '2026-01-01', inputs_hash: 'f'.repeat(64), suggested_intervention: 'FORJADA', suggested_intensity: 0, explanation: {}, decision: 'ACEPTA', decided_intervention: 'FORJADA', decided_intensity: 0, reviewer: Number(OPERADOR), reviewer_role: 'operador', idempotency_key: '00000000-0000-4000-8000-00000000f0f0' }
    for (const [name, path, body] of [
      ['insert', '/rest/v1/case_review', forged],
      ['rpc', '/rest/v1/rpc/record_case_review', { p_reviewer_user: Number(OPERADOR), p_tenant: 920001, p_debtor: 920001, p_rules_version: '9.9.9', p_as_of: '2026-01-01', p_inputs_hash: 'f'.repeat(64), p_suggested_intervention: 'FORJADA', p_suggested_intensity: 0, p_explanation: {}, p_decision: 'ACEPTA', p_idempotency_key: '00000000-0000-4000-8000-00000000f0f1' }],
    ] as const) {
      const reply = await restCall(path, token, body)
      expect(reply.status, name).toBeGreaterThanOrEqual(401)
      expect(reply.body?.code, name).toBe('42501')
    }
    expect(count('case_review', 'true')).toBe(0)
  })
})

describe('sin corte publicado no hay decision registrable', () => {
  it('sin lote, y con un lote solo VALIDADO', async () => {
    actAs('operador')
    await expect(getCaseReviewSnapshot('920001')).resolves.toMatchObject({ ok: false, code: 'CUTOFF_NOT_AVAILABLE' })
    const validated = await publishBatch(TENANT_A, '2026-10-30', 'VALIDADO')
    await expect(getCaseReviewSnapshot('920001')).resolves.toMatchObject({ ok: false, code: 'CUTOFF_NOT_AVAILABLE' })
    const result = await recordCaseDecision({ debtorId: '920001', decision: 'ACEPTA', expected: { asOf: '2026-10-30', rulesVersion: RULES_VERSION, inputsHash: 'a'.repeat(64) } })
    expect(result).toMatchObject({ ok: false, code: 'CUTOFF_NOT_AVAILABLE' })
    expect(count('case_review', 'true')).toBe(0)
    await publishBatch(TENANT_A, '2026-10-30', 'PUBLICADO', validated)
    await expect(getCaseReviewSnapshot('920001')).resolves.toMatchObject({ ok: true, snapshot: { asOf: '2026-10-30' } })
  })
})

describe('rechazos con sesiones reales', () => {
  const blind = { debtorId: '920001', decision: 'ACEPTA', expected: { asOf: '2026-10-30', rulesVersion: RULES_VERSION, inputsHash: 'a'.repeat(64) } }

  it.each<[string, ReviewAccount | null, string | undefined, string]>([
    ['sin sesion', null, undefined, 'AUTH_REQUIRED'],
    ['sin membresia', 'sin-membresia', undefined, 'TENANT_ACCESS_NOT_FOUND'],
    ['membresia inactiva', 'inactivo', undefined, 'TENANT_ACCESS_INACTIVE'],
    ['consulta', 'consulta', undefined, 'ROLE_FORBIDDEN'],
    ['supervisor', 'supervisor', undefined, 'ROLE_FORBIDDEN'],
    ['tp_operator de E06', 'importador', undefined, 'ROLE_FORBIDDEN'],
    ['operador con cookie de otro municipio', 'operador', TENANT_B, 'TENANT_ACCESS_NOT_FOUND'],
    ['dos membresias sin seleccion', 'otro-operador', undefined, 'TENANT_SELECTION_REQUIRED'],
    ['operador en B que elige A, donde es consulta', 'otro-operador', TENANT_A, 'ROLE_FORBIDDEN'],
  ])('recordCaseDecision: %s', async (_name, label, cookie, code) => {
    actAs(label, cookie)
    await expect(recordCaseDecision(blind)).resolves.toMatchObject({ ok: false, code })
    expect(count('case_review', 'true')).toBe(0)
  })

  it.each<[string, ReviewAccount | null, string | undefined, string]>([
    ['sin sesion', null, undefined, 'AUTH_REQUIRED'],
    ['operador', 'operador', undefined, 'ROLE_FORBIDDEN'],
    ['consulta', 'consulta', undefined, 'ROLE_FORBIDDEN'],
    ['tp_operator de E06', 'importador', undefined, 'ROLE_FORBIDDEN'],
  ])('approveCaseDecision: %s', async (_name, label, cookie, code) => {
    actAs(label, cookie)
    await expect(approveCaseDecision({ caseReviewId: '1', decision: 'APRUEBA', checklist: READY_CHECKLIST })).resolves.toMatchObject({ ok: false, code })
    expect(count('case_review_approval', 'true')).toBe(0)
  })

  it('objeto de otro municipio, leido sin RLS abierta: mismo rechazo que uno inexistente', async () => {
    actAs('operador')
    await expect(recordCaseDecision({ ...blind, debtorId: '920002' })).resolves.toMatchObject({ ok: false, code: 'OBJECT_NOT_IN_TENANT' })
    await expect(recordCaseDecision({ ...blind, debtorId: '99999999' })).resolves.toMatchObject({ ok: false, code: 'OBJECT_NOT_IN_TENANT' })
    expect(count('case_review', 'true')).toBe(0)
  })

  it('motivo faltante y campos falsificados no llegan a la base', async () => {
    actAs('operador')
    const input = await inputFor('920001', { decision: 'RECHAZA' })
    await expect(recordCaseDecision(input)).resolves.toMatchObject({ ok: false, code: 'REASON_REQUIRED' })
    for (const forged of [{ tenant: TENANT_B }, { reviewer: SUPERVISOR }, { inputsHash: 'f'.repeat(64) }, { suggestedIntensity: 3 }, { rulesVersion: '9.9.9' }]) {
      await expect(recordCaseDecision({ ...input, reasonCode: 'MOTIVO', ...forged })).resolves.toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    }
    expect(count('case_review', 'true')).toBe(0)
  })
})

describe('caso valido', () => {
  it('una insercion: actor, rol, hash, version y corte son los del servidor', async () => {
    actAs('operador')
    const screen = await shown('920001')
    const result = await recordCaseDecision(await inputFor('920001'))
    expect(result).toMatchObject({ ok: true, created: true, status: 'REGISTRADA', asOf: '2026-10-30', rulesVersion: RULES_VERSION, inputsHash: screen.inputsHash })
    if (!result.ok) throw new Error(result.code)
    expect(reviewsOf('920001')).toBe(1)
    const [tenant, debtor, version, asOf, hash, suggested, intensity, decision, decided, decidedIntensity, reviewer, role, reason, explanationOk] = sql(
      `select tenant, debtor, rules_version, as_of, inputs_hash, suggested_intervention, suggested_intensity, decision, decided_intervention, decided_intensity, reviewer, reviewer_role, coalesce(reason_text, 'NULO'), explanation ? 'frase_contrastiva' from public.case_review where id = ${result.reviewId}`,
    ).split('|')
    expect({ tenant, debtor, version, asOf, hash, decision, reviewer, role, reason, explanationOk }).toEqual({
      tenant: TENANT_A, debtor: '920001', version: RULES_VERSION, asOf: '2026-10-30', hash: screen.inputsHash, decision: 'ACEPTA', reviewer: OPERADOR, role: 'operador', reason: 'NULO', explanationOk: 't',
    })
    const explanation = sql(`select explanation::text from public.case_review where id = ${result.reviewId}`)
    for (const personal of ['TP-A020 Persona', '@example.test', 'TP-A018-1']) expect(explanation).not.toContain(personal)
    expect(suggested).toBe(screen.suggestedIntervention)
    expect(Number(intensity)).toBe(screen.suggestedIntensity)
    expect(decided).toBe(screen.suggestedIntervention)
    expect(Number(decidedIntensity)).toBe(screen.suggestedIntensity)
  })

  it('el hash coincide con un recalculo independiente sobre la cartera completa de la DAL', async () => {
    actAs('operador')
    const screen = await shown('920001')
    const raw = await loadRawDebtorData()
    expect(raw.warnings).toEqual([])
    const full = mapDebtorObjectsFromRawData({ ...raw, batch: { as_of: '2026-10-30', source_updated_at: '2026-10-29' } })
    const debtor = full.debtors.find(item => item.id === '920001')!
    expect(computeInputsHash(debtor.decisionInput!)).toBe(screen.inputsHash)
    expect(debtor.decision!.intervencion.codigo).toBe(screen.suggestedIntervention)
    // Dos personas con relacion activa, la inactiva afuera, y ninguna persona ni objeto de otro municipio.
    expect(debtor.decisionInput!.personas).toHaveLength(2)
    expect(debtor.decisionInput!.obligaciones.map(item => item.id).sort()).toEqual(['920001', '920002'])
    expect(debtor.decisionInput!.contactos_activos).toEqual({ estado: 'OBSERVADO', valor: 2 })
  })

  it('la consulta ve la misma sugerencia que el operador', async () => {
    actAs('operador')
    const operator = await shown('920001')
    actAs('consulta')
    await expect(shown('920001')).resolves.toMatchObject({ inputsHash: operator.inputsHash, currentReviewId: operator.currentReviewId })
  })

  it('reason_text se guarda igual a como llega; 500 caracteres pasan y 501 no; se lee por la funcion', async () => {
    actAs('operador')
    const padded = ' '.repeat(250) + 'ñ' + ' '.repeat(249)
    const result = await recordCaseDecision(await inputFor('920001', { decision: 'POSPONE', reasonCode: 'MOTIVO_SINTETICO', reasonText: padded }))
    expect(result).toMatchObject({ ok: true, created: true })
    if (!result.ok) throw new Error(result.code)
    const { body } = await restCall('/rest/v1/rpc/read_case_review_reason_text', config.reviewJwt, { p_actor_user: Number(OPERADOR), p_tenant: Number(TENANT_A), p_case_review: Number(result.reviewId) })
    expect(body).toBe(padded)
    const emoji = await recordCaseDecision(await inputFor('920001', { decision: 'POSPONE', reasonCode: 'MOTIVO_SINTETICO', reasonText: '🙂'.repeat(500) }))
    expect(emoji).toMatchObject({ ok: true, created: true })
    await expect(recordCaseDecision(await inputFor('920001', { decision: 'POSPONE', reasonCode: 'MOTIVO_SINTETICO', reasonText: 'x'.repeat(501) }))).resolves.toMatchObject({ ok: false, code: 'REASON_TEXT_TOO_LONG' })
    await expect(recordCaseDecision(await inputFor('920001', { decision: 'POSPONE', reasonCode: 'MOTIVO_SINTETICO', reasonText: ' \n\t ' }))).resolves.toMatchObject({ ok: false, code: 'REASON_TEXT_BLANK' })
    expect(reviewsOf('920001')).toBe(3)
  })
})

describe('doble envio contra la base real', () => {
  it('ocho envios simultaneos de la misma decision: una sola fila', async () => {
    actAs('operador')
    const input = await inputFor('920011')
    const results = await Promise.all(Array.from({ length: 8 }, () => recordCaseDecision(input)))
    expect(results.every(item => item.ok)).toBe(true)
    expect(results.filter(item => item.ok && item.created)).toHaveLength(1)
    expect(new Set(results.map(item => item.ok && item.reviewId)).size).toBe(1)
    expect(reviewsOf('920011')).toBe(1)
    const again = await recordCaseDecision(input)
    expect(again).toMatchObject({ ok: true, created: false })
    expect(reviewsOf('920011')).toBe(1)
  })

  it('dos decisiones distintas y simultaneas: una entra, la otra no se confirma en silencio', async () => {
    actAs('operador')
    const accept = await inputFor('920014')
    const postpone = { ...accept, decision: 'POSPONE', reasonCode: 'MOTIVO_SINTETICO' }
    const results = await Promise.all([recordCaseDecision(accept), recordCaseDecision(postpone)])
    expect(results.filter(item => item.ok)).toHaveLength(1)
    expect(results.filter(item => !item.ok && item.code === 'REVIEW_CONFLICT')).toHaveLength(1)
    expect(reviewsOf('920014')).toBe(1)
    expect(count('case_review', 'debtor = 920014 and supersedes is null')).toBe(1)
  })
})

describe('insumos o version cambiados', () => {
  it('cambia un importe entre la pantalla y el envio: rechazado; con lo vigente entra el hash nuevo', async () => {
    actAs('operador')
    const input = await inputFor('920013')
    sql('update public.debt set current_amount = current_amount + 1000 where id = 920013')
    const stale = await recordCaseDecision(input)
    expect(stale).toMatchObject({ ok: false, code: 'SUGGESTION_OUTDATED', changed: ['INSUMOS'] })
    expect(reviewsOf('920013')).toBe(0)
    if (stale.ok) throw new Error('no debio registrarse')
    expect(stale.current?.inputsHash).not.toBe(input.expected.inputsHash)
    const fresh = await recordCaseDecision(await inputFor('920013'))
    expect(fresh).toMatchObject({ ok: true, created: true, inputsHash: stale.current?.inputsHash })
    expect(sql('select inputs_hash from public.case_review where debtor = 920013')).toBe(stale.current?.inputsHash)
  })

  it('otra version de reglas en la pantalla: rechazado', async () => {
    actAs('operador')
    const input = await inputFor('920015')
    await expect(recordCaseDecision({ ...input, expected: { ...input.expected, rulesVersion: '0.9.9' } })).resolves.toMatchObject({ ok: false, code: 'SUGGESTION_OUTDATED', changed: ['VERSION'] })
    expect(reviewsOf('920015')).toBe(0)
  })
})

describe('cadena', () => {
  it('declarar otra vigente se rechaza; declarar la vigente la reemplaza', async () => {
    actAs('operador')
    const before = await shown('920014')
    expect(before.currentReviewId).not.toBeNull()
    const next = await inputFor('920014', { decision: 'RECHAZA', reasonCode: 'MOTIVO_SINTETICO' })
    await expect(recordCaseDecision({ ...next, supersedes: null })).resolves.toMatchObject({ ok: false, code: 'REVIEW_CONFLICT' })
    await expect(recordCaseDecision({ ...next, supersedes: '99999999' })).resolves.toMatchObject({ ok: false, code: 'REVIEW_CONFLICT' })
    const replaced = await recordCaseDecision(next)
    expect(replaced).toMatchObject({ ok: true, created: true })
    if (!replaced.ok) throw new Error(replaced.code)
    expect(sql(`select supersedes from public.case_review where id = ${replaced.reviewId}`)).toBe(before.currentReviewId)
    await expect(shown('920014')).resolves.toMatchObject({ currentReviewId: replaced.reviewId })
  })
})

describe('las cinco decisiones contra las restricciones reales', () => {
  it('MODIFICA igual a la sugerencia se rechaza; a otra de hasta 2 queda registrada sin aprobacion', async () => {
    actAs('operador')
    const screen = await shown('920014')
    await expect(recordCaseDecision(await inputFor('920014', { decision: 'MODIFICA', reasonCode: 'MOTIVO_SINTETICO', decidedIntervention: screen.suggestedIntervention, decidedIntensity: screen.suggestedIntensity }))).resolves.toMatchObject({ ok: false, code: 'MODIFICA_WITHOUT_CHANGE' })
    const other = screen.suggestedIntervention === 'SEGUIMIENTO' ? 'MEJORAR_DATOS' : 'SEGUIMIENTO'
    const result = await recordCaseDecision(await inputFor('920014', { decision: 'MODIFICA', reasonCode: 'MOTIVO_SINTETICO', decidedIntervention: other, decidedIntensity: 1 }))
    expect(result).toMatchObject({ ok: true, created: true, status: 'REGISTRADA' })
    if (!result.ok) throw new Error(result.code)
    expect(sql(`select decided_intervention, decided_intensity, suggested_intervention from public.case_review where id = ${result.reviewId}`)).toBe(`${other}|1|${screen.suggestedIntervention}`)
  })

  it('DERIVA sin intervencion queda sin decidida; con 4 requiere lista y queda pendiente', async () => {
    actAs('operador')
    const plain = await recordCaseDecision(await inputFor('920014', { decision: 'DERIVA', reasonCode: 'MOTIVO_SINTETICO' }))
    expect(plain).toMatchObject({ ok: true, created: true, status: 'REGISTRADA' })
    if (!plain.ok) throw new Error(plain.code)
    expect(sql(`select decided_intervention is null, decided_intensity is null from public.case_review where id = ${plain.reviewId}`)).toBe('t|t')
    const fourth = { decision: 'DERIVA', reasonCode: 'MOTIVO_SINTETICO', decidedIntervention: 'DERIVACION_PROCURACION', decidedIntensity: 4 }
    await expect(recordCaseDecision(await inputFor('920014', fourth))).resolves.toMatchObject({ ok: false, code: 'CHECKLIST_REQUIRED' })
    await expect(recordCaseDecision(await inputFor('920014', { ...fourth, checklist: READY_CHECKLIST }))).resolves.toMatchObject({ ok: true, created: true, status: 'PENDIENTE_SUPERVISOR' })
  })
})

describe('propuesta intensa y aprobacion', () => {
  let proposalId = ''

  it('MODIFICA a 3 sin lista o sin motivo: rechazado; completa: pendiente de supervisor', async () => {
    actAs('operador')
    await expect(recordCaseDecision(await inputFor('920012', { ...INTENSE, checklist: {} }))).resolves.toMatchObject({ ok: false, code: 'CHECKLIST_REQUIRED' })
    await expect(recordCaseDecision(await inputFor('920012', { ...INTENSE, reasonCode: null }))).resolves.toMatchObject({ ok: false, code: 'REASON_REQUIRED' })
    expect(reviewsOf('920012')).toBe(0)
    const result = await recordCaseDecision(await inputFor('920012', INTENSE))
    expect(result).toMatchObject({ ok: true, created: true, status: 'PENDIENTE_SUPERVISOR' })
    if (!result.ok) throw new Error(result.code)
    proposalId = result.reviewId
    expect(sql(`select suggested_intensity <= 2, decided_intensity from public.case_review where id = ${proposalId}`)).toBe('t|3')
  })

  it('operador aprobando 3 o mas: rechazado', async () => {
    actAs('operador')
    await expect(approveCaseDecision({ caseReviewId: proposalId, decision: 'APRUEBA', checklist: READY_CHECKLIST })).resolves.toMatchObject({ ok: false, code: 'ROLE_FORBIDDEN' })
    expect(count('case_review_approval', 'true')).toBe(0)
  })

  it('supervisor de otro municipio: rechazado como inexistente', async () => {
    actAs('otro-supervisor')
    await expect(approveCaseDecision({ caseReviewId: proposalId, decision: 'APRUEBA', checklist: READY_CHECKLIST })).resolves.toMatchObject({ ok: false, code: 'REVIEW_NOT_IN_TENANT' })
    expect(count('case_review_approval', 'true')).toBe(0)
  })

  it('una decision menor a 3 no se aprueba', async () => {
    actAs('supervisor')
    const low = sql('select id from public.case_review where debtor = 920011 limit 1')
    await expect(approveCaseDecision({ caseReviewId: low, decision: 'APRUEBA', checklist: READY_CHECKLIST })).resolves.toMatchObject({ ok: false, code: 'APPROVAL_NOT_REQUIRED' })
  })

  it('supervisor sin lista: rechazado; con lista: una fila, tambien con doble envio simultaneo', async () => {
    actAs('supervisor')
    await expect(approveCaseDecision({ caseReviewId: proposalId, decision: 'APRUEBA' })).resolves.toMatchObject({ ok: false, code: 'CHECKLIST_REQUIRED' })
    const input = { caseReviewId: proposalId, decision: 'APRUEBA', checklist: READY_CHECKLIST }
    const results = await Promise.all(Array.from({ length: 6 }, () => approveCaseDecision(input)))
    expect(results.every(item => item.ok)).toBe(true)
    expect(results.filter(item => item.ok && item.created)).toHaveLength(1)
    expect(sql(`select count(*), min(approver), min(approver_role), min(decision) from public.case_review_approval where case_review = ${proposalId}`)).toBe(`1|${SUPERVISOR}|supervisor|APRUEBA`)
  })

  it('quien propuso no aprueba aunque luego sea supervisor', async () => {
    sql('update public.tenant_user set role = 920002 where id = 920001')
    actAs('consulta')
    const own = await recordCaseDecision(await inputFor('920015', INTENSE))
    expect(own).toMatchObject({ ok: true, status: 'PENDIENTE_SUPERVISOR' })
    if (!own.ok) throw new Error(own.code)
    sql('update public.tenant_user set role = 920003 where id = 920001')
    await expect(approveCaseDecision({ caseReviewId: own.reviewId, decision: 'APRUEBA', checklist: READY_CHECKLIST })).resolves.toMatchObject({ ok: false, code: 'APPROVER_IS_PROPONENT' })
    sql('update public.tenant_user set role = 920001 where id = 920001')
  })

  it('cambian los insumos desde la propuesta: APRUEBA se frena, OBJETA sigue; una propuesta reemplazada no se aprueba', async () => {
    actAs('supervisor')
    const proposal = sql('select id from public.case_review where debtor = 920015 limit 1')
    sql('update public.debt set current_amount = current_amount + 500 where id = 920015')
    const blocked = await approveCaseDecision({ caseReviewId: proposal, decision: 'APRUEBA', checklist: READY_CHECKLIST })
    expect(blocked).toMatchObject({ ok: false, code: 'SUGGESTION_OUTDATED', changed: ['INSUMOS'] })
    const objection = await approveCaseDecision({ caseReviewId: proposal, decision: 'OBJETA', reasonCode: 'MOTIVO_SINTETICO' })
    expect(objection).toMatchObject({ ok: true, created: true, status: 'OBJETADA' })
    if (!objection.ok) throw new Error(objection.code)
    expect(count('case_review_approval', `case_review = ${proposal}`)).toBe(1)

    actAs('operador')
    const successor = await recordCaseDecision(await inputFor('920015', INTENSE))
    expect(successor).toMatchObject({ ok: true, created: true, status: 'PENDIENTE_SUPERVISOR' })
    actAs('supervisor')
    await expect(approveCaseDecision({ caseReviewId: proposal, decision: 'APRUEBA', checklist: READY_CHECKLIST, supersedes: objection.approvalId })).resolves.toMatchObject({ ok: false, code: 'SUGGESTION_OUTDATED' })
    // Mismos insumos que la propuesta: lo que la frena ahora es que ya no rige.
    sql('update public.debt set current_amount = current_amount - 500 where id = 920015')
    await expect(approveCaseDecision({ caseReviewId: proposal, decision: 'APRUEBA', checklist: READY_CHECKLIST, supersedes: objection.approvalId })).resolves.toMatchObject({ ok: false, code: 'REVIEW_SUPERSEDED' })
  })

  it('una aprobacion distinta debe declarar la vigente', async () => {
    actAs('supervisor')
    const objection = { caseReviewId: proposalId, decision: 'OBJETA', reasonCode: 'MOTIVO_SINTETICO' }
    await expect(approveCaseDecision(objection)).resolves.toMatchObject({ ok: false, code: 'APPROVAL_CONFLICT' })
    const current = sql(`select id from public.case_review_approval where case_review = ${proposalId}`)
    await expect(approveCaseDecision({ ...objection, supersedes: current })).resolves.toMatchObject({ ok: true, created: true, status: 'OBJETADA' })
    expect(count('case_review_approval', `case_review = ${proposalId}`)).toBe(2)
  })
})

describe('corte nuevo', () => {
  it('un lote nuevo publicado invalida lo que estaba en pantalla; uno en curso bloquea y uno fallido a mitad tambien', async () => {
    actAs('operador')
    const input = await inputFor('920011', { decision: 'POSPONE', reasonCode: 'MOTIVO_SINTETICO' })
    const validated = await publishBatch(TENANT_A, '2026-11-15', 'VALIDADO')
    await expect(recordCaseDecision(input)).resolves.toMatchObject({ ok: false, code: 'CUTOFF_NOT_AVAILABLE' })
    const failed = await publishBatch(TENANT_A, '2026-11-15', 'FALLIDO', validated)
    expect(failed).toBeGreaterThan(validated)
    await expect(recordCaseDecision(input)).resolves.toMatchObject({ ok: false, code: 'CUTOFF_NOT_AVAILABLE' })
    const retry = await publishBatch(TENANT_A, '2026-11-15', 'VALIDADO')
    await publishBatch(TENANT_A, '2026-11-15', 'PUBLICADO', retry)
    const stale = await recordCaseDecision(input)
    expect(stale).toMatchObject({ ok: false, code: 'SUGGESTION_OUTDATED', changed: ['INSUMOS', 'CORTE'], current: { asOf: '2026-11-15' } })
    const fresh = await recordCaseDecision(await inputFor('920011', { decision: 'POSPONE', reasonCode: 'MOTIVO_SINTETICO' }))
    expect(fresh).toMatchObject({ ok: true, created: true, asOf: '2026-11-15' })
    if (!fresh.ok) throw new Error(fresh.code)
    expect(sql(`select as_of from public.case_review where id = ${fresh.reviewId}`)).toBe('2026-11-15')
  })

  it('el lote de otro municipio no cambia el corte de este', async () => {
    actAs('operador')
    const before = await shown('920011')
    const validated = await publishBatch(TENANT_B, '2027-01-01', 'VALIDADO')
    await expect(shown('920011')).resolves.toMatchObject({ asOf: before.asOf, inputsHash: before.inputsHash })
    await publishBatch(TENANT_B, '2027-01-01', 'PUBLICADO', validated)
    actAs('otro-operador', TENANT_B)
    await expect(shown('920002')).resolves.toMatchObject({ asOf: '2027-01-01' })
  })
})

describe('credencial', () => {
  const sign = (claims: Record<string, unknown>, secret: string) => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}`
    return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`
  }

  it.each([
    ['sin credencial', () => ''],
    ['con la de importacion', () => config.importJwt],
  ])('%s: no escribe y no filtra nada', async (_name, token) => {
    actAs('otro-operador', TENANT_B)
    const input = await inputFor('920002', { decision: 'POSPONE', reasonCode: 'MOTIVO_SINTETICO' })
    vi.stubEnv('EQUITAS_REVIEW_SERVER_JWT', token())
    try {
      await expect(recordCaseDecision(input)).resolves.toMatchObject({ ok: false, code: 'WRITE_NOT_CONFIGURED' })
    } finally {
      vi.unstubAllEnvs()
    }
    expect(reviewsOf('920002')).toBe(0)
  })

  it.each([
    ['vencida', () => sign({ role: 'equitas_review_server', iat: 1, exp: 2 }, config.jwtSecret)],
    ['firmada con otro secreto', () => sign({ role: 'equitas_review_server', exp: Math.floor(Date.now() / 1000) + 3600 }, 'otro-secreto-sintetico-de-32-caracteres!')],
  ])('credencial %s: no disponible, sin mensaje interno', async (_name, token) => {
    actAs('otro-operador', TENANT_B)
    const input = await inputFor('920002', { decision: 'POSPONE', reasonCode: 'MOTIVO_SINTETICO' })
    vi.stubEnv('EQUITAS_REVIEW_SERVER_JWT', token())
    let result
    try {
      result = await recordCaseDecision(input)
    } finally {
      vi.unstubAllEnvs()
    }
    expect(result).toMatchObject({ ok: false, code: 'WRITE_UNAVAILABLE' })
    expect(JSON.stringify(result)).not.toMatch(/JWT|PGRST|expired|secret/i)
    expect(reviewsOf('920002')).toBe(0)
  })

  it('el operador del municipio B registra en B con su credencial vigente', async () => {
    actAs('otro-operador', TENANT_B)
    const result = await recordCaseDecision(await inputFor('920002'))
    expect(result).toMatchObject({ ok: true, created: true, asOf: '2027-01-01' })
    expect(sql('select tenant, reviewer from public.case_review where debtor = 920002')).toBe(`${TENANT_B}|920007`)
  })
})

describe('integridad final', () => {
  it('ninguna fila tiene un hash o una version que no sean del servidor; las cadenas son lineales', () => {
    expect(count('case_review', `rules_version <> '${RULES_VERSION}'`)).toBe(0)
    expect(count('case_review', `inputs_hash !~ '^[0-9a-f]{64}$'`)).toBe(0)
    expect(count('case_review', `suggested_intensity not between 0 and 2`)).toBe(0)
    expect(Number(sql('select count(*) from (select debtor from public.case_review where supersedes is null group by debtor having count(*) > 1) d'))).toBe(0)
    expect(createHash('sha256').update('').digest('hex')).not.toBe(sql('select inputs_hash from public.case_review limit 1'))
  })
})
