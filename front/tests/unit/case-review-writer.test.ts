import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createCaseReviewWriter } from '@/lib/server/case-review-writer'

vi.mock('@/lib/supabase-config', () => ({
  hasSupabaseCredentials: true, supabaseUrl: 'https://writer.example.test', supabasePublishableKey: 'clave-publicable-sintetica',
}))

const FRONT = fileURLToPath(new URL('../..', import.meta.url))
const part = (claims: unknown) => Buffer.from(JSON.stringify(claims)).toString('base64url')
const jwt = (role: unknown) => `${part({ alg: 'HS256' })}.${part({ role })}.firma-sintetica`

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap(entry => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry) ? [path] : []
  })
}
const runtimeFiles = [...['app', 'components', 'lib'].flatMap(root => sources(join(FRONT, root))), join(FRONT, 'proxy.ts')]
  .map(path => ({ path: relative(FRONT, path), source: readFileSync(path, 'utf8') }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('ALIGN-020: credencial de escritura', () => {
  it('sin credencial no hay cliente', () => {
    vi.stubEnv('EQUITAS_REVIEW_SERVER_JWT', '')
    expect(createCaseReviewWriter()).toBeNull()
  })

  it.each([
    ['otro rol de servidor', jwt('equitas_import_server')],
    ['service_role, que abriria toda la base', jwt('service_role')],
    ['sesion de usuario', jwt('authenticated')],
    ['sin rol', `${part({})}.${part({})}.firma`],
    ['no es un JWT', 'clave-sintetica-sin-formato-jwt'],
    ['payload ilegible', 'a.%%%.c'],
    ['payload nulo', `${part({})}.${part(null)}.firma`],
  ])('rechaza %s', (_name, token) => {
    vi.stubEnv('EQUITAS_REVIEW_SERVER_JWT', token)
    expect(createCaseReviewWriter()).toBeNull()
  })

  it('envia la credencial solo como Authorization, con la clave publicable como apikey, y llama a la funcion', async () => {
    const token = jwt('equitas_review_server')
    vi.stubEnv('EQUITAS_REVIEW_SERVER_JWT', token)
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ review_id: 1, created: true, pending_supervisor: false }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const writer = createCaseReviewWriter()
    expect(writer).not.toBeNull()
    await expect(writer!.rpc('record_case_review', { p_tenant: '1' })).resolves.toMatchObject({ error: null, data: { review_id: 1 } })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string | URL, RequestInit]
    expect(String(url)).toBe('https://writer.example.test/rest/v1/rpc/record_case_review')
    const headers = new Headers(init.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${token}`)
    expect(headers.get('apikey')).toBe('clave-publicable-sintetica')
    expect(String(init.body)).not.toContain(token)
  })
})

describe('ALIGN-020: frontera del codigo', () => {
  it('recorre el codigo de la aplicacion, no una lista vacia', () => {
    expect(runtimeFiles.map(file => file.path)).toEqual(expect.arrayContaining([
      'app/debtors/[debtorId]/actions.ts', 'lib/server/case-review-writer.ts', 'lib/server/case-review-service.ts', 'lib/server/case-review-snapshot.ts',
    ]))
  })

  it('solo el escritor lee la credencial y ningun archivo la publica', () => {
    const readers = runtimeFiles.filter(file => file.source.includes('EQUITAS_REVIEW_SERVER_JWT')).map(file => file.path)
    expect(readers).toEqual(['lib/server/case-review-writer.ts'])
    expect(runtimeFiles.filter(file => /NEXT_PUBLIC_[A-Z_]*(?:REVIEW|JWT|SERVICE|SECRET)/.test(file.source))).toEqual([])
    expect(readFileSync(join(FRONT, 'next.config.ts'), 'utf8')).not.toContain('EQUITAS_REVIEW')
  })

  it.each(['lib/server/case-review-writer.ts', 'lib/server/case-review-service.ts', 'lib/server/case-review-snapshot.ts'])('%s exige servidor', path => {
    expect(runtimeFiles.find(file => file.path === path)?.source.startsWith("import 'server-only'")).toBe(true)
  })

  it('ningun componente cliente importa el escritor, el servicio ni la instantanea', () => {
    const clients = runtimeFiles.filter(file => /^\s*['"]use client['"]/m.test(file.source))
    expect(clients.length).toBeGreaterThan(0)
    expect(clients.filter(file => /case-review-(?:writer|service|snapshot)/.test(file.source))).toEqual([])
  })

  it('el archivo de acciones es de servidor, delega y no conoce la credencial ni las funciones de la base', () => {
    const actions = runtimeFiles.find(file => file.path === 'app/debtors/[debtorId]/actions.ts')!.source
    expect(actions.startsWith("'use server'")).toBe(true)
    expect(actions).not.toMatch(/process\.env|\.rpc\(|createClient/)
    expect([...actions.matchAll(/^export (?!async function )(?!type )/gm)]).toEqual([])
  })

  it('la unica via de escritura son las funciones de ALIGN-018: nada de insert directo', () => {
    const service = runtimeFiles.filter(file => file.path.startsWith('lib/server/case-review')).map(file => file.source).join('\n')
      .replaceAll(/createHash\('sha256'\)\.update\(/g, 'hash(')
    expect(service).not.toMatch(/\.(?:insert|update|upsert|delete)\(/)
    expect([...service.matchAll(/\.rpc\('([a-z_]+)'/g)].map(match => match[1]).sort()).toEqual(['record_case_review', 'record_case_review_approval'])
  })

  it('el servicio no devuelve el mensaje crudo de la base ni usa service_role', () => {
    const service = runtimeFiles.find(file => file.path === 'lib/server/case-review-service.ts')!.source
    expect(service).not.toMatch(/service_role|SERVICE_ROLE|console\./)
    expect(service).not.toMatch(/message:\s*error\.message/)
  })
})
