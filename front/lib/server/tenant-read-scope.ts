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
      return { select: '*', filters: [['tenant', tenantId]] }
    case 'debt':
    case 'debtor_person':
    case 'debtor_profile':
      return { select: `*,${debtor}`, filters: [['__scope.tenant', tenantId]] }
    case 'person':
      return { select: `*,${links}`, filters: [['__links.active', true], ['__links.__debtor.tenant', tenantId]] }
    case 'debtor_contact':
      return { select: `*,${person}`, filters: personFilters }
    case 'debtor_profile_detail':
      return {
        select: `*,__scope:debtor_profile!inner(__debtor:debtor!inner(tenant)),${person}`,
        filters: [['__scope.__debtor.tenant', tenantId], ...personFilters],
      }
    case 'debtor_type':
    case 'debt_status':
      return { select: '*', filters: [] } // Catalogos compartidos, solo tras autorizar.
    default:
      return null
  }
}

// ALIGN-020: los mismos alcances, reducidos a un objeto. No abre tablas ni columnas nuevas.
const DEBTOR_COLUMN = {
  debtor: 'id',
  debt: 'debtor',
  debtor_person: 'debtor',
  person: '__links.debtor',
  debtor_contact: '__person.__links.debtor',
} as const

export type DebtorScopedTable = keyof typeof DEBTOR_COLUMN

export function debtorReadScope(table: DebtorScopedTable, tenantId: string, debtorId: string): TableReadScope {
  const scope = tenantReadScope(table, tenantId)!
  return { select: scope.select, filters: [...scope.filters, [DEBTOR_COLUMN[table], debtorId]] }
}
