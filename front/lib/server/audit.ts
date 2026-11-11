import 'server-only'

import { randomUUID } from 'node:crypto'

import { loadAllTableRows } from '@/lib/data/paginated-table-reader'
import type { AccessAuditRow } from '@/lib/reports/access-audit-report'
import { assertReadsComplete } from '@/lib/reports/report-format'
import { createCaseReviewWriter } from '@/lib/server/case-review-writer'
import { requireTenantAccess, type DalContext } from '@/lib/server/dal'
import { loadDatabaseLevel } from '@/lib/server/database-level'
import type { ReportAccess } from '@/lib/server/report-response'
import type { DataWarning } from '@/types/equitas-domain'

// ALIGN-069. Funcion comun de auditoria. Importacion (057), analitica (064) y canal (066)
// usan `recordAccessAudit` con su accion. El actor sale del contexto de la DAL, nunca del navegador.
//
// Falla cerrada: si no se pudo registrar, la accion no se entrega. La ficha cae en `app/error.tsx`
// y el reporte responde 503 sin archivo. Una accion sin rastro es peor que una accion demorada.
export type AccessAuditEvent =
  | { action: 'CASE_OPEN' | 'CHANNEL_LINK'; target: string; idempotencyKey?: string }
  | { action: 'IMPORT_CONFIRM'; target: string; idempotencyKey: string }
  | { action: 'REPORT_EXPORT' | 'ANALYTICS_VIEW'; target: string; idempotencyKey?: string }

// Lista cerrada de acciones que una base SIN el módulo entrega sin registro. No agregar descargas ni escrituras.
const UNAUDITED_WITHOUT_MODULE: ReadonlySet<AccessAuditEvent['action']> = new Set(['CASE_OPEN'])

export class AccessAuditError extends Error {
  constructor() {
    super('No se pudo registrar la auditoria de la accion.')
    this.name = 'AccessAuditError'
  }
}

// Sin clave, cada llamada es una accion nueva: la clave solo la pasa quien puede reintentar la misma.
export async function recordAccessAudit(context: Pick<DalContext, 'appUserId' | 'tenantId'>, event: AccessAuditEvent) {
  // Antes de crear el cliente escritor: BASE nunca intenta un RPC, aun con JWT configurado.
  let level
  try { level = await loadDatabaseLevel() } catch { throw new AccessAuditError() }
  if (level === 'BASE') {
    if (UNAUDITED_WITHOUT_MODULE.has(event.action)) return
    throw new AccessAuditError()
  }
  const writer = createCaseReviewWriter()
  let failure: string | null = writer ? null : 'SIN_CREDENCIAL'
  if (writer) {
    try {
      const { data, error } = await writer.rpc('record_access_audit', {
        p_actor_user: context.appUserId,
        p_tenant: context.tenantId,
        p_action: event.action,
        p_target: event.target,
        p_idempotency_key: event.idempotencyKey ?? randomUUID(),
      })
      if (error) failure = error.code || 'SIN_CODIGO'
      else if (!isAuditResult(data)) failure = 'RESPUESTA_INVALIDA'
    } catch {
      failure = 'SIN_CONEXION'
    }
  }
  if (failure) {
    // Sin el mensaje de la base ni el destino: solo accion y codigo.
    console.error(`Auditoria no registrada: ${event.action} ${failure}`)
    throw new AccessAuditError()
  }
}

function isAuditResult(data: unknown) {
  const row = Array.isArray(data) ? data[0] : data
  return typeof row === 'object' && row !== null && (row as { audit_id?: unknown }).audit_id != null
}

// Apertura de la ficha: se llama despues de `notFound()`, con el objeto ya leido y antes de responder.
export async function auditCaseOpen(debtorId: string) {
  const { context } = await requireTenantAccess()
  await recordAccessAudit(context, { action: 'CASE_OPEN', target: debtorId })
}

// Con la sesion y la politica de supervisor: la credencial de servidor no lee esta tabla.
const ACCESS_AUDIT_COLUMNS = 'id,actor,actor_role,action,target,created_at'

export async function readAccessAudit({ supabase, context }: ReportAccess): Promise<AccessAuditRow[]> {
  const result = await loadAllTableRows('access_audit', supabase, { select: ACCESS_AUDIT_COLUMNS, filters: [['tenant', context.tenantId]] })
  assertReadsComplete([result.warning].filter((warning): warning is DataWarning => warning !== null))
  return result.rows as unknown as AccessAuditRow[]
}
