import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import DataError from '@/app/error'
import TenantSelectionPage from '@/app/select-tenant/page'
import { labels, readLocalDalConfig } from '@/tests/local-dal/config'

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/components/auth/auth-provider', () => ({ useAuthState: () => ({ refreshAuthState: vi.fn() }) }))

const directories: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

function configFile(overrides: Record<string, unknown> = {}) {
  const directory = mkdtempSync('/tmp/align019-config-test-')
  directories.push(directory)
  const path = `${directory}/config.json`
  const config = { supabaseUrl: 'http://127.0.0.1:54321', publishableKey: 'sb_publishable_fixture',
    accounts: Object.fromEntries(labels.map(label => [label, { email: `${label}@example.test`, password: 'fixture-no-network' }])), ...overrides }
  writeFileSync(path, JSON.stringify(config), { mode: 0o600 })
  vi.stubEnv('EQUITAS_DAL_LOCAL_CONFIG', path)
  return path
}

describe('ALIGN-019: fronteras de entrada y prueba local segura', () => {
  it('el estado de error no serializa mensajes, datos ni ceros de cartera', () => {
    const markup = renderToStaticMarkup(createElement(DataError, { error: new Error('DATO_PRIVADO'), retry: vi.fn() }))
    expect(markup).toContain('Datos no disponibles')
    expect(markup).not.toContain('DATO_PRIVADO')
    expect(markup).not.toContain('$0')
    expect(markup).toContain('Volver al ingreso')
  })

  it('la seleccion inicial no autoriza ni elige un municipio automaticamente', () => {
    const markup = renderToStaticMarkup(createElement(TenantSelectionPage))
    expect(markup).toContain('Verificando acceso')
    expect(markup).not.toContain('<option')
    expect(markup).not.toContain('Dashboard')
  })

  it('la prueba real exige configuracion, sin omitir casos', () => {
    vi.stubEnv('EQUITAS_DAL_LOCAL_CONFIG', '')
    expect(readLocalDalConfig).toThrow('no se omite')
  })

  it('acepta exclusivamente la configuracion sintetica privada local', () => {
    configFile()
    expect(readLocalDalConfig().supabaseUrl).toBe('http://127.0.0.1:54321')
  })

  it.each([
    { supabaseUrl: 'https://otro.example.test' },
    { publishableKey: 'sb_secret_no_es_una_clave' },
    { accounts: {} },
    { supabaseUrl: 'https://folyslqzqvnpolexcxjo.supabase.co' },
  ])('rechaza configuracion no autorizada antes de conectar: %j', overrides => {
    configFile(overrides)
    expect(readLocalDalConfig).toThrow()
  })

  it('rechaza archivos legibles por otros usuarios y variables remotas heredadas', () => {
    const path = configFile()
    chmodSync(path, 0o644)
    expect(readLocalDalConfig).toThrow('0600')
    chmodSync(path, 0o600)
    vi.stubEnv('SUPABASE_URL', 'https://iylwghgvtydpmwidojdo.supabase.co')
    expect(readLocalDalConfig).toThrow('remota rechazada')
  })
})
