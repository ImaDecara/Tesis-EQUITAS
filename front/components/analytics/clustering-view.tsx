import { Badge } from '@/components/ui/badge'
import { decimal, Facts, inUnit, Limitations, Notice, Section, share, SimpleTable } from '@/components/analytics/analytics-parts'
import { formatNumber } from '@/lib/data-presence'
import type { ClusteringFeature, ClusteringResult, ClusteringStatus } from '@/lib/ml/contract'
import { formatDate, formatDateTime } from '@/lib/utils'

// Clustering descriptivo de la cartera. Solo agregados: tamaños, medianas y rangos por grupo. Ningún
// caso lleva una marca de cluster y ningún grupo enlaza a una lista de casos o personas.

const STATUS: Readonly<Record<ClusteringStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'neutral'; text: string }>> = {
  OK: { label: 'Clusters calculados', variant: 'success', text: 'El algoritmo encontró los grupos que se describen abajo.' },
  INSUFFICIENT_DATA: { label: 'Datos insuficientes', variant: 'warning', text: 'Hay menos casos utilizables que el mínimo necesario para buscar grupos con sentido. No se muestran grupos.' },
  DEGENERATE: { label: 'Nada que separar', variant: 'warning', text: 'Las variables casi no cambian de un caso a otro: no hay estructura que separar en grupos. No se muestran grupos.' },
  UNAVAILABLE: { label: 'No disponible', variant: 'danger', text: 'No se pudo calcular: la cartera no se leyó completa o el cálculo falló. Esto no significa que la cartera no tenga grupos. El resto de la aplicación funciona igual.' },
}

const SEPARATION = { WEAK: 'Débil', MODERATE: 'Moderada', STRONG: 'Fuerte', NOT_AVAILABLE: 'No disponible' } as const
const STABILITY = { STABLE: 'Estable', INTERMEDIATE: 'Intermedia', UNSTABLE: 'Inestable', NOT_AVAILABLE: 'No disponible' } as const
const UNIT = { ARS: 'Pesos', DAYS: 'Días', COUNT: 'Cantidad' } as const

function portfolioDateText(source: ClusteringResult['source']): string {
  if (source.portfolioDateKind === 'NOT_REGISTERED' || !source.portfolioDate) return 'No registrada en esta base'
  return `${formatDate(source.portfolioDate)}${source.portfolioDateKind === 'DECLARED' ? ' (fecha declarada)' : ' (fecha de corte)'}`
}

function transformText(feature: ClusteringFeature): string {
  const transform = feature.transform === 'LOG1P' ? 'Logaritmo de (1 + valor)' : 'Sin transformar'
  return feature.winsorUpperQuantile === null ? transform : `${transform}; extremos recortados en el percentil ${formatNumber(Math.round(feature.winsorUpperQuantile * 100))}`
}

const UNAVAILABLE_FALLBACK = 'No se pudo obtener el resultado de la analítica.'

export function ClusteringView({ result }: { result: ClusteringResult | null }) {
  const status: ClusteringStatus = result?.status ?? 'UNAVAILABLE'
  const meta = STATUS[status]
  return (
    <section aria-labelledby="clustering-title" className="space-y-4" data-clustering-status={status}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="clustering-title" className="text-lg font-semibold text-[#163a63]">Clusters aprendidos</h2>
        <Badge variant={meta.variant} data-clustering-badge>{meta.label}</Badge>
      </div>
      <Notice tone={status === 'OK' ? 'info' : status === 'UNAVAILABLE' ? 'error' : 'warning'} state={status}>
        <p>{meta.text}</p>
        {(result?.statusDetail || !result) && <p className="mt-1 text-slate-700">{result?.statusDetail ?? UNAVAILABLE_FALLBACK}</p>}
      </Notice>
      {result && result.freshness.state === 'STALE' && (
        <Notice tone="warning" state="STALE">
          <p className="font-semibold">Resultado anterior: no se calculó en esta consulta.</p>
          <p>Es el último cálculo disponible{result.source.computedAt ? `, del ${formatDateTime(result.source.computedAt)}` : ''}. {result.freshness.detail ?? 'La cartera pudo haber cambiado desde entonces.'}</p>
        </Notice>
      )}
      {result && status !== 'UNAVAILABLE' && <ClusteringBody result={result} />}
    </section>
  )
}

