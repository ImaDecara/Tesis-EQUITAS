import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { serverClient, cookieStore, createWriter, getDebtorDetailData, notFound } = vi.hoisted(() => ({
  serverClient: vi.fn(), cookieStore: vi.fn(), createWriter: vi.fn(), getDebtorDetailData: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient: serverClient }))
vi.mock('@/lib/supabase-config', () => ({ hasSupabaseCredentials: true }))
vi.mock('next/headers', () => ({ cookies: cookieStore }))
vi.mock('@/lib/server/case-review-writer', () => ({ createCaseReviewWriter: createWriter }))
vi.mock('@/lib/equitas-data', async importOriginal => ({ ...(await importOriginal<object>()), getDebtorDetailData }))
vi.mock('next/navigation', async importOriginal => ({ ...(await importOriginal<object>()), notFound }))

import { GET as getAccess } from '@/app/api/reports/access/route'
import { GET as getDataQuality } from '@/app/api/reports/data-quality/route'
import { GET as getDecisions } from '@/app/api/reports/decisions/route'
import { GET as getQueue } from '@/app/api/reports/queue/route'
import { GET as getSupervision } from '@/app/api/reports/supervision/route'
import DebtorDetailPage from '@/app/debtors/[debtorId]/page'
import { AccessAuditError, recordAccessAudit } from '@/lib/server/audit'
import { createPaginatedSupabase } from '@/tests/fixtures/paginated-supabase'
import { portfolioTables, reviewTables } from '@/tests/fixtures/reports-portfolio'
import { parseCsvBytes } from '@/tests/helpers/independent-csv-parser'
import { buildDebtorDetail } from '@/tests/helpers/equitas-fixtures'
import type { RawRow } from '@/types/equitas-domain'

const appUser = { id: 42, auth_user: 'auth-test', status: 'ACTIVE' }
const membership = { id: 1, user: 42, tenant: 7, role: 3, status: true }
const stored = [
  { id: 11, tenant: 7, actor: 42, actor_role: 'operador', action: 'CASE_OPEN', target: '910001', created_at: '2026-11-01T23:59:59.000+00:00' },
  { id: 12, tenant: 7, actor: 43, actor_role: 'supervisor', action: 'REPORT_EXPORT', target: 'supervision', created_at: '2026-11-02T00:00:00.000+00:00' },
  { id: 13, tenant: 8, actor: 99, actor_role: 'supervisor', action: 'CASE_OPEN', target: '999999', created_at: '2026-11-02T01:00:00.000+00:00' },
] satisfies RawRow[]

const REPORTS = [
  ['queue', getQueue, 'cola-de-trabajo'], ['decisions', getDecisions, 'decisiones'], ['supervision', getSupervision, 'supervision'],
  ['data-quality', getDataQuality, 'calidad-de-datos'], ['access', getAccess, 'accesos'],
] as const
const request = (name: string, query = '') => new Request(`http://127.0.0.1/api/reports/${name}${query}`)

function session(role = 'supervisor', signedIn = true, tables: Record<string, RawRow[]> = {}, options: Parameters<typeof createPaginatedSupabase>[1] = {}) {
  const fixture = createPaginatedSupabase({
    user: [appUser], tenant_user: [membership], tenant: [{ id: 7, status: 'ACTIVE' }], role: [{ id: 3, name: role }],
    ...portfolioTables(), ...reviewTables(), access_audit: stored, ...tables,
  }, { enforceFilters: true, ...options })
  vi.spyOn(fixture.client.auth, 'getUser').mockResolvedValue(signedIn
    ? { data: { user: { id: 'auth-test' } }, error: null } as never
    : { data: { user: null }, error: null } as never)
  serverClient.mockResolvedValue(fixture.client)
  return fixture
}

const auditOk = () => ({ data: { audit_id: 1, created: true }, error: null })
function writer(result: () => unknown = auditOk) {
  const rpc = vi.fn(async () => result())
  createWriter.mockReturnValue({ rpc })
  return rpc
}
const rpcArguments = (rpc: ReturnType<typeof writer>) => (rpc.mock.calls as unknown[][]).map(call => call[1] as Record<string, unknown>)

