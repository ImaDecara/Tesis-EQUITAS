import { createElement, Fragment, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TabsContent } from '@/components/ui/tabs'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { mapDashboardMetricsFromDebtorObjects } from '@/lib/mappers/dashboard-metrics-mapper'
import { mapPeopleFromRawData } from '@/lib/mappers/person-risk-mapper'
import { buildQueueReconciliation } from '@/lib/equitas-view-selectors'
import { getDebtorDetailDataFromService } from '@/lib/services/debtor-data-service'
import type { DataWarning, RawDebtorDataBundle, RawRow } from '@/types/equitas-domain'

const { loadRawDebtorData, loadContactTypeCatalog, getDebtorDetailData, getDebtorsData, getPeopleData, getDashboardData } = vi.hoisted(() => ({
  loadRawDebtorData: vi.fn(), loadContactTypeCatalog: vi.fn(), getDebtorDetailData: vi.fn(),
  getDebtorsData: vi.fn(), getPeopleData: vi.fn(), getDashboardData: vi.fn(),
}))
vi.mock('@/lib/data/raw-debtor-loader', () => ({ loadRawDebtorData }))
vi.mock('@/lib/server/contact-type-catalog', () => ({ loadContactTypeCatalog }))
// La pestaña Revisión tiene sus propias pruebas (review-tab.test.ts).
vi.mock('@/lib/server/case-review-screen', () => ({ loadCaseReviewScreen: async () => ({ kind: 'restricted', message: 'Revisión fuera de esta prueba.' }) }))
vi.mock('@/lib/equitas-data', () => ({ getDebtorDetailData, getDebtorsData, getPeopleData, getDashboardData }))
// Se renderizan los componentes reales. Solo se reemplaza lo que exige navegador o sesión.
vi.mock('next/navigation', () => ({
  usePathname: () => '/', useRouter: () => ({ replace: () => undefined }),
  notFound: () => { throw new Error('notFound') },
}))
vi.mock('next/image', () => ({ default: () => null }))
// ALIGN-069: la auditoria tiene sus propias pruebas (access-audit.integration.test.ts).
vi.mock('@/lib/server/audit', () => ({ auditCaseOpen: async () => undefined }))
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/auth/login-form', () => ({ LoginForm: () => null }))

