import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { isAuthServiceUnavailable, loginRedirectPath } from '@/lib/auth/session-routing'
import {
  hasSupabaseCredentials,
  supabasePublishableKey,
  supabaseUrl,
} from '@/lib/supabase-config'

const PUBLIC_PATHS: ReadonlySet<string> = new Set(['/login', '/select-tenant', '/api/build-info'])

function rejectCaseHead(response: NextResponse, authHeaders: Record<string, string> = {}) {
  // No copiar las cabeceras de NextResponse.next: habilitarian el render de la ficha.
  const rejected = new NextResponse(null, { status: 405, headers: {
    ...authHeaders,
    Allow: 'GET',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  } })
  response.cookies.getAll().forEach(cookie => rejected.cookies.set(cookie))
  return rejected
}

export async function proxy(request: NextRequest) {
  // Next renderiza una pagina incluso con HEAD y luego descarta el cuerpo. Cortarlo
  // aqui evita registrar CASE_OPEN por una ficha que nunca se entrega al solicitante.
  const isCaseHead = request.method === 'HEAD' && /^\/debtors\/[^/]+\/?$/.test(request.nextUrl.pathname)
  let response = NextResponse.next({
    request,
  })

  if (!hasSupabaseCredentials) {
    return isCaseHead ? rejectCaseHead(response) : response
  }

  let authHeaders: Record<string, string> = {}

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value)
        })

        response = NextResponse.next({
          request,
        })

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options)
        })

        authHeaders = headers
        Object.entries(headers).forEach(([key, value]) => {
          response.headers.set(key, value)
        })
      },
    },
  })

  // Comprobacion optimista: da un 307 real a quien no tiene sesion, antes del streaming.
  // La autoridad sigue siendo la DAL. Si Auth no responde no se sabe si hay sesion,
  // asi que la solicitud sigue y la DAL falla cerrada como no disponible.
  let sessionMissing = false
  try {
    const { data, error } = await supabase.auth.getUser()
    sessionMissing = !data.user && !isAuthServiceUnavailable(error)
  } catch {
    sessionMissing = false
  }

  if (!sessionMissing || PUBLIC_PATHS.has(request.nextUrl.pathname)) {
    return isCaseHead ? rejectCaseHead(response, authHeaders) : response
  }

  // Solo la ruta: ni `_rsc` ni los filtros de la consulta viajan en `next`.
  const redirect = NextResponse.redirect(new URL(loginRedirectPath(request.nextUrl.pathname), request.url))
  response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie))
  Object.entries(authHeaders).forEach(([key, value]) => redirect.headers.set(key, value))
  redirect.headers.set('Cache-Control', 'private, no-store')
  return redirect
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.png|icono.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
