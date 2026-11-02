import { createHmac, randomUUID } from 'node:crypto'
import { expect } from 'vitest'

import type { ReviewAccount } from '../local-review/config'
import { config, READY_CHECKLIST, sql } from '../local-review/http-support'

// ALIGN-022. Lo que usa la campaña sobre las herramientas de ALIGN-020. Nunca imprime claves ni contraseñas.
export type Account = ReviewAccount | 'importador-real'
// `local-review/fixture.sql` deja a la cuenta `importador` con rol tp_operator: este alias lo dice en cada prueba.
export const TP_OPERATOR: Account = 'importador'
export const ACCOUNTS: Account[] = ['consulta', 'operador', 'supervisor', TP_OPERATOR, 'importador-real', 'sin-membresia', 'inactivo', 'otro-operador', 'otro-supervisor']

export const TENANT = { A: 920001, B: 920002, INACTIVE: 920003 } as const
export const OBJECT = { A: 920001, B: 920002, INACTIVE: 920003 } as const
export const USER = {
  consulta: 920001, operador: 920002, supervisor: 920003, tpOperator: 920004, sinMembresia: 920005, inactivo: 920006,
  otroOperador: 920007, otroSupervisor: 920008, sistema: 920009, importador: 920010, usuarioInactivo: 920011,
  municipioInactivo: 920012, proponente: 920013,
} as const
export const AS_OF = '2026-10-30'
export const INTERVENTION = 'RECORDATORIO_INFORMATIVO'
export const MISSING_ID = 999999999
export const DECISION_TABLES = ['case_review', 'case_review_approval', 'import_batch'] as const
export const INTENSE = {
  p_decided_intervention: 'INTIMACION_ADMINISTRATIVA', p_decided_intensity: 3, p_reason_code: 'MOTIVO_SINTETICO', p_checklist: READY_CHECKLIST,
}

export type Reply = { status: number; body: unknown; code: unknown; message: unknown; details: unknown }

