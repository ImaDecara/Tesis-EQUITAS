// Noche 7. Recorrido real del entorno local (scripts/local/equitas_local.py): navegador real contra la
// aplicación en marcha, el Auth y la base LOCALES. No simula respuestas. Escribe únicamente lo que escribiría
// una persona en la base local de pruebas: cargas de CSV, decisiones, una aprobación y los registros de acceso.
// Las contraseñas salen del archivo privado del entorno y nunca se imprimen ni se guardan en la evidencia.
//
// Desde front/, con el entorno en marcha y el municipio A SIN cartera (entorno recién creado):
//   node tests/smoke/n7-local-walkthrough.mjs --mode recorrido --output <carpeta nueva>
// Después de detener y volver a arrancar el entorno:
//   node tests/smoke/n7-local-walkthrough.mjs --mode persistencia --expect <carpeta del recorrido>/report.json --output <carpeta nueva>
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from '@playwright/test'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const { values } = parseArgs({ options: { 'base-url': { type: 'string', default: 'http://127.0.0.1:3100' },
  mode: { type: 'string', default: 'recorrido' }, output: { type: 'string' }, expect: { type: 'string' }, home: { type: 'string' } } })
const BASE = values['base-url']
const EXAMPLES = resolve(ROOT, 'front/public/ejemplos/carga-csv')
const LOTS = { first: '1-cartera-2026-09-30', errors: '2-cartera-2026-10-31-con-errores', second: '3-cartera-2026-10-31' }
const CASE = 'DEMO6-6-60012'        // referencia de cálculo: pagada + suspendida + vencida
const PROPOSAL_CASE = 'DEMO6-1-60013' // recibe una propuesta de intensidad 3
const DB = 'supabase_db_equitas-n7-local'
const ROUTES = ['/', '/debtors', '/priority-cases', '/pending', '/no-contact', '/people', '/debt-aging', '/risk-analysis',
  '/recommended-actions', '/import', '/reports', '/help']
const normal = text => text.replace(/\s+/g, ' ').trim()
const ars = value => normal(new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(value)))
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 10_000 }).trim()
const sql = query => JSON.parse(execFileSync('docker', ['exec', '-i', DB, 'psql', '-X', '-q', '-At', '-U', 'postgres', '-d', 'postgres',
  '-v', 'ON_ERROR_STOP=1'], { input: `select coalesce((${query}),'null')::text;`, encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'] }))
const report = { case_id: 'N7-LOCAL', mode: values.mode, passed: false, started_at_utc: new Date().toISOString(), base_url: BASE,
  environment: 'aplicación + Auth + base Supabase LOCALES (equitas-n7-local); datos sintéticos', checks: [], screenshots: [],
  console_errors: [], limits: 'Demuestra el recorrido en local. No certifica producción, una aplicación publicada ni uso municipal.' }
const secrets = []
const clean = value => {
  let text = String(value)
  for (const secret of secrets) if (secret) text = text.split(secret).join('[privado]')
  return text.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_(?:secret|publishable)_[\w-]+/g, '[clave]')
}
let browser, output, accounts, manifest
const check = async (id, action) => {
  try {
    const observed = await action()
    report.checks.push({ id, passed: true, observed: observed === undefined ? null : clean(JSON.stringify(observed)), ended_at_utc: new Date().toISOString() })
    console.log(`ok   ${id}`)
  } catch (error) {
    report.checks.push({ id, passed: false, observed: clean(error.message).slice(0, 1500), ended_at_utc: new Date().toISOString() })
    console.error(`FAIL ${id}: ${clean(error.message).slice(0, 400)}`)
    process.exitCode = 1
  }
}

async function readAccounts() {
  const home = resolve(values.home ?? process.env.EQUITAS_LOCAL_HOME ?? `${homedir()}/.equitas-n7`)
  const path = resolve(home, 'cuentas.json')
  assert.equal((await stat(path)).mode & 0o077, 0, 'El archivo de cuentas debe ser privado (0600).')
  const data = JSON.parse(await readFile(path, 'utf8'))
  for (const entry of Object.values(data)) secrets.push(entry.password)
  return data
}

async function session(key, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, locale: 'es-AR', acceptDownloads: true })
  const page = await context.newPage()
  page.on('console', message => { if (message.type() === 'error') report.console_errors.push({ account: key, url: page.url().replace(BASE, ''), text: clean(message.text()).slice(0, 300) }) })
  page.on('pageerror', error => report.console_errors.push({ account: key, url: page.url().replace(BASE, ''), text: clean(`pageerror: ${error}`).slice(0, 300) }))
  await page.goto(`${BASE}/login`)
  await page.locator('#email').fill(accounts[key].email)
  await page.locator('#password').fill(accounts[key].password)
  await page.getByRole('button', { name: /Iniciar sesi/i }).click()
  return { context, page }
}

