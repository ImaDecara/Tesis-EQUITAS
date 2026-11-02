// ALIGN-069. Prueba real de la auditoria: `next start`, Auth, RLS y PostgREST del stack local.
// No imprime claves ni contrasenas. Publica solo identificadores sinteticos, codigos y conteos. Sale con 1 si un caso falla.
// Uso: node tests/local-audit/run-audit.mjs <credenciales.psv> <http://127.0.0.1:PUERTO> <http://127.0.0.1:PUERTO_SIN_CREDENCIAL> </tmp/salida.json>
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServerClient } from '@supabase/ssr'
import { chromium } from '@playwright/test'

const [credentialsPath, base, baseWithoutCredential, output] = process.argv.slice(2)
const LOOPBACK = /^http:\/\/127\.0\.0\.1:\d+$/
if (!LOOPBACK.test(base ?? '') || !LOOPBACK.test(baseWithoutCredential ?? '') || !output?.startsWith('/tmp/')) {
  throw new Error('Uso: run-audit.mjs <credenciales.psv> <http://127.0.0.1:P1> <http://127.0.0.1:P2> </tmp/salida.json>')
}
const LOCAL = '/tmp/equitas-local-db'
const env = Object.fromEntries(readFileSync(`${LOCAL}/supabase-local.env`, 'utf8').split('\n').flatMap(line => {
  const at = line.indexOf('=')
  return at > 0 ? [[line.slice(0, at), line.slice(at + 1).replace(/^"|"$/g, '')]] : []
}))
if (env.API_URL !== 'http://127.0.0.1:54321') throw new Error('Solo se admite el stack local.')
const REST = `${env.API_URL}/rest/v1`
const reviewJwt = readFileSync(`${LOCAL}/equitas_review_server.jwt`, 'utf8').trim()
const importJwt = readFileSync(`${LOCAL}/equitas_import_server.jwt`, 'utf8').trim()
const accounts = Object.fromEntries(readFileSync(credentialsPath, 'utf8').trim().split('\n').map(line => {
  const [label, email, password] = line.split('|')
  return [label, { email, password }]
}))

const TENANT_A = '920001'
const TENANT_B = '920002'
const OWN = '928101'
const FOREIGN = '928201'
const USERS = { consulta: '920001', operador: '920002', supervisor: '920003', importador: '920004' }
const SECRET_MARK = 'TP-A028-DESCRIPCION-SECRETA'

const sql = query => execFileSync('docker', ['exec', '-i', 'supabase_db_equitas-tp-testing', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-F', '|', '-c', query], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const auditCount = () => Number(sql('select count(*) from public.access_audit'))
const auditFingerprint = () => sql("select count(*) || ':' || coalesce(md5(string_agg(a::text, '|' order by id)), '') from public.access_audit a")
const newestAudit = () => {
  const [tenant, actor, role, action, target] = sql('select tenant, actor, actor_role, action, target from public.access_audit order by id desc limit 1').split('|')
  return { tenant, actor, role, action, target }
}

const results = []
function check(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail) })
  console.log(`${pass ? 'OK ' : 'FALLA'} ${name}${detail === '' ? '' : ` [${detail}]`}`)
}

async function signIn(label) {
  const jar = new Map()
  const client = createServerClient(env.API_URL, env.PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: values => { for (const { name, value } of values) jar.set(name, value) },
    },
  })
  const { data, error } = await client.auth.signInWithPassword(accounts[label])
  if (error) throw new Error(`LOGIN_FALLIDO ${label} ${error.status}`)
  return { token: data.session.access_token, jar, cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; ') }
}

const sessions = {}
for (const label of Object.keys(accounts)) sessions[label] = await signIn(label)

const app = (root, path, label, extra = {}) => {
  const session = label ? sessions[label] : null
  const { tenant, ...headers } = extra
  const cookie = [session?.cookie, tenant ? `equitas_tenant_id=${tenant}` : ''].filter(Boolean).join('; ')
  return fetch(new URL(path, root), { redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...headers } })
}
const rest = (path, bearer, init = {}) => fetch(`${REST}${path}`, {
  ...init,
  headers: { apikey: env.PUBLISHABLE_KEY, ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), 'Content-Type': 'application/json', ...(init.headers ?? {}) },
})
const rpc = (bearer, args) => rest('/rpc/record_access_audit', bearer, { method: 'POST', body: JSON.stringify(args) })

