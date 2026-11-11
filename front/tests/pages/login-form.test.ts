import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ACCESS_MESSAGES } from '@/lib/auth/tenant-access'
import { hostElements } from '@/tests/helpers/hook-runtime'
import { renderedText } from '@/tests/helpers/viewer-fixtures'

// Noche 7. Ingreso en español: «Correo», «Contraseña», validaciones propias y los rechazos de acceso
// tal cual vienen de ACCESS_MESSAGES. Sin DOM: estado y efectos simulados, manejadores reales.
const state = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => unknown)[] }))
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>()
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = state.cursor++
      if (!(index in state.slots)) state.slots[index] = initial
      return [state.slots[index], (value: unknown) => { state.slots[index] = value }]
    },
    // Dependencias estables en esta prueba: el efecto corre una vez, como al montar.
    useEffect: (effect: () => unknown) => {
      const index = state.cursor++
      if (!(index in state.slots)) { state.slots[index] = true; state.effects.push(effect) }
    },
  }
})
const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
const auth = vi.hoisted(() => ({ signInWithPassword: vi.fn(), signOutCurrentSession: vi.fn(), validateCurrentUserTenantAccess: vi.fn() }))
vi.mock('@/lib/services/auth-service', async original => ({ ...(await original<typeof import('@/lib/services/auth-service')>()), ...auth }))

import { LoginForm } from '@/components/auth/login-form'

function render() {
  state.cursor = 0
  return LoginForm({ nextPath: '/people' }) as ReactNode
}
const find = (tree: ReactNode, type: string, id?: string) => hostElements(tree).find(node => node.type === type && (!id || node.props.id === id))!

async function readyForm() {
  auth.validateCurrentUserTenantAccess.mockResolvedValueOnce({ isAuthorized: false, requiresLogin: true, code: 'AUTH_REQUIRED' })
  expect(renderedText(render())).toBe('Validando sesión…')
  await Promise.all(state.effects.splice(0).map(effect => effect()))
  return render()
}

// `access` es la respuesta de la comprobación que sigue al ingreso (la primera es la de la sesión previa).
async function submit(email: string, password: string, access?: unknown) {
  const tree = await readyForm()
  if (access) auth.validateCurrentUserTenantAccess.mockResolvedValueOnce(access)
  ;(find(tree, 'input', 'email').props.onChange as (event: unknown) => void)({ target: { value: email } })
  ;(find(tree, 'input', 'password').props.onChange as (event: unknown) => void)({ target: { value: password } })
  const form = find(render(), 'form')
  await (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault: () => undefined })
  return render()
}

beforeEach(() => {
  vi.clearAllMocks()
  state.slots.length = 0
  state.effects.length = 0
})

describe('formulario de ingreso', () => {
  it('rotula «Correo» y «Contraseña», valida en español y no envía campos vacíos', async () => {
    const tree = await submit('', '')
    const text = renderedText(tree)
    expect(text).toContain('Correo')
    expect(text).toContain('Contraseña')
    expect(text).toContain('Iniciar sesión')
    expect(text).toContain('Ingresá tu correo.')
    expect(text).toContain('Ingresá tu contraseña.')
    expect(text).not.toMatch(/Email|Password|sesion\b/)
    expect(find(tree, 'form').props.noValidate).toBe(true)
    expect(find(tree, 'input', 'email').props['aria-invalid']).toBe(true)
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it('credenciales rechazadas: «Correo o contraseña incorrectos.»', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    const text = renderedText(await submit('persona@example.test', 'clave-de-prueba'))
    expect(auth.signInWithPassword).toHaveBeenCalledWith('persona@example.test', 'clave-de-prueba')
    expect(text).toContain('Correo o contraseña incorrectos.')
  })

  it('cuenta sin acceso: muestra el mensaje de acceso tal cual y cierra la sesión', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null })
    const denied = { isAuthorized: false, requiresLogin: false, code: 'TENANT_ACCESS_NOT_FOUND', message: ACCESS_MESSAGES.TENANT_ACCESS_NOT_FOUND }
    const text = renderedText(await submit('persona@example.test', 'clave-de-prueba', denied))
    expect(text).toContain(ACCESS_MESSAGES.TENANT_ACCESS_NOT_FOUND)
    expect(auth.signOutCurrentSession).toHaveBeenCalledOnce()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('con acceso va al destino pedido; con varios municipios, a elegir uno', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null })
    await submit('persona@example.test', 'clave-de-prueba', { isAuthorized: true, requiresLogin: false })
    expect(router.replace).toHaveBeenCalledWith('/people')
    vi.clearAllMocks()
    state.slots.length = 0
    state.effects.length = 0
    auth.validateCurrentUserTenantAccess.mockResolvedValueOnce({ isAuthorized: false, requiresLogin: false, code: 'TENANT_SELECTION_REQUIRED' })
    render()
    await Promise.all(state.effects.splice(0).map(effect => effect()))
    expect(router.replace).toHaveBeenCalledWith('/select-tenant')
  })
})