const entered = page => page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 20_000 })
const mainText = async page => normal(await page.locator('main').innerText())
const contextLine = async page => normal(await page.locator('[data-context-line]').innerText())
async function shot(page, name) {
  const path = resolve(output, `${name}.png`)
  await page.screenshot({ path, fullPage: true })
  report.screenshots.push(`${name}.png`)
}
async function visit(page, route) {
  const response = await page.goto(BASE + route, { waitUntil: 'load' })
  await page.locator('main h1').first().waitFor({ timeout: 20_000 })
  return response.status()
}
async function openCase(page, identifier) {
  await visit(page, `/debtors?q=${identifier.slice(-5)}`)
  await page.getByRole('link', { name: identifier }).first().click()
  await page.waitForURL('**/debtors/*')
  await page.getByRole('heading', { name: identifier }).waitFor()
}
async function upload(page, lot, asOf) {
  await visit(page, '/import')
  await page.locator('#import-files').setInputFiles([`${EXAMPLES}/${lot}/cabecera.csv`, `${EXAMPLES}/${lot}/detalle.csv`])
  await page.locator('[data-recognized-files]').waitFor()
  await page.locator('#import-as-of').fill(asOf)
  await page.locator('[data-load-button]').click()
  const result = page.locator('[data-load-result]')
  await result.waitFor({ timeout: 240_000 })
  return { kind: await result.getAttribute('data-load-result'), text: normal(await result.innerText()) }
}
const dbState = () => sql(`select json_build_object(
  'cartera_a', (select b.as_of from public.import_batch b where b.tenant = 1 and b.status = 'PUBLICADO'
     and not exists(select 1 from public.import_batch s where s.supersedes = b.id) order by b.id desc limit 1),
  'publicados', (select count(*) from public.import_batch where status = 'PUBLICADO'),
  'objetos_a', (select count(*) from public.debtor where tenant = 1), 'objetos_b', (select count(*) from public.debtor where tenant = 2),
  'obligaciones', (select count(*) from public.debt), 'total_registrado', (select coalesce(sum(current_amount), 0)::text from public.debt),
  'decisiones', (select count(*) from public.case_review), 'aprobaciones', (select count(*) from public.case_review_approval),
  'auditoria', (select count(*) from public.access_audit))`)

