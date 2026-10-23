import http from 'k6/http'
import { check, sleep } from 'k6'
import exec from 'k6/execution'
import { Trend, Rate, Counter } from 'k6/metrics'

const policy = JSON.parse(open('./policy.json'))
const oracle = JSON.parse(open(__ENV.ORACLE_PATH))
const base = __ENV.BASE_URL
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base || '')) throw Error('Only runner-owned loopback is allowed')
const mode = __ENV.LOAD_SCENARIO
if (!['poc', 'stress', 'soak'].includes(mode)) throw Error('Unknown load scenario')
const latency = new Trend('operation_ms', true)
const errors = new Rate('unexpected_errors')
const contentErrors = new Counter('content_errors')
const scenarios = {}
const thresholds = {
  content_errors: [{ threshold: 'count==0', abortOnFail: true, delayAbortEval: '1s' }],
  unexpected_errors: [{ threshold: 'rate<=0.2', abortOnFail: true, delayAbortEval: '30s' }],
}
let start = 0
function phase(name, users, duration, slo) {
  scenarios[name] = { executor: 'constant-vus', vus: users, duration: duration + 's',
    startTime: start + 's', gracefulStop: policy.drain_seconds + 's' }
  start += duration + policy.drain_seconds
  if (slo) {
    for (const suffix of ['', ',op:list', ',op:filtered', ',op:summary']) {
      thresholds[`operation_ms{phase:${name}${suffix}}`] = ['p(95)<=2000']
      thresholds[`unexpected_errors{phase:${name}${suffix}}`] = ['rate<=0.01']
    }
  }
}
if (mode === 'poc') phase('poc', 1, policy.poc.duration_seconds, false)
else {
  phase('warmup', 1, policy.warmup_seconds, false)
  if (mode === 'stress') for (const users of policy.stress.users) {
    phase('stress_' + users, users, policy.stress.plateau_seconds, users <= policy.acceptance.target_users)
  }
  else phase('soak', policy.soak.users, policy.soak.duration_seconds, true)
}
export const options = { scenarios, thresholds, systemTags: ['scenario', 'name', 'status', 'method'],
  summaryTrendStats: ['min', 'med', 'p(95)', 'p(99)', 'max'], maxRedirects: 0 }

export function setup() {
  const response = http.get(base + '/__quality', { timeout: '5s', tags: { name: 'setup-metadata' } })
  if (response.status !== 200) throw Error('Isolated server unavailable')
  const meta = response.json()
  if (meta.dataset_hash !== oracle.dataset_hash || meta.source_sha !== __ENV.SOURCE_SHA
      || meta.connector !== 'synthetic-local-read-only') throw Error('Wrong fixture/server/commit')
}

function matches(data, op) {
  const expected = oracle[op]
  if (op === 'summary') {
    if (data.total_cases !== expected.total_cases || data.groups?.length !== 6) return false
    for (const group of data.groups) if (expected.groups[group.group_key] !== group.total) return false
    for (const field of ['risk_bands', 'contacts']) {
      for (const key of Object.keys(expected[field])) if (data[field]?.[key] !== expected[field][key]) return false
    }
    return true
  }
  if (data.total !== expected.total || data.limit !== expected.limit || data.offset !== expected.offset
      || data.items?.length !== expected.items.length) return false
  return expected.items.every((row, index) => Object.keys(row).every(key => data.items[index][key] === row[key]))
}

export default function () {
  const slot = (__ITER + __VU) % 10
  const op = slot < 5 ? 'list' : slot < 7 ? 'filtered' : 'summary'
  const phase = exec.scenario.name
  const response = http.get(base + oracle[op].path, { timeout: policy.request_timeout_seconds + 's',
    redirects: 0, tags: { phase, op, name: op } })
  let correct = false
  try { correct = response.status === 200 && matches(response.json(), op) } catch { correct = false }
  const contentMismatch = response.status === 200 && !correct
  check(response, { 'status and expected functional content': () => correct }, { phase, op })
  errors.add(!correct, { phase, op })
  contentErrors.add(contentMismatch ? 1 : 0, { phase, op })
  latency.add(response.timings.duration, { phase, op, unexpected: correct ? 'false' : 'true',
    content_mismatch: contentMismatch ? 'true' : 'false' })
  sleep(policy.think_seconds)
}

export function handleSummary(data) {
  return { [__ENV.K6_SUMMARY_PATH]: JSON.stringify(data, null, 2) + '\n' }
}
