import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CASE_REVIEW_MESSAGES,
  caseReviewFailure,
  parseApproveCaseDecisionInput,
  parseRecordCaseDecisionInput,
  type CaseReviewSnapshot,
} from '@/lib/domain/case-review-contract'
import {
  actionOptionsFor,
  buildApprovalInput,
  buildRecordInput,
  decisionFields,
  EMPTY_APPROVAL_FORM,
  EMPTY_CHECKLIST,
  EMPTY_DECISION_FORM,
  FLAG_LABELS,
  flagLabel,
  initialReviewFormState,
  interpretResult,
  OBJECTION_REASONS,
  readExplanation,
  reasonCharCount,
  reasonLabel,
  REVIEW_ACTIONS,
  REVIEW_REASONS,
  reviewFormReducer,
  submitReview,
  validateApprovalForm,
  validateDecisionForm,
  type ChecklistValues,
  type DecisionFormValues,
} from '@/lib/domain/case-review-form'

const contract = JSON.parse(readFileSync(new URL('../../../contracts/decision-rules.v1.1.json', import.meta.url), 'utf8')) as {
  intervenciones: Record<string, { intensidad: number | number[] }>
  banderas: { orden: string[] }
}

const SNAPSHOT: CaseReviewSnapshot = {
  debtorId: '99', asOf: '2026-10-30', rulesVersion: '1.0.0', inputsHash: 'a'.repeat(64),
  suggestedIntervention: 'RECORDATORIO_INFORMATIVO', suggestedIntensity: 1, explanation: {}, currentReviewId: null,
}
const COMPLETE: ChecklistValues = { situacion_hogar: 'NO_DISPONIBLE', estado_juridico_verificado: true, canal_valido: true, alternativa_asistida_ofrecida: true }
const form = (patch: Partial<DecisionFormValues>): DecisionFormValues => ({ ...EMPTY_DECISION_FORM, ...patch })
const INTIMACION = REVIEW_ACTIONS.find(action => action.intensity === 3)!.key
const DERIVACION = REVIEW_ACTIONS.find(action => action.intensity === 4)!.key
const OTHER_ACTION = REVIEW_ACTIONS.find(action => action.intensity === 2)!.key

describe('catálogos cerrados del formulario', () => {
  it('cubre cada intervención e intensidad del contrato de reglas', () => {
    for (const [code, { intensidad }] of Object.entries(contract.intervenciones)) {
      for (const level of [intensidad].flat()) {
        expect(REVIEW_ACTIONS.some(action => action.intervention === code && action.intensity === level), `${code}/${level}`).toBe(true)
      }
    }
  })

  it('agrega solo las dos acciones intensas de ALIGN-003, y todos los códigos pasan el formato del servidor', () => {
    expect(REVIEW_ACTIONS.filter(action => action.intensity >= 3).map(action => [action.intensity, action.label])).toEqual([
      [3, expect.stringContaining('Intimación administrativa formal')],
      [4, expect.stringContaining('Derivación a procuración o vía judicial')],
    ])
    for (const action of REVIEW_ACTIONS) {
      const parsed = parseRecordCaseDecisionInput(buildRecordInput(form({
        decision: 'DERIVA', action: action.key, reasonCode: REVIEW_REASONS[0].code, checklist: COMPLETE,
      }), SNAPSHOT))
      expect(parsed.ok, action.key).toBe(true)
    }
    expect(new Set(REVIEW_ACTIONS.map(action => action.key)).size).toBe(REVIEW_ACTIONS.length)
  })

  it('los motivos son códigos válidos y ninguno habla del hogar o de la situación social', () => {
    for (const reason of [...REVIEW_REASONS, ...OBJECTION_REASONS]) {
      expect(reason.code).toMatch(/^[A-Z][A-Z0-9_]{0,63}$/)
      expect(`${reason.code} ${reason.label}`).not.toMatch(/hogar|vulnerab|pobre|ingreso|social/i)
    }
    expect(reasonLabel(REVIEW_REASONS[0].code)).toBe(REVIEW_REASONS[0].label)
    expect(reasonLabel(OBJECTION_REASONS[0].code)).toBe(OBJECTION_REASONS[0].label)
    // Un código viejo o de otra carga nunca se oculta.
    expect(reasonLabel('MOTIVO_SINTETICO')).toBe('MOTIVO_SINTETICO')
    expect(reasonLabel(null)).toBeNull()
  })

  it('cada bandera del contrato tiene rótulo, y una desconocida conserva su código', () => {
    for (const flag of contract.banderas.orden) expect(FLAG_LABELS[flag as keyof typeof FLAG_LABELS], flag).toBeTruthy()
    expect(flagLabel('OTRA_BANDERA')).toBe('OTRA_BANDERA')
  })

  it('Modificar no ofrece la acción sugerida; Derivar y el resto, según corresponda', () => {
    const suggested = `${SNAPSHOT.suggestedIntervention}:${SNAPSHOT.suggestedIntensity}`
    expect(actionOptionsFor('MODIFICA', SNAPSHOT).map(action => action.key)).not.toContain(suggested)
    expect(actionOptionsFor('DERIVA', SNAPSHOT).map(action => action.key)).toContain(suggested)
    expect(actionOptionsFor('ACEPTA', SNAPSHOT)).toEqual([])
    expect(actionOptionsFor('RECHAZA', SNAPSHOT)).toEqual([])
    expect(actionOptionsFor('POSPONE', SNAPSHOT)).toEqual([])
    expect(actionOptionsFor('', SNAPSHOT)).toEqual([])
  })
})

