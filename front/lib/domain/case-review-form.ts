import {
  CASE_REVIEW_MESSAGES,
  CASE_REVIEW_STATUS_LABELS,
  INTENSE_FROM,
  reasonTextFailure,
  type ApprovalDecision,
  type ApproveCaseDecisionResult,
  type CaseReviewDecision,
  type CaseReviewErrorCode,
  type CaseReviewSnapshot,
  type RecordCaseDecisionResult,
  type SnapshotChange,
} from '@/lib/domain/case-review-contract'
import type { FlagCode } from '@/lib/domain/decision-rules-v1'

// ALIGN-021. Reglas del formulario de revisión, sin I/O ni React: las prueba Vitest sin DOM.
// La autoridad sigue en el servidor: esto evita un envío inútil y explica qué falta.

export const DECISION_LABELS: Readonly<Record<CaseReviewDecision, string>> = {
  ACEPTA: 'Aceptar la sugerencia',
  MODIFICA: 'Modificar la acción',
  RECHAZA: 'Rechazar la sugerencia',
  POSPONE: 'Posponer',
  DERIVA: 'Derivar',
}
export const APPROVAL_LABELS: Readonly<Record<ApprovalDecision, string>> = { APRUEBA: 'Aprobar la propuesta', OBJETA: 'Objetar la propuesta' }

// Intervención e intensidad son un solo control. Niveles 0 a 2: `contracts/decision-rules.v1.json`.
// Niveles 3 y 4: nombres de ALIGN-003; sus códigos son técnicos y no tienen contrato aprobado.
// El servidor valida solo el formato: ver docs/tesis/wireframe-revision.md §8.
export type ReviewAction = Readonly<{ key: string; intervention: string; intensity: number; label: string }>
const action = (intervention: string, intensity: number, label: string): ReviewAction =>
  ({ key: `${intervention}:${intensity}`, intervention, intensity, label })
export const REVIEW_ACTIONS: readonly ReviewAction[] = [
  action('MEJORAR_DATOS', 0, 'Mejorar datos (intensidad 0)'),
  action('REVISION_JURIDICA', 0, 'Revisión jurídica (intensidad 0)'),
  action('SEGUIMIENTO', 0, 'Seguimiento sin contacto (intensidad 0)'),
  action('SEGUIMIENTO', 1, 'Seguimiento con comunicación informativa (intensidad 1)'),
  action('RECORDATORIO_INFORMATIVO', 1, 'Recordatorio (intensidad 1)'),
  action('CONTACTO_PERSONAL_Y_PLAN', 2, 'Contacto y plan (intensidad 2)'),
  action('INTIMACION_ADMINISTRATIVA', 3, 'Intimación administrativa formal (intensidad 3, requiere supervisor)'),
  action('DERIVACION_PROCURACION', 4, 'Derivación a procuración o vía judicial (intensidad 4, requiere supervisor)'),
]

export function reviewActionLabel(intervention: string, intensity: number): string {
  return REVIEW_ACTIONS.find(item => item.intervention === intervention && item.intensity === intensity)?.label ?? `${intervention} (intensidad ${intensity})`
}

// Lista cerrada PROVISIONAL: no hay catálogo aprobado de `reason_code`. Se dice en pantalla
// para que no parezca un catálogo municipal, y no se lleva al servidor hasta que exista.
export type ReviewReason = Readonly<{ code: string; label: string }>
export const REVIEW_REASONS: readonly ReviewReason[] = [
  { code: 'DATOS_INCOMPLETOS', label: 'Datos del caso incompletos o incorrectos' },
  { code: 'VERIFICACION_JURIDICA', label: 'Requiere verificación jurídica' },
  { code: 'CANAL_NO_VALIDO', label: 'Canal de contacto no válido' },
  { code: 'GESTION_EN_CURSO', label: 'Ya hay una gestión en curso' },
  { code: 'ESPERA_DE_INFORMACION', label: 'A la espera de información' },
  { code: 'CORRESPONDE_A_OTRA_AREA', label: 'Corresponde a otra área' },
  { code: 'CRITERIO_DEL_SERVICIO', label: 'Otro criterio del servicio' },
]
export const OBJECTION_REASONS: readonly ReviewReason[] = [
  { code: 'LISTA_DE_CONTROL_INSUFICIENTE', label: 'La lista de control no alcanza' },
  { code: 'VERIFICACION_JURIDICA', label: 'Falta verificación jurídica' },
  { code: 'ALTERNATIVA_NO_OFRECIDA', label: 'No se ofreció una alternativa asistida' },
  { code: 'DATOS_CAMBIARON', label: 'Los datos cambiaron desde la propuesta' },
  { code: 'CRITERIO_DE_SUPERVISION', label: 'Otro criterio de supervisión' },
]
export const PROVISIONAL_REASONS_NOTICE = 'Lista provisional de esta versión: todavía no tiene aprobación del municipio.'

