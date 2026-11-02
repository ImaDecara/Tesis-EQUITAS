import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { buildDataQualityReport } from '@/lib/reports/data-quality-report'
import { buildDecisionsReport } from '@/lib/reports/decisions-report'
import { buildQueueReport } from '@/lib/reports/queue-report'
import { EXPORTABLE_INTERVENTIONS, EXPORTABLE_REASON_CODES, NOT_CATALOGUED } from '@/lib/reports/report-codes'
import { assertReadsComplete, describeFilters, isCalendarDate, readParams, ReportFilterError, ReportReadError } from '@/lib/reports/report-format'
import { buildReviewLedger, cutoffSpan, parseReviewFilters, versionSet } from '@/lib/reports/review-ledger'
import { buildSupervisionReport } from '@/lib/reports/supervision-report'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { buildPresenceRawData } from '@/tests/helpers/equitas-fixtures'
import { parseCsvBytes } from '@/tests/helpers/independent-csv-parser'
import type { RawDebtorDataBundle } from '@/types/equitas-domain'

const NOW = '2026-11-02T12:00:00.000Z'
const parse = (csv: string) => parseCsvBytes(new TextEncoder().encode(csv))
const validatedRaw = (): RawDebtorDataBundle => {
  const raw = buildPresenceRawData()
  raw.debts = [{ id: 801, debtor: 901, current_amount: 5000.5, status: 2, due_date: '2026-01-01', estado_origen: 'VENCIDA', periodo_fiscal: '2026-01' }]
  return raw
}
const debtorsOf = (raw: RawDebtorDataBundle) => mapDebtorObjectsFromRawData(raw, { computedAt: NOW }).debtors

describe('ALIGN-028: el corte sale del dato', () => {
  it('con manifiesto, fecha_corte es su as_of y no hay fecha de calculo que informar', () => {
    const debtors = debtorsOf({ ...validatedRaw(), batch: { as_of: '2026-09-30', source_updated_at: '2026-09-29' } })
    const { rows } = parse(buildQueueReport(debtors, {}, NOW))
    expect(rows[0]).toMatchObject({ fecha_corte: '2026-09-30', fecha_calculo_usada: 'NO_APLICA', severidad_estado: 'COMPLETA', tipo_fila: 'DETALLE', deuda_total_ars: '5000,50' })
    expect(rows.at(-1)).toMatchObject({ tipo_fila: 'TOTAL', fecha_corte: '2026-09-30', deuda_total_ars: '5000,50', monto_evaluable_ars: '5000,50' })
    const quality = parse(buildDataQualityReport(debtors, NOW))
    expect(quality.rows.every(row => row.fecha_corte === '2026-09-30')).toBe(true)
  })

  it('el mismo manifiesto da el mismo corte con otro reloj; solo cambia generado_en', () => {
    const raw = { ...validatedRaw(), batch: { as_of: '2026-09-30' } }
    const later = '2031-01-01T00:00:00.000Z'
    const first = parse(buildQueueReport(debtorsOf(raw), {}, NOW)).rows[0]
    const second = parse(buildQueueReport(mapDebtorObjectsFromRawData(raw, { computedAt: later }).debtors, {}, later)).rows[0]
    expect(second.fecha_corte).toBe(first.fecha_corte)
    expect(second.dias_atraso_max).toBe(first.dias_atraso_max)
    expect(second.generado_en).not.toBe(first.generado_en)
  })

  it('un manifiesto con corte invalido bloquea la decision y se declara, sin sustituirlo por el reloj', () => {
    const debtors = debtorsOf({ ...validatedRaw(), batch: { as_of: '2026-02-31' } })
    const { rows } = parse(buildQueueReport(debtors, {}, NOW))
    expect(rows[0]).toMatchObject({
      fecha_corte: 'INVALIDO', fecha_calculo_usada: 'NO_APLICA', intervencion_codigo: 'INVALIDO', intensidad: 'INVALIDO',
      severidad_puntos: 'INVALIDO', monto_evaluable_ars: 'INVALIDO', banderas: 'INVALIDO',
    })
    expect(rows.at(-1)!.monto_evaluable_ars).toBe('INVALIDO')
    const quality = parse(buildDataQualityReport(debtors, NOW)).rows
    expect(quality.find(row => row.indicador === 'severidad_estado' && row.categoria === 'SIN_DECISION')?.valor).toBe('1')
  })

  it('sin objetos no hay fecha de calculo que declarar', () => {
    expect(parse(buildQueueReport([], {}, NOW)).rows[0]).toMatchObject({ fecha_corte: 'NO_INTEGRADO', fecha_calculo_usada: 'NO_APLICA', objetos: '0' })
  })
})