describe('qué campos pide cada decisión', () => {
  it.each([
    ['', false, false, false, false],
    ['ACEPTA', false, false, false, false],
    ['RECHAZA', false, false, true, false],
    ['POSPONE', false, false, true, false],
    ['MODIFICA', true, true, true, false],
    ['DERIVA', true, false, true, false],
  ] as const)('%s', (decision, showAction, actionRequired, showReason, intense) => {
    expect(decisionFields(form({ decision }))).toEqual({ showAction, actionRequired, showReason, intense })
  })

  it.each([['MODIFICA', 3], ['DERIVA', 4]] as const)('%s con intensidad %s pide lista de control', (decision, level) => {
    const action = REVIEW_ACTIONS.find(item => item.intensity === level)!.key
    expect(decisionFields(form({ decision, action })).intense).toBe(true)
  })

  it('una acción oculta no cuenta: Rechazar con una intensa elegida antes no pide lista', () => {
    expect(decisionFields(form({ decision: 'RECHAZA', action: INTIMACION })).intense).toBe(false)
  })
})

describe('validación antes de enviar', () => {
  it('exige elegir una decisión', () => {
    expect(validateDecisionForm(EMPTY_DECISION_FORM, SNAPSHOT)).toEqual({ decision: expect.any(String) })
  })

  it('Aceptar no pide nada más', () => {
    expect(validateDecisionForm(form({ decision: 'ACEPTA', reasonText: ' ', checklist: EMPTY_CHECKLIST }), SNAPSHOT)).toEqual({})
  })

  it.each(['RECHAZA', 'POSPONE', 'DERIVA'] as const)('%s exige motivo', decision => {
    expect(validateDecisionForm(form({ decision }), SNAPSHOT)).toEqual({ reasonCode: CASE_REVIEW_MESSAGES.REASON_REQUIRED })
  })

  it('Modificar exige acción y motivo', () => {
    expect(validateDecisionForm(form({ decision: 'MODIFICA' }), SNAPSHOT)).toEqual({
      action: expect.any(String), reasonCode: CASE_REVIEW_MESSAGES.REASON_REQUIRED,
    })
  })

  it('Modificar no acepta la acción sugerida, aunque la sugerencia haya cambiado después de elegirla', () => {
    const errors = validateDecisionForm(form({
      decision: 'MODIFICA', action: `${SNAPSHOT.suggestedIntervention}:${SNAPSHOT.suggestedIntensity}`, reasonCode: 'X',
    }), SNAPSHOT)
    expect(errors.action).toBe(CASE_REVIEW_MESSAGES.MODIFICA_WITHOUT_CHANGE)
  })

  it('una acción fuera del catálogo se rechaza', () => {
    expect(validateDecisionForm(form({ decision: 'DERIVA', action: 'INVENTADA:9', reasonCode: 'X' }), SNAPSHOT).action).toBeTruthy()
  })

  describe('intensidad ≥3 sin lista de control', () => {
    it.each([['MODIFICA', INTIMACION], ['MODIFICA', DERIVACION], ['DERIVA', INTIMACION], ['DERIVA', DERIVACION]] as const)('%s con %s no pasa con la lista vacía', (decision, action) => {
      const errors = validateDecisionForm(form({ decision, action, reasonCode: 'X' }), SNAPSHOT)
      expect(Object.keys(errors).sort()).toEqual(['alternativa_asistida_ofrecida', 'canal_valido', 'estado_juridico_verificado', 'situacion_hogar'])
    })

    it.each(Object.keys(COMPLETE) as (keyof ChecklistValues)[])('falta solo %s: sigue bloqueado', key => {
      const checklist = { ...COMPLETE, [key]: key === 'situacion_hogar' ? '' : false }
      expect(Object.keys(validateDecisionForm(form({ decision: 'MODIFICA', action: INTIMACION, reasonCode: 'X', checklist }), SNAPSHOT))).toEqual([key])
    })

    it('con motivo y lista completa pasa, y la acción la acepta', () => {
      const values = form({ decision: 'MODIFICA', action: INTIMACION, reasonCode: 'X', checklist: COMPLETE })
      expect(validateDecisionForm(values, SNAPSHOT)).toEqual({})
      expect(parseRecordCaseDecisionInput(buildRecordInput(values, SNAPSHOT)).ok).toBe(true)
    })
  })

  describe('detalle del motivo', () => {
    const withText = (reasonText: string) => validateDecisionForm(form({ decision: 'RECHAZA', reasonCode: 'X', reasonText }), SNAPSHOT)

    it('500 puntos de código pasan, también con emojis, y 501 no: cuenta los espacios', () => {
      expect(withText('🙂'.repeat(500))).toEqual({})
      expect(withText(' '.repeat(250) + 'x'.repeat(250))).toEqual({})
      expect(withText('x'.repeat(501)).reasonText).toBe(CASE_REVIEW_MESSAGES.REASON_TEXT_TOO_LONG)
      expect(reasonCharCount('🙂 a')).toBe(3)
    })

    it('solo espacios no se guarda, y vacío significa sin detalle', () => {
      expect(withText(' \n\t ').reasonText).toBe(CASE_REVIEW_MESSAGES.REASON_TEXT_BLANK)
      expect(withText('')).toEqual({})
    })

    it('carácter no almacenable', () => {
      expect(withText('a\u0000b').reasonText).toBe(CASE_REVIEW_MESSAGES.REASON_TEXT_INVALID)
    })
  })
})