export function reasonLabel(code: string | null): string | null {
  if (code === null) return null
  return [...REVIEW_REASONS, ...OBJECTION_REASONS].find(reason => reason.code === code)?.label ?? code
}

export const FLAG_LABELS: Readonly<Record<FlagCode, string>> = {
  SIN_CONTACTO_ACTIVO: 'Sin contacto activo cargado',
  PORCENTAJES_NO_SUMAN_100: 'Los porcentajes declarados no suman 100',
  ESTADO_ORIGEN_NO_INFORMADO: 'Estado de origen no informado',
  PERIODO_NO_INFORMADO: 'Período fiscal no informado',
  FECHAS_INCONSISTENTES: 'Fechas inconsistentes',
  TIPO_PERSONA_DESCONOCIDO: 'Tipo de persona desconocido',
  VERIFICAR_PRESCRIPCION: 'Verificar posible prescripción: no afirma que esté prescripta',
}
export function flagLabel(code: string): string {
  return (FLAG_LABELS as Readonly<Record<string, string>>)[code] ?? code
}

export const CHANGE_LABELS: Readonly<Record<SnapshotChange, string>> = {
  INSUMOS: 'los datos del caso', VERSION: 'la versión de las reglas', CORTE: 'el corte publicado',
}

// Lista de control de ALIGN-003: casillas y códigos, sin texto libre.
const CHECKBOX_KEYS = ['estado_juridico_verificado', 'canal_valido', 'alternativa_asistida_ofrecida'] as const
export const CHECKBOX_LABELS: Readonly<Record<(typeof CHECKBOX_KEYS)[number], string>> = {
  estado_juridico_verificado: 'Estado jurídico y posible prescripción verificados por quien corresponde',
  canal_valido: 'Canal válido',
  alternativa_asistida_ofrecida: 'Alternativa asistida ofrecida',
}
export const HOUSEHOLD_LABELS = { CONSULTADA: 'Consultada', NO_DISPONIBLE: 'No disponible' } as const

export type ChecklistValues = Readonly<{
  situacion_hogar: '' | keyof typeof HOUSEHOLD_LABELS
  estado_juridico_verificado: boolean
  canal_valido: boolean
  alternativa_asistida_ofrecida: boolean
}>
export const EMPTY_CHECKLIST: ChecklistValues = { situacion_hogar: '', estado_juridico_verificado: false, canal_valido: false, alternativa_asistida_ofrecida: false }

export type DecisionFormValues = Readonly<{
  decision: CaseReviewDecision | ''
  action: string
  reasonCode: string
  reasonText: string
  checklist: ChecklistValues
}>
export const EMPTY_DECISION_FORM: DecisionFormValues = { decision: '', action: '', reasonCode: '', reasonText: '', checklist: EMPTY_CHECKLIST }

export type ApprovalFormValues = Readonly<{ decision: ApprovalDecision | ''; reasonCode: string; checklist: ChecklistValues }>
export const EMPTY_APPROVAL_FORM: ApprovalFormValues = { decision: '', reasonCode: '', checklist: EMPTY_CHECKLIST }

export type FormErrors = Partial<Record<'decision' | 'action' | 'reasonCode' | 'reasonText' | keyof ChecklistValues, string>>
export type FieldKey = keyof FormErrors

