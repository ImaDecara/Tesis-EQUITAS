import { RiskDonutChart } from '@/components/dashboard/chart-cards'
import { PersonRiskBadge } from '@/components/people/person-risk-badge'
import { ReadErrorState } from '@/components/portfolio/portfolio-state'
import { countLabel, hasLegacyIndex, isEmptyLegacyIndexWarning, missingText } from '@/components/portfolio/portfolio-text'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { coverageText } from '@/lib/analytics'
import { formatNumber, metric, readingFailed } from '@/lib/data-presence'
import type { DataWarning, PeopleDashboardSummary, PersonListItem } from '@/types/equitas-domain'

// Noche 7 (H10). El índice por persona viene de una carga anterior: la carga por CSV no lo calcula.
// Se muestra solo si existe para alguna persona, rotulado «Índice anterior» y separado del puntaje de
// prioridad de cada caso. Si no existe para nadie se retira y queda una sola nota.

export const LEGACY_INDEX_NOTE = 'Índice anterior: un valor de 0 a 100 por persona que trajo una carga anterior (el máximo entre sus casos vinculados). No es el puntaje de prioridad de los casos ni una probabilidad de pago.'

export function legacyIndexState(people: readonly PersonListItem[], warnings: readonly DataWarning[]): 'READ_ERROR' | 'ABSENT' | 'PRESENT' {
  const failed = warnings.filter(warning => !isEmptyLegacyIndexWarning(warning))
  if (readingFailed(failed, 'person', 'debtor_profile_detail')) return 'READ_ERROR'
  return hasLegacyIndex(people) ? 'PRESENT' : 'ABSENT'
}

export function LegacyIndexPanel({ people, summary, warnings }: { people: PersonListItem[]; summary: PeopleDashboardSummary; warnings: DataWarning[] }) {
  const state = legacyIndexState(people, warnings)
  if (state === 'READ_ERROR') return <ReadErrorState what="el índice anterior por persona" />
  if (state === 'ABSENT') {
    return <p data-legacy-index="absent" className="text-sm text-slate-600">Esta cartera no trae el índice anterior por persona, así que no se muestran sus tarjetas ni su gráfico.</p>
  }
  const distribution = summary.individualRiskDistribution.filter(item => item.label !== 'No disponible')
  const withoutIndex = summary.individualRiskDistribution.find(item => item.label === 'No disponible')?.value ?? 0
  const coverage = coverageText(people.map(person => metric(person, 'riskValue')), false, 'personas')
  const missing = missingText('Índice anterior', summary.metrics?.riskValue)
  return (
    <section data-legacy-index="present" aria-labelledby="legacy-index-title" className="space-y-3">
      <h2 id="legacy-index-title" className="text-lg font-semibold text-[#163a63]">Índice anterior por persona</h2>
      <p className="text-sm text-slate-600">{LEGACY_INDEX_NOTE} {coverage}</p>
      {missing && <p className="text-xs text-slate-600">{missing}.</p>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <RiskDonutChart title="Personas por índice anterior" data={distribution} size="compact" />
        <Card className="border-[#d2dceb]">
          <CardHeader>
            <CardTitle>Las 5 personas con mayor índice anterior</CardTitle>
            <CardDescription>
              Alto: {formatNumber(summary.highRiskCount)} · Medio: {formatNumber(summary.mediumRiskCount)} · Bajo: {formatNumber(summary.lowRiskCount)}
              {withoutIndex > 0 && ` · ${countLabel(withoutIndex, 'persona', 'personas')} sin índice`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Persona</TableHead>
                  <TableHead>Índice anterior</TableHead>
                  <TableHead className="text-right">Casos vinculados</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.topPeopleByRiskValue.map(person => (
                  <TableRow key={person.id}>
                    <TableCell>
                      <div className="font-medium text-slate-900">{person.name}</div>
                      <p className="text-xs text-slate-500">{person.document}</p>
                    </TableCell>
                    <TableCell><PersonRiskBadge risk={person.individualRisk} score={person.riskValue} /></TableCell>
                    <TableCell className="text-right">{formatNumber(person.debtorsCount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
