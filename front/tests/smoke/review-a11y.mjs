// ALIGN-021. Recorrido de revisión solo con teclado, contra `next start` y la base local.
// Uso: EQUITAS_REVIEW_LOCAL_CONFIG=/tmp/...json node tests/smoke/review-a11y.mjs --base-url http://127.0.0.1:31021 --output <dir-nuevo>
// Exige base recién sembrada: tests/local-review/README.md, paso 2. Registra lotes con la función real.
// Solo datos sintéticos y solo el stack local. Sin .click(), .fill() ni .focus() en el recorrido.
import { chromium, expect as baseExpect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: {
  'base-url': { type: 'string' },
  output: { type: 'string' },
  // Con la cuenta `importador` en su rol aprobado, no en el `tp_operator` que le da fixture.sql.
  'solo-importador': { type: 'boolean', default: false },
} })
const expect = baseExpect.configure({ timeout: 20_000 })
const WIDTHS = [360, 768, 1440]
const TENANT = 920001
const SYSTEM_USER = 920009
const CUTOFFS = { first: '2026-10-30', second: '2026-10-31' }
const CASE = {
  intense: { id: 920012, identifier: 'TP-A020-2' },
  accept: { id: 920011, identifier: 'TP-A020-1' },
  reject: { id: 920013, identifier: 'TP-A020-3' },
  tabs: { id: 920014, identifier: 'TP-A020-4' },
  midLoad: { id: 920016, identifier: 'TP-A020-6' },
  focus: { id: 920021, identifier: 'TP-A020-10' },
  objected: { id: 920017, identifier: 'TP-A020-7' },
  outdated: { id: 920018, identifier: 'TP-A020-8' },
}
const REASON_DETAIL = 'Detalle sintetico del motivo de revision'
const INTENSE_ACTION = 'Intimación administrativa formal'

const report = { case_id: 'ALIGN-021-review-a11y', passed: false, started_at_utc: new Date().toISOString(), checks: [], errors: [], screenshots: [], console_errors: [] }
const privateValues = []
const clean = value => {
  let text = String(value)
  for (const secret of privateValues) if (secret) text = text.split(secret).join('[privado]')
  return text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]').replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, '[clave]')
}
const pass = (id, observed) => {
  report.checks.push({ id, passed: true, observed })
  console.log(`ok ${id}`)
}

async function readConfig() {
  const path = process.env.EQUITAS_REVIEW_LOCAL_CONFIG
  if (!path) throw Error('Falta EQUITAS_REVIEW_LOCAL_CONFIG; el recorrido no se omite.')
  const real = await realpath(path)
  if (!real.startsWith('/tmp/') && !real.startsWith('/private/tmp/')) throw Error('La configuración privada debe vivir en /tmp.')
  if ((await stat(real)).mode & 0o077) throw Error('La configuración privada debe tener modo 0600.')
  const config = JSON.parse(await readFile(real, 'utf8'))
  if (config.supabaseUrl !== 'http://127.0.0.1:54321') throw Error('Solo se admite el stack local.')
  privateValues.push(config.publishableKey, config.reviewJwt, config.importJwt, config.jwtSecret, ...Object.values(config.accounts).map(account => account.password))
  return config
}

// Evento de lote por la función real de importación, con la credencial de máquina.
async function registerBatch(config, status, asOf, supersedes = null) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/record_import_batch`, {
    method: 'POST',
    headers: { apikey: config.publishableKey, Authorization: `Bearer ${config.importJwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_actor_user: SYSTEM_USER, p_tenant: TENANT, p_source: 'ETL_CLI', p_file_hashes: { cabecera: 'c'.repeat(64) }, p_as_of: asOf, p_rules_version: '1.0.0',
      p_status: status, p_idempotency_key: randomUUID(), p_counts: { filas: 1 }, p_source_updated_at: '2026-10-29', p_supersedes: supersedes,
    }),
  })
  if (response.status !== 200) throw Error(`Lote ${status}: HTTP ${response.status}`)
  return (await response.json()).batch_id
}

// El control con foco se tiene que ver: nada fijo por encima, ni fuera de la ventana.
const focusObscured = page => page.evaluate(() => {
  const element = document.activeElement
  if (!element || element === document.body) return null
  const box = element.getBoundingClientRect()
  const x = box.left + box.width / 2
  const y = box.top + box.height / 2
  if (y < 0 || y > window.innerHeight || x < 0 || x > window.innerWidth) return `fuera: ${element.tagName}#${element.id}`
  const top = document.elementFromPoint(x, y)
  return top && (top === element || element.contains(top) || top.contains(element)) ? null : `tapado: ${element.tagName}#${element.id} por ${top?.tagName}`
})

