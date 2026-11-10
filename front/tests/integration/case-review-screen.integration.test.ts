import { beforeEach, describe, expect, it, vi } from 'vitest'

const { serverClient, cookieStore, writerFactory } = vi.hoisted(() => ({
  serverClient: vi.fn(), cookieStore: vi.fn(), writerFactory: vi.fn(),
}))
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient: serverClient }))
vi.mock('@/lib/supabase-config', () => ({ hasSupabaseCredentials: true }))
vi.mock('next/headers', () => ({ cookies: cookieStore }))
vi.mock('@/lib/server/case-review-writer', () => ({ createCaseReviewWriter: writerFactory }))

import { loadCaseReviewScreen } from '@/lib/server/case-review-screen'
import type { RawRow } from '@/types/equitas-domain'
import { createPaginatedSupabase, type DataRequest } from '../fixtures/paginated-supabase'

const TENANT = 7
const DEBTOR = 99
const LINK = { active: true, debtor: DEBTOR, __debtor: { tenant: TENANT } }
const CHECKLIST = { situacion_hogar: 'NO_DISPONIBLE', estado_juridico_verificado: true, canal_valido: true, alternativa_asistida_ofrecida: true }

const review = (id: number, patch: RawRow = {}): RawRow => ({
  id, tenant: TENANT, debtor: DEBTOR, rules_version: '1.0.0', as_of: '2026-10-30', inputs_hash: 'a'.repeat(64),
  suggested_intervention: 'RECORDATORIO_INFORMATIVO', suggested_intensity: 1, decision: 'POSPONE', decided_intervention: null, decided_intensity: null,
  reason_code: 'ESPERA_DE_INFORMACION', checklist: {}, reviewer: 42, reviewer_role: 'ADMIN', created_at: `2026-11-0${id}T13:00:00+00:00`, supersedes: null, idempotency_key: `k${id}`,
  ...patch,
})
const approval = (id: number, caseReview: number, decision: string, patch: RawRow = {}): RawRow => ({
  id, tenant: TENANT, case_review: caseReview, decision, reason_code: decision === 'OBJETA' ? 'LISTA_DE_CONTROL_INSUFICIENTE' : null, checklist: decision === 'APRUEBA' ? CHECKLIST : {},
  approver: 43, approver_role: 'ADMIN', created_at: '2026-11-03T15:00:00+00:00', supersedes: null, idempotency_key: `a${id}`, ...patch,
})

function tables(extra: Record<string, RawRow[]> = {}): Record<string, RawRow[]> {
  return {
    user: [{ id: 42, auth_user: 'auth-test', status: 'ACTIVE' }],
    tenant_user: [{ id: 1, tenant: TENANT, user: 42, role: 3, status: true }],
    tenant: [{ id: TENANT, status: 'ACTIVE' }],
    debtor: [{ id: DEBTOR, tenant: TENANT, identifier: 'OBJ-SINTETICO' }],
    debt: [{ id: 1, debtor: DEBTOR, current_amount: 90000.5, due_date: '2026-03-01', __scope: { tenant: TENANT } }],
    debtor_person: [{ id: 1, debtor: DEBTOR, person: 10, priority: 100, active: true, __scope: { tenant: TENANT } }],
    person: [{ id: 10, full_name: 'Persona sintetica', __links: [LINK] }],
    debtor_contact: [{ id: 1, person: 10, value: 'sintetico@example.test', active: true, __person: { __links: [LINK] } }],
    import_batch: [
      { id: 1, tenant: TENANT, as_of: '2026-10-30', source_updated_at: '2026-10-29', status: 'VALIDADO', supersedes: null },
      { id: 2, tenant: TENANT, as_of: '2026-10-30', source_updated_at: '2026-10-29', status: 'PUBLICADO', supersedes: 1 },
    ],
    case_review: [],
    case_review_approval: [],
    ...extra,
  }
}

const rpc = vi.fn()

function setup(role: string, extra: Record<string, RawRow[]> = {}, fail?: (request: DataRequest) => { message: string; code?: string } | null) {
  const { client, requests } = createPaginatedSupabase({ ...tables(extra), role: [{ id: 3, name: role }] }, { fail: fail ?? (() => null), enforceFilters: true })
  vi.spyOn(client.auth, 'getUser').mockResolvedValue({ data: { user: { id: 'auth-test' } }, error: null } as never)
  serverClient.mockResolvedValue(client)
  cookieStore.mockResolvedValue({ get: () => undefined })
  return { requests }
}