const openCase = (id = '910001') => DebtorDetailPage({ params: Promise.resolve({ debtorId: id }) } as never)

beforeEach(() => {
  vi.resetAllMocks()
  notFound.mockImplementation(() => { throw new Error('NEXT_NOT_FOUND') })
  cookieStore.mockResolvedValue({ get: () => undefined })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  getDebtorDetailData.mockResolvedValue({ detail: buildDebtorDetail(), warnings: [] })
})
afterEach(() => { vi.restoreAllMocks() })

describe('ALIGN-069: cada exportacion entregada deja exactamente un registro', () => {
  it.each(REPORTS)('%s: un registro con actor y municipio de la sesion, despues de leer y antes de responder', async (name, get, code) => {
    const rpc = writer()
    const { requests } = session()
    let readsBeforeAudit = -1
    rpc.mockImplementation(async () => { readsBeforeAudit = requests.length; return auditOk() })
    const response = await get(request(name))
    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect((rpc.mock.calls as unknown[][])[0][0]).toBe('record_access_audit')
    expect(rpcArguments(rpc)[0]).toEqual({
      p_actor_user: '42', p_tenant: '7', p_action: 'REPORT_EXPORT', p_target: code, p_idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/),
    })
    expect(readsBeforeAudit).toBe(requests.length)
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="equitas-${code}.csv"`)
  })

  it('dos descargas son dos acciones: dos registros y dos claves distintas', async () => {
    const rpc = writer()
    session()
    await getSupervision(request('supervision'))
    await getSupervision(request('supervision'))
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(new Set(rpcArguments(rpc).map(args => args.p_idempotency_key)).size).toBe(2)
  })

  it.each(REPORTS)('%s sin sesion: 401 y ningun registro', async (name, get) => {
    const rpc = writer()
    session('supervisor', false)
    expect((await get(request(name))).status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([['importador', 'queue', getQueue], ['consulta', 'supervision', getSupervision]] as const)('%s en %s: 403 y ningun registro', async (role, name, get) => {
    const rpc = writer()
    session(role)
    expect((await get(request(name))).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each(REPORTS)('%s con filtro invalido: 400 y ningun registro', async (name, get) => {
    const rpc = writer()
    session()
    expect((await get(request(name, '?inventado=1'))).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('con una lectura fallida no hay archivo ni registro', async () => {
    const rpc = writer()
    session('supervisor', true, {}, { fail: read => read.table === 'access_audit' ? { message: 'caida', code: '57014' } : null })
    const response = await getAccess(request('access'))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: 'LECTURA_FALLIDA', tablas: ['access_audit'] })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('ALIGN-069: falla cerrada', () => {
  const SECRET_DETAIL = 'duplicate key value (tenant, actor)=(7, 42) Ana Perez'
  const failures: [string, () => void][] = [
    ['la base rechaza', () => writer(() => ({ data: null, error: { code: 'P0001', message: SECRET_DETAIL } }))],
    ['error sin codigo', () => writer(() => ({ data: null, error: { code: '', message: SECRET_DETAIL } }))],
    ['respuesta sin id', () => writer(() => ({ data: { created: true }, error: null }))],
    ['respuesta nula', () => writer(() => ({ data: null, error: null }))],
    ['sin conexion', () => writer(() => { throw new Error(SECRET_DETAIL) })],
    ['sin credencial', () => createWriter.mockReturnValue(null)],
  ]

  it.each(failures)('reporte, %s: 503 sin archivo y sin el mensaje de la base', async (_name, arrange) => {
    arrange()
    session()
    const response = await getSupervision(request('supervision'))
    expect(response.status).toBe(503)
    expect(response.headers.get('content-disposition')).toBeNull()
    expect(await response.json()).toEqual({ error: 'AUDITORIA_NO_DISPONIBLE' })
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('Ana Perez')
  })

  it.each(failures)('ficha, %s: la pagina no se entrega', async (_name, arrange) => {
    arrange()
    session()
    await expect(openCase()).rejects.toBeInstanceOf(AccessAuditError)
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('Ana Perez')
  })

  it('el registro de la falla no lleva el destino: solo accion y codigo', async () => {
    writer(() => ({ data: null, error: { code: 'P0001', message: SECRET_DETAIL } }))
    await expect(recordAccessAudit({ appUserId: '42', tenantId: '7' }, { action: 'CASE_OPEN', target: '910001' })).rejects.toThrow(AccessAuditError)
    expect(vi.mocked(console.error).mock.calls).toEqual([['Auditoria no registrada: CASE_OPEN P0001']])
  })

  it('una clave explicita viaja tal cual, para que un reintento no duplique (057)', async () => {
    const rpc = writer()
    const key = '6a1c6f4e-7f1e-4a57-9a55-7a7e0a1c2b3d'
    await recordAccessAudit({ appUserId: '42', tenantId: '7' }, { action: 'IMPORT_CONFIRM', target: '5', idempotencyKey: key })
    expect(rpcArguments(rpc)[0]).toMatchObject({ p_action: 'IMPORT_CONFIRM', p_target: '5', p_idempotency_key: key })
  })

  it('tambien acepta la respuesta de la funcion como lista', async () => {
    writer(() => ({ data: [{ audit_id: 9, created: false }], error: null }))
    await expect(recordAccessAudit({ appUserId: '42', tenantId: '7' }, { action: 'ANALYTICS_VIEW', target: 'segmentos' })).resolves.toBeUndefined()
  })
})

describe('ALIGN-069: apertura de la ficha', () => {
  it('abrirla deja un registro con el id interno y sin ningun otro dato', async () => {
    const rpc = writer()
    session('consulta')
    const detail = buildDebtorDetail()
    await openCase(detail.debtor.id)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpcArguments(rpc)[0]).toEqual({
      p_actor_user: '42', p_tenant: '7', p_action: 'CASE_OPEN', p_target: detail.debtor.id, p_idempotency_key: expect.any(String),
    })
    expect(JSON.stringify(rpcArguments(rpc)[0])).not.toContain(detail.debtor.identifier)
  })

  it('tp_operator lee cartera y queda registrado: la compatibilidad no es un camino sin rastro', async () => {
    const rpc = writer()
    session('tp_operator')
    await openCase()
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('un objeto inexistente o de otro municipio no deja registro', async () => {
    const rpc = writer()
    session('consulta')
    getDebtorDetailData.mockResolvedValue({ detail: null, warnings: [] })
    await expect(openCase('999999')).rejects.toThrow('NEXT_NOT_FOUND')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('una lectura denegada no deja registro', async () => {
    const rpc = writer()
    session('consulta')
    getDebtorDetailData.mockRejectedValue(new Error('denegado'))
    await expect(openCase()).rejects.toThrow('denegado')
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('ALIGN-069: reporte de accesos', () => {
  const download = async (query = '') => {
    writer()
    session()
    const response = await getAccess(request('access', query))
    expect(response.status).toBe(200)
    return parseCsvBytes(new Uint8Array(await response.arrayBuffer())).rows
  }
  const details = (rows: Record<string, string>[]) => rows.filter(row => row.tipo_fila === 'DETALLE')
  const total = (rows: Record<string, string>[]) => rows.filter(row => row.tipo_fila === 'TOTAL')

  it.each(['consulta', 'operador', 'importador', 'tp_operator'])('%s no lo recibe', async role => {
    const rpc = writer()
    const { requests } = session(role)
    expect((await getAccess(request('access'))).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
    expect(requests.some(entry => entry.table === 'access_audit')).toBe(false)
  })

  it('coincide con los registros del municipio, fila por fila, y filtra por municipio aun sin RLS', async () => {
    const rows = await download()
    expect(details(rows).map(row => [row.registro_id, row.fecha, row.accion, row.objetivo, row.actor_id, row.rol_actor])).toEqual([
      ['11', '2026-11-01T23:59:59.000Z', 'CASE_OPEN', '910001', '42', 'operador'],
      ['12', '2026-11-02T00:00:00.000Z', 'REPORT_EXPORT', 'supervision', '43', 'supervisor'],
    ])
    expect(total(rows).map(row => row.registros)).toEqual(['2'])
    expect(details(rows).every(row => row.registros === '1')).toBe(true)
  })

  it('sin registros: solo el total en cero', async () => {
    writer()
    session('supervisor', true, { access_audit: [] })
    const response = await getAccess(request('access'))
    const rows = parseCsvBytes(new Uint8Array(await response.arrayBuffer())).rows
    expect(details(rows)).toEqual([])
    expect(total(rows).map(row => row.registros)).toEqual(['0'])
  })

  it.each([
    ['?desde=2026-11-02', ['12']],
    ['?hasta=2026-11-01', ['11']],
    ['?desde=2026-11-01&hasta=2026-11-02', ['11', '12']],
    ['?accion=CASE_OPEN', ['11']],
    ['?actor=43', ['12']],
    ['?actor=41', []],
  ])('filtro %s', async (query, ids) => {
    const rows = await download(query)
    expect(details(rows).map(row => row.registro_id)).toEqual(ids)
    expect(total(rows).map(row => row.registros)).toEqual([String(ids.length)])
    expect(rows.every(row => row.filtros !== 'SIN_FILTROS')).toBe(true)
  })

  it.each(['?desde=2026-13-01', '?hasta=ayer', '?desde=2026-11-02&hasta=2026-11-01', '?accion=OTRA', '?actor=abc', '?actor=-1', '?accion=CASE_OPEN&accion=REPORT_EXPORT'])('rechaza %s', async query => {
    const rpc = writer()
    session()
    expect((await getAccess(request('access', query))).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('ALIGN-069: frontera', () => {
  const FRONT = fileURLToPath(new URL('../..', import.meta.url))
  const routes = (directory: string): string[] => readdirSync(directory).flatMap(entry => {
    const path = join(directory, entry)
    return statSync(path).isDirectory() ? routes(path) : entry === 'route.ts' ? [path] : []
  })

  it('todo reporte pasa por csvReportResponse: no hay exportacion sin auditar', () => {
    const files = routes(join(FRONT, 'app/api/reports'))
    expect(files.length).toBe(REPORTS.length)
    for (const file of files) expect(readFileSync(file, 'utf8'), file).toContain('csvReportResponse(')
  })

  it('el punto unico registra despues de armar el archivo y antes de responder', () => {
    const source = readFileSync(join(FRONT, 'lib/server/report-response.ts'), 'utf8')
    const built = source.indexOf('await build(access)')
    const audited = source.indexOf('await recordAccessAudit(')
    const answered = source.indexOf('return new Response(csv')
    expect(built).toBeGreaterThan(-1)
    expect(audited).toBeGreaterThan(built)
    expect(answered).toBeGreaterThan(audited)
  })

  it('el modulo exige servidor y no escribe la tabla sino por la funcion', () => {
    const source = readFileSync(join(FRONT, 'lib/server/audit.ts'), 'utf8')
    expect(source.startsWith("import 'server-only'")).toBe(true)
    expect(source).not.toMatch(/\.(?:insert|update|upsert|delete)\(/)
    expect([...source.matchAll(/\.rpc\('([a-z_]+)'/g)].map(match => match[1])).toEqual(['record_access_audit'])
  })

  it('la pagina audita despues de notFound y una sola vez', () => {
    const source = readFileSync(join(FRONT, 'app/debtors/[debtorId]/page.tsx'), 'utf8')
    expect(source.match(/auditCaseOpen\(/g)).toHaveLength(1)
    expect(source.indexOf('auditCaseOpen(')).toBeGreaterThan(source.indexOf('notFound()'))
  })
})
