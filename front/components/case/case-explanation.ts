import { readExplanation, reviewActionLabel, RECORDED_DECISION_LABELS, type ExplanationView } from '@/lib/domain/case-review-form'
import type { CaseReviewDecision } from '@/lib/domain/case-review-contract'
import type { Decision, DecisionInput } from '@/lib/domain/decision-rules-v1'
import type { DataPresence } from '@/types/equitas-domain'

// Noche 7. Lo que la ficha necesita leer de la decisión ya evaluada por las reglas, sin volver a
// calcular nada: el desglose del puntaje, la regla aplicada y qué avisos son de este caso.

// La misma forma que guarda la instantánea de revisión (`case-review-snapshot.ts`): así la ficha y
// la pestaña «Decisión» leen la explicación con la misma función.
export function explanationOfDecision(decision: Decision): ExplanationView {
  const { valor, banda, estado, obligaciones_no_evaluables } = decision.severidad
  return readExplanation({
    regla: decision.intervencion.regla,
    banderas: decision.banderas,
    severidad: { valor, banda, estado, obligaciones_no_evaluables },
    revision: decision.revision,
    factores: decision.explicacion.factores,
    frase_contrastiva: decision.explicacion.frase_contrastiva,
  })
}

export const BAND_LABELS: Readonly<Record<string, string>> = { ALTA: 'Alta', MEDIA: 'Media', BAJA: 'Baja' }

export const FACTOR_LABELS: Readonly<Record<string, string>> = {
  monto_actualizado_ars: 'Importe pendiente',
  dias_atraso_maximo: 'Atraso máximo',
  cantidad_vencidas: 'Obligaciones vencidas',
}

// La suma de los puntos del desglose; null si algún factor no tiene puntos.
export function breakdownTotal(view: ExplanationView): number | null {
  if (view.factors.length === 0 || view.factors.some(item => item.points === null)) return null
  return view.factors.reduce((sum, item) => sum + item.points!, 0)
}

// «al menos 45» si la severidad es parcial (hay obligaciones no evaluables).
export function scoreText(value: number | null, state: string | null): string {
  if (value === null) return 'No disponible'
  return `${state === 'PARCIAL' ? 'al menos ' : ''}${value}`
}

export function actionLabel(intervention: string | null, intensity: number | null): string | null {
  return intervention !== null && intensity !== null ? reviewActionLabel(intervention, intensity) : null
}

// «Recomendación aceptada: Recordatorio (intensidad 1)»; sin acción, solo la decisión.
export function recordedDecisionText(decision: string, intervention: string | null, intensity: number | null): string {
  const label = RECORDED_DECISION_LABELS[decision as CaseReviewDecision] ?? decision
  const action = actionLabel(intervention, intensity)
  return action ? `${label}: ${action}` : label
}

export const whoText = (mine: boolean) => (mine ? 'vos' : 'otra persona')

// H07. Tres avisos de cobertura salían en todos los casos porque la aplicación no integra esos
// campos: un dato NO_INTEGRADO es una ausencia de toda la carga, no de este caso. Se muestran como
// aviso del caso solo si el dato existe en la carga y a este caso le falta o es inválido.
type CoverageFlag = 'ESTADO_ORIGEN_NO_INFORMADO' | 'PERIODO_NO_INFORMADO' | 'TIPO_PERSONA_DESCONOCIDO'

export const COVERAGE_LABELS: Readonly<Record<CoverageFlag, string>> = {
  ESTADO_ORIGEN_NO_INFORMADO: 'el estado de las obligaciones (salvo «Pagada», que sí las excluye)',
  PERIODO_NO_INFORMADO: 'el período fiscal',
  TIPO_PERSONA_DESCONOCIDO: 'el tipo de persona',
}

const caseSpecific = (presence: DataPresence) => presence !== 'NO_INTEGRADO' && presence !== 'OBSERVADO'

function appliesToCase(flag: CoverageFlag, input: DecisionInput): boolean {
  if (flag === 'TIPO_PERSONA_DESCONOCIDO') {
    return input.personas.some(person => caseSpecific(person.tipo.estado) || person.tipo.valor === 'UNKNOWN')
  }
  const field = flag === 'ESTADO_ORIGEN_NO_INFORMADO' ? 'estado_origen' : 'periodo_fiscal'
  return input.obligaciones.some(obligation => caseSpecific(obligation[field].estado))
}

export function splitFlags(flags: readonly string[], input: DecisionInput | null | undefined): { caseFlags: string[]; coverage: CoverageFlag[] } {
  const caseFlags: string[] = []
  const coverage: CoverageFlag[] = []
  for (const flag of flags) {
    if (flag in COVERAGE_LABELS && input && !appliesToCase(flag as CoverageFlag, input)) coverage.push(flag as CoverageFlag)
    else caseFlags.push(flag)
  }
  return { caseFlags, coverage }
}

// «a, b y c»
export function joinList(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`
}
