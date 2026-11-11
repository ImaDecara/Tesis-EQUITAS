import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { serverClient, cookieStore, auditRpc } = vi.hoisted(() => ({ serverClient: vi.fn(), cookieStore: vi.fn(), auditRpc: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient: serverClient }))
vi.mock('@/lib/supabase-config', () => ({ hasSupabaseCredentials: true }))
vi.mock('next/headers', () => ({ cookies: cookieStore }))
// ALIGN-069: la auditoria tiene sus propias pruebas (access-audit.integration.test.ts).
vi.mock('@/lib/server/case-review-writer', () => ({ createCaseReviewWriter: () => ({ rpc: auditRpc }) }))

import { GET as getAccess } from '@/app/api/reports/access/route'
import { GET as getDataQuality } from '@/app/api/reports/data-quality/route'
import { GET as getDecisions } from '@/app/api/reports/decisions/route'
import { GET as getQueue } from '@/app/api/reports/queue/route'
import { GET as getSupervision } from '@/app/api/reports/supervision/route'
import DebtAgingPage from '@/app/debt-aging/page'
import NoContactPage from '@/app/no-contact/page'
import PriorityCasesPage from '@/app/priority-cases/page'
import { buildRecommendationSummary } from '@/lib/equitas-view-selectors'
import { getDashboardData, getDebtorsData } from '@/lib/equitas-data'
import { INTERVENTION_CODES } from '@/lib/services/debtor-recommendation-generator'
import { formatCurrency } from '@/lib/utils'
import { createPaginatedSupabase } from '@/tests/fixtures/paginated-supabase'
import {
  FOREIGN_MARKER, FREE_TEXT_MARKER, HOSTILE_IDENTIFIERS, OTHER_CUTOFF, PERSONAL_MARKERS, PORTFOLIO_AS_OF, portfolioTables,
  REVIEW_CUTOFF, REVIEWER_MARKER, reviewTables,
} from '@/tests/fixtures/reports-portfolio'
import { csvCents, csvNumber, parseCsvBytes, sumCents } from '@/tests/helpers/independent-csv-parser'
import { textFromReactTree } from '@/tests/helpers/react-tree'
import type { RawRow } from '@/types/equitas-domain'

const NOW = '2026-11-02T12:34:56.000Z'
const appUser = { id: 42, auth_user: 'auth-test', status: 'ACTIVE' }
const membership = { id: 1, user: 42, tenant: 7, role: 3, status: true }

type Handler = (request: Request) => Promise<Response> | Response
const REPORTS: [string, Handler][] = [
  ['queue', getQueue], ['decisions', getDecisions], ['supervision', getSupervision], ['data-quality', getDataQuality],
]
// El reporte de accesos tiene su propia campaña (access-audit.integration.test.ts); aca solo lo nuevo de la noche 7.
const ALL_REPORTS: [string, Handler][] = [...REPORTS, ['access', getAccess]]
const IDENTITY = ['user', 'tenant_user', 'tenant', 'role']

function client(tables: Record<string, RawRow[]> = {}, options: Parameters<typeof createPaginatedSupabase>[1] = {}, role = 'ADMIN', signedIn = true) {
  const fixture = createPaginatedSupabase({
    user: [appUser], tenant_user: [membership], tenant: [{ id: 7, status: 'ACTIVE' }], role: [{ id: 3, name: role }],
    ...portfolioTables(), ...reviewTables(), ...tables,
  }, { enforceFilters: true, ...options })
  vi.spyOn(fixture.client.auth, 'getUser').mockResolvedValue(signedIn
    ? { data: { user: { id: 'auth-test' } }, error: null } as never
    : { data: { user: null }, error: null } as never)
  serverClient.mockResolvedValue(fixture.client)
  return fixture
}

const request = (name: string, query = '') => new Request(`http://127.0.0.1/api/reports/${name}${query}`)
const handler = (name: string) => ALL_REPORTS.find(([report]) => report === name)![1]

async function download(name: string, query = '') {
  const response = await handler(name)(request(name, query))
  expect(response.status, `${name}${query}`).toBe(200)
  const bytes = new Uint8Array(await response.arrayBuffer())
  return { response, bytes, text: new TextDecoder().decode(bytes), file: parseCsvBytes(bytes) }
}

const details = (rows: Record<string, string>[]) => rows.filter(row => row.tipo_fila === 'DETALLE')
const totalRow = (rows: Record<string, string>[]) => {
  const totals = rows.filter(row => row.tipo_fila === 'TOTAL')
  expect(totals).toHaveLength(1)
  return totals[0]
}
const aggregated = (rows: Record<string, string>[], indicador: string, categoria = 'TOTAL') => {
  const found = rows.filter(row => row.indicador === indicador && row.categoria === categoria)
  expect(found, `${indicador}/${categoria}`).toHaveLength(1)
  return found[0]
}
// Las tarjetas guardan la cifra en una prop: no aparece en el texto del arbol.
function cardValues(node: ReactNode): Record<string, unknown> {
  if (Array.isArray(node)) return Object.assign({}, ...node.map(cardValues))
  if (!isValidElement<{ label?: string; value?: unknown; children?: ReactNode }>(node)) return {}
  return { ...(node.props.label ? { [node.props.label]: node.props.value } : {}), ...cardValues(node.props.children) }
}

// Texto del contador de la pantalla (`data-total`): «N casos» o «No disponible».
function selectionTotal(node: ReactNode): string | null {
  if (Array.isArray(node)) return node.map(selectionTotal).find(value => value !== null) ?? null
  if (!isValidElement<{ 'data-total'?: unknown; children?: ReactNode }>(node)) return null
  if ('data-total' in node.props) return textFromReactTree(node.props.children).replace(/\s+/g, ' ').trim()
  return selectionTotal(node.props.children)
}

// Lee los enlaces de las filas renderizadas, sin reutilizar el selector de la aplicación.
function queueObjectIds(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(queueObjectIds)
  if (!isValidElement<{ href?: string; children?: ReactNode }>(node)) return []
  const href = typeof node.props.href === 'string' ? new URL(node.props.href, 'http://test.local') : null
  const match = href?.searchParams.get('tab') === 'revision' && /^\/debtors\/([^/]+)$/.exec(href.pathname)
  return match ? [decodeURIComponent(match[1])] : queueObjectIds(node.props.children)
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(NOW) })
  cookieStore.mockResolvedValue({ get: () => undefined })
  auditRpc.mockResolvedValue({ data: { audit_id: 1, created: true }, error: null })
})
afterEach(() => { vi.useRealTimers() })

