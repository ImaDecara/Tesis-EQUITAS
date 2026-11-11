import { compareObjectIds, coverageText, withMaturityMetrics, sumMoney } from '@/lib/analytics'
import { ACTIVE_RULES, comparePriority, isPaidObligation, type InterventionCode, type RuleDatum } from '@/lib/domain/decision-rules-v1'
import { INTERVENTION_CODES, INTERVENTION_LABELS } from '@/lib/services/debtor-recommendation-generator'
import { aggregateData, compareNullable, metric, observed, readingFailed, unavailable } from '@/lib/data-presence'
import type {
  ChartBucket,
  DataWarning,
  DebtorListItem,
  NumericData,
  PersonListItem,
  RecommendationKind,
} from '@/types/equitas-domain'

// El orden visual del catálogo no compara la prioridad de colas distintas.
export const RECOMMENDATION_KINDS: RecommendationKind[] = [
  ...INTERVENTION_CODES.map(code => INTERVENTION_LABELS[code]), 'No disponible',
]

export const RECOMMENDATION_BADGE_VARIANT: Record<
  RecommendationKind,
  'danger' | 'warning' | 'info' | 'success'
> = {
  'No disponible': 'info',
  'Mejorar datos': 'info',
  'Revisión jurídica': 'warning',
  'Contacto y plan': 'warning',
  'Recordatorio': 'info',
  'Seguimiento': 'success',
  'Llamado prioritario': 'danger',
  'Mensaje recordatorio': 'warning',
  'Plan de pago / revision humana': 'info',
  'Seguimiento posterior': 'success',
}

export function normalizeText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function compareIds(a: DebtorListItem, b: DebtorListItem) {
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1
}

/** Orden v1 dentro de una única intervención; no reinterpreta DTO heredados. */
export function getInterventionCases(debtors: DebtorListItem[], code: InterventionCode) {
  return debtors.filter(item => item.decision?.prioridad.cola === code).sort((a, b) =>
    comparePriority({ id: a.id, decision: a.decision! }, { id: b.id, decision: b.decision! }))
}

export function sortByOperationalPriority(debtors: DebtorListItem[]) {
  return [
    ...INTERVENTION_CODES.flatMap(code => getInterventionCases(debtors, code)),
    ...debtors.filter(item => !item.decision).sort(compareIds),
  ]
}

export function getPriorityCases(debtors: DebtorListItem[]) {
  return sortByOperationalPriority(debtors)
}

export function getNoContactCases(debtors: DebtorListItem[]) {
  return sortByOperationalPriority(debtors.filter((debtor) => debtor.hasContact === false))
}

export function getHighRiskCases(debtors: DebtorListItem[]) {
  return sortByOperationalPriority(debtors.filter((debtor) => debtor.decision?.severidad.banda === 'ALTA'))
}

export function getHighIndividualRiskPeople(people: PersonListItem[]) {
  return [...people]
    .filter((person) => person.riskValue !== null && person.riskValue >= 70)
    .sort((a, b) => {
      if (b.riskValue !== a.riskValue) {
        return compareNullable(a.riskValue, b.riskValue)
      }

      return compareNullable(a.totalDebtAssociated, b.totalDebtAssociated)
    })
}

