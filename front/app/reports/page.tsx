import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

import { ReportDownloads } from '@/components/equitas/report-downloads'
import { AppShell } from '@/components/layout/app-shell'
import { ModuleUnavailableCard, NoPortfolioCard, StateCard } from '@/components/portfolio/portfolio-state'
import { DefinitionList } from '@/components/reports/definition-list'
import { PORTFOLIO_TOTALS } from '@/lib/reports/report-definitions'
import { availableReportLinks, reportOffers } from '@/lib/server/report-links'
import { moduleAvailable } from '@/lib/domain/database-level-text'
import { loadViewerContext } from '@/lib/server/viewer-context'

export const dynamic = 'force-dynamic'

// Noche 7 (plan §8.1 punto 7). Entrada «Reportes» del menú: cada reporte declara la fecha de la cartera
// y sus definiciones, que son las del tablero. Mostrar u ocultar una descarga no autoriza nada: la ruta
// vuelve a comprobar sesión, municipio y rol, y registra la descarga antes de entregar el archivo.
export default async function ReportsPage() {
  const [viewer, links] = await Promise.all([loadViewerContext(), availableReportLinks()])
  const verified = viewer !== null && links !== null

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-[#163a63]">Reportes</h1>
          <p className="max-w-3xl text-sm text-slate-700">
            Archivos CSV para trabajar fuera de la aplicación. Cada uno trae la fecha de la cartera y la versión de reglas en todas sus
            filas, y sus totales coinciden con los del tablero. <span className="font-medium">Cada descarga queda registrada</span> en
            el registro de accesos del municipio.
          </p>
        </header>

        {!verified && (
          <StateCard state="read-error" tone="error" icon={AlertTriangle} title="No se pudo verificar tu sesión">
            <p>No se ofrecen descargas sin saber qué permite tu cuenta. Recargá la página; si sigue igual, volvé a ingresar.</p>
          </StateCard>
        )}

        {verified && !moduleAvailable(viewer) && <ModuleUnavailableCard what="Reportes" />}

        {verified && viewer.portfolio.kind === 'EMPTY' && <NoPortfolioCard canImport={viewer.capabilities.canImport} />}

        {verified && moduleAvailable(viewer) && <ReportDownloads offers={reportOffers(links)} portfolio={viewer.portfolio} />}

        <section aria-labelledby="definiciones-importes" className="rounded-lg border border-[#d2dceb] bg-white p-4 text-sm text-slate-700">
          <h2 id="definiciones-importes" className="mb-2 font-semibold text-[#163a63]">Cómo se definen los importes</h2>
          <DefinitionList items={PORTFOLIO_TOTALS} />
          <p className="mt-2">
            Si un filtro deja la selección vacía y hay casos sin el dato para evaluarlo, la descarga no entrega un archivo vacío: avisa que
            la selección está incompleta, igual que la pantalla. Más detalle en la <Link href="/help#totales" className="underline">ayuda</Link>.
          </p>
        </section>
      </div>
    </AppShell>
  )
}
