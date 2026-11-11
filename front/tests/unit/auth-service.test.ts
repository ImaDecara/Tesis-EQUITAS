import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const { browserClient } = vi.hoisted(() => ({ browserClient: vi.fn() }))
vi.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: browserClient }))
vi.mock('@/lib/supabase-config', () => ({ hasSupabaseCredentials: true }))

import {
  getCurrentAuthUser, mapAuthErrorMessage, selectCurrentTenant, signInWithPassword, signOutCurrentSession,
  validateAuthUserTenantAccess, validateCurrentUserTenantAccess,
} from '@/lib/services/auth-service'
import { ACCESS_MESSAGES } from '@/lib/auth/tenant-access'

type Reply = { data: unknown; error: { message: string; code?: string } | null }
const ok = (data: unknown): Reply => ({ data, error: null })

function clientWithReplies(replies: Reply[]) {
  const remaining = [...replies]
  const queries: { table: string; filters: [string, unknown][]; limit?: number }[] = []
  const client = {
    from: vi.fn((table: string) => {
      const request = { table, filters: [] as [string, unknown][], limit: undefined as number | undefined }
      queries.push(request)
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((key: string, value: unknown) => { request.filters.push([key, value]); return query }),
        order: vi.fn(() => query),
        gt: vi.fn(() => query),
        limit: vi.fn((limit: number) => {
          request.limit = limit
          return query
        }),
        then: (resolve: (reply: Reply) => unknown) => {
          if (!remaining.length) throw new Error('Unexpected database request')
          return Promise.resolve(remaining.shift()!).then(resolve)
        },
      }
      return query
    }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'auth-test' } }, error: null }),
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  }
  browserClient.mockReturnValue(client)
  return { client, queries }
}

