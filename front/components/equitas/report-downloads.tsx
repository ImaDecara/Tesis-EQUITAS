import { Download, Lock } from 'lucide-react'

import { DefinitionList } from '@/components/reports/definition-list'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { REPORT_DEFINITIONS, RESTRICTED_REASON } from '@/lib/reports/report-definitions'
import type { ReportOffer } from '@/lib/server/report-links'
import type { PortfolioState } from '@/lib/server/viewer-context'
import { cn, formatDate } from '@/lib/utils'

// Noche 7. Listado de la pantalla «Reportes»: los cinco CSV, con qué es una fila y cómo se define cada
// total. Los que el rol no permite se listan igual, deshabilitados y explicados. Son enlaces comunes, no
// navegación del cliente: la ruta responde un archivo adjunto y vuelve a autorizar cada descarga.

function portfolioLine(portfolio: PortfolioState) {
  if (portfolio.kind === 'LOADED') return `Cartera al ${formatDate(portfolio.asOf)}${portfolio.declared ? ' (fecha declarada)' : ''}`
  if (portfolio.kind === 'UNDATED') return 'Sin fecha de cartera registrada: se usa la de hoy'
  return portfolio.kind === 'EMPTY' ? 'Sin cartera cargada' : 'Fecha de la cartera no disponible'
}

function unavailableReason(offer: ReportOffer, portfolio: PortfolioState): string | null {
  if (!offer.allowed) return RESTRICTED_REASON
  if (REPORT_DEFINITIONS[offer.id].portfolio && portfolio.kind === 'EMPTY') return 'Tu municipio todavía no tiene una cartera cargada: no hay casos para exportar.'
  return null
}

export function ReportDownloads({ offers, portfolio }: { offers: readonly ReportOffer[]; portfolio: PortfolioState }) {
  return (
    <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {offers.map(offer => {
        const definition = REPORT_DEFINITIONS[offer.id]
        const reason = unavailableReason(offer, portfolio)
        return (
          <li key={offer.id} data-report={offer.id} data-report-available={reason ? 'no' : 'si'}>
            <Card className="h-full border-[#d2dceb]">
              <CardHeader className="pb-2">
                <CardTitle id={`reporte-${offer.id}`} className="text-base text-[#163a63]">{offer.label}</CardTitle>
                <CardDescription>{offer.description}</CardDescription>
                <p className="text-xs font-medium text-slate-700">{portfolioLine(portfolio)}</p>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-700">
                <p><span className="font-medium">Qué es una fila:</span> {definition.row}</p>
                <DefinitionList items={definition.totals} />
                {reason
                  ? (
                    <p className="flex items-start gap-2 rounded-md bg-slate-50 p-2 text-slate-700">
                      <span aria-disabled="true" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'pointer-events-none opacity-50')}>
                        <Lock className="size-3.5" aria-hidden />Descargar CSV
                      </span>
                      <span>{reason}</span>
                    </p>
                  )
                  : (
                    <a href={offer.href} aria-describedby={`reporte-${offer.id}`} className={buttonVariants({ variant: 'default', size: 'sm' })}>
                      <Download className="size-3.5" aria-hidden />Descargar CSV
                    </a>
                  )}
              </CardContent>
            </Card>
          </li>
        )
      })}
    </ul>
  )
}
