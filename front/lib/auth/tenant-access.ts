import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAllTableRows } from '@/lib/data/paginated-table-reader'

export const WEB_ROLES = ['consulta', 'operador', 'supervisor', 'importador'] as const
export type WebRole = (typeof WEB_ROLES)[number]

// COMPATIBILIDAD CON LA CAMPANA E06: NO es un rol aprobado por ALIGN-003 ni un rol
// del producto. `database/testing/fixtures.sql` lo asigna a las cuentas sinteticas
// del proyecto de pruebas, y el plan prohibe tocar esa fixture y SMOKE-01. Da solo
// lectura de cartera, igual que `consulta`, y ninguna otra capacidad (`lib/server/dal.ts`).
// Sin interruptor por entorno. Se retira con su fixture: ver ADR-001, seccion 9.
export const E06_READ_ONLY_COMPAT_ROLE = 'tp_operator'
export type ResolvedRoleName = WebRole | typeof E06_READ_ONLY_COMPAT_ROLE

function isResolvedRoleName(name: unknown): name is ResolvedRoleName {
  return name === E06_READ_ONLY_COMPAT_ROLE || (WEB_ROLES as readonly unknown[]).includes(name)
}

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
  // ID de `role` en texto, contrato de SUP-AUTH-01. No es el nombre y no decide
  // permisos: las capacidades se resuelven por nombre solo en la DAL.
  role: string
}
export type TenantChoice = { id: string; name: string }
export type TenantAccessValidation = {
  isAuthorized: boolean
  requiresLogin: boolean
  code?: AuthValidationErrorCode
  message?: string
  context?: TenantAccessContext
  tenantChoices?: TenantChoice[]
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
  return (await resolveTenantAccessWithRoleName(authUserId, supabase, selectedTenantId)).access
}

// Para la DAL: el nombre viaja aparte, de la misma lectura de `role`, y nunca en
// `access.context`. Un ID de rol no puede confundirse con un nombre ni otorgar permisos.
export type TenantAccessWithRoleName = { access: TenantAccessValidation; roleName: ResolvedRoleName | null }

export async function resolveTenantAccessWithRoleName(
  authUserId: string,
  supabase: SupabaseClient | null,
  selectedTenantId?: string,
): Promise<TenantAccessWithRoleName> {
  const { roleName, ...access } = await checkTenantAccess(authUserId, supabase, selectedTenantId)
  return { access, roleName: roleName ?? null }
}

async function checkTenantAccess(
  authUserId: string,
  supabase: SupabaseClient | null,
  selectedTenantId?: string,
): Promise<TenantAccessValidation & { roleName?: ResolvedRoleName }> {
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
      return query.limit(2)
    }
    // La cookie puede contener cualquier numero, incluso un dato personal. Validar
    // su forma no permite enviarlo a PostgREST: su URL queda en los logs de Kong.
    // Solo filtramos por el usuario resuelto; la seleccion se compara en memoria
    // despues de leer todas sus membresias, incluidas las inactivas, hasta pagina vacia.
    const selectedMemberships = selectedTenantId === undefined ? null : await loadAllTableRows('tenant_user', supabase, {
      select: 'id,user,tenant,role,status', filters: [['user', appUserId]],
    })
    if (selectedMemberships?.warning) return denied('DATABASE_ERROR', 'No disponible: no se pudo verificar la membresia.')
    const matching = selectedMemberships?.rows.filter(row => databaseId(row.tenant) === selectedTenantId)
    const selectedActive = matching?.filter(row => row.status === true)
    const active = selectedActive
      ? { data: selectedActive, count: selectedActive.length, error: null }
      : await memberships(true)
    if (active.error || !Array.isArray(active.data)) return denied('DATABASE_ERROR', 'No disponible: no se pudo verificar la membresia.')
    if (active.data.length === 0) {
      const anyStatus = matching ? { data: matching, error: null } : await memberships(false)
      if (anyStatus.error || !Array.isArray(anyStatus.data)) return denied('DATABASE_ERROR', 'No disponible: no se pudo verificar la membresia.')
      return anyStatus.data.length
        ? denied('TENANT_ACCESS_INACTIVE', 'La membresia del municipio esta inactiva.')
        : denied('TENANT_ACCESS_NOT_FOUND', 'No existe una membresia activa para este municipio.')
    }
    if ((active.count ?? active.data.length) !== 1 || active.data.length !== 1) {
      const choices = await loadAllTableRows('tenant_user', supabase, {
        select: 'id,tenant,selection:tenant(name)', filters: [['user', appUserId], ['status', true]],
      })
      if (choices.warning) return denied('DATABASE_ERROR', 'No disponible: no se pudieron leer los municipios.')
      const tenantChoices = choices.rows.flatMap(row => {
        const id = databaseId(row.tenant)
        const selection = row.selection as { name?: unknown } | null
        return id ? [{ id, name: typeof selection?.name === 'string' ? selection.name : `Municipio ${id}` }] : []
      })
      return { ...denied('TENANT_SELECTION_REQUIRED', 'Selecciona explicitamente un municipio para continuar.'), tenantChoices }
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
    const name: unknown = role.data[0]?.name
    if (databaseId(role.data[0]?.id) !== roleId || !isResolvedRoleName(name)) {
      return denied('ROLE_FORBIDDEN', 'El rol no tiene acceso a la aplicacion web.')
    }
    return { isAuthorized: true, requiresLogin: false, context: { authUserId, appUserId, tenantId, role: roleId }, roleName: name }
  } catch {
    return denied('DATABASE_ERROR', 'No disponible: no se pudo verificar el acceso.')
  }
}
