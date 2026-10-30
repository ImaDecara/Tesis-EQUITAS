import type { SupabaseClient } from '@supabase/supabase-js'

export const WEB_ROLES = ['consulta', 'operador', 'supervisor', 'importador'] as const
export type WebRole = (typeof WEB_ROLES)[number]
export const TENANT_COOKIE = 'equitas_tenant_id'

export type AuthValidationErrorCode =
  | 'SUPABASE_NOT_CONFIGURED' | 'AUTH_REQUIRED' | 'AUTH_UNAVAILABLE'
  | 'APP_USER_NOT_FOUND' | 'APP_USER_INACTIVE' | 'TENANT_ACCESS_NOT_FOUND'
  | 'TENANT_ACCESS_INACTIVE' | 'TENANT_SELECTION_REQUIRED' | 'TENANT_INACTIVE'
  | 'ROLE_FORBIDDEN' | 'DATABASE_ERROR'

export type TenantAccessContext = {
  authUserId: string
  appUserId: string
  tenantId: string
  role: WebRole
}
export type TenantAccessValidation = {
  isAuthorized: boolean
  requiresLogin: boolean
  code?: AuthValidationErrorCode
  message?: string
  context?: TenantAccessContext
}

export function denied(code: AuthValidationErrorCode, message: string): TenantAccessValidation {
  return { isAuthorized: false, requiresLogin: code === 'AUTH_REQUIRED', code, message }
}

// No parseInt: "7otro", ceros iniciales y enteros redondeados no identifican un tenant.
export function databaseId(value: unknown): string | null {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null
  const text = typeof value === 'number' || typeof value === 'string' ? String(value) : ''
  return /^[1-9]\d*$/.test(text) ? text : null
}

// Compartido con el navegador para UX. Solo la DAL establece identidad en servidor.
export async function resolveTenantAccess(
  authUserId: string,
  supabase: SupabaseClient | null,
  selectedTenantId?: string,
): Promise<TenantAccessValidation> {
  if (!supabase) return denied('SUPABASE_NOT_CONFIGURED', 'Supabase no esta configurado.')
  try {
    const app = await supabase.from('user').select('id,auth_user,status', { count: 'exact' }).eq('auth_user', authUserId).limit(2)
    if (app.error || !Array.isArray(app.data)) return denied('DATABASE_ERROR', 'No disponible: no se pudo verificar el usuario.')
    const user = app.data[0]
    const appUserId = databaseId(user?.id)
    if ((app.count ?? app.data.length) !== 1 || app.data.length !== 1 || !appUserId || user.auth_user !== authUserId) {
      return denied('APP_USER_NOT_FOUND', 'No se pudo resolver un usuario de aplicacion vinculado a Auth.')
    }
    if (user.status !== 'ACTIVE') return denied('APP_USER_INACTIVE', 'El usuario de aplicacion esta inactivo.')
    if (selectedTenantId !== undefined && !databaseId(selectedTenantId)) {
      return denied('TENANT_ACCESS_NOT_FOUND', 'La seleccion de municipio no es valida.')
    }
    const memberships = (activeOnly: boolean) => {
      let query = supabase.from('tenant_user').select('user,tenant,role,status', { count: 'exact' }).eq('user', appUserId)
      if (activeOnly) query = query.eq('status', true)
      if (selectedTenantId !== undefined) query = query.eq('tenant', selectedTenantId)
      return query.limit(2)
    }
    const active = await memberships(true)
    if (active.error || !Array.isArray(active.data)) return denied('DATABASE_ERROR', 'No disponible: no se pudo verificar la membresia.')
    if (active.data.length === 0) {
      const anyStatus = await memberships(false)
      if (anyStatus.error || !Array.isArray(anyStatus.data)) return denied('DATABASE_ERROR', 'No disponible: no se pudo verificar la membresia.')
      return anyStatus.data.length
        ? denied('TENANT_ACCESS_INACTIVE', 'La membresia del municipio esta inactiva.')
        : denied('TENANT_ACCESS_NOT_FOUND', 'No existe una membresia activa para este municipio.')
    }
    if ((active.count ?? active.data.length) !== 1 || active.data.length !== 1) {
      return denied('TENANT_SELECTION_REQUIRED', 'Selecciona explicitamente un municipio para continuar.')
    }
    const membership = active.data[0]
    const tenantId = databaseId(membership.tenant)
    const roleId = databaseId(membership.role)
    if (membership.status !== true) return denied('TENANT_ACCESS_INACTIVE', 'La membresia del municipio esta inactiva.')
    if (!tenantId || !roleId || databaseId(membership.user) !== appUserId ||
        (selectedTenantId !== undefined && tenantId !== selectedTenantId)) {
      return denied('TENANT_ACCESS_NOT_FOUND', 'No se pudo verificar la membresia seleccionada.')
    }
    const tenant = await supabase.from('tenant').select('id,status').eq('id', tenantId).limit(1)
    if (tenant.error || !Array.isArray(tenant.data)) return denied('DATABASE_ERROR', 'No disponible: no se pudo verificar el municipio.')
    if (databaseId(tenant.data[0]?.id) !== tenantId || tenant.data[0]?.status !== 'ACTIVE') {
      return denied('TENANT_INACTIVE', 'El municipio no esta disponible o esta inactivo.')
    }
    const role = await supabase.from('role').select('id,name').eq('id', roleId).limit(1)
    if (role.error || !Array.isArray(role.data)) return denied('DATABASE_ERROR', 'No disponible: no se pudo verificar el rol.')
    const name = role.data[0]?.name
    if (databaseId(role.data[0]?.id) !== roleId || !WEB_ROLES.includes(name)) {
      return denied('ROLE_FORBIDDEN', 'El rol no tiene acceso a la aplicacion web.')
    }
    return { isAuthorized: true, requiresLogin: false, context: { authUserId, appUserId, tenantId, role: name } }
  } catch {
    return denied('DATABASE_ERROR', 'No disponible: no se pudo verificar el acceso.')
  }
}