import DebtAgingPage from '@/app/debt-aging/page'
import DebtorDetailPage from '@/app/debtors/[debtorId]/page'
import DebtorsPage from '@/app/debtors/page'
import NoContactPage from '@/app/no-contact/page'
import HomePage from '@/app/page'
import PeoplePage from '@/app/people/page'
import PriorityCasesPage from '@/app/priority-cases/page'
import RecommendedActionsPage from '@/app/recommended-actions/page'
import RiskAnalysisPage from '@/app/risk-analysis/page'

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'" }
const textOf = (node: ReactNode) => renderToStaticMarkup(createElement(Fragment, null, node))
  .replace(/<[^>]*>/g, ' ').replace(/&(?:amp|lt|gt|quot|#x27);/g, entity => ENTITIES[entity]).replace(/\s+/g, ' ').trim()

type NodeProps = { children?: ReactNode; value?: string }
function tabsOf(node: ReactNode): React.ReactElement<NodeProps>[] {
  if (Array.isArray(node)) return node.flatMap(tabsOf)
  if (!isValidElement<NodeProps>(node)) return []
  return [...(node.type === TabsContent ? [node] : []), ...tabsOf(node.props.children)]
}
const tabText = (page: ReactNode, value: string) => textOf(tabsOf(page).find(node => node.props.value === value)?.props.children)
// Toda la página: encabezado, tarjetas y las seis pestañas, no solo la pestaña del defecto.
const wholeDetail = (page: ReactNode) => [textOf(page), ...tabsOf(page).map(node => textOf(node.props.children))].join(' ')

const warning = (table: string): DataWarning => ({ table, message: 'Fallo sintético de lectura', needsSelectPolicy: false })
const CONTACT_CATALOG = [{ id: 910001, key: 'EMAIL', value: 'Email', active: true }]

// Misma forma que database/testing/fixtures.sql: los catálogos comparten la fila 910001.
function e06Raw(): RawDebtorDataBundle {
  return {
    batch: { as_of: '2026-09-30' },
    debtors: [{ id: 910001, tenant: 910001, external_id: 910001, type: 910001, identifier: 'TP-A', description: 'Objeto A sintetico', status: true }],
    debtorTypes: [{ id: 910001, key: 'TP', value: 'Objeto de prueba', active: true }],
    debts: [{ id: 910001, external_id: 910001, debtor: 910001, original_amount: 1250, current_amount: 1250, currency: 910001, status: 910001, due_date: '2026-06-01' }],
    debtStatuses: [{ id: 910001, key: 'OVERDUE', value: 'Vencida', active: true }],
    debtorPeople: [{ id: 910001, debtor: 910001, person: 910001, role: 'Titular', priority: 100, active: true }],
    people: [{ id: 910001, external_id: 910001, full_name: 'Persona sintetica A', document_type: 910001, type: 910001, status: 910001 }],
    debtorContacts: [{ id: 910001, person: 910001, type: 910001, value: 'persona-a@example.test', active: true }],
    debtorProfiles: [],
    warnings: [],
  }
}

async function detailPage(raw: RawDebtorDataBundle, catalog: { rows: RawRow[]; warning: DataWarning | null } = { rows: CONTACT_CATALOG, warning: null }) {
  loadRawDebtorData.mockResolvedValue(raw)
  loadContactTypeCatalog.mockResolvedValue(catalog)
  getDebtorDetailData.mockResolvedValue(await getDebtorDetailDataFromService('910001'))
  return DebtorDetailPage({ params: Promise.resolve({ debtorId: '910001' }) })
}

function configureLists(raw: RawDebtorDataBundle) {
  const mapped = mapDebtorObjectsFromRawData(raw)
  const people = mapPeopleFromRawData({ ...raw, debtorProfilesDetail: [] })
  getDebtorsData.mockResolvedValue({ debtors: mapped.debtors, warnings: raw.warnings })
  getPeopleData.mockResolvedValue({ people: people.people, peopleDashboard: people.dashboard, warnings: raw.warnings })
  getDashboardData.mockResolvedValue({ dashboard: mapDashboardMetricsFromDebtorObjects(mapped), warnings: raw.warnings })
  return mapped
}

beforeEach(() => vi.clearAllMocks())

describe('(a) vencimiento en la pestaña Deudas', () => {
  const originalTz = process.env.TZ
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ
    else process.env.TZ = originalTz
  })

  it.each([['America/Argentina/Cordoba', 180], ['UTC', 0], ['Asia/Tokyo', -540]] as const)('muestra el mismo día en TZ=%s', async (zone, offset) => {
    process.env.TZ = zone
    expect(new Date('2026-06-01T12:00:00.000Z').getTimezoneOffset()).toBe(offset)
    const debts = tabText(await detailPage(e06Raw()), 'debts')
    expect(debts).toContain('1/6/2026')
    expect(debts).not.toContain('31/5/2026')
  })

  it('una fecha faltante no se convierte en otra fecha', async () => {
    const raw = e06Raw()
    raw.debts[0].due_date = null
    expect(tabText(await detailPage(raw), 'debts')).toContain('Sin fecha')
  })
})

