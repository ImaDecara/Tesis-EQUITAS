import { Suspense, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ml = vi.hoisted(() => ({ clustering: vi.fn(), experiment: vi.fn(), viewer: vi.fn() }))
vi.mock('@/lib/ml/server', () => ({ loadClusteringForViewer: ml.clustering, loadSupervisedExperiment: ml.experiment }))
vi.mock('@/lib/server/viewer-context', () => ({ loadViewerContext: ml.viewer }))
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children }))

import AnalyticsPage from '@/app/analytics/page'
import { ClusteringSection, SupervisedSection } from '@/components/analytics/analytics-sections'
import { ClusteringView } from '@/components/analytics/clustering-view'
import { SupervisedView } from '@/components/analytics/supervised-view'
import { decimal, inUnit, share } from '@/components/analytics/analytics-parts'
import { nodesOfType } from '@/tests/helpers/case-page'
import { clusteringFixture, experimentFixture } from '@/tests/helpers/ml-fixtures'
import { markupOf, renderedText, viewerFixture } from '@/tests/helpers/viewer-fixtures'
import { SUPERVISED_LABEL, type ClusteringResult } from '@/lib/ml/contract'

// Pantalla /analytics contra el contrato fijo de `lib/ml/contract.ts`, con resultados sintéticos.

