import { isAuthError, isAuthRetryableFetchError } from '@supabase/supabase-js'

// Una caida de Auth no es una sesion ausente. Red o puerto cerrado, gateway, error
// interno, limite de solicitudes o respuesta ilegible no dicen nada de la sesion:
// solo un rechazo 4xx de Auth, o la falta de cookie, exigen ingresar otra vez.
// Ambos caminos fallan cerrados; esto solo decide el codigo y el destino.
export function isAuthServiceUnavailable(error: unknown): boolean {
  if (!isAuthError(error)) return false
  const { status } = error
  return isAuthRetryableFetchError(error) || status === undefined || status >= 500 || status === 429
}

const SAME_ORIGIN_PROBE = 'http://equitas.invalid'

// Devuelve la ruta solo si, tal como la interpreta un navegador, sigue en este origen.
// Controles y barras invertidas se rechazan porque los navegadores los normalizan.
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(value)) return null
  try {
    const url = new URL(value, SAME_ORIGIN_PROBE)
    if (url.origin !== SAME_ORIGIN_PROBE || url.pathname.startsWith('//')) return null
    return url.pathname + url.search + url.hash
  } catch {
    return null
  }
}

export function loginRedirectPath(pathname: string): string {
  const next = safeNextPath(pathname)
  return next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login'
}
