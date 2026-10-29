import { isValidElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDashboard, buildIncompleteStatusRawData, buildPresencePeopleData, buildPresenceRawData } from '@/tests/helpers/equitas-fixtures'
import { textFromReactTree } from '@/tests/helpers/react-tree'
import { mapPeopleFromRawData } from '@/lib/mappers/person-risk-mapper'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { mapDashboardMetricsFromDebtorObjects } from '@/lib/mappers/dashboard-metrics-mapper'

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
    expect(text).toContain('No disponible')
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

  it('excluye No disponible del empate de recomendaciones en el caso con perfil', async () => {
    const raw = buildIncompleteStatusRawData()
    raw.debtorProfiles = raw.debtors.map(debtor => ({ debtor: debtor.id, socioeconomic_risk_level: 80 }))
    configure(buildPresencePeopleData(), raw)
    const text = textFromReactTree(await HomePage())
    expect(text).toContain('"Llamado prioritario" concentra 50%')
    expect(text).not.toContain('Empate:')
    expect(text).toContain('Prioridad: 1 NO_INFORMADO_EN_ORIGEN')
    expect(text).toContain('Recomendación urgente: 1 NO_INFORMADO_EN_ORIGEN')
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

  it('no presenta 0 % de riesgo alto cuando ningún objeto tiene perfil', async () => {
    const text = textFromReactTree(await HomePage())
    expect(text).toMatch(/No disponible\s*de los objetos/ )
    expect(text).not.toMatch(/0%\s*de los objetos/)
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
