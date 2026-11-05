// ALIGN-014: teclado, filtros y navegación contra next start + fixture E06 local.
// node tests/smoke/analytics-a11y.mjs <base-url> <config-privada.json> <directorio-nuevo>
import { chromium, expect as baseExpect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const [base, configFile, output] = process.argv.slice(2)
const origin = new URL(base)
if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port) throw Error('Solo servidor local.')
const config = JSON.parse(await readFile(configFile, 'utf8'))
if (config.url !== 'http://127.0.0.1:54321') throw Error('Solo fixture E06 local.')
await mkdir(output, { recursive: false })
const expect = baseExpect.configure({ timeout: 20000 })
const report = { passed: false, checks: [], errors: [], screenshots: [], startedAt: new Date().toISOString() }
const privateValues = [config.publishableKey, ...Object.values(config.accounts).flatMap(account => [account.email, account.password])]
const clean = value => privateValues.reduce((text, secret) => secret ? text.split(secret).join('[privado]') : text, String(value))
  .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_(?:publishable|secret)_[\w-]+/g, '[credencial]')
let browser, timer
try {
  const info = await fetch(new URL('/api/build-info', origin), { redirect: 'error' }).then(response => response.json())
  if (info.environment !== 'local' || info.supabaseProjectRef !== null || !/^[a-f0-9]{40}$/.test(info.sourceSha)) throw Error('Procedencia local inválida.')
  report.sha = info.sourceSha
  browser = await chromium.launch()
  timer = setTimeout(() => { void browser.close() }, 240000)
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'es-AR' })
  page.on('pageerror', error => report.errors.push(clean(error.message)))
  async function tabTo(locator) {
    for (let step = 0; step < 180; step++) {
      if (await locator.evaluate(element => element === document.activeElement).catch(() => false)) return
      await page.keyboard.press('Tab')
    }
    throw Error('Control no alcanzable por teclado.')
  }
  await page.goto(new URL('/login', origin).href)
  await tabTo(page.getByLabel('Email', { exact: true })); await page.keyboard.type(config.accounts.a.email)
  await tabTo(page.getByLabel('Password', { exact: true })); await page.keyboard.type(config.accounts.a.password)
  await tabTo(page.getByRole('button', { name: 'Iniciar sesion', exact: true })); await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Dashboard ejecutivo', exact: true })).toBeVisible()
  await page.goto(new URL('/debtors?minAmount=100&queue=SEGUIMIENTO', origin).href)
  await expect(page.getByRole('heading', { name: 'Objetos de deuda', exact: true })).toBeVisible()
  for (const label of ['Severidad', 'Estado', 'Tipo', 'Contacto']) {
    const control = page.getByLabel(label, { exact: true })
    await tabTo(control); await expect(control).toBeFocused()
    expect(await control.evaluate(element => element.labels.length)).toBe(1)
  }
  report.checks.push('Cuatro selectores asociados y alcanzables con Tab.')
  const search = page.getByLabel('Buscar por objeto o persona', { exact: true })
  await tabTo(search); await page.keyboard.type('TP-A')
  await tabTo(page.getByRole('button', { name: 'Aplicar filtros', exact: true })); await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/q=TP-A/)
  for (const [key, value] of [['q', 'TP-A'], ['minAmount', '100'], ['queue', 'SEGUIMIENTO']]) expect(new URL(page.url()).searchParams.get(key)).toBe(value)
  const navigation = page.getByRole('navigation', { name: 'Vistas con los mismos filtros' })
  await tabTo(navigation.getByRole('link', { name: 'Deuda y mora', exact: true })); await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Deuda y mora', exact: true })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('q')).toBe('TP-A')
  expect(new URL(page.url()).searchParams.get('queue')).toBe('SEGUIMIENTO')
  await expect(page.getByRole('region', { name: 'Población y corte' })).toContainText('Córdoba')
  report.checks.push('Aplicar y navegar conserva búsqueda, monto y cola; corte visible.')
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    const filename = `analitica-${width}.png`
    await page.screenshot({ path: resolve(output, filename), fullPage: true })
    report.screenshots.push(filename)
  }
  await tabTo(navigation.getByRole('link', { name: 'Objetos y filtros', exact: true })); await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Limpiar', exact: true })).toBeVisible()
  await tabTo(page.getByRole('button', { name: 'Limpiar', exact: true })); await page.keyboard.press('Enter')
  await expect(page).toHaveURL(origin.origin + '/debtors')
  await expect(page.getByRole('table').getByRole('link', { name: /^TP-A/ })).toBeVisible()
  report.checks.push('Limpiar restaura cartera; sin desborde a 360, 768 y 1440 px.')
  if (report.errors.length) throw Error('Error JavaScript durante el recorrido.')
  report.passed = true
} catch (error) {
  report.errors.push(clean(error.message))
  process.exitCode = 1
} finally {
  clearTimeout(timer)
  await browser?.close()
  report.finishedAt = new Date().toISOString()
  await writeFile(resolve(output, 'analytics-a11y.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, errors: report.errors }))
}