describe('R-SEG-01 / E04: contrato aislado de autenticacion y pertenencia', () => {
  beforeEach(() => vi.resetAllMocks())

  it('AUTH-01: sin configuracion no autoriza, no inicia sesion y permite salir sin error', async () => {
    browserClient.mockReturnValue(null)
    expect(await getCurrentAuthUser()).toBeNull()
    expect(await signInWithPassword('test@example.test', 'test-only-password')).toMatchObject({ error: { name: 'SupabaseNotConfigured' } })
    await expect(signOutCurrentSession()).resolves.toBeUndefined()
    expect(await validateAuthUserTenantAccess('auth-test')).toMatchObject({ isAuthorized: false, code: 'SUPABASE_NOT_CONFIGURED' })
    expect(await validateCurrentUserTenantAccess()).toMatchObject({ isAuthorized: false, requiresLogin: false, code: 'SUPABASE_NOT_CONFIGURED' })
  })

  it.each([null, { message: 'Invalid login credentials' }])('AUTH-02: transmite credenciales y conserva el error %j', async (error) => {
    const { client } = clientWithReplies([])
    client.auth.signInWithPassword.mockResolvedValue({ error })
    expect(await signInWithPassword('test@example.test', 'test-only-password')).toEqual({ error })
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'test@example.test', password: 'test-only-password' })
  })

  it('AUTH-03: solicita cerrar la sesion exactamente una vez', async () => {
    const { client } = clientWithReplies([])
    await signOutCurrentSession()
    expect(client.auth.signOut).toHaveBeenCalledOnce()
  })

  it.each([
    [null, 'No se pudo iniciar sesión.'],
    [{ message: 'INVALID LOGIN CREDENTIALS' }, 'Correo o contraseña incorrectos.'],
    [{ message: 'invalid_credentials' }, 'Correo o contraseña incorrectos.'],
    [{ message: 'Email not confirmed' }, 'El correo todavía no fue confirmado. Revisá tu bandeja de entrada.'],
    // N7: un mensaje técnico del servidor (en inglés) no llega a la pantalla.
    [{ message: 'Service unavailable' }, 'No se pudo iniciar sesión. Intentá de nuevo en unos minutos.'],
  ])('AUTH-04: mensaje de usuario para %j', (error, expected) => {
    expect(mapAuthErrorMessage(error)).toBe(expected)
  })

  it.each([
    { data: { user: null }, error: null },
    { data: { user: { id: 'auth-test' } }, error: { message: 'expired' } },
  ])('AUTH-05: sesion ausente o invalida requiere login, sin consultar tablas', async (response) => {
    const { client } = clientWithReplies([])
    client.auth.getUser.mockResolvedValue(response)
    expect(await validateCurrentUserTenantAccess()).toMatchObject({ isAuthorized: false, requiresLogin: true, code: 'AUTH_REQUIRED' })
    expect(client.from).not.toHaveBeenCalled()
  })

  it('AUTH-06: usa el usuario validado por Auth y la pertenencia activa', async () => {
    const { client, queries } = clientWithReplies([ok([{ id: '42', auth_user: 'auth-test', status: 'ACTIVE' }]), ok([{ user: 42, tenant: 7, role: 3, status: true }]), ok([{ id: 7, status: 'ACTIVE' }]), ok([{ id: 3, name: 'USER' }])])
    expect(await validateCurrentUserTenantAccess()).toEqual({ isAuthorized: true, requiresLogin: false,
      context: { authUserId: 'auth-test', appUserId: '42', tenantId: '7', role: '3' } })
    expect(client.auth.getUser).toHaveBeenCalledOnce()
    expect(queries).toEqual([
      { table: 'user', filters: [['auth_user', 'auth-test']], limit: 2 },
      { table: 'tenant_user', filters: [['user', '42'], ['status', true]], limit: 2 },
      { table: 'tenant', filters: [['id', '7']], limit: 1 },
      { table: 'role', filters: [['id', '3']], limit: 1 },
    ])
  })

  it('AUTH-06 / E06: conserva el cliente y su sesion al validar pertenencia', async () => {
    const { client, queries } = clientWithReplies([ok([{ id: 42, auth_user: 'auth-test', status: 'ACTIVE' }]), ok([{ user: 42, tenant: 7, role: 3, status: true }]), ok([{ id: 7, status: 'ACTIVE' }]), ok([{ id: 3, name: 'USER' }])])
    browserClient.mockClear()
    expect(await validateAuthUserTenantAccess('auth-test', client as unknown as SupabaseClient)).toMatchObject({
      isAuthorized: true, context: { authUserId: 'auth-test', appUserId: '42', tenantId: '7', role: '3' },
    })
    expect(browserClient).not.toHaveBeenCalled()
    expect(queries.map(query => query.table)).toEqual(['user', 'tenant_user', 'tenant', 'role'])
  })

  it.each(['ADMIN', 'USER'])('noche 7: el rol %s ingresa con el mismo resultado', async name => {
    clientWithReplies([ok([{ id: 42, auth_user: 'auth-test', status: 'ACTIVE' }]), ok([{ user: 42, tenant: 7, role: 3, status: true }]), ok([{ id: 7, status: 'ACTIVE' }]), ok([{ id: 3, name }])])
    expect(await validateAuthUserTenantAccess('auth-test')).toEqual({ isAuthorized: true, requiresLogin: false,
      context: { authUserId: 'auth-test', appUserId: '42', tenantId: '7', role: '3' } })
  })

  it.each(['consulta', 'operador', 'supervisor', 'importador', 'importador_sistema', 'admin'])('noche 7: el rol no reconocido %s no ingresa y recibe el mensaje vigente', async name => {
    clientWithReplies([ok([{ id: 42, auth_user: 'auth-test', status: 'ACTIVE' }]), ok([{ user: 42, tenant: 7, role: 3, status: true }]), ok([{ id: 7, status: 'ACTIVE' }]), ok([{ id: 3, name }])])
    expect(await validateAuthUserTenantAccess('auth-test')).toEqual({ isAuthorized: false, requiresLogin: false, code: 'ROLE_FORBIDDEN', message: ACCESS_MESSAGES.ROLE_FORBIDDEN })
  })

  it('SUP-AUTH-01: el resultado publico lleva el ID del rol y ningun campo mas, tambien con la fixture E06', async () => {
    clientWithReplies([ok([{ id: 910001, auth_user: 'auth-test', status: 'ACTIVE' }]), ok([{ user: 910001, tenant: 910001, role: 910001, status: true }]), ok([{ id: 910001, status: 'ACTIVE' }]), ok([{ id: 910001, name: 'tp_operator' }])])
    expect(await validateAuthUserTenantAccess('auth-test')).toEqual({
      isAuthorized: true, requiresLogin: false,
      context: { authUserId: 'auth-test', appUserId: '910001', tenantId: '910001', role: '910001' },
    })
  })

  it.each([
    [ok([]), 'TENANT_ACCESS_NOT_FOUND'],
    [ok([{ status: false }]), 'TENANT_ACCESS_INACTIVE'],
    [{ data: null, error: { message: 'membership read failed', code: '42501' } }, 'DATABASE_ERROR'],
  ] as const)('AUTH-07: sin pertenencia activa consulta estados y rechaza %s', async (fallback, code) => {
    const { queries } = clientWithReplies([ok([{ id: 42, auth_user: 'auth-test', status: 'ACTIVE' }]), ok([]), fallback])
    const result = await validateAuthUserTenantAccess('auth-test')
    expect(result).toMatchObject({ isAuthorized: false, requiresLogin: false, code })
    expect(result.context).toBeUndefined()
    expect(queries[2]).toEqual({ table: 'tenant_user', filters: [['user', '42']], limit: 2 })
  })

  it('AUTH-08: error leyendo pertenencia no autoriza ni consulta estados adicionales', async () => {
    const { queries } = clientWithReplies([ok([{ id: 42, auth_user: 'auth-test', status: 'ACTIVE' }]), { data: null, error: { message: 'permission denied' } }])
    expect(await validateAuthUserTenantAccess('auth-test')).toMatchObject({ isAuthorized: false, code: 'DATABASE_ERROR', message: 'No disponible: no se pudo verificar la membresía.' })
    expect(queries).toHaveLength(2)
  })

  it.each([{}, { id: null }, { id: '' }])('AUTH-09: identificador de aplicacion vacio %j no consulta pertenencias', async (row) => {
    const { queries } = clientWithReplies([ok([row])])
    expect(await validateAuthUserTenantAccess('auth-test')).toMatchObject({ isAuthorized: false, code: 'APP_USER_NOT_FOUND' })
    expect(queries).toHaveLength(1)
  })
})

