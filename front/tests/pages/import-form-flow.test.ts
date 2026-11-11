import { readFileSync } from 'node:fs'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => ({ type: 'a', props: { href, children }, $$typeof: Symbol.for('react.transitional.element') }) }))
vi.mock('react', async original => {
  const { hookRuntime } = await import('@/tests/helpers/hook-runtime')
  return { ...await original<typeof import('react')>(), useState: hookRuntime.useState }
})

import { ImportForm, submitLot } from '@/components/import/import-form'
import { hookRuntime, hostElements, type HostElement } from '@/tests/helpers/hook-runtime'

// Noche 7. El formulario de «Cargar CSV» con el `fetch` del navegador simulado: qué se envía (y qué no),
// cómo se reconoce cada archivo y qué ve la persona según la respuesta.

const EXAMPLE = new URL('../../public/ejemplos/carga-csv/1-cartera-2026-09-30/', import.meta.url)
const csv = (name: 'cabecera' | 'detalle', fileName = `${name}.csv`) => new File([readFileSync(new URL(`${name}.csv`, EXAMPLE))], fileName, { type: 'text/csv' })
const HASH = 'd'.repeat(64)

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
const sentForm = (fetchMock: ReturnType<typeof respond>) => (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData

afterEach(() => { vi.unstubAllGlobals() })

describe('submitLot', () => {
  it('envía fecha y los dos archivos por su tipo a la ruta propia; nunca municipio ni persona', async () => {
    const fetchMock = respond(200, { resultado: 'PUBLICADO', mensaje: 'Listo.' })
    // Los nombres de origen no importan: viajan como cabecera.csv y detalle.csv.
    const outcome = await submitLot({ cabecera: csv('cabecera', 'mi-archivo-A.csv'), detalle: csv('detalle', 'otro.csv') }, '2026-09-30', null)
    expect(outcome).toMatchObject({ kind: 'loaded', portfolioChanged: true })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/imports/load')
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store' })
    expect(init.headers).toBeUndefined()
    const form = sentForm(fetchMock)
    expect([...form.keys()].sort()).toEqual(['as_of', 'cabecera', 'detalle'])
    expect(form.get('as_of')).toBe('2026-09-30')
    expect((form.get('cabecera') as File).name).toBe('cabecera.csv')
    expect((form.get('detalle') as File).name).toBe('detalle.csv')
    expect(await (form.get('detalle') as File).text()).toBe(await csv('detalle').text())
  })

  it('el reintento explícito agrega solo la revisión', async () => {
    const fetchMock = respond(200, { resultado: 'YA_CARGADO' })
    await submitLot({ cabecera: csv('cabecera'), detalle: csv('detalle') }, '2026-09-30', HASH)
    expect([...sentForm(fetchMock).keys()].sort()).toEqual(['as_of', 'cabecera', 'detalle', 'revision'])
    expect(sentForm(fetchMock).get('revision')).toBe(HASH)
  })

  it('una respuesta que no es JSON se trata como resultado desconocido', async () => {
    respond(502, '<html>puerta de enlace</html>')
    expect(await submitLot({ cabecera: csv('cabecera'), detalle: csv('detalle') }, '2026-09-30', null)).toMatchObject({ kind: 'unconfirmed', portfolioChanged: false })
  })

  it('un error de red no se presenta como rechazo del archivo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const outcome = await submitLot({ cabecera: csv('cabecera'), detalle: csv('detalle') }, '2026-09-30', null)
    expect(outcome).toMatchObject({ kind: 'unconfirmed', title: 'No se pudo confirmar el resultado', portfolioChanged: false })
  })
})

