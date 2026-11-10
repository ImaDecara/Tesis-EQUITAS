import { moneyData, sumMoney, coverageText } from '@/lib/analytics'
import { filterPortfolio, portfolioHref } from '@/lib/portfolio-filters'
import { observed, unavailable } from '@/lib/data-presence'
import { describe, expect, it } from 'vitest'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { mapDashboardMetricsFromDebtorObjects } from '@/lib/mappers/dashboard-metrics-mapper'
import { buildDebtAgingSummary, buildRecommendationSummary } from '@/lib/equitas-view-selectors'
import { tenantReadScope } from '@/lib/server/tenant-read-scope'
import { buildPresenceRawData } from '@/tests/helpers/equitas-fixtures'

function fixture() {
  const raw = buildPresenceRawData()
  raw.batch = { as_of: '2026-09-30' }
  raw.debtorProfiles = []
  Object.assign(raw.debts[0], { current_amount: 1000000, due_date: '2026-01-01' })
  return raw
}

describe('ALIGN-014: catálogo analítico, contraejemplos heredados', () => {
  it('usa el día civil de Córdoba durante las últimas tres horas del día', () => {
    const raw = fixture(); delete raw.batch
    for (const instant of ['2026-10-01T00:00:00.000Z', '2026-10-01T02:59:59.000Z']) {
      expect(mapDebtorObjectsFromRawData(raw, { computedAt: instant }).debtors[0].decisionAsOf?.valor).toBe('2026-09-30')
    }
  })

  it('no oculta la severidad v1 cuando falla el perfil histórico', () => {
    const raw = fixture()
    raw.warnings = [{ table: 'debtor_profile', message: 'Fallo sintético', needsSelectPolicy: false }]
    const mapped = mapDebtorObjectsFromRawData(raw)
    const dashboard = mapDashboardMetricsFromDebtorObjects(mapped)
    expect(mapped.debtors[0].riskScore).toBe(75)
    expect(dashboard.priorityCases).toBe(1)
    expect(dashboard.byRisk).toContainEqual({ label: 'ALTO', value: 1 })
  })

  it('críticos y su monto comparten banda alta v1; el contacto no crea severidad', () => {
    const raw = fixture()
    const dashboard = mapDashboardMetricsFromDebtorObjects(mapDebtorObjectsFromRawData(raw))
    expect(dashboard.criticalCasesToday).toBe(1)
    expect(dashboard.criticalDebtTotal).toBe(1000000)
    raw.debts[0].current_amount = 100
    raw.debts[0].due_date = '2026-09-01'
    raw.debtorContacts = []
    expect(mapDashboardMetricsFromDebtorObjects(mapDebtorObjectsFromRawData(raw)).criticalCasesToday).toBe(0)
  })

  it('conserva el grupo conocido sin cola y el motivo INVALIDO del corte', () => {
    const raw = fixture(); raw.batch!.as_of = '2026-02-30'
    const mapped = mapDebtorObjectsFromRawData(raw)
    expect(mapDashboardMetricsFromDebtorObjects(mapped).byRecommendation).toEqual([{ label: 'No disponible', value: 1 }])
    const unknown = buildRecommendationSummary(mapped.debtors).find(group => group.interventionCode === null)!
    expect(unknown.metrics.totalDebt.presence).toBe('INVALIDO')
    expect(unknown.metrics.riskScore.presence).toBe('INVALIDO')
  })

  it('mora usa obligaciones al corte, aunque el catálogo o perfil diga otra cosa', () => {
    const raw = fixture()
    raw.debtorProfiles = [{ debtor: 901, total_debt_amount: 9000000, overdue_debt_amount: 8000000 }]
    raw.debts[0].status = 999
    const summary = buildDebtAgingSummary(mapDebtorObjectsFromRawData(raw).debtors, raw.warnings)
    expect(summary.totalDebt).toBe(1000000)
    expect(summary.overdueDebt).toBe(1000000)
    expect(summary.averageOverdueDays).toBe(272)
  })

  it('reglas 1.1.0: sin catálogo de estados no se sabe qué está pagado y la mora no se publica', () => {
    const raw = fixture()
    raw.warnings = [{ table: 'debt_status', message: 'Fallo sintético', needsSelectPolicy: false }]
    const [debtor] = mapDebtorObjectsFromRawData(raw).debtors
    expect(debtor.decision).toBeNull()
    expect(debtor.decisionIssues).toContainEqual({ field: 'estado_catalogo', presence: 'NO_INTEGRADO', reason: 'LECTURA_FALLIDA' })
    expect(debtor).toMatchObject({ totalDebt: 1000000, pendingDebt: null, overdueDebt: null, maxDaysOverdue: null })
    const summary = buildDebtAgingSummary([debtor], raw.warnings)
    expect(summary.overdueDebt).toBeNull()
    expect(summary.averageOverdueDays).toBeNull()
  })

  it('el total del perfil no sustituye la suma de obligaciones; un importe fuera del rango seguro no se redondea', () => {
    const raw = fixture()
    raw.debtorProfiles = [{ debtor: 901, total_debt_amount: '100000000000000.01' }]
    expect(mapDebtorObjectsFromRawData(raw).debtors[0].metrics?.totalDebt).toEqual({ value: 1000000, presence: 'OBSERVADO', missing: {} })
    raw.debts[0].current_amount = '100000000000000.01'
    const debtor = mapDebtorObjectsFromRawData(raw).debtors[0]
    expect(debtor.totalDebt).toBeNull()
    expect(debtor.metrics?.totalDebt.presence).toBe('INVALIDO')
  })

  it('las proyecciones excluyen birth_date y reason sin quitar las claves del alcance', () => {
    expect(tenantReadScope('person', '1')?.select).not.toContain('*')
    expect(tenantReadScope('person', '1')?.select).not.toContain('birth_date')
    expect(tenantReadScope('debtor_profile_detail', '1')?.select).not.toContain('reason')
    expect(tenantReadScope('debt', '1')?.select).toContain('current_amount::text')
    expect(tenantReadScope('debtor_profile', '1')?.select).toContain('total_debt_amount::text')
    expect(tenantReadScope('debtor_profile_detail', '1')?.select).not.toContain('*')
    expect(tenantReadScope('person', '1')?.select).toContain('id')
    expect(tenantReadScope('debtor_profile_detail', '1')?.select).toContain('risk_value')
  })
  it('valida centavos sin perder el decimal crudo ni redondear una suma imposible', () => {
    expect(moneyData('0,01').value).toBe(0.01)
    expect(moneyData('1.2300').value).toBe(1.23)
    for (const value of ['90071992547409.91', '1.001', 'importe ilegible', 1e21]) expect(moneyData(value).presence).toBe('INVALIDO')
    expect(sumMoney([observed(0.1), observed(0.2)]).value).toBe(0.3)
    expect(sumMoney([observed(50000000000000), observed(50000000000000)]).presence).toBe('INVALIDO')
    expect(sumMoney([unavailable('INVALIDO'), observed(2)])).toMatchObject({ value: 2, missing: { INVALIDO: 1 } })
    expect(sumMoney([], true).value).toBeNull()
    expect(coverageText([unavailable(), observed(3)])).toBe('1 de 2 objetos con dato.')
  })

  it('conserva filtros al navegar y no confunde falta de dato con ausencia de coincidencias', () => {
    const params = { q: 'Agua & A', risk: 'ALTO', type: 'Agua', contact: 'with', minAmount: '100', status: 'Vencida', personId: '701', queue: 'REVISION_JURIDICA' }
    const href = new URL(portfolioHref('/debt-aging', params, { page: '2' }), 'http://test.local')
    for (const [key, value] of Object.entries(params)) expect(href.searchParams.get(key)).toBe(value)
    expect(href.searchParams.get('page')).toBe('2')
    const raw = fixture(); const objects = mapDebtorObjectsFromRawData(raw).debtors
    expect(filterPortfolio(objects, { minAmount: '-1' })).toMatchObject({ invalid: true, failed: true, items: [] })
    expect(filterPortfolio(objects, { q: 'INEXISTENTE' })).toMatchObject({ failed: false, items: [] })
    expect(filterPortfolio(objects, { contact: 'with' }, [{ table: 'debtor_contact', message: 'Fallo sintético', needsSelectPolicy: false }]).failed).toBe(true)
    raw.batch!.as_of = '2026-02-30'
    expect(filterPortfolio(mapDebtorObjectsFromRawData(raw).debtors, { risk: 'ALTO' })).toMatchObject({ failed: true, items: [] })
  })

})
