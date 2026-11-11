import { expect, it } from 'vitest'
import artifact from '@/lib/ml/artifacts/supervised-experiment.v1.json'
import { validateExperiment } from '@/lib/ml/validation'
it('valida el artefacto ejecutado contra el contrato', () => {
  expect(validateExperiment(artifact)).toEqual({ status: 'OK', experiment: artifact })
})
it.each([null, [], {}, { ...artifact, label: 'real' }, { ...artifact, seed: NaN }, { ...artifact, libraries: [] },
  { ...artifact, generatedAt: 'ayer' }, { ...artifact, models: [{ ...artifact.models[0], metrics: { rocAuc: 2 } }] },
  { ...artifact, dataset: { ...artifact.dataset, observations: 1 } },
  { ...artifact, split: { ...artifact.split, train: { ...artifact.split.train, positives: 99999 } } },
  { ...artifact, split: { ...artifact.split, test: { ...artifact.split.test, from: '2020-01' } } },
])('rechaza forma o consistencia inválida', value => expect(validateExperiment(value).status).toBe('UNAVAILABLE'))
it('admite métricas no evaluables y embargo nulo si los conteos coinciden', () => {
  const value = structuredClone(artifact)
  const experiment = { ...value, models: [{ ...value.models[0], metrics: { rocAuc: null, prAuc: null, brier: null, logLoss: null } }],
    split: { ...value.split, embargo: null }, dataset: { ...value.dataset, observations: value.split.train.observations + value.split.test.observations } }
  expect(validateExperiment(experiment).status).toBe('OK')
})
