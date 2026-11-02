import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { createServerSupabaseClient } = vi.hoisted(() => ({ createServerSupabaseClient: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient }))

import { POST as createBatch } from '@/app/api/imports/route'
import { GET as readBatch, POST as batchAction } from '@/app/api/imports/[...path]/route'
import { MAX_REQUEST_BYTES } from '@/lib/server/imports-forward'
import { config as proxyConfig } from '@/proxy'

const INTERNAL = 'http://127.0.0.1:59123'
const TOKEN = 'token-de-sesion-sintetico'
const ORIGIN = 'http://equitas.example.test'

function context(...path: string[]) {
  return { params: Promise.resolve({ path }) }
}

function request(path: string, init: { method?: string; headers?: Record<string, string>; body?: BodyInit } = {}) {
  const { method = 'GET', headers = {}, body } = init
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    body,
    ...(body ? { duplex: 'half' } : {}),
    headers: { host: 'equitas.example.test', ...headers },
  } as ConstructorParameters<typeof NextRequest>[1])
}

const sameOrigin = { origin: ORIGIN }

function withSession(session: { access_token: string } | null = { access_token: TOKEN }, error: unknown = null) {
  createServerSupabaseClient.mockResolvedValue({
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session }, error }) },
  })
}

function upstreamReturns(status = 200, body: unknown = { status: 'ok' }, headers: Record<string, string> = {}) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', server: 'uvicorn', 'x-internal': INTERNAL, ...headers },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.stubEnv('EQUITAS_IMPORT_API_URL', INTERNAL)
  withSession()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

