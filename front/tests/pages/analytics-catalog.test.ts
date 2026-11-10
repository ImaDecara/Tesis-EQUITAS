import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPresenceRawData, buildPresencePeopleData } from '@/tests/helpers/equitas-fixtures'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { mapPeopleFromRawData } from '@/lib/mappers/person-risk-mapper'
import { mapDashboardMetricsFromDebtorObjects } from '@/lib/mappers/dashboard-metrics-mapper'
import { decisionsFixture, viewerFixture } from '@/tests/helpers/viewer-fixtures'

const api = vi.hoisted(() => ({ getDebtorsData: vi.fn(), getPeopleData: vi.fn(), getDashboardData: vi.fn(), getDebtorDetailData: vi.fn() }))
const session = vi.hoisted(() => ({ viewer: vi.fn(), decisions: vi.fn() }))
vi.mock('@/lib/server/viewer-context', async original => ({ ...(await original<typeof import('@/lib/server/viewer-context')>()), loadViewerContext: session.viewer }))
vi.mock('@/lib/server/recorded-decisions', async original => ({ ...(await original<typeof import('@/lib/server/recorded-decisions')>()), loadRecordedDecisions: session.decisions }))
vi.mock('@/lib/equitas-data', () => api)
vi.mock('next/navigation', () => ({ usePathname: () => '/debtors', useRouter: () => ({ replace: vi.fn() }), notFound: () => { throw new Error('notFound') } }))
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/lib/server/case-review-screen', () => ({ loadCaseReviewScreen: async () => ({ kind: 'restricted', message: 'Fuera de esta prueba' }) }))
import HomePage from '@/app/page'
import NoContactPage from '@/app/no-contact/page'
import RecommendedActionsPage from '@/app/recommended-actions/page'
import DebtorsPage from '@/app/debtors/page'
import PeoplePage from '@/app/people/page'
import DebtorDetailPage from '@/app/debtors/[debtorId]/page'

const html = (node: ReactNode) => renderToStaticMarkup(createElement(Fragment, null, node))
const text = (node: ReactNode) => html(node).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
function configure(table?: string) {
  const raw = buildPresenceRawData(); raw.batch = { as_of: '2026-09-30' }
  if (table) raw.warnings = [{ table, message: 'Fallo sintético', needsSelectPolicy: false }]
  if (table === 'debtor') raw.debtors = []
  if (table === 'debtor_contact') raw.debtorContacts = []
  const mapped = mapDebtorObjectsFromRawData(raw)
  const personsRaw = buildPresencePeopleData()
  if (table === 'person') { personsRaw.people = []; personsRaw.warnings = raw.warnings }
  const persons = mapPeopleFromRawData(personsRaw)
  api.getDebtorsData.mockResolvedValue(mapped)
  api.getDashboardData.mockResolvedValue({ dashboard: mapDashboardMetricsFromDebtorObjects(mapped), warnings: raw.warnings })
  api.getPeopleData.mockResolvedValue({ people: persons.people, peopleDashboard: persons.dashboard, warnings: personsRaw.warnings })
  api.getDebtorDetailData.mockResolvedValue({ detail: null, warnings: raw.warnings })
  session.viewer.mockResolvedValue(viewerFixture())
  session.decisions.mockResolvedValue(decisionsFixture())
}

describe('ALIGN-014: lo que ve el operador', () => {
  beforeEach(() => { vi.clearAllMocks(); configure() })
  it('una lectura fallida no afirma ausencia ni contador cero', async () => {
    configure('debtor')
    for (const page of [await NoContactPage({ searchParams: Promise.resolve({}) }), await DebtorsPage({ searchParams: Promise.resolve({}) })]) {
      expect(text(page)).not.toMatch(/No hay (casos|objetos)|Mostrando 0-0 de 0|0 casos\.|Todos los casos tienen|La cartera no tiene/)
      expect(text(page)).toContain('No disponible')
    }
    expect(text(await RecommendedActionsPage())).not.toContain('Sin casos')
    await expect(DebtorDetailPage({ params: Promise.resolve({ debtorId: '901' }) })).resolves.toBeDefined()
  })
  it('el vacío real sigue siendo un vacío y el fallo de personas no lo es', async () => {
    configure('person')
    expect(text(await PeoplePage({ searchParams: Promise.resolve({}) }))).not.toContain('No hay personas')
    configure()
    expect(text(await DebtorsPage({ searchParams: Promise.resolve({ q: 'INEXISTENTE' }) }))).toContain('No hay casos que cumplan los filtros elegidos')
    await expect(DebtorDetailPage({ params: Promise.resolve({ debtorId: 'inexistente' }) })).rejects.toThrow('notFound')
  })
  it('las etiquetas de los cuatro selectores tienen controles asociados', async () => {
    const markup = html(await DebtorsPage({ searchParams: Promise.resolve({}) }))
    for (const id of ['risk', 'status', 'type', 'contact']) {
      expect(markup).toContain(`for="${id}"`)
      expect(markup).toContain(`id="${id}"`)
    }
  })
  // N7: la fecha de la cartera está en la línea fija del marco; la pantalla no repite fechas técnicas.
  it('muestra cobertura y grupos; no presenta un ranking entre intervenciones ni fechas crudas', async () => {
    const markup = text(await HomePage())
    expect(markup).not.toContain('2026-09-30')
    expect(markup).not.toMatch(/Corte del manifiesto|corte no integrado|NO_INFORMADO|NO_INTEGRADO/)
    expect(markup).toContain('1 de 1 objetos con dato')
    expect(markup).not.toMatch(/Score|Riesgo|Recomendacion urgente|Top 5 operativo/)
    expect(markup).toContain('Grupos de trabajo')
  })
})
