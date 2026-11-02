import { getDebtorsData } from '@/lib/equitas-data'
import { buildQueueReport, parseQueueFilters } from '@/lib/reports/queue-report'
import { assertReadsComplete } from '@/lib/reports/report-format'
import { csvReportResponse } from '@/lib/server/report-response'

export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  return csvReportResponse('cola-de-trabajo', 'portfolio:read', async () => {
    const filters = parseQueueFilters(new URL(request.url).searchParams)
    const { debtors, warnings } = await getDebtorsData()
    assertReadsComplete(warnings)
    return buildQueueReport(debtors, filters, new Date().toISOString())
  })
}