describe('ALIGN-052: reenvio de lotes desde Next a FastAPI', () => {
  it('reenvia el lote en flujo con el token de la sesion y sin cookies', async () => {
    const fetchMock = upstreamReturns(201, { id: 7, status: 'RECIBIDO' })
    const response = await createBatch(request('/api/imports', {
      method: 'POST',
      body: 'contenido-multipart',
      headers: {
        ...sameOrigin,
        'content-type': 'multipart/form-data; boundary=x',
        'idempotency-key': 'clave',
        cookie: 'sb-127-auth-token=cookie-de-sesion',
        'x-tenant': '999',
      },
    }))
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ id: 7, status: 'RECIBIDO' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${INTERNAL}/imports`)
    const headers = init?.headers as Headers
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(headers.get('content-type')).toBe('multipart/form-data; boundary=x')
    expect(headers.get('idempotency-key')).toBe('clave')
    expect(headers.get('cookie')).toBeNull()
    expect(headers.get('x-tenant')).toBeNull()
    expect(init?.body).toBeInstanceOf(ReadableStream)
    expect(init).toMatchObject({ method: 'POST', duplex: 'half', redirect: 'manual', cache: 'no-store' })
  })

  it('consulta y descarta solo rutas de la lista, sin la consulta del navegador', async () => {
    const fetchMock = upstreamReturns()
    expect((await readBatch(request('/api/imports/12?tenant=999'), context('12'))).status).toBe(200)
    expect(fetchMock.mock.calls[0][0]).toBe(`${INTERNAL}/imports/12`)
    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined()
    const discarded = await batchAction(request('/api/imports/12/discard', { method: 'POST', headers: sameOrigin }), context('12', 'discard'))
    expect(discarded.status).toBe(200)
    expect(fetchMock.mock.calls[1][0]).toBe(`${INTERNAL}/imports/12/discard`)
  })

  it.each([
    ['GET', ['0']], ['GET', ['abc']], ['GET', ['1', 'discard']], ['GET', ['1', '2']], ['GET', ['..%2f..%2fhealth']],
    ['GET', ['1', '..', 'health']], ['GET', ['1234567890123456789012']], ['POST', ['1']], ['POST', ['1', 'otra']], ['POST', ['1', 'discard', 'x']],
    ['POST', ['0', 'discard']], ['POST', ['health']], ['GET', ['case-groups']],
  ] as const)('%s %j no llega a FastAPI', async (method, segments) => {
    const fetchMock = upstreamReturns()
    const handler = method === 'GET' ? readBatch : batchAction
    const response = await handler(request('/api/imports/x', { method, headers: sameOrigin }), context(...segments))
    expect(response.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sin sesion responde 401 y no llama al servicio', async () => {
    const fetchMock = upstreamReturns()
    withSession(null)
    const response = await readBatch(request('/api/imports/1'), context('1'))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ detail: 'AUTH_REQUIRED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Auth caido al refrescar responde 503, no 401', async () => {
    const { AuthRetryableFetchError } = await import('@supabase/supabase-js')
    withSession(null, new AuthRetryableFetchError('red', 503))
    expect((await readBatch(request('/api/imports/1'), context('1'))).status).toBe(503)
    createServerSupabaseClient.mockResolvedValue({ auth: { getSession: vi.fn().mockRejectedValue(new Error('x')) } })
    expect((await readBatch(request('/api/imports/1'), context('1'))).status).toBe(503)
  })

  it('una sesion invalida responde 401', async () => {
    withSession(null, new Error('refresh_token_not_found'))
    expect((await readBatch(request('/api/imports/1'), context('1'))).status).toBe(401)
  })

  it('sin Supabase configurado falla cerrado', async () => {
    const fetchMock = upstreamReturns()
    createServerSupabaseClient.mockResolvedValue(null)
    expect((await readBatch(request('/api/imports/1'), context('1'))).status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['otro origen', { origin: 'http://malicioso.example.test' }],
    ['sin origen', {}],
    ['origen ilegible', { origin: 'null' }],
    ['mismo host con sitio cruzado', { origin: ORIGIN, 'sec-fetch-site': 'cross-site' }],
  ])('rechaza una escritura de %s', async (_case, headers) => {
    const fetchMock = upstreamReturns()
    const response = await createBatch(request('/api/imports', { method: 'POST', headers }))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ detail: 'ORIGIN_NOT_ALLOWED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['otro esquema, mismo host y puerto', 'https://equitas.example.test'],
    ['otro puerto', 'http://equitas.example.test:8443'],
    ['otro host', 'http://otro.example.test'],
    ['esquema que no es web', 'ftp://equitas.example.test'],
    ['esquema de archivo', 'file://equitas.example.test'],
    ['origen con ruta', 'http://equitas.example.test/ruta'],
    ['origen con credenciales', 'http://usuario@equitas.example.test'],
    ['origen con barra final', 'http://equitas.example.test/'],
    ['origen en mayusculas', 'HTTP://EQUITAS.EXAMPLE.TEST'],
  ])('M1: rechaza %s', async (_case, origin) => {
    const fetchMock = upstreamReturns()
    const response = await createBatch(request('/api/imports', { method: 'POST', headers: { origin } }))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ detail: 'ORIGIN_NOT_ALLOWED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('M1: https propio se acepta cuando la aplicacion corre en https', async () => {
    const fetchMock = upstreamReturns()
    const response = await createBatch(new NextRequest('https://equitas.example.test/api/imports', {
      method: 'POST', headers: { host: 'equitas.example.test', origin: 'https://equitas.example.test' },
    }))
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('M1: el esquema se compara tambien en el descarte', async () => {
    const fetchMock = upstreamReturns()
    const response = await batchAction(request('/api/imports/1/discard', {
      method: 'POST', headers: { origin: 'https://equitas.example.test' },
    }), context('1', 'discard'))
    expect(response.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('acepta una escritura del mismo origen con sec-fetch-site', async () => {
    upstreamReturns()
    const response = await batchAction(request('/api/imports/1/discard', {
      method: 'POST', headers: { ...sameOrigin, 'sec-fetch-site': 'same-origin' },
    }), context('1', 'discard'))
    expect(response.status).toBe(200)
  })

  it('un cuerpo declarado sobre el limite se rechaza sin abrir conexion', async () => {
    const fetchMock = upstreamReturns()
    const response = await createBatch(request('/api/imports', {
      method: 'POST', headers: { ...sameOrigin, 'content-length': String(MAX_REQUEST_BYTES + 1) },
    }))
    expect(response.status).toBe(413)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['', 'no-es-url', 'https://127.0.0.1:1', 'http://servicio.example.test:8000', 'http://usuario:clave@127.0.0.1:1', 'http://127.0.0.1:1/base', 'http://127.0.0.1:1/?a=1'])(
    'no usa la URL interna %j', async value => {
      const fetchMock = upstreamReturns()
      vi.stubEnv('EQUITAS_IMPORT_API_URL', value)
      const response = await readBatch(request('/api/imports/1'), context('1'))
      expect(response.status).toBe(503)
      expect(fetchMock).not.toHaveBeenCalled()
    })

  it.each(['http://localhost:59123', 'http://[::1]:59123'])('admite el loopback %s', async value => {
    const fetchMock = upstreamReturns()
    vi.stubEnv('EQUITAS_IMPORT_API_URL', value)
    expect((await readBatch(request('/api/imports/1'), context('1'))).status).toBe(200)
    expect(fetchMock.mock.calls[0][0]).toBe(`${value}/imports/1`)
  })

  it('devuelve el codigo sin encabezados internos ni credenciales', async () => {
    upstreamReturns(403, { detail: 'ROLE_FORBIDDEN' }, { 'set-cookie': 'interna=1', location: `${INTERNAL}/x` })
    const response = await readBatch(request('/api/imports/1'), context('1'))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ detail: 'ROLE_FORBIDDEN' })
    expect([...response.headers.keys()].sort()).toEqual(['cache-control', 'content-type'])
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it.each([301, 302, 307, 308])('una redireccion %i no llega al navegador', async status => {
    upstreamReturns(status, {}, { location: `${INTERNAL}/imports/1/` })
    const response = await readBatch(request('/api/imports/1'), context('1'))
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('59123')
    expect(response.headers.get('location')).toBeNull()
  })

  it('una respuesta que no es JSON no se reenvia', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`<html>${INTERNAL}</html>`, { status: 500, headers: { 'content-type': 'text/html' } })))
    const response = await readBatch(request('/api/imports/1'), context('1'))
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('59123')
  })

  it('un servicio caido responde 503 sin citar la URL ni la causa', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError(`fetch failed ${INTERNAL}`) }))
    const spy = vi.spyOn(console, 'error')
    const response = await readBatch(request('/api/imports/1'), context('1'))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ detail: 'IMPORT_SERVICE_UNAVAILABLE' })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('ALIGN-052: el proxy no toca esta ruta', () => {
  const matcher = new RegExp(`^${proxyConfig.matcher[0]}$`)

  // Con el proxy, Next retiene el cuerpo en memoria y lo CORTA en 10 MB sin error
  // (`proxyClientMaxBodySize`): un lote de 25 MB llegaria truncado a FastAPI.
  it.each(['/api/imports', '/api/imports/1', '/api/imports/1/discard'])('%s queda fuera', path => {
    expect(matcher.test(path)).toBe(false)
  })

  it.each(['/', '/login', '/debtors', '/api/build-info', '/api/importsx', '/api/importar', '/imports'])('%s sigue pasando por el proxy', path => {
    expect(matcher.test(path)).toBe(true)
  })
})

describe('ALIGN-052: el navegador no recibe la URL interna', () => {
  const FRONT = fileURLToPath(new URL('../..', import.meta.url))

  function sources(directory: string): string[] {
    return readdirSync(directory).flatMap(entry => {
      const path = join(directory, entry)
      return statSync(path).isDirectory() ? sources(path) : /\.(?:ts|tsx)$/.test(entry) ? [path] : []
    })
  }

  it('solo un modulo server-only lee la variable, sin prefijo publico', () => {
    const readers = ['app', 'components', 'lib'].flatMap(root => sources(join(FRONT, root)))
      .filter(path => readFileSync(path, 'utf8').includes('EQUITAS_IMPORT_API_URL'))
      .map(path => path.slice(FRONT.length))
    expect(readers).toEqual(['lib/server/imports-forward.ts'])
    const source = readFileSync(join(FRONT, readers[0]), 'utf8')
    expect(source.startsWith("import 'server-only'")).toBe(true)
    expect(source).not.toContain('NEXT_PUBLIC_EQUITAS')
  })
})
