import { ML_CONTRACT_VERSION, type ClusteringResult, type ClusteringCandidate } from './contract'
import { FEATURES } from './features'
import { SEED, MAX_ITERATIONS, RESAMPLES, SAMPLE_SIZE, fitPreprocessing, transform, kmeans, silhouette, stability, quantile } from './numerics'

export const MINIMUM_CASES = 30
export function emptyResult(status: ClusteringResult['status'], detail: string | null): ClusteringResult {
  return {
    contractVersion: ML_CONTRACT_VERSION, status, statusDetail: detail,
    method: { algorithm: 'KMEANS', engine: 'TypeScript (servidor)', engineVersion: '1.0.0', validatedAgainst: 'scikit-learn 1.9.1', seed: SEED, initialization: 'Primer centro LCG; siguientes: punto más lejano (empate por orden canónico). Un inicio por k.', maxIterations: MAX_ITERATIONS },
    source: { tenantName: '', casesTotal: 0, casesIncluded: 0, exclusions: [], minimumCases: MINIMUM_CASES, calculationDate: '', portfolioDate: null, portfolioDateKind: 'NOT_REGISTERED', computedAt: '', dataFingerprint: '' },
    freshness: { state: 'CURRENT', detail: null }, features: FEATURES, candidates: [], selectedK: null,
    selectionRule: 'k=2…6; cada grupo debe tener al menos max(5, techo(5% de casos)). Mayor silueta; empate dentro de 1e-10: menor k.',
    orderingRule: 'Mediana de deuda vencida ascendente; empate: índice interno del centro.',
    separation: { silhouette: null, reading: 'NOT_AVAILABLE', text: 'Separación no evaluable.' },
    stability: { method: 'Cinco submuestras sin reemplazo del 80%, con preprocesamiento reajustado; ARI de las predicciones de toda la población contra la referencia.', resamples: RESAMPLES, medianAdjustedRand: null, reading: 'NOT_AVAILABLE', text: 'Estabilidad no evaluable.' }, clusters: [],
    limitations: [`Silueta sobre una submuestra determinística de hasta ${SAMPLE_SIZE} casos (distancias dentro de la submuestra).`, 'Se excluyen faltantes; no se imputan importes ni fechas. Recorte superior p99, log1p y estandarización poblacional; varianza cero usa escala 1.', 'Los grupos describen esta cartera. No predicen pagos, no son categorías sociales ni cambian decisiones.', 'Un único inicio y cinco remuestras: evaluación acotada; puede haber otras particiones válidas.'],
  }
}
export function analyzeMatrix(rows: number[][]) {
  const result = emptyResult('INSUFFICIENT_DATA', `Se necesitan al menos ${MINIMUM_CASES} casos completos con deuda vencida.`)
  result.source.casesIncluded = rows.length
  if (rows.length < MINIMUM_CASES) return { result, labels: [] as number[] }
  const scaled = transform(rows, fitPreprocessing(rows))
  if (new Set(scaled.map(row => JSON.stringify(row))).size < 2) {
    result.status = 'DEGENERATE'; result.statusDetail = 'Las variables son constantes; no hay grupos que separar.'
    return { result, labels: [] as number[] }
  }
  let best: { fit: NonNullable<ReturnType<typeof kmeans>>; candidate: ClusteringCandidate } | null = null
  for (let k = 2; k <= 6; k++) {
    const fit = kmeans(scaled, k)
    const counts = Array<number>(k).fill(0)
    fit?.labels.forEach(label => counts[label]++)
    const score = fit ? silhouette(scaled, fit.labels) : null
    const eligible = !!fit && Math.min(...counts) >= Math.max(5, Math.ceil(rows.length * 0.05)) && score !== null
    const candidate = { k, silhouette: score, smallestShare: Math.min(...counts) / rows.length, inertia: fit?.inertia ?? 0, eligible, note: eligible ? null : 'Grupo vacío, pequeño o silueta no evaluable.' }
    result.candidates.push(candidate)
    if (eligible && (!best || score! > best.candidate.silhouette! + 1e-10)) best = { fit: fit!, candidate }
  }
  if (!best) { result.status = 'DEGENERATE'; result.statusDetail = 'Ningún candidato cumple el tamaño mínimo y las condiciones numéricas.'; return { result, labels: [] as number[] } }
  result.status = 'OK'; result.statusDetail = null; result.selectedK = best.candidate.k
  const score = best.candidate.silhouette!, ari = stability(rows, best.fit.labels, result.selectedK)
  result.separation = { silhouette: score, reading: score < 0.25 ? 'WEAK' : score < 0.5 ? 'MODERATE' : 'STRONG', text: `Separación ${score < 0.25 ? 'débil' : score < 0.5 ? 'moderada' : 'fuerte'}: silueta <0,25 débil; 0,25–<0,50 moderada; ≥0,50 fuerte.` }
  result.stability = { ...result.stability, medianAdjustedRand: ari, reading: ari < 0.6 ? 'UNSTABLE' : ari < 0.75 ? 'INTERMEDIATE' : 'STABLE', text: `Estabilidad ${ari < 0.6 ? 'baja' : ari < 0.75 ? 'intermedia' : 'alta'}: ARI <0,60 inestable; 0,60–<0,75 intermedia; ≥0,75 estable.` }
  const order = Array.from({ length: result.selectedK }, (_, c) => c).sort((a, b) => quantile(rows.filter((_, i) => best!.fit.labels[i] === a).map(row => row[0]), 0.5) - quantile(rows.filter((_, i) => best!.fit.labels[i] === b).map(row => row[0]), 0.5) || a - b)
  const labels = best.fit.labels.map(c => order.indexOf(c))
  result.clusters = order.map((_, c) => {
    const members = rows.filter((_, i) => labels[i] === c)
    return { clusterId: c + 1, size: members.length, share: members.length / rows.length,
      features: FEATURES.map((feature, j) => ({ key: feature.key, median: quantile(members.map(row => row[j]), 0.5), p25: quantile(members.map(row => row[j]), 0.25), p75: quantile(members.map(row => row[j]), 0.75) })), ruleGroups: [] }
  })
  return { result, labels }
}
