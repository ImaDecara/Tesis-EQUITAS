import { beforeEach, describe, expect, it, vi } from 'vitest'

const { serverClient, cookieStore, writerFactory } = vi.hoisted(() => ({
  serverClient: vi.fn(), cookieStore: vi.fn(), writerFactory: vi.fn(),
}))
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient: serverClient }))
vi.mock('@/lib/supabase-config', () => ({ hasSupabaseCredentials: true }))
vi.mock('next/headers', () => ({ cookies: cookieStore }))
vi.mock('@/lib/server/case-review-writer', () => ({ createCaseReviewWriter: writerFactory }))

import { CASE_REVIEW_STATUS_LABELS } from '@/lib/domain/case-review-contract'
import { chainParticipation } from '@/lib/domain/case-review-history'
import { RECORDED_STATUS_LABELS } from '@/lib/domain/recorded-decision'
import { ROLE_LABELS as DOMAIN_ROLE_LABELS, roleLabel } from '@/lib/domain/role-labels'
import { loadCaseReviewScreen } from '@/lib/server/case-review-screen'
import { ROLE_LABELS, roleLabel as serverRoleLabel } from '@/lib/server/viewer-context'
import type { RawRow } from '@/types/equitas-domain'
import { createPaginatedSupabase } from '../fixtures/paginated-supabase'

describe('rótulos', () => {
  it('los estados del historial usan los mismos rótulos que la decisión registrada', () => {
    expect(CASE_REVIEW_STATUS_LABELS).toEqual({
      REGISTRADA: RECORDED_STATUS_LABELS.REGISTRADA,
      PENDIENTE_SUPERVISOR: RECORDED_STATUS_LABELS.PENDIENTE_APROBACION,
      APROBADA: RECORDED_STATUS_LABELS.APROBADA,
      OBJETADA: RECORDED_STATUS_LABELS.OBJETADA,
    })
  })

  it('los roles vigentes tienen rótulo; uno histórico se ve como rol anterior; el servidor reexporta lo mismo', () => {
    expect(roleLabel('ADMIN')).toBe('Administrador')
    expect(roleLabel('USER')).toBe('Usuario')
    expect(roleLabel('supervisor')).toBe('supervisor (rol anterior)')
    expect(ROLE_LABELS).toBe(DOMAIN_ROLE_LABELS)
    expect(serverRoleLabel).toBe(roleLabel)
  })
})

describe('participación en la cadena de una propuesta', () => {
  it('quien registró esta versión o una anterior participó; quien no, no', () => {
    const result = chainParticipation([
      { id: '1', supersedes: null, mine: true },
      { id: '2', supersedes: '1', mine: false },
      { id: '3', supersedes: '2', mine: false },
      { id: '4', supersedes: null, mine: false },
    ])
    expect(Object.fromEntries(result)).toEqual({ 1: true, 2: true, 3: true, 4: false })
  })

  it('un ciclo o un antecedente posterior no se recorre', () => {
    const result = chainParticipation([
      { id: '5', supersedes: '6', mine: false },
      { id: '6', supersedes: '5', mine: true },
    ])
    expect(result.get('5')).toBe(false)
    expect(result.get('6')).toBe(true)
  })
})

// La pantalla compara `reviewer` y `approver` con quien mira y solo deja pasar el booleano.
const TENANT = 7
const DEBTOR = 99
const VIEWER = 42
const OTHER = 43
const CHECKLIST = { situacion_hogar: 'NO_DISPONIBLE', estado_juridico_verificado: true, canal_valido: true, alternativa_asistida_ofrecida: true }
const review = (id: number, reviewer: number, patch: RawRow = {}): RawRow => ({
  id, tenant: TENANT, debtor: DEBTOR, rules_version: '1.1.0', as_of: '2026-10-30', inputs_hash: 'a'.repeat(64),
  suggested_intervention: 'RECORDATORIO_INFORMATIVO', suggested_intensity: 1, decision: 'MODIFICA', decided_intervention: 'INTIMACION_ADMINISTRATIVA',
  decided_intensity: 3, reason_code: 'CRITERIO_DEL_SERVICIO', checklist: CHECKLIST, reviewer, reviewer_role: 'ADMIN',
  created_at: `2026-11-0${id}T13:00:00+00:00`, supersedes: null, idempotency_key: `k${id}`, ...patch,
})

async function screenFor(reviews: RawRow[], approvals: RawRow[] = []) {
  const { client } = createPaginatedSupabase({
    user: [{ id: VIEWER, auth_user: 'auth-test', status: 'ACTIVE' }],
    tenant_user: [{ id: 1, tenant: TENANT, user: VIEWER, role: 3, status: true }],
    tenant: [{ id: TENANT, status: 'ACTIVE' }],
    role: [{ id: 3, name: 'ADMIN' }],
    debtor: [{ id: DEBTOR, tenant: TENANT, identifier: 'OBJ-SINTETICO' }],
    debt: [], debtor_person: [], person: [], debtor_contact: [],
    import_batch: [{ id: 1, tenant: TENANT, as_of: '2026-10-30', source_updated_at: '2026-10-29', status: 'PUBLICADO', supersedes: null }],
    case_review: reviews,
    case_review_approval: approvals,
  }, { fail: () => null, enforceFilters: true })
  vi.spyOn(client.auth, 'getUser').mockResolvedValue({ data: { user: { id: 'auth-test' } }, error: null } as never)
  serverClient.mockResolvedValue(client)
  cookieStore.mockResolvedValue({ get: () => undefined })
  const screen = await loadCaseReviewScreen(String(DEBTOR))
  if (screen.kind !== 'ready' || !screen.history.ok) throw new Error(`se esperaba un historial: ${JSON.stringify(screen)}`)
  return { screen, entries: screen.history.entries }
}

beforeEach(() => {
  vi.clearAllMocks()
  writerFactory.mockReturnValue({ rpc: vi.fn(async () => ({ data: null, error: null })) })
})

describe('la pantalla marca por identidad', () => {
  it('propuesta propia: mine y participated', async () => {
    const { entries } = await screenFor([review(1, VIEWER)])
    expect(entries[0]).toMatchObject({ mine: true, participated: true })
  })

  it('propuesta ajena que reemplaza una propia: no es mía, pero participé', async () => {
    const { entries } = await screenFor([review(1, VIEWER), review(2, OTHER, { supersedes: 1 })])
    expect(entries.map(entry => [entry.id, entry.mine, entry.participated, entry.isCurrent])).toEqual([['2', false, true, true], ['1', true, true, false]])
  })

  it('propuesta ajena sin intervención propia: se puede responder', async () => {
    const { entries } = await screenFor([review(1, OTHER)], [
      { id: 11, tenant: TENANT, case_review: 1, decision: 'OBJETA', reason_code: 'LISTA_DE_CONTROL_INSUFICIENTE', checklist: {}, approver: VIEWER, approver_role: 'ADMIN', created_at: '2026-11-03T15:00:00+00:00', supersedes: null, idempotency_key: 'a11' },
    ])
    expect(entries[0]).toMatchObject({ mine: false, participated: false, status: 'OBJETADA', approvals: [{ mine: true }] })
  })

  it('al navegador no llega ningún identificador de persona', async () => {
    const { screen } = await screenFor([review(1, OTHER), review(2, VIEWER, { supersedes: 1 })])
    const serialized = JSON.stringify(screen)
    expect(serialized).not.toMatch(/"reviewer"|"approver"|"appUserId"/)
    expect(serialized).not.toContain(`:${OTHER}`)
    expect(serialized).not.toContain(`"${OTHER}"`)
  })
})