async function accessPhase() {
  for (const key of ['sin-membresia', 'membresia-inactiva', 'rol-no-reconocido']) {
    await check(`acceso/${key}: no entra y recibe el próximo paso, sin bucle`, async () => {
      const { context, page } = await session(key)
      const alert = page.locator('form').locator('xpath=..').getByText(/Pedile a quien administra/)
      await alert.waitFor({ timeout: 20_000 })
      assert.equal(new URL(page.url()).pathname, '/login')
      await page.goto(`${BASE}/`)                       // sin sesión: vuelve al ingreso, no a una pantalla de error
      await page.waitForURL('**/login**')
      const message = normal(await page.locator('body').innerText())
      await context.close()
      return message.match(/Tu (cuenta|acceso|usuario)[^.]*\./)?.[0] ?? 'mensaje con próximo paso'
    })
  }
  await check('acceso/user-otro-municipio: entra a su municipio y no ve la cartera ajena', async () => {
    const { context, page } = await session('user-otro-municipio'); await entered(page)
    const line = await contextLine(page)
    assert.match(line, /Municipio sintético B/)
    assert.match(line, /Sin cartera cargada/)
    const text = await mainText(page)
    assert.match(text, /todavía no tiene una cartera cargada/i)
    assert.doesNotMatch(text, /DEMO6-/)
    await visit(page, '/debtors')
    assert.doesNotMatch(await mainText(page), /DEMO6-/)
    await shot(page, 'acceso-user-otro-municipio'); await context.close()
    return line
  })
}

async function emptyAndUploadPhase(admin) {
  await check('vacío/ADMIN A: municipio sin cartera con invitación a cargar', async () => {
    await admin.getByText(/todavía no tiene una cartera cargada/i).first().waitFor({ timeout: 20_000 })
    const text = await mainText(admin)
    assert.match(await contextLine(admin), /Municipio sintético A.*Sin cartera cargada.*Administrador/)
    assert.match(text, /todavía no tiene una cartera cargada/i)
    await admin.getByRole('link', { name: 'Cargar CSV' }).first().waitFor()
    await shot(admin, 'vacio-admin-a')
  })
  await check('carga/USER: no puede cargar y ve por qué', async () => {
    const { context, page } = await session('user'); await entered(page)
    await visit(page, '/import')
    const text = await mainText(page)
    assert.match(text, /Tu cuenta no puede cargar CSV/)
    assert.match(text, /rol ADMIN/)
    assert.equal(await page.locator('#import-files').count(), 0)
    await shot(page, 'carga-user-sin-permiso'); await context.close()
  })
  const expected = manifest.lotes[LOTS.first]
  await check('carga/lote válido: resumen, fecha, tablero y base', async () => {
    const result = await upload(admin, LOTS.first, expected.fecha_corte)
    assert.equal(result.kind, 'loaded', result.text)
    assert.match(result.text, new RegExp(`${expected.objetos_publicados} de ${expected.objetos_en_el_archivo}`))
    await shot(admin, 'carga-lote-valido')
    await admin.getByRole('link', { name: 'Ver el tablero' }).click()
    await admin.waitForURL(BASE + '/')
    assert.match(await contextLine(admin), /Cartera al 30\/0?9\/2026/)
    const text = await mainText(admin)
    for (const amount of [expected.total_registrado_ars, expected.deuda_pendiente_ars, expected.deuda_vencida_ars]) assert.ok(text.includes(ars(amount)), `El tablero no muestra ${ars(amount)}`)
    const db = dbState()
    assert.deepEqual([db.cartera_a, db.objetos_a, db.obligaciones, db.objetos_b], [expected.fecha_corte, expected.objetos_publicados, expected.obligaciones_publicadas, 0])
    assert.equal(Number(db.total_registrado), Number(expected.total_registrado_ars))
    await shot(admin, 'tablero-primer-corte')
    return { tablero: [expected.total_registrado_ars, expected.deuda_pendiente_ars, expected.deuda_vencida_ars].map(ars), base: db }
  })
  await check('carga/mismo lote otra vez: ya estaba y nada cambia', async () => {
    const before = dbState()
    const result = await upload(admin, LOTS.first, expected.fecha_corte)
    assert.equal(result.kind, 'already', result.text)
    const after = dbState()
    assert.deepEqual({ ...after, auditoria: 0 }, { ...before, auditoria: 0 })
    return result.text.slice(0, 80)
  })
  await check('carga/lote con errores: se rechaza con archivo, fila y columna; la cartera sigue intacta', async () => {
    const before = dbState()
    const result = await upload(admin, LOTS.errors, manifest.lotes[LOTS.errors].fecha_corte)
    assert.equal(result.kind, 'rejected', result.text)
    for (const error of manifest.lotes[LOTS.errors].errores_a_proposito) {
      const row = admin.locator('[data-findings="errores"] tbody tr', { hasText: error.columna }).filter({ hasText: String(error.linea) })
      assert.ok(await row.count(), `Falta el error de ${error.archivo} fila ${error.linea} columna ${error.columna}`)
    }
    await shot(admin, 'carga-lote-con-errores')
    const after = dbState()
    assert.deepEqual([after.cartera_a, after.objetos_a, after.obligaciones, after.publicados], [before.cartera_a, before.objetos_a, before.obligaciones, before.publicados])
    assert.match(await contextLine(admin), /Cartera al 30\/0?9\/2026/)
  })
}

