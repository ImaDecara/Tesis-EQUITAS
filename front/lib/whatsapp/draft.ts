import { recordedDecisionText } from '@/components/case/case-explanation'
import type { RecordedDecisionView } from '@/components/case/recorded-decision-summary'
import { INTENSE_FROM } from '@/lib/domain/case-review-contract'
import { reviewActionLabel } from '@/lib/domain/case-review-form'
import { ACTIVE_RULES } from '@/lib/domain/decision-rules-v1'
import { STALE_LABEL } from '@/lib/domain/recorded-decision'
import { formatDate } from '@/lib/utils'
import type { DebtorContactItem, DebtorPersonItem } from '@/types/equitas-domain'

// Borrador de un mensaje informativo para WhatsApp, armado en el navegador. Funciones puras: no leen
// la base, no guardan nada y no envían nada. El servidor, cuando exista un proveedor, repite todas
// estas validaciones (ver `contract.ts`, SERVER_CHECKS).
//
// Tres cosas que no se mezclan: la recomendación automática (sistema), la decisión registrada (una
// persona) y la aprobación (otra persona). La analítica no interviene en nada de esto.

export const DRAFT_MAX_CHARS = 1024
export const MISSING_DATE_MARKER = '[fecha de los registros]'

export type ImpedimentCode =
  | 'DECISION_UNREADABLE' | 'DECISION_FORBIDDEN' | 'DECISION_STALE' | 'APPROVAL_PENDING' | 'APPROVAL_OBJECTED'
  | 'INTENSE_ACTION' | 'RECOMMENDATION_REJECTED' | 'DECISION_POSTPONED' | 'CASE_DERIVED' | 'NO_RECOMMENDATION'
  | 'REVIEW_REQUIRED' | 'NO_MESSAGE_FOR_ACTION'
  | 'CONTACTS_UNREADABLE' | 'NO_PHONE' | 'PERSON_REQUIRED' | 'CONTACT_REQUIRED'
  | 'EMPTY' | 'TOO_LONG' | 'PLACEHOLDER' | 'FORBIDDEN_TERM' | 'LINK'

export type Impediment = Readonly<{ code: ImpedimentCode; text: string }>

export type PhoneOption = Readonly<{ contactId: string; channel: string; value: string }>
export type Recipient = Readonly<{ personId: string; personName: string; relation: string; phones: readonly PhoneOption[] }>

export type DraftBasis = Readonly<{
  /** De dónde sale la acción del mensaje. */
  source: 'DECISION' | 'RECOMMENDATION' | 'NONE'
  /** «Decisión registrada: Recomendación aceptada: Recordatorio (intensidad 1)». */
  label: string
  /** Explicación breve para la persona. */
  note: string
  reviewId: string | null
}>

export type DraftContext = Readonly<{
  caseRef: { debtorId: string; identifier: string; type: string }
  basis: DraftBasis
  templateId: string | null
  initialText: string
  /** Impedimentos del caso: no dependen de lo que la persona elija o escriba. */
  caseImpediments: readonly Impediment[]
  recipients: readonly Recipient[]
  contactsReadFailed: boolean
  /** Contactos telefónicos cargados como inactivos: no se ofrecen. */
  inactivePhones: number
  moduleMissing: boolean
  portfolioAsOf: string | null
  rulesVersion: string
}>

export type DraftCaseInput = Readonly<{
  debtorId: string
  identifier: string
  type: string
  /** La recomendación automática del caso; null si las reglas no lo pudieron evaluar. */
  recommendation: { intervention: string; intensity: number; templateId: string | null; reviewRequired: boolean } | null
  recorded: RecordedDecisionView
  /** Fecha de corte acreditada; null si la base no la registra. */
  portfolioAsOf: string | null
  moduleMissing: boolean
  people: readonly DebtorPersonItem[]
  contacts: readonly DebtorContactItem[]
  contactsReadFailed: boolean
}>