const findAction = (key: string) => REVIEW_ACTIONS.find(item => item.key === key)

export function decisionFields({ decision, action: key }: Pick<DecisionFormValues, 'decision' | 'action'>) {
  const showAction = decision === 'MODIFICA' || decision === 'DERIVA'
  return {
    showAction,
    actionRequired: decision === 'MODIFICA',
    showReason: decision !== '' && decision !== 'ACEPTA',
    intense: showAction && (findAction(key)?.intensity ?? 0) >= INTENSE_FROM,
  }
}

const suggestedKey = (snapshot: CaseReviewSnapshot) => `${snapshot.suggestedIntervention}:${snapshot.suggestedIntensity}`

export function actionOptionsFor(decision: DecisionFormValues['decision'], snapshot: CaseReviewSnapshot): readonly ReviewAction[] {
  if (decision === 'MODIFICA') return REVIEW_ACTIONS.filter(item => item.key !== suggestedKey(snapshot))
  return decision === 'DERIVA' ? REVIEW_ACTIONS : []
}

export const reasonCharCount = (text: string) => [...text].length

function checklistErrors(checklist: ChecklistValues): FormErrors {
  const errors: FormErrors = {}
  if (checklist.situacion_hogar === '') errors.situacion_hogar = 'Indica si la situación del hogar se consultó o no está disponible.'
  for (const key of CHECKBOX_KEYS) {
    if (!checklist[key]) errors[key] = `Falta confirmar: ${CHECKBOX_LABELS[key].toLowerCase()}.`
  }
  return errors
}

export function validateDecisionForm(values: DecisionFormValues, snapshot: CaseReviewSnapshot): FormErrors {
  if (values.decision === '') return { decision: 'Elige una decisión.' }
  const fields = decisionFields(values)
  const errors: FormErrors = {}
  if (fields.showAction) {
    if (values.action === '') {
      if (fields.actionRequired) errors.action = 'Elige la acción que propones.'
    } else if (!findAction(values.action)) {
      errors.action = CASE_REVIEW_MESSAGES.DECISION_FIELDS_INVALID
    } else if (values.decision === 'MODIFICA' && values.action === suggestedKey(snapshot)) {
      errors.action = CASE_REVIEW_MESSAGES.MODIFICA_WITHOUT_CHANGE
    }
  }
  if (fields.showReason) {
    if (values.reasonCode === '') errors.reasonCode = CASE_REVIEW_MESSAGES.REASON_REQUIRED
    const textFailure = values.reasonText === '' ? null : reasonTextFailure(values.reasonText)
    if (textFailure) errors.reasonText = CASE_REVIEW_MESSAGES[textFailure]
  }
  return fields.intense ? { ...errors, ...checklistErrors(values.checklist) } : errors
}

// Lo que quedó oculto no viaja: solo lo que la persona tiene a la vista.
export function buildRecordInput(values: DecisionFormValues, snapshot: CaseReviewSnapshot) {
  const fields = decisionFields(values)
  const chosen = fields.showAction ? findAction(values.action) : undefined
  return {
    debtorId: snapshot.debtorId,
    decision: values.decision,
    expected: { asOf: snapshot.asOf, rulesVersion: snapshot.rulesVersion, inputsHash: snapshot.inputsHash },
    supersedes: snapshot.currentReviewId,
    decidedIntervention: chosen?.intervention ?? null,
    decidedIntensity: chosen?.intensity ?? null,
    reasonCode: fields.showReason ? values.reasonCode : null,
    reasonText: fields.showReason && values.reasonText !== '' ? values.reasonText : null,
    checklist: fields.intense ? values.checklist : {},
  }
}

export function validateApprovalForm(values: ApprovalFormValues, { approveBlocked }: { approveBlocked: boolean }): FormErrors {
  if (values.decision === '') return { decision: 'Elige aprobar u objetar.' }
  if (values.decision === 'OBJETA') return values.reasonCode === '' ? { reasonCode: CASE_REVIEW_MESSAGES.REASON_REQUIRED } : {}
  if (approveBlocked) return { decision: CASE_REVIEW_MESSAGES.CUTOFF_NOT_AVAILABLE }
  return checklistErrors(values.checklist)
}

