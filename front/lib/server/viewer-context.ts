import 'server-only'

import { cache } from 'react'

import type { ResolvedRoleName } from '@/lib/auth/tenant-access'
import { requireTenantAccess, roleHasPermission } from '@/lib/server/dal'
import { ROLE_LABELS, roleLabel } from '@/lib/domain/role-labels'
import { resolvePortfolioCutoff } from '@/lib/server/portfolio-cutoff'
import { loadAllTableRows } from '@/lib/data/paginated-table-reader'

// Noche 7. Lo que la línea fija de contexto y el menú necesitan saber de quien está mirando:
// municipio, fecha de la cartera, quién usa la aplicación y qué funciones nuevas tiene.
// Sale de la sesión verificada por la DAL en esta misma solicitud; nada viene del navegador.
// Mostrar u ocultar una entrada no autoriza nada: cada página, acción y ruta vuelve a comprobar.

export type PortfolioState =
  | { kind: 'LOADED'; asOf: string }
  // El municipio todavía no tiene ninguna cartera publicada: no es un error.
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
  capabilities: ViewerCapabilities
}

// Rótulos de los roles: viven en un módulo sin `server-only` porque también los usa la ficha.
export { ROLE_LABELS, roleLabel }

export function capabilitiesFor(roleName: ResolvedRoleName): ViewerCapabilities {
  return {
    canImport: roleHasPermission(roleName, 'import:write'),
    canRecordDecision: roleHasPermission(roleName, 'decision:record'),
    canApprove: roleHasPermission(roleName, 'decision:approve'),
    canSeeSupervision: roleHasPermission(roleName, 'supervision:read'),
    canSeeAudit: roleHasPermission(roleName, 'audit:read'),
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function readViewerContext(): Promise<ViewerContext | null> {
  try {
    const { supabase, context } = await requireTenantAccess()
    const [user, tenant, batches] = await Promise.all([
      supabase.from('user').select('id,full_name').eq('id', context.appUserId).limit(1),
      supabase.from('tenant').select('id,name').eq('id', context.tenantId).limit(1),
      loadAllTableRows('import_batch', supabase, {
        select: 'id,as_of,source_updated_at,status,supersedes,publicacion_atomica:counts->publicacion_atomica', filters: [['tenant', context.tenantId]],
      }),
    ])
    const cutoff = resolvePortfolioCutoff(
      batches.rows.map(({ publicacion_atomica, ...row }) => ({ ...row, counts: { publicacion_atomica } })), batches.warning)
    const portfolio: PortfolioState = cutoff.warning ? { kind: 'UNAVAILABLE' }
      : cutoff.batch?.as_of ? { kind: 'LOADED', asOf: cutoff.batch.as_of } : { kind: 'EMPTY' }
    return {
      userName: user.error ? null : text(user.data?.[0]?.full_name),
      roleName: context.roleName,
      roleLabel: roleLabel(context.roleName),
      tenantName: tenant.error ? null : text(tenant.data?.[0]?.name),
      portfolio,
      capabilities: capabilitiesFor(context.roleName),
    }
  } catch {
    // Sin sesión verificable no hay contexto: la página muestra su propio estado (ingreso, sin acceso, error).
    return null
  }
}

// Una lectura por solicitud aunque la pidan el marco y la página (memoización de React, no una caché global).
export const loadViewerContext = cache(readViewerContext)