const messages = ACTIVE_RULES.mensajes_borrador
const TEMPLATES: Readonly<Record<string, string>> = messages.plantillas
const SELECTION: Readonly<Record<string, string>> = messages.seleccion

const impediment = (code: ImpedimentCode, text: string): Impediment => ({ code, text })

/** La plantilla que las reglas activas asignan a una acción, con la misma clave que usa la evaluación. */
export function templateForAction(intervention: string, intensity: number): string | null {
  const key = intervention === 'SEGUIMIENTO' ? `${intervention}_intensidad_${intensity}` : intervention
  const id = SELECTION[key]
  return id && id in TEMPLATES ? id : null
}

/** Completa los marcadores permitidos. Sin fecha de corte acreditada deja un marcador visible. */
export function fillTemplate(templateId: string, values: { type: string; identifier: string; asOf: string | null }): string {
  const template = TEMPLATES[templateId]
  if (!template) return ''
  return template
    .replaceAll('{tipo_objeto}', values.type)
    .replaceAll('{identificador_objeto}', values.identifier)
    .replaceAll('{fecha_corte}', values.asOf ? formatDate(values.asOf) : MISSING_DATE_MARKER)
}

const ascii = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

const PHONE_CHANNELS = ['tel', 'cel', 'movil', 'whats']
const digitCount = (value: string) => value.replace(/\D/g, '').length

/** Un contacto es telefónico por su canal; si el canal no se pudo leer, por la forma del valor. */
export function isPhoneContact(contact: Pick<DebtorContactItem, 'channel' | 'value'>): boolean {
  if (contact.value.includes('@') || digitCount(contact.value) < 8) return false
  const channel = ascii(contact.channel)
  if (PHONE_CHANNELS.some(prefix => channel.includes(prefix))) return true
  return channel === 'no disponible' && /^[+\d\s().-]+$/.test(contact.value.trim())
}

function recipientsOf(people: readonly DebtorPersonItem[], contacts: readonly DebtorContactItem[]) {
  const phones = contacts.filter(isPhoneContact)
  const recipients = people.flatMap(person => {
    const own = phones.filter(contact => contact.personId === person.id && contact.isActive)
    return own.length ? [{ personId: person.id, personName: person.name, relation: person.relation, phones: own.map(({ id, channel, value }) => ({ contactId: id, channel, value })) }] : []
  })
  return { recipients, inactivePhones: phones.filter(contact => !contact.isActive).length }
}

type Resolved = { basis: DraftBasis; templateId: string | null; impediments: Impediment[] }

function fromRecorded(view: Extract<RecordedDecisionView, { kind: 'recorded' }>): Resolved {
  const { decision } = view
  const label = `Decisión registrada: ${recordedDecisionText(decision.decision, decision.decidedIntervention, decision.decidedIntensity)}`
  const basis: DraftBasis = { source: 'DECISION', label, note: 'El mensaje sigue la decisión que registró una persona, no la recomendación automática.', reviewId: decision.reviewId }
  const impediments: Impediment[] = []
  if (decision.stale) impediments.push(impediment('DECISION_STALE', `${STALE_LABEL}: revisá el caso y registrá una decisión con los datos vigentes antes de preparar un mensaje.`))
  if (decision.status === 'PENDIENTE_APROBACION') impediments.push(impediment('APPROVAL_PENDING', 'La propuesta espera la aprobación de otra persona: no se prepara como si estuviera aprobada.'))
  if (decision.status === 'OBJETADA') impediments.push(impediment('APPROVAL_OBJECTED', 'Otra persona objetó la propuesta: hace falta una decisión nueva.'))
  if (decision.decision === 'RECHAZA') impediments.push(impediment('RECOMMENDATION_REJECTED', 'La recomendación automática fue rechazada: no hay una acción decidida que comunicar.'))
  if (decision.decision === 'POSPONE') impediments.push(impediment('DECISION_POSTPONED', 'La decisión quedó pospuesta: todavía no hay una acción que comunicar.'))
  if (decision.decision === 'DERIVA') impediments.push(impediment('CASE_DERIVED', 'El caso fue derivado: la comunicación la define el área que lo recibe.'))
  const { decidedIntervention: intervention, decidedIntensity: intensity } = decision
  if (intervention === null || intensity === null) return { basis, templateId: null, impediments }
  if (intensity >= INTENSE_FROM) {
    impediments.push(impediment('INTENSE_ACTION', `«${reviewActionLabel(intervention, intensity)}» no se prepara por este canal, esté aprobada o no: las intimaciones y derivaciones se evalúan por separado.`))
    return { basis, templateId: null, impediments }
  }
  const templateId = templateForAction(intervention, intensity)
  if (!templateId && impediments.length === 0) impediments.push(noMessage(intervention, intensity))
  return { basis, templateId, impediments }
}

