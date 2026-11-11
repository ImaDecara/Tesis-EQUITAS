import { createClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { serverClient } = vi.hoisted(() => ({ serverClient: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient: serverClient }))
vi.mock('@/lib/supabase-config', () => ({ hasSupabaseCredentials: true, supabaseUrl: 'https://base.example.test', supabasePublishableKey: 'synthetic-public-key' }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))

import { GET as queue } from '@/app/api/reports/queue/route'
import { GET as quality } from '@/app/api/reports/data-quality/route'
import { GET as decisions } from '@/app/api/reports/decisions/route'
import { GET as supervision } from '@/app/api/reports/supervision/route'
import { GET as access } from '@/app/api/reports/access/route'
import { getDashboardData, getDebtorDetailData, getDebtorsData, getPeopleData } from '@/lib/equitas-data'
import { loadRawDebtorData } from '@/lib/data/raw-debtor-loader'
import { loadClusteringForViewer } from '@/lib/ml/server'
import { auditCaseOpen } from '@/lib/server/audit'
import { loadCaseReviewScreen } from '@/lib/server/case-review-screen'
import { approveCaseDecisionInSession, recordCaseDecisionInSession } from '@/lib/server/case-review-service'
import { DatabaseLevelError, loadDatabaseLevel, MODULE_TABLES } from '@/lib/server/database-level'
import { loadRecordedDecisions } from '@/lib/server/recorded-decisions'
import { loadViewerContext } from '@/lib/server/viewer-context'
import { createPaginatedSupabase } from '@/tests/fixtures/paginated-supabase'
import { portfolioTables } from '@/tests/fixtures/reports-portfolio'

// SDK real; se sustituye solo Auth y el transporte. El escritor NO está simulado:
// si un camino lo usa, queda un POST /rpc/ en la traza y la prueba falla.
function session(options: { missing?: readonly string[]; fail?: { table: string; status: number; code: string }; hidden?: string } = {}) {
  const missing = options.missing ?? MODULE_TABLES
  const inner = createPaginatedSupabase({
    ...portfolioTables(),
    user: [{ id: 42, auth_user: 'auth-test', status: 'ACTIVE' }],
    tenant_user: [{ id: 1, user: 42, tenant: 7, role: 1, status: true }],
    tenant: [{ id: 7, status: 'ACTIVE', name: 'Municipio sintético' }], role: [{ id: 1, name: 'ADMIN' }],
    ...(options.hidden ? { [options.hidden]: [] } : {}),
  }, { enforceFilters: true })
  const forward = (inner.client as unknown as { rest: { fetch: typeof fetch } }).rest.fetch
  const trace: { method: string; path: string }[] = []
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    trace.push({ method: init?.method ?? (input instanceof Request ? input.method : 'GET'), path: url.pathname })
    const table = url.pathname.split('/').at(-1)!
    if (options.fail?.table === table) return new Response(JSON.stringify({ code: options.fail.code }), { status: options.fail.status })
    if (missing.includes(table)) return new Response(JSON.stringify({ code: 'PGRST205' }), { status: 404 })
    if (url.pathname.includes('/rpc/')) return new Response(JSON.stringify({ audit_id: 9 }), { status: 200 })
    return forward(input, init)
  }
  vi.stubGlobal('fetch', transport)
  const client = createClient('https://base.example.test', 'synthetic-public-key', {
    global: { fetch: transport }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  vi.spyOn(client.auth, 'getUser').mockResolvedValue({ data: { user: { id: 'auth-test' } }, error: null } as never)
  serverClient.mockResolvedValue(client)
  return trace
}

beforeEach(() => { vi.resetAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => undefined) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

describe('BASE: recorrido de transporte sin escrituras ni RPC', () => {
  it.each([false, true])('tablero, listado, búsqueda, personas, ficha y reportes; credencial de servidor=%s', async configured => {
    vi.stubEnv('EQUITAS_REVIEW_SERVER_JWT', configured ? `synthetic.${Buffer.from(JSON.stringify({ role: 'equitas_review_server' })).toString('base64url')}.signature` : '')
    const trace = session()
    expect((await loadViewerContext())?.moduleMissing).toBe(true)
    await getDashboardData()
    const list = await getDebtorsData()
    expect(list.debtors.length).toBeGreaterThan(0)
    // La búsqueda filtra en memoria, igual que la pantalla: nunca envía texto a PostgREST.
    expect(list.debtors.filter(row => row.identifier.includes('OBJ-CONTACTO'))).toHaveLength(1)
    await getPeopleData()
    expect((await getDebtorDetailData('101')).detail).not.toBeNull()
    await auditCaseOpen('101')
    expect((await loadCaseReviewScreen('101')).kind).toBe('unavailable')
    expect(await loadRecordedDecisions()).toEqual({ ok: false, reason: 'NO_MODULE' })
    expect(await recordCaseDecisionInSession({})).toMatchObject({ ok: false, code: 'MODULE_NOT_AVAILABLE' })
    expect(await approveCaseDecisionInSession({})).toMatchObject({ ok: false, code: 'MODULE_NOT_AVAILABLE' })
    for (const report of [queue, quality, decisions, supervision, access]) {
      expect((await report(new Request('http://local.test/api/reports/queue'))).status).toBe(501)
    }
    await loadClusteringForViewer() // En esta rama todavía es un punto de entrada sin implementar.
    expect(trace.length).toBeGreaterThan(30)
    expect(trace.every(request => ['GET', 'HEAD'].includes(request.method) && /^\/rest\/v1\/[^/]+$/.test(request.path))).toBe(true)
    expect(trace.some(request => request.path.includes('/rpc/'))).toBe(false)
  })

  it.each(Array.from({ length: 14 }, (_, index) => index + 1))('ningún esquema parcial se declara BASE o módulo comprobado: máscara %i', async mask => {
    const missing = MODULE_TABLES.filter((_, index) => (mask & (1 << index)) !== 0)
    session({ missing })
    await expect(loadDatabaseLevel()).rejects.toBeInstanceOf(DatabaseLevelError)
    const viewer = await loadViewerContext()
    expect(viewer?.portfolio.kind).toBe('UNAVAILABLE')
    expect(viewer?.moduleMissing).toBeUndefined()
    expect((await queue(new Request('http://local.test/api/reports/queue'))).status).toBe(503)
  })

  it.each([
    ['debt', 400, '42703'], ['debtor', 404, 'PGRST205'], ['person', 401, 'PGRST301'],
    ['debtor_contact', 403, '42501'], ['case_review', 503, 'PGRST002'],
  ] as const)('%s con HTTP %i nunca es cartera vacía ni BASE limpio', async (table, status, code) => {
    vi.useFakeTimers()
    session({ fail: { table, status, code } })
    const level = expect(loadDatabaseLevel()).rejects.toBeInstanceOf(DatabaseLevelError)
    await vi.runAllTimersAsync()
    await level
    const viewer = loadViewerContext()
    await vi.runAllTimersAsync()
    expect((await viewer)?.portfolio.kind).toBe('UNAVAILABLE')
    const raw = loadRawDebtorData()
    await vi.runAllTimersAsync()
    expect((await raw).warnings.length).toBeGreaterThan(0)
  })

  it.each(['debtor', 'debt', 'person', 'debtor_contact', 'debtor_type', 'debt_status'])('%s oculto por políticas no se convierte en ausencia confirmada', async hidden => {
    session({ hidden })
    const raw = await loadRawDebtorData()
    expect(raw.warnings).toContainEqual(expect.objectContaining({ table: hidden, code: 'BASE_VISIBILITY_UNKNOWN' }))
    if (hidden === 'debtor') expect((await loadViewerContext())?.portfolio.kind).toBe('UNAVAILABLE')
  })
})
