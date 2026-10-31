import { createElement, Fragment, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Card } from '@/components/ui/card'
import { TabsContent } from '@/components/ui/tabs'
import { DataWarnings } from '@/components/equitas/data-warnings'
import { RiskBadge } from '@/components/equitas/risk-badge'
import { missingSummary, unavailable } from '@/lib/data-presence'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { mapDashboardMetricsFromDebtorObjects } from '@/lib/mappers/dashboard-metrics-mapper'
import { mapPeopleFromRawData } from '@/lib/mappers/person-risk-mapper'
import { getDebtorDetailDataFromService } from '@/lib/services/debtor-data-service'
import { getPeopleDataFromService } from '@/lib/services/person-data-service'
import { buildPresencePeopleData, buildPresenceRawData } from '@/tests/helpers/equitas-fixtures'

const { loadRawDebtorData, getDebtorDetailData, getDebtorsData, getPeopleData, getDashboardData, loadAllTableRows } = vi.hoisted(() => ({
  loadRawDebtorData: vi.fn(), getDebtorDetailData: vi.fn(), getDebtorsData: vi.fn(),
  getPeopleData: vi.fn(), getDashboardData: vi.fn(), loadAllTableRows: vi.fn(),
}))
vi.mock('@/lib/data/raw-debtor-loader', () => ({ loadRawDebtorData }))
vi.mock('@/lib/equitas-data', () => ({ getDebtorDetailData, getDebtorsData, getPeopleData, getDashboardData }))
// El servicio de personas corre completo: solo se reemplaza la lectura de tablas.
vi.mock('@/lib/data/paginated-table-reader', () => ({ loadAllTableRows }))
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient: async () => ({}) }))
// Se renderizan los componentes reales. Solo se reemplaza lo que exige navegador o sesión.
vi.mock('next/navigation', () => ({
  usePathname: () => '/people', useRouter: () => ({ replace: () => undefined }),
  notFound: () => { throw new Error('notFound') },
}))
vi.mock('next/image', () => ({ default: () => null }))
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/auth/login-form', () => ({ LoginForm: () => null }))

import DebtorDetailPage from '@/app/debtors/[debtorId]/page'
import HomePage from '@/app/page'
import LoginPage from '@/app/login/page'
import PeoplePage from '@/app/people/page'
import RiskAnalysisPage from '@/app/risk-analysis/page'

