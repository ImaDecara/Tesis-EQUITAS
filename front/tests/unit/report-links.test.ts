import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dal = vi.hoisted(() => ({ requireTenantAccess: vi.fn() }))
vi.mock('@/lib/server/dal', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/server/dal')>()), ...dal }))

import { WEB_ROLES, E06_READ_ONLY_COMPAT_ROLE, type ResolvedRoleName } from '@/lib/auth/tenant-access'
import { parseQueueFilters } from '@/lib/reports/queue-report'
import { DataAccessError, roleHasPermission } from '@/lib/server/dal'
import { availableReportLinks, queueReportLink, REPORT_LINKS, reportLinksForRole, reportOffers } from '@/lib/server/report-links'

const ROUTE_DIRS = { queue: 'queue', 'data-quality': 'data-quality', decisions: 'decisions', supervision: 'supervision', access: 'access' } as const

describe('N6: accesos visibles a los CSV existentes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('cada enlace apunta a una ruta existente que exige exactamente el mismo permiso', () => {
    expect(REPORT_LINKS.map(link => link.id).sort()).toEqual(Object.keys(ROUTE_DIRS).sort())
    for (const link of REPORT_LINKS) {
      const source = readFileSync(resolve(__dirname, `../../app/api/reports/${ROUTE_DIRS[link.id]}/route.ts`), 'utf8')
      const declared = /csvReportResponse\(request, '[^']+', '([^']+)'/.exec(source)?.[1]
      expect(declared, link.id).toBe(link.permission)
      expect(link.href).toBe(`/api/reports/${ROUTE_DIRS[link.id]}`)
    }
  })

  it('cada rol ve solo los reportes que su permiso autoriza', () => {
    const visible = (role: ResolvedRoleName) => reportLinksForRole(role).map(link => link.id)
    // Noche 7 (encargo §4.2): exportar lo que ya se ve es de cualquier miembro activo; los reportes que
    // muestran la actividad de otras personas (supervisión y accesos) requieren ADMIN.
    expect(visible('USER')).toEqual(['queue', 'data-quality', 'decisions'])
    expect(visible('ADMIN')).toEqual(['queue', 'data-quality', 'decisions', 'supervision', 'access'])
    expect(visible(E06_READ_ONLY_COMPAT_ROLE)).toEqual(['queue', 'data-quality'])
    const roles: ResolvedRoleName[] = [...WEB_ROLES, E06_READ_ONLY_COMPAT_ROLE]
    for (const role of roles) {
      for (const link of REPORT_LINKS) {
        expect(reportLinksForRole(role).includes(link), `${role} ${link.id}`).toBe(roleHasPermission(role, link.permission))
      }
    }
  })

  it('la pantalla «Reportes» lista los cinco y marca los que el rol permite; sin sesión, ninguno', () => {
    const allowed = (links: Parameters<typeof reportOffers>[0]) => reportOffers(links).filter(offer => offer.allowed).map(offer => offer.id)
    expect(reportOffers(reportLinksForRole('USER')).map(offer => offer.id)).toEqual(REPORT_LINKS.map(link => link.id))
    expect(allowed(reportLinksForRole('USER'))).toEqual(['queue', 'data-quality', 'decisions'])
    expect(allowed(reportLinksForRole('ADMIN'))).toEqual(['queue', 'data-quality', 'decisions', 'supervision', 'access'])
    expect(allowed(null)).toEqual([])
  })

  it('la sesión decide la lista; sin sesión verificable no se ofrece ningún enlace', async () => {
    dal.requireTenantAccess.mockResolvedValueOnce({ supabase: {}, context: { roleName: 'ADMIN' } })
    expect((await availableReportLinks())?.map(link => link.id)).toEqual(['queue', 'data-quality', 'decisions', 'supervision', 'access'])
    dal.requireTenantAccess.mockResolvedValueOnce({ supabase: {}, context: { roleName: 'USER' } })
    expect((await availableReportLinks())?.map(link => link.id)).toEqual(['queue', 'data-quality', 'decisions'])
    dal.requireTenantAccess.mockRejectedValueOnce(new DataAccessError('ROLE_FORBIDDEN', 'El rol no permite esta operacion.'))
    expect(await availableReportLinks()).toBeNull()
    dal.requireTenantAccess.mockRejectedValueOnce(new Error('cookies fuera de una solicitud'))
    expect(await availableReportLinks()).toBeNull()
    expect(dal.requireTenantAccess).toHaveBeenCalledWith()
  })

  it('el CSV de cola lleva los filtros que también aplica y ninguno más', () => {
    const link = queueReportLink({ q: ' Perez ', risk: 'ALTO', contact: 'without', type: 'Rodado', minAmount: '1000', status: '', personId: '' })
    expect(link).toEqual({ available: true, href: '/api/reports/queue?q=Perez&risk=ALTO&contact=without&type=Rodado&minAmount=1000', screenOnlyFilters: [] })
    if (!link.available) throw new Error('enlace esperado')
    const params = new URL(link.href, 'http://127.0.0.1').searchParams
    expect(parseQueueFilters(params)).toEqual({ q: 'Perez', risk: 'ALTO', contact: 'without', type: 'Rodado', minAmount: '1000' })
    expect(queueReportLink({})).toEqual({ available: true, href: '/api/reports/queue', screenOnlyFilters: [] })
    expect(queueReportLink({ q: '', risk: '  ' })).toEqual({ available: true, href: '/api/reports/queue', screenOnlyFilters: [] })
  })

  it('avisa los filtros de la pantalla que el CSV no aplica', () => {
    expect(queueReportLink({ risk: 'MEDIO', status: 'OVERDUE' })).toEqual({ available: true, href: '/api/reports/queue?risk=MEDIO', screenOnlyFilters: ['estado'] })
    expect(queueReportLink({ status: 'OVERDUE', personId: '9' })).toMatchObject({ available: true, screenOnlyFilters: ['estado', 'persona'] })
  })

  it('no ofrece el CSV cuando la pantalla declara la selección no disponible', () => {
    const unavailable = { available: false, reason: 'La pantalla no puede determinar esta selección (lectura incompleta o datos faltantes para los filtros): no se ofrece el CSV.' }
    expect(queueReportLink({ risk: 'ALTO' }, { selectionAvailable: false })).toEqual(unavailable)
    expect(queueReportLink({}, { selectionAvailable: false })).toEqual(unavailable)
    expect(queueReportLink({ risk: 'ALTO' }, { selectionAvailable: true })).toMatchObject({ available: true, href: '/api/reports/queue?risk=ALTO' })
    // El monto inválido conserva su mensaje propio aunque la pantalla también lo marque como no disponible.
    expect(queueReportLink({ minAmount: '-1' }, { selectionAvailable: false })).toMatchObject({ available: false, reason: expect.stringContaining('monto mínimo') })
  })

  it('no ofrece un CSV de otra selección cuando la pantalla rechaza el filtro', () => {
    for (const minAmount of ['-1', 'abc', 'Infinity']) {
      expect(queueReportLink({ minAmount })).toEqual({ available: false, reason: 'Corregí el monto mínimo para descargar el CSV de esta selección.' })
    }
    expect(queueReportLink({ minAmount: '0' })).toMatchObject({ available: true, href: '/api/reports/queue?minAmount=0' })
    for (const filters of [{ risk: 'CRITICO' }, { contact: 'maybe' }, { q: 'x'.repeat(5000) }]) {
      expect(queueReportLink(filters)).toEqual({ available: false, reason: 'Los filtros actuales no son válidos para el CSV; limpialos para descargarlo.' })
    }
  })
})
