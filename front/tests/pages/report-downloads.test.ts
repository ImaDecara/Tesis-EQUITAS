import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ getDebtorsData: vi.fn(), getDashboardData: vi.fn() }))
const links = vi.hoisted(() => ({ availableReportLinks: vi.fn() }))
const viewer = vi.hoisted(() => ({ loadViewerContext: vi.fn() }))
vi.mock('@/lib/equitas-data', () => api)
vi.mock('@/lib/server/report-links', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/server/report-links')>()), ...links }))
vi.mock('@/lib/server/viewer-context', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/server/viewer-context')>()), ...viewer }))
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ replace: vi.fn() }) }))
vi.mock('next/image', () => ({ default: () => null }))
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children }))

import HelpPage from '@/app/help/page'
import PriorityCasesPage from '@/app/priority-cases/page'
import ReportsPage from '@/app/reports/page'
import { ACTIVE_RULES } from '@/lib/domain/decision-rules-v1'
import { reportLinksForRole } from '@/lib/server/report-links'
import { mapDashboardMetricsFromDebtorObjects } from '@/lib/mappers/dashboard-metrics-mapper'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { buildPresenceRawData } from '@/tests/helpers/equitas-fixtures'
import { formatDate } from '@/lib/utils'
import { markupOf, PORTFOLIO_AS_OF, textOfMarkup, viewerFixture } from '@/tests/helpers/viewer-fixtures'

const textOf = textOfMarkup
const reportHrefs = (markup: string) => [...markup.matchAll(/<a\b[^>]*\bhref="(\/api\/reports\/[^"]*)"[^>]*>/g)].map(match => match[1].replace(/&amp;/g, '&'))
const available = (markup: string, value: 'si' | 'no') => [...markup.matchAll(new RegExp(`data-report="([a-z-]+)" data-report-available="${value}"`, 'g'))].map(match => match[1])

function configure() {
  const raw = buildPresenceRawData()
  raw.batch = { as_of: '2026-09-30' }
  const mapped = mapDebtorObjectsFromRawData(raw)
  api.getDebtorsData.mockResolvedValue(mapped)
  api.getDashboardData.mockResolvedValue({ dashboard: mapDashboardMetricsFromDebtorObjects(mapped), warnings: raw.warnings })
  viewer.loadViewerContext.mockResolvedValue(viewerFixture('ADMIN'))
}

describe('Noche 7: pantalla «Reportes»', () => {
  beforeEach(() => { vi.clearAllMocks(); configure() })

  it('ADMIN ve los cinco reportes con su descarga, la fecha de la cartera y sus definiciones', async () => {
    links.availableReportLinks.mockResolvedValue(reportLinksForRole('ADMIN'))
    const markup = markupOf(await ReportsPage())
    const text = textOf(markup)
    expect(reportHrefs(markup)).toEqual(['/api/reports/queue', '/api/reports/data-quality', '/api/reports/decisions', '/api/reports/supervision', '/api/reports/access'])
    expect(available(markup, 'no')).toEqual([])
    expect(text.split(`Cartera al ${formatDate(PORTFOLIO_AS_OF)}`)).toHaveLength(6)
    expect(text.match(/Qué es una fila:/g)).toHaveLength(5)
    expect(text).toContain('Cada descarga queda registrada')
    for (const term of ['Total registrado', 'Deuda pendiente', 'Deuda vencida']) expect(text).toContain(term)
    expect(text).toContain('Confirmación de carga solicitada')
    expect(text).not.toMatch(/supervisor|operador|NO_INTEGRADO|2026-09-30/)
  })

  it('USER ve tres descargas y las otras dos listadas, deshabilitadas y explicadas', async () => {
    viewer.loadViewerContext.mockResolvedValue(viewerFixture('USER'))
    links.availableReportLinks.mockResolvedValue(reportLinksForRole('USER'))
    const markup = markupOf(await ReportsPage())
    expect(reportHrefs(markup)).toEqual(['/api/reports/queue', '/api/reports/data-quality', '/api/reports/decisions'])
    expect(available(markup, 'no')).toEqual(['supervision', 'access'])
    expect(textOf(markup).match(/Muestra la actividad de otras personas: requiere una cuenta ADMIN\./g)).toHaveLength(2)
    expect(textOf(markup)).toContain('Supervisión de decisiones')
    expect(textOf(markup)).toContain('Registro de accesos')
  })

  it('municipio sin cartera: no ofrece las descargas de cartera y lo explica', async () => {
    viewer.loadViewerContext.mockResolvedValue(viewerFixture('ADMIN', { kind: 'EMPTY' }))
    links.availableReportLinks.mockResolvedValue(reportLinksForRole('ADMIN'))
    const markup = markupOf(await ReportsPage())
    expect(available(markup, 'no')).toEqual(['queue', 'data-quality'])
    expect(reportHrefs(markup)).toEqual(['/api/reports/decisions', '/api/reports/supervision', '/api/reports/access'])
    expect(textOf(markup)).toContain('Tu municipio todavía no tiene una cartera cargada')
    expect(textOf(markup)).toContain('Sin cartera cargada')
  })

  it('fecha de la cartera no disponible: lo dice, sin inventar una fecha', async () => {
    viewer.loadViewerContext.mockResolvedValue(viewerFixture('USER', { kind: 'UNAVAILABLE' }))
    links.availableReportLinks.mockResolvedValue(reportLinksForRole('USER'))
    const text = textOf(markupOf(await ReportsPage()))
    expect(text).toContain('Fecha de la cartera no disponible')
    expect(text).not.toContain('Cartera al')
  })

  it('sin sesión verificable no ofrece ninguna descarga', async () => {
    for (const [context, value] of [[null, reportLinksForRole('ADMIN')], [viewerFixture('ADMIN'), null]] as const) {
      viewer.loadViewerContext.mockResolvedValue(context)
      links.availableReportLinks.mockResolvedValue(value)
      const markup = markupOf(await ReportsPage())
      expect(reportHrefs(markup)).toEqual([])
      expect(textOf(markup)).toContain('No se pudo verificar tu sesión')
    }
  })
})

