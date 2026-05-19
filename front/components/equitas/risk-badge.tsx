import { Badge } from '@/components/ui/badge'

// Mapea niveles de riesgo del dominio a una severidad visual consistente.
export function RiskBadge({ risk }: { risk: string }) {
  if (risk === 'ALTO') {
    return <Badge variant="danger">Alto</Badge>
  }

  if (risk === 'MEDIO') {
    return <Badge variant="warning">Medio</Badge>
  }

  return <Badge variant="success">Bajo</Badge>
}