describe('(b) canal de contacto por catálogo', () => {
  it('muestra la etiqueta y ningún ID de catálogo en toda la página', async () => {
    const page = await detailPage(e06Raw())
    expect(tabText(page, 'contacts')).toMatch(/Persona sintetica A\s+Email\s+persona-a@example\.test\s+Activo/)
    const whole = wholeDetail(page)
    // Tarjetas y pestañas vecinas siguen resolviendo sus catálogos.
    expect(textOf(page)).toContain('Objeto de prueba')
    expect(tabText(page, 'debts')).toContain('Vencida')
    expect(whole).not.toContain('910001')
    expect(whole).not.toMatch(/Canal\s+\d/)
  })

  it('con la lectura del catálogo fallida: No disponible y aviso, sin ID ni inferencia', async () => {
    const page = await detailPage(e06Raw(), { rows: [], warning: warning('contact_type') })
    const contacts = tabText(page, 'contacts')
    expect(contacts).toMatch(/Persona sintetica A\s+No disponible\s+persona-a@example\.test/)
    expect(contacts).toContain('no se pudo leer el catálogo de tipos de contacto')
    expect(textOf(page)).toContain('contact_type: Fallo sintético de lectura')
    expect(wholeDetail(page)).not.toContain('910001')
    // La falla no se extiende: conserva lo que ya estaba resuelto.
    expect(tabText(page, 'debts')).toContain('Vencida')
    expect(textOf(page)).toContain('Objeto de prueba')
  })

  it('un tipo fuera de catálogo: No disponible, con aviso propio', async () => {
    const raw = e06Raw()
    raw.debtorContacts[0].type = 910099
    const page = await detailPage(raw)
    const contacts = tabText(page, 'contacts')
    expect(contacts).toMatch(/Persona sintetica A\s+No disponible\s+persona-a@example\.test/)
    expect(contacts).toContain('no figura en el catálogo')
    expect(wholeDetail(page)).not.toContain('910099')
  })

  it('un catálogo sin etiqueta legible no muestra el dato crudo', async () => {
    const page = await detailPage(e06Raw(), { rows: [{ id: 910001, key: 'EMAIL', value: '12345' }], warning: null })
    expect(tabText(page, 'contacts')).toMatch(/Persona sintetica A\s+No disponible/)
  })

  it('sin tipo conserva la inferencia por @, aunque el catálogo haya fallado', async () => {
    const raw = e06Raw()
    raw.debtorContacts = [
      { id: 1, person: 910001, type: null, value: 'sin-tipo@example.test', active: true },
      { id: 2, person: 910001, value: '3510000000', active: true },
    ]
    for (const catalog of [{ rows: CONTACT_CATALOG, warning: null }, { rows: [], warning: warning('contact_type') }]) {
      const contacts = tabText(await detailPage(raw, catalog), 'contacts')
      expect(contacts).toMatch(/Email\s+sin-tipo@example\.test/)
      expect(contacts).toMatch(/Telefono\s+3510000000/)
    }
  })

  it('una columna de canal con texto se conserva y un número en ella se resuelve como tipo', async () => {
    const raw = e06Raw()
    raw.debtorContacts = [
      { id: 1, person: 910001, channel: 'WhatsApp', value: '3510000001', active: true },
      { id: 2, person: 910001, channel: 910001, value: '3510000002', active: true },
    ]
    const contacts = tabText(await detailPage(raw), 'contacts')
    expect(contacts).toMatch(/WhatsApp\s+3510000001/)
    expect(contacts).toMatch(/Email\s+3510000002/)
  })

  // Dos tipos distintos con el mismo valor siguen siendo dos contactos: la etiqueta no decide KPI-07.
  it('la deduplicación compara el tipo, no la etiqueta: la falla del catálogo no cambia los conteos', async () => {
    const raw = e06Raw()
    raw.debtorContacts = [
      { id: 1, person: 910001, type: 910001, value: 'igual@example.test', active: true },
      { id: 2, person: 910001, type: 910002, value: 'igual@example.test', active: true },
      { id: 3, person: 910001, type: 910001, value: 'IGUAL@example.test', active: true },
    ]
    const both = [{ id: 910001, value: 'Email' }, { id: 910002, value: 'Email' }]
    for (const catalog of [{ rows: both, warning: null }, { rows: [], warning: warning('contact_type') }]) {
      loadRawDebtorData.mockResolvedValue(raw)
      loadContactTypeCatalog.mockResolvedValue(catalog)
      const { detail } = await getDebtorDetailDataFromService('910001')
      expect(detail?.contacts).toHaveLength(2)
      expect(detail?.debtor.contactCount).toBe(2)
      expect(detail?.profile.availableContacts).toBe(2)
    }
  })
})

const UNIT_ON_MISSING = /No (?:disponible|aplica)\s*(?:dias|días|casos|personas?\b|persona\(s\)|registros|objetos|%|\/\s*100\b|\/\s*(?:ALTA|MEDIA|BAJA)?\s*$|puntos|\(No disponible\)|de deuda|de los objetos|del saldo|de atraso)/

// Devuelve el fragmento exacto: la falla muestra qué frase quedó mal.
const unitOnMissing = (text: string) => text.match(UNIT_ON_MISSING)?.[0] ?? null