// Cuanto cambia la tabla con una accion. Lee el cuerpo entero: una respuesta en curso aun podria estar renderizando.
async function delta(act) {
  const before = auditCount()
  const response = await act()
  const body = response ? await response.text() : ''
  return { added: auditCount() - before, status: response?.status, body }
}

// 1. Apertura de la ficha: exactamente un registro por entrega, con actor y rol de la base.
for (const [label, actor] of Object.entries({ consulta: USERS.consulta, operador: USERS.operador, supervisor: USERS.supervisor })) {
  const { added, status, body } = await delta(() => app(base, `/debtors/${OWN}`, label))
  const row = newestAudit()
  check(`ficha HTML ${label}: un registro`, status === 200 && added === 1 && body.includes(SECRET_MARK), `status=${status} agregados=${added}`)
  check(`ficha HTML ${label}: fila correcta`, row.tenant === TENANT_A && row.actor === actor && row.role === label && row.action === 'CASE_OPEN' && row.target === OWN, JSON.stringify(row))
}
{
  const { added, status } = await delta(() => app(base, `/debtors/${OWN}`, 'operador', { RSC: '1' }))
  check('ficha por navegacion RSC: un registro', status === 200 && added === 1, `status=${status} agregados=${added}`)
}
{
  const { added, body } = await delta(() => app(base, `/debtors/${OWN}`, 'operador', { RSC: '1', 'Next-Router-Prefetch': '1' }))
  check('prefetch de la ficha: sin registro y sin datos', added === 0 && !body.includes(SECRET_MARK), `agregados=${added}`)
}
{
  const { added, body } = await delta(() => app(base, `/debtors/${OWN}`, 'operador', { RSC: '1', 'Next-Router-Prefetch': '1', 'Next-Router-Segment-Prefetch': '/_tree' }))
  check('prefetch por segmento: sin registro y sin datos', added === 0 && !body.includes(SECRET_MARK), `agregados=${added}`)
}
{
  const { added, status } = await delta(() => app(base, '/debtors', 'operador'))
  check('listado: no cuenta como apertura', status === 200 && added === 0, `status=${status} agregados=${added}`)
}
for (const [name, path, label, extra] of [
  ['objeto de otro municipio', `/debtors/${FOREIGN}`, 'operador', {}],
  ['objeto inexistente', '/debtors/999999999', 'operador', {}],
  ['importador sin permiso de lectura', `/debtors/${OWN}`, 'importador', {}],
  ['sin membresia', `/debtors/${OWN}`, 'sin-membresia', {}],
  ['membresia inactiva', `/debtors/${OWN}`, 'inactivo', {}],
  ['anonimo', `/debtors/${OWN}`, null, {}],
  ['cookie de otro municipio', `/debtors/${OWN}`, 'operador', { tenant: TENANT_B }],
]) {
  const { added, body } = await delta(() => app(base, path, label, extra))
  check(`ficha, ${name}: sin registro y sin datos`, added === 0 && !body.includes(SECRET_MARK), `agregados=${added}`)
}
{
  const { added, status } = await delta(() => app(base, '/debtors/910001', 'tp-e06-a'))
  const row = newestAudit()
  check('tp_operator: lee y queda registrado con su rol', status === 200 && added === 1 && row.role === 'tp_operator' && row.tenant === '910001', `status=${status} agregados=${added} rol=${row.role}`)
}

// Navegador real: mirar el listado no audita, y hacer clic en un caso deja un solo registro.
{
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    await context.addCookies([...sessions.operador.jar].map(([name, value]) => ({ name, value, url: base })))
    const page = await context.newPage()
    const before = auditCount()
    await page.goto(`${base}/debtors`, { waitUntil: 'networkidle' })
    const link = page.locator(`a[href="/debtors/${OWN}"]`).first()
    await link.hover()
    await page.waitForTimeout(1500)
    check('Chromium, listado con prefetch y hover: sin registros', auditCount() === before, `agregados=${auditCount() - before}`)
    await link.click()
    await page.waitForURL(`**/debtors/${OWN}`)
    await page.getByText(SECRET_MARK).first().waitFor()
    await page.waitForTimeout(1000)
    check('Chromium, clic en un caso: exactamente un registro', auditCount() === before + 1, `agregados=${auditCount() - before}`)
  } finally {
    await browser.close()
  }
}

