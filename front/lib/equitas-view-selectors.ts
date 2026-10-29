import { aggregateData, compareNullable, metric, observed, readingFailed, unavailable } from '@/lib/data-presence'
import type {
  ChartBucket,
  DataWarning,
  DebtorListItem,
  PersonListItem,
  RecommendationKind,
} from '@/types/equitas-domain'

export const RECOMMENDATION_KINDS: RecommendationKind[] = [
  'Llamado prioritario',
  'Mensaje recordatorio',
  'Plan de pago / revision humana',
  'Seguimiento posterior',
]

export const RECOMMENDATION_BADGE_VARIANT: Record<
  RecommendationKind,
  'danger' | 'warning' | 'info' | 'success'
> = {
  'No disponible': 'info',
  'Llamado prioritario': 'danger',
  'Mensaje recordatorio': 'warning',
  'Plan de pago / revision humana': 'info',
  'Seguimiento posterior': 'success',
}

export function normalizeText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

export function sortByOperationalPriority(debtors: DebtorListItem[]) {
  return [...debtors].sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) {
      return compareNullable(a.priorityScore, b.priorityScore)
    }

    if (b.riskScore !== a.riskScore) {
      return compareNullable(a.riskScore, b.riskScore)
    }

    if (b.totalDebt !== a.totalDebt) {
      return compareNullable(a.totalDebt, b.totalDebt)
    }

    return compareNullable(a.maxDaysOverdue, b.maxDaysOverdue)
  })
}

export function getPriorityCases(debtors: DebtorListItem[]) {
  return sortByOperationalPriority(debtors)
}

export function getNoContactCases(debtors: DebtorListItem[]) {
  return sortByOperationalPriority(debtors.filter((debtor) => debtor.hasContact === false))
}

export function getHighRiskCases(debtors: DebtorListItem[]) {
  return sortByOperationalPriority(debtors.filter((debtor) => debtor.riskScore !== null && debtor.riskScore > 90))
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

export function buildRecommendationSummary(debtors: DebtorListItem[], warnings: DataWarning[] = []) {
  return RECOMMENDATION_KINDS.map((recommendation) => {
    const cases = debtors.filter((debtor) => debtor.recommendationType === recommendation)
    const failed = readingFailed(warnings, 'debtor', 'debt', 'debtor_profile', 'debt_status', 'debtor_contact', 'debtor_person')
    const unknownCases = debtors.filter(debtor => debtor.recommendationType === 'No disponible')
    const countMetric = aggregateData(debtors.map(debtor => debtor.recommendationType === 'No disponible'
      ? unavailable() : observed(debtor.recommendationType === recommendation ? 1 : 0)), 'sum', failed)
    const metrics = {
      totalDebt: aggregateData([...cases.map(debtor => metric(debtor, 'totalDebt')), ...unknownCases.map(() => unavailable())], 'sum', failed),
      riskScore: aggregateData([...cases.map(debtor => metric(debtor, 'riskScore')), ...unknownCases.map(() => unavailable())], 'mean', failed),
    }
    const debtAssociated = metrics.totalDebt.value
    const averageRisk = metrics.riskScore.value
    const highlightedCases = sortByOperationalPriority(cases).slice(0, 3)

    return {
      recommendation,
      cases,
      metrics,
      count: countMetric.value,
      debtAssociated,
      averageRisk,
      highlightedCases,
    }
  })
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