const noMessage = (intervention: string, intensity: number) =>
  impediment('NO_MESSAGE_FOR_ACTION', `«${reviewActionLabel(intervention, intensity)}» no lleva mensaje: las reglas no prevén contacto con el contribuyente para esa acción.`)

function fromRecommendation(input: DraftCaseInput): Resolved {
  const note = input.moduleMissing
    ? 'En esta base no se registran decisiones: el borrador parte de la recomendación automática y no registra ninguna decisión ni aprobación.'
    : 'Todavía no hay una decisión registrada: el borrador parte de la recomendación automática, que no es una decisión.'
  const recommendation = input.recommendation
  if (!recommendation) {
    return {
      basis: { source: 'NONE', label: 'Recomendación automática: no disponible', note, reviewId: null },
      templateId: null,
      impediments: [impediment('NO_RECOMMENDATION', 'No se pudo calcular la recomendación automática de este caso: no hay una acción que comunicar.')],
    }
  }
  const action = reviewActionLabel(recommendation.intervention, recommendation.intensity)
  const impediments: Impediment[] = []
  if (recommendation.reviewRequired) impediments.push(impediment('REVIEW_REQUIRED', 'El caso requiere revisión caso por caso antes de cualquier comunicación.'))
  if (!recommendation.templateId) impediments.push(noMessage(recommendation.intervention, recommendation.intensity))
  return { basis: { source: 'RECOMMENDATION', label: `Recomendación automática: ${action}`, note, reviewId: null }, templateId: recommendation.templateId, impediments }
}

function resolveBasis(input: DraftCaseInput): Resolved {
  const { recorded } = input
  if (recorded.kind === 'unavailable') {
    return { basis: { source: 'NONE', label: 'Decisión registrada: no se pudo leer', note: 'No se sabe si hay una decisión vigente.', reviewId: null },
      templateId: null, impediments: [impediment('DECISION_UNREADABLE', 'No se pudo leer la decisión registrada: no se sabe si hay una vigente. Recargá la página.')] }
  }
  if (recorded.kind === 'forbidden') {
    return { basis: { source: 'NONE', label: 'Decisión registrada: tu cuenta no la puede ver', note: 'Sin ver la decisión no se puede preparar un mensaje.', reviewId: null },
      templateId: null, impediments: [impediment('DECISION_FORBIDDEN', 'Tu cuenta no puede ver la decisión registrada del caso.')] }
  }
  return recorded.kind === 'recorded' ? fromRecorded(recorded) : fromRecommendation(input)
}

/** Todo lo que el panel necesita del caso. Se calcula en el servidor con datos que la ficha ya leyó. */
export function buildDraftContext(input: DraftCaseInput): DraftContext {
  const { basis, templateId, impediments } = resolveBasis(input)
  const { recipients, inactivePhones } = input.contactsReadFailed ? { recipients: [], inactivePhones: 0 } : recipientsOf(input.people, input.contacts)
  return {
    caseRef: { debtorId: input.debtorId, identifier: input.identifier, type: input.type },
    basis,
    templateId,
    initialText: templateId ? fillTemplate(templateId, { type: input.type, identifier: input.identifier, asOf: input.portfolioAsOf }) : '',
    caseImpediments: impediments,
    recipients,
    contactsReadFailed: input.contactsReadFailed,
    inactivePhones,
    moduleMissing: input.moduleMissing,
    portfolioAsOf: input.portfolioAsOf,
    rulesVersion: ACTIVE_RULES.version,
  }
}