describe('(c) una unidad nunca acompaña a un valor faltante', () => {
  it('sin vencimiento: "No disponible" en días de atraso, antigüedad y lectura operativa', async () => {
    const raw = e06Raw()
    raw.debts[0].due_date = null
    const page = await detailPage(raw)
    expect(tabText(page, 'summary')).toMatch(/Dias de atraso:\s+No disponible\s+Estado/)
    expect(tabText(page, 'risk')).toMatch(/Antiguedad\s+No disponible/)
    const reading = tabText(page, 'recommendation')
    expect(reading).toContain('atraso: No disponible')
    expect(unitOnMissing(wholeDetail(page))).toBeNull()
  })

  it('con dato conserva la unidad en la misma pantalla', async () => {
    const page = await detailPage(e06Raw())
    expect(tabText(page, 'summary')).toMatch(/Dias de atraso:\s+121 dias/)
    expect(tabText(page, 'recommendation')).toContain('atraso: 121 dias')
    expect(tabText(page, 'recommendation')).toMatch(/deuda total: \$\s*1\.250/)
    expect(tabText(page, 'risk')).toMatch(/Antiguedad\s+\d+ dias/)
    expect(textOf(page)).toContain('1 persona(s) asociada(s)')
  })

  it('una lectura fallida tampoco arma la oración del caso con unidades ni ceros', async () => {
    const raw = e06Raw()
    raw.warnings = [warning('debt'), warning('debtor_person')]
    raw.debts = []
    raw.debtorPeople = []
    const page = await detailPage(raw)
    const reading = tabText(page, 'recommendation')
    expect(reading).toContain('deuda total: No disponible')
    expect(reading).toContain('atraso: No disponible')
    expect(reading).toContain('contacto: no disponible')
    expect(textOf(page)).not.toContain('persona(s) asociada(s)')
    expect(unitOnMissing(wholeDetail(page))).toBeNull()
  })

  const listPages: [string, () => Promise<ReactNode>][] = [
    ['/', () => HomePage()],
    ['/debtors', () => DebtorsPage({ searchParams: Promise.resolve({}) })],
    ['/priority-cases', () => PriorityCasesPage({ searchParams: Promise.resolve({}) })],
    ['/people', () => PeoplePage({ searchParams: Promise.resolve({}) })],
    ['/risk-analysis', () => RiskAnalysisPage()],
    ['/debt-aging', () => DebtAgingPage({ searchParams: Promise.resolve({}) })],
    ['/recommended-actions', () => RecommendedActionsPage()],
    ['/no-contact', () => NoContactPage({ searchParams: Promise.resolve({}) })],
  ]
  const ALL_TABLES = ['debtor', 'debtor_type', 'debt', 'debt_status', 'debtor_person', 'person', 'debtor_contact', 'debtor_profile', 'debtor_profile_detail']

  it.each(listPages)('%s sin ninguna lectura disponible', async (_, render) => {
    const raw = e06Raw()
    raw.warnings = ALL_TABLES.map(warning)
    raw.debtors = []; raw.debts = []; raw.debtorPeople = []; raw.people = []; raw.debtorContacts = []
    configureLists(raw)
    const text = textOf(await render())
    expect(text).toContain('No disponible')
    expect(unitOnMissing(text)).toBeNull()
  })

  it.each(listPages)('%s con objetos cuyo dato falta o no aplica', async (_, render) => {
    const raw = e06Raw()
    raw.debts = [{ id: 1, debtor: 910001, status: 910001, current_amount: null, due_date: null }]
    raw.debtors.push({ id: 910002, tenant: 910001, external_id: 910002, type: 910001, identifier: 'TP-B', status: true })
    raw.warnings = [warning('person')]
    configureLists(raw)
    expect(unitOnMissing(textOf(await render()))).toBeNull()
  })

  it.each([
    ['/', () => HomePage(), /Atraso|casos/],
    ['/debt-aging', () => DebtAgingPage({ searchParams: Promise.resolve({}) }), /Promedio de atraso\s+121 dias/],
    ['/priority-cases', () => PriorityCasesPage({ searchParams: Promise.resolve({}) }), /1 casos/],
    ['/no-contact', () => NoContactPage({ searchParams: Promise.resolve({}) }), /Total sin contacto/],
    ['/debtors', () => DebtorsPage({ searchParams: Promise.resolve({}) }), /1 \/ 1 registros/],
    ['/people', () => PeoplePage({ searchParams: Promise.resolve({}) }), /1 \/ 1 personas/],
  ] as [string, () => Promise<ReactNode>, RegExp][])('%s conserva títulos y unidades cuando hay dato', async (_, render, expected) => {
    configureLists(e06Raw())
    expect(textOf(await render())).toMatch(expected)
  })

  it('/debt-aging distingue "No aplica" sin unidad cuando no hay objetos con mora', async () => {
    const raw = e06Raw()
    raw.debts[0].current_amount = 0
    raw.debtStatuses = [{ id: 910001, key: 'PAID', value: 'Pagada' }]
    configureLists(raw)
    const text = textOf(await DebtAgingPage({ searchParams: Promise.resolve({}) }))
    expect(text).toMatch(/Promedio de atraso\s+No aplica\s+Sobre objetos con mora/)
  })

  it('el tablero arma sus oraciones solo con valores presentes', async () => {
    const raw = e06Raw()
    raw.warnings = ALL_TABLES.map(warning)
    raw.debtors = []; raw.debts = []; raw.debtorPeople = []; raw.people = []; raw.debtorContacts = []
    configureLists(raw)
    const text = textOf(await HomePage())
    expect(text).toContain('Objetos en riesgo alto: No disponible')
    expect(text).toContain('Concentración de los 5 objetos con mayor deuda: No disponible')
    expect(text).toContain('Casos bloqueados por falta de contacto: No disponible')
    configureLists(e06Raw())
    const present = textOf(await HomePage())
    expect(present).toMatch(/1 casos bloqueados por falta de contacto|0 casos bloqueados por falta de contacto/)
    expect(present).toContain('de los objetos estan en riesgo alto')
    expect(present).toContain('del saldo total')
  })

  it('/priority-cases no deja una banda vacía cuando falta la prioridad', async () => {
    const raw = e06Raw()
    raw.debts[0].current_amount = null
    configureLists(raw)
    const text = textOf(await PriorityCasesPage({ searchParams: Promise.resolve({}) }))
    expect(text).not.toMatch(/No disponible \/ /)
    configureLists(e06Raw())
    const present = textOf(await PriorityCasesPage({ searchParams: Promise.resolve({}) }))
    expect(present).toMatch(/\d+ \/ (?:ALTA|MEDIA|BAJA)/)
  })
})