const clustering = (result: ClusteringResult | null) => {
  const node = ClusteringView({ result })
  return { markup: markupOf(node), text: renderedText(node) }
}
const supervised = (result: Parameters<typeof SupervisedView>[0]['result']) => {
  const node = SupervisedView({ result })
  return { markup: markupOf(node), text: renderedText(node) }
}
// Lo que nunca puede aparecer: marcas por caso, envíos ni promesas sobre pagos o prioridades.
const FORBIDDEN = [/DEMO6-|SINT-CHICO/, /\/debtors\//, /href=/, /predice pagos(?! reales de La Falda)/i, /cambia(n)? (la )?prioridad/i, /enviado|entregado|intimado/i]

beforeEach(() => {
  vi.clearAllMocks()
  ml.viewer.mockResolvedValue(viewerFixture('USER'))
})

describe('página /analytics', () => {
  it('explica las cuatro cosas distintas y que no modifica nada, antes de pedir ningún cálculo', async () => {
    const page = await AnalyticsPage()
    const text = renderedText(nodesOfType(page, 'section')[0] ?? null)
    for (const term of ['Grupos de trabajo por reglas', 'Clusters aprendidos', 'Puntaje de prioridad', 'Probabilidad experimental sintética']) expect(text).toContain(term)
    expect(text).toContain('La analítica no modifica prioridades, grupos de trabajo, intensidades, aprobaciones ni mensajes')
    expect(ml.clustering).not.toHaveBeenCalled()
    expect(ml.experiment).not.toHaveBeenCalled()
  })

  it('cada cálculo va dentro de su propio Suspense, con un estado de carga que lo dice', async () => {
    const boundaries = nodesOfType(await AnalyticsPage(), Suspense) as unknown as { props: { fallback: ReactNode; children: { type: unknown } } }[]
    expect(boundaries.map(item => item.props.children.type)).toEqual([ClusteringSection, SupervisedSection])
    expect(renderedText(boundaries[0].props.fallback)).toBe('Calculando los clusters de la cartera…')
    expect(markupOf(boundaries[1].props.fallback)).toContain('role="status"')
  })

  it('municipio sin cartera: la tarjeta única, sin pedir analítica', async () => {
    ml.viewer.mockResolvedValue(viewerFixture('USER', { kind: 'EMPTY' }))
    expect(renderedText(await AnalyticsPage())).toContain('todavía no tiene una cartera cargada')
    expect(ml.clustering).not.toHaveBeenCalled()
  })

  it('las secciones piden su resultado y, si el cargador lanza, muestran «No disponible» sin romper la página', async () => {
    ml.clustering.mockResolvedValue(clusteringFixture())
    ml.experiment.mockResolvedValue({ status: 'OK', experiment: experimentFixture() })
    expect(renderedText(await ClusteringSection())).toContain('Clusters calculados')
    expect(renderedText(await SupervisedSection())).toContain('Modelos frente a los baselines')
    ml.clustering.mockRejectedValue(new Error('x'))
    ml.experiment.mockRejectedValue(new Error('x'))
    expect(renderedText(await ClusteringSection())).toContain('No se pudo obtener el resultado de la analítica.')
    expect(renderedText(await SupervisedSection())).toContain('No disponible: no se pudieron leer los resultados del experimento')
  })
})

describe('clustering: estados', () => {
  it('OK: fuente, exclusiones con cantidades, variables, candidatos, calidad y perfiles en unidades originales', () => {
    const { markup, text } = clustering(clusteringFixture())
    expect(markup).toContain('data-clustering-status="OK"')
    expect(text).toContain('16 de 20 (mínimo para calcular: 12)')
    expect(text).toMatch(/Sin deuda vencida 3 .*Falta algún importe 1/)
    expect(text).toContain('Fecha de cálculo del atraso 30/9/2026')
    expect(text).toContain('Fecha de la cartera 30/9/2026 (fecha de corte)')
    expect(text).toContain('Calculado en esta consulta')
    expect(text).toContain('Logaritmo de (1 + valor); extremos recortados en el percentil 99')
    expect(text).toContain('Mide la antigüedad de la deuda.')
    expect(markup).toMatch(/data-candidate-k="2">2<div[^>]*>Elegido/)
    expect(text).toContain('No: el grupo más chico tiene menos del 10 %')
    expect(text).toContain('La mayor silueta entre las cantidades elegibles.')
    expect(text).toContain('Cluster 1 · 12 casos (75%)')
    expect(text).toMatch(/Deuda vencida \$\s?46\.200 \$\s?30\.000 a \$\s?52\.000/)
    expect(text).toContain('Atraso máximo 120 días 60 días a 263 días')
    expect(text).toContain('Grupos de trabajo por reglas de estos casos (descripción; no entra en el cálculo): Recordatorio 7 · Seguimiento 5')
    expect(text).toContain('Describe la cartera de hoy; no anticipa pagos.')
  })

  it('separación débil se dice como débil, y la estabilidad con su lectura', () => {
    const { markup, text } = clustering(clusteringFixture())
    expect(markup).toContain('data-separation="WEAK"')
    expect(text).toContain('Débil · silueta 0,31')
    expect(text).toContain('Los grupos se superponen')
    expect(text).toContain('Estable · índice de Rand ajustado (mediana) 0,82')
    expect(text).toContain('Remuestreo con reemplazo, 50 repeticiones.')
    const strong = clustering(clusteringFixture({ separation: { silhouette: 0.71, reading: 'STRONG', text: '' }, stability: { method: '', resamples: 0, medianAdjustedRand: null, reading: 'UNSTABLE', text: '' } }))
    expect(strong.text).toContain('Fuerte · silueta 0,71')
    expect(strong.text).not.toContain('Los grupos se superponen')
    expect(strong.text).toContain('Inestable · índice de Rand ajustado (mediana) No disponible')
  })

  it.each([
    ['INSUFFICIENT_DATA', 'Datos insuficientes', 'menos casos utilizables que el mínimo'],
    ['DEGENERATE', 'Nada que separar', 'no hay estructura que separar'],
  ] as const)('%s: lo explica, muestra fuente y exclusiones, y no finge grupos', (status, label, explanation) => {
    const { markup, text } = clustering(clusteringFixture({ status, statusDetail: 'Detalle sintético del estado.', clusters: [] }))
    expect(text).toContain(label)
    expect(text).toContain(explanation)
    expect(text).toContain('Detalle sintético del estado.')
    expect(text).toContain('Sin deuda vencida 3')
    expect(markup).not.toContain('data-cluster=')
    expect(markup).not.toContain('data-separation')
  })

  it('aunque traiga perfiles, un estado distinto de OK no los muestra', () => {
    expect(clustering(clusteringFixture({ status: 'DEGENERATE' })).markup).not.toContain('data-cluster=')
  })

  it('UNAVAILABLE: «no disponible», nunca «sin grupos», y sin cifras de relleno', () => {
    const { markup, text } = clustering(clusteringFixture({ status: 'UNAVAILABLE', statusDetail: 'La cartera no se leyó completa.', clusters: [], candidates: [] }))
    expect(text).toContain('No disponible')
    expect(text).toContain('Esto no significa que la cartera no tenga grupos')
    expect(text).toContain('La cartera no se leyó completa.')
    expect(text).not.toMatch(/sin grupos|0 casos|Casos incluidos/i)
    expect(markup).not.toContain('data-analytics-section')
    expect(clustering(null).text).toContain('No se pudo obtener el resultado de la analítica.')
  })

  it('STALE: aviso visible de resultado anterior, con la fecha de cálculo', () => {
    const { markup, text } = clustering(clusteringFixture({ freshness: { state: 'STALE', detail: 'La cartera cambió después.' } }))
    expect(markup).toContain('data-analytics-notice="STALE"')
    expect(text).toContain('Resultado anterior: no se calculó en esta consulta.')
    expect(text).toContain('La cartera cambió después.')
    expect(text).toMatch(/del 11\/11\/2026,? 10:05/)
    expect(text).toContain('Estado del resultado Resultado anterior')
    expect(text).not.toContain('Calculado en esta consulta')
  })

  it('sin fecha de corte acreditada distingue la fecha de cálculo de la de la cartera; fecha declarada se rotula', () => {
    const source = { ...clusteringFixture().source, portfolioDate: null, portfolioDateKind: 'NOT_REGISTERED' as const, calculationDate: '2026-11-11' }
    const { text } = clustering(clusteringFixture({ source }))
    expect(text).toContain('Fecha de la cartera No registrada en esta base')
    expect(text).toContain('el atraso se calcula al 11/11/2026, que no es la fecha de actualización de la cartera')
    const declared = clustering(clusteringFixture({ source: { ...source, portfolioDate: '2026-08-31', portfolioDateKind: 'DECLARED' } }))
    expect(declared.text).toContain('31/8/2026 (fecha declarada)')
  })

  it('solo agregados: ningún identificador de caso ni enlace', () => {
    for (const result of [clusteringFixture(), clusteringFixture({ freshness: { state: 'STALE', detail: null } })]) {
      const { markup, text } = clustering(result)
      for (const pattern of FORBIDDEN) expect(markup + text).not.toMatch(pattern)
    }
  })
})

describe('experimento supervisado', () => {
  it('rótulo exacto siempre visible, también sin resultados', () => {
    for (const result of [{ status: 'OK' as const, experiment: experimentFixture() }, { status: 'UNAVAILABLE' as const, detail: 'Archivo de métricas ausente.' }, null]) {
      const { markup } = supervised(result)
      expect(markup).toMatch(new RegExp(`data-supervised-label[^>]*>${SUPERVISED_LABEL.replace(/[;]/g, '.')}</p>`))
    }
    expect(supervised({ status: 'UNAVAILABLE', detail: 'Archivo de métricas ausente.' }).text).toContain('Archivo de métricas ausente.')
  })

  it('modelos junto a los baselines, controles, partición temporal y veredicto aunque el modelo pierda', () => {
    const { markup, text } = supervised({ status: 'OK', experiment: experimentFixture() })
    expect(markup).toContain('data-analytics-notice="DOES_NOT_BEAT_BASELINE"')
    expect(text).toContain('Veredicto: el modelo no supera al mejor baseline en la evaluación.')
    expect(text).toMatch(/Tasa base Baseline .*0,500/)
    expect(text).toMatch(/Heurística Baseline .*0,640/)
    expect(text).toMatch(/Regresión logística Modelo lineal\. 0,610 0,305 0,200 0,600/)
    expect(text).toContain('Entrenamiento 2025-01 a 2025-12 4.000 700')
    expect(text).toContain('Embargo (sin usar) 2026-01 a 2026-03')
    expect(text).toContain('Evaluación 2026-04 a 2026-06 1.100 210')
    expect(markup).toMatch(/data-control="SHUFFLED_LABELS">Cumple/)
    expect(markup).toMatch(/data-control="NO_SIGNAL">No cumple/)
    expect(text).toContain('No hay historial real apto para validar el modelo.')
    expect(text).toContain('Fecha de la corrida (no de esta consulta)')
    expect(text).toContain('Proporción de positivos 18%')
  })

  it('cuando el modelo supera al baseline también lo dice, y sin embargo la partición omite esa fila', () => {
    const base = experimentFixture()
    const { markup, text } = supervised({ status: 'OK', experiment: { ...base, split: { ...base.split, embargo: null }, verdict: { modelBeatsBaseline: true, text: 'Supera por poco.' }, realHistory: { suitable: true, text: 'Hay pagos fechados.' }, controls: [] } })
    expect(markup).toContain('data-analytics-notice="BEATS_BASELINE"')
    expect(text).toContain('el modelo supera al mejor baseline')
    expect(text).not.toContain('Embargo')
    expect(text).not.toContain('Controles')
    expect(text).toContain('Hay historial real apto para una validación futura.')
  })
})

describe('ancho angosto (390 px)', () => {
  it('tablas de hasta tres columnas no fijan un ancho mínimo; las más anchas avisan que se desplazan', () => {
    const { markup } = clustering(clusteringFixture())
    const exclusions = markup.match(/<div class="overflow-x-auto">(?:(?!<\/table>)[\s\S])*Casos excluidos: motivo[\s\S]*?<\/table>/)?.[0] ?? ''
    expect(exclusions).not.toContain('min-w-')
    expect(exclusions).not.toContain('data-table-scroll-hint')
    const candidates = markup.match(/<div class="overflow-x-auto">(?:(?!<\/table>)[\s\S])*Grupos \(k\)[\s\S]*?<\/table>/)?.[0] ?? ''
    expect(candidates).toContain('min-w-[32rem]')
    expect(candidates).toContain('data-table-scroll-hint')
  })
})

describe('formatos', () => {
  it('decimales, proporciones y unidades sin inventar valores', () => {
    expect(decimal(null)).toBe('No disponible')
    expect(decimal(Number.NaN)).toBe('No disponible')
    expect(share(undefined)).toBe('No disponible')
    expect(share(0.125)).toBe('13%')
    expect(inUnit(3.25, 'COUNT')).toBe('3,3')
    expect(inUnit(10, 'DAYS')).toBe('10 días')
  })
})
