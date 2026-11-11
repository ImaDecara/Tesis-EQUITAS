import { describe, expect, it } from 'vitest'

import {
  CASE_REVIEW_MESSAGES,
  CASE_REVIEW_STATUS_LABELS,
  parseApproveCaseDecisionInput,
  parseRecordCaseDecisionInput,
  REASON_TEXT_MAX_CHARS,
  type CaseReviewErrorCode,
} from '@/lib/domain/case-review-contract'

const expected = { asOf: '2026-10-30', rulesVersion: '1.0.0', inputsHash: 'a'.repeat(64) }
const accept = { debtorId: '99', decision: 'ACEPTA', expected }
const readyChecklist = {
  situacion_hogar: 'NO_DISPONIBLE', estado_juridico_verificado: true, canal_valido: true, alternativa_asistida_ofrecida: true,
}
const reject = (overrides: Record<string, unknown>) => ({ ...accept, decision: 'RECHAZA', reasonCode: 'MOTIVO_SINTETICO', ...overrides })
const failureOf = (result: { ok: boolean; code?: CaseReviewErrorCode }) => (result.ok ? 'OK' : result.code)

describe('ALIGN-020: entrada de recordCaseDecision', () => {
  it('acepta lo minimo y normaliza lo ausente a null, sin inventar valores', () => {
    expect(parseRecordCaseDecisionInput(accept)).toEqual({
      ok: true,
      value: {
        debtorId: '99', decision: 'ACEPTA', expected, supersedes: null, decided: null,
        reasonCode: null, reasonText: null, checklist: {},
      },
    })
    expect(parseRecordCaseDecisionInput({ ...accept, debtorId: 99 })).toMatchObject({ ok: true, value: { debtorId: '99' } })
  })

  it.each([
    ['nulo', null], ['texto', 'ACEPTA'], ['lista', [accept]], ['fecha', new Date(0)], ['formulario', new Map()],
  ])('rechaza una entrada que no es un objeto plano: %s', (_name, raw) => {
    expect(failureOf(parseRecordCaseDecisionInput(raw))).toBe('INVALID_INPUT')
  })

  // El navegador elige objeto y decisión, nunca actor, tenant, sugerencia, hash, versión o clave.
  it.each([
    'tenant', 'tenantId', 'reviewer', 'reviewerRole', 'actor', 'appUserId', 'suggestedIntervention', 'suggestedIntensity',
    'explanation', 'inputsHash', 'rulesVersion', 'asOf', 'idempotencyKey', 'createdAt', '__proto__',
  ])('rechaza el campo falsificable %s', field => {
    const raw = JSON.parse(`{"${field}":"FORJADO"}`)
    expect(failureOf(parseRecordCaseDecisionInput({ ...accept, ...raw }))).toBe('INVALID_INPUT')
  })

  it.each([
    ['sin objeto', { debtorId: undefined }], ['objeto con ceros', { debtorId: '007' }], ['objeto mixto', { debtorId: '7x' }],
    ['objeto negativo', { debtorId: -1 }], ['objeto fraccion', { debtorId: 1.5 }],
    ['decision fuera de lista', { decision: 'APRUEBA' }], ['decision en minusculas', { decision: 'acepta' }],
    ['sin lo que vio', { expected: undefined }], ['lo que vio con otro campo', { expected: { ...expected, extra: 1 } }],
    ['corte imposible', { expected: { ...expected, asOf: '2026-02-31' } }], ['corte con hora', { expected: { ...expected, asOf: '2026-10-30T00:00:00Z' } }],
    ['version mal formada', { expected: { ...expected, rulesVersion: 'v1' } }],
    ['hash corto', { expected: { ...expected, inputsHash: 'a'.repeat(63) } }], ['hash en mayusculas', { expected: { ...expected, inputsHash: 'A'.repeat(64) } }],
    ['antecedente invalido', { supersedes: 'abc' }], ['antecedente cero', { supersedes: 0 }],
  ])('rechaza con entrada invalida: %s', (_name, overrides) => {
    expect(failureOf(parseRecordCaseDecisionInput({ ...accept, ...overrides }))).toBe('INVALID_INPUT')
  })

  it.each(['RECHAZA', 'POSPONE', 'DERIVA'])('%s sin motivo se rechaza', decision => {
    expect(failureOf(parseRecordCaseDecisionInput({ ...accept, decision }))).toBe('REASON_REQUIRED')
    expect(failureOf(parseRecordCaseDecisionInput({ ...accept, decision, reasonCode: '' }))).toBe('INVALID_INPUT')
    expect(failureOf(parseRecordCaseDecisionInput({ ...accept, decision, reasonCode: null }))).toBe('REASON_REQUIRED')
    expect(failureOf(parseRecordCaseDecisionInput({ ...accept, decision, reasonCode: 'MOTIVO' }))).toBe('OK')
  })

  it('MODIFICA sin motivo se rechaza y sin lo decidido tambien', () => {
    const modifies = { ...accept, decision: 'MODIFICA' }
    expect(failureOf(parseRecordCaseDecisionInput({ ...modifies, decidedIntervention: 'SEGUIMIENTO', decidedIntensity: 1 }))).toBe('REASON_REQUIRED')
    expect(failureOf(parseRecordCaseDecisionInput({ ...modifies, reasonCode: 'MOTIVO' }))).toBe('DECISION_FIELDS_INVALID')
  })

  it.each([
    ['ACEPTA elige la sugerencia del servidor, no la del navegador', { decision: 'ACEPTA', decidedIntervention: 'X', decidedIntensity: 1 }],
    ['RECHAZA no lleva intervencion', reject({ decidedIntervention: 'X', decidedIntensity: 1 })],
    ['POSPONE no lleva intervencion', reject({ decision: 'POSPONE', decidedIntervention: 'X', decidedIntensity: 1 })],
  ])('%s', (_name, overrides) => {
    expect(failureOf(parseRecordCaseDecisionInput({ ...accept, ...overrides }))).toBe('DECISION_FIELDS_INVALID')
  })

  it.each([
    ['solo intervencion', { decidedIntervention: 'X' }], ['solo intensidad', { decidedIntensity: 1 }],
    ['intensidad 5', { decidedIntervention: 'X', decidedIntensity: 5 }], ['intensidad negativa', { decidedIntervention: 'X', decidedIntensity: -1 }],
    ['intensidad fraccion', { decidedIntervention: 'X', decidedIntensity: 1.5 }], ['intensidad texto', { decidedIntervention: 'X', decidedIntensity: '2' }],
    ['intervencion en minusculas', { decidedIntervention: 'seguimiento', decidedIntensity: 1 }],
    ['motivo en minusculas', { decidedIntervention: 'X', decidedIntensity: 1, reasonCode: 'motivo' }],
  ])('rechaza lo decidido mal formado: %s', (_name, overrides) => {
    expect(failureOf(parseRecordCaseDecisionInput({ ...accept, decision: 'DERIVA', reasonCode: 'MOTIVO', ...overrides }))).toBe('INVALID_INPUT')
  })

  it.each([3, 4])('intensidad %i exige lista de control completa y en verdadero', decidedIntensity => {
    const proposal = { ...accept, decision: 'MODIFICA', decidedIntervention: 'INTIMACION_ADMINISTRATIVA', decidedIntensity, reasonCode: 'MOTIVO' }
    expect(failureOf(parseRecordCaseDecisionInput(proposal))).toBe('CHECKLIST_REQUIRED')
    expect(failureOf(parseRecordCaseDecisionInput({ ...proposal, checklist: { ...readyChecklist, canal_valido: false } }))).toBe('CHECKLIST_REQUIRED')
    expect(failureOf(parseRecordCaseDecisionInput({ ...proposal, checklist: { ...readyChecklist, situacion_hogar: undefined } }))).toBe('CHECKLIST_INVALID')
    expect(failureOf(parseRecordCaseDecisionInput({ ...proposal, checklist: { estado_juridico_verificado: true, canal_valido: true, alternativa_asistida_ofrecida: true } }))).toBe('CHECKLIST_REQUIRED')
    expect(failureOf(parseRecordCaseDecisionInput({ ...proposal, checklist: readyChecklist }))).toBe('OK')
    expect(failureOf(parseRecordCaseDecisionInput({ ...proposal, decision: 'DERIVA', checklist: readyChecklist, reasonCode: null }))).toBe('REASON_REQUIRED')
  })

  it.each([
    ['texto libre sobre el hogar', { situacion_hogar: 'Vive con su abuela' }],
    ['clave fuera de lista', { observacion: 'dato sensible' }],
    ['casilla no booleana', { canal_valido: 'si' }],
    ['nulo', { situacion_hogar: null }],
    ['lista', []],
  ])('la lista de control no admite %s', (_name, checklist) => {
    expect(failureOf(parseRecordCaseDecisionInput({ ...accept, checklist }))).toBe('CHECKLIST_INVALID')
  })

  it('una lista de control nula equivale a sin completar', () => {
    expect(parseRecordCaseDecisionInput({ ...accept, checklist: null })).toMatchObject({ ok: true, value: { checklist: {} } })
  })

  describe('reason_text: se valida lo que se guarda, sin normalizar', () => {
    it(`admite exactamente ${REASON_TEXT_MAX_CHARS} contando los espacios y lo conserva igual`, () => {
      const padded = ' '.repeat(250) + 'x' + ' '.repeat(249)
      expect(padded).toHaveLength(500)
      expect(parseRecordCaseDecisionInput(reject({ reasonText: padded }))).toMatchObject({ ok: true, value: { reasonText: padded } })
    })

    it('cuenta caracteres como la base, no unidades UTF-16', () => {
      const emoji = '🙂'.repeat(500)
      expect(emoji.length).toBe(1000)
      expect(failureOf(parseRecordCaseDecisionInput(reject({ reasonText: emoji })))).toBe('OK')
      expect(failureOf(parseRecordCaseDecisionInput(reject({ reasonText: emoji + 'x' })))).toBe('REASON_TEXT_TOO_LONG')
    })

    it.each([
      ['501 espacios y una letra', ' '.repeat(501) + 'x'], ['una letra y 500 espacios', 'x' + ' '.repeat(500)],
    ])('rechaza por largo: %s', (_name, reasonText) => {
      expect(failureOf(parseRecordCaseDecisionInput(reject({ reasonText })))).toBe('REASON_TEXT_TOO_LONG')
    })

    it.each([
      ['vacio', ''], ['espacios', '   '], ['tabulaciones y saltos', '\t\n '], ['espacio duro', '  '], ['ancho cero', '​​'],
    ])('rechaza en blanco: %s', (_name, reasonText) => {
      expect(failureOf(parseRecordCaseDecisionInput(reject({ reasonText })))).toBe('REASON_TEXT_BLANK')
    })

    it.each([
      ['caracter nulo, que PostgreSQL no guarda', 'a\u0000b'], ['sustituto huerfano', 'a\ud83d'], ['no es texto', 42],
    ])('rechaza %s', (_name, reasonText) => {
      expect(failureOf(parseRecordCaseDecisionInput(reject({ reasonText })))).toBe('REASON_TEXT_INVALID')
    })

    it('el texto sin codigo no alcanza como motivo', () => {
      expect(failureOf(parseRecordCaseDecisionInput({ ...accept, reasonText: 'Sin codigo' }))).toBe('REASON_REQUIRED')
      expect(failureOf(parseRecordCaseDecisionInput({ ...accept, decision: 'POSPONE', reasonText: 'Sin codigo' }))).toBe('REASON_REQUIRED')
      expect(failureOf(parseRecordCaseDecisionInput({ ...accept, reasonCode: 'MOTIVO', reasonText: 'Con codigo' }))).toBe('OK')
    })
  })
})

