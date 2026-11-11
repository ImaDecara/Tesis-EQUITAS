// Contrato mínimo entre la analítica (ML) y la pantalla. Versión 1.
//
// Dos resultados, que nunca se mezclan:
//  1. Clustering descriptivo de la cartera que el usuario está viendo. Lo calcula la aplicación en el
//     servidor, con la sesión y el municipio de quien consulta. No se guarda en la base ni en Git.
//  2. Experimento supervisado con datos sintéticos. Se corre fuera de la aplicación (Python y
//     scikit-learn) y se publica como un archivo versionado de métricas, sin ningún dato real.
//
// Ninguno de los dos modifica prioridades, grupos de trabajo, intensidades, aprobaciones ni mensajes.
// La pantalla solo muestra agregados: nunca una marca por caso.
//
// Reglas de evolución: se pueden agregar campos opcionales; no se renombra ni se quita ninguno.

export const ML_CONTRACT_VERSION = '1.0.0' as const

/** Rótulo obligatorio de todo lo que venga del experimento supervisado. */
export const SUPERVISED_LABEL = 'Experimento con datos sintéticos; no predice pagos reales de La Falda' as const

// ---------------------------------------------------------------------------------------------
// 1. Clustering descriptivo
// ---------------------------------------------------------------------------------------------

export type ClusteringStatus =
  /** Hay grupos calculados. */
  | 'OK'
  /** Menos casos utilizables que el mínimo declarado en `minimumCases`. */
  | 'INSUFFICIENT_DATA'
  /** Variables constantes o menos puntos distintos que grupos: no hay nada que separar. */
  | 'DEGENERATE'
  /** La cartera no se pudo leer completa o el cálculo falló. Nunca se presenta como «sin grupos». */
  | 'UNAVAILABLE'

export interface ClusteringFeature {
  /** Clave estable, por ejemplo `overdue_amount`. */
  key: string
  /** Nombre para la pantalla, en castellano. */
  label: string
  unit: 'ARS' | 'DAYS' | 'COUNT'
  /** Transformación aplicada antes de escalar. */
  transform: 'LOG1P' | 'NONE'
  /** Cuantil superior donde se recortan los valores extremos; null si no se recorta. */
  winsorUpperQuantile: number | null
  /** Por qué se usa esta variable, en una frase. */
  rationale: string
}

export interface ClusteringExclusion {
  /** Código estable, por ejemplo `NO_OVERDUE_DEBT` o `MISSING_AMOUNT`. */
  reason: string
  label: string
  count: number
}

export interface ClusteringCandidate {
  k: number
  /** Silueta media; null si no se pudo calcular. */
  silhouette: number | null
  /** Proporción del grupo más chico (0 a 1). */
  smallestShare: number
  inertia: number
  /** Si cumple las condiciones para ser elegido. */
  eligible: boolean
  /** Motivo cuando no es elegible. */
  note: string | null
}

export interface ClusterFeatureSummary {
  /** Clave de `ClusteringFeature`. */
  key: string
  /** En la unidad original de la variable, no transformada. */
  median: number
  p25: number
  p75: number
}

export interface ClusterRuleGroupCount {
  /** Código del grupo de trabajo por reglas. */
  groupKey: string
  groupLabel: string
  count: number
}

export interface ClusterProfile {
  /** 1..k, ordenados por una regla estable y declarada en `ClusteringResult.orderingRule`. */
  clusterId: number
  size: number
  /** Proporción sobre los casos incluidos (0 a 1). */
  share: number
  features: ClusterFeatureSummary[]
  /** Cruce descriptivo con los grupos de trabajo por reglas. No es una entrada del modelo. */
  ruleGroups: ClusterRuleGroupCount[]
}

