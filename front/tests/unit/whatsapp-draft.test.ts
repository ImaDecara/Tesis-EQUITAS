import { describe, expect, it } from 'vitest'

import { ACTIVE_RULES } from '@/lib/domain/decision-rules-v1'
import { PENDING_PROVIDER, SERVER_CHECKS, WHATSAPP_CONTRACT_VERSION, WHATSAPP_ERROR_TEXT, type WhatsAppErrorCode } from '@/lib/whatsapp/contract'
import {
  buildDraftContext, DRAFT_MAX_CHARS, draftImpediments, effectiveSelection, fillTemplate, isPhoneContact, MISSING_DATE_MARKER,
  selectionImpediments, templateForAction, validateDraftText, type DraftCaseInput,
} from '@/lib/whatsapp/draft'
import { recordedDecision } from '@/tests/helpers/case-page'
import type { DebtorContactItem, DebtorPersonItem } from '@/types/equitas-domain'

// Borrador de WhatsApp: funciones puras. Datos sintéticos (teléfonos con 555, que no es un código de área).

const person = (id: string, name: string): DebtorPersonItem => ({ id, name, document: '', priority: '100', contact: '', relation: 'Titular' })
const contact = (id: string, personId: string, channel: string, value: string, isActive = true): DebtorContactItem => ({ id, personId, personName: '', channel, value, isActive })

const input = (patch: Partial<DraftCaseInput> = {}): DraftCaseInput => ({
  debtorId: '1', identifier: 'OBJ-SINT-1', type: 'Inmueble',
  recommendation: { intervention: 'RECORDATORIO_INFORMATIVO', intensity: 1, templateId: 'MSG-RECORDATORIO-v1', reviewRequired: false },
  recorded: { kind: 'none' }, portfolioAsOf: '2026-09-30', moduleMissing: false,
  people: [person('p1', 'Persona sintética 1')], contacts: [contact('c1', 'p1', 'Celular', '555 0000 0001')], contactsReadFailed: false,
  ...patch,
})
const codes = (items: readonly { code: string }[]) => items.map(item => item.code)
const NONE = { personId: '', contactId: '' }

describe('plantillas de las reglas activas', () => {
  it('cada acción toma la plantilla que las reglas le asignan; las que no contactan no tienen', () => {
    expect(templateForAction('RECORDATORIO_INFORMATIVO', 1)).toBe('MSG-RECORDATORIO-v1')
    expect(templateForAction('CONTACTO_PERSONAL_Y_PLAN', 2)).toBe('MSG-CONTACTO-PLAN-v1')
    expect(templateForAction('SEGUIMIENTO', 1)).toBe('MSG-SEGUIMIENTO-v1')
    for (const [intervention, intensity] of [['SEGUIMIENTO', 0], ['MEJORAR_DATOS', 0], ['REVISION_JURIDICA', 0], ['INTIMACION_ADMINISTRATIVA', 3]] as const) {
      expect(templateForAction(intervention, intensity)).toBeNull()
    }
  })

  it('completa solo los marcadores permitidos; sin fecha de corte deja un marcador visible y no inventa una', () => {
    const text = fillTemplate('MSG-RECORDATORIO-v1', { type: 'Inmueble', identifier: 'OBJ-SINT-1', asOf: '2026-09-30' })
    expect(text).toContain('por la cuenta Inmueble OBJ-SINT-1')
    expect(text).toContain('al 30/9/2026')
    expect(text).not.toMatch(/\{[^}]*\}/)
    expect(fillTemplate('MSG-RECORDATORIO-v1', { type: 'Inmueble', identifier: 'X', asOf: null })).toContain(MISSING_DATE_MARKER)
    expect(fillTemplate('NO-EXISTE', { type: '', identifier: '', asOf: null })).toBe('')
  })

  it('las plantillas de las reglas pasan las validaciones de texto una vez completas', () => {
    for (const id of Object.keys(ACTIVE_RULES.mensajes_borrador.plantillas)) {
      expect(validateDraftText(fillTemplate(id, { type: 'Inmueble', identifier: 'OBJ-SINT-1', asOf: '2026-09-30' }))).toEqual([])
    }
  })
})

