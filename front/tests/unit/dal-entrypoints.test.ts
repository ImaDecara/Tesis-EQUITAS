import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { createElement, isValidElement, type ComponentType, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import DataError from '@/app/error'
import TenantSelectionPage from '@/app/select-tenant/page'
import { labels, readLocalDalConfig } from '@/tests/local-dal/config'

const serverJwt = (role: string) => `a.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.firma`

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/components/auth/auth-provider', () => ({ useAuthState: () => ({ refreshAuthState: vi.fn() }) }))
const { signOutCurrentSession } = vi.hoisted(() => ({ signOutCurrentSession: vi.fn() }))
vi.mock('@/lib/services/auth-service', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/services/auth-service')>(), signOutCurrentSession,
}))

const directories: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

function configFile(overrides: Record<string, unknown> = {}) {
  const directory = mkdtempSync('/tmp/align019-config-test-')
  directories.push(directory)
  const path = `${directory}/config.json`
  const config = { supabaseUrl: 'http://127.0.0.1:54321', publishableKey: 'sb_publishable_fixture', reviewServerJwt: serverJwt('equitas_review_server'),
    accounts: Object.fromEntries(labels.map(label => [label, { email: `${label}@example.test`, password: 'fixture-no-network' }])), ...overrides }
  writeFileSync(path, JSON.stringify(config), { mode: 0o600 })
  vi.stubEnv('EQUITAS_DAL_LOCAL_CONFIG', path)
  return path
}

type ButtonProps = { children?: ReactNode; onClick?: () => unknown }
function button(node: ReactNode, label: string): ReactElement<ButtonProps> | null {
  if (Array.isArray(node)) return node.map(child => button(child, label)).find(Boolean) ?? null
  if (!isValidElement<ButtonProps>(node)) return null
  return node.type === 'button' && node.props.children === label ? node : button(node.props.children, label)
}

describe('ALIGN-019: fronteras de entrada y prueba local segura', () => {
  it('el estado de error no serializa mensajes, datos ni ceros de cartera', () => {
    // Next le pasa estas props; la pantalla no las usa, asi que el mensaje no puede salir.
    const asNextRendersIt = DataError as ComponentType<{ error: unknown; retry: () => void }>
    const markup = renderToStaticMarkup(createElement(asNextRendersIt, { error: new Error('DATO_PRIVADO'), retry: vi.fn() }))
    expect(markup).toContain('Datos no disponibles')
    expect(markup).not.toContain('DATO_PRIVADO')
    expect(markup).not.toContain('$0')
    expect(markup).toContain('Volver al ingreso')
    expect(markup).toContain('Cerrar sesión')
  })

  it('M2: Cerrar sesión cierra la sesion y recarga; proxy lleva al ingreso. Sin red no queda atrapado', async () => {
    const reload = vi.fn()
    vi.stubGlobal('window', { location: { reload } })
    const page = DataError()
    signOutCurrentSession.mockResolvedValue(undefined)
    button(page, 'Cerrar sesión')?.props.onClick?.()
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(signOutCurrentSession).toHaveBeenCalledOnce()
    signOutCurrentSession.mockRejectedValue(new Error('sin red'))
    button(page, 'Cerrar sesión')?.props.onClick?.()
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(2))
  })

  it('M3: Intentar nuevamente recarga el documento, sin depender del estado de Auth del navegador', () => {
    const reload = vi.fn()
    vi.stubGlobal('window', { location: { reload } })
    button(DataError(), 'Intentar nuevamente')?.props.onClick?.()
    expect(reload).toHaveBeenCalledOnce()
    expect(signOutCurrentSession).not.toHaveBeenCalled()
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
    { reviewServerJwt: serverJwt('service_role') },
    { reviewServerJwt: 'no-es-un-jwt' },
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
