import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildDashboard,
  buildDebtorDetail,
  buildDebtors,
  buildPeople,
  buildPeopleDashboard,
} from '@/tests/helpers/equitas-fixtures'
import { panelOf } from '@/tests/helpers/case-page'
import { decisionsFixture, markupOf, renderedText, viewerFixture } from '@/tests/helpers/viewer-fixtures'

const {
  getDashboardDataMock,
  getDebtorsDataMock,
  getPeopleDataMock,
  getDebtorDetailDataMock,
  notFoundMock,
  session,
} = vi.hoisted(() => ({
  session: { viewer: vi.fn(), decisions: vi.fn() },
  getDashboardDataMock: vi.fn(),
  getDebtorsDataMock: vi.fn(),
  getPeopleDataMock: vi.fn(),
  getDebtorDetailDataMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error('not found')
  }),
}))

// La pestaña Revisión tiene sus propias pruebas (review-tab.test.ts).
vi.mock('@/lib/server/case-review-screen', () => ({ loadCaseReviewScreen: async () => ({ kind: 'restricted', message: 'Revisión fuera de esta prueba.' }) }))
vi.mock('@/lib/equitas-data', () => ({
  getDashboardData: getDashboardDataMock,
  getDebtorsData: getDebtorsDataMock,
  getPeopleData: getPeopleDataMock,
  getDebtorDetailData: getDebtorDetailDataMock,
}))

vi.mock('next/navigation', () => ({
  notFound: notFoundMock, usePathname: () => '/', useRouter: () => ({ replace: vi.fn() }),
}))
vi.mock('next/image', () => ({ default: () => null }))
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children }))
// N7: el marco y la sesión se simulan; las pantallas leen la fecha de la cartera y las decisiones.
vi.mock('@/lib/server/viewer-context', async original => ({ ...(await original<typeof import('@/lib/server/viewer-context')>()), loadViewerContext: session.viewer }))
vi.mock('@/lib/server/recorded-decisions', async original => ({ ...(await original<typeof import('@/lib/server/recorded-decisions')>()), loadRecordedDecisions: session.decisions }))
// ALIGN-069: la auditoria tiene sus propias pruebas (access-audit.integration.test.ts).
vi.mock('@/lib/server/audit', () => ({ auditCaseOpen: async () => undefined }))

import DebtAgingPage from '@/app/debt-aging/page'
import DebtorDetailPage from '@/app/debtors/[debtorId]/page'
import DebtorsPage from '@/app/debtors/page'
import NoContactPage from '@/app/no-contact/page'
import HomePage from '@/app/page'
import PeoplePage from '@/app/people/page'
import PriorityCasesPage from '@/app/priority-cases/page'
import RecommendedActionsPage from '@/app/recommended-actions/page'
import RiskAnalysisPage from '@/app/risk-analysis/page'

