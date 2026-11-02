import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { serverClient, cookieStore, revalidatePath, writerFactory } = vi.hoisted(() => ({
  serverClient: vi.fn(), cookieStore: vi.fn(), revalidatePath: vi.fn(), writerFactory: vi.fn(),
}))
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient: serverClient }))
vi.mock('@/lib/supabase-config', () => ({ hasSupabaseCredentials: true }))
vi.mock('next/headers', () => ({ cookies: cookieStore }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/lib/server/case-review-writer', () => ({ createCaseReviewWriter: writerFactory }))

import { approveCaseDecision, recordCaseDecision } from '@/app/debtors/[debtorId]/actions'
import { CASE_REVIEW_MESSAGES, type CaseReviewErrorCode } from '@/lib/domain/case-review-contract'
import { getCaseReviewSnapshot } from '@/lib/server/case-review-service'
import { selectCurrentCutoff, type BatchEvent } from '@/lib/server/case-review-snapshot'
import type { RawRow } from '@/types/equitas-domain'
import { createPaginatedSupabase } from '../fixtures/paginated-supabase'

const RULES_VERSION = JSON.parse(readFileSync(new URL('../../../contracts/decision-rules.v1.json', import.meta.url), 'utf8')).version as string
const TENANT = 7
const OTHER_TENANT = 8
const DEBTOR = 99
const FOREIGN_DEBTOR = 199
const ROLE_IDS = { consulta: 1, operador: 2, supervisor: 3, importador: 4, tp_operator: 5, importador_sistema: 6 }
type RoleName = keyof typeof ROLE_IDS
const READY_CHECKLIST = { situacion_hogar: 'NO_DISPONIBLE', estado_juridico_verificado: true, canal_valido: true, alternativa_asistida_ofrecida: true }
const LINK = { active: true, debtor: DEBTOR, __debtor: { tenant: TENANT } }

type Rows = Record<string, RawRow[]>
type RpcReply = { data: unknown; error: { message: string; code?: string } | null }
type FailRule = NonNullable<NonNullable<Parameters<typeof createPaginatedSupabase>[1]>['fail']>

function portfolio(): Rows {
  return {
    debtor: [{ id: DEBTOR, tenant: TENANT, identifier: 'OBJ-SINTETICO' }, { id: FOREIGN_DEBTOR, tenant: OTHER_TENANT, identifier: 'OBJ-AJENO' }],
    debt: [
      { id: 2, debtor: DEBTOR, current_amount: 90000.5, due_date: '2026-03-01', __scope: { tenant: TENANT } },
      { id: 1, debtor: DEBTOR, current_amount: 1250, due_date: '2026-09-01', __scope: { tenant: TENANT } },
      { id: 3, debtor: FOREIGN_DEBTOR, current_amount: 777, due_date: '2026-03-01', __scope: { tenant: OTHER_TENANT } },
    ],
    debtor_person: [{ id: 1, debtor: DEBTOR, person: 10, priority: 100, active: true, __scope: { tenant: TENANT } }],
    person: [{ id: 10, full_name: 'Persona sintetica', __links: [LINK] }],
    debtor_contact: [{ id: 1, person: 10, value: 'sintetico@example.test', active: true, __person: { __links: [LINK] } }],
    import_batch: [
      { id: 1, tenant: TENANT, as_of: '2026-10-30', source_updated_at: '2026-10-29', status: 'VALIDADO', supersedes: null },
      { id: 2, tenant: TENANT, as_of: '2026-10-30', source_updated_at: '2026-10-29', status: 'PUBLICADO', supersedes: 1 },
    ],
    case_review: [],
    case_review_approval: [],
  }
}

// Replica las funciones de ALIGN-018 en memoria: lo real se demuestra en tests/local-review.
function fakeDatabase(tables: Rows, overrides: { failWith?: RpcReply['error']; beforeWrite?: (tables: Rows) => void } = {}) {
  let nextId = 100
  const created: Record<string, RawRow[]> = { case_review: [], case_review_approval: [] }
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>): Promise<RpcReply> => {
    if (overrides.failWith) return { data: null, error: overrides.failWith }
    const table = name === 'record_case_review' ? 'case_review' : 'case_review_approval'
    // La ventana de la revision: otro proceso importa entre el recalculo de la accion y la funcion.
    overrides.beforeWrite?.(tables)
    const replay = created[table].some(item => item.idempotency_key === args.p_idempotency_key)
    if (!replay && (table === 'case_review' || args.p_decision === 'APRUEBA')) {
      const current = selectCurrentCutoff(tables.import_batch.filter(row => row.tenant === Number(args.p_tenant)) as unknown as BatchEvent[])
      if (String(current?.id) !== String(args.p_cutoff_batch)) return { data: null, error: { message: 'CUTOFF_CHANGED', code: 'P0001' } }
    }
    const row = { ...args, tenant: Number(args.p_tenant), idempotency_key: args.p_idempotency_key }
    const existing = created[table].find(item => item.idempotency_key === args.p_idempotency_key)
    const reply = (id: unknown, isNew: boolean) => table === 'case_review'
      ? { data: { review_id: id, created: isNew, pending_supervisor: Number(args.p_decided_intensity ?? 0) >= 3 }, error: null }
      : { data: { approval_id: id, created: isNew }, error: null }
    if (existing) {
      return JSON.stringify({ ...existing, id: undefined }) === JSON.stringify({ ...row, id: undefined })
        ? reply(existing.id, false)
        : { data: null, error: { message: 'IDEMPOTENCY_KEY_CONFLICT', code: 'P0001' } }
    }
    const id = nextId++
    created[table].push({ id, ...row })
    tables[table].push({
      id, tenant: Number(args.p_tenant), debtor: Number(args.p_debtor), case_review: args.p_case_review ?? null,
      supersedes: args.p_supersedes === null || args.p_supersedes === undefined ? null : Number(args.p_supersedes),
      idempotency_key: args.p_idempotency_key, rules_version: args.p_rules_version, as_of: args.p_as_of, inputs_hash: args.p_inputs_hash,
      decided_intensity: args.p_decided_intensity ?? null,
    })
    return reply(id, true)
  })
  return { rpc, created }
}

