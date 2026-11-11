import { beforeEach, describe, expect, it, vi } from 'vitest'

const { serverClient, cookieStore } = vi.hoisted(() => ({ serverClient: vi.fn(), cookieStore: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient: serverClient }))
vi.mock('@/lib/supabase-config', () => ({ hasSupabaseCredentials: true }))
vi.mock('next/headers', () => ({ cookies: cookieStore }))

import { RULES_VERSION } from '@/lib/domain/decision-rules-v1'
import { resolvePortfolioCutoff } from '@/lib/server/portfolio-cutoff'
import { buildRecordedDecisions, loadRecordedDecisions } from '@/lib/server/recorded-decisions'
import { capabilitiesFor, loadViewerContext, roleLabel } from '@/lib/server/viewer-context'
import type { RawRow } from '@/types/equitas-domain'
import { createPaginatedSupabase, type DataRequest } from '../fixtures/paginated-supabase'

// Noche 7. Contexto de quien mira (línea fija y menú) y decisión vigente de cada caso (encabezado,
// listados y Pendientes), leídos con la DAL real: solo Auth y el transporte REST están simulados.

const TENANT = 7
const VIEWER = 9042
const OTHER = 9043
const THIRD = 9044
const PUBLISHED: RawRow[] = [
  { id: 1, tenant: TENANT, as_of: '2026-09-30', source_updated_at: '2026-09-29', status: 'VALIDADO', supersedes: null },
  { id: 2, tenant: TENANT, as_of: '2026-09-30', source_updated_at: '2026-09-29', status: 'PUBLICADO', supersedes: 1 },
]

function session(role: string, tables: Record<string, RawRow[]> = {}, options: { signedIn?: boolean; fail?: (request: DataRequest) => { message: string; code?: string } | null } = {}) {
  const fixture = createPaginatedSupabase({
    user: [{ id: VIEWER, auth_user: 'auth-test', status: 'ACTIVE', full_name: '  Persona Sintética  ' }],
    tenant_user: [{ id: 1, user: VIEWER, tenant: TENANT, role: 3, status: true }],
    tenant: [{ id: TENANT, status: 'ACTIVE', name: 'Municipio Sintético' }],
    role: [{ id: 3, name: role }],
    import_batch: PUBLISHED, case_review: [], case_review_approval: [],
    ...tables,
  }, { enforceFilters: true, fail: options.fail })
  vi.spyOn(fixture.client.auth, 'getUser').mockResolvedValue(options.signedIn === false
    ? { data: { user: null }, error: null } as never
    : { data: { user: { id: 'auth-test' } }, error: null } as never)
  serverClient.mockResolvedValue(fixture.client)
  return fixture
}

beforeEach(() => {
  vi.resetAllMocks()
  cookieStore.mockResolvedValue({ get: () => undefined })
})

describe('rótulos y capacidades por rol', () => {
  it.each([['ADMIN', 'Administrador'], ['USER', 'Usuario'], ['operador', 'operador (rol anterior)'], ['supervisor', 'supervisor (rol anterior)']])('%s → %s', (name, label) => {
    expect(roleLabel(name)).toBe(label)
  })

  it('ADMIN tiene todas las funciones nuevas; USER y la compatibilidad E06, ninguna', () => {
    expect(capabilitiesFor('ADMIN')).toEqual({ canImport: true, canRecordDecision: true, canApprove: true, canSeeSupervision: true, canSeeAudit: true })
    const none = { canImport: false, canRecordDecision: false, canApprove: false, canSeeSupervision: false, canSeeAudit: false }
    expect(capabilitiesFor('USER')).toEqual(none)
    expect(capabilitiesFor('tp_operator')).toEqual(none)
  })
})

