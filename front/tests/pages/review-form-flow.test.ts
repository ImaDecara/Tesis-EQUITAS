import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { recordCaseDecision, approveCaseDecision, refresh } = vi.hoisted(() => ({
  recordCaseDecision: vi.fn(), approveCaseDecision: vi.fn(), refresh: vi.fn(),
}))
vi.mock('@/app/debtors/[debtorId]/actions', () => ({ recordCaseDecision, approveCaseDecision }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('react', async original => {
  const { hookRuntime } = await import('@/tests/helpers/hook-runtime')
  return { ...await original<typeof import('react')>(), useReducer: hookRuntime.useReducer, useRef: hookRuntime.useRef, useTransition: hookRuntime.useTransition, useEffect: hookRuntime.useEffect, useId: hookRuntime.useId }
})

import { ReviewApprovalForm } from '@/components/review/review-approval-form'
import { ReviewDecisionForm } from '@/components/review/review-decision-form'
import { TabsList, moveTabFocus } from '@/components/ui/tabs'
import { CASE_REVIEW_MESSAGES, caseReviewFailure, type CaseReviewSnapshot } from '@/lib/domain/case-review-contract'
import { REVIEW_ACTIONS } from '@/lib/domain/case-review-form'
import { hookRuntime, hostElements, type HostElement } from '@/tests/helpers/hook-runtime'

const SNAPSHOT: CaseReviewSnapshot = {
  debtorId: '99', asOf: '2026-10-30', rulesVersion: '1.0.0', inputsHash: 'a'.repeat(64),
  suggestedIntervention: 'RECORDATORIO_INFORMATIVO', suggestedIntensity: 1, explanation: {}, currentReviewId: '7',
}
const NEWER = { ...SNAPSHOT, inputsHash: 'b'.repeat(64), suggestedIntervention: 'CONTACTO_PERSONAL_Y_PLAN', suggestedIntensity: 2, currentReviewId: '8' }
const INTIMACION = REVIEW_ACTIONS.find(action => action.intensity === 3)!
const COMPLETE = { situacion_hogar: 'NO_DISPONIBLE', estado_juridico_verificado: true, canal_valido: true, alternativa_asistida_ofrecida: true }
const RECORDED = { ok: true, reviewId: '9', debtorId: '99', created: true, status: 'REGISTRADA', asOf: SNAPSHOT.asOf, rulesVersion: '1.0.0', inputsHash: SNAPSHOT.inputsHash, suggestedIntervention: 'SEGUIMIENTO', suggestedIntensity: 0 }

// Un "recorrido" dispara los mismos manejadores que un navegador, sobre el árbol real.
function mount(view: () => ReactNode) {
  const hosts = () => hostElements(hookRuntime.render(view))
  const find = (predicate: (element: HostElement) => boolean) => {
    const element = hosts().find(predicate)
    if (!element) throw new Error('control no encontrado')
    return element
  }
  const byId = (id: string) => find(element => element.props.id === id)
  const radio = (value: string) => find(element => element.type === 'input' && element.props.type === 'radio' && element.props.value === value)
  const has = (id: string) => hosts().some(element => element.props.id === id)
  const text = (nodes: ReactNode = hookRuntime.render(view)): string =>
    hostElements(nodes).map(element => Array.isArray(element.props.children) ? element.props.children.filter(child => typeof child === 'string').join('') : typeof element.props.children === 'string' ? element.props.children : '').join(' ')
  const select = (id: string, value: string) => (byId(id).props.onChange as (event: unknown) => void)({ target: { value } })
  const choose = (value: string) => (radio(value).props.onChange as (event: unknown) => void)({ target: { value } })
  const check = (id: string, checked = true) => (byId(id).props.onChange as (event: unknown) => void)({ target: { checked } })
  const submit = async () => {
    const preventDefault = vi.fn()
    ;(find(element => element.type === 'form').props.onSubmit as (event: unknown) => void)({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    await hookRuntime.settle()
  }
  const button = (name: string) => find(element => element.type === 'button' && JSON.stringify(element.props.children).includes(name))
  const fillChecklist = (prefix: string) => {
    choose('NO_DISPONIBLE')
    for (const key of ['estado_juridico_verificado', 'canal_valido', 'alternativa_asistida_ofrecida']) check(`${prefix}-${key}`)
  }
  return { byId, has, text, select, choose, check, submit, button, fillChecklist, hosts }
}

const decisionForm = (snapshot = SNAPSHOT) => mount(() => ReviewDecisionForm({ snapshot }))

beforeEach(() => {
  vi.clearAllMocks()
  hookRuntime.reset()
})

describe('formulario de decisión', () => {
  it('no muestra campos hasta elegir, y Aceptar envía la sugerencia sin más datos', async () => {
    recordCaseDecision.mockResolvedValue(RECORDED)
    const form = decisionForm()
    expect(form.has('rv-reason')).toBe(false)
    form.choose('ACEPTA')
    expect(form.has('rv-reason')).toBe(false)
    expect(form.has('rv-action')).toBe(false)
    await form.submit()
    expect(recordCaseDecision).toHaveBeenCalledExactlyOnceWith({
      debtorId: '99', decision: 'ACEPTA', expected: { asOf: '2026-10-30', rulesVersion: '1.0.0', inputsHash: 'a'.repeat(64) },
      supersedes: '7', decidedIntervention: null, decidedIntensity: null, reasonCode: null, reasonText: null, checklist: {},
    })
  })

  it('≥3 sin lista de control no llama a la acción, y marca cada casilla', async () => {
    const form = decisionForm()
    form.choose('MODIFICA')
    form.select('rv-action', INTIMACION.key)
    form.select('rv-reason', 'DATOS_INCOMPLETOS')
    expect(form.has('rv-estado_juridico_verificado')).toBe(true)
    await form.submit()
    expect(recordCaseDecision).not.toHaveBeenCalled()
    for (const key of ['estado_juridico_verificado', 'canal_valido', 'alternativa_asistida_ofrecida']) {
      expect(form.byId(`rv-${key}`).props['aria-invalid']).toBe(true)
      expect(form.byId(`rv-${key}`).props['aria-describedby']).toBe(`rv-${key}-error`)
      expect(form.has(`rv-${key}-error`)).toBe(true)
    }
    expect(form.byId('rv-situacion_hogar').props['aria-invalid']).toBe(true)
  })

  it('una sola casilla sin marcar sigue bloqueando, y completa envía la propuesta', async () => {
    recordCaseDecision.mockResolvedValue({ ...RECORDED, status: 'PENDIENTE_SUPERVISOR' })
    const form = decisionForm()
    form.choose('MODIFICA')
    form.select('rv-action', INTIMACION.key)
    form.select('rv-reason', 'DATOS_INCOMPLETOS')
    form.fillChecklist('rv')
    form.check('rv-canal_valido', false)
    await form.submit()
    expect(recordCaseDecision).not.toHaveBeenCalled()
    form.check('rv-canal_valido')
    await form.submit()
    expect(recordCaseDecision).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      decision: 'MODIFICA', decidedIntervention: 'INTIMACION_ADMINISTRATIVA', decidedIntensity: 3, reasonCode: 'DATOS_INCOMPLETOS', checklist: COMPLETE,
    }))
    expect(form.byId('rv-notice').props.role).toBe('status')
  })

  it('cada enlace del resumen lleva a un campo que existe', async () => {
    const form = decisionForm()
    form.choose('MODIFICA')
    form.select('rv-action', INTIMACION.key)
    await form.submit()
    const targets = form.hosts().filter(element => element.type === 'a').map(element => String(element.props.href).slice(1))
    expect(targets).toEqual(['rv-reason', 'rv-situacion_hogar', 'rv-estado_juridico_verificado', 'rv-canal_valido', 'rv-alternativa_asistida_ofrecida'])
    for (const target of targets) expect(form.has(target), target).toBe(true)
  })

  it('con una decisión vigente avisa que la reemplaza; sin ella, no', () => {
    expect(decisionForm().text()).toContain('registrar otra la reemplaza')
    hookRuntime.reset()
    expect(decisionForm({ ...SNAPSHOT, currentReviewId: null }).text()).not.toContain('registrar otra la reemplaza')
  })

  it('el botón y la advertencia dicen que ≥3 es una propuesta', () => {
    const form = decisionForm()
    form.choose('MODIFICA')
    expect(JSON.stringify(form.button('Registrar decisión').props.children)).toContain('Registrar decisión')
    form.select('rv-action', INTIMACION.key)
    expect(JSON.stringify(form.button('Registrar propuesta').props.children)).toContain('Registrar propuesta')
    expect(form.has('rv-intense-note')).toBe(true)
  })

  it('motivo faltante: resumen de errores y error asociado al campo', async () => {
    const form = decisionForm()
    form.choose('RECHAZA')
    await form.submit()
    expect(recordCaseDecision).not.toHaveBeenCalled()
    expect(form.byId('rv-reason').props['aria-invalid']).toBe(true)
    expect(String(form.byId('rv-reason').props['aria-describedby'])).toContain('rv-reason-error')
    expect(form.byId('rv-summary').props.role).toBe('alert')
    const links = form.hosts().filter(element => element.type === 'a').map(element => String(element.props.href))
    expect(links).toEqual(['#rv-reason'])
    expect(form.has('rv-reason')).toBe(true)
  })

  it('el foco va al aviso cuando aparece uno', async () => {
    const focus = vi.fn()
    const form = decisionForm()
    form.choose('RECHAZA')
    ;(form.byId('rv-feedback').props.ref as { current: unknown }).current = { focus }
    await form.submit()
    form.hosts()
    expect(focus).toHaveBeenCalledOnce()
  })

  it('el campo de texto actualiza el contador', () => {
    const form = decisionForm()
    form.choose('RECHAZA')
    form.select('rv-reason-text', '🙂 a')
    expect(form.byId('rv-reason-text').props.value).toBe('🙂 a')
    expect(JSON.stringify(form.byId('rv-reason-text-count').props.children)).toContain('3')
  })

  it('datos cambiados: muestra lo vigente, borra la decisión, refresca y reenvía con lo vigente', async () => {
    recordCaseDecision.mockResolvedValueOnce({ ...caseReviewFailure('SUGGESTION_OUTDATED'), changed: ['CORTE'], current: NEWER })
    const form = decisionForm()
    form.choose('RECHAZA')
    form.select('rv-reason', 'DATOS_INCOMPLETOS')
    await form.submit()
    expect(refresh).toHaveBeenCalledOnce()
    expect(form.byId('rv-notice').props.role).toBe('alert')
    expect(form.text()).toContain('la fecha de la cartera')
    expect(form.text()).toContain('Contacto y plan')
    // Sin volver a elegir, no se confirma.
    await form.submit()
    expect(recordCaseDecision).toHaveBeenCalledOnce()
    recordCaseDecision.mockResolvedValueOnce(RECORDED)
    form.choose('RECHAZA')
    await form.submit()
    expect(recordCaseDecision).toHaveBeenCalledTimes(2)
    expect(recordCaseDecision.mock.calls[1][0]).toMatchObject({ expected: { inputsHash: 'b'.repeat(64) }, supersedes: '8', reasonCode: 'DATOS_INCOMPLETOS' })
  })

  it('carga en curso al confirmar: aviso neutro, sin marcar campos y sin perder lo escrito', async () => {
    recordCaseDecision.mockResolvedValue(caseReviewFailure('CUTOFF_NOT_AVAILABLE'))
    const form = decisionForm()
    form.choose('RECHAZA')
    form.select('rv-reason', 'DATOS_INCOMPLETOS')
    await form.submit()
    expect(form.byId('rv-notice').props.role).toBe('status')
    expect(form.text()).toContain(CASE_REVIEW_MESSAGES.CUTOFF_NOT_AVAILABLE)
    expect(form.byId('rv-reason').props['aria-invalid']).toBeUndefined()
    expect(form.byId('rv-reason').props.value).toBe('DATOS_INCOMPLETOS')
  })

  it('conflicto: ofrece recargar, y recargar obliga a volver a elegir', async () => {
    recordCaseDecision.mockResolvedValue(caseReviewFailure('REVIEW_CONFLICT'))
    const form = decisionForm()
    form.choose('RECHAZA')
    form.select('rv-reason', 'DATOS_INCOMPLETOS')
    await form.submit()
    expect(form.byId('rv-notice').props.role).toBe('alert')
    ;(form.button('Recargar el caso').props.onClick as () => void)()
    expect(refresh).toHaveBeenCalledOnce()
    expect(form.has('rv-notice')).toBe(false)
    expect(form.has('rv-reason')).toBe(false)
  })

  it('rechazo con campo: marca ese campo', async () => {
    recordCaseDecision.mockResolvedValue(caseReviewFailure('REASON_TEXT_BLANK'))
    const form = decisionForm()
    form.choose('RECHAZA')
    form.select('rv-reason', 'DATOS_INCOMPLETOS')
    await form.submit()
    expect(form.byId('rv-reason-text').props['aria-invalid']).toBe(true)
    expect(form.text()).toContain(CASE_REVIEW_MESSAGES.REASON_TEXT_BLANK)
  })

  it('acción que lanza: ofrece recarga completa', async () => {
    const reload = vi.fn()
    vi.stubGlobal('window', { location: { reload } })
    recordCaseDecision.mockRejectedValue(new Error('Failed to find Server Action'))
    const form = decisionForm()
    form.choose('ACEPTA')
    await form.submit()
    ;(form.button('Recargar la página').props.onClick as () => void)()
    expect(reload).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  it('registrado: el formulario se limpia', async () => {
    recordCaseDecision.mockResolvedValue(RECORDED)
    const form = decisionForm()
    form.choose('RECHAZA')
    form.select('rv-reason', 'DATOS_INCOMPLETOS')
    form.select('rv-reason-text', 'detalle')
    await form.submit()
    expect(form.has('rv-reason')).toBe(false)
    expect(form.text()).toContain('Decisión registrada')
    expect(recordCaseDecision.mock.calls[0][0]).toMatchObject({ reasonText: 'detalle' })
  })
})

describe('respuesta a la propuesta', () => {
  const approvalForm = (patch: Partial<Parameters<typeof ReviewApprovalForm>[0]> = {}) =>
    mount(() => ReviewApprovalForm({ caseReviewId: '7', supersedes: null, blockedReason: null, ...patch }))

  it('aprobar sin lista no llama a la acción; completa la envía', async () => {
    approveCaseDecision.mockResolvedValue({ ok: true, approvalId: '1', caseReviewId: '7', debtorId: '99', created: true, status: 'APROBADA' })
    const form = approvalForm()
    form.choose('APRUEBA')
    await form.submit()
    expect(approveCaseDecision).not.toHaveBeenCalled()
    expect(form.byId('ap-canal_valido').props['aria-invalid']).toBe(true)
    form.fillChecklist('ap')
    await form.submit()
    expect(approveCaseDecision).toHaveBeenCalledExactlyOnceWith({ caseReviewId: '7', decision: 'APRUEBA', reasonCode: null, checklist: COMPLETE, supersedes: null })
    expect(form.text()).toContain('Propuesta aprobada')
  })

  it('objetar exige motivo y usa la respuesta vigente como antecedente', async () => {
    approveCaseDecision.mockResolvedValue({ ok: true, approvalId: '2', caseReviewId: '7', debtorId: '99', created: true, status: 'OBJETADA' })
    const form = approvalForm({ supersedes: '1' })
    form.choose('OBJETA')
    await form.submit()
    expect(approveCaseDecision).not.toHaveBeenCalled()
    expect(form.byId('ap-reason').props['aria-invalid']).toBe(true)
    form.select('ap-reason', 'LISTA_DE_CONTROL_INSUFICIENTE')
    await form.submit()
    expect(approveCaseDecision).toHaveBeenCalledExactlyOnceWith({ caseReviewId: '7', decision: 'OBJETA', reasonCode: 'LISTA_DE_CONTROL_INSUFICIENTE', checklist: {}, supersedes: '1' })
  })

  it('con una carga en curso: aprobar deshabilitado con aviso, objetar disponible', async () => {
    approveCaseDecision.mockResolvedValue({ ok: true, approvalId: '2', caseReviewId: '7', debtorId: '99', created: true, status: 'OBJETADA' })
    const form = approvalForm({ blockedReason: 'Hoy no hay una cartera vigente: no se puede aprobar.' })
    expect(form.hosts().find(element => element.props.value === 'APRUEBA')?.props.disabled).toBe(true)
    expect(form.has('ap-blocked-note')).toBe(true)
    expect(form.text()).toContain('Hoy no hay una cartera vigente: no se puede aprobar. Objetar sigue disponible.')
    form.choose('OBJETA')
    form.select('ap-reason', 'LISTA_DE_CONTROL_INSUFICIENTE')
    await form.submit()
    expect(approveCaseDecision).toHaveBeenCalledOnce()
  })

  it('datos cambiados al aprobar: muestra lo vigente y explica que queda objetar', async () => {
    approveCaseDecision.mockResolvedValue({ ...caseReviewFailure('SUGGESTION_OUTDATED'), changed: ['INSUMOS'], current: NEWER })
    const form = approvalForm()
    form.choose('APRUEBA')
    form.fillChecklist('ap')
    await form.submit()
    expect(form.text()).toContain('los datos del caso')
    expect(form.text()).toContain('Contacto y plan')
    expect(refresh).toHaveBeenCalledOnce()
  })
})

describe('pestañas con teclado', () => {
  const event = (key: string, focusedIndex: number) => {
    const tabs = [0, 1, 2].map(() => ({ focus: vi.fn(), click: vi.fn() }))
    return { tabs, value: { key, target: tabs[focusedIndex], preventDefault: vi.fn(), currentTarget: { querySelectorAll: () => tabs } } }
  }

  it.each([
    ['ArrowRight', 0, 1], ['ArrowRight', 2, 0], ['ArrowLeft', 0, 2], ['ArrowLeft', 2, 1], ['Home', 2, 0], ['End', 0, 2],
  ])('%s desde %s activa %s', (key, from, to) => {
    const { tabs, value } = event(key, from)
    moveTabFocus(value as never)
    expect(value.preventDefault).toHaveBeenCalledOnce()
    expect(tabs[to].focus).toHaveBeenCalledOnce()
    expect(tabs[to].click).toHaveBeenCalledOnce()
  })

  it('otra tecla no hace nada', () => {
    const { tabs, value } = event('Tab', 0)
    moveTabFocus(value as never)
    expect(value.preventDefault).not.toHaveBeenCalled()
    expect(tabs.every(tab => tab.focus.mock.calls.length === 0)).toBe(true)
  })

  it('fuera de una pestaña no hace nada', () => {
    const { tabs, value } = event('End', 0)
    moveTabFocus({ ...value, target: {} } as never)
    expect(tabs.every(tab => tab.focus.mock.calls.length === 0)).toBe(true)
  })

  it('el listado declara su rol y escucha las flechas', () => {
    const list = TabsList({ 'aria-label': 'x' }) as ReturnType<typeof createElement>
    expect(list.props).toMatchObject({ role: 'tablist', onKeyDown: moveTabFocus, 'aria-label': 'x' })
  })
})
