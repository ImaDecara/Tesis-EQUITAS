import { casesLabel } from '@/components/portfolio/portfolio-text'
import { formatPercentage, percentageData } from '@/lib/data-presence'

// Resumen operativo del tablero (recuperado de main): tres frases cortas, todas con cifras que el
// tablero ya calculó para la selección. Sin dato no se escribe la frase con un cero: se dice que falta.

type Inputs = {
  total: number | null
  priorityCases: number | null
  overdueCases: number | null
  withoutContactCases: number | null
  groups: readonly { label: string; count: number | null }[]
}

export function operationalSummary({ total, priorityCases, overdueCases, withoutContactCases, groups }: Inputs): string[] {
  if (total === 0) return ['No hay casos en la selección.']
  const of = (part: number | null) => formatPercentage(percentageData(part, total))
  const lines = [
    overdueCases === null ? 'No se pudo determinar cuántos casos tienen deuda vencida.'
      : `${casesLabel(overdueCases)} con deuda vencida (${of(overdueCases)} de la cartera); ${priorityCases === null ? 'el puntaje alto no está disponible' : `${casesLabel(priorityCases)} con puntaje alto`}.`,
    withoutContactCases === null ? 'No se pudieron leer los contactos: no se sabe cuántos casos no tienen uno.'
      : withoutContactCases === 0 ? 'Todos los casos tienen un contacto activo cargado.'
      : `${casesLabel(withoutContactCases)} sin un contacto activo cargado: primero hay que mejorar sus datos.`,
  ]
  const counted = groups.filter((group): group is { label: string; count: number } => group.count !== null)
  const largest = counted.length === groups.length ? [...counted].sort((a, b) => b.count - a.count).find(group => group.count > 0) ?? null : null
  lines.push(largest ? `El grupo de trabajo con más casos es «${largest.label}» (${casesLabel(largest.count)}).` : 'No se puede decir qué grupo de trabajo tiene más casos: faltan datos de algún grupo.')
  return lines
}
