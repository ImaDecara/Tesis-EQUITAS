import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import goldenV100 from '../../../contracts/decision-rules.v1.golden.json'
import goldenV110 from '../../../contracts/decision-rules.v1.1.golden.json'
import smallCases from '../../../contracts/portfolio-small-cases.v1.json'
import { DATA_PRESENCE_STATES } from '@/types/equitas-domain'
import {
  ACTIVE_RULES,
  RULES_CONTRACTS,
  RULES_VERSION,
  calculatePriority,
  comparePriority,
  evaluateDecisionRulesV1 as evaluate,
  evaluateFlags,
  evaluateSeverity,
  explainDecision,
  isPaidObligation,
  rulesContract,
  suggestIntervention,
  type Decision,
  type DecisionInput,
  type DecisionObligation,
} from '@/lib/domain/decision-rules-v1'

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> }
type GoldenCase = { id: string; entrada: DecisionInput; esperado: Decision }
type Golden = {
  version_reglas: string; casos: GoldenCase[]
  pares_contrafactuales: { base: string; variante: string; propiedad: string }[]
  ordenamientos: { cola: string; orden_esperado: string[] }[]
}
const GOLDENS = [goldenV100, goldenV110] as unknown as Golden[]
const golden = GOLDENS.find((item) => item.version_reglas === RULES_VERSION)!
const contract = ACTIVE_RULES
const cases = golden.casos
const byId = new Map(cases.map((item) => [item.id, item]))
const versioned = GOLDENS.flatMap((item) => item.casos.map((testCase) => ({ version: item.version_reglas, ...testCase })))
const observed = <T>(valor: T) => ({ estado: 'OBSERVADO' as const, valor })
const missing = { estado: 'NO_INTEGRADO' as const, valor: null }

function entry(id = 'SINT-G01'): Mutable<DecisionInput> {
  return structuredClone(byId.get(id)!.entrada) as Mutable<DecisionInput>
}

function withDebt(amount: number, due = '2026-09-29', count = 1): Mutable<DecisionInput> {
  const input = entry()
  input.as_of = '2026-09-30'
  input.obligaciones = Array.from({ length: count }, (_, index) => ({
    id: `SINT-OBL-${index}`,
    current_amount: observed(amount), due_date: observed(due),
    estado_origen: missing, periodo_fiscal: missing,
  }))
  return input
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep)
    Object.freeze(value)
  }
  return value
}

afterEach(() => vi.useRealTimers())

