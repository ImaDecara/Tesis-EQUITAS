import 'server-only'

import { CSV_CONTENT_TYPE } from '@/lib/reports/csv'
import { ReportFilterError, ReportReadError } from '@/lib/reports/report-format'
import { AccessAuditError, recordAccessAudit } from '@/lib/server/audit'
import { DataAccessError, requireTenantAccess, type DalPermission } from '@/lib/server/dal'

// ALIGN-028. Cada Route Handler de reporte pasa por aca: autoriza antes de leer o validar
// filtros, y el CSV se arma entero antes de responder, asi una falla nunca deja un archivo cortado.
// ALIGN-069: se audita despues de armarlo y antes de responder. Sin registro no hay archivo.
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }

export type ReportAccess = Awaited<ReturnType<typeof requireTenantAccess>>

function failure(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: PRIVATE_HEADERS })
}

export async function csvReportResponse(fileName: string, permission: DalPermission, build: (access: ReportAccess) => Promise<string>) {
  try {
    const access = await requireTenantAccess({ permission })
    const csv = await build(access)
    await recordAccessAudit(access.context, { action: 'REPORT_EXPORT', target: fileName })
    return new Response(csv, {
      status: 200,
      headers: { ...PRIVATE_HEADERS, 'Content-Type': CSV_CONTENT_TYPE, 'Content-Disposition': `attachment; filename="equitas-${fileName}.csv"` },
    })
  } catch (error) {
    if (error instanceof DataAccessError) return failure(error.status, { error: error.code })
    if (error instanceof ReportFilterError) return failure(400, { error: 'FILTRO_INVALIDO', filtro: error.param })
    if (error instanceof ReportReadError) return failure(503, { error: 'LECTURA_FALLIDA', tablas: error.tables })
    if (error instanceof AccessAuditError) return failure(503, { error: 'AUDITORIA_NO_DISPONIBLE' })
    // Sin el mensaje: podria traer valores de una fila.
    console.error(`Reporte ${fileName} no disponible: ${error instanceof Error ? error.name : 'desconocido'}`)
    return failure(500, { error: 'REPORTE_NO_DISPONIBLE' })
  }
}