export function buildDebtAgingSummary(debtors: DebtorListItem[], warnings: DataWarning[] = []) {
  // Las tres definiciones salen de las obligaciones (portfolio-totals); sin catálogo de estados no se sabe qué
  // está pagado, así que la deuda pendiente y la vencida quedan no disponibles.
  const failed = readingFailed(warnings, 'debtor', 'debt')
  const statusFailed = readingFailed(warnings, 'debtor', 'debt', 'debt_status')
  const cases = debtors.map(withMaturityMetrics)
  const averages = cases.flatMap(debtor => debtor.overdueDebt === null ? [metric(debtor, 'overdueDebt')]
    : debtor.overdueDebt > 0 || Object.keys(metric(debtor, 'maxDaysOverdue').missing).length ? [metric(debtor, 'maxDaysOverdue')] : [])
  const metrics = {
    totalDebt: sumMoney(debtors.map(debtor => metric(debtor, 'totalDebt')), failed),
    pendingDebt: sumMoney(debtors.map(debtor => metric(debtor, 'pendingDebt')), statusFailed),
    overdueDebt: sumMoney(cases.map(debtor => metric(debtor, 'overdueDebt')), statusFailed),
    averageOverdueDays: aggregateData(averages, 'mean', statusFailed),
  }
  const totalDebt = metrics.totalDebt.value
  const overdueDebt = metrics.overdueDebt.value
  const averageOverdueDays = metrics.averageOverdueDays.value === null ? null : Math.round(metrics.averageOverdueDays.value)
  const topDebtCases = failed ? [] : [...cases].filter(item => item.totalDebt !== null).sort((a, b) => compareNullable(a.totalDebt, b.totalDebt) || compareObjectIds(a, b)).slice(0, 10)
  const agingDistribution: ChartBucket[] = statusFailed ? [] : [
    {
      label: 'Sin atraso',
      value: cases.filter((debtor) => debtor.maxDaysOverdue === 0).length,
    },
    {
      label: '1-30 dias',
      value: cases.filter(
        (debtor) => debtor.maxDaysOverdue !== null && debtor.maxDaysOverdue > 0 && debtor.maxDaysOverdue <= 30
      ).length,
    },
    {
      label: '31-90 dias',
      value: cases.filter(
        (debtor) => debtor.maxDaysOverdue !== null && debtor.maxDaysOverdue > 30 && debtor.maxDaysOverdue <= 90
      ).length,
    },
    {
      label: '+90 dias',
      value: cases.filter((debtor) => debtor.maxDaysOverdue !== null && debtor.maxDaysOverdue > 90).length,
    },
  ]

  if (!statusFailed) {
    const notApplicable = cases.filter(debtor => debtor.metrics?.maxDaysOverdue.presence === 'NO_APLICA').length
    const unavailableDays = cases.filter(debtor => debtor.maxDaysOverdue === null).length - notApplicable
    if (notApplicable) agingDistribution.push({ label: 'No aplica', value: notApplicable })
    if (unavailableDays) agingDistribution.push({ label: 'No disponible', value: unavailableDays })
  }
  return {
    metrics,
    cases,
    coverage: { totalDebt: coverageText(debtors.map(item => metric(item, 'totalDebt')), failed), overdueDebt: coverageText(cases.map(item => metric(item, 'overdueDebt')), statusFailed), averageOverdueDays: coverageText(averages, statusFailed) },
    totalDebt,
    overdueDebt,
    averageOverdueDays,
    topDebtCases,
    agingDistribution,
  }
}

// La pertenencia a una cola requiere estas lecturas, no perfiles ni catálogos históricos.
export function recommendationQueuesUnknown(debtors: DebtorListItem[], warnings: DataWarning[] = []) {
  return readingFailed(warnings, 'debtor', 'debt', 'debt_status', 'debtor_contact', 'debtor_person') ||
    (debtors.length > 0 && debtors.every(item => !item.decision))
}

export function buildRecommendationSummary(debtors: DebtorListItem[], warnings: DataWarning[] = []) {
  const universeFailed = readingFailed(warnings, 'debtor')
  const queuesUnknown = recommendationQueuesUnknown(debtors, warnings)
  return [...INTERVENTION_CODES, null].map(code => {
    const groupFailed = code === null ? universeFailed : queuesUnknown
    const cases = groupFailed ? [] : code === null
      ? debtors.filter(item => !item.decision || queuesUnknown).sort(compareIds) : getInterventionCases(debtors, code)
    const metrics = {
      totalDebt: sumMoney(cases.map(debtor => debtor.decision
        ? { ...metric(debtor, 'priorityScore'), value: debtor.decision.severidad.monto_actualizado_ars }
        : metric(debtor, 'priorityScore')), groupFailed),
      riskScore: aggregateData(cases.map(debtor => debtor.decision
        ? { ...metric(debtor, 'priorityScore'), value: debtor.decision.severidad.valor }
        : metric(debtor, 'priorityScore')), 'mean', groupFailed),
    }
    return {
      interventionCode: code,
      recommendation: code === null ? 'No disponible' as const : INTERVENTION_LABELS[code],
      cases,
      metrics,
      coverage: {
        totalDebt: coverageText(cases.map(item => item.decision ? { ...metric(item, 'priorityScore'), value: item.decision.severidad.monto_actualizado_ars } : metric(item, 'priorityScore')), groupFailed),
        riskScore: coverageText(cases.map(item => metric(item, 'priorityScore')), groupFailed),
      },
      // La categoría sin cola conocida conserva los objetos; nunca oculta sus filas.
      count: groupFailed ? null : cases.length,
      debtAssociated: metrics.totalDebt.value,
      averageRisk: metrics.riskScore.value,
      highlightedCases: cases.slice(0, 3),
    }
  })
}

