import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { serverClient, cookieStore, createWriter } = vi.hoisted(() => ({ serverClient: vi.fn(), cookieStore: vi.fn(), createWriter: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient: serverClient }))
vi.mock('@/lib/supabase-config', () => ({ hasSupabaseCredentials: true }))
vi.mock('next/headers', () => ({ cookies: cookieStore }))
vi.mock('@/lib/server/case-review-writer', () => ({ createCaseReviewWriter: createWriter }))

import { portfolioLabel } from '@/components/layout/app-frame'
import { RecordedDecisionSummary, recordedDecisionView } from '@/components/case/recorded-decision-summary'
import { DecisionsNotice, decisionView } from '@/components/portfolio/case-cells'
import { ModuleUnavailableCard } from '@/components/portfolio/portfolio-state'
import { loadRawDebtorData } from '@/lib/data/raw-debtor-loader'
import { MODULE_MISSING_EXPLANATION, moduleAvailable, undatedPortfolioText } from '@/lib/domain/database-level-text'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { AccessAuditError, recordAccessAudit } from '@/lib/server/audit'
import { approveCaseDecisionInSession, recordCaseDecisionInSession } from '@/lib/server/case-review-service'
import { levelAfter, MODULE_TABLES } from '@/lib/server/database-level'
import { loadRecordedDecisions } from '@/lib/server/recorded-decisions'
import { csvReportResponse } from '@/lib/server/report-response'
import { INHERITED_SOURCE, loadViewerContext, type ViewerContext } from '@/lib/server/viewer-context'
import { getDebtorDetailDataFromService } from '@/lib/services/debtor-data-service'
import { createPaginatedSupabase } from '@/tests/fixtures/paginated-supabase'
import { portfolioTables, reviewTables } from '@/tests/fixtures/reports-portfolio'
import type { RawRow } from '@/types/equitas-domain'

// Noche 7 (encargo 10.2 y 10.6). Sesión contra una base donde faltan las tablas que se indiquen: para esas
// la Data API responde lo mismo que la original (404 PGRST205); el resto lo sirve la cartera sintética.
const identity = (role: string) => ({
  user: [{ id: 42, auth_user: 'auth-test', status: 'ACTIVE', full_name: 'Persona sintética' }],
  tenant_user: [{ id: 1, user: 42, tenant: 7, role: 3, status: true }],
  tenant: [{ id: 7, status: 'ACTIVE', name: 'Municipio sintético' }], role: [{ id: 3, name: role }],
})

function session({ missing = MODULE_TABLES as readonly string[], role = 'ADMIN', tables = {} as Record<string, RawRow[]> } = {}) {
  const inner = createPaginatedSupabase({ ...identity(role), ...portfolioTables(), ...reviewTables(), access_audit: [], ...tables }, { enforceFilters: true })
  const forward = (inner.client as unknown as { rest: { fetch: typeof fetch } }).rest.fetch
  const probes: string[] = []
  const client = createClient('https://base-level.example.test', 'synthetic-publishable-key', {
    global: {
      fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        const table = url.pathname.split('/').at(-1)!
        if (!missing.includes(table)) return forward(input, init)
        probes.push(`${table}?limit=${url.searchParams.get('limit')}`)
        return new Response(JSON.stringify({ code: 'PGRST205', details: null, hint: null, message: `Could not find the table 'public.${table}' in the schema cache` }),
          { status: 404, headers: { 'Content-Type': 'application/json' } })
      },
    },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  vi.spyOn(client.auth, 'getUser').mockResolvedValue({ data: { user: { id: 'auth-test' } }, error: null } as never)
  serverClient.mockResolvedValue(client)
  return { requests: inner.requests, probes }
}

const context = { appUserId: '42', tenantId: '7' }
let logged: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.resetAllMocks()
  cookieStore.mockResolvedValue({ get: () => undefined })
  logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => { vi.restoreAllMocks() })