export interface ClusteringResult {
  contractVersion: typeof ML_CONTRACT_VERSION
  status: ClusteringStatus
  /** Explicación breve del estado, para la pantalla. Null cuando es OK. */
  statusDetail: string | null
  method: {
    algorithm: 'KMEANS'
    /** Qué lo calcula en la aplicación publicada. */
    engine: string
    engineVersion: string
    /** Implementación de referencia contra la que se validó, por ejemplo `scikit-learn 1.x`. */
    validatedAgainst: string
    seed: number
    initialization: string
    maxIterations: number
  }
  source: {
    /** Nombre del municipio tal como figura en la base. No se renombra. */
    tenantName: string
    casesTotal: number
    casesIncluded: number
    exclusions: ClusteringExclusion[]
    minimumCases: number
    /** Fecha que usa el cálculo del atraso (AAAA-MM-DD). */
    calculationDate: string
    /** Fecha de la cartera si la base la registra; null si no hay corte acreditado. */
    portfolioDate: string | null
    portfolioDateKind: 'CUTOFF' | 'DECLARED' | 'NOT_REGISTERED'
    /** Momento del cálculo, ISO 8601 con zona. */
    computedAt: string
    /** Huella de las variables usadas. Cambia cuando cambia la cartera. Sin datos personales. */
    dataFingerprint: string
  }
  /** `CURRENT`: calculado sobre la cartera leída en este pedido. `STALE`: es un resultado anterior. */
  freshness: { state: 'CURRENT' | 'STALE'; detail: string | null }
  features: ClusteringFeature[]
  candidates: ClusteringCandidate[]
  selectedK: number | null
  /** Regla de selección de k, en una frase. */
  selectionRule: string
  /** Regla que ordena y numera los grupos, en una frase. */
  orderingRule: string
  separation: {
    silhouette: number | null
    reading: 'WEAK' | 'MODERATE' | 'STRONG' | 'NOT_AVAILABLE'
    /** Lectura honesta para la pantalla. Una separación débil se dice. */
    text: string
  }
  stability: {
    method: string
    resamples: number
    /** Mediana del índice de Rand ajustado contra la asignación de referencia. */
    medianAdjustedRand: number | null
    reading: 'STABLE' | 'INTERMEDIATE' | 'UNSTABLE' | 'NOT_AVAILABLE'
    text: string
  }
  clusters: ClusterProfile[]
  limitations: string[]
}

// ---------------------------------------------------------------------------------------------
// 2. Experimento supervisado con datos sintéticos
// ---------------------------------------------------------------------------------------------

export interface SupervisedMetrics {
  rocAuc: number | null
  prAuc: number | null
  brier: number | null
  logLoss: number | null
}

export interface SupervisedModelResult {
  /** Código estable, por ejemplo `BASE_RATE`, `HEURISTIC` o `LOGISTIC_REGRESSION`. */
  id: string
  label: string
  isBaseline: boolean
  description: string
  /** Sobre la partición de evaluación. */
  metrics: SupervisedMetrics
}

export interface SupervisedControl {
  /** Por ejemplo `SHUFFLED_LABELS` o `NO_SIGNAL`. */
  id: string
  label: string
  description: string
  metrics: SupervisedMetrics
  /** Qué se esperaba, en una frase (por ejemplo, AUC cercano a 0,5). */
  expected: string
  passed: boolean
}

export interface SupervisedSplitPart {
  /** Período, AAAA-MM. */
  from: string
  to: string
  observations: number
  positives: number
}

export interface SupervisedExperiment {
  contractVersion: typeof ML_CONTRACT_VERSION
  label: typeof SUPERVISED_LABEL
  /** ISO 8601. Es la fecha de la corrida, no la de la consulta. */
  generatedAt: string
  /** Identificador de la versión del código que lo generó. */
  codeVersion: string
  seed: number
  libraries: Record<string, string>
  dataset: {
    kind: 'SYNTHETIC'
    generator: string
    units: number
    observations: number
    features: Array<{ key: string; label: string }>
    target: { key: string; definition: string; windowDays: number }
    positiveRate: number
  }
  split: {
    kind: 'TEMPORAL'
    train: SupervisedSplitPart
    /** Meses que no entran en entrenamiento ni en evaluación porque su etiqueta no estaba disponible. */
    embargo: SupervisedSplitPart | null
    test: SupervisedSplitPart
    note: string
  }
  models: SupervisedModelResult[]
  controls: SupervisedControl[]
  verdict: {
    /** Si el modelo supera al mejor baseline en la partición de evaluación. Puede ser false. */
    modelBeatsBaseline: boolean
    text: string
  }
  /** Si la base real tiene historial apto para una validación futura, y por qué. */
  realHistory: { suitable: boolean; text: string }
  limitations: string[]
}

export type SupervisedExperimentResult =
  | { status: 'OK'; experiment: SupervisedExperiment }
  | { status: 'UNAVAILABLE'; detail: string }
