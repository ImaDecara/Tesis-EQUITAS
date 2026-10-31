import { createServerClient } from '@supabase/ssr'
import { expect, test } from '@playwright/test'
import { readLocalDalConfig, type Label } from './config'

const config = readLocalDalConfig()
const markers = ['ALIGN019_OBJ_A', 'ALIGN019_OBJ_B', 'ALIGN019_PERSON_A', 'ALIGN019_PERSON_B', 'ALIGN019_PERSON_SHARED', 'align019-a@example.test', 'align019-b@example.test', 'align019-shared@example.test']
const routes = ['/', '/debtors', '/debtors/9801901', '/people', '/priority-cases', '/no-contact', '/debt-aging', '/risk-analysis', '/recommended-actions']

async function session(label: Label) {
  const cookies = new Map<string, string>()
  const client = createServerClient(config.supabaseUrl, config.publishableKey, {
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: values => { for (const { name, value } of values) cookies.set(name, value) },
    },
    global: { fetch: (input, init) => fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) }) },
  })
  const { error } = await client.auth.signInWithPassword(config.accounts[label])
  // Solo codigo: nunca serializar session, JWT, password ni respuestas Auth.
  expect(error?.code ?? null, `Login sintetico ${label}`).toBeNull()
  return { client, cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') }
}

test('precondicion: USING(true) permite leer cartera al usuario sin membresia por REST', async () => {
  const { client } = await session('none')
  try {
    const { data, error } = await client.from('debtor').select('identifier').in('id', [9801901, 9801902]).order('id')
    expect(error?.code ?? null).toBeNull()
    expect(data?.map(row => row.identifier)).toEqual(markers.slice(0, 2))
  } finally { await client.auth.signOut() }
})

const rscOptions = (rsc: boolean, cookie?: string) => ({
  headers: { ...(cookie ? { Cookie: cookie } : {}), ...(rsc ? { RSC: '1' } : {}) },
  // Next 16 valida el cache-buster RSC; sin headers de router su hash es vacio.
  params: rsc ? { _rsc: '' } : undefined,
  maxRedirects: 0,
})

test('anonimo: HTML y RSC reciben 307 real a login, conservan la ruta y no traen cartera', async ({ request }) => {
  for (const route of [...routes, '/ruta-sin-listar']) for (const rsc of [false, true]) {
    const response = await request.get(route, rscOptions(rsc))
    const where = `${route} RSC=${rsc}`
    expect(response.status(), where).toBe(307)
    // Next deja la cabecera relativa: el destino no depende de ningun host de la solicitud.
    expect(response.headers().location, where).toBe(route === '/' ? '/login' : `/login?next=${encodeURIComponent(route)}`)
    expect(response.headers()['cache-control'], where).toContain('no-store')
    const body = await response.text()
    for (const marker of markers) expect(body.includes(marker), `${where}: ${marker}`).toBe(false)
  }
})

test('anonimo: login, seleccion y build-info responden sin redirigir', async ({ request }) => {
  for (const route of ['/login', '/select-tenant', '/api/build-info']) for (const rsc of [false, true]) {
    const response = await request.get(route, rscOptions(rsc))
    expect(response.status(), `${route} RSC=${rsc}`).toBe(200)
  }
})

test('next nunca lleva a otro host: ni desde el proxy, ni desde el ingreso, ni con cabeceras falsas', async ({ request }) => {
  const forged: Record<string, string>[] = [{ Host: 'otro.example' }, { 'X-Forwarded-Host': 'otro.example' }, { 'X-Forwarded-Proto': 'javascript', 'X-Forwarded-Host': 'otro.example' }]
  for (const headers of forged) {
    const response = await request.get('/debtors', { headers, maxRedirects: 0 })
    expect(response.status()).toBe(307)
    expect(response.headers().location).toBe('/login?next=%2Fdebtors')
  }
  for (const route of ['//otro.example/x', '//otro.example', '/\\otro.example', '/%5Cotro.example', '/.//otro.example']) {
    const response = await request.get(`http://127.0.0.1:31019${route}`, { maxRedirects: 0 })
    const location = new URL(response.headers().location ?? '/', 'http://127.0.0.1:31019')
    expect(location.host, route).toBe('127.0.0.1:31019')
    // Lo que importa es el destino que usaria el formulario tras ingresar, ya decodificado.
    const next = location.searchParams.get('next')
    if (next) expect(new URL(next, 'http://127.0.0.1:31019').host, `${route} -> ${next}`).toBe('127.0.0.1:31019')
  }
  for (const next of ['//otro.example', '/\\otro.example', 'https://otro.example', '/%09/otro.example/x'.replace('%09', '\t')]) {
    const response = await request.get('/login', { params: { next }, maxRedirects: 0 })
    expect(response.status(), next).toBe(200)
    // Flight repite la URL pedida en su estado de ruta: lo que decide el destino es esta prop.
    const flight = (await response.text()).replaceAll('\\"', '"')
    expect(flight.includes('"nextPath":"/"'), next).toBe(true)
  }
})

