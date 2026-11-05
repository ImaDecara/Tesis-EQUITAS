// ALIGN-029. next start + Supabase LOCAL; no respuestas simuladas ni sondas de producto.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium, expect as baseExpect } from '@playwright/test'
import { assertCsv, assertCsvTotals, CHECKS, loadEvidence, localOrigin, parseCsv, sha256 } from './thesis-flow/contracts.mjs'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const { values } = parseArgs({ options: { 'base-url': { type: 'string' }, output: { type: 'string' },
  'load-evidence': { type: 'string' }, 'config-file': { type: 'string' } } })
const expect = baseExpect.configure({ timeout: 20_000 })
const report = { case_id: 'ALIGN-029', passed: false, scope: 'isolated_branch', started_at_utc: new Date().toISOString(),
  source_sha: null, environment: 'next start + Supabase local', checks: [], screenshots: [], console_errors: [],
  limits: 'Datos S sintéticos. Demuestra el recorrido técnico; no demuestra utilidad municipal, aceptación ni impacto.' }
const secrets = []
const clean = value => {
  let result = String(value)
  for (const secret of secrets) if (secret) result = result.split(secret).join('[privado]')
  return result.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_(?:secret|publishable)_[\w-]+/g, '[clave]')
}
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 10_000 }).trim()
const sql = query => JSON.parse(execFileSync('docker', ['exec', '-i', 'supabase_db_equitas-tp-testing',
  'psql', '-X', '-q', '-At', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
{ input: query, encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'] }))
const ledger = () => sql(`select json_build_object('reviews',coalesce((select json_agg(t order by id) from
  (select id,decision,decided_intensity,reason_code,reviewer as reviewer_user,as_of,rules_version,checklist from public.case_review) t),'[]'),
  'approvals',coalesce((select json_agg(t order by id) from
  (select id,case_review,decision,approver as approver_user,checklist from public.case_review_approval) t),'[]'))`)
const panelOf = page => page.getByRole('tabpanel', { name: 'Revisión' })
const DETAIL = 'Ajuste sintético ALIGN-029 para verificar persistencia'
let browser, output, timer, outputCreated = false
let activeCheck = 'environment'
const check = async (id, action, continueIndependent = false) => {
  activeCheck = id
  try {
    const observed = await action()
    report.checks.push({ id, passed: true, observed, ended_at_utc: new Date().toISOString() })
    console.log(`ok ${id}`)
  } catch (error) {
    if (!continueIndependent) throw error
    report.checks.push({ id, passed: false, observed: clean(error.message), ended_at_utc: new Date().toISOString() })
    console.error(`FAIL ${id}: ${clean(error.message)}`)
    process.exitCode = 1
  }
}

async function readConfig() {
  const path = await realpath(values['config-file'] ?? process.env.EQUITAS_THESIS_FLOW_CONFIG ?? '')
  assert(path.startsWith('/tmp/') || path.startsWith('/private/tmp/'), 'Configuración fuera de /tmp')
  assert.equal((await stat(path)).mode & 0o077, 0, 'Configuración debe ser 0600')
  const config = JSON.parse(await readFile(path, 'utf8'))
  secrets.push(config.publishableKey, config.reviewJwt, config.jwtSecret)
  for (const account of Object.values(config.accounts ?? {})) secrets.push(account.email, account.password)
  assert.equal(config.supabaseUrl, 'http://127.0.0.1:54321')
  assert(config.publishableKey?.startsWith('sb_publishable_'))
  assert(config.jwtSecret && config.reviewJwt)
  for (const role of ['operador', 'supervisor']) {
    assert(config.accounts[role].email.endsWith('@example.test') && config.accounts[role].password)
  }
  assert.notEqual(config.accounts.operador.email, config.accounts.supervisor.email)
  const lock = '/tmp/equitas-local-db/lock'
  const owner = JSON.parse(await readFile(`${lock}/owner.json`, 'utf8'))
  assert.equal(owner.ticket, 'ALIGN-029')
  assert.equal(owner.nonce, config.lockNonce)
  assert.equal(owner.inode, (await stat(lock)).ino)
  return config
}

async function capture(page, name) {
  assert(!new URL(page.url()).pathname.startsWith('/login'), 'Nunca capturar credenciales')
  const file = `${name}.png`
  await page.screenshot({ path: resolve(output, file), fullPage: true })
  report.screenshots.push({ path: file, sha256: sha256(await readFile(resolve(output, file))) })
}

async function session(base, config, role) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'es-AR', serviceWorkers: 'block' })
  context.setDefaultTimeout(20_000)
  // Cortafuegos, nunca fulfil/mock: toda solicitud permitida usa el servidor real.
  await context.route('**/*', route => {
    if (![base, config.supabaseUrl].includes(new URL(route.request().url()).origin)) {
      report.console_errors.push('Solicitud fuera de loopback bloqueada')
      return route.abort('blockedbyclient')
    }
    return route.continue()
  })
  const page = await context.newPage()
  page.on('console', message => { if (message.type() === 'error') report.console_errors.push(clean(message.text())) })
  page.on('pageerror', error => report.console_errors.push(clean(error.message)))
  const posts = []
  page.on('request', request => { if (request.method() === 'POST' && request.headers()['next-action']) posts.push(request.url()) })
  await page.goto(`${base}/login?next=/priority-cases`)
  await page.getByLabel('Email', { exact: true }).fill(config.accounts[role].email)
  await page.getByLabel('Password', { exact: true }).fill(config.accounts[role].password)
  await page.getByRole('button', { name: 'Iniciar sesion', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Casos prioritarios', exact: true })).toBeVisible({ timeout: 45_000 })
  const cookies = await context.cookies()
  const auth = cookies.filter(cookie => /^sb-.*-auth-token(?:\.\d+)?$/.test(cookie.name)).sort((a, b) => a.name.localeCompare(b.name))
  assert(auth.length > 0, 'Se requiere sesión Auth real')
  const stored = auth.map(cookie => cookie.value).join('')
  assert(stored.startsWith('base64-'))
  const identity = JSON.parse(Buffer.from(stored.slice(7), 'base64url').toString())
  assert(identity.user?.id && identity.access_token && identity.refresh_token)
  secrets.push(identity.access_token, identity.refresh_token)
  return { context, page, posts, identity }
}

async function checklist(panel) {
  await panel.getByRole('radio', { name: 'No disponible', exact: true }).check()
  for (const name of ['Estado jurídico', 'Canal válido', 'Alternativa asistida']) {
    await panel.getByRole('checkbox', { name: new RegExp(name) }).check()
  }
}

async function directDenied(context, base, path) {
  const response = await context.request.get(`${base}${path}`, { maxRedirects: 0 })
  assert.equal(response.status(), 307)
  assert.equal(new URL(response.headers().location, base).pathname, '/login')
  assert(!(await response.text()).includes('FLOW029-'), 'La denegación no debe devolver cartera')
}

async function run() {
  assert(values.output, 'Falta --output nuevo')
  output = resolve(values.output)
  await mkdir(output)
  outputCreated = true
  const base = localOrigin(values['base-url'])
  report.base_url = base
  report.source_sha = git('rev-parse', 'HEAD')
  assert.equal(git('status', '--porcelain'), '', 'El recorrido oficial exige un commit limpio')
  const config = await readConfig()
  assert(values['load-evidence'], 'Faltan antecedentes reales de validación y carga')
  const load = await loadEvidence(values['load-evidence'], report.source_sha, resolve(ROOT, 'contracts/decision-rules.v1.json'))
  report.dataset_sha256 = load.dataset_sha256
  report.rules_version = load.rules_version
  report.rules_sha256 = load.rules_sha256
  report.load_evidence_sha256 = sha256(await readFile(resolve(values['load-evidence'], 'load.json')))
  await check('environment', async () => {
    assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, config.supabaseUrl, 'URL de ejecución no local')
    const response = await fetch(`${base}/api/build-info`, { redirect: 'manual', signal: AbortSignal.timeout(10_000) })
    assert.equal(response.status, 200)
    const info = await response.json()
    assert.equal(info.sourceSha, report.source_sha)
    assert.equal(info.environment, 'local')
    assert.equal(info.supabaseProjectRef, null)
    report.build_info = info
    return { build_info: info, supabase_url: config.supabaseUrl }
  })
  await check('real_load', async () => {
    const events = sql('select json_agg(t order by id) from (select id,status,supersedes,file_hashes,as_of,rules_version,counts,source from public.import_batch) t')
    assert.deepEqual(events, load.events, 'La base no contiene la carga acreditada')
    assert.deepEqual(ledger(), { reviews: [], approvals: [] }, 'Se requiere fixture sin decisiones previas')
    return { dataset_sha256: load.dataset_sha256, events: events.map(event => ({ id: event.id, status: event.status })), totals: load.totals }
  })
  browser = await chromium.launch()
  timer = setTimeout(() => { void browser.close() }, 600_000)
  let operator
  await check('operator_login', async () => { operator = await session(base, config, 'operador'); return 'Login UI con Auth local real' })
  const { page } = operator
  await check('contact_queue', async () => {
    await page.getByRole('navigation', { name: 'Colas por intervención' }).getByRole('link', { name: /Contacto y plan/ }).click()
    await expect(page).toHaveURL(/queue=CONTACTO_PERSONAL_Y_PLAN/)
    for (const debtor of load.debtors) await expect(page.getByRole('link', { name: `Abrir revisión ${debtor.identifier}` })).toBeVisible()
    await capture(page, '01-contacto-y-plan')
    await page.getByRole('link', { name: 'Abrir revisión FLOW029-A' }).click()
    return 'Los dos objetos cargados están en Contacto y plan; detalle abierto desde la cola'
  })
  const panel = panelOf(page)
  await check('case_facts', async () => {
    await expect(page).toHaveURL(new RegExp(`/debtors/${load.debtors[0].id}\\?tab=revision`))
    const positions = []
    for (const name of ['Hechos del caso', 'Sugerencia del sistema', 'Tu decisión', 'Historial de decisiones']) {
      const heading = panel.getByRole('heading', { name, exact: true })
      await expect(heading).toBeVisible()
      positions.push((await heading.boundingBox()).y)
    }
    assert(positions.every((position, index) => index === 0 || position > positions[index - 1]))
    await expect(panel.getByText('Vulnerabilidad: no informada', { exact: true })).toBeVisible()
    await expect(panel.getByText('Corte: 30/9/2026', { exact: true }).first()).toBeVisible()
    await expect(panel.getByText('Reglas v1.0.0', { exact: true })).toBeVisible()
    await expect(panel.getByText(/Se sugiere contacto personal con ofrecimiento de plan o asistencia/)).toContainText('severidad (80) alcanza el umbral de 70')
    await expect(panel.getByText('80 puntos de 0 a 100', { exact: true })).toBeVisible()
    await expect(panel.getByText('Explicación no disponible.', { exact: true })).toHaveCount(0)
    await capture(page, '02-hechos-explicacion-corte')
    return 'Hechos antes de sugerencia; vulnerabilidad ausente explícita; severidad 80, R4, corte y reglas reales'
  })
  await panel.getByRole('radio', { name: 'Modificar la acción', exact: true }).check()
  await panel.getByLabel('Acción propuesta', { exact: true }).selectOption('INTIMACION_ADMINISTRATIVA:3')
  await check('reason_required', async () => {
    await panel.getByRole('button', { name: 'Registrar propuesta' }).click()
    await expect(panel.getByLabel('Motivo', { exact: true })).toHaveAccessibleDescription(/Indica un motivo/)
    assert.equal(operator.posts.length, 0)
    assert.deepEqual(ledger(), { reviews: [], approvals: [] })
    return 'Sin motivo: error visible, cero POST y cero escrituras'
  })
  await panel.getByLabel('Motivo', { exact: true }).selectOption('DATOS_INCOMPLETOS')
  await panel.getByLabel('Detalle del motivo (opcional)').fill(DETAIL)
  await check('proposal_checklist_required', async () => {
    await panel.getByRole('button', { name: 'Registrar propuesta' }).click()
    await expect(panel.locator('#rv-summary')).toBeVisible()
    await expect(panel.getByRole('checkbox', { name: 'Canal válido', exact: true })).toHaveAttribute('aria-invalid', 'true')
    assert.equal(operator.posts.length, 0)
    assert.deepEqual(ledger(), { reviews: [], approvals: [] })
    return 'Intensidad 3 sin lista: error visible y cero escrituras'
  })
  await check('modification_persists', async () => {
    await checklist(panel)
    await panel.getByRole('button', { name: 'Registrar propuesta' }).click()
    await expect(panel.locator('#rv-notice')).toContainText('Requiere aprobación de un supervisor.')
    assert.equal(operator.posts.length, 1)
    await page.reload()
    await expect(panelOf(page).getByText(`Detalle: ${DETAIL}`, { exact: true })).toBeVisible()
    await expect(panelOf(page).getByText('Requiere aprobación de un supervisor', { exact: true })).toBeVisible()
    const rows = ledger()
    assert.equal(rows.reviews.length, 1)
    assert.equal(rows.reviews[0].decision, 'MODIFICA')
    assert.equal(rows.reviews[0].decided_intensity, 3)
    assert.equal(rows.reviews[0].reason_code, 'DATOS_INCOMPLETOS')
    assert.equal(rows.reviews[0].as_of, load.cutoff)
    assert.equal(rows.reviews[0].rules_version, load.rules_version)
    assert.equal(rows.approvals.length, 0)
    await capture(page, '03-modifica-persistida')
    return { reviews: 1, decision: 'MODIFICA', intensity: 3, pending: true }
  })
  let supervisor
  await check('supervisor_identity', async () => {
    supervisor = await session(base, config, 'supervisor')
    assert.notEqual(operator.identity.user.id, supervisor.identity.user.id)
    await supervisor.page.goto(`${base}/debtors/${load.debtors[0].id}?tab=revision`)
    await expect(panelOf(supervisor.page).getByRole('heading', { name: 'Tu decisión', exact: true })).toHaveCount(0)
    await expect(panelOf(supervisor.page).getByText(`Detalle: ${DETAIL}`, { exact: true })).toBeVisible()
    return 'Segundo login UI, distinto auth_user, ve la propuesta persistida'
  })
  const approval = panelOf(supervisor.page)
  await approval.getByRole('radio', { name: 'Aprobar la propuesta' }).check()
  await check('approval_checklist_required', async () => {
    const before = ledger()
    await approval.getByRole('button', { name: 'Registrar respuesta' }).click()
    await expect(approval.locator('#ap-summary')).toBeVisible()
    assert.equal(supervisor.posts.length, 0)
    assert.deepEqual(ledger(), before)
    return 'Aprobación sin lista rechazada sin POST ni filas nuevas'
  })
  await check('approval_persists', async () => {
    await checklist(approval.locator('form'))
    await approval.getByRole('button', { name: 'Registrar respuesta' }).click()
    await expect(approval.locator('#ap-notice')).toContainText('Aprobada por un supervisor.')
    assert.equal(supervisor.posts.length, 1)
    await supervisor.page.reload()
    await expect(panelOf(supervisor.page).getByText('Aprobada por un supervisor', { exact: true })).toBeVisible()
    const rows = ledger()
    assert.equal(rows.reviews.length, 1)
    assert.equal(rows.approvals.length, 1)
    assert.equal(rows.approvals[0].decision, 'APRUEBA')
    assert.equal(rows.approvals[0].case_review, rows.reviews[0].id)
    assert.notEqual(rows.approvals[0].approver_user, rows.reviews[0].reviewer_user)
    for (const row of [rows.reviews[0], rows.approvals[0]]) {
      assert.equal(row.checklist.situacion_hogar, 'NO_DISPONIBLE')
      for (const name of ['estado_juridico_verificado', 'canal_valido', 'alternativa_asistida_ofrecida']) assert.equal(row.checklist[name], true)
    }
    await capture(supervisor.page, '04-aprobacion-persistida')
    return { approvals: 1, distinct_approver: true, checklist: 'Completa, situación del hogar no disponible' }
  })
  await check('csv_metadata_totals', async () => {
    const response = await operator.context.request.get(`${base}/api/reports/queue`, { maxRedirects: 0 })
    assert.equal(response.status(), 200)
    assert.match(response.headers()['content-type'], /text\/csv/)
    const csv = await response.text()
    await writeFile(resolve(output, 'cola.csv'), csv)
    const rows = parseCsv(csv)
    report.csv_observed = { sha256: sha256(csv), metadata: rows.map(row => ({ fecha_corte: row.fecha_corte,
      fecha_calculo_usada: row.fecha_calculo_usada, version_reglas: row.version_reglas, filtros: row.filtros })),
    totals: rows.filter(row => row.tipo_fila === 'TOTAL') }
    // Filtro desconocido: debe rechazarse, nunca exportar todo silenciosamente.
    const invalid = await operator.context.request.get(`${base}/api/reports/queue?filtro_inexistente=1`, { maxRedirects: 0 })
    assert.equal(invalid.status(), 400)
    assertCsvTotals(rows, load)
    report.csv_observed.totals_match_load = true
    assertCsv(rows, load)
    return { objects: 2, obligations: 6, amount_ars: 1800000, sha256: sha256(csv), invalid_filter_status: 400 }
  }, true) // Logout y vencimiento son independientes del resultado de la exportación.
  await check('logout_direct_denied', async () => {
    for (const actor of [operator, supervisor]) {
      await actor.page.getByRole('button', { name: 'Cerrar sesion', exact: true }).click()
      await expect(actor.page).toHaveURL(/\/login/)
      for (const path of [`/debtors/${load.debtors[0].id}`, '/priority-cases', '/api/reports/queue']) await directDenied(actor.context, base, path)
      await actor.page.goto(`${base}/debtors/${load.debtors[0].id}?tab=revision`)
      await expect(actor.page).toHaveURL(/\/login\?next=/)
      await expect(actor.page.getByRole('tabpanel')).toHaveCount(0)
    }
    return 'Ambas identidades: logout UI, HTML y CSV directos denegados con 307 a login'
  })
  await check('expired_session_denied', async () => {
    const expired = await session(base, config, 'operador')
    // Sesión Auth real: revocar refresh por logout real y acortar la vida del JWT solo en el fixture.
    const response = await fetch(`${config.supabaseUrl}/auth/v1/logout?scope=global`, { method: 'POST',
      headers: { apikey: config.publishableKey, Authorization: `Bearer ${expired.identity.access_token}` },
      redirect: 'manual', signal: AbortSignal.timeout(10_000) })
    assert.equal(response.status, 204)
    const payload = JSON.parse(Buffer.from(expired.identity.access_token.split('.')[1], 'base64url').toString())
    const expires = Math.floor(Date.now() / 1000) + 2
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const body = Buffer.from(JSON.stringify({ ...payload, exp: expires })).toString('base64url')
    const unsigned = `${header}.${body}`
    const token = `${unsigned}.${createHmac('sha256', config.jwtSecret).update(unsigned).digest('base64url')}`
    secrets.push(token)
    const stored = { ...expired.identity, access_token: token, expires_at: expires, expires_in: 2 }
    const cookieValue = 'base64-' + Buffer.from(JSON.stringify(stored)).toString('base64url')
    const cookies = await expired.context.cookies()
    const authCookies = cookies.filter(cookie => /^sb-.*-auth-token(?:\.\d+)?$/.test(cookie.name))
    const name = authCookies[0].name.replace(/\.\d+$/, '')
    await expired.context.clearCookies({ name: /^sb-.*-auth-token(?:\.\d+)?$/ })
    for (let offset = 0; offset < cookieValue.length; offset += 3180) {
      await expired.context.addCookies([{ ...authCookies[0], name: `${name}.${offset / 3180}`, value: cookieValue.slice(offset, offset + 3180) }])
    }
    // Evita que una pestaña abierta refresque mientras se comprueba la cookie vencida en el servidor.
    await expired.page.close()
    await expect.poll(() => Math.floor(Date.now() / 1000), { timeout: 10_000 }).toBeGreaterThan(expires)
    const expiredCookies = await expired.context.cookies()
    for (const path of ['/priority-cases', `/debtors/${load.debtors[0].id}`, '/api/reports/queue']) {
      await expired.context.addCookies(expiredCookies)
      await directDenied(expired.context, base, path)
    }
    await expired.context.addCookies(expiredCookies)
    const page = await expired.context.newPage()
    page.on('pageerror', error => report.console_errors.push(clean(error.message)))
    page.on('console', message => { if (message.type() === 'error') report.console_errors.push(clean(message.text())) })
    await page.goto(`${base}/debtors/${load.debtors[0].id}`)
    await expect(page).toHaveURL(/\/login\?next=/)
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
    await expect(page.getByRole('tabpanel')).toHaveCount(0)
    return 'JWT de sesión real con expiración corta y refresh revocado realmente; espera de vencimiento; HTML/CSV denegados'
  })
  await check('console_clean', async () => {
    assert.deepEqual(report.console_errors, [])
    return { console_errors: 0, page_errors: 0 }
  })
  assert.deepEqual(report.checks.map(item => item.id), CHECKS)
  report.passed = report.checks.every(item => item.passed)
}

try { await run() }
catch (error) {
  report.error = clean(error.message)
  report.failed_check = activeCheck
  console.error(`FAIL ${activeCheck}: ${report.error}`)
  process.exitCode = 1
} finally {
  clearTimeout(timer)
  if (browser) await browser.close()
  report.ended_at_utc = new Date().toISOString()
  for (const id of CHECKS) if (!report.checks.some(item => item.id === id)) report.checks.push({ id, passed: false, observed: id === activeCheck ? report.error : 'No alcanzado por fallo previo' })
  report.tests = { passed: report.checks.filter(item => item.passed).length, failed: report.checks.filter(item => !item.passed).length, skipped: 0 }
  if (outputCreated) {
    const xml = value => String(value ?? '').replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[char]))
    const properties = ['source_sha', 'dataset_sha256', 'rules_version', 'rules_sha256', 'environment', 'limits'].map(key => `<property name="${key}" value="${xml(report[key])}"/>`).join('')
    const cases = report.checks.map(item => `<testcase classname="ALIGN-029" name="${item.id}">${item.passed ? '' : `<failure message="${xml(clean(item.observed))}"/>`}</testcase>`).join('')
    await writeFile(resolve(output, 'thesis-flow.json'), JSON.stringify(report, null, 2) + '\n')
    await writeFile(resolve(output, 'thesis-flow.xml'), `<?xml version="1.0" encoding="UTF-8"?><testsuite name="ALIGN-029" tests="${CHECKS.length}" failures="${report.tests.failed}" skipped="0"><properties>${properties}</properties>${cases}</testsuite>\n`)
  }
}
