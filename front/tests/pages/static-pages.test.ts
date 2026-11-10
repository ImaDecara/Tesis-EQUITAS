import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children }))

import GlobalLoading from '@/app/loading'
import LoginPage from '@/app/login/page'
import NotFound from '@/app/not-found'
import { validateLoginFields } from '@/components/auth/login-form'
import { textFromReactTree } from '@/tests/helpers/react-tree'

describe('pantallas estaticas', () => {
  it('presenta la pagina de ingreso y limita el destino a rutas internas', async () => {
    const safePage = await LoginPage({ searchParams: Promise.resolve({ next: '/people' }) })
    const unsafePage = await LoginPage({ searchParams: Promise.resolve({ next: 'https://example.com' }) })

    expect(textFromReactTree(safePage)).toContain('Iniciar sesión')
    expect(textFromReactTree(safePage)).toContain('Ingresá con el correo y la contraseña')
    expect(textFromReactTree(unsafePage)).toContain('Iniciar sesión')
    // El destino viaja al formulario: una URL externa se reemplaza por el tablero.
    const nextOf = (node: unknown): string[] => {
      if (Array.isArray(node)) return node.flatMap(nextOf)
      if (!node || typeof node !== 'object' || !('props' in node)) return []
      const props = (node as { props: { nextPath?: string; children?: unknown } }).props
      return [...(props.nextPath ? [props.nextPath] : []), ...nextOf(props.children)]
    }
    expect(nextOf(safePage)).toEqual(['/people'])
    expect(nextOf(unsafePage)).toEqual(['/'])
  })

  // N7 (H15): la primera impresión no muestra cifras inventadas ni rótulos en inglés.
  it('el ingreso no muestra cifras inventadas', async () => {
    const text = textFromReactTree(await LoginPage({ searchParams: Promise.resolve({}) }))
    expect(text).not.toMatch(/\b186\b|\b176\b|\$\s*99M|\d+%/)
    expect(text).not.toMatch(/Dashboard|Password|Email\b|ilustrativ/)
  })

  it('valida el ingreso en español, sin depender del idioma del navegador', () => {
    expect(validateLoginFields('', '')).toEqual({ email: 'Ingresá tu correo.', password: 'Ingresá tu contraseña.' })
    expect(validateLoginFields('sin-arroba', 'x')).toEqual({ email: 'Revisá el correo: falta la arroba o el dominio.' })
    expect(validateLoginFields(' persona@example.test ', 'x')).toEqual({})
  })

  it('presenta los estados globales de carga y recurso inexistente', () => {
    const loadingText = textFromReactTree(GlobalLoading())
    const notFoundText = textFromReactTree(NotFound())

    // N7: el estado «cargando» se anuncia a lectores de pantalla.
    expect(loadingText.trim()).toBe('Cargando…')
    expect(notFoundText).toContain('No encontramos ese caso')
    expect(notFoundText).toContain('Ir a Casos')
  })
})