export type DraftSelection = Readonly<{ personId: string; contactId: string }>

/** Con una sola opción se elige sola; con varias, la persona tiene que elegir. */
export function effectiveSelection(recipients: readonly Recipient[], chosen: DraftSelection): { recipient: Recipient | null; phone: PhoneOption | null } {
  const recipient = recipients.length === 1 ? recipients[0] : recipients.find(item => item.personId === chosen.personId) ?? null
  if (!recipient) return { recipient: null, phone: null }
  const phone = recipient.phones.length === 1 ? recipient.phones[0] : recipient.phones.find(item => item.contactId === chosen.contactId) ?? null
  return { recipient, phone }
}

export function selectionImpediments(context: Pick<DraftContext, 'recipients' | 'contactsReadFailed' | 'inactivePhones'>, chosen: DraftSelection): Impediment[] {
  if (context.contactsReadFailed) return [impediment('CONTACTS_UNREADABLE', 'No se pudieron leer los contactos del caso: esto no significa que no tenga. Recargá la página.')]
  if (context.recipients.length === 0) {
    const inactive = context.inactivePhones === 0 ? '' : context.inactivePhones === 1 ? ' Hay 1 cargado como inactivo.' : ` Hay ${context.inactivePhones} cargados como inactivos.`
    return [impediment('NO_PHONE', `Ninguna persona vinculada al caso tiene un teléfono activo cargado.${inactive}`)]
  }
  const { recipient, phone } = effectiveSelection(context.recipients, chosen)
  if (!recipient) return [impediment('PERSON_REQUIRED', 'Elegí a qué persona va dirigido el mensaje.')]
  return phone ? [] : [impediment('CONTACT_REQUIRED', `Elegí cuál de los teléfonos de ${recipient.personName} usar.`)]
}

const FORBIDDEN_TERMS: readonly string[] = messages.prohibido_en_texto

/** Validaciones del texto. El servidor las repite sobre el texto final. */
export function validateDraftText(text: string): Impediment[] {
  const trimmed = text.trim()
  if (!trimmed) return [impediment('EMPTY', 'El mensaje está vacío.')]
  const found: Impediment[] = []
  if (text.length > DRAFT_MAX_CHARS) found.push(impediment('TOO_LONG', `El mensaje tiene ${text.length.toLocaleString('es-AR')} caracteres; el tope es ${DRAFT_MAX_CHARS.toLocaleString('es-AR')}.`))
  const markers = text.match(/\{[^}]*\}|\[[^\]]*\]/g)
  if (markers) found.push(impediment('PLACEHOLDER', `Completá o quitá ${markers.map(marker => `«${marker}»`).join(', ')} antes de usar el texto.`))
  const normalized = ascii(text)
  const terms = FORBIDDEN_TERMS.filter(term => normalized.includes(ascii(term)))
  if (terms.length) found.push(impediment('FORBIDDEN_TERM', `Las reglas no permiten en un mensaje informativo: ${terms.map(term => `«${term}»`).join(', ')}.`))
  if (/https?:\/\/|www\./i.test(text)) found.push(impediment('LINK', 'No incluyas enlaces: el mensaje no lleva a pagos ni a sitios externos.'))
  return found
}

/** Todos los impedimentos vigentes. Sin ninguno, el borrador se puede copiar. */
export function draftImpediments(context: DraftContext, chosen: DraftSelection, text: string): Impediment[] {
  if (context.caseImpediments.length > 0) return [...context.caseImpediments]
  return [...selectionImpediments(context, chosen), ...validateDraftText(text)]
}
