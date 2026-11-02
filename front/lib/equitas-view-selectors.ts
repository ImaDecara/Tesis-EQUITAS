import decisionRules from '../../contracts/decision-rules.v1.json'
import { comparePriority, type InterventionCode, type RuleDatum } from '@/lib/domain/decision-rules-v1'
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
  const failed = readingFailed(warnings, 'debtor', 'debt', 'debtor_profile')
  const statusFailed = failed || readingFailed(warnings, 'debt_status')
  const metrics = {
    totalDebt: aggregateData(debtors.map(debtor => metric(debtor, 'totalDebt')), 'sum', failed),
    overdueDebt: aggregateData(debtors.map(debtor => metric(debtor, 'overdueDebt')), 'sum', statusFailed),
    averageOverdueDays: aggregateData(debtors.flatMap(debtor => debtor.overdueDebt === null
      ? [metric(debtor, 'overdueDebt')] : debtor.overdueDebt > 0 ? [metric(debtor, 'maxDaysOverdue')] : []), 'mean', statusFailed),
  }
  const totalDebt = metrics.totalDebt.value
  const overdueDebt = metrics.overdueDebt.value
  const averageOverdueDays = metrics.averageOverdueDays.value === null ? null : Math.round(metrics.averageOverdueDays.value)
  const topDebtCases = [...debtors].sort((a, b) => compareNullable(a.totalDebt, b.totalDebt)).slice(0, 10)
  const agingDistribution: ChartBucket[] = statusFailed ? [] : [
    {
      label: 'Sin atraso',
      value: debtors.filter((debtor) => debtor.maxDaysOverdue === 0).length,
    },
    {
      label: '1-30 dias',
      value: debtors.filter(
        (debtor) => debtor.maxDaysOverdue !== null && debtor.maxDaysOverdue > 0 && debtor.maxDaysOverdue <= 30
      ).length,
    },
    {
      label: '31-90 dias',
      value: debtors.filter(
        (debtor) => debtor.maxDaysOverdue !== null && debtor.maxDaysOverdue > 30 && debtor.maxDaysOverdue <= 90
      ).length,
    },
    {
      label: '+90 dias',
      value: debtors.filter((debtor) => debtor.maxDaysOverdue !== null && debtor.maxDaysOverdue > 90).length,
    },
  ]

  if (!statusFailed) {
    const notApplicable = debtors.filter(debtor => debtor.metrics?.maxDaysOverdue.presence === 'NO_APLICA').length
    const unavailableDays = debtors.filter(debtor => debtor.maxDaysOverdue === null).length - notApplicable
    if (notApplicable) agingDistribution.push({ label: 'No aplica', value: notApplicable })
    if (unavailableDays) agingDistribution.push({ label: 'No disponible', value: unavailableDays })
  }
  return {
    metrics,
    totalDebt,
    overdueDebt,
    averageOverdueDays,
    topDebtCases,
    agingDistribution,
  }
}

// La pertenencia a una cola requiere estas lecturas, no perfiles ni catálogos históricos.
export function recommendationQueuesUnknown(debtors: DebtorListItem[], warnings: DataWarning[] = []) {
  return readingFailed(warnings, 'debtor', 'debt', 'debtor_contact', 'debtor_person') ||
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
      totalDebt: aggregateData(cases.map(debtor => debtor.decision
        ? { ...metric(debtor, 'priorityScore'), value: debtor.decision.severidad.monto_actualizado_ars }
        : unavailable()), 'sum', groupFailed),
      riskScore: aggregateData(cases.map(debtor => debtor.decision
        ? { ...metric(debtor, 'priorityScore'), value: debtor.decision.severidad.valor }
        : unavailable()), 'mean', groupFailed),
    }
    return {
      interventionCode: code,
      recommendation: code === null ? 'No disponible' as const : INTERVENTION_LABELS[code],
      cases,
      metrics,
      // La categoría sin cola conocida conserva los objetos; nunca oculta sus filas.
      count: groupFailed ? null : cases.length,
      debtAssociated: metrics.totalDebt.value,
      averageRisk: metrics.riskScore.value,
      highlightedCases: cases.slice(0, 3),
    }
  })
}

// Misma definición de obligación evaluable que evaluateSeverity, solo para el vencimiento.
function dueDateNotEvaluable(due: RuleDatum<string>) {
  return due.estado !== 'OBSERVADO' || due.valor < decisionRules.evaluabilidad.fecha_minima_plausible
}

function differenceData(left: NumericData, right: NumericData) {
  return left.value === null || right.value === null
    ? unavailable() : observed(Math.round((left.value - right.value) * 100) / 100)
}

// KPI-V1-07 a 09. No recalcula colas ni tablero: explica por qué sus sumas no coinciden.
export function buildQueueReconciliation(debtors: DebtorListItem[], warnings: DataWarning[] = []) {
  const queuesUnknown = recommendationQueuesUnknown(debtors, warnings)
  const queueTotal = aggregateData(buildRecommendationSummary(debtors, warnings)
    .filter(group => group.interventionCode !== null).map(group => group.metrics.totalDebt), 'sum', queuesUnknown)
  const dashboardTotal = buildDebtAgingSummary(debtors, warnings).metrics.totalDebt
  const outsideByObject = queuesUnknown ? [] : debtors
    .map(debtor => (debtor.decisionInput?.obligaciones ?? []).filter(item => dueDateNotEvaluable(item.due_date)))
    .filter(items => items.length > 0)
  const outside = outsideByObject.flat()
  // Un importe negativo no es evaluable por sí mismo: queda en el resto de la diferencia.
  const outsideAmount = aggregateData(outside.flatMap(({ current_amount: amount }) => amount.estado !== 'OBSERVADO'
    ? [unavailable(amount.estado)] : amount.valor < 0 ? [] : [observed(amount.valor)]), 'sum', queuesUnknown)
  const difference = differenceData(dashboardTotal, queueTotal)
  return {
    queueTotal,
    dashboardTotal,
    difference,
    outsideAmount,
    outsideObjects: queuesUnknown ? null : outsideByObject.length,
    outsideObligations: queuesUnknown ? null : outside.length,
    outsideWithoutAmount: queuesUnknown ? null : outside.filter(item => item.current_amount.estado !== 'OBSERVADO').length,
    otherDifference: differenceData(difference, outsideAmount),
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