describe('loadViewerContext', () => {
  it('ADMIN con cartera publicada: municipio, fecha, persona, rol y capacidades de la sesión', async () => {
    const { requests } = session('ADMIN')
    expect(await loadViewerContext()).toEqual({
      userName: 'Persona Sintética', roleName: 'ADMIN', roleLabel: 'Administrador', tenantName: 'Municipio Sintético',
      portfolio: { kind: 'LOADED', asOf: '2026-09-30' }, capabilities: capabilitiesFor('ADMIN'),
    })
    // Solo la propia fila de usuario y el propio municipio.
    expect(requests.filter(request => request.select === 'id,full_name').map(request => request.filters)).toEqual([{ id: `eq.${VIEWER}` }])
    expect(requests.filter(request => request.table === 'tenant' && request.select === 'id,name').map(request => request.filters)).toEqual([{ id: `eq.${TENANT}` }])
    expect(requests.find(request => request.table === 'import_batch')?.filters).toEqual({ tenant: `eq.${TENANT}` })
  })

  it('USER lee el mismo contexto, sin funciones nuevas', async () => {
    session('USER')
    expect(await loadViewerContext()).toMatchObject({ roleName: 'USER', roleLabel: 'Usuario', portfolio: { kind: 'LOADED', asOf: '2026-09-30' }, capabilities: capabilitiesFor('USER') })
  })

  // Misma selección que `resolvePortfolioCutoff`: lo que el tablero toma por cartera vigente.
  it.each([
    ['sin ninguna carga', [], 'UNAVAILABLE'],
    ['solo una carga descartada', [{ id: 1, tenant: TENANT, as_of: '2026-09-30', status: 'DESCARTADO', supersedes: null }], 'UNAVAILABLE'],
    ['una validación sin publicación atómica', [{ id: 1, tenant: TENANT, as_of: '2026-09-30', status: 'VALIDADO', supersedes: null }], 'UNAVAILABLE'],
    ['un estado desconocido', [{ id: 1, tenant: TENANT, as_of: '2026-09-30', status: 'INVENTADO', supersedes: null }], 'UNAVAILABLE'],
    ['una publicación con fecha inválida', [
      { id: 1, tenant: TENANT, as_of: '2026-02-30', status: 'VALIDADO', supersedes: null },
      { id: 2, tenant: TENANT, as_of: '2026-02-30', status: 'PUBLICADO', supersedes: 1 },
    ], 'UNAVAILABLE'],
    ['dos publicaciones', [...PUBLISHED,
      { id: 3, tenant: TENANT, as_of: '2026-10-31', status: 'VALIDADO', supersedes: null },
      { id: 4, tenant: TENANT, as_of: '2026-10-31', status: 'PUBLICADO', supersedes: 3 },
    ], 'LOADED'],
  ] as [string, RawRow[], string][])('%s → %s', async (_name, batches, kind) => {
    session('ADMIN', { import_batch: batches })
    const viewer = await loadViewerContext()
    expect(viewer?.portfolio.kind).toBe(kind)
    const cutoff = resolvePortfolioCutoff(batches.map(row => ({ ...row, counts: { publicacion_atomica: null } })), null)
    if (kind === 'LOADED') expect(viewer?.portfolio).toEqual({ kind, asOf: cutoff.batch?.as_of })
    else expect(kind).toBe('UNAVAILABLE')
  })

  it('una lectura fallida de las cargas es «no disponible», nunca «sin cartera»', async () => {
    session('ADMIN', {}, { fail: request => request.table === 'import_batch' ? { message: 'caída', code: '57014' } : null })
    expect((await loadViewerContext())?.portfolio).toEqual({ kind: 'UNAVAILABLE' })
  })

  it('si falla la lectura del nombre, solo ese campo queda vacío', async () => {
    session('ADMIN', {}, { fail: request => request.select === 'id,full_name' ? { message: 'denegado', code: '42501' } : null })
    expect(await loadViewerContext()).toMatchObject({ userName: null, tenantName: 'Municipio Sintético', portfolio: { kind: 'LOADED' }, roleName: 'ADMIN' })
  })

  it('si falla la lectura del municipio, solo ese campo queda vacío', async () => {
    session('ADMIN', {}, { fail: request => request.table === 'tenant' && request.select === 'id,name' ? { message: 'denegado', code: '42501' } : null })
    expect(await loadViewerContext()).toMatchObject({ userName: 'Persona Sintética', tenantName: null, portfolio: { kind: 'LOADED' } })
  })

  it('un nombre en blanco no se muestra como nombre', async () => {
    session('ADMIN', { user: [{ id: VIEWER, auth_user: 'auth-test', status: 'ACTIVE', full_name: '   ' }], tenant: [{ id: TENANT, status: 'ACTIVE', name: null }] })
    expect(await loadViewerContext()).toMatchObject({ userName: null, tenantName: null })
  })

  it.each([
    ['sin sesión', () => session('ADMIN', {}, { signedIn: false })],
    ['rol no reconocido', () => session('operador')],
    ['membresía inactiva', () => session('ADMIN', { tenant_user: [{ id: 1, user: VIEWER, tenant: TENANT, role: 3, status: false }] })],
    ['servicio de datos sin configurar', () => serverClient.mockResolvedValue(null)],
  ])('%s: no hay contexto', async (_name, arrange) => {
    arrange()
    expect(await loadViewerContext()).toBeNull()
  })
})

