import { createServerClient } from '@supabase/ssr'
import { expect, test } from '@playwright/test'
import { readLocalDalConfig, type Label } from './config'

const config = readLocalDalConfig()
const markers = ['ALIGN019_OBJ_A', 'ALIGN019_OBJ_B', 'ALIGN019_PERSON_A', 'ALIGN019_PERSON_B', 'align019-a@example.test', 'align019-b@example.test']
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

for (const label of ['anonymous', 'none', 'inactive', 'multi'] as const) {
  test(`${label}: HTML y RSC directos no entregan cartera`, async ({ request }) => {
    const auth = label === 'anonymous' ? null : await session(label)
    try {
      for (const route of routes) for (const rsc of [false, true]) {
        const response = await request.get(route, {
          headers: { ...(auth ? { Cookie: auth.cookie } : {}), ...(rsc ? { RSC: '1' } : {}) },
          // Next 16 valida el cache-buster RSC; sin headers de router su hash es vacio.
          params: rsc ? { _rsc: '' } : undefined,
          maxRedirects: 0,
        })
        const body = await response.text()
        for (const marker of markers) expect(body.includes(marker), `${label} ${route} RSC=${rsc}: ${marker}`).toBe(false)
        // Un 404 o una pagina vacia no acredita una denegacion de autorizacion.
        expect(response.status() >= 500 || [401, 403].includes(response.status()) || /:E\{"digest"|Datos no disponibles|DataAccessError/.test(body), `${route}: respuesta de denegacion`).toBe(true)
      }
    } finally { await auth?.client.auth.signOut() }
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
      const people = await request.get('/people?_rsc=', { headers: { Cookie: auth.cookie, RSC: '1' }, maxRedirects: 0 })
      const personBody = await people.text()
      expect(personBody.includes(`ALIGN019_PERSON_${label.toUpperCase()}`)).toBe(true)
      expect(personBody.includes(`ALIGN019_PERSON_${label === 'a' ? 'B' : 'A'}`)).toBe(false)
      expect(personBody).not.toContain('Tablas con acceso restringido o errores de lectura')
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
