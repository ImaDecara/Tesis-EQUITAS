import { beforeEach, describe, expect, it, vi } from 'vitest'

const { serverClient, cookieStore } = vi.hoisted(() => ({
  serverClient: vi.fn(), cookieStore: vi.fn(),
}))
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient: serverClient }))
vi.mock('@/lib/supabase-config', () => ({ hasSupabaseCredentials: true }))
vi.mock('next/headers', () => ({ cookies: cookieStore }))

import { requireTenantAccess, createTenantReader, type DalPermission } from '@/lib/server/dal'
import type { RawRow } from '@/types/equitas-domain'
import { loadRawDebtorData } from '@/lib/data/raw-debtor-loader'
import { getPeopleDataFromService } from '@/lib/services/person-data-service'
import { getDashboardDataFromService } from '@/lib/services/dashboard-data-service'
import { getDebtorDetailDataFromService, getDebtorsDataFromService } from '@/lib/services/debtor-data-service'
import { createPaginatedSupabase } from '../fixtures/paginated-supabase'

const appUser = { id: 42, auth_user: 'auth-test', status: 'ACTIVE' }
const membership = { id: 1, user: 42, tenant: 7, role: 3, status: true }
const loaders = [
  ['objetos/colas/mora/riesgo/acciones', getDebtorsDataFromService],
  ['detalle', () => getDebtorDetailDataFromService('99')],
  ['personas', getPeopleDataFromService],
  ['dashboard', getDashboardDataFromService],
  ['cargador crudo', loadRawDebtorData],
] as const

function clientFor(tables: Record<string, RawRow[]> = {}, signedIn = true, options: Parameters<typeof createPaginatedSupabase>[1] = {}) {
  const fixture = createPaginatedSupabase({
    user: [appUser], tenant_user: [membership],
    tenant: [{ id: 7, status: 'ACTIVE' }], role: [{ id: 3, name: 'consulta' }],
    debtor: [{ id: 99, tenant: 7, identifier: 'CARTERA-SINTETICA' }],
    ...tables,
  }, { enforceFilters: true, ...options })
  vi.spyOn(fixture.client.auth, 'getUser').mockResolvedValue(signedIn
    ? { data: { user: { id: 'auth-test' } }, error: null } as never
    : { data: { user: null }, error: null } as never)
  serverClient.mockResolvedValue(fixture.client)
  return fixture
}

describe('ALIGN-019: denegar antes de consultar cartera, incluso con RLS permisiva', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    cookieStore.mockResolvedValue({ get: () => undefined })
  })

  it.each(loaders)('%s no lee cartera sin identidad validada por Auth', async (_name, load) => {
    const { client, requests } = clientFor({}, false)
    await expect(load()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    expect(client.auth.getUser).toHaveBeenCalledOnce()
    expect(requests).toEqual([])
  })

  it.each([
    ['sin usuario de aplicación', { user: [] }, 'APP_USER_NOT_FOUND'],
    ['usuario inactivo', { user: [{ ...appUser, status: 'INACTIVE' }] }, 'APP_USER_INACTIVE'],
    ['sin membresía', { tenant_user: [] }, 'TENANT_ACCESS_NOT_FOUND'],
    ['membresía inactiva', { tenant_user: [{ ...membership, status: false }] }, 'TENANT_ACCESS_INACTIVE'],
    ['dos membresías sin selección', { tenant_user: [membership, { ...membership, id: 2, tenant: 8 }] }, 'TENANT_SELECTION_REQUIRED'],
    ['rol de máquina', { role: [{ id: 3, name: 'importador_sistema' }] }, 'ROLE_FORBIDDEN'],
    ['rol desconocido', { role: [{ id: 3, name: 'admin' }] }, 'ROLE_FORBIDDEN'],
    ['municipio inactivo', { tenant: [{ id: 7, status: 'INACTIVE' }] }, 'TENANT_INACTIVE'],
  ])('%s: rechazo explícito, sin lista vacía ni cero', async (_name, tables, code) => {
    const { requests } = clientFor(tables)
    await expect(loadRawDebtorData()).rejects.toMatchObject({ code })
    expect(requests.every(request => ['user', 'tenant_user', 'tenant', 'role'].includes(request.table))).toBe(true)
  })
})

