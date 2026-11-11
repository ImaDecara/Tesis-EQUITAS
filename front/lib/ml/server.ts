import 'server-only'

import { createHash } from 'node:crypto'
import { requireTenantAccess } from '@/lib/server/dal'
import { loadViewerContext } from '@/lib/server/viewer-context'
import { loadRawDebtorData } from '@/lib/data/raw-debtor-loader'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { type ClusteringResult, type SupervisedExperimentResult } from './contract'
import { analyzeMatrix, emptyResult } from './engine'
import { prepareCases } from './features'
import { withRuleGroups } from './presentation'
import { validateExperiment } from './validation'
import artifact from './artifacts/supervised-experiment.v1.json'

// Solo proceso servidor, máximo 16 municipios, TTL 15 minutos. No es caché pública de Next.
const memo = new Map<string, { fingerprint: string; at: number; computedAt: string; analysis: ReturnType<typeof analyzeMatrix> }>()
export async function loadClusteringForViewer(): Promise<ClusteringResult> {
  try {
    // Se autoriza en CADA pedido, incluso cuando el ajuste está memoizado.
    const { context } = await requireTenantAccess({ permission: 'portfolio:read' })
    const viewer = await loadViewerContext()
    if (!viewer || viewer.portfolio.kind === 'UNAVAILABLE') return emptyResult('UNAVAILABLE', 'No se pudo verificar el contexto municipal y la cartera.')
    const raw = await loadRawDebtorData()
    if (raw.warnings.length) return emptyResult('UNAVAILABLE', 'La lectura de la cartera tiene advertencias; no se agrupan datos parciales.')
    const now = new Date(), computedAt = now.toISOString()
    const cases = mapDebtorObjectsFromRawData(raw, { computedAt }).debtors
    if (cases.length !== raw.debtors.length) return emptyResult('UNAVAILABLE', 'No se pudo mapear la cartera completa.')
    const { entries, exclusions } = prepareCases(cases)
    const rows = entries.map(entry => entry.values)
    const calculationDate = raw.batch?.as_of ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Cordoba', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
    if (viewer.portfolio.kind === 'LOADED' && viewer.portfolio.asOf !== raw.batch?.as_of) return emptyResult('UNAVAILABLE', 'El corte cambió durante la lectura; volvé a intentar.')
    const fingerprint = createHash('sha256').update(JSON.stringify(rows)).digest('hex')
    const cached = memo.get(context.tenantId)
    const reused = cached?.fingerprint === fingerprint && now.getTime() - cached.at < 15 * 60_000
    const entry = reused ? cached : { fingerprint, at: now.getTime(), computedAt, analysis: analyzeMatrix(rows) }
    if (!reused) {
      if (memo.size >= 16) memo.delete(memo.keys().next().value!)
      memo.set(context.tenantId, entry)
    }
    const result = withRuleGroups(entry.analysis.result, entry.analysis.labels, entries, cases)
    return { ...result, source: { ...result.source, tenantName: viewer.tenantName ?? '', casesTotal: cases.length, casesIncluded: rows.length, exclusions,
      calculationDate, portfolioDate: raw.batch?.as_of ?? null,
      portfolioDateKind: raw.batch ? viewer.portfolio.kind === 'LOADED' && viewer.portfolio.declared ? 'DECLARED' : 'CUTOFF' : 'NOT_REGISTERED', computedAt: entry.computedAt, dataFingerprint: fingerprint },
      freshness: reused ? { state: 'STALE', detail: 'Ajuste anterior reutilizado: las variables de la cartera se volvieron a leer y su huella no cambió. El cruce con las reglas es del pedido actual.' } : { state: 'CURRENT', detail: null } }
  } catch {
    return emptyResult('UNAVAILABLE', 'No se pudo autorizar, leer o calcular la analítica. Volvé a intentar.')
  }
}
export async function loadSupervisedExperiment(): Promise<SupervisedExperimentResult> {
  return validateExperiment(artifact)
}
