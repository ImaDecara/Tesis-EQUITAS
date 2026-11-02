import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { serverClient, cookieStore } = vi.hoisted(() => ({ serverClient: vi.fn(), cookieStore: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient: serverClient }))
vi.mock('@/lib/supabase-config', () => ({ hasSupabaseCredentials: true }))
vi.mock('next/headers', () => ({ cookies: cookieStore }))

import { GET as getDataQuality } from '@/app/api/reports/data-quality/route'
import { GET as getDecisions } from '@/app/api/reports/decisions/route'
import { GET as getQueue } from '@/app/api/reports/queue/route'
import { GET as getSupervision } from '@/app/api/reports/supervision/route'
import DebtAgingPage from '@/app/debt-aging/page'
import NoContactPage from '@/app/no-contact/page'
import PriorityCasesPage from '@/app/priority-cases/page'
import { buildRecommendationSummary } from '@/lib/equitas-view-selectors'
import { getDebtorsData } from '@/lib/equitas-data'
import { formatCurrency } from '@/lib/utils'
import { createPaginatedSupabase } from '@/tests/fixtures/paginated-supabase'
import {
  FOREIGN_MARKER, FREE_TEXT_MARKER, HOSTILE_IDENTIFIERS, OTHER_CUTOFF, PERSONAL_MARKERS, portfolioTables,
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
const IDENTITY = ['user', 'tenant_user', 'tenant', 'role']

function client(tables: Record<string, RawRow[]> = {}, options: Parameters<typeof createPaginatedSupabase>[1] = {}, role = 'supervisor', signedIn = true) {
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
const handler = (name: string) => REPORTS.find(([report]) => report === name)![1]

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
const pageText = async (page: (props: never) => unknown, searchParams: Record<string, string> = {}) =>
  textFromReactTree(await page({ searchParams: Promise.resolve(searchParams) } as never) as never).replace(/\s+/g, ' ')

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(NOW) })
  cookieStore.mockResolvedValue({ get: () => undefined })
})
afterEach(() => { vi.useRealTimers() })

describe('ALIGN-028: autorizacion en cada Route Handler', () => {
  it.each(REPORTS)('%s sin sesion: 401, sin archivo y sin leer datos', async (name, get) => {
    const { requests } = client({}, {}, 'supervisor', false)
    const response = await get(request(name))
    expect(response.status).toBe(401)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ error: 'AUTH_REQUIRED' })
    expect(requests).toEqual([])
  })

  // ALIGN-003: consulta solo lectura; supervisor ve supervision; importador no lee cartera.
  // tp_operator es compatibilidad de solo lectura de la cartera (ADR-001 §9).
  const ALLOWED: Record<string, string[]> = {
    consulta: ['queue', 'decisions', 'data-quality'],
    operador: ['queue', 'decisions', 'data-quality'],
    supervisor: ['queue', 'decisions', 'supervision', 'data-quality'],
    importador: [],
    tp_operator: ['queue', 'data-quality'],
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
    client({}, {}, 'supervisor', false)
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
      const calls = requests.filter(item => item.table === table)
      expect(calls.length).toBeGreaterThan(1)
      expect(calls.every(item => item.filters.tenant === 'eq.7')).toBe(true)
    }
  })
})