describe('ALIGN-009: oráculo compartido completo', () => {
  it('declara la versión activa 1.1.0 y conserva los estados del contrato de dominio', () => {
    expect(RULES_VERSION).toBe('1.1.0')
    expect(ACTIVE_RULES.version).toBe(RULES_VERSION)
    expect(golden.version_reglas).toBe(RULES_VERSION)
    expect(Object.keys(RULES_CONTRACTS).sort()).toEqual(['1.0.0', '1.1.0'])
    for (const rules of Object.values(RULES_CONTRACTS)) {
      expect(rules.estados_de_presencia).toEqual([...DATA_PRESENCE_STATES])
    }
    expect(GOLDENS.map((item) => item.casos.length)).toEqual([43, 54])
    expect(GOLDENS.map((item) => item.pares_contrafactuales.length)).toEqual([14, 15])
    expect(GOLDENS.every((item) => item.ordenamientos.length === 5)).toBe(true)
  })

  it('TypeScript y Python activan la misma versión de reglas', () => {
    const python = readFileSync(new URL('../../../back/services/decision_rules_v1.py', import.meta.url), 'utf8')
    expect([...python.matchAll(/^RULES_VERSION: str = "([0-9.]+)"$/gm)].map((match) => match[1])).toEqual([RULES_VERSION])
  })

  it('cada versión es una copia congelada y una versión desconocida se rechaza', () => {
    expect(Object.isFrozen(ACTIVE_RULES.severidad.bandas)).toBe(true)
    expect(() => (ACTIVE_RULES.severidad.bandas as { desde: number }[]).push({ desde: 1 })).toThrow(TypeError)
    expect(rulesContract('1.0.0').obligaciones_pagadas).toBeUndefined()
    expect(ACTIVE_RULES.obligaciones_pagadas?.clave_catalogo).toBe('PAID')
    expect(() => rulesContract('9.9.9')).toThrow(/desconocida/)
    expect(() => rulesContract('hasOwnProperty')).toThrow(/desconocida/)
  })

  it.each(versioned)('$version / $id: reproduce la salida completa sin mutar la entrada', (testCase) => {
    const input = freezeDeep(structuredClone(testCase.entrada) as Mutable<DecisionInput>)
    expect(evaluate(input, rulesContract(testCase.version))).toStrictEqual(testCase.esperado)
    expect(input).toStrictEqual(testCase.entrada)
  })

  it('el golden 1.1.0 conserva el resultado de 1.0.0 en cada caso sin pagadas, también con el contrato 1.0.0', () => {
    const old = new Map((goldenV100.casos as unknown as GoldenCase[]).map((item) => [item.id, item]))
    for (const testCase of cases.filter((item) => old.has(item.id))) {
      const { obligaciones_pagadas: paid, ...severity } = testCase.esperado.severidad
      expect(paid).toBe(0)
      expect({ ...testCase.esperado, severidad: severity }).toStrictEqual(old.get(testCase.id)!.esperado)
      expect(evaluate(testCase.entrada, rulesContract('1.0.0'))).toStrictEqual(old.get(testCase.id)!.esperado)
    }
  })

  it.each(golden.pares_contrafactuales)('$base / $variante: $propiedad', (pair) => {
    const base = evaluate(entry(pair.base))
    const variant = evaluate(entry(pair.variante))
    if (pair.propiedad === 'pagadas_no_alteran_la_decision') {
      expect(variant.severidad.obligaciones_pagadas).toBeGreaterThan(0)
      expect({ ...variant, severidad: { ...variant.severidad, obligaciones_pagadas: 0 } }).toStrictEqual(base)
      return
    }
    expect(variant.severidad).toStrictEqual(base.severidad)
    expect(variant.prioridad.valor).toBe(base.prioridad.valor)
    if (pair.propiedad === 'intensidad_no_aumenta') {
      expect(variant.intervencion.intensidad).toBeLessThanOrEqual(base.intervencion.intensidad)
    }
    if (pair.propiedad === 'solo_cambian_banderas') {
      const withoutFlags = (decision: Decision) => Object.fromEntries(
        Object.entries(decision).filter(([key]) => key !== 'banderas')
      )
      expect(withoutFlags(variant)).toStrictEqual(withoutFlags(base))
    }
  })

  it.each(GOLDENS.flatMap((item) => item.ordenamientos.map((ordering) => ({ ...ordering, version: item.version_reglas, casos: item.casos }))))(
    '$version: ordenamiento de $cola', (ordering) => {
    const queue = ordering.casos.map((item) => ({ id: item.id, decision: evaluate(item.entrada, rulesContract(ordering.version)) }))
      .filter((item) => item.decision.prioridad.cola === ordering.cola)
    const expected = ordering.orden_esperado
    expect([...queue].reverse().sort(comparePriority).map((item) => item.id)).toEqual(expected)
    expect(queue.sort(comparePriority).map((item) => item.id)).toEqual(expected)
    })

  it.each(cases)('$id: prioridad 0–100, intensidad menor que 3 y canal disponible', ({ entrada }) => {
    const result = evaluate(entrada)
    expect(result.intervencion.intensidad).toBeGreaterThanOrEqual(0)
    expect(result.intervencion.intensidad).toBeLessThan(3)
    expect(result.prioridad.valor === null).toBe(result.severidad.estado === 'NO_DISPONIBLE')
    if (result.prioridad.valor !== null) {
      expect(result.prioridad.valor).toBeGreaterThanOrEqual(0)
      expect(result.prioridad.valor).toBeLessThanOrEqual(100)
    }
    if (result.intervencion.intensidad >= 1) {
      expect(result.banderas).not.toContain('SIN_CONTACTO_ACTIVO')
      expect(result.intervencion.canal_requerido).toBe(true)
    }
    if (result.severidad.cantidad_vencidas === 0) expect(result.severidad.valor).toBe(0)
  })

  it.each(cases.filter((item) => item.esperado.severidad.estado === 'PARCIAL'))(
    '$id: completar faltantes no reduce la severidad mínima', (testCase) => {
      const input = entry(testCase.id)
      const before = evaluate(input)
      for (const obligation of input.obligaciones) {
        const amount = obligation.current_amount
        const due = obligation.due_date
        if (amount.estado !== 'OBSERVADO' || amount.valor < 0) {
          obligation.current_amount = observed(100_000)
        }
        if (due.estado !== 'OBSERVADO' || due.valor < contract.evaluabilidad.fecha_minima_plausible) {
          obligation.due_date = observed('2020-01-01')
        }
      }
      const after = evaluate(input)
      expect(after.severidad.estado).toBe('COMPLETA')
      expect(after.severidad.valor).toBeGreaterThanOrEqual(before.severidad.valor!)
    }
  )
})

