import 'server-only'

import { cookies } from 'next/headers'
import { E06_READ_ONLY_COMPAT_ROLE, resolveTenantAccessWithRoleName, TENANT_COOKIE, type AuthValidationErrorCode, type ResolvedRoleName, type TenantAccessContext } from '@/lib/auth/tenant-access'
import { isAuthServiceUnavailable } from '@/lib/auth/session-routing'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { loadAllTableRows } from '@/lib/data/paginated-table-reader'
import { debtorReadScope, isDebtorScoped, tenantReadScope, type PortfolioTable } from '@/lib/server/tenant-read-scope'

// UNICO lugar de esta capa donde se decide que permite cada rol (noche 7, seccion 4.2 del encargo).
// Cambiar una fila es cambiar una linea de esta tabla; la base tiene su equivalente en
// `public.equitas_role_allows` y la API de Python en `back/api/auth.py::PERMISSIONS`.
//
// Lo que main ya ofrece (leer la cartera del propio municipio) lo usa cualquier miembro activo:
// ADMIN y USER leen lo mismo. La compatibilidad E06 solo lee cartera y no aparece en otra fila.
// Lo que main no tiene y escribe o supervisa requiere ADMIN. `importador_sistema` es una
// identidad de maquina del cargador por terminal y no entra por la web.
// ALIGN-021: la misma tabla gobierna la pantalla y la autorizacion de las acciones.
const PERMISSIONS = {
  'portfolio:read': ['ADMIN', 'USER', E06_READ_ONLY_COMPAT_ROLE],
  // Ver la decision registrada de un caso y su estado, sin texto libre ni identidades.
  // La politica de `case_review` admite a todo miembro activo.
  'review:read': ['ADMIN', 'USER'],
  'decision:read': ['ADMIN', 'USER'],
  // Exportar lo que ya se ve en pantalla no amplia el acceso: el identificador del objeto esta
  // en los listados que lee cualquier miembro activo.
  'report:object-identifier': ['ADMIN', 'USER'],
  'decision:record': ['ADMIN'],
  'decision:approve': ['ADMIN'],
  // Reportes que muestran la actividad de otras personas.
  'supervision:read': ['ADMIN'],
  // ALIGN-069: reporte de accesos. La politica de `access_audit` exige lo mismo.
  'audit:read': ['ADMIN'],
  // Cargar CSV cambia la cartera de todo el municipio.
  'import:write': ['ADMIN'],
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
  if (!supabase) throw new DataAccessError('SUPABASE_NOT_CONFIGURED', 'No disponible: el servicio de datos no está configurado.')
  let identity
  try {
    identity = await supabase.auth.getUser()
  } catch {
    throw new DataAccessError('AUTH_UNAVAILABLE', 'No disponible: no se pudo verificar la sesión.')
  }
  if (isAuthServiceUnavailable(identity.error)) throw new DataAccessError('AUTH_UNAVAILABLE', 'No disponible: no se pudo verificar la sesión.')
  if (identity.error || !identity.data.user) throw new DataAccessError('AUTH_REQUIRED', 'Tenés que iniciar sesión para continuar.')
  const tenantId = options.tenantId ?? cookieStore.get(TENANT_COOKIE)?.value
  const { access, roleName } = await resolveTenantAccessWithRoleName(identity.data.user.id, supabase, tenantId)
  if (!access.isAuthorized || !access.context) {
    throw new DataAccessError(access.code!, access.message!)
  }
  if (!roleName || !roleHasPermission(roleName, options.permission ?? 'portfolio:read')) throw new DataAccessError('ROLE_FORBIDDEN', 'Tu cuenta no tiene permiso para esta función.')
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
    // Metadatos mínimos del corte, con la misma sesión y municipio que la cartera.
    // No amplía readTable ni los permisos del contexto.
    async readImportBatches() {
      const result = await loadAllTableRows('import_batch', supabase, {
        select: 'id,as_of,source_updated_at,status,supersedes,publicacion_atomica:counts->publicacion_atomica', filters: [['tenant', context.tenantId]],
      })
      // Solo la marca JSON protegida de 032, sin el resto de los conteos del lote.
      return { ...result, rows: result.rows.map(({ publicacion_atomica, ...row }) => ({ ...row, counts: { publicacion_atomica } })) }
    },
    // Con `debtorId`, la misma lectura reducida a un caso (noche 7, rendimiento): no abre tablas ni columnas
    // nuevas. Ese identificador tiene que salir de una fila ya leída del municipio, nunca directo de la URL.
    async readTable(table: PortfolioTable, debtorId?: string) {
      const scope = debtorId !== undefined && isDebtorScoped(table)
        ? debtorReadScope(table, context.tenantId, debtorId) : tenantReadScope(table, context.tenantId)
      if (!scope) throw new DataAccessError('TABLE_FORBIDDEN', 'Esa lectura no está habilitada.')
      return loadAllTableRows(table, supabase, scope)
    },
  }
}