describe('contactos', () => {
  it('un contacto es telefónico por su canal o, sin canal legible, por la forma del valor', () => {
    expect(isPhoneContact({ channel: 'Celular', value: '555 0000 0001' })).toBe(true)
    expect(isPhoneContact({ channel: 'WhatsApp', value: '+54 555 000-0001' })).toBe(true)
    expect(isPhoneContact({ channel: 'Teléfono', value: '5550000001' })).toBe(true)
    expect(isPhoneContact({ channel: 'No disponible', value: '(555) 000-0001' })).toBe(true)
    expect(isPhoneContact({ channel: 'Email', value: 'persona@example.com' })).toBe(false)
    expect(isPhoneContact({ channel: 'Celular', value: '1234' })).toBe(false)
    expect(isPhoneContact({ channel: 'Carta', value: 'Calle 555 0001 piso 2' })).toBe(false)
  })

  it('solo se ofrecen teléfonos activos de personas vinculadas; los inactivos se cuentan', () => {
    const context = buildDraftContext(input({
      people: [person('p1', 'Persona 1'), person('p2', 'Persona 2')],
      contacts: [contact('c1', 'p1', 'Celular', '555 0000 0001'), contact('c2', 'p1', 'Email', 'p1@example.com'),
        contact('c3', 'p2', 'Celular', '555 0000 0002', false), contact('c4', 'p9', 'Celular', '555 0000 0009')],
    }))
    expect(context.recipients).toEqual([{ personId: 'p1', personName: 'Persona 1', relation: 'Titular', phones: [{ contactId: 'c1', channel: 'Celular', value: '555 0000 0001' }] }])
    expect(context.inactivePhones).toBe(1)
  })

  it('con una sola opción se elige sola; con varias hay que elegir persona y después teléfono', () => {
    const single = buildDraftContext(input())
    expect(selectionImpediments(single, NONE)).toEqual([])
    expect(effectiveSelection(single.recipients, NONE).phone?.contactId).toBe('c1')
    const many = buildDraftContext(input({
      people: [person('p1', 'Persona 1'), person('p2', 'Persona 2')],
      contacts: [contact('c1', 'p1', 'Celular', '555 0000 0001'), contact('c2', 'p2', 'Celular', '555 0000 0002'), contact('c3', 'p2', 'Teléfono', '555 0000 0003')],
    }))
    expect(codes(selectionImpediments(many, NONE))).toEqual(['PERSON_REQUIRED'])
    expect(codes(selectionImpediments(many, { personId: 'p1', contactId: '' }))).toEqual([])
    expect(selectionImpediments(many, { personId: 'p2', contactId: '' })).toEqual([{ code: 'CONTACT_REQUIRED', text: 'Elegí cuál de los teléfonos de Persona 2 usar.' }])
    expect(codes(selectionImpediments(many, { personId: 'p2', contactId: 'c3' }))).toEqual([])
  })

  it('sin teléfono lo dice; una lectura fallida no se presenta como «no tiene»', () => {
    const none = buildDraftContext(input({ contacts: [contact('c1', 'p1', 'Celular', '555 0000 0001', false)] }))
    expect(selectionImpediments(none, NONE)).toEqual([{ code: 'NO_PHONE', text: 'Ninguna persona vinculada al caso tiene un teléfono activo cargado. Hay 1 cargado como inactivo.' }])
    expect(selectionImpediments({ ...none, inactivePhones: 2 }, NONE)[0].text).toContain('Hay 2 cargados como inactivos.')
    expect(selectionImpediments({ ...none, inactivePhones: 0 }, NONE)[0].text).toBe('Ninguna persona vinculada al caso tiene un teléfono activo cargado.')
    const failed = buildDraftContext(input({ contactsReadFailed: true }))
    expect(failed.recipients).toEqual([])
    expect(selectionImpediments(failed, NONE)[0]).toMatchObject({ code: 'CONTACTS_UNREADABLE' })
    expect(selectionImpediments(failed, NONE)[0].text).toContain('no significa que no tenga')
  })
})