describe('ALIGN-028: autorizacion en cada Route Handler', () => {
  it.each(REPORTS)('%s sin sesion: 401, sin archivo y sin leer datos', async (name, get) => {
    const { requests } = client({}, {}, 'ADMIN', false)
    const response = await get(request(name))
    expect(response.status).toBe(401)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ error: 'AUTH_REQUIRED' })
    expect(requests).toEqual([])
  })

  // Noche 7 (encargo §4.2): cola, calidad y decisiones para todo miembro activo (ADMIN y USER);
  // supervision solo ADMIN. Los nombres anteriores y cualquier rol no reconocido no ingresan.
  // tp_operator es compatibilidad de solo lectura de la cartera (ADR-001 §9).
  const ALLOWED: Record<string, string[]> = {
    ADMIN: ['queue', 'decisions', 'supervision', 'data-quality'],
    USER: ['queue', 'decisions', 'data-quality'],
    tp_operator: ['queue', 'data-quality'],
    consulta: [],
    operador: [],
    supervisor: [],
    importador: [],
    importador_sistema: [],
    admin: [],
  }
  it.each(Object.entries(ALLOWED).flatMap(([role, allowed]) =>
    REPORTS.map(([name]) => [role, name, allowed.includes(name)] as const)))('%s / %s: permitido=%s', async (role, name, allowed) => {
    const { requests } = client({}, {}, role)
    const response = await handler(name)(request(name))
    if (allowed) {
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    } else {
      expect(response.status).toBe(403)
      expect(response.headers.get('content-type')).toContain('application/json')
      expect(await response.text()).not.toMatch(/OBJ-|ACEPTA/)
      expect(requests.every(item => IDENTITY.includes(item.table))).toBe(true)
    }
  })

  it.each(REPORTS)('%s con cookie de otro municipio: 403, sin datos de ninguno', async (name, get) => {
    cookieStore.mockResolvedValue({ get: () => ({ value: '8' }) })
    const { requests } = client()
    const response = await get(request(name))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'TENANT_ACCESS_NOT_FOUND' })
    expect(requests.every(item => IDENTITY.includes(item.table))).toBe(true)
  })

  it.each([
    ['sin usuario de aplicacion', { user: [] }, 403, 'APP_USER_NOT_FOUND'],
    ['usuario inactivo', { user: [{ ...appUser, status: 'INACTIVE' }] }, 403, 'APP_USER_INACTIVE'],
    ['sin membresia', { tenant_user: [] }, 403, 'TENANT_ACCESS_NOT_FOUND'],
    ['membresia inactiva', { tenant_user: [{ ...membership, status: false }] }, 403, 'TENANT_ACCESS_INACTIVE'],
    ['municipio inactivo', { tenant: [{ id: 7, status: 'INACTIVE' }] }, 403, 'TENANT_INACTIVE'],
    ['dos membresias sin eleccion', { tenant_user: [membership, { ...membership, id: 2, tenant: 8 }] }, 409, 'TENANT_SELECTION_REQUIRED'],
  ])('%s: rechazo explicito en los cuatro', async (_name, tables, status, code) => {
    for (const [name, get] of REPORTS) {
      const { requests } = client(tables as never)
      const response = await get(request(name))
      expect(response.status, name).toBe(status)
      expect(await response.json()).toEqual({ error: code })
      expect(requests.every(item => IDENTITY.includes(item.table))).toBe(true)
    }
  })

  it('Auth caido y Supabase sin configurar responden 503, nunca un archivo vacio', async () => {
    const { client: auth } = client()
    vi.mocked(auth.auth.getUser).mockRejectedValue(new Error('detalle interno sintetico'))
    for (const [name, get] of REPORTS) {
      const response = await get(request(name))
      expect(response.status).toBe(503)
      expect(await response.text()).not.toContain('detalle interno')
    }
    serverClient.mockResolvedValue(null)
    for (const [name, get] of REPORTS) expect((await get(request(name))).status).toBe(503)
  })

  it.each(REPORTS)('%s no acepta el municipio por parametro', async (name, get) => {
    const { requests } = client()
    for (const query of ['?tenant=8', '?tenantId=8', '?tenant_id=8']) {
      const response = await get(request(name, query))
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: 'FILTRO_INVALIDO' })
    }
    expect(requests.flatMap(item => Object.values(item.filters))).not.toContain('eq.8')
  })

  it('un filtro invalido se valida despues de autorizar: sin sesion no se sabe si era valido', async () => {
    client({}, {}, 'ADMIN', false)
    expect((await getQueue(request('queue', '?risk=XYZ'))).status).toBe(401)
    client({}, {}, 'importador')
    expect((await getQueue(request('queue', '?risk=XYZ'))).status).toBe(403)
  })
})

describe('ALIGN-028: aislamiento entre municipios', () => {
  it.each(REPORTS)('%s no contiene filas del otro municipio', async name => {
    const { requests } = client()
    const { text } = await download(name)
    expect(text).not.toContain(FOREIGN_MARKER)
    expect(text).not.toContain('123456789')
    expect(requests.some(item => Object.values(item.filters).includes('eq.8'))).toBe(false)
  })

  it('cada pagina de revisiones lleva el filtro del municipio autorizado, con limite de filas del servidor', async () => {
    const { requests } = client({}, { serverMaxRows: 2 })
    const { file } = await download('decisions')
    expect(details(file.rows).map(row => row.decision_id)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    for (const table of ['case_review', 'case_review_approval']) {
      const calls = requests.filter(item => item.table === table && item.limit !== 0)
      expect(calls.length).toBeGreaterThan(1)
      expect(calls.every(item => item.filters.tenant === 'eq.7')).toBe(true)
    }
  })
})

describe('ALIGN-028: una lectura fallida no sale como 0 ni como archivo vacio', () => {
  const READS: [string, string[]][] = [
    ['queue', ['debtor', 'debtor_type', 'debt', 'debt_status', 'debtor_person', 'person', 'debtor_contact', 'debtor_profile']],
    ['data-quality', ['debtor', 'debtor_type', 'debt', 'debt_status', 'debtor_person', 'person', 'debtor_contact', 'debtor_profile']],
    // Noche 7: sin los casos o el lote no se puede afirmar la fecha de la cartera ni el identificador del caso.
    ['decisions', ['case_review', 'case_review_approval', 'debtor', 'import_batch']],
    ['supervision', ['case_review', 'case_review_approval', 'debtor', 'import_batch']],
  ]
  it.each(READS.flatMap(([name, tables]) => tables.map(table => [name, table] as const)))('%s con %s caida: 503 y sin CSV', async (name, table) => {
    client({}, { fail: item => item.table === table ? { code: '42501', message: 'detalle interno sintetico' } : null })
    const response = await handler(name)(request(name))
    expect(response.status).toBe(503)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('content-disposition')).toBeNull()
    const body = await response.text()
    expect(JSON.parse(body)).toEqual(['case_review', 'case_review_approval', 'import_batch'].includes(table)
      ? { error: 'BASE_NO_VERIFICADA' } : { error: 'LECTURA_FALLIDA', tablas: [table] })
    expect(body).not.toContain('detalle interno')
  })

  it('una falla en la segunda pagina tampoco deja un archivo parcial', async () => {
    client({}, { serverMaxRows: 2, fail: item => item.table === 'debt' && (item.after !== null || item.offset > 0) ? { message: 'corte' } : null })
    expect((await getQueue(request('queue'))).status).toBe(503)
  })

  it('una tabla de revision inexistente, como en testing y el original, responde 503', async () => {
    client({}, { fail: item => item.table === 'case_review' ? { code: '42P01', message: 'relation does not exist' } : null })
    expect((await getSupervision(request('supervision'))).status).toBe(503)
  })
})