function session({ role = 'operador' as RoleName, signedIn = true, tables = portfolio(), memberTenant = TENANT, cookie = undefined as string | undefined, fail = undefined as FailRule | undefined, database = {} as { failWith?: RpcReply['error']; beforeWrite?: (tables: Rows) => void } } = {}) {
  const fixture = createPaginatedSupabase({
    user: [{ id: 42, auth_user: 'auth-test', status: 'ACTIVE' }],
    tenant_user: [{ id: 1, user: 42, tenant: memberTenant, role: ROLE_IDS[role], status: true }],
    tenant: [{ id: memberTenant, status: 'ACTIVE' }],
    role: Object.entries(ROLE_IDS).map(([name, id]) => ({ id, name })),
    ...tables,
  }, { enforceFilters: true, fail })
  vi.spyOn(fixture.client.auth, 'getUser').mockResolvedValue(signedIn
    ? { data: { user: { id: 'auth-test' } }, error: null } as never
    : { data: { user: null }, error: null } as never)
  serverClient.mockResolvedValue(fixture.client)
  cookieStore.mockResolvedValue({ get: () => cookie === undefined ? undefined : { value: cookie } })
  const db = fakeDatabase(tables, database)
  writerFactory.mockReturnValue({ rpc: db.rpc })
  return { ...fixture, ...db, tables }
}

// La misma base, con la sesion de otra persona o de otro rol.
function signInAs(role: RoleName, tables: Rows, rpc: ReturnType<typeof vi.fn>, userId = 42) {
  const authUser = `auth-${userId}`
  const fixture = createPaginatedSupabase({
    user: [{ id: userId, auth_user: authUser, status: 'ACTIVE' }],
    tenant_user: [{ id: 1, user: userId, tenant: TENANT, role: ROLE_IDS[role], status: true }],
    tenant: [{ id: TENANT, status: 'ACTIVE' }],
    role: Object.entries(ROLE_IDS).map(([name, id]) => ({ id, name })),
    ...tables,
  }, { enforceFilters: true })
  vi.spyOn(fixture.client.auth, 'getUser').mockResolvedValue({ data: { user: { id: authUser } }, error: null } as never)
  serverClient.mockResolvedValue(fixture.client)
  writerFactory.mockReturnValue({ rpc })
  return fixture
}

async function screen() {
  const snapshot = await getCaseReviewSnapshot(String(DEBTOR))
  if (!snapshot.ok) throw new Error(`Instantanea no disponible: ${snapshot.code}`)
  return snapshot.snapshot
}

async function acceptInput(overrides: Record<string, unknown> = {}) {
  const shown = await screen()
  return {
    debtorId: String(DEBTOR), decision: 'ACEPTA',
    expected: { asOf: shown.asOf, rulesVersion: shown.rulesVersion, inputsHash: shown.inputsHash },
    supersedes: shown.currentReviewId,
    ...overrides,
  }
}

const intense = { decision: 'MODIFICA', decidedIntervention: 'INTIMACION_ADMINISTRATIVA', decidedIntensity: 3, reasonCode: 'MOTIVO_SINTETICO', checklist: READY_CHECKLIST }