const review = (id: number, patch: RawRow = {}): RawRow => ({
  id, tenant: TENANT, debtor: 99, rules_version: RULES_VERSION, as_of: '2026-09-30', suggested_intervention: 'RECORDATORIO_INFORMATIVO', suggested_intensity: 1,
  decision: 'MODIFICA', decided_intervention: 'INTIMACION_ADMINISTRATIVA', decided_intensity: 3, reviewer: VIEWER, reviewer_role: 'ADMIN',
  created_at: `2026-10-0${id}T15:00:00+00:00`, supersedes: null, ...patch,
})
const approval = (id: number, caseReview: number, decision: string, patch: RawRow = {}): RawRow => ({
  id, tenant: TENANT, case_review: caseReview, decision, created_at: '2026-10-05T15:00:00+00:00', supersedes: null, ...patch,
})
const CURRENT = { asOf: '2026-09-30', rulesVersion: RULES_VERSION }

describe('buildRecordedDecisions', () => {
  it('cadena de reemplazos: vale la versión vigente; mine por identidad y participated por toda la cadena', () => {
    const rows = [review(1, { reviewer: VIEWER }), review(2, { reviewer: OTHER, supersedes: 1 })]
    const forViewer = buildRecordedDecisions(rows, [], String(VIEWER), CURRENT).get('99')
    expect(forViewer).toMatchObject({ reviewId: '2', status: 'PENDIENTE_APROBACION', mine: false, participated: true, stale: false })
    expect(buildRecordedDecisions(rows, [], String(OTHER), CURRENT).get('99')).toMatchObject({ reviewId: '2', mine: true, participated: true })
    expect(buildRecordedDecisions(rows, [], String(THIRD), CURRENT).get('99')).toMatchObject({ reviewId: '2', mine: false, participated: false })
  })

  it('nunca expone la identidad de otra persona: solo booleanos', () => {
    const rows = [review(1, { reviewer: OTHER }), review(2, { reviewer: THIRD, supersedes: 1 })]
    const decision = buildRecordedDecisions(rows, [approval(5, 2, 'OBJETA')], String(VIEWER), CURRENT).get('99')!
    expect(Object.keys(decision)).not.toContain('reviewer')
    expect(JSON.stringify(decision)).not.toMatch(new RegExp(`${OTHER}|${THIRD}`))
  })

  it('el estado sale de la aprobación vigente de la versión vigente', () => {
    const rows = [review(1), review(2, { supersedes: 1 })]
    const statusWith = (approvals: RawRow[]) => buildRecordedDecisions(rows, approvals, String(OTHER), CURRENT).get('99')?.status
    expect(statusWith([])).toBe('PENDIENTE_APROBACION')
    expect(statusWith([approval(5, 2, 'APRUEBA')])).toBe('APROBADA')
    expect(statusWith([approval(5, 2, 'APRUEBA'), approval(6, 2, 'OBJETA', { supersedes: 5 })])).toBe('OBJETADA')
    expect(statusWith([approval(5, 2, 'OBJETA'), approval(6, 2, 'APRUEBA', { supersedes: 5 })])).toBe('APROBADA')
    // La aprobación de una versión reemplazada no aprueba la vigente.
    expect(statusWith([approval(5, 1, 'APRUEBA')])).toBe('PENDIENTE_APROBACION')
  })

  it('intensidad menor a 3 queda registrada sin aprobación', () => {
    const decision = buildRecordedDecisions([review(1, { decision: 'ACEPTA', decided_intervention: 'RECORDATORIO_INFORMATIVO', decided_intensity: 1 })], [], String(VIEWER), CURRENT).get('99')
    expect(decision).toMatchObject({ status: 'REGISTRADA', decidedIntensity: 1, decidedIntervention: 'RECORDATORIO_INFORMATIVO', mine: true })
    expect(buildRecordedDecisions([review(1, { decided_intensity: null, decided_intervention: null, decision: 'POSPONE' })], [], String(VIEWER), CURRENT).get('99'))
      .toMatchObject({ status: 'REGISTRADA', decidedIntensity: null, decidedIntervention: null })
  })

  it.each([
    ['otra fecha de cartera', { asOf: '2026-10-31', rulesVersion: RULES_VERSION }, true],
    ['otras reglas', { asOf: '2026-09-30', rulesVersion: '0.9.0' }, true],
    ['sin cartera vigente', { asOf: null, rulesVersion: RULES_VERSION }, true],
    ['la misma base', CURRENT, false],
  ] as const)('%s → stale=%s', (_name, current, stale) => {
    expect(buildRecordedDecisions([review(1)], [], String(VIEWER), current).get('99')?.stale).toBe(stale)
  })

  it('un caso por objeto: con dos cadenas vale la más nueva; un id inválido se ignora', () => {
    const map = buildRecordedDecisions([review(3), review(1), review(2, { debtor: 100 }), review(4, { debtor: 'x' })], [], String(VIEWER), CURRENT)
    expect([...map.keys()].sort()).toEqual(['100', '99'])
    expect(map.get('99')?.reviewId).toBe('3')
  })

  it('un ciclo en la cadena no cuelga ni otorga participación', () => {
    const rows = [review(1, { reviewer: OTHER, supersedes: 2 }), review(2, { reviewer: OTHER, supersedes: 1 }), review(3, { reviewer: THIRD, supersedes: 2 })]
    expect(buildRecordedDecisions(rows, [], String(VIEWER), CURRENT).get('99')).toMatchObject({ reviewId: '3', participated: false })
  })
})

