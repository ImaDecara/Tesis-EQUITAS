// N6. Recorrido real de la demo local persistente: next start + Supabase local, con la cartera de
// database/demo/cartera-demo-v1 publicada por el ETL real (scripts/demo/equitas_demo.py init).
// No resetea, no siembra y no simula respuestas. Solo escribe lo que escribiría una persona: en modo
// `recorrido`, una decisión del operador y una aprobación del supervisor sobre --case, más los
// registros de auditoría de aperturas y descargas. Las contraseñas salen del archivo privado de la
// demo y nunca se imprimen ni se guardan en la evidencia.
//
// Desde front/, con la app de la demo en marcha:
//   node tests/smoke/demo-local-walkthrough.mjs --mode recorrido --output <dir nuevo>
//   node tests/smoke/demo-local-walkthrough.mjs --mode persistencia --expect <dir del recorrido>/report.json --output <dir nuevo>
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium, expect as baseExpect } from '@playwright/test'
import { localOrigin, parseCsv } from './thesis-flow/contracts.mjs'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const { values } = parseArgs({ options: { 'base-url': { type: 'string', default: 'http://127.0.0.1:3000' },
  mode: { type: 'string', default: 'recorrido' }, output: { type: 'string' }, expect: { type: 'string' },
  case: { type: 'string', default: 'DEMO6-1-60003' }, home: { type: 'string' } } })
