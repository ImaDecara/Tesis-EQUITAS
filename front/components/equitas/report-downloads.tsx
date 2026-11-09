import { Download } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { ReportLink } from '@/lib/server/report-links'

// Lista solo los CSV que permite el rol de la sesión (la página los obtiene con
// availableReportLinks). Son enlaces comunes, no navegación del cliente: la ruta responde un
// archivo adjunto y vuelve a autorizar cada descarga.
export function ReportDownloads({ links }: { links: readonly ReportLink[] | null }) {
  if (!links || links.length === 0) return null

  return (
    <section aria-labelledby="report-downloads-title">
      <Card className="border-[#d2dceb]">
        <CardHeader>
          <CardTitle id="report-downloads-title" className="inline-flex items-center gap-2">
            <Download className="size-4 text-[#163a63]" />
            Reportes CSV
          </CardTitle>
          <CardDescription>
            Cartera completa del corte publicado, sin los filtros de esta pantalla. Cada descarga queda
            registrada en la auditoría. Solo se muestran los reportes que permite tu rol.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {links.map(link => (
              <li key={link.id} className="space-y-1">
                <a href={link.href} data-report={link.id} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  <Download className="size-3.5" />
                  {link.label}
                </a>
                <p className="text-xs text-slate-600">{link.description}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  )
}
