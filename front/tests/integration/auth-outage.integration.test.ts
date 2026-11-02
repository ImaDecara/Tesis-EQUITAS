import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Solo se reemplaza el acceso a cookies y la URL: corre el SDK real (@supabase/ssr y auth-js) con HTTP real en 127.0.0.1.
const { target, cookieStore } = vi.hoisted(() => ({ target: { url: '' }, cookieStore: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: cookieStore }))
vi.mock('@/lib/supabase-config', () => ({
  hasSupabaseCredentials: true, supabasePublishableKey: 'sb_publishable_fixture',
  get supabaseUrl() { return target.url },
}))

import { requireTenantAccess } from '@/lib/server/dal'
import { proxy } from '@/proxy'

// El SDK guarda la sesion en esta cookie; la clave depende del primer rotulo del host (127).
const SESSION_COOKIE = 'sb-127-auth-token'
const session = () => JSON.stringify({
  access_token: 'synthetic.access.token', refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'auth-test', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
})

let server: Server | null = null
let requests: string[] = []

async function listen(status: number, body: string) {
  server = createServer((request, response) => {
    requests.push(request.url ?? '')
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(body)
  })
  await new Promise<void>(done => server!.listen(0, '127.0.0.1', done))
  target.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

// Reserva un puerto del sistema y lo cierra: nadie escucha en esa direccion.
async function closedPort() {
  const probe = createServer()
  await new Promise<void>(done => probe.listen(0, '127.0.0.1', done))
  const { port } = probe.address() as AddressInfo
  await new Promise(done => probe.close(done))
  target.url = `http://127.0.0.1:${port}`
}

function signedInCookies(present = true) {
  const values = present ? [{ name: SESSION_COOKIE, value: session() }] : []
  cookieStore.mockResolvedValue({ getAll: () => values, get: () => undefined, set: () => undefined })
  return values.map(({ name, value }) => `${name}=${encodeURIComponent(value)}`).join('; ')
}
const page = (cookie: string) => new NextRequest('https://equitas.test/debtors', { headers: cookie ? { cookie } : {} })
const passedThrough = (response: Response) => response.headers.get('x-middleware-next') === '1'

describe('ALIGN-019 M1: el SDK real distingue caida de Auth y sesion ausente', () => {
  beforeEach(() => { requests = [] })
  afterEach(async () => {
    if (server) await new Promise(done => server!.close(done))
    server = null
  })

  it('puerto cerrado: AUTH_UNAVAILABLE con 503 y sin consultar tablas', async () => {
    await closedPort()
    signedInCookies()
    await expect(requireTenantAccess()).rejects.toMatchObject({ code: 'AUTH_UNAVAILABLE', status: 503 })
  })

  it('puerto cerrado: proxy no manda a login y la DAL sigue siendo quien deniega', async () => {
    await closedPort()
    expect(passedThrough(await proxy(page(signedInCookies())))).toBe(true)
  })

  it.each([
    ['gateway 502', 502, 'bad gateway'],
    ['servicio 503', 503, '{"message":"unavailable"}'],
    ['error interno con JSON', 500, '{"code":"unexpected_failure","message":"x"}'],
    ['error interno ilegible', 500, '<html>'],
    ['limite de solicitudes', 429, '{"code":"over_request_rate_limit","message":"x"}'],
  ])('%s: AUTH_UNAVAILABLE, proxy deja pasar', async (_name, status, body) => {
    await listen(status, body)
    signedInCookies()
    await expect(requireTenantAccess()).rejects.toMatchObject({ code: 'AUTH_UNAVAILABLE', status: 503 })
    expect(passedThrough(await proxy(page(signedInCookies())))).toBe(true)
    expect(requests.every(url => url.startsWith('/auth/v1/user'))).toBe(true)
  })

  it.each([
    ['JWT rechazado', 401, '{"code":"bad_jwt","message":"x"}'],
    ['sesion revocada', 403, '{"code":"session_not_found","message":"x"}'],
    ['usuario borrado', 403, '{"code":"user_not_found","message":"x"}'],
  ])('%s: AUTH_REQUIRED con 401, proxy redirige a login', async (_name, status, body) => {
    await listen(status, body)
    signedInCookies()
    await expect(requireTenantAccess()).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 })
    const response = await proxy(page(signedInCookies()))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://equitas.test/login?next=%2Fdebtors')
    expect(requests.every(url => url.startsWith('/auth/v1/user'))).toBe(true)
  })

  it('sin cookie no hay caida posible: AUTH_REQUIRED sin tocar la red', async () => {
    await closedPort()
    signedInCookies(false)
    await expect(requireTenantAccess()).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 })
    expect((await proxy(page(signedInCookies(false)))).status).toBe(307)
  })
})