describe('de dónde sale la acción: recomendación, decisión y aprobación no se mezclan', () => {
  it('sin decisión registrada parte de la recomendación y lo dice; en BASE aclara que no registra nada', () => {
    const context = buildDraftContext(input())
    expect(context.basis).toMatchObject({ source: 'RECOMMENDATION', label: 'Recomendación automática: Recordatorio (intensidad 1)', reviewId: null })
    expect(context.basis.note).toContain('que no es una decisión')
    expect(context.templateId).toBe('MSG-RECORDATORIO-v1')
    expect(context.caseImpediments).toEqual([])
    const base = buildDraftContext(input({ recorded: { kind: 'no-module' }, moduleMissing: true, portfolioAsOf: null }))
    expect(base.basis.note).toBe('En esta base no se registran decisiones: el borrador parte de la recomendación automática y no registra ninguna decisión ni aprobación.')
    expect(base.moduleMissing).toBe(true)
    expect(base.initialText).toContain(MISSING_DATE_MARKER)
    expect(codes(draftImpediments(base, NONE, base.initialText))).toEqual(['PLACEHOLDER'])
  })

  it('una decisión vigente manda sobre la recomendación, también si la modificó una persona', () => {
    const modified = recordedDecision({ decision: 'MODIFICA', decidedIntervention: 'CONTACTO_PERSONAL_Y_PLAN', decidedIntensity: 2 })
    const context = buildDraftContext(input({ recorded: { kind: 'recorded', decision: modified, current: { asOf: '2026-10-30', rulesVersion: '1.1.0' } } }))
    expect(context.basis).toMatchObject({ source: 'DECISION', label: 'Decisión registrada: Acción modificada: Contacto y plan (intensidad 2)', reviewId: '5' })
    expect(context.templateId).toBe('MSG-CONTACTO-PLAN-v1')
    expect(context.initialText).toContain('planes de pago')
  })

  it.each([
    ['rechazada', { decision: 'RECHAZA', decidedIntervention: null, decidedIntensity: null }, ['RECOMMENDATION_REJECTED']],
    ['pospuesta', { decision: 'POSPONE', decidedIntervention: null, decidedIntensity: null }, ['DECISION_POSTPONED']],
    ['derivada', { decision: 'DERIVA', decidedIntervention: null, decidedIntensity: null }, ['CASE_DERIVED']],
    ['sobre datos anteriores', { stale: true }, ['DECISION_STALE']],
    ['pendiente de aprobación', { decision: 'MODIFICA', decidedIntervention: 'INTIMACION_ADMINISTRATIVA', decidedIntensity: 3, status: 'PENDIENTE_APROBACION' }, ['APPROVAL_PENDING', 'INTENSE_ACTION']],
    ['objetada', { decision: 'MODIFICA', decidedIntervention: 'INTIMACION_ADMINISTRATIVA', decidedIntensity: 3, status: 'OBJETADA' }, ['APPROVAL_OBJECTED', 'INTENSE_ACTION']],
    ['aprobada de intensidad 3', { decision: 'MODIFICA', decidedIntervention: 'INTIMACION_ADMINISTRATIVA', decidedIntensity: 3, status: 'APROBADA' }, ['INTENSE_ACTION']],
    ['aceptada sin mensaje', { decidedIntervention: 'MEJORAR_DATOS', decidedIntensity: 0, suggestedIntervention: 'MEJORAR_DATOS', suggestedIntensity: 0 }, ['NO_MESSAGE_FOR_ACTION']],
  ] as const)('decisión %s: no se prepara, y se explica', (_name, patch, expected) => {
    const decision = recordedDecision(patch as never)
    const context = buildDraftContext(input({ recorded: { kind: 'recorded', decision, current: { asOf: '2026-10-30', rulesVersion: '1.1.0' } } }))
    expect(codes(context.caseImpediments)).toEqual(expected)
    // Lo bloqueado por el caso no depende de lo que se elija o escriba.
    expect(codes(draftImpediments(context, NONE, 'Texto cualquiera'))).toEqual(expected)
  })

  it('la intensa explica que no sale por este canal aunque esté aprobada', () => {
    const decision = recordedDecision({ decision: 'MODIFICA', decidedIntervention: 'INTIMACION_ADMINISTRATIVA', decidedIntensity: 3, status: 'APROBADA' })
    const [item] = buildDraftContext(input({ recorded: { kind: 'recorded', decision, current: { asOf: '2026-10-30', rulesVersion: '1.1.0' } } })).caseImpediments
    expect(item.text).toContain('no se prepara por este canal, esté aprobada o no')
    expect(item.text).not.toMatch(/intimad[oa]\b/i)
  })

  it.each([
    ['no se pudo leer la decisión', { recorded: { kind: 'unavailable' } }, 'DECISION_UNREADABLE'],
    ['la cuenta no ve la decisión', { recorded: { kind: 'forbidden' } }, 'DECISION_FORBIDDEN'],
    ['sin recomendación evaluable', { recommendation: null }, 'NO_RECOMMENDATION'],
    ['requiere revisión caso por caso', { recommendation: { intervention: 'RECORDATORIO_INFORMATIVO', intensity: 1, templateId: 'MSG-RECORDATORIO-v1', reviewRequired: true } }, 'REVIEW_REQUIRED'],
    ['recomendación sin mensaje', { recommendation: { intervention: 'MEJORAR_DATOS', intensity: 0, templateId: null, reviewRequired: false } }, 'NO_MESSAGE_FOR_ACTION'],
  ] as const)('%s → %s', (_name, patch, code) => {
    const context = buildDraftContext(input(patch as Partial<DraftCaseInput>))
    expect(codes(context.caseImpediments)).toEqual([code])
    expect(context.initialText === '' || code === 'REVIEW_REQUIRED').toBe(true)
  })
})

