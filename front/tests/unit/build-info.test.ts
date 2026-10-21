import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/build-info/route'

afterEach(() => vi.unstubAllEnvs())

describe('E07: procedencia del despliegue sin secretos', () => {
  it('prioriza el SHA provisto por Vercel y revela solo la referencia publica', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'a'.repeat(40))
    vi.stubEnv('QUALITY_SOURCE_SHA', 'b'.repeat(40))
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://iylwghgvtydpmwidojdo.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'private-value-not-in-response')
    const response = GET()
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ sourceSha: 'a'.repeat(40), environment: 'preview', supabaseProjectRef: 'iylwghgvtydpmwidojdo' })
  })

  it.each(['', 'invalid-url', 'https://example.test'])('rechaza destino Supabase ausente o ajeno: %s', async url => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', undefined)
    vi.stubEnv('QUALITY_SOURCE_SHA', undefined)
    vi.stubEnv('VERCEL_ENV', undefined)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', url)
    expect(await GET().json()).toEqual({ sourceSha: null, environment: 'local', supabaseProjectRef: null })
  })

  it('permite identificar la version en una comprobacion local declarada', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', undefined)
    vi.stubEnv('QUALITY_SOURCE_SHA', 'b'.repeat(40))
    expect((await GET().json()).sourceSha).toBe('b'.repeat(40))
  })
})