describe('qué se envía a la acción', () => {
  it('Aceptar no arrastra lo que quedó oculto', () => {
    expect(buildRecordInput(form({ decision: 'ACEPTA', action: INTIMACION, reasonCode: 'X', reasonText: 'oculto', checklist: COMPLETE }), SNAPSHOT)).toEqual({
      debtorId: '99', decision: 'ACEPTA',
      expected: { asOf: '2026-10-30', rulesVersion: '1.0.0', inputsHash: 'a'.repeat(64) },
      supersedes: null, decidedIntervention: null, decidedIntensity: null, reasonCode: null, reasonText: null, checklist: {},
    })
  })

  it('Rechazar no envía acción ni lista, aunque se hayan cargado antes', () => {
    const input = buildRecordInput(form({ decision: 'RECHAZA', action: INTIMACION, reasonCode: 'X', checklist: COMPLETE }), SNAPSHOT)
    expect(input).toMatchObject({ decidedIntervention: null, decidedIntensity: null, reasonCode: 'X', checklist: {} })
    expect(parseRecordCaseDecisionInput(input).ok).toBe(true)
  })

  it('Modificar a intensidad ≤2 no envía una lista cargada antes', () => {
    const input = buildRecordInput(form({ decision: 'MODIFICA', action: OTHER_ACTION, reasonCode: 'X', checklist: COMPLETE }), SNAPSHOT)
    expect(input).toMatchObject({ decidedIntervention: 'CONTACTO_PERSONAL_Y_PLAN', decidedIntensity: 2, checklist: {} })
  })

  it('el texto llega tal como se escribió y vacío es null', () => {
    const padded = '  con espacios \n'
    expect(buildRecordInput(form({ decision: 'POSPONE', reasonCode: 'X', reasonText: padded }), SNAPSHOT)).toMatchObject({ reasonText: padded })
    expect(buildRecordInput(form({ decision: 'POSPONE', reasonCode: 'X', reasonText: '' }), SNAPSHOT)).toMatchObject({ reasonText: null })
  })

  it('supersedes es la decisión vigente de la instantánea', () => {
    expect(buildRecordInput(form({ decision: 'ACEPTA' }), { ...SNAPSHOT, currentReviewId: '123' })).toMatchObject({ supersedes: '123' })
  })

  it('Derivar sin acción no envía par', () => {
    const input = buildRecordInput(form({ decision: 'DERIVA', reasonCode: 'X' }), SNAPSHOT)
    expect(input).toMatchObject({ decidedIntervention: null, decidedIntensity: null })
    expect(parseRecordCaseDecisionInput(input).ok).toBe(true)
  })
})

