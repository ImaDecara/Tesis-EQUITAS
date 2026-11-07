import 'server-only'

import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'

import { createServerSupabaseClient } from '@/lib/supabase-server'

// ALIGN-052. El navegador nunca llama a FastAPI: este reenvio va de servidor a servidor con
// el token de la sesion. La autoridad es FastAPI, que vuelve a verificar token, membresia y
// rol en cada solicitud. Aca solo se decide que se reenvia y que vuelve al navegador.
const INTERNAL_URL_VARIABLE = 'EQUITAS_IMPORT_API_URL'
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]'])
const BATCH_ID = /^[1-9]\d{0,18}$/
// Igual que `MAX_REQUEST_BYTES` de back/api/imports.py. Solo evita abrir una conexion: el
// limite que cuenta bytes reales es el de FastAPI.
export const MAX_REQUEST_BYTES = 2 * 25_000_000 + 1_048_576
const UPSTREAM_TIMEOUT_MS = 310_000
const NO_STORE = 'private, no-store'

function failure(status: number, detail: string): Response {
  return Response.json({ detail }, { status, headers: { 'Cache-Control': NO_STORE } })
}

// Lista cerrada: 054, 056 y 057 agregan sus rutas aca. Ni la consulta ni otro segmento pasan.
function internalPath(method: string, segments: readonly string[]): string | null {
  const [id, action] = segments
  if (method === 'POST' && segments.length === 0) return '/imports'
  if (method === 'GET' && segments.length === 1 && BATCH_ID.test(id)) return `/imports/${id}`
  if ((method === 'GET' || method === 'POST') && segments.length === 2 && BATCH_ID.test(id) && action === 'preview') {
    return `/imports/${id}/preview`
  }
  if (method === 'POST' && segments.length === 2 && BATCH_ID.test(id) && action === 'discard') {
    return `/imports/${id}/discard`
  }
  return null
}

// Esta version solo admite loopback (ALIGN-050 define otra red). Una URL que no lo sea no se usa.
function internalBaseUrl(): string | null {
  try {
    const url = new URL(process.env[INTERNAL_URL_VARIABLE] ?? '')
    const plain = url.protocol === 'http:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
    return plain && LOOPBACK_HOSTS.has(url.hostname) ? url.origin : null
  } catch {
    return null
  }
}

// Las cookies de sesion viajan solas: una escritura solo se acepta desde este mismo origen,
// comparado entero (esquema, host y puerto). Lo serializa el navegador: otra forma no es suya.
function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  const fetchSite = request.headers.get('sec-fetch-site')
  if (!origin || !host || (fetchSite && fetchSite !== 'same-origin')) return false
  try {
    const url = new URL(origin)
    return url.origin === origin && url.protocol === request.nextUrl.protocol && url.host === host
  } catch {
    return false
  }
}

type SessionToken = { token: string } | { failure: Response }

async function sessionToken(): Promise<SessionToken> {
  const supabase = await createServerSupabaseClient()
  if (!supabase) return { failure: failure(503, 'IMPORT_SERVICE_UNAVAILABLE') }
  try {
    // Solo se extrae el token, y refresca la sesion si vencio: el proxy no corre en esta
    // ruta. No decide nada: FastAPI verifica firma y sesion contra Auth.
    const { data, error } = await supabase.auth.getSession()
    if (error && isAuthRetryableFetchError(error)) return { failure: failure(503, 'AUTH_UNAVAILABLE') }
    const token = data.session?.access_token
    return token ? { token } : { failure: failure(401, 'AUTH_REQUIRED') }
  } catch {
    return { failure: failure(503, 'AUTH_UNAVAILABLE') }
  }
}

function upstreamHeaders(request: NextRequest, token: string): Headers {
  const headers = new Headers({ Accept: 'application/json', Authorization: `Bearer ${token}` })
  for (const name of ['content-type', 'idempotency-key']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  return headers
}

// Solo vuelven el codigo y un cuerpo JSON. Ningun encabezado interno llega al navegador, y una
// redireccion, que llevaria la URL interna en Location, se trata como una falla del servicio.
async function browserResponse(upstream: Response): Promise<Response> {
  const isJson = upstream.headers.get('content-type')?.toLowerCase().startsWith('application/json')
  if ((upstream.status >= 300 && upstream.status < 400) || !isJson) {
    await upstream.body?.cancel()
    return failure(502, 'IMPORT_SERVICE_ERROR')
  }
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': NO_STORE },
  })
}

export async function forwardImportRequest(request: NextRequest, segments: readonly string[]): Promise<Response> {
  let path = internalPath(request.method, segments)
  if (!path) return failure(404, 'NOT_FOUND')
  if (segments[1] === 'preview' && request.method === 'GET') {
    const query = request.nextUrl.searchParams
    const referenceOnly = query.size === 1 && query.get('reference') === '1'
    const allowed = new Set(referenceOnly ? ['reference'] : ['kind', 'page', 'revision'])
    if ([...query.keys()].some(key => !allowed.has(key) || query.getAll(key).length !== 1)) return failure(422, 'PREVIEW_INPUT_INVALID')
    const kind = query.get('kind') ?? ''
    const page = query.get('page') ?? '1'
    const revision = query.get('revision')
    if (!['', 'alta', 'actualizacion', 'sin_cambios', 'conflicto'].includes(kind) || !/^[1-9][0-9]{0,3}$/.test(page) || Number(page) > 6000 ||
      (revision !== null && !/^[0-9a-f]{64}$/.test(revision))) return failure(422, 'PREVIEW_INPUT_INVALID')
    path += query.size ? `?${query.toString()}` : ''
  }
  if (request.method !== 'GET' && !isSameOrigin(request)) return failure(403, 'ORIGIN_NOT_ALLOWED')
  if (Number(request.headers.get('content-length') ?? 0) > MAX_REQUEST_BYTES) return failure(413, 'LIMITE_ARCHIVO_EXCEDIDO')
  const baseUrl = internalBaseUrl()
  if (!baseUrl) return failure(503, 'IMPORT_SERVICE_UNAVAILABLE')
  const session = await sessionToken()
  if ('failure' in session) return session.failure
  const hasBody = request.method === 'POST' && request.body !== null
  try {
    const upstream = await fetch(`${baseUrl}${path}`, {
      method: request.method,
      headers: upstreamHeaders(request, session.token),
      body: hasBody ? request.body : undefined,
      // El cuerpo se reenvia en flujo: nunca se arma en memoria.
      ...(hasBody ? { duplex: 'half' } : {}),
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    } as RequestInit)
    return await browserResponse(upstream)
  } catch {
    // Ni el mensaje ni la causa: pueden citar la URL interna.
    return failure(503, 'IMPORT_SERVICE_UNAVAILABLE')
  }
}
