// Adaptador CLI: sesión del login ya validado; comparte autorización, alcances y lector paginado.
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveTenantAccessWithRoleName } from '@/lib/auth/tenant-access'
import { tenantReadScope, type PortfolioTable } from '@/lib/server/tenant-read-scope'
import { loadAllTableRows } from '@/lib/data/paginated-table-reader'
const state = () => (globalThis as unknown as { equitasAnalytics: { client: SupabaseClient; authUserId: string; tenantId?: string } }).equitasAnalytics
export async function createServerSupabaseClient() { return state().client }
export async function createTenantReader() {
  const { client, authUserId, tenantId } = state()
  const { access, roleName } = await resolveTenantAccessWithRoleName(authUserId, client, tenantId)
  if (!access.isAuthorized || !access.context || !['ADMIN', 'USER'].includes(roleName ?? '')) throw new Error('Acceso municipal no autorizado')
  const context = access.context
  return {
    context,
    async readImportBatches() {
      const result = await loadAllTableRows('import_batch', client, { select: 'id,as_of,source_updated_at,status,supersedes,publicacion_atomica:counts->publicacion_atomica', filters: [['tenant', context.tenantId]] })
      return { ...result, rows: result.rows.map(({ publicacion_atomica, ...row }) => ({ ...row, counts: { publicacion_atomica } })) }
    },
    async readTable(table: PortfolioTable) {
      const scope = tenantReadScope(table, context.tenantId)
      if (!scope) throw new Error('Tabla no autorizada')
      return loadAllTableRows(table, client, scope)
    },
  }
}
