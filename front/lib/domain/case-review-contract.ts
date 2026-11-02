import { databaseId } from '@/lib/auth/tenant-access'

// ALIGN-020. Contrato de las acciones de revisión: forma de la entrada, reglas que no
// dependen de la base y códigos de resultado. Sin I/O: lo puede importar un formulario.
// La autoridad sigue en el servidor, que vuelve a validar y a recalcular todo.

export const CASE_REVIEW_DECISIONS = ['ACEPTA', 'MODIFICA', 'RECHAZA', 'POSPONE', 'DERIVA'] as const
export type CaseReviewDecision = (typeof CASE_REVIEW_DECISIONS)[number]
export const APPROVAL_DECISIONS = ['APRUEBA', 'OBJETA'] as const
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number]

// ALIGN-003: desde 3 la acción es intensa y requiere aprobación de supervisor.
export const INTENSE_FROM = 3
export const REASON_TEXT_MAX_CHARS = 500
export const REASON_TEXT_WARNING = 'No incluyas datos personales ni información del hogar.'

export const HOUSEHOLD_STATES = ['CONSULTADA', 'NO_DISPONIBLE'] as const
export type CaseReviewChecklist = Readonly<{
  situacion_hogar?: (typeof HOUSEHOLD_STATES)[number]
  estado_juridico_verificado?: boolean
  canal_valido?: boolean
  alternativa_asistida_ofrecida?: boolean
}>
const CHECKBOXES = ['estado_juridico_verificado', 'canal_valido', 'alternativa_asistida_ofrecida'] as const

// Mismos formatos que las restricciones de ALIGN-018: la base es la última palabra.
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/
const RULES_VERSION_FORMAT = /^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}$/
const HASH_FORMAT = /^[0-9a-f]{64}$/
const VISIBLE = /[^\s\p{Z}\p{C}]/u
const UNSTORABLE = /\u0000|\p{Cs}/u

export const CASE_REVIEW_MESSAGES = {
  SUPABASE_NOT_CONFIGURED: 'No disponible: el servicio de datos no está configurado.',
  AUTH_REQUIRED: 'Debes iniciar sesión para continuar.',
  AUTH_UNAVAILABLE: 'No disponible: no se pudo verificar la sesión.',
  APP_USER_NOT_FOUND: 'No se pudo resolver un usuario de aplicación vinculado a la sesión.',
  APP_USER_INACTIVE: 'El usuario de aplicación está inactivo.',
  TENANT_ACCESS_NOT_FOUND: 'No existe una membresía activa para este municipio.',
  TENANT_ACCESS_INACTIVE: 'La membresía del municipio está inactiva.',
  TENANT_SELECTION_REQUIRED: 'Seleccioná explícitamente un municipio para continuar.',
  TENANT_INACTIVE: 'El municipio no está disponible o está inactivo.',
  ROLE_FORBIDDEN: 'Tu rol no permite esta operación.',
  DATABASE_ERROR: 'No disponible: no se pudo verificar el acceso.',
  TABLE_FORBIDDEN: 'No disponible: esta consulta no está habilitada.',
  ACTOR_NOT_ACTIVE_MEMBER: 'Tu membresía en este municipio ya no está activa. Volvé a ingresar.',
  INVALID_INPUT: 'Los datos enviados no son válidos. Recargá la página e intentá de nuevo.',
  DECISION_FIELDS_INVALID: 'La intervención y la intensidad no corresponden a la decisión elegida.',
  MODIFICA_WITHOUT_CHANGE: 'Para modificar, elegí una intervención o una intensidad distinta de la sugerida.',
  REASON_REQUIRED: 'Indicá un motivo: es obligatorio al discrepar y para intensidad 3 o mayor.',
  REASON_TEXT_INVALID: 'El motivo contiene caracteres que no se pueden guardar. Volvé a escribirlo.',
  REASON_TEXT_TOO_LONG: `El motivo admite hasta ${REASON_TEXT_MAX_CHARS} caracteres, contando los espacios.`,
  REASON_TEXT_BLANK: 'El motivo no puede quedar en blanco: escribí un texto o dejalo sin completar.',
  CHECKLIST_REQUIRED: 'Completá la lista de control: es obligatoria para intensidad 3 o mayor y para aprobar.',
  CHECKLIST_INVALID: 'La lista de control solo admite sus casillas y códigos, sin texto libre.',
  OBJECT_NOT_IN_TENANT: 'El objeto no existe en este municipio.',
  REVIEW_NOT_IN_TENANT: 'La decisión no existe en este municipio.',
  CUTOFF_NOT_AVAILABLE: 'No hay un corte publicado y vigente: sin corte no se puede registrar una decisión.',
  SUGGESTION_UNAVAILABLE: 'No se pudo calcular la sugerencia con datos completos. Intentá de nuevo más tarde.',
  SUGGESTION_OUTDATED: 'Los datos o las reglas cambiaron desde que abriste el caso. Revisá la sugerencia vigente antes de confirmar.',
  REVIEW_CONFLICT: 'Ya hay otra decisión registrada sobre este objeto. Recargá el caso antes de continuar.',
  SUPERSEDES_NOT_FOUND: 'La decisión que querés reemplazar no existe en este caso. Recargá el historial.',
  SUPERSEDES_CHAIN_INVALID: 'El historial de esta decisión es inconsistente y no se puede aprobar. Avisá a quien administra el sistema.',
  APPROVER_IS_PROPONENT: 'Quien propuso la decisión no puede aprobarla: la aprueba otro supervisor.',
  APPROVAL_NOT_REQUIRED: 'Esta decisión es de intensidad menor a 3 y no requiere aprobación.',
  REVIEW_SUPERSEDED: 'Esta propuesta fue reemplazada por una decisión posterior. Revisá la vigente.',
  APPROVAL_CONFLICT: 'Ya hay otra aprobación u objeción registrada para esta decisión. Recargá el caso.',
  WRITE_NOT_CONFIGURED: 'No disponible: el registro de decisiones no está configurado en este entorno.',
  WRITE_REJECTED: 'La base rechazó el registro. Revisá los datos e intentá de nuevo.',
  WRITE_UNAVAILABLE: 'No se pudo confirmar el registro. Reintentá: si ya había quedado guardado, no se duplica.',
} as const
export type CaseReviewErrorCode = keyof typeof CASE_REVIEW_MESSAGES