export function buildApprovalInput(values: ApprovalFormValues, caseReviewId: string, supersedes: string | null) {
  const approves = values.decision === 'APRUEBA'
  return {
    caseReviewId,
    decision: values.decision,
    reasonCode: approves ? null : values.reasonCode,
    checklist: approves ? values.checklist : {},
    supersedes,
  }
}

export type ReviewNotice =
  | Readonly<{ kind: 'recorded' | 'conflict' | 'cutoff' | 'rejected' | 'crash'; message: string }>
  | Readonly<{ kind: 'outdated'; message: string; changed: readonly SnapshotChange[]; current: CaseReviewSnapshot }>
export type ReviewOutcome = ReviewNotice | Readonly<{ kind: 'field'; field: FieldKey; message: string }>

const FIELD_BY_CODE: Partial<Record<CaseReviewErrorCode, FieldKey>> = {
  REASON_REQUIRED: 'reasonCode',
  REASON_TEXT_BLANK: 'reasonText',
  REASON_TEXT_TOO_LONG: 'reasonText',
  REASON_TEXT_INVALID: 'reasonText',
  CHECKLIST_REQUIRED: 'situacion_hogar',
  CHECKLIST_INVALID: 'situacion_hogar',
  MODIFICA_WITHOUT_CHANGE: 'action',
  DECISION_FIELDS_INVALID: 'action',
}
const CONFLICT_CODES: readonly CaseReviewErrorCode[] = ['REVIEW_CONFLICT', 'APPROVAL_CONFLICT', 'REVIEW_SUPERSEDED', 'SUPERSEDES_NOT_FOUND']

export type ReviewActionResult = RecordCaseDecisionResult | ApproveCaseDecisionResult

export function interpretResult(result: ReviewActionResult): ReviewOutcome {
  if (result.ok) {
    const label = `${CASE_REVIEW_STATUS_LABELS[result.status]}.`
    return { kind: 'recorded', message: result.created ? label : `${label} Ya estaba registrada: no se duplicó.` }
  }
  const { code, message } = result
  if (code === 'SUGGESTION_OUTDATED' && result.current) return { kind: 'outdated', message, changed: result.changed ?? [], current: result.current }
  if (code === 'CUTOFF_NOT_AVAILABLE') return { kind: 'cutoff', message }
  if (CONFLICT_CODES.includes(code)) return { kind: 'conflict', message }
  const field = FIELD_BY_CODE[code]
  return field ? { kind: 'field', field, message } : { kind: 'rejected', message }
}

export type ReviewFormState<V> = Readonly<{
  values: V
  empty: V
  errors: FormErrors
  notice: ReviewNotice | null
  current: CaseReviewSnapshot | null
  focusTick: number
}>
export type ReviewFormEvent<V> =
  | Readonly<{ type: 'change'; patch: Partial<V> }>
  | Readonly<{ type: 'invalid'; errors: FormErrors }>
  | Readonly<{ type: 'outcome'; outcome: ReviewOutcome }>
  | Readonly<{ type: 'reloaded' }>

export function initialReviewFormState<V>(empty: V): ReviewFormState<V> {
  return { values: empty, empty, errors: {}, notice: null, current: null, focusTick: 0 }
}

// Un cambio borra el error de ese campo. En la lista, solo el de lo que ya se completó.
function clearedErrors<V extends { checklist: ChecklistValues }>(errors: FormErrors, patch: Partial<V>): FormErrors {
  const completed = Object.entries(patch.checklist ?? {}).filter(([, value]) => value !== '' && value !== false).map(([key]) => key)
  const cleared = new Set([...Object.keys(patch), ...completed])
  return Object.fromEntries(Object.entries(errors).filter(([key]) => !cleared.has(key)))
}

