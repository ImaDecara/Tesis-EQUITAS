import { ML_CONTRACT_VERSION, SUPERVISED_LABEL, type ClusteringResult, type SupervisedExperiment } from '@/lib/ml/contract'

// Resultados de ejemplo SINTÉTICOS que cumplen el contrato de `lib/ml/contract.ts`. Solo para pruebas:
// el código de producción nunca los importa.

export function clusteringFixture(patch: Partial<ClusteringResult> = {}): ClusteringResult {
  return {
    contractVersion: ML_CONTRACT_VERSION,
    status: 'OK',
    statusDetail: null,
    method: { algorithm: 'KMEANS', engine: 'motor-sintético', engineVersion: '0.1.0', validatedAgainst: 'scikit-learn 1.x', seed: 42, initialization: 'k-means++', maxIterations: 300 },
    source: {
      tenantName: 'Municipio sintético', casesTotal: 20, casesIncluded: 16,
      exclusions: [{ reason: 'NO_OVERDUE_DEBT', label: 'Sin deuda vencida', count: 3 }, { reason: 'MISSING_AMOUNT', label: 'Falta algún importe', count: 1 }],
      minimumCases: 12, calculationDate: '2026-09-30', portfolioDate: '2026-09-30', portfolioDateKind: 'CUTOFF',
      computedAt: '2026-11-11T13:05:00.000Z', dataFingerprint: 'f'.repeat(16),
    },
    freshness: { state: 'CURRENT', detail: null },
    features: [
      { key: 'overdue_amount', label: 'Deuda vencida', unit: 'ARS', transform: 'LOG1P', winsorUpperQuantile: 0.99, rationale: 'Mide el tamaño de lo adeudado.' },
      { key: 'max_days', label: 'Atraso máximo', unit: 'DAYS', transform: 'NONE', winsorUpperQuantile: null, rationale: 'Mide la antigüedad de la deuda.' },
    ],
    candidates: [
      { k: 2, silhouette: 0.31, smallestShare: 0.25, inertia: 12.5, eligible: true, note: null },
      { k: 3, silhouette: 0.22, smallestShare: 0.0625, inertia: 9.1, eligible: false, note: 'el grupo más chico tiene menos del 10 %' },
    ],
    selectedK: 2,
    selectionRule: 'La mayor silueta entre las cantidades elegibles.',
    orderingRule: 'Por mediana de deuda vencida, de menor a mayor.',
    separation: { silhouette: 0.31, reading: 'WEAK', text: 'Silueta menor que 0,5.' },
    stability: { method: 'Remuestreo con reemplazo', resamples: 50, medianAdjustedRand: 0.82, reading: 'STABLE', text: 'Los grupos se repiten en la mayoría de los remuestreos.' },
    clusters: [
      { clusterId: 1, size: 12, share: 0.75, features: [{ key: 'overdue_amount', median: 46200, p25: 30000, p75: 52000 }, { key: 'max_days', median: 120, p25: 60, p75: 263 }],
        ruleGroups: [{ groupKey: 'RECORDATORIO_INFORMATIVO', groupLabel: 'Recordatorio', count: 7 }, { groupKey: 'SEGUIMIENTO', groupLabel: 'Seguimiento', count: 5 }] },
      { clusterId: 2, size: 4, share: 0.25, features: [{ key: 'overdue_amount', median: 1500000, p25: 900000, p75: 2100000 }, { key: 'max_days', median: 2761, p25: 1900, p75: 3000 }],
        ruleGroups: [{ groupKey: 'REVISION_JURIDICA', groupLabel: 'Revisión jurídica', count: 1 }, { groupKey: 'CONTACTO_PERSONAL_Y_PLAN', groupLabel: 'Contacto y plan', count: 3 }] },
    ],
    limitations: ['Describe la cartera de hoy; no anticipa pagos.'],
    ...patch,
  }
}

export function experimentFixture(patch: Partial<SupervisedExperiment> = {}): SupervisedExperiment {
  const metrics = (rocAuc: number) => ({ rocAuc, prAuc: rocAuc / 2, brier: 0.2, logLoss: 0.6 })
  return {
    contractVersion: ML_CONTRACT_VERSION,
    label: SUPERVISED_LABEL,
    generatedAt: '2026-11-10T22:00:00.000Z',
    codeVersion: 'abc1234', seed: 7, libraries: { 'scikit-learn': '1.5.2' },
    dataset: {
      kind: 'SYNTHETIC', generator: 'mundo-sintético v1', units: 500, observations: 6000,
      features: [{ key: 'overdue_amount', label: 'Deuda vencida' }], target: { key: 'paid_90', definition: 'Pago dentro de la ventana', windowDays: 90 }, positiveRate: 0.18,
    },
    split: {
      kind: 'TEMPORAL',
      train: { from: '2025-01', to: '2025-12', observations: 4000, positives: 700 },
      embargo: { from: '2026-01', to: '2026-03', observations: 900, positives: 150 },
      test: { from: '2026-04', to: '2026-06', observations: 1100, positives: 210 },
      note: 'Los meses de embargo no entran porque su etiqueta todavía no se conocía.',
    },
    models: [
      { id: 'BASE_RATE', label: 'Tasa base', isBaseline: true, description: 'Siempre la misma probabilidad.', metrics: metrics(0.5) },
      { id: 'HEURISTIC', label: 'Heurística', isBaseline: true, description: 'Ordena por atraso.', metrics: metrics(0.64) },
      { id: 'LOGISTIC_REGRESSION', label: 'Regresión logística', isBaseline: false, description: 'Modelo lineal.', metrics: metrics(0.61) },
    ],
    controls: [
      { id: 'SHUFFLED_LABELS', label: 'Etiquetas mezcladas', description: 'Se rompe la relación.', metrics: metrics(0.5), expected: 'AUC cercano a 0,5', passed: true },
      { id: 'NO_SIGNAL', label: 'Sin señal', description: 'Variables al azar.', metrics: metrics(0.71), expected: 'AUC cercano a 0,5', passed: false },
    ],
    verdict: { modelBeatsBaseline: false, text: 'La heurística queda por encima.' },
    realHistory: { suitable: false, text: 'La base no guarda pagos con fecha por obligación.' },
    limitations: ['Los datos son inventados.'],
    ...patch,
  }
}