describe('límites monetarios, calendario y porcentajes', () => {
  const originalTimezone = process.env.TZ
  beforeAll(() => { process.env.TZ = 'America/New_York' })
  afterAll(() => {
    if (originalTimezone === undefined) delete process.env.TZ
    else process.env.TZ = originalTimezone
  })

  it('suma centavos exactos en el umbral, incluso cuando ×100 queda por debajo del entero', () => {
    const input = withDebt(0.29)
    input.obligaciones.push({ ...input.obligaciones[0], id: 'SINT-CENTAVOS', current_amount: observed(49_999.71) })
    const result = evaluate(input)
    expect(result.severidad.monto_actualizado_ars).toBe(50_000)
    expect(result.explicacion.factores[0].puntos).toBe(20)
  })

  it.each([
    [observed('2026-09-30'), false], [missing, false], [observed('2026-10-01'), true],
  ])('source_updated_at %j: inconsistencia %s frente al corte', (updated, flagged) => {
    const input = withDebt(1)
    input.source_updated_at = updated
    expect(evaluate(input).banderas.includes('FECHAS_INCONSISTENTES')).toBe(flagged)
  })
  it.each([
    [0, 0], [0.01, 10], [49_999.99, 10], [50_000, 20],
    [199_999.99, 20], [200_000, 30], [499_999.99, 30], [500_000, 40],
    [999_999.99, 40], [1_000_000, 50], [10_000_000, 50],
  ])('%s ARS → %s puntos de monto', (amount, points) => {
    expect(evaluate(withDebt(amount)).explicacion.factores[0].puntos).toBe(points)
  })

  it.each([
    [0, 0], [1, 5], [30, 5], [31, 10], [90, 10], [91, 15],
    [180, 15], [181, 20], [365, 20], [366, 25], [730, 25], [731, 30],
  ])('%s días → %s puntos de atraso', (days, points) => {
    const due = new Date(Date.UTC(2026, 8, 30) - days * 86_400_000).toISOString().slice(0, 10)
    const result = evaluate(withDebt(10, due))
    expect(result.explicacion.factores[1].puntos).toBe(points)
    expect(result.severidad.dias_atraso_maximo).toBe(days || null)
  })

  it.each([[0, 0], [1, 5], [2, 5], [3, 10], [5, 10], [6, 15], [11, 15], [12, 20], [30, 20]])(
    '%s vencidas → %s puntos de cantidad', (count, points) => {
      expect(evaluate(withDebt(1, '2026-09-29', count)).explicacion.factores[2].puntos).toBe(points)
    }
  )

  it.each([
    ['2024-02-28', '2024-03-01', 2], ['2023-02-28', '2023-03-01', 1],
    ['2026-03-07', '2026-03-09', 2], ['2026-10-31', '2026-11-02', 2],
    ['1970-01-01', '1970-01-02', 1],
  ])('calendario UTC: %s a %s son %s días', (due, cutoff, days) => {
    const input = withDebt(1, due)
    input.as_of = cutoff
    expect(evaluate(input).severidad.dias_atraso_maximo).toBe(days)
  })

  it('suma centavos, incluye no vencidas y no usa el estado de origen para decidir mora', () => {
    const input = withDebt(0.1)
    input.obligaciones.push({ ...input.obligaciones[0], id: 'SINT-OTRA', current_amount: observed(0.2) })
    input.obligaciones[0].estado_origen = observed('PAGADA')
    input.obligaciones[1].due_date = observed('2026-10-01')
    const result = evaluate(input)
    expect(result.severidad.monto_actualizado_ars).toBe(0.3)
    expect(result.severidad.cantidad_vencidas).toBe(1)
  })

  it.each([
    [[100.01], false], [[99.99], false], [[100.02], true], [[99.98], true],
    [[60, 40.01], false], [[33.333, 33.333, 33.334], false],
    [[100.01000000000002], true], [[100.00999999999999], false],
    [[100, 1e-7], false], [[1e21], true], [[-1e21, 1e21, 100], false],
  ] as [number[], boolean][])('porcentajes %j: alerta %s sin normalizar', (values, flagged) => {
    const input = entry()
    input.personas = values.map((value) => ({ tipo: observed('FISICA'), porcentaje_declarado: observed(value) }))
    expect(evaluate(input).banderas.includes('PORCENTAJES_NO_SUMAN_100')).toBe(flagged)
  })
})

