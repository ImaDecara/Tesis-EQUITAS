import { isValidElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDashboard, buildIncompleteStatusRawData, buildPresencePeopleData, buildPresenceRawData } from '@/tests/helpers/equitas-fixtures'
import { textFromReactTree } from '@/tests/helpers/react-tree'
import { mapPeopleFromRawData } from '@/lib/mappers/person-risk-mapper'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { mapDashboardMetricsFromDebtorObjects } from '@/lib/mappers/dashboard-metrics-mapper'
import { buildRecommendationSummary, RECOMMENDATION_KINDS } from '@/lib/equitas-view-selectors'
import { decisionsFixture, markupOf, renderedText, viewerFixture } from '@/tests/helpers/viewer-fixtures'

const { getPeopleData, getDebtorsData, getDashboardData } = vi.hoisted(() => ({
  getPeopleData: vi.fn(), getDebtorsData: vi.fn(), getDashboardData: vi.fn(),
}))
vi.mock('@/lib/equitas-data', () => ({ getPeopleData, getDebtorsData, getDashboardData }))
const session = vi.hoisted(() => ({ viewer: vi.fn(), decisions: vi.fn() }))
vi.mock('@/lib/server/viewer-context', async original => ({ ...(await original<typeof import('@/lib/server/viewer-context')>()), loadViewerContext: session.viewer }))
vi.mock('@/lib/server/recorded-decisions', async original => ({ ...(await original<typeof import('@/lib/server/recorded-decisions')>()), loadRecordedDecisions: session.decisions }))
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children }))
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ replace: vi.fn() }) }))

import PeoplePage from '@/app/people/page'
import HomePage from '@/app/page'
import NoContactPage from '@/app/no-contact/page'
import DebtAgingPage from '@/app/debt-aging/page'
import RecommendedActionsPage from '@/app/recommended-actions/page'
import RiskAnalysisPage from '@/app/risk-analysis/page'
import PriorityCasesPage from '@/app/priority-cases/page'
import DebtorsPage from '@/app/debtors/page'

function cardValues(node: ReactNode): Record<string, unknown> {
  if (Array.isArray(node)) return Object.assign({}, ...node.map(cardValues))
  if (!isValidElement<{ label?: string; value?: unknown; children?: ReactNode }>(node)) return {}
  return { ...(node.props.label ? { [node.props.label]: node.props.value } : {}), ...cardValues(node.props.children) }
}

function configure(peopleRaw = buildPresencePeopleData(), debtorRaw = buildPresenceRawData()) {
  const personResult = mapPeopleFromRawData(peopleRaw)
  const objects = mapDebtorObjectsFromRawData(debtorRaw)
  getPeopleData.mockResolvedValue({ people: personResult.people, peopleDashboard: personResult.dashboard, warnings: peopleRaw.warnings })
  getDebtorsData.mockResolvedValue({ debtors: objects.debtors, warnings: debtorRaw.warnings })
  getDashboardData.mockResolvedValue({ dashboard: mapDashboardMetricsFromDebtorObjects(objects), warnings: debtorRaw.warnings })
  session.viewer.mockResolvedValue(viewerFixture())
  session.decisions.mockResolvedValue(decisionsFixture())
  return objects
}

