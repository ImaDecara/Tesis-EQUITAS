import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { isAuthServiceUnavailable, loginRedirectPath } from '@/lib/auth/session-routing'
import {
  hasSupabaseCredentials,
  supabasePublishableKey,
  supabaseUrl,
} from '@/lib/supabase-config'

const PUBLIC_PATHS: ReadonlySet<string> = new Set(['/login', '/select-tenant', '/api/build-info'])

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request,
  })

  if (!hasSupabaseCredentials) {
    return response
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
    return response
  }

  // Solo la ruta: ni `_rsc` ni los filtros de la consulta viajan en `next`.
  const redirect = NextResponse.redirect(new URL(loginRedirectPath(request.nextUrl.pathname), request.url))
  response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie))
  Object.entries(authHeaders).forEach(([key, value]) => redirect.headers.set(key, value))
  redirect.headers.set('Cache-Control', 'private, no-store')
  return redirect
}

// `/api/imports` queda fuera (ALIGN-052): con proxy, Next retiene cada cuerpo en memoria y lo
// corta en 10 MB sin error (`proxyClientMaxBodySize`). Su Route Handler valida la sesion.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|api/imports(?:/|$)|favicon.ico|icon.png|icono.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
