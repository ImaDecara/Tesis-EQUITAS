import { expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { readOnlyFetch } from '../../../../scripts/analitica/transport.mjs'
const origin = 'http://127.0.0.1:55321'
it('solo admite login y GET/HEAD REST, sin redirecciones', async () => {
  const network = vi.fn(async () => new Response('[]'))
  const transport = readOnlyFetch(origin, network)
  await transport(`${origin}/auth/v1/token?grant_type=password`, { method: 'POST' })
  await transport(`${origin}/rest/v1/debtor?select=id`)
  await transport(new Request(`${origin}/rest/v1/debt`, { method: 'HEAD' }))
  expect(network).toHaveBeenCalledTimes(3)
  expect(network.mock.calls.every(call => (call as unknown as [unknown, RequestInit])[1].redirect === 'error')).toBe(true)
})
it.each([
  ['/rest/v1/debt', 'POST'], ['/rest/v1/debt', 'PUT'], ['/rest/v1/debt', 'PATCH'], ['/rest/v1/debt', 'DELETE'],
  ['/rest/v1/rpc/anything', 'GET'], ['/rest/v1/rpc', 'HEAD'], ['/storage/v1/object', 'GET'], ['/auth/v1/signup', 'POST'],
  ['/auth/v1/user', 'GET'], ['/auth/v1/token?grant_type=refresh_token', 'POST'],
])('bloquea %s %s antes de red', async (path, method) => {
  const network = vi.fn()
  await expect(readOnlyFetch(origin, network)(`${origin}${path}`, { method })).rejects.toThrow('bloqueada')
  expect(network).not.toHaveBeenCalled()
})
it('no admite otro origen ni el proyecto de testing', async () => {
  expect(() => readOnlyFetch('https://testing.supabase.co')).toThrow('autorizado')
  const network = vi.fn()
  await expect(readOnlyFetch(origin, network)('https://example.org/rest/v1/debt')).rejects.toThrow('bloqueada')
  expect(network).not.toHaveBeenCalled()
})
it('el comparador usa el cargador, mapeador y preparador de la aplicación', () => {
  const code = readFileSync(new URL('../../../../scripts/analitica/run.mjs', import.meta.url), 'utf8')
  for (const modulePath of ['data/raw-debtor-loader', 'mappers/debtor-object-mapper', 'ml/features', 'ml/engine']) expect(code).toContain(`/lib/${modulePath}.ts`)
  const reader = readFileSync(new URL('../../../../scripts/analitica/reader.ts', import.meta.url), 'utf8')
  for (const name of ['resolveTenantAccessWithRoleName', 'tenantReadScope', 'loadAllTableRows']) expect(reader).toContain(name)
})
