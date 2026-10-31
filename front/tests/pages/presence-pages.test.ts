import { isValidElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDashboard, buildIncompleteStatusRawData, buildPresencePeopleData, buildPresenceRawData } from '@/tests/helpers/equitas-fixtures'
import { textFromReactTree } from '@/tests/helpers/react-tree'
import { mapPeopleFromRawData } from '@/lib/mappers/person-risk-mapper'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { mapDashboardMetricsFromDebtorObjects } from '@/lib/mappers/dashboard-metrics-mapper'
import { buildRecommendationSummary, RECOMMENDATION_KINDS } from '@/lib/equitas-view-selectors'

const { getPeopleData, getDebtorsData, getDashboardData } = vi.hoisted(() => ({
  getPeopleData: vi.fn(), getDebtorsData: vi.fn(), getDashboardData: vi.fn(),
}))
vi.mock('@/lib/equitas-data', () => ({ getPeopleData, getDebtorsData, getDashboardData }))

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
  return objects
}

describe('ALIGN-011: cálculos y valores visibles de las páginas', () => {
  beforeEach(() => { vi.clearAllMocks(); configure() })

  it('deduplica la deuda filtrada de dos personas/un objeto y señala exposición no aditiva', async () => {
    const raw = buildPresencePeopleData()
    raw.debts[0].current_amount = 125
    configure(raw)
    let text = textFromReactTree(await PeoplePage({ searchParams: Promise.resolve({}) }))
    expect(text).toContain('Personas / Deudores')
    expect(text).toMatch(/Deuda asociada\s*\$\s*125/)
    expect(text).not.toMatch(/\$\s*250/)
    expect(text).toContain('Exposición asociada (no aditiva)')
    expect(text).toContain('No disponible')
    text = textFromReactTree(await PeoplePage({ searchParams: Promise.resolve({ q: 'sintética A', risk: 'BAJO' }) }))
    expect(text).toMatch(/Deuda asociada\s*\$\s*125/)
    expect(text).not.toContain('Persona sintética B')
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
      const text = textFromReactTree(await PeoplePage({ searchParams: Promise.resolve({ page }) }))
      expect(text).toMatch(/Deuda asociada\s*\$\s*125/)
    }
  })

  it('muestra suma cero y promedio no aplica en un filtro vacío', async () => {
    const text = textFromReactTree(await PeoplePage({ searchParams: Promise.resolve({ q: 'no existe' }) }))
    expect(text).toMatch(/Deuda asociada\s*\$\s*0/)
    expect(text).toContain('No aplica')
  })

  it('muestra etiqueta Vencida del catálogo en la lista de objetos', async () => {
    const text = textFromReactTree(await DebtorsPage({ searchParams: Promise.resolve({}) }))
    expect(text).toContain('Vencida')
    expect(text).toContain('Seguimiento')
    expect(text).toContain('corte de origen no informado')
  })

  it('muestra los $50 vencidos observados y el estado faltante, sin fabricar KPI cero', async () => {
    configure(buildPresencePeopleData(), buildIncompleteStatusRawData())
    const home = await HomePage()
    const aging = await DebtAgingPage({ searchParams: Promise.resolve({}) })
    expect(cardValues(home)['Casos vencidos']).toBe('1')
    expect(textFromReactTree(home)).toContain('Casos vencidos: 1 NO_INFORMADO_EN_ORIGEN')
    expect(cardValues(aging)['Deuda vencida']).toMatch(/\$\s*50/)
    expect(textFromReactTree(aging)).toContain('Deuda vencida: 1 NO_INFORMADO_EN_ORIGEN')
  })

  it('muestra no disponible cuando el único estado es desconocido', async () => {
    const raw = buildPresenceRawData()
    raw.debts[0].status = 8
    raw.debts[0].current_amount = 70
    configure(buildPresencePeopleData(), raw)
    const home = await HomePage()
    const aging = await DebtAgingPage({ searchParams: Promise.resolve({}) })
    expect(cardValues(home)['Casos vencidos']).toBe('No disponible')
    expect(cardValues(aging)['Deuda vencida']).toBe('No disponible')
    expect(textFromReactTree(home)).toContain('Casos vencidos: 1 NO_INFORMADO_EN_ORIGEN')
    expect(textFromReactTree(aging)).toContain('Deuda vencida: 1 NO_INFORMADO_EN_ORIGEN')
  })

  it('las intervenciones v1 reemplazan las del perfil y conservan los faltantes del objeto parcial', async () => {
    const raw = buildIncompleteStatusRawData()
    raw.debtorProfiles = raw.debtors.map(debtor => ({ debtor: debtor.id, socioeconomic_risk_level: 80 }))
    configure(buildPresencePeopleData(), raw)
    const text = textFromReactTree(await HomePage())
    expect(text).toContain('Empate: Revisión jurídica, Seguimiento concentra 50%')
    expect(text).not.toContain('Revisión jurídica, No disponible')
    expect(text).toContain('Prioridad: 1 NO_INFORMADO_EN_ORIGEN')
    expect(text).toContain('Revisión requerida: 1 NO_INFORMADO_EN_ORIGEN')
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
    expect(textFromReactTree(await HomePage())).toMatch(/Mejorar datos\s+No disponible\s+casos/)
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
    const text = textFromReactTree(page)
    for (const group of summary.filter(item => item.interventionCode !== null)) {
      expect(group).toMatchObject({ count: null, cases: [], highlightedCases: [], debtAssociated: null, averageRisk: null })
      expect(group.metrics.totalDebt.presence).toBe('NO_INTEGRADO')
      expect(group.metrics.riskScore.presence).toBe('NO_INTEGRADO')
      expect(cards[group.recommendation]).toBe('No disponible')
      expect(text).toMatch(new RegExp(`${group.recommendation}\\s+No disponible\\s+No disponible\\s+No disponible\\s*/\\s*100`))
    }
    const unavailable = summary.find(group => group.interventionCode === null)!
    expect(unavailable.count).toBe(failure === 'debtor' ? null : mapped.debtors.length)
    expect(unavailable.cases).toEqual(mapped.debtors)
    expect(cards['No disponible']).toBe(failure === 'debtor' ? 'No disponible' : '1')
    expect(mapDashboardMetricsFromDebtorObjects(mapped).byRecommendation).toEqual([])
    expect(textFromReactTree(await HomePage())).toMatch(/Mejorar datos\s+No disponible\s+casos/)
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
    expect(textFromReactTree(page)).toMatch(/Seguimiento\s+1\s+\$\s*100\s+20\.0\s*\/\s*100/)
    expect(textFromReactTree(page)).toContain('Deuda total: 1 NO_INFORMADO_EN_ORIGEN')
    expect(mapDashboardMetricsFromDebtorObjects(mapped).byRecommendation).toContainEqual({ label: 'Seguimiento', value: 1 })
  })

  it.each(['person', 'debtor_profile', 'debt_status'])('una falla de %s no oculta las colas v1 conocidas', async table => {
    const raw = buildPresenceRawData()
    raw.warnings = [{ table, message: 'Fallo sintético', needsSelectPolicy: false }]
    const mapped = configure(buildPresencePeopleData(), raw)
    const summary = buildRecommendationSummary(mapped.debtors, raw.warnings)
    expect(summary.every(group => group.count === group.cases.length)).toBe(true)
    expect(mapDashboardMetricsFromDebtorObjects(mapped).byRecommendation).toContainEqual({ label: 'Seguimiento', value: 1 })
    expect(cardValues(await RecommendedActionsPage())).toMatchObject({ Seguimiento: '1', 'Mejorar datos': '0' })
    expect(textFromReactTree(await HomePage())).toMatch(/Seguimiento\s+1\s+casos\s*\(\s*100%\s*\)/)
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
    expect(textFromReactTree(await HomePage())).toMatch(/Mejorar datos\s+1\s+casos\s*\(\s*100%\s*\)/)
    expect(cardValues(await RecommendedActionsPage())['Mejorar datos']).toBe('1')
  })

  it('declara un empate real solamente entre categorías de recomendación', async () => {
    const dashboard = buildDashboard()
    dashboard.byRecommendation.push({ label: 'No disponible', value: 1 })
    getDashboardData.mockResolvedValue({ dashboard, warnings: [] })
    const text = textFromReactTree(await HomePage())
    expect(text).toContain('Empate: Llamado prioritario, Mensaje recordatorio, Seguimiento posterior concentra')
    expect(text).not.toContain('Seguimiento posterior, No disponible')
  })

  it('no muestra una deuda cero cuando falla su lectura, incluso en personas filtradas sin resultados', async () => {
    const peopleRaw = buildPresencePeopleData()
    const debtorRaw = buildPresenceRawData()
    const warning = { table: 'debt', message: 'Fallo sintético de lectura', needsSelectPolicy: false }
    peopleRaw.warnings = [warning]; debtorRaw.warnings = [warning]
    configure(peopleRaw, debtorRaw)
    const cards = cardValues(await HomePage())
    expect(cards['Deuda total']).toBe('No disponible')
    expect(cards['Casos vencidos']).toBe('No disponible')
    const text = textFromReactTree(await PeoplePage({ searchParams: Promise.resolve({ q: 'no existe' }) }))
    expect(text).toMatch(/Deuda asociada\s*No disponible/)
    expect(text).not.toMatch(/Deuda asociada\s*\$\s*0/)
  })

  it('mantiene no disponible en KPI dependientes ante un error de universo', async () => {
    const raw = buildPresenceRawData()
    raw.debtors = []
    raw.warnings = [{ table: 'debtor', message: 'Fallo sintético', needsSelectPolicy: false }]
    configure(buildPresencePeopleData(), raw)
    expect(cardValues(await DebtAgingPage({ searchParams: Promise.resolve({}) }))['Deuda total']).toBe('No disponible')
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
    const text = textFromReactTree(await HomePage())
    expect(text).toContain('No aplica')
    expect(text).toContain('Sin datos suficientes')
    expect(text).not.toContain('concentra 0%')
  })

  it('puede contar cero objetos de severidad alta sin perfil cuando las obligaciones son evaluables', async () => {
    const text = textFromReactTree(await HomePage())
    expect(text).toMatch(/(?:^|\s)0%\s*de los objetos/)
    const raw = buildPresenceRawData()
    raw.debts[0].current_amount = null
    configure(buildPresencePeopleData(), raw)
    const unavailable = textFromReactTree(await HomePage())
    expect(unavailable).toMatch(/No disponible\s*de los objetos/)
    expect(unavailable).not.toMatch(/(?:^|\s)0%\s*de los objetos/)
  })

  it('un filtro de riesgo cuya lectura falla no produce deuda cero', async () => {
    const raw = buildPresencePeopleData()
    raw.warnings = [{ table: 'debtor_profile_detail', message: 'Fallo sintético', needsSelectPolicy: false }]
    configure(raw)
    const text = textFromReactTree(await PeoplePage({ searchParams: Promise.resolve({ risk: 'ALTO' }) }))
    expect(text).toMatch(/Deuda asociada\s*No disponible/)
    expect(text).not.toMatch(/Deuda asociada\s*\$\s*0/)
  })

  it('informa un monto mínimo inválido sin atribuirlo a los datos', async () => {
    expect(textFromReactTree(await PriorityCasesPage({ searchParams: Promise.resolve({ minAmount: 'abc' }) }))).toContain('Monto mínimo inválido')
  })
})