describe('ALIGN-028: formato y metadatos', () => {
  it.each(REPORTS)('%s: BOM, separador, CRLF, cabeceras y metadatos en cada fila', async name => {
    client()
    const { response, file } = await download(name)
    expect(file).toMatchObject({ hasBom: true, separator: ';', usesCrLf: true })
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="equitas-[a-z-]+\.csv"$/)
    expect(file.header.slice(0, 8)).toEqual(['fecha_cartera', 'version_reglas_vigente', 'fecha_corte', 'version_reglas', 'filtros', 'generado_en', 'definiciones', 'tipo_fila'])
    expect(file.rows.length).toBeGreaterThan(0)
    for (const row of file.rows) {
      for (const column of ['fecha_cartera', 'version_reglas_vigente', 'fecha_corte', 'version_reglas', 'filtros', 'generado_en', 'definiciones']) expect(row[column], column).toBeTruthy()
      // Constantes en todo archivo: la cartera y las reglas vigentes, las del tablero.
      expect(row.fecha_cartera).toBe(PORTFOLIO_AS_OF)
      expect(row.version_reglas_vigente).toBe('1.1.0')
      expect(row.generado_en).toBe(NOW)
      expect(row.definiciones).toMatch(/^docs\/tesis\/catalogo-indicadores-v1\.md#reporte-[a-z-]+$/)
    }
  })

  it.each(REPORTS)('%s: ninguna celda queda vacia', async name => {
    client()
    const { file } = await download(name)
    for (const row of file.rows) for (const [column, cell] of Object.entries(row)) expect(cell.trim(), column).not.toBe('')
  })

  it('cartera: sin manifiesto el corte es NO_INTEGRADO y la fecha del reloj va rotulada aparte', async () => {
    client({ import_batch: [] })
    const { file } = await download('queue')
    for (const row of file.rows) {
      expect(row.fecha_corte).toBe('NO_INTEGRADO')
      // Versión activa de las reglas (la del cálculo de la cola), no la de una decisión guardada.
      expect(row.version_reglas).toBe('1.1.0')
    }
    expect(details(file.rows)[0].fecha_calculo_usada).toBe('2026-11-02')
    const quality = await download('data-quality')
    expect(quality.file.rows.every(row => row.fecha_corte === 'NO_INTEGRADO' && row.fecha_cartera === 'NO_INTEGRADO')).toBe(true)
  })

  // Noche 7: el lector de cartera usa el lote publicado. Las dos expectativas NO_INTEGRADO de la campaña
  // de reportes (anteriores a esa integración) pasan a ser esta.
  it.each(REPORTS)('%s: con lote publicado, fecha_cartera es su fecha en todas las filas', async name => {
    client()
    const { file } = await download(name)
    expect(file.rows.every(row => row.fecha_cartera === PORTFOLIO_AS_OF && row.version_reglas_vigente === '1.1.0')).toBe(true)
    if (name === 'queue') expect(file.rows.every(row => row.fecha_corte === PORTFOLIO_AS_OF && row.fecha_calculo_usada === 'NO_APLICA')).toBe(true)
  })

  it('decisiones: fecha_corte y version_reglas salen de la fila, no del reloj', async () => {
    client()
    const first = await download('decisions')
    vi.setSystemTime(new Date('2031-05-05T00:00:00.000Z'))
    const later = await download('decisions')
    const cutoffs = (rows: Record<string, string>[]) => details(rows).map(row => row.fecha_corte)
    expect(cutoffs(first.file.rows)).toEqual(cutoffs(later.file.rows))
    expect(cutoffs(first.file.rows)).toContain(REVIEW_CUTOFF)
    expect(cutoffs(first.file.rows)).toContain(OTHER_CUTOFF)
    expect(details(later.file.rows).find(row => row.decision_id === '7')?.version_reglas).toBe('1.1.0')
    expect(later.file.rows[0].generado_en).toBe('2031-05-05T00:00:00.000Z')
  })

  it('un total mezcla cortes y versiones y lo declara como intervalo', async () => {
    client()
    const { file } = await download('decisions')
    expect(totalRow(file.rows)).toMatchObject({ fecha_corte: `${REVIEW_CUTOFF}/${OTHER_CUTOFF}`, version_reglas: '1.0.0|1.1.0' })
    const supervision = await download('supervision')
    expect(supervision.file.rows.every(row => row.fecha_corte === `${REVIEW_CUTOFF}/${OTHER_CUTOFF}`)).toBe(true)
  })

  it('filtros: forma canonica; un filtro de texto libre no copia lo que se busco', async () => {
    client()
    // Noche 7: con risk=ALTO esta seleccion queda vacia con casos sin puntaje (422, ver H16): se usa BAJO.
    const { file, text } = await download('queue', '?risk=BAJO&contact=with&minAmount=10&q=Persona%20Sintetica%20Uno&page=2&pageSize=20')
    expect(file.rows[0].filtros).toBe('contact=with|minAmount=10|q=TEXTO_OMITIDO|risk=BAJO')
    expect(text).not.toContain('Persona Sintetica')
    expect((await download('queue')).file.rows[0].filtros).toBe('SIN_FILTROS')
    expect((await download('queue', '?type=AGUA')).file.rows[0].filtros).toBe('type=AGUA')
    expect((await download('decisions', '?decision=ACEPTA&corte=2026-09-30')).file.rows[0].filtros).toBe('corte=2026-09-30|decision=ACEPTA')
  })

  it('un tipo con separador o formula queda entrecomillado y sin ejecutar', async () => {
    client()
    const { file } = await download('queue', `?type=${encodeURIComponent('INMUEBLE; "tasa"')}`)
    expect(file.rows[0].filtros).toBe('type=INMUEBLE; "tasa"')
    expect(details(file.rows).map(row => row.objeto_id)).toEqual(['102'])
    expect(details(file.rows)[0].tipo).toBe('INMUEBLE; "tasa"')
  })
})

describe('ALIGN-028: una falla inesperada', () => {
  it('un importe irrepresentable se declara INVALIDO sin perder las filas legibles', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // Reglas 1.1.0: el total registrado sale de las obligaciones (no del perfil): el importe irrepresentable va en una.
    const tables = portfolioTables()
    tables.debt[0].current_amount = 1e21
    client({ debt: tables.debt, debtor_profile: [{ id: 1, debtor: 101, total_debt_amount: 1e21, __scope: { tenant: 7 } }] })
    const response = await getQueue(request('queue'))
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toContain('INVALIDO')
    expect(body).not.toContain('1e+21')
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })
})

