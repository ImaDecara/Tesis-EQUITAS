import { describe, expect, it } from 'vitest'

import smallCases from '../../../contracts/portfolio-small-cases.v1.json'
import { mapDashboardMetricsFromDebtorObjects } from '@/lib/mappers/dashboard-metrics-mapper'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { buildAccessAuditReport } from '@/lib/reports/access-audit-report'
import { buildDataQualityReport } from '@/lib/reports/data-quality-report'
import { buildDecisionsReport } from '@/lib/reports/decisions-report'
import { buildQueueReport, filterQueueCases, parseQueueFilters } from '@/lib/reports/queue-report'
import { HISTORICAL_ROLES, NOT_CATALOGUED, exportableRole } from '@/lib/reports/report-codes'
import { PORTFOLIO_TOTALS, REPORT_DEFINITIONS, RESTRICTED_REASON } from '@/lib/reports/report-definitions'
import { portfolioReference, ReportFilterError, ReportSelectionError, sourceIdentifier, UNKNOWN_PORTFOLIO } from '@/lib/reports/report-format'
import { actionText, approvalText, auditActionText, decisionText, reasonText, roleText } from '@/lib/reports/report-labels'
import { buildReviewLedger } from '@/lib/reports/review-ledger'
import { buildSupervisionReport } from '@/lib/reports/supervision-report'
import { smallCasesBundle } from '@/tests/fixtures/reports-portfolio'
import { csvCents, parseCsvBytes } from '@/tests/helpers/independent-csv-parser'

// Noche 7: columnas nuevas, rótulos de pantalla, roles históricos, datos anteriores, selección
// incompleta y totales iguales a los del tablero (casos chicos calculados a mano).
const NOW = '2026-11-10T12:00:00.000Z'
const parse = (csv: string) => parseCsvBytes(new TextEncoder().encode(csv))
const details = (rows: Record<string, string>[]) => rows.filter(row => row.tipo_fila === 'DETALLE')
const total = (rows: Record<string, string>[]) => rows.find(row => row.tipo_fila === 'TOTAL')!

const raw = smallCasesBundle()
const mapped = mapDebtorObjectsFromRawData(raw, { computedAt: NOW })
const reference = portfolioReference(mapped.debtors, raw.batch)

describe('el reporte de cola coincide con el tablero (casos chicos)', () => {
  const file = parse(buildQueueReport(mapped.debtors, {}, NOW, { showIdentifier: true }, raw.batch))
  const dashboard = mapDashboardMetricsFromDebtorObjects(mapped)
  const board = smallCases.tablero

  it('cantidad de casos y los tres totales: los del tablero y los de la tabla calculada a mano', () => {
    const row = total(file.rows)
    expect(Number(row.objetos)).toBe(dashboard.totalDebtors)
    expect(Number(row.objetos)).toBe(smallCases.casos.length)
    expect(csvCents(row.deuda_total_ars)).toBe(Math.round(dashboard.totalDebt! * 100))
    expect(csvCents(row.deuda_pendiente_ars)).toBe(Math.round(dashboard.pendingDebt! * 100))
    expect(csvCents(row.deuda_vencida_ars)).toBe(Math.round(dashboard.overdueDebt! * 100))
    expect(csvCents(row.deuda_total_ars)).toBe(board.total_registrado.valor * 100)
    expect(csvCents(row.deuda_pendiente_ars)).toBe(board.deuda_pendiente.valor * 100)
    expect(csvCents(row.deuda_vencida_ars)).toBe(board.deuda_vencida.valor * 100)
  })

  it.each(smallCases.casos)('$id: la deuda pendiente de la fila es la de la tabla', item => {
    const row = details(file.rows).find(entry => entry.objeto_id === String(item.objeto.id))!
    const expected = item.esperado.deuda_pendiente.valor
    expect(row.deuda_pendiente_ars === 'NO_INTEGRADO' ? null : csvCents(row.deuda_pendiente_ars)).toBe(expected === null ? null : expected * 100)
  })

  it('la fecha de la cartera y la version de reglas vigentes van en todas las filas', () => {
    expect(file.rows.every(row => row.fecha_cartera === smallCases.fecha_cartera && row.version_reglas_vigente === '1.1.0')).toBe(true)
    const quality = parse(buildDataQualityReport(mapped.debtors, NOW, raw.batch)).rows
    expect(quality.every(row => row.fecha_cartera === smallCases.fecha_cartera)).toBe(true)
    expect(quality.filter(row => row.indicador === 'presencia_deuda_pendiente').reduce((sum, row) => sum + Number(row.valor), 0)).toBe(smallCases.casos.length)
  })
})