describe('loadRecordedDecisions', () => {
  it('ADMIN: decisiones del municipio, filtradas por municipio, con la cartera y reglas vigentes', async () => {
    const { requests } = session('ADMIN', { case_review: [review(1), review(2, { tenant: 8, debtor: 199, reviewer: OTHER })] })
    const result = await loadRecordedDecisions()
    expect(result).toMatchObject({ ok: true, current: { asOf: '2026-09-30', rulesVersion: RULES_VERSION } })
    if (!result.ok) throw new Error('lectura fallida')
    expect([...result.byDebtor.keys()]).toEqual(['99'])
    for (const table of ['case_review', 'case_review_approval', 'import_batch']) {
      expect(requests.filter(request => request.table === table && request.limit !== 0).every(request => request.filters.tenant === `eq.${TENANT}`), table).toBe(true)
    }
    expect(requests.find(request => request.table === 'case_review')?.select).not.toMatch(/reason_text|\*/)
  })

  it('USER también lee la decisión registrada y su estado', async () => {
    session('USER', { case_review: [review(1, { reviewer: OTHER })] })
    expect(await loadRecordedDecisions()).toMatchObject({ ok: true, byDebtor: new Map([['99', expect.objectContaining({ mine: false })]]) })
  })

  it.each(['tp_operator', 'operador'])('%s no lee decisiones: FORBIDDEN, sin leer case_review', async role => {
    const { requests } = session(role)
    expect(await loadRecordedDecisions()).toEqual({ ok: false, reason: 'FORBIDDEN' })
    expect(requests.some(request => request.table === 'case_review')).toBe(false)
  })

  it.each(['case_review', 'case_review_approval'])('si falla %s: UNAVAILABLE, nunca una lista vacía', async table => {
    session('ADMIN', { case_review: [review(1)] }, { fail: request => request.table === table ? { message: 'caída', code: '57014' } : null })
    expect(await loadRecordedDecisions()).toEqual({ ok: false, reason: 'UNAVAILABLE' })
  })

  it('sin sesión: UNAVAILABLE', async () => {
    session('ADMIN', {}, { signedIn: false })
    expect(await loadRecordedDecisions()).toEqual({ ok: false, reason: 'UNAVAILABLE' })
  })

  it('si falla la lectura de las cargas no hay cartera vigente: todas quedan sobre datos anteriores', async () => {
    session('ADMIN', { case_review: [review(1)] }, { fail: request => request.table === 'import_batch' ? { message: 'caída', code: '57014' } : null })
    const result = await loadRecordedDecisions()
    expect(result).toEqual({ ok: false, reason: 'UNAVAILABLE' })
  })
})