describe('ALIGN-028: filtros invalidos no parecen un archivo vacio correcto', () => {
  it.each([
    ['queue', '?risk=XYZ'], ['queue', '?contact=otro'], ['queue', '?minAmount=abc'], ['queue', '?nada=1'],
    ['queue', '?risk=ALTO&risk=BAJO'], ['queue', `?q=${'x'.repeat(201)}`],
    ['decisions', '?desde=2026-02-31'], ['decisions', '?desde=ayer'], ['decisions', '?desde=2026-10-02&hasta=2026-10-01'],
    ['decisions', '?decision=OTRA'], ['decisions', '?vigente=quizas'], ['decisions', '?corte=2026-13-01'],
    ['supervision', '?decision=ACEPTA'], ['supervision', '?desde=x'],
    ['data-quality', '?type=AGUA'],
  ])('%s%s: 400 sin archivo', async (name, query) => {
    client()
    const response = await handler(name)(request(name, query))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('FILTRO_INVALIDO')
    expect(response.headers.get('content-disposition')).toBeNull()
  })
})

describe('ALIGN-028: minimizacion', () => {
  it.each(REPORTS)('%s no lleva personas, contactos, documentos, domicilio ni descripcion, tampoco para USER', async name => {
    client({}, {}, name === 'supervision' ? 'ADMIN' : 'USER')
    const { text } = await download(name)
    for (const marker of PERSONAL_MARKERS) expect(text, marker).not.toContain(marker)
  })

  it('una busqueda por persona filtra la cola sin escribir su nombre', async () => {
    client()
    const { text, file } = await download('queue', '?q=Persona%20Sintetica%20Dos')
    expect(details(file.rows).map(row => row.objeto_id)).toEqual(['102'])
    expect(text).not.toContain('Persona Sintetica Dos')
  })

  it.each(['decisions', 'supervision'])('%s pide columnas explicitas, sin reason_text ni identidades', async name => {
    const { requests } = client()
    const { text } = await download(name)
    const selects = requests.filter(item => item.table.startsWith('case_review'))
    expect(selects.length).toBeGreaterThanOrEqual(2)
    for (const { select } of selects) {
      expect(select).not.toContain('*')
      expect(select).not.toMatch(/reason_text|reviewer(?!_role)|approver(?!_role)|explanation|inputs_hash|idempotency_key|checklist/)
    }
    expect(text).not.toContain(FREE_TEXT_MARKER)
    expect(text).not.toContain(String(REVIEWER_MARKER))
  })

  it('el reporte de supervision no tiene objetos ni filas individuales', async () => {
    client()
    const { file } = await download('supervision')
    expect(file.header).not.toEqual(expect.arrayContaining(['objeto_id']))
    expect(new Set(file.rows.map(row => row.tipo_fila))).toEqual(new Set(['AGREGADO']))
  })

  it('el reporte de calidad no tiene objetos ni filas individuales', async () => {
    client()
    const { file } = await download('data-quality')
    expect(file.header).not.toEqual(expect.arrayContaining(['objeto_id', 'identificador']))
    expect(new Set(file.rows.map(row => row.tipo_fila))).toEqual(new Set(['AGREGADO']))
  })
})

describe('ALIGN-028: celdas peligrosas', () => {
  it('los identificadores hostiles llegan neutralizados y sin romper el archivo', async () => {
    client()
    const { file } = await download('queue')
    const byId = Object.fromEntries(details(file.rows).map(row => [row.objeto_id, row.identificador]))
    expect(byId['103']).toBe(`'${HOSTILE_IDENTIFIERS[0]}`)
    // El mapeador recorta los blancos del identificador: el caso con blancos esta en report-csv.test.ts.
    expect(byId['104']).toBe("'=1+1")
    expect(byId['105']).toBe("'+1+1")
    expect(byId['106']).toBe(`'${HOSTILE_IDENTIFIERS[3]}`)
    expect(byId['107']).toBe(`'${HOSTILE_IDENTIFIERS[4]}`)
  })

  it('un codigo con formula tampoco se ejecuta, en decisiones ni en supervision', async () => {
    client()
    const decisions = await download('decisions')
    expect(details(decisions.file.rows).find(row => row.decision_id === '6')?.codigo_motivo).toBe('CODIGO_NO_CATALOGADO')
    const supervision = await download('supervision')
    expect(aggregated(supervision.file.rows, 'motivos_decision', 'CODIGO_NO_CATALOGADO').valor).toBe('1')
  })

  it.each(REPORTS)('%s: ninguna celda de texto arranca con un caracter de formula', async name => {
    client()
    const { file } = await download(name)
    const NUMERIC_NEGATIVE = /^-\d+(?:,\d{2})?$/
    for (const row of file.rows) {
      for (const [column, cell] of Object.entries(row)) {
        if (NUMERIC_NEGATIVE.test(cell)) continue
        expect(cell, column).not.toMatch(/^[\s\p{Cf}]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20\u2212]/u)
      }
    }
  })

  it('un identificador o tipo ausente se declara, sin el rotulo de respaldo de la pantalla', async () => {
    client({ debtor: [{ id: 120, tenant: 7 }], debt: [], debtor_person: [], person: [], debtor_contact: [] })
    const { file } = await download('queue')
    expect(details(file.rows)[0]).toMatchObject({ objeto_id: '120', identificador: 'NO_INFORMADO_EN_ORIGEN', tipo: 'NO_INFORMADO_EN_ORIGEN' })
    expect(details((await download('queue', '?type=Sin%20tipo')).file.rows)).toHaveLength(1)
  })

  it('un importe negativo sigue siendo numero y entra en el total', async () => {
    client()
    const { file } = await download('queue')
    const negative = details(file.rows).find(row => row.objeto_id === '109')!
    expect(negative.deuda_total_ars).toBe('-50')
    expect(csvCents(negative.deuda_total_ars)).toBe(-5000)
  })
})