describe('ALIGN-020: entrada de approveCaseDecision', () => {
  const approve = { caseReviewId: '5', decision: 'APRUEBA', checklist: readyChecklist }

  it('acepta la aprobacion completa', () => {
    expect(parseApproveCaseDecisionInput(approve)).toEqual({
      ok: true,
      value: { caseReviewId: '5', decision: 'APRUEBA', reasonCode: null, checklist: readyChecklist, supersedes: null },
    })
  })

  it('APRUEBA exige la lista completa; OBJETA exige motivo y no la lista', () => {
    expect(failureOf(parseApproveCaseDecisionInput({ ...approve, checklist: {} }))).toBe('CHECKLIST_REQUIRED')
    expect(failureOf(parseApproveCaseDecisionInput({ caseReviewId: '5', decision: 'APRUEBA' }))).toBe('CHECKLIST_REQUIRED')
    expect(failureOf(parseApproveCaseDecisionInput({ caseReviewId: '5', decision: 'OBJETA' }))).toBe('REASON_REQUIRED')
    expect(failureOf(parseApproveCaseDecisionInput({ caseReviewId: '5', decision: 'OBJETA', reasonCode: 'MOTIVO' }))).toBe('OK')
  })

  it.each([
    ['sin revision', { caseReviewId: undefined }], ['revision mal formada', { caseReviewId: '5;drop' }],
    ['decision de operador', { decision: 'ACEPTA' }], ['aprobador falsificado', { approver: '1' }], ['tenant falsificado', { tenantId: '1' }],
    ['clave falsificada', { idempotencyKey: 'x' }], ['texto libre, que la tabla no tiene', { reasonText: 'x' }],
    ['motivo mal formado', { reasonCode: 'minusculas' }], ['antecedente mal formado', { supersedes: '-1' }],
  ])('rechaza con entrada invalida: %s', (_name, overrides) => {
    expect(failureOf(parseApproveCaseDecisionInput({ ...approve, ...overrides }))).toBe('INVALID_INPUT')
  })

  it('rechaza una lista de control fuera de contrato', () => {
    expect(failureOf(parseApproveCaseDecisionInput({ ...approve, checklist: { ...readyChecklist, nota: 'texto' } }))).toBe('CHECKLIST_INVALID')
  })
})

