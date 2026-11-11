import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react', async original => {
  const { hookRuntime } = await import('@/tests/helpers/hook-runtime')
  return { ...await original<typeof import('react')>(), useState: hookRuntime.useState }
})

import { WhatsAppDraftPanel } from '@/components/case/whatsapp-draft-panel'
import { WHATSAPP_PENDING_LABEL } from '@/lib/whatsapp/contract'
import { buildDraftContext, type DraftCaseInput, type DraftContext } from '@/lib/whatsapp/draft'
import { hookRuntime, hostElements, type HostElement } from '@/tests/helpers/hook-runtime'
import { markupOf, recordedDecision, textOf } from '@/tests/helpers/case-page'

// Panel «Preparar mensaje» de la ficha: lo que ve y puede hacer la persona. Sin DOM: el componente real
// con sus hooks reales (hook-runtime) y el portapapeles del navegador simulado.

const input = (patch: Partial<DraftCaseInput> = {}): DraftCaseInput => ({
  debtorId: '1', identifier: 'OBJ-SINT-1', type: 'Inmueble',
  recommendation: { intervention: 'RECORDATORIO_INFORMATIVO', intensity: 1, templateId: 'MSG-RECORDATORIO-v1', reviewRequired: false },
  recorded: { kind: 'no-module' }, portfolioAsOf: '2026-09-30', moduleMissing: true,
  people: [{ id: 'p1', name: 'Persona sintética 1', document: '', priority: '100', contact: '', relation: 'Titular' }],
  contacts: [{ id: 'c1', personId: 'p1', personName: '', channel: 'Celular', value: '555 0000 0001', isActive: true }],
  contactsReadFailed: false,
  ...patch,
})

function mount(context: DraftContext) {
  hookRuntime.reset()
  const render = () => hookRuntime.render(() => WhatsAppDraftPanel({ context }) as ReactNode)
  const elements = () => hostElements(render())
  const find = (predicate: (element: HostElement) => boolean) => elements().find(predicate)
  const view = () => { const markup = markupOf(render()); return { markup, text: textOf(markup) } }
  const button = (attribute: string) => find(element => element.type === 'button' && attribute in element.props)!
  return {
    view, find,
    open: () => (button('data-whatsapp-open').props.onClick as () => void)(),
    copy: () => (button('data-whatsapp-copy').props.onClick as () => void)(),
    copyDisabled: () => button('data-whatsapp-copy').props.disabled,
    type: (value: string) => (find(element => element.type === 'textarea')!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } }),
    choose: (value: string) => (find(element => element.type === 'input' && element.props.value === value)!.props.onChange as () => void)(),
  }
}

const writeText = vi.fn()
const fetchMock = vi.fn()
beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals() })

describe('cerrado y abierto', () => {
  it('cerrado solo muestra el botón «Preparar mensaje»', () => {
    const panel = mount(buildDraftContext(input()))
    const { markup, text } = panel.view()
    expect(text).toBe('Preparar mensaje')
    expect(markup).toContain('aria-expanded="false"')
  })

  it('abierto: caso, acción, destinatario, texto editable, estado pendiente y las aclaraciones', () => {
    const panel = mount(buildDraftContext(input()))
    panel.open()
    const { markup, text } = panel.view()
    expect(markup).toContain('aria-expanded="true"')
    expect(text).toContain(WHATSAPP_PENDING_LABEL)
    expect(text).toContain('Caso OBJ-SINT-1 · Inmueble')
    expect(text).toContain('Recomendación automática: Recordatorio (intensidad 1)')
    expect(text).toContain('En esta base no se registran decisiones')
    expect(text).toContain('Para: Persona sintética 1 · Celular 555 0000 0001')
    expect(text).toContain('por la cuenta Inmueble OBJ-SINT-1')
    expect(text).toContain('Un teléfono cargado no acredita que tenga WhatsApp activo, que esté verificado ni que la persona haya dado su consentimiento.')
    expect(text).toContain('no se guarda en la base, no sale por la red y no registra ninguna decisión ni aprobación')
    expect(text).toContain('EQUITAS no envía este mensaje')
    expect(text).not.toMatch(/\benviado\b|\bentregado\b|\bintimado\b|wa\.me|\bbot\b/i)
    expect(markup).not.toMatch(/<form|href=/)
    expect(panel.copyDisabled()).toBe(false)
  })
})

