import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase-config', () => ({ hasSupabaseCredentials: true }))

import { resolveTenantAccessWithRoleName } from '@/lib/auth/tenant-access'
import { createPaginatedSupabase } from '../fixtures/paginated-supabase'
import type { RawRow } from '@/types/equitas-domain'

const member = { id: 1, user: 42, tenant: 7, role: 3, status: true }
function fixture(members: RawRow[] = [member], options: Parameters<typeof createPaginatedSupabase>[1] = {}, tables: Record<string, RawRow[]> = {}) {
  return createPaginatedSupabase({
    user: [{ id: 42, auth_user: 'synthetic-auth', status: 'ACTIVE' }],
    tenant_user: members,
    tenant: [{ id: 7, status: 'ACTIVE' }, { id: 8, status: 'ACTIVE' }],
    role: [{ id: 3, name: 'consulta' }, { id: 4, name: 'operador' }],
    ...tables,
  }, { enforceFilters: true, ...options })
}

describe('privacidad: la seleccion no sale al transporte antes de verificar membresia', () => {
  it.each(['880019050000011', '8', '0007', '7otro', '', '0', '-1'])('rechaza %j sin ponerlo en filtros HTTP', async selection => {
    const { client, requests } = fixture()
    const { access, roleName } = await resolveTenantAccessWithRoleName('synthetic-auth', client, selection)
    expect(access).toMatchObject({ isAuthorized: false, code: 'TENANT_ACCESS_NOT_FOUND' })
    expect(roleName).toBeNull()
    expect(requests.every(request => Object.values(request.filters).every(value => value !== `eq.${selection}`))).toBe(true)
    expect(requests.every(request => ['user', 'tenant_user'].includes(request.table))).toBe(true)
  })

  it('una seleccion legitima usa el municipio y rol devueltos por el servidor', async () => {
    const { client, requests } = fixture([member, { ...member, id: 2, tenant: 8, role: 4 }])
    expect(await resolveTenantAccessWithRoleName('synthetic-auth', client, '8')).toMatchObject({
      access: { isAuthorized: true, context: { tenantId: '8', role: '4' } }, roleName: 'operador',
    })
    const reads = requests.filter(request => request.table === 'tenant_user')
    expect(reads.length).toBeGreaterThan(0)
    expect(reads.every(request => request.filters.tenant === undefined && request.filters.user === 'eq.42')).toBe(true)
    expect(requests.find(request => request.table === 'tenant')?.filters).toEqual({ id: 'eq.8' })
  })

  it('encuentra la seleccion despues de 1000 membresias, aunque el servidor recorte paginas', async () => {
    const members = Array.from({ length: 1002 }, (_, i) => ({ ...member, id: i + 1, tenant: i + 100 }))
    members.push({ ...member, id: 1003, tenant: 8, role: 4 })
    const { client, requests } = fixture(members, { serverMaxRows: 71 })
    expect(await resolveTenantAccessWithRoleName('synthetic-auth', client, '8')).toMatchObject({ access: { isAuthorized: true, context: { tenantId: '8' } } })
    const reads = requests.filter(request => request.table === 'tenant_user')
    expect(reads.length).toBeGreaterThan(14)
    expect(reads.every(request => request.filters.tenant === undefined && request.filters.user === 'eq.42')).toBe(true)
  })

  it('una membresia inactiva no oculta la elegida activa, ni concede acceso al seleccionarla', async () => {
    const members = [{ ...member, status: false }, { ...member, id: 2, tenant: 8, role: 4 }]
    const selected = fixture(members, { serverMaxRows: 1 })
    expect((await resolveTenantAccessWithRoleName('synthetic-auth', selected.client, '8')).access.isAuthorized).toBe(true)
    const inactive = fixture(members, { serverMaxRows: 1 })
    expect((await resolveTenantAccessWithRoleName('synthetic-auth', inactive.client, '7')).access.code).toBe('TENANT_ACCESS_INACTIVE')
    expect(inactive.requests.every(request => request.table === 'user' || request.table === 'tenant_user')).toBe(true)
  })

  it('la membresia de otro usuario nunca valida la seleccion', async () => {
    const { client } = fixture([member, { ...member, id: 2, user: 43, tenant: 8 }])
    expect((await resolveTenantAccessWithRoleName('synthetic-auth', client, '8')).access.code).toBe('TENANT_ACCESS_NOT_FOUND')
  })

  it.each([undefined, '7'])('membresias activas duplicadas nunca autorizan (%j)', async selection => {
    const { client } = fixture([member, { ...member, id: 2 }], { serverMaxRows: 1 })
    expect((await resolveTenantAccessWithRoleName('synthetic-auth', client, selection)).access.code).toBe('TENANT_SELECTION_REQUIRED')
  })

  it('falla cerrada si una pagina posterior falla, incluso habiendo encontrado la seleccion', async () => {
    const { client } = fixture([member, { ...member, id: 2, tenant: 8 }], {
      serverMaxRows: 1, fail: request => request.table === 'tenant_user' && request.after !== null ? { code: '42501', message: 'synthetic' } : null,
    })
    expect((await resolveTenantAccessWithRoleName('synthetic-auth', client, '7')).access.code).toBe('DATABASE_ERROR')
  })

  it.each([
    ['tenant', [{ id: 8, status: 'INACTIVE' }], 'TENANT_INACTIVE'],
    ['role', [{ id: 4, name: 'importador_sistema' }], 'ROLE_FORBIDDEN'],
  ] as const)('no omite validar %s despues de resolver la seleccion', async (table, rows, code) => {
    const { client } = fixture([{ ...member, tenant: 8, role: 4 }], {}, { [table]: [...rows] })
    expect((await resolveTenantAccessWithRoleName('synthetic-auth', client, '8')).access.code).toBe(code)
  })
})