// 2. Exportaciones: un registro por archivo entregado; ninguno si no se entrega.
const REPORTS = { queue: 'cola-de-trabajo', decisions: 'decisiones', supervision: 'supervision', 'data-quality': 'calidad-de-datos', access: 'accesos' }
for (const [route, code] of Object.entries(REPORTS)) {
  const { added, status, body } = await delta(() => app(base, `/api/reports/${route}`, 'supervisor'))
  const row = newestAudit()
  check(`exportar ${route}: un registro`, status === 200 && added === 1 && body.length > 0, `status=${status} agregados=${added}`)
  check(`exportar ${route}: fila correcta`, row.action === 'REPORT_EXPORT' && row.target === code && row.actor === USERS.supervisor && row.role === 'supervisor' && row.tenant === TENANT_A, JSON.stringify(row))
}
for (const [name, route, label, expected] of [
  ['anonimo', 'queue', null, 401],
  ['consulta en supervision', 'supervision', 'consulta', 403],
  ['operador en accesos', 'access', 'operador', 403],
  ['consulta en accesos', 'access', 'consulta', 403],
  ['tp_operator en accesos', 'access', 'tp-e06-a', 403],
  ['importador en cola', 'queue', 'importador', 403],
  ['filtro desconocido', 'queue?inventado=1', 'supervisor', 400],
  ['filtro invalido en accesos', 'access?actor=abc', 'supervisor', 400],
]) {
  const { added, status } = await delta(() => app(base, `/api/reports/${route}`, label))
  check(`exportar, ${name}: ${expected} y sin registro`, status === expected && added === 0, `status=${status} agregados=${added}`)
}

// 3. El reporte coincide con los registros, y otro municipio no entra. Se genera un registro del municipio B antes.
{
  const { added, status } = await delta(() => app(base, `/debtors/${FOREIGN}`, 'otro-supervisor', { tenant: TENANT_B }))
  check('municipio B: su supervisor abre su objeto', status === 200 && added === 1, `status=${status} agregados=${added}`)
}
const parseReport = text => {
  const lines = text.replace(/^﻿/, '').trim().split('\r\n').map(line => line.split(';').map(cell => cell.replace(/^"|"$/g, '')))
  const [header, ...rows] = lines
  return rows.map(row => Object.fromEntries(header.map((name, index) => [name, row[index]])))
}
const expectedRows = tenant => sql(`select id, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), action, target, actor, actor_role from public.access_audit where tenant = ${tenant} order by id`)
  .split('\n').filter(Boolean)
const reportRows = rows => rows.filter(row => row.tipo_fila === 'DETALLE').map(row => [row.registro_id, row.fecha, row.accion, row.objetivo, row.actor_id, row.rol_actor].join('|'))
for (const [name, label, tenant, extra] of [['A', 'supervisor', TENANT_A, {}], ['B', 'otro-supervisor', TENANT_B, { tenant: TENANT_B }]]) {
  const expected = expectedRows(tenant)
  const response = await app(base, '/api/reports/access', label, extra)
  const rows = parseReport(await response.text())
  const received = reportRows(rows)
  check(`reporte ${name}: coincide fila por fila con la tabla`, response.status === 200 && expected.length > 0 && JSON.stringify(received) === JSON.stringify(expected), `esperadas=${expected.length} recibidas=${received.length}`)
  check(`reporte ${name}: el total coincide`, rows.filter(row => row.tipo_fila === 'TOTAL').map(row => row.registros).join() === String(expected.length))
  check(`reporte ${name}: solo identificadores y codigos`, !/example\.test|Persona|Fixture|TP-A0/.test(JSON.stringify(rows)))
}
{
  const response = await app(base, `/api/reports/access?accion=CASE_OPEN&actor=${USERS.operador}`, 'supervisor')
  const rows = parseReport(await response.text()).filter(row => row.tipo_fila === 'DETALLE')
  const expected = Number(sql(`select count(*) from public.access_audit where tenant = ${TENANT_A} and action = 'CASE_OPEN' and actor = ${USERS.operador}`))
  check('reporte filtrado por accion y actor: coincide', rows.length === expected && expected > 0, `esperadas=${expected} recibidas=${rows.length}`)
}
{
  const response = await app(base, '/api/reports/access', 'otro-supervisor', { tenant: TENANT_A })
  check('dos membresias: consulta en A no recibe el reporte de A', response.status === 403, `status=${response.status}`)
}