describe('ALIGN-019: contexto, permisos y aislamiento en cada lectura', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    cookieStore.mockResolvedValue({ get: () => undefined })
  })

  it('la identidad viene de getUser aunque el storage de sesion diga otra cosa', async () => {
    const { client } = clientFor()
    vi.spyOn(client.auth, 'getSession').mockResolvedValue({ data: { session: { user: { id: 'forged-identity' }, access_token: 'synthetic-token' } }, error: null } as never)
    const result = await requireTenantAccess()
    expect(result.supabase).toBe(client)
    expect(result.context).toEqual({ authUserId: 'auth-test', appUserId: '42', tenantId: '7', roleId: '3', roleName: 'consulta' })
    expect(client.auth.getUser).toHaveBeenCalledOnce()
  })

  it.each(['consulta', 'operador', 'supervisor'])('permite lectura al rol aprobado %s', async name => {
    clientFor({ role: [{ id: 3, name }] })
    expect((await loadRawDebtorData()).debtors.map(row => row.id)).toEqual([99])
  })

  // Matriz completa: ALIGN-003 y las funciones de ALIGN-018@76863d7. Lo que no figura se deniega.
  const CAPABILITIES: Record<string, readonly DalPermission[]> = {
    consulta: ['portfolio:read', 'decision:read'],
    operador: ['portfolio:read', 'decision:read', 'report:object-identifier', 'decision:record'],
    supervisor: ['portfolio:read', 'decision:read', 'report:object-identifier', 'decision:approve', 'supervision:read'],
    importador: ['import:write'],
    tp_operator: ['portfolio:read'],
  }
  const PERMISSIONS: readonly DalPermission[] = ['portfolio:read', 'decision:read', 'report:object-identifier', 'decision:record', 'decision:approve', 'supervision:read', 'import:write']
  it.each(Object.entries(CAPABILITIES).flatMap(([name, allowed]) =>
    PERMISSIONS.map(permission => [name, permission, allowed.includes(permission)] as const)))('%s / %s: permitido=%s', async (name, permission, allowed) => {
    const { requests } = clientFor({ role: [{ id: 3, name }] })
    const result = requireTenantAccess({ permission })
    if (allowed) expect((await result).context.roleName).toBe(name)
    else await expect(result).rejects.toMatchObject({ code: 'ROLE_FORBIDDEN', status: 403 })
    expect(requests.every(request => ['user', 'tenant_user', 'tenant', 'role'].includes(request.table))).toBe(true)
  })

  it('tp_operator lee cartera de su municipio y su contexto no lo presenta como rol de producto', async () => {
    const { requests } = clientFor({ role: [{ id: 3, name: 'tp_operator' }], debtor: [{ id: 99, tenant: 7 }, { id: 100, tenant: 8, identifier: 'AJENO' }] })
    expect((await loadRawDebtorData()).debtors.map(row => row.id)).toEqual([99])
    expect(requests.find(request => request.table === 'debtor')?.filters).toEqual({ tenant: 'eq.7' })
    expect((await requireTenantAccess()).context).toEqual({ authUserId: 'auth-test', appUserId: '42', tenantId: '7', roleId: '3', roleName: 'tp_operator' })
    const { WEB_ROLES, E06_READ_ONLY_COMPAT_ROLE } = await import('@/lib/auth/tenant-access')
    expect(E06_READ_ONLY_COMPAT_ROLE).toBe('tp_operator')
    expect(WEB_ROLES).not.toContain(E06_READ_ONLY_COMPAT_ROLE)
  })

  it.each([
    'TP_OPERATOR', 'tp_operator ', ' tp_operator', 'tp-operator', 'operator', 'tp_operator2', 'admin', '910001', '3', 'importador_sistema', '', null,
  ])('el nombre de rol debe coincidir exactamente; %j se deniega', async name => {
    clientFor({ role: [{ id: 3, name }] })
    await expect(requireTenantAccess()).rejects.toMatchObject({ code: 'ROLE_FORBIDDEN' })
  })

  it('un permiso desconocido en tiempo de ejecucion se deniega', async () => {
    clientFor({ role: [{ id: 3, name: 'supervisor' }] })
    await expect(requireTenantAccess({ permission: 'export:all' as DalPermission })).rejects.toMatchObject({ code: 'ROLE_FORBIDDEN' })
  })

  it('dos membresias: solo la eleccion explicita determina el tenant y su rol', async () => {
    const { requests } = clientFor({
      tenant_user: [membership, { ...membership, id: 2, tenant: 8, role: 4 }],
      tenant: [{ id: 7, status: 'ACTIVE' }, { id: 8, status: 'ACTIVE' }],
      role: [{ id: 3, name: 'consulta' }, { id: 4, name: 'operador' }],
    })
    expect((await requireTenantAccess({ tenantId: '8', permission: 'decision:record' })).context).toMatchObject({ tenantId: '8', roleId: '4', roleName: 'operador' })
    expect(requests.find(request => request.table === 'tenant_user')?.filters).toEqual({ user: 'eq.42', status: 'eq.true', tenant: 'eq.8' })
  })

  it.each(['8', '7otro', '', '0', '-1', '01'])('no acepta tenant ajeno o seleccion invalida %j', async tenantId => {
    const { requests } = clientFor()
    await expect(requireTenantAccess({ tenantId })).rejects.toMatchObject({ code: 'TENANT_ACCESS_NOT_FOUND' })
    expect(requests.some(request => request.table === 'debtor')).toBe(false)
  })

  it('la cookie solo selecciona: se revalida contra las membresias del usuario', async () => {
    clientFor()
    cookieStore.mockResolvedValue({ get: () => ({ value: '8' }) })
    await expect(loadRawDebtorData()).rejects.toMatchObject({ code: 'TENANT_ACCESS_NOT_FOUND' })
    cookieStore.mockResolvedValue({ get: () => ({ value: '7' }) })
    expect((await loadRawDebtorData()).debtors).toHaveLength(1)
  })

  it('la siguiente entrada no reutiliza autorizacion de una sesion revocada', async () => {
    const { client, requests } = clientFor()
    await loadRawDebtorData()
    requests.length = 0
    vi.mocked(client.auth.getUser).mockResolvedValue({ data: { user: null }, error: null } as never)
    await expect(loadRawDebtorData()).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 })
    expect(requests).toEqual([])
  })

  it('sin configuracion falla como no disponible; no devuelve cartera vacia', async () => {
    serverClient.mockResolvedValue(null)
    await expect(loadRawDebtorData()).rejects.toMatchObject({ code: 'SUPABASE_NOT_CONFIGURED', status: 503 })
  })

  it('un fallo de Auth es no disponible y no consulta tablas', async () => {
    const { client, requests } = clientFor()
    vi.mocked(client.auth.getUser).mockRejectedValue(new Error('secreto sintetico no debe salir'))
    await expect(loadRawDebtorData()).rejects.toMatchObject({ code: 'AUTH_UNAVAILABLE', status: 503 })
    expect(requests).toEqual([])
  })

  it.each(['user', 'tenant_user', 'tenant', 'role'])('un fallo de %s corta la autorizacion', async table => {
    const { requests } = clientFor({}, true, { fail: request => request.table === table ? { code: '42501', message: 'detalle interno sintetico' } : null })
    await expect(loadRawDebtorData()).rejects.toMatchObject({ code: 'DATABASE_ERROR', status: 503 })
    expect(requests.some(request => request.table === 'debtor')).toBe(false)
  })

  it('el lector no acepta tablas fuera del contrato', async () => {
    const { requests } = clientFor()
    const reader = await createTenantReader()
    requests.length = 0
    await expect(reader.readTable('user' as never)).rejects.toMatchObject({ code: 'TABLE_FORBIDDEN' })
    expect(requests).toEqual([])
  })

  it('filtra todas las relaciones por tenant en cada pagina y elimina los joins del DTO', async () => {
    const rows = (make: (tenant: number) => RawRow) => [
      { id: 1, ...make(7) }, { id: 2, ...make(8) }, { id: 3, ...make(7) },
    ]
    const links = (tenant: number) => [{ active: true, __debtor: { tenant } }]
    const { requests } = clientFor({
      debtor: rows(tenant => ({ tenant })),
      debt: rows(tenant => ({ debtor: tenant, __scope: { tenant } })),
      debtor_person: rows(tenant => ({ debtor: tenant, __scope: { tenant } })),
      debtor_profile: rows(tenant => ({ debtor: tenant, __scope: { tenant } })),
      person: rows(tenant => ({ __links: links(tenant) })),
      debtor_contact: rows(tenant => ({ person: tenant, __person: { __links: links(tenant) } })),
      debtor_profile_detail: rows(tenant => ({ __scope: { __debtor: { tenant } }, __person: { __links: links(tenant) } })),
    }, true, { serverMaxRows: 1 })
    const reader = await createTenantReader()
    const expected = {
      debtor: ['tenant'], debt: ['__scope.tenant'], debtor_person: ['__scope.tenant'], debtor_profile: ['__scope.tenant'],
      person: ['__links.active', '__links.__debtor.tenant'],
      debtor_contact: ['__person.__links.active', '__person.__links.__debtor.tenant'],
      debtor_profile_detail: ['__scope.__debtor.tenant', '__person.__links.active', '__person.__links.__debtor.tenant'],
    }
    for (const [table, filters] of Object.entries(expected)) {
      const result = await reader.readTable(table as keyof typeof expected)
      expect(result.warning, table).toBeNull()
      expect(result.rows.map(row => row.id), table).toEqual([1, 3])
      expect(result.rows.every(row => Object.keys(row).every(key => !key.startsWith('__')))).toBe(true)
      const calls = requests.filter(request => request.table === table)
      expect(calls).toHaveLength(3)
      for (const call of calls) {
        expect(Object.keys(call.filters), table).toEqual(filters)
        if (table !== 'debtor') expect(call.select).toContain('!inner(')
        expect(Object.values(call.filters).every(value => value === 'eq.7' || value === 'eq.true')).toBe(true)
      }
    }
  })

  it('un ID de detalle de otro municipio no entrega datos', async () => {
    clientFor({ debtor: [{ id: 99, tenant: 7 }, { id: 100, tenant: 8, identifier: 'AJENO' }] })
    expect((await getDebtorDetailDataFromService('100')).detail).toBeNull()
    expect((await getDebtorDetailDataFromService('99')).detail?.debtor.id).toBe('99')
  })
})

