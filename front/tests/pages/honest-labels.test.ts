import { isValidElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Card } from '@/components/ui/card'
import { TabsContent } from '@/components/ui/tabs'
import { DataWarnings } from '@/components/equitas/data-warnings'
import { RiskBadge } from '@/components/equitas/risk-badge'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { mapDashboardMetricsFromDebtorObjects } from '@/lib/mappers/dashboard-metrics-mapper'
import { mapPeopleFromRawData } from '@/lib/mappers/person-risk-mapper'
import { getDebtorDetailDataFromService } from '@/lib/services/debtor-data-service'
import { buildPresencePeopleData, buildPresenceRawData } from '@/tests/helpers/equitas-fixtures'
import { textFromReactTree as treeText } from '@/tests/helpers/react-tree'

const { loadRawDebtorData, getDebtorDetailData, getDebtorsData, getPeopleData, getDashboardData } = vi.hoisted(() => ({
  loadRawDebtorData: vi.fn(), getDebtorDetailData: vi.fn(), getDebtorsData: vi.fn(),
  getPeopleData: vi.fn(), getDashboardData: vi.fn(),
}))
vi.mock('@/lib/data/raw-debtor-loader', () => ({ loadRawDebtorData }))
vi.mock('@/lib/equitas-data', () => ({ getDebtorDetailData, getDebtorsData, getPeopleData, getDashboardData }))

import DebtorDetailPage from '@/app/debtors/[debtorId]/page'
import HomePage from '@/app/page'
import LoginPage from '@/app/login/page'
import PeoplePage from '@/app/people/page'
import RiskAnalysisPage from '@/app/risk-analysis/page'

type NodeProps = { children?: ReactNode; value?: string; title?: string; score?: number | null }
const textFromReactTree = (node: ReactNode) => treeText(node).replace(/\s+/g, ' ').trim()
function nodesOfType(node: ReactNode, type: unknown): React.ReactElement<NodeProps>[] {
  if (Array.isArray(node)) return node.flatMap(child => nodesOfType(child, type))
  if (!isValidElement<NodeProps>(node)) return []
  return [...(node.type === type ? [node] : []), ...nodesOfType(node.props.children, type)]
}

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

function configureLists(raw = rawObject()) {
  const mapped = mapDebtorObjectsFromRawData(raw)
  const people = mapPeopleFromRawData(buildPresencePeopleData())
  getDebtorsData.mockResolvedValue({ debtors: mapped.debtors, warnings: raw.warnings })
  getPeopleData.mockResolvedValue({ people: people.people, peopleDashboard: people.dashboard, warnings: [] })
  getDashboardData.mockResolvedValue({ dashboard: mapDashboardMetricsFromDebtorObjects(mapped), warnings: raw.warnings })
}

function tabText(page: ReactNode, value: string) {
  return textFromReactTree(nodesOfType(page, TabsContent).find(node => node.props.value === value))
}