// 4. Data API: quien lee, directo.
const restTenants = async bearer => {
  const response = await rest('/access_audit?select=id,tenant&limit=100000', bearer)
  const body = await response.json()
  return { status: response.status, body, tenants: Array.isArray(body) ? [...new Set(body.map(row => String(row.tenant)))] : null, rows: Array.isArray(body) ? body.length : null }
}
{
  const read = await restTenants(sessions.supervisor.token)
  check('Data API, supervisor A: solo su municipio y todas sus filas', read.status === 200 && read.tenants.join() === TENANT_A && read.rows === expectedRows(TENANT_A).length, `filas=${read.rows}`)
}
{
  const read = await restTenants(sessions['otro-supervisor'].token)
  check('Data API, supervisor B: no lee A', read.status === 200 && read.tenants.join() === TENANT_B, `municipios=${read.tenants}`)
}
for (const label of ['consulta', 'operador', 'importador', 'sin-membresia', 'inactivo', 'tp-e06-a']) {
  const read = await restTenants(sessions[label].token)
  check(`Data API, ${label}: cero filas`, read.status === 200 && read.rows === 0, `status=${read.status} filas=${read.rows}`)
}
for (const [name, bearer] of [['anon', null], ['service_role', env.SERVICE_ROLE_KEY], ['credencial de servidor', reviewJwt]]) {
  const read = await restTenants(bearer)
  check(`Data API, ${name}: lectura rechazada`, read.status >= 400 && read.body?.code === '42501', `status=${read.status} codigo=${read.body?.code}`)
}

// 5. Data API: escritura, edicion y borrado directos rechazados, sin efecto. Tambien el camino de la funcion para clientes.
const fingerprint = auditFingerprint()
const anyId = sql('select id from public.access_audit order by id limit 1')
const forged = { tenant: Number(TENANT_A), actor: 1, actor_role: 'supervisor', action: 'CASE_OPEN', target: OWN, idempotency_key: randomUUID() }
for (const [name, bearer] of [['anon', null], ['consulta', sessions.consulta.token], ['supervisor', sessions.supervisor.token], ['service_role', env.SERVICE_ROLE_KEY], ['credencial de servidor', reviewJwt], ['credencial de importacion', importJwt]]) {
  for (const [verb, path, init] of [
    ['INSERT', '/access_audit', { method: 'POST', body: JSON.stringify(forged) }],
    ['UPDATE', `/access_audit?id=eq.${anyId}`, { method: 'PATCH', body: JSON.stringify({ actor: 1 }) }],
    ['DELETE', `/access_audit?id=eq.${anyId}`, { method: 'DELETE' }],
  ]) {
    const response = await rest(path, bearer, init)
    const body = await response.json().catch(() => ({}))
    check(`Data API, ${name}: ${verb} rechazado`, response.status >= 400 && body.code === '42501', `status=${response.status} codigo=${body.code}`)
  }
}
const goodArgs = overrides => ({ p_actor_user: USERS.operador, p_tenant: TENANT_A, p_action: 'CASE_OPEN', p_target: OWN, p_idempotency_key: randomUUID(), ...overrides })
for (const [name, bearer] of [['anon', null], ['consulta', sessions.consulta.token], ['supervisor', sessions.supervisor.token], ['service_role', env.SERVICE_ROLE_KEY]]) {
  const response = await rpc(bearer, goodArgs())
  const body = await response.json().catch(() => ({}))
  check(`Data API, ${name}: la funcion de escritura no se ejecuta`, response.status >= 400 && body.code === '42501', `status=${response.status} codigo=${body.code}`)
}
check('Ningun intento directo cambio la tabla', auditFingerprint() === fingerprint)
for (const [verb, statement] of [
  ['UPDATE', `update public.access_audit set actor = 1 where id = ${anyId}`],
  ['DELETE', `delete from public.access_audit where id = ${anyId}`],
  ['TRUNCATE', 'truncate public.access_audit'],
]) {
  let message = ''
  try { sql(statement) } catch (error) { message = String(error.stderr ?? error.message) }
  check(`Dueno de la tabla: ${verb} rechazado`, message.includes('APPEND_ONLY'))
}
check('El dueno tampoco cambio la tabla', auditFingerprint() === fingerprint)

