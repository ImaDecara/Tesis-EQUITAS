import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mapDashboardMetricsFromDebtorObjects } from '@/lib/mappers/dashboard-metrics-mapper'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { mapPeopleFromRawData } from '@/lib/mappers/person-risk-mapper'
import { observed, unavailable } from '@/lib/data-presence'
import { buildPresencePeopleData, buildPresenceRawData } from '@/tests/helpers/equitas-fixtures'
import { decisionsFixture, markupOf, recordedDecision, renderedText, textOfMarkup, viewerFixture } from '@/tests/helpers/viewer-fixtures'
import type { DataWarning, RawDebtorDataBundle } from '@/types/equitas-domain'

// Noche 7. Estados uniformes (plan §8.4), decisión registrada en los listados y un solo concepto de puntaje.
const { api, session } = vi.hoisted(() => ({
  api: { getDebtorsData: vi.fn(), getPeopleData: vi.fn(), getDashboardData: vi.fn() },
  session: { viewer: vi.fn(), decisions: vi.fn() },
}))
vi.mock('@/lib/equitas-data', () => api)
vi.mock('@/lib/server/viewer-context', async original => ({ ...(await original<typeof import('@/lib/server/viewer-context')>()), loadViewerContext: session.viewer }))
vi.mock('@/lib/server/recorded-decisions', async original => ({ ...(await original<typeof import('@/lib/server/recorded-decisions')>()), loadRecordedDecisions: session.decisions }))
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children }))
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ replace: vi.fn() }) }))

import DebtAgingPage from '@/app/debt-aging/page'
import DebtorsPage from '@/app/debtors/page'
import NoContactPage from '@/app/no-contact/page'
import HomePage from '@/app/page'
import PeoplePage from '@/app/people/page'
import PriorityCasesPage from '@/app/priority-cases/page'
import RecommendedActionsPage from '@/app/recommended-actions/page'
import RiskAnalysisPage from '@/app/risk-analysis/page'
import { DataWarnings } from '@/components/equitas/data-warnings'
import { PaginationControls, PaginationSummary } from '@/components/equitas/pagination-controls'
import { decisionView } from '@/components/portfolio/case-cells'
import { EmptyFilterState, ForbiddenState, ReadErrorState } from '@/components/portfolio/portfolio-state'
import { casesLabel, countLabel, daysLabel, filterLine, filterNotes, missingLines, missingText, readLabel, scoreText, scoreView } from '@/components/portfolio/portfolio-text'

const warning = (table: string): DataWarning => ({ table, message: 'Fallo sintético', needsSelectPolicy: false })

// Tres casos con contacto y uno sin contacto. Cartera al 30/09/2026.
function raw(): RawDebtorDataBundle {
  const bundle = buildPresenceRawData()
  bundle.batch = { as_of: '2026-09-30' }
  Object.assign(bundle.debts[0], { current_amount: 93350, due_date: '2026-01-10' })
  bundle.debtors.push({ id: 902, external_id: 'SINTETICO-OBJ-902', type: 6 })
  bundle.debts.push({ id: 802, debtor: 902, current_amount: 48000, status: 3, due_date: '2026-01-10' })
  return bundle
}

function configure(bundle = raw()) {
  const mapped = mapDebtorObjectsFromRawData(bundle)
  const people = mapPeopleFromRawData(buildPresencePeopleData())
  api.getDebtorsData.mockResolvedValue({ debtors: mapped.debtors, warnings: bundle.warnings })
  api.getDashboardData.mockResolvedValue({ dashboard: mapDashboardMetricsFromDebtorObjects(mapped), warnings: bundle.warnings })
  api.getPeopleData.mockResolvedValue({ people: people.people, peopleDashboard: people.dashboard, warnings: [] })
  return mapped
}

const SCREENS: [string, () => Promise<ReactNode>][] = [
  ['Tablero', () => HomePage()],
  ['Casos', () => DebtorsPage({ searchParams: Promise.resolve({}) })],
  ['Grupos de trabajo', () => PriorityCasesPage({ searchParams: Promise.resolve({}) })],
  ['Casos sin contacto', () => NoContactPage({ searchParams: Promise.resolve({}) })],
  ['Personas', () => PeoplePage({ searchParams: Promise.resolve({}) })],
  ['Deuda y mora', () => DebtAgingPage({ searchParams: Promise.resolve({}) })],
  ['Puntaje de prioridad', () => RiskAnalysisPage()],
  ['Acciones recomendadas', () => RecommendedActionsPage()],
]