describe('presencia, revisión y funciones por dimensión', () => {
  it.each(DATA_PRESENCE_STATES.filter((state) => state !== 'OBSERVADO'))(
    '%s permanece null con su motivo; nunca se transforma en cero', (state) => {
      const input = withDebt(1)
      input.obligaciones[0].current_amount = { estado: state, valor: null }
      input.obligaciones[0].due_date = { estado: state, valor: null }
      const result = evaluate(input)
      expect(result.severidad).toMatchObject({
        estado: 'NO_DISPONIBLE', valor: null, monto_actualizado_ars: null,
        cantidad_vencidas: null, dias_atraso_maximo: null, obligaciones_no_evaluables: 1,
        motivos_no_evaluables: [
          { motivo: 'IMPORTE_NO_OBSERVADO', estado: state, cantidad: 1 },
          { motivo: 'VENCIMIENTO_NO_OBSERVADO', estado: state, cantidad: 1 },
        ],
      })
      expect(result.prioridad.valor).toBeNull()
      expect(result.explicacion.factores.every((factor) => factor.puntos === null)).toBe(true)
      expect(result.explicacion.frase_contrastiva).toContain(`importe ${state}: 1`)
    }
  )

  it('agrupa motivos por dato y presencia en el orden canónico', () => {
    const input = withDebt(1, '2026-09-29', 3)
    input.obligaciones[0].current_amount = { estado: 'INVALIDO', valor: null }
    input.obligaciones[1].current_amount = { estado: 'NO_INTEGRADO', valor: null }
    input.obligaciones[2].current_amount = { estado: 'INVALIDO', valor: null }
    expect(evaluate(input).severidad.motivos_no_evaluables).toEqual([
      { motivo: 'IMPORTE_NO_OBSERVADO', estado: 'NO_INTEGRADO', cantidad: 1 },
      { motivo: 'IMPORTE_NO_OBSERVADO', estado: 'INVALIDO', cantidad: 2 },
    ])
  })

  it('combina severidad parcial y vulnerabilidad sin perder revisión ni explicación', () => {
    const input = entry()
    input.obligaciones.push(entry('SINT-G28').obligaciones[0])
    input.vulnerabilidad = observed('INDICIO_VULNERABILIDAD')
    const result = evaluate(input)
    expect(result.intervencion).toMatchObject({ regla: 'R4', modificador: 'M1', intensidad: 1 })
    expect(result.revision.motivos).toEqual(['INDICIO_VULNERABILIDAD', 'SEVERIDAD_PARCIAL'])
    expect(result.explicacion.frase_contrastiva).toContain('la severidad puede ser mayor')
    expect(result.explicacion.frase_contrastiva).toContain('indicio de vulnerabilidad informado')
  })

  it.each(cases)('$id: las funciones puras por dimensión componen la misma decisión', ({ entrada }) => {
    const full = evaluate(entrada)
    const { severidad, factores } = evaluateSeverity(entrada)
    const flags = evaluateFlags(entrada, severidad)
    const intervention = suggestIntervention(severidad, flags, entrada.vulnerabilidad.valor)
    expect(severidad).toStrictEqual(full.severidad)
    expect(factores).toStrictEqual(full.explicacion.factores)
    expect(flags).toEqual(full.banderas)
    expect(intervention).toStrictEqual(full.intervencion)
    expect(calculatePriority(severidad, intervention)).toStrictEqual(full.prioridad)
    expect(explainDecision(severidad, intervention, entrada.obligaciones.length)).toBe(full.explicacion.frase_contrastiva)
  })
})