describe('H16: seleccion incompleta', () => {
  const debtors = mapped.debtors
  // Un caso sin puntaje (lectura de obligaciones con un vencimiento faltante deja la banda sin calcular).
  const withoutRisk = [...debtors, { ...debtors[0], id: '999', identifier: 'SINT-SIN-PUNTAJE', risk: null, decision: null }]

  it('vacia con casos sin el dato del filtro: error explicito, no un archivo de cero filas', () => {
    const empty = withoutRisk.filter(item => item.risk !== 'ALTO')
    expect(() => filterQueueCases(empty, { risk: 'ALTO' })).toThrow(ReportSelectionError)
    expect(() => buildQueueReport(empty, { risk: 'ALTO' }, NOW)).toThrow(ReportSelectionError)
  })

  it('vacia sin casos desconocidos: archivo valido con total 0; con coincidencias, las mismas filas en el mismo orden', () => {
    const known = debtors.filter(item => item.risk !== null && item.risk !== 'ALTO')
    expect(total(parse(buildQueueReport(known, { risk: 'ALTO' }, NOW)).rows).objetos).toBe('0')
    const medium = filterQueueCases(withoutRisk, { risk: 'MEDIO' })
    expect(medium.length).toBeGreaterThan(0)
    expect(medium.every(item => item.risk === 'MEDIO')).toBe(true)
  })

  it('un monto minimo negativo es un filtro invalido, como en la pantalla', () => {
    expect(() => parseQueueFilters(new URLSearchParams('minAmount=-1'))).toThrow(ReportFilterError)
    expect(parseQueueFilters(new URLSearchParams('minAmount=0'))).toEqual({ minAmount: '0' })
  })
})

describe('roles historicos y rotulos de pantalla', () => {
  it.each(HISTORICAL_ROLES)('%s se exporta con su nombre y la marca de rol anterior', role => {
    expect(exportableRole(role)).toBe(role)
    // `tp_operator` no es histórico: es una compatibilidad vigente de solo lectura y lleva su propio rótulo.
    expect(roleText(role)).toBe(role === 'tp_operator' ? 'Cuenta de prueba de solo lectura' : `${role} (rol anterior)`)
  })

  it('ADMIN y USER con su rotulo; un rol fuera de lista no se copia', () => {
    expect(roleText('ADMIN')).toBe('Administrador')
    expect(roleText('USER')).toBe('Usuario')
    expect(exportableRole('SILVIA_PAZ')).toBe(NOT_CATALOGUED)
    expect(roleText(NOT_CATALOGUED)).toBe('Rol no catalogado')
    expect(roleText('NO_INTEGRADO')).toBe('No informado')
  })

  it('decisiones, motivos, acciones, aprobaciones y acciones del registro', () => {
    expect(decisionText('MODIFICA')).toBe('Acción modificada')
    expect(decisionText(NOT_CATALOGUED)).toBe('Código no catalogado')
    expect(reasonText(null)).toBe('Sin motivo')
    expect(reasonText('DATOS_INCOMPLETOS')).toBe('Datos del caso incompletos o incorrectos')
    expect(reasonText(NOT_CATALOGUED)).toBe('Código no catalogado')
    expect(actionText('RECORDATORIO_INFORMATIVO', 1)).toBe('Recordatorio (intensidad 1)')
    expect(actionText(null, null)).toBe('Sin acción decidida')
    expect(actionText(NOT_CATALOGUED, 3)).toBe('Código no catalogado')
    expect(actionText('NO_INTEGRADO', null)).toBe('No informado')
    expect(approvalText('APRUEBA')).toBe('Propuesta aprobada')
    expect(approvalText('REEMPLAZADA')).toContain('reemplazada')
    expect(auditActionText('IMPORT_CONFIRM')).toBe('Confirmación de carga solicitada')
    expect(auditActionText('OTRA')).toBe('Código no catalogado')
  })
})

