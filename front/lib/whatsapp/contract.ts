// Contrato mínimo para un futuro proveedor de WhatsApp. Versión 1.
//
// Hoy NO existe ningún proveedor ni ningún punto de envío: la aplicación solo arma un borrador en el
// navegador, que la persona copia. Este archivo fija lo que el proveedor va a recibir y devolver, para
// que quien lo implemente no tenga que adivinar. Guía: docs/entrega/final/WHATSAPP-PROVEEDOR.md.
//
// Reglas de evolución: se pueden agregar campos opcionales y códigos nuevos; no se renombra ni se quita.

export const WHATSAPP_CONTRACT_VERSION = '1.0.0' as const

/** Estado visible en la pantalla mientras no haya proveedor. */
export const WHATSAPP_PENDING_LABEL = 'Integración de WhatsApp pendiente' as const

/**
 * Lo que la pantalla le pasaría al servidor. Nada de esto autoriza: el servidor toma municipio y
 * persona usuaria de la sesión (nunca de este objeto) y vuelve a comprobar cada dato contra la base.
 */
export interface WhatsAppSubmission {
  contractVersion: typeof WHATSAPP_CONTRACT_VERSION
  /** Caso (objeto tributario) del municipio de la sesión. */
  debtorId: string
  /** Persona vinculada al caso y contacto de esa persona elegidos explícitamente. */
  personId: string
  contactId: string
  /** Plantilla de las reglas activas (`mensajes_borrador.plantillas`). */
  templateId: string
  /** Texto final, después de la edición de la persona. El servidor lo vuelve a validar completo. */
  body: string
  /** Sobre qué se preparó: si cambió, el servidor rechaza con `BASIS_OUTDATED`. */
  basis: {
    /** Fecha de la cartera (AAAA-MM-DD) o null si la base no registra un corte. */
    portfolioAsOf: string | null
    rulesVersion: string
    /** Decisión registrada vigente sobre la que se preparó; null si partió de la recomendación automática. */
    reviewId: string | null
  }
  /** Una por intento de la persona: repetir la misma clave nunca genera un segundo mensaje. */
  idempotencyKey: string
}

/** Por qué el servidor no aceptaría el pedido. Cada código tiene su texto en `WHATSAPP_ERROR_TEXT`. */
export type WhatsAppErrorCode =
  | 'PROVIDER_NOT_CONFIGURED'
  | 'AUTH_REQUIRED'
  | 'ROLE_FORBIDDEN'
  | 'MODULE_NOT_AVAILABLE'
  | 'CASE_NOT_IN_TENANT'
  | 'CONTACT_NOT_IN_CASE'
  | 'CONTACT_NOT_VERIFIED'
  | 'CONSENT_NOT_RECORDED'
  | 'DECISION_REQUIRED'
  | 'APPROVAL_REQUIRED'
  | 'BASIS_OUTDATED'
  | 'TEMPLATE_NOT_ALLOWED'
  | 'BODY_INVALID'
  | 'DUPLICATE_REQUEST'
  | 'PROVIDER_POLICY_REJECTED'
  | 'PROVIDER_UNAVAILABLE'

export const WHATSAPP_ERROR_TEXT: Readonly<Record<WhatsAppErrorCode, string>> = {
  PROVIDER_NOT_CONFIGURED: 'No hay un proveedor de WhatsApp configurado: no se envió nada.',
  AUTH_REQUIRED: 'Tenés que iniciar sesión para continuar.',
  ROLE_FORBIDDEN: 'Tu cuenta no tiene permiso para esta operación.',
  MODULE_NOT_AVAILABLE: 'No disponible en esta base: no tiene el módulo de decisiones.',
  CASE_NOT_IN_TENANT: 'El caso no existe en este municipio.',
  CONTACT_NOT_IN_CASE: 'El contacto no pertenece a una persona vinculada a este caso.',
  CONTACT_NOT_VERIFIED: 'El número no tiene WhatsApp verificado.',
  CONSENT_NOT_RECORDED: 'No hay un consentimiento registrado para escribir a este número.',
  DECISION_REQUIRED: 'Hace falta una decisión registrada y vigente para este caso.',
  APPROVAL_REQUIRED: 'La acción requiere la aprobación de otra persona y no la tiene.',
  BASIS_OUTDATED: 'La cartera, las reglas o la decisión cambiaron desde que se preparó el mensaje.',
  TEMPLATE_NOT_ALLOWED: 'La plantilla no corresponde a la acción vigente o no está aprobada.',
  BODY_INVALID: 'El texto no pasa las validaciones.',
  DUPLICATE_REQUEST: 'Este pedido ya se había recibido: no se repite.',
  PROVIDER_POLICY_REJECTED: 'El proveedor rechazó el mensaje por sus políticas de uso.',
  PROVIDER_UNAVAILABLE: 'No se pudo confirmar el pedido con el proveedor. No se sabe si llegó: no reintentes con otra clave.',
}