describe('ALIGN-020: mensajes de usuario', () => {
  it('todo codigo tiene un mensaje en castellano, sin valores ni nombres internos', () => {
    for (const [code, message] of Object.entries(CASE_REVIEW_MESSAGES)) {
      expect(message.length, code).toBeGreaterThan(10)
      expect(message, code).not.toMatch(/case_review|SUPERSEDES|supersedes|pending_supervisor|PGRST|JWT|\{|\}/)
    }
  })

  it('una propuesta pendiente se comunica como pendiente de aprobación, sin «supervisor»', () => {
    expect(CASE_REVIEW_STATUS_LABELS.PENDIENTE_SUPERVISOR).toMatch(/pendiente de aprobación/i)
    for (const message of [...Object.values(CASE_REVIEW_MESSAGES), ...Object.values(CASE_REVIEW_STATUS_LABELS)]) {
      expect(message).not.toMatch(/supervisor|operador/i)
    }
    expect(CASE_REVIEW_MESSAGES.SUPERSEDES_NOT_FOUND).toMatch(/decisión/i)
    expect(CASE_REVIEW_MESSAGES.SUPERSEDES_CHAIN_INVALID).toMatch(/historial/i)
    expect(CASE_REVIEW_MESSAGES.REASON_TEXT_BLANK).toMatch(/motivo/i)
  })
})
