import { Badge } from '@/components/ui/badge'

function formatRiskBadgeLabel(label: string, score?: number | null) {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return label
  }

  return `${label} (${Math.round(score)})`
}

// Mapea niveles de riesgo del dominio a una severidad visual consistente.
export function RiskBadge({ risk, score }: { risk: string; score?: number | null }) {
  if (risk === 'ALTO') {
    return <Badge variant="danger">{formatRiskBadgeLabel('Alto', score)}</Badge>
  }

  if (risk === 'MEDIO') {
    return <Badge variant="warning">{formatRiskBadgeLabel('Medio', score)}</Badge>
  }

  return <Badge variant="success">{formatRiskBadgeLabel('Bajo', score)}</Badge>
}
