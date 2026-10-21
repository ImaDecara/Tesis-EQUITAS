import { beforeEach, describe, expect, it, vi } from 'vitest'

const { browserClient } = vi.hoisted(() => ({ browserClient: vi.fn() }))
vi.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: browserClient }))

import {
  getCurrentAuthUser, mapAuthErrorMessage, signInWithPassword, signOutCurrentSession,
  validateAuthUserTenantAccess, validateCurrentUserTenantAccess,
} from '@/lib/services/auth-service'

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
        limit: vi.fn(async (limit: number) => {
          request.limit = limit
          if (!remaining.length) throw new Error('Unexpected database request')
          return remaining.shift()!
        }),
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
    [null, 'No se pudo iniciar sesion.'],
    [{ message: 'INVALID LOGIN CREDENTIALS' }, 'Email o password incorrectos.'],
    [{ message: 'invalid_credentials' }, 'Email o password incorrectos.'],
    [{ message: 'Email not confirmed' }, 'El email aun no fue confirmado.'],
    [{ message: 'Service unavailable' }, 'Service unavailable'],
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
    const { client, queries } = clientWithReplies([ok([{ id: '42' }]), ok([{ tenant: 7, role: 'operator' }])])
    expect(await validateCurrentUserTenantAccess()).toEqual({ isAuthorized: true, requiresLogin: false,
      context: { authUserId: 'auth-test', appUserId: '42', tenantId: '7', role: 'operator' } })
    expect(client.auth.getUser).toHaveBeenCalledOnce()
    expect(queries).toEqual([
      { table: 'user', filters: [['auth_user', 'auth-test']], limit: 1 },
      { table: 'tenant_user', filters: [['user', 42], ['status', true]], limit: 1 },
    ])
  })

  it.each([
    [ok([]), 'TENANT_ACCESS_NOT_FOUND'],
    [ok([{ status: false }]), 'TENANT_ACCESS_INACTIVE'],
    [{ data: null, error: { message: 'membership read failed', code: '42501' } }, 'DATABASE_ERROR'],
  ] as const)('AUTH-07: sin pertenencia activa consulta estados y rechaza %s', async (fallback, code) => {
    const { queries } = clientWithReplies([ok([{ id: 42 }]), ok([]), fallback])
    const result = await validateAuthUserTenantAccess('auth-test')
    expect(result).toMatchObject({ isAuthorized: false, requiresLogin: false, code })
    expect(result.context).toBeUndefined()
    expect(queries[2]).toEqual({ table: 'tenant_user', filters: [['user', 42]], limit: 20 })
  })

  it('AUTH-08: error leyendo pertenencia no autoriza ni consulta estados adicionales', async () => {
    const { queries } = clientWithReplies([ok([{ id: 42 }]), { data: null, error: { message: 'permission denied' } }])
    expect(await validateAuthUserTenantAccess('auth-test')).toMatchObject({ isAuthorized: false, code: 'DATABASE_ERROR', message: 'Error consultando tenant_user: permission denied' })
    expect(queries).toHaveLength(2)
  })

  it.each([{}, { id: null }, { id: '' }])('AUTH-09: identificador de aplicacion vacio %j no consulta pertenencias', async (row) => {
    const { queries } = clientWithReplies([ok([row])])
    expect(await validateAuthUserTenantAccess('auth-test')).toMatchObject({ isAuthorized: false, code: 'APP_USER_NOT_FOUND' })
    expect(queries).toHaveLength(1)
  })
})