describe('ALIGN-012: etiquetas honestas con datos sintéticos', () => {
  beforeEach(() => { vi.clearAllMocks(); configureLists() })

  it('conserva los títulos de SMOKE-01 y explica la exposición y el índice heredado por persona', async () => {
    const people = await PeoplePage({ searchParams: Promise.resolve({}) })
    expect(nodesOfType(people, 'h1').map(textFromReactTree)).toContain('Personas / Deudores')
    expect(nodesOfType(await HomePage(), 'h1').map(textFromReactTree)).toContain('Dashboard ejecutivo')
    const text = textFromReactTree(people)
    expect(text).toContain('objetos vinculados')
    expect(text).toContain('máxima severidad entre ellos')
    expect(text).toContain('Exposición no aditiva')
    expect(text).toContain('Exposición asociada (no aditiva)')
    expect(text).toContain('Puntaje (puntos de 0 a 100)')
    expect(text).toContain('no son probabilidades de pago')
    expect(text).not.toMatch(/riesgo individual|riesgo alto|riesgo medio|riesgo bajo|deuda total asociada|seguimiento individual/i)
  })

  it('separa severidad v1, índice heredado no disponible y vulnerabilidad no informada', async () => {
    const raw = rawObject()
    raw.debtorProfiles = [{ debtor: 901, socioeconomic_risk_level: 99 }]
    const page = await detailPage(raw)
    const text = textFromReactTree(page)
    expect(text).toContain('Severidad del objeto (v1)')
    expect(text).toContain('puntos de 0 a 100; no son porcentajes ni probabilidades de pago')
    expect(text).toContain('Vulnerabilidad: no informada')
    expect(text).toContain('Prioridad dentro de su cola (puntos de 0 a 100)')
    expect(text).toContain('Porcentaje declarado en origen')
    expect(text).toContain('ID externo de la obligación')
    expect(text).not.toMatch(/Nivel socioeconomico|Prioridad de contacto|\bPeriodo\b|\bscore\b|Perfil\/Riesgo/i)
    const legacy = nodesOfType(page, Card).find(card => textFromReactTree(card).includes('Índice heredado de severidad (no social)'))!
    expect(textFromReactTree(legacy)).toContain('No disponible')
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

  it.each([[50, 50], [0, 100], [33.33, 66.67], [49.995, 50], [50.01, 50]])('respeta ceros y tolerancia del contrato en %j', async (first, second) => {
    const raw = rawObject()
    raw.debtorPeople[0].priority = first
    raw.debtorPeople[1].priority = second
    const text = tabText(await detailPage(raw), 'people')
    expect(text).not.toContain('no 100%')
    expect(text).not.toContain('No se puede verificar la suma')
    if (first === 0) expect(text).toMatch(/SINTETICO-A\s+0\s+SINTETICO/)
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
    expect(textFromReactTree(page)).not.toContain('no se pudieron leer los datos necesarios')
  })

  it.each(['debtor_person', 'debtor_contact', 'person', 'debt'])('no afirma ausencia ante lectura fallida de %s', async table => {
    const raw = rawObject()
    raw.warnings = [{ table, message: 'Fallo sintético de lectura', needsSelectPolicy: false }]
    if (table === 'debtor_person') raw.debtorPeople = []
    if (table === 'debtor_contact') raw.debtorContacts = []
    if (table === 'person') { raw.people = []; raw.debtorPeople = [] }
    if (table === 'debt') raw.debts = []
    const page = await detailPage(raw)
    if (table === 'debtor_person' || table === 'person') {
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
    const text = textFromReactTree(page)
    if (table === 'debt' || table === 'debtor_person') {
      expect(text).toContain('Decisión no disponible: no se pudieron leer los datos necesarios para evaluar este objeto')
      expect(text).not.toContain('LECTURA_FALLIDA')
    } else {
      // La regla v1 sigue evaluando cuando falla sólo el contacto o el catálogo de personas.
      expect(text).not.toContain('Decisión no disponible:')
    }
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
    expect(textFromReactTree(page)).not.toContain('Decisión no disponible:')
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
    const text = textFromReactTree(page)
    expect(text).toContain('Objetos con severidad mayor a 90 puntos')
    expect(text).toContain('Conteo de objetos con más de 90 puntos; excluye 90')
    expect(text).toContain('Objetos en banda alta, desde 70 puntos')
    expect(text).toContain('Hasta 10 objetos con severidad de 70 a 100 puntos')
    const cards = nodesOfType(page, Card)
    expect(textFromReactTree(cards[0])).toMatch(/Objetos con severidad mayor a 90 puntos\s+1\s+Conteo/)
    const high = cards.find(card => textFromReactTree(card).includes('Objetos en banda alta, desde 70 puntos'))!
    expect(nodesOfType(high, RiskBadge).map(node => node.props.score).sort()).toEqual([70, 80, 90, 95])
    expect(text).toContain('no son porcentajes ni probabilidades de pago')
    expect(text).not.toMatch(/riesgo individual|riesgo extremo|riesgo mayor a 90|\bscore\b/i)
  })

  it('rotula todos los ejemplos del ingreso y no afirma gestión realizada', async () => {
    const page = await LoginPage({ searchParams: Promise.resolve({}) })
    const text = textFromReactTree(page)
    expect(text).toContain('Ejemplo ilustrativo, no son datos')
    expect(text).toContain('Deuda de ejemplo')
    expect(text).not.toMatch(/Deuda gestionada|perfiles de riesgo|Distribucion de riesgo/i)
  })

  it.each([false, true])('los avisos de acceso no aconsejan abrir SELECT a anon (policy=%s)', needsSelectPolicy => {
    const text = textFromReactTree(DataWarnings({ warnings: [{ table: 'debt', message: 'Fallo sintético', needsSelectPolicy }] }))
    expect(text).toContain('Fallo sintético')
    expect(text).not.toMatch(/agregar policy|SELECT|anon|authenticated/)
    if (needsSelectPolicy) expect(text).toContain('Solicite al administrador que revise los permisos de su cuenta')
  })
})