describe('ALIGN-028: una lectura fallida no sale como 0 ni como archivo vacio', () => {
  const READS: [string, string[]][] = [
    ['queue', ['debtor', 'debtor_type', 'debt', 'debt_status', 'debtor_person', 'person', 'debtor_contact', 'debtor_profile']],
    ['data-quality', ['debtor', 'debtor_type', 'debt', 'debt_status', 'debtor_person', 'person', 'debtor_contact', 'debtor_profile']],
    ['decisions', ['case_review', 'case_review_approval']],
    ['supervision', ['case_review', 'case_review_approval']],
  ]
  it.each(READS.flatMap(([name, tables]) => tables.map(table => [name, table] as const)))('%s con %s caida: 503 y sin CSV', async (name, table) => {
    client({}, { fail: item => item.table === table ? { code: '42501', message: 'detalle interno sintetico' } : null })
    const response = await handler(name)(request(name))
    expect(response.status).toBe(503)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('content-disposition')).toBeNull()
    const body = await response.text()
    expect(JSON.parse(body)).toEqual({ error: 'LECTURA_FALLIDA', tablas: [table] })
    expect(body).not.toContain('detalle interno')
  })

  it('una falla en la segunda pagina tampoco deja un archivo parcial', async () => {
    client({}, { serverMaxRows: 2, fail: item => item.table === 'debt' && item.after !== null ? { message: 'corte' } : null })
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
    expect(file.header.slice(0, 6)).toEqual(['fecha_corte', 'version_reglas', 'filtros', 'generado_en', 'definiciones', 'tipo_fila'])
    expect(file.rows.length).toBeGreaterThan(0)
    for (const row of file.rows) {
      for (const column of ['fecha_corte', 'version_reglas', 'filtros', 'generado_en', 'definiciones']) expect(row[column], column).toBeTruthy()
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
    client()
    const { file } = await download('queue')
    for (const row of file.rows) {
      expect(row.fecha_corte).toBe('NO_INTEGRADO')
      expect(row.version_reglas).toBe('1.0.0')
    }
    expect(details(file.rows)[0].fecha_calculo_usada).toBe('2026-11-02')
    const quality = await download('data-quality')
    expect(quality.file.rows.every(row => row.fecha_corte === 'NO_INTEGRADO')).toBe(true)
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
    const { file, text } = await download('queue', '?risk=ALTO&contact=with&minAmount=10&q=Persona%20Sintetica%20Uno&page=2&pageSize=20')
    expect(file.rows[0].filtros).toBe('contact=with|minAmount=10|q=TEXTO_OMITIDO|risk=ALTO')
    expect(text).not.toContain('Persona Sintetica')
    expect((await download('queue')).file.rows[0].filtros).toBe('SIN_FILTROS')
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
  it.each(REPORTS)('%s no lleva personas, contactos, documentos, domicilio ni descripcion, tampoco para consulta', async name => {
    client({}, {}, name === 'supervision' ? 'supervisor' : 'consulta')
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
    expect(details(decisions.file.rows).find(row => row.decision_id === '6')?.codigo_motivo).toBe("'=FORMULA_EN_CODIGO")
    const supervision = await download('supervision')
    expect(aggregated(supervision.file.rows, 'motivos_decision', "'=FORMULA_EN_CODIGO").valor).toBe('1')
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

  it('un importe negativo sigue siendo numero y entra en el total', async () => {
    client()
    const { file } = await download('queue')
    const negative = details(file.rows).find(row => row.objeto_id === '109')!
    expect(negative.deuda_total_ars).toBe('-50')
    expect(csvCents(negative.deuda_total_ars)).toBe(-5000)
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
    const { file } = await download('queue', query)
    const rows = details(file.rows)
    const text = await pageText(PriorityCasesPage as never, filters)
    const shown = /(\d[\d.]*) ?casos/.exec(text)
    expect(shown, 'la pantalla debe mostrar su contador').not.toBeNull()
    expect(rows.length).toBe(Number(shown![1].replace(/\./g, '')))
    expect(csvNumber(totalRow(file.rows).objetos)).toBe(rows.length)
    // Mismos objetos y mismo orden que los primeros de la tabla de la pantalla.
    const { debtors } = await getDebtorsData()
    const visible = await pageText(PriorityCasesPage as never, { ...filters, pageSize: '20' })
    for (const row of rows.slice(0, 20)) {
      const debtor = debtors.find(item => item.id === row.objeto_id)!
      expect(visible).toContain(debtor.identifier.trim().replace(/\s+/g, ' '))
    }
  })

  it('el total filtrado sale de las filas: un 0 de una seleccion vacia es derivado y conserva metadatos', async () => {
    client()
    const { file } = await download('queue', '?type=TIPO-QUE-NO-EXISTE')
    expect(details(file.rows)).toEqual([])
    expect(totalRow(file.rows)).toMatchObject({ objetos: '0', deuda_total_ars: '0', filtros: 'type=TIPO-QUE-NO-EXISTE', generado_en: NOW })
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
    expect(cards['Deuda total']).toBe(formatCurrency(csvCents(total.deuda_total_ars)! / 100))
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
    expect(value('motivos_decision', 'REINCIDENCIA')).toBe(2)
    expect(value('motivos_decision', 'SIN_CODIGO')).toBe(1)
    expect(file.rows.some(row => row.categoria === 'DATO_DESACTUALIZADO')).toBe(false)
    expect(value('motivos_objecion', 'FALTA_ALTERNATIVA')).toBe(1)
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

  it('sin objetos: 0 derivado y metadatos, sin archivo mudo', async () => {
    client({ debtor: [], debt: [], debtor_person: [], person: [], debtor_contact: [] })
    const queue = await download('queue')
    expect(totalRow(queue.file.rows)).toMatchObject({ objetos: '0', deuda_total_ars: '0', fecha_corte: 'NO_INTEGRADO' })
    const quality = await download('data-quality')
    expect(aggregated(quality.file.rows, 'objetos_leidos').valor).toBe('0')
  })

  it('decisiones: sin intervencion decidida es NO_APLICA, nunca intensidad 0; aprobacion por estado', async () => {
    client()
    const { file } = await download('decisions')
    const row = (id: string) => details(file.rows).find(item => item.decision_id === id)!
    expect(row('1')).toMatchObject({ decision: 'ACEPTA', codigo_motivo: 'NO_APLICA', rol: 'operador', fecha: '2026-10-02T15:30:00.000Z', aprobacion: 'NO_REQUERIDA', vigente: 'SI' })
    expect(row('2')).toMatchObject({ vigente: 'NO', aprobacion: 'NO_REQUERIDA', codigo_motivo: 'DATO_DESACTUALIZADO' })
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