describe('determinismo, aislamiento y desempates', () => {
  it('no depende del reloj ni de otras evaluaciones ni de mutaciones de una salida previa', () => {
    const input = freezeDeep(entry())
    const first = evaluate(input)
    const expected = structuredClone(first)
    first.severidad.motivos_no_evaluables.push({ motivo: 'IMPORTE_NEGATIVO', estado: 'OBSERVADO', cantidad: 9 })
    first.explicacion.factores[0].puntos = -1
    vi.useFakeTimers()
    for (const now of ['1999-01-01', '2040-01-01']) {
      vi.setSystemTime(new Date(now))
      evaluate(entry('SINT-G28'))
      expect(evaluate(input)).toStrictEqual(expected)
    }
  })

  it('cambiar solo el corte cambia la mora sin consultar el reloj', () => {
    const input = withDebt(1, '2026-09-30')
    expect(evaluate(input).severidad.valor).toBe(0)
    input.as_of = '2026-10-01'
    expect(evaluate(input).severidad.dias_atraso_maximo).toBe(1)
  })

  it('desempata por monto, vencimiento e id ASCII, sin locale ni ordenar la entrada', () => {
    const items = [
      { id: 'SINT-a', decision: evaluate(withDebt(100, '2026-09-29')) },
      { id: 'SINT-Z', decision: evaluate(withDebt(100, '2026-09-29')) },
      { id: 'SINT-antes', decision: evaluate(withDebt(100, '2026-09-28')) },
      { id: 'SINT-monto', decision: evaluate(withDebt(101, '2026-09-29')) },
    ]
    const original = structuredClone(items)
    expect([...items].sort(comparePriority).map((item) => item.id)).toEqual([
      'SINT-monto', 'SINT-antes', 'SINT-Z', 'SINT-a',
    ])
    expect(items).toStrictEqual(original)
    expect(comparePriority(items[0], items[0])).toBe(0)
  })

  it('coloca prioridad no disponible al final y rechaza comparar colas distintas', () => {
    const unavailable = { id: 'SINT-A', decision: evaluate(entry('SINT-G28')) }
    const known = { id: 'SINT-B', decision: evaluate(entry('SINT-G17')) }
    expect(comparePriority(unavailable, known)).toBeGreaterThan(0)
    expect(comparePriority(known, unavailable)).toBeLessThan(0)
    expect(() => comparePriority(known, { id: 'SINT-C', decision: evaluate(entry()) })).toThrow(/colas distintas/)
  })
})

