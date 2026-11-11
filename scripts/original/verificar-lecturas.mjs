// Sonda anónima de esquema o medición de lectura sobre el espejo sintético.
// Nunca imprime claves, sesión, filas ni URLs con filtros de datos.
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const require = createRequire(resolve(root, 'front/package.json'))
const ts = require('typescript')
const { createClient } = require('@supabase/supabase-js')
const mode = process.argv[2]
if (!['esquema', 'espejo'].includes(mode)) throw new Error('Usá: verificar-lecturas.mjs esquema|espejo [salida.json]')
const home = resolve(homedir(), mode === 'esquema' ? '.equitas-original' : '.equitas-n7-espejo')
const env = Object.fromEntries((await readFile(resolve(home, 'app.env'), 'utf8')).trim().split('\n').map(line => {
  const index = line.indexOf('=')
  return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, '')]
}))
const url = env.NEXT_PUBLIC_SUPABASE_URL
if (url !== (mode === 'esquema' ? 'https://folyslqzqvnpolexcxjo.supabase.co' : 'http://127.0.0.1:56321')) throw new Error('Destino no permitido.')
if (!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_')) throw new Error('Solo clave publicable.')
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
// Transpila los dos módulos productivos con TypeScript ya fijado en front/; no copia sus consultas.
async function productModule(path, imports = {}) {
  const source = await readFile(resolve(root, 'front', path), 'utf8')
  let js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  js = js.replace(/import ['"]server-only['"];?/, '')
  for (const [from, to] of Object.entries(imports)) js = js.replaceAll(from, to)
  return import(moduleUrl(js))
}
const { tenantReadScope } = await productModule('lib/server/tenant-read-scope.ts')
const { loadAllTableRows } = await productModule('lib/data/paginated-table-reader.ts', {
  '@/lib/supabase-config': moduleUrl('export const hasSupabaseCredentials = true;'),
})
const requests = []
let active = 0
let maximumActive = 0
const sdk = createClient(url, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: async (input, init) => {
    const target = new URL(input instanceof Request ? input.url : String(input))
    const method = (init?.method ?? 'GET').toUpperCase()
    const rest = target.origin === url && target.pathname.startsWith('/rest/v1/') && !target.pathname.includes('/rpc/') && ['GET', 'HEAD'].includes(method)
    const login = mode === 'espejo' && method === 'POST' && target.origin === url && target.pathname === '/auth/v1/token' && target.searchParams.get('grant_type') === 'password'
    if (!rest && !login) throw new Error('Solicitud no permitida por la sonda.')
    const start = performance.now()
    active += 1; maximumActive = Math.max(maximumActive, active)
    try { return await fetch(input, { ...init, signal: AbortSignal.timeout(30_000) }) }
    finally {
      active -= 1
      requests.push({ method, path: target.pathname, ms: Math.round(performance.now() - start) })
    }
  } },
})
let report
if (mode === 'esquema') {
  const probes = []
  const tables = ['debtor', 'debtor_type', 'debt', 'debt_status', 'debtor_person', 'person', 'debtor_contact', 'debtor_profile', 'debtor_profile_detail']
  for (const table of tables) {
    const scope = tenantReadScope(table, '0')
    let query = sdk.from(table).select(scope.select).order('id', { ascending: true }).limit(0)
    for (const [key, value] of scope.filters) query = query.eq(key, value)
    const response = await query
    probes.push({ table, variant: 'select_filtros_orden_sin_filas', status: response.status, code: response.error?.code ?? null, rows: response.data?.length ?? null })
  }
  // Con cero filas el lector solo solicita el primer rango. Los siguientes se ensayan en el espejo.
  for (const offset of [0]) {
    const scope = tenantReadScope('debt', '0')
    let query = sdk.from('debt').select(scope.select, { head: true, count: 'exact' }).order('id', { ascending: true }).range(offset, offset + 999).eq('id', '0')
    for (const [key, value] of scope.filters) query = query.eq(key, value)
    const response = await query
    probes.push({ table: 'debt', variant: `rango_${offset}_${offset + 999}_head`, status: response.status, code: response.error?.code ?? null, count: response.count })
  }
  for (const [table, select] of [['user', 'id,auth_user,status,full_name'], ['tenant_user', 'id,user,tenant,role,status'], ['tenant', 'id,name,status'], ['role', 'id,name']]) {
    const response = await sdk.from(table).select(select).limit(0)
    probes.push({ table, variant: 'identidad_sin_filas', status: response.status, code: response.error?.code ?? null, rows: response.data?.length ?? null })
  }
  for (const table of ['import_batch', 'case_review', 'case_review_approval', 'access_audit']) {
    const response = await sdk.from(table).select('id').limit(0)
    probes.push({ table, variant: 'modulo_sin_filas', status: response.status, code: response.error?.code ?? null })
  }
  const passed = probes.every(probe => probe.variant === 'modulo_sin_filas'
    ? probe.status === 404 && probe.code === 'PGRST205'
    : probe.status === 200 && probe.code === null && (probe.rows === 0 || probe.count === 0))
  report = { mode, at: new Date().toISOString(), passed, probes, requests }
} else {
  const accounts = JSON.parse(await readFile(resolve(home, 'cuentas.json'), 'utf8'))
  const account = accounts.admin
  const auth = await sdk.auth.signInWithPassword({ email: account.email, password: account.password })
  if (auth.error || !auth.data.session) throw new Error('No se pudo ingresar al espejo; no se imprime el motivo privado.')
  const runs = []
  const tables = ['debtor', 'debtor_type', 'debt', 'debt_status', 'debtor_person', 'person', 'debtor_contact', 'debtor_profile']
  for (const parallel of [false, true]) for (let run = 1; run <= 3; run += 1) {
    requests.length = 0; maximumActive = 0
    const start = performance.now()
    const results = await Promise.all(tables.map(table => loadAllTableRows(table, sdk, { ...tenantReadScope(table, '1'), parallel: parallel && table === 'debt' })))
    if (results.some(result => result.warning)) throw new Error('Falló una lectura del espejo; no se publica una medición parcial.')
    const debts = results[2].rows.length
    const debtRequests = requests.filter(request => request.path === '/rest/v1/debt').length
    runs.push({ parallel, run, ms: Math.round(performance.now() - start), requests: requests.length,
      debtRequests, debtSerialStages: parallel ? 1 + Math.ceil((debtRequests - 1) / 4) : debtRequests,
      maximumActive, objects: results[0].rows.length, debts })
  }
  report = { mode, at: new Date().toISOString(), passed: true, scope: 'Ocho tablas del cargador de casos; sin Auth, layout ni sondas de nivel en los conteos.', runs }
}
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
console.log(JSON.stringify(report, null, 2))
if (!report.passed) process.exitCode = 1
