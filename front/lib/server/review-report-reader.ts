import 'server-only'

import { loadAllTableRows } from '@/lib/data/paginated-table-reader'
import { getDebtorsData } from '@/lib/equitas-data'
import { assertReadsComplete, portfolioReference, type PortfolioReference } from '@/lib/reports/report-format'
import { buildReviewLedger } from '@/lib/reports/review-ledger'
import type { ReportAccess } from '@/lib/server/report-response'
import type { DataWarning } from '@/types/equitas-domain'

// ALIGN-028. Columnas explicitas (contrato §13). `select=*` falla por `reason_text`; quedan
// fuera tambien quien decidio, la explicacion, los insumos y la lista de control.
const CASE_REVIEW_COLUMNS = 'id,debtor,rules_version,as_of,suggested_intervention,suggested_intensity,decision,decided_intervention,decided_intensity,reason_code,reviewer_role,created_at,supersedes'
const APPROVAL_COLUMNS = 'id,case_review,decision,reason_code,approver_role,created_at,supersedes'

export async function readReviewLedger({ supabase, context }: ReportAccess) {
  const filters = [['tenant', context.tenantId]] as const
  const [reviews, approvals] = await Promise.all([
    loadAllTableRows('case_review', supabase, { select: CASE_REVIEW_COLUMNS, filters }),
    loadAllTableRows('case_review_approval', supabase, { select: APPROVAL_COLUMNS, filters }),
  ])
  assertReadsComplete([reviews.warning, approvals.warning].filter((warning): warning is DataWarning => warning !== null))
  return buildReviewLedger(reviews.rows, approvals.rows)
}

// Noche 7. Fecha de la cartera vigente e identificador visible de cada caso, de la MISMA lectura que los
// listados. Solo importan los casos y el lote: sin ellos no se puede afirmar ni la fecha ni el caso.
const REFERENCE_READS = new Set(['debtor', 'import_batch'])

export async function readPortfolioReference(): Promise<PortfolioReference> {
  const { debtors, warnings, batch } = await getDebtorsData()
  assertReadsComplete(warnings.filter(warning => REFERENCE_READS.has(warning.table)))
  return portfolioReference(debtors, batch)
}