// Fixture armado a mano. Corte 2026-09-30, sin perfil persistido: el total del tablero suma obligaciones.
//   Objeto A: 1000 con vencimiento + 300 sin vencimiento    -> cola 1000 / fuera 300 / tablero 1300
//   Objeto B:  500 con vencimiento futuro                   -> cola  500 / fuera   0 / tablero  500
//   Objeto C:  200 sin vencimiento                          -> cola    0 / fuera 200 / tablero  200
//   Objeto D: importe y vencimiento faltantes               -> cola    0 / fuera   ? / tablero    ?
//   Objeto E:  700 con vencimiento anterior a 1970          -> cola    0 / fuera 700 / tablero  700
//   Objeto F:  -50 con vencimiento válido (no evaluable)    -> cola    0 / fuera   0 / tablero  -50
// Suma de colas 1500; fuera 1200 en 4 objetos y 4 obligaciones (1 sin importe); tablero 2650;
// diferencia 1150; resto de la diferencia -50.
function handmadeRaw(): RawDebtorDataBundle {
  const ids = [1, 2, 3, 4, 5, 6]
  return {
    batch: { as_of: '2026-09-30' },
    debtors: ids.map(id => ({ id, tenant: 910001, external_id: id, type: 910001, identifier: `OBJ-${'ABCDEF'[id - 1]}`, status: true })),
    debtorTypes: [{ id: 910001, key: 'TP', value: 'Objeto de prueba' }],
    debts: [
      { id: 11, debtor: 1, current_amount: 1000, status: 910001, due_date: '2026-01-01' },
      { id: 12, debtor: 1, current_amount: 300, status: 910001, due_date: null },
      { id: 21, debtor: 2, current_amount: 500, status: 910001, due_date: '2026-12-01' },
      { id: 31, debtor: 3, current_amount: 200, status: 910001, due_date: null },
      { id: 41, debtor: 4, current_amount: null, status: 910001, due_date: null },
      { id: 51, debtor: 5, current_amount: 700, status: 910001, due_date: '1960-01-01' },
      { id: 61, debtor: 6, current_amount: -50, status: 910001, due_date: '2026-01-01' },
    ],
    debtStatuses: [{ id: 910001, key: 'OVERDUE', value: 'Vencida' }],
    debtorPeople: ids.map(id => ({ id, debtor: id, person: id, role: 'Titular', priority: 100, active: true })),
    people: ids.map(id => ({ id, external_id: id, full_name: `Persona sintetica ${id}` })),
    debtorContacts: ids.map(id => ({ id, person: id, type: 910001, value: `persona-${id}@example.test`, active: true })),
    debtorProfiles: [],
    warnings: [],
  }
}

