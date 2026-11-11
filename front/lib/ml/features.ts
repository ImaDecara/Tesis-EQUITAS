import type { DebtorListItem, NumericData } from '@/types/equitas-domain'
import type { ClusteringFeature } from './contract'

export const FEATURES: ClusteringFeature[] = [
  { key: 'overdue_amount', label: 'Deuda vencida', unit: 'ARS', transform: 'LOG1P', winsorUpperQuantile: 0.99, rationale: 'Describe el volumen económico vencido del caso.' },
  { key: 'max_overdue_days', label: 'Atraso máximo', unit: 'DAYS', transform: 'LOG1P', winsorUpperQuantile: 0.99, rationale: 'Distingue atrasos recientes de deudas antiguas.' },
  { key: 'obligation_count', label: 'Cantidad de obligaciones', unit: 'COUNT', transform: 'LOG1P', winsorUpperQuantile: 0.99, rationale: 'Describe la extensión del caso, incluyendo todas sus obligaciones registradas.' },
]
const REASONS = {
  MISSING_AMOUNT: 'Importe vencido ausente, inválido o parcial',
  MISSING_DATE: 'Atraso ausente, inválido o parcial',
  NO_OVERDUE_DEBT: 'Sin deuda vencida positiva',
  MISSING_COUNT: 'Cantidad de obligaciones ausente o inválida',
}
function complete(metric: NumericData | undefined) {
  return metric?.presence === 'OBSERVADO' && metric.value !== null && Number.isFinite(metric.value) &&
    !Object.values(metric.missing).some(value => value && value > 0)
}
/** Lista cerrada: no toca identidad, contactos, vulnerabilidad ni decisiones. */
export function prepareCases(cases: readonly DebtorListItem[]) {
  const exclusions = Object.entries(REASONS).map(([reason, label]) => ({ reason, label, count: 0 }))
  const entries: { values: number[]; sourceIndex: number }[] = []
  cases.forEach((item, sourceIndex) => {
    const amount = item.metrics?.overdueDebt, days = item.metrics?.maxDaysOverdue
    const reason = !complete(amount) || amount!.value! < 0 ? 'MISSING_AMOUNT'
      : amount!.value! === 0 ? 'NO_OVERDUE_DEBT'
      : !complete(days) || days!.value! < 0 ? 'MISSING_DATE'
      : !Number.isSafeInteger(item.debtCount) || item.debtCount! <= 0 ? 'MISSING_COUNT' : null
    if (reason) exclusions.find(item => item.reason === reason)!.count++
    else entries.push({ values: [amount!.value!, days!.value!, item.debtCount!], sourceIndex })
  })
  // Orden canónico solo por variables; evita que el orden de lectura determine el ajuste.
  entries.sort((a, b) => a.values[0] - b.values[0] || a.values[1] - b.values[1] || a.values[2] - b.values[2])
  return { entries, exclusions }
}
