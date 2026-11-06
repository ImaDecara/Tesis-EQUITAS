import Link from 'next/link'
import { portfolioHref, type PortfolioFilters } from '@/lib/portfolio-filters'

const views = [['/', 'Tablero'], ['/debtors', 'Objetos y filtros'], ['/priority-cases', 'Colas'], ['/risk-analysis', 'Severidad'], ['/debt-aging', 'Deuda y mora'], ['/recommended-actions', 'Acciones'], ['/no-contact', 'Sin contacto']]

export function PortfolioScope({ context, filters = {} }: { context?: string; filters?: PortfolioFilters }) {
  const active = Object.values(filters).some(Boolean)
  return <section aria-label="Población y corte" className="space-y-2 text-xs text-slate-600">
    <p>{context ?? 'Corte de origen no informado (corte no integrado).'}</p>
    <p>{active ? 'Población: objetos con coincidencia observada en los filtros de la URL, antes de paginar.' : 'Población: todos los objetos leídos del municipio, antes de paginar.'} Un objeto no es una persona. ARS no implica deuda exigible.</p>
    <nav aria-label="Vistas con los mismos filtros" className="flex flex-wrap gap-3">
      {views.map(([href, title]) => <Link key={href} href={portfolioHref(href, filters)} className="underline">{title}</Link>)}
    </nav>
  </section>
}
