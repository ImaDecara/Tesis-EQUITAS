import { afterEach, describe, expect, it, vi } from 'vitest'
import contract from '../../../contracts/decision-rules.v1.json'
import golden from '../../../contracts/decision-rules.v1.golden.json'
import { DATA_PRESENCE_STATES } from '@/types/equitas-domain'
import {
  RULES_VERSION,
  calculatePriority,
  comparePriority,
  evaluateDecisionRulesV1 as evaluate,
  evaluateFlags,
  evaluateSeverity,
  explainDecision,
  suggestIntervention,
  type Decision,
  type DecisionInput,
} from '@/lib/domain/decision-rules-v1'

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> }
const cases = golden.casos as unknown as { id: string; entrada: DecisionInput; esperado: Decision }[]
const byId = new Map(cases.map((item) => [item.id, item]))
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
  it('declara la versión y conserva los estados del contrato de dominio', () => {
    expect(RULES_VERSION).toBe(golden.version_reglas)
    expect(contract.estados_de_presencia).toEqual([...DATA_PRESENCE_STATES])
    expect(cases).toHaveLength(43)
    expect(golden.pares_contrafactuales).toHaveLength(14)
    expect(golden.ordenamientos).toHaveLength(5)
  })

  it.each(cases)('$id: reproduce la salida completa sin mutar la entrada', (testCase) => {
    const input = freezeDeep(entry(testCase.id))
    expect(evaluate(input)).toStrictEqual(testCase.esperado)
    expect(input).toStrictEqual(testCase.entrada)
  })

  it.each(golden.pares_contrafactuales)('$base / $variante: $propiedad', (pair) => {
    const base = evaluate(entry(pair.base))
    const variant = evaluate(entry(pair.variante))
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

  it.each(golden.ordenamientos)('ordenamiento de $cola', (ordering) => {
    const queue = cases.map((item) => ({ id: item.id, decision: evaluate(item.entrada) }))
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
})