describe('ALIGN-020: recordCaseDecision', () => {
  beforeEach(() => vi.resetAllMocks())

  it('sin sesion: rechazado antes de leer cartera, validar o escribir', async () => {
    const { rpc, requests } = session({ signedIn: false })
    await expect(recordCaseDecision({ cualquiera: 'cosa' })).resolves.toMatchObject({ ok: false, code: 'AUTH_REQUIRED' })
    expect(requests).toEqual([])
    expect(writerFactory).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each(['consulta', 'supervisor', 'importador', 'tp_operator'] as const)('%s no registra y no llega a escribir', async role => {
    const { rpc } = session({ role })
    const input = { debtorId: String(DEBTOR), decision: 'ACEPTA', expected: { asOf: '2026-10-30', rulesVersion: '1.0.0', inputsHash: 'a'.repeat(64) } }
    await expect(recordCaseDecision(input)).resolves.toMatchObject({ ok: false, code: 'ROLE_FORBIDDEN' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('otro tenant: objeto ajeno e inexistente responden igual y no escriben', async () => {
    const { rpc } = session()
    const input = await acceptInput()
    await expect(recordCaseDecision({ ...input, debtorId: String(FOREIGN_DEBTOR) })).resolves.toMatchObject({ ok: false, code: 'OBJECT_NOT_IN_TENANT' })
    await expect(recordCaseDecision({ ...input, debtorId: '123456' })).resolves.toMatchObject({ ok: false, code: 'OBJECT_NOT_IN_TENANT' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('otro tenant por cookie: la cookie no otorga membresia', async () => {
    const { rpc } = session({ cookie: String(OTHER_TENANT) })
    const result = await recordCaseDecision({ debtorId: String(DEBTOR), decision: 'ACEPTA', expected: { asOf: '2026-10-30', rulesVersion: '1.0.0', inputsHash: 'a'.repeat(64) } })
    expect(result).toMatchObject({ ok: false, code: 'TENANT_ACCESS_NOT_FOUND' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('motivo faltante: rechazado sin escribir', async () => {
    const { rpc } = session()
    const input = await acceptInput({ decision: 'RECHAZA' })
    await expect(recordCaseDecision(input)).resolves.toMatchObject({ ok: false, code: 'REASON_REQUIRED' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('caso valido: una insercion con actor, tenant, hash, version y corte de servidor', async () => {
    const { rpc, created, requests } = session()
    const input = await acceptInput()
    const shown = await screen()
    const result = await recordCaseDecision(input)
    expect(result).toEqual({
      ok: true, reviewId: '100', debtorId: String(DEBTOR), created: true, status: 'REGISTRADA',
      asOf: '2026-10-30', rulesVersion: RULES_VERSION, inputsHash: shown.inputsHash,
      suggestedIntervention: shown.suggestedIntervention, suggestedIntensity: shown.suggestedIntensity,
    })
    expect(created.case_review).toHaveLength(1)
    const args = rpc.mock.calls[0][1]
    expect(args).toMatchObject({
      p_reviewer_user: '42', p_tenant: String(TENANT), p_debtor: String(DEBTOR), p_rules_version: RULES_VERSION, p_as_of: '2026-10-30',
      p_inputs_hash: shown.inputsHash, p_decision: 'ACEPTA', p_suggested_intervention: shown.suggestedIntervention,
      p_suggested_intensity: shown.suggestedIntensity, p_decided_intervention: shown.suggestedIntervention, p_decided_intensity: shown.suggestedIntensity,
      p_reason_code: null, p_reason_text: null, p_checklist: {}, p_supersedes: null,
    })
    expect(args.p_inputs_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(args.p_idempotency_key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(args.p_explanation).toMatchObject({ frase_contrastiva: expect.any(String), regla: expect.any(String) })
    expect(revalidatePath).toHaveBeenCalledWith(`/debtors/${DEBTOR}`)
    // ALIGN-019: reason_text no se pide nunca y ninguna tabla nueva se lee con *.
    for (const request of requests.filter(item => ['case_review', 'case_review_approval', 'import_batch'].includes(item.table))) {
      expect(request.select, request.table).not.toContain('*')
      expect(request.select, request.table).not.toContain('reason_text')
    }
    // Lo que queda en la explicacion y sale en la respuesta no lleva datos personales.
    for (const text of [JSON.stringify(result), JSON.stringify(args.p_explanation)]) {
      expect(text).not.toContain('sintetico@example.test')
      expect(text).not.toContain('Persona sintetica')
      expect(text).not.toContain('OBJ-SINTETICO')
    }
  })

  it('el hash es SHA-256 de los insumos canonicos, no depende del orden de lectura', async () => {
    session()
    const shown = await screen()
    const canonical = '{"as_of":"2026-10-30","contactos_activos":{"estado":"OBSERVADO","valor":1},"id":"99","obligaciones":[' +
      '{"current_amount":{"estado":"OBSERVADO","valor":1250},"due_date":{"estado":"OBSERVADO","valor":"2026-09-01"},"estado_origen":{"estado":"NO_INTEGRADO","valor":null},"id":"1","periodo_fiscal":{"estado":"NO_INTEGRADO","valor":null}},' +
      '{"current_amount":{"estado":"OBSERVADO","valor":90000.5},"due_date":{"estado":"OBSERVADO","valor":"2026-03-01"},"estado_origen":{"estado":"NO_INTEGRADO","valor":null},"id":"2","periodo_fiscal":{"estado":"NO_INTEGRADO","valor":null}}' +
      '],"personas":[{"porcentaje_declarado":{"estado":"OBSERVADO","valor":100},"tipo":{"estado":"NO_INFORMADO_EN_ORIGEN","valor":null}}],' +
      '"source_updated_at":{"estado":"OBSERVADO","valor":"2026-10-29"},"vulnerabilidad":{"estado":"NO_INFORMADO_EN_ORIGEN","valor":null}}'
    expect(shown.inputsHash).toBe(createHash('sha256').update(canonical).digest('hex'))
    const reversed = portfolio()
    reversed.debt.reverse()
    session({ tables: reversed })
    expect((await screen()).inputsHash).toBe(shown.inputsHash)
  })

  it('usa el corte del dato, no la hora del servidor', async () => {
    session()
    const before = await screen()
    vi.useFakeTimers({ now: new Date('2031-01-15T12:00:00Z') })
    try {
      const after = await screen()
      expect(after.asOf).toBe('2026-10-30')
      expect(after.inputsHash).toBe(before.inputsHash)
      expect(after.suggestedIntervention).toBe(before.suggestedIntervention)
    } finally {
      vi.useRealTimers()
    }
  })

  describe('doble envio', () => {
    it('dos envios seguidos: una sola insercion y la misma revision', async () => {
      const { created } = session()
      const input = await acceptInput()
      const first = await recordCaseDecision(input)
      const second = await recordCaseDecision(input)
      expect(first).toMatchObject({ ok: true, created: true, reviewId: '100' })
      expect(second).toMatchObject({ ok: true, created: false, reviewId: '100' })
      expect(created.case_review).toHaveLength(1)
    })

    it('ocho envios simultaneos: una sola insercion', async () => {
      const { created } = session()
      const input = await acceptInput()
      const results = await Promise.all(Array.from({ length: 8 }, () => recordCaseDecision(input)))
      expect(results.filter(item => item.ok && item.created)).toHaveLength(1)
      expect(results.every(item => item.ok && item.reviewId === '100')).toBe(true)
      expect(created.case_review).toHaveLength(1)
    })

    it('la clave la deriva el servidor: otro contenido para el mismo antecedente no entra', async () => {
      const { created, rpc } = session()
      const input = await acceptInput()
      await recordCaseDecision(input)
      const other = await recordCaseDecision({ ...input, decision: 'POSPONE', reasonCode: 'MOTIVO_SINTETICO' })
      expect(other).toMatchObject({ ok: false, code: 'REVIEW_CONFLICT' })
      expect(created.case_review).toHaveLength(1)
      const [first, second] = rpc.mock.calls.map(call => call[1].p_idempotency_key)
      expect(second).toBe(first)
    })

    it('dos personas sobre el mismo objeto: la segunda no confirma en silencio', async () => {
      const { created, tables, rpc } = session()
      const input = await acceptInput()
      await recordCaseDecision(input)
      signInAs('operador', tables, rpc, 43)
      await expect(recordCaseDecision(input)).resolves.toMatchObject({ ok: false, code: 'REVIEW_CONFLICT' })
      expect(created.case_review).toHaveLength(1)
      expect(created.case_review[0].p_reviewer_user).toBe('42')
    })
  })

  describe('insumos o version cambiados', () => {
    it.each([
      ['hash', { inputsHash: 'b'.repeat(64) }, 'INSUMOS'],
      ['version', { rulesVersion: '0.9.0' }, 'VERSION'],
      ['corte', { asOf: '2026-01-01' }, 'CORTE'],
    ])('%s distinto: no escribe y devuelve lo vigente', async (_name, change, marker) => {
      const { rpc } = session()
      const input = await acceptInput()
      const result = await recordCaseDecision({ ...input, expected: { ...input.expected, ...change } })
      expect(result).toMatchObject({ ok: false, code: 'SUGGESTION_OUTDATED', changed: [marker], current: { inputsHash: input.expected.inputsHash, rulesVersion: RULES_VERSION } })
      expect(rpc).not.toHaveBeenCalled()
    })

    it('cambia un importe entre la pantalla y el envio: no escribe; con lo vigente, si', async () => {
      const { rpc, tables, created } = session()
      const input = await acceptInput()
      tables.debt[0].current_amount = 90001
      const result = await recordCaseDecision(input)
      expect(result).toMatchObject({ ok: false, code: 'SUGGESTION_OUTDATED', changed: ['INSUMOS'] })
      expect(rpc).not.toHaveBeenCalled()
      await expect(recordCaseDecision(await acceptInput())).resolves.toMatchObject({ ok: true, created: true })
      expect(created.case_review).toHaveLength(1)
    })

    it('un corte nuevo cambia corte e insumos', async () => {
      const { rpc, tables } = session()
      const input = await acceptInput()
      tables.import_batch.push({ id: 3, tenant: TENANT, as_of: '2026-11-15', source_updated_at: '2026-11-14', status: 'PUBLICADO', supersedes: null })
      await expect(recordCaseDecision(input)).resolves.toMatchObject({ ok: false, code: 'SUGGESTION_OUTDATED', changed: ['INSUMOS', 'CORTE'] })
      expect(rpc).not.toHaveBeenCalled()
    })
  })

  describe('importacion entre el recalculo y la escritura', () => {
    const published = (id: number, asOf: string, supersedes: number | null = null) => ({ id, tenant: TENANT, as_of: asOf, source_updated_at: '2026-11-14', status: 'PUBLICADO', supersedes })

    it('la funcion recibe el evento de corte con que se calculo, y el navegador no lo ve', async () => {
      const { rpc } = session()
      const input = await acceptInput()
      const result = await recordCaseDecision(input)
      expect(rpc.mock.calls[0][1].p_cutoff_batch).toBe('2')
      expect(JSON.stringify(result)).not.toContain('cutoffBatch')
      expect(JSON.stringify(await getCaseReviewSnapshot(String(DEBTOR)))).not.toContain('cutoffBatch')
    })

    it('el corte se lee antes que la cartera: una importacion posterior siempre lo invalida', async () => {
      const { requests } = session()
      await getCaseReviewSnapshot(String(DEBTOR))
      const position = (table: string) => requests.findIndex(request => request.table === table)
      for (const table of ['debt', 'debtor_person', 'person', 'debtor_contact']) expect(position('import_batch'), table).toBeLessThan(position(table))
    })

    it('se publica otro lote: rechazado, sin fila y con lo vigente', async () => {
      const { created } = session({ database: { beforeWrite: tables => {
        if (tables.import_batch.length === 2) {
          tables.import_batch.push(published(3, '2026-11-15'))
          tables.debt[0].current_amount = 90001
        }
      } } })
      const result = await recordCaseDecision(await acceptInput())
      expect(result).toMatchObject({ ok: false, code: 'SUGGESTION_OUTDATED', changed: ['INSUMOS', 'CORTE'], current: { asOf: '2026-11-15' } })
      expect(JSON.stringify(result)).not.toContain('cutoffBatch')
      expect(created.case_review).toHaveLength(0)
      expect(revalidatePath).not.toHaveBeenCalled()
    })

    it('empieza una carga: rechazado por falta de corte', async () => {
      const { created } = session({ database: { beforeWrite: tables => {
        tables.import_batch.push({ ...published(3, '2026-11-15'), status: 'VALIDADO' })
      } } })
      await expect(recordCaseDecision(await acceptInput())).resolves.toMatchObject({ ok: false, code: 'CUTOFF_NOT_AVAILABLE' })
      expect(created.case_review).toHaveLength(0)
    })

    it('un lote nuevo con el mismo contenido: lo que cambio es el corte, y con lo vigente vuelve a entrar', async () => {
      let fired = false
      const { created } = session({ database: { beforeWrite: tables => {
        if (!fired) tables.import_batch.push({ ...published(3, '2026-10-30'), source_updated_at: '2026-10-29' })
        fired = true
      } } })
      const input = await acceptInput()
      await expect(recordCaseDecision(input)).resolves.toMatchObject({ ok: false, code: 'SUGGESTION_OUTDATED', changed: ['CORTE'] })
      expect(created.case_review).toHaveLength(0)
      await expect(recordCaseDecision(input)).resolves.toMatchObject({ ok: true, created: true })
    })

    it('una lectura fallida despues del rechazo no se confunde con exito', async () => {
      const tables = portfolio()
      let failing = false
      const { rpc } = session({ tables, fail: request => failing && request.table === 'case_review' ? { message: 'detalle interno', code: '42501' } : null, database: { failWith: { message: 'CUTOFF_CHANGED', code: 'P0001' } } })
      const input = await acceptInput()
      writerFactory.mockReturnValue({ rpc: async (...args: Parameters<typeof rpc>) => { failing = true; return rpc(...args) } })
      await expect(recordCaseDecision(input)).resolves.toMatchObject({ ok: false, code: 'SUGGESTION_UNAVAILABLE' })
    })
  })

  describe('corte del lote', () => {
    const batch = (id: number, status: string, supersedes: number | null, asOf = '2026-11-15') => ({ id, tenant: TENANT, as_of: asOf, source_updated_at: null, status, supersedes })
    const cases: [string, RawRow[], string | null][] = [
      ['sin lote', [], null],
      ['solo validado: la carga no termino', [batch(1, 'VALIDADO', null)], null],
      ['carga en curso sobre uno publicado', [batch(1, 'PUBLICADO', null, '2026-10-01'), batch(2, 'VALIDADO', null)], null],
      ['carga fallida a mitad de camino sobre uno publicado', [batch(1, 'PUBLICADO', null, '2026-10-01'), batch(2, 'VALIDADO', null), batch(3, 'FALLIDO', 2)], null],
      ['lote bloqueado antes de escribir', [batch(1, 'PUBLICADO', null, '2026-10-01'), batch(2, 'FALLIDO', null)], '2026-10-01'],
      ['vista previa recibida o descartada', [batch(1, 'PUBLICADO', null, '2026-10-01'), batch(2, 'RECIBIDO', null), batch(3, 'DESCARTADO', null)], '2026-10-01'],
      ['publicado reemplazado por descartado', [batch(1, 'PUBLICADO', null, '2026-10-01'), batch(2, 'DESCARTADO', 1)], null],
      ['el ultimo publicado gana', [batch(1, 'VALIDADO', null, '2026-10-01'), batch(2, 'PUBLICADO', 1, '2026-10-01'), batch(3, 'VALIDADO', null), batch(4, 'PUBLICADO', 3)], '2026-11-15'],
      ['lote de otro municipio no cuenta', [{ ...batch(1, 'PUBLICADO', null), tenant: OTHER_TENANT }], null],
    ]

    it.each(cases)('%s', async (_name, rows, asOf) => {
      const tables = portfolio()
      tables.import_batch = rows
      const { rpc } = session({ tables })
      const snapshot = await getCaseReviewSnapshot(String(DEBTOR))
      if (asOf === null) expect(snapshot).toMatchObject({ ok: false, code: 'CUTOFF_NOT_AVAILABLE' })
      else expect(snapshot).toMatchObject({ ok: true, snapshot: { asOf } })
      const result = await recordCaseDecision({ debtorId: String(DEBTOR), decision: 'ACEPTA', expected: { asOf: asOf ?? '2026-10-01', rulesVersion: RULES_VERSION, inputsHash: 'a'.repeat(64) } })
      expect(result).toMatchObject({ ok: false, code: asOf === null ? 'CUTOFF_NOT_AVAILABLE' : 'SUGGESTION_OUTDATED' })
      expect(rpc).not.toHaveBeenCalled()
    })
  })

  it.each(['debtor', 'debt', 'debtor_person', 'person', 'debtor_contact', 'import_batch', 'case_review'])('lectura fallida de %s: no calcula sobre datos parciales ni escribe', async table => {
    const healthy = session()
    const input = await acceptInput()
    expect(healthy.rpc).not.toHaveBeenCalled()
    const { rpc } = session({ fail: request => request.table === table ? { message: 'detalle interno de la base', code: '42501' } : null })
    const result = await recordCaseDecision(input)
    expect(result).toMatchObject({ ok: false, code: 'SUGGESTION_UNAVAILABLE' })
    expect(JSON.stringify(result)).not.toContain('detalle interno')
    expect(rpc).not.toHaveBeenCalled()
  })

  describe('cadena de decisiones', () => {
    it('reemplaza la vigente y exige declararla', async () => {
      const { created } = session()
      const first = await recordCaseDecision(await acceptInput())
      expect(first).toMatchObject({ ok: true, reviewId: '100' })
      const shown = await screen()
      expect(shown.currentReviewId).toBe('100')
      const next = await acceptInput({ decision: 'POSPONE', reasonCode: 'MOTIVO_SINTETICO' })
      await expect(recordCaseDecision({ ...next, supersedes: null })).resolves.toMatchObject({ ok: false, code: 'REVIEW_CONFLICT' })
      await expect(recordCaseDecision(next)).resolves.toMatchObject({ ok: true, created: true, reviewId: '101' })
      expect(created.case_review[1].p_supersedes).toBe('100')
      await expect(recordCaseDecision({ ...next, supersedes: '100', decision: 'RECHAZA' })).resolves.toMatchObject({ ok: false, code: 'REVIEW_CONFLICT' })
      expect(created.case_review).toHaveLength(2)
    })

    it('una vigente de una carga externa sin clave derivada tambien bloquea una primera decision', async () => {
      const tables = portfolio()
      const { rpc } = session({ tables })
      const input = await acceptInput()
      tables.case_review.push({ id: 50, tenant: TENANT, debtor: DEBTOR, supersedes: null, idempotency_key: '00000000-0000-4000-8000-000000000000' })
      await expect(recordCaseDecision(input)).resolves.toMatchObject({ ok: false, code: 'REVIEW_CONFLICT' })
      expect(rpc).not.toHaveBeenCalled()
    })

    it('un antecedente inexistente tambien se rechaza sin escribir', async () => {
      const { rpc } = session()
      await expect(recordCaseDecision(await acceptInput({ supersedes: '999' }))).resolves.toMatchObject({ ok: false, code: 'REVIEW_CONFLICT' })
      expect(rpc).not.toHaveBeenCalled()
    })
  })

  describe('reglas sobre la sugerencia recalculada', () => {
    it('MODIFICA igual a la sugerencia se rechaza', async () => {
      const { rpc } = session()
      const shown = await screen()
      const result = await recordCaseDecision(await acceptInput({
        decision: 'MODIFICA', reasonCode: 'MOTIVO', decidedIntervention: shown.suggestedIntervention, decidedIntensity: shown.suggestedIntensity,
      }))
      expect(result).toMatchObject({ ok: false, code: 'MODIFICA_WITHOUT_CHANGE' })
      expect(rpc).not.toHaveBeenCalled()
    })

    it('intensidad 3 queda pendiente de supervisor', async () => {
      const { rpc } = session()
      const result = await recordCaseDecision(await acceptInput(intense))
      expect(result).toMatchObject({ ok: true, status: 'PENDIENTE_SUPERVISOR', created: true })
      expect(rpc.mock.calls[0][1]).toMatchObject({ p_decided_intensity: 3, p_reason_code: 'MOTIVO_SINTETICO', p_checklist: READY_CHECKLIST })
    })

    it('intensidad 3 sin lista de control o sin motivo no llega a escribir', async () => {
      const { rpc } = session()
      const withoutChecklist = await acceptInput({ ...intense, checklist: {} })
      await expect(recordCaseDecision(withoutChecklist)).resolves.toMatchObject({ ok: false, code: 'CHECKLIST_REQUIRED' })
      const withoutReason = await acceptInput({ ...intense, reasonCode: null })
      await expect(recordCaseDecision(withoutReason)).resolves.toMatchObject({ ok: false, code: 'REASON_REQUIRED' })
      expect(rpc).not.toHaveBeenCalled()
    })

    it('reason_text llega sin normalizar a la funcion', async () => {
      const { rpc } = session()
      const reasonText = `  Motivo con espacios y salto\n  `
      await recordCaseDecision(await acceptInput({ decision: 'RECHAZA', reasonCode: 'MOTIVO', reasonText }))
      expect(rpc.mock.calls[0][1].p_reason_text).toBe(reasonText)
    })
  })

  describe('traduccion de rechazos de la funcion', () => {
    it.each([
      ['ACTOR_NOT_ACTIVE_MEMBER', 'ACTOR_NOT_ACTIVE_MEMBER'],
      ['ROLE_NOT_ALLOWED', 'ROLE_FORBIDDEN'],
      ['OBJECT_NOT_IN_TENANT', 'OBJECT_NOT_IN_TENANT'],
      ['IDEMPOTENCY_KEY_CONFLICT', 'REVIEW_CONFLICT'],
      ['SUPERSEDES_NOT_FOUND', 'SUPERSEDES_NOT_FOUND'],
      ['INVALID_CASE_REVIEW:case_review_reason_text_not_blank', 'REASON_TEXT_BLANK'],
      ['INVALID_CASE_REVIEW:case_review_reason_text_length', 'REASON_TEXT_TOO_LONG'],
      ['INVALID_CASE_REVIEW:case_review_reason_text_requires_code', 'REASON_REQUIRED'],
      ['INVALID_CASE_REVIEW:case_review_decision_requires_reason', 'REASON_REQUIRED'],
      ['INVALID_CASE_REVIEW:case_review_intense_requires_checklist', 'CHECKLIST_REQUIRED'],
      ['INVALID_CASE_REVIEW:case_review_checklist_shape', 'CHECKLIST_INVALID'],
      ['INVALID_CASE_REVIEW:case_review_modifica_changes_suggestion', 'MODIFICA_WITHOUT_CHANGE'],
      ['INVALID_CASE_REVIEW:case_review_supersedes_key', 'REVIEW_CONFLICT'],
      ['INVALID_CASE_REVIEW:case_review_supersedes_anterior', 'SUPERSEDES_NOT_FOUND'],
      ['INVALID_CASE_REVIEW:restriccion_nueva_sin_traducir', 'WRITE_REJECTED'],
      ['MENSAJE_NUEVO_DE_LA_FUNCION', 'WRITE_REJECTED'],
    ])('%s -> %s', async (message, code) => {
      session({ database: { failWith: { message, code: 'P0001' } } })
      const result = await recordCaseDecision(await acceptInput())
      expect(result).toMatchObject({ ok: false, code, message: CASE_REVIEW_MESSAGES[code as CaseReviewErrorCode] })
      expect(revalidatePath).not.toHaveBeenCalled()
    })

    it.each([
      ['credencial vencida', { message: 'JWT expired', code: 'PGRST303' }],
      ['sin privilegio', { message: 'permission denied for function record_case_review', code: '42501' }],
      ['red', { message: 'TypeError: fetch failed' }],
    ])('%s: no disponible, sin el mensaje interno', async (_name, failWith) => {
      session({ database: { failWith } })
      const result = await recordCaseDecision(await acceptInput())
      expect(result).toMatchObject({ ok: false, code: 'WRITE_UNAVAILABLE' })
      expect(JSON.stringify(result)).not.toContain(failWith.message)
    })

    it('sin credencial configurada: rechaza sin escribir', async () => {
      session()
      const input = await acceptInput()
      writerFactory.mockReturnValue(null)
      await expect(recordCaseDecision(input)).resolves.toMatchObject({ ok: false, code: 'WRITE_NOT_CONFIGURED' })
    })

    it.each([
      ['sin datos', null], ['id invalido', { review_id: 'x', created: true, pending_supervisor: false }], ['sin indicador', { review_id: 5, pending_supervisor: false }],
    ])('respuesta inesperada de la funcion (%s): no se informa como registrada', async (_name, data) => {
      session()
      const input = await acceptInput()
      writerFactory.mockReturnValue({ rpc: vi.fn(async () => ({ data, error: null })) })
      await expect(recordCaseDecision(input)).resolves.toMatchObject({ ok: false, code: 'WRITE_UNAVAILABLE' })
    })

    it('una excepcion inesperada no sale del servidor con su detalle', async () => {
      session()
      const input = await acceptInput()
      writerFactory.mockImplementation(() => { throw new Error('detalle con secreto') })
      const result = await recordCaseDecision(input)
      expect(result).toMatchObject({ ok: false, code: 'WRITE_UNAVAILABLE' })
      expect(JSON.stringify(result)).not.toContain('secreto')
    })
  })
})

describe('ALIGN-020: approveCaseDecision', () => {
  beforeEach(() => vi.resetAllMocks())

  async function proposal() {
    const fixture = session()
    const proposed = await recordCaseDecision(await acceptInput(intense))
    if (!proposed.ok) throw new Error(`Propuesta rechazada: ${proposed.code}`)
    return { ...fixture, reviewId: proposed.reviewId }
  }

  const approveInput = (reviewId: string, overrides: Record<string, unknown> = {}) => ({ caseReviewId: reviewId, decision: 'APRUEBA', checklist: READY_CHECKLIST, ...overrides })

  it.each(['operador', 'consulta', 'importador', 'tp_operator'] as const)('%s no aprueba: rechazado sin escribir', async role => {
    const { rpc } = session({ role })
    await expect(approveCaseDecision(approveInput('5'))).resolves.toMatchObject({ ok: false, code: 'ROLE_FORBIDDEN' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('sin sesion: rechazado sin leer', async () => {
    const { requests, rpc } = session({ signedIn: false })
    await expect(approveCaseDecision(approveInput('5'))).resolves.toMatchObject({ ok: false, code: 'AUTH_REQUIRED' })
    expect(requests).toEqual([])
    expect(rpc).not.toHaveBeenCalled()
  })

  it('supervisor aprueba una vez; el doble envio no crea otra fila', async () => {
    const { reviewId, tables, rpc, created } = await proposal()
    signInAs('supervisor', tables, rpc)
    const first = await approveCaseDecision(approveInput(reviewId))
    expect(first).toEqual({ ok: true, approvalId: '101', caseReviewId: reviewId, debtorId: String(DEBTOR), created: true, status: 'APROBADA' })
    await expect(approveCaseDecision(approveInput(reviewId))).resolves.toMatchObject({ ok: true, created: false, approvalId: '101' })
    expect(created.case_review_approval).toHaveLength(1)
    const call = rpc.mock.calls.find(item => item[0] === 'record_case_review_approval')!
    expect(call[1]).toMatchObject({ p_approver_user: '42', p_tenant: String(TENANT), p_case_review: reviewId, p_decision: 'APRUEBA', p_reason_code: null, p_checklist: READY_CHECKLIST, p_supersedes: null })
    expect(revalidatePath).toHaveBeenCalledWith(`/debtors/${DEBTOR}`)
  })

  it('otra aprobacion distinta sin declarar la vigente se rechaza; declarandola, se reemplaza', async () => {
    const { reviewId, tables, rpc, created } = await proposal()
    signInAs('supervisor', tables, rpc)
    const first = await approveCaseDecision(approveInput(reviewId))
    if (!first.ok) throw new Error(first.code)
    const objection = approveInput(reviewId, { decision: 'OBJETA', reasonCode: 'MOTIVO_SINTETICO' })
    await expect(approveCaseDecision(objection)).resolves.toMatchObject({ ok: false, code: 'APPROVAL_CONFLICT' })
    await expect(approveCaseDecision({ ...objection, supersedes: '999' })).resolves.toMatchObject({ ok: false, code: 'APPROVAL_CONFLICT' })
    await expect(approveCaseDecision({ ...objection, supersedes: first.approvalId })).resolves.toMatchObject({ ok: true, created: true, status: 'OBJETADA' })
    expect(created.case_review_approval).toHaveLength(2)
  })

  it('revision de otro tenant o inexistente: mismo rechazo y sin escribir', async () => {
    const { rpc, tables } = await proposal()
    tables.case_review.push({ id: 700, tenant: OTHER_TENANT, debtor: FOREIGN_DEBTOR, supersedes: null, idempotency_key: 'x', rules_version: RULES_VERSION, as_of: '2026-10-30', inputs_hash: 'c'.repeat(64), decided_intensity: 3 })
    rpc.mockClear()
    signInAs('supervisor', tables, rpc)
    await expect(approveCaseDecision(approveInput('700'))).resolves.toMatchObject({ ok: false, code: 'REVIEW_NOT_IN_TENANT' })
    await expect(approveCaseDecision(approveInput('123456'))).resolves.toMatchObject({ ok: false, code: 'REVIEW_NOT_IN_TENANT' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('una decision menor a 3 no se aprueba', async () => {
    const fixture = session()
    const accepted = await recordCaseDecision(await acceptInput())
    if (!accepted.ok) throw new Error(accepted.code)
    fixture.rpc.mockClear()
    signInAs('supervisor', fixture.tables, fixture.rpc)
    await expect(approveCaseDecision(approveInput(accepted.reviewId))).resolves.toMatchObject({ ok: false, code: 'APPROVAL_NOT_REQUIRED' })
    expect(fixture.rpc).not.toHaveBeenCalled()
  })

  it('una revision reemplazada no se aprueba', async () => {
    const { reviewId, tables, rpc } = await proposal()
    tables.case_review.push({ id: 900, tenant: TENANT, debtor: DEBTOR, supersedes: Number(reviewId), idempotency_key: 'y', rules_version: RULES_VERSION, as_of: '2026-10-30', inputs_hash: 'c'.repeat(64), decided_intensity: 1 })
    rpc.mockClear()
    signInAs('supervisor', tables, rpc)
    await expect(approveCaseDecision(approveInput(reviewId))).resolves.toMatchObject({ ok: false, code: 'REVIEW_SUPERSEDED' })
    expect(rpc).not.toHaveBeenCalled()
  })

  describe('importacion entre el recalculo y la aprobacion', () => {
    function intercalated(reviewId: string, tables: Rows, created: Record<string, RawRow[]>, change: (tables: Rows) => void) {
      const database = fakeDatabase(tables, { beforeWrite: change })
      signInAs('supervisor', tables, database.rpc)
      return { reviewId, approvals: () => database.created.case_review_approval, created }
    }

    it('empieza un lote VALIDADO: APRUEBA rechazada y sin fila', async () => {
      const { reviewId, tables, created } = await proposal()
      const run = intercalated(reviewId, tables, created, current => {
        current.import_batch.push({ id: 3, tenant: TENANT, as_of: '2026-11-15', source_updated_at: null, status: 'VALIDADO', supersedes: null })
        current.debt[0].current_amount = 90001
      })
      await expect(approveCaseDecision(approveInput(reviewId))).resolves.toMatchObject({ ok: false, code: 'CUTOFF_NOT_AVAILABLE' })
      expect(run.approvals()).toHaveLength(0)
    })

    it('se publica otro lote: APRUEBA rechazada, sin fila y con lo vigente', async () => {
      const { reviewId, tables, created } = await proposal()
      const run = intercalated(reviewId, tables, created, current => {
        current.import_batch.push({ id: 3, tenant: TENANT, as_of: '2026-11-15', source_updated_at: '2026-11-14', status: 'PUBLICADO', supersedes: null })
      })
      await expect(approveCaseDecision(approveInput(reviewId))).resolves.toMatchObject({ ok: false, code: 'SUGGESTION_OUTDATED', current: { asOf: '2026-11-15' } })
      expect(run.approvals()).toHaveLength(0)
    })

    it('OBJETA no depende del corte: entra con la carga en curso y declara el corte nulo', async () => {
      const { reviewId, tables, created } = await proposal()
      const database = fakeDatabase(tables, { beforeWrite: current => {
        current.import_batch.push({ id: 3, tenant: TENANT, as_of: '2026-11-15', source_updated_at: null, status: 'VALIDADO', supersedes: null })
      } })
      signInAs('supervisor', tables, database.rpc)
      await expect(approveCaseDecision({ caseReviewId: reviewId, decision: 'OBJETA', reasonCode: 'MOTIVO_SINTETICO' })).resolves.toMatchObject({ ok: true, status: 'OBJETADA' })
      expect(database.rpc.mock.calls[0][1].p_cutoff_batch).toBeNull()
      expect(created.case_review).toHaveLength(1)
    })
  })

  describe('insumos cambiados desde la propuesta', () => {
    it('APRUEBA no confirma en silencio: rechazada y sin escribir', async () => {
      const { reviewId, tables, rpc } = await proposal()
      tables.debt[0].current_amount = 90001
      rpc.mockClear()
      signInAs('supervisor', tables, rpc)
      await expect(approveCaseDecision(approveInput(reviewId))).resolves.toMatchObject({ ok: false, code: 'SUGGESTION_OUTDATED', changed: ['INSUMOS'], current: { asOf: '2026-10-30' } })
      expect(rpc).not.toHaveBeenCalled()
    })

    it('APRUEBA con otra version de reglas o corte tampoco', async () => {
      const { reviewId, tables, rpc } = await proposal()
      const stored = tables.case_review.find(row => String(row.id) === reviewId)!
      stored.rules_version = '0.9.0'
      rpc.mockClear()
      signInAs('supervisor', tables, rpc)
      await expect(approveCaseDecision(approveInput(reviewId))).resolves.toMatchObject({ ok: false, code: 'SUGGESTION_OUTDATED', changed: ['VERSION'] })
      expect(rpc).not.toHaveBeenCalled()
    })

    it('OBJETA sigue disponible: frena la propuesta, no la confirma', async () => {
      const { reviewId, tables, rpc } = await proposal()
      tables.debt[0].current_amount = 90001
      signInAs('supervisor', tables, rpc)
      await expect(approveCaseDecision({ caseReviewId: reviewId, decision: 'OBJETA', reasonCode: 'MOTIVO_SINTETICO' })).resolves.toMatchObject({ ok: true, status: 'OBJETADA' })
    })

    it('APRUEBA sin corte vigente tampoco', async () => {
      const { reviewId, tables, rpc } = await proposal()
      tables.import_batch.push({ id: 9, tenant: TENANT, as_of: '2026-11-15', source_updated_at: null, status: 'VALIDADO', supersedes: null })
      rpc.mockClear()
      signInAs('supervisor', tables, rpc)
      await expect(approveCaseDecision(approveInput(reviewId))).resolves.toMatchObject({ ok: false, code: 'CUTOFF_NOT_AVAILABLE' })
      expect(rpc).not.toHaveBeenCalled()
    })
  })

  it.each([
    ['ACTOR_NOT_ACTIVE_MEMBER', 'ACTOR_NOT_ACTIVE_MEMBER'],
    ['ROLE_NOT_ALLOWED', 'ROLE_FORBIDDEN'],
    ['REVIEW_NOT_IN_TENANT', 'REVIEW_NOT_IN_TENANT'],
    ['SUPERSEDES_CHAIN_INVALID', 'SUPERSEDES_CHAIN_INVALID'],
    ['APPROVER_IS_PROPONENT', 'APPROVER_IS_PROPONENT'],
    ['APPROVAL_NOT_REQUIRED', 'APPROVAL_NOT_REQUIRED'],
    ['REVIEW_SUPERSEDED', 'REVIEW_SUPERSEDED'],
    ['IDEMPOTENCY_KEY_CONFLICT', 'APPROVAL_CONFLICT'],
    ['SUPERSEDES_NOT_FOUND', 'SUPERSEDES_NOT_FOUND'],
    ['INVALID_CASE_REVIEW_APPROVAL:case_review_approval_single_head', 'APPROVAL_CONFLICT'],
    ['INVALID_CASE_REVIEW_APPROVAL:case_review_approval_supersedes_key', 'APPROVAL_CONFLICT'],
    ['INVALID_CASE_REVIEW_APPROVAL:case_review_approval_requires_checklist', 'CHECKLIST_REQUIRED'],
    ['INVALID_CASE_REVIEW_APPROVAL:case_review_approval_objection_requires_reason', 'REASON_REQUIRED'],
    ['INVALID_CASE_REVIEW_APPROVAL:restriccion_nueva', 'WRITE_REJECTED'],
  ])('%s -> %s', async (message, code) => {
    const { reviewId, tables } = await proposal()
    const rpc = vi.fn(async () => ({ data: null, error: { message, code: 'P0001' } }))
    signInAs('supervisor', tables, rpc)
    const result = await approveCaseDecision(approveInput(reviewId))
    expect(result).toMatchObject({ ok: false, code, message: CASE_REVIEW_MESSAGES[code as CaseReviewErrorCode] })
  })

  it('respuesta inesperada de la funcion: no se informa como aprobada', async () => {
    const { reviewId, tables } = await proposal()
    signInAs('supervisor', tables, vi.fn(async () => ({ data: { approval_id: null, created: true }, error: null })))
    await expect(approveCaseDecision(approveInput(reviewId))).resolves.toMatchObject({ ok: false, code: 'WRITE_UNAVAILABLE' })
  })

  it('sin credencial configurada: rechaza sin escribir', async () => {
    const { reviewId, tables, rpc } = await proposal()
    signInAs('supervisor', tables, rpc)
    writerFactory.mockReturnValue(null)
    await expect(approveCaseDecision(approveInput(reviewId))).resolves.toMatchObject({ ok: false, code: 'WRITE_NOT_CONFIGURED' })
  })
})

describe('ALIGN-020: instantanea para la pantalla', () => {
  beforeEach(() => vi.resetAllMocks())

  it('sin sesion responde con el codigo, no lanza', async () => {
    session({ signedIn: false })
    await expect(getCaseReviewSnapshot(String(DEBTOR))).resolves.toMatchObject({ ok: false, code: 'AUTH_REQUIRED' })
  })

  it('una excepcion inesperada se informa como no disponible, sin detalle', async () => {
    session()
    serverClient.mockRejectedValue(new Error('detalle interno'))
    await expect(getCaseReviewSnapshot(String(DEBTOR))).resolves.toEqual({ ok: false, code: 'SUGGESTION_UNAVAILABLE', message: CASE_REVIEW_MESSAGES.SUGGESTION_UNAVAILABLE })
  })

  it('un error de control de Next no se confunde con una falla', async () => {
    session()
    const dynamicUsage = Object.assign(new Error('Uso dinamico'), { digest: 'DYNAMIC_SERVER_USAGE' })
    serverClient.mockRejectedValue(dynamicUsage)
    await expect(getCaseReviewSnapshot(String(DEBTOR))).rejects.toBe(dynamicUsage)
  })

  it('un id invalido no consulta', async () => {
    const { requests } = session()
    await expect(getCaseReviewSnapshot('7x')).resolves.toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(requests.some(item => item.table === 'debtor')).toBe(false)
  })

  it('consulta y tp_operator pueden ver la sugerencia', async () => {
    for (const role of ['consulta', 'tp_operator'] as const) {
      session({ role })
      await expect(getCaseReviewSnapshot(String(DEBTOR))).resolves.toMatchObject({ ok: true, snapshot: { debtorId: String(DEBTOR), asOf: '2026-10-30', currentReviewId: null } })
    }
  })

  it('el sistema nunca sugiere 3 o 4', async () => {
    session()
    expect((await screen()).suggestedIntensity).toBeLessThanOrEqual(2)
  })
})