beforeEach(() => {
  vi.clearAllMocks()
  session.viewer.mockResolvedValue(viewerFixture())
  session.decisions.mockResolvedValue(decisionsFixture())
  configure()
})

describe('municipio sin cartera cargada', () => {
  it.each(SCREENS)('%s: ADMIN ve una sola tarjeta con «Cargar CSV», sin ceros, gráficos ni reportes', async (title, render) => {
    session.viewer.mockResolvedValue(viewerFixture('ADMIN', { kind: 'EMPTY' }))
    const markup = markupOf(await render())
    const text = renderedText(await render())
    expect(text).toContain(title)
    expect(text).toContain('Tu municipio todavía no tiene una cartera cargada')
    expect(markup.match(/data-portfolio-state=/g)).toHaveLength(1)
    expect(markup).toMatch(/href="\/import"[^>]*>.*Cargar CSV/)
    expect(text).not.toMatch(/\$\s*0|\b0 casos|Ver reportes|Reportes CSV|No disponible/)
    expect(markup).not.toContain('/reports')
    expect(api.getDebtorsData).not.toHaveBeenCalled()
    expect(api.getDashboardData).not.toHaveBeenCalled()
  })

  it.each(SCREENS)('%s: USER no recibe el botón y sabe a quién pedirlo', async (_title, render) => {
    session.viewer.mockResolvedValue(viewerFixture('USER', { kind: 'EMPTY' }))
    const markup = markupOf(await render())
    expect(markup).not.toContain('href="/import"')
    expect(renderedText(await render())).toContain('Pedile a una persona administradora que la cargue')
  })

  it('una fecha de cartera no disponible no se presenta como municipio sin cartera', async () => {
    session.viewer.mockResolvedValue(viewerFixture('ADMIN', { kind: 'UNAVAILABLE' }))
    expect(renderedText(await HomePage())).not.toContain('todavía no tiene una cartera cargada')
  })
})

