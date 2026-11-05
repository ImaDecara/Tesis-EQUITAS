import { getDebtorsData } from '@/lib/equitas-data'
import { buildDataQualityReport, parseDataQualityFilters } from '@/lib/reports/data-quality-report'
import { assertReadsComplete } from '@/lib/reports/report-format'
import { csvReportResponse } from '@/lib/server/report-response'

export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  return csvReportResponse(request, 'calidad-de-datos', 'portfolio:read', async () => {
    parseDataQualityFilters(new URL(request.url).searchParams)
    const { debtors, warnings } = await getDebtorsData()
    assertReadsComplete(warnings)
    return buildDataQualityReport(debtors, new Date().toISOString())
  })
}

export const HEAD = GET