/**
 * Resultado. `ACCEPTED` significa que el proveedor recibió el pedido, no que el mensaje se entregó ni
 * que alguien lo leyó: la pantalla nunca lo presenta como «enviado» o «entregado».
 */
export type WhatsAppSubmissionResult =
  | { status: 'ACCEPTED'; providerReference: string; acceptedAt: string }
  | { status: 'REJECTED'; code: WhatsAppErrorCode }

/** Punto de extensión: lo implementa el proveedor, del lado del servidor. */
export interface WhatsAppProvider {
  /** Identificador estable del proveedor, para el registro de accesos. */
  readonly id: string
  submit(submission: WhatsAppSubmission, context: { tenantId: string; appUserId: string }): Promise<WhatsAppSubmissionResult>
}

/** Lo que hay hoy: ningún proveedor. Cualquier pedido vuelve rechazado y no sale nada. */
export const PENDING_PROVIDER: WhatsAppProvider = {
  id: 'pendiente',
  async submit() {
    return { status: 'REJECTED', code: 'PROVIDER_NOT_CONFIGURED' }
  },
}

/**
 * Validaciones que el servidor tiene que repetir aunque la pantalla ya las haya hecho. Las del
 * navegador son una ayuda para la persona; la autoridad es el servidor.
 */
export const SERVER_CHECKS: readonly { code: WhatsAppErrorCode; check: string }[] = [
  { code: 'AUTH_REQUIRED', check: 'Sesión válida; municipio y persona usuaria salen de la sesión, nunca del pedido.' },
  { code: 'ROLE_FORBIDDEN', check: 'Rol con permiso explícito para comunicar (hoy no existe: definirlo con el municipio).' },
  { code: 'MODULE_NOT_AVAILABLE', check: 'La base tiene el módulo de decisiones: sin él no hay decisión que respalde el mensaje.' },
  { code: 'CASE_NOT_IN_TENANT', check: 'El caso pertenece al municipio de la sesión.' },
  { code: 'CONTACT_NOT_IN_CASE', check: 'La persona está vinculada al caso y el contacto es suyo, activo y telefónico.' },
  { code: 'CONTACT_NOT_VERIFIED', check: 'El número tiene WhatsApp verificado por el proveedor.' },
  { code: 'CONSENT_NOT_RECORDED', check: 'Hay un consentimiento registrado y vigente para ese número.' },
  { code: 'DECISION_REQUIRED', check: 'Hay una decisión registrada vigente (no sobre datos anteriores, no rechazada ni pospuesta).' },
  { code: 'APPROVAL_REQUIRED', check: 'Las acciones de intensidad 3 o más no salen por este canal, aprobadas o no.' },
  { code: 'BASIS_OUTDATED', check: 'Fecha de la cartera, versión de reglas y decisión coinciden con las vigentes.' },
  { code: 'TEMPLATE_NOT_ALLOWED', check: 'La plantilla es la que las reglas asignan a la acción decidida y está aprobada (jurídica y por el proveedor).' },
  { code: 'BODY_INVALID', check: 'El texto pasa las mismas validaciones que en la pantalla (`validateDraftText`).' },
  { code: 'DUPLICATE_REQUEST', check: 'La clave de idempotencia no se usó antes; si se usó, se devuelve el mismo resultado.' },
]