describe('respuesta del supervisor', () => {
  const approval = (patch: Partial<typeof EMPTY_APPROVAL_FORM>) => ({ ...EMPTY_APPROVAL_FORM, ...patch })

  it('exige elegir', () => {
    expect(validateApprovalForm(EMPTY_APPROVAL_FORM, { approveBlocked: false })).toEqual({ decision: expect.any(String) })
  })

  it('aprobar exige la lista completa', () => {
    expect(Object.keys(validateApprovalForm(approval({ decision: 'APRUEBA' }), { approveBlocked: false })).sort())
      .toEqual(['alternativa_asistida_ofrecida', 'canal_valido', 'estado_juridico_verificado', 'situacion_hogar'])
    expect(validateApprovalForm(approval({ decision: 'APRUEBA', checklist: COMPLETE }), { approveBlocked: false })).toEqual({})
  })

  it('objetar exige motivo y no la lista', () => {
    expect(validateApprovalForm(approval({ decision: 'OBJETA' }), { approveBlocked: false })).toEqual({ reasonCode: CASE_REVIEW_MESSAGES.REASON_REQUIRED })
    expect(validateApprovalForm(approval({ decision: 'OBJETA', reasonCode: 'X' }), { approveBlocked: true })).toEqual({})
  })

  it('con una carga en curso no se aprueba, y objetar sigue disponible', () => {
    expect(validateApprovalForm(approval({ decision: 'APRUEBA', checklist: COMPLETE }), { approveBlocked: true }).decision).toBeTruthy()
  })

  it('arma la entrada que la acción acepta, sin lo oculto', () => {
    const approved = buildApprovalInput(approval({ decision: 'APRUEBA', reasonCode: 'OCULTO', checklist: COMPLETE }), '7', null)
    expect(approved).toEqual({ caseReviewId: '7', decision: 'APRUEBA', reasonCode: null, checklist: COMPLETE, supersedes: null })
    expect(parseApproveCaseDecisionInput(approved).ok).toBe(true)
    const objected = buildApprovalInput(approval({ decision: 'OBJETA', reasonCode: 'X', checklist: COMPLETE }), '7', '8')
    expect(objected).toEqual({ caseReviewId: '7', decision: 'OBJETA', reasonCode: 'X', checklist: {}, supersedes: '8' })
    expect(parseApproveCaseDecisionInput(objected).ok).toBe(true)
  })
})