// 6. La funcion comun: valida actor, objeto y formato; no duplica.
const rejected = async (name, bearer, args, code) => {
  const before = auditCount()
  const response = await rpc(bearer, args)
  const body = await response.json().catch(() => ({}))
  check(`funcion: ${name}`, response.status >= 400 && String(body.message).startsWith(code) && auditCount() === before, `status=${response.status} mensaje=${body.message}`)
}
await rejected('actor sin membresia en ese municipio', reviewJwt, goodArgs({ p_tenant: TENANT_B }), 'ACTOR_NOT_ACTIVE_MEMBER')
await rejected('membresia inactiva', reviewJwt, goodArgs({ p_actor_user: '920006' }), 'ACTOR_NOT_ACTIVE_MEMBER')
await rejected('objeto de otro municipio', reviewJwt, goodArgs({ p_target: FOREIGN }), 'OBJECT_NOT_IN_TENANT')
await rejected('objetivo con un valor personal en la ficha', reviewJwt, goodArgs({ p_target: 'Ana Perez' }), 'OBJECT_NOT_IN_TENANT')
await rejected('objetivo con un valor personal en un reporte', reviewJwt, goodArgs({ p_action: 'REPORT_EXPORT', p_target: 'Ana Perez 20123456' }), 'INVALID_ACCESS_AUDIT:access_audit_target_format')
await rejected('objetivo vacio', reviewJwt, goodArgs({ p_action: 'REPORT_EXPORT', p_target: '' }), 'INVALID_ACCESS_AUDIT:access_audit_target_format')
await rejected('accion fuera de lista', reviewJwt, goodArgs({ p_action: 'OTRA' }), 'INVALID_ACCESS_AUDIT:access_audit_action_valid')
await rejected('sin clave de idempotencia', reviewJwt, goodArgs({ p_idempotency_key: null }), 'INVALID_ACCESS_AUDIT')
{
  const key = randomUUID()
  const first = await (await rpc(reviewJwt, goodArgs({ p_idempotency_key: key }))).json()
  const before = auditCount()
  const again = await (await rpc(reviewJwt, goodArgs({ p_idempotency_key: key }))).json()
  check('funcion: reintento con la misma clave no duplica', first.created === true && again.created === false && again.audit_id === first.audit_id && auditCount() === before, JSON.stringify({ primero: first.created, segundo: again.created }))
  await rejected('misma clave con otro contenido', reviewJwt, goodArgs({ p_idempotency_key: key, p_action: 'REPORT_EXPORT', p_target: 'cola-de-trabajo' }), 'IDEMPOTENCY_KEY_CONFLICT')
}
{
  const key = randomUUID()
  const before = auditCount()
  const replies = await Promise.all(Array.from({ length: 8 }, () => rpc(reviewJwt, goodArgs({ p_idempotency_key: key })).then(response => response.json())))
  check('funcion: 8 envios simultaneos con la misma clave dejan una fila', auditCount() === before + 1 && replies.filter(reply => reply.created === true).length === 1, `agregados=${auditCount() - before}`)
}
// La misma funcion para los tickets que siguen, sobre un lote VALIDADO: sintetico-v1 siempre queda BLOQUEADO y no ejercita este camino.
{
  const batchA = sql(`insert into public.import_batch(tenant, source, file_hashes, as_of, rules_version, status, created_by, created_by_role, idempotency_key)
    values (${TENANT_A}, 'A069', '{"archivo": "${'a'.repeat(64)}"}', '2026-11-01', '1.0.0', 'VALIDADO', ${USERS.importador}, 'importador', '${randomUUID()}') returning id`).split('\n')[0]
  const importArgs = { p_actor_user: USERS.importador, p_tenant: TENANT_A, p_action: 'IMPORT_CONFIRM', p_target: batchA, p_idempotency_key: randomUUID() }
  const response = await rpc(importJwt, importArgs)
  const row = newestAudit()
  check('057: confirmar un lote VALIDADO con la credencial de importacion', response.status === 200 && row.action === 'IMPORT_CONFIRM' && row.target === batchA && row.role === 'importador', `status=${response.status}`)
  await rejected('057: lote de otro municipio', importJwt, { ...importArgs, p_actor_user: '920007', p_tenant: TENANT_B, p_idempotency_key: randomUUID() }, 'OBJECT_NOT_IN_TENANT')
  const analytics = await rpc(reviewJwt, goodArgs({ p_actor_user: USERS.supervisor, p_action: 'ANALYTICS_VIEW', p_target: 'segmentos' }))
  check('064: vista de analitica', analytics.status === 200 && newestAudit().action === 'ANALYTICS_VIEW', `status=${analytics.status}`)
  const channel = await rpc(reviewJwt, goodArgs({ p_action: 'CHANNEL_LINK' }))
  check('066: vinculacion del canal a un caso', channel.status === 200 && newestAudit().action === 'CHANNEL_LINK', `status=${channel.status}`)
  const reader = await rest('/rpc/record_access_audit', importJwt, { method: 'POST', body: JSON.stringify(goodArgs({ p_actor_user: USERS.importador })) })
  check('La credencial de importacion tampoco elige el rol: sale de la membresia', reader.status === 200 && newestAudit().role === 'importador', `status=${reader.status}`)
}