describe('pantallas con datos de gestion simulados', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    session.viewer.mockResolvedValue(viewerFixture())
    session.decisions.mockResolvedValue(decisionsFixture())
    getDashboardDataMock.mockResolvedValue({
      dashboard: buildDashboard(),
      peopleDashboard: buildPeopleDashboard(),
      warnings: [],
    })
    getDebtorsDataMock.mockResolvedValue({ debtors: buildDebtors(), warnings: [] })
    getPeopleDataMock.mockResolvedValue({
      people: buildPeople(),
      peopleDashboard: buildPeopleDashboard(),
      warnings: [],
    })
    getDebtorDetailDataMock.mockResolvedValue({ detail: buildDebtorDetail(), warnings: [] })
  })

  // N7: «Tablero» reemplaza a «Dashboard ejecutivo»; las cifras usan las tres definiciones únicas.
  it('calcula y presenta el resumen del tablero', async () => {
    const text = renderedText(await HomePage())

    expect(getDashboardDataMock).toHaveBeenCalledOnce()
    expect(text).toContain('Tablero')
    expect(text).not.toContain('Dashboard')
    // 1 de 3 casos con puntaje alto: 33 %.
    expect(text).toMatch(/Puntaje de prioridad desde 70\.\s*33%\s*de los casos/)
    expect(text).toMatch(/Total registrado\s*\$\s*1\.700/)
    expect(text).toMatch(/Deuda pendiente\s*\$\s*1\.700/)
    expect(text).toMatch(/Deuda vencida\s*\$\s*1\.300/)
    expect(text).toContain('AG-1001')
  })

  it('presenta deuda, mora y paginacion con parametros validos', async () => {
    const page = await DebtAgingPage({
      searchParams: Promise.resolve({ page: '2', pageSize: '1' }),
    })
    const text = renderedText(page)

    expect(text).toContain('Deuda y mora')
    expect(text).toContain('Los 10 casos con mayor total registrado')
    expect(text).toContain('Casos por deuda vencida')
    // pageSize=1 no es una opción: vale el tamaño por omisión (10) y la página 2 cae en la única.
    expect(text).toContain('1–3 de 3 casos.')
    expect(text).toContain('Página 1 de 1')
    expect(getDebtorsDataMock).toHaveBeenCalledOnce()
  })

  it('filtra y muestra casos sin contacto', async () => {
    const page = await NoContactPage({
      searchParams: Promise.resolve({ page: '1', pageSize: '10' }),
    })
    const text = renderedText(page)

    expect(text).toContain('Casos sin contacto')
    expect(text).toContain('antes de gestionarlos hay que conseguir o validar')
    expect(text).toContain('AG-1001')
    expect(text).not.toContain('IN-2001')
  })

  it('aplica los filtros en los grupos de trabajo', async () => {
    const page = await PriorityCasesPage({
      searchParams: Promise.resolve({
        q: 'ana',
        risk: 'ALTO',
        contact: 'without',
        type: 'Agua',
        minAmount: '900',
        page: '1',
        pageSize: '10',
      }),
    })
    const text = renderedText(page)

    expect(text).toContain('Grupos de trabajo')
    expect(text).toContain('AG-1001')
    expect(text).not.toContain('IN-2001')
    expect(text).toContain('Mostrando 1 de 3 casos según los filtros.')
  })

  it('procesa filtros y estadisticas del listado de casos', async () => {
    const page = await DebtorsPage({
      searchParams: Promise.resolve({
        q: 'agua',
        risk: 'ALTO',
        status: 'Activo',
        type: 'Agua',
        contact: 'without',
        personId: '501',
        page: '1',
        pageSize: '20',
      }),
    })
    const text = renderedText(page)

    expect(text).toContain('Casos')
    expect(text).toMatch(/Búsqueda:\s*agua/)
    expect(text).toContain('Persona vinculada: Ana Perez')
    expect(text).toContain('Mostrando 1 de 3 casos según los filtros.')
  })

  it('procesa filtros y resumen de personas', async () => {
    const page = await PeoplePage({
      searchParams: Promise.resolve({ q: 'ana', risk: 'ALTO', page: '1', pageSize: '20' }),
    })
    const text = renderedText(page)

    expect(text).toContain('Personas')
    expect(text).toContain('Ana Perez')
    expect(text).toContain('Índice anterior por persona')
  })

  // Prueba final (F3): «Sin contacto» quedaba con el total de la cartera aunque la búsqueda no encontrara a nadie.
  it('en Personas, «Sin contacto» sale de la misma selección que los demás indicadores', async () => {
    const without = (page: unknown) => markupOf(page as never).match(/data-people-without-contact[^>]*>([^<]*)</)?.[1]
    const all = await PeoplePage({ searchParams: Promise.resolve({}) })
    const none = await PeoplePage({ searchParams: Promise.resolve({ q: 'NO-EXISTE-PRUEBA' }) })
    expect(renderedText(none)).toContain('Mostrando 0 de')
    expect(without(none)).toBe('0')
    // Sin filtros coincide con la cantidad de personas sin contacto de toda la cartera.
    expect(Number(without(all))).toBe(buildPeople().filter(person => person.hasContact === false).length)
    expect(Number(without(all))).toBeGreaterThan(0)
  })

  // Prueba final (F4): a 390 px los encabezados de las tablas de casos se pisaban.
  it('las tablas de casos conservan un ancho mínimo en pantallas angostas e intermedias, y avisan que se desplazan', async () => {
    const pages = [
      await DebtorsPage({ searchParams: Promise.resolve({}) }), await PriorityCasesPage({ searchParams: Promise.resolve({}) }),
      await NoContactPage({ searchParams: Promise.resolve({}) }), await DebtAgingPage({ searchParams: Promise.resolve({}) }), await RiskAnalysisPage(),
    ]
    for (const page of pages) {
      const tables = markupOf(page as never).match(/<table class="[^"]*table-fixed[^"]*"/g) ?? []
      expect(tables.length).toBeGreaterThan(0)
      for (const table of tables) expect(table).toMatch(/min-w-\[\d+rem\][^"]*md:min-w-\[\d+rem\]/)
      expect(markupOf(page as never)).toContain('data-table-scroll-hint')
    }
  })

  it('presenta el puntaje de prioridad del caso y, aparte, el índice anterior por persona', async () => {
    const text = renderedText(await RiskAnalysisPage())

    expect(text).toContain('Puntaje de prioridad')
    expect(text).toContain('Casos en banda alta')
    expect(text).toContain('Índice anterior por persona')
    expect(text).not.toMatch(/severidad/i)
  })

  it('agrupa las acciones recomendadas existentes', async () => {
    const text = renderedText(await RecommendedActionsPage())

    expect(text).toContain('Acciones recomendadas')
    expect(text).toContain('Resumen por grupo de trabajo')
    for (const group of ['Seguimiento', 'Mejorar datos', 'Revisión jurídica', 'Contacto y plan', 'Recordatorio']) expect(text).toContain(group)
  })

  it('muestra el detalle completo de un objeto y deriva a notFound cuando falta', async () => {
    const detailPage = await DebtorDetailPage({ params: Promise.resolve({ debtorId: '1' }) })
    // N7: el contenido está en componentes; se renderiza la ficha y cada pestaña (helpers/case-page).
    const detailText = renderedText(detailPage)

    expect(detailText).toContain('Totales del caso')
    expect(panelOf(detailPage, 'people').text).toContain('Contactos de las personas asociadas')
    expect(detailText).toContain('AG-1001')

    getDebtorDetailDataMock.mockResolvedValueOnce({ detail: null, warnings: [] })

    await expect(DebtorDetailPage({ params: Promise.resolve({ debtorId: 'missing' }) })).rejects.toThrow(
      'not found'
    )
    expect(notFoundMock).toHaveBeenCalledOnce()
  })
})