describe('interpretación del resultado', () => {
  const recorded = { ok: true, reviewId: '1', debtorId: '99', created: true, status: 'REGISTRADA', asOf: '2026-10-30', rulesVersion: '1.0.0', inputsHash: 'a'.repeat(64), suggestedIntervention: 'SEGUIMIENTO', suggestedIntensity: 0 } as const

  it('éxito y doble envío se muestran como éxito', () => {
    expect(interpretResult(recorded)).toEqual({ kind: 'recorded', message: 'Decisión registrada.' })
    expect(interpretResult({ ...recorded, created: false })).toEqual({ kind: 'recorded', message: 'Decisión registrada. Ya estaba registrada: no se duplicó.' })
    expect(interpretResult({ ...recorded, status: 'PENDIENTE_SUPERVISOR' }).message).toBe('Requiere aprobación de un supervisor.')
    expect(interpretResult({ ok: true, approvalId: '2', caseReviewId: '1', debtorId: '99', created: true, status: 'OBJETADA' }).message).toBe('Objetada por un supervisor.')
  })

  it('SUGGESTION_OUTDATED conserva qué cambió y la sugerencia vigente, también si solo cambió el corte', () => {
    const failure = { ...caseReviewFailure('SUGGESTION_OUTDATED'), changed: ['CORTE'] as const, current: SNAPSHOT }
    expect(interpretResult(failure)).toEqual({ kind: 'outdated', message: CASE_REVIEW_MESSAGES.SUGGESTION_OUTDATED, changed: ['CORTE'], current: SNAPSHOT })
  })

  it('sin instantánea vigente no finge que la tiene', () => {
    expect(interpretResult(caseReviewFailure('SUGGESTION_OUTDATED')).kind).toBe('rejected')
  })

  it('CUTOFF_NOT_AVAILABLE no es un error del usuario', () => {
    expect(interpretResult(caseReviewFailure('CUTOFF_NOT_AVAILABLE'))).toEqual({ kind: 'cutoff', message: CASE_REVIEW_MESSAGES.CUTOFF_NOT_AVAILABLE })
  })

  it.each(['REVIEW_CONFLICT', 'APPROVAL_CONFLICT', 'REVIEW_SUPERSEDED', 'SUPERSEDES_NOT_FOUND'] as const)('%s ofrece recargar', code => {
    expect(interpretResult(caseReviewFailure(code))).toEqual({ kind: 'conflict', message: CASE_REVIEW_MESSAGES[code] })
  })

  it.each([
    ['REASON_REQUIRED', 'reasonCode'], ['REASON_TEXT_BLANK', 'reasonText'], ['REASON_TEXT_TOO_LONG', 'reasonText'], ['REASON_TEXT_INVALID', 'reasonText'],
    ['CHECKLIST_REQUIRED', 'situacion_hogar'], ['CHECKLIST_INVALID', 'situacion_hogar'],
    ['MODIFICA_WITHOUT_CHANGE', 'action'], ['DECISION_FIELDS_INVALID', 'action'],
  ] as const)('%s marca el campo %s', (code, field) => {
    expect(interpretResult(caseReviewFailure(code))).toEqual({ kind: 'field', field, message: CASE_REVIEW_MESSAGES[code] })
  })

  it.each(['SUPERSEDES_CHAIN_INVALID', 'WRITE_UNAVAILABLE', 'WRITE_REJECTED', 'ROLE_FORBIDDEN', 'APPROVER_IS_PROPONENT', 'WRITE_NOT_CONFIGURED', 'OBJECT_NOT_IN_TENANT'] as const)('%s muestra el mensaje de usuario, nunca el código', code => {
    const outcome = interpretResult(caseReviewFailure(code))
    expect(outcome).toEqual({ kind: 'rejected', message: CASE_REVIEW_MESSAGES[code] })
    expect(outcome.message).not.toContain(code)
  })
})

describe('estado del formulario', () => {
  const start = initialReviewFormState(EMPTY_DECISION_FORM)
  const filled = form({ decision: 'RECHAZA', reasonCode: 'X', reasonText: 'texto' })
  const withValues = { ...start, values: filled }

  it('un cambio limpia el error de ese campo y conserva el resto', () => {
    const state = reviewFormReducer({ ...start, errors: { reasonCode: 'a', action: 'b' } }, { type: 'change', patch: { reasonCode: 'X' } })
    expect(state.errors).toEqual({ action: 'b' })
    expect(state.values.reasonCode).toBe('X')
  })

  it('un cambio en la situación del hogar o en una casilla limpia su error', () => {
    const state = reviewFormReducer({ ...start, errors: { canal_valido: 'a', situacion_hogar: 'b' } }, { type: 'change', patch: { checklist: { ...EMPTY_CHECKLIST, canal_valido: true } } })
    expect(state.errors).toEqual({ situacion_hogar: 'b' })
  })

  it('tras un registro, cambiar algo quita el aviso de éxito; un aviso de datos cambiados se conserva', () => {
    const success = { ...start, notice: { kind: 'recorded', message: 'ok' } as const }
    expect(reviewFormReducer(success, { type: 'change', patch: { decision: 'ACEPTA' } }).notice).toBeNull()
    const outdated = { ...start, notice: { kind: 'outdated', message: 'x', changed: [], current: SNAPSHOT } as const }
    expect(reviewFormReducer(outdated, { type: 'change', patch: { decision: 'ACEPTA' } }).notice).toEqual(outdated.notice)
  })

  it('un envío inválido muestra errores y pide mover el foco', () => {
    const state = reviewFormReducer(withValues, { type: 'invalid', errors: { reasonCode: 'x' } })
    expect(state).toMatchObject({ errors: { reasonCode: 'x' }, notice: null, focusTick: 1, values: filled })
  })

  it('registrado limpia el formulario', () => {
    const state = reviewFormReducer({ ...withValues, current: SNAPSHOT }, { type: 'outcome', outcome: { kind: 'recorded', message: 'ok' } })
    expect(state).toMatchObject({ values: EMPTY_DECISION_FORM, errors: {}, current: null, focusTick: 1, notice: { kind: 'recorded' } })
  })

  it('datos cambiados borra la decisión elegida, conserva el resto y adopta lo vigente: no se confirma en silencio', () => {
    const current = { ...SNAPSHOT, inputsHash: 'b'.repeat(64) }
    const state = reviewFormReducer(withValues, { type: 'outcome', outcome: { kind: 'outdated', message: 'x', changed: ['INSUMOS'], current } })
    expect(state.values).toEqual({ ...filled, decision: '' })
    expect(state.current).toEqual(current)
    expect(state.notice).toMatchObject({ kind: 'outdated', changed: ['INSUMOS'] })
  })

  it('un rechazo por campo lo marca y un rechazo general se avisa, sin perder lo escrito', () => {
    const byField = reviewFormReducer(withValues, { type: 'outcome', outcome: { kind: 'field', field: 'reasonText', message: 'x' } })
    expect(byField).toMatchObject({ errors: { reasonText: 'x' }, notice: null, values: filled, focusTick: 1 })
    for (const kind of ['conflict', 'cutoff', 'rejected', 'crash'] as const) {
      const state = reviewFormReducer(withValues, { type: 'outcome', outcome: { kind, message: 'x' } })
      expect(state).toMatchObject({ notice: { kind }, values: filled, focusTick: 1 })
    }
  })

  it('recargar el caso obliga a volver a elegir la decisión', () => {
    const state = reviewFormReducer({ ...withValues, current: SNAPSHOT, notice: { kind: 'conflict', message: 'x' } }, { type: 'reloaded' })
    expect(state).toMatchObject({ values: { ...filled, decision: '' }, notice: null, current: null })
  })
})