describe('entrada mal formada: el adaptador debe declarar INVALIDO, no inventar ceros', () => {
  it.each([null, undefined, '', '2026-02-30', '2026-13-01', '20260930', '2026-9-30', '0000-01-01', '2026-09-30T00:00:00Z', 20260930])(
    'rechaza corte %s', (cutoff) => {
      expect(() => evaluate({ ...entry(), as_of: cutoff } as DecisionInput)).toThrow(/fecha ISO/)
    }
  )

  it.each([['id', 1], ['id', 'á'], ['id', ''], ['obligaciones', null], ['obligaciones', {}]])(
    'rechaza %s = %j', (field, value) => {
      expect(() => evaluate({ ...entry(), [field as string]: value } as DecisionInput)).toThrow()
    }
  )

  it.each([
    null, { estado: 'MISSING', valor: null }, { estado: 'OBSERVADO', valor: null },
    { estado: 'INVALIDO', valor: 0 }, { estado: 'NO_APLICA' },
    { estado: 'OBSERVADO', valor: 'UNKNOWN' },
  ])('rechaza presencia o vulnerabilidad inválida %j', (datum) => {
    expect(() => evaluate({ ...entry(), vulnerabilidad: datum } as DecisionInput)).toThrow()
  })

  it.each([true, '0', Infinity, NaN])('rechaza el importe observado %s', (value) => {
    const input = entry()
    input.obligaciones[0].current_amount = observed(value as number)
    expect(() => evaluate(input)).toThrow(/número finito/)
  })

  it('rechaza fechas observadas imposibles y desbordamientos de centavos', () => {
    expect(() => evaluate(withDebt(1, '2026-02-30'))).toThrow(/fecha ISO/)
    expect(() => evaluate(withDebt(Number.MAX_SAFE_INTEGER))).toThrow(/centavos seguros/)
    expect(() => evaluate(withDebt(50_000_000_000_000, '2026-09-29', 2))).toThrow(/centavos seguros/)
  })

  it.each([1.005, 1.015, -1.005, 1e-7])('rechaza %s sin redondear fracciones de centavo', (amount) => {
    expect(() => evaluate(withDebt(amount))).toThrow(RangeError)
    expect(() => evaluate(withDebt(amount))).toThrow(/exacto de centavos/)
  })
})

describe('reglas 1.1.0: obligaciones pagadas', () => {
  const paidObligation = (estado_catalogo: DecisionObligation['estado_catalogo'], amount = 1000, due = '2026-01-01'): DecisionObligation => ({
    id: 'SINT-PAGO', current_amount: observed(amount), due_date: observed(due),
    estado_origen: missing, periodo_fiscal: missing, ...(estado_catalogo === undefined ? {} : { estado_catalogo }),
  })
  const single = (obligation: DecisionObligation) => ({ ...entry(), obligaciones: [obligation] }) as DecisionInput

  it.each([
    [observed('paid')], [observed(' PAID')], [observed('Pagada')], [observed('SUSPENDED')], [observed('OVERDUE')],
    [{ estado: 'NO_INTEGRADO' as const, valor: null }], [{ estado: 'INVALIDO' as const, valor: null }],
    [{ estado: 'NO_INFORMADO_EN_ORIGEN' as const, valor: null }], [undefined],
  ])('%j no es pagada: se computa por importe y vencimiento', (status) => {
    const result = evaluate(single(paidObligation(status)))
    expect(isPaidObligation(paidObligation(status))).toBe(false)
    expect(result.severidad).toMatchObject({ obligaciones_pagadas: 0, cantidad_vencidas: 1, monto_actualizado_ars: 1000 })
  })

  it('solo PAID observado sale del cálculo; 1.0.0 no distingue estados ni informa pagadas', () => {
    const paid = single(paidObligation(observed('PAID')))
    expect(isPaidObligation(paid.obligaciones[0])).toBe(true)
    expect(isPaidObligation(paid.obligaciones[0], rulesContract('1.0.0'))).toBe(false)
    expect(evaluate(paid).severidad).toMatchObject({ obligaciones_pagadas: 1, cantidad_vencidas: 0, monto_actualizado_ars: 0, valor: 0 })
    const old = evaluate(paid, rulesContract('1.0.0')).severidad
    expect(old).toMatchObject({ cantidad_vencidas: 1, monto_actualizado_ars: 1000 })
    expect(old).not.toHaveProperty('obligaciones_pagadas')
  })

  it.each([null, { estado: 'OBSERVADO', valor: null }, { estado: 'OBSERVADO', valor: 6 }, { estado: 'NO_INTEGRADO', valor: 'PAID' }])(
    'rechaza estado_catalogo mal formado %j', (status) => {
      expect(() => evaluate(single(paidObligation(status as DecisionObligation['estado_catalogo'])))).toThrow(TypeError)
    }
  )

  it('una pagada sin importe ni vencimiento no es no evaluable ni levanta banderas de obligación', () => {
    const input = single({ ...paidObligation(observed('PAID')), current_amount: { estado: 'NO_INFORMADO_EN_ORIGEN', valor: null }, due_date: observed('1969-12-31') })
    const result = evaluate(input)
    expect(result.severidad).toMatchObject({ estado: 'COMPLETA', obligaciones_no_evaluables: 0, motivos_no_evaluables: [] })
    expect(result.banderas).toEqual([])
    expect(result.intervencion.regla).toBe('R7')
    expect(explainDecision(result.severidad, result.intervencion, 1)).toBe(result.explicacion.frase_contrastiva)
  })

  it('el texto explicativo cuenta solo las no pagadas como obligaciones leídas', () => {
    const input = entry('SINT-P05') as Mutable<DecisionInput>
    input.obligaciones.push(paidObligation(observed('PAID')))
    const result = evaluate(input)
    expect(result.severidad.obligaciones_pagadas).toBe(1)
    expect(result.explicacion.frase_contrastiva).toContain('obligaciones no evaluables: 1 de 2;')
    expect(result.explicacion.frase_contrastiva).toBe(evaluate(entry('SINT-P05')).explicacion.frase_contrastiva)
  })
})

