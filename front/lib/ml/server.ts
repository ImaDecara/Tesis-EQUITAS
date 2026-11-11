import 'server-only'

import { ML_CONTRACT_VERSION, type ClusteringResult, type SupervisedExperimentResult } from '@/lib/ml/contract'

// Puntos de entrada que consume la pantalla de analítica. Las firmas son el contrato; el cuerpo de
// este archivo es provisorio y lo reemplaza la implementación de la analítica.

const NOT_IMPLEMENTED = 'La analítica todavía no está implementada en esta versión.'

/**
 * Clustering de la cartera del municipio de quien consulta. Exige sesión, membresía activa y alcance
 * municipal, igual que el resto de las lecturas. No lanza: un fallo vuelve como `UNAVAILABLE`.
 */
export async function loadClusteringForViewer(): Promise<ClusteringResult> {
  return {
    contractVersion: ML_CONTRACT_VERSION,
    status: 'UNAVAILABLE',
    statusDetail: NOT_IMPLEMENTED,
    method: {
      algorithm: 'KMEANS', engine: 'pendiente', engineVersion: '0', validatedAgainst: 'pendiente',
      seed: 0, initialization: 'pendiente', maxIterations: 0,
    },
    source: {
      tenantName: '', casesTotal: 0, casesIncluded: 0, exclusions: [], minimumCases: 0,
      calculationDate: '', portfolioDate: null, portfolioDateKind: 'NOT_REGISTERED', computedAt: '', dataFingerprint: '',
    },
    freshness: { state: 'CURRENT', detail: null },
    features: [], candidates: [], selectedK: null, selectionRule: '', orderingRule: '',
    separation: { silhouette: null, reading: 'NOT_AVAILABLE', text: '' },
    stability: { method: '', resamples: 0, medianAdjustedRand: null, reading: 'NOT_AVAILABLE', text: '' },
    clusters: [], limitations: [],
  }
}

/** Resultados versionados del experimento supervisado con datos sintéticos. No lanza. */
export async function loadSupervisedExperiment(): Promise<SupervisedExperimentResult> {
  return { status: 'UNAVAILABLE', detail: NOT_IMPLEMENTED }
}