describe('ALIGN-028: libro de revisiones', () => {
  const review = (id: number, overrides: Record<string, unknown> = {}) => ({
    id, debtor: 5, rules_version: '1.0.0', as_of: '2026-09-30', suggested_intervention: 'SEGUIMIENTO', suggested_intensity: 1,
    decision: 'MODIFICA', decided_intervention: 'INTIMACION', decided_intensity: 3, reason_code: 'X', reviewer_role: 'operador',
    created_at: '2026-10-01T23:30:00-03:00', supersedes: null, ...overrides,
  })

  it('una propuesta intensa reemplazada sin aprobacion no queda pendiente', () => {
    const [first, second] = buildReviewLedger([review(1), review(2, { supersedes: 1 })], [])
    expect(first).toMatchObject({ current: false, approval: 'REEMPLAZADA' })
    expect(second).toMatchObject({ current: true, approval: 'PENDIENTE', supersedes: '1' })
  })

  it('la fecha se escribe en UTC y el filtro compara ese dia', () => {
    const ledger = buildReviewLedger([review(1)], [])
    expect(ledger[0].decidedAt).toBe('2026-10-02T02:30:00.000Z')
    const rows = (hasta: string) => parse(buildDecisionsReport(ledger, { hasta }, NOW)).rows.filter(row => row.tipo_fila === 'DETALLE')
    expect(rows('2026-10-01')).toEqual([])
    expect(rows('2026-10-02')).toHaveLength(1)
  })

  it('un valor imposible se declara INVALIDO, no se corrige ni desaparece', () => {
    const [event] = buildReviewLedger([review(1, { created_at: 'ayer', as_of: '2026-02-31', decided_intensity: '3', reviewer_role: null })], [])
    expect(event).toMatchObject({ decidedAt: 'INVALIDO', cutoff: 'INVALIDO', decidedIntensity: null, role: 'NO_INTEGRADO', requiresApproval: false })
    const row = parse(buildDecisionsReport([event], {}, NOW)).rows[0]
    expect(row).toMatchObject({ fecha: 'INVALIDO', fecha_corte: 'INVALIDO', rol: 'NO_INTEGRADO' })
  })

  it('un motivo de objecion ausente se cuenta aparte', () => {
    const ledger = buildReviewLedger([review(1)], [{ id: 1, case_review: 1, decision: 'OBJETA', reason_code: null, supersedes: null }])
    const { rows } = parse(buildSupervisionReport(ledger, {}, NOW))
    expect(rows.find(row => row.indicador === 'motivos_objecion')).toMatchObject({ categoria: 'SIN_CODIGO', valor: '1', denominador: '1' })
  })

  it('una decision o una version fuera de formato no salen crudas, y el desglose sigue sumando', () => {
    const ledger = buildReviewLedger([review(1), review(2, { decision: 'ANA_PEREZ_DNI_1', rules_version: 'ANA_PEREZ' })], [])
    expect(ledger[1]).toMatchObject({ decision: NOT_CATALOGUED, rulesVersion: 'INVALIDO' })
    const { rows } = parse(buildSupervisionReport(ledger, {}, NOW))
    const types = rows.filter(row => row.indicador === 'decisiones_por_tipo')
    expect(types.reduce((sum, row) => sum + Number(row.valor), 0)).toBe(2)
    expect(types.find(row => row.categoria === NOT_CATALOGUED)?.valor).toBe('1')
    expect(JSON.stringify(rows)).not.toContain('ANA_PEREZ')
  })

  it('un motivo vacio o de otro tipo no es una ausencia: se cuenta como no catalogado', () => {
    const [empty, number, absent] = buildReviewLedger([review(1, { reason_code: '' }), review(2, { reason_code: 12345678 }), review(3, { reason_code: null })], [])
    expect(empty.reasonCode).toBe(NOT_CATALOGUED)
    expect(number.reasonCode).toBe(NOT_CATALOGUED)
    expect(absent.reasonCode).toBeNull()
  })

  it('un corte unico no se presenta como intervalo', () => {
    const ledger = buildReviewLedger([review(1), review(2)], [])
    expect(cutoffSpan(ledger)).toBe('2026-09-30')
    expect(versionSet(ledger)).toBe('1.0.0')
    expect(cutoffSpan([])).toBe('NO_APLICA')
    expect(versionSet([])).toBe('NO_APLICA')
  })
})

