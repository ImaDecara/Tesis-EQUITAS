import 'server-only'

import type { ResolvedRoleName } from '@/lib/auth/tenant-access'
import { parseQueueFilters } from '@/lib/reports/queue-report'
import { ReportFilterError } from '@/lib/reports/report-format'
import { requireTenantAccess, roleHasPermission, type DalPermission } from '@/lib/server/dal'

// Accesos visibles a los CSV que ya existen en app/api/reports/*. Cada enlace declara el mismo
// permiso que su Route Handler (una prueba lo compara con el código de la ruta). Mostrar u ocultar
// un enlace no autoriza nada: la ruta vuelve a comprobar sesión, municipio y rol en cada descarga.
export const REPORT_LINKS = [
  {
    id: 'queue', href: '/api/reports/queue', permission: 'portfolio:read', label: 'Cola de trabajo',
    description: 'Casos prioritarios de todas las colas, con su prioridad e intervención sugerida.',
  },
  {
    id: 'data-quality', href: '/api/reports/data-quality', permission: 'portfolio:read', label: 'Calidad de datos',
    description: 'Presencia de importes, contactos, atraso y severidad en la cartera publicada.',
  },
  {
    id: 'decisions', href: '/api/reports/decisions', permission: 'decision:read', label: 'Decisiones',
    description: 'Decisiones registradas y su estado de aprobación, sin texto libre ni identidades.',
  },
  {
    id: 'supervision', href: '/api/reports/supervision', permission: 'supervision:read', label: 'Supervisión',
    description: 'Aprobaciones y objeciones de supervisión por corte.',
  },
  {
    id: 'access', href: '/api/reports/access', permission: 'audit:read', label: 'Registro de accesos',
    description: 'Aperturas de casos y exportaciones registradas por la auditoría.',
  },
] as const satisfies readonly { id: string; href: string; permission: DalPermission; label: string; description: string }[]

export type ReportLink = (typeof REPORT_LINKS)[number]

export function reportLinksForRole(roleName: ResolvedRoleName): ReportLink[] {
  return REPORT_LINKS.filter(link => roleHasPermission(roleName, link.permission))
}

// null cuando no se pudo verificar la sesión: la pantalla no ofrece enlaces que no puede justificar.
export async function availableReportLinks(): Promise<ReportLink[] | null> {
  try {
    const { context } = await requireTenantAccess()
    return reportLinksForRole(context.roleName)
  } catch {
    return null
  }
}

// Filtros de la pantalla de colas que el CSV de cola también aplica (parseQueueFilters).
const QUEUE_REPORT_FILTERS = ['q', 'risk', 'contact', 'type', 'minAmount'] as const
// Filtros de esa pantalla que el CSV no admite: se informan en vez de ignorarlos en silencio.
const SCREEN_ONLY_FILTERS = { status: 'estado', personId: 'persona' } as const

export type QueueReportLink =
  | { available: true; href: string; screenOnlyFilters: string[] }
  | { available: false; reason: string }

type ScreenFilters = Partial<Record<(typeof QUEUE_REPORT_FILTERS)[number] | keyof typeof SCREEN_ONLY_FILTERS, string>>

// `selectionAvailable` es lo que la pantalla puede afirmar: si declara «No disponible» (lectura
// incompleta o datos faltantes para evaluar un filtro), no se ofrece un CSV de esa misma selección.
export function queueReportLink(filters: ScreenFilters, screen: { selectionAvailable: boolean } = { selectionAvailable: true }): QueueReportLink {
  const params = new URLSearchParams()
  for (const name of QUEUE_REPORT_FILTERS) {
    const value = filters[name]?.trim()
    if (value) params.set(name, value)
  }
  // La pantalla rechaza un monto negativo o ilegible; el enlace no exporta otra selección.
  const minAmount = params.get('minAmount')
  if (minAmount !== null && !(Number.isFinite(Number(minAmount)) && Number(minAmount) >= 0)) {
    return { available: false, reason: 'Corregí el monto mínimo para descargar el CSV de esta selección.' }
  }
  if (!screen.selectionAvailable) {
    return { available: false, reason: 'La pantalla no puede determinar esta selección (lectura incompleta o datos faltantes para los filtros): no se ofrece el CSV.' }
  }
  try {
    parseQueueFilters(params)
  } catch (error) {
    if (error instanceof ReportFilterError) {
      return { available: false, reason: 'Los filtros actuales no son válidos para el CSV; limpialos para descargarlo.' }
    }
    throw error
  }
  const query = params.toString()
  const screenOnlyFilters = Object.entries(SCREEN_ONLY_FILTERS).flatMap(([name, label]) =>
    filters[name as keyof typeof SCREEN_ONLY_FILTERS]?.trim() ? [label] : [])
  return { available: true, href: query ? `/api/reports/queue?${query}` : '/api/reports/queue', screenOnlyFilters }
}
