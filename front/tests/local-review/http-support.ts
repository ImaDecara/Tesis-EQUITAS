import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServerClient } from '@supabase/ssr'
import { expect } from 'vitest'

import { readLocalReviewConfig, type ReviewAccount } from './config'

// ALIGN-020. Lo que comparten las suites por HTTP contra `next start`: acciones compiladas, sesiones reales y psql local.
export const config = readLocalReviewConfig()
export const BASE = process.env.EQUITAS_REVIEW_HTTP_BASE ?? ''
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE)) throw new Error('Falta EQUITAS_REVIEW_HTTP_BASE local; la prueba no se omite.')
const PAGE = `${BASE}/align020-probe`
const CONTAINER = 'supabase_db_equitas-tp-testing'
export const READY_CHECKLIST = { situacion_hogar: 'NO_DISPONIBLE', estado_juridico_verificado: true, canal_valido: true, alternativa_asistida_ofrecida: true }
export const TENANT_A = '920001'
const SYSTEM_USER = 920009

const psql = (user: string, statement: string) => execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-X', '-U', user, '-d', 'postgres', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8' }).trim()

export const sql = (statement: string) => psql('postgres', statement)
// Solo para mirar pg_stat_activity y pg_locks: postgres no ve el texto de otras sesiones.
const monitor = (statement: string) => psql('supabase_admin', statement)

export const reviews = (debtor: string) => Number(sql(`select count(*) from public.case_review where debtor = ${debtor}`))
export const approvals = (review: unknown) => Number(sql(`select count(*) from public.case_review_approval where case_review = ${review}`))

export function actionIds() {
  const manifest = JSON.parse(readFileSync('.next/server/server-reference-manifest.json', 'utf8')) as { node: Record<string, { exportedName: string }> }
  const find = (name: string) => {
    const id = Object.keys(manifest.node).find(item => manifest.node[item].exportedName === name)
    if (!id) throw new Error(`No se encontro la accion ${name}`)
    return id
  }
  return { record: find('recordCaseDecision'), approve: find('approveCaseDecision') }
}

export async function cookieFor(label: ReviewAccount, tenant?: string) {
  const cookies = new Map<string, string>()
  const client = createServerClient(config.supabaseUrl, config.publishableKey, {
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: values => { for (const { name, value } of values) cookies.set(name, value) },
    },
  })
  const { error } = await client.auth.signInWithPassword(config.accounts[label])
  expect(error?.code ?? null, `login ${label}`).toBeNull()
  if (tenant) cookies.set('equitas_tenant_id', tenant)
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')
}

export async function post(actionId: string, input: unknown, options: { cookie?: string; origin?: string } = {}) {
  const response = await fetch(PAGE, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Next-Action': actionId,
      Accept: 'text/x-component',
      'Content-Type': 'text/plain;charset=UTF-8',
      Origin: options.origin ?? BASE,
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: JSON.stringify([input]),
  })
  const body = await response.text()
  expect(body, 'la respuesta nunca trae la credencial').not.toContain(config.reviewJwt)
  expect(body).not.toContain('EQUITAS_REVIEW_SERVER_JWT')
  const row = body.split('\n').find(line => line.startsWith('1:{'))
  return { status: response.status, location: response.headers.get('location'), body, result: row ? JSON.parse(row.slice(2)) as Record<string, unknown> : null }
}

// Registra un evento por la funcion real de importacion: esa es la coordinacion que se prueba.
export async function registerBatch(status: string, asOf: string, supersedes: number | null = null) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/record_import_batch`, {
    method: 'POST',
    headers: { apikey: config.publishableKey, Authorization: `Bearer ${config.importJwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_actor_user: SYSTEM_USER, p_tenant: Number(TENANT_A), p_source: 'ETL_CLI', p_file_hashes: { cabecera: 'b'.repeat(64) }, p_as_of: asOf, p_rules_version: '1.0.0',
      p_status: status, p_idempotency_key: randomUUID(), p_counts: { filas: 1 }, p_source_updated_at: '2026-10-29', p_supersedes: supersedes,
    }),
  })
  expect(response.status, `lote ${status} registrado`).toBe(200)
  return (await response.json() as { batch_id: number }).batch_id
}

async function waitFor(what: string, condition: () => boolean, timeoutMs = 20_000) {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Tiempo agotado esperando: ${what}`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

// Sesion SQL abierta que retiene un advisory lock. Con esto la ventana concurrente es determinista, sin pausas.
export async function holdAdvisoryLock(key: string, also: string[] = [], mode: 'exclusive' | 'shared' = 'exclusive') {
  const name = `align020-${randomUUID().slice(0, 8)}`
  const take = mode === 'shared' ? 'pg_advisory_xact_lock_shared' : 'pg_advisory_xact_lock'
  const child = spawn('docker', ['exec', '-i', CONTAINER, 'psql', '-X', '-q', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'ignore', 'ignore'] })
  child.stdin.write(`set application_name = '${name}';\nbegin;\nselect ${take}(hashtextextended('${key}', 0));\n${also.map(line => `${line}\n`).join('')}select pg_sleep(0);\n`)
  await waitFor(`el bloqueo ${key}`, () => Number(monitor(`select count(*) from pg_locks l join pg_stat_activity a using (pid) where a.application_name = '${name}' and l.locktype = 'advisory' and l.granted`)) >= 1)
  if (also.length > 0) {
    await waitFor('las sentencias de la sesion', () => Number(monitor(`select count(*) from pg_stat_activity where application_name = '${name}' and state = 'idle in transaction'`)) === 1 && Number(monitor(`select coalesce(max(backend_xid::text::bigint), 0) from pg_stat_activity where application_name = '${name}'`)) > 0)
  }
  return {
    release: () => new Promise<void>(resolve => {
      child.once('exit', () => resolve())
      child.stdin.end('commit;\n')
    }),
  }
}

const waitingOn = (name: string) => Number(monitor(`select count(*) from pg_stat_activity where wait_event_type = 'Lock' and wait_event = 'advisory' and query like '%${name}%'`))

// La RPC ya salio de la accion y esta esperando un advisory lock en la base: justo la ventana de la revision.
export async function untilFunctionWaits(atLeast = 1) {
  await waitFor('la RPC en espera del bloqueo', () => waitingOn('record_case_review') >= atLeast)
}

export async function untilImportWaits() {
  await waitFor('la funcion de lotes en espera del bloqueo', () => waitingOn('record_import_batch') >= 1)
}
