import 'server-only'

import { cookies } from 'next/headers'
import { E06_READ_ONLY_COMPAT_ROLE, resolveTenantAccessWithRoleName, TENANT_COOKIE, type AuthValidationErrorCode, type ResolvedRoleName, type TenantAccessContext } from '@/lib/auth/tenant-access'
import { isAuthServiceUnavailable } from '@/lib/auth/session-routing'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { loadAllTableRows } from '@/lib/data/paginated-table-reader'
import { tenantReadScope, type PortfolioTable } from '@/lib/server/tenant-read-scope'

// ALIGN-003 y funciones de ALIGN-018: `operador` registra, `supervisor` aprueba y
// no importa. `importador_sistema` es de maquina y no entra por la web. La lectura
// tambien admite la compatibilidad E06, que no aparece en ningun otro permiso.
const PERMISSIONS = {
  'portfolio:read': ['consulta', 'operador', 'supervisor', E06_READ_ONLY_COMPAT_ROLE],
  // ALIGN-028: leer decisiones sin texto libre ni identidades. La compatibilidad E06 no entra:
  // solo lee cartera. La politica de `case_review` admite a todo miembro activo.
  'decision:read': ['consulta', 'operador', 'supervisor'],
  // ALIGN-028: el identificador de origen es texto libre; solo lo exporta quien gestiona casos.
  'report:object-identifier': ['operador', 'supervisor'],
  'decision:record': ['operador'],
  'decision:approve': ['supervisor'],
  'supervision:read': ['supervisor'],
  // ALIGN-069: reporte de accesos. La politica de `access_audit` exige lo mismo.
  'audit:read': ['supervisor'],
  'import:write': ['importador'],
} as const satisfies Record<string, readonly ResolvedRoleName[]>
export type DalPermission = keyof typeof PERMISSIONS

export function roleHasPermission(roleName: ResolvedRoleName, permission: DalPermission) {
  const roles: readonly ResolvedRoleName[] = PERMISSIONS[permission] ?? []
  return roles.includes(roleName)
}

// `role` del contexto publico es un ID: aca se separa para que nadie lo lea como nombre.
export type DalContext = Omit<TenantAccessContext, 'role'> & { roleId: string; roleName: ResolvedRoleName }

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
  if (isAuthServiceUnavailable(identity.error)) throw new DataAccessError('AUTH_UNAVAILABLE', 'No disponible: no se pudo verificar la sesion.')
  if (identity.error || !identity.data.user) throw new DataAccessError('AUTH_REQUIRED', 'Debes iniciar sesion para continuar.')
  const tenantId = options.tenantId ?? cookieStore.get(TENANT_COOKIE)?.value
  const { access, roleName } = await resolveTenantAccessWithRoleName(identity.data.user.id, supabase, tenantId)
  if (!access.isAuthorized || !access.context) {
    throw new DataAccessError(access.code!, access.message!)
  }
  if (!roleName || !roleHasPermission(roleName, options.permission ?? 'portfolio:read')) throw new DataAccessError('ROLE_FORBIDDEN', 'El rol no permite esta operacion.')
  const { role: roleId, ...identityContext } = access.context
  const context: DalContext = { ...identityContext, roleId, roleName }
  return { supabase, context }
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