// B1 de la revision: la base solo exige formato, asi que un codigo editable puede ser un nombre o un documento.
describe('ALIGN-028 B1: un campo editable nunca llega crudo al CSV', () => {
  const HOSTILE = {
    reason: 'ANA_PEREZ_DNI_12345678', objection: 'LUIS_GOMEZ_DNI_87654321', decided: 'ALICIA_ROJAS_DNI_12345678',
    suggested: 'MARTA_DIAZ_DNI_11222333', role: 'SILVIA_PAZ', old: 'PEDRO_SOSA_DNI_44555666',
  }
  function hostileTables() {
    const tables = reviewTables()
    const reviews = tables.case_review
    Object.assign(reviews[3], { reason_code: HOSTILE.reason, decided_intervention: HOSTILE.decided, suggested_intervention: HOSTILE.suggested, reviewer_role: HOSTILE.role })
    // Un evento historico, ya reemplazado, tambien se exporta en decisiones.
    Object.assign(reviews[1], { reason_code: HOSTILE.old, decided_intervention: HOSTILE.old })
    tables.case_review_approval[2].reason_code = HOSTILE.objection
    return tables
  }
  const NOT_CATALOGUED = 'CODIGO_NO_CATALOGADO'

  it.each(['USER', 'ADMIN'])('decisiones para %s: ni motivo, ni intervencion, ni rol crudos, tampoco historicos', async role => {
    client(hostileTables(), {}, role)
    const { text, file } = await download('decisions')
    for (const marker of Object.values(HOSTILE)) expect(text, marker).not.toContain(marker)
    expect(text).not.toMatch(/DNI_\d/)
    const row = (id: string) => details(file.rows).find(item => item.decision_id === id)!
    expect(row('4')).toMatchObject({
      codigo_motivo: NOT_CATALOGUED, intervencion_decidida: NOT_CATALOGUED, intervencion_sugerida: NOT_CATALOGUED, rol: NOT_CATALOGUED, intensidad_decidida: '3',
      rol_rotulo: 'Rol no catalogado', motivo_rotulo: 'Código no catalogado', accion_decidida: 'Código no catalogado', accion_sugerida: 'Código no catalogado',
    })
    expect(row('2')).toMatchObject({ codigo_motivo: NOT_CATALOGUED, intervencion_decidida: NOT_CATALOGUED, vigente: 'NO' })
    expect(totalRow(file.rows)).toMatchObject({ decisiones: '8', vigentes: '7' })
  })

  it('supervision: sin los valores y con los conteos intactos', async () => {
    client(hostileTables())
    const { text, file } = await download('supervision')
    for (const marker of Object.values(HOSTILE)) expect(text, marker).not.toContain(marker)
    expect(text).not.toMatch(/DNI_\d/)
    expect(aggregated(file.rows, 'decisiones_vigentes').valor).toBe('7')
    const motives = file.rows.filter(row => row.indicador === 'motivos_decision')
    expect(motives.reduce((sum, row) => sum + csvNumber(row.valor)!, 0)).toBe(7)
    expect(aggregated(file.rows, 'motivos_decision', NOT_CATALOGUED).valor).toBe('2')
    expect(aggregated(file.rows, 'motivos_objecion', NOT_CATALOGUED)).toMatchObject({ valor: '1', denominador: '1' })
    expect(aggregated(file.rows, 'aprobaciones_vigentes', 'OBJETA').valor).toBe('1')
  })

  it('los codigos de la lista exportable se conservan', async () => {
    client()
    const { file } = await download('supervision')
    expect(aggregated(file.rows, 'motivos_decision', 'CRITERIO_DEL_SERVICIO').valor).toBe('2')
    expect(aggregated(file.rows, 'motivos_objecion', 'ALTERNATIVA_NO_OFRECIDA').valor).toBe('1')
    const decisions = await download('decisions')
    expect(details(decisions.file.rows).find(row => row.decision_id === '5')).toMatchObject({
      codigo_motivo: 'CRITERIO_DEL_SERVICIO', intervencion_decidida: 'INTIMACION_ADMINISTRATIVA',
      // Noche 7: un rol anterior guardado se exporta con su nombre y la marca de rol anterior, no como no catalogado.
      rol: 'operador', rol_rotulo: 'operador (rol anterior)',
    })
    expect(details(decisions.file.rows).find(row => row.decision_id === '6')?.intervencion_decidida).toBe('DERIVACION_PROCURACION')
  })

  it('un filtro de tipo fuera del catalogo leido filtra, pero no queda en el archivo', async () => {
    client()
    const { text, file } = await download('queue', `?type=${HOSTILE.reason}`)
    expect(text).not.toContain(HOSTILE.reason)
    expect(totalRow(file.rows)).toMatchObject({ objetos: '0', filtros: 'type=VALOR_NO_CATALOGADO' })
  })

  it('el texto libre de una obligacion o una relacion no llega a la cola ni a calidad', async () => {
    const tables = portfolioTables()
    Object.assign(tables.debt[0], { current_amount: HOSTILE.reason, estado_origen: HOSTILE.old, periodo_fiscal: HOSTILE.old, due_date: HOSTILE.old })
    Object.assign(tables.debtor_person[0], { priority: HOSTILE.reason, role: HOSTILE.old })
    client(tables)
    for (const name of ['queue', 'data-quality']) {
      const { text } = await download(name)
      for (const marker of Object.values(HOSTILE)) expect(text, `${name} ${marker}`).not.toContain(marker)
      expect(text).not.toMatch(/DNI_\d/)
    }
  })

  // Noche 7: exportar lo que ya se ve en pantalla no amplia el acceso; USER tambien recibe el identificador.
  it.each([['USER', true], ['ADMIN', true], ['tp_operator', false]])('el identificador de origen: %s lo recibe=%s', async (role, shown) => {
    client({}, {}, role as string)
    const { file } = await download('queue')
    const row = details(file.rows).find(item => item.objeto_id === '101')!
    expect(row.identificador).toBe(shown ? 'OBJ-CONTACTO' : 'OMITIDO_POR_ROL')
    expect(details(file.rows)).toHaveLength(10)
  })
})