for (const label of ['none', 'inactive', 'multi'] as const) {
  test(`${label}: HTML y RSC directos deniegan con 200 y sin cartera`, async ({ request }) => {
    const auth = await session(label)
    try {
      for (const route of routes) for (const rsc of [false, true]) {
        const response = await request.get(route, rscOptions(rsc, auth.cookie))
        const where = `${label} ${route} RSC=${rsc}`
        const body = await response.text()
        for (const marker of markers) expect(body.includes(marker), `${where}: ${marker}`).toBe(false)
        // El streaming ya empezo cuando corre la DAL: la denegacion autenticada es siempre 200.
        expect(response.status(), where).toBe(200)
        expect(response.headers()['cache-control'], where).toContain('no-store')
        // Un 404 o una pagina vacia no acredita una denegacion de autorizacion.
        // En HTML de produccion, Flight va dentro de un string JS con comillas escapadas.
        expect(/:E\{"digest"|Datos no disponibles|DataAccessError/.test(body.replaceAll('\\"', '"')), `${where}: respuesta de denegacion`).toBe(true)
      }
    } finally { await auth.client.auth.signOut() }
  })
}

for (const label of ['a', 'b'] as const) {
  test(`${label}: controles positivos y aislamiento entre solicitudes`, async ({ request }) => {
    const auth = await session(label)
    try {
      const own = label === 'a' ? 'ALIGN019_OBJ_A' : 'ALIGN019_OBJ_B'
      const other = label === 'a' ? 'ALIGN019_OBJ_B' : 'ALIGN019_OBJ_A'
      const response = await request.get('/debtors?_rsc=', { headers: { Cookie: auth.cookie, RSC: '1' }, maxRedirects: 0 })
      const body = await response.text()
      expect(response.status()).toBe(200)
      expect(body.includes(own)).toBe(true)
      expect(body.includes(other)).toBe(false)
      expect(body).not.toContain('Tablas con acceso restringido o errores de lectura')
      const otherId = label === 'a' ? '9801902' : '9801901'
      const detail = await request.get(`/debtors/${otherId}?_rsc=`, { headers: { Cookie: auth.cookie, RSC: '1' }, maxRedirects: 0 })
      expect((await detail.text()).includes(other)).toBe(false)

      // Detalle propio: objeto, deuda y contactos del municipio, sin nada del otro.
      const ownId = label === 'a' ? '9801901' : '9801902'
      const [debt, foreignDebt] = label === 'a' ? [/\$\$\s101\b/, /\$\$\s202\b/] : [/\$\$\s202\b/, /\$\$\s101\b/]
      const ownDetail = await request.get(`/debtors/${ownId}?_rsc=`, { headers: { Cookie: auth.cookie, RSC: '1' }, maxRedirects: 0 })
      const detailBody = await ownDetail.text()
      expect(ownDetail.status()).toBe(200)
      expect(detailBody.includes(own)).toBe(true)
      expect(debt.test(detailBody), 'deuda propia').toBe(true)
      expect(foreignDebt.test(detailBody), 'deuda ajena').toBe(false)
      expect(detailBody.includes(`align019-${label}@example.test`), 'contacto propio').toBe(true)
      expect(detailBody.includes('align019-shared@example.test'), 'contacto de la persona compartida').toBe(true)
      expect(detailBody.includes(`align019-${label === 'a' ? 'b' : 'a'}@example.test`), 'contacto ajeno').toBe(false)
      expect(detailBody).not.toContain('Tablas con acceso restringido o errores de lectura')

      const people = await request.get('/people?_rsc=', { headers: { Cookie: auth.cookie, RSC: '1' }, maxRedirects: 0 })
      const personBody = await people.text()
      expect(personBody.includes(`ALIGN019_PERSON_${label.toUpperCase()}`)).toBe(true)
      expect(personBody.includes(`ALIGN019_PERSON_${label === 'a' ? 'B' : 'A'}`)).toBe(false)
      expect(personBody).not.toContain('Tablas con acceso restringido o errores de lectura')

      // Persona compartida: el riesgo es el de este municipio y la deuda suma solo sus objetos.
      const [risk, foreignRisk] = label === 'a' ? ['Bajo (33)', 'Alto (77)'] : ['Alto (77)', 'Bajo (33)']
      expect(personBody.includes('ALIGN019_PERSON_SHARED'), 'persona compartida visible').toBe(true)
      expect(personBody.includes(risk), `riesgo propio ${risk}`).toBe(true)
      expect(personBody.includes(foreignRisk), `riesgo ajeno ${foreignRisk}`).toBe(false)
      expect(debt.test(personBody), 'deuda de la persona compartida').toBe(true)
      expect(/\$\$\s303\b/.test(personBody), 'la deuda no suma ambos municipios').toBe(false)
    } finally { await auth.client.auth.signOut() }
  })
}

test('dos membresias: seleccion explicita revalidada y cookie ajena denegada', async ({ request }) => {
  const auth = await session('multi')
  try {
    for (const [tenant, own, other] of [['9801901', 'ALIGN019_OBJ_A', 'ALIGN019_OBJ_B'], ['9801902', 'ALIGN019_OBJ_B', 'ALIGN019_OBJ_A']]) {
      const response = await request.get('/debtors?_rsc=', { headers: { Cookie: `${auth.cookie}; equitas_tenant_id=${tenant}`, RSC: '1' }, maxRedirects: 0 })
      const body = await response.text()
      expect(response.status()).toBe(200)
      expect(body.includes(own)).toBe(true)
      expect(body.includes(other)).toBe(false)
    }
    const denied = await request.get('/debtors?_rsc=', { headers: { Cookie: `${auth.cookie}; equitas_tenant_id=9999999`, RSC: '1' }, maxRedirects: 0 })
    const body = await denied.text()
    for (const marker of markers) expect(body.includes(marker)).toBe(false)
  } finally { await auth.client.auth.signOut() }
})