async function calculationPhase(admin) {
  const expected = manifest.lotes[LOTS.first].casos.find(item => item.identificador === CASE)
  await check(`cálculo/${CASE}: ficha con los números calculados a mano`, async () => {
    await openCase(admin, CASE)
    const text = await mainText(admin)
    assert.match(text, /45 de 100/)
    assert.match(text, /20 de 50 puntos.*20 de 30 puntos.*5 de 20 puntos.*45 de 100 puntos/)
    for (const amount of [expected.total_registrado_ars, expected.deuda_pendiente_ars]) assert.ok(text.includes(ars(amount)), `Falta ${ars(amount)}`)
    assert.match(text, new RegExp(`${expected.obligaciones_vencidas} obligaciones por ${ars(expected.deuda_vencida_ars).replace(/[$.]/g, '\\$&')}`))
    assert.match(text, new RegExp(`${expected.atraso_maximo_dias} días`))
    assert.match(text, /Recordatorio/)
    await shot(admin, `ficha-${CASE}`)
    return { puntaje: 45, ...expected }
  })
  await check('cálculo/listado: el caso de referencia muestra la misma deuda pendiente y vencida', async () => {
    await visit(admin, `/debtors?q=${CASE.slice(-5)}`)
    const row = normal(await admin.locator('tbody tr', { hasText: CASE }).first().innerText())
    assert.ok(row.includes(ars(expected.deuda_pendiente_ars)) && row.includes('45'), row)
    return row
  })
}

async function fillChecklist(page, prefix) {
  await page.locator(`input[name="${prefix}-situacion_hogar"]`).last().check()
  for (const name of ['estado_juridico_verificado', 'canal_valido', 'alternativa_asistida_ofrecida']) await page.locator(`#${prefix}-${name}`).check()
}