// 7. Limite declarado: una lectura autorizada directa por PostgREST NO queda auditada.
{
  const read = await delta(() => rest(`/debtor?select=id,description&id=eq.${OWN}`, sessions.operador.token))
  check('LIMITE CONFIRMADO: lectura directa de debtor por la Data API, sin registro', read.status === 200 && read.body.includes(SECRET_MARK) && read.added === 0, `status=${read.status} agregados=${read.added}`)
  const reviews = await delta(() => rest('/case_review?select=id&limit=1', sessions.supervisor.token))
  check('LIMITE CONFIRMADO: lectura directa de case_review por la Data API, sin registro', reviews.status === 200 && reviews.added === 0, `status=${reviews.status} agregados=${reviews.added}`)
}

// 8. Falla cerrada de punta a punta: la misma aplicacion sin credencial no entrega nada.
{
  const open = await delta(() => app(baseWithoutCredential, `/debtors/${OWN}`, 'operador'))
  check('sin credencial, ficha: sin datos y sin registro', open.added === 0 && !open.body.includes(SECRET_MARK), `status=${open.status} agregados=${open.added}`)
  const opened = await delta(() => app(baseWithoutCredential, `/debtors/${OWN}`, 'operador', { RSC: '1' }))
  check('sin credencial, ficha por RSC: sin datos y sin registro', opened.added === 0 && !opened.body.includes(SECRET_MARK), `status=${opened.status} agregados=${opened.added}`)
  const exported = await delta(() => app(baseWithoutCredential, '/api/reports/supervision', 'supervisor'))
  check('sin credencial, reporte: 503 sin archivo', exported.status === 503 && exported.body.includes('AUDITORIA_NO_DISPONIBLE') && exported.added === 0, `status=${exported.status}`)
}

const failed = results.filter(result => !result.pass)
writeFileSync(output, JSON.stringify({ casos: results.length, fallas: failed.length, resultados: results }, null, 1), { mode: 0o600 })
console.log(`CASOS|${results.length}\nFALLAS|${failed.length}`)
process.exit(failed.length ? 1 : 0)