describe('ALIGN-028: conciliacion con la vista, parser independiente', () => {
  const FILTERS: Record<string, string>[] = [
    {},
    { contact: 'with' },
    { contact: 'without' },
    { risk: 'ALTO' },
    { risk: 'BAJO' },
    { type: 'AGUA' },
    { minAmount: '100000' },
    { q: 'OBJ-' },
    { q: 'persona sintetica dos' },
    { contact: 'with', risk: 'MEDIO', type: 'AGUA', minAmount: '1000' },
    { type: 'TIPO-QUE-NO-EXISTE' },
  ]

  it.each(FILTERS)('cola = /priority-cases con %j', async filters => {
    client()
    const query = `?${new URLSearchParams(filters)}`
    const response = await getQueue(request('queue', query))
    const shown = selectionTotal(await PriorityCasesPage({ searchParams: Promise.resolve(filters) } as never))
    if (shown === 'No disponible') {
      // H16: la pantalla no puede afirmar la selección (casos sin el dato del filtro): el CSV tampoco, y lo dice.
      expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({ error: 'SELECCION_INCOMPLETA' })
      expect(response.headers.get('content-disposition')).toBeNull()
      return
    }
    expect(response.status, query).toBe(200)
    const file = parseCsvBytes(new Uint8Array(await response.arrayBuffer()))
    const rows = details(file.rows)
    expect(shown, 'la pantalla debe mostrar su contador').toMatch(/^\d[\d.]* casos?$/)
    expect(rows.length).toBe(Number(shown!.replace(/\D/g, '')))
    expect(csvNumber(totalRow(file.rows).objetos)).toBe(rows.length)
    // ALIGN-021 muestra una cola por vez. El CSV reúne todas, en ese mismo orden.
    const knownQueues = new Set<string>(INTERVENTION_CODES)
    const visibleIds: string[] = []
    for (const queue of [...INTERVENTION_CODES, 'SIN_COLA']) {
      const tree = await PriorityCasesPage({ searchParams: Promise.resolve({ ...filters, queue, pageSize: '20' }) })
      const ids = queueObjectIds(tree)
      const expected = rows.filter(row => (knownQueues.has(row.intervencion_codigo) ? row.intervencion_codigo : 'SIN_COLA') === queue)
      expect(ids, `objetos y orden de ${queue}`).toEqual(expected.map(row => row.objeto_id))
      visibleIds.push(...ids)
    }
    expect(visibleIds, 'todas las colas: sin omisiones, duplicados ni cambio de orden').toEqual(rows.map(row => row.objeto_id))
  })

  it('el total filtrado sale de las filas: un 0 de una seleccion vacia es derivado y conserva metadatos', async () => {
    client()
    const { file } = await download('queue', '?type=TIPO-QUE-NO-EXISTE')
    expect(details(file.rows)).toEqual([])
    expect(totalRow(file.rows)).toMatchObject({ objetos: '0', deuda_total_ars: '0', filtros: 'type=VALOR_NO_CATALOGADO', generado_en: NOW })
  })

  it('cola sin filtros: suma de filas = total del CSV = tarjetas de /debt-aging', async () => {
    client()
    const { file } = await download('queue')
    const rows = details(file.rows)
    const total = totalRow(file.rows)
    expect(rows).toHaveLength(10)
    expect(sumCents(rows, 'deuda_total_ars')).toBe(csvCents(total.deuda_total_ars))
    expect(sumCents(rows, 'deuda_vencida_ars')).toBe(csvCents(total.deuda_vencida_ars))
    expect(sumCents(rows, 'monto_evaluable_ars')).toBe(csvCents(total.monto_evaluable_ars))
    const cards = cardValues(await (DebtAgingPage as never as (props: unknown) => Promise<ReactNode>)({ searchParams: Promise.resolve({}) }))
    expect(cards['Total registrado']).toBe(formatCurrency(csvCents(total.deuda_total_ars)! / 100))
    expect(cards['Deuda vencida']).toBe(formatCurrency(csvCents(total.deuda_vencida_ars)! / 100))
  })

  it('el importe ilegible no entra como 0: la fila declara su estado y el total lo cuenta aparte', async () => {
    client()
    const { file } = await download('queue')
    const total = totalRow(file.rows)
    const partial = details(file.rows).find(row => row.objeto_id === '110')!
    expect(partial.deuda_total_ars).toBe('300')
    expect(partial.faltantes).toContain('deuda_total_ars:INVALIDO=1')
    expect(total.faltantes).toContain('deuda_total_ars:INVALIDO=1')
  })

  it('los faltantes de las filas suman los del total, por columna y estado', async () => {
    client()
    const { file } = await download('queue')
    const accumulated = new Map<string, number>()
    for (const row of details(file.rows)) {
      if (row.faltantes === 'NINGUNO') continue
      for (const part of row.faltantes.split('|')) {
        const [key, count] = part.split('=')
        accumulated.set(key, (accumulated.get(key) ?? 0) + Number(count))
      }
    }
    const declared = totalRow(file.rows).faltantes.split('|').map(part => part.split('='))
    expect(accumulated.size).toBeGreaterThan(0)
    expect(Object.fromEntries(declared.map(([key, count]) => [key, Number(count)]))).toEqual(Object.fromEntries(accumulated))
  })

  it('un objeto sin obligaciones suma 0 derivado; intensidad y atraso no se inventan', async () => {
    client()
    const { file } = await download('queue')
    const empty = details(file.rows).find(row => row.objeto_id === '108')!
    expect(empty.deuda_total_ars).toBe('0')
    expect(empty.dias_atraso_max).toBe('NO_APLICA')
  })

  it('monto evaluable por intervencion = resumen de /recommended-actions', async () => {
    client()
    const { file } = await download('queue')
    const rows = details(file.rows)
    const { debtors, warnings } = await getDebtorsData()
    for (const group of buildRecommendationSummary(debtors, warnings)) {
      if (group.interventionCode === null) continue
      const queue = rows.filter(row => row.intervencion_codigo === group.interventionCode)
      expect(queue.length, group.interventionCode).toBe(group.count)
      expect(sumCents(queue, 'monto_evaluable_ars'), group.interventionCode).toBe(Math.round((group.debtAssociated ?? 0) * 100))
      expect(queue.map(row => row.objeto_id)).toEqual(group.cases.map(item => item.id))
    }
  })

  it('calidad = /no-contact y objetos leidos = universo de la vista', async () => {
    client()
    const { file } = await download('data-quality')
    const cards = cardValues(await (NoContactPage as never as (props: unknown) => Promise<ReactNode>)({ searchParams: Promise.resolve({}) }))
    const withoutContact = aggregated(file.rows, 'objetos_sin_contacto')
    expect(cards['Total sin contacto']).toBe(withoutContact.valor)
    const { debtors } = await getDebtorsData()
    expect(csvNumber(aggregated(file.rows, 'objetos_leidos').valor)).toBe(debtors.length)
    expect(withoutContact).toMatchObject({ numerador: withoutContact.valor, denominador: String(debtors.length) })
  })

  it('calidad: cada distribucion suma el universo y separa lo parcial de lo observado', async () => {
    client()
    const { file } = await download('data-quality')
    const objects = csvNumber(aggregated(file.rows, 'objetos_leidos').valor)!
    for (const indicator of ['presencia_deuda_total', 'presencia_deuda_vencida', 'presencia_contactos', 'presencia_atraso', 'presencia_severidad', 'severidad_estado']) {
      const rows = file.rows.filter(row => row.indicador === indicator)
      expect(rows.length, indicator).toBeGreaterThan(1)
      expect(rows.reduce((sum, row) => sum + csvNumber(row.valor)!, 0), indicator).toBe(objects)
    }
    expect(aggregated(file.rows, 'presencia_deuda_total', 'OBSERVADO_PARCIAL').valor).toBe('1')
    expect(aggregated(file.rows, 'obligaciones_leidas').valor).toBe('11')
    expect(aggregated(file.rows, 'obligaciones_no_evaluables', 'TOTAL').valor).toBe('2')
    expect(aggregated(file.rows, 'banderas', 'SIN_CONTACTO_ACTIVO').valor).toBe('1')
    expect(aggregated(file.rows, 'banderas', 'VERIFICAR_PRESCRIPCION').valor).toBe('0')
  })

  it('supervision = decisiones con los mismos filtros, y coincide con lo calculado a mano', async () => {
    client()
    const { file } = await download('supervision')
    const decisions = await download('decisions')
    const current = details(decisions.file.rows).filter(row => row.vigente === 'SI')
    const value = (indicator: string, category = 'TOTAL') => csvNumber(aggregated(file.rows, indicator, category).valor)
    expect(value('decisiones_vigentes')).toBe(current.length)
    expect(value('decisiones_vigentes')).toBe(7)
    expect(value('eventos_reemplazados')).toBe(1)
    for (const decision of ['ACEPTA', 'MODIFICA', 'RECHAZA', 'POSPONE', 'DERIVA']) {
      expect(value('decisiones_por_tipo', decision), decision).toBe(current.filter(row => row.decision === decision).length)
    }
    const discrepancy = aggregated(file.rows, 'porcentaje_discrepancia')
    expect(discrepancy).toMatchObject({ numerador: '6', denominador: '7', valor: '85,71', unidad: '%', estado: 'OBSERVADO' })
    expect(value('motivos_decision', 'CRITERIO_DEL_SERVICIO')).toBe(2)
    expect(value('motivos_decision', 'SIN_CODIGO')).toBe(1)
    expect(file.rows.some(row => row.categoria === 'DATOS_INCOMPLETOS')).toBe(false)
    expect(value('motivos_objecion', 'ALTERNATIVA_NO_OFRECIDA')).toBe(1)
    expect(value('aprobacion_requerida')).toBe(3)
    expect(value('pendientes_aprobacion')).toBe(1)
    expect(value('aprobaciones_vigentes', 'APRUEBA')).toBe(1)
    expect(value('aprobaciones_vigentes', 'OBJETA')).toBe(1)
    expect(current.filter(row => row.aprobacion === 'PENDIENTE').length).toBe(1)
    expect(totalRow(decisions.file.rows)).toMatchObject({ decisiones: '8', vigentes: '7' })
  })

  it.each([
    ['?corte=2026-09-30', 6], ['?corte=2026-10-15', 1], ['?hasta=2026-10-03', 1], ['?desde=2026-10-25&hasta=2026-10-25', 1],
    ['?corte=2030-01-01', 0],
  ])('supervision y decisiones vigentes coinciden con %s', async (query, expected) => {
    client()
    const supervision = await download('supervision', query)
    const decisions = await download('decisions', query)
    expect(details(decisions.file.rows).filter(row => row.vigente === 'SI').length).toBe(expected)
    expect(csvNumber(aggregated(supervision.file.rows, 'decisiones_vigentes').valor)).toBe(expected)
    expect(supervision.file.rows[0].filtros).toBe(decisions.file.rows[0].filtros)
  })

  it('sin decisiones: los conteos son 0 derivado y el porcentaje NO_APLICA, nunca 0', async () => {
    client({ case_review: [], case_review_approval: [] })
    const { file } = await download('supervision')
    expect(aggregated(file.rows, 'decisiones_vigentes').valor).toBe('0')
    expect(aggregated(file.rows, 'porcentaje_discrepancia')).toMatchObject({ valor: 'NO_APLICA', estado: 'NO_APLICA', denominador: '0' })
    expect(file.rows.every(row => row.fecha_corte === 'NO_APLICA' && row.version_reglas === 'NO_APLICA')).toBe(true)
    const decisions = await download('decisions')
    expect(details(decisions.file.rows)).toEqual([])
    expect(totalRow(decisions.file.rows)).toMatchObject({ decisiones: '0', vigentes: '0', fecha_corte: 'NO_APLICA' })
  })

  it('sin objetos visibles: no afirma cero ni entrega un reporte que podría estar limitado por RLS', async () => {
    client({ debtor: [], debt: [], debtor_person: [], person: [], debtor_contact: [] })
    for (const name of ['queue', 'data-quality']) {
      const response = await handler(name)(request(name))
      expect(response.status).toBe(503)
      expect(response.headers.get('content-disposition')).toBeNull()
    }
  })

  it('decisiones: sin intervencion decidida es NO_APLICA, nunca intensidad 0; aprobacion por estado', async () => {
    client()
    const { file } = await download('decisions')
    const row = (id: string) => details(file.rows).find(item => item.decision_id === id)!
    expect(row('1')).toMatchObject({ decision: 'ACEPTA', codigo_motivo: 'NO_APLICA', rol: 'ADMIN', fecha: '2026-10-02T15:30:00.000Z', aprobacion: 'NO_REQUERIDA', vigente: 'SI' })
    expect(row('2')).toMatchObject({ vigente: 'NO', aprobacion: 'NO_REQUERIDA', codigo_motivo: 'DATOS_INCOMPLETOS' })
    expect(row('3')).toMatchObject({ reemplaza_a: '2', intensidad_decidida: 'NO_APLICA', intervencion_decidida: 'NO_APLICA' })
    expect(row('4').aprobacion).toBe('PENDIENTE')
    expect(row('5').aprobacion).toBe('APRUEBA')
    expect(row('6').aprobacion).toBe('OBJETA')
  })

  it('decisiones: los filtros de decision y vigencia recortan filas y total', async () => {
    client()
    const onlyAccepted = await download('decisions', '?decision=ACEPTA')
    expect(details(onlyAccepted.file.rows).map(row => row.decision_id)).toEqual(['1'])
    const replaced = await download('decisions', '?vigente=no')
    expect(details(replaced.file.rows).map(row => row.decision_id)).toEqual(['2'])
    expect(totalRow(replaced.file.rows)).toMatchObject({ decisiones: '1', vigentes: '0' })
  })
})