export type ExpectedSuggestion = Readonly<{ asOf: string; rulesVersion: string; inputsHash: string }>
export type DecidedAction = Readonly<{ intervention: string; intensity: number }>
export type RecordCaseDecisionInput = Readonly<{
  debtorId: string
  decision: CaseReviewDecision
  expected: ExpectedSuggestion
  supersedes: string | null
  decided: DecidedAction | null
  reasonCode: string | null
  reasonText: string | null
  checklist: CaseReviewChecklist
}>
export type ApproveCaseDecisionInput = Readonly<{
  caseReviewId: string
  decision: ApprovalDecision
  reasonCode: string | null
  checklist: CaseReviewChecklist
  supersedes: string | null
}>

// Lo que la pantalla muestra y envía de vuelta como `expected`. Sin datos personales.
export type CaseReviewSnapshot = Readonly<{
  debtorId: string
  asOf: string
  rulesVersion: string
  inputsHash: string
  suggestedIntervention: string
  suggestedIntensity: number
  explanation: Readonly<Record<string, unknown>>
  currentReviewId: string | null
}>
export type SnapshotChange = 'INSUMOS' | 'VERSION' | 'CORTE'

export type CaseReviewFailure = Readonly<{
  ok: false
  code: CaseReviewErrorCode
  message: string
  // Solo con SUGGESTION_OUTDATED: qué cambió y lo vigente, para volver a mostrarlo.
  changed?: readonly SnapshotChange[]
  current?: CaseReviewSnapshot
}>
export type RecordCaseDecisionResult = CaseReviewFailure | Readonly<{
  ok: true
  reviewId: string
  debtorId: string
  created: boolean
  status: 'REGISTRADA' | 'PENDIENTE_SUPERVISOR'
  asOf: string
  rulesVersion: string
  inputsHash: string
  suggestedIntervention: string
  suggestedIntensity: number
}>
export type ApproveCaseDecisionResult = CaseReviewFailure | Readonly<{
  ok: true
  approvalId: string
  caseReviewId: string
  debtorId: string
  created: boolean
  status: 'APROBADA' | 'OBJETADA'
}>
export type CaseReviewSnapshotResult = CaseReviewFailure | Readonly<{ ok: true; snapshot: CaseReviewSnapshot }>

export function caseReviewFailure(code: CaseReviewErrorCode): CaseReviewFailure {
  return { ok: false, code, message: CASE_REVIEW_MESSAGES[code] }
}

type Parsed<T> = { ok: true; value: T } | { ok: false; code: CaseReviewErrorCode }
const rejected = (code: CaseReviewErrorCode) => ({ ok: false, code }) as const

// La entrada de una Server Action es un POST ajeno: un campo desconocido, como el
// tenant, el actor o el hash, no se ignora. Se rechaza para que no parezca aceptado.
function plainRecord(raw: unknown, allowed: readonly string[]): Record<string, unknown> | null {
  if (raw === null || typeof raw !== 'object') return null
  const prototype: unknown = Object.getPrototypeOf(raw)
  if (prototype !== Object.prototype && prototype !== null) return null
  return Object.keys(raw).every(key => allowed.includes(key)) ? raw as Record<string, unknown> : null
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): T | null {
  return (options as readonly unknown[]).includes(value) ? value as T : null
}

// undefined = mal formado; null = ausente.
function optionalId(value: unknown): string | null | undefined {
  return value === undefined || value === null ? null : databaseId(value) ?? undefined
}