describe('decisiones y accesos identifican el caso', () => {
  const caseId = String(smallCases.casos[0].objeto.id)
  const review = (id: number, overrides: Record<string, unknown> = {}) => ({
    id, debtor: caseId, rules_version: '1.1.0', as_of: smallCases.fecha_cartera, suggested_intervention: 'SEGUIMIENTO', suggested_intensity: 0,
    decision: 'APRUEBA', decided_intervention: 'SEGUIMIENTO', decided_intensity: 0, reason_code: null, reviewer_role: 'consulta',
    created_at: '2026-10-01T10:00:00Z', supersedes: null, ...overrides,
  })

  it('identificador, rol historico y datos anteriores con la regla de la ficha', () => {
    const ledger = buildReviewLedger([review(1, { decision: 'ACEPTA' }), review(2, { decision: 'ACEPTA', as_of: '2026-08-31' }), review(3, { debtor: '1' })], [])
    const rows = details(parse(buildDecisionsReport(ledger, {}, NOW, reference)).rows)
    expect(rows[0]).toMatchObject({ identificador: smallCases.casos[0].objeto.identificador, rol: 'consulta', rol_rotulo: 'consulta (rol anterior)', datos_anteriores: 'NO' })
    expect(rows[1].datos_anteriores).toBe('SI')
    // Una decision fuera de la lista no se copia ni se rotula; un caso fuera de la cartera se declara.
    expect(rows[2]).toMatchObject({ decision: NOT_CATALOGUED, decision_rotulo: 'Código no catalogado', identificador: 'NO_EN_CARTERA_VIGENTE' })
  })

  it('sin la cartera leida no se afirma que una decision este al dia', () => {
    const rows = parse(buildDecisionsReport(buildReviewLedger([review(1, { decision: 'ACEPTA' })], []), {}, NOW)).rows
    expect(rows.every(row => row.fecha_cartera === UNKNOWN_PORTFOLIO.fechaCartera)).toBe(true)
    expect(details(rows)[0].datos_anteriores).toBe('SI')
    expect(parse(buildSupervisionReport([], {}, NOW, reference)).rows.every(row => row.fecha_cartera === smallCases.fecha_cartera)).toBe(true)
  })

  it('accesos: sin quien descarga, «quien» no se afirma', () => {
    const record = { id: 1, actor: 2, actor_role: 'USER', action: 'CHANNEL_LINK', target: caseId, created_at: '2026-11-02T10:00:00Z' }
    const [row] = details(parse(buildAccessAuditReport([record], {}, NOW, reference)).rows)
    expect(row).toMatchObject({ quien: 'NO_INTEGRADO', identificador: smallCases.casos[0].objeto.identificador, rol_actor_rotulo: 'Usuario' })
    const [mine] = details(parse(buildAccessAuditReport([record], {}, NOW, reference, { appUserId: '2' })).rows)
    expect(mine.quien).toBe('PROPIO')
  })

  it('el identificador de respaldo de la pantalla se declara como no informado', () => {
    expect(sourceIdentifier({ id: '5', identifier: 'OBJ-5' })).toBe('NO_INFORMADO_EN_ORIGEN')
    expect(sourceIdentifier({ id: '5', identifier: 'A-5' })).toBe('A-5')
  })
})

describe('definiciones declaradas', () => {
  it('los cinco reportes dicen que es una fila y como se define cada total', () => {
    expect(Object.keys(REPORT_DEFINITIONS).sort()).toEqual(['access', 'data-quality', 'decisions', 'queue', 'supervision'])
    for (const definition of Object.values(REPORT_DEFINITIONS)) {
      expect(definition.row.length).toBeGreaterThan(40)
      expect(definition.totals.length).toBeGreaterThan(0)
    }
    expect(REPORT_DEFINITIONS.access.totals.map(item => item.term)).toContain('Confirmación de carga solicitada')
    expect(RESTRICTED_REASON).toBe('Muestra la actividad de otras personas: requiere una cuenta ADMIN.')
  })

  it('las tres definiciones de importes del plan §9.3', () => {
    expect(PORTFOLIO_TOTALS.map(item => item.term)).toEqual(['Total registrado', 'Deuda pendiente', 'Deuda vencida'])
    expect(PORTFOLIO_TOTALS[2].text).toContain('vencimiento anterior a la fecha de la cartera')
  })
})