const expect = baseExpect.configure({ timeout: 20_000 })
const DETAIL = 'Ajuste de la demo N6 para comprobar persistencia'
const SUPABASE = 'http://127.0.0.1:54321'
const sha256 = value => createHash('sha256').update(value).digest('hex')
const normal = text => text.replace(/\s+/g, ' ').trim()
const ars = value => normal(new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(value)))
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 10_000 }).trim()
const sql = query => JSON.parse(execFileSync('docker', ['exec', '-i', 'supabase_db_equitas-tp-testing', 'psql', '-X', '-q', '-At',
  '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: `select coalesce((${query}),'null')::text;`, encoding: 'utf8',
  timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'] }))
const report = { case_id: 'N6-DEMO-LOCAL', mode: values.mode, passed: false, started_at_utc: new Date().toISOString(), checks: [],
  screenshots: [], console_errors: [], environment: 'next start + Supabase local (demo persistente)',
  limits: 'Cartera sintética de la demo. Demuestra el recorrido técnico local; no certifica Vercel, bases remotas ni uso municipal.' }
const secrets = []
const clean = value => {
  let text = String(value)
  for (const secret of secrets) if (secret) text = text.split(secret).join('[privado]')
  return text.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_(?:secret|publishable)_[\w-]+/g, '[clave]')
}
let browser, output, base, accounts, manifest, caseRow
const check = async (id, action) => {
  try {
    const observed = await action()
    report.checks.push({ id, passed: true, observed, ended_at_utc: new Date().toISOString() })
    console.log(`ok ${id}`)
  } catch (error) {
    report.checks.push({ id, passed: false, observed: clean(error.message), ended_at_utc: new Date().toISOString() })
    console.error(`FAIL ${id}: ${clean(error.message)}`)
    process.exitCode = 1
  }
}

async function readAccounts() {
  const home = resolve(values.home ?? process.env.EQUITAS_DEMO_HOME ?? `${homedir()}/.equitas-demo`)
  const path = resolve(home, 'cuentas.json')
  assert.equal((await stat(path)).mode & 0o077, 0, 'cuentas.json debe ser 0600')
  const data = JSON.parse(await readFile(path, 'utf8'))
  for (const key of ['consulta', 'operador', 'supervisor', 'importador', 'ajeno', 'sin-membresia']) {
    assert(data[key]?.email?.endsWith('@example.test') && data[key]?.password, `Falta la cuenta ${key}`)
    secrets.push(data[key].password, data[key].email)
  }
  return data
}

const ledger = id => sql(`select json_build_object('reviews', coalesce((select json_agg(t order by id) from (select id, decision,
  decided_intensity, reason_code, reviewer, as_of, checklist from public.case_review where debtor = ${Number(id)}) t), '[]'),
  'approvals', coalesce((select json_agg(json_build_object('id', a.id, 'case_review', a.case_review, 'decision', a.decision,
  'approver', a.approver, 'checklist', a.checklist) order by a.id) from public.case_review_approval a
  join public.case_review r on r.id = a.case_review where r.debtor = ${Number(id)}), '[]'))`)
const portfolio = () => sql(`select json_build_object('objects', (select count(*) from public.debtor where tenant = 1 and identifier like 'DEMO6-%'),
  'debts', (select count(*) from public.debt d join public.debtor o on o.id = d.debtor where o.tenant = 1 and o.identifier like 'DEMO6-%'),
  'amount', (select sum(d.current_amount)::text from public.debt d join public.debtor o on o.id = d.debtor where o.tenant = 1 and o.identifier like 'DEMO6-%'),
  'published', (select json_agg(json_build_object('id', id, 'as_of', as_of, 'cabecera', file_hashes->>'cabecera', 'detalle', file_hashes->>'detalle') order by id)
                from public.import_batch where tenant = 1 and status = 'PUBLICADO'),
  'events', (select count(*) from public.import_batch), 'publications', (select count(*) from public.import_publication),
  'reviews', (select count(*) from public.case_review), 'approvals', (select count(*) from public.case_review_approval))`)
const auditCount = action => sql(`select to_json(count(*)) from public.access_audit where action = '${action}'`)
const idsOf = list => sql(`select coalesce(json_agg(id::text order by id), '[]') from public.debtor where identifier in (${list.map(item => `'${item.replace(/[^A-Z0-9-]/g, '')}'`).join(',')})`)

async function capture(page, name) {
  assert(!new URL(page.url()).pathname.startsWith('/login'), 'Nunca capturar la pantalla de credenciales')
  const file = `${name}.png`
  await page.screenshot({ path: resolve(output, file), fullPage: true })
  report.screenshots.push({ path: file, sha256: sha256(await readFile(resolve(output, file))) })
}

async function session(key, landing = '/') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'es-AR', serviceWorkers: 'block' })
  context.setDefaultTimeout(20_000)
  await context.route('**/*', route => {
    if (![base, SUPABASE].includes(new URL(route.request().url()).origin)) {
      report.console_errors.push(`${key}: solicitud fuera de loopback bloqueada`)
      return route.abort('blockedbyclient')
    }
    return route.continue()
  })
  const page = await context.newPage()
  const where = () => `${key} ${pathOf(page)}${key === 'importador' ? ` #${importerVisits.length - 1}` : ''}`
  page.on('console', message => { if (message.type() === 'error') report.console_errors.push(`${where()}: ${clean(message.text())}`) })
  page.on('pageerror', error => report.console_errors.push(`${where()}: ${clean(error.message)}`))
  const posts = []
  page.on('request', request => { if (request.method() === 'POST' && request.headers()['next-action']) posts.push(request.url()) })
  await page.goto(`${base}/login?next=${encodeURIComponent(landing)}`)
  await page.getByLabel('Email', { exact: true }).fill(accounts[key].email)
  await page.getByLabel('Password', { exact: true }).fill(accounts[key].password)
  // El ingreso del importador ya renderiza la página de destino: cuenta como visita del escenario conocido.
  if (key === 'importador') importerVisits.push(new URL(landing, base).pathname)
  await page.getByRole('button', { name: 'Iniciar sesion', exact: true }).click()
  return { key, context, page, posts }
}

const pathOf = page => { try { return new URL(page.url()).pathname } catch { return '?' } }
// Rutas de cartera que el importador abre a propósito (escenario negativo conocido, preexistente en efad967).
const importerVisits = []
async function visitAsImporter(actor, path) {
  await actor.page.waitForLoadState('networkidle')
  importerVisits.push(new URL(`${base}${path}`).pathname)
  await actor.page.goto(`${base}${path}`)
  await expect(actor.page.getByText('Datos no disponibles', { exact: true })).toBeVisible({ timeout: 45_000 })
  await actor.page.waitForLoadState('networkidle')
}

