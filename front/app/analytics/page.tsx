import { Suspense } from 'react'

import { SectionLoading } from '@/components/analytics/analytics-parts'
import { ANALYTICS_CONCEPTS, ClusteringSection, SupervisedSection } from '@/components/analytics/analytics-sections'
import { AppShell } from '@/components/layout/app-shell'
import { emptyPortfolioScreen, PageHeading } from '@/components/portfolio/portfolio-state'

export const dynamic = 'force-dynamic'

const TITLE = 'Analítica'

// Pantalla de analítica: solo lee y solo muestra agregados. Exige la misma sesión que el resto (la
// verifican el marco y los cargadores de `lib/ml/server`) y funciona igual en una base sin el módulo
// de decisiones. Cada sección tiene su propio estado de carga.
export default async function AnalyticsPage() {
  const empty = await emptyPortfolioScreen(TITLE)
  if (empty) return empty
  return (
    <AppShell>
      <PageHeading title={TITLE} description="Una descripción de la cartera y un experimento aparte. No cambia nada de lo que muestra el resto de la aplicación." />
      <div className="space-y-6">
        <section aria-label="Qué es cada cosa" className="rounded-lg border border-[#d2dceb] bg-white p-4 text-sm text-slate-700 shadow-sm">
          <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {ANALYTICS_CONCEPTS.map(item => (
              <div key={item.term}><dt className="font-semibold text-[#163a63]">{item.term}</dt><dd>{item.text}</dd></div>
            ))}
          </dl>
          <p className="mt-3 border-t border-slate-100 pt-3 font-medium text-slate-900" data-analytics-scope>
            La analítica no modifica prioridades, grupos de trabajo, intensidades, aprobaciones ni mensajes. Solo muestra agregados: ningún caso lleva una marca de cluster ni una probabilidad.
          </p>
        </section>
        <Suspense fallback={<SectionLoading text="Calculando los clusters de la cartera…" />}>
          <ClusteringSection />
        </Suspense>
        <Suspense fallback={<SectionLoading text="Leyendo los resultados del experimento…" />}>
          <SupervisedSection />
        </Suspense>
      </div>
    </AppShell>
  )
}
