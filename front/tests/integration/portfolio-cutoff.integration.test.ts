import { beforeEach, describe, expect, it, vi } from 'vitest'
const { serverClient } = vi.hoisted(() => ({ serverClient: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient: serverClient }))
vi.mock('@/lib/supabase-config', () => ({ hasSupabaseCredentials: true }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
// ALIGN-069: esta suite aísla la lectura del corte; access-audit.integration prueba la escritura y su falla cerrada.
vi.mock('@/lib/server/case-review-writer', () => ({ createCaseReviewWriter: () => ({ rpc: async () => ({ data: { audit_id: 1, created: true }, error: null }) }) }))

import { GET } from '@/app/api/reports/queue/route'
import { loadRawDebtorData } from '@/lib/data/raw-debtor-loader'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { portfolioContext } from '@/lib/analytics'
import { filterPortfolio } from '@/lib/portfolio-filters'
import { getDashboardDataFromService } from '@/lib/services/dashboard-data-service'
import { createAuthorizedPaginatedSupabase } from '../fixtures/paginated-supabase'
import { parseCsvBytes } from '../helpers/independent-csv-parser'
import type { RawRow } from '@/types/equitas-domain'

const event = (id: number, status = 'PUBLICADO', supersedes: number | null = null, tenant = 7): RawRow =>
  ({ id, tenant, status, supersedes, as_of: '2026-09-30', source_updated_at: '2026-09-29' })

function fixture(events: RawRow[], options: Parameters<typeof createAuthorizedPaginatedSupabase>[1] = {}) {
  const tables = {
    debtor: [{ id: 99, tenant: 7 }],
    debt: [{ id: 1, debtor: 99, current_amount: '1000000.00', due_date: '2026-01-01', __scope: { tenant: 7 } }],
    import_batch: events,
  }
  const result = createAuthorizedPaginatedSupabase(tables, { enforceFilters: true, ...options })
  serverClient.mockResolvedValue(result.client)
  return { ...result, tables }
}
const exportQueue = () => GET(new Request('http://localhost/api/reports/queue'))

describe('ALIGN-014: corte publicado común a cartera y CSV (reproducción coordinada de 029)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lee todas las páginas del municipio y exporta el corte publicado, nunca el reloj ni el lote ajeno', async () => {
    const events = Array.from({ length: 1001 }, (_, index) => event(index + 1, 'DESCARTADO'))
    events.push(event(1002, 'VALIDADO'), event(1003, 'PUBLICADO', 1002), { ...event(1004, 'PUBLICADO', null, 8), as_of: '2027-01-01' })
    const { requests } = fixture(events)
    const raw = await loadRawDebtorData()
    expect(raw.batch).toMatchObject({ as_of: '2026-09-30', source_updated_at: '2026-09-29' })
    expect(raw.warnings).toEqual([])
    const mapped = mapDebtorObjectsFromRawData(raw, { computedAt: '2026-11-05T02:00:00.000Z' })
    expect(mapped.debtors[0].decisionInput?.as_of).toBe('2026-09-30')
    expect(portfolioContext(mapped.debtors)).toContain('Corte del manifiesto: 2026-09-30')
    const response = await exportQueue()
    expect(response.status).toBe(200)
    const csv = parseCsvBytes(new Uint8Array(await response.arrayBuffer()))
    expect(csv.rows.length).toBeGreaterThan(1)
    expect(csv.rows.every(row => row.fecha_corte === '2026-09-30' && row.fecha_calculo_usada === 'NO_APLICA')).toBe(true)
    const reads = requests.filter(request => request.table === 'import_batch')
    expect(reads.some(read => read.after === '1000')).toBe(true)
    for (const read of reads) {
      expect(read.filters).toEqual({ tenant: 'eq.7' })
      expect(read.select).toBe('id,as_of,source_updated_at,status,supersedes,publicacion_atomica:counts->publicacion_atomica')
    }
  })

  it.each(['VALIDADO', 'CONFIRMADO', 'FALLIDO', 'DESCONOCIDO'])('no reutiliza el corte anterior con un lote %s que pudo modificar la cartera', async status => {
    fixture([event(1), event(2, 'VALIDADO'), event(3, status, 2)])
    const raw = await loadRawDebtorData()
    expect(raw.batch?.as_of).toBeNull()
    expect(raw.warnings).toContainEqual(expect.objectContaining({ table: 'import_batch' }))
    expect(mapDebtorObjectsFromRawData(raw).debtors[0].decision).toBeNull()
    expect((await exportQueue()).status).toBe(503)
  })

  it.each(['RECIBIDO', 'DESCARTADO', 'REQUIERE_NUEVO_PREVIEW', 'FALLIDO'])('un %s sin escritura no desplaza una publicación válida', async status => {
    fixture([event(1), event(2, status)])
    expect((await loadRawDebtorData()).batch?.as_of).toBe('2026-09-30')
  })

  it.each(['VALIDADO', 'CONFIRMADO', 'FALLIDO', 'DESCARTADO', 'REQUIERE_NUEVO_PREVIEW'])('032: %s atómico conserva el corte publicado en cartera y CSV', async status => {
    fixture([event(1), { ...event(2, 'RECIBIDO'), counts: { publicacion_atomica: 1 } },
      { ...event(3, status, 2), counts: { publicacion_atomica: 1 } }])
    const raw = await loadRawDebtorData()
    expect(raw.batch?.as_of).toBe('2026-09-30')
    expect(raw.warnings).toEqual([])
    const response = await exportQueue()
    expect(response.status).toBe(200)
    expect(parseCsvBytes(new Uint8Array(await response.arrayBuffer())).rows.every(row => row.fecha_corte === '2026-09-30')).toBe(true)
  })

  it.each(['VALIDADO', 'CONFIRMADO', 'FALLIDO', 'DESCARTADO', 'REQUIERE_NUEVO_PREVIEW'])('032: primer lote %s atómico no implica escrituras ni inventa publicación', async status => {
    fixture([{ ...event(1, 'RECIBIDO'), counts: { publicacion_atomica: 1 } },
      { ...event(2, status, 1), counts: { publicacion_atomica: 1 } }])
    const raw = await loadRawDebtorData()
    expect(raw.batch).toBeUndefined()
    expect(raw.warnings).toEqual([])
    const response = await exportQueue()
    expect(response.status).toBe(200)
    expect(parseCsvBytes(new Uint8Array(await response.arrayBuffer())).rows.every(row => row.fecha_corte === 'NO_INTEGRADO')).toBe(true)
  })

  it('032 S2: PUBLICADO atómico estable es corte de tablero, CSV y ficha', async () => {
    fixture([event(1), { ...event(2, 'PUBLICADO'), as_of: '2026-10-01', counts: { publicacion_atomica: 1 } }])
    const raw = await loadRawDebtorData()
    expect(raw.batch?.as_of).toBe('2026-10-01')
    expect(raw.warnings).toEqual([])
    expect(mapDebtorObjectsFromRawData(raw).debtors[0].decisionInput?.as_of).toBe('2026-10-01')
    const { dashboard } = await getDashboardDataFromService()
    expect(dashboard.context).toContain('Corte del manifiesto: 2026-10-01')
    const response = await exportQueue()
    expect(response.status).toBe(200)
    expect(parseCsvBytes(new Uint8Array(await response.arrayBuffer())).rows.every(row => row.fecha_corte === '2026-10-01')).toBe(true)
  })

  it.each([null, 0, '1', true, {}, { publicacion_atomica: '1' }])('una marca no numérica o ausente no habilita un corte viejo: %j', async marker => {
    fixture([event(1), { ...event(2, 'VALIDADO'), counts: { publicacion_atomica: marker } }])
    expect((await loadRawDebtorData()).batch?.as_of).toBeNull()
    expect((await exportQueue()).status).toBe(503)
  })

  it('032: la primera publicación atómica intercalada invalida la lectura aunque antes no hubiera corte', async () => {
    const events = [{ ...event(1, 'VALIDADO'), counts: { publicacion_atomica: 1 } }]
    fixture(events, { fail: request => {
      if (request.table === 'debt') events.push({ ...event(events.length + 1, 'PUBLICADO', events.length), counts: { publicacion_atomica: 1 } })
      return null
    } })
    const raw = await loadRawDebtorData()
    expect(raw.warnings).toContainEqual(expect.objectContaining({ code: 'CUTOFF_CHANGED' }))
  })

  it('un fallo después de la primera página no produce un corte ni CSV parcial', async () => {
    fixture([event(1), event(2, 'VALIDADO')], { serverMaxRows: 1,
      fail: request => request.table === 'import_batch' && request.after === '1' ? { message: 'Fallo sintético de segunda página' } : null })
    const raw = await loadRawDebtorData()
    expect(raw.batch?.as_of).toBeNull()
    expect(raw.warnings.some(warning => warning.table === 'import_batch')).toBe(true)
    expect((await exportQueue()).status).toBe(503)
  })

  it('detecta otra publicación mientras se leen las tablas, incluso si repite la fecha', async () => {
    const events = [event(1)]
    fixture(events, { fail: request => {
      if (request.table === 'debt') events.push(event(events.length + 1))
      return null
    } })
    const raw = await loadRawDebtorData()
    expect(raw.batch?.as_of).toBeNull()
    expect(raw.warnings).toContainEqual(expect.objectContaining({ code: 'CUTOFF_CHANGED' }))
    expect((await exportQueue()).status).toBe(503)
  })

  it.each([null, '2026-02-30', '0000-01-01', 20260930])('no inventa un corte PUBLICADO inválido o ausente: %j', async as_of => {
    fixture([{ ...event(1), as_of }])
    const raw = await loadRawDebtorData()
    expect(mapDebtorObjectsFromRawData(raw).debtors[0].decision).toBeNull()
    expect((await exportQueue()).status).toBe(503)
  })

  it('sin publicación declara NO_INTEGRADO y separa la fecha de cálculo', async () => {
    fixture([event(1, 'RECIBIDO')])
    const raw = await loadRawDebtorData()
    expect(raw.batch).toBeUndefined()
    expect(raw.warnings).toEqual([])
    const response = await exportQueue()
    expect(response.status).toBe(200)
    const csv = parseCsvBytes(new Uint8Array(await response.arrayBuffer()))
    expect(csv.rows.every(row => row.fecha_corte === 'NO_INTEGRADO' && /^\d{4}-\d{2}-\d{2}$/.test(row.fecha_calculo_usada))).toBe(true)
  })

  it('conserva el corte conocido en una cartera vacía y en su fila TOTAL', async () => {
    const { tables } = fixture([event(1)])
    tables.debtor.length = 0; tables.debt.length = 0
    const { dashboard } = await getDashboardDataFromService()
    expect(dashboard.context).toContain('Corte del manifiesto: 2026-09-30')
    const response = await exportQueue()
    expect(response.status).toBe(200)
    const csv = parseCsvBytes(new Uint8Array(await response.arrayBuffer()))
    expect(csv.rows).toHaveLength(1)
    expect(csv.rows[0]).toMatchObject({ fecha_corte: '2026-09-30', objetos: '0', deuda_total_ars: '0' })
  })

  it('una publicación incompleta con cero filas no se presenta como cartera vacía confirmada', async () => {
    const { tables } = fixture([event(1, 'VALIDADO')]); tables.debtor.length = 0
    const raw = await loadRawDebtorData()
    expect(filterPortfolio([], {}, raw.warnings).failed).toBe(true)
    const { dashboard } = await getDashboardDataFromService()
    expect(dashboard.totalDebt).toBeNull()
    expect(dashboard.context).toContain('Corte no disponible')
  })
})