describe('ALIGN-011: cálculos y valores visibles de las páginas', () => {
  beforeEach(() => { vi.clearAllMocks(); configure() })

  it('deduplica la deuda filtrada de dos personas/un objeto y señala exposición no aditiva', async () => {
    const raw = buildPresencePeopleData()
    raw.debts[0].current_amount = 125
    configure(raw)
    let text = renderedText(await PeoplePage({ searchParams: Promise.resolve({}) }))
    expect(text).toContain('Personas')
    expect(text).toMatch(/Total registrado asociado\s*\$\s*125/)
    expect(text).not.toMatch(/\$\s*250/)
    expect(text).toContain('Exposición asociada (no aditiva)')
    // N7 (H10): el índice anterior existe para una de las dos personas: se muestra, rotulado y con cobertura.
    expect(text).toContain('Índice anterior por persona')
    expect(text).toContain('1 de 2 personas con dato')
    expect(text).not.toMatch(/NO_INFORMADO_EN_ORIGEN|severidad heredada/i)
    text = renderedText(await PeoplePage({ searchParams: Promise.resolve({ q: 'sintética A', risk: 'BAJO' }) }))
    expect(text).toMatch(/Total registrado asociado\s*\$\s*125/)
    expect(text).not.toContain('Persona sintética B')
  })

  it('N7 (H10): sin índice anterior para nadie se quitan columna, filtro, tarjetas y gráfico, y queda una nota', async () => {
    const raw = buildPresencePeopleData()
    raw.debtorProfilesDetail = []
    // Mismo aviso que agrega el servicio de personas cuando la lectura no devuelve filas (código propio, N7).
    raw.warnings = [{ table: 'debtor_profile_detail', code: 'EMPTY_LEGACY_INDEX', message: 'El índice anterior por persona no tiene filas.', needsSelectPolicy: false }]
    configure(raw)
    const page = await PeoplePage({ searchParams: Promise.resolve({ risk: 'ALTO' }) })
    const markup = markupOf(page)
    const text = renderedText(page)
    expect(text).toContain('Esta cartera no trae el índice anterior por persona')
    expect(markup.match(/data-legacy-index=/g)).toHaveLength(1)
    expect(text).not.toMatch(/Índice anterior por persona|No se pudieron leer algunos datos/)
    expect(markup).not.toContain('id="risk"')
    // El filtro por índice se ignora: las dos personas siguen en el listado.
    expect(text).toContain('Persona sintética A')
    expect(text).toContain('Persona sintética B')
  })

  it('calcula sobre todas las personas filtradas antes de paginar', async () => {
    const raw = buildPresencePeopleData()
    raw.debts[0].current_amount = 125
    for (let index = 0; index < 12; index++) {
      raw.people.push({ id: 1000 + index, full_name: `Persona sintética extra ${index}` })
      raw.debtorPeople.push({ person: 1000 + index, debtor: 901, active: true })
    }
    configure(raw)
    for (const page of ['1', '2']) {
      const text = renderedText(await PeoplePage({ searchParams: Promise.resolve({ page }) }))
      expect(text).toMatch(/Total registrado asociado\s*\$\s*125/)
    }
  })

  // N7: el promedio del índice anterior se retiró (no existe en la cartera); el vacío válido ofrece limpiar.
  it('muestra suma cero y un vacío válido en un filtro sin coincidencias', async () => {
    const text = renderedText(await PeoplePage({ searchParams: Promise.resolve({ q: 'no existe' }) }))
    expect(text).toMatch(/Total registrado asociado\s*\$\s*0/)
    expect(text).toContain('No hay personas que cumplan los filtros elegidos. Limpiar filtros')
    expect(text).toContain('Mostrando 0 de 2 personas según los filtros.')
  })

  // N7: la columna de estado de catálogo se reemplazó por las definiciones únicas; sin jerga de corte.
  it('el listado muestra grupo, deuda pendiente y vencida, sin jerga de corte', async () => {
    const text = renderedText(await DebtorsPage({ searchParams: Promise.resolve({}) }))
    expect(text).toContain('Seguimiento')
    expect(text).toContain('Deuda pendiente')
    expect(text).toContain('Deuda vencida')
    expect(text).not.toMatch(/corte de origen|corte no integrado|NO_INFORMADO|Estado de catálogo/i)
  })

  it('muestra los $50 vencidos observados y el estado faltante, sin fabricar KPI cero', async () => {
    configure(buildPresencePeopleData(), buildIncompleteStatusRawData())
    const home = await HomePage()
    const aging = await DebtAgingPage({ searchParams: Promise.resolve({}) })
    expect(cardValues(home)['Casos con deuda vencida']).toBe('1')
    expect(textFromReactTree(home)).toContain('Casos con deuda vencida: 1 dato no informado en el archivo de origen')
    expect(cardValues(aging)['Deuda vencida']).toMatch(/\$\s*50/)
    expect(textFromReactTree(aging)).toContain('Deuda vencida: 1 dato no informado en el archivo de origen')
  })

  it('la mora v1 por calendario no depende del estado de catálogo desconocido', async () => {
    const raw = buildPresenceRawData()
    raw.debts[0].status = 8
    raw.debts[0].current_amount = 70
    configure(buildPresencePeopleData(), raw)
    const home = await HomePage()
    const aging = await DebtAgingPage({ searchParams: Promise.resolve({}) })
    expect(cardValues(home)['Casos con deuda vencida']).toBe('1')
    expect(cardValues(aging)['Deuda vencida']).toMatch(/\$\s*70/)
    expect(textFromReactTree(home)).not.toContain('Casos con deuda vencida: 1 dato no informado en el archivo de origen')
    expect(textFromReactTree(aging)).not.toContain('Deuda vencida: 1 dato no informado en el archivo de origen')
  })

  it('las intervenciones v1 reemplazan las del perfil y conservan los faltantes del objeto parcial', async () => {
    const raw = buildIncompleteStatusRawData()
    raw.debtorProfiles = raw.debtors.map(debtor => ({ debtor: debtor.id, socioeconomic_risk_level: 80 }))
    configure(buildPresencePeopleData(), raw)
    const text = textFromReactTree(await HomePage())
    // N7: la frase de «recomendación dominante» se retiró; cada grupo dice su cantidad y su porcentaje.
    expect(text).toMatch(/Revisión jurídica\s+1 caso\s*\(\s*50%\s*\)/)
    expect(text).toMatch(/Seguimiento\s+1 caso\s*\(\s*50%\s*\)/)
    expect(text).toContain('Puntaje de prioridad: 1 dato no informado en el archivo de origen')
  })

  it('una cola v1 vacía del tablero muestra 0 casos (0%) y no hay etiquetas heredadas', async () => {
    const raw = buildPresenceRawData()
    raw.batch = { as_of: '2026-09-30' }
    const mapped = mapDebtorObjectsFromRawData(raw)
    const dashboard = mapDashboardMetricsFromDebtorObjects(mapped)
    expect(dashboard.byRecommendation).toEqual([
      { label: 'Mejorar datos', value: 0 },
      { label: 'Revisión jurídica', value: 0 },
      { label: 'Contacto y plan', value: 0 },
      { label: 'Recordatorio', value: 0 },
      { label: 'Seguimiento', value: 1 },
      { label: 'No disponible', value: 0 },
    ])
    getDashboardData.mockResolvedValue({ dashboard, warnings: [] })
    expect(textFromReactTree(await HomePage())).toMatch(/Mejorar datos\s+0\s+casos\s*\(\s*0%\s*\)/)
    raw.warnings = [{ table: 'debtor', message: 'Fallo sintético', needsSelectPolicy: false }]
    const failed = mapDashboardMetricsFromDebtorObjects(mapDebtorObjectsFromRawData(raw))
    expect(failed.byRecommendation).toEqual([])
    getDashboardData.mockResolvedValue({ dashboard: failed, warnings: raw.warnings })
    expect(textFromReactTree(await HomePage())).toMatch(/Mejorar datos\s+No disponible\s+Revisión jurídica/)
  })

  it.each(['debt', 'debtor_contact', 'debtor_person', 'debtor', 'as_of'])('las colas son no disponibles ante fallo de %s, conservando los objetos conocidos aparte', async failure => {
    const raw = buildPresenceRawData()
    raw.batch = { as_of: failure === 'as_of' ? '2026-02-30' : '2026-09-30' }
    raw.debts[0].current_amount = 100
    raw.debts[0].due_date = '2026-09-01'
    if (failure !== 'as_of') raw.warnings = [{ table: failure, message: 'Fallo sintético', needsSelectPolicy: false }]
    if (failure === 'debt') raw.debts = []
    if (failure === 'debtor_contact') raw.debtorContacts = []
    if (failure === 'debtor_person') raw.debtorPeople = []
    if (failure === 'debtor') raw.debtors = []
    const mapped = configure(buildPresencePeopleData(), raw)
    const summary = buildRecommendationSummary(mapped.debtors, raw.warnings)
    const page = await RecommendedActionsPage()
    const cards = cardValues(page)
    const text = textFromReactTree(page).replace(/(?:[\d.]+ de [\d.]+ objetos con dato(?:; [\d.]+ parciales)?\.|Cobertura no disponible: lectura fallida o selección incompleta\.)/g, '')
    for (const group of summary.filter(item => item.interventionCode !== null)) {
      expect(group).toMatchObject({ count: null, cases: [], highlightedCases: [], debtAssociated: null, averageRisk: null })
      expect(group.metrics.totalDebt.presence).toBe('NO_INTEGRADO')
      expect(group.metrics.riskScore.presence).toBe('NO_INTEGRADO')
      expect(cards[group.recommendation]).toBe('No disponible')
      expect(text).toMatch(new RegExp(`${group.recommendation}\\s+No disponible\\s+No disponible\\s+No disponible\\s+No disponible: no se pudieron leer los datos\\.`))
    }
    const unavailable = summary.find(group => group.interventionCode === null)!
    expect(unavailable.count).toBe(failure === 'debtor' ? null : mapped.debtors.length)
    expect(unavailable.cases).toEqual(mapped.debtors)
    expect(cards['No disponible']).toBe(failure === 'debtor' ? 'No disponible' : '1')
    expect(mapDashboardMetricsFromDebtorObjects(mapped).byRecommendation).toEqual(failure === 'debtor' ? [] : [{ label: 'No disponible', value: 1 }])
    expect(textFromReactTree(await HomePage())).toMatch(/Mejorar datos\s+No disponible\s+Revisión jurídica/)
  })

  it('un objeto parcial evaluado conserva su cola y los bloqueados se cuentan aparte', async () => {
    const raw = buildPresenceRawData()
    raw.batch = { as_of: '2026-09-30' }
    Object.assign(raw.debts[0], { current_amount: 100, due_date: '2026-09-01' })
    raw.debts.push({ id: 802, debtor: 901, current_amount: null, due_date: '2026-09-01' })
    raw.debtors.push({ id: 902, external_id: 'SINTETICO-BLOQUEADO', type: 6 })
    // Cada importe es válido; su suma supera el entero seguro de centavos.
    raw.debts.push(...[803, 804].map(id => ({ id, debtor: 902, current_amount: 50000000000000, due_date: '2026-09-01' })))
    const mapped = configure(buildPresencePeopleData(), raw)
    expect(mapped.debtors[0].decision?.severidad.estado).toBe('PARCIAL')
    expect(mapped.debtors[1].decision).toBeNull()
    const summary = buildRecommendationSummary(mapped.debtors, raw.warnings)
    expect(summary.find(group => group.recommendation === 'Seguimiento')).toMatchObject({ count: 1, debtAssociated: 100, averageRisk: 20, cases: [mapped.debtors[0]] })
    expect(summary.find(group => group.interventionCode === null)).toMatchObject({ count: 1, cases: [mapped.debtors[1]] })
    expect(summary.every(group => group.count === group.cases.length)).toBe(true)
    const page = await RecommendedActionsPage()
    expect(cardValues(page)).toMatchObject({ Seguimiento: '1', 'No disponible': '1', 'Mejorar datos': '0' })
    expect(textFromReactTree(page).replace(/(?:[\d.]+ de [\d.]+ objetos con dato(?:; [\d.]+ parciales)?\.|Cobertura no disponible: lectura fallida o selección incompleta\.)/g, '')).toMatch(/Seguimiento\s+1\s+\$\s*100\s+20\.0 de 100/)
    expect(textFromReactTree(page)).toMatch(/Total registrado\s+\$\s*[\d.]+\s+Faltantes: 1 dato no informado en el archivo de origen/)
    expect(mapDashboardMetricsFromDebtorObjects(mapped).byRecommendation).toContainEqual({ label: 'Seguimiento', value: 1 })
  })

  it('reglas 1.1.0: una falla de debt_status no se vuelve «no pagada»: sin decisión, colas no disponibles', async () => {
    const raw = buildPresenceRawData()
    raw.warnings = [{ table: 'debt_status', message: 'Fallo sintético', needsSelectPolicy: false }]
    const mapped = configure(buildPresencePeopleData(), raw)
    expect(mapped.debtors.every(debtor => debtor.decision === null)).toBe(true)
    expect(buildRecommendationSummary(mapped.debtors, raw.warnings).filter(group => group.interventionCode !== null).every(group => group.count === null)).toBe(true)
    expect(cardValues(await RecommendedActionsPage())).toMatchObject({ Seguimiento: 'No disponible', 'Mejorar datos': 'No disponible' })
  })

  it.each(['person', 'debtor_profile'])('una falla de %s no oculta las colas v1 conocidas', async table => {
    const raw = buildPresenceRawData()
    raw.warnings = [{ table, message: 'Fallo sintético', needsSelectPolicy: false }]
    const mapped = configure(buildPresencePeopleData(), raw)
    const summary = buildRecommendationSummary(mapped.debtors, raw.warnings)
    expect(summary.every(group => group.count === group.cases.length)).toBe(true)
    expect(mapDashboardMetricsFromDebtorObjects(mapped).byRecommendation).toContainEqual({ label: 'Seguimiento', value: 1 })
    expect(cardValues(await RecommendedActionsPage())).toMatchObject({ Seguimiento: '1', 'Mejorar datos': '0' })
    expect(textFromReactTree(await HomePage())).toMatch(/Seguimiento\s+1 caso\s*\(\s*100%\s*\)/)
  })

  it('una cartera R2 conserva conteos de colas aunque no tenga puntajes', async () => {
    const raw = buildPresenceRawData()
    raw.debts[0].current_amount = null
    const mapped = configure(buildPresencePeopleData(), raw)
    expect(mapped.debtors[0].decision?.intervencion.regla).toBe('R2')
    expect(mapped.debtors[0].priorityScore).toBeNull()
    const buckets = mapDashboardMetricsFromDebtorObjects(mapped).byRecommendation
    expect(buckets.map(bucket => bucket.label)).toEqual(RECOMMENDATION_KINDS)
    expect(buckets.find(bucket => bucket.label === 'Mejorar datos')?.value).toBe(1)
    expect(textFromReactTree(await HomePage())).toMatch(/Mejorar datos\s+1 caso\s*\(\s*100%\s*\)/)
    expect(cardValues(await RecommendedActionsPage())['Mejorar datos']).toBe('1')
  })

  // N7: reemplaza a la prueba del empate (la frase dominante se retiró). El grupo «No disponible»
  // solo aparece si tiene casos; los rótulos del DTO anterior no se muestran como grupos.
  it('el grupo «No disponible» solo aparece con casos, y no hay grupos con rótulos anteriores', async () => {
    const dashboard = buildDashboard()
    getDashboardData.mockResolvedValue({ dashboard, warnings: [] })
    let markup = renderedText(await HomePage())
    expect(markup).not.toMatch(/No disponible\s+\d+ casos?\s*\(/)
    expect(markup).not.toMatch(/Llamado prioritario|Mensaje recordatorio|Seguimiento posterior/)
    dashboard.byRecommendation.push({ label: 'No disponible', value: 1 })
    markup = renderedText(await HomePage())
    expect(markup).toMatch(/No disponible\s+1 caso\s*\(\s*33%\s*\)/)
  })

  it('no muestra una deuda cero cuando falla su lectura, incluso en personas filtradas sin resultados', async () => {
    const peopleRaw = buildPresencePeopleData()
    const debtorRaw = buildPresenceRawData()
    const warning = { table: 'debt', message: 'Fallo sintético de lectura', needsSelectPolicy: false }
    peopleRaw.warnings = [warning]; debtorRaw.warnings = [warning]
    configure(peopleRaw, debtorRaw)
    const cards = cardValues(await HomePage())
    expect(cards['Total registrado']).toBe('No disponible')
    expect(cards['Deuda pendiente']).toBe('No disponible')
    expect(cards['Deuda vencida']).toBe('No disponible')
    expect(cards['Casos con deuda vencida']).toBe('No disponible')
    const text = renderedText(await PeoplePage({ searchParams: Promise.resolve({ q: 'no existe' }) }))
    expect(text).toMatch(/Total registrado asociado\s*No disponible/)
    expect(text).not.toMatch(/Total registrado asociado\s*\$\s*0/)
    expect(text).toContain('No se pudieron leer algunos datos')
  })

  it('mantiene no disponible en KPI dependientes ante un error de universo', async () => {
    const raw = buildPresenceRawData()
    raw.debtors = []
    raw.warnings = [{ table: 'debtor', message: 'Fallo sintético', needsSelectPolicy: false }]
    configure(buildPresencePeopleData(), raw)
    expect(cardValues(await DebtAgingPage({ searchParams: Promise.resolve({}) }))['Total registrado']).toBe('No disponible')
    const noContact = cardValues(await NoContactPage({ searchParams: Promise.resolve({}) }))
    expect(Object.values(noContact).filter(value => value === 'No disponible').length).toBeGreaterThanOrEqual(3)
    const recommended = cardValues(await RecommendedActionsPage())
    expect(Object.values(recommended).every(value => value === 'No disponible')).toBe(true)
    const risk = textFromReactTree(await RiskAnalysisPage())
    expect(risk).toContain('No disponible')
    expect(textFromReactTree(await PriorityCasesPage({ searchParams: Promise.resolve({}) }))).toContain('No disponible')
  })

  it('no inventa porcentajes ni recomendación dominante en un universo vacío', async () => {
    const raw = buildPresenceRawData(); raw.debtors = []
    configure(buildPresencePeopleData(), raw)
    const text = renderedText(await HomePage())
    expect(text).toContain('Sin casos en la selección.')
    expect(text).not.toMatch(/\b0% de los casos|concentra/)
  })

  it('puede contar cero objetos de severidad alta sin perfil cuando las obligaciones son evaluables', async () => {
    const home = await HomePage()
    expect(cardValues(home)['Casos con puntaje alto']).toBe('0')
    expect(renderedText(home)).toMatch(/(?:^|\s)0%\s*de los casos/)
    const raw = buildPresenceRawData()
    raw.debts[0].current_amount = null
    configure(buildPresencePeopleData(), raw)
    const unavailable = await HomePage()
    expect(cardValues(unavailable)['Casos con puntaje alto']).toBe('No disponible')
    expect(renderedText(unavailable)).toContain('Porcentaje no disponible.')
    expect(renderedText(unavailable)).not.toMatch(/(?:^|\s)0%\s*de los casos/)
  })

  it('un filtro de riesgo cuya lectura falla no produce deuda cero', async () => {
    const raw = buildPresencePeopleData()
    raw.warnings = [{ table: 'debtor_profile_detail', message: 'Fallo sintético', needsSelectPolicy: false }]
    configure(raw)
    const text = renderedText(await PeoplePage({ searchParams: Promise.resolve({ risk: 'ALTO' }) }))
    expect(text).toMatch(/Total registrado asociado\s*No disponible/)
    expect(text).not.toMatch(/Total registrado asociado\s*\$\s*0/)
    expect(text).toContain('No se pudo leer el índice anterior por persona')
  })

  it('informa un monto mínimo inválido sin atribuirlo a los datos', async () => {
    expect(textFromReactTree(await PriorityCasesPage({ searchParams: Promise.resolve({ minAmount: 'abc' }) }))).toContain('Monto mínimo inválido')
  })
})
