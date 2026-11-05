import { getDebtorsData } from '@/lib/equitas-data'
import { buildQueueReport, parseQueueFilters } from '@/lib/reports/queue-report'
import { assertReadsComplete } from '@/lib/reports/report-format'
import { roleHasPermission } from '@/lib/server/dal'
import { csvReportResponse } from '@/lib/server/report-response'

export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  return csvReportResponse('cola-de-trabajo', 'portfolio:read', async ({ context }) => {
    const filters = parseQueueFilters(new URL(request.url).searchParams)
    const { debtors, warnings, batch } = await getDebtorsData()
    assertReadsComplete(warnings)
    const showIdentifier = roleHasPermission(context.roleName, 'report:object-identifier')
    return buildQueueReport(debtors, filters, new Date().toISOString(), { showIdentifier }, batch)
  })
}