async function tabTo(page, locator, key = 'Tab', max = 150) {
  await locator.waitFor({ state: 'visible' })
  for (let presses = 0; presses < max; presses += 1) {
    if (await locator.evaluate(element => element === document.activeElement)) return presses
    await page.keyboard.press(key)
    const obscured = await focusObscured(page)
    if (obscured) throw Error(`Foco no visible, ancho ${page.viewportSize().width}: ${obscured}`)
  }
  throw Error('El control no se alcanza con Tab.')
}

// Con la lista cerrada: escribir el inicio del rótulo, como hace una persona con teclado.
async function chooseOption(page, select, label) {
  await tabTo(page, select)
  const value = await select.evaluate((element, wanted) => [...element.options].find(option => option.label.startsWith(wanted))?.value, label)
  if (!value) throw Error(`Sin opción: ${label}`)
  await page.keyboard.type(label.slice(0, 8), { delay: 40 })
  await expect(select).toHaveValue(value)
}

async function chooseRadio(page, first, target, moves) {
  await tabTo(page, first)
  if (moves === 0) await page.keyboard.press('Space')
  for (let move = 0; move < moves; move += 1) await page.keyboard.press('ArrowDown')
  await expect(target).toBeChecked()
}

async function pressCheckbox(page, box) {
  await tabTo(page, box)
  await page.keyboard.press('Space')
  await expect(box).toBeChecked()
}

const actionPosts = page => {
  const posts = []
  page.on('request', request => { if (request.method() === 'POST' && request.headers()['next-action']) posts.push(request.url()) })
  return posts
}

async function newSession(browser, base, config, label, landing = 'Casos prioritarios') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'es-AR' })
  context.setDefaultTimeout(20_000)
  const page = await context.newPage()
  page.on('pageerror', error => report.console_errors.push(clean(error.message)))
  page.on('console', message => { if (message.type() === 'error') report.console_errors.push(clean(message.text())) })
  await page.goto(`${base}/login?next=/priority-cases`)
  const email = page.getByLabel('Email', { exact: true })
  await tabTo(page, email)
  await page.keyboard.type(config.accounts[label].email)
  await page.keyboard.press('Tab')
  await page.keyboard.type(config.accounts[label].password)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: landing, exact: true })).toBeVisible({ timeout: 45_000 })
  return { context, page, posts: actionPosts(page) }
}

const reviewUrl = (base, debtor) => `${base}/debtors/${debtor.id}?tab=revision`
const panelOf = page => page.getByRole('tabpanel', { name: 'Revisión' })

async function assertNames(scope, what) {
  const controls = scope.locator('input:not([type=hidden]), select, textarea, button, a[href]')
  const total = await controls.count()
  if (total === 0) throw Error(`Sin controles: ${what}`)
  for (let index = 0; index < total; index += 1) await expect(controls.nth(index)).toHaveAccessibleName(/\S/)
  return total
}