async function signedIn(actor) {
  await actor.page.waitForLoadState('networkidle')
  const cookies = await actor.context.cookies(base)
  assert(cookies.some(cookie => /^sb-.*-auth-token(?:\.\d+)?$/.test(cookie.name)), `${actor.key}: el ingreso no dejó una sesión Auth`)
}

async function forbidden(actor, path) {
  const file = await csv(actor, path)
  assert.equal(file.status, 403, `${actor.key} ${path}: se esperaba 403`)
  assert.equal(JSON.parse(file.body).error, 'ROLE_FORBIDDEN', `${actor.key} ${path}: se esperaba ROLE_FORBIDDEN`)
  assert.equal(identifiers(file.body).length, 0)
  return file.status
}

async function landed(actor, heading) {
  await expect(actor.page.getByRole('heading', { name: heading, exact: true })).toBeVisible({ timeout: 45_000 })
}

async function csv(actor, path) {
  const response = await actor.context.request.get(`${base}${path}`, { maxRedirects: 0 })
  return { status: response.status(), type: response.headers()['content-type'] ?? '', body: await response.text() }
}

const reviewPanel = page => page.getByRole('tabpanel', { name: 'Revisión' })
const identifiers = text => [...new Set(text.match(/DEMO6-\d-\d{5}/g) ?? [])].sort()

async function checklist(scope) {
  await scope.getByRole('radio', { name: 'No disponible', exact: true }).check()
  for (const name of ['Estado jurídico', 'Canal válido', 'Alternativa asistida']) await scope.getByRole('checkbox', { name: new RegExp(name) }).check()
}

async function deniedToLogin(actor, path) {
  const response = await actor.context.request.get(`${base}${path}`, { maxRedirects: 0 })
  assert.equal(response.status(), 307, `${path}: se esperaba 307`)
  assert.equal(new URL(response.headers().location, base).pathname, '/login')
  assert.equal(identifiers(await response.text()).length, 0)
}

