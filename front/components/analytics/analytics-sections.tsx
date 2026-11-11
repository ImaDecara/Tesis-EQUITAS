import { ClusteringView } from '@/components/analytics/clustering-view'
import { SupervisedView } from '@/components/analytics/supervised-view'
import { loadClusteringForViewer, loadSupervisedExperiment } from '@/lib/ml/server'
import type { ClusteringResult, SupervisedExperimentResult } from '@/lib/ml/contract'

// Las dos secciones que piden datos. Cada una va dentro de su propio <Suspense> en /analytics: el
// cálculo se pide solo en esta ruta y no demora al resto de la pantalla ni al tablero. Los cargadores
// no lanzan por contrato; si igual lo hicieran, la sección muestra «No disponible» y la página sigue.

export async function ClusteringSection() {
  let result: ClusteringResult | null
  try {
    result = await loadClusteringForViewer()
  } catch {
    result = null
  }
  return <ClusteringView result={result} />
}

export async function SupervisedSection() {
  let result: SupervisedExperimentResult | null
  try {
    result = await loadSupervisedExperiment()
  } catch {
    result = null
  }
  return <SupervisedView result={result} />
}

/** Las cuatro cosas que esta pantalla no mezcla, con una frase cada una. */
export const ANALYTICS_CONCEPTS: readonly { term: string; text: string }[] = [
  { term: 'Grupos de trabajo por reglas', text: 'Cada caso está en un solo grupo según reglas fijas y públicas. Son los que ordenan el trabajo.' },
  { term: 'Clusters aprendidos', text: 'Agrupamientos que un algoritmo encuentra en la cartera para describirla. No asignan casos ni cambian nada.' },
  { term: 'Puntaje de prioridad', text: 'De 0 a 100, por reglas. Ordena los casos dentro de su grupo de trabajo. No es una probabilidad.' },
  { term: 'Probabilidad experimental sintética', text: 'Sale de un experimento con datos inventados. No se calcula para ningún caso real.' },
]
