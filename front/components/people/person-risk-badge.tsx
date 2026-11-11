import { Badge } from '@/components/ui/badge'
import type { PersonIndividualRiskLevel } from '@/types/equitas-domain'

function formatRiskBadgeLabel(label: string, score?: number | null) {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return label
  }

  return `${label} (${Math.round(score)})`
}

export function PersonRiskBadge({
  risk,
  score,
}: {
  risk: PersonIndividualRiskLevel | null
  score?: number | null
}) {
  if (risk === null) return <Badge variant="neutral">No disponible</Badge>

  if (risk === 'ALTO') {
    return <Badge variant="danger">{formatRiskBadgeLabel('Alto', score)}</Badge>
  }

  if (risk === 'MEDIO') {
    return <Badge variant="warning">{formatRiskBadgeLabel('Medio', score)}</Badge>
  }

  return <Badge variant="success">{formatRiskBadgeLabel('Bajo', score)}</Badge>
}
