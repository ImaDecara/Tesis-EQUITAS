import 'server-only'

import { cache } from 'react'

import type { ResolvedRoleName } from '@/lib/auth/tenant-access'
import { requireTenantAccess, roleHasPermission } from '@/lib/server/dal'
import { ROLE_LABELS, roleLabel } from '@/lib/domain/role-labels'
import { resolvePortfolioCutoff } from '@/lib/server/portfolio-cutoff'
import { loadAllTableRows } from '@/lib/data/paginated-table-reader'
import { levelAfter } from '@/lib/server/database-level'

// Noche 7. Lo que la línea fija de contexto y el menú necesitan saber de quien está mirando:
// municipio, fecha de la cartera, quién usa la aplicación y qué funciones nuevas tiene.
// Sale de la sesión verificada por la DAL en esta misma solicitud; nada viene del navegador.
// Mostrar u ocultar una entrada no autoriza nada: cada página, acción y ruta vuelve a comprobar.

// Origen del lote que registra una cartera cargada antes de que existiera el registro de lotes (encargo 10.4).
export const INHERITED_SOURCE = 'CARTERA_HEREDADA'

export type PortfolioState =
  // `declared`: la fecha no salió de una carga; la declaró una persona al registrar la cartera ya cargada.
  | { kind: 'LOADED'; asOf: string; declared?: boolean }
  // Hay cartera pero ninguna fecha de corte registrada (la base no tiene el módulo, o los datos se cargaron
  // por otra vía y no hay ningún lote publicado): los cálculos usan la fecha del día y la pantalla lo dice.
  | { kind: 'UNDATED'; today: string }
  // Reservado para una fuente que certifique ausencia: una respuesta vacía bajo RLS no alcanza.
  | { kind: 'EMPTY' }
  // No se pudo determinar (lectura fallida o publicación incompleta): nunca se muestra como vacío.
  | { kind: 'UNAVAILABLE' }

export type ViewerCapabilities = {
  canImport: boolean
  canRecordDecision: boolean
  canApprove: boolean
  canSeeSupervision: boolean
  canSeeAudit: boolean
}

export type ViewerContext = {
  userName: string | null
  roleName: ResolvedRoleName
  roleLabel: string
  tenantName: string | null
  portfolio: PortfolioState
  // true: la base no tiene el módulo de decisiones, cargas y registro de accesos (encargo 10.2).
  moduleMissing?: true
  capabilities: ViewerCapabilities
}

// Rótulos de los roles: viven en un módulo sin `server-only` porque también los usa la ficha.
export { ROLE_LABELS, roleLabel }

// Sin el módulo ninguna función nueva está disponible, cualquiera sea el rol.
export function capabilitiesFor(roleName: ResolvedRoleName, hasModule = true): ViewerCapabilities {
  const allows = (permission: Parameters<typeof roleHasPermission>[1]) => hasModule && roleHasPermission(roleName, permission)
  return {
    canImport: allows('import:write'),
    canRecordDecision: allows('decision:record'),
    canApprove: allows('decision:approve'),
    canSeeSupervision: allows('supervision:read'),
    canSeeAudit: allows('audit:read'),
  }
}

// Fecha de calendario de hoy en el municipio (la misma que usa el adaptador cuando no hay lote).
function todayInCordoba(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Cordoba', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

// Sin ningún lote publicado: «sin cartera» solo si de verdad no hay ningún caso. Si los hay (se cargaron por
// otra vía, como en la base original), se muestran con la fecha del día: nunca se oculta una cartera que existe.
// Una consulta de una sola fila, y solo en este caso.
async function portfolioWithoutBatch(supabase: Awaited<ReturnType<typeof requireTenantAccess>>['supabase'], tenantId: string): Promise<PortfolioState> {
  const { data, error } = await supabase.from('debtor').select('id').eq('tenant', tenantId).limit(1)
  if (error || !Array.isArray(data)) return { kind: 'UNAVAILABLE' }
  return data.length > 0 ? { kind: 'UNDATED', today: todayInCordoba() } : { kind: 'UNAVAILABLE' }
}

async function readViewerContext(): Promise<ViewerContext | null> {
  try {
    const { supabase, context } = await requireTenantAccess()
    const [user, tenant, batches] = await Promise.all([
      supabase.from('user').select('id,full_name').eq('id', context.appUserId).limit(1),
      supabase.from('tenant').select('id,name').eq('id', context.tenantId).limit(1),
      loadAllTableRows('import_batch', supabase, {
        select: 'id,as_of,source,source_updated_at,status,supersedes,publicacion_atomica:counts->publicacion_atomica', filters: [['tenant', context.tenantId]],
      }),
    ])
    let hasModule = false
    let verified = true
    try { hasModule = await levelAfter(batches.warning) !== 'BASE' } catch { verified = false }
    const cutoff = resolvePortfolioCutoff(
      batches.rows.map(({ publicacion_atomica, ...row }) => ({ ...row, counts: { publicacion_atomica } })), batches.warning)
    // La fecha vigente es la del último lote publicado; si ese lote registra una cartera ya cargada, es declarada.
    const declared = batches.rows.some(row => row.source === INHERITED_SOURCE && row.status === 'PUBLICADO' && row.as_of === cutoff.batch?.as_of
      && !batches.rows.some(other => other.supersedes !== null && String(other.supersedes) === String(row.id)))
    const portfolio: PortfolioState = !verified ? { kind: 'UNAVAILABLE' } : !hasModule ? await portfolioWithoutBatch(supabase, context.tenantId)
      : cutoff.warning ? { kind: 'UNAVAILABLE' }
      : cutoff.batch?.as_of ? { kind: 'LOADED', asOf: cutoff.batch.as_of, ...(declared ? { declared } : {}) }
      : await portfolioWithoutBatch(supabase, context.tenantId)
    return {
      userName: user.error ? null : text(user.data?.[0]?.full_name),
      roleName: context.roleName,
      roleLabel: roleLabel(context.roleName),
      tenantName: tenant.error ? null : text(tenant.data?.[0]?.name),
      portfolio,
      ...(!hasModule && verified ? { moduleMissing: true as const } : {}),
      capabilities: capabilitiesFor(context.roleName, hasModule),
    }
  } catch {
    // Sin sesión verificable no hay contexto: la página muestra su propio estado (ingreso, sin acceso, error).
    return null
  }
}

// Una lectura por solicitud aunque la pidan el marco y la página (memoización de React, no una caché global).
export const loadViewerContext = cache(readViewerContext)
