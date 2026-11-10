import { INTENSE_FROM } from '@/lib/domain/case-review-contract'

// Noche 7. La decisión registrada de un caso, tal como se muestra fuera de la pestaña de revisión:
// encabezado de la ficha, listados y Pendientes. Tres cosas que no se mezclan y usan siempre los
// mismos nombres: recomendación automática (la calcula el sistema), decisión registrada (la toma una
// persona) y aprobación (la da otra persona, solo para acciones de intensidad 3 o 4).
// Sin I/O: los datos los lee `lib/server/recorded-decisions.ts`.

export type RecordedStatus = 'REGISTRADA' | 'PENDIENTE_APROBACION' | 'APROBADA' | 'OBJETADA'

export const RECORDED_STATUS_LABELS: Readonly<Record<RecordedStatus, string>> = {
  REGISTRADA: 'Decisión registrada',
  PENDIENTE_APROBACION: 'Propuesta pendiente de aprobación',
  APROBADA: 'Propuesta aprobada',
  OBJETADA: 'Propuesta objetada',
}

export type RecordedDecision = Readonly<{
  debtorId: string
  reviewId: string
  decision: string
  decidedIntervention: string | null
  decidedIntensity: number | null
  suggestedIntervention: string
  suggestedIntensity: number | null
  status: RecordedStatus
  // Instante de registro (ISO, UTC) y fecha de la cartera sobre la que se decidió.
  decidedAt: string
  asOf: string
  rulesVersion: string
  reviewerRole: string
  // Por identidad: quien mira registró ESTA versión. No se muestra ni viaja la identidad de otra persona.
  mine: boolean
  // Quien mira registró esta versión o una anterior de la misma cadena de reemplazos. Es la regla de la base
  // para aprobar (APPROVER_IS_PROPONENT): quien participó de la propuesta no puede aprobarla.
  participated: boolean
  // La cartera o las reglas cambiaron después: no se presenta como vigente.
  stale: boolean
}>

export function recordedStatus(decidedIntensity: number | null, approval: 'APRUEBA' | 'OBJETA' | null): RecordedStatus {
  if ((decidedIntensity ?? 0) < INTENSE_FROM) return 'REGISTRADA'
  if (approval === 'APRUEBA') return 'APROBADA'
  return approval === 'OBJETA' ? 'OBJETADA' : 'PENDIENTE_APROBACION'
}

// Una decisión se tomó sobre «datos anteriores» si la fecha de la cartera o la versión de reglas ya no
// son las vigentes. Sin cartera vigente no se puede afirmar que siga al día.
export function isStale(decision: { asOf: string; rulesVersion: string }, current: { asOf: string | null; rulesVersion: string }): boolean {
  return current.asOf === null || decision.asOf !== current.asOf || decision.rulesVersion !== current.rulesVersion
}

export const STALE_LABEL = 'Registrada sobre datos anteriores'

export function staleExplanation(decision: Pick<RecordedDecision, 'asOf' | 'rulesVersion'>, current: { asOf: string | null; rulesVersion: string }, formatDay: (day: string) => string): string {
  const reasons = []
  if (current.asOf === null) reasons.push('hoy no hay una cartera vigente')
  else if (decision.asOf !== current.asOf) reasons.push(`se registró con la cartera al ${formatDay(decision.asOf)} y la vigente es al ${formatDay(current.asOf)}`)
  if (decision.rulesVersion !== current.rulesVersion) reasons.push(`se registró con las reglas ${decision.rulesVersion} y las vigentes son ${current.rulesVersion}`)
  return `${STALE_LABEL}: ${reasons.join('; ')}. Conviene revisar el caso de nuevo.`
}

// Qué espera cada caso de quien está mirando (entrada «Pendientes» del menú).
export type PendingKind =
  // Propuesta de otra persona que quien mira puede aprobar u objetar.
  | 'APPROVE'
  // Propuesta de otra persona sobre datos anteriores: ya no se puede aprobar, solo objetar.
  | 'OBJECT_ONLY'
  // Propuesta propia: espera a otra persona. No se puede autoaprobar.
  | 'WAITING_OTHER'
  // Propuesta propia que otra persona objetó: hay que registrar una decisión nueva.
  | 'OBJECTED'
  // Decisión propia registrada sobre datos anteriores: conviene revisarla.
  | 'REVIEW_AGAIN'

export const PENDING_LABELS: Readonly<Record<PendingKind, { title: string; help: string }>> = {
  APPROVE: { title: 'Para aprobar u objetar', help: 'Propuestas de otra persona que esperan tu respuesta.' },
  OBJECT_ONLY: { title: 'Propuestas sobre datos anteriores', help: 'Las registró otra persona antes de que cambiara la cartera o las reglas: ya no se pueden aprobar. Podés objetarlas, o esa persona puede registrar una decisión nueva.' },
  WAITING_OTHER: { title: 'Propuestas en las que participaste, en espera', help: 'Las registraste vos, o registraste una versión anterior: las tiene que aprobar otra persona con rol ADMIN que no haya intervenido. No podés aprobar una propuesta en la que participaste; si en tu municipio no hay otra cuenta ADMIN, quedan pendientes.' },
  OBJECTED: { title: 'Tus propuestas objetadas', help: 'Otra persona las objetó. Abrí el caso para registrar una decisión nueva.' },
  REVIEW_AGAIN: { title: 'Tus decisiones registradas sobre datos anteriores', help: 'La cartera o las reglas cambiaron después de registrarlas. Abrí el caso para revisarlas con los datos vigentes.' },
}
export const PENDING_ORDER: readonly PendingKind[] = ['APPROVE', 'OBJECTED', 'REVIEW_AGAIN', 'WAITING_OTHER', 'OBJECT_ONLY']

export function pendingKind(decision: RecordedDecision, viewer: { canRecord: boolean; canApprove: boolean }): PendingKind | null {
  if (decision.status === 'PENDIENTE_APROBACION') {
    if (decision.participated) return viewer.canRecord ? 'WAITING_OTHER' : null
    if (!viewer.canApprove) return null
    return decision.stale ? 'OBJECT_ONLY' : 'APPROVE'
  }
  if (!decision.mine || !viewer.canRecord) return null
  if (decision.status === 'OBJETADA') return 'OBJECTED'
  return decision.stale ? 'REVIEW_AGAIN' : null
}
