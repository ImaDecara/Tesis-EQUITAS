// Recorre por HTTP la compilación local del espejo: nunca acepta otro puerto ni otra base.
// Las cookies y el HTML quedan solo en memoria. La salida contiene rutas, estados y conteos.
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../..', import.meta.url))
const require = createRequire(resolve(root, 'front/package.json'))
const { createServerClient } = require('@supabase/ssr')
const home = resolve(homedir(), '.equitas-n7-espejo')
const env = Object.fromEntries((await readFile(resolve(home, 'app.env'), 'utf8')).trim().split('\n').map(line => {
  const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, '')]
}))
if (env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:56321') throw new Error('Este recorrido solo acepta el espejo local.')
const account = JSON.parse(await readFile(resolve(home, 'cuentas.json'), 'utf8')).admin
const cookies = new Map()
const sdk = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  cookies: { getAll: () => [...cookies].map(([name, value]) => ({ name, value })), setAll: values => { for (const { name, value } of values) cookies.set(name, value) } },
})
const login = await sdk.auth.signInWithPassword({ email: account.email, password: account.password })
if (login.error) throw new Error('No se pudo ingresar al espejo.')
const first = await sdk.from('debtor').select('id').eq('tenant', '1').order('id').limit(1)
if (first.error || !first.data?.length) throw new Error('Falta la cartera sintética del espejo.')
const id = first.data[0].id
const headers = { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') }
const traceFile = resolve(homedir(), '.equitas-original/mirror-rest-trace.jsonl')
const runs = []
for (const [label, path] of [['tablero', '/'], ['casos', '/debtors'], ['búsqueda', '/debtors?q=ESPEJO'], ['ficha', `/debtors/${id}`], ['reporte', '/api/reports/queue']]) {
  for (let run = 1; run <= (label === 'reporte' ? 1 : 3); run += 1) {
    await writeFile(traceFile, '', { mode: 0o600 })
    const start = performance.now()
    const response = await fetch(`http://127.0.0.1:3201${path}`, { headers, redirect: 'manual' })
    const html = await response.text()
    const ms = Math.round(performance.now() - start)
    const trace = (await readFile(traceFile, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    if (trace.some(request => !request.allowed || request.path.includes('/rpc/') || request.path.startsWith('/rest/v1/') && !['GET', 'HEAD'].includes(request.method))) throw new Error('El recorrido intentó una operación prohibida.')
    const expected = label === 'reporte' ? 501 : 200
    if (response.status !== expected || html.includes('NEXT_REDIRECT') || html.includes('Internal Server Error')) throw new Error('Una pantalla no respondió con el resultado esperado.')
    runs.push({ screen: label, run, status: response.status, ms, requests: trace.length,
      rest: trace.filter(request => request.path.startsWith('/rest/v1/')).length,
      debt: trace.filter(request => request.path === '/rest/v1/debt').length,
      forbidden: trace.filter(request => !request.allowed).length })
  }
}
const result = { at: new Date().toISOString(), environment: 'espejo sintético; compilación de producción, sin JWT de servidor', runs }
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
