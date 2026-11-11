import { Badge } from '@/components/ui/badge'
import { decimal, Facts, Limitations, Notice, Section, share, SimpleTable } from '@/components/analytics/analytics-parts'
import { formatNumber } from '@/lib/data-presence'
import { SUPERVISED_LABEL, type SupervisedExperimentResult, type SupervisedMetrics, type SupervisedSplitPart } from '@/lib/ml/contract'
import { formatDateTime } from '@/lib/utils'

// Experimento supervisado con datos sintéticos. Se muestra separado del clustering y con su rótulo
// siempre visible. No usa ni muestra ningún caso de la cartera.

const metricCells = (metrics: SupervisedMetrics) => [decimal(metrics.rocAuc, 3), decimal(metrics.prAuc, 3), decimal(metrics.brier, 3), decimal(metrics.logLoss, 3)]
const METRIC_HEADERS = ['ROC AUC', 'PR AUC', 'Brier', 'Log loss'] as const

const period = (part: SupervisedSplitPart) => `${part.from} a ${part.to}`

export function SupervisedView({ result }: { result: SupervisedExperimentResult | null }) {
  return (
    <section aria-labelledby="supervised-title" className="space-y-4" data-supervised-status={result?.status ?? 'UNAVAILABLE'}>
      <h2 id="supervised-title" className="text-lg font-semibold text-[#163a63]">Experimento supervisado</h2>
      <p data-supervised-label className="rounded-md border border-[#e7d2ae] bg-[#fbf7ec] px-3 py-2 text-sm font-semibold text-[#6f561e]">{SUPERVISED_LABEL}</p>
      {result?.status === 'OK' ? <Experiment experiment={result.experiment} /> : (
        <Notice tone="error" state="UNAVAILABLE">
          <p>No disponible: no se pudieron leer los resultados del experimento. El resto de la pantalla y de la aplicación funciona igual.</p>
          {result?.detail && <p className="mt-1 text-slate-700">{result.detail}</p>}
        </Notice>
      )}
    </section>
  )
}

function Experiment({ experiment }: { experiment: Extract<SupervisedExperimentResult, { status: 'OK' }>['experiment'] }) {
  const { dataset, split, verdict, realHistory } = experiment
  const parts: [string, SupervisedSplitPart | null][] = [['Entrenamiento', split.train], ['Embargo (sin usar)', split.embargo], ['Evaluación', split.test]]
  return (
    <div className="space-y-4">
      <Notice tone={verdict.modelBeatsBaseline ? 'info' : 'warning'} state={verdict.modelBeatsBaseline ? 'BEATS_BASELINE' : 'DOES_NOT_BEAT_BASELINE'}>
        <p className="font-semibold">{verdict.modelBeatsBaseline ? 'Veredicto: el modelo supera al mejor baseline en la evaluación.' : 'Veredicto: el modelo no supera al mejor baseline en la evaluación.'}</p>
        <p>{verdict.text}</p>
      </Notice>

      <Section title="Datos" id="dataset">
        <Facts items={[
          ['Origen', `Sintético (${dataset.generator})`],
          ['Unidades y observaciones', `${formatNumber(dataset.units)} unidades, ${formatNumber(dataset.observations)} observaciones`],
          ['Qué se intenta anticipar', `${dataset.target.definition} (ventana de ${formatNumber(dataset.target.windowDays)} días)`],
          ['Proporción de positivos', share(dataset.positiveRate)],
        ]} />
        {dataset.features.length > 0 && <p className="text-xs text-slate-600">Variables: {dataset.features.map(item => item.label).join(', ')}.</p>}
      </Section>

      <Section title="Partición temporal" id="split">
        <SimpleTable caption="Partición temporal" headers={['Parte', 'Período', 'Observaciones', 'Positivos']} numeric={[2, 3]}
          rows={parts.filter((entry): entry is [string, SupervisedSplitPart] => entry[1] !== null)
            .map(([label, part]) => [label, period(part), formatNumber(part.observations), formatNumber(part.positives)])} />
        {split.note && <p className="text-xs text-slate-600">{split.note}</p>}
      </Section>

      <Section title="Modelos frente a los baselines" id="models">
        <SimpleTable caption="Modelos y baselines" headers={['Modelo', ...METRIC_HEADERS]} numeric={[1, 2, 3, 4]}
          rows={experiment.models.map(model => [
            <span key="model" data-model={model.id}>
              <span className="font-medium text-slate-900">{model.label}</span>{model.isBaseline && <Badge variant="neutral" className="ml-2">Baseline</Badge>}
              <span className="block text-xs text-slate-600">{model.description}</span>
            </span>,
            ...metricCells(model.metrics),
          ])} />
        <p className="text-xs text-slate-600">En la partición de evaluación. ROC AUC y PR AUC: mayor es mejor. Brier y log loss: menor es mejor.</p>
      </Section>

      {experiment.controls.length > 0 && (
        <Section title="Controles" id="controls">
          <SimpleTable caption="Controles del experimento" headers={['Control', 'Qué se esperaba', 'ROC AUC', 'Resultado']} numeric={[2]}
            rows={experiment.controls.map(control => [
              <span key="control"><span className="font-medium text-slate-900">{control.label}</span><span className="block text-xs text-slate-600">{control.description}</span></span>,
              control.expected, decimal(control.metrics.rocAuc, 3),
              <Badge key="result" variant={control.passed ? 'success' : 'danger'} data-control={control.id}>{control.passed ? 'Cumple' : 'No cumple'}</Badge>,
            ])} />
        </Section>
      )}

      <Section title="Historial real" id="real-history">
        <p><span className="font-semibold text-slate-900">{realHistory.suitable ? 'Hay historial real apto para una validación futura.' : 'No hay historial real apto para validar el modelo.'}</span> {realHistory.text}</p>
      </Section>

      <Limitations items={experiment.limitations} />
      <details className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">
        <summary className="cursor-pointer font-medium text-slate-900">Corrida</summary>
        <p className="mt-2">Fecha de la corrida (no de esta consulta): {formatDateTime(experiment.generatedAt)}. Código {experiment.codeVersion}, semilla {experiment.seed}.</p>
        {Object.keys(experiment.libraries).length > 0 && <p>Bibliotecas: {Object.entries(experiment.libraries).map(([name, version]) => `${name} ${version}`).join(', ')}.</p>}
      </details>
    </div>
  )
}
