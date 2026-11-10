import { buildAccessAuditReport, parseAccessAuditFilters } from '@/lib/reports/access-audit-report'
import { readAccessAudit } from '@/lib/server/audit'
import { csvReportResponse } from '@/lib/server/report-response'
import { readPortfolioReference } from '@/lib/server/review-report-reader'

export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  return csvReportResponse(request, 'accesos', 'audit:read', async access => {
    const filters = parseAccessAuditFilters(new URL(request.url).searchParams)
    const [records, reference] = await Promise.all([readAccessAudit(access), readPortfolioReference()])
    return buildAccessAuditReport(records, filters, new Date().toISOString(), reference, { appUserId: access.context.appUserId })
  })
}

export const HEAD = GET