describe('ALIGN-019: la seleccion de municipio es explicita y no confiere permisos', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals() })
  const authorized = () => [ok([{ id: 42, auth_user: 'auth-test', status: 'ACTIVE' }]),
    ok([{ user: 42, tenant: 7, role: 3, status: true }]), ok([{ id: 7, status: 'ACTIVE' }]), ok([{ id: 3, name: 'USER' }])]
  const selected = () => [authorized()[0], ok([{ id: 1, user: 42, tenant: 7, role: 3, status: true }]), ok([]), ...authorized().slice(2)]

  it.each(['https:', 'http:'])('guarda la eleccion solo despues de validarla (%s)', async protocol => {
    const document = { cookie: '' }
    vi.stubGlobal('document', document)
    vi.stubGlobal('location', { protocol })
    const { queries } = clientWithReplies(selected())
    expect((await selectCurrentTenant('7')).isAuthorized).toBe(true)
    expect(queries[1].filters).toEqual([['user', '42']])
    expect(document.cookie).toBe(`equitas_tenant_id=7; Path=/; SameSite=Lax${protocol === 'https:' ? '; Secure' : ''}`)
  })

  it('una seleccion denegada no escribe cookies', async () => {
    const document = { cookie: 'preferencia=valor' }
    vi.stubGlobal('document', document)
    clientWithReplies([authorized()[0], ok([]), ok([])])
    expect((await selectCurrentTenant('8')).isAuthorized).toBe(false)
    expect(document.cookie).toBe('preferencia=valor')
    expect((await selectCurrentTenant('8inyectado')).isAuthorized).toBe(false)
    expect(document.cookie).toBe('preferencia=valor')
  })

  it('cerrar o iniciar sesion borra selecciones anteriores', async () => {
    const document = { cookie: 'equitas_tenant_id=8' }
    vi.stubGlobal('document', document)
    clientWithReplies([])
    await signOutCurrentSession()
    expect(document.cookie).toContain('Max-Age=0')
    document.cookie = 'equitas_tenant_id=8'
    await signInWithPassword('test@example.test', 'test-only-password')
    expect(document.cookie).toContain('Max-Age=0')
  })

  it('null pide opciones nuevas mientras la consulta normal revalida la cookie', async () => {
    vi.stubGlobal('document', { cookie: 'preferencia=valor; equitas_tenant_id=7' })
    const first = clientWithReplies(selected())
    await validateCurrentUserTenantAccess()
    expect(first.queries[1].filters).toEqual([['user', '42']])
    const second = clientWithReplies(authorized())
    await validateCurrentUserTenantAccess(null)
    expect(second.queries[1].filters).not.toContainEqual(['tenant', '7'])
  })
})
