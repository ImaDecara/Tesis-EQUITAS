import { chromium, expect as baseExpect } from '@playwright/test'
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: {
  url: { type: 'string' }, sha: { type: 'string' }, deployment: { type: 'string' },
  output: { type: 'string', default: '../.quality/smoke' },
  'config-file': { type: 'string' }, local: { type: 'boolean', default: false },
} })
const policy = JSON.parse(await readFile(new URL('../../../quality/preview-policy.json', import.meta.url), 'utf8'))
const expect = baseExpect.configure({ timeout: policy.assertion_timeout_ms })
const fixture = JSON.parse(await readFile(new URL('../../../quality/supabase-testing.json', import.meta.url), 'utf8'))
const output = resolve(values.output)
await mkdir(output, { recursive: true })
if (await access(resolve(output, 'smoke.json')).then(() => true, () => false)) {
  throw Error('Usar un directorio nuevo para conservar la evidencia de cada ejecucion.')
}
const report = {
  case_id: policy.smoke_case_id, passed: false, source_sha: values.sha,
  run_id: process.env.GITHUB_RUN_ID ?? null, run_attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  started_at_utc: new Date().toISOString(), context: values.local ? 'local_preflight' : 'Vercel preview',
  fixture_version: fixture.fixture_version, checks: [], errors: [], screenshots: [],
  tests: { passed: 0, failed: 1, skipped: 0 },
}
const privateValues = []
const clean = value => {
  let text = String(value)
  for (const secret of privateValues) if (secret) text = text.split(secret).join('[redacted]')
  return text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-jwt]')
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, '[redacted-key]')
}
const consoleErrors = []
const pageErrors = []
let browser, page, context, timer
try {
  const deployment = values.deployment ? JSON.parse(await readFile(values.deployment, 'utf8')) : null
  const base = new URL(values.url ?? deployment?.url ?? '')
  const sha = values.sha ?? deployment?.source_sha
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw Error('Se requiere SHA completo del despliegue.')
  if (base.search || base.hash || base.pathname !== '/') throw Error('Usar el origen del despliegue sin rutas ni parametros.')
  if (values.local ? !['localhost', '127.0.0.1'].includes(base.hostname)
    : base.protocol !== 'https:' || !new RegExp(policy.hostname_pattern).test(base.hostname)) {
    throw Error('Destino ajeno al preview permitido; no se envian credenciales.')
  }
  if (!values.local && (deployment?.passed !== true || deployment.source_sha !== sha || deployment.url !== base.origin)) {
    throw Error('Falta manifiesto de despliegue listo, con URL/SHA coincidentes.')
  }
  report.url = base.origin
  report.source_sha = sha
  report.deployment_id = deployment?.deployment_id ?? null
  report.quality_run_id = deployment?.quality_run_id ?? null
  const raw = values['config-file'] ? await readFile(values['config-file'], 'utf8') : process.env.SUPABASE_TEST_CONFIG
  if (!raw) throw Error('Falta SUPABASE_TEST_CONFIG; el smoke obligatorio no se omite.')
  let config
  try { config = JSON.parse(raw.replace(/^\uFEFF/, '')) }
  catch { throw Error('SUPABASE_TEST_CONFIG no es JSON valido.') }
  const account = config.accounts?.[policy.expected.account]
  if (config.url !== fixture.url || !config.publishableKey?.startsWith('sb_publishable_') || !account?.password) {
    throw Error('Se requiere configuracion exclusiva de Supabase testing con clave publicable.')
  }
  privateValues.push(config.publishableKey, ...Object.values(config.accounts).map(a => a.password))
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  if (bypass) privateValues.push(bypass)
  const deadline = Date.now() + policy.availability_timeout_seconds * 1000
  let info
  while (Date.now() < deadline) {
    const response = await fetch(new URL('/api/build-info', base), {
      redirect: 'manual', signal: AbortSignal.timeout(10_000),
      headers: bypass ? { 'x-vercel-protection-bypass': bypass } : {},
    })
    if ([301, 302, 303, 307, 308, 401, 403].includes(response.status)) {
      throw Error(`Preview protegido o redirigido (${response.status}); revisar el secreto de automatizacion.`)
    }
    if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
      info = await response.json()
      break
    }
    await new Promise(done => setTimeout(done, 2000))
  }
  if (!info) throw Error('Timeout esperando /api/build-info disponible.')
  if (info.sourceSha !== sha || info.supabaseProjectRef !== fixture.project_ref
    || info.environment !== (values.local ? 'local' : 'preview')
    || (!values.local && info.sourceBranch !== policy.branch)) {
    throw Error('SHA, entorno o destino Supabase del despliegue no coinciden; login cancelado.')
  }
  report.build_info = info
  report.checks.push({ id: 'availability', passed: true, observed: info })
  browser = await chromium.launch()
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'es-AR' })
  context.setDefaultTimeout(policy.assertion_timeout_ms)
  // Solo se agrega el header a Vercel; nunca se envia a Supabase u otros origenes.
  await context.route('**/*', route => {
    const request = route.request()
    const target = new URL(request.url())
    if (target.hostname.endsWith('.supabase.co') && target.origin !== fixture.url) {
      pageErrors.push('El navegador intento consultar un proyecto Supabase ajeno al testing.')
      return route.abort('blockedbyclient')
    }
    return route.continue(bypass && target.origin === base.origin
      ? { headers: { ...request.headers(), 'x-vercel-protection-bypass': bypass } } : {})
  })
  page = await context.newPage()
  page.on('pageerror', error => pageErrors.push(clean(error.message)))
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(clean(message.text())) })
  const capture = async name => {
    await page.screenshot({ path: resolve(output, name + '.png'), fullPage: true,
      mask: [page.locator('input[type=password]')] })
    report.screenshots.push(name + '.png')
  }
  const noVisibleError = async () => {
    await expect(page.getByText('Tablas con acceso restringido o errores de lectura')).toHaveCount(0)
    await expect(page.getByText('Validando sesion...', { exact: true })).toHaveCount(0)
    if (pageErrors.length || consoleErrors.length) throw Error('Se detectaron errores JavaScript/console; ver diagnostico sanitizado.')
  }
  timer = setTimeout(() => { void browser.close().catch(() => {}) }, policy.case_timeout_seconds * 1000)
  await page.goto(new URL('/login', base).href)
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
  await page.getByLabel('Email', { exact: true }).fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  await page.getByRole('button', { name: 'Iniciar sesion', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard ejecutivo', exact: true })).toBeVisible()
  await expect(page).toHaveURL(base.origin + '/')
  await noVisibleError()
  report.checks.push({ id: 'login', passed: true, observed: 'Dashboard autenticado disponible.' })

  const expectedAmount = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(policy.expected.debt_amount)
  const metric = page.getByText('Deuda total', { exact: true }).locator('..').locator('..').locator('..')
  await expect(metric).toContainText(expectedAmount)
  await expect(page.locator('body')).not.toContainText(policy.expected.other_debtor_identifier)
  await capture('dashboard')
  report.checks.push({ id: 'dashboard', passed: true, observed: { debt_amount: policy.expected.debt_amount, other_tenant_visible: false } })

  await page.getByRole('link', { name: 'Objetos de deuda', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Objetos de deuda', exact: true })).toBeVisible()
  const ownDebtor = page.getByRole('table').getByRole('link', { name: new RegExp('^' + policy.expected.debtor_identifier + '\\b') })
  await expect(ownDebtor).toBeVisible()
  await page.getByLabel('Buscar por objeto o persona').fill(policy.expected.unmatched_filter)
  await page.getByRole('button', { name: 'Aplicar filtros', exact: true }).click()
  await expect(page).toHaveURL(new RegExp('q=' + policy.expected.unmatched_filter))
  await expect(page.getByText('No hay objetos que cumplan los filtros actuales.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Limpiar', exact: true }).click()
  await expect(ownDebtor).toBeVisible()
  await expect(page).toHaveURL(base.origin + '/debtors')
  await noVisibleError()
  await capture('objetos-filtro-restaurado')
  await page.getByRole('link', { name: 'Personas / Deudores', exact: true }).first().click()
  await expect(page).toHaveURL(base.origin + '/people')
  await expect(page.getByRole('heading', { name: 'Personas / Deudores', exact: true })).toBeVisible()
  const peopleTable = page.getByRole('table').filter({
    has: page.getByRole('columnheader', { name: 'Deuda total asociada', exact: true }),
  })
  const ownPerson = peopleTable.getByRole('row').filter({ hasText: policy.expected.person_name })
  await expect(ownPerson).toBeVisible()
  await expect(ownPerson).toContainText(expectedAmount)
  await expect(page.locator('body')).not.toContainText(policy.expected.other_person_name)
  await noVisibleError()
  await capture('personas')
  report.checks.push({ id: 'navigation_filter', passed: true, observed: 'Objeto A, filtro sin resultados, limpieza y listado /people con persona A y ARS 1250 comprobados; B ausente.' })

  await page.getByRole('button', { name: 'Cerrar sesion', exact: true }).first().click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/login')
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
  await page.goto(new URL('/debtors', base).href)
  await expect(page).toHaveURL(/\/login\?next=/)
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
  await expect(page.getByRole('table')).toHaveCount(0)
  await noVisibleError()
  await capture('logout-protegido')
  report.checks.push({ id: 'logout', passed: true, observed: 'Nueva navegacion protegida redirige a login y no muestra cartera.' })
  report.passed = report.checks.length === 5
  report.tests = { passed: report.passed ? 1 : 0, failed: report.passed ? 0 : 1, skipped: 0 }
} catch (error) {
  report.errors.push(clean(error.message))
  if (page && !page.isClosed()) {
    await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true,
      mask: [page.locator('input[type=password]')] }).catch(() => {})
  }
} finally {
  clearTimeout(timer)
  await browser?.close().catch(() => {})
  report.console_errors = consoleErrors
  report.page_errors = pageErrors
  report.finished_at_utc = new Date().toISOString()
  await writeFile(resolve(output, 'smoke.json'), JSON.stringify(report, null, 2) + '\n')
  const xml = value => String(value).replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[ch])
  await writeFile(resolve(output, 'smoke.xml'), `<testsuite name="E07 browser smoke" tests="1" failures="${report.passed ? 0 : 1}" skipped="0"><testcase name="SMOKE-01 login, datos, filtros y logout">${report.passed ? '' : '<failure message="Smoke failed">' + xml(report.errors.join('\n')) + '</failure>'}</testcase></testsuite>\n`)
  const markdown = `# E07 - Smoke de navegador\n\nSHA: \`${report.source_sha}\`. URL: ${report.url ?? 'sin destino valido'}.\n\nResultado: **${report.passed ? 'aprobado' : 'fallido'}**; 1 recorrido, ${report.checks.length}/5 comprobaciones aprobadas, cero omisiones.\n\n` + report.checks.map(c => `- ${c.id}: ${c.passed ? 'aprobado' : 'fallido'}`).join('\n') + '\n\n' + report.errors.join('\n') + '\n'
  await writeFile(resolve(output, 'summary.md'), markdown)
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: 'a' })
  console.log(markdown)
  process.exitCode = report.passed ? 0 : 1
}