function optionalCode(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null
  return typeof value === 'string' && CODE.test(value) ? value : undefined
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function parseExpected(raw: unknown): ExpectedSuggestion | null {
  const value = plainRecord(raw, ['asOf', 'rulesVersion', 'inputsHash'])
  if (!value || !isIsoDate(value.asOf)) return null
  const { asOf, rulesVersion, inputsHash } = value
  return typeof rulesVersion === 'string' && RULES_VERSION_FORMAT.test(rulesVersion) &&
    typeof inputsHash === 'string' && HASH_FORMAT.test(inputsHash)
    ? { asOf, rulesVersion, inputsHash }
    : null
}

function parseChecklist(raw: unknown): CaseReviewChecklist | null {
  if (raw === undefined || raw === null) return {}
  const value = plainRecord(raw, ['situacion_hogar', ...CHECKBOXES])
  if (!value) return null
  if ('situacion_hogar' in value && !oneOf(value.situacion_hogar, HOUSEHOLD_STATES)) return null
  if (CHECKBOXES.some(key => key in value && typeof value[key] !== 'boolean')) return null
  return value as CaseReviewChecklist
}

function isChecklistComplete(checklist: CaseReviewChecklist): boolean {
  return checklist.situacion_hogar !== undefined && CHECKBOXES.every(key => checklist[key] === true)
}

// undefined = mal formado. Sin par o con par completo: nunca una intensidad sola.
function parseDecided(intervention: unknown, intensity: unknown): DecidedAction | null | undefined {
  if ((intervention ?? null) === null && (intensity ?? null) === null) return null
  if (typeof intervention !== 'string' || !CODE.test(intervention)) return undefined
  if (typeof intensity !== 'number' || !Number.isInteger(intensity) || intensity < 0 || intensity > 4) return undefined
  return { intervention, intensity }
}

function reasonTextFailure(value: unknown): CaseReviewErrorCode | null {
  if (typeof value !== 'string' || UNSTORABLE.test(value)) return 'REASON_TEXT_INVALID'
  // Como char_length de PostgreSQL: puntos de código, no unidades UTF-16.
  if ([...value].length > REASON_TEXT_MAX_CHARS) return 'REASON_TEXT_TOO_LONG'
  return VISIBLE.test(value) ? null : 'REASON_TEXT_BLANK'
}

const RECORD_FIELDS = ['debtorId', 'decision', 'expected', 'supersedes', 'decidedIntervention', 'decidedIntensity', 'reasonCode', 'reasonText', 'checklist']

export function parseRecordCaseDecisionInput(raw: unknown): Parsed<RecordCaseDecisionInput> {
  const input = plainRecord(raw, RECORD_FIELDS)
  if (!input) return rejected('INVALID_INPUT')
  const debtorId = databaseId(input.debtorId)
  const decision = oneOf(input.decision, CASE_REVIEW_DECISIONS)
  const expected = parseExpected(input.expected)
  const supersedes = optionalId(input.supersedes)
  const decided = parseDecided(input.decidedIntervention, input.decidedIntensity)
  const reasonCode = optionalCode(input.reasonCode)
  if (!debtorId || !decision || !expected || supersedes === undefined || decided === undefined || reasonCode === undefined) {
    return rejected('INVALID_INPUT')
  }
  // ACEPTA copia la sugerencia recalculada; RECHAZA y POSPONE no deciden una intervención.
  if ((decision === 'MODIFICA') !== (decided !== null) && decision !== 'DERIVA') return rejected('DECISION_FIELDS_INVALID')
  const reasonText = input.reasonText ?? null
  if (reasonCode === null && (decision !== 'ACEPTA' || reasonText !== null)) return rejected('REASON_REQUIRED')
  const textFailure = reasonText === null ? null : reasonTextFailure(reasonText)
  if (textFailure) return rejected(textFailure)
  const checklist = parseChecklist(input.checklist)
  if (!checklist) return rejected('CHECKLIST_INVALID')
  if ((decided?.intensity ?? 0) >= INTENSE_FROM && !isChecklistComplete(checklist)) return rejected('CHECKLIST_REQUIRED')
  return {
    ok: true,
    value: { debtorId, decision, expected, supersedes, decided, reasonCode, reasonText: reasonText as string | null, checklist },
  }
}

export function parseApproveCaseDecisionInput(raw: unknown): Parsed<ApproveCaseDecisionInput> {
  const input = plainRecord(raw, ['caseReviewId', 'decision', 'reasonCode', 'checklist', 'supersedes'])
  if (!input) return rejected('INVALID_INPUT')
  const caseReviewId = databaseId(input.caseReviewId)
  const decision = oneOf(input.decision, APPROVAL_DECISIONS)
  const supersedes = optionalId(input.supersedes)
  const reasonCode = optionalCode(input.reasonCode)
  if (!caseReviewId || !decision || supersedes === undefined || reasonCode === undefined) return rejected('INVALID_INPUT')
  const checklist = parseChecklist(input.checklist)
  if (!checklist) return rejected('CHECKLIST_INVALID')
  if (decision === 'APRUEBA' && !isChecklistComplete(checklist)) return rejected('CHECKLIST_REQUIRED')
  if (decision === 'OBJETA' && reasonCode === null) return rejected('REASON_REQUIRED')
  return { ok: true, value: { caseReviewId, decision, reasonCode, checklist, supersedes } }
}
