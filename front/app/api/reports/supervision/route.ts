import { buildSupervisionReport, parseSupervisionFilters } from '@/lib/reports/supervision-report'
import { csvReportResponse } from '@/lib/server/report-response'
import { readPortfolioReference, readReviewLedger } from '@/lib/server/review-report-reader'

export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  return csvReportResponse(request, 'supervision', 'supervision:read', async access => {
    const filters = parseSupervisionFilters(new URL(request.url).searchParams)
    const [ledger, reference] = await Promise.all([readReviewLedger(access), readPortfolioReference()])
    return buildSupervisionReport(ledger, filters, new Date().toISOString(), reference)
  })
}

export const HEAD = GET
