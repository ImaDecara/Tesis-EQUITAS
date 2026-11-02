import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

type CookieOut = { name: string; value: string; options: Record<string, unknown> }
const { getUser, credentials, pending } = vi.hoisted(() => ({
  getUser: vi.fn(), credentials: { value: true },
  pending: { cookies: [] as CookieOut[], headers: {} as Record<string, string> },
}))
vi.mock('@/lib/supabase-config', () => ({
  get hasSupabaseCredentials() { return credentials.value },
  supabaseUrl: 'http://127.0.0.1:1', supabasePublishableKey: 'sb_publishable_fixture',
}))
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, { cookies }: { cookies: { setAll: (values: CookieOut[], headers: Record<string, string>) => void } }) => ({
    auth: { getUser: async () => {
      if (pending.cookies.length) cookies.setAll(pending.cookies, pending.headers)
      return getUser()
    } },
  }),
}))

import { proxy } from '@/proxy'

const anonymous = { data: { user: null }, error: new AuthSessionMissingError() }
const signedIn = { data: { user: { id: 'auth-test' } }, error: null }
// NextRequest reescribe los hosts locales a localhost; un host comun evita ese artefacto.
const request = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(new URL(path, 'https://equitas.test'), { headers })
const passedThrough = (response: Response) => response.headers.get('x-middleware-next') === '1'

describe('ALIGN-019 B2: comprobacion optimista en proxy, sin reemplazar la DAL', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    credentials.value = true
    pending.cookies = []
    pending.headers = {}
  })

  it.each([
    ['/', 'https://equitas.test/login'],
    ['/debtors', 'https://equitas.test/login?next=%2Fdebtors'],
    ['/debtors/99', 'https://equitas.test/login?next=%2Fdebtors%2F99'],
    ['/people', 'https://equitas.test/login?next=%2Fpeople'],
    ['/ruta-nueva-sin-listar', 'https://equitas.test/login?next=%2Fruta-nueva-sin-listar'],
  ])('sin sesion, %s responde 307 a login conservando la ruta', async (path, location) => {
    getUser.mockResolvedValue(anonymous)
    const response = await proxy(request(path))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(location)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(passedThrough(response)).toBe(false)
  })

  it('una peticion RSC anonima recibe el mismo 307, sin el parametro interno', async () => {
    getUser.mockResolvedValue(anonymous)
    const response = await proxy(request('/debtors?_rsc=abc&q=dato', { RSC: '1' }))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://equitas.test/login?next=%2Fdebtors')
  })

  it.each(['/login', '/select-tenant', '/api/build-info'])('sin sesion, %s no redirige', async path => {
    getUser.mockResolvedValue(anonymous)
    expect(passedThrough(await proxy(request(path)))).toBe(true)
  })

  it.each(['/login/otra', '/select-tenant/otra', '/api/build-info/otra', '/api/otra'])('la excepcion es exacta: %s redirige', async path => {
    getUser.mockResolvedValue(anonymous)
    expect((await proxy(request(path))).status).toBe(307)
  })

  it('una sesion valida pasa siempre: la DAL decide despues', async () => {
    getUser.mockResolvedValue(signedIn)
    expect(passedThrough(await proxy(request('/debtors')))).toBe(true)
  })

  it.each([
    ['JWT invalido', new AuthApiError('invalid JWT', 401, 'bad_jwt')],
    ['sesion revocada', new AuthApiError('session missing', 403, 'session_not_found')],
  ])('%s equivale a no tener sesion', async (_name, error) => {
    getUser.mockResolvedValue({ data: { user: null }, error })
    expect((await proxy(request('/debtors'))).status).toBe(307)
  })

  it.each([
    ['caida de Auth', () => getUser.mockResolvedValue({ data: { user: null }, error: new AuthRetryableFetchError('fetch failed', 0) })],
    ['excepcion inesperada', () => getUser.mockRejectedValue(new Error('inesperado'))],
  ])('%s: no manda a login, la DAL falla cerrada como no disponible', async (_name, arrange) => {
    arrange()
    expect(passedThrough(await proxy(request('/debtors')))).toBe(true)
  })

  it('la redireccion conserva la limpieza de cookies y las cabeceras de Auth', async () => {
    pending.cookies = [{ name: 'sb-test-auth-token', value: '', options: { path: '/', maxAge: 0 } }]
    pending.headers = { Expires: '0', Pragma: 'no-cache' }
    getUser.mockResolvedValue({ data: { user: null }, error: new AuthApiError('invalid refresh', 400, 'refresh_token_not_found') })
    const response = await proxy(request('/debtors'))
    expect(response.status).toBe(307)
    expect(response.cookies.get('sb-test-auth-token')).toMatchObject({ value: '', maxAge: 0, path: '/' })
    expect(response.headers.get('expires')).toBe('0')
    expect(response.headers.get('pragma')).toBe('no-cache')
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('una ruta que cambiaria de host nunca viaja en next', async () => {
    getUser.mockResolvedValue(anonymous)
    const forged = new NextRequest('https://equitas.test/x')
    forged.nextUrl.pathname = '//otro.example/debtors'
    const response = await proxy(forged)
    expect(response.status).toBe(307)
    expect(new URL(response.headers.get('location')!).host).toBe('equitas.test')
    expect(response.headers.get('location')).not.toContain('otro.example')
  })

  it('sin configuracion no redirige: la DAL responde no disponible', async () => {
    credentials.value = false
    expect(passedThrough(await proxy(request('/debtors')))).toBe(true)
    expect(getUser).not.toHaveBeenCalled()
  })
})