export async function api(method: string, path: string, options: { token?: string; body?: unknown; prefer?: string } = {}): Promise<Reply> {
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
    headers: {
      apikey: config.publishableKey,
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.prefer ? { Prefer: options.prefer } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  let body: unknown = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  const fields = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  return { status: response.status, body, code: fields.code ?? null, message: fields.message ?? null, details: fields.details ?? null }
}

export async function signIn(label: Account) {
  const accounts = config.accounts as unknown as Record<Account, { email: string; password: string }>
  const reply = await api('POST', '/auth/v1/token?grant_type=password', { body: accounts[label] })
  expect(reply.status, `login ${label}`).toBe(200)
  return (reply.body as { access_token: string }).access_token
}

export const recordReview = (body: unknown, token = config.reviewJwt) => api('POST', '/rest/v1/rpc/record_case_review', { token, body })
export const recordApproval = (body: unknown, token = config.reviewJwt) => api('POST', '/rest/v1/rpc/record_case_review_approval', { token, body })
export const recordBatch = (body: unknown, token = config.importJwt) => api('POST', '/rest/v1/rpc/record_import_batch', { token, body })
export const readReason = (user: number, tenant: number, review: number, token = config.reviewJwt) =>
  api('POST', '/rest/v1/rpc/read_case_review_reason_text', { token, body: { p_actor_user: user, p_tenant: tenant, p_case_review: review } })

export function reviewBody(user: number, tenant: number, debtor: number, cutoff: number | null, extra: Record<string, unknown> = {}) {
  return {
    p_reviewer_user: user, p_tenant: tenant, p_debtor: debtor, p_cutoff_batch: cutoff, p_rules_version: '1.0.0', p_as_of: AS_OF,
    p_inputs_hash: 'a'.repeat(64), p_suggested_intervention: INTERVENTION, p_suggested_intensity: 1, p_explanation: { factores: [] },
    p_decision: 'ACEPTA', p_idempotency_key: randomUUID(), p_decided_intervention: INTERVENTION, p_decided_intensity: 1, ...extra,
  }
}

export const proposalBody = (user: number, tenant: number, debtor: number, cutoff: number | null, extra: Record<string, unknown> = {}) =>
  reviewBody(user, tenant, debtor, cutoff, { p_decision: 'MODIFICA', ...INTENSE, ...extra })

export function approvalBody(user: number, tenant: number, review: number, cutoff: number | null, extra: Record<string, unknown> = {}) {
  return {
    p_approver_user: user, p_tenant: tenant, p_case_review: review, p_decision: 'APRUEBA', p_idempotency_key: randomUUID(),
    p_cutoff_batch: cutoff, p_checklist: READY_CHECKLIST, ...extra,
  }
}

export function batchBody(user: number, tenant: number, extra: Record<string, unknown> = {}) {
  return {
    p_actor_user: user, p_tenant: tenant, p_source: 'ETL_CLI', p_file_hashes: { cabecera: 'b'.repeat(64) }, p_as_of: AS_OF,
    p_rules_version: '1.0.0', p_status: 'RECIBIDO', p_idempotency_key: randomUUID(), p_counts: { filas: 1 }, ...extra,
  }
}

export function createdId(reply: Reply, field: 'review_id' | 'approval_id' | 'batch_id') {
  expect(reply.status, `se esperaba crear ${field}; codigo ${String(reply.code)}, mensaje ${String(reply.message)}`).toBe(200)
  const body = reply.body as Record<string, unknown>
  expect(body.created, 'fila nueva').toBe(true)
  return Number(body[field])
}

// VALIDADO y PUBLICADO por la funcion real, como el ETL. Lote validado: el corte vigente es este.
export async function publishCutoff(tenant: number, asOf = AS_OF) {
  const validated = createdId(await recordBatch(batchBody(USER.sistema, tenant, { p_status: 'VALIDADO', p_as_of: asOf })), 'batch_id')
  return createdId(await recordBatch(batchBody(USER.sistema, tenant, { p_status: 'PUBLICADO', p_as_of: asOf, p_supersedes: validated })), 'batch_id')
}

// Falta de privilegio o de firma: el codigo de PostgreSQL o de PostgREST, no una regla de datos.
export function expectCode(reply: Reply, code: string, what = '') {
  expect(reply.status, `${what} http`).toBeGreaterThanOrEqual(400)
  expect(reply.code, what).toBe(code)
}

// Rechazo de una funcion: mensaje estable, sin la fila en el detalle.
export function expectRejected(reply: Reply, message: string, what = '') {
  expect(reply.message, what).toBe(message)
  expect(reply.status, `${what} http`).toBe(400)
  expect(reply.details, `${what} sin detalle de fila`).toBeNull()
}

export const rowCounts = () => sql('select (select count(*) from public.case_review), (select count(*) from public.case_review_approval), (select count(*) from public.import_batch)')

// Toda denegacion se comprueba contra la base: que no entro ninguna fila, en ninguna de las tres tablas.
export async function withoutWrites(run: () => Promise<void>) {
  const before = rowCounts()
  await run()
  expect(rowCounts(), 'ninguna fila nueva').toBe(before)
}

export function sqlError(statement: string) {
  try {
    sql(statement)
    return null
  } catch (error) {
    return String((error as { stderr?: unknown }).stderr ?? error)
  }
}

const b64url = (value: string | Buffer) => Buffer.from(value).toString('base64url')

export function signJwt(claims: Record<string, unknown>, secret = config.jwtSecret, expiresInSeconds = 3600) {
  const now = Math.floor(Date.now() / 1000)
  const head = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: 'equitas-local', iat: now, exp: now + expiresInSeconds, ...claims }))}`
  return `${head}.${createHmac('sha256', secret).update(head).digest('base64url')}`
}

// Misma firma, otro contenido: lo que haria quien edita su propio token.
export function tamperRole(token: string, role: string) {
  const [head, payload, signature] = token.split('.')
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
  return `${head}.${b64url(JSON.stringify({ ...claims, role }))}.${signature}`
}
