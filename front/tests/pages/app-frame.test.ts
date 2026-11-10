import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ pathname: '/pending', viewer: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }))
vi.mock('next/image', () => ({ default: () => null }))
// La sesión del navegador y el cierre de sesión tienen sus propias pruebas.
vi.mock('@/components/auth/auth-guard', () => ({ AuthGuard: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/layout/logout-button', () => ({ LogoutButton: () => null }))
vi.mock('@/lib/server/viewer-context', () => ({ loadViewerContext: nav.viewer }))

import { AppFrame, ContextLine, NAV_SECTIONS, portfolioLabel } from '@/components/layout/app-frame'
import { AppShell } from '@/components/layout/app-shell'
import { markupOf, renderedText, viewerFixture } from '@/tests/helpers/viewer-fixtures'
import type { ViewerContext } from '@/lib/server/viewer-context'

// Noche 7. Marco único: un solo menú y la línea fija con municipio, fecha de la cartera y persona.

const ITEMS = NAV_SECTIONS.flatMap(section => section.items)
const frame = (viewer: ViewerContext | null = viewerFixture()) => markupOf(createElement(AppFrame, { viewer } as Parameters<typeof AppFrame>[0], createElement('p', null, 'Contenido de la página')))
const menuLinks = (markup: string) => {
  const menu = markup.match(/<nav id="menu-principal"[\s\S]*?<\/nav>/)?.[0] ?? ''
  return [...menu.matchAll(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(match => [match[1], match[2].replace(/<[^>]*>/g, '').trim()])
}

beforeEach(() => {
  nav.pathname = '/pending'
  nav.viewer.mockReset()
})

describe('fecha de la cartera en la línea de contexto', () => {
  it.each([
    ['sin sesión verificada', null, 'Cartera: no disponible'],
    ['cartera cargada', viewerFixture('USER', { kind: 'LOADED', asOf: '2026-09-30' }), 'Cartera al 30/9/2026'],
    ['municipio sin cartera', viewerFixture('ADMIN', { kind: 'EMPTY' }), 'Sin cartera cargada'],
    ['lectura fallida', viewerFixture('ADMIN', { kind: 'UNAVAILABLE' }), 'Fecha de la cartera no disponible'],
  ] as const)('%s → %s', (_name, viewer, label) => {
    expect(portfolioLabel(viewer)).toBe(label)
  })
})

describe('ContextLine', () => {
  it('con contexto: municipio, fecha y persona con su rol', () => {
    const text = renderedText(createElement(ContextLine, { viewer: viewerFixture('USER') }))
    expect(text).toBe('Municipio sintético Cartera al 30/9/2026 Persona sintética USER · Usuario')
  })

  it('sin nombre ni municipio no inventa datos', () => {
    const viewer = { ...viewerFixture('ADMIN', { kind: 'EMPTY' }), userName: null, tenantName: null }
    expect(renderedText(createElement(ContextLine, { viewer }))).toBe('Municipio no disponible Sin cartera cargada Cuenta sin nombre · Administrador')
  })

  it('sin contexto lo dice', () => {
    const markup = markupOf(createElement(ContextLine, { viewer: null }))
    expect(markup).toContain('aria-label="Contexto de trabajo"')
    expect(renderedText(createElement(ContextLine, { viewer: null }))).toBe('Municipio no disponible Cartera: no disponible Sesión no verificada')
  })
})

describe('menú', () => {
  it('tiene las entradas de la noche 7 y ningún destino repetido', () => {
    const labels = ITEMS.map(item => item.label)
    for (const label of ['Tablero', 'Casos', 'Grupos de trabajo', 'Pendientes', 'Casos sin contacto', 'Personas', 'Deuda y mora', 'Puntaje de prioridad', 'Acciones recomendadas', 'Cargar CSV', 'Reportes', 'Ayuda']) {
      expect(labels, label).toContain(label)
    }
    expect(new Set(ITEMS.map(item => item.href)).size).toBe(ITEMS.length)
    expect(new Set(labels).size).toBe(labels.length)
    expect(ITEMS.find(item => item.label === 'Cargar CSV')?.href).toBe('/import')
    expect(ITEMS.find(item => item.label === 'Pendientes')?.href).toBe('/pending')
    expect(ITEMS.find(item => item.label === 'Reportes')?.href).toBe('/reports')
    expect(ITEMS.find(item => item.label === 'Ayuda')?.href).toBe('/help')
    expect(labels.join(' ')).not.toMatch(/supervisor|operador|cola|severidad/i)
  })

  it('ADMIN y USER ven el mismo menú: lo que no pueden hacer se explica en la pantalla', () => {
    const admin = menuLinks(frame(viewerFixture('ADMIN')))
    expect(admin).toEqual(ITEMS.map(item => [item.href, item.label]))
    expect(menuLinks(frame(viewerFixture('USER')))).toEqual(admin)
    expect(menuLinks(frame(null))).toEqual(admin)
  })

  it('marca la página actual en los dos menús, y el Tablero solo en la raíz', () => {
    const current = () => [...frame().matchAll(/<a [^>]*>/g)].map(match => match[0])
      .filter(tag => tag.includes('aria-current="page"')).map(tag => tag.match(/href="([^"]*)"/)?.[1])
    nav.pathname = '/pending'
    expect(current()).toEqual(['/pending', '/pending'])
    nav.pathname = '/debtors/99'
    expect(current()).toEqual(['/debtors', '/debtors'])
    nav.pathname = '/'
    expect(current()).toEqual(['/', '/'])
  })

  it('«Saltar al contenido» lleva al contenido principal, que incluye la página', () => {
    const markup = frame()
    expect(markup.indexOf('Saltar al contenido')).toBeLessThan(markup.indexOf('menu-principal'))
    expect(markup).toMatch(/<a href="#contenido"[^>]*>\s*Saltar al contenido\s*<\/a>/)
    expect(markup).toMatch(/<main id="contenido"[^>]*><p>Contenido de la página<\/p><\/main>/)
    expect(markup).toContain('data-context-line')
  })
})

describe('AppShell', () => {
  it('pasa al marco el contexto leído en el servidor', async () => {
    const viewer = viewerFixture('USER')
    nav.viewer.mockResolvedValue(viewer)
    const element = await AppShell({ children: 'hijo' }) as unknown as { type: unknown; props: { viewer: unknown; children: unknown } }
    expect(element.type).toBe(AppFrame)
    expect(element.props).toEqual({ viewer, children: 'hijo' })
    expect(nav.viewer).toHaveBeenCalledOnce()
  })

  it('sin contexto, el marco igual se entrega y lo dice', async () => {
    nav.viewer.mockResolvedValue(null)
    const element = await AppShell({ children: 'hijo' })
    expect(renderedText(element)).toContain('Sesión no verificada')
  })
})
