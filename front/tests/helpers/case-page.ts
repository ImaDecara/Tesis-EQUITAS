import { createElement, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { TabsContent } from '@/components/ui/tabs'
import type { CaseReviewSnapshot } from '@/lib/domain/case-review-contract'
import type { CaseReviewHistoryEntry, CaseReviewScreen } from '@/lib/domain/case-review-history'
import { evaluateDecisionRulesV1, type Decision, type DecisionInput } from '@/lib/domain/decision-rules-v1'
import type { RecordedDecision } from '@/lib/domain/recorded-decision'

// Utilidades compartidas por las pruebas de la ficha del caso (`app/debtors/[debtorId]/page.tsx`).

type NodeProps = { children?: ReactNode; value?: string; defaultValue?: string; keepMounted?: boolean }

export function nodesOfType(node: ReactNode, type: unknown): ReactElement<NodeProps>[] {
  if (Array.isArray(node)) return node.flatMap(child => nodesOfType(child, type))
  if (!isValidElement<NodeProps>(node)) return []
  return [...(node.type === type ? [node] : []), ...nodesOfType(node.props.children, type)]
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'" }
export const markupOf = (node: ReactNode) => renderToStaticMarkup(createElement(Fragment, null, node))
export const textOf = (markup: string) => markup.replace(/<[^>]*>/g, ' ').replace(/&(?:amp|lt|gt|quot|#x27);/g, entity => ENTITIES[entity]).replace(/\s+/g, ' ').trim()

export function panelOf(page: ReactNode, value: string) {
  const markup = markupOf(nodesOfType(page, TabsContent).find(node => node.props.value === value)?.props.children)
  return { markup, text: textOf(markup) }
}

export const EXPLANATION = {
  regla: 'R4', modificador: null, banderas: ['PERIODO_NO_INFORMADO', 'TIPO_PERSONA_DESCONOCIDO'],
  severidad: { valor: 80, banda: 'ALTA', estado: 'COMPLETA', obligaciones_no_evaluables: 0 },
  revision: { requiere_revision_humana: false, motivos: [] },
  factores: [
    { factor: 'monto_actualizado_ars', insumo: 815000, puntos: 40, maximo: 50 },
    { factor: 'dias_atraso_maximo', insumo: 271, puntos: 20, maximo: 30 },
    { factor: 'cantidad_vencidas', insumo: 1, puntos: 5, maximo: 20 },
  ],
  frase_contrastiva: 'Se sugiere contacto personal con ofrecimiento de plan o asistencia y no un recordatorio informativo.',
}

export const SNAPSHOT: CaseReviewSnapshot = {
  debtorId: '99', asOf: '2026-10-30', rulesVersion: '1.1.0', inputsHash: 'a'.repeat(64),
  suggestedIntervention: 'CONTACTO_PERSONAL_Y_PLAN', suggestedIntensity: 2, explanation: EXPLANATION, currentReviewId: null,
}

export const historyEntry = (patch: Partial<CaseReviewHistoryEntry> = {}): CaseReviewHistoryEntry => ({
  id: '5', decision: 'RECHAZA', suggestedIntervention: 'SEGUIMIENTO', suggestedIntensity: 0, decidedIntervention: null, decidedIntensity: null,
  reasonCode: 'DATOS_INCOMPLETOS', reasonText: { state: 'NONE' }, checklist: {}, reviewerRole: 'ADMIN', createdAt: '2026-11-02T01:30:00+00:00',
  mine: false, participated: false,
  asOf: '2026-10-30', rulesVersion: '1.1.0', isCurrent: true, status: 'REGISTRADA', approvals: [], currentApprovalId: null, basisChanged: false,
  ...patch,
})

export const ADMIN = { canRecord: true, canApprove: true, canReadReasonText: true }
export const USER = { canRecord: false, canApprove: false, canReadReasonText: false }

export const readyScreen = (patch: Partial<Extract<CaseReviewScreen, { kind: 'ready' }>> = {}): CaseReviewScreen => ({
  kind: 'ready', capabilities: ADMIN, snapshot: { ok: true, snapshot: SNAPSHOT }, history: { ok: true, entries: [] }, ...patch,
})

export const CHECKLIST = { situacion_hogar: 'NO_DISPONIBLE', estado_juridico_verificado: true, canal_valido: true, alternativa_asistida_ofrecida: true } as const

// Propuesta de intensidad 3, pendiente, registrada por otra persona.
export const PROPOSAL = historyEntry({
  decision: 'MODIFICA', decidedIntervention: 'INTIMACION_ADMINISTRATIVA', decidedIntensity: 3, status: 'PENDIENTE_SUPERVISOR',
  reasonCode: 'CRITERIO_DEL_SERVICIO', checklist: CHECKLIST,
})

export const recordedDecision = (patch: Partial<RecordedDecision> = {}): RecordedDecision => ({
  debtorId: '1', reviewId: '5', decision: 'ACEPTA', decidedIntervention: 'RECORDATORIO_INFORMATIVO', decidedIntensity: 1,
  suggestedIntervention: 'RECORDATORIO_INFORMATIVO', suggestedIntensity: 1, status: 'REGISTRADA',
  decidedAt: '2026-11-02T01:30:00+00:00', asOf: '2026-10-30', rulesVersion: '1.1.0', reviewerRole: 'ADMIN', mine: true, participated: patch.mine ?? true, stale: false,
  ...patch,
})

export const decisionsWith = (...decisions: RecordedDecision[]) => ({
  ok: true as const, current: { asOf: '2026-10-30', rulesVersion: '1.1.0' }, byDebtor: new Map(decisions.map(item => [item.debtorId, item])),
})

const absent = { estado: 'NO_INTEGRADO', valor: null } as const

// Entrada mínima evaluable por las reglas reales: una obligación vencida de $ 93.350 al 10/1/2026.
export function decisionInput(patch: Partial<DecisionInput> = {}): DecisionInput {
  return {
    id: '1', as_of: '2026-09-30', source_updated_at: { estado: 'NO_INFORMADO_EN_ORIGEN', valor: null },
    obligaciones: [{
      id: 'd1', current_amount: { estado: 'OBSERVADO', valor: 93350 }, due_date: { estado: 'OBSERVADO', valor: '2026-01-10' },
      estado_origen: absent, periodo_fiscal: absent, estado_catalogo: { estado: 'OBSERVADO', valor: 'OVERDUE' },
    }],
    contactos_activos: { estado: 'OBSERVADO', valor: 1 },
    personas: [{ tipo: absent, porcentaje_declarado: { estado: 'OBSERVADO', valor: 100 } }],
    vulnerabilidad: { estado: 'NO_INFORMADO_EN_ORIGEN', valor: null },
    ...patch,
  }
}

// Una decisión real de las reglas, con la intervención reemplazada si la prueba lo pide.
export function evaluatedDecision(intervencion?: Partial<Decision['intervencion']>, input = decisionInput()): Decision {
  const decision = evaluateDecisionRulesV1(input)
  return intervencion ? { ...decision, intervencion: { ...decision.intervencion, ...intervencion } } : decision
}
