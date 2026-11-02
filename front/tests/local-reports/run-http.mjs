// ALIGN-028. Pide los reportes a `next start` con sesiones reales del stack local, generadas por el mismo
// @supabase/ssr de la web, y guarda las respuestas. No juzga el contenido: eso lo hace verify_reports.py.
// Uso: node tests/local-reports/run-http.mjs <credenciales.psv> <http://127.0.0.1:PUERTO> <salida nueva en /tmp>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServerClient } from '@supabase/ssr'

const [credentialsPath, base, output] = process.argv.slice(2)
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base ?? '') || !output?.startsWith('/tmp/')) {
  throw new Error('Uso: run-http.mjs <credenciales.psv> <http://127.0.0.1:PUERTO> </tmp/salida>')
}
const env = Object.fromEntries(readFileSync('/tmp/equitas-local-db/supabase-local.env', 'utf8').split('\n').flatMap(line => {
  const at = line.indexOf('=')
  return at > 0 ? [[line.slice(0, at), line.slice(at + 1).replace(/^"|"$/g, '')]] : []
}))
if (env.API_URL !== 'http://127.0.0.1:54321') throw new Error('Solo se admite el stack local.')
const accounts = Object.fromEntries(readFileSync(credentialsPath, 'utf8').trim().split('\n').map(line => {
  const [label, email, password] = line.split('|')
  return [label, { email, password }]
}))

mkdirSync(output, { recursive: false })

async function sessionCookie(label) {
  const jar = new Map()
  const client = createServerClient(env.API_URL, env.PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: values => { for (const { name, value } of values) jar.set(name, value) },
    },
  })
  const { error } = await client.auth.signInWithPassword(accounts[label])
  if (error) throw new Error(`LOGIN_FALLIDO ${label} ${error.status}`)
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
}

const REPORTS = ['queue', 'decisions', 'supervision', 'data-quality']
const results = []

async function record(account, path, cookie, tenant) {
  const headers = { cookie: [cookie, tenant ? `equitas_tenant_id=${tenant}` : ''].filter(Boolean).join('; ') }
  const response = await fetch(new URL(path, base), { redirect: 'manual', headers })
  const bytes = new Uint8Array(await response.arrayBuffer())
  const file = `${account}${tenant ? `__t${tenant}` : ''}__${path.replace(/^\//, '').replace(/[^a-zA-Z0-9]+/g, '_')}`
  writeFileSync(join(output, file), bytes)
  const row = {
    account, path, tenant: tenant ?? null, status: response.status, file,
    contentType: response.headers.get('content-type'),
    disposition: response.headers.get('content-disposition'),
    cacheControl: response.headers.get('cache-control'),
    location: response.headers.get('location'),
    bytes: bytes.length,
  }
  results.push(row)
  return row
}

const reportPath = name => `/api/reports/${name}`
for (const name of REPORTS) await record('anonimo', reportPath(name), '')

const cookies = {}
for (const label of Object.keys(accounts)) cookies[label] = await sessionCookie(label)

for (const label of ['consulta', 'operador', 'supervisor', 'importador', 'sin-membresia', 'inactivo', 'otro-operador', 'tp-e06-a', 'tp-e06-none', 'tp-e06-inactive']) {
  for (const name of REPORTS) await record(label, reportPath(name), cookies[label])
}

// Dos membresias: sin eleccion no entra, cada cookie da el rol de ese municipio, y una ajena no da nada.
for (const name of REPORTS) {
  await record('otro-supervisor', reportPath(name), cookies['otro-supervisor'])
  await record('otro-supervisor', reportPath(name), cookies['otro-supervisor'], '920001')
  await record('otro-supervisor', reportPath(name), cookies['otro-supervisor'], '920002')
  await record('otro-supervisor', reportPath(name), cookies['otro-supervisor'], '910001')
}
// Una cookie de otro municipio tampoco da nada a quien tiene una sola membresia.
for (const name of REPORTS) await record('supervisor', reportPath(name), cookies.supervisor, '920002')

// Conciliacion: el mismo pedido al reporte y a la pantalla, con la misma sesion.
for (const query of ['', '?contact=without', '?contact=with', '?risk=ALTO', '?minAmount=100000', '?q=TP-A028-PERSONA-DOS', '?type=NO-EXISTE']) {
  await record('operador', `${reportPath('queue')}${query}`, cookies.operador)
  await record('operador', `/priority-cases${query}`, cookies.operador)
}
await record('operador', '/debt-aging', cookies.operador)
await record('operador', '/no-contact', cookies.operador)

// Filtros rechazados y supervision filtrada.
for (const query of ['?risk=XYZ', '?tenant=920002', '?nada=1']) await record('operador', `${reportPath('queue')}${query}`, cookies.operador)
for (const query of ['?corte=2026-09-30', '?corte=2026-10-15', '?corte=2030-01-01']) {
  await record('supervisor', `${reportPath('supervision')}${query}`, cookies.supervisor)
  await record('supervisor', `${reportPath('decisions')}${query}`, cookies.supervisor)
}

writeFileSync(join(output, 'results.json'), JSON.stringify(results, null, 1))
console.log(`solicitudes=${results.length}`)
