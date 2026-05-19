import { Badge } from '@/components/ui/badge'

// Insignia reutilizable para disponibilidad de contacto en vistas de objetos de deuda.
export function ContactAvailabilityBadge({ hasContact }: { hasContact: boolean }) {
  if (hasContact) {
    return <Badge variant="success">Disponible</Badge>
  }

  return <Badge variant="warning">Faltante</Badge>
}
