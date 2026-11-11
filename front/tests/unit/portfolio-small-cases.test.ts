import { describe, expect, it } from 'vitest'
import smallCases from '../../../contracts/portfolio-small-cases.v1.json'
import { maturityMetrics, withMaturityMetrics } from '@/lib/analytics'
import { RULES_VERSION, type DecisionObligation } from '@/lib/domain/decision-rules-v1'
import { objectTotals } from '@/lib/domain/portfolio-totals'
import { buildDebtAgingSummary, buildQueueReconciliation, buildRecommendationSummary } from '@/lib/equitas-view-selectors'
import { mapDashboardMetricsFromDebtorObjects } from '@/lib/mappers/dashboard-metrics-mapper'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { buildDataQualityReport } from '@/lib/reports/data-quality-report'
import { buildQueueReport } from '@/lib/reports/queue-report'
import { csvCents, parseCsvBytes } from '@/tests/helpers/independent-csv-parser'
import type { NumericData, RawDebtorDataBundle } from '@/types/equitas-domain'

// Casos chicos del plan de entrega §9.5, calculados a mano en contracts/portfolio-small-cases.v1.json.
// Cada consumidor recibe las mismas filas crudas y debe dar los MISMOS números que la tabla.
const NOW = '2026-11-10T12:00:00.000Z'
type SmallCase = (typeof smallCases.casos)[number]
type Expected = { valor: number | null; faltantes: number }

function smallRaw(): RawDebtorDataBundle {
  const cases = smallCases.casos
  return {
    batch: { as_of: smallCases.fecha_cartera },
    debtors: cases.map(item => ({ id: item.objeto.id, identifier: item.objeto.identificador, type: 1 })),
    debtorTypes: [{ id: 1, value: 'Objeto sintético' }],
    debts: cases.flatMap(item => item.obligaciones.map(debt => ({
      id: debt.id, debtor: item.objeto.id, current_amount: debt.importe, due_date: debt.vencimiento, status: debt.estado_id,
    }))),
    debtStatuses: smallCases.catalogo_debt_status,
    debtorPeople: cases.flatMap(item => item.titulares.map(holder => ({
      id: holder.id, debtor: item.objeto.id, person: holder.id, priority: holder.porcentaje, active: true,
    }))),
    people: cases.flatMap(item => item.titulares.map(holder => ({ id: holder.id, full_name: `Titular sintético ${holder.id}`, type: 'FISICA' }))),
    debtorContacts: cases.flatMap(item => item.titulares.flatMap(holder => holder.contactos.map(contact => ({
      id: contact.id, person: holder.id, type: 1, value: contact.valor, active: true,
    })))),
    debtorProfiles: [],
    warnings: [],
  }
}

type SmallDebt = { id: number; importe: number | null; vencimiento: string | null; estado_id: number | null }
const allDebts = (smallCases.casos as { obligaciones: SmallDebt[] }[]).flatMap(item => item.obligaciones)
const missingCount = (data: NumericData) => Object.values(data.missing).reduce((sum, count) => sum + (count ?? 0), 0)
const asExpected = (data: NumericData): Expected => ({ valor: data.value, faltantes: missingCount(data) })
const mapped = mapDebtorObjectsFromRawData(smallRaw(), { computedAt: NOW })
const byCase = (item: SmallCase) => mapped.debtors.find(debtor => debtor.id === String(item.objeto.id))!

describe('casos chicos en el mapeo de objetos (ficha y listados)', () => {
  it.each(smallCases.casos)('$id ($nombre)', item => {
    const expected = item.esperado
    const debtor = byCase(item)
    expect(asExpected(debtor.metrics!.totalDebt)).toEqual(expected.total_registrado)
    expect(asExpected(debtor.metrics!.pendingDebt)).toEqual(expected.deuda_pendiente)
    expect(asExpected(debtor.metrics!.overdueDebt)).toEqual(expected.deuda_vencida)
    expect(debtor).toMatchObject({
      totalDebt: expected.total_registrado.valor, pendingDebt: expected.deuda_pendiente.valor, overdueDebt: expected.deuda_vencida.valor,
      overdueDebtsCount: expected.obligaciones_vencidas, maxDaysOverdue: expected.atraso_maximo_dias.valor,
      priorityScore: expected.puntaje, priorityLevel: expected.banda, recommendationType: expected.grupo, rulesVersion: RULES_VERSION,
    })
    const days = debtor.metrics!.maxDaysOverdue
    if (expected.atraso_maximo_dias.estado === 'NO_APLICA') expect(days.presence).toBe('NO_APLICA')
    if (expected.atraso_maximo_dias.estado === 'NO_DISPONIBLE') expect(days).toMatchObject({ value: null, presence: expect.not.stringMatching(/^(NO_APLICA|OBSERVADO)$/) })
    expect(debtor.decision?.severidad).toMatchObject({
      valor: expected.puntaje, banda: expected.banda, estado: expected.estado_severidad, monto_actualizado_ars: expected.monto_evaluable,
      obligaciones_pagadas: expected.obligaciones_pagadas, obligaciones_no_evaluables: expected.obligaciones_no_evaluables,
    })
    expect(debtor.decision?.intervencion).toMatchObject({ codigo: expected.intervencion, regla: expected.regla, intensidad: expected.intensidad })
    // La mora de las vistas es la misma que la de las reglas.
    expect(debtor.maxDaysOverdue).toBe(debtor.decision!.severidad.dias_atraso_maximo)
    expect(debtor.overdueDebtsCount).toBe(debtor.decision!.severidad.cantidad_vencidas)
  })

  it('el rótulo de estado se conserva para el desglose informativo y no decide la mora (CHICO-03)', () => {
    const item = smallCases.casos.find(entry => entry.id === 'CHICO-03')!
    expect(mapped.debtsByDebtor.get(String(item.objeto.id))?.map(debt => debt.status)).toEqual(['Vencida'])
    expect(byCase(item)).toMatchObject({ overdueDebt: 0, overdueDebtsCount: 0 })
  })

  it('el objeto con dos titulares suma sus obligaciones una sola vez (CHICO-07)', () => {
    const item = smallCases.casos.find(entry => entry.id === 'CHICO-07')!
    expect(byCase(item)).toMatchObject({ peopleCount: 2, contactCount: 2, totalDebt: 280000 })
  })
})