async function decisionPhase(admin) {
  await check(`decisión/ADMIN A acepta la recomendación de ${CASE}: queda completa y visible`, async () => {
    await openCase(admin, CASE)
    await admin.getByRole('tab', { name: 'Decisión' }).click()
    await admin.locator('input[name="rv-decision"][value="ACEPTA"]').check()
    await admin.getByRole('button', { name: 'Registrar decisión' }).click()
    // El historial de la pestaña solo muestra la decisión cuando el servidor ya la guardó.
    await admin.getByRole('tabpanel').getByText(/Recomendación aceptada/).first().waitFor({ timeout: 30_000 })
    await admin.reload(); await admin.getByRole('heading', { name: CASE }).waitFor()
    const header = await mainText(admin)
    assert.match(header, /DECISIÓN REGISTRADA.*Recomendación aceptada/i)
    assert.match(header, /por vos/)
    await shot(admin, 'decision-encabezado')
    await visit(admin, `/debtors?q=${CASE.slice(-5)}`)
    const row = normal(await admin.locator('tbody tr', { hasText: CASE }).first().innerText())
    assert.match(row, /Decisión registrada/)
    return row
  })
  await check(`decisión/ADMIN A propone intensidad 3 sobre ${PROPOSAL_CASE}: queda como propuesta y no puede aprobarla`, async () => {
    await openCase(admin, PROPOSAL_CASE)
    await admin.getByRole('tab', { name: 'Decisión' }).click()
    await admin.locator('input[name="rv-decision"][value="MODIFICA"]').check()
    await admin.locator('#rv-action').selectOption('INTIMACION_ADMINISTRATIVA:3')
    await admin.locator('#rv-reason').selectOption('CRITERIO_DEL_SERVICIO')
    await fillChecklist(admin, 'rv')
    await admin.getByRole('button', { name: 'Registrar propuesta' }).click()
    await admin.getByRole('tabpanel').getByText(/pendiente de aprobación/i).first().waitFor({ timeout: 30_000 })
    await admin.reload(); await admin.getByRole('heading', { name: PROPOSAL_CASE }).waitFor()
    await admin.getByRole('tab', { name: 'Decisión' }).click()
    const text = await mainText(admin)
    assert.match(text, /la registraste vos/i)
    assert.match(text, /otra persona con rol ADMIN/)
    assert.equal(await admin.getByRole('button', { name: /Aprobar/ }).count(), 0, 'Quien propone no debe ver el botón de aprobar')
    await visit(admin, '/pending')
    const pending = await mainText(admin)
    assert.match(pending, /en espera/i)
    assert.match(pending, new RegExp(PROPOSAL_CASE))
    await shot(admin, 'pendientes-admin-a')
  })
  await check('aprobación/ADMIN B encuentra la propuesta en Pendientes y la aprueba', async () => {
    const { context, page } = await session('admin-b'); await entered(page)
    await page.getByRole('link', { name: 'Pendientes' }).first().click()
    await page.waitForURL('**/pending')
    const section = page.locator('[data-pending-section="APPROVE"]')
    await section.waitFor({ timeout: 20_000 })
    await shot(page, 'pendientes-admin-b')
    await section.getByRole('link', { name: PROPOSAL_CASE }).click()
    await page.waitForURL('**/debtors/*')
    await page.locator('input[name="ap-decision"][value="APRUEBA"]').check()
    await fillChecklist(page, 'ap')
    await page.getByRole('button', { name: /Registrar|Enviar|Aprobar/ }).last().click()
    await page.getByText(/Propuesta aprobada/).first().waitFor({ timeout: 30_000 })
    await page.reload(); await page.getByRole('heading', { name: PROPOSAL_CASE }).waitFor()
    assert.match(await mainText(page), /Propuesta aprobada/)
    await shot(page, 'aprobacion-admin-b')
    const db = dbState(); await context.close()
    assert.equal(db.aprobaciones, 1)
    return { decisiones: db.decisiones, aprobaciones: db.aprobaciones }
  })
  await check('decisión/USER ve el estado y no tiene formularios', async () => {
    const { context, page } = await session('user'); await entered(page)
    await openCase(page, PROPOSAL_CASE)
    assert.match(await mainText(page), /Propuesta aprobada/)
    await page.getByRole('tab', { name: 'Decisión' }).click()
    assert.match(await mainText(page), /requiere una cuenta ADMIN/)
    assert.equal(await page.locator('main form').count(), 0)
    await visit(page, '/pending')
    assert.match(await mainText(page), /no tiene tareas pendientes/i)
    await shot(page, 'decision-user'); await context.close()
  })
}

async function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) { if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1 } else if (char === '"') quoted = false; else cell += char }
    else if (char === '"') quoted = true
    else if (char === ',') { row.push(cell); cell = '' }
    else if (char === '\n' || char === '\r') { if (char === '\r' && text[i + 1] === '\n') i += 1; row.push(cell); cell = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = [] }
    else cell += char
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  const [header, ...body] = rows
  return body.map(values => Object.fromEntries(header.map((name, index) => [name.replace(/^﻿/, ''), values[index]])))
}

