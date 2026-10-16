import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildDashboard,
  buildDebtorDetail,
  buildDebtors,
  buildPeople,
  buildPeopleDashboard,
} from '@/tests/helpers/equitas-fixtures'
import { textFromReactTree } from '@/tests/helpers/react-tree'

const {
  getDashboardDataMock,
  getDebtorsDataMock,
  getPeopleDataMock,
  getDebtorDetailDataMock,
  notFoundMock,
} = vi.hoisted(() => ({
  getDashboardDataMock: vi.fn(),
  getDebtorsDataMock: vi.fn(),
  getPeopleDataMock: vi.fn(),
  getDebtorDetailDataMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error('not found')
  }),
}))

vi.mock('@/lib/equitas-data', () => ({
  getDashboardData: getDashboardDataMock,
  getDebtorsData: getDebtorsDataMock,
  getPeopleData: getPeopleDataMock,
  getDebtorDetailData: getDebtorDetailDataMock,
}))

vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
}))

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

  it('calcula y presenta el resumen ejecutivo del dashboard', async () => {
    const page = await HomePage()
    const text = textFromReactTree(page)

    expect(getDashboardDataMock).toHaveBeenCalledOnce()
    expect(text).toContain('Dashboard ejecutivo')
    expect(text).toMatch(/33\s*%\s*de los objetos estan en riesgo alto/)
    expect(text).toContain('Llamado prioritario')
    expect(text).toContain('AG-1001')
  })

  it('presenta deuda, mora y paginacion con parametros validos', async () => {
    const page = await DebtAgingPage({
      searchParams: Promise.resolve({ page: '2', pageSize: '1' }),
    })
    const text = textFromReactTree(page)

    expect(text).toContain('Deuda y mora')
    expect(text).toContain('Top 10 mayor deuda')
    expect(text).toContain('Listado economico')
    expect(getDebtorsDataMock).toHaveBeenCalledOnce()
  })

  it('filtra y muestra casos sin contacto', async () => {
    const page = await NoContactPage({
      searchParams: Promise.resolve({ page: '1', pageSize: '10' }),
    })
    const text = textFromReactTree(page)

    expect(text).toContain('Casos sin contacto')
    expect(text).toContain('Estos casos requieren validacion')
    expect(text).toContain('AG-1001')
  })

  it('aplica filtros operativos para casos prioritarios', async () => {
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
    const text = textFromReactTree(page)

    expect(text).toContain('Casos prioritarios')
    expect(text).toContain('AG-1001')
    expect(text).toContain('Filtros operativos')
  })

  it('procesa filtros y estadisticas del listado de objetos', async () => {
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
    const text = textFromReactTree(page)

    expect(text).toContain('Objetos de deuda')
    expect(text).toMatch(/Busqueda:\s*agua/)
    expect(text).toMatch(/Prioridad\s+ALTA/)
  })

  it('procesa filtros y resumen de personas', async () => {
    const page = await PeoplePage({
      searchParams: Promise.resolve({ q: 'ana', risk: 'ALTO', page: '1', pageSize: '20' }),
    })
    const text = textFromReactTree(page)

    expect(text).toContain('Personas / Deudores')
    expect(text).toContain('Ana Perez')
    expect(text).toContain('Riesgo alto')
  })

  it('presenta analisis de riesgo individual y del objeto', async () => {
    const page = await RiskAnalysisPage()
    const text = textFromReactTree(page)

    expect(text).toContain('Analisis de riesgo')
    expect(text).toContain('Objetos con riesgo')
    expect(text).toContain('Personas con puntaje alto')
  })

  it('agrupa las acciones recomendadas existentes', async () => {
    const page = await RecommendedActionsPage()
    const text = textFromReactTree(page)

    expect(text).toContain('Acciones recomendadas')
    expect(text).toContain('Resumen por recomendacion')
    expect(text).toContain('Seguimiento posterior')
  })

  it('muestra el detalle completo de un objeto y deriva a notFound cuando falta', async () => {
    const detailPage = await DebtorDetailPage({ params: Promise.resolve({ debtorId: '1' }) })
    const detailText = textFromReactTree(detailPage)

    expect(detailText).toContain('Resumen del objeto')
    expect(detailText).toContain('Contactos de personas asociadas')
    expect(detailText).toContain('AG-1001')

    getDebtorDetailDataMock.mockResolvedValueOnce({ detail: null, warnings: [] })

    await expect(DebtorDetailPage({ params: Promise.resolve({ debtorId: 'missing' }) })).rejects.toThrow(
      'not found'
    )
    expect(notFoundMock).toHaveBeenCalledOnce()
  })
})
