import { Badge } from '@/components/ui/badge'
import type { PersonIndividualRiskLevel } from '@/types/equitas-domain'

export function PersonRiskBadge({ risk }: { risk: PersonIndividualRiskLevel }) {
  if (risk === 'ALTO') {
    return <Badge variant="danger">Alto</Badge>
  }

  if (risk === 'MEDIO') {
    return <Badge variant="warning">Medio</Badge>
  }

  return <Badge variant="success">Bajo</Badge>
}