describe('nivel base: la base no tiene el módulo de decisiones, cargas y registro de accesos', () => {
  it('la comprobación completa solo se dispara cuando una lectura normal dijo «la tabla no está en el esquema»', async () => {
    const { probes, requests } = session()
    await expect(levelAfter(null)).resolves.toBe('CON_MODULO')
    await expect(levelAfter({ code: '42501' })).resolves.toBe('CON_MODULO')
    await expect(levelAfter({})).resolves.toBe('CON_MODULO')
    expect(probes).toEqual([])
    expect(requests).toEqual([])
    await expect(levelAfter({ code: 'PGRST205' })).resolves.toBe('BASE')
    expect(probes.sort()).toEqual(MODULE_TABLES.map(table => `${table}?limit=0`).sort())
  })

  it('quien mira: sin fecha de cartera registrada, se usa la de hoy y ninguna función nueva está disponible, ni para ADMIN', async () => {
    session()
    const viewer = await loadViewerContext()
    expect(viewer?.portfolio).toEqual({ kind: 'UNDATED', today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
    expect(viewer?.roleName).toBe('ADMIN')
    expect(viewer?.capabilities).toEqual({ canImport: false, canRecordDecision: false, canApprove: false, canSeeSupervision: false, canSeeAudit: false })
    expect(moduleAvailable(viewer!)).toBe(false)
    expect(portfolioLabel(viewer!)).toMatch(/^Sin fecha de cartera registrada: se calcula con la fecha de hoy \(\d{1,2}\/\d{1,2}\/\d{4}\)$/)
    expect(undatedPortfolioText('10/11/2026')).toBe('Sin fecha de cartera registrada: se calcula con la fecha de hoy (10/11/2026)')
    expect(logged).not.toHaveBeenCalled()
  })

  it('con el módulo presente nada cambia: fecha del lote, permisos del rol y ninguna consulta de más', async () => {
    const { probes } = session({ missing: [] })
    const viewer = await loadViewerContext()
    expect(viewer?.portfolio).toEqual({ kind: 'LOADED', asOf: '2026-10-15' })
    expect(viewer?.capabilities.canImport).toBe(true)
    expect(moduleAvailable(viewer!)).toBe(true)
    expect(portfolioLabel(viewer!)).toBe('Cartera al 15/10/2026')
    expect(probes).toEqual([])
  })

  it('una cartera heredada muestra su fecha como declarada; si una carga posterior la reemplaza, deja de serlo', async () => {
    const inherited = { id: 1, tenant: 7, as_of: '2026-09-30', source: INHERITED_SOURCE, source_updated_at: null, status: 'PUBLICADO', supersedes: null }
    session({ missing: [], tables: { import_batch: [inherited] } })
    const viewer = await loadViewerContext()
    expect(viewer?.portfolio).toEqual({ kind: 'LOADED', asOf: '2026-09-30', declared: true })
    expect(portfolioLabel(viewer!)).toBe('Cartera al 30/9/2026 (fecha declarada)')

    session({ missing: [], tables: { import_batch: [inherited, { id: 2, tenant: 7, as_of: '2026-10-31', source: 'WEB_UPLOAD', source_updated_at: null, status: 'PUBLICADO', supersedes: null }] } })
    expect((await loadViewerContext())?.portfolio).toEqual({ kind: 'LOADED', asOf: '2026-10-31' })
  })

  it('la cartera se lee sin lote y sin aviso de lectura fallida: los cálculos usan la fecha del día', async () => {
    const { requests } = session()
    const raw = await loadRawDebtorData()
    expect(raw.batch).toBeUndefined()
    expect(raw.warnings).toEqual([])
    expect(raw.debtors.length).toBe(10)
    expect(requests.some(request => request.table === 'import_batch')).toBe(false)
    const mapped = mapDebtorObjectsFromRawData(raw)
    expect(new Set(mapped.debtors.map(debtor => debtor.decisionAsOfSource))).toEqual(new Set(['FECHA_CALCULO']))
  })

  it('si falta solo una parte del módulo NO es nivel base: la fecha queda no disponible y se deja un código en el registro', async () => {
    session({ missing: ['import_batch'] })
    const raw = await loadRawDebtorData()
    expect(raw.warnings.some(warning => warning.table === 'import_batch')).toBe(true)
    expect((await loadViewerContext())?.portfolio).toEqual({ kind: 'UNAVAILABLE' })
    expect(logged).toHaveBeenCalledWith('Nivel de base incierto: NIVEL_INDETERMINADO')
  })

  it('abrir un caso no deja registro en nivel base y no necesita la credencial de servidor', async () => {
    session()
    createWriter.mockReturnValue(null)
    await expect(recordAccessAudit(context, { action: 'CASE_OPEN', target: '101' })).resolves.toBeUndefined()
    expect(logged).not.toHaveBeenCalled()
  })

  it.each(['REPORT_EXPORT', 'ANALYTICS_VIEW'] as const)('una acción que no es abrir un caso (%s) sigue fallando cerrada en nivel base', async action => {
    session()
    createWriter.mockReturnValue(null)
    await expect(recordAccessAudit(context, { action, target: 'cola-de-trabajo' })).rejects.toBeInstanceOf(AccessAuditError)
  })

  it.each([
    ['falta una sola tabla', ['access_audit']],
    ['faltan tres de las cuatro', ['import_batch', 'case_review', 'access_audit']],
    ['no falta ninguna', []],
  ])('con el módulo presente la apertura de un caso sigue fallando cerrada si no se puede registrar: %s', async (_, missing) => {
    session({ missing })
    createWriter.mockReturnValue(null)
    await expect(recordAccessAudit(context, { action: 'CASE_OPEN', target: '101' })).rejects.toBeInstanceOf(AccessAuditError)
    const rpc = vi.fn(async () => ({ data: null, error: { code: 'PGRST202', message: 'function not found' } }))
    createWriter.mockReturnValue({ rpc })
    await expect(recordAccessAudit(context, { action: 'CASE_OPEN', target: '101' })).rejects.toBeInstanceOf(AccessAuditError)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('en nivel base el registro se intenta igual si hay credencial: nunca se omite uno que se podía escribir', async () => {
    session()
    const rpc = vi.fn(async () => ({ data: { audit_id: 9, created: true }, error: null }))
    createWriter.mockReturnValue({ rpc })
    await recordAccessAudit(context, { action: 'CASE_OPEN', target: '101' })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('las decisiones registradas no son una lectura fallida: no hay módulo', async () => {
    session()
    await expect(loadRecordedDecisions()).resolves.toEqual({ ok: false, reason: 'NO_MODULE' })
    session({ missing: ['case_review'] })
    await expect(loadRecordedDecisions()).resolves.toEqual({ ok: false, reason: 'UNAVAILABLE' })
  })

  it.each(['GET', 'HEAD'])('los reportes responden «no disponible en esta base» (%s), sin armar el archivo ni registrar nada', async method => {
    session()
    const rpc = vi.fn()
    createWriter.mockReturnValue({ rpc })
    const build = vi.fn(async () => 'a;b\n')
    const response = await csvReportResponse(new Request('http://127.0.0.1/api/reports/queue', { method }), 'cola-de-trabajo', 'portfolio:read', build)
    expect(response.status).toBe(501)
    expect(response.headers.get('content-disposition')).toBeNull()
    expect(await response.json()).toEqual({ error: 'NO_DISPONIBLE_EN_ESTA_BASE', mensaje: MODULE_MISSING_EXPLANATION })
    expect(build).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('un reporte restringido sigue respondiendo por el rol antes que por la base', async () => {
    session({ role: 'USER' })
    const response = await csvReportResponse(new Request('http://127.0.0.1/api/reports/access'), 'accesos', 'audit:read', async () => '')
    expect(response.status).toBe(403)
  })

  it('registrar y aprobar se rechazan en el servidor con su nombre, sin llamar a ninguna función de escritura', async () => {
    session()
    const rpc = vi.fn()
    createWriter.mockReturnValue({ rpc })
    const decision = await recordCaseDecisionInSession({ debtorId: '101', decision: 'ACEPTA', expected: { asOf: '2026-10-15', rulesVersion: '1.1.0', inputsHash: 'a'.repeat(64) } })
    expect(decision).toMatchObject({ ok: false, code: 'MODULE_NOT_AVAILABLE', message: expect.stringContaining('No disponible en esta base') })
    const approval = await approveCaseDecisionInSession({ caseReviewId: '1', decision: 'OBJETA', reasonCode: 'CRITERIO_DEL_SERVICIO' })
    expect(approval).toMatchObject({ ok: false, code: 'MODULE_NOT_AVAILABLE' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('con el módulo presente una falla de lectura conserva su mensaje: no se disfraza de «no disponible en esta base»', async () => {
    session({ missing: ['import_batch'] })
    createWriter.mockReturnValue({ rpc: vi.fn() })
    const decision = await recordCaseDecisionInSession({ debtorId: '101', decision: 'ACEPTA', expected: { asOf: '2026-10-15', rulesVersion: '1.1.0', inputsHash: 'a'.repeat(64) } })
    expect(decision.ok).toBe(false)
    expect((decision as { code: string }).code).not.toBe('MODULE_NOT_AVAILABLE')
  })

  it('las pantallas lo dicen como un estado, no como un error', () => {
    const card = renderToStaticMarkup(createElement(ModuleUnavailableCard, { what: 'Reportes' }))
    expect(card).toContain('data-portfolio-state="module-unavailable"')
    expect(card).toContain('role="status"')
    expect(card).toContain('Reportes: no disponible en esta base')
    expect(card).toContain('La cartera se puede ver, buscar y analizar.')
    const noModule = { ok: false as const, reason: 'NO_MODULE' as const }
    // Listados: «sin decisión» (no puede haber ninguna) y una sola nota; nunca «No disponible» en cada fila.
    expect(decisionView(noModule, '101')).toEqual({ kind: 'NONE' })
    expect(renderToStaticMarkup(createElement(DecisionsNotice, { decisions: noModule }))).toContain('no tiene instalado el módulo de decisiones')
    expect(recordedDecisionView(noModule, '101')).toEqual({ kind: 'no-module' })
    expect(renderToStaticMarkup(createElement(RecordedDecisionSummary, { view: { kind: 'no-module' } }))).toContain('No disponible en esta base')
    const viewer = { portfolio: { kind: 'UNDATED', today: '2026-11-10' } } as ViewerContext
    expect(portfolioLabel(viewer)).toBe('Sin fecha de cartera registrada: se calcula con la fecha de hoy (10/11/2026)')
  })
})

// La cartera sintética compartida no detalla a qué caso corresponde cada vínculo de persona (le alcanza con el
// municipio). Para probar la lectura por caso se le da a cada persona y a cada contacto sus vínculos reales,
// que es lo que la Data API devuelve al embeber `debtor_person`.
function tablesWithRealLinks(): Record<string, RawRow[]> {
  const tables = portfolioTables()
  const tenantOf = new Map(tables.debtor.map(debtor => [debtor.id, debtor.tenant]))
  const linksOf = (person: unknown) => tables.debtor_person.filter(link => link.person === person)
    .map(link => ({ active: link.active, debtor: link.debtor, __debtor: { tenant: tenantOf.get(link.debtor) } }))
  return {
    person: tables.person.map(person => ({ ...person, __links: linksOf(person.id) })),
    debtor_contact: tables.debtor_contact.map(contact => ({ ...contact, __person: { __links: linksOf(contact.person) } })),
    debtor_profile: tables.debtor.filter(debtor => debtor.tenant === 7 && Number(debtor.id) % 2 === 1)
      .map(debtor => ({ id: 9000 + Number(debtor.id), debtor: debtor.id, total_debt_amount: '10.00', overdue_debt_amount: '5.00', profile_generated_at: '2026-10-15T00:00:00Z', __scope: { tenant: 7 } })),
  }
}

describe('la ficha lee solo los datos de su caso (encargo 10.6)', () => {
  const TENANT_DEBTORS = ['101', '102', '103', '104', '105', '106', '107', '108', '109', '110']
  // La decisión lleva el instante en que se calculó: es lo único que cambia entre dos lecturas del mismo caso.
  const stable = <T,>(value: T): T => JSON.parse(JSON.stringify(value).replace(/decisión calculada el [0-9T:.Z-]+/g, 'decisión calculada el INSTANTE')
    .replace(/"(decisionComputedAt|calculado_en)":"[^"]*"/g, '"$1":"INSTANTE"'))

  it('da exactamente el mismo caso que la lectura de toda la cartera, para cada caso del municipio', async () => {
    session({ missing: [], tables: tablesWithRealLinks() })
    const full = mapDebtorObjectsFromRawData(await loadRawDebtorData())
    for (const debtorId of TENANT_DEBTORS) {
      const { detail, warnings } = await getDebtorDetailDataFromService(debtorId)
      expect(warnings).toEqual(full.warnings)
      expect(detail, debtorId).not.toBeNull()
      expect(stable(detail?.debtor), debtorId).toEqual(stable(full.debtors.find(debtor => debtor.id === debtorId)))
      expect(detail?.debts, debtorId).toEqual(full.debtsByDebtor.get(debtorId) ?? [])
      expect(detail?.people.map(person => person.id), debtorId).toEqual((full.peopleByDebtor.get(debtorId) ?? []).map(person => person.id))
      expect(detail?.contacts.map(contact => contact.id), debtorId).toEqual((full.contactsByDebtor.get(debtorId) ?? []).map(contact => contact.id))
    }
  })

  it('pide obligaciones, personas, contactos y perfil filtrados por ese caso, no los de todo el municipio', async () => {
    const { requests } = session({ missing: [], tables: tablesWithRealLinks() })
    await getDebtorDetailDataFromService('101')
    const byTable = (table: string) => requests.filter(request => request.table === table)
    expect(byTable('debtor').every(request => request.filters.tenant === 'eq.7' && !('id' in request.filters))).toBe(true)
    for (const [table, column] of [['debt', 'debtor'], ['debtor_person', 'debtor'], ['debtor_profile', 'debtor'], ['person', '__links.debtor'], ['debtor_contact', '__person.__links.debtor']]) {
      expect(byTable(table).length, table).toBeGreaterThan(0)
      expect(byTable(table).every(request => request.filters[column] === 'eq.101'), table).toBe(true)
    }
  })

  it.each([
    ['un caso de otro municipio', '801'],
    ['un identificador que no existe', '999999'],
    ['un texto que no es un identificador', '101&select=*'],
    ['un intento de filtro', 'eq.101'],
  ])('%s no se encuentra y su texto nunca llega a una consulta', async (_, debtorId) => {
    const { requests } = session({ missing: [] })
    const { detail } = await getDebtorDetailDataFromService(debtorId)
    expect(detail).toBeNull()
    const portfolioReads = new Set(requests.map(request => request.table).filter(table => !['user', 'tenant_user', 'tenant', 'role', 'import_batch', 'contact_type'].includes(table)))
    expect([...portfolioReads]).toEqual(['debtor'])
    expect(JSON.stringify(requests)).not.toContain(debtorId)
  })

  it('una lectura fallida de los casos no se presenta como «el caso no existe»', async () => {
    session({ missing: ['debtor'] })
    const { detail, warnings } = await getDebtorDetailDataFromService('101')
    expect(detail).toBeNull()
    expect(warnings.some(warning => warning.table === 'debtor')).toBe(true)
  })
})