describe('validaciones del texto', () => {
  it('vacío, largo, marcadores, términos prohibidos (sin importar tildes) y enlaces', () => {
    expect(codes(validateDraftText('   '))).toEqual(['EMPTY'])
    expect(validateDraftText('a'.repeat(DRAFT_MAX_CHARS + 1))[0]).toEqual({ code: 'TOO_LONG', text: 'El mensaje tiene 1.025 caracteres; el tope es 1.024.' })
    expect(validateDraftText('Hola {nombre} y [fecha]')[0].text).toBe('Completá o quitá «{nombre}», «[fecha]» antes de usar el texto.')
    const forbidden = validateDraftText('Última INTIMACION antes del juicio; su puntaje de riesgo')
    expect(codes(forbidden)).toEqual(['FORBIDDEN_TERM'])
    expect(forbidden[0].text).toBe('Las reglas no permiten en un mensaje informativo: «intimación», «juicio», «riesgo», «puntaje».')
    expect(codes(validateDraftText('Pague en https://example.com o www.example.org'))).toEqual(['LINK'])
    expect(validateDraftText('Hola. Le escribimos de la Municipalidad.')).toEqual([])
  })

  it('sin impedimentos del caso, junta los de la elección y los del texto', () => {
    const context = buildDraftContext(input({ people: [person('p1', 'A'), person('p2', 'B')], contacts: [contact('c1', 'p1', 'Celular', '555 0000 0001'), contact('c2', 'p2', 'Celular', '555 0000 0002')] }))
    expect(codes(draftImpediments(context, NONE, ''))).toEqual(['PERSON_REQUIRED', 'EMPTY'])
    expect(draftImpediments(context, { personId: 'p2', contactId: '' }, context.initialText)).toEqual([])
  })
})

describe('contrato del proveedor', () => {
  it('no hay proveedor: todo pedido vuelve rechazado y no sale nada', async () => {
    expect(WHATSAPP_CONTRACT_VERSION).toBe('1.0.0')
    expect(PENDING_PROVIDER.id).toBe('pendiente')
    await expect(PENDING_PROVIDER.submit({
      contractVersion: '1.0.0', debtorId: '1', personId: 'p1', contactId: 'c1', templateId: 'MSG-RECORDATORIO-v1', body: 'x',
      basis: { portfolioAsOf: null, rulesVersion: '1.1.0', reviewId: null }, idempotencyKey: 'k',
    }, { tenantId: 't', appUserId: 'u' })).resolves.toEqual({ status: 'REJECTED', code: 'PROVIDER_NOT_CONFIGURED' })
  })

  it('cada validación del servidor tiene su código con texto, y ningún texto habla de envío o entrega', () => {
    for (const item of SERVER_CHECKS) expect(WHATSAPP_ERROR_TEXT[item.code as WhatsAppErrorCode]).toBeTruthy()
    for (const text of Object.values(WHATSAPP_ERROR_TEXT)) expect(text).not.toMatch(/\benviado\b|\bentregado\b|\bintimado\b/i)
  })
})