describe('ALIGN-028: listas de codigos exportables', () => {
  it.each([['motivos', EXPORTABLE_REASON_CODES], ['intervenciones', EXPORTABLE_INTERVENTIONS]] as const)('%s: solo palabras en mayusculas, sin digitos que puedan ser un documento', (_name, codes) => {
    expect(codes.size).toBeGreaterThan(0)
    for (const code of codes) expect(code).toMatch(/^[A-Z]+(?:_[A-Z]+)*$/)
  })

  it('las intervenciones son las de los contratos, tambien las de intensidad 3 y 4', () => {
    for (const code of ['MEJORAR_DATOS', 'SEGUIMIENTO', 'INTIMACION_ADMINISTRATIVA', 'DERIVACION_PROCURACION']) expect(EXPORTABLE_INTERVENTIONS.has(code)).toBe(true)
  })

  it('sin indicar el acceso la cola no entrega el identificador', () => {
    const debtors = debtorsOf(validatedRaw())
    expect(parse(buildQueueReport(debtors, {}, NOW)).rows[0].identificador).toBe('OMITIDO_POR_ROL')
    expect(parse(buildQueueReport(debtors, {}, NOW, { showIdentifier: true })).rows[0].identificador).toBe('SINTETICO-OBJ-901')
  })
})

describe('ALIGN-028: reglas comunes', () => {
  it.each(['2026-01-01', '2024-02-29'])('%s es una fecha', value => expect(isCalendarDate(value)).toBe(true))
  it.each(['2026-02-31', '2026-13-01', '20260101', '2026-1-1', '', null, 20260101])('%j no es una fecha', value => expect(isCalendarDate(value)).toBe(false))

  it('los filtros se describen en orden estable y sin los vacios', () => {
    expect(describeFilters({ z: '1', a: '2', b: undefined, c: '' })).toBe('a=2|z=1')
    expect(describeFilters({})).toBe('SIN_FILTROS')
  })

  it('los parametros de pagina se ignoran; los demas desconocidos y los repetidos se rechazan', () => {
    expect(readParams(new URLSearchParams('a=1&page=2'), ['a'], ['page'])).toEqual({ a: '1' })
    expect(readParams(new URLSearchParams('a=%20%20'), ['a'])).toEqual({})
    expect(() => readParams(new URLSearchParams('b=1'), ['a'])).toThrow(ReportFilterError)
    expect(() => readParams(new URLSearchParams('a=1&a=2'), ['a'])).toThrow(ReportFilterError)
    expect(() => readParams(new URLSearchParams('page=1&page=2'), ['a'], ['page'])).toThrow(ReportFilterError)
  })

  it('supervision no admite filtros de fila', () => {
    expect(() => parseReviewFilters(new URLSearchParams('decision=ACEPTA'), ['desde'])).toThrow(ReportFilterError)
  })

  it('una lectura fallida informa solo el nombre de la tabla, sin repetirla', () => {
    const warning = { table: 'debt', message: 'detalle', needsSelectPolicy: false }
    expect(() => assertReadsComplete([])).not.toThrow()
    try {
      assertReadsComplete([warning, warning])
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ReportReadError)
      expect((error as ReportReadError).tables).toEqual(['debt'])
    }
  })
})

describe('ALIGN-028: el catalogo define cada columna e indicador (regla de incorporacion)', () => {
  const catalog = readFileSync(fileURLToPath(new URL('../../../docs/tesis/catalogo-indicadores-v1.md', import.meta.url)), 'utf8')
  const ledger = buildReviewLedger([{
    id: 1, debtor: 5, rules_version: '1.0.0', as_of: '2026-09-30', suggested_intervention: 'SEGUIMIENTO', suggested_intensity: 1,
    decision: 'MODIFICA', decided_intervention: 'INTIMACION', decided_intensity: 3, reason_code: 'X', reviewer_role: 'operador',
    created_at: '2026-10-01T10:00:00Z', supersedes: null,
  }], [{ id: 1, case_review: 1, decision: 'OBJETA', reason_code: 'Y', supersedes: null }])
  const debtors = debtorsOf(validatedRaw())
  const reports = {
    'reporte-cola': parse(buildQueueReport(debtors, {}, NOW)),
    'reporte-decisiones': parse(buildDecisionsReport(ledger, {}, NOW)),
    'reporte-supervision': parse(buildSupervisionReport(ledger, {}, NOW)),
    'reporte-calidad': parse(buildDataQualityReport(debtors, NOW)),
  }

  it.each(Object.entries(reports))('%s: ancla, enlace y columnas', (anchor, file) => {
    expect(catalog).toContain(`<a id="${anchor}"></a>`)
    expect(file.rows.every(row => row.definiciones === `docs/tesis/catalogo-indicadores-v1.md#${anchor}`)).toBe(true)
    for (const column of file.header) expect(catalog, column).toContain(`\`${column}\``)
  })

  it.each(['reporte-supervision', 'reporte-calidad'] as const)('%s: indicadores', anchor => {
    for (const row of reports[anchor].rows) expect(catalog, row.indicador).toContain(`\`${row.indicador}\``)
  })

  it('el catalogo no promete columnas de personas ni texto libre en los reportes', () => {
    const section = catalog.slice(catalog.indexOf('<a id="reportes-csv"></a>'))
    expect(section.length).toBeGreaterThan(1000)
    expect(section).toContain('`reason_text`')
    expect(section).toContain('Sin datos personales')
  })
})
