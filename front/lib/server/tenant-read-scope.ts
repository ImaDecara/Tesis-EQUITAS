import 'server-only'

import { EQUITAS_TABLE_NAMES } from '@/lib/data/table-names'
import type { TableReadScope } from '@/lib/data/paginated-table-reader'

export type PortfolioTable = (typeof EQUITAS_TABLE_NAMES)[keyof typeof EQUITAS_TABLE_NAMES]

// Los alias conservan las FK escalares que consumen los mapeadores. !inner hace
// que el filtro limite las filas raiz en PostgREST, antes de devolverlas a Next.
export function tenantReadScope(table: PortfolioTable, tenantId: string): TableReadScope | null {
  const debtor = '__scope:debtor!inner(tenant)'
  const links = '__links:debtor_person!inner(active,__debtor:debtor!inner(tenant))'
  const person = `__person:person!inner(${links})`
  const personFilters: TableReadScope['filters'] = [
    ['__person.__links.active', true], ['__person.__links.__debtor.tenant', tenantId],
  ]
  switch (table) {
    case 'debtor':
      return { select: 'id,tenant,external_id,type,identifier,description,status', filters: [['tenant', tenantId]] }
    case 'debt':
      return { select: `id,external_id,debtor,type,description,original_amount::text,current_amount::text,updated_amount::text,currency,issue_date,due_date,last_collection_date,period,status,${debtor}`, filters: [['__scope.tenant', tenantId]] }
    case 'debtor_person':
      return { select: `id,debtor,person,priority,role,active,${debtor}`, filters: [['__scope.tenant', tenantId]] }
    case 'debtor_profile':
      return { select: `id,debtor,total_debt_amount::text,overdue_debt_amount::text,profile_generated_at,${debtor}`, filters: [['__scope.tenant', tenantId]] }
    case 'person':
      return { select: `id,external_id,document_type,document_number,full_name,type,status,${links}`, filters: [['__links.active', true], ['__links.__debtor.tenant', tenantId]] }
    case 'debtor_contact':
      return { select: `id,person,type,value,active,${person}`, filters: personFilters }
    case 'debtor_profile_detail':
      return {
        select: `id,debtor_profile,person,risk_value,active,__scope:debtor_profile!inner(__debtor:debtor!inner(tenant)),${person}`,
        filters: [['__scope.__debtor.tenant', tenantId], ...personFilters],
      }
    // Catalogos compartidos, solo tras autorizar.
    case 'debtor_type':
      return { select: 'id,key,value', filters: [] }
    case 'debt_status':
      // `description` es el rótulo de respaldo del mapeador cuando `value` viene vacío; la base original la tiene.
      return { select: 'id,key,value,description', filters: [] }
    default:
      return null
  }
}

// ALIGN-020: los mismos alcances, reducidos a un objeto. No abre tablas ni columnas nuevas.
const DEBTOR_COLUMN = {
  debtor: 'id',
  debt: 'debtor',
  debtor_person: 'debtor',
  debtor_profile: 'debtor',
  person: '__links.debtor',
  debtor_contact: '__person.__links.debtor',
} as const

export type DebtorScopedTable = keyof typeof DEBTOR_COLUMN
export const isDebtorScoped = (table: string): table is DebtorScopedTable => Object.hasOwn(DEBTOR_COLUMN, table)

// debtorId debe venir de una fila comprobada dentro del municipio. Validar solo
// la forma de un ID de formulario no lo habilita como filtro: la URL se registra.
export function debtorReadScope(table: DebtorScopedTable, tenantId: string, debtorId: string): TableReadScope {
  const scope = tenantReadScope(table, tenantId)!
  return { select: scope.select, filters: [...scope.filters, [DEBTOR_COLUMN[table], debtorId]] }
}
