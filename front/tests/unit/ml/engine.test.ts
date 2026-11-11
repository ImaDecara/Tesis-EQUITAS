import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import fixture from '../../fixtures/ml/parity.v1.json'
import { prepareCases } from '@/lib/ml/features'
import { analyzeMatrix } from '@/lib/ml/engine'
import { withRuleGroups } from '@/lib/ml/presentation'
import { adjustedRand, fitPreprocessing, transform, kmeans, quantile, silhouette, sampleIndices, stability } from '@/lib/ml/numerics'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { cases, raw } from './helpers'

it('coincide con sklearn: partición, k, candidatos, silueta, estabilidad y tamaños', () => {
  const { result, labels } = analyzeMatrix(fixture.rows)
  expect(labels).toEqual(fixture.expected.labels)
  expect(result.selectedK).toBe(fixture.expected.selectedK)
  expect(result.separation.silhouette).toBeCloseTo(fixture.expected.silhouette, 10)
  expect(result.stability.medianAdjustedRand).toBeCloseTo(fixture.expected.stability, 10)
  expect(result.clusters.map(c => c.size)).toEqual(fixture.expected.sizes)
  result.candidates.forEach((c, i) => {
    expect(c.silhouette).toBeCloseTo(fixture.expected.candidates[i].silhouette!, 10)
    expect(c.inertia).toBeCloseTo(fixture.expected.candidates[i].inertia, 8)
    expect(c.eligible).toBe(fixture.expected.candidates[i].eligible)
  })
  expect(analyzeMatrix(fixture.rows)).toEqual({ result, labels })
})
it('cuantiles, recorte p99, logaritmo, escala y varianza cero', () => {
  expect(quantile([1, 2, 3, 4], .25)).toBe(1.75)
  const fitted = fitPreprocessing([[1, 2, 3], [1, 4, 3], [1, 10000, 3]])
  expect(fitted.caps[1]).toBeCloseTo(9800.08)
  expect(fitted.scales[0]).toBe(1)
  expect(transform([[1, 2, 3]], fitted)[0][0]).toBe(0)
  expect(sampleIndices(1000, 384, 2)).toHaveLength(384)
  expect(new Set(sampleIndices(1000, 384, 2)).size).toBe(384)
})
it('no inventa grupos con datos escasos, constantes o grupos demasiado chicos', () => {
  expect(analyzeMatrix([]).result.status).toBe('INSUFFICIENT_DATA')
  expect(analyzeMatrix(Array.from({ length: 30 }, () => [1, 1, 1])).result.status).toBe('DEGENERATE')
  const sparse = [...Array.from({ length: 39 }, () => [1, 1, 1]), [1000, 30, 5]]
  expect(analyzeMatrix(sparse).result.status).toBe('DEGENERATE')
  expect(kmeans([[0], [0]], 2)).toBeNull()
  expect(silhouette([[0], [1]], [0, 0])).toBeNull()
  expect(silhouette([[0], [1]], [0, 1])).toBeNull()
  expect(silhouette([[0], [0], [0]], [0, 0, 1])).toBe(0)
  expect(stability(Array.from({ length: 30 }, () => [1, 1, 1]), Array(30).fill(0), 2)).toBe(0)
  expect(adjustedRand([0], [0])).toBe(1)
  expect(adjustedRand([0, 0, 0], [1, 1, 1])).toBe(1)
  expect(adjustedRand([0, 0, 1, 1], [0, 1, 0, 1])).toBeCloseTo(-.5, 12)
})
it('exclusiones mutuamente excluyentes y ninguna imputación', () => {
  const input = cases().slice(0, 6)
  input[0].metrics!.overdueDebt.value = null
  input[1].metrics!.maxDaysOverdue.missing = { INVALIDO: 1 }
  input[2].metrics!.overdueDebt.value = 0
  input[3].debtCount = null
  input[4].metrics!.overdueDebt.value = -1
  const prepared = prepareCases(input)
  expect(prepared.entries).toHaveLength(1)
  expect(prepared.exclusions.map(e => e.count)).toEqual([2, 1, 1, 1])
  expect(prepareCases(cases().reverse()).entries.map(e => e.values)).toEqual(fixture.rows)
})
it('la selección de variables jamás consulta campos prohibidos', () => {
  const allowed = new Set(['metrics', 'debtCount'])
  const guarded = cases().map(item => new Proxy(item, { get(target, key) {
    if (!allowed.has(String(key))) throw new Error(`Campo prohibido: ${String(key)}`)
    return Reflect.get(target, key)
  } }))
  expect(analyzeMatrix(prepareCases(guarded).entries.map(e => e.values)).result.status).toBe('OK')
})
it('perfiles en unidades originales y cruce posterior a las reglas', () => {
  const input = cases()
  input[0].decision = { prioridad: { cola: 'RECORDATORIO', valor: 30 } } as unknown as NonNullable<typeof input[0]['decision']>
  const prepared = prepareCases(input), analysis = analyzeMatrix(prepared.entries.map(e => e.values))
  const result = withRuleGroups(analysis.result, analysis.labels, prepared.entries, input)
  expect(result.clusters[0].features[0].median).toBe(quantile(fixture.rows.slice(0, 45).map(row => row[0]), .5))
  expect(result.clusters.flatMap(c => c.ruleGroups).reduce((s, g) => s + g.count, 0)).toBe(input.length)
  expect(analysis.result.clusters.every(c => c.ruleGroups.length === 0)).toBe(true)
})
it('prioridad, grupo, intensidad, recomendación y mensaje idénticos con y sin analítica', () => {
  const source = raw(), options = { computedAt: '2026-11-11T12:00:00.000Z' }
  const mapped = mapDebtorObjectsFromRawData(source, options)
  const before = structuredClone(mapped.debtors)
  const prepared = prepareCases(mapped.debtors), analysis = analyzeMatrix(prepared.entries.map(e => e.values))
  withRuleGroups(analysis.result, analysis.labels, prepared.entries, mapped.debtors)
  expect(mapped.debtors).toEqual(before)
  expect(mapDebtorObjectsFromRawData(source, options).debtors).toEqual(before)
})
describe('dependencias unidireccionales', () => {
  const walk = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap(item => item.isDirectory() ? walk(join(path, item.name)) : [join(path, item.name)])
  it('ningún módulo de decisiones importa ML', () => {
    for (const folder of ['domain', 'mappers', 'services', 'server']) for (const file of walk(join(process.cwd(), 'lib', folder))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/(?:from\s*|import\s*\(|require\s*\()["'][^"']*(?:\/ml\/|\/ml["'])/)
    }
  })
})
