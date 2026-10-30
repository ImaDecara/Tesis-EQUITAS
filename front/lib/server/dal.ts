import 'server-only'

import { cookies } from 'next/headers'
import { resolveTenantAccess, TENANT_COOKIE, type AuthValidationErrorCode, type WebRole } from '@/lib/auth/tenant-access'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { loadAllTableRows } from '@/lib/data/paginated-table-reader'
import { tenantReadScope, type PortfolioTable } from '@/lib/server/tenant-read-scope'

const PERMISSIONS = {
  'portfolio:read': ['consulta', 'operador', 'supervisor'],
  'decision:record': ['operador', 'supervisor'],
  'decision:approve': ['supervisor'],
  'supervision:read': ['supervisor'],
  'import:write': ['importador', 'supervisor'],
} as const satisfies Record<string, readonly WebRole[]>
export type DalPermission = keyof typeof PERMISSIONS

export class DataAccessError extends Error {
  readonly status: number
  constructor(readonly code: AuthValidationErrorCode | 'TABLE_FORBIDDEN', message: string) {
    super(message)
    this.name = 'DataAccessError'
    this.status = code === 'AUTH_REQUIRED' ? 401 :
      code === 'TENANT_SELECTION_REQUIRED' ? 409 :
      ['DATABASE_ERROR', 'AUTH_UNAVAILABLE', 'SUPABASE_NOT_CONFIGURED'].includes(code) ? 503 : 403
  }
}

// Por solicitud, sin cache global ni identidad/rol suministrados por el navegador.
// Las acciones y Route Handlers deben invocar esta funcion dentro de cada entrada.
export async function requireTenantAccess(options: { permission?: DalPermission; tenantId?: string } = {}) {
  const cookieStore = await cookies()
  const supabase = await createServerSupabaseClient()
  if (!supabase) throw new DataAccessError('SUPABASE_NOT_CONFIGURED', 'No disponible: Supabase no esta configurado.')
  let identity
  try {
    identity = await supabase.auth.getUser()
  } catch {
    throw new DataAccessError('AUTH_UNAVAILABLE', 'No disponible: no se pudo verificar la sesion.')
  }
  if (identity.error || !identity.data.user) throw new DataAccessError('AUTH_REQUIRED', 'Debes iniciar sesion para continuar.')
  const tenantId = options.tenantId ?? cookieStore.get(TENANT_COOKIE)?.value
  const access = await resolveTenantAccess(identity.data.user.id, supabase, tenantId)
  if (!access.isAuthorized || !access.context) {
    throw new DataAccessError(access.code!, access.message!)
  }
  const roles: readonly WebRole[] = PERMISSIONS[options.permission ?? 'portfolio:read'] ?? []
  if (!roles.includes(access.context.role)) throw new DataAccessError('ROLE_FORBIDDEN', 'El rol no permite esta operacion.')
  return { supabase, context: access.context }
}

// Solo devuelve filas de tablas declaradas y del municipio verificado. Los errores
// de consulta conservan DataWarning; una denegacion nunca se convierte en filas [].
export async function createTenantReader() {
  const { supabase, context } = await requireTenantAccess()
  return {
    context,
    async readTable(table: PortfolioTable) {
      const scope = tenantReadScope(table, context.tenantId)
      if (!scope) throw new DataAccessError('TABLE_FORBIDDEN', 'La tabla no esta habilitada en la DAL.')
      return loadAllTableRows(table, supabase, scope)
    },
  }
}
