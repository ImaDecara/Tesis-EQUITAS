import type {
  ChartBucket,
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
      return b.priorityScore - a.priorityScore
    }

    if (b.riskScore !== a.riskScore) {
      return b.riskScore - a.riskScore
    }

    if (b.totalDebt !== a.totalDebt) {
      return b.totalDebt - a.totalDebt
    }

    return b.maxDaysOverdue - a.maxDaysOverdue
  })
}

export function getPriorityCases(debtors: DebtorListItem[]) {
  return sortByOperationalPriority(debtors)
}

export function getNoContactCases(debtors: DebtorListItem[]) {
  return sortByOperationalPriority(debtors.filter((debtor) => !debtor.hasContact))
}

export function getHighRiskCases(debtors: DebtorListItem[]) {
  return sortByOperationalPriority(debtors.filter((debtor) => debtor.riskScore > 90))
}

export function getHighIndividualRiskPeople(people: PersonListItem[]) {
  return [...people]
    .filter((person) => person.riskValue >= 70)
    .sort((a, b) => {
      if (b.riskValue !== a.riskValue) {
        return b.riskValue - a.riskValue
      }

      return b.totalDebtAssociated - a.totalDebtAssociated
    })
}

export function buildDebtAgingSummary(debtors: DebtorListItem[]) {
  const overdueCases = debtors.filter((debtor) => debtor.overdueDebt > 0)
  const totalDebt = debtors.reduce((acc, debtor) => acc + debtor.totalDebt, 0)
  const overdueDebt = debtors.reduce((acc, debtor) => acc + debtor.overdueDebt, 0)
  const averageOverdueDays =
    overdueCases.length > 0
      ? Math.round(
          overdueCases.reduce((acc, debtor) => acc + debtor.maxDaysOverdue, 0) /
            overdueCases.length
        )
      : 0
  const topDebtCases = [...debtors].sort((a, b) => b.totalDebt - a.totalDebt).slice(0, 10)
  const agingDistribution: ChartBucket[] = [
    {
      label: 'Sin atraso',
      value: debtors.filter((debtor) => debtor.maxDaysOverdue === 0).length,
    },
    {
      label: '1-30 dias',
      value: debtors.filter(
        (debtor) => debtor.maxDaysOverdue > 0 && debtor.maxDaysOverdue <= 30
      ).length,
    },
    {
      label: '31-90 dias',
      value: debtors.filter(
        (debtor) => debtor.maxDaysOverdue > 30 && debtor.maxDaysOverdue <= 90
      ).length,
    },
    {
      label: '+90 dias',
      value: debtors.filter((debtor) => debtor.maxDaysOverdue > 90).length,
    },
  ]

  return {
    totalDebt,
    overdueDebt,
    averageOverdueDays,
    topDebtCases,
    agingDistribution,
  }
}

export function buildRecommendationSummary(debtors: DebtorListItem[]) {
  return RECOMMENDATION_KINDS.map((recommendation) => {
    const cases = debtors.filter((debtor) => debtor.recommendationType === recommendation)
    const debtAssociated = cases.reduce((acc, debtor) => acc + debtor.totalDebt, 0)
    const averageRisk =
      cases.length > 0
        ? cases.reduce((acc, debtor) => acc + debtor.riskScore, 0) / cases.length
        : 0
    const highlightedCases = sortByOperationalPriority(cases).slice(0, 3)

    return {
      recommendation,
      cases,
      count: cases.length,
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
