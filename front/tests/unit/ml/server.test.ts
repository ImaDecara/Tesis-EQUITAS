import { beforeEach, expect, it, vi } from 'vitest'
import { raw } from './helpers'
const mocks = vi.hoisted(() => ({ access: vi.fn(), viewer: vi.fn(), raw: vi.fn() }))
vi.mock('@/lib/server/dal', () => ({ requireTenantAccess: mocks.access }))
vi.mock('@/lib/server/viewer-context', () => ({ loadViewerContext: mocks.viewer }))
vi.mock('@/lib/data/raw-debtor-loader', () => ({ loadRawDebtorData: mocks.raw }))
let server: typeof import('@/lib/ml/server')
beforeEach(async () => {
  vi.resetModules(); vi.resetAllMocks()
  mocks.access.mockResolvedValue({ context: { tenantId: '1' } })
  mocks.viewer.mockResolvedValue({ tenantName: 'Municipio sintético', portfolio: { kind: 'LOADED', asOf: '2026-09-30' } })
  mocks.raw.mockResolvedValue(raw())
  server = await import('@/lib/ml/server')
})
it('autoriza siempre, memoiza por municipio y huella, y dice cuándo reutiliza el ajuste', async () => {
  const first = await server.loadClusteringForViewer()
  expect(first.status).toBe('OK'); expect(first.freshness).toEqual({ state: 'CURRENT', detail: null })
  const second = await server.loadClusteringForViewer()
  // Misma huella sobre una lectura nueva: es el mismo resultado, no uno desactualizado.
  expect(second.freshness.state).toBe('CURRENT'); expect(second.freshness.detail).toContain('se reutiliza')
  expect(second.source.computedAt).toBe(first.source.computedAt)
  expect(mocks.access).toHaveBeenCalledTimes(2); expect(mocks.raw).toHaveBeenCalledTimes(2)
  mocks.access.mockResolvedValue({ context: { tenantId: '2' } })
  expect((await server.loadClusteringForViewer()).freshness.detail).toBeNull()
  const changed = raw(); changed.debts[0].current_amount = '123.45'; mocks.raw.mockResolvedValue(changed)
  expect((await server.loadClusteringForViewer()).source.dataFingerprint).not.toBe(first.source.dataFingerprint)
})
it('TTL y límite de municipios no reutilizan indefinidamente', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-11T12:00:00Z'))
  await server.loadClusteringForViewer()
  vi.setSystemTime(new Date('2026-11-11T12:16:00Z'))
  // `detail` nulo = se recalculó; con texto = se reutilizó el ajuste memoizado.
  expect((await server.loadClusteringForViewer()).freshness.detail).toBeNull()
  for (let i = 2; i <= 18; i++) { mocks.access.mockResolvedValue({ context: { tenantId: String(i) } }); await server.loadClusteringForViewer() }
  mocks.access.mockResolvedValue({ context: { tenantId: '1' } })
  expect((await server.loadClusteringForViewer()).freshness.detail).toBeNull()
  vi.useRealTimers()
})
it.each(['sin sesión', 'sin contexto', 'cartera incierta', 'advertencia', 'corte cambió', 'mapeo incompleto', 'fecha inválida'])('UNAVAILABLE sin lanzar: %s', async kind => {
  const data = raw()
  if (kind === 'sin sesión') mocks.access.mockRejectedValue(new Error('denied'))
  if (kind === 'sin contexto') mocks.viewer.mockResolvedValue(null)
  if (kind === 'cartera incierta') mocks.viewer.mockResolvedValue({ portfolio: { kind: 'UNAVAILABLE' } })
  if (kind === 'advertencia') data.warnings.push({ table: 'debt', message: 'privado', needsSelectPolicy: false })
  if (kind === 'corte cambió') data.batch!.as_of = '2026-10-01'
  if (kind === 'mapeo incompleto') data.debtors.push({})
  if (kind === 'fecha inválida') data.batch!.as_of = 'no-fecha'
  mocks.raw.mockResolvedValue(data)
  const result = await server.loadClusteringForViewer()
  expect(result.status).toBe('UNAVAILABLE'); expect(JSON.stringify(result)).not.toContain('privado')
})
it('sin corte registrado, declarado y cartera vacía', async () => {
  const data = raw(); delete data.batch; mocks.raw.mockResolvedValue(data)
  mocks.viewer.mockResolvedValue({ tenantName: null, portfolio: { kind: 'UNDATED' } })
  expect((await server.loadClusteringForViewer()).source.portfolioDateKind).toBe('NOT_REGISTERED')
  mocks.raw.mockResolvedValue(raw()); mocks.viewer.mockResolvedValue({ portfolio: { kind: 'LOADED', asOf: '2026-09-30', declared: true } })
  expect((await server.loadClusteringForViewer()).source.portfolioDateKind).toBe('DECLARED')
  mocks.raw.mockResolvedValue({ ...raw(), debtors: [], debts: [] })
  expect((await server.loadClusteringForViewer()).status).toBe('INSUFFICIENT_DATA')
  expect((await server.loadSupervisedExperiment()).status).toBe('OK')
})

it.each([0, 5, 29, 30, 10001])('servidor con %i casos, vacíos, escasos, constantes o fuera del límite', async count => {
  const data = raw()
  data.debtors = Array.from({ length: count }, (_, i) => ({ id: i + 1 }))
  data.debts = data.debtors.map((_, i) => ({ id: i + 1, debtor: i + 1, current_amount: '100', due_date: '2026-01-01', status: 1 }))
  mocks.raw.mockResolvedValue(data)
  const result = await server.loadClusteringForViewer()
  expect(result.status).toBe(count > 10000 ? 'UNAVAILABLE' : count < 30 ? 'INSUFFICIENT_DATA' : 'DEGENERATE')
  expect(result.clusters).toEqual([])
})
it('una sesión revocada no recibe el ajuste cacheado', async () => {
  expect((await server.loadClusteringForViewer()).status).toBe('OK')
  mocks.access.mockRejectedValue(new Error('revocada'))
  expect((await server.loadClusteringForViewer()).status).toBe('UNAVAILABLE')
})