it('el limite de filas del servidor no oculta la segunda membresia', async () => {
  cookieStore.mockResolvedValue({ get: () => undefined })
  clientFor({ tenant_user: [membership, { ...membership, id: 2, tenant: 8 }] }, true, { serverMaxRows: 1 })
  await expect(requireTenantAccess()).rejects.toMatchObject({ code: 'TENANT_SELECTION_REQUIRED' })
})

it('la relacion activa y el tenant deben pertenecer al mismo enlace de persona', async () => {
  cookieStore.mockResolvedValue({ get: () => undefined })
  clientFor({ person: [{ id: 1, __links: [
    { active: false, __debtor: { tenant: 7 } }, { active: true, __debtor: { tenant: 8 } },
  ] }] })
  const result = await getPeopleDataFromService()
  expect(result.people).toEqual([])
  expect(result.warnings).toEqual([])
})

it('las opciones de seleccion incluyen todas las membresias propias, incluso tras la primera pagina', async () => {
  cookieStore.mockResolvedValue({ get: () => undefined })
  const { client } = clientFor({ tenant_user: [
    { ...membership, selection: { name: 'Municipio A' } },
    { ...membership, id: 2, tenant: 8, selection: { name: 'Municipio B' } },
    { ...membership, id: 3, tenant: 9, selection: { name: 'Municipio C' } },
    { ...membership, id: 4, user: 999, tenant: 10, selection: { name: 'Municipio ajeno' } },
  ] }, true, { serverMaxRows: 1 })
  const { resolveTenantAccess } = await import('@/lib/auth/tenant-access')
  const access = await resolveTenantAccess('auth-test', client)
  expect(access).toMatchObject({ code: 'TENANT_SELECTION_REQUIRED', isAuthorized: false,
    tenantChoices: [{ id: '7', name: 'Municipio A' }, { id: '8', name: 'Municipio B' }, { id: '9', name: 'Municipio C' }] })
})