describe('envío', () => {
  const dispatch = vi.fn()
  const refresh = vi.fn()
  const send = vi.fn()
  const startTransition = (work: () => Promise<void>) => work()
  const run = (validate: () => Record<string, string>) => submitReview({ values: form({}), validate, send, dispatch, startTransition, refresh })

  beforeEach(() => vi.clearAllMocks())

  it('con errores no llama a la acción', async () => {
    await run(() => ({ decision: 'x' }))
    expect(send).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'invalid', errors: { decision: 'x' } })
  })

  it('sin errores llama una vez y entrega el resultado', async () => {
    send.mockResolvedValue(caseReviewFailure('WRITE_UNAVAILABLE'))
    await run(() => ({}))
    expect(send).toHaveBeenCalledOnce()
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'outcome', outcome: { kind: 'rejected', message: CASE_REVIEW_MESSAGES.WRITE_UNAVAILABLE } })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('con datos cambiados pide la página vigente', async () => {
    send.mockResolvedValue({ ...caseReviewFailure('SUGGESTION_OUTDATED'), changed: ['INSUMOS'], current: SNAPSHOT })
    await run(() => ({}))
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('una acción que lanza (por ejemplo, tras un despliegue nuevo) ofrece recargar', async () => {
    send.mockRejectedValue(new Error('Failed to find Server Action'))
    await run(() => ({}))
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'outcome', outcome: { kind: 'crash', message: expect.stringContaining('Recarga') } })
  })
})

describe('explicación de la instantánea', () => {
  it('lee los campos que produce el servidor', () => {
    expect(readExplanation({
      regla: 'R4', modificador: null, banderas: ['SIN_CONTACTO_ACTIVO', 3],
      severidad: { valor: 80, banda: 'ALTA', estado: 'PARCIAL', obligaciones_no_evaluables: 2 },
      revision: { requiere_revision_humana: true, motivos: ['SEVERIDAD_PARCIAL', 9] },
      factores: [{ factor: 'monto_actualizado_ars', insumo: 10, puntos: 5, maximo: 50 }, null, { factor: 'dias_atraso_maximo', insumo: null, puntos: null, maximo: 30 }],
      frase_contrastiva: 'Se sugiere algo.',
    })).toEqual({
      phrase: 'Se sugiere algo.', rule: 'R4',
      flags: ['SIN_CONTACTO_ACTIVO'],
      severity: { value: 80, band: 'ALTA', state: 'PARCIAL', notEvaluable: 2 },
      reviewRequired: true,
      factors: [{ factor: 'monto_actualizado_ars', input: 10, points: 5, maximum: 50 }, { factor: 'dias_atraso_maximo', input: null, points: null, maximum: 30 }],
    })
  })

  it('una forma inesperada queda como no disponible, nunca como cero', () => {
    expect(readExplanation({ severidad: 'x', factores: 'y', banderas: 1, revision: null })).toEqual({
      phrase: null, rule: null, flags: [], severity: { value: null, band: null, state: null, notEvaluable: null }, reviewRequired: false, factors: [],
    })
  })
})