async function reportsPhase(admin) {
  const expected = manifest.lotes[LOTS.first]
  const download = async (page, id) => {
    const response = await page.request.get(`${BASE}/api/reports/${id}`)
    return { status: response.status(), rows: response.ok() ? await parseCsv(await response.text()) : [] }
  }
  await check('reportes/ADMIN: la pantalla ofrece los cinco y el de cola coincide con el tablero', async () => {
    await visit(admin, '/reports')
    for (const id of ['queue', 'data-quality', 'decisions', 'supervision', 'access']) assert.ok(await admin.locator(`a[href^="/api/reports/${id}"]`).count(), `Falta el enlace del reporte ${id}`)
    await shot(admin, 'reportes-admin')
    const queue = await download(admin, 'queue')
    assert.equal(queue.status, 200)
    assert.equal(queue.rows.length, expected.objetos_publicados, 'El reporte de cola debe tener un caso por objeto del tablero')
    const row = queue.rows.find(item => Object.values(item).includes(CASE))
    assert.ok(row, `El reporte de cola no trae ${CASE}`)
    const numbers = Object.values(row).map(Number)
    for (const amount of [141350, 93350, 263, 45]) assert.ok(numbers.includes(amount), `La fila de ${CASE} no trae ${amount}: ${JSON.stringify(row)}`)
    const decisions = await download(admin, 'decisions')
    assert.ok(decisions.rows.some(item => Object.values(item).includes(CASE)), 'El reporte de decisiones debe identificar el caso')
    for (const id of ['data-quality', 'supervision', 'access']) assert.equal((await download(admin, id)).status, 200, id)
    return { cola: queue.rows.length, decisiones: decisions.rows.length }
  })
  await check('reportes/USER: tres disponibles; supervisión y accesos explicados y rechazados', async () => {
    const { context, page } = await session('user'); await entered(page)
    await visit(page, '/reports')
    const text = await mainText(page)
    assert.match(text, /requiere una cuenta ADMIN/i)
    const statuses = {}
    for (const id of ['queue', 'data-quality', 'decisions', 'supervision', 'access']) statuses[id] = (await download(page, id)).status
    assert.deepEqual(statuses, { queue: 200, 'data-quality': 200, decisions: 200, supervision: 403, access: 403 })
    await shot(page, 'reportes-user'); await context.close()
    return statuses
  })
}

async function secondCutoffPhase(admin) {
  const expected = manifest.lotes[LOTS.second]
  await check('segundo corte: actualiza tablero y fecha; la decisión anterior figura sobre datos anteriores', async () => {
    const result = await upload(admin, LOTS.second, expected.fecha_corte)
    assert.equal(result.kind, 'loaded', result.text)
    await visit(admin, '/')
    assert.match(await contextLine(admin), /Cartera al 31\/10\/2026/)
    const text = await mainText(admin)
    for (const amount of [expected.total_registrado_ars, expected.deuda_pendiente_ars, expected.deuda_vencida_ars]) assert.ok(text.includes(ars(amount)), `El tablero no muestra ${ars(amount)}`)
    await shot(admin, 'tablero-segundo-corte')
    await openCase(admin, CASE)
    assert.match(await mainText(admin), /Registrada sobre datos anteriores/)
    await shot(admin, 'decision-sobre-datos-anteriores')
    await visit(admin, `/debtors?q=${CASE.slice(-5)}`)
    assert.match(normal(await admin.locator('tbody tr', { hasText: CASE }).first().innerText()), /datos anteriores/i)
    await visit(admin, '/pending')
    assert.match(await mainText(admin), /datos anteriores/i)
    const db = dbState()
    assert.deepEqual([db.cartera_a, db.objetos_a, db.obligaciones], [expected.fecha_corte, expected.objetos_publicados, expected.obligaciones_publicadas])
    return db
  })
}

