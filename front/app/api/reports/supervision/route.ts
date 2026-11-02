import { buildSupervisionReport, parseSupervisionFilters } from '@/lib/reports/supervision-report'
import { csvReportResponse } from '@/lib/server/report-response'
import { readReviewLedger } from '@/lib/server/review-report-reader'

export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  return csvReportResponse('supervision', 'supervision:read', async access => {
    const filters = parseSupervisionFilters(new URL(request.url).searchParams)
    return buildSupervisionReport(await readReviewLedger(access), filters, new Date().toISOString())
  })
}
