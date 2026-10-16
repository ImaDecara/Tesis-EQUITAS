import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createBrowserSupabaseClientMock } = vi.hoisted(() => ({
  createBrowserSupabaseClientMock: vi.fn(),
}))

vi.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: createBrowserSupabaseClientMock,
}))

import { validateAuthUserTenantAccess } from '@/lib/services/auth-service'

type QueryResult = {
  data: unknown
  error: { message: string; code?: string | null } | null
}

function buildQuery(result: QueryResult) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    limit: vi.fn().mockResolvedValue(result),
  }

  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)

  return query
}

function configureClient(results: { appUser: QueryResult; tenantUser: QueryResult }) {
  const appUserQuery = buildQuery(results.appUser)
  const tenantUserQuery = buildQuery(results.tenantUser)
  const from = vi.fn((table: string) => {
    if (table === 'user') {
      return appUserQuery
    }

    return tenantUserQuery
  })

  createBrowserSupabaseClientMock.mockReturnValue({ from })

  return { appUserQuery, tenantUserQuery, from }
}

describe('integracion simulada de autorizacion con Supabase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('valida la relacion auth.users, public.user y tenant_user activa', async () => {
    const client = configureClient({
      appUser: { data: [{ id: 42, auth_user: 'auth-user-1' }], error: null },
      tenantUser: { data: [{ tenant: 7, role: 'operator', status: true }], error: null },
    })

    const result = await validateAuthUserTenantAccess('auth-user-1')

    expect(result).toEqual({
      isAuthorized: true,
      requiresLogin: false,
      context: {
        authUserId: 'auth-user-1',
        appUserId: '42',
        tenantId: '7',
        role: 'operator',
      },
    })
    expect(client.from).toHaveBeenCalledWith('user')
    expect(client.from).toHaveBeenCalledWith('tenant_user')
  })

  it('rechaza una cuenta Auth sin registro asociado en public.user', async () => {
    configureClient({
      appUser: { data: [], error: null },
      tenantUser: { data: [], error: null },
    })

    const result = await validateAuthUserTenantAccess('auth-user-1')

    expect(result).toMatchObject({
      isAuthorized: false,
      requiresLogin: false,
      code: 'APP_USER_NOT_FOUND',
    })
  })

  it('informa un error de permisos de la consulta sin autorizar acceso', async () => {
    configureClient({
      appUser: {
        data: null,
        error: { code: '42501', message: 'permission denied for table user' },
      },
      tenantUser: { data: [], error: null },
    })

    const result = await validateAuthUserTenantAccess('auth-user-1')

    expect(result).toEqual({
      isAuthorized: false,
      requiresLogin: false,
      code: 'DATABASE_ERROR',
      message: 'Error consultando public.user: permission denied for table user',
    })
  })

  it('valida que el identificador de public.user sea numerico antes de consultar tenant_user', async () => {
    const client = configureClient({
      appUser: { data: [{ id: 'no-numerico' }], error: null },
      tenantUser: { data: [], error: null },
    })

    const result = await validateAuthUserTenantAccess('auth-user-1')

    expect(result).toMatchObject({
      isAuthorized: false,
      requiresLogin: false,
      code: 'APP_USER_NOT_FOUND',
    })
    expect(client.from).toHaveBeenCalledTimes(1)
  })
})