async function screensPhase(admin) {
  await check('pantallas/1440: todas las entradas del menú responden, sin desborde horizontal', async () => {
    const seen = {}
    for (const route of ROUTES) {
      seen[route] = await visit(admin, route)
      assert.equal(seen[route], 200, route)
      assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Desborde horizontal en ${route}`)
    }
    await visit(admin, '/help'); await shot(admin, 'ayuda')
    return seen
  })
  await check('pantallas/390: utilizables en ventana angosta, sin desborde horizontal de la página', async () => {
    const { context, page } = await session('admin-a', { width: 390, height: 844 }); await entered(page)
    for (const route of ROUTES) {
      await visit(page, route)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Desborde horizontal en ${route}`)
    }
    await openCase(page, CASE)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Desborde horizontal en la ficha')
    await shot(page, 'ficha-390'); await visit(page, '/debtors'); await shot(page, 'casos-390'); await context.close()
  })
  await check('salida: cerrar sesión vuelve al ingreso y la sesión deja de valer', async () => {
    await visit(admin, '/')
    await admin.getByRole('button', { name: /Cerrar sesi/ }).first().click()
    await admin.waitForURL('**/login**')
    await admin.goto(`${BASE}/debtors`)
    await admin.waitForURL('**/login**')
  })
}

async function main() {
  assert.ok(values.output, 'Falta --output <carpeta nueva>')
  output = resolve(values.output)
  await mkdir(output, { recursive: false })
  accounts = await readAccounts()
  manifest = JSON.parse(await readFile(resolve(EXAMPLES, 'manifiesto.json'), 'utf8'))
  report.sha = git('rev-parse', 'HEAD')
  report.app_build = await (await fetch(`${BASE}/api/build-info`)).json()
  browser = await chromium.launch()
  try {
    if (values.mode === 'recorrido') {
      const initial = dbState()
      assert.equal(initial.objetos_a, 0, 'El recorrido parte de un municipio SIN cartera: usá un entorno recién creado.')
      await accessPhase()
      const { context, page: admin } = await session('admin-a'); await entered(admin)
      await emptyAndUploadPhase(admin)
      await calculationPhase(admin)
      await decisionPhase(admin)
      await reportsPhase(admin)
      await secondCutoffPhase(admin)
      await screensPhase(admin)
      await context.close()
      report.final_state = dbState()
    } else {
      const previous = JSON.parse(await readFile(resolve(values.expect), 'utf8'))
      await check('persistencia: la base conserva cartera, decisiones y aprobación tras reiniciar', async () => {
        const now = dbState()
        for (const key of ['cartera_a', 'publicados', 'objetos_a', 'obligaciones', 'total_registrado', 'decisiones', 'aprobaciones']) assert.deepEqual(now[key], previous.final_state[key], key)
        return now
      })
      await check('persistencia: la decisión y la aprobación siguen a la vista', async () => {
        const { context, page } = await session('admin-a'); await entered(page)
        assert.match(await contextLine(page), /Cartera al 31\/10\/2026/)
        await openCase(page, PROPOSAL_CASE)
        assert.match(await mainText(page), /Propuesta aprobada/)
        await openCase(page, CASE)
        assert.match(await mainText(page), /Recomendación aceptada/)
        await shot(page, 'persistencia-decision'); await context.close()
      })
    }
  } finally {
    await browser.close()
  }
  // Los 404 de recursos opcionales no cuentan; cualquier otro error de consola sí.
  const errors = report.console_errors.filter(item => !/favicon/.test(item.text))
  if (errors.length) { process.exitCode = 1; console.error(`FAIL consola: ${errors.length} errores`) }
  report.console_errors = errors
  report.passed = !process.exitCode && report.checks.every(item => item.passed)
  report.ended_at_utc = new Date().toISOString()
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`${report.passed ? 'RECORRIDO OK' : 'RECORRIDO CON FALLAS'}: ${report.checks.filter(item => item.passed).length}/${report.checks.length} (${output})`)
}

main().catch(error => { console.error(clean(error.stack ?? error)); process.exitCode = 1 })
