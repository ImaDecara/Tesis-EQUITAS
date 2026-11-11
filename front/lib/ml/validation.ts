import { ML_CONTRACT_VERSION, SUPERVISED_LABEL, type SupervisedExperiment, type SupervisedExperimentResult } from './contract'

type Check = (value: unknown) => boolean
const text: Check = value => typeof value === 'string' && value.length > 0
const number: Check = value => typeof value === 'number' && Number.isFinite(value)
const count: Check = value => number(value) && Number.isSafeInteger(value) && (value as number) >= 0
const probability: Check = value => number(value) && (value as number) >= 0 && (value as number) <= 1
const bool: Check = value => typeof value === 'boolean'
const literal = (expected: unknown): Check => value => value === expected
const nullable = (check: Check): Check => value => value === null || check(value)
const array = (check: Check): Check => value => Array.isArray(value) && value.length > 0 && value.every(check)
const object = (schema: Record<string, Check>): Check => value => typeof value === 'object' && value !== null && !Array.isArray(value) && Object.entries(schema).every(([key, check]) => check((value as Record<string, unknown>)[key]))
const month: Check = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
const metrics = object({ rocAuc: nullable(probability), prAuc: nullable(probability), brier: nullable(probability), logLoss: nullable(value => number(value) && (value as number) >= 0) })
const part = object({ from: month, to: month, observations: count, positives: count })
const schema = object({
  contractVersion: literal(ML_CONTRACT_VERSION), label: literal(SUPERVISED_LABEL),
  generatedAt: value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)),
  codeVersion: text, seed: count,
  libraries: value => typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length > 0 && Object.values(value).every(text),
  dataset: object({ kind: literal('SYNTHETIC'), generator: text, units: count, observations: count, features: array(object({ key: text, label: text })), target: object({ key: text, definition: text, windowDays: count }), positiveRate: probability }),
  split: object({ kind: literal('TEMPORAL'), train: part, embargo: nullable(part), test: part, note: text }),
  models: array(object({ id: text, label: text, isBaseline: bool, description: text, metrics })),
  controls: array(object({ id: text, label: text, description: text, metrics, expected: text, passed: bool })),
  verdict: object({ modelBeatsBaseline: bool, text }), realHistory: object({ suitable: bool, text }), limitations: array(text),
})
export function validateExperiment(value: unknown): SupervisedExperimentResult {
  if (schema(value)) {
    const experiment = value as SupervisedExperiment
    const parts = [experiment.split.train, experiment.split.embargo, experiment.split.test].filter(part => part !== null)
    if (parts.every(part => part.from <= part.to && part.positives <= part.observations) &&
      parts.reduce((sum, part) => sum + part.observations, 0) === experiment.dataset.observations &&
      parts.every((part, i) => i === 0 || parts[i - 1].to < part.from)) return { status: 'OK', experiment }
  }
  return { status: 'UNAVAILABLE', detail: 'El archivo del experimento sintético no cumple el contrato esperado.' }
}