describe('casos chicos (contracts/portfolio-small-cases.v1.json) en el motor de reglas', () => {
  type SmallCase = (typeof smallCases.casos)[number]
  const catalog = new Map(smallCases.catalogo_debt_status.map((row) => [row.id, row.key]))
  const datum = <T,>(value: T | null) => value === null ? { estado: 'NO_INFORMADO_EN_ORIGEN' as const, valor: null } : observed(value)
  const status = (id: number | null) => id === null ? datum(null)
    : catalog.has(id) ? observed(catalog.get(id)!) : { estado: 'INVALIDO' as const, valor: null }
  const inputOf = (testCase: SmallCase): DecisionInput => ({
    id: testCase.objeto.identificador, as_of: smallCases.fecha_cartera, source_updated_at: missing,
    obligaciones: testCase.obligaciones.map((item) => ({
      id: String(item.id), current_amount: datum(item.importe), due_date: datum(item.vencimiento),
      estado_origen: missing, periodo_fiscal: missing, estado_catalogo: status(item.estado_id),
    })),
    contactos_activos: observed(testCase.titulares.reduce((sum, holder) => sum + holder.contactos.length, 0)),
    personas: testCase.titulares.map((holder) => ({ tipo: observed('FISICA' as const), porcentaje_declarado: observed(holder.porcentaje) })),
    vulnerabilidad: { estado: 'NO_INFORMADO_EN_ORIGEN', valor: null },
  })

  it.each(smallCases.casos)('$id ($nombre): mismos números que la tabla', (testCase) => {
    const expected = testCase.esperado
    const result = evaluate(inputOf(testCase))
    expect(result.severidad).toMatchObject({
      valor: expected.puntaje, banda: expected.banda, estado: expected.estado_severidad,
      monto_actualizado_ars: expected.monto_evaluable, cantidad_vencidas: expected.obligaciones_vencidas,
      dias_atraso_maximo: expected.atraso_maximo_dias.valor, obligaciones_pagadas: expected.obligaciones_pagadas,
      obligaciones_no_evaluables: expected.obligaciones_no_evaluables,
    })
    expect(result.intervencion).toMatchObject({ codigo: expected.intervencion, regla: expected.regla, intensidad: expected.intensidad })
    expect(ACTIVE_RULES.intervenciones[result.intervencion.codigo].cola).toBe(expected.grupo)
    expect(result.severidad).toStrictEqual(byId.get(testCase.golden)!.esperado.severidad)
  })
})