describe('Noche 7: pantalla «Ayuda»', () => {
  const markup = markupOf(HelpPage())
  const text = textOf(markup)

  it('tiene las secciones con ancla y un índice que las enlaza', () => {
    for (const id of ['que-muestra', 'totales', 'puntaje', 'grupos', 'decisiones', 'estados', 'cargar-csv', 'cuentas', 'limites']) {
      expect(markup).toContain(`id="${id}"`)
      expect(markup).toContain(`href="#${id}"`)
    }
    expect(markup).toContain('href="/import"')
  })

  it('las bandas y los puntos salen del contrato activo de reglas', () => {
    const bands = Object.fromEntries(ACTIVE_RULES.severidad.bandas.map(band => [band.codigo, band.desde]))
    expect(text).toContain(`Alta De ${bands.ALTA} a 100`)
    expect(text).toContain(`Media De ${bands.MEDIA} a ${bands.ALTA - 1}`)
    expect(text).toContain(`Baja De 0 a ${bands.MEDIA - 1} (menos de ${bands.MEDIA})`)
    const factors = ACTIVE_RULES.severidad.factores
    expect(text).toContain(`(hasta ${factors.monto_actualizado_ars.peso_maximo} puntos)`)
    expect(text).toContain(`(hasta ${factors.dias_atraso_maximo.peso_maximo} puntos)`)
    expect(text).toContain(`(hasta ${factors.cantidad_vencidas.peso_maximo} puntos)`)
    const rows = (markup.match(/<tr/g) ?? []).length
    const expected = Object.values(factors).reduce((sum, factor) => sum + factor.bandas.length + 1, 0) + ACTIVE_RULES.severidad.bandas.length + 1
      + ACTIVE_RULES.escala_intensidad.niveles.length + 1 + 8 + 1
    expect(rows).toBe(expected)
    expect(text).toContain('Desde $ 1.000.000')
    expect(text).toContain('Desde 731 días')
  })

  it('explica que no es una probabilidad, los grupos en orden y los tres bloques que no se mezclan', () => {
    expect(text).toContain('No es una probabilidad de pago ni usa aprendizaje automático')
    expect(text).toContain('gana la primera que se cumple')
    for (const group of ['Mejorar datos', 'Revisión jurídica', 'Contacto y plan', 'Recordatorio', 'Seguimiento']) expect(text).toContain(group)
    for (const block of ['Recomendación automática:', 'Decisión registrada:', 'Aprobación:', '«Registrada sobre datos anteriores»']) expect(text).toContain(block)
    expect(text).toContain('Nunca sugiere una intensidad mayor que 2')
  })

  it('estados del catálogo, cuentas ADMIN y USER desde la tabla de permisos, y límites', () => {
    for (const state of ['Vigente', 'Vencida', 'Plan de pago', 'Judicial', 'Certificado activo', 'Pagada', 'Cancelada', 'Desconocido', 'Suspendida']) expect(text).toContain(state)
    expect(text).toContain('Cargar un CSV con la cartera del municipio Sí No')
    expect(text).toContain('Ver la decisión registrada de cada caso y su estado; descargar el reporte de decisiones Sí Sí')
    expect(text).toContain('Descargar el registro de accesos Sí No')
    expect(text).toContain('Confirmación de carga solicitada')
    expect(text).toContain('Excel queda pendiente')
    expect(text).not.toMatch(/supervisor|operador|clustering/)
  })
})

describe('N6: «Grupos de trabajo» ofrece su CSV con los filtros que el CSV aplica', () => {
  beforeEach(() => { vi.clearAllMocks(); configure() })

  it('lleva búsqueda, severidad, contacto, tipo y monto, y aclara que incluye todas las colas', async () => {
    const markup = markupOf(await PriorityCasesPage({ searchParams: Promise.resolve({ q: 'Perez', risk: 'ALTO', contact: 'without', type: 'AGUA', minAmount: '10', page: '2' }) }))
    expect(reportHrefs(markup)).toEqual(['/api/reports/queue?q=Perez&risk=ALTO&contact=without&type=AGUA&minAmount=10'])
    expect(textOf(markup)).toContain('Incluye todos los grupos, no solo el elegido')
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
