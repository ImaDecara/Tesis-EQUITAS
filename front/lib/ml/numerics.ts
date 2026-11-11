// Núcleo numérico puro: solo matrices, nunca casos ni salidas de las reglas.
export const SEED = 20261111
export const MAX_ITERATIONS = 150
export const SAMPLE_SIZE = 384
export const RESAMPLES = 5
const noBudgetCheck = () => {}
export const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length
export function quantile(values: number[], q: number): number {
  const x = [...values].sort((a, b) => a - b)
  const position = (x.length - 1) * q
  const lower = Math.floor(position)
  return x[lower] + (x[Math.ceil(position)] - x[lower]) * (position - lower)
}
export function random(seed: number) {
  let state = seed >>> 0
  return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296 }
}
export function sampleIndices(n: number, size: number, seed: number): number[] {
  const indices = Array.from({ length: n }, (_, i) => i)
  const next = random(seed)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[indices[i], indices[j]] = [indices[j], indices[i]]
  }
  return indices.slice(0, size).sort((a, b) => a - b)
}
export function fitPreprocessing(rows: number[][]) {
  const caps = rows[0].map((_, j) => quantile(rows.map(row => row[j]), 0.99))
  const logged = rows.map(row => row.map((v, j) => Math.log1p(Math.min(v, caps[j]))))
  const means = caps.map((_, j) => mean(logged.map(row => row[j])))
  const scales = means.map((m, j) => Math.sqrt(mean(logged.map(row => (row[j] - m) ** 2))) || 1)
  return { caps, means, scales }
}
export function transform(rows: number[][], fitted: ReturnType<typeof fitPreprocessing>) {
  return rows.map(row => row.map((v, j) => (Math.log1p(Math.min(v, fitted.caps[j])) - fitted.means[j]) / fitted.scales[j]))
}
export const distanceSquared = (a: number[], b: number[]) => a.reduce((sum, x, j) => sum + (x - b[j]) ** 2, 0)
export function initialCenters(rows: number[][], k: number, seed = SEED, check = noBudgetCheck) {
  const centers = [[...rows[Math.floor(random(seed)() * rows.length)]]]
  while (centers.length < k) {
    check()
    const distances = rows.map(row => Math.min(...centers.map(center => distanceSquared(row, center))))
    const index = distances.indexOf(Math.max(...distances))
    centers.push([...rows[index]])
  }
  return centers
}
export function predict(rows: number[][], centers: number[][], check = noBudgetCheck) {
  return rows.map((row, i) => {
    if (i % 256 === 0) check()
    let best = 0
    for (let c = 1; c < centers.length; c++) if (distanceSquared(row, centers[c]) < distanceSquared(row, centers[best])) best = c
    return best
  })
}
export function kmeans(rows: number[][], k: number, seed = SEED, check = noBudgetCheck) {
  let centers = initialCenters(rows, k, seed, check)
  let previous: number[] = []
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    check()
    const labels = predict(rows, centers, check)
    if (labels.every((label, i) => label === previous[i])) break
    previous = labels
    const counts = Array<number>(k).fill(0)
    const sums = centers.map(center => center.map(() => 0))
    rows.forEach((row, i) => { counts[labels[i]]++; row.forEach((value, j) => { sums[labels[i]][j] += value }) })
    // Un grupo vacío invalida el candidato; no se fabrican asignaciones.
    if (counts.includes(0)) return null
    centers = sums.map((sum, c) => sum.map(value => value / counts[c]))
  }
  const labels = predict(rows, centers, check)
  return { centers, labels, inertia: rows.reduce((sum, row, i) => sum + distanceSquared(row, centers[labels[i]]), 0) }
}
export function silhouette(rows: number[][], labels: number[], check = noBudgetCheck): number | null {
  const indices = sampleIndices(rows.length, SAMPLE_SIZE, SEED)
  const groups = [...new Set(indices.map(i => labels[i]))]
  if (groups.length < 2 || groups.length === indices.length) return null
  return mean(indices.map(i => {
    check()
    const sums = new Map(groups.map(group => [group, { sum: 0, count: 0 }]))
    for (const j of indices) if (j !== i) {
      const bucket = sums.get(labels[j])!
      bucket.sum += Math.sqrt(distanceSquared(rows[i], rows[j])); bucket.count++
    }
    const own = sums.get(labels[i])!
    if (!own.count) return 0
    const a = own.sum / own.count
    const b = Math.min(...groups.filter(group => group !== labels[i]).map(group => sums.get(group)!.sum / sums.get(group)!.count))
    return Math.max(a, b) === 0 ? 0 : (b - a) / Math.max(a, b)
  }))
}
export function adjustedRand(a: number[], b: number[]): number {
  const counts = (keys: (number | string)[]) => {
    const map = new Map<number | string, number>()
    for (const key of keys) map.set(key, (map.get(key) ?? 0) + 1)
    return [...map.values()].reduce((sum, n) => sum + n * (n - 1) / 2, 0)
  }
  const total = a.length * (a.length - 1) / 2
  if (!total) return 1
  const left = counts(a), right = counts(b), joint = counts(a.map((value, i) => `${value}:${b[i]}`))
  const expected = left * right / total, maximum = (left + right) / 2
  return maximum === expected ? 1 : (joint - expected) / (maximum - expected)
}
export function stability(rows: number[][], labels: number[], k: number, check = noBudgetCheck) {
  const scores: number[] = []
  for (let r = 1; r <= RESAMPLES; r++) {
    check()
    const subset = sampleIndices(rows.length, Math.floor(rows.length * 0.8), SEED + r).map(i => rows[i])
    const preprocessing = fitPreprocessing(subset)
    const fitted = kmeans(transform(subset, preprocessing), k, SEED + r, check)
    // Un remuestreo degenerado cuenta como inestabilidad, nunca se omite.
    scores.push(fitted ? adjustedRand(labels, predict(transform(rows, preprocessing), fitted.centers, check)) : 0)
  }
  return quantile(scores, 0.5)
}