// Cajas visibles que se pisan, en el formulario y en las pestañas. Lo que contiene a otro no cuenta.
function overlapsIn(root) {
  const scope = document.querySelector(root)
  const tablist = document.querySelector('[role="tablist"]')
  const selector = 'input:not([type=hidden]), select, textarea, button, label, legend, a[href], h2, h3, dt, dd, [role="alert"], [role="status"], p'
  const elements = [...scope.querySelectorAll(selector), ...(tablist ? tablist.querySelectorAll('[role="tab"]') : [])]
    .filter(element => !element.closest('table') && !element.closest('.sr-only'))
    .map(element => ({ element, box: element.getBoundingClientRect() }))
    .filter(({ box }) => box.width > 0 && box.height > 0)
  const name = element => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}`
  const found = []
  for (let left = 0; left < elements.length; left += 1) {
    for (let right = left + 1; right < elements.length; right += 1) {
      const a = elements[left]
      const b = elements[right]
      if (a.element.contains(b.element) || b.element.contains(a.element)) continue
      const width = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left)
      const height = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top)
      if (width > 1 && height > 1) found.push(`${name(a.element)} / ${name(b.element)}`)
    }
  }
  const outside = elements.filter(({ box }) => box.left < -1 || box.right > window.innerWidth + 1).map(({ element }) => name(element))
  // Tampoco se sale de su formulario, aunque entre en la ventana.
  for (const { element, box } of elements) {
    const form = element.closest('form')?.getBoundingClientRect()
    if (form && (box.left < form.left - 1 || box.right > form.right + 1)) outside.push(`${name(element)} fuera de su formulario`)
  }
  return { checked: elements.length, overlaps: found, outside, pageWidth: document.documentElement.scrollWidth, viewport: window.innerWidth }
}

async function assertLayout(page, output, root, name) {
  const measured = []
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(150)
    const layout = await page.evaluate(overlapsIn, root)
    if (layout.overlaps.length || layout.outside.length || layout.pageWidth > layout.viewport) {
      throw Error(`${name} a ${width}: ${JSON.stringify(layout).slice(0, 800)}`)
    }
    const file = `${name}-${width}.png`
    // Arriba de todo: la barra superior es fija y, si no, la captura completa la deja en el medio.
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: resolve(output, file), fullPage: true })
    report.screenshots.push(file)
    measured.push({ width, elements: layout.checked })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  return measured
}

async function assertBefore(page, titles) {
  const positions = []
  for (const title of titles) positions.push((await page.getByRole('heading', { name: title, exact: true }).boundingBox()).y)
  if (positions.some((position, index) => index > 0 && position <= positions[index - 1])) throw Error(`Orden incorrecto: ${titles.join(', ')}`)
}

function actionId(manifest, name) {
  const id = Object.keys(manifest.node).find(item => manifest.node[item].exportedName === name)
  if (!id) throw Error(`Sin acción ${name}: la pantalla no la compiló`)
  return id
}

// La pantalla no ofrece el formulario, y la acción lo rechaza igual: POST directo con esa sesión.
async function assertActionRejected(session, base, debtor, recordId, approveId) {
  const call = async (id, input) => {
    const response = await session.context.request.post(`${base}/debtors/${debtor.id}`, {
      headers: { 'Next-Action': id, Accept: 'text/x-component', 'Content-Type': 'text/plain;charset=UTF-8', Origin: base },
      data: JSON.stringify([input]),
    })
    const row = (await response.text()).split('\n').find(line => line.startsWith('1:{'))
    return row ? JSON.parse(row.slice(2)) : null
  }
  const recorded = await call(recordId, {
    debtorId: String(debtor.id), decision: 'ACEPTA', expected: { asOf: CUTOFFS.first, rulesVersion: '1.0.0', inputsHash: 'a'.repeat(64) },
    supersedes: null, decidedIntervention: null, decidedIntensity: null, reasonCode: null, reasonText: null, checklist: {},
  })
  const approved = await call(approveId, { caseReviewId: '1', decision: 'OBJETA', reasonCode: 'X', checklist: {}, supersedes: null })
  if (recorded?.code !== 'ROLE_FORBIDDEN' || approved?.code !== 'ROLE_FORBIDDEN') throw Error(`Acción no rechazada: ${recorded?.code} / ${approved?.code}`)
}

async function proposeIntense(page, base, debtor) {
  await page.goto(reviewUrl(base, debtor))
  const panel = panelOf(page)
  await chooseRadio(page, panel.getByRole('radio', { name: 'Aceptar la sugerencia' }), panel.getByRole('radio', { name: 'Modificar la acción' }), 1)
  await chooseOption(page, panel.getByLabel('Acción propuesta', { exact: true }), INTENSE_ACTION)
  await chooseOption(page, panel.getByLabel('Motivo', { exact: true }), 'Datos')
  await chooseRadio(page, panel.getByRole('radio', { name: 'Consultada' }), panel.getByRole('radio', { name: 'No disponible' }), 1)
  for (const name of ['Estado jurídico', 'Canal válido', 'Alternativa asistida']) await pressCheckbox(page, panel.getByRole('checkbox', { name: new RegExp(name) }))
  await tabTo(page, panel.getByRole('button', { name: 'Registrar propuesta' }))
  await page.keyboard.press('Enter')
  await expect(panel.locator('#rv-notice')).toContainText('Requiere aprobación de un supervisor.')
}

let browser

async function run() {
  const base = new URL(values['base-url'] ?? '').origin
  if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Solo se admite un destino local.')
  if (!values.output) throw Error('Falta --output con un directorio nuevo.')
  const output = resolve(values.output)
  await mkdir(output, { recursive: false })
  report.base_url = base
  const config = await readConfig()
  const manifest = JSON.parse(await readFile('.next/server/server-reference-manifest.json', 'utf8'))
  const recordId = actionId(manifest, 'recordCaseDecision')
  const approveId = actionId(manifest, 'approveCaseDecision')

  const validated = await registerBatch(config, 'VALIDADO', CUTOFFS.first)
  await registerBatch(config, 'PUBLICADO', CUTOFFS.first, validated)
  pass('lote_validado_y_publicado', { as_of: CUTOFFS.first, eventos: 2 })

  browser = await chromium.launch()
  if (values['solo-importador']) {
    const importador = await newSession(browser, base, config, 'importador', 'Datos no disponibles')
    await importador.page.goto(reviewUrl(base, CASE.intense))
    await expect(importador.page.getByRole('heading', { name: 'Datos no disponibles', exact: true })).toBeVisible()
    await expect(importador.page.locator('form')).toHaveCount(0)
    await assertActionRejected(importador, base, CASE.intense, recordId, approveId)
    pass('importador_sin_ficha_y_accion_rechazada', 'La ficha no abre: el rol no lee cartera. La acción devuelve ROLE_FORBIDDEN.')
    report.console_errors.length = 0
    report.passed = true
    return
  }
  const operador = await newSession(browser, base, config, 'operador')
  const { page } = operador
  pass('login_con_teclado', 'Correo, contraseña y Enter.')

  // Colas: filtro y cola con teclado, sin perder el filtro.
  const queues = page.getByRole('navigation', { name: 'Colas por intervención' })
  await expect(queues.getByRole('link')).toHaveCount(5)
  await assertNames(page.locator('main'), 'colas')
  await tabTo(page, page.getByLabel('Buscar por objeto o persona'))
  await page.keyboard.type(CASE.intense.identifier)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`q=${CASE.intense.identifier}`))
  const open = page.getByRole('link', { name: `Abrir revisión ${CASE.intense.identifier}` })
  await expect(open).toBeVisible()
  const otherQueue = queues.getByRole('link', { name: /Seguimiento/ })
  await tabTo(page, otherQueue)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/queue=SEGUIMIENTO/)
  await expect(page).toHaveURL(new RegExp(`q=${CASE.intense.identifier}`))
  await expect(page.getByLabel('Buscar por objeto o persona')).toHaveValue(CASE.intense.identifier)
  await expect(page.getByText('No hay casos que coincidan con los filtros.')).toBeVisible()
  await page.goBack()
  await expect(open).toBeVisible()
  const queueLayout = await assertLayout(page, output, 'main', 'colas')
  pass('colas_con_teclado_conservan_filtro', { anchos: queueLayout })

  await tabTo(page, open)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/debtors/${CASE.intense.id}\\?tab=revision`))
  const panel = panelOf(page)
  await expect(page.getByRole('tab', { name: 'Revisión' })).toHaveAttribute('aria-selected', 'true')
  await expect(panel.getByText('Vulnerabilidad: no informada')).toBeVisible()
  await expect(panel.getByText('Corte: 30/10/2026').first()).toBeVisible()
  await assertBefore(page, ['Hechos del caso', 'Sugerencia del sistema', 'Tu decisión', 'Historial de decisiones'])
  pass('hechos_antes_que_la_sugerencia', 'Hechos, sugerencia, decisión e historial, por posición en pantalla.')

  const initialNames = await assertNames(panel, 'pestaña')
  await expect(panel.getByRole('radiogroup', { name: 'Decisión' })).toBeVisible()
  await assertLayout(page, output, '[role="tabpanel"]', 'revision-vacia')
  pass('revision_vacia_sin_superposiciones', { controles_con_nombre: initialNames })

  // A 360 px la barra superior es fija. Saltar desde el resumen o volver con Shift+Tab no deja el foco debajo.
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto(reviewUrl(base, CASE.focus))
  const narrow = panelOf(page)
  await chooseRadio(page, narrow.getByRole('radio', { name: 'Aceptar la sugerencia' }), narrow.getByRole('radio', { name: 'Rechazar la sugerencia' }), 2)
  await tabTo(page, narrow.getByRole('button', { name: 'Registrar decisión' }))
  await page.keyboard.press('Enter')
  await expect(narrow.locator('#rv-summary')).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(narrow.locator('#rv-summary a').first()).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(narrow.getByLabel('Motivo', { exact: true })).toBeFocused()
  await expect.poll(() => focusObscured(page)).toBeNull()
  await tabTo(page, narrow.getByRole('radio', { name: 'Rechazar la sugerencia' }), 'Shift+Tab')
  if (operador.posts.length !== 0) throw Error('Salió una acción sin motivo.')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(reviewUrl(base, CASE.intense))
  pass('foco_visible_bajo_la_barra_fija_a_360', 'Tras el enlace del resumen y con Shift+Tab, el control con foco queda a la vista.')

  // ≥3 sin lista de control: no sale del navegador.
  await chooseRadio(page, panel.getByRole('radio', { name: 'Aceptar la sugerencia' }), panel.getByRole('radio', { name: 'Modificar la acción' }), 1)
  await chooseOption(page, panel.getByLabel('Acción propuesta', { exact: true }), INTENSE_ACTION)
  const submitIntense = panel.getByRole('button', { name: 'Registrar propuesta' })
  await tabTo(page, submitIntense)
  await page.keyboard.press('Enter')
  const reason = panel.getByLabel('Motivo', { exact: true })
  await expect(panel.locator('#rv-summary')).toBeVisible()
  await expect(reason).toHaveAttribute('aria-invalid', 'true')
  await expect(reason).toHaveAccessibleDescription(/Indica un motivo/)
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('rv-feedback')
  const judicial = panel.getByRole('checkbox', { name: /Estado jurídico/ })
  await expect(judicial).toHaveAttribute('aria-invalid', 'true')
  await expect(judicial).toHaveAccessibleDescription(/Falta confirmar/)
  await expect(panel.getByRole('radiogroup', { name: 'Situación del hogar' })).toHaveAttribute('aria-invalid', 'true')
  if (operador.posts.length !== 0) throw Error('Salió una acción sin lista de control.')
  pass('no_envia_intensidad_3_sin_lista', { acciones_enviadas: 0, foco: 'rv-feedback' })

  const expandedNames = await assertNames(panel, 'formulario completo')
  await assertLayout(page, output, '[role="tabpanel"]', 'revision-con-errores')
  pass('errores_asociados_y_sin_superposiciones', { controles_con_nombre: expandedNames })

  // El primer enlace del resumen lleva al campo. Motivo con lista cerrada y detalle.
  await page.keyboard.press('Tab')
  await expect(panel.locator('#rv-summary a').first()).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(reason).toBeFocused()
  await chooseOption(page, reason, 'Datos')
  await expect(reason).not.toHaveAttribute('aria-invalid', 'true')
  await page.keyboard.press('Tab')
  await page.keyboard.type(REASON_DETAIL)
  await expect(panel.getByText(`${[...REASON_DETAIL].length} de 500 caracteres, contando los espacios.`)).toBeVisible()

  // Una sola casilla sin marcar sigue bloqueando.
  await chooseRadio(page, panel.getByRole('radio', { name: 'Consultada' }), panel.getByRole('radio', { name: 'No disponible' }), 1)
  await pressCheckbox(page, judicial)
  await pressCheckbox(page, panel.getByRole('checkbox', { name: /Canal válido/ }))
  await tabTo(page, submitIntense)
  await page.keyboard.press('Enter')
  await expect(panel.locator('#rv-summary')).toContainText('Falta confirmar')
  if (operador.posts.length !== 0) throw Error('Salió una acción con la lista incompleta.')
  pass('una_casilla_sin_marcar_sigue_bloqueando', { acciones_enviadas: 0 })

  await pressCheckbox(page, panel.getByRole('checkbox', { name: /Alternativa asistida/ }))
  await tabTo(page, submitIntense)
  await page.keyboard.press('Enter')
  await expect(panel.locator('#rv-notice')).toContainText('Requiere aprobación de un supervisor.')
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('rv-feedback')
  await expect(panel.getByText('Vigente', { exact: true })).toBeVisible()
  await expect(panel.getByRole('listitem').filter({ hasText: 'Modificar la acción' }).first()).toContainText('Requiere aprobación de un supervisor')
  if (operador.posts.length !== 1) throw Error(`Se esperaba una acción: ${operador.posts.length}`)
  await page.reload()
  await expect(panelOf(page).getByText('Requiere aprobación de un supervisor').first()).toBeVisible()
  await expect(panelOf(page).getByText(REASON_DETAIL)).toBeVisible()
  pass('propuesta_registrada_y_persiste', 'Queda como pendiente de supervisor, con su detalle, tras recargar.')

  // Aceptar a 360 px, también con teclado, con la barra superior fija. El foco no queda debajo.
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto(reviewUrl(base, CASE.accept))
  await chooseRadio(page, panelOf(page).getByRole('radio', { name: 'Aceptar la sugerencia' }), panelOf(page).getByRole('radio', { name: 'Aceptar la sugerencia' }), 0)
  await tabTo(page, panelOf(page).getByRole('button', { name: 'Registrar decisión' }))
  await page.keyboard.press('Enter')
  await expect(panelOf(page).locator('#rv-notice')).toContainText('Decisión registrada.')
  await page.setViewportSize({ width: 1440, height: 1000 })
  pass('aceptar_con_teclado_a_360', 'Sin motivo, sin lista. En cada Tab, el control con foco queda a la vista.')

  // Rechazar exige motivo; el detalle es opcional. El error se corrige sin perder nada.
  await page.goto(reviewUrl(base, CASE.reject))
  const rejectPanel = panelOf(page)
  await chooseRadio(page, rejectPanel.getByRole('radio', { name: 'Aceptar la sugerencia' }), rejectPanel.getByRole('radio', { name: 'Rechazar la sugerencia' }), 2)
  const postsBefore = operador.posts.length
  await tabTo(page, rejectPanel.getByRole('button', { name: 'Registrar decisión' }))
  await page.keyboard.press('Enter')
  await expect(rejectPanel.getByLabel('Motivo', { exact: true })).toHaveAccessibleDescription(/Indica un motivo/)
  if (operador.posts.length !== postsBefore) throw Error('Salió una acción sin motivo.')
  await chooseOption(page, rejectPanel.getByLabel('Motivo', { exact: true }), 'Ya')
  await tabTo(page, rejectPanel.getByRole('button', { name: 'Registrar decisión' }))
  await page.keyboard.press('Enter')
  await expect(rejectPanel.locator('#rv-notice')).toContainText('Decisión registrada.')
  await expect(rejectPanel.getByText('Ya hay una gestión en curso')).toBeVisible()
  pass('rechazar_exige_motivo', 'Sin motivo no sale; con motivo queda en el historial.')

  // Pestañas con flechas.
  await page.goto(`${base}/debtors/${CASE.tabs.id}`)
  await tabTo(page, page.getByRole('tab', { name: 'Resumen' }))
  await page.keyboard.press('End')
  await expect(page.getByRole('tab', { name: 'Revisión' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: 'Revisión' })).toBeFocused()
  await expect(panelOf(page).getByRole('heading', { name: 'Hechos del caso' })).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Resumen' })).toBeFocused()
  pass('pestanas_con_flechas', 'Fin y flecha, con el foco en la pestaña activa.')

  // Mirar otra pestaña no borra lo que se estaba escribiendo.
  await page.keyboard.press('End')
  const kept = panelOf(page)
  await chooseRadio(page, kept.getByRole('radio', { name: 'Aceptar la sugerencia' }), kept.getByRole('radio', { name: 'Rechazar la sugerencia' }), 2)
  await tabTo(page, kept.getByLabel('Detalle del motivo (opcional)'))
  await page.keyboard.type(REASON_DETAIL)
  await tabTo(page, page.getByRole('tab', { name: 'Revisión' }), 'Shift+Tab')
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('tab', { name: 'Recomendacion' })).toHaveAttribute('aria-selected', 'true')
  await expect(kept).toHaveCount(0)
  await page.keyboard.press('ArrowRight')
  await expect(kept.getByRole('radio', { name: 'Rechazar la sugerencia' })).toBeChecked()
  await expect(kept.getByLabel('Detalle del motivo (opcional)')).toHaveValue(REASON_DETAIL)
  pass('otra_pestana_conserva_lo_escrito', 'Decisión y detalle siguen ahí al volver.')

  // Supervisor: responde con teclado; aprobar sin lista no sale.
  const supervisor = await newSession(browser, base, config, 'supervisor')
  await supervisor.page.goto(reviewUrl(base, CASE.intense))
  const supervision = panelOf(supervisor.page)
  await expect(supervision.getByRole('heading', { name: 'Tu decisión' })).toHaveCount(0)
  await expect(supervision.getByText(REASON_DETAIL)).toBeVisible()
  await chooseRadio(supervisor.page, supervision.getByRole('radio', { name: 'Aprobar la propuesta' }), supervision.getByRole('radio', { name: 'Aprobar la propuesta' }), 0)
  await tabTo(supervisor.page, supervision.getByRole('button', { name: 'Registrar respuesta' }))
  await supervisor.page.keyboard.press('Enter')
  await expect(supervision.locator('#ap-summary')).toBeVisible()
  if (supervisor.posts.length !== 0) throw Error('Salió una aprobación sin lista.')
  await assertNames(supervision, 'respuesta de supervisor')
  await assertLayout(supervisor.page, output, '[role="tabpanel"]', 'supervisor-con-errores')
  await chooseRadio(supervisor.page, supervision.getByRole('radio', { name: 'Consultada' }), supervision.getByRole('radio', { name: 'Consultada' }), 0)
  for (const name of ['Estado jurídico', 'Canal válido', 'Alternativa asistida']) await pressCheckbox(supervisor.page, supervision.getByRole('checkbox', { name: new RegExp(name) }))
  await tabTo(supervisor.page, supervision.getByRole('button', { name: 'Registrar respuesta' }))
  await supervisor.page.keyboard.press('Enter')
  await expect(supervision.locator('#ap-notice')).toContainText('Aprobada por un supervisor.')
  await expect(supervision.getByRole('listitem').filter({ hasText: 'Modificar la acción' }).first()).toContainText('Aprobada por un supervisor')
  pass('supervisor_aprueba_con_teclado', 'Bloqueado sin lista; aprobado con lista completa.')

  // Roles sin formulario: ni se ofrece ni la acción lo acepta.
  const consulta = await newSession(browser, base, config, 'consulta')
  await consulta.page.goto(reviewUrl(base, CASE.intense))
  const readOnly = panelOf(consulta.page)
  await expect(readOnly.getByRole('heading', { name: 'Historial de decisiones' })).toBeVisible()
  await expect(readOnly.locator('form')).toHaveCount(0)
  await expect(readOnly.getByRole('radio')).toHaveCount(0)
  if ((await consulta.page.content()).includes(REASON_DETAIL)) throw Error('El detalle llegó a consulta.')
  await assertActionRejected(consulta, base, CASE.intense, recordId, approveId)
  pass('consulta_sin_formulario_y_accion_rechazada', 'Sin formulario, sin detalle en la página y la acción devuelve ROLE_FORBIDDEN.')

  // fixture.sql deja a la cuenta `importador` con el rol de compatibilidad `tp_operator`.
  const compat = await newSession(browser, base, config, 'importador')
  await compat.page.goto(reviewUrl(base, CASE.intense))
  const restricted = panelOf(compat.page)
  await expect(restricted.getByText('Tu rol permite leer la cartera, pero no las revisiones de este caso.')).toBeVisible()
  await expect(restricted.locator('form')).toHaveCount(0)
  await expect(restricted.getByText('Hechos del caso')).toHaveCount(0)
  await assertActionRejected(compat, base, CASE.intense, recordId, approveId)
  pass('tp_operator_sin_revision_y_accion_rechazada', 'Solo el aviso de rol; la acción devuelve ROLE_FORBIDDEN.')

  // Carga en curso: al confirmar es un aviso, no un error del usuario, y objetar sigue disponible.
  await proposeIntense(page, base, CASE.objected)
  await page.goto(reviewUrl(base, CASE.midLoad))
  const midLoad = panelOf(page)
  await chooseRadio(page, midLoad.getByRole('radio', { name: 'Aceptar la sugerencia' }), midLoad.getByRole('radio', { name: 'Aceptar la sugerencia' }), 0)
  await supervisor.page.goto(reviewUrl(base, CASE.objected))
  const inProgress = await registerBatch(config, 'VALIDADO', CUTOFFS.first)
  await tabTo(page, midLoad.getByRole('button', { name: 'Registrar decisión' }))
  await page.keyboard.press('Enter')
  const midLoadNotice = midLoad.locator('#rv-notice')
  await expect(midLoadNotice).toContainText('No hay un corte publicado')
  await expect(midLoadNotice).toHaveAttribute('role', 'status')
  await expect(midLoad.locator('#rv-summary')).toHaveCount(0)
  await expect(midLoad.getByRole('radio', { name: 'Aceptar la sugerencia' })).toBeChecked()
  pass('carga_en_curso_al_confirmar_no_es_error', 'Aviso con role=status, sin marcar campos y conservando la elección.')

  await page.reload()
  await expect(panelOf(page).getByText('No hay un corte publicado')).toBeVisible()
  await expect(panelOf(page).getByRole('heading', { name: 'Tu decisión' })).toHaveCount(0)
  pass('carga_en_curso_al_abrir_sin_formulario', 'Muestra el motivo y no ofrece el formulario.')

  await supervisor.page.reload()
  const objection = panelOf(supervisor.page)
  await expect(objection.getByRole('radio', { name: 'Aprobar la propuesta' })).toBeDisabled()
  await chooseRadio(supervisor.page, objection.getByRole('radio', { name: 'Objetar la propuesta' }), objection.getByRole('radio', { name: 'Objetar la propuesta' }), 0)
  await chooseOption(supervisor.page, objection.getByLabel('Motivo de la objeción', { exact: true }), 'La')
  await tabTo(supervisor.page, objection.getByRole('button', { name: 'Registrar respuesta' }))
  await supervisor.page.keyboard.press('Enter')
  await expect(objection.locator('#ap-notice')).toContainText('Objetada por un supervisor.')
  pass('objetar_disponible_con_carga_en_curso', 'Aprobar deshabilitado; objeción registrada.')

  // Termina la carga con otro corte: una página abierta antes no confirma en silencio.
  await registerBatch(config, 'PUBLICADO', CUTOFFS.first, inProgress)
  await page.goto(reviewUrl(base, CASE.outdated))
  const stale = panelOf(page)
  await chooseRadio(page, stale.getByRole('radio', { name: 'Aceptar la sugerencia' }), stale.getByRole('radio', { name: 'Aceptar la sugerencia' }), 0)
  const newCutoff = await registerBatch(config, 'VALIDADO', CUTOFFS.second)
  await registerBatch(config, 'PUBLICADO', CUTOFFS.second, newCutoff)
  const postsBeforeStale = operador.posts.length
  await tabTo(page, stale.getByRole('button', { name: 'Registrar decisión' }))
  await page.keyboard.press('Enter')
  const staleNotice = stale.locator('#rv-notice')
  await expect(staleNotice).toContainText('el corte publicado')
  await expect(staleNotice).toContainText('Sugerencia vigente')
  await expect(staleNotice).toHaveAttribute('role', 'alert')
  await expect(stale.getByRole('radio', { name: 'Aceptar la sugerencia' })).not.toBeChecked()
  await expect(stale.getByText('Corte: 31/10/2026').first()).toBeVisible()
  await chooseRadio(page, stale.getByRole('radio', { name: 'Aceptar la sugerencia' }), stale.getByRole('radio', { name: 'Aceptar la sugerencia' }), 0)
  await tabTo(page, stale.getByRole('button', { name: 'Registrar decisión' }))
  await page.keyboard.press('Enter')
  await expect(stale.locator('#rv-notice')).toContainText('Decisión registrada.')
  if (operador.posts.length !== postsBeforeStale + 2) throw Error('Se esperaban dos envíos: el rechazado y la nueva confirmación.')
  pass('sugerencia_cambiada_pide_confirmar_de_nuevo', 'Muestra lo vigente, borra la elección y solo registra tras volver a elegir.')

  if (report.console_errors.length) throw Error(`Errores de consola: ${report.console_errors.slice(0, 5).join(' | ')}`)
  pass('sin_errores_de_consola', 0)
  report.passed = true
}

try {
  await run()
} catch (error) {
  report.errors.push(clean(error.message).slice(0, 2000))
} finally {
  await browser?.close().catch(() => {})
  report.finished_at_utc = new Date().toISOString()
  if (values.output) await writeFile(resolve(values.output, 'review-a11y.json'), clean(JSON.stringify(report, null, 2)) + '\n').catch(() => {})
  console.log(`resultado|aprobado=${report.passed}|comprobaciones=${report.checks.length}|capturas=${report.screenshots.length}`)
  for (const message of report.errors) console.log(`error|${message}`)
  process.exitCode = report.passed ? 0 : 1
}