type NodeProps = { children?: ReactNode; value?: string; title?: string; score?: number | null }
function nodesOfType(node: ReactNode, type: unknown): React.ReactElement<NodeProps>[] {
  if (Array.isArray(node)) return node.flatMap(child => nodesOfType(child, type))
  if (!isValidElement<NodeProps>(node)) return []
  return [...(node.type === type ? [node] : []), ...nodesOfType(node.props.children, type)]
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'" }
const markupOf = (node: ReactNode) => renderToStaticMarkup(createElement(Fragment, null, node))
const textOfMarkup = (markup: string) => markup.replace(/<[^>]*>/g, ' ')
  .replace(/&(?:amp|lt|gt|quot|#x27);/g, entity => ENTITIES[entity]).replace(/\s+/g, ' ').trim()
const renderedText = (node: ReactNode) => textOfMarkup(markupOf(node))
const countOf = (text: string, label: string) => text.split(label).length - 1

// Las pestañas inactivas no se montan: cada una se renderiza por separado con su contenido real.
function tabText(page: ReactNode, value: string) {
  return renderedText(nodesOfType(page, TabsContent).find(node => node.props.value === value)?.props.children)
}
const allTabsText = (page: ReactNode) => [renderedText(page),
  ...nodesOfType(page, TabsContent).map(node => renderedText(node.props.children))].join(' ')

const tablesOf = (markup: string) => markup.match(/<table\b[\s\S]*?<\/table>/g) ?? []
const headersOf = (table: string) => [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(match => textOfMarkup(match[1]))
const rowsOf = (table: string) => [...table.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map(match => textOfMarkup(match[0]))
const headingsOf = (markup: string) => [...markup.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map(match => textOfMarkup(match[1]))

function rawObject() {
  const raw = buildPresenceRawData()
  raw.batch = { as_of: '2026-09-30' }
  return raw
}

async function detailPage(raw = rawObject()) {
  loadRawDebtorData.mockResolvedValue(raw)
  getDebtorDetailData.mockResolvedValue(await getDebtorDetailDataFromService('901'))
  return DebtorDetailPage({ params: Promise.resolve({ debtorId: '901' }) })
}

function configureLists(raw = rawObject(), peopleRaw = buildPresencePeopleData()) {
  const mapped = mapDebtorObjectsFromRawData(raw)
  const people = mapPeopleFromRawData(peopleRaw)
  getDebtorsData.mockResolvedValue({ debtors: mapped.debtors, warnings: raw.warnings })
  getPeopleData.mockResolvedValue({ people: people.people, peopleDashboard: people.dashboard, warnings: [] })
  getDashboardData.mockResolvedValue({ dashboard: mapDashboardMetricsFromDebtorObjects(mapped), warnings: raw.warnings })
}

const peoplePage = () => PeoplePage({ searchParams: Promise.resolve({}) })

describe('ALIGN-012: etiquetas honestas con datos sintéticos', () => {
  beforeEach(() => { vi.clearAllMocks(); configureLists() })

  it('conserva los títulos y la columna que usa SMOKE-01', async () => {
    const peopleRaw = buildPresencePeopleData()
    peopleRaw.debts = [{ id: 801, debtor: 901, current_amount: 1250, due_date: '2025-01-01' }]
    configureLists(rawObject(), peopleRaw)
    const markup = markupOf(await peoplePage())
    expect(headingsOf(markup)).toContain('Personas / Deudores')
    expect(headingsOf(markupOf(await HomePage()))).toContain('Dashboard ejecutivo')
    // Mismo camino que deployed-smoke.mjs: la tabla se ubica por el encabezado exacto y la fila por la persona.
    const tables = tablesOf(markup).filter(table => headersOf(table).includes('Deuda total asociada'))
    expect(tables).toHaveLength(1)
    const amount = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(1250)
    const row = rowsOf(tables[0]).find(text => text.includes('Persona sintética A'))
    expect(row).toContain(amount.replace(/\s+/g, ' '))
    expect(row).toContain('Exposición asociada (no aditiva)')
  })

  it('explica la exposición y el índice heredado por persona en toda la pantalla', async () => {
    const markup = markupOf(await peoplePage())
    const text = textOfMarkup(markup)
    expect(text).toContain('objetos vinculados')
    expect(text).toContain('máxima severidad entre ellos')
    expect(text).toContain('Exposición no aditiva')
    expect(text).toContain('Exposición asociada (no aditiva)')
    expect(text).toContain('no son probabilidades de pago')
    for (const label of ['Severidad heredada baja', 'Severidad heredada media', 'Severidad heredada alta',
      'Promedio del índice heredado (puntos de 0 a 100):', 'Distribución de personas por máxima severidad heredada',
      'Top 5 personas por máxima severidad heredada']) {
      expect(countOf(text, label), label).toBe(1)
    }
    expect(tablesOf(markup).map(headersOf)).toEqual([
      ['Persona', 'Máxima severidad heredada', 'Puntaje (puntos de 0 a 100)', 'Objetos vinculados'],
      ['Nombre', 'Documento', 'Máxima severidad heredada', 'Puntaje (puntos de 0 a 100)', 'Objetos vinculados',
        'Contacto disponible', 'Deuda total asociada', 'Accion'],
    ])
    expect(text).not.toMatch(/riesgo|\bscore\b|seguimiento individual/i)
  })

  it('el filtro de personas usa el rótulo de la columna y nombra su selector', async () => {
    const markup = markupOf(await peoplePage())
    expect(markup).toMatch(/<label for="risk"[^>]*>\s*Máxima severidad heredada\s*<\/label>/)
    expect(markup).toMatch(/<select\b[^>]*\bid="risk"/)
    expect(textOfMarkup(markup)).not.toContain('Riesgo individual')
  })

  it('separa severidad v1, índice heredado no disponible y vulnerabilidad no informada', async () => {
    const raw = rawObject()
    raw.debtorProfiles = [{ debtor: 901, socioeconomic_risk_level: 99 }]
    const page = await detailPage(raw)
    const text = allTabsText(page)
    expect(text).toContain('Severidad del objeto (v1)')
    expect(text).toContain('puntos de 0 a 100; no son porcentajes ni probabilidades de pago')
    expect(text).toContain('Vulnerabilidad: no informada')
    expect(text).toContain('Prioridad dentro de su cola (puntos de 0 a 100)')
    expect(text).toContain('Porcentaje declarado en origen')
    expect(text).toContain('ID externo de la obligación')
    expect(text).not.toMatch(/Nivel socioeconomico|Prioridad de contacto|\bPeriodo\b|\bscore\b|Perfil\/Riesgo|\briesgo\b/i)
    const legacy = nodesOfType(page, Card).find(card => renderedText(card).includes('Índice heredado de severidad (no social)'))!
    expect(renderedText(legacy)).toContain('No disponible')
    // El DTO ya no trae el índice v0: no etiquetar la severidad v1 como índice heredado.
    expect(nodesOfType(legacy, RiskBadge)).toHaveLength(0)
  })

  it.each([80, 120])('avisa que los porcentajes declarados suman %s sin normalizarlos', async total => {
    const raw = rawObject()
    raw.debtorPeople.forEach(person => { person.priority = total / 2 })
    const text = tabText(await detailPage(raw), 'people')
    expect(text).toContain(`Los porcentajes declarados suman ${total}%`)
    expect(text).toContain('no 100%')
    expect(text).toContain('No se normalizan ni determinan una cuota legal de deuda')
  })

  it.each([[50.02, 50, '100,02'], [49.98, 50, '99,98']])('avisa apenas fuera de la tolerancia en %s + %s', async (first, second, total) => {
    const raw = rawObject()
    raw.debtorPeople[0].priority = first
    raw.debtorPeople[1].priority = second
    expect(tabText(await detailPage(raw), 'people')).toContain(`Los porcentajes declarados suman ${total}%, no 100%.`)
  })

  // 0,01 + 100 y 0,02 + 99,97 quedan sobre el límite en decimales, pero Number los suma apenas por encima.
  it.each([[50, 50], [0, 100], [33.33, 66.67], [49.995, 50], [50.01, 50], [0.01, 100], [0.02, 99.97]])('respeta ceros y tolerancia del contrato en %j', async (first, second) => {
    const raw = rawObject()
    raw.debtorPeople[0].priority = first
    raw.debtorPeople[1].priority = second
    const text = tabText(await detailPage(raw), 'people')
    expect(text).not.toContain('no 100%')
    expect(text).not.toContain('No se puede verificar la suma')
    if (first === 0) expect(text).toMatch(/SINTETICO-A\s+0\s+SINTETICO/)
  })

  it('el aviso de suma coincide con la bandera de las reglas v1 cerca de los límites', async () => {
    let flagged = 0
    for (let hundredths = 0; hundredths <= 10000; hundredths += 137) {
      for (const total of [9998, 9999, 10000, 10001, 10002]) {
        const raw = rawObject()
        raw.debtorPeople[0].priority = hundredths / 100
        raw.debtorPeople[1].priority = (total - hundredths) / 100
        const page = await detailPage(raw)
        const { detail } = await getDebtorDetailDataFromService('901')
        const rule = detail!.debtor.decision!.banderas.includes('PORCENTAJES_NO_SUMAN_100')
        expect(tabText(page, 'people').includes('no 100%'), `${hundredths} / ${total}`).toBe(rule)
        if (rule) flagged++
      }
    }
    // El barrido cruza el límite en ambos sentidos: 2 de cada 5 totales quedan fuera de la tolerancia.
    expect(flagged).toBeGreaterThan(100)
  })

  it.each([null, 'ilegible'])('no suma como cero un porcentaje ausente o inválido (%s)', async value => {
    const raw = rawObject()
    raw.debtorPeople[0].priority = value
    const text = tabText(await detailPage(raw), 'people')
    expect(text).toContain('No se puede verificar la suma: hay porcentajes no informados o inválidos')
    expect(text).not.toMatch(/suman\s+50%/)
  })

  it('verifica los porcentajes aunque la decisión no se pueda calcular por un corte inválido', async () => {
    const raw = rawObject()
    raw.batch = { as_of: '2026-02-30' }
    raw.debtorPeople.forEach(person => { person.priority = 40 })
    const page = await detailPage(raw)
    expect(tabText(page, 'people')).toContain('Los porcentajes declarados suman 80%')
    expect(renderedText(page)).not.toContain('no se pudieron leer los datos necesarios')
  })

  it.each(['debtor_person', 'debtor_contact', 'debt'])('no afirma ausencia ante lectura fallida de %s', async table => {
    const raw = rawObject()
    raw.warnings = [{ table, message: 'Fallo sintético de lectura', needsSelectPolicy: false }]
    if (table === 'debtor_person') raw.debtorPeople = []
    if (table === 'debtor_contact') raw.debtorContacts = []
    if (table === 'debt') raw.debts = []
    const page = await detailPage(raw)
    // El documento depende solo del catálogo de personas: otras fallas no lo ocultan.
    if (table !== 'debtor_person') expect(tabText(page, 'people')).toMatch(/Persona sintética A\s+SINTETICO-A/)
    if (table === 'debtor_person') {
      expect(tabText(page, 'people')).toContain('No disponible')
      expect(tabText(page, 'people')).not.toContain('Sin personas asociadas visibles')
      expect(tabText(page, 'people')).not.toContain('suman 0%')
    }
    if (table === 'debtor_person' || table === 'debtor_contact') {
      expect(tabText(page, 'summary')).toContain('Contacto disponible: No disponible')
      expect(tabText(page, 'contacts')).toContain('No disponible')
      expect(tabText(page, 'contacts')).not.toContain('Sin contactos registrados')
      expect(tabText(page, 'people')).not.toContain('Sin contacto')
    }
    if (table === 'debt') {
      expect(tabText(page, 'debts')).toContain('No disponible')
      expect(tabText(page, 'debts')).not.toContain('Sin deudas visibles')
    }
    const text = renderedText(page)
    if (table === 'debt' || table === 'debtor_person') {
      expect(text).toContain('Decisión no disponible: no se pudieron leer los datos necesarios para evaluar este objeto')
      expect(text).not.toContain('LECTURA_FALLIDA')
    } else {
      // La regla v1 sigue evaluando cuando falla sólo el contacto.
      expect(text).not.toContain('Decisión no disponible:')
    }
  })

  // Un fallo de person deja las relaciones de debtor_person leídas: solo falta el catálogo de personas.
  function personReadFailed(priority = 50) {
    const raw = rawObject()
    raw.warnings = [{ table: 'person', message: 'Fallo sintético de lectura', needsSelectPolicy: false }]
    raw.people = []
    raw.debtorPeople.forEach(person => { person.priority = priority })
    return raw
  }

  it('con person fallido no afirma falta de documento y conserva las personas relacionadas', async () => {
    const page = await detailPage(personReadFailed())
    const text = tabText(page, 'people')
    expect(text).toMatch(/Persona 701\s+No disponible\s+50/)
    expect(text).toMatch(/Persona 702\s+No disponible\s+50/)
    expect(text).not.toContain('Sin documento')
    expect(text).not.toContain('Sin personas asociadas visibles')
    expect(text).not.toContain('no 100%')
    // La regla v1 sigue evaluando cuando falla sólo el catálogo de personas.
    expect(renderedText(page)).not.toContain('Decisión no disponible:')
  })

  it('con person fallido sigue avisando la suma, que depende de debtor_person', async () => {
    const text = tabText(await detailPage(personReadFailed(40)), 'people')
    expect(text).toContain('Los porcentajes declarados suman 80%, no 100%.')
    expect(text).not.toContain('Sin documento')
  })

  it('con person fallido y relaciones leídas vacías conserva la ausencia observada', async () => {
    const raw = personReadFailed()
    raw.debtorPeople = []
    const text = tabText(await detailPage(raw), 'people')
    expect(text).toContain('Sin personas asociadas visibles.')
    expect(text).not.toContain('no se pudo leer la lista de personas')
  })

  it('mantiene "Sin documento" cuando la persona se leyó y no informa documento', async () => {
    const raw = rawObject()
    raw.people[0] = { id: 701, full_name: 'Persona sintética A' }
    expect(tabText(await detailPage(raw), 'people')).toMatch(/Persona sintética A\s+Sin documento/)
  })

  it('mantiene las ausencias observadas cuando la lectura fue correcta y las listas están vacías', async () => {
    const raw = rawObject()
    raw.debtorPeople = []; raw.debtorContacts = []; raw.debts = []
    const page = await detailPage(raw)
    expect(tabText(page, 'summary')).toMatch(/Contacto disponible:\s+No\s*$/)
    expect(tabText(page, 'people')).toContain('Sin personas asociadas visibles.')
    expect(tabText(page, 'people')).not.toContain('No se puede verificar la suma')
    expect(tabText(page, 'contacts')).toContain('Sin contactos registrados para este objeto.')
    expect(tabText(page, 'debts')).toContain('Sin deudas visibles.')
    expect(renderedText(page)).not.toContain('Decisión no disponible:')
  })

  it('conserva el contacto observado disponible', async () => {
    expect(tabText(await detailPage(), 'summary')).toContain('Contacto disponible: Si')
  })

  it('distingue el conteo estricto >90 de la tabla inclusiva desde 70 puntos', async () => {
    const raw = rawObject()
    // 1 vencida: 40 de monto + 25 de antigüedad + 5 de cantidad = 70.
    raw.debts = [{ id: 801, debtor: 901, current_amount: 500000, due_date: '2025-01-01' }]
    for (const [id, amount, count] of [[902, 1000000, 1], [903, 1000000, 6], [904, 1000000, 12]]) {
      raw.debtors.push({ id, external_id: `SINTETICO-OBJ-${id}`, type: 6 })
      for (let index = 0; index < count; index++) raw.debts.push({ id: `${id}-${index}`, debtor: id,
        current_amount: index === 0 ? amount : 1, due_date: '2025-01-01' })
    }
    configureLists(raw)
    const page = await RiskAnalysisPage()
    const text = renderedText(page)
    expect(text).toContain('Objetos con severidad mayor a 90 puntos')
    expect(text).toContain('Conteo de objetos con más de 90 puntos; excluye 90')
    expect(text).toContain('Objetos en banda alta, desde 70 puntos')
    expect(text).toContain('Hasta 10 objetos con severidad de 70 a 100 puntos')
    const cards = nodesOfType(page, Card)
    expect(renderedText(cards[0])).toMatch(/Objetos con severidad mayor a 90 puntos\s+1\s+Conteo/)
    const high = cards.find(card => renderedText(card).includes('Objetos en banda alta, desde 70 puntos'))!
    expect(nodesOfType(high, RiskBadge).map(node => node.props.score).sort()).toEqual([70, 80, 90, 95])
    expect(text).toContain('no son porcentajes ni probabilidades de pago')
    expect(text).not.toMatch(/riesgo|\bscore\b/i)
  })

  it('rotula títulos, tablas y gráficos de /risk-analysis y declara el orden de la tabla', async () => {
    const markup = markupOf(await RiskAnalysisPage())
    const text = textOfMarkup(markup)
    expect(headingsOf(markup)).toEqual(['Análisis de severidad'])
    for (const [label, times] of [
      ['La severidad v1 describe el objeto', 1],
      ['Severidad del objeto (v1)', 1],
      ['Puntaje heurístico del objeto según las reglas v1.', 1],
      ['Objetos con severidad mayor a 90 puntos', 1],
      ['Conteo de objetos con más de 90 puntos; excluye 90.', 1],
      // Título de tarjeta y columna de la tabla de personas.
      ['Máxima severidad heredada', 2],
      ['Máximo del índice heredado por persona entre sus objetos vinculados.', 1],
      // Tarjeta de conteo y título de la tabla de personas.
      ['Personas con severidad heredada alta', 2],
      ['Índice heredado desde 70 puntos', 1],
      ['Distribución de objetos por severidad v1', 1],
      ['Distribución de personas por máxima severidad heredada', 1],
      ['Objetos en banda alta, desde 70 puntos', 1],
      ['Hasta 10 objetos con severidad de 70 a 100 puntos; incluye 70 y 90.', 1],
      ['Primeros 10 en orden operativo, no por severidad.', 1],
      ['Hasta 10 personas con índice heredado máximo desde 70 puntos entre sus objetos.', 1],
    ] as const) expect(countOf(text, label), label).toBe(times)
    expect(tablesOf(markup).map(headersOf)).toEqual([
      ['Objeto', 'Severidad (puntos de 0 a 100)', 'Deuda', 'Accion'],
      ['Persona', 'Máxima severidad heredada', 'Puntaje (puntos de 0 a 100)', 'Objetos vinculados'],
    ])
    expect(text).not.toMatch(/riesgo|\bscore\b|criticidad|puntaje alto|puntaje individual/i)
  })

  it('la línea de faltantes usa los rótulos del contrato', () => {
    const missing = unavailable('INVALIDO')
    expect(missingSummary({ riskAboveNinetyCases: missing, riskScore: missing, averageRiskValue: missing, urgentRecommendationCases: missing }))
      .toBe('Objetos con severidad mayor a 90 puntos: 1 INVALIDO; Severidad: 1 INVALIDO; Promedio del índice heredado: 1 INVALIDO; Revisión requerida: 1 INVALIDO')
  })

  it('las pantallas muestran los faltantes sin los rótulos heredados', async () => {
    const raw = rawObject()
    raw.debts[0].current_amount = 'ilegible'
    configureLists(raw)
    const analysis = renderedText(await RiskAnalysisPage())
    expect(analysis).toContain('Objetos con severidad mayor a 90 puntos: 1 INVALIDO')
    expect(analysis).toContain('Revisión requerida: 1 INVALIDO')
    expect(analysis).not.toMatch(/riesgo|recomendación urgente/i)

    const failedDebt = rawObject()
    failedDebt.warnings = [{ table: 'debt', message: 'Fallo sintético de lectura', needsSelectPolicy: false }]
    failedDebt.debts = []
    const detail = renderedText(await detailPage(failedDebt))
    expect(detail).toContain('Severidad: 1 NO_INTEGRADO')
    expect(detail).not.toMatch(/\briesgo\b/i)

    const peopleRaw = buildPresencePeopleData()
    peopleRaw.debtorProfilesDetail = [{ person: 701, debtor_profile: 901, risk_value: 'ilegible' }]
    configureLists(rawObject(), peopleRaw)
    const people = renderedText(await peoplePage())
    expect(people).toContain('Promedio del índice heredado: 1 ')
    expect(people).not.toMatch(/riesgo/i)
  })

  it('rotula todos los ejemplos del ingreso y no afirma gestión realizada', async () => {
    const page = await LoginPage({ searchParams: Promise.resolve({}) })
    const text = renderedText(page)
    expect(text).toContain('Ejemplo ilustrativo, no son datos')
    expect(text).toContain('Centro operativo ilustrativo, no son datos')
    expect(text).toContain('Objetos en banda alta')
    expect(text).toContain('Deuda de ejemplo')
    expect(text).toContain('Distribución ilustrativa de objetos por severidad')
    expect(text).not.toMatch(/Deuda gestionada|Casos criticos|perfiles de riesgo|Distribucion de riesgo|Preview institucional/i)
  })

  it.each([false, true])('los avisos de acceso no aconsejan abrir SELECT a anon (policy=%s)', needsSelectPolicy => {
    const text = renderedText(DataWarnings({ warnings: [{ table: 'debt', message: 'Fallo sintético', needsSelectPolicy }] }))
    expect(text).toContain('Fallo sintético')
    expect(text).not.toMatch(/agregar policy|SELECT|anon|authenticated/)
    if (needsSelectPolicy) expect(text).toContain('Solicite al administrador que revise los permisos de su cuenta')
  })

  it('el aviso real del servicio de personas no recomienda abrir permisos', async () => {
    loadAllTableRows.mockImplementation(async (table: string) => ({
      rows: table === 'person' ? [{ id: 701, full_name: 'Persona sintética A', document_number: 'SINTETICO-A' }] : [],
      warning: null,
    }))
    const data = await getPeopleDataFromService()
    expect(data.warnings).toEqual([{
      table: 'debtor_profile_detail', message: 'No devolvió filas para esta sesión.', needsSelectPolicy: true,
    }])
    getPeopleData.mockResolvedValue(data)
    for (const page of [await peoplePage(), await RiskAnalysisPage()]) {
      const text = renderedText(page)
      expect(text).toContain('debtor_profile_detail: No devolvió filas para esta sesión. (Acceso no disponible. Solicite al administrador que revise los permisos de su cuenta.)')
      expect(text).not.toMatch(/policy|SELECT|\banon\b|authenticated|desde frontend|sesion autenticada|\brol\b/i)
    }
  })
})
