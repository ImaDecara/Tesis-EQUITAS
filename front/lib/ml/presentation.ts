import type { DebtorListItem } from '@/types/equitas-domain'
import type { ClusteringResult } from './contract'
import type { prepareCases } from './features'

/** Única lectura de decisiones: posterior al ajuste, solo para el cruce descriptivo. */
export function withRuleGroups(result: ClusteringResult, labels: number[], entries: ReturnType<typeof prepareCases>['entries'], cases: readonly DebtorListItem[]): ClusteringResult {
  return { ...result, clusters: result.clusters.map((cluster, c) => {
    const groups = new Map<string, { groupKey: string; groupLabel: string; count: number }>()
    entries.forEach((entry, i) => {
      if (labels[i] !== c) return
      const item = cases[entry.sourceIndex]
      const groupKey = item.decision?.prioridad.cola ?? 'NO_DISPONIBLE'
      const group = groups.get(groupKey) ?? { groupKey, groupLabel: item.recommendationType, count: 0 }
      group.count++; groups.set(groupKey, group)
    })
    return { ...cluster, ruleGroups: [...groups.values()].sort((a, b) => a.groupKey.localeCompare(b.groupKey)) }
  }) }
}