describe('edición, validación y copia', () => {
  it('copia el texto al portapapeles y no hace ninguna llamada de red', async () => {
    const panel = mount(buildDraftContext(input()))
    panel.open()
    panel.copy()
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0][0]).toMatch(/^Hola\. Le escribimos de la Municipalidad por la cuenta Inmueble OBJ-SINT-1/)
    await Promise.resolve()
    expect(panel.view().text).toContain('Borrador copiado. No se envió nada')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('un texto editado con un término prohibido o vacío explica el impedimento y no se puede copiar', () => {
    const panel = mount(buildDraftContext(input()))
    panel.open()
    panel.type('Último aviso antes del embargo')
    expect(panel.view().text).toContain('Las reglas no permiten en un mensaje informativo: «embargo».')
    expect(panel.copyDisabled()).toBe(true)
    expect(panel.view().text).toContain('Volver al texto de la plantilla')
    panel.type('')
    expect(panel.view().text).toContain('El mensaje está vacío.')
    const reset = panel.find(element => element.type === 'button' && element.props.children === 'Volver al texto de la plantilla')!
    ;(reset.props.onClick as () => void)()
    expect(panel.copyDisabled()).toBe(false)
  })

  it('sin portapapeles o si el navegador lo rechaza, pide copiar a mano', async () => {
    vi.stubGlobal('navigator', {})
    const panel = mount(buildDraftContext(input()))
    panel.open()
    panel.copy()
    expect(panel.view().text).toContain('No se pudo copiar: seleccioná el texto y copialo a mano.')
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denegado')) } })
    const again = mount(buildDraftContext(input()))
    again.open()
    again.copy()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(again.view().text).toContain('No se pudo copiar')
  })

  it('sin fecha de corte acreditada el marcador queda a la vista y bloquea la copia hasta completarlo', () => {
    const panel = mount(buildDraftContext(input({ portfolioAsOf: null })))
    panel.open()
    expect(panel.view().text).toContain('Completá o quitá «[fecha de los registros]»')
    expect(panel.copyDisabled()).toBe(true)
  })
})

describe('elección explícita de persona y teléfono', () => {
  it('con varias personas y teléfonos hay que elegir, y cada paso lo explica', () => {
    const panel = mount(buildDraftContext(input({
      people: [input().people[0], { id: 'p2', name: 'Persona sintética 2', document: '', priority: '50', contact: '', relation: 'Titular' }],
      contacts: [input().contacts[0],
        { id: 'c2', personId: 'p2', personName: '', channel: 'Celular', value: '555 0000 0002', isActive: true },
        { id: 'c3', personId: 'p2', personName: '', channel: 'WhatsApp', value: '555 0000 0003', isActive: true },
        { id: 'c4', personId: 'p2', personName: '', channel: 'Celular', value: '555 0000 0004', isActive: false }],
    })))
    panel.open()
    expect(panel.view().text).toContain('Elegí a qué persona va dirigido el mensaje.')
    expect(panel.copyDisabled()).toBe(true)
    panel.choose('p2')
    expect(panel.view().text).toContain('Elegí cuál de los teléfonos de Persona sintética 2 usar.')
    expect(panel.view().text).toContain('Hay 1 teléfono cargado como inactivo: no se ofrece.')
    panel.choose('c3')
    expect(panel.copyDisabled()).toBe(false)
    panel.choose('p1')
    expect(panel.view().text).toContain('Para: Persona sintética 1')
  })

  it('una decisión pendiente de aprobación bloquea todo el panel: ni texto ni botón de copia', () => {
    const decision = recordedDecision({ decision: 'MODIFICA', decidedIntervention: 'INTIMACION_ADMINISTRATIVA', decidedIntensity: 3, status: 'PENDIENTE_APROBACION', mine: false })
    const panel = mount(buildDraftContext(input({ moduleMissing: false, recorded: { kind: 'recorded', decision, current: { asOf: '2026-10-30', rulesVersion: '1.1.0' } } })))
    panel.open()
    const { markup, text } = panel.view()
    expect(text).toContain('No se puede preparar un mensaje para este caso')
    expect(text).toContain('La propuesta espera la aprobación de otra persona')
    expect(markup).not.toContain('<textarea')
    expect(markup).not.toContain('data-whatsapp-copy')
    expect(text).toContain(WHATSAPP_PENDING_LABEL)
  })

  it('a 390 px nada fija un ancho mayor que la pantalla', () => {
    const panel = mount(buildDraftContext(input()))
    panel.open()
    expect(panel.view().markup).not.toMatch(/min-w-\[(?:[3-9]\d|\d{3,})rem\]|w-\[\d{3,}px\]/)
  })
})
