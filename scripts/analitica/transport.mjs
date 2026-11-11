// Barrera independiente del SDK: solo login y lecturas REST de tablas, sin redirecciones.
export function readOnlyFetch(origin, implementation = fetch) {
  if (!['http://127.0.0.1:55321', 'https://folyslqzqvnpolexcxjo.supabase.co'].includes(origin)) throw new Error('Destino no autorizado')
  return async (input, init = {}) => {
    const request = input instanceof Request ? input : null
    const url = new URL(request?.url ?? String(input))
    const method = (init.method ?? request?.method ?? 'GET').toUpperCase()
    const login = method === 'POST' && url.pathname === '/auth/v1/token' && url.search === '?grant_type=password'
    const read = ['GET', 'HEAD'].includes(method) && /^\/rest\/v1\/[a-z_]+$/.test(url.pathname) && url.pathname !== '/rest/v1/rpc'
    if (url.origin !== origin || (!login && !read)) throw new Error('Operación bloqueada por el modo de solo lectura')
    return implementation(input, { ...init, redirect: 'error' })
  }
}