describe('casos chicos en analytics.ts', () => {
  it.each(smallCases.casos)('$id: maturityMetrics da la misma deuda vencida, atraso y caso vencido', item => {
    const expected = item.esperado
    const metrics = maturityMetrics(byCase(item))
    expect(asExpected(metrics.overdueDebt)).toEqual(expected.deuda_vencida)
    expect(metrics.maxDaysOverdue.value).toBe(expected.atraso_maximo_dias.valor)
    expect(metrics.overdueCases.value).toBe(expected.obligaciones_vencidas > 0 ? 1 : 0)
    expect(withMaturityMetrics(byCase(item))).toMatchObject({ overdueDebt: expected.deuda_vencida.valor, maxDaysOverdue: expected.atraso_maximo_dias.valor })
  })
})

describe('casos chicos en el tablero y los listados agregados', () => {
  const dashboard = mapDashboardMetricsFromDebtorObjects(mapped)
  const board = smallCases.tablero

  it('los tres totales y los casos vencidos coinciden con la tabla', () => {
    expect(asExpected(dashboard.metrics!.totalDebt)).toEqual(board.total_registrado)
    expect(asExpected(dashboard.metrics!.pendingDebt)).toEqual(board.deuda_pendiente)
    expect(asExpected(dashboard.metrics!.overdueDebt)).toEqual(board.deuda_vencida)
    expect(asExpected(dashboard.metrics!.overdueCases)).toEqual(board.objetos_con_vencidas)
    expect(dashboard).toMatchObject({ totalDebt: board.total_registrado.valor, pendingDebt: board.deuda_pendiente.valor, overdueDebt: board.deuda_vencida.valor })
  })

  it('/debt-aging suma lo mismo que el tablero', () => {
    const aging = buildDebtAgingSummary(mapped.debtors)
    expect(asExpected(aging.metrics.totalDebt)).toEqual(board.total_registrado)
    expect(asExpected(aging.metrics.pendingDebt)).toEqual(board.deuda_pendiente)
    expect(asExpected(aging.metrics.overdueDebt)).toEqual(board.deuda_vencida)
  })

  it('cada objeto cae en su grupo', () => {
    const groups = Object.fromEntries(buildRecommendationSummary(mapped.debtors).filter(group => group.count).map(group => [group.interventionCode, group.count]))
    expect(groups).toEqual(board.grupos)
  })

  it('la conciliación explica las pagadas: el tablero las incluye y las colas no', () => {
    const reconciliation = buildQueueReconciliation(mapped.debtors)
    const paid = allDebts.filter(debt => debt.estado_id === 6)
    expect(reconciliation.paidObligations).toBe(paid.length)
    expect(asExpected(reconciliation.paidAmount)).toEqual({ valor: 95500, faltantes: 1 })
    expect(reconciliation.dashboardTotal.value).toBe(board.total_registrado.valor)
  })
})