// Sin DOM: se ejecuta el componente real y se disparan sus manejadores, como en review-form-flow.
function mount(currentAsOf: string | null = '2026-09-30') {
  const view = () => ImportForm({ currentAsOf })
  const hosts = () => hostElements(hookRuntime.render(view))
  const find = (predicate: (element: HostElement) => boolean) => hosts().find(predicate)
  const byId = (id: string) => find(element => element.props.id === id)!
  const data = (name: string) => find(element => name in element.props)
  // Texto en orden de lectura: recorre el árbol y ejecuta los componentes sin hooks (ImportResult, Button).
  const deepText = (node: unknown): string => {
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(deepText).join('')
    if (!node || typeof node !== 'object' || !('props' in node)) return ''
    const element = node as { type: unknown; props: { children?: unknown } }
    if (typeof element.type === 'function') return deepText((element.type as (props: unknown) => unknown)(element.props))
    return ` ${deepText(element.props.children)} `
  }
  const text = (): string => deepText(hookRuntime.render(view)).replace(/\s+/g, ' ')
  const flush = () => new Promise(resolve => setTimeout(resolve, 0))
  const choose = async (...files: File[]) => {
    ;(byId('import-files').props.onChange as (event: unknown) => Promise<void>)({ target: { files } })
    await flush()
  }
  const date = (value: string) => (byId('import-as-of').props.onChange as (event: unknown) => void)({ target: { value } })
  const submit = async () => {
    const preventDefault = vi.fn()
    ;(find(element => element.type === 'form')!.props.onSubmit as (event: unknown) => void)({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    await flush()
  }
  const button = () => data('data-load-button')!
  return { byId, data, text, choose, date, submit, button }
}

describe('formulario «Cargar CSV»', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hookRuntime.reset()
  })

  it('sin archivos ni fecha el botón está deshabilitado', () => {
    const form = mount()
    expect(form.button().props.disabled).toBe(true)
    expect(form.data('data-recognized-files')).toBeUndefined()
    expect(form.text()).toContain('Máximo 25 MB por archivo.')
  })

  it('reconoce los archivos por su contenido aunque se elijan en otro orden y con otro nombre', async () => {
    const form = mount()
    await form.choose(csv('detalle', 'z.csv'), csv('cabecera', 'a.csv'))
    expect(form.text()).toMatch(/Cabecera: a\.csv \(\d+ KB\)/)
    expect(form.text()).toMatch(/Detalle: z\.csv \(\d+ KB\)/)
    expect(form.button().props.disabled).toBe(true)
    form.date('2026-10-31')
    expect(form.button().props.disabled).toBe(false)
  })

  it('un solo archivo o dos del mismo tipo: explica el problema y no deja cargar', async () => {
    const form = mount()
    await form.choose(csv('cabecera'))
    expect(form.data('data-file-problems')).toBeDefined()
    expect(form.text()).toContain('Elegiste uno solo.')
    await form.choose(csv('detalle'), csv('detalle', 'otro.csv'))
    expect(form.text()).toContain('Los dos archivos parecen ser de detalle: falta el de cabecera.')
    form.date('2026-10-31')
    expect(form.button().props.disabled).toBe(true)
  })

  it('una fecha inexistente no habilita la carga; una anterior a la vigente se advierte', async () => {
    const form = mount('2026-09-30')
    await form.choose(csv('cabecera'), csv('detalle'))
    form.date('2026-02-30')
    expect(form.button().props.disabled).toBe(true)
    form.date('2026-08-31')
    expect(form.button().props.disabled).toBe(false)
    expect(form.data('data-earlier-date')).toBeDefined()
    expect(form.text()).toContain('Esa fecha es anterior a la de la cartera vigente (30/9/2026).')
    form.date('2026-09-30')
    expect(form.data('data-earlier-date')).toBeUndefined()
  })

  it('sin cartera vigente no hay advertencia de fecha anterior', async () => {
    const form = mount(null)
    await form.choose(csv('cabecera'), csv('detalle'))
    form.date('2001-01-01')
    expect(form.data('data-earlier-date')).toBeUndefined()
  })

  it('carga publicada: muestra el resultado y vuelve a pedir el tablero y el marco', async () => {
    const fetchMock = respond(200, { resultado: 'PUBLICADO', mensaje: 'Se publicó la cartera.', fecha_corte: '2026-10-31' })
    const form = mount()
    await form.choose(csv('cabecera'), csv('detalle'))
    form.date('2026-10-31')
    await form.submit()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(sentForm(fetchMock).get('as_of')).toBe('2026-10-31')
    expect(form.data('data-load-result')?.props['data-load-result']).toBe('loaded')
    expect(form.text()).toContain('Se publicó la cartera.')
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('carga rechazada: muestra el resultado y no refresca la cartera', async () => {
    respond(200, { resultado: 'RECHAZADO', mensaje: 'No se cargó nada.' })
    const form = mount()
    await form.choose(csv('cabecera'), csv('detalle'))
    form.date('2026-10-31')
    await form.submit()
    expect(form.data('data-load-result')?.props['data-load-result']).toBe('rejected')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('sin archivos válidos el envío no llama al servidor', async () => {
    const fetchMock = respond(200, { resultado: 'PUBLICADO' })
    const form = mount()
    await form.choose(csv('cabecera'))
    form.date('2026-10-31')
    await form.submit()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('«Reintentar» reenvía el mismo lote con la revisión que dio el servicio', async () => {
    const fetchMock = respond(200, { resultado: 'REQUIERE_CONFIRMACION', mensaje: 'Hay un intento anterior.', revision: HASH })
    const form = mount()
    await form.choose(csv('cabecera'), csv('detalle'))
    form.date('2026-10-31')
    await form.submit()
    const retry = form.data('data-retry')!
    ;(retry.props.onClick as () => void)()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData).get('revision')).toBeNull()
    expect(((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as FormData).get('revision')).toBe(HASH)
  })

  it('cambiar la fecha o los archivos borra el resultado anterior', async () => {
    respond(200, { resultado: 'RECHAZADO' })
    const form = mount()
    await form.choose(csv('cabecera'), csv('detalle'))
    form.date('2026-10-31')
    await form.submit()
    expect(form.data('data-load-result')).toBeDefined()
    form.date('2026-11-01')
    expect(form.data('data-load-result')).toBeUndefined()
    await form.submit()
    await form.choose(csv('cabecera'), csv('detalle'))
    expect(form.data('data-load-result')).toBeUndefined()
  })
})