function ClusteringBody({ result }: { result: ClusteringResult }) {
  const { source } = result
  const features = result.features ?? []
  const clusters = result.status === 'OK' ? result.clusters ?? [] : []
  const featureByKey = new Map(features.map(feature => [feature.key, feature]))
  return (
    <div className="space-y-4">
      <Section title="Fuente y fechas" id="source">
        <Facts items={[
          ['Municipio', source.tenantName || 'No disponible'],
          ['Casos incluidos', `${formatNumber(source.casesIncluded)} de ${formatNumber(source.casesTotal)} (mínimo para calcular: ${formatNumber(source.minimumCases)})`],
          ['Fecha de cálculo del atraso', formatDate(source.calculationDate)],
          ['Fecha de la cartera', portfolioDateText(source)],
          ['Calculado el', source.computedAt ? formatDateTime(source.computedAt) : 'No disponible'],
          ['Estado del resultado', result.freshness.state === 'STALE' ? 'Resultado anterior' : 'Calculado en esta consulta'],
        ]} />
        {source.portfolioDateKind === 'NOT_REGISTERED' && (
          <p className="text-xs text-slate-600">La base no registra una fecha de corte: el atraso se calcula al {formatDate(source.calculationDate)}, que no es la fecha de actualización de la cartera.</p>
        )}
        {source.exclusions.length > 0 && (
          <SimpleTable caption="Casos excluidos del cálculo" headers={['Casos excluidos: motivo', 'Casos']} numeric={[1]}
            rows={source.exclusions.map(item => [item.label, formatNumber(item.count)])} />
        )}
      </Section>

      {features.length > 0 && (
        <Section title="Variables usadas" id="features">
          <SimpleTable caption="Variables usadas" headers={['Variable', 'Unidad', 'Tratamiento', 'Por qué se usa']}
            rows={features.map(feature => [feature.label, UNIT[feature.unit], transformText(feature), feature.rationale])} />
        </Section>
      )}

      {result.candidates.length > 0 && (
        <Section title="Cantidad de grupos" id="candidates">
          <SimpleTable caption="Comparación de cantidades de grupos" headers={['Grupos (k)', 'Silueta media', 'Grupo más chico', 'Elegible']} numeric={[1, 2]}
            rows={result.candidates.map(item => [
              <span key="k" data-candidate-k={item.k}>{formatNumber(item.k)}{item.k === result.selectedK && <Badge variant="info" className="ml-2">Elegido</Badge>}</span>,
              decimal(item.silhouette), share(item.smallestShare),
              item.eligible ? 'Sí' : `No${item.note ? `: ${item.note}` : ''}`,
            ])} />
          {result.selectionRule && <p className="text-xs text-slate-600">Regla de elección: {result.selectionRule}</p>}
        </Section>
      )}

      {result.status === 'OK' && <Quality result={result} />}

      {clusters.length > 0 && (
        <Section title="Perfil de cada grupo" id="profiles">
          {result.orderingRule && <p className="text-xs text-slate-600">Numeración: {result.orderingRule}</p>}
          <div className="grid grid-cols-1 gap-4">
            {clusters.map(cluster => (
              <article key={cluster.clusterId} data-cluster={cluster.clusterId} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <h3 className="font-semibold text-slate-900">Cluster {cluster.clusterId} · {formatNumber(cluster.size)} {cluster.size === 1 ? 'caso' : 'casos'} ({share(cluster.share)})</h3>
                <SimpleTable caption={`Perfil del cluster ${cluster.clusterId}`} headers={['Variable', 'Mediana', 'Rango intercuartil']} numeric={[1, 2]}
                  rows={cluster.features.map(item => {
                    const unit = featureByKey.get(item.key)?.unit ?? 'COUNT'
                    return [featureByKey.get(item.key)?.label ?? item.key, inUnit(item.median, unit), `${inUnit(item.p25, unit)} a ${inUnit(item.p75, unit)}`]
                  })} />
                {cluster.ruleGroups.length > 0 && (
                  <div data-rule-crossing>
                    <p className="text-xs font-medium text-slate-700">Grupos de trabajo por reglas de estos casos (descripción; no entra en el cálculo):</p>
                    <p className="text-xs text-slate-700">{cluster.ruleGroups.map(group => `${group.groupLabel} ${formatNumber(group.count)}`).join(' · ')}</p>
                  </div>
                )}
              </article>
            ))}
          </div>
        </Section>
      )}

      <Limitations items={result.limitations ?? []} />
      <details className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">
        <summary className="cursor-pointer font-medium text-slate-900">Método</summary>
        <p className="mt-2">k-medias ({result.method.algorithm}) con {result.method.engine} {result.method.engineVersion}, validado contra {result.method.validatedAgainst}. Semilla {result.method.seed}, inicialización {result.method.initialization}, hasta {formatNumber(result.method.maxIterations)} iteraciones.</p>
        {source.dataFingerprint && <p>Huella de los datos usados: <code className="break-all">{source.dataFingerprint}</code> (no contiene datos personales).</p>}
      </details>
    </div>
  )
}

function Quality({ result }: { result: ClusteringResult }) {
  const { separation, stability } = result
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Section title="Separación" id="separation">
        <p><span className="font-semibold text-slate-900" data-separation={separation.reading}>{SEPARATION[separation.reading]}</span> · silueta {decimal(separation.silhouette)}</p>
        {separation.reading === 'WEAK' && <p className="font-medium text-[#6f561e]">Los grupos se superponen: leelos como una descripción aproximada de la cartera, no como tipos de casos.</p>}
        {separation.text && <p>{separation.text}</p>}
      </Section>
      <Section title="Estabilidad" id="stability">
        <p><span className="font-semibold text-slate-900" data-stability={stability.reading}>{STABILITY[stability.reading]}</span> · índice de Rand ajustado (mediana) {decimal(stability.medianAdjustedRand)}</p>
        {stability.text && <p>{stability.text}</p>}
        {stability.method && <p className="text-xs text-slate-600">{stability.method}, {formatNumber(stability.resamples)} repeticiones.</p>}
      </Section>
    </div>
  )
}