describe('Noche 7: reportes consistentes con el tablero', () => {
  const ACCESS_ROWS: RawRow[] = [
    { id: 11, tenant: 7, actor: 42, actor_role: 'ADMIN', action: 'CASE_OPEN', target: '101', created_at: '2026-11-01T10:00:00.000+00:00' },
    { id: 12, tenant: 7, actor: 43, actor_role: 'supervisor', action: 'REPORT_EXPORT', target: 'supervision', created_at: '2026-11-01T11:00:00.000+00:00' },
    { id: 13, tenant: 7, actor: 43, actor_role: 'ADMIN', action: 'IMPORT_CONFIRM', target: '1', created_at: '2026-11-01T12:00:00.000+00:00' },
    { id: 14, tenant: 7, actor: 42, actor_role: 'SILVIA_PAZ', action: 'CASE_OPEN', target: '999', created_at: '2026-11-01T13:00:00.000+00:00' },
    { id: 19, tenant: 8, actor: 99, actor_role: 'ADMIN', action: 'CASE_OPEN', target: '801', created_at: '2026-11-01T14:00:00.000+00:00' },
  ]
  const exports = () => auditRpc.mock.calls.filter(([name, args]) => name === 'record_access_audit' && args.p_action === 'REPORT_EXPORT')

  it('H16: una seleccion vacia con casos sin el dato del filtro responde 422, sin archivo ni registro de descarga', async () => {
    client()
    const response = await getQueue(request('queue', '?risk=ALTO'))
    expect(response.status).toBe(422)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('content-disposition')).toBeNull()
    expect(await response.json()).toEqual({ error: 'SELECCION_INCOMPLETA', mensaje: expect.stringContaining('Faltan datos para evaluar los filtros') })
    expect(exports()).toHaveLength(0)
    // La pantalla dice lo mismo para esa seleccion.
    expect(selectionTotal(await PriorityCasesPage({ searchParams: Promise.resolve({ risk: 'ALTO' }) }))).toBe('No disponible')
  })

  it('H16: una seleccion vacia de un universo conocido sigue siendo un archivo valido con 0 casos', async () => {
    client()
    const { file } = await download('queue', '?type=TIPO-QUE-NO-EXISTE')
    expect(details(file.rows)).toEqual([])
    expect(totalRow(file.rows).objetos).toBe('0')
    expect(exports()).toHaveLength(1)
  })

  it('un monto minimo negativo se rechaza como la pantalla, sin exportar otra seleccion', async () => {
    client()
    const response = await getQueue(request('queue', '?minAmount=-1'))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'FILTRO_INVALIDO', filtro: 'minAmount' })
  })

  it('el total de la cola (casos y deuda pendiente) es el del tablero, con las tres definiciones', async () => {
    client()
    const { file } = await download('queue')
    const total = totalRow(file.rows)
    const { dashboard } = await getDashboardData()
    expect(csvNumber(total.objetos)).toBe(dashboard.totalDebtors)
    expect(csvCents(total.deuda_pendiente_ars)).toBe(Math.round(dashboard.pendingDebt! * 100))
    expect(csvCents(total.deuda_total_ars)).toBe(Math.round(dashboard.totalDebt! * 100))
    expect(csvCents(total.deuda_vencida_ars)).toBe(Math.round(dashboard.overdueDebt! * 100))
    expect(sumCents(details(file.rows), 'deuda_pendiente_ars')).toBe(csvCents(total.deuda_pendiente_ars))
  })

  it('una pagada suma al total registrado y no a la deuda pendiente ni a la vencida', async () => {
    const tables = portfolioTables()
    tables.debt.push({ ...tables.debt[0], id: 12, current_amount: 700, status: 3 })
    client({ debt: tables.debt })
    const row = details((await download('queue')).file.rows).find(item => item.objeto_id === '101')!
    expect(csvCents(row.deuda_total_ars)! - csvCents(row.deuda_pendiente_ars)!).toBe(70000)
    expect(csvCents(row.deuda_pendiente_ars)).toBe(Math.round((950000.5 + 1250.25) * 100))
  })

  it('decisiones: identificador del caso, rotulos de pantalla y datos anteriores con la regla de la ficha', async () => {
    client()
    const { file } = await download('decisions')
    const row = (id: string) => details(file.rows).find(item => item.decision_id === id)!
    expect(row('1')).toMatchObject({
      objeto_id: '101', identificador: 'OBJ-CONTACTO', rol: 'ADMIN', rol_rotulo: 'Administrador',
      decision_rotulo: 'Recomendación aceptada', motivo_rotulo: 'Sin motivo', accion_decidida: 'Contacto y plan (intensidad 2)',
      aprobacion_rotulo: 'Decisión registrada', datos_anteriores: 'SI', fecha_cartera: PORTFOLIO_AS_OF,
    })
    expect(row('3')).toMatchObject({ decision_rotulo: 'Recomendación rechazada', accion_decidida: 'Sin acción decidida', motivo_rotulo: 'Ya hay una gestión en curso' })
    expect(row('4')).toMatchObject({ aprobacion: 'PENDIENTE', aprobacion_rotulo: 'Propuesta pendiente de aprobación' })
    expect(row('5')).toMatchObject({ aprobacion_rotulo: 'Propuesta aprobada', rol_rotulo: 'operador (rol anterior)' })
    expect(row('6')).toMatchObject({ aprobacion_rotulo: 'Propuesta objetada' })
    // La 7 se registro con la cartera vigente y las reglas vigentes: esta al dia.
    expect(row('7')).toMatchObject({ datos_anteriores: 'NO', decision_rotulo: 'Decisión pospuesta' })
    expect(totalRow(file.rows)).toMatchObject({ identificador: 'NO_APLICA', datos_anteriores: 'NO_APLICA' })
  })

  it('decisiones: un caso que ya no esta en la cartera vigente se declara, sin inventar su identificador', async () => {
    const tables = portfolioTables()
    client({ debtor: tables.debtor.filter(row => row.id !== 101) })
    const { file } = await download('decisions')
    expect(details(file.rows).find(item => item.decision_id === '1')?.identificador).toBe('NO_EN_CARTERA_VIGENTE')
  })

  it('USER recibe el mismo reporte de decisiones, con el identificador', async () => {
    client({}, {}, 'USER')
    const { file } = await download('decisions')
    expect(details(file.rows).find(item => item.decision_id === '1')?.identificador).toBe('OBJ-CONTACTO')
  })

  it('accesos: la apertura de un caso lleva su identificador; quien actuo, como propio u otra persona y su rol', async () => {
    client({ access_audit: ACCESS_ROWS })
    const { file, text } = await download('access')
    const row = (id: string) => details(file.rows).find(item => item.registro_id === id)!
    expect(row('11')).toMatchObject({
      accion: 'CASE_OPEN', accion_rotulo: 'Apertura de un caso', objetivo: '101', identificador: 'OBJ-CONTACTO',
      actor_id: '42', quien: 'PROPIO', rol_actor: 'ADMIN', rol_actor_rotulo: 'Administrador', fecha_cartera: PORTFOLIO_AS_OF,
    })
    expect(row('12')).toMatchObject({ identificador: 'NO_APLICA', quien: 'OTRA_PERSONA', rol_actor: 'supervisor', rol_actor_rotulo: 'supervisor (rol anterior)' })
    expect(row('13')).toMatchObject({ accion_rotulo: 'Confirmación de carga solicitada', identificador: 'NO_APLICA' })
    expect(row('14')).toMatchObject({ identificador: 'NO_EN_CARTERA_VIGENTE', rol_actor: 'CODIGO_NO_CATALOGADO' })
    expect(text).not.toContain('SILVIA_PAZ')
    expect(details(file.rows).map(item => item.registro_id)).toEqual(['11', '12', '13', '14'])
  })

  it.each(['USER', 'operador', 'supervisor'])('accesos para %s: 403 sin leer el registro', async role => {
    const { requests } = client({ access_audit: ACCESS_ROWS }, {}, role)
    const response = await getAccess(request('access'))
    expect(response.status).toBe(403)
    expect(requests.some(item => item.table === 'access_audit')).toBe(false)
  })

  it.each(ALL_REPORTS)('%s: la descarga se registra antes de responder; sin registro no hay archivo', async name => {
    client({ access_audit: ACCESS_ROWS })
    await download(name)
    expect(exports()).toHaveLength(1)
    auditRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'sin permiso' } })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await handler(name)(request(name))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'AUDITORIA_NO_DISPONIBLE' })
    expect(response.headers.get('content-disposition')).toBeNull()
  })
})