describe('casos chicos en los reportes', () => {
  const queue = parseCsvBytes(new TextEncoder().encode(buildQueueReport(mapped.debtors, {}, NOW, { showIdentifier: true }, smallRaw().batch)))

  it.each(smallCases.casos)('$id: la fila de la cola trae los mismos números', item => {
    const expected = item.esperado
    const row = queue.rows.find(entry => entry.tipo_fila === 'DETALLE' && entry.objeto_id === String(item.objeto.id))!
    expect(row).toMatchObject({
      identificador: item.objeto.identificador, version_reglas: RULES_VERSION, intervencion_codigo: expected.intervencion,
      severidad_puntos: String(expected.puntaje), severidad_banda: expected.banda, severidad_estado: expected.estado_severidad,
      dias_atraso_max: expected.atraso_maximo_dias.valor === null ? expect.any(String) : String(expected.atraso_maximo_dias.valor),
    })
    expect(csvCents(row.deuda_total_ars)).toBe(expected.total_registrado.valor! * 100)
    expect(csvCents(row.deuda_vencida_ars)).toBe(expected.deuda_vencida.valor! * 100)
    expect(csvCents(row.monto_evaluable_ars)).toBe(expected.monto_evaluable * 100)
    if (expected.atraso_maximo_dias.estado === 'NO_APLICA') expect(row.dias_atraso_max).toBe('NO_APLICA')
  })

  it('el total de la cola coincide con el tablero', () => {
    const total = queue.rows.find(entry => entry.tipo_fila === 'TOTAL')!
    expect(csvCents(total.deuda_total_ars)).toBe(smallCases.tablero.total_registrado.valor * 100)
    expect(csvCents(total.deuda_vencida_ars)).toBe(smallCases.tablero.deuda_vencida.valor * 100)
    expect(total.objetos).toBe(String(smallCases.casos.length))
    expect(total.obligaciones).toBe(String(allDebts.length))
  })

  it('el reporte de calidad cuenta los mismos faltantes y estados de severidad', () => {
    const { rows } = parseCsvBytes(new TextEncoder().encode(buildDataQualityReport(mapped.debtors, NOW, smallRaw().batch)))
    const value = (indicador: string, categoria = 'TOTAL') => rows.find(row => row.indicador === indicador && row.categoria === categoria)?.valor
    const cases = smallCases.casos.map(item => item.esperado)
    expect(rows.every(row => row.version_reglas === RULES_VERSION)).toBe(true)
    expect(value('obligaciones_leidas')).toBe(String(allDebts.length))
    expect(value('obligaciones_no_evaluables')).toBe(String(cases.reduce((sum, item) => sum + item.obligaciones_no_evaluables, 0)))
    expect(value('severidad_estado', 'PARCIAL')).toBe(String(cases.filter(item => item.estado_severidad === 'PARCIAL').length))
    expect(value('severidad_estado', 'COMPLETA')).toBe(String(cases.filter(item => item.estado_severidad === 'COMPLETA').length))
    expect(value('presencia_deuda_total', 'OBSERVADO_PARCIAL')).toBe(String(cases.filter(item => item.total_registrado.faltantes).length))
    expect(value('presencia_deuda_vencida', 'OBSERVADO_PARCIAL')).toBe(String(cases.filter(item => item.deuda_vencida.faltantes).length))
  })
})

describe('portfolio-totals: una sola definición', () => {
  const observed = <T,>(valor: T) => ({ estado: 'OBSERVADO' as const, valor })
  const absent = { estado: 'NO_INTEGRADO' as const, valor: null }
  const obligation = (amount: number | null, due: string | null, status: string | null): DecisionObligation => ({
    id: 'x', estado_origen: absent, periodo_fiscal: absent,
    current_amount: amount === null ? { estado: 'NO_INFORMADO_EN_ORIGEN', valor: null } : observed(amount),
    due_date: due === null ? { estado: 'NO_INFORMADO_EN_ORIGEN', valor: null } : observed(due),
    estado_catalogo: status === null ? { estado: 'NO_INFORMADO_EN_ORIGEN', valor: null } : observed(status),
  })

  it('sin lectura de obligaciones nada es calculable; sin catálogo solo el total registrado', () => {
    const rows = [obligation(100, '2026-01-01', 'PAID'), obligation(50, '2026-01-01', 'OVERDUE')]
    expect(objectTotals(rows, { asOf: '2026-09-30', debtsFailed: true }).registeredTotal.value).toBeNull()
    const noCatalog = objectTotals(rows, { asOf: '2026-09-30', statusesFailed: true })
    expect(noCatalog.registeredTotal.value).toBe(150)
    for (const key of ['pendingDebt', 'overdueDebt', 'overdueCount', 'maxDaysOverdue'] as const) {
      expect(noCatalog[key]).toMatchObject({ value: null, presence: 'NO_INTEGRADO' })
    }
    const noCutoff = objectTotals(rows, { asOf: null })
    expect([noCutoff.registeredTotal.value, noCutoff.pendingDebt.value, noCutoff.overdueDebt.value]).toEqual([150, 50, null])
  })

  it('importe negativo o vencimiento anterior a 1970 no son mora y quedan como faltantes', () => {
    const totals = objectTotals([obligation(-5, '2026-01-01', 'ACTIVE'), obligation(70, '1969-12-31', 'ACTIVE')], { asOf: '2026-09-30' })
    expect(totals.registeredTotal.value).toBe(65)
    expect(totals.pendingDebt.value).toBe(65)
    expect(totals.overdueDebt).toMatchObject({ value: null, missing: { INVALIDO: 2 } })
    expect(totals.maxDaysOverdue).toMatchObject({ value: null, presence: 'INVALIDO' })
  })
})
