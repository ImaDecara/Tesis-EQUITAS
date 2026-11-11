/** node scripts/analitica/run.mjs --env FILE --account FILE [--account-key KEY] [--tenant ID]
 * Solo login/GET/HEAD; no imprime claves, filas ni agregados de cartera. */
import { readFile, mkdir, chmod, writeFile } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createServer } from '../../front/node_modules/vite/dist/node/index.js'
import { createClient } from '../../front/node_modules/@supabase/supabase-js/dist/index.mjs'
import { readOnlyFetch } from './transport.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const argument = name => args[args.indexOf(name) + 1]
const benchmark = args.includes('--benchmark')
let loader
let source = 'SYNTHETIC_SCALE'
const python = (module, input) => {
  const child = spawnSync(join(root, 'back/.venv/bin/python'), ['-m', module], { cwd: root, env: { ...process.env, PYTHONPATH: join(root, 'back'), OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1' }, input, encoding: 'utf8', maxBuffer: 80 * 1024 * 1024 })
  if (child.status !== 0) throw new Error('Falló la referencia Python')
  return JSON.parse(child.stdout)
}
try {
  if (!benchmark) {
    if (!args.includes('--env') || !args.includes('--account')) throw new Error('Faltan archivos de acceso')
    const contents = await readFile(resolve(argument('--env')), 'utf8')
    const env = Object.fromEntries(contents.split(/\r?\n/).flatMap(line => {
      const match = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line)
      return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, '')]] : []
    }))
    const origin = (env.NEXT_PUBLIC_SUPABASE_URL ?? env.API_URL ?? env.SUPABASE_URL ?? '').replace(/\/+$/, '')
    const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.PUBLISHABLE_KEY ?? env.ANON_KEY
    if (!key || (!key.startsWith('sb_publishable_') && JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role !== 'anon')) throw new Error('Clave pública requerida')
    const transport = readOnlyFetch(origin)
    source = origin === 'http://127.0.0.1:55321' ? 'SYNTHETIC_LOCAL_DEMO' : 'PRIVATE_READ_ONLY'
    const accounts = JSON.parse(await readFile(resolve(argument('--account')), 'utf8'))
    const account = accounts.email ? accounts : accounts[argument('--account-key')]
    if (!account?.email || !account?.password) throw new Error('Cuenta no disponible')
    const response = await transport(`${origin}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' }, body: JSON.stringify({ email: account.email, password: account.password }) })
    if (!response.ok) throw new Error('Ingreso rechazado')
    const session = await response.json()
    if (!session.access_token || !session.user?.id) throw new Error('Sesión no verificable')
    process.env.NEXT_PUBLIC_SUPABASE_URL = origin
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = key
    globalThis.equitasAnalytics = { client: createClient(origin, key, { accessToken: async () => session.access_token, global: { fetch: transport }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }), authUserId: session.user.id, tenantId: args.includes('--tenant') ? argument('--tenant') : undefined }
  }
  loader = await createServer({ configFile: false, root: join(root, 'front'), logLevel: 'silent', server: { middlewareMode: true, watch: null },
    resolve: { alias: [
      { find: 'server-only', replacement: join(root, 'front/node_modules/next/dist/compiled/server-only/empty.js') },
      { find: '@/lib/server/dal', replacement: join(root, 'scripts/analitica/reader.ts') },
      { find: '@/lib/supabase-server', replacement: join(root, 'scripts/analitica/reader.ts') },
      { find: '@', replacement: join(root, 'front') },
    ] } })
  const { mapDebtorObjectsFromRawData } = await loader.ssrLoadModule('/lib/mappers/debtor-object-mapper.ts')
  const { prepareCases } = await loader.ssrLoadModule('/lib/ml/features.ts')
  const { analyzeMatrix } = await loader.ssrLoadModule('/lib/ml/engine.ts')
  const readStart = performance.now()
  const raw = benchmark ? python('analytics.benchmark') : await (await loader.ssrLoadModule('/lib/data/raw-debtor-loader.ts')).loadRawDebtorData()
  if (raw.warnings.length) throw new Error('Lectura incompleta')
  const readMilliseconds = performance.now() - readStart
  const mapStart = performance.now()
  const mapped = mapDebtorObjectsFromRawData(raw)
  if (mapped.debtors.length !== raw.debtors.length) throw new Error('Mapeo incompleto')
  const { entries, exclusions } = prepareCases(mapped.debtors)
  let rows = entries.map(entry => entry.values)
  let casesTotal = mapped.debtors.length
  if (benchmark && args.includes('--benchmark-cases')) {
    const count = Number(argument('--benchmark-cases'))
    if (!Number.isSafeInteger(count) || count < 30 || count > 50000) throw new Error('Tamaño sintético inválido')
    const { random } = await loader.ssrLoadModule('/lib/ml/numerics.ts')
    const next = random(20261111)
    rows = Array.from({ length: count }, (_, i) => {
      const row = rows[i % rows.length]
      return [row[0] * (.95 + next() * .1), Math.max(1, Math.round(row[1] * (.9 + next() * .2))), row[2]]
    }).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
    exclusions.forEach(exclusion => { exclusion.count = 0 })
    casesTotal = count
    source = 'SYNTHETIC_LARGE_TABLE'
  }
  const mappingMilliseconds = performance.now() - mapStart
  const start = performance.now()
  const { result, labels } = analyzeMatrix(rows)
  const milliseconds = performance.now() - start
  const comparison = python('analytics.compare', JSON.stringify({ rows, ts: { status: result.status, selectedK: result.selectedK, silhouette: result.separation.silhouette, stability: result.stability.medianAdjustedRand, labels, candidates: result.candidates } }))
  const report = { generatedAt: new Date().toISOString(), source, casesTotal, casesIncluded: rows.length, exclusions,
    status: result.status, selectedK: result.selectedK, silhouette: result.separation.silhouette, stability: result.stability.medianAdjustedRand, sizes: result.clusters.map(c => c.size), milliseconds, readMilliseconds, mappingMilliseconds, comparison }
  if (benchmark) console.log(JSON.stringify(report, null, 2))
  else {
    const folder = join(homedir(), '.equitas-original/analitica')
    await mkdir(folder, { recursive: true, mode: 0o700 }); await chmod(folder, 0o700)
    const file = join(folder, `comparacion-${Date.now()}.json`)
    await writeFile(file, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    console.log(`Comparación terminada. Reporte privado: ${file}`)
  }
  if (!comparison.parity) process.exitCode = 2
} catch {
  console.error('No se completó la comparación: revisá los archivos de acceso, la sesión, el alcance municipal y el entorno Python. No se imprimen datos ni credenciales.')
  process.exitCode = 1
} finally { await loader?.close() }