const ready = async (role: string, extra: Record<string, RawRow[]> = {}) => {
  const { requests } = setup(role, extra)
  const screen = await loadCaseReviewScreen(String(DEBTOR))
  if (screen.kind !== 'ready') throw new Error(`se esperaba ready: ${screen.kind}`)
  return { screen, requests }
}

beforeEach(() => {
  vi.clearAllMocks()
  rpc.mockImplementation(async () => ({ data: 'Detalle sintético', error: null }))
  writerFactory.mockReturnValue({ rpc })
})

describe('qué puede hacer cada rol en la pantalla', () => {
  // Noche 7: ADMIN registra y aprueba (la base exige que quien aprueba sea otra persona); USER solo lee.
  it.each([
    ['ADMIN', { canRecord: true, canApprove: true, canReadReasonText: true }],
    ['USER', { canRecord: false, canApprove: false, canReadReasonText: false }],
  ])('%s', async (role, capabilities) => {
    expect((await ready(role)).screen.capabilities).toEqual(capabilities)
  })

  it.each(['tp_operator', 'consulta', 'operador', 'supervisor', 'importador', 'importador_sistema', 'admin'])('%s no ve revisión y no se lee ninguna tabla de revisión', async role => {
    const { requests } = setup(role)
    const screen = await loadCaseReviewScreen(String(DEBTOR))
    expect(screen.kind).toBe('restricted')
    expect(JSON.stringify(screen)).not.toContain('OBJ-SINTETICO')
    expect(requests.every(request => ['user', 'tenant_user', 'tenant', 'role'].includes(request.table))).toBe(true)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('sugerencia', () => {
  it('es la instantánea del corte publicado, no la fecha de cálculo', async () => {
    const { screen } = await ready('ADMIN')
    expect(screen.snapshot).toMatchObject({ ok: true, snapshot: { asOf: '2026-10-30', debtorId: String(DEBTOR), currentReviewId: null } })
  })

  it('sin corte publicado llega el motivo, sin instantánea, y el historial se sigue viendo', async () => {
    const { screen } = await ready('ADMIN', { import_batch: [], case_review: [review(1)] })
    expect(screen.snapshot).toMatchObject({ ok: false, code: 'CUTOFF_NOT_AVAILABLE' })
    expect(screen.history).toMatchObject({ ok: true, entries: [{ id: '1' }] })
  })
})

describe('historial', () => {
  it('ninguna lectura pide reason_text ni usa *, y el texto solo sale de la función', async () => {
    const { requests } = await ready('ADMIN', { case_review: [review(1, { decided_intensity: 3, decided_intervention: 'INTIMACION_ADMINISTRATIVA', decision: 'MODIFICA', checklist: CHECKLIST })], case_review_approval: [approval(1, 1, 'APRUEBA')] })
    const reads = requests.filter(request => ['case_review', 'case_review_approval'].includes(request.table))
    expect(reads.length).toBeGreaterThan(1)
    for (const request of reads) {
      expect(request.select).not.toContain('reason_text')
      expect(request.select).not.toBe('*')
      expect(request.filters).toMatchObject({ tenant: `eq.${TENANT}` })
    }
    expect(rpc).toHaveBeenCalledWith('read_case_review_reason_text', { p_actor_user: '42', p_tenant: String(TENANT), p_case_review: '1' })
  })

  it('USER no invoca la función: el texto no llega a la página', async () => {
    const { screen } = await ready('USER', { case_review: [review(1)] })
    expect(rpc).not.toHaveBeenCalled()
    expect(screen.history).toMatchObject({ ok: true, entries: [{ reasonText: { state: 'HIDDEN' } }] })
    expect(JSON.stringify(screen)).not.toContain('Detalle sintético')
  })

  it.each([['quien registró', 42], ['otra cuenta ADMIN', 44]])('ADMIN (%s) recibe el texto tal como se guardó', async (_who, reviewer) => {
    const text = '  <b>con marcas</b> y espacios \n'
    rpc.mockResolvedValue({ data: text, error: null })
    const { screen } = await ready('ADMIN', { case_review: [review(1, { reviewer })] })
    expect(screen.history).toMatchObject({ ok: true, entries: [{ reasonText: { state: 'VISIBLE', text } }] })
  })

  it('mine y participated salen de la identidad de quien mira, y el identificador de otra persona no llega a la página', async () => {
    const { screen } = await ready('ADMIN', { case_review: [
      review(1, { reviewer: 42, decision: 'MODIFICA', decided_intervention: 'INTIMACION_ADMINISTRATIVA', decided_intensity: 3, checklist: CHECKLIST }),
      review(2, { reviewer: 9044, supersedes: 1, decision: 'MODIFICA', decided_intervention: 'INTIMACION_ADMINISTRATIVA', decided_intensity: 3, checklist: CHECKLIST }),
      review(3, { reviewer: 9044, debtor: DEBTOR }),
    ] , case_review_approval: [approval(5, 1, 'OBJETA', { approver: 9043 })] })
    if (!screen.history.ok) throw new Error('historial no disponible')
    const byId = new Map(screen.history.entries.map(entry => [entry.id, entry]))
    // A (42) registró la 1; B reemplazó con la 2: A participó en la cadena aunque la 2 no sea suya.
    expect([byId.get('1'), byId.get('2')].map(entry => [entry?.mine, entry?.participated])).toEqual([[true, true], [false, true]])
    expect(byId.get('1')?.approvals).toMatchObject([{ id: '5', mine: false }])
    const json = JSON.stringify(screen)
    expect(json).not.toContain('9044')
    expect(json).not.toContain('9043')
    expect(json).not.toMatch(/"(reviewer|approver)"/)
  })

  it('un rol anterior guardado en el registro se conserva como dato histórico', async () => {
    const { screen } = await ready('USER', { case_review: [review(1, { reviewer_role: 'operador' })] })
    expect(screen.history).toMatchObject({ ok: true, entries: [{ reviewerRole: 'operador' }] })
  })

  it('sin motivo no se consulta el texto', async () => {
    const { screen } = await ready('ADMIN', { case_review: [review(1, { decision: 'ACEPTA', reason_code: null, decided_intervention: 'RECORDATORIO_INFORMATIVO', decided_intensity: 1 })] })
    expect(rpc).not.toHaveBeenCalled()
    expect(screen.history).toMatchObject({ ok: true, entries: [{ reasonText: { state: 'NONE' }, reasonCode: null }] })
  })

  it('texto nulo con motivo: sin detalle', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    const { screen } = await ready('ADMIN', { case_review: [review(1)] })
    expect(screen.history).toMatchObject({ ok: true, entries: [{ reasonText: { state: 'NONE' } }] })
  })

  it.each([
    ['la función falla', () => rpc.mockResolvedValue({ data: null, error: { message: 'ROLE_NOT_ALLOWED', code: 'P0001' } })],
    ['la función lanza', () => rpc.mockRejectedValue(new Error('red'))],
    ['sin credencial en el entorno', () => writerFactory.mockReturnValue(null)],
  ])('%s: el texto queda no disponible y el resto del historial se ve', async (_, arrange) => {
    arrange()
    const { screen } = await ready('ADMIN', { case_review: [review(1)] })
    expect(screen.history).toMatchObject({ ok: true, entries: [{ id: '1', reasonCode: 'ESPERA_DE_INFORMACION', reasonText: { state: 'UNAVAILABLE' } }] })
  })

  it('ordena de la más nueva a la más vieja y marca la vigente', async () => {
    const { screen } = await ready('USER', { case_review: [review(1), review(2, { supersedes: 1 })] })
    expect(screen.history).toMatchObject({ ok: true, entries: [{ id: '2', isCurrent: true }, { id: '1', isCurrent: false }] })
    expect(screen.snapshot).toMatchObject({ ok: true, snapshot: { currentReviewId: '2' } })
  })

  it('intensidad <3 queda registrada y no consulta aprobaciones', async () => {
    const { screen, requests } = await ready('USER', { case_review: [review(1, { decision: 'MODIFICA', decided_intervention: 'SEGUIMIENTO', decided_intensity: 2 })] })
    expect(screen.history).toMatchObject({ ok: true, entries: [{ status: 'REGISTRADA', approvals: [] }] })
    expect(requests.some(request => request.table === 'case_review_approval')).toBe(false)
  })

  describe('propuesta de intensidad ≥3', () => {
    const intense = (id = 1, patch: RawRow = {}) => review(id, { decision: 'MODIFICA', decided_intervention: 'INTIMACION_ADMINISTRATIVA', decided_intensity: 3, checklist: CHECKLIST, ...patch })

    it('sin respuesta: pendiente de supervisor, nunca aprobada', async () => {
      const { screen } = await ready('ADMIN', { case_review: [intense()] })
      expect(screen.history).toMatchObject({ ok: true, entries: [{ status: 'PENDIENTE_SUPERVISOR', approvals: [], currentApprovalId: null, checklist: CHECKLIST }] })
    })

    it.each([['APRUEBA', 'APROBADA'], ['OBJETA', 'OBJETADA']])('%s la deja %s', async (decision, status) => {
      const { screen } = await ready('ADMIN', { case_review: [intense()], case_review_approval: [approval(5, 1, decision)] })
      expect(screen.history).toMatchObject({ ok: true, entries: [{ status, currentApprovalId: '5', approvals: [{ id: '5', decision, approverRole: 'ADMIN' }] }] })
    })

    it('manda la respuesta vigente de la cadena', async () => {
      const { screen } = await ready('ADMIN', { case_review: [intense()], case_review_approval: [approval(5, 1, 'OBJETA'), approval(6, 1, 'APRUEBA', { supersedes: 5 })] })
      expect(screen.history).toMatchObject({ ok: true, entries: [{ status: 'APROBADA', currentApprovalId: '6', approvals: [{ id: '6', isCurrent: true }, { id: '5', isCurrent: false }] }] })
    })

    it('si los datos cambiaron desde la propuesta, lo avisa', async () => {
      const { screen } = await ready('ADMIN', { case_review: [intense()] })
      expect(screen.history).toMatchObject({ ok: true, entries: [{ basisChanged: true }] })
    })

    it('sin corte vigente no afirma que cambiaron', async () => {
      const { screen } = await ready('ADMIN', { case_review: [intense()], import_batch: [] })
      expect(screen.history).toMatchObject({ ok: true, entries: [{ basisChanged: false }] })
    })

    it('si fallan las aprobaciones no afirma "pendiente": queda desconocido', async () => {
      const { requests } = setup('ADMIN', { case_review: [intense()] }, request => request.table === 'case_review_approval' ? { message: 'denegado', code: '42501' } : null)
      const screen = await loadCaseReviewScreen(String(DEBTOR))
      expect(screen).toMatchObject({ kind: 'ready', history: { ok: false } })
      expect(requests.some(request => request.table === 'case_review_approval')).toBe(true)
    })
  })

  it('una lectura fallida del historial no es "sin decisiones"', async () => {
    setup('ADMIN', { case_review: [review(1)] }, request => request.select?.includes('decided_intensity') && request.table === 'case_review' ? { message: 'denegado', code: '42501' } : null)
    const screen = await loadCaseReviewScreen(String(DEBTOR))
    expect(screen).toMatchObject({ kind: 'ready', history: { ok: false, message: expect.any(String) } })
  })

  it('una identificación inválida no devuelve historial', async () => {
    setup('ADMIN')
    expect(await loadCaseReviewScreen('no-es-id')).toMatchObject({ kind: 'ready', snapshot: { ok: false, code: 'INVALID_INPUT' }, history: { ok: false } })
  })
})

describe('fallas de acceso', () => {
  it('sin sesión queda no disponible, sin lanzar', async () => {
    const { client } = createPaginatedSupabase(tables())
    vi.spyOn(client.auth, 'getUser').mockResolvedValue({ data: { user: null }, error: { message: 'Auth session missing!', status: 400, name: 'AuthSessionMissingError' } } as never)
    serverClient.mockResolvedValue(client)
    cookieStore.mockResolvedValue({ get: () => undefined })
    expect(await loadCaseReviewScreen(String(DEBTOR))).toMatchObject({ kind: 'unavailable', message: expect.any(String) })
  })

  it('un error inesperado queda no disponible', async () => {
    serverClient.mockRejectedValue(new Error('caída'))
    cookieStore.mockResolvedValue({ get: () => undefined })
    expect(await loadCaseReviewScreen(String(DEBTOR))).toMatchObject({ kind: 'unavailable' })
  })

  it('los errores de control de Next no se esconden', async () => {
    serverClient.mockRejectedValue(Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/login;307;' }))
    cookieStore.mockResolvedValue({ get: () => undefined })
    await expect(loadCaseReviewScreen(String(DEBTOR))).rejects.toThrow('NEXT_REDIRECT')
  })
})