async function consultaChecks() {
  const expected = manifest.resultados_esperados
  const consulta = await session('consulta')
  await check('consulta_dashboard_manifest', async () => {
    await landed(consulta, 'Dashboard ejecutivo')
    const text = normal(await consulta.page.locator('main').innerText())
    assert(text.includes(`Corte del manifiesto: ${manifest.fecha_corte}`), 'Corte distinto del manifiesto')
    assert.match(text, new RegExp(`DEUDA TOTAL ${ars(expected.importe_total_actualizado_ars).replace(/[$.]/g, '\\$&')}`, 'i'))
    assert.match(text, new RegExp(`CASOS VENCIDOS ${expected.objetos_con_obligacion_pendiente_vencida_al_corte.length}\\b`, 'i'))
    assert.match(text, new RegExp(`CASOS SIN CONTACTO ${expected.objetos_sin_contacto_utilizable.length}\\b`, 'i'))
    assert(text.includes(`${expected.objetos} de ${expected.objetos} objetos con dato`))
    const links = await consulta.page.locator('a[data-report]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')))
    assert.deepEqual(links, ['/api/reports/queue', '/api/reports/data-quality', '/api/reports/decisions'])
    await capture(consulta.page, '01-consulta-tablero')
    return { cutoff: manifest.fecha_corte, deuda_total: ars(expected.importe_total_actualizado_ars), report_links: links }
  })
  await check('consulta_filters_queue_detail', async () => {
    await consulta.page.goto(`${base}/debtors?contact=without`)
    await landed(consulta, 'Objetos de deuda')
    const found = identifiers(await consulta.page.locator('main').innerText())
    assert.deepEqual(found, [...expected.objetos_sin_contacto_utilizable].sort())
    await consulta.page.goto(`${base}/priority-cases?contact=without`)
    await landed(consulta, 'Casos prioritarios')
    const href = await consulta.page.locator('[data-queue-csv] a').getAttribute('href')
    assert.equal(href, '/api/reports/queue?contact=without')
    const file = await csv(consulta, href)
    assert.equal(file.status, 200)
    const rows = parseCsv(file.body)
    const details = rows.filter(row => row.tipo_fila === 'DETALLE')
    // consulta no tiene report:object-identifier: el CSV omite el identificador y se compara por id.
    assert(details.every(row => row.identificador === 'OMITIDO_POR_ROL'))
    assert.deepEqual(details.map(row => row.objeto_id).sort(), idsOf(expected.objetos_sin_contacto_utilizable).sort())
    assert(rows.every(row => row.fecha_corte === manifest.fecha_corte && row.filtros === 'contact=without'))
    const amount = manifest.casos.filter(item => expected.objetos_sin_contacto_utilizable.includes(item.identificador))
      .reduce((sum, item) => sum + Number(item.importe_actualizado_ars), 0)
    assert.equal(Number(rows.find(row => row.tipo_fila === 'TOTAL').deuda_total_ars), amount)
    await consulta.page.getByRole('navigation', { name: 'Colas por intervención' }).getByRole('link', { name: /Mejorar datos/ }).click()
    await expect(consulta.page).toHaveURL(/queue=/)
    await consulta.page.getByRole('link', { name: /^Abrir revisión DEMO6-/ }).first().click()
    await expect(reviewPanel(consulta.page)).toBeVisible()
    await expect(reviewPanel(consulta.page).getByRole('heading', { name: 'Tu decisión', exact: true })).toHaveCount(0)
    return { sin_contacto: found, csv_detalles: details.length, csv_total_ars: amount, cola_a_ficha: new URL(consulta.page.url()).pathname }
  })
  await check('consulta_missing_values_visible', async () => {
    const row = sql(`select json_build_object('id', id) from public.debtor where identifier = 'DEMO6-3-60014'`)
    await consulta.page.goto(`${base}/debtors/${row.id}`)
    await expect(consulta.page.getByRole('tablist', { name: 'Secciones del objeto' })).toBeVisible()
    await consulta.page.getByRole('tab', { name: 'Personas asociadas', exact: true }).click()
    const panel = consulta.page.getByRole('tabpanel', { name: 'Personas asociadas', exact: true })
    await expect(panel.getByText(/No se puede verificar la suma: hay porcentajes no informados/)).toBeVisible()
    await expect(panel.getByRole('cell', { name: 'No informado', exact: true }).first()).toBeVisible()
    await capture(consulta.page, '02-consulta-faltantes')
    return 'Porcentaje faltante: «No informado» y suma no verificable, sin inventar 100'
  })
  return consulta
}

