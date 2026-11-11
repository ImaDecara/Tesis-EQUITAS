// Verificación privada: guarda solo método, ruta (sin query), estado y duración.
// NODE_OPTIONS=--require=.../trace-fetch.cjs EQUITAS_READ_TRACE=/ruta/privada.jsonl
// Se rechaza ANTES de enviar cualquier operación que no sea lectura o login.
const { appendFileSync } = require('node:fs')
const nativeFetch = globalThis.fetch
const destinations = new Set(['https://folyslqzqvnpolexcxjo.supabase.co', 'http://127.0.0.1:56321'])
const path = process.env.EQUITAS_READ_TRACE
if (!path) throw new Error('Falta la ruta privada de la traza de lectura.')
globalThis.fetch = async function (input, init) {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (!destinations.has(url.origin)) return nativeFetch(input, init)
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  const read = ['GET', 'HEAD'].includes(method) && /^\/rest\/v1\/[^/]+$/.test(url.pathname) && !url.pathname.startsWith('/rest/v1/rpc')
  const auth = (method === 'GET' && url.pathname === '/auth/v1/user') ||
    (method === 'POST' && url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password')
  const allowed = read || auth
  const start = performance.now()
  let status = 0
  try {
    if (!allowed) throw new Error('Operación bloqueada por la verificación de solo lectura.')
    const response = await nativeFetch(input, init)
    status = response.status
    return response
  } finally {
    appendFileSync(path, JSON.stringify({ method, path: url.pathname, allowed, status, ms: Math.round(performance.now() - start) }) + '\n', { mode: 0o600 })
  }
}