// Cambió la sugerencia o entró otra decisión: la elección anterior se descarta para que nadie
// confirme en silencio lo que no vio. Lo demás se conserva, para no volver a escribirlo.
const withoutDecision = <V extends { decision: string }>(values: V): V => ({ ...values, decision: '' })

export function reviewFormReducer<V extends { decision: string; checklist: ChecklistValues }>(state: ReviewFormState<V>, event: ReviewFormEvent<V>): ReviewFormState<V> {
  switch (event.type) {
    case 'change':
      return {
        ...state,
        values: { ...state.values, ...event.patch },
        errors: clearedErrors<V>(state.errors, event.patch),
        notice: state.notice?.kind === 'recorded' ? null : state.notice,
      }
    case 'invalid':
      return { ...state, errors: event.errors, notice: null, focusTick: state.focusTick + 1 }
    case 'reloaded':
      return { ...state, values: withoutDecision(state.values), errors: {}, notice: null, current: null }
    case 'outcome': {
      const { outcome } = event
      const focusTick = state.focusTick + 1
      if (outcome.kind === 'field') return { ...state, errors: { [outcome.field]: outcome.message }, notice: null, focusTick }
      if (outcome.kind === 'recorded') return { ...state, values: state.empty, errors: {}, notice: outcome, current: null, focusTick }
      if (outcome.kind === 'outdated') {
        return { ...state, values: withoutDecision(state.values), errors: {}, notice: outcome, current: outcome.current, focusTick }
      }
      return { ...state, errors: {}, notice: outcome, focusTick }
    }
  }
}

export const SUBMIT_CRASH_MESSAGE = 'No se pudo enviar: la conexión falló o la aplicación se actualizó. Recarga la página para continuar. Si ya había quedado guardado, no se duplica.'

export function submitReview<V>({ values, validate, send, dispatch, startTransition, refresh }: {
  values: V
  validate: (values: V) => FormErrors
  send: (values: V) => Promise<ReviewActionResult>
  dispatch: (event: ReviewFormEvent<V>) => void
  startTransition: (work: () => Promise<void>) => unknown
  refresh: () => void
}) {
  const errors = validate(values)
  if (Object.keys(errors).length > 0) {
    dispatch({ type: 'invalid', errors })
    return
  }
  startTransition(async () => {
    let outcome: ReviewOutcome
    try {
      outcome = interpretResult(await send(values))
    } catch {
      outcome = { kind: 'crash', message: SUBMIT_CRASH_MESSAGE }
    }
    dispatch({ type: 'outcome', outcome })
    if (outcome.kind === 'outdated') refresh()
  })
}

export type ExplanationFactor = Readonly<{ factor: string; input: number | null; points: number | null; maximum: number | null }>
export type ExplanationView = Readonly<{
  phrase: string | null
  rule: string | null
  flags: readonly string[]
  severity: Readonly<{ value: number | null; band: string | null; state: string | null; notEvaluable: number | null }>
  reviewRequired: boolean
  factors: readonly ExplanationFactor[]
}>

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown) => typeof value === 'string' ? value : null
const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null

// La explicación llega como JSON guardado: lo que no tenga la forma esperada queda como
// faltante. Nunca se convierte en cero.
export function readExplanation(explanation: Readonly<Record<string, unknown>>): ExplanationView {
  const severity = isRecord(explanation.severidad) ? explanation.severidad : {}
  const review = isRecord(explanation.revision) ? explanation.revision : {}
  const factors = Array.isArray(explanation.factores) ? explanation.factores.filter(isRecord) : []
  return {
    phrase: text(explanation.frase_contrastiva),
    rule: text(explanation.regla),
    flags: Array.isArray(explanation.banderas) ? explanation.banderas.filter((flag): flag is string => typeof flag === 'string') : [],
    severity: { value: num(severity.valor), band: text(severity.banda), state: text(severity.estado), notEvaluable: num(severity.obligaciones_no_evaluables) },
    reviewRequired: review.requiere_revision_humana === true,
    factors: factors.map(item => ({ factor: String(item.factor), input: num(item.insumo), points: num(item.puntos), maximum: num(item.maximo) })),
  }
}
