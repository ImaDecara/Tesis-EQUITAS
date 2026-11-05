import { buildAccessAuditReport, parseAccessAuditFilters } from '@/lib/reports/access-audit-report'
import { readAccessAudit } from '@/lib/server/audit'
import { csvReportResponse } from '@/lib/server/report-response'

export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  return csvReportResponse(request, 'accesos', 'audit:read', async access => {
    const filters = parseAccessAuditFilters(new URL(request.url).searchParams)
    return buildAccessAuditReport(await readAccessAudit(access), filters, new Date().toISOString())
  })
}

export const HEAD = GET