describe('tablero', () => {
  it('muestra las tres definiciones únicas, un solo rótulo de puntaje y un enlace a Reportes', async () => {
    const markup = markupOf(await HomePage())
    const text = renderedText(await HomePage())
    // Pendiente: 93.350 del caso 901; la pagada de 902 queda en el total registrado y fuera de lo pendiente.
    expect(text).toMatch(/Total registrado\s+\$\s*141\.350/)
    expect(text).toMatch(/Deuda pendiente\s+\$\s*93\.350/)
    expect(text).toMatch(/Deuda vencida\s+\$\s*93\.350/)
    expect(text).not.toMatch(/deuda total|severidad|Dashboard|NO_INFORMADO|NO_INTEGRADO/i)
    expect(text).toContain('¿Qué significan estas cifras?')
    expect(text).toContain('por reglas: no es una probabilidad de pago')
    expect(markup).toMatch(/href="\/reports"[^>]*>.*Ver reportes/)
    expect(markup).toContain('href="/help"')
    expect(markup).not.toContain('/api/reports/')
    // La segunda fila de enlaces que duplicaba el menú ya no existe.
    expect(markup).not.toContain('Vistas con los mismos filtros')
  })

  it('un error de lectura no se muestra como cero ni como vacío', async () => {
    const bundle = raw()
    bundle.warnings = [warning('debt')]
    bundle.debts = []
    configure(bundle)
    const text = renderedText(await HomePage())
    expect(text).toContain('No se pudieron leer algunos datos')
    expect(text).toContain('Falta leer las obligaciones')
    expect(text).toMatch(/Total registrado\s+No disponible/)
    expect(text).toMatch(/Deuda pendiente\s+No disponible/)
    expect(text).toMatch(/Deuda vencida\s+No disponible/)
    expect(text).not.toMatch(/\$\s*0\b/)
    // El nombre de la tabla queda en el detalle técnico plegado.
    expect(markupOf(await HomePage())).toMatch(/<details[^>]*>\s*<summary[^>]*>Detalle técnico<\/summary>[\s\S]*debt:/)
  })

  it('con filtros dice cuántos casos muestra; el grupo «No disponible» vacío no aparece', async () => {
    const text = renderedText(await HomePage({ searchParams: Promise.resolve({ q: 'SINTETICO' }) }))
    expect(text).toContain('Mostrando 2 casos según los filtros.')
    expect(text).not.toMatch(/No disponible\s+\d+ casos?\s*\(/)
  })
})

describe('listado de casos: decisión registrada y su estado', () => {
  it('vigente, sobre datos anteriores, sin decisión e ilegible', async () => {
    session.decisions.mockResolvedValue(decisionsFixture([
      recordedDecision('901'),
      recordedDecision('902', { stale: true, asOf: '2026-08-31', status: 'APROBADA', decidedIntervention: 'CONTACTO_PERSONAL_Y_PLAN', decidedIntensity: 3 }),
    ]))
    const markup = markupOf(await DebtorsPage({ searchParams: Promise.resolve({}) }))
    const rows = [...markup.matchAll(/<tr[^>]*>(?:(?!<\/tr>)[\s\S])*<\/tr>/g)].map(match => match[0]).filter(row => row.includes('/debtors/'))
    expect(rows).toHaveLength(2)
    const [first, second] = rows.map(textOfMarkup)
    expect(markup).toMatch(/<a[^>]*href="\/debtors\/901\?page=1&amp;pageSize=10"[^>]*>SINTETICO-OBJ-901<\/a>/)
    expect(first).toMatch(/Decisión registrada/)
    expect(first).not.toContain('Registrada sobre datos anteriores')
    expect(second).toContain('Propuesta aprobada')
    expect(second).toContain('Registrada sobre datos anteriores')

    session.decisions.mockResolvedValue(decisionsFixture())
    const none = markupOf(await DebtorsPage({ searchParams: Promise.resolve({}) }))
    expect(none.match(/data-decision="none"/g)).toHaveLength(2)

    session.decisions.mockResolvedValue({ ok: false, reason: 'UNAVAILABLE' })
    const unreadable = markupOf(await DebtorsPage({ searchParams: Promise.resolve({}) }))
    expect(unreadable.match(/data-decision="unavailable"/g)).toHaveLength(2)
    expect(unreadable).not.toContain('data-decision="none"')
    expect(textOfMarkup(unreadable)).toContain('esto no significa que no haya decisiones')
  })

  it('columnas a la vista: identificador, tipo, grupo, puntaje, deudas, contacto y decisión; paginación en español', async () => {
    const markup = markupOf(await DebtorsPage({ searchParams: Promise.resolve({}) }))
    const headers = [...markup.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(match => match[1])
    expect(headers).toEqual(['Identificador', 'Tipo', 'Grupo de trabajo', 'Puntaje de prioridad', 'Deuda pendiente', 'Deuda vencida', 'Contacto', 'Decisión registrada'])
    // A 390 px quedan identificador, puntaje, deuda pendiente y decisión; nada fija un ancho mayor que la pantalla.
    const visible = [...markup.matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/g)].filter(match => !/\bhidden\b/.test(match[1])).map(match => match[2])
    expect(visible).toEqual(['Identificador', 'Puntaje de prioridad', 'Deuda pendiente', 'Decisión registrada'])
    expect(markup).not.toMatch(/min-w-\[\d{3,}px\]/)
    expect(textOfMarkup(markup)).not.toMatch(/Ver mas|Pagina|por pagina|Severidad|Prioridad ALTA/)
  })

  it('casos sin contacto también muestran la decisión registrada', async () => {
    session.decisions.mockResolvedValue(decisionsFixture([recordedDecision('901', { stale: true })]))
    const bundle = raw()
    bundle.debtorContacts = []
    configure(bundle)
    const text = renderedText(await NoContactPage({ searchParams: Promise.resolve({}) }))
    expect(text).toContain('Decisión registrada')
    expect(text).toContain('Registrada sobre datos anteriores')
  })

  it('filtros sin coincidencias: vacío válido con «Limpiar filtros»', async () => {
    const markup = markupOf(await DebtorsPage({ searchParams: Promise.resolve({ q: 'NADIE' }) }))
    expect(markup).toContain('data-portfolio-state="empty-filter"')
    expect(markup).toMatch(/href="\/debtors"[^>]*>Limpiar filtros/)
    expect(textOfMarkup(markup)).toContain('Mostrando 0 de 2 casos según los filtros.')
  })
})

describe('textos y componentes compartidos', () => {
  it('plurales, días y faltantes en palabras', () => {
    expect(casesLabel(1)).toBe('1 caso')
    expect(casesLabel(2)).toBe('2 casos')
    expect(casesLabel(null)).toBe('No disponible')
    expect(countLabel(1500, 'caso', 'casos')).toBe('1.500 casos')
    expect(daysLabel(1)).toBe('1 día')
    expect(daysLabel(183)).toBe('183 días')
    expect(daysLabel(null)).toBe('No disponible')
    expect(filterLine(3, 10)).toBe('Mostrando 3 de 10 casos según los filtros.')
    expect(filterLine(1)).toBe('Mostrando 1 caso según los filtros.')
    expect(filterLine(null, 10)).toContain('No se puede determinar')
    expect(missingText('Deuda vencida', { ...unavailable('NO_INFORMADO_EN_ORIGEN'), missing: { NO_INFORMADO_EN_ORIGEN: 2, INVALIDO: 1 } }))
      .toBe('Deuda vencida: 2 datos no informados en el archivo de origen, 1 dato con un valor inválido')
    expect(missingText('X', observed(5))).toBe('')
    expect(missingText('X', undefined)).toBe('')
    expect(missingLines([['A', unavailable('NO_INTEGRADO')], ['B', observed(1)]])).toBe('A: 1 dato no disponible en esta versión')
    expect(readLabel('debt_status')).toBe('los estados de las obligaciones')
    expect(readLabel('otra_tabla')).toBe('otros datos')
  })

  it('un solo concepto de puntaje: valor y banda, parcial, no calculable o no disponible', () => {
    expect(scoreText(45, 'MEDIA').text).toBe('45 · Media')
    expect(scoreText(75, 'ALTO').text).toBe('75 · Alta')
    expect(scoreText(30, 'BAJA', true).text).toBe('Al menos 30 · Baja')
    expect(scoreText(null, null).text).toBe('No disponible: no se pudo evaluar')
    expect(scoreView({ decision: null }).text).toBe('No disponible: no se pudo evaluar')
    const [debtor] = configure().debtors
    expect(scoreView(debtor).text).toMatch(/^\d+ · (Alta|Media|Baja)$/)
    const r2 = { decision: { ...debtor.decision!, severidad: { ...debtor.decision!.severidad, valor: null } } }
    expect(scoreView(r2).text).toBe('No calculable: faltan datos')
  })

  it('la decisión: sin lectura nunca es «sin decisión»', () => {
    expect(decisionView({ ok: false, reason: 'FORBIDDEN' }, '1')).toEqual({ kind: 'UNAVAILABLE' })
    expect(decisionView(decisionsFixture(), '1')).toEqual({ kind: 'NONE' })
    expect(decisionView(decisionsFixture([recordedDecision('1', { decidedIntervention: null, decidedIntensity: null })]), '1'))
      .toMatchObject({ kind: 'RECORDED', action: 'Sin acción decidida', stale: false })
  })

  it('los avisos de un filtro no se confunden con errores de lectura', () => {
    const read = [warning('debt')]
    const note = { table: 'portfolio_filter', message: 'Nota del filtro', needsSelectPolicy: false }
    expect(filterNotes([...read, note], read)).toEqual([note])
    expect(DataWarnings({ warnings: [] })).toBeNull()
    const permission = renderedText(DataWarnings({ warnings: [{ ...warning('person'), needsSelectPolicy: true }] }))
    expect(permission).toContain('Puede ser un permiso de tu cuenta')
  })

  it('estados: vacío válido, error de lectura y función sin permiso dicen qué hacer', () => {
    expect(renderedText(EmptyFilterState({ clearHref: '/people', what: 'personas' }))).toBe('No hay personas que cumplan los filtros elegidos. Limpiar filtros')
    expect(renderedText(ReadErrorState({ what: 'las decisiones' }))).toContain('No se pudo leer las decisiones Esto no significa que no haya datos: recargá la página.')
    const forbidden = markupOf(ForbiddenState({ title: 'Cargar un CSV requiere una cuenta ADMIN', children: 'Podés ver la cartera.' }))
    expect(forbidden).toContain('data-portfolio-state="forbidden"')
    expect(textOfMarkup(forbidden)).toContain('Podés ver la cartera.')
  })

  it('paginación con «Anterior» y «Siguiente»; nada cuando no hay elementos', () => {
    const buildHref = (page: number, size: number) => `/x?page=${page}&pageSize=${size}`
    const props = { currentPage: 2, totalPages: 3, pageSize: 10, currentStart: 11, currentEnd: 20, totalItems: 25, itemLabel: ['caso', 'casos'] as const, buildHref }
    const markup = markupOf(PaginationControls(props))
    expect(markup).toMatch(/href="\/x\?page=1&amp;pageSize=10"[^>]*>Anterior/)
    expect(markup).toMatch(/href="\/x\?page=3&amp;pageSize=10"[^>]*>Siguiente/)
    expect(renderedText(PaginationControls(props))).toContain('Página 2 de 3')
    expect(PaginationControls({ ...props, totalItems: 0 })).toBeNull()
    expect(renderedText(PaginationSummary({ ...props, totalItems: 1, currentStart: 1, currentEnd: 1 }))).toContain('1–1 de 1 caso. Ver 10 20 por página')
    expect(renderedText(PaginationSummary({ ...props, totalItems: 0 }))).toContain('0 casos.')
  })
})
