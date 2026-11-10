import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ getDebtorsData: vi.fn(), getDashboardData: vi.fn() }))
const links = vi.hoisted(() => ({ availableReportLinks: vi.fn() }))
vi.mock('@/lib/equitas-data', () => api)
vi.mock('@/lib/server/report-links', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/server/report-links')>()), ...links }))
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ replace: vi.fn() }) }))
vi.mock('next/image', () => ({ default: () => null }))
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children }))

import HomePage from '@/app/page'
import PriorityCasesPage from '@/app/priority-cases/page'
import { reportLinksForRole } from '@/lib/server/report-links'
import { mapDashboardMetricsFromDebtorObjects } from '@/lib/mappers/dashboard-metrics-mapper'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { buildPresenceRawData } from '@/tests/helpers/equitas-fixtures'

const markupOf = (node: ReactNode) => renderToStaticMarkup(createElement(Fragment, null, node))
const textOf = (markup: string) => markup.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const reportHrefs = (markup: string) => [...markup.matchAll(/<a\b[^>]*\bhref="(\/api\/reports\/[^"]*)"[^>]*>/g)].map(match => match[1].replace(/&amp;/g, '&'))

function configure() {
  const raw = buildPresenceRawData()
  raw.batch = { as_of: '2026-09-30' }
  const mapped = mapDebtorObjectsFromRawData(raw)
  api.getDebtorsData.mockResolvedValue(mapped)
  api.getDashboardData.mockResolvedValue({ dashboard: mapDashboardMetricsFromDebtorObjects(mapped), warnings: raw.warnings })
}

describe('N6: el tablero muestra los CSV que permite el rol', () => {
  beforeEach(() => { vi.clearAllMocks(); configure() })

  it('ADMIN ve los cinco reportes, con la ruta existente de cada uno', async () => {
    links.availableReportLinks.mockResolvedValue(reportLinksForRole('ADMIN'))
    const markup = markupOf(await HomePage())
    expect(textOf(markup)).toContain('Reportes CSV')
    expect(reportHrefs(markup)).toEqual(['/api/reports/queue', '/api/reports/data-quality', '/api/reports/decisions', '/api/reports/supervision', '/api/reports/access'])
  })

  it('USER no ve supervisión ni registro de accesos', async () => {
    links.availableReportLinks.mockResolvedValue(reportLinksForRole('USER'))
    const markup = markupOf(await HomePage())
    expect(reportHrefs(markup)).toEqual(['/api/reports/queue', '/api/reports/data-quality', '/api/reports/decisions'])
    expect(textOf(markup)).not.toMatch(/Supervisión|Registro de accesos/)
  })

  it('sin sesión verificable o sin reportes permitidos no aparece el panel', async () => {
    for (const value of [null, []]) {
      links.availableReportLinks.mockResolvedValue(value)
      const markup = markupOf(await HomePage())
      expect(textOf(markup)).not.toContain('Reportes CSV')
      expect(reportHrefs(markup)).toEqual([])
    }
  })
})

describe('N6: la cola ofrece su CSV con los filtros que el CSV aplica', () => {
  beforeEach(() => { vi.clearAllMocks(); configure() })

  it('lleva búsqueda, severidad, contacto, tipo y monto, y aclara que incluye todas las colas', async () => {
    const markup = markupOf(await PriorityCasesPage({ searchParams: Promise.resolve({ q: 'Perez', risk: 'ALTO', contact: 'without', type: 'AGUA', minAmount: '10', page: '2' }) }))
    expect(reportHrefs(markup)).toEqual(['/api/reports/queue?q=Perez&risk=ALTO&contact=without&type=AGUA&minAmount=10'])
    expect(textOf(markup)).toContain('Incluye todas las colas, no solo la elegida')
    expect(textOf(markup)).not.toContain('El CSV no aplica')
  })

  it('advierte el filtro de estado o persona que el CSV no aplica', async () => {
    const markup = markupOf(await PriorityCasesPage({ searchParams: Promise.resolve({ status: 'OVERDUE', personId: '7' }) }))
    expect(reportHrefs(markup)).toEqual(['/api/reports/queue'])
    expect(textOf(markup)).toContain('El CSV no aplica el filtro de estado ni el de persona.')
  })

  it('si la pantalla no puede determinar la selección, tampoco ofrece su CSV', async () => {
    const raw = buildPresenceRawData()
    raw.batch = { as_of: '2026-09-30' }
    raw.warnings = [{ table: 'debtor', message: 'Fallo sintético', needsSelectPolicy: false }]
    api.getDebtorsData.mockResolvedValue(mapDebtorObjectsFromRawData(raw))
    const markup = markupOf(await PriorityCasesPage({ searchParams: Promise.resolve({ risk: 'ALTO' }) }))
    expect(reportHrefs(markup)).toEqual([])
    expect(textOf(markup)).toContain('La pantalla no puede determinar esta selección')
  })

  it('con un monto inválido no ofrece un CSV de otra selección', async () => {
    const markup = markupOf(await PriorityCasesPage({ searchParams: Promise.resolve({ minAmount: '-5' }) }))
    expect(reportHrefs(markup)).toEqual([])
    expect(textOf(markup)).toContain('Corregí el monto mínimo para descargar el CSV de esta selección.')
  })
})