describe('(d) /recommended-actions: lectura honesta del monto de cola', () => {
  it('coincide con el caso armado a mano en pantalla, junto al resto de la página', async () => {
    configureLists(handmadeRaw())
    const text = textOf(await RecommendedActionsPage())
    expect(text).toContain('Acciones recomendadas')
    expect(text).toContain('Resumen por recomendacion')
    expect(text).toMatch(/Suma de las colas\s+\$\s*1\.500/)
    expect(text).toMatch(/Deuda total del tablero\s+\$\s*2\.650\s+Faltantes: Deuda total: 1 NO_INFORMADO_EN_ORIGEN/)
    expect(text).toMatch(/Diferencia con el tablero\s+\$\s*1\.150/)
    expect(text).toMatch(/Importe sin vencimiento evaluable\s+\$\s*1\.200/)
    expect(text).toContain('4 objetos · 4 obligaciones')
    expect(text).toMatch(/Resto de la diferencia\s+-\s*\$\s*50/)
    expect(text).toContain('1 de esas obligaciones no tiene importe observado')
    expect(text).toContain('el tablero suma el total de cada objeto')
    expect(text).toContain('Cada cola suma el importe actual de las obligaciones evaluables')
    // Las tarjetas y la tabla vecinas siguen con el mismo cálculo de KPI-V1-05 y KPI-V1-06.
    expect(text).toMatch(/Seguimiento\s+2\s+\$\s*1\.500\s+Revisión|Seguimiento\s+2\s+\$\s*1\.500\s+No disponible/)
    expect(text).toMatch(/Seguimiento\s+2\s+\$\s*1\.500\s+17\.5 \/ 100\s+OBJ-A\s+OBJ-B/)
    expect(text).toMatch(/Mejorar datos\s+4\s+No disponible\s+No disponible\s+OBJ-C\s+OBJ-D\s+OBJ-E/)
    expect(text).toMatch(/Revisión jurídica\s+0\s+\$\s*0\s+No aplica\s+Sin casos/)
    expect(unitOnMissing(text)).toBeNull()
  })

  it('usa singular y plural en el detalle de lo que queda fuera', async () => {
    const raw = handmadeRaw()
    raw.debtors = raw.debtors.slice(0, 1)
    raw.debts = [
      { id: 12, debtor: 1, current_amount: 300, status: 910001, due_date: null },
      { id: 13, debtor: 1, current_amount: null, status: 910001, due_date: null },
      { id: 14, debtor: 1, current_amount: null, status: 910001, due_date: null },
    ]
    configureLists(raw)
    const text = textOf(await RecommendedActionsPage())
    expect(text).toContain('1 objeto · 3 obligaciones')
    expect(text).toContain('2 de esas obligaciones no tienen importe observado')
    raw.debts = raw.debts.slice(0, 1)
    configureLists(raw)
    expect(textOf(await RecommendedActionsPage())).toContain('1 objeto · 1 obligación')
  })

  it('cada cifra concuerda con el tablero y con los motivos de la regla', () => {
    const mapped = configureLists(handmadeRaw())
    const reconciliation = buildQueueReconciliation(mapped.debtors, [])
    expect(reconciliation.queueTotal.value).toBe(1500)
    expect(reconciliation.dashboardTotal.value).toBe(2650)
    expect(reconciliation.dashboardTotal.value).toBe(mapDashboardMetricsFromDebtorObjects(mapped).totalDebt)
    expect(reconciliation.difference.value).toBe(1150)
    expect(reconciliation.outsideAmount.value).toBe(1200)
    expect(reconciliation.outsideObjects).toBe(4)
    expect(reconciliation.outsideObligations).toBe(4)
    expect(reconciliation.outsideWithoutAmount).toBe(1)
    expect(reconciliation.otherDifference.value).toBe(-50)
    // Misma definición que evaluateSeverity: no puede desviarse de los motivos de la decisión.
    const byRule = mapped.debtors.flatMap(debtor => debtor.decision?.severidad.motivos_no_evaluables ?? [])
      .filter(item => item.motivo.startsWith('VENCIMIENTO')).reduce((sum, item) => sum + item.cantidad, 0)
    expect(reconciliation.outsideObligations).toBe(byRule)
  })

  it('un total persistido del perfil queda en el resto, no en el importe sin vencimiento', () => {
    const raw = handmadeRaw()
    raw.debtorProfiles = [{ id: 1, debtor: 2, total_debt_amount: 800 }]
    const mapped = configureLists(raw)
    const reconciliation = buildQueueReconciliation(mapped.debtors, [])
    expect(reconciliation.queueTotal.value).toBe(1500)
    expect(reconciliation.dashboardTotal.value).toBe(2950)
    expect(reconciliation.outsideAmount.value).toBe(1200)
    expect(reconciliation.otherDifference.value).toBe(250)
  })

  it('un cero es derivado cuando todo se leyó: sin faltantes, la diferencia es 0', async () => {
    const raw = handmadeRaw()
    raw.debts = raw.debts.filter(debt => debt.id === 11 || debt.id === 21)
    raw.debtors = raw.debtors.slice(0, 2)
    configureLists(raw)
    const text = textOf(await RecommendedActionsPage())
    expect(text).toMatch(/Suma de las colas\s+\$\s*1\.500/)
    expect(text).toMatch(/Importe sin vencimiento evaluable\s+\$\s*0/)
    expect(text).toContain('0 objetos · 0 obligaciones')
    expect(text).toMatch(/Resto de la diferencia\s+\$\s*0/)
  })

  it('sin ningún monto evaluable, la suma de las colas y sus restas quedan No disponible', async () => {
    const raw = handmadeRaw()
    raw.debtors = raw.debtors.slice(0, 1)
    raw.debts = [{ id: 12, debtor: 1, current_amount: 1250, status: 910001, due_date: null }]
    const mapped = configureLists(raw)
    const reconciliation = buildQueueReconciliation(mapped.debtors, [])
    // Las colas vacías no son observaciones: su cero no reemplaza al monto que falta (contrato §4.1, regla 4).
    expect(reconciliation.queueTotal.value).toBeNull()
    expect(reconciliation.dashboardTotal.value).toBe(1250)
    expect(reconciliation.difference.value).toBeNull()
    expect(reconciliation.outsideAmount.value).toBe(1250)
    expect(reconciliation.otherDifference.value).toBeNull()
    const text = textOf(await RecommendedActionsPage())
    expect(text).toMatch(/Suma de las colas\s+No disponible/)
    expect(text).toMatch(/Diferencia con el tablero\s+No disponible/)
    expect(text).toMatch(/Importe sin vencimiento evaluable\s+\$\s*1\.250/)
    expect(text).toMatch(/Resto de la diferencia\s+No disponible/)
  })

  it('la cartera vacía y el importe 0 observado siguen sumando 0', () => {
    const empty = handmadeRaw()
    empty.debtors = []
    empty.debts = []
    expect(buildQueueReconciliation(configureLists(empty).debtors, []).queueTotal)
      .toMatchObject({ value: 0, presence: 'OBSERVADO' })
    const zero = handmadeRaw()
    zero.debtors = zero.debtors.slice(0, 1)
    zero.debts = [{ id: 12, debtor: 1, current_amount: 0, status: 910001, due_date: '2026-06-01' }]
    expect(buildQueueReconciliation(configureLists(zero).debtors, []).queueTotal)
      .toMatchObject({ value: 0, presence: 'OBSERVADO' })
  })

  it('si las obligaciones fuera no traen importe, lo dice y no muestra $0', async () => {
    const raw = handmadeRaw()
    raw.debts = [{ id: 41, debtor: 4, current_amount: null, status: 910001, due_date: null }, { id: 11, debtor: 1, current_amount: 1000, status: 910001, due_date: '2026-01-01' }]
    const mapped = configureLists(raw)
    const reconciliation = buildQueueReconciliation(mapped.debtors, [])
    expect(reconciliation.outsideAmount).toMatchObject({ value: null, presence: 'NO_INFORMADO_EN_ORIGEN' })
    expect(reconciliation.otherDifference.value).toBeNull()
    const text = textOf(await RecommendedActionsPage())
    expect(text).toMatch(/Importe sin vencimiento evaluable\s+No disponible/)
    expect(text).toContain('1 de esas obligaciones no tiene importe observado')
    expect(text).not.toMatch(/Importe sin vencimiento evaluable\s+\$\s*0/)
    expect(text).toMatch(/Resto de la diferencia\s+No disponible/)
  })

  it.each(['debt', 'debtor', 'debtor_contact', 'debtor_person', 'as_of'])('con falla de %s no hay ceros ni importe cero fuera de las colas', async failure => {
    const raw = handmadeRaw()
    if (failure === 'as_of') raw.batch = { as_of: '2026-02-30' }
    else raw.warnings = [warning(failure)]
    if (failure === 'debt') raw.debts = []
    if (failure === 'debtor') raw.debtors = []
    if (failure === 'debtor_contact') raw.debtorContacts = []
    if (failure === 'debtor_person') raw.debtorPeople = []
    const mapped = configureLists(raw)
    const reconciliation = buildQueueReconciliation(mapped.debtors, raw.warnings)
    expect(reconciliation.queueTotal.value).toBeNull()
    expect(reconciliation.outsideAmount.value).toBeNull()
    expect(reconciliation.outsideObjects).toBeNull()
    expect(reconciliation.outsideObligations).toBeNull()
    expect(reconciliation.outsideWithoutAmount).toBeNull()
    expect(reconciliation.difference.value).toBeNull()
    expect(reconciliation.otherDifference.value).toBeNull()
    const text = textOf(await RecommendedActionsPage())
    expect(text).toMatch(/Suma de las colas\s+No disponible/)
    expect(text).toMatch(/Importe sin vencimiento evaluable\s+No disponible/)
    expect(text).toMatch(/Diferencia con el tablero\s+No disponible/)
    expect(text).toMatch(/Resto de la diferencia\s+No disponible/)
    expect(text).toContain('No se puede establecer qué queda fuera de las colas')
    expect(text).not.toMatch(/0 objetos|\$\s*0\b/)
    expect(unitOnMissing(text)).toBeNull()
  })

  it('con falla solo de perfiles: colas conocidas, tablero y diferencia no disponibles', async () => {
    const raw = handmadeRaw()
    raw.warnings = [warning('debtor_profile')]
    const mapped = configureLists(raw)
    const reconciliation = buildQueueReconciliation(mapped.debtors, raw.warnings)
    expect(reconciliation.queueTotal.value).toBe(1500)
    expect(reconciliation.outsideAmount.value).toBe(1200)
    expect(reconciliation.dashboardTotal.value).toBeNull()
    expect(reconciliation.otherDifference.value).toBeNull()
    const text = textOf(await RecommendedActionsPage())
    expect(text).toMatch(/Suma de las colas\s+\$\s*1\.500/)
    expect(text).toMatch(/Deuda total del tablero\s+No disponible/)
    expect(text).toMatch(/Diferencia con el tablero\s+No disponible/)
  })

  it('sin objetos leídos correctamente, los ceros son derivados', () => {
    const reconciliation = buildQueueReconciliation([], [])
    expect(reconciliation).toMatchObject({ outsideObjects: 0, outsideObligations: 0, outsideWithoutAmount: 0 })
    expect(reconciliation.queueTotal.value).toBe(0)
    expect(reconciliation.outsideAmount.value).toBe(0)
    expect(reconciliation.otherDifference.value).toBe(0)
  })

  it('no arrastra error de representación en centavos y no muestra -0', () => {
    const raw = handmadeRaw()
    raw.debtors = raw.debtors.slice(0, 1)
    raw.debts = [
      { id: 1, debtor: 1, current_amount: 0.1, status: 910001, due_date: '2026-01-01' },
      { id: 2, debtor: 1, current_amount: 0.2, status: 910001, due_date: null },
    ]
    const mapped = configureLists(raw)
    const reconciliation = buildQueueReconciliation(mapped.debtors, [])
    expect(reconciliation.difference.value).toBe(0.2)
    expect(Object.is(reconciliation.otherDifference.value, 0)).toBe(true)
  })

  it('una obligación con vencimiento faltante e importe negativo no aporta importe fuera', () => {
    const raw = handmadeRaw()
    raw.debtors = raw.debtors.slice(0, 1)
    raw.debts = [{ id: 1, debtor: 1, current_amount: -10, status: 910001, due_date: null }]
    const mapped = configureLists(raw)
    const reconciliation = buildQueueReconciliation(mapped.debtors, [])
    expect(reconciliation.outsideObligations).toBe(1)
    expect(reconciliation.outsideAmount.value).toBe(0)
    expect(reconciliation.outsideWithoutAmount).toBe(0)
  })
})
