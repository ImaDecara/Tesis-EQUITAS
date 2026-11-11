import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { RecordedDecision } from '@/lib/domain/recorded-decision'
import type { RecordedDecisions } from '@/lib/server/recorded-decisions'
import type { ViewerContext } from '@/lib/server/viewer-context'

// Noche 7. Sesión y decisiones simuladas para las pruebas de pantalla. Cada archivo de prueba hace
// su propio vi.mock de '@/lib/server/viewer-context' y '@/lib/server/recorded-decisions' y usa estos datos.

export const PORTFOLIO_AS_OF = '2026-09-30'

export function viewerFixture(role: 'ADMIN' | 'USER' = 'ADMIN', portfolio: ViewerContext['portfolio'] = { kind: 'LOADED', asOf: PORTFOLIO_AS_OF }): ViewerContext {
  const admin = role === 'ADMIN'
  return {
    userName: `Persona sintética ${role}`, roleName: role, roleLabel: admin ? 'Administrador' : 'Usuario', tenantName: 'Municipio sintético',
    portfolio,
    capabilities: { canImport: admin, canRecordDecision: admin, canApprove: admin, canSeeSupervision: admin, canSeeAudit: admin },
  }
}

export function decisionsFixture(decisions: readonly RecordedDecision[] = [], asOf: string | null = PORTFOLIO_AS_OF): RecordedDecisions {
  return { ok: true, current: { asOf, rulesVersion: '1.1.0' }, byDebtor: new Map(decisions.map(item => [item.debtorId, item])) }
}

export function recordedDecision(debtorId: string, overrides: Partial<RecordedDecision> = {}): RecordedDecision {
  return {
    debtorId, reviewId: `9${debtorId}`, decision: 'ACEPTA', decidedIntervention: 'RECORDATORIO_INFORMATIVO', decidedIntensity: 1,
    suggestedIntervention: 'RECORDATORIO_INFORMATIVO', suggestedIntensity: 1, status: 'REGISTRADA',
    decidedAt: '2026-10-01T15:00:00.000Z', asOf: PORTFOLIO_AS_OF, rulesVersion: '1.1.0', reviewerRole: 'ADMIN', mine: true, participated: true, stale: false,
    ...overrides,
  }
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'" }
export const markupOf = (node: ReactNode) => renderToStaticMarkup(createElement(Fragment, null, node))
export const textOfMarkup = (markup: string) => markup.replace(/<[^>]*>/g, ' ')
  .replace(/&(?:amp|lt|gt|quot|#x27);/g, entity => ENTITIES[entity]).replace(/\s+/g, ' ').trim()
/** Texto visible de la pantalla renderizada (incluye lo que muestran los componentes). */
export const renderedText = (node: ReactNode) => textOfMarkup(markupOf(node))
