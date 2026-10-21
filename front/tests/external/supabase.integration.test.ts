import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it } from 'vitest'

import { loadAllTableRows } from '@/lib/data/paginated-table-reader'
import { validateAuthUserTenantAccess } from '@/lib/services/auth-service'
import fixture from '../../../quality/supabase-testing.json'

type Label = 'a' | 'b' | 'none' | 'inactive'
const config = JSON.parse(process.env.SUPABASE_TEST_CONFIG!) as {
  url: string; publishableKey: string; accounts: Record<Label, { email: string; password: string }>
}
const clients: SupabaseClient[] = []

function client() {
  const sdk = createClient(config.url, config.publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) },
  })
  clients.push(sdk)
  return sdk
}

async function login(label: Label) {
  const sdk = client()
  const { data, error } = await sdk.auth.signInWithPassword(config.accounts[label])
  // Nunca incluir el objeto session/JWT ni credenciales en los reportes.
  expect(error?.code ?? null, `Auth ${label}`).toBeNull()
  expect(data.user?.id).toBeTruthy()
  return { sdk, userId: data.user!.id }
}

async function ids(sdk: SupabaseClient, table: string) {
  const { data, error } = await sdk.from(table).select('id').order('id')
  expect(error?.code ?? null, `SELECT ${table}`).toBeNull()
  return (data ?? []).map(row => row.id)
}

async function noBusiness(sdk: SupabaseClient) {
  for (const table of [...fixture.business_tables, 'tenant', ...fixture.catalog_tables]) {
    expect(await ids(sdk, table), `${table}: cero filas sin membresia activa`).toEqual([])
  }
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map(sdk => sdk.auth.signOut()))
})

describe('E06: Supabase Auth y Data API reales con clave publicable y JWT ordinario', () => {
  it.each(['a', 'b'] as const)('SUP-AUTH-01: contexto productivo esperado del usuario %s', async label => {
    const { sdk, userId } = await login(label)
    expect(await validateAuthUserTenantAccess(userId, sdk)).toEqual({
      isAuthorized: true, requiresLogin: false,
      context: { authUserId: userId, appUserId: String(fixture.app_users[label]),
        tenantId: String(fixture.tenants[label]), role: String(fixture.role) },
    })
    expect(await ids(sdk, 'user')).toEqual([fixture.app_users[label]])
    expect(await ids(sdk, 'tenant_user')).toEqual([fixture.app_users[label]])
  })

  it('SUP-AUTH-02: password incorrecto no crea sesion ni permite leer negocio', async () => {
    const sdk = client()
    const { data, error } = await sdk.auth.signInWithPassword({
      email: config.accounts.a.email, password: 'incorrect-password-for-negative-case',
    })
    expect(error?.code).toBe('invalid_credentials')
    expect(data.session).toBeNull()
    await noBusiness(sdk)
  })

  it.each(['a', 'b'] as const)('SUP-DATA-02: filas, montos y riesgos conocidos de %s mediante lector productivo', async label => {
    const { sdk } = await login(label)
    for (const table of fixture.business_tables) {
      const result = await loadAllTableRows(table, sdk)
      expect(result.warning, table).toBeNull()
      expect(result.rows.map(row => row.id), table).toEqual(fixture.row_ids[label])
    }
    const debt = await sdk.from('debt').select('current_amount').single()
    expect(debt.error).toBeNull()
    expect(debt.data?.current_amount).toBe(fixture.amounts[label])
    const risk = await sdk.from('debtor_profile_detail').select('risk_value').single()
    expect(risk.error).toBeNull()
    expect(risk.data?.risk_value).toBe(fixture.risk[label])
    for (const table of fixture.catalog_tables) expect(await ids(sdk, table), table).toEqual([910001])
  })

  it('SUP-RLS-01: anonimo recibe cero filas de todas las tablas', async () => {
    const sdk = client()
    await noBusiness(sdk)
    expect(await ids(sdk, 'user')).toEqual([])
    expect(await ids(sdk, 'tenant_user')).toEqual([])
  })

  it('SUP-RLS-02: identidad normal sin membresia recibe cero filas de negocio', async () => {
    const { sdk, userId } = await login('none')
    expect(await validateAuthUserTenantAccess(userId, sdk)).toMatchObject({
      isAuthorized: false, code: 'TENANT_ACCESS_NOT_FOUND',
    })
    await noBusiness(sdk)
    expect(await ids(sdk, 'user')).toEqual([fixture.app_users.none])
    expect(await ids(sdk, 'tenant_user')).toEqual([])
  })

  it.each([
    ['SUP-RLS-03', 'a', 'b'], ['SUP-RLS-04', 'b', 'a'],
  ] as const)('%s: usuario %s no puede consultar IDs del tenant %s', async (_id, owner, other) => {
    const { sdk } = await login(owner)
    for (const table of fixture.business_tables) {
      const result = await sdk.from(table).select('id').eq('id', fixture.row_ids[other][0])
      expect(result.error?.code ?? null, table).toBeNull()
      expect(result.data, table).toEqual([])
    }
    expect(await ids(sdk, 'tenant')).toEqual([fixture.tenants[owner]])
  })

  it('SUP-RLS-05: membresia inactiva permite diagnostico propio y niega negocio', async () => {
    const { sdk, userId } = await login('inactive')
    expect(await validateAuthUserTenantAccess(userId, sdk)).toMatchObject({
      isAuthorized: false, code: 'TENANT_ACCESS_INACTIVE',
    })
    expect(await ids(sdk, 'user')).toEqual([fixture.app_users.inactive])
    expect(await ids(sdk, 'tenant_user')).toEqual([fixture.app_users.inactive])
    await noBusiness(sdk)
  })

  it('SUP-AUTH-03: logout elimina sesion del cliente y la siguiente lectura queda anonima', async () => {
    const { sdk } = await login('a')
    expect(await ids(sdk, 'debtor')).toEqual(fixture.row_ids.a)
    const logout = await sdk.auth.signOut()
    expect(logout.error).toBeNull()
    expect((await sdk.auth.getSession()).data.session).toBeNull()
    expect((await sdk.auth.getUser()).data.user).toBeNull()
    await noBusiness(sdk)
    // No afirma revocacion inmediata de un access token previamente copiado.
  })

  it('SUP-WRITE-01: cliente normal no puede insertar, actualizar ni borrar negocio', async () => {
    const { sdk } = await login('a')
    const attempts = [
      await sdk.from('debtor').insert({ id: 919999, tenant: 910001, external_id: 919999 }),
      await sdk.from('debtor').update({ description: 'Cambio no permitido' }).eq('id', 910001),
      await sdk.from('debtor').delete().eq('id', 910001),
    ]
    for (const result of attempts) expect(result.error?.code).toBe('42501')
    expect(await ids(sdk, 'debtor')).toEqual(fixture.row_ids.a)
    expect((await sdk.from('debtor').select('description').single()).data?.description).toBe('Objeto A sintetico')
  })
})
