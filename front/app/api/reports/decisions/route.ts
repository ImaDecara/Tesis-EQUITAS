import { buildDecisionsReport, parseDecisionFilters } from '@/lib/reports/decisions-report'
import { csvReportResponse } from '@/lib/server/report-response'
import { readPortfolioReference, readReviewLedger } from '@/lib/server/review-report-reader'

export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  return csvReportResponse(request, 'decisiones', 'decision:read', async access => {
    const filters = parseDecisionFilters(new URL(request.url).searchParams)
    const [ledger, reference] = await Promise.all([readReviewLedger(access), readPortfolioReference()])
    return buildDecisionsReport(ledger, filters, new Date().toISOString(), reference)
  })
}

export const HEAD = GET
