import { describe, expect, it } from 'vitest'

import GlobalLoading from '@/app/loading'
import LoginPage from '@/app/login/page'
import NotFound from '@/app/not-found'
import { textFromReactTree } from '@/tests/helpers/react-tree'

describe('pantallas estaticas', () => {
  it('presenta la pagina de login y limita el destino a rutas internas', async () => {
    const safePage = await LoginPage({ searchParams: Promise.resolve({ next: '/people' }) })
    const unsafePage = await LoginPage({ searchParams: Promise.resolve({ next: 'https://example.com' }) })

    expect(textFromReactTree(safePage)).toContain('Acceso institucional')
    expect(textFromReactTree(safePage)).toContain('Dashboard Ejecutivo')
    expect(textFromReactTree(unsafePage)).toContain('Iniciar sesion')
  })

  it('presenta los estados globales de carga y recurso inexistente', () => {
    const loadingText = textFromReactTree(GlobalLoading())
    const notFoundText = textFromReactTree(NotFound())

    expect(loadingText.trim()).toBe('')
    expect(notFoundText).toContain('Objeto de deuda no encontrado')
    expect(notFoundText).toContain('Volver al listado')
  })
})