// ALIGN-021. Cada cola es la intervención; el grupo sin decisión también se puede abrir.
export const NO_QUEUE_PARAM = 'SIN_COLA'
type QueueGroup = { interventionCode: InterventionCode | null; cases: DebtorListItem[] }
export const queueParam = (group: Pick<QueueGroup, 'interventionCode'>) => group.interventionCode ?? NO_QUEUE_PARAM

// Un valor desconocido no es un error: se abre la primera cola con casos.
export function selectQueueGroup<T extends QueueGroup>(groups: readonly T[], requested: string | undefined): T {
  return groups.find(group => queueParam(group) === requested) ?? groups.find(group => group.cases.length > 0) ?? groups[0]
}

// Misma definición de obligación evaluable que evaluateSeverity, solo para el vencimiento.
function dueDateNotEvaluable(due: RuleDatum<string>) {
  return due.estado !== 'OBSERVADO' || due.valor < ACTIVE_RULES.evaluabilidad.fecha_minima_plausible
}

function differenceData(left: NumericData, right: NumericData) {
  return left.value === null || right.value === null
    ? aggregateData([left, right], 'sum', true) : sumMoney([left, { ...right, value: -right.value }])
}

// KPI-V1-07 a 09. No recalcula colas ni tablero: explica por qué sus sumas no coinciden.
// Reglas 1.1.0: las pagadas están en el total registrado del tablero y nunca en las colas.
export function buildQueueReconciliation(debtors: DebtorListItem[], warnings: DataWarning[] = []) {
  const queuesUnknown = recommendationQueuesUnknown(debtors, warnings)
  // Una cola vacía no observa ningún importe: su 0 no reemplaza al monto que falta en otra.
  const queueTotal = sumMoney(buildRecommendationSummary(debtors, warnings)
    .filter(group => group.interventionCode !== null && group.count !== 0)
    .map(group => group.metrics.totalDebt), queuesUnknown)
  const dashboardTotal = buildDebtAgingSummary(debtors, warnings).metrics.totalDebt
  const obligations = (debtor: DebtorListItem) => debtor.decisionInput?.obligaciones ?? []
  const paid = queuesUnknown ? [] : debtors.flatMap(debtor => obligations(debtor).filter(item => isPaidObligation(item)))
  const paidAmount = sumMoney(paid.map(({ current_amount: amount }) => amount.estado === 'OBSERVADO'
    ? observed(amount.valor) : unavailable(amount.estado)), queuesUnknown)
  const outsideByObject = queuesUnknown ? [] : debtors
    .map(debtor => obligations(debtor).filter(item => !isPaidObligation(item) && dueDateNotEvaluable(item.due_date)))
    .filter(items => items.length > 0)
  const outside = outsideByObject.flat()
  // Un importe negativo no es evaluable por sí mismo: queda en el resto de la diferencia.
  const outsideAmount = sumMoney(outside.flatMap(({ current_amount: amount }) => amount.estado !== 'OBSERVADO'
    ? [unavailable(amount.estado)] : amount.valor < 0 ? [] : [observed(amount.valor)]), queuesUnknown)
  const difference = differenceData(dashboardTotal, queueTotal)
  return {
    queueTotal,
    dashboardTotal,
    difference,
    paidAmount,
    paidObligations: queuesUnknown ? null : paid.length,
    outsideAmount,
    outsideObjects: queuesUnknown ? null : outsideByObject.length,
    outsideObligations: queuesUnknown ? null : outside.length,
    outsideWithoutAmount: queuesUnknown ? null : outside.filter(item => item.current_amount.estado !== 'OBSERVADO').length,
    otherDifference: differenceData(differenceData(difference, paidAmount), outsideAmount),
  }
}

export function matchesDebtorSearch(debtor: DebtorListItem, query: string) {
  const normalizedQuery = normalizeText(query)

  return (
    !normalizedQuery ||
    normalizeText(debtor.identifier).includes(normalizedQuery) ||
    normalizeText(debtor.description).includes(normalizedQuery) ||
    debtor.peopleNames.some((name) => normalizeText(name).includes(normalizedQuery))
  )
}