async function decisionChecks() {
  const operator = await session('operador')
  await landed(operator, 'Dashboard ejecutivo')
  await check('operator_decision_persists', async () => {
    assert.deepEqual(ledger(caseRow.id), { reviews: [], approvals: [] }, 'El caso elegido ya tiene decisiones')
    await operator.page.goto(`${base}/debtors/${caseRow.id}?tab=revision`)
    const panel = reviewPanel(operator.page)
    await expect(panel.getByRole('heading', { name: 'Tu decisión', exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Registrar respuesta' })).toHaveCount(0)
    await panel.getByRole('radio', { name: 'Modificar la acción', exact: true }).check()
    await panel.getByLabel('Acción propuesta', { exact: true }).selectOption('INTIMACION_ADMINISTRATIVA:3')
    await panel.getByRole('button', { name: 'Registrar propuesta' }).click()
    await expect(panel.getByLabel('Motivo', { exact: true })).toHaveAccessibleDescription(/Indica un motivo/)
    assert.equal(operator.posts.length, 0, 'Sin motivo no debe haber POST')
    await panel.getByLabel('Motivo', { exact: true }).selectOption('DATOS_INCOMPLETOS')
    await panel.getByLabel('Detalle del motivo (opcional)').fill(DETAIL)
    await panel.getByRole('button', { name: 'Registrar propuesta' }).click()
    await expect(panel.getByRole('checkbox', { name: 'Canal válido', exact: true })).toHaveAttribute('aria-invalid', 'true')
    assert.equal(operator.posts.length, 0, 'Sin lista de control no debe haber POST')
    assert.deepEqual(ledger(caseRow.id), { reviews: [], approvals: [] })
    await checklist(panel)
    await panel.getByRole('button', { name: 'Registrar propuesta' }).click()
    await expect(panel.locator('#rv-notice')).toContainText('Requiere aprobación de un supervisor.')
    assert.equal(operator.posts.length, 1)
    await operator.page.reload()
    await expect(reviewPanel(operator.page).getByText(`Detalle: ${DETAIL}`, { exact: true })).toBeVisible()
    const rows = ledger(caseRow.id)
    assert.equal(rows.reviews.length, 1)
    assert.equal(rows.reviews[0].decision, 'MODIFICA')
    assert.equal(rows.reviews[0].decided_intensity, 3)
    assert.equal(rows.reviews[0].reason_code, 'DATOS_INCOMPLETOS')
    assert.equal(rows.reviews[0].as_of, manifest.fecha_corte)
    await capture(operator.page, '03-operador-decision-persistida')
    return { review_id: rows.reviews[0].id, decision: 'MODIFICA', intensidad: 3, motivo: 'DATOS_INCOMPLETOS' }
  })
  const supervisor = await session('supervisor')
  await landed(supervisor, 'Dashboard ejecutivo')
  await check('supervisor_approval_persists', async () => {
    await supervisor.page.goto(`${base}/debtors/${caseRow.id}?tab=revision`)
    const panel = reviewPanel(supervisor.page)
    await expect(panel.getByRole('heading', { name: 'Tu decisión', exact: true })).toHaveCount(0)
    await expect(panel.getByText(`Detalle: ${DETAIL}`, { exact: true })).toBeVisible()
    await panel.getByRole('radio', { name: 'Aprobar la propuesta' }).check()
    await panel.getByRole('button', { name: 'Registrar respuesta' }).click()
    await expect(panel.locator('#ap-summary')).toBeVisible()
    assert.equal(supervisor.posts.length, 0, 'Sin lista de control no debe haber POST')
    await checklist(panel.locator('form'))
    await panel.getByRole('button', { name: 'Registrar respuesta' }).click()
    await expect(panel.locator('#ap-notice')).toContainText('Aprobada por un supervisor.')
    assert.equal(supervisor.posts.length, 1)
    await supervisor.page.reload()
    await expect(reviewPanel(supervisor.page).getByText('Aprobada por un supervisor', { exact: true })).toBeVisible()
    const rows = ledger(caseRow.id)
    assert.equal(rows.approvals.length, 1)
    assert.equal(rows.approvals[0].decision, 'APRUEBA')
    assert.equal(rows.approvals[0].case_review, rows.reviews[0].id)
    assert.notEqual(rows.approvals[0].approver, rows.reviews[0].reviewer, 'Aprobador y proponente deben ser personas distintas')
    await capture(supervisor.page, '04-supervisor-aprobacion-persistida')
    return { approval_id: rows.approvals[0].id, aprobador_distinto: true }
  })
  return { operator, supervisor }
}

async function reportChecks(supervisor, consulta) {
  const expected = manifest.resultados_esperados
  await check('reports_supervisor_visible_and_correct', async () => {
    await supervisor.page.goto(`${base}/`)
    await landed(supervisor, 'Dashboard ejecutivo')
    const links = await supervisor.page.locator('a[data-report]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')))
    assert.deepEqual(links, ['/api/reports/queue', '/api/reports/data-quality', '/api/reports/decisions', '/api/reports/supervision', '/api/reports/access'])
    const before = auditCount('REPORT_EXPORT')
    const files = {}
    for (const link of links) {
      const file = await csv(supervisor, link)
      assert.equal(file.status, 200, `${link}: ${file.status}`)
      assert.match(file.type, /text\/csv/)
      files[link] = parseCsv(file.body)
      await writeFile(resolve(output, `${link.split('/').at(-1)}.csv`), file.body)
    }
    const queue = files['/api/reports/queue']
    const total = queue.find(row => row.tipo_fila === 'TOTAL')
    assert.equal(queue.filter(row => row.tipo_fila === 'DETALLE').length, expected.objetos)
    assert.equal(Number(total.objetos), expected.objetos)
    assert.equal(Number(total.obligaciones), expected.obligaciones)
    assert.equal(Number(total.deuda_total_ars), Number(expected.importe_total_actualizado_ars))
    for (const path of ['/api/reports/queue', '/api/reports/data-quality']) {
      assert(files[path].every(row => row.fecha_corte === manifest.fecha_corte), `${path}: corte distinto`)
    }
    const decision = files['/api/reports/decisions'].find(row => row.tipo_fila === 'DETALLE' && row.objeto_id === String(caseRow.id))
    assert(decision && decision.decision === 'MODIFICA' && decision.aprobacion === 'APRUEBA' && decision.fecha_corte === manifest.fecha_corte)
    assert(files['/api/reports/supervision'].some(row => Object.values(row).includes('APRUEBA')))
    const access = files['/api/reports/access'].filter(row => row.tipo_fila === 'DETALLE').map(row => row.accion)
    assert(access.includes('CASE_OPEN') && access.includes('REPORT_EXPORT'))
    const after = auditCount('REPORT_EXPORT')
    assert(after >= before + links.length, 'Cada descarga debe quedar auditada')
    return { links, queue_total_ars: total.deuda_total_ars, decisions_row: { decision: decision.decision, aprobacion: decision.aprobacion },
      audit_report_export_added: after - before }
  })
  await check('reports_denied_by_role', async () => {
    const statuses = {}
    for (const path of ['/api/reports/supervision', '/api/reports/access']) statuses[`consulta ${path}`] = await forbidden(consulta, path)
    const importer = await session('importador')
    await signedIn(importer)
    await visitAsImporter(importer, '/')
    for (const path of ['/api/reports/queue', '/api/reports/data-quality', '/api/reports/decisions', '/api/reports/supervision', '/api/reports/access']) {
      statuses[`importador ${path}`] = await forbidden(importer, path)
    }
    await importer.context.close()
    const anonymous = await browser.newContext()
    const response = await anonymous.request.get(`${base}/api/reports/queue`, { maxRedirects: 0 })
    assert.equal(response.status(), 307)
    assert.equal(new URL(response.headers().location, base).pathname, '/login')
    statuses['anonimo /api/reports/queue'] = response.status()
    await anonymous.close()
    return statuses
  })
}

async function accessChecks(actors) {
  await check('logout_blocks_protected_routes', async () => {
    for (const actor of actors) {
      await actor.page.goto(`${base}/`)
      await actor.page.getByRole('button', { name: 'Cerrar sesion', exact: true }).click()
      await expect(actor.page).toHaveURL(/\/login/)
      for (const path of ['/', '/priority-cases', `/debtors/${caseRow.id}`, '/api/reports/queue']) await deniedToLogin(actor, path)
    }
    return `${actors.map(actor => actor.key).join(', ')}: logout y acceso directo redirigido a /login`
  })
  await check('foreign_and_unassigned_identities_get_no_portfolio', async () => {
    const observed = {}
    const pages = ['/', '/priority-cases', `/debtors/${caseRow.id}`]
    // ajeno: sesión válida en otro municipio; ve pantallas vacías y un CSV sin filas.
    const foreignActor = await session('ajeno')
    await signedIn(foreignActor)
    for (const path of pages) {
      const response = await foreignActor.context.request.get(`${base}${path}`, { maxRedirects: 0 })
      assert.equal(response.status(), 200, `ajeno ${path}`)
      assert.equal(identifiers(await response.text()).length, 0, `ajeno ${path} no debe ver la cartera del municipio 1`)
      observed[`ajeno ${path}`] = response.status()
    }
    const foreignCsv = await csv(foreignActor, '/api/reports/queue')
    assert.equal(foreignCsv.status, 200)
    assert.equal(parseCsv(foreignCsv.body).filter(row => row.tipo_fila === 'DETALLE').length, 0)
    observed['ajeno /api/reports/queue'] = foreignCsv.status
    await foreignActor.page.goto(`${base}/debtors/${caseRow.id}?tab=revision`)
    await expect(foreignActor.page.getByRole('button', { name: /Registrar (propuesta|respuesta)/ })).toHaveCount(0)
    await foreignActor.context.close()
    // sin-membresia: la app no le abre sesión; todo vuelve a /login.
    const unassigned = await session('sin-membresia')
    await unassigned.page.waitForLoadState('networkidle')
    for (const path of [...pages, '/api/reports/queue']) {
      await deniedToLogin(unassigned, path)
      observed[`sin-membresia ${path}`] = 307
    }
    await unassigned.context.close()
    // importador: sesión válida sin lectura de cartera: «Datos no disponibles», CSV 403, sin formularios.
    const importer = await session('importador')
    await signedIn(importer)
    for (const path of pages) {
      const response = await importer.context.request.get(`${base}${path}`, { maxRedirects: 0 })
      assert.equal(identifiers(await response.text()).length, 0, `importador ${path} no debe ver la cartera`)
      observed[`importador ${path}`] = response.status()
    }
    observed['importador /api/reports/queue'] = await forbidden(importer, '/api/reports/queue')
    await visitAsImporter(importer, `/debtors/${caseRow.id}?tab=revision`)
    await expect(importer.page.getByRole('button', { name: /Registrar (propuesta|respuesta)/ })).toHaveCount(0)
    await importer.context.close()
    return observed
  })
}

async function persistenceChecks(previous) {
  await check('decision_and_approval_survive_restart', async () => {
    const rows = ledger(caseRow.id)
    assert.equal(rows.reviews.length, 1)
    assert.equal(rows.approvals.length, 1)
    assert.equal(rows.reviews[0].id, previous.review_id)
    assert.equal(rows.approvals[0].id, previous.approval_id)
    const supervisor = await session('supervisor')
    await landed(supervisor, 'Dashboard ejecutivo')
    await supervisor.page.goto(`${base}/debtors/${caseRow.id}?tab=revision`)
    await expect(reviewPanel(supervisor.page).getByText(`Detalle: ${DETAIL}`, { exact: true })).toBeVisible()
    await expect(reviewPanel(supervisor.page).getByText('Aprobada por un supervisor', { exact: true })).toBeVisible()
    await capture(supervisor.page, '05-persistencia-tras-reinicio')
    const decisions = parseCsv((await csv(supervisor, '/api/reports/decisions')).body)
    const row = decisions.find(item => item.tipo_fila === 'DETALLE' && item.objeto_id === String(caseRow.id))
    assert(row && row.decision === 'MODIFICA' && row.aprobacion === 'APRUEBA')
    await supervisor.context.close()
    return { review_id: rows.reviews[0].id, approval_id: rows.approvals[0].id }
  })
}

async function run() {
  assert(['recorrido', 'persistencia'].includes(values.mode), '--mode recorrido|persistencia')
  assert(values.output, 'Falta --output nuevo')
  output = resolve(values.output)
  await mkdir(output)
  base = localOrigin(values['base-url'])
  report.base_url = base
  report.source_sha = git('rev-parse', 'HEAD')
  report.tree_clean = git('status', '--porcelain') === ''
  manifest = JSON.parse(await readFile(resolve(ROOT, 'database/demo/cartera-demo-v1/manifiesto-demo.json'), 'utf8'))
  report.dataset_sha256 = manifest.dataset_sha256
  accounts = await readAccounts()
  caseRow = sql(`select json_build_object('id', id, 'identifier', identifier) from public.debtor where identifier = '${values.case.replace(/[^A-Z0-9-]/g, '')}'`)
  assert(caseRow?.id, 'Caso inexistente')
  report.case = caseRow
  await check('environment', async () => {
    const response = await fetch(`${base}/api/build-info`, { redirect: 'manual', signal: AbortSignal.timeout(10_000) })
    assert.equal(response.status, 200)
    const info = await response.json()
    assert.equal(info.environment, 'local')
    assert.equal(info.supabaseProjectRef, null)
    assert.equal(info.sourceSha, report.source_sha, 'El servidor no corresponde al commit actual')
    return info
  })
  await check('data_matches_manifest', async () => {
    const data = portfolio()
    const hashes = Object.fromEntries(Object.entries(manifest.archivos).map(([name, spec]) => [name.replace('.tsv', ''), spec.sha256]))
    assert.equal(data.objects, manifest.resultados_esperados.objetos)
    assert.equal(data.debts, manifest.resultados_esperados.obligaciones)
    assert.equal(Number(data.amount), Number(manifest.resultados_esperados.importe_total_actualizado_ars))
    assert.equal(data.published.length, 1, 'Debe existir una sola publicación de la cartera demo')
    assert.equal(data.published[0].as_of, manifest.fecha_corte)
    assert.equal(data.published[0].cabecera, hashes.cabecera)
    assert.equal(data.published[0].detalle, hashes.detalle)
    report.portfolio = data
    return data
  })
  browser = await chromium.launch()
  const timer = setTimeout(() => { void browser.close() }, 900_000)
  try {
    if (values.mode === 'persistencia') {
      assert(values.expect, 'Falta --expect con el report.json del recorrido')
      const previous = JSON.parse(await readFile(resolve(values.expect), 'utf8'))
      const decided = previous.checks.find(item => item.id === 'operator_decision_persists')?.observed
      const approved = previous.checks.find(item => item.id === 'supervisor_approval_persists')?.observed
      assert(previous.passed && decided && approved, 'El recorrido previo no aprobó')
      await persistenceChecks({ review_id: decided.review_id, approval_id: approved.approval_id })
      const consulta = await consultaChecks()
      await consulta.context.close()
    } else {
      const consulta = await consultaChecks()
      const { operator, supervisor } = await decisionChecks()
      await reportChecks(supervisor, consulta)
      await accessChecks([operator, supervisor, consulta])
    }
    await check('console_clean', async () => {
      // Preexistente en efad967 (control negativo de N6): un rol sin portfolio:read que abre una página
      // de cartera recibe «Datos no disponibles» y React registra su error genérico de producción #441.
      // Solo el error genérico #441 del importador en las rutas de cartera que abrió a propósito,
      // y nunca más de una vez por visita. Cualquier otro error, de cualquier sesión, falla.
      // Cada visita del importador admite a lo sumo un #441, y solo en la ruta de esa visita.
      const known = message => {
        const match = /^importador (\S+) #(\d+): Error: Minified React error #441;/.exec(message)
        return Boolean(match && importerVisits[Number(match[2])] === match[1])
      }
      report.known_preexisting_console_errors = report.console_errors.filter(known)
      assert.deepEqual(report.console_errors.filter(message => !known(message)), [])
      const perVisit = {}
      for (const message of report.known_preexisting_console_errors) {
        const visit = /#(\d+):/.exec(message)[1]
        perVisit[visit] = (perVisit[visit] ?? 0) + 1
      }
      assert(Object.values(perVisit).every(count => count <= 1), `#441 repetido en una visita: ${JSON.stringify(perVisit)}`)
      return { errores: 0, preexistentes_importador: report.known_preexisting_console_errors.length, visitas_importador: importerVisits, por_visita: perVisit }
    })
  } finally {
    clearTimeout(timer)
    await browser.close()
  }
  report.passed = report.checks.length > 0 && report.checks.every(item => item.passed)
}

try {
  await run()
} catch (error) {
  report.error = clean(error.message)
  process.exitCode = 1
} finally {
  report.ended_at_utc = new Date().toISOString()
  if (output) await writeFile(resolve(output, 'report.json'), clean(JSON.stringify(report, null, 2)) + '\n')
  console.log(report.passed ? 'RECORRIDO APROBADO' : 'RECORRIDO CON FALLOS (ver report.json)')
}
