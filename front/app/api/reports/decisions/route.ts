import { buildDecisionsReport, parseDecisionFilters } from '@/lib/reports/decisions-report'
import { csvReportResponse } from '@/lib/server/report-response'
import { readReviewLedger } from '@/lib/server/review-report-reader'

export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  return csvReportResponse('decisiones', 'decision:read', async access => {
    const filters = parseDecisionFilters(new URL(request.url).searchParams)
    return buildDecisionsReport(await readReviewLedger(access), filters, new Date().toISOString())
  })
}
